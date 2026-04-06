# Upstream Architecture Absorption Decisions

**Decision date:** 2026-04-06
**Input:** `.factory/library/upstream-absorption-audit.md` (audit date 2026-04-05)
**Branch state:** `engt21/local-customizations` @ `e0c75c342` (129 upstream-only / 64 custom-only vs merge base)
**Decision authority:** This document records explicit absorb-now / intentional-divergence / future-follow-up decisions for every remaining major upstream architecture delta identified in the audit.

---

## Decision Framework

Each delta is classified as one of:

| Classification | Meaning |
|---|---|
| **ABSORBED** | Already backported to custom branch in a completed mission feature |
| **ABSORB NOW** | Should be absorbed as a concrete pending mission feature in the current customization-preservation milestone |
| **INTENTIONAL DIVERGENCE** | Custom branch deliberately differs; upstream change conflicts with preserved customization behavior; no absorption planned |
| **FUTURE FOLLOW-UP** | Cannot be safely absorbed now (dependency chain, scope, risk); tracked as explicit future work with preconditions |
| **NOT APPLICABLE** | Upstream change targets infrastructure or code paths this fork does not use |

---

## CATEGORY 1: Security & Safety Fixes — Post-Backport Status

The audit identified 37 missing security fixes. Three focused backport batches have since landed:

| Batch commit | Scope | PR numbers absorbed |
|---|---|---|
| `9cfdf2ba0` | SSRF, auth, rate-limiter | #12245, #12244, #12248, #12247, #12260, #12312, #12264, #12469, #12324, #12326, #12333, #12319 |
| `bee9b3368` | Agent ACL, file safety, stream integrity | #12311, #12246, #12250, #12243, #12253, #12263, #12251, #12275, #12252, #12237, #12271, #12276, #12313 |
| `d22cbc2f9` | Reasoning history reconstruction | Runtime-patch regression (VAL-PROVIDER-001B) |

### Remaining Security Items (8 items)

#### 1.6 + 1.7: Markdown Artifact Sanitization (#12249, #12337)
- **Classification:** ABSORB NOW
- **Rationale:** XSS risk via unsanitized markdown in artifacts. Touches `client/src/utils/artifacts.ts` and `client/src/utils/markdown.ts` — no conflict with custom behavior. Pure client-side security hardening.
- **Tracked as:** Part of `backport-upstream-client-stability-and-ux-bugfixes` (pending feature)

#### 1.8: File Count and Size Limits (#12239)
- **Classification:** ABSORB NOW
- **Rationale:** Client-side enforcement gap for file attachment limits. Touches `client/src/utils/files.ts` and `PanelTable.tsx`. No conflict with custom transcription or file-search workflows.
- **Tracked as:** Part of `backport-upstream-client-stability-and-ux-bugfixes` (pending feature)

#### 1.9: ODT ZIP Metadata Hardening (#12320)
- **Classification:** ABSORB NOW
- **Rationale:** Path traversal risk from falsified ZIP metadata in ODT parsing. Touches `packages/api/src/files/documents/crud.ts`. No custom divergence in document parsing.
- **Tracked as:** NEW — include in security follow-up batch or `backport-upstream-client-stability-and-ux-bugfixes`

#### 1.25: Azure AD Group Overage OBO Token Exchange (#12187)
- **Classification:** FUTURE FOLLOW-UP
- **Rationale:** Adds On-Behalf-Of token exchange when Azure AD group count exceeds JWT capacity. This is a medium-complexity auth flow addition that touches multiple OpenID and auth files. The fork's custom superadmin sync, model-access seeding, and LDAP strategy make this a conflict-prone surface. Not needed for current deployment (no Azure AD group overage scenario active).
- **Precondition:** Requires careful reconciliation with custom openidStrategy.js and auth integration points after cutover stabilizes.

#### 1.26: SSE Resume Buffered Event Duplication (#12225)
- **Classification:** ABSORB NOW
- **Rationale:** Duplicate events on SSE reconnection. Touches `api/server/routes/agents/index.js`, `client/src/hooks/SSE/useResumableSSE.ts`, `packages/api/src/stream/GenerationJobManager.ts`. The fork has GenerationJobManager but may lack dedup logic.
- **Tracked as:** Part of `backport-upstream-client-stability-and-ux-bugfixes` (pending feature — SSE scope)

#### 1.27: MCP OAuth Detection in Tool-Call Flow (#12418)
- **Classification:** FUTURE FOLLOW-UP
- **Rationale:** Adds robust OAuth detection during MCP tool-call flow. The fork has custom MCP OAuth handling (VAL-MCP-001 through VAL-MCP-004 preserved). This upstream change restructures MCP wiring in ways that overlap with the fork's custom MCP/OAuth callback, refresh, and consent behavior. Absorbing requires reconciliation with the custom MCP surface.
- **Precondition:** Must be evaluated alongside Category 3.7 (3-Tier MCP Server Architecture) since both reshape MCP internals.

#### 1.28: Respect fileConfig.disabled for Agents Upload (#12238)
- **Classification:** ABSORB NOW
- **Rationale:** Upload button shown when file uploads are disabled. Touches `client/src/components/Chat/Input/Files/AttachFileChat.tsx` — no custom modification to this file.
- **Tracked as:** Part of `backport-upstream-client-stability-and-ux-bugfixes` (pending feature)

#### 1.30: MCP Refresh Token on OAuth Discovery Failure (#12266)
- **Classification:** FUTURE FOLLOW-UP
- **Rationale:** Token refresh fallback when OAuth discovery fails. Overlaps with fork's custom MCP OAuth behavior (VAL-MCP-002 preference for protected-resource authorization server metadata). Must be reconciled with the custom MCP wiring rather than blindly absorbed.
- **Precondition:** Evaluate alongside #12418 and Category 3.7.

#### 1.34: Agent Revoked from Favorites (#12296)
- **Classification:** ABSORB NOW
- **Rationale:** Revoked agents stuck in user favorites. Clean agent-management fix with no custom divergence.
- **Tracked as:** Include in a future bug-fix batch

#### 1.35: ACL-Safe User Account Deletion (#12314)
- **Classification:** ABSORB NOW
- **Rationale:** Incomplete cleanup of agents/prompts/MCP on user deletion. The fork already has deletion tests (VAL-ADMIN-007, VAL-SCHED-010) but may lack the full ACL cleanup scope. Needs careful merge with custom scheduled-job cleanup.
- **Tracked as:** Include in a future bug-fix batch

#### 1.37: Cross-Replica Created Event Delivery (#12231)
- **Classification:** NOT APPLICABLE
- **Rationale:** This fork runs as a single-instance deployment (single API container per rail). Multi-replica event delivery is not needed. The fix would add complexity without benefit.

---

## CATEGORY 2: Bug Fixes — Post-Backport Status

The `bfe6435e8` backport batch absorbed: #12397, #12398, #12512, #12510, #12390.

### Remaining Bug Fix Items (15 items)

#### 2.1: Auth-Aware Startup Config Caching (#12505)
- **Classification:** ABSORB NOW
- **Rationale:** Fresh sessions may get stale config. Pure client caching fix.
- **Tracked as:** `backport-upstream-client-stability-and-ux-bugfixes` (pending)

#### 2.2: Message Icon Flickering (#12489)
- **Classification:** ABSORB NOW
- **Rationale:** UI rendering issue, no custom divergence.
- **Tracked as:** `backport-upstream-client-stability-and-ux-bugfixes` (pending)

#### 2.3: Lazy-Initialize Balance Record (#12474)
- **Classification:** INTENTIONAL DIVERGENCE
- **Rationale:** This fork has custom token/balance behavior in `api/models/tx.js` and `api/models/tx.spec.js` (both modified in the custom branch). The lazy balance-record initialization changes the write-path semantics for balance tracking. Custom branch preserves its existing balance initialization pattern that aligns with the fork's per-user model-access and scheduled-run execution cost tracking. Absorbing would require reconciling with the custom tx.js surface.
- **Revisit:** After cutover, evaluate whether the lazy pattern improves the fork's existing balance behavior without breaking model-access cost tracking.

#### 2.4: Safe Hook Fallbacks for Tool-Call Search Route (#12423)
- **Classification:** ABSORB NOW
- **Rationale:** Hook crash on search route. Client-side safety fix.
- **Tracked as:** `backport-upstream-client-stability-and-ux-bugfixes` (pending)

#### 2.5: Message Cache Invalidation on Stream 404 (#12411)
- **Classification:** ABSORB NOW
- **Rationale:** Error shown instead of cache invalidation. SSE/cache fix.
- **Tracked as:** `backport-upstream-client-stability-and-ux-bugfixes` (pending)

#### 2.9: MCP Tool Misclassification (#12512)
- **Classification:** ABSORBED
- **Status:** Already backported in `bfe6435e8`

#### 2.10: Sandpack ExternalResources (#12509)
- **Classification:** ABSORB NOW
- **Rationale:** Artifact preview improvements. No custom divergence.
- **Tracked as:** `backport-upstream-client-stability-and-ux-bugfixes` (pending)

#### 2.11: recursionLimit for OpenAI-Compatible Agents (#12510)
- **Classification:** ABSORBED
- **Status:** Already backported in `bfe6435e8`

#### 2.12: Route Unrecognized File Types (#12508)
- **Classification:** ABSORB NOW
- **Rationale:** File type routing via config. No custom conflict.
- **Tracked as:** Include in a future bug-fix batch

#### 2.13: Proper MCP Menu Dismissal (#12256)
- **Classification:** ABSORB NOW
- **Rationale:** UI behavior fix. No custom divergence.
- **Tracked as:** `backport-upstream-client-stability-and-ux-bugfixes` (pending)

#### 2.14: ModelSpec Display Fields on Agent Share Link (#12274)
- **Classification:** ABSORB NOW
- **Rationale:** Navigation display cleanup. No custom conflict.
- **Tracked as:** Include in a future bug-fix batch

#### 2.15: Permission Defaults for USER Role (#12308)
- **Classification:** FUTURE FOLLOW-UP
- **Rationale:** Adds explicit role permission defaults. The fork has a custom RBAC tier system (workspace_admin, support_admin, observability_admin) that carries its own permission defaults. Absorbing requires reconciliation with the custom RBAC surface to avoid inadvertently overriding the fork's permission scopes.
- **Precondition:** Evaluate alongside Category 3.3 (System Grants) and 3.6 (Admin Roles/Groups/Grants API).

#### 2.16: ToolMessage Response Format for Agent Image Tools (#12310)
- **Classification:** ABSORB NOW
- **Rationale:** Image tool response format fix. No custom divergence.
- **Tracked as:** Include in a future bug-fix batch

#### 2.17 + 2.18: Conversation Field Stripping (#12501, #12498)
- **Classification:** ABSORB NOW
- **Rationale:** Data cleanup in conversation/message writes. No custom conflict with write path behavior.
- **Tracked as:** Include in a future bug-fix batch

#### 2.19: MCP Queries Behind USE Permission (#12345)
- **Classification:** FUTURE FOLLOW-UP
- **Rationale:** Prevents 403 spam for MCP queries. Touches MCP permission wiring that overlaps with the fork's custom MCP/OAuth behavior. Must be evaluated alongside MCP architecture changes.
- **Precondition:** Evaluate alongside Category 3.7.

#### 2.20: Clear Drafts on Expired SSE Stream (#12309)
- **Classification:** ABSORB NOW
- **Rationale:** Draft cleanup on SSE expiry. Client-side fix.
- **Tracked as:** `backport-upstream-client-stability-and-ux-bugfixes` (pending)

---

## CATEGORY 3: Major Upstream Architecture Changes — Decisions

These represent significant upstream refactoring that cannot be cherry-picked individually. Each decision considers the fork's preserved customization surface and the risk/benefit tradeoff.

### 3.1: Multi-Tenant Data Isolation Infrastructure (#12091)
- **Classification:** INTENTIONAL DIVERGENCE
- **Rationale:** This fork operates as a single-tenant deployment (one organization, one API instance per rail). Multi-tenancy introduces tenant ID threading through every DB operation, middleware, and model layer. Absorbing would require modifying every custom model, controller, service, and query to carry tenant context — a massive change with zero benefit for the current single-tenant deployment model. The fork's custom RBAC, model access, scheduled runs, and admin surfaces all assume single-tenant semantics.
- **Risk of not absorbing:** Future upstream features that depend on multi-tenancy will require manual adaptation. This is acceptable because the fork already carries significant custom behavior that requires manual upstream reconciliation.

### 3.2: DB Model Consolidation into data-schemas (#11830)
- **Classification:** INTENTIONAL DIVERGENCE
- **Rationale:** Upstream moves Mongoose models from `api/models/` to `packages/data-schemas/`. The fork has extensive custom behavior in `api/models/` (ScheduledJob, tx.js custom behavior, model-access patterns). The consolidation is a structural refactor that provides no behavioral improvement for this fork and would require rewriting every custom model import, custom service that touches models, and every test that references `api/models/`. The fork's custom models work correctly in their current location.
- **Revisit:** Only revisit if upstream deprecates the `api/models/` pattern entirely and the fork needs to track upstream for an extended period.

### 3.3: System Grants for Capability-Based Authorization (#11896)
- **Classification:** INTENTIONAL DIVERGENCE
- **Rationale:** The fork has a working custom RBAC tier system (superadmin, workspace_admin, support_admin, observability_admin) with specific permission scopes documented in VAL-ADMIN-002. Upstream's System Grants introduces a different authorization model that would conflict with the fork's permission enforcement at every admin route and middleware. The fork's RBAC system is actively used and validated.
- **Relationship:** This divergence also governs the treatment of 3.6 (Admin Roles/Groups/Grants API).

### 3.4: DB-Backed Per-Principal Config System (#12354)
- **Classification:** INTENTIONAL DIVERGENCE
- **Rationale:** Replaces env-based config with DB-backed per-principal config. The fork uses env-based config (`SUPERADMIN_EMAILS`, registration toggle, model access defaults, provider routing flags) as the primary configuration mechanism, with admin console live-settings overlay. The fork's config model is well-understood, documented, and validated. Absorbing would require rearchitecting how every custom config surface works.
- **Impact:** Future upstream features that assume DB-backed config will need manual adaptation if absorbed individually.

### 3.5: ALS Context Middleware and Tenant Threading (#12407)
- **Classification:** INTENTIONAL DIVERGENCE
- **Rationale:** Async Local Storage for tenant context threading. Depends on multi-tenancy (3.1). No benefit for single-tenant deployment.

### 3.6: Admin Roles/Groups/Users/Grants API (#12400, #12387, #12446, #12438)
- **Classification:** INTENTIONAL DIVERGENCE
- **Rationale:** Introduces new admin API endpoints (roles, groups, users, grants) that implement a different authorization model than the fork's custom RBAC tiers. The fork's admin routes, middleware, and console are purpose-built for the existing tier system. Absorbing would require either replacing the custom RBAC system entirely or running both systems in parallel — neither is justified for the current deployment.

### 3.7: 3-Tier MCP Server Architecture (#12435)
- **Classification:** FUTURE FOLLOW-UP
- **Rationale:** This is the most significant MCP architecture change. The fork has custom MCP OAuth handling (VAL-MCP-001 through VAL-MCP-004), including protected-resource authorization server metadata preference, callback URL precedence rules, and Arcade provider-consent handling. The 3-tier architecture restructures MCP server initialization, lifecycle, and tool registration in ways that overlap with all of these custom behaviors. However, this architecture may eventually bring improvements that the fork should adopt.
- **Precondition:** Requires a dedicated reconciliation effort after cutover that preserves custom MCP OAuth semantics while adopting the structural improvements. Must be done alongside #12418, #12266, and #12345 which also reshape MCP internals.
- **Scope:** Full MCP reconciliation feature with custom preservation tests.

### 3.8: Tenant-Scoped App Config in Auth Login Flows (#12434)
- **Classification:** INTENTIONAL DIVERGENCE
- **Rationale:** Depends on multi-tenancy (3.1) and DB-backed config (3.4). Not applicable to single-tenant deployment.

### 3.9: Config Route Split (Authed/Unauthed) (#12490)
- **Classification:** FUTURE FOLLOW-UP
- **Rationale:** Splits config routes into authenticated and unauthenticated paths. The fork has custom config route behavior (model-access filtering, scheduled-run config, realtime config in `api/server/routes/config.js`). The split itself is architecturally sound and could improve the fork's auth gating, but requires careful merge with the custom config surface.
- **Precondition:** Evaluate after cutover; absorb only if the split improves the fork's config auth posture without breaking custom config additions.

### 3.10: Config Schema Tightening (#12452)
- **Classification:** FUTURE FOLLOW-UP
- **Rationale:** Removes deprecated fields from config schemas. The fork may rely on some of these fields for custom behavior. Requires field-by-field audit against the fork's actual config consumption before absorbing.
- **Precondition:** Evaluate after cutover alongside 3.9 and 3.11.

### 3.11: Config Services Migration to TypeScript (#12466)
- **Classification:** FUTURE FOLLOW-UP
- **Rationale:** Major TypeScript migration of config services. The fork's config services are JavaScript. This is a code-quality improvement that could be absorbed in a future cleanup phase but is not needed for behavioral correctness.
- **Precondition:** Evaluate after cutover; lower priority than behavioral fixes.

### 3.12: FerretDB Compatibility + Project Model Removal (#11769, #11773)
- **Classification:** INTENTIONAL DIVERGENCE
- **Rationale:** Custom branch still has `api/models/Project.js`. The fork uses MongoDB 8.0 (not FerretDB). FerretDB compatibility changes would add unnecessary query-pattern restrictions for a deployment that doesn't need them. Project model removal depends on multi-tenancy replacing it.

### 3.13: S3 Storage TypeScript Migration (#11947)
- **Classification:** NOT APPLICABLE
- **Rationale:** This fork uses local filesystem storage with mounted volumes for uploads, images, and files. S3 storage is not configured or used. The TypeScript migration of S3 code paths has no impact.

### 3.14: Agent Context Compaction/Summarization (#12287)
- **Classification:** FUTURE FOLLOW-UP
- **Rationale:** New agent feature that adds context compaction and summarization. This is a genuinely useful capability that doesn't conflict with any custom behavior — it adds new functionality rather than changing existing behavior. However, it touches agent orchestration internals that overlap with the fork's custom model-access enforcement on agents.
- **Precondition:** Absorb after cutover as a feature addition; verify model-access enforcement still applies to compaction/summarization model selection.

### 3.15: Sidebar Redesign (#12013)
- **Classification:** FUTURE FOLLOW-UP
- **Rationale:** Major UI overhaul of the sidebar. The fork's sidebar carries custom behavior (admin console entry gating, scheduled-runs navigation, transcription conversation persistence). A full sidebar redesign requires careful reconciliation to preserve these custom navigation behaviors.
- **Precondition:** Absorb only when the redesign's structural improvements justify the reconciliation effort. Must preserve admin console visibility gating (VAL-ADMIN-001), scheduled-run conversation linkage, and transcription conversation persistence.

### 3.16: Tool Call UI Redesign (#12163)
- **Classification:** FUTURE FOLLOW-UP
- **Rationale:** Tool call rendering overhaul. The fork has custom tool-call rendering behavior for native web search status (VAL-REALTIME-004), grounding citations (VAL-PROVIDER-005), and reasoning presentation (VAL-REALTIME-005). These custom rendering behaviors must be preserved in any tool-call UI redesign.
- **Precondition:** Absorb after cutover with explicit preservation tests for custom rendering behaviors.

### 3.17: Prompts UI Refactor (#11570)
- **Classification:** FUTURE FOLLOW-UP
- **Rationale:** Prompts UI overhaul. The fork doesn't carry heavy custom behavior in the prompts surface, making this lower-risk to absorb. However, it's a large change that should wait until the cutover is stable.
- **Precondition:** Low priority; absorb after cutover stabilizes.

### 3.18: React Resizable Panels v4 (#12356)
- **Classification:** FUTURE FOLLOW-UP
- **Rationale:** Dependency upgrade for resizable panels. Low risk but low priority. Should be absorbed as part of a future dependency refresh.

### 3.19: bulkWrite Isolation (#12445)
- **Classification:** INTENTIONAL DIVERGENCE
- **Rationale:** Depends on multi-tenancy (3.1) for tenant-scoped bulkWrite isolation. Not applicable to single-tenant deployment.

### 3.20: Self-Healing Tenant Isolation Guard (#12506)
- **Classification:** INTENTIONAL DIVERGENCE
- **Rationale:** Depends on multi-tenancy (3.1). Not applicable to single-tenant deployment.

---

## CATEGORY 4: Dependency & Infrastructure Updates — Post-Backport Status

#### 4.1 + 4.2 + 4.3: @librechat/agents, axios, fast-xml-parser
- **Classification:** ABSORBED
- **Status:** Landed in `e0c75c342` (deps: align @librechat/agents, axios, and fast-xml-parser with upstream v0.8.4 baseline)

#### 4.4: MongoDB 8.0.20
- **Classification:** ABSORBED
- **Status:** Already at 8.0.20 in custom branch

#### 4.5: Alpine Package Upgrades in Dockerfiles (#12316)
- **Classification:** ABSORB NOW
- **Rationale:** Security updates for Alpine base packages in Docker images. No behavioral impact.
- **Tracked as:** Include in a future infrastructure batch

#### 4.6: @dicebear Dependencies Bump (#12315)
- **Classification:** ABSORB NOW
- **Rationale:** Avatar library dependency update. No behavioral impact.
- **Tracked as:** Include in a future dependency batch

#### 4.7: Dependabot Package Bumps (#12487)
- **Classification:** ABSORB NOW
- **Rationale:** Standard dependency security updates. No behavioral impact.
- **Tracked as:** Include in a future dependency batch

#### 4.8: NPM Audit Packages (#12286)
- **Classification:** ABSORB NOW
- **Rationale:** NPM audit-driven security fixes. No behavioral impact.
- **Tracked as:** Include in a future dependency batch

---

## CATEGORY 5: Intentionally Divergent (12 areas) — Confirmed

All 12 areas listed in the audit (5.1–5.12) remain **INTENTIONALLY DIVERGENT**. These represent the fork's core customization surface and are actively validated by the mission's validation contract:

| Area | Validation Contract IDs |
|---|---|
| 5.1 Admin Routes | VAL-ADMIN-001, VAL-ADMIN-002, VAL-ADMIN-007 |
| 5.2 Config Route | VAL-MODEL-003, VAL-CROSS-001 |
| 5.3 Model Controller | VAL-MODEL-001, VAL-MODEL-002, VAL-MODEL-003 |
| 5.4 Auth Strategies | VAL-AUTH-001, VAL-ADMIN-003, VAL-MODEL-001 |
| 5.5 Agent v1 Controller | VAL-MODEL-003 |
| 5.6 ToolService / MCP | VAL-MCP-001 through VAL-MCP-004, VAL-PROVIDER-010 |
| 5.7 Files process.js | VAL-FILES-001 through VAL-FILES-009 |
| 5.8 Server index.js | VAL-SCHED-006, VAL-FILES-004, VAL-CROSS-006 |
| 5.9 Dockerfile | VAL-RUNTIME-001, runtime patches |
| 5.10 Client provider settings | VAL-PROVIDER-004 through VAL-PROVIDER-008 |
| 5.11 Realtime services | VAL-REALTIME-001 through VAL-REALTIME-003 |
| 5.12 Scheduled runs | VAL-SCHED-001 through VAL-SCHED-010 |

---

## CATEGORY 6: Low-Risk / Cosmetic — Decisions

| Item | Classification | Rationale |
|---|---|---|
| i18n translation updates (3 commits) | FUTURE FOLLOW-UP | Low risk, absorb after cutover |
| a11y conversation headings (2 commits) | FUTURE FOLLOW-UP | Low risk, absorb after cutover |
| Sidebar panel/favorites height | FUTURE FOLLOW-UP | Absorb alongside sidebar redesign (3.15) |
| .gitignore memory directory | ABSORB NOW | Trivial, no conflict |
| OCR error message surfacing | ABSORB NOW | No custom conflict |
| Remove deprecated Gemini models | ABSORB NOW | No custom conflict |
| MCP STDIO customUserVars UX | FUTURE FOLLOW-UP | Evaluate alongside MCP architecture changes |

---

## Summary of Concrete Follow-Up Work

### Already Tracked as Pending Features

| Feature ID | Items Covered |
|---|---|
| `backport-upstream-client-stability-and-ux-bugfixes` | #12249, #12337, #12239, #12505, #12489, #12423, #12411, #12509, #12256, #12309, #12238, #12225 (client SSE portion) |
| `restore-direct-register-disablement-guard` | VAL-AUTH-001 |
| `verify-superadmin-allowlist-repromotion` | VAL-ADMIN-003 |
| `restore-inline-web-search-stream-status` | VAL-REALTIME-004 |
| `enforce-scheduled-run-execution-time-policy-revalidation` | VAL-CROSS-005 |

### New Follow-Up Features Needed (post-cutover scope)

#### 1. `backport-remaining-security-and-bugfix-items`
- **Scope:** #12320 (ODT ZIP hardening), #12296 (agent revoked favorites), #12314 (ACL-safe deletion), #12508 (file type routing), #12274 (modelspec display), #12310 (image tool response format), #12501/#12498 (conversation field stripping), #12225 (SSE dedup — server-side portion)
- **Milestone:** misc-pre-cutover or post-cutover
- **Prerequisite:** `backport-upstream-client-stability-and-ux-bugfixes` complete

#### 2. `backport-infrastructure-dependency-updates`
- **Scope:** #12316 (Alpine packages), #12315 (@dicebear), #12487 (dependabot), #12286 (npm audit), .gitignore memory dir, OCR error surfacing, deprecated Gemini model removal
- **Milestone:** misc-pre-cutover or post-cutover
- **Prerequisite:** None beyond basic tree stability

#### 3. `reconcile-mcp-architecture-with-custom-oauth-behavior`
- **Scope:** Category 3.7 (3-Tier MCP), #12418 (MCP OAuth detection), #12266 (MCP refresh token), #12345 (MCP USE permission), MCP STDIO customUserVars
- **Milestone:** post-cutover
- **Prerequisite:** Cutover complete, custom MCP/OAuth behavior stable, dedicated reconciliation effort
- **Risk:** High — this is the single largest remaining architecture gap that could deliver genuine value to the fork

#### 4. `evaluate-config-route-and-schema-improvements`
- **Scope:** Category 3.9 (config route split), 3.10 (config schema tightening), 3.11 (config TS migration)
- **Milestone:** post-cutover
- **Prerequisite:** Cutover complete, config surface stable

#### 5. `evaluate-ui-redesign-absorption`
- **Scope:** Category 3.15 (sidebar redesign), 3.16 (tool call UI), 3.17 (prompts UI), 3.18 (resizable panels)
- **Milestone:** post-cutover
- **Prerequisite:** Cutover complete, UI customizations stable

#### 6. `evaluate-agent-context-compaction`
- **Scope:** Category 3.14 (agent context compaction/summarization)
- **Milestone:** post-cutover feature addition
- **Prerequisite:** Model-access enforcement validated on compaction model selection

#### 7. `evaluate-azure-ad-group-overage-support`
- **Scope:** Category 1.25 (#12187)
- **Milestone:** post-cutover, on-demand when Azure AD overage scenario arises
- **Prerequisite:** Custom auth strategies reconciliation complete

#### 8. `evaluate-permission-defaults-and-rbac-alignment`
- **Scope:** Category 2.15 (#12308), assessed alongside 3.3 and 3.6
- **Milestone:** post-cutover
- **Prerequisite:** Custom RBAC tier behavior fully validated

---

## Intentional Divergence — Long-Term Viability Assessment

The following upstream architecture changes are classified as **INTENTIONAL DIVERGENCE** because they fundamentally reshape the platform in ways that conflict with this fork's single-tenant, custom-RBAC, env-config deployment model:

| Architecture Change | Impact of Not Absorbing |
|---|---|
| Multi-Tenancy (3.1, 3.5, 3.8, 3.19, 3.20) | Future upstream features assuming tenant context will need manual single-tenant adaptation. Acceptable for single-tenant deployment. |
| DB Model Consolidation (3.2) | Import paths stay at `api/models/` instead of `packages/data-schemas/`. No behavioral impact. |
| System Grants (3.3, 3.6) | Custom RBAC tiers remain instead of upstream grants model. Acceptable — fork's RBAC is purpose-built. |
| DB-Backed Config (3.4) | Env-based config remains primary. Acceptable — fork's config model is well-understood. |
| FerretDB Compat (3.12) | MongoDB 8.0 query patterns remain. Acceptable — no FerretDB usage. |

**Key insight:** These divergences form a coherent architectural decision — this fork is a single-tenant, custom-RBAC deployment that uses env-based configuration. The upstream multi-tenancy/grants/DB-config direction is a different deployment model. Tracking these as intentional divergences rather than "gaps" is the correct framing.

---

## No-Overwrite Constraint Compliance

This decision document preserves the fork's custom branch behavior by:
1. Never classifying a custom-preserved area as "absorb now" when it would overwrite custom behavior
2. Requiring explicit reconciliation efforts (with preservation tests) before absorbing any change that overlaps with custom-modified files
3. Tracking MCP architecture reconciliation as a dedicated future effort rather than a blind merge
4. Keeping all intentionally divergent areas mapped to their validation contract IDs so preservation is verifiable
5. Not touching any concurrent local edits — this document is additive library content only
