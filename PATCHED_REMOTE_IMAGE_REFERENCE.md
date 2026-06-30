# Patched-Remote Image Reference

## Purpose

This file defines the optional patched-remote Docker workflow for validating the admin RBAC feature while staying as close as possible to upstream LibreChat.

It is no longer the default local startup path. The default runtime now uses the full local build from `Dockerfile` through `docker-compose.local.override.yml` so agent restarts include the latest local LibreChat changes.

The goal is:

1. start from the published upstream LibreChat image
2. overlay only the admin-related runtime changes from this task
3. avoid shipping unrelated local experiments

## Image modes

### Stock upstream image

Uses the published upstream container directly.

- Compose source: `docker-compose.yml`
- Image: `registry.librechat.ai/danny-avila/librechat-dev:latest`

### Patched-remote image

Starts from the published upstream image and overlays only the admin RBAC runtime files listed below.

- Dockerfile: `Dockerfile.remote-patched`
- Compose override: `docker-compose.remote-patched.override.yml`
- Image: `librechat-remote-patched:latest`

## Recommended command

Use this flow only when you explicitly want the narrow admin-only patched image instead of the default full local build.

```bash
cd /pool/home/timeng/LibreChat-custom
docker compose -f docker-compose.yml -f docker-compose.local.override.yml -f docker-compose.remote-patched.override.yml up -d --build --force-recreate api
```

To start the full local stack around the patched app image:

```bash
cd /pool/home/timeng/LibreChat-custom
docker compose -f docker-compose.yml -f docker-compose.local.override.yml -f docker-compose.remote-patched.override.yml up -d --build --force-recreate
docker compose -f "/pool/home/timeng/librechat_exporter/prometheus-dev/docker-compose.yml" up -d
LIBRECHAT_LOG_DIR=/pool/home/timeng/LibreChat-custom/logs docker compose -f "/pool/home/timeng/librechat_exporter/grafana-loki-dev/docker-compose.yml" up -d
```

All of these are detached Docker services, so they continue running after the shell closes.

For the customization worktree, Grafana/Loki should tail `/pool/home/timeng/LibreChat-custom/logs` so the dashboard reflects the current patched-runtime logs.

When the admin console is opened from a non-localhost host/IP, its observability links should resolve against that same host instead of `localhost`.

## Required LiteLLM bind-mounted files

The local override bind-mounts these exact files into the `litellm` container:

- `litellm/config.yaml`
- `litellm/custom_callbacks.py`

They must be regular files. If either path becomes a directory, `litellm` fails with `IsADirectoryError` when it tries to read `/app/config.yaml` or `/app/custom_callbacks.py`.

## Verify the running image

```bash
docker inspect LibreChat --format '{{.Config.Image}}'
docker inspect LibreChat --format '{{.Image}}'
docker inspect librechat-remote-patched:latest --format '{{.Id}}'
```

The last two hashes should match.

## Current patched-remote runtime scope

The patched image should include only the admin feature runtime changes.

### Backend runtime files

- `api/models/index.js`
- `api/server/controllers/AdminController.js`
- `api/server/controllers/auth/LoginController.js`
- `api/server/controllers/auth/oauth.js`
- `api/server/middleware/adminAccess.js`
- `api/server/middleware/validateRegistration.js`
- `api/server/routes/config.js`
- `api/server/routes/index.js`
- `api/server/routes/admin/index.js`
- `api/server/services/Admin/**`
- `api/strategies/openidStrategy.js`

### Frontend runtime files

- `client/src/components/Admin/**`
- `client/src/components/Nav/AccountSettings.tsx`
- `client/src/data-provider/Admin/**`
- `client/src/data-provider/index.ts`
- `client/src/locales/en/translation.json`
- `client/src/routes/index.tsx`

### Shared package runtime files

- `packages/data-provider/src/admin.ts`
- `packages/data-provider/src/api-endpoints.ts`
- `packages/data-provider/src/data-service.ts`
- `packages/data-provider/src/index.ts`
- `packages/data-provider/src/keys.ts`
- `packages/data-provider/src/types.ts`
- `packages/data-schemas/src/methods/adminRole.ts`
- `packages/data-schemas/src/methods/appSettings.ts`
- `packages/data-schemas/src/methods/index.ts`
- `packages/data-schemas/src/models/adminRole.ts`
- `packages/data-schemas/src/models/appSettings.ts`
- `packages/data-schemas/src/models/index.ts`
- `packages/data-schemas/src/schema/adminRole.ts`
- `packages/data-schemas/src/schema/appSettings.ts`
- `packages/data-schemas/src/schema/index.ts`
- `packages/data-schemas/src/schema/user.ts`
- `packages/data-schemas/src/types/adminRole.ts`
- `packages/data-schemas/src/types/appSettings.ts`
- `packages/data-schemas/src/types/index.ts`
- `packages/data-schemas/src/types/user.ts`

## What this image should not include

The patched image should not carry unrelated local changes for:

- model auto-discovery
- provider logging or Langfuse plumbing
- reasoning or structured-response UI changes
- Mongo keepalive work
- web-search or tool-auth experiments
- random local repo state outside the admin feature

If a runtime file is not required for admin RBAC, do not add it to `Dockerfile.remote-patched`.

## Rebuild vs restart

### Rebuild required

Rebuild the patched image if you change:

- any file copied by `Dockerfile.remote-patched`
- any admin UI source that affects `client/dist`
- any shared package source that affects `packages/data-provider/dist` or `packages/data-schemas/dist`

For the normal local/VM runtime, do not use the patched-remote image path for small code iteration. Prefer `local-services/deploy-runtime-delta.sh` for accepted backend/config/package-dist changes, and prefer `local-services/deploy-built-client-dist.sh` for complete frontend dist deployments.

### Runtime delta usually enough

A rebuild is usually not required when `local-services/deploy-runtime-delta.sh --dry-run` accepts the changed paths, including:

- `.env`
- backend/runtime-loaded `api/**/*.js`
- runtime config helpers such as `config/apply-runtime-patches.js`
- already-built `packages/*/dist/**`
- bind-mounted uploads/images/logs
- sidecar service configuration outside the `api` image

## MongoDB persistence

MongoDB data persists through the bind mount in `docker-compose.yml`:

- `./data-node:/data/db`

Rebuilding the patched image does not remove that persisted database by itself.
