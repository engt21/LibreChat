const { User } = require('~/db/models');

const EMAIL_REGEX = /\S+@\S+\.\S+/;
const PHONE_REGEX = /^\+?[1-9]\d{6,14}$/;
const SMS_PROVIDERS = {
  TWILIO: 'twilio',
  CARRIER_GATEWAY: 'carrier_gateway',
};

function normalizeSmsProvider(provider, gatewayAddress = '') {
  if (provider === SMS_PROVIDERS.CARRIER_GATEWAY || provider === SMS_PROVIDERS.TWILIO) {
    return provider;
  }

  return gatewayAddress ? SMS_PROVIDERS.CARRIER_GATEWAY : SMS_PROVIDERS.TWILIO;
}

function getNotificationCapabilities() {
  const emailConfigured =
    !!process.env.EMAIL_FROM &&
    ((!!process.env.MAILGUN_API_KEY && !!process.env.MAILGUN_DOMAIN) ||
      ((!!process.env.EMAIL_SERVICE || !!process.env.EMAIL_HOST) &&
        !!process.env.EMAIL_USERNAME &&
        !!process.env.EMAIL_PASSWORD));

  const smsConfigured =
    !!process.env.TWILIO_ACCOUNT_SID &&
    !!process.env.TWILIO_AUTH_TOKEN &&
    !!process.env.TWILIO_FROM_NUMBER;

  const pushConfigured =
    !!process.env.WEB_PUSH_VAPID_PUBLIC_KEY && !!process.env.WEB_PUSH_VAPID_PRIVATE_KEY;

  return {
    email: emailConfigured,
    sms: smsConfigured || emailConfigured,
    smsProviders: {
      twilio: smsConfigured,
      carrierGateway: emailConfigured,
    },
    push: pushConfigured,
    pushPublicKey: pushConfigured ? process.env.WEB_PUSH_VAPID_PUBLIC_KEY : null,
  };
}

function normalizePushSubscriptions(subscriptions) {
  if (!Array.isArray(subscriptions)) {
    return [];
  }

  return subscriptions
    .filter(
      (subscription) =>
        subscription?.endpoint && subscription?.keys?.p256dh && subscription?.keys?.auth,
    )
    .map((subscription) => ({
      endpoint: subscription.endpoint,
      expirationTime: subscription.expirationTime ?? null,
      keys: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
      userAgent: subscription.userAgent ?? '',
      createdAt: subscription.createdAt ?? new Date(),
      updatedAt: subscription.updatedAt ?? new Date(),
    }));
}

function normalizeNotificationDocument(user) {
  const notifications = user?.notifications ?? {};
  const emailAddress = (notifications.email?.address ?? user?.email ?? '').trim().toLowerCase();
  const gatewayAddress = (notifications.sms?.gatewayAddress ?? '').trim().toLowerCase();
  const smsProvider = normalizeSmsProvider(notifications.sms?.provider, gatewayAddress);

  return {
    email: {
      enabled: Boolean(notifications.email?.enabled),
      address: emailAddress,
      verified:
        Boolean(user?.emailVerified) &&
        emailAddress !== '' &&
        emailAddress === (user?.email ?? '').trim().toLowerCase(),
    },
    sms: {
      enabled: Boolean(notifications.sms?.enabled),
      provider: smsProvider,
      phoneNumber: (notifications.sms?.phoneNumber ?? '').trim(),
      gatewayAddress,
    },
    push: {
      enabled: Boolean(notifications.push?.enabled),
      subscriptions: normalizePushSubscriptions(notifications.push?.subscriptions),
    },
  };
}

function toPublicNotificationSettings(user) {
  const normalized = normalizeNotificationDocument(user);
  const capabilities = getNotificationCapabilities();

  return {
    email: normalized.email,
    sms: normalized.sms,
    push: {
      enabled: normalized.push.enabled,
      subscriptionCount: normalized.push.subscriptions.length,
    },
    capabilities,
  };
}

async function getUserNotificationRecord(userId) {
  return await User.findById(userId).select('+notifications email emailVerified name').lean();
}

async function getUserNotificationSettings(userId) {
  const user = await getUserNotificationRecord(userId);
  if (!user) {
    return null;
  }

  return toPublicNotificationSettings(user);
}

async function getUserNotificationConfig(userId) {
  const user = await getUserNotificationRecord(userId);
  if (!user) {
    return null;
  }

  return {
    user,
    settings: normalizeNotificationDocument(user),
    capabilities: getNotificationCapabilities(),
  };
}

function sanitizeEmailAddress(address) {
  return (address ?? '').trim().toLowerCase();
}

function sanitizePhoneNumber(phoneNumber) {
  return (phoneNumber ?? '').trim();
}

function validateSettingsPayload(payload = {}) {
  const emailAddress = sanitizeEmailAddress(payload?.email?.address);
  const phoneNumber = sanitizePhoneNumber(payload?.sms?.phoneNumber);
  const gatewayAddress = sanitizeEmailAddress(payload?.sms?.gatewayAddress);
  const smsProvider = normalizeSmsProvider(payload?.sms?.provider, gatewayAddress);

  if (emailAddress && !EMAIL_REGEX.test(emailAddress)) {
    throw new Error('Invalid email address');
  }

  if (payload?.sms?.provider && smsProvider !== payload.sms.provider) {
    throw new Error('Invalid SMS delivery provider');
  }

  if (phoneNumber && !PHONE_REGEX.test(phoneNumber)) {
    throw new Error('Invalid phone number. Use E.164 format, e.g. +15551234567');
  }

  if (gatewayAddress && !EMAIL_REGEX.test(gatewayAddress)) {
    throw new Error('Invalid carrier gateway email address');
  }
}

async function saveNotifications(userId, notifications) {
  return await User.findByIdAndUpdate(
    userId,
    {
      $set: { notifications },
      $unset: { expiresAt: '' },
    },
    {
      new: true,
      runValidators: true,
    },
  )
    .select('+notifications email emailVerified name')
    .lean();
}

async function updateUserNotificationSettings(userId, payload = {}) {
  validateSettingsPayload(payload);

  const user = await getUserNotificationRecord(userId);
  if (!user) {
    return null;
  }

  const current = normalizeNotificationDocument(user);
  const next = {
    email: {
      enabled: payload?.email?.enabled ?? current.email.enabled,
      address:
        sanitizeEmailAddress(payload?.email?.address) || current.email.address || user.email || '',
    },
    sms: {
      enabled: payload?.sms?.enabled ?? current.sms.enabled,
      provider: normalizeSmsProvider(payload?.sms?.provider ?? current.sms.provider),
      phoneNumber: sanitizePhoneNumber(payload?.sms?.phoneNumber) || current.sms.phoneNumber || '',
      gatewayAddress:
        sanitizeEmailAddress(payload?.sms?.gatewayAddress) || current.sms.gatewayAddress || '',
    },
    push: {
      enabled: payload?.push?.enabled ?? current.push.enabled,
      subscriptions: current.push.subscriptions,
    },
  };

  const updated = await saveNotifications(userId, next);
  return toPublicNotificationSettings(updated);
}

function validatePushSubscription(subscription) {
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    throw new Error('Invalid push subscription');
  }
}

async function upsertPushSubscription(userId, subscription, userAgent = '') {
  validatePushSubscription(subscription);

  const user = await getUserNotificationRecord(userId);
  if (!user) {
    return null;
  }

  const current = normalizeNotificationDocument(user);
  const nextSubscription = {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime ?? null,
    keys: {
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    },
    userAgent,
    createdAt:
      current.push.subscriptions.find((existing) => existing.endpoint === subscription.endpoint)
        ?.createdAt ?? new Date(),
    updatedAt: new Date(),
  };

  const subscriptions = current.push.subscriptions.filter(
    (existing) => existing.endpoint !== subscription.endpoint,
  );
  subscriptions.push(nextSubscription);

  const updated = await saveNotifications(userId, {
    email: {
      enabled: current.email.enabled,
      address: current.email.address,
    },
    sms: {
      enabled: current.sms.enabled,
      provider: current.sms.provider,
      phoneNumber: current.sms.phoneNumber,
      gatewayAddress: current.sms.gatewayAddress,
    },
    push: {
      enabled: current.push.enabled,
      subscriptions,
    },
  });

  return toPublicNotificationSettings(updated);
}

async function removePushSubscription(userId, endpoint) {
  const user = await getUserNotificationRecord(userId);
  if (!user) {
    return null;
  }

  const current = normalizeNotificationDocument(user);
  const subscriptions = current.push.subscriptions.filter(
    (subscription) => subscription.endpoint !== endpoint,
  );

  const updated = await saveNotifications(userId, {
    email: {
      enabled: current.email.enabled,
      address: current.email.address,
    },
    sms: {
      enabled: current.sms.enabled,
      provider: current.sms.provider,
      phoneNumber: current.sms.phoneNumber,
      gatewayAddress: current.sms.gatewayAddress,
    },
    push: {
      enabled: current.push.enabled,
      subscriptions,
    },
  });

  return toPublicNotificationSettings(updated);
}

async function removePushSubscriptions(userId, endpoints = []) {
  if (!Array.isArray(endpoints) || endpoints.length === 0) {
    return null;
  }

  const user = await getUserNotificationRecord(userId);
  if (!user) {
    return null;
  }

  const endpointSet = new Set(endpoints);
  const current = normalizeNotificationDocument(user);
  const subscriptions = current.push.subscriptions.filter(
    (subscription) => !endpointSet.has(subscription.endpoint),
  );

  const updated = await saveNotifications(userId, {
    email: {
      enabled: current.email.enabled,
      address: current.email.address,
    },
    sms: {
      enabled: current.sms.enabled,
      provider: current.sms.provider,
      phoneNumber: current.sms.phoneNumber,
      gatewayAddress: current.sms.gatewayAddress,
    },
    push: {
      enabled: current.push.enabled,
      subscriptions,
    },
  });

  return toPublicNotificationSettings(updated);
}

module.exports = {
  EMAIL_REGEX,
  PHONE_REGEX,
  SMS_PROVIDERS,
  getNotificationCapabilities,
  getUserNotificationSettings,
  getUserNotificationConfig,
  updateUserNotificationSettings,
  upsertPushSubscription,
  removePushSubscription,
  removePushSubscriptions,
  normalizeNotificationDocument,
  toPublicNotificationSettings,
};
