# OpenAI, Gemini, and Anthropic Native Chat-Bar Tools

LibreChat now routes the chat-bar tool toggles to provider-native capabilities whenever the selected provider can handle them directly.

This change applies to the ephemeral model-chat flow driven by the chat input badges and tools menu. The goal is to preserve the existing LibreChat UI while letting supported providers execute their own built-in tools instead of always going through LibreChat's structured tool layer.

For implementation details and touched files, see [./OPENAI_GEMINI_NATIVE_TOOLS_IMPLEMENTATION.md](./OPENAI_GEMINI_NATIVE_TOOLS_IMPLEMENTATION.md).

## Why this exists

Before this change, the chat-bar toggles for `Web Search`, `Code Interpreter`, and `File Search` were primarily wired around LibreChat-managed tools.

Now, when the selected provider supports equivalent first-party tooling, LibreChat:

- keeps the same toggle UX in the chat bar
- sends the toggle state as part of the ephemeral chat configuration
- converts that toggle state into provider-native tool descriptors on the server
- avoids duplicating local RAG or file context when the provider is already handling those files natively

That gives OpenAI, Gemini, and Anthropic chats a more native tool path while preserving the rest of the app's behavior.

## Support matrix

| Provider        | Web Search     | Code Interpreter | File Search                   | Notes                                                                                                                              |
| --------------- | -------------- | ---------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI          | Native         | Native           | Native                        | Uses Responses API tools                                                                                                           |
| Azure OpenAI    | Native         | Native           | Native                        | Uses the same OpenAI-native tool path where supported by configuration                                                             |
| Google / Gemini | Native         | Native           | Not native                    | `file_search` remains a LibreChat-managed capability for Google                                                                    |
| Anthropic       | Native         | Native or local  | Local upload + local fallback | Chat-bar web search and `execute_code` route natively when supported; sidebar also exposes supported direct Anthropic server tools |
| Ollama          | Separate path  | Separate path    | N/A                           | See [./OLLAMA_WEB_SEARCH.md](./OLLAMA_WEB_SEARCH.md)                                                                               |
| Other providers | LibreChat path | LibreChat path   | LibreChat path                | No change                                                                                                                          |

## User-facing behavior

## Chat-bar toggles

For supported OpenAI, Azure OpenAI, Google, and Anthropic chats:

- `Web Search` can be turned on directly from the pinned badge or tools dropdown
- `Code Interpreter` can be turned on directly from the pinned badge or tools dropdown
- `File Search` can be turned on directly for OpenAI / Azure OpenAI chats
- Anthropic chats expose a code-interpreter mode selector so users can choose between the local LibreChat interpreter and Anthropic-native `execute_code`

The client now avoids showing LibreChat-specific auth/settings dialogs when the selected provider is expected to handle the capability natively.

That means:

- OpenAI/Azure `Web Search` no longer depends on LibreChat web-search provider auth
- OpenAI/Azure `Code Interpreter` no longer depends on LibreChat code-interpreter auth
- Gemini `Web Search` and `Code Interpreter` toggles can be enabled directly from the chat bar
- Anthropic `Web Search` can be enabled directly from the chat bar
- Anthropic `Code Interpreter` can be enabled directly from the chat bar while still preserving local file upload handling
- Anthropic model-parameter sidebar can enable direct provider features for supported direct Anthropic API models: fast mode, web fetch with citations, hosted code execution, advisor, and advisor model selection

## What gets sent from the client

When a toggle is enabled, the client includes the ephemeral tool state in the chat request.

Examples captured during live verification:

- OpenAI web search request included `ephemeralAgent.web_search = true`
- OpenAI code interpreter request included `ephemeralAgent.execute_code = true`
- OpenAI file search request included `ephemeralAgent.file_search = true`
- Anthropic native code execution request included `ephemeralAgent.execute_code = true` plus `ephemeralAgent.execute_code_mode = provider_native`

LibreChat then decides on the server whether that ephemeral tool state should become a provider-native tool call, a LibreChat structured tool, or a fallback path. For OpenAI and Anthropic, that decision is model-aware: native web search/code execution is only selected when the selected model capability metadata allows that tool.

## OpenAI / Azure OpenAI behavior

## Native mapping

For OpenAI and Azure OpenAI model chats:

- `web_search` maps to the OpenAI Responses API web-search tool
- `execute_code` maps to the OpenAI `code_interpreter` tool
- `file_search` maps to OpenAI Files + Vector Stores

When OpenAI-native web search is enabled, LibreChat automatically enables the Responses API path where needed. If the selected OpenAI/Azure model is not a search-capable model, the web-search toggle stays on the existing structured-tool path instead of sending an unsupported Responses native tool.

For OpenAI/Azure hosted Responses web search, `packages/api/src/endpoints/openai/llm.ts` sets `max_tool_calls` to `6` by default and clamps any configured override to `12`. This is a production safety invariant: native-search reasoning may stream multiple separate thought summaries, but it must still terminate and return a final answer instead of searching indefinitely.

Azure OpenAI / Foundry deployments are classified by model family before native
tool selection:

- GPT and Chat Latest deployments such as `chat-latest`, `gpt-chat-latest`,
  `gpt-4.1-mini`, `gpt-4o`, `gpt-5.4`, `gpt-5.4-pro`,
  `gpt-5.4-mini`, and `gpt-5.4-nano` can use OpenAI/Azure native
  Responses web search when selected.
- Azure-hosted non-OpenAI chat deployments such as `DeepSeek-V3.1`,
  `DeepSeek-V4-Flash`, `grok-4-*`, `Phi-4`, `Phi-4-reasoning`,
  `Mistral-Large-3`, plus `codex-mini` and `gpt-oss-120b`, keep streaming chat
  settings but do not get OpenAI-native Responses web search/code/file tools.
  Their chat-bar web search and code execution remain on the LibreChat
  structured/local fallback path when available.
- Embedding deployments such as `text-embedding-3-small` are marked
  non-chat/non-streaming for chat parameter and native-tool toggles.

Native OpenAI model discovery normalizes `/v1/models` for the text-chat picker before these tool decisions run: exactly one Chat Latest candidate is kept with priority `chat-latest` -> `gpt-chat-latest` -> highest-version `gpt-*-chat-latest`, current chat-capable GPT/o-series models are kept, non-chat families and dated snapshots are hidden, and `-alpha` models are only visible to admins under a separate OpenAI alpha subgroup. Azure deployments and OpenAI reverse proxies keep their configured catalog ids because those names are operator-controlled.

## Reasoning summary display

OpenAI/Azure reasoning summary items may arrive separately while sharing one THINK content slot, including Markdown-headed items such as `**Searching for sources**`. Both accumulation layers must preserve that structure: the client applies separator-aware merging to live SSE updates, and the `@librechat/agents` runtime patch applies the same boundary rule when persisting completed content for reloads. The client utility remains dependency-free so it does not introduce a rendering-module dependency during authenticated chat startup; the runtime patch is protected by `api/server/services/Config/applyRuntimePatches.spec.js`.

### Mandatory preservation invariant

<!-- OPENAI_REASONING_PRESERVATION_INVARIANT: DO_NOT_REMOVE -->

This is a fail-closed production invariant, not an optional presentation tweak. The following protections must remain together through merges, dependency refreshes, builds, hot promotions, and image rebuilds:

- `packages/api/src/endpoints/openai/llm.ts` bounds OpenAI/Azure hosted Responses web search with `max_tool_calls` (`6` default, `12` maximum) so a turn returns a final answer.
- `client/src/utils/mergeThinkingText.ts` and its SSE callers preserve separate reasoning items while the message is streaming in the browser.
- `config/apply-runtime-patches.js` patches `@librechat/agents` source/CJS/ESM aggregators so saved and reloaded conversations preserve the same boundaries, including Markdown-headed summaries.
- Regression tests in `packages/api/src/endpoints/openai/llm.spec.ts` and `api/server/services/Config/applyRuntimePatches.spec.js` are mandatory preservation tests and must not be deleted as conflict cleanup.

Run `npm run verify:openai-reasoning-preservation` before any deployment touching OpenAI reasoning, web search, runtime patches, or frontend thought rendering. After an explicitly approved VM stable change, run `ssh timeng@192.168.50.104 'cd /opt/LibreChat-custom && ./local-services/verify-openai-reasoning-preservation.sh --container LibreChat'`. Stable startup, stable frontend promotion, and `local-services/health-check.sh` invoke this verifier automatically; when stable is running, they additionally inspect the deployed API container and fail if either completion bounds or persisted reasoning separators have disappeared.

Deployment guardrail: this reasoning behavior is served from compiled frontend assets at runtime. Never deploy a reasoning fix by copying `client/src` alone or by hand-patching hashed files in `client/dist/assets`, `client/dist/index.html`, or `client/dist/sw.js`. Build a complete client dist tree and deploy it only through `local-services/deploy-built-client-dist.sh`, which verifies the build manifest, promotes the whole artifact tree, and rolls back failed health checks.

## File lifecycle for OpenAI-native tools

Files uploaded from the chat bar for native OpenAI tool use follow this model:

1. the file is uploaded to LibreChat through the normal file endpoint
2. LibreChat stores the file in its configured storage backend
3. the upload is marked with native tool metadata such as `native_tool = file_search` or `native_tool = execute_code`
4. the file is mirrored to OpenAI only when the native tool actually needs it
5. the resulting OpenAI IDs are cached in LibreChat file metadata for reuse

Cached OpenAI metadata includes:

- endpoint
- model
- OpenAI file ID
- OpenAI vector store ID

This keeps LibreChat's own file tracking intact while letting OpenAI own the execution/search side when native tools are active.

## Duplicate-context avoidance

When a file is being used by an OpenAI-native tool, LibreChat intentionally avoids also injecting the same file into the prompt as ordinary file context.

That prevents:

- duplicated document context
- duplicated code file content
- unnecessary token consumption
- prompt contamination from both native tool handling and local RAG/file expansion happening at once

## Gemini / Google behavior

## Native mapping

For Google model chats:

- `web_search` maps to Gemini `googleSearch`
- `execute_code` maps to Gemini `codeExecution`

Gemini does not currently get the OpenAI-style native `file_search` path in this implementation.

## Gemini fallback rules

Gemini provider-native tooling cannot always be safely mixed with LibreChat-managed structured tools in the same request.

When LibreChat detects a conflict, it falls back to the existing structured-tool path rather than sending an invalid or brittle mixed request.

Important Gemini constraints in this implementation:

- native Gemini search/code is only used when the request can be expressed safely as provider-native tools
- if remaining structured tool conflicts exist, LibreChat falls back instead of forcing native mode
- Gemini native file search is not implemented here

## Anthropic behavior

## Native mapping

For Anthropic model chats:

- `web_search` maps to Anthropic's native web search tool when the selected Claude model supports it
- `execute_code` can map to Anthropic-native code execution when the chat is in `provider_native` mode
- multi-conversation added Claude responses must carry their own initialized runtime tool context, so selected web search/fetch and MCP tools are available to the side response and not only to the primary response
- uploaded files still go through LibreChat's normal `/api/files` flow and stay stored locally
- sidebar `fast_mode` maps to `speed: fast` plus Anthropic's fast-mode beta header on supported Opus models
- Anthropic web search uses `web_search_20250305` by default and switches to `web_search_20260209` only when Anthropic-native code execution is also active
- sidebar `web_fetch` adds `web_fetch_20250910` with citations enabled by default and switches to `web_fetch_20260209` only when Anthropic-native code execution is also active
- sidebar `anthropic_code_execution` adds `code_execution_20250825` with the Anthropic code-execution beta header
- sidebar `anthropic_advisor` adds `advisor_20260301` with the selected `anthropic_advisor_model`
- unsupported model/tool combinations, and Vertex Anthropic requests for direct-only features, are skipped with warnings instead of being sent as invalid provider payloads

Anthropic conversation replay also sanitizes malformed native-tool history:

- paired `server_tool_use` blocks for `web_search`, `web_fetch`, `code_execution`, and `advisor` are preserved only when their matching `*_tool_result` block is present and matches the same tool name; orphaned or mismatched server-tool blocks are dropped before the next Claude request so Anthropic does not reject the turn
- incomplete signed `thinking` blocks from interrupted or cancelled Claude streams are dropped unless they contain non-empty `thinking` and `signature` fields, preventing Anthropic `messages.*.content.*.thinking.thinking: Field required` request failures while preserving valid signed thinking blocks exactly

## Anthropic sidebar server tools

The Anthropic sidebar controls are request-construction controls for the direct Anthropic endpoint, not replacements for the chat-bar tools menu.

Supported sidebar controls:

- `Fast mode`: direct Anthropic API only, supported Opus models only
- `Web search`: existing native web-search server tool
- `Web fetch`: direct Anthropic API only, with provider citations requested
- `Code execution`: direct Anthropic hosted code execution server tool, separate from the chat-bar local-vs-native code-interpreter mode
- `Advisor`: direct Anthropic advisor server tool with an explicit advisor model selector

The Anthropic docs also describe client-side tools such as memory, bash, computer use, and text editor. LibreChat intentionally does not expose those as sidebar toggles yet. They require a real client executor, sandboxing/approval policy, durable error display, and tool-result continuation loop. Showing them before that infrastructure exists would create requests that can pause on unhandled `tool_use` blocks or crash the user flow.

Do not change normal Anthropic web search/fetch to the dynamic filtering descriptors unless code execution is also selected. The dynamic descriptors are paired with hosted code execution; using them as the default web-search/fetch request shape can produce provider requests where Claude correctly reports that no web-search/fetch tool is available.

Search-result content blocks are also not a generic sidebar switch. LibreChat can preserve provider web-search/web-fetch result blocks, and web fetch requests ask for citations, but user-supplied `search_result` content belongs in a retrieval/message-content pipeline rather than a provider parameter toggle.

## Anthropic code-interpreter mode selection

Anthropic chats expose two code-execution modes:

- `LibreChat` uses the existing local LibreChat code interpreter
- `Anthropic native` sends `execute_code` to Anthropic when the selected Claude model supports it

The mode is persisted per new-chat context so the Anthropic picker behaves similarly to the OpenAI tool flow while still letting users explicitly stay on the local interpreter.

## Anthropic local-file fallback

Anthropic-native code execution is intentionally conservative around local files.

If a user uploads a local code file for code interpreter use:

1. the file is uploaded to LibreChat through the normal file endpoint
2. the file remains tracked as a local LibreChat upload
3. the chat can still be in `provider_native` mode
4. server-side tool selection falls back to the local LibreChat code interpreter instead of sending that local code file to Anthropic-native execution

This keeps Anthropic chats compatible with the existing local upload workflow while still allowing native execution for fileless code runs.

## Scope

This feature currently targets the ephemeral chat-bar tool flow.

Included:

- pinned badges in the chat bar
- tools dropdown toggles for model chats
- ephemeral chat configuration sent with a conversation turn

Not the focus of this change:

- unrelated providers
- full replacement of all LibreChat tools everywhere
- blanket changes to saved-agent tool semantics outside the same ephemeral flow

Saved agents keep their prior behavior unless they are going through the same ephemeral model-chat routing path that now supports native tools.

## Storage and metadata model

LibreChat now stores native tool routing hints on uploaded files so later request processing can tell whether a file belongs to a native tool flow.

Relevant metadata concepts:

- `metadata.nativeTool`
- `metadata.openai.endpoint`
- `metadata.openai.model`
- `metadata.openai.fileId`
- `metadata.openai.vectorStoreId`

These values allow LibreChat to:

- distinguish native-tool files from ordinary files
- reuse previously mirrored OpenAI resources
- avoid duplicate context extraction
- query native file-search and native code files correctly from the database

## Upload routing behavior

For OpenAI-native file uploads from the client:

- the client sends the ordinary `tool_resource`
- the client also sends `native_tool`
- the server stores the file as a native-tool upload
- LibreChat skips the old vectorization / code-sandbox upload path for those native files
- for local LibreChat code-interpreter uploads, `tool_resource=execute_code` is the explicit raw-file route; those uploads bypass MIME allowlists but still keep size, empty-file, file-id, and permission checks
- the chat-bar attach menu and drag/drop modal show Code Interpreter as an upload destination for ephemeral chats based on Code Interpreter capability, not on whether the toggle was already enabled; selecting it enables the tool and sends arbitrary raw files such as `.wav` with `tool_resource=execute_code`
- audio/video uploads are destination-specific: the same `.wav` can remain a normal attachment for explicit transcription or be routed to Code Interpreter for sandbox analysis
- completed uploads keep the route metadata in compose state, and the inline transcription bar excludes Code Interpreter-routed audio/video so sending the message preserves the raw file attachment path unless the user explicitly clicks Transcribe

Captured multipart upload verification showed:

- `tool_resource = file_search`
- `native_tool = file_search`
- `agent_id = openAI__gpt-5.1`

## Validation summary

The implementation was verified with unit tests, type checking, builds, Docker rebuilds, and live browser testing.

Validated items include:

- metadata schema support for native tool files
- server-side native tool selection logic
- upload routing for native `file_search` and `execute_code`
- client-side toggle UX for OpenAI and Gemini
- Anthropic live quick-select model discovery and ordering
- Anthropic code-execution mode persistence and request payload shaping
- Anthropic local file upload staying on LibreChat storage while native mode remains selectable
- live OpenAI request payloads containing the expected ephemeral tool flags
- live file upload payloads containing `native_tool`

## Live behavior observed during verification

### OpenAI `gpt-5.1`

- Search toggle enabled directly from the badge without a LibreChat auth dialog
- Code Interpreter toggle enabled directly from the badge without a LibreChat auth dialog
- File Search toggle enabled directly from the badge
- chat requests carried the expected ephemeral tool state

### Google `gemini-2.5-flash-lite`

- Search toggle enabled directly without a LibreChat auth dialog
- Code Interpreter toggle enabled directly without a LibreChat auth dialog

### Anthropic `claude-sonnet-4-6` / `claude-sonnet-4-5`

- Anthropic quick-select entries were populated from the live models endpoint and sorted with newest/highest-tier Claude models first
- regular-user model access restrictions still filtered Anthropic quick selects correctly
- the tools menu exposed both `LibreChat` and `Anthropic native` code-interpreter modes
- Anthropic chat requests carried `ephemeralAgent.execute_code_mode = provider_native` when native mode was selected
- local code-file upload still posted to `/api/files` and remained a LibreChat-managed file attachment

### OpenAI organization limitation discovered during live verification

During a real OpenAI code-interpreter request, OpenAI returned:

`400 Code interpreter tool cannot be used for this organization due to Zero Data Retention`

That error is important because it confirms LibreChat was actually attempting the provider-native OpenAI code-interpreter path. In other words, the request reached OpenAI native tooling instead of staying on the old LibreChat-only execution path.

## Known limitations

- Gemini native file search is not implemented in this change
- Gemini native tools still need conflict checks before LibreChat can safely use them
- provider-level restrictions can still block native tools even when LibreChat routing is correct
- this work is focused on model-chat toggles, not every possible tool entry point in the system

## Operational notes

- If OpenAI native search is enabled from the chat bar, LibreChat will force the request onto the Responses API path when needed
- Native-tool files remain stored in LibreChat even when mirrored to OpenAI
- OpenAI file/vector-store IDs are reused to avoid redundant uploads when possible
- native-tool files are excluded from duplicate prompt context generation

## Related docs

- [./OPENAI_GEMINI_NATIVE_TOOLS_IMPLEMENTATION.md](./OPENAI_GEMINI_NATIVE_TOOLS_IMPLEMENTATION.md)
- [./OLLAMA_WEB_SEARCH.md](./OLLAMA_WEB_SEARCH.md)
- [./OLLAMA_REASONING.md](./OLLAMA_REASONING.md)
