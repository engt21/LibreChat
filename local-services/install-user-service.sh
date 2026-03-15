#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
STACK_UNIT_FILE="$UNIT_DIR/librechat-stack.service"
KEEPWARM_SERVICE_FILE="$UNIT_DIR/librechat-ollama-keepwarm.service"
KEEPWARM_TIMER_FILE="$UNIT_DIR/librechat-ollama-keepwarm.timer"

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
ExecStart=$ROOT_DIR/local-services/start-all.sh
ExecStop=$ROOT_DIR/local-services/stop-all.sh
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

systemctl --user daemon-reload
echo "Installed $STACK_UNIT_FILE"
echo "Installed $KEEPWARM_SERVICE_FILE"
echo "Installed $KEEPWARM_TIMER_FILE"
