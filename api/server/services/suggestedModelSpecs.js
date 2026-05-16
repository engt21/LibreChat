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

function getOpenAIPreferredVariantRank(model) {
  const lower = model.toLowerCase();
  if (/^gpt-\d+(?:\.\d+)?$/.test(lower)) {
    return 0;
  }
  if (/^gpt-\d+(?:\.\d+)?-mini(?:$|-)/.test(lower)) {
    return 1;
  }
  return 10;
}

function getOpenAILineageKey(model) {
  const lower = model.toLowerCase();
  const match = lower.match(/^gpt-(\d+)(?:\.(\d+))?(-mini)?/);
  if (!match) {
    return lower;
  }
  return `gpt:${match[1]}:${match[2] ?? '0'}:${match[3] ? 'mini' : 'base'}`;
}

function isPreferredOpenAISuggestion(model) {
  const lower = model.toLowerCase();
  if (!/^gpt-\d/.test(lower)) {
    return false;
  }
  if (/(?:^|-)instruct(?:$|-)|(?:^|-)pro(?:$|-)|(?:^|-)nano(?:$|-)/.test(lower)) {
    return false;
  }
  if (/(?:^|-)thinking(?:$|-)|(?:^|-)codex(?:$|-)|(?:^|-)chat(?:$|-)/.test(lower)) {
    return false;
  }
  if (/(?:^|-)search(?:$|-)|(?:^|-)preview(?:$|-)|vision/i.test(lower)) {
    return false;
  }
  return getOpenAIPreferredVariantRank(lower) < 10;
}

function sortOpenAISuggestions(models) {
  const indexMap = new Map();
  models.forEach((model, index) => {
    if (!indexMap.has(model)) {
      indexMap.set(model, index);
    }
  });

  return models.slice().sort((a, b) => {
    const scoreA = getOpenAIModelVersionScore(a);
    const scoreB = getOpenAIModelVersionScore(b);
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

function dedupeSuggestions(models, getKey, limit) {
  const seen = new Set();
  const suggestions = [];

  for (const model of models) {
    if (suggestions.length >= limit) {
      break;
    }
    const key = getKey(model);
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
  );
  const preferred = sortOpenAISuggestions(uniqueModels.filter(isPreferredOpenAISuggestion));
  const suggestions = dedupeSuggestions(preferred, getOpenAILineageKey, limit);

  if (suggestions.length >= limit) {
    return suggestions;
  }

  const fallback = sortOpenAISuggestions(
    uniqueModels.filter((model) => !suggestions.includes(model)),
  );
  return [...suggestions, ...fallback].slice(0, limit);
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

  if (endpoint === EModelEndpoint.openAI) {
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

function isSimpleProviderShortcutSpec(spec) {
  const endpoint = spec?.preset?.endpoint;
  if (!endpoint || spec?.group !== endpoint) {
    return false;
  }
  return !SIMPLE_SPEC_BEHAVIOR_KEYS.some((key) => spec[key] != null);
}

function humanizeModelName(model) {
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
    const suggestions = getSuggestedModelsForEndpoint(
      endpoint,
      modelsConfig[endpoint],
      indexes.length,
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
