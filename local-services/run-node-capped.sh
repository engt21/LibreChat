#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  local-services/run-node-capped.sh <profile>
  local-services/run-node-capped.sh [--memory-max SIZE] [--heap-mb MB] [--swap-max SIZE] -- <command...>

Profiles:
  lint       MemoryMax=3G, Node heap=1024 MB, command: npm run lint
  lint:fix   MemoryMax=3G, Node heap=1024 MB, command: npm run lint:fix
  build      MemoryMax=4G, Node heap=1536 MB, command: npm run build
  frontend   MemoryMax=4G, Node heap=1536 MB, command: npm run frontend
  test:all   MemoryMax=3G, Node heap=1024 MB, command: npm run test:all

Overrides:
  LIBRECHAT_NODE_LINT_MEMORY_MAX
  LIBRECHAT_NODE_LINT_HEAP_MB
  LIBRECHAT_NODE_BUILD_MEMORY_MAX
  LIBRECHAT_NODE_BUILD_HEAP_MB
  LIBRECHAT_NODE_TEST_MEMORY_MAX
  LIBRECHAT_NODE_TEST_HEAP_MB
  LIBRECHAT_NODE_CAP_MEMORY_MAX
  LIBRECHAT_NODE_CAP_HEAP_MB
  LIBRECHAT_NODE_CAP_SWAP_MAX

Examples:
  npm run lint:capped
  npm run build:capped
  ./local-services/run-node-capped.sh --memory-max 2G --heap-mb 768 -- npm run build:api
EOF
}

memory_max="${LIBRECHAT_NODE_CAP_MEMORY_MAX:-3G}"
heap_mb="${LIBRECHAT_NODE_CAP_HEAP_MB:-1024}"
swap_max="${LIBRECHAT_NODE_CAP_SWAP_MAX:-0}"
command=()

if [[ $# -eq 0 ]]; then
  usage >&2
  exit 2
fi

if [[ "$1" != --* ]]; then
  profile="$1"
  shift

  case "$profile" in
    lint)
      memory_max="${LIBRECHAT_NODE_LINT_MEMORY_MAX:-3G}"
      heap_mb="${LIBRECHAT_NODE_LINT_HEAP_MB:-1024}"
      command=(npm run lint)
      ;;
    lint:fix)
      memory_max="${LIBRECHAT_NODE_LINT_MEMORY_MAX:-3G}"
      heap_mb="${LIBRECHAT_NODE_LINT_HEAP_MB:-1024}"
      command=(npm run lint:fix)
      ;;
    build)
      memory_max="${LIBRECHAT_NODE_BUILD_MEMORY_MAX:-4G}"
      heap_mb="${LIBRECHAT_NODE_BUILD_HEAP_MB:-1536}"
      command=(npm run build)
      ;;
    frontend)
      memory_max="${LIBRECHAT_NODE_BUILD_MEMORY_MAX:-4G}"
      heap_mb="${LIBRECHAT_NODE_BUILD_HEAP_MB:-1536}"
      command=(npm run frontend)
      ;;
    test:all)
      memory_max="${LIBRECHAT_NODE_TEST_MEMORY_MAX:-3G}"
      heap_mb="${LIBRECHAT_NODE_TEST_HEAP_MB:-1024}"
      command=(npm run test:all)
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown capped Node profile: $profile" >&2
      usage >&2
      exit 2
      ;;
  esac
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --memory-max)
      memory_max="${2:?Missing value for --memory-max}"
      shift 2
      ;;
    --heap-mb)
      heap_mb="${2:?Missing value for --heap-mb}"
      shift 2
      ;;
    --swap-max)
      swap_max="${2:?Missing value for --swap-max}"
      shift 2
      ;;
    --)
      shift
      if [[ $# -eq 0 ]]; then
        echo "Missing command after --" >&2
        exit 2
      fi
      command=("$@")
      break
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ ${#command[@]} -eq 0 ]]; then
  echo "No command selected" >&2
  usage >&2
  exit 2
fi

if ! [[ "$heap_mb" =~ ^[0-9]+$ ]]; then
  echo "--heap-mb must be an integer number of megabytes, got: $heap_mb" >&2
  exit 2
fi

if ! command -v systemd-run >/dev/null 2>&1; then
  echo "systemd-run is required for cgroup memory caps" >&2
  exit 127
fi

node_options="--max-old-space-size=${heap_mb}"

echo "Running capped LibreChat Node command:"
echo "  MemoryMax=${memory_max}"
echo "  MemorySwapMax=${swap_max}"
echo "  NODE_OPTIONS=${node_options}"
printf '  Command:'
printf ' %q' "${command[@]}"
printf '\n'

exec systemd-run \
  --user \
  --scope \
  --collect \
  --property=MemoryAccounting=yes \
  --property="MemoryMax=${memory_max}" \
  --property="MemorySwapMax=${swap_max}" \
  --working-directory="$ROOT_DIR" \
  --setenv="NODE_OPTIONS=${node_options}" \
  --setenv=LIBRECHAT_NODE_CAPPED=1 \
  "${command[@]}"
