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

## Current model

### Worktree roles

- `/pool/home/timeng/LibreChat` = upstream-sync worktree
- `/pool/home/timeng/LibreChat-custom` = actual customized LibreChat worktree

### Current intent

- keep upstream `main` clean in `LibreChat`
- keep all custom work in `LibreChat-custom`
- merge upstream changes into `engt21/local-customizations`
- do not rely on the fork for safety; the custom worktree is the source of truth

## What this custom branch adds

The custom work falls into these main buckets:

1. Admin console, RBAC, superadmin sync, and live app settings
2. Scheduled runs and notifications
3. Default per-user model access and admin-managed model restrictions
4. Provider-native chat-bar tools for OpenAI/Azure/Gemini
5. Google Gemini live model discovery, capability-aware settings, and grounding citations
6. xAI custom-endpoint live discovery and capability-aware settings
7. Ollama multi-source discovery, hosted web search, and reasoning controls
8. MCP interoperability and OAuth hardening for OpenAI / Arcade-hosted MCP tools
9. Local runtime, Docker, startup, observability, and worktree workflow changes
10. Secret-handling and local git safety improvements
11. Background audio/video transcription with persistent conversations
12. Google auth mode support (API key, Vertex service account, Vertex ADC)

---

## 1. Admin console, RBAC, superadmin sync, and live app settings

### What it does

- Adds an admin console UI and backend routes
- Adds admin roles/permissions beyond simple superadmin behavior
- Adds DB-backed app settings such as `registrationEnabled`
- Makes observability links host-aware instead of always using `localhost`
- Syncs `SUPERADMIN_EMAILS` into admin role membership on startup and auth flows
- Shows the model-picker API-key settings cog at the provider level, but only for super-admin users, excluding `My Agents`
- Reopens that provider settings cog with the saved provider values preloaded so super admins can update only the changed field
- Adds `AppSettings.platformPrompt`, a super-admin-editable platform system prompt that is prepended before preset/user/agent instructions for Assistants and Agents

### Main files

#### Backend

- `api/server/controllers/AdminController.js`
- `api/server/routes/admin/index.js`
- `api/server/middleware/adminAccess.js`
- `api/server/middleware/buildEndpointOption.js`
- `api/server/services/Admin/appSettings.js`
- `api/server/services/Admin/permissions.js`
- `api/server/services/Admin/superadmin.js`
- `api/server/controllers/agents/client.js`
- `config/sync-superadmins.js`

#### Frontend

- `client/src/components/Admin/AdminConsole.tsx`
- `client/src/components/Chat/Menus/Endpoints/ModelSelectorContext.tsx`
- `client/src/components/Chat/Menus/Endpoints/components/EndpointItem.tsx`
- `client/src/components/Chat/Menus/Endpoints/components/EndpointModelItem.tsx`
- `client/src/components/Chat/Menus/Endpoints/components/SearchResults.tsx`
- `client/src/routes/index.tsx`
- `client/src/data-provider/Admin/*`
- `packages/api/src/agents/context.ts`
- `packages/data-provider/src/admin.ts`

#### Schemas and types

- `packages/data-schemas/src/schema/adminRole.ts`
- `packages/data-schemas/src/schema/appSettings.ts`
- matching models/methods/types in `packages/data-schemas/src/*`

### Preserve during merges

- `/api/admin` route wiring
- admin permission checks and middleware
- `SUPERADMIN_EMAILS` sync behavior
- DB-backed app settings behavior
- `AppSettings.platformPrompt` schema/zod/UI handling and prompt-prepend ordering
- host-aware observability URLs
- super-admin-only model-picker API-key settings access

### Why this is merge-sensitive

This area overlaps with auth, config, user creation, and route registration. Upstream changes in auth/config can easily miss custom admin behavior if merged carelessly.

---

## 2. Scheduled runs and notifications

### What it does

- Adds per-user scheduled runs for agent executions and model prompts
- Adds manual run-now capability
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
- `client/public/assets/push-sw.js`

#### Schema/type layer

- `packages/data-schemas/src/schema/scheduledJob.ts`
- matching model/type files

### Preserve during merges

- `/api/schedules` route registration
- scheduled job runner startup in API boot flow
- scheduled job schema and notification settings
- browser push service worker support
- notification env/config handling

### Supporting docs

- `SCHEDULED_RUNS.md`

---

## 3. Default per-user model access and admin-managed model restrictions

### What it does

- Gives new non-admin users a default restricted model set
- Lets admins keep broader access
- Filters visible model lists per user
- Blocks requests to models the user is not allowed to use
- Lets admins override per-user model access

### Current default model intent

- `openAI`: `gpt-5.1`
- `google`: `gemini-3-flash-preview`, `gemini-2.5-flash-lite`
- `ollama`: all discovered Ollama models

### Main files

- `api/server/services/ModelAccess.js`
- `api/server/controllers/ModelController.js`
- `api/server/middleware/validateModel.js`
- `api/server/services/AuthService.js`
- `api/server/services/PermissionService.js`
- `api/strategies/{process,ldapStrategy,openidStrategy,samlStrategy}.js`
- `packages/data-schemas/src/schema/user.ts`
- `packages/data-schemas/src/types/user.ts`
- admin console files above

### Preserve during merges

- model permission fields on the user schema
- model filtering in config/model responses
- validation enforcement before requests run
- default model permission assignment on all account creation paths

---

## 4. Provider-native chat-bar tools for OpenAI/Azure/Gemini

### What it does

- Lets chat-bar toggles route to provider-native tools where supported
- Keeps existing LibreChat UI while changing the backend execution path
- Tags uploaded files for native-tool flows
- Uses completed OpenAI/Azure reasoning summary parts instead of fragmentary incremental events and coalesces adjacent thought parts in the UI
- Sanitizes malformed Anthropic signed thinking blocks before storage/request replay so interrupted Claude native-tool streams do not poison later turns
- Avoids duplicate prompt/file injection when native tools own the file flow

### Main behavior

- OpenAI/Azure:
  - native web search
  - native code interpreter
  - native file search
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
- `client/src/components/Chat/Input/ToolsDropdown.tsx`
- `client/src/hooks/Files/useFileHandling.ts`
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

### Main files

- `client/src/components/Chat/Input/MCPSelect.tsx`
- `client/src/components/Chat/Input/MCPSelect.guards.spec.ts`
- `packages/api/src/mcp/zod.ts`
- `packages/api/src/mcp/oauth/handler.ts`
- `packages/api/src/mcp/MCPConnectionFactory.ts`
- `api/server/routes/mcp.js`
- `docker-compose.local.override.yml`

### Preserve during merges

- keep the bare-object schema fix for OpenAI/GPT-5-compatible tool calling
- keep protected-resource `authorization_servers` refresh discovery ahead of server-URL guessing
- keep callback precedence as `DOMAIN_SERVER` -> forwarded host headers -> request host/protocol
- keep the local loopback `DOMAIN_SERVER` default unless intentionally replacing it with a public HTTPS URL
- do not misclassify provider authorization links from Arcade Microsoft tools as LibreChat MCP initialization failures
- keep MCP selector visibility independent of `mcpValues`; do not hide it just because no server is pinned or selected

### Supporting docs

- `README.local.md`
- `CUSTOMIZATION_MASTER_DOC.md`

---

## 9. Local runtime, Docker, startup, observability, and worktree workflow changes

### What it does

- Makes `LibreChat-custom` the main runnable local worktree
- Keeps `LibreChat` as the upstream-sync worktree
- Uses helper scripts to symlink runtime-only secret/data files into the custom worktree while keeping the local Docker override checked into this repo
- Standardizes local startup on detached Docker compose using the custom worktree
- Adds user-level systemd services for startup and an Ollama keep-warm timer
- Keeps a full local-build path as the default runtime
- Keeps an optional patched-remote image workflow for targeted validation
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
- `local-services/start-all.sh`
- `local-services/stop-all.sh`
- `local-services/status-all.sh`
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
- keep `/pool/home/timeng/LibreChat` for upstream sync only
- keep `ensure-runtime-files.sh` symlink convention for runtime secret/data paths only:
  - `.env`
  - `librechat.yaml`
  - `langfuse/.env`
  - `data-node`
  - `meili_data_v1.35.1`
  - `images`
  - `uploads`
  - `logs`
- keep `COMPOSE_PROJECT_NAME=librechat` for the main app stack commands, with `docker-compose.local.override.yml` as the default local override
- keep `LIBRECHAT_LANGFUSE_*_MEM_LIMIT` overrides in `.env` — Langfuse v3 OOMs at compose defaults
- keep exporter-sidecar compose commands separate from the main app stack
- keep user systemd service definitions pointing at `LibreChat-custom`
- keep the documented `DOMAIN_SERVER` callback behavior aligned with the MCP section above

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

- Uploading any audio or video file auto-triggers a background transcription job
- A dedicated conversation is created immediately with a "Transcribing..." placeholder; the user can navigate away and the job runs asynchronously
- Background runner polls a MongoDB-backed job queue with lease/lock semantics
- Video files are converted to mp3 via ffmpeg; oversized uploads are chunked into <=23 MB segments
- Completed transcript text is stored in the file's `text` field and the response message is updated in place
- The conversation persists in the sidebar like any other chat
- The attach-file menu accepts `audio/*` and `video/*` MIME types for all document-supporting providers
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
- auto-transcription trigger in `useFileHandling.ts`
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
- `PATCHED_REMOTE_IMAGE_REFERENCE.md`

This guide is the top-level map. Those docs remain the deeper references.

---

## Highest-risk files during future merges

These are the files and areas most likely to need careful manual review when merging upstream changes:

### Runtime/config surface

- `.env.example`
- `librechat.example.yaml`
- `api/server/routes/config.js`
- `packages/api/src/endpoints/models.ts`

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
- `api/server/controllers/ModelController.js`
- `api/server/middleware/validateModel.js`
- account creation/auth strategy files
- `packages/data-schemas/src/schema/user.ts`

### Native-tool routing and file metadata

- `packages/api/src/agents/nativeTools.ts`
- `api/server/services/Files/process.js`
- `packages/data-schemas/src/schema/file.ts`
- related file metadata/types/methods

### MCP interoperability and OAuth flows

- `client/src/components/Chat/Input/MCPSelect.tsx`
- `client/src/components/Chat/Input/MCPSelect.guards.spec.ts`
- `packages/api/src/mcp/zod.ts`
- `packages/api/src/mcp/oauth/handler.ts`
- `packages/api/src/mcp/MCPConnectionFactory.ts`
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
   - local runtime scripts and startup behavior
5. if `package-lock.json` conflicts, regenerate it with:

```bash
cd /pool/home/timeng/LibreChat-custom
npm install --package-lock-only --ignore-scripts
```

6. run relevant validation after the merge
7. rebuild/restart from `LibreChat-custom`

For the MCP/OAuth customization area, the targeted checks are currently:

```bash
docker exec -w /app LibreChat npm --prefix /app/packages/api run test:ci -- --runInBand --testPathPatterns=src/mcp/__tests__/handler.test.ts
docker exec -w /app LibreChat npm --prefix /app/packages/api run test:ci -- --runInBand --testPathPatterns=src/mcp/__tests__/zod.spec.ts
docker exec LibreChat node -e "console.log(process.env.DOMAIN_SERVER || '')"
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

The runtime `librechat.yaml` (symlinked from `/pool/home/timeng/LibreChat/librechat.yaml`) must include these sections beyond endpoints:

- `memory:` -- required for user memories to be retrieved and injected into agent conversations. Without this section, `useMemory()` silently returns early and stored memories are never used. The `provider` value must use `EModelEndpoint` casing (e.g., `"openAI"` not `"openai"`), because `getProviderConfig` does a case-sensitive lookup against `providerConfigMap`. Minimum:

```yaml
memory:
  agent:
    provider: 'openAI'
    model: 'gpt-4.1-mini'
```

- `speech:` -- required for STT/TTS functionality

When upstream adds new config-gated features, always check whether the corresponding section exists in the runtime `librechat.yaml`.

---

## Current operational assumption

The running local app should be the custom build from:

- worktree: `/pool/home/timeng/LibreChat-custom`
- image: `librechat-local:latest`

That is the intended live source of truth for local runtime behavior.

---

## Summary

If future upstream merges get complicated, do not try to remember everything from memory.

Use this order:

1. this master guide
2. the focused supporting docs
3. the key file lists in each section
4. the running local worktree conventions in `LibreChat-custom`

If a future merge preserves the feature buckets and preserve-lists in this document, it should preserve the substance of the custom branch.
