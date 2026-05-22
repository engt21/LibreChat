#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"$ROOT_DIR/local-services/install-user-service.sh"
systemctl --user enable --now librechat-stack.service librechat-ollama-keepwarm.timer librechat-dev-failover.timer
systemctl --user start librechat-ollama-keepwarm.service

if loginctl enable-linger "$USER" 2>/dev/null; then
  echo "Enabled linger for $USER"
else
  echo "Warning: could not enable linger for $USER automatically."
  echo "Run this as root if you want this user service to run after reboot before login:"
  echo "  sudo loginctl enable-linger $USER"
fi

systemctl --user status librechat-stack.service --no-pager || true
systemctl --user status librechat-ollama-keepwarm.timer --no-pager || true
systemctl --user status librechat-dev-failover.timer --no-pager || true
