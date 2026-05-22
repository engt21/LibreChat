const mockUpdateUser = jest.fn();
const mockGetUserById = jest.fn();

jest.mock('~/models', () => ({
  updateUser: (...args) => mockUpdateUser(...args),
  getUserById: (...args) => mockGetUserById(...args),
}));

const { updateModelSteeringPrefsController } = require('../ModelSteeringController');

function createRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

describe('ModelSteeringController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects unauthenticated updates', async () => {
    const res = createRes();

    await updateModelSteeringPrefsController({ user: null, body: { enabled: true } }, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('rejects invalid preference payloads', async () => {
    const res = createRes();

    await updateModelSteeringPrefsController(
      { user: { id: 'user-1' }, body: { enabled: true, unknown: true } },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('persists and returns model steering prefs', async () => {
    const res = createRes();
    mockUpdateUser.mockResolvedValue({ modelSteeringPrefs: { enabled: false } });
    mockGetUserById.mockResolvedValue({ modelSteeringPrefs: { enabled: false } });

    await updateModelSteeringPrefsController(
      {
        user: { id: 'user-1', modelSteeringPrefs: { enabled: true } },
        body: { enabled: false },
      },
      res,
    );

    expect(mockUpdateUser).toHaveBeenCalledWith('user-1', {
      modelSteeringPrefs: { enabled: false },
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ prefs: { enabled: false } });
  });
});
