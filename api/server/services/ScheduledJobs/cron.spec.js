const {
  getNextRunAt,
  validateSchedule,
  assertValidTimezone,
  normalizeCronExpression,
} = require('./cron');

describe('cron utilities', () => {
  describe('normalizeCronExpression', () => {
    it('trims whitespace from a cron expression', () => {
      expect(normalizeCronExpression('  0 9 * * *  ')).toBe('0 9 * * *');
    });

    it('collapses multiple internal spaces', () => {
      expect(normalizeCronExpression('0  9  *  *  *')).toBe('0 9 * * *');
    });

    it('returns empty string for empty input', () => {
      expect(normalizeCronExpression('')).toBe('');
    });
  });

  describe('assertValidTimezone', () => {
    it('returns the timezone when valid', () => {
      expect(assertValidTimezone('America/New_York')).toBe('America/New_York');
    });

    it('accepts UTC', () => {
      expect(assertValidTimezone('UTC')).toBe('UTC');
    });

    it('throws for an invalid timezone', () => {
      expect(() => assertValidTimezone('Invalid/Timezone')).toThrow('Invalid timezone');
    });
  });

  describe('getNextRunAt', () => {
    // cron-parser strict mode expects 6 fields: second minute hour day month weekday
    it('returns a Date for a valid 6-field cron and timezone', () => {
      const result = getNextRunAt('0 0 9 * * *', 'UTC');
      expect(result).toBeInstanceOf(Date);
      expect(result.getTime()).toBeGreaterThan(Date.now());
    });

    it('computes the next occurrence after the provided currentDate', () => {
      const baseDate = new Date('2025-06-15T08:00:00Z');
      const result = getNextRunAt('0 0 9 * * *', 'UTC', baseDate);
      expect(result.getTime()).toBeGreaterThan(baseDate.getTime());
      // Should be 2025-06-15 09:00 UTC
      expect(result.getUTCHours()).toBe(9);
      expect(result.getUTCDate()).toBe(15);
    });

    it('advances past the current second', () => {
      const baseDate = new Date('2025-06-15T09:00:00Z');
      const result = getNextRunAt('0 0 9 * * *', 'UTC', baseDate);
      // Should be next day 09:00 UTC since we're at exactly 09:00:00
      expect(result.getTime()).toBeGreaterThan(baseDate.getTime());
    });

    it('throws for an invalid cron expression', () => {
      expect(() => getNextRunAt('bad cron', 'UTC')).toThrow();
    });

    it('throws for an invalid timezone', () => {
      expect(() => getNextRunAt('0 0 9 * * *', 'Invalid/Timezone')).toThrow('Invalid timezone');
    });
  });

  describe('validateSchedule', () => {
    it('does not throw for a valid 6-field cron and timezone', () => {
      expect(() => validateSchedule('0 0 9 * * *', 'America/Chicago')).not.toThrow();
    });

    it('throws for an invalid cron expression', () => {
      expect(() => validateSchedule('bad', 'UTC')).toThrow();
    });

    it('throws for an invalid timezone', () => {
      expect(() => validateSchedule('0 0 9 * * *', 'Fake/Zone')).toThrow('Invalid timezone');
    });
  });
});
