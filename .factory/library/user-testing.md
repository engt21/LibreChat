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

## Cutover-phase validation

- Only the explicit prod-cutover feature may validate beyond the normal dev-only boundary.
- Approved cutover choreography is: validate `dev` first, shift active traffic to validated `dev`, refresh `stable` while `dev` serves traffic, verify refreshed `stable`, then return active traffic to `stable`.
- Keep `dev` reachable as the rollback rail during the cutover window, but do not leave `dev` as the steady-state primary rail after cutover because it has lower memory headroom and is mainly reserved for development/validation.
- Cutover evidence must distinguish temporary failover service on `dev` from the final restored steady-state on `stable`.

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
- Customization-preservation user-testing round 1 found auth setup blockers on dev: repeated `POST /api/auth/login` for existing validation users returned `403` temporary-ban, fresh `POST /api/auth/register` attempts returned `429` account-throttle responses, and stale refresh cookies returned `401`. **These blockers have been resolved** — see "Dev validation auth bootstrap" below.

## Dev validation auth bootstrap

Deterministic validation personas are seeded by `local-services/dev-seed-validation-personas.js`. The script:

1. Connects to the dev MongoDB at `mongodb://127.0.0.1:27018/LibreChat`
2. Clears all ban entries, violation logs, and rate-limiter state from the `logs` and `keyv` collections
3. Creates or resets five validation personas with known passwords and correct role/adminRoleIds
4. Clears stale sessions for those personas
5. Writes a gitignored local manifest at `local-services/.dev-validation-manifest.local.json`

### Usage

```bash
# 1. Start the dev rail (if not already running)
./local-services/start-all.sh dev

# 2. Seed the personas (run from repo root)
node local-services/dev-seed-validation-personas.js

# 3. Restart the API to flush in-memory rate-limiter and ban caches
docker restart librechat-dev-api
# Wait ~20 seconds for the API to become healthy

# 4. Read credentials from the local manifest
cat local-services/.dev-validation-manifest.local.json
```

### Validation personas

| Email | Role | adminRoleIds | Purpose |
|-------|------|-------------|---------|
| `val-user@dev.local` | USER | `[]` | Non-admin with default model restrictions |
| `val-superadmin@dev.local` | ADMIN | `[]` | Superadmin (full permissions, isSuperAdmin=true) |
| `val-workspace-admin@dev.local` | USER | `[workspace_admin]` | Lower-tier: users.read, users.delete, usage.read, settings.read/write, observability.read |
| `val-support-admin@dev.local` | USER | `[support_admin]` | Lower-tier: users.read, usage.read, settings.read |
| `val-observability-admin@dev.local` | USER | `[observability_admin]` | Lower-tier: observability.read |

### Authenticated API usage

```bash
# Login and capture token
resp=$(curl -s http://127.0.0.1:3081/api/auth/login -X POST \
  -H "Content-Type: application/json" \
  -d '{"email":"val-superadmin@dev.local","password":"Val!dation_SuperAdmin_2025"}')
token=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# Use token for authenticated requests
curl -s -H "Authorization: Bearer $token" http://127.0.0.1:3081/api/admin/permissions
```

### Important notes

- **The manifest file is gitignored** — it must never be committed.
- **Rate limiters are in-memory** — restarting the dev API (`docker restart librechat-dev-api`) is required after seeding to flush login/register rate-limiter state.
- Bans and violations are stored in the `logs` MongoDB collection (via keyvMongo with `BANS:` and `ban:` key prefixes). The seed script clears these but the in-memory banCache in the running API container must also be flushed by restart.
- LOGIN_MAX=7 attempts per 5-minute window; REGISTER_MAX=5 per 60-minute window. Keep validation login attempts within these limits between API restarts.
- Lower-tier admins have `role: USER` with `adminRoleIds` granting scoped permissions via the AdminRole system. Only `role: ADMIN` users are treated as superadmins.
- High-volume blocked-model probes can trigger temporary-ban responses on validation users; when this occurs, rerun `dev-seed-validation-personas.js` and restart `librechat-dev-api` before the next assertion batch.
- Several provider/MCP assertions require external runtime prerequisites that may not exist on local dev by default (for example Google credentials, xAI user keys, or an OAuth-enabled MCP server allowlisted by domain policy); capture these as blocked with concrete evidence when unavailable.

## Flow Validator Guidance: runtime-cli

- Surface: runtime scripts and API smokes executed from shell (`start-all.sh`, `stop-all.sh`, `status-all.sh`, `health-check.sh`, `curl`).
- Isolation boundary: operate only on local rails `stable` (`3080`) and `dev` (`3081`) in `/pool/home/timeng/LibreChat-custom`.
- Concurrency: run serially only (`max concurrency = 1`).
- Stable rail protection:
  - never stop/rebuild stable directly;
  - only perform non-disruptive stable checks (`status`/`curl`) while running dev-side operations.
- Dev-side disruptive operations (e.g., bundle export/apply preconditions requiring a stopped dev rail) are allowed only when explicitly required by assigned assertions.
- Capture exact commands and outputs in the flow report, including HTTP status codes and any health-check warnings.

## Flow Validator Guidance: web-ui-api-dev

- Surface: user-visible web flows on dev rail (`http://127.0.0.1:3081`) plus supporting authenticated/unauthenticated API checks.
- Isolation boundary:
  - do not use `stable` (`3080`) for validation actions;
  - keep all browser automation and API calls pinned to `3081`;
  - only use test accounts/data created under the validator's assigned scope.
- Concurrency: serial only (`max concurrency = 1` globally for this mission).
- Session/data handling:
  - if a flow mutates persistent state (registration toggle, RBAC, model access, provider keys, schedules), restore safe defaults where feasible before finishing;
  - record every state mutation and cleanup action in the flow report.
- Evidence expectations:
  - include concrete request/response status codes and key payload snippets for API checks;
  - include UI observations tied to specific contract IDs;
  - mark assertions blocked (not passed) when required external credentials/services are unavailable.

## Blocked Prerequisite Clusters (as of round 2)

The full prerequisite inventory is at `.factory/validation/customization-preservation/blocked-prerequisite-inventory.md`. Key operational points for the next validation run:

### Pre-run preparation (locally resolvable, no secrets needed)

1. **Clear temp bans before every assertion group**: Run `node local-services/dev-seed-validation-personas.js && docker restart librechat-dev-api && sleep 25` before each assertion batch. The seeded personas accumulate bans during blocked-model probes, non-browser UA requests, and rapid login attempts.
2. **VAPID push keys**: Run `./local-services/generate-vapid-keys.sh` to generate and append VAPID keys to `.env`, then restart the dev API. This unblocks VAL-SCHED-009.
3. **SUPERADMIN_EMAILS env check**: The app loads this via `dotenv` from `/app/.env`, NOT from `printenv`. Use `docker exec librechat-dev-api node -e "require('dotenv').config({path:'/app/.env'}); console.log(process.env.SUPERADMIN_EMAILS ? 'SET' : 'UNSET')"` to verify. This unblocks VAL-CROSS-001.
4. **Ollama**: Use `deepseek-r1:14b` (or another model known to invoke tools reliably) for VAL-PROVIDER-010/011 validation. `qwen2.5:latest` may answer without actually calling the `web_search` tool in this environment, so do not treat it as the default validation model for the hosted web-search contract. Set explicit timeouts and add a direct instruction to use web search when validating the web-search path.
5. **Anti-abuse mitigation**: Limit blocked-model probes to 2-3 per session, always use browser-like User-Agent headers, and check for ban state before starting file/transcription assertions.

### Requires user-provided secrets or external setup

6. **Google credentials** (VAL-PROVIDER-003/004/005, VAL-MODEL-001): Need valid Gemini API key + Google OAuth client for social login.
7. **xAI API key** (VAL-PROVIDER-007/008/008A): User must save via UI provider settings.
8. **Azure credentials** (VAL-PROVIDER-001/001A, VAL-REALTIME-002): User must save Azure key + base URL via UI.
9. **MCP OAuth/Arcade** (VAL-MCP-002/003/004, VAL-CROSS-005A): Need Arcade domain in `librechat.yaml` allowlist + Arcade API key + completed OAuth consent.
10. **Federated auth** (VAL-MODEL-001): Need at least one social login provider configured.

## Round 3 rerun notes (2026-04-06)

- VAPID keys were generated locally via `./local-services/generate-vapid-keys.sh` and loaded after `docker restart librechat-dev-api`; push API lifecycle checks became testable, but headless browser notification permission remained denied for full click-path validation.
- `VAL-PROVIDER-001B` (Responses history reconstruction) passed in a dedicated multi-turn OpenAI web-search flow; this assertion is no longer pending.
- `VAL-CROSS-005` passed after policy-change revalidation checks, but `VAL-CROSS-005A` failed: pending-consent OAuth MCP scheduled run returned success instead of durable auth failure.
- MCP local test servers at `http://192.168.50.4:8765` and `:8766` were still rejected by current domain policy during this run, preventing complete `VAL-MCP-001` user-surface coverage.
- New high-signal failures were observed in file/transcription flows (missing compose-bar Transcribe affordance, ENOENT temp-file transcription failure, non-appendable transcript follow-up state); prioritize these before another broad rerun.

## Round 4 rerun notes (2026-04-10)

- **Now passing:** `VAL-AUTH-001`, `VAL-CROSS-001`, `VAL-MODEL-001`, `VAL-FILES-004`, `VAL-FILES-005`, `VAL-FILES-008`, `VAL-CROSS-004`, and `VAL-FILES-009`.
- **Still failing (high signal):**
  - `VAL-FILES-001` / `VAL-FILES-002` (provider-pin metadata + OCR text preservation still not confirmed in user/API surface),
  - `VAL-FILES-006` (diarization `/c/new` handoff can fail with invalid conversation-id/saveConvo cast errors),
  - `VAL-PROVIDER-001A` (legacy Azure branch still not showing expected `api-version` behavior in rerun evidence),
  - `VAL-PROVIDER-010` / `VAL-PROVIDER-011` / `VAL-REALTIME-004` (Ollama web-search/reasoning/inline status behavior still unstable),
  - `VAL-PROVIDER-002` / `VAL-FILES-003` / `VAL-FILES-007` / `VAL-CROSS-003` (native file/code-routing coherence gaps on tested OpenAI flow),
  - `VAL-MCP-004` / `VAL-CROSS-005A` (pending-consent OAuth MCP schedule path still succeeds instead of durable auth failure).
- **Still blocked (external/prereq):** Azure user key path, Google credential validity (`API_KEY_INVALID`), xAI user key, MCP domain allowlist for local test servers, and schedule delivery-observation sinks for payload/click verification.
- **Operational note:** run `node local-services/dev-seed-validation-personas.js && docker restart librechat-dev-api && sleep 25` before each assertion group; temporary-ban state still recurs under mixed UI/API probing.

## Schedule Validation Harness (VAL-SCHED-006, VAL-SCHED-008, VAL-SCHED-009)

A dedicated dev-only harness script at `local-services/dev-validate-schedule-harness.sh` enables the next validator rerun to exercise the three previously blocked schedule assertions without touching the stable rail.

### Quick start

```bash
# Prerequisites
./local-services/generate-vapid-keys.sh          # one-time — generates VAPID keys in .env
node local-services/dev-seed-validation-personas.js
docker restart librechat-dev-api && sleep 25

# Run all phases
./local-services/dev-validate-schedule-harness.sh

# Run individual phases
./local-services/dev-validate-schedule-harness.sh --phase runner-disabled
./local-services/dev-validate-schedule-harness.sh --phase push-lifecycle
./local-services/dev-validate-schedule-harness.sh --phase push-payload
```

### Phase coverage

| Phase | Assertion | What it proves |
|-------|-----------|----------------|
| `runner-disabled` | VAL-SCHED-006 | Toggles `SCHEDULED_RUNNER_ENABLED=false` in the dev container `.env`, restarts API, confirms "Scheduler disabled by configuration" log, validates manual `Run now` still works, then restores enabled state |
| `push-lifecycle` | VAL-SCHED-009 | Subscribes a synthetic push endpoint, verifies `subscriptionCount`, re-subscribes (idempotent refresh), unsubscribes, verifies count decreased |
| `push-payload` | VAL-SCHED-008 | Subscribes a harness endpoint, runs a push-enabled schedule, captures channel-level `notificationResults.push` with status/details/expiredEndpoints |

### Harness behavior

- **Isolation**: Only touches the dev container (`librechat-dev-api`). Stable rail is checked for reachability but never modified.
- **Self-restoring**: The `runner-disabled` phase restores `SCHEDULED_RUNNER_ENABLED=true` and restarts the API after validation.
- **Results**: All evidence is saved to `local-services/.dev-schedule-harness-results/` (gitignored directory).
- **Auth**: Uses `val-superadmin@dev.local` credentials. If token acquisition fails, run `dev-seed-validation-personas.js` first.

### Test coverage backing

The assertions are also backed by unit test coverage:

- **VAL-SCHED-006**: `runner.spec.js` — "returns false and logs disabled when SCHEDULED_RUNNER_ENABLED=false", "manual runScheduledJobNow still works when runner is disabled", "does not execute when runner is disabled"
- **VAL-SCHED-008**: `notifications.spec.js` — "push payload includes conversationId, url, status, and tag for clickthrough", "push payload omits url cleanly when no conversationId", "push notification failure is non-fatal and reports channel-level result"
- **VAL-SCHED-009**: `notifications.spec.js` — "sends push notification and prunes expired subscriptions", "prunes stale subscriptions returning 404 in addition to 410", "push-lifecycle" phase in harness script

### Stale-endpoint pruning path

The push notification delivery code (`notifications.js`) already prunes endpoints returning HTTP 404 or 410 from the push service. When `web-push` returns one of these status codes, the endpoint is collected in `expiredEndpoints` and passed to `removePushSubscriptions()` which removes them from the user's stored subscriptions. This is fully tested in `notifications.spec.js` and exercisable at runtime via the harness when a push-enabled schedule is executed against unreachable synthetic endpoints.

## Round 5 rerun notes (2026-04-10)

- **Now passing in rerun:** `VAL-FILES-001`, `VAL-PROVIDER-002`, `VAL-CROSS-005A`, `VAL-SCHED-006`.
- **Still failing (high signal):** `VAL-FILES-002`, `VAL-FILES-006`, `VAL-MODEL-003`, `VAL-PROVIDER-001A`, `VAL-PROVIDER-010`, `VAL-PROVIDER-011`, `VAL-REALTIME-004`, `VAL-MCP-004`.
- **Still blocked (external/prereq/observability):** Azure user credentials (`VAL-PROVIDER-001`, `VAL-REALTIME-002`, Azure branches of cross-provider assertions), Google credential validity (`VAL-PROVIDER-003/004/005`), xAI key (`VAL-PROVIDER-007/008/008A`), MCP domain/refresh/callback prerequisites (`VAL-MCP-001/002/003`), delivery-observation limits for push payload/click paths (`VAL-SCHED-008/009`), and user-surface limits for Ollama per-model origin proof (`VAL-PROVIDER-009`).
- **Environment friction observed during setup:** `librechat-dev-langfuse-web-1` restart count increased repeatedly while ClickHouse reported memory-limit migration failures (`max=448MiB`) after a full `start-all.sh dev`; core assertion reruns still proceeded on dev API/auth surfaces, but this should be tracked as readiness risk before broad reruns.

## Round 6 rerun notes (2026-04-10)

- **Now passing in rerun:** `VAL-SCHED-008` (channel-level push payload evidence captured, including valid conversation URL path and no-conversation branch with `url:null`).
- **Still failing (high signal):** `VAL-MCP-001`, `VAL-MCP-004`, `VAL-FILES-002`, `VAL-FILES-006`, `VAL-MODEL-003`, `VAL-PROVIDER-001A`, `VAL-PROVIDER-010`, `VAL-PROVIDER-011`, `VAL-REALTIME-004`.
- **Still blocked (external/prereq/observability):**
  - `VAL-MCP-002` (no consented refresh-token OAuth state),
  - `VAL-MCP-003` (forwarded/request-host callback-precedence branch remained unreachable from current flow state),
  - `VAL-SCHED-009` (lifecycle proved, but stale-endpoint prune and real click-open path still not fully proven end-to-end),
  - Google credential validity (`VAL-PROVIDER-003/004/005`, plus dependent `VAL-CROSS-003`, `VAL-FILES-003`, `VAL-FILES-007`),
  - xAI key missing (`VAL-PROVIDER-007/008/008A`, plus xAI branch of `VAL-REALTIME-002`),
  - Azure branch non-conclusive despite key presence (`VAL-PROVIDER-001`, `VAL-REALTIME-002`, dependent cross-provider assertions),
  - Ollama per-model origin proof still not visible on allowed user/API surfaces (`VAL-PROVIDER-009`),
  - no grounded/reasoning-rich payload available for merged-thought/source-link contract (`VAL-REALTIME-005`).
- **Operational updates from round 6 evidence:**
  - Local MCP validation servers now require `/mcp` suffix for successful inspection; root URL probes returned `MCP_INSPECTION_FAILED` (`transport POST -> Not Found`).
  - Azure user key prerequisite is now present for validation personas (`/api/keys?name=azureOpenAI` showed non-null expiry), but execution/connect paths still need deterministic completion evidence.
