jest.mock('~/server/utils/import/importBatchBuilder', () => ({
  createImportBatchBuilder: jest.fn(),
}));
jest.mock('~/models', () => ({
  getConvo: jest.fn(),
  saveConvo: jest.fn(),
  saveMessage: jest.fn(),
}));

const { createImportBatchBuilder } = require('~/server/utils/import/importBatchBuilder');
const { getConvo, saveConvo, saveMessage } = require('~/models');
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

  it('appends realtime turns to an owned existing conversation', async () => {
    getConvo.mockResolvedValue({
      conversationId: '11111111-1111-4111-8111-111111111111',
      title: 'Existing chat',
      endpoint: 'openAI',
      model: 'gpt-5.5',
    });
    saveMessage.mockResolvedValue({});
    saveConvo.mockImplementation(async (_req, conversation) => conversation);

    const conversation = await saveRealtimeConversation({
      userId: 'user-1',
      conversationId: '11111111-1111-4111-8111-111111111111',
      parentMessageId: 'parent-1',
      endpoint: 'openAI',
      model: 'gpt-realtime-2',
      entries: [
        { role: 'user', text: 'Continue by voice', source: 'voice' },
        { role: 'assistant', text: 'Continuing here', source: 'voice' },
      ],
    });

    expect(saveMessage).toHaveBeenCalledTimes(2);
    expect(saveMessage.mock.calls[0][1]).toMatchObject({
      conversationId: '11111111-1111-4111-8111-111111111111',
      parentMessageId: 'parent-1',
      isCreatedByUser: true,
    });
    expect(saveMessage.mock.calls[1][1].parentMessageId).toBe(
      saveMessage.mock.calls[0][1].messageId,
    );
    expect(saveConvo).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ endpoint: 'openAI', model: 'gpt-5.5' }),
      expect.anything(),
    );
    expect(conversation.conversationId).toBe('11111111-1111-4111-8111-111111111111');
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
      textModel: 'gpt-5.5',
      startedAt: '2026-03-20T00:00:00.000Z',
      endedAt: '2026-03-20T00:05:00.000Z',
      entries: [
        { role: 'user', text: ' Hello voice chat ', source: 'voice' },
        { role: 'assistant', text: 'Hi there', source: 'voice' },
      ],
    });

    expect(createImportBatchBuilder).toHaveBeenCalledWith('user-1');
    expect(addUserMessage).toHaveBeenCalledWith('Hello voice chat');
    expect(addGptMessage).toHaveBeenCalledWith('Hi there', 'gpt-5.5', 'gpt-5.5');
    expect(finishConversation).toHaveBeenCalledWith(
      'Hello voice chat',
      new Date('2026-03-20T00:00:00.000Z'),
      expect.objectContaining({ endpoint: 'openAI', model: 'gpt-5.5' }),
    );
    expect(conversation.updatedAt).toEqual(new Date('2026-03-20T00:05:00.000Z'));
    expect(saveBatch).toHaveBeenCalled();
  });
});
