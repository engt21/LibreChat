const { logger } = require('@librechat/data-schemas');
const { clearAssistantRunMarker } = require('~/server/services/MessageGrafts/active');

async function finalizeAssistantCompletion({
  req,
  responseMessage,
  model,
  userMessagePromise,
  saveAssistantMessage,
  cache,
  cacheKey,
  onPersisted,
  afterPersist,
  logPrefix = '[/assistants/chat/]',
}) {
  if (userMessagePromise) {
    await userMessagePromise;
  }

  await saveAssistantMessage(req, { ...responseMessage, model });
  await onPersisted?.();
  await clearAssistantRunMarker({
    cache,
    cacheKey,
    responseMessageId: responseMessage?.messageId ?? null,
    logPrefix,
  });

  try {
    await afterPersist?.();
  } catch (error) {
    logger.error(`${logPrefix} Error finalizing completed run metadata`, error);
  }
}

module.exports = {
  finalizeAssistantCompletion,
};
