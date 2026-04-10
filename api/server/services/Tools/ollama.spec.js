jest.mock('undici', () => ({
  ProxyAgent: jest.fn(),
  fetch: jest.fn(),
}));

const { fetch } = require('undici');
const { Constants, Tools, WebSearchModes } = require('librechat-data-provider');
const {
  OLLAMA_WEB_FETCH_TOOL,
  OLLAMA_SEARCH_FETCH_MCP_SERVER,
  OLLAMA_HOSTED_API_TIMEOUT_MS,
  TOOL_CAPABLE_MODEL_PREFIXES,
  TOOL_INCOMPATIBLE_MODEL_PREFIXES,
  applyOllamaWebSearchMode,
  createOllamaWebFetchTool,
  createOllamaWebSearchTool,
  ensureOllamaSearchMCPServer,
  formatSearchResults,
  getOllamaWebSearchEnabled,
  getOllamaWebSearchMode,
  isOllamaHostedSearchReady,
  isOllamaModelToolCapable,
  ollamaWebSearch,
  ollamaWebFetch,
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

  test('createOllamaWebSearchTool invokes onWebSearchStatus with searching and completed', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{ title: 'R', url: 'https://example.com', content: 'C' }],
      }),
    });

    const onWebSearchStatus = jest.fn();
    const tool = createOllamaWebSearchTool({ onWebSearchStatus });
    const runnableConfig = {
      toolCall: { id: 'tc-1', name: 'web_search', turn: 0 },
      metadata: { user_id: 'u1', thread_id: 't1', run_id: 'r1' },
    };

    await tool.invoke({ query: 'status test' }, runnableConfig);

    expect(onWebSearchStatus).toHaveBeenCalledTimes(2);
    expect(onWebSearchStatus).toHaveBeenNthCalledWith(1, 'searching');
    expect(onWebSearchStatus).toHaveBeenNthCalledWith(2, 'completed');
  });

  test('createOllamaWebSearchTool emits completed status even on API failure', async () => {
    fetch.mockRejectedValue(new Error('network error'));

    const onWebSearchStatus = jest.fn();
    const tool = createOllamaWebSearchTool({ onWebSearchStatus });
    const runnableConfig = { toolCall: { turn: 0 } };

    await tool.invoke({ query: 'fail test' }, runnableConfig);

    expect(onWebSearchStatus).toHaveBeenCalledTimes(2);
    expect(onWebSearchStatus).toHaveBeenNthCalledWith(1, 'searching');
    expect(onWebSearchStatus).toHaveBeenNthCalledWith(2, 'completed');
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

  // --- Hardening: API key gating ---

  describe('isOllamaHostedSearchReady', () => {
    test('returns true when OLLAMA_API_KEY is set', () => {
      process.env.OLLAMA_API_KEY = 'valid-key';
      expect(isOllamaHostedSearchReady()).toBe(true);
    });

    test('returns false when OLLAMA_API_KEY is empty string', () => {
      process.env.OLLAMA_API_KEY = '';
      expect(isOllamaHostedSearchReady()).toBe(false);
    });

    test('returns false when OLLAMA_API_KEY is undefined', () => {
      delete process.env.OLLAMA_API_KEY;
      expect(isOllamaHostedSearchReady()).toBe(false);
    });
  });

  describe('applyOllamaWebSearchMode – API key gating', () => {
    test('falls back to librechat web_search when API key is missing (native mode)', () => {
      delete process.env.OLLAMA_API_KEY;
      const tools = [];
      const mcpServers = new Set();

      applyOllamaWebSearchMode({
        endpoint: 'ollama',
        ephemeralAgent: { web_search: true },
        modelSpec: null,
        tools,
        mcpServers,
      });

      // Should add generic web_search but NOT web_fetch or MCP
      expect(tools).toEqual([Tools.web_search]);
      expect(tools).not.toContain(OLLAMA_WEB_FETCH_TOOL);
      expect(mcpServers.size).toBe(0);
    });

    test('falls back to librechat web_search when API key is missing (MCP mode)', () => {
      delete process.env.OLLAMA_API_KEY;
      const tools = [];
      const mcpServers = new Set();

      applyOllamaWebSearchMode({
        endpoint: 'ollama',
        ephemeralAgent: { web_search: true, web_search_mode: WebSearchModes.ollama_mcp },
        modelSpec: null,
        tools,
        mcpServers,
      });

      // Should add generic web_search, NOT MCP server
      expect(tools).toEqual([Tools.web_search]);
      expect(mcpServers.size).toBe(0);
    });
  });

  // --- Hardening: request timeout ---

  describe('callOllamaHostedAPI – timeout', () => {
    test('ollamaWebSearch includes a signal for timeout enforcement', async () => {
      fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ results: [] }),
      });

      await ollamaWebSearch({ query: 'test' });

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        }),
      );
    });

    test('ollamaWebSearch surfaces a timeout error message', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      fetch.mockRejectedValue(abortError);

      await expect(ollamaWebSearch({ query: 'slow' })).rejects.toThrow(/timed out/);
    });

    test('ollamaWebSearch surfaces network errors', async () => {
      fetch.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(ollamaWebSearch({ query: 'unreachable' })).rejects.toThrow(/ECONNREFUSED/);
    });

    test('OLLAMA_HOSTED_API_TIMEOUT_MS is exported and positive', () => {
      expect(OLLAMA_HOSTED_API_TIMEOUT_MS).toBeGreaterThan(0);
    });
  });

  // --- Hardening: tool error recovery ---

  describe('createOllamaWebSearchTool – error recovery', () => {
    // LangChain tool.invoke() with content_and_artifact returns only the
    // content string.  The artifact is consumed internally by the agent
    // framework, so we test callback behaviour for error propagation.

    test('returns descriptive error message on API failure instead of throwing', async () => {
      fetch.mockRejectedValue(new Error('OLLAMA_API_KEY is not configured'));

      const onSearchResults = jest.fn();
      const searchTool = createOllamaWebSearchTool({ onSearchResults });
      const runnableConfig = { toolCall: { turn: 0 } };

      // invoke should NOT throw – it should return an error string
      const result = await searchTool.invoke({ query: 'fail test' }, runnableConfig);

      expect(typeof result).toBe('string');
      expect(result).toContain('Ollama web search failed');
      expect(result).toContain('answer without web results');

      // onSearchResults should be called with success=false
      expect(onSearchResults).toHaveBeenCalledTimes(1);
      expect(onSearchResults.mock.calls[0][0].success).toBe(false);
    });

    test('handles API response with missing results array gracefully', async () => {
      fetch.mockResolvedValue({
        ok: true,
        json: async () => ({}), // no results field
      });

      const searchTool = createOllamaWebSearchTool();
      const runnableConfig = { toolCall: { turn: 0 } };
      const result = await searchTool.invoke({ query: 'empty test' }, runnableConfig);

      expect(typeof result).toBe('string');
      expect(result).toContain('No web results found');
    });
  });

  describe('createOllamaWebFetchTool – error recovery', () => {
    test('returns descriptive error message on fetch failure instead of throwing', async () => {
      fetch.mockRejectedValue(new Error('ECONNREFUSED'));

      const fetchTool = createOllamaWebFetchTool();
      const runnableConfig = { toolCall: { turn: 0 } };
      const result = await fetchTool.invoke({ url: 'https://example.com/page' }, runnableConfig);

      expect(typeof result).toBe('string');
      expect(result).toContain('Ollama web fetch failed');
      expect(result).toContain('ECONNREFUSED');
    });

    test('succeeds with valid response', async () => {
      fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          title: 'Example Page',
          content: 'Page content here',
        }),
      });

      const fetchTool = createOllamaWebFetchTool();
      const runnableConfig = { toolCall: { turn: 0 } };
      const result = await fetchTool.invoke({ url: 'https://example.com/page' }, runnableConfig);

      expect(typeof result).toBe('string');
      expect(result).toContain('Example Page');
      expect(result).toContain('Page content here');
    });
  });

  // --- Hardening: missing API key at invocation ---

  describe('ollamaWebSearch / ollamaWebFetch – missing API key', () => {
    test('ollamaWebSearch throws descriptive error when API key is missing', async () => {
      delete process.env.OLLAMA_API_KEY;
      await expect(ollamaWebSearch({ query: 'test' })).rejects.toThrow(/OLLAMA_API_KEY/);
    });

    test('ollamaWebFetch throws descriptive error when API key is missing', async () => {
      delete process.env.OLLAMA_API_KEY;
      await expect(ollamaWebFetch({ url: 'https://example.com' })).rejects.toThrow(
        /OLLAMA_API_KEY/,
      );
    });
  });

  // --- Tool-capability gating ---

  describe('isOllamaModelToolCapable', () => {
    test('returns true for known tool-capable model families', () => {
      expect(isOllamaModelToolCapable('llama3.1')).toBe(true);
      expect(isOllamaModelToolCapable('llama3.1:8b')).toBe(true);
      expect(isOllamaModelToolCapable('llama3.1:70b-instruct-q4_0')).toBe(true);
      expect(isOllamaModelToolCapable('qwen2.5:latest')).toBe(true);
      expect(isOllamaModelToolCapable('qwen2.5:7b')).toBe(true);
      expect(isOllamaModelToolCapable('deepseek-r1:14b')).toBe(true);
      expect(isOllamaModelToolCapable('deepseek-r1:latest')).toBe(true);
      expect(isOllamaModelToolCapable('mistral:latest')).toBe(true);
      expect(isOllamaModelToolCapable('command-r:latest')).toBe(true);
      expect(isOllamaModelToolCapable('command-r-plus:latest')).toBe(true);
      expect(isOllamaModelToolCapable('firefunction-v2:latest')).toBe(true);
      expect(isOllamaModelToolCapable('phi4:latest')).toBe(true);
      expect(isOllamaModelToolCapable('gpt-oss:latest')).toBe(true);
    });

    test('returns false for known tool-incompatible model families', () => {
      expect(isOllamaModelToolCapable('llama2:latest')).toBe(false);
      expect(isOllamaModelToolCapable('llama2:13b')).toBe(false);
      expect(isOllamaModelToolCapable('llama3:latest')).toBe(false);
      expect(isOllamaModelToolCapable('llama3:8b')).toBe(false);
      expect(isOllamaModelToolCapable('codellama:latest')).toBe(false);
      expect(isOllamaModelToolCapable('gemma:latest')).toBe(false);
      expect(isOllamaModelToolCapable('gemma2:latest')).toBe(false);
      expect(isOllamaModelToolCapable('phi:latest')).toBe(false);
      expect(isOllamaModelToolCapable('vicuna:latest')).toBe(false);
      expect(isOllamaModelToolCapable('tinyllama:latest')).toBe(false);
    });

    test('returns null for unknown model names', () => {
      expect(isOllamaModelToolCapable('some-unknown-model:latest')).toBeNull();
      expect(isOllamaModelToolCapable('custom-finetune:v1')).toBeNull();
    });

    test('returns null for undefined/empty/non-string input', () => {
      expect(isOllamaModelToolCapable(undefined)).toBeNull();
      expect(isOllamaModelToolCapable(null)).toBeNull();
      expect(isOllamaModelToolCapable('')).toBeNull();
      expect(isOllamaModelToolCapable(123)).toBeNull();
    });

    test('is case-insensitive', () => {
      expect(isOllamaModelToolCapable('Llama3.1:8B')).toBe(true);
      expect(isOllamaModelToolCapable('QWEN2.5:latest')).toBe(true);
      expect(isOllamaModelToolCapable('GEMMA:latest')).toBe(false);
    });

    test('exported prefix lists are non-empty arrays', () => {
      expect(Array.isArray(TOOL_CAPABLE_MODEL_PREFIXES)).toBe(true);
      expect(TOOL_CAPABLE_MODEL_PREFIXES.length).toBeGreaterThan(0);
      expect(Array.isArray(TOOL_INCOMPATIBLE_MODEL_PREFIXES)).toBe(true);
      expect(TOOL_INCOMPATIBLE_MODEL_PREFIXES.length).toBeGreaterThan(0);
    });
  });

  describe('getOllamaWebSearchMode – tool-capability gating', () => {
    test('falls back to librechat for known tool-incompatible model', () => {
      expect(
        getOllamaWebSearchMode({
          endpoint: 'Ollama',
          enabled: true,
          model: 'gemma2:latest',
        }),
      ).toBe(WebSearchModes.librechat);
    });

    test('falls back to librechat for incompatible model even when MCP is preferred', () => {
      expect(
        getOllamaWebSearchMode({
          endpoint: 'Ollama',
          ephemeralAgent: { web_search_mode: WebSearchModes.ollama_mcp },
          enabled: true,
          model: 'llama2:13b',
        }),
      ).toBe(WebSearchModes.librechat);
    });

    test('keeps native mode for known tool-capable model', () => {
      expect(
        getOllamaWebSearchMode({
          endpoint: 'Ollama',
          enabled: true,
          model: 'llama3.1:8b',
        }),
      ).toBe(WebSearchModes.ollama_native);
    });

    test('keeps native mode for unknown model (optimistic default)', () => {
      expect(
        getOllamaWebSearchMode({
          endpoint: 'Ollama',
          enabled: true,
          model: 'some-custom-model:latest',
        }),
      ).toBe(WebSearchModes.ollama_native);
    });

    test('keeps native mode when model is not provided', () => {
      expect(
        getOllamaWebSearchMode({
          endpoint: 'Ollama',
          enabled: true,
        }),
      ).toBe(WebSearchModes.ollama_native);
    });

    test('still respects explicit agentTools override even with incompatible model', () => {
      // agentTools override takes precedence (already-configured agent tools)
      expect(
        getOllamaWebSearchMode({
          endpoint: 'Ollama',
          enabled: true,
          model: 'gemma2:latest',
          agentTools: [Tools.web_search, OLLAMA_WEB_FETCH_TOOL],
        }),
      ).toBe(WebSearchModes.ollama_native);
    });
  });

  describe('applyOllamaWebSearchMode – tool-capability gating', () => {
    test('falls back to librechat web_search for tool-incompatible model', () => {
      const tools = [];
      const mcpServers = new Set();

      applyOllamaWebSearchMode({
        endpoint: 'ollama',
        ephemeralAgent: { web_search: true },
        modelSpec: null,
        tools,
        mcpServers,
        model: 'gemma2:latest',
      });

      // Should add generic web_search but NOT web_fetch
      expect(tools).toEqual([Tools.web_search]);
      expect(tools).not.toContain(OLLAMA_WEB_FETCH_TOOL);
      expect(mcpServers.size).toBe(0);
    });

    test('uses native tools for tool-capable model', () => {
      const tools = [];
      const mcpServers = new Set();

      applyOllamaWebSearchMode({
        endpoint: 'ollama',
        ephemeralAgent: { web_search: true },
        modelSpec: null,
        tools,
        mcpServers,
        model: 'llama3.1:8b',
      });

      expect(tools).toEqual([Tools.web_search, OLLAMA_WEB_FETCH_TOOL]);
      expect(mcpServers.size).toBe(0);
    });

    test('uses native tools for unknown model (optimistic default)', () => {
      const tools = [];
      const mcpServers = new Set();

      applyOllamaWebSearchMode({
        endpoint: 'ollama',
        ephemeralAgent: { web_search: true },
        modelSpec: null,
        tools,
        mcpServers,
        model: 'some-custom-model:v1',
      });

      expect(tools).toEqual([Tools.web_search, OLLAMA_WEB_FETCH_TOOL]);
      expect(mcpServers.size).toBe(0);
    });

    test('resolves model from requestBody when model param is not provided', () => {
      const tools = [];
      const mcpServers = new Set();

      applyOllamaWebSearchMode({
        endpoint: 'ollama',
        ephemeralAgent: { web_search: true },
        modelSpec: null,
        requestBody: { model: 'gemma:7b' },
        tools,
        mcpServers,
      });

      // gemma is tool-incompatible, should fall back
      expect(tools).toEqual([Tools.web_search]);
      expect(tools).not.toContain(OLLAMA_WEB_FETCH_TOOL);
    });

    test('falls back to librechat for MCP mode with tool-incompatible model', () => {
      const tools = [];
      const mcpServers = new Set();

      applyOllamaWebSearchMode({
        endpoint: 'ollama',
        ephemeralAgent: { web_search: true, web_search_mode: WebSearchModes.ollama_mcp },
        modelSpec: null,
        tools,
        mcpServers,
        model: 'llama2:13b',
      });

      // MCP mode also requires tool calling, should fall back
      expect(tools).toEqual([Tools.web_search]);
      expect(mcpServers.size).toBe(0);
    });
  });
});
