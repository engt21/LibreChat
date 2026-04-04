#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/sync-env.sh"

resolve_sync_env

PID_FILE="$LIBRECHAT_SYNC_STATE_DIR/watch.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "Watcher is not running"
  exit 0
fi

WATCH_PID="$(cat "$PID_FILE")"

if kill -0 "$WATCH_PID" >/dev/null 2>&1; then
  kill "$WATCH_PID"
  echo "Stopped watcher pid $WATCH_PID"
else
  echo "Watcher pid $WATCH_PID is not running"
fi

rm -f "$PID_FILE"
