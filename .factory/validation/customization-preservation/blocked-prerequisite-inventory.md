# Blocked Assertion Prerequisite Inventory

Generated: 2026-04-06
Round: customization-preservation user-testing round 2
Source: synthesis.json (19 passed, 4 failed, 36 blocked)

This document maps each of the 36 blocked assertions to a **concrete missing prerequisite** and groups them into prerequisite clusters. Each cluster specifies whether it can be resolved locally or requires user action.

---

## Prerequisite Cluster Summary

| # | Cluster | Blocked Assertions | Locally Resolvable? | User Action Required? |
|---|---------|-------------------|---------------------|----------------------|
| 1 | **Temporary ban / rate-limit state** | 15 | ✅ Yes (reseed + restart) | No |
| 2 | **VAPID push keys not configured** | 1 | ✅ Yes (generate + append to .env) | Minimal (append 2 lines to .env + restart) |
| 3 | **Google credentials empty** (live Gemini, grounding, social login) | 6 | ❌ No | Yes — provide Google API key + CSE ID + OAuth client |
| 4 | **xAI user key not set** | 3 | ❌ No | Yes — user must save xAI API key via UI |
| 5 | **Azure credentials unavailable** | 3 | ❌ No | Yes — user must save Azure key/baseURL via UI |
| 6 | **MCP OAuth / Arcade domain blocked** | 4 | ⚠️ Partial | Yes — add Arcade domain to allowlist + provide Arcade API key |
| 7 | **Federated auth disabled** | 1 | ❌ No | Yes — configure at least one social login provider |
| 8 | **Ollama non-deterministic** | 3 | ⚠️ Environment | No (retry with stable models) |
| 9 | **SCHEDULED_RUNNER_ENABLED=false requires restart** | 1 | ⚠️ Disruptive | Deferred (requires shared dev restart) |
| 10 | **Notification payload URL not observable from API** | 1 | ❌ No | Deferred (requires inbox/SMS/push recipient access) |
| 11 | **SUPERADMIN_EMAILS container env resolution** | 1 | ✅ Yes (validator methodology fix) | No |
| 12 | **Reasoning model Thoughts stream** | 1 | ⚠️ Model-dependent | No (retry with reasoning-capable model) |

---

## Cluster 1: Temporary Ban / Rate-Limit State

**Root cause**: Validation probes (blocked-model enforcement, non-browser UA, rapid login attempts) triggered the app's anti-abuse system, causing `403 temporary-ban` responses on seeded validation personas. Bans are stored in MongoDB `logs`/`keyv` collections plus an in-memory `banCache`.

**Resolution**: Run `dev-seed-validation-personas.js` to clear ban/violation state, then `docker restart librechat-dev-api` to flush in-memory caches. This is fully locally resolvable.

**Blocked assertions** (15):
- VAL-MODEL-003 — blocked-model enforcement matrix (anti-abuse triggered during probes)
- VAL-FILES-001 — file-search upload + query cycle
- VAL-FILES-002 — context-mode OCR + image
- VAL-FILES-003 — native routing file bookkeeping
- VAL-FILES-004 — transcribe action + conversation creation
- VAL-FILES-005 — background transcription status lifecycle
- VAL-FILES-006 — diarization speaker reference upload
- VAL-FILES-008 — /c/new draft cleanup + appendable follow-up
- VAL-FILES-009 — in-flight deletion + follow-up job
- VAL-MCP-001 — bare no-input MCP schema callable check
- VAL-PROVIDER-002 — native OpenAI file flow
- VAL-CROSS-003 — cross-provider native tool + file metadata
- VAL-CROSS-004 — background transcription persistent workflow
- VAL-CROSS-005A — scheduled MCP/OAuth execution (partial — also needs OAuth MCP)

**Preparation steps** (no user secrets needed):
```bash
# 1. Reseed validation personas (clears bans, violations, rate limits)
cd /pool/home/timeng/LibreChat-custom
node local-services/dev-seed-validation-personas.js

# 2. Restart API to flush in-memory ban caches
docker restart librechat-dev-api

# 3. Wait for API to become healthy
sleep 25
curl -sf http://127.0.0.1:3081/ -o /dev/null && echo "API healthy"
```

**Mitigation for next run**: Validators should:
- Use browser-like User-Agent headers for API probes
- Limit blocked-model probes to 2-3 per session (not exhaustive matrix)
- Check for ban state before starting file/transcription assertions
- Reseed between assertion groups if bans are detected

---

## Cluster 2: VAPID Push Keys Not Configured

**Root cause**: `WEB_PUSH_VAPID_PUBLIC_KEY` and `WEB_PUSH_VAPID_PRIVATE_KEY` are not set in `.env`, causing `capabilities.push=false` in the notification settings API.

**Resolution**: Generate VAPID keys and append to `.env`. This is locally resolvable — keys can be generated with the already-installed `web-push` npm package.

**Blocked assertions** (1):
- VAL-SCHED-009 — browser push subscription lifecycle, delivery, click behavior

**Preparation steps**:
```bash
# Generate VAPID keys and append to .env
cd /pool/home/timeng/LibreChat-custom
node -e "
const webpush = require('web-push');
const keys = webpush.generateVAPIDKeys();
console.log('WEB_PUSH_VAPID_PUBLIC_KEY=' + keys.publicKey);
console.log('WEB_PUSH_VAPID_PRIVATE_KEY=' + keys.privateKey);
" >> .env

# Restart dev API to pick up new keys
docker restart librechat-dev-api
sleep 25

# Verify push is now enabled
# (login, then GET /api/schedules/notifications -> capabilities.push should be true)
```

**Note**: VAPID keys are not secret credentials — they are a locally-generated asymmetric key pair for the Web Push protocol. They do not require external service registration.

---

## Cluster 3: Google Credentials Empty

**Root cause**: The `.env` file has `GOOGLE_KEY=<value>` (len=39, likely an API key) but `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CSE_ID`, and `GOOGLE_SEARCH_API_KEY` are empty strings. This blocks:
- Live Gemini model discovery (requires valid API key that resolves to a GCP project)
- Grounded Gemini citations (requires a working Gemini chat session)
- Google social login (requires OAuth client ID/secret)

**Resolution**: Requires user-provided Google credentials.

**Blocked assertions** (6):
- VAL-PROVIDER-003 — Gemini native tool routing gates
- VAL-PROVIDER-004 — Google live discovery + capability metadata
- VAL-PROVIDER-005 — Gemini grounding inline citations
- VAL-MODEL-001 — federated auth path for default model allowlist (partial — also needs Cluster 7)
- VAL-CROSS-001 — registration gating + superadmin sync alignment (partial — SUPERADMIN_EMAILS works)
- VAL-FILES-007 — code interpreter Azure+Google model-chat turn coverage (partial)

**User action required**:
1. **For Gemini assertions (VAL-PROVIDER-003/004/005)**: Ensure `GOOGLE_KEY` in `.env` is a valid Gemini API key that can call `generativelanguage.googleapis.com`. If the current key (len=39) is valid, these should work after a dev restart. If it's a placeholder, replace it with a real key.
2. **For Google social login (VAL-MODEL-001 federated path)**: Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to valid Google OAuth 2.0 client credentials, and set `ALLOW_SOCIAL_LOGIN=true` or equivalent in `.env`.

---

## Cluster 4: xAI User Key Not Set

**Root cause**: The xAI custom endpoint is configured with `apiKey: user_provided`, meaning users must save their own xAI API key via the UI settings dialog. No `XAI_API_KEY` env var exists. Validation personas don't have a saved xAI key.

**Resolution**: Requires a real xAI API key.

**Blocked assertions** (3):
- VAL-PROVIDER-007 — xAI live model refresh + alias verification (partial — auto-detection works)
- VAL-PROVIDER-008 — xAI runtime parameter sanitization
- VAL-PROVIDER-008A — xAI native web search strip behavior

**User action required**:
1. Obtain an xAI API key from `console.x.ai`
2. Log in as `val-superadmin@dev.local` on dev rail (http://127.0.0.1:3081)
3. Open xAI provider settings and save the API key
4. Rerun the provider-advanced validation group

---

## Cluster 5: Azure Credentials Unavailable

**Root cause**: Azure is configured with `AZURE_API_KEY=user_provided` and `AZURE_OPENAI_BASEURL=user_provided`. No system-level Azure credentials exist. Validation personas don't have saved Azure credentials.

**Resolution**: Requires a real Azure OpenAI resource.

**Blocked assertions** (3):
- VAL-PROVIDER-001 — Azure chat-bar native tool routing (OpenAI portion passed)
- VAL-PROVIDER-001A — legacy non-/openai/v1 api-version branch
- VAL-REALTIME-002 — Azure direct realtime session-start branch

**User action required**:
1. Provision an Azure OpenAI resource with supported models (GPT-4o, etc.)
2. Log in as `val-superadmin@dev.local` on dev rail
3. Open Azure provider settings and save the API key + base URL
4. Rerun the provider-core validation group

---

## Cluster 6: MCP OAuth / Arcade Domain Blocked

**Root cause**: The `mcpSettings.allowedDomains` in `librechat.yaml` only permits two local servers (`http://192.168.50.4:8765` and `http://192.168.50.4:8766`). Arcade's MCP endpoint (`api.arcade.dev`) is not in the allowlist. Additionally, no OAuth-capable MCP server is configured or authorized.

**Resolution**: Partially locally resolvable — the domain allowlist can be updated in `librechat.yaml`, but an actual Arcade API key and OAuth flow require external setup.

**Blocked assertions** (4):
- VAL-MCP-002 — OAuth refresh with protected-resource authorization server metadata
- VAL-MCP-003 — OAuth callback URL precedence rules
- VAL-MCP-004 — Arcade provider-consent prompts surfaced as auth continuation
- VAL-CROSS-005A — scheduled MCP/OAuth execution (also needs Cluster 1 ban clearing)

**User action required**:
1. Add `https://api.arcade.dev` to `mcpSettings.allowedDomains` in `librechat.yaml`
2. Obtain an Arcade API key and configure an Arcade-hosted Microsoft tools MCP server
3. Complete the OAuth consent flow for at least one Arcade tool
4. Restart dev API to pick up config changes

**Locally preparable**: The `librechat.yaml` domain allowlist update can be documented as a ready-to-apply patch, but modifying it is a runtime config change that should be user-approved.

---

## Cluster 7: Federated Auth Disabled

**Root cause**: All social/federated login providers are disabled in the dev config (`socialLoginEnabled: false`, all provider-specific flags false). This prevents testing the federated/auto-provisioned auth path for VAL-MODEL-001.

**Resolution**: Requires at least one federated login provider to be configured (Google OAuth, GitHub, Discord, etc.).

**Blocked assertions** (1):
- VAL-MODEL-001 — federated auth path for default model allowlist (local registration path already testable)

**User action required**:
1. Configure at least one social login provider (e.g., Google OAuth with `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`)
2. Set `ALLOW_SOCIAL_LOGIN=true` in `.env`
3. Restart dev API

---

## Cluster 8: Ollama Non-Deterministic

**Root cause**: Ollama-hosted model responses are slow or non-completing in the dev environment, preventing verification of web-search behavior, reasoning off-switch, and multi-source origin resolution. The remote Ollama host at `192.168.50.201:11434` is reachable and has 14 models loaded.

**Resolution**: Retry with known-stable models and explicit timeouts. No external prerequisites needed.

**Blocked assertions** (3):
- VAL-PROVIDER-009 — Ollama multi-source discovery + per-model origin resolution
- VAL-PROVIDER-010 — Ollama hosted web search native-default + MCP mode
- VAL-PROVIDER-011 — Ollama reasoning `none` off-switch

**Preparation for next run**:
- Use `qwen2.5:latest` or `gemma3:latest` for basic Ollama tests (faster inference)
- Use `deepseek-r1:14b` for reasoning mode tests
- Set explicit timeouts in the validation flow
- VAL-PROVIDER-009 per-model origin metadata is not exposed on the user API surface; consider adding a backend integration test to cover this contract

---

## Cluster 9: SCHEDULED_RUNNER_ENABLED=false Branch

**Root cause**: Testing the `SCHEDULED_RUNNER_ENABLED=false` code path requires changing the dev API environment and restarting the container, which is disruptive to the shared dev rail and other concurrent validation.

**Resolution**: Can be done locally but requires a coordinated dev restart window.

**Blocked assertions** (1):
- VAL-SCHED-006 — runner-disabled branch (runner-enabled behavior already validated)

**Preparation**: The enabled/disabled/manual behavior has already been validated for the runner-enabled case. The `false` branch can be tested in an isolated restart window:
```bash
# In a coordinated window:
docker exec librechat-dev-api sh -c 'export SCHEDULED_RUNNER_ENABLED=false'
# (requires container env override or .env edit + restart)
```

---

## Cluster 10: Notification Payload URL Not Observable

**Root cause**: The `DOMAIN_CLIENT`-rooted `/c/<conversationId>` URL in delivered notification payloads cannot be verified from API-only evidence — it requires actual email inbox, SMS recipient, or browser push notification inspection.

**Resolution**: Deferred — requires recipient-side observation.

**Blocked assertions** (1):
- VAL-SCHED-008 — notification payload URL-root check (channel-level statuses already validated)

**User action**: Verify delivered notification content manually when email or push is configured.

---

## Cluster 11: SUPERADMIN_EMAILS Container Env Resolution

**Root cause**: Previous validation attempted `printenv SUPERADMIN_EMAILS` inside the container, which returned empty because Docker Compose env_file doesn't export all vars to the shell environment. However, the app correctly loads `SUPERADMIN_EMAILS` via `dotenv` from `/app/.env` — confirmed: 3 email addresses, len=65.

**Resolution**: ✅ Already resolved — this was a validator methodology issue, not a real prerequisite gap. The next validator run should use `node -e "require('dotenv').config({path:'/app/.env'}); ..."` to check env vars instead of `printenv`.

**Blocked assertions** (1):
- VAL-CROSS-001 — superadmin allowlist-driven auto-promotion source verification

**No user action required.** The validator should use the correct env-reading method.

---

## Cluster 12: Reasoning Model Thoughts Stream

**Root cause**: No reasoning Thoughts stream appeared during tested prompts/models, so the chunk-merge rendering behavior could not be exercised. This depends on using a reasoning-capable model (e.g., OpenAI o1/o3, or an Ollama model with reasoning output).

**Resolution**: Retry with a known reasoning model. No external prerequisites needed beyond what's already configured.

**Blocked assertions** (1):
- VAL-REALTIME-005 — reasoning chunk merge behavior (source-link behavior already observed)

**Preparation for next run**:
- Use an OpenAI reasoning model (o1, o3-mini, o4-mini) if available
- Or use `deepseek-r1:14b` via Ollama for reasoning output
- Ensure prompt explicitly requests step-by-step reasoning

---

## Action Matrix for Next Validation Run

### Locally Resolvable (do before next run):
1. ✅ **Clear temp bans**: `node local-services/dev-seed-validation-personas.js && docker restart librechat-dev-api`
2. ✅ **Generate VAPID keys**: Append to `.env`, restart API (see Cluster 2)
3. ✅ **Fix validator env-reading**: Use dotenv-based env check for SUPERADMIN_EMAILS
4. ✅ **Retry Ollama with stable models**: Use qwen2.5/gemma3 for basic tests, deepseek-r1 for reasoning
5. ✅ **Retry reasoning with appropriate model**: Use deepseek-r1:14b or OpenAI o-series

### Requires User Action:
6. ❌ **Google credentials**: Provide valid Gemini API key, Google OAuth client ID/secret, CSE ID
7. ❌ **xAI API key**: Save via UI provider settings on dev rail
8. ❌ **Azure credentials**: Save Azure OpenAI key + base URL via UI on dev rail
9. ❌ **MCP OAuth/Arcade**: Add Arcade domain to allowlist, provide Arcade API key, complete OAuth consent
10. ❌ **Federated auth**: Configure at least one social login provider
11. ⚠️ **SCHEDULED_RUNNER_ENABLED=false**: Requires coordinated dev restart window
12. ⚠️ **Notification payload URL**: Requires recipient-side inbox/push observation

### Expected Assertion Yield After Local Prep Only:
- **Temp ban clearing** (Cluster 1): Up to 15 assertions unblocked
- **VAPID provisioning** (Cluster 2): 1 assertion unblocked
- **Validator methodology fix** (Cluster 11): 1 assertion unblocked
- **Ollama retry** (Cluster 8): Up to 3 assertions unblocked
- **Reasoning retry** (Cluster 12): 1 assertion unblocked
- **Total potential**: Up to 21 of 36 blocked assertions could be retried without any user-provided secrets

### Remaining Blockers Requiring External Input:
- **Google credentials**: 6 assertions (some overlap with federated auth cluster)
- **xAI key**: 3 assertions
- **Azure credentials**: 3 assertions
- **MCP OAuth/Arcade**: 4 assertions
- **Federated auth**: 1 assertion
- **Coordinated restart**: 1 assertion
- **Recipient observation**: 1 assertion
