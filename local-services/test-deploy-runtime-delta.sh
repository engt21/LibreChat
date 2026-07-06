#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT

backend_log="$fixture/backend.log"
package_file_log="$fixture/package-file.log"
package_multi_log="$fixture/package-multi.log"

make_remote_fixture() {
  local name="$1"
  local root="$fixture/$name"

  mkdir -p "$root/local-services" "$root/api/server" "$root/mock-bin"
  cp "$ROOT_DIR/local-services/deploy-runtime-delta.sh" "$root/local-services/"
  printf '%s\n' 'module.exports = {};' > "$root/api/server/index.js"
  : > "$root/docker-compose.local.override.yml"

  cat > "$root/local-services/verify-auth-memory-runtime-contracts.sh" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

  cat > "$root/local-services/librechat-deployment-fallback.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
printf 'snapshot-%s\n' "$1" >> "$FALLBACK_LOG"
if [[ "$1" == "start" ]]; then
  cat > "$root/local-services/librechat-deployment-fallback.sh" <<'INNER'
#!/usr/bin/env bash
printf 'mutable-%s\n' "$1" >> "$FALLBACK_LOG"
INNER
  chmod +x "$root/local-services/librechat-deployment-fallback.sh"
fi
EOF

  cat > "$root/mock-bin/ssh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$SSH_LOG"
if [[ ! -t 0 ]]; then
  cat >/dev/null
fi
if [[ "${MOCK_HEADROOM_FAIL:-0}" == "1" && "$*" == *"verify-api-memory-headroom.sh"* ]]; then
  exit 1
fi
exit 0
EOF

  cat > "$root/mock-bin/curl" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

  chmod +x \
    "$root/local-services/deploy-runtime-delta.sh" \
    "$root/local-services/librechat-deployment-fallback.sh" \
    "$root/local-services/verify-auth-memory-runtime-contracts.sh" \
    "$root/mock-bin/ssh" \
    "$root/mock-bin/curl"

  printf '%s\n' "$root"
}

bash -n "$ROOT_DIR/local-services/deploy-runtime-delta.sh"

"$ROOT_DIR/local-services/deploy-runtime-delta.sh" dev --dry-run -- api/server/index.js >"$backend_log"
grep -Fq 'Container files to copy into /app:' "$backend_log"
grep -Fxq '  - api/server/index.js' "$backend_log"
grep -Fq 'Would restart librechat-dev-api' "$backend_log"

"$ROOT_DIR/local-services/deploy-runtime-delta.sh" dev --dry-run -- packages/api/dist/index.js >"$package_file_log"
grep -Fq 'Container directories to replace under /app:' "$package_file_log"
grep -Fxq '  - packages/api/dist' "$package_file_log"
if grep -Fq 'packages/api/dist/index.js' "$package_file_log"; then
  echo "ERROR: partial packages/api/dist member survived classification instead of promoting to packages/api/dist" >&2
  exit 1
fi

"$ROOT_DIR/local-services/deploy-runtime-delta.sh" dev --dry-run -- \
  packages/data-provider/dist/index.js \
  packages/data-provider/dist/index.es.js >"$package_multi_log"
if [[ "$(grep -Fxc '  - packages/data-provider/dist' "$package_multi_log")" -ne 1 ]]; then
  echo "ERROR: packages/data-provider/dist was not deduplicated as one coherent dist tree" >&2
  exit 1
fi
if grep -Fq 'packages/data-provider/dist/index.js' "$package_multi_log" || grep -Fq 'packages/data-provider/dist/index.es.js' "$package_multi_log"; then
  echo "ERROR: partial packages/data-provider/dist members survived classification instead of promoting to packages/data-provider/dist" >&2
  exit 1
fi

grep -Fq 'rolling back staged runtime delta' "$ROOT_DIR/local-services/deploy-runtime-delta.sh"
if grep -Fq 'headroom remains deferred' "$ROOT_DIR/local-services/deploy-runtime-delta.sh"; then
  echo "ERROR: stable post-deploy headroom failure is still deferred instead of failing closed" >&2
  exit 1
fi


snapshot_root="$(make_remote_fixture fallback-snapshot)"
snapshot_fallback_log="$snapshot_root/fallback.log"
snapshot_ssh_log="$snapshot_root/ssh.log"
(
  cd "$snapshot_root"
  PATH="$snapshot_root/mock-bin:$PATH" \
    FALLBACK_LOG="$snapshot_fallback_log" \
    SSH_LOG="$snapshot_ssh_log" \
    LIBRECHAT_STABLE_RUNTIME_DELTA_APPROVAL=YES \
    ./local-services/deploy-runtime-delta.sh stable \
      --approve-stable \
      --remote test@example.invalid \
      --remote-root /opt/LibreChat-custom \
      --health-url http://127.0.0.1:3080 \
      -- api/server/index.js local-services/librechat-deployment-fallback.sh
)
grep -Fxq 'snapshot-start' "$snapshot_fallback_log"
grep -Fxq 'snapshot-finish' "$snapshot_fallback_log"
if grep -Fq 'mutable-finish' "$snapshot_fallback_log"; then
  echo "ERROR: fallback finish reused the mutable canonical helper" >&2
  exit 1
fi
if compgen -G "$snapshot_root/local-services/.deploy-runtime-delta-fallback.*" >/dev/null; then
  echo "ERROR: immutable fallback snapshot was not removed after success" >&2
  exit 1
fi

headroom_root="$(make_remote_fixture headroom-failure)"
headroom_fallback_log="$headroom_root/fallback.log"
headroom_ssh_log="$headroom_root/ssh.log"
if (
  cd "$headroom_root"
  PATH="$headroom_root/mock-bin:$PATH" \
    FALLBACK_LOG="$headroom_fallback_log" \
    SSH_LOG="$headroom_ssh_log" \
    MOCK_HEADROOM_FAIL=1 \
    LIBRECHAT_STABLE_RUNTIME_DELTA_APPROVAL=YES \
    ./local-services/deploy-runtime-delta.sh stable \
      --approve-stable \
      --remote test@example.invalid \
      --remote-root /opt/LibreChat-custom \
      --health-url http://127.0.0.1:3080 \
      -- api/server/index.js
); then
  echo "ERROR: failed predeploy headroom check was bypassed by a local compose override" >&2
  exit 1
fi
if grep -Fq 'docker inspect LibreChat' "$headroom_ssh_log"; then
  echo "ERROR: remote staging began after the predeploy headroom check failed" >&2
  exit 1
fi
grep -Fxq 'snapshot-abort' "$headroom_fallback_log"
if compgen -G "$headroom_root/local-services/.deploy-runtime-delta-fallback.*" >/dev/null; then
  echo "ERROR: immutable fallback snapshot was not removed after failure" >&2
  exit 1
fi
echo "deploy-runtime-delta focused safeguards: PASS"
