#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/rail-env.sh"

REMOTE_SSH_TARGET="${LIBRECHAT_SYNC_REMOTE_SSH_TARGET:-timeng@192.168.50.4}"
SSH_KEY="${LIBRECHAT_SYNC_SSH_KEY:-$HOME/.ssh/id_rsa}"
REMOTE_REPO="${LIBRECHAT_SYNC_REMOTE_REPO:-/pool/home/timeng/LibreChat-custom}"
CONNECT_TIMEOUT="${LIBRECHAT_SYNC_CONNECT_TIMEOUT:-10}"

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
fail() { log "FATAL: $*" >&2; exit 1; }

ssh_cmd() {
  ssh -i "$SSH_KEY" \
    -o BatchMode=yes \
    -o StrictHostKeyChecking=accept-new \
    -o ConnectTimeout="$CONNECT_TIMEOUT" \
    "$REMOTE_SSH_TARGET" "$@"
}

rsync_down() {
  local remote_path="$1" local_path="$2"
  mkdir -p "$local_path"
  rsync -az --delete \
    -e "ssh -i $SSH_KEY -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=$CONNECT_TIMEOUT" \
    "$REMOTE_SSH_TARGET:$remote_path/" "$local_path/"
}

# ---------- preflight ----------
[[ -f "$SSH_KEY" ]] || fail "SSH key not found: $SSH_KEY"
ssh_cmd "echo ok" >/dev/null 2>&1 || fail "Cannot reach $REMOTE_SSH_TARGET"

resolve_librechat_rail "$ROOT_DIR" dev

# parse mongo credentials from the .env (same .env is shared by stable & dev)
MONGO_URI_LINE="$(ssh_cmd "grep '^MONGO_URI=' $REMOTE_REPO/.env" | head -1)"
USERPASS="$(echo "$MONGO_URI_LINE" | sed -n 's|.*mongodb://\([^@]*\)@.*|\1|p')"
MUSER="$(echo "$USERPASS" | cut -d: -f1)"
MPASS="$(echo "$USERPASS" | cut -d: -f2-)"
[[ -n "$MUSER" ]] || fail "Could not parse MongoDB credentials from remote .env"

# ---------- option parsing ----------
SKIP_RESTART=""
SKIP_MONGO=""
SKIP_FILES=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-restart) SKIP_RESTART=1; shift;;
    --skip-mongo)   SKIP_MONGO=1;   shift;;
    --skip-files)   SKIP_FILES=1;   shift;;
    *) fail "Unknown flag: $1";;
  esac
done

LOCAL_WAS_RUNNING=""
if docker compose -p "$COMPOSE_PROJECT_NAME" ps --status running --services 2>/dev/null | grep -q .; then
  LOCAL_WAS_RUNNING=1
fi

# ---------- MongoDB sync ----------
if [[ -z "$SKIP_MONGO" ]]; then
  log "Dumping MongoDB from Linux stable rail..."
  DUMP_FILE="/tmp/librechat-stable-dump-$$.archive"
  ssh_cmd "docker exec librechat-stable-mongodb mongodump --db LibreChat \
    -u $MUSER -p $MPASS --authenticationDatabase admin --archive --quiet" \
    > "$DUMP_FILE"
  DUMP_SIZE="$(du -h "$DUMP_FILE" | cut -f1)"
  log "Dump complete ($DUMP_SIZE)"

  if [[ -n "$LOCAL_WAS_RUNNING" ]]; then
    log "Restoring into running local MongoDB..."
    cat "$DUMP_FILE" | docker exec -i "$LIBRECHAT_MONGO_CONTAINER_NAME" \
      mongorestore --archive --drop --quiet
  else
    log "Starting MongoDB temporarily for restore..."
    docker compose -p "$COMPOSE_PROJECT_NAME" \
      -f "$ROOT_DIR/docker-compose.yml" \
      -f "$ROOT_DIR/docker-compose.local.override.yml" \
      up -d mongodb >/dev/null 2>&1
    sleep 5
    cat "$DUMP_FILE" | docker exec -i "$LIBRECHAT_MONGO_CONTAINER_NAME" \
      mongorestore --archive --drop --quiet
  fi
  rm -f "$DUMP_FILE"

  COUNTS="$(docker exec "$LIBRECHAT_MONGO_CONTAINER_NAME" mongosh --quiet LibreChat \
    --eval 'JSON.stringify({users:db.users.countDocuments(),conversations:db.conversations.countDocuments(),messages:db.messages.countDocuments(),files:db.files.countDocuments()})')"
  log "MongoDB restored: $COUNTS"
fi

# ---------- files sync ----------
if [[ -z "$SKIP_FILES" ]]; then
  log "Syncing images from Linux..."
  rsync_down "$REMOTE_REPO/images" "$ROOT_DIR/images"
  IMG_COUNT="$(find "$ROOT_DIR/images" -type f | wc -l)"
  log "Images synced: $IMG_COUNT files"

  log "Syncing uploads from Linux..."
  # Stable rail uses ./uploads; local dev rail mounts .rails/dev/uploads
  rsync_down "$REMOTE_REPO/uploads" "$LIBRECHAT_UPLOADS_DIR"
  UPL_COUNT="$(find "$LIBRECHAT_UPLOADS_DIR" -type f | wc -l)"
  log "Uploads synced: $UPL_COUNT files"
fi

# ---------- restart ----------
if [[ -n "$LOCAL_WAS_RUNNING" && -z "$SKIP_RESTART" ]]; then
  log "Restarting API and Meilisearch to pick up new data..."
  docker restart "${LIBRECHAT_MEILI_CONTAINER_NAME}" >/dev/null 2>&1 || true
  sleep 3
  docker restart "${LIBRECHAT_API_CONTAINER_NAME}" >/dev/null 2>&1
  sleep 10
  log "Local dev rail restarted"
fi

log "Sync from Linux stable complete."
