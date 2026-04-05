const { createImportBatchBuilder } = require('~/server/utils/import/importBatchBuilder');

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

async function saveRealtimeConversation({ userId, endpoint, model, entries, startedAt, endedAt }) {
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

  const builder = createImportBatchBuilder(userId);
  builder.startConversation(endpoint);

  for (const entry of normalizedEntries) {
    if (entry.role === 'user') {
      builder.addUserMessage(entry.text);
      continue;
    }

    builder.addGptMessage(entry.text, model, model);
  }

  const createdAt = startedAt ? new Date(startedAt) : new Date();
  const updatedAt = endedAt ? new Date(endedAt) : new Date();
  const { conversation } = builder.finishConversation(
    buildRealtimeConversationTitle(normalizedEntries, model),
    createdAt,
    {
      endpoint,
      model,
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
};
