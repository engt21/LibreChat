import { ContentTypes } from 'librechat-data-provider';
import type { TMessageContentParts } from 'librechat-data-provider';

const ANTHROPIC_SERVER_TOOL_PREFIX = 'srvtoolu_';
const ANTHROPIC_SERVER_TOOL_RESULT_TYPES: Record<string, Set<string>> = {
  web_search: new Set(['web_search_tool_result']),
  web_fetch: new Set(['web_fetch_tool_result']),
  code_execution: new Set(['code_execution_tool_result']),
  advisor: new Set(['advisor_tool_result']),
};
const ANTHROPIC_SERVER_TOOL_NAMES = new Set(Object.keys(ANTHROPIC_SERVER_TOOL_RESULT_TYPES));
const ANTHROPIC_SERVER_TOOL_RESULT_TYPE_TO_NAMES = Object.entries(
  ANTHROPIC_SERVER_TOOL_RESULT_TYPES,
).reduce<Record<string, Set<string>>>((acc, [name, resultTypes]) => {
  for (const resultType of resultTypes) {
    acc[resultType] = acc[resultType] ?? new Set<string>();
    acc[resultType].add(name);
  }

  return acc;
}, {});

function getStringField(part: unknown, field: string): string | undefined {
  if (!part || typeof part !== 'object') {
    return undefined;
  }

  const value = (part as Record<string, unknown>)[field];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function getAnthropicServerToolName(part: unknown): string | undefined {
  if (!part || typeof part !== 'object') {
    return undefined;
  }

  const record = part as Record<string, unknown>;
  const id = getStringField(record, 'id');
  const name = getStringField(record, 'name');
  const isTextType = record.type === ContentTypes.TEXT || record.type === 'text';
  const hasServerToolPayload =
    ('input' in record || record.type === 'server_tool_use') &&
    (record.type === 'server_tool_use' || isTextType);

  if (
    id?.startsWith(ANTHROPIC_SERVER_TOOL_PREFIX) !== true ||
    !name ||
    !ANTHROPIC_SERVER_TOOL_NAMES.has(name) ||
    !hasServerToolPayload
  ) {
    return undefined;
  }

  return name;
}

function isAnthropicServerToolUse(part: unknown): boolean {
  return getAnthropicServerToolName(part) != null;
}

function getAnthropicServerToolResultNames(part: unknown): Set<string> | undefined {
  if (!part || typeof part !== 'object') {
    return undefined;
  }

  const record = part as Record<string, unknown>;
  const toolUseId = getStringField(record, 'tool_use_id');
  const type = getStringField(record, 'type');
  const isTextType = type === ContentTypes.TEXT || type === 'text';
  let names = type != null ? ANTHROPIC_SERVER_TOOL_RESULT_TYPE_TO_NAMES[type] : undefined;

  if (isTextType) {
    const inferredNames = new Set<string>();
    const content = record.content;
    const inspectContentType = (value: unknown) => {
      if (!value || typeof value !== 'object') {
        return;
      }

      const contentType = getStringField(value, 'type');
      if (contentType === 'web_search_result') {
        inferredNames.add('web_search');
      } else if (contentType === 'web_fetch_result') {
        inferredNames.add('web_fetch');
      } else if (contentType === 'web_search_tool_result_error') {
        inferredNames.add('web_search');
      } else if (contentType === 'web_fetch_tool_result_error') {
        inferredNames.add('web_fetch');
      } else if (contentType === 'code_execution_tool_result_error') {
        inferredNames.add('code_execution');
      } else if (contentType === 'advisor_tool_result_error') {
        inferredNames.add('advisor');
      }
    };

    if (Array.isArray(content)) {
      content.forEach(inspectContentType);
    } else {
      inspectContentType(content);
    }

    names =
      inferredNames.size > 0
        ? inferredNames
        : ANTHROPIC_SERVER_TOOL_RESULT_TYPE_TO_NAMES.web_search_tool_result;
  }

  if (
    toolUseId?.startsWith(ANTHROPIC_SERVER_TOOL_PREFIX) === true &&
    names != null &&
    'content' in record
  ) {
    return names;
  }

  return undefined;
}

function isAnthropicServerToolResult(part: unknown): boolean {
  return getAnthropicServerToolResultNames(part) != null;
}

function isAnthropicThinkingBlock(part: unknown): boolean {
  return (
    part != null &&
    typeof part === 'object' &&
    (part as Record<string, unknown>).type === 'thinking'
  );
}

function hasValidAnthropicThinkingFields(part: unknown): boolean {
  if (!isAnthropicThinkingBlock(part)) {
    return false;
  }

  const record = part as Record<string, unknown>;
  return getStringField(record, 'thinking') != null && getStringField(record, 'signature') != null;
}

/**
 * Filters out malformed tool call content parts that don't have the required tool_call property.
 * This handles edge cases where tool_call content parts may be created with only a type property
 * but missing the actual tool_call data.
 *
 * @param contentParts - Array of content parts to filter
 * @returns Filtered array with malformed tool calls removed
 *
 * @example
 * // Removes malformed tool_call without the tool_call property
 * const parts = [
 *   { type: 'tool_call', tool_call: { id: '123', name: 'test' } }, // valid - kept
 *   { type: 'tool_call' }, // invalid - filtered out
 *   { type: 'text', text: 'Hello' }, // valid - kept (other types pass through)
 * ];
 * const filtered = filterMalformedContentParts(parts);
 * // Returns all parts except the malformed tool_call
 */
export function filterMalformedContentParts(
  contentParts: TMessageContentParts[],
): TMessageContentParts[];
export function filterMalformedContentParts<T>(contentParts: T): T;
export function filterMalformedContentParts<T>(
  contentParts: T | TMessageContentParts[],
): T | TMessageContentParts[] {
  if (!Array.isArray(contentParts)) {
    return contentParts;
  }

  const anthropicServerToolUseNamesById = new Map<string, string>();
  const anthropicServerToolResultNamesById = new Map<string, Set<string>>();

  for (const part of contentParts) {
    const serverToolName = getAnthropicServerToolName(part);
    const serverToolUseId = serverToolName ? getStringField(part, 'id') : undefined;
    if (serverToolName && serverToolUseId) {
      anthropicServerToolUseNamesById.set(serverToolUseId, serverToolName);
    }

    const resultNames = getAnthropicServerToolResultNames(part);
    const resultToolUseId = resultNames ? getStringField(part, 'tool_use_id') : undefined;
    if (resultNames && resultToolUseId) {
      const existingNames = anthropicServerToolResultNamesById.get(resultToolUseId) ?? new Set();
      for (const name of resultNames) {
        existingNames.add(name);
      }
      anthropicServerToolResultNamesById.set(resultToolUseId, existingNames);
    }
  }

  return contentParts.filter((part) => {
    if (!part || typeof part !== 'object') {
      return false;
    }

    const { type } = part;

    if (type === ContentTypes.TOOL_CALL) {
      return 'tool_call' in part && part.tool_call != null && typeof part.tool_call === 'object';
    }

    if (isAnthropicThinkingBlock(part)) {
      return hasValidAnthropicThinkingFields(part);
    }

    if (isAnthropicServerToolUse(part)) {
      const id = getStringField(part, 'id');
      const toolName = id ? anthropicServerToolUseNamesById.get(id) : undefined;
      const resultNames = id ? anthropicServerToolResultNamesById.get(id) : undefined;
      return toolName != null && resultNames?.has(toolName) === true;
    }

    if (isAnthropicServerToolResult(part)) {
      const toolUseId = getStringField(part, 'tool_use_id');
      const toolName = toolUseId ? anthropicServerToolUseNamesById.get(toolUseId) : undefined;
      const resultNames = getAnthropicServerToolResultNames(part);
      return toolName != null && resultNames?.has(toolName) === true;
    }

    return true;
  });
}
