# VM Observability Access

LibreChat observability runs entirely on the production VM `timeng@192.168.50.104`. No observability UI or API is exposed through Tailscale Funnel or the public internet. Tailscale Serve terminates HTTPS on the VM and proxies only to loopback-bound service ports.

## Tailnet URLs

| Surface | Tailnet HTTPS URL | VM upstream | Access model |
| --- | --- | --- | --- |
| LibreChat | `https://librechatvm.tail6e13ff.ts.net:8443` | `127.0.0.1:3080` | LibreChat login and MFA |
| Langfuse tracing | `https://librechatvm.tail6e13ff.ts.net:8444` | `127.0.0.1:3000` | Local credentials; existing sessions are revoked on password reset; `NEXTAUTH_URL` uses the HTTPS URL |
| Grafana dashboards and Loki logs | `https://librechatvm.tail6e13ff.ts.net:8445` | `127.0.0.1:3001` | Grafana local login required; anonymous access and public signup are disabled |
| Prometheus query UI | `https://librechatvm.tail6e13ff.ts.net:8446` | `127.0.0.1:9092` | No application auth; protected by tailnet membership |
| LibreChat metrics exporter | `https://librechatvm.tail6e13ff.ts.net:8447` | `127.0.0.1:9091` | No application auth; protected by tailnet membership |
| Langfuse reset inbox | `https://librechatvm.tail6e13ff.ts.net:8448` | `127.0.0.1:8025` | Mailpit basic auth plus tailnet membership; credentials are in the mode-`0600` handoff file |

Grafana is the supported logging UI. The dedicated `Loki Log Explorer — All Logs` dashboard is available at `https://librechatvm.tail6e13ff.ts.net:8445/d/loki-all-logs/loki-log-explorer-e28094-all-logs` and as a separate **Loki Explorer** card in the LibreChat admin console. It provides service, level, filename, source, rail, free-text/regex, time-range, log-volume, and all-log filtering. Loki `3100`, Promtail `9080`, and Blackbox Exporter `9115` remain VM-loopback-only and do not receive separate Tailscale URLs.


## Passwords and MFA

- Grafana anonymous Viewer access is disabled. The `admin` account uses a reset local password, Grafana sessions/tokens were revoked, and signup remains disabled.
- Both existing Langfuse owner accounts use reset local passwords and all Langfuse sessions were revoked. Langfuse sends password-reset messages to a VM-local Mailpit inbox using `SMTP_CONNECTION_URL=smtp://langfuse-mailpit:1025`. Open the protected reset inbox at port `8448`; it is not an Internet email relay. Public Langfuse signup remains disabled with `AUTH_DISABLE_SIGNUP=true`.
- The installed Grafana OSS and Langfuse local-credential implementations do not provide native local first-login TOTP enrollment or a server-side `mustChangePassword` flag. Prometheus and the metrics exporter do not have application accounts.
- Tailscale membership is therefore the enforced MFA and network boundary for every observability URL. Application passwords are an additional layer for Grafana and Langfuse.
- Temporary first-login credentials are stored outside the repository in a local mode-`0600` handoff file. Change each password immediately after signing in and delete the handoff file afterward. Never commit that file.

## VM ownership

- `/opt/LibreChat-custom` and compose project `librechat-stable` own LibreChat, Langfuse, and the metrics exporter.
- `/opt/librechat_exporter/grafana-loki-stable` and compose project `grafana-loki-stable` own Grafana, Loki, and Promtail.
- `/opt/librechat_exporter/prometheus-stable` and compose project `prometheus-stable` own Prometheus and Blackbox Exporter.
- Prometheus uses the persistent `prometheus-stable_data` volume and retains 90 days of data.

All host-published observability ports, including Mailpit `8025`, bind to `127.0.0.1`. Tailscale Serve is the only remote access path. The emergency LAN address must not expose ports `3000`, `3001`, `3100`, `8025`, `9080`, `9091`, `9092`, or `9115`.

## LibreChat admin links

The persisted global application settings contain explicit tailnet HTTPS URLs:

```json
{
  "langfuseUrl": "https://librechatvm.tail6e13ff.ts.net:8444",
  "grafanaUrl": "https://librechatvm.tail6e13ff.ts.net:8445",
  "prometheusUrl": "https://librechatvm.tail6e13ff.ts.net:8446",
  "metricsUrl": "https://librechatvm.tail6e13ff.ts.net:8447"
}
```

`GET /api/admin/observability` returns these same URLs to the Admin Console quick-link cards. These are deliberately stored as explicit HTTPS URLs rather than legacy `localhost` URLs because each service now has a distinct Tailscale HTTPS port.

## Validation

From the source checkout:

```bash
./local-services/verify-vm-observability-access.sh
```

Manual VM checks:

```bash
ssh timeng@192.168.50.104 'sudo tailscale serve status'
ssh timeng@192.168.50.104 'sudo ss -ltnp | grep -E ":(3000|3001|3100|9080|9091|9092|9115) "'
```

## Rollback

The pre-change snapshot is stored on the VM at:

```text
/opt/LibreChat-custom/.rollback/observability-exposure-20260630-222823
```

An earlier Tailscale-only snapshot is also available at:

```text
/opt/LibreChat-custom/.rollback/observability-tailscale-20260630-222703
```

The rollback directories contain the Tailscale Serve configuration, Langfuse environment, Grafana/Loki compose file, Prometheus compose file, and prior LibreChat observability settings. A stopped legacy Prometheus container was retained with a `prometheus-stable-prometheus-vm-rollback-*` name during the managed Compose migration.
