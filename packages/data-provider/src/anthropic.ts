import { supportsAdaptiveThinking } from './bedrock';
import { AnthropicEffort, anthropicSettings } from './schemas';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const anthropicFamilies = new Set(['opus', 'sonnet', 'haiku'] as const);
const anthropicFamilyRank = {
  opus: 3,
  sonnet: 2,
  haiku: 1,
  unknown: 0,
} as const;

type AnthropicFamily = keyof typeof anthropicFamilyRank;

type ParsedAnthropicModelName = {
  normalizedModel: string;
  family: AnthropicFamily;
  majorVersion: number;
  minorVersion: number;
  hasLatestAlias: boolean;
  hasDateSuffix: boolean;
  lineageKey: string;
};

export type TAnthropicModelCapabilities = {
  id: string;
  display_name?: string;
  created_at?: string;
  type?: 'model';
};

export type TResolvedAnthropicModelCapabilities = {
  model: string;
  metadata?: TAnthropicModelCapabilities;
  family: AnthropicFamily;
  majorVersion: number;
  minorVersion: number;
  isTextCompatible: boolean;
  supportsTemperature: boolean;
  supportsTopP: boolean;
  supportsTopK: boolean;
  supportsMaxOutputTokens: boolean;
  supportsStop: boolean;
  supportsPromptCache: boolean;
  supportsThinking: boolean;
  supportsAdaptiveThinking: boolean;
  supportsThinkingBudget: boolean;
  supportsEffort: boolean;
  supportsEffortMax: boolean;
  supportsWebSearch: boolean;
  supportsCodeExecution: boolean;
  supportsServiceTier: boolean;
  maxOutputTokensDefault: number;
  maxOutputTokensMax: number;
  effortOptions: AnthropicEffort[];
};

export type TAnthropicSettingCapabilityState = {
  supported: boolean;
  reason?: string;
};

type AnthropicSettingCapabilityOptions = {
  thinking?: boolean | null;
  defaultThinking?: boolean;
};

function isShortVersionToken(token?: string): boolean {
  return !!token && /^\d{1,2}$/.test(token);
}

function parseAnthropicModelName(model?: string | null): ParsedAnthropicModelName {
  const normalizedModel = normalizeAnthropicModelName(model).toLowerCase();
  const tokens = normalizedModel.replace(/\./g, '-').split(/[^a-z0-9]+/).filter(Boolean);
  const familyIndex = tokens.findIndex((token) =>
    anthropicFamilies.has(token as Exclude<AnthropicFamily, 'unknown'>),
  );

  let family: AnthropicFamily = 'unknown';
  let majorVersion = 0;
  let minorVersion = 0;

  if (familyIndex >= 0) {
    family = tokens[familyIndex] as Exclude<AnthropicFamily, 'unknown'>;

    const nextMajor = tokens[familyIndex + 1];
    const nextMinor = tokens[familyIndex + 2];
    const prevMinor = tokens[familyIndex - 1];
    const prevMajor = tokens[familyIndex - 2];

    if (isShortVersionToken(nextMajor)) {
      majorVersion = parseInt(nextMajor, 10);
      if (isShortVersionToken(nextMinor)) {
        minorVersion = parseInt(nextMinor, 10);
      }
    } else if (isShortVersionToken(prevMinor)) {
      if (isShortVersionToken(prevMajor)) {
        majorVersion = parseInt(prevMajor, 10);
        minorVersion = parseInt(prevMinor, 10);
      } else {
        majorVersion = parseInt(prevMinor, 10);
      }
    }
  }

  const hasLatestAlias = tokens.includes('latest');
  const hasDateSuffix = tokens.some((token) => /^\d{8}$/.test(token));

  return {
    normalizedModel,
    family,
    majorVersion,
    minorVersion,
    hasLatestAlias,
    hasDateSuffix,
    lineageKey:
      family !== 'unknown' && majorVersion > 0
        ? `${family}:${majorVersion}:${minorVersion}`
        : normalizedModel,
  };
}

function getAnthropicAliasRank(model: ParsedAnthropicModelName): number {
  if (model.hasLatestAlias) {
    return 0;
  }

  if (!model.hasDateSuffix) {
    return 1;
  }

  return 2;
}

function getAnthropicCreatedAtRank(createdAt?: string): number {
  if (!createdAt) {
    return 0;
  }

  const parsed = Date.parse(createdAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function compareAnthropicModels(
  a: string,
  b: string,
  metadataMap?: Record<string, TAnthropicModelCapabilities>,
): number {
  const parsedA = parseAnthropicModelName(a);
  const parsedB = parseAnthropicModelName(b);

  const versionScoreA =
    parsedA.majorVersion * 1000 +
    parsedA.minorVersion * 10 +
    anthropicFamilyRank[parsedA.family];
  const versionScoreB =
    parsedB.majorVersion * 1000 +
    parsedB.minorVersion * 10 +
    anthropicFamilyRank[parsedB.family];

  if (versionScoreA !== versionScoreB) {
    return versionScoreB - versionScoreA;
  }

  const aliasRankA = getAnthropicAliasRank(parsedA);
  const aliasRankB = getAnthropicAliasRank(parsedB);
  if (aliasRankA !== aliasRankB) {
    return aliasRankA - aliasRankB;
  }

  const createdAtRankA = getAnthropicCreatedAtRank(
    metadataMap?.[parsedA.normalizedModel]?.created_at,
  );
  const createdAtRankB = getAnthropicCreatedAtRank(
    metadataMap?.[parsedB.normalizedModel]?.created_at,
  );
  if (createdAtRankA !== createdAtRankB) {
    return createdAtRankB - createdAtRankA;
  }

  return collator.compare(parsedA.normalizedModel, parsedB.normalizedModel);
}

function inferAnthropicWebSearchSupport(model: ParsedAnthropicModelName): boolean {
  const normalizedModel = model.normalizedModel;

  if (model.majorVersion >= 4) {
    return true;
  }

  return (
    /^claude-3[-.]7-sonnet(?:$|[-.])/i.test(normalizedModel) ||
    /^claude-3[-.]5-(?:sonnet|haiku)(?:$|[-.])/i.test(normalizedModel)
  );
}

function inferAnthropicCodeExecutionSupport(model: ParsedAnthropicModelName): boolean {
  const normalizedModel = model.normalizedModel;

  if (model.majorVersion >= 4) {
    return true;
  }

  return /^claude-3[-.]7-sonnet(?:$|[-.])/i.test(normalizedModel);
}

function inferAnthropicThinkingSupport(model: ParsedAnthropicModelName): boolean {
  const normalizedModel = model.normalizedModel;

  if (model.majorVersion >= 4) {
    return true;
  }

  return /^claude-3[-.]7-sonnet(?:$|[-.])/i.test(normalizedModel);
}

function checkPromptCacheSupport(modelName: string): boolean {
  if (
    modelName.includes('claude-3-5-sonnet-latest') ||
    modelName.includes('claude-3.5-sonnet-latest')
  ) {
    return false;
  }

  return (
    /claude-3[-.]7/.test(modelName) ||
    /claude-3[-.]5-(?:sonnet|haiku)/.test(modelName) ||
    /claude-3-(?:sonnet|haiku|opus)?/.test(modelName) ||
    /claude-(?:sonnet|opus|haiku)-[4-9]/.test(modelName) ||
    /claude-[4-9]-(?:sonnet|opus|haiku)?/.test(modelName) ||
    /claude-4(?:-(?:sonnet|opus|haiku))?/.test(modelName)
  );
}

export function normalizeAnthropicModelName(model?: string | null): string {
  const trimmedModel = (model ?? '').trim();

  if (!trimmedModel) {
    return '';
  }

  const modelPathMatch = trimmedModel.match(/(?:^|\/)models\/([^/?#]+)/);
  if (modelPathMatch?.[1]) {
    return modelPathMatch[1].trim();
  }

  return trimmedModel.replace(/^anthropic\//i, '').trim();
}

export function isAnthropicTextCompatibleModel(
  model: TAnthropicModelCapabilities | string,
): boolean {
  const normalizedModel = normalizeAnthropicModelName(
    typeof model === 'string' ? model : model.id,
  ).toLowerCase();

  return normalizedModel.startsWith('claude');
}

export function buildAnthropicModelCapabilitiesMap(
  models: TAnthropicModelCapabilities[] = [],
): Record<string, TAnthropicModelCapabilities> {
  return models.reduce<Record<string, TAnthropicModelCapabilities>>((acc, model) => {
    const normalizedModel = normalizeAnthropicModelName(model.id);

    if (!normalizedModel || acc[normalizedModel] != null || !isAnthropicTextCompatibleModel(model)) {
      return acc;
    }

    acc[normalizedModel] = {
      ...model,
      id: normalizedModel,
    };

    return acc;
  }, {});
}

export function buildStaticAnthropicModelCapabilities(
  models: string[] = [],
): Record<string, TAnthropicModelCapabilities> | undefined {
  const uniqueNormalizedModels = Array.from(
    new Set(models.map((model) => normalizeAnthropicModelName(model)).filter(Boolean)),
  );
  const normalizedModels = sortAnthropicModels(
    uniqueNormalizedModels.filter((model) => isAnthropicTextCompatibleModel(model)),
  );

  if (normalizedModels.length === 0) {
    return undefined;
  }

  return normalizedModels.reduce<Record<string, TAnthropicModelCapabilities>>((acc, model) => {
    acc[model] = {
      id: model,
      display_name: model,
      type: 'model',
    };

    return acc;
  }, {});
}

export function sortAnthropicModels(
  modelNames: string[] = [],
  metadataMap?: Record<string, TAnthropicModelCapabilities>,
): string[] {
  return Array.from(
    new Set(modelNames.map((model) => normalizeAnthropicModelName(model)).filter(Boolean)),
  )
    .filter((model) => isAnthropicTextCompatibleModel(model))
    .sort((a, b) => compareAnthropicModels(a, b, metadataMap));
}

export function getAnthropicQuickSelectModelNames(
  modelNames: string[] = [],
  metadataMap?: Record<string, TAnthropicModelCapabilities>,
  limit = 4,
): string[] {
  const sortedModels = sortAnthropicModels(modelNames, metadataMap);
  const seenLineages = new Set<string>();

  return sortedModels.reduce<string[]>((acc, model) => {
    if (acc.length >= limit) {
      return acc;
    }

    const parsed = parseAnthropicModelName(model);
    if (seenLineages.has(parsed.lineageKey)) {
      return acc;
    }

    seenLineages.add(parsed.lineageKey);
    acc.push(model);
    return acc;
  }, []);
}

export function getAnthropicModelCapabilities(
  model: string | null | undefined,
  metadata?: TAnthropicModelCapabilities | null,
): TResolvedAnthropicModelCapabilities {
  const normalizedModel = normalizeAnthropicModelName(model);
  const parsedModel = parseAnthropicModelName(normalizedModel);
  const isTextCompatible = isAnthropicTextCompatibleModel(metadata ?? normalizedModel);
  const supportsThinking = isTextCompatible && inferAnthropicThinkingSupport(parsedModel);
  const adaptiveThinking = supportsThinking && supportsAdaptiveThinking(normalizedModel);
  const supportsEffort = adaptiveThinking;
  const supportsEffortMax =
    adaptiveThinking &&
    parsedModel.family === 'opus' &&
    (parsedModel.majorVersion > 4 ||
      (parsedModel.majorVersion === 4 && parsedModel.minorVersion >= 6));
  const effortOptions = supportsEffort
    ? anthropicSettings.effort.options.filter((option) => {
        if (option !== AnthropicEffort.max) {
          return true;
        }

        return supportsEffortMax;
      })
    : anthropicSettings.effort.options;
  const maxOutputTokensMax = anthropicSettings.maxOutputTokens.reset(normalizedModel);

  return {
    model: normalizedModel,
    metadata: metadata ?? undefined,
    family: parsedModel.family,
    majorVersion: parsedModel.majorVersion,
    minorVersion: parsedModel.minorVersion,
    isTextCompatible,
    supportsTemperature: isTextCompatible,
    supportsTopP: isTextCompatible,
    supportsTopK: isTextCompatible,
    supportsMaxOutputTokens: isTextCompatible,
    supportsStop: isTextCompatible,
    supportsPromptCache: isTextCompatible && checkPromptCacheSupport(normalizedModel),
    supportsThinking,
    supportsAdaptiveThinking: adaptiveThinking,
    supportsThinkingBudget: supportsThinking && !adaptiveThinking,
    supportsEffort,
    supportsEffortMax,
    supportsWebSearch: isTextCompatible && inferAnthropicWebSearchSupport(parsedModel),
    supportsCodeExecution: isTextCompatible && inferAnthropicCodeExecutionSupport(parsedModel),
    supportsServiceTier: isTextCompatible,
    maxOutputTokensDefault: Math.min(anthropicSettings.maxOutputTokens.default, maxOutputTokensMax),
    maxOutputTokensMax,
    effortOptions,
  };
}

export function resolveAnthropicThinkingEnabled(
  thinking: boolean | null | undefined,
  defaultThinking: boolean = anthropicSettings.thinking.default,
): boolean {
  if (thinking == null) {
    return defaultThinking;
  }

  return thinking;
}

export function getAnthropicSettingCapabilityState(
  settingKey: string,
  capabilities: TResolvedAnthropicModelCapabilities,
  options: AnthropicSettingCapabilityOptions = {},
): TAnthropicSettingCapabilityState {
  const thinkingEnabled = resolveAnthropicThinkingEnabled(
    options.thinking,
    options.defaultThinking,
  );

  switch (settingKey) {
    case 'temperature':
    case 'topP':
    case 'topK': {
      const supportsSamplingControl =
        settingKey === 'temperature'
          ? capabilities.supportsTemperature
          : settingKey === 'topP'
            ? capabilities.supportsTopP
            : capabilities.supportsTopK;

      if (!supportsSamplingControl) {
        return {
          supported: false,
          reason: 'This Claude model does not expose this sampling control.',
        };
      }

      if (thinkingEnabled && capabilities.supportsThinking) {
        return {
          supported: false,
          reason: 'Anthropic disables temperature, top_p, and top_k while thinking is enabled.',
        };
      }

      return { supported: true };
    }
    case 'promptCache':
      return capabilities.supportsPromptCache
        ? { supported: true }
        : {
            supported: false,
            reason: 'Prompt caching is not available for this Claude model.',
          };
    case 'thinking':
      return capabilities.supportsThinking
        ? { supported: true }
        : {
            supported: false,
            reason: 'Thinking is not available for this Claude model.',
          };
    case 'thinkingBudget':
      if (!capabilities.supportsThinkingBudget) {
        return {
          supported: false,
          reason: capabilities.supportsAdaptiveThinking
            ? 'This Claude model uses adaptive thinking and effort controls instead of a fixed thinking budget.'
            : 'Thinking budgets are not available for this Claude model.',
        };
      }

      if (!thinkingEnabled) {
        return {
          supported: false,
          reason: 'Enable thinking to configure a fixed thinking budget.',
        };
      }

      return { supported: true };
    case 'effort':
      if (!capabilities.supportsEffort) {
        return {
          supported: false,
          reason: capabilities.supportsThinking
            ? 'This Claude model uses a fixed thinking budget instead of adaptive effort controls.'
            : 'Adaptive effort is not available for this Claude model.',
        };
      }

      if (!thinkingEnabled) {
        return {
          supported: false,
          reason: 'Enable thinking to configure adaptive effort.',
        };
      }

      return { supported: true };
    case 'web_search':
      return capabilities.supportsWebSearch
        ? { supported: true }
        : {
            supported: false,
            reason: 'Native Anthropic web search is not available for this Claude model.',
          };
    case 'stop':
      return capabilities.supportsStop
        ? { supported: true }
        : {
            supported: false,
            reason: 'Stop sequences are not available for this Claude model.',
          };
    case 'service_tier':
      return capabilities.supportsServiceTier
        ? { supported: true }
        : {
            supported: false,
            reason: 'Service tier selection is not available for this Claude model.',
          };
    default:
      return { supported: true };
  }
}
