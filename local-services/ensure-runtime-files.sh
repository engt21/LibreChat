#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/local-services/rail-env.sh"

FALLBACK_ROOT_DIR="$(resolve_runtime_source_root "$ROOT_DIR")"

ensure_runtime_file() {
  local relative_path="$1"
  local local_path="$ROOT_DIR/$relative_path"
  local fallback_path="$FALLBACK_ROOT_DIR/$relative_path"

  if [ -e "$local_path" ] || [ -L "$local_path" ]; then
    return 0
  fi

  if [ "$ROOT_DIR" = "$FALLBACK_ROOT_DIR" ]; then
    echo "Missing required runtime file: $local_path" >&2
    return 1
  fi

  if [ ! -e "$fallback_path" ] && [ ! -L "$fallback_path" ]; then
    echo "Missing required runtime file: $local_path" >&2
    echo "Also not found in fallback runtime source: $fallback_path" >&2
    return 1
  fi

  mkdir -p "$(dirname "$local_path")"
  ln -s "$fallback_path" "$local_path"
  echo "Linked $local_path -> $fallback_path"
}

ensure_runtime_file ".env"
ensure_runtime_file "librechat.yaml"
ensure_runtime_file "data-node"
ensure_runtime_file "meili_data_v1.35.1"
ensure_runtime_file "images"
ensure_runtime_file "uploads"
ensure_runtime_file "logs"

if [ -e "$ROOT_DIR/langfuse/.env" ] || [ -L "$ROOT_DIR/langfuse/.env" ] || [ -e "$FALLBACK_ROOT_DIR/langfuse/.env" ] || [ -L "$FALLBACK_ROOT_DIR/langfuse/.env" ]; then
  ensure_runtime_file "langfuse/.env"
fi
