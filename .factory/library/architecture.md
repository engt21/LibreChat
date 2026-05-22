# Architecture

This customized LibreChat repo is a migration target, not a greenfield app. Workers should read it as a layered system: upstream LibreChat provides the base platform, this worktree adds persistent local customizations, and the dual-rail runtime lets migration work validate on `dev` before anything touches `stable`.

## System Overview

The system is a customized LibreChat monorepo operated from `/pool/home/timeng/LibreChat-custom`, with `/pool/home/timeng/LibreChat` serving as the upstream-sync reference rather than the active runtime tree. The repository combines:

- a backend application that owns auth, policy enforcement, orchestration, background runners, and provider integration;
- a frontend application that exposes chat, admin, scheduling, provider settings, realtime voice, and file workflows;
- shared packages that carry schemas, provider contracts, endpoint metadata, and client-facing data types across the stack;
- local runtime and deployment helpers that turn the repo into a two-rail operational system with observability and attached local services.

Migration work is therefore not only a source merge. It is also a preservation exercise across product behavior, runtime topology, and local operational conventions.

## Component Boundaries

The repo is organized as a workspace monorepo with clear responsibility boundaries:

- `api/`: the server application. This is the control plane for authentication, authorization, model access enforcement, scheduling, file processing, realtime session brokering, and route mounting.
- `client/`: the web application. This is the user-facing surface for chat, admin, provider configuration, schedules, transcription, and realtime UX.
- `packages/data-provider` and `packages/data-schemas`: the contract layer. These packages define shared types, schemas, defaults, and API/data-provider shapes that must stay aligned with both server and client behavior.
- `packages/api` and `packages/client`: shared provider and UI logic consumed by the top-level apps.
- `config/`: repo-level scripts and runtime patching. This layer carries install-time and operational behavior that can be easy to lose during upstream updates.
- `local-services/` plus Docker/compose files: the local deployment layer. This is where rail isolation, startup order, runtime file wiring, health checks, and sidecar integration live.
- runtime-mounted data and secrets (`.env`, `librechat.yaml`, Langfuse env, uploads, logs, data directories): operational state, not normal source-controlled feature code.

The dependency ripple path matters during migration. Changes usually propagate in this order:

- `packages/data-provider`
- `packages/data-schemas`
- `packages/api`
- `packages/client`
- `client`
- `api`

Workers should treat upstream merge conflicts in shared packages as upstream-facing contract changes first, then validate the downstream app layers that consume them.

The practical migration rule is that cross-boundary changes are riskier than in-boundary changes. If a feature touches server behavior, client UX, shared schemas, and runtime startup together, treat it as a system-level customization rather than a local patch.

## Customization Domains

The customization surface is broad, but it clusters into a few major domains:

- **Admin and policy control**: admin console, RBAC tiers, superadmin synchronization, live app settings, registration gating, and per-user model access rules.
- **Provider adaptation**: custom behavior for OpenAI/Azure, Gemini, xAI, and Ollama, including live discovery, capability-aware settings, grounded search/citation behavior, and request normalization.
- **Tooling and execution rails**: provider-native tool routing, local code interpreter routing, MCP interoperability, OAuth hardening, and file-search/code-execution/search behavior.
- **Background and realtime workflows**: scheduled runs, realtime voice sessions, and background audio/video transcription that persists into normal conversations.
- **Runtime and observability operations**: dual-rail startup, local service composition, Langfuse pricing/observability integration, and worktree-specific deployment conventions.
- **Credential strategy**: especially Google’s multiple auth modes and the repo’s handling of per-user versus server-managed credentials.

These domains overlap. Many migration conflicts that look provider-specific are actually policy, schema, or runtime issues in disguise.

## Runtime Topology

This repo runs as a dual-rail local system:

- `stable` (`r1`, `:3080`) is the long-lived serving rail.
- `dev` (`r2`, `:3081`) is the validation rail and the only rail that should absorb migration churn first.
- During prod cutover, active traffic is expected to swing temporarily onto the already-validated `dev` rail while `stable` is refreshed, then swing back to refreshed `stable` after post-cutover verification passes. `dev` remains a warm rollback rail during that window, but it is not the intended steady-state primary because it runs with less memory headroom.

Both rails share the same source tree but must remain isolated by compose project identity, image tags, ports, and writable state. The runtime is larger than the core LibreChat app: it also includes data stores, local RAG services, a local code interpreter bridge, Langfuse components, and observability sidecars. The rails are designed so `dev` can be rebuilt, validated, or discarded while `stable` remains usable.

Some required runtime dependencies live outside this repo and must be treated as part of the architecture:

- sibling `rag_api` checkout for provider-specific local RAG services;
- sibling `librechat_exporter` assets for Prometheus, Grafana, and Loki sidecars;
- shared observability/log inputs such as Touchdown log mounts consumed by the exporter stack.

Workers should distinguish rail-local writable state from intentionally shared operational inputs. Rail-local state includes app data directories, rail-specific images, compose projects, and writable runtime paths. Shared operational inputs include the upstream-linked runtime secrets, exporter sidecars, and other explicitly documented cross-repo observability dependencies.

Operationally, this means migration decisions must preserve two distinct paths:

- the **code path** from monorepo source to built application behavior;
- the **runtime path** from helper scripts and mounted files to healthy rail-specific services.

Breaking either path invalidates the migration.

## Invariants to Preserve

The following invariants are architectural, not optional implementation details:

- `LibreChat-custom` remains the authoritative runtime worktree; the upstream-sync worktree is reference material.
- dual rails remain isolated, and promotion stays dev-first; rebuilding or validating `dev` must not mutate `stable`.
- **all agent missions execute exclusively on dev; stable/prod must remain running and untouched for the entire mission duration; promotion to stable happens only at the very end after all validation passes and the user explicitly approves.**
- cutover uses temporary `stable -> dev -> stable` traffic choreography so stable refresh work happens while uptime is preserved and `dev` returns to a rollback/development role afterward.
- admin/RBAC, registration policy, and per-user model restrictions remain enforced server-side, not just hidden in UI.
- provider-native and LibreChat-managed tool flows continue to route coherently without duplicate execution or broken file bookkeeping.
- shared schemas and data-provider contracts stay aligned with server and client behavior, especially where files, permissions, schedules, and provider capabilities are concerned.
- MCP and OAuth flows preserve current callback, refresh, and consent semantics across local and proxied deployments.
- realtime voice, scheduled runs, and background transcription remain first-class workflows, not experimental add-ons that can silently disappear in merges.
- runtime-mounted secrets, uploaded data, logs, and rail-local state remain outside normal source merges and must not be overwritten by upstream defaults.

If a migration change appears to simplify the system by collapsing one of these distinctions, assume it is probably regressing a required customization.

## Migration Hotspots

The highest-risk migration areas are the seams where upstream LibreChat evolves quickly and this fork carries durable local behavior:

- **policy seams**: admin, RBAC, registration, and model access, because they span backend enforcement, frontend visibility, and user provisioning flows;
- **provider seams**: model discovery, capability metadata, request shaping, and settings panels for Google, xAI, Ollama, and Azure/OpenAI variants;
- **tool-routing seams**: native tools, MCP/OAuth, file handling, and code execution, because they combine provider behavior with local bookkeeping;
- **workflow seams**: scheduled runs, realtime voice, and transcription, because each depends on routes, background execution, persisted metadata, and UI state all staying in sync;
- **runtime seams**: local-services scripts, compose overrides, runtime patching, and mounted-file conventions, because an apparently harmless infra merge can break rail isolation or local auth behavior.
- **install-time patch seams**: `config/apply-runtime-patches.js` and any behavior that depends on postinstall mutation of `@librechat/agents`, because these effects do not live entirely inside the normal source package boundaries and are easy to lose during upstream rebases or dependency refreshes.

When conflicts occur, resolve them by preserving behavior at the seam first and only then reconciling local implementation shape.

## Validation Map

Validation should mirror the architecture rather than run as an undifferentiated checklist:

- **Workspace integrity**: lint/build/test coverage protects monorepo boundaries and catches contract drift between apps and shared packages.
- **Policy validation**: admin, auth, registration, and model-access checks confirm that control-plane rules still hold end to end.
- **Provider validation**: discovery, settings, native-tool routing, and provider-specific request behavior confirm that customized endpoint behavior survived the migration.
- **Workflow validation**: scheduled runs, realtime voice, transcription, and file flows confirm that long-running and multi-step behaviors still traverse server, client, and schema layers correctly.
- **Runtime validation**: rail startup, health checks, mounted runtime files, Langfuse health, and sidecar reachability confirm that the operational topology still matches the source topology.
- **Cutover validation**: dev-first acceptance followed by stable smoke checks confirms that promotion preserves the rollback-friendly dual-rail model.

The key mapping for workers is simple: validate each architectural layer where it lives, then validate the cross-layer flows that join them. Most migration regressions appear at those joins, not inside a single file or package.
