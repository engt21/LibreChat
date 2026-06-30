# OpenAI, Gemini, and Anthropic Native Tools Implementation Notes

This document is the engineering companion to [./OPENAI_GEMINI_NATIVE_TOOLS.md](./OPENAI_GEMINI_NATIVE_TOOLS.md).

It focuses on how the feature was implemented, which files were changed, how the request flows work, and what was verified locally.

## Goals

The implementation set out to make the existing LibreChat chat-bar toggles use provider-native behavior where possible:

- OpenAI / Azure OpenAI `web_search`
- OpenAI / Azure OpenAI `execute_code`
- OpenAI / Azure OpenAI `file_search`
- Gemini `web_search`
- Gemini `execute_code`
- Anthropic `web_search`
- Anthropic `execute_code` with explicit local-vs-provider mode selection
- Anthropic direct endpoint sidebar controls for `fast_mode`, `web_fetch`, `anthropic_code_execution`, `anthropic_advisor`, and `anthropic_advisor_model`
- Anthropic live model discovery, capability metadata, and capability-aware model-parameter rendering

At the same time, it needed to preserve existing LibreChat behavior when native routing was not available or not safe.

## High-level design

The implementation was split across four layers:

1. client toggle UX and upload metadata
2. agent initialization / tool selection
3. file metadata and persistence
4. message assembly / prompt-context suppression for native-tool files

The core design principle is:

> keep the existing LibreChat UI and request shape, but translate ephemeral chat-bar state into provider-native tools on the server.

## Runtime patch safety note

The OpenAI/Azure native web-search status UX depends on `config/apply-runtime-patches.js` rewriting `@librechat/agents` stream handlers.

As of 2026-04-04, that patch layer also carries a hard validation guard plus Jest coverage to prevent a specific regression: dispatching `on_web_search_status` with `graph.getStepIdByKey(stepKey)` before the local `stepKey` declaration. That legacy snippet caused production Responses streams to abort with `Cannot access 'stepKey' before initialization`.

Operational rule: after changing runtime patches, use `local-services/deploy-runtime-delta.sh` first. The helper copies `config/apply-runtime-patches.js`, runs it inside the API container, restarts, and health-checks so the containerized `node_modules/@librechat/agents` copy picks up the validated patch without a full image rebuild. Schedule a later cached image refresh when appropriate so the patched dependency layer is baked into the next image.

## Files changed

## Client

- `client/src/Providers/BadgeRowContext.tsx`
- `client/src/components/Chat/Input/CodeInterpreterSubMenu.tsx`
- `client/src/components/Chat/Input/ToolsDropdown.tsx`
- `client/src/components/Chat/Menus/Endpoints/components/EndpointItem.tsx`
- `client/src/components/SidePanel/Parameters/Panel.tsx`
- `client/src/components/SidePanel/Agents/ModelPanel.tsx`
- `client/src/hooks/Files/useFileHandling.ts`
- `client/src/utils/endpoints.ts`
- `client/src/utils/endpoints.spec.ts`
- `client/src/utils/localStorage.ts`
- `client/src/utils/timestamps.ts`

## API / server

- `packages/api/src/agents/nativeTools.ts`
- `packages/api/src/agents/nativeTools.spec.ts`
- `packages/api/src/agents/initialize.ts`
- `packages/api/src/endpoints/models.ts`
- `packages/api/src/endpoints/anthropic/helpers.ts`
- `packages/api/src/endpoints/anthropic/llm.ts`
- `packages/api/src/utils/content.ts`
- `packages/api/src/agents/resources.ts`
- `api/server/controllers/ModelController.js`
- `api/server/routes/keys.js`
- `api/server/services/Models/refreshModels.js`
- `api/server/routes/config.js`
- `api/app/clients/BaseClient.js`
- `api/server/controllers/agents/client.js`
- `api/server/services/Endpoints/agents/initialize.js`
- `api/server/services/Endpoints/agents/addedConvo.js`
- `api/server/services/Files/process.js`
- `api/server/services/Files/process.spec.js`

## Data types / schema

- `packages/data-provider/src/anthropic.ts`
- `packages/data-provider/src/config.ts`
- `packages/data-provider/src/parameterSettings.ts`
- `packages/data-provider/src/schedules.ts`
- `packages/data-provider/src/schemas.ts`
- `packages/data-provider/src/types.ts`
- `packages/data-provider/src/types/files.ts`
- `packages/data-schemas/src/types/file.ts`
- `packages/data-schemas/src/schema/file.ts`
- `packages/data-schemas/src/methods/file.ts`
- `packages/data-schemas/src/methods/file.spec.ts`
- `packages/data-schemas/src/schema/defaults.ts`
- `packages/data-schemas/src/schema/preset.ts`
- `packages/data-schemas/src/types/convo.ts`
- `packages/data-schemas/src/types/scheduledJob.ts`
- `api/server/controllers/ScheduledJobsController.js`

## Core server module

## `packages/api/src/agents/nativeTools.ts`

This is the main orchestration layer for provider-native tool selection.

It is responsible for:

- determining which ephemeral toggles can become native provider tools
- gating OpenAI/Anthropic native tools by selected model capability metadata
- building OpenAI-native tool descriptors
- building Gemini-native tool descriptors
- mirroring files to OpenAI when needed
- creating OpenAI vector stores for native file search
- caching returned OpenAI resource IDs on LibreChat file metadata
- merging native tools with the remaining tool list without duplication

Important exported behaviors include:

- `selectNativeTools(...)`
- `buildNativeProviderTools(...)`
- `mergeNativeProviderTools(...)`

## Client-side implementation details

## Endpoint capability detection

`client/src/utils/endpoints.ts` now exposes endpoint capability detection for native tools.

That logic tells the client whether the current endpoint should behave like:

- native web search
- native code interpreter
- native file search

Current rules:

- OpenAI and Azure OpenAI support native web search, code interpreter, and file search
- Google supports native web search and code interpreter
- Google does not claim native file search in this implementation
- Anthropic supports native web search plus a selectable native code-execution mode when the Claude capability metadata says it is safe
- Anthropic direct endpoint sidebar controls expose fast mode, web fetch, hosted code execution, and advisor only when the selected Claude capability metadata supports the requested feature

## Badge row context

`client/src/Providers/BadgeRowContext.tsx` now exposes native-capability booleans to the input UI.

That matters because the client previously treated these toggles as if they always depended on LibreChat-specific auth/settings behavior.

After the change:

- OpenAI / Azure / Google / Anthropic native-capable chats can treat search/code as authenticated for toggle purposes
- LibreChat auth dialogs are only used when the endpoint actually depends on LibreChat-managed tooling
- Ollama still keeps its separate web-search mode behavior

For Anthropic, the badge-row context also persists the preferred code-execution mode for new chats:

- `librechat`
- `provider_native`

## Tools dropdown behavior

`client/src/components/Chat/Input/ToolsDropdown.tsx` now uses the endpoint-native capability flags to decide whether to show LibreChat-specific settings for:

- Web Search
- Code Interpreter

This was the remaining UX gap found during browser verification.

Without this change, the toggle badges existed, but clicking them could still trigger LibreChat auth/config flows even though the provider-native path was already implemented on the server.

## File upload tagging

`client/src/hooks/Files/useFileHandling.ts` appends `native_tool` to FormData for OpenAI-native `file_search` and `execute_code` uploads.

That allows the server to distinguish:

- normal file uploads for LibreChat-managed tooling
- file uploads that should participate in provider-native routing

## Server-side agent initialization

## `packages/api/src/agents/initialize.ts`

Agent initialization now:

- examines the ephemeral chat-bar tool state
- selects provider-native tools when appropriate
- passes the selected model into native-tool selection so OpenAI/Anthropic native tools are only selected for models that explicitly support the requested capability
- strips conflicting LibreChat structured tools from the runtime tool list
- injects OpenAI Responses API options when native search requires them
- passes Anthropic `execute_code_mode` through the ephemeral agent state
- adds Anthropic beta headers when native code execution is selected
- passes native tool state forward so later message/file processing can recognize native files

## Anthropic native web-search history safety

`packages/api/src/utils/content.ts` filters malformed Anthropic server-tool content before replay. It preserves matched `server_tool_use` / `*_tool_result` pairs for `web_search`, `web_fetch`, `code_execution`, and `advisor`, but drops orphaned or mismatched `srvtoolu_...` server-tool blocks. That avoids Anthropic request failures such as "tool use ... was found without a corresponding tool result block" on later turns.

## Anthropic direct endpoint sidebar server tools

`packages/data-provider/src/parameterSettings.ts` and `packages/data-provider/src/schemas.ts` add persisted model-parameter controls for:

- `fast_mode`
- `web_fetch`
- `anthropic_code_execution`
- `anthropic_advisor`
- `anthropic_advisor_model`

`packages/data-provider/src/anthropic.ts` derives model capability metadata for those controls. The client and agent-builder panels use that metadata to disable unsupported controls with a visible reason instead of letting users send invalid combinations.

`packages/api/src/endpoints/anthropic/llm.ts` consumes those sidebar fields before the remaining model options are serialized. The fields are deliberately not leaked into the final LLM config object:

- `fast_mode` sets `speed: fast` and adds `fast-mode-2026-02-01` for supported direct Anthropic Opus models
- `web_search` adds `{ type: 'web_search_20250305', name: 'web_search' }` by default and switches to `{ type: 'web_search_20260209', name: 'web_search' }` only when Anthropic hosted code execution is also active
- `web_fetch` adds `{ type: 'web_fetch_20250910', name: 'web_fetch', citations: { enabled: true } }` by default and switches to `{ type: 'web_fetch_20260209', name: 'web_fetch', citations: { enabled: true } }` only when Anthropic hosted code execution is also active
- `anthropic_code_execution` adds `{ type: 'code_execution_20250825', name: 'code_execution' }` and `code-execution-2025-08-25`
- `anthropic_advisor` adds `{ type: 'advisor_20260301', name: 'advisor', model: ... }` and `advisor-tool-2026-03-01`

Endpoint `defaultParams`, `addParams`, and `dropParams` can control those sidebar-only fields. Defaults only apply when the conversation did not explicitly set a value; `addParams` can override; `dropParams` forces the tool off.

These controls are direct Anthropic API features. Vertex Anthropic requests skip fast mode, web fetch, code execution, and advisor with warnings instead of sending provider-unsupported request bodies.

The same basic-vs-dynamic web-search rule applies to ephemeral agent native tools in `packages/api/src/agents/nativeTools.ts`: chat-bar web search uses the basic descriptor unless `selection.anthropicCodeExecution` is true. This keeps the agent path aligned with direct endpoint request construction.

The Anthropic docs also list client-side tools such as memory, bash, computer use, and text editor. They are intentionally not represented as LibreChat sidebar switches in this implementation. Those tools require a sandboxed executor, approval/error UI, and a continuation loop that returns client-side `tool_result` content back to Anthropic. Without that infrastructure, visible toggles would create broken chat turns rather than working tools.

## BYOK model refresh safety

`api/server/controllers/ModelController.js` resolves per-user OpenAI/Anthropic keys and base URLs before model discovery, assigns user-scoped cache keys for BYOK lists, and avoids treating `user_provided` as a live API key. `api/server/routes/keys.js` invalidates model discovery caches after key updates/revokes so newly released models appear after key rotation without an API restart.

This is the place where the normal ephemeral agent state is translated into actual runtime tools.

## Resource categorization and data queries

## `packages/api/src/agents/resources.ts`

File categorization was updated so files tagged with `metadata.nativeTool` are recognized as tool files even if they were not created through the legacy `embedded` / `fileIdentifier` paths.

## `packages/data-schemas/src/methods/file.ts`

Database queries were extended so native tool files can still be found by the code paths that load:

- file-search files
- code-interpreter files

This prevents native-tool files from disappearing from the rest of the request-processing pipeline.

## File metadata model

New metadata was added to the file type and schema so LibreChat can remember native-tool routing state.

Important fields:

- `metadata.nativeTool`
- `metadata.openai.endpoint`
- `metadata.openai.model`
- `metadata.openai.fileId`
- `metadata.openai.vectorStoreId`

These fields support:

- idempotent OpenAI upload reuse
- correct query behavior for native file sets
- skipping duplicate prompt context for native files

## File processing changes

## `api/server/services/Files/process.js`

When a file upload is marked with `native_tool`, the server now treats it differently from the old LibreChat-managed `tool_resource` path.

For native uploads, LibreChat:

- stores the file normally in LibreChat storage
- records native tool metadata
- avoids sending it into the legacy vectorization flow for file search
- avoids sending it into the legacy code-sandbox upload flow for code execution

This is critical because provider-native tools should own their own execution/search lifecycle once the file is mirrored upstream.

## Prompt and attachment handling changes

## `api/app/clients/BaseClient.js`

Base client logic now recognizes native tool files and avoids treating them like ordinary prompt attachments.

That prevents LibreChat from doing extra work such as:

- extracting file context from files already owned by native file search
- classifying native tool files into normal prompt attachment categories when that would duplicate behavior

## `api/server/controllers/agents/client.js`

Message-building logic was also updated so native tool files can bypass:

- normal `processFile` prompt expansion for native file search
- token-counting behavior that only made sense for the old local code/file path

## OpenAI request flow

## Web search

1. user enables `Web Search`
2. client sends `ephemeralAgent.web_search = true`
3. server detects OpenAI/Azure native capability
4. LibreChat enables the Responses API path if needed
5. server adds the OpenAI-native web-search tool descriptor
6. for OpenAI/Azure hosted Responses web search, `packages/api/src/endpoints/openai/llm.ts` adds `max_tool_calls = 6` by default and clamps configured overrides to `12`, preventing an endlessly searching reasoning turn from blocking its final answer
7. when OpenAI sends multiple completed reasoning summaries for one THINK slot, the client preserves the live boundary and `config/apply-runtime-patches.js` patches `@librechat/agents` aggregation so the persisted/reloaded message preserves the same paragraph break
8. `local-services/verify-openai-reasoning-preservation.sh` fail-closes production promotion and health verification if the bound, either separator layer, its mandatory regression coverage, or the deployed stable runtime is missing

## Code interpreter

1. user enables `Code Interpreter`
2. client sends `ephemeralAgent.execute_code = true`
3. server detects OpenAI/Azure native capability
4. if files are present, LibreChat ensures those files have OpenAI file IDs
5. server adds an OpenAI `code_interpreter` tool descriptor

## File search

1. user enables `File Search`
2. user uploads file(s) marked with `native_tool = file_search`
3. LibreChat stores the files locally
4. server mirrors files to OpenAI Files API as needed
5. server creates or reuses vector store IDs
6. server adds an OpenAI `file_search` tool descriptor
7. message assembly avoids duplicating those files into local prompt context

## Gemini request flow

## Web search

1. user enables `Web Search`
2. client sends `ephemeralAgent.web_search = true`
3. server checks for tool conflicts
4. if safe, LibreChat adds Gemini `googleSearch`
5. otherwise LibreChat falls back to the prior structured path

## Code execution

1. user enables `Code Interpreter`
2. client sends `ephemeralAgent.execute_code = true`
3. server checks for Gemini-native compatibility and conflicts
4. if safe, LibreChat adds Gemini `codeExecution`
5. otherwise LibreChat falls back to the prior structured path

## Anthropic request flow

## Live model discovery and capability metadata

1. server refreshes Anthropic models from Anthropic's live models endpoint
2. model names are normalized into Claude family/version metadata
3. capability metadata is derived for thinking mode, effort, prompt caching, web search, web fetch, fast mode, code execution, advisor, and token limits
4. startup config exposes the capability map so the client can render the Anthropic picker and parameter panels correctly
5. Anthropic quick-select entries are sorted dynamically so newer/higher-tier Claude models stay at the top without hardcoded lists

## Web search

1. user enables `Web Search`
2. client sends `ephemeralAgent.web_search = true`
3. server confirms the selected Claude model supports native web search
4. LibreChat adds Anthropic's native web search tool descriptor

## Code interpreter

1. user enables `Code Interpreter`
2. user chooses `LibreChat` or `Anthropic native`
3. client sends `ephemeralAgent.execute_code = true`
4. if Anthropic native is chosen, client also sends `ephemeralAgent.execute_code_mode = provider_native`
5. server checks model capability metadata and local attachments
6. if there are no local code files attached, LibreChat adds Anthropic-native code execution
7. if local code files are attached, LibreChat falls back to the existing local code interpreter while preserving the local upload workflow

## Direct sidebar tools

1. user enables direct Anthropic model-parameter controls in the sidebar
2. client persists those values on the conversation model options
3. `getLLMConfig` extracts the sidebar-only fields before serializing standard Anthropic options
4. model and provider capability checks decide whether each requested feature becomes an Anthropic request field/tool descriptor
5. unsupported combinations warn and skip the tool, preserving a valid request instead of crashing the chat

## Anthropic parameter gating

Anthropic parameter rendering is capability-aware in both the chat sidebar and the agent-builder model panel.

Important behaviors:

- newer adaptive-thinking models disable fixed `Thinking Budget` and expose `Effort`
- legacy fixed-budget models enable `Thinking Budget` and disable adaptive `Effort`
- when Anthropic `thinking` is on, temperature/top_p/top_k are disabled
- if the conversation has not yet stored an explicit `thinking` boolean, gating must use the parameter definition default to avoid a checked `Thinking` toggle with mismatched dependent controls
- fast mode is only enabled for supported Opus models on the direct Anthropic endpoint
- web fetch and advisor are only enabled for Claude models whose inferred capability metadata supports those direct server tools
- hosted code execution is only enabled for supported Claude models; local-file code-interpreter uploads still use the local fallback path
- memory, bash, computer-use, and text-editor Anthropic client tools remain out of scope until LibreChat implements an executor/sandbox/result-continuation loop

## Fallback strategy

Fallbacks were designed to be conservative.

LibreChat only strips/rewrites tool behavior when native routing is considered safe.

If there is a likely conflict, the implementation prefers the previous behavior over a risky partial-native request.

That is especially important for Gemini, where mixed native + structured tool combinations are more constrained.

## Client-side verification findings

Local browser verification found one final issue after the server implementation was already complete:

- the client still showed LibreChat search/code auth flows for native-capable endpoints

This was fixed by making the UI aware of native endpoint capabilities.

After that fix, browser verification confirmed:

- OpenAI search badge toggles directly and sends `ephemeralAgent.web_search = true`
- OpenAI code badge toggles directly and sends `ephemeralAgent.execute_code = true`
- OpenAI file search badge toggles directly and sends `ephemeralAgent.file_search = true`
- OpenAI native file-search uploads send `native_tool = file_search`
- Gemini search and code toggles can be clicked directly without LibreChat auth dialogs
- Anthropic model quick selects are populated from the live models endpoint and remain permission-filtered for regular users
- Anthropic tools expose both local and provider-native code-execution modes
- Anthropic parameter panels render adaptive-effort vs fixed-budget controls according to the selected Claude model family

## Validation and test coverage

## Automated tests

Added or updated tests include:

- `packages/data-provider/src/anthropic.spec.ts`
- `packages/api/src/agents/nativeTools.spec.ts`
- `packages/api/src/endpoints/models.spec.ts`
- `packages/data-schemas/src/methods/file.spec.ts`
- `api/server/services/Files/process.spec.js`
- `api/server/controllers/ModelController.spec.js`
- `api/server/routes/__tests__/config.spec.js`
- `api/server/routes/__tests__/configModelSpecs.spec.js`
- `api/server/services/ScheduledJobs/ScheduledJobsController.spec.js`
- `client/src/utils/endpoints.spec.ts`

These cover:

- Anthropic model normalization, sorting, and capability inference
- native tool selection logic
- Anthropic config/model refresh behavior
- Anthropic scheduled-run mode persistence
- native file metadata query behavior
- native upload routing behavior
- client endpoint-native capability detection

## Commands run during validation

Representative validation commands that were run during implementation and follow-up UI fixes:

```bash
npm --prefix "/pool/home/timeng/LibreChat/client" run test:ci -- --runTestsByPath src/utils/endpoints.spec.ts
npm --prefix "/pool/home/timeng/LibreChat/client" run typecheck
cd "/pool/home/timeng/LibreChat" && ./node_modules/.bin/eslint "client/src/Providers/BadgeRowContext.tsx" "client/src/components/Chat/Input/ToolsDropdown.tsx" "client/src/utils/endpoints.ts" "client/src/utils/endpoints.spec.ts"
npm --prefix "/pool/home/timeng/LibreChat/client" run build
cd "/pool/home/timeng/LibreChat" && docker compose up -d --build api
```

## Notable runtime observation

OpenAI returned the following during a real native code-interpreter test:

`400 Code interpreter tool cannot be used for this organization due to Zero Data Retention`

This is useful engineering evidence because it shows the request reached the OpenAI-native tool path rather than staying on the old LibreChat-managed path.

Anthropic returned a missing-key error during live validation, which was expected in the dev rail because no Anthropic API key was configured. The important engineering evidence was the request payload itself:

- `endpoint = anthropic`
- `model = claude-sonnet-4-6`
- `ephemeralAgent.execute_code = true`
- `ephemeralAgent.execute_code_mode = provider_native`

That confirmed the Anthropic-native routing path was active even though the provider call was rejected for missing credentials.

## Verified upload payload

During a real native file-search upload test, the multipart payload included:

```text
endpoint = openAI
tool_resource = file_search
native_tool = file_search
agent_id = openAI__gpt-5.1
```

That confirms the client/server upload path is correctly tagging native file-search uploads.

## Out-of-scope / not implemented here

- Gemini native file search
- a complete migration of every saved-agent tool configuration to provider-native tools
- universal native-tool routing for every provider in the app
- provider-level entitlement fixes such as OpenAI organization restrictions

## Related docs

- [./OPENAI_GEMINI_NATIVE_TOOLS.md](./OPENAI_GEMINI_NATIVE_TOOLS.md)
- [./OLLAMA_WEB_SEARCH.md](./OLLAMA_WEB_SEARCH.md)
- [./OLLAMA_REASONING.md](./OLLAMA_REASONING.md)
