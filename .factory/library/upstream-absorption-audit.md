# Upstream Absorption Audit — LibreChat-custom vs upstream/main

**Audit date:** 2026-04-05
**Merge base:** `cbdc6f606057296aa2a92eaf7636347757432849`
**Custom branch:** `engt21/local-customizations` @ `4290577a9` (v0.8.3 base + 57 custom commits)
**Upstream ref:** `upstream/main` @ `6ecd1b510` (v0.8.4 + 129 commits ahead of merge base)

## Summary

| Metric | Count |
|--------|-------|
| Upstream-only commits since merge base | 129 |
| Custom-only commits since merge base | 57 |
| Files changed only by upstream | 934 |
| Files changed only by custom | 349 |
| Files changed by both (conflict zone) | 114 |
| Upstream security/bug fixes | ~66 |
| Upstream new features | ~18 |
| Upstream refactors | ~21 |
| Upstream chores/ci/docs/i18n | ~33 |

---

## Classification Key

- **ABSORBED** — The upstream fix is already present in custom, or the custom branch independently implements equivalent protection.
- **MISSING** — The upstream fix is NOT present in custom; the relevant code path uses the pre-fix version.
- **INTENTIONALLY DIVERGENT** — Custom branch deliberately differs from upstream for a preserved customization; the upstream change conflicts with custom behavior.
- **NOT APPLICABLE** — The upstream change targets infrastructure/code that custom doesn't use or that is superseded by custom architecture.
- **PARTIALLY ABSORBED** — Some aspects of the fix are present, but the full fix is not.

---

## CATEGORY 1: Security & Safety Fixes (HIGH PRIORITY)

### 1.1 MISSING — Code-Server HTTP Agent Socket Isolation (#12311)
- **Commit:** `39f5f83a8`
- **Risk:** Socket pool contamination between code-server and other HTTP requests
- **Files:** `api/server/services/Files/Code/process.js`, `api/server/services/Files/Code/crud.js`, `packages/api/src/utils/code.ts`
- **Evidence:** Custom branch's `process.js` lacks `httpAgent`/`httpsAgent` isolation; upstream adds dedicated agents
- **Action needed:** Cherry-pick or port the isolated HTTP agent pattern

### 1.2 MISSING — MCP Domain Validation Fail-Closed (#12245)
- **Commit:** `07d0ce4ce`
- **Risk:** Unparseable URLs could bypass domain allowlist when active
- **Files:** `packages/api/src/auth/domain.ts`
- **Evidence:** Custom lacks fail-closed catch blocks and SSRF hostname validation visible in upstream
- **Action needed:** Port the fail-closed domain validation and URL-parse catch paths

### 1.3 MISSING — IPv6 Link-Local Range Coverage (#12244)
- **Commit:** `a0b4949a0`
- **Risk:** Incomplete fe80::/10 link-local blocking in IPv6 check
- **Files:** `packages/api/src/auth/domain.ts`
- **Evidence:** Custom's domain.ts doesn't contain full fe80::/10 range coverage
- **Action needed:** Port the IPv6 range fix alongside #12245

### 1.4 MISSING — Base URL Validation in Endpoint Init (#12248)
- **Commit:** `f7ab5e645`
- **Risk:** User-provided base URLs could be SSRF vectors
- **Files:** `packages/api/src/endpoints/openai/initialize.ts`, `packages/api/src/endpoints/custom/initialize.ts`, `packages/api/src/auth/domain.ts`
- **Evidence:** Custom lacks `validateBaseURL`/`throwInvalidBaseURL` patterns
- **Action needed:** Port base URL validation into endpoint initialization

### 1.5 MISSING — Web Search URL Validation (#12247)
- **Commit:** `1312cd757`
- **Risk:** User-provided web search URLs could target SSRF endpoints
- **Files:** `packages/api/src/web/web.ts`
- **Evidence:** Custom's web.ts lacks `isSSRFTarget`/`resolveHostnameSSRF` imports and URL validation
- **Action needed:** Port SSRF validation for web search URLs

### 1.6 MISSING — Markdown Artifact Sanitization (#12249)
- **Commit:** `f9927f016`
- **Risk:** XSS via unsanitized markdown in artifacts
- **Files:** `client/src/utils/artifacts.ts`, `client/src/utils/markdown.ts`
- **Evidence:** Custom still uses `react-ts` renderer for markdown types; upstream switches to `static`
- **Action needed:** Port the static renderer switch for markdown artifacts

### 1.7 MISSING — React Markdown Artifact Renderer → Static HTML (#12337)
- **Commit:** `b66f7914a`
- **Risk:** XSS and rendering security through React markdown
- **Files:** Multiple client artifact/markdown files
- **Evidence:** Custom lacks this renderer migration
- **Action needed:** Port alongside #12249

### 1.8 MISSING — Enforce File Count and Size Limits (#12239)
- **Commit:** `e079fc490`
- **Risk:** Bypassing file attachment limits through alternative paths
- **Files:** `client/src/utils/files.ts`, `client/src/components/SidePanel/Files/PanelTable.tsx`
- **Evidence:** Limited matching patterns in custom
- **Action needed:** Port the file limit enforcement

### 1.9 MISSING — ODT ZIP Metadata Hardening (#12320)
- **Commit:** `e44298436`
- **Risk:** Falsified ZIP metadata in ODT files could cause path traversal
- **Files:** `packages/api/src/files/documents/crud.ts`, `packages/api/package.json`
- **Evidence:** Custom lacks `validateZipEntry` patterns in document crud
- **Action needed:** Port ODT parsing hardening

### 1.10 MISSING — IPv6 Rate Limiter Key Collisions (#12319)
- **Commit:** `ecd6d76bc`
- **Risk:** IPv6 key collisions in rate limiters allowing bypass
- **Files:** All `api/server/middleware/limiters/*`, `api/server/utils/removePorts.js`, `packages/api/src/utils/ports.ts`
- **Evidence:** Custom has 2 normalizeIP references but upstream has comprehensive port normalization (`ports.ts` doesn't exist in custom)
- **Action needed:** Port the comprehensive IPv6 rate limiter fix

### 1.11 MISSING — Env Variable Exfiltration via Placeholder Injection (#12260)
- **Commit:** `951d261f5`
- **Risk:** Server env variable leakage through crafted placeholder strings
- **Files:** `packages/api/src/utils/env.ts`
- **Evidence:** Custom has the same placeholder patterns but upstream adds additional sanitization
- **Action needed:** Verify exact diff; likely needs porting

### 1.12 MISSING — OpenID Email Fallback Rejection (#12312)
- **Commit:** `11ab5f6ee`
- **Risk:** OpenID identity spoofing when stored openidId mismatches token sub
- **Files:** `packages/api/src/auth/openid.ts`, `api/strategies/openidStrategy.spec.js`
- **Evidence:** Custom's openid auth doesn't contain mismatch rejection logic
- **Action needed:** Port the identity mismatch rejection

### 1.13 MISSING — Federated Token Removal from OpenID Refresh (#12264)
- **Commit:** `d17ac8f06`
- **Risk:** Federated tokens leaked in OpenID refresh responses
- **Files:** `api/server/controllers/AuthController.js`
- **Evidence:** Custom doesn't touch AuthController for this fix
- **Action needed:** Port federated token stripping

### 1.14 MISSING — Conversation Ownership Checks in Remote Agent Controllers (#12263)
- **Commit:** `381ed8539`
- **Risk:** Cross-user conversation access via remote agent controllers
- **Files:** `api/server/controllers/agents/openai.js`, `api/server/controllers/agents/responses.js`
- **Evidence:** Custom's `responses.js` was modified but may lack ownership checks
- **Action needed:** Verify and port ownership enforcement

### 1.15 MISSING — MCP Server Authorization on Agent Tool Persistence (#12250)
- **Commit:** `a26eeea59`
- **Risk:** Unauthorized MCP tools persisted on agents
- **Files:** `api/server/controllers/agents/v1.js`
- **Evidence:** Custom has a smaller v1.js (863 lines vs 989 upstream)
- **Action needed:** Port the authorization check

### 1.16 MISSING — Agent-Author File Access Scoping (#12251)
- **Commit:** `ad08df4db`
- **Risk:** Agent author gaining access to files beyond attachments
- **Files:** `api/server/services/Files/permissions.js`
- **Evidence:** Custom's permissions.js exists but may lack scoping
- **Action needed:** Port the file access scoping

### 1.17 MISSING — Agent Edge Reference ACL Enforcement (#12246)
- **Commit:** `bcf45519b`
- **Risk:** Unauthorized agent edge reference access at write and runtime
- **Files:** `api/server/controllers/agents/v1.js`, `packages/api/src/agents/edges.ts`
- **Evidence:** Custom v1.js is smaller; edges.ts may lack ACL checks
- **Action needed:** Port the ACL enforcement

### 1.18 MISSING — MULTI_CONVO and Agent ACL on addedConvo (#12243)
- **Commit:** `8dc6d6075`
- **Risk:** Cross-agent conversation injection
- **Files:** `api/models/loadAddedAgent.js`, `api/server/middleware/accessResources/canAccessAgentFromBody.js`
- **Evidence:** Custom has loadAddedAgent.js but middleware may lack the check
- **Action needed:** Port the ACL check

### 1.19 MISSING — Agent Access Control on Context/OCR File Loading (#12253)
- **Commit:** `8e8fb01d1`
- **Risk:** Unauthorized context/OCR file access through agents
- **Files:** `api/server/controllers/agents/client.js`, multiple service files
- **Evidence:** Custom client.js modified but upstream adds access control
- **Action needed:** Port access control enforcement

### 1.20 MISSING — Actions Capability Gate Enforcement (#12252)
- **Commit:** `6f87b49df`
- **Risk:** Tool loading bypassing actions capability gate
- **Files:** `api/server/services/ToolService.js`, `api/server/controllers/agents/openai.js`
- **Evidence:** Custom ToolService.js modified but may lack this gate
- **Action needed:** Port capability gate enforcement

### 1.21 MISSING — Origin Binding for Admin OAuth Exchange (#12469)
- **Commit:** `2bf0f892d`
- **Risk:** OAuth exchange code replay from different origins
- **Files:** `api/server/controllers/auth/oauth.js`, `api/server/routes/admin/auth.js`
- **Evidence:** Custom oauth.js modified but may lack origin binding
- **Action needed:** Port origin binding

### 1.22 MISSING — Permanent Ban Cache / Expired Ban Cleanup (#12324)
- **Commit:** `54fc9c2c9`
- **Risk:** Ban cache bugs allowing banned users access or permanent false bans
- **Files:** `api/server/middleware/checkBan.js`
- **Evidence:** Custom hasn't touched checkBan.js
- **Action needed:** Port the ban cache fix

### 1.23 MISSING — OpenID Token URL Oversized logout_hint (#12326)
- **Commit:** `96f6976e0`
- **Risk:** Login failures from oversized OpenID token URLs
- **Files:** `api/server/controllers/auth/LogoutController.js`
- **Evidence:** Custom hasn't touched LogoutController
- **Action needed:** Port the fallback

### 1.24 MISSING — Rate Limiter IPv6 False Positive (#12333)
- **Commit:** `594d9470d`
- **Risk:** Legitimate users blocked by IPv6 false positives
- **Files:** `packages/api/src/utils/ports.ts`
- **Evidence:** `ports.ts` doesn't exist in custom
- **Action needed:** Port alongside #12319

### 1.25 MISSING — Azure AD Group Overage OBO Token Exchange (#12187)
- **Commit:** `aee1ced81`
- **Risk:** OpenID auth failure when Azure AD group count exceeds token capacity
- **Files:** Multiple OpenID and auth files
- **Evidence:** Not visible in custom branch
- **Action needed:** Port the OBO token exchange support

### 1.26 MISSING — SSE Resume Buffered Event Duplication (#12225)
- **Commit:** `7bc793b18`
- **Risk:** Duplicate events on SSE reconnection
- **Files:** `api/server/routes/agents/index.js`, `client/src/hooks/SSE/useResumableSSE.ts`, `packages/api/src/stream/GenerationJobManager.ts`
- **Evidence:** Custom has GenerationJobManager but may lack dedup logic
- **Action needed:** Port the dedup fix

### 1.27 MISSING — MCP OAuth Detection in Tool-Call Flow (#12418)
- **Commit:** `8e2721011`
- **Risk:** MCP tools failing OAuth detection during tool-call flow
- **Files:** Various MCP files
- **Evidence:** Upstream adds robust detection; custom MCP wiring is different
- **Action needed:** Evaluate and port if applicable

### 1.28 MISSING — Respect fileConfig.disabled for Agents Upload (#12238)
- **Commit:** `93a628d7a`
- **Risk:** Upload button shown when file uploads are disabled
- **Files:** `client/src/components/Chat/Input/Files/AttachFileChat.tsx`
- **Evidence:** Custom hasn't touched this file
- **Action needed:** Port the disabled check

### 1.29 MISSING — Action Domain Encoding Collision (#12271)
- **Commit:** `9a64791e3`
- **Risk:** HTTPS URL encoding collisions in action domains
- **Files:** Various action files
- **Evidence:** Not in custom
- **Action needed:** Port the fix

### 1.30 MISSING — MCP Refresh Token on OAuth Discovery Failure (#12266)
- **Commit:** `c68066a63`
- **Risk:** Token refresh failure when OAuth discovery fails
- **Files:** MCP/OAuth files
- **Evidence:** Custom has custom MCP OAuth behavior but may lack this fix
- **Action needed:** Port if applicable to custom MCP wiring

### 1.31 MISSING — People Picker Access Query Validation (#12276)
- **Commit:** `2f09d29c7`
- **Risk:** Query parameter injection in people picker
- **Files:** `api/server/middleware/checkPeoplePickerAccess.js`
- **Evidence:** Not touched by custom
- **Action needed:** Port the validation

### 1.32 MISSING — Pre-Parse File Size Guard (#12275)
- **Commit:** `68435cdcd`
- **Risk:** Large file DoS before parsing
- **Files:** Document parser files
- **Evidence:** Not in custom
- **Action needed:** Port the guard

### 1.33 MISSING — ChatGPT Import Cyclic Parent Graph (#12313)
- **Commit:** `f38039040`
- **Risk:** Infinite loop on cyclic ChatGPT conversation import
- **Files:** Import-related files
- **Evidence:** Not in custom
- **Action needed:** Port the cycle prevention

### 1.34 MISSING — Agent Revoked from Favorites (#12296)
- **Commit:** `93952f06b`
- **Risk:** Revoked agents stuck in user favorites
- **Files:** Agent management files
- **Evidence:** Not in custom
- **Action needed:** Port the cleanup

### 1.35 MISSING — ACL-Safe User Account Deletion (#12314)
- **Commit:** `1ecff83b2`
- **Risk:** Incomplete cleanup of agents/prompts/MCP on user deletion
- **Files:** Multiple model and controller files
- **Evidence:** Custom has deletion tests but may lack full ACL cleanup
- **Action needed:** Port the ACL-safe deletion

### 1.36 MISSING — Scope Action Mutations by Parent Resource Ownership (#12237)
- **Commit:** `0c27ad2d5`
- **Risk:** Action mutations not scoped to parent resource
- **Files:** `api/models/Action.js`, `api/server/controllers/agents/v1.js`, route files
- **Evidence:** Not in custom
- **Action needed:** Port the scoping

### 1.37 MISSING — Cross-Replica Created Event Delivery (#12231)
- **Commit:** `a01959b3d`
- **Risk:** Events lost in multi-replica deployments
- **Files:** Event delivery files
- **Evidence:** Not applicable to single-instance deploy, but still should be ported
- **Action needed:** Port for completeness

---

## CATEGORY 2: Bug Fixes (MEDIUM PRIORITY)

### 2.1 MISSING — Auth-Aware Startup Config Caching (#12505)
- **Commit:** `7b368916d`
- **Files:** Config caching files
- **Status:** MISSING — fresh sessions may get stale config

### 2.2 MISSING — Message Icon Flickering (#12489)
- **Commit:** `7181174c3`
- **Status:** MISSING — UI rendering issue

### 2.3 MISSING — Lazy-Initialize Balance Record (#12474)
- **Commit:** `fd01dfc08`
- **Status:** MISSING — balance initialization edge case

### 2.4 MISSING — Safe Hook Fallbacks for Tool-Call Search Route (#12423)
- **Commit:** `083042e56`
- **Status:** MISSING — hook crash on search route

### 2.5 MISSING — Message Cache Invalidation on Stream 404 (#12411)
- **Commit:** `df82f2e9b`
- **Status:** MISSING — error shown instead of invalidation

### 2.6 MISSING — Snapshot Options to Prevent Client Disposal Crash (#12398)
- **Commit:** `f277b3203`
- **Status:** MISSING — mid-await crash

### 2.7 MISSING — User-Provided API Key in Agents Flow (#12390)
- **Commit:** `abaf9b3e1`
- **Status:** MISSING — API key resolution in agent flow

### 2.8 MISSING — MeiliSearch Startup Sync Failure (#12397)
- **Commit:** `6466483ae`
- **Status:** MISSING — model loading order

### 2.9 MISSING — MCP Tool Misclassification (#12512)
- **Commit:** `275af4859`
- **Status:** MISSING — action delimiter collision

### 2.10 MISSING — Sandpack ExternalResources (#12509)
- **Commit:** `611a1ef5d`
- **Status:** MISSING — artifact previews

### 2.11 MISSING — recursionLimit for OpenAI-Compatible Agents (#12510)
- **Commit:** `cb41ba14b`
- **Status:** MISSING — recursion limit passthrough

### 2.12 MISSING — Route Unrecognized File Types (#12508)
- **Commit:** `6ecd1b510`
- **Status:** MISSING — file type routing via config

### 2.13 MISSING — Proper MCP Menu Dismissal (#12256)
- **Commit:** `5b31bb720`
- **Status:** MISSING — UI behavior

### 2.14 MISSING — ModelSpec Display Fields on Agent Share Link (#12274)
- **Commit:** `0c378811f`
- **Status:** MISSING — navigation display cleanup

### 2.15 MISSING — Permission Defaults for USER Role (#12308)
- **Commit:** `b18997238`
- **Status:** MISSING — explicit role defaults

### 2.16 MISSING — ToolMessage Response Format for Agent Image Tools (#12310)
- **Commit:** `a88bfae4d`
- **Status:** MISSING — image tool response format

### 2.17 MISSING — Exclude Unnecessary Conversation $unset Fields (#12501)
- **Commit:** `c4b5dedb7`
- **Status:** MISSING — data cleanup

### 2.18 MISSING — Strip Unnecessary Fields in Conversation/Message Writes (#12498)
- **Commit:** `5e789f589`
- **Status:** MISSING — field stripping in write paths

### 2.19 MISSING — MCP Queries Behind USE Permission (#12345)
- **Commit:** `01f19b503`
- **Status:** MISSING — 403 spam prevention

### 2.20 MISSING — Clear Drafts on Expired SSE Stream (#12309)
- **Commit:** `9cb5ac63f`
- **Status:** MISSING — draft cleanup

---

## CATEGORY 3: Major Upstream Architecture Changes (NOT YET ABSORBED)

These represent significant upstream refactoring that touches many files and introduces new subsystems. They cannot be cherry-picked individually and require careful reconciliation during the merge.

### 3.1 Multi-Tenant Data Isolation Infrastructure (#12091)
- **Commit:** `e4e468840`
- **Status:** NOT ABSORBED — introduces tenant isolation across all DB operations
- **Impact:** Foundational; many subsequent features depend on this

### 3.2 DB Model Consolidation into data-schemas (#11830)
- **Commit:** `8ba2bde5c`
- **Status:** NOT ABSORBED — moves Mongoose models from `api/models/` to `packages/data-schemas/`
- **Impact:** Very large refactor; 200+ files affected

### 3.3 System Grants for Capability-Based Authorization (#11896)
- **Commit:** `9e0592a23`
- **Status:** NOT ABSORBED — new authorization system
- **Impact:** Foundation for RBAC overhaul

### 3.4 DB-Backed Per-Principal Config System (#12354)
- **Commit:** `4b6d68b3b`
- **Status:** NOT ABSORBED — replaces env-based config with DB-backed per-principal config

### 3.5 ALS Context Middleware and Tenant Threading (#12407)
- **Commit:** `9f6d8c6e9`
- **Status:** NOT ABSORBED — async local storage for tenant context

### 3.6 Admin Roles/Groups/Users/Grants API (#12400, #12387, #12446, #12438)
- **Commits:** `5972a2147`, `2e3d66cfe`, `3d1b883e9`, `a4a17ac77`
- **Status:** NOT ABSORBED — new admin API endpoints (roles, groups, users, grants)
- **Files missing:** `api/server/routes/admin/{groups,users,roles,grants}.js`, `packages/api/src/admin/`

### 3.7 3-Tier MCP Server Architecture (#12435)
- **Commit:** `935288f84`
- **Status:** NOT ABSORBED — MCP server architecture overhaul

### 3.8 Tenant-Scoped App Config in Auth Login Flows (#12434)
- **Commit:** `77712c825`
- **Status:** NOT ABSORBED — tenant-scoped config in auth

### 3.9 Config Route Split (Authed/Unauthed) (#12490)
- **Commit:** `2e706ebcb`
- **Status:** NOT ABSORBED — config route refactoring

### 3.10 Config Schema Tightening (#12452)
- **Commit:** `0d94881c2`
- **Status:** NOT ABSORBED — removes deprecated fields

### 3.11 Config Services Migration to TypeScript (#12466)
- **Commit:** `fda72ac62`
- **Status:** NOT ABSORBED — major TypeScript migration

### 3.12 FerretDB Compatibility + Project Model Removal (#11769, #11773)
- **Commits:** `38521381f`, `58f128bee`
- **Status:** NOT ABSORBED — custom still has `api/models/Project.js`

### 3.13 S3 Storage TypeScript Migration (#11947)
- **Commit:** `a0fed6173`
- **Status:** NOT ABSORBED

### 3.14 Agent Context Compaction/Summarization (#12287)
- **Commit:** `b5c097e5c`
- **Status:** NOT ABSORBED — new agent feature

### 3.15 Sidebar Redesign (#12013)
- **Commit:** `733a9364c`
- **Status:** NOT ABSORBED — major UI overhaul

### 3.16 Tool Call UI Redesign (#12163)
- **Commit:** `0c66823c2`
- **Status:** NOT ABSORBED — tool call rendering overhaul

### 3.17 Prompts UI Refactor (#11570)
- **Commit:** `ccd049d8c`
- **Status:** NOT ABSORBED — prompts UI overhaul

### 3.18 React Resizable Panels v4 (#12356)
- **Commit:** `676641f3d`
- **Status:** NOT ABSORBED

### 3.19 bulkWrite Isolation (#12445)
- **Commit:** `877c2efc8`
- **Status:** NOT ABSORBED

### 3.20 Self-Healing Tenant Isolation Guard (#12506)
- **Commit:** `aa575b274`
- **Status:** NOT ABSORBED — depends on multi-tenant infra

---

## CATEGORY 4: Dependency & Infrastructure Updates

### 4.1 MISSING — @librechat/agents bump to v3.1.63
- **Custom:** `^3.1.55`
- **Upstream:** `^3.1.63`
- **Action:** Bump during merge

### 4.2 MISSING — axios pinned to 1.13.6
- **Custom:** `^1.13.5`
- **Upstream:** `1.13.6` (exact pin)
- **Action:** Pin during merge

### 4.3 MISSING — fast-xml-parser 5.3.8 → 5.5.7
- **Custom:** `5.3.8`
- **Upstream:** `5.5.7`
- **Action:** Bump during merge

### 4.4 MISSING — MongoDB 8.0.20 in docker-compose
- **Custom:** Already at `8.0.20` ✅
- **Status:** ABSORBED

### 4.5 MISSING — Alpine package upgrades in Dockerfiles (#12316)
- **Commit:** `ec0238d7c`
- **Status:** MISSING

### 4.6 MISSING — @dicebear dependencies bump (#12315)
- **Commit:** `3abad53c1`
- **Status:** MISSING

### 4.7 MISSING — Dependabot package bumps (#12487)
- **Commit:** `d9f216c11`
- **Status:** MISSING

### 4.8 MISSING — NPM audit packages (#12286)
- **Commit:** `b5a55b23a`
- **Status:** MISSING

---

## CATEGORY 5: Intentionally Divergent / Custom Preserved

These files are modified by both branches, and the custom branch intentionally differs:

### 5.1 INTENTIONALLY DIVERGENT — Admin Routes (`api/server/routes/admin/index.js`)
- Custom has custom RBAC role system; upstream has new Groups/Grants/Users/Roles API
- **Preserve:** Custom RBAC implementation

### 5.2 INTENTIONALLY DIVERGENT — Config Route (`api/server/routes/config.js`)
- Custom adds model-access filtering, scheduled-run config, realtime config
- **Preserve:** Custom config additions

### 5.3 INTENTIONALLY DIVERGENT — Model Controller (`api/server/controllers/ModelController.js`)
- Custom adds model-access restrictions, provider-specific filtering
- **Preserve:** Custom model access control

### 5.4 INTENTIONALLY DIVERGENT — Auth Strategies (openid, ldap, saml, process.js)
- Custom adds model-access seeding on first login, superadmin sync
- **Preserve:** Custom auth integration behavior

### 5.5 INTENTIONALLY DIVERGENT — Agent v1 Controller
- Custom adds model-access validation on agent create/update/duplicate
- **Preserve:** Custom model gating

### 5.6 INTENTIONALLY DIVERGENT — ToolService / MCP Tools
- Custom adds Ollama web search, custom MCP OAuth handling
- **Preserve:** Custom tool behavior

### 5.7 INTENTIONALLY DIVERGENT — Files process.js
- Custom adds transcription workflow, provider-aware file search
- **Preserve:** Custom file processing pipeline

### 5.8 INTENTIONALLY DIVERGENT — Server index.js
- Custom adds scheduled-run runner, transcription runner, realtime broker init
- **Preserve:** Custom startup sequence

### 5.9 INTENTIONALLY DIVERGENT — Dockerfile
- Custom uses `npm install` + `apply-runtime-patches.js` vs upstream's `npm ci` + `npm prune`
- **Preserve:** Custom install flow for runtime patching

### 5.10 INTENTIONALLY DIVERGENT — Client provider settings (Google, OpenAI, XAI)
- Custom adds capability-aware UI, xAI settings, native tool toggles
- **Preserve:** Custom provider UX

### 5.11 INTENTIONALLY DIVERGENT — Realtime services
- Custom adds provider discovery, auth gating, model-access policy
- **Preserve:** Custom realtime implementation

### 5.12 INTENTIONALLY DIVERGENT — Scheduled runs
- Custom is the sole source of scheduled-run implementation
- **Preserve:** Entire scheduled-run surface

---

## CATEGORY 6: Low-Risk / Cosmetic / Not Applicable

| Commit | Description | Status |
|--------|-------------|--------|
| `419613fda` | Move project instructions to CLAUDE.md | NOT APPLICABLE (custom has own CLAUDE.md) |
| `d5c7d9f52` | Update Railway deployment docs | NOT APPLICABLE |
| `1123f96e6` | UTM tracking in Railway links | NOT APPLICABLE |
| `3f805d68a` | Nginx SSL proxy template docs | NOT APPLICABLE |
| `59873e74f` | Chinese README translation | NOT APPLICABLE |
| `56d994e9e` | i18n translation updates | MISSING but low risk |
| `729ba9610` | i18n translation updates | MISSING but low risk |
| `85e24e4c6` | i18n translation updates | MISSING but low risk |
| `676d297cb` | a11y: conversation headings | MISSING but low risk |
| `697641446` | a11y: conversation headings | MISSING but low risk |
| `5a373825a` | Sidebar panel/favorites height | MISSING but low risk |
| `28c2e224a` | .gitignore memory directory | MISSING but low risk |
| `365a0dc0f` | OCR error message surfacing | MISSING but low risk |
| `f82d4300a` | Remove deprecated Gemini models | MISSING but low risk |
| `831844670` | MCP STDIO customUserVars UX | MISSING but low risk |

---

## Gap Map Summary

### Critical Gaps (Security — must be ported before cutover)
**37 upstream security/safety fixes are MISSING** from the custom branch. These span:
- SSRF protection (domain validation, base URL validation, web search URL validation)
- Authentication hardening (OpenID mismatch, federated token leak, ban cache, OAuth origin binding)
- Authorization enforcement (agent ACL, file access scoping, action ownership, capability gates)
- Input sanitization (markdown artifacts, env exfil, file size limits, ODT ZIP hardening)
- Network safety (IPv6 rate limiter, socket isolation, SSE dedup)

### Architecture Gaps (Require full merge — cannot cherry-pick)
**~20 upstream architecture commits** introduce multi-tenancy, DB model consolidation, new admin APIs, and major UI redesigns. These are NOT independently portable and require the full upstream merge to land.

### Dependency Gaps
**4 dependency bumps** are missing (`@librechat/agents`, `axios`, `fast-xml-parser`, Alpine packages).

### Intentionally Divergent (12 areas)
These are correctly preserved custom behavior that upstream's changes would overwrite. Each requires careful merge conflict resolution to keep custom behavior while absorbing upstream improvements where compatible.

---

## Recommended Follow-Up Work Items

### HIGH PRIORITY — Security fix backport batch
Port the 37 security/safety fixes listed in Category 1 as a focused batch. Many touch files not modified by custom (934 upstream-only files land cleanly), so the main effort is the ~20 fixes that overlap with custom-modified files.

**Suggested approach:** A targeted `git cherry-pick` batch for fixes touching upstream-only files, followed by manual three-way merge for fixes overlapping with custom files.

### MEDIUM PRIORITY — Bug fix backport batch
Port the ~20 bug fixes from Category 2. Most touch files not customized and should land cleanly.

### LOW PRIORITY — Architecture reconciliation
The 20 major architecture changes (Category 3) require the full upstream merge strategy from the mission plan. These cannot be individually cherry-picked.

### DEPENDENCY — Package bumps
Bump `@librechat/agents`, `axios`, `fast-xml-parser`, and resolve lockfile as part of merge.

---

## Post-Audit Update (2026-04-06)

**Decisions documented in:** `.factory/library/upstream-architecture-decisions.md`

Since this audit was written, four focused backport batches have landed:

| Commit | Scope | Items absorbed |
|---|---|---|
| `9cfdf2ba0` | SSRF, auth, rate-limiter hardening | 12 security fixes from Category 1 |
| `bee9b3368` | Agent ACL, file safety, stream integrity | 13 security fixes from Category 1 |
| `bfe6435e8` | Stability and UX bug fixes | 5 bug fixes from Category 2 |
| `e0c75c342` | Dependency alignment | agents, axios, fast-xml-parser from Category 4 |

**Remaining work is tracked as:**
- 8 security items → 5 absorb-now (in pending features), 3 future follow-up
- 13 bug fix items → 10 absorb-now (in pending features), 2 intentional divergence, 1 future follow-up
- 20 architecture items → 7 intentional divergence, 7 future follow-up, 2 not applicable, 4 already absorbed
- 4 dependency items → absorbed; 4 additional infra items → absorb-now in pending features

See `upstream-architecture-decisions.md` for the full classification with rationale.
