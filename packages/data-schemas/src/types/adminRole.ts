import type { Document, Types } from 'mongoose';
import type { TAdminPermission } from 'librechat-data-provider';

export type AdminRole = {
  adminRoleId: string;
  name: string;
  description?: string;
  permissions: TAdminPermission[];
  isSystem?: boolean;
};

export type IAdminRole = AdminRole &
  Document & {
    _id: Types.ObjectId;
  };
