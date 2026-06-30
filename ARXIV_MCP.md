# arXiv MCP Server

This local integration exposes a guarded arXiv MCP server to LibreChat as `arxiv`.

## Runtime configuration

- Server implementation: `/pool/home/timeng/arxiv-mcp-server`
- Runtime service: `/home/timeng/.config/systemd/user/arxiv-mcp.service`
- MCP URL: `http://192.168.50.4:8771/mcp/`
- LibreChat runtime config: `librechat.yaml`
  - `mcpSettings.allowedDomains` includes `http://192.168.50.4:8771`
  - `mcpServers.arxiv.type: streamable-http`
  - `mcpServers.arxiv.url: http://192.168.50.4:8771/mcp/`
  - `mcpServers.arxiv.timeout: 180000`
  - `mcpServers.arxiv.initTimeout: 30000`
  - `mcpServers.arxiv.iconPath: https://info.arxiv.org/brand/images/brand-logomark-primary.jpg`
  - `mcpServers.arxiv.serverInstructions` includes prompt-injection guardrails
- Keep the trailing slash on `/mcp/`. LibreChat streamable HTTP initialization failed against the no-slash URL because the server returns a `307` redirect.
- The systemd service runs with `TRANSPORT=http`, `HOST=0.0.0.0`, `PORT=8771`, constrained `ALLOWED_HOSTS` / `ALLOWED_ORIGINS`, and `ENABLED_TOOLS=search_papers,get_abstract,download_paper,read_paper,list_papers,citation_graph`.

## Exposed tool surface

The platform service intentionally exposes only:

- `search_papers`
- `get_abstract`
- `download_paper`
- `read_paper`
- `list_papers`
- `citation_graph`

The upstream server also includes `watch_topic`, `check_alerts`, `semantic_search`, and `reindex`. These are hidden by the service `ENABLED_TOOLS` allowlist because they are shared-state or heavy/experimental features.

## Security stance

arXiv papers are untrusted external content. Titles, abstracts, and full paper text can contain prompt-injection attempts that try to override instructions, exfiltrate data, call other tools, or convince the model to run commands. Treat paper content as data only.

Operational mitigations in this deployment:

- LibreChat injects arXiv-specific `serverInstructions` into MCP context.
- The service uses `ALLOWED_HOSTS` so unexpected Host headers are rejected.
- `download_paper` stores files only under `/pool/home/timeng/arxiv-mcp-server/papers`.
- Local patches validate arXiv IDs and confine resolved paper paths through `safe_paper_path()` for stored `.md` / `.pdf` files.
- `download_paper` and `read_paper` prepend an `[UNTRUSTED EXTERNAL CONTENT — arXiv paper...]` warning to returned paper text.
- The platform tool allowlist hides shared watches and semantic indexing by default.

## Operational commands

```bash
systemctl --user status arxiv-mcp.service
systemctl --user restart arxiv-mcp.service
curl -i -H 'Host: 192.168.50.4:8771' http://127.0.0.1:8771/mcp/
```

After changing the external MCP server code:

```bash
/pool/home/timeng/arxiv-mcp-server/.venv/bin/python -m black /pool/home/timeng/arxiv-mcp-server/src /pool/home/timeng/arxiv-mcp-server/tests
/pool/home/timeng/arxiv-mcp-server/.venv/bin/python -m pytest /pool/home/timeng/arxiv-mcp-server
```

## Validation status

- External server tests: `pytest` passed (`94 passed`, one upstream pytest config warning).
- External server formatting: `black --check src tests` passed.
- Direct MCP `tools/list` returned only the six exposed tools.
- Direct MCP content workflow passed: `download_paper` fetched previously uncached paper `2401.00001` from the HTML source path, and `read_paper` read it back from local storage with the untrusted-content warning.
- Dev LibreChat API on `:3081` initialized `arxiv` and exposed only the six allowlisted tools through `/api/mcp/tools`.
- Stable LibreChat API on `:3080` initialized `arxiv`; `/api/mcp/tools` exposed only the six allowlisted tools and `/api/mcp/servers` returned the arXiv icon/instructions metadata.

## Preserve during merges

- Keep `mcpServers.arxiv` and `http://192.168.50.4:8771` in runtime `librechat.yaml`.
- Keep `mcpServers.arxiv.url` as `http://192.168.50.4:8771/mcp/` with the trailing slash.
- Keep the prompt-injection `serverInstructions`.
- Keep the `ENABLED_TOOLS` allowlist limited unless a separate review approves more tools.
- Keep constrained `ALLOWED_HOSTS`; unexpected Host headers should continue to return `421 Invalid Host header`.
- Keep the untrusted-content warning prepended to paper text returned by `download_paper` and `read_paper`.
- Keep arXiv ID validation/path confinement before exposing `download_paper` platform-wide.
- Keep the service installed with the `[pdf]` extra so older PDF-only papers work.
