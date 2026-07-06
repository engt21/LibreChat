const express = require('express');
const request = require('supertest');
const { MAX_GRAFT_MESSAGES } = require('~/server/services/MessageGrafts/constants');

const GRAFT_ENV_KEYS = [
  'GRAFT_RATE_WINDOW_MINUTES',
  'GRAFT_PREVIEW_IP_MAX',
  'GRAFT_PREVIEW_USER_MAX',
  'GRAFT_MUTATION_IP_MAX',
  'GRAFT_MUTATION_USER_MAX',
];

const savedEnv = Object.fromEntries(GRAFT_ENV_KEYS.map((key) => [key, process.env[key]]));

function restoreEnv() {
  for (const key of GRAFT_ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
      continue;
    }

    process.env[key] = savedEnv[key];
  }
}

function configureEnv(overrides = {}) {
  restoreEnv();

  for (const [key, value] of Object.entries(overrides)) {
    if (value == null) {
      delete process.env[key];
      continue;
    }

    process.env[key] = String(value);
  }
}

function createTestError(message, details = {}) {
  return Object.assign(new Error(message), details);
}

function createRouteLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function mockMessagesRouteDependencies({
  logViolationImplementation,
  middlewareFactory,
  messageGraftsModuleFactory,
} = {}) {
  const previewGenerationGraft = jest.fn();
  const createGenerationGraft = jest.fn();
  const getGenerationGraft = jest.fn();
  const undoGenerationGraft = jest.fn();
  const logViolation = jest.fn();
  const routeLogger = createRouteLogger();

  if (logViolationImplementation) {
    logViolation.mockImplementation(logViolationImplementation);
  } else {
    logViolation.mockResolvedValue(undefined);
  }

  jest.doMock(
    '@librechat/api',
    () => ({
      unescapeLaTeX: jest.fn((value) => value),
      countTokens: jest.fn().mockResolvedValue(10),
      limiterCache: jest.fn(() => undefined),
    }),
    { virtual: true },
  );

  jest.doMock('@librechat/data-schemas', () => ({
    logger: routeLogger,
  }));

  jest.doMock(
    'librechat-data-provider',
    () => ({
      ContentTypes: {
        TEXT: 'text',
        THINK: 'think',
        TOOL_CALL: 'tool_call',
      },
    }),
    { virtual: true },
  );

  const defaultMessageGraftsModule = {
    previewGenerationGraft,
    createGenerationGraft,
    getGenerationGraft,
    undoGenerationGraft,
  };

  jest.doMock('~/models', () => ({
    saveConvo: jest.fn(),
    getMessage: jest.fn(),
    saveMessage: jest.fn(),
    getMessages: jest.fn(),
    updateMessage: jest.fn(),
    deleteMessages: jest.fn(),
    deleteMessageBranch: jest.fn(),
  }));

  jest.doMock('~/server/services/Artifacts/update', () => ({
    findAllArtifacts: jest.fn(),
    replaceArtifactContent: jest.fn(),
  }));

  jest.doMock('~/models/Conversation', () => ({
    getConvosQueried: jest.fn(),
  }));

  jest.doMock('~/models/Transaction', () => ({
    getTransactions: jest.fn(),
  }));

  jest.doMock('~/db/models', () => ({
    Message: {
      findOne: jest.fn(),
      find: jest.fn(),
      meiliSearch: jest.fn(),
    },
    ToolCall: {
      find: jest.fn(),
    },
  }));

  jest.doMock('~/cache/logViolation', () => logViolation);

  jest.doMock(
    '~/server/services/MessageGrafts',
    () =>
      messageGraftsModuleFactory?.({
        previewGenerationGraft,
        createGenerationGraft,
        getGenerationGraft,
        undoGenerationGraft,
      }) ?? defaultMessageGraftsModule,
  );

  jest.doMock(
    '~/server/middleware',
    () =>
      middlewareFactory?.() ?? {
        requireJwtAuth: (req, res, next) => next(),
        validateMessageReq: (req, res, next) => next(),
        createGraftLimiters: jest.requireActual('~/server/middleware/limiters/graftLimiters')
          .createGraftLimiters,
      },
  );

  return {
    previewGenerationGraft,
    createGenerationGraft,
    getGenerationGraft,
    undoGenerationGraft,
    logViolation,
    routeLogger,
  };
}

function loadMessagesRouter(options = {}) {
  configureEnv(options.env);
  jest.resetModules();

  let router;
  const mockedDependencies = mockMessagesRouteDependencies(options);
  let getMessages;

  jest.isolateModules(() => {
    router = require('../messages');
    ({ getMessages } = require('~/models'));
  });

  return {
    router,
    getMessages,
    ...mockedDependencies,
  };
}

function setupApp(options = {}) {
  const loaded = loadMessagesRouter(options);
  const app = express();

  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: req.get('x-test-user') || 'user-1' };

    const testIp = req.get('x-test-ip');
    if (testIp) {
      Object.defineProperty(req, 'ip', {
        configurable: true,
        value: testIp,
      });
    }

    next();
  });
  app.use('/api/messages', loaded.router);

  loaded.previewGenerationGraft.mockResolvedValue({
    graftId: 'preview-1',
    treeRevision: 'rev-1',
  });
  loaded.createGenerationGraft.mockResolvedValue({
    graftId: 'graft-1',
    activeCopiedMessageId: 'copy-1',
  });
  loaded.getGenerationGraft.mockResolvedValue({
    graftId: 'graft-1',
    copiedMessageIds: ['copy-1'],
  });
  loaded.undoGenerationGraft.mockResolvedValue({
    graftId: 'graft-1',
    deletedMessageIds: ['bridge-1', 'copy-1'],
    deletedCount: 2,
  });

  return {
    app,
    ...loaded,
  };
}

describe('generation graft message routes', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.dontMock('@librechat/api');
    jest.dontMock('@librechat/data-schemas');
    jest.dontMock('librechat-data-provider');
    jest.dontMock('~/models');
    jest.dontMock('~/server/services/Artifacts/update');
    jest.dontMock('~/models/Conversation');
    jest.dontMock('~/models/Transaction');
    jest.dontMock('~/db/models');
    jest.dontMock('~/cache/logViolation');
    jest.dontMock('~/server/services/MessageGrafts');
    jest.dontMock('~/server/middleware');
    restoreEnv();
  });

  afterAll(() => {
    restoreEnv();
  });

  it('actual limiter export graph exposes createGraftLimiters', () => {
    configureEnv();
    jest.resetModules();

    jest.doMock('@librechat/api', () => ({ limiterCache: jest.fn(() => undefined) }), {
      virtual: true,
    });
    jest.doMock('@librechat/data-schemas', () => ({ logger: createRouteLogger() }));
    jest.doMock('~/cache/logViolation', () => jest.fn().mockResolvedValue(undefined));
    jest.doMock('~/server/middleware/limiters/ttsLimiters', () => jest.fn());
    jest.doMock('~/server/middleware/limiters/sttLimiters', () => jest.fn());
    jest.doMock('~/server/middleware/limiters/loginLimiter', () => jest.fn());
    jest.doMock('~/server/middleware/limiters/loginAccountLimiter', () => jest.fn());
    jest.doMock('~/server/middleware/limiters/mfaLimiter', () => jest.fn());
    jest.doMock('~/server/middleware/limiters/importLimiters', () => ({}));
    jest.doMock('~/server/middleware/limiters/uploadLimiters', () => ({}));
    jest.doMock('~/server/middleware/limiters/forkLimiters', () => ({}));
    jest.doMock('~/server/middleware/limiters/registerLimiter', () => jest.fn());
    jest.doMock('~/server/middleware/limiters/toolCallLimiter', () => jest.fn());
    jest.doMock('~/server/middleware/limiters/messageLimiters', () => ({}));
    jest.doMock('~/server/middleware/limiters/verifyEmailLimiter', () => jest.fn());
    jest.doMock('~/server/middleware/limiters/resetPasswordLimiter', () => jest.fn());

    for (const modulePath of [
      '~/server/middleware/validatePasswordReset',
      '~/server/middleware/validateRegistration',
      '~/server/middleware/buildEndpointOption',
      '~/server/middleware/validateMessageReq',
      '~/server/middleware/checkDomainAllowed',
      '~/server/middleware/requireLocalAuth',
      '~/server/middleware/canDeleteAccount',
      '~/server/middleware/requireLdapAuth',
      '~/server/middleware/checkInviteUser',
      '~/server/middleware/requireJwtAuth',
      '~/server/middleware/config/app',
      '~/server/middleware/validateModel',
      '~/server/middleware/moderateText',
      '~/server/middleware/logHeaders',
      '~/server/middleware/setHeaders',
      '~/server/middleware/uaParser',
      '~/server/middleware/checkBan',
      '~/server/middleware/noIndex',
    ]) {
      jest.doMock(modulePath, () => jest.fn());
    }

    for (const modulePath of [
      '~/server/middleware/accessResources',
      '~/server/middleware/abortMiddleware',
      '~/server/middleware/validate',
      '~/server/middleware/roles',
    ]) {
      jest.doMock(modulePath, () => ({}));
    }

    jest.isolateModules(() => {
      const limiters = require('~/server/middleware/limiters');
      const middleware = require('~/server/middleware');

      expect(typeof limiters.createGraftLimiters).toBe('function');
      expect(middleware.createGraftLimiters).toBe(limiters.createGraftLimiters);
    });
  });

  it('router module load fails when the graft limiter factory export is absent', () => {
    expect(() =>
      loadMessagesRouter({
        middlewareFactory: () => ({
          requireJwtAuth: (req, res, next) => next(),
          validateMessageReq: (req, res, next) => next(),
        }),
      }),
    ).toThrow('createGraftLimiters');
  });

  it('router module load fails when a graft service export is absent', () => {
    expect(() =>
      loadMessagesRouter({
        messageGraftsModuleFactory: ({
          previewGenerationGraft,
          createGenerationGraft,
          undoGenerationGraft,
        }) => ({
          previewGenerationGraft,
          createGenerationGraft,
          getGenerationGraft: undefined,
          undoGenerationGraft,
        }),
      }),
    ).toThrow('getGenerationGraft');
  });

  it('returns preview payloads on success', async () => {
    const { app, previewGenerationGraft } = setupApp();

    previewGenerationGraft.mockResolvedValueOnce({
      graftId: 'preview-42',
      treeRevision: 'tree-42',
      warning: 'partial',
    });

    const response = await request(app).post('/api/messages/convo-1/grafts/preview').send({
      sourceMessageId: 'assistant-1',
      destinationMessageId: 'assistant-2',
      mode: 'generation',
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      graftId: 'preview-42',
      treeRevision: 'tree-42',
      warning: 'partial',
    });
    expect(previewGenerationGraft).toHaveBeenCalledWith({
      userId: 'user-1',
      conversationId: 'convo-1',
      payload: {
        sourceMessageId: 'assistant-1',
        destinationMessageId: 'assistant-2',
        mode: 'generation',
      },
    });
  });

  it('returns 409 and the stabilization payload from preview', async () => {
    const { app, previewGenerationGraft } = setupApp();

    previewGenerationGraft.mockRejectedValueOnce(
      createTestError('Generation is still active.', {
        statusCode: 409,
        code: 'GRAFT_REQUIRES_STABILIZATION',
        activeMessageIds: ['assistant-live'],
      }),
    );

    const response = await request(app).post('/api/messages/convo-1/grafts/preview').send({
      sourceMessageId: 'assistant-live',
      destinationMessageId: 'assistant-complete',
      mode: 'generation',
    });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: 'Generation is still active.',
      code: 'GRAFT_REQUIRES_STABILIZATION',
      activeMessageIds: ['assistant-live'],
      conversationActiveWithoutMessageId: false,
    });
  });

  it('creates grafts with trusted user and path identifiers', async () => {
    const { app, createGenerationGraft } = setupApp();

    createGenerationGraft.mockResolvedValueOnce({
      graftId: 'graft-99',
      bridgeMessageId: 'bridge-99',
    });

    const payload = {
      sourceMessageId: 'source-1',
      destinationMessageId: 'destination-1',
      mode: 'subtree',
      conversationId: 'attacker-conversation',
      userId: 'attacker-user',
    };

    const response = await request(app).post('/api/messages/convo-safe/grafts').send(payload);

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      graftId: 'graft-99',
      bridgeMessageId: 'bridge-99',
    });
    expect(createGenerationGraft).toHaveBeenCalledWith({
      userId: 'user-1',
      conversationId: 'convo-safe',
      payload,
    });
  });

  it('returns service-backed 400 errors for invalid graft requests', async () => {
    const { app, createGenerationGraft } = setupApp();

    createGenerationGraft.mockRejectedValueOnce(
      createTestError('Invalid generation graft request.', {
        statusCode: 400,
        code: 'GRAFT_INVALID_REQUEST',
      }),
    );

    const response = await request(app).post('/api/messages/convo-1/grafts').send({
      mode: 'invalid',
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'Invalid generation graft request.',
      code: 'GRAFT_INVALID_REQUEST',
      conversationActiveWithoutMessageId: false,
    });
  });

  it('returns 413 when the service rejects an oversized graft payload', async () => {
    const { app, previewGenerationGraft } = setupApp();

    previewGenerationGraft.mockRejectedValueOnce(
      createTestError('Generation graft payload is too large.', {
        statusCode: 413,
        code: 'GRAFT_TOO_LARGE',
      }),
    );

    const response = await request(app).post('/api/messages/convo-1/grafts/preview').send({
      sourceMessageId: 'source-1',
      destinationMessageId: 'destination-1',
      mode: 'subtree',
    });

    expect(response.status).toBe(413);
    expect(response.body).toEqual({
      error: 'Generation graft payload is too large.',
      code: 'GRAFT_TOO_LARGE',
      conversationActiveWithoutMessageId: false,
    });
  });

  it('hides raw internal errors behind a generic 500 message', async () => {
    const { app, createGenerationGraft } = setupApp();

    createGenerationGraft.mockRejectedValueOnce(new Error('database exploded with internals'));

    const response = await request(app).post('/api/messages/convo-1/grafts').send({
      sourceMessageId: 'source-1',
      destinationMessageId: 'destination-1',
      mode: 'generation',
    });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Internal server error' });
  });

  it('returns graft details from the inspect route', async () => {
    const { app, getGenerationGraft } = setupApp();

    getGenerationGraft.mockResolvedValueOnce({
      graftId: 'graft-abc',
      continuationMessageIds: ['continuation-1'],
    });

    const response = await request(app).get('/api/messages/convo-1/grafts/graft-abc');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      graftId: 'graft-abc',
      continuationMessageIds: ['continuation-1'],
    });
    expect(getGenerationGraft).toHaveBeenCalledWith({
      userId: 'user-1',
      conversationId: 'convo-1',
      graftId: 'graft-abc',
    });
  });

  it('returns service-backed 404 errors for missing grafts', async () => {
    const { app, getGenerationGraft, routeLogger } = setupApp();

    getGenerationGraft.mockRejectedValueOnce(
      createTestError('Generation graft not found.', {
        statusCode: 404,
        code: 'GRAFT_NOT_FOUND',
      }),
    );

    const response = await request(app).get('/api/messages/convo-1/grafts/graft-missing');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: 'Generation graft not found.',
      code: 'GRAFT_NOT_FOUND',
      conversationActiveWithoutMessageId: false,
    });
    expect(routeLogger.error).not.toHaveBeenCalled();
  });

  it('undoes grafts using only trusted identifiers and top-level includeContinuations', async () => {
    const { app, undoGenerationGraft } = setupApp();

    undoGenerationGraft.mockResolvedValueOnce({
      graftId: 'graft-safe',
      deletedMessageIds: ['bridge-safe', 'copy-safe', 'continuation-safe'],
      deletedCount: 3,
    });

    const response = await request(app).delete('/api/messages/convo-safe/grafts/graft-safe').send({
      includeContinuations: true,
      graftId: 'attacker-graft',
      conversationId: 'attacker-conversation',
      userId: 'attacker-user',
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      graftId: 'graft-safe',
      deletedMessageIds: ['bridge-safe', 'copy-safe', 'continuation-safe'],
      deletedCount: 3,
    });
    expect(undoGenerationGraft).toHaveBeenCalledWith({
      userId: 'user-1',
      conversationId: 'convo-safe',
      graftId: 'graft-safe',
      includeContinuations: true,
    });
  });

  it('returns 409 when undo is blocked by graft continuations', async () => {
    const { app, undoGenerationGraft, routeLogger } = setupApp();

    undoGenerationGraft.mockRejectedValueOnce(
      createTestError('Undo requires deleting continuations first.', {
        statusCode: 409,
        code: 'GRAFT_HAS_CONTINUATIONS',
        continuationMessageIds: ['continuation-1'],
        internalDetails: { deleteEverything: true },
      }),
    );

    const response = await request(app)
      .delete('/api/messages/convo-1/grafts/graft-1')
      .send({ includeContinuations: false });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: 'Undo requires deleting continuations first.',
      code: 'GRAFT_HAS_CONTINUATIONS',
      continuationMessageIds: ['continuation-1'],
      conversationActiveWithoutMessageId: false,
    });
    expect(routeLogger.error).not.toHaveBeenCalled();
  });

  it('sanitizes continuation ids in 409 undo responses', async () => {
    const { app, undoGenerationGraft } = setupApp();
    const excessIds = Array.from(
      { length: MAX_GRAFT_MESSAGES + 5 },
      (_, index) => `extra-${index}`,
    );

    undoGenerationGraft.mockRejectedValueOnce(
      createTestError('Undo requires deleting continuations first.', {
        statusCode: 409,
        code: 'GRAFT_HAS_CONTINUATIONS',
        continuationMessageIds: [
          'continuation-1',
          '  continuation-2  ',
          '',
          '   ',
          null,
          42,
          'continuation-1',
          ...excessIds,
        ],
        leakedPayload: { unsafe: true },
      }),
    );

    const response = await request(app)
      .delete('/api/messages/convo-1/grafts/graft-1')
      .send({ includeContinuations: false });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('Undo requires deleting continuations first.');
    expect(response.body.code).toBe('GRAFT_HAS_CONTINUATIONS');
    expect(response.body.conversationActiveWithoutMessageId).toBe(false);
    expect(response.body.continuationMessageIds).toEqual([
      'continuation-1',
      'continuation-2',
      ...excessIds.slice(0, MAX_GRAFT_MESSAGES - 2),
    ]);
    expect(response.body).not.toHaveProperty('leakedPayload');
  });

  it('rate limits preview requests per user and keeps user counters separate', async () => {
    const { app, logViolation } = setupApp({
      env: {
        GRAFT_PREVIEW_USER_MAX: '1',
        GRAFT_PREVIEW_IP_MAX: '50',
      },
    });

    const first = await request(app)
      .post('/api/messages/convo-1/grafts/preview')
      .set('x-test-user', 'user-a')
      .send({ mode: 'generation' });
    const limited = await request(app)
      .post('/api/messages/convo-1/grafts/preview')
      .set('x-test-user', 'user-a')
      .send({ mode: 'generation' });
    const differentUser = await request(app)
      .post('/api/messages/convo-1/grafts/preview')
      .set('x-test-user', 'user-b')
      .send({ mode: 'generation' });

    expect(first.status).toBe(200);
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({
      message: 'Too many graft requests. Try again later.',
    });
    expect(differentUser.status).toBe(200);
    expect(logViolation).toHaveBeenCalled();
  });

  it('returns 429 even if graft rate-limit violation logging fails', async () => {
    const { app, logViolation, routeLogger } = setupApp({
      env: {
        GRAFT_PREVIEW_USER_MAX: '1',
        GRAFT_PREVIEW_IP_MAX: '50',
      },
      logViolationImplementation: () => Promise.reject(new Error('redis unavailable')),
    });

    const first = await request(app)
      .post('/api/messages/convo-1/grafts/preview')
      .set('x-test-user', 'user-a')
      .send({ mode: 'generation' });
    const limited = await request(app)
      .post('/api/messages/convo-1/grafts/preview')
      .set('x-test-user', 'user-a')
      .send({ mode: 'generation' });

    expect(first.status).toBe(200);
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({
      message: 'Too many graft requests. Try again later.',
    });
    expect(logViolation).toHaveBeenCalled();
    expect(routeLogger.error).toHaveBeenCalled();
  });

  it('rate limits mutation requests per IP and keeps IP counters separate', async () => {
    const { app } = setupApp({
      env: {
        GRAFT_MUTATION_IP_MAX: '1',
        GRAFT_MUTATION_USER_MAX: '50',
      },
    });

    const first = await request(app)
      .post('/api/messages/convo-1/grafts')
      .set('x-test-ip', '203.0.113.1')
      .send({ mode: 'generation' });
    const limited = await request(app)
      .post('/api/messages/convo-1/grafts')
      .set('x-test-ip', '203.0.113.1')
      .send({ mode: 'generation' });
    const differentIp = await request(app)
      .post('/api/messages/convo-1/grafts')
      .set('x-test-ip', '203.0.113.2')
      .send({ mode: 'generation' });

    expect(first.status).toBe(201);
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({
      message: 'Too many graft requests. Try again later.',
    });
    expect(differentIp.status).toBe(201);
  });

  it('routes graft inspection before generic message reads', async () => {
    const { app, getGenerationGraft, getMessages } = setupApp();

    getGenerationGraft.mockResolvedValueOnce({
      graftId: 'graft-route-order',
    });

    const response = await request(app).get('/api/messages/convo-1/grafts/graft-route-order');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      graftId: 'graft-route-order',
    });
    expect(getGenerationGraft).toHaveBeenCalledWith({
      userId: 'user-1',
      conversationId: 'convo-1',
      graftId: 'graft-route-order',
    });
    expect(getMessages).not.toHaveBeenCalled();
  });
});
