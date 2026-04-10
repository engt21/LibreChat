jest.mock('@librechat/data-schemas', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

jest.mock('librechat-data-provider', () => ({
  Constants: { NO_PARENT: '00000000-0000-0000-0000-000000000000', mcp_prefix: 'mcp_' },
  EndpointURLs: { agents: '/api/agents' },
  parseTextParts: jest.fn((content) =>
    (content || [])
      .filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join(''),
  ),
  isAgentsEndpoint: jest.fn((ep) => ep === 'agents'),
}));

const mockBuildEndpointOption = jest.fn();
jest.mock(
  '~/server/middleware/buildEndpointOption',
  () =>
    (...args) =>
      mockBuildEndpointOption(...args),
);

const mockInitializeClient = jest.fn();
jest.mock('~/server/services/Endpoints/agents', () => ({
  initializeClient: (...args) => mockInitializeClient(...args),
}));

jest.mock('~/server/services/Endpoints/agents/title', () => jest.fn().mockResolvedValue({}));

const mockGetModelsConfig = jest.fn();
jest.mock('~/server/controllers/ModelController', () => ({
  getModelsConfig: (...args) => mockGetModelsConfig(...args),
}));

const mockValidateModelAccess = jest.fn();
jest.mock('~/server/services/ModelAccess', () => ({
  validateModelAccess: (...args) => mockValidateModelAccess(...args),
}));

jest.mock('~/server/services/Config', () => ({
  getAppConfig: jest.fn().mockResolvedValue({}),
}));

jest.mock('~/server/cleanup', () => ({
  disposeClient: jest.fn(),
}));

const {
  executeScheduledRun,
  extractResponsePreview,
  detectAuthContinuationResponse,
} = require('./execution');

const baseSchedule = {
  scheduleId: 's1',
  user: 'user-1',
  name: 'Test Schedule',
  prompt: 'Run test',
  cron: '0 9 * * *',
  timezone: 'UTC',
  target: { endpoint: 'openAI', model: 'gpt-4' },
};

const baseUser = {
  _id: 'user-1',
  id: 'user-1',
  name: 'Test User',
  email: 'test@example.com',
  role: 'USER',
};

beforeEach(() => {
  jest.clearAllMocks();

  // Default: buildEndpointOption succeeds
  mockBuildEndpointOption.mockImplementation(async (req, _res, next) => {
    req.body.endpointOption = {
      endpoint: req.body.endpoint,
      modelOptions: { model: req.body.model || 'gpt-4' },
    };
    next();
  });

  // Default: model access is valid
  mockGetModelsConfig.mockResolvedValue({
    openAI: ['gpt-4', 'gpt-5.1'],
  });
  mockValidateModelAccess.mockResolvedValue({ isValid: true });

  // Default: client initializes and sends successfully
  const mockClient = {
    sendMessage: jest.fn().mockResolvedValue({
      text: 'Test response',
      messageId: 'resp-1',
      conversationId: 'conv-1',
      databasePromise: Promise.resolve({ conversation: { title: 'Test' } }),
    }),
  };
  mockInitializeClient.mockResolvedValue({
    client: mockClient,
    userMCPAuthMap: null,
  });
});

describe('extractResponsePreview', () => {
  it('extracts text from response.text', () => {
    expect(extractResponsePreview({ text: 'Hello world' })).toBe('Hello world');
  });

  it('extracts text from response.content parts', () => {
    const { parseTextParts } = require('librechat-data-provider');
    parseTextParts.mockReturnValue('content text');
    expect(extractResponsePreview({ content: [{ type: 'text', text: 'content text' }] })).toBe(
      'content text',
    );
  });

  it('returns empty string for empty response', () => {
    expect(extractResponsePreview({})).toBe('');
    expect(extractResponsePreview(null)).toBe('');
  });
});

describe('detectAuthContinuationResponse', () => {
  it('detects pure JSON authorization_url response', () => {
    const consentJson = JSON.stringify({
      authorization_url:
        'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=abc',
      llm_instructions: 'Please share the authorization link.',
    });
    const result = detectAuthContinuationResponse({ text: consentJson });
    expect(result.isAuthContinuation).toBe(true);
    expect(result.authUrl).toContain('microsoftonline.com');
  });

  it('detects embedded authorization_url in multi-part response', () => {
    const text =
      'Microsoft Outlook authorization required.\n\n' +
      JSON.stringify({
        authorization_url: 'https://cloud.arcade.dev/oauth2/authorize',
        llm_instructions: 'Provider authorization needed.',
      });
    const result = detectAuthContinuationResponse({ text });
    expect(result.isAuthContinuation).toBe(true);
    expect(result.authUrl).toContain('arcade.dev');
  });

  it('returns false for normal response text', () => {
    const result = detectAuthContinuationResponse({ text: 'Here is your scheduled report.' });
    expect(result.isAuthContinuation).toBe(false);
    expect(result.authUrl).toBeUndefined();
  });

  it('returns false for empty response', () => {
    expect(detectAuthContinuationResponse({}).isAuthContinuation).toBe(false);
    expect(detectAuthContinuationResponse(null).isAuthContinuation).toBe(false);
    expect(detectAuthContinuationResponse({ text: '' }).isAuthContinuation).toBe(false);
  });

  it('detects authorization_url-only JSON without llm_instructions', () => {
    const consentJson = JSON.stringify({
      authorization_url: 'https://login.microsoftonline.com/authorize',
    });
    const result = detectAuthContinuationResponse({ text: consentJson });
    expect(result.isAuthContinuation).toBe(true);
  });

  it('does not flag responses that merely mention authorization in prose', () => {
    const result = detectAuthContinuationResponse({
      text: 'You need to complete the authorization process at the OAuth provider.',
    });
    expect(result.isAuthContinuation).toBe(false);
  });
});

describe('executeScheduledRun', () => {
  it('executes a model-target schedule successfully (VAL-CROSS-005)', async () => {
    const result = await executeScheduledRun(baseSchedule, baseUser);

    expect(result.success).toBe(true);
    expect(result.conversationId).toBeDefined();
    expect(result.responseMessageId).toBeDefined();
    expect(result.preview).toBeDefined();
  });

  it('validates model access at execution time (VAL-CROSS-005)', async () => {
    await executeScheduledRun(baseSchedule, baseUser);

    expect(mockGetModelsConfig).toHaveBeenCalled();
    expect(mockValidateModelAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'openAI',
        model: 'gpt-4',
      }),
    );
  });

  it('fails explicitly when model access is denied by policy (VAL-CROSS-005)', async () => {
    mockValidateModelAccess.mockResolvedValue({
      isValid: false,
      text: 'Illegal model request',
    });

    await expect(executeScheduledRun(baseSchedule, baseUser)).rejects.toThrow(
      'Illegal model request',
    );
  });

  it('carries user modelPermissions into the internal request for policy filtering (VAL-CROSS-005)', async () => {
    const restrictedUser = {
      ...baseUser,
      modelPermissions: {
        enabled: true,
        rules: [{ endpoint: 'openAI', models: ['gpt-4'] }],
      },
    };

    await executeScheduledRun(baseSchedule, restrictedUser);

    // Verify getModelsConfig received a request whose user has modelPermissions
    const reqArg = mockGetModelsConfig.mock.calls[0][0];
    expect(reqArg.user.modelPermissions).toEqual(restrictedUser.modelPermissions);
  });

  it('fails when model is removed from user permissions after schedule creation (VAL-CROSS-005)', async () => {
    // Simulate: user had gpt-4 access when schedule was created, but admin later
    // changed their modelPermissions to only allow gpt-5.1
    const restrictedUser = {
      ...baseUser,
      modelPermissions: {
        enabled: true,
        rules: [{ endpoint: 'openAI', models: ['gpt-5.1'] }],
      },
    };

    // getModelsConfig returns filtered results based on the user's current permissions
    mockGetModelsConfig.mockResolvedValue({ openAI: ['gpt-5.1'] });
    // validateModelAccess will fail because gpt-4 is not in the filtered list
    mockValidateModelAccess.mockResolvedValue({
      isValid: false,
      text: 'Illegal model request',
    });

    await expect(executeScheduledRun(baseSchedule, restrictedUser)).rejects.toThrow(
      'Illegal model request',
    );

    // Verify no conversation was created (no client interaction)
    expect(mockInitializeClient).not.toHaveBeenCalled();
  });

  it('skips model access validation for agent endpoints (agent targets use agent validation)', async () => {
    const agentSchedule = {
      ...baseSchedule,
      target: { endpoint: 'agents', agent_id: 'agent-1' },
    };

    await executeScheduledRun(agentSchedule, baseUser);

    // validateModelAccess should NOT be called for agent endpoints
    expect(mockValidateModelAccess).not.toHaveBeenCalled();
  });

  it('fails when buildEndpointOption fails', async () => {
    mockBuildEndpointOption.mockImplementation(async (_req, res) => {
      res.body = { text: 'Error building endpoint option' };
    });

    await expect(executeScheduledRun(baseSchedule, baseUser)).rejects.toThrow(
      'Error building endpoint option',
    );
  });

  it('passes userMCPAuthMap to sendMessage (VAL-CROSS-005A)', async () => {
    const mockAuthMap = new Map([['arcade', { token: 'tok-123' }]]);
    const mockClient = {
      sendMessage: jest.fn().mockResolvedValue({
        text: 'MCP response',
        messageId: 'msg-1',
        conversationId: 'conv-1',
        databasePromise: Promise.resolve({ conversation: {} }),
      }),
    };
    mockInitializeClient.mockResolvedValue({
      client: mockClient,
      userMCPAuthMap: mockAuthMap,
    });

    await executeScheduledRun(baseSchedule, baseUser);

    expect(mockClient.sendMessage).toHaveBeenCalledWith(
      baseSchedule.prompt,
      expect.objectContaining({
        userMCPAuthMap: mockAuthMap,
      }),
    );
  });

  it('propagates client initialization failure (VAL-CROSS-005A)', async () => {
    mockInitializeClient.mockRejectedValue(new Error('MCP auth required'));

    await expect(executeScheduledRun(baseSchedule, baseUser)).rejects.toThrow('MCP auth required');
  });

  it('creates internal request with correct user context', async () => {
    const userWithObjectId = {
      _id: { toString: () => 'user-obj-1' },
      name: 'Test',
      email: 'test@example.com',
      role: 'USER',
    };

    await executeScheduledRun(baseSchedule, userWithObjectId);

    const initCall = mockInitializeClient.mock.calls[0][0];
    expect(initCall.req.user.id).toBe('user-obj-1');
  });

  it('builds the request body from schedule target', async () => {
    const scheduleWithTools = {
      ...baseSchedule,
      target: {
        endpoint: 'openAI',
        model: 'gpt-4',
        ephemeralAgent: {
          web_search: true,
          execute_code: false,
          mcp: ['arcade-server'],
        },
      },
    };

    // Capture the request passed to buildEndpointOption
    mockBuildEndpointOption.mockImplementation(async (req, _res, next) => {
      req.body.endpointOption = {
        endpoint: req.body.endpoint,
        modelOptions: { model: req.body.model },
      };
      next();
    });

    // Provide valid MCP auth so the OAuth consent check passes
    mockInitializeClient.mockResolvedValue({
      client: {
        sendMessage: jest.fn().mockResolvedValue({
          text: 'Response',
          messageId: 'msg-1',
          conversationId: 'conv-1',
          databasePromise: Promise.resolve({ conversation: {} }),
        }),
      },
      userMCPAuthMap: {
        'mcp_arcade-server': { access_token: 'valid-token' },
      },
    });

    await executeScheduledRun(scheduleWithTools, baseUser);

    const buildCall = mockBuildEndpointOption.mock.calls[0];
    const reqBody = buildCall[0].body;
    expect(reqBody.endpoint).toBe('openAI');
    expect(reqBody.ephemeralAgent.web_search).toBe(true);
    expect(reqBody.ephemeralAgent.mcp).toEqual(['arcade-server']);
  });

  describe('MCP OAuth consent validation (VAL-CROSS-005A)', () => {
    const mcpSchedule = {
      ...baseSchedule,
      target: {
        endpoint: 'openAI',
        model: 'gpt-4',
        ephemeralAgent: {
          mcp: ['arcade-microsoft'],
        },
      },
    };

    it('fails explicitly when MCP servers have empty auth (pending consent)', async () => {
      // userMCPAuthMap has the server key but the auth values are empty (no tokens)
      const emptyAuthMap = { 'mcp_arcade-microsoft': {} };
      const mockClient = {
        sendMessage: jest.fn().mockResolvedValue({
          text: 'should not reach',
          messageId: 'msg-1',
          conversationId: 'conv-1',
          databasePromise: Promise.resolve({ conversation: {} }),
        }),
      };
      mockInitializeClient.mockResolvedValue({
        client: mockClient,
        userMCPAuthMap: emptyAuthMap,
      });

      await expect(executeScheduledRun(mcpSchedule, baseUser)).rejects.toThrow(
        /OAuth consent.*arcade-microsoft/i,
      );

      // sendMessage should NOT have been called
      expect(mockClient.sendMessage).not.toHaveBeenCalled();
    });

    it('fails explicitly when MCP servers are missing from auth map', async () => {
      // userMCPAuthMap does not contain an entry for the requested server at all
      const mockClient = {
        sendMessage: jest.fn().mockResolvedValue({
          text: 'should not reach',
          messageId: 'msg-1',
          conversationId: 'conv-1',
          databasePromise: Promise.resolve({ conversation: {} }),
        }),
      };
      mockInitializeClient.mockResolvedValue({
        client: mockClient,
        userMCPAuthMap: {},
      });

      await expect(executeScheduledRun(mcpSchedule, baseUser)).rejects.toThrow(
        /OAuth consent.*arcade-microsoft/i,
      );

      expect(mockClient.sendMessage).not.toHaveBeenCalled();
    });

    it('fails explicitly when userMCPAuthMap is null and MCP servers are required', async () => {
      const mockClient = {
        sendMessage: jest.fn().mockResolvedValue({
          text: 'should not reach',
          messageId: 'msg-1',
          conversationId: 'conv-1',
          databasePromise: Promise.resolve({ conversation: {} }),
        }),
      };
      mockInitializeClient.mockResolvedValue({
        client: mockClient,
        userMCPAuthMap: null,
      });

      await expect(executeScheduledRun(mcpSchedule, baseUser)).rejects.toThrow(
        /OAuth consent.*arcade-microsoft/i,
      );

      expect(mockClient.sendMessage).not.toHaveBeenCalled();
    });

    it('succeeds when MCP servers have valid auth tokens (consent complete)', async () => {
      const validAuthMap = {
        'mcp_arcade-microsoft': { access_token: 'valid-token-123', token_type: 'bearer' },
      };
      const mockClient = {
        sendMessage: jest.fn().mockResolvedValue({
          text: 'MCP tool executed successfully',
          messageId: 'msg-1',
          conversationId: 'conv-1',
          databasePromise: Promise.resolve({ conversation: { title: 'MCP Run' } }),
        }),
      };
      mockInitializeClient.mockResolvedValue({
        client: mockClient,
        userMCPAuthMap: validAuthMap,
      });

      const result = await executeScheduledRun(mcpSchedule, baseUser);
      expect(result.success).toBe(true);
      expect(mockClient.sendMessage).toHaveBeenCalled();
    });

    it('skips MCP auth validation for schedules without MCP servers', async () => {
      // Schedule without MCP - should succeed even with null auth map
      const noMcpSchedule = {
        ...baseSchedule,
        target: {
          endpoint: 'openAI',
          model: 'gpt-4',
          ephemeralAgent: {
            web_search: true,
          },
        },
      };

      mockInitializeClient.mockResolvedValue({
        client: {
          sendMessage: jest.fn().mockResolvedValue({
            text: 'Response',
            messageId: 'msg-1',
            conversationId: 'conv-1',
            databasePromise: Promise.resolve({ conversation: {} }),
          }),
        },
        userMCPAuthMap: null,
      });

      const result = await executeScheduledRun(noMcpSchedule, baseUser);
      expect(result.success).toBe(true);
    });

    it('reports all MCP servers with missing auth in the error message', async () => {
      const multiMcpSchedule = {
        ...baseSchedule,
        target: {
          endpoint: 'openAI',
          model: 'gpt-4',
          ephemeralAgent: {
            mcp: ['arcade-microsoft', 'arcade-github'],
          },
        },
      };

      mockInitializeClient.mockResolvedValue({
        client: {
          sendMessage: jest.fn(),
        },
        userMCPAuthMap: {
          'mcp_arcade-microsoft': {},
          'mcp_arcade-github': {},
        },
      });

      await expect(executeScheduledRun(multiMcpSchedule, baseUser)).rejects.toThrow(
        /arcade-microsoft.*arcade-github|arcade-github.*arcade-microsoft/,
      );
    });

    it('fails only for MCP servers with missing auth, not ones with valid tokens', async () => {
      const multiMcpSchedule = {
        ...baseSchedule,
        target: {
          endpoint: 'openAI',
          model: 'gpt-4',
          ephemeralAgent: {
            mcp: ['arcade-microsoft', 'arcade-github'],
          },
        },
      };

      mockInitializeClient.mockResolvedValue({
        client: {
          sendMessage: jest.fn(),
        },
        userMCPAuthMap: {
          'mcp_arcade-microsoft': { access_token: 'valid-token' },
          'mcp_arcade-github': {},
        },
      });

      const error = await executeScheduledRun(multiMcpSchedule, baseUser).catch((e) => e);
      expect(error.message).toMatch(/arcade-github/);
      expect(error.message).not.toMatch(/arcade-microsoft/);
    });

    it('fails when auth entry has metadata but no access_token (pending consent)', async () => {
      // Auth entry exists with some keys but lacks the required access_token field.
      // This can occur when OAuth metadata is stored before consent completes.
      const metadataOnlyAuthMap = {
        'mcp_arcade-microsoft': { token_type: 'bearer', scope: 'User.Read' },
      };
      const mockClient = {
        sendMessage: jest.fn().mockResolvedValue({
          text: 'should not reach',
          messageId: 'msg-1',
          conversationId: 'conv-1',
          databasePromise: Promise.resolve({ conversation: {} }),
        }),
      };
      mockInitializeClient.mockResolvedValue({
        client: mockClient,
        userMCPAuthMap: metadataOnlyAuthMap,
      });

      await expect(executeScheduledRun(mcpSchedule, baseUser)).rejects.toThrow(
        /OAuth consent.*arcade-microsoft/i,
      );
      expect(mockClient.sendMessage).not.toHaveBeenCalled();
    });

    it('fails when auth entry has empty-string access_token', async () => {
      const emptyTokenAuthMap = {
        'mcp_arcade-microsoft': { access_token: '', token_type: 'bearer' },
      };
      const mockClient = {
        sendMessage: jest.fn().mockResolvedValue({
          text: 'should not reach',
          messageId: 'msg-1',
          conversationId: 'conv-1',
          databasePromise: Promise.resolve({ conversation: {} }),
        }),
      };
      mockInitializeClient.mockResolvedValue({
        client: mockClient,
        userMCPAuthMap: emptyTokenAuthMap,
      });

      await expect(executeScheduledRun(mcpSchedule, baseUser)).rejects.toThrow(
        /OAuth consent.*arcade-microsoft/i,
      );
      expect(mockClient.sendMessage).not.toHaveBeenCalled();
    });

    it('fails when auth entry has non-string access_token', async () => {
      const badTokenAuthMap = {
        'mcp_arcade-microsoft': { access_token: 123, token_type: 'bearer' },
      };
      const mockClient = {
        sendMessage: jest.fn(),
      };
      mockInitializeClient.mockResolvedValue({
        client: mockClient,
        userMCPAuthMap: badTokenAuthMap,
      });

      await expect(executeScheduledRun(mcpSchedule, baseUser)).rejects.toThrow(
        /OAuth consent.*arcade-microsoft/i,
      );
      expect(mockClient.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('Auth-continuation response detection (VAL-MCP-004, VAL-CROSS-005A)', () => {
    const mcpSchedule = {
      ...baseSchedule,
      target: {
        endpoint: 'openAI',
        model: 'gpt-4',
        ephemeralAgent: {
          mcp: ['arcade-microsoft'],
        },
      },
    };

    it('fails when sendMessage returns an authorization_url continuation prompt', async () => {
      const consentJson = JSON.stringify({
        authorization_url:
          'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=abc',
        llm_instructions: 'Please share the authorization link with the user.',
      });

      const validAuthMap = {
        'mcp_arcade-microsoft': { access_token: 'valid-token-123', token_type: 'bearer' },
      };
      const mockClient = {
        sendMessage: jest.fn().mockResolvedValue({
          text: consentJson,
          messageId: 'msg-1',
          conversationId: 'conv-1',
          databasePromise: Promise.resolve({ conversation: {} }),
        }),
      };
      mockInitializeClient.mockResolvedValue({
        client: mockClient,
        userMCPAuthMap: validAuthMap,
      });

      await expect(executeScheduledRun(mcpSchedule, baseUser)).rejects.toThrow(
        /authorization prompt.*provider consent.*arcade-microsoft/i,
      );
    });

    it('fails when response contains embedded authorization_url in multi-part text', async () => {
      const embeddedConsent =
        'Microsoft Outlook authorization required.\n\n' +
        JSON.stringify({
          authorization_url: 'https://cloud.arcade.dev/oauth2/authorize',
          llm_instructions: 'Provider authorization needed.',
        });

      const validAuthMap = {
        'mcp_arcade-microsoft': { access_token: 'valid-token-123', token_type: 'bearer' },
      };
      const mockClient = {
        sendMessage: jest.fn().mockResolvedValue({
          text: embeddedConsent,
          messageId: 'msg-1',
          conversationId: 'conv-1',
          databasePromise: Promise.resolve({ conversation: {} }),
        }),
      };
      mockInitializeClient.mockResolvedValue({
        client: mockClient,
        userMCPAuthMap: validAuthMap,
      });

      await expect(executeScheduledRun(mcpSchedule, baseUser)).rejects.toThrow(
        /authorization prompt.*provider consent/i,
      );
    });

    it('succeeds when response is normal tool output without authorization_url', async () => {
      const validAuthMap = {
        'mcp_arcade-microsoft': { access_token: 'valid-token-123', token_type: 'bearer' },
      };
      const mockClient = {
        sendMessage: jest.fn().mockResolvedValue({
          text: 'Here are your upcoming calendar events: Meeting at 2pm, Standup at 3pm.',
          messageId: 'msg-1',
          conversationId: 'conv-1',
          databasePromise: Promise.resolve({ conversation: { title: 'Calendar Events' } }),
        }),
      };
      mockInitializeClient.mockResolvedValue({
        client: mockClient,
        userMCPAuthMap: validAuthMap,
      });

      const result = await executeScheduledRun(mcpSchedule, baseUser);
      expect(result.success).toBe(true);
      expect(result.preview).toContain('calendar events');
    });

    it('succeeds for schedule without MCP even if response mentions authorization', async () => {
      // Non-MCP schedules should not trigger auth-continuation detection since the
      // authorization_url detection only targets MCP tool consent patterns (JSON).
      const noMcpSchedule = {
        ...baseSchedule,
        target: {
          endpoint: 'openAI',
          model: 'gpt-4',
        },
      };

      const mockClient = {
        sendMessage: jest.fn().mockResolvedValue({
          text: 'You need to complete the authorization process at the OAuth provider.',
          messageId: 'msg-1',
          conversationId: 'conv-1',
          databasePromise: Promise.resolve({ conversation: {} }),
        }),
      };
      mockInitializeClient.mockResolvedValue({
        client: mockClient,
        userMCPAuthMap: null,
      });

      const result = await executeScheduledRun(noMcpSchedule, baseUser);
      expect(result.success).toBe(true);
    });
  });
});
