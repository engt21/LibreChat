const { Constants } = require('librechat-data-provider');

const { GenerationGraftError } = require('./constants');

const ABORTED_FINISH_REASONS = new Set(['abort', 'aborted', 'cancelled', 'canceled']);

function getMessageId(message) {
  return message?.messageId ?? null;
}

function normalizeParentMessageId(message) {
  return message?.parentMessageId ?? Constants.NO_PARENT;
}

function assertGraph(graph) {
  if (!graph || !(graph.byId instanceof Map) || !(graph.childrenByParent instanceof Map)) {
    throw new GenerationGraftError('INVALID_SOURCE', 'The message graph is invalid.');
  }
}

function buildMessageGraph(messages) {
  if (!Array.isArray(messages)) {
    throw new GenerationGraftError('INVALID_SOURCE', 'Messages must be provided as an array.');
  }

  const byId = new Map();
  const childrenByParent = new Map();

  for (const message of messages) {
    const messageId = getMessageId(message);
    if (typeof messageId !== 'string' || messageId.length === 0) {
      throw new GenerationGraftError(
        'INVALID_SOURCE',
        'Every graft message must include a unique messageId.',
      );
    }

    if (byId.has(messageId)) {
      throw new GenerationGraftError(
        'INVALID_SOURCE',
        `Duplicate graft message id "${messageId}" detected.`,
        400,
        { messageId },
      );
    }

    byId.set(messageId, message);

    const parentMessageId = normalizeParentMessageId(message);
    const siblings = childrenByParent.get(parentMessageId) ?? [];
    siblings.push(messageId);
    childrenByParent.set(parentMessageId, siblings);
  }

  return {
    messages,
    byId,
    childrenByParent,
  };
}

function getRequiredMessage(graph, messageId) {
  assertGraph(graph);

  const message = graph.byId.get(messageId);
  if (!message) {
    throw new GenerationGraftError(
      'MESSAGE_NOT_FOUND',
      `Message "${messageId}" was not found in the graft graph.`,
      404,
      { messageId },
    );
  }

  return message;
}

function collectDescendantIds(graph, rootId) {
  getRequiredMessage(graph, rootId);

  const descendants = [rootId];
  const activePath = new Set([rootId]);

  const visit = (parentId) => {
    const children = graph.childrenByParent.get(parentId) ?? [];

    for (const childId of children) {
      if (activePath.has(childId)) {
        throw new GenerationGraftError(
          'INVALID_SOURCE',
          'A graft subtree cycle was detected.',
          400,
          { rootId, cycleMessageId: childId },
        );
      }

      descendants.push(childId);
      activePath.add(childId);
      visit(childId);
      activePath.delete(childId);
    }
  };

  visit(rootId);
  return descendants;
}

function collectAncestorIds(graph, messageId) {
  const message = getRequiredMessage(graph, messageId);
  const ancestors = [];
  const seen = new Set([messageId]);

  let parentMessageId = normalizeParentMessageId(message);
  while (parentMessageId && parentMessageId !== Constants.NO_PARENT) {
    if (seen.has(parentMessageId)) {
      throw new GenerationGraftError(
        'INVALID_SOURCE',
        'A graft ancestor cycle was detected.',
        400,
        { messageId, cycleMessageId: parentMessageId },
      );
    }

    const parentMessage = graph.byId.get(parentMessageId);
    if (!parentMessage) {
      break;
    }

    ancestors.push(parentMessageId);
    seen.add(parentMessageId);
    parentMessageId = normalizeParentMessageId(parentMessage);
  }

  return ancestors;
}

function classifyLifecycle(message, activeState = {}) {
  const messageId = getMessageId(message);
  const active = activeState?.active === true;
  const activeResponseMessageId = activeState?.responseMessageId ?? null;

  if (active && (activeResponseMessageId == null || activeResponseMessageId === messageId)) {
    return 'streaming';
  }

  if (message?.error === true) {
    return 'errored_partial';
  }

  if (message?.unfinished === true) {
    const generationTermination =
      typeof message?.metadata?.generationTermination === 'string'
        ? message.metadata.generationTermination.toLowerCase()
        : null;
    const finishReason =
      typeof message?.finish_reason === 'string' ? message.finish_reason.toLowerCase() : null;

    if (
      ABORTED_FINISH_REASONS.has(generationTermination) ||
      ABORTED_FINISH_REASONS.has(finishReason)
    ) {
      return 'aborted_partial';
    }

    return 'stopped_partial';
  }

  return 'complete';
}

function isAssistantMessage(message) {
  return message?.isCreatedByUser === false;
}

function hasBranchOverlap(graph, sourceMessageId, destinationMessageId) {
  if (sourceMessageId === destinationMessageId) {
    return true;
  }

  const sourceAncestors = collectAncestorIds(graph, sourceMessageId);
  if (sourceAncestors.includes(destinationMessageId)) {
    return true;
  }

  const destinationAncestors = collectAncestorIds(graph, destinationMessageId);
  return destinationAncestors.includes(sourceMessageId);
}

function validateSelection(graph, sourceMessageId, destinationMessageId) {
  const source = getRequiredMessage(graph, sourceMessageId);
  const destination = getRequiredMessage(graph, destinationMessageId);

  if (!isAssistantMessage(source)) {
    throw new GenerationGraftError(
      'INVALID_SOURCE',
      'The source graft message must be assistant-authored.',
      400,
      { sourceMessageId },
    );
  }

  if (!isAssistantMessage(destination)) {
    throw new GenerationGraftError(
      'INVALID_DESTINATION',
      'The destination graft message must be assistant-authored.',
      400,
      { destinationMessageId },
    );
  }

  if (sourceMessageId === destinationMessageId) {
    throw new GenerationGraftError(
      'INVALID_DESTINATION',
      'The source and destination graft messages must be different assistant messages.',
      400,
      { sourceMessageId, destinationMessageId },
    );
  }

  if (hasBranchOverlap(graph, sourceMessageId, destinationMessageId)) {
    throw new GenerationGraftError(
      'OVERLAPPING_BRANCHES',
      'The selected graft messages cannot be on the same ancestor or descendant branch.',
      400,
      { sourceMessageId, destinationMessageId },
    );
  }

  return { source, destination };
}

module.exports = {
  buildMessageGraph,
  classifyLifecycle,
  collectAncestorIds,
  collectDescendantIds,
  getMessageId,
  hasBranchOverlap,
  isAssistantMessage,
  normalizeParentMessageId,
  validateSelection,
};
