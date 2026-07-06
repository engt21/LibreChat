const {
  EModelEndpoint,
  getAnthropicQuickSelectModelNames,
  isGoogleTextCompatibleModel,
  normalizeGoogleModelName,
  normalizeXAIModelName,
  isXAITextCompatibleModel,
} = require('librechat-data-provider');

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

const PROVIDER_LABELS = {
  [EModelEndpoint.openAI]: 'OpenAI',
  [EModelEndpoint.azureOpenAI]: 'Azure OpenAI',
  [EModelEndpoint.anthropic]: 'Anthropic',
  [EModelEndpoint.google]: 'Google',
  xai: 'xAI',
};

const SIMPLE_SPEC_BEHAVIOR_KEYS = [
  'authType',
  'webSearch',
  'fileSearch',
  'executeCode',
  'artifacts',
  'mcpServers',
  'default',
];

const OPENAI_CHAT_LATEST_MODEL = 'chat-latest';
const OPENAI_CHAT_LATEST_ALIASES = new Set([OPENAI_CHAT_LATEST_MODEL, 'gpt-chat-latest']);
const OPENAI_VERSIONED_CHAT_LATEST_REGEX = /^gpt-\d+(?:\.\d+)?-chat-latest$/i;
const OPENAI_SUGGESTION_ENDPOINTS = new Set([EModelEndpoint.openAI, EModelEndpoint.azureOpenAI]);
const OPENAI_DATED_SNAPSHOT_REGEX = /(?:-\d{4}-\d{2}-\d{2}|-\d{4}(?:-[a-z]+)?)$/;
const OPENAI_RELEASE_ORDER = [
  OPENAI_CHAT_LATEST_MODEL,
  'gpt-chat-latest',
  'gpt-5.5',
  'gpt-5.5-pro',
  'gpt-5.4',
  'gpt-5.4-pro',
  'gpt-5.4-mini',
  'gpt-5.4-nano',
  'gpt-5.2',
  'gpt-5.2-pro',
  'gpt-5.1',
  'gpt-5',
  'gpt-5-mini',
  'gpt-5-nano',
  'o4-mini',
  'o3',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'o1-pro',
  'gpt-4.5-preview',
  'o3-mini',
  'o1',
  'o1-mini',
  'o1-preview',
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4-turbo',
  'gpt-3.5-turbo',
  'gpt-4',
];
const OPENAI_RELEASE_ORDER_SCORES = new Map(
  OPENAI_RELEASE_ORDER.map((model, index) => [model, 900_000_000 - index * 10_000]),
);

function getOpenAIModelVersionScore(model) {
  if (typeof model !== 'string' || !model) {
    return -1;
  }

  const lower = model.toLowerCase();
  let match = lower.match(/^gpt-(\d+)(?:\.(\d+))?/);
  if (match) {
    return parseInt(match[1], 10) * 100 + (match[2] ? parseInt(match[2], 10) : 0);
  }

  match = lower.match(/^chatgpt-(\d+)(?:\.(\d+))?/);
  if (match) {
    return parseInt(match[1], 10) * 100 + (match[2] ? parseInt(match[2], 10) : 0);
  }

  match = lower.match(/^o(\d+)/);
  if (match) {
    return parseInt(match[1], 10) * 100;
  }

  return -1;
}

function getOpenAIStableModelId(model) {
  return model.trim().replace(OPENAI_DATED_SNAPSHOT_REGEX, '');
}

function getOpenAIModelReleaseScore(model) {
  if (typeof model !== 'string' || !model) {
    return -1;
  }

  const lower = getOpenAIStableModelId(model).toLowerCase();
  if (OPENAI_CHAT_LATEST_ALIASES.has(lower)) {
    return lower === OPENAI_CHAT_LATEST_MODEL ? 2_000_000_100 : 2_000_000_000;
  }
  if (OPENAI_VERSIONED_CHAT_LATEST_REGEX.test(lower)) {
    return 1_000_000_000 + getOpenAIModelVersionScore(lower);
  }

  const knownScore = OPENAI_RELEASE_ORDER_SCORES.get(lower);
  if (knownScore != null) {
    return knownScore;
  }

  for (const [knownModel, score] of OPENAI_RELEASE_ORDER_SCORES) {
    if (lower.startsWith(`${knownModel}-`)) {
      return score;
    }
  }

  const versionScore = getOpenAIModelVersionScore(lower);
  if (versionScore > getOpenAIModelVersionScore('gpt-5.5')) {
    return 950_000_000 + versionScore;
  }

  return versionScore;
}

function isOpenAIAlphaModel(model) {
  return typeof model === 'string' && model.toLowerCase().includes('-alpha');
}

function getOpenAIPreferredVariantRank(model) {
  const lower = getOpenAIStableModelId(model).toLowerCase();
  if (isOpenAIChatLatestModel(lower)) {
    return 0;
  }
  if (/^gpt-\d+(?:\.\d+)?$/.test(lower)) {
    return 1;
  }
  if (/^gpt-\d+(?:\.\d+)?-pro(?:$|-)/.test(lower)) {
    return 2;
  }
  if (/^gpt-\d+(?:\.\d+)?-mini(?:$|-)/.test(lower)) {
    return 3;
  }
  if (/^gpt-\d+(?:\.\d+)?-nano(?:$|-)/.test(lower)) {
    return 4;
  }
  return 10;
}

function isOpenAIStableFullModel(model) {
  return /^gpt-\d+(?:\.\d+)?$/i.test(getOpenAIStableModelId(model));
}

function isOpenAIStableMiniModel(model) {
  return /^gpt-\d+(?:\.\d+)?-mini$/i.test(getOpenAIStableModelId(model));
}

function isOpenAIChatLatestModel(model) {
  const lower = getOpenAIStableModelId(model).toLowerCase();
  return OPENAI_CHAT_LATEST_ALIASES.has(lower) || OPENAI_VERSIONED_CHAT_LATEST_REGEX.test(lower);
}

function isPreferredOpenAISuggestion(model) {
  const lower = getOpenAIStableModelId(model).toLowerCase();
  if (isOpenAIAlphaModel(lower) || OPENAI_DATED_SNAPSHOT_REGEX.test(model)) {
    return false;
  }
  return (
    isOpenAIChatLatestModel(lower) ||
    isOpenAIStableFullModel(lower) ||
    isOpenAIStableMiniModel(lower)
  );
}

function sortOpenAISuggestions(models) {
  const indexMap = new Map();
  models.forEach((model, index) => {
    if (!indexMap.has(model)) {
      indexMap.set(model, index);
    }
  });

  return models.slice().sort((a, b) => {
    const scoreA = getOpenAIModelReleaseScore(a);
    const scoreB = getOpenAIModelReleaseScore(b);
    if (scoreA !== scoreB) {
      return scoreB - scoreA;
    }

    const variantA = getOpenAIPreferredVariantRank(a);
    const variantB = getOpenAIPreferredVariantRank(b);
    if (variantA !== variantB) {
      return variantA - variantB;
    }

    return (indexMap.get(a) ?? 0) - (indexMap.get(b) ?? 0);
  });
}

function dedupeSuggestions(models, getKeyOrLimit, maybeLimit) {
  const getKey = typeof getKeyOrLimit === 'function' ? getKeyOrLimit : getOpenAIStableModelId;
  const limit = typeof getKeyOrLimit === 'number' ? getKeyOrLimit : maybeLimit;
  const seen = new Set();
  const suggestions = [];

  for (const model of models) {
    if (suggestions.length >= limit) {
      break;
    }
    const key = getKey(model).toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    suggestions.push(model);
  }

  return suggestions;
}

function getOpenAISuggestedModels(models, limit) {
  const uniqueModels = Array.from(
    new Set((models ?? []).filter((model) => typeof model === 'string')),
  ).filter(isPreferredOpenAISuggestion);

  const suggestions = [];
  const chatLatestCandidates = uniqueModels.filter(isOpenAIChatLatestModel);
  const chatLatest =
    chatLatestCandidates.find(
      (model) => getOpenAIStableModelId(model).toLowerCase() === OPENAI_CHAT_LATEST_MODEL,
    ) ||
    chatLatestCandidates.find(
      (model) => getOpenAIStableModelId(model).toLowerCase() === 'gpt-chat-latest',
    ) ||
    sortOpenAISuggestions(chatLatestCandidates)[0];
  if (chatLatest) {
    suggestions.push(chatLatest);
  }

  const latestFull = sortOpenAISuggestions(
    uniqueModels.filter((model) => isOpenAIStableFullModel(model) && !suggestions.includes(model)),
  )[0];
  if (latestFull) {
    suggestions.push(latestFull);
  }

  const latestMini = sortOpenAISuggestions(
    uniqueModels.filter((model) => isOpenAIStableMiniModel(model) && !suggestions.includes(model)),
  )[0];
  if (latestMini) {
    suggestions.push(latestMini);
  }

  if (suggestions.length >= limit) {
    return suggestions.slice(0, limit);
  }

  const fallback = sortOpenAISuggestions(
    uniqueModels.filter((model) => !suggestions.includes(model)),
  );
  return dedupeSuggestions([...suggestions, ...fallback], limit);
}

function getGoogleModelVersionScore(model) {
  const normalized = normalizeGoogleModelName(model).toLowerCase();
  const match = normalized.match(/^gemini-(\d+)(?:\.(\d+))?/);
  if (!match) {
    return -1;
  }
  return parseInt(match[1], 10) * 100 + (match[2] ? parseInt(match[2], 10) : 0);
}

function getGoogleVariantRank(model) {
  const lower = normalizeGoogleModelName(model).toLowerCase();
  if (/pro/.test(lower)) {
    return 0;
  }
  if (/flash/.test(lower) && !/lite/.test(lower)) {
    return 1;
  }
  if (/flash-lite/.test(lower)) {
    return 2;
  }
  return 3;
}

function getGoogleLineageKey(model) {
  const lower = normalizeGoogleModelName(model).toLowerCase();
  const match = lower.match(/^gemini-(\d+)(?:\.(\d+))?-([a-z]+(?:-[a-z]+)?)/);
  if (!match) {
    return lower;
  }
  return `gemini:${match[1]}:${match[2] ?? '0'}:${match[3]}`;
}

function getGoogleSuggestedModels(models, limit) {
  const uniqueModels = Array.from(
    new Set(
      (models ?? [])
        .map((model) => normalizeGoogleModelName(model))
        .filter((model) => model && isGoogleTextCompatibleModel(model)),
    ),
  );
  const sorted = uniqueModels.slice().sort((a, b) => {
    const scoreA = getGoogleModelVersionScore(a);
    const scoreB = getGoogleModelVersionScore(b);
    if (scoreA !== scoreB) {
      return scoreB - scoreA;
    }
    const variantA = getGoogleVariantRank(a);
    const variantB = getGoogleVariantRank(b);
    if (variantA !== variantB) {
      return variantA - variantB;
    }
    return collator.compare(a, b);
  });
  return dedupeSuggestions(sorted, getGoogleLineageKey, limit);
}

function getXAIVersionScore(model) {
  const lower = normalizeXAIModelName(model).toLowerCase();
  const match = lower.match(/^grok-(\d+)(?:[.-](\d+))?/);
  if (!match) {
    return -1;
  }
  return parseInt(match[1], 10) * 100 + (match[2] ? parseInt(match[2], 10) : 0);
}

function getXAISuggestedModels(models, limit) {
  const uniqueModels = Array.from(
    new Set(
      (models ?? [])
        .map((model) => normalizeXAIModelName(model))
        .filter((model) => model && isXAITextCompatibleModel(model)),
    ),
  );
  return uniqueModels
    .slice()
    .sort((a, b) => {
      const scoreA = getXAIVersionScore(a);
      const scoreB = getXAIVersionScore(b);
      if (scoreA !== scoreB) {
        return scoreB - scoreA;
      }
      return collator.compare(a, b);
    })
    .slice(0, limit);
}

function getSuggestedModelsForEndpoint(endpoint, models, limit) {
  if (!Array.isArray(models) || models.length === 0 || limit <= 0) {
    return [];
  }

  if (OPENAI_SUGGESTION_ENDPOINTS.has(endpoint)) {
    return getOpenAISuggestedModels(models, limit);
  }
  if (endpoint === EModelEndpoint.anthropic) {
    return getAnthropicQuickSelectModelNames(models, undefined, limit);
  }
  if (endpoint === EModelEndpoint.google) {
    return getGoogleSuggestedModels(models, limit);
  }
  if (endpoint === 'xai') {
    return getXAISuggestedModels(models, limit);
  }

  return models.slice(0, limit);
}

function getDynamicSuggestionLimit(endpoint, configuredSlotCount) {
  const maxSuggestions = OPENAI_SUGGESTION_ENDPOINTS.has(endpoint)
    ? 3
    : endpoint === EModelEndpoint.anthropic
      ? 2
      : 1;
  return Math.min(configuredSlotCount, maxSuggestions);
}

function isSimpleProviderShortcutSpec(spec) {
  const endpoint = spec?.preset?.endpoint;
  if (!endpoint || spec?.group !== endpoint) {
    return false;
  }
  return !SIMPLE_SPEC_BEHAVIOR_KEYS.some((key) => spec[key] != null);
}

function humanizeModelName(model) {
  if (isOpenAIChatLatestModel(model)) {
    return 'Chat Latest';
  }

  return model
    .replace(/^models\//, '')
    .replace(/^google\//, '')
    .replace(/^xai\//, '')
    .replace(/-/g, ' ')
    .replace(/\bai\b/gi, 'AI')
    .replace(/\bgpt\b/gi, 'GPT')
    .replace(/\b([a-z])/gi, (char) => char.toUpperCase())
    .replace(/\b(\d+) (\d+)\b/g, '$1.$2')
    .replace(/^GPT (\d+(?:\.\d+)?)/, 'GPT-$1');
}

function getSuggestedDescription(endpoint) {
  return `Suggested ${PROVIDER_LABELS[endpoint] ?? endpoint} model`;
}

function applyDynamicSuggestedModelSpecs(modelSpecsConfig, modelsConfig = {}) {
  if (!modelSpecsConfig?.list || !Array.isArray(modelSpecsConfig.list)) {
    return modelSpecsConfig;
  }

  const simpleIndexesByEndpoint = modelSpecsConfig.list.reduce((acc, spec, index) => {
    if (!isSimpleProviderShortcutSpec(spec)) {
      return acc;
    }

    const endpoint = spec.preset.endpoint;
    if (!acc[endpoint]) {
      acc[endpoint] = [];
    }
    acc[endpoint].push(index);
    return acc;
  }, {});

  if (Object.keys(simpleIndexesByEndpoint).length === 0) {
    return modelSpecsConfig;
  }

  const list = modelSpecsConfig.list.map((spec) => ({ ...spec, preset: { ...spec.preset } }));
  const removeIndexes = new Set();

  for (const [endpoint, indexes] of Object.entries(simpleIndexesByEndpoint)) {
    const suggestionLimit = getDynamicSuggestionLimit(endpoint, indexes.length);
    const suggestions = getSuggestedModelsForEndpoint(
      endpoint,
      modelsConfig[endpoint],
      suggestionLimit,
    );
    if (Array.isArray(modelsConfig[endpoint])) {
      indexes.slice(suggestions.length).forEach((index) => removeIndexes.add(index));
    }
    suggestions.forEach((model, suggestionIndex) => {
      const listIndex = indexes[suggestionIndex];
      if (listIndex == null) {
        return;
      }
      const label = humanizeModelName(model);
      list[listIndex] = {
        ...list[listIndex],
        label,
        description: getSuggestedDescription(endpoint),
        preset: {
          ...list[listIndex].preset,
          model,
        },
      };
    });
  }

  return {
    ...modelSpecsConfig,
    list: list.filter((_, index) => !removeIndexes.has(index)),
  };
}

module.exports = {
  applyDynamicSuggestedModelSpecs,
  getSuggestedModelsForEndpoint,
};
