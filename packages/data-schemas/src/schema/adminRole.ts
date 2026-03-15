import { Schema } from 'mongoose';
import { AdminPermissions } from 'librechat-data-provider';
import type { IAdminRole } from '~/types';

const adminRoleSchema = new Schema<IAdminRole>(
  {
    adminRoleId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
    },
    description: {
      type: String,
    },
    permissions: {
      type: [String],
      enum: Object.values(AdminPermissions),
      default: [],
    },
    isSystem: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

export default adminRoleSchema;
