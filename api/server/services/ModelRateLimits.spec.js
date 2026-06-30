const mockCache = new Map();

jest.mock('@librechat/api', () => ({
  standardCache: jest.fn(() => ({
    get: jest.fn(async (key) => mockCache.get(key)),
    set: jest.fn(async (key, value) => {
      mockCache.set(key, value);
      return true;
    }),
  })),
}), { virtual: true });

const {
  getMatchingRule,
  checkAndIncrementModelRequestLimit,
  recordModelTokenUsage,
} = require('./ModelRateLimits');

describe('ModelRateLimits service', () => {
  beforeEach(() => {
    mockCache.clear();
  });

  const user = {
    id: 'user-1',
    modelRateLimits: {
      enabled: true,
      rules: [
        { endpoint: '*', model: '*', requestsPerDay: 10, tokensPerDay: 1000 },
        { endpoint: 'openAI', model: 'gpt-5.4-mini', requestsPerDay: 1, tokensPerDay: 20 },
      ],
    },
  };

  it('chooses the most specific endpoint/model rule', () => {
    expect(getMatchingRule({ user, endpoint: 'openAI', model: 'gpt-5.4-mini' })).toEqual({
      endpoint: 'openAI',
      model: 'gpt-5.4-mini',
      requestsPerDay: 1,
      tokensPerDay: 20,
    });
  });

  it('blocks requests after the per-model request budget is exhausted', async () => {
    await expect(
      checkAndIncrementModelRequestLimit({ user, endpoint: 'openAI', model: 'gpt-5.4-mini' }),
    ).resolves.toEqual(expect.objectContaining({ allowed: true }));

    await expect(
      checkAndIncrementModelRequestLimit({ user, endpoint: 'openAI', model: 'gpt-5.4-mini' }),
    ).resolves.toEqual(
      expect.objectContaining({ allowed: false, type: 'requests', limit: 1 }),
    );
  });

  it('blocks requests after recorded token usage reaches the token budget', async () => {
    await recordModelTokenUsage({
      user,
      endpoint: 'openAI',
      model: 'gpt-5.4-mini',
      tokens: 25,
    });

    await expect(
      checkAndIncrementModelRequestLimit({ user, endpoint: 'openAI', model: 'gpt-5.4-mini' }),
    ).resolves.toEqual(expect.objectContaining({ allowed: false, type: 'tokens', limit: 20 }));
  });
});
