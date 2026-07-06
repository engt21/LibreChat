const JsonUtility = require('../JsonUtility');

describe('JsonUtility', () => {
  const tool = new JsonUtility({ override: true });

  it('validates and formats JSON', async () => {
    const valid = JSON.parse(await tool._call({ operation: 'validate', json: '{"a":1}' }));
    const formatted = JSON.parse(
      await tool._call({ operation: 'format', json: '{"a":1}', indent: 2 }),
    );

    expect(valid).toEqual({ valid: true, type: 'object' });
    expect(formatted.result).toBe('{\n  "a": 1\n}');
  });

  it('resolves escaped RFC 6901 JSON Pointers', async () => {
    const result = JSON.parse(
      await tool._call({
        operation: 'pointer_get',
        json: '{"a/b":{"~key":["value"]}}',
        pointer: '/a~1b/~0key/0',
      }),
    );

    expect(result.value).toBe('value');
  });

  it('returns deterministic parse errors', async () => {
    const result = JSON.parse(await tool._call({ operation: 'validate', json: '{' }));
    expect(result.valid).toBe(false);
    expect(result.error).toContain('JSON');
  });
});
