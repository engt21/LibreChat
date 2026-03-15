import type { Model } from 'mongoose';
import { defaultAdminRoles } from 'librechat-data-provider';
import type { IAdminRole } from '~/types';

export function createAdminRoleMethods(mongoose: typeof import('mongoose')) {
  async function listAdminRoles(): Promise<IAdminRole[]> {
    const AdminRole = mongoose.models.AdminRole as Model<IAdminRole>;
    return await AdminRole.find({}).sort({ name: 1 }).lean();
  }

  async function findAdminRolesByIds(adminRoleIds: string[] = []): Promise<IAdminRole[]> {
    if (!adminRoleIds.length) {
      return [];
    }

    const AdminRole = mongoose.models.AdminRole as Model<IAdminRole>;
    return await AdminRole.find({ adminRoleId: { $in: adminRoleIds } }).lean();
  }

  async function seedDefaultAdminRoles() {
    const AdminRole = mongoose.models.AdminRole as Model<IAdminRole>;

    const result: Record<string, IAdminRole> = {};
    for (const role of defaultAdminRoles) {
      const upsertedRole = await AdminRole.findOneAndUpdate(
        { adminRoleId: role.adminRoleId },
        { $set: role },
        { upsert: true, new: true },
      ).lean();

      result[role.adminRoleId] = upsertedRole;
    }

    return result;
  }

  return {
    listAdminRoles,
    findAdminRolesByIds,
    seedDefaultAdminRoles,
  };
}

export type AdminRoleMethods = ReturnType<typeof createAdminRoleMethods>;
