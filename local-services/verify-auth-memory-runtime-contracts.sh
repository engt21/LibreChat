#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container=""

usage() {
  cat <<'USAGE'
Usage: ./local-services/verify-auth-memory-runtime-contracts.sh [--container NAME]

Verifies authentication/session preservation and compiled memory package contracts.
With --container, also validates the deployed runtime and its direct package imports.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --container)
      [[ $# -ge 2 ]] || { echo "ERROR: --container requires a value" >&2; exit 2; }
      container="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

refresh_args=(--root "$ROOT_DIR")
if [[ -n "$container" ]]; then
  refresh_args+=(--container "$container")
fi
"$ROOT_DIR/local-services/verify-refresh-token-runtime-contract.sh" "${refresh_args[@]}"

ROOT_DIR="$ROOT_DIR" node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const root = process.env.ROOT_DIR;
const failures = [];
const hasFullSource = fs.existsSync(path.join(root, 'client/src/hooks/AuthContext.tsx')) &&
  fs.existsSync(path.join(root, 'packages/data-schemas/src/methods/session.ts'));

const requirements = [
  {
    file: 'packages/data-schemas/src/methods/session.ts',
    patterns: [/tokenType:\s*'refresh'/, /JWT_REFRESH_AUDIENCE/, /librechat-refresh/, /JWT_ISSUER/],
  },
  {
    file: 'api/server/controllers/AuthController.js',
    patterns: [
      /mfa_pending/,
      /JWT_REFRESH_AUDIENCE/,
      /librechat-refresh/,
      /JWT_ISSUER/,
      /payload\.sessionId \?\? payload\.jti/,
      /sessionId \? \{ sessionId \} : \{ refreshToken \}/,
    ],
  },
  {
    file: 'api/server/controllers/auth/LoginController.js',
    patterns: [/setMFAPendingCookie/, /mfa_pending/, /cookiePaths = \['\/'/, /clearCookie/],
  },
  {
    file: 'api/server/controllers/auth/TwoFactorAuthController.js',
    patterns: [/mfa_pending/, /path:\s*'\/'/],
  },
  {
    file: 'api/server/middleware/checkBan.js',
    patterns: [/Role\.ADMIN|ADMIN/, /findUser/],
  },
  {
    file: 'api/cache/banViolation.js',
    patterns: [/Role\.ADMIN|ADMIN/, /banViolation/],
  },
  {
    file: 'client/src/hooks/AuthContext.tsx',
    patterns: [/isTransientFailure/, /refreshFailureCountRef/, /refreshRetryTimerRef/, /setTimeout/],
  },
  {
    file: 'client/src/data-provider/Auth/mutations.ts',
    patterns: [/useRefreshTokenMutation[\s\S]*?mutationFn: \(\) => request\.refreshToken\(\)/],
  },
  {
    file: 'api/server/controllers/agents/client.js',
    patterns: [/detectMemoryIntent/, /formatMemoryResponseContext/, /createMemoryProcessor/],
  },
  {
    file: 'packages/api/src/agents/index.ts',
    patterns: [/export \* from '\.\/memoryPolicy'/],
  },
  {
    file: 'packages/api/src/agents/memory.ts',
    patterns: [/MemoryRun/, /category: 'memory'/, /GraphEvents\.CHAT_MODEL_END/, /onUsage/],
  },
  {
    file: 'packages/data-schemas/src/methods/session.ts',
    patterns: [
      /tokenType:\s*'refresh'/,
      /JWT_REFRESH_AUDIENCE/,
      /librechat-refresh/,
      /jwtId:\s*session\._id\.toString\(\)/,
    ],
  },
  {
    file: 'api/server/controllers/agents/client.js',
    patterns: [/context: 'memory'/, /\[MemoryUsage\]/, /endpointTokenConfig: agent\.endpointTokenConfig/],
  },
  {
    file: 'config/apply-runtime-patches.js',
    patterns: [/Preserve caller-defined Langfuse trace category metadata/, /configuredTraceMetadata/],
  },
  {
    file: 'local-services/deploy-vm-auth-hardening.sh',
    forbidden: [/collection\(["']sessions["']\)\.deleteMany\(\{\}\)/],
  },
];

for (const requirement of requirements) {
  if (!hasFullSource && requirement.file !== 'local-services/deploy-vm-auth-hardening.sh') continue;
  const absolute = path.join(root, requirement.file);
  if (!fs.existsSync(absolute)) {
    failures.push(`${requirement.file}: missing`);
    continue;
  }
  const contents = fs.readFileSync(absolute, 'utf8');
  for (const pattern of requirement.patterns ?? []) {
    if (!pattern.test(contents)) failures.push(`${requirement.file}: missing ${pattern}`);
  }
  for (const pattern of requirement.forbidden ?? []) {
    if (pattern.test(contents)) failures.push(`${requirement.file}: forbidden ${pattern}`);
  }
}

function validatePackageContracts(apiModule, schemasModule, label) {
  for (const name of ['detectMemoryIntent', 'formatMemoryResponseContext', 'createMemoryProcessor']) {
    if (typeof apiModule[name] !== 'function') failures.push(`${label}: @librechat/api.${name} is not a function`);
  }
  try {
    const mongoose = require(path.join(root, 'node_modules/mongoose'));
    const methods = schemasModule.createMethods(mongoose);
    if (typeof methods.recordMemoryEvent !== 'function') {
      failures.push(`${label}: @librechat/data-schemas createMethods().recordMemoryEvent is not a function`);
    }
  } catch (error) {
    failures.push(`${label}: unable to validate data-schemas methods: ${error.message}`);
  }
}

const hasRepositoryRuntimeDependencies = fs.existsSync(path.join(root, 'node_modules/@librechat/data-schemas')) &&
  fs.existsSync(path.join(root, 'node_modules/librechat-data-provider'));

if (hasFullSource && hasRepositoryRuntimeDependencies) {
  try {
    const apiModule = require(path.join(root, 'packages/api/dist/index.js'));
    const schemasModule = require(path.join(root, 'packages/data-schemas/dist/index.cjs'));
    const dataProvider = require(path.join(root, 'packages/data-provider/dist/index.js'));
    validatePackageContracts(apiModule, schemasModule, 'repository dist');
    const compiledSchemas = fs.readFileSync(
      path.join(root, 'packages/data-schemas/dist/index.cjs'),
      'utf8',
    );
    for (const marker of [
      /tokenType:\s*'refresh'/,
      /JWT_REFRESH_AUDIENCE/,
      /librechat-refresh/,
      /jwtId:\s*session\._id\.toString\(\)/,
    ]) {
      if (!marker.test(compiledSchemas)) {
        failures.push(`repository dist: data-schemas refresh-token contract missing ${marker}`);
      }
    }
    for (const model of ['gpt-5.6', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']) {
      const efforts = dataProvider.getOpenAIModelCapabilities(model).reasoningEffortOptions;
      if (!efforts.includes('max') || !efforts.includes('ultra')) {
        failures.push(`repository dist: ${model} is missing max/ultra reasoning efforts`);
      }
    }
  } catch (error) {
    failures.push(`repository dist: unable to load compiled packages: ${error.message}`);
  }
} else if (!hasFullSource) {
  console.log('Full repository source is not present; source and repository-dist checks skipped.');
} else {
  console.log('Repository runtime dependencies are not installed in this bundle; source checks passed and repository-dist module loading is deferred to the container contract.');
}

if (failures.length > 0) {
  console.error('Authentication and memory runtime contracts are not satisfied:');
  failures.forEach((failure) => console.error(`  - ${failure}`));
  process.exit(1);
}

console.log('Repository authentication and memory runtime contracts: PASS');
NODE

if [[ -n "$container" ]]; then
  docker exec -i "$container" node <<'NODE'
const fs = require('node:fs');
const dotenv = require('dotenv');

const failures = [];
const envPath = '/app/.env';
if (!fs.existsSync(envPath)) {
  failures.push(`${envPath}: missing persistent environment bind mount`);
} else {
  const persisted = dotenv.parse(fs.readFileSync(envPath));
  const requiredSecrets = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'CREDS_KEY', 'CREDS_IV'];
  for (const name of requiredSecrets) {
    if (!process.env[name]) failures.push(`process.env.${name}: missing`);
    if (!persisted[name]) failures.push(`${envPath}: ${name} missing`);
    if (process.env[name] && persisted[name] && process.env[name] !== persisted[name]) {
      failures.push(`${name}: running value differs from persistent ${envPath}`);
    }
  }
  if (persisted.CREDS_KEY && !/^[a-f0-9]{64}$/i.test(persisted.CREDS_KEY)) {
    failures.push(`${envPath}: CREDS_KEY must be 64 hexadecimal characters`);
  }
  if (persisted.CREDS_IV && !/^[a-f0-9]{32}$/i.test(persisted.CREDS_IV)) {
    failures.push(`${envPath}: CREDS_IV must be 32 hexadecimal characters`);
  }
}
const runtimeRequirements = [
  {
    file: '/app/api/server/controllers/AuthController.js',
    patterns: [
      /mfa_pending/,
      /JWT_REFRESH_AUDIENCE/,
      /librechat-refresh/,
      /payload\.sessionId \?\? payload\.jti/,
      /sessionId \? \{ sessionId \} : \{ refreshToken \}/,
    ],
  },
  { file: '/app/api/server/controllers/auth/LoginController.js', patterns: [/mfa_pending/, /clearCookie/, /path:\s*'\/'/] },
  { file: '/app/api/server/controllers/auth/TwoFactorAuthController.js', patterns: [/mfa_pending/, /path:\s*'\/'/] },
  { file: '/app/api/server/middleware/checkBan.js', patterns: [/Role\.ADMIN|ADMIN/] },
  { file: '/app/api/cache/banViolation.js', patterns: [/Role\.ADMIN|ADMIN/] },
  {
    file: '/app/api/server/controllers/agents/client.js',
    patterns: [/detectMemoryIntent/, /formatMemoryResponseContext/, /context: 'memory'/, /\[MemoryUsage\]/],
  },
  {
    file: '/app/node_modules/@librechat/agents/dist/esm/run.mjs',
    patterns: [/configuredTraceMetadata/, /traceMetadata/],
  },
  {
    file: '/app/packages/data-schemas/dist/index.cjs',
    patterns: [
      /tokenType:\s*'refresh'/,
      /JWT_REFRESH_AUDIENCE/,
      /librechat-refresh/,
      /jwtId:\s*session\._id\.toString\(\)/,
    ],
  },
  { file: '/app/local-services/deploy-vm-auth-hardening.sh', forbidden: [/collection\(["']sessions["']\)\.deleteMany\(\{\}\)/] },
];
for (const requirement of runtimeRequirements) {
  if (!fs.existsSync(requirement.file)) {
    failures.push(`${requirement.file}: missing`);
    continue;
  }
  const contents = fs.readFileSync(requirement.file, 'utf8');
  for (const pattern of requirement.patterns ?? []) {
    if (!pattern.test(contents)) failures.push(`${requirement.file}: missing ${pattern}`);
  }
  for (const pattern of requirement.forbidden ?? []) {
    if (pattern.test(contents)) failures.push(`${requirement.file}: forbidden ${pattern}`);
  }
}

const packageModules = {
  '@librechat/api': require('@librechat/api'),
  '@librechat/data-schemas': require('@librechat/data-schemas'),
  'librechat-data-provider': require('librechat-data-provider'),
};

for (const name of ['detectMemoryIntent', 'formatMemoryResponseContext', 'createMemoryProcessor']) {
  if (typeof packageModules['@librechat/api'][name] !== 'function') {
    failures.push(`@librechat/api.${name} is not a function`);
  }
}

for (const model of ['gpt-5.6', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']) {
  const efforts = packageModules['librechat-data-provider']
    .getOpenAIModelCapabilities(model).reasoningEffortOptions;
  if (!efforts.includes('max') || !efforts.includes('ultra')) {
    failures.push(`librechat-data-provider: ${model} is missing max/ultra reasoning efforts`);
  }
}

try {
  const methods = packageModules['@librechat/data-schemas'].createMethods(require('mongoose'));
  if (typeof methods.recordMemoryEvent !== 'function') {
    failures.push('@librechat/data-schemas createMethods().recordMemoryEvent is not a function');
  }
} catch (error) {
  failures.push(`unable to validate data-schemas methods: ${error.message}`);
}

const files = [];
function walk(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = `${directory}/${entry.name}`;
    if (entry.isDirectory()) walk(fullPath);
    else if (entry.isFile() && entry.name.endsWith('.js') && !/\.(?:spec|test)\.js$/.test(entry.name)) files.push(fullPath);
  }
}
walk('/app/api');

const importPattern = /(?:const|let|var)\s*\{([^{}]*?)\}\s*=\s*require\(['"](@librechat\/(?:api|data-schemas))['"]\)/g;
for (const file of files) {
  const contents = fs.readFileSync(file, 'utf8');
  for (const match of contents.matchAll(importPattern)) {
    const names = match[1]
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => value.replace(/^\.\.\./, '').split(':')[0].trim())
      .filter((value) => /^[A-Za-z_$][\w$]*$/.test(value));
    for (const name of names) {
      if (packageModules[match[2]][name] === undefined) {
        failures.push(`${file}: imports missing ${match[2]}.${name}`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error('Deployed authentication and memory runtime contracts are not satisfied:');
  failures.forEach((failure) => console.error(`  - ${failure}`));
  process.exit(1);
}

console.log('Deployed authentication and memory runtime contracts: PASS');
NODE
fi
