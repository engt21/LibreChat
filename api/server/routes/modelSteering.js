const express = require('express');
const {
  updateModelSteeringPrefsController,
} = require('~/server/controllers/ModelSteeringController');
const { requireJwtAuth } = require('~/server/middleware');

const router = express.Router();

router.patch('/prefs', requireJwtAuth, updateModelSteeringPrefsController);

module.exports = router;
