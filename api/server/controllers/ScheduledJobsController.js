const crypto = require('node:crypto');
const { WebSearchModes, isAgentsEndpoint } = require('librechat-data-provider');
const {
  createScheduledJob,
  getScheduledJob,
  getScheduledJobs,
  updateScheduledJob,
  deleteScheduledJob,
} = require('~/models');
const {
  getNextRunAt,
  validateSchedule,
  normalizeCronExpression,
} = require('~/server/services/ScheduledJobs/cron');
const { runScheduledJobNow } = require('~/server/services/ScheduledJobs/runner');
const {
  getUserNotificationSettings,
  updateUserNotificationSettings,
  upsertPushSubscription,
  removePushSubscription,
} = require('~/server/services/ScheduledJobs/userNotifications');

const MAX_NAME_LENGTH = 120;
const MAX_PROMPT_LENGTH = 12000;
const MAX_PROMPT_PREFIX_LENGTH = 4000;
const VALID_WEB_SEARCH_MODES = new Set(Object.values(WebSearchModes));

function isScheduleRunning(schedule) {
  return (
    schedule?.lastStatus === 'running' &&
    schedule?.lockUntil != null &&
    new Date(schedule.lockUntil) > new Date()
  );
}

function serializeSchedule(schedule) {
  if (!schedule) {
    return null;
  }

  const { currentRunId: _currentRunId, lockedBy: _lockedBy, ...rest } = schedule;
  return {
    ...rest,
    isRunning: isScheduleRunning(schedule),
  };
}

function normalizeNotifications(notifications = {}) {
  return {
    email: notifications.email === true,
    sms: notifications.sms === true,
    push: notifications.push === true,
  };
}

function normalizeTarget(target = {}) {
  const rawWebSearchMode =
    typeof target.ephemeralAgent?.web_search_mode === 'string'
      ? target.ephemeralAgent.web_search_mode.trim()
      : undefined;

  const normalized = {
    endpoint: target.endpoint?.trim(),
  };

  if (target.endpointType) {
    normalized.endpointType = target.endpointType.trim();
  }
  if (target.agent_id) {
    normalized.agent_id = target.agent_id.trim();
  }
  if (target.model) {
    normalized.model = target.model.trim();
  }
  if (target.promptPrefix) {
    normalized.promptPrefix = target.promptPrefix.trim();
  }
  if (target.spec) {
    normalized.spec = target.spec.trim();
  }
  if (target.ephemeralAgent && typeof target.ephemeralAgent === 'object') {
    normalized.ephemeralAgent = {
      web_search: target.ephemeralAgent.web_search === true,
      web_search_mode:
        rawWebSearchMode && VALID_WEB_SEARCH_MODES.has(rawWebSearchMode)
          ? rawWebSearchMode
          : undefined,
      file_search: target.ephemeralAgent.file_search === true,
      execute_code: target.ephemeralAgent.execute_code === true,
      artifacts:
        typeof target.ephemeralAgent.artifacts === 'string'
          ? target.ephemeralAgent.artifacts.trim()
          : undefined,
      mcp: Array.isArray(target.ephemeralAgent.mcp)
        ? target.ephemeralAgent.mcp.map((value) => String(value).trim()).filter(Boolean)
        : undefined,
    };
  }

  return normalized;
}

function validateTarget(target) {
  if (!target?.endpoint) {
    throw new Error('A target endpoint is required');
  }

  if (
    target?.ephemeralAgent?.web_search_mode &&
    !VALID_WEB_SEARCH_MODES.has(target.ephemeralAgent.web_search_mode)
  ) {
    throw new Error('Invalid web search mode');
  }

  if (isAgentsEndpoint(target.endpoint)) {
    if (!target.agent_id) {
      throw new Error('An agent is required for agent schedules');
    }
    return;
  }

  if (!target.model) {
    throw new Error('A model is required for scheduled model runs');
  }
}

function validateScheduleInput(payload) {
  const name = String(payload.name ?? '').trim();
  const prompt = String(payload.prompt ?? '').trim();
  const cron = normalizeCronExpression(String(payload.cron ?? ''));
  const timezone = String(payload.timezone ?? '').trim();
  const target = normalizeTarget(payload.target);
  const notifications = normalizeNotifications(payload.notifications);

  if (name.length === 0) {
    throw new Error('A schedule name is required');
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new Error(`Schedule name must be ${MAX_NAME_LENGTH} characters or fewer`);
  }

  if (prompt.length === 0) {
    throw new Error('A prompt is required');
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new Error(`Prompt must be ${MAX_PROMPT_LENGTH} characters or fewer`);
  }

  if (target.promptPrefix && target.promptPrefix.length > MAX_PROMPT_PREFIX_LENGTH) {
    throw new Error(`Prompt prefix must be ${MAX_PROMPT_PREFIX_LENGTH} characters or fewer`);
  }

  validateTarget(target);
  validateSchedule(cron, timezone);

  return {
    name,
    prompt,
    enabled: payload.enabled !== false,
    cron,
    timezone,
    notifications,
    target,
  };
}

async function listSchedulesController(req, res) {
  try {
    const schedules = await getScheduledJobs(req.user.id);
    res.status(200).json(schedules.map(serializeSchedule));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function createScheduleController(req, res) {
  try {
    const payload = validateScheduleInput(req.body ?? {});
    const schedule = await createScheduledJob({
      scheduleId: crypto.randomUUID(),
      user: req.user.id,
      ...payload,
      nextRunAt: getNextRunAt(payload.cron, payload.timezone),
    });

    res.status(201).json(serializeSchedule(schedule));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
}

async function updateScheduleController(req, res) {
  try {
    const existing = await getScheduledJob({
      user: req.user.id,
      scheduleId: req.params.scheduleId,
    });
    if (!existing) {
      return res.status(404).json({ message: 'Scheduled run not found' });
    }
    if (isScheduleRunning(existing)) {
      return res.status(409).json({ message: 'Scheduled run is currently executing' });
    }

    const merged = {
      ...existing,
      ...req.body,
      notifications: {
        ...(existing.notifications ?? {}),
        ...(req.body?.notifications ?? {}),
      },
      target: {
        ...(existing.target ?? {}),
        ...(req.body?.target ?? {}),
        ephemeralAgent: {
          ...(existing.target?.ephemeralAgent ?? {}),
          ...(req.body?.target?.ephemeralAgent ?? {}),
        },
      },
    };

    const payload = validateScheduleInput(merged);
    const updated = await updateScheduledJob(
      { user: req.user.id, scheduleId: req.params.scheduleId },
      {
        $set: {
          ...payload,
          nextRunAt: getNextRunAt(payload.cron, payload.timezone),
        },
      },
    );

    res.status(200).json(serializeSchedule(updated));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
}

async function deleteScheduleController(req, res) {
  try {
    const existing = await getScheduledJob({
      user: req.user.id,
      scheduleId: req.params.scheduleId,
    });
    if (!existing) {
      return res.status(404).json({ message: 'Scheduled run not found' });
    }
    if (isScheduleRunning(existing)) {
      return res.status(409).json({ message: 'Scheduled run is currently executing' });
    }

    await deleteScheduledJob({ user: req.user.id, scheduleId: req.params.scheduleId });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function runScheduleController(req, res) {
  try {
    const result = await runScheduledJobNow(req.user.id, req.params.scheduleId);
    if (!result) {
      return res.status(404).json({ message: 'Scheduled run not found' });
    }

    res.status(200).json({
      schedule: serializeSchedule(result.schedule),
      executionResult: {
        conversationId: result.executionResult?.conversationId ?? null,
        responseMessageId: result.executionResult?.responseMessageId ?? null,
        preview: result.executionResult?.preview ?? null,
      },
      notificationResults: result.notificationResults,
    });
  } catch (error) {
    if (error.code === 'SCHEDULE_RUNNING') {
      return res.status(409).json({ message: error.message });
    }

    const errorPayload = {
      message: error.message,
      schedule: serializeSchedule(error.schedule),
      notificationResults: error.notificationResults,
      executionResult: {
        conversationId: error.executionResult?.conversationId ?? null,
        responseMessageId: error.executionResult?.responseMessageId ?? null,
        preview: error.executionResult?.preview ?? null,
      },
    };

    // Surface structured MCP consent-continuation metadata when present
    // so API consumers and validators can see the authorization_url,
    // llm_instructions, and affected servers (VAL-MCP-004).
    if (error.continuationMetadata) {
      errorPayload.continuationMetadata = error.continuationMetadata;

      // Also surface top-level authorization_url and llm_instructions for
      // easier consumption by callers that do not inspect continuationMetadata.
      // This keeps the auth prompt fields consistent with the /api/mcp/tools
      // surface where oauthUrl is a top-level server property (VAL-MCP-004).
      if (error.continuationMetadata.authorization_url) {
        errorPayload.authorization_url = error.continuationMetadata.authorization_url;
      }
      if (error.continuationMetadata.llm_instructions) {
        errorPayload.llm_instructions = error.continuationMetadata.llm_instructions;
      }
    }

    return res.status(500).json(errorPayload);
  }
}

async function getNotificationSettingsController(req, res) {
  try {
    const settings = await getUserNotificationSettings(req.user.id);
    if (!settings) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json(settings);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function updateNotificationSettingsController(req, res) {
  try {
    const settings = await updateUserNotificationSettings(req.user.id, req.body ?? {});
    if (!settings) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json(settings);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
}

async function subscribePushController(req, res) {
  try {
    const settings = await upsertPushSubscription(
      req.user.id,
      req.body?.subscription,
      req.headers['user-agent'] ?? '',
    );
    if (!settings) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json(settings);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
}

async function unsubscribePushController(req, res) {
  try {
    const endpoint = String(req.body?.endpoint ?? '').trim();
    if (!endpoint) {
      return res.status(400).json({ message: 'Push subscription endpoint is required' });
    }

    const settings = await removePushSubscription(req.user.id, endpoint);
    if (!settings) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json(settings);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
}

module.exports = {
  listSchedulesController,
  createScheduleController,
  updateScheduleController,
  deleteScheduleController,
  runScheduleController,
  getNotificationSettingsController,
  updateNotificationSettingsController,
  subscribePushController,
  unsubscribePushController,
  serializeSchedule,
};
