#!/usr/bin/env bash

set -euo pipefail

APP_NAME="tweets-2-bsky"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ENV_FILE="$SCRIPT_DIR/.env"
RUNTIME_DIR="$SCRIPT_DIR/data/runtime"
PID_FILE="$RUNTIME_DIR/${APP_NAME}.pid"
LOG_FILE="$RUNTIME_DIR/${APP_NAME}.log"

ACTION="install"
DO_INSTALL=1
DO_BUILD=1
DO_START=1
RUNNER="auto"
PORT_OVERRIDE=""
APP_PORT=""
ACTIVE_RUNNER=""
CREATED_JWT_SECRET=0

usage() {
  cat <<'USAGE'
Usage: ./install.sh [options]

Default behavior:
  - Installs dependencies
  - Builds server + web app
  - Starts in the background (PM2 if installed, otherwise nohup)
  - Prints local web URL

Options:
  --no-start        Install/build only (do not start background process)
  --start-only      Start background process only (skip install/build)
  --stop            Stop background process (PM2 and/or nohup)
  --status          Show background process status
  --pm2             Force PM2 runner
  --nohup           Force nohup runner
  --port <number>   Set or override PORT in .env
  --skip-install    Skip npm install
  --skip-build      Skip npm run build
  -h, --help        Show this help
USAGE
}

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command not found: $command_name"
    exit 1
  fi
}

is_valid_port() {
  local candidate="$1"
  [[ "$candidate" =~ ^[0-9]+$ ]] || return 1
  (( candidate >= 1 && candidate <= 65535 ))
}

get_env_value() {
  local key="$1"
  if [[ ! -f "$ENV_FILE" ]]; then
    return 0
  fi
  local line
  line="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    return 0
  fi
  printf '%s\n' "${line#*=}"
}

upsert_env_value() {
  local key="$1"
  local value="$2"
  touch "$ENV_FILE"
  local tmp_file
  tmp_file="$(mktemp)"
  awk -v key="$key" -v value="$value" '
    BEGIN { updated = 0 }
    $0 ~ ("^" key "=") {
      print key "=" value
      updated = 1
      next
    }
    { print }
    END {
      if (!updated) {
        print key "=" value
      }
    }
  ' "$ENV_FILE" > "$tmp_file"
  mv "$tmp_file" "$ENV_FILE"
}

ensure_env_defaults() {
  local existing_port
  existing_port="$(get_env_value PORT)"
  if [[ -n "$PORT_OVERRIDE" ]]; then
    APP_PORT="$PORT_OVERRIDE"
  elif [[ -n "$existing_port" ]]; then
    APP_PORT="$existing_port"
  else
    APP_PORT="3000"
  fi

  if ! is_valid_port "$APP_PORT"; then
    echo "Invalid port: $APP_PORT"
    exit 1
  fi

  if [[ -z "$existing_port" || -n "$PORT_OVERRIDE" ]]; then
    upsert_env_value PORT "$APP_PORT"
  fi

  local existing_secret
  existing_secret="$(get_env_value JWT_SECRET)"
  if [[ -z "$existing_secret" ]]; then
    local generated_secret
    generated_secret="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
    upsert_env_value JWT_SECRET "$generated_secret"
    CREATED_JWT_SECRET=1
  fi
}

ensure_build_artifacts() {
  if [[ ! -f "$SCRIPT_DIR/dist/index.js" ]]; then
    echo "Build output not found (dist/index.js). Running build now."
    npm run build
  fi
}

install_and_build() {
  if [[ "$DO_INSTALL" -eq 1 ]]; then
    echo "Installing dependencies"
    npm install
  fi

  if [[ "$DO_BUILD" -eq 1 ]]; then
    echo "Building server and web app"
    npm run build
  fi
}

stop_nohup_if_running() {
  if [[ ! -f "$PID_FILE" ]]; then
    return 1
  fi

  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -z "$pid" ]]; then
    rm -f "$PID_FILE"
    return 1
  fi

  if kill -0 "$pid" >/dev/null 2>&1; then
    kill "$pid" >/dev/null 2>&1 || true
    rm -f "$PID_FILE"
    return 0
  fi

  rm -f "$PID_FILE"
  return 1
}

start_with_nohup() {
  mkdir -p "$RUNTIME_DIR"
  stop_nohup_if_running >/dev/null 2>&1 || true

  echo "Starting with nohup"
  nohup npm start > "$LOG_FILE" 2>&1 &
  echo "$!" > "$PID_FILE"

  local pid
  pid="$(cat "$PID_FILE")"
  sleep 1
  if ! kill -0 "$pid" >/dev/null 2>&1; then
    echo "Failed to start background process with nohup."
    echo "Check logs: $LOG_FILE"
    exit 1
  fi
}

stop_pm2_if_running() {
  if ! command -v pm2 >/dev/null 2>&1; then
    return 1
  fi

  if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
    pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
    pm2 save >/dev/null 2>&1 || true
    return 0
  fi

  return 1
}

start_with_pm2() {
  echo "Starting with PM2"

  if pm2 describe "twitter-mirror" >/dev/null 2>&1; then
    pm2 delete "twitter-mirror" >/dev/null 2>&1 || true
  fi

  if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
    pm2 restart "$APP_NAME" --update-env >/dev/null 2>&1
  else
    pm2 start dist/index.js --name "$APP_NAME" --update-env >/dev/null 2>&1
  fi
  pm2 save >/dev/null 2>&1 || true
}

start_background() {
  local resolved_runner="$RUNNER"
  if [[ "$resolved_runner" == "auto" ]]; then
    if command -v pm2 >/dev/null 2>&1; then
      resolved_runner="pm2"
    else
      resolved_runner="nohup"
    fi
  fi

  case "$resolved_runner" in
    pm2)
      require_command pm2
      start_with_pm2
      ACTIVE_RUNNER="pm2"
      ;;
    nohup)
      start_with_nohup
      ACTIVE_RUNNER="nohup"
      ;;
    *)
      echo "Unsupported runner: $resolved_runner"
      exit 1
      ;;
  esac
}

wait_for_web() {
  if ! command -v curl >/dev/null 2>&1; then
    return 0
  fi

  local url="http://127.0.0.1:${APP_PORT}"
  local attempt
  for ((attempt = 1; attempt <= 30; attempt++)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  return 1
}

print_access_info() {
  echo ""
  echo "Setup complete."
  echo "Web app URL: http://localhost:${APP_PORT}"

  if [[ "$CREATED_JWT_SECRET" -eq 1 ]]; then
    echo "Generated JWT_SECRET in .env"
  fi

  if [[ "$ACTIVE_RUNNER" == "pm2" ]]; then
    echo "Process manager: PM2"
    echo "Status: pm2 status $APP_NAME"
    echo "Logs: pm2 logs $APP_NAME"
    echo "Stop: pm2 delete $APP_NAME"
  elif [[ "$ACTIVE_RUNNER" == "nohup" ]]; then
    echo "Process manager: nohup"
    echo "PID file: $PID_FILE"
    echo "Logs: tail -f $LOG_FILE"
    echo "Stop: ./install.sh --stop"
  fi

  if wait_for_web; then
    echo "Health check: OK"
  else
    echo "Health check: not ready yet (service may still be starting)"
  fi
}

show_status() {
  local found=0
  local configured_port
  configured_port="$(get_env_value PORT)"
  if [[ -n "$configured_port" ]]; then
    echo "Configured PORT: $configured_port"
  fi

  if command -v pm2 >/dev/null 2>&1 && pm2 describe "$APP_NAME" >/dev/null 2>&1; then
    found=1
    echo "PM2 process is running:"
    pm2 status "$APP_NAME"
  fi

  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
      found=1
      echo "nohup process is running with PID $pid"
      echo "Logs: $LOG_FILE"
    else
      echo "Found stale PID file at $PID_FILE"
    fi
  fi

  if [[ "$found" -eq 0 ]]; then
    echo "No running background process found for $APP_NAME"
  fi
}

stop_all() {
  local stopped=0
  if stop_pm2_if_running; then
    stopped=1
    echo "Stopped PM2 process: $APP_NAME"
  fi

  if stop_nohup_if_running; then
    stopped=1
    echo "Stopped nohup process from PID file"
  fi

  if [[ "$stopped" -eq 0 ]]; then
    echo "No running process found for $APP_NAME"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-start)
      DO_START=0
      ;;
    --start-only)
      ACTION="start"
      DO_INSTALL=0
      DO_BUILD=0
      DO_START=1
      ;;
    --stop)
      ACTION="stop"
      ;;
    --status)
      ACTION="status"
      ;;
    --pm2)
      RUNNER="pm2"
      ;;
    --nohup)
      RUNNER="nohup"
      ;;
    --port)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --port"
        exit 1
      fi
      PORT_OVERRIDE="$2"
      shift
      ;;
    --skip-install)
      DO_INSTALL=0
      ;;
    --skip-build)
      DO_BUILD=0
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
  shift
done

case "$ACTION" in
  stop)
    stop_all
    exit 0
    ;;
  status)
    show_status
    exit 0
    ;;
esac

require_command node
require_command npm

ensure_env_defaults

if [[ "$ACTION" == "install" ]]; then
  install_and_build
fi

if [[ "$DO_START" -eq 0 ]]; then
  echo "Install/build complete. Start later with: ./install.sh --start-only"
  echo "Configured web URL: http://localhost:${APP_PORT}"
  exit 0
fi

ensure_build_artifacts
start_background
print_access_info
