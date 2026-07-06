const StringUtility = require('../StringUtility');

describe('StringUtility', () => {
  const tool = new StringUtility({ override: true });

  it('counts overlapping literal substrings', async () => {
    const result = JSON.parse(
      await tool._call({
        operation: 'substring_count',
        text: 'banana',
        search: 'ana',
        overlapping: true,
      }),
    );
    expect(result.count).toBe(2);
  });

  it('replaces literals case-insensitively without regex semantics', async () => {
    const result = JSON.parse(
      await tool._call({
        operation: 'literal_replace',
        text: 'A.b a.B',
        search: 'a.b',
        replacement: 'x',
        case_sensitive: false,
      }),
    );
    expect(result.result).toBe('x x');
  });

  it('sorts and deduplicates lines deterministically', async () => {
    const sorted = JSON.parse(
      await tool._call({ operation: 'sort_lines', text: 'item10\nitem2\nitem1' }),
    );
    const unique = JSON.parse(
      await tool._call({
        operation: 'unique_lines',
        text: 'Alpha\nalpha\nBeta',
        case_sensitive: false,
      }),
    );

    expect(sorted.result).toBe('item1\nitem2\nitem10');
    expect(unique.result).toBe('Alpha\nBeta');
  });

  it('computes stable SHA-256 hashes', async () => {
    const result = JSON.parse(await tool._call({ operation: 'sha256', text: 'hello' }));
    expect(result.result).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });
});
