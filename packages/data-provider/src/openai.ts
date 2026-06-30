import { EModelEndpoint, ReasoningEffort } from './schemas';

const openAIHostedModelPattern = /^(?:chat-latest$|gpt-chat-latest$|chatgpt-|gpt-\d|o\d)/i;
const openAICompatibleModelPattern = /^(?:codex-|gpt-oss-)/i;
const azureHostedThirdPartyModelPattern = /^(?:deepseek-|grok-|mistral-|phi-)/i;
const nonTextGenerationModelPattern =
  /^(?:text-embedding-|embedding-|text-moderation-|omni-moderation-|dall-e-|tts-|whisper-)/i;
const searchPreviewModelPattern = /^gpt-4o(?:-mini)?-search(?:-preview)?(?:$|-)/i;
const gpt5FamilyPattern = /^gpt-5(?:\.|$|-)/i;
const gpt5VersionPattern = /^gpt-5\.(\d+)(?:$|-)/i;
const gpt5ChatPattern = /^gpt-5(?:\.\d+)?-chat(?:-latest)?(?:$|-)/i;
const gpt5ProPattern = /^gpt-5(?:\.\d+)?-pro(?:$|-)/i;
const gpt5CodexPattern = /^gpt-5(?:\.\d+)?-codex(?:$|-)/i;
const gpt5CodexMiniPattern = /^gpt-5(?:\.\d+)?-codex-mini(?:$|-)/i;
const gpt5CodexMaxPattern = /^gpt-5(?:\.\d+)?-codex-max(?:$|-)/i;
const gpt5ThinkingPattern = /^gpt-5(?:\.\d+)?-thinking(?:$|-)/i;
const legacyGpt5Pattern = /^gpt-5(?!\.\d)(?!-chat)(?:$|-)/i;
const o1FamilyPattern = /^o1(?:$|-)/i;
const o3FamilyPattern = /^o3(?:$|-)/i;
const o3ProPattern = /^o3-pro(?:$|-)/i;
const o4MiniFamilyPattern = /^o4-mini(?:$|-)/i;

export type TOpenAIModelProviderFamily =
  | 'openai'
  | 'deepseek'
  | 'xai'
  | 'microsoft'
  | 'mistral'
  | 'embedding'
  | 'unknown';

export type TOpenAISettingCapabilityState = {
  supported: boolean;
  reason?: string;
};

export type TResolvedOpenAIModelCapabilities = {
  model: string;
  hasKnownCapabilities: boolean;
  providerFamily: TOpenAIModelProviderFamily;
  isTextGenerationModel: boolean;
  isSearchPreviewModel: boolean;
  isReasoningModel: boolean;
  isVersionedGPT5Model: boolean;
  isVersionedHybridGPT5Model: boolean;
  requiresResponsesApi: boolean;
  supportsOpenAIResponsesApi: boolean;
  supportsTemperature: boolean;
  supportsTopP: boolean;
  supportsFrequencyPenalty: boolean;
  supportsPresencePenalty: boolean;
  supportsStop: boolean;
  supportsReasoningEffort: boolean;
  supportsReasoningSummary: boolean;
  supportsVerbosity: boolean;
  supportsWebSearch: boolean;
  samplingRequiresReasoningEffortNone: boolean;
  reasoningEffortOptions: ReasoningEffort[];
  reasoningEffortDefault: ReasoningEffort | null;
};

export function resolveOpenAIResponsesApiEnabled(
  capabilities: TResolvedOpenAIModelCapabilities,
  options?: {
    useResponsesApi?: boolean | null;
    endpoint?: string | null;
  },
): boolean {
  if (capabilities.requiresResponsesApi) {
    return true;
  }

  if (typeof options?.useResponsesApi === 'boolean') {
    if (!capabilities.supportsOpenAIResponsesApi && !capabilities.requiresResponsesApi) {
      return false;
    }

    return options.useResponsesApi;
  }

  return (
    capabilities.supportsOpenAIResponsesApi &&
    (options?.endpoint === EModelEndpoint.openAI ||
      options?.endpoint === EModelEndpoint.azureOpenAI)
  );
}

export function normalizeOpenAIModelName(model?: string | null): string {
  return (model ?? '').trim();
}

function getGPT5MinorVersion(model: string): number | null {
  const match = model.match(gpt5VersionPattern);

  if (match == null) {
    return null;
  }

  const minorVersion = Number.parseInt(match[1], 10);
  return Number.isFinite(minorVersion) ? minorVersion : null;
}

function getProviderFamily(model: string): TOpenAIModelProviderFamily {
  if (nonTextGenerationModelPattern.test(model)) {
    return 'embedding';
  }

  if (/^deepseek-/i.test(model)) {
    return 'deepseek';
  }

  if (/^grok-/i.test(model)) {
    return 'xai';
  }

  if (/^phi-/i.test(model)) {
    return 'microsoft';
  }

  if (/^mistral-/i.test(model)) {
    return 'mistral';
  }

  if (openAIHostedModelPattern.test(model) || openAICompatibleModelPattern.test(model)) {
    return 'openai';
  }

  return 'unknown';
}

function resolveReasoningEffortOptions({
  isReasoningModel,
  isVersionedHybridGPT5Model,
  isGPT5ProFamily,
  isGPT5CodexFamily,
  isGPT5ThinkingFamily,
  isLegacyGPT5Model,
  minorVersion,
}: {
  isReasoningModel: boolean;
  isVersionedHybridGPT5Model: boolean;
  isGPT5ProFamily: boolean;
  isGPT5CodexFamily: boolean;
  isGPT5ThinkingFamily: boolean;
  isLegacyGPT5Model: boolean;
  minorVersion: number | null;
}): ReasoningEffort[] {
  if (!isReasoningModel) {
    return [];
  }

  if (isGPT5ProFamily) {
    if (minorVersion != null && minorVersion >= 2) {
      return [
        ReasoningEffort.unset,
        ReasoningEffort.medium,
        ReasoningEffort.high,
        ReasoningEffort.xhigh,
      ];
    }

    return [ReasoningEffort.unset, ReasoningEffort.high];
  }

  if (isGPT5CodexFamily) {
    if (minorVersion != null && minorVersion >= 2) {
      return [
        ReasoningEffort.unset,
        ReasoningEffort.low,
        ReasoningEffort.medium,
        ReasoningEffort.high,
        ReasoningEffort.xhigh,
      ];
    }

    return [
      ReasoningEffort.unset,
      ReasoningEffort.medium,
      ReasoningEffort.high,
      ReasoningEffort.xhigh,
    ];
  }

  if (isGPT5ThinkingFamily) {
    const baseOptions = [
      ReasoningEffort.unset,
      ReasoningEffort.low,
      ReasoningEffort.medium,
      ReasoningEffort.high,
    ];

    if (minorVersion != null && minorVersion >= 2) {
      baseOptions.push(ReasoningEffort.xhigh);
    }

    return baseOptions;
  }

  if (isLegacyGPT5Model) {
    return [
      ReasoningEffort.unset,
      ReasoningEffort.minimal,
      ReasoningEffort.low,
      ReasoningEffort.medium,
      ReasoningEffort.high,
    ];
  }

  if (isVersionedHybridGPT5Model) {
    const baseOptions = [
      ReasoningEffort.unset,
      ReasoningEffort.none,
      ReasoningEffort.low,
      ReasoningEffort.medium,
      ReasoningEffort.high,
    ];

    if (minorVersion != null && minorVersion >= 2) {
      baseOptions.push(ReasoningEffort.xhigh);
    }

    return baseOptions;
  }

  return [ReasoningEffort.unset, ReasoningEffort.low, ReasoningEffort.medium, ReasoningEffort.high];
}

export function getOpenAIModelCapabilities(
  model: string | null | undefined,
): TResolvedOpenAIModelCapabilities {
  const normalizedModel = normalizeOpenAIModelName(model);
  const normalizedLower = normalizedModel.toLowerCase();
  const providerFamily = getProviderFamily(normalizedLower);
  const isOpenAIHostedModel = openAIHostedModelPattern.test(normalizedLower);
  const isOpenAICompatibleModel = openAICompatibleModelPattern.test(normalizedLower);
  const isAzureHostedThirdPartyModel = azureHostedThirdPartyModelPattern.test(normalizedLower);
  const isTextGenerationModel = !nonTextGenerationModelPattern.test(normalizedLower);
  const hasKnownCapabilities =
    isOpenAIHostedModel ||
    isOpenAICompatibleModel ||
    isAzureHostedThirdPartyModel ||
    !isTextGenerationModel;
  const isSearchPreviewModel = searchPreviewModelPattern.test(normalizedLower);
  const isGPT5Family = gpt5FamilyPattern.test(normalizedLower);
  const minorVersion = getGPT5MinorVersion(normalizedLower);
  const isVersionedGPT5Model = minorVersion != null;
  const isGPT5ChatFamily = gpt5ChatPattern.test(normalizedLower);
  const isGPT5ProFamily = gpt5ProPattern.test(normalizedLower);
  const isGPT5CodexMiniFamily = gpt5CodexMiniPattern.test(normalizedLower);
  const isGPT5CodexMaxFamily = gpt5CodexMaxPattern.test(normalizedLower);
  const isGPT5CodexFamily =
    gpt5CodexPattern.test(normalizedLower) || isGPT5CodexMiniFamily || isGPT5CodexMaxFamily;
  const isGPT5ThinkingFamily = gpt5ThinkingPattern.test(normalizedLower);
  const isLegacyGPT5Model =
    legacyGpt5Pattern.test(normalizedLower) &&
    !isGPT5ProFamily &&
    !isGPT5CodexFamily &&
    !isGPT5ThinkingFamily;
  const isVersionedHybridGPT5Model =
    (isGPT5Family &&
      isVersionedGPT5Model &&
      !isGPT5ProFamily &&
      !isGPT5CodexFamily &&
      !isGPT5ThinkingFamily) ||
    isGPT5ChatFamily;
  const isO1Family = o1FamilyPattern.test(normalizedLower);
  const isO3Family = o3FamilyPattern.test(normalizedLower);
  const isO4MiniFamily = o4MiniFamilyPattern.test(normalizedLower);
  const isReasoningModel =
    isTextGenerationModel &&
    !isSearchPreviewModel &&
    (isGPT5Family || isO1Family || isO3Family || isO4MiniFamily);
  const requiresResponsesApi =
    isOpenAIHostedModel &&
    !isSearchPreviewModel &&
    (isGPT5ProFamily ||
      isGPT5CodexMaxFamily ||
      (isGPT5CodexFamily && !isGPT5CodexMiniFamily) ||
      o3ProPattern.test(normalizedLower));
  const supportsSamplingControls =
    isTextGenerationModel &&
    !isSearchPreviewModel &&
    (!isReasoningModel || isVersionedHybridGPT5Model);
  const supportsOpenAIResponsesApi =
    isTextGenerationModel && isOpenAIHostedModel && !isSearchPreviewModel;
  const reasoningEffortOptions = resolveReasoningEffortOptions({
    isReasoningModel,
    isVersionedHybridGPT5Model,
    isGPT5ProFamily,
    isGPT5CodexFamily,
    isGPT5ThinkingFamily,
    isLegacyGPT5Model,
    minorVersion,
  });

  let reasoningEffortDefault: ReasoningEffort | null = null;

  if (isVersionedHybridGPT5Model) {
    reasoningEffortDefault = ReasoningEffort.none;
  } else if (isGPT5ProFamily) {
    reasoningEffortDefault = ReasoningEffort.high;
  }

  return {
    model: normalizedModel,
    hasKnownCapabilities,
    providerFamily,
    isTextGenerationModel,
    isSearchPreviewModel,
    isReasoningModel,
    isVersionedGPT5Model,
    isVersionedHybridGPT5Model,
    requiresResponsesApi,
    supportsOpenAIResponsesApi,
    supportsTemperature: supportsSamplingControls,
    supportsTopP: supportsSamplingControls,
    supportsFrequencyPenalty: supportsSamplingControls,
    supportsPresencePenalty: supportsSamplingControls,
    supportsStop: isTextGenerationModel && !isSearchPreviewModel && !isO3Family && !isO4MiniFamily,
    supportsReasoningEffort: reasoningEffortOptions.length > 0,
    supportsReasoningSummary: isReasoningModel,
    supportsVerbosity: isTextGenerationModel && !isSearchPreviewModel && isGPT5Family,
    supportsWebSearch: supportsOpenAIResponsesApi,
    samplingRequiresReasoningEffortNone: isVersionedHybridGPT5Model,
    reasoningEffortOptions,
    reasoningEffortDefault,
  };
}

export function resolveOpenAIReasoningEffort(
  capabilities: TResolvedOpenAIModelCapabilities,
  reasoningEffort?: string | null,
): ReasoningEffort | null {
  if (!capabilities.supportsReasoningEffort) {
    return null;
  }

  if (
    reasoningEffort == null ||
    reasoningEffort === '' ||
    reasoningEffort === ReasoningEffort.unset
  ) {
    return capabilities.reasoningEffortDefault;
  }

  if (capabilities.reasoningEffortOptions.includes(reasoningEffort as ReasoningEffort)) {
    return reasoningEffort as ReasoningEffort;
  }

  return capabilities.reasoningEffortDefault;
}

export function supportsOpenAISamplingControls(
  capabilities: TResolvedOpenAIModelCapabilities,
  reasoningEffort?: string | null,
): boolean {
  if (!capabilities.hasKnownCapabilities) {
    return true;
  }

  if (!capabilities.supportsTemperature || !capabilities.supportsTopP) {
    return false;
  }

  if (!capabilities.samplingRequiresReasoningEffortNone) {
    return true;
  }

  return resolveOpenAIReasoningEffort(capabilities, reasoningEffort) === ReasoningEffort.none;
}

export function getOpenAISettingCapabilityState(
  settingKey: string,
  capabilities: TResolvedOpenAIModelCapabilities,
  options?: {
    useResponsesApi?: boolean;
    endpoint?: string | null;
    reasoningEffort?: string | null;
  },
): TOpenAISettingCapabilityState {
  if (!capabilities.hasKnownCapabilities) {
    return { supported: true };
  }

  if (!capabilities.isTextGenerationModel) {
    switch (settingKey) {
      case 'max_tokens':
      case 'maxCompletionTokens':
      case 'max_output_tokens':
      case 'temperature':
      case 'top_p':
      case 'frequency_penalty':
      case 'presence_penalty':
      case 'stop':
      case 'reasoning_effort':
      case 'reasoning_summary':
      case 'verbosity':
      case 'useResponsesApi':
      case 'web_search':
      case 'disableStreaming':
        return {
          supported: false,
          reason: 'This deployment is not a streaming chat model.',
        };
      default:
        return { supported: true };
    }
  }

  const responsesApiEnabled = resolveOpenAIResponsesApiEnabled(capabilities, {
    useResponsesApi: options?.useResponsesApi,
    endpoint: options?.endpoint,
  });
  const supportsSampling = supportsOpenAISamplingControls(capabilities, options?.reasoningEffort);
  const samplingReason = capabilities.samplingRequiresReasoningEffortNone
    ? 'Set reasoning effort to None to adjust sampling controls for this model.'
    : 'This OpenAI model does not support sampling controls.';

  switch (settingKey) {
    case 'temperature':
      return supportsSampling
        ? { supported: true }
        : {
            supported: false,
            reason: samplingReason,
          };
    case 'top_p':
      return supportsSampling
        ? { supported: true }
        : {
            supported: false,
            reason: samplingReason,
          };
    case 'frequency_penalty':
      return supportsSampling && capabilities.supportsFrequencyPenalty
        ? { supported: true }
        : {
            supported: false,
            reason: samplingReason,
          };
    case 'presence_penalty':
      return supportsSampling && capabilities.supportsPresencePenalty
        ? { supported: true }
        : {
            supported: false,
            reason: samplingReason,
          };
    case 'stop':
      return capabilities.supportsStop
        ? { supported: true }
        : {
            supported: false,
            reason: 'This OpenAI model does not support stop sequences.',
          };
    case 'reasoning_effort':
      return capabilities.supportsReasoningEffort
        ? { supported: true }
        : {
            supported: false,
            reason: 'This model does not expose OpenAI reasoning effort controls.',
          };
    case 'reasoning_summary':
      if (!capabilities.supportsReasoningSummary) {
        return {
          supported: false,
          reason: 'This model does not support OpenAI reasoning summaries.',
        };
      }

      return responsesApiEnabled
        ? { supported: true }
        : {
            supported: false,
            reason: 'Enable the Responses API to configure reasoning summaries for this model.',
          };
    case 'verbosity':
      if (!capabilities.supportsVerbosity) {
        return {
          supported: false,
          reason: 'Only GPT-5 family models support OpenAI verbosity controls.',
        };
      }

      return responsesApiEnabled
        ? { supported: true }
        : {
            supported: false,
            reason: 'Enable the Responses API to configure verbosity for this model.',
          };
    case 'useResponsesApi':
      return capabilities.supportsOpenAIResponsesApi || capabilities.requiresResponsesApi
        ? { supported: true }
        : {
            supported: false,
            reason: 'This model does not support OpenAI Responses API controls.',
          };
    case 'web_search':
      return capabilities.supportsWebSearch
        ? { supported: true }
        : {
            supported: false,
            reason: capabilities.isSearchPreviewModel
              ? 'This search-preview model already handles search directly and does not use the web_search toggle.'
              : 'This model does not support provider-native web search.',
          };
    default:
      return { supported: true };
  }
}
