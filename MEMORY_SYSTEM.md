# LibreChat Memory System

This document is the source-of-truth guide for the customized LibreChat user-memory system in
this repository. It covers intent detection, prompt construction, execution timing, model and
provider selection, storage, provenance, audit records, administrator controls, user-visible
artifacts, testing, deployment, and rollback.

## Goals

The customization is designed to make memory behavior predictable:

- Ordinary research, search, tool-use, formatting, and document-generation requests must not be
  saved merely because they contain durable-looking nouns or instructions.
- Explicit requests such as "remember this", "save this to memory", and "forget my old address"
  should reliably invoke the memory worker.
- A request that depends on research or tools should be processed after the main assistant run so
  the saved value can use the completed answer and tool results.
- Model-generated keys must be normalized and validated before reaching MongoDB.
- Per-value and total-storage limits must be enforced consistently for automatic and manual edits.
- Every automatic mutation should carry source provenance, and optional audit records should make
  rejected, failed, and no-action turns diagnosable.
- Administrators should be able to tune policy without editing runtime YAML or rebuilding images.

## Non-goals

- Memory is not a transcript store, task queue, research log, or general tool-call history.
- The memory worker does not independently browse, search, or repeat the user's primary task.
- The intent detector does not infer consent from a fact merely being personal or reusable.
- Audit events are operational diagnostics, not a second permanent memory system.

## Default behavior

The effective default policy is:

| Setting                       | Default                                         |
| ----------------------------- | ----------------------------------------------- |
| Automatic mutations           | Enabled                                         |
| Memory provider               | `openAI`                                        |
| Memory model                  | `gpt-5.6-terra`                                 |
| Explicit request required     | Yes                                             |
| Processing time               | After the main response                         |
| Assistant/tool result context | Included                                        |
| Recent message window         | 5 messages                                      |
| Combined context bound        | 24,000 characters                               |
| Maximum mutations per turn    | 1                                               |
| Worker attempts               | 2 from the Admin Console; library fallback is 1 |
| Processing wait timeout       | 10,000 ms                                       |
| Total saved-memory limit      | 6,000 tokens                                    |
| Per-memory limit              | 500 tokens and 4,000 characters                 |
| Related-memory consolidation  | Enabled                                         |
| Audit events                  | Enabled, 90-day TTL                             |
| Allowed key list              | Unrestricted after server normalization         |

The runtime still requires a top-level `memory:` section in `librechat.yaml`. That section enables
memory retrieval and provides a YAML fallback. The Admin Console policy is database-backed and
overrides most worker behavior.

## Architecture

### Components

| Layer                | Responsibility                                                                                                                            | Main files                                                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime feature gate | Enables memory and provides YAML fallback settings                                                                                        | `librechat.yaml`, `librechat.example.yaml`                                                                                           |
| Admin policy         | Stores and normalizes global memory controls                                                                                              | `packages/data-provider/src/admin.ts`, `packages/data-schemas/src/schema/appSettings.ts`, `api/server/services/Admin/appSettings.js` |
| Intent gate          | Classifies the current user turn as save, delete, or none                                                                                 | `packages/api/src/agents/memoryPolicy.ts`                                                                                            |
| Agent orchestration  | Loads existing memories, runs the primary agent, then schedules memory extraction                                                         | `api/server/controllers/agents/client.js`                                                                                            |
| Memory worker        | Builds the mutation prompt, invokes the configured model (default `gpt-5.6-terra`), exposes only the applicable tool, and enforces limits | `packages/api/src/agents/memory.ts`                                                                                                  |
| Persistence          | Upserts/deletes memory values and formats memories for prompt injection                                                                   | `packages/data-schemas/src/methods/memory.ts`                                                                                        |
| Provenance and audit | Stores mutation source fields and bounded operational events                                                                              | `packages/data-schemas/src/schema/memory.ts`, `packages/data-schemas/src/schema/memoryEvent.ts`                                      |
| Manual user editing  | Applies the same key, character, and token policy to settings-page edits                                                                  | `api/server/routes/memories.js`                                                                                                      |
| Admin UI             | Exposes global policy controls                                                                                                            | `client/src/components/Admin/MemorySystemSettings.tsx`, `client/src/components/Admin/AdminConsole.tsx`                               |

### Request lifecycle

1. The Agents request middleware loads effective application settings into `req.appSettings`.
2. `AgentClient.useMemory()` verifies the user's memory permission and the YAML `memory:` feature
   gate.
3. Existing saved values are loaded for injection into the primary agent regardless of whether the
   current turn is eligible for a mutation.
4. `detectMemoryIntent()` examines only the current user text plus administrator-defined intent
   phrases. It returns `save`, `delete`, or `none`, along with the matched evidence phrase.
5. When automatic mutations are disabled or no explicit intent is found, no memory model is called.
   Existing memories remain available to the primary assistant.
6. The primary agent executes normally, including MCP and native tool calls.
7. With the default post-response setting, the completed assistant content parts and tool
   arguments/results are converted to bounded text. Thinking/reasoning blocks are excluded.
8. The recent chat window and completed-response context are combined into one memory-worker user
   message, bounded by `contextCharLimit`.
9. `createMemoryProcessor()` loads existing key/value context and token counts, prepares the
   worker instructions, and calls `processMemory()`.
10. The worker receives only `set_memory` for save intent or only `delete_memory` for delete intent.
11. The server normalizes the requested key, validates limits, writes MongoDB, records provenance,
    optionally writes an audit event, and emits a memory attachment for the response UI.
12. The main request waits up to `processingTimeoutMs` for the memory result. A timeout does not fail
    the user's primary response.

### Why processing occurs after the response

The original pre-response design could see the user's request and prior messages but not the answer
being generated for the current turn. This made requests such as "research the schedule, then save
it to memory" unreliable: the worker ran before research results existed. Post-response processing
lets the worker use completed tool output while keeping the primary answer latency isolated behind a
bounded final wait.

Administrators can restore pre-response behavior with `processAfterResponse = false`, primarily for
rollback or compatibility testing. Pre-response mode cannot reliably save facts discovered during
the same turn.

## Intent policy

### Save examples

The default detector recognizes direct, imperative memory consent, including:

- `Remember that Barbara Yahr is the music director of GVO.`
- `Save this to memory.`
- `Update my memories with the full workshop schedule.`
- `Store this for future conversations.`
- `Make sure all this information is in memory.`
- `Don't forget that I prefer HTML email formatting.`
- `Research the venue, then save the confirmed address to memory.`

### Delete examples

- `Forget my old hotel preference.`
- `Delete the memory about the 2025 workshop.`
- `Remove my old address from memory.`

### Non-memory examples

These must not invoke the memory model under the default explicit policy:

- `Use the YouTube MCP to thoroughly search all these recordings.`
- `Search archived pages for this information.`
- `Use code interpreter to create the letter as a Word document.`
- `I'm trying to remember a science-fiction book title.`
- `Check the original PDF and provide accurate feedback.`

The distinction is consent to mutate saved user memory, not whether the text contains the word
"remember" or could be useful later.

### Administrator-defined phrases

`customIntentPhrases` adds organization-specific save triggers. Matches are case-insensitive. Keep
phrases explicit and uncommon, for example `pin this for future chats`. Broad phrases such as
`important` or `keep` will increase false positives.

Setting `requireExplicitRequest` to false restores model-driven mutation attempts for otherwise
unclassified turns. This is intentionally available for compatibility but is not recommended.

## Memory worker prompt

The default worker prompt is generated in `packages/api/src/agents/memory.ts` and versioned as
`explicit-post-response-v1`. Its contract is:

- The application has already confirmed explicit memory intent.
- Perform only the requested memory mutation.
- Do not answer or repeat the user's unrelated task.
- Never save one-off research instructions, tool instructions, search queries, temporary plans,
  generated documents, or transient conversation state unless the user explicitly requested that
  exact information be retained.
- Use `set_memory` for additions and updates; use `delete_memory` only for explicit deletion.
- Use completed assistant/tool context as the source of truth when the request depended on research.
- Produce lowercase snake-case keys matching `^[a-z_]+$`.
- Consolidate related facts when the administrator enables consolidation.
- Respect configured allowed keys and storage limits.

Administrators may replace the prompt using the advanced `instructions` field. A custom prompt is
powerful but can weaken false-positive protections. The server-side intent gate, key normalization,
write count, and storage limits remain enforced even when the prompt is overridden.

## Model and provider

The default memory model is `gpt-5.6-terra`, replacing the earlier `gpt-4.1-mini` and interim
`gpt-5.4-mini` defaults. The provider identifier is
`openAI`, matching LibreChat's case-sensitive `EModelEndpoint` value.

For GPT-5-family models the memory worker removes `temperature`. If `maxTokens` is configured, it is
translated to `max_completion_tokens` for Chat Completions or `max_output_tokens` when the Responses
API is selected. Streaming is always disabled for the memory worker.

Provider and model are selected in the Admin Console from LibreChat's existing `/api/models`
inventory for the signed-in administrator. That response already reflects the administrator's
effective provider/model access, including configured credentials and model-access policy. A saved
provider/model that is no longer available remains visible as `configured, unavailable` so an
administrator can diagnose or replace it. The memory worker does not bypass provider access,
credential, endpoint, or model-availability rules at execution time.

A live comparison on July 5, 2026 tested `gpt-5.4-mini` and `gpt-5.6-terra` against the exact
YouTube one-off false-positive case, the Barbara Yahr explicit-save case, a research-then-save case,
and a non-memory recall question. Both models classified all four correctly and produced valid
snake-case keys. Terra took approximately 1.3-1.7 seconds in that small sample versus approximately
0.6-1.5 seconds for 5.4-mini, and was selected as the new default for its replacement-model role.

## Key handling

Model-generated keys are normalized on the server before validation or persistence:

- Convert to lowercase.
- Replace spaces and punctuation with underscores.
- Collapse repeated underscores.
- Remove leading and trailing underscores.
- Reject an empty result.

For example, `Music Director / GVO` becomes `music_director_gvo`.

If `validKeys` is non-empty, the normalized automatic key and exact trimmed manual key must be in
that list. Allowed keys must themselves be lowercase snake case. An empty list permits dynamic
normalized keys.

## Storage and limits

### Memory entries

Memory values are stored in the `MemoryEntry` collection, one document per user and key. Automatic
updates are upserts. Manual rename is implemented as create-new then delete-old.

Limits are enforced before writes:

- `charLimit` bounds the stored string length.
- `maxValueTokens` bounds an individual value using the `o200k_base` tokenizer.
- `tokenLimit` bounds all values for the user.
- Replacement accounting subtracts the existing value's token count before adding the replacement,
  preventing false rejections when updating an existing key.
- `maxWritesPerTurn` bounds tool mutations from one memory-worker run.
- The safe default is one automatic mutation per turn, preventing a worker from refreshing several
  unrelated memory timestamps in response to one request. Administrators can raise the bound for a
  deliberate multi-key workflow.
- Re-saving an identical value/token count is a no-op: MongoDB is not updated, `updated_at` is
  preserved, and no client cache artifact assigns a fresh timestamp.

If the existing store is already over its total limit, new automatic values are rejected until the
user deletes or shortens memories. Deletion remains available.

### Provenance fields

Automatic entries can include:

- `source = automatic`
- `sourceConversationId`
- `sourceMessageId`
- `sourceResponseMessageId`
- `sourceModel`
- `promptVersion`
- `evidence`

Manual settings-page changes use `source = manual`. Provenance identifies the most recent writer of
the current key; it is not a full version history.

### Audit events

When `auditEnabled` is true, the `MemoryEvent` collection records:

- intent: save, delete, or none
- status: saved, deleted, rejected, failed, or no_action
- key when available
- source conversation and message identifiers
- worker model and prompt version
- matched intent evidence
- machine-readable rejection/failure reason

Events expire automatically after 90 days through a MongoDB TTL index. Audit failure is logged but
does not fail the primary response or the memory mutation.

## Admin Console

The Memory system card appears under Admin Console workspace settings. Saving the form invalidates
the application settings caches, so new requests use the updated policy without an image rebuild.

| Control                         | Effect                                         | Safe guidance                                                   |
| ------------------------------- | ---------------------------------------------- | --------------------------------------------------------------- |
| Automatic memory mutations      | Enables automatic save/delete worker calls     | Disable for emergency rollback while retaining memory retrieval |
| Require explicit memory request | Applies the deterministic consent gate         | Keep enabled                                                    |
| Process after response          | Includes facts discovered in the current run   | Keep enabled unless debugging compatibility                     |
| Include assistant/tool context  | Supplies completed response and tool results   | Keep enabled for research-then-save workflows                   |
| Consolidate related memories    | Encourages fewer, broader keys                 | Keep enabled unless strict fact separation is required          |
| Audit memory mutations          | Writes 90-day operational events               | Keep enabled unless retention policy requires otherwise         |
| Provider/model                  | Access-filtered picker for the signed-in admin | Default `openAI` / `gpt-5.6-terra`                              |
| Recent message window           | Number of recent chat messages supplied        | Raise cautiously; larger windows add cost and ambiguity         |
| Context character limit         | Bounds chat plus completed response context    | Must balance tool-result completeness and cost                  |
| Maximum writes per turn         | Bounds tool mutations                          | Default 1; raise only for deliberate multi-key requests         |
| Worker attempts                 | Retries when no successful mutation occurs     | 2 improves explicit-save reliability                            |
| Processing timeout              | Maximum final wait                             | Increase only if provider latency requires it                   |
| Total/per-value limits          | Bounds persistent memory size                  | Keep values small and durable                                   |
| Allowed keys                    | Optional memory taxonomy                       | Use for tightly governed deployments                            |
| Additional intent phrases       | Adds organization-specific save language       | Use explicit phrases only                                       |
| Advanced prompt override        | Replaces generated worker instructions         | Test carefully; server guardrails still apply                   |

## Configuration precedence

1. A missing or disabled YAML `memory:` section disables the feature.
2. Per-user permissions and personalization opt-out can disable use for that user.
3. Database-backed Admin Console values control automatic mutation policy and normally override the
   inline YAML agent's provider, model, and instructions.
4. Non-empty Admin Console `validKeys` overrides YAML `validKeys`; otherwise YAML remains the
   fallback.
5. Admin Console token and character limits take precedence, with YAML used as fallback where the
   administrator value is absent.
6. Existing saved memories are still retrieved when automatic mutations are disabled.

## User-visible behavior

Successful automatic saves and deletes emit memory attachments through the existing streaming
attachment channel. The main answer remains the primary response. A memory timeout or audit-write
failure is logged and does not replace the answer with an error.

Manual memory editing continues through the Personalization settings UI and `/api/memories` routes.
Manual create/update requests use the configured key, character, per-value token, and total-token
limits.

## Observability and troubleshooting

### Useful symptoms

| Symptom                          | Checks                                                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| One-off tasks are saved          | Confirm explicit policy is enabled; inspect custom phrases and prompt override; inspect `MemoryEvent.evidence`                                    |
| Explicit request is ignored      | Confirm automatic mutations, user permission, YAML feature gate, provider/model availability, timeout, and `MemoryEvent` no_action/failed records |
| Research result is missing       | Confirm post-response processing and assistant/tool context are enabled; raise context bound if a large tool result was truncated                 |
| Key is rejected                  | Compare normalized key with allowed-key taxonomy                                                                                                  |
| Update incorrectly exceeds limit | Verify deployed code includes replacement-aware token accounting and current `packages/data-schemas/dist`                                         |
| No attachment appears            | Check whether the memory request timed out after the DB write; inspect logs and the entry provenance                                              |
| Admin changes have no effect     | Confirm app-settings save succeeded and caches invalidated; verify the deployed client and API bundles match source                               |

### Logging

Memory worker failures use the `[MemoryAgent]` and `[AgentClient]` log prefixes. Timeout messages
include the configured duration. Audit writes log failures separately and fail open.

### Data inspection

Use read-only MongoDB queries against `MemoryEntry` and `MemoryEvent`. Do not copy memory values,
evidence text, or private conversation identifiers into tickets or public logs.

## Tests

The focused regression coverage is:

- `packages/api/src/agents/memoryPolicy.spec.ts`
  - exact one-off YouTube MCP false-positive wording
  - explicit Barbara Yahr save wording
  - research-then-save intent
  - delete intent
  - custom phrases
  - key normalization
  - response/tool context filtering and bounds
- `packages/api/src/agents/memory.spec.ts`
- `packages/api/src/agents/__tests__/memory.test.ts`
  - tool limits and storage overflow behavior
  - one-write safe default and unchanged-value no-op behavior
  - GPT-5 parameter handling
  - default `gpt-5.6-terra` selection
- `packages/data-schemas/src/methods/memory.spec.ts`
  - changing one key preserves every other key's timestamp
  - identical value/token rewrites preserve the existing timestamp
- `api/server/services/Admin/appSettings.spec.js`
  - safe defaults
  - partial memory-policy merge and persistence
- `client/src/components/Admin/__tests__/AdminConsole.test.tsx`
  - provider/model selectors use the signed-in administrator's effective model inventory
  - selected provider/model are included in the settings save payload

Recommended focused commands:

```bash
cd /pool/home/timeng/LibreChat-custom

./local-services/run-node-capped.sh --memory-max 3G --heap-mb 1536 -- \
  bash -lc 'cd packages/api && npx jest --runInBand --coverage=false \
  --testPathPatterns="src/agents/memory.spec.ts|src/agents/__tests__/memory.test.ts|src/agents/memoryPolicy.spec.ts"'

./local-services/run-node-capped.sh --memory-max 2G --heap-mb 1024 -- \
  bash -lc 'cd api && npx jest --runInBand --coverage=false \
  --testPathPatterns=server/services/Admin/appSettings.spec.js'

./local-services/run-node-capped.sh --memory-max 3G --heap-mb 1536 -- \
  bash -lc 'cd packages/data-schemas && npx jest --runInBand --coverage=false \
  --testPathPatterns=src/methods/memory.spec.ts'
```

Before promotion, also build the affected package chain and client, run relevant API tests, and run
`npm run verify:openai-reasoning-preservation` because the memory worker uses OpenAI agent runtime
paths.

## Build and deployment

Affected build order:

1. `npm run build:data-provider`
2. `npm run build:data-schemas`
3. `npm run build:api`
4. Full client build through `local-services/run-node-capped.sh`

The source TypeScript under `packages/api/src` and `packages/data-schemas/src` is not sufficient for
a running container. Promotion must include the matching package `dist` output. The Admin Console
change must be promoted as a complete manifest-verified `client/dist` tree; never copy individual
frontend source or hashed assets.

Production stable runs on the LibreChat VM and must not be changed without explicit approval. Follow
the repository deployment instructions and validate on dev before a VM stable promotion.

## Observability and accounting

Every memory-worker model invocation is accounted independently from the foreground chat request:

- Langfuse uses the run name `MemoryRun` and trace metadata `category=memory` plus
  `operation=memory_mutation`, intent, prompt version, provider, and model.
- The memory graph collects each model-end usage record, including tool-retry calls, and forwards the
  exact input/output token totals to the standard transaction pipeline.
- Memory transactions use `context=memory` and persist their own `endpoint` and `model`; they do not
  inherit the foreground agent provider when the administrator selects a different memory model.
- The exporter prefers the transaction's direct endpoint and only falls back to the linked message
  endpoint for older rows. This preserves provider attribution for background memory calls.
- Grafana provisions the `LibreChat Memory LLM Usage` dashboard (`librechat-memory-usage`) with
  memory-only token, cost, provider/model, token-type, and structured `[MemoryUsage]` log panels.

The Langfuse callback runtime patch must preserve caller-supplied `traceMetadata` when it adds the
standard user, conversation, and message fields. `config/apply-runtime-patches.js` patches the
source, ESM, and CJS copies of `@librechat/agents`, and its regression test is part of the deployment
contract.

A memory save that makes zero model calls produces no usage transaction. A model call that returns no
mutation is still counted and traced because compute was consumed. Audit events and model-usage
transactions are separate records with different retention and purposes.

## Rollback

The least disruptive rollback is administrative:

1. Disable `Automatic memory mutations` in the Admin Console.
2. Keep the YAML `memory:` section enabled so existing memories are still retrieved.
3. If needed, restore the prior provider/model or disable assistant/tool context.
4. Inspect audit events and remove any incorrect saved entries manually.

A code rollback must revert the backend package dist, API runtime files, database schema registration,
and full client dist as one compatible set. Existing provenance fields are additive. The
`MemoryEvent` collection can remain present if code is rolled back; its TTL index will continue to
expire records.

## Privacy and security

- Memory mutations require the existing memory permission and respect user opt-out.
- The deterministic gate reduces accidental persistence but does not replace user judgment.
- Completed assistant/tool context is bounded and used only when explicit mutation intent is present.
- Thinking/reasoning content is excluded from memory-worker context.
- Audit evidence may contain a short fragment of user text and therefore follows the same privacy
  handling expectations as conversation data.
- Do not expose memory values or audit evidence through administrator APIs without a separate access
  control and privacy review.

## Merge preservation checklist

When syncing upstream, preserve these behaviors together:

- default `gpt-5.6-terra` model, access-filtered Admin picker, and `openAI` provider casing
- deterministic explicit intent gate and regression examples
- post-response execution after `run.processStream()`
- main-model awareness that mutation is delegated, without false unavailable or already-saved claims
- explicit research/email/file/code/MCP save requests consume completed tool context
- request-first transcript truncation so large tool results cannot discard the save instruction
- bounded assistant/tool context with thinking exclusion
- server-side key normalization and allowed-key validation
- replacement-aware token accounting and per-turn mutation bounds
- memory provenance fields
- `MemoryEvent` model registration and TTL index
- Admin Console schema, API persistence, cache invalidation, defaults, and UI
- manual `/api/memories` limit enforcement
- streaming attachment handling and configurable final wait timeout
- this document and the matching section in `CUSTOMIZATION_MASTER_DOC.md`

## Runtime package contract and deployment guard

The memory request path crosses both directly loaded API source and compiled workspace packages:

1. `api/server/controllers/agents/client.js` detects explicit save/delete intent and coordinates the request.
2. `@librechat/api` supplies `detectMemoryIntent`, `formatMemoryResponseContext`, and `createMemoryProcessor` from `packages/api/dist`.
3. `@librechat/data-schemas` supplies the database methods, including `recordMemoryEvent`, from `packages/data-schemas/dist`.

These layers must be promoted as a matched set. Deploying a new controller while leaving an older `packages/api/dist` produced the production error `detectMemoryIntent is not a function` before generation could begin. A normal HTTP health check did not detect the problem because startup and `/api/config` did not execute the memory request path.

`local-services/verify-auth-memory-runtime-contracts.sh` now loads the repository bundles, validates the required functions, scans deployed API JavaScript for destructured imports whose package exports are missing, and validates the deployed container when `--container` is supplied. It is wired into stable startup, runtime-delta deployment, frontend promotion, and health checks.

For any memory source change:

```bash
npm run build:data-schemas
npm run build:api
npm run verify:auth-memory-runtime-contracts
```

Promote the required `packages/*/dist` directories together with the directly loaded API files. Never copy `packages/*/src` into a running container and never treat a passing `/api/config` request as sufficient validation of the memory execution path.

The same verifier also found an older latent optional-import mismatch in `googleVertexRefresh.js`: the controller destructured a helper that no current `@librechat/api` bundle exported. The error was caught only after a primary Vertex failure, so it produced a misleading secondary `is not a function` log. The controller now feature-detects that optional helper and safely skips the refresh when unavailable; direct required imports remain fail-closed.
