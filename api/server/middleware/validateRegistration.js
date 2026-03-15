const { getEffectiveAppSettings } = require('~/server/services/Admin/appSettings');

async function validateRegistration(req, res, next) {
  if (req.invite) {
    return next();
  }

  const settings = await getEffectiveAppSettings();

  if (settings.registrationEnabled) {
    next();
  } else {
    return res.status(403).json({
      message: 'Registration is not allowed.',
    });
  }
}

module.exports = validateRegistration;
