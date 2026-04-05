jest.mock('~/server/utils/import/importBatchBuilder', () => ({
  createImportBatchBuilder: jest.fn(),
}));

const { createImportBatchBuilder } = require('~/server/utils/import/importBatchBuilder');
const {
  MAX_REALTIME_TITLE_LENGTH,
  buildRealtimeConversationTitle,
  normalizeRealtimeEntries,
  saveRealtimeConversation,
} = require('~/server/services/Realtime/persistence');

describe('realtime persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('normalizes and filters transcript entries', () => {
    expect(
      normalizeRealtimeEntries([
        { role: 'user', text: '  hello\nthere  ', source: 'voice' },
        { role: 'assistant', text: '', source: 'text' },
        { role: 'system', text: 'ignore me', source: 'text' },
      ]),
    ).toEqual([{ role: 'user', text: 'hello there', source: 'voice' }]);
  });

  it('builds a bounded title from the first user utterance', () => {
    const title = buildRealtimeConversationTitle(
      [{ role: 'user', text: 'a'.repeat(MAX_REALTIME_TITLE_LENGTH + 10), source: 'voice' }],
      'gpt-realtime-1.5',
    );

    expect(title).toHaveLength(MAX_REALTIME_TITLE_LENGTH);
    expect(title.endsWith('…')).toBe(true);
  });

  it('persists a normalized realtime transcript as a conversation', async () => {
    const addUserMessage = jest.fn();
    const addGptMessage = jest.fn();
    const finishConversation = jest.fn(() => ({
      conversation: {
        conversationId: 'convo-1',
        title: 'Hello voice chat',
        endpoint: 'openAI',
        model: 'gpt-realtime-1.5',
      },
    }));
    const saveBatch = jest.fn().mockResolvedValue(undefined);

    createImportBatchBuilder.mockReturnValue({
      startConversation: jest.fn(),
      addUserMessage,
      addGptMessage,
      finishConversation,
      saveBatch,
    });

    const conversation = await saveRealtimeConversation({
      userId: 'user-1',
      endpoint: 'openAI',
      model: 'gpt-realtime-1.5',
      startedAt: '2026-03-20T00:00:00.000Z',
      endedAt: '2026-03-20T00:05:00.000Z',
      entries: [
        { role: 'user', text: ' Hello voice chat ', source: 'voice' },
        { role: 'assistant', text: 'Hi there', source: 'voice' },
      ],
    });

    expect(createImportBatchBuilder).toHaveBeenCalledWith('user-1');
    expect(addUserMessage).toHaveBeenCalledWith('Hello voice chat');
    expect(addGptMessage).toHaveBeenCalledWith('Hi there', 'gpt-realtime-1.5', 'gpt-realtime-1.5');
    expect(finishConversation).toHaveBeenCalledWith(
      'Hello voice chat',
      new Date('2026-03-20T00:00:00.000Z'),
      expect.objectContaining({ endpoint: 'openAI', model: 'gpt-realtime-1.5' }),
    );
    expect(conversation.updatedAt).toEqual(new Date('2026-03-20T00:05:00.000Z'));
    expect(saveBatch).toHaveBeenCalled();
  });
});
