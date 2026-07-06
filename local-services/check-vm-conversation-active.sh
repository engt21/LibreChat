#!/usr/bin/env bash
set -euo pipefail

conversation_id="${1:-}"
remote_host="${LIBRECHAT_VM_HOST:-timeng@192.168.50.104}"
api_container="${LIBRECHAT_API_CONTAINER:-LibreChat}"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

[[ "$conversation_id" =~ ^[0-9a-fA-F-]{36}$ ]] ||
  fail "Usage: $0 <conversation-uuid>"

remote_command="timeout -k 1s 8s docker exec -i -e CONVERSATION_ID='$conversation_id' '$api_container' node"

timeout -k 2s 15s ssh \
  -o BatchMode=yes \
  -o ConnectTimeout=8 \
  "$remote_host" \
  "$remote_command" <<'NODE'
require('dotenv').config({ path: '/app/.env' });
const mongoose = require('mongoose');

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 3000 });
  const processStartedAt = new Date(Date.now() - process.uptime() * 1000);
  const active = Boolean(
    await mongoose.connection
      .collection('messages')
      .findOne(
        {
          conversationId: process.env.CONVERSATION_ID,
          unfinished: true,
          updatedAt: { $gte: processStartedAt },
        },
        { projection: { _id: 1 }, maxTimeMS: 1500 },
      ),
  );
  console.log(
    JSON.stringify({ conversationId: process.env.CONVERSATION_ID, active, processStartedAt }),
  );
  await mongoose.disconnect();
})().catch((error) => {
  console.error(JSON.stringify({
    conversationId: process.env.CONVERSATION_ID,
    active: null,
    error: error.message,
  }));
  process.exit(2);
});
NODE
