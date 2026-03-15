const axios = require('axios');
const webpush = require('web-push');
const { logger } = require('@librechat/data-schemas');
const { sendEmail } = require('~/server/utils');
const {
  SMS_PROVIDERS,
  getUserNotificationConfig,
  removePushSubscriptions,
} = require('~/server/services/ScheduledJobs/userNotifications');

const MAX_PREVIEW_LENGTH = 280;
const MAX_SMS_LENGTH = 1200;

function truncateText(value = '', maxLength = MAX_PREVIEW_LENGTH) {
  const text = String(value ?? '').trim();
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function buildConversationUrl(conversationId) {
  if (!conversationId) {
    return null;
  }

  try {
    return new URL(
      `/c/${conversationId}`,
      process.env.DOMAIN_CLIENT || 'http://localhost:3080',
    ).toString();
  } catch (_error) {
    return `${process.env.DOMAIN_CLIENT || 'http://localhost:3080'}/c/${conversationId}`;
  }
}

function buildNotificationContext({ schedule, result }) {
  const appTitle = process.env.APP_TITLE || 'LibreChat';
  const succeeded = !result.error;
  const statusLabel = succeeded ? 'completed' : 'failed';
  const conversationUrl = buildConversationUrl(result.conversationId);
  const preview = truncateText(
    result.preview || result.error || 'Open LibreChat to review the scheduled run.',
  );

  return {
    appTitle,
    succeeded,
    statusLabel,
    preview,
    conversationUrl,
    title: `${appTitle}: ${schedule.name}`,
    subject: `${schedule.name} ${statusLabel}`,
  };
}

async function sendEmailNotification({ destination, schedule, user, result, context }) {
  await sendEmail({
    email: destination,
    subject: context.title,
    payload: {
      name: user?.name || user?.username || destination,
      appTitle: context.appTitle,
      scheduleName: schedule.name,
      status: context.statusLabel,
      prompt: schedule.prompt,
      preview: context.preview,
      error: result.error ? truncateText(result.error, 500) : null,
      conversationUrl: context.conversationUrl,
    },
    template: 'scheduledRunNotification.handlebars',
  });

  return {
    status: 'sent',
    destination,
    provider: process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN ? 'mailgun' : 'smtp',
  };
}

function buildSmsMessage(context) {
  return truncateText(
    `${context.title} ${context.statusLabel}. ${context.preview}${
      context.conversationUrl ? ` ${context.conversationUrl}` : ''
    }`,
    MAX_SMS_LENGTH,
  );
}

async function sendSmsNotification({ destination, context }) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;
  const body = buildSmsMessage(context);

  const params = new URLSearchParams({
    To: destination,
    From: fromNumber,
    Body: body,
  });

  await axios.post(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    params,
    {
      auth: {
        username: accountSid,
        password: authToken,
      },
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    },
  );

  return {
    status: 'sent',
    destination,
    provider: 'twilio',
  };
}

async function sendCarrierGatewayNotification({ destination, context }) {
  await sendEmail({
    email: destination,
    subject: context.appTitle,
    payload: {
      name: destination,
      message: buildSmsMessage(context),
    },
    template: 'scheduledRunSmsGateway.handlebars',
  });

  return {
    status: 'sent',
    destination,
    provider: SMS_PROVIDERS.CARRIER_GATEWAY,
  };
}

function configureWebPush() {
  const subject =
    process.env.WEB_PUSH_SUBJECT || `mailto:${process.env.EMAIL_FROM || 'noreply@librechat.ai'}`;

  webpush.setVapidDetails(
    subject,
    process.env.WEB_PUSH_VAPID_PUBLIC_KEY,
    process.env.WEB_PUSH_VAPID_PRIVATE_KEY,
  );
}

async function sendPushNotification({ subscriptions, schedule, context, result }) {
  configureWebPush();

  const expiredEndpoints = [];
  const deliveries = await Promise.allSettled(
    subscriptions.map((subscription) =>
      webpush.sendNotification(
        subscription,
        JSON.stringify({
          title: context.title,
          body: context.preview,
          url: context.conversationUrl,
          tag: schedule.scheduleId,
          status: context.statusLabel,
          conversationId: result.conversationId,
        }),
      ),
    ),
  );

  let sentCount = 0;
  let failedCount = 0;

  deliveries.forEach((delivery, index) => {
    if (delivery.status === 'fulfilled') {
      sentCount += 1;
      return;
    }

    failedCount += 1;
    const error = delivery.reason;
    if (error?.statusCode === 404 || error?.statusCode === 410) {
      expiredEndpoints.push(subscriptions[index]?.endpoint);
    }
  });

  return {
    status: sentCount > 0 ? 'sent' : 'failed',
    provider: 'web-push',
    destination: `${sentCount}/${subscriptions.length} subscriptions`,
    details: {
      sentCount,
      failedCount,
      expiredEndpoints,
    },
  };
}

async function sendScheduledRunNotifications({ userId, schedule, result }) {
  const config = await getUserNotificationConfig(userId);
  if (!config) {
    return {};
  }

  const { user, settings, capabilities } = config;
  const context = buildNotificationContext({ schedule, result });
  const channelResults = {};

  if (schedule.notifications?.email) {
    if (!capabilities.email) {
      channelResults.email = { status: 'skipped', reason: 'Email delivery is not configured' };
    } else if (!settings.email.enabled) {
      channelResults.email = { status: 'skipped', reason: 'Email notifications are disabled' };
    } else if (!settings.email.address) {
      channelResults.email = { status: 'skipped', reason: 'No email address configured' };
    } else {
      try {
        channelResults.email = await sendEmailNotification({
          destination: settings.email.address,
          schedule,
          user,
          result,
          context,
        });
      } catch (error) {
        logger.error('[ScheduledJobs] Failed to send email notification', error);
        channelResults.email = {
          status: 'failed',
          reason: error.message,
          destination: settings.email.address,
          provider: 'email',
        };
      }
    }
  }

  if (schedule.notifications?.sms) {
    if (!capabilities.sms) {
      channelResults.sms = { status: 'skipped', reason: 'SMS delivery is not configured' };
    } else if (!settings.sms.enabled) {
      channelResults.sms = { status: 'skipped', reason: 'SMS notifications are disabled' };
    } else {
      try {
        if (settings.sms.provider === SMS_PROVIDERS.CARRIER_GATEWAY) {
          if (!capabilities.smsProviders?.carrierGateway) {
            channelResults.sms = {
              status: 'skipped',
              reason: 'Carrier gateway delivery requires email to be configured',
            };
          } else if (!settings.sms.gatewayAddress) {
            channelResults.sms = {
              status: 'skipped',
              reason: 'No carrier gateway email address configured',
            };
          } else {
            channelResults.sms = await sendCarrierGatewayNotification({
              destination: settings.sms.gatewayAddress,
              context,
            });
          }
        } else if (!capabilities.smsProviders?.twilio) {
          channelResults.sms = {
            status: 'skipped',
            reason: 'Twilio SMS delivery is not configured',
          };
        } else if (!settings.sms.phoneNumber) {
          channelResults.sms = { status: 'skipped', reason: 'No phone number configured' };
        } else {
          channelResults.sms = await sendSmsNotification({
            destination: settings.sms.phoneNumber,
            context,
          });
        }
      } catch (error) {
        logger.error('[ScheduledJobs] Failed to send SMS notification', error);
        channelResults.sms = {
          status: 'failed',
          reason: error.message,
          destination:
            settings.sms.provider === SMS_PROVIDERS.CARRIER_GATEWAY
              ? settings.sms.gatewayAddress
              : settings.sms.phoneNumber,
          provider: settings.sms.provider,
        };
      }
    }
  }

  if (schedule.notifications?.push) {
    if (!capabilities.push) {
      channelResults.push = { status: 'skipped', reason: 'Push delivery is not configured' };
    } else if (!settings.push.enabled) {
      channelResults.push = { status: 'skipped', reason: 'Push notifications are disabled' };
    } else if (settings.push.subscriptions.length === 0) {
      channelResults.push = { status: 'skipped', reason: 'No push subscriptions configured' };
    } else {
      try {
        channelResults.push = await sendPushNotification({
          subscriptions: settings.push.subscriptions,
          schedule,
          context,
          result,
        });

        const expiredEndpoints = channelResults.push.details?.expiredEndpoints;
        if (Array.isArray(expiredEndpoints) && expiredEndpoints.length > 0) {
          await removePushSubscriptions(userId, expiredEndpoints);
        }
      } catch (error) {
        logger.error('[ScheduledJobs] Failed to send push notification', error);
        channelResults.push = {
          status: 'failed',
          reason: error.message,
          provider: 'web-push',
        };
      }
    }
  }

  return channelResults;
}

module.exports = {
  sendScheduledRunNotifications,
  buildConversationUrl,
  truncateText,
};
