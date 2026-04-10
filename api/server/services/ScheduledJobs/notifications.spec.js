jest.mock('@librechat/data-schemas', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

jest.mock('axios');
jest.mock('web-push');

jest.mock('~/server/utils', () => ({
  sendEmail: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('~/server/services/ScheduledJobs/userNotifications', () => ({
  SMS_PROVIDERS: { TWILIO: 'twilio', CARRIER_GATEWAY: 'carrier_gateway' },
  getUserNotificationConfig: jest.fn(),
  removePushSubscriptions: jest.fn().mockResolvedValue(null),
}));

const { sendEmail } = require('~/server/utils');
const webpush = require('web-push');
const {
  getUserNotificationConfig,
  removePushSubscriptions,
} = require('~/server/services/ScheduledJobs/userNotifications');
const {
  sendScheduledRunNotifications,
  buildConversationUrl,
  truncateText,
} = require('./notifications');

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.DOMAIN_CLIENT;
  delete process.env.APP_TITLE;
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_FROM_NUMBER;
  delete process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
  delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  delete process.env.WEB_PUSH_SUBJECT;
  delete process.env.MAILGUN_API_KEY;
  delete process.env.MAILGUN_DOMAIN;
  delete process.env.EMAIL_FROM;
});

describe('truncateText', () => {
  it('returns text unchanged when within limit', () => {
    expect(truncateText('short', 10)).toBe('short');
  });

  it('truncates and appends ellipsis when text exceeds limit', () => {
    const result = truncateText('a very long string', 10);
    expect(result.length).toBeLessThanOrEqual(10);
    expect(result).toContain('…');
  });

  it('handles null and undefined', () => {
    expect(truncateText(null)).toBe('');
    expect(truncateText(undefined)).toBe('');
  });
});

describe('buildConversationUrl', () => {
  it('returns null when no conversationId', () => {
    expect(buildConversationUrl(null)).toBeNull();
    expect(buildConversationUrl(undefined)).toBeNull();
  });

  it('builds URL from DOMAIN_CLIENT', () => {
    process.env.DOMAIN_CLIENT = 'https://chat.example.com';
    const url = buildConversationUrl('conv-123');
    expect(url).toBe('https://chat.example.com/c/conv-123');
  });

  it('defaults to localhost:3080 without DOMAIN_CLIENT', () => {
    const url = buildConversationUrl('conv-123');
    expect(url).toBe('http://localhost:3080/c/conv-123');
  });
});

describe('sendScheduledRunNotifications', () => {
  const schedule = {
    scheduleId: 'sched-1',
    name: 'Test Schedule',
    prompt: 'Run test',
    notifications: { email: true, sms: false, push: false },
  };

  it('returns empty object when user config not found', async () => {
    getUserNotificationConfig.mockResolvedValue(null);
    const result = await sendScheduledRunNotifications({
      userId: 'user-1',
      schedule,
      result: { conversationId: 'c1', preview: 'ok', error: null },
    });
    expect(result).toEqual({});
  });

  it('sends email notification on success', async () => {
    getUserNotificationConfig.mockResolvedValue({
      user: { name: 'Test User' },
      settings: {
        email: { enabled: true, address: 'test@example.com' },
        sms: { enabled: false },
        push: { enabled: false, subscriptions: [] },
      },
      capabilities: { email: true, sms: false, push: false },
    });

    const result = await sendScheduledRunNotifications({
      userId: 'user-1',
      schedule,
      result: { conversationId: 'c1', preview: 'Response text', error: null },
    });

    expect(result.email).toBeDefined();
    expect(result.email.status).toBe('sent');
    expect(result.email.destination).toBe('test@example.com');
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'test@example.com',
        template: 'scheduledRunNotification.handlebars',
      }),
    );
  });

  it('skips email when capability is missing', async () => {
    getUserNotificationConfig.mockResolvedValue({
      user: {},
      settings: {
        email: { enabled: true, address: 'test@example.com' },
        sms: { enabled: false },
        push: { enabled: false, subscriptions: [] },
      },
      capabilities: { email: false, sms: false, push: false },
    });

    const result = await sendScheduledRunNotifications({
      userId: 'user-1',
      schedule,
      result: { conversationId: 'c1', preview: 'ok', error: null },
    });

    expect(result.email.status).toBe('skipped');
    expect(result.email.reason).toContain('not configured');
  });

  it('skips email when disabled in settings', async () => {
    getUserNotificationConfig.mockResolvedValue({
      user: {},
      settings: {
        email: { enabled: false, address: 'test@example.com' },
        sms: { enabled: false },
        push: { enabled: false, subscriptions: [] },
      },
      capabilities: { email: true, sms: false, push: false },
    });

    const result = await sendScheduledRunNotifications({
      userId: 'user-1',
      schedule,
      result: { conversationId: 'c1', preview: 'ok', error: null },
    });

    expect(result.email.status).toBe('skipped');
    expect(result.email.reason).toContain('disabled');
  });

  it('skips email when no address configured', async () => {
    getUserNotificationConfig.mockResolvedValue({
      user: {},
      settings: {
        email: { enabled: true, address: '' },
        sms: { enabled: false },
        push: { enabled: false, subscriptions: [] },
      },
      capabilities: { email: true, sms: false, push: false },
    });

    const result = await sendScheduledRunNotifications({
      userId: 'user-1',
      schedule,
      result: { conversationId: null, preview: 'ok', error: null },
    });

    expect(result.email.status).toBe('skipped');
    expect(result.email.reason).toContain('No email address');
  });

  it('reports failed email with error reason', async () => {
    getUserNotificationConfig.mockResolvedValue({
      user: {},
      settings: {
        email: { enabled: true, address: 'test@example.com' },
        sms: { enabled: false },
        push: { enabled: false, subscriptions: [] },
      },
      capabilities: { email: true, sms: false, push: false },
    });
    sendEmail.mockRejectedValueOnce(new Error('SMTP timeout'));

    const result = await sendScheduledRunNotifications({
      userId: 'user-1',
      schedule,
      result: { conversationId: 'c1', preview: 'ok', error: null },
    });

    expect(result.email.status).toBe('failed');
    expect(result.email.reason).toBe('SMTP timeout');
  });

  it('handles error result with failure context in notifications', async () => {
    getUserNotificationConfig.mockResolvedValue({
      user: { name: 'Test' },
      settings: {
        email: { enabled: true, address: 'test@example.com' },
        sms: { enabled: false },
        push: { enabled: false, subscriptions: [] },
      },
      capabilities: { email: true, sms: false, push: false },
    });

    const result = await sendScheduledRunNotifications({
      userId: 'user-1',
      schedule,
      result: { conversationId: null, preview: '', error: 'Model access denied' },
    });

    expect(result.email.status).toBe('sent');
    // Verify the template payload includes error info
    const emailCall = sendEmail.mock.calls[0][0];
    expect(emailCall.payload.error).toContain('Model access denied');
  });

  it('omits conversation link when no conversationId', async () => {
    getUserNotificationConfig.mockResolvedValue({
      user: { name: 'Test' },
      settings: {
        email: { enabled: true, address: 'test@example.com' },
        sms: { enabled: false },
        push: { enabled: false, subscriptions: [] },
      },
      capabilities: { email: true, sms: false, push: false },
    });

    await sendScheduledRunNotifications({
      userId: 'user-1',
      schedule,
      result: { conversationId: null, preview: 'ok', error: null },
    });

    const emailCall = sendEmail.mock.calls[0][0];
    expect(emailCall.payload.conversationUrl).toBeNull();
  });

  it('includes DOMAIN_CLIENT conversation link when conversationId present', async () => {
    process.env.DOMAIN_CLIENT = 'https://chat.example.com';
    getUserNotificationConfig.mockResolvedValue({
      user: { name: 'Test' },
      settings: {
        email: { enabled: true, address: 'test@example.com' },
        sms: { enabled: false },
        push: { enabled: false, subscriptions: [] },
      },
      capabilities: { email: true, sms: false, push: false },
    });

    await sendScheduledRunNotifications({
      userId: 'user-1',
      schedule,
      result: { conversationId: 'conv-abc', preview: 'ok', error: null },
    });

    const emailCall = sendEmail.mock.calls[0][0];
    expect(emailCall.payload.conversationUrl).toBe('https://chat.example.com/c/conv-abc');
  });

  it('sends push notification and prunes expired subscriptions', async () => {
    process.env.WEB_PUSH_VAPID_PUBLIC_KEY = 'pub-key';
    process.env.WEB_PUSH_VAPID_PRIVATE_KEY = 'priv-key';

    const pushSchedule = {
      ...schedule,
      notifications: { email: false, sms: false, push: true },
    };

    getUserNotificationConfig.mockResolvedValue({
      user: {},
      settings: {
        email: { enabled: false },
        sms: { enabled: false },
        push: {
          enabled: true,
          subscriptions: [
            { endpoint: 'https://push.example.com/1', keys: { p256dh: 'a', auth: 'b' } },
            { endpoint: 'https://push.example.com/2', keys: { p256dh: 'c', auth: 'd' } },
          ],
        },
      },
      capabilities: { email: false, sms: false, push: true },
    });

    // First subscription succeeds, second returns 410 (expired)
    webpush.sendNotification
      .mockResolvedValueOnce({ statusCode: 201 })
      .mockRejectedValueOnce({ statusCode: 410 });

    const result = await sendScheduledRunNotifications({
      userId: 'user-1',
      schedule: pushSchedule,
      result: { conversationId: 'c1', preview: 'ok', error: null },
    });

    expect(result.push.status).toBe('sent');
    expect(result.push.details.sentCount).toBe(1);
    expect(result.push.details.failedCount).toBe(1);
    expect(result.push.details.expiredEndpoints).toContain('https://push.example.com/2');
    expect(removePushSubscriptions).toHaveBeenCalledWith('user-1', ['https://push.example.com/2']);
  });

  it('reports channel-level results for all enabled channels', async () => {
    const multiChannelSchedule = {
      ...schedule,
      notifications: { email: true, sms: true, push: true },
    };

    getUserNotificationConfig.mockResolvedValue({
      user: {},
      settings: {
        email: { enabled: true, address: 'test@example.com' },
        sms: { enabled: true, provider: 'twilio', phoneNumber: '+15551234567' },
        push: { enabled: true, subscriptions: [] },
      },
      capabilities: {
        email: true,
        sms: true,
        smsProviders: { twilio: true, carrierGateway: false },
        push: true,
      },
    });

    const result = await sendScheduledRunNotifications({
      userId: 'user-1',
      schedule: multiChannelSchedule,
      result: { conversationId: 'c1', preview: 'ok', error: null },
    });

    // Each channel should have a status
    expect(result.email).toBeDefined();
    expect(result.sms).toBeDefined();
    expect(result.push).toBeDefined();
    // Push should be skipped: no subscriptions
    expect(result.push.status).toBe('skipped');
    expect(result.push.reason).toContain('No push subscriptions');
  });

  it('push payload includes conversationId, url, status, and tag for clickthrough (VAL-SCHED-008, VAL-SCHED-009)', async () => {
    process.env.WEB_PUSH_VAPID_PUBLIC_KEY = 'pub-key';
    process.env.WEB_PUSH_VAPID_PRIVATE_KEY = 'priv-key';
    process.env.DOMAIN_CLIENT = 'https://chat.example.com';

    const pushSchedule = {
      ...schedule,
      scheduleId: 'sched-click',
      notifications: { email: false, sms: false, push: true },
    };

    getUserNotificationConfig.mockResolvedValue({
      user: {},
      settings: {
        email: { enabled: false },
        sms: { enabled: false },
        push: {
          enabled: true,
          subscriptions: [
            { endpoint: 'https://push.example.com/1', keys: { p256dh: 'a', auth: 'b' } },
          ],
        },
      },
      capabilities: { email: false, sms: false, push: true },
    });

    webpush.sendNotification.mockResolvedValueOnce({ statusCode: 201 });

    await sendScheduledRunNotifications({
      userId: 'user-1',
      schedule: pushSchedule,
      result: { conversationId: 'conv-click', preview: 'Completed successfully', error: null },
    });

    expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
    const [, payloadStr] = webpush.sendNotification.mock.calls[0];
    const payload = JSON.parse(payloadStr);

    // Clickthrough URL must be DOMAIN_CLIENT-rooted
    expect(payload.url).toBe('https://chat.example.com/c/conv-click');
    expect(payload.conversationId).toBe('conv-click');
    expect(payload.tag).toBe('sched-click');
    expect(payload.status).toBe('completed');
    expect(payload.title).toContain('Test Schedule');
    expect(payload.body).toBeTruthy();
  });

  it('push payload omits url cleanly when no conversationId (VAL-SCHED-008)', async () => {
    process.env.WEB_PUSH_VAPID_PUBLIC_KEY = 'pub-key';
    process.env.WEB_PUSH_VAPID_PRIVATE_KEY = 'priv-key';

    const pushSchedule = {
      ...schedule,
      notifications: { email: false, sms: false, push: true },
    };

    getUserNotificationConfig.mockResolvedValue({
      user: {},
      settings: {
        email: { enabled: false },
        sms: { enabled: false },
        push: {
          enabled: true,
          subscriptions: [
            { endpoint: 'https://push.example.com/1', keys: { p256dh: 'a', auth: 'b' } },
          ],
        },
      },
      capabilities: { email: false, sms: false, push: true },
    });

    webpush.sendNotification.mockResolvedValueOnce({ statusCode: 201 });

    await sendScheduledRunNotifications({
      userId: 'user-1',
      schedule: pushSchedule,
      result: { conversationId: null, preview: '', error: 'Model access denied' },
    });

    const [, payloadStr] = webpush.sendNotification.mock.calls[0];
    const payload = JSON.parse(payloadStr);
    expect(payload.url).toBeNull();
    expect(payload.conversationId).toBeNull();
    expect(payload.status).toBe('failed');
  });

  it('prunes stale subscriptions returning 404 in addition to 410 (VAL-SCHED-009)', async () => {
    process.env.WEB_PUSH_VAPID_PUBLIC_KEY = 'pub-key';
    process.env.WEB_PUSH_VAPID_PRIVATE_KEY = 'priv-key';

    const pushSchedule = {
      ...schedule,
      notifications: { email: false, sms: false, push: true },
    };

    getUserNotificationConfig.mockResolvedValue({
      user: {},
      settings: {
        email: { enabled: false },
        sms: { enabled: false },
        push: {
          enabled: true,
          subscriptions: [
            { endpoint: 'https://push.example.com/ok', keys: { p256dh: 'a', auth: 'b' } },
            { endpoint: 'https://push.example.com/gone-410', keys: { p256dh: 'c', auth: 'd' } },
            { endpoint: 'https://push.example.com/gone-404', keys: { p256dh: 'e', auth: 'f' } },
          ],
        },
      },
      capabilities: { email: false, sms: false, push: true },
    });

    webpush.sendNotification
      .mockResolvedValueOnce({ statusCode: 201 }) // ok
      .mockRejectedValueOnce({ statusCode: 410 }) // gone
      .mockRejectedValueOnce({ statusCode: 404 }); // not found

    const result = await sendScheduledRunNotifications({
      userId: 'user-1',
      schedule: pushSchedule,
      result: { conversationId: 'c1', preview: 'ok', error: null },
    });

    expect(result.push.status).toBe('sent');
    expect(result.push.details.sentCount).toBe(1);
    expect(result.push.details.failedCount).toBe(2);
    expect(result.push.details.expiredEndpoints).toEqual(
      expect.arrayContaining([
        'https://push.example.com/gone-410',
        'https://push.example.com/gone-404',
      ]),
    );
    // Both stale endpoints must be pruned
    expect(removePushSubscriptions).toHaveBeenCalledWith(
      'user-1',
      expect.arrayContaining([
        'https://push.example.com/gone-410',
        'https://push.example.com/gone-404',
      ]),
    );
  });

  it('push notification failure is non-fatal and reports channel-level result (VAL-SCHED-008)', async () => {
    process.env.WEB_PUSH_VAPID_PUBLIC_KEY = 'pub-key';
    process.env.WEB_PUSH_VAPID_PRIVATE_KEY = 'priv-key';

    const pushSchedule = {
      ...schedule,
      notifications: { email: true, sms: false, push: true },
    };

    getUserNotificationConfig.mockResolvedValue({
      user: { name: 'Test' },
      settings: {
        email: { enabled: true, address: 'test@example.com' },
        sms: { enabled: false },
        push: {
          enabled: true,
          subscriptions: [
            { endpoint: 'https://push.example.com/1', keys: { p256dh: 'a', auth: 'b' } },
          ],
        },
      },
      capabilities: { email: true, sms: false, push: true },
    });

    // Push delivery rejects all subscriptions with non-HTTP errors
    webpush.sendNotification.mockRejectedValueOnce(new Error('Network timeout'));

    const result = await sendScheduledRunNotifications({
      userId: 'user-1',
      schedule: pushSchedule,
      result: { conversationId: 'c1', preview: 'ok', error: null },
    });

    // Email should still succeed even though push failed — non-fatal channel isolation
    expect(result.email.status).toBe('sent');
    // Push reports channel-level failure without crashing the notification flow
    expect(result.push.status).toBe('failed');
    expect(result.push.provider).toBe('web-push');
    expect(result.push.details.sentCount).toBe(0);
    expect(result.push.details.failedCount).toBe(1);
  });
});
