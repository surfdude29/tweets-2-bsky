# Tweets-2-Bsky

A powerful tool to crosspost Tweets to Bluesky, supporting threads, videos, and high-quality images.

## Features

- 🔄 **Crossposting**: Automatically mirrors your Tweets to Bluesky.
- 🧵 **Thread Support**: INTELLIGENTLY handles threads, posting them as Bluesky threads.
- 📹 **Video & GIF Support**: Downloads and uploads videos/GIFs natively to Bluesky (not just links!).
- 🖼️ **High-Quality Images**: Fetches the highest resolution images available.
- 🔗 **Smart Link Expansion**: Resolves `t.co` links to their original URLs.
- 👥 **Multiple Source Accounts**: Map multiple Twitter accounts to a single Bluesky profile.
- ⚙️ **Web Dashboard**: Manage accounts, view status, and trigger runs via a modern UI.
- 🛠️ **CLI & Web Support**: Use the command line or the web interface.

## Quick Start

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/yourusername/tweets-2-bsky.git
    cd tweets-2-bsky
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Build the project:**
    ```bash
    npm run build
    ```

4.  **Start the server:**
    ```bash
    npm start
    ```
    Access the dashboard at `http://localhost:3000`.

## Updating

To update to the latest version without losing your configuration:

```bash
./update.sh
```

This script will pull the latest code, install dependencies, and rebuild the project. **Restart your application** after running the update.

## Configuration & Security

### Environment Variables

Create a `.env` file for security (optional but recommended):

```env
PORT=3000
JWT_SECRET=your-super-secret-key-change-this
```

> **⚠️ Security Note:** If you do not set `JWT_SECRET`, a fallback secret is used. For production or public-facing deployments, **YOU MUST SET A STRONG SECRET**.

### Data Storage

- **`config.json`**: Stores your account mappings and encrypted web user passwords. Note that Bluesky app passwords are stored in plain text here to facilitate automated login. **Do not share this file.**
- **`data/database.sqlite`**: Stores the history of processed tweets to prevent duplicates.

## Usage

### Web Interface

1.  Register your first account (this user becomes the **Admin**).
2.  Go to settings to configure your Twitter Auth Token and CT0 (cookies).
3.  Add mappings:
    *   Enter one or more **Twitter Usernames** (comma-separated).
    *   Enter your **Bluesky Handle** and **App Password**.
4.  The system will check for new tweets every 5 minutes (configurable).

### CLI

- **Add Mapping**: `npm run cli add-mapping`
- **Edit Mapping**: `npm run cli edit-mapping`
- **Import History**: `npm run cli import-history`
- **List Accounts**: `npm run cli list`

## Twitter Cookies (Auth)

You need your Twitter `auth_token` and `ct0` cookies.
1.  Log in to Twitter/X in your browser.
2.  Open Developer Tools (F12) -> Application -> Cookies.
3.  Copy the values for `auth_token` and `ct0`.

## License

MIT