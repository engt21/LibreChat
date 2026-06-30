import { Dispatcher, ProxyAgent } from 'undici';
import { logger } from '@librechat/data-schemas';
import { AnthropicClientOptions } from '@librechat/agents';
import {
  AnthropicAdvisorModel,
  anthropicSettings,
  getAnthropicModelCapabilities,
  removeNullishValues,
  AuthKeys,
} from 'librechat-data-provider';
import type {
  AnthropicLLMConfigResult,
  AnthropicConfigOptions,
  AnthropicCredentials,
} from '~/types/anthropic';
import {
  supportsAdaptiveThinking,
  checkPromptCacheSupport,
  configureReasoning,
  getClaudeHeaders,
  mergeAnthropicBetaHeaders,
  ANTHROPIC_CONTEXT_MANAGEMENT_BETA,
  ANTHROPIC_MCP_CLIENT_BETA,
  ANTHROPIC_FAST_MODE_BETA,
  ANTHROPIC_ADVISOR_BETA,
  ANTHROPIC_ADVISOR_TOOL,
  ANTHROPIC_CODE_EXECUTION_BETA,
  ANTHROPIC_CODE_EXECUTION_TOOL,
  ANTHROPIC_WEB_FETCH_TOOL,
  ANTHROPIC_WEB_FETCH_DYNAMIC_TOOL,
  ANTHROPIC_WEB_SEARCH_TOOL,
  ANTHROPIC_WEB_SEARCH_DYNAMIC_TOOL,
  ANTHROPIC_VERTEX_WEB_SEARCH_TOOL,
} from './helpers';
import {
  createAnthropicVertexClient,
  isAnthropicVertexCredentials,
  getVertexDeploymentName,
} from './vertex';

/**
 * Parses credentials from string or object format
 * - If a valid JSON string is passed, it parses and returns the object
 * - If a plain API key string is passed, it wraps it in an AnthropicCredentials object
 * - If an object is passed, it returns it directly
 * - If undefined, returns an empty object
 */
function parseCredentials(
  credentials: string | AnthropicCredentials | undefined,
): AnthropicCredentials {
  if (typeof credentials === 'string') {
    try {
      return JSON.parse(credentials);
    } catch {
      // If not valid JSON, treat as a plain API key
      logger.debug('[Anthropic] Credentials not JSON, treating as API key');
      return { [AuthKeys.ANTHROPIC_API_KEY]: credentials };
    }
  }
  return credentials && typeof credentials === 'object' ? credentials : {};
}

/** Known Anthropic parameters that map directly to the client config */
export const knownAnthropicParams = new Set([
  'model',
  'temperature',
  'topP',
  'topK',
  'maxTokens',
  'maxOutputTokens',
  'stopSequences',
  'stop',
  'stream',
  'apiKey',
  'maxRetries',
  'timeout',
  'anthropicVersion',
  'anthropicApiUrl',
  'defaultHeaders',
  'speed',
]);

const knownAnthropicInvocationParams = new Set([
  'service_tier',
  'tool_choice',
  'mcp_servers',
  'context_management',
  'container',
]);

type AnthropicToolOptionState = {
  web_search?: boolean;
  web_fetch?: boolean;
  anthropic_code_execution?: boolean;
  anthropic_advisor?: boolean;
  anthropic_advisor_model?: string | null;
  fast_mode?: boolean;
};

const anthropicToolOptionKeys = new Set<keyof AnthropicToolOptionState>([
  'web_search',
  'web_fetch',
  'anthropic_code_execution',
  'anthropic_advisor',
  'anthropic_advisor_model',
  'fast_mode',
]);

function applyAnthropicToolOption(
  state: AnthropicToolOptionState,
  key: string,
  value: unknown,
  overwrite: boolean,
): boolean {
  if (!anthropicToolOptionKeys.has(key as keyof AnthropicToolOptionState)) {
    return false;
  }

  if (!overwrite && state[key as keyof AnthropicToolOptionState] !== undefined) {
    return true;
  }

  if (key === 'anthropic_advisor_model') {
    if (typeof value === 'string' || value == null) {
      state.anthropic_advisor_model = value ?? null;
    }
    return true;
  }

  if (typeof value === 'boolean') {
    switch (key) {
      case 'web_search':
        state.web_search = value;
        break;
      case 'web_fetch':
        state.web_fetch = value;
        break;
      case 'anthropic_code_execution':
        state.anthropic_code_execution = value;
        break;
      case 'anthropic_advisor':
        state.anthropic_advisor = value;
        break;
      case 'fast_mode':
        state.fast_mode = value;
        break;
      default:
        break;
    }
  }

  return true;
}

function addAnthropicBetaHeader(
  target: AnthropicClientOptions & { stream?: boolean },
  value: string,
) {
  target.clientOptions = target.clientOptions ?? {};
  target.clientOptions.defaultHeaders = mergeAnthropicBetaHeaders(
    target.clientOptions.defaultHeaders,
    value,
  );
}

function getAdvisorModel(model?: string | null): AnthropicAdvisorModel {
  return Object.values(AnthropicAdvisorModel).includes(model as AnthropicAdvisorModel)
    ? (model as AnthropicAdvisorModel)
    : anthropicSettings.advisor_model.default;
}

/**
 * Applies default parameters to the target object only if the field is undefined
 * @param target - The target object to apply defaults to
 * @param defaults - Record of default parameter values
 */
function applyDefaultParams(target: Record<string, unknown>, defaults: Record<string, unknown>) {
  for (const [key, value] of Object.entries(defaults)) {
    if (target[key] === undefined) {
      target[key] = value;
    }
  }
}

function setInvocationKwarg(
  target: AnthropicClientOptions & { stream?: boolean },
  key: string,
  value: unknown,
  overwrite = true,
) {
  if (!overwrite && target.invocationKwargs?.[key] !== undefined) {
    return;
  }

  target.invocationKwargs = target.invocationKwargs ?? {};
  const existingValue = target.invocationKwargs[key];

  if (
    value != null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    existingValue != null &&
    typeof existingValue === 'object' &&
    !Array.isArray(existingValue)
  ) {
    target.invocationKwargs[key] = {
      ...(existingValue as Record<string, unknown>),
      ...(value as Record<string, unknown>),
    };
    return;
  }

  target.invocationKwargs[key] = value;
}

/**
 * Generates configuration options for creating an Anthropic language model (LLM) instance.
 * @param credentials - The API key for authentication with Anthropic, or credentials object for Vertex AI.
 * @param options={} - Additional options for configuring the LLM.
 * @returns Configuration options for creating an Anthropic LLM instance, with null and undefined values removed.
 */
function getLLMConfig(
  credentials: string | AnthropicCredentials | undefined,
  options: AnthropicConfigOptions = {},
): AnthropicLLMConfigResult {
  const systemOptions = {
    thinking: options.modelOptions?.thinking ?? anthropicSettings.thinking.default,
    promptCache: options.modelOptions?.promptCache ?? anthropicSettings.promptCache.default,
    thinkingBudget:
      options.modelOptions?.thinkingBudget ?? anthropicSettings.thinkingBudget.default,
    effort: options.modelOptions?.effort ?? anthropicSettings.effort.default,
    fast_mode: options.modelOptions?.fast_mode ?? anthropicSettings.fast_mode.default,
    web_fetch: options.modelOptions?.web_fetch ?? anthropicSettings.web_fetch.default,
    anthropic_code_execution:
      options.modelOptions?.anthropic_code_execution ?? anthropicSettings.code_execution.default,
    anthropic_advisor: options.modelOptions?.anthropic_advisor ?? anthropicSettings.advisor.default,
    anthropic_advisor_model:
      options.modelOptions?.anthropic_advisor_model ?? anthropicSettings.advisor_model.default,
  };
  const explicitToolOptions: AnthropicToolOptionState = {
    fast_mode: options.modelOptions?.fast_mode,
    web_fetch: options.modelOptions?.web_fetch,
    anthropic_code_execution: options.modelOptions?.anthropic_code_execution,
    anthropic_advisor: options.modelOptions?.anthropic_advisor,
    anthropic_advisor_model: options.modelOptions?.anthropic_advisor_model,
  };

  if (options.modelOptions) {
    delete options.modelOptions.thinking;
    delete options.modelOptions.promptCache;
    delete options.modelOptions.thinkingBudget;
    delete options.modelOptions.effort;
    delete options.modelOptions.fast_mode;
    delete options.modelOptions.web_fetch;
    delete options.modelOptions.anthropic_code_execution;
    delete options.modelOptions.anthropic_advisor;
    delete options.modelOptions.anthropic_advisor_model;
  } else {
    throw new Error('No modelOptions provided');
  }

  const defaultOptions = {
    model: anthropicSettings.model.default,
    stream: true,
  };

  const mergedOptions = Object.assign(defaultOptions, options.modelOptions);

  const toolOptions: AnthropicToolOptionState = {
    web_search: mergedOptions.web_search,
    web_fetch: explicitToolOptions.web_fetch,
    anthropic_code_execution: explicitToolOptions.anthropic_code_execution,
    anthropic_advisor: explicitToolOptions.anthropic_advisor,
    anthropic_advisor_model: explicitToolOptions.anthropic_advisor_model,
    fast_mode: explicitToolOptions.fast_mode,
  };

  let requestOptions: AnthropicClientOptions & { stream?: boolean } = {
    model: mergedOptions.model,
    stream: mergedOptions.stream,
    temperature: mergedOptions.temperature,
    stopSequences: mergedOptions.stop,
    maxTokens:
      mergedOptions.maxOutputTokens || anthropicSettings.maxOutputTokens.reset(mergedOptions.model),
    clientOptions: {},
    invocationKwargs: {
      metadata: {
        user_id: mergedOptions.user,
      },
    },
  };

  const creds = parseCredentials(credentials);
  const apiKey = creds[AuthKeys.ANTHROPIC_API_KEY] ?? null;

  if (isAnthropicVertexCredentials(creds)) {
    // Vertex AI configuration - use custom client with optional YAML config
    // Map the visible model name to the actual deployment name for Vertex AI
    const deploymentName = getVertexDeploymentName(
      requestOptions.model ?? '',
      options.vertexConfig,
    );
    requestOptions.model = deploymentName;

    requestOptions.createClient = () =>
      createAnthropicVertexClient(creds, requestOptions.clientOptions, options.vertexOptions);
  } else if (apiKey) {
    // Direct API configuration
    requestOptions.apiKey = apiKey;
  } else {
    throw new Error(
      'Invalid credentials provided. Please provide either a valid Anthropic API key or service account credentials for Vertex AI.',
    );
  }

  requestOptions = configureReasoning(requestOptions, systemOptions);

  if (supportsAdaptiveThinking(mergedOptions.model)) {
    if (
      systemOptions.effort &&
      (systemOptions.effort as string) !== '' &&
      !requestOptions.invocationKwargs?.output_config
    ) {
      requestOptions.invocationKwargs = {
        ...requestOptions.invocationKwargs,
        output_config: { effort: systemOptions.effort },
      };
    }
  } else {
    if (
      requestOptions.thinking != null &&
      (requestOptions.thinking as unknown as { type: string }).type === 'adaptive'
    ) {
      delete requestOptions.thinking;
    }
    if (requestOptions.invocationKwargs?.output_config) {
      delete requestOptions.invocationKwargs.output_config;
    }
  }

  const hasActiveThinking = requestOptions.thinking != null;
  const isThinkingModel =
    /claude-3[-.]7/.test(mergedOptions.model) || supportsAdaptiveThinking(mergedOptions.model);
  if (!isThinkingModel || !hasActiveThinking) {
    requestOptions.topP = mergedOptions.topP;
    requestOptions.topK = mergedOptions.topK;
  }

  const supportsCacheControl =
    systemOptions.promptCache === true && checkPromptCacheSupport(requestOptions.model ?? '');

  /** Pass promptCache boolean for downstream cache_control application */
  if (supportsCacheControl) {
    (requestOptions as Record<string, unknown>).promptCache = true;
  }

  const headers = getClaudeHeaders(requestOptions.model ?? '', supportsCacheControl);
  if (headers && requestOptions.clientOptions) {
    requestOptions.clientOptions.defaultHeaders = headers;
  }

  if (typeof mergedOptions.service_tier === 'string' && mergedOptions.service_tier !== '') {
    setInvocationKwarg(requestOptions, 'service_tier', mergedOptions.service_tier);
  }

  const mergedOptionsRecord = mergedOptions as Record<string, unknown>;
  for (const key of ['tool_choice', 'mcp_servers', 'context_management', 'container'] as const) {
    const value = mergedOptionsRecord[key];
    if (value !== undefined) {
      setInvocationKwarg(requestOptions, key, value);
    }
  }

  if (options.proxy && requestOptions.clientOptions) {
    const proxyAgent = new ProxyAgent(options.proxy);
    requestOptions.clientOptions.fetchOptions = {
      dispatcher: proxyAgent,
    };
  }

  if (options.reverseProxyUrl && requestOptions.clientOptions) {
    requestOptions.clientOptions.baseURL = options.reverseProxyUrl;
    requestOptions.anthropicApiUrl = options.reverseProxyUrl;
  }

  /** Handle defaultParams first - only process Anthropic-native params if undefined */
  if (options.defaultParams && typeof options.defaultParams === 'object') {
    for (const [key, value] of Object.entries(options.defaultParams)) {
      /** Handle Anthropic server-tool controls separately - don't add to config */
      if (applyAnthropicToolOption(toolOptions, key, value, false)) {
        continue;
      }

      if (knownAnthropicParams.has(key)) {
        /** Route known Anthropic params to requestOptions only if undefined */
        applyDefaultParams(requestOptions as Record<string, unknown>, { [key]: value });
      } else if (knownAnthropicInvocationParams.has(key)) {
        setInvocationKwarg(requestOptions, key, value, false);
      }
      /** Leave other params for transform to handle - they might be OpenAI params */
    }
  }

  /** Handle addParams - can override defaultParams */
  if (options.addParams && typeof options.addParams === 'object') {
    for (const [key, value] of Object.entries(options.addParams)) {
      /** Handle Anthropic server-tool controls separately - don't add to config */
      if (applyAnthropicToolOption(toolOptions, key, value, true)) {
        continue;
      }

      if (knownAnthropicParams.has(key)) {
        /** Route known Anthropic params to requestOptions */
        (requestOptions as Record<string, unknown>)[key] = value;
      } else if (knownAnthropicInvocationParams.has(key)) {
        setInvocationKwarg(requestOptions, key, value);
      }
      /** Leave other params for transform to handle - they might be OpenAI params */
    }
  }

  /** Handle dropParams - only drop from Anthropic config */
  if (options.dropParams && Array.isArray(options.dropParams)) {
    options.dropParams.forEach((param) => {
      if (anthropicToolOptionKeys.has(param as keyof AnthropicToolOptionState)) {
        if (param === 'anthropic_advisor_model') {
          toolOptions.anthropic_advisor_model = null;
        } else {
          (toolOptions as Record<string, unknown>)[param] = false;
        }
        return;
      }

      if (param in requestOptions) {
        delete requestOptions[param as keyof AnthropicClientOptions];
      }
      if (requestOptions.invocationKwargs && param in requestOptions.invocationKwargs) {
        delete (requestOptions.invocationKwargs as Record<string, unknown>)[param];
      }
    });
  }

  if (requestOptions.invocationKwargs?.context_management != null) {
    requestOptions.clientOptions = requestOptions.clientOptions ?? {};
    requestOptions.clientOptions.defaultHeaders = mergeAnthropicBetaHeaders(
      requestOptions.clientOptions.defaultHeaders,
      ANTHROPIC_CONTEXT_MANAGEMENT_BETA,
    );
  }

  const hasMCPServers = Array.isArray(requestOptions.invocationKwargs?.mcp_servers)
    ? requestOptions.invocationKwargs.mcp_servers.length > 0
    : requestOptions.invocationKwargs?.mcp_servers != null;

  if (hasMCPServers) {
    requestOptions.clientOptions = requestOptions.clientOptions ?? {};
    requestOptions.clientOptions.defaultHeaders = mergeAnthropicBetaHeaders(
      requestOptions.clientOptions.defaultHeaders,
      ANTHROPIC_MCP_CLIENT_BETA,
    );
  }

  const isVertexAnthropic = isAnthropicVertexCredentials(creds);
  const anthropicModelCapabilities = getAnthropicModelCapabilities(mergedOptions.model);
  toolOptions.fast_mode ??= systemOptions.fast_mode;
  toolOptions.web_fetch ??= systemOptions.web_fetch;
  toolOptions.anthropic_code_execution ??= systemOptions.anthropic_code_execution;
  toolOptions.anthropic_advisor ??= systemOptions.anthropic_advisor;
  toolOptions.anthropic_advisor_model ??= systemOptions.anthropic_advisor_model;

  if (toolOptions.fast_mode) {
    if (isVertexAnthropic) {
      logger.warn('[Anthropic] Fast mode was requested but is not available for Vertex AI.');
    } else if (!anthropicModelCapabilities.supportsFastMode) {
      logger.warn(
        `[Anthropic] Fast mode was requested for unsupported model "${mergedOptions.model}".`,
      );
    } else {
      (requestOptions as Record<string, unknown>).speed = 'fast';
      addAnthropicBetaHeader(requestOptions, ANTHROPIC_FAST_MODE_BETA);
    }
  }

  const tools = [];
  const canUseCodeExecution =
    toolOptions.anthropic_code_execution === true &&
    !isVertexAnthropic &&
    anthropicModelCapabilities.supportsCodeExecution;

  if (toolOptions.web_search) {
    if (!anthropicModelCapabilities.supportsWebSearch) {
      logger.warn(
        `[Anthropic] Web search was requested for unsupported model "${mergedOptions.model}".`,
      );
    } else {
      tools.push({
        type: isVertexAnthropic
          ? ANTHROPIC_VERTEX_WEB_SEARCH_TOOL
          : canUseCodeExecution
            ? ANTHROPIC_WEB_SEARCH_DYNAMIC_TOOL
            : ANTHROPIC_WEB_SEARCH_TOOL,
        name: 'web_search',
      });

      if (isVertexAnthropic) {
        addAnthropicBetaHeader(requestOptions, 'web-search-2025-03-05');
      }
    }
  }

  if (toolOptions.web_fetch) {
    if (isVertexAnthropic) {
      logger.warn('[Anthropic] Web fetch was requested but is not available for Vertex AI.');
    } else if (!anthropicModelCapabilities.supportsWebFetch) {
      logger.warn(
        `[Anthropic] Web fetch was requested for unsupported model "${mergedOptions.model}".`,
      );
    } else {
      tools.push({
        type: canUseCodeExecution ? ANTHROPIC_WEB_FETCH_DYNAMIC_TOOL : ANTHROPIC_WEB_FETCH_TOOL,
        name: 'web_fetch',
        citations: {
          enabled: true,
        },
      });
    }
  }

  if (toolOptions.anthropic_code_execution) {
    if (isVertexAnthropic) {
      logger.warn('[Anthropic] Code execution was requested but is not available for Vertex AI.');
    } else if (!anthropicModelCapabilities.supportsCodeExecution) {
      logger.warn(
        `[Anthropic] Code execution was requested for unsupported model "${mergedOptions.model}".`,
      );
    } else {
      tools.push({
        type: ANTHROPIC_CODE_EXECUTION_TOOL,
        name: 'code_execution',
      });
      addAnthropicBetaHeader(requestOptions, ANTHROPIC_CODE_EXECUTION_BETA);
    }
  }

  if (toolOptions.anthropic_advisor) {
    if (isVertexAnthropic) {
      logger.warn('[Anthropic] Advisor was requested but is not available for Vertex AI.');
    } else if (!anthropicModelCapabilities.supportsAdvisor) {
      logger.warn(
        `[Anthropic] Advisor was requested for unsupported model "${mergedOptions.model}".`,
      );
    } else {
      tools.push({
        type: ANTHROPIC_ADVISOR_TOOL,
        name: 'advisor',
        model: getAdvisorModel(toolOptions.anthropic_advisor_model),
      });
      addAnthropicBetaHeader(requestOptions, ANTHROPIC_ADVISOR_BETA);
    }
  }

  return {
    tools,
    llmConfig: removeNullishValues(
      requestOptions as Record<string, unknown>,
    ) as AnthropicClientOptions & { clientOptions?: { fetchOptions?: { dispatcher: Dispatcher } } },
  };
}

export { getLLMConfig };
