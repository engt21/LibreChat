const express = require('express');
const { requireJwtAuth } = require('~/server/middleware');
const {
  realtimeModelsController,
  saveRealtimeConversationController,
} = require('~/server/controllers/RealtimeController');

const router = express.Router();

router.get('/models', requireJwtAuth, realtimeModelsController);
router.post('/conversation', requireJwtAuth, saveRealtimeConversationController);

module.exports = router;
