#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/local-services/rail-env.sh"
resolve_librechat_rail "$ROOT_DIR" stable

configured_blkio_device="${LIBRECHAT_BLKIO_DEVICE:-}"
detected_root_blkio_device="$(detect_linux_root_backing_block_device || true)"

if [[ -n "$configured_blkio_device" && -n "$detected_root_blkio_device" && "$configured_blkio_device" != "$detected_root_blkio_device" ]]; then
  echo "Production resource contracts failed: configured blkio device '$configured_blkio_device' does not match the root backing device '$detected_root_blkio_device'." >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

default_services="$(docker compose \
  -f "$ROOT_DIR/docker-compose.yml" \
  -f "$ROOT_DIR/docker-compose.local.override.yml" \
  config --services)"
if printf '%s\n' "$default_services" | grep -q '^langfuse-'; then
  echo "Production resource contracts failed: Langfuse services must remain opt-in." >&2
  exit 1
fi

docker compose \
  --profile langfuse \
  -f "$ROOT_DIR/docker-compose.yml" \
  -f "$ROOT_DIR/docker-compose.local.override.yml" \
  config --format json > "$tmp_dir/librechat.json"

cat > "$tmp_dir/grafana-base.yml" <<'YAML'
services:
  loki: { image: alpine }
  promtail: { image: alpine }
  grafana: { image: alpine }
YAML
cat > "$tmp_dir/prometheus-base.yml" <<'YAML'
services:
  blackbox: { image: alpine }
  prometheus: { image: alpine }
YAML

docker compose -f "$tmp_dir/grafana-base.yml" -f "$ROOT_DIR/local-services/compose/grafana-loki.resources.yml" config --format json > "$tmp_dir/grafana.json"
docker compose -f "$tmp_dir/prometheus-base.yml" -f "$ROOT_DIR/local-services/compose/prometheus.resources.yml" config --format json > "$tmp_dir/prometheus.json"

ROOT_DIR="$ROOT_DIR" \
COMPOSE_JSON="$tmp_dir/librechat.json" \
GRAFANA_JSON="$tmp_dir/grafana.json" \
PROMETHEUS_JSON="$tmp_dir/prometheus.json" \
CONFIGURED_BLKIO_DEVICE="$configured_blkio_device" \
DETECTED_ROOT_BLKIO_DEVICE="$detected_root_blkio_device" \
node <<'NODE'
const fs = require('node:fs');
const compose = JSON.parse(fs.readFileSync(process.env.COMPOSE_JSON, 'utf8'));
const services = compose.services;
const failures = [];
const gib = 1024 ** 3;
const mib = 1024 ** 2;
const configuredBlkioDevice = process.env.CONFIGURED_BLKIO_DEVICE || '';
const detectedRootBlkioDevice = process.env.DETECTED_ROOT_BLKIO_DEVICE || '';
const expectedBlkioDevice = configuredBlkioDevice || detectedRootBlkioDevice;

const required = [
  'api', 'mongodb', 'meilisearch', 'vectordb', 'rag_api', 'rag_api_azure',
  'rag_api_google', 'code-interpreter-local', 'langfuse-worker', 'langfuse-web',
  'langfuse-model-pricing-sync', 'langfuse-clickhouse', 'langfuse-minio',
  'langfuse-redis', 'langfuse-postgres', 'metrics',
];
const core = new Set(['api', 'mongodb']);
const limits = {
  meilisearch: [512 * mib, 0.75],
  vectordb: [768 * mib, 1.0],
  rag_api: [384 * mib, 0.5],
  rag_api_azure: [384 * mib, 0.5],
  rag_api_google: [384 * mib, 0.5],
  'code-interpreter-local': [256 * mib, 0.5],
  'langfuse-worker': [512 * mib, 0.5],
  'langfuse-web': [768 * mib, 0.5],
  'langfuse-model-pricing-sync': [128 * mib, 0.1],
  'langfuse-clickhouse': [1024 * mib, 0.75],
  'langfuse-minio': [192 * mib, 0.25],
  'langfuse-redis': [192 * mib, 0.25],
  'langfuse-postgres': [192 * mib, 0.25],
  metrics: [96 * mib, 0.15],
};

function collectBlkioPaths(io) {
  const paths = new Set();
  for (const entry of io?.device_read_bps ?? []) {
    if (entry?.path) paths.add(entry.path);
  }
  for (const entry of io?.device_write_bps ?? []) {
    if (entry?.path) paths.add(entry.path);
  }
  return [...paths];
}

function validateResourceShape(name, service) {
  if (!service.mem_limit || !service.mem_reservation) failures.push(`${name}: missing memory limit/reservation`);
  if (!(service.cpus > 0)) failures.push(`${name}: missing CPU ceiling`);
  if (!(service.cpu_shares > 0)) failures.push(`${name}: missing CPU shares`);
  if (!(service.pids_limit > 0)) failures.push(`${name}: missing PID ceiling`);
  const io = service.blkio_config;
  const blkioPaths = collectBlkioPaths(io);
  if (!(io?.weight > 0) || !io.device_read_bps?.length || !io.device_write_bps?.length) {
    failures.push(`${name}: missing hard block-IO ceiling`);
  }
  if (blkioPaths.length > 1) failures.push(`${name}: multiple blkio devices configured (${blkioPaths.join(', ')})`);
  if (expectedBlkioDevice && blkioPaths.some((device) => device !== expectedBlkioDevice)) {
    failures.push(`${name}: blkio device does not match ${expectedBlkioDevice}`);
  }
  if (!['always', 'unless-stopped'].includes(service.restart)) failures.push(`${name}: restart policy is ${service.restart}`);
}

for (const name of required) {
  const service = services[name];
  if (!service) { failures.push(`${name}: service missing`); continue; }
  validateResourceShape(name, service);
}

if (Number(services.api.mem_limit) < 5 * gib || Number(services.api.mem_reservation) < 3 * gib || services.api.cpus < 3) {
  failures.push('api: production memory reservation/headroom or CPU priority is too low');
}
if (services.api.cpu_shares < 1024 || services.api.oom_score_adj > -500 || !services.api.healthcheck) {
  failures.push('api: missing protected CPU/OOM priority or healthcheck');
}
if (Number(services.mongodb.mem_limit) < gib || Number(services.mongodb.mem_reservation) < 512 * mib || services.mongodb.cpus < 1) {
  failures.push('mongodb: production memory reservation/headroom or CPU priority is too low');
}
if (services.mongodb.cpu_shares < 1024 || services.mongodb.oom_score_adj > -500 || !services.mongodb.healthcheck) {
  failures.push('mongodb: missing protected CPU/OOM priority or healthcheck');
}
const mongoCommand = (services.mongodb.command ?? []).join(' ');
if (!mongoCommand.includes('--auth') || !mongoCommand.includes('--wiredTigerCacheSizeGB')) {
  failures.push('mongodb: auth or bounded WiredTiger cache command missing');
}
const sandboxEnv = services['code-interpreter-local'].environment ?? {};
if (sandboxEnv.LOCAL_CODE_MEMORY_LIMIT !== '768m' || Number(sandboxEnv.LOCAL_CODE_NANO_CPUS) > 500000000 || Number(sandboxEnv.LOCAL_CODE_PIDS_LIMIT) > 128) {
  failures.push('code-interpreter-local: child sandbox memory/CPU/PID ceilings are not bounded');
}

let auxiliaryMemory = 0;
for (const [name, [maxMemory, maxCpu]] of Object.entries(limits)) {
  const service = services[name];
  if (!service) continue;
  auxiliaryMemory += Number(service.mem_limit);
  if (Number(service.mem_limit) > maxMemory) failures.push(`${name}: memory ceiling exceeds ${maxMemory}`);
  if (service.cpus > maxCpu + 1e-9) failures.push(`${name}: CPU ceiling exceeds ${maxCpu}`);
  if (Number(service.memswap_limit) !== Number(service.mem_limit)) failures.push(`${name}: swap must not exceed memory limit`);
  if (service.cpu_shares >= services.api.cpu_shares) failures.push(`${name}: CPU shares are not lower than API`);
}
if (auxiliaryMemory > 6.5 * gib) failures.push(`auxiliary services: aggregate hard memory ceilings exceed 6.5GiB (${auxiliaryMemory})`);

for (const [label, file, names] of [
  ['local-services/compose/grafana-loki.resources.yml', process.env.GRAFANA_JSON, ['loki', 'promtail', 'grafana']],
  ['local-services/compose/prometheus.resources.yml', process.env.PROMETHEUS_JSON, ['blackbox', 'prometheus']],
]) {
  const sidecarServices = JSON.parse(fs.readFileSync(file, 'utf8')).services;
  for (const name of names) {
    const service = sidecarServices[name];
    if (!service) {
      failures.push(`${label}:${name}: service missing`);
      continue;
    }
    for (const field of ['mem_limit', 'mem_reservation', 'memswap_limit', 'cpus', 'cpu_shares', 'pids_limit', 'blkio_config']) {
      if (service[field] == null) failures.push(`${label}:${name}: missing ${field}`);
    }
    const blkioPaths = collectBlkioPaths(service.blkio_config);
    if (!service.blkio_config?.device_read_bps?.length || !service.blkio_config?.device_write_bps?.length) {
      failures.push(`${label}:${name}: missing hard block-IO ceiling`);
    }
    if (blkioPaths.length > 1) failures.push(`${label}:${name}: multiple blkio devices configured (${blkioPaths.join(', ')})`);
    if (expectedBlkioDevice && blkioPaths.some((device) => device !== expectedBlkioDevice)) {
      failures.push(`${label}:${name}: blkio device does not match ${expectedBlkioDevice}`);
    }
  }
}

if (failures.length) {
  console.error('Production resource contracts failed:');
  failures.forEach((failure) => console.error(`  - ${failure}`));
  process.exit(1);
}
const blkioSuffix = expectedBlkioDevice ? ` blkio_device=${expectedBlkioDevice}` : '';
console.log(`Production resource contracts: PASS (auxiliary hard-memory total=${Math.round(auxiliaryMemory / mib)}MiB${blkioSuffix})`);
NODE
