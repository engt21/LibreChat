const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('@librechat/data-schemas');
const { ContentTypes } = require('librechat-data-provider');
const { unescapeLaTeX, countTokens } = require('@librechat/api');
const {
  saveConvo,
  getMessage,
  saveMessage,
  getMessages,
  updateMessage,
  deleteMessages,
  deleteMessageBranch,
} = require('~/models');
const { findAllArtifacts, replaceArtifactContent } = require('~/server/services/Artifacts/update');
const { requireJwtAuth, validateMessageReq, createGraftLimiters } = require('~/server/middleware');
const { getConvosQueried } = require('~/models/Conversation');
const { Message, ToolCall } = require('~/db/models');
const { getTransactions } = require('~/models/Transaction');

const {
  previewGenerationGraft,
  createGenerationGraft,
  getGenerationGraft,
  undoGenerationGraft,
} = require('~/server/services/MessageGrafts');
const { MAX_GRAFT_MESSAGES } = require('~/server/services/MessageGrafts/constants');

const router = express.Router();
router.use(requireJwtAuth);

function requireFunction(name, value) {
  if (typeof value !== 'function') {
    throw new TypeError(`messages router requires ${name} to be a function`);
  }

  return value;
}

const {
  graftPreviewIpLimiter,
  graftPreviewUserLimiter,
  graftMutationIpLimiter,
  graftMutationUserLimiter,
} = requireFunction('createGraftLimiters', createGraftLimiters)();

requireFunction('previewGenerationGraft', previewGenerationGraft);
requireFunction('createGenerationGraft', createGenerationGraft);
requireFunction('getGenerationGraft', getGenerationGraft);
requireFunction('undoGenerationGraft', undoGenerationGraft);

function sanitizeMessageIdArray(values, maxItems = MAX_GRAFT_MESSAGES) {
  if (!Array.isArray(values)) {
    return undefined;
  }

  const sanitizedValues = [];
  const seenValues = new Set();

  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }

    const trimmedValue = value.trim();
    if (trimmedValue.length === 0 || seenValues.has(trimmedValue)) {
      continue;
    }

    seenValues.add(trimmedValue);
    sanitizedValues.push(trimmedValue);

    if (sanitizedValues.length >= maxItems) {
      break;
    }
  }

  return sanitizedValues.length > 0 ? sanitizedValues : undefined;
}

function sendGraftError(res, error) {
  const statusCode = error?.statusCode ?? 500;

  if (statusCode === 500) {
    return res.status(statusCode).json({ error: 'Internal server error' });
  }

  return res.status(statusCode).json({
    error: error.message,
    code: error.code,
    activeMessageIds: error.activeMessageIds,
    conversationActiveWithoutMessageId: error.conversationActiveWithoutMessageId === true,
    continuationMessageIds: sanitizeMessageIdArray(error.continuationMessageIds),
  });
}

router.get('/', async (req, res) => {
  try {
    const user = req.user.id ?? '';
    const {
      cursor = null,
      sortBy = 'updatedAt',
      sortDirection = 'desc',
      pageSize: pageSizeRaw,
      conversationId,
      messageId,
      search,
    } = req.query;
    const pageSize = parseInt(pageSizeRaw, 10) || 25;

    let response;
    const sortField = ['endpoint', 'createdAt', 'updatedAt'].includes(sortBy)
      ? sortBy
      : 'createdAt';
    const sortOrder = sortDirection === 'asc' ? 1 : -1;

    if (conversationId && messageId) {
      const message = await Message.findOne({
        conversationId,
        messageId,
        user: user,
      }).lean();
      response = { messages: message ? [message] : [], nextCursor: null };
    } else if (conversationId) {
      const filter = { conversationId, user: user };
      if (cursor) {
        filter[sortField] = sortOrder === 1 ? { $gt: cursor } : { $lt: cursor };
      }
      const messages = await Message.find(filter)
        .sort({ [sortField]: sortOrder })
        .limit(pageSize + 1)
        .lean();
      let nextCursor = null;
      if (messages.length > pageSize) {
        messages.pop(); // Remove extra item used to detect next page
        // Create cursor from the last RETURNED item (not the popped one)
        nextCursor = messages[messages.length - 1][sortField];
      }
      response = { messages, nextCursor };
    } else if (search) {
      const searchResults = await Message.meiliSearch(search, { filter: `user = "${user}"` }, true);

      const messages = searchResults.hits || [];

      const result = await getConvosQueried(req.user.id, messages, cursor);

      const messageIds = [];
      const cleanedMessages = [];
      for (let i = 0; i < messages.length; i++) {
        let message = messages[i];
        if (result.convoMap[message.conversationId]) {
          messageIds.push(message.messageId);
          cleanedMessages.push(message);
        }
      }

      const dbMessages = await getMessages({
        user,
        messageId: { $in: messageIds },
      });

      const dbMessageMap = {};
      for (const dbMessage of dbMessages) {
        dbMessageMap[dbMessage.messageId] = dbMessage;
      }

      const activeMessages = [];
      for (const message of cleanedMessages) {
        const convo = result.convoMap[message.conversationId];
        const dbMessage = dbMessageMap[message.messageId];

        activeMessages.push({
          ...message,
          title: convo.title,
          conversationId: message.conversationId,
          model: convo.model,
          isCreatedByUser: dbMessage?.isCreatedByUser,
          endpoint: dbMessage?.endpoint,
          iconURL: dbMessage?.iconURL,
        });
      }

      response = { messages: activeMessages, nextCursor: null };
    } else {
      response = { messages: [], nextCursor: null };
    }

    res.status(200).json(response);
  } catch (error) {
    logger.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Creates a new branch message from a specific agent's content within a parallel response message.
 * Filters the original message's content to only include parts attributed to the specified agentId.
 * Only available for non-user messages with content attributions.
 *
 * @route POST /branch
 * @param {string} req.body.messageId - The ID of the source message
 * @param {string} req.body.agentId - The agentId to filter content by
 * @returns {TMessage} The newly created branch message
 */
router.post('/branch', async (req, res) => {
  try {
    const { messageId, agentId } = req.body;
    const userId = req.user.id;

    if (!messageId || !agentId) {
      return res.status(400).json({ error: 'messageId and agentId are required' });
    }

    const sourceMessage = await getMessage({ user: userId, messageId });
    if (!sourceMessage) {
      return res.status(404).json({ error: 'Source message not found' });
    }

    if (sourceMessage.isCreatedByUser) {
      return res.status(400).json({ error: 'Cannot branch from user messages' });
    }

    if (!Array.isArray(sourceMessage.content)) {
      return res.status(400).json({ error: 'Message does not have content' });
    }

    const hasAgentMetadata = sourceMessage.content.some((part) => part?.agentId);
    if (!hasAgentMetadata) {
      return res
        .status(400)
        .json({ error: 'Message does not have parallel content with attributions' });
    }

    /** @type {Array<import('librechat-data-provider').TMessageContentParts>} */
    const filteredContent = [];
    for (const part of sourceMessage.content) {
      if (part?.agentId === agentId) {
        const { agentId: _a, groupId: _g, ...cleanPart } = part;
        filteredContent.push(cleanPart);
      }
    }

    if (filteredContent.length === 0) {
      return res.status(400).json({ error: 'No content found for the specified agentId' });
    }

    const newMessageId = uuidv4();
    /** @type {import('librechat-data-provider').TMessage} */
    const newMessage = {
      messageId: newMessageId,
      conversationId: sourceMessage.conversationId,
      parentMessageId: sourceMessage.parentMessageId,
      attachments: sourceMessage.attachments,
      isCreatedByUser: false,
      model: sourceMessage.model,
      endpoint: sourceMessage.endpoint,
      sender: sourceMessage.sender,
      iconURL: sourceMessage.iconURL,
      content: filteredContent,
      unfinished: false,
      error: false,
      user: userId,
    };

    const savedMessage = await saveMessage(req, newMessage, {
      context: 'POST /api/messages/branch',
    });

    if (!savedMessage) {
      return res.status(500).json({ error: 'Failed to save branch message' });
    }

    res.status(201).json(savedMessage);
  } catch (error) {
    logger.error('Error creating branch message:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/artifact/:messageId', async (req, res) => {
  try {
    const { messageId } = req.params;
    const { index, original, updated } = req.body;

    if (typeof index !== 'number' || index < 0 || original == null || updated == null) {
      return res.status(400).json({ error: 'Invalid request parameters' });
    }

    const message = await getMessage({ user: req.user.id, messageId });
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const artifacts = findAllArtifacts(message);
    if (index >= artifacts.length) {
      return res.status(400).json({ error: 'Artifact index out of bounds' });
    }

    // Unescape LaTeX preprocessing done by the frontend
    // The frontend escapes $ signs for display, but the database has unescaped versions
    const unescapedOriginal = unescapeLaTeX(original);
    const unescapedUpdated = unescapeLaTeX(updated);

    const targetArtifact = artifacts[index];
    let updatedText = null;

    if (targetArtifact.source === 'content') {
      const part = message.content[targetArtifact.partIndex];
      updatedText = replaceArtifactContent(
        part.text,
        targetArtifact,
        unescapedOriginal,
        unescapedUpdated,
      );
      if (updatedText) {
        part.text = updatedText;
      }
    } else {
      updatedText = replaceArtifactContent(
        message.text,
        targetArtifact,
        unescapedOriginal,
        unescapedUpdated,
      );
      if (updatedText) {
        message.text = updatedText;
      }
    }

    if (!updatedText) {
      return res.status(400).json({ error: 'Original content not found in target artifact' });
    }

    const savedMessage = await saveMessage(
      req,
      {
        messageId,
        conversationId: message.conversationId,
        text: message.text,
        content: message.content,
        user: req.user.id,
      },
      { context: 'POST /api/messages/artifact/:messageId' },
    );

    res.status(200).json({
      conversationId: savedMessage.conversationId,
      content: savedMessage.content,
      text: savedMessage.text,
    });
  } catch (error) {
    logger.error('Error editing artifact:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* Note: It's necessary to add `validateMessageReq` within route definition for correct params */

function absoluteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.abs(number) : 0;
}

function estimateMessageTokens(message) {
  if (Number.isFinite(message?.tokenCount)) {
    return Math.max(Number(message.tokenCount), 0);
  }

  const text = typeof message?.text === 'string' ? message.text : '';
  return text ? Math.ceil(text.length / 4) : 0;
}

function collectToolCallCounts(content) {
  const counts = new Map();
  let anonymousCount = 0;

  const increment = (key) => counts.set(key, (counts.get(key) ?? 0) + 1);
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }

    if (value.type === ContentTypes.TOOL_CALL || value.type === 'tool_calls') {
      const name =
        value.tool_call?.function?.name ??
        value.tool_call?.name ??
        value.function?.name ??
        value.name;
      const id = value.tool_call_id ?? value.toolCallId ?? value.id ?? value.tool_call?.id;
      if (name) {
        increment(`name:${name}`);
      } else if (id) {
        increment(`id:${id}`);
      } else {
        anonymousCount += 1;
      }
    }

    Object.values(value).forEach(visit);
  };

  visit(content);
  if (anonymousCount > 0) {
    counts.set('anonymous', anonymousCount);
  }
  return counts;
}

function mergeToolCallCounts(embeddedCounts, persistedCounts) {
  const keys = new Set([...embeddedCounts.keys(), ...persistedCounts.keys()]);
  let total = 0;
  for (const key of keys) {
    total += Math.max(embeddedCounts.get(key) ?? 0, persistedCounts.get(key) ?? 0);
  }
  return total;
}

router.post(
  '/:conversationId/grafts/preview',
  graftPreviewIpLimiter,
  graftPreviewUserLimiter,
  async (req, res) => {
    try {
      const result = await previewGenerationGraft({
        userId: req.user.id,
        conversationId: req.params.conversationId,
        payload: req.body ?? {},
      });

      res.status(200).json(result);
    } catch (error) {
      logger.error('Error previewing generation graft:', error);
      sendGraftError(res, error);
    }
  },
);

router.post(
  '/:conversationId/grafts',
  graftMutationIpLimiter,
  graftMutationUserLimiter,
  async (req, res) => {
    try {
      const result = await createGenerationGraft({
        userId: req.user.id,
        conversationId: req.params.conversationId,
        payload: req.body ?? {},
      });

      res.status(201).json(result);
    } catch (error) {
      logger.error('Error creating generation graft:', error);
      sendGraftError(res, error);
    }
  },
);

router.get('/:conversationId/grafts/:graftId', async (req, res) => {
  try {
    const result = await getGenerationGraft({
      userId: req.user.id,
      conversationId: req.params.conversationId,
      graftId: req.params.graftId,
    });

    res.status(200).json(result);
  } catch (error) {
    sendGraftError(res, error);
  }
});

router.delete(
  '/:conversationId/grafts/:graftId',
  graftMutationIpLimiter,
  graftMutationUserLimiter,
  async (req, res) => {
    try {
      const result = await undoGenerationGraft({
        userId: req.user.id,
        conversationId: req.params.conversationId,
        graftId: req.params.graftId,
        includeContinuations: req.body?.includeContinuations === true,
      });

      res.status(200).json(result);
    } catch (error) {
      sendGraftError(res, error);
    }
  },
);

router.post('/:conversationId/usage', validateMessageReq, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const requestedIds = Array.isArray(req.body?.messageIds)
      ? [...new Set(req.body.messageIds.filter((id) => typeof id === 'string' && id))]
      : [];

    const messageFilter = { conversationId, user: req.user.id };
    if (requestedIds.length > 0) {
      messageFilter.messageId = { $in: requestedIds };
    }

    const messages = await Message.find(messageFilter).sort({ createdAt: 1 }).lean();
    const visibleIds = messages.map((message) => message.messageId);
    const transactions =
      visibleIds.length > 0
        ? await getTransactions({
            user: req.user.id,
            conversationId,
            messageId: { $in: visibleIds },
          })
        : [];
    const persistedToolCalls =
      visibleIds.length > 0
        ? await ToolCall.find({
            user: req.user.id,
            conversationId,
            messageId: { $in: visibleIds },
          }).lean()
        : [];
    const persistedToolCountsByMessage = new Map();
    for (const toolCall of persistedToolCalls) {
      if (!toolCall.messageId) {
        continue;
      }
      const counts = persistedToolCountsByMessage.get(toolCall.messageId) ?? new Map();
      const key = toolCall.toolId ? `name:${toolCall.toolId}` : 'anonymous';
      counts.set(key, (counts.get(key) ?? 0) + 1);
      persistedToolCountsByMessage.set(toolCall.messageId, counts);
    }

    const usageByMessage = new Map();
    for (const transaction of transactions) {
      if (!transaction.messageId) {
        continue;
      }
      const usage = usageByMessage.get(transaction.messageId) ?? {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      };

      if (transaction.tokenType === 'prompt') {
        if (
          transaction.inputTokens != null ||
          transaction.readTokens != null ||
          transaction.writeTokens != null
        ) {
          usage.inputTokens += absoluteNumber(transaction.inputTokens);
          usage.cacheReadTokens += absoluteNumber(transaction.readTokens);
          usage.cacheWriteTokens += absoluteNumber(transaction.writeTokens);
        } else {
          usage.inputTokens += absoluteNumber(transaction.rawAmount);
        }
      } else if (transaction.tokenType === 'completion') {
        usage.outputTokens += absoluteNumber(transaction.rawAmount);
      }

      usageByMessage.set(transaction.messageId, usage);
    }

    let priorVisibleTokens = 0;
    const turns = [];
    for (const message of messages) {
      const estimatedMessageTokens = estimateMessageTokens(message);
      if (message.isCreatedByUser) {
        priorVisibleTokens += estimatedMessageTokens;
        continue;
      }

      const recorded = usageByMessage.get(message.messageId);
      turns.push({
        messageId: message.messageId,
        createdAt: message.createdAt,
        model: message.model,
        endpoint: message.endpoint,
        inputTokens: recorded?.inputTokens ?? priorVisibleTokens,
        outputTokens: recorded?.outputTokens ?? estimatedMessageTokens,
        cacheReadTokens: recorded?.cacheReadTokens ?? 0,
        cacheWriteTokens: recorded?.cacheWriteTokens ?? 0,
        toolCalls: mergeToolCallCounts(
          collectToolCallCounts(message.content),
          persistedToolCountsByMessage.get(message.messageId) ?? new Map(),
        ),
        estimated: recorded == null,
      });
      priorVisibleTokens += estimatedMessageTokens;
    }

    const totals = turns.reduce(
      (total, turn) => ({
        inputTokens: total.inputTokens + turn.inputTokens,
        outputTokens: total.outputTokens + turn.outputTokens,
        cacheReadTokens: total.cacheReadTokens + turn.cacheReadTokens,
        cacheWriteTokens: total.cacheWriteTokens + turn.cacheWriteTokens,
        toolCalls: total.toolCalls + turn.toolCalls,
      }),
      { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, toolCalls: 0 },
    );

    res.status(200).json({ conversationId, totals, turns });
  } catch (error) {
    logger.error('Error fetching conversation usage:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:conversationId', validateMessageReq, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const messages = await getMessages({ conversationId }, '-_id -__v -user');
    res.status(200).json(messages);
  } catch (error) {
    logger.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:conversationId', validateMessageReq, async (req, res) => {
  try {
    const message = req.body;
    const savedMessage = await saveMessage(
      req,
      { ...message, user: req.user.id },
      { context: 'POST /api/messages/:conversationId' },
    );
    if (!savedMessage) {
      return res.status(400).json({ error: 'Message not saved' });
    }
    await saveConvo(req, savedMessage, { context: 'POST /api/messages/:conversationId' });
    res.status(201).json(savedMessage);
  } catch (error) {
    logger.error('Error saving message:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:conversationId/:messageId', validateMessageReq, async (req, res) => {
  try {
    const { conversationId, messageId } = req.params;
    const message = await getMessages({ conversationId, messageId }, '-_id -__v -user');
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }
    res.status(200).json(message);
  } catch (error) {
    logger.error('Error fetching message:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:conversationId/:messageId', validateMessageReq, async (req, res) => {
  try {
    const { conversationId, messageId } = req.params;
    const { text, index, model } = req.body;

    if (index === undefined) {
      const tokenCount = await countTokens(text, model);
      const result = await updateMessage(req, { messageId, text, tokenCount });
      return res.status(200).json(result);
    }

    if (typeof index !== 'number' || index < 0) {
      return res.status(400).json({ error: 'Invalid index' });
    }

    const message = (await getMessages({ conversationId, messageId }, 'content tokenCount'))?.[0];
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const existingContent = message.content;
    if (!Array.isArray(existingContent) || index >= existingContent.length) {
      return res.status(400).json({ error: 'Invalid index' });
    }

    const updatedContent = [...existingContent];
    if (!updatedContent[index]) {
      return res.status(400).json({ error: 'Content part not found' });
    }

    const currentPartType = updatedContent[index].type;
    if (currentPartType !== ContentTypes.TEXT && currentPartType !== ContentTypes.THINK) {
      return res.status(400).json({ error: 'Cannot update non-text content' });
    }

    const oldText = updatedContent[index][currentPartType];
    updatedContent[index] = { type: currentPartType, [currentPartType]: text };

    let tokenCount = message.tokenCount;
    if (tokenCount !== undefined) {
      const oldTokenCount = await countTokens(oldText, model);
      const newTokenCount = await countTokens(text, model);
      tokenCount = Math.max(0, tokenCount - oldTokenCount) + newTokenCount;
    }

    const result = await updateMessage(req, { messageId, content: updatedContent, tokenCount });
    return res.status(200).json(result);
  } catch (error) {
    logger.error('Error updating message:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:conversationId/:messageId/feedback', validateMessageReq, async (req, res) => {
  try {
    const { conversationId, messageId } = req.params;
    const { feedback } = req.body;

    const updatedMessage = await updateMessage(
      req,
      {
        messageId,
        feedback: feedback || null,
      },
      { context: 'updateFeedback' },
    );

    res.json({
      messageId,
      conversationId,
      feedback: updatedMessage.feedback,
    });
  } catch (error) {
    logger.error('Error updating message feedback:', error);
    res.status(500).json({ error: 'Failed to update feedback' });
  }
});

router.delete('/:conversationId/:messageId/branch', validateMessageReq, async (req, res) => {
  try {
    const result = await deleteMessageBranch(req, req.params);
    if (result.status === 'not_found') {
      return res.status(404).json({ error: 'Message not found' });
    }
    if (result.status === 'invalid_target') {
      return res.status(400).json({ error: 'User messages cannot be discarded as generations' });
    }
    res.status(200).json({ deletedCount: result.deletedCount });
  } catch (error) {
    logger.error('Error deleting message branch:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:conversationId/:messageId', validateMessageReq, async (req, res) => {
  try {
    const { conversationId, messageId } = req.params;
    await deleteMessages({ messageId, conversationId, user: req.user.id });
    res.status(204).send();
  } catch (error) {
    logger.error('Error deleting message:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
