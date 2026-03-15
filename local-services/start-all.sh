#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROMETHEUS_COMPOSE="/pool/home/timeng/librechat_exporter/prometheus-dev/docker-compose.yml"
GRAFANA_COMPOSE="/pool/home/timeng/librechat_exporter/grafana-loki-dev/docker-compose.yml"

for _ in $(seq 1 30); do
  if docker info >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

docker info >/dev/null

docker compose -f "$ROOT_DIR/docker-compose.yml" -f "$ROOT_DIR/docker-compose.override.yml" up -d
docker compose -f "$PROMETHEUS_COMPOSE" up -d
docker compose -f "$GRAFANA_COMPOSE" up -d

if ! "$ROOT_DIR/local-services/keep-ollama-warm.sh"; then
  echo "Warning: failed to warm remote Ollama model" >&2
fi
