#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/local-services/rail-env.sh"

REQUESTED_RAIL="${1:-${LIBRECHAT_RAIL:-stable}}"
resolve_librechat_rail "$ROOT_DIR" "$REQUESTED_RAIL"

LOCAL_OVERRIDE_COMPOSE="$ROOT_DIR/docker-compose.local.override.yml"

if [[ ! -d "$LOCAL_RAG_API_ROOT" ]]; then
  echo "Missing local rag_api checkout at $LOCAL_RAG_API_ROOT" >&2
  echo "Clone it first, for example: git clone https://github.com/danny-avila/rag_api.git \"$LOCAL_RAG_API_ROOT\"" >&2
  exit 1
fi

"$ROOT_DIR/local-services/ensure-runtime-files.sh"
prepare_librechat_rail_paths

for _ in $(seq 1 30); do
  if docker info >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

docker info >/dev/null

# LOCAL_CODE_SANDBOX_PYTHON_IMAGE is already set per-rail by resolve_librechat_rail.
# Only rebuild if it carries the rail-specific default tag; a user override is left as-is.
if [[ "$LOCAL_CODE_SANDBOX_PYTHON_IMAGE" == "librechat-local-sandbox-python-${LIBRECHAT_RAIL}:latest" ]]; then
  docker build \
    -t "$LOCAL_CODE_SANDBOX_PYTHON_IMAGE" \
    -f "$ROOT_DIR/local-code-interpreter/python-sandbox.Dockerfile" \
    "$ROOT_DIR/local-code-interpreter"
fi

compose_args=(-f "$ROOT_DIR/docker-compose.yml" -f "$LOCAL_OVERRIDE_COMPOSE")
compose_services=(
  api
  mongodb
  meilisearch
  vectordb
  rag_api
  rag_api_azure
  rag_api_google
  code-interpreter-local
)

shared_traceability_services=(
  langfuse-worker
  langfuse-web
  langfuse-model-pricing-sync
  langfuse-clickhouse
  langfuse-minio
  langfuse-redis
  langfuse-postgres
)

if [[ "$LIBRECHAT_RAIL" == "stable" ]]; then
  compose_services+=("${shared_traceability_services[@]}")

  if metrics_build_context_available; then
    compose_services+=(metrics)
  else
    echo "Skipping metrics service because exporter repo was not found at $LIBRECHAT_EXPORTER_ROOT" >&2
  fi
else
  # Dev reuses the stable telemetry stack to avoid duplicating Langfuse and exporter workloads.
  docker compose "${compose_args[@]}" rm -sf "${shared_traceability_services[@]}" metrics >/dev/null 2>&1 || true
fi

docker compose "${compose_args[@]}" config >/dev/null
docker compose "${compose_args[@]}" up -d --build --force-recreate --remove-orphans "${compose_services[@]}"

if [[ "$LIBRECHAT_MANAGE_SHARED_SERVICES" == "true" ]]; then
  if shared_observability_available; then
    env -u COMPOSE_PROJECT_NAME docker compose -f "$PROMETHEUS_COMPOSE" up -d
    LIBRECHAT_LOG_DIR="$LIBRECHAT_LOGS_DIR" \
    TOUCHDOWN_LOG_DIR="$TOUCHDOWN_LOG_DIR" \
    TOUCHDOWN_BACKWARDS_LOG_DIR="$TOUCHDOWN_BACKWARDS_LOG_DIR" \
      env -u COMPOSE_PROJECT_NAME docker compose -f "$GRAFANA_COMPOSE" up -d
  else
    echo "Skipping shared observability sidecars because compose files were not found under $LIBRECHAT_EXPORTER_ROOT" >&2
  fi

  if ! "$ROOT_DIR/local-services/keep-ollama-warm.sh"; then
    echo "Warning: failed to warm remote Ollama model" >&2
  fi
fi

echo "Started LibreChat rail '$LIBRECHAT_RAIL' on http://127.0.0.1:$LIBRECHAT_HOST_PORT"
if [[ "$LIBRECHAT_RAIL" == "dev" ]]; then
  echo "Dev rail reuses the shared stable Langfuse/metrics stack on host ports 3000/9091."
fi

echo
echo "Running post-start health check..."
"$ROOT_DIR/local-services/health-check.sh" || echo "Warning: health check reported issues (see above)"
