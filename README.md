# 🐦 Tweets-2-Bsky

> **Note**: This project is built on top of [**bird**](https://github.com/steipete/bird) by [@steipete](https://github.com/steipete), which provides the core Twitter interaction capabilities.

A powerful tool to crosspost your Tweets to Bluesky automatically. Now features a **Web Dashboard** for easy management, **Multi-account support** for different owners, and **Custom PDS** hosting support.

## ✨ Features

- **Web Dashboard**: Modern interface to manage all your sync tasks.
- **Multi-User Mapping**: Let others add their accounts (e.g., Dan, Josh) with their own owners.
- **Multi-Account Support**: Sync Twitter A -> Bluesky A, Twitter B -> Bluesky B, etc.
- **Tailscale Ready**: Accessible over your local network or VPN.
- **Interactive CLI**: Manage everything from the terminal with `./crosspost`.
- **High Quality**: Supports threads, high-quality images, and videos.

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js** installed.
- A Twitter account (burner recommended) for global cookies.
- Bluesky account(s) with **App Passwords**.

### 2. Installation
```bash
git clone https://github.com/j4ckxyz/tweets-2-bsky.git
cd tweets-2-bsky
npm install
npm run build
```

### 3. Start Syncing & Web UI
```bash
# This starts both the sync daemon AND the web dashboard
npm start
```
By default, the web interface runs at **http://localhost:3000**. If you are using Tailscale, it's accessible at `http://your-tailscale-ip:3000`.

### 4. Setup (Web Dashboard)
1. Open the dashboard in your browser.
2. **Register** a new account (email/password).
3. Log in and go to **Global Twitter Config** to enter your cookies.
4. Use **Add New Mapping** to connect a Twitter handle to a Bluesky account.

---

## 🛠 Advanced Usage

### Disable Web Interface
If you only want to run the sync daemon without the web UI:
```bash
npm start -- --no-web
```

### Command Line Interface (CLI)
You can still manage everything via the terminal:
```bash
# Set Twitter cookies
./crosspost setup-twitter

# Add a mapping
./crosspost add-mapping

# List/Remove
./crosspost list
./crosspost remove
```

### Backfilling Old Tweets
```bash
# Example: Import the last 20 tweets for a user
npm run import -- --username YOUR_TWITTER_HANDLE --limit 20
```

---

## ⚙️ How to get Twitter Cookies
1. Log in to Twitter in your browser.
2. Open **Developer Tools** (F12) -> **Application** tab -> **Cookies**.
3. Copy `auth_token` and `ct0` values.

## ⚖️ License
MIT
