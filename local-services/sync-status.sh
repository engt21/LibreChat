#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/rail-env.sh"

REMOTE_SSH_TARGET="${LIBRECHAT_SYNC_REMOTE_SSH_TARGET:-timeng@192.168.50.4}"
SSH_KEY="${LIBRECHAT_SYNC_SSH_KEY:-$HOME/.ssh/id_rsa}"
CONNECT_TIMEOUT="${LIBRECHAT_SYNC_CONNECT_TIMEOUT:-5}"

resolve_librechat_rail "$ROOT_DIR" dev

echo "=== Local dev rail ==="
if docker compose -p "$COMPOSE_PROJECT_NAME" ps --status running --services 2>/dev/null | grep -q .; then
  echo "status=running"
  COUNTS="$(docker exec "$LIBRECHAT_MONGO_CONTAINER_NAME" mongosh --quiet LibreChat \
    --eval 'JSON.stringify({users:db.users.countDocuments(),conversations:db.conversations.countDocuments(),messages:db.messages.countDocuments(),files:db.files.countDocuments()})' 2>/dev/null || echo '{}')"
  echo "mongo=$COUNTS"
  echo "images=$(find "$ROOT_DIR/images" -type f 2>/dev/null | wc -l)"
  echo "uploads=$(find "$LIBRECHAT_UPLOADS_DIR" -type f 2>/dev/null | wc -l)"
else
  echo "status=stopped"
fi

echo ""
echo "=== Linux source (stable) ==="
if ssh -i "$SSH_KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout="$CONNECT_TIMEOUT" "$REMOTE_SSH_TARGET" "echo ok" >/dev/null 2>&1; then
  echo "reachable=yes"
  REMOTE_RUNNING="$(ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout="$CONNECT_TIMEOUT" "$REMOTE_SSH_TARGET" \
    'docker ps --format "{{.Names}}" | grep -c librechat-stable || echo 0')"
  echo "stable_containers=$REMOTE_RUNNING"
else
  echo "reachable=no"
fi
