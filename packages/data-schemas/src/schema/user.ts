import { Schema } from 'mongoose';
import { SystemRoles } from 'librechat-data-provider';
import { IUser } from '~/types';

// Session sub-schema
const SessionSchema = new Schema(
  {
    refreshToken: {
      type: String,
      default: '',
    },
  },
  { _id: false },
);

// Backup code sub-schema
const BackupCodeSchema = new Schema(
  {
    codeHash: { type: String, required: true },
    used: { type: Boolean, default: false },
    usedAt: { type: Date, default: null },
  },
  { _id: false },
);

const ModelPermissionRuleSchema = new Schema(
  {
    endpoint: {
      type: String,
      required: true,
    },
    models: {
      type: [String],
      default: [],
    },
  },
  { _id: false },
);

const ModelPermissionsSchema = new Schema(
  {
    enabled: {
      type: Boolean,
      default: false,
    },
    rules: {
      type: [ModelPermissionRuleSchema],
      default: [],
    },
  },
  { _id: false },
);

const PushSubscriptionKeysSchema = new Schema(
  {
    p256dh: {
      type: String,
      required: true,
    },
    auth: {
      type: String,
      required: true,
    },
  },
  { _id: false },
);

const PushSubscriptionSchema = new Schema(
  {
    endpoint: {
      type: String,
      required: true,
    },
    expirationTime: {
      type: Number,
      default: null,
    },
    keys: {
      type: PushSubscriptionKeysSchema,
      required: true,
    },
    userAgent: {
      type: String,
      default: '',
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false },
);

const NotificationsSchema = new Schema(
  {
    email: {
      type: {
        enabled: {
          type: Boolean,
          default: false,
        },
        address: {
          type: String,
          trim: true,
          lowercase: true,
          match: [/\S+@\S+\.\S+/, 'is invalid'],
        },
      },
      default: {},
    },
    sms: {
      type: {
        enabled: {
          type: Boolean,
          default: false,
        },
        provider: {
          type: String,
          enum: ['twilio', 'carrier_gateway'],
          default: 'twilio',
        },
        phoneNumber: {
          type: String,
          trim: true,
        },
        gatewayAddress: {
          type: String,
          trim: true,
          lowercase: true,
          match: [/\S+@\S+\.\S+/, 'is invalid'],
        },
      },
      default: {},
    },
    push: {
      type: {
        enabled: {
          type: Boolean,
          default: false,
        },
        subscriptions: {
          type: [PushSubscriptionSchema],
          default: [],
        },
      },
      default: {},
    },
  },
  { _id: false },
);

const userSchema = new Schema<IUser>(
  {
    name: {
      type: String,
    },
    username: {
      type: String,
      lowercase: true,
      default: '',
    },
    email: {
      type: String,
      required: [true, "can't be blank"],
      lowercase: true,
      unique: true,
      match: [/\S+@\S+\.\S+/, 'is invalid'],
      index: true,
    },
    emailVerified: {
      type: Boolean,
      required: true,
      default: false,
    },
    password: {
      type: String,
      trim: true,
      minlength: 8,
      maxlength: 128,
      select: false,
    },
    avatar: {
      type: String,
      required: false,
    },
    provider: {
      type: String,
      required: true,
      default: 'local',
    },
    role: {
      type: String,
      default: SystemRoles.USER,
    },
    adminRoleIds: {
      type: [String],
      default: [],
    },
    googleId: {
      type: String,
      unique: true,
      sparse: true,
    },
    facebookId: {
      type: String,
      unique: true,
      sparse: true,
    },
    openidId: {
      type: String,
      unique: true,
      sparse: true,
    },
    samlId: {
      type: String,
      unique: true,
      sparse: true,
    },
    ldapId: {
      type: String,
      unique: true,
      sparse: true,
    },
    githubId: {
      type: String,
      unique: true,
      sparse: true,
    },
    discordId: {
      type: String,
      unique: true,
      sparse: true,
    },
    appleId: {
      type: String,
      unique: true,
      sparse: true,
    },
    plugins: {
      type: Array,
    },
    twoFactorEnabled: {
      type: Boolean,
      default: false,
    },
    totpSecret: {
      type: String,
      select: false,
    },
    backupCodes: {
      type: [BackupCodeSchema],
      select: false,
    },
    refreshToken: {
      type: [SessionSchema],
    },
    expiresAt: {
      type: Date,
      expires: 604800, // 7 days in seconds
    },
    termsAccepted: {
      type: Boolean,
      default: false,
    },
    personalization: {
      type: {
        memories: {
          type: Boolean,
          default: true,
        },
      },
      default: {},
    },
    modelPermissions: {
      type: ModelPermissionsSchema,
      default: () => ({ enabled: false, rules: [] }),
    },
    favorites: {
      type: [
        {
          _id: false,
          agentId: String, // for agent
          model: String, // for model
          endpoint: String, // for model
        },
      ],
      default: [],
    },
    notifications: {
      type: NotificationsSchema,
      default: () => ({ email: {}, sms: {}, push: { subscriptions: [] } }),
      select: false,
    },
    /** Field for external source identification (for consistency with TPrincipal schema) */
    idOnTheSource: {
      type: String,
      sparse: true,
    },
  },
  { timestamps: true },
);

export default userSchema;
