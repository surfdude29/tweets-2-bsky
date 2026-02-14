#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🔄 Tweets-2-Bsky Updater"
echo "========================="

CONFIG_FILE="$SCRIPT_DIR/config.json"
CONFIG_BACKUP=""

if [ -f "$CONFIG_FILE" ]; then
  CONFIG_BACKUP="$(mktemp "${TMPDIR:-/tmp}/tweets2bsky-config.XXXXXX")"
  cp "$CONFIG_FILE" "$CONFIG_BACKUP"
  echo "🛡️  Backed up config.json to protect local settings."
fi

restore_config() {
  if [ -n "$CONFIG_BACKUP" ] && [ -f "$CONFIG_BACKUP" ]; then
    cp "$CONFIG_BACKUP" "$CONFIG_FILE"
    rm -f "$CONFIG_BACKUP"
    echo "🔐 Restored config.json."
  fi
}

trap restore_config EXIT

if ! command -v git >/dev/null 2>&1; then
  echo "❌ Git is not installed. Please install git to update."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "❌ npm is not installed. Please install Node.js/npm to update."
  exit 1
fi

echo "⬇️  Pulling latest changes..."
if ! git pull --autostash; then
  echo "⚠️  Standard pull failed. Attempting to stash local changes and retry..."
  git stash push -u -m "tweets-2-bsky-update-autostash"
  if ! git pull; then
    echo "❌ Git pull failed even after stashing. Resolve conflicts manually and rerun ./update.sh."
    exit 1
  fi
fi

echo "📦 Installing dependencies..."
npm install

echo "🔧 Verifying native modules..."
if ! npm run rebuild:native; then
  echo "⚠️  rebuild:native failed (or missing). Falling back to direct better-sqlite3 rebuild..."
  if ! npm rebuild better-sqlite3; then
    npm rebuild better-sqlite3 --build-from-source
  fi
fi

echo "🏗️  Building server + web dashboard..."
npm run build

echo "✅ Update complete!"

if command -v pm2 >/dev/null 2>&1; then
  PROCESS_NAME="tweets-2-bsky"
  if pm2 describe twitter-mirror >/dev/null 2>&1; then
    PROCESS_NAME="twitter-mirror"
  elif pm2 describe tweets-2-bsky >/dev/null 2>&1; then
    PROCESS_NAME="tweets-2-bsky"
  fi

  echo "🔄 Restarting PM2 process '$PROCESS_NAME'..."
  if ! pm2 restart "$PROCESS_NAME" --update-env >/dev/null 2>&1; then
    echo "ℹ️  PM2 process '$PROCESS_NAME' not found or restart failed. Recreating..."
    pm2 delete "$PROCESS_NAME" >/dev/null 2>&1 || true
    pm2 start dist/index.js --name "$PROCESS_NAME"
  fi
  pm2 save
  echo "✅ PM2 process restarted and saved."
else
  echo "⚠️  PM2 not found. Please restart your application manually."
fi
