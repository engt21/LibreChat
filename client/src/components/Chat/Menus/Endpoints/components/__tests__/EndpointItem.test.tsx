import { render, screen } from '@testing-library/react';
import type { Endpoint, SelectedValues } from '~/common';
import { EndpointItem } from '../EndpointItem';

const mockHandleOpenKeyDialog = jest.fn();
const mockHandleSelectEndpoint = jest.fn();
let mockSelectedValues: SelectedValues;
let mockIsSuperAdmin = false;

jest.mock('~/components/Chat/Menus/Endpoints/ModelSelectorContext', () => ({
  useModelSelectorContext: () => ({
    selectedValues: mockSelectedValues,
    handleOpenKeyDialog: mockHandleOpenKeyDialog,
    handleSelectEndpoint: mockHandleSelectEndpoint,
    endpointSearchValues: {},
    setEndpointSearchValue: jest.fn(),
    endpointRequiresUserKey: () => false,
    isSuperAdmin: mockIsSuperAdmin,
    agentsMap: undefined,
    assistantsMap: undefined,
    modelSpecs: [],
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
    CustomMenu: ({ label, children }: { label: React.ReactNode; children?: React.ReactNode }) =>
      React.createElement('div', null, label, children),
  };
});

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, options?: Record<string, string>) =>
    options?.[0] ? `${key} ${options[0]}` : key,
}));

const endpoint: Endpoint = {
  value: 'anthropic',
  label: 'Anthropic',
  hasModels: false,
  icon: null,
};

const agentsEndpoint: Endpoint = {
  value: 'agents',
  label: 'My Agents',
  hasModels: false,
  icon: null,
};

describe('EndpointItem', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsSuperAdmin = false;
    mockSelectedValues = { endpoint: '', model: '', modelSpec: '' };
  });

  it('shows the settings button for super admins even when the endpoint does not require a user key', () => {
    mockIsSuperAdmin = true;

    render(<EndpointItem endpoint={endpoint} endpointIndex={0} />);

    expect(
      screen.getByRole('button', { name: 'com_endpoint_config_key Anthropic' }),
    ).toBeInTheDocument();
  });

  it('hides the settings button for non-super-admins', () => {
    render(<EndpointItem endpoint={endpoint} endpointIndex={0} />);

    expect(
      screen.queryByRole('button', { name: 'com_endpoint_config_key Anthropic' }),
    ).not.toBeInTheDocument();
  });

  it('hides the settings button for My Agents even for super admins', () => {
    mockIsSuperAdmin = true;

    render(<EndpointItem endpoint={agentsEndpoint} endpointIndex={0} />);

    expect(
      screen.queryByRole('button', { name: 'com_endpoint_config_key My Agents' }),
    ).not.toBeInTheDocument();
  });
});
