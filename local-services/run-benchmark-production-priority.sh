#!/usr/bin/env bash
set -euo pipefail

HEALTH_URL="${LIBRECHAT_BENCHMARK_HEALTH_URL:-http://127.0.0.1:3080/api/config}"
MONGO_CONTAINER="${LIBRECHAT_BENCHMARK_MONGO_CONTAINER:-chat-mongodb}"
HEALTH_STREAK="${LIBRECHAT_BENCHMARK_HEALTH_STREAK:-3}"
CHECK_INTERVAL="${LIBRECHAT_BENCHMARK_CHECK_INTERVAL_SECONDS:-10}"
CPU_QUOTA="${LIBRECHAT_BENCHMARK_CPU_QUOTA:-20%}"
CPU_WEIGHT="${LIBRECHAT_BENCHMARK_CPU_WEIGHT:-10}"
MEMORY_HIGH="${LIBRECHAT_BENCHMARK_MEMORY_HIGH:-1536M}"
MEMORY_MAX="${LIBRECHAT_BENCHMARK_MEMORY_MAX:-2G}"
MEMORY_SWAP_MAX="${LIBRECHAT_BENCHMARK_MEMORY_SWAP_MAX:-0}"
IO_WEIGHT="${LIBRECHAT_BENCHMARK_IO_WEIGHT:-10}"
IO_DEVICE="${LIBRECHAT_BENCHMARK_IO_DEVICE:-}"
IO_READ_BANDWIDTH_MAX="${LIBRECHAT_BENCHMARK_IO_READ_BANDWIDTH_MAX:-20M}"
IO_WRITE_BANDWIDTH_MAX="${LIBRECHAT_BENCHMARK_IO_WRITE_BANDWIDTH_MAX:-10M}"
NICE_LEVEL="${LIBRECHAT_BENCHMARK_NICE:-15}"
STATE_ROOT="${LIBRECHAT_BENCHMARK_STATE_ROOT:-$HOME/.local/state/librechat-benchmark-priority}"

CURL_BIN="${LIBRECHAT_BENCHMARK_CURL_BIN:-curl}"
DOCKER_BIN="${LIBRECHAT_BENCHMARK_DOCKER_BIN:-docker}"
SYSTEMCTL_BIN="${LIBRECHAT_BENCHMARK_SYSTEMCTL_BIN:-systemctl}"
SYSTEMD_RUN_BIN="${LIBRECHAT_BENCHMARK_SYSTEMD_RUN_BIN:-systemd-run}"
SLEEP_BIN="${LIBRECHAT_BENCHMARK_SLEEP_BIN:-sleep}"
FINDMNT_BIN="${LIBRECHAT_BENCHMARK_FINDMNT_BIN:-findmnt}"

usage() {
  cat <<'EOF'
Usage:
  local-services/run-benchmark-production-priority.sh --check-health
  local-services/run-benchmark-production-priority.sh --print-policy
  local-services/run-benchmark-production-priority.sh --adopt-unit NAME [--working-directory DIR]
  local-services/run-benchmark-production-priority.sh [--unit NAME] [--working-directory DIR] -- <command...>

The command waits for repeated LibreChat and MongoDB health, launches the benchmark
inside a low-priority user-systemd service, pauses it immediately if production health
degrades, and resumes it only after health is stable again.
EOF
}

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

validate_integer() {
  local name="$1"
  local value="$2"
  [[ "$value" =~ ^[0-9]+$ ]] || fail "$name must be a non-negative integer, got: $value"
}

check_librechat_health() {
  "$CURL_BIN" -fsS --max-time 5 "$HEALTH_URL" >/dev/null
}

check_mongo_health() {
  local running health
  running="$($DOCKER_BIN inspect -f '{{.State.Running}}' "$MONGO_CONTAINER" 2>/dev/null || true)"
  [[ "$running" == "true" ]] || return 1

  health="$($DOCKER_BIN inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$MONGO_CONTAINER" 2>/dev/null || true)"
  case "$health" in
    healthy)
      return 0
      ;;
    unhealthy|starting)
      return 1
      ;;
  esac

  "$DOCKER_BIN" exec "$MONGO_CONTAINER" mongosh --quiet --eval \
    'quit(db.adminCommand({ping: 1}).ok === 1 ? 0 : 1)' >/dev/null 2>&1
}

production_healthy() {
  check_librechat_health && check_mongo_health
}

write_state() {
  local unit="$1"
  local status="$2"
  mkdir -p "$STATE_ROOT"
  printf 'unit=%s\nstatus=%s\nupdated=%s\nhealth_url=%s\nmongo_container=%s\n' \
    "$unit" "$status" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$HEALTH_URL" "$MONGO_CONTAINER" \
    > "$STATE_ROOT/$unit.env"
}

wait_for_stable_health() {
  local unit="$1"
  local consecutive=0
  while (( consecutive < HEALTH_STREAK )); do
    if production_healthy; then
      consecutive=$((consecutive + 1))
      write_state "$unit" "waiting_healthy_${consecutive}_of_${HEALTH_STREAK}"
    else
      consecutive=0
      write_state "$unit" 'waiting_for_librechat_and_mongo'
    fi
    if (( consecutive < HEALTH_STREAK )); then
      "$SLEEP_BIN" "$CHECK_INTERVAL"
    fi
  done
}

print_policy() {
  cat <<EOF
CPUQuota=$CPU_QUOTA
CPUWeight=$CPU_WEIGHT
MemoryHigh=$MEMORY_HIGH
MemoryMax=$MEMORY_MAX
MemorySwapMax=$MEMORY_SWAP_MAX
IOWeight=$IO_WEIGHT
IODevice=${IO_DEVICE:-auto}
IOReadBandwidthMax=$IO_READ_BANDWIDTH_MAX
IOWriteBandwidthMax=$IO_WRITE_BANDWIDTH_MAX
Nice=$NICE_LEVEL
HealthURL=$HEALTH_URL
MongoContainer=$MONGO_CONTAINER
HealthyChecksRequired=$HEALTH_STREAK
EOF
}

unit="librechat-benchmark-$(date -u +%Y%m%dT%H%M%SZ)"
working_directory="$PWD"
mode='run'
adopted=false
command=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check-health)
      mode='check-health'
      shift
      ;;
    --print-policy)
      mode='print-policy'
      shift
      ;;
    --unit)
      unit="${2:?Missing value after --unit}"
      shift 2
      ;;
    --adopt-unit)
      mode='adopt'
      adopted=true
      unit="${2:?Missing value after --adopt-unit}"
      shift 2
      ;;
    --working-directory)
      working_directory="${2:?Missing value after --working-directory}"
      shift 2
      ;;
    --)
      shift
      command=("$@")
      break
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

validate_integer LIBRECHAT_BENCHMARK_HEALTH_STREAK "$HEALTH_STREAK"
validate_integer LIBRECHAT_BENCHMARK_CHECK_INTERVAL_SECONDS "$CHECK_INTERVAL"
(( HEALTH_STREAK >= 1 )) || fail 'LIBRECHAT_BENCHMARK_HEALTH_STREAK must be at least 1'

case "$mode" in
  check-health)
    production_healthy
    exit
    ;;
  print-policy)
    print_policy
    exit
    ;;
esac

if [[ "$mode" == run ]]; then
  [[ ${#command[@]} -gt 0 ]] || fail 'Missing benchmark command after --'
elif [[ ${#command[@]} -gt 0 ]]; then
  fail '--adopt-unit does not accept a command'
fi
[[ "$unit" =~ ^[A-Za-z0-9_.@:-]+$ ]] || fail "Unsafe systemd unit name: $unit"
[[ -d "$working_directory" ]] || fail "Working directory does not exist: $working_directory"

required_binaries=("$CURL_BIN" "$DOCKER_BIN" "$SYSTEMCTL_BIN" "$SLEEP_BIN")
if [[ "$mode" == run ]]; then
  required_binaries+=("$SYSTEMD_RUN_BIN")
fi
for binary in "${required_binaries[@]}"; do
  command -v "$binary" >/dev/null 2>&1 || fail "Required command not found: $binary"
done

if [[ -z "$IO_DEVICE" ]]; then
  command -v "$FINDMNT_BIN" >/dev/null 2>&1 || fail "Required command not found: $FINDMNT_BIN"
  IO_DEVICE="$($FINDMNT_BIN -no SOURCE --target "$working_directory" 2>/dev/null || true)"
fi
[[ "$IO_DEVICE" == /dev/* ]] || fail \
  "Could not resolve a block device for strict IO limits; set LIBRECHAT_BENCHMARK_IO_DEVICE"

if $adopted; then
  "$SYSTEMCTL_BIN" --user is-active --quiet "$unit" || fail "Benchmark unit is not active: $unit"
  "$SYSTEMCTL_BIN" --user kill --kill-whom=all --signal=STOP "$unit"
  write_state "$unit" paused_for_policy_application
  "$SYSTEMCTL_BIN" --user set-property --runtime "$unit" \
    CPUAccounting=yes \
    "CPUQuota=$CPU_QUOTA" \
    "CPUWeight=$CPU_WEIGHT" \
    MemoryAccounting=yes \
    "MemoryHigh=$MEMORY_HIGH" \
    "MemoryMax=$MEMORY_MAX" \
    "MemorySwapMax=$MEMORY_SWAP_MAX" \
    IOAccounting=yes \
    "IOWeight=$IO_WEIGHT" \
    "IOReadBandwidthMax=$IO_DEVICE $IO_READ_BANDWIDTH_MAX" \
    "IOWriteBandwidthMax=$IO_DEVICE $IO_WRITE_BANDWIDTH_MAX"
  echo "Waiting for LibreChat and MongoDB health before resuming $unit"
  wait_for_stable_health "$unit"
  "$SYSTEMCTL_BIN" --user kill --kill-whom=all --signal=CONT "$unit"
else
  echo "Waiting for LibreChat and MongoDB health before starting $unit"
  wait_for_stable_health "$unit"
  "$SYSTEMD_RUN_BIN" \
    --user \
    --unit="$unit" \
    --collect \
    --service-type=exec \
    --working-directory="$working_directory" \
    --property=CPUAccounting=yes \
    --property="CPUQuota=$CPU_QUOTA" \
    --property="CPUWeight=$CPU_WEIGHT" \
    --property=MemoryAccounting=yes \
    --property="MemoryHigh=$MEMORY_HIGH" \
    --property="MemoryMax=$MEMORY_MAX" \
    --property="MemorySwapMax=$MEMORY_SWAP_MAX" \
    --property=IOAccounting=yes \
    --property="IOWeight=$IO_WEIGHT" \
    --property="IOReadBandwidthMax=$IO_DEVICE $IO_READ_BANDWIDTH_MAX" \
    --property="IOWriteBandwidthMax=$IO_DEVICE $IO_WRITE_BANDWIDTH_MAX" \
    --property="Nice=$NICE_LEVEL" \
    --property=OOMPolicy=stop \
    --setenv=LIBRECHAT_BENCHMARK_PRODUCTION_PRIORITY=1 \
    -- "${command[@]}"
fi

write_state "$unit" running
paused=false
benchmark_started=true
benchmark_finished=false

stop_unsupervised_benchmark() {
  if ${benchmark_started:-false} && ! ${benchmark_finished:-false}; then
    if $adopted; then
      "$SYSTEMCTL_BIN" --user kill --kill-whom=all --signal=STOP "$unit" >/dev/null 2>&1 || true
      write_state "$unit" paused_without_supervisor
    else
      "$SYSTEMCTL_BIN" --user stop "$unit" >/dev/null 2>&1 || true
      write_state "$unit" stopped_with_supervisor
    fi
    benchmark_started=false
  fi
}

handle_supervisor_signal() {
  stop_unsupervised_benchmark
  trap - EXIT INT TERM
  exit 130
}

trap stop_unsupervised_benchmark EXIT
trap handle_supervisor_signal INT TERM

while "$SYSTEMCTL_BIN" --user is-active --quiet "$unit"; do
  if production_healthy; then
    if $paused; then
      wait_for_stable_health "$unit"
      "$SYSTEMCTL_BIN" --user kill --kill-whom=all --signal=CONT "$unit"
      paused=false
      write_state "$unit" running
      echo "Production health stable; resumed $unit"
    fi
  elif ! $paused; then
    "$SYSTEMCTL_BIN" --user kill --kill-whom=all --signal=STOP "$unit"
    paused=true
    write_state "$unit" paused_for_production_health
    echo "Production health degraded; paused $unit" >&2
  fi
  "$SLEEP_BIN" "$CHECK_INTERVAL"
done

exit_status="$($SYSTEMCTL_BIN --user show "$unit" --property=ExecMainStatus --value 2>/dev/null || echo 1)"
write_state "$unit" "finished_exit_${exit_status}"
benchmark_finished=true
[[ "$exit_status" =~ ^[0-9]+$ ]] || exit_status=1
exit "$exit_status"
