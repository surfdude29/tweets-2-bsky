# Tweets to Bluesky Crossposter

A powerful, set-and-forget tool to mirror your Twitter/X account to Bluesky.

## Features

*   **Smart Media Handling:**
    *   Uploads **High-Res Images** with correct aspect ratios.
    *   Uploads **Videos** (up to 100MB) directly to Bluesky.
    *   Links back to the original tweet for media that cannot be uploaded.
    *   Removes `t.co` links from text for a clean look.
*   **Threading & Replies:**
    *   Automatically threads your posts on Bluesky if you reply to yourself on Twitter.
    *   Filters out replies to others (keeps your feed clean).
    *   Supports **Quote Tweets** (embeds the quoted post if it was also crossposted).
*   **History Import:**
    *   `--import-history` command to backfill your timeline.
    *   Posts in chronological order (Oldest → Newest).
    *   Preserves original timestamps.
    *   Human-like pacing to avoid rate limits/bans.
*   **Safety:**
    *   Configurable "Target User" so you can use a "burner" account's cookies to scrape your main account (avoids risk to your main account).

## Setup

### 1. Installation

```bash
git clone https://github.com/yourusername/tweets-2-bsky.git
cd tweets-2-bsky
npm install
```

### 2. Configuration (`.env`)

Copy the `.env` file and fill in your details:

```bash
# Twitter Cookies (See below)
TWITTER_AUTH_TOKEN=...
TWITTER_CT0=...

# OPTIONAL: Use a separate account's cookies to fetch tweets
# This is SAFER. Log in with an alt account, get cookies, 
# and set the username of the account you want to copy here.
TWITTER_TARGET_USERNAME=jack

# Bluesky Credentials
BLUESKY_IDENTIFIER=user.bsky.social
BLUESKY_PASSWORD=xxxx-xxxx-xxxx-xxxx # App Password
```

**How to get Twitter Cookies:**
1.  Log in to [x.com](https://x.com) (preferably with an alt account).
2.  Press `F12` -> **Application** (tab) -> **Cookies** (sidebar).
3.  Copy the values for `auth_token` and `ct0`.

### 3. Usage

**Run 24/7 (Daemon Mode):**
Checks every 5 minutes.
```bash
node index.js
```
*Tip: Use `pm2` to keep it running on a server.*

**Import History:**
```bash
node index.js --import-history
```

## Running on a VPS (Ubuntu/Linux)

To run this continuously:

1.  **Install PM2:**
    ```bash
    sudo npm install -g pm2
    ```
2.  **Start the script:**
    ```bash
    pm2 start index.js --name "twitter-mirror"
    ```
3.  **Save startup config:**
    ```bash
    pm2 startup
    pm2 save
    ```