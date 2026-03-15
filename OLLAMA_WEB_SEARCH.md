# Ollama Web Search in LibreChat

LibreChat can expose Ollama-hosted web tools to chats that use the dedicated `Ollama` custom endpoint.

## What LibreChat adds

For Ollama chats, `Tools -> Web Search` supports three modes:

- `librechat`: LibreChat's normal web-search stack
- `ollama_native`: binds Ollama-hosted `web_search` and `web_fetch` directly to the model
- `ollama_mcp`: exposes the same Ollama-hosted tools through a hidden MCP server

The default Ollama mode is `ollama_native`.

## What the tools do

In native mode, LibreChat exposes:

- `web_search(query, max_results)`
- `web_fetch(url)`

LibreChat executes those tool calls against Ollama's hosted web APIs:

- `https://ollama.com/api/web_search`
- `https://ollama.com/api/web_fetch`

Responses are converted into normal tool text plus LibreChat `web_search` artifacts so the model can read the results and the UI can render sources.

`web_fetch` exists so the model can open a specific result after searching.

## Requirements

- Configure `OLLAMA_API_KEY` on the LibreChat server
- Use the dedicated `Ollama` custom endpoint in `librechat.yaml`
- Enable `Tools -> Web Search` in the chat input

Example environment variable:

```bash
OLLAMA_API_KEY=your_ollama_api_key
```

## Native vs MCP mode

### `ollama_native`

- Best when the selected Ollama model already handles normal tool calls correctly
- LibreChat binds `web_search` and `web_fetch` directly
- Fewer moving parts

### `ollama_mcp`

- Best when you want the same Ollama-hosted capabilities exposed through MCP
- LibreChat starts a hidden `ollama_search_fetch` MCP server
- That server exposes `web_search` and `web_fetch`

Both modes still call Ollama's hosted web APIs. The difference is how the tools are presented to the model.

## Important behavior note

The model can be local while the search backend is remote.

That means:

- your chat model can still be your local or self-hosted Ollama model
- the actual web search and page fetch requests go to Ollama's hosted API

So this is not a fully local search index. It is local-model + hosted-search.

## Official Ollama references

The following official Ollama pages describe the capability and related cloud/auth behavior:

- Web search docs: <https://docs.ollama.com/capabilities/web-search>
- API authentication docs: <https://docs.ollama.com/api/authentication>
- API introduction docs: <https://docs.ollama.com/api/introduction>
- Web search launch post: <https://ollama.com/blog/web-search>
- Cloud overview: <https://ollama.com/cloud>
- Pricing / FAQ: <https://ollama.com/pricing>

From Ollama's published docs and pages:

- Ollama describes web search as a REST API with deeper tool integrations in the Python and JavaScript libraries
- Ollama explicitly calls out long-running research/task use cases for models such as `gpt-oss`
- Ollama's API docs note that cloud access uses API keys, while local `http://localhost:11434` access does not require auth unless you add your own gateway in front of it

## Data retention / privacy note

As of the official Ollama cloud and pricing pages referenced above:

- Ollama states that it "does not retain your data"
- Ollama also states it does not log prompt or response data for cloud usage

Practical reading for LibreChat users:

- prompts sent to Ollama-hosted `web_search` / `web_fetch` are leaving your machine
- Ollama says it does not retain that data
- the query still results in network access to Ollama's hosted service and, for fetches, to external websites

If you require fully local-only behavior with no external network dependency, do not use Ollama hosted web search mode.

## Related Ollama settings

LibreChat also now exposes an Ollama-specific reasoning control profile for the dedicated `Ollama` endpoint.

- supported reasoning values are `auto`, `none`, `low`, `medium`, and `high`
- when reasoning is set to `none`, LibreChat suppresses streamed reasoning output and hides leaked Ollama reasoning blocks in the UI

See [./OLLAMA_REASONING.md](./OLLAMA_REASONING.md) for details.
