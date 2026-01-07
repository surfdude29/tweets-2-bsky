#!/bin/bash

echo "🔄 Tweets-2-Bsky Updater"
echo "========================="

# Check if git is available
if ! command -v git &> /dev/null; then
    echo "❌ Git is not installed. Please install git to update."
    exit 1
fi

echo "⬇️  Pulling latest changes..."
# Attempt to pull with autostash to handle local changes gracefully
if ! git pull --autostash; then
    echo "⚠️  Standard pull failed. Attempting to stash local changes and retry..."
    git stash
    if ! git pull; then
        echo "❌ Git pull failed even after stashing. You might have complex local changes."
        echo "   Please check 'git status' and resolve conflicts manually."
        exit 1
    fi
fi

echo "📦 Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ npm install failed."
    exit 1
fi

echo "🏗️  Building project..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Build failed."
    exit 1
fi

echo "✅ Update complete!"

# Determine PM2 process name (default to 'tweets-2-bsky' if not found)
PROCESS_NAME="tweets-2-bsky"
if pm2 describe twitter-mirror &> /dev/null; then
    PROCESS_NAME="twitter-mirror"
fi

if command -v pm2 &> /dev/null; then
    echo "🔄 Hard restarting PM2 process '$PROCESS_NAME' to fix environment paths..."
    pm2 delete $PROCESS_NAME
    pm2 start dist/index.js --name $PROCESS_NAME
    pm2 save
    echo "✅ PM2 process restarted and saved."
else
    echo "⚠️  PM2 not found. Please restart your application manually."
fi