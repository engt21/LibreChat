#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/sync-env.sh"

resolve_sync_env
ensure_sync_filesystem_layout
assert_dev_stopped

BUNDLE_DIR="${1:-}"
[[ -n "$BUNDLE_DIR" ]] || sync_fail "Usage: $(basename "$0") <bundle-dir>"
[[ -d "$BUNDLE_DIR" ]] || sync_fail "Bundle directory not found: $BUNDLE_DIR"

load_bundle_metadata "$BUNDLE_DIR"

TOTAL_BIND_FILES="${#LIBRECHAT_SYNC_BIND_FILES[@]}"
TOTAL_BIND_DIRS="${#LIBRECHAT_SYNC_BIND_DIRS[@]}"
TOTAL_VOLUMES="${#LIBRECHAT_SYNC_VOLUME_KEYS[@]}"
sync_log "Importing dev bundle: $TOTAL_BIND_FILES bind files, $TOTAL_BIND_DIRS bind dirs, $TOTAL_VOLUMES volumes"

STEP=0
for relpath in "${LIBRECHAT_SYNC_BIND_FILES[@]}"; do
  STEP=$((STEP + 1))
  sync_log "  [$STEP/$TOTAL_BIND_FILES] restoring bind file: $relpath"
  restore_relpath_from_bundle "$relpath" "$BUNDLE_DIR"
done

STEP=0
for relpath in "${LIBRECHAT_SYNC_BIND_DIRS[@]}"; do
  STEP=$((STEP + 1))
  sync_log "  [$STEP/$TOTAL_BIND_DIRS] restoring bind dir: $relpath"
  restore_relpath_from_bundle "$relpath" "$BUNDLE_DIR"
done

STEP=0
for volume_key in "${LIBRECHAT_SYNC_VOLUME_KEYS[@]}"; do
  STEP=$((STEP + 1))
  sync_log "  [$STEP/$TOTAL_VOLUMES] restoring volume: $volume_key"
  restore_volume_archive "$volume_key" "$BUNDLE_DIR"
done

write_current_token "${LIBRECHAT_SYNC_TOKEN:-$LIBRECHAT_SYNC_BASE_TOKEN}"
sync_log "Imported dev bundle from $BUNDLE_DIR"
