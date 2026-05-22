# Internet Archive MCP Server

This local integration exposes a read-only Internet Archive / Wayback Machine MCP server to LibreChat as `internet-archive`.

## Runtime configuration

- Server implementation: `/pool/home/timeng/internet-archive-mcp-server`
- Runtime service: `/home/timeng/.config/systemd/user/internet-archive-mcp.service`
- MCP URL: `http://192.168.50.4:8770/mcp`
- Health URL: `http://192.168.50.4:8770/health`
- LibreChat runtime config: `librechat.yaml`
  - `mcpSettings.allowedDomains` includes `http://192.168.50.4:8770`
  - `mcpServers.internet-archive.type: streamable-http`
  - `mcpServers.internet-archive.url: http://192.168.50.4:8770/mcp`
  - `mcpServers.internet-archive.timeout: 90000`

## Read-only tool surface

The server exposes 19 read-only tools:

- Capabilities: `get_server_capabilities`
- Wayback availability and capture discovery: `wayback_available`, `wayback_cdx_search`, `wayback_cdx_capture_summary`, `wayback_snapshot_url`
- Wayback content retrieval and comparison: `wayback_fetch_snapshot_text`, `wayback_fetch_snapshot_source`, `wayback_compare_snapshots`
- archive.org item discovery: `archive_search_items`, `archive_advanced_search`
- Metadata and files: `archive_metadata`, `archive_metadata_field`, `archive_file_list`, `archive_fetch_file_text`, `archive_item_full_text`
- Public social/usage data: `archive_item_reviews`, `archive_item_views`
- Simple Lists: `archive_simplelists_for_item`, `archive_simplelist_children`

## Intentional exclusions

Keep this integration read-only unless there is a separate security review and explicit approval. The server intentionally does **not** expose:

- Save Page Now / crawl submission
- uploads or deletes
- metadata writes
- review writes/deletes
- relationship writes
- task submission/rerun APIs

## Operational commands

```bash
systemctl --user status internet-archive-mcp.service
systemctl --user restart internet-archive-mcp.service
curl -fsS http://127.0.0.1:8770/health
```

After changing the external MCP server code, validate it before restarting LibreChat:

```bash
/pool/home/timeng/internet-archive-mcp-server/.venv/bin/python -m ruff check /pool/home/timeng/internet-archive-mcp-server
/pool/home/timeng/internet-archive-mcp-server/.venv/bin/python -m pytest /pool/home/timeng/internet-archive-mcp-server
```

## Validation status

Initial rollout validation passed:

- `ruff check`
- `pytest` with 19 tests
- live MCP `tools/list` showing all 19 tools
- representative live tool calls for Wayback, archive.org search/metadata/files, reviews, views, and Simple Lists
- stable LibreChat logs showing `internet-archive` loaded with all 19 tools

## Preserve during merges

- Keep `mcpServers.internet-archive` in runtime `librechat.yaml`.
- Keep `http://192.168.50.4:8770` in `mcpSettings.allowedDomains`.
- Preserve the Internet Archive-compliant User-Agent, retry/`Retry-After` handling, local rate limiting, and bounded output limits.
- Keep binary-derivative safeguards in full-text selection so `Text PDF` or other binary formats are not treated as plain text.
