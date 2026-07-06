const { Tool } = require('@langchain/core/tools');

const textAnalyzerJsonSchema = {
  type: 'object',
  properties: {
    text: {
      type: 'string',
      description: 'The exact text to analyze. Preserve whitespace and line breaks.',
    },
  },
  required: ['text'],
};

function countSegments(text, granularity, predicate) {
  if (typeof Intl?.Segmenter !== 'function') {
    return null;
  }

  const segments = new Intl.Segmenter('en', { granularity }).segment(text);
  let count = 0;
  for (const segment of segments) {
    if (!predicate || predicate(segment)) {
      count += 1;
    }
  }
  return count;
}

function countWords(text) {
  const segmented = countSegments(text, 'word', (segment) => segment.isWordLike === true);
  if (segmented != null) {
    return segmented;
  }

  const matches = text.trim().match(/\S+/gu);
  return matches?.length ?? 0;
}

function countCharacters(text) {
  return countSegments(text, 'grapheme') ?? Array.from(text).length;
}

function countSentences(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }

  return countSegments(trimmed, 'sentence') ?? trimmed.split(/(?<=[.!?])(?:\s+|$)/u).length;
}

function countLines(text) {
  return text.length === 0 ? 0 : text.split(/\r\n|\r|\n/u).length;
}

class TextAnalyzer extends Tool {
  static lc_name() {
    return 'text_analyzer';
  }

  static get jsonSchema() {
    return textAnalyzerJsonSchema;
  }

  constructor(fields = {}) {
    super(fields);
    this.name = 'text_analyzer';
    this.description = [
      'Deterministically count words, user-perceived Unicode characters, code points,',
      'UTF-16 code units, UTF-8 bytes, sentences, lines, and non-whitespace characters.',
      'Use this tool whenever the user asks for an exact text, word, or character count.',
    ].join(' ');
    this.schema = textAnalyzerJsonSchema;
    this.override = fields.override ?? false;
  }

  async _call(input) {
    if (!input || typeof input.text !== 'string') {
      return JSON.stringify({ error: 'Text is required and must be a string.' });
    }

    const { text } = input;
    return JSON.stringify({
      characters: countCharacters(text),
      code_points: Array.from(text).length,
      utf16_code_units: text.length,
      utf8_bytes: Buffer.byteLength(text, 'utf8'),
      words: countWords(text),
      sentences: countSentences(text),
      lines: countLines(text),
      non_whitespace_characters: Array.from(text).filter((character) => !/\s/u.test(character))
        .length,
    });
  }
}

module.exports = TextAnalyzer;
