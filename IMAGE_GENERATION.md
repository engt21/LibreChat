# Image Generation (User-managed)

This document describes the user-managed image generation feature in this customized LibreChat branch. It complements `CUSTOMIZATION_MASTER_DOC.md` section 3.20 with implementation detail, request/response shapes, and operational notes.

## TL;DR

- A new **Settings → Image generation** tab discovers per-provider image-generation models from the configured API keys (OpenAI, Azure OpenAI, xAI, Google Gemini API, Vertex AI, Black Forest Labs / Flux, Stability AI).
- A new **Image badge** in the chat-bar is gated by the `IMAGE_GEN.USE` permission. The toggle persists per conversation as `ephemeralAgent.image_generation`.
- An **always-on auto-injection** path in `Agent.js` adds the right tool key when any of the following are true: chat-bar toggle on, `enabledByDefault` set in user prefs, or the active modelSpec opts in.
- Per-user model selection is plumbed through to the four image-generation tools (`image_gen_oai`, `gemini_image_gen`, `flux`, `stable-diffusion`) so the saved provider default actually wins over the env-only default.
- OpenAI GPT-image generation streams real partial-image previews to the existing attachment pipeline while preserving the final saved image artifact. Azure/custom/non-GPT-image paths stay on the existing non-streaming flow.

## Goals

- Let any user with the `IMAGE_GEN.USE` permission see exactly which image generation models the deployment can serve them, sorted newest-first per provider.
- Let users pin a default model per provider and (optionally) a `preferredProvider` that overrides endpoint-name routing.
- Keep the chat-bar toggle ChatGPT-like: a single `Image` badge that turns the tool on for the current conversation. The `enabledByDefault` switch in Settings opts the user into "always on by default".
- Discover models without forcing the user to know provider-specific environment variables. The Settings tab answers the question "what is actually available right now?" rather than "what does the env file claim?"

## High-level architecture

```
client (Settings tab + badge)
  -> useImageGenerationModelsQuery / useImageGenerationPrefsQuery
       (react-query hooks in client/src/data-provider/ImageGeneration/)
  -> /api/image-generation/{models,prefs}
       (express router in api/server/routes/imageGeneration.js)
  -> ImageGenerationController.js
       -> @librechat/api :: discoverImageModels()
       -> userModel.updateUser()
```

For every chat message, after the user-side toggle is set:

```
ChatForm submit
  -> ephemeralAgent: { image_generation: true, ... }
  -> /api/agents/chat
  -> Agent.loadEphemeralAgent()
       -> applyImageGenerationTool({ endpoint, ephemeralAgent, modelSpec, user, tools })
            -> selects ImageGenProvider based on:
                 1. user.imageGenerationPrefs.preferredProvider (highest)
                 2. endpoint name match (openai/azure/xai/google/gemini/vertex)
                 3. fallback chain: openai -> google -> flux
            -> tools.push(imageGenProviderToolKey[provider])
  -> handleTools.resolveImageModelOverride(...) reads user prefs and threads
     `model:` into the tool constructor (OpenAI / Gemini / Flux / SD)
```

## Backend

### Discovery module — `packages/api/src/endpoints/imageModels.ts`

Exports `discoverImageModels(options) -> Promise<TImageGenModelsResponse>`. Caches results per user for one hour. Each provider has its own discovery contract:

- **OpenAI / Azure OpenAI / xAI** — filter the provider's `/v1/models` (or equivalent) by `openAIImageModelPatterns` / `xaiImageModelPatterns`. Azure normalization reuses `isAzureOpenAIBaseURL` / `normalizeAzureOpenAIBaseURL`.
- **Google Gemini API** — calls `GoogleGenAI({apiKey}).models.list()` and filters by `googleImageModelPatterns` (matches `imagen*`, `*-flash-image`, `nano-banana`).
- **Vertex AI** — same filter set, but uses `prepareGoogleCredentials` + `resolveGoogleClientAuth` so service-account / ADC flows are honored. Vertex discovery is intentionally tolerant of failures because not every deployment has Vertex enabled.
- **Flux (BFL) / Stability AI** — curated lists (`fluxKnownModels`, `stabilityKnownModels`) keyed on the presence of `FLUX_API_KEY` / `STABILITY_API_KEY`. These providers do not expose discoverable image-model APIs, so we ship newest-first curated lists and update them with each release.

Discovery is intentionally tolerant: when a remote call fails for a configured provider we still return the curated fallback (where one exists) with a `notice` so the user is not blocked.

### Controller — `api/server/controllers/ImageGenerationController.js`

Three handlers, all gated by `IMAGE_GEN.USE`:

| Method | Path                           | Purpose                                                                                                     |
| ------ | ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| GET    | `/api/image-generation/models` | Calls `discoverImageModels({ user, loadCredential, appConfig })`, returns `TImageGenModelsResponse`         |
| GET    | `/api/image-generation/prefs`  | Returns `{ prefs: TImageGenerationPrefs }` (default object if user has none saved)                          |
| PATCH  | `/api/image-generation/prefs`  | Validates body with `imageGenerationPrefsUpdateSchema`, merges with existing, persists, returns saved prefs |

Errors are squashed to 401/403/400/500 with structured payloads so the client never sees a stack trace.

### Tool plumbing

`api/app/clients/tools/util/handleTools.js`:

```js
function resolveImageModelOverride({ toolKey, endpoint, prefs }) {
  // toolKey is one of: image_gen_oai | gemini_image_gen | flux | stable-diffusion
  // endpoint hints which ImageGenProvider to read from prefs.models[...]
  // returns a string model id or undefined
}
```

Each of the four image-generation tools accepts the resolved id:

- `OpenAIImageTools.js` — uses `fields.model` ahead of `IMAGE_GEN_OAI_MODEL`; for official OpenAI GPT-image generation it requests `stream: true` / `partial_images: 3`, emits partial previews as transient `attachment` SSE events keyed by `messageId` + `toolCallId`, and still returns the final base64 image through the existing artifact saver.
- `GeminiImageGen.js` — accepts `modelOverride` from `fields.model`
- `FluxAPI.js` — derives `this.defaultEndpoint` (e.g. `/v1/flux-pro-1.1`) from the model id
- `StableDiffusion.js` — populates A1111's `override_settings.sd_model_checkpoint`

Streaming is intentionally narrow: it requires an official OpenAI base URL, a `gpt-image-*` model, and tool-call metadata from the agent stream. Azure OpenAI, xAI/custom base URLs, DALL-E models, edits, and unsupported streaming errors fall back to the existing final-response behavior.

### Auto-injection — `api/models/Agent.js :: applyImageGenerationTool`

Picks the right tool key for the current request. Order of precedence:

1. **Bail early** if none of `ephemeralAgent.image_generation`, `prefs.enabledByDefault`, or `modelSpec.imageGeneration` are true.
2. **Provider candidate list**:
   - Push `prefs.preferredProvider` first (if set).
   - Match the request endpoint name (openai / azure / xai / google / gemini / vertex).
   - Always append `openai`, `google`, `flux` as a tail fallback chain.
3. Walk the candidates in order, dedupe by tool key, and push the first viable key into `tools`.

The function is exported for unit testing in `api/models/__tests__/applyImageGenerationTool.spec.js`.

## Frontend

### Hooks — `client/src/data-provider/ImageGeneration/`

```ts
useImageGenerationModelsQuery(): UseQueryResult<TImageGenModelsResponse>
useImageGenerationPrefsQuery(): UseQueryResult<{ prefs: TImageGenerationPrefs }>
useUpdateImageGenerationPrefsMutation(): UseMutationResult<{ prefs: TImageGenerationPrefs }, ...>
```

Both queries are gated by `useHasAccess(IMAGE_GEN, USE)` at the call sites.

### Settings tab — `client/src/components/Nav/SettingsTabs/ImageGeneration/ImageGeneration.tsx`

Sections:

1. **Always allow image generation** switch (writes `enabledByDefault`).
2. **Preferred provider** dropdown (writes `preferredProvider`; empty value = endpoint-match auto-routing).
3. **Models per provider** rows. Each row shows the configured/notice indicators and a `<select>` of discovered models (newest-first). Saving updates `prefs.models[providerId]`.

The tab is registered in `Settings.tsx` behind `useHasAccess(PermissionTypes.IMAGE_GEN, Permissions.USE)` and added to the keyboard navigation index.

### Chat-bar — `client/src/components/Chat/Input/ImageGeneration.tsx`

A single `CheckboxButton` with a Lucide `Image` icon. The badge is rendered by `BadgeRow.tsx` after `<FileSearch />` and is reachable from the `ToolsDropdown` "Image generation" menu item, which also has a pin toggle (`LocalStorageKeys.PIN_IMAGE_GENERATION_`).

### Persistence

Per-conversation toggle state lives at `LocalStorageKeys.LAST_IMAGE_GENERATION_TOGGLE_<convoId>` and (mirrored) on `ephemeralAgent.image_generation` via the existing `useToolToggle` hook. The chat-bar pin lives at `LocalStorageKeys.PIN_IMAGE_GENERATION_pinned`.

### Streamed previews

`OpenAIImageGen.tsx` consumes the normal per-tool `attachments` array. During an OpenAI GPT-image stream, the backend sends transient data-URL attachments for each real `image_generation.partial_image` event and the component displays the newest provider image immediately. The generic `PixelCard` placeholder is never rendered; before the first provider image arrives, the UI shows progress text only. The Image API does not require a separate completed event, so when streaming ends the backend promotes the last real partial event to a non-partial completed preview. When the final persisted file attachment arrives from `createToolEndCallback`, it replaces the transient data URL without changing the saved message shape. Responses API built-in image generation uses its separate `response.image_generation_call.partial_image` / `response.completed` contract and must be handled on that response stream rather than being mistaken for Image API events.

## Permissions

A new `PermissionTypes.IMAGE_GEN` is registered in `permissions.ts` and seeded with `USE` in the default user role in `roles.ts`. The controller, the chat-bar badge, the dropdown item, and the Settings tab all gate on `IMAGE_GEN.USE`. Admins can revoke the permission to disable image generation per role without removing any deployment-level credentials.

## Environment variables

The discovery layer recognizes the following env (server-defined credentials):

| Provider          | Env variables                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------- |
| OpenAI            | `OPENAI_API_KEY` (or `IMAGE_GEN_OAI_API_KEY`), `IMAGE_GEN_OAI_BASEURL`, `IMAGE_GEN_OAI_MODEL` |
| Azure OpenAI      | `AZURE_OPENAI_API_KEY` plus existing Azure base/api-version env                               |
| xAI               | `XAI_API_KEY` plus `XAI_REVERSE_PROXY_URL`                                                    |
| Google Gemini API | `GOOGLE_API_KEY` / `GEMINI_API_KEY`                                                           |
| Vertex AI         | Existing Vertex service-account / ADC env (re-uses `prepareGoogleCredentials`)                |
| Flux (BFL)        | `FLUX_API_KEY`                                                                                |
| Stability AI      | `STABILITY_API_KEY`                                                                           |

Per-user keys saved through the existing user-key flow are also resolved via `loadAuthValues` (with `throwError: false`) and merged with env-defined credentials — the Settings tab labels show whether the source is `server` or `user`.

## Tests

| File                                                                            | What it covers                                                      |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `packages/data-provider/src/imageGeneration.spec.ts`                            | helpers, curated lists, prefs zod schemas, endpoint URLs            |
| `packages/api/src/endpoints/imageModels.spec.ts`                                | provider-info merging, OpenAI live discovery, curated fallbacks     |
| `api/server/controllers/__tests__/ImageGenerationController.spec.js`            | get/patch/permission/error paths                                    |
| `api/models/__tests__/applyImageGenerationTool.spec.js`                         | tool-key selection per endpoint and prefs                           |
| `api/app/clients/tools/structured/specs/OpenAIImageTools.spec.js`               | OpenAI partial-image streaming, Azure non-streaming guard, fallback |
| `client/src/components/Chat/Messages/Content/__tests__/OpenAIImageGen.test.tsx` | partial preview replacement and all persisted multi-image finals    |

Run them all:

```bash
cd packages/data-provider && npx jest --testPathPatterns=imageGeneration
cd packages/api && npx jest --testPathPatterns=imageModels
cd api && npx jest --testPathPatterns="ImageGenerationController|applyImageGenerationTool"
cd api && npx jest --testPathPatterns=app/clients/tools/structured/specs/OpenAIImageTools.spec.js
cd client && npx jest --testPathPatterns=components/Chat/Messages/Content/__tests__/OpenAIImageGen.test.tsx
```

## Live-rail deployment

Code-only changes:

1. Build only the artifacts required by the files you changed. If package or frontend source changed, rebuild those artifacts on the host:
   ```bash
   NODE_OPTIONS="--max-old-space-size=8192" npm run build:data-provider
   NODE_OPTIONS="--max-old-space-size=8192" npm run build:data-schemas
   NODE_OPTIONS="--max-old-space-size=8192" npm run build:api
   NODE_OPTIONS="--max-old-space-size=8192" npm run frontend
   ```
2. For backend/runtime files and already-built `packages/*/dist/**`, use the guarded runtime-delta helper instead of manual `docker cp`:
   ```bash
   ./local-services/deploy-runtime-delta.sh dev --dry-run -- api/server/routes/imageGeneration.js packages/api/dist
   ./local-services/deploy-runtime-delta.sh dev -- api/server/routes/imageGeneration.js packages/api/dist
   ```
3. For frontend source changes, deploy the complete host-built `client/dist` tree with `local-services/deploy-built-client-dist.sh`; never hand-copy individual generated assets.
4. Smoke check:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" http://localhost:<port>/api/image-generation/models
   # expect 401 (auth required, route mounted)
   ```

The Settings → Image generation tab loads only for users whose role grants `IMAGE_GEN.USE`. Without that permission, the tab is hidden and the chat-bar badge does not render.

## Pitfalls and lessons learned

- **`extractBaseURL('') ?? undefined` is not the same as `extractBaseURL('') || undefined`.** When `OPENAI_API_BASE` is unset and a downstream caller relies on the fallback `https://api.openai.com/v1`, the empty-string short-circuit must coalesce away. The discovery test suite explicitly mocks `extractBaseURL(url) -> url ? url : undefined` to mirror this.
- **`@librechat/api` is symlinked from `node_modules/@librechat/api -> packages/api`.** If `packages/api/dist` is missing (e.g. after a `rimraf` from a Docker build), every Jest spec that mocks `@librechat/api` will fail with `Cannot find module '@librechat/api'`. Always run `npm run build:api` before running api workspace tests on a freshly checked-out tree.
- **Curated newest-first ordering matters.** The `pickDefaultImageModel` helper relies on the curated list ordering for fallback. Keep `fluxKnownModels` and `stabilityKnownModels` in newest-first order with explicit `releasedAt` timestamps.
- **Auto-injection must not regress to "openai-only".** The candidate chain explicitly walks `openai → google → flux`, so even if the active endpoint is unrecognized we still produce a working tool key when the user has any provider configured.
- **Partial-image streaming should stay additive.** The final saved image still flows through `createToolEndCallback`/`saveBase64Image`; transient preview attachments must not be persisted into the response message or replace the artifact saver.

## July 6, 2026 streaming UI correction

OpenAI Image API tool arguments stream incrementally and are not valid JSON until the tool call has
finished emitting arguments. `OpenAIImageGen.tsx` must parse only complete-looking JSON and must not
log incomplete fragments as errors. During the gap before the first provider event, show progress
text only. Once attachment events arrive, render the actual base64/provider preview and replace it
with every persisted final image. Never restore the synthetic pixel-blob preview.

Production validation generated and rendered real 768x768 OpenAI images, and the browser console no
longer emitted repeated `Unexpected end of JSON input` errors for partial tool arguments.
