import type { Model } from 'mongoose';
import type { IAppSettings } from '~/types';

const DEFAULT_SETTINGS_ID = 'global';

export function createAppSettingsMethods(mongoose: typeof import('mongoose')) {
  async function getAppSettings(
    settingsId: string = DEFAULT_SETTINGS_ID,
  ): Promise<IAppSettings | null> {
    const AppSettings = mongoose.models.AppSettings as Model<IAppSettings>;
    return await AppSettings.findOne({ settingsId }).lean();
  }

  async function upsertAppSettings(
    updateData: Partial<IAppSettings>,
    settingsId: string = DEFAULT_SETTINGS_ID,
  ): Promise<IAppSettings | null> {
    const AppSettings = mongoose.models.AppSettings as Model<IAppSettings>;
    return await AppSettings.findOneAndUpdate(
      { settingsId },
      { $set: updateData, $setOnInsert: { settingsId } },
      { upsert: true, new: true },
    ).lean();
  }

  return {
    getAppSettings,
    upsertAppSettings,
  };
}

export type AppSettingsMethods = ReturnType<typeof createAppSettingsMethods>;
