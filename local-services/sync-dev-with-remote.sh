#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/sync-env.sh"

resolve_sync_env

KEEP_LOCAL_STOPPED="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep-stopped)
      KEEP_LOCAL_STOPPED="true"
      shift
      ;;
    *)
      sync_fail "Unknown argument: $1"
      ;;
  esac
done

sync_remote_available || sync_fail "Remote source is not reachable: $LIBRECHAT_SYNC_REMOTE_SSH_TARGET"

INITIAL_REMOTE_STATUS_TEXT="$(run_remote_repo_script "remote-sync-status.sh")"
INITIAL_REMOTE_STATUS="$(status_value "status" "$INITIAL_REMOTE_STATUS_TEXT")"

if [[ "$INITIAL_REMOTE_STATUS" == "remote_active" ]]; then
  sync_log "Remote source dev rail is active; automatic handoff will retry later."
  exit 11
fi

LOCAL_WAS_RUNNING="false"
if dev_services_running; then
  LOCAL_WAS_RUNNING="true"
  "$ROOT_DIR/local-services/stop-all.sh" "dev" >/dev/null
fi

restart_local_if_needed() {
  if [[ "$KEEP_LOCAL_STOPPED" == "true" || "$LOCAL_WAS_RUNNING" != "true" ]]; then
    return
  fi

  "$ROOT_DIR/local-services/start-all.sh" "dev" >/dev/null
}

cleanup() {
  local exit_code="$?"
  if [[ "$exit_code" -ne 0 ]]; then
    sync_log "Sync failed with exit code $exit_code; restoring local dev rail state."
  fi
  restart_local_if_needed || true
  exit "$exit_code"
}

trap cleanup EXIT

LOCAL_BUNDLE_DIR="$LIBRECHAT_SYNC_BUNDLES_DIR/outgoing-current"
export LIBRECHAT_SYNC_BASE_TOKEN="$(read_current_token)"
export LIBRECHAT_SYNC_ROLE="roadcopy"
"$ROOT_DIR/local-services/export-dev-bundle.sh" "$LOCAL_BUNDLE_DIR" >/dev/null

sync_ssh "mkdir -p $(printf '%q' "$LIBRECHAT_SYNC_REMOTE_INCOMING_DIR") $(printf '%q' "$LIBRECHAT_SYNC_REMOTE_CONFLICTS_DIR") $(printf '%q' "$LIBRECHAT_SYNC_REMOTE_STATE_DIR")"
sync_rsync_upload_dir "$LOCAL_BUNDLE_DIR" "$LIBRECHAT_SYNC_REMOTE_INCOMING_DIR"

REMOTE_RESULT="$(run_remote_repo_script "remote-apply-dev-bundle.sh" "$LIBRECHAT_SYNC_REMOTE_INCOMING_DIR")"
REMOTE_STATUS="$(status_value "status" "$REMOTE_RESULT")"
REMOTE_TOKEN="$(status_value "current_token" "$REMOTE_RESULT" || true)"

pull_authoritative_bundle() {
  local remote_status_text
  remote_status_text="$(run_remote_repo_script "remote-sync-status.sh")"

  local remote_status
  remote_status="$(status_value "status" "$remote_status_text")"
  local remote_token
  remote_token="$(status_value "current_token" "$remote_status_text" || true)"

  if [[ "$remote_status" != "ready" ]]; then
    sync_log "Remote source is active; latest authoritative bundle is not yet available."
    return 1
  fi

  LOCAL_PULL_DIR="$LIBRECHAT_SYNC_BUNDLES_DIR/remote-current"
  sync_rsync_download_dir "$LIBRECHAT_SYNC_REMOTE_AUTH_BUNDLE_DIR" "$LOCAL_PULL_DIR"
  "$ROOT_DIR/local-services/import-dev-bundle.sh" "$LOCAL_PULL_DIR" >/dev/null
  [[ -n "$remote_token" ]] && write_current_token "$remote_token"
  sync_log "Pulled authoritative dev state from $LIBRECHAT_SYNC_REMOTE_SSH_TARGET"
}

case "$REMOTE_STATUS" in
  accepted)
    [[ -n "$REMOTE_TOKEN" ]] && write_current_token "$REMOTE_TOKEN"
    sync_log "Pushed local dev state to $LIBRECHAT_SYNC_REMOTE_SSH_TARGET"
    ;;
  remote_newer)
    sync_log "Remote source is newer than the local road copy; pulling latest authoritative state."
    pull_authoritative_bundle
    ;;
  remote_active)
    sync_log "Remote source dev rail is active; deferring automatic handoff."
    exit 11
    ;;
  *)
    sync_fail "Unexpected remote sync status: ${REMOTE_STATUS:-unknown}"
    ;;
esac
