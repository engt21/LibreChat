import type { TModelSpec } from 'librechat-data-provider';
import type { Endpoint } from '~/common';
import { isDeepResearchModelSpec, sortModelPickerEndpoints } from './utils';

describe('model picker utilities', () => {
  it('orders preferred providers before remaining endpoints', () => {
    const endpoints = [
      { value: 'custom', label: 'Custom' },
      { value: 'ollama', label: 'Ollama' },
      { value: 'google', label: 'Google' },
      { value: 'azureOpenAI', label: 'Azure OpenAI' },
      { value: 'xai', label: 'xAI' },
      { value: 'anthropic', label: 'Anthropic' },
      { value: 'openAI', label: 'OpenAI' },
    ] as Endpoint[];

    expect(sortModelPickerEndpoints(endpoints).map((endpoint) => endpoint.value)).toEqual([
      'openAI',
      'anthropic',
      'azureOpenAI',
      'google',
      'xai',
      'ollama',
      'custom',
    ]);
  });

  it('identifies deep research model specs for chat-bar migration', () => {
    expect(
      isDeepResearchModelSpec({
        name: 'OpenAI Deep Research',
        label: 'Deep Research (GPT)',
        preset: { endpoint: 'openAI' },
      } as TModelSpec),
    ).toBe(true);
    expect(
      isDeepResearchModelSpec({
        name: 'GPT Chat',
        label: 'GPT Chat',
        preset: { endpoint: 'openAI' },
      } as TModelSpec),
    ).toBe(false);
  });
});
