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
4. **Ollama**: Use `qwen2.5:latest` or `gemma3:latest` for basic tests (faster inference), `deepseek-r1:14b` for reasoning mode tests. Set explicit timeouts.
5. **Anti-abuse mitigation**: Limit blocked-model probes to 2-3 per session, always use browser-like User-Agent headers, and check for ban state before starting file/transcription assertions.

### Requires user-provided secrets or external setup

6. **Google credentials** (VAL-PROVIDER-003/004/005, VAL-MODEL-001): Need valid Gemini API key + Google OAuth client for social login.
7. **xAI API key** (VAL-PROVIDER-007/008/008A): User must save via UI provider settings.
8. **Azure credentials** (VAL-PROVIDER-001/001A, VAL-REALTIME-002): User must save Azure key + base URL via UI.
9. **MCP OAuth/Arcade** (VAL-MCP-002/003/004, VAL-CROSS-005A): Need Arcade domain in `librechat.yaml` allowlist + Arcade API key + completed OAuth consent.
10. **Federated auth** (VAL-MODEL-001): Need at least one social login provider configured.
