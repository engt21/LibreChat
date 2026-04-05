# User testing

Use this file for worker-facing validation guidance: which surfaces to test, which tools to use, rail boundaries, current blockers, and operational gotchas that affect trustworthy user testing.

## Primary validation surfaces and tools

- Primary surface: LibreChat web app on the dev rail at `http://127.0.0.1:3081`
- Supporting API/runtime checks:
  - `curl` route smokes for `/api/admin/permissions`, `/api/schedules`, and `/api/realtime/models`
  - `./local-services/status-all.sh all`
  - `./local-services/health-check.sh`
  - Docker status/log review for rail services and Langfuse health
- Browser / Playwright are acceptable only after retargeting them to the dev rail.

## Rail boundaries

- Validate on `dev` / `r2` / `:3081` only.
- Keep `stable` / `r1` / `:3080` available and untouched during migration validation.
- Do not let browser automation, Playwright, or ad hoc curls default back to `3080`.

## Dry-run status and blocker

- Dry run was a **partial pass**: the dev app on `3081` was reachable and returned expected responses.
- Current blocker: `librechat-dev-langfuse-clickhouse-1` was unstable and restarting under memory pressure.
- Mission rule: dev validation evidence is not trustworthy until Langfuse, especially ClickHouse, stays healthy.

## Validation concurrency

**Max concurrency: 1.**

Rationale: planning measured only ~1.2–1.3 GiB available RAM on a ~29 GiB host, with swap already fully used and dev ClickHouse already restart-looping. Run only one meaningful validation activity at a time (browser session, Playwright run, Docker rebuild/restart, or broad test sweep) to avoid false failures and rail instability.

## Important gotchas

- Playwright defaults target `http://localhost:3080` in the current repo config and package scripts; retarget to `3081` before using them.
- Scheduled runs and local-services behaviors are manual-heavy; treat them as operator-validated surfaces if touched.
- Cheap dev-rail smoke expectations:
  - `/api/admin/permissions` -> `401` or `403`
  - `/api/schedules` -> `401`
  - `/api/realtime/models` -> `401`
- For this mission, a momentary web response is not enough for Langfuse; the blocker is sustained ClickHouse stability.
- `./local-services/sync-from-stable.sh` now supports local-direct mode on this host (no `/home/timeng/.ssh/id_rsa` required); ensure SSH credentials only when explicitly using remote mode.
- `./local-services/export-dev-bundle.sh` can take a long time on ClickHouse volume archival; allow long execution windows and verify bundle metadata/hashes exist before treating export as complete.
- Under high memory/swap pressure, dev `:3081` may intermittently return connection reset/empty reply; capture repeated samples with health-check context instead of a single curl.
- Runtime-reconciliation recheck (round 3): `/api/realtime/models` returns `401` on dev (auth-gated readiness confirmed), orphan/shared-mount checks are clean, and sampled dev API logs show both `[ScheduledJobs] Starting scheduler runner ...` and `[AudioTranscription] Starting runner ...` on normal startup; VAL-CROSS-006 now passes.

## Flow Validator Guidance: runtime-cli

- Surface: runtime scripts and API smokes executed from shell (`start-all.sh`, `stop-all.sh`, `status-all.sh`, `health-check.sh`, `curl`).
- Isolation boundary: operate only on local rails `stable` (`3080`) and `dev` (`3081`) in `/pool/home/timeng/LibreChat-custom`.
- Concurrency: run serially only (`max concurrency = 1`).
- Stable rail protection:
  - never stop/rebuild stable directly;
  - only perform non-disruptive stable checks (`status`/`curl`) while running dev-side operations.
- Dev-side disruptive operations (e.g., bundle export/apply preconditions requiring a stopped dev rail) are allowed only when explicitly required by assigned assertions.
- Capture exact commands and outputs in the flow report, including HTTP status codes and any health-check warnings.
