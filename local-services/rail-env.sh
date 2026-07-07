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

have_command() {
  command -v "$1" >/dev/null 2>&1
}

resolve_existing_path() {
  local target="$1"

  if have_command realpath; then
    realpath -e "$target" 2>/dev/null && return 0
  fi

  readlink -f "$target" 2>/dev/null
}

normalize_block_device_path() {
  local device="$1"
  local resolved

  [[ "$device" == /dev/* ]] || return 1
  resolved="$(resolve_existing_path "$device")" || return 1
  [[ -b "$resolved" ]] || return 1
  printf '%s\n' "$resolved"
}

detect_linux_root_backing_block_device() {
  local current parent resolved
  local -a parents=()

  [[ "$(uname -s)" == "Linux" ]] || return 1
  have_command findmnt || return 1

  current="$(findmnt -no SOURCE / 2>/dev/null | head -1)"
  [[ -n "$current" ]] || return 1
  current="$(normalize_block_device_path "$current")" || return 1

  if ! have_command lsblk; then
    printf '%s\n' "$current"
    return 0
  fi

  while true; do
    mapfile -t parents < <(lsblk -ndo PKNAME "$current" 2>/dev/null | awk 'NF { print "/dev/" $1 }' | awk '!seen[$0]++')
    if (( ${#parents[@]} == 0 )); then
      printf '%s\n' "$current"
      return 0
    fi
    if (( ${#parents[@]} != 1 )); then
      return 1
    fi

    parent="${parents[0]}"
    resolved="$(normalize_block_device_path "$parent")" || return 1
    current="$resolved"
  done
}

resolve_stable_blkio_device() {
  local configured="${LIBRECHAT_STABLE_BLKIO_DEVICE:-${LIBRECHAT_BLKIO_DEVICE:-}}"

  if [[ -n "$configured" ]]; then
    printf '%s\n' "$configured"
    return 0
  fi

  detect_linux_root_backing_block_device
}

read_runtime_env_value() {
  local root_dir="$1"
  local key="$2"
  local env_file="$root_dir/.env"
  local line value

  if [[ ! -e "$env_file" && -n "${LIBRECHAT_RUNTIME_SOURCE:-}" ]]; then
    env_file="$LIBRECHAT_RUNTIME_SOURCE/.env"
  fi

  [[ -e "$env_file" ]] || return 1

  line="$(grep -m1 -E "^${key}=" "$env_file" 2>/dev/null || true)"
  [[ -n "$line" ]] || return 1

  value="${line#*=}"
  value="${value%$'\r'}"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf '%s\n' "$value"
}

rewrite_mongo_uri_host() {
  local mongo_uri="$1"
  local host="$2"
  local port="$3"
  local scheme rest authority path_and_query userinfo

  if [[ "$mongo_uri" != *"://"* ]]; then
    return 1
  fi

  scheme="${mongo_uri%%://*}"
  rest="${mongo_uri#*://}"

  if [[ "$rest" != */* ]]; then
    return 1
  fi

  authority="${rest%%/*}"
  path_and_query="${rest#*/}"
  userinfo=""

  if [[ "$authority" == *"@"* ]]; then
    userinfo="${authority%@*}@"
  fi

  printf '%s://%s%s:%s/%s\n' "$scheme" "$userinfo" "$host" "$port" "$path_and_query"
}

resolve_dev_shared_mongo_uri() {
  local root_dir="$1"
  local stable_uri="${LIBRECHAT_STABLE_MONGO_URI:-}"
  local shared_host="${LIBRECHAT_DEV_SHARED_MONGO_HOST:-192.168.50.4}"
  local shared_port="${LIBRECHAT_DEV_SHARED_MONGO_PORT:-27017}"

  if [[ -z "$stable_uri" ]]; then
    stable_uri="$(read_runtime_env_value "$root_dir" MONGO_URI || true)"
  fi

  if [[ -z "$stable_uri" ]]; then
    echo "Could not resolve stable MONGO_URI from $root_dir/.env" >&2
    return 1
  fi

  rewrite_mongo_uri_host "$stable_uri" "$shared_host" "$shared_port" || {
    echo "Could not rewrite stable MONGO_URI for dev shared MongoDB" >&2
    return 1
  }
}

resolve_shared_service_paths() {
  local root_dir="$1"

  export LIBRECHAT_RUNTIME_SOURCE="$(resolve_runtime_source_root "$root_dir")"
  export LOCAL_RAG_API_ROOT="$(resolve_local_rag_api_root "$root_dir")"
  export LIBRECHAT_EXPORTER_ROOT="$(resolve_exporter_root "$root_dir")"
  export TOUCHDOWN_LOG_DIR="$(resolve_touchdown_log_dir "$root_dir")"
  export TOUCHDOWN_BACKWARDS_LOG_DIR="$(resolve_touchdown_backwards_log_dir "$root_dir")"
  # Observability stack is shared across stable + dev LibreChat; directories were renamed
  # 2026-04-24 from *-dev to *-stable to reflect their production role.  Keep fallbacks for
  # worktrees that haven't synced the rename yet.
  if [[ -f "$LIBRECHAT_EXPORTER_ROOT/prometheus-stable/docker-compose.yml" ]]; then
    export PROMETHEUS_COMPOSE="$LIBRECHAT_EXPORTER_ROOT/prometheus-stable/docker-compose.yml"
  else
    export PROMETHEUS_COMPOSE="$LIBRECHAT_EXPORTER_ROOT/prometheus-dev/docker-compose.yml"
  fi
  if [[ -f "$LIBRECHAT_EXPORTER_ROOT/grafana-loki-stable/docker-compose.yml" ]]; then
    export GRAFANA_COMPOSE="$LIBRECHAT_EXPORTER_ROOT/grafana-loki-stable/docker-compose.yml"
  else
    export GRAFANA_COMPOSE="$LIBRECHAT_EXPORTER_ROOT/grafana-loki-dev/docker-compose.yml"
  fi
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
      local stable_blkio_device

      export LIBRECHAT_RAIL="stable"
      export COMPOSE_PROJECT_NAME="librechat-stable"
      export LIBRECHAT_STACK_SLUG="librechat-stable"
      export LIBRECHAT_API_IMAGE="librechat-local-stable:latest"
      export LIBRECHAT_RAG_IMAGE="librechat-local-rag-api-stable:latest"
      export LIBRECHAT_CODE_IMAGE="librechat-local-code-interpreter-stable:latest"
      export LIBRECHAT_HOST_PORT="3080"
      export LIBRECHAT_CONTAINER_PORT="3080"
      export PORT="$LIBRECHAT_CONTAINER_PORT"
      export DOMAIN_CLIENT="${LIBRECHAT_STABLE_DOMAIN_CLIENT:-https://librechatvm.tail6e13ff.ts.net:8443}"
      export DOMAIN_SERVER="${LIBRECHAT_STABLE_DOMAIN_SERVER:-https://librechatvm.tail6e13ff.ts.net:8443}"
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
      export LIBRECHAT_API_MEM_LIMIT="5120m"
      export LIBRECHAT_API_MEM_RESERVATION="3072m"
      export LIBRECHAT_API_NODE_MAX_OLD_SPACE="4096"
      export LIBRECHAT_API_CPUS="3.5"
      export LIBRECHAT_MONGO_MEM_LIMIT="1536m"
      export LIBRECHAT_MONGO_MEM_RESERVATION="768m"
      export LIBRECHAT_MONGO_CPUS="1.5"
      export LIBRECHAT_MONGO_COMMAND="mongod --auth --bind_ip_all --wiredTigerCacheSizeGB 0.75"
      export LIBRECHAT_MEILI_MEM_LIMIT="512m"
      export LIBRECHAT_MEILI_MEM_RESERVATION="128m"
      export LIBRECHAT_VECTORDB_MEM_LIMIT="768m"
      export LIBRECHAT_VECTORDB_MEM_RESERVATION="256m"
      export LIBRECHAT_RAG_MEM_LIMIT="384m"
      export LIBRECHAT_RAG_MEM_RESERVATION="128m"
      export LIBRECHAT_CODE_MEM_LIMIT="256m"
      export LIBRECHAT_CODE_MEM_RESERVATION="96m"
      export LOCAL_CODE_MEMORY_LIMIT="768m"
      export LOCAL_CODE_NANO_CPUS="500000000"
      export LOCAL_CODE_PIDS_LIMIT="128"
      export LIBRECHAT_LANGFUSE_CLICKHOUSE_MEM_LIMIT="1024m"
      export LIBRECHAT_LANGFUSE_WEB_MEM_LIMIT="768m"
      export LIBRECHAT_LANGFUSE_WORKER_MEM_LIMIT="512m"
      export LIBRECHAT_LANGFUSE_SYNC_MEM_LIMIT="128m"
      export LIBRECHAT_LANGFUSE_MINIO_MEM_LIMIT="192m"
      export LIBRECHAT_LANGFUSE_REDIS_MEM_LIMIT="192m"
      export LIBRECHAT_LANGFUSE_REDIS_MAXMEMORY="128mb"
      export LIBRECHAT_LANGFUSE_POSTGRES_MEM_LIMIT="192m"
      export LIBRECHAT_METRICS_MEM_LIMIT="96m"
      stable_blkio_device="$(resolve_stable_blkio_device)" || {
        echo "Could not resolve the stable blkio device from the root filesystem; set LIBRECHAT_STABLE_BLKIO_DEVICE explicitly." >&2
        return 1
      }
      export LIBRECHAT_BLKIO_DEVICE="$stable_blkio_device"
      unset LANGFUSE_BASE_URL
      unset LANGFUSE_UI_URL
      # Stable does not override Langfuse NODE_OPTIONS; the container uses
      # Node.js default heap sizing, which is appropriate for the higher
      # memory limits available on the production rail.
      export LIBRECHAT_LANGFUSE_NODE_OPTIONS=""
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
      export DOMAIN_CLIENT="${LIBRECHAT_DEV_DOMAIN_CLIENT:-http://127.0.0.1:3081}"
      export DOMAIN_SERVER="${LIBRECHAT_DEV_DOMAIN_SERVER:-http://127.0.0.1:3081}"
      export LIBRECHAT_MONGO_BIND_HOST="127.0.0.1"
      export LIBRECHAT_MONGO_HOST_PORT="27018"
      export LIBRECHAT_MONGO_COMMAND="mongod --bind_ip_all"
      export LIBRECHAT_LANGFUSE_WEB_HOST_PORT="3002"
      export LIBRECHAT_LANGFUSE_MINIO_API_HOST_PORT="19190"
      export LIBRECHAT_LANGFUSE_MINIO_CONSOLE_HOST_PORT="19192"
      export LIBRECHAT_METRICS_HOST_PORT="9092"
      export LIBRECHAT_DEV_USE_STABLE_MONGO="${LIBRECHAT_DEV_USE_STABLE_MONGO:-true}"
      if [[ "$LIBRECHAT_DEV_USE_STABLE_MONGO" == "true" ]]; then
        export MONGO_URI="$(resolve_dev_shared_mongo_uri "$root_dir")"
        export LIBRECHAT_UPLOADS_DIR="${LIBRECHAT_DEV_SHARED_UPLOADS_DIR:-$root_dir/uploads}"
        export LIBRECHAT_DEV_DATA_MODE="shared-stable"
      else
        export MONGO_URI="mongodb://mongodb:27017/LibreChat"
        export LIBRECHAT_UPLOADS_DIR="$root_dir/.rails/dev/uploads"
        export LIBRECHAT_DEV_DATA_MODE="isolated"
      fi
      export LIBRECHAT_LOGS_DIR="$root_dir/.rails/dev/logs"
      export LIBRECHAT_MONGO_DATA_DIR="$root_dir/.rails/dev/data-node"
      export LIBRECHAT_MEILI_DATA_DIR="$root_dir/.rails/dev/meili_data_v1.35.1"
      export LOCAL_CODE_INTERPRETER_DATA_DIR="$root_dir/.rails/dev/local-code-interpreter/data"
      export LOCAL_CODE_WORKSPACE_HOST_ROOT="$root_dir/.rails/dev/local-code-interpreter/data/workspaces"
      export LOCAL_CODE_SANDBOX_PYTHON_IMAGE="librechat-local-sandbox-python-dev:latest"
      export LIBRECHAT_DEV_PROFILE="${LIBRECHAT_DEV_PROFILE:-full}"
      if [[ "$LIBRECHAT_DEV_PROFILE" == "failover" ]]; then
        export LIBRECHAT_API_MEM_LIMIT="${LIBRECHAT_DEV_FAILOVER_API_MEM_LIMIT:-1280m}"
        export LIBRECHAT_API_MEM_RESERVATION="${LIBRECHAT_DEV_FAILOVER_API_MEM_RESERVATION:-512m}"
        export LIBRECHAT_API_NODE_MAX_OLD_SPACE="${LIBRECHAT_DEV_FAILOVER_API_NODE_MAX_OLD_SPACE:-768}"
        export LIBRECHAT_API_CPUS="${LIBRECHAT_DEV_FAILOVER_API_CPUS:-1}"
      else
        export LIBRECHAT_API_MEM_LIMIT="${LIBRECHAT_DEV_API_MEM_LIMIT:-2048m}"
        export LIBRECHAT_API_MEM_RESERVATION="${LIBRECHAT_DEV_API_MEM_RESERVATION:-1024m}"
        export LIBRECHAT_API_NODE_MAX_OLD_SPACE="${LIBRECHAT_DEV_API_NODE_MAX_OLD_SPACE:-1536}"
        export LIBRECHAT_API_CPUS="${LIBRECHAT_DEV_API_CPUS:-1.5}"
      fi
      export LIBRECHAT_SHARED_LANGFUSE_BASE_URL="${LIBRECHAT_SHARED_LANGFUSE_BASE_URL:-http://host.docker.internal:3000}"
      export LIBRECHAT_SHARED_LANGFUSE_UI_URL="${LIBRECHAT_SHARED_LANGFUSE_UI_URL:-http://127.0.0.1:3000}"
      export LANGFUSE_BASE_URL="$LIBRECHAT_SHARED_LANGFUSE_BASE_URL"
      export LANGFUSE_UI_URL="$LIBRECHAT_SHARED_LANGFUSE_UI_URL"
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
      export LIBRECHAT_RAG_MEM_LIMIT="${LIBRECHAT_DEV_RAG_MEM_LIMIT:-256m}"
      export LIBRECHAT_RAG_MEM_RESERVATION="${LIBRECHAT_DEV_RAG_MEM_RESERVATION:-96m}"
      export LIBRECHAT_RAG_CPUS="${LIBRECHAT_DEV_RAG_CPUS:-0.25}"
      export LIBRECHAT_MONGO_MEM_LIMIT="${LIBRECHAT_DEV_MONGO_MEM_LIMIT:-512m}"
      export LIBRECHAT_MONGO_MEM_RESERVATION="${LIBRECHAT_DEV_MONGO_MEM_RESERVATION:-256m}"
      export LIBRECHAT_MONGO_CPUS="${LIBRECHAT_DEV_MONGO_CPUS:-0.5}"
      export LIBRECHAT_MEILI_MEM_LIMIT="${LIBRECHAT_DEV_MEILI_MEM_LIMIT:-384m}"
      export LIBRECHAT_MEILI_MEM_RESERVATION="${LIBRECHAT_DEV_MEILI_MEM_RESERVATION:-128m}"
      export LIBRECHAT_VECTORDB_MEM_LIMIT="${LIBRECHAT_DEV_VECTORDB_MEM_LIMIT:-512m}"
      export LIBRECHAT_VECTORDB_MEM_RESERVATION="${LIBRECHAT_DEV_VECTORDB_MEM_RESERVATION:-256m}"
      export LIBRECHAT_VECTORDB_CPUS="${LIBRECHAT_DEV_VECTORDB_CPUS:-0.5}"
      export LIBRECHAT_CODE_MEM_LIMIT="${LIBRECHAT_DEV_CODE_MEM_LIMIT:-256m}"
      export LIBRECHAT_CODE_MEM_RESERVATION="${LIBRECHAT_DEV_CODE_MEM_RESERVATION:-96m}"
      export LOCAL_CODE_MEMORY_LIMIT="${LIBRECHAT_DEV_CODE_SANDBOX_MEMORY_LIMIT:-512m}"
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
