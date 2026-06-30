import { ContentTypes, ToolCallTypes } from 'librechat-data-provider';
import type { Agents, PartMetadata, TMessageContentParts } from 'librechat-data-provider';
import type { ToolCall } from '@langchain/core/messages/tool';
import { filterMalformedContentParts } from './content';

describe('filterMalformedContentParts', () => {
  describe('basic filtering', () => {
    it('should keep valid tool_call content parts', () => {
      const parts: TMessageContentParts[] = [
        {
          type: ContentTypes.TOOL_CALL,
          tool_call: {
            id: 'test-id',
            name: 'test_function',
            type: ToolCallTypes.TOOL_CALL,
            args: '{}',
            progress: 1,
            output: 'result',
          },
        },
      ];

      const result = filterMalformedContentParts(parts);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(parts[0]);
    });

    it('should filter out malformed tool_call content parts without tool_call property', () => {
      const parts: TMessageContentParts[] = [
        { type: ContentTypes.TOOL_CALL } as TMessageContentParts,
      ];

      const result = filterMalformedContentParts(parts);
      expect(result).toHaveLength(0);
    });

    it('should keep other content types unchanged', () => {
      const parts: TMessageContentParts[] = [
        { type: ContentTypes.TEXT, text: 'Hello world' },
        { type: ContentTypes.THINK, think: 'Thinking...' },
      ];

      const result = filterMalformedContentParts(parts);
      expect(result).toHaveLength(2);
      expect(result).toEqual(parts);
    });

    it('should drop Anthropic server web search tool uses without matching tool results', () => {
      const parts = [
        {
          type: 'server_tool_use',
          id: 'srvtoolu_123',
          name: 'web_search',
          input: { query: 'latest news' },
        },
        { type: ContentTypes.TEXT, text: 'Final answer' },
      ] as unknown as TMessageContentParts[];

      const result = filterMalformedContentParts(parts);

      expect(result).toEqual([{ type: ContentTypes.TEXT, text: 'Final answer' }]);
    });

    it('should keep paired Anthropic server web search tool use and result blocks', () => {
      const parts = [
        {
          type: 'server_tool_use',
          id: 'srvtoolu_123',
          name: 'web_search',
          input: { query: 'latest news' },
        },
        {
          type: 'web_search_tool_result',
          tool_use_id: 'srvtoolu_123',
          content: [{ type: 'web_search_result', title: 'Example', url: 'https://example.com' }],
        },
      ] as unknown as TMessageContentParts[];

      const result = filterMalformedContentParts(parts);

      expect(result).toEqual(parts);
    });

    it('should keep legacy text-shaped Anthropic web search result blocks', () => {
      const parts = [
        {
          type: 'server_tool_use',
          id: 'srvtoolu_123',
          name: 'web_search',
          input: { query: 'latest news' },
        },
        {
          type: ContentTypes.TEXT,
          tool_use_id: 'srvtoolu_123',
          content: [{ type: 'web_search_result', title: 'Example' }],
        },
      ] as unknown as TMessageContentParts[];

      const result = filterMalformedContentParts(parts);

      expect(result).toEqual(parts);
    });

    it('should keep legacy text-shaped Anthropic web fetch result blocks', () => {
      const parts = [
        {
          type: 'server_tool_use',
          id: 'srvtoolu_fetch',
          name: 'web_fetch',
          input: { url: 'https://example.com' },
        },
        {
          type: ContentTypes.TEXT,
          tool_use_id: 'srvtoolu_fetch',
          content: [{ type: 'web_fetch_result', title: 'Example', url: 'https://example.com' }],
        },
      ] as unknown as TMessageContentParts[];

      const result = filterMalformedContentParts(parts);

      expect(result).toEqual(parts);
    });

    it('should keep paired Anthropic server web fetch, code execution, and advisor blocks', () => {
      const parts = [
        {
          type: 'server_tool_use',
          id: 'srvtoolu_fetch',
          name: 'web_fetch',
          input: { url: 'https://example.com' },
        },
        {
          type: 'web_fetch_tool_result',
          tool_use_id: 'srvtoolu_fetch',
          content: [{ type: 'web_fetch_result', title: 'Example', url: 'https://example.com' }],
        },
        {
          type: 'server_tool_use',
          id: 'srvtoolu_code',
          name: 'code_execution',
          input: { code: 'print(1)' },
        },
        {
          type: 'code_execution_tool_result',
          tool_use_id: 'srvtoolu_code',
          content: [{ type: 'text', text: '1' }],
        },
        {
          type: 'server_tool_use',
          id: 'srvtoolu_advisor',
          name: 'advisor',
          input: { question: 'Review this plan' },
        },
        {
          type: 'advisor_tool_result',
          tool_use_id: 'srvtoolu_advisor',
          content: [{ type: 'text', text: 'Looks reasonable.' }],
        },
      ] as unknown as TMessageContentParts[];

      const result = filterMalformedContentParts(parts);

      expect(result).toEqual(parts);
    });

    it('should drop Anthropic server tool blocks when the result type does not match the tool', () => {
      const parts = [
        {
          type: 'server_tool_use',
          id: 'srvtoolu_fetch',
          name: 'web_fetch',
          input: { url: 'https://example.com' },
        },
        {
          type: 'web_search_tool_result',
          tool_use_id: 'srvtoolu_fetch',
          content: [{ type: 'web_search_result', title: 'Example' }],
        },
        { type: ContentTypes.TEXT, text: 'Final answer' },
      ] as unknown as TMessageContentParts[];

      const result = filterMalformedContentParts(parts);

      expect(result).toEqual([{ type: ContentTypes.TEXT, text: 'Final answer' }]);
    });

    it('should drop malformed Anthropic thinking blocks before history replay', () => {
      const parts = [
        { type: 'thinking' },
        { type: 'thinking', thinking: 'valid thought', signature: 'sig_123' },
        { type: ContentTypes.TEXT, text: 'Final answer' },
      ] as unknown as TMessageContentParts[];

      const result = filterMalformedContentParts(parts);

      expect(result).toEqual([
        { type: 'thinking', thinking: 'valid thought', signature: 'sig_123' },
        { type: ContentTypes.TEXT, text: 'Final answer' },
      ]);
    });

    it('should filter out null or undefined parts', () => {
      const parts = [
        { type: ContentTypes.TEXT, text: 'Valid' },
        null,
        undefined,
        { type: ContentTypes.TEXT, text: 'Also valid' },
      ] as TMessageContentParts[];

      const result = filterMalformedContentParts(parts);
      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('text', 'Valid');
      expect(result[1]).toHaveProperty('text', 'Also valid');
    });

    it('should return non-array input unchanged', () => {
      const notAnArray = { some: 'object' };
      const result = filterMalformedContentParts(notAnArray);
      expect(result).toBe(notAnArray);
    });
  });

  describe('real-life example with multiple tool calls', () => {
    it('should filter out malformed tool_call entries from actual MCP response', () => {
      const parts: TMessageContentParts[] = [
        {
          type: ContentTypes.THINK,
          think:
            'The user is asking for 10 different time zones, similar to what would be displayed in a stock trading room floor.',
        },
        {
          type: ContentTypes.TEXT,
          text: '# Global Market Times\n\nShowing current time in 10 major financial centers:',
          tool_call_ids: ['tooluse_Yjfib8PoRXCeCcHRH0JqCw'],
        },
        {
          type: ContentTypes.TOOL_CALL,
          tool_call: {
            id: 'tooluse_Yjfib8PoRXCeCcHRH0JqCw',
            name: 'get_current_time_mcp_time',
            args: '{"timezone":"America/New_York"}',
            type: ToolCallTypes.TOOL_CALL,
            progress: 1,
            output: '{"timezone":"America/New_York","datetime":"2025-11-13T13:43:17-05:00"}',
          },
        },
        { type: ContentTypes.TOOL_CALL } as TMessageContentParts,
        {
          type: ContentTypes.TOOL_CALL,
          tool_call: {
            id: 'tooluse_CPsGv9kXTrewVkcO7BEYIg',
            name: 'get_current_time_mcp_time',
            args: '{"timezone":"Europe/London"}',
            type: ToolCallTypes.TOOL_CALL,
            progress: 1,
            output: '{"timezone":"Europe/London","datetime":"2025-11-13T18:43:19+00:00"}',
          },
        },
        { type: ContentTypes.TOOL_CALL } as TMessageContentParts,
        {
          type: ContentTypes.TOOL_CALL,
          tool_call: {
            id: 'tooluse_5jihRbd4TDWCGebwmAUlfQ',
            name: 'get_current_time_mcp_time',
            args: '{"timezone":"Asia/Tokyo"}',
            type: ToolCallTypes.TOOL_CALL,
            progress: 1,
            output: '{"timezone":"Asia/Tokyo","datetime":"2025-11-14T03:43:21+09:00"}',
          },
        },
        { type: ContentTypes.TOOL_CALL } as TMessageContentParts,
        { type: ContentTypes.TOOL_CALL } as TMessageContentParts,
        { type: ContentTypes.TOOL_CALL } as TMessageContentParts,
        {
          type: ContentTypes.TEXT,
          text: '## Major Financial Markets Clock:\n\n| Market | Local Time | Day |',
        },
      ];

      const result = filterMalformedContentParts(parts);

      expect(result).toHaveLength(6);

      expect(result[0].type).toBe(ContentTypes.THINK);
      expect(result[1].type).toBe(ContentTypes.TEXT);
      expect(result[2].type).toBe(ContentTypes.TOOL_CALL);
      expect(result[3].type).toBe(ContentTypes.TOOL_CALL);
      expect(result[4].type).toBe(ContentTypes.TOOL_CALL);
      expect(result[5].type).toBe(ContentTypes.TEXT);

      const toolCalls = result.filter((part) => part.type === ContentTypes.TOOL_CALL);
      expect(toolCalls).toHaveLength(3);

      toolCalls.forEach((toolCall) => {
        if (toolCall.type === ContentTypes.TOOL_CALL) {
          expect(toolCall.tool_call).toBeDefined();
          expect(toolCall.tool_call).toHaveProperty('id');
          expect(toolCall.tool_call).toHaveProperty('name');
        }
      });
    });

    it('should handle empty array', () => {
      const result = filterMalformedContentParts([]);
      expect(result).toEqual([]);
    });

    it('should handle array with only malformed tool calls', () => {
      const parts = [
        { type: ContentTypes.TOOL_CALL },
        { type: ContentTypes.TOOL_CALL },
        { type: ContentTypes.TOOL_CALL },
      ] as TMessageContentParts[];

      const result = filterMalformedContentParts(parts);
      expect(result).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('should filter out tool_call with null tool_call property', () => {
      const parts = [
        { type: ContentTypes.TOOL_CALL, tool_call: null as unknown as ToolCall },
      ] as TMessageContentParts[];

      const result = filterMalformedContentParts(parts);
      expect(result).toHaveLength(0);
    });

    it('should filter out tool_call with non-object tool_call property', () => {
      const parts = [
        {
          type: ContentTypes.TOOL_CALL,
          tool_call: 'not an object' as unknown as ToolCall & PartMetadata,
        },
      ] as TMessageContentParts[];

      const result = filterMalformedContentParts(parts);
      expect(result).toHaveLength(0);
    });

    it('should keep tool_call with empty object as tool_call', () => {
      const parts: TMessageContentParts[] = [
        {
          type: ContentTypes.TOOL_CALL,
          tool_call: {} as unknown as Agents.ToolCall & PartMetadata,
        },
      ];

      const result = filterMalformedContentParts(parts);
      expect(result).toHaveLength(1);
    });
  });
});
