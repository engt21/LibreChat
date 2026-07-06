#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VM_TARGET="${LIBRECHAT_STABLE_SSH_TARGET:-timeng@192.168.50.104}"
dry_run=false
approve=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) dry_run=true; shift ;;
    --approve-stable) approve=true; shift ;;
    -h|--help)
      echo "Usage: $0 [--dry-run] [--approve-stable]"
      exit 0
      ;;
    *) echo "ERROR: unknown option: $1" >&2; exit 2 ;;
  esac
done

"$ROOT_DIR/local-services/verify-production-resource-contracts.sh"

grafana_source="$ROOT_DIR/local-services/compose/grafana-loki.resources.yml"
prometheus_source="$ROOT_DIR/local-services/compose/prometheus.resources.yml"

echo "Would install resource overrides on $VM_TARGET:"
echo "  $grafana_source -> /opt/librechat_exporter/grafana-loki-stable/docker-compose.resources.yml"
echo "  $prometheus_source -> /opt/librechat_exporter/prometheus-stable/docker-compose.resources.yml"
echo "Would recreate only the grafana-loki-stable and prometheus-stable compose services with their base files plus these overrides."

$dry_run && exit 0
$approve || { echo "ERROR: --approve-stable is required" >&2; exit 1; }
[[ "${LIBRECHAT_STABLE_RESOURCE_APPROVAL:-}" == "YES" ]] || { echo "ERROR: LIBRECHAT_STABLE_RESOURCE_APPROVAL=YES is required" >&2; exit 1; }

scp "$grafana_source" "$VM_TARGET:/opt/librechat_exporter/grafana-loki-stable/docker-compose.resources.yml"
scp "$prometheus_source" "$VM_TARGET:/opt/librechat_exporter/prometheus-stable/docker-compose.resources.yml"
ssh "$VM_TARGET" 'set -euo pipefail
  cd /opt/librechat_exporter/grafana-loki-stable
  docker compose -f docker-compose.yml -f docker-compose.resources.yml config >/dev/null
  docker compose -f docker-compose.yml -f docker-compose.resources.yml up -d
  cd /opt/librechat_exporter/prometheus-stable
  docker compose -f docker-compose.yml -f docker-compose.resources.yml config >/dev/null
  docker compose -f docker-compose.yml -f docker-compose.resources.yml up -d'
