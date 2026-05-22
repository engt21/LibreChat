const { logger } = require('@librechat/data-schemas');
const { modelSteeringPrefsUpdateSchema } = require('librechat-data-provider');
const { updateUser, getUserById } = require('~/models');

async function updateModelSteeringPrefsController(req, res) {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }

    const parsed = modelSteeringPrefsUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid model steering preferences',
        details: parsed.error.flatten(),
      });
    }

    const nextPrefs = {
      enabled: req.user.modelSteeringPrefs?.enabled ?? true,
      ...parsed.data,
    };

    await updateUser(req.user.id, { modelSteeringPrefs: nextPrefs });
    const updatedUser = await getUserById(req.user.id);
    return res.status(200).json({ prefs: updatedUser?.modelSteeringPrefs ?? nextPrefs });
  } catch (error) {
    logger.error('[ModelSteeringController] updatePrefs failed:', error);
    return res.status(500).json({ error: 'Failed to update model steering preferences.' });
  }
}

module.exports = {
  updateModelSteeringPrefsController,
};
