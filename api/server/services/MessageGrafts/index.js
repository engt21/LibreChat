const crypto = require('crypto');
const mongoose = require('mongoose');
const { logger: defaultLogger } = require('@librechat/data-schemas');
const { Message, ToolCall, Transaction } = require('~/db/models');

const { getActiveGenerationState } = require('./active');
const { buildClonePlan } = require('./clone');
const {
  MAX_GRAFT_MESSAGES,
  MAX_GRAFT_PAYLOAD_BYTES,
  PARTIAL_GRAFT_WARNING,
  GenerationGraftError,
} = require('./constants');
const {
  buildMessageGraph,
  classifyLifecycle,
  collectDescendantIds,
  validateSelection,
} = require('./graph');
const { computeTreeRevision } = require('./revision');

const TOOL_CALL_SORT = {
  createdAt: 1,
  blockIndex: 1,
  partIndex: 1,
  _id: 1,
};
const MESSAGE_SORT = {
  createdAt: 1,
  messageId: 1,
};
const GRAFT_KIND = 'generation_graft';
const locks = new Map();
const IMAGE_FILE_PATTERN = /\.(avif|bmp|gif|heic|jpeg|jpg|png|svg|webp)(?:$|[?#])/i;
const randomUUID = crypto.randomUUID;

function requireNonEmptyString(value, label, code = 'INVALID_SOURCE') {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new GenerationGraftError(code, `${label} is required.`, 400, { label });
  }

  return value.trim();
}

function assertMode(mode) {
  if (mode !== 'generation' && mode !== 'subtree') {
    throw new GenerationGraftError(
      'INVALID_SOURCE',
      'Graft mode must be either "generation" or "subtree".',
      400,
      { mode },
    );
  }
}

function sortUnique(values) {
  return Array.from(new Set(values.filter((value) => typeof value === 'string'))).sort((a, b) =>
    a.localeCompare(b),
  );
}

function getGenerationGraftMetadata(message) {
  const metadata = message?.metadata?.generationGraft;
  if (metadata == null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }

  return metadata;
}

function orderRecordsByIds(records, messageIds, label) {
  const recordsById = new Map(records.map((record) => [record.messageId, record]));
  const orderedRecords = messageIds.map((messageId) => recordsById.get(messageId)).filter(Boolean);

  if (orderedRecords.length !== messageIds.length) {
    throw new GenerationGraftError(
      'INVALID_SOURCE',
      `The graft ${label} could not be reconstructed from the stored messages.`,
      400,
      {
        label,
        missingMessageIds: messageIds.filter((messageId) => !recordsById.has(messageId)),
      },
    );
  }

  return orderedRecords;
}

function looksLikeImagePath(value) {
  return typeof value === 'string' && IMAGE_FILE_PATTERN.test(value);
}

function normalizePayloadRequest(params = {}) {
  const payload =
    params?.payload != null && typeof params.payload === 'object' && !Array.isArray(params.payload)
      ? params.payload
      : params;

  return {
    ...payload,
    userId: params?.userId,
    conversationId: params?.conversationId,
  };
}

function applySession(query, session) {
  if (session && query && typeof query.session === 'function') {
    return query.session(session);
  }

  return query;
}

function normalizeActiveSourceLeafMessageId(sourceMessageId, sourceActiveLeafMessageId) {
  return sourceActiveLeafMessageId ?? sourceMessageId;
}

function createDeterministicUuidGenerator(seed) {
  let counter = 0;

  return () => {
    const digest = crypto.createHash('sha256').update(`${seed}:${counter++}`).digest();
    const bytes = Buffer.from(digest.subarray(0, 16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  };
}

function computeRequestFingerprint({
  sourceMessageId,
  destinationMessageId,
  mode,
  activeSourceLeafMessageId,
}) {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        sourceMessageId,
        destinationMessageId,
        mode,
        activeSourceLeafMessageId,
      }),
    )
    .digest('hex');
}

function isDuplicateKeyError(error) {
  return error?.code === 11000;
}

function isIncompleteGraftError(error) {
  return error?.name === 'GenerationGraftError' && error?.code === 'INVALID_SOURCE' && error?.graftIncomplete === true;
}

function collectFileReferenceCounts(values) {
  const visited = new WeakSet();
  let files = 0;
  let images = 0;

  const visit = (value) => {
    if (value == null || typeof value !== 'object') {
      return;
    }

    if (visited.has(value)) {
      return;
    }
    visited.add(value);

    if (Array.isArray(value)) {
      for (const entry of value) {
        visit(entry);
      }
      return;
    }

    let fileLike = false;
    let imageLike = false;

    for (const [key, entry] of Object.entries(value)) {
      if (key === 'filepath' || key === 'filename' || key === 'url' || key === 'image_path') {
        fileLike = true;
      }
      if (key === 'image_path' || looksLikeImagePath(entry)) {
        imageLike = true;
      }

      visit(entry);
    }

    if (fileLike) {
      files += 1;
      if (imageLike) {
        images += 1;
      }
    }
  };

  for (const value of values) {
    visit(value);
  }

  return { files, images };
}

function computeSelectionCounts(messages, toolCalls) {
  const approximateTokens = messages.reduce((total, message) => {
    if (Number.isFinite(message?.tokenCount)) {
      return total + Math.max(0, Number(message.tokenCount));
    }

    return total + Math.ceil(String(message?.text ?? '').length / 4);
  }, 0);
  const { files, images } = collectFileReferenceCounts([...messages, ...toolCalls]);
  const payloadBytes = Buffer.byteLength(JSON.stringify({ messages, toolCalls }));

  return {
    counts: {
      messages: messages.length,
      toolCalls: toolCalls.length,
      files,
      images,
      approximateTokens,
    },
    payloadBytes,
  };
}

function toPreviewResponse(previewResult) {
  return {
    conversationId: previewResult.conversationId,
    sourceMessageId: previewResult.sourceMessageId,
    destinationMessageId: previewResult.destinationMessageId,
    mode: previewResult.mode,
    sourceActiveLeafMessageId: previewResult.sourceActiveLeafMessageId,
    sourceState: previewResult.sourceState,
    destinationState: previewResult.destinationState,
    copiedMessageIds: previewResult.copiedMessageIds,
    activeSourceLeafMessageId: previewResult.activeSourceLeafMessageId,
    destinationChildCount: previewResult.destinationChildCount,
    counts: previewResult.counts,
    warnings: previewResult.warnings,
    treeRevision: previewResult.treeRevision,
    requiresStabilization: previewResult.requiresStabilization,
    activeMessageIds: previewResult.activeMessageIds,
    conversationActiveWithoutMessageId: previewResult.conversationActiveWithoutMessageId,
    canCreate: previewResult.canCreate,
  };
}

function getLockKey(userId, conversationId) {
  return `${userId}:${conversationId}`;
}

function supportsMongoTransactions(activeMongoose) {
  const topologyType = activeMongoose?.connection?.getClient?.()?.topology?.description?.type;
  return topologyType != null && !['Single', 'Unknown'].includes(topologyType);
}

function createMessageGraftService(overrides = {}) {
  const {
    Message: MessageModel = Message,
    ToolCall: ToolCallModel = ToolCall,
    Transaction: TransactionModel = Transaction,
    mongoose: activeMongoose = mongoose,
    logger = defaultLogger,
    getActiveGenerationState: getActiveState = getActiveGenerationState,
    buildMessageGraph: makeGraph = buildMessageGraph,
    validateSelection: validateGraphSelection = validateSelection,
    collectDescendantIds: collectGraphDescendantIds = collectDescendantIds,
    classifyLifecycle: classifyGraphLifecycle = classifyLifecycle,
    computeTreeRevision: computeRevision = computeTreeRevision,
    buildClonePlan: createClonePlan = buildClonePlan,
    uuid = randomUUID,
    now = () => new Date(),
    sleep = async () => {},
    GRAFT_RELOAD_RETRY_ATTEMPTS: graftReloadRetryAttempts = 3,
    MAX_GRAFT_MESSAGES: maxGraftMessages = MAX_GRAFT_MESSAGES,
    MAX_GRAFT_PAYLOAD_BYTES: maxGraftPayloadBytes = MAX_GRAFT_PAYLOAD_BYTES,
    locks: activeLocks = locks,
  } = overrides;

  async function withMutationLock(userId, conversationId, callback) {
    const lockKey = getLockKey(
      requireNonEmptyString(userId, 'userId'),
      requireNonEmptyString(conversationId, 'conversationId'),
    );

    if (activeLocks.has(lockKey)) {
      throw new GenerationGraftError('GRAFT_BUSY', 'A graft is already in progress.', 409, {
        conversationId,
      });
    }

    activeLocks.set(lockKey, true);
    try {
      return await callback();
    } finally {
      activeLocks.delete(lockKey);
    }
  }

  function resolveUuidGenerator(userId, conversationId, idempotencyKey) {
    if (uuid !== randomUUID) {
      return uuid;
    }

    return createDeterministicUuidGenerator(`${userId}:${conversationId}:${idempotencyKey}`);
  }

  async function listConversationMessages(userId, conversationId, session) {
    return applySession(
      MessageModel.find({ user: userId, conversationId }).sort(MESSAGE_SORT),
      session,
    ).lean();
  }

  async function listToolCalls(userId, conversationId, messageIds, session) {
    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return [];
    }

    return applySession(
      ToolCallModel.find({
        user: userId,
        conversationId,
        messageId: { $in: messageIds },
      }).sort(TOOL_CALL_SORT),
      session,
    ).lean();
  }

  async function findBridgeByMetadata(userId, conversationId, metadataFilter, session) {
    return applySession(
      MessageModel.findOne({
        user: userId,
        conversationId,
        'metadata.generationGraft.kind': GRAFT_KIND,
        ...metadataFilter,
      }),
      session,
    ).lean();
  }

  function assertCompatibleIdempotentBridge(bridgeMessage, requestFingerprint, idempotencyKey) {
    const metadata = getGenerationGraftMetadata(bridgeMessage);
    if (!metadata) {
      throw new GenerationGraftError(
        'INVALID_SOURCE',
        'The stored graft bridge is missing its generation graft metadata.',
        400,
        { bridgeMessageId: bridgeMessage?.messageId ?? null },
      );
    }

    if (metadata.requestFingerprint !== requestFingerprint) {
      throw new GenerationGraftError(
        'INVALID_SOURCE',
        'The idempotency key is already associated with a different graft request.',
        400,
        {
          idempotencyKey,
          graftId: metadata.graftId ?? null,
        },
      );
    }

    return metadata;
  }

  function validateCopiedMessageIds({ bridgeMessage, metadata, graph }) {
    const copiedMessageIds = Array.isArray(metadata.copiedMessageIds) ? metadata.copiedMessageIds : [];
    if (new Set(copiedMessageIds).size !== copiedMessageIds.length) {
      throw new GenerationGraftError(
        'INVALID_SOURCE',
        'The graft copied message list contains duplicate message ids.',
        400,
        {
          graftId: metadata.graftId ?? null,
        },
      );
    }

    const descendantIds = collectGraphDescendantIds(graph, bridgeMessage.messageId);
    const descendantSet = new Set(descendantIds.slice(1));

    for (const copiedMessageId of copiedMessageIds) {
      const copiedMessage = graph.byId.get(copiedMessageId);
      if (!copiedMessage || !descendantSet.has(copiedMessageId)) {
        throw new GenerationGraftError(
          'INVALID_SOURCE',
          'The graft copied message list contains an invalid descendant reference.',
          400,
          {
            graftId: metadata.graftId ?? null,
            copiedMessageId,
            graftIncomplete: !copiedMessage,
          },
        );
      }

      const copyMetadata = copiedMessage?.metadata?.generationGraftCopy;
      if (
        copyMetadata?.kind !== 'generation_graft_copy' ||
        copyMetadata?.graftId !== metadata.graftId
      ) {
        throw new GenerationGraftError(
          'INVALID_SOURCE',
          'The graft copied message list contains a message with invalid graft copy provenance.',
          400,
          {
            graftId: metadata.graftId ?? null,
            copiedMessageId,
          },
        );
      }
    }

    return { copiedMessageIds, descendantIds };
  }

  async function loadGraftDetails({
    userId,
    conversationId,
    graftId,
    requestFingerprint,
    bridgeMessage: providedBridgeMessage,
    session,
  }) {
    const bridgeMessage =
      providedBridgeMessage ??
      (await findBridgeByMetadata(
        userId,
        conversationId,
        {
          'metadata.generationGraft.graftId': graftId,
        },
        session,
      ));
    if (!bridgeMessage) {
      throw new GenerationGraftError('MESSAGE_NOT_FOUND', 'The graft bridge was not found.', 404, {
        graftId,
      });
    }

    const metadata = getGenerationGraftMetadata(bridgeMessage);
    if (!metadata) {
      throw new GenerationGraftError(
        'INVALID_SOURCE',
        'The graft bridge metadata is invalid.',
        400,
        { graftId, bridgeMessageId: bridgeMessage?.messageId ?? null },
      );
    }

    if (requestFingerprint) {
      assertCompatibleIdempotentBridge(bridgeMessage, requestFingerprint, metadata.idempotencyKey);
    }

    const conversationMessages = await listConversationMessages(userId, conversationId, session);
    const graph = makeGraph(conversationMessages);
    const { copiedMessageIds, descendantIds } = validateCopiedMessageIds({
      bridgeMessage,
      metadata,
      graph,
    });
    const graftOwnedIds = new Set([bridgeMessage.messageId, ...copiedMessageIds]);
    const continuationMessageIds = descendantIds.filter((messageId) => !graftOwnedIds.has(messageId));
    const scopedToolCalls = await listToolCalls(
      userId,
      conversationId,
      [...copiedMessageIds, ...continuationMessageIds],
      session,
    );
    const copiedMessages = orderRecordsByIds(
      conversationMessages.filter((message) => copiedMessageIds.includes(message.messageId)),
      copiedMessageIds,
      'copied message list',
    );
    const continuationMessages = orderRecordsByIds(
      conversationMessages.filter((message) => continuationMessageIds.includes(message.messageId)),
      continuationMessageIds,
      'continuation message list',
    );
    const copiedToolCalls = scopedToolCalls.filter((toolCall) =>
      copiedMessageIds.includes(toolCall.messageId),
    );
    const continuationToolCalls = scopedToolCalls.filter((toolCall) =>
      continuationMessageIds.includes(toolCall.messageId),
    );

    return {
      metadata,
      bridgeMessage,
      copiedMessageIds,
      copiedMessages,
      continuationMessageIds,
      continuationMessages,
      copiedToolCalls,
      continuationToolCalls,
    };
  }

  async function buildCreateResponseFromBridge(
    userId,
    conversationId,
    bridgeMessage,
    { requestFingerprint, session } = {},
  ) {
    const details = await loadGraftDetails({
      userId,
      conversationId,
      graftId: getGenerationGraftMetadata(bridgeMessage)?.graftId,
      requestFingerprint,
      bridgeMessage,
      session,
    });

    return {
      graftId: details.metadata.graftId,
      bridgeMessageId: bridgeMessage.messageId,
      copiedRootMessageId: details.metadata.copiedRootMessageId,
      activeCopiedMessageId: details.metadata.activeCopiedMessageId,
      copiedMessageCount: details.copiedMessageIds.length,
      createdMessages: [bridgeMessage, ...details.copiedMessages],
    };
  }

  async function reloadCreateResponseByIdempotencyKey({
    userId,
    conversationId,
    idempotencyKey,
    requestFingerprint,
    bridgeMessage: initialBridgeMessage,
  }) {
    let bridgeMessage = initialBridgeMessage ?? null;

    for (let attempt = 0; attempt < graftReloadRetryAttempts; attempt++) {
      if (!bridgeMessage) {
        bridgeMessage = await findBridgeByMetadata(userId, conversationId, {
          'metadata.generationGraft.idempotencyKey': idempotencyKey,
        });
      }
      if (!bridgeMessage) {
        return null;
      }

      try {
        assertCompatibleIdempotentBridge(bridgeMessage, requestFingerprint, idempotencyKey);
        return await buildCreateResponseFromBridge(userId, conversationId, bridgeMessage, {
          requestFingerprint,
        });
      } catch (error) {
        if (!isIncompleteGraftError(error) || attempt === graftReloadRetryAttempts - 1) {
          throw error;
        }

        await sleep({ attempt: attempt + 1, idempotencyKey, error });
        bridgeMessage = null;
      }
    }

    return null;
  }

  async function cleanupInsertedRecords({ userId, conversationId, messageIds }, originalError) {
    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return;
    }

    const filter = {
      user: userId,
      conversationId,
      messageId: { $in: messageIds },
    };

    for (const [label, cleanup] of [
      ['tool calls', () => ToolCallModel.deleteMany(filter)],
      ['messages', () => MessageModel.deleteMany(filter)],
    ]) {
      try {
        await cleanup();
      } catch (cleanupError) {
        logger.error(`Failed to clean up graft ${label} after create failure`, {
          userId,
          conversationId,
          messageIds,
          originalError,
          error: cleanupError,
        });
      }
    }
  }

  async function previewInternal({
    userId,
    conversationId,
    sourceMessageId,
    destinationMessageId,
    mode,
    sourceActiveLeafMessageId,
  }) {
    requireNonEmptyString(userId, 'userId');
    requireNonEmptyString(conversationId, 'conversationId');
    sourceMessageId = requireNonEmptyString(sourceMessageId, 'sourceMessageId');
    destinationMessageId = requireNonEmptyString(destinationMessageId, 'destinationMessageId');
    assertMode(mode);

    if (sourceActiveLeafMessageId !== undefined) {
      sourceActiveLeafMessageId = requireNonEmptyString(
        sourceActiveLeafMessageId,
        'sourceActiveLeafMessageId',
      );
    }

    const messages = await listConversationMessages(userId, conversationId);
    const activeState = await getActiveState({ userId, conversationId });
    const graph = makeGraph(messages);
    const { source, destination } = validateGraphSelection(graph, sourceMessageId, destinationMessageId);
    const copiedMessageIds =
      mode === 'subtree'
        ? collectGraphDescendantIds(graph, sourceMessageId)
        : [sourceMessageId];

    if (activeState?.active === true) {
      const activeResponseMessageId = activeState?.responseMessageId ?? null;

      if (activeResponseMessageId == null) {
        throw new GenerationGraftError(
          'GRAFT_REQUIRES_STABILIZATION',
          'The active generation must stabilize before grafting.',
          409,
          {
            activeMessageIds: [],
            conversationActiveWithoutMessageId: true,
          },
        );
      }

      const selectedActiveMessageIds = sortUnique(
        [sourceMessageId, destinationMessageId, ...copiedMessageIds].filter(
          (messageId) => messageId === activeResponseMessageId,
        ),
      );
      if (selectedActiveMessageIds.length > 0) {
        throw new GenerationGraftError(
          'GRAFT_REQUIRES_STABILIZATION',
          'The selected generation must stabilize before grafting.',
          409,
          {
            activeMessageIds: selectedActiveMessageIds,
            conversationActiveWithoutMessageId: false,
          },
        );
      }
    }

    const activeSourceLeafMessageId = sourceActiveLeafMessageId ?? sourceMessageId;
    if (!copiedMessageIds.includes(activeSourceLeafMessageId)) {
      throw new GenerationGraftError(
        'INVALID_SOURCE',
        'The active source leaf must belong to the copied subtree.',
        400,
        { activeSourceLeafMessageId },
      );
    }

    const selectedMessages = copiedMessageIds.map((messageId) => graph.byId.get(messageId));
    const selectedToolCalls = await listToolCalls(userId, conversationId, copiedMessageIds);
    const { counts, payloadBytes } = computeSelectionCounts(selectedMessages, selectedToolCalls);

    if (counts.messages > maxGraftMessages) {
      throw new GenerationGraftError(
        'GRAFT_TOO_LARGE',
        'The selected graft contains too many messages.',
        413,
        {
          counts,
          maxMessages: maxGraftMessages,
        },
      );
    }

    if (payloadBytes > maxGraftPayloadBytes) {
      throw new GenerationGraftError(
        'GRAFT_TOO_LARGE',
        'The selected graft payload exceeds the maximum size.',
        413,
        {
          counts,
          payloadBytes,
          maxPayloadBytes: maxGraftPayloadBytes,
        },
      );
    }

    const sourceState = classifyGraphLifecycle(source, activeState);
    const destinationState = classifyGraphLifecycle(destination, activeState);
    const warnings =
      sourceState !== 'complete' || destinationState !== 'complete' ? [PARTIAL_GRAFT_WARNING] : [];

    return {
      conversationId,
      sourceMessageId,
      destinationMessageId,
      mode,
      sourceActiveLeafMessageId,
      sourceState,
      destinationState,
      copiedMessageIds,
      activeSourceLeafMessageId,
      destinationChildCount: graph.childrenByParent.get(destinationMessageId)?.length ?? 0,
      counts,
      warnings,
      treeRevision: computeRevision(messages, activeState),
      requiresStabilization: false,
      activeMessageIds: [],
      conversationActiveWithoutMessageId: false,
      canCreate: true,
      graph,
      messages,
      selectedMessages,
      selectedToolCalls,
      payloadBytes,
      activeState,
    };
  }

  async function preview(params) {
    return toPreviewResponse(await previewInternal(normalizePayloadRequest(params)));
  }

  async function create(params) {
    const {
      userId,
      conversationId,
      sourceMessageId,
      destinationMessageId,
      mode,
      sourceActiveLeafMessageId,
      idempotencyKey,
      expectedTreeRevision: rawExpectedTreeRevision,
    } = normalizePayloadRequest(params);
    requireNonEmptyString(idempotencyKey, 'idempotencyKey');
    const expectedTreeRevision = requireNonEmptyString(
      rawExpectedTreeRevision,
      'expectedTreeRevision',
    );
    const requestFingerprint = computeRequestFingerprint({
      sourceMessageId,
      destinationMessageId,
      mode,
      activeSourceLeafMessageId: normalizeActiveSourceLeafMessageId(
        sourceMessageId,
        sourceActiveLeafMessageId,
      ),
    });
    return withMutationLock(userId, conversationId, async () => {
      const existingBridge = await findBridgeByMetadata(userId, conversationId, {
        'metadata.generationGraft.idempotencyKey': idempotencyKey,
      });
      if (existingBridge) {
        return reloadCreateResponseByIdempotencyKey({
          userId,
          conversationId,
          idempotencyKey,
          requestFingerprint,
          bridgeMessage: existingBridge,
        });
      }

      const previewResult = await previewInternal({
        userId,
        conversationId,
        sourceMessageId,
        destinationMessageId,
        mode,
        sourceActiveLeafMessageId,
      });

      if (previewResult.treeRevision !== expectedTreeRevision) {
        throw new GenerationGraftError(
          'TREE_CHANGED',
          'The conversation tree changed before the graft could be created.',
          409,
          {
            expectedTreeRevision,
            treeRevision: previewResult.treeRevision,
          },
        );
      }

      const insertMessages = async (messages, options = {}) => {
        if (messages.length === 0) {
          return [];
        }

        return MessageModel.insertMany(messages, { ordered: true, ...options });
      };

      const persistClonePlan = async (clonePlan, { session, transactional } = {}) => {
        const insertedMessageIds = clonePlan.messages.map((message) => message.messageId);
        const insertOptions = session ? { session } : {};
        const [bridgeMessage, ...copiedMessages] = clonePlan.messages;

        const runPersistence = async () => {
          const insertedBridge = await insertMessages([bridgeMessage], insertOptions);
          if (insertedBridge.length !== 1) {
            throw new Error('Inserted graft message count did not match the clone plan.');
          }

          if (copiedMessages.length > 0) {
            const insertedCopies = await insertMessages(copiedMessages, insertOptions);
            if (insertedCopies.length !== copiedMessages.length) {
              throw new Error('Inserted graft message count did not match the clone plan.');
            }
          }

        if (clonePlan.toolCalls.length > 0) {
            const insertedToolCalls = await ToolCallModel.insertMany(
              clonePlan.toolCalls,
              session ? { ordered: true, session } : { ordered: true },
            );
            if (insertedToolCalls.length !== clonePlan.toolCalls.length) {
              throw new Error('Inserted graft tool call count did not match the clone plan.');
            }
          }

          const countFilter = {
            user: userId,
            conversationId,
            messageId: { $in: insertedMessageIds },
          };
          const insertedCount = session
            ? await MessageModel.countDocuments(countFilter, { session })
            : await MessageModel.countDocuments(countFilter);
          if (insertedCount !== insertedMessageIds.length) {
            throw new Error('Inserted graft message count did not match the stored graft records.');
          }

          const bridgeRecord = await findBridgeByMetadata(
            userId,
            conversationId,
            {
              'metadata.generationGraft.graftId': clonePlan.messages[0].metadata.generationGraft.graftId,
            },
            session,
          );
          if (!bridgeRecord) {
            throw new GenerationGraftError(
              'INVALID_SOURCE',
              'The created graft bridge could not be reloaded.',
              400,
              { graftId: clonePlan.messages[0].metadata.generationGraft.graftId },
            );
          }

          return buildCreateResponseFromBridge(userId, conversationId, bridgeRecord, {
            requestFingerprint,
            session,
          });
        };

        if (transactional) {
          return runPersistence();
        }

        try {
          return await runPersistence();
        } catch (error) {
          if (!isDuplicateKeyError(error)) {
            await cleanupInsertedRecords({ userId, conversationId, messageIds: insertedMessageIds }, error);
          }
          throw error;
        }
      };

      for (let attempt = 0; attempt < 2; attempt++) {
        const uuidGenerator = resolveUuidGenerator(userId, conversationId, idempotencyKey);
        const graftId = uuidGenerator();
        const clonePlan = createClonePlan({
          messages: previewResult.selectedMessages,
          toolCalls: previewResult.selectedToolCalls,
          conversationId,
          destinationMessageId,
          userId,
          graftId,
          idempotencyKey,
          sourceState: previewResult.sourceState,
          destinationState: previewResult.destinationState,
          mode,
          activeSourceLeafMessageId: previewResult.activeSourceLeafMessageId,
          uuid: uuidGenerator,
          now,
        });
        clonePlan.messages[0].metadata.generationGraft.requestFingerprint = requestFingerprint;

        try {
          if (supportsMongoTransactions(activeMongoose)) {
            const session = await activeMongoose.startSession();
            let transactionalResponse;
            try {
              await session.withTransaction(async () => {
                transactionalResponse = await persistClonePlan(clonePlan, {
                  session,
                  transactional: true,
                });
              });
            } finally {
              await session.endSession();
            }

            return transactionalResponse;
          }

          return await persistClonePlan(clonePlan);
        } catch (error) {
          if (!isDuplicateKeyError(error)) {
            throw error;
          }

          const winningResponse = await reloadCreateResponseByIdempotencyKey({
            userId,
            conversationId,
            idempotencyKey,
            requestFingerprint,
          });
          if (winningResponse) {
            return winningResponse;
          }

          if (attempt === 1) {
            throw error;
          }
        }
      }

      throw new GenerationGraftError(
        'INVALID_SOURCE',
        'The graft could not be created after retrying the idempotent insert.',
        400,
        { idempotencyKey },
      );
    });
  }

  async function inspect({ userId, conversationId, graftId }) {
    requireNonEmptyString(userId, 'userId');
    requireNonEmptyString(conversationId, 'conversationId');
    graftId = requireNonEmptyString(graftId, 'graftId');
    const details = await loadGraftDetails({ userId, conversationId, graftId });

    return {
      graftId,
      bridgeMessageId: details.bridgeMessage.messageId,
      copiedMessageIds: details.copiedMessageIds,
      continuationMessageIds: details.continuationMessageIds,
      copiedCounts: computeSelectionCounts(details.copiedMessages, details.copiedToolCalls).counts,
      continuationCounts: computeSelectionCounts(
        details.continuationMessages,
        details.continuationToolCalls,
      ).counts,
      canUndoWithoutContinuations: details.continuationMessageIds.length === 0,
      mode: details.metadata.mode,
      sourceState: details.metadata.sourceState,
      destinationState: details.metadata.destinationState,
      copiedRootMessageId: details.metadata.copiedRootMessageId,
      activeCopiedMessageId: details.metadata.activeCopiedMessageId,
    };
  }

  async function undo({ userId, conversationId, graftId, includeContinuations }) {
    requireNonEmptyString(userId, 'userId');
    requireNonEmptyString(conversationId, 'conversationId');
    graftId = requireNonEmptyString(graftId, 'graftId');
    return withMutationLock(userId, conversationId, async () => {
      const performUndo = async (session) => {
        const details = await loadGraftDetails({ userId, conversationId, graftId, session });
        if (details.continuationMessageIds.length > 0 && includeContinuations !== true) {
          throw new GenerationGraftError(
            'GRAFT_HAS_CONTINUATIONS',
            'The graft has continuations and cannot be undone without confirmation.',
            409,
            {
              graftId,
              continuationMessageIds: details.continuationMessageIds,
            },
          );
        }

        const deletedMessageIds = [
          details.bridgeMessage.messageId,
          ...details.copiedMessageIds,
          ...(includeContinuations === true ? details.continuationMessageIds : []),
        ];
        const filter = {
          user: userId,
          conversationId,
          messageId: { $in: deletedMessageIds },
        };
        if (session) {
          await ToolCallModel.deleteMany(filter, { session });
          await TransactionModel.deleteMany(filter, { session });
        } else {
          await ToolCallModel.deleteMany(filter);
          await TransactionModel.deleteMany(filter);
        }
        const messageDeleteResult = session
          ? await MessageModel.deleteMany(filter, { session })
          : await MessageModel.deleteMany(filter);

        return {
          graftId,
          deletedMessageIds,
          deletedCount: messageDeleteResult?.deletedCount ?? 0,
        };
      };

      if (supportsMongoTransactions(activeMongoose)) {
        const session = await activeMongoose.startSession();
        let transactionalResult;
        try {
          await session.withTransaction(async () => {
            transactionalResult = await performUndo(session);
          });
        } finally {
          await session.endSession();
        }

        return transactionalResult;
      }

      return performUndo();
    });
  }

  return {
    preview,
    create,
    inspect,
    undo,
  };
}

const defaultService = createMessageGraftService();

async function previewGenerationGraft(params) {
  return defaultService.preview(params);
}

async function createGenerationGraft(params) {
  return defaultService.create(params);
}

async function getGenerationGraft(params) {
  return defaultService.inspect(params);
}

async function undoGenerationGraft(params) {
  const payload =
    params?.payload != null && typeof params.payload === 'object' && !Array.isArray(params.payload)
      ? params.payload
      : {};
  const includeContinuations =
    params?.includeContinuations === true || payload?.includeContinuations === true;

  return defaultService.undo({
    ...payload,
    userId: params?.userId,
    conversationId: params?.conversationId,
    graftId: params?.graftId,
    includeContinuations,
  });
}

module.exports = {
  ...defaultService,
  createMessageGraftService,
  previewGenerationGraft,
  createGenerationGraft,
  getGenerationGraft,
  undoGenerationGraft,
};
