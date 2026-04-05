#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/sync-env.sh"

resolve_sync_env
ensure_sync_filesystem_layout
assert_dev_stopped

OUTPUT_DIR="${1:-$LIBRECHAT_SYNC_BUNDLES_DIR/export-$(date -u +%Y%m%dT%H%M%SZ)}"
BASE_TOKEN="${LIBRECHAT_SYNC_BASE_TOKEN:-$(read_current_token)}"
ROLE="${LIBRECHAT_SYNC_ROLE:-roadcopy}"
CREATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR/binds" "$OUTPUT_DIR/volumes"

TOTAL_BIND_FILES="${#LIBRECHAT_SYNC_BIND_FILES[@]}"
TOTAL_BIND_DIRS="${#LIBRECHAT_SYNC_BIND_DIRS[@]}"
TOTAL_VOLUMES="${#LIBRECHAT_SYNC_VOLUME_KEYS[@]}"
sync_log "Exporting dev bundle: $TOTAL_BIND_FILES bind files, $TOTAL_BIND_DIRS bind dirs, $TOTAL_VOLUMES volumes"

STEP=0
for relpath in "${LIBRECHAT_SYNC_BIND_FILES[@]}"; do
  STEP=$((STEP + 1))
  sync_log "  [$STEP/$TOTAL_BIND_FILES] bind file: $relpath"
  copy_relpath_to_bundle "$relpath" "$OUTPUT_DIR"
done

STEP=0
for relpath in "${LIBRECHAT_SYNC_BIND_DIRS[@]}"; do
  STEP=$((STEP + 1))
  sync_log "  [$STEP/$TOTAL_BIND_DIRS] bind dir: $relpath"
  copy_relpath_to_bundle "$relpath" "$OUTPUT_DIR"
done

STEP=0
for volume_key in "${LIBRECHAT_SYNC_VOLUME_KEYS[@]}"; do
  STEP=$((STEP + 1))
  sync_log "  [$STEP/$TOTAL_VOLUMES] volume: $volume_key"
  export_volume_archive "$volume_key" "$OUTPUT_DIR"
done

sync_log "Computing bundle hash..."
BUNDLE_HASH="$(sync_bundle_hash "$OUTPUT_DIR")"
write_bundle_metadata "$OUTPUT_DIR" "" "$BASE_TOKEN" "$BUNDLE_HASH" "$CREATED_AT" "$ROLE"
sync_log "Export complete: $OUTPUT_DIR"

printf '%s\n' "$OUTPUT_DIR"
