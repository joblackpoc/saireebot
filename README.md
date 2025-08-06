# LINE Group Guardian Bot

A powerful, professional LINE bot for moderating and managing group chats. Built with Node.js and deployed on Heroku, it provides a robust set of admin-only commands to keep your group secure and clean.

## Features

- **Admin Role Management**: Securely designate one or more admins for the group.
- **Password Protection**: Require new members to enter a password via private message to join the group.
- **Customizable Timeout**: Admins can set a time limit for new members to enter the password before being automatically removed.
- **Word-Based Blacklist**: Automatically kicks any non-admin user who sends a message containing a blacklisted word.
- **User-Based Blacklist**: Permanently blacklist specific users (spammers, bots, abusive members) to prevent them from joining or speaking in the group.
- **Status Dashboard**: Admins can view a summary of all current settings and get detailed lists of blacklisted words and users.
- **Secure and Scalable**: Built on a professional stack (Node.js, Express, PostgreSQL) and designed for easy deployment on Heroku.

## Tech Stack

- **Backend**: Node.js, Express.js
- **Database**: PostgreSQL
- **Platform**: LINE Messaging API
- **Deployment**: Heroku

---

## Setup and Deployment Guide

Follow these steps to get your own instance of the bot running.

1.  **Clone the Repository**:
    ```bash
    git clone <your-repository-url>
    cd <repository-folder>
    ```

2.  **Install Dependencies**:
    ```bash
    npm install
    ```

3.  **Create a LINE Bot**:
    - Go to the [LINE Developers Console](https://developers.line.biz/en/).
    - Create a new **Provider**.
    - Create a new **Channel** under that provider, selecting **"Messaging API"**.
    - Fill out the bot's details (name, icon, etc.).

4.  **Deploy to Heroku**:
    - Sign up for a [Heroku](https://www.heroku.com/) account and install the [Heroku CLI](https://devcenter.heroku.com/articles/heroku-cli).
    - Log in via the terminal: `heroku login`
    - Create a new Heroku app: `heroku create your-unique-bot-name`
    - Add the Heroku remote to your git repository: `heroku git:remote -a your-unique-bot-name`
    - Push the code to deploy: `git push heroku main`

5.  **Add PostgreSQL Database**:
    - In your terminal, add the Heroku Postgres add-on to your app:
      ```bash
      heroku addons:create heroku-postgresql:hobby-dev -a your-unique-bot-name
      ```
    - Heroku will automatically set the `DATABASE_URL` for you.

6.  **Set Heroku Environment Variables**:
    - Go to your Heroku App Dashboard -> Settings -> "Reveal Config Vars".
    - Add the following two variables from your LINE Developers Console:
      - `CHANNEL_ACCESS_TOKEN`: Found on the "Messaging API" tab.
      - `CHANNEL_SECRET`: Found on the "Basic settings" tab.

7.  **Configure LINE Webhook**:
    - In your LINE Developers Console, go to the "Messaging API" tab.
    - Set the **Webhook URL** to `https://your-unique-bot-name.herokuapp.com/webhook`.
    - Click **"Verify"** to ensure it connects successfully.
    - **Enable** "Use webhook".
    - **Disable** "Auto-reply messages" and "Greeting messages" under "LINE Official Account features".

8.  **Invite the Bot**:
    - Add your bot as a friend on LINE using its QR code or LINE ID (found on the "Messaging API" tab).
    - Invite the bot into the group you wish to manage.

---

## User Manual

### Initial Setup

The first person to use the `!setadmin` command in a new group automatically becomes the **first admin**. This is a one-time event. After that, only existing admins can add new admins.

**Example:**
To become the first admin, simply type:
`!setadmin`

### Command List

All commands are **Admin-Only**, with the exception of the very first `!setadmin` command. Commands sent by non-admins will be silently ignored.

#### `!setadmin`
- **Description**: Adds the mentioned user as a new admin.
- **Example**: `!setadmin @JaneDoe`

#### `!status`
- **Description**: Displays a quick overview of all group settings, including password status, timeout, and blacklist counts.
- **Example**: `!status`

#### `!help`
- **Description**: Shows the list of available commands.
- **Example**: `!help`

#### `!setpassword`
- **Description**: Sets a password for the group. New members must provide this password in a private message to the bot. Use `off` to disable password protection.
- **Example**: `!setpassword MySecret123` or `!setpassword off`

#### `!setpasswordtimeout`
- **Description**: Sets the time limit (in minutes) that a new user has to enter the password before being kicked.
- **Example**: `!setpasswordtimeout 120` (sets the timeout to 2 hours)

#### `!showblacklistwords`
- **Description**: Shows the full list of blacklisted words.
- **Example**: `!showblacklistwords`

#### `!showblacklistusers`
- **Description**: Shows the full list of blacklisted users.
- **Example**: `!showblacklistusers`

#### `!addblacklist`
- **Description**: Adds one or more words (separated by spaces) to the word-based blacklist.
- **Example**: `!addblacklist crypto sale forex`

#### `!removeblacklist`
- **Description**: Removes one or more words (separated by spaces) from the word-based blacklist.
- **Example**: `!removeblacklist sale forex`

#### `!blacklistuser`
- **Description**: Adds a user to the permanent user blacklist and kicks them from the group.
- **Example**: `!blacklistuser @SpamBot`

#### `!unblacklistuser`
- **Description**: Removes a user from the user blacklist, allowing them to rejoin.
- **Example**: `!unblacklistuser @SpamBot`
