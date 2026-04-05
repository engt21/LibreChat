jest.mock('~/server/services/Admin/appSettings', () => ({
  getEffectiveAppSettings: jest.fn(),
}));

const { getEffectiveAppSettings } = require('~/server/services/Admin/appSettings');
const validateRegistration = require('../validateRegistration');

describe('validateRegistration middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = {};
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
    jest.clearAllMocks();
  });

  it('bypasses the registration check when req.invite is truthy', async () => {
    req.invite = { token: 'valid-invite-token' };

    await validateRegistration(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(getEffectiveAppSettings).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('allows registration when registrationEnabled is true', async () => {
    getEffectiveAppSettings.mockResolvedValue({ registrationEnabled: true });

    await validateRegistration(req, res, next);

    expect(getEffectiveAppSettings).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 403 when registration is disabled and no invite is present', async () => {
    getEffectiveAppSettings.mockResolvedValue({ registrationEnabled: false });

    await validateRegistration(req, res, next);

    expect(getEffectiveAppSettings).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: 'Registration is not allowed.' });
    expect(next).not.toHaveBeenCalled();
  });

  it('allows invite-based signup even when registration is disabled', async () => {
    req.invite = { token: 'invite-token-123' };
    getEffectiveAppSettings.mockResolvedValue({ registrationEnabled: false });

    await validateRegistration(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(getEffectiveAppSettings).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
