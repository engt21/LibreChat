import React from 'react';
import { render, screen } from '@testing-library/react';
import OpenAISettings from './OpenAI';

jest.mock('librechat-data-provider', () => ({
  ...jest.requireActual('librechat-data-provider'),
  getSettingsKeys: jest.fn(() => ['openAI', 'openAI']),
  presetSettings: {
    openAI: {
      col1: [{ key: 'model', component: 'dropdown', default: null }],
      col2: [
        {
          key: 'temperature',
          component: 'slider',
          default: 1,
          description: 'com_endpoint_temperature',
          descriptionCode: true,
        },
        {
          key: 'reasoning_effort',
          component: 'slider',
          default: '',
          description: 'com_endpoint_openai_reasoning_effort',
          descriptionCode: true,
          enumMappings: {
            '': 'com_ui_auto',
            none: 'com_ui_none',
            minimal: 'com_ui_minimal',
            low: 'com_ui_low',
            medium: 'com_ui_medium',
            high: 'com_ui_high',
            xhigh: 'com_ui_xhigh',
          },
        },
        {
          key: 'verbosity',
          component: 'slider',
          default: '',
          description: 'com_endpoint_openai_verbosity',
          descriptionCode: true,
        },
        {
          key: 'web_search',
          component: 'switch',
          default: false,
          description: 'com_endpoint_openai_use_web_search',
          descriptionCode: true,
        },
        {
          key: 'stop',
          component: 'input',
          default: '',
          description: 'com_endpoint_stop_sequences',
          descriptionCode: true,
        },
      ],
    },
  },
}));

jest.mock('~/data-provider', () => ({
  useGetEndpointsQuery: jest.fn(() => ({
    data: {
      openAI: {},
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
      options,
    }: {
      settingKey: string;
      readonly?: boolean;
      description?: string;
      options?: string[];
    }) => (
      <div
        data-testid={settingKey}
        data-readonly={readonly}
        data-description={description}
        data-options={options?.join(',')}
      >
        slider
      </div>
    ),
  },
}));

describe('OpenAISettings', () => {
  test('uses model-specific reasoning effort options for GPT-5 families', () => {
    render(
      <OpenAISettings
        conversation={{ endpoint: 'openAI', model: 'gpt-5' } as any}
        setOption={() => () => undefined}
        models={['gpt-5']}
        readonly={false}
      />,
    );

    expect(screen.getByTestId('reasoning_effort')).toHaveAttribute(
      'data-options',
      ',minimal,low,medium,high',
    );
  });

  test('disables GPT-5.1 sampling controls when reasoning is enabled', () => {
    render(
      <OpenAISettings
        conversation={
          {
            endpoint: 'openAI',
            model: 'gpt-5.1',
            reasoning_effort: 'high',
          } as any
        }
        setOption={() => () => undefined}
        models={['gpt-5.1']}
        readonly={false}
      />,
    );

    expect(screen.getByTestId('temperature')).toHaveAttribute('data-readonly', 'true');
    expect(screen.getByTestId('temperature')).toHaveAttribute(
      'data-description',
      expect.stringContaining('Set reasoning effort to None to adjust sampling controls'),
    );
  });

  test('requires the Responses API for GPT-5 verbosity controls', () => {
    const { rerender } = render(
      <OpenAISettings
        conversation={{ endpoint: 'openAI', model: 'gpt-5.1', useResponsesApi: false } as any}
        setOption={() => () => undefined}
        models={['gpt-5.1']}
        readonly={false}
      />,
    );

    expect(screen.getByTestId('verbosity')).toHaveAttribute('data-readonly', 'true');
    expect(screen.getByTestId('verbosity')).toHaveAttribute(
      'data-description',
      expect.stringContaining('Enable the Responses API to configure verbosity for this model.'),
    );

    rerender(
      <OpenAISettings
        conversation={{ endpoint: 'openAI', model: 'gpt-5.1', useResponsesApi: true } as any}
        setOption={() => () => undefined}
        models={['gpt-5.1']}
        readonly={false}
      />,
    );

    expect(screen.getByTestId('verbosity')).toHaveAttribute('data-readonly', 'false');
  });

  test('auto-enables Responses API for GPT-5.1 on openAI endpoint', () => {
    render(
      <OpenAISettings
        conversation={{ endpoint: 'openAI', model: 'gpt-5.1' } as any}
        setOption={() => () => undefined}
        models={['gpt-5.1']}
        readonly={false}
      />,
    );

    expect(screen.getByTestId('verbosity')).toHaveAttribute('data-readonly', 'false');
  });

  test('disables search-preview and latest o-series specific controls', () => {
    const { rerender } = render(
      <OpenAISettings
        conversation={{ endpoint: 'openAI', model: 'gpt-4o-search-preview' } as any}
        setOption={() => () => undefined}
        models={['gpt-4o-search-preview', 'o4-mini']}
        readonly={false}
      />,
    );

    expect(screen.getByTestId('web_search')).toHaveAttribute('data-readonly', 'true');
    expect(screen.getByTestId('web_search')).toHaveAttribute(
      'data-description',
      expect.stringContaining('search-preview model already handles search directly'),
    );

    rerender(
      <OpenAISettings
        conversation={{ endpoint: 'openAI', model: 'o4-mini' } as any}
        setOption={() => () => undefined}
        models={['gpt-4o-search-preview', 'o4-mini']}
        readonly={false}
      />,
    );

    expect(screen.getByTestId('stop')).toHaveAttribute('data-readonly', 'true');
    expect(screen.getByTestId('stop')).toHaveAttribute(
      'data-description',
      expect.stringContaining('This OpenAI model does not support stop sequences.'),
    );
  });
});
