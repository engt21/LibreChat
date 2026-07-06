import {
  EModelEndpoint,
  KnownEndpoints,
  ReasoningEffort,
  removeNullishValues,
  supportsOpenAISamplingControls,
  isXAIEndpointCandidate,
  getOpenAIModelCapabilities as resolveOpenAIModelCapabilities,
  resolveOpenAIResponsesApiEnabled,
  getXAIModelCapabilities as resolveXAIModelCapabilities,
} from 'librechat-data-provider';
import type { BindToolsInput } from '@langchain/core/language_models/chat_models';
import type { SettingDefinition } from 'librechat-data-provider';
import type { AzureOpenAIInput } from '@langchain/openai';
import type { OpenAI } from 'openai';
import type * as t from '~/types';
import { sanitizeModelName, constructAzureURL } from '~/utils/azure';
import { isEnabled } from '~/utils/common';

const DEFAULT_OPENAI_WEB_SEARCH_MAX_TOOL_CALLS = 6;
const MAX_OPENAI_WEB_SEARCH_MAX_TOOL_CALLS = 12;

function getOpenAIWebSearchMaxToolCalls(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    return DEFAULT_OPENAI_WEB_SEARCH_MAX_TOOL_CALLS;
  }

  return Math.min(value, MAX_OPENAI_WEB_SEARCH_MAX_TOOL_CALLS);
}

export const knownOpenAIParams = new Set([
  // Constructor/Instance Parameters
  'model',
  'modelName',
  'temperature',
  'topP',
  'frequencyPenalty',
  'presencePenalty',
  'n',
  'logitBias',
  'stop',
  'stopSequences',
  'user',
  'timeout',
  'stream',
  'maxTokens',
  'maxCompletionTokens',
  'logprobs',
  'topLogprobs',
  'apiKey',
  'organization',
  'audio',
  'modalities',
  'reasoning',
  'zdrEnabled',
  'service_tier',
  'supportsStrictToolCalling',
  'useResponsesApi',
  'configuration',
  // Call-time Options
  'tools',
  'tool_choice',
  'functions',
  'function_call',
  'response_format',
  'seed',
  'stream_options',
  'parallel_tool_calls',
  'strict',
  'prediction',
  'promptIndex',
  // Responses API specific
  'text',
  'truncation',
  'include',
  'previous_response_id',
  // LangChain specific
  '__includeRawResponse',
  'maxConcurrency',
  'maxRetries',
  'verbose',
  'streaming',
  'streamUsage',
  'disableStreaming',
]);

function hasReasoningParams({
  reasoning_effort,
  reasoning_summary,
}: {
  reasoning_effort?: string | null;
  reasoning_summary?: string | null;
}): boolean {
  return (
    (reasoning_effort != null && reasoning_effort !== '') ||
    (reasoning_summary != null && reasoning_summary !== '')
  );
}

function normalizeOllamaReasoningEffort(
  reasoning_effort?: ReasoningEffort | null,
): ReasoningEffort | null | undefined {
  if (reasoning_effort === ReasoningEffort.minimal) {
    return ReasoningEffort.low;
  }

  if (reasoning_effort === ReasoningEffort.xhigh) {
    return ReasoningEffort.high;
  }

  return reasoning_effort;
}

function deleteReasoningProperty(
  reasoning: OpenAI.Reasoning | Record<string, unknown> | undefined,
  property: 'effort' | 'summary',
): boolean {
  if (reasoning == null || typeof reasoning !== 'object') {
    return false;
  }

  delete reasoning[property];
  return Object.keys(reasoning).length === 0;
}

/**
 * Extracts default parameters from customParams.paramDefinitions
 * @param paramDefinitions - Array of parameter definitions with key and default values
 * @returns Record of default parameters
 */
export function extractDefaultParams(
  paramDefinitions?: Partial<SettingDefinition>[],
): Record<string, unknown> | undefined {
  if (!paramDefinitions || !Array.isArray(paramDefinitions)) {
    return undefined;
  }

  const defaults: Record<string, unknown> = {};
  for (let i = 0; i < paramDefinitions.length; i++) {
    const param = paramDefinitions[i];
    if (param.key !== undefined && param.default !== undefined) {
      defaults[param.key] = param.default;
    }
  }
  return defaults;
}

/**
 * Applies default parameters to the target object only if the field is undefined
 * @param target - The target object to apply defaults to
 * @param defaults - Record of default parameter values
 */
export function applyDefaultParams(
  target: Record<string, unknown>,
  defaults: Record<string, unknown>,
) {
  for (const [key, value] of Object.entries(defaults)) {
    if (target[key] === undefined) {
      target[key] = value;
    }
  }
}

export function getOpenAILLMConfig({
  azure,
  apiKey,
  baseURL,
  endpoint,
  streaming,
  addParams,
  dropParams,
  defaultParams,
  useOpenRouter,
  modelOptions: _modelOptions,
}: {
  apiKey: string;
  streaming: boolean;
  baseURL?: string | null;
  endpoint?: EModelEndpoint | string | null;
  modelOptions: Partial<t.OpenAIParameters>;
  addParams?: Record<string, unknown>;
  dropParams?: string[];
  defaultParams?: Record<string, unknown>;
  useOpenRouter?: boolean;
  azure?: false | t.AzureOptions;
}): Pick<t.LLMConfigResult, 'llmConfig' | 'tools'> & {
  azure?: t.AzureOptions;
} {
  /** Clean empty strings from model options (e.g., temperature: "" should be removed) */
  const cleanedModelOptions = removeNullishValues(
    _modelOptions,
    true,
  ) as Partial<t.OpenAIParameters>;

  const {
    reasoning_effort,
    reasoning_summary,
    verbosity,
    web_search,
    topK,
    top_p,
    frequency_penalty,
    presence_penalty,
    ...modelOptions
  } = cleanedModelOptions;
  const camelTopP = (cleanedModelOptions as Record<string, unknown>).topP as number | undefined;

  const llmConfig = Object.assign(
    {
      streaming,
      model: modelOptions.model ?? '',
    },
    modelOptions,
  ) as Partial<t.OAIClientOptions> & Partial<t.OpenAIParameters> & Partial<AzureOpenAIInput>;

  if (frequency_penalty != null) {
    llmConfig.frequencyPenalty = frequency_penalty;
  }
  if (presence_penalty != null) {
    llmConfig.presencePenalty = presence_penalty;
  }
  if ((camelTopP ?? top_p) != null) {
    llmConfig.topP = camelTopP ?? top_p;
  }

  const modelKwargs: Record<string, unknown> = {};
  let hasModelKwargs = false;
  const isOllamaEndpoint =
    typeof endpoint === 'string' && endpoint.toLowerCase().startsWith(KnownEndpoints.ollama);
  const isXAIEndpoint = isXAIEndpointCandidate({ endpoint, baseURL });
  const openAIModelCapabilities =
    !isOllamaEndpoint && !isXAIEndpoint
      ? resolveOpenAIModelCapabilities(modelOptions.model as string | undefined)
      : undefined;
  const xaiModelCapabilities = isXAIEndpoint
    ? resolveXAIModelCapabilities(modelOptions.model as string | undefined)
    : undefined;
  const normalizedReasoningEffort = isOllamaEndpoint
    ? normalizeOllamaReasoningEffort(reasoning_effort)
    : reasoning_effort;
  const normalizedReasoningSummary = isOllamaEndpoint ? undefined : reasoning_summary;
  const usesOpenAIMaxReasoning =
    (normalizedReasoningEffort === ReasoningEffort.max ||
      normalizedReasoningEffort === ReasoningEffort.ultra) &&
    openAIModelCapabilities?.reasoningEffortOptions.includes(ReasoningEffort.max) === true;
  const usesOpenAIUltraReasoning =
    normalizedReasoningEffort === ReasoningEffort.ultra &&
    openAIModelCapabilities?.reasoningEffortOptions.includes(ReasoningEffort.ultra) === true;
  const requestReasoningEffort = usesOpenAIUltraReasoning
    ? ReasoningEffort.max
    : normalizedReasoningEffort;
  const openAIReasoningMode = usesOpenAIUltraReasoning ? 'pro' : undefined;

  const usesOpenAIHostedResponses =
    !useOpenRouter &&
    !isXAIEndpoint &&
    !isOllamaEndpoint &&
    (endpoint == null ||
      endpoint === EModelEndpoint.openAI ||
      endpoint === EModelEndpoint.azureOpenAI ||
      azure != null);

  if (
    openAIModelCapabilities &&
    resolveOpenAIResponsesApiEnabled(openAIModelCapabilities, {
      useResponsesApi: llmConfig.useResponsesApi,
      endpoint: useOpenRouter ? null : endpoint,
    })
  ) {
    llmConfig.useResponsesApi = true;
  }

  if (isOllamaEndpoint && topK != null) {
    modelKwargs.top_k = topK;
    hasModelKwargs = true;
  }

  if (verbosity != null && verbosity !== '') {
    modelKwargs.verbosity = verbosity;
    hasModelKwargs = true;
  }

  let enableWebSearch = web_search;

  /** Apply defaultParams first - only if fields are undefined */
  if (defaultParams && typeof defaultParams === 'object') {
    for (const [key, value] of Object.entries(defaultParams)) {
      /** Handle web_search separately - don't add to config */
      if (key === 'web_search') {
        if (enableWebSearch === undefined && typeof value === 'boolean') {
          enableWebSearch = value;
        }
        continue;
      }
      if (key === 'top_p') {
        if (llmConfig.topP === undefined && typeof value === 'number') {
          llmConfig.topP = value;
        }
        continue;
      }
      if (isOllamaEndpoint && (key === 'topK' || key === 'top_k')) {
        if (modelKwargs.top_k === undefined && typeof value === 'number') {
          modelKwargs.top_k = value;
          hasModelKwargs = true;
        }
        continue;
      }

      if (knownOpenAIParams.has(key)) {
        applyDefaultParams(llmConfig as Record<string, unknown>, { [key]: value });
      } else {
        /** Apply to modelKwargs if not a known param */
        if (modelKwargs[key] === undefined) {
          modelKwargs[key] = value;
          hasModelKwargs = true;
        }
      }
    }
  }

  /** Apply addParams - can override defaultParams */
  if (addParams && typeof addParams === 'object') {
    for (const [key, value] of Object.entries(addParams)) {
      /** Handle web_search directly here instead of adding to modelKwargs or llmConfig */
      if (key === 'web_search') {
        if (typeof value === 'boolean') {
          enableWebSearch = value;
        }
        continue;
      }
      if (key === 'top_p') {
        if (typeof value === 'number') {
          llmConfig.topP = value;
        }
        continue;
      }
      if (isOllamaEndpoint && (key === 'topK' || key === 'top_k')) {
        if (typeof value === 'number') {
          hasModelKwargs = true;
          modelKwargs.top_k = value;
        }
        continue;
      }
      if (knownOpenAIParams.has(key)) {
        (llmConfig as Record<string, unknown>)[key] = value;
      } else {
        hasModelKwargs = true;
        modelKwargs[key] = value;
      }
    }
  }

  if (dropParams?.includes('web_search')) {
    enableWebSearch = false;
  }

  if (!useOpenRouter && openAIModelCapabilities && !openAIModelCapabilities.supportsWebSearch) {
    enableWebSearch = false;
  }

  if (
    openAIModelCapabilities?.hasKnownCapabilities === true &&
    !openAIModelCapabilities.supportsOpenAIResponsesApi &&
    !openAIModelCapabilities.requiresResponsesApi
  ) {
    delete llmConfig.useResponsesApi;
  }

  if (isXAIEndpoint && xaiModelCapabilities && !xaiModelCapabilities.supportsWebSearch) {
    enableWebSearch = false;
  }

  const requiresOpenAIResponsesApi =
    openAIModelCapabilities?.hasKnownCapabilities === true &&
    (openAIModelCapabilities.requiresResponsesApi ||
      usesOpenAIMaxReasoning ||
      (openAIModelCapabilities.supportsReasoningSummary &&
        normalizedReasoningSummary != null &&
        normalizedReasoningSummary !== '') ||
      (openAIModelCapabilities.supportsVerbosity && verbosity != null && verbosity !== ''));

  if (requiresOpenAIResponsesApi) {
    llmConfig.useResponsesApi = true;
  }

  const requiresXAIResponsesApi =
    isXAIEndpoint === true &&
    (llmConfig.useResponsesApi === true ||
      xaiModelCapabilities?.isMultiAgent === true ||
      enableWebSearch === true ||
      hasReasoningParams({
        reasoning_effort: normalizedReasoningEffort,
        reasoning_summary: normalizedReasoningSummary,
      }) ||
      (verbosity != null && verbosity !== ''));

  if (requiresXAIResponsesApi) {
    llmConfig.useResponsesApi = true;
  }

  if (useOpenRouter) {
    if (hasReasoningParams({ reasoning_effort: normalizedReasoningEffort })) {
      /**
       * OpenRouter uses a `reasoning` object — `summary` is not supported.
       * ChatOpenRouter treats `reasoning` and `include_reasoning` as mutually exclusive:
       * `include_reasoning` is legacy compat that maps to `{ enabled: true }` only when
       * no `reasoning` object is present, so we intentionally omit it here.
       */
      modelKwargs.reasoning = { effort: requestReasoningEffort };
      hasModelKwargs = true;
    } else {
      /** No explicit effort; fall back to legacy `include_reasoning` for reasoning token inclusion */
      llmConfig.include_reasoning = true;
    }
  } else if (
    hasReasoningParams({
      reasoning_effort: normalizedReasoningEffort,
      reasoning_summary: normalizedReasoningSummary,
    }) &&
    llmConfig.useResponsesApi === true
  ) {
    llmConfig.reasoning = removeNullishValues(
      {
        effort: requestReasoningEffort,
        mode: openAIReasoningMode,
        summary: normalizedReasoningSummary,
      },
      true,
    ) as OpenAI.Reasoning;
  } else if (
    hasReasoningParams({
      reasoning_effort: normalizedReasoningEffort,
      reasoning_summary: normalizedReasoningSummary,
    }) &&
    isOllamaEndpoint
  ) {
    modelKwargs.reasoning = removeNullishValues(
      {
        effort: requestReasoningEffort,
        summary: normalizedReasoningSummary,
      },
      true,
    );
    hasModelKwargs = true;
  } else if (
    hasReasoningParams({
      reasoning_effort: normalizedReasoningEffort,
      reasoning_summary: normalizedReasoningSummary,
    }) &&
    endpoint !== EModelEndpoint.openAI &&
    endpoint !== EModelEndpoint.azureOpenAI
  ) {
    llmConfig.reasoning = removeNullishValues(
      {
        effort: requestReasoningEffort,
        summary: normalizedReasoningSummary,
      },
      true,
    ) as OpenAI.Reasoning;
  } else if (hasReasoningParams({ reasoning_effort: normalizedReasoningEffort })) {
    llmConfig.reasoning_effort = requestReasoningEffort;
  }

  if (llmConfig.max_tokens != null) {
    llmConfig.maxTokens = llmConfig.max_tokens;
    delete llmConfig.max_tokens;
  }

  const tools: BindToolsInput[] = [];

  if (useOpenRouter && enableWebSearch) {
    /** OpenRouter expects web search as a plugins parameter */
    modelKwargs.plugins = [{ id: 'web' }];
    hasModelKwargs = true;
  } else if (enableWebSearch && isXAIEndpoint) {
    /**
     * xAI accepts `web_search` ONLY on the Responses API. If the request ever
     * lands on Chat Completions (e.g., because useResponsesApi is stripped or
     * the provider doesn't honor it), xAI returns a 422 demanding `live_search`.
     * Force Responses API and push the Responses-shaped web_search tool.
     */
    llmConfig.useResponsesApi = true;
    tools.push({ type: 'web_search' });
  } else if (enableWebSearch && !isOllamaEndpoint) {
    /** Standard OpenAI web search uses tools API */
    llmConfig.useResponsesApi = true;
    if (usesOpenAIHostedResponses) {
      modelKwargs.max_tool_calls = getOpenAIWebSearchMaxToolCalls(modelKwargs.max_tool_calls);
      hasModelKwargs = true;
    }
    tools.push({ type: 'web_search' });
  }

  if (
    openAIModelCapabilities?.hasKnownCapabilities &&
    openAIModelCapabilities.isSearchPreviewModel
  ) {
    const searchExcludeParams = [
      'frequencyPenalty',
      'presencePenalty',
      'reasoning',
      'reasoning_effort',
      'temperature',
      'topP',
      'stop',
      'stopSequences',
      'logitBias',
      'seed',
      'response_format',
      'n',
      'logprobs',
      'user',
    ];

    const updatedDropParams = dropParams || [];
    const combinedDropParams = [...new Set([...updatedDropParams, ...searchExcludeParams])];

    combinedDropParams.forEach((param) => {
      if (param in llmConfig) {
        delete llmConfig[param as keyof t.OAIClientOptions];
      }
    });

    delete llmConfig.useResponsesApi;
  } else if (
    openAIModelCapabilities?.hasKnownCapabilities &&
    openAIModelCapabilities.isReasoningModel &&
    !supportsOpenAISamplingControls(openAIModelCapabilities, normalizedReasoningEffort)
  ) {
    const reasoningExcludeParams = [
      'frequencyPenalty',
      'presencePenalty',
      'temperature',
      'topP',
      'logitBias',
      'n',
      'logprobs',
    ];

    const updatedDropParams = dropParams || [];
    const combinedDropParams = [...new Set([...updatedDropParams, ...reasoningExcludeParams])];

    combinedDropParams.forEach((param) => {
      if (param in llmConfig) {
        delete llmConfig[param as keyof t.OAIClientOptions];
      }
    });
  } else if (dropParams && Array.isArray(dropParams)) {
    dropParams.forEach((param) => {
      if (param in llmConfig) {
        delete llmConfig[param as keyof t.OAIClientOptions];
      }
    });
  }

  if (openAIModelCapabilities?.hasKnownCapabilities) {
    const hasUnsupportedReasoningEffort =
      normalizedReasoningEffort != null &&
      normalizedReasoningEffort !== '' &&
      !openAIModelCapabilities.reasoningEffortOptions.includes(
        normalizedReasoningEffort as ReasoningEffort,
      );

    if (!openAIModelCapabilities.supportsReasoningEffort || hasUnsupportedReasoningEffort) {
      delete llmConfig.reasoning_effort;
      if (deleteReasoningProperty(llmConfig.reasoning, 'effort')) {
        delete llmConfig.reasoning;
      }
      if (deleteReasoningProperty(modelKwargs.reasoning as Record<string, unknown>, 'effort')) {
        delete modelKwargs.reasoning;
      }
    }

    if (!openAIModelCapabilities.supportsReasoningSummary) {
      if (deleteReasoningProperty(llmConfig.reasoning, 'summary')) {
        delete llmConfig.reasoning;
      }
      if (deleteReasoningProperty(modelKwargs.reasoning as Record<string, unknown>, 'summary')) {
        delete modelKwargs.reasoning;
      }
    }

    if (!openAIModelCapabilities.supportsStop) {
      delete llmConfig.stop;
      delete llmConfig.stopSequences;
    }

    if (!openAIModelCapabilities.supportsVerbosity) {
      delete modelKwargs.verbosity;
    }
  }

  if (isXAIEndpoint && xaiModelCapabilities) {
    if (!xaiModelCapabilities.supportsReasoning) {
      delete llmConfig.reasoning_effort;
      delete llmConfig.reasoning;
      delete modelKwargs.reasoning;
    } else if (!xaiModelCapabilities.supportsReasoningEffort) {
      delete llmConfig.reasoning_effort;
      if (llmConfig.reasoning && typeof llmConfig.reasoning === 'object') {
        delete (llmConfig.reasoning as Record<string, unknown>).effort;
        if (Object.keys(llmConfig.reasoning as Record<string, unknown>).length === 0) {
          delete llmConfig.reasoning;
        }
      }
      if (modelKwargs.reasoning && typeof modelKwargs.reasoning === 'object') {
        delete (modelKwargs.reasoning as Record<string, unknown>).effort;
        if (Object.keys(modelKwargs.reasoning as Record<string, unknown>).length === 0) {
          delete modelKwargs.reasoning;
        }
      }
    }

    if (!xaiModelCapabilities.supportsStop) {
      delete llmConfig.stop;
      delete llmConfig.stopSequences;
    }

    if (llmConfig.useResponsesApi === true || xaiModelCapabilities.supportsReasoning) {
      delete llmConfig.frequencyPenalty;
      delete llmConfig.presencePenalty;
    }

    if (llmConfig.useResponsesApi === true && llmConfig.maxTokens != null) {
      modelKwargs.max_output_tokens = llmConfig.maxTokens;
      delete llmConfig.maxTokens;
      hasModelKwargs = true;
    }

    if (!xaiModelCapabilities.supportsMaxOutputTokens) {
      delete llmConfig.maxTokens;
      delete modelKwargs.max_output_tokens;
      delete modelKwargs.max_completion_tokens;
    }
  }

  /**
   * xAI safety net: a `{ type: 'web_search' }` tool on Chat Completions causes
   * a 422 from xAI ("expected `function` or `live_search`"). If something
   * downstream cleared useResponsesApi, drop the web_search tool rather than
   * ship a broken request. Any remaining web_search tool implies Responses API
   * is required, so re-assert it.
   */
  if (isXAIEndpoint && tools.length > 0) {
    const hasWebSearchTool = tools.some(
      (tool) =>
        tool != null &&
        typeof tool === 'object' &&
        (tool as { type?: unknown }).type === 'web_search',
    );

    if (hasWebSearchTool) {
      if (llmConfig.useResponsesApi !== true) {
        llmConfig.useResponsesApi = true;
      }
    }
  }

  if (modelKwargs.verbosity && llmConfig.useResponsesApi === true) {
    modelKwargs.text = { verbosity: modelKwargs.verbosity };
    delete modelKwargs.verbosity;
  }

  if (
    llmConfig.model &&
    /\bgpt-[5-9](?:\.\d+)?\b/i.test(llmConfig.model) &&
    llmConfig.maxTokens != null
  ) {
    const paramName =
      llmConfig.useResponsesApi === true ? 'max_output_tokens' : 'max_completion_tokens';
    modelKwargs[paramName] = llmConfig.maxTokens;
    delete llmConfig.maxTokens;
    hasModelKwargs = true;
  }

  if (Object.keys(modelKwargs).length === 0) {
    hasModelKwargs = false;
  }

  if (hasModelKwargs) {
    llmConfig.modelKwargs = modelKwargs;
  }

  if (!azure) {
    llmConfig.apiKey = apiKey;
    return { llmConfig, tools };
  }

  const useModelName = isEnabled(process.env.AZURE_USE_MODEL_AS_DEPLOYMENT_NAME);
  const updatedAzure = { ...azure };
  updatedAzure.azureOpenAIApiDeploymentName = useModelName
    ? sanitizeModelName(llmConfig.model || '')
    : azure.azureOpenAIApiDeploymentName;

  if (process.env.AZURE_OPENAI_DEFAULT_MODEL) {
    llmConfig.model = process.env.AZURE_OPENAI_DEFAULT_MODEL;
  }

  const constructAzureOpenAIBasePath = () => {
    if (!baseURL) {
      return;
    }
    const azureURL = constructAzureURL({
      baseURL,
      azureOptions: updatedAzure,
    });
    updatedAzure.azureOpenAIBasePath = azureURL.split(
      `/${updatedAzure.azureOpenAIApiDeploymentName}`,
    )[0];
  };

  constructAzureOpenAIBasePath();
  Object.assign(llmConfig, updatedAzure);

  const constructAzureResponsesApi = () => {
    if (!llmConfig.useResponsesApi) {
      return;
    }

    delete llmConfig.azureOpenAIApiDeploymentName;
    delete llmConfig.azureOpenAIApiInstanceName;
    delete llmConfig.azureOpenAIApiVersion;
    delete llmConfig.azureOpenAIBasePath;
    delete llmConfig.azureOpenAIApiKey;
    llmConfig.apiKey = apiKey;
  };

  constructAzureResponsesApi();

  llmConfig.model = updatedAzure.azureOpenAIApiDeploymentName;
  return { llmConfig, tools, azure: updatedAzure };
}
