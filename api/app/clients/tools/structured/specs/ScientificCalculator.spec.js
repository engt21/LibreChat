const ScientificCalculator = require('../ScientificCalculator');

describe('ScientificCalculator', () => {
  let calc;

  beforeEach(() => {
    calc = new ScientificCalculator({ override: true });
  });

  describe('basic info', () => {
    it('has correct name and schema', () => {
      expect(calc.name).toBe('scientific_calculator');
      expect(ScientificCalculator.jsonSchema).toBeDefined();
      expect(ScientificCalculator.jsonSchema.properties.expression).toBeDefined();
    });
  });

  describe('PEMDAS arithmetic', () => {
    it('evaluates addition', async () => {
      const result = JSON.parse(await calc._call({ expression: '2 + 3' }));
      expect(result.result).toBe(5);
    });

    it('respects operator precedence', async () => {
      const result = JSON.parse(await calc._call({ expression: '2 + 3 * 4' }));
      expect(result.result).toBe(14);
    });

    it('respects parentheses', async () => {
      const result = JSON.parse(await calc._call({ expression: '(2 + 3) * 4' }));
      expect(result.result).toBe(20);
    });

    it('handles exponents', async () => {
      const result = JSON.parse(await calc._call({ expression: '2^10' }));
      expect(result.result).toBe(1024);
    });

    it('handles division', async () => {
      const result = JSON.parse(await calc._call({ expression: '10 / 3' }));
      expect(result.result).toBeCloseTo(3.333333, 5);
    });
  });

  describe('trigonometry', () => {
    it('computes sin', async () => {
      const result = JSON.parse(await calc._call({ expression: 'sin(pi/2)' }));
      expect(result.result).toBeCloseTo(1, 10);
    });

    it('computes cos', async () => {
      const result = JSON.parse(await calc._call({ expression: 'cos(0)' }));
      expect(result.result).toBe(1);
    });

    it('computes atan2', async () => {
      const result = JSON.parse(await calc._call({ expression: 'atan2(1, 1)' }));
      expect(result.result).toBeCloseTo(Math.PI / 4, 10);
    });
  });

  describe('logarithms', () => {
    it('computes natural log', async () => {
      const result = JSON.parse(await calc._call({ expression: 'log(e)' }));
      expect(result.result).toBeCloseTo(1, 10);
    });

    it('computes log base 10', async () => {
      const result = JSON.parse(await calc._call({ expression: 'log10(1000)' }));
      expect(result.result).toBe(3);
    });

    it('computes log base 2', async () => {
      const result = JSON.parse(await calc._call({ expression: 'log2(8)' }));
      expect(result.result).toBe(3);
    });

    it('computes log with custom base', async () => {
      const result = JSON.parse(await calc._call({ expression: 'log(100, 10)' }));
      expect(result.result).toBe(2);
    });
  });

  describe('statistics', () => {
    it('computes mean', async () => {
      const result = JSON.parse(await calc._call({ expression: 'mean([1,2,3,4,5])' }));
      expect(result.result).toBe(3);
    });

    it('computes median', async () => {
      const result = JSON.parse(await calc._call({ expression: 'median([1,2,3,4,5])' }));
      expect(result.result).toBe(3);
    });

    it('computes std', async () => {
      const result = JSON.parse(await calc._call({ expression: 'std([2,4,4,4,5,5,7,9])' }));
      expect(result.result).toBeCloseTo(2, 0);
    });

    it('computes variance', async () => {
      const result = JSON.parse(await calc._call({ expression: 'variance([1,2,3,4,5])' }));
      expect(result.result).toBe(2.5);
    });

    it('computes sum', async () => {
      const result = JSON.parse(await calc._call({ expression: 'sum([1,2,3,4,5])' }));
      expect(result.result).toBe(15);
    });

    it('computes min and max', async () => {
      const min = JSON.parse(await calc._call({ expression: 'min([3,7,1,9])' }));
      const max = JSON.parse(await calc._call({ expression: 'max([3,7,1,9])' }));
      expect(min.result).toBe(1);
      expect(max.result).toBe(9);
    });
  });

  describe('combinatorics', () => {
    it('computes factorial', async () => {
      const result = JSON.parse(await calc._call({ expression: 'factorial(5)' }));
      expect(result.result).toBe(120);
    });

    it('computes combinations', async () => {
      const result = JSON.parse(await calc._call({ expression: 'combinations(10, 3)' }));
      expect(result.result).toBe(120);
    });

    it('computes permutations', async () => {
      const result = JSON.parse(await calc._call({ expression: 'permutations(10, 3)' }));
      expect(result.result).toBe(720);
    });
  });

  describe('powers and roots', () => {
    it('computes sqrt', async () => {
      const result = JSON.parse(await calc._call({ expression: 'sqrt(144)' }));
      expect(result.result).toBe(12);
    });

    it('computes cbrt', async () => {
      const result = JSON.parse(await calc._call({ expression: 'cbrt(27)' }));
      expect(result.result).toBe(3);
    });

    it('computes nthRoot', async () => {
      const result = JSON.parse(await calc._call({ expression: 'nthRoot(81, 4)' }));
      expect(result.result).toBe(3);
    });
  });

  describe('modular arithmetic', () => {
    it('computes mod', async () => {
      const result = JSON.parse(await calc._call({ expression: 'mod(17, 5)' }));
      expect(result.result).toBe(2);
    });

    it('computes gcd', async () => {
      const result = JSON.parse(await calc._call({ expression: 'gcd(12, 8)' }));
      expect(result.result).toBe(4);
    });

    it('computes lcm', async () => {
      const result = JSON.parse(await calc._call({ expression: 'lcm(4, 6)' }));
      expect(result.result).toBe(12);
    });
  });

  describe('constants', () => {
    it('knows pi', async () => {
      const result = JSON.parse(await calc._call({ expression: 'pi' }));
      expect(result.result).toBeCloseTo(Math.PI, 10);
    });

    it('knows e', async () => {
      const result = JSON.parse(await calc._call({ expression: 'e' }));
      expect(result.result).toBeCloseTo(Math.E, 10);
    });
  });

  describe('variable assignment', () => {
    it('supports multi-expression with semicolons', async () => {
      const result = JSON.parse(await calc._call({ expression: 'x = 5; y = 3; x^2 + y^2' }));
      expect(result.result).toBe(34);
    });
  });

  describe('precision', () => {
    it('respects custom precision', async () => {
      const result = JSON.parse(await calc._call({ expression: 'pi', precision: 6 }));
      expect(result.result).toBeCloseTo(3.14159, 4);
    });
  });

  describe('error handling', () => {
    it('returns error for invalid expression', async () => {
      const result = JSON.parse(await calc._call({ expression: '2 +* 3' }));
      expect(result.error).toBeDefined();
    });

    it('returns error for empty expression', async () => {
      const result = JSON.parse(await calc._call({ expression: '' }));
      expect(result.error).toBeDefined();
    });

    it('blocks import function', async () => {
      const result = JSON.parse(await calc._call({ expression: 'import({})' }));
      expect(result.error).toContain('disabled');
    });
  });

  describe('unit conversion', () => {
    it('converts inches to cm', async () => {
      const result = JSON.parse(await calc._call({ expression: '5 inch to cm' }));
      expect(String(result.result)).toContain('cm');
    });
  });
});
