#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/sync-env.sh"

resolve_sync_env

INCOMING_DIR="${1:-}"
[[ -n "$INCOMING_DIR" ]] || sync_fail "Usage: $(basename "$0") <incoming-bundle-dir>"
[[ -d "$INCOMING_DIR" ]] || sync_fail "Incoming bundle directory not found: $INCOMING_DIR"

mkdir -p "$LIBRECHAT_SYNC_REMOTE_CONFLICTS_DIR"

if dev_services_running; then
  sync_log "Dev services are running; reporting remote_active"
  printf 'status=%s\n' "remote_active"
  printf 'current_token=%s\n' "$(read_current_token)"
  exit 0
fi

sync_log "Refreshing authoritative bundle snapshot..."
CURRENT_TOKEN="$(refresh_authoritative_bundle)"
sync_log "Authoritative token: ${CURRENT_TOKEN:-(empty)}"

load_bundle_metadata "$INCOMING_DIR"
INCOMING_BASE_TOKEN="${LIBRECHAT_SYNC_BASE_TOKEN:-}"
INCOMING_HASH="${LIBRECHAT_SYNC_HASH:-}"
INCOMING_MACHINE_ID="${LIBRECHAT_SYNC_MACHINE_ID:-unknown}"
INCOMING_CREATED_AT="${LIBRECHAT_SYNC_CREATED_AT:-unknown}"

sync_log "Incoming bundle: base_token=${INCOMING_BASE_TOKEN:-(empty)} machine=${INCOMING_MACHINE_ID} created=${INCOMING_CREATED_AT}"

if [[ -n "$CURRENT_TOKEN" && "$INCOMING_BASE_TOKEN" != "$CURRENT_TOKEN" ]]; then
  ARCHIVE_DIR="$LIBRECHAT_SYNC_REMOTE_CONFLICTS_DIR/${INCOMING_CREATED_AT}-${INCOMING_MACHINE_ID}"
  copy_bundle_dir "$INCOMING_DIR" "$ARCHIVE_DIR"
  sync_log "Token mismatch: incoming base_token=${INCOMING_BASE_TOKEN} != current=${CURRENT_TOKEN}; archived to $ARCHIVE_DIR"
  printf 'status=%s\n' "remote_newer"
  printf 'current_token=%s\n' "$CURRENT_TOKEN"
  printf 'conflict_dir=%s\n' "$ARCHIVE_DIR"
  exit 0
fi

sync_log "Importing bundle into dev state..."
"$ROOT_DIR/local-services/import-dev-bundle.sh" "$INCOMING_DIR"

NEW_TOKEN="$(generate_sync_token "$INCOMING_MACHINE_ID")"
write_bundle_metadata "$INCOMING_DIR" "$NEW_TOKEN" "$INCOMING_BASE_TOKEN" "$INCOMING_HASH" "$INCOMING_CREATED_AT" "accepted-roadcopy"
copy_bundle_dir "$INCOMING_DIR" "$(authoritative_bundle_dir)"
write_current_token "$NEW_TOKEN"

sync_log "Apply complete: status=accepted new_token=$NEW_TOKEN"
printf 'status=%s\n' "accepted"
printf 'current_token=%s\n' "$NEW_TOKEN"
