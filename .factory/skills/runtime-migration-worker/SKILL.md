---
name: runtime-migration-worker
description: |
  Own the backup-first runtime side of the LibreChat migration. Use this worker for
  local-services scripts, root/runtime config, env templates, runtime patch hooks,
  dual-rail health, dev cutover preparation, and orchestrated cutover execution
  while preserving customizations and keeping stable/prod untouched until cutover.
---

# Runtime Migration Worker

## When to Use This Skill

- You are changing root runtime files, `local-services/`, Docker or compose wiring, runtime bootstrap/symlink logic, env templates, health checks, export/import bundle flows, or runtime patch hooks.
- You need to create or verify backups, restore paths, dev-rail readiness, Langfuse/runtime health, or cutover preparation steps.
- You are preparing a validated dev build for later promotion, or you were explicitly assigned the cutover sequence itself.
- Do not use this skill for ordinary feature logic inside `api/`, `packages/*`, or `client/` unless the only change is runtime plumbing.

## Required Skills

- Read mission docs first: `mission.md`, `validation-contract.md`, `contract-work/area-backup-runtime.md`, and `contract-work/cross-area-flows.md`.
- Then read repo guidance in order: `README.md`, `CLAUDE.md`/`AGENTS.md`, `CUSTOMIZATION_MASTER_DOC.md`, `CUSTOMIZATION_MASTER_GUIDE.md`, and the focused runtime docs you touch such as `README.local.md` or `LOCAL_UPSTREAM_SYNC_WORKFLOW.local.md`.
- Understand the mission boundary: `stable`/prod on `3080` must remain untouched during migration work; `dev`/r2 on `3081` is the only validation rail until orchestrator-approved cutover.
- The user may have other agents changing files in parallel. Re-read target files immediately before patching, preserve unrelated newer edits, and return to the orchestrator if the overlap cannot be merged safely inside your task.
- Treat runtime data, secrets, env files, bind mounts, and backup artifacts as sensitive and non-committable.
- Work serially for heavy validation or runtime exports/imports; host memory is constrained and validation concurrency stays at `1`. For small backend/config/runtime-loaded code changes, use `local-services/deploy-runtime-delta.sh dev --dry-run -- <paths>` and then deploy with that helper when accepted instead of manual `docker cp` or full image rebuilds. Only rebuild images when dependency files, Dockerfiles, base images, compose/container shape, package source, or frontend source require built artifacts or recreation.
- When changing sync, restore, ownership, or backup flows, you must verify the post-restore state as well as the guard path. Non-root dev services must still be able to use refreshed data after the real flow completes.
- When changing `config/apply-runtime-patches.js`, keep the `src/`, `dist/esm`, and `dist/cjs` targets aligned unless you have a documented reason not to; partial patch coverage is a regression risk.

## Work Procedure

1. Read the mission docs first, then the repo docs in the required order. Identify the exact runtime surface you own and list the validation contract IDs that apply. In the final handoff, explicitly name the docs you read or explicitly note any required doc you skipped and why.
2. Confirm the backup-first safety state before making runtime changes. If your assignment includes backup, export/import, or cutover prep, create or verify the needed backup artifact and recovery path first.
3. Diff upstream/runtime changes against local custom behavior and preserve the custom branch rules: rail isolation, runtime bootstrap, patch hooks, local-services conventions, shared-runtime safeguards, dev-first promotion flow, and the approved temporary `stable -> dev -> stable` traffic rollover during prod cutover.
4. Where executable logic changes, add or update the closest automated test or regression check first. If no existing harness fits the touched runtime behavior, define explicit command-level verification steps before editing and use those steps immediately after. Exception for non-functional test-only or runbook-only cleanup: first verify the current behavior/scope, explicitly confirm no product behavior change is intended, then make the minimal textual/test adjustment.
5. Implement the minimum required runtime change. Never disrupt `stable`, never blur `stable` and `dev` writable state, and never use prod for migration validation.
6. Run targeted validation for the changed runtime surface first. Prefer focused script checks, health checks, and route checks before any broader validation. If the task is runtime-only and full test/build/lint execution is intentionally deferred to milestone scrutiny because of host constraints, say so explicitly and still run the minimum runtime-focused validation set for the changed surface.
7. If you changed sync, restore, export/import, or ownership behavior, verify both guard/refusal behavior and the real end-to-end flow. After a real restore/sync, prove that the resulting dev data ownership and permissions are usable by the intended non-root services.
8. If runtime behavior changed, manually verify on the dev rail where relevant: use the dev helper scripts, confirm the expected behavior on `3081`, confirm `stable` is still unaffected on `3080`, and confirm critical sidecars such as Langfuse are healthy when they are part of the changed flow.
9. If operator workflows, startup behavior, backup procedures, or cutover steps changed, update the relevant docs in the same task.
10. Return a precise handoff with changed files, preserved customizations, tests/checks added first, targeted validation results, manual dev evidence, stable impact, and any remaining cutover or coordination needs.

## Example Handoff

```json
{
  "worker": "runtime-migration-worker",
  "status": "completed",
  "summary": "Reconciled dev bundle export/apply helpers with upstream changes while preserving dual-rail isolation, runtime bootstrap, and custom dev-first promotion rules.",
  "filesChanged": [
    "local-services/export-dev-bundle.sh",
    "local-services/remote-apply-dev-bundle.sh",
    "local-services/sync-env.sh",
    "README.local.md"
  ],
  "customizationsPreserved": [
    "stable rail remained isolated on 3080 throughout the work",
    "dev rail continued using its own compose project, image tag, and writable state",
    "runtime bootstrap still links shared secrets/data without committing them"
  ],
  "testsOrChecksAddedFirst": [
    "Defined export/apply token-guard checks before editing because no dedicated Jest harness exists for these scripts."
  ],
  "targetedValidation": [
    {
      "command": "./local-services/export-dev-bundle.sh",
      "result": "pass",
      "notes": "Correctly refused while dev was running, then produced bundle metadata after dev was stopped."
    },
    {
      "command": "./local-services/remote-apply-dev-bundle.sh /tmp/dev-bundle.tar.zst",
      "result": "pass",
      "notes": "Rejected stale base token and archived conflict bundle instead of overwriting newer state."
    },
    {
      "command": "./local-services/health-check.sh dev",
      "result": "pass",
      "notes": "No orphan-container or bind-mount conflicts after the change."
    }
  ],
  "manualDevVerification": [
    {
      "check": "dev rail smoke",
      "result": "pass",
      "evidence": "curl http://127.0.0.1:3081 returned the expected app response after restart."
    },
    {
      "check": "stable untouched",
      "result": "pass",
      "evidence": "curl http://127.0.0.1:3080 stayed reachable for the full task."
    },
    {
      "check": "Langfuse readiness",
      "result": "pass",
      "evidence": "dev Langfuse web/worker/ClickHouse remained healthy across the observation window."
    }
  ],
  "docsUpdated": [
    "README.local.md"
  ],
  "stableImpact": "none",
  "openRisks": [
    "Actual prod cutover still requires orchestrator sequencing and explicit post-cutover smoke checks."
  ],
  "returnReason": "Runtime scope is complete and ready for orchestrator review."
}
```

## When to Return to Orchestrator

- The task now requires backend or frontend feature work beyond minimal runtime glue.
- Stable/prod would need to be touched, restarted, rebuilt, or promoted.
- Dev validation cannot be trusted because backups, runtime health, Langfuse readiness, or host resource limits are still unresolved.
- The change needs coordinated sequencing with another worker area before it is safe to continue.
- Your assigned runtime scope is complete and you have evidence ready for the next mission step.
