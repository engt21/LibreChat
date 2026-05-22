#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/local-services/rail-env.sh"

STATE_DIR="${LIBRECHAT_DEV_FAILOVER_STATE_DIR:-$ROOT_DIR/.rails/dev/failover}"
LOCK_FILE="$STATE_DIR/watchdog.lock"
MARKER_FILE="$STATE_DIR/dev-started-by-failover"
FAIL_COUNT_FILE="$STATE_DIR/stable-fail-count"
SUCCESS_COUNT_FILE="$STATE_DIR/stable-success-count"

STABLE_HEALTH_URL="${LIBRECHAT_STABLE_HEALTH_URL:-http://127.0.0.1:3080/}"
HEALTH_TIMEOUT_SECONDS="${LIBRECHAT_STABLE_HEALTH_TIMEOUT_SECONDS:-5}"
FAILURE_THRESHOLD="${LIBRECHAT_FAILOVER_FAILURE_THRESHOLD:-2}"
RECOVERY_THRESHOLD="${LIBRECHAT_FAILOVER_RECOVERY_THRESHOLD:-2}"
STOP_MANUAL_DEV="${LIBRECHAT_FAILOVER_STOP_MANUAL_DEV_ON_RECOVERY:-false}"

mkdir -p "$STATE_DIR"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  exit 0
fi

log() {
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

read_count() {
  local file="$1"
  if [[ -f "$file" ]]; then
    tr -cd '0-9' < "$file"
  else
    printf '0'
  fi
}

write_count() {
  local file="$1"
  local value="$2"
  printf '%s\n' "$value" > "$file"
}

stable_healthy() {
  curl -fsS --max-time "$HEALTH_TIMEOUT_SECONDS" "$STABLE_HEALTH_URL" >/dev/null 2>&1
}

resolve_dev_compose() {
  "$ROOT_DIR/local-services/ensure-runtime-files.sh" >/dev/null
  resolve_librechat_rail "$ROOT_DIR" dev
}

dev_api_running() {
  [[ "$(docker inspect "$LIBRECHAT_API_CONTAINER_NAME" --format '{{.State.Running}}' 2>/dev/null || true)" == "true" ]]
}

start_dev_failover() {
  log "Stable health failed; starting dev rail in minimal failover profile."
  LIBRECHAT_DEV_PROFILE=failover \
    "$ROOT_DIR/local-services/start-all.sh" dev --no-build --force-recreate --skip-health-check
  printf 'started_at=%s\nhealth_url=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$STABLE_HEALTH_URL" > "$MARKER_FILE"
}

stop_dev_failover() {
  log "Stable health recovered; stopping failover-owned dev rail."
  mapfile -t dev_containers < <(docker ps --format '{{.Names}}' | grep '^librechat-dev-' || true)
  if [[ "${#dev_containers[@]}" -gt 0 ]]; then
    docker stop "${dev_containers[@]}" >/dev/null
  fi
  rm -f "$MARKER_FILE"
}

resolve_dev_compose

if stable_healthy; then
  success_count="$(read_count "$SUCCESS_COUNT_FILE")"
  success_count=$((success_count + 1))
  write_count "$SUCCESS_COUNT_FILE" "$success_count"
  write_count "$FAIL_COUNT_FILE" 0

  if [[ "$success_count" -lt "$RECOVERY_THRESHOLD" ]]; then
    log "Stable healthy (${success_count}/${RECOVERY_THRESHOLD}); waiting before recovery action."
    exit 0
  fi

  if [[ -f "$MARKER_FILE" ]]; then
    if dev_api_running; then
      stop_dev_failover
    else
      log "Failover marker existed but dev API is already stopped; clearing marker."
      rm -f "$MARKER_FILE"
    fi
    write_count "$SUCCESS_COUNT_FILE" 0
  elif dev_api_running; then
    if [[ "$STOP_MANUAL_DEV" == "true" ]]; then
      log "Stable healthy and manual dev stop override is enabled; stopping dev rail."
      "$ROOT_DIR/local-services/stop-all.sh" dev
    else
      log "Stable healthy; dev rail is running without failover marker, assuming explicit testing and leaving it up."
    fi
  else
    log "Stable healthy; dev rail is stopped."
  fi

  exit 0
fi

fail_count="$(read_count "$FAIL_COUNT_FILE")"
fail_count=$((fail_count + 1))
write_count "$FAIL_COUNT_FILE" "$fail_count"
write_count "$SUCCESS_COUNT_FILE" 0

if [[ "$fail_count" -lt "$FAILURE_THRESHOLD" ]]; then
  log "Stable health failed (${fail_count}/${FAILURE_THRESHOLD}); waiting before failover."
  exit 0
fi

if dev_api_running; then
  if [[ -f "$MARKER_FILE" ]]; then
    log "Stable still unhealthy; failover-owned dev rail is already running."
  else
    log "Stable unhealthy; dev rail is already running for explicit testing, leaving it up."
  fi
else
  start_dev_failover
fi
