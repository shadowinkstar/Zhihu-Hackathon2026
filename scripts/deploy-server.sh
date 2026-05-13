#!/usr/bin/env bash
set -Eeuo pipefail

# Deploy this Next.js app on a Linux server.
# Usage:
#   APP_PORT=3000 DEPLOY_BRANCH=master bash scripts/deploy-server.sh
#
# The script pulls the latest git code, installs dependencies, builds the app,
# stops the previous server process, and starts Next.js on a fixed public host/port.

APP_NAME="${APP_NAME:-gouwei-xudiao}"
APP_PORT="${APP_PORT:-3000}"
APP_HOST="${APP_HOST:-0.0.0.0}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-master}"
NEXT_DIST_DIR="${NEXT_DIST_DIR:-.next-build}"
STARTUP_TIMEOUT_SECONDS="${STARTUP_TIMEOUT_SECONDS:-30}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RUN_DIR="$APP_DIR/.deploy"
PID_FILE="$RUN_DIR/$APP_NAME.pid"
LOG_FILE="$RUN_DIR/$APP_NAME.log"
ERR_FILE="$RUN_DIR/$APP_NAME.err.log"
LOCK_DIR="$RUN_DIR/deploy.lock"
NEXT_BIN="$APP_DIR/node_modules/next/dist/bin/next"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

acquire_lock() {
  mkdir -p "$RUN_DIR"
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    fail "Another deploy is already running: $LOCK_DIR"
  fi
  trap 'rm -rf "$LOCK_DIR"' EXIT
}

current_pid_alive() {
  local pid="${1:-}"
  [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1
}

child_pids() {
  local pid="$1"
  pgrep -P "$pid" 2>/dev/null || true
}

terminate_process_tree() {
  local pid="${1:-}"
  [[ -n "$pid" ]] || return
  current_pid_alive "$pid" || return

  local children
  children="$(child_pids "$pid")"
  for child in $children; do
    terminate_process_tree "$child"
  done

  kill "$pid" >/dev/null 2>&1 || true
}

force_kill_process_tree() {
  local pid="${1:-}"
  [[ -n "$pid" ]] || return
  current_pid_alive "$pid" || return

  local children
  children="$(child_pids "$pid")"
  for child in $children; do
    force_kill_process_tree "$child"
  done

  kill -9 "$pid" >/dev/null 2>&1 || true
}

stop_existing_server() {
  if [[ ! -f "$PID_FILE" ]]; then
    return
  fi

  local pid
  pid="$(cat "$PID_FILE" || true)"
  if ! current_pid_alive "$pid"; then
    rm -f "$PID_FILE"
    return
  fi

  log "Stopping existing $APP_NAME process: $pid"
  terminate_process_tree "$pid"

  for _ in {1..20}; do
    if ! current_pid_alive "$pid"; then
      rm -f "$PID_FILE"
      return
    fi
    sleep 0.5
  done

  log "Existing process did not exit cleanly; forcing stop: $pid"
  force_kill_process_tree "$pid"
  rm -f "$PID_FILE"
}

process_command_line() {
  local pid="$1"
  tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null || true
}

stop_port_listeners() {
  local pids=""

  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -ti TCP:"$APP_PORT" -sTCP:LISTEN 2>/dev/null || true)"
  elif command -v fuser >/dev/null 2>&1; then
    pids="$(fuser -n tcp "$APP_PORT" 2>/dev/null || true)"
  elif command -v ss >/dev/null 2>&1; then
    pids="$(ss -ltnp "sport = :$APP_PORT" 2>/dev/null | sed -nE 's/.*pid=([0-9]+).*/\1/p' | sort -u)"
  fi

  if [[ -z "$pids" ]]; then
    return
  fi

  for pid in $pids; do
    if ! current_pid_alive "$pid"; then
      continue
    fi

    local command_line
    command_line="$(process_command_line "$pid")"
    if [[ "$command_line" != *"$APP_DIR"* && "$command_line" != *"next"* && "$command_line" != *"node"* && "$command_line" != *"npm"* ]]; then
      fail "Port $APP_PORT is already used by another process ($pid): $command_line"
    fi

    log "Stopping process listening on port $APP_PORT: $pid"
    terminate_process_tree "$pid"
  done

  for _ in {1..20}; do
    local still_alive=""
    for pid in $pids; do
      if current_pid_alive "$pid"; then
        still_alive="$still_alive $pid"
      fi
    done

    if [[ -z "$still_alive" ]]; then
      return
    fi

    sleep 0.5
  done

  for pid in $pids; do
    if current_pid_alive "$pid"; then
      log "Process still listening after graceful stop; forcing: $pid"
      force_kill_process_tree "$pid"
    fi
  done
}

pull_latest_code() {
  log "Fetching latest git refs"
  git fetch origin "$DEPLOY_BRANCH"

  local current_branch
  current_branch="$(git rev-parse --abbrev-ref HEAD)"
  if [[ "$current_branch" != "$DEPLOY_BRANCH" ]]; then
    log "Switching branch: $current_branch -> $DEPLOY_BRANCH"
    git checkout "$DEPLOY_BRANCH"
  fi

  log "Pulling latest code with fast-forward only"
  git pull --ff-only origin "$DEPLOY_BRANCH"
  log "Current commit: $(git rev-parse --short HEAD) $(git log -1 --pretty=%s)"
}

verify_source_routes() {
  local required_files=(
    "src/app/api/me/route.ts"
    "src/app/api/auth/zhihu/start/route.ts"
    "src/app/api/auth/zhihu/callback/route.ts"
  )

  for file in "${required_files[@]}"; do
    [[ -f "$file" ]] || fail "Required route source is missing after git pull: $file"
  done
}

install_dependencies() {
  if [[ -f package-lock.json ]]; then
    log "Installing dependencies with npm ci"
    npm ci
  else
    log "Installing dependencies with npm install"
    npm install
  fi
}

build_app() {
  log "Building Next.js app into $NEXT_DIST_DIR"
  if [[ "$NEXT_DIST_DIR" != ".next" ]]; then
    rm -rf .next
  fi
  NEXT_DIST_DIR="$NEXT_DIST_DIR" npm run build
}

verify_build_routes() {
  local manifest="$NEXT_DIST_DIR/server/app-paths-manifest.json"
  [[ -f "$manifest" ]] || fail "Build manifest is missing: $manifest"

  local required_routes=(
    '"/api/me/route"'
    '"/api/auth/zhihu/start/route"'
    '"/api/auth/zhihu/callback/route"'
  )

  for route in "${required_routes[@]}"; do
    grep -Fq "$route" "$manifest" || fail "Built app is missing route in manifest: $route"
  done

  log "Verified build routes in $manifest"
}

start_server() {
  mkdir -p "$RUN_DIR"
  : >"$LOG_FILE"
  : >"$ERR_FILE"

  log "Starting $APP_NAME on $APP_HOST:$APP_PORT"
  (
    cd "$APP_DIR"
    env \
      NODE_ENV=production \
      NEXT_DIST_DIR="$NEXT_DIST_DIR" \
      HOME="$HOME" \
      PATH="$PATH" \
      HOSTNAME="$APP_HOST" \
      PORT="$APP_PORT" \
      nohup node "$NEXT_BIN" start --hostname "$APP_HOST" --port "$APP_PORT" \
        >>"$LOG_FILE" 2>>"$ERR_FILE" &
    echo $! >"$PID_FILE"
  )

  local pid
  pid="$(cat "$PID_FILE")"
  log "Started process: $pid"
}

wait_until_ready() {
  local url="http://127.0.0.1:$APP_PORT"
  log "Waiting for server readiness: $url"

  for ((i = 1; i <= STARTUP_TIMEOUT_SECONDS; i++)); do
    if ! current_pid_alive "$(cat "$PID_FILE" 2>/dev/null || true)"; then
      tail -n 80 "$ERR_FILE" 2>/dev/null || true
      fail "Server process exited before becoming ready"
    fi

    if curl -fsS "$url" >/dev/null 2>&1; then
      log "Deployment complete: $url"
      log "Public bind: $APP_HOST:$APP_PORT"
      log "Logs: $LOG_FILE"
      return
    fi

    sleep 1
  done

  tail -n 80 "$LOG_FILE" 2>/dev/null || true
  tail -n 80 "$ERR_FILE" 2>/dev/null || true
  fail "Server did not become ready within ${STARTUP_TIMEOUT_SECONDS}s"
}

main() {
  require_command git
  require_command node
  require_command npm
  require_command curl

  acquire_lock
  cd "$APP_DIR"

  log "Deploying $APP_NAME from $APP_DIR"
  pull_latest_code
  verify_source_routes
  install_dependencies
  stop_existing_server
  stop_port_listeners
  build_app
  verify_build_routes
  start_server
  wait_until_ready
}

main "$@"
