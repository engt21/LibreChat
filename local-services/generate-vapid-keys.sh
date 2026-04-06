#!/usr/bin/env bash
# Generate VAPID keys for browser push notifications and append to .env
# Usage: ./local-services/generate-vapid-keys.sh [--dry-run]
#
# This script generates a VAPID key pair using the web-push npm module
# and appends WEB_PUSH_VAPID_PUBLIC_KEY and WEB_PUSH_VAPID_PRIVATE_KEY
# to the project .env file if they are not already set.
#
# After running, restart the dev API to pick up the new keys:
#   docker restart librechat-dev-api

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env"
DRY_RUN=false

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

# Check if web-push is available
if ! node -e "require('web-push')" 2>/dev/null; then
  echo "ERROR: web-push npm module not found. Run 'npm install' first." >&2
  exit 1
fi

# Check if .env exists
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: .env file not found at $ENV_FILE" >&2
  exit 1
fi

# Check if VAPID keys already exist
if grep -q '^WEB_PUSH_VAPID_PUBLIC_KEY=.\+' "$ENV_FILE" 2>/dev/null; then
  echo "VAPID keys already configured in .env — skipping generation."
  echo "  To regenerate, remove the existing WEB_PUSH_VAPID_* lines from .env first."
  exit 0
fi

# Generate keys
KEYS=$(node -e "
const webpush = require('web-push');
const keys = webpush.generateVAPIDKeys();
console.log('WEB_PUSH_VAPID_PUBLIC_KEY=' + keys.publicKey);
console.log('WEB_PUSH_VAPID_PRIVATE_KEY=' + keys.privateKey);
")

PUBLIC_KEY=$(echo "$KEYS" | grep PUBLIC | cut -d= -f2)
PRIVATE_KEY=$(echo "$KEYS" | grep PRIVATE | cut -d= -f2)

if [[ -z "$PUBLIC_KEY" || -z "$PRIVATE_KEY" ]]; then
  echo "ERROR: Failed to generate VAPID keys" >&2
  exit 1
fi

if $DRY_RUN; then
  echo "[dry-run] Would append to $ENV_FILE:"
  echo ""
  echo "$KEYS"
  echo ""
  echo "Run without --dry-run to apply."
else
  # Ensure trailing newline before appending
  [[ -s "$ENV_FILE" && "$(tail -c1 "$ENV_FILE" | wc -l)" -eq 0 ]] && echo "" >> "$ENV_FILE"

  echo "" >> "$ENV_FILE"
  echo "# Browser push notification VAPID keys (generated $(date -Iseconds))" >> "$ENV_FILE"
  echo "$KEYS" >> "$ENV_FILE"

  echo "✓ VAPID keys appended to .env"
  echo "  Public key length: ${#PUBLIC_KEY}"
  echo "  Private key length: ${#PRIVATE_KEY}"
  echo ""
  echo "Next steps:"
  echo "  1. Restart dev API: docker restart librechat-dev-api"
  echo "  2. Verify: curl -s -H 'Authorization: Bearer <token>' http://127.0.0.1:3081/api/schedules/notifications"
  echo "     → capabilities.push should be true"
fi
