import adminRoleSchema from '~/schema/adminRole';
import type * as t from '~/types';

export function createAdminRoleModel(mongoose: typeof import('mongoose')) {
  return mongoose.models.AdminRole || mongoose.model<t.IAdminRole>('AdminRole', adminRoleSchema);
}
