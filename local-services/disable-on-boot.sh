#!/usr/bin/env bash
set -euo pipefail

systemctl --user disable --now librechat-stack.service librechat-ollama-keepwarm.timer
systemctl --user status librechat-stack.service --no-pager || true
systemctl --user status librechat-ollama-keepwarm.timer --no-pager || true
