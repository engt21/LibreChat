#!/usr/bin/env bash
set -euo pipefail

container="LibreChat"
minimum_container_bytes=$((5 * 1024 * 1024 * 1024))
minimum_heap_mb=4096
minimum_native_margin_mb=1024
minimum_available_mb=768

while [[ $# -gt 0 ]]; do
  case "$1" in
    --container)
      container="${2:?Missing container after --container}"
      shift 2
      ;;
    --minimum-container-mb)
      minimum_container_bytes=$(( ${2:?Missing MB after --minimum-container-mb} * 1024 * 1024 ))
      shift 2
      ;;
    --minimum-heap-mb)
      minimum_heap_mb="${2:?Missing MB after --minimum-heap-mb}"
      shift 2
      ;;
    --minimum-native-margin-mb)
      minimum_native_margin_mb="${2:?Missing MB after --minimum-native-margin-mb}"
      shift 2
      ;;
    --minimum-available-mb)
      minimum_available_mb="${2:?Missing MB after --minimum-available-mb}"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [--container NAME] [--minimum-container-mb MB] [--minimum-heap-mb MB] [--minimum-native-margin-mb MB] [--minimum-available-mb MB]"
      exit 0
      ;;
    *)
      echo "ERROR: unknown option: $1" >&2
      exit 2
      ;;
  esac
done

docker inspect "$container" >/dev/null 2>&1 || {
  echo "ERROR: container does not exist: $container" >&2
  exit 1
}

container_bytes="$(docker inspect -f '{{.HostConfig.Memory}}' "$container")"
node_options="$(docker exec "$container" sh -lc 'printf %s "$NODE_OPTIONS"')"
heap_mb="$(sed -nE 's/.*--max-old-space-size=([0-9]+).*/\1/p' <<<"$node_options")"
cgroup_values="$(docker exec "$container" sh -lc 'printf "%s|%s" "$(cat /sys/fs/cgroup/memory.max 2>/dev/null)" "$(cat /sys/fs/cgroup/memory.current 2>/dev/null)"')"
IFS='|' read -r cgroup_max_bytes cgroup_current_bytes <<<"$cgroup_values"

if [[ ! "$container_bytes" =~ ^[0-9]+$ ]] || (( container_bytes < minimum_container_bytes )); then
  echo "ERROR: $container memory limit is ${container_bytes:-unknown} bytes; require at least $minimum_container_bytes" >&2
  exit 1
fi

if [[ ! "$heap_mb" =~ ^[0-9]+$ ]] || (( heap_mb < minimum_heap_mb )); then
  echo "ERROR: $container NODE_OPTIONS is '$node_options'; require --max-old-space-size=$minimum_heap_mb or higher" >&2
  exit 1
fi

for value_name in minimum_native_margin_mb minimum_available_mb; do
  value="${!value_name}"
  if [[ ! "$value" =~ ^[0-9]+$ ]]; then
    echo "ERROR: $value_name must be a non-negative integer, got '$value'" >&2
    exit 2
  fi
done

if [[ ! "$cgroup_max_bytes" =~ ^[0-9]+$ ]] || [[ ! "$cgroup_current_bytes" =~ ^[0-9]+$ ]]; then
  echo "ERROR: unable to read finite cgroup v2 memory.max/current for $container" >&2
  exit 1
fi

if (( cgroup_max_bytes != container_bytes )); then
  echo "ERROR: $container cgroup memory.max ($cgroup_max_bytes) does not match Docker limit ($container_bytes)" >&2
  exit 1
fi

native_margin_bytes=$(( container_bytes - heap_mb * 1024 * 1024 ))
minimum_native_margin_bytes=$(( minimum_native_margin_mb * 1024 * 1024 ))
if (( native_margin_bytes < minimum_native_margin_bytes )); then
  echo "ERROR: $container reserves only $((native_margin_bytes / 1024 / 1024))MB beyond the Node heap; require at least ${minimum_native_margin_mb}MB" >&2
  exit 1
fi

available_bytes=$(( cgroup_max_bytes - cgroup_current_bytes ))
minimum_available_bytes=$(( minimum_available_mb * 1024 * 1024 ))
if (( available_bytes < minimum_available_bytes )); then
  echo "ERROR: $container has only $((available_bytes / 1024 / 1024))MB live cgroup headroom; require at least ${minimum_available_mb}MB" >&2
  exit 1
fi

echo "API memory headroom: PASS (container=${container_bytes}B heap=${heap_mb}MB native_margin=$((native_margin_bytes / 1024 / 1024))MB available=$((available_bytes / 1024 / 1024))MB)"
