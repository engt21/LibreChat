#!/usr/bin/env bash
set -euo pipefail

container="code-interpreter-local"

usage() {
  cat <<'USAGE'
Usage:
  ./local-services/verify-code-interpreter-package-install.sh [--container NAME]

Creates a synthetic Code Interpreter session, installs PyMuPDF from PyPI, and
fails unless the sandbox can import fitz successfully.

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

with urllib.request.urlopen(f'{base_url}/health', timeout=30) as response:
    health = json.load(response)
if health.get('network_enabled') is not True:
    raise SystemExit(f'Code Interpreter networking is disabled: {health}')

payload = json.dumps(
    {
        'lang': 'py',
        'session_id': f'codex-package-install-{uuid.uuid4().hex}',
        'code': (
            "import subprocess, sys\n"
            "subprocess.run([sys.executable, '-m', 'pip', 'install', "
            "'--disable-pip-version-check', '--no-cache-dir', 'PyMuPDF'], check=True)\n"
            "import fitz\n"
            "print('PYMUPDF_INSTALL_OK', fitz.VersionBind)\n"
        ),
    }
).encode()
request = urllib.request.Request(
    f'{base_url}/exec',
    data=payload,
    headers={'Content-Type': 'application/json', 'X-API-Key': api_key},
    method='POST',
)
with urllib.request.urlopen(request, timeout=180) as response:
    executed = json.load(response)

stdout = executed.get('stdout', '')
if 'PYMUPDF_INSTALL_OK' not in stdout:
    raise SystemExit(f'PyMuPDF installation/import failed: {executed}')

print(json.dumps({'status': 'PASS', 'stdout': stdout.strip()}))
PYTHON