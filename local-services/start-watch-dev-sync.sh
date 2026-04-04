#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/sync-env.sh"

resolve_sync_env

PID_FILE="$LIBRECHAT_SYNC_STATE_DIR/watch.pid"
LOG_FILE="${LIBRECHAT_SYNC_WATCH_LOG_FILE:-$LIBRECHAT_SYNC_STATE_DIR/watch.log}"

if [[ -f "$PID_FILE" ]]; then
  EXISTING_PID="$(cat "$PID_FILE")"
  if kill -0 "$EXISTING_PID" >/dev/null 2>&1; then
    echo "Watcher already running with pid $EXISTING_PID"
    exit 0
  fi
fi

nohup "$ROOT_DIR/local-services/watch-dev-sync.sh" >>"$LOG_FILE" 2>&1 &
sleep 1

if [[ -f "$PID_FILE" ]]; then
  echo "Started watcher with pid $(cat "$PID_FILE")"
else
  echo "Watcher did not create a pid file; check $LOG_FILE" >&2
  exit 1
fi
