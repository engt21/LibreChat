#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROMETHEUS_COMPOSE="/pool/home/timeng/librechat_exporter/prometheus-dev/docker-compose.yml"
GRAFANA_COMPOSE="/pool/home/timeng/librechat_exporter/grafana-loki-dev/docker-compose.yml"

docker compose -f "$ROOT_DIR/docker-compose.yml" -f "$ROOT_DIR/docker-compose.override.yml" stop
docker compose -f "$PROMETHEUS_COMPOSE" stop
docker compose -f "$GRAFANA_COMPOSE" stop
