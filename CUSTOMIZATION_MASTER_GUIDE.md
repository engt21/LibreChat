# LibreChat Customization Master Guide

This document is the single merged reference for the custom work in this repository.

Use it to:

- understand what this branch adds on top of upstream LibreChat
- know what must be preserved when merging Danny Avila upstream changes
- know which folder to run locally
- know which files are most likely to conflict during future merges

This guide is for:

- worktree: `/pool/home/timeng/LibreChat-custom`
- branch: `engt21/local-customizations`
- production deployment host: `timeng@192.168.50.104` (`librechat`)
- production runtime bundle: `/opt/LibreChat-custom`
- production app URL: `http://192.168.50.104:3080`

## Current model

### Worktree roles

- `/pool/home/timeng/LibreChat` = upstream-sync worktree
- `/pool/home/timeng/LibreChat-custom` = actual customized LibreChat worktree
- `timeng@192.168.50.104:/opt/LibreChat-custom` = copied production runtime bundle, not a Git checkout

### Current intent

- keep upstream `main` clean in `LibreChat`
- keep all source edits, builds, tests, and docs in `LibreChat-custom`
- merge upstream changes into `engt21/local-customizations`
- do not rely on the fork for safety; the custom worktree is the source of truth
- inspect VM production with read-only SSH/Docker/curl checks unless the user explicitly approves production maintenance

## What this custom branch adds

The custom work falls into these main buckets:

1. Admin console, RBAC, BYOK provider policies, user detail/preferences/metrics, superadmin sync, and live app settings
2. Scheduled runs and notifications
3. Per-user model access, admin-managed restrictions, and rate limits
4. Provider-native chat-bar tools for OpenAI/Azure/Gemini
5. Google Gemini live model discovery, capability-aware settings, and grounding citations
6. xAI custom-endpoint live discovery and capability-aware settings
7. Ollama multi-source discovery, hosted web search, and reasoning controls
8. MCP interoperability, OAuth hardening, alphabetical ordering, admin publishing, and per-server MCP tool filtering
9. Local runtime, Docker, startup, observability, and worktree workflow changes
10. Secret-handling and local git safety improvements
11. Background audio/video transcription with persistent conversations
12. Google auth mode support (API key, Vertex service account, Vertex ADC)
13. Internet Archive / Wayback read-only MCP server integration
14. arXiv research MCP server integration with prompt-injection guardrails
15. UX preservation fixes and ordering controls, including fixed sidebar chat recency/month buckets and user-sortable presets

---

## 1. Admin console, RBAC, superadmin sync, and live app settings

### What it does

- Adds an admin console UI and backend routes
- Adds admin roles/permissions beyond simple superadmin behavior
- Adds DB-backed app settings such as `registrationEnabled`, `platformPrompt`, `modelSteeringEnabled`, MCP publishing/domain controls, and BYOK provider policies
- Adds admin-managed BYOK provider policies (`enabled`, `allowBaseURL`, `fallbackToPlatform`) for built-in/custom providers; server-side BYOK resolution prefers user credentials and can fall back to platform credentials for missing/expired user keys
- Expands admin user detail with safe preferences, user MCP servers, BYOK key status, scheduled-run count, MCP server count, active BYOK key count, and last active time
- Makes observability links host-aware instead of always using `localhost`
- Syncs `SUPERADMIN_EMAILS` into admin role membership on startup and auth flows
- Shows the model-picker API-key settings cog at the provider level, but only for super-admin users, excluding `My Agents`
- Reopens that provider settings cog with the saved provider values preloaded so super admins can update only the changed field; new provider-key saves default to never expire unless the user chooses a finite expiry
- Adds `AppSettings.platformPrompt`, a super-admin-editable platform system prompt that is prepended before preset/user/agent instructions for Assistants and Agents
- Adds optional model steering (`AppSettings.modelSteeringEnabled` + per-user `modelSteeringPrefs.enabled`): during a running non-Assistants generation, the normal chat bar can send a steering instruction via `POST /api/agents/chat/steer` while Stop remains available; the server aborts the active job, saves the partial assistant response, and restarts the continuation under the partial response.

### Main files

#### Backend

- `api/server/controllers/AdminController.js`
- `api/server/controllers/__tests__/adminUserPreferencesAndMetrics.spec.js`
- `api/server/controllers/ModelSteeringController.js`
- `api/server/controllers/agents/request.js`
- `api/server/routes/admin/index.js`
- `api/server/routes/agents/chat.js`
- `api/server/routes/modelSteering.js`
- `api/server/middleware/adminAccess.js`
- `api/server/middleware/buildEndpointOption.js`
- `api/server/services/Admin/appSettings.js`
- `api/server/services/Admin/permissions.js`
- `api/server/services/Admin/superadmin.js`
- `api/server/controllers/agents/client.js`
- `packages/api/src/endpoints/byok.ts`
- `packages/api/src/endpoints/{openai,anthropic,google,bedrock,custom}/initialize.ts`
- `config/sync-superadmins.js`

#### Frontend

- `client/src/components/Admin/AdminConsole.tsx`
- `client/src/components/Nav/SettingsTabs/Personalization.tsx`
- `client/src/components/Chat/Input/ChatForm.tsx`
- `client/src/hooks/Chat/useChatHelpers.ts`
- `client/src/hooks/Input/useTextarea.ts`
- `client/src/hooks/Messages/useSubmitMessage.ts`
- `client/src/components/Chat/Menus/Endpoints/ModelSelectorContext.tsx`
- `client/src/components/Chat/Menus/Endpoints/components/EndpointItem.tsx`
- `client/src/components/Chat/Menus/Endpoints/components/EndpointModelItem.tsx`
- `client/src/components/Chat/Menus/Endpoints/components/SearchResults.tsx`
- `client/src/routes/index.tsx`
- `client/src/data-provider/Admin/*`
- `packages/api/src/agents/context.ts`
- `packages/data-provider/src/admin.ts`
- `packages/data-provider/src/admin.spec.ts`
- `packages/data-provider/src/modelSteering.ts`
- `packages/data-provider/src/createPayload.ts`

#### Schemas and types

- `packages/data-schemas/src/schema/adminRole.ts`
- `packages/data-schemas/src/schema/appSettings.ts`
- `packages/data-schemas/src/schema/user.ts`
- matching models/methods/types in `packages/data-schemas/src/*`

### Preserve during merges

- `/api/admin` route wiring
- admin permission checks and middleware
- `SUPERADMIN_EMAILS` sync behavior
- DB-backed app settings behavior
- BYOK provider policy schema/zod/UI handling and server-side fallback semantics; platform secrets must remain server-only
- admin user detail serialization for preferences/metrics without exposing push subscription payloads or key material
- `AppSettings.platformPrompt` schema/zod/UI handling and prompt-prepend ordering
- `AppSettings.modelSteeringEnabled`, `user.modelSteeringPrefs.enabled`, `/api/model-steering/prefs`, and `/api/agents/chat/steer` gates
- model steering normal-chat-bar UX: no separate input, Stop + Send coexist while steerable, Enter submits steering, first-message streams fall back to `latestMessage.conversationId`, steering drafts/input are cleared after submit, and `stream_finalizing` hides Stop once generation is done but final persistence is still completing
- native OpenAI model discovery: `OPENAI_MODELS` is a fallback seed rather than a hard override, while `OPENAI_REVERSE_PROXY` keeps legacy override/non-normalized behavior for OpenAI-compatible routers
- native OpenAI model-directory discovery must prefer a signed-in user's saved OpenAI key over platform credentials when present, support both JSON `{ apiKey, baseURL }` and older plain saved keys, and keep BYOK discovery results user-scoped instead of writing them into shared model caches
- native OpenAI picker normalization: keep exactly one Chat Latest candidate with
  priority `chat-latest` -> `gpt-chat-latest` -> highest-version
  `gpt-*-chat-latest`, release-order sorting, non-chat and snapshot filtering,
  non-legacy codename chat ids such as `sol`/`luna`, and alpha separation from
  the normal OpenAI model list
- Azure OpenAI / Foundry model-family gating: GPT/Chat Latest deployments may
  use OpenAI/Azure native Responses tools, but Azure-hosted `DeepSeek-*`,
  `grok-*`, `Phi-*`, `Mistral-*`, `codex-*`, `gpt-oss-*`, and embedding
  deployments must not be upgraded into OpenAI-native web search/code/file tool
  calls just because the endpoint is `azureOpenAI`
- host-aware observability URLs
- super-admin-only model-picker API-key settings access
- provider API-key dialog expiry defaults to `never`, not a finite 12-hour expiry

### Why this is merge-sensitive

This area overlaps with auth, config, user creation, and route registration. Upstream changes in auth/config can easily miss custom admin behavior if merged carelessly. Preserve the `AUTH_SECURITY.md` controls: generic local-login failures, pending-cookie TOTP enrollment, MFA enforcement/recovery, purpose-bound JWTs, secure-cookie override, explicit CORS/security headers, and the separate `MCP_OAUTH_CALLBACK_BASE_URL` loopback callback.

---

## 2. Scheduled runs and notifications

### What it does

- Adds per-user scheduled runs for agent executions and model prompts
- Adds manual run-now capability
- Supports direct model prompt automation tools, including MCP servers and optional per-server MCP tool subsets
- Supports notifications through:
  - email
  - Twilio SMS
  - carrier gateway email-to-text
  - browser push notifications
- Runs a background scheduler in the API process

### Main files

#### Backend

- `api/models/ScheduledJob.js`
- `api/server/routes/schedules.js`
- `api/server/controllers/ScheduledJobsController.js`
- `api/server/services/Tools/mcpToolFilter.js`
- `api/server/services/ScheduledJobs/cron.js`
- `api/server/services/ScheduledJobs/execution.js`
- `api/server/services/ScheduledJobs/runner.js`
- `api/server/services/ScheduledJobs/notifications.js`
- `api/server/services/ScheduledJobs/userNotifications.js`
- `api/server/utils/emails/scheduledRunNotification.handlebars`
- `api/server/utils/emails/scheduledRunSmsGateway.handlebars`

#### Frontend

- `client/src/components/Nav/SettingsTabs/Data/ScheduledRuns.tsx`
- `client/src/data-provider/Schedules/*`
- `client/src/hooks/MCP/useMCPSelect.ts`
- `client/public/assets/push-sw.js`

#### Schema/type layer

- `packages/data-schemas/src/schema/scheduledJob.ts`
- matching model/type files

### Preserve during merges

- `/api/schedules` route registration
- scheduled job runner startup in API boot flow
- scheduled job schema and notification settings
- nested `target.ephemeralAgent.mcp` plus optional `mcpToolFilter` preservation on create/update
- browser push service worker support
- notification env/config handling

### Supporting docs

- `SCHEDULED_RUNS.md`

---

## 3. Per-user model access, admin-managed restrictions, and rate limits

### What it does

- Stores model access restrictions per user instead of globally shrinking provider model lists
- Lets admins keep broader access
- Filters visible model lists per user
- Blocks requests to models the user is not allowed to use
- Lets admins override per-user model access
- Keeps OpenAI `-alpha` models available when normal model permissions allow OpenAI access, while the picker renders them in a separate bottom alpha subgroup
- Omits deprecated Assistants / Azure Assistants endpoints from the admin model-access picker so admins do not assign new permissions for the phased-out Assistants API
- Lets admins configure optional per-user/per-model 24-hour request/token budgets in `user.modelRateLimits`
- Returns HTTP `429` with `type: "model_rate_limit"` when a matching request/token budget is exhausted
- Records token usage after assistant/agent usage is known so token budgets affect subsequent requests

### Current default model intent

- `DEFAULT_NON_ADMIN_MODEL_PERMISSIONS` is currently disabled (`{ enabled: false, rules: [] }`), so new non-admin users start unrestricted unless an admin sets per-user permissions.
- Runtime `modelSpecs` are quick-selector conveniences only (`enforce: false`) and do not define access.
- Dynamic OpenAI and Azure OpenAI quick suggestions are access-aware and keep
  three OpenAI-family slots: Chat Latest, latest stable full GPT, and latest
  stable GPT mini. Chat Latest priority is `chat-latest`, then
  `gpt-chat-latest`, then the highest-version `gpt-*-chat-latest`. Other
  providers keep only their top available model.

### Main files

- `api/server/services/ModelAccess.js`
- `api/server/controllers/ModelController.js`
- `api/server/middleware/validateModel.js`
- `api/server/middleware/validateModel.spec.js`
- `api/server/services/ModelRateLimits.js`
- `api/server/services/ModelRateLimits.spec.js`
- `api/server/services/Threads/manage.js`
- `api/server/services/Threads/recordUsage.spec.js`
- `api/server/controllers/agents/request.js`
- `api/server/controllers/agents/client.js`
- `api/server/services/AuthService.js`
- `api/server/services/PermissionService.js`
- `api/strategies/{process,ldapStrategy,openidStrategy,samlStrategy}.js`
- `packages/data-schemas/src/schema/user.ts`
- `packages/data-schemas/src/types/user.ts`
- admin console files above

### Preserve during merges

- model permission fields on the user schema
- `modelRateLimits` fields on user/admin schemas and the admin console UI
- model filtering in config/model responses
- validation enforcement before requests run
- OpenAI `-alpha` models following normal permission filtering plus the separate bottom OpenAI alpha picker/search subgroup
- admin-console model-access picker exclusion for `assistants` and `azureAssistants`
- `AdminConsole.tsx` normalization that drops hidden Assistants/Azure Assistants rules on save, so deprecated Assistants access is not silently preserved by the admin editor
- request-limit checks before execution and token recording after usage collection
- default model permission assignment on all account creation paths

---

## 4. Provider-native chat-bar tools for OpenAI/Azure/Gemini

### What it does

- Lets chat-bar toggles route to provider-native tools where supported
- Keeps existing LibreChat UI while changing the backend execution path
- Tags uploaded files for native-tool flows
- Allows raw arbitrary file uploads only when the upload is explicitly routed to `execute_code`; keep MIME allowlists enforced for file search, avatars, context parsing, Assistants uploads, and ordinary attachments
- Keeps Code Interpreter visible as an upload destination for ephemeral chat uploads whenever the conversation supports it, even before the Code Interpreter toggle is already on; this lets audio such as `.wav` go to either transcription or Code Interpreter by explicit user choice
- Preserves `tool_resource` and native-tool metadata after upload completion so Code Interpreter-routed `.wav`/`.m4a` attachments do not fall back into generic audio/transcription UI paths
- Uses completed OpenAI/Azure reasoning summary parts instead of fragmentary incremental events and coalesces adjacent thought parts in the UI
- Sanitizes malformed Anthropic signed thinking blocks before storage/request replay so interrupted Claude native-tool streams do not poison later turns
- Sanitizes Anthropic server-tool history for web search, web fetch, code execution, and advisor so only matched `server_tool_use` / `*_tool_result` pairs are replayed
- Adds direct Anthropic sidebar controls for fast mode, web fetch with citations, hosted code execution, advisor, and advisor model selection while skipping unsupported/Vertex combinations with warnings instead of invalid requests
- Avoids duplicate prompt/file injection when native tools own the file flow

### Main behavior

- OpenAI/Azure GPT and Chat Latest deployments:
  - native web search
  - native code interpreter
  - native file search
- Azure-hosted DeepSeek/Grok/Phi/Mistral/Codex/GPT-OSS chat deployments:
  - streaming chat settings stay available
  - web search and code execution stay on LibreChat structured/local fallback
    paths unless the selected provider endpoint has its own native integration
  - embedding deployments such as `text-embedding-3-small` are non-chat and
    should not advertise chat streaming or native-tool toggles
- Gemini:
  - native Google search
  - native code execution
- fallback to LibreChat-managed behavior when native mode is not safe or supported

### Main files

- `packages/api/src/agents/nativeTools.ts`
- `packages/api/src/agents/initialize.ts`
- `packages/api/src/agents/resources.ts`
- `api/server/controllers/agents/client.js`
- `api/server/services/Endpoints/agents/{initialize,addedConvo}.js`
- `api/server/services/Files/process.js`
- `api/server/routes/files/multer.js`
- `client/src/components/Chat/Input/ToolsDropdown.tsx`
- `client/src/hooks/Files/useFileHandling.ts`
- `client/src/utils/files.ts`
- `packages/data-schemas/src/schema/file.ts`
- related file metadata/types in `packages/data-schemas/src/*`
- `config/apply-runtime-patches.js`
- `package.json`
- `Dockerfile`
- `client/src/components/Chat/Messages/Content/ContentParts.tsx`
- `client/src/utils/streamingReasoning.ts`
- `packages/api/src/agents/openai/handlers.ts` (reasoning type fix)
- `client/src/hooks/SSE/useStepHandler.ts` (web search status handler)
- `client/src/components/Chat/Messages/Content/Parts/WebSearchStatus.tsx`
- `packages/data-provider/src/types/runs.ts` (`ContentTypes.WEB_SEARCH_STATUS`)

### Preserve during merges

- native-tool file metadata fields
- client capability detection and native-tool routing hints
- OpenAI file/vector-store mirroring behavior
- OpenAI/Azure completed reasoning-summary handling and merged Thoughts rendering
- Anthropic malformed thinking-block filtering in `packages/api/src/utils/content.ts` and the matching `@librechat/agents` runtime patch in `config/apply-runtime-patches.js`
- Anthropic direct endpoint fields in `packages/data-provider/src/schemas.ts`, `packages/data-provider/src/parameterSettings.ts`, `packages/data-provider/src/anthropic.ts`, and `packages/api/src/endpoints/anthropic/llm.ts`: `fast_mode`, `web_fetch`, `anthropic_code_execution`, `anthropic_advisor`, and `anthropic_advisor_model`
- Added multi-conversation agents in `api/server/services/Endpoints/agents/{initialize,addedConvo}.js` must keep their initialized runtime tool contexts registered by suffixed agent id, including `toolRegistry`, `userMCPAuthMap`, and `tool_resources`
- Anthropic server-tool result filtering for `web_search_tool_result`, `web_fetch_tool_result`, `code_execution_tool_result`, and `advisor_tool_result`
- The explicit non-support boundary for Anthropic memory, bash, computer-use, and text-editor client tools until LibreChat has an executor/sandbox/tool-result loop for them
- the Docker/custom install path that patches `@librechat/agents` during `npm install`
- Gemini conflict fallback logic

### Supporting docs

- `OPENAI_GEMINI_NATIVE_TOOLS.md`
- `OPENAI_GEMINI_NATIVE_TOOLS_IMPLEMENTATION.md`

---

## 5. Google Gemini live model discovery, capability-aware settings, and grounding citations

### What it does

- Fetches live Gemini model lists in API-key mode
- Keeps Vertex selector loads cheap by starting from configured/default Google models and only probing callable Vertex models after a real "not found / no access" model failure
- Caches the callable Vertex union across the preferred location plus official Google model locations, then invalidates selector/config caches so the next `/api/config` fetch reflects the refreshed set
- Publishes model capability metadata into startup config
- Makes the Google endpoint settings UI capability-aware
- Filters the Google selector to models that are actually callable for the configured Vertex project/region/credentials after refresh
- Carries per-model `vertexLocation` / `vertexLocations` metadata so global-only models can route correctly under a regional default
- Maps Gemini grounding metadata into LibreChat inline citations and the Sources UI

### Main files

- `packages/api/src/endpoints/models.ts`
- `packages/api/src/endpoints/google/initialize.ts`
- `packages/api/src/endpoints/google/llm.ts`
- `packages/data-provider/src/google.ts`
- `api/server/controllers/agents/googleVertexRefresh.js`
- `client/src/components/Endpoints/Settings/Google.tsx`
- `client/src/utils/googleGrounding.ts`
- `api/server/controllers/agents/callbacks.js`

### Preserve during merges

- API-key live discovery plus lazy failure-triggered Vertex discovery; do not regress to eager all-location probing on every selector load
- multi-location Vertex callable discovery, per-model route metadata, and selector-cache invalidation after refresh
- startup config capability publishing
- capability-aware Google UI logic
- per-model thinking sanitization for unsupported Gemini families such as `gemini-2.5-flash-lite`
- grounding metadata to citations pipeline

### Note

This area is partly documented in `README.md`, but there is no single standalone deep-dive doc for it yet.

---

## 6. xAI custom-endpoint live discovery and capability-aware settings

### What it does

- Detects xAI-style custom endpoints from endpoint name, `*.x.ai` base URLs, or explicit `defaultParamsEndpoint: 'xai'`
- Keeps a dedicated `xai` custom endpoint in the local `librechat.yaml` with a user-provided-key flow, bootstrap models, and automatic live discovery refresh after the user saves a key
- Fetches live model metadata from xAI's `/v1/language-models` endpoint
- Filters model pickers to text-compatible Grok/xAI chat models while preserving aliases
- Publishes per-endpoint xAI capability maps into startup config
- Adds a dedicated xAI settings UI with model-aware disablement reasons
- Applies the same capability rules in the chat parameter panel and agent model panel
- Strips unsupported xAI parameters at request-build time and defaults xAI flows to Responses API semantics when needed
- Adds local Grok 4.20 token/pricing mappings

### Main files

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

### Preserve during merges

- xAI auto-detection for custom endpoints
- `/language-models` live discovery and alias-preserving filtering
- `xaiModelCapabilities` startup-config publishing
- dedicated xAI settings routing and capability-aware disablement reasons
- xAI request sanitization in the OpenAI-compatible request builder
- Grok 4.20 token/pricing mappings

### Supporting docs

- `XAI_CUSTOM_ENDPOINTS.md`

---

## 7. Ollama multi-source discovery, hosted web search, and reasoning controls

### What it does

- Treats the dedicated `Ollama` endpoint as a multi-source live-discovery endpoint
- Supports `baseURL` plus `baseURLs`
- Resolves model requests to the source URL that actually owns the chosen model
- Adds Ollama-hosted web-search modes:
  - `ollama_native`
  - `ollama_mcp`
- Adds an Ollama-specific reasoning profile and hides reasoning output when set to `none`

### Main files

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
- `librechat.example.yaml`
- `.env.example`

### Preserve during merges

- `baseURLs` support
- per-model source routing
- Ollama hosted search/fetch mode handling
- `OLLAMA_API_KEY` behavior for hosted search
- Ollama-specific reasoning parameter behavior and hidden-reasoning UI logic

### Supporting docs

- `OLLAMA_WEB_SEARCH.md`
- `OLLAMA_REASONING.md`

---

## 8. MCP interoperability and OAuth hardening for OpenAI / Arcade-hosted MCP tools

### What it does

- normalizes bare no-input MCP object schemas to include `properties: {}` before OpenAI-compatible tool calls are sent
- keeps explicitly open schemas with `additionalProperties` unchanged
- refreshes Arcade-style OAuth tokens by discovering the token endpoint from stored protected-resource `authorization_servers` metadata instead of guessing from the MCP URL path
- resolves MCP OAuth callback URLs from a valid `DOMAIN_SERVER` first, then forwarded host headers, then request host/protocol
- uses a local loopback `DOMAIN_SERVER=http://localhost:${PORT:-3080}` default in the Docker override so Arcade Microsoft OAuth can use the loopback callback exception during local runs
- cleanly separates LibreChat MCP initialization success from downstream provider consent prompts returned by Microsoft tools
- keeps the MCP chat-bar selector visible before first server selection when MCP permission, structured-tool support, and selectable servers are available
- sorts MCP server surfaces by display title/name with numeric/case-insensitive comparison and `serverName` as the deterministic tiebreaker across backend registry, admin lists, and user/agent MCP UIs
- adds admin MCP publishing controls: YAML/static server visibility uses `AppSettings.mcpPublishedServers`, while user-managed DB server publication uses public MCP viewer ACLs
- keeps Arcade/Microsoft MCP servers DB/user-managed; the static runtime `arcade-read` default was removed to avoid duplicate visual entries and broken/corrupted external favicon rendering
- supports expanding a selected MCP server in chat and scheduled-run UIs to choose a subset of that server's tools while preserving the default all-tools selection
- persists per-server subsets in `ephemeralAgent.mcpToolFilter`; absence of a server key means all tools remain enabled
- retries one MCP `tools/call` after reconnecting when Streamable HTTP/SSE transport session loss is detected; ordinary tool errors must not be retried
- defaults high-level MCP reconnect attempts to 6 via `MCP_MAX_RECONNECT_ATTEMPTS`
- configures `endpoints.agents.recursionLimit: 100` and `maxRecursionLimit: 200` in local runtime config for longer research/browser loops
- configures local `openai-cua-browser` at `http://192.168.50.4:8768/mcp` for CUA-backed browser automation
- configures a read-only local `internet-archive` MCP server at `http://192.168.50.4:8770/mcp` for Internet Archive and Wayback Machine research tools
- configures a guarded local `arxiv` MCP server at `http://192.168.50.4:8771/mcp/` for arXiv research tools with prompt-injection instructions and a platform-safe tool allowlist

### Main files

- `client/src/components/Chat/Input/MCPSelect.tsx`
- `client/src/components/Chat/Input/MCPSubMenu.tsx`
- `client/src/components/MCP/MCPServerMenuItem.tsx`
- `client/src/hooks/MCP/useMCPSelect.ts`
- `client/src/hooks/MCP/useMCPServerManager.ts`
- `client/src/store/mcp.ts`
- `client/src/components/SidePanel/Agents/MCPTools.tsx`
- `client/src/components/Tools/MCPToolSelectDialog.tsx`
- `client/src/components/Admin/AdminConsole.tsx`
- `client/src/components/Nav/SettingsTabs/Data/ScheduledRuns.tsx`
- `client/src/components/Chat/Input/MCPSelect.guards.spec.ts`
- `api/models/Agent.js`
- `api/models/loadAddedAgent.js`
- `api/app/clients/tools/util/handleTools.js`
- `api/server/services/Tools/mcpToolFilter.js`
- `packages/api/src/mcp/zod.ts`
- `packages/api/src/mcp/MCPManager.ts`
- `packages/api/src/mcp/connection.ts`
- `packages/api/src/mcp/mcpConfig.ts`
- `packages/api/src/mcp/registry/MCPServersRegistry.ts`
- `packages/api/src/mcp/oauth/handler.ts`
- `packages/api/src/mcp/MCPConnectionFactory.ts`
- `api/server/controllers/AdminController.js`
- `api/server/controllers/__tests__/adminMCPPublish.spec.js`
- `api/server/routes/mcp.js`
- `api/server/services/initializeMCPs.js`
- `packages/data-schemas/src/schema/mcpServer.ts`
- `packages/data-schemas/src/types/mcp.ts`
- `docker-compose.local.override.yml`
- `librechat.yaml` (runtime, gitignored)
- external service: `/pool/home/timeng/internet-archive-mcp-server`
- external service: `/pool/home/timeng/arxiv-mcp-server`
- external service: `/pool/home/timeng/openai-cua-mcp-server`

### Preserve during merges

- keep the bare-object schema fix for OpenAI/GPT-5-compatible tool calling
- keep protected-resource `authorization_servers` refresh discovery ahead of server-URL guessing
- keep callback precedence as `DOMAIN_SERVER` -> forwarded host headers -> request host/protocol
- keep the local loopback `DOMAIN_SERVER` default unless intentionally replacing it with a public HTTPS URL
- do not misclassify provider authorization links from Arcade Microsoft tools as LibreChat MCP initialization failures
- keep MCP server sorting display-title/name-first with `serverName` as the deterministic tiebreaker across backend registry, admin surfaces, and user/agent UIs; never rely on object insertion order or raw server-name-only sorting
- keep admin MCP publishing split between `AppSettings.mcpPublishedServers` for static servers and public MCP viewer ACLs for DB/user servers
- keep MCP selector visibility independent of `mcpValues`; do not hide it just because no server is pinned or selected
- keep `ephemeralAgent.mcp` as the selected server list and `ephemeralAgent.mcpToolFilter` as the optional per-server subset map; missing filter entries must continue to mean all tools
- keep `mcp_all` fallback expansion filter-aware so cold scheduled runs do not accidentally include every tool from a filtered server
- preserve the one-shot MCP stale-session reconnect/retry path and do not broaden it to ordinary tool execution failures
- preserve the local agent recursion budget unless replacing it with an equivalent explicit runtime config
- keep static `mcpServers.arcade-read` absent from runtime `librechat.yaml` unless explicitly redesigning Arcade defaults; Arcade/Microsoft MCP servers should remain user/admin-managed through DB-backed MCP workflows
- preserve `mcpServers.openai-cua-browser` and the `http://192.168.50.4:8768` allowed-domain entry in runtime `librechat.yaml`
- preserve `mcpServers.internet-archive` and the `http://192.168.50.4:8770` allowed-domain entry in runtime `librechat.yaml`
- preserve `mcpServers.arxiv`, its `serverInstructions`, its trailing-slash `http://192.168.50.4:8771/mcp/` URL, and the `http://192.168.50.4:8771` allowed-domain entry in runtime `librechat.yaml`
- keep the Internet Archive MCP tool surface read-only
- keep the arXiv MCP service tool allowlist restricted unless explicitly reviewing stateful/heavy tools

### Supporting docs

- `README.local.md`
- `CUSTOMIZATION_MASTER_DOC.md`
- `INTERNET_ARCHIVE_MCP.md`
- `ARXIV_MCP.md`

---

## 9. Local runtime, Docker, startup, observability, and worktree workflow changes

### What it does

- Makes `LibreChat-custom` the main runnable local worktree
- Keeps `LibreChat` as the upstream-sync worktree
- Treats the VM at `192.168.50.104` as the production Docker host and `/opt/LibreChat-custom` as the runtime bundle
- Uses helper scripts to symlink runtime-only secret/data files into the custom worktree while keeping the local Docker override checked into this repo
- Standardizes local startup on detached Docker compose using the custom worktree
- Defaults the dev rail to shared-stable MongoDB/uploads so `:3081` can access the same user data if the stable API is down, while retaining separate dev image tags, ports, logs, Meilisearch data, and code-interpreter state
- Adds user-level systemd services for stable startup, dev failover watchdog, and Ollama keep-warm timer
- Keeps dev normally stopped; the failover watchdog starts minimal dev only after stable health failures and stops failover-owned dev after stable recovers
- Keeps a full local-build path as the default runtime
- Keeps an optional patched-remote image workflow for targeted validation
- Keeps host-side build/lint/test commands and adjacent non-production workloads memory-constrained so they cannot starve the stable LibreChat rail: LibreChat Node jobs use `local-services/run-node-capped.sh`, `oss-llama.service` is capped by a user-systemd drop-in, and non-stable Docker sidecars/test stacks have explicit Docker memory caps
- keeps a local loopback `DOMAIN_SERVER` default in the Docker override for Arcade Microsoft OAuth

### Main files

#### Runtime docs

- `README.local.md`
- `UPSTREAM_RELEASE_UPDATE.local.md`
- `LOCAL_UPSTREAM_SYNC_WORKFLOW.local.md`
- `PATCHED_REMOTE_IMAGE_REFERENCE.md`
- `docker-compose.local.override.yml`

#### Local scripts

- `local-services/ensure-runtime-files.sh`
- `local-services/rail-env.sh`
- `local-services/start-all.sh`
- `local-services/stop-all.sh`
- `local-services/status-all.sh`
- `local-services/sync-from-stable.sh`
- `local-services/health-check.sh`
- `local-services/run-node-capped.sh`
- `local-services/deploy-runtime-delta.sh`
- `local-services/dev-seed-validation-personas.js`
- `local-services/dev-failover-watchdog.sh`
- `local-services/install-user-service.sh`
- `local-services/enable-on-boot.sh`
- `local-services/disable-on-boot.sh`
- `local-services/keep-ollama-warm.sh`

#### Docker/devcontainer

- `Dockerfile`
- `Dockerfile.remote-patched`
- `docker-compose.remote-patched.override.yml`
- `.devcontainer/devcontainer.json`
- `.devcontainer/docker-compose.yml`

### Preserve during merges

- run the app from `/pool/home/timeng/LibreChat-custom`
- after the VM migration, use `/pool/home/timeng/LibreChat-custom` for source/build/test work and `timeng@192.168.50.104:/opt/LibreChat-custom` for live runtime inspection
- keep `/pool/home/timeng/LibreChat` for upstream sync only
- keep the VM stable compose identity: project `librechat-stable`, compose files `/opt/LibreChat-custom/docker-compose.yml` plus `/opt/LibreChat-custom/docker-compose.local.override.yml`, API container `LibreChat`
- keep routine live checks read-only:
  - `ssh timeng@192.168.50.104 'cd /opt/LibreChat-custom && docker compose -p librechat-stable -f docker-compose.yml -f docker-compose.local.override.yml ps'`
  - `ssh timeng@192.168.50.104 'docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"'`
  - `curl -I http://192.168.50.104:3080/`
- keep `ensure-runtime-files.sh` symlink convention for runtime secret/data paths only:
  - `.env`
  - `librechat.yaml`
  - `langfuse/.env`
  - `data-node`
  - `meili_data_v1.35.1`
  - `images`
  - `uploads`
  - `logs`
- keep `COMPOSE_PROJECT_NAME=librechat-stable` for the VM production stack and `librechat-dev` for the pve2/dev validation stack, with `docker-compose.local.override.yml` as the default local override
- keep `LIBRECHAT_LANGFUSE_*_MEM_LIMIT` overrides in `.env` — Langfuse v3 OOMs at compose defaults
- keep exporter-sidecar compose commands separate from the main app stack; on
  the VM, `librechat-stable` owns Langfuse/metrics, `grafana-loki-stable` owns
  Grafana/Loki/Promtail, and `prometheus-stable` owns the app
  Prometheus/Blackbox stack
- keep admin observability links host-relative. Persist `localhost` URLs so the
  admin controller rewrites them to the request host dynamically: Langfuse
  `3000`, Grafana `3001`, metrics exporter `9091`, and app Prometheus `9092`.
  Do not restore stale `192.168.50.4` links or point the app Prometheus link at
  the VM host snap Prometheus on `9090`.
- preserve the admin endpoint split: settings responses should expose raw stored
  observability URLs for editing, observability quick-link responses should
  expose request-host-resolved browser URLs for clicking, and settings saves
  should normalize same-host observability links back to `localhost`.
- keep Code Interpreter dynamic-child prerequisites intact on the VM:
  `code-interpreter-local` needs `/var/run/docker.sock`, the
  `ghcr.io/vndee/sandbox-python-311-bullseye` image, and
  `/opt/LibreChat-custom/local-code-interpreter/data`. Random `llm-sandbox`
  child container names are expected warm sessions, not broken compose services.
- keep RAG/file-search readiness checks read-only unless production vector
  writes are explicitly approved: health/openapi/log/vectordb checks are safe;
  full ingest/query smoke writes pgvector data and can call paid embedding APIs.
- keep user systemd service definitions pointing at `LibreChat-custom`
- keep the documented `DOMAIN_SERVER` callback behavior aligned with the MCP section above
- keep dev shared-stable data mode in `rail-env.sh` (`LIBRECHAT_DEV_USE_STABLE_MONGO=true` by default) and the opt-in isolated fallback (`LIBRECHAT_DEV_USE_STABLE_MONGO=false`)
- keep failover lifecycle in place: stable systemd startup is explicit, automatic dev startup is owned by `librechat-dev-failover.timer`, and `LIBRECHAT_DEV_PROFILE=failover` starts only minimal dev services without rebuilding
- keep reduced dev resource defaults; dev is for explicit testing or stable failure fallback, not a second always-on full stack
- keep `sync-from-stable.sh` from restoring MongoDB or rsyncing uploads when dev already shares stable data
- keep `health-check.sh` treating shared `uploads/` as an intentional safe shared mount
- keep `dev-seed-validation-personas.js` refusing shared/stable MongoDB targets unless explicitly overridden; dev testing on shared data should use test accounts and avoid destructive resets
- keep `local-services/run-node-capped.sh` and the npm capped aliases for host-side LibreChat jobs; lint defaults to a `3G` cgroup and `1024 MB` Node heap, build/frontend default to a `4G` cgroup and `1536 MB` Node heap, and all profiles use `MemorySwapMax=0`
- keep `local-services/deploy-runtime-delta.sh` as the guarded fast path for backend/runtime-loaded code, config helpers, runtime bind files, and already-built `packages/*/dist/**`; it must snapshot old files, apply runtime patches when `config/apply-runtime-patches.js` changes, restart/health-check, require explicit stable approval, and refuse frontend source, individual frontend dist files, package source, dependency, Dockerfile, and compose changes
- keep `client/scripts/post-build.cjs` generating `.librechat-client-dist-manifest.json` and keep `local-services/deploy-built-client-dist.sh` as the only supported frontend hot-promotion path; it must reject stale/tampered/URL-rewritten bundles, snapshot and atomically swap the complete `client/dist`, restart to clear cached HTML, and rollback on failed health verification
- never deploy a `client/src/**` fix by copying source alone or by hand-editing hashed `client/dist/assets/*`, `client/dist/index.html`, or `client/dist/sw.js`; browsers run the built asset graph and a partial patch can blank or crash the authenticated UI
- keep the OpenAI/Azure Responses native-web-search `max_tool_calls` bound in `packages/api/src/endpoints/openai/llm.ts` (default `6`, configured maximum `12`); it prevents production reasoning turns from entering repeated web-search stages without a final answer
- keep the OpenAI reasoning-summary boundary patch in `config/apply-runtime-patches.js` for `@librechat/agents` `src/stream.ts`, `dist/esm/stream.mjs`, and `dist/cjs/stream.cjs`; client-only separation does not repair persisted/reloaded Thoughts
- <!-- OPENAI_REASONING_PRESERVATION_INVARIANT: DO_NOT_REMOVE --> keep `local-services/verify-openai-reasoning-preservation.sh` and its hooks in stable startup, stable frontend promotion, and `local-services/health-check.sh`; this fail-closed gate checks source, mandatory tests/docs, and live stable runtime before a removed boundary/completion safeguard can silently ship
- before merging or promoting any OpenAI reasoning/web-search/runtime-patch/client-thought-rendering change, run `npm run verify:openai-reasoning-preservation`; after an approved VM stable change, run `ssh timeng@192.168.50.104 'cd /opt/LibreChat-custom && ./local-services/verify-openai-reasoning-preservation.sh --container LibreChat'`; stable helper scripts should resolve the current compose `api` container instead of hard-coding the old pve2 `librechat-stable-api` name
- keep memory caps on adjacent non-stable workloads: `/home/timeng/.config/systemd/user/oss-llama.service.d/override.conf` sets `MemoryHigh=4G`, `MemoryMax=5G`, and `MemorySwapMax=0`; Grafana/Loki stable sidecar compose caps Loki/Grafana/Promtail at `512m/512m/256m`; Prometheus stable sidecar compose caps Prometheus/Blackbox at `1g/128m`; Touchdown r1 and Touchdown Backwards r1 compose files cap each app at `768m`; the `librechat-official-*` containers are live-capped at `rag=512m`, `vectordb=512m`, `mongodb=1g`, `meili=768m` and must be re-capped if recreated from the temporary upstream compose workspace
- when reclaiming host memory, stop non-production/non-stable containers rather than deleting them, and never stop VM production containers (`LibreChat`, `chat-mongodb`, `chat-meilisearch`, `code-interpreter-local`, `rag-api-*`, `vectordb`, `librechat-stable-*`) unless the user explicitly authorizes production maintenance

### Supporting docs

- `README.local.md`
- `UPSTREAM_RELEASE_UPDATE.local.md`
- `LOCAL_UPSTREAM_SYNC_WORKFLOW.local.md`
- `PATCHED_REMOTE_IMAGE_REFERENCE.md`

---

## 10. Secret-handling and local git safety improvements

### What it does

- ignores common local env/secret/key file patterns
- keeps `.env.example` tracked while real runtime env files remain ignored
- prevents accidental tracking of common local secret/key material

### Main files

- `.gitignore`

### Preserve during merges

- ignore patterns for `.env*` except examples
- ignore patterns for `*.key`, `*.p8`, `*.p12`, `*.pfx`, `*.pkcs12`, `*.secret`, `*.secrets`, `*.token`, `*.apikey`, `*.api-key`
- ignore directories such as `/secrets/`, `/keys/`, `/credentials/`

### Important note

Ignored files are only safe if they were never tracked. If a secret file ever becomes tracked, it must be removed from git history/index explicitly.

---

## 11. Background audio/video transcription with persistent conversations

### What it does

- Audio/video files are uploaded as ordinary attachments first; the user explicitly starts transcription from the inline compose-bar transcription controls
- A dedicated conversation is created when transcription is started, with a "Transcribing..." placeholder; the user can navigate away and the job runs asynchronously
- Background runner polls a MongoDB-backed job queue with lease/lock semantics
- Video files are converted to mp3 via ffmpeg; oversized uploads are chunked into <=23 MB segments
- Completed transcript text is stored in the file's `text` field and the response message is updated in place
- The conversation persists in the sidebar like any other chat
- The attach-file menu accepts `audio/*` and `video/*` MIME types for all document-supporting providers
- The inline transcription controls exclude audio/video already routed to Code Interpreter; sending a Code Interpreter-routed media attachment without clicking Transcribe keeps it as a raw file attachment for the active chat/tool flow
- Supports model selection (whisper-1, gpt-4o-transcribe, gpt-4o-mini-transcribe, gpt-4o-transcribe-diarize) and prompt parameter via Settings > Speech
- Diarization: `gpt-4o-transcribe-diarize` automatically uses `diarized_json` format with speaker labels

### Main files

- `api/server/services/Files/Audio/transcribeMediaFile.js`
- `api/server/services/Files/Audio/transcriptionQueue.js`
- `api/server/services/Files/Audio/STTService.js`
- `api/server/routes/files/files.js`
- `api/server/index.js` / `api/server/experimental.js`
- `client/src/hooks/Files/useFileHandling.ts`
- `client/src/components/Chat/Input/Files/AttachFileMenu.tsx`
- `client/src/components/Nav/SettingsTabs/Speech/STT/TranscriptionModelDropdown.tsx`
- `client/src/components/Nav/SettingsTabs/Speech/STT/TranscriptionPromptInput.tsx`
- `packages/data-schemas/src/schema/file.ts` / `types/file.ts`
- `packages/data-provider/src/types/files.ts`
- `packages/data-provider/src/data-service.ts`

### Preserve during merges

- background transcription queue runner startup in `index.js` / `experimental.js`
- `metadata.transcription` sub-document schema in `file.ts` (must stay declared, not `Mixed`)
- audio/video MIME acceptance in `AttachFileMenu.tsx`
- explicit transcription trigger in `useFileHandling.ts` / `AudioTranscriptionBar.tsx`; do not restore auto-transcription-on-upload
- Code Interpreter media exclusion in `AudioTranscriptionBar.tsx`; the bar must not offer transcription for files marked with `tool_resource=execute_code`, `source=execute_code`, native `execute_code`, or a code file identifier
- model-specific parameter handling in `transcribeMediaFile.js`

### Additional lessons learned

- do not use LibreChat's normal `unfinished: true` assistant-response path for background transcription progress; it renders the red incomplete-response warning and makes healthy jobs look broken
- use explicit transcription metadata (`processing` / `completed` / `failed`) on the response message and poll against that state instead of generic incomplete-message semantics
- large-file transcription should persist partial text after each completed chunk so users see quasi-streaming progress instead of a static placeholder until the very end
- before navigating from `/c/new` into the dedicated transcript conversation, clear stale compose-box state: reset the latest-message atom so follow-up questions are not blocked, and clear `filesDraft_new` / attached-file state so the uploaded audio does not leak into later new chats

---

## 12. Google auth mode support (API key, Vertex service account, Vertex ADC)

### What it does

- Supports three Google/Vertex AI authentication modes: Gemini API key, Vertex AI service account JSON, and Vertex AI application default credentials (ADC)
- Shared credential resolution helpers (`prepareGoogleCredentials`, `resolveGoogleClientAuth`) in `packages/api/src/endpoints/google/auth.ts`
- All Google-consuming paths (chat, realtime voice, image generation) use the same auth logic
- `GOOGLE_AUTH_MODE` env var controls the mode; auto-detection when omitted
- Google endpoint settings UI (`GoogleConfig.tsx`) with auth mode dropdown and conditional field rendering
- The Google endpoint is marked available when any valid auth mode is configured
- Chat initialization falls back to server Vertex credentials when `GOOGLE_KEY=user_provided` is set, the user has no saved Google key, and server-side Vertex auth is available
- Chat initialization also honors discovered per-model Vertex locations/fallbacks so models callable only on `global` or another region can still work under a regional default

### Main files

- `packages/api/src/endpoints/google/auth.ts`
- `packages/api/src/endpoints/google/llm.ts`
- `packages/api/src/endpoints/google/initialize.ts`
- `packages/data-provider/src/config.ts` (`GoogleAuthMode` enum, `AuthKeys`)
- `api/server/services/Config/loadAsyncEndpoints.js`
- `api/server/services/Realtime/modelService.js`
- `api/app/clients/tools/structured/GeminiImageGen.js`
- `client/src/components/Input/SetKeyDialog/GoogleConfig.tsx`
- `client/src/components/Input/SetKeyDialog/SetKeyDialog.tsx`

### Preserve during merges

- shared Google auth helpers remain the single source of truth for credential resolution
- three-mode auth across chat, realtime, and image generation
- `GoogleAuthMode` enum and extended `AuthKeys` in data-provider
- Google endpoint settings UI with conditional field rendering
- ADC detection logic (requires explicit mode or `GOOGLE_APPLICATION_CREDENTIALS`, not just `GOOGLE_CLOUD_PROJECT`)
- server-side fallback from missing user Google keys to configured Vertex credentials in chat initialization
- model-specific Vertex route overrides/fallbacks during Google chat initialization after discovery
- runtime enforcement that `GOOGLE_SERVICE_KEY_FILE` must exist inside each running container/rail, not just in `.env`

---

## 13. Internet Archive / Wayback read-only MCP server integration

### What it does

- Runs the external `/pool/home/timeng/internet-archive-mcp-server` FastMCP service as LibreChat MCP server `internet-archive`
- Uses streamable HTTP at `http://192.168.50.4:8770/mcp`
- Exposes 19 read-only Wayback and archive.org tools for capture lookup, CDX search, snapshot text/source fetches, snapshot comparison, item search, metadata, files/full text, reviews, views, and Simple Lists
- Intentionally excludes write/auth/destructive Internet Archive APIs such as Save Page Now, uploads/deletes, metadata writes, review writes, relationship writes, and task submissions

### Main files

- `librechat.yaml` (runtime, gitignored)
- `/pool/home/timeng/internet-archive-mcp-server`
- `/home/timeng/.config/systemd/user/internet-archive-mcp.service`
- `INTERNET_ARCHIVE_MCP.md`

### Preserve during merges

- `mcpServers.internet-archive` must remain `type: streamable-http` at `http://192.168.50.4:8770/mcp` with `timeout: 90000`
- `http://192.168.50.4:8770` must remain in `mcpSettings.allowedDomains`
- the external server must stay read-only unless a separate security review and explicit approval authorizes writes
- preserve rate limiting, `Retry-After` handling, bounded output limits, and binary-derivative safeguards for full-text selection

### Supporting docs

- `INTERNET_ARCHIVE_MCP.md`
- `CUSTOMIZATION_MASTER_DOC.md`

---

## 14. arXiv research MCP server integration with prompt-injection guardrails

### What it does

- Runs the external `/pool/home/timeng/arxiv-mcp-server` service as LibreChat MCP server `arxiv`
- Uses streamable HTTP at `http://192.168.50.4:8771/mcp/`
- Sets the official arXiv logomark via `iconPath`
- Exposes `search_papers`, `get_abstract`, `download_paper`, `read_paper`, `list_papers`, and `citation_graph`
- Injects server instructions warning that arXiv paper content is untrusted external input and must never override system/developer/user/platform instructions
- Hides upstream stateful/heavy tools (`watch_topic`, `check_alerts`, `semantic_search`, `reindex`) with the service `ENABLED_TOOLS` allowlist

### Main files

- `librechat.yaml` (runtime, gitignored)
- `/pool/home/timeng/arxiv-mcp-server`
- `/pool/home/timeng/arxiv-mcp-server/src/arxiv_mcp_server/config.py`
- `/pool/home/timeng/arxiv-mcp-server/src/arxiv_mcp_server/server.py`
- `/pool/home/timeng/arxiv-mcp-server/src/arxiv_mcp_server/tools/download.py`
- `/pool/home/timeng/arxiv-mcp-server/src/arxiv_mcp_server/tools/list_papers.py`
- `/pool/home/timeng/arxiv-mcp-server/src/arxiv_mcp_server/tools/read_paper.py`
- `/home/timeng/.config/systemd/user/arxiv-mcp.service`
- `ARXIV_MCP.md`

### Preserve during merges

- `mcpServers.arxiv` must remain `type: streamable-http` at `http://192.168.50.4:8771/mcp/` with `timeout: 180000`, `initTimeout: 30000`, icon, and prompt-injection instructions
- `http://192.168.50.4:8771` must remain in `mcpSettings.allowedDomains`
- keep the trailing slash on `/mcp/`; the no-slash URL returns a `307` redirect that broke LibreChat streamable HTTP initialization
- keep paper-ID validation/path confinement in the external server before exposing `download_paper` platform-wide
- keep untrusted-content warnings prepended to paper text returned by `download_paper` and `read_paper`
- keep `ALLOWED_HOSTS` constrained to trusted host values and verify unexpected Host headers are rejected
- keep platform-exposed tools limited unless a separate review approves shared watches or semantic indexing

### Supporting docs

- `ARXIV_MCP.md`
- `CUSTOMIZATION_MASTER_DOC.md`

---

## Existing supporting docs already in this branch

These documents still matter and should not be forgotten just because this master guide exists:

- `README.local.md`
- `UPSTREAM_RELEASE_UPDATE.local.md`
- `LOCAL_UPSTREAM_SYNC_WORKFLOW.local.md`
- `SCHEDULED_RUNS.md`
- `OLLAMA_WEB_SEARCH.md`
- `OLLAMA_REASONING.md`
- `XAI_CUSTOM_ENDPOINTS.md`
- `OPENAI_GEMINI_NATIVE_TOOLS.md`
- `OPENAI_GEMINI_NATIVE_TOOLS_IMPLEMENTATION.md`
- `INTERNET_ARCHIVE_MCP.md`
- `ARXIV_MCP.md`
- `PATCHED_REMOTE_IMAGE_REFERENCE.md`

This guide is the top-level map. Those docs remain the deeper references.

---

## Highest-risk files during future merges

These are the files and areas most likely to need careful manual review when merging upstream changes:

### Runtime/config surface

- `.env.example`
- `librechat.yaml` (runtime, gitignored; preserve `endpoints.agents` recursion settings, local MCP allowlist entries through `http://192.168.50.4:8771`, keep static `mcpServers.arcade-read` absent, and preserve `mcpServers.openai-cua-browser`, `mcpServers.internet-archive`, plus `mcpServers.arxiv` with its trailing-slash `/mcp/` URL)
- `librechat.example.yaml`
- `api/server/routes/config.js`
- `packages/api/src/endpoints/models.ts`
- `packages/api/src/endpoints/byok.ts`
- `packages/api/src/endpoints/{openai,anthropic,google,bedrock,custom}/initialize.ts`

### Admin/RBAC/app settings

- `api/server/controllers/AdminController.js`
- `api/server/middleware/buildEndpointOption.js`
- `api/server/services/Admin/*`
- `api/server/controllers/agents/client.js`
- `client/src/components/Admin/AdminConsole.tsx`
- `packages/api/src/agents/context.ts`
- `packages/data-provider/src/admin.ts`
- `packages/data-schemas/src/schema/{adminRole,appSettings,user}.ts`

### Scheduled runs

- `api/server/controllers/ScheduledJobsController.js`
- `api/server/services/ScheduledJobs/*`
- `client/src/components/Nav/SettingsTabs/Data/ScheduledRuns.tsx`
- `client/src/data-provider/Schedules/*`

### Model access restrictions

- `api/server/services/ModelAccess.js`
- `api/server/services/ModelRateLimits.js`
- `api/server/controllers/ModelController.js`
- `api/server/middleware/validateModel.js`
- account creation/auth strategy files
- `packages/data-schemas/src/schema/user.ts`

### Native-tool routing and file metadata

- `packages/api/src/agents/nativeTools.ts`
- `api/server/services/Files/process.js`
- `packages/data-schemas/src/schema/file.ts`
- related file metadata/types/methods

### Sidebar grouping and preset ordering

- `client/src/utils/convos.ts` — fixed sidebar recency/date buckets: Today, Yesterday, Last week, Last month, current-year month buckets, Last year, Older than last year
- `api/models/Preset.js`
- `api/server/routes/presets.js`
- `client/src/hooks/Conversations/usePresets.ts`
- `client/src/components/Chat/Menus/Presets/PresetItems.tsx`
- `packages/data-provider/src/{api-endpoints,data-service,keys}.ts`

### MCP interoperability and OAuth flows

- `client/src/components/Chat/Input/MCPSelect.tsx`
- `client/src/components/Chat/Input/MCPSelect.guards.spec.ts`
- `client/src/components/SidePanel/Agents/MCPTools.tsx`
- `client/src/components/Tools/MCPToolSelectDialog.tsx`
- `packages/api/src/mcp/zod.ts`
- `packages/api/src/mcp/registry/MCPServersRegistry.ts`
- `packages/api/src/mcp/oauth/handler.ts`
- `packages/api/src/mcp/MCPConnectionFactory.ts`
- `packages/data-schemas/src/schema/mcpServer.ts`
- `api/server/routes/mcp.js`
- `docker-compose.local.override.yml`

### Ollama/Google/xAI behavior

- `packages/api/src/endpoints/models.ts`
- `packages/api/src/endpoints/custom/config.ts`
- `packages/api/src/endpoints/custom/initialize.ts`
- `packages/api/src/endpoints/google/llm.ts`
- `packages/api/src/endpoints/openai/llm.ts`
- `packages/data-provider/src/xai.ts`
- `packages/data-provider/src/parameterSettings.ts`
- `client/src/components/Endpoints/Settings/XAI.tsx`
- `api/server/services/Tools/ollama.js`
- `client/src/components/Endpoints/Settings/Google.tsx`
- `client/src/components/Chat/Input/WebSearchSubMenu.tsx`

### Audio transcription

- `api/server/services/Files/Audio/transcribeMediaFile.js`
- `api/server/services/Files/Audio/transcriptionQueue.js`
- `api/server/services/Files/Audio/STTService.js`
- `api/server/routes/files/files.js`
- `client/src/hooks/Files/useFileHandling.ts`
- `client/src/components/Chat/Input/Files/AttachFileMenu.tsx`
- `packages/data-schemas/src/schema/file.ts`

### Google auth mode

- `packages/api/src/endpoints/google/auth.ts`
- `packages/api/src/endpoints/google/llm.ts`
- `packages/api/src/endpoints/google/initialize.ts`
- `api/server/services/Config/loadAsyncEndpoints.js`
- `api/server/services/Realtime/modelService.js`
- `api/app/clients/tools/structured/GeminiImageGen.js`
- `client/src/components/Input/SetKeyDialog/GoogleConfig.tsx`
- `client/src/components/Input/SetKeyDialog/SetKeyDialog.tsx`

### Local startup and deployment workflow

- `Dockerfile`
- `Dockerfile.remote-patched`
- `local-services/*`
- `local-services/deploy-runtime-delta.sh` — guarded backend/config/package-dist fast deploy with snapshot/restart/health-check
- `local-services/deploy-built-client-dist.sh` — mandatory manifest-verified whole-`client/dist` deploy/rollback guard for frontend code
- `client/scripts/post-build.cjs` — emits the integrity manifest required for frontend deployment
- `.devcontainer/*`

---

## Practical merge checklist

When pulling Danny Avila upstream changes into this custom branch:

1. update upstream `main` in `/pool/home/timeng/LibreChat`
2. merge that `main` into `engt21/local-customizations`
3. inspect all conflicts in the high-risk files listed above
4. re-check these custom feature buckets one by one:
   - admin console and RBAC
   - scheduled runs
   - model access restrictions
   - native tools
   - MCP schema normalization and OAuth flows
   - Google discovery and grounding
   - xAI discovery and capability-aware settings
   - Ollama routing/search/reasoning
   - audio/video transcription queue and runner
   - Google auth mode (API key / Vertex service account / Vertex ADC)
   - sidebar chat grouping and user-sortable preset ordering
   - local runtime scripts and startup behavior
5. if `package-lock.json` conflicts, regenerate it with:

```bash
cd /pool/home/timeng/LibreChat-custom
npm install --package-lock-only --ignore-scripts
```

6. run relevant validation after the merge
7. validate from `LibreChat-custom`; rebuild/restart VM stable only after explicit production-maintenance approval

For the MCP/OAuth customization area, the targeted checks are currently:

```bash
cd /pool/home/timeng/LibreChat-custom/packages/api
npx jest --runInBand --testPathPatterns=src/mcp/__tests__/handler.test.ts
npx jest --runInBand --testPathPatterns=src/mcp/__tests__/zod.spec.ts

# Read-only VM runtime confirmation:
ssh timeng@192.168.50.104 'docker exec LibreChat node -e "console.log(process.env.DOMAIN_SERVER || \"\")"'
```

The route suite at `api/server/routes/__tests__/mcp.spec.js` still has the known local Alpine `mongodb-memory-server` limitation.

---

## Local run commands that should remain true

### Main local app stack

```bash
cd /pool/home/timeng/LibreChat-custom
./local-services/start-all.sh
./local-services/status-all.sh
./local-services/stop-all.sh
```

### Boot-time helpers

```bash
cd /pool/home/timeng/LibreChat-custom
./local-services/enable-on-boot.sh
./local-services/disable-on-boot.sh
```

---

## Runtime config requirements

The runtime `librechat.yaml` must include these sections beyond endpoints. In the source worktree it may be symlinked from the upstream-sync runtime files; on the VM it is bind-mounted from `/opt/LibreChat-custom/librechat.yaml`.

- `memory:` -- required for user memories to be retrieved and injected into agent conversations. Without this section, `useMemory()` silently returns early and stored memories are never used. The `provider` value must use `EModelEndpoint` casing (e.g., `"openAI"` not `"openai"`), because `getProviderConfig` does a case-sensitive lookup against `providerConfigMap`. Minimum:

```yaml
memory:
  agent:
    provider: 'openAI'
    model: 'gpt-4.1-mini'
```

- `speech:` -- required for STT/TTS functionality
- Arcade/Microsoft MCP servers are not static YAML defaults; keep `mcpServers.arcade-read` absent and manage Arcade entries through user/admin DB-backed MCP registration and publishing workflows.
- `mcpServers.internet-archive` and `mcpServers.arxiv` -- local research MCP servers; keep their allowed-domain entries and arXiv trailing `/mcp/` URL intact.

When upstream adds new config-gated features, always check whether the corresponding section exists in the runtime `librechat.yaml`.

---

## Current operational assumption

The running local app should be the custom build from:

- source worktree: `/pool/home/timeng/LibreChat-custom`
- VM runtime bundle: `/opt/LibreChat-custom`
- image: `librechat-local:latest`

The source worktree is the intended source of truth for code and local validation behavior; the VM bundle is the live production runtime.

---

## Summary

If future upstream merges get complicated, do not try to remember everything from memory.

Use this order:

1. this master guide
2. the focused supporting docs
3. the key file lists in each section
4. the running local worktree conventions in `LibreChat-custom`

If a future merge preserves the feature buckets and preserve-lists in this document, it should preserve the substance of the custom branch.
