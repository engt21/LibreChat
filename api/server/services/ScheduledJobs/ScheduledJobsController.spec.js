jest.mock('@librechat/data-schemas', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

jest.mock('librechat-data-provider', () => ({
  WebSearchModes: { DEFAULT: 'default', MCP: 'mcp' },
  isAgentsEndpoint: jest.fn((ep) => ep === 'agents'),
}));

const mockCreateScheduledJob = jest.fn();
const mockGetScheduledJob = jest.fn();
const mockGetScheduledJobs = jest.fn();
const mockUpdateScheduledJob = jest.fn();
const mockDeleteScheduledJob = jest.fn();

jest.mock('~/models', () => ({
  createScheduledJob: (...args) => mockCreateScheduledJob(...args),
  getScheduledJob: (...args) => mockGetScheduledJob(...args),
  getScheduledJobs: (...args) => mockGetScheduledJobs(...args),
  updateScheduledJob: (...args) => mockUpdateScheduledJob(...args),
  deleteScheduledJob: (...args) => mockDeleteScheduledJob(...args),
}));

const mockGetNextRunAt = jest.fn();
const mockValidateSchedule = jest.fn();
const mockNormalizeCronExpression = jest.fn((c) => c.trim());

jest.mock('~/server/services/ScheduledJobs/cron', () => ({
  getNextRunAt: (...args) => mockGetNextRunAt(...args),
  validateSchedule: (...args) => mockValidateSchedule(...args),
  normalizeCronExpression: (...args) => mockNormalizeCronExpression(...args),
}));

const mockRunScheduledJobNow = jest.fn();

jest.mock('~/server/services/ScheduledJobs/runner', () => ({
  runScheduledJobNow: (...args) => mockRunScheduledJobNow(...args),
}));

jest.mock('~/server/services/ScheduledJobs/userNotifications', () => ({
  getUserNotificationSettings: jest.fn().mockResolvedValue({}),
  updateUserNotificationSettings: jest.fn().mockResolvedValue({}),
  upsertPushSubscription: jest.fn().mockResolvedValue({}),
  removePushSubscription: jest.fn().mockResolvedValue({}),
}));

const {
  listSchedulesController,
  createScheduleController,
  updateScheduleController,
  deleteScheduleController,
  runScheduleController,
  serializeSchedule,
} = require('~/server/controllers/ScheduledJobsController');

function createReq(overrides = {}) {
  return {
    user: { id: 'user-1' },
    body: {},
    params: {},
    ...overrides,
  };
}

function createRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res;
}

const NEXT_RUN = new Date('2025-06-20T09:00:00Z');

beforeEach(() => {
  jest.clearAllMocks();
  mockGetNextRunAt.mockReturnValue(NEXT_RUN);
  mockValidateSchedule.mockReturnValue(undefined);
  mockNormalizeCronExpression.mockImplementation((c) => c.trim());
});

describe('serializeSchedule', () => {
  it('returns null for falsy input', () => {
    expect(serializeSchedule(null)).toBeNull();
    expect(serializeSchedule(undefined)).toBeNull();
  });

  it('strips internal lock fields and adds isRunning', () => {
    const schedule = {
      scheduleId: 's1',
      currentRunId: 'run-1',
      lockedBy: 'runner-1',
      lastStatus: 'idle',
      lockUntil: null,
    };
    const result = serializeSchedule(schedule);
    expect(result.currentRunId).toBeUndefined();
    expect(result.lockedBy).toBeUndefined();
    expect(result.isRunning).toBe(false);
  });

  it('reports isRunning=true when running with active lock', () => {
    const schedule = {
      scheduleId: 's1',
      currentRunId: 'run-1',
      lockedBy: 'runner-1',
      lastStatus: 'running',
      lockUntil: new Date(Date.now() + 60000),
    };
    const result = serializeSchedule(schedule);
    expect(result.isRunning).toBe(true);
  });

  it('reports isRunning=false when lock is expired', () => {
    const schedule = {
      scheduleId: 's1',
      currentRunId: 'run-1',
      lockedBy: 'runner-1',
      lastStatus: 'running',
      lockUntil: new Date(Date.now() - 1000),
    };
    const result = serializeSchedule(schedule);
    expect(result.isRunning).toBe(false);
  });
});

describe('createScheduleController', () => {
  const validBody = {
    name: 'Daily report',
    prompt: 'Generate daily summary',
    cron: '0 9 * * *',
    timezone: 'UTC',
    target: { endpoint: 'openAI', model: 'gpt-4' },
    notifications: { email: true },
  };

  it('creates a schedule with 201 and computed nextRunAt (VAL-SCHED-003)', async () => {
    const created = {
      scheduleId: 'uuid-1',
      ...validBody,
      nextRunAt: NEXT_RUN,
      lastStatus: 'idle',
      lockUntil: null,
    };
    mockCreateScheduledJob.mockResolvedValue(created);

    const req = createReq({ body: validBody });
    const res = createRes();
    await createScheduleController(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const response = res.json.mock.calls[0][0];
    expect(response.scheduleId).toBeDefined();
    expect(response.nextRunAt).toEqual(NEXT_RUN);
    expect(response.isRunning).toBe(false);
    expect(response.notifications.email).toBe(true);
  });

  it('creates a schedule for an agent target (VAL-SCHED-003)', async () => {
    const agentBody = {
      ...validBody,
      target: { endpoint: 'agents', agent_id: 'agent-1' },
    };
    const created = {
      scheduleId: 'uuid-2',
      ...agentBody,
      nextRunAt: NEXT_RUN,
      lastStatus: 'idle',
      lockUntil: null,
    };
    mockCreateScheduledJob.mockResolvedValue(created);

    const req = createReq({ body: agentBody });
    const res = createRes();
    await createScheduleController(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('rejects missing name with 400', async () => {
    const req = createReq({ body: { ...validBody, name: '' } });
    const res = createRes();
    await createScheduleController(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toContain('name is required');
  });

  it('rejects missing prompt with 400', async () => {
    const req = createReq({ body: { ...validBody, prompt: '' } });
    const res = createRes();
    await createScheduleController(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects missing target endpoint with 400', async () => {
    const req = createReq({ body: { ...validBody, target: {} } });
    const res = createRes();
    await createScheduleController(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects model endpoint without model with 400', async () => {
    const req = createReq({
      body: { ...validBody, target: { endpoint: 'openAI' } },
    });
    const res = createRes();
    await createScheduleController(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects agent endpoint without agent_id with 400', async () => {
    const req = createReq({
      body: { ...validBody, target: { endpoint: 'agents' } },
    });
    const res = createRes();
    await createScheduleController(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects invalid cron with 400', async () => {
    mockValidateSchedule.mockImplementation(() => {
      throw new Error('Invalid cron');
    });
    const req = createReq({ body: { ...validBody, cron: 'bad' } });
    const res = createRes();
    await createScheduleController(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('updateScheduleController', () => {
  const existing = {
    scheduleId: 's1',
    user: 'user-1',
    name: 'Daily report',
    prompt: 'Old prompt',
    cron: '0 9 * * *',
    timezone: 'UTC',
    enabled: true,
    target: {
      endpoint: 'openAI',
      model: 'gpt-4',
      ephemeralAgent: {
        web_search: true,
        file_search: false,
        execute_code: true,
        mcp: ['server1'],
        artifacts: 'on',
      },
    },
    notifications: { email: true, sms: false, push: false },
    lastStatus: 'idle',
    lockUntil: null,
  };

  it('merges partial updates preserving nested ephemeralAgent (VAL-SCHED-004)', async () => {
    mockGetScheduledJob.mockResolvedValue(existing);
    mockUpdateScheduledJob.mockResolvedValue({
      ...existing,
      prompt: 'New prompt',
      target: {
        ...existing.target,
        ephemeralAgent: {
          ...existing.target.ephemeralAgent,
          web_search: false,
        },
      },
      nextRunAt: NEXT_RUN,
    });

    const req = createReq({
      params: { scheduleId: 's1' },
      body: {
        prompt: 'New prompt',
        target: {
          ephemeralAgent: { web_search: false },
        },
      },
    });
    const res = createRes();
    await updateScheduleController(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    // Verify the update preserved existing ephemeralAgent fields
    const updateCall = mockUpdateScheduledJob.mock.calls[0];
    const setPayload = updateCall[1].$set;
    expect(setPayload.target.ephemeralAgent.execute_code).toBe(true);
    expect(setPayload.target.ephemeralAgent.mcp).toEqual(['server1']);
    expect(setPayload.target.ephemeralAgent.artifacts).toBe('on');
    expect(setPayload.target.ephemeralAgent.web_search).toBe(false);
  });

  it('returns 404 when schedule not found', async () => {
    mockGetScheduledJob.mockResolvedValue(null);
    const req = createReq({ params: { scheduleId: 'missing' } });
    const res = createRes();
    await updateScheduleController(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 409 when schedule is running (VAL-SCHED-007)', async () => {
    mockGetScheduledJob.mockResolvedValue({
      ...existing,
      lastStatus: 'running',
      lockUntil: new Date(Date.now() + 60000),
    });
    const req = createReq({ params: { scheduleId: 's1' }, body: { prompt: 'new' } });
    const res = createRes();
    await updateScheduleController(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });
});

describe('deleteScheduleController', () => {
  it('deletes and returns 204', async () => {
    mockGetScheduledJob.mockResolvedValue({
      scheduleId: 's1',
      lastStatus: 'idle',
      lockUntil: null,
    });
    mockDeleteScheduledJob.mockResolvedValue({ deletedCount: 1 });

    const req = createReq({ params: { scheduleId: 's1' } });
    const res = createRes();
    await deleteScheduleController(req, res);
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it('returns 404 when schedule not found', async () => {
    mockGetScheduledJob.mockResolvedValue(null);
    const req = createReq({ params: { scheduleId: 'missing' } });
    const res = createRes();
    await deleteScheduleController(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 409 when schedule is running (VAL-SCHED-007)', async () => {
    mockGetScheduledJob.mockResolvedValue({
      scheduleId: 's1',
      lastStatus: 'running',
      lockUntil: new Date(Date.now() + 60000),
    });
    const req = createReq({ params: { scheduleId: 's1' } });
    const res = createRes();
    await deleteScheduleController(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });
});

describe('runScheduleController', () => {
  it('returns 200 with schedule, executionResult, and notificationResults on success (VAL-SCHED-005)', async () => {
    mockRunScheduledJobNow.mockResolvedValue({
      schedule: {
        scheduleId: 's1',
        lastStatus: 'succeeded',
        lockUntil: null,
        lastConversationId: 'conv-1',
        lastResponseMessageId: 'msg-1',
        lastResponsePreview: 'Hello',
        lastNotificationResults: { email: { status: 'sent' } },
      },
      executionResult: {
        conversationId: 'conv-1',
        responseMessageId: 'msg-1',
        preview: 'Hello',
      },
      notificationResults: { email: { status: 'sent' } },
    });

    const req = createReq({ params: { scheduleId: 's1' } });
    const res = createRes();
    await runScheduleController(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.schedule).toBeDefined();
    expect(body.executionResult.conversationId).toBe('conv-1');
    expect(body.notificationResults).toBeDefined();
  });

  it('returns 404 when schedule not found', async () => {
    mockRunScheduledJobNow.mockResolvedValue(null);
    const req = createReq({ params: { scheduleId: 'missing' } });
    const res = createRes();
    await runScheduleController(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 409 when schedule is already running (VAL-SCHED-007)', async () => {
    const error = new Error('Scheduled run is already in progress');
    error.code = 'SCHEDULE_RUNNING';
    mockRunScheduledJobNow.mockRejectedValue(error);

    const req = createReq({ params: { scheduleId: 's1' } });
    const res = createRes();
    await runScheduleController(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('returns 500 with durable metadata on execution failure (VAL-SCHED-005)', async () => {
    const error = new Error('Model access denied');
    error.schedule = {
      scheduleId: 's1',
      lastStatus: 'failed',
      lockUntil: null,
      lastError: 'Model access denied',
    };
    error.notificationResults = { email: { status: 'sent' } };
    error.executionResult = { conversationId: null, responseMessageId: null, preview: null };
    mockRunScheduledJobNow.mockRejectedValue(error);

    const req = createReq({ params: { scheduleId: 's1' } });
    const res = createRes();
    await runScheduleController(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body.message).toBe('Model access denied');
    expect(body.schedule).toBeDefined();
    expect(body.notificationResults).toBeDefined();
    expect(body.executionResult).toBeDefined();
  });

  it('surfaces structured continuationMetadata and top-level auth fields in the error response for MCP consent failures (VAL-MCP-004)', async () => {
    const error = new Error(
      'MCP tool returned an authorization prompt instead of executing. ' +
        'Provider consent is required for MCP server(s): arcade-microsoft.',
    );
    error.schedule = {
      scheduleId: 's1',
      lastStatus: 'failed',
      lockUntil: null,
      lastError: error.message,
    };
    error.notificationResults = {};
    error.executionResult = { conversationId: null, responseMessageId: null, preview: null };
    error.continuationMetadata = {
      authorization_url:
        'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=abc',
      llm_instructions: 'Please share the authorization link with the user.',
      servers: ['arcade-microsoft'],
    };
    mockRunScheduledJobNow.mockRejectedValue(error);

    const req = createReq({ params: { scheduleId: 's1' } });
    const res = createRes();
    await runScheduleController(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body.message).toContain('authorization prompt');
    expect(body.continuationMetadata).toBeDefined();
    expect(body.continuationMetadata.authorization_url).toBe(
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=abc',
    );
    expect(body.continuationMetadata.llm_instructions).toBe(
      'Please share the authorization link with the user.',
    );
    expect(body.continuationMetadata.servers).toEqual(['arcade-microsoft']);
    // Top-level auth fields must also be present for easier consumption (VAL-MCP-004)
    expect(body.authorization_url).toBe(
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=abc',
    );
    expect(body.llm_instructions).toBe(
      'Please share the authorization link with the user.',
    );
  });

  it('surfaces preflight continuationMetadata with authorization_url and top-level auth fields from server oauthMetadata (VAL-MCP-004)', async () => {
    const error = new Error(
      'OAuth consent is required for MCP server(s): arcade-microsoft. ' +
        'Complete the OAuth authorization flow interactively before scheduling runs ' +
        'that depend on these tools.',
    );
    error.schedule = {
      scheduleId: 's1',
      lastStatus: 'failed',
      lockUntil: null,
      lastError: error.message,
    };
    error.notificationResults = {};
    error.executionResult = { conversationId: null, responseMessageId: null, preview: null };
    // Preflight-originated continuation metadata (from server oauthMetadata)
    error.continuationMetadata = {
      authorization_url: 'https://cloud.arcade.dev/oauth2/authorize',
      servers: ['arcade-microsoft'],
    };
    mockRunScheduledJobNow.mockRejectedValue(error);

    const req = createReq({ params: { scheduleId: 's1' } });
    const res = createRes();
    await runScheduleController(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body.message).toContain('OAuth consent');
    expect(body.continuationMetadata).toBeDefined();
    expect(body.continuationMetadata.authorization_url).toBe(
      'https://cloud.arcade.dev/oauth2/authorize',
    );
    expect(body.continuationMetadata.servers).toEqual(['arcade-microsoft']);
    // Preflight errors don't have llm_instructions
    expect(body.continuationMetadata.llm_instructions).toBeUndefined();
    // Top-level authorization_url must also be present (VAL-MCP-004)
    expect(body.authorization_url).toBe('https://cloud.arcade.dev/oauth2/authorize');
    // Top-level llm_instructions should be absent for preflight-only errors
    expect(body.llm_instructions).toBeUndefined();
  });

  it('does not include continuationMetadata or top-level auth fields when error has none (non-MCP failure)', async () => {
    const error = new Error('Network timeout');
    error.schedule = {
      scheduleId: 's1',
      lastStatus: 'failed',
      lockUntil: null,
    };
    error.notificationResults = {};
    error.executionResult = null;
    mockRunScheduledJobNow.mockRejectedValue(error);

    const req = createReq({ params: { scheduleId: 's1' } });
    const res = createRes();
    await runScheduleController(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body.message).toBe('Network timeout');
    expect(body.continuationMetadata).toBeUndefined();
    expect(body.authorization_url).toBeUndefined();
    expect(body.llm_instructions).toBeUndefined();
  });
});

describe('listSchedulesController', () => {
  it('returns serialized schedules', async () => {
    mockGetScheduledJobs.mockResolvedValue([
      { scheduleId: 's1', lastStatus: 'idle', lockUntil: null },
      { scheduleId: 's2', lastStatus: 'succeeded', lockUntil: null },
    ]);

    const req = createReq();
    const res = createRes();
    await listSchedulesController(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body).toHaveLength(2);
    body.forEach((s) => {
      expect(s.isRunning).toBeDefined();
      expect(s.currentRunId).toBeUndefined();
    });
  });
});
