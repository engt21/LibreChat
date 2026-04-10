const path = require('path');
const { fetch, ProxyAgent } = require('undici');
const { tool } = require('@langchain/core/tools');
const { z } = require('zod');
const { Constants: AgentConstants } = require('@librechat/agents');
const { logger } = require('@librechat/data-schemas');
const { Constants, Tools, KnownEndpoints, WebSearchModes } = require('librechat-data-provider');

const OLLAMA_WEB_FETCH_TOOL = 'web_fetch';
const OLLAMA_SEARCH_FETCH_MCP_SERVER = 'ollama_search_fetch';
const OLLAMA_WEB_SEARCH_API_URL = 'https://ollama.com/api/web_search';
const OLLAMA_WEB_FETCH_API_URL = 'https://ollama.com/api/web_fetch';

/** Request timeout for Ollama hosted API calls (30 seconds). */
const OLLAMA_HOSTED_API_TIMEOUT_MS = 30_000;

function isOllamaEndpoint(endpoint) {
  return typeof endpoint === 'string' && endpoint.toLowerCase().startsWith(KnownEndpoints.ollama);
}

function getOllamaWebSearchEnabled({ endpoint, ephemeralAgent, modelSpec, requestBody }) {
  if (ephemeralAgent?.web_search != null) {
    return ephemeralAgent.web_search === true;
  }

  if (isOllamaEndpoint(endpoint) && typeof requestBody?.web_search === 'boolean') {
    return requestBody.web_search;
  }

  return modelSpec?.webSearch === true;
}

function getOllamaWebSearchMode({ endpoint, ephemeralAgent, requestBody, enabled, agentTools }) {
  if (!enabled || !isOllamaEndpoint(endpoint)) {
    return WebSearchModes.librechat;
  }

  if (Array.isArray(agentTools)) {
    if (agentTools.includes(OLLAMA_WEB_FETCH_TOOL)) {
      return WebSearchModes.ollama_native;
    }

    const mcpServerSuffix = `${Constants.mcp_delimiter}${OLLAMA_SEARCH_FETCH_MCP_SERVER}`;
    if (
      agentTools.some(
        (tool) =>
          typeof tool === 'string' &&
          (tool === `${Constants.mcp_all}${mcpServerSuffix}` || tool.endsWith(mcpServerSuffix)),
      )
    ) {
      return WebSearchModes.ollama_mcp;
    }
  }

  return (
    ephemeralAgent?.web_search_mode ?? requestBody?.web_search_mode ?? WebSearchModes.ollama_native
  );
}

/**
 * Check whether the Ollama hosted web-search backend is configured.
 * Returns `true` when `OLLAMA_API_KEY` is present so tools can be registered;
 * returns `false` otherwise.  Callers should either skip Ollama-native/MCP
 * registration or fall back to the default LibreChat search stack.
 *
 * @returns {boolean}
 */
function isOllamaHostedSearchReady() {
  return typeof process.env.OLLAMA_API_KEY === 'string' && process.env.OLLAMA_API_KEY.length > 0;
}

function applyOllamaWebSearchMode({
  endpoint,
  ephemeralAgent,
  modelSpec,
  requestBody,
  tools,
  mcpServers,
}) {
  const enabled = getOllamaWebSearchEnabled({ endpoint, ephemeralAgent, modelSpec, requestBody });
  if (!enabled) {
    return;
  }

  const mode = getOllamaWebSearchMode({ endpoint, ephemeralAgent, requestBody, enabled });

  // Gate Ollama-hosted modes on API key availability.  Without the key every
  // tool invocation would throw, so fall back to the generic LibreChat search
  // stack (if available) instead of registering broken Ollama tools.
  if (
    (mode === WebSearchModes.ollama_native || mode === WebSearchModes.ollama_mcp) &&
    !isOllamaHostedSearchReady()
  ) {
    logger.warn(
      '[OllamaWebSearch] OLLAMA_API_KEY is not configured – falling back to LibreChat web search',
    );
    if (!tools.includes(Tools.web_search)) {
      tools.push(Tools.web_search);
    }
    return;
  }

  if (mode === WebSearchModes.ollama_mcp) {
    mcpServers.add(OLLAMA_SEARCH_FETCH_MCP_SERVER);
    return;
  }

  if (mode === WebSearchModes.ollama_native) {
    if (!tools.includes(Tools.web_search)) {
      tools.push(Tools.web_search);
    }
    if (!tools.includes(OLLAMA_WEB_FETCH_TOOL)) {
      tools.push(OLLAMA_WEB_FETCH_TOOL);
    }
    return;
  }

  if (!tools.includes(Tools.web_search)) {
    tools.push(Tools.web_search);
  }
}

function ensureOllamaSearchMCPServer(config = {}, rootPath) {
  config.mcpServers = config.mcpServers || {};

  if (config.mcpServers[OLLAMA_SEARCH_FETCH_MCP_SERVER]) {
    return config;
  }

  const serverScript = path.resolve(rootPath, 'api', 'server', 'mcp', 'ollama-search-fetch.js');

  config.mcpServers[OLLAMA_SEARCH_FETCH_MCP_SERVER] = {
    type: 'stdio',
    command: process.execPath,
    args: [serverScript],
    startup: true,
    chatMenu: false,
    iconPath: 'https://ollama.com/public/ollama.png',
  };

  return config;
}

function createDispatcher() {
  if (!process.env.PROXY) {
    return undefined;
  }

  return new ProxyAgent(process.env.PROXY);
}

async function callOllamaHostedAPI(url, body) {
  const apiKey = process.env.OLLAMA_API_KEY;
  if (!apiKey) {
    throw new Error('OLLAMA_API_KEY is not configured. Set it to enable Ollama hosted web search.');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OLLAMA_HOSTED_API_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      dispatcher: createDispatcher(),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err?.name === 'AbortError' || err?.code === 'UND_ERR_ABORTED') {
      throw new Error(
        `Ollama hosted API request timed out after ${OLLAMA_HOSTED_API_TIMEOUT_MS / 1000}s`,
      );
    }
    throw new Error(`Ollama hosted API request failed: ${err?.message ?? 'network error'}`);
  } finally {
    clearTimeout(timeoutId);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || `Ollama hosted request failed with status ${response.status}`);
  }

  return data;
}

async function ollamaWebSearch({ query, max_results = 5 }) {
  return callOllamaHostedAPI(OLLAMA_WEB_SEARCH_API_URL, { query, max_results });
}

async function ollamaWebFetch({ url }) {
  return callOllamaHostedAPI(OLLAMA_WEB_FETCH_API_URL, { url });
}

function normalizeReferences(results = []) {
  return results
    .filter((result) => typeof result?.url === 'string' && result.url.length > 0)
    .map((result) => ({
      link: result.url,
      type: 'link',
      title: result.title,
      attribution: getHostname(result.url),
    }));
}

function buildSearchAttachment(results = [], turn = 0) {
  return {
    turn,
    organic: results
      .filter((result) => typeof result?.url === 'string' && result.url.length > 0)
      .map((result) => ({
        title: result.title,
        link: result.url,
        content: result.content,
        snippet: result.content,
        attribution: getHostname(result.url),
        processed: true,
      })),
    topStories: [],
    images: [],
    videos: [],
    relatedSearches: [],
    references: normalizeReferences(results),
  };
}

function buildFetchAttachment({ url, title, content }, turn = 0) {
  return {
    turn,
    organic: [
      {
        title: title || url,
        link: url,
        content,
        snippet: content,
        attribution: getHostname(url),
        processed: true,
      },
    ],
    topStories: [],
    images: [],
    videos: [],
    relatedSearches: [],
    references: normalizeReferences([{ url, title }]),
  };
}

function truncateText(text, limit = 8000) {
  if (typeof text !== 'string') {
    return '';
  }

  if (text.length <= limit) {
    return text;
  }

  return `${text.slice(0, limit)}\n\n[truncated]`;
}

function formatSearchResults(query, results = []) {
  if (!results.length) {
    return `No web results found for "${query}".`;
  }

  const lines = [`Search results for "${query}":`];
  results.forEach((result, index) => {
    lines.push(`${index + 1}. ${result.title || result.url || 'Untitled result'}`);
    if (result.url) {
      lines.push(`URL: ${result.url}`);
    }
    if (result.content) {
      lines.push(`Content: ${truncateText(result.content, 1200)}`);
    }
    lines.push('');
  });

  return lines.join('\n').trim();
}

function formatFetchResult(url, result) {
  const lines = [`Fetch results for "${url}":`];
  if (result.title) {
    lines.push(`Title: ${result.title}`);
  }
  lines.push(`URL: ${url}`);
  if (result.content) {
    lines.push(`Content: ${truncateText(result.content)}`);
  }
  if (Array.isArray(result.links) && result.links.length > 0) {
    lines.push(`Links: ${result.links.join(', ')}`);
  }
  return lines.join('\n').trim();
}

function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function createOllamaWebSearchTool({ onSearchResults, onWebSearchStatus } = {}) {
  return tool(
    async ({ query, max_results = 5 }, runnableConfig) => {
      onWebSearchStatus?.('searching');
      try {
        const result = await ollamaWebSearch({ query, max_results });
        const results = Array.isArray(result?.results) ? result.results : [];
        const turn = runnableConfig?.toolCall?.turn ?? 0;
        const attachment = buildSearchAttachment(results, turn);
        onSearchResults?.({ success: true, data: attachment }, runnableConfig);
        onWebSearchStatus?.('completed');
        return [formatSearchResults(query, results), { [Tools.web_search]: attachment }];
      } catch (err) {
        logger.error('[OllamaWebSearch] search failed', { query, error: err?.message });
        onSearchResults?.({ success: false, error: err?.message }, runnableConfig);
        onWebSearchStatus?.('completed');
        const errorMsg = `Ollama web search failed: ${err?.message ?? 'unknown error'}. The model should answer without web results.`;
        return [errorMsg, { [Tools.web_search]: buildSearchAttachment([], 0) }];
      }
    },
    {
      name: Tools.web_search,
      description:
        'Search the live web with Ollama hosted search. Use this for up-to-date information and recent sources.',
      schema: z.object({
        query: z.string().min(1).describe('The search query to run.'),
        max_results: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .describe('Maximum number of search results to return. Defaults to 5.'),
      }),
      responseFormat: AgentConstants.CONTENT_AND_ARTIFACT,
    },
  );
}

function createOllamaWebFetchTool() {
  return tool(
    async ({ url }, runnableConfig) => {
      try {
        const result = await ollamaWebFetch({ url });
        const turn = runnableConfig?.toolCall?.turn ?? 0;
        const attachment = buildFetchAttachment(
          {
            url,
            title: result?.title,
            content: truncateText(result?.content),
          },
          turn,
        );
        return [formatFetchResult(url, result ?? {}), { [Tools.web_search]: attachment }];
      } catch (err) {
        logger.error('[OllamaWebFetch] fetch failed', { url, error: err?.message });
        const errorMsg = `Ollama web fetch failed for ${url}: ${err?.message ?? 'unknown error'}`;
        return [errorMsg, { [Tools.web_search]: buildFetchAttachment({ url, title: url, content: '' }, 0) }];
      }
    },
    {
      name: OLLAMA_WEB_FETCH_TOOL,
      description:
        'Fetch the contents of a specific web page using Ollama hosted web fetch after you already have a URL.',
      schema: z.object({
        url: z.string().url().describe('The absolute URL to fetch.'),
      }),
      responseFormat: AgentConstants.CONTENT_AND_ARTIFACT,
    },
  );
}

module.exports = {
  OLLAMA_WEB_FETCH_TOOL,
  OLLAMA_SEARCH_FETCH_MCP_SERVER,
  OLLAMA_HOSTED_API_TIMEOUT_MS,
  applyOllamaWebSearchMode,
  createOllamaWebFetchTool,
  createOllamaWebSearchTool,
  ensureOllamaSearchMCPServer,
  formatFetchResult,
  formatSearchResults,
  getOllamaWebSearchEnabled,
  getOllamaWebSearchMode,
  isOllamaEndpoint,
  isOllamaHostedSearchReady,
  ollamaWebFetch,
  ollamaWebSearch,
};
