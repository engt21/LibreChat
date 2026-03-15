# OpenAI and Gemini Native Tools Implementation Notes

This document is the engineering companion to [./OPENAI_GEMINI_NATIVE_TOOLS.md](./OPENAI_GEMINI_NATIVE_TOOLS.md).

It focuses on how the feature was implemented, which files were changed, how the request flows work, and what was verified locally.

## Goals

The implementation set out to make the existing LibreChat chat-bar toggles use provider-native behavior where possible:

- OpenAI / Azure OpenAI `web_search`
- OpenAI / Azure OpenAI `execute_code`
- OpenAI / Azure OpenAI `file_search`
- Gemini `web_search`
- Gemini `execute_code`

At the same time, it needed to preserve existing LibreChat behavior when native routing was not available or not safe.

## High-level design

The implementation was split across four layers:

1. client toggle UX and upload metadata
2. agent initialization / tool selection
3. file metadata and persistence
4. message assembly / prompt-context suppression for native-tool files

The core design principle is:

> keep the existing LibreChat UI and request shape, but translate ephemeral chat-bar state into provider-native tools on the server.

## Files changed

## Client

- `client/src/Providers/BadgeRowContext.tsx`
- `client/src/components/Chat/Input/ToolsDropdown.tsx`
- `client/src/hooks/Files/useFileHandling.ts`
- `client/src/utils/endpoints.ts`
- `client/src/utils/endpoints.spec.ts`

## API / server

- `packages/api/src/agents/nativeTools.ts`
- `packages/api/src/agents/nativeTools.spec.ts`
- `packages/api/src/agents/initialize.ts`
- `packages/api/src/agents/resources.ts`
- `api/app/clients/BaseClient.js`
- `api/server/controllers/agents/client.js`
- `api/server/services/Endpoints/agents/initialize.js`
- `api/server/services/Endpoints/agents/addedConvo.js`
- `api/server/services/Files/process.js`
- `api/server/services/Files/process.spec.js`

## Data types / schema

- `packages/data-provider/src/types/files.ts`
- `packages/data-schemas/src/types/file.ts`
- `packages/data-schemas/src/schema/file.ts`
- `packages/data-schemas/src/methods/file.ts`
- `packages/data-schemas/src/methods/file.spec.ts`

## Core server module

## `packages/api/src/agents/nativeTools.ts`

This is the main orchestration layer for provider-native tool selection.

It is responsible for:

- determining which ephemeral toggles can become native provider tools
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

## Badge row context

`client/src/Providers/BadgeRowContext.tsx` now exposes native-capability booleans to the input UI.

That matters because the client previously treated these toggles as if they always depended on LibreChat-specific auth/settings behavior.

After the change:

- OpenAI / Azure / Google native-capable chats can treat search/code as authenticated for toggle purposes
- LibreChat auth dialogs are only used when the endpoint actually depends on LibreChat-managed tooling
- Ollama still keeps its separate web-search mode behavior

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
- strips conflicting LibreChat structured tools from the runtime tool list
- injects OpenAI Responses API options when native search requires them
- passes native tool state forward so later message/file processing can recognize native files

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

## Validation and test coverage

## Automated tests

Added or updated tests include:

- `packages/api/src/agents/nativeTools.spec.ts`
- `packages/data-schemas/src/methods/file.spec.ts`
- `api/server/services/Files/process.spec.js`
- `client/src/utils/endpoints.spec.ts`

These cover:

- native tool selection logic
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
