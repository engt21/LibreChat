const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const {
  OLLAMA_SEARCH_FETCH_MCP_SERVER,
  formatFetchResult,
  formatSearchResults,
  ollamaWebFetch,
  ollamaWebSearch,
} = require('../services/Tools/ollama');

const server = new McpServer({
  name: OLLAMA_SEARCH_FETCH_MCP_SERVER,
  version: '1.0.0',
});

server.tool(
  'web_search',
  'Search the live web using Ollama hosted search. Use this for current events or when recent information matters.',
  {
    query: z.string().min(1).describe('The search query to run.'),
    max_results: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe('Maximum number of results to return. Defaults to 5.'),
  },
  async ({ query, max_results = 5 }) => {
    const result = await ollamaWebSearch({ query, max_results });
    return {
      content: [
        {
          type: 'text',
          text: formatSearchResults(query, result.results),
        },
      ],
      structuredContent: result,
    };
  },
);

server.tool(
  'web_fetch',
  'Fetch the contents of a single web page using Ollama hosted web fetch after you already have a URL.',
  {
    url: z.string().url().describe('The absolute URL to fetch.'),
  },
  async ({ url }) => {
    const result = await ollamaWebFetch({ url });
    return {
      content: [
        {
          type: 'text',
          text: formatFetchResult(url, result),
        },
      ],
      structuredContent: result,
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack || error.message : String(error)}\n`,
  );
  process.exit(1);
});
