#!/usr/bin/env bash
set -euo pipefail

VM_TARGET="${LIBRECHAT_STABLE_SSH_TARGET:-timeng@192.168.50.104}"
PUBLIC_URL="${LIBRECHAT_PUBLIC_URL:-https://librechatvm.tail6e13ff.ts.net:8443}"

printf '%s\n' '== pve2 services =='
for unit in librechat-host-health-monitor.service librechat-cloud-heartbeat.service librechat-host-heartbeat.service; do
  printf '%-44s active=%-8s enabled=%s\n' "$unit" \
    "$(systemctl --user is-active "$unit" 2>/dev/null || true)" \
    "$(systemctl --user is-enabled "$unit" 2>/dev/null || true)"
done

printf '%s\n' '== pve2 monitor state =='
for key in vm.state app.state vm.failures app.failures vm.last-action app.last-action; do
  file="$HOME/.local/state/librechat-health-monitor/host/$key"
  printf '%-24s %s\n' "$key" "$([[ -s "$file" ]] && cat "$file" || echo n/a)"
done
if [[ -s "$HOME/.local/state/librechat-health-monitor/maintenance" ]]; then
  echo 'maintenance=active'
  cat "$HOME/.local/state/librechat-health-monitor/maintenance"
else
  echo 'maintenance=inactive'
fi

printf '%s\n' '== VM and LibreChat =='
ssh -o BatchMode=yes -o ConnectTimeout=8 "$VM_TARGET" '
  printf "vm_watchdog active=%s enabled=%s\n" \
    "$(systemctl --user is-active librechat-vm-health-monitor.service 2>/dev/null || true)" \
    "$(systemctl --user is-enabled librechat-vm-health-monitor.service 2>/dev/null || true)"
  docker inspect LibreChat --format "container status={{.State.Status}} running={{.State.Running}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} restarts={{.RestartCount}} image={{.Config.Image}} started={{.State.StartedAt}}" 2>/dev/null || true
  printf "loopback_http="
  curl -sS -o /dev/null -w "%{http_code} total=%{time_total}s\n" --max-time 8 http://127.0.0.1:3080/api/config || true
  printf "fallback_container="
  docker inspect LibreChat-deploy-fallback --format "{{.State.Status}}" 2>/dev/null || echo absent
  printf "rollback_pointer="
  test -s "$HOME/.local/state/librechat-health-monitor/last-stable.env" && echo present || echo absent
  if test -s "$HOME/.local/state/librechat-health-monitor/maintenance"; then
    echo "vm_maintenance=active"
    cat "$HOME/.local/state/librechat-health-monitor/maintenance"
  else
    echo "vm_maintenance=inactive"
  fi
  sudo -n tailscale serve status | sed -n "/:8443/,/^[[:space:]]*$/p"
'

printf '%s\n' '== public health =='
printf 'public_http='
curl -sS -o /dev/null -w '%{http_code} total=%{time_total}s\n' --max-time 10 "$PUBLIC_URL/api/config" || true

if command -v az >/dev/null 2>&1; then
  printf '%s\n' '== Azure notification rules =='
  az monitor activity-log alert list -g timeng-librechat-rg \
    --query "[?starts_with(name, 'librechat-')].{name:name,enabled:enabled}" -o table 2>/dev/null || true
  az resource show -g azure-ai-services -n librechat-pve2-cloud-deadman \
    --resource-type Microsoft.Insights/scheduledQueryRules --api-version 2023-12-01 \
    --query '{name:name,enabled:properties.enabled,severity:properties.severity}' -o table 2>/dev/null || true
  az monitor metrics alert show -g azure-ai-services -n librechat-pve2-host-down-pager \
    --query '{name:name,enabled:enabled}' -o table 2>/dev/null || true
fi
