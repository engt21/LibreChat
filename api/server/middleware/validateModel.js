const { handleError } = require('@librechat/api');
const { getModelsConfig } = require('~/server/controllers/ModelController');
const { validateModelAccess } = require('~/server/services/ModelAccess');
const { checkAndIncrementModelRequestLimit } = require('~/server/services/ModelRateLimits');
/**
 * Validates the model of the request.
 *
 * @async
 * @param {ServerRequest} req - The Express request object.
 * @param {Express.Response} res - The Express response object.
 * @param {Function} next - The Express next function.
 */
const validateModel = async (req, res, next) => {
  const { model, endpoint } = req.body;
  if (!model) {
    return handleError(res, { text: 'Model not provided' });
  }

  const modelsConfig = await getModelsConfig(req);

  const validationResult = await validateModelAccess({
    req,
    res,
    endpoint,
    model,
    modelsConfig,
  });

  if (!validationResult.isValid) {
    return handleError(res, { text: validationResult.text });
  }

  const rateLimitResult = await checkAndIncrementModelRequestLimit({
    user: req.user,
    endpoint,
    model,
  });

  if (!rateLimitResult.allowed) {
    return res.status(429).json({
      type: 'model_rate_limit',
      message: `Model ${rateLimitResult.type} limit exceeded.`,
      endpoint,
      model,
      limit: rateLimitResult.limit,
      current: rateLimitResult.current,
      window: rateLimitResult.window,
    });
  }

  return next();
};

module.exports = validateModel;
