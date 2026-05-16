# Local Code Interpreter Integration

This branch now includes a self-hosted LibreChat Code API compatible bridge at `local-code-interpreter/`.

## What was added

- `code-interpreter-local` service in `docker-compose.local.override.yml`
- FastAPI bridge implementing the LibreChat Code API contract:
  - `POST /v1/upload`
  - `POST /v1/exec`
  - `POST /v1/exec/programmatic`
  - `GET /v1/files/{session_id}`
  - `GET /v1/download/{session_id}/{file_id}`
  - `GET /v1/health`
- `llm-sandbox` backend adapter under `local-code-interpreter/app/adapters/`
- Env-driven routing so native-capable providers can use the local managed interpreter instead of provider-native execution

## Current local runtime behavior

- LibreChat API points to `http://code-interpreter-local:8000/v1`
- Stable rail exposes the bridge on host port `8190`
- Dev rail exposes the bridge on host port `8191`
- Local override defaults these providers to managed/local execution:
  - `OPENAI_CODE_INTERPRETER_ROUTING=librechat`
  - `AZURE_OPENAI_CODE_INTERPRETER_ROUTING=librechat`
  - `GOOGLE_CODE_INTERPRETER_ROUTING=librechat`
- The stable rail persists session workspaces under `./local-code-interpreter/data/`
- The dev rail persists session workspaces under `./.rails/dev/local-code-interpreter/data/`
- Uploaded/generated files survive bridge restarts because session metadata is stored on disk
- The bridge now keeps `llm-sandbox` runtime containers alive per LibreChat `session_id`, so repeat executions in the same conversation reuse a warm runtime instead of paying full container startup cost every time
- The bridge also starts a background Python prewarm on service startup so the first simple Python execution is usually already warm by the time a user reaches the chat UI

## Warm-session performance notes

- Cold container startup was the main reason trivial code such as `print(2+2)` could feel stuck
- After warm-session reuse was added, repeated executions in the same session validate in sub-second time locally
- Expected behavior now:
  - first request shortly after a full bridge restart may still pay some startup cost if prewarm has not finished yet
  - first request after prewarm finishes should be fast
  - subsequent requests in the same LibreChat code session should stay fast because the sandbox is reused
- If you want the warm path immediately after a rebuild/restart, wait a short period after `code-interpreter-local` becomes healthy before testing

## Supported local languages

- Python
- JavaScript
- Java
- C++
- C
- Go
- Ruby
- R
- Bash

## Start or rebuild

From the repo root:

```bash
./local-services/start-all.sh stable
./local-services/start-all.sh dev
```

That rebuilds LibreChat plus the local bridge for the selected rail and recreates that rail's stack.

If you are benchmarking first-request latency right after a restart, give the bridge a brief moment to finish its background prewarm.

## Smoke test the bridge directly

```bash
curl -s http://127.0.0.1:8190/v1/health

curl -s http://127.0.0.1:8191/v1/health

curl -s \
  -H 'X-API-Key: librechat-local-code-dev-key' \
  -H 'Content-Type: application/json' \
  -d '{"lang":"python","code":"print(2 + 2)"}' \
  http://127.0.0.1:8190/v1/exec
```

## Switch back to provider-native code execution

Keep the bridge running, but change any provider you want to route natively:

```env
OPENAI_CODE_INTERPRETER_ROUTING=provider_native
AZURE_OPENAI_CODE_INTERPRETER_ROUTING=provider_native
GOOGLE_CODE_INTERPRETER_ROUTING=provider_native
```

Then restart the stack.

## Switch from the local bridge to another LibreChat-managed backend

Point LibreChat at a different Code API compatible service:

```env
LIBRECHAT_CODE_BASEURL=https://your-other-code-api.example/v1
LIBRECHAT_CODE_API_KEY=your-key
```

The rest of LibreChat's managed-code path stays the same.

## Swap the execution backend inside the local bridge

The bridge is intentionally adapter-based.

- Current adapter: `local-code-interpreter/app/adapters/llm_sandbox.py`
- Base interface: `local-code-interpreter/app/adapters/base.py`

To swap backends:

1. Add a new adapter implementing `SandboxAdapter`
2. Wire it in `local-code-interpreter/app/main.py`
3. Keep the HTTP contract unchanged so LibreChat does not need further app changes

## Important implementation notes

- `LOCAL_CODE_WORKSPACE_HOST_ROOT` must be an absolute host path because the bridge talks to the host Docker daemon through `/var/run/docker.sock`
- The bridge currently returns a structured error for `/v1/exec/programmatic`; standard code execution is the supported path
- Runtime reuse is keyed by LibreChat `session_id` and language so code execution in the same conversation stays warm
- Warm runtime containers are cleaned up automatically after the configured session TTL window
- Runtime limits are configurable with:
  - `LOCAL_CODE_EXECUTION_TIMEOUT_SECONDS`
  - `LOCAL_CODE_ALLOW_NETWORK`
  - `LOCAL_CODE_MEMORY_LIMIT`
  - `LOCAL_CODE_NANO_CPUS`
  - `LOCAL_CODE_PIDS_LIMIT`
