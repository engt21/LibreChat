const { Tool } = require('@langchain/core/tools');
const { create, all } = require('mathjs');
const { logger } = require('@librechat/data-schemas');

const math = create(all, {});

// Restrict mathjs to prevent arbitrary code execution
const limitedEvaluate = math.evaluate;
math.import(
  {
    import: function () {
      throw new Error('Function import is disabled');
    },
    createUnit: function () {
      throw new Error('Function createUnit is disabled');
    },
    simplify: function () {
      throw new Error('Function simplify is disabled');
    },
    derivative: function () {
      throw new Error('Function derivative is disabled');
    },
  },
  { override: true },
);

const scientificCalculatorJsonSchema = {
  type: 'object',
  properties: {
    expression: {
      type: 'string',
      description: [
        'A mathematical expression to evaluate using mathjs syntax.',
        '',
        'Arithmetic (PEMDAS): 2 + 3 * (4 - 1) / 2, 2^10, 5!',
        'Constants: pi, e, phi, tau, Infinity',
        'Trig: sin(pi/4), cos(0), tan(pi/3), asin(0.5), atan2(1,1)',
        'Hyperbolic: sinh(1), cosh(1), tanh(0.5)',
        'Logarithms: log(100, 10), log2(8), log10(1000), log(e) (natural)',
        'Powers/roots: sqrt(144), cbrt(27), nthRoot(81, 4), pow(2, 10)',
        'Rounding: round(3.7), ceil(3.2), floor(3.8), fix(3.7)',
        'Absolute/sign: abs(-5), sign(-3)',
        'Statistics: mean([1,2,3]), median([1,2,3,4]), std([1,2,3]), variance([1,2,3])',
        '  min([3,7,1]), max([3,7,1]), sum([1,2,3]), prod([1,2,3])',
        'Combinatorics: factorial(5), combinations(10,3), permutations(10,3)',
        'Modular: mod(17, 5), gcd(12, 8), lcm(4, 6)',
        'Comparison: max(3, 7), min(2, 9)',
        'Bitwise: bitAnd(5, 3), bitOr(5, 3), bitXor(5, 3), leftShift(1, 3)',
        'Complex: complex(3, 4), abs(complex(3,4)), arg(complex(3,4))',
        'Unit conversion: 5 inch to cm, 100 fahrenheit to celsius',
        'Matrix: det([[1,2],[3,4]]), inv([[1,2],[3,4]]), transpose([[1,2],[3,4]])',
        '',
        'Multiple expressions separated by semicolons return the last result.',
        'Variable assignment: x = 5; y = 3; x^2 + y^2',
      ].join('\n'),
    },
    precision: {
      type: 'integer',
      description:
        'Number of significant digits for the result (default: 14). Use higher values for precision-sensitive work.',
    },
  },
  required: ['expression'],
};

class ScientificCalculator extends Tool {
  static lc_name() {
    return 'scientific_calculator';
  }

  static get jsonSchema() {
    return scientificCalculatorJsonSchema;
  }

  constructor(fields = {}) {
    super(fields);
    this.name = 'scientific_calculator';
    this.description = [
      'Scientific calculator for precise mathematical computation.',
      'Handles arithmetic (PEMDAS), trigonometry, logarithms, statistics,',
      'combinatorics, unit conversions, and matrix operations.',
      'Use this for any computation that needs an exact numeric answer.',
      'For complex multi-step analysis, symbolic math, or data science,',
      'prefer the code interpreter tool instead.',
    ].join(' ');
    this.schema = scientificCalculatorJsonSchema;
    this.override = fields.override ?? false;
  }

  async _call(input) {
    try {
      const { expression, precision } = input;

      if (!expression || typeof expression !== 'string') {
        return JSON.stringify({ error: 'Expression is required and must be a string' });
      }

      if (expression.length > 2000) {
        return JSON.stringify({
          error: 'Expression too long. Use the code interpreter for complex computations.',
        });
      }

      const scope = {};
      let result = limitedEvaluate(expression, scope);

      // ResultSet from multi-expression: take the last entry
      if (result && result.entries) {
        const entries = result.entries;
        result = entries[entries.length - 1];
      }

      let formatted;
      if (typeof result === 'number') {
        const digits = precision ?? 14;
        formatted = Number(result.toPrecision(digits));
      } else if (result && math.typeOf(result) === 'Unit') {
        formatted = result.toString();
      } else if (result && typeof result.toNumber === 'function') {
        try {
          formatted = result.toNumber();
        } catch {
          formatted = result.toString();
        }
      } else if (Array.isArray(result)) {
        formatted = result;
      } else if (result && typeof result.toString === 'function') {
        formatted = result.toString();
      } else {
        formatted = result;
      }

      return JSON.stringify({ result: formatted, expression });
    } catch (error) {
      logger.debug('[ScientificCalculator] Evaluation error:', error.message);
      return JSON.stringify({
        error: error.message,
        hint: 'Check mathjs syntax. For complex operations, use the code interpreter.',
      });
    }
  }
}

module.exports = ScientificCalculator;
