jest.mock('axios');

const axios = require('axios');
const CodeInterpreterMath = require('../CodeInterpreterMath');

describe('CodeInterpreterMath', () => {
  let tool;

  beforeEach(() => {
    jest.clearAllMocks();
    tool = new CodeInterpreterMath({ override: true });
  });

  describe('basic info', () => {
    it('has correct name and schema', () => {
      expect(tool.name).toBe('code_interpreter_math');
      expect(CodeInterpreterMath.jsonSchema).toBeDefined();
      expect(CodeInterpreterMath.jsonSchema.properties.code).toBeDefined();
    });
  });

  describe('successful execution', () => {
    it('returns stdout on success', async () => {
      axios.post.mockResolvedValueOnce({
        data: { stdout: '42\n', stderr: '', exit_code: 0 },
      });

      const result = JSON.parse(
        await tool._call({ code: 'print(6 * 7)', description: 'multiply' }),
      );
      expect(result.result).toBe('42');
      expect(result.description).toBe('multiply');

      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('/exec'),
        { lang: 'python', code: 'print(6 * 7)' },
        expect.objectContaining({ timeout: 60000 }),
      );
    });

    it('includes warnings from stderr when present', async () => {
      axios.post.mockResolvedValueOnce({
        data: { stdout: '3.14\n', stderr: 'DeprecationWarning: ...', exit_code: 0 },
      });

      const result = JSON.parse(
        await tool._call({ code: 'import math; print(round(math.pi, 2))' }),
      );
      expect(result.result).toBe('3.14');
      expect(result.warnings).toContain('DeprecationWarning');
    });
  });

  describe('execution failure', () => {
    it('returns error on non-zero exit code', async () => {
      axios.post.mockResolvedValueOnce({
        data: { stdout: '', stderr: 'NameError: name x is not defined', exit_code: 1 },
      });

      const result = JSON.parse(await tool._call({ code: 'print(x)' }));
      expect(result.error).toBe('Code execution failed');
      expect(result.stderr).toContain('NameError');
    });
  });

  describe('connection errors', () => {
    it('handles service unavailable gracefully', async () => {
      const err = new Error('connect ECONNREFUSED');
      err.code = 'ECONNREFUSED';
      axios.post.mockRejectedValueOnce(err);

      const result = JSON.parse(await tool._call({ code: 'print(1)' }));
      expect(result.error).toContain('not available');
    });
  });

  describe('input validation', () => {
    it('returns error for empty code', async () => {
      const result = JSON.parse(await tool._call({ code: '' }));
      expect(result.error).toContain('required');
    });

    it('returns error for overly long code', async () => {
      const result = JSON.parse(await tool._call({ code: 'x'.repeat(50001) }));
      expect(result.error).toContain('too long');
    });
  });
});
