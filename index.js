// index.js
// This is the main file for our Heroku web application using Postgres.

// =================================================================
// 1. DEPENDENCIES & INITIAL SETUP
// =================================================================
const express = require('express');
const line = require('@line/bot-sdk');
const { Pool } = require('pg');
const db = require('./db'); // Our database helper

// =================================================================
// 2. CONFIGURATION & STATE
// =================================================================
const config = {
    channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.CHANNEL_SECRET,
};
const PORT = process.env.PORT || 3000;
const MAX_REPLY_LENGTH = 4800;
const DEFAULT_PASSWORD_TIMEOUT_MINUTES = 2; // Default to 2 minutes
const client = new line.Client(config);
const app = express();

// This object will temporarily store users who need to enter a password.
const pendingVerifications = {};

// =================================================================
// 3. SERVER SETUP (EXPRESS)
// =================================================================
app.post('/webhook', line.middleware(config), (req, res) => {
    Promise
        .all(req.body.events.map(handleEvent))
        .then((result) => res.json(result))
        .catch((err) => {
            console.error("Error in webhook processing: ", err);
            res.status(500).end();
        });
});

// =================================================================
// 4. CORE LOGIC: EVENT HANDLER
// =================================================================
async function handleEvent(event) {
    try {
        if (event.type === 'unfollow') {
            delete pendingVerifications[event.source.userId];
            return null;
        }

        if (event.source.type !== 'group') {
            if (event.type === 'message' && pendingVerifications[event.source.userId]) {
                return await handlePasswordAttempt(event.source.userId, event.message, event.replyToken);
            }
            return null;
        }
        
        const groupId = event.source.groupId;

        switch (event.type) {
            case 'message':
                return await handleMessage(groupId, event.message, event.source.userId, event.replyToken);
            case 'memberJoined':
                return await handleMemberJoined(groupId, event.joined.members);
            case 'memberLeft':
                console.log(`Member left: ${event.left.members.map(m => m.userId).join(', ')}`);
                return null;
            default:
                return null;
        }
    } catch (err) {
        console.error("An error occurred in handleEvent:", err);
        return null;
    }
}

// =================================================================
// 5. FEATURE IMPLEMENTATIONS
// =================================================================
async function handleMessage(groupId, message, userId, replyToken) {
    if (message.type !== 'text') return null;
    if (await db.isUserBlacklisted(groupId, userId)) return kickUser(groupId, userId, 'User is on the blacklist.');

    const text = message.text.trim();
    const command = text.split(' ')[0].toLowerCase();
    const args = text.split(' ').slice(1);

    if (command.startsWith('!')) {
        if (command === '!setadmin') {
            // Pass replyToken only to setadmin as it has special public/private reply logic
            return handleSetAdmin(groupId, userId, replyToken, message.mention);
        }

        if (!await db.isAdmin(groupId, userId)) {
            return null; 
        }
        
        // For all other commands, we send a private message (push) and don't reply to the group.
        switch (command) {
            case '!setpassword':
                await handleSetPassword(groupId, userId, args);
                break;
            case '!setpasswordtimeout':
                await handleSetPasswordTimeout(groupId, userId, args);
                break;
            case '!addblacklist':
                await handleAddBlacklistWords(groupId, userId, args);
                break;
            case '!removeblacklist':
                await handleRemoveBlacklistWords(groupId, userId, args);
                break;
            case '!blacklistuser':
                await handleBlacklistUser(groupId, userId, message.mention);
                break;
            case '!unblacklistuser':
                await handleUnblacklistUser(groupId, userId, message.mention);
                break;
            case '!status':
                await handleStatusCommand(groupId, userId);
                break;
            case '!showblacklistwords':
                await handleShowBlacklistWords(groupId, userId);
                break;
            case '!showblacklistusers':
                await handleShowBlacklistUsers(groupId, userId);
                break;
            case '!help':
                await handleHelpCommand(userId);
                break;
            default:
                await client.pushMessage(userId, { type: 'text', text: `Unknown command: ${command}. Use !help to see all available commands.` });
                break;
        }
        return null; // Prevent any public reply
    } else {
        return checkMessageForBlacklist(groupId, userId, text);
    }
}

async function handleMemberJoined(groupId, members) {
    const settings = await db.getGroupSettings(groupId);
    
    for (const member of members) {
        if (await db.isUserBlacklisted(groupId, member.userId)) {
            await kickUser(groupId, member.userId, 'A blacklisted user tried to join.');
            continue;
        }

        if (settings.password) {
            const timeoutMinutes = settings.password_timeout_minutes || DEFAULT_PASSWORD_TIMEOUT_MINUTES;
            const timeoutMs = timeoutMinutes * 60 * 1000;

            const timeoutId = setTimeout(() => {
                if (pendingVerifications[member.userId]) {
                    console.log(`User ${member.userId} timed out. Kicking.`);
                    kickUser(groupId, member.userId, 'Password verification timed out.');
                    delete pendingVerifications[member.userId];
                }
            }, timeoutMs);

            pendingVerifications[member.userId] = { groupId, timeoutId };

            const promptMessage = `Welcome! This group requires a password. Please reply with the password within ${timeoutMinutes} minute(s) to stay in the group.`;
            await client.pushMessage(member.userId, { type: 'text', text: promptMessage });
        }
    }
}

// =================================================================
// 6. COMMAND-SPECIFIC LOGIC (WITH ERROR HANDLING)
// =================================================================

async function handleSetAdmin(groupId, senderId, replyToken, mention) {
    try {
        const settings = await db.getGroupSettings(groupId);
        // Case 1: No admins exist. The first user becomes admin. Reply publicly.
        if (settings.admins.length === 0) {
            await db.addAdmin(groupId, senderId);
            return client.replyMessage(replyToken, { type: 'text', text: 'You are now the first admin.' });
        }

        // Case 2: An admin is adding another admin. Reply privately.
        if (await db.isAdmin(groupId, senderId)) {
            const mentionedUser = mention ? mention.mentionees[0] : null;
            if (!mentionedUser) return client.pushMessage(senderId, { type: 'text', text: 'Usage: !setadmin @username' });
            if (await db.isAdmin(groupId, mentionedUser.userId)) return client.pushMessage(senderId, { type: 'text', text: 'This user is already an admin.' });
            
            await db.addAdmin(groupId, mentionedUser.userId);
            return client.pushMessage(senderId, { type: 'text', text: 'New admin added successfully.' });
        }
        return null; // Non-admin trying to use the command when admins exist.
    } catch (err) {
        console.error("Error in handleSetAdmin:", err);
        // Attempt to notify the admin privately of the error.
        if (replyToken) return client.replyMessage(replyToken, { type: 'text', text: 'An error occurred while setting an admin.' });
        return null;
    }
}

async function handleAddBlacklistWords(groupId, userId, args) {
    try {
        if (args.length === 0) return client.pushMessage(userId, { type: 'text', text: 'Usage: !addblacklist [word]...' });
        await db.addBlacklistWords(groupId, args);
        return client.pushMessage(userId, { type: 'text', text: `Added ${args.length} word(s) to blacklist.` });
    } catch (err) {
        console.error("Error in handleAddBlacklistWords:", err);
        return client.pushMessage(userId, { type: 'text', text: 'An error occurred while adding to the blacklist.' });
    }
}

async function handleRemoveBlacklistWords(groupId, userId, args) {
    try {
        if (args.length === 0) return client.pushMessage(userId, { type: 'text', text: 'Usage: !removeblacklist [word]...' });
        await db.removeBlacklistWords(groupId, args);
        return client.pushMessage(userId, { type: 'text', text: `Removed ${args.length} word(s) from blacklist.` });
    } catch (err) {
        console.error("Error in handleRemoveBlacklistWords:", err);
        return client.pushMessage(userId, { type: 'text', text: 'An error occurred while removing from the blacklist.' });
    }
}

async function handleSetPassword(groupId, userId, args) {
    try {
        if (args.length === 0) return client.pushMessage(userId, { type: 'text', text: 'Usage: !setpassword [new_password|off]' });
        const newPassword = args[0];
        if (newPassword.toLowerCase() === 'off') {
            await db.setPassword(groupId, null);
            return client.pushMessage(userId, { type: 'text', text: 'Password protection has been disabled.' });
        }
        await db.setPassword(groupId, newPassword);
        return client.pushMessage(userId, { type: 'text', text: `The group password has been set to: ${newPassword}` });
    } catch (err) {
        console.error("Error in handleSetPassword:", err);
        return client.pushMessage(userId, { type: 'text', text: 'An error occurred while setting the password.' });
    }
}

async function handleSetPasswordTimeout(groupId, userId, args) {
    try {
        if (args.length === 0) return client.pushMessage(userId, { type: 'text', text: 'Usage: !setpasswordtimeout [minutes]' });
        const minutes = parseInt(args[0], 10);
        if (isNaN(minutes) || minutes <= 0) return client.pushMessage(userId, { type: 'text', text: 'Please provide a valid number of minutes.' });
        await db.setPasswordTimeout(groupId, minutes);
        return client.pushMessage(userId, { type: 'text', text: `Password timeout has been set to ${minutes} minute(s).` });
    } catch (err) {
        console.error("Error in handleSetPasswordTimeout:", err);
        return client.pushMessage(userId, { type: 'text', text: 'An error occurred while setting the timeout.' });
    }
}

function handleHelpCommand(userId) {
    const helpText = `--- Admin Commands ---
!help
!status
!setpassword [pass|off]
!setpasswordtimeout [mins]
!showblacklistwords
!showblacklistusers
!setadmin @user
!addblacklist [word]...
!removeblacklist [word]...
!blacklistuser @user
!unblacklistuser @user`;
    return client.pushMessage(userId, { type: 'text', text: helpText });
}

async function handleBlacklistUser(groupId, userId, mention) {
    try {
        const mentionedUser = mention ? mention.mentionees[0] : null;
        if (!mentionedUser) return client.pushMessage(userId, { type: 'text', text: 'Usage: !blacklistuser @username' });
        if (await db.isAdmin(groupId, mentionedUser.userId)) return client.pushMessage(userId, { type: 'text', text: 'You cannot blacklist an admin.' });
        
        await db.addUserToBlacklist(groupId, mentionedUser.userId);
        const profile = await client.getGroupMemberProfile(groupId, mentionedUser.userId);
        await kickUser(groupId, mentionedUser.userId, 'User has been blacklisted.');
        return client.pushMessage(userId, { type: 'text', text: `${profile.displayName} has been blacklisted and removed.` });
    } catch (e) {
        console.error("Error in handleBlacklistUser:", e);
        return client.pushMessage(userId, { type: 'text', text: `User ID added to blacklist, but could not be removed from group (may have already left).` });
    }
}

async function handleUnblacklistUser(groupId, userId, mention) {
    try {
        const mentionedUser = mention ? mention.mentionees[0] : null;
        if (!mentionedUser) return client.pushMessage(userId, { type: 'text', text: 'Usage: !unblacklistuser @username' });
        
        await db.removeUserFromBlacklist(groupId, mentionedUser.userId);
        const profile = await client.getProfile(mentionedUser.userId).catch(() => null);
        return client.pushMessage(userId, { type: 'text', text: `${profile ? profile.displayName : 'The user'} has been unblacklisted.` });
    } catch (err) {
        console.error("Error in handleUnblacklistUser:", err);
        return client.pushMessage(userId, { type: 'text', text: 'An error occurred while unblacklisting the user.' });
    }
}

async function handleStatusCommand(groupId, userId) {
    try {
        const settings = await db.getGroupSettings(groupId);
        const timeout = settings.password_timeout_minutes || DEFAULT_PASSWORD_TIMEOUT_MINUTES;
        const passwordStatus = settings.password ? `Enabled (Timeout: ${timeout}m)` : 'Disabled';

        let statusText = `--- Group Status Overview ---\n`;
        statusText += `Password Protection: ${passwordStatus}\n`;
        statusText += `Admins: ${settings.admins.length}\n`;
        statusText += `Blacklisted Words: ${settings.blacklist_words.length}\n`;
        statusText += `Blacklisted Users: ${settings.blacklist_users.length}`;

        return client.pushMessage(userId, { type: 'text', text: statusText });
    } catch (err) {
        console.error(`Error in handleStatusCommand:`, err);
        return client.pushMessage(userId, { type: 'text', text: 'Error fetching status.' });
    }
}

async function handleShowBlacklistWords(groupId, userId) {
    try {
        const settings = await db.getGroupSettings(groupId);
        let list = settings.blacklist_words.length > 0 ? settings.blacklist_words.join(', ') : 'None';
        if (list.length > MAX_REPLY_LENGTH) list = list.substring(0, MAX_REPLY_LENGTH) + `...`;
        return client.pushMessage(userId, { type: 'text', text: `--- Blacklisted Words (${settings.blacklist_words.length}) ---\n${list}` });
    } catch (err) {
        console.error("Error in handleShowBlacklistWords:", err);
        return client.pushMessage(userId, { type: 'text', text: 'An error occurred while fetching the word blacklist.' });
    }
}

async function handleShowBlacklistUsers(groupId, userId) {
    try {
        const settings = await db.getGroupSettings(groupId);
        let userListText = 'None';
        if (settings.blacklist_users.length > 0) {
            const profiles = await Promise.all(settings.blacklist_users.map(id => client.getProfile(id).catch(() => ({ displayName: `Unknown (ID: ${id})` }))));
            userListText = profiles.map(p => p.displayName).join(', ');
            if (userListText.length > MAX_REPLY_LENGTH) userListText = userListText.substring(0, MAX_REPLY_LENGTH) + `...`;
        }
        return client.pushMessage(userId, { type: 'text', text: `--- Blacklisted Users (${settings.blacklist_users.length}) ---\n${userListText}` });
    } catch (err) {
        console.error("Error in handleShowBlacklistUsers:", err);
        return client.pushMessage(userId, { type: 'text', text: 'An error occurred while fetching the user blacklist.' });
    }
}

// =================================================================
// 7. AUTOMATION & HELPER LOGIC
// =================================================================

async function handlePasswordAttempt(userId, message, replyToken) {
    const verificationData = pendingVerifications[userId];
    if (!verificationData) return;

    const { groupId, timeoutId } = verificationData;
    const settings = await db.getGroupSettings(groupId);

    clearTimeout(timeoutId);
    delete pendingVerifications[userId];

    if (message.type === 'text' && message.text === settings.password) {
        await client.replyMessage(replyToken, { type: 'text', text: 'Password accepted. Welcome!' });
    } else {
        await client.replyMessage(replyToken, { type: 'text', text: 'Incorrect password.' });
        await kickUser(groupId, userId, 'Incorrect password provided.');
    }
}

async function checkMessageForBlacklist(groupId, userId, text) {
    if (await db.isAdmin(groupId, userId)) return null;
    const settings = await db.getGroupSettings(groupId);
    const foundWord = settings.blacklist_words.find(word => text.toLowerCase().includes(word));
    if (foundWord) return kickUser(groupId, userId, `Used blacklisted word: '${foundWord}'`);
    return null;
}

async function kickUser(groupId, userId, reason) {
    try {
        console.log(`Kicking user ${userId}. Reason: ${reason}`);
        await client.kickGroupMember(groupId, userId);
    } catch (err) {
        console.error(`Failed to kick user ${userId}:`, err.originalError ? err.originalError.response.data : err);
    }
}

// =================================================================
// 8. DATABASE SCHEMA SETUP & SERVER START
// =================================================================
async function initializeDatabase() {
    const createTableQuery = `
        CREATE TABLE IF NOT EXISTS group_settings (
            group_id VARCHAR(255) PRIMARY KEY,
            admins TEXT[] DEFAULT '{}',
            password VARCHAR(255),
            password_timeout_minutes INTEGER DEFAULT ${DEFAULT_PASSWORD_TIMEOUT_MINUTES},
            blacklist_words TEXT[] DEFAULT '{}',
            blacklist_users TEXT[] DEFAULT '{}'
        );
    `;
    const poolForInit = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
    try {
        const dbClient = await poolForInit.connect();
        await dbClient.query(createTableQuery);
        await dbClient.query(`
            ALTER TABLE group_settings
            ADD COLUMN IF NOT EXISTS password_timeout_minutes INTEGER DEFAULT ${DEFAULT_PASSWORD_TIMEOUT_MINUTES};
        `).catch(e => console.log("Column already exists, skipping."));
        dbClient.release();
        console.log("Database table 'group_settings' is ready.");
    } catch (err) {
        console.error("Error initializing database table:", err);
        process.exit(1);
    } finally {
        await poolForInit.end();
    }
}

app.listen(PORT, () => {
    console.log(`Listening on port ${PORT}`);
    initializeDatabase();
});
