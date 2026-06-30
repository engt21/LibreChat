const mockSpendTokens = jest.fn();
const mockRecordModelTokenUsage = jest.fn();

jest.mock('@librechat/api', () => ({
  countTokens: jest.fn(() => 0),
  escapeRegExp: jest.fn((value) => value),
}), { virtual: true });

jest.mock('librechat-data-provider', () => ({
  Constants: {},
  ContentTypes: {},
  AnnotationTypes: {},
  defaultOrderQuery: {},
}));

jest.mock('~/server/services/Files/process', () => ({
  retrieveAndProcessFile: jest.fn(),
}));

jest.mock('~/models/Message', () => ({
  recordMessage: jest.fn(),
  getMessages: jest.fn(),
}));

jest.mock('~/models/spendTokens', () => ({
  spendTokens: (...args) => mockSpendTokens(...args),
}));

jest.mock('~/models/Conversation', () => ({
  saveConvo: jest.fn(),
}));

jest.mock('~/server/services/ModelRateLimits', () => ({
  recordModelTokenUsage: (...args) => mockRecordModelTokenUsage(...args),
}));

const { recordUsage } = require('./manage');

describe('Threads recordUsage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('records assistant token usage against per-user per-model token budgets', async () => {
    const userObject = {
      id: 'user-1',
      modelRateLimits: {
        enabled: true,
        rules: [{ endpoint: 'openAI', model: 'gpt-5.4-mini', tokensPerDay: 100 }],
      },
    };

    await recordUsage({
      prompt_tokens: 12,
      completion_tokens: 8,
      model: 'gpt-5.4-mini',
      user: 'user-1',
      userObject,
      endpoint: 'openAI',
      conversationId: 'conversation-1',
    });

    expect(mockSpendTokens).toHaveBeenCalledWith(
      expect.objectContaining({ user: 'user-1', model: 'gpt-5.4-mini' }),
      { promptTokens: 12, completionTokens: 8 },
    );
    expect(mockRecordModelTokenUsage).toHaveBeenCalledWith({
      user: userObject,
      endpoint: 'openAI',
      model: 'gpt-5.4-mini',
      tokens: 20,
    });
  });
});
