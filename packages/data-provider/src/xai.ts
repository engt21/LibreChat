import { normalizeEndpointName } from './utils';

export const XAI_ENDPOINT_NAME = 'xai';

const xaiTextIncompatiblePatterns = [
  /grok-imagine/i,
  /(?:^|[-.])image(?:$|[-.])/i,
  /(?:^|[-.])video(?:$|[-.])/i,
  /(?:^|[-.])tts(?:$|[-.])/i,
  /voice/i,
];

export type TXAIModelCapabilities = {
  id: string;
  aliases?: string[];
  created?: number;
  fingerprint?: string;
  object?: string;
  owned_by?: string;
  version?: string;
  input_modalities?: string[];
  output_modalities?: string[];
  prompt_text_token_price?: number;
  cached_prompt_text_token_price?: number;
  prompt_image_token_price?: number;
  completion_text_token_price?: number;
  search_price?: number;
};

export type TResolvedXAIModelCapabilities = {
  model: string;
  canonicalModel: string;
  metadata?: TXAIModelCapabilities;
  isTextCompatible: boolean;
  supportsImageInput: boolean;
  supportsStructuredOutputs: boolean;
  supportsFunctionCalling: boolean;
  supportsWebSearch: boolean;
  supportsReasoning: boolean;
  supportsReasoningEffort: boolean;
  supportsStop: boolean;
  supportsMaxOutputTokens: boolean;
  supportsVerbosity: boolean;
  supportsUseResponsesApi: boolean;
  isMultiAgent: boolean;
};

export type TXAISettingCapabilityState = {
  supported: boolean;
  reason?: string;
};

export function normalizeXAIModelName(model?: string | null): string {
  return (model ?? '').replace(/^xai\//i, '').trim();
}

const normalizeXAIEndpoint = (endpoint?: string | null): string => {
  return normalizeEndpointName(endpoint ?? '')
    .trim()
    .toLowerCase();
};

const normalizeXAIAliases = (aliases: string[] = []): string[] => {
  const seenAliases = new Set<string>();

  return aliases.reduce<string[]>((acc, alias) => {
    const normalizedAlias = normalizeXAIModelName(alias);

    if (!normalizedAlias || seenAliases.has(normalizedAlias)) {
      return acc;
    }

    seenAliases.add(normalizedAlias);
    acc.push(normalizedAlias);
    return acc;
  }, []);
};

const getCanonicalXAIModelName = (
  model?: string | null,
  metadata?: TXAIModelCapabilities | null,
): string => {
  return normalizeXAIModelName(metadata?.id ?? model);
};

const isXAIMultiAgentModel = (model?: string | null): boolean => {
  return /^grok-4(?:\.20)?-multi-agent(?:$|[-.])/i.test(normalizeXAIModelName(model));
};

const isXAIReasoningModel = (model?: string | null): boolean => {
  const normalizedModel = normalizeXAIModelName(model).toLowerCase();

  if (!normalizedModel) {
    return false;
  }

  if (normalizedModel.includes('non-reasoning')) {
    return false;
  }

  if (normalizedModel.includes('reasoning')) {
    return true;
  }

  return (
    isXAIMultiAgentModel(normalizedModel) ||
    /^grok-code-fast(?:$|[-.])/i.test(normalizedModel) ||
    /^grok-4(?:$|[-.])/i.test(normalizedModel) ||
    /^grok-4\./i.test(normalizedModel) ||
    /^grok-3(?:$|[-.])/i.test(normalizedModel)
  );
};

const isXAIReasoningEffortModel = (model?: string | null): boolean => {
  return (
    /^grok-3-mini(?:$|[-.])/i.test(normalizeXAIModelName(model)) || isXAIMultiAgentModel(model)
  );
};

const inferXAIWebSearchSupport = (model?: string | null): boolean => {
  const normalizedModel = normalizeXAIModelName(model).toLowerCase();

  if (!normalizedModel) {
    return false;
  }

  if (/^grok-code-fast(?:$|[-.])/i.test(normalizedModel)) {
    return false;
  }

  return /^grok-(?:3|4)(?:$|[-.])/i.test(normalizedModel) || /^grok-4\./i.test(normalizedModel);
};

export function isXAIEndpointName(endpoint?: string | null): boolean {
  return normalizeXAIEndpoint(endpoint) === XAI_ENDPOINT_NAME;
}

export function isXAIBaseURL(baseURL?: string | null): boolean {
  if (!baseURL) {
    return false;
  }

  try {
    return /(^|\.)x\.ai$/i.test(new URL(baseURL).host);
  } catch {
    return /https?:\/\/[^\s/]*x\.ai(?:[:/]|$)/i.test(baseURL);
  }
}

export function isXAIEndpointCandidate({
  endpoint,
  baseURL,
  defaultParamsEndpoint,
}: {
  endpoint?: string | null;
  baseURL?: string | null;
  defaultParamsEndpoint?: string | null;
}): boolean {
  return (
    (defaultParamsEndpoint ?? '').trim().toLowerCase() === XAI_ENDPOINT_NAME ||
    isXAIEndpointName(endpoint) ||
    isXAIBaseURL(baseURL)
  );
}

export function isXAITextCompatibleModel(model: TXAIModelCapabilities | string): boolean {
  const normalizedModel = normalizeXAIModelName(
    typeof model === 'string' ? model : model.id,
  ).toLowerCase();

  if (!normalizedModel) {
    return false;
  }

  if (typeof model !== 'string') {
    const outputModalities =
      model.output_modalities?.map((modality) => modality.toLowerCase()) ?? [];
    if (outputModalities.length > 0 && !outputModalities.includes('text')) {
      return false;
    }
  }

  return !xaiTextIncompatiblePatterns.some((pattern) => pattern.test(normalizedModel));
}

export function filterXAITextCompatibleModels(
  models: TXAIModelCapabilities[] = [],
): TXAIModelCapabilities[] {
  return models.filter(isXAITextCompatibleModel);
}

export function buildXAIModelCapabilitiesMap(
  models: TXAIModelCapabilities[] = [],
): Record<string, TXAIModelCapabilities> {
  return filterXAITextCompatibleModels(models).reduce<Record<string, TXAIModelCapabilities>>(
    (acc, model) => {
      const canonicalModel = normalizeXAIModelName(model.id);

      if (!canonicalModel) {
        return acc;
      }

      const aliases = normalizeXAIAliases(model.aliases).filter(
        (alias) => alias !== canonicalModel,
      );
      const normalizedModel: TXAIModelCapabilities = {
        ...model,
        id: canonicalModel,
        aliases,
      };

      if (acc[canonicalModel] == null) {
        acc[canonicalModel] = normalizedModel;
      }

      for (const alias of aliases) {
        if (acc[alias] == null) {
          acc[alias] = normalizedModel;
        }
      }

      return acc;
    },
    {},
  );
}

export function getXAITextCompatibleModelNames(models: TXAIModelCapabilities[] = []): string[] {
  return Object.keys(buildXAIModelCapabilitiesMap(models));
}

export function getXAIModelCapabilities(
  model: string | null | undefined,
  metadata?: TXAIModelCapabilities | null,
): TResolvedXAIModelCapabilities {
  const normalizedModel = normalizeXAIModelName(model);
  const canonicalModel = getCanonicalXAIModelName(normalizedModel, metadata);
  const isTextCompatible = isXAITextCompatibleModel(metadata ?? canonicalModel);
  const inputModalities =
    metadata?.input_modalities?.map((modality) => modality.toLowerCase()) ?? [];
  const supportsImageInput =
    inputModalities.includes('image') ||
    /^grok-4(?:$|[-.])/i.test(canonicalModel) ||
    /^grok-4\./i.test(canonicalModel) ||
    /vision/i.test(canonicalModel);
  const isMultiAgent = isXAIMultiAgentModel(canonicalModel);
  const supportsReasoning = isXAIReasoningModel(canonicalModel);
  const supportsReasoningEffort = isTextCompatible && isXAIReasoningEffortModel(canonicalModel);
  const supportsWebSearch =
    isTextCompatible &&
    (metadata?.search_price != null
      ? metadata.search_price > 0
      : inferXAIWebSearchSupport(canonicalModel));

  return {
    model: normalizedModel,
    canonicalModel,
    metadata: metadata ?? undefined,
    isTextCompatible,
    supportsImageInput,
    supportsStructuredOutputs: isTextCompatible,
    supportsFunctionCalling: isTextCompatible && !isMultiAgent,
    supportsWebSearch,
    supportsReasoning,
    supportsReasoningEffort,
    supportsStop: isTextCompatible && !supportsReasoning,
    supportsMaxOutputTokens: isTextCompatible && !isMultiAgent,
    supportsVerbosity: isTextCompatible,
    supportsUseResponsesApi: isTextCompatible,
    isMultiAgent,
  };
}

export function getXAISettingCapabilityState(
  settingKey: string,
  capabilities: TResolvedXAIModelCapabilities,
): TXAISettingCapabilityState {
  switch (settingKey) {
    case 'max_tokens':
      return capabilities.supportsMaxOutputTokens
        ? { supported: true }
        : {
            supported: false,
            reason: 'This xAI multi-agent model does not support output token limits.',
          };
    case 'stop':
      return capabilities.supportsStop
        ? { supported: true }
        : {
            supported: false,
            reason: 'xAI reasoning models do not support stop sequences.',
          };
    case 'imageDetail':
      return capabilities.supportsImageInput
        ? { supported: true }
        : {
            supported: false,
            reason: 'This model does not support image understanding input.',
          };
    case 'reasoning_effort':
      if (!capabilities.supportsReasoning) {
        return {
          supported: false,
          reason: 'This model is not an xAI reasoning model.',
        };
      }

      return capabilities.supportsReasoningEffort
        ? { supported: true }
        : {
            supported: false,
            reason:
              'Only Grok 3 Mini and xAI multi-agent models currently support xAI reasoning effort controls.',
          };
    case 'web_search':
      return capabilities.supportsWebSearch
        ? { supported: true }
        : {
            supported: false,
            reason: 'This xAI model does not support provider-native web search.',
          };
    case 'verbosity':
      return capabilities.supportsVerbosity
        ? { supported: true }
        : {
            supported: false,
            reason: 'This model does not support xAI verbosity controls.',
          };
    case 'useResponsesApi':
      return {
        supported: false,
        reason:
          'xAI automatically uses the Responses API when needed (e.g., for web search). This toggle is not applicable.',
      };
    default:
      return { supported: true };
  }
}
