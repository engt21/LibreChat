import React from 'react';
import { render, screen } from '@testing-library/react';
import GoogleSettings from './Google';

jest.mock('librechat-data-provider', () => ({
  ...jest.requireActual('librechat-data-provider'),
  getSettingsKeys: jest.fn(() => ['google', 'google']),
  presetSettings: {
    google: {
      col1: [{ key: 'model', component: 'dropdown', default: null }],
      col2: [
        {
          key: 'web_search',
          component: 'switch',
          default: false,
          description: 'com_endpoint_google_use_search_grounding',
          descriptionCode: true,
        },
        {
          key: 'thinkingBudget',
          component: 'input',
          default: -1,
          description: 'com_endpoint_google_thinking_budget',
          descriptionCode: true,
        },
        {
          key: 'thinkingLevel',
          component: 'slider',
          default: '',
          description: 'com_endpoint_google_thinking_level',
          descriptionCode: true,
        },
      ],
    },
  },
}));

jest.mock('~/data-provider', () => ({
  useGetEndpointsQuery: jest.fn(() => ({
    data: {
      google: {},
    },
  })),
  useGetStartupConfig: jest.fn(() => ({
    data: {
      googleModelCapabilities: {
        'gemini-3.1-pro-preview': {
          name: 'gemini-3.1-pro-preview',
          supportedGenerationMethods: ['generateContent'],
          thinking: true,
        },
        'gemma-3-27b-it': {
          name: 'gemma-3-27b-it',
          supportedGenerationMethods: ['generateContent'],
        },
      },
    },
  })),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('~/components/SidePanel/Parameters/components', () => ({
  componentMapping: {
    dropdown: ({
      settingKey,
      options,
      readonly,
    }: {
      settingKey: string;
      options?: string[];
      readonly?: boolean;
    }) => (
      <div data-testid={settingKey} data-readonly={readonly}>
        {options?.join(',')}
      </div>
    ),
    switch: ({
      settingKey,
      readonly,
      description,
    }: {
      settingKey: string;
      readonly?: boolean;
      description?: string;
    }) => (
      <div data-testid={settingKey} data-readonly={readonly} data-description={description}>
        switch
      </div>
    ),
    input: ({
      settingKey,
      readonly,
      description,
    }: {
      settingKey: string;
      readonly?: boolean;
      description?: string;
    }) => (
      <div data-testid={settingKey} data-readonly={readonly} data-description={description}>
        input
      </div>
    ),
    slider: ({
      settingKey,
      readonly,
      description,
    }: {
      settingKey: string;
      readonly?: boolean;
      description?: string;
    }) => (
      <div data-testid={settingKey} data-readonly={readonly} data-description={description}>
        slider
      </div>
    ),
  },
}));

describe('GoogleSettings', () => {
  test('renders the google web search setting from preset settings', () => {
    render(
      <GoogleSettings
        conversation={{ endpoint: 'google', model: 'gemini-2.5-flash' } as any}
        setOption={() => () => undefined}
        models={['gemini-2.5-flash']}
        readonly={false}
      />,
    );

    expect(screen.getByTestId('model')).toHaveTextContent('gemini-2.5-flash');
    expect(screen.getByTestId('web_search')).toBeInTheDocument();
  });

  test('disables unsupported settings for Gemma models', () => {
    render(
      <GoogleSettings
        conversation={{ endpoint: 'google', model: 'gemma-3-27b-it' } as any}
        setOption={() => () => undefined}
        models={['gemma-3-27b-it']}
        readonly={false}
      />,
    );

    expect(screen.getByTestId('web_search')).toHaveAttribute('data-readonly', 'true');
    expect(screen.getByTestId('web_search')).toHaveAttribute(
      'data-description',
      expect.stringContaining('This model does not support Google Search grounding in LibreChat.'),
    );
    expect(screen.getByTestId('thinkingBudget')).toHaveAttribute('data-readonly', 'true');
    expect(screen.getByTestId('thinkingLevel')).toHaveAttribute('data-readonly', 'true');
  });

  test('uses thinking level instead of thinking budget for Gemini 3-style models', () => {
    render(
      <GoogleSettings
        conversation={{ endpoint: 'google', model: 'gemini-3.1-pro-preview' } as any}
        setOption={() => () => undefined}
        models={['gemini-3.1-pro-preview']}
        readonly={false}
      />,
    );

    expect(screen.getByTestId('thinkingLevel')).toHaveAttribute('data-readonly', 'false');
    expect(screen.getByTestId('thinkingBudget')).toHaveAttribute('data-readonly', 'true');
    expect(screen.getByTestId('thinkingBudget')).toHaveAttribute(
      'data-description',
      expect.stringContaining('This model uses Thinking Level instead of Thinking Budget.'),
    );
  });
});
