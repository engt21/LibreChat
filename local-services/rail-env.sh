#!/usr/bin/env bash
set -euo pipefail

sibling_dir() {
  local root_dir="$1"
  local sibling_name="$2"

  printf '%s/%s\n' "$(cd "$root_dir/.." && pwd)" "$sibling_name"
}

resolve_runtime_source_root() {
  local root_dir="$1"

  if [[ -n "${LIBRECHAT_RUNTIME_SOURCE:-}" ]]; then
    printf '%s\n' "$LIBRECHAT_RUNTIME_SOURCE"
    return
  fi

  local sibling_root
  sibling_root="$(sibling_dir "$root_dir" "LibreChat")"

  if [[ -e "$sibling_root" || -L "$sibling_root" ]]; then
    printf '%s\n' "$sibling_root"
    return
  fi

  printf '%s\n' "/pool/home/timeng/LibreChat"
}

resolve_local_rag_api_root() {
  local root_dir="$1"

  if [[ -n "${LOCAL_RAG_API_ROOT:-}" ]]; then
    printf '%s\n' "$LOCAL_RAG_API_ROOT"
    return
  fi

  local sibling_root
  sibling_root="$(sibling_dir "$root_dir" "rag_api")"

  if [[ -d "$sibling_root" ]]; then
    printf '%s\n' "$sibling_root"
    return
  fi

  printf '%s\n' "/pool/home/timeng/rag_api"
}

resolve_exporter_root() {
  local root_dir="$1"

  if [[ -n "${LIBRECHAT_EXPORTER_ROOT:-}" ]]; then
    printf '%s\n' "$LIBRECHAT_EXPORTER_ROOT"
    return
  fi

  local sibling_root
  sibling_root="$(sibling_dir "$root_dir" "librechat_exporter")"

  if [[ -d "$sibling_root" ]]; then
    printf '%s\n' "$sibling_root"
    return
  fi

  printf '%s\n' "/pool/home/timeng/librechat_exporter"
}

resolve_touchdown_log_dir() {
  local root_dir="$1"

  if [[ -n "${TOUCHDOWN_LOG_DIR:-}" ]]; then
    printf '%s\n' "$TOUCHDOWN_LOG_DIR"
    return
  fi

  local sibling_root
  sibling_root="$(sibling_dir "$root_dir" "touchdown")"

  if [[ -d "$sibling_root/logs" ]]; then
    printf '%s\n' "$sibling_root/logs"
    return
  fi

  printf '%s\n' "/pool/home/timeng/touchdown/logs"
}

resolve_touchdown_backwards_log_dir() {
  local root_dir="$1"

  if [[ -n "${TOUCHDOWN_BACKWARDS_LOG_DIR:-}" ]]; then
    printf '%s\n' "$TOUCHDOWN_BACKWARDS_LOG_DIR"
    return
  fi

  local sibling_root
  sibling_root="$(sibling_dir "$root_dir" "touchdown")"

  if [[ -d "$sibling_root/logs_backward" ]]; then
    printf '%s\n' "$sibling_root/logs_backward"
    return
  fi

  printf '%s\n' "/pool/home/timeng/touchdown/logs_backward"
}

resolve_shared_service_paths() {
  local root_dir="$1"

  export LIBRECHAT_RUNTIME_SOURCE="$(resolve_runtime_source_root "$root_dir")"
  export LOCAL_RAG_API_ROOT="$(resolve_local_rag_api_root "$root_dir")"
  export LIBRECHAT_EXPORTER_ROOT="$(resolve_exporter_root "$root_dir")"
  export TOUCHDOWN_LOG_DIR="$(resolve_touchdown_log_dir "$root_dir")"
  export TOUCHDOWN_BACKWARDS_LOG_DIR="$(resolve_touchdown_backwards_log_dir "$root_dir")"
  export PROMETHEUS_COMPOSE="$LIBRECHAT_EXPORTER_ROOT/prometheus-dev/docker-compose.yml"
  export GRAFANA_COMPOSE="$LIBRECHAT_EXPORTER_ROOT/grafana-loki-dev/docker-compose.yml"
}

shared_observability_available() {
  [[ -f "${PROMETHEUS_COMPOSE:-}" && -f "${GRAFANA_COMPOSE:-}" ]]
}

metrics_build_context_available() {
  [[ -f "${LIBRECHAT_EXPORTER_ROOT:-}/Dockerfile" ]]
}

resolve_librechat_rail() {
  local root_dir="$1"
  local requested_rail="${2:-${LIBRECHAT_RAIL:-stable}}"

  resolve_shared_service_paths "$root_dir"

  case "$requested_rail" in
    stable)
      export LIBRECHAT_RAIL="stable"
      export COMPOSE_PROJECT_NAME="librechat-stable"
      export LIBRECHAT_STACK_SLUG="librechat-stable"
      export LIBRECHAT_API_IMAGE="librechat-local-stable:latest"
      export LIBRECHAT_RAG_IMAGE="librechat-local-rag-api-stable:latest"
      export LIBRECHAT_CODE_IMAGE="librechat-local-code-interpreter-stable:latest"
      export LIBRECHAT_HOST_PORT="3080"
      export LIBRECHAT_CONTAINER_PORT="3080"
      export PORT="$LIBRECHAT_CONTAINER_PORT"
      export LIBRECHAT_RAG_OPENAI_HOST_PORT="8100"
      export LIBRECHAT_RAG_AZURE_HOST_PORT="8101"
      export LIBRECHAT_RAG_GOOGLE_HOST_PORT="8102"
      export LIBRECHAT_CODE_HOST_PORT="8190"
      export LIBRECHAT_MONGO_BIND_HOST="192.168.50.4"
      export LIBRECHAT_MONGO_HOST_PORT="27017"
      export LIBRECHAT_MONGO_COMMAND="mongod --auth --bind_ip_all"
      export LIBRECHAT_LANGFUSE_WEB_HOST_PORT="3000"
      export LIBRECHAT_LANGFUSE_MINIO_API_HOST_PORT="19090"
      export LIBRECHAT_LANGFUSE_MINIO_CONSOLE_HOST_PORT="19092"
      export LIBRECHAT_METRICS_HOST_PORT="9091"
      unset MONGO_URI
      export LIBRECHAT_UPLOADS_DIR="$root_dir/uploads"
      export LIBRECHAT_LOGS_DIR="$root_dir/logs"
      export LIBRECHAT_MONGO_DATA_DIR="$root_dir/data-node"
      export LIBRECHAT_MEILI_DATA_DIR="$root_dir/meili_data_v1.35.1"
      export LOCAL_CODE_INTERPRETER_DATA_DIR="$root_dir/local-code-interpreter/data"
      export LOCAL_CODE_WORKSPACE_HOST_ROOT="$root_dir/local-code-interpreter/data/workspaces"
      export LOCAL_CODE_SANDBOX_PYTHON_IMAGE="librechat-local-sandbox-python-stable:latest"
      export LIBRECHAT_API_MEM_LIMIT="3072m"
      export LIBRECHAT_API_NODE_MAX_OLD_SPACE="2048"
      export LIBRECHAT_MANAGE_SHARED_SERVICES="true"
      ;;
    dev)
      export LIBRECHAT_RAIL="dev"
      export COMPOSE_PROJECT_NAME="librechat-dev"
      export LIBRECHAT_STACK_SLUG="librechat-dev"
      export LIBRECHAT_API_IMAGE="librechat-local-dev:latest"
      export LIBRECHAT_RAG_IMAGE="librechat-local-rag-api-dev:latest"
      export LIBRECHAT_CODE_IMAGE="librechat-local-code-interpreter-dev:latest"
      export LIBRECHAT_HOST_PORT="3081"
      export LIBRECHAT_CONTAINER_PORT="3080"
      export PORT="$LIBRECHAT_CONTAINER_PORT"
      export LIBRECHAT_RAG_OPENAI_HOST_PORT="8110"
      export LIBRECHAT_RAG_AZURE_HOST_PORT="8111"
      export LIBRECHAT_RAG_GOOGLE_HOST_PORT="8112"
      export LIBRECHAT_CODE_HOST_PORT="8191"
      export LIBRECHAT_MONGO_BIND_HOST="127.0.0.1"
      export LIBRECHAT_MONGO_HOST_PORT="27018"
      export LIBRECHAT_MONGO_COMMAND="mongod --bind_ip_all"
      export LIBRECHAT_LANGFUSE_WEB_HOST_PORT="3002"
      export LIBRECHAT_LANGFUSE_MINIO_API_HOST_PORT="19190"
      export LIBRECHAT_LANGFUSE_MINIO_CONSOLE_HOST_PORT="19192"
      export LIBRECHAT_METRICS_HOST_PORT="9092"
      export MONGO_URI="mongodb://mongodb:27017/LibreChat"
      export LIBRECHAT_UPLOADS_DIR="$root_dir/.rails/dev/uploads"
      export LIBRECHAT_LOGS_DIR="$root_dir/.rails/dev/logs"
      export LIBRECHAT_MONGO_DATA_DIR="$root_dir/.rails/dev/data-node"
      export LIBRECHAT_MEILI_DATA_DIR="$root_dir/.rails/dev/meili_data_v1.35.1"
      export LOCAL_CODE_INTERPRETER_DATA_DIR="$root_dir/.rails/dev/local-code-interpreter/data"
      export LOCAL_CODE_WORKSPACE_HOST_ROOT="$root_dir/.rails/dev/local-code-interpreter/data/workspaces"
      export LOCAL_CODE_SANDBOX_PYTHON_IMAGE="librechat-local-sandbox-python-dev:latest"
      export LIBRECHAT_API_MEM_LIMIT="1536m"
      export LIBRECHAT_API_NODE_MAX_OLD_SPACE="1024"
      # Dev-specific Langfuse memory limits to coexist with stable under constrained host memory.
      # These override the .env values that are tuned for production-scale stable workloads.
      # ClickHouse needs enough headroom for background merges on synced data; the memory.xml
      # config limits its internal usage to 60% of the cgroup limit (~384MB of 640MB).
      export LIBRECHAT_LANGFUSE_CLICKHOUSE_MEM_LIMIT="640m"
      export LIBRECHAT_LANGFUSE_WEB_MEM_LIMIT="640m"
      export LIBRECHAT_LANGFUSE_WORKER_MEM_LIMIT="512m"
      # Langfuse Node.js heap must be set explicitly because the default auto-detection
      # underestimates when the container limit is low relative to total host RAM.
      export LIBRECHAT_LANGFUSE_NODE_OPTIONS="--max-old-space-size=400"
      export LIBRECHAT_LANGFUSE_SYNC_MEM_LIMIT="128m"
      export LIBRECHAT_LANGFUSE_MINIO_MEM_LIMIT="128m"
      export LIBRECHAT_LANGFUSE_REDIS_MEM_LIMIT="64m"
      export LIBRECHAT_LANGFUSE_POSTGRES_MEM_LIMIT="96m"
      export LIBRECHAT_RAG_MEM_LIMIT="192m"
      export LIBRECHAT_MONGO_MEM_LIMIT="192m"
      export LIBRECHAT_MEILI_MEM_LIMIT="128m"
      export LIBRECHAT_MANAGE_SHARED_SERVICES="false"
      ;;
    *)
      echo "Unsupported rail '$requested_rail'. Use 'stable' or 'dev'." >&2
      return 1
      ;;
  esac

  export LIBRECHAT_API_CONTAINER_NAME="${LIBRECHAT_STACK_SLUG}-api"
  export LIBRECHAT_MONGO_CONTAINER_NAME="${LIBRECHAT_STACK_SLUG}-mongodb"
  export LIBRECHAT_MEILI_CONTAINER_NAME="${LIBRECHAT_STACK_SLUG}-meilisearch"
  export LIBRECHAT_VECTORDB_CONTAINER_NAME="${LIBRECHAT_STACK_SLUG}-vectordb"
  export LIBRECHAT_RAG_OPENAI_CONTAINER_NAME="${LIBRECHAT_STACK_SLUG}-rag-openai"
  export LIBRECHAT_RAG_AZURE_CONTAINER_NAME="${LIBRECHAT_STACK_SLUG}-rag-azure"
  export LIBRECHAT_RAG_GOOGLE_CONTAINER_NAME="${LIBRECHAT_STACK_SLUG}-rag-google"
  export LIBRECHAT_CODE_CONTAINER_NAME="${LIBRECHAT_STACK_SLUG}-code-interpreter"
}

prepare_librechat_rail_paths() {
  mkdir -p \
    "$LIBRECHAT_UPLOADS_DIR" \
    "$LIBRECHAT_LOGS_DIR" \
    "$LIBRECHAT_MONGO_DATA_DIR" \
    "$LIBRECHAT_MEILI_DATA_DIR" \
    "$LOCAL_CODE_INTERPRETER_DATA_DIR" \
    "$LOCAL_CODE_WORKSPACE_HOST_ROOT"

  chmod 0777 "$LIBRECHAT_MONGO_DATA_DIR" 2>/dev/null || true

  # Normalize MongoDB data ownership so the container user (default 999:999) can
  # access files that may have been created when dev Mongo previously ran as root.
  # This removes the need for LIBRECHAT_MONGO_USER=0:0 on the dev rail.
  normalize_dev_mongo_ownership
}

normalize_dev_mongo_ownership() {
  # Use the compose-file default (999:999) unless overridden by LIBRECHAT_MONGO_USER.
  local mongo_user="${LIBRECHAT_MONGO_USER:-999:999}"
  local mongo_uid="${mongo_user%%:*}"
  local mongo_gid="${mongo_user#*:}"

  # Skip normalization for root-user containers (uid 0) or stable rail.
  if [[ "$mongo_uid" == "0" || "${LIBRECHAT_RAIL:-stable}" == "stable" ]]; then
    return 0
  fi

  [[ -d "$LIBRECHAT_MONGO_DATA_DIR" ]] || return 0

  # Check if any files are not owned by the target UID.  On ZFS, WiredTiger
  # requires file ownership to match the process UID for flock() even when
  # standard UNIX permissions would otherwise allow access.  A simple chmod
  # is insufficient; the files must be chowned.
  if find "$LIBRECHAT_MONGO_DATA_DIR" -maxdepth 1 ! -user "$mongo_uid" -type f -print -quit 2>/dev/null | grep -q .; then
    # First try host-level chown (works when running as root or matching owner).
    if chown -R "${mongo_uid}:${mongo_gid}" "$LIBRECHAT_MONGO_DATA_DIR" 2>/dev/null; then
      echo "[rail-env] Normalized dev MongoDB data ownership to ${mongo_uid}:${mongo_gid}" >&2
      return 0
    fi
    # Fallback: use a Docker container to chown.  Docker's container root has
    # the privileges to change ownership on the bind-mounted volume even when
    # the host user cannot.  This avoids needing host-level root for dev data.
    echo "[rail-env] Normalizing dev MongoDB data ownership via container (ZFS workaround)..." >&2
    docker run --rm \
      -v "$LIBRECHAT_MONGO_DATA_DIR:/data/db" \
      alpine chown -R "${mongo_uid}:${mongo_gid}" /data/db 2>/dev/null || \
      echo "[rail-env][warn] Could not normalize MongoDB data ownership; dev Mongo may fail to start" >&2
  fi
}
