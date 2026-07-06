import { Providers } from '@librechat/agents';
import { EModelEndpoint, EToolResources, FileContext } from 'librechat-data-provider';
import type { Agent } from 'librechat-data-provider';
import type { ServerRequest, InitializeResultBase } from '~/types';
import type { InitializeAgentDbMethods } from '../initialize';

// Mock logger
jest.mock('winston', () => ({
  addColors: jest.fn(),
  format: Object.assign(
    jest.fn((transform) => transform),
    {
      combine: jest.fn((...args) => args),
      colorize: jest.fn(() => 'colorize'),
      simple: jest.fn(() => 'simple'),
      errors: jest.fn(() => 'errors'),
      splat: jest.fn(() => 'splat'),
      timestamp: jest.fn(() => 'timestamp'),
      printf: jest.fn((fn) => fn),
      json: jest.fn(() => 'json'),
    },
  ),
  createLogger: jest.fn(() => ({
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
  transports: {
    Console: jest.fn(),
  },
}));

const mockExtractLibreChatParams = jest.fn();
const mockGetModelMaxTokens = jest.fn();
const mockOptionalChainWithEmptyCheck = jest.fn();
const mockGetThreadData = jest.fn();

jest.mock('~/utils', () => ({
  extractLibreChatParams: (...args: unknown[]) => mockExtractLibreChatParams(...args),
  getModelMaxTokens: (...args: unknown[]) => mockGetModelMaxTokens(...args),
  optionalChainWithEmptyCheck: (...args: unknown[]) => mockOptionalChainWithEmptyCheck(...args),
  getThreadData: (...args: unknown[]) => mockGetThreadData(...args),
}));

const mockGetProviderConfig = jest.fn();
jest.mock('~/endpoints', () => ({
  getProviderConfig: (...args: unknown[]) => mockGetProviderConfig(...args),
}));

jest.mock('~/files', () => ({
  filterFilesByEndpointConfig: jest.fn((_req, { files }) => files),
}));

jest.mock('~/prompts', () => ({
  generateArtifactsPrompt: jest.fn(() => null),
}));

const mockPrimeResources = jest.fn().mockResolvedValue({
  attachments: [],
  tool_resources: undefined,
});

jest.mock('../resources', () => ({
  primeResources: (...args: unknown[]) => mockPrimeResources(...args),
}));

import { initializeAgent } from '../initialize';

/**
 * Creates minimal mock objects for initializeAgent tests.
 */
function createMocks(overrides?: {
  maxContextTokens?: number;
  modelDefault?: number;
  maxOutputTokens?: number;
}) {
  const { maxContextTokens, modelDefault = 200000, maxOutputTokens = 4096 } = overrides ?? {};

  const agent = {
    id: 'agent-1',
    model: 'test-model',
    provider: Providers.OPENAI,
    tools: [],
    model_parameters: { model: 'test-model' },
  } as unknown as Agent;

  const req = {
    user: { id: 'user-1' },
    config: {},
  } as unknown as ServerRequest;

  const res = {} as unknown as import('express').Response;

  const mockGetOptions = jest.fn().mockResolvedValue({
    llmConfig: {
      model: 'test-model',
      maxTokens: maxOutputTokens,
    },
    endpointTokenConfig: undefined,
  } satisfies InitializeResultBase);

  mockGetProviderConfig.mockReturnValue({
    getOptions: mockGetOptions,
    overrideProvider: Providers.OPENAI,
  });

  // extractLibreChatParams returns maxContextTokens when provided in model_parameters
  mockExtractLibreChatParams.mockReturnValue({
    resendFiles: false,
    maxContextTokens,
    modelOptions: { model: 'test-model' },
  });

  // getModelMaxTokens returns the model's default context window
  mockGetModelMaxTokens.mockReturnValue(modelDefault);

  // Implement real optionalChainWithEmptyCheck behavior
  mockOptionalChainWithEmptyCheck.mockImplementation(
    (...values: (string | number | undefined)[]) => {
      for (const v of values) {
        if (v !== undefined && v !== null && v !== '') {
          return v;
        }
      }
      return values[values.length - 1];
    },
  );

  const loadTools = jest.fn().mockResolvedValue({
    tools: [],
    toolContextMap: {},
    userMCPAuthMap: undefined,
    toolRegistry: undefined,
    toolDefinitions: [],
    hasDeferredTools: false,
  });

  const db: InitializeAgentDbMethods = {
    getFiles: jest.fn().mockResolvedValue([]),
    getConvoFiles: jest.fn().mockResolvedValue([]),
    updateFilesUsage: jest.fn().mockResolvedValue([]),
    getUserKey: jest.fn().mockResolvedValue('user-1'),
    getUserKeyValues: jest.fn().mockResolvedValue([]),
    getToolFilesByIds: jest.fn().mockResolvedValue([]),
  };

  return { agent, req, res, loadTools, db };
}

describe('initializeAgent — maxContextTokens', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses user-configured maxContextTokens when provided via model_parameters', async () => {
    const userValue = 50000;
    const { agent, req, res, loadTools, db } = createMocks({
      maxContextTokens: userValue,
      modelDefault: 200000,
      maxOutputTokens: 4096,
    });

    const result = await initializeAgent(
      {
        req,
        res,
        agent,
        loadTools,
        endpointOption: {
          endpoint: EModelEndpoint.agents,
          model_parameters: { maxContextTokens: userValue },
        },
        allowedProviders: new Set([Providers.OPENAI]),
        isInitialAgent: true,
      },
      db,
    );

    expect(result.maxContextTokens).toBe(userValue);
  });

  it('falls back to formula when maxContextTokens is NOT provided', async () => {
    const modelDefault = 200000;
    const maxOutputTokens = 4096;
    const { agent, req, res, loadTools, db } = createMocks({
      maxContextTokens: undefined,
      modelDefault,
      maxOutputTokens,
    });

    const result = await initializeAgent(
      {
        req,
        res,
        agent,
        loadTools,
        endpointOption: { endpoint: EModelEndpoint.agents },
        allowedProviders: new Set([Providers.OPENAI]),
        isInitialAgent: true,
      },
      db,
    );

    const expected = Math.round((modelDefault - maxOutputTokens) * 0.9);
    expect(result.maxContextTokens).toBe(expected);
  });

  it('falls back to formula when maxContextTokens is 0', async () => {
    const maxOutputTokens = 4096;
    const { agent, req, res, loadTools, db } = createMocks({
      maxContextTokens: 0,
      modelDefault: 200000,
      maxOutputTokens,
    });

    const result = await initializeAgent(
      {
        req,
        res,
        agent,
        loadTools,
        endpointOption: {
          endpoint: EModelEndpoint.agents,
          model_parameters: { maxContextTokens: 0 },
        },
        allowedProviders: new Set([Providers.OPENAI]),
        isInitialAgent: true,
      },
      db,
    );

    // 0 is not used as-is; the formula kicks in.
    // optionalChainWithEmptyCheck(0, 200000, 18000) returns 0 (not null/undefined),
    // then Number(0) || 18000 = 18000 (the fallback default).
    expect(result.maxContextTokens).not.toBe(0);
    const expected = Math.round((18000 - maxOutputTokens) * 0.9);
    expect(result.maxContextTokens).toBe(expected);
  });

  it('falls back to formula when maxContextTokens is negative', async () => {
    const maxOutputTokens = 4096;
    const { agent, req, res, loadTools, db } = createMocks({
      maxContextTokens: -1,
      modelDefault: 200000,
      maxOutputTokens,
    });

    const result = await initializeAgent(
      {
        req,
        res,
        agent,
        loadTools,
        endpointOption: {
          endpoint: EModelEndpoint.agents,
          model_parameters: { maxContextTokens: -1 },
        },
        allowedProviders: new Set([Providers.OPENAI]),
        isInitialAgent: true,
      },
      db,
    );

    // -1 is not used as-is; the formula kicks in
    expect(result.maxContextTokens).not.toBe(-1);
  });

  it('preserves small user-configured value (e.g. 1000 from modelSpec)', async () => {
    const userValue = 1000;
    const { agent, req, res, loadTools, db } = createMocks({
      maxContextTokens: userValue,
      modelDefault: 128000,
      maxOutputTokens: 4096,
    });

    const result = await initializeAgent(
      {
        req,
        res,
        agent,
        loadTools,
        endpointOption: {
          endpoint: EModelEndpoint.agents,
          model_parameters: { maxContextTokens: userValue },
        },
        allowedProviders: new Set([Providers.OPENAI]),
        isInitialAgent: true,
      },
      db,
    );

    // Should NOT be overridden to Math.round((128000 - 4096) * 0.9) = 111,514
    expect(result.maxContextTokens).toBe(userValue);
  });
});

describe('initializeAgent — deterministic default tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('attaches all deterministic utilities to every agent initialization by default', async () => {
    const { agent, req, res, loadTools, db } = createMocks();

    await initializeAgent(
      {
        req,
        res,
        agent,
        loadTools,
        endpointOption: { endpoint: EModelEndpoint.agents },
        allowedProviders: new Set([Providers.OPENAI]),
        isInitialAgent: true,
      },
      db,
    );

    expect(loadTools).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.arrayContaining([
          'calculator',
          'text_analyzer',
          'string_utility',
          'json_utility',
        ]),
      }),
    );
  });

  it('honors admin tool toggles independently', async () => {
    const { agent, req, res, loadTools, db } = createMocks();
    req.appSettings = {
      settingsId: 'global',
      deterministicTools: { calculator: false, textAnalyzer: true },
    };

    await initializeAgent(
      {
        req,
        res,
        agent,
        loadTools,
        endpointOption: { endpoint: EModelEndpoint.agents },
        allowedProviders: new Set([Providers.OPENAI]),
        isInitialAgent: true,
      },
      db,
    );

    const requestedTools = loadTools.mock.calls[0][0].tools;
    expect(requestedTools).toContain('text_analyzer');
    expect(requestedTools).toContain('string_utility');
    expect(requestedTools).toContain('json_utility');
    expect(requestedTools).not.toContain('calculator');
  });
});

describe('initializeAgent — Code Interpreter thread attachments', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrimeResources.mockResolvedValue({ attachments: [], tool_resources: undefined });
  });

  it('marks ordinary branch attachments for lazy execute_code staging', async () => {
    const { agent, req, res, loadTools, db } = createMocks();
    agent.tools = [EToolResources.execute_code];
    mockExtractLibreChatParams.mockReturnValue({
      resendFiles: true,
      maxContextTokens: undefined,
      modelOptions: { model: 'test-model' },
    });
    mockGetThreadData.mockReturnValue({
      messageIds: ['message-1'],
      fileIds: ['resume-file'],
    });

    const resumeFile = {
      file_id: 'resume-file',
      filename: 'resume.pdf',
      filepath: '/uploads/resume.pdf',
      type: 'application/pdf',
      context: FileContext.message_attachment,
      metadata: {},
    };

    db.getConvoFiles = jest.fn().mockResolvedValue(['resume-file']);
    db.getMessages = jest
      .fn()
      .mockResolvedValue([
        { messageId: 'message-1', parentMessageId: 'root', files: [{ file_id: 'resume-file' }] },
      ]);
    db.getCodeGeneratedFiles = jest.fn().mockResolvedValue([]);
    db.getUserCodeFiles = jest.fn().mockResolvedValue([resumeFile]);
    db.updateFilesUsage = jest.fn().mockResolvedValue([resumeFile]);

    await initializeAgent(
      {
        req,
        res,
        agent,
        loadTools,
        conversationId: 'conversation-1',
        parentMessageId: 'message-1',
        endpointOption: { endpoint: EModelEndpoint.agents },
        allowedProviders: new Set([Providers.OPENAI]),
        isInitialAgent: true,
      },
      db,
    );

    const primeCall = mockPrimeResources.mock.calls[0][0];
    const attachments = await primeCall.attachments;
    expect(attachments).toEqual([
      expect.objectContaining({
        file_id: 'resume-file',
        metadata: expect.objectContaining({ nativeTool: EToolResources.execute_code }),
      }),
    ]);
  });
});
