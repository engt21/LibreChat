#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERIFY_SCRIPT="$ROOT_DIR/local-services/verify-refresh-token-runtime-contract.sh"
fixture_root="$(mktemp -d)"

cleanup() {
  rm -rf "$fixture_root"
}
trap cleanup EXIT

mkdir -p "$fixture_root/packages/data-schemas/dist"

write_valid_fixture() {
  local target="$1"
  cat >"$target" <<'FIXTURE'
const JWT_ISSUER = process.env.JWT_ISSUER || 'librechat';
const JWT_REFRESH_AUDIENCE = process.env.JWT_REFRESH_AUDIENCE || 'librechat-refresh';
const refreshOptions = {
  tokenType: 'refresh',
  issuer: JWT_ISSUER,
  audience: JWT_REFRESH_AUDIENCE,
  jwtId: session._id.toString(),
};
FIXTURE
}

write_valid_fixture "$fixture_root/packages/data-schemas/dist/index.cjs"
write_valid_fixture "$fixture_root/packages/data-schemas/dist/index.es.js"

"$VERIFY_SCRIPT" --root "$fixture_root" >/dev/null

sed -i "s/librechat-refresh/broken-refresh-audience/" \
  "$fixture_root/packages/data-schemas/dist/index.es.js"

if "$VERIFY_SCRIPT" --root "$fixture_root" >"$fixture_root/negative.log" 2>&1; then
  echo "ERROR: verifier accepted a compiled bundle with a missing refresh audience fallback" >&2
  exit 1
fi

grep -q "index.es.js: missing librechat-refresh fallback audience" \
  "$fixture_root/negative.log" || {
    cat "$fixture_root/negative.log" >&2
    echo "ERROR: verifier failed for an unexpected reason" >&2
    exit 1
  }

grep -q 'verify-refresh-token-runtime-contract.sh' \
  "$ROOT_DIR/local-services/verify-auth-memory-runtime-contracts.sh" || {
    echo "ERROR: broad auth/memory verifier does not invoke the refresh-token verifier" >&2
    exit 1
  }

echo "Refresh-token runtime-contract verifier self-test: PASS"
