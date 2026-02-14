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
./install.sh --host 127.0.0.1
./install.sh --skip-native-rebuild
```

If you prefer full manual setup, skip to [Manual Setup](#manual-setup-technical).

## Linux VPS Without Domain (Secure HTTPS via Tailscale)

If you host on a public VPS (Linux) and do not own a domain, use the server installer:

```bash
chmod +x install-server.sh
./install-server.sh
```

What this does:

- runs the normal app install/build/start flow
- auto-selects a free local app port if your chosen/default port is already in use
- forces the app to bind locally only (`HOST=127.0.0.1`)
- installs and starts Tailscale if needed
- configures `tailscale serve` on a free HTTPS port so your dashboard is reachable over Tailnet HTTPS
- prints the final Tailnet URL to open from any device authenticated on your Tailscale account

Optional non-interactive login:

```bash
./install-server.sh --auth-key <TS_AUTHKEY>
```

Optional fixed Tailscale HTTPS port:

```bash
./install-server.sh --https-port 443
```

Optional public exposure (internet) with Funnel:

```bash
./install-server.sh --funnel
```

Notes:

- this does **not** replace or delete `install.sh`; it wraps server-hardening around it
- normal updates still use `./update.sh` and keep your local `.env` values
- if you already installed manually, this is still safe to run later

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
# Optional: auth token lifetime (jsonwebtoken format), default is 30d.
# JWT_EXPIRES_IN=30d
# Optional: comma-separated browser origins allowed to call the API.
# Leave unset to allow all origins (default/backward-compatible).
# CORS_ALLOWED_ORIGINS=https://your-tailnet-host.ts.net,https://localhost:3000
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

- stashes local uncommitted changes before pull and restores them after update
- pulls latest code (supports non-`origin` remotes and detached-head recovery)
- installs dependencies
- rebuilds native modules when Node ABI changed
- builds server + web dashboard
- restarts existing runtime for PM2 **or** nohup mode
- preserves local `config.json` and `.env` with backup/restore

Useful update flags:

```bash
./update.sh --no-restart
./update.sh --skip-install --skip-build
./update.sh --remote origin --branch main
```

## Data, Config, and Security

Local files:

- `config.json`: mappings, credentials, users, app settings (sensitive; do not share)
- `data/database.sqlite`: processed tweet history and metadata
- `data/.jwt-secret`: auto-generated local JWT signing key when `JWT_SECRET` is not set (sensitive; keep private)
- `.env`: runtime environment variables (`PORT`, `JWT_SECRET`, `JWT_EXPIRES_IN`, optional overrides)

Security notes:

- first registered dashboard user is admin
- after bootstrap, only admins can create additional dashboard users
- users can sign in with username or email
- non-admin users only see mappings they created by default
- admins can grant fine-grained permissions (view all mappings, manage groups, queue backfills, run-now, etc.)
- only admins can view or edit Twitter/AI provider credentials
- admin user management never exposes other users' password hashes in the UI
- if `JWT_SECRET` is missing, server generates and persists a strong secret in `data/.jwt-secret` so sessions survive restarts
- set `JWT_SECRET` in `.env` if you prefer explicit secret management across hosts
- auth tokens default to `30d` expiry (`JWT_EXPIRES_IN`), configurable via `.env`
- auth endpoints (`/api/login`, `/api/register`) are rate-limited per IP to reduce brute-force risk
- prefer Bluesky app passwords (not your full account password)

### Multi-User Access Control

- bootstrap account:
  - the first account created through the web UI becomes admin
  - open registration is automatically disabled after this
- admin capabilities:
  - create, edit, reset password, and delete dashboard users
  - assign role (`admin` or `user`) and per-user permissions
  - filter the Accounts page by creator to review each user's mappings
- deleting a user:
  - disables that user's mappings so crossposting stops
  - leaves already-published Bluesky posts untouched
- self-service security:
  - every user can change their own password
  - users can change their own email after password verification

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
