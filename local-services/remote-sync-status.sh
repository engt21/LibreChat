#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/sync-env.sh"

resolve_sync_env

if dev_services_running; then
  printf 'status=%s\n' "remote_active"
  printf 'current_token=%s\n' "${LIBRECHAT_SYNC_CURRENT_TOKEN:-$(read_current_token)}"
  exit 0
fi

CURRENT_TOKEN="$(refresh_authoritative_bundle)"

printf 'status=%s\n' "ready"
printf 'current_token=%s\n' "$CURRENT_TOKEN"
printf 'authoritative_bundle_dir=%s\n' "$(authoritative_bundle_dir)"
