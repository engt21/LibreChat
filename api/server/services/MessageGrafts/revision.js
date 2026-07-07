const crypto = require('crypto');

const { buildMessageGraph, getMessageId, normalizeParentMessageId } = require('./graph');

function normalizeUpdatedAt(updatedAt) {
  if (updatedAt == null) {
    return null;
  }

  const parsedDate = updatedAt instanceof Date ? updatedAt : new Date(updatedAt);
  if (Number.isNaN(parsedDate.getTime())) {
    return String(updatedAt);
  }

  return parsedDate.toISOString();
}

function normalizeFinishReason(message) {
  if (message?.finish_reason == null) {
    return null;
  }

  return String(message.finish_reason);
}

function normalizeActiveState(activeState = {}) {
  return {
    active: activeState?.active === true,
    responseMessageId: activeState?.responseMessageId ?? null,
  };
}

function computeTreeRevision(messages, activeState = {}) {
  const graph = buildMessageGraph(messages);
  const rows = graph.messages
    .map((message) => ({
      messageId: getMessageId(message),
      parentMessageId: normalizeParentMessageId(message),
      unfinished: message?.unfinished === true,
      error: message?.error === true,
      finish_reason: normalizeFinishReason(message),
      updatedAt: normalizeUpdatedAt(message?.updatedAt),
    }))
    .sort((left, right) => left.messageId.localeCompare(right.messageId));

  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        rows,
        activeState: normalizeActiveState(activeState),
      }),
    )
    .digest('hex');
}

module.exports = {
  computeTreeRevision,
  normalizeActiveState,
  normalizeFinishReason,
  normalizeUpdatedAt,
};
