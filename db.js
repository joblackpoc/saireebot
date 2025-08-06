// db.js
// This file handles all interactions with the Postgres database.

const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

/**
 * Retrieves or creates settings for a group.
 * @param {string} groupId - The ID of the LINE group.
 * @returns {Promise<object>} The settings object for the group.
 */
async function getGroupSettings(groupId) {
    const findQuery = 'SELECT * FROM group_settings WHERE group_id = $1';
    const insertQuery = 'INSERT INTO group_settings (group_id) VALUES ($1) RETURNING *';

    const client = await pool.connect();
    try {
        let result = await client.query(findQuery, [groupId]);
        if (result.rows.length === 0) {
            console.log(`No settings found for group ${groupId}. Creating new entry.`);
            result = await client.query(insertQuery, [groupId]);
        }
        
        const settings = result.rows[0];

        // Ensure array fields are never null to prevent crashes.
        settings.admins = settings.admins || [];
        settings.blacklist_words = settings.blacklist_words || [];
        settings.blacklist_users = settings.blacklist_users || [];

        return settings;
    } finally {
        client.release();
    }
}

/**
 * Sets or removes the password for a group.
 * @param {string} groupId - The ID of the LINE group.
 * @param {string | null} password - The new password, or null to remove it.
 */
async function setPassword(groupId, password) {
    const query = 'UPDATE group_settings SET password = $1 WHERE group_id = $2';
    await pool.query(query, [password, groupId]);
}

/**
 * Sets the password verification timeout for a group.
 * @param {string} groupId - The ID of the LINE group.
 * @param {number} minutes - The timeout duration in minutes.
 */
async function setPasswordTimeout(groupId, minutes) {
    const query = 'UPDATE group_settings SET password_timeout_minutes = $1 WHERE group_id = $2';
    await pool.query(query, [minutes, groupId]);
}


/**
 * Checks if a user is an admin of a specific group.
 * @param {string} groupId - The ID of the LINE group.
 * @param {string} userId - The ID of the user to check.
 * @returns {Promise<boolean>} True if the user is an admin, false otherwise.
 */
async function isAdmin(groupId, userId) {
    const settings = await getGroupSettings(groupId);
    return settings.admins.includes(userId);
}

/**
 * Adds a new admin to a group's settings.
 * @param {string} groupId - The ID of the LINE group.
 * @param {string} newAdminId - The ID of the user to add as an admin.
 */
async function addAdmin(groupId, newAdminId) {
    const settings = await getGroupSettings(groupId);
    const currentAdmins = new Set(settings.admins);
    currentAdmins.add(newAdminId);
    const newAdminList = Array.from(currentAdmins);
    const query = 'UPDATE group_settings SET admins = $1 WHERE group_id = $2';
    await pool.query(query, [newAdminList, groupId]);
}

/**
 * Adds multiple words to the group's word blacklist.
 * @param {string} groupId - The ID of the LINE group.
 * @param {string[]} words - An array of words to add to the blacklist.
 */
async function addBlacklistWords(groupId, words) {
    const settings = await getGroupSettings(groupId);
    const currentWords = new Set(settings.blacklist_words);
    words.forEach(word => currentWords.add(word.toLowerCase()));
    const newWordList = Array.from(currentWords);
    const query = 'UPDATE group_settings SET blacklist_words = $1 WHERE group_id = $2';
    await pool.query(query, [newWordList, groupId]);
}

/**
 * Removes multiple words from the group's word blacklist.
 * @param {string} groupId - The ID of the LINE group.
 * @param {string[]} words - An array of words to remove from the blacklist.
 */
async function removeBlacklistWords(groupId, words) {
    const settings = await getGroupSettings(groupId);
    const lowercasedWordsToRemove = words.map(w => w.toLowerCase());
    const newWordList = settings.blacklist_words.filter(word => !lowercasedWordsToRemove.includes(word));
    const query = 'UPDATE group_settings SET blacklist_words = $1 WHERE group_id = $2';
    await pool.query(query, [newWordList, groupId]);
}

/**
 * Checks if a user is on the blacklist for a specific group.
 * @param {string} groupId - The ID of the LINE group.
 * @param {string} userId - The ID of the user to check.
 * @returns {Promise<boolean>} True if the user is blacklisted, false otherwise.
 */
async function isUserBlacklisted(groupId, userId) {
    const settings = await getGroupSettings(groupId);
    return settings.blacklist_users.includes(userId);
}

/**
 * Adds a user to the group's user blacklist.
 * @param {string} groupId - The ID of the LINE group.
 * @param {string} userId - The ID of the user to blacklist.
 */
async function addUserToBlacklist(groupId, userId) {
    const settings = await getGroupSettings(groupId);
    const currentUsers = new Set(settings.blacklist_users);
    currentUsers.add(userId);
    const newUserList = Array.from(currentUsers);
    const query = 'UPDATE group_settings SET blacklist_users = $1 WHERE group_id = $2';
    await pool.query(query, [newUserList, groupId]);
}

/**
 * Removes a user from the group's user blacklist.
 * @param {string} groupId - The ID of the LINE group.
 * @param {string} userId - The ID of the user to unblacklist.
 */
async function removeUserFromBlacklist(groupId, userId) {
    const settings = await getGroupSettings(groupId);
    const newUserList = settings.blacklist_users.filter(id => id !== userId);
    const query = 'UPDATE group_settings SET blacklist_users = $1 WHERE group_id = $2';
    await pool.query(query, [newUserList, groupId]);
}


module.exports = {
    getGroupSettings,
    setPassword,
    setPasswordTimeout,
    isAdmin,
    addAdmin,
    addBlacklistWords,
    removeBlacklistWords,
    isUserBlacklisted,
    addUserToBlacklist,
    removeUserFromBlacklist,
};
