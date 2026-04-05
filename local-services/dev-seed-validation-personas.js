#!/usr/bin/env node
/**
 * dev-seed-validation-personas.js
 *
 * Seeds deterministic validation personas into the **dev** rail MongoDB,
 * clears auth-abuse lockouts and stale sessions, and writes a local-only
 * manifest so automated validators can authenticate without hitting
 * rate-limit or ban walls.
 *
 * Run from the repo root with the dev Mongo exposed on 27018:
 *
 *   node local-services/dev-seed-validation-personas.js
 *
 * After running, restart the dev API to flush in-memory rate limiters:
 *
 *   docker restart librechat-dev-api
 *
 * The script:
 *   1. Connects to dev MongoDB at mongodb://127.0.0.1:27018/LibreChat
 *   2. Drops ban, violation, and rate-limiter Keyv entries
 *   3. Creates or resets five validation personas (see PERSONAS below)
 *   4. Clears stale refresh-token sessions for those personas
 *   5. Writes .dev-validation-manifest.local.json (gitignored)
 *
 * IMPORTANT: This script must NOT be used against the stable/prod rail.
 *            The manifest file must NOT be committed.
 */

const path = require('path');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEV_MONGO_URI = process.env.DEV_MONGO_URI || 'mongodb://127.0.0.1:27018/LibreChat';
const MANIFEST_PATH = path.resolve(__dirname, '.dev-validation-manifest.local.json');

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
 * Default model permissions for non-admin validation personas.
 * Mirrors DEFAULT_NON_ADMIN_MODEL_PERMISSIONS in ModelAccess.js.
 */
function defaultNonAdminModelPermissions() {
  return {
    enabled: true,
    rules: [
      { endpoint: 'openAI', models: ['gpt-5.1'] },
      { endpoint: 'google', models: ['gemini-3-flash-preview', 'gemini-2.5-flash-lite'] },
      { endpoint: 'ollama', models: ['*'] },
    ],
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
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
  // Step 3: Add superadmin validation email to SUPERADMIN_EMAILS note
  // ------------------------------------------------------------------
  console.log('[dev-seed] Note: val-superadmin@dev.local should be in SUPERADMIN_EMAILS');
  console.log('  for full superadmin sync behavior (auto-promotion on login).');
  console.log('  The user is already set to role=ADMIN by this seed.');

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
  // Step 5: Write local manifest
  // ------------------------------------------------------------------
  const fs = require('fs');
  const manifest = {
    _comment: 'DEV VALIDATION ONLY — DO NOT COMMIT. Generated by dev-seed-validation-personas.js',
    _generated: new Date().toISOString(),
    devRailUrl: 'http://127.0.0.1:3081',
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
