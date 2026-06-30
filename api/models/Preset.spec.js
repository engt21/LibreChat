const mockLean = jest.fn();
const mockPresetModel = {
  find: jest.fn(() => ({ lean: mockLean })),
  bulkWrite: jest.fn(),
  findOne: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  findOneAndUpdate: jest.fn(),
};

jest.mock('~/db/models', () => ({
  Preset: mockPresetModel,
}));

const { getPresets, reorderPresets, savePreset } = require('./Preset');

describe('Preset model operations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLean.mockResolvedValue([]);
    mockPresetModel.bulkWrite.mockResolvedValue({});
    mockPresetModel.findOne.mockResolvedValue(null);
    mockPresetModel.findByIdAndUpdate.mockResolvedValue({});
    mockPresetModel.findOneAndUpdate.mockResolvedValue({});
  });

  it('sorts presets by user order before recency', async () => {
    const oldUnordered = {
      presetId: 'old-unordered',
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const newestUnordered = {
      presetId: 'newest-unordered',
      updatedAt: new Date('2026-03-01T00:00:00.000Z'),
    };
    const orderedSecond = {
      presetId: 'ordered-second',
      order: 2,
      updatedAt: new Date('2026-02-01T00:00:00.000Z'),
    };
    const orderedFirst = {
      presetId: 'ordered-first',
      order: 1,
      updatedAt: new Date('2025-12-01T00:00:00.000Z'),
    };

    mockLean.mockResolvedValue([oldUnordered, newestUnordered, orderedSecond, orderedFirst]);

    const presets = await getPresets('user-1');

    expect(presets.map((preset) => preset.presetId)).toEqual([
      'ordered-first',
      'ordered-second',
      'newest-unordered',
      'old-unordered',
    ]);
  });

  it('persists valid preset order updates for the requesting user', async () => {
    await reorderPresets('user-1', [
      { presetId: 'preset-b', order: 1 },
      { presetId: 'preset-a', order: 2 },
      { presetId: '', order: 3 },
      null,
    ]);

    expect(mockPresetModel.bulkWrite).toHaveBeenCalledWith(
      [
        {
          updateOne: {
            filter: { user: 'user-1', presetId: 'preset-b' },
            update: { $set: { order: 1 } },
          },
        },
        {
          updateOne: {
            filter: { user: 'user-1', presetId: 'preset-a' },
            update: { $set: { order: 2 } },
          },
        },
      ],
      { ordered: true },
    );
  });

  it('does not change preset order when saving a default preset', async () => {
    mockPresetModel.findOne.mockResolvedValue({ _id: 'current-default-id', presetId: 'old' });

    await savePreset('user-1', {
      presetId: 'new',
      defaultPreset: true,
      title: 'New Default',
    });

    expect(mockPresetModel.findByIdAndUpdate).toHaveBeenCalledWith('current-default-id', {
      $unset: { defaultPreset: '' },
    });
    expect(mockPresetModel.findOneAndUpdate).toHaveBeenCalledWith(
      { presetId: 'new', user: 'user-1' },
      {
        $set: {
          presetId: 'new',
          title: 'New Default',
          defaultPreset: true,
        },
      },
      { new: true, upsert: true },
    );
  });
});
