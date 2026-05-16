/**
 * REGRESSION GUARDS for role permissions.
 *
 * These tests exist because in 2026-04-26 a new permission type (`IMAGE_GEN`) was added
 * to `librechat-data-provider`'s `PermissionTypes`, `roleDefaults`, and the Zod
 * `permissionsSchema` -- but it was NOT added to the Mongoose `rolePermissionsSchema` in
 * this file. Mongoose strict-mode silently stripped the field on save, so even though
 * `initializeRoles()` was assigning `role.permissions.IMAGE_GEN = {USE: true}`, the field
 * never persisted. Result: `useHasAccess(IMAGE_GEN, USE)` returned false for everyone in
 * the UI, hiding the entire Settings -> Image generation tab.
 *
 * Do NOT loosen these tests. If a new permission type is added, also add it here AND in
 * `rolePermissionsSchema` AND in `IRole.permissions` in `~/types/role.ts`.
 */

import mongoose from 'mongoose';
import { PermissionTypes, Permissions, roleDefaults, SystemRoles } from 'librechat-data-provider';
import roleSchema from './role';
import { createRoleMethods } from '../methods/role';

describe('role schema -- permission-type coverage guard', () => {
  it('declares every PermissionTypes value as a path on rolePermissionsSchema', () => {
    /**
     * `permissions` itself is a sub-schema; pull its declared paths via the embedded
     * `tree` (the public, stable Mongoose API for inspecting a Schema).
     */
    const permissionsField = (
      roleSchema.path('permissions') as unknown as {
        schema?: mongoose.Schema;
      }
    ).schema;

    expect(permissionsField).toBeDefined();

    const declared = new Set(Object.keys(permissionsField!.tree));
    const required = Object.values(PermissionTypes);

    const missing = required.filter((permType) => !declared.has(permType));

    expect(missing).toEqual([]);
  });

  it('declares the schema-level USE field for every permission type that grants USE in roleDefaults.ADMIN', () => {
    const adminPerms = roleDefaults[SystemRoles.ADMIN].permissions as Record<
      string,
      Record<string, unknown>
    >;
    const permissionsField = (
      roleSchema.path('permissions') as unknown as {
        schema?: mongoose.Schema;
      }
    ).schema!;
    const tree = permissionsField.tree as Record<string, Record<string, unknown>>;

    for (const [permType, grants] of Object.entries(adminPerms)) {
      if (Object.prototype.hasOwnProperty.call(grants, Permissions.USE)) {
        expect(tree[permType]).toBeDefined();
        // every permission that admin gets USE for must be declared on the schema
        // -- otherwise Mongoose strict-mode will strip it on save
        expect(Object.keys(tree[permType])).toContain(Permissions.USE);
      }
    }
  });
});

describe('initializeRoles -- end-to-end persistence guard', () => {
  let mongoServer: import('mongodb-memory-server').MongoMemoryServer | null = null;
  let started = false;

  beforeAll(async () => {
    /**
     * Use mongodb-memory-server (already a dev dep in this package) to validate that
     * `initializeRoles()` actually round-trips every roleDefaults permission through
     * Mongoose. If the schema strips a field, this test fails on the field's row in
     * `expect(admin.permissions[permType][permKey]).toBe(true)`.
     */
    try {
      const { MongoMemoryServer } = await import('mongodb-memory-server');
      mongoServer = await MongoMemoryServer.create();
      await mongoose.connect(mongoServer.getUri(), {
        dbName: `test_role_guard_${Date.now()}`,
      });
      started = true;
    } catch (err) {
      // some CI environments (Alpine) can't run mongodb-memory-server -- the schema
      // declared-paths check above is still the primary defence

      console.warn('[skip] mongodb-memory-server unavailable:', (err as Error).message);
    }
  });

  afterAll(async () => {
    if (started) {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  it('persists every PermissionTypes.<KEY> that ADMIN gets in roleDefaults', async () => {
    if (!started) {
      return;
    }
    const Role = mongoose.models.Role || mongoose.model('Role', roleSchema, 'roles_guard_test');
    const methods = createRoleMethods(mongoose);

    await Role.deleteMany({});
    await methods.initializeRoles();

    const admin = await Role.findOne({ name: SystemRoles.ADMIN }).lean<{
      permissions: Record<string, Record<string, unknown>>;
    }>();
    expect(admin).toBeTruthy();

    const adminDefaults = roleDefaults[SystemRoles.ADMIN].permissions as Record<
      string,
      Record<string, unknown>
    >;

    for (const [permType, grants] of Object.entries(adminDefaults)) {
      for (const [permKey, value] of Object.entries(grants)) {
        if (value === true) {
          /**
           * Strict-mode stripping shows up exactly here: if the schema doesn't declare
           * the path, the saved doc has `permissions.<permType>` undefined, the test
           * fails, and the developer who added the permission type knows to also
           * declare it in `rolePermissionsSchema`.
           */
          expect(admin!.permissions[permType]).toBeDefined();
          expect(admin!.permissions[permType][permKey]).toBe(true);
        }
      }
    }
  });
});
