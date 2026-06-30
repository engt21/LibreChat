#!/usr/bin/env bash
set -euo pipefail

VM_HOST="${LIBRECHAT_VM_HOST:-timeng@192.168.50.104}"
TAILSCALE_HOSTNAME="${LIBRECHAT_TAILSCALE_HOSTNAME:-librechatvm.tail6e13ff.ts.net}"
TAILSCALE_IP="${LIBRECHAT_TAILSCALE_IP:-100.95.190.45}"

check_script=$(mktemp)
trap 'rm -f "$check_script"' EXIT
cat > "$check_script" <<'CHECKS'
set -euo pipefail

expected_links='{"langfuseUrl":"https://librechatvm.tail6e13ff.ts.net:8444","grafanaUrl":"https://librechatvm.tail6e13ff.ts.net:8445","prometheusUrl":"https://librechatvm.tail6e13ff.ts.net:8446","metricsUrl":"https://librechatvm.tail6e13ff.ts.net:8447"}'

for port in 3000 3001 3100 9080 9091 9092 9115; do
  listener=$(sudo ss -ltnH "sport = :$port" || true)
  if [[ -z "$listener" ]]; then
    echo "Missing VM loopback listener on port $port" >&2
    exit 1
  fi
  local_address=$(awk '{ print $4 }' <<<"$listener")
  if [[ "$local_address" != "127.0.0.1:$port" && "$local_address" != "[::1]:$port" ]]; then
    echo "Observability port $port is not loopback-only: $local_address" >&2
    exit 1
  fi
done

serve_json=$(sudo tailscale serve status --json)
node - "$serve_json" <<'NODE'
const config = JSON.parse(process.argv[2]);
const expected = {
  8443: 'http://127.0.0.1:3080',
  8444: 'http://127.0.0.1:3000',
  8445: 'http://127.0.0.1:3001',
  8446: 'http://127.0.0.1:9092',
  8447: 'http://127.0.0.1:9091',
};
for (const [port, proxy] of Object.entries(expected)) {
  const host = `librechatvm.tail6e13ff.ts.net:${port}`;
  if (config.Web?.[host]?.Handlers?.['/']?.Proxy !== proxy) {
    throw new Error(`Tailscale Serve mismatch for ${host}`);
  }
}
NODE

host=$TAILSCALE_HOSTNAME
ip=$TAILSCALE_IP
curl --resolve "$host:8443:$ip" -fsS "https://$host:8443/api/config" >/dev/null
response=$(curl --resolve "$host:8444:$ip" -fsS "https://$host:8444/api/auth/providers")
grep -Fq "https://$host:8444/api/auth/callback/credentials" <<<"$response"
response=$(curl --resolve "$host:8445:$ip" -fsS "https://$host:8445/api/health")
grep -Fq '"database": "ok"' <<<"$response"
if curl --resolve "$host:8445:$ip" -fsS "https://$host:8445/api/user" >/dev/null 2>&1; then
  echo 'Grafana anonymous user access is enabled' >&2
  exit 1
fi
test -f /opt/librechat_exporter/grafana-loki-stable/grafana/dashboards/loki-log-explorer.json
node -e 'const fs=require("fs");const d=JSON.parse(fs.readFileSync("/opt/librechat_exporter/grafana-loki-stable/grafana/dashboards/loki-log-explorer.json","utf8"));if(d.uid!=="loki-all-logs"||d.panels?.length<4)process.exit(1)'
response=$(curl -fsSG http://127.0.0.1:3100/loki/api/v1/query_range \
  --data-urlencode 'query={job=~".+"}' \
  --data-urlencode 'limit=1' \
  --data-urlencode "start=$(date -d '1 hour ago' +%s%N)" \
  --data-urlencode "end=$(date +%s%N)")
grep -Fq '"status":"success"' <<<"$response"
response=$(curl --resolve "$host:8446:$ip" -fsS "https://$host:8446/-/ready")
grep -Fq 'Ready' <<<"$response"
response=$(curl --resolve "$host:8447:$ip" -fsS "https://$host:8447/metrics")
grep -Fq '# HELP' <<<"$response"

actual_links=$(docker exec -i LibreChat node <<'NODE'
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const doc = await mongoose.connection.collection('appsettings').findOne(
    { settingsId: 'global' },
    { projection: { observability: 1 } },
  );
  process.stdout.write(JSON.stringify(doc?.observability || {}));
  await mongoose.disconnect();
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
NODE
)
EXPECTED_LINKS="$expected_links" ACTUAL_LINKS="$actual_links" node <<'NODE'
const expected = JSON.parse(process.env.EXPECTED_LINKS);
const actual = JSON.parse(process.env.ACTUAL_LINKS);
for (const [key, value] of Object.entries(expected)) {
  if (actual[key] !== value) {
    throw new Error(`LibreChat observability setting mismatch for ${key}`);
  }
}
NODE

echo 'VM observability tailnet access: PASS'
CHECKS

if [[ "${1:-}" == "--local" ]]; then
  TAILSCALE_HOSTNAME="$TAILSCALE_HOSTNAME" TAILSCALE_IP="$TAILSCALE_IP" bash "$check_script"
else
  ssh "$VM_HOST" "TAILSCALE_HOSTNAME='$TAILSCALE_HOSTNAME' TAILSCALE_IP='$TAILSCALE_IP' bash -s" < "$check_script"
fi
