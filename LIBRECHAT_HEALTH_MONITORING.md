# LibreChat Production Health, Recovery, Deployment Continuity, and Alerting

## Scope and current status

LibreChat production remains entirely on local infrastructure:

- Hypervisor/source host: `pve2`, LAN `192.168.50.4`.
- Production VM: Proxmox VM `112`, SSH `timeng@192.168.50.104`.
- Production container: `LibreChat`.
- Public tailnet URL: `https://librechatvm.tail6e13ff.ts.net:8443`.
- Emergency VM LAN URL: `http://192.168.50.104:3080`.

Azure hosts no LibreChat workload. It is used only as an outbound email/SMS notification relay and, after validation, as an independent detector for a complete pve2 outage.

Current activation state after installation:

| Component                                                 | State                                     | Purpose                                                                       |
| --------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------- |
| `librechat-host-health-monitor.service` on pve2           | Active/enabled                            | Checks VM SSH and externally visible LibreChat HTTP; can recover VM 112       |
| `librechat-vm-health-monitor.service` on VM               | Active/enabled                            | Checks the `LibreChat` container and loopback HTTP; can restart and roll back |
| Azure categorized app/VM Activity Log rules               | Active                                    | Email/SMS for down, healed, and heal-failed events                            |
| ntfy private topic                                        | Active                                    | Immediate detailed mobile/web push from both watchdogs                        |
| `librechat-cloud-heartbeat.service` on pve2               | Active/enabled                            | Sends an outbound pve2 heartbeat every 60 seconds                             |
| `librechat-pve2-cloud-deadman` scheduled-query rule       | **Disabled pending final validation**     | Detects absence of pve2 heartbeat and auto-resolves when it returns           |
| Old Funnel web-test rule `librechat-pve2-host-down-pager` | Disabled/retired                          | Invalid because public Azure probes cannot resolve tailnet-only DNS           |
| Deployment fallback on VM loopback `3082`                 | Installed and standalone lifecycle tested | Serves exact last-known-good LibreChat during approved stable deployment      |
| Automatic last-stable rollback                            | Installed; no current rollback pointer    | Pointer is created only by the next successful approved stable deployment     |

Never represent a disabled or pending-validation component as active protection.

## Fast status

Run:

```bash
./local-services/librechat-health-status.sh
```

Direct logs:

```bash
journalctl --user -u librechat-host-health-monitor.service -f
journalctl --user -u librechat-cloud-heartbeat.service -f
ssh timeng@192.168.50.104 'journalctl --user -u librechat-vm-health-monitor.service -f'
```

## Monitoring layers

### 1. pve2 external watchdog

`librechat-host-health-monitor.service` runs every 30 seconds and checks:

1. TCP/SSH reachability to `192.168.50.104:22`.
2. LibreChat HTTP at `http://192.168.50.104:3080/api/config`.
3. VM-side queued diagnostic/healed events, which it relays to Azure email/SMS.

Default alert thresholds:

- Outage: three consecutive failures, approximately 90 seconds.
- Recovery: two consecutive successes.
- Reminder: 30 minutes while still down.

VM recovery ladder when SSH is unavailable:

1. Capture Proxmox VM state, ping/TCP/HTTP results, pve2 memory, and timestamps.
2. After eight failed checks, request `sudo qm reboot 112 --timeout 90`.
3. Wait up to four minutes for SSH and LibreChat HTTP.
4. If graceful reboot fails, permit a hard `sudo qm reset 112` after two more minutes and cooldown checks.
5. A one-hour recovery cooldown prevents reboot loops.
6. Send `VM HEALED` or `VM HEAL FAILED` as distinct email/SMS events.

A hard reset is deliberately delayed. It is not used for a normal application-only outage.

### 2. In-VM application watchdog

`librechat-vm-health-monitor.service` runs every 30 seconds and checks:

- `docker inspect LibreChat` running/status/exit/OOM/restart state.
- `http://127.0.0.1:3080/api/config` response and HTTP status.

Before repair it captures:

- Container status, exit code, OOM flag, restart count, start/finish time, and error.
- Loopback HTTP code and connection/total timing.
- Last 40 Docker log lines.
- VM RAM/swap.
- Root and Docker filesystem usage.
- UTC incident timestamp and diagnostic file path.

Application recovery ladder:

1. Declare outage after three failed checks.
2. Save diagnostics before mutation.
3. Restart only the `LibreChat` container.
4. Wait up to 120 seconds for loopback HTTP recovery.
5. If restart fails and a deployment-created last-stable snapshot is at most two hours old, restore that exact snapshot.
6. Restart and verify again.
7. Emit `APP HEALED` with outage duration and the successful action, or `APP HEAL FAILED` with diagnostics and actions attempted.

The watchdog never resets credentials, sessions, MFA, MongoDB, Meilisearch, uploads, or other production services.

### 3. pve2 complete-host dead-man

A full pve2 outage removes local alert generation and Proxmox recovery. The replacement design uses outbound telemetry:

- `librechat-cloud-heartbeat.service` sends a custom Application Insights event every 60 seconds.
- No inbound pve2 port, public DNS record, or public HTTP endpoint is required.
- The disabled `librechat-pve2-cloud-deadman` rule queries the previous ten minutes.
- When enabled after validation, zero heartbeats fires `PVE2 HOST HEARTBEAT MISSING`.
- Azure automatically resolves it after heartbeats return for five minutes; that resolved message is the `PVE2 HOST HEALED` email/SMS.

The original Tailscale Funnel availability test was invalid: Azure public probes cannot resolve `pve2.tail6e13ff.ts.net`, which is tailnet-only DNS. Its metric alert is disabled and must not be re-enabled.

## Alert taxonomy

Azure Activity Log rules are intentionally category-specific so SMS subjects identify the incident:

- `librechat-vm-down-pager`
- `librechat-vm-healed-pager`
- `librechat-vm-heal-failed-pager`
- `librechat-app-down-pager`
- `librechat-app-healed-pager`
- `librechat-app-heal-failed-pager`

The `librechat-pager` action group sends:

- Email to `timothy.eng@outlook.com`.
- Native SMS to the configured US mobile number.

AT&T retired `txt.att.net` and `mms.att.net` email-to-text on June 17, 2025. Carrier email gateways are not used.

### Email content

The dynamic Azure alert description supports approximately 3.5 KB and includes as much of this packet as fits:

- Failure category and source watchdog.
- Detection time and consecutive failure count.
- VM reachability or container state.
- HTTP URL, status, and timing.
- Exit code, OOM flag, restart count, and start time.
- Memory, swap, and disk state.
- Recent Docker logs.
- Diagnostic file path.
- Planned or attempted recovery action.
- Rollback eligibility and pointer path.
- Operator commands.

The SMS is shorter because Azure controls native SMS formatting. The category-specific rule name communicates `APP DOWN`, `APP HEALED`, `VM DOWN`, `VM HEALED`, or `HEAL FAILED`.

Detailed ntfy messages are also sent immediately to the private random topic stored in mode-`0600` environment files.

## Planned maintenance suppression

Watchdogs must not fight an approved deployment.

The maintenance marker is:

```text
~/.local/state/librechat-health-monitor/maintenance
```

It contains an expiry epoch, reason, and UTC start time. Expired markers remove themselves.

Create or clear markers on pve2 and the VM together:

```bash
./local-services/librechat-health-maintenance.sh start 60 "planned reason"
./local-services/librechat-health-maintenance.sh status
./local-services/librechat-health-maintenance.sh stop
```

While active:

- Failure counters reset.
- App/VM outage paging is suppressed.
- Container restart, VM reboot/reset, and rollback are suppressed.
- The outbound pve2 host heartbeat remains active because a LibreChat deployment should not take down pve2.

The guarded stable deployment helpers create and clear maintenance automatically.

## Deployment continuity rail

`local-services/librechat-deployment-fallback.sh` provides a tiny standby API during approved stable deployment.

The fallback is not a stale pve2 dev rail. It runs on the production VM and reuses the VM’s existing MongoDB, Meilisearch, uploads, images, config, and Docker network.

Start sequence:

1. Create maintenance markers.
2. Snapshot the exact healthy running container as `librechat-local:last-known-good` and record its immutable image ID. This preserves verified runtime-delta files that may not exist in the original base image.
3. Start `LibreChat-deploy-fallback` on VM loopback port `3082`.
4. Disable scheduled jobs in the fallback with `SCHEDULED_RUNNER_ENABLED=false`.
5. Verify `http://127.0.0.1:3082/api/config`.
6. Change only Tailscale Serve `:8443` from `127.0.0.1:3080` to `127.0.0.1:3082`.
7. Verify the public HTTPS `/api/config` endpoint.
8. Only then may the main stable container be changed or restarted.

Finish sequence:

1. Verify stable loopback `3080`.
2. Switch `:8443` back to `127.0.0.1:3080`.
3. Verify public HTTPS.
4. Remove the fallback container.
5. Clear maintenance markers.

If deployment fails, `abort` keeps public traffic on the last-known-good fallback only for a bounded window while rollback and diagnosis proceed. Unless `finish` is called first, the helper now schedules automatic cleanup after the abort TTL, restores direct `:8443 -> 3080` routing, removes the fallback container, and clears its marker so the standby cannot remain pinned indefinitely.

Commands:

```bash
./local-services/librechat-deployment-fallback.sh start
./local-services/librechat-deployment-fallback.sh status
./local-services/librechat-deployment-fallback.sh finish
./local-services/librechat-deployment-fallback.sh abort
```

Standalone start/switch/finish was validated with public `200` responses. Automatic integration is present in the stable runtime-delta and client-dist helpers but must be exercised only during the next explicitly approved production deployment.

## Last-stable rollback

A rollback is valid only when it restores the exact pre-deployment state that was serving successfully.

### Runtime delta

Before stable runtime files are replaced, `deploy-runtime-delta.sh` records:

- Host files changed.
- Container files changed.
- Container directories changed.
- Missing-before-deploy files.
- Container name, VM root, timestamp, and snapshot directory.

It writes the pointer:

```text
~/.local/state/librechat-health-monitor/last-stable.env
```

### Frontend deployment

Before a full client dist swap, `deploy-built-client-dist.sh` stores the complete previous `client/dist` tree and records it as last stable. Individual hashed assets are never restored separately.

### Automatic use

`librechat-rollback-last-stable.sh`:

1. Requires a valid pointer and snapshot directory.
2. Creates a maintenance marker.
3. Restores only the recorded pre-deployment paths or full client tree.
4. Reapplies runtime patches when required.
5. Restarts `LibreChat`.
6. Requires loopback HTTP recovery.
7. Leaves diagnostics and reports failure if health does not recover.

The pointer created during the emergency ChatReferences repair was deliberately invalidated because its pre-repair snapshot was known bad. There is currently no automatic rollback target. The next successful approved stable deployment creates a new valid pointer.

## Deployment helper integration

Stable production mutation requires explicit user approval and the existing approval environment variables.

Runtime delta:

```bash
LIBRECHAT_STABLE_RUNTIME_DELTA_APPROVAL=YES \
  ./local-services/deploy-runtime-delta.sh stable --approve-stable -- path/to/runtime-file
```

Frontend:

```bash
LIBRECHAT_STABLE_CLIENT_APPROVAL=YES \
  ./local-services/deploy-built-client-dist.sh stable --approve-stable
```

For stable operations these helpers now:

1. Start the verified fallback and switch public traffic.
2. Create/retain last-stable rollback material.
3. Apply the approved deployment.
4. Run health and mandatory contract checks.
5. Switch public traffic back only after stable is healthy.
6. Keep fallback serving if an error aborts the deployment.

## Files and ownership

Repository files:

- `local-services/librechat-health-monitor.sh`
- `local-services/librechat-health-maintenance.sh`
- `local-services/librechat-health-status.sh`
- `local-services/librechat-deployment-fallback.sh`
- `local-services/librechat-rollback-last-stable.sh`
- `local-services/librechat-cloud-heartbeat.py`
- `local-services/librechat-host-heartbeat.py` (retired Funnel prototype; do not use for Azure probing)
- `local-services/systemd/librechat-host-health-monitor.service`
- `local-services/systemd/librechat-vm-health-monitor.service`

Installed pve2 files:

- `~/.local/libexec/librechat-health-monitor`
- `~/.local/libexec/librechat-cloud-heartbeat`
- `~/.config/librechat-health-monitor/host.env` (`0600`)
- `~/.config/librechat-cloud-heartbeat/heartbeat.env` (`0600`)
- `~/.config/systemd/user/librechat-host-health-monitor.service`
- `~/.config/systemd/user/librechat-cloud-heartbeat.service`

Installed VM files:

- `~/.local/libexec/librechat-health-monitor`
- `~/.local/libexec/librechat-rollback-last-stable`
- `~/.config/librechat-health-monitor/vm.env` (`0600`)
- `~/.config/systemd/user/librechat-vm-health-monitor.service`

Never print or commit ntfy topic URLs, Application Insights ingestion values, tokens, or environment-file contents.

## Safe validation policy

Never stop production or intentionally break the real health endpoint to test alerts.

Allowed after confirming no active conversation/generation:

- Temporary monitor process with an isolated state directory and invalid synthetic URL/container.
- Temporary categorized Azure signal clearly labeled `TEST ONLY`.
- Fallback start/switch/finish while stable remains healthy and no active conversation exists.
- Read-only rollback metadata validation.

Requires explicit production approval and a safe idle window:

- Restarting `LibreChat`.
- VM reboot/reset.
- Executing rollback.
- Stable deployment helper integration test.
- Enabling and outage-testing the pve2 cloud dead-man.

## Known incident and lessons

During initial setup, a runtime delta restart exposed that the old container had previously been launched with `sleep infinity` plus an out-of-band API process and was missing `ChatReferences` on disk. A normal restart therefore could not restore service. The runtime module and restart-safe image were repaired, and the current container now uses `npm run backend` directly.

### July 6, 2026 resource-starvation incident

The July 6 outage chain was caused by production resource starvation. An unmanaged detached
benchmark and lower-priority observability/storage work competed with LibreChat and MongoDB. Langfuse
web/worker load, ClickHouse, and MinIO were important pressure multipliers. MongoDB then produced
server-monitor/selection timeouts, which interrupted refresh/session reads and surfaced as an
authentication failure.

The durable response is production-first resource isolation, not credential reset: pause unhealthy
benchmarks, cap auxiliary services, preserve API/Mongo CPU and I/O priority, verify heap headroom, and
return retryable `503` responses for transient authentication-store failures. The complete RCA and
customization preservation set are in `PRODUCTION_INCIDENT_2026-07-06.md`.

Durable rules:

- Never assume `docker restart` is restorative; verify the configured container command and a real restart-safe image.
- Create deployment fallback from the healthy running container, not merely its original base-image tag, because verified runtime deltas may exist only in the container filesystem. Record and verify the resulting immutable image ID.
- Never allow an emergency-repair pre-snapshot to become an automatic rollback target when the pre-state is known broken.
- Never use tailnet-only DNS for public Azure availability probes.
- Never treat maintenance downtime as an outage or allow self-healing to fight deployment.
- Never switch public routing until fallback/stable loopback health passes first.
- Never stop production for ordinary code work. Stable may restart only inside guarded redeployment after active conversations are idle.
- Verify the API image/container uses the canonical `docker-entrypoint.sh` plus `npm run backend`; reject builder-derived `sleep infinity` commands.
- Preserve the complete deployed `client/dist` during backend-only changes and use a fresh manifest-verified full client build for frontend promotion.
- Treat heap pressure as a recoverable condition: enforce memory/headroom checks, retain restart policy and rollback material, and keep fallback serving during the restart.
- Never allow a benchmark to run directly on the VM outside
  `run-benchmark-production-priority.sh`; the supervisor must pause the complete benchmark unit as
  soon as LibreChat or MongoDB loses its healthy streak.
- Never treat a mutable image tag alone as rollback proof. `librechat-local:runtime-current` is created only
  after a verified runtime delta, while the fallback marker records the immutable image ID produced from
  the exact healthy predeployment container. Invalidate known-bad rollback pointers.
- Keep Langfuse, ClickHouse, MinIO, and metrics in lower-priority bounded resource classes so tracing
  cannot starve the production API or MongoDB.
