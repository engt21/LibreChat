const { logger } = require('@librechat/data-schemas');
const { getAppConfig } = require('~/server/services/Config/app');
const { getRealtimeModelsResponse } = require('~/server/services/Realtime/modelService');
const { saveRealtimeConversation } = require('~/server/services/Realtime/persistence');

async function realtimeModelsController(req, res) {
  try {
    const appConfig = await getAppConfig({ role: req.user?.role });
    const response = await getRealtimeModelsResponse(req, appConfig);
    res.send(response);
  } catch (error) {
    logger.error('Error fetching realtime models:', error);
    res.status(500).send({ error: error.message });
  }
}

async function saveRealtimeConversationController(req, res) {
  try {
    const conversation = await saveRealtimeConversation({
      userId: req.user?.id,
      endpoint: req.body?.endpoint,
      model: req.body?.model,
      entries: req.body?.entries,
      startedAt: req.body?.startedAt,
      endedAt: req.body?.endedAt,
    });

    res.status(201).send(conversation);
  } catch (error) {
    logger.error('Error saving realtime conversation:', error);
    res.status(400).send({ error: error.message });
  }
}

module.exports = {
  realtimeModelsController,
  saveRealtimeConversationController,
};
