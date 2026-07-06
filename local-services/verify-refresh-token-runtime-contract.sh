#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container=""

usage() {
  cat <<'USAGE'
Usage: ./local-services/verify-refresh-token-runtime-contract.sh [--root DIR] [--container NAME]

Fails unless refresh-token generation preserves the production authentication contract:
  - tokenType=refresh
  - issuer JWT_ISSUER (default librechat)
  - audience JWT_REFRESH_AUDIENCE (default librechat-refresh)
  - JWT ID equal to the session ID

When --container is provided, also generates and decodes a synthetic refresh token entirely
in memory inside the target container. It does not read or modify any user, password, TOTP
secret, session, or database record.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --root)
      [[ $# -ge 2 ]] || { echo "ERROR: --root requires a directory" >&2; exit 2; }
      ROOT_DIR="$(cd "$2" && pwd)"
      shift 2
      ;;
    --container)
      [[ $# -ge 2 ]] || { echo "ERROR: --container requires a name" >&2; exit 2; }
      container="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

ROOT_DIR="$ROOT_DIR" node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const root = process.env.ROOT_DIR;
const sourcePath = path.join(root, 'packages/data-schemas/src/methods/session.ts');
const distCandidates = [
  path.join(root, 'packages/data-schemas/dist/index.cjs'),
  path.join(root, 'packages/data-schemas/dist/index.es.js'),
];
const markers = [
  [/tokenType:\s*['"]refresh['"]/, 'tokenType=refresh'],
  [/JWT_ISSUER/, 'JWT_ISSUER'],
  [/JWT_REFRESH_AUDIENCE/, 'JWT_REFRESH_AUDIENCE'],
  [/librechat-refresh/, 'librechat-refresh fallback audience'],
  [/jwtId:\s*session\._id\.toString\(\)/, 'session JWT ID'],
];
const failures = [];

function validateFile(file, required) {
  if (!fs.existsSync(file)) {
    if (required) failures.push(`${file}: missing`);
    return false;
  }
  const text = fs.readFileSync(file, 'utf8');
  for (const [pattern, label] of markers) {
    if (!pattern.test(text)) failures.push(`${file}: missing ${label}`);
  }
  return true;
}

validateFile(sourcePath, false);
const existingDist = distCandidates.filter((file) => fs.existsSync(file));
if (existingDist.length === 0) {
  failures.push(`${path.join(root, 'packages/data-schemas/dist')}: no compiled bundle found`);
} else {
  for (const file of existingDist) validateFile(file, true);
}

if (failures.length > 0) {
  console.error('Refresh-token source/compiled contract failed:');
  failures.forEach((failure) => console.error(`  - ${failure}`));
  process.exit(1);
}
console.log('Refresh-token source/compiled contract: PASS');
NODE

if [[ -n "$container" ]]; then
  docker inspect "$container" >/dev/null 2>&1 || {
    echo "ERROR: container does not exist: $container" >&2
    exit 1
  }
  docker exec -i "$container" node <<'NODE'
const fs = require('node:fs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const schemas = require('@librechat/data-schemas');

(async () => {
  const compiledPath = '/app/packages/data-schemas/dist/index.cjs';
  const compiled = fs.readFileSync(compiledPath, 'utf8');
  const markers = [
    [/tokenType:\s*['"]refresh['"]/, 'tokenType=refresh'],
    [/JWT_ISSUER/, 'JWT_ISSUER'],
    [/JWT_REFRESH_AUDIENCE/, 'JWT_REFRESH_AUDIENCE'],
    [/librechat-refresh/, 'librechat-refresh fallback audience'],
    [/jwtId:\s*session\._id\.toString\(\)/, 'session JWT ID'],
  ];
  for (const [pattern, label] of markers) {
    if (!pattern.test(compiled)) throw new Error(`${compiledPath} missing ${label}`);
  }

  const methods = schemas.createMethods(mongoose);
  const sessionId = new mongoose.Types.ObjectId();
  const session = {
    _id: sessionId,
    user: new mongoose.Types.ObjectId(),
    expiration: new Date(Date.now() + 10 * 60 * 1000),
    save: async () => {},
  };
  const token = await methods.generateRefreshToken(session);
  const decoded = jwt.decode(token);
  const expectedIssuer = process.env.JWT_ISSUER || 'librechat';
  const expectedAudience = process.env.JWT_REFRESH_AUDIENCE || 'librechat-refresh';
  if (decoded?.iss !== expectedIssuer) throw new Error(`issuer mismatch: ${decoded?.iss}`);
  if (decoded?.aud !== expectedAudience) throw new Error(`audience mismatch: ${decoded?.aud}`);
  if (decoded?.tokenType !== 'refresh') throw new Error(`token type mismatch: ${decoded?.tokenType}`);
  if (decoded?.jti !== sessionId.toString()) throw new Error(`JWT ID mismatch: ${decoded?.jti}`);
  console.log('Live synthetic refresh-token contract: PASS');
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
NODE
fi
