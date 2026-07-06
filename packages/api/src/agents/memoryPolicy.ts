import { ContentTypes } from 'librechat-data-provider';

export type MemoryIntent = 'save' | 'delete' | 'none';

export type MemoryIntentResult = {
  intent: MemoryIntent;
  evidence?: string;
};

const DELETE_PATTERNS = [
  /\b(?:please\s+)?forget\s+(?:that|this|my|the)\b/i,
  /\b(?:delete|remove)\s+(?:the\s+)?memor(?:y|ies)\b/i,
  /\bremove\s+.+?\s+from\s+(?:my\s+)?memor(?:y|ies)\b/i,
];

const SAVE_PATTERNS = [
  /\b(?:please\s+)?remember\s+(?:for\s+me|that|this|my|in\s+memor(?:y|ies)|the\s+following)\b/i,
  /\bdon['’]?t\s+forget\s+(?:that|this|my|to)\b/i,
  /\bdo\s+not\s+forget\s+(?:that|this|my|to)\b/i,
  /\bsave\b.{0,120}?\b(?:to|in)\s+(?:my\s+)?memor(?:y|ies)\b/i,
  /\bsave\s+to\s+memor(?:y|ies)\b/i,
  /\bupdate\s+(?:my\s+)?memor(?:y|ies)\b/i,
  /\badd\s+.+?\s+to\s+(?:my\s+)?memor(?:y|ies)\b/i,
  /\bstore\s+(?:this|that|the\s+following)\b/i,
  /\bmake\s+sure\s+.+?\s+(?:is|are)\s+in\s+(?:my\s+)?memor(?:y|ies)\b/i,
  /\bmust\s+(?:actually\s+)?(?:use\s+(?:the\s+)?memory\s+tool|save\b.{0,120}?\bto\s+memory)\b/i,
];

export function detectMemoryIntent(
  text: string,
  customIntentPhrases: string[] = [],
): MemoryIntentResult {
  const normalized = text.trim();
  if (!normalized) {
    return { intent: 'none' };
  }

  const dontForgetMatch = normalized.match(
    /\b(?:don['’]?t|do\s+not)\s+forget\s+(?:that|this|my|to)\b/i,
  );
  if (dontForgetMatch?.[0]) {
    return { intent: 'save', evidence: dontForgetMatch[0] };
  }

  for (const pattern of DELETE_PATTERNS) {
    const match = normalized.match(pattern);
    if (match?.[0]) {
      return { intent: 'delete', evidence: match[0] };
    }
  }

  for (const pattern of SAVE_PATTERNS) {
    const match = normalized.match(pattern);
    if (match?.[0]) {
      return { intent: 'save', evidence: match[0] };
    }
  }

  const lower = normalized.toLowerCase();
  const customMatch = customIntentPhrases.find((phrase) => lower.includes(phrase.toLowerCase()));
  if (customMatch) {
    return { intent: 'save', evidence: customMatch };
  }

  return { intent: 'none' };
}

export function normalizeMemoryKey(key: string): string {
  return key
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z_\s-]/g, '')
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
}

function stringifyToolValue(value: unknown, maxChars: number): string {
  if (typeof value === 'string') {
    return value.slice(0, maxChars);
  }
  try {
    return JSON.stringify(value).slice(0, maxChars);
  } catch {
    return '';
  }
}

export function formatMemoryResponseContext(contentParts: unknown, maxChars: number): string {
  if (!Array.isArray(contentParts) || maxChars <= 0) {
    return '';
  }

  const sections: string[] = [];
  let remaining = maxChars;
  const append = (value: string) => {
    if (!value || remaining <= 0) {
      return;
    }
    const bounded = value.slice(0, remaining);
    sections.push(bounded);
    remaining -= bounded.length;
  };

  for (const part of contentParts) {
    if (!part || typeof part !== 'object' || remaining <= 0) {
      continue;
    }
    const record = part as Record<string, unknown>;
    if (record.type === ContentTypes.TEXT && typeof record.text === 'string') {
      append(`Assistant: ${record.text}\n`);
      continue;
    }
    if (
      record.type === ContentTypes.TOOL_CALL &&
      record.tool_call &&
      typeof record.tool_call === 'object'
    ) {
      const toolCall = record.tool_call as Record<string, unknown>;
      const name = typeof toolCall.name === 'string' ? toolCall.name : 'tool';
      append(`Tool ${name} arguments: ${stringifyToolValue(toolCall.args, 2000)}\n`);
      append(
        `Tool ${name} result: ${stringifyToolValue(toolCall.output, Math.min(remaining, 8000))}\n`,
      );
    }
  }

  return sections.join('\n').trim();
}
