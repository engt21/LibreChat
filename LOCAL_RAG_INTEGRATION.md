# Local RAG integration

This branch now mirrors the local code interpreter pattern for file search by wiring LibreChat to a locally cloned `rag_api` checkout instead of relying on the prebuilt hosted image path.

## What this adds

- a local `rag_api` clone path expectation at `/pool/home/timeng/rag_api`
- compose wiring for three local RAG services built from that clone:
  - `rag_api` for OpenAI embeddings
  - `rag_api_azure` for Azure OpenAI embeddings
  - `rag_api_google` for Gemini / Google embeddings
- provider-aware routing inside LibreChat so file-search uploads and queries follow the selected chat provider automatically
- screenshot/image context uploads now preserve the image attachment for vision-capable models while also storing OCR text on the same file record for prompt injection
- a startup guard in `local-services/start-all.sh` so local startup fails fast when the external `rag_api` checkout is missing

## Repositories involved

### Main LibreChat repo

- path: `/pool/home/timeng/LibreChat-custom`
- holds all LibreChat integration changes

### External local RAG repo

- path: `/pool/home/timeng/rag_api`
- expected to be cloned separately, just like the local code interpreter flow uses a separate implementation subtree/service
- current source: `https://github.com/danny-avila/rag_api`

Clone it with:

```bash
git clone https://github.com/danny-avila/rag_api.git "/pool/home/timeng/rag_api"
```

## Architecture

### Dual-rail local runtime model

This repo now supports two parallel rails so one can stay usable while the other is rebuilt:

| Rail | Purpose | App URL | OpenAI RAG | Azure RAG | Google RAG |
| --- | --- | --- | --- | --- | --- |
| `stable` | keep a working stack available | `http://127.0.0.1:3080` | `8100` | `8101` | `8102` |
| `dev` | rebuild/test new changes | `http://127.0.0.1:3081` | `8110` | `8111` | `8112` |

The helper scripts give each rail its own Compose project name, image tags, ports, and local state paths.

### Service layout

The local override compose file builds and runs three independent `rag_api` containers from the external clone:

- `rag_api` -> OpenAI embeddings
- `rag_api_azure` -> Azure embeddings
- `rag_api_google` -> Google / Gemini embeddings

All three share the same local pgvector database container inside a rail, but write into separate collection names so embeddings from different providers do not get mixed.

`stable` and `dev` do not share MongoDB or pgvector containers with each other.

### Why three services instead of one

Different embedding providers can use different vector dimensions and different runtime credentials. Running one service per provider keeps the deployment simple and follows the same “external managed service” idea used by the local code interpreter bridge.

### LibreChat routing model

LibreChat now resolves a RAG target URL from the conversation/upload provider:

- OpenAI -> `OPENAI_RAG_API_URL`
- Azure OpenAI -> `AZURE_OPENAI_RAG_API_URL`
- Google / Gemini -> `GOOGLE_RAG_API_URL`
- fallback -> `RAG_API_URL`

This routing is used for:

- vector upload (`/embed`)
- semantic query (`/query`)
- full-context fetch (`/documents/:id/context`)
- vector deletion (`DELETE /documents`)

The selected provider is also stored on the file metadata as `metadata.ragProvider` and the embedding model as `metadata.ragModel`.

## File handling behavior

### File search enabled

When `tool_resource === file_search`:

1. the raw file is still stored in LibreChat storage
2. LibreChat selects the correct local RAG service from the active provider
3. the file is embedded into the local vector store
4. LibreChat stores provider metadata on the Mongo file record
5. future searches for that file query the same provider-specific RAG backend

### File search disabled / OCR-context mode

When `tool_resource === context`:

- documents still use extracted text for prompt context
- screenshots/images now do both:
  - keep the image attachment so vision-capable models can still see the raw image
  - store OCR text in `file.text` on the same file record so LibreChat can inject extracted text into the model context

This means screenshot uploads behave more like ChatGPT-style “look at the image and also use OCR text” handling.

## Source changes

## Provider-aware RAG URL selection

- `api/server/services/Files/VectorDB/routing.js`
- `api/server/services/Files/VectorDB/auth.js`
- `api/server/services/Files/VectorDB/crud.js`

These files add provider normalization, RAG URL selection, and request metadata propagation.

## Prompt/query integration

- `api/app/clients/prompts/createContextHandlers.js`
- `api/app/clients/tools/util/fileSearch.js`

These now query the correct local RAG service based on file metadata instead of assuming one global `RAG_API_URL` for every file.

## Context-mode screenshots

- `api/server/services/Files/process.js`
- `packages/api/src/files/context.ts`

These changes preserve image attachments and reuse OCR text from `file.text` during context assembly.

## Types / schema updates

- `packages/data-schemas/src/schema/file.ts`
- `packages/data-schemas/src/types/file.ts`
- `packages/data-provider/src/types/files.ts`

These now allow `metadata.ragProvider` and `metadata.ragModel` to persist cleanly.

## Local service orchestration

- `docker-compose.local.override.yml`
- `local-services/start-all.sh`
- `.env.example`

These files wire the local clone into the normal local startup flow and document the new environment variables.

## Environment variables

### Required for the local cloned RAG services

```env
LOCAL_RAG_API_ROOT=/pool/home/timeng/rag_api
OPENAI_RAG_API_URL=http://rag_api:8000
AZURE_OPENAI_RAG_API_URL=http://rag_api_azure:8000
GOOGLE_RAG_API_URL=http://rag_api_google:8000
```

Those URLs are internal Compose-network addresses. Host-side rail ports are assigned by the helper scripts:

- `stable`: `8100`, `8101`, `8102`
- `dev`: `8110`, `8111`, `8112`

### Embedding model selection

```env
RAG_DEFAULT_PROVIDER=openai
RAG_OPENAI_EMBEDDING_MODEL=text-embedding-3-small
RAG_AZURE_EMBEDDING_MODEL=text-embedding-3-small
RAG_GOOGLE_EMBEDDING_MODEL=gemini-embedding-001
RAG_AZURE_OPENAI_API_VERSION=2023-05-15
```

### Collection separation

```env
RAG_OPENAI_COLLECTION_NAME=librechat_rag_openai
RAG_AZURE_COLLECTION_NAME=librechat_rag_azure
RAG_GOOGLE_COLLECTION_NAME=librechat_rag_google
RAG_EMBEDDING_BATCH_SIZE=500
```

### Credentials consumed by the local `rag_api` containers

The `rag_api` services rely on the same `.env` file used by the local stack. Set whichever providers you want to enable:

```env
OPENAI_API_KEY=...
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_ENDPOINT=...
GOOGLE_KEY=...
RAG_GOOGLE_API_KEY=...
```

If a provider key is missing, that provider-specific local RAG service can still start, but embedding requests against it will fail.

## Startup and restart

Start the rail you want:

```bash
./local-services/start-all.sh stable
./local-services/start-all.sh dev
```

The script now checks that `LOCAL_RAG_API_ROOT` exists before continuing.

Recommended workflow:

1. keep `stable` (`r1`) running on `:3080`
2. rebuild and validate on `dev` (`r2`) via `./local-services/start-all.sh dev`
3. keep `dev` warm while you rebuild `stable`
4. once `stable` is back and verified, decide which rail should remain primary

## Manual compose validation

Render the merged compose file:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.override.yml config
```

## Health checks

Stable rail:

```bash
curl -s http://127.0.0.1:8100/health
curl -s http://127.0.0.1:8101/health
curl -s http://127.0.0.1:8102/health
curl -i http://127.0.0.1:3080/api/realtime/models
```

Dev rail:

```bash
curl -s http://127.0.0.1:8110/health
curl -s http://127.0.0.1:8111/health
curl -s http://127.0.0.1:8112/health
curl -i http://127.0.0.1:3081/api/realtime/models
```

A `401 Unauthorized` response from `/api/realtime/models` is expected before login and confirms the app rail is live.

## Validation performed for this change set

### Syntax checks

Validated modified backend JS files with `node --check`.

### Targeted unit tests

Backend:

```bash
npm --prefix api run test:ci -- --runTestsByPath \
  /pool/home/timeng/LibreChat-custom/api/server/services/Files/process.spec.js \
  /pool/home/timeng/LibreChat-custom/api/test/app/clients/tools/util/fileSearch.test.js
```

Packages API:

```bash
npm --prefix packages/api run test:ci -- --runTestsByPath \
  /pool/home/timeng/LibreChat-custom/packages/api/src/files/context.spec.ts
```

### Package builds

Validated affected packages with a higher Node heap setting because the repo build is memory-heavy:

```bash
NODE_OPTIONS=--max_old_space_size=8192 npm --prefix packages/data-provider run build
NODE_OPTIONS=--max_old_space_size=8192 npm --prefix packages/data-schemas run build
NODE_OPTIONS=--max_old_space_size=8192 npm --prefix packages/api run build
```

Note: `packages/api` still emits pre-existing TypeScript warnings in unrelated files during build, but the build completed successfully and the new RAG-related files did not introduce new hard build failures.

### Local rail/runtime validation

Validated after rebuild:

```bash
./local-services/status-all.sh all
curl -fsS http://127.0.0.1:3080/ >/dev/null
curl -fsS http://127.0.0.1:3081/ >/dev/null

for port in 8100 8101 8102 8110 8111 8112; do
  curl -fsS "http://127.0.0.1:${port}/health"
done
```

Current validated state:

- `stable` rail serving on `:3080`
- `dev` rail serving on `:3081`
- all six local RAG containers healthy across both rails
- `status-all.sh all` reports both rails correctly
- `stable` can stay live while `dev` is rebuilt and validated, then `dev` can stay warm while `stable` is restarted

## Current behavior summary

- local file search uses locally built `rag_api` services from a git clone
- embeddings stay on your chosen provider family instead of a separate embedding service
- searches/querying route back to the matching provider-specific local RAG service
- screenshot OCR context now keeps the image and extracted text together
- local startup now enforces the presence of the external `rag_api` clone
- `stable` can stay live while `dev` is rebuilt and validated independently, and `dev` can remain warm during the `stable` restart
- citation hovercards and source panels display the actual text chunk/quote from the RAG query, not just filename and page numbers
- all RAG API calls (embed, query, delete) use retry with exponential backoff on transient failures (429, 502, 503, 504, network errors)

## Citation content display

When file search returns results, the actual text chunk extracted from the document is now visible in:

- **Inline citation hovercards**: hovering a `\ue202turn0fileN` citation pill shows the chunk text in a scrollable panel alongside the filename
- **Source panel file tab**: the "Files" tab in the source panel shows a truncated snippet (up to 500 chars) of the matched chunk
- **Composite citations**: when multiple chunks from the same file match, they are concatenated with `...` separators

Data flow: `rag_api /query` returns `page_content` -> `fileSearch.js` maps it to `sources[].content` -> `Citations/index.js` passes it through -> `useSearchResultsByTurn.ts` maps `content` to `snippet` on the reference -> `SourceHovercard.tsx` / `Sources.tsx` render it.

## Retry and resilience

RAG API calls now include:

- **Embed uploads**: 3 retries with exponential backoff (1s, 2s, 4s), 120s timeout
- **Query calls**: 2 retries with exponential backoff (1s, 2s), 30s timeout
- **Delete calls**: 3 retries with exponential backoff (1s, 2s, 4s), 120s timeout
- Retryable errors: network failures, timeouts, HTTP 429/502/503/504
- Non-retryable errors: HTTP 4xx (except 429) fail immediately

## Container resource configuration

| Container | Memory | CPU | Notes |
|-----------|--------|-----|-------|
| `vectordb` (pgvector) | 512m | 1.0 | `shared_buffers=128MB`, `work_mem=8MB`, `effective_cache_size=256MB`, `shm_size=64m`, `max_connections=50` |
| `rag_api` (each) | 384m | 0.5 | 3 instances (OpenAI, Azure, Google) |

All limits are configurable via `.env` variables: `LIBRECHAT_VECTORDB_MEM_LIMIT`, `LIBRECHAT_VECTORDB_SHM_SIZE`, `LIBRECHAT_VECTORDB_CPUS`, `LIBRECHAT_RAG_MEM_LIMIT`, `LIBRECHAT_RAG_CPUS`.

## Known limits

- provider override is implemented at the request/routing layer, but there is not yet a dedicated frontend selector for manually choosing a different embedding provider from the active chat provider
- the local RAG services currently use the external `rag_api` project’s pgvector backend, not Qdrant
- advanced Docling-specific extraction is not part of this wiring; the flow currently relies on LibreChat’s existing parser/OCR path plus locally hosted `rag_api` for vectorization and retrieval
