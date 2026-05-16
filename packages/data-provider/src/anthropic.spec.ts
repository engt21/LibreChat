import {
  buildAnthropicModelCapabilitiesMap,
  getAnthropicModelCapabilities,
  getAnthropicQuickSelectModelNames,
  getAnthropicSettingCapabilityState,
  normalizeAnthropicModelName,
  resolveAnthropicThinkingEnabled,
  sortAnthropicModels,
} from './anthropic';
import type { TAnthropicModelCapabilities } from './anthropic';

describe('anthropic model helpers', () => {
  it('normalizes Anthropic model names returned by the models API', () => {
    expect(normalizeAnthropicModelName('models/claude-opus-4-6')).toBe('claude-opus-4-6');
    expect(normalizeAnthropicModelName('anthropic/claude-sonnet-4-5')).toBe(
      'claude-sonnet-4-5',
    );
    expect(normalizeAnthropicModelName('claude-3-7-sonnet-latest')).toBe(
      'claude-3-7-sonnet-latest',
    );
  });

  it('builds a capability map and sorts newer Anthropic families first', () => {
    const models: TAnthropicModelCapabilities[] = [
      {
        id: 'claude-3-7-sonnet-latest',
        display_name: 'Claude 3.7 Sonnet',
        created_at: '2025-02-19T00:00:00Z',
        type: 'model',
      },
      {
        id: 'claude-sonnet-4-5',
        display_name: 'Claude Sonnet 4.5',
        created_at: '2025-09-29T00:00:00Z',
        type: 'model',
      },
      {
        id: 'claude-opus-4-6',
        display_name: 'Claude Opus 4.6',
        created_at: '2026-04-10T00:00:00Z',
        type: 'model',
      },
    ];

    const capabilityMap = buildAnthropicModelCapabilitiesMap(models);

    expect(capabilityMap['claude-opus-4-6']).toEqual(
      expect.objectContaining({
        id: 'claude-opus-4-6',
        display_name: 'Claude Opus 4.6',
      }),
    );
    expect(sortAnthropicModels(Object.keys(capabilityMap), capabilityMap)).toEqual([
      'claude-opus-4-6',
      'claude-sonnet-4-5',
      'claude-3-7-sonnet-latest',
    ]);
  });

  it('keeps Anthropic quick picks unique per lineage', () => {
    const models = [
      'claude-opus-4-6',
      'claude-opus-4-6-20260410',
      'claude-sonnet-4-5',
      'claude-sonnet-4-5-20250929',
      'claude-3-7-sonnet-latest',
    ];

    expect(getAnthropicQuickSelectModelNames(models)).toEqual([
      'claude-opus-4-6',
      'claude-sonnet-4-5',
      'claude-3-7-sonnet-latest',
    ]);
  });

  it('detects adaptive thinking and Anthropic-native tools on newer Opus models', () => {
    const capabilities = getAnthropicModelCapabilities('claude-opus-4-6');

    expect(capabilities.supportsThinking).toBe(true);
    expect(capabilities.supportsAdaptiveThinking).toBe(true);
    expect(capabilities.supportsEffort).toBe(true);
    expect(capabilities.supportsEffortMax).toBe(true);
    expect(capabilities.supportsWebSearch).toBe(true);
    expect(capabilities.supportsCodeExecution).toBe(true);
  });

  it('keeps Claude 3.7 on fixed thinking budgets instead of adaptive effort', () => {
    const capabilities = getAnthropicModelCapabilities('claude-3-7-sonnet-latest');

    expect(capabilities.supportsThinking).toBe(true);
    expect(capabilities.supportsAdaptiveThinking).toBe(false);
    expect(capabilities.supportsThinkingBudget).toBe(true);
    expect(capabilities.supportsEffort).toBe(false);
  });

  it('disables Anthropic sampling controls while thinking is enabled', () => {
    const capabilities = getAnthropicModelCapabilities('claude-sonnet-4-5');

    expect(
      getAnthropicSettingCapabilityState('temperature', capabilities, { thinking: true }),
    ).toEqual({
      supported: false,
      reason: 'Anthropic disables temperature, top_p, and top_k while thinking is enabled.',
    });
  });

  it('explains when a model uses adaptive effort instead of thinking budgets', () => {
    const capabilities = getAnthropicModelCapabilities('claude-opus-4-6');

    expect(
      getAnthropicSettingCapabilityState('thinkingBudget', capabilities, { thinking: true }),
    ).toEqual({
      supported: false,
      reason:
        'This Claude model uses adaptive thinking and effort controls instead of a fixed thinking budget.',
    });
  });

  it('treats Anthropic thinking as enabled when the conversation is still using the default', () => {
    const capabilities = getAnthropicModelCapabilities('claude-sonnet-4-5');

    expect(resolveAnthropicThinkingEnabled(undefined)).toBe(true);
    expect(
      getAnthropicSettingCapabilityState('thinkingBudget', capabilities, {
        thinking: undefined,
      }),
    ).toEqual({ supported: true });
  });
});
