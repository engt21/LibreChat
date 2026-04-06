jest.mock('undici', () => ({
  ProxyAgent: jest.fn(),
  fetch: jest.fn(),
}));

const { fetch } = require('undici');
const { Constants, Tools, WebSearchModes } = require('librechat-data-provider');
const {
  OLLAMA_WEB_FETCH_TOOL,
  OLLAMA_SEARCH_FETCH_MCP_SERVER,
  applyOllamaWebSearchMode,
  createOllamaWebSearchTool,
  ensureOllamaSearchMCPServer,
  formatSearchResults,
  getOllamaWebSearchEnabled,
  getOllamaWebSearchMode,
  ollamaWebSearch,
} = require('./ollama');

describe('server/services/Tools/ollama', () => {
  const originalApiKey = process.env.OLLAMA_API_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.OLLAMA_API_KEY = 'test-ollama-key';
  });

  afterAll(() => {
    process.env.OLLAMA_API_KEY = originalApiKey;
  });

  test('ensureOllamaSearchMCPServer injects the hidden Ollama MCP server', () => {
    const config = {};
    ensureOllamaSearchMCPServer(config, '/repo');

    expect(config.mcpServers?.[OLLAMA_SEARCH_FETCH_MCP_SERVER]).toMatchObject({
      type: 'stdio',
      command: process.execPath,
      startup: true,
      chatMenu: false,
    });
    expect(config.mcpServers?.[OLLAMA_SEARCH_FETCH_MCP_SERVER]?.args?.[0]).toBe(
      '/repo/api/server/mcp/ollama-search-fetch.js',
    );
  });

  test('applyOllamaWebSearchMode adds native tools for Ollama by default', () => {
    const tools = [];
    const mcpServers = new Set();

    applyOllamaWebSearchMode({
      endpoint: 'ollama',
      ephemeralAgent: { web_search: true },
      modelSpec: null,
      tools,
      mcpServers,
    });

    expect(tools).toEqual([Tools.web_search, OLLAMA_WEB_FETCH_TOOL]);
    expect(mcpServers.size).toBe(0);
  });

  test('applyOllamaWebSearchMode adds hidden MCP server in MCP mode', () => {
    const tools = [];
    const mcpServers = new Set();

    applyOllamaWebSearchMode({
      endpoint: 'ollama',
      ephemeralAgent: { web_search: true, web_search_mode: WebSearchModes.ollama_mcp },
      modelSpec: null,
      tools,
      mcpServers,
    });

    expect(tools).toEqual([]);
    expect(mcpServers.has(OLLAMA_SEARCH_FETCH_MCP_SERVER)).toBe(true);
  });

  test('applyOllamaWebSearchMode honors the sidebar web_search request for Ollama chats', () => {
    const tools = [];
    const mcpServers = new Set();

    applyOllamaWebSearchMode({
      endpoint: 'Ollama',
      ephemeralAgent: undefined,
      modelSpec: null,
      requestBody: { web_search: true },
      tools,
      mcpServers,
    });

    expect(tools).toEqual([Tools.web_search, OLLAMA_WEB_FETCH_TOOL]);
    expect(mcpServers.size).toBe(0);
  });

  test('getOllamaWebSearchEnabled prefers explicit ephemeral tool toggles over sidebar params', () => {
    expect(
      getOllamaWebSearchEnabled({
        endpoint: 'Ollama',
        ephemeralAgent: { web_search: false },
        modelSpec: { webSearch: true },
        requestBody: { web_search: true },
      }),
    ).toBe(false);
  });

  test('getOllamaWebSearchMode prefers native Ollama agent tools during execution', () => {
    expect(
      getOllamaWebSearchMode({
        endpoint: 'Ollama',
        requestBody: { web_search_mode: WebSearchModes.librechat },
        enabled: true,
        agentTools: [Tools.web_search, OLLAMA_WEB_FETCH_TOOL],
      }),
    ).toBe(WebSearchModes.ollama_native);
  });

  test('getOllamaWebSearchMode prefers hidden MCP server tools during execution', () => {
    expect(
      getOllamaWebSearchMode({
        endpoint: 'Ollama',
        requestBody: { web_search_mode: WebSearchModes.librechat },
        enabled: true,
        agentTools: [`web_search${Constants.mcp_delimiter}${OLLAMA_SEARCH_FETCH_MCP_SERVER}`],
      }),
    ).toBe(WebSearchModes.ollama_mcp);
  });

  test('createOllamaWebSearchTool configures the native Ollama search tool', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            title: 'Result 1',
            url: 'https://example.com/1',
            content: 'Snippet 1',
          },
        ],
      }),
    });

    const tool = createOllamaWebSearchTool();
    const response = await ollamaWebSearch({ query: 'latest ollama news' });

    expect(tool.name).toBe(Tools.web_search);
    expect(fetch).toHaveBeenCalledWith(
      'https://ollama.com/api/web_search',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-ollama-key',
        }),
      }),
    );
    expect(formatSearchResults('latest ollama news', response.results)).toContain(
      'Search results for "latest ollama news"',
    );
    expect(response.results[0]).toMatchObject({
      title: 'Result 1',
      url: 'https://example.com/1',
    });
  });

  test('createOllamaWebSearchTool invokes onSearchResults callback with attachment data', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { title: 'Result A', url: 'https://example.com/a', content: 'Content A' },
          { title: 'Result B', url: 'https://example.com/b', content: 'Content B' },
        ],
      }),
    });

    const onSearchResults = jest.fn();
    const tool = createOllamaWebSearchTool({ onSearchResults });
    const runnableConfig = {
      toolCall: { id: 'tc-1', name: 'web_search', turn: 0 },
      metadata: { user_id: 'u1', thread_id: 't1', run_id: 'r1' },
    };

    await tool.invoke({ query: 'test query', max_results: 2 }, runnableConfig);

    expect(onSearchResults).toHaveBeenCalledTimes(1);
    const [callbackArg] = onSearchResults.mock.calls[0];
    expect(callbackArg.success).toBe(true);
    expect(callbackArg.data).toBeDefined();
    expect(callbackArg.data.organic).toHaveLength(2);
    expect(callbackArg.data.organic[0]).toMatchObject({
      title: 'Result A',
      link: 'https://example.com/a',
      processed: true,
    });
    expect(callbackArg.data.references).toHaveLength(2);
    expect(callbackArg.data.references[0]).toMatchObject({
      link: 'https://example.com/a',
      type: 'link',
    });
  });

  test('applyOllamaWebSearchMode adds librechat web_search for non-Ollama when enabled', () => {
    const tools = [];
    const mcpServers = new Set();

    applyOllamaWebSearchMode({
      endpoint: 'openAI',
      ephemeralAgent: { web_search: true },
      modelSpec: null,
      tools,
      mcpServers,
    });

    // Non-Ollama endpoint: falls back to librechat mode which adds web_search
    expect(tools).toEqual([Tools.web_search]);
    expect(mcpServers.size).toBe(0);
    // Importantly: does NOT add web_fetch (Ollama-only tool)
    expect(tools).not.toContain(OLLAMA_WEB_FETCH_TOOL);
  });

  test('applyOllamaWebSearchMode is a no-op when web search is disabled', () => {
    const tools = [];
    const mcpServers = new Set();

    applyOllamaWebSearchMode({
      endpoint: 'ollama',
      ephemeralAgent: { web_search: false },
      modelSpec: null,
      tools,
      mcpServers,
    });

    expect(tools).toEqual([]);
    expect(mcpServers.size).toBe(0);
  });
});
