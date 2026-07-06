const crypto = require('node:crypto');
const { Tool } = require('@langchain/core/tools');

const operations = [
  'substring_count',
  'literal_replace',
  'sort_lines',
  'unique_lines',
  'normalize_whitespace',
  'uppercase',
  'lowercase',
  'sha256',
  'sha512',
];

const stringUtilityJsonSchema = {
  type: 'object',
  properties: {
    operation: {
      type: 'string',
      enum: operations,
      description: 'The exact deterministic string operation to perform.',
    },
    text: {
      type: 'string',
      description: 'The input text. Preserve whitespace and line breaks exactly.',
    },
    search: {
      type: 'string',
      description: 'Literal text to count or replace. Required for substring operations.',
    },
    replacement: {
      type: 'string',
      description: 'Literal replacement text for literal_replace. Defaults to an empty string.',
    },
    case_sensitive: {
      type: 'boolean',
      description: 'Whether matching and line comparison are case-sensitive. Defaults to true.',
    },
    overlapping: {
      type: 'boolean',
      description: 'Count overlapping substring matches. Used only by substring_count.',
    },
    replace_all: {
      type: 'boolean',
      description: 'Replace every match instead of only the first. Defaults to true.',
    },
    descending: {
      type: 'boolean',
      description: 'Sort lines in descending order. Used only by sort_lines.',
    },
  },
  required: ['operation', 'text'],
};

function getComparable(value, caseSensitive) {
  return caseSensitive ? value : value.toLocaleLowerCase('en');
}

function countSubstring(text, search, { caseSensitive, overlapping }) {
  if (search.length === 0) {
    throw new Error('Search text must not be empty.');
  }

  const comparableText = getComparable(text, caseSensitive);
  const comparableSearch = getComparable(search, caseSensitive);
  const step = overlapping ? 1 : comparableSearch.length;
  let count = 0;
  let index = 0;
  while ((index = comparableText.indexOf(comparableSearch, index)) !== -1) {
    count += 1;
    index += step;
  }
  return count;
}

function replaceLiteral(text, search, replacement, { caseSensitive, replaceAll }) {
  if (search.length === 0) {
    throw new Error('Search text must not be empty.');
  }

  if (caseSensitive) {
    return replaceAll ? text.split(search).join(replacement) : text.replace(search, replacement);
  }

  const comparableText = text.toLocaleLowerCase('en');
  const comparableSearch = search.toLocaleLowerCase('en');
  let cursor = 0;
  let result = '';
  while (cursor < text.length) {
    const index = comparableText.indexOf(comparableSearch, cursor);
    if (index === -1) {
      result += text.slice(cursor);
      break;
    }
    result += text.slice(cursor, index) + replacement;
    cursor = index + search.length;
    if (!replaceAll) {
      result += text.slice(cursor);
      break;
    }
  }
  return result;
}

function splitLines(text) {
  return text.length === 0 ? [] : text.split(/\r\n|\r|\n/u);
}

class StringUtility extends Tool {
  static lc_name() {
    return 'string_utility';
  }

  static get jsonSchema() {
    return stringUtilityJsonSchema;
  }

  constructor(fields = {}) {
    super(fields);
    this.name = 'string_utility';
    this.description = [
      'Perform exact deterministic string operations: substring counting, literal replacement,',
      'line sorting or deduplication, whitespace normalization, case conversion, and SHA-256/SHA-512 hashing.',
      'Use this instead of manually transforming or hashing text.',
    ].join(' ');
    this.schema = stringUtilityJsonSchema;
    this.override = fields.override ?? false;
  }

  async _call(input) {
    try {
      if (!input || typeof input.text !== 'string') {
        throw new Error('Text is required and must be a string.');
      }
      if (!operations.includes(input.operation)) {
        throw new Error('Unsupported string operation.');
      }
      if (input.text.length > 100000) {
        throw new Error('Text is too long (maximum 100000 UTF-16 code units).');
      }

      const caseSensitive = input.case_sensitive !== false;
      switch (input.operation) {
        case 'substring_count':
          if (typeof input.search !== 'string') {
            throw new Error('Search text is required for substring_count.');
          }
          return JSON.stringify({
            operation: input.operation,
            count: countSubstring(input.text, input.search, {
              caseSensitive,
              overlapping: input.overlapping === true,
            }),
          });
        case 'literal_replace':
          if (typeof input.search !== 'string') {
            throw new Error('Search text is required for literal_replace.');
          }
          return JSON.stringify({
            operation: input.operation,
            result: replaceLiteral(input.text, input.search, input.replacement ?? '', {
              caseSensitive,
              replaceAll: input.replace_all !== false,
            }),
          });
        case 'sort_lines': {
          const collator = new Intl.Collator('en', {
            numeric: true,
            sensitivity: caseSensitive ? 'variant' : 'base',
          });
          const lines = splitLines(input.text).sort((left, right) => collator.compare(left, right));
          if (input.descending === true) {
            lines.reverse();
          }
          return JSON.stringify({ operation: input.operation, result: lines.join('\n') });
        }
        case 'unique_lines': {
          const seen = new Set();
          const lines = splitLines(input.text).filter((line) => {
            const key = getComparable(line, caseSensitive);
            if (seen.has(key)) {
              return false;
            }
            seen.add(key);
            return true;
          });
          return JSON.stringify({ operation: input.operation, result: lines.join('\n') });
        }
        case 'normalize_whitespace':
          return JSON.stringify({
            operation: input.operation,
            result: input.text.trim().replace(/\s+/gu, ' '),
          });
        case 'uppercase':
          return JSON.stringify({ operation: input.operation, result: input.text.toUpperCase() });
        case 'lowercase':
          return JSON.stringify({ operation: input.operation, result: input.text.toLowerCase() });
        case 'sha256':
        case 'sha512':
          return JSON.stringify({
            operation: input.operation,
            result: crypto.createHash(input.operation).update(input.text, 'utf8').digest('hex'),
          });
        default:
          throw new Error('Unsupported string operation.');
      }
    } catch (error) {
      return JSON.stringify({ error: error.message });
    }
  }
}

module.exports = StringUtility;
