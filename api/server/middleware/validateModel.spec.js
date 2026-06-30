const mockHandleError = jest.fn();
const mockGetModelsConfig = jest.fn();
const mockValidateModelAccess = jest.fn();
const mockCheckAndIncrementModelRequestLimit = jest.fn();

jest.mock('@librechat/api', () => ({
  handleError: (...args) => mockHandleError(...args),
}), { virtual: true });

jest.mock('~/server/controllers/ModelController', () => ({
  getModelsConfig: (...args) => mockGetModelsConfig(...args),
}));

jest.mock('~/server/services/ModelAccess', () => ({
  validateModelAccess: (...args) => mockValidateModelAccess(...args),
}));

jest.mock('~/server/services/ModelRateLimits', () => ({
  checkAndIncrementModelRequestLimit: (...args) =>
    mockCheckAndIncrementModelRequestLimit(...args),
}));

const validateModel = require('./validateModel');

function createRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('validateModel middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetModelsConfig.mockResolvedValue({});
    mockValidateModelAccess.mockResolvedValue({ isValid: true });
    mockCheckAndIncrementModelRequestLimit.mockResolvedValue({ allowed: true });
  });

  it('checks per-user per-model request limits after model access passes', async () => {
    const req = {
      body: { endpoint: 'openAI', model: 'gpt-5.4-mini' },
      user: { id: 'user-1' },
    };
    const res = createRes();
    const next = jest.fn();

    await validateModel(req, res, next);

    expect(mockCheckAndIncrementModelRequestLimit).toHaveBeenCalledWith({
      user: req.user,
      endpoint: 'openAI',
      model: 'gpt-5.4-mini',
    });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('returns 429 when a per-model request limit is exceeded', async () => {
    const req = {
      body: { endpoint: 'openAI', model: 'gpt-5.4-mini' },
      user: { id: 'user-1' },
    };
    const res = createRes();
    const next = jest.fn();
    mockCheckAndIncrementModelRequestLimit.mockResolvedValue({
      allowed: false,
      type: 'requests',
      limit: 1,
      current: 1,
      window: '24h',
    });

    await validateModel(req, res, next);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'model_rate_limit',
        endpoint: 'openAI',
        model: 'gpt-5.4-mini',
        limit: 1,
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });
});
