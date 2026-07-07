const { GenerationJobManager } = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');
const { CacheKeys } = require('librechat-data-provider');
const getLogStores = require('~/cache/getLogStores');

const ASSISTANT_RUN_SETTLING_VALUE = 'cancelled';
const ASSISTANT_RUN_COMPLETED_VALUE = 'completed';
const DELETE_RETRY_ATTEMPTS = 3;
const COMPLETION_TOMBSTONE_TTL_MS = 60 * 1000;

function encodeAssistantRunValue(threadId, runId, responseMessageId) {
  return [threadId, runId, responseMessageId].filter(Boolean).join(':');
}

function parseAssistantRunValue(value) {
  if (!value) {
    return null;
  }

  if (value === ASSISTANT_RUN_SETTLING_VALUE) {
    return {
      threadId: null,
      runId: null,
      responseMessageId: null,
      settling: true,
      completed: false,
    };
  }

  if (value === ASSISTANT_RUN_COMPLETED_VALUE) {
    return {
      threadId: null,
      runId: null,
      responseMessageId: null,
      settling: false,
      completed: true,
    };
  }

  const [threadId, runId, ...rest] = String(value).split(':');
  if (!threadId || !runId) {
    return null;
  }

  return {
    threadId,
    runId,
    responseMessageId: rest.length > 0 ? rest.join(':') || null : null,
    settling: false,
    completed: false,
  };
}

async function getActiveGenerationState({
  userId,
  conversationId,
  preloadedResumableJob,
  generationJobManager = GenerationJobManager,
  getLogStores: getStores = getLogStores,
}) {
  const job =
    preloadedResumableJob !== undefined
      ? preloadedResumableJob
      : await generationJobManager.getJob(conversationId);
  const jobOwnerId = job?.userId ?? job?.metadata?.userId ?? null;
  const responseMessageId = job?.responseMessageId ?? job?.metadata?.responseMessageId ?? null;

  if (job?.status === 'running' && (!jobOwnerId || jobOwnerId === userId)) {
    return {
      active: true,
      provider: 'resumable',
      responseMessageId,
    };
  }

  const cache = getStores(CacheKeys.ABORT_KEYS);
  const run = parseAssistantRunValue(await cache?.get?.(`${userId}:${conversationId}`));
  if (run?.completed) {
    return {
      active: false,
      provider: null,
      responseMessageId: null,
    };
  }

  if (run) {
    return {
      active: true,
      provider: 'assistants',
      responseMessageId: run.responseMessageId,
    };
  }

  return {
    active: false,
    provider: null,
    responseMessageId: null,
  };
}

async function clearAssistantRunMarker({
  cache,
  cacheKey,
  responseMessageId = null,
  logPrefix = '[/assistants/chat/]',
  logContext = {},
  deleteRetryAttempts = DELETE_RETRY_ATTEMPTS,
  tombstoneTtlMs = COMPLETION_TOMBSTONE_TTL_MS,
  logger: activeLogger = logger,
}) {
  let lastDeleteError;
  for (let attempt = 1; attempt <= deleteRetryAttempts; attempt++) {
    try {
      await cache.delete(cacheKey);
      return {
        cleared: true,
        tombstoned: false,
        failed: false,
      };
    } catch (error) {
      lastDeleteError = error;
    }
  }

  activeLogger.error(`${logPrefix} Failed to delete active generation marker`, {
    ...logContext,
    cacheKey,
    responseMessageId,
    attempts: deleteRetryAttempts,
    error: lastDeleteError,
  });

  try {
    await cache.set(cacheKey, ASSISTANT_RUN_COMPLETED_VALUE, tombstoneTtlMs);
    return {
      cleared: false,
      tombstoned: true,
      failed: false,
    };
  } catch (tombstoneError) {
    activeLogger.error(
      `${logPrefix} Failed to replace active generation marker with inactive tombstone`,
      {
        ...logContext,
        cacheKey,
        responseMessageId,
        ttlMs: tombstoneTtlMs,
        deleteError: lastDeleteError,
        error: tombstoneError,
      },
    );

    return {
      cleared: false,
      tombstoned: false,
      failed: true,
      error: tombstoneError,
    };
  }
}

module.exports = {
  ASSISTANT_RUN_SETTLING_VALUE,
  ASSISTANT_RUN_COMPLETED_VALUE,
  encodeAssistantRunValue,
  parseAssistantRunValue,
  getActiveGenerationState,
  clearAssistantRunMarker,
};
