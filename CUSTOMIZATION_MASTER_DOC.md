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
4. Provider-native tools plus Anthropic live model discovery and capability-aware settings
5. OpenAI/Azure plus Google Gemini model-family capability-aware settings
6. xAI custom-endpoint live model discovery and capability-aware settings
7. Ollama multi-source model discovery, hosted web search, and reasoning controls
8. MCP interoperability, OAuth hardening, and per-server tool filtering for OpenAI / Arcade-hosted MCP tools
9. Realtime voice brokered sessions across OpenAI/Azure/Gemini/xAI-compatible providers
10. Local code interpreter bridge with warm-session reuse and provider-routing controls
11. Langfuse pricing sync, historical backfill, and alias-aware observability support
12. Azure direct Azure OpenAI / Azure AI Foundry per-user endpoint support
13. Local runtime / Docker / startup / observability / worktree conventions
14. Background audio/video transcription with persistent conversations
15. Google auth mode support (API key, Vertex service account, Vertex ADC)
16. Math and computation tools (Scientific Calculator + Code Interpreter Math)
17. Runtime librechat.yaml interface, modelSpecs quick-selector, and endpoint configuration
18. Auth cookie and session hardening for plain-HTTP LAN deployments
19. UX bug fixes: stop button persistence, badge row visibility, pinned model reset
20. User-managed image generation: per-provider model discovery, settings tab, chat-bar toggle, and ephemeral-agent auto-injection
21. Internet Archive / Wayback read-only MCP server integration

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
- user API-key updates/revokes invalidate server-side model discovery caches (`MODEL_QUERIES`, `MODELS_CONFIG`, startup refresh latch) and client-side `models`/`endpoints`/`startupConfig` queries so BYOK OpenAI/Anthropic model lists refresh immediately after key rotation
- an admin-managed platform system prompt, stored in `AppSettings.platformPrompt`, that super admins edit from Workspace settings and the server prepends ahead of preset/user/agent instructions for Assistants and Agents
- optional model steering, gated by `AppSettings.modelSteeringEnabled` plus per-user `modelSteeringPrefs.enabled`: while a non-Assistants generation is running, the normal chat bar changes to the steering placeholder, keeps Stop visible, and Enter/Send posts the steering text to `POST /api/agents/chat/steer`. The backend aborts the active stream, saves the partial assistant response, then restarts the continuation with the steering instruction parented to that partial response.
- a "Model discovery" section in the admin console with a "Refresh all providers" button plus per-provider refresh buttons; this drops the `MODEL_QUERIES` and `MODELS_CONFIG` caches, resets the in-process startup-refresh latch, and re-runs `loadModels` so freshly released models (e.g., `gpt-5.5`, `gpt-5.5-pro`) appear in the picker without restarting the server. Backed by `POST /api/admin/models/refresh` (gated by `AdminPermissions.SETTINGS_WRITE`)
- merge-mode resolution for env-pinned model lists (`OPENAI_MODELS`, `ANTHROPIC_MODELS`, `GOOGLE_MODELS`, `AZURE_OPENAI_MODELS`, etc.). Each `*_MODELS` env var is paired with a `*_MODELS_MODE` knob (`override` (default) or `merge`). In merge mode, the env list is preserved at the front and unioned (deduped, optionally filtered for OpenAI text-compatibility) with anything live discovery returns, so newly released provider models surface after the admin refresh button without dropping curated env-pinned ids. Discovery failures fall back to the env list verbatim. BYOK OpenAI/Anthropic discovery uses the resolved per-user key/base URL with user-scoped cache keys and never tries to use the `user_provided` sentinel as a live API key. Custom YAML endpoints (xAI/Ollama/etc.) get an analogous resolution: `endpoint.models.mode` (YAML) → `CUSTOM_MODELS_MODE` env → xAI defaults to `merge`, others default to `override`
- version-descending sort for the merged OpenAI/Anthropic/Google model lists. Each provider has a `getXxxModelVersionScore` + `sortXxxModelsByVersion` helper in `packages/api/src/endpoints/models.ts` that ranks model ids by extracted `<major>.<minor>` so that newer frontier ids (e.g., `gpt-5.5-pro-2026-04-23`) sit at the top of the chat picker rather than appended after legacy `gpt-3.5/gpt-4` entries the live API returns earlier. `*-instruct` always sinks to the very bottom and Azure deployments preserve admin-curated order (no auto-sort) since deployment names are operator-controlled.

#### Key files

Backend:

- `api/server/controllers/AdminController.js`
- `api/server/controllers/ModelSteeringController.js`
- `api/server/controllers/ModelController.js`
- `api/server/controllers/agents/request.js`
- `api/server/services/Models/refreshModels.js`
- `api/server/routes/agents/chat.js`
- `api/server/routes/keys.js`
- `api/server/routes/modelSteering.js`
- `api/server/services/Models/refreshModels.spec.js`
- `api/server/routes/admin/index.js`
- `api/server/middleware/adminAccess.js`
- `api/server/middleware/buildEndpointOption.js`
- `api/server/services/Admin/appSettings.js`
- `api/server/services/Admin/permissions.js`
- `api/server/services/Admin/superadmin.js`
- `api/server/controllers/agents/client.js`
- `api/server/middleware/validateRegistration.js`
- `api/models/index.js`
- `config/sync-superadmins.js`

Frontend/shared:

- `client/src/components/Admin/AdminConsole.tsx`
- `client/src/components/Nav/SettingsTabs/Personalization.tsx`
- `client/src/hooks/Chat/useChatHelpers.ts`
- `client/src/hooks/Input/useTextarea.ts`
- `client/src/hooks/Messages/useSubmitMessage.ts`
- `client/src/components/Chat/Menus/Endpoints/ModelSelectorContext.tsx`
- `client/src/components/Chat/Menus/Endpoints/components/EndpointItem.tsx`
- `client/src/components/Chat/Menus/Endpoints/components/EndpointModelItem.tsx`
- `client/src/components/Chat/Menus/Endpoints/components/SearchResults.tsx`
- `client/src/data-provider/Admin/index.ts`
- `client/src/data-provider/Admin/mutations.ts`
- `client/src/data-provider/Admin/queries.ts`
- `packages/api/src/agents/context.ts`
- `packages/data-provider/src/admin.ts`
- `packages/data-provider/src/modelSteering.ts`
- `packages/data-provider/src/createPayload.ts`
- `packages/data-provider/src/react-query/react-query-service.ts`
- `packages/data-schemas/src/schema/adminRole.ts`
- `packages/data-schemas/src/schema/appSettings.ts`
- `packages/data-schemas/src/types/adminRole.ts`
- `packages/data-schemas/src/types/appSettings.ts`
- `packages/data-schemas/src/schema/user.ts`
- `packages/data-schemas/src/types/user.ts`

#### Preserve during merges

- `/api/admin` route mounting and middleware
- `SUPERADMIN_EMAILS` sync behavior
- DB-backed app settings and registration gating
- `AppSettings.platformPrompt` normalization, admin UI wiring, and prompt-prepend behavior in `buildEndpointOption` plus `packages/api/src/agents/context.ts`
- `AppSettings.modelSteeringEnabled`, `user.modelSteeringPrefs.enabled`, `PATCH /api/model-steering/prefs`, and `POST /api/agents/chat/steer` server-side gates; do not rely on frontend-only hiding
- the model steering abort/save/restart contract in `api/server/routes/agents/chat.js`, including active-job ownership checks, partial assistant persistence, and continuation parenting to the saved partial assistant message
- normal chat-bar steering UX in `ChatForm.tsx`, `useTextarea.ts`, `useSubmitMessage.ts`, and `useChatHelpers.ts`: no separate steering textarea, Stop and Send coexist during steerable generation, Enter submits steering even when `enterToSend` is off, first-message streams can steer once the latest assistant message has a real conversation id, and the input/draft clears after submit
- host-aware admin observability links
- admin console UI and its data-provider wiring
- super-admin-only model-picker API-key settings access
- `POST /api/admin/models/refresh` route, the `refreshModels` service, the lazy-required call site inside `AdminController.refreshAdminModelsController`, and the exported `resetStartupModelRefresh` helper from `ModelController.js`
- `PUT`/`DELETE /api/keys` cache invalidation for model discovery and client query invalidation after user-key mutations
- the "Model discovery" section in `AdminConsole.tsx` plus the `useRefreshAdminModelsMutation` hook and its `adminRefreshModels` endpoint helper
- the `resolveModelsListMode` and `unionWithLiveDiscovery` helpers in `packages/api/src/endpoints/models.ts` and the `*_MODELS_MODE` env conventions documented in `.env`
- the `resolveCustomEndpointModelsMode` helper inside `api/server/services/Config/loadConfigModels.js` (xAI default-merge cascade, YAML/env override surface)
- the `getOpenAIModelVersionScore` / `sortOpenAIModelsByVersion` (and Anthropic/Google equivalents) helpers in `packages/api/src/endpoints/models.ts` AND every call-site that uses them (currently `fetchOpenAIModels`, the `getOpenAIModels` merge branch, the `getAnthropicModels` merge branch, and the `getGoogleModels` merge branch). Removing any of those sort calls reverts the picker to chronological order from the live API, which is what triggered the original "gpt-5.5 below gpt-4" bug.

#### Lessons learned

- The admin "Refresh models" flow lazy-requires `~/server/services/Models/refreshModels` from inside `refreshAdminModelsController` so the existing `AdminController` spec suites (which mock only a minimal `librechat-data-provider` and a thin `ModelController`) keep loading without having to also mock the cache layer. Keep this require lazy on future merges.
- A successful refresh must invalidate `[QueryKeys.models]`, `[QueryKeys.endpoints]`, and `[QueryKeys.startupConfig]` on the client so the chat picker, endpoint list, and startup config all pick up the new models.
- User-key updates must invalidate the same model/startup caches as the admin refresh flow. Otherwise a rotated Anthropic/OpenAI BYOK key can be saved successfully while stale server `MODEL_QUERIES`/`MODELS_CONFIG` results continue hiding newly released models until process restart.
- The platform prompt must be prepended, not appended: Assistants merge it before `promptPrefix`, and Agents pass it into `buildAgentInstructions` before shared run context, agent/user instructions, and MCP instructions.
- Model steering must be enforced on the server as well as the client. The `/api/agents/chat/steer` route checks workspace enablement, user preference, stream ownership, running-state, and endpoint support before aborting the active job.
- The steering input is the normal chat bar. During a steerable stream, `useTextarea` intentionally bypasses the usual `enterToSend=false` newline behavior so a plain Enter submits steering, while Stop remains independently clickable.
- New-chat steering cannot depend only on `conversation.conversationId`, because the URL can remain `/c/new` while the backend has already assigned the active stream a real conversation id. Use `latestMessage.conversationId` as the fallback for both steering and Stop.
- Clear both form state and pending/conversation drafts after steering submit. Otherwise autosave can restore the steering instruction into the input after the continuation finishes.
- `OPENAI_MODELS` / `ANTHROPIC_MODELS` / `GOOGLE_MODELS` short-circuit live discovery in `getOpenAIModels`/`getAnthropicModels`/`getGoogleModels` whenever they are set. Without `*_MODELS_MODE=merge`, even the admin refresh button cannot surface newer models (e.g., `gpt-5.5`) because the env list strictly overrides discovery. The dev/stable `.env` ships with `OPENAI_MODELS_MODE=merge` and `GOOGLE_MODELS_MODE=merge`. `ANTHROPIC_MODELS_MODE=merge` is supported but disabled by default (no `ANTHROPIC_MODELS` is currently set).
- In merge mode we explicitly pass `[]` as the seed to `fetchOpenAIModels`/`fetchAnthropicModels` so a discovery failure returns `[]` (which `unionWithLiveDiscovery` treats as fallback). Passing the static defaults as the seed would cause failed discoveries to leak the upstream default list into the merged result.
- For OpenAI (non-Azure), the merged list runs through `filterOpenAITextCompatibleModels` to drop audio/realtime/embedding/image variants the chat path cannot use. Azure deployments skip the filter because deployment names are admin-controlled and may not match the OpenAI-id heuristic.
- **Model picker ordering must be version-descending, not API-creation order.** The OpenAI `/v1/models` endpoint returns ids in a roughly chronological-by-creation order (often `gpt-3.5-turbo` → `gpt-4*` → `gpt-4o*` → newer ids). When merge mode appended live results to a curated env list, freshly-released models like `gpt-5.5-pro-2026-04-23` ended up far below `gpt-4` and `gpt-3.5-turbo` in the picker. The fix is the `sortOpenAIModelsByVersion` helper, applied in BOTH `fetchOpenAIModels` (live-only path) AND `getOpenAIModels` merge-mode (post-union). If you ever add a new code path that surfaces model ids to the client, run it through the corresponding `sortXxxModelsByVersion` helper before returning. Equivalent helpers exist for Anthropic and Google. Azure deployments are intentionally NOT auto-sorted because deployment names (e.g. `gpt5-prod`) are operator-controlled and the configured order is meaningful.
- The version sort is intentionally regex-based, not an explicit allow-list, so it keeps working as OpenAI ships new families (`gpt-5.5`, `gpt-5.6`, `o5`, ...). The score is `major*100 + minor` for `gpt-X.Y` / `chatgpt-X.Y` and `N*100` for `oN` reasoning models, so `o4-mini` ≈ `gpt-4` and both rank below `gpt-5*`. Unknown ids return `-1` and sort to the end (above instruct).

---

### 3.2 Scheduled runs and notifications

#### What it adds

- per-user scheduled runs for prompts and agent executions
- manual run-now execution path
- scheduler runner process started by the backend
- scheduled-run target support for richer ephemeral-agent tool settings:
  - MCP server selection (`mcp[]`)
  - per-server MCP tool subsets (`mcpToolFilter`)
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
- `api/server/services/Tools/mcpToolFilter.js`
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
- `client/src/hooks/MCP/useMCPSelect.ts`
- `client/public/assets/push-sw.js`
- `packages/data-provider/src/schedules.ts`
- `packages/data-schemas/src/schema/scheduledJob.ts`
- `packages/data-schemas/src/types/scheduledJob.ts`

#### Preserve during merges

- `/api/schedules` routes and controller
- backend startup hook for the scheduled runner
- scheduled-job schema/model/types
- scheduled-run target normalization for nested `ephemeralAgent` fields during create/update
- scheduled-run settings UI for MCP server/tool-subset/artifact/web-search options
- push service worker and browser notification plumbing
- env/config support for scheduled runner and notifications

#### Relevant env/config surface

- `SCHEDULED_RUNNER_*`
- `TWILIO_*`
- `WEB_PUSH_VAPID_*`
- `DOMAIN_CLIENT`

#### Lessons learned

- Scheduled-run edits must merge nested `target.ephemeralAgent` fields instead of replacing the whole object, or saved tool selections disappear on update.
- Keep UI and backend schemas aligned for every scheduled-run target field (`mcp`, `mcpToolFilter`, `execute_code`, `file_search`, `artifacts`, `web_search_mode`) or the controller will silently drop user selections.
- For MCP scheduled runs, `mcp[]` is the selected server list; `mcpToolFilter[server]` is optional and means "only these concrete tool keys." Missing filter entries must keep the backward-compatible all-tools default.
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
- `openAI`: `gpt-5*`
- `anthropic`: `claude-opus-4-*`, `claude-sonnet-4-*`, `claude-haiku-4-*`, plus explicit current 4.x entries and legacy Claude 3.x/Haiku defaults
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
- per-model wildcard matching for both filtering and validation so new frontier model IDs are not hidden from non-admin users solely because the static allowlist predates the provider release

---

### 3.4 Provider-native tools plus Anthropic live discovery and capability-aware settings

#### What it adds

- routes chat-bar tool toggles to provider-native capabilities when supported
- native handling for OpenAI/Azure web search, code interpreter, and file search
- native handling for Gemini search/code execution where safe
- live Anthropic model discovery from Anthropic's models endpoint, with normalized capability metadata exposed to startup config
- Anthropic model picker quick-select ordering driven by the live model list so newest/highest-tier Claude models float to the top automatically
- capability-aware Anthropic sidebar and agent-builder parameter rendering for thinking, fixed thinking budgets vs adaptive effort, sampling controls, prompt caching, service tier, web search, and file token limits
- native Anthropic web search and native Anthropic code execution when the selected Claude model supports them
- server-side model capability gating for OpenAI/Anthropic native tools so unsupported model/tool combinations remain on the structured/local fallback path instead of being sent as invalid provider-native requests
- Anthropic web-search history sanitization drops orphaned `server_tool_use` web-search blocks that no longer have a matching `web_search_tool_result`, preventing invalid replay errors on subsequent Claude turns
- Anthropic thinking-block sanitization drops incomplete `thinking` blocks before DB save and runtime request replay, preventing Claude history requests from failing with `messages.*.content.*.thinking.thinking: Field required` after interrupted native-tool streams
- dual Anthropic code-interpreter routing: users can keep using the local LibreChat code interpreter or switch to Anthropic-native code execution on a per-chat basis
- local file uploads remain on LibreChat storage for Anthropic chats, and provider-native code execution automatically falls back to the local code interpreter when local code files are attached
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
- `packages/api/src/endpoints/models.ts`
- `packages/api/src/endpoints/anthropic/helpers.ts`
- `packages/api/src/endpoints/anthropic/llm.ts`
- `packages/api/src/agents/resources.ts`
- `packages/api/src/utils/content.ts`
- `api/server/controllers/agents/client.js`
- `api/server/controllers/ModelController.js`
- `api/server/routes/config.js`
- `api/server/services/Endpoints/agents/initialize.js`
- `api/server/services/Endpoints/agents/addedConvo.js`
- `api/server/services/Files/process.js`
- `api/app/clients/BaseClient.js`
- `client/src/Providers/BadgeRowContext.tsx`
- `client/src/components/Chat/Input/CodeInterpreterSubMenu.tsx`
- `client/src/components/Chat/Input/ToolsDropdown.tsx`
- `client/src/components/Chat/Menus/Endpoints/components/EndpointItem.tsx`
- `client/src/components/SidePanel/Parameters/Panel.tsx`
- `client/src/components/SidePanel/Agents/ModelPanel.tsx`
- `client/src/hooks/Files/useFileHandling.ts`
- `client/src/utils/endpoints.ts`
- `client/src/utils/localStorage.ts`
- `client/src/utils/timestamps.ts`
- `packages/data-provider/src/anthropic.ts`
- `packages/data-provider/src/parameterSettings.ts`
- `packages/data-provider/src/config.ts`
- `packages/data-provider/src/types.ts`
- `packages/data-provider/src/schedules.ts`
- `packages/data-provider/src/schemas.ts`
- `packages/data-schemas/src/schema/defaults.ts`
- `packages/data-schemas/src/schema/preset.ts`
- `packages/data-schemas/src/types/convo.ts`
- `packages/data-schemas/src/types/scheduledJob.ts`
- `api/server/controllers/ScheduledJobsController.js`
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
- OpenAI and Anthropic native-tool selection must remain model-aware, not just provider-aware; provider-native tools should only be selected when the selected model capability metadata explicitly allows the requested tool
- Anthropic server-tool history filtering must preserve paired `server_tool_use`/`web_search_tool_result` blocks but drop orphaned web-search server-tool blocks before replaying conversation history
- Anthropic thinking-block history filtering must continue to drop partial `type: 'thinking'` blocks that lack non-empty `thinking` or `signature` fields; valid signed thinking blocks must be preserved exactly
- Anthropic live-model discovery, quick-select sorting, and startup capability metadata
- Anthropic code-execution mode persistence (`librechat` vs `provider_native`) for chat and scheduled-run flows
- Anthropic provider-native code execution must continue to fall back to the local LibreChat interpreter when local code files are attached
- Anthropic parameter gating must continue to treat the model's default thinking state as authoritative when the conversation has not yet persisted an explicit `thinking` value
- client capability detection and UI routing

#### Lessons learned

- 2026-04-04 prod incident: a stable image still carried the legacy `graph.getStepIdByKey(stepKey)` web-search-status patch in `@librechat/agents`, which crashed GPT-5.4 / Responses streams with `Cannot access 'stepKey' before initialization` as soon as native web search status events arrived.
- Prevention: keep the runtime patch validator and Jest coverage in place, and rebuild the affected rail after any runtime-patch change so the containerized `node_modules` copy cannot drift behind the worktree fix.
- 2026-04-05 code interpreter failure: OpenAI Responses API rejects `reasoning` items (type `rs_…`) in reconstructed conversation history when the `id` field is present but the required following output item (e.g. `code_interpreter_call`) is not in the exact position the API expects. Fix: strip `id` from reasoning items during reconstruction in `_convertMessagesToOpenAIResponsesParams` and skip reasoning items that have no `summary` data. Patch added to `config/apply-runtime-patches.js` for both ESM and CJS dist targets.
- 2026-04-05 deployment slowness: **never use `--no-cache` for Docker builds** unless the Dockerfile or base image changed. The `COPY . .` layer already invalidates everything after it when source files change, so cache is only skipped for the frontend build (~10 min) and later steps. Using `--no-cache` forces a full `npm install` (~3 min) on top of that, turning a 12-min build into 25+ min. For small fixes (e.g. a runtime patch or a few TS/JS file changes), the fastest deployment path is: **(1)** patch files directly inside the running container via `docker exec python3 -c "..."`, **(2)** `docker restart <container>`, **(3)** schedule a proper cached image rebuild for the next maintenance window. Record every in-container hotfix in `apply-runtime-patches.js` so the next `docker compose build` bakes it in permanently.
- 2026-04-06 Langfuse Azure model naming: The `@langfuse/langchain` `CallbackHandler.extractModelNameFromMetadata()` reads `response_metadata.model_name` from the API response at generation END, overwriting the correct `azure-openai/gpt-5.4-mini` model name set at generation START via `invocationParams`. Azure API responses return bare model names without the `azure-openai/` prefix. Fix: disable `extractModelNameFromMetadata` (return `undefined`) in `@langfuse/langchain` so the START event model name from `invocationParams` is preserved. Patch added to `config/apply-runtime-patches.js` under `langfusePatchTargets`. Root cause chain: `AzureChatOpenAI.invocationParams()` → sets `params.model = 'azure-openai/X'` ✓ → Langfuse START uses it ✓ → Azure API responds with `model: 'X'` → Langfuse END overwrites with bare `'X'` ✗.
- 2026-04-06 Ollama Cloud 401 unauthorized: Single `apiKey: '${OLLAMA_API_KEY}'` was shared across local and cloud `baseURLs`. Cloud (`ollama.com/v1/`) requires user-provided auth keys, while local Ollama needs none. Fix: split into two separate custom endpoints in `librechat.yaml` — "Ollama" (local, server key `${OLLAMA_MULTI_API_KEY}`, `baseURL` + `baseURLs` for local instances only, `models.default` listing actually-running local models) and "Ollama Cloud" (`apiKey: 'user_provided'`, `baseURL: 'https://ollama.com/v1/'`, `models.default` with available cloud models from API key). Notes: (1) `models.default` array is required by Zod validation — omitting it crashes startup. (2) After splitting endpoints, the `☁` cloud tagging in `loadConfigModels.js` becomes inert for the local endpoint (no cloud URL → `hasCloudURL` is false) but users may see stale `☁`-tagged models from browser cache until they hard-refresh. (3) Local model names include the tag suffix (e.g. `qwen3:14b`) — these must match exactly what `ollama list` reports on `192.168.50.201`. (4) Set `fetch: false` for local Ollama — `fetch: true` pulls ALL 14 models from `/v1/models` API regardless of the `default` list, showing models like `gemini-3-flash-preview:latest` which are cloud-only stubs and fail locally with "unauthorized". (5) For Ollama Cloud, `fetch: true` is inert because `apiKey: 'user_provided'` is detected and fetch is skipped; only the `default` list is shown.
- 2026-04-06 Ollama agents "empty_messages" context window error: Agents endpoint uses `@librechat/api` `initializeAgent()` to calculate `maxContextTokens`. For Ollama/custom endpoints, `providerEndpointMap` has no entry, so `getModelMaxTokens()` returns `undefined` and the fallback was only 18000 tokens. With system instructions, tool schemas, and MCP tool definitions all counted against this budget, even a simple "hi" message could be pruned. Fix: increased the fallback from 18000 to 128000 in `packages/api/dist/index.js` (both `optionalChainWithEmptyCheck` fallback and `agentMaxContextNum` fallback). Patch added to `config/apply-runtime-patches.js` under `librechatApiPatchTargets`.
- 2026-04-16 Anthropic default-thinking mismatch: the UI can render Claude's default `thinking` state before the conversation or agent model parameters store an explicit `thinking` boolean. Capability gating must therefore resolve Anthropic thinking from the parameter definition default when `thinking` is still `undefined`; otherwise the panel can show `Thinking` as checked while dependent controls still behave as if thinking were off.
- 2026-05-13 Anthropic interrupted-tool replay failure: cancelling or interrupting a Claude native-tool/web-search stream can leave an incomplete `type: 'thinking'` block in message history. Replaying that history without `thinking` and `signature` fields causes Anthropic to reject the next request with `messages.*.content.*.thinking.thinking: Field required`. Fix: `packages/api/src/utils/content.ts` filters malformed thinking blocks before storage, and `config/apply-runtime-patches.js` patches `@librechat/agents` Anthropic `message_inputs` (src/ESM/CJS) to skip malformed thinking blocks at request-build time. Keep both layers; the runtime patch protects already-saved broken chats and the storage filter prevents new malformed history from persisting.

---

### 3.5 Google Gemini live model discovery, grounding, and capability-aware settings

#### What it adds

- model-family capability resolution for OpenAI/Azure settings, side-panel parameters, and agent model parameters
- GPT-5/o-series/search-preview-aware parameter gating for reasoning effort, sampling controls, stop sequences, verbosity, Responses API behavior, and provider-native web search
- live Gemini discovery for API-key mode
- lazy Vertex callable discovery: normal selector/config loads stay cheap and use configured/default Google models until a real Vertex access failure occurs, then the server probes callable publisher models and caches the callable union
- multi-location Vertex callable discovery across the configured preferred location plus official Google model locations, with per-model `vertexLocation` / `vertexLocations` metadata
- selector-cache invalidation after a successful Vertex refresh so the next `/api/config` load swaps stale fallback models for the refreshed callable union without a process restart
- Vertex callable-model filtering so inaccessible publisher models never remain in the selector after refresh
- capability metadata for Google models exposed into startup config
- capability-aware Google settings UI
- Gemini grounding metadata mapped into the existing citations / sources UX
- per-model reasoning setting behavior for Gemini model families, including stripping default thinking controls from models like `gemini-2.5-flash-lite` that do not support them
- stricter Gemini Search grounding allowlisting so older or unsupported Gemini/Gemma families do not expose unsupported `web_search` toggles

#### Key files

- `packages/data-provider/src/openai.ts`
- `packages/api/src/endpoints/models.ts`
- `packages/api/src/endpoints/google/initialize.ts`
- `packages/api/src/endpoints/google/llm.ts`
- `packages/api/src/endpoints/openai/llm.ts`
- `packages/data-provider/src/google.ts`
- `api/server/routes/config.js`
- `api/server/controllers/agents/googleVertexRefresh.js`
- `api/server/controllers/agents/client.js`
- `api/server/controllers/agents/openai.js`
- `api/server/controllers/agents/responses.js`
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
- API-key live discovery plus lazy failure-triggered Vertex discovery; do not regress back to eager all-location probing on every selector/config load
- multi-location Vertex probing with per-model `vertexLocation` / `vertexLocations` metadata and stable ordering
- selector cache invalidation after refresh so stale fallback lists are replaced on the next config fetch
- lightweight `countTokens` Vertex probe filtering so inaccessible models are never surfaced in the picker after refresh
- `googleModelCapabilities` startup-config surface
- capability-aware settings behavior and disablement reasons
- per-model thinking sanitization for unsupported Gemini families
- stricter Gemini Search grounding allowlist in both UI and request builder
- grounding-to-citation translation pipeline

---

### 3.6 xAI custom-endpoint live model discovery and capability-aware settings

#### What it adds

- auto-detects xAI custom endpoints from endpoint name, `*.x.ai` base URLs, or explicit `defaultParamsEndpoint: 'xai'`
- the local `librechat.yaml` now includes a dedicated `xai` custom endpoint with a user-provided-key flow, bootstrap default models, and live discovery refresh after a user key is saved
- fetches live xAI model metadata from `/v1/language-models`
- **resilient xAI model discovery**: when `/v1/language-models` returns 403 (observed for some key tiers), `fetchXAIModelCapabilities` falls back to the standard OpenAI-compatible `/v1/models` listing, builds id-only capability entries, and still applies the text-compat filter
- **defaults-union for xAI**: `loadConfigModels` unions the endpoint's `models.default` list with live discovery output so the operator-curated Grok models are always visible in the picker, even if the live API returns a partial set
- filters the picker to text-compatible xAI chat models while preserving aliases
- publishes per-endpoint xAI capability metadata into startup config as `xaiModelCapabilities`
- adds a dedicated xAI settings panel instead of reusing the generic OpenAI custom-endpoint surface
- applies capability-aware setting disablement in the endpoint modal, the main parameter side panel, and the agent model panel
- normalizes outgoing xAI requests for Responses API behavior and strips unsupported parameters per model family
- **xAI web_search routing fix**: `getOpenAILLMConfig` now has a dedicated xAI branch that forces `useResponsesApi = true` before pushing `{ type: 'web_search' }`, plus a post-processing guard that re-asserts `useResponsesApi = true` if a `web_search` tool is still in the tools array. Prevents the `422 ... unknown variant 'web_search', expected 'function' or 'live_search'` regression when xAI's Chat Completions path is ever reached.
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
- **`/language-models` 403 fallback to `/v1/models`** in `fetchXAIModelCapabilities` (so new xAI key tiers never strand the picker empty)
- **defaults-union for xAI in `loadConfigModels`** (curated `models.default` list always merged into the picker output)
- **xAI-specific web_search branch + post-processing guard** in `getOpenAILLMConfig` (forces Responses API when web_search is on, prevents the 422 regression)
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
- sets the local Docker override to `DOMAIN_SERVER=${DOMAIN_SERVER:-http://localhost:${LIBRECHAT_HOST_PORT:-3080}}` so the `.env` value takes precedence and Arcade/OAuth callbacks use the correct LAN address; falls back to localhost loopback for development
- distinguishes LibreChat MCP initialization from downstream provider consent: a tool returning `authorization_url` / `llm_instructions` means the MCP server is connected and the remaining step is provider-side authorization
- keeps the MCP chat-bar selector visible whenever the user has `MCP_SERVERS.USE`, the active model supports structured tool calling, and selectable MCP servers exist, even when no MCP server is pinned or selected yet
- lets chat and scheduled-run users expand an MCP server and include a subset of that server's tools while preserving the old default that selecting a server includes all tools
- stores per-conversation/new-chat MCP subsets in `ephemeralAgent.mcpToolFilter` and tab-isolated `LAST_MCP_TOOL_FILTER_*` local storage; missing server entries mean "all tools"
- filters ephemeral agent tool expansion on the backend so selected MCP tool subsets apply to normal chat, scheduled runs, and added/parallel ephemeral agents
- detects OAuth-requiring errors from transport layer messages containing `"Authorization"` / `"authorization"` (e.g. arcade.dev's `"Missing Authorization header"`) in addition to `"OAuth"`, `"authentication"`, and `"401"` patterns — only enters the OAuth path when the server config has `requiresOAuth` or `oauthMetadata` set, so local non-OAuth servers are never affected
- when `reinitMCPServer` detects `oauthRequired=true` but has no `oauthUrl` (common for newly created OAuth servers with no stored tokens), the reinitialize route handler initiates a proper OAuth flow via `MCPOAuthHandler.initiateOAuthFlow` to generate a full authorization URL with client_id/state/redirect_uri — without this, the UI would spin indefinitely waiting for an auth URL that never arrives

#### Key files

- `client/src/components/Chat/Input/MCPSelect.tsx`
- `client/src/components/Chat/Input/MCPSubMenu.tsx`
- `client/src/components/MCP/MCPServerMenuItem.tsx`
- `client/src/hooks/MCP/useMCPSelect.ts`
- `client/src/hooks/MCP/useMCPServerManager.ts`
- `client/src/store/mcp.ts`
- `client/src/components/Nav/SettingsTabs/Data/ScheduledRuns.tsx`
- `client/src/components/Chat/Input/MCPSelect.guards.spec.ts`
- `api/models/Agent.js`
- `api/models/loadAddedAgent.js`
- `api/app/clients/tools/util/handleTools.js`
- `api/server/services/Tools/mcpToolFilter.js`
- `packages/api/src/mcp/zod.ts`
- `packages/api/src/mcp/__tests__/zod.spec.ts`
- `packages/api/src/mcp/oauth/handler.ts`
- `packages/api/src/mcp/MCPConnectionFactory.ts`
- `packages/api/src/mcp/__tests__/handler.test.ts`
- `api/server/routes/mcp.js`
- `api/server/routes/__tests__/mcp.spec.js`
- `api/server/services/Tools/mcp.js`
- `docker-compose.local.override.yml`

#### Preserve during merges

- bare object MCP input schemas must continue to normalize to include empty `properties` before OpenAI-compatible tool calls are sent
- explicitly open object schemas with `additionalProperties` must remain untouched by that fix
- OAuth refresh must continue to prefer stored protected-resource `authorization_servers` metadata before attempting discovery from the MCP server URL
- callback URL precedence must remain: valid `DOMAIN_SERVER` -> `X-Forwarded-*` headers -> request host/protocol
- `DOMAIN_SERVER` in `docker-compose.local.override.yml` must use `${DOMAIN_SERVER:-...}` syntax so the `.env` value takes precedence; hardcoding `http://localhost:...` breaks OAuth callbacks for LAN-accessed instances
- provider authorization prompts returned from Arcade Microsoft tools should not be treated as LibreChat MCP initialization failures
- do not reintroduce a `!isPinned && mcpValues?.length === 0` render guard in `MCPSelect.tsx`; empty `mcpValues` means "nothing selected yet", not "hide the selector"
- keep MCP server selection and MCP tool filtering separate: `ephemeralAgent.mcp` lists servers, while optional `ephemeralAgent.mcpToolFilter` maps server name to concrete tool keys; omitting a server from `mcpToolFilter` must continue to mean all tools
- when all tools for a server are selected, remove that server's filter entry instead of storing a full copy of the tool list; this preserves current all-tools behavior and avoids stale filters after server tool discovery changes
- backend filtering must happen after per-user/server discovery (`getMCPServerTools`, registry `toolFunctions`, or `reinitMCPServer`) so tool caches and the global registry remain complete
- `mcp_all` fallback handling in `handleTools.loadTools()` must respect `ephemeralAgent.mcpToolFilter`; otherwise cold scheduled runs can silently expand a filtered server back to all tools
- `isOAuthError` in `reinitMCPServer` must include `'Authorization'`/`'authorization'` patterns to match arcade.dev transport errors; the check is always guarded by `serverNeedsOAuth` so local servers are safe
- the reinitialize route must initiate `MCPOAuthHandler.initiateOAuthFlow` when `oauthRequired=true` but `oauthUrl=null` — this is the only path that produces a full auth URL for newly created OAuth servers

#### Validation notes

- `client/src/components/Chat/Input/MCPSelect.guards.spec.ts` asserts that the MCP selector is not hidden solely because no server is pinned or selected
- `client/src/hooks/MCP/__tests__/useMCPSelect.test.tsx` covers per-server MCP tool filters, including default all-tools cleanup when all tools are selected
- `api/models/Agent.spec.js` covers backend filtering of ephemeral MCP tool expansion
- `api/server/services/ScheduledJobs/ScheduledJobsController.spec.js` covers preserving `mcpToolFilter` through nested scheduled-run updates
- `packages/api/src/mcp/__tests__/zod.spec.ts` covers the bare-object schema normalization behavior
- `packages/api/src/mcp/__tests__/handler.test.ts` covers resource-metadata-based OAuth refresh behavior
- `api/server/routes/__tests__/mcp.spec.js` includes callback URL precedence coverage, although the suite is still blocked locally by the existing Alpine `mongodb-memory-server` limitation
- live validation on this branch connected to `https://api.arcade.dev/mcp/microsoft-tools`, listed 24 tools, and advanced `MicrosoftOnedrive_WhoAmI` plus `MicrosoftOnedrive_GetMyDrive` to provider authorization prompts instead of failing MCP initialization
- 2026-04-11 live validation: added `arcade-write-microsoft-tools` (`https://api.arcade.dev/mcp/microsoft-write`) via UI, OAuth flow initiated correctly with full authorization URL, callback completed via `curl` from the Linux host; `microsoft-tools` (read) also re-authed successfully after reinitialize; IMSLP DB record corrected from `arcade.dev/mcp/imslp` to local `http://192.168.50.4:8765/mcp`

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
- dev rail shared-stable data mode: by default `start-all.sh dev` rewrites the stable `MONGO_URI` to the LAN-accessible stable MongoDB host/port and shares `uploads/`, so dev can access the same conversations/files if the stable API is down while keeping separate image tags, ports, logs, Meilisearch data, and code-interpreter state
- dev failover watchdog: `librechat-dev-failover.timer` runs `dev-failover-watchdog.sh`, starts dev in a minimal API-only profile after stable health failures, and stops failover-owned dev after stable recovers
- lower dev resource defaults for standby/testing/failover operation; full dev is ~1 GiB API heap-limited and failover dev is smaller, with RAG/vector/code services omitted from the failover profile
- secret/runtime ignore patterns in `.gitignore`
- MCP OAuth callback URLs with `DOMAIN_SERVER`-first resolution plus forwarded/request-host fallback
- `DOMAIN_SERVER` in `docker-compose.local.override.yml` uses `${DOMAIN_SERVER:-http://localhost:${LIBRECHAT_HOST_PORT:-3080}}` so the `.env` value (typically `http://192.168.50.4:3080`) takes precedence for LAN access; falls back to localhost for pure-local development

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
- `local-services/rail-env.sh`
- `local-services/start-all.sh`
- `local-services/stop-all.sh`
- `local-services/status-all.sh`
- `local-services/sync-from-stable.sh`
- `local-services/health-check.sh`
- `local-services/dev-seed-validation-personas.js`
- `local-services/dev-failover-watchdog.sh`
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
- `DOMAIN_SERVER` in `docker-compose.local.override.yml` must use `${DOMAIN_SERVER:-...}` so `.env` can override it; hardcoding `http://localhost:...` will break OAuth callbacks when accessing LibreChat from other machines on the LAN
- dev shared-stable data mode is intentional: preserve `LIBRECHAT_DEV_USE_STABLE_MONGO=true` default, `LIBRECHAT_DEV_SHARED_MONGO_HOST`/`PORT` overrides, and `LIBRECHAT_DEV_SHARED_UPLOADS_DIR`; `LIBRECHAT_DEV_USE_STABLE_MONGO=false` is the opt-in isolated mode
- preserve the failover lifecycle: `librechat-stack.service` starts stable explicitly, `librechat-dev-failover.timer` is the only automatic dev starter, and failover-owned dev is stopped when stable health is back
- preserve minimal failover profile behavior in `start-all.sh` (`LIBRECHAT_DEV_PROFILE=failover` + `--no-build` + `--skip-health-check`) so automated failover does not rebuild or start heavyweight dev-only services
- preserve `sync-from-stable.sh` behavior that skips Mongo restore/upload rsync when dev already shares stable data, and `health-check.sh` allowance for shared `uploads/`
- preserve `dev-seed-validation-personas.js` refusal to seed/reset validation personas against stable/shared MongoDB unless `DEV_SEED_ALLOW_SHARED_PROD_DB=true` is explicitly set

#### Runtime files linked into the custom worktree

- `.env`
- `librechat.yaml`
- `langfuse/.env`
- `data-node`
- `meili_data_v1.35.1`
- `images`
- `uploads`
- `logs`

#### Mission safety: dev-rail-only execution policy

All agent missions (upstream merges, version bumps, feature migrations, validation harnesses) MUST operate exclusively on the dev rail (r2, port 3081). The stable/production rail (r1, port 3080) must remain running and fully usable throughout any mission.

**Hard rules:**

- Never rebuild, restart, stop, or reconfigure the stable rail during any mission step
- Never run `./local-services/start-all.sh stable` as part of a mission
- Never direct Docker commands at `librechat-stable-*` containers during mission work
- All code changes, builds, tests, and validation happen on dev only
- Promotion to stable happens ONLY at the very end of the mission, after all validation passes and the user gives explicit approval
- If something goes wrong, only the dev rail gets fixed or restarted; stable remains untouched as fallback

This policy exists because the user depends on the stable rail for daily use. Disrupting stable during a mission leaves the user without a working instance.

#### Dev shared-stable data guardrails

- Default dev runtime can read/write the same MongoDB database and uploaded files as stable. This is intentional for fallback access, but it means dev testing must use test accounts and avoid destructive data resets.
- Existing test accounts such as `playwright@test.local` should be used for browser automation and validation on dev. Persona seeding/reset tooling is for isolated dev Mongo only unless deliberately overridden.
- Stable containers still remain protected: dev may connect to the stable MongoDB backend, but missions must not restart, rebuild, stop, or mutate `librechat-stable-*` containers without explicit promotion approval.
- Dev should normally be stopped while stable is healthy. The watchdog only stops dev instances it started itself, leaving manually started dev alone for explicit testing unless `LIBRECHAT_FAILOVER_STOP_MANUAL_DEV_ON_RECOVERY=true` is set.

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
- chat initialization now falls back to server Vertex credentials when `GOOGLE_KEY=user_provided` is set, the user has not saved a Google key, and server-side Vertex auth is configured
- chat initialization also consumes discovered per-model Vertex routing metadata, overriding the default location and injecting fallback locations when a callable model lives outside the preferred Vertex region
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
- in Docker/local rails, `GOOGLE_SERVICE_KEY_FILE` must point to a file that actually exists inside the running container (for example `/app/data/google-service-account.json`)
- ADC mode: `GOOGLE_APPLICATION_CREDENTIALS` pointing to a credentials file, or `gcloud auth application-default login` run on the host
- Vertex modes also require a Google Cloud project ID (auto-detected from service account JSON, or set via `GOOGLE_VERTEX_PROJECT` / `GOOGLE_CLOUD_PROJECT`)
- Location defaults to `us-central1` if not set
- treat `GOOGLE_VERTEX_LOCATION` as the preferred/home region, not as proof that every callable Gemini/Gemma model is hosted there; after a refresh, per-model discovery may route specific models to `global` or another official location
- lazy multi-location discovery intentionally does not run during every selector load; the expected trigger is a real Vertex "not found / no access" model failure, after which the callable union is cached

#### Lessons learned

- `parseGoogleCredentials` must use strict JSON parsing for string credentials; a broad raw-string fallback breaks existing contracts where raw API keys require explicit `acceptRawApiKey` opt-in
- when `GOOGLE_KEY` is server-configured (not `user_provided`), realtime/image-gen helpers must skip the `getUserValues()` database lookup to avoid unnecessary DB hits and prevent saved user credentials from overriding server auth config
- bare `GOOGLE_CLOUD_PROJECT` without an explicit `GOOGLE_AUTH_MODE` or `GOOGLE_APPLICATION_CREDENTIALS` must not trigger ADC detection, or projects that only use API keys with a project env var will incorrectly attempt ADC auth
- when `GOOGLE_KEY=user_provided` is used alongside server Vertex auth, chat initialization must fall back to the server credentials if the user has no saved Google key; otherwise the UI can expose Google while chats fail with `no_user_key`
- for Vertex service-account mode in Docker, matching env vars are not enough; the JSON must really exist at `GOOGLE_SERVICE_KEY_FILE` inside each running container or discovery/auth silently fall back away from the intended Vertex path
- `GOOGLE_VERTEX_LOCATION` is a preferred default, not a complete availability map; some callable models can be `global`-only while others remain region-only, so chat init needs model-specific route overrides/fallbacks after discovery
- after a successful Vertex refresh, invalidate the selector/startup config caches as well as the model-capability cache; otherwise `/api/config` can keep serving stale `gemini-2.0-*` entries even though the backend has already discovered the corrected callable union

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

### 3.17 Runtime librechat.yaml interface, modelSpecs quick-selector, and endpoint configuration

#### What it adds

The runtime `librechat.yaml` (gitignored, bind-mounted into containers from the LibreChat-custom worktree root) carries several customization-critical sections beyond what upstream ships by default.

##### Interface settings

```yaml
interface:
  endpointsMenu: true
  modelSelect: true
  parameters: true
  sidePanel: true
  presets: true
```

These must be explicitly set to `true`. Without an `interface` section, LibreChat hides the parameters side panel, presets, and free-form model selection. Upstream does not ship a default `interface` block in `librechat.yaml`.

##### modelSpecs quick-selector

```yaml
modelSpecs:
  enforce: false
  prioritize: true
```

- `enforce: false` -- users can still pick any model from any endpoint; the specs are convenience shortcuts, not restrictions
- `prioritize: true` -- specs appear prominently in the model picker with provider icons

The quick-selector list mirrors the models available to default non-admin users (from `DEFAULT_NON_ADMIN_MODEL_PERMISSIONS` in `api/server/services/ModelAccess.js`):

| Spec name         | Endpoint  | Model               | Group     |
| ----------------- | --------- | ------------------- | --------- |
| GPT-5.4 Mini      | openAI    | gpt-5.4-mini        | openAI    |
| GPT-5.4 Nano      | openAI    | gpt-5.4-nano        | openAI    |
| GPT-5.3 Chat      | openAI    | gpt-5.3-chat-latest | openAI    |
| Claude Sonnet 4.6 | anthropic | claude-sonnet-4-6   | anthropic |
| Claude Sonnet 4.5 | anthropic | claude-sonnet-4-5   | anthropic |
| Claude Haiku 4.5  | anthropic | claude-haiku-4-5    | anthropic |
| Grok 4-1 Fast     | xai       | grok-4-1-fast       | xai       |
| Ollama Local      | Ollama    | qwen2.5:latest      | Ollama    |

Each spec uses the `group` field to nest under the matching provider icon in the picker. xAI and Ollama also set `groupIcon` explicitly since they are custom endpoints.

When updating `DEFAULT_NON_ADMIN_MODEL_PERMISSIONS`, the modelSpecs list should also be updated to stay aligned.

##### Custom endpoints

Three custom endpoints are defined:

1. **Ollama (local)** -- `apiKey: ${OLLAMA_MULTI_API_KEY}`, `baseURL: http://192.168.50.201:11434/v1/` with `baseURLs` for `http://192.168.50.4:8080/v1/`. Uses `fetch: false` with an explicit `models.default` list of actually-running local models. `fetch: true` would pull all models from `/v1/models` including cloud-only stubs that fail locally.

2. **Ollama Cloud** -- `apiKey: user_provided`, `baseURL: https://ollama.com/v1/`. Uses `fetch: true` (inert since `user_provided` keys skip fetch). Default model list includes cloud-available models.

3. **xAI** -- `apiKey: user_provided`, `baseURL: https://api.x.ai/v1`. Uses `fetch: true` for live model discovery. Default models include Grok 4.x variants.

##### Other runtime sections

- `mcpSettings.allowedDomains` -- MCP domain allowlist for local MCP servers (`192.168.50.4:8765` through `192.168.50.4:8770`; `:8770` is the Internet Archive MCP server)
- `mcpServers.internet-archive` -- read-only Internet Archive / Wayback MCP server using streamable HTTP at `http://192.168.50.4:8770/mcp` with `timeout: 90000`
- `memory.agent` -- memory agent using `gpt-4.1-mini` via `openAI` provider (casing matters -- must be `openAI` not `openai`)
- `speech.stt.openai` -- Whisper-1 STT with `${OPENAI_API_KEY}`
- `version: 1.3.5` -- config schema version

#### Key files

- `librechat.yaml` (runtime, gitignored, bind-mounted via `docker-compose.local.override.yml`)
- `librechat.example.yaml` (reference)
- `api/server/services/ModelAccess.js` (`DEFAULT_NON_ADMIN_MODEL_PERMISSIONS` -- source of truth for which models default users get)
- `local-services/dev-seed-validation-personas.js` (validation script that can inject modelSpecs -- see lessons learned)

#### Preserve during merges

- the `interface` section must remain with all five fields set to `true`; removing it hides the parameters panel, presets, and free model selection
- `modelSpecs.enforce` must remain `false` so the quick-selector never blocks free model access
- `modelSpecs` list should stay aligned with `DEFAULT_NON_ADMIN_MODEL_PERMISSIONS`
- custom endpoint split (Ollama local with `fetch: false` vs Ollama Cloud with `user_provided` key) must not be re-merged into a single endpoint
- `memory.agent.provider` must use camelCase `openAI` (not lowercase `openai`)
- `mcpSettings.allowedDomains` must be updated if local MCP server addresses change
- preserve `mcpServers.internet-archive` and the `http://192.168.50.4:8770` allowlist entry when regenerating or editing runtime `librechat.yaml`

#### Lessons learned

- 2026-04-11: the `local-services/dev-seed-validation-personas.js` validation script was designed to inject deterministic `modelSpecs` into `librechat.yaml` for automated testing (VAL-MODEL-003). It checks if `modelSpecs` already exists before overwriting, but if run against a yaml that has no `modelSpecs`, it adds a restrictive set of 5 models with `prioritize: true`. This effectively locked the model picker to those 5 models for real users. Fix: the script should only be used on the dev rail's validation runs, never on the shared runtime `librechat.yaml`. The runtime yaml must always have its own intentional `modelSpecs` (or none) and `interface` settings independent of validation tooling.
- 2026-04-11: removing the `interface` section entirely (or never adding it) silently disables the parameters side panel, presets UI, and free model selection. LibreChat defaults these to hidden when no `interface` block is present. This is not obvious because the UI still loads -- it just lacks controls. Always verify `interface` settings are present after any yaml modification.

---

### 3.18 Local RAG integration, provider-aware file search, and citation content display

#### What it adds

- three locally-built `rag_api` containers (OpenAI, Azure, Google) from an external `rag_api` git clone, sharing a local pgvector database
- provider-aware RAG URL routing: file uploads and queries route to the correct provider-specific RAG service based on the active chat provider
- dual storage pattern: file search uploads go to both persistent storage (local/S3) and the local vector DB for embeddings
- citation content passthrough: the actual text chunk/quote from the RAG query is now displayed in the frontend citation hovercard and source panel, not just the filename and page numbers
- retry with exponential backoff for all RAG API calls (embed, query, delete) with configurable timeouts
- container resource tuning: vectordb at 512m with postgres tuning (shared_buffers, work_mem, effective_cache_size), RAG containers at 384m with CPU bounds

#### Key files

- `api/server/services/Files/VectorDB/crud.js` -- embed/delete with retry and timeout
- `api/server/services/Files/VectorDB/routing.js` -- provider-to-URL resolution
- `api/server/services/Files/VectorDB/auth.js` -- provider credential resolution and header construction
- `api/app/clients/tools/util/fileSearch.js` -- semantic query with retry and timeout, citation source construction
- `api/server/services/Files/Citations/index.js` -- citation processing, relevance filtering, metadata enrichment
- `client/src/hooks/Messages/useSearchResultsByTurn.ts` -- maps chunk content to citation snippet
- `client/src/components/Web/SourceHovercard.tsx` -- displays chunk text in file citation hovercard
- `client/src/components/Web/Sources.tsx` -- displays chunk snippet in file source panel
- `docker-compose.local.override.yml` -- container resource bounds and postgres tuning

#### Data flow

1. User uploads file with `file_search` tool resource
2. File saved to local storage, then sent to local `rag_api` container (`/embed`)
3. `rag_api` calls the embedding provider API (OpenAI/Azure/Google) with text chunks only -- the raw file never leaves the local network
4. Embeddings stored in local pgvector
5. At query time, `file_search` tool calls local `rag_api` (`/query`) which returns `page_content` chunks with distance scores
6. Chunks flow through: `fileSearch.js` sources -> `Citations/index.js` -> SSE attachment -> `useSearchResultsByTurn.ts` -> `SourceHovercard`/`Sources.tsx` display

#### Privacy guarantee

- Raw files are stored locally (never sent to OpenAI/Azure/Google)
- Only extracted text chunks are sent to the embedding provider for vectorization
- All vector storage is in the local pgvector container
- Queries go to the local `rag_api` which calls the embedding provider for query embedding only

#### Preserve during merges

- provider-aware routing logic in `VectorDB/routing.js` and `VectorDB/auth.js`
- retry and timeout wrappers in `VectorDB/crud.js` and `fileSearch.js`
- `content` field passthrough in citation pipeline (`fileSearch.js` sources -> `useSearchResultsByTurn.ts` snippet mapping)
- container resource settings in `docker-compose.local.override.yml` (vectordb 512m, RAG 384m, postgres tuning)
- `metadata.ragProvider` and `metadata.ragModel` on file records

#### Supporting docs

- `LOCAL_RAG_INTEGRATION.md`

---

### 3.19 Cross-cutting lessons learned and repeat patterns

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
- 2026-04-11 MCP OAuth reinit bug: arcade.dev transport errors use `"Missing Authorization header"` which didn't match the existing `isOAuthError` patterns (`"OAuth"`, `"authentication"`, `"401"`) in `reinitMCPServer`. This caused newly added arcade.dev servers to fail silently — `oauthRequired` was set to `false` even though the server clearly needed OAuth. Fix: added `'Authorization'`/`'authorization'` patterns, always guarded by `serverNeedsOAuth` so local servers are unaffected. Additionally, new OAuth servers with no stored tokens never get their `oauthStart` callback fired during `getConnection` (no tokens = no OAuth flow triggered), leaving `oauthUrl=null` — the UI then spins indefinitely. Fix: the reinitialize route handler now initiates `MCPOAuthHandler.initiateOAuthFlow` when `oauthRequired=true && oauthUrl=null` to produce a complete authorization URL.
- 2026-04-11 DOMAIN_SERVER hardcoded in compose override: `docker-compose.local.override.yml` had `DOMAIN_SERVER: http://localhost:${LIBRECHAT_HOST_PORT:-3080}` which always overrode the `.env` value `http://192.168.50.4:3080`. This meant OAuth callback URLs registered with arcade.dev as `localhost` callbacks, which browsers on other LAN machines couldn't reach. Fix: changed to `${DOMAIN_SERVER:-http://localhost:${LIBRECHAT_HOST_PORT:-3080}}` so `.env` takes precedence. Note: Docker compose `environment:` overrides `env_file`; variables not in `environment:` (like `OLLAMA_API_KEY`) are loaded by `dotenv` at runtime from the mounted `.env` file.
- 2026-04-11 Ollama web_search crash (`Cannot read properties of undefined (reading 'key')`): the Ollama web search mode detection in `ollama.js` calls `isOllamaHostedSearchReady()` which checks `process.env.OLLAMA_API_KEY`. When the env var is missing from the Docker process env (due to the compose env precedence issue above), the code falls back to the built-in `web_search` tool (SerperAPI), which then fails because `SERPER_API_KEY` is also not set. The client-side crash is the unhandled error response. Root cause: the `OLLAMA_API_KEY` was present in the mounted `.env` file and loaded by `dotenv`, but `isOllamaHostedSearchReady()` ran before `dotenv.config()` or checked the process env directly at module load time. After fixing DOMAIN_SERVER and recreating the container, `dotenv` loads `OLLAMA_API_KEY` correctly and the Ollama MCP search path is used instead.
- 2026-04-11 IMSLP MCP server wrong URL: the IMSLP MCP server DB record pointed at `https://api.arcade.dev/mcp/imslp` (with `requiresOAuth: true`) instead of the local instance at `http://192.168.50.4:8765/mcp`. This caused repeated OAuth failures for a server that should have no auth. Fix: corrected the DB record URL and cleared `requiresOAuth`/`oauthMetadata`. Lesson: when adding MCP servers via the UI, double-check the URL before saving — the form auto-generates a title from the URL but doesn't validate that the URL matches the intended server.
- 2026-04-11 Auth cookies rejected on LAN (forced re-login on every refresh/new tab):
  - **Symptom:** Every page refresh or new tab forced re-login. Server logs showed `[refreshController] No refresh token cookie found for non-OpenID user` on every refresh attempt, immediately followed by a new login.
  - **Root cause:** The `backend` npm script (`package.json`) runs with `cross-env NODE_ENV=production`. This makes `shouldUseSecureCookie()` in `packages/api/src/oauth/csrf.ts` return `true`, because the function only exempted `localhost`/`127.0.0.1`/`::1` from the production secure-cookie requirement -- not private LAN IPs or plain `http://` URLs. With `secure: true`, the `Set-Cookie` response header included the `Secure` flag. **Browsers silently reject `Secure` cookies on plain `http://` connections** (like `http://192.168.50.4:3080`). The cookie was never stored, so every refresh had no token to send.
  - **Why it was hard to find:** (1) `shouldUseSecureCookie()` returned `false` when tested via `docker exec node -e "..."` because that spawns a new process without `cross-env NODE_ENV=production` -- the function behaved differently at runtime vs. ad-hoc testing. (2) The browser gives no error or warning when it rejects a `Secure` cookie on HTTP -- it silently discards it. (3) The server-side logs only showed "no cookie found", giving no indication that the cookie was being set but rejected. The breakthrough came from using Playwright to intercept the raw `Set-Cookie` response header, which clearly showed `Secure` on a plain HTTP connection.
  - **Fix (two parts):**
    1. `packages/api/src/oauth/csrf.ts`: Added `isPlainHttp` check -- if `DOMAIN_SERVER` starts with `http://`, `shouldUseSecureCookie()` returns `false` regardless of `NODE_ENV`. This is safe because `Secure` cookies are meaningless over plain HTTP.
    2. `api/server/services/AuthService.js`: Changed `sameSite` from `'strict'` to `'lax'` for `refreshToken` and `token_provider` cookies. `lax` is the standard recommendation for auth cookies (sent on top-level GET navigations like new tabs and refreshes, blocked on cross-site POST).
  - **Deployment note:** The TypeScript source (`csrf.ts`) was edited, but the compiled output (`packages/api/dist/index.js`) is what the server runs. The fix was hot-patched into the compiled JS inside both running containers via `docker exec`. **If containers are recreated** (e.g., `docker compose up`, image rebuild), the `packages/api` module must be rebuilt (`npm run build` in `packages/api`) for the fix to persist, OR the compiled `dist/index.js` must be re-patched after container creation.
  - **Also applied:** Increased `SESSION_EXPIRY` to 90 days and `REFRESH_TOKEN_EXPIRY` to 365 days in `.env` for home-server use.
  - **Merge note:** `shouldUseSecureCookie()` is in `packages/api/` (compiled to `packages/api/dist/index.js`). Upstream merges that touch `packages/api/src/oauth/csrf.ts` need the `isPlainHttp` check re-applied.
  - **Diagnostic lesson:** When debugging cookie issues, always inspect the raw `Set-Cookie` response header (via Playwright, curl `-v`, or DevTools Network tab) -- don't rely on checking `document.cookie` or server-side logs alone. Also, always test runtime behavior inside the actual server process (add `logger.warn` calls), not via `docker exec node -e` which runs in a different environment.
- 2026-04-11 Stop button persists after stream finishes (first fix): after `finalHandler` navigates from `/c/new` to `/c/<uuid>`, the stale submission atom could trigger `useResumeOnLoad` to re-enable the stop button. Fix: in `useResumableSSE.ts`, clear the submission atom (`setSubmission(null)`) after processing the final event, preventing stale state from being misinterpreted as an active stream.
- 2026-04-20 Stop button persists after stream finishes (regression — **critical**):
  - **Symptom:** After any model finished streaming, the stop button stayed visible permanently. Affected all non-assistants models (everything routed through `useResumableSSE`).
  - **Root cause:** In `client/src/hooks/SSE/useResumableSSE.ts` line 176, the earlier customization changed `clearAllDrafts(...)` to `clearDraft(...)`. But `clearDraft` is a local function defined only in `useSSE.ts` — it was never imported or defined in `useResumableSSE.ts`. Every time the server sent the `final` SSE event, `clearDraft(...)` threw a `ReferenceError`. The outer `try-catch` in the message handler silently swallowed the error (`catch (error) { console.error(...) }`), which prevented `finalHandler`, `sse.close()`, `setIsSubmitting(false)`, `setShowStopButton(false)`, and `setSubmission(null)` from ever executing.
  - **Why TypeScript didn't catch it:** Vite uses esbuild/SWC for transpilation, which strips types without validating them. `tsc --noEmit` is not run as part of the build or pre-commit hooks. TypeScript's `strict: true` mode would have flagged the undefined reference at compile time.
  - **Why it wasn't obvious at runtime:** The `ReferenceError` was logged to the browser console (`[ResumableSSE] Error processing message: ReferenceError: clearDraft is not defined`) but the catch block had no recovery logic for critical events like `final`, so the UI was left in a permanently stuck state with no visible error.
  - **Fix (two parts):**
    1. Changed `clearDraft` → `clearAllDrafts` on line 176 (the function that is actually imported).
    2. Added a safety-net in the outer catch block: if processing a `final` event throws for any reason, the catch now detects it by re-parsing `e.data`, and forces cleanup (`setIsSubmitting(false)`, `setShowStopButton(false)`, `sse.close()`, `setSubmission(null)`). This prevents any future bug in that code path from causing a permanently stuck UI.
  - **Prevention lessons:**
    1. **Add `tsc --noEmit` to CI or pre-commit** — this single change would have caught this exact bug before it shipped.
    2. **Never use broad silent catch blocks around critical state transitions** — the original `catch (error) { console.error(...) }` pattern is dangerous when the try block contains state cleanup that must execute. Always add recovery logic for critical events.
    3. **Don't delete upstream test files** — the spec for `useResumableSSE` was removed in the custom branch; keeping and extending it would have covered the completion flow.
  - **Collateral damage — forced full rebuild (operational postmortem):**
    - While deploying the one-line fix, an attempt was made to run `npx vite build` inside the stable container to rebuild the client bundle. The container's memory limit caused the Vite process to OOM (exit code 137). The critical failure mode: Vite's build pipeline runs `npm run clean` (which deletes `dist/` directories) **before** the actual compilation step. The OOM killed the process mid-compilation, leaving the container with deleted `packages/api/dist/`, `packages/data-schemas/dist/`, and `client/dist/` — and nothing to replace them. The server then crash-looped on `Cannot find module '@librechat/api/dist/index.js'`.
    - Recovery required: (a) building `@librechat/api` locally with `NODE_OPTIONS="--max-old-space-size=8192"` (took ~5 min, default heap was insufficient), (b) copying all three package dists into the container, (c) extracting the original `client/dist` from the Docker image layer via `docker create` + `docker cp`, and finally (d) a full `start-all.sh stable` rebuild (~45 min) to get a clean image with the fix baked in.
    - **Hard rule: never run package or client builds inside the running API containers.** The containers are memory-constrained and the build toolchain's clean-then-build pattern means an OOM mid-build destroys artifacts without producing replacements. For client-side fixes, always do a full image rebuild via `start-all.sh`. For backend-only fixes (`.js` files under `api/`), `docker cp` + `docker restart` remains safe since no build step is needed.
- 2026-04-11 Badge row hidden for super admin: ~~the model quick-selector `BadgeRow` in `ChatForm.tsx` is now conditionally hidden when `isSuperAdmin === true`, using the same detection pattern as `ModelSelectorContext.tsx` (`useAdminPermissionsQuery`). Super admins use the pinned/default model instead of the quick-selector badges.~~ **Superseded 2026-04-26 (see below).** This entry was technically incorrect: `BadgeRow` is the _tool-toggle_ row (Web Search, Code Interpreter, File Search, Artifacts, MCP Servers, and as of 2026-04-26 the Image generation badge plus the ToolsDropdown menu), not a model selector. Hiding it from super admins removed legitimate per-conversation tool controls. The `{!isSuperAdmin && (<BadgeRow .../>)}` gate has been removed; super admins now see all badges and the ToolsDropdown like every other user, gated only by per-tool permissions on their role.
- 2026-04-11 Pinned model reset on new chat: `useNewConvo.ts` unconditionally applied the admin `defaultPreset` when `endpoint` was null (new chat), overriding the user's manually selected model stored in `lastConversationSetup`. Fix: added a `userHasManualModelSelection` check that bypasses the admin default when the user has an explicit non-spec model selection in localStorage.
- 2026-04-11 Gemini/Vertex AI callable discovery: in Vertex mode, do not trust `GOOGLE_MODELS` or `models.list()` metadata alone. Normal selector loads should stay cheap and use the configured/default list first. When a real Vertex "not found / no access" failure happens, list candidate publisher models, probe them (currently via `countTokens`), cache the callable union across the preferred location plus official Google model locations, and only then replace the selector contents. This prevents stale or unauthorized models (for example older Gemini 2.0 entries) from lingering while also avoiding expensive all-location discovery on every startup/config request.
- 2026-04-11 Google user-key fallback with server Vertex auth: when `GOOGLE_KEY=user_provided` is kept for per-user flows, chat initialization must still fall back to server Vertex service-account/ADC credentials if the user has no saved Google key. Otherwise users can select Google successfully and then fail at runtime with `no_user_key` despite valid server-side Vertex config.
- 2026-04-11 Gemini 2.5 Flash-Lite thinking sanitization: do not inherit default thinking / `includeThoughts` settings from broader Gemini family heuristics. Vertex rejects requests when `includeThoughts` is sent while thinking is disabled, so capability metadata and request builders must strip thinking controls for unsupported models such as `gemini-2.5-flash-lite`.
- 2026-04-12 Vertex selector refresh invalidation: refreshing the callable-model cache is not enough by itself. LibreChat's config/model selector caches must also be invalidated on a successful refresh, or the browser will keep showing the stale fallback list until the process restarts.
- 2026-04-12 Per-model Vertex routing: once multi-location discovery is cached, chat initialization must honor each model's discovered `vertexLocation` and optional fallback list. Otherwise global-only models such as `gemini-3.1-pro-preview` still fail under a `us-central1` default even though discovery already proved they are callable elsewhere.
- 2026-04-12 Local rail deployment under memory limits: the dev/stable API containers are memory-limited enough to kill `packages/api` Rollup builds in-container (`exit 137`). For code-only package hotfixes, build the safe `dist` on the host against a rail-equivalent source snapshot, then `docker cp` the bundle into the target rail instead of trying to rebuild the whole package inside the constrained container.
- 2026-04-11 Playwright automation test account: created `playwright@test.local` / `PlaywrightBot123!` (name: "Playwright Bot") for automated E2E testing via Playwright. `ALLOW_UNVERIFIED_EMAIL_LOGIN=true` in `.env` so email verification is not required. Use this account for all automated browser testing -- never use real user credentials in automation. This account was used to validate the Google selector contents and live Gemini chat flow on both dev and stable rails after the Vertex fixes.
- 2026-04-11 Auth cookie diagnostic logging in AuthController.js: added `logger.debug` calls in `refreshController` to log cookie presence (`hasRefreshToken`, `hasTokenProvider`, `cookieHeader`), and `logger.warn` before the "No refresh token cookie found" return. These are diagnostic additions that will conflict with upstream during merges; preserve them if auth debugging is still needed, or remove once the auth cookie fix is confirmed stable long-term.
- 2026-04-11 Gemini/Vertex AI service-account runtime mount: `docker-compose.local.override.yml` mounts `./data/google-service-account.json` → `/app/data/google-service-account.json` (read-only), and the `.gitignore` includes `/data/google-service-account.json` to prevent credential leakage. The operational lesson is stricter than the env/config lesson: every rail/container must actually have that file present at runtime. Dev and stable can diverge if one rail has the JSON copied/mounted and the other does not, which causes stable to fall back away from Vertex discovery/auth and quietly repopulate stale env-listed models.
- 2026-04-26 `getAnthropicModelCapabilities` must exist on the **server side** in `packages/api/src/endpoints/models.ts`, not only in `librechat-data-provider`. `api/server/routes/config.js` imports `{ getAnthropicModelCapabilities, getGoogleModelCapabilities, getXAIModelCapabilities }` from `@librechat/api`. When this server-side helper is missing, `/api/config` throws on every request with `getAnthropicModelCapabilities is not a function`, `useGetStartupConfig` errors out on the client, and the entire chat-bar tool selector (Web Search, Code Interpreter, File Search, Image, Artifacts, MCP) plus permission-gated Settings tabs (including the new Image Generation tab) silently fail to render. The function must accept `{ user, vertexModels, forceRefresh }`, cache its result in `CacheKeys.MODEL_QUERIES`, call `getAnthropicModels({ user, vertexModels })` to discover model ids (env list, vertex models, or live `/v1/models`), and run `buildStaticAnthropicModelCapabilities(...)` to produce `Record<string, TAnthropicModelCapabilities>`. This is the same shape the client-side `getAnthropicModelCapabilities(model, metadata)` consumer in `client/src/Providers/BadgeRowContext.tsx` reads through `cachedStartupConfig.anthropicModelCapabilities`. The fix is mirror-symmetric to the existing `getGoogleModelCapabilities` and `getXAIModelCapabilities` exports in the same file.
- 2026-04-26 Adding a new RBAC permission type requires updating **two** schema layers, not one. The mistake during the initial Image Generation rollout was adding `IMAGE_GEN` to `librechat-data-provider`'s `permissionsSchema`, `roleDefaults` (ADMIN: `{USE: true}`, USER: `{}`), and `imageGenPermissionsSchema` — but forgetting to declare `[PermissionTypes.IMAGE_GEN]: { [Permissions.USE]: { type: Boolean } }` in the **Mongoose** `rolePermissionsSchema` at `packages/data-schemas/src/schema/role.ts`. Result: Mongoose strict-mode silently stripped the field on save, so even after `initializeRoles` tried to backfill the default permissions on existing role docs (`role.permissions.IMAGE_GEN = {USE: true}`), the field never persisted to MongoDB. The client's `useHasAccess({permissionType: IMAGE_GEN, permission: USE})` then returned false for everyone (including super admins, since super-admin = `user.role === ADMIN` and reads the same role doc), hiding the Settings → Image Generation tab from the entire UI. Lesson: every new entry in `data-provider/permissions.ts` `PermissionTypes` must also be added to (a) `data-schemas/src/schema/role.ts` `rolePermissionsSchema`, and (b) the corresponding TypeScript type in `data-schemas/src/types/role.ts`. Verify by booting a fresh container and running `Role.find({}, "name permissions.<NEW_PERM>").lean()` — if the field is undefined, Mongoose stripped it. Recovery for already-deployed environments: directly `db.roles.updateOne(...)` with `strict:false` to inject the field, then redeploy with the schema fix so future startups round-trip correctly.
- 2026-04-26 `BadgeRow` super-admin gate removed in `client/src/components/Chat/Input/ChatForm.tsx`. The 2026-04-11 lesson described `BadgeRow` as a "model quick-selector" — that description was wrong. `BadgeRow` actually contains the per-conversation tool toggles (Web Search, Code Interpreter, File Search, Artifacts, MCP Servers, Image generation) plus the `ToolsDropdown` menu. Wrapping it in `{!isSuperAdmin && (...)}` removed legitimate functionality from super admins, and as of section 3.20 it would have permanently locked super admins out of the Image generation badge. The gate is gone; tool-row visibility is now controlled exclusively by the per-tool permission checks inside `BadgeRow` (each toggle reads `useHasAccess(<TOOL_PERM>, USE)` against the user's role). When merging future upstream `ChatForm.tsx` changes, do **not** reintroduce a super-admin gate around `<BadgeRow ...>`; if super admins ever need their own view of badges, the right hook is the per-permission `useHasAccess` chain inside `BadgeRow.tsx` itself.
- 2026-05-15 MCP selector hidden before first selection: `client/src/components/Chat/Input/MCPSelect.tsx` must render from the positive availability gates (`MCP_SERVERS.USE`, structured-tool support, and non-empty selectable MCP servers), not from `mcpValues`. Empty `mcpValues` is the normal pre-selection state that lets users choose their first MCP server; hiding the selector there makes MCP appear missing even though backend config, permissions, and tool discovery are healthy. Guarded by `client/src/components/Chat/Input/MCPSelect.guards.spec.ts`.
- 2026-04-26 **Regression-guard test suites pinned to keep these three bug classes from re-landing.** Each guard is small, fast (≤30 s), runs in CI alongside the rest of the workspace tests, and has been negative-test-verified (each fails red when the bug is reintroduced):
  - `packages/data-schemas/src/schema/role.spec.ts` — three guards: (a) every `PermissionTypes` value is a declared path on `rolePermissionsSchema`, (b) every permission that ADMIN gets `USE` for in `roleDefaults` has a `USE: { type: Boolean }` declaration on the schema, (c) end-to-end persistence: `initializeRoles()` round-trips through an in-memory MongoDB and the saved ADMIN doc actually contains every default permission. This catches the IMAGE_GEN-style strict-mode-stripping bug.
  - `packages/api/src/endpoints/modelCapabilities.guards.spec.ts` — pins that `getAnthropicModelCapabilities`, `getGoogleModelCapabilities`, and `getXAIModelCapabilities` are exported as functions whose arity is ≤1 (i.e. an options object, not positional args). Catches the bug where `api/server/routes/config.js` imports a function that doesn't exist on `@librechat/api`.
  - `packages/api/src/index.guards.spec.ts` — pins the named public surface of `@librechat/api` (capability helpers + model discovery + image-model discovery). Catches accidental drops in `index.ts`/`endpoints/index.ts` re-export tree.
  - `client/src/components/Chat/Input/ChatForm.guards.spec.ts` — pins that `<BadgeRow` is never rewrapped in any `isSuperAdmin && (...)` or `isSuperAdmin ? ... : <BadgeRow` ternary gate, by reading the source file with `fs` and asserting against a 1000-char window before each `<BadgeRow` JSX site. Catches reintroduction of the 2026-04-11 mistake during upstream merges.
  - `client/src/components/Chat/Input/MCPSelect.guards.spec.ts` — pins that MCP chat-bar selector visibility is not gated on empty `mcpValues`. Catches reintroduction of the bug where users cannot select their first MCP server because the selector is hidden until something is already pinned/selected.

  **Do not loosen, skip, or delete these guards without consulting the corresponding lesson above.** They exist precisely because the underlying bug class is invisible at runtime until a real user reports it.

---

### 3.20 User-managed image generation (Settings tab + chat-bar toggle + auto-injection)

#### What it adds

- A new **Settings → Image generation** tab where users discover the image-generation models actually available to them per provider. Discovery covers OpenAI, Azure OpenAI, xAI (image-mode endpoints), Google Gemini API, Vertex AI, Black Forest Labs (Flux, curated), and Stability AI (curated). Each provider row shows whether credentials are server-defined, user-defined, or unconfigured, and lets the user pick a default model.
- An **Image badge** in the chat-bar `BadgeRow`, gated behind the new `IMAGE_GEN.USE` permission. The badge writes `ephemeralAgent.image_generation` so the toggle persists per conversation.
- An **always-on auto-injection** path in `Agent.js` (`applyImageGenerationTool`) that adds the right tool key (`image_gen_oai`, `gemini_image_gen`, `flux`, `stable-diffusion`) when any of the following are true: the chat-bar toggle is on, `enabledByDefault` is set in user prefs, the active modelSpec opts in, or a `preferredProvider` is saved. Routing prefers `preferredProvider`, then matches the request endpoint name (openai / azure / xai / google / gemini / vertex), then falls back to openai → google → flux.
- **Model overrides** plumbed into the four image-generation tools so the per-user model choice (or a preferredProvider's discovered default) flows through rather than the env-only defaults: `OpenAIImageTools` reads `fields.model` ahead of `IMAGE_GEN_OAI_MODEL`, `GeminiImageGen` accepts a `modelOverride`, `FluxAPI` derives `defaultEndpoint` from the chosen Flux model id, and `StableDiffusion` populates A1111's `override_settings.sd_model_checkpoint` with the chosen Stability id.
- **Real OpenAI GPT-image streaming previews** for `image_gen_oai`: the tool requests OpenAI Image API streaming (`stream: true`, `partial_images: 3`) only for official OpenAI `gpt-image-*` models, emits transient partial images through the existing SSE attachment map, and still saves the final completed image through the existing artifact pipeline. Azure OpenAI, xAI/custom base URLs, DALL-E models, edits, and unsupported streaming responses remain on the non-streaming fallback path.
- A new `ImageGenerationController` mounted at `/api/image-generation/{models,prefs}` (GET/PATCH) with explicit `IMAGE_GEN.USE` checks and zod-validated payloads. Response shapes are `TImageGenModelsResponse` and `{ prefs: TImageGenerationPrefs }`. The discovery layer caches results per user for one hour and falls back to the curated lists for Flux/Stability with a `notice` if a remote call fails.

#### Key files

Backend:

- `api/server/controllers/ImageGenerationController.js`
- `api/server/routes/imageGeneration.js`
- `api/server/index.js` (mounts `/api/image-generation`)
- `api/server/routes/index.js` (re-exports the new router)
- `api/models/Agent.js` (`applyImageGenerationTool`, exported for test coverage)
- `api/app/clients/tools/util/handleTools.js` (`resolveImageModelOverride`, threading `model` into all four image tool constructors)
- `api/server/services/ToolService.js` (threads `res`/`streamId` into tool execution so `image_gen_oai` can emit partial attachments)
- `api/app/clients/tools/structured/OpenAIImageTools.js`
- `api/app/clients/tools/structured/GeminiImageGen.js`
- `api/app/clients/tools/structured/FluxAPI.js`
- `api/app/clients/tools/structured/StableDiffusion.js`

Tests:

- `packages/data-provider/src/imageGeneration.spec.ts`
- `packages/api/src/endpoints/imageModels.spec.ts`
- `api/server/controllers/__tests__/ImageGenerationController.spec.js`
- `api/models/__tests__/applyImageGenerationTool.spec.js`
- `api/app/clients/tools/structured/specs/OpenAIImageTools.spec.js`
- `client/src/components/Chat/Messages/Content/__tests__/OpenAIImageGen.test.tsx`

Shared packages:

- `packages/data-provider/src/imageGeneration.ts` (provider enum, curated model lists, helpers, prefs schemas)
- `packages/data-provider/src/api-endpoints.ts` (image-generation URL helpers)
- `packages/data-provider/src/data-service.ts` (`getImageGenerationModels`, `getImageGenerationPrefs`, `updateImageGenerationPrefs`)
- `packages/data-provider/src/keys.ts` (QueryKeys + MutationKeys)
- `packages/data-provider/src/permissions.ts` and `roles.ts` (`PermissionTypes.IMAGE_GEN` with `Permissions.USE`)
- `packages/data-provider/src/config.ts` (`SettingsTabValues.IMAGE_GENERATION`, `LAST_IMAGE_GENERATION_TOGGLE_`, `PIN_IMAGE_GENERATION_`)
- `packages/data-provider/src/types.ts` (`TEphemeralAgent.image_generation`)
- `packages/data-provider/src/types/assistants.ts` (`Tools.image_generation`)
- `packages/data-provider/src/schedules.ts` (ephemeralAgent zod schema honors `image_generation`)
- `packages/api/src/endpoints/imageModels.ts` (`discoverImageModels`)
- `packages/api/src/endpoints/index.ts` (re-exports)
- `packages/data-schemas/src/schema/user.ts` and `types/user.ts` (`imageGenerationPrefs`)

Frontend:

- `client/src/components/Nav/Settings.tsx` (renders the new tab, gated by `useHasAccess(IMAGE_GEN, USE)`)
- `client/src/components/Nav/SettingsTabs/ImageGeneration/{ImageGeneration.tsx,index.ts}`
- `client/src/components/Nav/SettingsTabs/index.ts` (re-export)
- `client/src/components/Chat/Input/ImageGeneration.tsx` (chat-bar badge)
- `client/src/components/Chat/Input/BadgeRow.tsx` (renders the badge after `<FileSearch />`)
- `client/src/components/Chat/Input/ToolsDropdown.tsx` (image generation menu item with pin toggle)
- `client/src/components/Chat/Messages/Content/Parts/OpenAIImageGen/OpenAIImageGen.tsx` (renders newest streamed partial preview, then final saved attachment)
- `client/src/Providers/BadgeRowContext.tsx` (`imageGeneration: useToolToggle(...)` exposed via context)
- `client/src/data-provider/ImageGeneration/{queries.ts,mutations.ts,index.ts}` (`useImageGenerationModelsQuery`, `useImageGenerationPrefsQuery`, `useUpdateImageGenerationPrefsMutation`)
- `client/src/data-provider/index.ts` (re-export)
- `client/src/locales/en/translation.json` (image-generation copy keys)

#### Preserve during merges

- The `IMAGE_GEN` permission must remain registered in `permissions.ts` and seeded in `roles.ts` for the default user role. Any upstream rewrite of role defaults that drops `IMAGE_GEN` will silently disable the feature for everyone.
- `api/server/index.js` must keep mounting `/api/image-generation` after auth middleware and before the catch-all 404. Same for `api/server/routes/index.js` re-export.
- The four image-generation tool constructors must keep accepting `model` from `fields`. Upstream periodically rewrites these tools; do not regress to env-only model selection.
- `OpenAIImageTools.js` partial-image streaming must remain additive: only official OpenAI `gpt-image-*` generations stream transient attachment previews, and final persisted files must continue through `createToolEndCallback`/`saveBase64Image`.
- `Agent.js` must keep calling `applyImageGenerationTool` inside `loadEphemeralAgent`. The export is also used by unit tests.
- `discoverImageModels` is the single source of truth for the Settings tab. Do not duplicate provider-specific filtering elsewhere; rely on the helpers in `packages/data-provider/src/imageGeneration.ts`.
- Curated lists (`fluxKnownModels`, `stabilityKnownModels`) and `imageGenDefaultModel` are explicit fallbacks the UI relies on when a provider has no live discovery API. Keep them ordered newest-first and update with new releases as they ship.

#### Relevant env/config surface

- `OPENAI_API_KEY`, `IMAGE_GEN_OAI_API_KEY`, `IMAGE_GEN_OAI_BASEURL`, `IMAGE_GEN_OAI_MODEL` — OpenAI / Azure / xAI image generation
- `AZURE_OPENAI_API_KEY` plus existing Azure OpenAI base/version env (used when `IMAGE_GEN_OAI_BASEURL` is an Azure URL)
- `XAI_API_KEY` plus existing `XAI_REVERSE_PROXY_URL` configuration
- `GOOGLE_API_KEY` / `GEMINI_API_KEY` for Gemini API discovery; existing Vertex service-account / ADC env for Vertex AI
- `FLUX_API_KEY`, `STABILITY_API_KEY` — curated provider gating
- Per-user keys saved through the existing user-key flow are also resolved by `loadAuthValues` and merged with env-defined credentials.

#### Live-rail deployment notes

- Code-only deploy: rebuild `data-provider`, `data-schemas`, `packages/api`, then run `npm run frontend`. Push the resulting dists/SPA via `docker cp` and restart the target container — no Docker image rebuild needed.
- Smoke test after deploy: `curl http://localhost:<port>/api/image-generation/models` must return `401` (unauthenticated). The Settings → Image generation tab loads only for users whose role grants `IMAGE_GEN.USE`.

---

### 3.21 Internet Archive / Wayback read-only MCP server integration

#### What it adds

- Configures the external `/pool/home/timeng/internet-archive-mcp-server` service as LibreChat MCP server `internet-archive`.
- Exposes the server through streamable HTTP at `http://192.168.50.4:8770/mcp`.
- Adds `http://192.168.50.4:8770` to `mcpSettings.allowedDomains`.
- Provides read-only Internet Archive and Wayback Machine tools for archived-page lookup, CDX search, snapshot text/source fetches, snapshot comparison, archive.org item search, metadata, files, OCR/text derivatives, reviews, views, and Simple Lists.
- Exposes 19 read-only tools: `get_server_capabilities`, `wayback_available`, `wayback_cdx_search`, `wayback_cdx_capture_summary`, `wayback_snapshot_url`, `wayback_fetch_snapshot_text`, `wayback_fetch_snapshot_source`, `wayback_compare_snapshots`, `archive_search_items`, `archive_advanced_search`, `archive_metadata`, `archive_metadata_field`, `archive_file_list`, `archive_fetch_file_text`, `archive_item_full_text`, `archive_item_reviews`, `archive_item_views`, `archive_simplelists_for_item`, and `archive_simplelist_children`.

#### Key files / runtime dependencies

- `librechat.yaml` (runtime, gitignored) — `mcpServers.internet-archive` and `mcpSettings.allowedDomains`.
- `/pool/home/timeng/internet-archive-mcp-server` — external Python FastMCP service.
- `/pool/home/timeng/internet-archive-mcp-server/src/ia_mcp/server.py` — MCP tool definitions and HTTP transport.
- `/pool/home/timeng/internet-archive-mcp-server/src/ia_mcp/client.py` — Internet Archive / Wayback API helpers, rate limiting, text-file selection, and bounded fetches.
- `/home/timeng/.config/systemd/user/internet-archive-mcp.service` — user service that keeps the external MCP server active on port `8770`.
- `INTERNET_ARCHIVE_MCP.md` — focused local runbook and tool-surface reference.

#### Preserve during merges / runtime changes

- Keep `mcpServers.internet-archive` configured as `type: streamable-http`, `url: http://192.168.50.4:8770/mcp`, and `timeout: 90000`.
- Keep `http://192.168.50.4:8770` in `mcpSettings.allowedDomains`.
- Keep the MCP server read-only. Do not add Save Page Now, upload/delete, metadata-write, review-write, relationship-write, or task-submission tools without a separate security review and explicit approval.
- Preserve the Internet Archive-compliant User-Agent, retry/`Retry-After` handling, bounded output limits, and local rate limiting.
- Preserve the full-text derivative selection safeguards: PDFs and other binary derivatives must not be selected as text even when their IA format contains words such as `Text PDF`.

#### Validation notes

- External server validation passed with `ruff check`.
- External server tests passed with `pytest` (`19 passed`).
- Live MCP validation passed: `tools/list` returned all 19 `internet-archive` tools.
- Stable LibreChat logs showed `internet-archive` initialized with all 19 tools after the production API restart.

---

## 4. Merge-sensitive files / surfaces to watch closely

When merging upstream changes, pay special attention to these areas.

### Runtime/config surface

- `.env.example`
- `librechat.yaml` (runtime, gitignored -- verify `interface`, `modelSpecs`, endpoint config, local MCP allowlist entries through `http://192.168.50.4:8770`, and `mcpServers.internet-archive` are intact after any modification)
- `librechat.example.yaml`
- `api/server/routes/config.js`
- `packages/api/src/endpoints/models.ts`
- `api/server/services/ModelAccess.js` (`DEFAULT_NON_ADMIN_MODEL_PERMISSIONS` -- keep aligned with `modelSpecs` quick-selector)
- `local-services/dev-seed-validation-personas.js` (can inject modelSpecs into librechat.yaml -- do not run against shared runtime yaml)

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
- `client/src/components/Chat/Input/MCPSelect.tsx`
- `client/src/components/Chat/Input/MCPSelect.guards.spec.ts`
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

### Auth cookie and session hardening (LAN/plain-HTTP deployments)

- `packages/api/src/oauth/csrf.ts` — `shouldUseSecureCookie()` with `isPlainHttp` bypass for `http://` DOMAIN_SERVER
- `api/server/services/AuthService.js` — `sameSite: 'lax'` on `refreshToken` and `token_provider` cookies in `setAuthTokens()`
- `api/server/controllers/AuthController.js` — diagnostic `logger.debug`/`logger.warn` calls in `refreshController`

### UX bug fixes (stop button, badge row, pinned model)

- `client/src/hooks/SSE/useResumableSSE.ts` — `setSubmission(null)` after final event to clear stop button; `clearDraft` → `clearAllDrafts` fix (the imported function); safety-net catch block that forces UI cleanup if `final` event processing throws
- ~~`client/src/components/Chat/Input/ChatForm.tsx` — `{!isSuperAdmin && <BadgeRow>}` conditional, super admin detection via `useAdminPermissionsQuery`~~ **Removed 2026-04-26.** `BadgeRow` is the tool-toggle row, not a model selector; the gate is gone and tool-row visibility is now governed entirely by per-tool `useHasAccess` checks inside `BadgeRow.tsx`. A regression guard at `client/src/components/Chat/Input/ChatForm.guards.spec.ts` fails CI if any future merge re-wraps `<BadgeRow` in an `isSuperAdmin` gate.
- `client/src/hooks/useNewConvo.ts` — `userHasManualModelSelection` check to preserve pinned model; `FILES_DRAFT` cleanup on new conversation

### Regression guards (pinned tests; do not loosen)

- `packages/data-schemas/src/schema/role.spec.ts` — covers (a) Mongoose `rolePermissionsSchema` declares every `PermissionTypes` value, (b) every ADMIN-USE permission has a `USE: Boolean` declaration on the schema, (c) `initializeRoles()` round-trips through in-memory MongoDB without strict-mode stripping. **Why:** prevents the 2026-04-26 IMAGE_GEN class of bug where a permission added to `librechat-data-provider` but not to the Mongoose schema is silently dropped on save.
- `packages/api/src/endpoints/modelCapabilities.guards.spec.ts` — pins that `getAnthropicModelCapabilities`, `getGoogleModelCapabilities`, `getXAIModelCapabilities` exist as functions accepting an options object. **Why:** `api/server/routes/config.js` imports them by name; a missing export crashes `/api/config` on every request and silently breaks the entire BadgeRow + Settings tab UI.
- `packages/api/src/index.guards.spec.ts` — pins the named public surface of `@librechat/api` (capability helpers + model discovery + `discoverImageModels`). **Why:** stops accidental drops in `index.ts`/`endpoints/index.ts` re-export tree.
- `client/src/components/Chat/Input/ChatForm.guards.spec.ts` — pins that `<BadgeRow` is never wrapped in any `isSuperAdmin` gate. **Why:** the 2026-04-11 gate hid all tool toggles from super admins; a future upstream-merge could easily reintroduce it.
- `client/src/components/Chat/Input/MCPSelect.guards.spec.ts` — pins that MCP selector visibility is not gated on empty `mcpValues`. **Why:** users need the selector visible before any MCP server is pinned or selected.
- `packages/api/src/utils/content.spec.ts` — pins malformed content filtering for provider-native history, including Anthropic `thinking` blocks missing required signed fields. **Why:** prevents interrupted Claude native-tool turns from being replayed as invalid Anthropic Messages API payloads.

### Gemini/Vertex AI service account support

- `docker-compose.local.override.yml` — bind mount for `./data/google-service-account.json` → `/app/data/google-service-account.json` (read-only)
- `.gitignore` — `/data/google-service-account.json` entry to prevent credential leakage
- `.env` — `GOOGLE_KEY=user_provided`, `GOOGLE_AUTH_MODE`, `GOOGLE_SERVICE_KEY_FILE`, `GOOGLE_VERTEX_PROJECT`, `GOOGLE_VERTEX_LOCATION`, `GOOGLE_MODELS`

### Dev-rail Langfuse stack isolation

- `local-services/start-all.sh` — `shared_traceability_services` array separated; only started on stable rail; dev rail cleans up stale traceability containers
- `local-services/rail-env.sh` — exports `LANGFUSE_BASE_URL`/`LANGFUSE_UI_URL` for dev rail (pointing to shared stable Langfuse via `host.docker.internal`), unsets for stable rail
- `docker-compose.local.override.yml` — passes `LANGFUSE_BASE_URL`/`LANGFUSE_UI_URL` through to API container

### User-managed image generation

- `api/server/index.js`, `api/server/routes/index.js`, `api/server/routes/imageGeneration.js`, `api/server/controllers/ImageGenerationController.js`
- `api/models/Agent.js` (`applyImageGenerationTool` + `loadEphemeralAgent` integration)
- `api/app/clients/tools/util/handleTools.js` (`resolveImageModelOverride`)
- `api/app/clients/tools/structured/{OpenAIImageTools,GeminiImageGen,FluxAPI,StableDiffusion}.js`
- `packages/api/src/endpoints/imageModels.ts`
- `packages/data-provider/src/{imageGeneration,api-endpoints,data-service,keys,permissions,roles,config,types,types/assistants,schedules}.ts`
- `packages/data-schemas/src/schema/user.ts`, `packages/data-schemas/src/types/user.ts`
- `client/src/components/Nav/Settings.tsx`, `client/src/components/Nav/SettingsTabs/ImageGeneration/`
- `client/src/components/Chat/Input/{ImageGeneration.tsx,BadgeRow.tsx,ToolsDropdown.tsx}`
- `client/src/Providers/BadgeRowContext.tsx`
- `client/src/data-provider/ImageGeneration/`, `client/src/data-provider/index.ts`
- `client/src/locales/en/translation.json` (image-generation copy keys)

---

## 5. Existing focused docs already in this branch

These docs provide deeper detail for specific areas and should be kept consistent with this master doc.

- `OLLAMA_REASONING.md`
- `OLLAMA_WEB_SEARCH.md`
- `OPENAI_GEMINI_NATIVE_TOOLS.md`
- `OPENAI_GEMINI_NATIVE_TOOLS_IMPLEMENTATION.md`
- `LOCAL_CODE_INTERPRETER_INTEGRATION.md`
- `LOCAL_RAG_INTEGRATION.md`
- `PATCHED_REMOTE_IMAGE_REFERENCE.md`
- `REALTIME_VOICE.md`
- `SCHEDULED_RUNS.md`
- `XAI_CUSTOM_ENDPOINTS.md`
- `IMAGE_GENERATION.md`
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
- the runtime `librechat.yaml` always includes an `interface` block with `endpointsMenu`, `modelSelect`, `parameters`, `sidePanel`, and `presets` all set to `true`
- `modelSpecs` in `librechat.yaml` uses `enforce: false` so the quick-selector never blocks free model access; the specs list stays aligned with `DEFAULT_NON_ADMIN_MODEL_PERMISSIONS`
- the Ollama local endpoint uses `fetch: false` with an explicit model list; Ollama Cloud uses `user_provided` key with its own default list; these must not be re-merged into a single endpoint
- `local-services/dev-seed-validation-personas.js` must never be run against the shared runtime `librechat.yaml`; it is dev-rail validation tooling only
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
