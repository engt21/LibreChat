const DEFAULT_MAX_GRAFT_MESSAGES = 250;
const DEFAULT_MAX_GRAFT_PAYLOAD_BYTES = 8 * 1024 * 1024;

const GRAFT_BRIDGE_TEXT =
  'An alternate completed assistant generation was grafted into this branch. Treat the following assistant message and any copied continuation as prior conversation context.';

const PARTIAL_GRAFT_WARNING =
  'One or both grafted generations are incomplete. Treat their content as partial prior context and do not assume that either represents a finished answer.';

function parsePositiveIntegerEnv(name, fallback) {
  const rawValue = process.env[name];
  if (typeof rawValue !== 'string') {
    return fallback;
  }

  const trimmedValue = rawValue.trim();
  if (!/^\d+$/.test(trimmedValue)) {
    return fallback;
  }

  const parsedValue = Number.parseInt(trimmedValue, 10);
  if (!Number.isSafeInteger(parsedValue) || parsedValue <= 0) {
    return fallback;
  }

  return parsedValue;
}

class GenerationGraftError extends Error {
  constructor(code, message, statusCode = 400, details = {}) {
    super(message);
    this.name = 'GenerationGraftError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Object.assign(this, details);

    Error.captureStackTrace?.(this, GenerationGraftError);
  }
}

const MAX_GRAFT_MESSAGES = parsePositiveIntegerEnv(
  'GRAFT_MAX_MESSAGES',
  DEFAULT_MAX_GRAFT_MESSAGES,
);

const MAX_GRAFT_PAYLOAD_BYTES = parsePositiveIntegerEnv(
  'GRAFT_MAX_PAYLOAD_BYTES',
  DEFAULT_MAX_GRAFT_PAYLOAD_BYTES,
);

module.exports = {
  GRAFT_BRIDGE_TEXT,
  PARTIAL_GRAFT_WARNING,
  COMPLETE_GRAFT_BRIDGE_TEXT: GRAFT_BRIDGE_TEXT,
  PARTIAL_GRAFT_WARNING_TEXT: PARTIAL_GRAFT_WARNING,
  DEFAULT_MAX_GRAFT_MESSAGES,
  DEFAULT_MAX_GRAFT_PAYLOAD_BYTES,
  MAX_GRAFT_MESSAGES,
  MAX_GRAFT_PAYLOAD_BYTES,
  GenerationGraftError,
  parsePositiveIntegerEnv,
};
