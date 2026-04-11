# Ollama Runtime Validation Surface

## Last verified: 2026-04-10

## Configured Endpoints (librechat.yaml)

### 1. `Ollama` (local/hosted models)
- **baseURL**: `http://192.168.50.201:11434/v1/`
- **baseURLs**: `http://192.168.50.4:8080/v1/` (llama.cpp router)
- **apiKey**: `${OLLAMA_MULTI_API_KEY}` (configured in `.env`)
- **models**: 14 available on primary endpoint, 10 on router
- **fetch**: false (static model list from config)

### 2. `Ollama Cloud` (hosted Ollama cloud models)
- **baseURL**: `https://ollama.com/v1/`
- **apiKey**: `user_provided`
- **fetch**: true (dynamic model discovery)

## Tool-Capable Models (per `isOllamaModelToolCapable()` in `api/server/services/Tools/ollama.js`)

Confirmed available and tool-capable on `http://192.168.50.201:11434`:
- `qwen3:14b` ✅ (family: qwen3, has tool template support)
- `qwen3-coder:latest` ✅ (family: qwen3)
- `qwen2.5:14b` ✅ (matches `qwen2.5`)
- `qwen2.5-coder:14b` ✅ (matches `qwen2.5`)
- `qwen2.5:latest` ✅ (matches `qwen2.5`)
- `qwen2.5-coder:latest` ✅ (matches `qwen2.5`)
- `deepseek-r1:14b` ✅ (matches `deepseek-r1`)
- `gpt-oss:20b` ✅ (matches `gpt-oss`)

Confirmed tool-capable on `http://192.168.50.4:8080/v1/` (llama.cpp router):
- `qwen2.5-14b-instruct-q3`, `qwen2.5-14b-instruct-q4`, `qwen2.5-7b-instruct` (matches `qwen2.5`)
- `llama-3.1-8b-instruct` (matches `llama3.1`)
- `mistral-7b-instruct-v0.3` (matches `mistral`)
- `deepseek-r1-distill-qwen-7b` (matches `deepseek-r1`)

Models NOT tool-capable per the prefix list:
- `llama3:latest` (matches `llama3:` incompatible prefix)
- `gemma3:latest` (returns null/unknown - `gemma` prefix doesn't match `gemma3`)

## Hosted Web Search API

- **Endpoint**: `https://ollama.com/api/web_search`
- **Auth**: Bearer token via `OLLAMA_API_KEY`
- **Status**: ❌ Returns 401 Unauthorized with current configured key
- **Impact**: `ollama_native` and `ollama_mcp` web search modes will fall back to LibreChat's own search stack until the API key is refreshed
- **Note**: The local Ollama model serving endpoints are fully reachable; only the hosted web-search/web-fetch APIs are affected

## Recommended Model for Live Validation

For the follow-up `stabilize-ollama-live-search-reasoning-and-status-contract`:
- **Primary candidate**: `qwen3:14b` — tool-capable, supports reasoning, available on primary Ollama server
- **Fallback**: `qwen2.5:14b` — tool-capable, proven stable

## Keep-Warm Service

The `librechat-ollama-keepwarm` systemd timer runs every ~30 min but is failing with timeout (curl 28). The `/api/generate` call to load `gptossbigctx:latest` takes >180s on cold start. This is a warm-up latency issue, not a reachability problem.
