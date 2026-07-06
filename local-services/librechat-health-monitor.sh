#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-}"
[[ "$MODE" == "host" || "$MODE" == "vm" ]] || { echo "Usage: $0 host|vm" >&2; exit 2; }

MONITOR_SOURCE="${MONITOR_SOURCE:-$(hostname -s)}"
STATE_DIR="${STATE_DIR:-$HOME/.local/state/librechat-health-monitor/$MODE}"
CHECK_INTERVAL_SECONDS="${CHECK_INTERVAL_SECONDS:-30}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-8}"
FAILURE_THRESHOLD="${FAILURE_THRESHOLD:-3}"
RECOVERY_THRESHOLD="${RECOVERY_THRESHOLD:-2}"
REMINDER_INTERVAL_SECONDS="${REMINDER_INTERVAL_SECONDS:-1800}"
DIAGNOSTIC_LINES="${DIAGNOSTIC_LINES:-30}"
NTFY_TOPIC_URL="${NTFY_TOPIC_URL:-}"
AZURE_PAGER_ENABLED="${AZURE_PAGER_ENABLED:-true}"
AZURE_RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-timeng-librechat-rg}"
AZURE_SIGNAL_PREFIX="${AZURE_SIGNAL_PREFIX:-librechat}"
VM_HOST="${VM_HOST:-192.168.50.104}"
VM_SSH_PORT="${VM_SSH_PORT:-22}"
VM_HEALTH_URL="${VM_HEALTH_URL:-http://192.168.50.104:3080/api/config}"
VM_ID="${VM_ID:-112}"
VM_CONTROL_ENABLED="${VM_CONTROL_ENABLED:-false}"
VM_REBOOT_FAILURE_THRESHOLD="${VM_REBOOT_FAILURE_THRESHOLD:-8}"
VM_RESET_FAILURE_THRESHOLD="${VM_RESET_FAILURE_THRESHOLD:-16}"
VM_RECOVERY_COOLDOWN_SECONDS="${VM_RECOVERY_COOLDOWN_SECONDS:-3600}"
VM_RECOVERY_WAIT_SECONDS="${VM_RECOVERY_WAIT_SECONDS:-240}"
LIBRECHAT_CONTAINER="${LIBRECHAT_CONTAINER:-LibreChat}"
MONGODB_CONTAINER="${MONGODB_CONTAINER:-chat-mongodb}"
LIBRECHAT_ROOT="${LIBRECHAT_ROOT:-/opt/LibreChat-custom}"
LOCAL_HEALTH_URL="${LOCAL_HEALTH_URL:-http://127.0.0.1:3080/api/config}"
APP_RESTART_ENABLED="${APP_RESTART_ENABLED:-false}"
APP_RESTART_FAILURE_THRESHOLD="${APP_RESTART_FAILURE_THRESHOLD:-3}"
APP_RESTART_COOLDOWN_SECONDS="${APP_RESTART_COOLDOWN_SECONDS:-1800}"
APP_RECOVERY_WAIT_SECONDS="${APP_RECOVERY_WAIT_SECONDS:-120}"
MONGODB_RESTART_ENABLED="${MONGODB_RESTART_ENABLED:-true}"
MONGODB_RESTART_FAILURE_THRESHOLD="${MONGODB_RESTART_FAILURE_THRESHOLD:-3}"
MONGODB_RESTART_COOLDOWN_SECONDS="${MONGODB_RESTART_COOLDOWN_SECONDS:-1800}"
MONGODB_RECOVERY_WAIT_SECONDS="${MONGODB_RECOVERY_WAIT_SECONDS:-120}"
AUTO_ROLLBACK_ENABLED="${AUTO_ROLLBACK_ENABLED:-false}"
ROLLBACK_MAX_AGE_SECONDS="${ROLLBACK_MAX_AGE_SECONDS:-7200}"
ROLLBACK_POINTER="${ROLLBACK_POINTER:-$HOME/.local/state/librechat-health-monitor/last-stable.env}"
ROLLBACK_COMMAND="${ROLLBACK_COMMAND:-$HOME/.local/libexec/librechat-rollback-last-stable}"
HOST_APP_FALLBACK_RESTART="${HOST_APP_FALLBACK_RESTART:-false}"
HOST_APP_RESTART_FAILURE_THRESHOLD="${HOST_APP_RESTART_FAILURE_THRESHOLD:-8}"
MAINTENANCE_FILE="${MAINTENANCE_FILE:-$HOME/.local/state/librechat-health-monitor/maintenance}"
REMOTE_MAINTENANCE_FILE="${REMOTE_MAINTENANCE_FILE:-/home/timeng/.local/state/librechat-health-monitor/maintenance}"
EVENT_OUTBOX_DIR="${EVENT_OUTBOX_DIR:-$HOME/.local/state/librechat-health-monitor/events}"
REMOTE_EVENT_OUTBOX_DIR="${REMOTE_EVENT_OUTBOX_DIR:-/home/timeng/.local/state/librechat-health-monitor/events}"

mkdir -p "$STATE_DIR" "$(dirname "$MAINTENANCE_FILE")" "$EVENT_OUTBOX_DIR"
exec 9>"$STATE_DIR/monitor.lock"
flock -n 9 || exit 0

log() { printf '[%s] [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$MODE" "$*"; }
read_value() { [[ -s "$1" ]] && cat "$1" || printf '%s' "$2"; }
write_value() { printf '%s\n' "$2" > "$1"; }
now_epoch() { date +%s; }
now_utc() { date -u +%Y-%m-%dT%H:%M:%SZ; }

truncate_text() {
  local limit="$1"
  head -c "$limit" | tr '\000-\010\013\014\016-\037' ' '
}

maintenance_file_active() {
  local file="$1" expires
  [[ -s "$file" ]] || return 1
  expires="$(sed -n 's/^expires=//p' "$file" | head -1)"
  if [[ "$expires" =~ ^[0-9]+$ ]] && (( expires > $(now_epoch) )); then
    return 0
  fi
  rm -f "$file"
  return 1
}

maintenance_reason() {
  local file="$1"
  sed -n 's/^reason=//p' "$file" | head -1
}

remote_maintenance_active() {
  timeout "$HEALTH_TIMEOUT_SECONDS" ssh -o BatchMode=yes -o ConnectTimeout="$HEALTH_TIMEOUT_SECONDS" \
    "timeng@$VM_HOST" "file='$REMOTE_MAINTENANCE_FILE'; test -s \"\$file\" || exit 1; expires=\$(sed -n 's/^expires=//p' \"\$file\" | head -1); test -n \"\$expires\" && test \"\$expires\" -gt \$(date +%s)" \
    >/dev/null 2>&1
}

reset_check_state() {
  local kind="$1"
  write_value "$STATE_DIR/$kind.failures" 0
  write_value "$STATE_DIR/$kind.successes" 0
}

publish_ntfy() {
  local priority="$1" title="$2" message="$3"
  [[ -n "$NTFY_TOPIC_URL" ]] || return 0
  curl -fsS --max-time 10 -H "Title: $title" -H "Priority: $priority" \
    -H "Tags: warning,rotating_light" \
    -H "Click: https://librechatvm.tail6e13ff.ts.net:8443" \
    --data-binary "$message" "$NTFY_TOPIC_URL" >/dev/null
}

queue_host_event() {
  local event="$1" title="$2" summary="$3" details="$4" file
  file="$EVENT_OUTBOX_DIR/$(date -u +%Y%m%dT%H%M%S)-${event}-$$-$RANDOM.event"
  {
    printf 'event=%s\n' "$event"
    printf 'title_b64=%s\n' "$(printf '%s' "$title" | base64 -w0)"
    printf 'summary_b64=%s\n' "$(printf '%s' "$summary" | base64 -w0)"
    printf 'details_b64=%s\n' "$(printf '%s' "$details" | base64 -w0)"
  } > "$file"
  chmod 600 "$file"
}

drain_remote_events() {
  [[ "$MODE" == "host" ]] || return 0
  local file payload event title_b64 summary_b64 details_b64 title summary details
  while IFS= read -r file; do
    [[ "$file" =~ ^[A-Za-z0-9._-]+\.event$ ]] || continue
    payload="$(ssh -o BatchMode=yes -o ConnectTimeout="$HEALTH_TIMEOUT_SECONDS" "timeng@$VM_HOST"       "cat '$REMOTE_EVENT_OUTBOX_DIR/$file'" 2>/dev/null || true)"
    [[ -n "$payload" ]] || continue
    event="$(sed -n 's/^event=//p' <<<"$payload" | head -1)"
    title_b64="$(sed -n 's/^title_b64=//p' <<<"$payload" | head -1)"
    summary_b64="$(sed -n 's/^summary_b64=//p' <<<"$payload" | head -1)"
    details_b64="$(sed -n 's/^details_b64=//p' <<<"$payload" | head -1)"
    title="$(printf '%s' "$title_b64" | base64 -d 2>/dev/null || true)"
    summary="$(printf '%s' "$summary_b64" | base64 -d 2>/dev/null || true)"
    details="$(printf '%s' "$details_b64" | base64 -d 2>/dev/null || true)"
    if [[ -n "$event" && -n "$summary" ]] && azure_signal "$event" "$summary" "$details"; then
      ssh -o BatchMode=yes -o ConnectTimeout="$HEALTH_TIMEOUT_SECONDS" "timeng@$VM_HOST"         "rm -f '$REMOTE_EVENT_OUTBOX_DIR/$file'" >/dev/null 2>&1 || true
      log "Relayed VM event to email/SMS: $title"
    fi
  done < <(ssh -o BatchMode=yes -o ConnectTimeout="$HEALTH_TIMEOUT_SECONDS" "timeng@$VM_HOST"     "mkdir -p '$REMOTE_EVENT_OUTBOX_DIR'; find '$REMOTE_EVENT_OUTBOX_DIR' -maxdepth 1 -type f -name '*.event' -printf '%f\n' | sort" 2>/dev/null || true)
}

azure_signal() {
  local event="$1" summary="$2" details="$3"
  [[ "$MODE" == "host" && "$AZURE_PAGER_ENABLED" == "true" ]] || return 0
  command -v az >/dev/null 2>&1 || return 1

  local signal_name="${AZURE_SIGNAL_PREFIX}-${event}-signal"
  local rule_name="${AZURE_SIGNAL_PREFIX}-${event}-pager"
  local signal_id description
  description="$(printf '%s\n\n%s' "$summary" "$details" | truncate_text 3500)"
  az monitor activity-log alert update -g "$AZURE_RESOURCE_GROUP" -n "$rule_name" \
    --description "$description" --only-show-errors -o none
  signal_id="$(az monitor action-group show -g "$AZURE_RESOURCE_GROUP" -n "$signal_name" --query id -o tsv --only-show-errors)"
  az resource update --ids "$signal_id" --set tags.state="$event" tags.lastSignal="$(now_utc)" \
    tags.monitor="$MONITOR_SOURCE" --only-show-errors -o none
}

notify_event() {
  local event="$1" title="$2" summary="$3" details="$4" priority="${5:-urgent}"
  local message
  details="${details//\\n/$'\n'}"
  printf -v message 'Source: %s\nTime: %s\nSummary: %s\n\n%s' \
    "$MONITOR_SOURCE" "$(now_utc)" "$summary" "$details"
  log "$title: $summary"
  publish_ntfy "$priority" "$title" "$message" || log "ntfy delivery failed"
  if [[ "$MODE" == "host" ]]; then
    azure_signal "$event" "$summary" "$details" || log "Azure pager signal failed for $event"
  else
    queue_host_event "$event" "$title" "$summary" "$details"
  fi
}

capture_host_diagnostics() {
  local kind="$1" output="$STATE_DIR/${kind}-diagnostics-$(date -u +%Y%m%dT%H%M%SZ).txt"
  {
    echo "captured=$(now_utc) source=$MONITOR_SOURCE kind=$kind"
    echo "vm_host=$VM_HOST vm_id=$VM_ID"
    echo "qm_status=$(sudo -n qm status "$VM_ID" 2>&1 || true)"
    echo "ping:"
    ping -c 2 -W 2 "$VM_HOST" 2>&1 || true
    echo "tcp_22:"
    timeout 3 bash -c "exec 3<>/dev/tcp/$VM_HOST/$VM_SSH_PORT" 2>&1 || true
    echo "http:"
    curl -sS -o /dev/null -w 'http_code=%{http_code} connect=%{time_connect} total=%{time_total}\n' \
      --max-time "$HEALTH_TIMEOUT_SECONDS" "$VM_HEALTH_URL" 2>&1 || true
    echo "host_memory:"
    free -h || true
  } > "$output"
  printf '%s' "$output"
}

capture_vm_diagnostics() {
  local output="$STATE_DIR/app-diagnostics-$(date -u +%Y%m%dT%H%M%SZ).txt"
  {
    echo "captured=$(now_utc) source=$MONITOR_SOURCE"
    docker inspect "$LIBRECHAT_CONTAINER" --format \
      'container={{.Name}} status={{.State.Status}} running={{.State.Running}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} error={{.State.Error}} restarts={{.RestartCount}} started={{.State.StartedAt}} finished={{.State.FinishedAt}}' 2>&1 || true
    curl -sS -o /dev/null -w 'http_code=%{http_code} connect=%{time_connect} total=%{time_total}\n' \
      --max-time "$HEALTH_TIMEOUT_SECONDS" "$LOCAL_HEALTH_URL" 2>&1 || true
    echo "docker_logs:"
    docker logs --tail "$DIAGNOSTIC_LINES" "$LIBRECHAT_CONTAINER" 2>&1 || true
    echo "memory:"
    free -h || true
    echo "disk:"
    df -h / /var/lib/docker 2>&1 || true
  } > "$output"
  printf '%s' "$output"
}

diagnostic_summary() {
  local file="$1"
  tail -n 80 "$file" | truncate_text 3000
}

mark_failure() {
  local kind="$1" detail="$2"
  local failures state now last_alert
  failures="$(read_value "$STATE_DIR/$kind.failures" 0)"
  failures=$((failures + 1))
  write_value "$STATE_DIR/$kind.failures" "$failures"
  write_value "$STATE_DIR/$kind.successes" 0
  write_value "$STATE_DIR/$kind.last-detail" "$detail"
  state="$(read_value "$STATE_DIR/$kind.state" unknown)"
  now="$(now_epoch)"
  last_alert="$(read_value "$STATE_DIR/$kind.last-alert" 0)"
  if [[ "$failures" -lt "$FAILURE_THRESHOLD" ]]; then
    log "$kind check failed ($failures/$FAILURE_THRESHOLD): $detail"
    return 1
  fi
  if [[ "$state" != "down" ]] || (( now - last_alert >= REMINDER_INTERVAL_SECONDS )); then
    write_value "$STATE_DIR/$kind.state" down
    write_value "$STATE_DIR/$kind.last-alert" "$now"
    write_value "$STATE_DIR/$kind.outage-started" "$(read_value "$STATE_DIR/$kind.outage-started" "$now")"
    return 0
  fi
  log "$kind remains down ($failures failures): $detail"
  return 1
}

mark_success() {
  local kind="$1" detail="$2" event="$3" title="$4"
  local state successes started duration details
  state="$(read_value "$STATE_DIR/$kind.state" unknown)"
  write_value "$STATE_DIR/$kind.failures" 0
  successes="$(read_value "$STATE_DIR/$kind.successes" 0)"
  successes=$((successes + 1))
  write_value "$STATE_DIR/$kind.successes" "$successes"
  if [[ "$state" == "down" && "$successes" -ge "$RECOVERY_THRESHOLD" ]]; then
    started="$(read_value "$STATE_DIR/$kind.outage-started" "$(now_epoch)")"
    duration=$(( $(now_epoch) - started ))
    details="Recovered after ${duration}s. $detail\nLast failure: $(read_value "$STATE_DIR/$kind.last-detail" unknown)\nSelf-heal action: $(read_value "$STATE_DIR/$kind.last-action" none)."
    write_value "$STATE_DIR/$kind.state" healthy
    rm -f "$STATE_DIR/$kind.outage-started"
    notify_event "$event" "$title" "$detail" "$details" high
  elif [[ "$state" == "unknown" ]]; then
    write_value "$STATE_DIR/$kind.state" healthy
    log "$kind check healthy: $detail"
  fi
}

wait_for_vm() {
  local deadline=$(( $(now_epoch) + VM_RECOVERY_WAIT_SECONDS ))
  while (( $(now_epoch) < deadline )); do
    if timeout 4 bash -c "exec 3<>/dev/tcp/$VM_HOST/$VM_SSH_PORT" >/dev/null 2>&1 \
      && curl -fsS --max-time 8 "$VM_HEALTH_URL" >/dev/null 2>&1; then return 0; fi
    sleep 10
  done
  return 1
}

heal_vm_if_needed() {
  [[ "$VM_CONTROL_ENABLED" == "true" ]] || return 0
  local failures now last_action action diagnostics summary
  failures="$(read_value "$STATE_DIR/vm.failures" 0)"
  now="$(now_epoch)"
  last_action="$(read_value "$STATE_DIR/vm.last-recovery-at" 0)"
  (( now - last_action >= VM_RECOVERY_COOLDOWN_SECONDS )) || return 0

  if (( failures >= VM_RESET_FAILURE_THRESHOLD )); then
    action="hard-reset"
  elif (( failures >= VM_REBOOT_FAILURE_THRESHOLD )); then
    action="graceful-reboot"
  else
    return 0
  fi

  diagnostics="$(capture_host_diagnostics vm)"
  write_value "$STATE_DIR/vm.last-recovery-at" "$now"
  write_value "$STATE_DIR/vm.last-action" "$action"
  if [[ "$action" == "graceful-reboot" ]]; then
    log "Attempting graceful Proxmox reboot of VM $VM_ID."
    if ! sudo -n qm reboot "$VM_ID" --timeout 90; then
      log "Graceful reboot command failed; next eligible action will be a hard reset."
      write_value "$STATE_DIR/vm.last-recovery-at" $((now - VM_RECOVERY_COOLDOWN_SECONDS + 120))
    fi
  else
    log "Attempting hard Proxmox reset of VM $VM_ID after prolonged outage."
    sudo -n qm reset "$VM_ID"
  fi

  if wait_for_vm; then
    write_value "$STATE_DIR/vm.last-action" "$action-success"
    mark_success vm "VM SSH and LibreChat HTTP recovered after $action." vm-healed "LibreChat VM HEALED"
  else
    if [[ "$action" == "graceful-reboot" ]]; then
      write_value "$STATE_DIR/vm.last-recovery-at" $(( $(now_epoch) - VM_RECOVERY_COOLDOWN_SECONDS + 120 ))
    fi
    summary="VM remains unavailable after $action."
    notify_event vm-heal-failed "LibreChat VM HEAL FAILED" "$summary" \
      "Action: $action on Proxmox VM $VM_ID.\nDiagnostics file: $diagnostics\n$(diagnostic_summary "$diagnostics")"
  fi
}

wait_for_app() {
  local deadline=$(( $(now_epoch) + APP_RECOVERY_WAIT_SECONDS ))
  while (( $(now_epoch) < deadline )); do
    if [[ "$(docker inspect "$LIBRECHAT_CONTAINER" --format '{{.State.Running}}' 2>/dev/null || true)" == "true" ]] \
      && curl -fsS --max-time 8 "$LOCAL_HEALTH_URL" >/dev/null 2>&1; then return 0; fi
    sleep 5
  done
  return 1
}

verify_restart_safety() {
  "$LIBRECHAT_ROOT/local-services/verify-auth-memory-runtime-contracts.sh" --container "$LIBRECHAT_CONTAINER" \
    && "$LIBRECHAT_ROOT/local-services/verify-api-runtime-contract.sh" --container "$LIBRECHAT_CONTAINER" \
    && "$LIBRECHAT_ROOT/local-services/verify-api-memory-headroom.sh" --container "$LIBRECHAT_CONTAINER" --minimum-available-mb 0
}

wait_for_mongodb() {
  local deadline=$(( $(now_epoch) + MONGODB_RECOVERY_WAIT_SECONDS ))
  while (( $(now_epoch) < deadline )); do
    if [[ "$(docker inspect "$MONGODB_CONTAINER" --format '{{.State.Running}}:{{if .State.Health}}{{.State.Health.Status}}{{end}}' 2>/dev/null || true)" == "true:healthy" ]]; then
      return 0
    fi
    sleep 5
  done
  return 1
}

heal_mongodb_if_needed() {
  [[ "$MODE" == "vm" && "$MONGODB_RESTART_ENABLED" == "true" ]] || return 0
  local failures now last_restart diagnostics
  failures="$(read_value "$STATE_DIR/mongodb.failures" 0)"
  (( failures >= MONGODB_RESTART_FAILURE_THRESHOLD )) || return 0
  now="$(now_epoch)"
  last_restart="$(read_value "$STATE_DIR/mongodb.last-restart" 0)"
  (( now - last_restart >= MONGODB_RESTART_COOLDOWN_SECONDS )) || return 0
  diagnostics="$(capture_vm_diagnostics)"
  if ! verify_restart_safety; then
    write_value "$STATE_DIR/mongodb.last-action" "restart-safety-blocked"
    notify_event mongodb-heal-blocked "MongoDB AUTO-RESTART BLOCKED" \
      "MongoDB restart was blocked because LibreChat persistence/runtime safeguards failed." \
      "No credentials, sessions, MFA state, database files, or containers were changed. Diagnostics file: $diagnostics"
    return 0
  fi
  write_value "$STATE_DIR/mongodb.last-restart" "$now"
  write_value "$STATE_DIR/mongodb.last-action" "container-restart"
  log "Restarting $MONGODB_CONTAINER after sustained unhealthy status; persistent database files are retained."
  if docker restart "$MONGODB_CONTAINER" >/dev/null && wait_for_mongodb; then
    write_value "$STATE_DIR/mongodb.last-action" "container-restart-success"
    mark_success mongodb "MongoDB recovered after a guarded container restart." mongodb-healed "LibreChat MongoDB HEALED"
    return 0
  fi
  notify_event mongodb-heal-failed "MongoDB HEAL FAILED" \
    "MongoDB remained unhealthy after a guarded restart." \
    "No database/session deletion was attempted. Diagnostics file: $diagnostics"
}

rollback_recent_last_stable() {
  [[ "$AUTO_ROLLBACK_ENABLED" == "true" && -x "$ROLLBACK_COMMAND" && -s "$ROLLBACK_POINTER" ]] || return 1
  local created age
  created="$(sed -n 's/^created_epoch=//p' "$ROLLBACK_POINTER" | head -1)"
  [[ "$created" =~ ^[0-9]+$ ]] || return 1
  age=$(( $(now_epoch) - created ))
  (( age <= ROLLBACK_MAX_AGE_SECONDS )) || return 1
  log "Attempting rollback to deployment-recorded last stable snapshot (age ${age}s)."
  write_value "$STATE_DIR/app.last-action" "last-stable-rollback"
  "$ROLLBACK_COMMAND"
}

heal_app_if_needed() {
  [[ "$MODE" == "vm" && "$APP_RESTART_ENABLED" == "true" ]] || return 0
  local failures now last_restart diagnostics summary
  failures="$(read_value "$STATE_DIR/app.failures" 0)"
  (( failures >= APP_RESTART_FAILURE_THRESHOLD )) || return 0
  now="$(now_epoch)"
  last_restart="$(read_value "$STATE_DIR/app.last-restart" 0)"
  (( now - last_restart >= APP_RESTART_COOLDOWN_SECONDS )) || return 0

  diagnostics="$(capture_vm_diagnostics)"
  write_value "$STATE_DIR/app.last-restart" "$now"
  write_value "$STATE_DIR/app.last-action" "container-restart"
  log "Validating auth/session, runtime-shape, and heap contracts before automatic restart."
  if ! verify_restart_safety; then
    write_value "$STATE_DIR/app.last-action" "restart-safety-blocked"
    notify_event app-heal-blocked "LibreChat AUTO-RESTART BLOCKED" \
      "Automatic restart was blocked because a persistence/runtime contract failed." \
      "No credentials, sessions, MFA state, or containers were changed. Diagnostics file: $diagnostics"
    return 0
  fi
  log "Restarting $LIBRECHAT_CONTAINER after sustained application failure."
  if docker restart "$LIBRECHAT_CONTAINER" >/dev/null && wait_for_app && verify_restart_safety; then
    write_value "$STATE_DIR/app.last-action" "container-restart-success"
    mark_success app "LibreChat container and HTTP endpoint recovered after automatic restart." app-healed "LibreChat APP HEALED"
    return 0
  fi

  if rollback_recent_last_stable && wait_for_app; then
    write_value "$STATE_DIR/app.last-action" "last-stable-rollback-success"
    mark_success app "LibreChat recovered after rollback to the deployment-recorded last stable snapshot." app-healed "LibreChat APP HEALED"
    return 0
  fi

  summary="LibreChat remained unhealthy after container restart and eligible last-stable rollback."
  notify_event app-heal-failed "LibreChat APP HEAL FAILED" "$summary" \
    "Actions attempted: docker restart $LIBRECHAT_CONTAINER; recent last-stable rollback when available.\nRollback pointer: $ROLLBACK_POINTER\nDiagnostics file: $diagnostics\n$(diagnostic_summary "$diagnostics")"
}

host_app_fallback_restart() {
  [[ "$HOST_APP_FALLBACK_RESTART" == "true" ]] || return 0
  local failures now last_restart
  failures="$(read_value "$STATE_DIR/app.failures" 0)"
  (( failures >= HOST_APP_RESTART_FAILURE_THRESHOLD )) || return 0
  now="$(now_epoch)"
  last_restart="$(read_value "$STATE_DIR/app.last-restart" 0)"
  (( now - last_restart >= APP_RESTART_COOLDOWN_SECONDS )) || return 0
  write_value "$STATE_DIR/app.last-restart" "$now"
  write_value "$STATE_DIR/app.last-action" "host-ssh-container-restart"
  ssh -o BatchMode=yes -o ConnectTimeout="$HEALTH_TIMEOUT_SECONDS" "timeng@$VM_HOST" \
    "docker restart '$LIBRECHAT_CONTAINER' >/dev/null" || true
}

host_iteration() {
  local vm_ok=false app_ok=false detail diagnostics
  drain_remote_events
  if maintenance_file_active "$MAINTENANCE_FILE"; then
    reset_check_state vm; reset_check_state app
    log "Monitoring suppressed for planned maintenance: $(maintenance_reason "$MAINTENANCE_FILE")"
    return 0
  fi

  timeout "$HEALTH_TIMEOUT_SECONDS" bash -c "exec 3<>/dev/tcp/$VM_HOST/$VM_SSH_PORT" >/dev/null 2>&1 && vm_ok=true
  if [[ "$vm_ok" != "true" ]]; then
    detail="VM SSH $VM_HOST:$VM_SSH_PORT is unreachable; Proxmox VM $(sudo -n qm status "$VM_ID" 2>&1 || true)."
    if mark_failure vm "$detail"; then
      diagnostics="$(capture_host_diagnostics vm)"
      notify_event vm-down "LibreChat VM DOWN" "$detail" \
        "Failure threshold: $(read_value "$STATE_DIR/vm.failures" 0). Planned recovery: graceful VM reboot at $VM_REBOOT_FAILURE_THRESHOLD failures, hard reset at $VM_RESET_FAILURE_THRESHOLD failures.\nDiagnostics file: $diagnostics\n$(diagnostic_summary "$diagnostics")"
    fi
    heal_vm_if_needed
    return 0
  fi
  mark_success vm "VM SSH endpoint is reachable." vm-healed "LibreChat VM HEALED"

  if remote_maintenance_active; then
    reset_check_state app
    log "Application monitoring suppressed for active VM deployment/maintenance."
    return 0
  fi

  curl -fsS --max-time "$HEALTH_TIMEOUT_SECONDS" "$VM_HEALTH_URL" >/dev/null 2>&1 && app_ok=true
  if [[ "$app_ok" == "true" ]]; then
    mark_success app "External LibreChat /api/config endpoint is healthy." app-healed "LibreChat APP HEALED"
  else
    detail="VM is reachable but LibreChat HTTP endpoint $VM_HEALTH_URL failed."
    if mark_failure app "$detail"; then
      diagnostics="$(capture_host_diagnostics app)"
      notify_event app-down "LibreChat APP DOWN" "$detail" \
        "The in-VM watchdog should restart the LibreChat container. Host SSH fallback begins at $HOST_APP_RESTART_FAILURE_THRESHOLD failures.\nDiagnostics file: $diagnostics\n$(diagnostic_summary "$diagnostics")"
    fi
    host_app_fallback_restart
  fi
}

vm_iteration() {
  local running state http_code detail diagnostics mongodb_state
  if maintenance_file_active "$MAINTENANCE_FILE"; then
    reset_check_state app
    log "Monitoring and self-healing suppressed for planned maintenance: $(maintenance_reason "$MAINTENANCE_FILE")"
    return 0
  fi

  mongodb_state="$(docker inspect "$MONGODB_CONTAINER" --format '{{.State.Running}}:{{if .State.Health}}{{.State.Health.Status}}{{end}}' 2>/dev/null || true)"
  if [[ "$mongodb_state" == "true:healthy" ]]; then
    mark_success mongodb "MongoDB container healthcheck is healthy." mongodb-healed "LibreChat MongoDB HEALED"
  else
    if mark_failure mongodb "MongoDB container health is '$mongodb_state'."; then
      diagnostics="$(capture_vm_diagnostics)"
      notify_event mongodb-down "LibreChat MongoDB UNHEALTHY" \
        "MongoDB container health is '$mongodb_state'." \
        "A guarded restart is eligible after $MONGODB_RESTART_FAILURE_THRESHOLD failures; no database or session deletion is permitted. Diagnostics file: $diagnostics"
    fi
    heal_mongodb_if_needed
  fi

  running="$(docker inspect "$LIBRECHAT_CONTAINER" --format '{{.State.Running}}' 2>/dev/null || true)"
  state="$(docker inspect "$LIBRECHAT_CONTAINER" --format '{{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} restarts={{.RestartCount}}' 2>/dev/null || echo missing)"
  http_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time "$HEALTH_TIMEOUT_SECONDS" "$LOCAL_HEALTH_URL" 2>/dev/null || true)"
  http_code="${http_code:-000}"
  if [[ "$running" == "true" && "$http_code" =~ ^2 ]]; then
    mark_success app "Container running; local /api/config returned HTTP $http_code." app-healed "LibreChat APP HEALED"
    return 0
  fi

  detail="Container state: $state; local /api/config HTTP: $http_code."
  if mark_failure app "$detail"; then
    diagnostics="$(capture_vm_diagnostics)"
    notify_event app-down "LibreChat APP DOWN" "$detail" \
      "Automatic action: restart $LIBRECHAT_CONTAINER at $APP_RESTART_FAILURE_THRESHOLD failures; cooldown ${APP_RESTART_COOLDOWN_SECONDS}s.\nDiagnostics file: $diagnostics\n$(diagnostic_summary "$diagnostics")"
  fi
  heal_app_if_needed
}

log "Starting LibreChat health monitor from $MONITOR_SOURCE."
while true; do
  if [[ "$MODE" == "host" ]]; then host_iteration; else vm_iteration; fi
  sleep "$CHECK_INTERVAL_SECONDS"
done
