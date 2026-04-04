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

for relpath in "${LIBRECHAT_SYNC_BIND_FILES[@]}"; do
  restore_relpath_from_bundle "$relpath" "$BUNDLE_DIR"
done

for relpath in "${LIBRECHAT_SYNC_BIND_DIRS[@]}"; do
  restore_relpath_from_bundle "$relpath" "$BUNDLE_DIR"
done

for volume_key in "${LIBRECHAT_SYNC_VOLUME_KEYS[@]}"; do
  restore_volume_archive "$volume_key" "$BUNDLE_DIR"
done

write_current_token "${LIBRECHAT_SYNC_TOKEN:-$LIBRECHAT_SYNC_BASE_TOKEN}"
sync_log "Imported dev bundle from $BUNDLE_DIR"
