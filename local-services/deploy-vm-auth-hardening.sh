#!/usr/bin/env bash
set -euo pipefail

VM_HOST="${LIBRECHAT_VM_HOST:-timeng@192.168.50.104}"
VM_ROOT="${LIBRECHAT_VM_ROOT:-/opt/LibreChat-custom}"
TAILSCALE_HOSTNAME="${LIBRECHAT_TAILSCALE_HOSTNAME:-librechatvm.tail6e13ff.ts.net}"
TAILSCALE_HTTPS_PORT="${LIBRECHAT_TAILSCALE_HTTPS_PORT:-8443}"
TAILSCALE_IP="${LIBRECHAT_TAILSCALE_IP:-100.95.190.45}"

if [[ "${LIBRECHAT_AUTH_HARDENING_APPROVAL:-}" != "YES" ]]; then
  echo "Set LIBRECHAT_AUTH_HARDENING_APPROVAL=YES for the explicitly approved production rollout." >&2
  exit 2
fi

sources=(
  api/strategies/validators.js
  api/strategies/localStrategy.js
  api/strategies/jwtStrategy.js
  api/server/controllers/AuthController.js
  api/server/controllers/TwoFactorController.js
  api/server/controllers/auth/LoginController.js
  api/server/controllers/auth/TwoFactorAuthController.js
  api/server/middleware/requireLocalAuth.js
  api/server/middleware/securityHeaders.js
  api/server/middleware/validateImageRequest.js
  api/server/middleware/limiters/index.js
  api/server/middleware/limiters/loginAccountLimiter.js
  api/server/middleware/limiters/mfaLimiter.js
  api/server/routes/auth.js
  api/server/services/AuthService.js
  api/server/services/Realtime/auth.js
  api/server/services/mfaPolicy.js
  api/server/services/twoFactorService.js
  api/server/index.js
  api/server/experimental.js
  packages/api/src/mcp/oauth/handler.ts
  packages/api/src/oauth/csrf.ts
  packages/data-provider/src/api-endpoints.ts
  packages/data-provider/src/data-service.ts
  packages/data-provider/src/types.ts
  packages/data-schemas/src/crypto/index.ts
  packages/data-schemas/src/methods/session.ts
  packages/data-schemas/src/methods/user.ts
  packages/data-schemas/src/types/session.ts
  client/src/components/Auth/TwoFactorScreen.tsx
  client/src/data-provider/Auth/mutations.ts
  client/src/hooks/AuthContext.tsx
  client/scripts/post-build.cjs
  scripts/admin-reset-user-mfa.js
  AUTH_SECURITY.md
  CUSTOMIZATION_MASTER_DOC.md
  CUSTOMIZATION_MASTER_GUIDE.md
)

deploy_id=$(date +%Y%m%d-%H%M%S)-$$
local_bundle="/tmp/librechat-auth-hardening-source-$deploy_id.tgz"
remote_bundle="$VM_ROOT/.build/librechat-auth-hardening-source-$deploy_id.tgz"
tar -czf "$local_bundle" "${sources[@]}"
ssh "$VM_HOST" "mkdir -p '$VM_ROOT/.build'"
scp "$local_bundle" "$VM_HOST:$remote_bundle"
rm -f "$local_bundle"

ssh "$VM_HOST" "sudo -n true && VM_ROOT='$VM_ROOT' TAILSCALE_HOSTNAME='$TAILSCALE_HOSTNAME' TAILSCALE_HTTPS_PORT='$TAILSCALE_HTTPS_PORT' TAILSCALE_IP='$TAILSCALE_IP' SOURCE_BUNDLE='$remote_bundle' bash -s" <<'REMOTE'
set -euo pipefail
cd "$VM_ROOT"
echo "[auth-deploy] creating rollback snapshot"
stamp=$(date +%Y%m%d-%H%M%S)
rollback="$VM_ROOT/.rollback/auth-hardening-deploy-$stamp"
build_root="$VM_ROOT/.build/auth-hardening-$stamp"
builder="librechat-auth-builder-$stamp"
builder_image="librechat-auth-builder-image-$stamp"
release_image="librechat-local:auth-hardening-$stamp"
rollback_image="librechat-local:rollback-auth-hardening-$stamp"
mkdir -p "$rollback" "$build_root"
cp -a .env docker-compose.yml docker-compose.local.override.yml "$rollback/"
docker inspect LibreChat > "$rollback/LibreChat.inspect.json"
docker exec LibreChat sh -lc 'paths="/app/api /app/packages/api/dist /app/packages/data-provider/dist /app/packages/data-schemas/dist /app/client/dist"; [ -e /app/scripts ] && paths="$paths /app/scripts"; tar -czf /tmp/pre-auth-deploy.tgz $paths'
docker cp LibreChat:/tmp/pre-auth-deploy.tgz "$rollback/pre-auth-deploy.tgz"

echo "[auth-deploy] cloning live runtime into isolated builder"
docker commit --pause=false LibreChat "$rollback_image" >/dev/null
docker tag "$rollback_image" "$builder_image"
docker create --name "$builder" --memory=12g --memory-swap=16g "$builder_image" sleep infinity >/dev/null
cleanup() { docker rm -f "$builder" >/dev/null 2>&1 || true; docker image rm "$builder_image" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker start "$builder" >/dev/null
docker cp "$SOURCE_BUNDLE" "$builder:/tmp/source.tgz"
docker exec "$builder" sh -lc 'cd /app && tar -xzf /tmp/source.tgz && rm /tmp/source.tgz'
rm -f "$SOURCE_BUNDLE"

echo "[auth-deploy] building data provider"
docker exec -e NODE_OPTIONS=--max-old-space-size=4096 "$builder" sh -lc 'cd /app && npm run build:data-provider'
echo "[auth-deploy] building data schemas"
docker exec -e NODE_OPTIONS=--max-old-space-size=4096 "$builder" sh -lc 'cd /app && npm run build:data-schemas'
echo "[auth-deploy] building API package"
docker exec -e NODE_OPTIONS=--max-old-space-size=8192 "$builder" sh -lc 'cd /app && npm run build:api'
echo "[auth-deploy] building client"
docker exec -e NODE_OPTIONS=--max-old-space-size=6144 "$builder" sh -lc 'cd /app && npm run build:client'
echo "[auth-deploy] running reasoning preservation gate"
bash "$VM_ROOT/local-services/verify-openai-reasoning-preservation.sh" --container "$builder"

docker cp "$builder:/app/api" "$build_root/api"
docker cp "$builder:/app/packages/api/dist" "$build_root/packages-api-dist"
docker cp "$builder:/app/packages/data-provider/dist" "$build_root/packages-data-provider-dist"
docker cp "$builder:/app/packages/data-schemas/dist" "$build_root/packages-data-schemas-dist"
docker cp "$builder:/app/client/dist" "$build_root/client-dist"
docker cp "$builder:/app/scripts" "$build_root/scripts"
docker cp "$builder:/app/AUTH_SECURITY.md" "$build_root/AUTH_SECURITY.md"
docker cp "$builder:/app/CUSTOMIZATION_MASTER_DOC.md" "$build_root/CUSTOMIZATION_MASTER_DOC.md"
docker cp "$builder:/app/CUSTOMIZATION_MASTER_GUIDE.md" "$build_root/CUSTOMIZATION_MASTER_GUIDE.md"

update_env() {
  local key=$1 value=$2
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}

echo "[auth-deploy] enabling Tailscale HTTPS before changing runtime configuration"
sudo tailscale serve --yes --bg --https="$TAILSCALE_HTTPS_PORT" http://127.0.0.1:3080

echo "[auth-deploy] applying production auth configuration"
mfa_secret=$(openssl rand -hex 32)
jwt_secret=$(openssl rand -hex 32)
jwt_refresh_secret=$(openssl rand -hex 32)
canonical_origin="https://$TAILSCALE_HOSTNAME:$TAILSCALE_HTTPS_PORT"
update_env DOMAIN_CLIENT "$canonical_origin"
update_env DOMAIN_SERVER "$canonical_origin"
update_env CORS_ALLOWED_ORIGINS "$canonical_origin"
update_env MCP_OAUTH_CALLBACK_BASE_URL "http://localhost:3080"
update_env FORCE_SECURE_COOKIES true
update_env ALLOW_REGISTRATION false
update_env ALLOW_UNVERIFIED_EMAIL_LOGIN false
update_env MIN_PASSWORD_LENGTH 12
update_env SESSION_EXPIRY '1000 * 60 * 15'
update_env REFRESH_TOKEN_EXPIRY '1000 * 60 * 60 * 24 * 30'
update_env JWT_ISSUER librechat
update_env JWT_AUDIENCE librechat-api
update_env JWT_REFRESH_AUDIENCE librechat-refresh
update_env JWT_SECRET "$jwt_secret"
update_env JWT_REFRESH_SECRET "$jwt_refresh_secret"
update_env MFA_TOKEN_AUDIENCE librechat-mfa
update_env MFA_TEMP_TOKEN_SECRET "$mfa_secret"
update_env MFA_ENFORCEMENT all_local
update_env MFA_MAX_ATTEMPTS 5
update_env MFA_IP_MAX_ATTEMPTS 15
update_env MFA_ATTEMPT_WINDOW 5
update_env LOGIN_ACCOUNT_MAX 10
update_env LOGIN_ACCOUNT_WINDOW 15

echo "[auth-deploy] promoting built image and recreating API only"
docker commit --pause=false \
  --change 'ENTRYPOINT ["docker-entrypoint.sh"]' \
  --change 'CMD ["npm","run","backend"]' \
  --change 'WORKDIR /app' \
  --change 'USER 0:0' \
  "$builder" "$release_image" >/dev/null
docker tag "$release_image" librechat-local:latest
printf '%s\n' "$release_image" > "$rollback/release-image.txt"
printf '%s\n' "$rollback_image" > "$rollback/rollback-image.txt"
docker compose -p librechat-stable -f docker-compose.yml -f docker-compose.local.override.yml up -d --no-deps --force-recreate api

for _ in $(seq 1 60); do
  curl -fsS http://127.0.0.1:3080/api/config >/dev/null && break
  sleep 2
done
curl -fsS http://127.0.0.1:3080/api/config >/dev/null
curl --resolve "$TAILSCALE_HOSTNAME:$TAILSCALE_HTTPS_PORT:$TAILSCALE_IP" -fsS "$canonical_origin/api/config" >/dev/null
docker exec LibreChat node -e 'const mongoose = require("mongoose"); (async () => { await mongoose.connect(process.env.MONGO_URI); await mongoose.connection.collection("appsettings").updateOne({ settingsId: "global" }, { $set: { registrationEnabled: false, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } }, { upsert: true }); await mongoose.disconnect(); })().catch((error) => { console.error(error.message); process.exit(1); });'
printf 'Deployment complete. Rollback: %s\nBuild artifacts: %s\nRelease image: %s\nRollback image: %s\n' "$rollback" "$build_root" "$release_image" "$rollback_image"
REMOTE
