import {
  buildGoogleModelCapabilitiesMap,
  getGoogleModelCapabilities,
  getGoogleSettingCapabilityState,
  getGoogleTextCompatibleModelNames,
  normalizeGoogleModelName,
} from './google';
import type { TGoogleModelCapabilities } from './google';

describe('google model helpers', () => {
  it('normalizes Google model names returned by the models API', () => {
    expect(normalizeGoogleModelName('models/gemini-2.5-flash')).toBe('gemini-2.5-flash');
    expect(normalizeGoogleModelName('gemma-3-27b-it')).toBe('gemma-3-27b-it');
  });

  it('filters out non-text Google models while keeping Gemini and Gemma text models', () => {
    const models: TGoogleModelCapabilities[] = [
      {
        name: 'models/gemini-2.5-flash',
        supportedGenerationMethods: ['generateContent', 'countTokens'],
      },
      {
        name: 'models/gemma-3-27b-it',
        supportedGenerationMethods: ['generateContent', 'countTokens'],
      },
      {
        name: 'models/gemini-3-pro-image-preview',
        supportedGenerationMethods: ['generateContent', 'countTokens'],
      },
      {
        name: 'models/gemini-2.5-flash-preview-tts',
        supportedGenerationMethods: ['generateContent', 'countTokens'],
      },
      {
        name: 'models/gemini-embedding-001',
        supportedGenerationMethods: ['embedContent', 'countTokens'],
      },
    ];

    expect(getGoogleTextCompatibleModelNames(models)).toEqual([
      'gemini-2.5-flash',
      'gemma-3-27b-it',
    ]);

    expect(buildGoogleModelCapabilitiesMap(models)).toEqual({
      'gemini-2.5-flash': {
        name: 'gemini-2.5-flash',
        supportedGenerationMethods: ['generateContent', 'countTokens'],
      },
      'gemma-3-27b-it': {
        name: 'gemma-3-27b-it',
        supportedGenerationMethods: ['generateContent', 'countTokens'],
      },
    });
  });

  it('treats latest Gemini aliases as thinking-level models', () => {
    const capabilities = getGoogleModelCapabilities('gemini-pro-latest', {
      name: 'gemini-pro-latest',
      supportedGenerationMethods: ['generateContent'],
      thinking: true,
    });

    expect(capabilities.supportsThinking).toBe(true);
    expect(capabilities.supportsThinkingLevel).toBe(true);
    expect(capabilities.supportsThinkingBudget).toBe(false);
  });

  it('keeps Gemini 2.5 models on thinking budget controls', () => {
    const capabilities = getGoogleModelCapabilities('gemini-2.5-flash', {
      name: 'gemini-2.5-flash',
      supportedGenerationMethods: ['generateContent'],
      thinking: true,
    });

    expect(capabilities.supportsThinking).toBe(true);
    expect(capabilities.supportsThinkingBudget).toBe(true);
    expect(capabilities.supportsThinkingLevel).toBe(false);
    expect(capabilities.supportsWebSearch).toBe(true);
  });

  it('disables unsupported Google Search grounding controls for older Gemini and Gemma models', () => {
    const legacyGeminiCapabilities = getGoogleModelCapabilities('gemini-1.5-flash', {
      name: 'gemini-1.5-flash',
      supportedGenerationMethods: ['generateContent'],
      thinking: true,
    });
    const capabilities = getGoogleModelCapabilities('gemma-3-27b-it', {
      name: 'gemma-3-27b-it',
      supportedGenerationMethods: ['generateContent'],
    });

    expect(getGoogleSettingCapabilityState('web_search', legacyGeminiCapabilities)).toEqual({
      supported: false,
      reason: 'This model does not support Google Search grounding in LibreChat.',
    });
    expect(getGoogleSettingCapabilityState('web_search', capabilities)).toEqual({
      supported: false,
      reason: 'This model does not support Google Search grounding in LibreChat.',
    });
  });
});
