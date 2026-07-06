# Deterministic Default Tools

## Purpose

LibreChat automatically attaches four local, credential-free structured tools to every interactive model request:

- `calculator` for exact arithmetic
- `text_analyzer` for exact text counts
- `string_utility` for literal string transforms, line operations, and cryptographic hashes
- `json_utility` for JSON validation, formatting, minification, and JSON Pointer lookup

They use the normal structured-tool execution pipeline, so calls and results appear in the chat timeline as tool invocations alongside MCP calls. The model still decides whether a tool is needed; attaching a tool does not force a call for unrelated prompts.

## Default behavior

All four tools are enabled when no database setting exists. This covers normal chats, which run through the ephemeral-agent path, and saved Agent chats because both use `packages/api/src/agents/initialize.ts`.

The tools are appended server-side and deduplicated against any explicitly selected tools. Models/providers without function-calling support cannot use them.

## Admin controls

Open **Admin Console -> Workspace settings -> Deterministic default tools**.

The controls persist under `AppSettings.deterministicTools`:

```json
{
  "calculator": true,
  "textAnalyzer": true,
  "stringUtility": true,
  "jsonUtility": true
}
```

Each tool can be disabled independently. Missing values normalize to `true` so existing installations receive the default tools without a migration.

## Text analyzer semantics

`text_analyzer` accepts the exact input text and returns JSON containing:

- `characters`: Unicode grapheme clusters when `Intl.Segmenter` is available; this is the user-perceived character count
- `code_points`: Unicode code points
- `utf16_code_units`: JavaScript string length
- `utf8_bytes`: UTF-8 byte length
- `words`: locale-segmented word-like tokens, with a non-whitespace fallback
- `sentences`: locale-segmented sentences, with punctuation-boundary fallback
- `lines`: CRLF, CR, or LF-delimited line count; empty text has zero lines
- `non_whitespace_characters`: Unicode code points that do not match whitespace

The tool has no network, filesystem, database, code-execution, or credential access.

## String utility operations

`string_utility` supports bounded, deterministic operations: literal substring counting and replacement, line sorting and de-duplication, whitespace normalization, Unicode-aware upper/lower casing, and SHA-256/SHA-512 hashing. It does not evaluate regular expressions or execute code.

## JSON utility operations

`json_utility` supports bounded JSON validation, pretty formatting, minification, and RFC 6901 JSON Pointer lookup. It parses data only and does not execute embedded values or access external resources.

## Key files

- `packages/api/src/agents/initialize.ts`
- `api/app/clients/tools/structured/TextAnalyzer.js`
- `api/app/clients/tools/structured/StringUtility.js`
- `api/app/clients/tools/structured/JsonUtility.js`
- `api/app/clients/tools/manifest.json`
- `api/app/clients/tools/util/handleTools.js`
- `api/server/services/Admin/appSettings.js`
- `packages/data-schemas/src/schema/appSettings.ts`
- `packages/data-provider/src/admin.ts`
- `client/src/components/Admin/AdminConsole.tsx`

## Validation

Run the focused checks from the repository root:

```bash
cd api && npx jest --runInBand --testPathPatterns='app/clients/tools/structured/specs/(TextAnalyzer|StringUtility|JsonUtility).spec.js|server/services/Admin/appSettings.spec.js'
cd packages/data-provider && npx jest --runInBand --testPathPatterns='admin.spec.ts'
cd packages/api && npx jest --runInBand --testPathPatterns='agents/__tests__/initialize.test.ts'
cd client && npx jest --runInBand --coverage=false --testPathPatterns='components/Admin/__tests__/AdminConsole.test.tsx'
```

For rendered UI validation, use the dev rail only. Do not promote to VM stable without explicit approval.

## Merge preservation

- Keep the server-side injection in the shared agent initializer; a chat-bar-only default would miss saved Agents and other request surfaces.
- Keep missing settings defaulting to enabled in backend normalization, shared schemas, and the Admin Console form.
- Keep all four tools in both the manifest and runtime constructor map so they remain visible and executable after tool-cache refresh.
- Preserve structured-tool callbacks; they are what render deterministic calls in the same tool timeline used by MCP invocations.
