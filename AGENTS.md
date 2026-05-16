# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This is a customized fork of [LibreChat](https://librechat.ai) (an open-source AI chat platform) on branch `engt21/local-customizations`. Work from `/pool/home/timeng/LibreChat-custom` (the custom worktree). Treat `/pool/home/timeng/LibreChat` as upstream-sync only.

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

## Local runtime -- rail policy

Two deployment rails share this codebase. Always validate on dev first.

| Rail | Purpose | Host port | Image tag | Docker project |
|------|---------|-----------|-----------|----------------|
| `stable` (r1) | Production | 3080 | `librechat-local-stable:latest` | `librechat-stable` |
| `dev` (r2) | Validation | 3081 | `librechat-local-dev:latest` | `librechat-dev` |

```bash
./local-services/start-all.sh dev       # Build + start dev rail
./local-services/start-all.sh stable    # Build + start production rail
./local-services/status-all.sh all      # Health check both rails
./local-services/stop-all.sh dev        # Stop dev rail
```

Both rails include: LibreChat API, MongoDB, Meilisearch, PostgreSQL+pgvector (`vectordb`), 3 RAG API instances (OpenAI/Azure/Google embeddings), and the local code interpreter. The `stable` rail additionally owns the shared Langfuse + metrics stack. The `dev` rail reuses that shared traceability backend via host ports instead of starting its own Langfuse/metrics containers.

### CRITICAL: Deploying code-only changes -- never rebuild unnecessarily

**Full image rebuilds (`start-all.sh`, `docker compose build`) take 10+ minutes and are almost never needed for code-only fixes.** Only rebuild when Dockerfile, dependencies (package.json/package-lock.json), or base images change.

For code-only changes (JS/TS source files under `api/`, `packages/`, `client/`, etc.), use `docker cp` + `docker restart`:

```bash
# Push a single changed file into the running container
docker cp /pool/home/timeng/LibreChat-custom/api/path/to/file.js librechat-dev-api:/app/api/path/to/file.js

# Restart to pick up changes (seconds, not minutes)
docker restart librechat-dev-api

# For stable promotion after dev validation:
docker cp /pool/home/timeng/LibreChat-custom/api/path/to/file.js librechat-stable-api:/app/api/path/to/file.js
docker restart librechat-stable-api
```

**When to use `docker cp` + `restart`:** any change to `.js`, `.ts`, `.cjs`, `.mjs` source files, config files, templates.

**When a full rebuild IS required:** changes to `Dockerfile`, `package.json`, `package-lock.json`, `config/apply-runtime-patches.js`, new npm dependencies, base image updates.

Runtime secret/data files (`.env`, `librechat.yaml`, `langfuse/.env`, `data-node/`, `images/`, `uploads/`, `logs/`) are symlinked from the upstream worktree by `local-services/ensure-runtime-files.sh` -- they are NOT checked in.

## CRITICAL: Mission safety -- dev-rail-only policy

**All agent missions (upstream merges, version bumps, feature migrations, validation harnesses) MUST operate exclusively on the dev rail (r2, port 3081) for the entire duration of the mission.** The stable/production rail (r1, port 3080) must remain running and untouched so the user can continue using it normally while the mission executes.

### Hard rules for missions

1. **Never rebuild, restart, stop, or reconfigure the stable rail** during any mission step. The stable containers must stay up and serving live traffic throughout.
2. **Never run `./local-services/start-all.sh stable`** as part of a mission. Only `./local-services/start-all.sh dev` is permitted during mission work.
3. **Never direct Docker commands at `librechat-stable-*` containers** (build, restart, exec with mutations, etc.) during mission work.
4. **All code changes, builds, tests, and validation happen on dev only.** The dev rail has its own compose project, image tags, ports, and writable state under `.rails/dev/`.
5. **Promotion to stable happens ONLY at the very end of the mission**, after ALL of the following are confirmed:
   - All validation contract checks pass on dev
   - All tests (lint, build, unit, integration) pass on dev
   - Manual smoke tests on dev confirm expected behavior
   - The user has been informed and has given explicit approval to promote
6. **The cutover sequence** (when promotion is approved): `docker cp` changed files into stable, `docker restart` stable. For the brief restart window, dev absorbs traffic. After stable is healthy, traffic returns to stable.
7. **If something goes wrong during the mission**, the dev rail is the only thing that gets fixed or restarted. Stable remains untouched as the fallback.

### Why this matters

The user depends on the stable rail for daily use. A mission that accidentally disrupts stable leaves the user without a working instance. The dev rail exists precisely so that all experimental, migration, and validation work can happen in isolation without risk to the production environment.

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
2. The change works on r2/dev
3. Relevant tests, lint, and build checks pass
4. Docs and lessons learned are updated
5. Only then is r1/stable eligible to be refreshed -- and ONLY with explicit user approval

Live-rail promotion is separate from git pushes, which require explicit human approval. **No mission, worker, or automated process may promote to stable without the user explicitly confirming the promotion.** Stable must remain running and usable for the user throughout any mission lifecycle.
