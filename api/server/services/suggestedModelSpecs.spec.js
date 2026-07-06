const { EModelEndpoint } = require('librechat-data-provider');
const {
  applyDynamicSuggestedModelSpecs,
  getSuggestedModelsForEndpoint,
} = require('./suggestedModelSpecs');

describe('suggested model specs', () => {
  const specsConfig = {
    enforce: false,
    prioritize: true,
    list: [
      {
        name: 'GPT-5.4 Mini',
        label: 'GPT-5.4 Mini',
        description: 'Fast, affordable OpenAI model',
        group: EModelEndpoint.openAI,
        preset: { endpoint: EModelEndpoint.openAI, model: 'gpt-5.4-mini' },
      },
      {
        name: 'GPT-5.4 Nano',
        label: 'GPT-5.4 Nano',
        description: 'Lightweight OpenAI model',
        group: EModelEndpoint.openAI,
        preset: { endpoint: EModelEndpoint.openAI, model: 'gpt-5.4-nano' },
      },
      {
        name: 'GPT-5.3 Chat',
        label: 'GPT-5.3 Chat',
        description: 'OpenAI conversational model',
        group: EModelEndpoint.openAI,
        preset: { endpoint: EModelEndpoint.openAI, model: 'gpt-5.3-chat-latest' },
      },
      {
        name: 'Claude Sonnet 4.6',
        label: 'Claude Sonnet 4.6',
        description: 'Latest Anthropic Sonnet',
        group: EModelEndpoint.anthropic,
        preset: { endpoint: EModelEndpoint.anthropic, model: 'claude-sonnet-4-6' },
      },
      {
        name: 'Claude Sonnet 4.5',
        label: 'Claude Sonnet 4.5',
        description: 'Anthropic balanced model',
        group: EModelEndpoint.anthropic,
        preset: { endpoint: EModelEndpoint.anthropic, model: 'claude-sonnet-4-5' },
      },
      {
        name: 'Claude Haiku 4.5',
        label: 'Claude Haiku 4.5',
        description: 'Fast Anthropic model',
        group: EModelEndpoint.anthropic,
        preset: { endpoint: EModelEndpoint.anthropic, model: 'claude-haiku-4-5' },
      },
    ],
  };

  it('chooses chat-latest, latest full, and latest mini OpenAI suggestions', () => {
    expect(
      getSuggestedModelsForEndpoint(
        EModelEndpoint.openAI,
        [
          'chat-latest',
          'gpt-5.5-pro',
          'gpt-5.5',
          'gpt-5.5-alpha',
          'gpt-5.5-mini',
          'gpt-4-1106-preview',
          'gpt-3.5-turbo-0125',
          'gpt-5.4-thinking',
          'gpt-5.4',
          'gpt-5.4-mini',
          'gpt-5.4-nano',
          'gpt-5.1-codex',
          'gpt-5.1',
        ],
        3,
      ),
    ).toEqual(['chat-latest', 'gpt-5.5', 'gpt-5.5-mini']);
  });

  it('uses versioned chat-latest as the top OpenAI suggestion when the short alias is absent', () => {
    expect(
      getSuggestedModelsForEndpoint(
        EModelEndpoint.openAI,
        [
          'gpt-5.5',
          'gpt-5.5-mini',
          'gpt-5.5-chat-latest',
          'gpt-5.4-mini',
          'gpt-5.4-chat-latest',
          'gpt-5.3-chat-latest',
          'gpt-5.2-chat-latest',
          'gpt-5.4-nano',
        ],
        3,
      ),
    ).toEqual(['gpt-5.5-chat-latest', 'gpt-5.5', 'gpt-5.5-mini']);
  });

  it('prefers gpt-chat-latest over versioned chat-latest models', () => {
    expect(
      getSuggestedModelsForEndpoint(
        EModelEndpoint.openAI,
        ['gpt-5.6-chat-latest', 'gpt-5.5', 'gpt-chat-latest', 'gpt-5.5-mini'],
        3,
      ),
    ).toEqual(['gpt-chat-latest', 'gpt-5.5', 'gpt-5.5-mini']);
  });

  it('prefers chat-latest over gpt-chat-latest and versioned chat-latest models', () => {
    expect(
      getSuggestedModelsForEndpoint(
        EModelEndpoint.openAI,
        ['gpt-5.6-chat-latest', 'gpt-chat-latest', 'gpt-5.5', 'chat-latest', 'gpt-5.5-mini'],
        3,
      ),
    ).toEqual(['chat-latest', 'gpt-5.5', 'gpt-5.5-mini']);
  });

  it('uses the OpenAI suggestion policy for Azure OpenAI models', () => {
    expect(
      getSuggestedModelsForEndpoint(
        EModelEndpoint.azureOpenAI,
        ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-chat-latest', 'gpt-4.1'],
        3,
      ),
    ).toEqual(['gpt-5.3-chat-latest', 'gpt-5.4', 'gpt-5.4-mini']);
  });

  it('updates simple OpenAI and Anthropic quick-selector specs from the current model catalog', () => {
    const result = applyDynamicSuggestedModelSpecs(specsConfig, {
      [EModelEndpoint.openAI]: [
        'gpt-5.3-chat-latest',
        'gpt-5.5-pro',
        'gpt-5.5',
        'gpt-5.4',
        'gpt-5.4-mini',
        'gpt-5.4-nano',
      ],
      [EModelEndpoint.anthropic]: [
        'claude-sonnet-4-6',
        'claude-opus-4-7',
        'claude-opus-4-6',
        'claude-haiku-4-5',
      ],
    });

    expect(result.list.map((spec) => spec.preset.model)).toEqual([
      'gpt-5.3-chat-latest',
      'gpt-5.5',
      'gpt-5.4-mini',
      'claude-sonnet-4-6',
      'claude-opus-4-7',
    ]);
    expect(result.list.map((spec) => spec.label)).toEqual([
      'Chat Latest',
      'GPT-5.5',
      'GPT-5.4 Mini',
      'Claude Sonnet 4.6',
      'Claude Opus 4.7',
    ]);
  });

  it('keeps three OpenAI suggestions, Sonnet and Opus for Anthropic, and one for others', () => {
    const result = applyDynamicSuggestedModelSpecs(
      {
        enforce: false,
        prioritize: true,
        list: [
          ...specsConfig.list,
          {
            name: 'Gemini Pro',
            label: 'Gemini Pro',
            description: 'Google model',
            group: EModelEndpoint.google,
            preset: { endpoint: EModelEndpoint.google, model: 'gemini-2.5-pro' },
          },
          {
            name: 'Gemini Flash',
            label: 'Gemini Flash',
            description: 'Google model',
            group: EModelEndpoint.google,
            preset: { endpoint: EModelEndpoint.google, model: 'gemini-2.5-flash' },
          },
          {
            name: 'Grok',
            label: 'Grok',
            description: 'xAI model',
            group: 'xai',
            preset: { endpoint: 'xai', model: 'grok-4' },
          },
        ],
      },
      {
        [EModelEndpoint.openAI]: ['gpt-chat-latest', 'gpt-5.5', 'gpt-5.5-mini'],
        [EModelEndpoint.anthropic]: ['claude-sonnet-4-6', 'claude-opus-4-7'],
        [EModelEndpoint.google]: ['gemini-3.0-pro', 'gemini-2.5-flash'],
        xai: ['grok-4.20-beta-latest-non-reasoning', 'grok-4'],
      },
    );

    expect(result.list.map((spec) => spec.preset.model)).toEqual([
      'gpt-chat-latest',
      'gpt-5.5',
      'gpt-5.5-mini',
      'claude-sonnet-4-6',
      'claude-opus-4-7',
      'gemini-3.0-pro',
      'grok-4.20-beta-latest-non-reasoning',
    ]);
  });

  it('does not rewrite custom model specs that carry behavior beyond a simple provider shortcut', () => {
    const customSpec = {
      name: 'OpenAI with tools',
      label: 'OpenAI with tools',
      group: EModelEndpoint.openAI,
      webSearch: true,
      preset: { endpoint: EModelEndpoint.openAI, model: 'gpt-5.4-mini' },
    };

    const result = applyDynamicSuggestedModelSpecs(
      { ...specsConfig, list: [customSpec] },
      { [EModelEndpoint.openAI]: ['gpt-5.5'] },
    );

    expect(result.list[0]).toEqual(customSpec);
  });

  it('removes surplus simple suggestions when a refreshed key exposes fewer models', () => {
    const result = applyDynamicSuggestedModelSpecs(specsConfig, {
      [EModelEndpoint.openAI]: ['gpt-5.4-mini'],
      [EModelEndpoint.anthropic]: ['claude-sonnet-4-6'],
    });

    expect(result.list.map((spec) => spec.preset.model)).toEqual([
      'gpt-5.4-mini',
      'claude-sonnet-4-6',
    ]);
  });
});
