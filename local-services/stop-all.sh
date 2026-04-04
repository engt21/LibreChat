#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/local-services/rail-env.sh"

REQUESTED_RAIL="${1:-${LIBRECHAT_RAIL:-stable}}"

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
  docker compose "${compose_args[@]}" stop || true
done

if [[ "$REQUESTED_RAIL" == "stable" || "$REQUESTED_RAIL" == "all" ]]; then
  if shared_observability_available; then
    env -u COMPOSE_PROJECT_NAME docker compose -f "$PROMETHEUS_COMPOSE" stop
    LIBRECHAT_LOG_DIR="$ROOT_DIR/logs" env -u COMPOSE_PROJECT_NAME docker compose -f "$GRAFANA_COMPOSE" stop
  fi
fi
