jest.mock('@librechat/data-schemas', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

jest.mock('@librechat/api', () => ({
  isEnabled: jest.fn((val) => val !== 'false'),
}));

const mockFindOneAndUpdate = jest.fn();
const mockFindOne = jest.fn();
const mockUpdateOne = jest.fn();

jest.mock('~/db/models', () => ({
  ScheduledJob: {
    findOneAndUpdate: (...args) => mockFindOneAndUpdate(...args),
    findOne: (...args) => mockFindOne(...args),
    updateOne: (...args) => mockUpdateOne(...args),
  },
  User: {
    findById: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: 'user-1',
          name: 'Test User',
          email: 'test@example.com',
          role: 'USER',
        }),
      }),
    }),
  },
}));

jest.mock('./execution', () => ({
  executeScheduledRun: jest.fn(),
}));

jest.mock('./notifications', () => ({
  sendScheduledRunNotifications: jest.fn().mockResolvedValue({}),
}));

jest.mock('./cron', () => ({
  getNextRunAt: jest.fn().mockReturnValue(new Date('2025-07-01T09:00:00Z')),
}));

// Use a fresh require for each test to avoid polluted state
let runner;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  // Reset module to get fresh state
  jest.resetModules();
  jest.mock('@librechat/data-schemas', () => ({
    logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
  }));
  jest.mock('@librechat/api', () => ({
    isEnabled: jest.fn((val) => val !== 'false'),
  }));
  jest.mock('~/db/models', () => ({
    ScheduledJob: {
      findOneAndUpdate: (...args) => mockFindOneAndUpdate(...args),
      findOne: (...args) => mockFindOne(...args),
      updateOne: (...args) => mockUpdateOne(...args),
    },
    User: {
      findById: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            _id: 'user-1',
            name: 'Test User',
            email: 'test@example.com',
            role: 'USER',
          }),
        }),
      }),
    },
  }));
  jest.mock('./execution', () => ({
    executeScheduledRun: jest.fn(),
  }));
  jest.mock('./notifications', () => ({
    sendScheduledRunNotifications: jest.fn().mockResolvedValue({}),
  }));
  jest.mock('./cron', () => ({
    getNextRunAt: jest.fn().mockReturnValue(new Date('2025-07-01T09:00:00Z')),
  }));
  runner = require('./runner');
  mockUpdateOne.mockResolvedValue({});
});

afterEach(() => {
  runner.stopScheduledJobRunner();
  jest.useRealTimers();
});

describe('runScheduledJobNow', () => {
  const baseSchedule = {
    scheduleId: 's1',
    user: 'user-1',
    name: 'Test',
    prompt: 'Run test',
    cron: '0 9 * * *',
    timezone: 'UTC',
    enabled: true,
    nextRunAt: new Date('2025-06-20T09:00:00Z'),
    target: { endpoint: 'openAI', model: 'gpt-4' },
    notifications: { email: false, sms: false, push: false },
  };

  it('returns null when schedule not found (VAL-SCHED-005)', async () => {
    mockFindOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    const result = await runner.runScheduledJobNow('user-1', 'missing');
    expect(result).toBeNull();
  });

  it('throws SCHEDULE_RUNNING when already running (VAL-SCHED-007)', async () => {
    mockFindOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(baseSchedule) });
    // Claim fails - already locked
    mockFindOneAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    await expect(runner.runScheduledJobNow('user-1', 's1')).rejects.toMatchObject({
      code: 'SCHEDULE_RUNNING',
    });
  });

  it('executes successfully and returns durable metadata (VAL-SCHED-005)', async () => {
    const claimed = {
      ...baseSchedule,
      lastStatus: 'running',
      currentRunId: 'run-1',
      lockUntil: new Date(Date.now() + 300000),
      lockedBy: 'runner-1',
    };
    mockFindOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(baseSchedule) });
    mockFindOneAndUpdate
      .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue(claimed) }) // claim
      .mockReturnValueOnce({
        lean: jest.fn().mockResolvedValue({
          ...baseSchedule,
          lastStatus: 'succeeded',
          lastConversationId: 'conv-1',
          lastNotificationResults: {},
        }),
      }); // finalize

    const { executeScheduledRun } = require('./execution');
    executeScheduledRun.mockResolvedValue({
      success: true,
      conversationId: 'conv-1',
      responseMessageId: 'msg-1',
      preview: 'Hello world',
    });

    const result = await runner.runScheduledJobNow('user-1', 's1');
    expect(result).toBeDefined();
    expect(result.schedule).toBeDefined();
    expect(result.executionResult.conversationId).toBe('conv-1');
    expect(result.notificationResults).toBeDefined();
  });

  it('manual run on disabled schedule still executes once without advancing nextRunAt (VAL-SCHED-006)', async () => {
    const disabledSchedule = {
      ...baseSchedule,
      enabled: false,
      nextRunAt: new Date('2025-06-25T09:00:00Z'),
    };
    const claimed = {
      ...disabledSchedule,
      lastStatus: 'running',
      currentRunId: 'run-1',
      lockUntil: new Date(Date.now() + 300000),
      lockedBy: 'runner-1',
      lastRunAt: new Date(),
    };

    mockFindOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(disabledSchedule) });
    mockFindOneAndUpdate
      .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue(claimed) }) // claim
      .mockReturnValueOnce(
        (function () {
          // Capture the finalize update to verify nextRunAt
          return {
            lean: jest.fn().mockImplementation(function () {
              return Promise.resolve({ ...disabledSchedule, lastStatus: 'succeeded' });
            }),
          };
        })(),
      ); // finalize

    const { executeScheduledRun } = require('./execution');
    executeScheduledRun.mockResolvedValue({
      success: true,
      conversationId: 'conv-2',
      preview: 'Done',
    });

    await runner.runScheduledJobNow('user-1', 's1');

    // Check the finalize call: for a manual run on a disabled schedule,
    // nextRunAt should not advance (it's not due and not scheduler-triggered)
    const finalizeCall = mockFindOneAndUpdate.mock.calls[1];
    const setFields = finalizeCall[1].$set;
    // nextRunAt should remain the original value since the schedule is disabled
    // and was triggered manually (trigger === 'manual')
    expect(setFields.nextRunAt).toEqual(disabledSchedule.nextRunAt);
  });

  it('preserves failure metadata and notification results on execution error (VAL-SCHED-005)', async () => {
    const claimed = {
      ...baseSchedule,
      lastStatus: 'running',
      currentRunId: 'run-1',
      lockUntil: new Date(Date.now() + 300000),
      lockedBy: 'runner-1',
      lastRunAt: new Date(),
    };
    mockFindOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(baseSchedule) });
    mockFindOneAndUpdate
      .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue(claimed) }) // claim
      .mockReturnValueOnce({
        lean: jest.fn().mockResolvedValue({
          ...baseSchedule,
          lastStatus: 'failed',
          lastError: 'Illegal model request',
          lastNotificationResults: { email: { status: 'sent' } },
        }),
      }); // finalize

    const { executeScheduledRun } = require('./execution');
    executeScheduledRun.mockRejectedValue(new Error('Illegal model request'));

    const { sendScheduledRunNotifications } = require('./notifications');
    sendScheduledRunNotifications.mockResolvedValue({ email: { status: 'sent' } });

    try {
      await runner.runScheduledJobNow('user-1', 's1');
      throw new Error('Should have thrown');
    } catch (error) {
      expect(error.message).toBe('Illegal model request');
      expect(error.schedule).toBeDefined();
      expect(error.notificationResults).toEqual({ email: { status: 'sent' } });
    }

    // Verify finalize was called with failure metadata
    const finalizeCall = mockFindOneAndUpdate.mock.calls[1];
    const setFields = finalizeCall[1].$set;
    expect(setFields.lastStatus).toBe('failed');
    expect(setFields.lastError).toBe('Illegal model request');
    expect(setFields.lastNotificationResults).toEqual({ email: { status: 'sent' } });
  });
});

describe('tickScheduledJobs', () => {
  it('claims and executes due schedules (VAL-SCHED-006)', async () => {
    const dueSchedule = {
      scheduleId: 's1',
      user: 'user-1',
      name: 'Due Run',
      prompt: 'Run this',
      cron: '0 9 * * *',
      timezone: 'UTC',
      enabled: true,
      nextRunAt: new Date(Date.now() - 1000),
      currentRunId: 'run-1',
      target: { endpoint: 'openAI', model: 'gpt-4' },
      notifications: { email: false, sms: false, push: false },
    };

    // First claim returns schedule, second returns null (no more due)
    mockFindOneAndUpdate
      .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue(dueSchedule) })
      .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue(null) }) // no more due
      .mockReturnValueOnce({
        lean: jest.fn().mockResolvedValue({
          ...dueSchedule,
          lastStatus: 'succeeded',
          nextRunAt: new Date('2025-07-01T09:00:00Z'),
        }),
      }); // finalize

    const { executeScheduledRun } = require('./execution');
    executeScheduledRun.mockResolvedValue({
      success: true,
      conversationId: 'conv-tick',
      preview: 'ok',
    });

    await runner.tickScheduledJobs();

    expect(executeScheduledRun).toHaveBeenCalledWith(dueSchedule, expect.any(Object));
  });

  it('does not execute when runner is disabled', async () => {
    // stopScheduledJobRunner to be safe
    runner.stopScheduledJobRunner();

    // Re-import with disabled runner
    jest.resetModules();
    jest.mock('@librechat/data-schemas', () => ({
      logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
    }));
    jest.mock('@librechat/api', () => ({
      isEnabled: jest.fn(() => false),
    }));
    jest.mock('~/db/models', () => ({
      ScheduledJob: { findOneAndUpdate: jest.fn() },
      User: { findById: jest.fn() },
    }));
    jest.mock('./execution', () => ({ executeScheduledRun: jest.fn() }));
    jest.mock('./notifications', () => ({ sendScheduledRunNotifications: jest.fn() }));
    jest.mock('./cron', () => ({ getNextRunAt: jest.fn() }));

    // Fake the env variable
    const origEnv = process.env.SCHEDULED_RUNNER_ENABLED;
    process.env.SCHEDULED_RUNNER_ENABLED = 'false';
    const disabledRunner = require('./runner');
    process.env.SCHEDULED_RUNNER_ENABLED = origEnv;

    await disabledRunner.tickScheduledJobs();

    const { ScheduledJob } = require('~/db/models');
    expect(ScheduledJob.findOneAndUpdate).not.toHaveBeenCalled();

    disabledRunner.stopScheduledJobRunner();
  });
});

describe('startScheduledJobRunner / stopScheduledJobRunner', () => {
  it('starts and stops the runner', () => {
    const started = runner.startScheduledJobRunner();
    expect(started).toBe(true);

    runner.stopScheduledJobRunner();
    // No error means success
  });

  it('returns true on repeated start calls (idempotent)', () => {
    runner.startScheduledJobRunner();
    const result = runner.startScheduledJobRunner();
    expect(result).toBe(true);
    runner.stopScheduledJobRunner();
  });
});
