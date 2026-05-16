const express = require('express');
const {
  getImageModelsController,
  getImageGenerationPrefsController,
  updateImageGenerationPrefsController,
} = require('~/server/controllers/ImageGenerationController');
const { requireJwtAuth } = require('~/server/middleware');

const router = express.Router();

router.get('/models', requireJwtAuth, getImageModelsController);
router.get('/prefs', requireJwtAuth, getImageGenerationPrefsController);
router.patch('/prefs', requireJwtAuth, updateImageGenerationPrefsController);

module.exports = router;
