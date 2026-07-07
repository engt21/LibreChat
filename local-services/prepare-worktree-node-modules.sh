#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

link_workspace_package() {
  local consumer_dir="$1"
  local package_name="$2"
  local target_dir="$3"
  local destination="$ROOT_DIR/$consumer_dir/node_modules/$package_name"

  if [[ -e "$destination" && ! -L "$destination" ]]; then
    echo "Refusing to replace non-symlink workspace dependency: $destination" >&2
    exit 1
  fi

  mkdir -p "$(dirname "$destination")"
  ln -sfn "$ROOT_DIR/$target_dir" "$destination"
  printf '%s -> %s\n' "$destination" "$ROOT_DIR/$target_dir"
}

localize_external_package() {
  local consumer_dir="$1"
  local package_name="$2"
  local source="$ROOT_DIR/node_modules/$package_name"
  local destination="$ROOT_DIR/$consumer_dir/node_modules/$package_name"
  local temporary="${destination}.tmp.$$"

  if [[ ! -e "$source" ]]; then
    echo "Required external dependency is missing: $source" >&2
    exit 1
  fi

  mkdir -p "$(dirname "$destination")"
  rm -rf "$temporary"
  cp -a --reflink=auto "$source" "$temporary"
  rm -rf "$destination"
  mv "$temporary" "$destination"
  printf '%s copied from %s\n' "$destination" "$source"
}

if [[ ! -e "$ROOT_DIR/node_modules" ]]; then
  echo "Root node_modules is missing; install dependencies before preparing worktree links." >&2
  exit 1
fi

link_workspace_package packages/data-schemas librechat-data-provider packages/data-provider

link_workspace_package packages/api librechat-data-provider packages/data-provider
link_workspace_package packages/api @librechat/data-schemas packages/data-schemas

link_workspace_package packages/client librechat-data-provider packages/data-provider

link_workspace_package api librechat-data-provider packages/data-provider
link_workspace_package api @librechat/api packages/api
link_workspace_package api @librechat/data-schemas packages/data-schemas

link_workspace_package client librechat-data-provider packages/data-provider
link_workspace_package client @librechat/client packages/client

if [[ -L "$ROOT_DIR/node_modules" ]]; then
  localize_external_package packages/client rc-input-number
  localize_external_package packages/client @rc-component/mini-decimal
fi

echo "Worktree-local workspace dependency links are ready."
