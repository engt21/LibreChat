import {
  buildXAIModelCapabilitiesMap,
  getXAIModelCapabilities,
  getXAISettingCapabilityState,
  getXAITextCompatibleModelNames,
  normalizeXAIModelName,
} from './xai';
import type { TXAIModelCapabilities } from './xai';

describe('xAI model helpers', () => {
  it('normalizes xAI model names returned with provider prefixes', () => {
    expect(normalizeXAIModelName('xai/grok-4-0709')).toBe('grok-4-0709');
    expect(normalizeXAIModelName('grok-3-mini')).toBe('grok-3-mini');
  });

  it('filters non-text xAI models while preserving aliases', () => {
    const models: TXAIModelCapabilities[] = [
      {
        id: 'grok-4.20-beta-0309-non-reasoning',
        aliases: ['grok-4.20-beta-latest-non-reasoning'],
        input_modalities: ['text', 'image'],
        output_modalities: ['text'],
        search_price: 2500,
      },
      {
        id: 'grok-code-fast-1',
        input_modalities: ['text'],
        output_modalities: ['text'],
        search_price: 0,
      },
      {
        id: 'grok-imagine-1',
        input_modalities: ['text'],
        output_modalities: ['image'],
      },
    ];

    expect(getXAITextCompatibleModelNames(models)).toEqual([
      'grok-4.20-beta-0309-non-reasoning',
      'grok-4.20-beta-latest-non-reasoning',
      'grok-code-fast-1',
    ]);

    expect(buildXAIModelCapabilitiesMap(models)).toEqual({
      'grok-4.20-beta-0309-non-reasoning': {
        id: 'grok-4.20-beta-0309-non-reasoning',
        aliases: ['grok-4.20-beta-latest-non-reasoning'],
        input_modalities: ['text', 'image'],
        output_modalities: ['text'],
        search_price: 2500,
      },
      'grok-4.20-beta-latest-non-reasoning': {
        id: 'grok-4.20-beta-0309-non-reasoning',
        aliases: ['grok-4.20-beta-latest-non-reasoning'],
        input_modalities: ['text', 'image'],
        output_modalities: ['text'],
        search_price: 2500,
      },
      'grok-code-fast-1': {
        id: 'grok-code-fast-1',
        aliases: [],
        input_modalities: ['text'],
        output_modalities: ['text'],
        search_price: 0,
      },
    });
  });

  it('resolves xAI reasoning, vision, and multi-agent capabilities', () => {
    const nonReasoningCapabilities = getXAIModelCapabilities(
      'grok-4.20-beta-latest-non-reasoning',
      {
        id: 'grok-4.20-beta-0309-non-reasoning',
        aliases: ['grok-4.20-beta-latest-non-reasoning'],
        input_modalities: ['text', 'image'],
        output_modalities: ['text'],
        search_price: 2500,
      },
    );

    expect(nonReasoningCapabilities.supportsReasoning).toBe(false);
    expect(nonReasoningCapabilities.supportsImageInput).toBe(true);
    expect(nonReasoningCapabilities.supportsStop).toBe(true);
    expect(nonReasoningCapabilities.supportsWebSearch).toBe(true);

    const miniCapabilities = getXAIModelCapabilities('grok-3-mini');
    expect(miniCapabilities.supportsReasoning).toBe(true);
    expect(miniCapabilities.supportsReasoningEffort).toBe(true);

    const multiAgentCapabilities = getXAIModelCapabilities('grok-4.20-multi-agent-beta-0309', {
      id: 'grok-4.20-multi-agent-beta-0309',
      input_modalities: ['text', 'image'],
      output_modalities: ['text'],
    });
    expect(multiAgentCapabilities.isMultiAgent).toBe(true);
    expect(multiAgentCapabilities.supportsFunctionCalling).toBe(false);
    expect(multiAgentCapabilities.supportsMaxOutputTokens).toBe(false);
    expect(multiAgentCapabilities.supportsReasoningEffort).toBe(true);

    const codeCapabilities = getXAIModelCapabilities('grok-code-fast-1', {
      id: 'grok-code-fast-1',
      input_modalities: ['text'],
      output_modalities: ['text'],
      search_price: 0,
    });
    expect(codeCapabilities.supportsWebSearch).toBe(false);
  });

  it('returns user-facing reasons for unsupported xAI settings', () => {
    const reasoningCapabilities = getXAIModelCapabilities('grok-4-0709', {
      id: 'grok-4-0709',
      input_modalities: ['text', 'image'],
      output_modalities: ['text'],
    });
    const multiAgentCapabilities = getXAIModelCapabilities('grok-4.20-multi-agent-beta-0309', {
      id: 'grok-4.20-multi-agent-beta-0309',
      input_modalities: ['text', 'image'],
      output_modalities: ['text'],
    });
    const codeCapabilities = getXAIModelCapabilities('grok-code-fast-1', {
      id: 'grok-code-fast-1',
      input_modalities: ['text'],
      output_modalities: ['text'],
    });

    expect(getXAISettingCapabilityState('reasoning_effort', reasoningCapabilities)).toEqual({
      supported: false,
      reason:
        'Only Grok 3 Mini and xAI multi-agent models currently support xAI reasoning effort controls.',
    });
    expect(getXAISettingCapabilityState('stop', reasoningCapabilities)).toEqual({
      supported: false,
      reason: 'xAI reasoning models do not support stop sequences.',
    });
    expect(getXAISettingCapabilityState('max_tokens', multiAgentCapabilities)).toEqual({
      supported: false,
      reason: 'This xAI multi-agent model does not support output token limits.',
    });
    expect(getXAISettingCapabilityState('imageDetail', codeCapabilities)).toEqual({
      supported: false,
      reason: 'This model does not support image understanding input.',
    });
    expect(getXAISettingCapabilityState('web_search', codeCapabilities)).toEqual({
      supported: false,
      reason: 'This xAI model does not support provider-native web search.',
    });
    expect(getXAISettingCapabilityState('useResponsesApi', codeCapabilities)).toEqual({
      supported: false,
      reason:
        'xAI automatically uses the Responses API when needed (e.g., for web search). This toggle is not applicable.',
    });
  });
});
