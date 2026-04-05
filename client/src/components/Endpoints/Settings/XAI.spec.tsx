import React from 'react';
import { render, screen } from '@testing-library/react';
import XAISettings from './XAI';

jest.mock('librechat-data-provider', () => ({
  ...jest.requireActual('librechat-data-provider'),
  getSettingsKeys: jest.fn(() => ['xai', 'xai']),
  presetSettings: {
    xai: {
      col1: [{ key: 'model', component: 'dropdown', default: null }],
      col2: [
        {
          key: 'max_tokens',
          component: 'input',
          default: 0,
          description: 'com_endpoint_openai_max_output_tokens',
          descriptionCode: true,
        },
        {
          key: 'stop',
          component: 'input',
          default: '',
          description: 'com_endpoint_stop_sequences',
          descriptionCode: true,
        },
        {
          key: 'imageDetail',
          component: 'slider',
          default: 'auto',
          description: 'com_endpoint_image_detail',
          descriptionCode: true,
        },
        {
          key: 'reasoning_effort',
          component: 'slider',
          default: 'unset',
          description: 'com_endpoint_openai_reasoning_effort',
          descriptionCode: true,
        },
        {
          key: 'web_search',
          component: 'input',
          default: false,
          description: 'com_endpoint_openai_use_web_search',
          descriptionCode: true,
        },
      ],
    },
  },
}));

jest.mock('~/data-provider', () => ({
  useGetEndpointsQuery: jest.fn(() => ({
    data: {
      Grok: {
        customParams: {
          defaultParamsEndpoint: 'xai',
        },
      },
    },
  })),
  useGetStartupConfig: jest.fn(() => ({
    data: {
      xaiModelCapabilities: {
        Grok: {
          'grok-4-0709': {
            id: 'grok-4-0709',
            input_modalities: ['text', 'image'],
            output_modalities: ['text'],
            search_price: 2500,
          },
          'grok-4.20-multi-agent-beta-0309': {
            id: 'grok-4.20-multi-agent-beta-0309',
            input_modalities: ['text', 'image'],
            output_modalities: ['text'],
            search_price: 2500,
          },
          'grok-code-fast-1': {
            id: 'grok-code-fast-1',
            input_modalities: ['text'],
            output_modalities: ['text'],
            search_price: 0,
          },
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

describe('XAISettings', () => {
  test('renders xAI preset settings for custom xAI endpoints', () => {
    render(
      <XAISettings
        conversation={{ endpoint: 'Grok', model: 'grok-4-0709' } as any}
        setOption={() => () => undefined}
        models={['grok-4-0709']}
        readonly={false}
      />,
    );

    expect(screen.getByTestId('model')).toHaveTextContent('grok-4-0709');
    expect(screen.getByTestId('reasoning_effort')).toBeInTheDocument();
  });

  test('disables reasoning controls for models without xAI effort support', () => {
    render(
      <XAISettings
        conversation={{ endpoint: 'Grok', model: 'grok-4-0709' } as any}
        setOption={() => () => undefined}
        models={['grok-4-0709']}
        readonly={false}
      />,
    );

    expect(screen.getByTestId('reasoning_effort')).toHaveAttribute('data-readonly', 'true');
    expect(screen.getByTestId('reasoning_effort')).toHaveAttribute(
      'data-description',
      expect.stringContaining(
        'Only Grok 3 Mini and xAI multi-agent models currently support xAI reasoning effort controls.',
      ),
    );
    expect(screen.getByTestId('stop')).toHaveAttribute('data-readonly', 'true');
    expect(screen.getByTestId('imageDetail')).toHaveAttribute('data-readonly', 'false');
  });

  test('disables unsupported multi-agent and text-only controls', () => {
    const { rerender } = render(
      <XAISettings
        conversation={{ endpoint: 'Grok', model: 'grok-4.20-multi-agent-beta-0309' } as any}
        setOption={() => () => undefined}
        models={['grok-4.20-multi-agent-beta-0309', 'grok-code-fast-1']}
        readonly={false}
      />,
    );

    expect(screen.getByTestId('max_tokens')).toHaveAttribute('data-readonly', 'true');
    expect(screen.getByTestId('max_tokens')).toHaveAttribute(
      'data-description',
      expect.stringContaining('This xAI multi-agent model does not support output token limits.'),
    );

    rerender(
      <XAISettings
        conversation={{ endpoint: 'Grok', model: 'grok-code-fast-1' } as any}
        setOption={() => () => undefined}
        models={['grok-4.20-multi-agent-beta-0309', 'grok-code-fast-1']}
        readonly={false}
      />,
    );

    expect(screen.getByTestId('imageDetail')).toHaveAttribute('data-readonly', 'true');
    expect(screen.getByTestId('imageDetail')).toHaveAttribute(
      'data-description',
      expect.stringContaining('This model does not support image understanding input.'),
    );
    expect(screen.getByTestId('web_search')).toHaveAttribute('data-readonly', 'true');
    expect(screen.getByTestId('web_search')).toHaveAttribute(
      'data-description',
      expect.stringContaining('This xAI model does not support provider-native web search.'),
    );
  });
});
