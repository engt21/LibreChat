const express = require('express');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const {
  listSchedulesController,
  createScheduleController,
  updateScheduleController,
  deleteScheduleController,
  runScheduleController,
  getNotificationSettingsController,
  updateNotificationSettingsController,
  subscribePushController,
  unsubscribePushController,
} = require('~/server/controllers/ScheduledJobsController');

const router = express.Router();

router.use(requireJwtAuth);

router.get('/notifications', getNotificationSettingsController);
router.put('/notifications', updateNotificationSettingsController);
router.post('/notifications/push/subscribe', subscribePushController);
router.post('/notifications/push/unsubscribe', unsubscribePushController);

router.get('/', listSchedulesController);
router.post('/', createScheduleController);
router.patch('/:scheduleId', updateScheduleController);
router.delete('/:scheduleId', deleteScheduleController);
router.post('/:scheduleId/run', runScheduleController);

module.exports = router;
