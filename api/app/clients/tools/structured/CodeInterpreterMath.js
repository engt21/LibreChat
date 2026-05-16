const axios = require('axios');
const { Tool } = require('@langchain/core/tools');
const { logger } = require('@librechat/data-schemas');

const codeInterpreterMathJsonSchema = {
  type: 'object',
  properties: {
    code: {
      type: 'string',
      description: [
        'Python code to execute for advanced mathematical computation.',
        'The code interpreter has numpy, scipy, sympy, and the Python standard library.',
        '',
        'Use this tool when the scientific_calculator is insufficient, such as:',
        '- Symbolic algebra: solving equations, simplification, integration, differentiation',
        '- Linear algebra: eigenvalues, SVD, large matrix operations',
        '- Numerical methods: optimization, root finding, interpolation, ODE solving',
        '- Statistical tests: t-test, chi-square, ANOVA, regression',
        '- Probability distributions: PDF, CDF, sampling, confidence intervals',
        '- Data transformations: FFT, convolutions, filtering',
        '- Any multi-step computation that benefits from variables and loops',
        '',
        'Print the final result so it appears in stdout.',
        'Example: "import numpy as np; data = [1,2,3,4,5]; print(f\'mean={np.mean(data)}, std={np.std(data)}\')"',
      ].join('\n'),
    },
    description: {
      type: 'string',
      description: 'Brief description of what the computation does, for logging and context.',
    },
  },
  required: ['code'],
};

class CodeInterpreterMath extends Tool {
  static lc_name() {
    return 'code_interpreter_math';
  }

  static get jsonSchema() {
    return codeInterpreterMathJsonSchema;
  }

  constructor(fields = {}) {
    super(fields);
    this.name = 'code_interpreter_math';
    this.description = [
      'Advanced mathematical computation via Python code execution.',
      'Use for symbolic math, statistical tests, numerical methods,',
      'linear algebra, optimization, and any computation too complex',
      'for the scientific calculator. Has numpy, scipy, and sympy.',
    ].join(' ');
    this.schema = codeInterpreterMathJsonSchema;
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
    try {
      const { code, description } = input;

      if (!code || typeof code !== 'string') {
        return JSON.stringify({ error: 'Code is required and must be a string' });
      }

      if (code.length > 50000) {
        return JSON.stringify({ error: 'Code too long (max 50000 characters)' });
      }

      logger.debug(`[CodeInterpreterMath] Executing: ${description || code.substring(0, 100)}...`);

      const response = await axios.post(
        `${this.baseUrl}/exec`,
        {
          lang: 'python',
          code,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': this.apiKey,
          },
          timeout: 60000,
        },
      );

      const { stdout, stderr, exit_code } = response.data;

      if (exit_code !== 0) {
        return JSON.stringify({
          error: 'Code execution failed',
          stderr: stderr || 'Unknown error',
          exit_code,
        });
      }

      return JSON.stringify({
        result: stdout?.trim() || '(no output — add a print statement)',
        ...(stderr ? { warnings: stderr } : {}),
        ...(description ? { description } : {}),
      });
    } catch (error) {
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        logger.warn('[CodeInterpreterMath] Code interpreter service unavailable');
        return JSON.stringify({
          error:
            'Code interpreter service is not available. Use the scientific_calculator for basic math.',
        });
      }

      logger.error('[CodeInterpreterMath] Error:', error.message);
      return JSON.stringify({ error: error.message });
    }
  }
}

module.exports = CodeInterpreterMath;
