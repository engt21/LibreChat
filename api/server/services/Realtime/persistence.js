const { createImportBatchBuilder } = require('~/server/utils/import/importBatchBuilder');
const { v4: uuidv4 } = require('uuid');
const { Constants } = require('librechat-data-provider');
const { getConvo, saveConvo, saveMessage } = require('~/models');

const MAX_REALTIME_TITLE_LENGTH = 80;

function normalizeRealtimeEntries(entries = []) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .filter((entry) => entry?.role === 'user' || entry?.role === 'assistant')
    .map((entry) => ({
      role: entry.role,
      source: entry.source === 'text' ? 'text' : 'voice',
      text: typeof entry.text === 'string' ? entry.text.replace(/\s+/g, ' ').trim() : '',
    }))
    .filter((entry) => entry.text.length > 0);
}

function buildRealtimeConversationTitle(entries, model) {
  const firstUserEntry = entries.find((entry) => entry.role === 'user');
  const fallbackEntry = firstUserEntry ?? entries[0];
  const seedTitle = fallbackEntry?.text || model || 'Realtime Voice Chat';

  return seedTitle.length > MAX_REALTIME_TITLE_LENGTH
    ? `${seedTitle.slice(0, MAX_REALTIME_TITLE_LENGTH - 1).trimEnd()}…`
    : seedTitle;
}

async function appendRealtimeEntries({
  userId,
  conversationId,
  parentMessageId,
  endpoint,
  model,
  entries,
  endedAt,
}) {
  const conversation = await getConvo(userId, conversationId);
  if (!conversation) {
    throw new Error('Realtime conversation could not be resumed because the chat was not found.');
  }

  const req = { user: { id: userId }, body: {} };
  let currentParentMessageId = parentMessageId || Constants.NO_PARENT;

  for (const entry of entries) {
    const messageId = uuidv4();
    await saveMessage(
      req,
      {
        messageId,
        conversationId,
        parentMessageId: currentParentMessageId,
        endpoint,
        model,
        sender: entry.role === 'user' ? 'user' : model,
        text: entry.text,
        isCreatedByUser: entry.role === 'user',
        unfinished: false,
        error: false,
        metadata: { realtime: true, source: entry.source },
      },
      { context: 'Realtime conversation append' },
    );
    currentParentMessageId = messageId;
  }

  return await saveConvo(
    req,
    {
      conversationId,
      title: conversation.title,
      endpoint: conversation.endpoint,
      model: conversation.model,
      updatedAt: endedAt ? new Date(endedAt) : new Date(),
    },
    { context: 'Realtime conversation append', noUpsert: true },
  );
}

async function saveRealtimeConversation({
  userId,
  conversationId,
  parentMessageId,
  endpoint,
  model,
  textModel,
  entries,
  startedAt,
  endedAt,
}) {
  const normalizedEntries = normalizeRealtimeEntries(entries);

  if (!userId) {
    throw new Error('Realtime conversation persistence requires an authenticated user.');
  }

  if (!endpoint) {
    throw new Error('Realtime conversation persistence requires an endpoint.');
  }

  if (!model) {
    throw new Error('Realtime conversation persistence requires a model.');
  }

  if (normalizedEntries.length === 0) {
    throw new Error('Realtime conversation persistence requires at least one transcript entry.');
  }

  if (conversationId && conversationId !== 'new') {
    return appendRealtimeEntries({
      userId,
      conversationId,
      parentMessageId,
      endpoint,
      model,
      entries: normalizedEntries,
      endedAt,
    });
  }

  const builder = createImportBatchBuilder(userId);
  const savedModel = textModel || model;
  builder.startConversation(endpoint);

  for (const entry of normalizedEntries) {
    if (entry.role === 'user') {
      builder.addUserMessage(entry.text);
      continue;
    }

    builder.addGptMessage(entry.text, savedModel, savedModel);
  }

  const createdAt = startedAt ? new Date(startedAt) : new Date();
  const updatedAt = endedAt ? new Date(endedAt) : new Date();
  const { conversation } = builder.finishConversation(
    buildRealtimeConversationTitle(normalizedEntries, model),
    createdAt,
    {
      endpoint,
      model: savedModel,
    },
  );

  conversation.updatedAt = updatedAt;

  await builder.saveBatch();

  return conversation;
}

module.exports = {
  MAX_REALTIME_TITLE_LENGTH,
  normalizeRealtimeEntries,
  buildRealtimeConversationTitle,
  saveRealtimeConversation,
  appendRealtimeEntries,
};
