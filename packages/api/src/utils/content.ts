import { ContentTypes } from 'librechat-data-provider';
import type { TMessageContentParts } from 'librechat-data-provider';

const ANTHROPIC_SERVER_TOOL_PREFIX = 'srvtoolu_';

function getStringField(part: unknown, field: string): string | undefined {
  if (!part || typeof part !== 'object') {
    return undefined;
  }

  const value = (part as Record<string, unknown>)[field];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isAnthropicServerToolUse(part: unknown): boolean {
  if (!part || typeof part !== 'object') {
    return false;
  }

  const record = part as Record<string, unknown>;
  const id = getStringField(record, 'id');
  return (
    id?.startsWith(ANTHROPIC_SERVER_TOOL_PREFIX) === true &&
    record.name === 'web_search' &&
    ('input' in record || record.type === 'server_tool_use') &&
    (record.type === 'server_tool_use' || record.type === ContentTypes.TEXT)
  );
}

function isAnthropicWebSearchToolResult(part: unknown): boolean {
  if (!part || typeof part !== 'object') {
    return false;
  }

  const record = part as Record<string, unknown>;
  const toolUseId = getStringField(record, 'tool_use_id');
  return (
    toolUseId?.startsWith(ANTHROPIC_SERVER_TOOL_PREFIX) === true &&
    'content' in record &&
    (record.type === 'web_search_tool_result' || record.type === ContentTypes.TEXT)
  );
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

  const anthropicServerToolUseIds = new Set<string>();
  const anthropicWebSearchResultIds = new Set<string>();

  for (const part of contentParts) {
    const serverToolUseId = isAnthropicServerToolUse(part) ? getStringField(part, 'id') : undefined;
    if (serverToolUseId) {
      anthropicServerToolUseIds.add(serverToolUseId);
    }

    const resultToolUseId = isAnthropicWebSearchToolResult(part)
      ? getStringField(part, 'tool_use_id')
      : undefined;
    if (resultToolUseId) {
      anthropicWebSearchResultIds.add(resultToolUseId);
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
      return id != null && anthropicWebSearchResultIds.has(id);
    }

    if (isAnthropicWebSearchToolResult(part)) {
      const toolUseId = getStringField(part, 'tool_use_id');
      return toolUseId != null && anthropicServerToolUseIds.has(toolUseId);
    }

    return true;
  });
}
