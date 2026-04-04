#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/sync-env.sh"

resolve_sync_env

PID_FILE="$LIBRECHAT_SYNC_STATE_DIR/watch.pid"
LOG_FILE="${LIBRECHAT_SYNC_WATCH_LOG_FILE:-$LIBRECHAT_SYNC_STATE_DIR/watch.log}"

if [[ -f "$PID_FILE" ]]; then
  EXISTING_PID="$(cat "$PID_FILE")"
  if kill -0 "$EXISTING_PID" >/dev/null 2>&1; then
    sync_log "Watcher already running with pid $EXISTING_PID"
    exit 0
  fi
fi

echo "$$" > "$PID_FILE"
trap 'rm -f "$PID_FILE"' EXIT

LAST_STATE="unknown"
SYNC_PENDING="true"

while true; do
  if sync_remote_available; then
    if [[ "$LAST_STATE" != "reachable" ]]; then
      sync_log "Remote source reachable; starting automatic dev sync." | tee -a "$LOG_FILE"
    fi

    if [[ "$LAST_STATE" != "reachable" || "$SYNC_PENDING" == "true" ]]; then
      if "$ROOT_DIR/local-services/sync-dev-with-remote.sh" >>"$LOG_FILE" 2>&1; then
        sync_log "Automatic dev sync completed." | tee -a "$LOG_FILE"
        SYNC_PENDING="false"
      else
        SYNC_EXIT_CODE="$?"
        if [[ "$SYNC_EXIT_CODE" -eq 11 ]]; then
          sync_log "Automatic dev sync deferred because the Linux source dev rail is active." | tee -a "$LOG_FILE"
          SYNC_PENDING="true"
        else
          sync_log "Automatic dev sync failed; will retry on the next reachability transition." | tee -a "$LOG_FILE"
          SYNC_PENDING="false"
        fi
      fi
    fi
    LAST_STATE="reachable"
  else
    LAST_STATE="unreachable"
    SYNC_PENDING="true"
  fi

  sleep "$LIBRECHAT_SYNC_POLL_INTERVAL_SECONDS"
done
