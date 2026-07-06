import { render, screen } from '@testing-library/react';
import type { Endpoint, SelectedValues } from '~/common';
import { SearchResults } from '../SearchResults';

const mockHandleOpenKeyDialog = jest.fn();
const mockHandleSelectSpec = jest.fn();
const mockHandleSelectModel = jest.fn();
const mockHandleSelectEndpoint = jest.fn();
let mockSelectedValues: SelectedValues;
let mockIsSuperAdmin = false;

jest.mock('~/components/Chat/Menus/Endpoints/ModelSelectorContext', () => ({
  useModelSelectorContext: () => ({
    selectedValues: mockSelectedValues,
    handleSelectSpec: mockHandleSelectSpec,
    handleSelectModel: mockHandleSelectModel,
    handleSelectEndpoint: mockHandleSelectEndpoint,
    handleOpenKeyDialog: mockHandleOpenKeyDialog,
    endpointsConfig: {},
    isSuperAdmin: mockIsSuperAdmin,
  }),
}));

jest.mock('~/components/Chat/Menus/Endpoints/CustomMenu', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    CustomMenuItem: React.forwardRef(function MockMenuItem(
      { children, ...rest }: { children?: React.ReactNode },
      ref: React.Ref<HTMLDivElement>,
    ) {
      return React.createElement('div', { ref, role: 'menuitem', ...rest }, children);
    }),
  };
});

jest.mock('../SpecIcon', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    __esModule: true,
    default: () => React.createElement('span', null, 'icon'),
  };
});

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

const localize = (key: string) =>
  key === 'com_endpoint_openai_alpha_models' ? 'OpenAI alpha' : key;

const anthropicEndpoint: Endpoint = {
  value: 'anthropic',
  label: 'Anthropic',
  hasModels: true,
  models: [{ name: 'claude-opus-4-6' }, { name: 'claude-sonnet-4-5' }],
  icon: null,
};

const noModelsEndpoint: Endpoint = {
  value: 'custom',
  label: 'Custom',
  hasModels: false,
  icon: null,
};

const agentsEndpoint: Endpoint = {
  value: 'agents',
  label: 'My Agents',
  hasModels: true,
  models: [{ name: 'agent-1' }],
  agentNames: { 'agent-1': 'Agent One' },
  icon: null,
};

const openAIEndpoint: Endpoint = {
  value: 'openAI',
  label: 'OpenAI',
  hasModels: true,
  models: [{ name: 'chat-latest' }, { name: 'gpt-5.6-alpha' }],
  icon: null,
};

describe('SearchResults', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsSuperAdmin = false;
  });

  it('marks model as selected when endpoint and model match with no active spec', () => {
    mockSelectedValues = { endpoint: 'anthropic', model: 'claude-opus-4-6', modelSpec: '' };
    render(
      <SearchResults results={[anthropicEndpoint]} localize={localize} searchValue="claude" />,
    );

    const items = screen.getAllByRole('menuitem');
    const selectedItem = items.find((el) => el.getAttribute('aria-selected') === 'true');
    expect(selectedItem).toBeDefined();
    expect(selectedItem).toHaveTextContent('claude-opus-4-6');
  });

  it('does not mark model as selected when a spec is active', () => {
    mockSelectedValues = {
      endpoint: 'anthropic',
      model: 'claude-opus-4-6',
      modelSpec: 'my-spec',
    };
    render(
      <SearchResults results={[anthropicEndpoint]} localize={localize} searchValue="claude" />,
    );

    const items = screen.getAllByRole('menuitem');
    for (const item of items) {
      expect(item).not.toHaveAttribute('aria-selected');
    }
  });

  it('does not mark endpoint as selected when a spec is active', () => {
    mockSelectedValues = {
      endpoint: 'custom',
      model: '',
      modelSpec: 'my-spec',
    };
    render(<SearchResults results={[noModelsEndpoint]} localize={localize} searchValue="custom" />);

    const item = screen.getByRole('menuitem');
    expect(item).not.toHaveAttribute('aria-selected');
  });

  it('marks endpoint as selected when no spec is active and endpoint matches', () => {
    mockSelectedValues = { endpoint: 'custom', model: '', modelSpec: '' };
    render(<SearchResults results={[noModelsEndpoint]} localize={localize} searchValue="custom" />);

    const item = screen.getByRole('menuitem');
    expect(item).toHaveAttribute('aria-selected', 'true');
  });

  it('renders settings buttons for model search results only for super admins', () => {
    mockIsSuperAdmin = true;
    mockSelectedValues = { endpoint: 'anthropic', model: '', modelSpec: '' };

    const { rerender } = render(
      <SearchResults results={[anthropicEndpoint]} localize={localize} searchValue="claude" />,
    );

    expect(screen.getAllByRole('button', { name: 'com_endpoint_config_key Anthropic' })).toHaveLength(1);

    mockIsSuperAdmin = false;
    rerender(
      <SearchResults results={[anthropicEndpoint]} localize={localize} searchValue="claude" />,
    );

    expect(screen.queryByRole('button', { name: 'com_endpoint_config_key Anthropic' })).not.toBeInTheDocument();
  });

  it('renders a settings button for endpoint search results with no models for super admins', () => {
    mockIsSuperAdmin = true;
    mockSelectedValues = { endpoint: 'custom', model: '', modelSpec: '' };

    render(<SearchResults results={[noModelsEndpoint]} localize={localize} searchValue="custom" />);

    expect(screen.getByRole('button', { name: 'com_endpoint_config_key Custom' })).toBeInTheDocument();
  });

  it('does not render My Agents in model search results', () => {
    mockIsSuperAdmin = true;
    mockSelectedValues = { endpoint: 'agents', model: 'agent-1', modelSpec: '' };

    render(<SearchResults results={[agentsEndpoint]} localize={localize} searchValue="agent" />);

    expect(screen.queryByText('My Agents')).not.toBeInTheDocument();
    expect(screen.queryByText('Agent One')).not.toBeInTheDocument();
  });

  it('labels OpenAI alpha matches separately in search results', () => {
    mockSelectedValues = { endpoint: 'openAI', model: '', modelSpec: '' };

    render(<SearchResults results={[openAIEndpoint]} localize={localize} searchValue="gpt" />);

    expect(screen.getByText('OpenAI')).toBeInTheDocument();
    expect(screen.getByText('OpenAI alpha')).toBeInTheDocument();
    expect(screen.getByText('gpt-5.6-alpha')).toBeInTheDocument();
  });
});
