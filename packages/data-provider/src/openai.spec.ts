import {
  getOpenAIModelCapabilities,
  getOpenAISettingCapabilityState,
  resolveOpenAIResponsesApiEnabled,
  supportsOpenAISamplingControls,
} from './openai';
import { EModelEndpoint, ReasoningEffort } from './schemas';

describe('openai model helpers', () => {
  it('treats legacy GPT-5 models as reasoning-only with minimal effort controls', () => {
    const capabilities = getOpenAIModelCapabilities('gpt-5');

    expect(capabilities.supportsReasoningEffort).toBe(true);
    expect(capabilities.reasoningEffortOptions).toEqual([
      ReasoningEffort.unset,
      ReasoningEffort.minimal,
      ReasoningEffort.low,
      ReasoningEffort.medium,
      ReasoningEffort.high,
    ]);
    expect(supportsOpenAISamplingControls(capabilities)).toBe(false);
    expect(getOpenAISettingCapabilityState('temperature', capabilities)).toEqual({
      supported: false,
      reason: 'This OpenAI model does not support sampling controls.',
    });
  });

  it('allows versioned GPT-5 sampling controls only when reasoning is set to none', () => {
    const capabilities = getOpenAIModelCapabilities('gpt-5.1');

    expect(capabilities.reasoningEffortOptions).toEqual([
      ReasoningEffort.unset,
      ReasoningEffort.none,
      ReasoningEffort.low,
      ReasoningEffort.medium,
      ReasoningEffort.high,
    ]);
    expect(supportsOpenAISamplingControls(capabilities, ReasoningEffort.none)).toBe(true);
    expect(supportsOpenAISamplingControls(capabilities, ReasoningEffort.high)).toBe(false);
    expect(
      getOpenAISettingCapabilityState('temperature', capabilities, {
        reasoningEffort: ReasoningEffort.high,
      }),
    ).toEqual({
      supported: false,
      reason: 'Set reasoning effort to None to adjust sampling controls for this model.',
    });
  });

  it('adds max and ultra controls for GPT-5.6 preview models', () => {
    for (const model of ['gpt-5.6', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']) {
      const capabilities = getOpenAIModelCapabilities(model);

      expect(capabilities.reasoningEffortOptions).toEqual([
        ReasoningEffort.unset,
        ReasoningEffort.none,
        ReasoningEffort.low,
        ReasoningEffort.medium,
        ReasoningEffort.high,
        ReasoningEffort.xhigh,
        ReasoningEffort.max,
        ReasoningEffort.ultra,
      ]);
    }
  });

  it('does not expose GPT-5.6 preview controls on earlier GPT-5 models', () => {
    const capabilities = getOpenAIModelCapabilities('gpt-5.5');

    expect(capabilities.reasoningEffortOptions).not.toContain(ReasoningEffort.max);
    expect(capabilities.reasoningEffortOptions).not.toContain(ReasoningEffort.ultra);
  });

  it('marks GPT-5 pro variants as Responses-only with tighter reasoning effort options', () => {
    const capabilities = getOpenAIModelCapabilities('gpt-5.4-pro');

    expect(capabilities.requiresResponsesApi).toBe(true);
    expect(capabilities.reasoningEffortOptions).toEqual([
      ReasoningEffort.unset,
      ReasoningEffort.medium,
      ReasoningEffort.high,
      ReasoningEffort.xhigh,
    ]);
    expect(supportsOpenAISamplingControls(capabilities)).toBe(false);
  });

  it('restricts verbosity controls to GPT-5 family models using the Responses API', () => {
    const gpt5Capabilities = getOpenAIModelCapabilities('gpt-5.1');
    const gpt4Capabilities = getOpenAIModelCapabilities('gpt-4.1');

    expect(getOpenAISettingCapabilityState('verbosity', gpt5Capabilities)).toEqual({
      supported: false,
      reason: 'Enable the Responses API to configure verbosity for this model.',
    });
    expect(
      getOpenAISettingCapabilityState('verbosity', gpt5Capabilities, { useResponsesApi: true }),
    ).toEqual({ supported: true });
    expect(getOpenAISettingCapabilityState('verbosity', gpt4Capabilities)).toEqual({
      supported: false,
      reason: 'Only GPT-5 family models support OpenAI verbosity controls.',
    });
  });

  it('defaults built-in OpenAI endpoints to the Responses API for recognized OpenAI models', () => {
    const gpt4Capabilities = getOpenAIModelCapabilities('gpt-4.1');
    const deepseekCapabilities = getOpenAIModelCapabilities('deepseek-chat');
    const chatLatestCapabilities = getOpenAIModelCapabilities('gpt-chat-latest');

    expect(
      resolveOpenAIResponsesApiEnabled(gpt4Capabilities, { endpoint: EModelEndpoint.openAI }),
    ).toBe(true);
    expect(
      resolveOpenAIResponsesApiEnabled(gpt4Capabilities, { endpoint: EModelEndpoint.azureOpenAI }),
    ).toBe(true);
    expect(
      resolveOpenAIResponsesApiEnabled(gpt4Capabilities, { endpoint: EModelEndpoint.custom }),
    ).toBe(false);
    expect(
      resolveOpenAIResponsesApiEnabled(deepseekCapabilities, { endpoint: EModelEndpoint.openAI }),
    ).toBe(false);
    expect(
      resolveOpenAIResponsesApiEnabled(chatLatestCapabilities, {
        endpoint: EModelEndpoint.azureOpenAI,
      }),
    ).toBe(true);
  });

  it('still honors explicit Responses API opt-outs unless the model requires it', () => {
    const gpt4Capabilities = getOpenAIModelCapabilities('gpt-4.1');
    const gpt5ProCapabilities = getOpenAIModelCapabilities('gpt-5.4-pro');

    expect(
      resolveOpenAIResponsesApiEnabled(gpt4Capabilities, {
        endpoint: EModelEndpoint.openAI,
        useResponsesApi: false,
      }),
    ).toBe(false);
    expect(
      resolveOpenAIResponsesApiEnabled(gpt5ProCapabilities, {
        endpoint: EModelEndpoint.openAI,
        useResponsesApi: false,
      }),
    ).toBe(true);
  });

  it('disables search-preview toggles and latest o-series stop controls', () => {
    const searchCapabilities = getOpenAIModelCapabilities('gpt-4o-search-preview');
    const o4MiniCapabilities = getOpenAIModelCapabilities('o4-mini');

    expect(getOpenAISettingCapabilityState('web_search', searchCapabilities)).toEqual({
      supported: false,
      reason:
        'This search-preview model already handles search directly and does not use the web_search toggle.',
    });
    expect(getOpenAISettingCapabilityState('stop', searchCapabilities)).toEqual({
      supported: false,
      reason: 'This OpenAI model does not support stop sequences.',
    });
    expect(getOpenAISettingCapabilityState('stop', o4MiniCapabilities)).toEqual({
      supported: false,
      reason: 'This OpenAI model does not support stop sequences.',
    });
  });

  it.each([
    'gpt-4.1-mini',
    'gpt-4.1-nano',
    'gpt-4o',
    'gpt-5-nano',
    'gpt-5.1-chat',
    'gpt-5.2-chat',
    'gpt-5.3-chat',
    'gpt-5.4',
    'gpt-5.4-pro',
    'gpt-5.4-mini',
    'gpt-5.4-nano',
    'gpt-chat-latest',
  ])('enables OpenAI-native web search and streaming chat settings for %s', (model) => {
    const capabilities = getOpenAIModelCapabilities(model);

    expect(capabilities.providerFamily).toBe('openai');
    expect(capabilities.hasKnownCapabilities).toBe(true);
    expect(capabilities.isTextGenerationModel).toBe(true);
    expect(capabilities.supportsOpenAIResponsesApi).toBe(true);
    expect(capabilities.supportsWebSearch).toBe(true);
    expect(
      resolveOpenAIResponsesApiEnabled(capabilities, {
        endpoint: EModelEndpoint.azureOpenAI,
      }),
    ).toBe(true);
    expect(getOpenAISettingCapabilityState('disableStreaming', capabilities)).toEqual({
      supported: true,
    });
  });

  it.each([
    ['codex-mini', 'openai'],
    ['gpt-oss-120b', 'openai'],
    ['DeepSeek-V3.1', 'deepseek'],
    ['DeepSeek-V4-Flash', 'deepseek'],
    ['grok-4-20-reasoning', 'xai'],
    ['grok-4-1-fast-non-reasoning', 'xai'],
    ['grok-4-1-fast-reasoning', 'xai'],
    ['Phi-4', 'microsoft'],
    ['Phi-4-reasoning', 'microsoft'],
    ['Mistral-Large-3', 'mistral'],
  ] as const)(
    'keeps Azure-hosted %s on chat streaming settings without OpenAI-native web search',
    (model, providerFamily) => {
      const capabilities = getOpenAIModelCapabilities(model);

      expect(capabilities.providerFamily).toBe(providerFamily);
      expect(capabilities.hasKnownCapabilities).toBe(true);
      expect(capabilities.isTextGenerationModel).toBe(true);
      expect(capabilities.supportsOpenAIResponsesApi).toBe(false);
      expect(capabilities.supportsWebSearch).toBe(false);
      expect(
        resolveOpenAIResponsesApiEnabled(capabilities, {
          endpoint: EModelEndpoint.azureOpenAI,
          useResponsesApi: true,
        }),
      ).toBe(false);
      expect(getOpenAISettingCapabilityState('web_search', capabilities)).toEqual({
        supported: false,
        reason: 'This model does not support provider-native web search.',
      });
      expect(getOpenAISettingCapabilityState('disableStreaming', capabilities)).toEqual({
        supported: true,
      });
    },
  );

  it('marks embedding deployments as non-chat so streaming and tool toggles are not advertised', () => {
    const capabilities = getOpenAIModelCapabilities('text-embedding-3-small');

    expect(capabilities.providerFamily).toBe('embedding');
    expect(capabilities.hasKnownCapabilities).toBe(true);
    expect(capabilities.isTextGenerationModel).toBe(false);
    expect(capabilities.supportsOpenAIResponsesApi).toBe(false);
    expect(capabilities.supportsWebSearch).toBe(false);
    expect(getOpenAISettingCapabilityState('max_tokens', capabilities)).toEqual({
      supported: false,
      reason: 'This deployment is not a streaming chat model.',
    });
    expect(getOpenAISettingCapabilityState('web_search', capabilities)).toEqual({
      supported: false,
      reason: 'This deployment is not a streaming chat model.',
    });
  });
});
