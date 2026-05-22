# Environment

Use this file for worker-facing runtime facts: repo/worktree roles, preserved secrets/data paths, external dependencies, and environment caveats that can change how the mission is executed.

## Worktrees and rail roles

- `/pool/home/timeng/LibreChat-custom` — active mission worktree on branch `engt21/local-customizations`; all migration work and these notes belong here.
- `/pool/home/timeng/LibreChat` — upstream-sync baseline on branch `main`; also the fallback runtime source for symlinked local files.

| Rail | Purpose | URL | Writable state |
| --- | --- | --- | --- |
| `stable` / `r1` | protected production rail and steady-state primary | `http://127.0.0.1:3080` | long-lived worktree paths |
| `dev` / `r2` | explicit validation rail and health-gated fallback | `http://127.0.0.1:3081` | shared stable MongoDB/uploads by default; `.rails/dev/*` for logs, Meilisearch, code-interpreter, and isolated mode |

`stable` owns the authoritative long-lived runtime state and should remain the primary rail. `dev` normally stays stopped to save memory; it is started only for explicit validation/testing or by `librechat-dev-failover.timer` when stable health fails. Default dev mode shares stable MongoDB and `uploads/` so the user can still access data on `:3081` if stable API is down. Use `LIBRECHAT_DEV_USE_STABLE_MONGO=false` for fully isolated dev Mongo/uploads.

### CRITICAL: Mission isolation policy

**All mission runtime validation executes on the dev rail when an app instance is needed.** The stable rail must remain running and serving the user for the entire duration of any mission. No mission step, worker, or automated process may rebuild, restart, stop, reconfigure, or otherwise mutate the stable rail containers (`librechat-stable-*`). Promotion to stable happens only at the very end of the mission after all validation passes and the user explicitly approves the cutover. If a mission encounters problems, only the dev rail is affected -- stable is the untouched fallback. Stop manually-started dev after validation if stable is healthy.

## Runtime secrets and data that must be preserved

- Secrets/config: `.env`, `librechat.yaml`, `langfuse/.env`
- Long-lived runtime data: `data-node/`, `meili_data_v1.35.1/`, `images/`, `uploads/`, `logs/`
- Dev-only validation state: `.rails/dev/` for logs, Meilisearch, code-interpreter, and isolated Mongo/uploads mode
- Local code interpreter state: `local-code-interpreter/data/`

`local-services/ensure-runtime-files.sh` auto-links several of these from `/pool/home/timeng/LibreChat` when missing. Treat them as runtime-only assets and never commit secret values.

## External dependencies and sibling services

- Sibling repo `/pool/home/timeng/rag_api` is required; startup fails fast if it is missing. It builds the three local RAG services (`rag_api`, `rag_api_azure`, `rag_api_google`).
- Sibling repo `/pool/home/timeng/librechat_exporter` provides the Prometheus and Grafana/Loki sidecar compose files.
- This repo's local stack also runs `code-interpreter-local` for the managed local code-execution path.
- Langfuse is part of the local override stack: web, worker, pricing-sync, ClickHouse, Postgres, MinIO, and Redis.
- Main data stores are MongoDB, Meilisearch, and pgvector/vectordb. Stable owns the production DB. Dev uses separate containers/images/ports for runtime services, but defaults to stable MongoDB and shared `uploads/`; the failover profile starts API-only dev (`LIBRECHAT_DEV_PROFILE=failover`) without RAG/vector/code sidecars.
- Dev lifecycle automation: `librechat-dev-failover.timer` runs `local-services/dev-failover-watchdog.sh`, starts dev after repeated stable health failures, and stops failover-owned dev after stable recovers.
- Grafana/Loki also mounts Touchdown logs from `/pool/home/timeng/touchdown/logs` and `/pool/home/timeng/touchdown/logs_backward`.
- Ollama is relevant for Ollama validations: current docs reference a remote Ollama host at `http://192.168.50.201:11434` plus an optional local router at `http://192.168.50.4:8080/v1/`.

## Caveats

- Planning-time host headroom was poor: 4 CPUs, ~29 GiB RAM total, only ~1.2–1.3 GiB available, and swap fully used.
- Dev normally stays stopped while stable is healthy; do not leave full dev running after validation unless the user explicitly requests it.
- Default dev shared-stable mode can mutate production MongoDB/uploads. Use test accounts and avoid destructive seed/reset flows unless isolated mode is enabled.
- Another agent may modify the repo in parallel while this mission runs; workers must re-read target files before editing and avoid overwriting unrelated newer local changes.
- `jq` is not installed on this host; use `python3` (or Node) for JSON filtering in mission scripts.
- Secrets must remain local-only and must never be committed.
- Outside the explicitly safe shared inputs (`.env`, `librechat.yaml`, `langfuse/.env`, `images`, `uploads`, `logs`, `data/google-service-account.json`), overlapping writable bind mounts across rails are a corruption risk.
