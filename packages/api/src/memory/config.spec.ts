import { EModelEndpoint } from 'librechat-data-provider';
import type { TMemoryConfig, TCustomConfig } from 'librechat-data-provider';
import { providerConfigMap } from '~/endpoints';
import { loadMemoryConfig, isMemoryEnabled } from './config';

/**
 * Validates that a memory agent's provider string will resolve in getProviderConfig.
 * The provider value in librechat.yaml must match EModelEndpoint casing (e.g., "openAI" not "openai")
 * because providerConfigMap keys are case-sensitive and the lowercase fallback only helps when
 * the canonical key is already all-lowercase (like "google").
 */
describe('provider casing compatibility with getProviderConfig', () => {
  it('openAI (EModelEndpoint casing) resolves in providerConfigMap', () => {
    expect(providerConfigMap[EModelEndpoint.openAI]).toBeDefined();
    expect(providerConfigMap['openAI']).toBeDefined();
  });

  it('openai (lowercase) does NOT resolve in providerConfigMap', () => {
    expect(providerConfigMap['openai']).toBeUndefined();
  });

  it('google (lowercase) resolves because EModelEndpoint.google is already lowercase', () => {
    expect(providerConfigMap[EModelEndpoint.google]).toBeDefined();
    expect(providerConfigMap['google']).toBeDefined();
  });
});

describe('loadMemoryConfig', () => {
  it('returns undefined when config is undefined', () => {
    expect(loadMemoryConfig(undefined)).toBeUndefined();
  });

  it('returns config with disabled: true when no valid agent', () => {
    const result = loadMemoryConfig({ agent: {} } as TCustomConfig['memory']);
    expect(result).toBeDefined();
    expect(result!.disabled).toBe(true);
  });

  it('returns config with disabled: true when agent has no id, provider, or model', () => {
    const result = loadMemoryConfig({
      agent: { instructions: 'test' },
    } as TCustomConfig['memory']);
    expect(result).toBeDefined();
    expect(result!.disabled).toBe(true);
  });

  it('returns enabled config when agent has valid id', () => {
    const result = loadMemoryConfig({
      agent: { id: 'my-agent-id' },
    } as TCustomConfig['memory']);
    expect(result).toBeDefined();
    expect(result!.disabled).toBeUndefined();
    expect(result!.charLimit).toBe(10000);
  });

  it('returns enabled config when agent has valid provider + model (inline)', () => {
    const result = loadMemoryConfig({
      agent: { provider: 'openai', model: 'gpt-4.1-mini' },
    } as TCustomConfig['memory']);
    expect(result).toBeDefined();
    expect(result!.disabled).toBeUndefined();
    expect(result!.charLimit).toBe(10000);
  });

  it('respects explicit disabled: true even with valid agent', () => {
    const result = loadMemoryConfig({
      disabled: true,
      agent: { provider: 'openai', model: 'gpt-4.1-mini' },
    } as TCustomConfig['memory']);
    expect(result).toBeDefined();
    expect(result!.disabled).toBe(true);
  });

  it('preserves tokenLimit from config', () => {
    const result = loadMemoryConfig({
      tokenLimit: 5000,
      agent: { provider: 'openai', model: 'gpt-4.1-mini' },
    } as TCustomConfig['memory']);
    expect(result!.tokenLimit).toBe(5000);
  });

  it('preserves validKeys from config', () => {
    const keys = ['preferences', 'work_info'];
    const result = loadMemoryConfig({
      validKeys: keys,
      agent: { provider: 'openai', model: 'gpt-4.1-mini' },
    } as TCustomConfig['memory']);
    expect(result!.validKeys).toEqual(keys);
  });
});

describe('isMemoryEnabled', () => {
  it('returns false for undefined config', () => {
    expect(isMemoryEnabled(undefined)).toBe(false);
  });

  it('returns false for disabled config', () => {
    expect(isMemoryEnabled({ disabled: true } as TMemoryConfig)).toBe(false);
  });

  it('returns false for config with no valid agent', () => {
    expect(isMemoryEnabled({ agent: {} } as TMemoryConfig)).toBe(false);
  });

  it('returns true for config with valid agent id', () => {
    expect(isMemoryEnabled({ agent: { id: 'my-agent-id' } } as TMemoryConfig)).toBe(true);
  });

  it('returns true for config with valid inline agent (provider + model)', () => {
    expect(
      isMemoryEnabled({
        agent: { provider: 'openai', model: 'gpt-4.1-mini' },
      } as TMemoryConfig),
    ).toBe(true);
  });
});
