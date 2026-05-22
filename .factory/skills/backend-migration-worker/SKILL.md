---
name: backend-migration-worker
description: |
  Own the backend-preservation side of the LibreChat migration. Use this worker for
  `api/`, `packages/api/`, `packages/data-provider/`, `packages/data-schemas/`,
  provider backend behavior, schema changes, admin/model-access logic, scheduled-run
  backend flows, file/realtime services, and runtime patches that protect custom
  server behavior during the upstream migration.
---

# Backend Migration Worker

## When to Use This Skill

- You are changing `api/`, `packages/api/`, `packages/data-provider/`, or `packages/data-schemas/`.
- The task touches admin or RBAC behavior, registration gating, model-access enforcement, provider discovery/config backends, MCP/OAuth behavior, scheduled-run execution, file or transcription services, realtime services, or custom server-side patches.
- You are reconciling upstream backend conflicts while preserving branch-specific behavior and contract coverage.
- Do not use this skill for pure runtime orchestration or pure UI-only work unless backend logic is part of the assigned change.

## Required Skills

- Read mission docs first: `mission.md`, `validation-contract.md`, and the relevant contract notes for your surface such as `contract-work/area-admin-auth.md`, `area-providers.md`, `area-schedules.md`, `area-files-realtime.md`, and `cross-area-flows.md`.
- Then read repo guidance in order: `README.md`, `CLAUDE.md`/`AGENTS.md`, `CUSTOMIZATION_MASTER_DOC.md`, `CUSTOMIZATION_MASTER_GUIDE.md`, and the focused feature docs for the area you touch.
- Understand the package dependency chain: `packages/data-provider` → `packages/data-schemas` → `packages/api` → top-level consumers.
- Preserve all custom backend behavior; never silently revert to upstream defaults.
- The user may have other agents editing the repo in parallel. Re-read target files immediately before patching, preserve unrelated newer edits, and return to the orchestrator if concurrent overlap cannot be merged safely inside your scope.
- Keep migration validation on `dev` only, keep `stable` untouched, and run heavy backend validation serially because host resources are constrained.
- Remember the backend test-environment quirks on this host: direct Jest runs should use the relevant workspace directory when alias resolution depends on that workspace config, some `packages/api` integration paths require Redis to be available, `api` tests may need `.factory/init.sh` or a package build first so `@librechat/api` dist outputs exist, and standalone `tsc --noEmit` for `packages/api` is not reliable on this low-memory host.

## Work Procedure

1. Read the mission docs first, then the repo docs for the exact backend surface you own. Map your assignment to the relevant validation contract IDs before editing, and keep track of which repo docs you actually relied on. In the final handoff, explicitly name the docs you read or explicitly note any required doc you skipped and why.
2. Identify the custom behaviors at risk in your files and compare upstream changes against the current custom implementation before deciding how to merge.
3. Write or update the most relevant backend tests first wherever code changes occur. Prefer the nearest Jest/spec surface in the touched workspace so regressions are pinned before the implementation moves. Exception for non-functional test-only work (for example stale expectations, title renames, or typing-only fixture cleanup): first reproduce or inspect the current test behavior, explicitly verify no product behavior change is intended, then update the tests/titles as the deliverable.
4. Make the smallest backend changes that preserve the custom branch contract: admin and model-access behavior, provider routing/discovery, MCP/OAuth handling, scheduled-run semantics, file/transcription flows, realtime behavior, and any custom runtime patches in scope.
5. If you change shared packages, rebuild and validate in dependency order so downstream code is tested against fresh outputs.
6. Run targeted validation first: the specific package tests, integration checks, and focused builds that cover the changed backend surface. Expand only as far as the touched dependency chain requires. If a direct Jest invocation depends on workspace-local config, run it from that workspace. If a `packages/api` path genuinely needs Redis and Redis is unavailable, note that explicitly and avoid presenting the failure as a product regression; use the focused suite or ignore the Redis-backed integration tests when that still validates the assigned seam. On this host, treat the Rollup/`npm run build:api` path with `NODE_OPTIONS=--max-old-space-size=8192` as the practical type/build gate instead of standalone `tsc --noEmit`.
7. When the backend change affects observable app or API behavior, manually verify it on the dev rail where relevant. Use `3081` only, keep `stable` untouched on `3080`, and confirm the exact user or operator flow that changed.
8. If behavior, operational workflow, or migration guidance changed, update the relevant docs in the same task.
9. Return a handoff that names the preserved customization, the repo docs you relied on, the tests written first, the dependency-chain rebuild steps, targeted validation results, manual dev verification, and any remaining cross-worker dependencies.

## Example Handoff

```json
{
  "worker": "backend-migration-worker",
  "status": "completed",
  "summary": "Merged upstream provider-model loading changes into the custom backend without regressing model-access enforcement or native-tool routing.",
  "filesChanged": [
    "api/server/controllers/ModelController.js",
    "api/server/services/ModelAccess.js",
    "packages/api/src/agents/nativeTools.ts",
    "packages/api/src/agents/nativeTools.spec.ts",
    "api/server/services/ModelAccess.spec.js",
    "CUSTOMIZATION_MASTER_DOC.md"
  ],
  "customizationsPreserved": [
    "restricted users still receive filtered models and blocked execution paths fail server-side",
    "provider-native tool routing still avoids duplicate file context",
    "superadmin and lower-tier admin behavior remained unchanged"
  ],
  "testsAddedFirst": [
    "packages/api/src/agents/nativeTools.spec.ts",
    "api/server/services/ModelAccess.spec.js"
  ],
  "targetedValidation": [
    {
      "command": "npm run test:packages:api -- --runInBand --testPathPatterns=packages/api/src/agents/nativeTools.spec.ts",
      "result": "pass"
    },
    {
      "command": "npm run test:api -- --runInBand --testPathPatterns=api/server/services/ModelAccess.spec.js",
      "result": "pass"
    },
    {
      "command": "npm run build:data-provider && npm run build:data-schemas && npm run build:api",
      "result": "pass",
      "notes": "Ran because shared package outputs were touched."
    }
  ],
  "manualDevVerification": [
    {
      "check": "restricted-user model filtering on dev rail",
      "result": "pass",
      "evidence": "Observed filtered model list and blocked disallowed model request on http://127.0.0.1:3081."
    },
    {
      "check": "stable untouched",
      "result": "pass",
      "evidence": "No calls or rebuilds were directed at 3080 during validation."
    }
  ],
  "docsUpdated": [
    "CUSTOMIZATION_MASTER_DOC.md"
  ],
  "openRisks": [
    "Frontend follow-up is still required if the orchestrator wants matching UI affordances for the preserved backend behavior."
  ],
  "returnReason": "Backend scope is complete and ready for orchestrator integration."
}
```

## When to Return to Orchestrator

- The remaining work is primarily runtime orchestration, dev/stable rail management, or cutover sequencing.
- The remaining work is primarily in `client/` or other UI-only surfaces.
- A required dependency, schema, provider credential path, or dev runtime service is blocked outside your backend scope.
- The change is complete and you have targeted test evidence plus dev-rail verification ready.
- Continuing would risk touching `stable`/prod or expanding beyond the assigned backend surface.
