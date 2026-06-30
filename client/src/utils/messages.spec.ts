import { createDualMessageContent } from './messages';

describe('createDualMessageContent', () => {
  it('creates unique placeholder parts for multiple added conversations', () => {
    const content = createDualMessageContent(
      {
        conversationId: 'new',
        endpoint: 'openAI',
        model: 'gpt-5.5',
      } as never,
      [
        {
          conversationId: 'new',
          endpoint: 'anthropic',
          model: 'claude-sonnet-4-6',
        },
        {
          conversationId: 'new',
          endpoint: 'google',
          model: 'gemini-3-pro',
        },
        {
          conversationId: 'new',
          endpoint: 'xai',
          model: 'grok-4',
        },
      ] as never,
    ) as Array<{ agentId: string; groupId: number }>;

    expect(content).toHaveLength(4);
    expect(content.map((part) => part.groupId)).toEqual([1, 1, 1, 1]);
    expect(new Set(content.map((part) => part.agentId)).size).toBe(4);
    expect(content[1].agentId).toContain('____1');
    expect(content[2].agentId).toContain('____2');
    expect(content[3].agentId).toContain('____3');
  });
});
