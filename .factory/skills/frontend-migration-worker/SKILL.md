---
name: frontend-migration-worker
description: |
  Own the frontend-preservation side of the LibreChat migration. Use this worker for
  `client/` and shared client-package changes affecting chat surfaces, provider
  settings, admin UI, scheduled-runs UI, realtime or transcription UX, and other
  user-visible customization work that must survive the upstream migration.
---

# Frontend Migration Worker

## When to Use This Skill

- You are changing `client/` or shared client-package UI code.
- The task touches chat surfaces, model picker behavior, provider settings, admin console UX, settings pages, scheduled-runs UI, realtime voice UX, transcription UX, or other user-visible customization work.
- You are reconciling upstream frontend conflicts while preserving capability-aware settings, custom affordances, and branch-specific workflows.
- Do not use this skill for backend-only logic or runtime orchestration unless the assigned task includes a real UI change.

## Required Skills

- Read mission docs first: `mission.md`, `validation-contract.md`, and the relevant contract notes such as `contract-work/area-admin-auth.md`, `area-providers.md`, `area-schedules.md`, `area-files-realtime.md`, and `cross-area-flows.md`.
- Then read repo guidance in order: `README.md`, `CLAUDE.md`/`AGENTS.md`, `CUSTOMIZATION_MASTER_DOC.md`, `CUSTOMIZATION_MASTER_GUIDE.md`, and the focused feature docs for the exact UI you touch.
- Understand that frontend migration work must preserve custom UX, not just compile successfully.
- The user may have other agents editing the repo in parallel. Re-read target files immediately before patching, preserve unrelated newer edits, and return to the orchestrator if concurrent overlap cannot be merged safely inside your scope.
- Keep all validation on the dev rail until cutover, leave `stable` untouched, and avoid parallel heavy tasks because host resources are constrained.
- Coordinate with backend or runtime workers when a UI contract depends on API shape, feature flags, or dev environment readiness.
- Some Jest/component suites are more reliable when run from the `client/` workspace context; use the workspace that owns the test config and mocks when alias resolution or setup files depend on it.

## Work Procedure

1. Read the mission docs first, then the repo docs for the affected UI surface. Map the task to the validation contract IDs and user flows you must preserve. In the final handoff, explicitly name the docs you read or explicitly note any required doc you skipped and why.
2. Inspect the current custom UX before merging upstream changes. Preserve branch-specific behavior such as admin gating, provider-specific settings honesty, model-picker affordances, schedules workflows, transcription flows, realtime connection flow, and message rendering details.
3. Write or update the closest frontend tests first wherever code changes occur. Prefer targeted React/Jest coverage for the exact component, hook, or utility being changed. Exception for non-functional test-only work (for example stale expectations or title renames): first reproduce or inspect the current test behavior, explicitly verify no product behavior change is intended, then update the tests/titles as the deliverable.
4. Implement the minimum UI changes needed while keeping the custom branch behavior intact. Match existing patterns and keep the UI aligned with the preserved backend contract.
5. Run targeted frontend validation first: focused component tests, hook tests, utility tests, and any package rebuilds required by the touched client surface. If a suite depends on the `client/` workspace config or mocks, run it from that workspace rather than an arbitrary repo-root Jest invocation.
6. Manually verify the affected flow on the dev rail where relevant. Use `3081`, confirm the visible UX and network behavior you changed, and keep `stable` on `3080` untouched during the entire task.
7. If visible behavior or operator workflow changed, update the corresponding docs in the same task so migration knowledge stays current.
8. Return a handoff with changed files, preserved UX contracts, tests added first, targeted validation, manual dev evidence, and any backend/runtime dependency that still needs orchestrator follow-through.

## Example Handoff

```json
{
  "worker": "frontend-migration-worker",
  "status": "completed",
  "summary": "Merged upstream model-picker updates into the custom client while preserving the superadmin-only provider-settings cog, capability-aware settings states, and transcription entry flow.",
  "filesChanged": [
    "client/src/components/Chat/Menus/Endpoints/ModelSelectorContext.tsx",
    "client/src/components/Chat/Menus/Endpoints/components/SearchResults.tsx",
    "client/src/components/Input/SetKeyDialog/SetKeyDialog.spec.tsx",
    "client/src/components/Chat/Input/Files/AudioTranscriptionBar.tsx",
    "client/src/components/Chat/Menus/Endpoints/components/__tests__/SearchResults.test.tsx",
    "REALTIME_VOICE.md"
  ],
  "customizationsPreserved": [
    "provider settings cog still appears only for superadmins and never for My Agents",
    "saved masked provider values still preload when reopening settings",
    "audio and video uploads still require the explicit Transcribe action instead of auto-starting"
  ],
  "testsAddedFirst": [
    "client/src/components/Chat/Menus/Endpoints/components/__tests__/SearchResults.test.tsx",
    "client/src/components/Input/SetKeyDialog/SetKeyDialog.spec.tsx"
  ],
  "targetedValidation": [
    {
      "command": "npm run test:client -- --runInBand --testPathPatterns=client/src/components/Chat/Menus/Endpoints/components/__tests__/SearchResults.test.tsx",
      "result": "pass"
    },
    {
      "command": "npm run test:client -- --runInBand --testPathPatterns=client/src/components/Input/SetKeyDialog/SetKeyDialog.spec.tsx",
      "result": "pass"
    }
  ],
  "manualDevVerification": [
    {
      "check": "provider settings visibility on dev rail",
      "result": "pass",
      "evidence": "Confirmed the cog is visible for superadmin only on http://127.0.0.1:3081 and absent for lower-tier admin and normal user."
    },
    {
      "check": "transcription UX",
      "result": "pass",
      "evidence": "Uploading audio on dev showed the explicit Transcribe bar and created the transcript conversation flow as expected."
    },
    {
      "check": "stable untouched",
      "result": "pass",
      "evidence": "No UI validation or runtime action targeted 3080."
    }
  ],
  "docsUpdated": [
    "REALTIME_VOICE.md"
  ],
  "openRisks": [
    "If the orchestrator changes the backend contract later, the affected UI smoke flows should be rerun on dev."
  ],
  "returnReason": "Frontend scope is complete and ready for orchestrator integration."
}
```

## When to Return to Orchestrator

- The remaining work is backend-only, runtime-only, or cutover sequencing rather than UI work.
- The UI is blocked on an unresolved backend contract, missing dev environment capability, or runtime readiness issue outside your scope.
- Manual dev verification for the changed user flow cannot be trusted yet because the dependent dev services are not healthy.
- Your assigned frontend scope is complete and you have focused test evidence plus dev-rail verification ready.
- Continuing would risk touching `stable`/prod or expanding beyond the assigned frontend surface.
