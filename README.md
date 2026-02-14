# tweets-2-bsky

Crosspost posts from Twitter/X to Bluesky with thread support, media handling, account mapping, and a web dashboard.

## Quick Start (Easy Mode)

If you are comfortable with terminal basics but do not want to manage PM2 manually, use the installer script.

### 1) Clone the repo

```bash
git clone https://github.com/j4ckxyz/tweets-2-bsky
cd tweets-2-bsky
```

### 2) Run install + background start

```bash
chmod +x install.sh
./install.sh
```

What this does by default:

- installs dependencies
- builds server + web dashboard
- creates/updates `.env` with sensible defaults (`PORT=3000`, generated `JWT_SECRET` if missing)
- starts in the background
  - uses PM2 if installed
  - otherwise uses `nohup`
- prints your local web URL (for example `http://localhost:3000`)

### 3) Open the dashboard

Open the printed URL in your browser, then:

1. Register the first user (this user becomes admin).
2. Add Twitter cookies in Settings.
3. Add at least one mapping.
4. Click `Run now`.

### Useful installer commands

```bash
./install.sh --no-start
./install.sh --start-only
./install.sh --stop
./install.sh --status
./install.sh --port 3100
```

If you prefer full manual setup, skip to [Manual Setup](#manual-setup-technical).

## What This Project Does

- crossposts tweets and threads to Bluesky
- handles images, videos, GIFs, quote tweets, and link cards
- stores processed history in SQLite to avoid reposting
- supports multiple Twitter source usernames per Bluesky target
- provides both:
  - web dashboard workflows
  - CLI workflows (including cron-friendly mode)

## Requirements

- Node.js 22+
- npm
- git

Optional but recommended:

- PM2 (for managed background runtime)
- Chrome/Chromium (used for some quote-tweet screenshot fallbacks)
- build tools for native modules (`better-sqlite3`) if your platform needs source compilation

## Manual Setup (Technical)

### Standard run (foreground)

```bash
git clone https://github.com/j4ckxyz/tweets-2-bsky
cd tweets-2-bsky
npm install
npm run build
npm start
```

Open: [http://localhost:3000](http://localhost:3000)

### Set environment values explicitly

```bash
cat > .env <<'EOF'
PORT=3000
JWT_SECRET=replace-with-a-strong-random-secret
EOF
```

### Rebuild native modules after Node version changes

```bash
npm run rebuild:native
npm run build
```

## First-Time Setup via CLI (Alternative to Web Forms)

```bash
npm run cli -- setup-twitter
npm run cli -- add-mapping
npm run cli -- run-now
```

## Recommended Command Examples

Always invoke CLI commands as:

```bash
npm run cli -- <command>
```

### Status and basic operations

```bash
npm run cli -- status
npm run cli -- list
npm run cli -- recent-activity --limit 20
```

### Credentials and configuration

```bash
npm run cli -- setup-twitter
npm run cli -- setup-ai
npm run cli -- set-interval 5
```

### Mapping management

```bash
npm run cli -- add-mapping
npm run cli -- edit-mapping <mapping-id-or-handle>
npm run cli -- remove <mapping-id-or-handle>
```

### Running syncs

```bash
npm run cli -- run-now
npm run cli -- run-now --dry-run
npm run cli -- run-now --web
```

### Backfill and history import

```bash
npm run cli -- backfill <mapping-id-or-handle> --limit 50
npm run cli -- import-history <mapping-id-or-handle> --limit 100
npm run cli -- clear-cache <mapping-id-or-handle>
```

### Dangerous operation (admin workflow)

```bash
npm run cli -- delete-all-posts <mapping-id-or-handle>
```

### Config export/import

```bash
npm run cli -- config-export ./tweets-2-bsky-config.json
npm run cli -- config-import ./tweets-2-bsky-config.json
```

Mapping references accept:

- mapping ID
- Bluesky handle/identifier
- Twitter username

## Cron / CLI-Only Operation

Run every 5 minutes:

```cron
*/5 * * * * cd /path/to/tweets-2-bsky && /usr/bin/npm run cli -- run-now >> /tmp/tweets-2-bsky.log 2>&1
```

Run one backfill once:

```bash
npm run cli -- backfill <mapping-id-or-handle> --limit 50
```

## Background Runtime Options

### Option A: use `install.sh` (recommended)

```bash
./install.sh
./install.sh --status
./install.sh --stop
```

### Option B: manage PM2 directly

```bash
pm2 start dist/index.js --name tweets-2-bsky
pm2 logs tweets-2-bsky
pm2 restart tweets-2-bsky --update-env
pm2 save
```

### Option C: no PM2 (nohup)

```bash
mkdir -p data/runtime
nohup npm start > data/runtime/tweets-2-bsky.log 2>&1 &
echo $! > data/runtime/tweets-2-bsky.pid
```

Stop nohup process:

```bash
kill "$(cat data/runtime/tweets-2-bsky.pid)"
```

## Updating

Use:

```bash
./update.sh
```

`update.sh`:

- pulls latest code
- installs dependencies
- rebuilds native modules
- builds server + web dashboard
- restarts PM2 process when PM2 is available
- preserves local `config.json` with backup/restore

## Data, Config, and Security

Local files:

- `config.json`: mappings, credentials, users, app settings (sensitive; do not share)
- `data/database.sqlite`: processed tweet history and metadata
- `.env`: runtime environment variables (`PORT`, `JWT_SECRET`, optional overrides)

Security notes:

- first registered dashboard user is admin
- if `JWT_SECRET` is missing, server falls back to an insecure default; set your own secret in `.env`
- prefer Bluesky app passwords (not your full account password)

## Development

### Start backend/scheduler from source

```bash
npm run dev
```

### Start Vite web dev server

```bash
npm run dev:web
```

### Build and quality checks

```bash
npm run build
npm run typecheck
npm run lint
```

## Troubleshooting

See: `TROUBLESHOOTING.md`

Common recovery after changing Node versions:

```bash
npm run rebuild:native
npm run build
npm start
```

## License

MIT
