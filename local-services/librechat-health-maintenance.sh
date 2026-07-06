#!/usr/bin/env bash
set -euo pipefail

command="${1:-status}"
duration_minutes="${2:-30}"
reason="${3:-planned LibreChat deployment}"
local_file="${LIBRECHAT_HEALTH_MAINTENANCE_FILE:-$HOME/.local/state/librechat-health-monitor/maintenance}"
remote_target="${LIBRECHAT_STABLE_SSH_TARGET:-timeng@192.168.50.104}"
remote_file="${LIBRECHAT_REMOTE_HEALTH_MAINTENANCE_FILE:-/home/timeng/.local/state/librechat-health-monitor/maintenance}"

write_marker() {
  local file="$1" expires="$2" text="$3"
  mkdir -p "$(dirname "$file")"
  printf 'expires=%s\nreason=%s\nstarted=%s\n' "$expires" "$text" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$file"
  chmod 600 "$file"
}

local_vm=false
if [[ "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" == "${LIBRECHAT_STABLE_ROOT:-/opt/LibreChat-custom}" ]] && command -v docker >/dev/null 2>&1 && docker inspect "${LIBRECHAT_STABLE_CONTAINER:-LibreChat}" >/dev/null 2>&1; then
  local_vm=true
fi

write_remote_marker() {
  local expires="$1" text="$2"
  if $local_vm; then
    write_marker "$remote_file" "$expires" "$text"
  else
    ssh -o BatchMode=yes "$remote_target" "mkdir -p \"\$(dirname '$remote_file')\"; printf 'expires=%s\\nreason=%s\\nstarted=%s\\n' '$expires' '$text' '$(date -u +%Y-%m-%dT%H:%M:%SZ)' > '$remote_file'; chmod 600 '$remote_file'"
  fi
}

remove_remote_marker() {
  if $local_vm; then rm -f "$remote_file"; else ssh -o BatchMode=yes "$remote_target" "rm -f '$remote_file'" || true; fi
}

read_remote_marker() {
  if $local_vm; then if test -s "$remote_file"; then cat "$remote_file"; else echo remote=inactive; fi; else ssh -o BatchMode=yes "$remote_target" "if test -s '$remote_file'; then cat '$remote_file'; else echo remote=inactive; fi" || echo "remote=unreachable"; fi
}

case "$command" in
  start)
    [[ "$duration_minutes" =~ ^[0-9]+$ ]] || { echo "Duration must be integer minutes" >&2; exit 2; }
    expires=$(( $(date +%s) + duration_minutes * 60 ))
    write_marker "$local_file" "$expires" "$reason"
    write_remote_marker "$expires" "$reason"
    echo "Health paging and self-healing suppressed for $duration_minutes minutes: $reason"
    ;;
  stop)
    rm -f "$local_file"
    remove_remote_marker
    echo "Health monitoring suppression cleared."
    ;;
  status)
    if [[ -s "$local_file" ]]; then cat "$local_file"; else echo "local=inactive"; fi
    read_remote_marker
    ;;
  *)
    echo "Usage: $0 start [minutes] [reason] | stop | status" >&2
    exit 2
    ;;
esac
