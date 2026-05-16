const {
  SystemRoles,
  ViolationTypes,
  EModelEndpoint,
  KnownEndpoints,
} = require('librechat-data-provider');

const ALL_MODELS = '*';

const DEFAULT_NON_ADMIN_MODEL_PERMISSIONS = Object.freeze({
  enabled: false,
  rules: [],
});

const LEGACY_DEFAULT_MODEL_PERMISSION_ENDPOINTS = Object.freeze([
  EModelEndpoint.azureOpenAI,
  KnownEndpoints.ollama,
  EModelEndpoint.openAI,
  EModelEndpoint.anthropic,
  KnownEndpoints.xai,
]);

const LEGACY_DEFAULT_WILDCARD_ENDPOINTS = new Set([
  EModelEndpoint.azureOpenAI,
  KnownEndpoints.ollama,
]);

const defaultModelPermissions = () => ({ enabled: false, rules: [] });

const allowsAllModels = (models = []) => Array.isArray(models) && models.includes(ALL_MODELS);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesModelPattern(pattern, model) {
  if (
    typeof pattern !== 'string' ||
    typeof model !== 'string' ||
    pattern.length === 0 ||
    model.length === 0
  ) {
    return false;
  }

  if (!pattern.includes('*')) {
    return pattern === model;
  }

  const regex = new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`);
  return regex.test(model);
}

function isModelAllowedBySet(allowedModels, model) {
  if (!allowedModels || !model) {
    return false;
  }

  if (allowedModels.has(ALL_MODELS) || allowedModels.has(model)) {
    return true;
  }

  return Array.from(allowedModels).some((pattern) => matchesModelPattern(pattern, model));
}

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

  const normalized = normalizeModelPermissions(user.modelPermissions);
  if (!normalized.enabled) {
    return false;
  }

  return !isLegacyDefaultModelPermissions(normalized);
}

function getAllowedModelsMap(user) {
  const { rules } = normalizeModelPermissions(user?.modelPermissions);
  return new Map(rules.map((rule) => [rule.endpoint, new Set(rule.models)]));
}

function isLegacyDefaultModelPermissions(modelPermissions = defaultModelPermissions()) {
  const normalized = normalizeModelPermissions(modelPermissions);
  if (
    !normalized.enabled ||
    normalized.rules.length !== LEGACY_DEFAULT_MODEL_PERMISSION_ENDPOINTS.length
  ) {
    return false;
  }

  const endpointMap = new Map(normalized.rules.map((rule) => [rule.endpoint, rule.models]));
  if (!LEGACY_DEFAULT_MODEL_PERMISSION_ENDPOINTS.every((endpoint) => endpointMap.has(endpoint))) {
    return false;
  }

  for (const endpoint of LEGACY_DEFAULT_WILDCARD_ENDPOINTS) {
    if (!allowsAllModels(endpointMap.get(endpoint))) {
      return false;
    }
  }

  const openAIModels = endpointMap.get(EModelEndpoint.openAI);
  const anthropicModels = endpointMap.get(EModelEndpoint.anthropic);
  const xaiModels = endpointMap.get(KnownEndpoints.xai);

  return (
    Array.isArray(openAIModels) &&
    openAIModels.length > 0 &&
    Array.isArray(anthropicModels) &&
    anthropicModels.length > 0 &&
    !allowsAllModels(anthropicModels) &&
    Array.isArray(xaiModels) &&
    xaiModels.length > 0 &&
    !allowsAllModels(xaiModels)
  );
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

    acc[endpoint] = models.filter((model) => isModelAllowedBySet(allowedModels, model));
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

    const invalidModels = rule.models.filter((model) => {
      if (model === ALL_MODELS || model.includes('*')) {
        return false;
      }

      return !availableModels.includes(model);
    });
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
