# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This is a customized fork of [LibreChat](https://librechat.ai) (an open-source AI chat platform) on branch `engt21/local-customizations`. Work from `/pool/home/timeng/LibreChat-custom` (the custom source worktree). Treat `/pool/home/timeng/LibreChat` as upstream-sync only.

## Current deployment host -- VM migration

As of the 2026-06-07 maintenance-window migration, production LibreChat
containers no longer run on this pve2 host. The source code and normal build/test
work still live in `/pool/home/timeng/LibreChat-custom`, but the live deployment
environment is the VM:

| Role | Host | Path / URL | Notes |
| --- | --- | --- | --- |
| Source/edit/build | pve2 | `/pool/home/timeng/LibreChat-custom` | Git checkout; use for code edits, builds, tests, docs |
| Deploy/runtime | `timeng@192.168.50.104` (`librechat`) | `/opt/LibreChat-custom`, `https://librechatvm.tail6e13ff.ts.net:8443` | Tailscale HTTPS; emergency LAN fallback `http://192.168.50.104:3080`; copied runtime bundle, not a Git checkout |

Read-only checks confirmed on 2026-06-08:

- VM compose project: `librechat-stable`
- VM compose files: `/opt/LibreChat-custom/docker-compose.yml` and `/opt/LibreChat-custom/docker-compose.local.override.yml`
- VM API container name: `LibreChat`
- VM app URL: `https://librechatvm.tail6e13ff.ts.net:8443` redirects/renders `/login`; emergency LAN fallback remains `http://192.168.50.104:3080`
- VM `DOMAIN_SERVER`: `https://librechatvm.tail6e13ff.ts.net:8443`
- VM stable stack includes API/UI, MongoDB, Meilisearch, pgvector, `code-interpreter-local`, three provider RAG APIs, Langfuse, and metrics
- VM observability is split across compose projects: `librechat-stable` owns Langfuse and the LibreChat metrics exporter, `grafana-loki-stable` owns Grafana/Loki/Promtail, and `prometheus-stable` owns the app Prometheus/Blackbox stack
- VM admin-console observability links use explicit tailnet HTTPS URLs: Langfuse `https://librechatvm.tail6e13ff.ts.net:8444`, Grafana/Loki `:8445`, Prometheus `:8446`, and the metrics exporter `:8447`. Raw VM ports bind to loopback only; see `OBSERVABILITY_ACCESS.md`.
- Admin quick-link cards should use `/api/admin/observability`, which returns actual browser-clickable URLs for the current request host; the settings edit form should keep raw stored `localhost` values and normalize same-host saves back to `localhost`
- Random Docker names using the `llm-sandbox` image are Code Interpreter child runtimes; they are not compose services
- A direct VM Code Interpreter smoke on 2026-06-08 created a new `llm-sandbox` child, returned `stdout: "7"` from `/v1/exec`, and the synthetic child container was removed afterward
- VM RAG/file-search readiness on 2026-06-08: all three provider RAG containers were healthy, exposed `/embed`, `/embed-upload`, `/query`, and `/query_multiple`, and `vectordb` accepted connections; do not run production vector-ingest smoke tests without approval because they write pgvector data and can call paid embedding APIs
- pve2 may still show `librechat-dev-*` containers for validation/failover, but pve2 is not the production stable Docker host

Routine read-only VM status commands:

```bash
ssh timeng@192.168.50.104 'cd /opt/LibreChat-custom && docker compose -p librechat-stable -f docker-compose.yml -f docker-compose.local.override.yml ps'
ssh timeng@192.168.50.104 'docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"'
curl -I https://librechatvm.tail6e13ff.ts.net:8443/
curl -fsS https://librechatvm.tail6e13ff.ts.net:8443/api/config >/dev/null
ssh timeng@192.168.50.104 'curl -fsS http://127.0.0.1:8190/v1/health >/dev/null'
ssh timeng@192.168.50.104 'curl -fsS http://127.0.0.1:8100/health >/dev/null'
ssh timeng@192.168.50.104 'curl -fsS http://127.0.0.1:8101/health >/dev/null'
ssh timeng@192.168.50.104 'curl -fsS http://127.0.0.1:8102/health >/dev/null'
```

Do not start, stop, restart, rebuild, redeploy, or reconfigure the VM stack
unless the user explicitly authorizes that production maintenance action in the
current task. Do not start a duplicate full stable stack on pve2 while the VM
controls LibreChat Docker services.

## Architecture

NPM workspaces monorepo. **Build order matters** -- packages form a dependency chain:

```
librechat-data-provider  (leaf: types, API client, react-query hooks)
        |
@librechat/data-schemas  (Mongoose schemas, validators, defaults)
        |
@librechat/api           (MCP services, endpoint configs, agent init)
        |
@librechat/client        (shared React component library)
```

Top-level apps consume these packages:
- `api/` -- Express 5 backend (Node 20, MongoDB, Redis). Entry: `api/server/index.js`. Module alias: `~` maps to `api/`.
- `client/` -- React 18 + Vite 7 SPA (Tailwind, Radix UI, TanStack Query). Dev port 3090, proxies to backend.

Turbo orchestrates the build graph (`turbo.json`). Rollup bundles all packages; Vite bundles the client.

**Postinstall patching**: `npm install` triggers `config/apply-runtime-patches.js`, which patches `@librechat/agents` in `node_modules` (e.g., OpenAI reasoning summary handling). These patches are NOT in the Docker build context -- they run during `npm install` inside the container.

## Build commands

```bash
npm run build                    # Full build via Turbo (respects dependency graph)
npm run build:data-provider      # Just data-provider
npm run build:data-schemas       # Just data-schemas (requires data-provider built first)
npm run build:api                # Just packages/api (requires above two)
npm run build:client-package     # Just packages/client
npm run frontend                 # Build all packages + client app (manual sequential)
npm run frontend:dev             # Vite dev server with HMR (client only)
npm run backend:dev              # Nodemon watch mode (api only)
npm run lint                     # ESLint (flat config)
```

After changing types/schemas in `packages/data-provider` or `packages/data-schemas`, rebuild them before running dependent tests or the client.

## Test commands

All workspaces use Jest 30. Backend tests run in `node` env; client tests run in `jsdom`.

```bash
# Full workspace test suites
npm run test:api                        # api/ tests (30s timeout)
npm run test:client                     # client/ tests (jsdom)
npm run test:packages:api               # packages/api tests (15s timeout)
npm run test:packages:data-provider     # packages/data-provider tests
npm run test:packages:data-schemas      # packages/data-schemas tests
npm run test:all                        # All of the above, sequentially

# Run a single test file (use --testPathPatterns from the workspace root)
cd api && npx jest --testPathPatterns=server/controllers/ModelController.spec.js
cd client && npx jest --testPathPatterns=utils/endpoints.spec.ts
cd packages/api && npx jest --testPathPatterns=endpoints/models.spec.ts
cd packages/data-provider && npx jest --testPathPatterns=google.spec.ts

# Run tests matching a name
cd api && npx jest -t "should filter models"

# Integration tests inside Docker (needed for some MCP tests due to Alpine mongodb-memory-server limitation)
docker exec -w /app <container> npm --prefix /app/packages/api run test:ci -- --runInBand --testPathPatterns=<pattern>
```

E2E tests use Playwright: `npm run e2e` (requires running app instance).

## Runtime -- rail policy after VM migration

The production `stable` rail is now on the VM. pve2 remains the source/build host
and can still be used for local tests or a `dev` rail when an app instance is
needed for validation. Always keep the VM `stable` rail untouched during normal
agent work.

| Rail | Purpose | Host | URL / port | Docker project |
|------|---------|------|------------|----------------|
| `stable` | Production | VM `192.168.50.104` | `https://librechatvm.tail6e13ff.ts.net:8443` (LAN fallback `http://192.168.50.104:3080`) | `librechat-stable` |
| `dev` | Validation / failover | pve2 unless deliberately moved | `http://127.0.0.1:3081` | `librechat-dev` |

```bash
# pve2 source/dev only. Do not use this for VM stable maintenance.
./local-services/start-all.sh dev       # Manual full dev for explicit testing; stop it when done
LIBRECHAT_DEV_PROFILE=failover ./local-services/start-all.sh dev --no-build --skip-health-check  # API-only fallback
./local-services/status-all.sh all      # Health check both rails
./local-services/stop-all.sh dev        # Stop dev rail
./local-services/dev-failover-watchdog.sh # Health-gated dev failover controller
```

`stable` is the steady-state production rail on the VM and owns the full stack,
including shared Langfuse + metrics. `dev` normally stays stopped and is started
only for explicit testing or by `librechat-dev-failover.timer` after stable
health fails. In default shared-stable mode, dev may connect to production data;
use existing test accounts for dev testing and avoid destructive data resets.
The failover profile is intentionally API-only and resource-limited.

### CRITICAL: Deploying code-only changes -- backend and frontend are different

**Full image rebuilds (`start-all.sh`, `docker compose build`) take 10+ minutes and are almost never needed for code-only fixes.** For small backend/runtime edits, classify with `local-services/deploy-runtime-delta.sh --dry-run` first and prefer that helper when it accepts the paths. Only rebuild the image when Dockerfile, dependencies (`package.json` / `package-lock.json`), base images, or compose/container-shape changes require a new image or recreation. The existing local helper scripts target the Docker host where they are run; they do not automatically promote pve2 artifacts to the VM unless an explicit remote deployment workflow is used.

**Backend/runtime-loaded source only** (`api/**/*.js`, runtime config/templates, runtime patch scripts, or package `dist` output after a successful host build) should use the guarded runtime-delta helper instead of ad hoc `docker cp`:

```bash
# Classify a change without mutating anything.
./local-services/deploy-runtime-delta.sh dev --dry-run -- api/path/to/file.js

# Fast-apply to dev: snapshot old container files, copy, restart, health-check.
./local-services/deploy-runtime-delta.sh dev -- api/path/to/file.js

# VM stable is production maintenance and requires explicit approval in the task.
LIBRECHAT_STABLE_RUNTIME_DELTA_APPROVAL=YES \
  ./local-services/deploy-runtime-delta.sh stable --approve-stable -- api/path/to/file.js
```

`local-services/deploy-runtime-delta.sh` refuses unsafe direct-copy surfaces: `client/src/**` and individual `client/dist/**` files must use the frontend dist workflow below; `packages/*/src/**` changes must be built on the host and deployed as `packages/*/dist/**`; `package.json`, `package-lock.json`, `Dockerfile`, and compose-file changes require the normal cached image/recreate path. For the VM production rail, copying into `LibreChat` or restarting any VM container is production maintenance and requires explicit user approval in the current task.

**Frontend source is never deployed by copying `client/src/**/*.ts(x)` into a running container.** Browsers execute the compiled `client/dist` tree, so a source copy plus restart does nothing for users and encourages unsafe generated-bundle edits.

For any frontend change under `client/src/**`, use this enforced workflow:

```bash
# Produce a complete dist tree plus its integrity manifest on the host.
./local-services/run-node-capped.sh --memory-max 8G --heap-mb 4096 -- npm run build:client

# Deploy the complete manifest-verified dist tree to dev.
./local-services/deploy-built-client-dist.sh dev

# Stable/VM production is permitted only after explicit approval for that promotion.
# Confirm the command is being run on the intended Docker host; pve2-local
# stable promotion helpers do not automatically mutate the VM.
LIBRECHAT_STABLE_CLIENT_APPROVAL=YES ./local-services/deploy-built-client-dist.sh stable --approve-stable
```

`local-services/deploy-built-client-dist.sh` strictly rejects missing/stale/tampered build manifests and cache-busted asset URLs, snapshots the prior deployed `client/dist`, stages and swaps the entire built tree, restarts the API process to clear cached `index.html`, verifies HTTP entry assets, and automatically restores the rollback tree on health failure.

**Mandatory OpenAI reasoning preservation gate:** `local-services/verify-openai-reasoning-preservation.sh` protects the OpenAI/Azure `max_tool_calls` termination bound and both live/persisted reasoning separator layers. Never remove, bypass, or weaken this checker or its stable hooks during merges, hot promotion, dependency patch refreshes, or production recovery. Run `npm run verify:openai-reasoning-preservation` before relevant deployment work. After an explicitly approved VM stable change, verify the deployed runtime on the VM with `ssh timeng@192.168.50.104 'cd /opt/LibreChat-custom && ./local-services/verify-openai-reasoning-preservation.sh --container LibreChat'`. Older pve2/local examples may use `--container librechat-stable-api`; the current VM stable API container is `LibreChat`.

**Forbidden frontend deployment operations:** never edit or copy individual files in `client/dist/assets/`, never manually alter hashed bundle code, never manually rewrite `client/dist/index.html` asset references or cache-busting query strings, and never alter `client/dist/sw.js` to deploy a source fix. A frontend fix is deployable only as an intact successful build through `deploy-built-client-dist.sh`.

**When a full image rebuild IS required:** changes to `Dockerfile`, `package.json`, `package-lock.json`, new npm dependencies, base image updates, or compose changes that require container recreation. `config/apply-runtime-patches.js` can be fast-applied with `deploy-runtime-delta.sh`, which copies the script, runs it inside the API container, restarts, and verifies; still schedule a later cached image refresh so the runtime patch is baked into the next image.

Runtime secret/data files (`.env`, `librechat.yaml`, `langfuse/.env`, `data-node/`, `images/`, `uploads/`, `logs/`) are symlinked from the upstream worktree by `local-services/ensure-runtime-files.sh` -- they are NOT checked in.

## CRITICAL: Mission safety -- dev-rail-only policy

**All agent missions (upstream merges, version bumps, feature migrations, validation harnesses) MUST validate app/runtime behavior away from VM stable when a running instance is needed.** The stable/production rail on the VM (`https://librechatvm.tail6e13ff.ts.net:8443`; LAN fallback `http://192.168.50.104:3080`) must remain running and untouched so the user can continue using it normally while the mission executes. Dev is not an always-on second production stack: start it only for explicit validation/testing or failover, and stop it after validation when stable is healthy.

### Hard rules for missions

1. **Never rebuild, restart, stop, or reconfigure the stable rail** during any mission step. The stable containers must stay up and serving live traffic throughout.
2. **Never run `./local-services/start-all.sh stable` on pve2** as part of a mission, because production stable is on the VM. Only `./local-services/start-all.sh dev` is permitted during mission work unless the user explicitly authorizes VM maintenance.
3. **Never direct Docker commands with mutations at VM stable containers** (`LibreChat`, `chat-mongodb`, `chat-meilisearch`, `code-interpreter-local`, `rag-api-*`, `librechat-stable-*`, etc.) during mission work.
4. **All code changes, builds, tests, and runtime validation happen in the source worktree or dev rail only.** Dev has its own compose project, image tags, ports, logs, Meilisearch, and code-interpreter state, but may share production MongoDB/uploads by default; use test accounts and avoid destructive shared-data actions.
5. **Promotion to stable happens ONLY at the very end of the mission**, after ALL of the following are confirmed:
   - All validation contract checks pass on dev
   - All tests (lint, build, unit, integration) pass on dev
   - Manual smoke tests on dev confirm expected behavior
   - The user has been informed and has given explicit approval to promote
6. **The VM cutover sequence** is production maintenance. Do not improvise it; after approval, use the current VM deployment runbook or a task-specific plan that names the exact remote commands before running them.
7. **If something goes wrong during the mission**, the dev rail is the only thing that gets fixed or restarted. VM stable remains untouched as the fallback.
8. **After dev validation**, stop dev with `./local-services/stop-all.sh dev` if stable is healthy and the user did not ask to keep dev running. Automatic failover is owned by `librechat-dev-failover.timer`, which starts API-only dev when stable health fails and stops failover-owned dev when stable recovers.

### Why this matters

The user depends on the VM stable rail for daily use. A mission that accidentally disrupts stable leaves the user without a working instance. The dev rail exists for explicit testing and health-gated fallback access; it should not consume resources as an always-on parallel stack while stable is healthy.

## Mandatory read order before coding

1. This file (`CLAUDE.md` / `AGENTS.md` -- they are symlinked)
2. `CUSTOMIZATION_MASTER_DOC.md` -- canonical inventory of all customizations (MUST be updated when adding/changing features)
3. `CUSTOMIZATION_MASTER_GUIDE.md` -- condensed merge-preservation guide
4. The focused doc for the feature area you're touching (e.g., `REALTIME_VOICE.md`, `SCHEDULED_RUNS.md`, `OPENAI_GEMINI_NATIVE_TOOLS.md`, `XAI_CUSTOM_ENDPOINTS.md`, `OLLAMA_WEB_SEARCH.md`, `LOCAL_RAG_INTEGRATION.md`)
5. Only then inspect the impacted code paths

Identify the impacted workspace first (`api`, `packages/api`, `packages/data-provider`, `packages/data-schemas`, `client`, `config`, `local-services`). Read the matching section in `CUSTOMIZATION_MASTER_DOC.md` before changing code. Verify current behavior in code before trusting older prose.

## Critical: preserving local customizations

This branch carries 15 customization themes on top of upstream. The highest-risk files during merges are listed in `CUSTOMIZATION_MASTER_GUIDE.md` under "Highest-risk files during future merges". Key areas: admin/RBAC, scheduled runs, model access restrictions, native tools, MCP/OAuth, Google/xAI/Ollama discovery, audio transcription, Google auth modes.

**Never accidentally revert custom branch behavior to upstream defaults.** When merging upstream, follow the checklist in `CUSTOMIZATION_MASTER_GUIDE.md`. For `package-lock.json` conflicts: `npm install --package-lock-only --ignore-scripts`.

## Documentation is part of done

After completing work:
- Update `CUSTOMIZATION_MASTER_DOC.md` for any customization changes
- Update focused docs when their feature behavior changes
- Capture durable pitfalls and postmortems in `CUSTOMIZATION_MASTER_DOC.md`
- Update `LOCAL_UPSTREAM_SYNC_WORKFLOW.local.md` if merge workflow changes

## Completion gate

A task is not complete until:
1. Relevant docs and code were reviewed to understand the affected surface
2. The change works on a non-production validation target (`dev` or focused local tests) when runtime validation is needed
3. Relevant tests, lint, and build checks pass
4. Docs and lessons learned are updated
5. For OpenAI Responses/reasoning/web-search/client Thoughts changes, `npm run verify:openai-reasoning-preservation` passes and the mandatory verifier hooks remain intact
6. Only then is VM `stable` eligible to be refreshed -- and ONLY with explicit user approval

Live-rail promotion is separate from git pushes, which require explicit human approval. **No mission, worker, or automated process may promote to stable without the user explicitly confirming the promotion.** Stable must remain running and usable for the user throughout any mission lifecycle.
