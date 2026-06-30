#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'USAGE'
Usage:
  ./local-services/deploy-runtime-delta.sh <dev|stable> [options] -- <file-or-dir> [...]
  ./local-services/deploy-runtime-delta.sh <dev|stable> --changed [options]

Fast-deploys small runtime changes without rebuilding the Docker image.

What this script can deploy:
  - api/** runtime JS files loaded directly by api/server/index.js
  - config/*.js helper/runtime patch files
  - local-services/*.sh helper scripts
  - runtime bind files such as librechat.yaml and .env
  - already-built package dist files under packages/*/dist/**

What this script refuses:
  - client/src/** and individual client/dist/** files
    Use: npm run build:client && ./local-services/deploy-built-client-dist.sh <rail>
  - packages/*/src/** source files
    Build package dist first, then deploy the dist artifact.
  - package.json, package-lock.json, Dockerfile, and compose-file changes
    Those need an image rebuild or compose recreate.

Options:
  --changed                 Use git modified/untracked files as input.
  --files-from FILE         Read newline-delimited paths from FILE.
  --dry-run                 Classify and print actions without changing anything.
  --approve-stable          Required for stable mutations, together with
                            LIBRECHAT_STABLE_RUNTIME_DELTA_APPROVAL=YES.
  --container NAME          Override target API container.
  --remote TARGET           Override stable SSH target
                            (default: timeng@192.168.50.104).
  --remote-root DIR         Override stable runtime bundle root
                            (default: /opt/LibreChat-custom).
  --health-url URL          Override post-restart health URL.
  --health-timeout SEC      Seconds to wait for recovery (default: 60).
  --no-restart              Copy files but do not restart.
  --skip-health-check       Do not perform HTTP health verification.
  --apply-runtime-patches   Run node /app/config/apply-runtime-patches.js after copy.
  -h, --help                Show this help.

Stable example after explicit approval:
  LIBRECHAT_STABLE_RUNTIME_DELTA_APPROVAL=YES \
    ./local-services/deploy-runtime-delta.sh stable --approve-stable -- api/server/routes/presets.js

Dev dry-run from the current worktree changes:
  ./local-services/deploy-runtime-delta.sh dev --changed --dry-run
USAGE
}

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

log() {
  printf '[runtime-delta] %s\n' "$*"
}

quote() {
  printf '%q' "$1"
}

append_unique() {
  local array_name="$1"
  local value="$2"
  local existing
  local -n target_array="$array_name"

  for existing in "${target_array[@]}"; do
    [[ "$existing" == "$value" ]] && return 0
  done
  target_array+=("$value")
}

print_list() {
  local title="$1"
  shift

  echo "$title"
  if [[ "$#" -eq 0 ]]; then
    echo "  (none)"
    return
  fi

  local item
  for item in "$@"; do
    echo "  - $item"
  done
}

normalize_input_path() {
  local raw="$1"
  local normalized="${raw#./}"

  [[ -n "$normalized" ]] || return 1
  [[ "$normalized" != /* ]] || return 1
  [[ "$normalized" != *".."* ]] || return 1
  [[ "$normalized" =~ ^[A-Za-z0-9._@+/=-]+$ ]] || return 1

  printf '%s\n' "$normalized"
}

input_files=()
changed_mode=false
dry_run=false
approve_stable=false
restart_after=true
run_health_check=true
force_apply_runtime_patches=false
container_override=""
stable_remote="${LIBRECHAT_STABLE_SSH_TARGET:-timeng@192.168.50.104}"
stable_remote_root="${LIBRECHAT_STABLE_ROOT:-/opt/LibreChat-custom}"
health_url_override=""
health_timeout="${LIBRECHAT_RUNTIME_DELTA_HEALTH_TIMEOUT:-60}"

rail="${1:-}"
if [[ -z "$rail" || "$rail" == "-h" || "$rail" == "--help" ]]; then
  usage
  [[ -n "$rail" ]] && exit 0 || exit 2
fi
shift

while [[ $# -gt 0 ]]; do
  case "$1" in
    --changed)
      changed_mode=true
      shift
      ;;
    --files-from)
      files_from="${2:-}"
      [[ -n "$files_from" ]] || fail "Missing path after --files-from."
      [[ -f "$files_from" ]] || fail "Files list not found: $files_from"
      while IFS= read -r line; do
        [[ -n "$line" ]] && input_files+=("$line")
      done < "$files_from"
      shift 2
      ;;
    --dry-run)
      dry_run=true
      shift
      ;;
    --approve-stable)
      approve_stable=true
      shift
      ;;
    --container)
      container_override="${2:-}"
      [[ -n "$container_override" ]] || fail "Missing name after --container."
      shift 2
      ;;
    --remote)
      stable_remote="${2:-}"
      [[ -n "$stable_remote" ]] || fail "Missing SSH target after --remote."
      shift 2
      ;;
    --remote-root)
      stable_remote_root="${2:-}"
      [[ -n "$stable_remote_root" ]] || fail "Missing directory after --remote-root."
      shift 2
      ;;
    --health-url)
      health_url_override="${2:-}"
      [[ -n "$health_url_override" ]] || fail "Missing URL after --health-url."
      shift 2
      ;;
    --health-timeout)
      health_timeout="${2:-}"
      [[ "$health_timeout" =~ ^[0-9]+$ ]] || fail "--health-timeout must be an integer."
      shift 2
      ;;
    --no-restart)
      restart_after=false
      shift
      ;;
    --skip-health-check)
      run_health_check=false
      shift
      ;;
    --apply-runtime-patches)
      force_apply_runtime_patches=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      while [[ $# -gt 0 ]]; do
        input_files+=("$1")
        shift
      done
      ;;
    -*)
      fail "Unknown option: $1"
      ;;
    *)
      input_files+=("$1")
      shift
      ;;
  esac
done

case "$rail" in
  dev)
    remote_mode=false
    container="${container_override:-librechat-dev-api}"
    health_url="${health_url_override:-http://127.0.0.1:3081/api/config}"
    ;;
  stable)
    remote_mode=true
    container="${container_override:-LibreChat}"
    health_url="${health_url_override:-http://192.168.50.104:3080/api/config}"
    ;;
  *)
    fail "Rail must be 'dev' or 'stable', got: $rail"
    ;;
esac

if $changed_mode; then
  while IFS= read -r changed_file; do
    [[ -n "$changed_file" ]] && input_files+=("$changed_file")
  done < <(
    git -C "$ROOT_DIR" ls-files -m -o --exclude-standard |
      grep -Ev '^(output/|logs/|uploads/|images/|data-node/|meili_data|node_modules/|\.playwright|\.factory/)'
  )
fi

[[ "${#input_files[@]}" -gt 0 ]] || fail "No input files. Pass paths, --files-from, or --changed."

expanded_files=()
for raw_file in "${input_files[@]}"; do
  normalized="$(normalize_input_path "$raw_file")" || fail "Unsafe or unsupported path: $raw_file"
  if [[ -d "$ROOT_DIR/$normalized" ]]; then
    case "$normalized" in
      packages/*/dist|client/dist)
        append_unique expanded_files "$normalized"
        ;;
      *)
        while IFS= read -r -d '' child; do
          child="${child#"$ROOT_DIR"/}"
          append_unique expanded_files "$child"
        done < <(find "$ROOT_DIR/$normalized" -type f -print0 | sort -z)
        ;;
    esac
  else
    append_unique expanded_files "$normalized"
  fi
done

container_files=()
container_dirs=()
host_files=()
ignored_files=()
rejected_files=()
needs_restart=false
needs_runtime_patch=false

classify_file() {
  local file="$1"

  if [[ -d "$ROOT_DIR/$file" ]]; then
    case "$file" in
      packages/*/dist)
        append_unique container_dirs "$file"
        needs_restart=true
        ;;
      client/dist)
        rejected_files+=("$file -> built frontend tree; deploy the whole manifest-verified client/dist tree with deploy-built-client-dist.sh")
        ;;
      *)
        rejected_files+=("$file -> directory deployment is only supported for packages/*/dist artifacts")
        ;;
    esac
    return
  fi

  if [[ ! -f "$ROOT_DIR/$file" ]]; then
    rejected_files+=("$file -> missing locally; deletion fast-deploy is intentionally unsupported")
    return
  fi

  case "$file" in
    .env.example|librechat.example.yaml|*.md|*.png|*.jpg|*.jpeg|*.gif|*.webp|*.spec.*|*.test.*|*/__tests__/*)
      ignored_files+=("$file -> non-runtime file")
      ;;
    package.json|package-lock.json|Dockerfile|Dockerfile.*|docker-compose.yml|docker-compose.*.yml|api/package.json|client/package.json|packages/*/package.json)
      rejected_files+=("$file -> dependency/image/compose change; use a cached image rebuild or compose recreate")
      ;;
    client/src/*|client/public/*|client/index.html|client/vite.config.*|client/scripts/post-build.cjs)
      rejected_files+=("$file -> frontend source/input; run npm run build:client, then deploy-built-client-dist.sh")
      ;;
    client/dist/*)
      rejected_files+=("$file -> built frontend member; deploy the whole manifest-verified client/dist tree with deploy-built-client-dist.sh")
      ;;
    packages/api/src/*|packages/data-provider/src/*|packages/data-schemas/src/*|packages/client/src/*)
      rejected_files+=("$file -> package source; build package dist first, then deploy packages/*/dist artifacts")
      ;;
    packages/api/dist/*|packages/data-provider/dist/*|packages/data-schemas/dist/*|packages/client/dist/*)
      append_unique container_files "$file"
      needs_restart=true
      ;;
    .env|librechat.yaml|langfuse/.env|data/google-service-account.json)
      append_unique host_files "$file"
      needs_restart=true
      ;;
    config/apply-runtime-patches.js)
      append_unique host_files "$file"
      append_unique container_files "$file"
      needs_runtime_patch=true
      needs_restart=true
      ;;
    config/*.js|config/*.ts|config/*.json|config/translations/*)
      append_unique host_files "$file"
      append_unique container_files "$file"
      ;;
    local-services/*.sh)
      append_unique host_files "$file"
      append_unique container_files "$file"
      ;;
    api/*)
      append_unique container_files "$file"
      needs_restart=true
      ;;
    *)
      rejected_files+=("$file -> unknown runtime surface; add an explicit deployment rule before copying it")
      ;;
  esac
}

for file in "${expanded_files[@]}"; do
  classify_file "$file"
done

if $force_apply_runtime_patches; then
  needs_runtime_patch=true
  needs_restart=true
fi

echo "Runtime delta classification for rail: $rail"
if $remote_mode; then
  echo "  remote: $stable_remote"
  echo "  remote root: $stable_remote_root"
fi
echo "  container: $container"
echo "  health URL: $health_url"
echo
print_list "Container files to copy into /app:" "${container_files[@]}"
print_list "Container directories to replace under /app:" "${container_dirs[@]}"
print_list "Host runtime files to sync:" "${host_files[@]}"
print_list "Ignored inputs:" "${ignored_files[@]}"
print_list "Rejected inputs:" "${rejected_files[@]}"
echo

if [[ "${#rejected_files[@]}" -gt 0 ]]; then
  cat >&2 <<'EOF'
Refusing runtime-delta deployment because at least one input is not safe to copy directly.

Common fixes:
  - For client/src changes:
      ./local-services/run-node-capped.sh --memory-max 8G --heap-mb 4096 -- npm run build:client
      ./local-services/deploy-built-client-dist.sh dev
  - For packages/*/src changes:
      ./local-services/run-node-capped.sh --memory-max 4G --heap-mb 1536 -- npm run build:packages
      ./local-services/deploy-runtime-delta.sh dev -- packages/api/dist packages/data-provider/dist packages/data-schemas/dist
  - For Dockerfile/package/compose changes:
      use the normal cached image build or compose recreate path.
EOF
  exit 2
fi

if [[ "${#container_files[@]}" -eq 0 && "${#container_dirs[@]}" -eq 0 && "${#host_files[@]}" -eq 0 ]]; then
  log "No runtime files to deploy after classification."
  exit 0
fi

if $dry_run; then
  log "Dry-run mode: no files were copied and no container was restarted."
  if $needs_runtime_patch; then
    log "Would run runtime patch application inside $container."
  fi
  if $needs_restart && $restart_after; then
    log "Would restart $container and wait for $health_url."
  fi
  exit 0
fi

if [[ "$rail" == "stable" ]]; then
  $approve_stable || fail "Stable runtime delta requires --approve-stable after explicit production-maintenance approval."
  [[ "${LIBRECHAT_STABLE_RUNTIME_DELTA_APPROVAL:-}" == "YES" ]] || fail "Stable runtime delta requires LIBRECHAT_STABLE_RUNTIME_DELTA_APPROVAL=YES."
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"

remote_ssh() {
  ssh \
    -o BatchMode=yes \
    -o StrictHostKeyChecking=accept-new \
    -o ConnectTimeout="${LIBRECHAT_RUNTIME_DELTA_CONNECT_TIMEOUT:-8}" \
    "$stable_remote" \
    "bash -lc $(quote "set -euo pipefail; $1")"
}

remote_copy_stage() {
  local remote_stage="$1"
  shift

  [[ "$#" -gt 0 ]] || return 0
  tar -C "$ROOT_DIR" -cf - "$@" |
    ssh \
      -o BatchMode=yes \
      -o StrictHostKeyChecking=accept-new \
      -o ConnectTimeout="${LIBRECHAT_RUNTIME_DELTA_CONNECT_TIMEOUT:-8}" \
      "$stable_remote" \
      "bash -lc $(quote "set -euo pipefail; tar -C $(quote "$remote_stage") -xf -")"
}

copy_to_local_container() {
  local file="$1"
  local snapshot_dir="$2"
  local dest_dir
  dest_dir="$(dirname "$file")"

  mkdir -p "$snapshot_dir/container/$dest_dir"
  if docker exec "$container" test -e "/app/$file" >/dev/null 2>&1; then
    docker cp "$container:/app/$file" "$snapshot_dir/container/$file" >/dev/null
  else
    printf '%s\n' "$file" >> "$snapshot_dir/container-missing.txt"
  fi

  docker exec "$container" mkdir -p "/app/$dest_dir" >/dev/null
  docker cp "$ROOT_DIR/$file" "$container:/app/$file" >/dev/null
}

copy_dir_to_local_container() {
  local directory="$1"
  local snapshot_dir="$2"
  local parent_dir
  parent_dir="$(dirname "$directory")"

  mkdir -p "$snapshot_dir/container/$parent_dir"
  if docker exec "$container" test -e "/app/$directory" >/dev/null 2>&1; then
    docker cp "$container:/app/$directory" "$snapshot_dir/container/$parent_dir/" >/dev/null
  else
    printf '%s\n' "$directory" >> "$snapshot_dir/container-dir-missing.txt"
  fi

  docker exec "$container" sh -lc "rm -rf $(quote "/app/$directory"); mkdir -p $(quote "/app/$parent_dir")" >/dev/null
  docker cp "$ROOT_DIR/$directory" "$container:/app/$parent_dir/" >/dev/null
}

apply_local_runtime_patches() {
  log "Applying runtime patches inside $container"
  docker exec "$container" node /app/config/apply-runtime-patches.js
}

wait_for_health() {
  local url="$1"
  local attempt

  for ((attempt = 0; attempt <= health_timeout; attempt += 2)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done

  return 1
}

if $remote_mode; then
  remote_stage="/tmp/librechat-runtime-delta-${timestamp}"
  remote_snapshot="$stable_remote_root/output/runtime-delta-deployments/${timestamp}-${rail}"
  transfer_files=()
  for file in "${host_files[@]}" "${container_files[@]}" "${container_dirs[@]}"; do
    append_unique transfer_files "$file"
  done

  log "Validating deployed OpenAI reasoning preservation invariant before stable delta"
  remote_ssh "cd $(quote "$stable_remote_root") && ./local-services/verify-openai-reasoning-preservation.sh --container $(quote "$container")"

  log "Preparing remote stage: $stable_remote:$remote_stage"
  remote_ssh "docker inspect $(quote "$container") >/dev/null; mkdir -p $(quote "$remote_stage") $(quote "$remote_snapshot")"
  remote_copy_stage "$remote_stage" "${transfer_files[@]}"

  for file in "${host_files[@]}"; do
    file_dir="$(dirname "$file")"
    remote_ssh "mkdir -p $(quote "$remote_snapshot/host/$file_dir") $(quote "$stable_remote_root/$file_dir"); if [ -e $(quote "$stable_remote_root/$file") ]; then cp -a $(quote "$stable_remote_root/$file") $(quote "$remote_snapshot/host/$file"); else printf '%s\n' $(quote "$file") >> $(quote "$remote_snapshot/host-missing.txt"); fi; cp -a $(quote "$remote_stage/$file") $(quote "$stable_remote_root/$file")"
  done

  for file in "${container_files[@]}"; do
    file_dir="$(dirname "$file")"
    remote_ssh "mkdir -p $(quote "$remote_snapshot/container/$file_dir"); if docker exec $(quote "$container") test -e $(quote "/app/$file"); then docker cp $(quote "$container:/app/$file") $(quote "$remote_snapshot/container/$file"); else printf '%s\n' $(quote "$file") >> $(quote "$remote_snapshot/container-missing.txt"); fi; docker exec $(quote "$container") mkdir -p $(quote "/app/$file_dir"); docker cp $(quote "$remote_stage/$file") $(quote "$container:/app/$file")"
  done

  for directory in "${container_dirs[@]}"; do
    parent_dir="$(dirname "$directory")"
    remote_ssh "mkdir -p $(quote "$remote_snapshot/container/$parent_dir"); if docker exec $(quote "$container") test -e $(quote "/app/$directory"); then docker cp $(quote "$container:/app/$directory") $(quote "$remote_snapshot/container/$parent_dir/"); else printf '%s\n' $(quote "$directory") >> $(quote "$remote_snapshot/container-dir-missing.txt"); fi; docker exec $(quote "$container") sh -lc $(quote "rm -rf $(quote "/app/$directory"); mkdir -p $(quote "/app/$parent_dir")"); docker cp $(quote "$remote_stage/$directory") $(quote "$container:/app/$parent_dir/")"
  done

  if $needs_runtime_patch; then
    log "Applying runtime patches inside $stable_remote:$container"
    remote_ssh "docker exec $(quote "$container") node /app/config/apply-runtime-patches.js"
  fi

  if $needs_restart && $restart_after; then
    log "Restarting $stable_remote:$container"
    remote_ssh "docker restart $(quote "$container") >/dev/null"
  elif $needs_restart; then
    log "Restart skipped by --no-restart; copied changes may not be active yet."
  fi

  remote_ssh "rm -rf $(quote "$remote_stage")"
  log "Remote rollback snapshot retained at: $stable_remote:$remote_snapshot"
else
  command -v docker >/dev/null 2>&1 || fail "docker is required."
  docker inspect "$container" >/dev/null 2>&1 || fail "Target container does not exist: $container"

  snapshot_dir="$ROOT_DIR/output/runtime-delta-deployments/${timestamp}-${rail}"
  mkdir -p "$snapshot_dir"
  log "Snapshotting current files to: $snapshot_dir"

  for file in "${container_files[@]}"; do
    copy_to_local_container "$file" "$snapshot_dir"
  done
  for directory in "${container_dirs[@]}"; do
    copy_dir_to_local_container "$directory" "$snapshot_dir"
  done

  if $needs_runtime_patch; then
    apply_local_runtime_patches
  fi

  if $needs_restart && $restart_after; then
    log "Restarting $container"
    docker restart "$container" >/dev/null
  elif $needs_restart; then
    log "Restart skipped by --no-restart; copied changes may not be active yet."
  fi
fi

if $run_health_check && $needs_restart && $restart_after; then
  log "Waiting for health: $health_url"
  wait_for_health "$health_url" || fail "Runtime delta copied, but health check did not recover: $health_url"
fi

if [[ "$rail" == "stable" ]]; then
  if $remote_mode; then
    log "Validating deployed OpenAI reasoning preservation invariant on stable"
    remote_ssh "cd $(quote "$stable_remote_root") && ./local-services/verify-openai-reasoning-preservation.sh --container $(quote "$container")"
  fi
fi

log "Runtime delta deployment complete."
