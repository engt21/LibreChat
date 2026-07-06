# LibreChat Production Incident — 2026-07-06

## Status

Resolved and converted into durable resource, authentication, deployment, rollback, and monitoring
guardrails. This document records the incident chain and the preservation requirements for the July
5-6 customization release. It does not authorize a production deployment; VM stable remains subject
to the approval and safe-window rules in `AGENTS.md`.

## User-visible impact

- LibreChat became slow or unavailable while the VM was under sustained CPU, memory, and storage-I/O
  pressure.
- MongoDB server-monitor/selection timeouts interrupted authentication-store operations.
- A transient refresh failure could be presented as an invalid session, returning an authenticated
  user to the login page even though the password, TOTP enrollment, and refresh-token format were not
  the root cause.
- Restarts and emergency rollback carried an additional risk: mutable or stale image tags could
  restore older compiled packages, frontend assets, or runtime patches and silently remove recent
  authentication and customization fixes.

## Root cause

The incident was resource starvation, not a credential failure.

1. A detached benchmark competed with the production VM instead of running under a production-first
   cgroup policy.
2. Langfuse and its storage dependencies added background pressure. The important contributors were
   Langfuse web/worker processing, ClickHouse ingestion/compaction, and MinIO object storage, with
   additional Redis/Postgres and metrics work.
3. The services did not have sufficiently explicit CPU, memory, PID, and block-I/O priorities. The
   API and MongoDB could therefore lose latency headroom while lower-priority work continued.
4. MongoDB emitted transient monitor/selection timeouts under pressure. Refresh/session reads then
   failed, and the authentication path treated the store failure too much like an invalid token.
5. The client redirected to login on refresh failure instead of retaining state and retrying a
   temporary `5xx`/network condition.

The benchmark, MinIO, ClickHouse, and Langfuse were pressure multipliers. MongoDB timeout was the
proximate authentication failure. Password hashes, TOTP secrets, and user enrollment were not the
cause and must not be reset during recovery.

## Contributing deployment risk

Production had accumulated runtime-delivered fixes. A tag such as `librechat-local:latest`, a Docker
commit made from a builder, or an unverified rollback pointer was not sufficient proof that the image
contained the current source, compiled package `dist`, runtime patches, and complete `client/dist`.

This creates two rollback hazards:

- **Source/dist skew:** a live or committed image can contain newer compiled output than its source
  tree. Rebuilding inside that image can replace good auth/session code with stale output.
- **Mutable-tag skew:** recreating from an older mutable tag can undo runtime deltas, GPT-5.6
  capabilities, memory policy, image/Code Interpreter integration, or frontend features even when the
  source checkout still looks correct.

Only a known-good predeployment snapshot may become the automatic rollback target. A verified stable
runtime delta is persisted as `librechat-local:runtime-current`; deployment fallback uses the exact
healthy current image as `librechat-local:last-known-good`. Known-bad emergency snapshots must be
invalidated rather than retained as rollback candidates.

## Corrective controls

Langfuse and its ClickHouse, MinIO, Redis, PostgreSQL, worker, web, and pricing-sync services are now opt-in through the `langfuse` Compose profile. The production API has empty Langfuse credentials, so routine stack reconciliation cannot revive the failed integration or its resource load.

### Production-first resource policy

- LibreChat API and MongoDB use the core resource class with higher CPU and block-I/O weight,
  reservations, health checks, and negative OOM scores.
- The API receives a graceful Node heap/cgroup envelope instead of being left at the former small
  heap: `NODE_OPTIONS` defaults to a 4 GiB old-space limit inside a 5 GiB container limit with a 3 GiB
  reservation.
- MongoDB receives a 1.5 GiB limit, 768 MiB reservation, a bounded WiredTiger cache, and a direct
  ping health check.
- Meilisearch, vector storage, Code Interpreter, and other support services receive bounded support
  shares. RAG, metrics, pricing sync, and observability components remain lower-priority auxiliary
  workloads.
- Langfuse web and worker, ClickHouse, MinIO, Redis, Postgres, and pricing sync have explicit memory,
  CPU, swap, PID, and I/O controls. ClickHouse and MinIO must never be allowed to crowd out the API or
  MongoDB merely because tracing traffic increases.
- `verify-production-resource-contracts.sh`, `verify-api-runtime-contract.sh`, and
  `verify-api-memory-headroom.sh` are deployment/health gates, not optional diagnostics.

### Benchmark throttle

All detached VM benchmarks must run through
`local-services/run-benchmark-production-priority.sh` as documented in
`local-services/BENCHMARK_PRODUCTION_PRIORITY.md`.

The default policy favors production with a 20% CPU quota, low CPU/I/O weight, 1.5 GiB
`MemoryHigh`, 2 GiB `MemoryMax`, no swap, and hard read/write bandwidth limits. The supervisor waits
for consecutive LibreChat and MongoDB health successes before starting or resuming work and sends
`SIGSTOP` to the entire benchmark unit immediately when either health check fails. An adopted
benchmark is left paused if its supervisor exits; it must never continue unmanaged.

### Authentication behavior under pressure

- Mongo/network/topology timeouts are temporary authentication-store failures and return `503` with
  `Retry-After`, not `401`/`403` invalid-token semantics.
- The client retains the current authenticated UI and retries transient refresh failures with bounded
  exponential backoff. It redirects to login only for a definitive authentication rejection.
- An MFA-pending login cannot consume stale refresh state. Password and TOTP enrollment remain
  untouched during recovery.
- Refresh-token issuer, audience, type, and session `jti` checks remain mandatory and separate from
  the transient-store handling. See `AUTH_DEPLOYMENT_SAFETY.md`.

### Sandbox lifetime and pressure control

- Local Code Interpreter child containers are warm per LibreChat session/language, but they are not
  permanent daemons.
- `LOCAL_CODE_SESSION_TTL_HOURS` defaults to one hour and cannot be configured below one hour.
- A background janitor runs on a bounded interval, excludes active children, and removes expired
  labeled or legacy `llm-sandbox` children. Bridge shutdown closes all children immediately.
- Child limits remain bounded (`LOCAL_CODE_MEMORY_LIMIT`, `LOCAL_CODE_NANO_CPUS`, and
  `LOCAL_CODE_PIDS_LIMIT`) even when outbound networking is enabled for package installation.

## Deployment and build rules

Classify every change before building:

1. **Runtime delta:** use `local-services/deploy-runtime-delta.sh --dry-run` first for
   `api/**/*.js`, runtime config/helpers, runtime patches, and already-built `packages/*/dist/**`.
   The helper snapshots, verifies auth/runtime/headroom, restarts, health-checks, and persists the
   verified filesystem as `librechat-local:runtime-current`.
2. **Affected package build:** when `packages/*/src/**` changes, rebuild only the affected package and
   its required dependency chain. Use `LIBRECHAT_ROLLUP_SOURCEMAP=false`, an 8192 MB Node heap, low CPU/IO priority, and the dedicated host build swap through the build profile of the Node wrapper
   for large Rollup builds; external source maps are not required by production.
3. **Complete frontend promotion:** any `client/src/**` change requires a fresh complete
   manifest-verified `client/dist` and `deploy-built-client-dist.sh`. Never copy source or edit a
   hashed asset in place.
4. **Full image rebuild/recreate:** reserve this for dependency, lockfile, Dockerfile, base-image, or
   incompatible compose/container-shape changes. A rebuild is not the default way to make a runtime
   hotfix durable.

Never rebuild packages from a runtime/builder image until the complete current source subtree has
been synchronized from `/pool/home/timeng/LibreChat-custom`. Never use a successful `/api/config`
response as the only deployment proof.

## Customization preservation set

The incident response and any future merge/rebuild must preserve these July 6 behaviors together:

- GPT-5.6 family picker visibility and `max`/UI `ultra` reasoning mapping.
- Admin-routed, explicit-intent, post-response memory using the configured provider/model and
  completed tool context.
- Immediate Send/Retry status and actual provider partial-image streaming; no synthetic pixel
  placeholder may be persisted as the result.
- Per-thread and per-turn usage panel for input/output/cache/reasoning tokens, tool calls, and memory
  usage attribution.
- Direct provider image vision at the highest supported fidelity plus original-file staging for local
  Code Interpreter in the same turn.
- Local upload persistence across model, endpoint, mention, and preset switches; only an actual New
  Chat clears the draft/files.
- Conversation fork validation that preserves a valid parent-before-child tree and rejects missing,
  unfinished, empty, or circular trees with actionable errors.
- Full generation-branch deletion: selected assistant generation, descendants, originating prompt
  sibling set where required, and linked persisted tool-call records remain owner-scoped.
- Dedicated Agents picker/button behavior, provider ordering, suggested-model policy, Deep Research
  tool placement, and preset duplication.
- Refresh/session/MFA persistence, authenticated-first OAuth MCP discovery, and deterministic tools.

These features span source, compiled workspace packages, runtime patches, and frontend assets. A
backend-only deployment must preserve the current complete `client/dist`; a frontend deployment must
not downgrade backend/package `dist`.

## Detection and recovery

1. Confirm VM, container, API HTTP, MongoDB, memory/swap, and filesystem/I/O state before mutation.
2. Pause the benchmark first; do not recover production while unmanaged benchmark work continues.
3. Treat Mongo timeout plus auth refresh failure as a resource incident until pressure is ruled out.
4. Do not reset passwords, TOTP, backup codes, or sessions.
5. Verify the canonical API command, auth/runtime contracts, and memory headroom before restart.
6. Use the deployment fallback and only a valid known-good rollback pointer for an approved restart.
7. Re-run health, auth, memory, Code Interpreter, image, usage, picker, and GPT-5.6 validation after
   deployment.

Operational monitoring and rollback details live in `LIBRECHAT_HEALTH_MONITORING.md`.

## Rollback validation near-miss and recovery

At 08:37 UTC, a read-only rollback-pointer check was accidentally run through an older VM runtime-tree
copy of `librechat-rollback-last-stable.sh`. That copy did not implement `status` and defaulted to
execution, so it restored the prior client snapshot and restarted `LibreChat`. HTTP health stayed green,
but the served frontend hash changed from the intended build to the predeployment hash.

Recovery used the supported manifest-verified full-client promotion from `/opt/LibreChat-custom/client/dist`.
The helper activated the deployment fallback, verified OpenAI reasoning preservation, refresh/session and
memory contracts, canonical runtime shape, and heap headroom, atomically restored all 222 manifest-tracked
files, restarted the API, and returned routing to stable. At 08:39 UTC the public, container, and intended
`index.html` hashes matched and `/api/config` returned HTTP 200.

The rollback interface is now fail-closed. `status` and `--check` are read-only; only the literal `execute`
subcommand may mutate production. Watchdog and deployment-cleanup callers pass `execute` explicitly, and
the installed pve2, VM, and VM runtime-tree copies were hash-aligned and verified with a no-argument test
that returned exit code 2 without changing the container start time.

## Final corrective actions and live proof

The final production pass closed several independent regressions that had been masked by stale
frontend assets and partial runtime promotion:

- Dynamic suggested model specs now update `name`, `label`, and `preset.model` together. Updating
  only the display label/model caused the GPT-5.6 suggestion to submit the older GPT-5.4 spec
  identity.
- Model-spec transitions inside the OpenAI family preserve the active draft, uploaded files, Code
  Interpreter state, Image state, web/file-search state, artifacts, and MCP selections. Switching to
  a different provider still applies that provider/spec's own safe defaults. Assistant selection
  also preserves pending uploads.
- Streaming image-tool arguments are incremental JSON. The client now treats incomplete argument
  fragments as expected stream state instead of logging repeated parse errors. It renders no fake
  pixel placeholder, then displays provider partial/final attachments as they arrive.
- Thread Usage derives the selected branch from the current latest-message ancestry before querying
  usage, so hidden sibling generations are excluded from visible-branch totals.
- Code Interpreter orphan age is anchored to session metadata `updated_at` when available, with
  Docker creation time as a safe fallback. Active-runtime selection and deletion run under the same
  session lock, and the production bridge uses a one-hour TTL.
- Deployment fallback aborts are bounded by an automatic expiry. Runtime-delta deployment executes
  an immutable staged fallback helper, so updating the helper itself cannot change cleanup behavior
  mid-deploy. Memory-headroom failures no longer bypass the gate merely because a local compose
  override exists.

Authenticated production validation on July 6, 2026 confirmed:

- `/api/config` returned HTTP 200 before, during fallback routing, and after each guarded promotion.
- The same authenticated browser session survived guarded API/frontend restarts without MFA
  re-enrollment or a login redirect.
- New-chat generation showed visible status in about 219 ms; Retry showed status in about 116 ms and
  completed as sibling `2 / 2`.
- GPT-5.6 appeared as a suggested OpenAI model under its own spec identity; Agents remained a
  separate adjacent button.
- Code Interpreter and Image both remained enabled across an OpenAI GPT-5.6 to GPT-5.6-family model
  switch.
- Provider vision read the uploaded image directly, while local Code Interpreter received the exact
  original file at `/mnt/data`, with matching dimensions and SHA-256.
- OpenAI image generation persisted and rendered a real 768x768 provider image; no synthetic pixel
  preview or incremental-JSON console flood remained.
- Explicit memory requests produced persistent memory records, OAuth MCP without credentials
  returned `MCP_AUTHENTICATION_REQUIRED` quickly, fork creation completed, and generation-tree
  deletion removed the selected route.
- The Code Interpreter bridge passed health, uploaded-file mount, outbound package installation, and
  import verification after its isolated image refresh; the LibreChat API remained HTTP 200.
