const { Constants } = require('librechat-data-provider');

const { PARTIAL_GRAFT_WARNING } = require('./constants');
const { buildClonePlan } = require('./clone');
const { computeTreeRevision } = require('./revision');
const {
  createMessageGraftService,
  previewGenerationGraft,
  createGenerationGraft,
  getGenerationGraft,
  undoGenerationGraft,
} = require('./index');

const FIXED_NOW = new Date('2026-07-06T16:00:00.000Z');

const createMessage = (overrides = {}) => ({
  messageId: 'message-1',
  conversationId: 'conversation-1',
  parentMessageId: Constants.NO_PARENT,
  isCreatedByUser: false,
  sender: 'Assistant',
  text: 'assistant text',
  content: [],
  files: [],
  attachments: [],
  metadata: {},
  unfinished: false,
  error: false,
  finish_reason: null,
  tokenCount: 0,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  user: 'user-1',
  ...overrides,
});

const createToolCall = (overrides = {}) => ({
  _id: 'tool-doc-1',
  conversationId: 'conversation-1',
  messageId: 'message-1',
  toolId: 'tool-1',
  user: 'user-1',
  result: {},
  attachments: [],
  blockIndex: 0,
  partIndex: 0,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

const createTransaction = (overrides = {}) => ({
  _id: 'txn-1',
  user: 'user-1',
  conversationId: 'conversation-1',
  messageId: 'message-1',
  rawAmount: -1,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

function deepClone(value) {
  return structuredClone(value);
}

function getByPath(record, path) {
  return path.split('.').reduce((current, key) => current?.[key], record);
}

function matchesFilter(record, filter = {}) {
  return Object.entries(filter).every(([key, expectedValue]) => {
    const actualValue = getByPath(record, key);

    if (
      expectedValue != null &&
      typeof expectedValue === 'object' &&
      !Array.isArray(expectedValue) &&
      Object.prototype.hasOwnProperty.call(expectedValue, '$in')
    ) {
      return expectedValue.$in.includes(actualValue);
    }

    return actualValue === expectedValue;
  });
}

function sortRecords(records, sortSpec = {}) {
  const sortEntries = Object.entries(sortSpec);
  if (sortEntries.length === 0) {
    return records.slice();
  }

  return records.slice().sort((left, right) => {
    for (const [key, direction] of sortEntries) {
      const leftValue = getByPath(left, key);
      const rightValue = getByPath(right, key);

      if (leftValue == null && rightValue == null) {
        continue;
      }
      if (leftValue == null) {
        return direction < 0 ? 1 : -1;
      }
      if (rightValue == null) {
        return direction < 0 ? -1 : 1;
      }

      if (leftValue instanceof Date && rightValue instanceof Date) {
        if (leftValue.getTime() !== rightValue.getTime()) {
          return leftValue.getTime() < rightValue.getTime() ? -direction : direction;
        }
        continue;
      }

      if (leftValue !== rightValue) {
        return leftValue < rightValue ? -direction : direction;
      }
    }

    return 0;
  });
}

function createQuery(executor) {
  let sortSpec = null;

  return {
    sort(spec) {
      sortSpec = spec;
      return this;
    },
    session() {
      return this;
    },
    lean() {
      return Promise.resolve(deepClone(executor(sortSpec)));
    },
  };
}

function createSingleQuery(executor) {
  return {
    session() {
      return this;
    },
    lean() {
      return Promise.resolve(deepClone(executor()));
    },
  };
}

function createPersistence({
  messages = [],
  toolCalls = [],
  transactions = [],
  topologyType = 'Single',
} = {}) {
  const state = {
    messages: deepClone(messages),
    toolCalls: deepClone(toolCalls),
    transactions: deepClone(transactions),
  };
  let messageDocCounter = 1;
  let toolCallDocCounter = 1;
  const session = {
    withTransaction: jest.fn(async (callback) => {
      const snapshot = deepClone(state);
      try {
        return await callback();
      } catch (error) {
        state.messages = snapshot.messages;
        state.toolCalls = snapshot.toolCalls;
        state.transactions = snapshot.transactions;
        throw error;
      }
    }),
    endSession: jest.fn(async () => {}),
  };

  const makeDuplicateKeyError = (record) => {
    const error = new Error(`E11000 duplicate key error collection on ${record.messageId}`);
    error.code = 11000;
    return error;
  };

  const deleteMatching = (collectionName, filter) => {
    const remaining = [];
    let deletedCount = 0;

    for (const record of state[collectionName]) {
      if (matchesFilter(record, filter)) {
        deletedCount += 1;
        continue;
      }

      remaining.push(record);
    }

    state[collectionName] = remaining;
    return { deletedCount };
  };

  const Message = {
    find: jest.fn((filter = {}) =>
      createQuery((sortSpec) =>
        sortRecords(state.messages.filter((row) => matchesFilter(row, filter)), sortSpec),
      ),
    ),
    findOne: jest.fn((filter = {}) =>
      createSingleQuery(() => state.messages.find((row) => matchesFilter(row, filter)) ?? null),
    ),
    countDocuments: jest.fn(async (filter = {}) =>
      state.messages.filter((row) => matchesFilter(row, filter)).length,
    ),
    insertMany: jest.fn(async (records) => {
      for (const record of records) {
        if (
          state.messages.some(
            (existing) => existing.messageId === record.messageId && existing.user === record.user,
          )
        ) {
          throw makeDuplicateKeyError(record);
        }
      }

      const insertedRecords = deepClone(records).map((record) => ({
        _id: `message-doc-${messageDocCounter++}`,
        ...record,
      }));
      state.messages.push(...insertedRecords);
      return deepClone(insertedRecords);
    }),
    deleteMany: jest.fn(async (filter) => deleteMatching('messages', filter)),
  };

  const ToolCall = {
    find: jest.fn((filter = {}) =>
      createQuery((sortSpec) =>
        sortRecords(state.toolCalls.filter((row) => matchesFilter(row, filter)), sortSpec),
      ),
    ),
    insertMany: jest.fn(async (records) => {
      const insertedRecords = deepClone(records).map((record) => ({
        _id: record._id ?? `tool-doc-${toolCallDocCounter++}`,
        ...record,
      }));
      state.toolCalls.push(...insertedRecords);
      return deepClone(insertedRecords);
    }),
    deleteMany: jest.fn(async (filter) => deleteMatching('toolCalls', filter)),
  };

  const Transaction = {
    deleteMany: jest.fn(async (filter) => deleteMatching('transactions', filter)),
  };

  const mongoose = {
    connection: {
      getClient: () => ({
        topology: {
          description: {
            type: topologyType,
          },
        },
      }),
    },
    startSession: jest.fn(async () => session),
  };

  return {
    state,
    Message,
    ToolCall,
    Transaction,
    mongoose,
    session,
  };
}

function createFixtureConversation(overrides = {}) {
  const promptA = createMessage({
    messageId: 'prompt-a',
    sender: 'User',
    text: 'prompt a',
    isCreatedByUser: true,
  });
  const sourceRoot = createMessage({
    messageId: 'source-root',
    parentMessageId: 'prompt-a',
    text: 'source root',
    tokenCount: 11,
  });
  const sourceChild = createMessage({
    messageId: 'source-child',
    parentMessageId: 'source-root',
    text: 'source child',
    tokenCount: 7,
  });
  const sourceGrandchild = createMessage({
    messageId: 'source-grandchild',
    parentMessageId: 'source-child',
    text: 'source grandchild',
    tokenCount: 5,
  });
  const promptB = createMessage({
    messageId: 'prompt-b',
    sender: 'User',
    text: 'prompt b',
    isCreatedByUser: true,
  });
  const destination = createMessage({
    messageId: 'destination',
    parentMessageId: 'prompt-b',
    text: 'destination',
  });
  const destinationChild = createMessage({
    messageId: 'destination-child',
    parentMessageId: 'destination',
    text: 'destination child',
  });
  const unrelated = createMessage({
    messageId: 'unrelated-live',
    parentMessageId: 'prompt-b',
    text: 'unrelated live branch',
  });

  return {
    messages: [
      promptA,
      sourceRoot,
      sourceChild,
      sourceGrandchild,
      promptB,
      destination,
      destinationChild,
      unrelated,
    ].map((message) => ({
      ...message,
      ...overrides[message.messageId],
    })),
    toolCalls: [
      createToolCall({
        _id: 'tool-source-root',
        messageId: 'source-root',
        attachments: [{ filepath: '/tmp/reference.txt' }],
        result: {
          outputs: [
            {
              type: 'json',
              payload: { image_path: '/tmp/chart.png' },
            },
          ],
        },
      }),
      createToolCall({
        _id: 'tool-source-child',
        messageId: 'source-child',
        attachments: [{ filename: 'child.jpg' }],
      }),
    ],
  };
}

function createServiceContext({
  messages,
  toolCalls = [],
  transactions = [],
  activeState = { active: false, provider: null, responseMessageId: null },
  topologyType,
  maxMessages,
  maxPayloadBytes,
  uuidValues = [],
  locks,
  sleep,
  graftRetryAttempts,
} = {}) {
  const persistence = createPersistence({
    messages,
    toolCalls,
    transactions,
    topologyType,
  });
  const logger = {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  };
  let generatedIdCounter = 1;
  const uuid = jest.fn(() => {
    if (uuidValues.length > 0) {
      return uuidValues.shift();
    }

    return `generated-id-${generatedIdCounter++}`;
  });
  const getActiveGenerationState = jest.fn().mockResolvedValue(activeState);

  const service = createMessageGraftService({
    Message: persistence.Message,
    ToolCall: persistence.ToolCall,
    Transaction: persistence.Transaction,
    mongoose: persistence.mongoose,
    logger,
    getActiveGenerationState,
    computeTreeRevision,
    buildClonePlan,
    uuid,
    now: () => new Date(FIXED_NOW),
    ...(maxMessages != null ? { MAX_GRAFT_MESSAGES: maxMessages } : {}),
    ...(maxPayloadBytes != null ? { MAX_GRAFT_PAYLOAD_BYTES: maxPayloadBytes } : {}),
    ...(locks ? { locks } : {}),
    ...(sleep ? { sleep } : {}),
    ...(graftRetryAttempts != null ? { GRAFT_RELOAD_RETRY_ATTEMPTS: graftRetryAttempts } : {}),
  });

  return {
    ...persistence,
    service,
    logger,
    uuid,
    getActiveGenerationState,
  };
}

function createServiceFromPersistence(
  persistence,
  {
    activeState = { active: false, provider: null, responseMessageId: null },
    maxMessages,
    maxPayloadBytes,
    uuid,
    locks = new Map(),
    sleep,
    graftRetryAttempts,
  } = {},
) {
  const logger = {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  };
  const getActiveGenerationState = jest.fn().mockResolvedValue(activeState);

  return {
    service: createMessageGraftService({
      Message: persistence.Message,
      ToolCall: persistence.ToolCall,
      Transaction: persistence.Transaction,
      mongoose: persistence.mongoose,
      logger,
      getActiveGenerationState,
      computeTreeRevision,
      buildClonePlan,
      ...(uuid ? { uuid } : {}),
      now: () => new Date(FIXED_NOW),
      ...(maxMessages != null ? { MAX_GRAFT_MESSAGES: maxMessages } : {}),
      ...(maxPayloadBytes != null ? { MAX_GRAFT_PAYLOAD_BYTES: maxPayloadBytes } : {}),
      locks,
      ...(sleep ? { sleep } : {}),
      ...(graftRetryAttempts != null ? { GRAFT_RELOAD_RETRY_ATTEMPTS: graftRetryAttempts } : {}),
    }),
    logger,
    getActiveGenerationState,
  };
}

function buildPreviewRequest(overrides = {}) {
  const { userId = 'user-1', conversationId = 'conversation-1', payload = {}, ...rest } = overrides;
  return {
    userId,
    conversationId,
    payload: {
      sourceMessageId: 'source-root',
      destinationMessageId: 'destination',
      mode: 'generation',
      ...payload,
    },
    ...rest,
  };
}

function buildCreateRequest(overrides = {}) {
  const { userId = 'user-1', conversationId = 'conversation-1', payload = {}, ...rest } = overrides;
  return {
    userId,
    conversationId,
    payload: {
      sourceMessageId: 'source-root',
      destinationMessageId: 'destination',
      mode: 'generation',
      idempotencyKey: 'idem-1',
      expectedTreeRevision: 'tree-revision',
      ...payload,
    },
    ...rest,
  };
}

async function expectGraftError(promise, code, statusCode) {
  await expect(promise).rejects.toMatchObject({
    name: 'GenerationGraftError',
    code,
    ...(statusCode != null ? { statusCode } : {}),
  });
}

describe('MessageGrafts service', () => {
  describe('exports', () => {
    it('exposes the exact route-facing names', () => {
      expect(typeof previewGenerationGraft).toBe('function');
      expect(typeof createGenerationGraft).toBe('function');
      expect(typeof getGenerationGraft).toBe('function');
      expect(typeof undoGenerationGraft).toBe('function');
    });
  });

  describe('preview', () => {
    it.each([
      ['complete', 'complete', [], {}, 'complete', 'complete'],
      [
        'stopped_partial',
        'complete',
        [PARTIAL_GRAFT_WARNING],
        { 'source-root': { unfinished: true } },
        'stopped_partial',
        'complete',
      ],
      [
        'complete',
        'stopped_partial',
        [PARTIAL_GRAFT_WARNING],
        { destination: { unfinished: true } },
        'complete',
        'stopped_partial',
      ],
      [
        'aborted_partial',
        'errored_partial',
        [PARTIAL_GRAFT_WARNING],
        {
          'source-root': { unfinished: true, finish_reason: 'aborted' },
          destination: { error: true },
        },
        'aborted_partial',
        'errored_partial',
      ],
    ])(
      'allows the stable %s -> %s pairing without stabilization and creates the graft with preserved metadata states',
      async (
        _sourceState,
        _destinationState,
        warnings,
        lifecycleOverrides,
        expectedSourceState,
        expectedDestinationState,
      ) => {
        const fixture = createFixtureConversation(lifecycleOverrides);
        const { service, state } = createServiceContext({
          messages: fixture.messages,
          toolCalls: fixture.toolCalls,
          activeState: {
            active: true,
            provider: 'assistants',
            responseMessageId: 'unrelated-live',
          },
          uuidValues: ['graft-pairing', 'bridge-pairing', 'copy-root-pairing'],
        });

        const preview = await service.preview(buildPreviewRequest());

        expect(preview).toMatchObject({
          conversationId: 'conversation-1',
          sourceMessageId: 'source-root',
          destinationMessageId: 'destination',
          mode: 'generation',
          sourceActiveLeafMessageId: undefined,
          activeSourceLeafMessageId: 'source-root',
          copiedMessageIds: ['source-root'],
          destinationChildCount: 1,
          warnings,
          requiresStabilization: false,
          activeMessageIds: [],
          conversationActiveWithoutMessageId: false,
          canCreate: true,
        });

        const created = await service.create(
          buildCreateRequest({
            payload: {
              expectedTreeRevision: preview.treeRevision,
            },
          }),
        );
        const bridgeRecord = state.messages.find((message) => message.messageId === created.bridgeMessageId);

        expect(created).toMatchObject({
          graftId: 'graft-pairing',
          bridgeMessageId: 'bridge-pairing',
          copiedRootMessageId: 'copy-root-pairing',
        });
        expect(bridgeRecord.metadata.generationGraft).toMatchObject({
          sourceState: expectedSourceState,
          destinationState: expectedDestinationState,
        });
      },
    );

    it('blocks actively mutating source, destination, subtree, and unknown-active conversation selections', async () => {
      const fixture = createFixtureConversation();

      let context = createServiceContext({
        messages: fixture.messages,
        toolCalls: fixture.toolCalls,
        activeState: {
          active: true,
          provider: 'assistants',
          responseMessageId: 'source-root',
        },
      });
      await expectGraftError(context.service.preview(buildPreviewRequest()), 'GRAFT_REQUIRES_STABILIZATION', 409);

      context = createServiceContext({
        messages: fixture.messages,
        toolCalls: fixture.toolCalls,
        activeState: {
          active: true,
          provider: 'assistants',
          responseMessageId: 'destination',
        },
      });
      await expect(context.service.preview(buildPreviewRequest())).rejects.toMatchObject({
        code: 'GRAFT_REQUIRES_STABILIZATION',
        details: {
          activeMessageIds: ['destination'],
          conversationActiveWithoutMessageId: false,
        },
      });

      context = createServiceContext({
        messages: fixture.messages,
        toolCalls: fixture.toolCalls,
        activeState: {
          active: true,
          provider: 'assistants',
          responseMessageId: 'source-grandchild',
        },
      });
      await expect(
        context.service.preview(
          buildPreviewRequest({
            payload: {
              mode: 'subtree',
            },
          }),
        ),
      ).rejects.toMatchObject({
        code: 'GRAFT_REQUIRES_STABILIZATION',
        details: {
          activeMessageIds: ['source-grandchild'],
          conversationActiveWithoutMessageId: false,
        },
      });

      context = createServiceContext({
        messages: fixture.messages,
        toolCalls: fixture.toolCalls,
        activeState: {
          active: true,
          provider: 'assistants',
          responseMessageId: null,
        },
      });
      await expect(context.service.preview(buildPreviewRequest())).rejects.toMatchObject({
        code: 'GRAFT_REQUIRES_STABILIZATION',
        details: {
          activeMessageIds: [],
          conversationActiveWithoutMessageId: true,
        },
      });
    });

    it('distinguishes generation vs subtree selection and validates the source active leaf', async () => {
      const fixture = createFixtureConversation({
        'source-root': {
          files: [{ filepath: '/tmp/doc.txt' }, { image_path: '/tmp/diagram.png' }],
        },
        'source-child': {
          attachments: [{ url: 'https://example.com/child.jpg' }],
        },
      });
      const { service } = createServiceContext({
        messages: fixture.messages,
        toolCalls: fixture.toolCalls,
      });

      const generationPreview = await service.preview(buildPreviewRequest());
      expect(generationPreview).toMatchObject({
        copiedMessageIds: ['source-root'],
        activeSourceLeafMessageId: 'source-root',
        counts: {
          messages: 1,
          toolCalls: 1,
          files: 4,
          images: 2,
          approximateTokens: 11,
        },
      });

      const subtreePreview = await service.preview(
        buildPreviewRequest({
          payload: {
            mode: 'subtree',
            sourceActiveLeafMessageId: 'source-grandchild',
          },
        }),
      );
      expect(subtreePreview).toMatchObject({
        sourceActiveLeafMessageId: 'source-grandchild',
        activeSourceLeafMessageId: 'source-grandchild',
        copiedMessageIds: ['source-root', 'source-child', 'source-grandchild'],
        counts: {
          messages: 3,
          toolCalls: 2,
          files: 6,
          images: 4,
          approximateTokens: 23,
        },
      });

      await expectGraftError(
        service.preview(
          buildPreviewRequest({
            payload: {
              sourceActiveLeafMessageId: 'source-child',
            },
          }),
        ),
        'INVALID_SOURCE',
        400,
      );
    });

    it('scopes by ownership, rejects overlaps, uses token fallbacks, and enforces 413 message and payload limits', async () => {
      const fixture = createFixtureConversation();
      const { service, Message } = createServiceContext({
        messages: fixture.messages.map((message) =>
          message.messageId === 'source-root' ? { ...message, user: 'another-user' } : message,
        ),
        toolCalls: fixture.toolCalls,
        maxMessages: 2,
      });

      await expectGraftError(service.preview(buildPreviewRequest()), 'MESSAGE_NOT_FOUND', 404);
      expect(Message.find).toHaveBeenCalledWith({ user: 'user-1', conversationId: 'conversation-1' });

      const overlapContext = createServiceContext({
        messages: fixture.messages,
        toolCalls: fixture.toolCalls,
      });
      await expectGraftError(
        overlapContext.service.preview(
          buildPreviewRequest({
            payload: {
              destinationMessageId: 'source-child',
            },
          }),
        ),
        'OVERLAPPING_BRANCHES',
        400,
      );

      const fallbackTokenContext = createServiceContext({
        messages: fixture.messages.map((message) =>
          message.messageId === 'source-root'
            ? { ...message, tokenCount: undefined, text: '12345678' }
            : message.messageId === 'source-child'
              ? { ...message, tokenCount: Number.NaN, text: '123456789' }
              : message.messageId === 'source-grandchild'
                ? { ...message, tokenCount: -3, text: '12345' }
                : message,
        ),
        toolCalls: fixture.toolCalls,
      });
      const fallbackPreview = await fallbackTokenContext.service.preview(
        buildPreviewRequest({
          payload: {
            mode: 'subtree',
          },
        }),
      );
      expect(fallbackPreview.counts.approximateTokens).toBe(5);

      const maxMessageContext = createServiceContext({
        messages: fixture.messages,
        toolCalls: fixture.toolCalls,
        maxMessages: 2,
      });
      await expectGraftError(
        maxMessageContext.service.preview(
          buildPreviewRequest({
            payload: {
              mode: 'subtree',
            },
          }),
        ),
        'GRAFT_TOO_LARGE',
        413,
      );

      const payloadContext = createServiceContext({
        messages: fixture.messages.map((message) =>
          message.messageId === 'source-root' ? { ...message, text: 'x'.repeat(512) } : message,
        ),
        toolCalls: fixture.toolCalls,
        maxPayloadBytes: 32,
      });
      await expectGraftError(payloadContext.service.preview(buildPreviewRequest()), 'GRAFT_TOO_LARGE', 413);
    });

    it('does not allow hostile preview payload to override outer user or conversation scope', async () => {
      const fixture = createFixtureConversation();
      const { service, Message } = createServiceContext({
        messages: fixture.messages.map((message) => ({
          ...message,
          user: 'outer-user',
          conversationId: 'outer-conversation',
        })),
      });

      const preview = await service.preview({
        userId: 'outer-user',
        conversationId: 'outer-conversation',
        payload: {
          userId: 'attacker-user',
          conversationId: 'attacker-conversation',
          sourceMessageId: 'source-root',
          destinationMessageId: 'destination',
          mode: 'generation',
        },
      });
      expect(Message.find).toHaveBeenCalledWith({
        user: 'outer-user',
        conversationId: 'outer-conversation',
      });
      expect(preview.conversationId).toBe('outer-conversation');
    });

    it('uses a stable createdAt/messageId traversal order for equal-createdAt siblings', async () => {
      const sameTime = new Date('2026-01-01T00:00:00.000Z');
      const messages = [
        createMessage({
          messageId: 'prompt-a',
          sender: 'User',
          text: 'prompt a',
          isCreatedByUser: true,
          createdAt: sameTime,
        }),
        createMessage({
          messageId: 'source-root',
          parentMessageId: 'prompt-a',
          createdAt: sameTime,
        }),
        createMessage({
          messageId: 'source-b',
          parentMessageId: 'source-root',
          createdAt: sameTime,
        }),
        createMessage({
          messageId: 'source-a',
          parentMessageId: 'source-root',
          createdAt: sameTime,
        }),
        createMessage({
          messageId: 'prompt-b',
          sender: 'User',
          text: 'prompt b',
          isCreatedByUser: true,
          createdAt: sameTime,
        }),
        createMessage({
          messageId: 'destination',
          parentMessageId: 'prompt-b',
          createdAt: sameTime,
        }),
      ];
      const { service } = createServiceContext({
        messages,
        uuidValues: ['graft-sort', 'bridge-sort', 'copy-root-sort', 'copy-a-sort', 'copy-b-sort'],
      });

      const preview = await service.preview(
        buildPreviewRequest({
          payload: {
            mode: 'subtree',
          },
        }),
      );
      expect(preview.copiedMessageIds).toEqual(['source-root', 'source-a', 'source-b']);

      const created = await service.create(
        buildCreateRequest({
          payload: {
            mode: 'subtree',
            idempotencyKey: 'idem-sort',
            expectedTreeRevision: preview.treeRevision,
          },
        }),
      );
      expect(created.createdMessages.map((message) => message.messageId)).toEqual([
        'bridge-sort',
        'copy-root-sort',
        'copy-a-sort',
        'copy-b-sort',
      ]);
    });
  });

  describe('create', () => {
    it('rejects stale revisions and returns deterministic idempotent retries without cleaning up existing grafts', async () => {
      const fixture = createFixtureConversation();
      const locks = new Map();
      const context = createServiceContext({
        messages: fixture.messages,
        toolCalls: fixture.toolCalls,
        uuidValues: ['graft-1', 'bridge-1', 'copy-root-1'],
        locks,
      });

      const preview = await context.service.preview(buildPreviewRequest());

      await expectGraftError(
        context.service.create(
          buildCreateRequest({
            payload: {
              expectedTreeRevision: 'stale-revision',
            },
          }),
        ),
        'TREE_CHANGED',
        409,
      );

      const created = await context.service.create(
        buildCreateRequest({
          payload: {
            expectedTreeRevision: preview.treeRevision,
          },
        }),
      );

      const deleteMessageCallsBeforeRetry = context.Message.deleteMany.mock.calls.length;
      const deleteToolCallsBeforeRetry = context.ToolCall.deleteMany.mock.calls.length;

      const retry = await context.service.create(
        buildCreateRequest({
          payload: {
            expectedTreeRevision: 'ignored-on-retry',
          },
        }),
      );

      expect(retry).toEqual(created);
      expect(retry).toMatchObject({
        graftId: 'graft-1',
        bridgeMessageId: 'bridge-1',
        copiedRootMessageId: 'copy-root-1',
        activeCopiedMessageId: 'copy-root-1',
        copiedMessageCount: 1,
      });
      expect(retry.createdMessages.map((message) => message.messageId)).toEqual([
        'bridge-1',
        'copy-root-1',
      ]);
      expect(
        context.state.messages.filter(
          (message) => message.metadata?.generationGraft?.idempotencyKey === 'idem-1',
        ),
      ).toHaveLength(1);
      expect(context.Message.deleteMany.mock.calls).toHaveLength(deleteMessageCallsBeforeRetry);
      expect(context.ToolCall.deleteMany.mock.calls).toHaveLength(deleteToolCallsBeforeRetry);
    });

    it('holds a per-user conversation lock and releases it after failure', async () => {
      const fixture = createFixtureConversation();
      const locks = new Map([['user-1:conversation-1', true]]);
      const context = createServiceContext({
        messages: fixture.messages,
        toolCalls: fixture.toolCalls,
        locks,
      });

      await expectGraftError(context.service.create(buildCreateRequest()), 'GRAFT_BUSY', 409);

      locks.delete('user-1:conversation-1');

      const preview = await context.service.preview(buildPreviewRequest());
      context.Message.insertMany.mockRejectedValueOnce(new Error('message insert failed'));
      await expect(
        context.service.create(
          buildCreateRequest({
            payload: {
              idempotencyKey: 'idem-2',
              expectedTreeRevision: preview.treeRevision,
            },
          }),
        ),
      ).rejects.toThrow('message insert failed');
      expect(locks.has('user-1:conversation-1')).toBe(false);
    });

    it('cleans up inserted records on message insert failure, count mismatch, post-insert failures, tool call failure, and logs cleanup failures without masking the original error', async () => {
      const fixture = createFixtureConversation();

      const insertFailureContext = createServiceContext({
        messages: fixture.messages,
        toolCalls: fixture.toolCalls,
        uuidValues: ['graft-1', 'bridge-1', 'copy-root-1'],
      });
      const insertFailurePreview = await insertFailureContext.service.preview(buildPreviewRequest());
      insertFailureContext.Message.insertMany.mockImplementationOnce(async (records) => {
        const inserted = deepClone(records).map((record, index) => ({
          _id: `partial-${index + 1}`,
          ...record,
        }));
        insertFailureContext.state.messages.push(...inserted);
        throw new Error('partial message insert failure');
      });
      await expect(
        insertFailureContext.service.create(
          buildCreateRequest({
            payload: {
              expectedTreeRevision: insertFailurePreview.treeRevision,
            },
          }),
        ),
      ).rejects.toThrow('partial message insert failure');
      expect(
        insertFailureContext.state.messages.some((message) => message.messageId === 'bridge-1'),
      ).toBe(false);

      const countMismatchContext = createServiceContext({
        messages: fixture.messages,
        toolCalls: fixture.toolCalls,
        uuidValues: ['graft-count', 'bridge-count', 'copy-root-count'],
      });
      const countMismatchPreview = await countMismatchContext.service.preview(buildPreviewRequest());
      countMismatchContext.Message.countDocuments.mockResolvedValueOnce(1);
      await expect(
        countMismatchContext.service.create(
          buildCreateRequest({
            payload: {
              idempotencyKey: 'idem-count',
              expectedTreeRevision: countMismatchPreview.treeRevision,
            },
          }),
        ),
      ).rejects.toThrow('Inserted graft message count did not match the stored graft records.');
      expect(
        countMismatchContext.state.messages.some((message) => message.messageId === 'bridge-count'),
      ).toBe(false);

      const toolFailureContext = createServiceContext({
        messages: fixture.messages,
        toolCalls: fixture.toolCalls,
        uuidValues: ['graft-2', 'bridge-2', 'copy-root-2'],
      });
      const toolFailurePreview = await toolFailureContext.service.preview(buildPreviewRequest());
      toolFailureContext.ToolCall.insertMany.mockRejectedValueOnce(new Error('tool call insert failed'));
      await expect(
        toolFailureContext.service.create(
          buildCreateRequest({
            payload: {
              idempotencyKey: 'idem-2',
              expectedTreeRevision: toolFailurePreview.treeRevision,
            },
          }),
        ),
      ).rejects.toThrow('tool call insert failed');
      expect(
        toolFailureContext.state.messages.some((message) => message.messageId === 'bridge-2'),
      ).toBe(false);

      const bridgeReloadFailureContext = createServiceContext({
        messages: fixture.messages,
        toolCalls: fixture.toolCalls,
        uuidValues: ['graft-reload', 'bridge-reload', 'copy-root-reload'],
      });
      const bridgeReloadPreview = await bridgeReloadFailureContext.service.preview(buildPreviewRequest());
      bridgeReloadFailureContext.Message.findOne.mockImplementation((filter = {}) =>
        createSingleQuery(() => {
          if (filter['metadata.generationGraft.graftId'] === 'graft-reload') {
            return null;
          }

          return bridgeReloadFailureContext.state.messages.find((row) => matchesFilter(row, filter)) ?? null;
        }),
      );
      await expect(
        bridgeReloadFailureContext.service.create(
          buildCreateRequest({
            payload: {
              idempotencyKey: 'idem-reload',
              expectedTreeRevision: bridgeReloadPreview.treeRevision,
            },
          }),
        ),
      ).rejects.toMatchObject({
        code: 'INVALID_SOURCE',
      });
      expect(
        bridgeReloadFailureContext.state.messages.some(
          (message) => message.messageId === 'bridge-reload',
        ),
      ).toBe(false);

      const reconstructionFailureContext = createServiceContext({
        messages: fixture.messages,
        toolCalls: fixture.toolCalls,
        uuidValues: ['graft-reconstruct', 'bridge-reconstruct', 'copy-root-reconstruct'],
      });
      const reconstructionFailurePreview = await reconstructionFailureContext.service.preview(
        buildPreviewRequest(),
      );
      reconstructionFailureContext.Message.find.mockImplementation((filter = {}) =>
        createQuery((sortSpec) => {
          const filtered = reconstructionFailureContext.state.messages.filter((row) =>
            matchesFilter(row, filter),
          );
          const scrubbed = filtered.filter((record) => record.messageId !== 'copy-root-reconstruct');
          return sortRecords(scrubbed, sortSpec);
        }),
      );
      await expect(
        reconstructionFailureContext.service.create(
          buildCreateRequest({
            payload: {
              idempotencyKey: 'idem-reconstruct',
              expectedTreeRevision: reconstructionFailurePreview.treeRevision,
            },
          }),
        ),
      ).rejects.toMatchObject({
        code: 'INVALID_SOURCE',
      });
      expect(
        reconstructionFailureContext.state.messages.some(
          (message) => message.messageId === 'bridge-reconstruct',
        ),
      ).toBe(false);

      const cleanupFailureContext = createServiceContext({
        messages: fixture.messages,
        toolCalls: fixture.toolCalls,
        uuidValues: ['graft-3', 'bridge-3', 'copy-root-3'],
      });
      const cleanupFailurePreview = await cleanupFailureContext.service.preview(buildPreviewRequest());
      cleanupFailureContext.ToolCall.insertMany.mockRejectedValueOnce(new Error('tool call insert failed'));
      cleanupFailureContext.Message.deleteMany.mockRejectedValueOnce(new Error('cleanup delete failed'));
      await expect(
        cleanupFailureContext.service.create(
          buildCreateRequest({
            payload: {
              idempotencyKey: 'idem-3',
              expectedTreeRevision: cleanupFailurePreview.treeRevision,
            },
          }),
        ),
      ).rejects.toThrow('tool call insert failed');
      expect(cleanupFailureContext.logger.error).toHaveBeenCalled();
    });

    it('does not allow hostile create payload to override outer user or conversation scope', async () => {
      const fixture = createFixtureConversation();
      const context = createServiceContext({
        messages: fixture.messages.map((message) => ({
          ...message,
          user: 'outer-user',
          conversationId: 'outer-conversation',
        })),
        toolCalls: fixture.toolCalls.map((toolCall) => ({
          ...toolCall,
          user: 'outer-user',
          conversationId: 'outer-conversation',
        })),
        uuidValues: ['graft-hostile', 'bridge-hostile', 'copy-root-hostile'],
      });
      const preview = await context.service.preview({
        userId: 'outer-user',
        conversationId: 'outer-conversation',
        payload: {
          sourceMessageId: 'source-root',
          destinationMessageId: 'destination',
          mode: 'generation',
        },
      });

      await context.service.create({
        userId: 'outer-user',
        conversationId: 'outer-conversation',
        payload: {
          userId: 'attacker-user',
          conversationId: 'attacker-conversation',
          sourceMessageId: 'source-root',
          destinationMessageId: 'destination',
          mode: 'generation',
          idempotencyKey: 'idem-hostile',
          expectedTreeRevision: preview.treeRevision,
        },
      });

      expect(context.Message.findOne).toHaveBeenCalledWith({
        user: 'outer-user',
        conversationId: 'outer-conversation',
        'metadata.generationGraft.kind': 'generation_graft',
        'metadata.generationGraft.idempotencyKey': 'idem-hostile',
      });
      expect(context.Message.countDocuments).toHaveBeenCalledWith({
        user: 'outer-user',
        conversationId: 'outer-conversation',
        messageId: { $in: ['bridge-hostile', 'copy-root-hostile'] },
      });
      expect(
        context.state.messages.some(
          (message) =>
            message.messageId === 'bridge-hostile' &&
            message.user === 'outer-user' &&
            message.conversationId === 'outer-conversation',
        ),
      ).toBe(true);
    });

    it('returns one deterministic graft across concurrent service instances with the same idempotency key', async () => {
      const fixture = createFixtureConversation();
      const persistence = createPersistence({
        messages: fixture.messages,
        toolCalls: fixture.toolCalls,
      });
      const serviceA = createServiceFromPersistence(persistence, { locks: new Map() }).service;
      const serviceB = createServiceFromPersistence(persistence, { locks: new Map() }).service;

      let barrierCount = 0;
      let releaseBarrier;
      const barrier = new Promise((resolve) => {
        releaseBarrier = resolve;
      });
      persistence.Message.findOne.mockImplementation((filter = {}) => ({
        session() {
          return this;
        },
        lean: async () => {
          if (
            filter['metadata.generationGraft.idempotencyKey'] === 'idem-race' &&
            barrierCount < 2
          ) {
            barrierCount += 1;
            if (barrierCount === 2) {
              releaseBarrier();
            }
            await barrier;
            return null;
          }

          return deepClone(persistence.state.messages.find((row) => matchesFilter(row, filter)) ?? null);
        },
      }));

      const preview = await serviceA.preview(buildPreviewRequest());
      const request = buildCreateRequest({
        payload: {
          idempotencyKey: 'idem-race',
          expectedTreeRevision: preview.treeRevision,
        },
      });
      const [resultA, resultB] = await Promise.all([serviceA.create(request), serviceB.create(request)]);

      expect(resultA).toEqual(resultB);
      expect(
        persistence.state.messages.filter(
          (message) => message.metadata?.generationGraft?.idempotencyKey === 'idem-race',
        ),
      ).toHaveLength(1);
    });

    it('retries duplicate-key recovery when the winner bridge is visible before copied messages are', async () => {
      const fixture = createFixtureConversation();
      const persistence = createPersistence({
        messages: fixture.messages,
        toolCalls: fixture.toolCalls,
      });
      const sleep = jest.fn(async () => {});
      const serviceA = createServiceFromPersistence(persistence, {
        locks: new Map(),
        sleep,
        graftRetryAttempts: 3,
      }).service;
      const serviceB = createServiceFromPersistence(persistence, {
        locks: new Map(),
        sleep,
        graftRetryAttempts: 3,
      }).service;

      const originalInsertMany = persistence.Message.insertMany.getMockImplementation();
      let firstBridgeInserted = false;
      let copiesReleased = false;
      let releaseCopies;
      const copyBarrier = new Promise((resolve) => {
        releaseCopies = resolve;
      });

      persistence.Message.insertMany.mockImplementation(async (records, options) => {
        if (records.length === 1 && records[0].metadata?.generationGraft?.kind === 'generation_graft') {
          const inserted = await originalInsertMany(records, options);
          firstBridgeInserted = true;
          return inserted;
        }

        if (records.some((record) => record.metadata?.generationGraftCopy?.kind === 'generation_graft_copy')) {
          if (!copiesReleased) {
            await copyBarrier;
          }
          return originalInsertMany(records, options);
        }

        return originalInsertMany(records, options);
      });

      let releaseOnce = false;
      sleep.mockImplementation(async () => {
        if (firstBridgeInserted && !releaseOnce) {
          releaseOnce = true;
          copiesReleased = true;
          releaseCopies();
        }
      });

      const preview = await serviceA.preview(buildPreviewRequest());
      const request = buildCreateRequest({
        payload: {
          idempotencyKey: 'idem-bridge-race',
          expectedTreeRevision: preview.treeRevision,
        },
      });
      const [winnerResult, loserResult] = await Promise.all([serviceA.create(request), serviceB.create(request)]);

      expect(loserResult).toEqual(winnerResult);
      expect(sleep).toHaveBeenCalled();
      expect(
        persistence.state.messages.filter(
          (message) => message.metadata?.generationGraft?.idempotencyKey === 'idem-bridge-race',
        ),
      ).toHaveLength(1);
      expect(
        persistence.state.messages.filter(
          (message) => message.metadata?.generationGraftCopy?.graftId === winnerResult.graftId,
        ),
      ).toHaveLength(1);
    });

    it('rejects reusing the same idempotency key for a different graft request', async () => {
      const fixture = createFixtureConversation();
      const context = createServiceContext({
        messages: fixture.messages,
        toolCalls: fixture.toolCalls,
      });
      const preview = await context.service.preview(buildPreviewRequest());
      await context.service.create(
        buildCreateRequest({
          payload: {
            idempotencyKey: 'idem-reuse',
            expectedTreeRevision: preview.treeRevision,
          },
        }),
      );

      await expectGraftError(
        context.service.create(
          buildCreateRequest({
            payload: {
              mode: 'subtree',
              idempotencyKey: 'idem-reuse',
              expectedTreeRevision: preview.treeRevision,
            },
          }),
        ),
        'INVALID_SOURCE',
        400,
      );
    });

    it('rolls back transactional create failures without fallback cleanup', async () => {
      const fixture = createFixtureConversation();
      const context = createServiceContext({
        messages: fixture.messages,
        toolCalls: fixture.toolCalls,
        topologyType: 'ReplicaSetWithPrimary',
      });
      const preview = await context.service.preview(buildPreviewRequest());
      context.ToolCall.insertMany.mockRejectedValueOnce(new Error('transactional tool call failure'));

      await expect(
        context.service.create(
          buildCreateRequest({
            payload: {
              idempotencyKey: 'idem-tx-fail',
              expectedTreeRevision: preview.treeRevision,
            },
          }),
        ),
      ).rejects.toThrow('transactional tool call failure');

      expect(context.session.withTransaction).toHaveBeenCalledTimes(1);
      expect(
        context.state.messages.some(
          (message) => message.metadata?.generationGraft?.idempotencyKey === 'idem-tx-fail',
        ),
      ).toBe(false);
      expect(context.Message.deleteMany).not.toHaveBeenCalled();
      expect(context.ToolCall.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('inspect and undo', () => {
    it('inspects graft ownership and undoes a graft without continuations', async () => {
      const fixture = createFixtureConversation();
      const context = createServiceContext({
        messages: fixture.messages,
        toolCalls: fixture.toolCalls,
        transactions: [],
        uuidValues: ['graft-1', 'bridge-1', 'copy-root-1', 'copy-child-1', 'copy-grandchild-1'],
      });
      const preview = await context.service.preview(
        buildPreviewRequest({
          payload: {
            mode: 'subtree',
            sourceActiveLeafMessageId: 'source-grandchild',
          },
        }),
      );
      const created = await context.service.create(
        buildCreateRequest({
          payload: {
            mode: 'subtree',
            sourceActiveLeafMessageId: 'source-grandchild',
            expectedTreeRevision: preview.treeRevision,
          },
        }),
      );

      context.state.transactions.push(
        createTransaction({
          _id: 'txn-bridge',
          messageId: created.bridgeMessageId,
        }),
        createTransaction({
          _id: 'txn-copy-root',
          messageId: created.copiedRootMessageId,
        }),
      );

      const details = await context.service.inspect({
        userId: 'user-1',
        conversationId: 'conversation-1',
        graftId: 'graft-1',
      });

      expect(details).toMatchObject({
        graftId: 'graft-1',
        bridgeMessageId: 'bridge-1',
        copiedMessageIds: ['copy-root-1', 'copy-child-1', 'copy-grandchild-1'],
        continuationMessageIds: [],
        canUndoWithoutContinuations: true,
        mode: 'subtree',
        sourceState: 'complete',
        destinationState: 'complete',
        copiedRootMessageId: 'copy-root-1',
        activeCopiedMessageId: 'copy-grandchild-1',
        copiedCounts: {
          messages: 3,
          toolCalls: 2,
          approximateTokens: 23,
        },
      });

      const undoResult = await context.service.undo({
        userId: 'user-1',
        conversationId: 'conversation-1',
        graftId: 'graft-1',
      });

      expect(undoResult).toEqual({
        graftId: 'graft-1',
        deletedMessageIds: ['bridge-1', 'copy-root-1', 'copy-child-1', 'copy-grandchild-1'],
        deletedCount: 4,
      });
      expect(
        context.state.messages.some((message) => undoResult.deletedMessageIds.includes(message.messageId)),
      ).toBe(false);
      expect(
        context.state.transactions.some((transaction) =>
          undoResult.deletedMessageIds.includes(transaction.messageId),
        ),
      ).toBe(false);
    });

    it('blocks undo when continuations exist unless includeContinuations is true', async () => {
      const fixture = createFixtureConversation();
      const context = createServiceContext({
        messages: fixture.messages,
        toolCalls: fixture.toolCalls,
        uuidValues: ['graft-1', 'bridge-1', 'copy-root-1'],
      });
      const preview = await context.service.preview(buildPreviewRequest());
      const created = await context.service.create(
        buildCreateRequest({
          payload: {
            expectedTreeRevision: preview.treeRevision,
          },
        }),
      );

      context.state.messages.push(
        createMessage({
          messageId: 'continuation-1',
          parentMessageId: created.activeCopiedMessageId,
          text: 'continuation',
          user: 'user-1',
        }),
      );
      context.state.toolCalls.push(
        createToolCall({
          _id: 'tool-continuation',
          messageId: 'continuation-1',
        }),
      );
      context.state.transactions.push(
        createTransaction({
          _id: 'txn-continuation',
          messageId: 'continuation-1',
        }),
      );

      const details = await context.service.inspect({
        userId: 'user-1',
        conversationId: 'conversation-1',
        graftId: 'graft-1',
      });
      expect(details).toMatchObject({
        continuationMessageIds: ['continuation-1'],
        canUndoWithoutContinuations: false,
      });

      await expectGraftError(
        context.service.undo({
          userId: 'user-1',
          conversationId: 'conversation-1',
          graftId: 'graft-1',
        }),
        'GRAFT_HAS_CONTINUATIONS',
        409,
      );

      const undoResult = await context.service.undo({
        userId: 'user-1',
        conversationId: 'conversation-1',
        graftId: 'graft-1',
        includeContinuations: true,
      });
      expect(undoResult.deletedMessageIds).toEqual(['bridge-1', 'copy-root-1', 'continuation-1']);
      expect(context.state.messages.some((message) => message.messageId === 'continuation-1')).toBe(false);
    });

    it('uses Mongo transactions when supported and otherwise falls back to ordered scoped deletes', async () => {
      const fixture = createFixtureConversation();
      const transactionalContext = createServiceContext({
        messages: fixture.messages,
        toolCalls: fixture.toolCalls,
        transactions: [],
        uuidValues: ['graft-1', 'bridge-1', 'copy-root-1'],
        topologyType: 'ReplicaSetWithPrimary',
      });
      const transactionalPreview = await transactionalContext.service.preview(buildPreviewRequest());
      await transactionalContext.service.create(
        buildCreateRequest({
          payload: {
            expectedTreeRevision: transactionalPreview.treeRevision,
          },
        }),
      );
      transactionalContext.mongoose.startSession.mockClear();
      transactionalContext.session.withTransaction.mockClear();

      await transactionalContext.service.undo({
        userId: 'user-1',
        conversationId: 'conversation-1',
        graftId: 'graft-1',
      });

      expect(transactionalContext.mongoose.startSession).toHaveBeenCalledTimes(1);
      expect(transactionalContext.session.withTransaction).toHaveBeenCalledTimes(1);
      expect(transactionalContext.ToolCall.deleteMany).toHaveBeenCalledWith(
        {
          user: 'user-1',
          conversationId: 'conversation-1',
          messageId: { $in: ['bridge-1', 'copy-root-1'] },
        },
        { session: transactionalContext.session },
      );
      expect(transactionalContext.Transaction.deleteMany).toHaveBeenCalledWith(
        {
          user: 'user-1',
          conversationId: 'conversation-1',
          messageId: { $in: ['bridge-1', 'copy-root-1'] },
        },
        { session: transactionalContext.session },
      );
      expect(transactionalContext.Message.deleteMany).toHaveBeenCalledWith(
        {
          user: 'user-1',
          conversationId: 'conversation-1',
          messageId: { $in: ['bridge-1', 'copy-root-1'] },
        },
        { session: transactionalContext.session },
      );

      const fallbackContext = createServiceContext({
        messages: fixture.messages,
        toolCalls: fixture.toolCalls,
        transactions: [],
        uuidValues: ['graft-2', 'bridge-2', 'copy-root-2'],
        topologyType: 'Single',
      });
      const fallbackPreview = await fallbackContext.service.preview(buildPreviewRequest());
      await fallbackContext.service.create(
        buildCreateRequest({
          payload: {
            idempotencyKey: 'idem-2',
            expectedTreeRevision: fallbackPreview.treeRevision,
          },
        }),
      );

      await fallbackContext.service.undo({
        userId: 'user-1',
        conversationId: 'conversation-1',
        graftId: 'graft-2',
      });

      expect(fallbackContext.mongoose.startSession).not.toHaveBeenCalled();
      expect(fallbackContext.ToolCall.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
        fallbackContext.Transaction.deleteMany.mock.invocationCallOrder[0],
      );
      expect(fallbackContext.Transaction.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
        fallbackContext.Message.deleteMany.mock.invocationCallOrder[0],
      );
      expect(fallbackContext.Message.deleteMany).toHaveBeenCalledWith({
        user: 'user-1',
        conversationId: 'conversation-1',
        messageId: { $in: ['bridge-2', 'copy-root-2'] },
      });
    });

    it('does not allow hostile undo payload to override outer user, conversation, or graft scope', async () => {
      const persistence = createPersistence({
        messages: [
          createMessage({
            messageId: 'bridge-safe',
            user: 'user-1',
            conversationId: 'conversation-1',
            isCreatedByUser: true,
            sender: 'Graft',
            metadata: {
              generationGraft: {
                kind: 'generation_graft',
                graftId: 'graft-safe',
                copiedMessageIds: ['copy-root-safe'],
                copiedRootMessageId: 'copy-root-safe',
                activeCopiedMessageId: 'copy-root-safe',
                mode: 'generation',
                sourceState: 'complete',
                destinationState: 'complete',
              },
            },
          }),
          createMessage({
            messageId: 'copy-root-safe',
            user: 'user-1',
            conversationId: 'conversation-1',
            parentMessageId: 'bridge-safe',
            metadata: {
              generationGraftCopy: {
                kind: 'generation_graft_copy',
                graftId: 'graft-safe',
                clonedFromMessageId: 'source-root',
              },
            },
          }),
        ],
      });

      let isolatedUndoGenerationGraft;
      jest.resetModules();
      jest.doMock('~/db/models', () => ({
        Message: persistence.Message,
        ToolCall: persistence.ToolCall,
        Transaction: persistence.Transaction,
      }));
      jest.doMock('mongoose', () => persistence.mongoose);
      jest.doMock('@librechat/data-schemas', () => ({
        logger: {
          error: jest.fn(),
          warn: jest.fn(),
          info: jest.fn(),
          debug: jest.fn(),
        },
      }));
      jest.isolateModules(() => {
        ({ undoGenerationGraft: isolatedUndoGenerationGraft } = require('./index'));
      });

      const undoResult = await isolatedUndoGenerationGraft({
        userId: 'user-1',
        conversationId: 'conversation-1',
        graftId: 'graft-safe',
        payload: {
          userId: 'attacker-user',
          conversationId: 'attacker-conversation',
          graftId: 'attacker-graft',
        },
      });
      expect(persistence.Message.findOne).toHaveBeenCalledWith({
        user: 'user-1',
        conversationId: 'conversation-1',
        'metadata.generationGraft.kind': 'generation_graft',
        'metadata.generationGraft.graftId': 'graft-safe',
      });
      expect(undoResult).toEqual({
        graftId: 'graft-safe',
        deletedMessageIds: ['bridge-safe', 'copy-root-safe'],
        deletedCount: 2,
      });
      jest.dontMock('~/db/models');
      jest.dontMock('mongoose');
      jest.dontMock('@librechat/data-schemas');
    });

    it('honors top-level includeContinuations in the route-facing undo alias without trusting payload identifiers', async () => {
      const persistence = createPersistence({
        messages: [
          createMessage({
            messageId: 'bridge-safe',
            user: 'user-1',
            conversationId: 'conversation-1',
            isCreatedByUser: true,
            sender: 'Graft',
            metadata: {
              generationGraft: {
                kind: 'generation_graft',
                graftId: 'graft-safe',
                copiedMessageIds: ['copy-root-safe'],
                copiedRootMessageId: 'copy-root-safe',
                activeCopiedMessageId: 'copy-root-safe',
                mode: 'generation',
                sourceState: 'complete',
                destinationState: 'complete',
              },
            },
          }),
          createMessage({
            messageId: 'copy-root-safe',
            user: 'user-1',
            conversationId: 'conversation-1',
            parentMessageId: 'bridge-safe',
            metadata: {
              generationGraftCopy: {
                kind: 'generation_graft_copy',
                graftId: 'graft-safe',
                clonedFromMessageId: 'source-root',
              },
            },
          }),
          createMessage({
            messageId: 'continuation-safe',
            user: 'user-1',
            conversationId: 'conversation-1',
            parentMessageId: 'copy-root-safe',
          }),
        ],
      });

      let isolatedUndoGenerationGraft;
      jest.resetModules();
      jest.doMock('~/db/models', () => ({
        Message: persistence.Message,
        ToolCall: persistence.ToolCall,
        Transaction: persistence.Transaction,
      }));
      jest.doMock('mongoose', () => persistence.mongoose);
      jest.doMock('@librechat/data-schemas', () => ({
        logger: {
          error: jest.fn(),
          warn: jest.fn(),
          info: jest.fn(),
          debug: jest.fn(),
        },
      }));
      jest.isolateModules(() => {
        ({ undoGenerationGraft: isolatedUndoGenerationGraft } = require('./index'));
      });

      const undoResult = await isolatedUndoGenerationGraft({
        userId: 'user-1',
        conversationId: 'conversation-1',
        graftId: 'graft-safe',
        includeContinuations: true,
        payload: {
          userId: 'attacker-user',
          conversationId: 'attacker-conversation',
          graftId: 'attacker-graft',
          includeContinuations: false,
        },
      });

      expect(undoResult).toEqual({
        graftId: 'graft-safe',
        deletedMessageIds: ['bridge-safe', 'copy-root-safe', 'continuation-safe'],
        deletedCount: 3,
      });
      expect(persistence.Message.findOne).toHaveBeenCalledWith({
        user: 'user-1',
        conversationId: 'conversation-1',
        'metadata.generationGraft.kind': 'generation_graft',
        'metadata.generationGraft.graftId': 'graft-safe',
      });
      jest.dontMock('~/db/models');
      jest.dontMock('mongoose');
      jest.dontMock('@librechat/data-schemas');
    });

    it('rejects corrupted graft provenance when bridge metadata lists an unrelated sibling', async () => {
      const fixture = createFixtureConversation();
      const context = createServiceContext({
        messages: fixture.messages,
        toolCalls: fixture.toolCalls,
        uuidValues: ['graft-prov', 'bridge-prov', 'copy-root-prov'],
      });
      const preview = await context.service.preview(buildPreviewRequest());
      await context.service.create(
        buildCreateRequest({
          payload: {
            idempotencyKey: 'idem-prov',
            expectedTreeRevision: preview.treeRevision,
          },
        }),
      );

      const bridgeRecord = context.state.messages.find((message) => message.messageId === 'bridge-prov');
      bridgeRecord.metadata.generationGraft.copiedMessageIds.push('destination-child');

      await expectGraftError(
        context.service.inspect({
          userId: 'user-1',
          conversationId: 'conversation-1',
          graftId: 'graft-prov',
        }),
        'INVALID_SOURCE',
        400,
      );
      await expectGraftError(
        context.service.undo({
          userId: 'user-1',
          conversationId: 'conversation-1',
          graftId: 'graft-prov',
          includeContinuations: true,
        }),
        'INVALID_SOURCE',
        400,
      );
      expect(context.state.messages.some((message) => message.messageId === 'destination-child')).toBe(true);
    });

    it('refreshes descendants at undo time so late continuations are guarded or included', async () => {
      const fixture = createFixtureConversation();
      const context = createServiceContext({
        messages: fixture.messages,
        toolCalls: fixture.toolCalls,
        uuidValues: ['graft-race', 'bridge-race', 'copy-root-race'],
      });
      const preview = await context.service.preview(buildPreviewRequest());
      const created = await context.service.create(
        buildCreateRequest({
          payload: {
            idempotencyKey: 'idem-race-undo',
            expectedTreeRevision: preview.treeRevision,
          },
        }),
      );

      const inspected = await context.service.inspect({
        userId: 'user-1',
        conversationId: 'conversation-1',
        graftId: 'graft-race',
      });
      expect(inspected.continuationMessageIds).toEqual([]);

      context.state.messages.push(
        createMessage({
          messageId: 'continuation-late',
          user: 'user-1',
          conversationId: 'conversation-1',
          parentMessageId: created.activeCopiedMessageId,
        }),
      );

      await expectGraftError(
        context.service.undo({
          userId: 'user-1',
          conversationId: 'conversation-1',
          graftId: 'graft-race',
        }),
        'GRAFT_HAS_CONTINUATIONS',
        409,
      );

      const undoResult = await context.service.undo({
        userId: 'user-1',
        conversationId: 'conversation-1',
        graftId: 'graft-race',
        includeContinuations: true,
      });
      expect(undoResult.deletedMessageIds).toEqual([
        'bridge-race',
        'copy-root-race',
        'continuation-late',
      ]);
      expect(context.state.messages.some((message) => message.messageId === 'continuation-late')).toBe(false);
    });
  });
});
