#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/pool/home/timeng/LibreChat-custom"
LOCAL_SERVICES_DIR="$ROOT_DIR/local-services"

log() {
  printf '[librechat-init] %s\n' "$*"
}

warn() {
  printf '[librechat-init][warn] %s\n' "$*" >&2
}

fail() {
  printf '[librechat-init][error] %s\n' "$*" >&2
  exit 1
}

[[ -d "$ROOT_DIR" ]] || fail "Repo root not found: $ROOT_DIR"
[[ -f "$LOCAL_SERVICES_DIR/rail-env.sh" ]] || fail "Missing rail env helper: $LOCAL_SERVICES_DIR/rail-env.sh"
[[ -f "$LOCAL_SERVICES_DIR/ensure-runtime-files.sh" ]] || fail "Missing runtime link helper: $LOCAL_SERVICES_DIR/ensure-runtime-files.sh"

# shellcheck source=/pool/home/timeng/LibreChat-custom/local-services/rail-env.sh
source "$LOCAL_SERVICES_DIR/rail-env.sh"

log "Ensuring runtime-only files are linked into the active worktree"
"$LOCAL_SERVICES_DIR/ensure-runtime-files.sh"

resolve_shared_service_paths "$ROOT_DIR"

[[ -d "$LIBRECHAT_RUNTIME_SOURCE" || -L "$LIBRECHAT_RUNTIME_SOURCE" ]] || fail "Runtime source root not found: $LIBRECHAT_RUNTIME_SOURCE"

if [[ -d "$LOCAL_RAG_API_ROOT" ]]; then
  log "Found required rag_api checkout: $LOCAL_RAG_API_ROOT"
else
  fail "Missing required rag_api checkout: $LOCAL_RAG_API_ROOT"
fi

if [[ -d "$LIBRECHAT_EXPORTER_ROOT" ]]; then
  log "Found exporter repo: $LIBRECHAT_EXPORTER_ROOT"
else
  warn "Exporter repo not found: $LIBRECHAT_EXPORTER_ROOT"
fi

if shared_observability_available; then
  log "Shared observability compose files are present"
else
  warn "Shared observability compose files are not fully present under $LIBRECHAT_EXPORTER_ROOT"
fi

if metrics_build_context_available; then
  log "Metrics build context is available"
else
  warn "Metrics build context is unavailable under $LIBRECHAT_EXPORTER_ROOT"
fi

log "Preparing isolated dev-rail writable paths"
resolve_librechat_rail "$ROOT_DIR" dev
prepare_librechat_rail_paths

log "Verified protected stable rail configuration without modifying stable state"
resolve_librechat_rail "$ROOT_DIR" stable
log "Stable rail app URL: http://127.0.0.1:$LIBRECHAT_HOST_PORT"
log "Dev rail app URL: http://127.0.0.1:3081"

if [[ ! -d "$ROOT_DIR/packages/data-provider/dist" || ! -d "$ROOT_DIR/packages/data-schemas/dist" || ! -d "$ROOT_DIR/packages/api/dist" || ! -d "$ROOT_DIR/packages/client/dist" ]]; then
  log "One or more shared package build outputs are missing; rebuilding package chain for worker baseline"
  (
    cd "$ROOT_DIR"
    npm run build:data-provider
    npm run build:data-schemas
    npm run build:api
    npm run build:client-package
  )
else
  log "Shared package build outputs already present"
fi

log "Init complete. No services were started."
