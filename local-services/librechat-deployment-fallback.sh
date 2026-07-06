#!/usr/bin/env bash
set -euo pipefail

command="${1:-status}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VM_TARGET="${LIBRECHAT_STABLE_SSH_TARGET:-timeng@192.168.50.104}"
VM_ROOT="${LIBRECHAT_STABLE_ROOT:-/opt/LibreChat-custom}"
MAIN_CONTAINER="${LIBRECHAT_STABLE_CONTAINER:-LibreChat}"
FALLBACK_CONTAINER="${LIBRECHAT_FALLBACK_CONTAINER:-LibreChat-deploy-fallback}"
FALLBACK_IMAGE="${LIBRECHAT_FALLBACK_IMAGE:-librechat-local:last-known-good}"
FALLBACK_PORT="${LIBRECHAT_FALLBACK_PORT:-3082}"
FALLBACK_ABORT_TTL_SECONDS="${LIBRECHAT_FALLBACK_ABORT_TTL_SECONDS:-1800}"
PUBLIC_URL="${LIBRECHAT_PUBLIC_URL:-https://librechatvm.tail6e13ff.ts.net:8443}"
STATE_DIR="${LIBRECHAT_FALLBACK_STATE_DIR:-$ROOT_DIR/.rails/stable/deployment-fallback}"
MARKER_FILE="$STATE_DIR/active"

mkdir -p "$STATE_DIR"

local_vm=false
if [[ "$ROOT_DIR" == "$VM_ROOT" ]] && command -v docker >/dev/null 2>&1 && docker inspect "$MAIN_CONTAINER" >/dev/null 2>&1; then
  local_vm=true
fi

remote() {
  if $local_vm; then
    bash -c "set -euo pipefail; $1"
  else
    ssh -o BatchMode=yes -o ConnectTimeout=8 "$VM_TARGET" "bash -lc $(printf '%q' "set -euo pipefail; $1")"
  fi
}

wait_url() {
  local url="$1" attempts="${2:-30}"
  for ((i=1; i<=attempts; i++)); do
    curl -fsS --max-time 8 "$url" >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}

marker_value() {
  local key="$1"
  local file="${2:-$MARKER_FILE}"
  local line

  [[ -s "$file" ]] || return 1
  line="$(grep -m1 -E "^${key}=" "$file" 2>/dev/null || true)"
  [[ -n "$line" ]] || return 1
  printf '%s\n' "${line#*=}"
}

write_marker() {
  local session_id="$1"
  local status="$2"
  local started_at="$3"
  local image_id="$4"
  local abort_expires_epoch="${5:-}"
  local abort_expires_iso="${6:-}"

  cat > "$MARKER_FILE" <<EOF
started=$started_at
vm=$VM_TARGET
container=$FALLBACK_CONTAINER
port=$FALLBACK_PORT
image=$FALLBACK_IMAGE
image_id=$image_id
session_id=$session_id
status=$status
abort_ttl_seconds=$FALLBACK_ABORT_TTL_SECONDS
abort_expires_at_epoch=$abort_expires_epoch
abort_expires_at=$abort_expires_iso
EOF
}

cleanup_fallback() {
  local require_healthy="${1:-true}"
  local stable_ready=true

  if ! remote "curl -fsS --max-time 8 http://127.0.0.1:3080/api/config >/dev/null"; then
    stable_ready=false
    if [[ "$require_healthy" == "true" ]]; then
      echo "Stable loopback health is still failing; keeping fallback active." >&2
      return 1
    fi
  fi

  if [[ "$stable_ready" == "false" ]]; then
    echo "Fallback expiry reached before stable recovered; restoring direct routing and removing fallback anyway." >&2
  fi

  remote "sudo -n tailscale serve --bg --https=8443 --yes http://127.0.0.1:3080 >/dev/null"
}

remove_fallback_artifacts() {
  remote "docker rm -f '$FALLBACK_CONTAINER' >/dev/null 2>&1 || true"
  rm -f "$MARKER_FILE"
  "$ROOT_DIR/local-services/librechat-health-maintenance.sh" stop >/dev/null 2>&1 || true
}

schedule_expiry_cleanup() {
  local session_id="$1"
  local abort_expires_epoch="$2"
  local expiry_log="$STATE_DIR/expire-${session_id}.log"

  nohup "$ROOT_DIR/local-services/librechat-deployment-fallback.sh" \
    expire "$session_id" "$abort_expires_epoch" >"$expiry_log" 2>&1 &
}

start_fallback() {
  local session_id fallback_image_id started_at

  "$ROOT_DIR/local-services/librechat-health-maintenance.sh" start 60 "production deployment fallback active"
  trap '"$ROOT_DIR/local-services/librechat-health-maintenance.sh" stop >/dev/null 2>&1 || true' ERR

  remote "
    mkdir -p '$VM_ROOT/logs-deploy-fallback'
    docker rm -f '$FALLBACK_CONTAINER' >/dev/null 2>&1 || true
    docker commit --pause=false '$MAIN_CONTAINER' '$FALLBACK_IMAGE' >/dev/null
    docker run -d --name '$FALLBACK_CONTAINER' --network librechat-stable_default --restart=no \\
      --memory=2g --memory-reservation=1g --memory-swap=3g --cpus=2 --pids-limit=384 --oom-score-adj=-400 \
      -e NODE_OPTIONS=--max-old-space-size=1536 \
      -e SCHEDULED_RUNNER_ENABLED=false -e PORT=3080 -e HOST=0.0.0.0 \\
      -p 127.0.0.1:'$FALLBACK_PORT':3080 \\
      -v '$VM_ROOT/uploads:/app/uploads' \\
      -v '$VM_ROOT/logs-deploy-fallback:/app/logs' \\
      -v '$VM_ROOT/librechat.yaml:/app/librechat.yaml' \\
      -v '$VM_ROOT/data/google-service-account.json:/app/data/google-service-account.json:ro' \\
      -v '$VM_ROOT/.env:/app/.env:ro' \\
      -v '$VM_ROOT/images:/app/client/public/images' \\
      '$FALLBACK_IMAGE' >/dev/null
  "

  for ((i=1; i<=45; i++)); do
    if remote "curl -fsS --max-time 8 'http://127.0.0.1:$FALLBACK_PORT/api/config' >/dev/null"; then break; fi
    [[ "$i" -lt 45 ]] || { echo "Fallback did not become healthy." >&2; return 1; }
    sleep 2
  done

  remote "sudo -n tailscale serve --bg --https=8443 --yes 'http://127.0.0.1:$FALLBACK_PORT' >/dev/null"
  if ! $local_vm; then
    wait_url "$PUBLIC_URL/api/config" 20 || { echo "Public HTTPS did not recover through fallback." >&2; return 1; }
  fi
  session_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
  started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  fallback_image_id="$(remote "docker image inspect '$FALLBACK_IMAGE' --format '{{.Id}}'")"
  write_marker "$session_id" "active" "$started_at" "$fallback_image_id"
  trap - ERR
  echo "Deployment fallback is active: $PUBLIC_URL -> VM loopback $FALLBACK_PORT."
}

finish_fallback() {
  cleanup_fallback true || return 1
  if ! $local_vm; then
    wait_url "$PUBLIC_URL/api/config" 20 || { echo "Public HTTPS did not recover on stable upstream; fallback remains available on $FALLBACK_PORT." >&2; return 1; }
  fi
  remove_fallback_artifacts
  echo "Stable is active again: $PUBLIC_URL -> VM loopback 3080."
}

abort_fallback() {
  local session_id started_at image_id now_epoch abort_expires_epoch abort_expires_iso

  session_id="$(marker_value session_id || true)"
  started_at="$(marker_value started || true)"
  image_id="$(marker_value image_id || true)"
  if [[ -z "$session_id" ]]; then
    session_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
  fi
  if [[ -z "$started_at" ]]; then
    started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  fi

  now_epoch="$(date -u +%s)"
  abort_expires_epoch=$((now_epoch + FALLBACK_ABORT_TTL_SECONDS))
  abort_expires_iso="$(date -u -d "@$abort_expires_epoch" +%Y-%m-%dT%H:%M:%SZ)"
  write_marker "$session_id" "aborted" "$started_at" "$image_id" "$abort_expires_epoch" "$abort_expires_iso"
  schedule_expiry_cleanup "$session_id" "$abort_expires_epoch"
  "$ROOT_DIR/local-services/librechat-health-maintenance.sh" stop
  echo "Deployment failed. Public HTTPS remains on the last-known-good fallback while health recovery and rollback proceed until $abort_expires_iso, when cleanup will run automatically unless finish is called first."
}

expire_fallback() {
  local session_id="${1:?Missing session id after expire}"
  local abort_expires_epoch="${2:?Missing expiry epoch after expire}"
  local current_epoch current_session current_status current_expiry

  [[ "$abort_expires_epoch" =~ ^[0-9]+$ ]] || {
    echo "Expiry epoch must be an integer, got '$abort_expires_epoch'." >&2
    exit 2
  }

  current_epoch="$(date -u +%s)"
  if (( abort_expires_epoch > current_epoch )); then
    sleep "$((abort_expires_epoch - current_epoch))"
  fi

  current_session="$(marker_value session_id || true)"
  current_status="$(marker_value status || true)"
  current_expiry="$(marker_value abort_expires_at_epoch || true)"

  if [[ "$current_session" != "$session_id" || "$current_status" != "aborted" || "$current_expiry" != "$abort_expires_epoch" ]]; then
    exit 0
  fi

  cleanup_fallback false
  remove_fallback_artifacts
}

status_fallback() {
  echo "local_marker=$([[ -s "$MARKER_FILE" ]] && echo active || echo inactive)"
  if [[ -s "$MARKER_FILE" ]]; then
    echo "marker_status=$(marker_value status || true)"
    echo "marker_session=$(marker_value session_id || true)"
    echo "marker_abort_expires_at=$(marker_value abort_expires_at || true)"
  fi
  remote "
    printf 'stable_http='; curl -fsS --max-time 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:3080/api/config || true; echo
    printf 'fallback_http='; curl -fsS --max-time 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:$FALLBACK_PORT/api/config || true; echo
    printf 'fallback_container='; docker inspect '$FALLBACK_CONTAINER' --format '{{.State.Status}}' 2>/dev/null || echo absent
    sudo -n tailscale serve status | sed -n '/:8443/,/^[[:space:]]*$/p'
  "
}

case "$command" in
  start) start_fallback ;;
  finish) finish_fallback ;;
  abort) abort_fallback ;;
  expire) expire_fallback "${2:-}" "${3:-}" ;;
  status) status_fallback ;;
  *) echo "Usage: $0 start|finish|abort|status" >&2; exit 2 ;;
esac
