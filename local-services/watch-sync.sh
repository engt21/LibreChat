#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

POLL_INTERVAL="${LIBRECHAT_SYNC_POLL_INTERVAL:-300}"
STATE_DIR="$ROOT_DIR/.local-sync"
PID_FILE="$STATE_DIR/watch.pid"
LOG_FILE="$STATE_DIR/watch.log"
LAST_SYNC_FILE="$STATE_DIR/last_sync_timestamp"

mkdir -p "$STATE_DIR"

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG_FILE"; }

if [[ -f "$PID_FILE" ]]; then
  EXISTING_PID="$(cat "$PID_FILE")"
  if kill -0 "$EXISTING_PID" 2>/dev/null; then
    log "Watcher already running (pid $EXISTING_PID)"
    exit 0
  fi
fi

echo "$$" > "$PID_FILE"
trap 'rm -f "$PID_FILE"' EXIT

LAST_STATE="unknown"

while true; do
  REMOTE_SSH_TARGET="${LIBRECHAT_SYNC_REMOTE_SSH_TARGET:-timeng@192.168.50.4}"
  SSH_KEY="${LIBRECHAT_SYNC_SSH_KEY:-$HOME/.ssh/id_rsa}"

  if ssh -i "$SSH_KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 \
    "$REMOTE_SSH_TARGET" "echo ok" >/dev/null 2>&1; then

    if [[ "$LAST_STATE" != "reachable" ]]; then
      log "Linux source reachable -- triggering sync"
      if "$SCRIPT_DIR/sync-from-stable.sh" >>"$LOG_FILE" 2>&1; then
        log "Auto-sync completed successfully"
        date -u +%Y-%m-%dT%H:%M:%SZ > "$LAST_SYNC_FILE"
      else
        log "Auto-sync failed (exit $?); will retry next cycle"
      fi
    fi
    LAST_STATE="reachable"
  else
    if [[ "$LAST_STATE" == "reachable" ]]; then
      log "Linux source became unreachable"
    fi
    LAST_STATE="unreachable"
  fi

  sleep "$POLL_INTERVAL"
done
