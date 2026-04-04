#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/local-services/rail-env.sh"

REQUESTED_RAIL="${1:-all}"

LOCAL_OVERRIDE_COMPOSE="$ROOT_DIR/docker-compose.local.override.yml"

"$ROOT_DIR/local-services/ensure-runtime-files.sh"

compose_args=(-f "$ROOT_DIR/docker-compose.yml" -f "$LOCAL_OVERRIDE_COMPOSE")

if [[ "$REQUESTED_RAIL" == "all" ]]; then
  rails=(stable dev)
else
  rails=("$REQUESTED_RAIL")
fi

for rail in "${rails[@]}"; do
  resolve_librechat_rail "$ROOT_DIR" "$rail"
  echo "== LibreChat ($LIBRECHAT_RAIL) =="
  docker compose "${compose_args[@]}" ps || true
  echo
done

if shared_observability_available; then
  echo "== Prometheus =="
  env -u COMPOSE_PROJECT_NAME docker compose -f "$PROMETHEUS_COMPOSE" ps

  echo
  echo "== Grafana/Loki =="
  LIBRECHAT_LOG_DIR="$ROOT_DIR/logs" env -u COMPOSE_PROJECT_NAME docker compose -f "$GRAFANA_COMPOSE" ps
else
  echo "== Shared observability sidecars =="
  echo "Not configured under $LIBRECHAT_EXPORTER_ROOT"
fi

echo
echo "== Ollama keep-warm timer =="
systemctl --user list-timers librechat-ollama-keepwarm.timer --no-pager || true

echo
echo "== Ollama keep-warm service =="
systemctl --user status librechat-ollama-keepwarm.service --no-pager || true
