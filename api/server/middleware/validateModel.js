const { handleError } = require('@librechat/api');
const { getModelsConfig } = require('~/server/controllers/ModelController');
const { validateModelAccess } = require('~/server/services/ModelAccess');
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

  if (validationResult.isValid) {
    return next();
  }

  return handleError(res, { text: validationResult.text });
};

module.exports = validateModel;
