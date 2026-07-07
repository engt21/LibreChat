#!/usr/bin/env node
/**
 * dev-seed-validation-personas.js
 *
 * Seeds deterministic validation personas into the **dev** rail MongoDB,
 * clears auth-abuse lockouts and stale sessions, optionally provisions
 * deterministic runtime config, and writes a
 * local-only manifest so automated validators can authenticate without
 * hitting rate-limit or ban walls.
 *
 * Run from the repo root with an isolated dev Mongo exposed on 27018:
 *
 *   node local-services/dev-seed-validation-personas.js
 *
 * After running, restart the dev API to flush in-memory rate limiters:
 *
 *   docker restart librechat-dev-api
 *
 * The script:
 *   1. Connects to isolated dev MongoDB at mongodb://127.0.0.1:27018/LibreChat
 *   2. Drops ban, violation, and rate-limiter Keyv entries
 *   3. Creates or resets five validation personas (see PERSONAS below)
 *   4. Clears stale refresh-token sessions for those personas
 *   5. Optionally updates an explicitly isolated .env/librechat.yaml
 *   6. Writes .dev-validation-manifest.local.json (gitignored)
 *
 * IMPORTANT: This script must NOT be used against the stable/prod rail.
 *            Shared stable DB seeding is refused unless explicitly overridden.
 *            The manifest file must NOT be committed.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { getDefaultModelPermissionsForRole } = require('../api/server/services/ModelAccess');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEV_MONGO_URI = process.env.DEV_MONGO_URI || 'mongodb://127.0.0.1:27018/LibreChat';
const ALLOW_SHARED_PROD_DB_SEED = process.env.DEV_SEED_ALLOW_SHARED_PROD_DB === 'true';
const UPDATE_RUNTIME_CONFIG = process.env.DEV_SEED_UPDATE_RUNTIME_CONFIG === 'true';
const MANIFEST_PATH = path.resolve(__dirname, '.dev-validation-manifest.local.json');
const VALIDATION_ENV_PATH = process.env.DEV_VALIDATION_ENV_PATH?.trim();
const VALIDATION_YAML_PATH = process.env.DEV_VALIDATION_YAML_PATH?.trim();
const ENV_PATH = VALIDATION_ENV_PATH ? path.resolve(VALIDATION_ENV_PATH) : null;
const LIBRECHAT_YAML_PATH = VALIDATION_YAML_PATH ? path.resolve(VALIDATION_YAML_PATH) : null;

/**
 * Deterministic modelSpecs that cover a mix of allowed and blocked models
 * for the default non-admin model permissions.
 *
 * Allowed for restricted users (present in DEFAULT_NON_ADMIN_MODEL_PERMISSIONS):
 *   - GPT-5.4 Mini   (openAI / gpt-5.4-mini)
 *   - Claude Sonnet 4.5 (anthropic / claude-sonnet-4-5)
 *   - Ollama Local    (Ollama / qwen2.5:latest — Ollama allows all models)
 *
 * Blocked for restricted users (NOT in their allowed list):
 *   - GPT-5           (openAI / gpt-5 — not in the allowed openAI models)
 *   - Gemini 2.5 Pro  (google / gemini-2.5-pro — google endpoint not in default rules)
 */
const VALIDATION_MODEL_SPECS = {
  enforce: false,
  prioritize: true,
  list: [
    {
      name: 'GPT-5.4 Mini',
      label: 'GPT-5.4 Mini',
      description: 'Fast, affordable OpenAI model',
      preset: { endpoint: 'openAI', model: 'gpt-5.4-mini' },
    },
    {
      name: 'GPT-5',
      label: 'GPT-5',
      description: 'Flagship OpenAI reasoning model',
      preset: { endpoint: 'openAI', model: 'gpt-5' },
    },
    {
      name: 'Claude Sonnet 4.5',
      label: 'Claude Sonnet 4.5',
      description: 'Anthropic balanced model',
      preset: { endpoint: 'anthropic', model: 'claude-sonnet-4-5' },
    },
    {
      name: 'Gemini 2.5 Pro',
      label: 'Gemini 2.5 Pro',
      description: 'Google flagship model',
      preset: { endpoint: 'google', model: 'gemini-2.5-pro' },
    },
    {
      name: 'Ollama Local',
      label: 'Ollama Local',
      description: 'Local Ollama model',
      preset: { endpoint: 'Ollama', model: 'qwen2.5:latest' },
    },
  ],
};

const PERSONAS = [
  {
    email: 'val-user@dev.local',
    username: 'val_user',
    name: 'Validation User',
    password: 'Val!dation_User_2025',
    role: 'USER',
    adminRoleIds: [],
  },
  {
    email: 'val-superadmin@dev.local',
    username: 'val_superadmin',
    name: 'Validation SuperAdmin',
    password: 'Val!dation_SuperAdmin_2025',
    role: 'ADMIN',
    adminRoleIds: [],
  },
  {
    email: 'val-workspace-admin@dev.local',
    username: 'val_workspace_admin',
    name: 'Validation Workspace Admin',
    password: 'Val!dation_WkspAdmin_2025',
    // Lower-tier admins are USER-role with adminRoleIds granting scoped permissions
    role: 'USER',
    adminRoleIds: ['workspace_admin'],
  },
  {
    email: 'val-support-admin@dev.local',
    username: 'val_support_admin',
    name: 'Validation Support Admin',
    password: 'Val!dation_SuppAdmin_2025',
    role: 'USER',
    adminRoleIds: ['support_admin'],
  },
  {
    email: 'val-observability-admin@dev.local',
    username: 'val_obs_admin',
    name: 'Validation Observability Admin',
    password: 'Val!dation_ObsAdmin_2025',
    role: 'USER',
    adminRoleIds: ['observability_admin'],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashPassword(plain) {
  const salt = bcrypt.genSaltSync(10);
  return bcrypt.hashSync(plain, salt);
}

/**
 * Returns the canonical default model permissions for non-admin users.
 * Imported from ModelAccess.js to stay in sync with the application code
 * rather than maintaining a separate hardcoded copy.
 */
function defaultNonAdminModelPermissions() {
  return getDefaultModelPermissionsForRole('USER');
}

function assertSafeSeedTarget(uri) {
  if (ALLOW_SHARED_PROD_DB_SEED) {
    return;
  }

  let parsed;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error(`Invalid DEV_MONGO_URI: ${uri}`);
  }

  const host = parsed.hostname.toLowerCase();
  const port = parsed.port || '27017';
  const stableHosts = new Set(['192.168.50.4', 'host.docker.internal', 'librechat-stable-mongodb']);

  if (stableHosts.has(host) || port === '27017') {
    throw new Error(
      'Refusing to seed validation personas into a shared/stable MongoDB. ' +
        'Use the existing test accounts for dev validation, or set DEV_SEED_ALLOW_SHARED_PROD_DB=true intentionally.',
    );
  }
}

function realpathIfExists(targetPath) {
  try {
    return fs.realpathSync(targetPath);
  } catch {
    return targetPath;
  }
}

function assertSafeRuntimeConfigTargets() {
  if (!UPDATE_RUNTIME_CONFIG) {
    return;
  }

  if (!ENV_PATH || !LIBRECHAT_YAML_PATH) {
    throw new Error(
      'DEV_SEED_UPDATE_RUNTIME_CONFIG=true requires explicit DEV_VALIDATION_ENV_PATH and DEV_VALIDATION_YAML_PATH targets.',
    );
  }

  const rootDir = path.resolve(__dirname, '..');
  const protectedTargets = new Set(
    [path.join(rootDir, '.env'), path.join(rootDir, 'librechat.yaml')].map(realpathIfExists),
  );
  const requestedTargets = [
    ['DEV_VALIDATION_ENV_PATH', ENV_PATH],
    ['DEV_VALIDATION_YAML_PATH', LIBRECHAT_YAML_PATH],
  ];

  for (const [name, targetPath] of requestedTargets) {
    if (protectedTargets.has(realpathIfExists(targetPath))) {
      throw new Error(
        `${name} must point to an isolated validation copy, not the shared runtime path: ${targetPath}`,
      );
    }
  }

  if (realpathIfExists(ENV_PATH) === realpathIfExists(LIBRECHAT_YAML_PATH)) {
    throw new Error(
      'DEV_VALIDATION_ENV_PATH and DEV_VALIDATION_YAML_PATH must be separate isolated files.',
    );
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  assertSafeSeedTarget(DEV_MONGO_URI);
  assertSafeRuntimeConfigTargets();
  console.log(`[dev-seed] Connecting to dev MongoDB: ${DEV_MONGO_URI}`);
  await mongoose.connect(DEV_MONGO_URI, { bufferCommands: false });
  console.log('[dev-seed] Connected.');

  const db = mongoose.connection.db;

  // ------------------------------------------------------------------
  // Step 1: Clear bans, violations, and rate-limiter state
  // ------------------------------------------------------------------
  console.log('[dev-seed] Clearing ban/violation/limiter state…');

  // LibreChat stores bans, violations, and rate-limiter state in the
  // "logs" collection (via keyvMongo backed by @keyv/mongo) and optionally
  // in the "keyv" collection for older or non-default setups.
  for (const collName of ['logs', 'keyv']) {
    let coll;
    try {
      coll = db.collection(collName);
      await coll.countDocuments({ _id: { $exists: true } }); // verify collection exists
    } catch {
      continue; // collection does not exist, skip
    }

    // Remove ban entries (BANS: and ban: namespaces)
    const banResult = await coll.deleteMany({ key: { $regex: /^(BANS:|ban:)/ } });
    if (banResult.deletedCount > 0) {
      console.log(`  Deleted ${banResult.deletedCount} ban entries from ${collName}`);
    }

    // Remove violation log entries for login and registration
    for (const ns of ['login_violation', 'logins', 'registrations', 'non_browser', 'violations']) {
      const vResult = await coll.deleteMany({ key: { $regex: new RegExp(`^${ns}:`) } });
      if (vResult.deletedCount > 0) {
        console.log(`  Deleted ${vResult.deletedCount} ${ns} entries from ${collName}`);
      }
    }

    // Clear rate limiter stores
    for (const prefix of ['login_limiter', 'register_limiter', 'resetPassword_limiter']) {
      const lResult = await coll.deleteMany({ key: { $regex: new RegExp(`^${prefix}:`) } });
      if (lResult.deletedCount > 0) {
        console.log(`  Deleted ${lResult.deletedCount} ${prefix} limiter entries from ${collName}`);
      }
    }
  }

  console.log('[dev-seed] Ban/violation/limiter state cleared.');

  // ------------------------------------------------------------------
  // Step 2: Upsert validation personas
  // ------------------------------------------------------------------
  console.log('[dev-seed] Upserting validation personas…');

  const usersCollection = db.collection('users');
  const manifestEntries = [];

  for (const persona of PERSONAS) {
    const hashedPassword = hashPassword(persona.password);
    // Superadmins (role=ADMIN) get unrestricted model access.
    // All USER-role accounts (including lower-tier admins) get the default
    // non-admin allowlist that mirrors DEFAULT_NON_ADMIN_MODEL_PERMISSIONS.
    const isSuperAdmin = persona.role === 'ADMIN';

    const modelPermissions = isSuperAdmin
      ? { enabled: false, rules: [] }
      : defaultNonAdminModelPermissions();

    const upsertDoc = {
      $set: {
        username: persona.username,
        name: persona.name,
        password: hashedPassword,
        provider: 'local',
        role: persona.role,
        adminRoleIds: persona.adminRoleIds,
        emailVerified: true,
        twoFactorEnabled: false,
        termsAccepted: true,
        modelPermissions,
        // Clear stale session/token state
        refreshToken: [],
      },
      $setOnInsert: {
        email: persona.email,
        avatar: null,
        plugins: [],
        favorites: [],
        notifications: { email: {}, sms: {}, push: { subscriptions: [] } },
        personalization: { memories: true },
        createdAt: new Date(),
      },
      $currentDate: { updatedAt: true },
    };

    const result = await usersCollection.updateOne({ email: persona.email }, upsertDoc, {
      upsert: true,
    });

    const action = result.upsertedCount > 0 ? 'created' : 'updated';
    console.log(
      `  ${action}: ${persona.email} (${persona.role}, adminRoleIds: [${persona.adminRoleIds.join(', ')}])`,
    );

    manifestEntries.push({
      email: persona.email,
      password: persona.password,
      role: persona.role,
      adminRoleIds: persona.adminRoleIds,
      username: persona.username,
      name: persona.name,
    });
  }

  // ------------------------------------------------------------------
  // Step 3: Ensure val-superadmin@dev.local is in SUPERADMIN_EMAILS
  // ------------------------------------------------------------------
  const VAL_SUPERADMIN_EMAIL = 'val-superadmin@dev.local';
  if (UPDATE_RUNTIME_CONFIG) {
    console.log(`[dev-seed] Ensuring ${VAL_SUPERADMIN_EMAIL} is in SUPERADMIN_EMAILS…`);

    try {
      const envContent = fs.readFileSync(ENV_PATH, 'utf8');
      const superadminLine = envContent.match(/^SUPERADMIN_EMAILS=(.*)$/m);

      if (superadminLine) {
        const currentEmails = superadminLine[1]
          .split(/[\s,]+/)
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean);

        if (!currentEmails.includes(VAL_SUPERADMIN_EMAIL.toLowerCase())) {
          const newValue = superadminLine[1]
            ? `${superadminLine[1].trim()},${VAL_SUPERADMIN_EMAIL}`
            : VAL_SUPERADMIN_EMAIL;
          const updatedContent = envContent.replace(
            /^SUPERADMIN_EMAILS=(.*)$/m,
            `SUPERADMIN_EMAILS=${newValue}`,
          );
          fs.writeFileSync(ENV_PATH, updatedContent);
          console.log(`  Added ${VAL_SUPERADMIN_EMAIL} to SUPERADMIN_EMAILS in ${ENV_PATH}`);
          console.log('  IMPORTANT: Restart the dev API to pick up the updated environment.');
        } else {
          console.log(`  ${VAL_SUPERADMIN_EMAIL} is already in SUPERADMIN_EMAILS`);
        }
      } else {
        fs.appendFileSync(ENV_PATH, `\nSUPERADMIN_EMAILS=${VAL_SUPERADMIN_EMAIL}\n`);
        console.log(`  Added SUPERADMIN_EMAILS=${VAL_SUPERADMIN_EMAIL} to ${ENV_PATH}`);
        console.log('  IMPORTANT: Restart the dev API to pick up the updated environment.');
      }
    } catch (envErr) {
      console.warn(`  Warning: Could not update ${ENV_PATH}: ${envErr.message}`);
      console.log(`  Manually ensure ${VAL_SUPERADMIN_EMAIL} is in SUPERADMIN_EMAILS.`);
    }
  } else {
    console.log(
      '[dev-seed] Skipping runtime .env mutation. Set DEV_SEED_UPDATE_RUNTIME_CONFIG=true with an isolated DEV_VALIDATION_ENV_PATH to opt in.',
    );
  }

  // ------------------------------------------------------------------
  // Step 4: Clear any remaining stale sessions for validation personas
  // ------------------------------------------------------------------
  console.log('[dev-seed] Clearing stale sessions for validation personas…');
  const sessionsCollection = db.collection('sessions');
  const personaEmails = PERSONAS.map((p) => p.email);
  const personaUsers = await usersCollection
    .find({ email: { $in: personaEmails } }, { projection: { _id: 1, email: 1 } })
    .toArray();

  for (const pu of personaUsers) {
    const sResult = await sessionsCollection.deleteMany({ userId: pu._id });
    if (sResult.deletedCount > 0) {
      console.log(`  Cleared ${sResult.deletedCount} stale session(s) for ${pu.email}`);
    }
  }

  // ------------------------------------------------------------------
  // Step 5: Ensure deterministic modelSpecs in librechat.yaml
  // ------------------------------------------------------------------
  if (UPDATE_RUNTIME_CONFIG) {
    console.log(`[dev-seed] Ensuring deterministic modelSpecs in ${LIBRECHAT_YAML_PATH}…`);
    try {
      if (fs.existsSync(LIBRECHAT_YAML_PATH)) {
        const yamlContent = fs.readFileSync(LIBRECHAT_YAML_PATH, 'utf8');
        const config = yaml.load(yamlContent) || {};

        const existingSpecs = config.modelSpecs;
        if (
          existingSpecs &&
          existingSpecs.list &&
          Array.isArray(existingSpecs.list) &&
          existingSpecs.list.length > 0
        ) {
          console.log(
            `  modelSpecs already present (${existingSpecs.list.length} specs). Skipping.`,
          );
        } else {
          config.modelSpecs = VALIDATION_MODEL_SPECS;
          const updatedYaml = yaml.dump(config, {
            lineWidth: -1,
            noRefs: true,
            quotingType: "'",
            forceQuotes: false,
          });
          fs.writeFileSync(LIBRECHAT_YAML_PATH, updatedYaml);
          console.log(
            `  Added ${VALIDATION_MODEL_SPECS.list.length} deterministic modelSpecs to ${LIBRECHAT_YAML_PATH}`,
          );
          console.log('  IMPORTANT: Restart the dev API to pick up the updated config.');
        }
      } else {
        console.warn(
          `  Warning: ${LIBRECHAT_YAML_PATH} not found. Skipping modelSpecs provisioning.`,
        );
        console.log('  Create an isolated librechat.yaml or set DEV_VALIDATION_YAML_PATH.');
      }
    } catch (yamlErr) {
      console.warn(`  Warning: Could not update ${LIBRECHAT_YAML_PATH}: ${yamlErr.message}`);
      console.log('  Add modelSpecs manually if needed for validation.');
    }
  } else {
    console.log(
      '[dev-seed] Skipping runtime librechat.yaml mutation. Set DEV_SEED_UPDATE_RUNTIME_CONFIG=true with an isolated DEV_VALIDATION_YAML_PATH to opt in.',
    );
  }

  // ------------------------------------------------------------------
  // Step 6: Write local manifest
  // ------------------------------------------------------------------
  const manifest = {
    _comment: 'DEV VALIDATION ONLY — DO NOT COMMIT. Generated by dev-seed-validation-personas.js',
    _generated: new Date().toISOString(),
    devRailUrl: 'http://127.0.0.1:3081',
    runtimeConfigUpdated: UPDATE_RUNTIME_CONFIG,
    personas: manifestEntries,
  };

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`[dev-seed] Wrote validation manifest to ${MANIFEST_PATH}`);
  console.log('[dev-seed] Done. Dev validation personas are ready.');
  console.log('');
  console.log('[dev-seed] IMPORTANT: If the dev API was running during this seed,');
  console.log('  restart it to clear in-memory rate-limiter and ban caches:');
  console.log('    docker restart librechat-dev-api');
  console.log('  Wait ~20 seconds for the API to become healthy again.');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('[dev-seed] Fatal error:', err);
  process.exit(1);
});
