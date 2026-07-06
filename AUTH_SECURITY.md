# LibreChat Authentication Security

This fork secures local-password authentication with Tailscale HTTPS, mandatory TOTP MFA, short-lived access tokens, rotating server-backed refresh sessions, generic credential failures, rate limiting, and hardened browser headers.

## Production origin

Production runs on the LibreChat VM and is accessed through:

- HTTPS: `https://librechatvm.tail6e13ff.ts.net:8443`
- Internal upstream: `http://127.0.0.1:3080`
- Emergency LAN fallback: `http://192.168.50.104:3080`

Tailscale Serve terminates HTTPS on port `8443` and proxies to the local LibreChat port. Port `443` remains owned by the VM Nextcloud/Apache service. `FORCE_SECURE_COOKIES=true` ensures refresh, provider, OAuth, and pending-MFA cookies are emitted with `Secure` even though the container receives proxied HTTP.

`DOMAIN_CLIENT` and `DOMAIN_SERVER` use the HTTPS origin for ordinary LibreChat, OpenID Connect, SAML, and social-login callbacks. `MCP_OAUTH_CALLBACK_BASE_URL=http://localhost:3080` preserves the loopback callback exception required by Arcade/Microsoft MCP OAuth flows.

## MFA behavior

- Local-password accounts use RFC 6238 TOTP.
- QR enrollment works with Microsoft Authenticator, Google Authenticator, 1Password, Authy, and compatible TOTP applications.
- Ten single-use backup codes are generated and must be downloaded before enrollment completes.
- Password verification creates a five-minute `HttpOnly`, `Secure`, `SameSite=Strict` pending-MFA cookie scoped to `/api/auth/2fa`.
- Pending state never appears in URLs or persistent browser storage.
- Five invalid codes invalidate the pending sign-in; independent IP and normalized-email limiters control broad and distributed guessing.
- Enforced local accounts cannot disable MFA.
- OpenID Connect, Microsoft Entra ID, SAML, and other federated providers retain provider-native MFA. LibreChat does not apply a redundant local TOTP challenge to federated accounts.

Production policy:

```dotenv
MFA_ENFORCEMENT=all_local
MFA_MAX_ATTEMPTS=5
MFA_IP_MAX_ATTEMPTS=15
MFA_ATTEMPT_WINDOW=5
LOGIN_ACCOUNT_MAX=10
LOGIN_ACCOUNT_WINDOW=15
```

Existing local users are guided through enrollment immediately after the correct password and receive no long-lived session until setup succeeds.

## Token policy

```dotenv
SESSION_EXPIRY=1000 * 60 * 15
REFRESH_TOKEN_EXPIRY=1000 * 60 * 60 * 24 * 30
JWT_ISSUER=librechat
JWT_AUDIENCE=librechat-api
JWT_REFRESH_AUDIENCE=librechat-refresh
MFA_TOKEN_AUDIENCE=librechat-mfa
```

| Credential or challenge | Lifetime | Renewal behavior | Exposure and revocation |
| --- | --- | --- | --- |
| LibreChat access JWT | 15 minutes | A valid refresh session issues a new access JWT | Stateless bearer token; JWT-secret rotation invalidates all outstanding access JWTs |
| LibreChat refresh session | 30 days | The refresh token rotates on use, but the MongoDB session keeps its original absolute expiration; activity does not extend it indefinitely | Cookie is `HttpOnly`, `Secure`, and `SameSite=Lax`; the signed `sessionId`/`jti` resolves the persistent MongoDB session while a SHA-256 token hash is retained for legacy compatibility; logout, password reset, MFA reset, admin revocation, or session deletion invalidates it |
| Pending MFA challenge | 5 minutes | Never renewed; the user must restart password login after expiry or five failed verification attempts | Cookie is `HttpOnly`, `Secure`, `SameSite=Strict`, and scoped to `/api/auth/2fa` |
| Password reset and email-verification token | 15 minutes | One-time flow | Token record is TTL-backed in MongoDB; successful password reset revokes every refresh session |
| OAuth CSRF/session state | 10 minutes | One-time callback flow | Purpose-bound secure cookies; not an application login session |

The practical login experience is monthly: a local user can remain signed in for up to 30 days, while the browser silently exchanges the refresh session for a new 15-minute access JWT. A month-long access JWT is intentionally not used because a copied bearer token cannot be individually revoked and would remain immediately usable for the full month. The short access JWT plus month-long, server-revocable refresh session provides the requested monthly sign-in window without creating a month-long bearer-token exposure.

Routine API restarts, image rebuilds, and complete frontend promotions do not revoke refresh sessions. The browser preserves its React Query cache during silent refresh and retries transient network, proxy, rate-limit, and server failures with capped exponential backoff. It redirects to login only after a definitive authentication rejection or a successful refresh response that contains no usable token. This prevents a deployment-time `502`/`503` window from being mistaken for an expired login.

Users with the platform `ADMIN` role are exempt from automated violation bans. `checkBan` resolves the submitted login email before applying either user or source-IP bans and allows administrators to proceed to normal credential and MFA validation. `banViolation` also refuses to create an automated admin ban, clear admin authentication cookies, or revoke admin refresh sessions. Deliberate administrator suspension remains an explicit operator action rather than a side effect of model, tool, login, or request-limit counters.

Access tokens carry `tokenType=access`; refresh tokens carry `tokenType=refresh`, a matching session ID and JWT ID, issuer, and audience. Current refresh and Realtime-cookie validation resolve the signed persistent session ID instead of requiring the latest rotated token hash, so parallel browser refreshes after an API restart cannot invalidate each other. Refresh-token hashes remain stored for legacy-token fallback. Password reset revokes every active user session.

## Account policy

```dotenv
ALLOW_REGISTRATION=false
# The global AppSettings registrationEnabled override must also be false.
ALLOW_UNVERIFIED_EMAIL_LOGIN=false
MIN_PASSWORD_LENGTH=12
ALLOW_PASSWORD_RESET=false
```

The environment default and the persisted global `AppSettings.registrationEnabled` override are both disabled; the database override takes precedence when present. The minimum applies to registration and password reset. Existing passwords remain usable so users can authenticate and enroll MFA without an unplanned password migration. The login form must therefore validate only that a password is present and at most 128 characters; it must not apply `MIN_PASSWORD_LENGTH` client-side because that would block legacy accounts before the request reaches the server.

Invalid email, password, passwordless-provider, and unverified-email cases return the same external response. Nonexistent/passwordless users still execute a dummy bcrypt comparison to reduce timing-based enumeration. Submitted passwords are never written to validation logs.

## Recovery

Run only from the VM container after verifying the requested account owner:

```bash
docker exec -i LibreChat node /app/scripts/admin-reset-user-mfa.js user@example.com
```

This removes the account's TOTP secret and backup codes and revokes all of its sessions. With enforced MFA, the next successful password login requires enrollment again.

## Deployment and rollback

Source/build work occurs in `/pool/home/timeng/LibreChat-custom`; production mutations occur only on `timeng@192.168.50.104` in `/opt/LibreChat-custom` and container `LibreChat`.

Pre-change rollback artifacts for the 2026-06-30 hardening rollout:

- Local full-workspace synthetic commit: `refs/codex/snapshots/auth-hardening-full-20260630-145108`
- Local tracked snapshot: `refs/codex/snapshots/auth-hardening-20260630-145108`
- VM runtime/config archive: `/opt/LibreChat-custom/.rollback/auth-hardening-20260630-145220`

Rollback order:

1. Disable Tailscale Serve if HTTPS routing itself is at fault.
2. Restore the VM `.env`, compose files, source/dist runtime archive, and client dist from the VM rollback directory.
3. Restart only the `LibreChat` API container and verify `/api/config` and `/login`.
4. Restore source state from the synthetic commit in a clean worktree if code-level investigation is required.

## Validation checklist

- Wrong email and wrong password produce identical `401` responses.
- Local login redirects to `/login/2fa` without a token in the URL.
- First login shows a standard TOTP QR code and backup codes.
- Verification creates a normal session only after the correct code.
- Five invalid MFA codes force a new password login.
- Refresh cookies contain `Secure`, `HttpOnly`, and `SameSite=Lax`.
- The pending-MFA cookie contains `Secure`, `HttpOnly`, `SameSite=Strict`, and path `/api/auth/2fa`.
- Access JWT lifetime is 15 minutes; refresh session lifetime is 30 days.
- Logout and password reset revoke server-side sessions.
- OIDC/SAML/social-login callbacks use the HTTPS tailnet origin.
- MCP OAuth callbacks continue using the configured loopback callback base.

## Deployment safety runbook

`AUTH_DEPLOYMENT_SAFETY.md` is the mandatory operator runbook for auth/session/MFA/JWT package builds,
container builders, production restarts, failure diagnosis, and rollback. Its fail-closed checks take
precedence over generic health checks.

## 2026-07-05 authentication incident and preservation guard

A production MFA loop was caused by source/package skew, not by the administrator's password or TOTP secret. The browser completed `POST /api/auth/login` and `POST /api/auth/2fa/verify-temp`, but the immediately following `POST /api/auth/refresh` returned `403 Invalid refresh token`. The deployed `@librechat/data-schemas` bundle generated a legacy refresh JWT without the issuer, `librechat-refresh` audience, and `tokenType=refresh` claims that the current verifier required.

Recovery rules:

- Do not reset a password, rotate a TOTP secret, or delete sessions merely because the browser returns from MFA to the password page. Inspect the login, MFA verification, and refresh requests as one chain.
- Preserve the existing password hash exactly unless the account owner explicitly requests a password reset.
- Routine builds, restarts, runtime deltas, and frontend promotions must not delete MongoDB sessions. Session revocation is reserved for logout, password reset, MFA reset, an explicit administrator action, or a confirmed compromise.
- Deploy authentication controllers and `packages/data-schemas/dist` as a matched contract whenever refresh-token claims or verification rules change.
- Keep current refresh lookup session-ID based. Returning to hash-only lookup reintroduces a post-restart race where parallel refresh requests rotate the hash and force password/TOTP reauthentication.
- Administrators remain subject to password and MFA verification, but are exempt from automated violation bans. Deliberate administrator suspension is an explicit operator action.

Run the fail-closed contract check before any stable mutation and against the deployed container afterward:

```bash
npm run verify:auth-memory-runtime-contracts
ssh timeng@192.168.50.104 \
  'cd /opt/LibreChat-custom && ./local-services/verify-auth-memory-runtime-contracts.sh --container LibreChat'
```

The verifier checks refresh-token issuer/audience/type/JWT-ID parity in both source and the compiled `packages/data-schemas/dist/index.cjs`, pending-MFA refresh behavior, root-scoped stale-cookie cleanup, transient client refresh retries, administrator ban protection, absence of blanket deployment-time session deletion, and the compiled memory package exports that share the same source/dist deployment risk.

A July 6 recurrence proved that checking only the TypeScript source is insufficient. An isolated builder cloned the live container, whose package source was older than its previously hot-fixed compiled dist, and rebuilding `data-schemas` silently removed the refresh claims. Any builder based on a live image must receive `packages/data-schemas/src/methods/session.ts` or a complete synchronized source tree before building. The compiled-claim gate must pass before any restart or client-dist promotion.
