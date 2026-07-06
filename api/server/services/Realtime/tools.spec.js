const { normalizeRequestedTools, executeRealtimeTool } = require('./tools');

describe('realtime tools', () => {
  it('only enables the production-safe realtime tool bridge', () => {
    expect(normalizeRequestedTools(['web_search', 'execute_code', 'web_search'])).toEqual([
      'web_search',
    ]);
  });

  it('executes a loaded realtime function tool', async () => {
    const invoke = jest.fn().mockResolvedValue({ answer: 'result' });
    const output = await executeRealtimeTool({
      toolMap: new Map([['web_search', { invoke }]]),
      name: 'web_search',
      argumentsText: '{"query":"latest docs"}',
    });

    expect(invoke).toHaveBeenCalledWith({ query: 'latest docs' });
    expect(output).toBe('{"answer":"result"}');
  });
});
