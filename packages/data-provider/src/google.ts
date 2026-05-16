import { googleSettings } from './schemas';

export const GOOGLE_GENERATE_CONTENT_METHOD = 'generateContent';

const googleTextIncompatiblePatterns = [
  /embedding/i,
  /(?:^|[-.])aqa(?:$|[-.])/i,
  /imagen/i,
  /(?:^|[-.])veo(?:$|[-.])/i,
  /(?:^|[-.])tts(?:$|[-.])/i,
  /native-audio/i,
  /(?:^|[-.])image(?:$|[-.])/i,
  /nano-banana/i,
  /computer-use/i,
  /robotics/i,
];

const googleThinkingLevelAliases = new Set([
  'gemini-pro-latest',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
]);

const googleThinkingUnsupportedPatterns = [/^gemini-2\.5-flash-lite(?:$|[-.])/i];

const googleWebSearchSupportedPatterns = [
  /^gemini-3\.1-pro-preview(?:$|[-.])/i,
  /^gemini-3-flash-preview(?:$|[-.])/i,
  /^gemini-2\.5-pro(?:$|[-.])/i,
  /^gemini-2\.5-flash(?:$|[-.])/i,
  /^gemini-2\.5-flash-lite(?:$|[-.])/i,
  /^gemini-2\.0-flash(?:$|[-.])/i,
];

export type TGoogleModelCapabilities = {
  name: string;
  displayName?: string;
  description?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportedGenerationMethods?: string[];
  temperature?: number;
  topP?: number;
  topK?: number;
  maxTemperature?: number;
  thinking?: boolean;
  vertexLocation?: string;
  vertexLocations?: string[];
};

export type TResolvedGoogleModelCapabilities = {
  model: string;
  metadata?: TGoogleModelCapabilities;
  isTextCompatible: boolean;
  supportsTemperature: boolean;
  supportsTopP: boolean;
  supportsTopK: boolean;
  supportsMaxOutputTokens: boolean;
  supportsThinking: boolean;
  supportsThinkingBudget: boolean;
  supportsThinkingLevel: boolean;
  supportsWebSearch: boolean;
  temperatureDefault: number;
  temperatureMax: number;
  topPDefault: number;
  topKDefault: number;
  topKMax: number;
  maxOutputTokensDefault: number;
  maxOutputTokensMax: number;
};

export type TGoogleSettingCapabilityState = {
  supported: boolean;
  reason?: string;
};

export function normalizeGoogleModelName(model?: string | null): string {
  const trimmedModel = (model ?? '').trim();

  if (!trimmedModel) {
    return '';
  }

  const modelPathMatch = trimmedModel.match(/(?:^|\/)models\/([^/?#]+)/);
  if (modelPathMatch?.[1]) {
    return modelPathMatch[1].trim();
  }

  return trimmedModel.replace(/^google\//, '').trim();
}

const isGoogleTextIncompatibleModelName = (model: string): boolean => {
  return googleTextIncompatiblePatterns.some((pattern) => pattern.test(model));
};

export function supportsGoogleGenerateContent(
  model?: Pick<TGoogleModelCapabilities, 'supportedGenerationMethods'> | null,
): boolean {
  return model?.supportedGenerationMethods?.includes(GOOGLE_GENERATE_CONTENT_METHOD) ?? false;
}

export function isGoogleGeminiModel(model?: string | null): boolean {
  return /^gemini(?:$|[-.])/.test(normalizeGoogleModelName(model).toLowerCase());
}

export function isGoogleGemmaModel(model?: string | null): boolean {
  return /^gemma(?:$|[-.])/.test(normalizeGoogleModelName(model).toLowerCase());
}

export function isGoogleThinkingLevelModel(model?: string | null): boolean {
  const normalizedModel = normalizeGoogleModelName(model).toLowerCase();

  return (
    /^gemini-(?:3(?:\.|$|-)|[4-9](?:\.|$|-)|\d{2,}(?:\.|$|-))/.test(normalizedModel) ||
    googleThinkingLevelAliases.has(normalizedModel)
  );
}

function supportsGoogleSearchGrounding(model?: string | null): boolean {
  const normalizedModel = normalizeGoogleModelName(model).toLowerCase();

  return googleWebSearchSupportedPatterns.some((pattern) => pattern.test(normalizedModel));
}

export function isGoogleTextCompatibleModel(
  model: Pick<TGoogleModelCapabilities, 'name' | 'supportedGenerationMethods'> | string,
): boolean {
  const normalizedModel = normalizeGoogleModelName(
    typeof model === 'string' ? model : model.name,
  ).toLowerCase();

  if (!normalizedModel) {
    return false;
  }

  if (typeof model !== 'string' && !supportsGoogleGenerateContent(model)) {
    return false;
  }

  return !isGoogleTextIncompatibleModelName(normalizedModel);
}

export function filterGoogleTextCompatibleModels(
  models: TGoogleModelCapabilities[] = [],
): TGoogleModelCapabilities[] {
  return models.filter(isGoogleTextCompatibleModel);
}

export function buildGoogleModelCapabilitiesMap(
  models: TGoogleModelCapabilities[] = [],
): Record<string, TGoogleModelCapabilities> {
  return filterGoogleTextCompatibleModels(models).reduce<Record<string, TGoogleModelCapabilities>>(
    (acc, model) => {
      const normalizedModel = normalizeGoogleModelName(model.name);
      if (!normalizedModel || acc[normalizedModel] != null) {
        return acc;
      }

      acc[normalizedModel] = {
        ...model,
        name: normalizedModel,
      };

      return acc;
    },
    {},
  );
}

export function getGoogleTextCompatibleModelNames(
  models: TGoogleModelCapabilities[] = [],
): string[] {
  const seenModels = new Set<string>();

  return filterGoogleTextCompatibleModels(models).reduce<string[]>((acc, model) => {
    const normalizedModel = normalizeGoogleModelName(model.name);

    if (!normalizedModel || seenModels.has(normalizedModel)) {
      return acc;
    }

    seenModels.add(normalizedModel);
    acc.push(normalizedModel);
    return acc;
  }, []);
}

export function getGoogleModelCapabilities(
  model: string | null | undefined,
  metadata?: TGoogleModelCapabilities | null,
): TResolvedGoogleModelCapabilities {
  const normalizedModel = normalizeGoogleModelName(model);
  const normalizedLower = normalizedModel.toLowerCase();
  const isTextCompatible = isGoogleTextCompatibleModel(metadata ?? normalizedModel);
  const isThinkingOptOutModel = googleThinkingUnsupportedPatterns.some((pattern) =>
    pattern.test(normalizedLower),
  );
  const supportsThinkingByFamily =
    !isThinkingOptOutModel &&
    (isGoogleThinkingLevelModel(normalizedModel) ||
      /^gemini-2\.(?:[5-9]|\d{2,})(?:\.|$|-)/.test(normalizedLower) ||
      /thinking/.test(normalizedLower));
  const hasExplicitThinkingMetadata =
    metadata != null && Object.prototype.hasOwnProperty.call(metadata, 'thinking');
  const supportsThinking = hasExplicitThinkingMetadata
    ? Boolean(metadata?.thinking)
    : supportsThinkingByFamily;
  const supportsThinkingLevel = supportsThinking && isGoogleThinkingLevelModel(normalizedModel);
  const supportsThinkingBudget = supportsThinking && !supportsThinkingLevel;
  const supportsTemperature =
    isTextCompatible &&
    (metadata == null ||
      metadata.temperature !== undefined ||
      metadata.maxTemperature !== undefined);
  const supportsTopP = isTextCompatible && (metadata == null || metadata.topP !== undefined);
  const supportsTopK = isTextCompatible && (metadata == null || metadata.topK !== undefined);
  const supportsMaxOutputTokens =
    isTextCompatible && (metadata?.outputTokenLimit == null || metadata.outputTokenLimit > 1);
  const supportsWebSearch = isTextCompatible && supportsGoogleSearchGrounding(normalizedModel);
  const maxOutputTokensMax = metadata?.outputTokenLimit ?? googleSettings.maxOutputTokens.max;
  const maxOutputTokensDefault = Math.min(
    googleSettings.maxOutputTokens.default,
    maxOutputTokensMax,
  );
  const topKDefault = metadata?.topK ?? googleSettings.topK.default;

  return {
    model: normalizedModel,
    metadata: metadata ?? undefined,
    isTextCompatible,
    supportsTemperature,
    supportsTopP,
    supportsTopK,
    supportsMaxOutputTokens,
    supportsThinking,
    supportsThinkingBudget,
    supportsThinkingLevel,
    supportsWebSearch,
    temperatureDefault: metadata?.temperature ?? googleSettings.temperature.default,
    temperatureMax: metadata?.maxTemperature ?? googleSettings.temperature.max,
    topPDefault: metadata?.topP ?? googleSettings.topP.default,
    topKDefault,
    topKMax: Math.max(googleSettings.topK.max, topKDefault),
    maxOutputTokensDefault,
    maxOutputTokensMax,
  };
}

export function getGoogleSettingCapabilityState(
  settingKey: string,
  capabilities: TResolvedGoogleModelCapabilities,
): TGoogleSettingCapabilityState {
  switch (settingKey) {
    case 'temperature':
      return capabilities.supportsTemperature
        ? { supported: true }
        : {
            supported: false,
            reason: 'This model does not expose temperature controls in the Gemini models API.',
          };
    case 'topP':
      return capabilities.supportsTopP
        ? { supported: true }
        : {
            supported: false,
            reason: 'This model does not expose top-p controls in the Gemini models API.',
          };
    case 'topK':
      return capabilities.supportsTopK
        ? { supported: true }
        : {
            supported: false,
            reason: 'This model does not expose top-k controls in the Gemini models API.',
          };
    case 'maxOutputTokens':
      return capabilities.supportsMaxOutputTokens
        ? { supported: true }
        : {
            supported: false,
            reason: 'This model does not expose output token controls in the Gemini models API.',
          };
    case 'thinking':
      return capabilities.supportsThinking
        ? { supported: true }
        : {
            supported: false,
            reason: 'This model does not support thinking/reasoning controls.',
          };
    case 'thinkingBudget':
      if (!capabilities.supportsThinking) {
        return {
          supported: false,
          reason: 'This model does not support thinking/reasoning controls.',
        };
      }

      return capabilities.supportsThinkingBudget
        ? { supported: true }
        : {
            supported: false,
            reason: 'This model uses Thinking Level instead of Thinking Budget.',
          };
    case 'thinkingLevel':
      if (!capabilities.supportsThinking) {
        return {
          supported: false,
          reason: 'This model does not support thinking/reasoning controls.',
        };
      }

      return capabilities.supportsThinkingLevel
        ? { supported: true }
        : {
            supported: false,
            reason: 'This model uses Thinking Budget instead of Thinking Level.',
          };
    case 'web_search':
      return capabilities.supportsWebSearch
        ? { supported: true }
        : {
            supported: false,
            reason: 'This model does not support Google Search grounding in LibreChat.',
          };
    default:
      return { supported: true };
  }
}
