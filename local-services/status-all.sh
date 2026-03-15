#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROMETHEUS_COMPOSE="/pool/home/timeng/librechat_exporter/prometheus-dev/docker-compose.yml"
GRAFANA_COMPOSE="/pool/home/timeng/librechat_exporter/grafana-loki-dev/docker-compose.yml"

echo "== LibreChat =="
docker compose -f "$ROOT_DIR/docker-compose.yml" -f "$ROOT_DIR/docker-compose.override.yml" ps

echo
echo "== Prometheus =="
docker compose -f "$PROMETHEUS_COMPOSE" ps

echo
echo "== Grafana/Loki =="
docker compose -f "$GRAFANA_COMPOSE" ps

echo
echo "== Ollama keep-warm timer =="
systemctl --user list-timers librechat-ollama-keepwarm.timer --no-pager || true

echo
echo "== Ollama keep-warm service =="
systemctl --user status librechat-ollama-keepwarm.service --no-pager || true
