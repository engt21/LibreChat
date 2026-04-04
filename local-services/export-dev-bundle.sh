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

for relpath in "${LIBRECHAT_SYNC_BIND_FILES[@]}"; do
  copy_relpath_to_bundle "$relpath" "$OUTPUT_DIR"
done

for relpath in "${LIBRECHAT_SYNC_BIND_DIRS[@]}"; do
  copy_relpath_to_bundle "$relpath" "$OUTPUT_DIR"
done

for volume_key in "${LIBRECHAT_SYNC_VOLUME_KEYS[@]}"; do
  export_volume_archive "$volume_key" "$OUTPUT_DIR"
done

BUNDLE_HASH="$(sync_bundle_hash "$OUTPUT_DIR")"
write_bundle_metadata "$OUTPUT_DIR" "" "$BASE_TOKEN" "$BUNDLE_HASH" "$CREATED_AT" "$ROLE"

printf '%s\n' "$OUTPUT_DIR"
