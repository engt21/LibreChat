#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_script="$ROOT_DIR/local-services/librechat-deployment-fallback.sh"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT

mkdir -p "$fixture/local-services" "$fixture/bin"
cp "$source_script" "$fixture/local-services/librechat-deployment-fallback.sh"
chmod +x "$fixture/local-services/librechat-deployment-fallback.sh"

cat > "$fixture/local-services/librechat-health-maintenance.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${TEST_MAINTENANCE_LOG:?}"
EOF
chmod +x "$fixture/local-services/librechat-health-maintenance.sh"

cat > "$fixture/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
state_dir="${TEST_STATE_DIR:?}"
main_container="${TEST_MAIN_CONTAINER:-LibreChat}"
fallback_container="${TEST_FALLBACK_CONTAINER:-LibreChat-deploy-fallback}"
fallback_state="$state_dir/fallback-container"
docker_log="$state_dir/docker.log"
printf 'docker %s\n' "$*" >> "$docker_log"

case "$1" in
  inspect)
    target="${2:-}"
    if [[ "$target" == "-f" ]]; then
      target="${4:-}"
    fi
    if [[ "$target" == "$main_container" ]]; then
      exit 0
    fi
    if [[ "$target" == "$fallback_container" && -f "$fallback_state" ]]; then
      if [[ "${3:-}" == "--format" ]]; then
        printf 'running\n'
      fi
      exit 0
    fi
    exit 1
    ;;
  commit)
    exit 0
    ;;
  run)
    : > "$fallback_state"
    printf 'fallback-id\n'
    ;;
  rm)
    rm -f "$fallback_state"
    ;;
  image)
    if [[ "${2:-}" == "inspect" ]]; then
      printf 'sha256:test-fallback-image\n'
      exit 0
    fi
    exit 1
    ;;
  *)
    exit 1
    ;;
esac
EOF
chmod +x "$fixture/bin/docker"

cat > "$fixture/bin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
state_dir="${TEST_STATE_DIR:?}"
fallback_state="$state_dir/fallback-container"
url="${!#}"

if [[ "$url" == "http://127.0.0.1:3082/api/config" ]]; then
  [[ -f "$fallback_state" ]] && exit 0
  exit 22
fi

if [[ "$url" == "http://127.0.0.1:3080/api/config" ]]; then
  [[ "${TEST_STABLE_HEALTH:-up}" == "up" ]] && exit 0
  exit 22
fi

if [[ "$url" == *"/api/config" ]]; then
  exit 0
fi

exit 22
EOF
chmod +x "$fixture/bin/curl"

cat > "$fixture/bin/sudo" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
state_dir="${TEST_STATE_DIR:?}"
printf 'sudo %s\n' "$*" >> "$state_dir/sudo.log"
if [[ "${1:-}" == "-n" ]]; then
  shift
fi
if [[ "${1:-}" == "tailscale" && "${2:-}" == "serve" ]]; then
  printf '%s\n' "${!#}" > "$state_dir/serve-target"
  exit 0
fi
exit 1
EOF
chmod +x "$fixture/bin/sudo"

cat > "$fixture/bin/nohup" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
state_dir="${TEST_STATE_DIR:?}"
printf '%s\n' "$*" >> "$state_dir/nohup.log"
exit 0
EOF
chmod +x "$fixture/bin/nohup"

export PATH="$fixture/bin:$PATH"
export TEST_STATE_DIR="$fixture/state"
export TEST_MAIN_CONTAINER="LibreChat"
export TEST_FALLBACK_CONTAINER="LibreChat-deploy-fallback"
export TEST_MAINTENANCE_LOG="$fixture/maintenance.log"
mkdir -p "$TEST_STATE_DIR"

script="$fixture/local-services/librechat-deployment-fallback.sh"
export LIBRECHAT_STABLE_ROOT="$fixture"
export LIBRECHAT_FALLBACK_STATE_DIR="$fixture/.rails/stable/deployment-fallback"
export LIBRECHAT_STABLE_CONTAINER="$TEST_MAIN_CONTAINER"
export LIBRECHAT_FALLBACK_CONTAINER="$TEST_FALLBACK_CONTAINER"
export LIBRECHAT_FALLBACK_ABORT_TTL_SECONDS=45

"$script" start >/dev/null
marker="$LIBRECHAT_FALLBACK_STATE_DIR/active"
grep -q '^status=active$' "$marker"
session_id="$(grep -m1 '^session_id=' "$marker" | cut -d= -f2)"
[[ -n "$session_id" ]]
[[ "$(cat "$TEST_STATE_DIR/serve-target")" == "http://127.0.0.1:3082" ]]
[[ -f "$TEST_STATE_DIR/fallback-container" ]]

"$script" abort >/dev/null
grep -q '^status=aborted$' "$marker"
grep -q '^abort_expires_at_epoch=' "$marker"
grep -q "expire $session_id" "$TEST_STATE_DIR/nohup.log"
grep -q '^stop$' "$TEST_MAINTENANCE_LOG"

export TEST_STABLE_HEALTH=down
past_expiry="$(( $(date -u +%s) - 1 ))"
sed -i "s/^abort_expires_at_epoch=.*/abort_expires_at_epoch=$past_expiry/" "$marker"
sed -i "s/^abort_expires_at=.*/abort_expires_at=expired-for-test/" "$marker"
"$script" expire "$session_id" "$past_expiry" >/dev/null
[[ ! -e "$marker" ]]
[[ ! -e "$TEST_STATE_DIR/fallback-container" ]]
[[ "$(cat "$TEST_STATE_DIR/serve-target")" == "http://127.0.0.1:3080" ]]

export TEST_STABLE_HEALTH=up
"$script" start >/dev/null
[[ -f "$TEST_STATE_DIR/fallback-container" ]]
"$script" finish >/dev/null
[[ ! -e "$LIBRECHAT_FALLBACK_STATE_DIR/active" ]]
[[ ! -e "$TEST_STATE_DIR/fallback-container" ]]
[[ "$(cat "$TEST_STATE_DIR/serve-target")" == "http://127.0.0.1:3080" ]]

grep -q "docker commit --pause=false" "$source_script"
grep -q "image_id=" "$source_script"
grep -q -- "--memory=2g" "$source_script"
grep -q -- "--cpus=2" "$source_script"
grep -q -- "--pids-limit=384" "$source_script"
grep -q "NODE_OPTIONS=--max-old-space-size=1536" "$source_script"
grep -q "expire .*abort_expires_epoch" "$source_script"

echo "Deployment fallback contract: PASS"
