# Authentication Deployment Safety

This runbook is mandatory for any LibreChat change that can rebuild, replace, or restart code involved
in login, MFA, sessions, JWTs, `@librechat/data-schemas`, or the complete frontend bundle.

## Non-negotiable invariant

A successful password login and TOTP verification must create a refresh JWT containing all of these
claims:

| Claim       | Required value                                      |
| ----------- | --------------------------------------------------- |
| `iss`       | `JWT_ISSUER`, default `librechat`                   |
| `aud`       | `JWT_REFRESH_AUDIENCE`, default `librechat-refresh` |
| `tokenType` | `refresh`                                           |
| `jti`       | The MongoDB session ID                              |

Production must not restart if either the source, compiled package, or live synthetic-token check is
missing any claim.

## User-protection rules

- Never reset a password, TOTP secret, backup codes, or MFA enrollment to diagnose a post-deployment
  login loop unless the account owner explicitly requests that credential change.
- Never delete all sessions during a normal build, restart, runtime delta, or frontend promotion.
- Preserve the existing password hash and TOTP enrollment during recovery.
- A platform administrator is still authenticated normally but must not be automatically banned by
  login/violation counters.
- Treat `password accepted -> MFA accepted -> returned to password page` as a refresh-token contract
  failure until disproved.

## The two production incidents

### July 5, 2026

`packages/data-schemas/dist` was stale and generated a legacy refresh token. Password and TOTP
verification succeeded, but `/api/auth/refresh` rejected the token because it lacked the expected
issuer, audience, and refresh-token type.

### July 6, 2026 recurrence

An isolated builder was cloned from the running API container. The running container had previously
received a compiled auth hotfix, but its `packages/data-schemas/src` tree was older. Rebuilding the
package from that stale source silently replaced the good compiled bundle with a bad one. The next API
restart logged the administrator out and returned MFA challenges to the password page.

**Lesson:** a live image's source tree is not proof of its compiled runtime state. Docker commit copies
both, including any skew between them.

### July 6, 2026 resource-pressure authentication failure

The same maintenance period also exposed a separate failure mode: benchmark and
Langfuse/ClickHouse/MinIO pressure caused MongoDB server-monitor/selection timeouts. Refresh/session
reads failed while the authentication store was temporarily unavailable. This was not evidence of a
bad password, TOTP secret, or refresh-token claim set.

Transient Mongo/network/topology failures must return `503` with `Retry-After`; the client keeps the
current session UI and retries with bounded exponential backoff. Only a definitive `401`/`403`
authentication rejection redirects to login. Diagnose resource pressure before changing credentials.
See `PRODUCTION_INCIDENT_2026-07-06.md`.

## Mandatory build-source rule

Before running `npm run build:data-schemas` in any builder cloned from a live/dev image, do one of the
following:

1. Synchronize the complete current `packages/data-schemas/src` tree from the source checkout; or
2. Build from a clean current source checkout rather than from the runtime image.

Copying only memory schema files is forbidden because rebuilding the package also recompiles session
and authentication methods. At minimum, `packages/data-schemas/src/methods/session.ts` must match the
source checkout, but complete subtree synchronization is the required default.

## Mandatory fail-closed gates

Run before staging artifacts:

```bash
npm run build:data-schemas
npm run test:refresh-token-runtime-contract
npm run verify:refresh-token-runtime-contract
npm run verify:auth-memory-runtime-contracts
```

For a containerized builder, run the live synthetic-token smoke before exporting artifacts:

```bash
./local-services/verify-refresh-token-runtime-contract.sh --container <builder-container>
```

Immediately before any production restart or client-dist swap:

```bash
ssh timeng@192.168.50.104 \
  'cd /opt/LibreChat-custom && \
   ./local-services/verify-refresh-token-runtime-contract.sh --container LibreChat && \
   ./local-services/verify-auth-memory-runtime-contracts.sh --container LibreChat'
```

Run the same commands after restart. A failure is a hard stop; do not rely on `/api/config` health.

## What the dedicated verifier checks

`local-services/verify-refresh-token-runtime-contract.sh` checks:

1. Source markers in `packages/data-schemas/src/methods/session.ts` when source exists.
2. Compiled markers in both `packages/data-schemas/dist/index.cjs` and `index.es.js`.
3. The deployed compiled CJS bundle when `--container` is supplied.
4. A synthetic in-memory call to `generateRefreshToken()` inside the target container.
5. Decoded `iss`, `aud`, `tokenType`, and `jti` values against the container environment.

The synthetic smoke uses a fake in-memory session object. It does not connect to MongoDB and does not
read or modify any user, password, TOTP secret, or session record.

The broader `verify-auth-memory-runtime-contracts.sh` invokes this dedicated verifier automatically.
Stable runtime-delta deployment, frontend promotion, stable startup, and health checks already invoke
the broader verifier.

## Deployment decision table

| Changed surface                        | Required action                                                                                    |
| -------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Auth controller only                   | Runtime delta plus both verifiers before/after restart                                             |
| `packages/data-schemas/src/**`         | Rebuild complete data-schemas dist from synchronized source; deploy complete dist                  |
| Memory schema plus session/auth source | Rebuild complete data-schemas dist; never deploy selected generated files                          |
| Frontend auth code                     | Full manifest-verified `client/dist`; both auth verifiers before and after swap                    |
| Dependencies/Dockerfile                | Cached image rebuild from current complete source; both auth verifiers in builder and live runtime |
| Builder cloned from production         | Synchronize complete affected source subtrees before any package build                             |

Before choosing any build, run `deploy-runtime-delta.sh --dry-run`. Auth controller/runtime JS changes do not require a package or Docker build. When a complete `packages/api` dist is required, production artifacts should normally be built with `LIBRECHAT_ROLLUP_SOURCEMAP=false` and `run-node-capped.sh --memory-max 12G --heap-mb 8192`; the current bundle can exceed a 4 GB heap even without source maps. External source maps are debugging artifacts and are not required by the deployed runtime. After a verified stable runtime delta, `librechat-local:runtime-current` becomes the durable recreation image, preventing a later compose recreate from reverting to stale auth/package code.

## Forbidden shortcuts

- Do not trust a successful package build as proof of auth correctness.
- Do not trust source tests without checking compiled output.
- Do not trust `/api/config`, container health, or the login password response alone.
- Do not copy only selected `data-schemas` source files into a builder and then rebuild the package.
- Do not export artifacts from a builder until the synthetic refresh-token smoke passes.
- Do not restart production while the named user conversation is active.
- Do not reset credentials to hide a refresh-token or cookie failure.

## Symptom-to-layer diagnosis

| Symptom                                                             | Most likely layer                                                                         |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Password immediately rejected                                       | Login validator, password hash, ban/rate-limit policy                                     |
| Password accepted, MFA page shown                                   | Password and initial account lookup succeeded                                             |
| Correct MFA returns to password page                                | Refresh token generation/verification, cookie path, or refresh endpoint                   |
| Logs show `jwt audience invalid. expected: librechat-refresh`       | Compiled `data-schemas` refresh generator is stale/broken                                 |
| Logs show Mongo monitor/selection timeout and refresh returns `503` | Temporary database/resource-pressure incident; pause benchmark and restore Mongo headroom |
| Restart alone logs users out                                        | Refresh retry/cookie/session contract or deployment-time session deletion                 |
| Administrator shows temporary ban page                              | Admin exemption in ban middleware/cache is missing                                        |

## Emergency recovery without credential changes

1. Stop further rebuilds and inspect live auth logs.
2. Confirm password login success and the exact refresh rejection.
3. Preserve the user row, password hash, TOTP fields, backup codes, and MongoDB sessions.
4. Restore or rebuild only the compatible `packages/data-schemas/dist` bundle.
5. Run the dedicated source/compiled verifier.
6. Stage the bundle and run the container synthetic-token smoke before restart.
7. Restart the API once, health-check, and run both deployed verifiers.
8. Ask the user to retry the existing password and current authenticator code.
9. Confirm the new login/refresh chain in logs.

## Required production evidence

A completed auth-affecting deployment must retain:

- Build/test output for `build:data-schemas`.
- `test:refresh-token-runtime-contract` pass output proving the guard accepts a complete fixture and rejects a broken compiled bundle.
- `verify:refresh-token-runtime-contract` pass output.
- `verify:auth-memory-runtime-contracts` pass output.
- Live synthetic-token pass output from `LibreChat`.
- A rollback snapshot path.
- Post-restart `/api/config` health.
- Confirmation that no password/TOTP/session reset occurred.

## Rollback

The safest rollback for this failure is the previous complete `packages/data-schemas/dist` snapshot,
not a password reset. Runtime-delta snapshots are stored under:

```text
/opt/LibreChat-custom/output/runtime-delta-deployments/<timestamp>-stable
```

Restore the complete dist directory, run the dedicated verifier against the staged container, then
restart once. Never mix individual generated CJS/ESM files from different builds.

Do not recreate from `librechat-local:latest` merely because the tag exists. Prefer the verified
`librechat-local:runtime-current` image or the deployment-recorded exact last-known-good image, and
verify the compiled auth contract before restart. A stale mutable tag can reintroduce both source/dist
skew and the authentication loop this runbook is designed to prevent.
