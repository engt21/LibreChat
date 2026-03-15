import appSettingsSchema from '~/schema/appSettings';
import type * as t from '~/types';

export function createAppSettingsModel(mongoose: typeof import('mongoose')) {
  return (
    mongoose.models.AppSettings || mongoose.model<t.IAppSettings>('AppSettings', appSettingsSchema)
  );
}
