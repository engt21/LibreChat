#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
STACK_UNIT_FILE="$UNIT_DIR/librechat-stack.service"
KEEPWARM_SERVICE_FILE="$UNIT_DIR/librechat-ollama-keepwarm.service"
KEEPWARM_TIMER_FILE="$UNIT_DIR/librechat-ollama-keepwarm.timer"
DEV_FAILOVER_SERVICE_FILE="$UNIT_DIR/librechat-dev-failover.service"
DEV_FAILOVER_TIMER_FILE="$UNIT_DIR/librechat-dev-failover.timer"

mkdir -p "$UNIT_DIR"

cat > "$STACK_UNIT_FILE" <<EOF
[Unit]
Description=LibreChat local docker stack bootstrap
After=default.target network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$ROOT_DIR
ExecStart=$ROOT_DIR/local-services/start-all.sh stable
ExecStop=$ROOT_DIR/local-services/stop-all.sh stable
TimeoutStartSec=0

[Install]
WantedBy=default.target
EOF

cat > "$KEEPWARM_SERVICE_FILE" <<EOF
[Unit]
Description=Keep the remote Ollama model warm for LibreChat
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$ROOT_DIR
ExecStart=$ROOT_DIR/local-services/keep-ollama-warm.sh
TimeoutStartSec=180
EOF

cat > "$KEEPWARM_TIMER_FILE" <<EOF
[Unit]
Description=Periodically warm the remote Ollama model for LibreChat

[Timer]
OnBootSec=2min
OnUnitActiveSec=30min
RandomizedDelaySec=2min
Persistent=true
Unit=librechat-ollama-keepwarm.service

[Install]
WantedBy=timers.target
EOF

cat > "$DEV_FAILOVER_SERVICE_FILE" <<EOF
[Unit]
Description=LibreChat dev rail failover watchdog
After=librechat-stack.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$ROOT_DIR
ExecStart=$ROOT_DIR/local-services/dev-failover-watchdog.sh
TimeoutStartSec=300
EOF

cat > "$DEV_FAILOVER_TIMER_FILE" <<EOF
[Unit]
Description=Start or stop LibreChat dev rail based on stable health

[Timer]
OnBootSec=3min
OnUnitActiveSec=30s
AccuracySec=5s
Persistent=false
Unit=librechat-dev-failover.service

[Install]
WantedBy=timers.target
EOF

systemctl --user daemon-reload
echo "Installed $STACK_UNIT_FILE"
echo "Installed $KEEPWARM_SERVICE_FILE"
echo "Installed $KEEPWARM_TIMER_FILE"
echo "Installed $DEV_FAILOVER_SERVICE_FILE"
echo "Installed $DEV_FAILOVER_TIMER_FILE"
