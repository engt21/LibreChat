#!/usr/bin/env bash
set -euo pipefail

OLLAMA_API_URL="${OLLAMA_API_URL:-http://192.168.50.201:11434/api/generate}"
OLLAMA_MODEL="${OLLAMA_MODEL:-gptossbigctx:latest}"
OLLAMA_KEEP_ALIVE="${OLLAMA_KEEP_ALIVE:-24h}"
OLLAMA_TIMEOUT_SECONDS="${OLLAMA_TIMEOUT_SECONDS:-180}"

payload="$(OLLAMA_MODEL="$OLLAMA_MODEL" OLLAMA_KEEP_ALIVE="$OLLAMA_KEEP_ALIVE" python3 - <<'PY'
import json
import os

print(json.dumps({
    'model': os.environ['OLLAMA_MODEL'],
    'prompt': '',
    'stream': False,
    'keep_alive': os.environ['OLLAMA_KEEP_ALIVE'],
    'options': {'num_predict': 0},
}))
PY
)"

curl -fsS --max-time "$OLLAMA_TIMEOUT_SECONDS" \
  -H "Content-Type: application/json" \
  -d "$payload" \
  "$OLLAMA_API_URL" >/dev/null

echo "Warmed $OLLAMA_MODEL via $OLLAMA_API_URL with keep_alive=$OLLAMA_KEEP_ALIVE"
