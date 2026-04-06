# LibreChat Customization Master Doc

This is the single merged reference for the custom work built on top of upstream LibreChat in this repository.

This is the canonical customization record for this branch.

Use this document to:

- understand what custom features exist
- remember which files and behaviors must be preserved during upstream merges
- track the local runtime/deployment conventions for this setup
- know which focused docs already exist for deeper detail
- keep a running inventory of all branch-specific customizations over time

Mandatory maintenance rule:

- any customization added on top of upstream must be added to this document in the same task
- any removed or replaced customization must be removed or updated here in the same task
- any runtime/startup/workflow change must update this document and any focused supporting docs it affects

Backfill note:

- this document was refreshed from repo markdown plus relevant Droid session history through 2026-03-19
- branch-specific bug fixes, postmortems, and lessons learned that first show up in chat/session history must be rolled into this document, even if they are also captured in focused docs

---

## 1. Repository / worktree model

There are two local worktrees in use:

- `/pool/home/timeng/LibreChat`
  - upstream-sync worktree
  - branch: `main`
  - purpose: fetch and fast-forward from `danny-avila/LibreChat`
- `/pool/home/timeng/LibreChat-custom`
  - actual customization worktree
  - branch: `engt21/local-customizations`
  - purpose: local development, Docker runs, tests, and all custom feature work

Important rule:

- run LibreChat from `LibreChat-custom`
- do not use `LibreChat` as the primary runtime worktree

---

## 2. Current customization themes

The custom work in this branch falls into these main buckets:

1. Admin console, RBAC, superadmin sync, and live app settings
2. Scheduled runs and notifications
3. Default per-user model access restrictions plus admin overrides
4. Provider-native tools for OpenAI/Azure/Gemini
5. OpenAI/Azure plus Google Gemini model-family capability-aware settings
6. xAI custom-endpoint live model discovery and capability-aware settings
7. Ollama multi-source model discovery, hosted web search, and reasoning controls
8. MCP interoperability and OAuth hardening for OpenAI / Arcade-hosted MCP tools
9. Realtime voice brokered sessions across OpenAI/Azure/Gemini/xAI-compatible providers
10. Local code interpreter bridge with warm-session reuse and provider-routing controls
11. Langfuse pricing sync, historical backfill, and alias-aware observability support
12. Azure direct Azure OpenAI / Azure AI Foundry per-user endpoint support
13. Local runtime / Docker / startup / observability / worktree conventions
14. Background audio/video transcription with persistent conversations
15. Google auth mode support (API key, Vertex service account, Vertex ADC)
16. Math and computation tools (Scientific Calculator + Code Interpreter Math)

---

## 3. Custom feature inventory

### 3.1 Admin console, RBAC, superadmin sync, and live app settings

#### What it adds

- an admin console UI and admin backend routes
- lower-tier admin role/permission handling
- DB-backed app settings such as `registrationEnabled`
- host-aware observability links instead of `localhost`-only links
- syncing allowlisted `SUPERADMIN_EMAILS` into admin role membership on startup/login/auth flows
- a super-admin-only API-key settings cog in the chat model picker so super admins can always unset/update key expiry at the provider level, excluding `My Agents`
- reopening that provider settings cog now reloads saved provider values so super admins can edit only the field that changed instead of re-entering the whole config

#### Key files

Backend:

- `api/server/controllers/AdminController.js`
- `api/server/routes/admin/index.js`
- `api/server/middleware/adminAccess.js`
- `api/server/services/Admin/appSettings.js`
- `api/server/services/Admin/permissions.js`
- `api/server/services/Admin/superadmin.js`
- `api/server/middleware/validateRegistration.js`
- `api/models/index.js`
- `config/sync-superadmins.js`

Frontend/shared:

- `client/src/components/Admin/AdminConsole.tsx`
- `client/src/components/Chat/Menus/Endpoints/ModelSelectorContext.tsx`
- `client/src/components/Chat/Menus/Endpoints/components/EndpointItem.tsx`
- `client/src/components/Chat/Menus/Endpoints/components/EndpointModelItem.tsx`
- `client/src/components/Chat/Menus/Endpoints/components/SearchResults.tsx`
- `client/src/data-provider/Admin/index.ts`
- `client/src/data-provider/Admin/mutations.ts`
- `client/src/data-provider/Admin/queries.ts`
- `packages/data-provider/src/admin.ts`
- `packages/data-schemas/src/schema/adminRole.ts`
- `packages/data-schemas/src/schema/appSettings.ts`
- `packages/data-schemas/src/types/adminRole.ts`
- `packages/data-schemas/src/types/appSettings.ts`

#### Preserve during merges

- `/api/admin` route mounting and middleware
- `SUPERADMIN_EMAILS` sync behavior
- DB-backed app settings and registration gating
- host-aware admin observability links
- admin console UI and its data-provider wiring
- super-admin-only model-picker API-key settings access

---

### 3.2 Scheduled runs and notifications

#### What it adds

- per-user scheduled runs for prompts and agent executions
- manual run-now execution path
- scheduler runner process started by the backend
- scheduled-run target support for richer ephemeral-agent tool settings:
  - MCP server selection (`mcp[]`)
  - code interpreter (`execute_code`)
  - file search (`file_search`)
  - artifacts mode (`artifacts`)
  - Ollama web-search mode (`web_search_mode`)
- notification support for:
  - email
  - Twilio SMS
  - carrier email-to-SMS gateways
  - browser push notifications

#### Key files

Backend:

- `api/models/ScheduledJob.js`
- `api/server/routes/schedules.js`
- `api/server/controllers/ScheduledJobsController.js`
- `api/server/services/ScheduledJobs/cron.js`
- `api/server/services/ScheduledJobs/execution.js`
- `api/server/services/ScheduledJobs/runner.js`
- `api/server/services/ScheduledJobs/notifications.js`
- `api/server/services/ScheduledJobs/userNotifications.js`
- `api/server/utils/emails/scheduledRunNotification.handlebars`
- `api/server/utils/emails/scheduledRunSmsGateway.handlebars`
- `api/server/index.js`
- `api/server/experimental.js`

Frontend/shared:

- `client/src/components/Nav/SettingsTabs/Data/ScheduledRuns.tsx`
- `client/src/data-provider/Schedules/index.ts`
- `client/src/data-provider/Schedules/mutations.ts`
- `client/src/data-provider/Schedules/queries.ts`
- `client/public/assets/push-sw.js`
- `packages/data-provider/src/schedules.ts`
- `packages/data-schemas/src/schema/scheduledJob.ts`
- `packages/data-schemas/src/types/scheduledJob.ts`

#### Preserve during merges

- `/api/schedules` routes and controller
- backend startup hook for the scheduled runner
- scheduled-job schema/model/types
- scheduled-run target normalization for nested `ephemeralAgent` fields during create/update
- scheduled-run settings UI for MCP/tool/artifact/web-search options
- push service worker and browser notification plumbing
- env/config support for scheduled runner and notifications

#### Relevant env/config surface

- `SCHEDULED_RUNNER_*`
- `TWILIO_*`
- `WEB_PUSH_VAPID_*`
- `DOMAIN_CLIENT`

#### Lessons learned

- Scheduled-run edits must merge nested `target.ephemeralAgent` fields instead of replacing the whole object, or saved tool selections disappear on update.
- Keep UI and backend schemas aligned for every scheduled-run target field (`mcp`, `execute_code`, `file_search`, `artifacts`, `web_search_mode`) or the controller will silently drop user selections.
- `web_search_mode` is only meaningful for Ollama-backed scheduled runs, so the UI should gate it to Ollama endpoints and default safely elsewhere.

---

### 3.3 Default per-user model access restrictions plus admin overrides

#### What it adds

- new non-admin users get default model restrictions instead of full unrestricted model access
- admins keep full access
- admins can override per-user model permissions through the admin console
- server-side filtering and validation prevents users from choosing unauthorized models

#### Default policy currently documented in the branch

- `azureOpenAI`: all models
- `ollama`: all discovered Ollama models (local + cloud)
- `openAI`: `gpt-5.3-chat-latest`, `gpt-5.4-mini`, `gpt-5.4-nano`
- `anthropic`: sonnet 4.5/4.6, all haiku, all claude 3.x (no opus)
- `xai`: `grok-4-1-fast`

#### Key files

- `api/server/services/ModelAccess.js`
- `api/server/controllers/ModelController.js`
- `api/server/middleware/validateModel.js`
- `api/server/controllers/agents/v1.js`
- `api/server/controllers/assistants/v1.js`
- `api/server/controllers/assistants/v2.js`
- `api/server/services/AuthService.js`
- `api/server/services/PermissionService.js`
- `api/strategies/ldapStrategy.js`
- `api/strategies/openidStrategy.js`
- `api/strategies/process.js`
- `api/strategies/samlStrategy.js`
- `packages/data-schemas/src/schema/user.ts`
- `packages/data-schemas/src/types/user.ts`
- `client/src/components/Admin/AdminConsole.tsx`

#### Preserve during merges

- model-permission fields in user schema/types
- default-permission assignment on all user-creation paths
- model filtering for returned config/model lists
- server-side model validation enforcement in message/agent/assistant flows

---

### 3.4 Provider-native tools for OpenAI/Azure/Gemini

#### What it adds

- routes chat-bar tool toggles to provider-native capabilities when supported
- native handling for OpenAI/Azure web search, code interpreter, and file search
- native handling for Gemini search/code execution where safe
- file metadata tagging for native-tool flows
- OpenAI-native file/vector-store mirror behavior
- patches OpenAI/Azure Responses reasoning-summary handling to use completed summary parts and avoids fragmented thought boxes
- patches OpenAI/Azure Responses streaming to capture `web_search_call.in_progress`, `searching`, and `completed` status events and dispatch them as `on_web_search_status` graph events — the client shows an animated "Searching the web..." indicator inline in the message stream during native web search
- fixes `OpenAIReasoningDeltaHandler` to accept both `type: 'think'` (agents SDK normalized) and `type: 'text'` reasoning content, preventing silent drops of reasoning chunks on the `/v1/chat/completions` compat path
- merges consecutive client `think` parts before rendering so completed summary steps stay in one Thoughts block with paragraph spacing
- client behavior that avoids old LibreChat-specific auth prompts when native provider execution should own the flow

#### Key files

- `packages/api/src/agents/nativeTools.ts`
- `packages/api/src/agents/initialize.ts`
- `packages/api/src/agents/resources.ts`
- `api/server/controllers/agents/client.js`
- `api/server/services/Endpoints/agents/initialize.js`
- `api/server/services/Endpoints/agents/addedConvo.js`
- `api/server/services/Files/process.js`
- `api/app/clients/BaseClient.js`
- `client/src/Providers/BadgeRowContext.tsx`
- `client/src/components/Chat/Input/ToolsDropdown.tsx`
- `client/src/hooks/Files/useFileHandling.ts`
- `client/src/utils/endpoints.ts`
- `packages/data-schemas/src/schema/file.ts`
- `packages/data-schemas/src/types/file.ts`
- `packages/data-schemas/src/methods/file.ts`
- `config/apply-runtime-patches.js`
- `package.json`
- `Dockerfile`
- `client/src/components/Chat/Messages/Content/ContentParts.tsx`
- `client/src/utils/streamingReasoning.ts`
- `client/src/components/Chat/Messages/Content/Parts/WebSearchStatus.tsx`
- `client/src/hooks/SSE/useStepHandler.ts`
- `packages/data-provider/src/types/runs.ts`
- `packages/api/src/agents/openai/handlers.ts`
- `api/server/controllers/agents/callbacks.js`
- `api/server/controllers/agents/responses.js`

#### Preserve during merges

- native-tool file metadata fields
- OpenAI native upload/vector-store bookkeeping
- OpenAI/Azure reasoning summaries must continue to patch `@librechat/agents` to prefer completed `response.reasoning_summary_part.done` events over incremental fragment events
- web search status patches must continue to capture `response.web_search_call.*` events in the conversion function and dispatch `on_web_search_status` from the stream handler
- `OpenAIReasoningDeltaHandler` must accept `type: 'think'` alongside `type: 'text'` (the agents SDK normalizes all reasoning to `ContentTypes.THINK`)
- `ContentTypes.WEB_SEARCH_STATUS` must remain in `packages/data-provider/src/types/runs.ts` and `TMessageContentParts`
- `on_web_search_status` handler must remain in `callbacks.js` `getDefaultHandlers()` and in the Responses API handler
- consecutive client `think` parts must continue to be coalesced before rendering
- `config/apply-runtime-patches.js` must keep the stream-target validation guard that rejects any web-search status patch referencing `stepKey` before the local `stepKey` declaration
- the install/build pipeline must continue patching `@librechat/agents` during `npm install`, because host-side `node_modules` edits are excluded from the Docker build context
- Gemini fallback logic when native + structured tools would conflict
- client capability detection and UI routing

#### Lessons learned

- 2026-04-04 prod incident: a stable image still carried the legacy `graph.getStepIdByKey(stepKey)` web-search-status patch in `@librechat/agents`, which crashed GPT-5.4 / Responses streams with `Cannot access 'stepKey' before initialization` as soon as native web search status events arrived.
- Prevention: keep the runtime patch validator and Jest coverage in place, and rebuild the affected rail after any runtime-patch change so the containerized `node_modules` copy cannot drift behind the worktree fix.
- 2026-04-05 code interpreter failure: OpenAI Responses API rejects `reasoning` items (type `rs_…`) in reconstructed conversation history when the `id` field is present but the required following output item (e.g. `code_interpreter_call`) is not in the exact position the API expects. Fix: strip `id` from reasoning items during reconstruction in `_convertMessagesToOpenAIResponsesParams` and skip reasoning items that have no `summary` data. Patch added to `config/apply-runtime-patches.js` for both ESM and CJS dist targets.
- 2026-04-05 deployment slowness: **never use `--no-cache` for Docker builds** unless the Dockerfile or base image changed. The `COPY . .` layer already invalidates everything after it when source files change, so cache is only skipped for the frontend build (~10 min) and later steps. Using `--no-cache` forces a full `npm install` (~3 min) on top of that, turning a 12-min build into 25+ min. For small fixes (e.g. a runtime patch or a few TS/JS file changes), the fastest deployment path is: **(1)** patch files directly inside the running container via `docker exec python3 -c "..."`, **(2)** `docker restart <container>`, **(3)** schedule a proper cached image rebuild for the next maintenance window. Record every in-container hotfix in `apply-runtime-patches.js` so the next `docker compose build` bakes it in permanently.
- 2026-04-06 Langfuse Azure model naming: The `@langfuse/langchain` `CallbackHandler.extractModelNameFromMetadata()` reads `response_metadata.model_name` from the API response at generation END, overwriting the correct `azure-openai/gpt-5.4-mini` model name set at generation START via `invocationParams`. Azure API responses return bare model names without the `azure-openai/` prefix. Fix: disable `extractModelNameFromMetadata` (return `undefined`) in `@langfuse/langchain` so the START event model name from `invocationParams` is preserved. Patch added to `config/apply-runtime-patches.js` under `langfusePatchTargets`. Root cause chain: `AzureChatOpenAI.invocationParams()` → sets `params.model = 'azure-openai/X'` ✓ → Langfuse START uses it ✓ → Azure API responds with `model: 'X'` → Langfuse END overwrites with bare `'X'` ✗.
- 2026-04-06 Ollama Cloud 401 unauthorized: Single `apiKey: '${OLLAMA_API_KEY}'` was shared across local and cloud `baseURLs`. Cloud (`ollama.com/v1/`) requires user-provided auth keys, while local Ollama needs none. Fix: split into two separate custom endpoints in `librechat.yaml` — "Ollama" (local, server key `${OLLAMA_MULTI_API_KEY}`, `baseURL` + `baseURLs` for local instances only, `models.default` listing actually-running local models) and "Ollama Cloud" (`apiKey: 'user_provided'`, `baseURL: 'https://ollama.com/v1/'`, `models.default` with available cloud models from API key). Notes: (1) `models.default` array is required by Zod validation — omitting it crashes startup. (2) After splitting endpoints, the `☁` cloud tagging in `loadConfigModels.js` becomes inert for the local endpoint (no cloud URL → `hasCloudURL` is false) but users may see stale `☁`-tagged models from browser cache until they hard-refresh. (3) Local model names include the tag suffix (e.g. `qwen3:14b`) — these must match exactly what `ollama list` reports on `192.168.50.201`. (4) Set `fetch: false` for local Ollama — `fetch: true` pulls ALL 14 models from `/v1/models` API regardless of the `default` list, showing models like `gemini-3-flash-preview:latest` which are cloud-only stubs and fail locally with "unauthorized". (5) For Ollama Cloud, `fetch: true` is inert because `apiKey: 'user_provided'` is detected and fetch is skipped; only the `default` list is shown.
- 2026-04-06 Ollama agents "empty_messages" context window error: Agents endpoint uses `@librechat/api` `initializeAgent()` to calculate `maxContextTokens`. For Ollama/custom endpoints, `providerEndpointMap` has no entry, so `getModelMaxTokens()` returns `undefined` and the fallback was only 18000 tokens. With system instructions, tool schemas, and MCP tool definitions all counted against this budget, even a simple "hi" message could be pruned. Fix: increased the fallback from 18000 to 128000 in `packages/api/dist/index.js` (both `optionalChainWithEmptyCheck` fallback and `agentMaxContextNum` fallback). Patch added to `config/apply-runtime-patches.js` under `librechatApiPatchTargets`.

---

### 3.5 Google Gemini live model discovery, grounding, and capability-aware settings

#### What it adds

- model-family capability resolution for OpenAI/Azure settings, side-panel parameters, and agent model parameters
- GPT-5/o-series/search-preview-aware parameter gating for reasoning effort, sampling controls, stop sequences, verbosity, Responses API behavior, and provider-native web search
- live Gemini model discovery when `GOOGLE_MODELS` is not explicitly set
- capability metadata for Google models exposed into startup config
- capability-aware Google settings UI
- Gemini grounding metadata mapped into the existing citations / sources UX
- per-model reasoning setting behavior for Gemini model families
- stricter Gemini Search grounding allowlisting so older or unsupported Gemini/Gemma families do not expose unsupported `web_search` toggles

#### Key files

- `packages/data-provider/src/openai.ts`
- `packages/api/src/endpoints/models.ts`
- `packages/api/src/endpoints/google/llm.ts`
- `packages/api/src/endpoints/openai/llm.ts`
- `packages/data-provider/src/google.ts`
- `api/server/routes/config.js`
- `client/src/components/Endpoints/Settings/OpenAI.tsx`
- `client/src/components/Endpoints/Settings/Google.tsx`
- `client/src/components/SidePanel/Parameters/Panel.tsx`
- `client/src/components/SidePanel/Agents/ModelPanel.tsx`
- `client/src/utils/googleGrounding.ts`
- `api/server/controllers/agents/callbacks.js`

#### Preserve during merges

- OpenAI model-family capability heuristics for GPT-5/o-series/search-preview variants
- OpenAI settings/sidebar/agent-panel parameter disablement reasons and reasoning-effort option narrowing
- OpenAI request sanitization for unsupported sampling, stop, reasoning summary, verbosity, and Responses API requirements
- dynamic discovery behavior when `GOOGLE_MODELS` is unset
- `googleModelCapabilities` startup-config surface
- capability-aware settings behavior and disablement reasons
- stricter Gemini Search grounding allowlist in both UI and request builder
- grounding-to-citation translation pipeline

---

### 3.6 xAI custom-endpoint live model discovery and capability-aware settings

#### What it adds

- auto-detects xAI custom endpoints from endpoint name, `*.x.ai` base URLs, or explicit `defaultParamsEndpoint: 'xai'`
- the local `librechat.yaml` now includes a dedicated `xai` custom endpoint with a user-provided-key flow, bootstrap default models, and live discovery refresh after a user key is saved
- fetches live xAI model metadata from `/v1/language-models`
- filters the picker to text-compatible xAI chat models while preserving aliases
- publishes per-endpoint xAI capability metadata into startup config as `xaiModelCapabilities`
- adds a dedicated xAI settings panel instead of reusing the generic OpenAI custom-endpoint surface
- applies capability-aware setting disablement in the endpoint modal, the main parameter side panel, and the agent model panel
- normalizes outgoing xAI requests for Responses API behavior and strips unsupported parameters per model family
- adds local token/pricing coverage for Grok 4.20 variants

#### Key files

- `packages/data-provider/src/xai.ts`
- `packages/data-provider/src/parameterSettings.ts`
- `packages/data-provider/src/config.ts`
- `packages/api/src/endpoints/models.ts`
- `packages/api/src/endpoints/custom/config.ts`
- `packages/api/src/endpoints/openai/llm.ts`
- `api/server/routes/config.js`
- `api/server/controllers/ModelController.js`
- `client/src/components/Endpoints/Settings/XAI.tsx`
- `client/src/components/Endpoints/EndpointSettings.tsx`
- `client/src/components/SidePanel/Parameters/Panel.tsx`
- `client/src/components/SidePanel/Agents/ModelPanel.tsx`
- `packages/api/src/utils/tokens.ts`
- `api/models/tx.js`

#### Preserve during merges

- xAI custom-endpoint auto-detection from name/baseURL/defaultParamsEndpoint
- `/language-models` discovery and alias-preserving text-model filtering
- `xaiModelCapabilities` startup-config surface and refresh behavior
- dedicated xAI settings routing plus capability-aware disablement reasons
- xAI runtime sanitization in the OpenAI-compatible request builder
- Grok 4.20 token and pricing mappings

#### Supporting docs

- `XAI_CUSTOM_ENDPOINTS.md`

---

### 3.7 Ollama multi-source model discovery, hosted web search, and reasoning controls

#### What it adds

- treats the dedicated `Ollama` custom endpoint as a live multi-source discovery endpoint
- supports `baseURL` plus `baseURLs`
- tries `/api/tags` first and falls back to `/models`
- routes requests to the actual source URL for the selected Ollama model
- adds hosted web search modes:
  - `ollama_native`
  - `ollama_mcp`
- adds Ollama-specific reasoning controls and UI handling
- hides reasoning output when effort is `none`

#### Key files

- `packages/api/src/endpoints/models.ts`
- `packages/api/src/endpoints/custom/initialize.ts`
- `api/server/services/Config/loadConfigModels.js`
- `api/server/services/Tools/ollama.js`
- `api/server/mcp/ollama-search-fetch.js`
- `api/app/clients/OllamaClient.js`
- `api/app/clients/tools/util/handleTools.js`
- `client/src/components/Chat/Input/WebSearchSubMenu.tsx`
- `client/src/utils/ollamaReasoning.ts`
- `client/src/components/Chat/Messages/Content/Parts/Thinking.tsx`
- `client/src/components/Chat/Messages/Content/Parts/Reasoning.tsx`
- `.env.example`
- `librechat.example.yaml`

#### Preserve during merges

- `baseURLs` support and merged live discovery behavior (including `https://ollama.com/v1/` for cloud)
- per-model source routing via `resolveOllamaBaseURL` and `sourceMap`
- cloud model tagging: models from `ollama.com` get ` ☁` suffix in the picker for visual distinction; the tag is stripped in `initialize.ts` before routing/inference
- `web_search_mode` support and hidden MCP search/fetch server wiring
- Ollama reasoning profile and hidden reasoning behavior
- `OLLAMA_API_KEY` handling for hosted search/fetch modes and cloud model auth

---

### 3.8 MCP interoperability and OAuth hardening for OpenAI / Arcade-hosted MCP tools

#### What it adds

- extends the MCP JSON-schema normalization path so bare no-input object schemas are converted to OpenAI-compatible parameter schemas by injecting `properties: {}` when neither `properties` nor `additionalProperties` is present
- preserves explicitly open schemas that rely on `additionalProperties`, instead of forcing empty properties into them
- refreshes OAuth tokens for Arcade-style protected resources by discovering the token endpoint from stored `oauthMetadata.authorization_servers` instead of guessing from the MCP server URL path
- resolves MCP OAuth callback URLs with explicit `DOMAIN_SERVER` precedence, then forwarded-host headers, then request host/protocol fallback
- sets the local Docker override to `DOMAIN_SERVER=http://localhost:${PORT:-3080}` so Arcade Microsoft OAuth can use the loopback redirect exemption during local runs
- distinguishes LibreChat MCP initialization from downstream provider consent: a tool returning `authorization_url` / `llm_instructions` means the MCP server is connected and the remaining step is provider-side authorization

#### Key files

- `packages/api/src/mcp/zod.ts`
- `packages/api/src/mcp/__tests__/zod.spec.ts`
- `packages/api/src/mcp/oauth/handler.ts`
- `packages/api/src/mcp/MCPConnectionFactory.ts`
- `packages/api/src/mcp/__tests__/handler.test.ts`
- `api/server/routes/mcp.js`
- `api/server/routes/__tests__/mcp.spec.js`
- `docker-compose.local.override.yml`

#### Preserve during merges

- bare object MCP input schemas must continue to normalize to include empty `properties` before OpenAI-compatible tool calls are sent
- explicitly open object schemas with `additionalProperties` must remain untouched by that fix
- OAuth refresh must continue to prefer stored protected-resource `authorization_servers` metadata before attempting discovery from the MCP server URL
- callback URL precedence must remain: valid `DOMAIN_SERVER` -> `X-Forwarded-*` headers -> request host/protocol
- the local default `DOMAIN_SERVER=http://localhost:${PORT:-3080}` should remain in the local Docker override unless intentionally replacing it with a public HTTPS URL
- provider authorization prompts returned from Arcade Microsoft tools should not be treated as LibreChat MCP initialization failures

#### Validation notes

- `packages/api/src/mcp/__tests__/zod.spec.ts` covers the bare-object schema normalization behavior
- `packages/api/src/mcp/__tests__/handler.test.ts` covers resource-metadata-based OAuth refresh behavior
- `api/server/routes/__tests__/mcp.spec.js` includes callback URL precedence coverage, although the suite is still blocked locally by the existing Alpine `mongodb-memory-server` limitation
- live validation on this branch connected to `https://api.arcade.dev/mcp/microsoft-tools`, listed 24 tools, and advanced `MicrosoftOnedrive_WhoAmI` plus `MicrosoftOnedrive_GetMyDrive` to provider authorization prompts instead of failing MCP initialization

#### MCP domain filter mode (allow list vs deny list)

**What it adds:**
- adds `mcpDomainFilterMode` field (`'allowlist'` | `'denylist'`) to `AppSettings` schema, defaulting to `'denylist'`
- admin UI now shows a filter mode dropdown (deny list / allow list) and dynamically relabels the domain list as "Blocked domains" or "Allowed domains"
- in deny list mode: all domains are allowed except those explicitly listed (SSRF protection always active)
- in allow list mode: only listed domains are allowed (original behavior)
- the mode is threaded through the full stack: Mongoose schema, data-provider zod types, `isDomainAllowedCore()`, `isMCPDomainAllowed()`, `MCPServerInspector.inspect()`, `MCPServersRegistry`, `initializeMCPs.js`, and runtime domain checks in `MCP.js`

**Key files:**
- `packages/data-schemas/src/types/appSettings.ts` — `MCPDomainFilterMode` type
- `packages/data-schemas/src/schema/appSettings.ts` — Mongoose field
- `packages/data-provider/src/admin.ts` — zod schemas for admin settings
- `packages/api/src/auth/domain.ts` — `DomainFilterMode` type, `matchesDomainList()` helper, denylist logic in `isDomainAllowedCore()`
- `packages/api/src/mcp/registry/MCPServerInspector.ts` — `filterMode` parameter
- `packages/api/src/mcp/registry/MCPServersRegistry.ts` — stores and passes `domainFilterMode`
- `api/server/services/Admin/appSettings.js` — persists `mcpDomainFilterMode`
- `api/server/services/MCP.js` — `getMergedMCPDomainConfig()` returns `{ domains, filterMode }`
- `api/server/services/initializeMCPs.js` — passes `domainFilterMode` to registry
- `client/src/components/Admin/AdminConsole.tsx` — mode dropdown and dynamic labels
- `client/src/locales/en/translation.json` — new i18n keys

**Preserve during merges:**
- `mcpDomainFilterMode` default must remain `'denylist'` to avoid breaking existing deployments
- the deny list logic in `isDomainAllowedCore` must keep SSRF protection active regardless of mode
- `getMergedMCPDomainConfig()` replaces the old `getMergedMCPAllowedDomains()` function

#### MCP auto-connect on tab open

**What it adds:**
- new `useAutoConnectMCP` hook auto-initializes disconnected non-OAuth MCP servers when a browser tab opens
- uses `autoSelect=false` on `initializeServer()` so servers connect but are NOT added to the chat conversation
- `initializeServer()` in `useMCPServerManager` now accepts a third `autoSelect` parameter (default `true`)
- integrated into `useAppStartup.ts` after server list and connection status load

**Key files:**
- `client/src/hooks/MCP/useAutoConnectMCP.ts` — new hook
- `client/src/hooks/MCP/useMCPServerManager.ts` — `autoSelect` parameter on `initializeServer()`
- `client/src/hooks/Config/useAppStartup.ts` — integrates auto-connect

**Preserve during merges:**
- the `autoSelect` parameter must default to `true` for backward compatibility with manual initialization
- the auto-connect hook must skip OAuth-required servers (user must manually auth those)

---

### 3.9 Local runtime / Docker / startup / observability / worktree conventions

#### What it adds

- `LibreChat-custom` is the runnable customization worktree
- `LibreChat` is the upstream-sync worktree
- helper scripts make the custom worktree runnable by linking runtime-only secret/data files from the upstream worktree while keeping the local Docker override checked into the customization worktree
- standardized detached Docker startup from the custom worktree
- separate Prometheus and Grafana/Loki sidecar stacks
- user-level systemd services for auto-start
- Ollama keep-warm timer/service
- optional admin-only patched-remote image path
- devcontainer persistence behavior
- secret/runtime ignore patterns in `.gitignore`
- MCP OAuth callback URLs with `DOMAIN_SERVER`-first resolution plus forwarded/request-host fallback
- local loopback `DOMAIN_SERVER` default in the Docker override for Arcade Microsoft OAuth

#### Key files

- `README.local.md`
- `UPSTREAM_RELEASE_UPDATE.local.md`
- `LOCAL_UPSTREAM_SYNC_WORKFLOW.local.md`
- `docker-compose.local.override.yml`
- `Dockerfile`
- `Dockerfile.remote-patched`
- `docker-compose.remote-patched.override.yml`
- `.devcontainer/devcontainer.json`
- `.devcontainer/docker-compose.yml`
- `local-services/ensure-runtime-files.sh`
- `local-services/start-all.sh`
- `local-services/stop-all.sh`
- `local-services/status-all.sh`
- `local-services/install-user-service.sh`
- `local-services/enable-on-boot.sh`
- `local-services/disable-on-boot.sh`
- `local-services/keep-ollama-warm.sh`
- `api/server/routes/mcp.js`
- `packages/api/src/mcp/oauth/handler.ts`
- `.gitignore`
- `litellm/config.yaml`
- `litellm/custom_callbacks.py`
- `langfuse/sync_model_pricing.py`

#### Preserve during merges

- always run from `/pool/home/timeng/LibreChat-custom`
- runtime symlink convention created by `ensure-runtime-files.sh` for secrets/runtime data only
- `COMPOSE_PROJECT_NAME=librechat` for the custom app stack
- separate exporter compose stacks for Prometheus and Grafana/Loki
- Grafana/Loki should tail `/pool/home/timeng/LibreChat-custom/logs` for this worktree
- user service units pointing to the custom worktree
- devcontainer persistence settings
- LiteLLM file-path expectations if LiteLLM is re-enabled
- MCP OAuth callback redirect URIs should prefer a valid `DOMAIN_SERVER`, then forwarded headers, then request host/protocol
- the local default `DOMAIN_SERVER=http://localhost:${PORT:-3080}` should remain documented because local Arcade Microsoft OAuth depends on the loopback exception

#### Runtime files linked into the custom worktree

- `.env`
- `librechat.yaml`
- `langfuse/.env`
- `data-node`
- `meili_data_v1.35.1`
- `images`
- `uploads`
- `logs`

---

### 3.10 Realtime voice broker, websocket transport, and live audio UX

#### What it adds

- a chat-input **Realtime Voice** flow backed by a LibreChat websocket broker instead of one-off text turns
- authenticated realtime model discovery at `/api/realtime/models` plus websocket sessions at `/api/realtime/ws`
- provider-brokered live voice sessions for OpenAI realtime, Azure OpenAI realtime, Gemini Live, and xAI-compatible realtime endpoints
- client microphone capture, PCM playback, live transcript rendering, and session controls in the realtime dialog
- transcript persistence back into normal LibreChat conversations through `/api/realtime/conversation`, so completed live sessions appear in the left sidebar like standard chats
- post-launch hardening for:
  - stable provider/model/voice picker state during async refreshes
  - in-dialog custom model/voice selectors so the picker does not collapse immediately inside the modal
  - connect-failure reset back to `idle`
  - source-priority assistant transcript assembly to avoid duplicated/corrupted text
  - surfaced microphone permission/startup failures
  - muted local mic monitoring to avoid echo/feedback
  - honest provider-specific controls such as Gemini `Stop audio` instead of fake `Stop reply`
  - live xAI realtime model discovery/validation instead of hardcoded voice model assumptions
  - Azure-specific transcription handling and availability validation
  - websocket auth refresh on connect so stale short-lived JWTs do not cause avoidable realtime connection failures
  - backend cookie-auth fallback for same-origin realtime websocket upgrades when the query token is stale or unavailable
  - unmount-only realtime cleanup so a rerender does not close the websocket during initial connection startup
  - automatic live-session save on disconnect, reconnect, and dialog close using the existing conversation import pipeline instead of a separate transcript store

#### Key files

- `api/server/index.js`
- `api/server/controllers/RealtimeController.js`
- `api/server/services/Realtime/*`
- `packages/data-provider/src/api-endpoints.ts`
- `packages/data-provider/src/data-service.ts`
- `packages/data-provider/src/keys.ts`
- `client/src/components/Chat/Input/Realtime/RealtimeButton.tsx`
- `client/src/components/Chat/Input/Realtime/RealtimeDialog.tsx`
- `client/src/data-provider/mutations.ts`
- `client/src/hooks/Realtime/useRealtimeSession.ts`
- `client/src/hooks/Realtime/useRealtimeMicrophone.ts`
- `client/src/hooks/Realtime/usePCMPlayer.ts`

#### Preserve during merges

- `/api/realtime/models` route mounting, `/api/realtime/ws` broker initialization, and `/api/realtime/conversation` persistence handling
- provider adapter split and live realtime model discovery/validation logic
- client-side token refresh before websocket connect
- stable picker state and failed-connect reset behavior
- transcript source-priority assembly and local mic mute behavior
- sidebar persistence through the existing conversation import/save path when live sessions end
- provider-honest cancel/stop affordances, especially Gemini limitations

#### Supporting docs

- `REALTIME_VOICE.md`

---

### 3.11 Local code interpreter bridge and warm-session runtime reuse

#### What it adds

- a self-hosted LibreChat Code API compatible bridge under `local-code-interpreter/`
- a `code-interpreter-local` compose service backed by `llm-sandbox`
- default managed/local code-execution routing for OpenAI, Azure OpenAI, and Google instead of provider-native execution
- persistent local workspaces plus warm runtime reuse keyed by LibreChat `session_id`
- startup prewarm so trivial first Python executions are usually already warm by the time the UI is ready

#### Key files

- `docker-compose.local.override.yml`
- `local-code-interpreter/app/main.py`
- `local-code-interpreter/app/settings.py`
- `local-code-interpreter/app/adapters/base.py`
- `local-code-interpreter/app/adapters/llm_sandbox.py`
- `local-code-interpreter/data/`

#### Preserve during merges

- `code-interpreter-local` service wiring and `LIBRECHAT_CODE_BASEURL` override
- `OPENAI_CODE_INTERPRETER_ROUTING`, `AZURE_OPENAI_CODE_INTERPRETER_ROUTING`, and `GOOGLE_CODE_INTERPRETER_ROUTING`
- warm-session reuse, startup prewarm, and persistent workspace behavior
- the adapter contract so the backend can be swapped without further LibreChat app changes
- `LOCAL_CODE_WORKSPACE_HOST_ROOT` absolute-host-path handling

#### Supporting docs

- `LOCAL_CODE_INTERPRETER_INTEGRATION.md`

---

### 3.12 Langfuse pricing sync, historical backfill, and alias-aware observability

#### What it adds

- a dedicated `langfuse-model-pricing-sync` service in the local stack
- config-driven Langfuse pricing sync for configured provider model lists, custom endpoint defaults, generalized xAI/Grok families, and zero-cost local Ollama models
- ClickHouse backfill that repairs historical generations when pricing or token counts were missing at ingest time
- alias-aware pricing via `AZURE_OPENAI_MODELS` and `LANGFUSE_MODEL_ALIAS_MAP` in `./langfuse/.env` so Touchdown's `azure-openai/<deployment>` traces and other custom Azure deployment names can still inherit canonical pricing families
- shared Langfuse credentials and base URL conventions that can also be reused by Touchdown host runtimes
- shared Grafana/Loki ingestion for `/pool/home/timeng/touchdown/logs` and `/pool/home/timeng/touchdown/logs_backward`

#### Key files

- `docker-compose.local.override.yml`
- `langfuse/sync_model_pricing.py`
- `README.local.md`
- `README.md`
- `local-services/start-all.sh`
- `/pool/home/timeng/librechat_exporter/grafana-loki-dev/promtail-config.yml`

#### Pitfalls

- **Langfuse v3 memory defaults are too low for sustained use.** The compose defaults (`768m` for ClickHouse, `600m` for langfuse-web and langfuse-worker) cause OOM crash-loops under normal operation. ClickHouse OOMs during background merge tasks; langfuse-web OOMs because the Next.js 15 app exceeds the default Node.js heap derived from a 600m container. Set these overrides in `.env`:
  - `LIBRECHAT_LANGFUSE_CLICKHOUSE_MEM_LIMIT=1536m`
  - `LIBRECHAT_LANGFUSE_WEB_MEM_LIMIT=1024m`
  - `LIBRECHAT_LANGFUSE_WORKER_MEM_LIMIT=1024m`
- When ClickHouse crash-loops, `langfuse-web` and `langfuse-worker` cannot start because they depend on a healthy ClickHouse via `depends_on`. The symptom is "connection refused" on the Langfuse web port even though Docker shows the container as "Up" — it is restart-looping too fast to serve requests. Check `docker logs` for `JavaScript heap out of memory` or repeated ClickHouse entrypoint output.

#### Preserve during merges

- the `langfuse-model-pricing-sync` service and its `./langfuse/.env` loading
- config-driven provider/custom-endpoint discovery instead of a short hardcoded pricing list
- ClickHouse backfill for old traces with missing pricing/token metadata
- zero-cost local Ollama pricing behavior and alias-aware Azure deployment mapping
- the shared Touchdown tracing convention that reuses the same Langfuse project/keys
- the shared Grafana/Loki log mounts for Touchdown and Backwards Touchdown host runtimes
- the `LIBRECHAT_LANGFUSE_*_MEM_LIMIT` overrides in `.env` — do not let these get dropped during env file refreshes

---

### 3.13 Azure direct Azure OpenAI / Azure AI Foundry per-user support

#### What it adds

- built-in `azureOpenAI` endpoint support for user-provided Azure OpenAI or Azure AI Foundry base URLs
- Azure OpenAI-compatible `GET /models` discovery when the configured endpoint supports it
- comma-separated manual deployment-name fallback when live discovery is unavailable
- saved per-user Azure endpoint/key/deployment values that reload into the settings dialog on reopen without overwriting the shared cached model list for other users

#### Key files

- `packages/api/src/endpoints/models.ts`
- `packages/api/src/endpoints/openai/initialize.ts`
- `packages/api/src/endpoints/openai/llm.ts`
- `packages/data-provider/src/azure.ts`
- `packages/api/src/endpoints/models.spec.ts`
- `packages/api/src/endpoints/openai/config.backward-compat.spec.ts`
- `client/src/components/Input/SetKeyDialog/OpenAIConfig.tsx`
- `client/src/components/Chat/Menus/Endpoints/ModelSelectorContext.tsx`

#### Preserve during merges

- `AZURE_API_KEY=user_provided` and `AZURE_OPENAI_BASEURL=user_provided` direct-user-config flow
- Azure AI Foundry project URL normalization and OpenAI-compatible model discovery
- manual deployment fallback and saved-value reload behavior in the settings dialog
- per-user Azure config loading without poisoning the shared Azure model cache
- Azure `/openai/v1` paths must NOT include `api-version` query parameter (the v1 API rejects it with HTTP 400); `config.ts` and `initialize.ts` now conditionally omit `api-version` when `supportsAzureOpenAIModelListing(baseURL)` returns true

#### Supporting docs

- `README.md` (Azure direct endpoint notes)

---

### 3.14 Background audio/video transcription with persistent conversations

#### What it adds

- uploading any audio or video file auto-triggers a background transcription job
- a dedicated conversation is created immediately with a "Transcribing..." placeholder response; the user can navigate away and the job runs asynchronously
- background runner polls a MongoDB-backed job queue with lease/lock semantics (horizontally scalable, crash-safe)
- video files are converted to mp3 via ffmpeg; oversized uploads are normalized to mono 16 kHz mp3 and chunked into <=23 MB segments before sending to the STT provider
- completed transcript text is stored in the file's `text` field and the response message is updated in place
- the conversation persists in the sidebar like any other chat, so the user can return, read the transcript, and continue chatting with it
- the attach-file menu now accepts `audio/*` and `video/*` MIME types for all document-supporting providers
- **session-scoped controls**: transcription model, prompt, and diarization speaker references now live in the per-conversation parameters popover, so each chat session can keep its own transcription behavior just like chat-model settings
- **diarization**: when `gpt-4o-transcribe-diarize` is selected, the backend automatically sets `response_format=diarized_json` and `chunking_strategy=auto`, can attach up to 4 named 2-10 second speaker reference clips as `known_speaker_*` inputs, and formats speaker-labeled segments as `[speaker_N]: text`
- **prompt support**: the session-level "Transcription Prompt" textarea is enabled for `whisper-1`, `gpt-4o-transcribe`, and `gpt-4o-mini-transcribe`; the diarize model disables the field and the backend suppresses prompt submission for that model
- **chunk continuity**: later chunks for prompt-capable models reuse trailing transcript context so large uploads preserve terminology and naming across chunk boundaries

- `api/server/services/Files/Audio/transcribeMediaFile.js` -- ffmpeg-based media processing, format normalization, chunking, STT orchestration; `buildOverrides()` computes model-specific params; `buildChunkPrompt()` carries prompt/context across chunks; `formatDiarizedSegments()` renders speaker labels

- `api/server/services/Files/Audio/transcribeMediaFile.js` -- ffmpeg-based media processing, format normalization, chunking, STT orchestration; `buildOverrides()` computes model-specific params; `formatDiarizedSegments()` renders speaker labels
- `api/server/services/Files/Audio/transcriptionQueue.js` -- background runner, MongoDB lease-based job queue, conversation/message persistence; passes `transcriptionModel`, `prompt`, and named speaker references from metadata to `transcribeMediaFile`
- `api/server/services/Files/Audio/STTService.js` -- `getInstance()` changed from async to sync; `openAIProvider()` and `sttRequest()` accept optional `overrides` for model, prompt, response_format, chunking_strategy, and diarization speaker-reference arrays; `sttRequest()` returns the full response object for diarized_json format
- `api/server/routes/files/files.js` -- `POST /api/files/transcribe` plus `POST /api/files/transcription-reference` for validated speaker reference uploads
- `api/server/index.js` / `api/server/experimental.js` -- starts the transcription runner on server boot
- `client/src/hooks/Files/useFileHandling.ts` -- exposes `transcribeUploadedFile` callback for the inline bar, polls for completion, and sends transcription settings and speaker references in the request payload; auto-transcription on upload is disabled
- `client/src/components/Chat/Input/Files/AudioTranscriptionBar.tsx` -- inline transcription controls in the chat compose area: model dropdown, expandable prompt textarea, diarization speaker reference upload (up to 4 clips), and explicit "Transcribe" button
- `client/src/components/Chat/Input/ChatForm.tsx` -- wires AudioTranscriptionBar between the file preview row and the textarea
- `client/src/components/Chat/Input/Files/AttachFileMenu.tsx` -- broadened file acceptance to include audio/video
- `client/src/components/Endpoints/Settings/TranscriptionSettings.tsx` -- session-level transcription model/prompt UI in the endpoint settings panel (secondary location; primary is now the inline bar)
- `packages/data-schemas/src/schema/file.ts` / `types/file.ts` -- added `metadata.transcription` sub-document schema including `transcriptionModel` and `prompt` fields
- `packages/data-provider/src/types/files.ts` / `packages/data-provider/src/schemas.ts` -- conversation/file/request types extended with session-level transcription fields and speaker-reference metadata
- `packages/data-provider/src/data-service.ts` -- `startAudioTranscription()` plus `uploadTranscriptionReference()` client functions
- `packages/data-provider/src/api-endpoints.ts` -- `fileTranscribe()` and `fileTranscriptionReference()` endpoints

#### Runtime requirements

- `speech.stt.openai` (or Azure equivalent) must be configured in `librechat.yaml` with a valid API key
- `ffmpeg-static` and `ffprobe-static` npm packages are bundled in `api/package.json`
- the background runner starts automatically; no separate process is needed
- `gpt-4o-transcribe` / `gpt-4o-mini-transcribe` / `gpt-4o-transcribe-diarize` require an OpenAI API key with access to these models

#### Lessons learned

- the Mongoose file schema must explicitly declare `metadata.transcription` sub-fields; using `Schema.Types.Mixed` for metadata caused `$set` to silently overwrite the nested transcription object when other file updates ran concurrently
- `STTService.getInstance()` was marked `async` but only did `return new STTService()`; callers in background workers that didn't `await` it got a Promise instead of an instance, causing `getProviderSchema is not a function` at runtime
- the `updateFile` method uses `$set` on the entire `metadata` field, so callers must spread existing metadata to avoid losing sibling keys
- `gpt-4o-transcribe-diarize` does not support the `prompt` parameter; the backend/UI must suppress it before sending
- diarized responses return `segments` instead of plain `text`; the backend must detect this and format as `[speaker]: text` for human readability
- auto-transcription on upload was removed in favor of an explicit inline `AudioTranscriptionBar` in the chat compose area; users pick a model, set a prompt, optionally add diarization speaker clips, and click "Transcribe" when ready instead of the system immediately consuming the file
- the ChatForm compose box has a parent `onClick={handleContainerClick}` that calls `textAreaRef.current?.focus()`; any interactive child elements (textareas, inputs) inside the compose box must call `event.stopPropagation()` on both `onClick` and `onMouseDown` to prevent the parent from stealing focus
- `updateMessage` in the transcription queue runner can throw "Message not found" if the user deletes the conversation while a transcription is in progress; both `completeTranscriptionJob` and `failTranscriptionJob` must wrap `updateMessage` in try/catch to prevent the runner from crashing
- transcription model/prompt settings should use global Recoil atoms (stored in localStorage) as the primary source, falling back to conversation-level fields; burying controls only in the Settings panel or endpoint settings makes the feature invisible
- the transcription queue's `buildRunnerRequest` constructs a fake `req` object with `{ user: { id: file.user } }` which must match the user ID format used by `saveMessage`/`updateMessage`
- transcription progress should not reuse LibreChat's normal `unfinished: true` assistant-message path for long-running background work; that path renders the red "response is incomplete" warning and makes healthy background processing look broken
- for background transcription UX, store an explicit `metadata.transcriptionStatus` (`processing` / `completed` / `failed`) on the response message, keep `unfinished: false`, and let the client poll against that metadata instead of the generic incomplete-message semantics
- multi-chunk transcription should emit partial transcript updates after each completed chunk; an `onChunkComplete` callback in `transcribeMediaFile` gives the queue runner a safe hook to persist quasi-streaming progress without changing the STT provider contract
- navigating into a freshly created transcription conversation must clear stale `latestMessage` Recoil state before render, otherwise a prior error-state message can leave `isNotAppendable` stuck true and block follow-up questions in the new transcript chat
- starting a transcription from `/c/new` must aggressively clear the draft file state for the source compose box (`setFiles(new Map())`, remove preview cache entries, and remove `filesDraft_new` from localStorage) before navigation, otherwise the uploaded audio can leak into later new chats

### 3.15 Google auth mode support (API key, Vertex service account, Vertex ADC)

#### What it adds

- three authentication modes for Google/Vertex AI integrations: Gemini API key, Vertex AI service account JSON, and Vertex AI application default credentials (ADC)
- a shared credential resolution layer (`prepareGoogleCredentials`, `resolveGoogleClientAuth`) so all Google-consuming paths (chat, realtime voice, image generation) use the same auth logic
- the `GOOGLE_AUTH_MODE` env var (values: `api_key`, `vertex_service_account`, `vertex_application_default`) with automatic fallback detection when omitted
- the `GOOGLE_VERTEX_PROJECT` and `GOOGLE_VERTEX_LOCATION` env vars for explicit Vertex project/region overrides
- ADC support via `GOOGLE_APPLICATION_CREDENTIALS` or `gcloud auth application-default login`
- a redesigned Google endpoint settings UI (`GoogleConfig.tsx`) with an auth mode dropdown, conditional field rendering (API key input vs. service account upload vs. project/location fields), and atomic multi-field key updates
- validation in `SetKeyDialog` that checks mode-specific required fields before allowing save
- `AuthKeys` enum extended with `GOOGLE_AUTH_MODE`, `GOOGLE_VERTEX_PROJECT`, `GOOGLE_VERTEX_LOCATION`
- new `GoogleAuthMode` enum in `packages/data-provider/src/config.ts`
- the Google endpoint is now marked available when any valid auth mode is configured, not just when `GOOGLE_KEY` is set
- Gemini Live realtime sessions support all three auth modes via `resolveGoogleRealtimeAuth()` in `modelService.js`
- Gemini image generation (`GeminiImageGen.js`) supports all three auth modes with API-key-first priority

#### Key files

- `packages/api/src/endpoints/google/auth.ts` -- shared credential helpers
- `packages/api/src/endpoints/google/auth.spec.ts` -- tests for credential resolution
- `packages/api/src/endpoints/google/llm.ts` -- refactored to use shared auth
- `packages/api/src/endpoints/google/llm.spec.ts` -- auth-mode-aware tests
- `packages/api/src/endpoints/google/initialize.ts` -- refactored credential assembly
- `packages/api/src/types/google.ts` -- extended Google types
- `packages/data-provider/src/config.ts` -- `GoogleAuthMode` enum, extended `AuthKeys`
- `api/server/services/Config/loadAsyncEndpoints.js` -- auth-mode-aware endpoint availability
- `api/server/services/Realtime/modelService.js` -- `resolveGoogleRealtimeAuth()`
- `api/server/services/Realtime/providers/GeminiRealtimeAdapter.js` -- accepts `clientOptions`
- `api/server/services/Realtime/broker.js` -- passes `clientOptions` to adapter
- `api/app/clients/tools/structured/GeminiImageGen.js` -- three-mode auth for image gen
- `client/src/components/Input/SetKeyDialog/GoogleConfig.tsx` -- auth mode UI
- `client/src/components/Input/SetKeyDialog/SetKeyDialog.tsx` -- Google validation
- `client/src/components/Input/SetKeyDialog/HelpText.tsx` -- ADC help text
- `client/src/locales/en/translation.json` -- new localization keys
- `.env.example` -- `GOOGLE_AUTH_MODE`, `GOOGLE_VERTEX_PROJECT`, `GOOGLE_VERTEX_LOCATION`, `GOOGLE_APPLICATION_CREDENTIALS`

#### Runtime requirements

- API key mode: `GOOGLE_KEY` or a user-saved key
- Service account mode: a Google Cloud service account JSON file (uploaded via UI or set via `GOOGLE_SERVICE_KEY_FILE`)
- ADC mode: `GOOGLE_APPLICATION_CREDENTIALS` pointing to a credentials file, or `gcloud auth application-default login` run on the host
- Vertex modes also require a Google Cloud project ID (auto-detected from service account JSON, or set via `GOOGLE_VERTEX_PROJECT` / `GOOGLE_CLOUD_PROJECT`)
- Location defaults to `us-central1` if not set

#### Lessons learned

- `parseGoogleCredentials` must use strict JSON parsing for string credentials; a broad raw-string fallback breaks existing contracts where raw API keys require explicit `acceptRawApiKey` opt-in
- when `GOOGLE_KEY` is server-configured (not `user_provided`), realtime/image-gen helpers must skip the `getUserValues()` database lookup to avoid unnecessary DB hits and prevent saved user credentials from overriding server auth config
- bare `GOOGLE_CLOUD_PROJECT` without an explicit `GOOGLE_AUTH_MODE` or `GOOGLE_APPLICATION_CREDENTIALS` must not trigger ADC detection, or projects that only use API keys with a project env var will incorrectly attempt ADC auth

### 3.16 Math and computation tools (Scientific Calculator + Code Interpreter Math)

#### What it adds

- **Scientific Calculator** (`scientific_calculator`) — a structured tool using mathjs for precise math: PEMDAS arithmetic, trigonometry, logarithms, statistics (mean, median, std, variance), combinatorics, unit conversions, matrix operations, and complex numbers. Typed JSON schema so LLMs know exactly what operations are available.
- **Code Interpreter Math** (`code_interpreter_math`) — a structured tool that routes advanced computation to the local code interpreter (Python). Use for symbolic algebra (sympy), statistical tests (scipy), numerical methods, optimization, and multi-step computations.
- Both tools coexist with the upstream `calculator` plugin. The Scientific Calculator supersedes it with a richer schema.
- Code Interpreter Math gracefully degrades to an error message when the code interpreter service is unavailable.

#### Key files

- `api/app/clients/tools/structured/ScientificCalculator.js`
- `api/app/clients/tools/structured/CodeInterpreterMath.js`
- `api/app/clients/tools/structured/specs/ScientificCalculator.spec.js`
- `api/app/clients/tools/structured/specs/CodeInterpreterMath.spec.js`
- `api/app/clients/tools/manifest.json` (two new entries)
- `api/app/clients/tools/index.js` (two new exports)
- `api/app/clients/tools/util/handleTools.js` (two new constructor mappings)
- `MATH_TOOLS.md` (focused doc)

#### Preserve during merges

- `manifest.json` entries for `scientific_calculator` and `code_interpreter_math`
- `handleTools.js` constructor mappings for both keys
- `index.js` exports for `ScientificCalculator` and `CodeInterpreterMath`

#### Relevant env/config surface

- `LIBRECHAT_CODE_BASEURL` — code interpreter endpoint (shared with existing code interpreter)
- `LIBRECHAT_CODE_API_KEY` — code interpreter API key (shared)

---

### 3.17 Cross-cutting lessons learned and repeat patterns

These are recurring lessons from the focused docs plus past Droid sessions for this repo.

- prefer live model/capability discovery over hardcoded provider assumptions whenever the provider exposes metadata
- keep transient picker/dialog state local and stable; do not continuously derive controlled state from async config refreshes
- visibly gate unsupported controls with inline reasons in the UI and also sanitize unsupported parameters server-side
- treat transport success, MCP server init success, and downstream provider authorization as separate states
- warm slow runtimes proactively: reuse sessions, prewarm sandboxes, and keep frequently used local models loaded
- backfill observability/pricing data when ingest-time metadata was incomplete, and map deployment aliases back to canonical model families when necessary
- restart and validate from `/pool/home/timeng/LibreChat-custom`, because this is the canonical runnable worktree for the custom stack
- refresh auth before opening realtime websockets, because normal login JWTs are short-lived and realtime does not get automatic HTTP retry semantics
- for same-origin realtime websockets, keep an authenticated-cookie fallback on the backend instead of relying exclusively on query-string bearer tokens
- effect cleanups that own live sockets/audio sessions should be wired for true unmount cleanup, not for every render-time callback identity change
- interactive child elements inside the ChatForm compose box (which has an `onClick` that focuses the main textarea) must call `event.stopPropagation()` on click and mousedown to prevent focus theft; this applies to any inline controls added between the file preview row and the textarea
- background job runners that update messages or conversations must handle the case where the user has deleted the conversation while the job was in progress; wrap updateMessage/updateConversation calls in try/catch and log a warning instead of crashing the runner
- upstream features that depend on `librechat.yaml` config sections (like `memory:`) will silently no-op if the section is absent; the code returns early on `!config` rather than throwing, so missing config looks like a working app with the feature quietly disabled; always verify that new upstream features have their config section added to the runtime `librechat.yaml`
- `provider` values in `librechat.yaml` memory/agent config must use `EModelEndpoint` casing (e.g., `"openAI"` not `"openai"`); `getProviderConfig` in `packages/api/src/endpoints/config.ts` does a case-sensitive lookup against `providerConfigMap` and its lowercase fallback only checks `provider.toLowerCase()`, which does not help when the correct key is camelCase like `"openAI"`
- the API container's original default `mem_limit` (768m) was too tight for concurrent agent + memory agent processing with image uploads; Node.js auto-detects a ~396 MB heap from a 768m container, which OOMs under load; the fix is per-rail limits in `rail-env.sh` (`LIBRECHAT_API_MEM_LIMIT` and `LIBRECHAT_API_NODE_MAX_OLD_SPACE`) driving `NODE_OPTIONS=--max-old-space-size=<value>` in the compose environment; stable gets 3072m/2048MB heap, dev gets 1536m/1024MB heap; uploaded images are base64-encoded in the request body and can consume tens of MBs of heap per request, so the heap must have significant headroom beyond idle usage
- feature controls should be placed where users naturally interact, not buried in settings or admin pages; for file-related features, the natural location is inline in the chat compose area near the file preview
- when a workflow pivots from a draft/new conversation into a newly created persisted conversation, clear any stale per-conversation UI state (for example `latestMessage` and file drafts) before navigation; otherwise follow-up input gating and draft restoration can accidentally carry old state into the next chat
- Langfuse v3 services (ClickHouse, web, worker) need higher container memory limits than the compose defaults; ClickHouse merge operations and the Next.js 15 web frontend both OOM at their defaults (768m and 600m respectively); a container that Docker reports as "Up" but refuses connections is likely restart-looping from OOM — always check `docker logs` before assuming a networking problem
- when the `@librechat/agents` SDK normalizes provider content to internal types (e.g., all reasoning → `ContentTypes.THINK`), downstream handlers that only check for the provider-original type (e.g., `type === 'text'`) will silently drop content; always handle the SDK-normalized type as the primary check
- provider-native tool events (e.g., OpenAI `response.web_search_call.*`) that aren't handled in the SDK's conversion function are silently dropped — they produce empty `AIMessageChunk`s that the stream handler discards; to surface them, patch both the conversion function (to capture the data) and the stream handler (to dispatch before the empty-content guard)

---

## 4. Merge-sensitive files / surfaces to watch closely

When merging upstream changes, pay special attention to these areas.

### Runtime/config surface

- `.env.example`
- `librechat.example.yaml`
- `api/server/routes/config.js`
- `packages/api/src/endpoints/models.ts`

### Admin / RBAC / app settings

- `api/server/controllers/AdminController.js`
- `api/server/services/Admin/*`
- `client/src/components/Admin/AdminConsole.tsx`
- `packages/data-provider/src/admin.ts`
- `packages/data-schemas/src/schema/adminRole.ts`
- `packages/data-schemas/src/schema/appSettings.ts`

### Scheduled runs

- `api/server/controllers/ScheduledJobsController.js`
- `api/server/services/ScheduledJobs/*`
- `client/src/components/Nav/SettingsTabs/Data/ScheduledRuns.tsx`
- `client/public/assets/push-sw.js`

### Model access defaults / per-user restrictions

- `api/server/services/ModelAccess.js`
- auth/user-creation strategy files
- `packages/data-schemas/src/schema/user.ts`
- `packages/data-schemas/src/types/user.ts`

### Native provider tools and file metadata

- `packages/api/src/agents/nativeTools.ts`
- `api/server/services/Files/process.js`
- `packages/data-schemas/src/schema/file.ts`
- `packages/data-schemas/src/types/file.ts`
- `packages/data-schemas/src/methods/file.ts`

### MCP interoperability / OAuth flows

- `api/server/routes/mcp.js`
- `packages/api/src/mcp/zod.ts`
- `packages/api/src/mcp/oauth/handler.ts`
- `packages/api/src/mcp/MCPConnectionFactory.ts`
- `docker-compose.local.override.yml`

### Realtime voice

- `api/server/index.js`
- `api/server/controllers/RealtimeController.js`
- `api/server/services/Realtime/*`
- `client/src/components/Chat/Input/Realtime/*`
- `client/src/hooks/Realtime/*`

### Audio transcription

- `api/server/services/Files/Audio/transcribeMediaFile.js`
- `api/server/services/Files/Audio/transcriptionQueue.js`
- `api/server/services/Files/Audio/STTService.js`
- `api/server/routes/files/files.js`
- `api/server/index.js`
- `api/server/experimental.js`
- `client/src/hooks/Files/useFileHandling.ts`
- `client/src/components/Nav/SettingsTabs/Speech/STT/TranscriptionModelDropdown.tsx`
- `client/src/components/Nav/SettingsTabs/Speech/Speech.tsx`
- `client/src/store/settings.ts`
- `client/src/components/Chat/Input/Files/AttachFileMenu.tsx`
- `packages/data-schemas/src/schema/file.ts`
- `packages/data-schemas/src/types/file.ts`
- `packages/data-provider/src/types/files.ts`
- `packages/data-provider/src/data-service.ts`
- `packages/data-provider/src/api-endpoints.ts`
- `client/src/components/Chat/Input/Files/AudioTranscriptionBar.tsx`
- `client/src/components/Chat/Input/ChatForm.tsx`

### Local code interpreter / Langfuse sync / Azure direct endpoint

- `local-code-interpreter/*`
- `docker-compose.local.override.yml`
- `langfuse/sync_model_pricing.py`
- `packages/api/src/endpoints/models.ts`
- `packages/api/src/endpoints/openai/initialize.ts`
- `packages/api/src/endpoints/openai/llm.ts`
- `packages/data-provider/src/azure.ts`
- `client/src/components/Input/SetKeyDialog/OpenAIConfig.tsx`
- `client/src/components/Chat/Menus/Endpoints/ModelSelectorContext.tsx`

### Google auth mode support

- `packages/api/src/endpoints/google/auth.ts`
- `packages/api/src/endpoints/google/initialize.ts`
- `packages/api/src/endpoints/google/llm.ts`
- `packages/api/src/types/google.ts`
- `packages/data-provider/src/config.ts`
- `api/server/services/Config/loadAsyncEndpoints.js`
- `api/server/services/Realtime/modelService.js`
- `api/server/services/Realtime/providers/GeminiRealtimeAdapter.js`
- `api/app/clients/tools/structured/GeminiImageGen.js`
- `client/src/components/Input/SetKeyDialog/GoogleConfig.tsx`
- `client/src/components/Input/SetKeyDialog/SetKeyDialog.tsx`

### Google / xAI / Ollama provider behavior

- `packages/data-provider/src/openai.ts`
- `packages/api/src/endpoints/models.ts`
- `packages/api/src/endpoints/custom/config.ts`
- `packages/api/src/endpoints/custom/initialize.ts`
- `packages/api/src/endpoints/google/llm.ts`
- `packages/api/src/endpoints/openai/llm.ts`
- `packages/data-provider/src/xai.ts`
- `packages/data-provider/src/parameterSettings.ts`
- `client/src/components/Endpoints/Settings/OpenAI.tsx`
- `client/src/components/Endpoints/Settings/XAI.tsx`
- `api/server/services/Tools/ollama.js`
- `client/src/components/Endpoints/Settings/Google.tsx`
- `client/src/utils/googleGrounding.ts`
- `client/src/utils/ollamaReasoning.ts`

### Local deployment workflow

- `Dockerfile`
- `Dockerfile.remote-patched`
- `local-services/*`
- `.devcontainer/*`
- `.gitignore`

---

## 5. Existing focused docs already in this branch

These docs provide deeper detail for specific areas and should be kept consistent with this master doc.

- `OLLAMA_REASONING.md`
- `OLLAMA_WEB_SEARCH.md`
- `OPENAI_GEMINI_NATIVE_TOOLS.md`
- `OPENAI_GEMINI_NATIVE_TOOLS_IMPLEMENTATION.md`
- `LOCAL_CODE_INTERPRETER_INTEGRATION.md`
- `PATCHED_REMOTE_IMAGE_REFERENCE.md`
- `REALTIME_VOICE.md`
- `SCHEDULED_RUNS.md`
- `XAI_CUSTOM_ENDPOINTS.md`
- `README.local.md`
- `UPSTREAM_RELEASE_UPDATE.local.md`
- `LOCAL_UPSTREAM_SYNC_WORKFLOW.local.md`

Note: there is currently no standalone dedicated doc just for:

- default model access / per-user model restrictions
- OpenAI/Google model-family capability-aware settings
- Azure direct Azure OpenAI / Azure AI Foundry support
- background audio/video transcription
- Google auth mode support (API key / Vertex service account / Vertex ADC)

Those are mostly documented in `README.md`, `README.local.md`, and this master doc plus code.

---

## 6. Practical upstream merge checklist

When pulling in new upstream Danny Avila changes, use this checklist.

### Step 1: update the upstream-sync worktree

```bash
git -C /pool/home/timeng/LibreChat fetch --all --prune
git -C /pool/home/timeng/LibreChat switch main
git -C /pool/home/timeng/LibreChat merge --ff-only upstream/main
```

### Step 2: merge upstream `main` into the customization worktree

```bash
git -C /pool/home/timeng/LibreChat-custom switch engt21/local-customizations
git -C /pool/home/timeng/LibreChat-custom merge main
```

### Step 3: review conflicts by feature area

If conflicts touch these files, review them carefully instead of doing a blind accept-all:

- admin / RBAC / app settings files
- schedules / notifications files
- model access enforcement and user schema files
- provider-native tools and file metadata files
- MCP schema / OAuth / callback-resolution files
- OpenAI / Google / xAI / Ollama config/model-discovery files
- local-services, Docker, devcontainer, and startup files

### Step 4: special lockfile handling

If `package-lock.json` conflicts, regenerate it from the customization worktree:

```bash
cd /pool/home/timeng/LibreChat-custom
npm install --package-lock-only --ignore-scripts
```

### Step 5: validate after merge

Run the relevant checks for the touched areas before considering the merge done.

For the MCP/OAuth customization area, the current targeted checks are:

```bash
docker exec -w /app LibreChat npm --prefix /app/packages/api run test:ci -- --runInBand --testPathPatterns=src/mcp/__tests__/handler.test.ts
docker exec -w /app LibreChat npm --prefix /app/packages/api run test:ci -- --runInBand --testPathPatterns=src/mcp/__tests__/zod.spec.ts
docker exec LibreChat node -e "console.log(process.env.DOMAIN_SERVER || '')"
```

If the backend route suite is needed, remember that `api/server/routes/__tests__/mcp.spec.js` is still locally affected by the existing Alpine `mongodb-memory-server` limitation.

### Step 6: rebuild the custom runtime

```bash
cd /pool/home/timeng/LibreChat-custom
./local-services/start-all.sh
```

That helper path now resolves the checked-in `docker-compose.local.override.yml`, validates the compose config, and force-recreates the local `librechat-local:latest` container so agent restarts stay on the customization image instead of drifting back to upstream defaults.

---

## 7. What absolutely must remain true after future merges

- the runnable app stays in `LibreChat-custom`
- the custom branch continues to contain all local custom feature work
- admin console + RBAC remain wired and reachable
- scheduled runs remain wired on both backend and UI
- per-user model access rules remain enforced
- native tool routing and file metadata behavior stay intact
- OpenAI model-family capability gating and request sanitization remain intact
- Google live discovery / grounding logic remains intact
- xAI live discovery / capability-aware settings / request sanitization remain intact
- Ollama multi-source routing / search / reasoning behavior remains intact
- realtime voice routes, websocket auth refresh, provider adapters, client audio/transcript UX, and sidebar conversation persistence remain intact
- the local code interpreter bridge remains available with warm-session reuse and prewarm behavior
- Langfuse pricing sync/backfill and alias-aware pricing behavior remain intact
- Azure direct Azure OpenAI / Azure AI Foundry per-user configuration remains intact (including the v1 api-version exclusion fix)
- background audio/video transcription queue, runner, and persistent conversation flow remain intact
- `metadata.transcription` sub-document schema in file.ts stays declared (not Mixed) so Mongoose $set updates persist correctly
- Google three-mode authentication (API key, Vertex service account, Vertex ADC) remains functional across chat, realtime voice, and image generation
- shared Google credential helpers in `packages/api/src/endpoints/google/auth.ts` remain the single source of truth for credential resolution
- the Google endpoint settings UI with auth mode dropdown and conditional field rendering remains intact
- local startup scripts continue rebuilding and running the custom image from `docker-compose.local.override.yml`
- the runtime `librechat.yaml` includes a `memory:` section with a valid agent config (provider + model or agent id) so that user memories are retrieved and injected into agent conversations
- secret/runtime-only files remain ignored and not accidentally committed

---

## 8. Suggested maintenance rule for this doc

Whenever a custom feature is added, removed, or materially changed, update this file with:

- the feature bucket
- key files
- what it does
- what must be preserved during upstream merges
- supporting docs

This should stay the top-level customizations index for the branch.

## 9. Required documentation update policy

Future changes in this customization branch should follow this rule:

- code/config/runtime changes must update documentation in the same task
- branch-specific customizations must be reflected here in `CUSTOMIZATION_MASTER_DOC.md`
- bug fixes, postmortems, and lessons learned discovered during investigation or recovered from past chat/session history must also be rolled into this file in the same task
- focused docs such as `README.local.md`, `UPSTREAM_RELEASE_UPDATE.local.md`, `SCHEDULED_RUNS.md`, `OLLAMA_WEB_SEARCH.md`, `OLLAMA_REASONING.md`, and native-tools docs must be updated when their behavior changes
- do not leave documentation updates for later when the behavior has already changed
