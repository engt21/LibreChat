import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryKeys } from 'librechat-data-provider';
import EditPresetDialog from './EditPresetDialog';

const mockSetPreset = jest.fn();
const mockSetOptionValue = jest.fn();
const mockSetOptions = jest.fn();

let mockPreset = {
  presetId: 'preset-1',
  endpoint: 'openAI',
  endpointType: 'openAI',
  model: 'gpt-5.5',
  title: 'GPT 5.5 preset',
};

jest.mock('recoil', () => ({
  useRecoilState: jest.fn(() => [true, jest.fn()]),
}));

jest.mock('librechat-data-provider', () => ({
  QueryKeys: {
    models: 'models',
    endpoints: 'endpoints',
  },
  isAgentsEndpoint: jest.fn(() => false),
}));

jest.mock('@librechat/client', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Label: (props: React.LabelHTMLAttributes<HTMLLabelElement>) => <label {...props} />,
  OGDialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
  OGDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  OGDialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  SelectDropDown: ({ value, setValue }: { value: string; setValue: (value: string) => void }) => (
    <button type="button" data-testid="endpoint-select" onClick={() => setValue('xai')}>
      {value}
    </button>
  ),
}));

jest.mock('~/utils', () => ({
  cn: (...classes: string[]) => classes.filter(Boolean).join(' '),
  defaultTextProps: '',
  removeFocusOutlines: '',
  mapEndpoints: (endpoints: string[]) => endpoints,
  getConvoSwitchLogic: jest.fn(() => ({ newEndpointType: 'custom' })),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, string>) =>
    values?.title ? `${key}:${values.title}` : key,
  useDebouncedInput: ({ initialValue }: { initialValue?: string }) => [jest.fn(), initialValue],
  flushDebouncedInputs: jest.fn(),
  useSetIndexOptions: jest.fn(() => ({
    setOption: (key: string) => (value: string) => mockSetOptionValue(key, value),
    setOptions: mockSetOptions,
  })),
}));

jest.mock('~/components/Chat/Input/PopoverButtons', () => () => null);
jest.mock('~/components/Endpoints', () => ({
  EndpointSettings: () => null,
}));
jest.mock('~/data-provider', () => ({
  useGetEndpointsQuery: jest.fn(() => ({ data: ['openAI', 'xai'] })),
}));
jest.mock('~/Providers', () => ({
  useChatContext: () => ({
    preset: mockPreset,
    setPreset: mockSetPreset,
  }),
}));
jest.mock('~/store', () => ({
  __esModule: true,
  default: {
    presetModalVisible: {},
  },
}));

function renderDialog(modelsConfig: Record<string, string[]>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, cacheTime: 0 } },
  });
  queryClient.setQueryData([QueryKeys.models], modelsConfig);
  queryClient.setQueryData([QueryKeys.endpoints], {
    openAI: { type: 'openAI' },
    xai: { type: 'custom' },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <EditPresetDialog exportPreset={jest.fn()} submitPreset={jest.fn()} />
    </QueryClientProvider>,
  );
}

describe('EditPresetDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPreset = {
      presetId: 'preset-1',
      endpoint: 'openAI',
      endpointType: 'openAI',
      model: 'gpt-5.5',
      title: 'GPT 5.5 preset',
    };
  });

  it('does not replace a non-empty preset model just because the local models cache is stale', () => {
    renderDialog({ openAI: ['gpt-5.4'] });

    expect(mockSetOptionValue).not.toHaveBeenCalledWith('model', 'gpt-5.4');
  });

  it('selects the first synced model when switching preset providers', () => {
    mockPreset = {
      ...mockPreset,
      model: 'gpt-5.4',
    };

    renderDialog({ openAI: ['gpt-5.4'], xai: ['grok-4-1-fast'] });
    fireEvent.click(screen.getByTestId('endpoint-select'));

    expect(mockSetOptions).toHaveBeenCalledWith({
      endpoint: 'xai',
      endpointType: 'custom',
      model: 'grok-4-1-fast',
    });
  });
});
