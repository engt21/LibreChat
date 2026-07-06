#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELPER="$ROOT_DIR/local-services/run-benchmark-production-priority.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR/bin" "$TMP_DIR/state"

cat > "$TMP_DIR/bin/curl" <<'EOF'
#!/usr/bin/env bash
if [[ -n "${FAKE_CURL_SEQUENCE_FILE:-}" && -s "$FAKE_CURL_SEQUENCE_FILE" ]]; then
  result="$(head -1 "$FAKE_CURL_SEQUENCE_FILE")"
  tail -n +2 "$FAKE_CURL_SEQUENCE_FILE" > "$FAKE_CURL_SEQUENCE_FILE.next"
  mv "$FAKE_CURL_SEQUENCE_FILE.next" "$FAKE_CURL_SEQUENCE_FILE"
  exit "$result"
fi
exit "${FAKE_CURL_EXIT:-0}"
EOF

cat > "$TMP_DIR/bin/docker" <<'EOF'
#!/usr/bin/env bash
if [[ "$1" == inspect && "$3" == *Running* ]]; then
  echo true
  exit 0
fi
if [[ "$1" == inspect ]]; then
  echo "${FAKE_MONGO_HEALTH:-healthy}"
  exit 0
fi
if [[ "$1" == exec ]]; then
  exit "${FAKE_MONGO_PING_EXIT:-0}"
fi
exit 1
EOF

cat > "$TMP_DIR/bin/systemd-run" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" > "${FAKE_SYSTEMD_RUN_LOG:?}"
EOF

cat > "$TMP_DIR/bin/systemctl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${FAKE_SYSTEMCTL_ALL_LOG:?}"
if [[ "$*" == *"is-active"* ]]; then
  if [[ -n "${FAKE_ACTIVE_BUDGET_FILE:-}" && -s "$FAKE_ACTIVE_BUDGET_FILE" ]]; then
    budget="$(cat "$FAKE_ACTIVE_BUDGET_FILE")"
    if (( budget > 0 )); then
      echo $((budget - 1)) > "$FAKE_ACTIVE_BUDGET_FILE"
      exit 0
    fi
  fi
  exit 1
fi
if [[ "$*" == *" kill "* ]]; then
  printf '%s\n' "$*" >> "${FAKE_SYSTEMCTL_LOG:?}"
  exit 0
fi
if [[ "$*" == *"show"* ]]; then
  echo 0
  exit 0
fi
exit 0
EOF

cat > "$TMP_DIR/bin/sleep" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

chmod +x "$TMP_DIR/bin/"*

export LIBRECHAT_BENCHMARK_CURL_BIN="$TMP_DIR/bin/curl"
export LIBRECHAT_BENCHMARK_DOCKER_BIN="$TMP_DIR/bin/docker"
export LIBRECHAT_BENCHMARK_SYSTEMCTL_BIN="$TMP_DIR/bin/systemctl"
export LIBRECHAT_BENCHMARK_SYSTEMD_RUN_BIN="$TMP_DIR/bin/systemd-run"
export LIBRECHAT_BENCHMARK_SLEEP_BIN="$TMP_DIR/bin/sleep"
export LIBRECHAT_BENCHMARK_STATE_ROOT="$TMP_DIR/state"
export LIBRECHAT_BENCHMARK_HEALTH_STREAK=1
export LIBRECHAT_BENCHMARK_CHECK_INTERVAL_SECONDS=0
export LIBRECHAT_BENCHMARK_IO_DEVICE=/dev/fake-benchmark
export FAKE_SYSTEMD_RUN_LOG="$TMP_DIR/systemd-run.log"
export FAKE_SYSTEMCTL_LOG="$TMP_DIR/systemctl.log"
export FAKE_SYSTEMCTL_ALL_LOG="$TMP_DIR/systemctl-all.log"

policy="$($HELPER --print-policy)"
grep -q '^CPUQuota=20%$' <<<"$policy"
grep -q '^MemoryMax=2G$' <<<"$policy"
grep -q '^IOWeight=10$' <<<"$policy"
grep -q '^IOReadBandwidthMax=20M$' <<<"$policy"

$HELPER --check-health

FAKE_MONGO_HEALTH=unhealthy
export FAKE_MONGO_HEALTH
if $HELPER --check-health; then
  echo 'Expected unhealthy MongoDB check to fail' >&2
  exit 1
fi
FAKE_MONGO_HEALTH=healthy
export FAKE_MONGO_HEALTH

$HELPER --unit test-benchmark --working-directory "$ROOT_DIR" -- /bin/true
grep -q -- '--property=CPUQuota=20%' "$FAKE_SYSTEMD_RUN_LOG"
grep -q -- '--property=MemoryMax=2G' "$FAKE_SYSTEMD_RUN_LOG"
grep -q -- '--property=IOWeight=10' "$FAKE_SYSTEMD_RUN_LOG"
grep -q -- '--property=IOReadBandwidthMax=/dev/fake-benchmark 20M' "$FAKE_SYSTEMD_RUN_LOG"
grep -q -- '--property=IOWriteBandwidthMax=/dev/fake-benchmark 10M' "$FAKE_SYSTEMD_RUN_LOG"
grep -q -- '--setenv=LIBRECHAT_BENCHMARK_PRODUCTION_PRIORITY=1' "$FAKE_SYSTEMD_RUN_LOG"
grep -q '^status=finished_exit_0$' "$TMP_DIR/state/test-benchmark.env"

printf '0\n1\n0\n0\n' > "$TMP_DIR/curl-sequence"
printf '2\n' > "$TMP_DIR/active-budget"
export FAKE_CURL_SEQUENCE_FILE="$TMP_DIR/curl-sequence"
export FAKE_ACTIVE_BUDGET_FILE="$TMP_DIR/active-budget"
: > "$FAKE_SYSTEMCTL_LOG"
$HELPER --unit health-transition-test --working-directory "$ROOT_DIR" -- /bin/true
grep -q -- '--signal=STOP' "$FAKE_SYSTEMCTL_LOG"
grep -q -- '--signal=CONT' "$FAKE_SYSTEMCTL_LOG"
grep -q '^status=finished_exit_0$' "$TMP_DIR/state/health-transition-test.env"

printf '0\n0\n' > "$TMP_DIR/curl-sequence"
printf '1\n' > "$TMP_DIR/active-budget"
: > "$FAKE_SYSTEMCTL_LOG"
: > "$FAKE_SYSTEMCTL_ALL_LOG"
$HELPER --adopt-unit existing-benchmark --working-directory "$ROOT_DIR"
grep -q -- 'kill --kill-whom=all --signal=STOP existing-benchmark' "$FAKE_SYSTEMCTL_ALL_LOG"
grep -q -- 'set-property --runtime existing-benchmark' "$FAKE_SYSTEMCTL_ALL_LOG"
grep -q -- 'CPUQuota=20%' "$FAKE_SYSTEMCTL_ALL_LOG"
grep -q -- 'IOReadBandwidthMax=/dev/fake-benchmark 20M' "$FAKE_SYSTEMCTL_ALL_LOG"
grep -q -- 'kill --kill-whom=all --signal=CONT existing-benchmark' "$FAKE_SYSTEMCTL_ALL_LOG"

echo 'Benchmark production-priority safeguards: PASS'
