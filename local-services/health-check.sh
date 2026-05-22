#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/local-services/rail-env.sh"
resolve_shared_service_paths "$ROOT_DIR"

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BOLD='\033[1m'
NC='\033[0m'

KNOWN_PROJECTS="librechat-stable librechat-dev prometheus-dev grafana-loki-dev touchdown-r1 touchdown-backwards-r1 touchdown-r2 touchdown-backwards-r2"
FIX_MODE=false

usage() {
  cat <<EOF
Usage: $(basename "$0") [--fix] [--help]

Checks for orphaned containers, duplicate services, and memory pressure.

  --fix   Automatically stop and remove orphaned containers.
  --help  Show this help.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --fix) FIX_MODE=true ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; usage; exit 1 ;;
  esac
done

exit_code=0

# --- 1. Orphan detection ---
echo -e "${BOLD}== Orphan container check ==${NC}"

orphans=()
while IFS='|' read -r name project; do
  name="$(echo "$name" | xargs)"
  project="$(echo "$project" | xargs)"
  found=false
  for known in $KNOWN_PROJECTS; do
    if [[ "$project" == "$known" ]]; then
      found=true
      break
    fi
  done
  if ! $found; then
    orphans+=("$name (project: $project)")
  fi
done < <(docker ps --format '{{.Names}}|{{.Label "com.docker.compose.project"}}' 2>/dev/null)

if [[ ${#orphans[@]} -gt 0 ]]; then
  echo -e "${RED}Found ${#orphans[@]} orphaned container(s):${NC}"
  for o in "${orphans[@]}"; do
    echo "  - $o"
  done
  if $FIX_MODE; then
    echo
    for o in "${orphans[@]}"; do
      cname="${o%% (*}"
      echo -e "  Stopping and removing ${YELLOW}$cname${NC} ..."
      docker stop "$cname" >/dev/null 2>&1 || true
      docker rm "$cname" >/dev/null 2>&1 || true
    done
    echo -e "${GREEN}Orphan cleanup complete.${NC}"
  else
    echo -e "${YELLOW}Run with --fix to remove them automatically.${NC}"
    exit_code=1
  fi
else
  echo -e "${GREEN}No orphaned containers found.${NC}"
fi

echo

# --- 2. Duplicate service check ---
echo -e "${BOLD}== Duplicate service check ==${NC}"

critical_images=("meilisearch" "mongo" "pgvector" "clickhouse-server")
for img_pattern in "${critical_images[@]}"; do
  matches=()
  while IFS='|' read -r name image project; do
    name="$(echo "$name" | xargs)"
    image="$(echo "$image" | xargs)"
    project="$(echo "$project" | xargs)"
    matches+=("$name ($project)")
  done < <(docker ps --format '{{.Names}}|{{.Image}}|{{.Label "com.docker.compose.project"}}' 2>/dev/null | grep -i "$img_pattern")

  expected_count=2  # one per rail (stable + dev)
  if [[ "$img_pattern" == "clickhouse-server" ]]; then
    expected_count=2
  fi

  if [[ ${#matches[@]} -gt $expected_count ]]; then
    echo -e "${RED}Too many $img_pattern containers (expected $expected_count, found ${#matches[@]}):${NC}"
    for m in "${matches[@]}"; do
      echo "  - $m"
    done
    exit_code=1
  elif [[ ${#matches[@]} -gt 0 ]]; then
    echo -e "${GREEN}$img_pattern: ${#matches[@]} instance(s) OK${NC}"
  fi
done

echo

# --- 3. Shared data mount check ---
echo -e "${BOLD}== Shared data mount check ==${NC}"

SAFE_SHARED_MOUNTS=".env librechat.yaml langfuse/.env images uploads docker.sock logs clickhouse-memory.xml data/google-service-account.json"

is_safe_shared_mount() {
  local mount_path="$1"
  for pattern in $SAFE_SHARED_MOUNTS; do
    case "$mount_path" in
      */"$pattern"|*/"$pattern"/) return 0 ;;
    esac
  done
  return 1
}

declare -A mount_owners
dup_found=false
while IFS= read -r cid; do
  cname="$(docker inspect "$cid" --format '{{.Name}}' | sed 's|^/||')"
  while IFS= read -r mount; do
    src="$(echo "$mount" | cut -d: -f1)"
    if is_safe_shared_mount "$src"; then
      continue
    fi
    existing="${mount_owners[$src]:-}"
    if [[ -n "$existing" ]]; then
      echo -e "${RED}WARNING: '$src' is mounted by both '$existing' and '$cname'${NC}"
      dup_found=true
      exit_code=1
    else
      mount_owners["$src"]="$cname"
    fi
  done < <(docker inspect "$cid" --format '{{range .Mounts}}{{if eq .Type "bind"}}{{.Source}}:{{.Destination}}{{"\n"}}{{end}}{{end}}' | grep -v '^$')
done < <(docker ps -q 2>/dev/null)

if ! $dup_found; then
  echo -e "${GREEN}No conflicting bind-mount overlaps detected.${NC}"
fi

echo

# --- 4. Memory summary ---
echo -e "${BOLD}== Memory summary ==${NC}"

free_output="$(free -m)"
total_mem="$(echo "$free_output" | awk '/^Mem:/ {print $2}')"
used_mem="$(echo "$free_output" | awk '/^Mem:/ {print $3}')"
avail_mem="$(echo "$free_output" | awk '/^Mem:/ {print $7}')"
swap_total="$(echo "$free_output" | awk '/^Swap:/ {print $2}')"
swap_used="$(echo "$free_output" | awk '/^Swap:/ {print $3}')"

pct_used=$(( used_mem * 100 / total_mem ))
swap_pct=$(( swap_total > 0 ? swap_used * 100 / swap_total : 0 ))

if [[ $pct_used -gt 90 ]]; then
  echo -e "${RED}RAM: ${used_mem}M / ${total_mem}M used (${pct_used}%), ${avail_mem}M available${NC}"
  exit_code=1
elif [[ $pct_used -gt 75 ]]; then
  echo -e "${YELLOW}RAM: ${used_mem}M / ${total_mem}M used (${pct_used}%), ${avail_mem}M available${NC}"
else
  echo -e "${GREEN}RAM: ${used_mem}M / ${total_mem}M used (${pct_used}%), ${avail_mem}M available${NC}"
fi

if [[ $swap_pct -gt 80 ]]; then
  echo -e "${RED}Swap: ${swap_used}M / ${swap_total}M used (${swap_pct}%)${NC}"
  exit_code=1
elif [[ $swap_pct -gt 50 ]]; then
  echo -e "${YELLOW}Swap: ${swap_used}M / ${swap_total}M used (${swap_pct}%)${NC}"
else
  echo -e "${GREEN}Swap: ${swap_used}M / ${swap_total}M used (${swap_pct}%)${NC}"
fi

echo
echo -e "${BOLD}Top 10 containers by memory:${NC}"
docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}" 2>/dev/null \
  | head -1
docker stats --no-stream --format "{{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}" 2>/dev/null \
  | sort -t$'\t' -k2 -h -r | head -10 \
  | column -t -s$'\t'

echo

# --- 5. Langfuse health ---
echo -e "${BOLD}== Langfuse health ==${NC}"

stable_running=false
if docker ps --format '{{.Label "com.docker.compose.project"}}' 2>/dev/null | grep -q '^librechat-stable$'; then
  stable_running=true
fi

if $stable_running; then
  stable_ok=true
  for svc in langfuse-clickhouse-1 langfuse-postgres-1 langfuse-redis-1 langfuse-minio-1 langfuse-web-1 langfuse-worker-1; do
    cname="librechat-stable-${svc}"
    status="$(docker inspect "$cname" --format '{{.State.Status}}' 2>/dev/null || echo "missing")"
    health="$(docker inspect "$cname" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' 2>/dev/null || echo "unknown")"
    restarts="$(docker inspect "$cname" --format '{{.RestartCount}}' 2>/dev/null || echo "?")"

    if [[ "$status" != "running" ]]; then
      echo -e "  ${RED}[stable] $svc: status=$status (restarts=$restarts)${NC}"
      stable_ok=false
    elif [[ "$health" == "unhealthy" ]]; then
      echo -e "  ${RED}[stable] $svc: unhealthy (restarts=$restarts)${NC}"
      stable_ok=false
    elif [[ "$restarts" =~ ^[0-9]+$ ]] && [[ "$restarts" -gt 2 ]]; then
      echo -e "  ${YELLOW}[stable] $svc: running but restart count=$restarts${NC}"
      stable_ok=false
    elif [[ "$health" == "healthy" || "$health" == "no-healthcheck" ]]; then
      echo -e "  ${GREEN}[stable] $svc: $health (restarts=$restarts)${NC}"
    else
      echo -e "  ${YELLOW}[stable] $svc: status=$status health=$health (restarts=$restarts)${NC}"
    fi
  done

  if ! $stable_ok; then
    echo -e "  ${RED}[stable] Shared Langfuse is NOT healthy — traceability evidence cannot be trusted until resolved.${NC}"
    exit_code=1
  else
    echo -e "  ${GREEN}[stable] Shared Langfuse components all healthy.${NC}"
  fi
else
  echo -e "  ${YELLOW}[stable] Shared Langfuse is not running.${NC}"
fi

echo

if docker ps --format '{{.Label "com.docker.compose.project"}}' 2>/dev/null | grep -q '^librechat-dev$'; then
  dev_langfuse="$(docker ps --format '{{.Names}}' 2>/dev/null | grep '^librechat-dev-langfuse-' || true)"
  if [[ -n "$dev_langfuse" ]]; then
    echo -e "  ${RED}[dev] Local Langfuse containers are still running, but dev should reuse stable telemetry:${NC}"
    while IFS= read -r name; do
      [[ -n "$name" ]] && echo "    - $name"
    done <<< "$dev_langfuse"
    exit_code=1
  elif $stable_running; then
    echo -e "  ${GREEN}[dev] Local Langfuse is intentionally disabled; dev reuses stable Langfuse on host port 3000.${NC}"
  else
    echo -e "  ${YELLOW}[dev] Local Langfuse is intentionally disabled, but stable Langfuse is down; dev traces will fail until stable is started.${NC}"
    exit_code=1
  fi
  echo
fi

if [[ $exit_code -eq 0 ]]; then
  echo -e "${GREEN}All checks passed.${NC}"
else
  echo -e "${RED}Some checks failed. Review the output above.${NC}"
fi

exit $exit_code
