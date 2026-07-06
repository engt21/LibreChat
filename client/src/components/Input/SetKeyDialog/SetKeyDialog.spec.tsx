import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthKeys, EModelEndpoint, GoogleAuthMode } from 'librechat-data-provider';
import SetKeyDialog from './SetKeyDialog';

const mockUseUserKey = jest.fn();
const mockShowToast = jest.fn();

jest.mock('~/hooks', () => ({
  useUserKey: (...args: unknown[]) => mockUseUserKey(...args),
  useLocalize: () => (key: string) => key,
  useMultipleKeys: (setUserKey: React.Dispatch<React.SetStateAction<string>>) => ({
    getMultiKey: (name: string, userKey: string) => {
      try {
        return JSON.parse(userKey)?.[name] ?? '';
      } catch {
        return '';
      }
    },
    setMultiKey: (name: string, value: string, userKey: string) => {
      let nextValue = {} as Record<string, string>;

      try {
        nextValue = JSON.parse(userKey);
      } catch {
        nextValue = {};
      }

      nextValue[name] = value;
      setUserKey(JSON.stringify(nextValue));
    },
  }),
}));

jest.mock('librechat-data-provider/react-query', () => ({
  useRevokeUserKeyMutation: () => ({ mutate: jest.fn(), isLoading: false }),
  useRevokeAllUserKeysMutation: () => ({ mutate: jest.fn(), isLoading: false }),
}));

jest.mock('@librechat/client', () => {
  const React = require('react');

  return {
    Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
      <label {...props}>{children}</label>
    ),
    Input: React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
      (props, ref) => <input ref={ref} {...props} />,
    ),
    Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button {...props}>{children}</button>
    ),
    Spinner: () => <div data-testid="spinner" />,
    OGDialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Dropdown: ({
      label,
      value,
      onChange,
      options,
    }: {
      label: string;
      value: string;
      onChange: (value: string) => void;
      options: string[];
    }) => (
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    ),
    OGDialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    OGDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    OGDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    OGDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    OGDialogTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useToastContext: () => ({ showToast: mockShowToast }),
  };
});

jest.mock('~/components/Chat/Input/Files/FileUpload', () => () => (
  <div data-testid="google-service-key-upload" />
));

jest.mock('./HelpText', () => () => null);

describe('SetKeyDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseUserKey.mockReturnValue({
      getExpiry: () => 'never',
      getValue: () => '',
      saveUserKey: jest.fn(),
      isLoading: false,
    });
  });

  it('defaults provider key saves to never expire', async () => {
    const saveUserKey = jest.fn();
    mockUseUserKey.mockReturnValue({
      getExpiry: () => null,
      getValue: () => '',
      saveUserKey,
      isLoading: false,
    });

    render(
      <SetKeyDialog open={true} onOpenChange={jest.fn()} endpoint={EModelEndpoint.anthropic} />,
    );

    expect(screen.getByRole('combobox', { name: /Expires/i })).toHaveValue('never');

    fireEvent.change(screen.getByTestId('input-anthropic'), {
      target: { value: 'sk-ant-test' },
    });
    fireEvent.click(screen.getByText('com_ui_submit'));

    await waitFor(() => {
      expect(saveUserKey).toHaveBeenCalledWith('sk-ant-test', null, false);
    });
  });

  it('preloads saved OpenAI-style settings into the form fields', async () => {
    mockUseUserKey.mockReturnValue({
      getExpiry: () => 'never',
      getValue: () =>
        JSON.stringify({
          apiKey: 'saved-openai-key',
          baseURL: 'https://example.openai.azure.com/openai/v1',
          models: 'gpt-4o-mini,gpt-5-nano',
        }),
      saveUserKey: jest.fn(),
      isLoading: false,
    });

    render(
      <SetKeyDialog
        open={true}
        onOpenChange={jest.fn()}
        endpoint={EModelEndpoint.azureOpenAI}
        userProvideURL={true}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('input-apiKey')).toHaveValue('saved-openai-key');
    });

    expect(screen.getByTestId('input-apiKey')).toHaveAttribute('type', 'password');
    expect(screen.getByTestId('input-baseURL')).toHaveValue(
      'https://example.openai.azure.com/openai/v1',
    );
    expect(screen.getByTestId('input-models')).toHaveValue('gpt-4o-mini,gpt-5-nano');
  });

  it('allows saving an OpenAI API key without an optional base URL override', async () => {
    const saveUserKey = jest.fn();
    mockUseUserKey.mockReturnValue({
      getExpiry: () => null,
      getValue: () => '',
      saveUserKey,
      isLoading: false,
    });

    render(
      <SetKeyDialog
        open={true}
        onOpenChange={jest.fn()}
        endpoint={EModelEndpoint.openAI}
        userProvideURL={true}
      />,
    );

    fireEvent.change(screen.getByTestId('input-apiKey'), {
      target: { value: 'sk-openai-test' },
    });
    fireEvent.click(screen.getByText('com_ui_submit'));

    await waitFor(() => {
      expect(saveUserKey).toHaveBeenCalledWith(
        JSON.stringify({ apiKey: 'sk-openai-test' }),
        null,
        false,
      );
    });
  });

  it('allows clearing a saved OpenAI base URL without re-entering the key', async () => {
    const saveUserKey = jest.fn();
    mockUseUserKey.mockReturnValue({
      getExpiry: () => 'never',
      getValue: () =>
        JSON.stringify({
          apiKey: 'saved-openai-key',
          baseURL: 'https://us.api.openai.com/v1',
        }),
      saveUserKey,
      isLoading: false,
    });

    render(
      <SetKeyDialog
        open={true}
        onOpenChange={jest.fn()}
        endpoint={EModelEndpoint.openAI}
        userProvideURL={true}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('input-baseURL')).toHaveValue('https://us.api.openai.com/v1');
    });

    fireEvent.change(screen.getByTestId('input-apiKey'), { target: { value: '' } });
    fireEvent.change(screen.getByTestId('input-baseURL'), { target: { value: '' } });
    fireEvent.click(screen.getByText('com_ui_submit'));

    await waitFor(() => {
      expect(saveUserKey).toHaveBeenCalledWith(JSON.stringify({ baseURL: '' }), null, true);
    });
  });

  it('preloads saved Google settings and shows when a service key is already stored', async () => {
    mockUseUserKey.mockReturnValue({
      getExpiry: () => 'never',
      getValue: () =>
        JSON.stringify({
          [AuthKeys.GOOGLE_API_KEY]: 'saved-google-key',
          [AuthKeys.GOOGLE_SERVICE_KEY]: JSON.stringify({ client_email: 'test@example.com' }),
        }),
      saveUserKey: jest.fn(),
      isLoading: false,
    });

    render(<SetKeyDialog open={true} onOpenChange={jest.fn()} endpoint={EModelEndpoint.google} />);

    await waitFor(() => {
      expect(screen.getByTestId(`input-${AuthKeys.GOOGLE_API_KEY}`)).toHaveValue(
        'saved-google-key',
      );
    });

    expect(screen.getByTestId(`input-${AuthKeys.GOOGLE_API_KEY}`)).toHaveAttribute(
      'type',
      'password',
    );
    expect(screen.getByText('com_endpoint_config_key_import_json_key_success')).toBeInTheDocument();
  });

  it('preloads saved Google ADC settings into Vertex project and location fields', async () => {
    mockUseUserKey.mockReturnValue({
      getExpiry: () => 'never',
      getValue: () =>
        JSON.stringify({
          [AuthKeys.GOOGLE_AUTH_MODE]: GoogleAuthMode.VERTEX_APPLICATION_DEFAULT,
          [AuthKeys.GOOGLE_VERTEX_PROJECT]: 'vertex-project',
          [AuthKeys.GOOGLE_VERTEX_LOCATION]: 'europe-west1',
        }),
      saveUserKey: jest.fn(),
      isLoading: false,
    });

    render(<SetKeyDialog open={true} onOpenChange={jest.fn()} endpoint={EModelEndpoint.google} />);

    await waitFor(() => {
      expect(screen.getByLabelText('com_endpoint_config_google_auth_mode')).toHaveValue(
        'com_endpoint_config_google_auth_adc',
      );
    });

    expect(screen.queryByTestId(`input-${AuthKeys.GOOGLE_API_KEY}`)).not.toBeInTheDocument();
    expect(screen.getByTestId(`input-${AuthKeys.GOOGLE_VERTEX_PROJECT}`)).toHaveValue(
      'vertex-project',
    );
    expect(screen.getByTestId(`input-${AuthKeys.GOOGLE_VERTEX_LOCATION}`)).toHaveValue(
      'europe-west1',
    );
  });

  it('preloads saved single-key providers into a masked input', async () => {
    mockUseUserKey.mockReturnValue({
      getExpiry: () => 'never',
      getValue: () => 'saved-anthropic-key',
      saveUserKey: jest.fn(),
      isLoading: false,
    });

    render(
      <SetKeyDialog open={true} onOpenChange={jest.fn()} endpoint={EModelEndpoint.anthropic} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('input-anthropic')).toHaveValue('saved-anthropic-key');
    });

    expect(screen.getByTestId('input-anthropic')).toHaveAttribute('type', 'password');
  });

  it('hydrates legacy top-level Azure saved payload into editable fields', async () => {
    mockUseUserKey.mockReturnValue({
      getExpiry: () => 'never',
      getValue: () =>
        JSON.stringify({
          azureOpenAIApiKey: 'legacy-azure-key',
          azureOpenAIApiInstanceName: 'example-instance',
          azureOpenAIApiDeploymentName: 'gpt-4.1-prod',
          azureOpenAIApiVersion: '2024-10-21',
        }),
      saveUserKey: jest.fn(),
      isLoading: false,
    });

    render(
      <SetKeyDialog
        open={true}
        onOpenChange={jest.fn()}
        endpoint={EModelEndpoint.azureOpenAI}
        userProvideURL={true}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('input-apiKey')).toHaveValue('legacy-azure-key');
    });

    // Bare root URL – not normalised to /openai/v1 – so re-saving preserves the
    // legacy URL shape that the backend needs for api-version model probes.
    expect(screen.getByTestId('input-baseURL')).toHaveValue(
      'https://example-instance.openai.azure.com',
    );
    expect(screen.getByTestId('input-models')).toHaveValue('gpt-4.1-prod');
  });

  it('hydrates legacy Azure payload with full domain instanceName', async () => {
    mockUseUserKey.mockReturnValue({
      getExpiry: () => 'never',
      getValue: () =>
        JSON.stringify({
          azureOpenAIApiKey: 'legacy-key',
          azureOpenAIApiInstanceName: 'my-instance.cognitiveservices.azure.com',
          azureOpenAIApiDeploymentName: 'dep',
          azureOpenAIApiVersion: '2024-10-21',
        }),
      saveUserKey: jest.fn(),
      isLoading: false,
    });

    render(
      <SetKeyDialog
        open={true}
        onOpenChange={jest.fn()}
        endpoint={EModelEndpoint.azureOpenAI}
        userProvideURL={true}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('input-apiKey')).toHaveValue('legacy-key');
    });

    // Bare root URL – matches server-side getAzureInstanceBaseURL behavior.
    expect(screen.getByTestId('input-baseURL')).toHaveValue(
      'https://my-instance.cognitiveservices.azure.com',
    );
  });

  it('hydrates nested JSON-in-apiKey legacy Azure payload', async () => {
    const nestedLegacy = JSON.stringify({
      azureOpenAIApiKey: 'nested-key',
      azureOpenAIApiInstanceName: 'nested-instance',
      azureOpenAIApiDeploymentName: 'gpt-4o',
      azureOpenAIApiVersion: '2024-10-21',
    });

    mockUseUserKey.mockReturnValue({
      getExpiry: () => 'never',
      getValue: () => JSON.stringify({ apiKey: nestedLegacy }),
      saveUserKey: jest.fn(),
      isLoading: false,
    });

    render(
      <SetKeyDialog
        open={true}
        onOpenChange={jest.fn()}
        endpoint={EModelEndpoint.azureOpenAI}
        userProvideURL={true}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('input-apiKey')).toHaveValue('nested-key');
    });

    // Bare root URL – not normalised to /openai/v1.
    expect(screen.getByTestId('input-baseURL')).toHaveValue(
      'https://nested-instance.openai.azure.com',
    );
    expect(screen.getByTestId('input-models')).toHaveValue('gpt-4o');
  });

  it('keeps outer baseURL and models when nested legacy only provides apiKey', async () => {
    const nestedLegacy = JSON.stringify({
      azureOpenAIApiKey: 'nested-only-key',
    });

    mockUseUserKey.mockReturnValue({
      getExpiry: () => 'never',
      getValue: () =>
        JSON.stringify({
          apiKey: nestedLegacy,
          baseURL: 'https://explicit-base.openai.azure.com/openai/v1',
          models: 'explicit-dep',
        }),
      saveUserKey: jest.fn(),
      isLoading: false,
    });

    render(
      <SetKeyDialog
        open={true}
        onOpenChange={jest.fn()}
        endpoint={EModelEndpoint.azureOpenAI}
        userProvideURL={true}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('input-apiKey')).toHaveValue('nested-only-key');
    });

    expect(screen.getByTestId('input-baseURL')).toHaveValue(
      'https://explicit-base.openai.azure.com/openai/v1',
    );
    expect(screen.getByTestId('input-models')).toHaveValue('explicit-dep');
  });
});
