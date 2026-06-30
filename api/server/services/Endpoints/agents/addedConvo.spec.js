const mockInitializeAgent = jest.fn();
const mockValidateAgentModel = jest.fn();
const mockLoadAddedAgent = jest.fn();
const mockSetGetAgent = jest.fn();

jest.mock('@librechat/data-schemas', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock('@librechat/api', () => ({
  initializeAgent: (...args) => mockInitializeAgent(...args),
  validateAgentModel: (...args) => mockValidateAgentModel(...args),
}));

jest.mock('~/models/loadAddedAgent', () => ({
  ADDED_AGENT_ID: 'added_agent',
  loadAddedAgent: (...args) => mockLoadAddedAgent(...args),
  setGetAgent: (...args) => mockSetGetAgent(...args),
}));

jest.mock('~/models/Conversation', () => ({
  getConvoFiles: jest.fn(),
}));

jest.mock('~/models/Agent', () => ({
  getAgent: jest.fn(),
}));

jest.mock('~/server/services/Files/strategies', () => ({
  getStrategyFunctions: jest.fn(() => ({
    getDownloadStream: jest.fn(),
  })),
}));

jest.mock('~/models', () => ({
  getFiles: jest.fn(),
  getUserKey: jest.fn(),
  getMessages: jest.fn(),
  updateFile: jest.fn(),
  updateFilesUsage: jest.fn(),
  getUserCodeFiles: jest.fn(),
  getUserKeyValues: jest.fn(),
  getToolFilesByIds: jest.fn(),
  getCodeGeneratedFiles: jest.fn(),
}));

const { processAddedConvo } = require('./addedConvo');

describe('processAddedConvo', () => {
  const baseParams = {
    req: { user: { id: 'user-1' }, config: {} },
    res: {},
    loadTools: jest.fn(),
    logViolation: jest.fn(),
    modelsConfig: {},
    requestFiles: [],
    conversationId: 'convo-1',
    parentMessageId: 'parent-1',
    allowedProviders: new Set(['openAI', 'anthropic', 'google']),
    primaryAgentId: 'primary-agent',
    primaryAgent: {
      id: 'primary-agent',
      provider: 'openAI',
      tools: ['web_search'],
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockValidateAgentModel.mockResolvedValue({ isValid: true });
  });

  it('returns an empty context list when no added conversations are requested', async () => {
    const agentConfigs = new Map();

    const result = await processAddedConvo({
      ...baseParams,
      endpointOption: {},
      agentConfigs,
      userMCPAuthMap: undefined,
    });

    expect(result).toEqual({ userMCPAuthMap: undefined, agentToolContexts: [] });
    expect(agentConfigs.size).toBe(0);
    expect(mockLoadAddedAgent).not.toHaveBeenCalled();
    expect(mockInitializeAgent).not.toHaveBeenCalled();
  });

  it('stores runtime tool contexts for each added conversation', async () => {
    const agentConfigs = new Map();
    const authMap = { existing_server: { token: 'existing-token' } };
    const firstRegistry = new Map([['web_search', { name: 'web_search' }]]);
    const secondRegistry = new Map([['playwright', { name: 'playwright' }]]);
    const firstResources = { first: true };
    const secondResources = { second: true };
    const firstAgent = {
      id: 'added-1',
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      tools: ['web_search'],
    };
    const secondAgent = {
      id: 'added-2',
      provider: 'google',
      model: 'gemini-2.5-pro',
      tools: ['playwright'],
    };
    const firstConfig = {
      id: 'anthropic__claude-opus-4-8___Claude Opus 4.8 with Web Search____1',
      toolRegistry: firstRegistry,
      userMCPAuthMap: { search: { token: 'search-token' } },
      tool_resources: firstResources,
    };
    const secondConfig = {
      id: 'google__gemini-2.5-pro___Gemini 2.5 Pro with Web Search____2',
      toolRegistry: secondRegistry,
      userMCPAuthMap: { browser: { token: 'browser-token' } },
      tool_resources: secondResources,
    };

    mockLoadAddedAgent.mockResolvedValueOnce(firstAgent).mockResolvedValueOnce(secondAgent);
    mockInitializeAgent
      .mockImplementationOnce(async ({ agent }) => {
        agent.provider = 'openAI';
        return firstConfig;
      })
      .mockImplementationOnce(async ({ agent }) => {
        agent.provider = 'openAI';
        return secondConfig;
      });

    const result = await processAddedConvo({
      ...baseParams,
      endpointOption: {
        addedConvos: [
          { endpoint: 'anthropic', model: 'claude-opus-4-8' },
          { endpoint: 'google', model: 'gemini-2.5-pro' },
        ],
      },
      agentConfigs,
      userMCPAuthMap: authMap,
    });

    expect(mockLoadAddedAgent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        index: 1,
        primaryAgent: baseParams.primaryAgent,
      }),
    );
    expect(mockLoadAddedAgent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        index: 2,
        primaryAgent: baseParams.primaryAgent,
      }),
    );

    expect(firstAgent.provider).toBe('anthropic');
    expect(secondAgent.provider).toBe('google');
    expect(result.userMCPAuthMap).toBe(authMap);
    expect(result.userMCPAuthMap).toMatchObject({
      existing_server: { token: 'existing-token' },
      search: { token: 'search-token' },
      browser: { token: 'browser-token' },
    });

    expect(agentConfigs.get(firstConfig.id)).toBe(firstConfig);
    expect(agentConfigs.get(secondConfig.id)).toBe(secondConfig);
    expect(result.agentToolContexts).toEqual([
      {
        agentId: firstConfig.id,
        agent: firstAgent,
        toolRegistry: firstRegistry,
        userMCPAuthMap: firstConfig.userMCPAuthMap,
        tool_resources: firstResources,
      },
      {
        agentId: secondConfig.id,
        agent: secondAgent,
        toolRegistry: secondRegistry,
        userMCPAuthMap: secondConfig.userMCPAuthMap,
        tool_resources: secondResources,
      },
    ]);
  });
});
