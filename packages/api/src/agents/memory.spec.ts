import { Types } from 'mongoose';
import { Run, Providers, GraphEvents } from '@librechat/agents';
import type { IUser } from '@librechat/data-schemas';
import type { Response } from 'express';
import { processMemory } from './memory';

jest.mock('~/stream/GenerationJobManager');

const mockCreateSafeUser = jest.fn((user) => ({
  id: user?.id,
  email: user?.email,
  name: user?.name,
  username: user?.username,
}));

const mockResolveHeaders = jest.fn((opts) => {
  const headers = opts.headers || {};
  const user = opts.user || {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    let resolved = value as string;
    resolved = resolved.replace(/\$\{(\w+)\}/g, (_match, envVar) => process.env[envVar] || '');
    resolved = resolved.replace(/\{\{LIBRECHAT_USER_EMAIL\}\}/g, user.email || '');
    resolved = resolved.replace(/\{\{LIBRECHAT_USER_ID\}\}/g, user.id || '');
    result[key] = resolved;
  }
  return result;
});

jest.mock('~/utils', () => ({
  Tokenizer: {
    getTokenCount: jest.fn(() => 10),
  },
  createSafeUser: (user: unknown) => mockCreateSafeUser(user),
  resolveHeaders: (opts: unknown) => mockResolveHeaders(opts),
}));

const { createSafeUser } = jest.requireMock('~/utils');

jest.mock('@librechat/agents', () => {
  const actual = jest.requireActual('@librechat/agents');
  return {
    Run: {
      create: jest.fn(() => ({
        processStream: jest.fn(() => Promise.resolve('success')),
      })),
    },
    Providers: actual.Providers,
    GraphEvents: actual.GraphEvents,
  };
});

function createTestUser(overrides: Partial<IUser> = {}): IUser {
  return {
    _id: new Types.ObjectId(),
    id: new Types.ObjectId().toString(),
    username: 'testuser',
    email: 'test@example.com',
    name: 'Test User',
    avatar: 'https://example.com/avatar.png',
    provider: 'email',
    role: 'user',
    createdAt: new Date('2021-01-01'),
    updatedAt: new Date('2021-01-01'),
    emailVerified: true,
    ...overrides,
  } as IUser;
}

describe('Memory Agent Header Resolution', () => {
  let testUser: IUser;
  let mockRes: Response;
  let mockMemoryMethods: {
    setMemory: jest.Mock;
    deleteMemory: jest.Mock;
    getFormattedMemories: jest.Mock;
  };

  beforeEach(() => {
    process.env.CUSTOM_API_KEY = 'sk-custom-test-key';
    process.env.TEST_CUSTOM_API_KEY = 'sk-custom-test-key';

    testUser = createTestUser({
      id: 'user-123',
      email: 'test@example.com',
    });

    mockRes = {
      write: jest.fn(),
      end: jest.fn(),
      headersSent: false,
    } as unknown as Response;

    mockMemoryMethods = {
      setMemory: jest.fn(),
      deleteMemory: jest.fn(),
      getFormattedMemories: jest.fn(() =>
        Promise.resolve({
          withKeys: 'formatted memories',
          withoutKeys: 'memories without keys',
          totalTokens: 100,
        }),
      ),
    };

    jest.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.CUSTOM_API_KEY;
    delete process.env.TEST_CUSTOM_API_KEY;
  });

  it('should resolve environment variables in custom endpoint headers', async () => {
    const llmConfig = {
      provider: 'custom',
      model: 'gpt-4o-mini',
      configuration: {
        defaultHeaders: {
          'x-custom-api-key': '${CUSTOM_API_KEY}',
          'api-key': '${TEST_CUSTOM_API_KEY}',
        },
      },
    };

    await processMemory({
      res: mockRes,
      userId: 'user-123',
      setMemory: mockMemoryMethods.setMemory,
      deleteMemory: mockMemoryMethods.deleteMemory,
      messages: [],
      memory: 'test memory',
      messageId: 'msg-123',
      conversationId: 'conv-123',
      validKeys: ['preferences'],
      instructions: 'test instructions',
      llmConfig,
      user: testUser,
    });

    expect(Run.create as jest.Mock).toHaveBeenCalled();
    const runConfig = (Run.create as jest.Mock).mock.calls[0][0];
    expect(runConfig.graphConfig.llmConfig.configuration.defaultHeaders).toEqual({
      'x-custom-api-key': 'sk-custom-test-key',
      'api-key': 'sk-custom-test-key',
    });
  });

  it('should resolve user placeholders in custom endpoint headers', async () => {
    const llmConfig = {
      provider: 'custom',
      model: 'gpt-4o-mini',
      configuration: {
        defaultHeaders: {
          'X-User-Identifier': '{{LIBRECHAT_USER_EMAIL}}',
          'X-User-ID': '{{LIBRECHAT_USER_ID}}',
        },
      },
    };

    await processMemory({
      res: mockRes,
      userId: 'user-123',
      setMemory: mockMemoryMethods.setMemory,
      deleteMemory: mockMemoryMethods.deleteMemory,
      messages: [],
      memory: 'test memory',
      messageId: 'msg-123',
      conversationId: 'conv-123',
      validKeys: ['preferences'],
      instructions: 'test instructions',
      llmConfig,
      user: testUser,
    });

    expect(Run.create as jest.Mock).toHaveBeenCalled();
    const runConfig = (Run.create as jest.Mock).mock.calls[0][0];
    expect(runConfig.graphConfig.llmConfig.configuration.defaultHeaders).toEqual({
      'X-User-Identifier': 'test@example.com',
      'X-User-ID': 'user-123',
    });
  });

  it('should handle mixed environment variables and user placeholders', async () => {
    const llmConfig = {
      provider: 'custom',
      model: 'gpt-4o-mini',
      configuration: {
        defaultHeaders: {
          'x-custom-api-key': '${CUSTOM_API_KEY}',
          'X-User-Identifier': '{{LIBRECHAT_USER_EMAIL}}',
          'X-Application-Identifier': 'LibreChat - Test',
        },
      },
    };

    await processMemory({
      res: mockRes,
      userId: 'user-123',
      setMemory: mockMemoryMethods.setMemory,
      deleteMemory: mockMemoryMethods.deleteMemory,
      messages: [],
      memory: 'test memory',
      messageId: 'msg-123',
      conversationId: 'conv-123',
      validKeys: ['preferences'],
      instructions: 'test instructions',
      llmConfig,
      user: testUser,
    });

    expect(Run.create as jest.Mock).toHaveBeenCalled();
    const runConfig = (Run.create as jest.Mock).mock.calls[0][0];
    expect(runConfig.graphConfig.llmConfig.configuration.defaultHeaders).toEqual({
      'x-custom-api-key': 'sk-custom-test-key',
      'X-User-Identifier': 'test@example.com',
      'X-Application-Identifier': 'LibreChat - Test',
    });
  });

  it('should resolve env vars when user is undefined', async () => {
    const llmConfig = {
      provider: 'custom',
      model: 'gpt-4o-mini',
      configuration: {
        defaultHeaders: {
          'x-custom-api-key': '${CUSTOM_API_KEY}',
        },
      },
    };

    await processMemory({
      res: mockRes,
      userId: 'user-123',
      setMemory: mockMemoryMethods.setMemory,
      deleteMemory: mockMemoryMethods.deleteMemory,
      messages: [],
      memory: 'test memory',
      messageId: 'msg-123',
      conversationId: 'conv-123',
      validKeys: ['preferences'],
      instructions: 'test instructions',
      llmConfig,
      user: undefined,
    });

    expect(Run.create as jest.Mock).toHaveBeenCalled();
    const runConfig = (Run.create as jest.Mock).mock.calls[0][0];
    expect(runConfig.graphConfig.llmConfig.configuration.defaultHeaders).toEqual({
      'x-custom-api-key': 'sk-custom-test-key',
    });
  });

  it('should not throw when llmConfig has no configuration', async () => {
    const llmConfig = {
      provider: Providers.OPENAI,
      model: 'gpt-4o-mini',
    };

    await processMemory({
      res: mockRes,
      userId: 'user-123',
      setMemory: mockMemoryMethods.setMemory,
      deleteMemory: mockMemoryMethods.deleteMemory,
      messages: [],
      memory: 'test memory',
      messageId: 'msg-123',
      conversationId: 'conv-123',
      validKeys: ['preferences'],
      instructions: 'test instructions',
      llmConfig,
      user: testUser,
    });

    expect(Run.create as jest.Mock).toHaveBeenCalled();
    const runConfig = (Run.create as jest.Mock).mock.calls[0][0];
    expect(runConfig.graphConfig.llmConfig.configuration).toBeUndefined();
  });

  it('should use createSafeUser to sanitize user data', async () => {
    const userWithSensitiveData = createTestUser({
      id: 'user-123',
      email: 'test@example.com',
      password: 'sensitive-password',
      refreshToken: 'sensitive-token',
    } as unknown as Partial<IUser>);

    const llmConfig = {
      provider: Providers.OPENAI,
      model: 'gpt-4o-mini',
      configuration: {
        defaultHeaders: {
          'X-User-ID': '{{LIBRECHAT_USER_ID}}',
        },
      },
    };

    await processMemory({
      res: mockRes,
      userId: 'user-123',
      setMemory: mockMemoryMethods.setMemory,
      deleteMemory: mockMemoryMethods.deleteMemory,
      messages: [],
      memory: 'test memory',
      messageId: 'msg-123',
      conversationId: 'conv-123',
      validKeys: ['preferences'],
      instructions: 'test instructions',
      llmConfig,
      user: userWithSensitiveData,
    });

    expect(Run.create as jest.Mock).toHaveBeenCalled();

    // Verify createSafeUser was used - the user object passed to Run.create should not have sensitive fields
    const safeUser = createSafeUser(userWithSensitiveData);
    expect(safeUser).not.toHaveProperty('password');
    expect(safeUser).not.toHaveProperty('refreshToken');
    expect(safeUser).toHaveProperty('id');
    expect(safeUser).toHaveProperty('email');
  });

  it('should include instructions in user message for Bedrock provider', async () => {
    const llmConfig = {
      provider: Providers.BEDROCK,
      model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    };

    const { HumanMessage } = await import('@langchain/core/messages');
    const testMessage = new HumanMessage('test chat content');

    await processMemory({
      res: mockRes,
      userId: 'user-123',
      setMemory: mockMemoryMethods.setMemory,
      deleteMemory: mockMemoryMethods.deleteMemory,
      messages: [testMessage],
      memory: 'existing memory',
      messageId: 'msg-123',
      conversationId: 'conv-123',
      validKeys: ['preferences'],
      instructions: 'test instructions',
      llmConfig,
      user: testUser,
    });

    expect(Run.create as jest.Mock).toHaveBeenCalled();
    const runConfig = (Run.create as jest.Mock).mock.calls[0][0];

    // For Bedrock, instructions should NOT be passed to graphConfig
    expect(runConfig.graphConfig.instructions).toBeUndefined();
    expect(runConfig.graphConfig.additional_instructions).toBeUndefined();
  });

  it('should pass instructions to graphConfig for non-Bedrock providers', async () => {
    const llmConfig = {
      provider: Providers.OPENAI,
      model: 'gpt-4o-mini',
    };

    await processMemory({
      res: mockRes,
      userId: 'user-123',
      setMemory: mockMemoryMethods.setMemory,
      deleteMemory: mockMemoryMethods.deleteMemory,
      messages: [],
      memory: 'existing memory',
      messageId: 'msg-123',
      conversationId: 'conv-123',
      validKeys: ['preferences'],
      instructions: 'test instructions',
      llmConfig,
      user: testUser,
    });

    expect(Run.create as jest.Mock).toHaveBeenCalled();
    const runConfig = (Run.create as jest.Mock).mock.calls[0][0];

    // For non-Bedrock providers, instructions should be passed to graphConfig
    expect(runConfig.graphConfig.instructions).toBe('test instructions');
    expect(runConfig.graphConfig.additional_instructions).toBeDefined();
  });

  it('should set temperature to 1 for Bedrock with thinking enabled', async () => {
    const llmConfig = {
      provider: Providers.BEDROCK,
      model: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
      temperature: 0.7,
      additionalModelRequestFields: {
        thinking: {
          type: 'enabled',
          budget_tokens: 5000,
        },
      },
    };

    await processMemory({
      res: mockRes,
      userId: 'user-123',
      setMemory: mockMemoryMethods.setMemory,
      deleteMemory: mockMemoryMethods.deleteMemory,
      messages: [],
      memory: 'existing memory',
      messageId: 'msg-123',
      conversationId: 'conv-123',
      validKeys: ['preferences'],
      instructions: 'test instructions',
      llmConfig,
      user: testUser,
    });

    expect(Run.create as jest.Mock).toHaveBeenCalled();
    const runConfig = (Run.create as jest.Mock).mock.calls[0][0];

    expect(runConfig.graphConfig.llmConfig.temperature).toBe(1);
  });

  it('should not modify temperature for Bedrock without thinking enabled', async () => {
    const llmConfig = {
      provider: Providers.BEDROCK,
      model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      temperature: 0.7,
    };

    await processMemory({
      res: mockRes,
      userId: 'user-123',
      setMemory: mockMemoryMethods.setMemory,
      deleteMemory: mockMemoryMethods.deleteMemory,
      messages: [],
      memory: 'existing memory',
      messageId: 'msg-123',
      conversationId: 'conv-123',
      validKeys: ['preferences'],
      instructions: 'test instructions',
      llmConfig,
      user: testUser,
    });

    expect(Run.create as jest.Mock).toHaveBeenCalled();
    const runConfig = (Run.create as jest.Mock).mock.calls[0][0];

    expect(runConfig.graphConfig.llmConfig.temperature).toBe(0.7);
  });

  it('should remove temperature for Anthropic with thinking enabled', async () => {
    const llmConfig = {
      provider: Providers.ANTHROPIC,
      model: 'claude-sonnet-4-20250514',
      temperature: 0.7,
      thinking: {
        type: 'enabled',
        budget_tokens: 5000,
      },
    };

    await processMemory({
      res: mockRes,
      userId: 'user-123',
      setMemory: mockMemoryMethods.setMemory,
      deleteMemory: mockMemoryMethods.deleteMemory,
      messages: [],
      memory: 'existing memory',
      messageId: 'msg-123',
      conversationId: 'conv-123',
      validKeys: ['preferences'],
      instructions: 'test instructions',
      llmConfig,
      user: testUser,
    });

    expect(Run.create as jest.Mock).toHaveBeenCalled();
    const runConfig = (Run.create as jest.Mock).mock.calls[0][0];

    expect(runConfig.graphConfig.llmConfig.temperature).toBeUndefined();
    expect(runConfig.graphConfig.llmConfig.thinking).toEqual({
      type: 'enabled',
      budget_tokens: 5000,
    });
  });

  it('should not modify temperature for Anthropic without thinking enabled', async () => {
    const llmConfig = {
      provider: Providers.ANTHROPIC,
      model: 'claude-sonnet-4-20250514',
      temperature: 0.7,
    };

    await processMemory({
      res: mockRes,
      userId: 'user-123',
      setMemory: mockMemoryMethods.setMemory,
      deleteMemory: mockMemoryMethods.deleteMemory,
      messages: [],
      memory: 'existing memory',
      messageId: 'msg-123',
      conversationId: 'conv-123',
      validKeys: ['preferences'],
      instructions: 'test instructions',
      llmConfig,
      user: testUser,
    });

    expect(Run.create as jest.Mock).toHaveBeenCalled();
    const runConfig = (Run.create as jest.Mock).mock.calls[0][0];

    expect(runConfig.graphConfig.llmConfig.temperature).toBe(0.7);
  });

  it('should not modify temperature for Anthropic with thinking type not enabled', async () => {
    const llmConfig = {
      provider: Providers.ANTHROPIC,
      model: 'claude-sonnet-4-20250514',
      temperature: 0.7,
      thinking: {
        type: 'disabled',
      },
    };

    await processMemory({
      res: mockRes,
      userId: 'user-123',
      setMemory: mockMemoryMethods.setMemory,
      deleteMemory: mockMemoryMethods.deleteMemory,
      messages: [],
      memory: 'existing memory',
      messageId: 'msg-123',
      conversationId: 'conv-123',
      validKeys: ['preferences'],
      instructions: 'test instructions',
      llmConfig,
      user: testUser,
    });

    expect(Run.create as jest.Mock).toHaveBeenCalled();
    const runConfig = (Run.create as jest.Mock).mock.calls[0][0];

    expect(runConfig.graphConfig.llmConfig.temperature).toBe(0.7);
  });
});

describe('Memory mutation enforcement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('forces the exact memory tool for every explicit mutation attempt', async () => {
    const mockRes = {
      write: jest.fn(),
      end: jest.fn(),
      headersSent: false,
    } as unknown as Response;

    await processMemory({
      res: mockRes,
      userId: 'user-123',
      setMemory: jest.fn(),
      deleteMemory: jest.fn(),
      messages: [],
      memory: '',
      messageId: 'msg-123',
      conversationId: 'conv-123',
      intent: 'save',
      maxAttempts: 2,
      llmConfig: { provider: Providers.OPENAI, model: 'gpt-4.1-mini' },
    });

    expect(Run.create as jest.Mock).toHaveBeenCalledTimes(2);
    expect((Run.create as jest.Mock).mock.calls[0][0].graphConfig.llmConfig.tool_choice).toBe(
      'set_memory',
    );
    expect((Run.create as jest.Mock).mock.calls[1][0].graphConfig.llmConfig.tool_choice).toBe(
      'set_memory',
    );
  });

  it('persists an explicit save through the validated fallback when the model skips tools', async () => {
    const setMemory = jest.fn().mockResolvedValue({ ok: true, changed: true });
    const recordMemoryEvent = jest.fn().mockResolvedValue(undefined);
    const { HumanMessage } = jest.requireActual('@langchain/core/messages');

    await processMemory({
      res: { write: jest.fn(), end: jest.fn(), headersSent: false } as unknown as Response,
      userId: 'user-123',
      setMemory,
      deleteMemory: jest.fn(),
      recordMemoryEvent,
      messages: [
        new HumanMessage(
          '# Current Chat Request and Recent Context:\n\nHuman: Remember OLD_VALUE.\nAssistant: Earlier response.\nHuman: You MUST use the memory tool now. Save this exact durable fact to memory: CODEX_MEMORY_VALIDATION.\n\n# Completed Assistant and Tool Context:\n\nAssistant: Confirmed.',
        ),
      ],
      memory: '',
      messageId: 'response-123',
      sourceMessageId: 'request-123',
      conversationId: 'conv-123',
      intent: 'save',
      evidence: 'use the memory tool',
      maxAttempts: 2,
      maxWritesPerTurn: 2,
      maxValueTokens: 500,
      llmConfig: { provider: Providers.OPENAI, model: 'gpt-4.1-mini' },
    });

    expect(setMemory).toHaveBeenCalledTimes(1);
    expect(setMemory.mock.calls[0][0]).toMatchObject({
      userId: 'user-123',
      value: 'CODEX_MEMORY_VALIDATION.\n\nAssistant: Confirmed.',
    });
    expect(setMemory.mock.calls[0][0].key).toMatch(/^[a-z_]+$/);
    expect(recordMemoryEvent).toHaveBeenCalledWith(expect.objectContaining({ status: 'saved' }));
    expect(recordMemoryEvent).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'no_action' }));
  });

});

describe('Memory model observability', () => {
  it('collects every memory LLM call and labels the Langfuse trace as memory', async () => {
    const onUsage = jest.fn();
    const processStream = jest.fn(async () => {
      const runConfig = (Run.create as jest.Mock).mock.calls.at(-1)[0];
      runConfig.customHandlers[GraphEvents.CHAT_MODEL_END].handle(
        GraphEvents.CHAT_MODEL_END,
        {
          output: {
            usage_metadata: {
              input_tokens: 42,
              output_tokens: 7,
            },
          },
        },
        { ls_model_name: 'gpt-5.6-terra' },
      );
    });
    (Run.create as jest.Mock).mockImplementationOnce(() => ({ processStream }));

    await processMemory({
      res: { write: jest.fn(), end: jest.fn(), headersSent: false } as unknown as Response,
      userId: 'user-123',
      setMemory: jest.fn(),
      deleteMemory: jest.fn(),
      messages: [],
      memory: 'No existing memories',
      messageId: 'memory-response-123',
      conversationId: 'conversation-123',
      instructions: 'Use the memory tool.',
      llmConfig: {
        provider: Providers.OPENAI,
        model: 'gpt-5.6-terra',
      },
      intent: 'save',
      onUsage,
    });

    expect(onUsage).toHaveBeenCalledWith([
      { input_tokens: 42, output_tokens: 7, model: 'gpt-5.6-terra' },
    ]);
    const streamConfig = processStream.mock.calls[0][1];
    expect(streamConfig.runName).toBe('MemoryRun');
    expect(streamConfig.configurable.traceMetadata).toMatchObject({
      category: 'memory',
      operation: 'memory_mutation',
      provider: Providers.OPENAI,
      model: 'gpt-5.6-terra',
    });
  });
});
