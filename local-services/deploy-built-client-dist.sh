#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_DIST_DIR="$ROOT_DIR/client/dist"
MANIFEST_FILENAME=".librechat-client-dist-manifest.json"
DEPLOYMENT_POLICY="complete-built-client-dist-v1"
stable_runtime_image="${LIBRECHAT_STABLE_RUNTIME_IMAGE:-librechat-local:runtime-current}"

usage() {
  cat <<'USAGE'
Usage:
  ./local-services/deploy-built-client-dist.sh <dev|stable> [options]

Deploys a complete, successfully built `client/dist` tree to one running API rail.
This is the only supported code-only deployment path for frontend `client/src/**`
changes. It never patches hashed JavaScript files or service-worker references.

Options:
  --dist DIR             Built dist directory (default: client/dist)
  --validate-only        Validate the built dist and exit without Docker changes
  --approve-stable       Required together with LIBRECHAT_STABLE_CLIENT_APPROVAL=YES
                         before targeting the production/stable rail
  --health-timeout SEC   Seconds to wait for HTTP recovery (default: 60)
  -h, --help             Show this help

Required build workflow before deployment:
  ./local-services/run-node-capped.sh --memory-max 8G --heap-mb 4096 -- npm run build:client

Stable example after explicit user approval:
  LIBRECHAT_STABLE_CLIENT_APPROVAL=YES ./local-services/deploy-built-client-dist.sh stable --approve-stable

A verified stable promotion snapshots the running filesystem into
librechat-local:runtime-current so a later container recreation keeps the
deployed frontend without a full image rebuild.
USAGE
}

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

resolve_stable_api_container() {
  local by_label

  if [[ -n "${LIBRECHAT_STABLE_API_CONTAINER:-}" ]]; then
    printf '%s\n' "$LIBRECHAT_STABLE_API_CONTAINER"
    return
  fi

  if docker inspect LibreChat >/dev/null 2>&1; then
    printf '%s\n' "LibreChat"
    return
  fi

  if [[ -n "${LIBRECHAT_API_CONTAINER_NAME:-}" ]]; then
    printf '%s\n' "$LIBRECHAT_API_CONTAINER_NAME"
    return
  fi

  by_label="$(docker ps \
    --filter 'label=com.docker.compose.project=librechat-stable' \
    --filter 'label=com.docker.compose.service=api' \
    --format '{{.Names}}' 2>/dev/null | grep -vE 'builder|repair|contract' | head -1)"
  if [[ -n "$by_label" ]]; then
    printf '%s\n' "$by_label"
    return
  fi

  printf '%s\n' "librechat-stable-api"
}

rail="${1:-}"
if [[ -z "$rail" || "$rail" == "-h" || "$rail" == "--help" ]]; then
  usage
  [[ -n "$rail" ]] && exit 0 || exit 2
fi
shift

dist_dir="$DEFAULT_DIST_DIR"
validate_only=false
approve_stable=false
health_timeout=60

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dist)
      dist_dir="${2:?Missing path after --dist}"
      shift 2
      ;;
    --validate-only)
      validate_only=true
      shift
      ;;
    --approve-stable)
      approve_stable=true
      shift
      ;;
    --health-timeout)
      health_timeout="${2:?Missing seconds after --health-timeout}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "Unknown option: $1"
      ;;
  esac
done

case "$rail" in
  dev)
    container="librechat-dev-api"
    host_port=3081
    ;;
  stable)
    container="$(resolve_stable_api_container)"
    host_port=3080
    if ! $validate_only; then
      $approve_stable || fail "Stable deployment requires --approve-stable after explicit user approval."
      [[ "${LIBRECHAT_STABLE_CLIENT_APPROVAL:-}" == "YES" ]] || fail "Stable deployment requires LIBRECHAT_STABLE_CLIENT_APPROVAL=YES."
    fi
    ;;
  *)
    fail "Rail must be 'dev' or 'stable', got: $rail"
    ;;
esac

[[ "$health_timeout" =~ ^[0-9]+$ ]] || fail "--health-timeout must be an integer."
[[ -d "$dist_dir" ]] || fail "Built frontend directory is missing: $dist_dir"
[[ -f "$dist_dir/$MANIFEST_FILENAME" ]] || fail "Missing $MANIFEST_FILENAME. Run a fresh client build; hand-edited dist trees are forbidden."

echo "Validating complete built client dist: $dist_dir"
node - "$dist_dir" "$ROOT_DIR/client" "$MANIFEST_FILENAME" "$DEPLOYMENT_POLICY" <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const [distDirectory, clientDirectory, manifestFilename, expectedPolicy] = process.argv.slice(2);
const manifestPath = path.join(distDirectory, manifestFilename);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.deploymentPolicy !== expectedPolicy) {
  throw new Error(`Invalid client dist deployment policy: ${manifest.deploymentPolicy}`);
}
const generatedAt = Date.parse(manifest.generatedAt);
if (!Number.isFinite(generatedAt)) {
  throw new Error('Client dist manifest has no valid generatedAt timestamp.');
}
const html = fs.readFileSync(path.join(distDirectory, 'index.html'), 'utf8');
const assetReferences = [...html.matchAll(/(?:src|href)="\.\/assets\/([^"#?]+)([^" ]*)"/g)];
if (assetReferences.length === 0) {
  throw new Error('No built frontend asset references found in dist/index.html.');
}
for (const [, assetPath, suffix] of assetReferences) {
  if (suffix) {
    throw new Error(`Asset URL suffix is forbidden in built index.html (${assetPath}${suffix}); deploy a fresh complete build instead of cache-busting/patching generated assets.`);
  }
  if (!fs.existsSync(path.join(distDirectory, 'assets', assetPath))) {
    throw new Error(`Built index.html references missing asset: assets/${assetPath}`);
  }
}
const recordedFiles = Object.entries(manifest.files ?? {});
if (recordedFiles.length === 0) {
  throw new Error('Client dist manifest has no file hashes.');
}
function listFiles(directory, rootDirectory = directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listFiles(absolutePath, rootDirectory);
    return [path.relative(rootDirectory, absolutePath)];
  });
}
const actualFiles = listFiles(distDirectory).filter((relativePath) => relativePath !== manifestFilename).sort();
const manifestFiles = recordedFiles.map(([relativePath]) => relativePath).sort();
if (JSON.stringify(actualFiles) !== JSON.stringify(manifestFiles)) {
  throw new Error('Built dist contains added or removed files not covered by its integrity manifest. Run a fresh client build.');
}
for (const [relativePath, expectedHash] of recordedFiles) {
  const absolutePath = path.join(distDirectory, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Built dist file is missing after build: ${relativePath}`);
  }
  const actualHash = crypto.createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex');
  if (actualHash !== expectedHash) {
    throw new Error(`Built dist was modified after its manifest was written: ${relativePath}`);
  }
}
function newestMtime(target) {
  if (!fs.existsSync(target)) return 0;
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) return stat.mtimeMs;
  return fs.readdirSync(target, { withFileTypes: true }).reduce((newest, entry) => {
    return Math.max(newest, newestMtime(path.join(target, entry.name)));
  }, 0);
}
const inputPaths = ['src', 'public', 'index.html', 'vite.config.ts', 'vite.config.js'].map((relativePath) => path.join(clientDirectory, relativePath));
const newestInput = Math.max(...inputPaths.map(newestMtime));
if (newestInput > generatedAt + 1000) {
  throw new Error('Frontend input files are newer than the built dist manifest. Run a fresh client build before deployment.');
}
console.log(`Validated ${recordedFiles.length} manifest-tracked built files.`);
NODE

if $validate_only; then
  echo "Validation-only mode: no container was changed."
  exit 0
fi

command -v docker >/dev/null 2>&1 || fail "docker is required for deployment."
docker inspect "$container" >/dev/null 2>&1 || fail "Target container does not exist: $container"
[[ "$(docker inspect -f '{{.State.Running}}' "$container")" == "true" ]] || fail "Target container is not running: $container"

if [[ "$rail" == "stable" ]]; then
  echo "Validating mandatory OpenAI reasoning preservation invariants before stable frontend promotion..."
  "$ROOT_DIR/local-services/verify-openai-reasoning-preservation.sh" --container "$container"
  echo "Validating authentication and memory runtime contracts before stable frontend promotion..."
  "$ROOT_DIR/local-services/verify-auth-memory-runtime-contracts.sh" --container "$container"
  echo "Validating canonical API runtime contract before stable frontend promotion..."
  "$ROOT_DIR/local-services/verify-api-runtime-contract.sh" --container "$container"
  echo "Validating API memory headroom before stable frontend promotion..."
  "$ROOT_DIR/local-services/verify-api-memory-headroom.sh" --container "$container"
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
maintenance_file="${LIBRECHAT_HEALTH_MAINTENANCE_FILE:-$HOME/.local/state/librechat-health-monitor/maintenance}"
maintenance_started=false
deployment_fallback="$ROOT_DIR/local-services/librechat-deployment-fallback.sh"
fallback_started=false
clear_deploy_maintenance() {
  if $maintenance_started; then
    rm -f "$maintenance_file"
  fi
}
client_deployment_cleanup() {
  if $fallback_started; then
    "$deployment_fallback" abort >/dev/null 2>&1 || true
  else
    clear_deploy_maintenance
  fi
}
if [[ "$rail" == "stable" ]]; then
  [[ -x "$deployment_fallback" ]] || fail "Missing deployment fallback helper: $deployment_fallback"
  "$deployment_fallback" start
  fallback_started=true
  mkdir -p "$(dirname "$maintenance_file")"
  expires=$(( $(date +%s) + ${LIBRECHAT_DEPLOY_MAINTENANCE_SECONDS:-1800} ))
  printf 'expires=%s\nreason=%s\nstarted=%s\n' "$expires" "frontend deployment $timestamp" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$maintenance_file"
  chmod 600 "$maintenance_file"
  maintenance_started=true
  trap client_deployment_cleanup EXIT
fi
snapshot_dir="$ROOT_DIR/output/client-dist-deployments/${timestamp}-${rail}-predeploy"
container_stage="/app/client.dist.stage-${timestamp}"
container_rollback="/app/client.dist.rollback-${timestamp}"
container_failed="/app/client.dist.failed-${timestamp}"
mkdir -p "$snapshot_dir/client-dist"

echo "Snapshotting current $rail client dist to: $snapshot_dir/client-dist"
docker cp "$container:/app/client/dist/." "$snapshot_dir/client-dist/" >/dev/null
cp "$dist_dir/$MANIFEST_FILENAME" "$snapshot_dir/candidate-manifest.json"
if [[ "$rail" == "stable" ]]; then
  pointer_dir="$HOME/.local/state/librechat-health-monitor"
  mkdir -p "$pointer_dir"
  printf 'type=client\nsnapshot=%s\ncontainer=%s\nroot=%s\ncreated_epoch=%s\ncreated_utc=%s\n' \
    "$snapshot_dir" "$container" "$ROOT_DIR" "$(date +%s)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    > "$pointer_dir/last-stable.env"
  chmod 600 "$pointer_dir/last-stable.env"
fi

echo "Staging complete built dist in $container"
docker exec "$container" sh -lc "rm -rf '$container_stage' '$container_rollback' '$container_failed'; mkdir -p '$container_stage'"
docker cp "$dist_dir/." "$container:$container_stage/" >/dev/null

echo "Atomically swapping the complete client dist tree and restarting $container"
docker exec "$container" sh -lc "mv /app/client/dist '$container_rollback'; mv '$container_stage' /app/client/dist"
docker restart "$container" >/dev/null

extract_entry_asset() {
  node - "$1" <<'NODE'
const fs = require('node:fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
const match = html.match(/src="\.\/(assets\/[^"#?]+\.js)"/);
if (!match) process.exit(1);
process.stdout.write(match[1]);
NODE
}

wait_for_entry_asset() {
  local entry_asset="$1"
  local response_file="$2"
  for ((attempt = 0; attempt < health_timeout; attempt += 2)); do
    if curl -fsS "http://127.0.0.1:${host_port}/" >"$response_file" 2>/dev/null && \
      grep -Fq "$entry_asset" "$response_file" && \
      curl -fsS "http://127.0.0.1:${host_port}/${entry_asset}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

entry_asset="$(extract_entry_asset "$dist_dir/index.html")" || fail "Unable to determine built JavaScript entry asset."
rollback_entry_asset="$(extract_entry_asset "$snapshot_dir/client-dist/index.html")" || fail "Unable to determine rollback JavaScript entry asset."

if ! wait_for_entry_asset "$entry_asset" /tmp/librechat-client-deploy-index.html; then
  echo "Frontend health verification failed; rolling back complete prior client dist." >&2
  docker exec "$container" sh -lc "mv /app/client/dist '$container_failed'; mv '$container_rollback' /app/client/dist"
  docker restart "$container" >/dev/null
  if ! wait_for_entry_asset "$rollback_entry_asset" /tmp/librechat-client-rollback-index.html; then
    fail "Deployment failed and automatic rollback did not recover HTTP health. Inspect $snapshot_dir and container logs immediately."
  fi
  if [[ "$rail" == "stable" ]]; then
    "$deployment_fallback" finish
    fallback_started=false
  fi
  fail "Deployment was rolled back and prior frontend health recovered. Inspect $snapshot_dir and container logs."
fi

if [[ "$rail" == "stable" ]]; then
  echo "Re-validating mandatory OpenAI reasoning preservation invariants after stable frontend promotion..."
  "$ROOT_DIR/local-services/verify-openai-reasoning-preservation.sh" --container "$container"
  echo "Re-validating authentication and memory runtime contracts after stable frontend promotion..."
  "$ROOT_DIR/local-services/verify-auth-memory-runtime-contracts.sh" --container "$container"
  echo "Re-validating canonical API runtime contract after stable frontend promotion..."
  "$ROOT_DIR/local-services/verify-api-runtime-contract.sh" --container "$container"
  echo "Re-validating API memory headroom after stable frontend promotion..."
  "$ROOT_DIR/local-services/verify-api-memory-headroom.sh" --container "$container"
  echo "Snapshotting verified frontend runtime image for rebuild-free container recreation..."
  docker commit --pause=false "$container" "$stable_runtime_image" >/dev/null
  if grep -q '^LIBRECHAT_API_IMAGE=' "$ROOT_DIR/.env"; then
    sed -i "s|^LIBRECHAT_API_IMAGE=.*|LIBRECHAT_API_IMAGE=$stable_runtime_image|" "$ROOT_DIR/.env"
  else
    printf '%s\n' "LIBRECHAT_API_IMAGE=$stable_runtime_image" >> "$ROOT_DIR/.env"
  fi
fi

if [[ "$rail" == "stable" ]]; then
  "$deployment_fallback" finish
  fallback_started=false
fi
clear_deploy_maintenance
maintenance_started=false
trap - EXIT
echo "Complete built frontend deployed successfully to $rail."
echo "Rollback copy retained in container: $container_rollback"
echo "Host rollback snapshot retained at: $snapshot_dir/client-dist"
echo "Required next step: perform authenticated browser validation of affected UI behavior."
