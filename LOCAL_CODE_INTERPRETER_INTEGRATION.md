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
- Production stable now runs on the VM `timeng@192.168.50.104`; the stable bridge exposes host port `8190` on that VM loopback
- Dev rail exposes the bridge on host port `8191`
- Local override defaults these providers to managed/local execution:
  - `OPENAI_CODE_INTERPRETER_ROUTING=librechat`
  - `AZURE_OPENAI_CODE_INTERPRETER_ROUTING=librechat`
  - `GOOGLE_CODE_INTERPRETER_ROUTING=librechat`
- The VM stable rail persists session workspaces under `/opt/LibreChat-custom/local-code-interpreter/data/`
- The dev rail persists session workspaces under `./.rails/dev/local-code-interpreter/data/`
- Uploaded/generated files survive bridge restarts because session metadata is stored on disk
- Files uploaded through the chat-bar `Upload for Code Interpreter` action or drag/drop Code Interpreter destination are treated as raw code-interpreter inputs: MIME allowlists are bypassed only for `tool_resource=execute_code`, then the file is stored locally and made available inside the sandbox under `/mnt/data/<filename>`
- The Code Interpreter upload destination is shown for ephemeral chats whenever Code Interpreter is supported, even before the toggle is already enabled. This prevents audio files such as `.wav` from being forced into "Upload as Text"; users can choose transcription or Code Interpreter explicitly.
- Upload completion must keep the original `tool_resource` and file metadata in compose state. The transcription bar filters those markers out, so `.wav`/`.m4a` files uploaded for Code Interpreter stay raw attachments when the user sends the message unless they explicitly chose a transcription upload path.
- The bridge now keeps `llm-sandbox` runtime containers alive per LibreChat `session_id`, so repeat executions in the same conversation reuse a warm runtime instead of paying full container startup cost every time
- The bridge also starts a background Python prewarm on service startup so the first simple Python execution is usually already warm by the time a user reaches the chat UI
- Child sandboxes have outbound networking enabled by default so generated code can install missing packages at runtime with tools such as `pip`. Set `LOCAL_CODE_ALLOW_NETWORK=false` to restore fully offline execution.
- Docker containers with random generated names and the `llm-sandbox` image are expected warm-session child runtimes, not compose-managed services
- VM dynamic startup was verified on 2026-06-08 with a direct
  `code-interpreter-local` `/v1/exec` smoke: a unique Python session created a
  new `llm-sandbox` child container, returned `stdout: "7"`, and the synthetic
  child was removed afterward

## Warm-session performance notes

- Cold container startup was the main reason trivial code such as `print(2+2)` could feel stuck
- After warm-session reuse was added, repeated executions in the same session validate in sub-second time locally
- Expected behavior now:
  - first request shortly after a full bridge restart may still pay some startup cost if prewarm has not finished yet
  - first request after prewarm finishes should be fast
  - subsequent requests in the same LibreChat code session should stay fast because the sandbox is reused
- If you want the warm path immediately after a rebuild/restart, wait a short period after `code-interpreter-local` becomes healthy before testing

## One-hour sandbox lifetime

- `LOCAL_CODE_SESSION_TTL_HOURS` defaults to `1` and is clamped to a minimum of one hour.
- The bridge janitor checks on `LOCAL_CODE_CLEANUP_INTERVAL_SECONDS` (default 60 seconds, minimum 10),
  skips active runtime container IDs, and removes expired LibreChat-managed children.
- Cleanup recognizes both newly labeled children and legacy `llm-sandbox` containers whose workspace
  mount belongs to the configured LibreChat workspace root.
- Bridge shutdown closes all tracked children immediately; TTL cleanup is the crash/orphan backstop,
  not a reason to leave children running indefinitely.
- Keep child memory, CPU, and PID limits enabled. Warm reuse improves latency but must not become an
  unbounded production resource pool.

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

## Start, fast-deploy, or rebuild

From the repo root for local/dev validation:

```bash
./local-services/start-all.sh dev
```

That starts or rebuilds LibreChat plus the local bridge for the selected dev rail
when a full stack is needed. For small LibreChat backend/config/runtime-loaded
changes, prefer `./local-services/deploy-runtime-delta.sh dev --dry-run -- <paths>`
and then `./local-services/deploy-runtime-delta.sh dev -- <paths>` if accepted.
Do not rebuild or restart VM stable unless the user explicitly approves
production maintenance in the current task.

If you are benchmarking first-request latency right after a restart, give the bridge a brief moment to finish its background prewarm.

## Smoke test the bridge directly

```bash
ssh timeng@192.168.50.104 'curl -s http://127.0.0.1:8190/v1/health'

curl -s http://127.0.0.1:8191/v1/health

curl -s \
  -H 'X-API-Key: librechat-local-code-dev-key' \
  -H 'Content-Type: application/json' \
  -d '{"lang":"python","code":"print(2 + 2)"}' \
  http://127.0.0.1:8191/v1/exec
```

The VM stable bridge health endpoint is `/v1/health`; plain `/health` and `/`
return 404.

To verify dynamic child-container startup on the VM without redeploying or
restarting services, compare the sandbox container list before and after a
unique-session `/v1/exec` request through `code-interpreter-local`, then remove
only the synthetic child container created by that smoke. Do not remove existing
warm-session children; they may belong to active conversations.

## Switch back to provider-native code execution

Keep the bridge running, but change any provider you want to route natively:

```env
OPENAI_CODE_INTERPRETER_ROUTING=provider_native
AZURE_OPENAI_CODE_INTERPRETER_ROUTING=provider_native
GOOGLE_CODE_INTERPRETER_ROUTING=provider_native
```

Then use `local-services/deploy-runtime-delta.sh` for a small `.env`/runtime
config update when it accepts the paths, or restart the dev stack if the change
requires container recreation.

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

## 2026-07-01 upload-routing incident

Conversation `ce34b36e-025e-4b07-baf8-ee6ac489f11a` exposed a client-side race when the same PDF was reselected through **Upload for Code Interpreter**. Production evidence showed the bridge was healthy and running on the VM, but the turn generated no `/v1/upload` request and no file record with execute-code metadata. The message instead referenced the existing normal attachment (`source=local`, `context=message_attachment`).

Initial root cause: `AttachFileMenu` updated `toolResource` with React state and opened the native file picker in the same click handler. The file input `change` callback could run before the state update committed and therefore received the previous upload route. The fix writes the destination to a synchronous ref before opening the picker and reads that ref when dispatching `handleFileChange`. `AttachFileMenu.spec.tsx` pins the first Code Interpreter selection.

Follow-up evidence after deployment showed a deeper backend gap: the PDF remained attached to the user message, Code Interpreter executed, but `/mnt/data` contained only the generated Python script. `getUserCodeFiles` required an attachment to already have `metadata.fileIdentifier` or native execute-code metadata, while the JIT staging layer is responsible for creating that identifier. The fix now retrieves all non-generated files referenced by the active message branch, transiently categorizes those files as `execute_code` resources for the request, and lets `primeFiles` upload them to `code-interpreter-local` on the VM and persist the resulting identifier. This preserves branch isolation and does not permanently reclassify the original message attachment.

The final live smoke exposed an independent VM mount-path defect: the bridge successfully stored the PDF under `/opt/LibreChat-custom/local-code-interpreter/data/workspaces`, but its `LOCAL_CODE_WORKSPACE_HOST_ROOT` still pointed to the old pve2 path `/workspace/local-code-interpreter/data/workspaces`. Because the bridge creates child containers through the VM Docker socket, the child mounted that nonexistent host path and saw only the generated script. Production now sets the VM-absolute workspace path, Compose fails closed when the variable is missing, and `local-services/verify-code-interpreter-file-mount.sh` proves an uploaded file is visible inside `/mnt/data`.

## Important implementation notes

- Agent Builder offers both provider-native Code Interpreter controls when the selected provider/model supports them and the separate structured tool ID `local_code_interpreter` for provider-agnostic self-hosted execution.
- `local_code_interpreter` reuses LibreChat's file/session priming adapter while keeping a custom tool ID and the self-hosted bridge. Agent uploads pass `agent_tool=local_code_interpreter` while retaining the shared `execute_code` resource bucket, preserving agent-scoped uploads, warm sessions, and generated-file handling without silently enabling provider-native execution. `code_interpreter_math` remains the specialized math-oriented tool.

- `LOCAL_CODE_WORKSPACE_HOST_ROOT` must be an absolute host path because the bridge talks to the host Docker daemon through `/var/run/docker.sock`
- On VM stable it must resolve to `/opt/LibreChat-custom/local-code-interpreter/data/workspaces`; a container-internal path or the former pve2 `/workspace/...` path silently mounts the wrong directory into `llm-sandbox` children.
- After any Code Interpreter container or workspace-path change, run `./local-services/verify-code-interpreter-file-mount.sh --container code-interpreter-local`; bridge health and simple `print()` execution do not prove uploaded files are mounted.
- After changing sandbox networking, run `./local-services/verify-code-interpreter-package-install.sh --container code-interpreter-local`; it verifies the health endpoint reports networking enabled, installs `PyMuPDF` inside a synthetic sandbox, and imports `fitz`.
- The bridge currently returns a structured error for `/v1/exec/programmatic`; standard code execution is the supported path
- Runtime reuse is keyed by LibreChat `session_id` and language so code execution in the same conversation stays warm
- Keep `tool_resource` form metadata before the file part in LibreChat uploads; Multer's early filter depends on seeing `tool_resource=execute_code` before accepting arbitrary MIME types
- Keep the local file-picker destination in a synchronous ref in `AttachFileMenu.tsx`. The menu click opens the native picker immediately, so a React-state-only handoff can leave the subsequent `change` event with the previous destination and upload a requested Code Interpreter file as an ordinary attachment.
- Keep branch-scoped ordinary attachments eligible for lazy staging. `getUserCodeFiles` must exclude code-generated outputs but must not require a pre-existing `fileIdentifier`; `initializeAgent` transiently marks the active branch files for `execute_code`, and `primeFiles` performs the actual upload and metadata persistence.
- Keep image originals separate from vision derivatives. Image file records store the normalized provider-facing copy in `filepath` and the exact uploaded object in `metadata.originalFilepath`; `primeFiles` must prefer `originalFilepath` so a later tool call receives the original bytes and filename in `/mnt/data`.
- Never run an unbounded production `mongosh` query to decide whether a conversation is active. Use `./local-services/check-vm-conversation-active.sh <conversation-uuid>`; it avoids collection-wide sorting, ignores unfinished markers older than the current API process, enforces Mongo `maxTimeMS`, and wraps the remote shell and in-container client in hard timeouts so an interrupted terminal cannot leave orphan queries consuming production resources.
- Production execution is VM-local: `LibreChat` calls `code-interpreter-local` over `librechat-stable_default`, and that bridge creates `llm-sandbox` children through the VM's `/var/run/docker.sock`. The pve2 source/build host must not run production sandbox children.
- Warm runtime containers are cleaned up automatically after the configured one-hour-default session
  TTL window; active children are excluded and orphaned children are reclaimed by the background
  janitor
- VM production depends on the parent service retaining `/var/run/docker.sock`,
  the sandbox image `ghcr.io/vndee/sandbox-python-311-bullseye`, and the bind
  mount `/opt/LibreChat-custom/local-code-interpreter/data`
- Runtime limits are configurable with:
  - `LOCAL_CODE_EXECUTION_TIMEOUT_SECONDS`
  - `LOCAL_CODE_ALLOW_NETWORK`
  - `LOCAL_CODE_MEMORY_LIMIT`
  - `LOCAL_CODE_NANO_CPUS`
  - `LOCAL_CODE_PIDS_LIMIT`

Enabling `LOCAL_CODE_ALLOW_NETWORK` permits code running inside the hardened child container to make outbound connections. The existing memory, CPU, PID, capability-drop, and `no-new-privileges` restrictions still apply, but operators should disable networking when running untrusted workloads that do not need package installation.

## July 6, 2026 orphan cleanup refinement

The one-hour janitor uses each workspace session's metadata `updated_at` as its preferred activity
anchor. Missing, malformed, or future timestamps fall back to the Docker container creation time.
Active runtime IDs are captured and cleanup runs while holding the adapter session lock so a runtime
cannot become active between eligibility selection and deletion. Docker listing/removal failures are
logged per operation and do not stop cleanup of other eligible children.

After refreshing the production bridge image, validate both the parent health endpoint and the real
child behavior:

```bash
./local-services/verify-code-interpreter-file-mount.sh --container code-interpreter-local
./local-services/verify-code-interpreter-package-install.sh --container code-interpreter-local
```
