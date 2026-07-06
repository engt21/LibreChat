const axios = require('axios');
const { Tool } = require('@langchain/core/tools');
const { logger } = require('@librechat/data-schemas');

const localCodeInterpreterJsonSchema = {
  type: 'object',
  properties: {
    code: {
      type: 'string',
      description: 'Code to execute in the self-hosted sandbox.',
    },
    language: {
      type: 'string',
      enum: ['python', 'javascript', 'typescript', 'bash'],
      description: 'Execution language. Defaults to python.',
    },
    description: {
      type: 'string',
      description: 'Brief explanation of what the code is intended to do.',
    },
  },
  required: ['code'],
};

class LocalCodeInterpreter extends Tool {
  static lc_name() {
    return 'local_code_interpreter';
  }

  static get jsonSchema() {
    return localCodeInterpreterJsonSchema;
  }

  constructor(fields = {}) {
    super(fields);
    this.name = 'local_code_interpreter';
    this.description = [
      'General-purpose code execution in the user-managed local sandbox.',
      'Use for data analysis, scripting, package-backed computation, file generation,',
      'or tasks that require running code rather than only reasoning about it.',
    ].join(' ');
    this.schema = localCodeInterpreterJsonSchema;
    this.override = fields.override ?? false;
    this.baseUrl =
      fields.CODE_INTERPRETER_URL ||
      process.env.LIBRECHAT_CODE_BASEURL ||
      'http://code-interpreter-local:8000/v1';
    this.apiKey =
      fields.CODE_INTERPRETER_API_KEY ||
      process.env.LIBRECHAT_CODE_API_KEY ||
      'librechat-local-code-dev-key';
  }

  async _call(input) {
    const code = input?.code;
    if (!code || typeof code !== 'string') {
      return JSON.stringify({ error: 'Code is required and must be a string.' });
    }
    if (code.length > 100000) {
      return JSON.stringify({ error: 'Code is too long (maximum 100000 characters).' });
    }

    const language = input.language || 'python';
    try {
      const response = await axios.post(
        `${this.baseUrl}/exec`,
        { lang: language, code },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': this.apiKey,
          },
          timeout: 120000,
        },
      );
      return JSON.stringify(response.data);
    } catch (error) {
      logger.error('[LocalCodeInterpreter] Execution failed', error);
      return JSON.stringify({
        error: error.response?.data?.detail || error.message || 'Code execution failed.',
        language,
      });
    }
  }
}

module.exports = LocalCodeInterpreter;
