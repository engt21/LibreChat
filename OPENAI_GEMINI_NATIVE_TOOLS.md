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

| Provider | Web Search | Code Interpreter | File Search | Notes |
| --- | --- | --- | --- | --- |
| OpenAI | Native | Native | Native | Uses Responses API tools |
| Azure OpenAI | Native | Native | Native | Uses the same OpenAI-native tool path where supported by configuration |
| Google / Gemini | Native | Native | Not native | `file_search` remains a LibreChat-managed capability for Google |
| Anthropic | Native | Native or local | Local upload + local fallback | Web search and `execute_code` route natively when supported; uploaded code files still live in LibreChat storage |
| Ollama | Separate path | Separate path | N/A | See [./OLLAMA_WEB_SEARCH.md](./OLLAMA_WEB_SEARCH.md) |
| Other providers | LibreChat path | LibreChat path | LibreChat path | No change |

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
- uploaded files still go through LibreChat's normal `/api/files` flow and stay stored locally

Anthropic conversation replay also sanitizes malformed native-tool history:

- paired `server_tool_use` + `web_search_tool_result` blocks are preserved, but orphaned web-search server-tool blocks are dropped before the next Claude request so Anthropic does not reject the turn
- incomplete signed `thinking` blocks from interrupted or cancelled Claude streams are dropped unless they contain non-empty `thinking` and `signature` fields, preventing Anthropic `messages.*.content.*.thinking.thinking: Field required` request failures while preserving valid signed thinking blocks exactly

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
