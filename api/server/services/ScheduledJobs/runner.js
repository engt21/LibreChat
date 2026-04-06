const crypto = require('node:crypto');
const { isEnabled } = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');
const { ScheduledJob, User } = require('~/db/models');
const { executeScheduledRun } = require('./execution');
const { sendScheduledRunNotifications } = require('./notifications');
const { getNextRunAt } = require('./cron');

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const RUNNER_ENABLED =
  process.env.SCHEDULED_RUNNER_ENABLED === undefined
    ? true
    : isEnabled(process.env.SCHEDULED_RUNNER_ENABLED);
const POLL_INTERVAL_MS = parsePositiveInt(process.env.SCHEDULED_RUNNER_POLL_INTERVAL_MS, 15000);
const LEASE_MS = parsePositiveInt(process.env.SCHEDULED_RUNNER_LEASE_MS, 300000);
const HEARTBEAT_MS = Math.min(
  parsePositiveInt(process.env.SCHEDULED_RUNNER_HEARTBEAT_MS, 30000),
  Math.max(10000, Math.floor(LEASE_MS / 2)),
);
const MAX_CONCURRENT_RUNS = parsePositiveInt(process.env.SCHEDULED_RUNNER_MAX_CONCURRENT, 2);
const RUNNER_ID = `scheduled-runner:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;

let pollHandle = null;
let tickPromise = null;
const activeRuns = new Map();

function createRunningUpdate(trigger) {
  const now = new Date();
  const currentRunId = crypto.randomUUID();
  return {
    currentRunId,
    now,
    update: {
      $set: {
        lastRunAt: now,
        lastStatus: 'running',
        lastTriggeredBy: trigger,
        lockUntil: new Date(now.getTime() + LEASE_MS),
        lockedBy: RUNNER_ID,
        currentRunId,
      },
      $unset: {
        lastError: '',
      },
      $inc: {
        runCount: 1,
      },
    },
  };
}

async function claimNextDueSchedule() {
  const now = new Date();
  const runningUpdate = createRunningUpdate('scheduler');

  return await ScheduledJob.findOneAndUpdate(
    {
      enabled: true,
      nextRunAt: { $lte: now },
      $or: [{ lockUntil: null }, { lockUntil: { $lte: now } }],
    },
    runningUpdate.update,
    {
      new: true,
      sort: { nextRunAt: 1, createdAt: 1 },
    },
  ).lean();
}

async function claimScheduleForManualRun(userId, scheduleId) {
  const runningUpdate = createRunningUpdate('manual');

  return await ScheduledJob.findOneAndUpdate(
    {
      user: userId,
      scheduleId,
      $or: [{ lockUntil: null }, { lockUntil: { $lte: new Date() } }],
    },
    runningUpdate.update,
    {
      new: true,
    },
  ).lean();
}

function startHeartbeat(scheduleId, currentRunId) {
  const handle = setInterval(() => {
    ScheduledJob.updateOne(
      { scheduleId, currentRunId, lockedBy: RUNNER_ID },
      {
        $set: {
          lockUntil: new Date(Date.now() + LEASE_MS),
        },
      },
    ).catch((error) => {
      logger.error('[ScheduledJobs] Failed to refresh run lease', error);
    });
  }, HEARTBEAT_MS);

  handle.unref?.();
  return handle;
}

async function getScheduleUser(userId) {
  return await User.findById(userId)
    .select('name username email provider role modelPermissions')
    .lean();
}

async function finalizeScheduleRun(schedule, trigger, executionResult, error, notificationResults) {
  const completedAt = new Date();
  const startedAt = schedule.lastRunAt ? new Date(schedule.lastRunAt) : completedAt;
  const shouldAdvanceSchedule =
    trigger === 'scheduler' ||
    (schedule.enabled && schedule.nextRunAt && new Date(schedule.nextRunAt) <= startedAt);

  const nextRunAt = shouldAdvanceSchedule
    ? getNextRunAt(schedule.cron, schedule.timezone, completedAt)
    : schedule.nextRunAt;

  const update = {
    $set: {
      nextRunAt,
      lastFinishedAt: completedAt,
      lastStatus: error ? 'failed' : 'succeeded',
      lastConversationId: executionResult?.conversationId ?? null,
      lastResponseMessageId: executionResult?.responseMessageId ?? null,
      lastResponsePreview: executionResult?.preview ?? (error?.message || null),
      lastNotificationResults: notificationResults ?? {},
    },
    $unset: {
      lockUntil: '',
      lockedBy: '',
      currentRunId: '',
    },
  };

  if (error) {
    update.$set.lastError = error.message;
    update.$inc = { failureCount: 1 };
  } else {
    update.$unset.lastError = '';
  }

  return await ScheduledJob.findOneAndUpdate(
    { scheduleId: schedule.scheduleId, currentRunId: schedule.currentRunId },
    update,
    { new: true },
  ).lean();
}

async function runClaimedSchedule(schedule, trigger = 'scheduler') {
  const heartbeat = startHeartbeat(schedule.scheduleId, schedule.currentRunId);
  let executionResult = null;
  let executionError = null;
  let notificationResults = {};

  try {
    const user = await getScheduleUser(schedule.user);
    if (!user) {
      throw new Error('User not found for scheduled run');
    }

    executionResult = await executeScheduledRun(schedule, user);
  } catch (error) {
    executionError = error;
  }

  try {
    notificationResults = await sendScheduledRunNotifications({
      userId: schedule.user,
      schedule,
      result: {
        conversationId: executionResult?.conversationId ?? null,
        preview: executionResult?.preview ?? '',
        error: executionError?.message ?? null,
      },
    });
  } catch (notificationError) {
    logger.error('[ScheduledJobs] Failed to send notifications', notificationError);
    notificationResults = {
      system: {
        status: 'failed',
        reason: notificationError.message,
      },
    };
  }

  clearInterval(heartbeat);

  const updatedSchedule = await finalizeScheduleRun(
    schedule,
    trigger,
    executionResult,
    executionError,
    notificationResults,
  );

  if (executionError) {
    throw Object.assign(executionError, {
      schedule: updatedSchedule,
      notificationResults,
      executionResult,
    });
  }

  return {
    schedule: updatedSchedule,
    notificationResults,
    executionResult,
  };
}

async function tickScheduledJobs() {
  if (!RUNNER_ENABLED) {
    return;
  }

  if (tickPromise) {
    return tickPromise;
  }

  tickPromise = (async () => {
    while (activeRuns.size < MAX_CONCURRENT_RUNS) {
      const schedule = await claimNextDueSchedule();
      if (!schedule) {
        break;
      }

      const runPromise = runClaimedSchedule(schedule, 'scheduler')
        .catch((error) => {
          logger.error('[ScheduledJobs] Scheduled run failed', error);
        })
        .finally(() => {
          activeRuns.delete(schedule.scheduleId);
        });

      activeRuns.set(schedule.scheduleId, runPromise);
    }
  })().finally(() => {
    tickPromise = null;
  });

  return tickPromise;
}

function startScheduledJobRunner() {
  if (!RUNNER_ENABLED) {
    logger.info('[ScheduledJobs] Scheduler disabled by configuration');
    return false;
  }

  if (pollHandle) {
    return true;
  }

  logger.info(
    `[ScheduledJobs] Starting scheduler runner ${RUNNER_ID} (poll=${POLL_INTERVAL_MS}ms, lease=${LEASE_MS}ms, maxConcurrent=${MAX_CONCURRENT_RUNS})`,
  );

  pollHandle = setInterval(() => {
    tickScheduledJobs().catch((error) => {
      logger.error('[ScheduledJobs] Scheduler tick failed', error);
    });
  }, POLL_INTERVAL_MS);
  pollHandle.unref?.();

  tickScheduledJobs().catch((error) => {
    logger.error('[ScheduledJobs] Initial scheduler tick failed', error);
  });

  return true;
}

function stopScheduledJobRunner() {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
}

async function runScheduledJobNow(userId, scheduleId) {
  const existing = await ScheduledJob.findOne({ user: userId, scheduleId }).lean();
  if (!existing) {
    return null;
  }

  const claimed = await claimScheduleForManualRun(userId, scheduleId);
  if (!claimed) {
    const error = new Error('Scheduled run is already in progress');
    error.code = 'SCHEDULE_RUNNING';
    throw error;
  }

  return await runClaimedSchedule(claimed, 'manual');
}

module.exports = {
  RUNNER_ID,
  startScheduledJobRunner,
  stopScheduledJobRunner,
  runScheduledJobNow,
  tickScheduledJobs,
};
