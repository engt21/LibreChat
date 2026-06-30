import { logger } from '@librechat/data-schemas';
import { AnthropicClientOptions } from '@librechat/agents';
import {
  EModelEndpoint,
  AnthropicEffort,
  anthropicSettings,
  supportsContext1m,
  supportsAdaptiveThinking,
} from 'librechat-data-provider';
import { matchModelName } from '~/utils/tokens';

export const ANTHROPIC_CODE_EXECUTION_BETA = 'code-execution-2025-08-25';
export const ANTHROPIC_CODE_EXECUTION_TOOL = 'code_execution_20250825';
export const ANTHROPIC_CONTEXT_MANAGEMENT_BETA = 'context-management-2025-06-27';
export const ANTHROPIC_MCP_CLIENT_BETA = 'mcp-client-2025-11-20';
export const ANTHROPIC_FAST_MODE_BETA = 'fast-mode-2026-02-01';
export const ANTHROPIC_ADVISOR_BETA = 'advisor-tool-2026-03-01';
export const ANTHROPIC_ADVISOR_TOOL = 'advisor_20260301';
export const ANTHROPIC_WEB_FETCH_TOOL = 'web_fetch_20250910';
export const ANTHROPIC_WEB_FETCH_DYNAMIC_TOOL = 'web_fetch_20260209';
export const ANTHROPIC_WEB_SEARCH_TOOL = 'web_search_20250305';
export const ANTHROPIC_WEB_SEARCH_DYNAMIC_TOOL = 'web_search_20260209';
export const ANTHROPIC_VERTEX_WEB_SEARCH_TOOL = ANTHROPIC_WEB_SEARCH_TOOL;

/**
 * @param {string} modelName
 * @returns {boolean}
 */
function checkPromptCacheSupport(modelName: string): boolean {
  const modelMatch = matchModelName(modelName, EModelEndpoint.anthropic) ?? '';
  if (
    modelMatch.includes('claude-3-5-sonnet-latest') ||
    modelMatch.includes('claude-3.5-sonnet-latest')
  ) {
    return false;
  }

  return (
    /claude-3[-.]7/.test(modelMatch) ||
    /claude-3[-.]5-(?:sonnet|haiku)/.test(modelMatch) ||
    /claude-3-(?:sonnet|haiku|opus)?/.test(modelMatch) ||
    /claude-(?:sonnet|opus|haiku)-[4-9]/.test(modelMatch) ||
    /claude-[4-9]-(?:sonnet|opus|haiku)?/.test(modelMatch) ||
    /claude-4(?:-(?:sonnet|opus|haiku))?/.test(modelMatch)
  );
}

/**
 * Gets the appropriate headers for Claude models with cache control
 * @param {string} model The model name
 * @param {boolean} supportsCacheControl Whether the model supports cache control
 * @returns {AnthropicClientOptions['extendedOptions']['defaultHeaders']|undefined} The headers object or undefined if not applicable
 */
function getClaudeHeaders(
  model: string,
  supportsCacheControl: boolean,
): Record<string, string> | undefined {
  if (!supportsCacheControl) {
    return undefined;
  }

  if (/claude-3[-.]5-sonnet/.test(model)) {
    return {
      'anthropic-beta': 'max-tokens-3-5-sonnet-2024-07-15',
    };
  } else if (/claude-3[-.]7/.test(model)) {
    return {
      'anthropic-beta': 'token-efficient-tools-2025-02-19,output-128k-2025-02-19',
    };
  } else if (supportsContext1m(model)) {
    return {
      'anthropic-beta': 'context-1m-2025-08-07',
    };
  }

  return undefined;
}

function isHeadersInstance(headers: unknown): headers is Headers {
  return (
    typeof Headers !== 'undefined' &&
    headers !== null &&
    typeof headers === 'object' &&
    Object.prototype.toString.call(headers) === '[object Headers]'
  );
}

function normalizeAnthropicHeaders(headers: unknown): Record<string, string> | undefined {
  if (headers == null) {
    return undefined;
  }

  if (isHeadersInstance(headers)) {
    return Object.fromEntries(headers.entries());
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(
      headers.flatMap((entry) =>
        Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string'
          ? [[entry[0], entry[1]] as [string, string]]
          : [],
      ),
    );
  }

  if (
    typeof headers === 'object' &&
    headers !== null &&
    'values' in headers &&
    isHeadersInstance((headers as { values?: unknown }).values)
  ) {
    return Object.fromEntries((headers as { values: Headers }).values.entries());
  }

  if (typeof headers !== 'object') {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(headers as Record<string, unknown>).flatMap(([key, value]) => {
      if (typeof value === 'string') {
        return [[key, value] as [string, string]];
      }

      if (!Array.isArray(value)) {
        return [];
      }

      const flattenedValue = value.filter((entry): entry is string => typeof entry === 'string');
      if (flattenedValue.length === 0) {
        return [];
      }

      return [[key, flattenedValue.join(',')] as [string, string]];
    }),
  );
}

function mergeAnthropicBetaHeaders(
  headers: unknown,
  ...values: Array<string | null | undefined>
): Record<string, string> | undefined {
  const normalizedHeaders = normalizeAnthropicHeaders(headers);
  const betaHeaders = [
    ...(normalizedHeaders?.['anthropic-beta']
      ?.split(',')
      .map((value) => value.trim())
      .filter(Boolean) ?? []),
    ...values.flatMap((value) =>
      typeof value === 'string'
        ? value
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean)
        : [],
    ),
  ];

  if (betaHeaders.length === 0) {
    return normalizedHeaders;
  }

  return {
    ...(normalizedHeaders ?? {}),
    'anthropic-beta': Array.from(new Set(betaHeaders)).join(','),
  };
}

/**
 * Configures reasoning-related options for Claude models.
 * Models supporting adaptive thinking (Opus 4.6+, Sonnet 4.6+) use effort control instead of manual budget_tokens.
 */
function configureReasoning(
  anthropicInput: AnthropicClientOptions & { max_tokens?: number },
  extendedOptions: {
    thinking?: boolean;
    thinkingBudget?: number | null;
    effort?: AnthropicEffort | string | null;
  } = {},
): AnthropicClientOptions & { max_tokens?: number } {
  const updatedOptions = { ...anthropicInput };
  const currentMaxTokens = updatedOptions.max_tokens ?? updatedOptions.maxTokens;
  const modelName = updatedOptions.model ?? '';

  if (extendedOptions.thinking && modelName && supportsAdaptiveThinking(modelName)) {
    updatedOptions.thinking = { type: 'adaptive' };

    const effort = extendedOptions.effort;
    if (effort && effort !== AnthropicEffort.unset) {
      updatedOptions.invocationKwargs = {
        ...updatedOptions.invocationKwargs,
        output_config: { effort },
      };
    }

    if (currentMaxTokens == null) {
      updatedOptions.max_tokens = anthropicSettings.maxOutputTokens.reset(modelName);
    }

    return updatedOptions;
  }

  if (
    extendedOptions.thinking &&
    modelName &&
    (/claude-3[-.]7/.test(modelName) || /claude-(?:sonnet|opus|haiku)-[4-9]/.test(modelName))
  ) {
    updatedOptions.thinking = {
      ...updatedOptions.thinking,
      type: 'enabled',
    } as { type: 'enabled'; budget_tokens: number };
  }

  if (
    updatedOptions.thinking != null &&
    extendedOptions.thinkingBudget != null &&
    updatedOptions.thinking.type === 'enabled'
  ) {
    updatedOptions.thinking = {
      ...updatedOptions.thinking,
      budget_tokens: extendedOptions.thinkingBudget,
    };
  }

  if (
    updatedOptions.thinking != null &&
    updatedOptions.thinking.type === 'enabled' &&
    (currentMaxTokens == null || updatedOptions.thinking.budget_tokens > currentMaxTokens)
  ) {
    const maxTokens = anthropicSettings.maxOutputTokens.reset(modelName);
    updatedOptions.max_tokens = currentMaxTokens ?? maxTokens;

    logger.warn(
      updatedOptions.max_tokens === maxTokens
        ? '[AnthropicClient] max_tokens is not defined while thinking is enabled. Setting max_tokens to model default.'
        : `[AnthropicClient] thinking budget_tokens (${updatedOptions.thinking.budget_tokens}) exceeds max_tokens (${updatedOptions.max_tokens}). Adjusting budget_tokens.`,
    );

    updatedOptions.thinking.budget_tokens = Math.min(
      updatedOptions.thinking.budget_tokens,
      Math.floor((updatedOptions.max_tokens ?? 0) * 0.9),
    );
  }

  return updatedOptions;
}

export {
  checkPromptCacheSupport,
  getClaudeHeaders,
  mergeAnthropicBetaHeaders,
  configureReasoning,
  supportsAdaptiveThinking,
};
