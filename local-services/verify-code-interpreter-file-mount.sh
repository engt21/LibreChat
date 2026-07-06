#!/usr/bin/env bash
set -euo pipefail

container="code-interpreter-local"

usage() {
  cat <<'USAGE'
Usage:
  ./local-services/verify-code-interpreter-file-mount.sh [--container NAME]

Uploads a synthetic file through the local Code Interpreter API, executes code
with that file reference, and fails unless the file is visible under /mnt/data.

Options:
  --container NAME   Code Interpreter bridge container (default: code-interpreter-local)
  -h, --help         Show this help
USAGE
}

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --container)
      container="${2:?Missing container after --container}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "Unknown option: $1"
      ;;
  esac
done

command -v docker >/dev/null 2>&1 || fail "docker is required"
if ! docker inspect "$container" >/dev/null 2>&1; then
  resolved_container="$(
    docker ps \
      --filter label=com.docker.compose.service=code-interpreter-local \
      --format '{{.Names}}' | head -1
  )"
  [[ -n "$resolved_container" ]] || fail "Code Interpreter container does not exist: $container"
  container="$resolved_container"
fi

docker exec -i "$container" python - <<'PYTHON'
import json
import os
import urllib.request
import uuid

api_key = os.environ['LOCAL_CODE_INTERPRETER_API_KEY']
base_url = 'http://127.0.0.1:8000/v1'
filename = f'codex-file-mount-{uuid.uuid4().hex}.txt'
boundary = f'----LibreChatBoundary{uuid.uuid4().hex}'
payload = b'code-interpreter-file-mount-ok\n'
body = b''.join(
    [
        f'--{boundary}\r\n'.encode(),
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode(),
        b'Content-Type: text/plain\r\n\r\n',
        payload,
        b'\r\n',
        f'--{boundary}--\r\n'.encode(),
    ]
)

def request(path, *, data=None, content_type='application/json'):
    headers = {'X-API-Key': api_key}
    if data is not None:
        headers['Content-Type'] = content_type
    with urllib.request.urlopen(
        urllib.request.Request(f'{base_url}{path}', data=data, headers=headers, method='POST'),
        timeout=120,
    ) as response:
        return json.load(response)

uploaded = request('/upload', data=body, content_type=f'multipart/form-data; boundary={boundary}')
file_ref = {
    'id': uploaded['files'][0]['fileId'],
    'name': uploaded['files'][0]['filename'],
    'session_id': uploaded['session_id'],
}
executed = request(
    '/exec',
    data=json.dumps(
        {
            'lang': 'py',
            'code': "import os\nprint('\\n'.join(sorted(os.listdir('/mnt/data'))))",
            'files': [file_ref],
        }
    ).encode(),
)
visible_files = executed.get('stdout', '').splitlines()
if filename not in visible_files:
    raise SystemExit(f'{filename} was not visible in /mnt/data: {visible_files}')

print(json.dumps({'status': 'PASS', 'visible_file': filename}))
PYTHON
