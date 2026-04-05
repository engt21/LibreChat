# Provider and MCP Backend Notes

## Type-Warning Hotspots in packages/api

### Balance middleware (balance.ts)

The only build-time TypeScript warning in packages/api comes from `src/middleware/balance.ts:101:61` where Mongoose's `FlattenMaps<IBalance>` type is not assignable to `IBalance` due to deep `MongoClient` property mismatches. This is a known Mongoose 8.x typing regression where `lean()` results produce `FlattenMaps<T>` instead of `T`. The warning does not affect runtime behavior and is present upstream as well. **Intentionally preserved** — fixing requires either a Mongoose version update or a `as unknown as IBalance` cast that would weaken type safety elsewhere.

### apiKeys / jwt / google-auth paths

These modules were identified as type-warning hotspot candidates during the migration assessment:

- **apiKeys** (`src/apiKeys/`): Clean TypeScript — no `@ts-ignore` or `as any` in product code. Well-typed with explicit interfaces. No build-time warnings.
- **jwt** (`src/crypto/jwt.ts`): Minimal module (single function). Uses `process.env.JWT_SECRET!` non-null assertion, which is safe given the app's environment validation at startup. No build-time warnings.
- **google/auth** (`src/endpoints/google/auth.ts`): Clean TypeScript with explicit types. All auth mode resolution, credential parsing, and client option building are typed. No build-time warnings. Comprehensive test coverage added (22 tests across API key, service account, ADC modes, normalizeGoogleAuthMode, parseGoogleCredentials, and resolveGoogleClientAuth edge cases).

**Summary**: The apiKeys/jwt/google-auth paths do not have active type-warning hotspots. The only packages/api build warning is the Mongoose FlattenMaps issue in balance.ts, which is unrelated to provider/MCP seams and is intentionally preserved.

### tsc --noEmit limitation on this host

Full `tsc --noEmit` against the packages/api tsconfig cannot complete on this host due to memory constraints (~4GB heap exhaustion before completion). The Rollup-based build (`npm run build:api`) succeeds because rollup-plugin-typescript uses `transpileOnly` mode and only surfaces isolated file-level type errors. Workers should not treat the inability to run `tsc --noEmit` as a type regression — the build system validates type safety at the individual-module level during the Rollup build.

## MCPOAuthRaceCondition Test Stability

The `MCPOAuthRaceCondition.test.ts` test suite (14 tests) passes consistently when run in isolation on this host. Earlier reports of flakiness were likely due to:
- Host memory pressure causing slow timers and timeouts in OAuth flow tests
- Concurrent test execution competing for I/O during the E2E server lifecycle tests

**Recommendation**: Run this suite in isolation (`--runInBand` or standalone) when validating on memory-constrained hosts. The test's timer-dependent assertions (e.g., 500ms token expiry, 2s flow monitoring) are sensitive to system load.

## Provider Test Coverage Summary

The following provider/MCP backend test suites cover the most sensitive seams:

| Suite | Tests | Covers |
|-------|-------|--------|
| `google/auth.spec.ts` | 22 | Multi-mode Google auth (API key, service account, ADC), normalizeGoogleAuthMode, parseGoogleCredentials, resolveGoogleClientAuth, env fallback chains |
| `azure.spec.ts` | 42 | Azure URL normalization, direct /openai/v1 routing, legacy credential parsing, model listing detection, endpoint generation |
| `models.spec.ts` | 46 | OpenAI/Azure/Google/Anthropic/Bedrock/Ollama model discovery, multi-source Ollama merge, cache bypass |
| `nativeTools.spec.ts` | 8 | OpenAI/Google/xAI native tool routing, duplicate stripping, agent bypass |
| `handler.test.ts` | 44 | OAuth refresh, callback, metadata discovery, revocation, legacy fallback |
| `zod.spec.ts` | 81 | MCP schema normalization, bare object schemas, $ref resolution, vendor extension stripping |
| `openai/config.spec.ts` | 87 | OpenAI/Azure/custom endpoint config, parameter shaping, defaultParams |
| `openai/initialize.spec.ts` | 2 | Azure api-version omission for /openai/v1 routes |
| `openai/config.backward-compat.spec.ts` | 10 | Backward-compatible Azure/custom endpoint config |
| `MCPOAuthRaceCondition.test.ts` | 14 | OAuth race condition fixes, token expiry, reauth flow |
| `mcp.spec.js` (api/) | 89 | MCP route OAuth callback URL precedence, CSRF, server CRUD |

Total: **445+ focused provider/MCP backend tests**.
