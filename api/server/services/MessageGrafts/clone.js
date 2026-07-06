const { randomUUID } = require('crypto');

const { GRAFT_BRIDGE_TEXT, PARTIAL_GRAFT_WARNING, GenerationGraftError } = require('./constants');

const STABLE_SOURCE_STATES = new Set([
  'complete',
  'stopped_partial',
  'aborted_partial',
  'errored_partial',
]);
const CLONE_MODES = new Set(['generation', 'subtree']);

function isPlainObject(value) {
  if (value == null || typeof value !== 'object') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isArrayBufferValue(value) {
  return Object.prototype.toString.call(value) === '[object ArrayBuffer]';
}

function cloneValue(value) {
  if (value == null || typeof value !== 'object') {
    return value;
  }

  if (value instanceof Date) {
    return new Date(value.getTime());
  }

  if (Buffer.isBuffer(value)) {
    return Buffer.from(value);
  }

  if (isArrayBufferValue(value)) {
    return value.slice(0);
  }

  if (ArrayBuffer.isView(value)) {
    const viewBuffer = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    if (value instanceof DataView) {
      return new DataView(viewBuffer, 0, value.byteLength);
    }

    return new value.constructor(viewBuffer);
  }

  if (typeof value.toObject === 'function') {
    return cloneValue(value.toObject());
  }

  if (typeof value.clone === 'function') {
    const clonedValue = value.clone();
    return clonedValue === value ? value : clonedValue;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => cloneValue(entry));
  }

  if (value instanceof Map) {
    return new Map(
      Array.from(value.entries(), ([key, entry]) => [cloneValue(key), cloneValue(entry)]),
    );
  }

  if (value instanceof Set) {
    return new Set(Array.from(value.values(), (entry) => cloneValue(entry)));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const source = value._doc && typeof value._doc === 'object' ? value._doc : value;
  const clone = {};

  for (const [key, entry] of Object.entries(source)) {
    if (typeof entry === 'function') {
      continue;
    }

    clone[key] = cloneValue(entry);
  }

  return clone;
}

function stripMongoFields(record) {
  const plainRecord = cloneValue(record);
  if (plainRecord == null || typeof plainRecord !== 'object' || Array.isArray(plainRecord)) {
    return plainRecord;
  }

  const strippedRecord = { ...plainRecord };
  for (const key of [
    '_id',
    '__v',
    'id',
    'user',
    'createdAt',
    'updatedAt',
    '_doc',
    '$__',
    '$isNew',
    '$locals',
    '$op',
    '$where',
    'isNew',
    'errors',
  ]) {
    delete strippedRecord[key];
  }

  for (const key of Object.keys(strippedRecord)) {
    if (key.startsWith('$')) {
      delete strippedRecord[key];
    }
  }

  return strippedRecord;
}

function remapEmbeddedMessageIds(value, sourceToCopyMessageId) {
  if (value == null || typeof value !== 'object') {
    return value;
  }

  if (value instanceof Date) {
    return new Date(value.getTime());
  }

  if (Buffer.isBuffer(value) || isArrayBufferValue(value) || ArrayBuffer.isView(value)) {
    return cloneValue(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => remapEmbeddedMessageIds(entry, sourceToCopyMessageId));
  }

  if (value instanceof Map) {
    return new Map(
      Array.from(value.entries(), ([key, entry]) => [
        cloneValue(key),
        remapEmbeddedMessageIds(entry, sourceToCopyMessageId),
      ]),
    );
  }

  if (value instanceof Set) {
    return new Set(Array.from(value.values(), (entry) => remapEmbeddedMessageIds(entry, sourceToCopyMessageId)));
  }

  if (!isPlainObject(value)) {
    return cloneValue(value);
  }

  const remapped = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'messageId' && typeof entry === 'string' && sourceToCopyMessageId.has(entry)) {
      remapped[key] = sourceToCopyMessageId.get(entry);
      continue;
    }

    remapped[key] = remapEmbeddedMessageIds(entry, sourceToCopyMessageId);
  }

  return remapped;
}

function remapNestedMessageId(messageId, sourceToCopyMessageId) {
  if (typeof messageId !== 'string') {
    return messageId;
  }

  return sourceToCopyMessageId.get(messageId) ?? messageId;
}

function remapNestedMessageIds(messageIds, sourceToCopyMessageId) {
  if (!Array.isArray(messageIds)) {
    return messageIds;
  }

  return messageIds.map((messageId) => remapNestedMessageId(messageId, sourceToCopyMessageId));
}

function getNestedMappingKey(generationGraft) {
  if (typeof generationGraft?.graftId === 'string' && generationGraft.graftId.length > 0) {
    return generationGraft.graftId;
  }

  if (
    typeof generationGraft?.idempotencyKey === 'string' &&
    generationGraft.idempotencyKey.length > 0
  ) {
    return `idempotency:${generationGraft.idempotencyKey}`;
  }

  return JSON.stringify(generationGraft);
}

function remapNestedGraftMetadata(record, options = {}) {
  const clonedRecord = cloneValue(record);
  if (clonedRecord == null || typeof clonedRecord !== 'object' || Array.isArray(clonedRecord)) {
    return clonedRecord;
  }

  const {
    sourceToCopyMessageId = new Map(),
    nestedGraftIds = new Map(),
    nestedIdempotencyKeys = new Map(),
    uuid = randomUUID,
    claimGeneratedIdentity = (value) => value,
  } = options;

  const hasWrapperMetadata =
    clonedRecord.metadata != null &&
    typeof clonedRecord.metadata === 'object' &&
    !Array.isArray(clonedRecord.metadata);
  const metadata = hasWrapperMetadata ? { ...clonedRecord.metadata } : { ...clonedRecord };
  const generationGraft = metadata.generationGraft;

  if (generationGraft == null || typeof generationGraft !== 'object' || Array.isArray(generationGraft)) {
    return hasWrapperMetadata ? { ...clonedRecord, metadata } : metadata;
  }

  const nestedMappingKey = getNestedMappingKey(generationGraft);
  let graftId = nestedGraftIds.get(nestedMappingKey);
  if (graftId == null) {
    graftId = claimGeneratedIdentity(uuid(), 'nestedGraftId', { nestedMappingKey });
    nestedGraftIds.set(nestedMappingKey, graftId);
  }

  let idempotencyKey = nestedIdempotencyKeys.get(nestedMappingKey);
  if (idempotencyKey == null) {
    idempotencyKey = claimGeneratedIdentity(uuid(), 'nestedIdempotencyKey', {
      nestedMappingKey,
      graftId,
    });
    nestedIdempotencyKeys.set(nestedMappingKey, idempotencyKey);
  }

  metadata.generationGraft = {
    ...generationGraft,
    graftId,
    idempotencyKey,
    sourceRootMessageId: remapNestedMessageId(
      generationGraft.sourceRootMessageId,
      sourceToCopyMessageId,
    ),
    sourceMessageIds: remapNestedMessageIds(generationGraft.sourceMessageIds, sourceToCopyMessageId),
    destinationMessageId: remapNestedMessageId(
      generationGraft.destinationMessageId,
      sourceToCopyMessageId,
    ),
    copiedRootMessageId: remapNestedMessageId(
      generationGraft.copiedRootMessageId,
      sourceToCopyMessageId,
    ),
    copiedMessageIds: remapNestedMessageIds(generationGraft.copiedMessageIds, sourceToCopyMessageId),
    activeCopiedMessageId: remapNestedMessageId(
      generationGraft.activeCopiedMessageId,
      sourceToCopyMessageId,
    ),
  };

  if (hasWrapperMetadata) {
    return {
      ...clonedRecord,
      metadata,
    };
  }

  return metadata;
}

function resolveNow(now) {
  if (typeof now === 'function') {
    return resolveNow(now());
  }

  const resolvedDate = now instanceof Date ? new Date(now.getTime()) : new Date(now ?? Date.now());
  if (Number.isNaN(resolvedDate.getTime())) {
    throw new GenerationGraftError('INVALID_SOURCE', 'A valid graft timestamp is required.');
  }

  return resolvedDate;
}

function assertStableState(state, label) {
  if (!STABLE_SOURCE_STATES.has(state)) {
    throw new GenerationGraftError(
      'INVALID_SOURCE',
      `${label} must be stable before creating a graft clone plan.`,
      400,
      { state, label },
    );
  }
}

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new GenerationGraftError(
      'INVALID_SOURCE',
      `${label} is required for graft cloning.`,
      400,
      { label },
    );
  }
}

function assertCloneMode(mode) {
  if (!CLONE_MODES.has(mode)) {
    throw new GenerationGraftError(
      'INVALID_SOURCE',
      'Clone mode must be either "generation" or "subtree".',
      400,
      { mode },
    );
  }
}

function createIdentityTracker({
  sourceMessageIds,
  conversationId,
  destinationMessageId,
  graftId,
  idempotencyKey,
}) {
  return new Set([
    ...sourceMessageIds,
    conversationId,
    destinationMessageId,
    graftId,
    idempotencyKey,
  ]);
}

function claimGeneratedIdentity(identityRegistry, value, label, details = {}) {
  if (typeof value !== 'string' || value.length === 0 || identityRegistry.has(value)) {
    throw new GenerationGraftError(
      'INVALID_SOURCE',
      `Generated ${label} collided with an existing graft identity.`,
      400,
      {
        label,
        value,
        ...details,
      },
    );
  }

  identityRegistry.add(value);
  return value;
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new GenerationGraftError(
      'INVALID_SOURCE',
      'Clone plans require a non-empty parent-first message array.',
    );
  }

  const seenMessageIds = new Set();
  const normalizedMessages = messages.map((message) => stripMongoFields(message));

  normalizedMessages.forEach((message, index) => {
    const messageId = message?.messageId;
    if (typeof messageId !== 'string' || messageId.length === 0) {
      throw new GenerationGraftError(
        'INVALID_SOURCE',
        'Every copied message must include a unique messageId.',
      );
    }

    if (seenMessageIds.has(messageId)) {
      throw new GenerationGraftError(
        'INVALID_SOURCE',
        `Duplicate graft message id "${messageId}" detected.`,
        400,
        { messageId },
      );
    }

    if (index > 0 && !seenMessageIds.has(message.parentMessageId)) {
      throw new GenerationGraftError(
        'INVALID_SOURCE',
        'Messages must be parent-first and topological within the copied subtree.',
        400,
        { messageId, parentMessageId: message.parentMessageId },
      );
    }

    seenMessageIds.add(messageId);
  });

  return normalizedMessages;
}

function validateToolCalls(toolCalls, sourceToCopyMessageId) {
  if (toolCalls == null) {
    return [];
  }

  if (!Array.isArray(toolCalls)) {
    throw new GenerationGraftError('INVALID_SOURCE', 'Tool calls must be provided as an array.');
  }

  return toolCalls.map((toolCall) => {
    const normalizedToolCall = stripMongoFields(toolCall);
    if (
      typeof normalizedToolCall?.messageId !== 'string' ||
      !sourceToCopyMessageId.has(normalizedToolCall.messageId)
    ) {
      throw new GenerationGraftError(
        'INVALID_SOURCE',
        'Each graft tool call must belong to one of the copied messages.',
        400,
        { messageId: normalizedToolCall?.messageId },
      );
    }

    return normalizedToolCall;
  });
}

function buildBridgeText(sourceState, destinationState) {
  if (sourceState === 'complete' && destinationState === 'complete') {
    return GRAFT_BRIDGE_TEXT;
  }

  return `${GRAFT_BRIDGE_TEXT}\n\n${PARTIAL_GRAFT_WARNING}`;
}

function buildClonePlan({
  messages,
  toolCalls = [],
  conversationId,
  destinationMessageId,
  graftId,
  idempotencyKey,
  mode,
  sourceState,
  destinationState,
  userId,
  activeSourceLeafMessageId,
  uuid = randomUUID,
  now = new Date(),
}) {
  requireNonEmptyString(conversationId, 'conversationId');
  requireNonEmptyString(destinationMessageId, 'destinationMessageId');
  requireNonEmptyString(graftId, 'graftId');
  requireNonEmptyString(idempotencyKey, 'idempotencyKey');
  assertCloneMode(mode);
  assertStableState(sourceState, 'sourceState');
  assertStableState(destinationState, 'destinationState');

  const normalizedMessages = validateMessages(messages);
  const sourceRootMessageId = normalizedMessages[0].messageId;
  const sourceMessageIds = normalizedMessages.map((message) => message.messageId);
  const activeSourceMessageId = activeSourceLeafMessageId ?? sourceRootMessageId;
  const identityRegistry = createIdentityTracker({
    sourceMessageIds,
    conversationId,
    destinationMessageId,
    graftId,
    idempotencyKey,
  });

  if (!sourceMessageIds.includes(activeSourceMessageId)) {
    throw new GenerationGraftError(
      'INVALID_SOURCE',
      'The active source leaf must belong to the copied subtree.',
      400,
      { activeSourceLeafMessageId: activeSourceMessageId },
    );
  }

  const bridgeMessageId = claimGeneratedIdentity(identityRegistry, uuid(), 'bridgeMessageId');
  const sourceToCopyMessageId = new Map();

  for (const message of normalizedMessages) {
    sourceToCopyMessageId.set(
      message.messageId,
      claimGeneratedIdentity(identityRegistry, uuid(), 'copiedMessageId', {
        sourceMessageId: message.messageId,
      }),
    );
  }

  const copiedRootMessageId = sourceToCopyMessageId.get(sourceRootMessageId);
  const activeCopiedMessageId = sourceToCopyMessageId.get(activeSourceMessageId);
  const copiedMessageIds = sourceMessageIds.map((messageId) => sourceToCopyMessageId.get(messageId));
  const timestampBase = resolveNow(now);
  const nestedGraftIds = new Map();
  const nestedIdempotencyKeys = new Map();

  const bridge = {
    messageId: bridgeMessageId,
    conversationId,
    parentMessageId: destinationMessageId,
    isCreatedByUser: true,
    sender: 'Graft',
    text: buildBridgeText(sourceState, destinationState),
    unfinished: false,
    error: false,
    user: userId,
    createdAt: timestampBase,
    updatedAt: timestampBase,
    metadata: {
      generationGraft: {
        kind: 'generation_graft',
        graftId,
        idempotencyKey,
        sourceConversationId: conversationId,
        sourceRootMessageId,
        sourceMessageIds,
        destinationConversationId: conversationId,
        destinationMessageId,
        copiedRootMessageId,
        copiedMessageIds,
        activeCopiedMessageId,
        mode,
        sourceState,
        destinationState,
        createdAt: timestampBase.toISOString(),
      },
    },
  };

  const copiedMessages = normalizedMessages.map((message, index) => {
    const copiedMessageId = sourceToCopyMessageId.get(message.messageId);
    const copiedParentMessageId =
      index === 0 ? bridgeMessageId : sourceToCopyMessageId.get(message.parentMessageId);
    const timestamp = new Date(timestampBase.getTime() + index + 1);

    const remappedMessage = remapNestedGraftMetadata(message, {
      sourceToCopyMessageId,
      nestedGraftIds,
      nestedIdempotencyKeys,
      uuid,
      claimGeneratedIdentity: (value, label, details) =>
        claimGeneratedIdentity(identityRegistry, value, label, details),
    });
    const metadata =
      remappedMessage.metadata != null &&
      typeof remappedMessage.metadata === 'object' &&
      !Array.isArray(remappedMessage.metadata)
        ? { ...remappedMessage.metadata }
        : {};

    const files = Array.isArray(remappedMessage.files)
      ? remapEmbeddedMessageIds(remappedMessage.files, sourceToCopyMessageId)
      : remappedMessage.files;
    const attachments = Array.isArray(remappedMessage.attachments)
      ? remapEmbeddedMessageIds(remappedMessage.attachments, sourceToCopyMessageId)
      : remappedMessage.attachments;

    metadata.generationGraftCopy = {
      kind: 'generation_graft_copy',
      graftId,
      clonedFromMessageId: message.messageId,
    };

    return {
      ...remappedMessage,
      messageId: copiedMessageId,
      conversationId,
      parentMessageId: copiedParentMessageId,
      files,
      attachments,
      user: userId,
      createdAt: timestamp,
      updatedAt: timestamp,
      metadata,
    };
  });

  const clonedToolCalls = validateToolCalls(toolCalls, sourceToCopyMessageId).map((toolCall) => ({
    ...toolCall,
    attachments: Array.isArray(toolCall.attachments)
      ? remapEmbeddedMessageIds(toolCall.attachments, sourceToCopyMessageId)
      : toolCall.attachments,
    conversationId,
    messageId: sourceToCopyMessageId.get(toolCall.messageId),
    user: userId,
  }));

  return {
    bridgeMessageId,
    copiedRootMessageId,
    activeCopiedMessageId,
    copiedMessageIds,
    messages: [bridge, ...copiedMessages],
    toolCalls: clonedToolCalls,
  };
}

module.exports = {
  buildClonePlan,
  stripMongoFields,
  remapEmbeddedMessageIds,
  remapNestedGraftMetadata,
};
