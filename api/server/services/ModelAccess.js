const {
  SystemRoles,
  ViolationTypes,
  EModelEndpoint,
  KnownEndpoints,
} = require('librechat-data-provider');

const ALL_MODELS = '*';

const DEFAULT_NON_ADMIN_MODEL_PERMISSIONS = Object.freeze({
  enabled: true,
  rules: [
    { endpoint: EModelEndpoint.azureOpenAI, models: [ALL_MODELS] },
    { endpoint: KnownEndpoints.ollama, models: [ALL_MODELS] },
    {
      endpoint: EModelEndpoint.openAI,
      models: ['gpt-5.3-chat-latest', 'gpt-5.4-mini', 'gpt-5.4-nano'],
    },
    {
      endpoint: EModelEndpoint.anthropic,
      models: [
        'claude-sonnet-4-5',
        'claude-sonnet-4-5-20250929',
        'claude-sonnet-4-6',
        'claude-haiku-4-5',
        'claude-haiku-4-5-20251001',
        'claude-haiku-4',
        'claude-3-5-haiku-20241022',
        'claude-3-7-sonnet-latest',
        'claude-3-7-sonnet-20250219',
        'claude-3-5-sonnet-20241022',
        'claude-3-5-sonnet-20240620',
        'claude-3-5-sonnet-latest',
        'claude-3',
      ],
    },
    { endpoint: KnownEndpoints.xai, models: ['grok-4-1-fast'] },
  ],
});

const defaultModelPermissions = () => ({ enabled: false, rules: [] });

const allowsAllModels = (models = []) => Array.isArray(models) && models.includes(ALL_MODELS);

function sortRules(rules = []) {
  return [...rules].sort((a, b) => a.endpoint.localeCompare(b.endpoint));
}

function normalizeModelPermissionRules(rules = []) {
  const endpointMap = new Map();

  for (const rule of Array.isArray(rules) ? rules : []) {
    const endpoint = typeof rule?.endpoint === 'string' ? rule.endpoint.trim() : '';
    if (!endpoint) {
      continue;
    }

    const existingModels = endpointMap.get(endpoint);
    if (allowsAllModels(existingModels ? Array.from(existingModels) : [])) {
      continue;
    }

    if (allowsAllModels(rule?.models)) {
      endpointMap.set(endpoint, new Set([ALL_MODELS]));
      continue;
    }

    const models = existingModels ?? new Set();
    for (const model of Array.isArray(rule?.models) ? rule.models : []) {
      const normalizedModel = typeof model === 'string' ? model.trim() : '';
      if (normalizedModel) {
        models.add(normalizedModel);
      }
    }

    endpointMap.set(endpoint, models);
  }

  return sortRules(
    Array.from(endpointMap.entries()).map(([endpoint, models]) => ({
      endpoint,
      models: Array.from(models).sort((a, b) => a.localeCompare(b)),
    })),
  );
}

function normalizeModelPermissions(modelPermissions = defaultModelPermissions()) {
  return {
    enabled: modelPermissions?.enabled === true,
    rules: normalizeModelPermissionRules(modelPermissions?.rules),
  };
}

function getDefaultModelPermissionsForRole(role = SystemRoles.USER) {
  if (role === SystemRoles.ADMIN) {
    return defaultModelPermissions();
  }

  return normalizeModelPermissions(DEFAULT_NON_ADMIN_MODEL_PERMISSIONS);
}

function applyDefaultModelPermissions(userData = {}) {
  if (userData.modelPermissions != null) {
    return userData;
  }

  const role = userData.role ?? SystemRoles.USER;
  if (role === SystemRoles.ADMIN) {
    return userData;
  }

  return {
    ...userData,
    modelPermissions: getDefaultModelPermissionsForRole(role),
  };
}

function hasModelRestrictions(user) {
  if (!user || user.role === SystemRoles.ADMIN) {
    return false;
  }

  return normalizeModelPermissions(user.modelPermissions).enabled;
}

function getAllowedModelsMap(user) {
  const { rules } = normalizeModelPermissions(user?.modelPermissions);
  return new Map(rules.map((rule) => [rule.endpoint, new Set(rule.models)]));
}

function filterModelsConfigForUser(modelsConfig = {}, user) {
  if (!modelsConfig || !hasModelRestrictions(user)) {
    return modelsConfig;
  }

  const allowedModelsMap = getAllowedModelsMap(user);

  return Object.entries(modelsConfig).reduce((acc, [endpoint, models]) => {
    if (!Array.isArray(models) || endpoint === 'initial') {
      acc[endpoint] = models;
      return acc;
    }

    const allowedModels = allowedModelsMap.get(endpoint);
    if (!allowedModels) {
      acc[endpoint] = [];
      return acc;
    }

    if (allowedModels.has(ALL_MODELS)) {
      acc[endpoint] = models;
      return acc;
    }

    acc[endpoint] = models.filter((model) => allowedModels.has(model));
    return acc;
  }, {});
}

function isModelAllowedForConfig(modelsConfig = {}, endpoint, model) {
  if (!endpoint || !model) {
    return false;
  }

  const availableModels = modelsConfig?.[endpoint];
  return Array.isArray(availableModels) && availableModels.includes(model);
}

function filterModelSpecsConfig(modelSpecsConfig, modelsConfig = {}) {
  if (!modelSpecsConfig?.list) {
    return modelSpecsConfig;
  }

  const list = modelSpecsConfig.list.filter((spec) => {
    const endpoint = spec?.preset?.endpoint;
    if (!endpoint) {
      return true;
    }

    const availableModels = modelsConfig?.[endpoint];
    if (!Array.isArray(availableModels)) {
      return true;
    }

    const model = spec?.preset?.model;
    if (!model) {
      return availableModels.length > 0;
    }

    return availableModels.includes(model);
  });

  return {
    ...modelSpecsConfig,
    list,
  };
}

function validateModelPermissions(modelPermissions, modelsConfig = {}) {
  const normalized = normalizeModelPermissions(modelPermissions);

  for (const rule of normalized.rules) {
    const availableModels = modelsConfig?.[rule.endpoint];

    if (!Array.isArray(availableModels)) {
      return {
        isValid: false,
        message: `Invalid endpoint in model permissions: ${rule.endpoint}`,
      };
    }

    const invalidModels = rule.models.filter(
      (model) => model !== ALL_MODELS && !availableModels.includes(model),
    );
    if (invalidModels.length > 0) {
      return {
        isValid: false,
        message: `Invalid model permissions for endpoint ${rule.endpoint}`,
      };
    }
  }

  return {
    isValid: true,
    modelPermissions: normalized,
  };
}

async function validateModelAccess({ req, res, endpoint, model, modelsConfig }) {
  if (!model) {
    return {
      isValid: false,
      text: 'Model not provided',
    };
  }

  if (!modelsConfig) {
    return {
      isValid: false,
      text: 'Models not loaded',
    };
  }

  const availableModels = modelsConfig[endpoint];
  if (!availableModels) {
    return {
      isValid: false,
      text: 'Endpoint models not loaded',
    };
  }

  if (availableModels.includes(model)) {
    return {
      isValid: true,
    };
  }

  const { ILLEGAL_MODEL_REQ_SCORE: score = 1 } = process.env ?? {};
  const type = ViolationTypes.ILLEGAL_MODEL_REQUEST;
  const errorMessage = {
    type,
    model,
    endpoint,
  };

  const { logViolation } = require('~/cache');
  await logViolation(req, res, type, errorMessage, score);

  return {
    isValid: false,
    text: 'Illegal model request',
  };
}

module.exports = {
  ALL_MODELS,
  defaultModelPermissions,
  applyDefaultModelPermissions,
  getDefaultModelPermissionsForRole,
  normalizeModelPermissionRules,
  normalizeModelPermissions,
  hasModelRestrictions,
  getAllowedModelsMap,
  filterModelsConfigForUser,
  filterModelSpecsConfig,
  isModelAllowedForConfig,
  validateModelPermissions,
  validateModelAccess,
};
