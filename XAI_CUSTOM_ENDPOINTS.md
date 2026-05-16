# xAI Custom Endpoints

This branch adds first-class xAI support for LibreChat custom endpoints so Grok endpoints behave more like the built-in Google/OpenAI integrations instead of falling back to the generic OpenAI-compatible settings surface.

## What this customization adds

- automatic xAI custom-endpoint detection from:
  - endpoint name `xai`
  - any `baseURL` that resolves to `*.x.ai`
  - explicit `customParams.defaultParamsEndpoint: 'xai'`
- live xAI model discovery from `GET /v1/language-models`
- per-endpoint xAI capability metadata published into startup config as `xaiModelCapabilities`
- a dedicated xAI settings surface in the endpoint modal
- matching capability-aware behavior in the normal parameter side panel and the agent model panel
- xAI-specific request sanitization before runtime calls leave LibreChat
- Grok 4.20 token-window and pricing coverage in the local token/pricing maps

## Main files

- `packages/data-provider/src/xai.ts`
- `packages/data-provider/src/parameterSettings.ts`
- `packages/data-provider/src/config.ts`
- `packages/api/src/endpoints/models.ts`
- `packages/api/src/endpoints/custom/config.ts`
- `packages/api/src/endpoints/openai/llm.ts`
- `api/server/routes/config.js`
- `api/server/controllers/ModelController.js`
- `api/server/services/Config/loadConfigModels.js`
- `client/src/components/Endpoints/Settings/XAI.tsx`
- `client/src/components/Endpoints/EndpointSettings.tsx`
- `client/src/components/SidePanel/Parameters/Panel.tsx`
- `client/src/components/SidePanel/Agents/ModelPanel.tsx`
- `packages/api/src/utils/tokens.ts`
- `api/models/tx.js`

## Current local runtime config

The local customization worktree now ships a dedicated `xai` custom endpoint in `librechat.yaml`:

- name: `xai`
- base URL: `https://api.x.ai/v1`
- auth: `user_provided`
- parameter profile: `defaultParamsEndpoint: 'xai'`
- bootstrap model list with `fetch: true`, so the endpoint stays visible before a key is entered and upgrades to live discovery as soon as the user saves their xAI key

This makes the xAI endpoint show up in the model selector immediately in the local runtime.

## Recommended config pattern

```yaml
endpoints:
  custom:
    - name: 'xai'
      apiKey: '${XAI_API_KEY}'
      baseURL: 'https://api.x.ai/v1'
      customParams:
        defaultParamsEndpoint: 'xai'
      models:
        fetch: true
```

If you proxy xAI through a non-`x.ai` hostname or use a non-obvious endpoint name, set the parameter profile explicitly:

```yaml
endpoints:
  custom:
    - name: 'My Grok Proxy'
      apiKey: '${XAI_API_KEY}'
      baseURL: 'https://my-proxy.example.com/v1'
      customParams:
        defaultParamsEndpoint: 'xai'
      models:
        fetch: true
```

## Discovery behavior

- LibreChat fetches `${baseURL}/language-models` for detected xAI custom endpoints.
- **`/language-models` 403 fallback**: some xAI key tiers return 403 on the `/language-models` endpoint. When that happens, `fetchXAIModelCapabilities` now falls back to the standard OpenAI-compatible `/v1/models` listing, synthesizes id-only capability entries, and routes them through `buildXAIModelCapabilitiesMap` so the text-compat filter still strips image/video/TTS families.
- **Defaults always merged**: `loadConfigModels` unions the endpoint's configured `models.default` list with whatever the live API returns for xAI, so curated bootstrap models always appear in the picker even when discovery surfaces a partial list.
- When the endpoint is configured with `apiKey: 'user_provided'`, LibreChat uses `models.default` as the bootstrap list until the user saves a personal xAI key, then refreshes the selector with live `/language-models` discovery.
- The returned list is filtered to text-compatible chat models before it reaches the picker.
- Known non-chat families such as image/video/TTS-style models are removed.
- xAI aliases are preserved, so both canonical IDs and alias names can appear in matching/capability lookups.
- Cached startup config and cached model config both refresh xAI endpoint data on subsequent requests, similar to the existing Google/Ollama refresh flow.

## Settings and capability behavior

LibreChat now treats xAI as its own parameter profile instead of reusing the entire generic OpenAI custom-endpoint surface.

### Exposed xAI settings

- `temperature`
- `top_p`
- `max_tokens`
- `stop`
- `imageDetail`
- `reasoning_effort`
- `useResponsesApi`
- `web_search`
- `verbosity`
- `disableStreaming`

### Capability-aware rules

- `reasoning_effort` is only enabled for `grok-3-mini*`
- reasoning models disable `stop`
- multi-agent Grok 4.20 models disable `max_tokens`
- image-detail controls are disabled for text-only models
- disabled controls stay visible but become read-only with an inline explanation

The same gating is applied in:

- endpoint settings modal
- main chat parameter side panel
- agent model parameter panel

## Runtime request handling

For xAI custom endpoints, LibreChat now normalizes request options to match xAI behavior more closely:

- Responses API usage is the default xAI path
- `frequency_penalty` and `presence_penalty` are stripped when the request is using Responses API semantics
- unsupported `reasoning_effort` values are removed for non-`grok-3-mini*` models
- `stop` is removed for reasoning models
- multi-agent models do not send output-token-limit params
- Responses API verbosity is moved under `text.verbosity`
- **web_search tool routing**: xAI only accepts `{ type: 'web_search' }` on the Responses API. The xAI branch of `getOpenAILLMConfig` now pushes the `web_search` tool and forces `useResponsesApi = true` before any OpenAI-generic handling runs, and a post-processing guard re-asserts `useResponsesApi = true` if a `web_search` tool remains in the tools array. This prevents regressions where a request lands on `/v1/chat/completions` and xAI rejects it with `422 ... unknown variant 'web_search', expected 'function' or 'live_search'`.
- **ChatXAI streaming must route through the Responses API** (`config/apply-runtime-patches.js` → `@librechat/agents/dist/cjs/llm/openai/index.cjs`): LibreChat's `ChatXAI._streamResponseChunks` override in `@librechat/agents` used to call `completionWithRetry(...)` unconditionally, which hits `/v1/chat/completions`. With `useResponsesApi = true` set on `llmConfig` or a built-in tool like `{ type: 'web_search' }` bound, we now first check `_useResponseApi(options)` and route through `responseApiWithRetry(...)` (mirroring the OpenAI sibling). Without this guard, streaming Grok + web_search always produced the `422 ... expected function or live_search` error even though the rest of the request builder had correctly set `useResponsesApi = true`.

## Model-family assumptions used by the capability layer

The local capability resolver combines xAI metadata with model-name inference for current Grok families:

- `grok-3*`, `grok-4*`, and `grok-code-fast*` are treated as reasoning-capable unless the name includes `non-reasoning`
- `grok-3-mini*` is the only family that enables the reasoning-effort control
- `grok-4.20-multi-agent*` is treated as multi-agent and therefore not eligible for output token limits or normal function-calling expectations
- image input is enabled when xAI metadata reports image modality, and also for known Grok vision-capable families

## Token and pricing coverage

Local token/pricing metadata now includes branch-specific mappings for:

- `grok-4.20-beta*`
- `grok-4.20-multi-agent*`
- existing Grok 4 / 4 Fast / 4.1 Fast / Grok Code Fast variants

## Validation run for this customization

- `npm --prefix packages/data-provider run build`
- `npm --prefix packages/data-provider run test:ci -- --runTestsByPath src/xai.spec.ts src/google.spec.ts`
- `npm --prefix packages/api run test:ci -- --runTestsByPath src/endpoints/models.spec.ts src/endpoints/openai/llm.spec.ts`
- `npm --prefix api run test:ci -- --runTestsByPath utils/tokens.spec.js models/tx.spec.js`
- `npm --prefix client run test:ci -- --runTestsByPath src/components/Endpoints/Settings/Google.spec.tsx src/components/Endpoints/Settings/XAI.spec.tsx`
- `npm --prefix client run typecheck`
- `npm --prefix client run build:ci`

## Preserve during future upstream merges

- xAI auto-detection for custom endpoints
- `/language-models`-based live discovery
- **`/language-models` 403 fallback to `/v1/models`** inside `fetchXAIModelCapabilities` (`packages/api/src/endpoints/models.ts`)
- **Defaults-union behavior** for xAI endpoints inside `loadConfigModels` (`api/server/services/Config/loadConfigModels.js`)
- **xAI-specific web_search branch** in `getOpenAILLMConfig` that forces `useResponsesApi = true` before generic handling, plus the post-processing guard that re-asserts it if a `web_search` tool remains
- **Runtime patch**: the `@librechat/agents` ChatXAI streaming route must go through the Responses API (`config/apply-runtime-patches.js` entry for `dist/cjs/llm/openai/index.cjs`). This is a `node_modules` patch applied during postinstall — it must be carried forward on every `@librechat/agents` version bump.
- `xaiModelCapabilities` in startup config
- dedicated xAI settings routing instead of generic OpenAI-only handling
- capability-aware disablement in endpoint settings, chat parameters, and agent parameters
- xAI runtime sanitization in `packages/api/src/endpoints/openai/llm.ts`
- Grok 4.20 token and pricing entries
