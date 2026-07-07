#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT

cat >"$fixture/docker" <<'DOCKER'
#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  inspect)
    if [[ "${2:-}" == "-f" ]]; then
      format="$3"
      if [[ "$format" == *Config.Entrypoint* ]]; then
        printf '%s\n' "${FAKE_RUNTIME_JSON}"
      else
        printf '%s\n' "${FAKE_CONTAINER_BYTES}"
      fi
    else
      exit 0
    fi
    ;;
  exec)
    command_text="${*:4}"
    if [[ "$command_text" == *NODE_OPTIONS* ]]; then
      printf '%s' "${FAKE_NODE_OPTIONS}"
    elif [[ "$command_text" == *memory.max* ]]; then
      printf '%s|%s' "${FAKE_CGROUP_MAX}" "${FAKE_CGROUP_CURRENT}"
    elif [[ "$command_text" == *proc/1/cmdline* ]]; then
      printf '%s' "${FAKE_PID_ONE}"
    else
      exit 1
    fi
    ;;
  *)
    exit 1
    ;;
esac
DOCKER
chmod +x "$fixture/docker"

export PATH="$fixture:$PATH"
export FAKE_RUNTIME_JSON='["docker-entrypoint.sh"]|["npm","run","backend"]|unless-stopped|true|false'
export FAKE_PID_ONE='npm run backend '
export FAKE_CONTAINER_BYTES=$((5 * 1024 * 1024 * 1024))
export FAKE_NODE_OPTIONS='--max-old-space-size=4096'
export FAKE_CGROUP_MAX="$FAKE_CONTAINER_BYTES"
export FAKE_CGROUP_CURRENT=$((3 * 1024 * 1024 * 1024))

"$ROOT_DIR/local-services/verify-api-runtime-contract.sh" --container test >/dev/null
"$ROOT_DIR/local-services/verify-api-memory-headroom.sh" --container test >/dev/null

export FAKE_RUNTIME_JSON='["docker-entrypoint.sh"]|["sleep","infinity"]|unless-stopped|true|false'
if "$ROOT_DIR/local-services/verify-api-runtime-contract.sh" --container test >"$fixture/runtime-negative.log" 2>&1; then
  echo "ERROR: runtime verifier accepted a sleep-infinity container" >&2
  exit 1
fi
grep -q 'builder/repair sentinel' "$fixture/runtime-negative.log"

export FAKE_RUNTIME_JSON='["docker-entrypoint.sh"]|["npm","run","backend"]|unless-stopped|true|false'
export FAKE_CGROUP_CURRENT=$((4600 * 1024 * 1024))
if "$ROOT_DIR/local-services/verify-api-memory-headroom.sh" --container test >"$fixture/heap-negative.log" 2>&1; then
  echo "ERROR: heap verifier accepted insufficient live cgroup headroom" >&2
  exit 1
fi
grep -q 'live cgroup headroom' "$fixture/heap-negative.log"

for guarded_script in \
  local-services/deploy-runtime-delta.sh \
  local-services/deploy-built-client-dist.sh \
  local-services/start-all.sh \
  local-services/librechat-rollback-last-stable.sh; do
  grep -q 'verify-api-runtime-contract.sh' "$ROOT_DIR/$guarded_script" || {
    echo "ERROR: $guarded_script does not enforce the canonical API runtime contract" >&2
    exit 1
  }
  grep -q 'verify-api-memory-headroom.sh' "$ROOT_DIR/$guarded_script" || {
    echo "ERROR: $guarded_script does not enforce API memory headroom" >&2
    exit 1
  }
done

grep -q 'docker commit --pause=false' "$ROOT_DIR/local-services/deploy-built-client-dist.sh" || {
  echo "ERROR: stable frontend promotion does not persist the verified runtime image" >&2
  exit 1
}
grep -q 'LIBRECHAT_API_IMAGE=' "$ROOT_DIR/local-services/deploy-built-client-dist.sh" || {
  echo "ERROR: stable frontend promotion does not persist the recreation image tag" >&2
  exit 1
}

grep -q "envPath = '/app/.env'" "$ROOT_DIR/local-services/verify-auth-memory-runtime-contracts.sh" || {
  echo "ERROR: auth verifier does not compare running secrets with persistent /app/.env" >&2
  exit 1
}

echo "API runtime safeguard verifier self-test: PASS"
