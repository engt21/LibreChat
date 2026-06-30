#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container=""

usage() {
  cat <<'USAGE'
Usage:
  ./local-services/verify-openai-reasoning-preservation.sh [--container NAME]

Fails closed if the required OpenAI reasoning-summary separation and native
web-search completion bounds are missing from source, regression coverage,
documentation, or (when requested) a deployed API container.

Options:
  --container NAME   Also inspect the deployed runtime in the named API container
  -h, --help         Show this help
USAGE
}

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --container)
      container="${2:?Missing container after --container}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "Unknown option: $1"
      ;;
  esac
done

if [[ -n "$container" ]]; then
  command -v docker >/dev/null 2>&1 || fail "docker is required to verify deployed runtime: $container"
  docker inspect "$container" >/dev/null 2>&1 || fail "Container does not exist: $container"
fi

node - "$ROOT_DIR" "$container" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const rootDirectory = process.argv[2];
const container = process.argv[3] || '';
const requirements = [
  {
    file: 'packages/api/src/endpoints/openai/llm.ts',
    purpose: 'bounded hosted OpenAI/Azure Responses web search',
    patterns: [
      /const DEFAULT_OPENAI_WEB_SEARCH_MAX_TOOL_CALLS = 6;/,
      /const MAX_OPENAI_WEB_SEARCH_MAX_TOOL_CALLS = 12;/,
      /modelKwargs\.max_tool_calls = getOpenAIWebSearchMaxToolCalls\(modelKwargs\.max_tool_calls\);/,
    ],
  },
  {
    file: 'packages/api/src/endpoints/openai/llm.spec.ts',
    purpose: 'web-search completion regression coverage',
    patterns: [
      /should bound configured web search tool calls for OpenAI Responses/,
      /should not inject OpenAI tool call limits for custom compatible endpoints/,
    ],
  },
  {
    file: 'client/src/utils/mergeThinkingText.ts',
    purpose: 'live reasoning-item boundary helper',
    patterns: [/export function mergeThinkingText/, /`\$\{previous\}\\n\\n\$\{next\}`/],
  },
  {
    file: 'client/src/hooks/SSE/useStepHandler.ts',
    purpose: 'live SSE reasoning-item boundary application',
    patterns: [/mergeThinkingText/, /think: mergeThinkingText\(/],
  },
  {
    file: 'client/src/utils/streamingReasoning.ts',
    purpose: 'hydrated reasoning-item boundary application',
    patterns: [/mergeThinkingText/, /mergeThinkingText\(/],
  },
  {
    file: 'config/apply-runtime-patches.js',
    purpose: 'persisted reasoning-item boundary runtime patch',
    patterns: [
      /Separate completed OpenAI reasoning summary items in persisted content/,
      /dist\/cjs\/stream\.cjs/,
      /dist\/esm\/stream\.mjs/,
      /src\/stream\.ts/,
      /\\\\\*\\\\\*/,
    ],
  },
  {
    file: 'api/server/services/Config/applyRuntimePatches.spec.js',
    purpose: 'persisted Markdown-heading boundary regression coverage',
    patterns: [
      /reasoning content aggregation boundaries/,
      /separates Markdown-headed completed summary items from production payloads/,
    ],
  },
  {
    file: 'package.json',
    purpose: 'operator-visible invariant command',
    patterns: [/verify:openai-reasoning-preservation/, /verify-openai-reasoning-preservation\.sh/],
  },
  {
    file: 'local-services/start-all.sh',
    purpose: 'stable startup fail-closed hook',
    patterns: [/verify-openai-reasoning-preservation\.sh/, /--container "\$stable_container"/],
  },
  {
    file: 'local-services/deploy-built-client-dist.sh',
    purpose: 'stable frontend promotion fail-closed hook',
    patterns: [/before stable frontend promotion/, /after stable frontend promotion/, /verify-openai-reasoning-preservation\.sh/],
  },
  {
    file: 'local-services/health-check.sh',
    purpose: 'running stable drift detection hook',
    patterns: [/OpenAI reasoning preservation invariant/, /verify-openai-reasoning-preservation\.sh/, /--container "\$stable_container"/],
  },
  {
    file: 'OPENAI_GEMINI_NATIVE_TOOLS.md',
    purpose: 'operator preservation documentation',
    patterns: [/OPENAI_REASONING_PRESERVATION_INVARIANT/, /max_tool_calls/, /verify-openai-reasoning-preservation\.sh/],
  },
  {
    file: 'CUSTOMIZATION_MASTER_GUIDE.md',
    purpose: 'merge preservation documentation',
    patterns: [/OPENAI_REASONING_PRESERVATION_INVARIANT/, /verify-openai-reasoning-preservation\.sh/],
  },
];

const readRequirementFile = (relativePath) => {
  const absolutePath = path.join(rootDirectory, relativePath);
  if (fs.existsSync(absolutePath)) {
    return fs.readFileSync(absolutePath, 'utf8');
  }

  if (!container) {
    return null;
  }

  try {
    return execFileSync('docker', ['exec', container, 'cat', `/app/${relativePath}`], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    return null;
  }
};

const failures = [];
for (const requirement of requirements) {
  const contents = readRequirementFile(requirement.file);
  if (contents == null) {
    failures.push(`${requirement.file}: missing (${requirement.purpose})`);
    continue;
  }
  requirement.patterns.forEach((pattern) => {
    if (!pattern.test(contents)) {
      failures.push(`${requirement.file}: missing ${pattern} (${requirement.purpose})`);
    }
  });
}
if (failures.length > 0) {
  console.error('OpenAI reasoning preservation invariant is not satisfied:');
  failures.forEach((failure) => console.error(`  - ${failure}`));
  process.exit(1);
}
console.log('Repository OpenAI reasoning preservation invariant: PASS');
NODE

if [[ -n "$container" ]]; then
  docker exec -i "$container" node - <<'NODE'
const fs = require('node:fs');

const runtimeRequirements = [
  {
    file: '/app/packages/api/dist/index.js',
    patterns: [/max_tool_calls/, /getOpenAIWebSearchMaxToolCalls/],
  },
  {
    file: '/app/node_modules/@librechat/agents/dist/cjs/stream.cjs',
    patterns: [/next\.trimStart\(\)/, /\\n\\n/, /\\\*\\\*/],
  },
  {
    file: '/app/node_modules/@librechat/agents/dist/esm/stream.mjs',
    patterns: [/next\.trimStart\(\)/, /\\n\\n/, /\\\*\\\*/],
  },
];
const failures = [];
for (const requirement of runtimeRequirements) {
  if (!fs.existsSync(requirement.file)) {
    failures.push(`${requirement.file}: missing`);
    continue;
  }
  const contents = fs.readFileSync(requirement.file, 'utf8');
  for (const pattern of requirement.patterns) {
    if (!pattern.test(contents)) {
      failures.push(`${requirement.file}: missing ${pattern}`);
    }
  }
}
if (failures.length > 0) {
  console.error('Deployed OpenAI reasoning preservation invariant is not satisfied:');
  failures.forEach((failure) => console.error(`  - ${failure}`));
  process.exit(1);
}
console.log('Deployed OpenAI reasoning preservation invariant: PASS');
NODE
fi
