const TextAnalyzer = require('../TextAnalyzer');

describe('TextAnalyzer', () => {
  let analyzer;

  beforeEach(() => {
    analyzer = new TextAnalyzer({ override: true });
  });

  it('exposes a structured deterministic text tool', () => {
    expect(analyzer.name).toBe('text_analyzer');
    expect(TextAnalyzer.jsonSchema.properties.text).toBeDefined();
  });

  it('counts words, lines, bytes, and Unicode characters', async () => {
    const result = JSON.parse(await analyzer._call({ text: 'Hello 👨‍👩‍👧‍👦 world\nSecond line' }));

    expect(result).toEqual(
      expect.objectContaining({
        characters: 25,
        words: 4,
        lines: 2,
        sentences: 2,
        utf8_bytes: 49,
        non_whitespace_characters: 27,
      }),
    );
    expect(result.code_points).toBeGreaterThan(result.characters);
    expect(result.utf16_code_units).toBeGreaterThan(result.code_points);
  });

  it('returns zero counts for empty text', async () => {
    const result = JSON.parse(await analyzer._call({ text: '' }));

    expect(result).toEqual({
      characters: 0,
      code_points: 0,
      utf16_code_units: 0,
      utf8_bytes: 0,
      words: 0,
      sentences: 0,
      lines: 0,
      non_whitespace_characters: 0,
    });
  });

  it('rejects missing text', async () => {
    await expect(analyzer._call({})).resolves.toContain('Text is required');
  });
});
