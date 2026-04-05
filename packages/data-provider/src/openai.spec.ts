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
});
