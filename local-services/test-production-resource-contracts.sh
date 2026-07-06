#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

source "$ROOT_DIR/local-services/rail-env.sh"
detected_root_blkio_device="$(detect_linux_root_backing_block_device)"
[[ "$detected_root_blkio_device" == /dev/* ]] || {
  echo "ERROR: could not resolve the Linux root backing block device" >&2
  exit 1
}

resolve_librechat_rail "$ROOT_DIR" stable
[[ "${LIBRECHAT_BLKIO_DEVICE:-}" == "$detected_root_blkio_device" ]] || {
  echo "ERROR: stable rail did not export the detected root backing device" >&2
  exit 1
}

"$ROOT_DIR/local-services/verify-production-resource-contracts.sh"

if LIBRECHAT_STABLE_BLKIO_DEVICE=/dev/not-the-root-device \
  "$ROOT_DIR/local-services/verify-production-resource-contracts.sh" >"$tmp_dir/blkio-negative.log" 2>&1; then
  echo "ERROR: verifier accepted a non-root stable blkio device override" >&2
  exit 1
fi
grep -q 'root backing device' "$tmp_dir/blkio-negative.log"

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

GRAFANA_JSON="$tmp_dir/grafana.json" PROMETHEUS_JSON="$tmp_dir/prometheus.json" node <<'NODE'
const fs = require('node:fs');
const failures = [];
for (const [file, names] of [
  [process.env.GRAFANA_JSON, ['loki', 'promtail', 'grafana']],
  [process.env.PROMETHEUS_JSON, ['blackbox', 'prometheus']],
]) {
  const services = JSON.parse(fs.readFileSync(file, 'utf8')).services;
  for (const name of names) {
    const service = services[name];
    if (!service.mem_limit || !service.mem_reservation || !service.cpus || !service.pids_limit) failures.push(`${name}: basic ceiling missing`);
    if (!service.blkio_config?.device_read_bps?.length || !service.blkio_config?.device_write_bps?.length) failures.push(`${name}: IO ceiling missing`);
  }
}
if (failures.length) {
  failures.forEach((failure) => console.error(failure));
  process.exit(1);
}
NODE

if grep -q 'compose_services+=("${shared_traceability_services\\[@\\]}")' "$ROOT_DIR/local-services/start-all.sh"; then
  echo "ERROR: stable startup still explicitly enables shared Langfuse services" >&2
  exit 1
fi

if grep -Eq -- '--profile[[:space:]]+langfuse' "$ROOT_DIR/local-services/start-all.sh"; then
  echo "ERROR: stable startup still explicitly enables the Langfuse profile" >&2
  exit 1
fi

grep -q 'verify_restart_safety' "$ROOT_DIR/local-services/librechat-health-monitor.sh"
grep -q 'No database/session deletion was attempted' "$ROOT_DIR/local-services/librechat-health-monitor.sh"

echo "Production resource contract self-test: PASS"
