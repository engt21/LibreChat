const { Tool } = require('@langchain/core/tools');

const operations = ['validate', 'format', 'minify', 'pointer_get'];

const jsonUtilityJsonSchema = {
  type: 'object',
  properties: {
    operation: {
      type: 'string',
      enum: operations,
      description: 'The deterministic JSON operation to perform.',
    },
    json: {
      type: 'string',
      description: 'The JSON document as text.',
    },
    indent: {
      type: 'integer',
      minimum: 0,
      maximum: 8,
      description: 'Indent width for format. Defaults to 2.',
    },
    pointer: {
      type: 'string',
      description: 'RFC 6901 JSON Pointer for pointer_get, such as /users/0/name.',
    },
  },
  required: ['operation', 'json'],
};

function resolveJsonPointer(value, pointer) {
  if (pointer === '') {
    return value;
  }
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) {
    throw new Error('JSON Pointer must be empty or start with /.');
  }

  return pointer
    .slice(1)
    .split('/')
    .map((token) => token.replace(/~1/gu, '/').replace(/~0/gu, '~'))
    .reduce((current, token) => {
      if (current == null || typeof current !== 'object') {
        throw new Error(`JSON Pointer segment not found: ${token}`);
      }
      if (!Object.prototype.hasOwnProperty.call(current, token)) {
        throw new Error(`JSON Pointer segment not found: ${token}`);
      }
      return current[token];
    }, value);
}

class JsonUtility extends Tool {
  static lc_name() {
    return 'json_utility';
  }

  static get jsonSchema() {
    return jsonUtilityJsonSchema;
  }

  constructor(fields = {}) {
    super(fields);
    this.name = 'json_utility';
    this.description = [
      'Deterministically validate, format, minify, or query JSON with an RFC 6901 JSON Pointer.',
      'Use this for exact JSON syntax and extraction instead of manually rewriting JSON.',
    ].join(' ');
    this.schema = jsonUtilityJsonSchema;
    this.override = fields.override ?? false;
  }

  async _call(input) {
    try {
      if (!input || typeof input.json !== 'string') {
        throw new Error('JSON text is required and must be a string.');
      }
      if (!operations.includes(input.operation)) {
        throw new Error('Unsupported JSON operation.');
      }
      if (input.json.length > 200000) {
        throw new Error('JSON text is too long (maximum 200000 UTF-16 code units).');
      }

      const value = JSON.parse(input.json);
      switch (input.operation) {
        case 'validate':
          return JSON.stringify({
            valid: true,
            type: Array.isArray(value) ? 'array' : typeof value,
          });
        case 'format':
          return JSON.stringify({
            operation: input.operation,
            result: JSON.stringify(value, null, input.indent ?? 2),
          });
        case 'minify':
          return JSON.stringify({ operation: input.operation, result: JSON.stringify(value) });
        case 'pointer_get':
          return JSON.stringify({
            operation: input.operation,
            pointer: input.pointer ?? '',
            value: resolveJsonPointer(value, input.pointer ?? ''),
          });
        default:
          throw new Error('Unsupported JSON operation.');
      }
    } catch (error) {
      return JSON.stringify({ valid: false, error: error.message });
    }
  }
}

module.exports = JsonUtility;
