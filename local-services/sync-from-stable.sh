#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/rail-env.sh"

REMOTE_SSH_TARGET="${LIBRECHAT_SYNC_REMOTE_SSH_TARGET:-timeng@192.168.50.4}"
SSH_KEY="${LIBRECHAT_SYNC_SSH_KEY:-$HOME/.ssh/id_rsa}"
REMOTE_REPO="${LIBRECHAT_SYNC_REMOTE_REPO:-/pool/home/timeng/LibreChat-custom}"
CONNECT_TIMEOUT="${LIBRECHAT_SYNC_CONNECT_TIMEOUT:-10}"

# Stable container names for local-direct mode.
STABLE_MONGO_CONTAINER="librechat-stable-mongodb"

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
fail() { log "FATAL: $*" >&2; exit 1; }

# ---------- mode detection ----------
# Local-direct mode: when the stable rail is on the same Docker host we can
# skip SSH entirely and use direct docker exec / local file access.  This is
# the correct default on this host where both rails coexist.
#
# Detection order:
#   1. Explicit LIBRECHAT_SYNC_LOCAL=true / false
#   2. The stable MongoDB container is reachable directly via docker exec
detect_local_mode() {
  if [[ "${LIBRECHAT_SYNC_LOCAL:-}" == "true" ]]; then
    return 0
  fi
  if [[ "${LIBRECHAT_SYNC_LOCAL:-}" == "false" ]]; then
    return 1
  fi
  # Auto-detect: if the stable Mongo container is accessible and the remote
  # repo path exists locally, we are on the same host.
  if docker inspect "$STABLE_MONGO_CONTAINER" >/dev/null 2>&1 \
     && [[ -d "$REMOTE_REPO" ]]; then
    return 0
  fi
  return 1
}

LOCAL_MODE=""
if detect_local_mode; then
  LOCAL_MODE=1
  log "Local-direct mode: stable and dev coexist on this host"
fi

# ---------- SSH helpers (remote mode only) ----------
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

local_rsync_down() {
  local source_path="$1" local_path="$2"
  mkdir -p "$local_path"
  rsync -a --delete "$source_path/" "$local_path/"
}

# ---------- preflight ----------
if [[ -z "$LOCAL_MODE" ]]; then
  [[ -f "$SSH_KEY" ]] || fail "SSH key not found: $SSH_KEY  (set LIBRECHAT_SYNC_LOCAL=true for same-host sync)"
  ssh_cmd "echo ok" >/dev/null 2>&1 || fail "Cannot reach $REMOTE_SSH_TARGET"
else
  docker inspect "$STABLE_MONGO_CONTAINER" >/dev/null 2>&1 \
    || fail "Stable MongoDB container '$STABLE_MONGO_CONTAINER' not running"
fi

resolve_librechat_rail "$ROOT_DIR" dev

# parse mongo credentials from the .env (same .env is shared by stable & dev)
if [[ -n "$LOCAL_MODE" ]]; then
  MONGO_URI_LINE="$(grep '^MONGO_URI=' "$REMOTE_REPO/.env" | head -1)"
else
  MONGO_URI_LINE="$(ssh_cmd "grep '^MONGO_URI=' $(printf '%q' "$REMOTE_REPO")/.env" | head -1)"
fi
USERPASS="$(echo "$MONGO_URI_LINE" | sed -n 's|.*mongodb://\([^@]*\)@.*|\1|p')"
MUSER="$(echo "$USERPASS" | cut -d: -f1)"
MPASS="$(echo "$USERPASS" | cut -d: -f2-)"
[[ -n "$MUSER" ]] || fail "Could not parse MongoDB credentials from .env"

# Shell-escape credentials so metacharacters in passwords don't break commands.
MUSER_ESC="$(printf '%q' "$MUSER")"
MPASS_ESC="$(printf '%q' "$MPASS")"

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
if docker compose -p "$COMPOSE_PROJECT_NAME" \
     -f "$ROOT_DIR/docker-compose.yml" \
     -f "$ROOT_DIR/docker-compose.local.override.yml" \
     ps --status running --services 2>/dev/null | grep -q .; then
  LOCAL_WAS_RUNNING=1
fi

# ---------- MongoDB sync ----------
if [[ -z "$SKIP_MONGO" ]]; then
  log "Dumping MongoDB from stable rail..."
  DUMP_FILE="/tmp/librechat-stable-dump-$$.archive"

  if [[ -n "$LOCAL_MODE" ]]; then
    # Use a separate container for mongodump to avoid exceeding the stable
    # MongoDB container's memory limit.  The temporary container connects
    # over the stable compose network, keeping the running mongod untouched.
    STABLE_MONGO_IMAGE="$(docker inspect "$STABLE_MONGO_CONTAINER" --format '{{.Config.Image}}')"
    STABLE_NETWORK="librechat-stable_default"
    docker run --rm \
      --network "$STABLE_NETWORK" \
      "$STABLE_MONGO_IMAGE" \
      mongodump --host mongodb:27017 --db LibreChat \
        -u "$MUSER" -p "$MPASS" --authenticationDatabase admin \
        --archive --quiet \
      > "$DUMP_FILE"
  else
    ssh_cmd "docker exec $STABLE_MONGO_CONTAINER mongodump --db LibreChat \
      -u ${MUSER_ESC} -p ${MPASS_ESC} --authenticationDatabase admin --archive --quiet" \
      > "$DUMP_FILE"
  fi

  DUMP_SIZE="$(du -h "$DUMP_FILE" | cut -f1)"
  log "Dump complete ($DUMP_SIZE)"

  STARTED_MONGO_TEMP=""
  DEV_NETWORK="${COMPOSE_PROJECT_NAME}_default"

  if [[ -z "$LOCAL_WAS_RUNNING" ]]; then
    log "Starting dev MongoDB temporarily for restore..."
    STARTED_MONGO_TEMP=1
    # Ensure dev data directories exist and have correct ownership before
    # starting dev MongoDB so it can initialize as the standard 999:999 user.
    prepare_librechat_rail_paths
    docker compose -p "$COMPOSE_PROJECT_NAME" \
      -f "$ROOT_DIR/docker-compose.yml" \
      -f "$ROOT_DIR/docker-compose.local.override.yml" \
      up -d mongodb >/dev/null 2>&1
    sleep 5
  else
    log "Restoring into running local dev MongoDB..."
  fi

  # Dev Mongo runs without auth, so no credentials are needed for restore.
  # Use a separate container for mongorestore to avoid exceeding the dev
  # MongoDB container's tight memory limit.
  DEV_MONGO_IMAGE="$(docker inspect "$LIBRECHAT_MONGO_CONTAINER_NAME" --format '{{.Config.Image}}')"
  docker run --rm -i \
    --network "$DEV_NETWORK" \
    "$DEV_MONGO_IMAGE" \
    mongorestore --host mongodb:27017 --archive --drop --quiet \
    < "$DUMP_FILE"

  rm -f "$DUMP_FILE"

  COUNTS="$(docker run --rm \
    --network "$DEV_NETWORK" \
    "$DEV_MONGO_IMAGE" \
    mongosh --host mongodb:27017 --quiet LibreChat \
    --eval 'JSON.stringify({users:db.users.countDocuments(),conversations:db.conversations.countDocuments(),messages:db.messages.countDocuments(),files:db.files.countDocuments()})')"
  log "MongoDB restored: $COUNTS"

  # Normalize dev MongoDB data permissions after restore so the container
  # user (999:999) can access WiredTiger files without root workarounds.
  prepare_librechat_rail_paths

  # Stop the temporary MongoDB if dev was not running before sync
  if [[ -n "$STARTED_MONGO_TEMP" ]]; then
    log "Stopping temporarily started dev MongoDB..."
    docker compose -p "$COMPOSE_PROJECT_NAME" \
      -f "$ROOT_DIR/docker-compose.yml" \
      -f "$ROOT_DIR/docker-compose.local.override.yml" \
      stop mongodb >/dev/null 2>&1
  fi
fi

# ---------- files sync ----------
if [[ -z "$SKIP_FILES" ]]; then
  log "Syncing images..."
  if [[ -n "$LOCAL_MODE" ]]; then
    local_rsync_down "$REMOTE_REPO/images" "$ROOT_DIR/images"
  else
    rsync_down "$REMOTE_REPO/images" "$ROOT_DIR/images"
  fi
  IMG_COUNT="$(find "$ROOT_DIR/images" -type f | wc -l)"
  log "Images synced: $IMG_COUNT files"

  log "Syncing uploads..."
  # Stable rail uses ./uploads; local dev rail mounts .rails/dev/uploads
  if [[ -n "$LOCAL_MODE" ]]; then
    local_rsync_down "$REMOTE_REPO/uploads" "$LIBRECHAT_UPLOADS_DIR"
  else
    rsync_down "$REMOTE_REPO/uploads" "$LIBRECHAT_UPLOADS_DIR"
  fi
  UPL_COUNT="$(find "$LIBRECHAT_UPLOADS_DIR" -type f | wc -l)"
  log "Uploads synced: $UPL_COUNT files"

  # Normalize ownership of synced files so dev containers can read them
  # without requiring root-user workarounds. Images are shared; uploads are
  # dev-rail-specific. Both must be readable by the API container user.
  log "Normalizing ownership of synced file directories..."
  chmod -R a+rX "$ROOT_DIR/images" 2>/dev/null || true
  chmod -R a+rX "$LIBRECHAT_UPLOADS_DIR" 2>/dev/null || true
fi

# ---------- restart ----------
if [[ -n "$LOCAL_WAS_RUNNING" && -z "$SKIP_RESTART" ]]; then
  log "Restarting dev API and Meilisearch to pick up new data..."
  docker restart "${LIBRECHAT_MEILI_CONTAINER_NAME}" >/dev/null 2>&1 || true
  sleep 3
  docker restart "${LIBRECHAT_API_CONTAINER_NAME}" >/dev/null 2>&1
  sleep 10
  log "Local dev rail restarted"
fi

log "Sync from stable complete."
