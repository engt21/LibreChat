import type { Document, Types } from 'mongoose';
import { CursorPaginationParams } from '~/common';

export interface IModelPermissionRule {
  endpoint: string;
  models: string[];
}

export interface IUserModelPermissions {
  enabled?: boolean;
  rules?: IModelPermissionRule[];
}

export interface IUserImageGenerationPrefs {
  /** When true, the image-generation tool is auto-injected for new chats. */
  enabledByDefault?: boolean;
  /** Preferred provider id used when the current chat endpoint has no native image gen. */
  preferredProvider?: string | null;
  /** Map of provider id -> chosen model id. */
  models?: Record<string, string>;
}

export interface IUserModelSteeringPrefs {
  enabled?: boolean;
}

export interface IUserPushSubscription {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
  userAgent?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IUserNotifications {
  email?: {
    enabled?: boolean;
    address?: string;
  };
  sms?: {
    enabled?: boolean;
    provider?: 'twilio' | 'carrier_gateway';
    phoneNumber?: string;
    gatewayAddress?: string;
  };
  push?: {
    enabled?: boolean;
    subscriptions?: IUserPushSubscription[];
  };
}

export interface IUser extends Document {
  name?: string;
  username?: string;
  email: string;
  emailVerified: boolean;
  password?: string;
  avatar?: string;
  provider: string;
  role?: string;
  adminRoleIds?: string[];
  googleId?: string;
  facebookId?: string;
  openidId?: string;
  samlId?: string;
  ldapId?: string;
  githubId?: string;
  discordId?: string;
  appleId?: string;
  plugins?: string[];
  twoFactorEnabled?: boolean;
  totpSecret?: string;
  backupCodes?: Array<{
    codeHash: string;
    used: boolean;
    usedAt?: Date | null;
  }>;
  pendingTotpSecret?: string;
  pendingBackupCodes?: Array<{
    codeHash: string;
    used: boolean;
    usedAt?: Date | null;
  }>;
  refreshToken?: Array<{
    refreshToken: string;
  }>;
  expiresAt?: Date;
  termsAccepted?: boolean;
  personalization?: {
    memories?: boolean;
  };
  modelPermissions?: IUserModelPermissions;
  imageGenerationPrefs?: IUserImageGenerationPrefs;
  modelSteeringPrefs?: IUserModelSteeringPrefs;
  favorites?: Array<{
    agentId?: string;
    model?: string;
    endpoint?: string;
  }>;
  notifications?: IUserNotifications;
  createdAt?: Date;
  updatedAt?: Date;
  /** Field for external source identification (for consistency with TPrincipal schema) */
  idOnTheSource?: string;
}

export interface BalanceConfig {
  enabled?: boolean;
  startBalance?: number;
  autoRefillEnabled?: boolean;
  refillIntervalValue?: number;
  refillIntervalUnit?: string;
  refillAmount?: number;
}

export interface CreateUserRequest extends Partial<IUser> {
  email: string;
}

export interface UpdateUserRequest {
  name?: string;
  username?: string;
  email?: string;
  role?: string;
  adminRoleIds?: string[];
  emailVerified?: boolean;
  avatar?: string;
  plugins?: string[];
  twoFactorEnabled?: boolean;
  termsAccepted?: boolean;
  personalization?: {
    memories?: boolean;
  };
  modelPermissions?: IUserModelPermissions;
  imageGenerationPrefs?: IUserImageGenerationPrefs;
  modelSteeringPrefs?: IUserModelSteeringPrefs;
  notifications?: IUserNotifications;
}

export interface UserDeleteResult {
  deletedCount: number;
  message: string;
}

export interface UserFilterOptions extends CursorPaginationParams {
  _id?: Types.ObjectId | string;
  // Includes email, username and name
  search?: string;
  role?: string;
  emailVerified?: boolean;
  provider?: string;
  twoFactorEnabled?: boolean;
  // External IDs
  googleId?: string;
  facebookId?: string;
  openidId?: string;
  samlId?: string;
  ldapId?: string;
  githubId?: string;
  discordId?: string;
  appleId?: string;
  // Date filters
  createdAfter?: string;
  createdBefore?: string;
}

export interface UserQueryOptions {
  fieldsToSelect?: string | string[] | null;
  lean?: boolean;
}
