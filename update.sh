#!/bin/bash

echo "🔄 Tweets-2-Bsky Updater"
echo "========================="

# Check if git is available
if ! command -v git &> /dev/null; then
    echo "❌ Git is not installed. Please install git to update."
    exit 1
fi

echo "⬇️  Pulling latest changes..."
git pull

if [ $? -ne 0 ]; then
    echo "❌ Git pull failed. You might have local changes."
    echo "   Try 'git stash' to save your changes, then run this script again."
    exit 1
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
echo "⚠️  Please restart your application service now (e.g., 'pm2 restart tweets-2-bsky' or stop and start the node process)."
