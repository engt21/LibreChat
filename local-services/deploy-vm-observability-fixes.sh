#!/usr/bin/env bash
set -euo pipefail

VM_ROOT=${VM_ROOT:-/opt/LibreChat-custom}
EXPORTER_ROOT=${EXPORTER_ROOT:-/opt/librechat_exporter}
GRAFANA_ROOT="$EXPORTER_ROOT/grafana-loki-stable"
STAMP=$(date +%Y%m%d-%H%M%S)
ROLLBACK="$VM_ROOT/.rollback/observability-fixes-$STAMP"
MAILPIT_IMAGE=${MAILPIT_IMAGE:-axllent/mailpit:v1.30.0}
MAILPIT_SECRET_FILE=${MAILPIT_SECRET_FILE:-$VM_ROOT/.secrets/mailpit.env}

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo 'Run this script as root on the LibreChat VM.' >&2
  exit 1
fi
if [[ ! -s "$MAILPIT_SECRET_FILE" ]]; then
  echo "Missing Mailpit credential file: $MAILPIT_SECRET_FILE" >&2
  exit 1
fi

mkdir -p "$ROLLBACK"
install -m 600 "$VM_ROOT/langfuse/.env" "$ROLLBACK/langfuse.env"
cp -a "$GRAFANA_ROOT/grafana/dashboards" "$ROLLBACK/grafana-dashboards"
BASE_DASHBOARD_SNAPSHOT=${BASE_DASHBOARD_SNAPSHOT:-$VM_ROOT/.rollback/observability-fixes-20260630-233417/grafana-dashboards}
if [[ -d "$BASE_DASHBOARD_SNAPSHOT" ]]; then
  cp -a "$BASE_DASHBOARD_SNAPSHOT"/. "$GRAFANA_ROOT/grafana/dashboards"/
fi
chmod 600 "$MAILPIT_SECRET_FILE"

python3 - "$VM_ROOT/.env" "$VM_ROOT/langfuse/.env" <<'PYMAIL'
import pathlib
import sys

source_path = pathlib.Path(sys.argv[1])
env_path = pathlib.Path(sys.argv[2])
source_lines = source_path.read_text().splitlines()
lines = env_path.read_text().splitlines()
values = {}
for line in source_lines + lines:
    if not line or line.lstrip().startswith('#') or '=' not in line:
        continue
    key, value = line.split('=', 1)
    values[key] = value.strip().strip('"').strip("'")

updates = {
    'SMTP_CONNECTION_URL': 'smtp://langfuse-mailpit:1025',
    'EMAIL_FROM_ADDRESS': values.get('EMAIL_FROM', '') or 'langfuse@librechat.local',
    'AUTH_DISABLE_SIGNUP': 'true',
}
seen = set()
output = []
for line in lines:
    if '=' in line and not line.lstrip().startswith('#'):
        key = line.split('=', 1)[0]
        if key in updates:
            output.append(f'{key}={updates[key]}')
            seen.add(key)
            continue
    output.append(line)
for key, value in updates.items():
    if key not in seen:
        output.append(f'{key}={value}')
env_path.write_text('\n'.join(output) + '\n')
PYMAIL
chmod 600 "$VM_ROOT/langfuse/.env"

docker pull "$MAILPIT_IMAGE" >/dev/null
if docker container inspect langfuse-mailpit >/dev/null 2>&1; then
  docker rm -f langfuse-mailpit >/dev/null
fi
docker volume create langfuse_mailpit_data >/dev/null
docker run -d \
  --name langfuse-mailpit \
  --restart unless-stopped \
  --network librechat-stable_default \
  --env-file "$MAILPIT_SECRET_FILE" \
  -e MP_DATABASE=/data/mailpit.db \
  -e MP_MAX_MESSAGES=100 \
  -p 127.0.0.1:8025:8025 \
  -v langfuse_mailpit_data:/data \
  "$MAILPIT_IMAGE" >/dev/null
sudo tailscale serve --yes --bg --https=8448 http://127.0.0.1:8025

python3 - "$GRAFANA_ROOT/grafana/dashboards" <<'PYDASH'
import json
import pathlib
import re
import sys

dashboard_dir = pathlib.Path(sys.argv[1])
window_pattern = re.compile(
    r'(librechat_(?:usage_(?:cost_window_usd|tokens_window_total)|messages_window_total|error_messages_window_total))'
    r'\{window="\$(?:usage_window|window)"([^}]*)\}'
)

def range_metric(match):
    metric, labels = match.groups()
    buckets = (
        ('5m', '${__range_s} <= bool 300'),
        ('1h', '(${__range_s} > bool 300) * (${__range_s} <= bool 3600)'),
        ('6h', '(${__range_s} > bool 3600) * (${__range_s} <= bool 21600)'),
        ('24h', '(${__range_s} > bool 21600) * (${__range_s} <= bool 86400)'),
        ('7d', '(${__range_s} > bool 86400) * (${__range_s} <= bool 604800)'),
        ('30d', '(${__range_s} > bool 604800) * (${__range_s} <= bool 2592000)'),
        ('lifetime', '${__range_s} > bool 2592000'),
    )
    bucket_queries = ' or '.join(
        f'(({metric}{{window="{window}"{labels}}}) * ({mask}))'
        for window, mask in buckets
    )
    return f'max without (window) ({bucket_queries})'

def selected_user_query():
    buckets = (
        ('librechat_active_users', '${__range_s} <= bool 300'),
        ('librechat_daily_unique_users', '(${__range_s} > bool 300) * (${__range_s} <= bool 86400)'),
        ('librechat_weekly_unique_users', '(${__range_s} > bool 86400) * (${__range_s} <= bool 604800)'),
        ('librechat_monthly_unique_users', '(${__range_s} > bool 604800) * (${__range_s} <= bool 2592000)'),
        ('librechat_registered_users_total', '${__range_s} > bool 2592000'),
    )
    return ' + '.join(f'(({metric}) * ({mask}))' for metric, mask in buckets)

for path in dashboard_dir.glob('librechat-*.json'):
    dashboard = json.loads(path.read_text())
    variables = dashboard.get('templating', {}).get('list', [])
    dashboard.setdefault('templating', {})['list'] = [
        variable for variable in variables if variable.get('name') not in {'usage_window', 'window'}
    ]
    for panel in dashboard.get('panels', []):
        title = panel.get('title', '')
        title = title.replace('($usage_window)', '(selected range)')
        title = title.replace('($window)', '(selected range)')
        title = title.replace('LibreChat active users', 'Unique users (selected range)')
        if title == 'Active users':
            title = 'Unique users (selected range)'
        panel['title'] = title
        for target in panel.get('targets', []) or []:
            expression = target.get('expr')
            if not expression:
                continue
            if expression == 'librechat_active_users':
                target['expr'] = selected_user_query()
            else:
                target['expr'] = window_pattern.sub(range_metric, expression)
    for panel in dashboard.get('panels', []):
        for target in panel.get('targets', []) or []:
            expression = target.get('expr')
            if not expression:
                continue
            expression = expression.replace('scalar(${__range_s} <= bool 300)', '(${__range_s} <= bool 300)')
            expression = expression.replace('scalar(${__range_s} > bool 2592000)', '(${__range_s} > bool 2592000)')
            for lower, upper in ((300, 3600), (300, 86400), (3600, 21600), (21600, 86400), (86400, 604800), (604800, 2592000)):
                expression = expression.replace(
                    f'scalar((${{__range_s}} > bool {lower}) * (${{__range_s}} <= bool {upper}))',
                    f'((${{__range_s}} > bool {lower}) * (${{__range_s}} <= bool {upper}))',
                )
            target['expr'] = expression
    path.write_text(json.dumps(dashboard, indent=2, ensure_ascii=False) + '\n')
PYDASH

if grep -R '"name": "usage_window"\|"name": "window"\|\$usage_window\|window="\$window"' \
  "$GRAFANA_ROOT/grafana/dashboards"/librechat-*.json; then
  echo 'A redundant dashboard usage-window selector remains after migration.' >&2
  exit 1
fi

cd "$VM_ROOT"
docker compose -p librechat-stable -f docker-compose.yml -f docker-compose.local.override.yml \
  up -d --no-deps --force-recreate langfuse-web langfuse-worker
cd "$GRAFANA_ROOT"
docker compose -p grafana-loki-stable -f docker-compose.yml restart grafana

echo "Observability fixes deployed. Rollback snapshot: $ROLLBACK"
