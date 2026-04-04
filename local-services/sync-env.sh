#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/local-services/rail-env.sh"

LIBRECHAT_SYNC_BIND_DIRS=()
LIBRECHAT_SYNC_BIND_FILES=()
LIBRECHAT_SYNC_VOLUME_KEYS=()

resolve_sync_env() {
  resolve_librechat_rail "$ROOT_DIR" "dev"

  export LIBRECHAT_SYNC_STATE_DIR="${LIBRECHAT_SYNC_STATE_DIR:-$ROOT_DIR/.local-sync/dev}"
  export LIBRECHAT_SYNC_BUNDLES_DIR="${LIBRECHAT_SYNC_BUNDLES_DIR:-$LIBRECHAT_SYNC_STATE_DIR/bundles}"
  export LIBRECHAT_SYNC_AUTH_DIR="${LIBRECHAT_SYNC_AUTH_DIR:-$LIBRECHAT_SYNC_STATE_DIR/authoritative}"
  export LIBRECHAT_SYNC_CURRENT_TOKEN_FILE="${LIBRECHAT_SYNC_CURRENT_TOKEN_FILE:-$LIBRECHAT_SYNC_STATE_DIR/current_token}"
  export LIBRECHAT_SYNC_MACHINE_ID="${LIBRECHAT_SYNC_MACHINE_ID:-$(hostname | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9._-' '-')}"
  export LIBRECHAT_SYNC_REMOTE_SSH_TARGET="${LIBRECHAT_SYNC_REMOTE_SSH_TARGET:-timeng@192.168.50.4}"
  export LIBRECHAT_SYNC_SSH_KEY="${LIBRECHAT_SYNC_SSH_KEY:-$HOME/.ssh/id_rsa}"
  export LIBRECHAT_SYNC_REMOTE_ROOT="${LIBRECHAT_SYNC_REMOTE_ROOT:-/pool/home/timeng}"
  export LIBRECHAT_SYNC_REMOTE_REPO_ROOT="${LIBRECHAT_SYNC_REMOTE_REPO_ROOT:-$LIBRECHAT_SYNC_REMOTE_ROOT/LibreChat-custom}"
  export LIBRECHAT_SYNC_REMOTE_STATE_DIR="${LIBRECHAT_SYNC_REMOTE_STATE_DIR:-$LIBRECHAT_SYNC_REMOTE_REPO_ROOT/.local-sync/dev}"
  export LIBRECHAT_SYNC_REMOTE_AUTH_BUNDLE_DIR="${LIBRECHAT_SYNC_REMOTE_AUTH_BUNDLE_DIR:-$LIBRECHAT_SYNC_REMOTE_STATE_DIR/authoritative/current}"
  export LIBRECHAT_SYNC_REMOTE_INCOMING_DIR="${LIBRECHAT_SYNC_REMOTE_INCOMING_DIR:-$LIBRECHAT_SYNC_REMOTE_STATE_DIR/incoming/$LIBRECHAT_SYNC_MACHINE_ID}"
  export LIBRECHAT_SYNC_REMOTE_CONFLICTS_DIR="${LIBRECHAT_SYNC_REMOTE_CONFLICTS_DIR:-$LIBRECHAT_SYNC_REMOTE_STATE_DIR/conflicts}"
  export LIBRECHAT_SYNC_POLL_INTERVAL_SECONDS="${LIBRECHAT_SYNC_POLL_INTERVAL_SECONDS:-60}"
  export LIBRECHAT_SYNC_REMOTE_CONNECT_TIMEOUT_SECONDS="${LIBRECHAT_SYNC_REMOTE_CONNECT_TIMEOUT_SECONDS:-5}"

  LIBRECHAT_SYNC_BIND_DIRS=(
    "images"
    ".rails/dev/uploads"
    ".rails/dev/data-node"
    ".rails/dev/meili_data_v1.35.1"
    ".rails/dev/local-code-interpreter/data"
  )
  LIBRECHAT_SYNC_BIND_FILES=(
    ".env"
    "librechat.yaml"
    "langfuse/.env"
  )
  LIBRECHAT_SYNC_VOLUME_KEYS=(
    "pgdata2"
    "langfuse_postgres_data"
    "langfuse_clickhouse_data"
    "langfuse_minio_data"
    "langfuse_redis_data"
  )

  mkdir -p "$LIBRECHAT_SYNC_STATE_DIR" "$LIBRECHAT_SYNC_BUNDLES_DIR" "$LIBRECHAT_SYNC_AUTH_DIR"
}

sync_log() {
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

sync_fail() {
  sync_log "$*" >&2
  exit 1
}

authoritative_bundle_dir() {
  printf '%s/current\n' "$LIBRECHAT_SYNC_AUTH_DIR"
}

authoritative_metadata_file() {
  printf '%s/metadata.env\n' "$(authoritative_bundle_dir)"
}

ensure_sync_filesystem_layout() {
  prepare_librechat_rail_paths
  mkdir -p \
    "$ROOT_DIR/images" \
    "$ROOT_DIR/langfuse" \
    "$ROOT_DIR/.rails/dev/uploads" \
    "$ROOT_DIR/.rails/dev/data-node" \
    "$ROOT_DIR/.rails/dev/meili_data_v1.35.1" \
    "$ROOT_DIR/.rails/dev/local-code-interpreter/data"

  [[ -f "$ROOT_DIR/.env" || -L "$ROOT_DIR/.env" ]] || sync_fail "Missing required sync file: $ROOT_DIR/.env"
  [[ -f "$ROOT_DIR/librechat.yaml" || -L "$ROOT_DIR/librechat.yaml" ]] || sync_fail "Missing required sync file: $ROOT_DIR/librechat.yaml"
  [[ -f "$ROOT_DIR/langfuse/.env" || -L "$ROOT_DIR/langfuse/.env" ]] || touch "$ROOT_DIR/langfuse/.env"
}

bundle_metadata_file() {
  printf '%s/metadata.env\n' "$1"
}

read_current_token() {
  if [[ -f "$LIBRECHAT_SYNC_CURRENT_TOKEN_FILE" ]]; then
    cat "$LIBRECHAT_SYNC_CURRENT_TOKEN_FILE"
  fi
}

write_current_token() {
  printf '%s\n' "$1" > "$LIBRECHAT_SYNC_CURRENT_TOKEN_FILE"
}

generate_sync_token() {
  local suffix="${1:-$LIBRECHAT_SYNC_MACHINE_ID}"
  printf '%s-%s\n' "$(date -u +%Y%m%dT%H%M%SZ)" "$suffix"
}

bundle_file_checksum_manifest() {
  local bundle_dir="$1"
  local checksum_file="$bundle_dir/.checksums"

  : > "$checksum_file"

  if [[ -d "$bundle_dir/binds" ]]; then
    while IFS= read -r -d '' file; do
      sha256sum "$file" >> "$checksum_file"
    done < <(find "$bundle_dir/binds" -type f -print0 | sort -z)
  fi

  if [[ -d "$bundle_dir/volumes" ]]; then
    while IFS= read -r -d '' file; do
      sha256sum "$file" >> "$checksum_file"
    done < <(find "$bundle_dir/volumes" -type f -print0 | sort -z)
  fi
}

sync_bundle_hash() {
  local bundle_dir="$1"
  local checksum_file="$bundle_dir/.checksums"

  bundle_file_checksum_manifest "$bundle_dir"

  if [[ ! -s "$checksum_file" ]]; then
    printf 'empty-bundle\n' | sha256sum | awk '{print $1}'
    rm -f "$checksum_file"
    return
  fi

  sha256sum "$checksum_file" | awk '{print $1}'
  rm -f "$checksum_file"
}

write_bundle_metadata() {
  local bundle_dir="$1"
  local token="$2"
  local base_token="$3"
  local hash_value="$4"
  local created_at="$5"
  local role="$6"

  {
    printf 'LIBRECHAT_SYNC_MACHINE_ID=%q\n' "$LIBRECHAT_SYNC_MACHINE_ID"
    printf 'LIBRECHAT_SYNC_CREATED_AT=%q\n' "$created_at"
    printf 'LIBRECHAT_SYNC_TOKEN=%q\n' "$token"
    printf 'LIBRECHAT_SYNC_BASE_TOKEN=%q\n' "$base_token"
    printf 'LIBRECHAT_SYNC_HASH=%q\n' "$hash_value"
    printf 'LIBRECHAT_SYNC_ROLE=%q\n' "$role"
  } > "$(bundle_metadata_file "$bundle_dir")"
}

load_bundle_metadata() {
  local bundle_dir="$1"
  local metadata_file
  metadata_file="$(bundle_metadata_file "$bundle_dir")"

  [[ -f "$metadata_file" ]] || sync_fail "Missing bundle metadata: $metadata_file"
  # shellcheck disable=SC1090
  source "$metadata_file"
}

copy_relpath_to_bundle() {
  local relpath="$1"
  local bundle_dir="$2"
  local src="$ROOT_DIR/$relpath"
  local dest="$bundle_dir/binds/$relpath"
  local local_uid
  local local_gid
  local_uid="$(id -u)"
  local_gid="$(id -g)"

  if [[ -d "$src" ]]; then
    mkdir -p "$bundle_dir/binds"
    local archive_name
    archive_name="$(bind_dir_archive_name "$relpath")"
    rm -f "$bundle_dir/binds/$archive_name"
    docker run --rm \
      -v "$src:/source:ro" \
      -v "$bundle_dir/binds:/backup" \
      alpine sh -c "cd /source && tar -czf /backup/$archive_name . && chown $local_uid:$local_gid /backup/$archive_name"
    return
  fi

  if [[ -f "$src" || -L "$src" ]]; then
    mkdir -p "$(dirname "$dest")"
    cp -L "$src" "$dest"
    return
  fi

  sync_fail "Missing sync source path: $src"
}

restore_relpath_from_bundle() {
  local relpath="$1"
  local bundle_dir="$2"
  local src="$bundle_dir/binds/$relpath"
  local dest="$ROOT_DIR/$relpath"
  local archive_name
  archive_name="$(bind_dir_archive_name "$relpath")"
  local archive_path="$bundle_dir/binds/$archive_name"
  local local_uid
  local local_gid
  local_uid="$(id -u)"
  local_gid="$(id -g)"

  if [[ -f "$archive_path" ]]; then
    mkdir -p "$dest"
    docker run --rm \
      -v "$dest:/restore" \
      -v "$bundle_dir/binds:/backup:ro" \
      alpine sh -c "find /restore -mindepth 1 -delete && cd /restore && tar -xzf /backup/$archive_name && chown -R $local_uid:$local_gid /restore"
    return
  fi

  if [[ -f "$src" || -L "$src" ]]; then
    mkdir -p "$(dirname "$dest")"
    rm -f "$dest"
    cp "$src" "$dest"
    return
  fi

  sync_fail "Missing bundled path for restore: $src"
}

bind_dir_archive_name() {
  local relpath="$1"
  local archive_name="$relpath"

  archive_name="${archive_name//./_dot_}"
  archive_name="${archive_name//\//__}"

  printf '%s.tar.gz\n' "$archive_name"
}

compose_volume_name() {
  local volume_key="$1"
  printf '%s_%s\n' "$COMPOSE_PROJECT_NAME" "$volume_key"
}

volume_archive_name() {
  local volume_key="$1"
  printf '%s.tar.gz\n' "$volume_key"
}

ensure_volume_exists() {
  local volume_name="$1"
  docker volume inspect "$volume_name" >/dev/null 2>&1 || docker volume create "$volume_name" >/dev/null
}

export_volume_archive() {
  local volume_key="$1"
  local bundle_dir="$2"
  local volume_name
  volume_name="$(compose_volume_name "$volume_key")"
  local archive_name
  archive_name="$(volume_archive_name "$volume_key")"
  local local_uid
  local local_gid
  local_uid="$(id -u)"
  local_gid="$(id -g)"

  ensure_volume_exists "$volume_name"
  mkdir -p "$bundle_dir/volumes"

  docker run --rm \
    -v "$volume_name:/volume:ro" \
    -v "$bundle_dir/volumes:/backup" \
    alpine sh -c "cd /volume && tar -czf /backup/$archive_name . && chown $local_uid:$local_gid /backup/$archive_name"
}

restore_volume_archive() {
  local volume_key="$1"
  local bundle_dir="$2"
  local volume_name
  volume_name="$(compose_volume_name "$volume_key")"
  local archive_name
  archive_name="$(volume_archive_name "$volume_key")"
  local archive_path="$bundle_dir/volumes/$archive_name"

  [[ -f "$archive_path" ]] || sync_fail "Missing bundled volume archive: $archive_path"

  ensure_volume_exists "$volume_name"

  docker run --rm -v "$volume_name:/volume" alpine sh -c 'find /volume -mindepth 1 -delete'
  docker run --rm \
    -v "$volume_name:/volume" \
    -v "$bundle_dir/volumes:/backup:ro" \
    alpine sh -c "cd /volume && tar -xzf /backup/$archive_name"
}

dev_services_running() {
  docker compose -f "$ROOT_DIR/docker-compose.yml" -f "$ROOT_DIR/docker-compose.local.override.yml" ps --status running --services | grep -q .
}

assert_dev_stopped() {
  if dev_services_running; then
    sync_fail "Dev rail must be stopped before exporting or importing state."
  fi
}

require_sync_ssh_key() {
  [[ -f "$LIBRECHAT_SYNC_SSH_KEY" ]] || sync_fail "Missing SSH key for sync: $LIBRECHAT_SYNC_SSH_KEY"
}

sync_ssh() {
  require_sync_ssh_key
  ssh \
    -i "$LIBRECHAT_SYNC_SSH_KEY" \
    -o BatchMode=yes \
    -o StrictHostKeyChecking=accept-new \
    -o ConnectTimeout="$LIBRECHAT_SYNC_REMOTE_CONNECT_TIMEOUT_SECONDS" \
    "$LIBRECHAT_SYNC_REMOTE_SSH_TARGET" \
    "$@"
}

sync_remote_available() {
  sync_ssh "printf ready" >/dev/null 2>&1
}

sync_rsync_upload_dir() {
  local local_dir="$1"
  local remote_dir="$2"
  require_sync_ssh_key
  rsync \
    -az \
    --delete \
    -e "ssh -i $LIBRECHAT_SYNC_SSH_KEY -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=$LIBRECHAT_SYNC_REMOTE_CONNECT_TIMEOUT_SECONDS" \
    "$local_dir/" \
    "$LIBRECHAT_SYNC_REMOTE_SSH_TARGET:$remote_dir/"
}

sync_rsync_download_dir() {
  local remote_dir="$1"
  local local_dir="$2"
  require_sync_ssh_key
  mkdir -p "$local_dir"
  rsync \
    -az \
    --delete \
    -e "ssh -i $LIBRECHAT_SYNC_SSH_KEY -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=$LIBRECHAT_SYNC_REMOTE_CONNECT_TIMEOUT_SECONDS" \
    "$LIBRECHAT_SYNC_REMOTE_SSH_TARGET:$remote_dir/" \
    "$local_dir/"
}

run_remote_repo_script() {
  local script_name="$1"
  shift

  local remote_cmd
  remote_cmd="bash $(printf '%q' "$LIBRECHAT_SYNC_REMOTE_REPO_ROOT/local-services/$script_name")"

  local arg
  for arg in "$@"; do
    remote_cmd+=" $(printf '%q' "$arg")"
  done

  sync_ssh "$remote_cmd"
}

copy_bundle_dir() {
  local src_dir="$1"
  local dest_dir="$2"

  rm -rf "$dest_dir"
  mkdir -p "$dest_dir"
  rsync -a --delete "$src_dir/" "$dest_dir/"
}

refresh_authoritative_bundle() {
  local auth_dir
  auth_dir="$(authoritative_bundle_dir)"
  local current_token
  current_token="$(read_current_token)"

  if dev_services_running; then
    return 2
  fi

  local temp_dir
  temp_dir="$LIBRECHAT_SYNC_BUNDLES_DIR/authoritative-refresh.$$"
  rm -rf "$temp_dir"

  LIBRECHAT_SYNC_BASE_TOKEN="$current_token" \
  LIBRECHAT_SYNC_ROLE="source-authoritative" \
    "$ROOT_DIR/local-services/export-dev-bundle.sh" "$temp_dir" >/dev/null

  load_bundle_metadata "$temp_dir"
  local refreshed_hash="$LIBRECHAT_SYNC_HASH"
  local created_at="$LIBRECHAT_SYNC_CREATED_AT"
  local token_to_use="$current_token"

  # Only bootstrap a new token when none exists yet. Hash-based token
  # advancement is intentionally disabled because Docker tar archives are
  # non-deterministic (timestamps and file ordering vary between runs),
  # so the bundle hash changes even when the underlying data is identical.
  # Tokens advance reliably through import-dev-bundle.sh and the
  # accepted-apply path in remote-apply-dev-bundle.sh instead.
  if [[ -z "$token_to_use" ]]; then
    token_to_use="$(generate_sync_token source)"
  fi

  write_bundle_metadata "$temp_dir" "$token_to_use" "$token_to_use" "$refreshed_hash" "$created_at" "source-authoritative"
  mkdir -p "$LIBRECHAT_SYNC_AUTH_DIR"
  copy_bundle_dir "$temp_dir" "$auth_dir"
  rm -rf "$temp_dir"
  write_current_token "$token_to_use"
  printf '%s\n' "$token_to_use"
}

status_value() {
  local key="$1"
  local status_text="$2"
  local line

  while IFS= read -r line; do
    case "$line" in
      "$key="*)
        printf '%s\n' "${line#*=}"
        return 0
        ;;
    esac
  done <<< "$status_text"

  return 1
}
