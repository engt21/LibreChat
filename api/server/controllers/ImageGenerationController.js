const { logger } = require('@librechat/data-schemas');
const { discoverImageModels, checkAccess } = require('@librechat/api');
const {
  PermissionTypes,
  Permissions,
  ImageGenProvider,
  imageGenerationPrefsUpdateSchema,
} = require('librechat-data-provider');
const { loadAuthValues } = require('~/server/services/Tools/credentials');
const { getAppConfig } = require('~/server/services/Config/app');
const { getRoleByName } = require('~/models/Role');
const { updateUser, getUserById, getUserKeyValues } = require('~/models');

const azureOpenAIKnownImageModels = [
  { id: 'gpt-image-2', displayName: 'GPT Image 2' },
  { id: 'gpt-image-1', displayName: 'GPT Image 1' },
];

async function ensureImageGenUsePermission(user) {
  if (!user?.id) {
    return false;
  }
  try {
    const allowed = await checkAccess({
      user,
      permissionType: PermissionTypes.IMAGE_GEN,
      permissions: [Permissions.USE],
      getRoleByName,
    });
    if (allowed) {
      return true;
    }
    const role = user.role ? await getRoleByName(user.role) : null;
    if (
      role?.permissions &&
      !Object.prototype.hasOwnProperty.call(role.permissions, PermissionTypes.IMAGE_GEN)
    ) {
      return true;
    }
    return false;
  } catch (err) {
    logger.debug('[ImageGenerationController] permission check failed', err);
    return false;
  }
}

async function getImageModelsController(req, res) {
  try {
    const allowed = await ensureImageGenUsePermission(req.user);
    if (!allowed) {
      return res.status(403).json({ error: 'Image generation is not permitted for this account.' });
    }

    const appConfig = await getAppConfig({ role: req.user?.role }).catch(() => undefined);
    const response = await discoverImageModels({
      user: req.user,
      appConfig,
      loadCredential: ({ userId, authFields }) =>
        loadAuthValues({ userId, authFields, throwError: false }),
      loadEndpointKeyValues: async ({ userId, name }) => {
        try {
          return await getUserKeyValues({ userId, name });
        } catch {
          return undefined;
        }
      },
    });
    try {
      const azureValues = await getUserKeyValues({
        userId: req.user.id,
        name: 'azureOpenAI',
      });
      if (azureValues?.apiKey && azureValues?.baseURL) {
        const azureProvider = response.providers.find(
          (provider) => provider.id === ImageGenProvider.azureOpenAI,
        );
        if (azureProvider) {
          const existingIds = new Set(azureProvider.models.map((model) => model.id));
          const knownModels = azureOpenAIKnownImageModels.map((model) => ({
            id: model.id,
            displayName: model.displayName,
            releasedAt: model.releasedAt,
            default: model.id === 'gpt-image-2',
          }));
          azureProvider.configured = true;
          azureProvider.credentialSource = 'user';
          azureProvider.models = [
            ...knownModels.filter((model) => !existingIds.has(model.id)),
            ...azureProvider.models.map((model) => ({
              ...model,
              default: model.id === 'gpt-image-2',
            })),
          ];
          if (!azureProvider.models.some((model) => model.default)) {
            azureProvider.models[0].default = true;
          }
        }
      }
    } catch {
      // Azure image models are an optional enhancement; keep the base discovery response.
    }

    return res.status(200).json(response);
  } catch (error) {
    logger.error('[ImageGenerationController] getImageModels failed:', error);
    return res.status(500).json({ error: 'Failed to load image models.' });
  }
}

async function getImageGenerationPrefsController(req, res) {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }
    const allowed = await ensureImageGenUsePermission(req.user);
    if (!allowed) {
      return res.status(403).json({ error: 'Image generation is not permitted for this account.' });
    }

    const prefs = req.user.imageGenerationPrefs ?? {
      enabledByDefault: false,
      preferredProvider: undefined,
      models: {},
    };
    return res.status(200).json({ prefs });
  } catch (error) {
    logger.error('[ImageGenerationController] getPrefs failed:', error);
    return res.status(500).json({ error: 'Failed to load image generation preferences.' });
  }
}

async function updateImageGenerationPrefsController(req, res) {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }
    const allowed = await ensureImageGenUsePermission(req.user);
    if (!allowed) {
      return res.status(403).json({ error: 'Image generation is not permitted for this account.' });
    }

    const parsed = imageGenerationPrefsUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: 'Invalid image generation preferences', details: parsed.error.flatten() });
    }

    const nextPrefs = {
      ...(req.user.imageGenerationPrefs ?? {}),
      ...parsed.data,
    };

    if (parsed.data.models !== undefined) {
      nextPrefs.models = {
        ...(req.user.imageGenerationPrefs?.models ?? {}),
        ...parsed.data.models,
      };
    }

    await updateUser(req.user.id, { imageGenerationPrefs: nextPrefs });
    const updatedUser = await getUserById(req.user.id);
    return res.status(200).json({ prefs: updatedUser?.imageGenerationPrefs ?? nextPrefs });
  } catch (error) {
    logger.error('[ImageGenerationController] updatePrefs failed:', error);
    return res.status(500).json({ error: 'Failed to update image generation preferences.' });
  }
}

module.exports = {
  getImageModelsController,
  getImageGenerationPrefsController,
  updateImageGenerationPrefsController,
};
