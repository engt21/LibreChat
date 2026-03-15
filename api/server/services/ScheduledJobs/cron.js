const { CronExpressionParser } = require('cron-parser');

function normalizeCronExpression(cron = '') {
  return cron.trim().replace(/\s+/g, ' ');
}

function assertValidTimezone(timezone) {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return timezone;
  } catch (_error) {
    throw new Error('Invalid timezone');
  }
}

function getNextRunAt(cron, timezone, currentDate = new Date()) {
  const normalizedCron = normalizeCronExpression(cron);
  const validTimezone = assertValidTimezone(timezone);
  const interval = CronExpressionParser.parse(normalizedCron, {
    currentDate,
    tz: validTimezone,
    strict: true,
  });

  return interval.next().toDate();
}

function validateSchedule(cron, timezone) {
  getNextRunAt(cron, timezone, new Date());
}

module.exports = {
  getNextRunAt,
  validateSchedule,
  assertValidTimezone,
  normalizeCronExpression,
};
