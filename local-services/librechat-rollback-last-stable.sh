#!/usr/bin/env bash
set -euo pipefail

pointer="${LIBRECHAT_LAST_STABLE_POINTER:-$HOME/.local/state/librechat-health-monitor/last-stable.env}"
maintenance_file="${LIBRECHAT_HEALTH_MAINTENANCE_FILE:-$HOME/.local/state/librechat-health-monitor/maintenance}"
health_url="${LIBRECHAT_ROLLBACK_HEALTH_URL:-http://127.0.0.1:3080/api/config}"
health_timeout="${LIBRECHAT_ROLLBACK_HEALTH_TIMEOUT:-120}"

[[ -s "$pointer" ]] || { echo "No last-stable rollback pointer exists." >&2; exit 1; }
get_value() { sed -n "s/^$1=//p" "$pointer" | head -1; }
type="$(get_value type)"
snapshot="$(get_value snapshot)"
container="$(get_value container)"
root="$(get_value root)"
[[ -n "$type" && -n "$snapshot" && -n "$container" ]] || { echo "Invalid rollback pointer: $pointer" >&2; exit 1; }
[[ -d "$snapshot" ]] || { echo "Rollback snapshot is missing: $snapshot" >&2; exit 1; }

mkdir -p "$(dirname "$maintenance_file")"
printf 'expires=%s\nreason=%s\nstarted=%s\n' "$(( $(date +%s) + 1800 ))" \
  "automatic last-stable rollback" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$maintenance_file"
chmod 600 "$maintenance_file"
trap 'rm -f "$maintenance_file"' EXIT

restore_runtime() {
  local path parent
  while IFS= read -r path; do
    [[ -n "$path" ]] || continue
    parent="$(dirname "$path")"
    mkdir -p "$root/$parent"
    if [[ -e "$snapshot/host/$path" ]]; then cp -a "$snapshot/host/$path" "$root/$path"; else rm -rf "$root/$path"; fi
  done < "$snapshot/host-files.txt"

  while IFS= read -r path; do
    [[ -n "$path" ]] || continue
    parent="$(dirname "$path")"
    docker exec "$container" mkdir -p "/app/$parent"
    if [[ -e "$snapshot/container/$path" ]]; then
      docker cp "$snapshot/container/$path" "$container:/app/$path"
    else
      docker exec "$container" rm -rf "/app/$path"
    fi
  done < "$snapshot/container-files.txt"

  while IFS= read -r path; do
    [[ -n "$path" ]] || continue
    parent="$(dirname "$path")"
    docker exec "$container" sh -lc "rm -rf '/app/$path'; mkdir -p '/app/$parent'"
    if [[ -e "$snapshot/container/$path" ]]; then docker cp "$snapshot/container/$path" "$container:/app/$parent/"; fi
  done < "$snapshot/container-dirs.txt"

  if grep -Fxq 'config/apply-runtime-patches.js' "$snapshot/container-files.txt" 2>/dev/null; then
    docker exec "$container" node /app/config/apply-runtime-patches.js
  fi
}

restore_client() {
  local stage="/app/client.dist.last-stable-$$"
  docker exec "$container" sh -lc "rm -rf '$stage'; mkdir -p '$stage'"
  docker cp "$snapshot/client-dist/." "$container:$stage/"
  docker exec "$container" sh -lc "rm -rf /app/client.dist.failed-rollback; mv /app/client/dist /app/client.dist.failed-rollback; mv '$stage' /app/client/dist"
}

case "$type" in
  runtime) restore_runtime ;;
  client) restore_client ;;
  *) echo "Unsupported rollback type: $type" >&2; exit 1 ;;
esac

"$root/local-services/verify-auth-memory-runtime-contracts.sh" --container "$container"
"$root/local-services/verify-api-runtime-contract.sh" --container "$container"
"$root/local-services/verify-api-memory-headroom.sh" --container "$container" --minimum-available-mb 0

docker restart "$container" >/dev/null
for ((elapsed=0; elapsed<=health_timeout; elapsed+=5)); do
  if curl -fsS --max-time 8 "$health_url" >/dev/null 2>&1; then
    "$root/local-services/verify-auth-memory-runtime-contracts.sh" --container "$container"
    "$root/local-services/verify-api-runtime-contract.sh" --container "$container"
    "$root/local-services/verify-api-memory-headroom.sh" --container "$container"
    printf 'rollback=success type=%s snapshot=%s time=%s\n' "$type" "$snapshot" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    rm -f "$maintenance_file"
    trap - EXIT
    exit 0
  fi
  sleep 5
done

echo "Rollback restored files but health did not recover: $health_url" >&2
exit 1
