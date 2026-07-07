#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT

check_profile() {
  local profile="$1"
  local use_stable_mongo="$2"
  local config

  config="$(
    export LIBRECHAT_DEV_PROFILE="$profile"
    export LIBRECHAT_DEV_USE_STABLE_MONGO="$use_stable_mongo"
    export LIBRECHAT_STABLE_MONGO_URI='mongodb://test:test@stable.invalid:27017/LibreChat?authSource=admin'
    source "$ROOT_DIR/local-services/rail-env.sh"
    resolve_librechat_rail "$ROOT_DIR" dev
    docker compose \
      -p librechat-dev-resource-contract \
      -f "$ROOT_DIR/docker-compose.yml" \
      -f "$ROOT_DIR/docker-compose.local.override.yml" \
      config --format json
  )"

  PROFILE="$profile" node -e '
    const fs = require("fs");
    const profile = process.env.PROFILE;
    const config = JSON.parse(fs.readFileSync(0, "utf8"));
    const services = config.services ?? {};
    const targets = profile === "failover" ? ["api"] : Object.keys(services);
    const failures = [];
    const apiEnvironment = services.api?.environment ?? {};
    const expectedByProfile = {
      failover: {
        api: {
          mem_limit: "1342177280",
          mem_reservation: "536870912",
          cpus: 1,
          nodeOptions: "--max-old-space-size=768",
        },
      },
      full: {
        api: {
          mem_limit: "2147483648",
          mem_reservation: "1073741824",
          cpus: 1.5,
          nodeOptions: "--max-old-space-size=1536",
        },
        mongodb: {
          mem_limit: "536870912",
          mem_reservation: "268435456",
          cpus: 0.5,
        },
        meilisearch: {
          mem_limit: "402653184",
          mem_reservation: "134217728",
          cpus: 0.75,
        },
        vectordb: {
          mem_limit: "536870912",
          mem_reservation: "268435456",
          cpus: 0.5,
        },
        "code-interpreter-local": {
          mem_limit: "268435456",
          mem_reservation: "100663296",
          cpus: 0.5,
        },
        rag_api: {
          mem_limit: "268435456",
          mem_reservation: "100663296",
          cpus: 0.25,
        },
        rag_api_azure: {
          mem_limit: "268435456",
          mem_reservation: "100663296",
          cpus: 0.25,
        },
        rag_api_google: {
          mem_limit: "268435456",
          mem_reservation: "100663296",
          cpus: 0.25,
        },
      },
    };

    for (const name of ["DOMAIN_CLIENT", "DOMAIN_SERVER"]) {
      if (apiEnvironment[name] !== "http://127.0.0.1:3081") {
        failures.push(`${name}: expected dev origin, got ${apiEnvironment[name]}`);
      }
    }

    for (const name of targets) {
      const service = services[name];
      if (!service) {
        failures.push(`${name}: service missing`);
        continue;
      }
      if (service.mem_limit != null && service.mem_reservation != null) {
        const limit = Number(service.mem_limit);
        const reservation = Number(service.mem_reservation);
        if (limit < reservation) {
          failures.push(`${name}: limit ${limit} is below reservation ${reservation}`);
        }
      }
    }

    for (const [name, expected] of Object.entries(expectedByProfile[profile])) {
      const service = services[name];
      if (!service) {
        failures.push(`${name}: protected service missing`);
        continue;
      }
      for (const key of ["mem_limit", "mem_reservation", "cpus"]) {
        if (String(service[key]) !== String(expected[key])) {
          failures.push(`${name}.${key}: expected ${expected[key]}, got ${service[key]}`);
        }
      }
      if (
        expected.nodeOptions != null &&
        service.environment?.NODE_OPTIONS !== expected.nodeOptions
      ) {
        failures.push(
          `${name}.NODE_OPTIONS: expected ${expected.nodeOptions}, got ${service.environment?.NODE_OPTIONS}`,
        );
      }
    }

    if (failures.length > 0) {
      console.error(failures.join("\n"));
      process.exit(1);
    }
  ' <<<"$config"
}

check_profile failover true
check_profile full false

stable_origins="$(
  source "$ROOT_DIR/local-services/rail-env.sh"
  resolve_librechat_rail "$ROOT_DIR" stable
  printf '%s\n%s\n' "$DOMAIN_CLIENT" "$DOMAIN_SERVER"
)"
expected_stable_origin='https://librechatvm.tail6e13ff.ts.net:8443'
[[ "$(sed -n '1p' <<<"$stable_origins")" == "$expected_stable_origin" ]]
[[ "$(sed -n '2p' <<<"$stable_origins")" == "$expected_stable_origin" ]]

if DEV_SEED_UPDATE_RUNTIME_CONFIG=true \
  node "$ROOT_DIR/local-services/dev-seed-validation-personas.js" \
  >"$fixture/missing-targets.log" 2>&1; then
  echo "Validation seed unexpectedly accepted runtime config mutation without isolated targets." >&2
  exit 1
fi
grep -Fq \
  'requires explicit DEV_VALIDATION_ENV_PATH and DEV_VALIDATION_YAML_PATH targets' \
  "$fixture/missing-targets.log"

if DEV_SEED_UPDATE_RUNTIME_CONFIG=true \
  DEV_VALIDATION_ENV_PATH="$ROOT_DIR/.env" \
  DEV_VALIDATION_YAML_PATH="$ROOT_DIR/librechat.yaml" \
  node "$ROOT_DIR/local-services/dev-seed-validation-personas.js" \
  >"$fixture/shared-targets.log" 2>&1; then
  echo "Validation seed unexpectedly accepted shared runtime config targets." >&2
  exit 1
fi
grep -Fq 'must point to an isolated validation copy' "$fixture/shared-targets.log"

echo "Dev rail resource contracts: PASS"
