import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { SystemRoles, AdminPermissions } from 'librechat-data-provider';

// --- mock navigate ---
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  useOutletContext: () => ({ navVisible: true, setNavVisible: jest.fn() }),
  useNavigate: () => mockNavigate,
}));

// --- mock user ---
let mockUser: Record<string, unknown> | null = null;
jest.mock('~/hooks/AuthContext', () => ({
  useAuthContext: () => ({ user: mockUser }),
}));

// --- mock admin queries ---
const mockAdminPermissionsQuery: Record<string, unknown> = {
  data: undefined,
  isSuccess: false,
  isLoading: false,
  isError: false,
};
const mockAdminUsersQuery: Record<string, unknown> = { data: undefined, isLoading: false };
const mockAdminUserQuery: Record<string, unknown> = { data: undefined, isLoading: false };
const mockAdminUsageQuery: Record<string, unknown> = { data: undefined, isLoading: false };
const mockAdminMCPServersQuery: Record<string, unknown> = { data: undefined, isLoading: false };
const mockAdminSettingsQuery: Record<string, unknown> = { data: undefined, isLoading: false };
const mockAdminObservabilityQuery: Record<string, unknown> = {
  data: undefined,
  isLoading: false,
};
const mockAdminRolesQuery: Record<string, unknown> = { data: [], isLoading: false };
const mockAdminModelsQuery: Record<string, unknown> = { data: undefined, isLoading: false };

const mockRefreshAdminModelsMutate = jest.fn();
const mockUpdateAdminSettingsMutateAsync = jest.fn();
const mockUpdateAdminMCPPublicationMutate = jest.fn();

jest.mock('~/data-provider', () => ({
  useAdminPermissionsQuery: () => mockAdminPermissionsQuery,
  useAdminUsersQuery: () => mockAdminUsersQuery,
  useAdminUserQuery: () => mockAdminUserQuery,
  useAdminUsageQuery: () => mockAdminUsageQuery,
  useAdminMCPServersQuery: () => mockAdminMCPServersQuery,
  useAdminSettingsQuery: () => mockAdminSettingsQuery,
  useAdminObservabilityQuery: () => mockAdminObservabilityQuery,
  useAdminRolesQuery: () => mockAdminRolesQuery,
  useDeleteAdminUserMutation: () => ({
    mutate: jest.fn(),
    isLoading: false,
    isError: false,
    error: null,
  }),
  useUpdateAdminUserMutation: () => ({
    mutateAsync: jest.fn(),
    isLoading: false,
    isError: false,
    error: null,
  }),
  useUpdateAdminSettingsMutation: () => ({
    mutateAsync: mockUpdateAdminSettingsMutateAsync,
    isLoading: false,
    isError: false,
    error: null,
  }),
  useUpdateAdminMCPServerPublicationMutation: () => ({
    mutate: mockUpdateAdminMCPPublicationMutate,
    isLoading: false,
    isError: false,
    error: null,
  }),
  useRefreshAdminModelsMutation: () => ({
    mutate: mockRefreshAdminModelsMutate,
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

jest.mock('librechat-data-provider/react-query', () => ({
  useGetModelsQuery: () => mockAdminModelsQuery,
}));

jest.mock('~/hooks', () => ({
  useAuthContext: () => ({ user: mockUser }),
  useDocumentTitle: jest.fn(),
  useLocalize: () => (key: string) => key,
}));

// --- mock @librechat/client components ---
jest.mock('@librechat/client', () => {
  const React = require('react');
  return {
    Button: ({
      children,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) =>
      React.createElement('button', props, children),
    Input: React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
      (props, ref) => React.createElement('input', { ref, ...props }),
    ),
    Label: ({
      children,
      ...props
    }: React.LabelHTMLAttributes<HTMLLabelElement> & { htmlFor?: string }) =>
      React.createElement('label', props, children),
    OGDialog: ({
      children,
    }: {
      children: React.ReactNode;
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
    }) => React.createElement('div', null, children),
    OGDialogTrigger: ({ children }: { children: React.ReactNode; asChild?: boolean }) =>
      React.createElement(React.Fragment, null, children),
    OGDialogTemplate: () => null,
    Spinner: () => React.createElement('div', { 'data-testid': 'spinner' }, 'loading'),
    Switch: ({
      checked,
      onCheckedChange,
      ...rest
    }: {
      checked: boolean;
      onCheckedChange: (v: boolean) => void;
      disabled?: boolean;
      'aria-label'?: string;
    }) =>
      React.createElement('button', {
        role: 'switch',
        'aria-checked': checked,
        onClick: () => onCheckedChange(!checked),
        ...rest,
      }),
    TrashIcon: () => React.createElement('span', null, 'trash'),
    useToastContext: () => ({ showToast: jest.fn() }),
  };
});

jest.mock('~/components/Chat/Menus', () => ({
  OpenSidebar: () => null,
}));

import AdminConsole from '../AdminConsole';

function resetQueryDefaults() {
  mockAdminPermissionsQuery.data = undefined;
  mockAdminPermissionsQuery.isSuccess = false;
  mockAdminPermissionsQuery.isLoading = false;
  mockAdminPermissionsQuery.isError = false;
  mockAdminSettingsQuery.data = undefined;
  mockAdminSettingsQuery.isLoading = false;
  mockAdminMCPServersQuery.data = undefined;
  mockAdminMCPServersQuery.isLoading = false;
}

describe('AdminConsole – permission gating', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateAdminSettingsMutateAsync.mockReset();
    mockUser = null;
    resetQueryDefaults();
  });

  it('redirects normal users (no admin roles) to /c/new', () => {
    mockUser = { role: SystemRoles.USER, adminRoleIds: [] };

    render(<AdminConsole />);

    expect(mockNavigate).toHaveBeenCalledWith('/c/new', { replace: true });
  });

  it('redirects when the admin permissions API errors out', async () => {
    mockUser = { role: SystemRoles.ADMIN, adminRoleIds: [] };
    mockAdminPermissionsQuery.isError = true;

    render(<AdminConsole />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/c/new', { replace: true });
    });
  });

  it('shows loading spinner for potential admins while permissions load', () => {
    mockUser = { role: SystemRoles.ADMIN, adminRoleIds: [] };
    mockAdminPermissionsQuery.isLoading = true;

    render(<AdminConsole />);

    expect(screen.getByTestId('spinner')).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('renders admin console for superadmin with resolved permissions', () => {
    mockUser = { role: SystemRoles.ADMIN, adminRoleIds: [] };
    mockAdminPermissionsQuery.isSuccess = true;
    mockAdminPermissionsQuery.data = {
      isSuperAdmin: true,
      permissions: Object.values(AdminPermissions),
      adminRoles: [],
    };

    render(<AdminConsole />);

    expect(screen.getByText('com_nav_admin_console')).toBeInTheDocument();
    expect(screen.getByText('com_admin_current_access')).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows only permitted sections for a lower-tier admin', () => {
    mockUser = {
      role: SystemRoles.USER,
      adminRoleIds: ['observability_admin'],
    };
    mockAdminPermissionsQuery.isSuccess = true;
    mockAdminPermissionsQuery.data = {
      isSuperAdmin: false,
      permissions: [AdminPermissions.OBSERVABILITY_READ],
      adminRoles: [
        {
          adminRoleId: 'observability_admin',
          name: 'Observability Admin',
          permissions: [AdminPermissions.OBSERVABILITY_READ],
        },
      ],
    };

    render(<AdminConsole />);

    // Observability section should appear
    expect(screen.getByText('com_admin_observability')).toBeInTheDocument();

    // Users and Usage sections should NOT appear
    expect(screen.queryByText('com_admin_users')).not.toBeInTheDocument();
    expect(screen.queryByText('com_ui_usage')).not.toBeInTheDocument();
  });

  it('shows all sections for a superadmin', () => {
    mockUser = { role: SystemRoles.ADMIN, adminRoleIds: [] };
    mockAdminPermissionsQuery.isSuccess = true;
    mockAdminPermissionsQuery.data = {
      isSuperAdmin: true,
      permissions: Object.values(AdminPermissions),
      adminRoles: [],
    };

    render(<AdminConsole />);

    expect(screen.getByText('com_admin_current_access')).toBeInTheDocument();
    expect(screen.getByText('com_admin_users')).toBeInTheDocument();
    expect(screen.getByText('com_ui_usage')).toBeInTheDocument();
    expect(screen.getByText('com_admin_workspace_settings')).toBeInTheDocument();
    expect(screen.getByText('com_admin_observability')).toBeInTheDocument();
  });

  it('does not show Manage access section for non-superadmin', () => {
    mockUser = {
      role: SystemRoles.USER,
      adminRoleIds: ['workspace_admin'],
    };
    mockAdminPermissionsQuery.isSuccess = true;
    mockAdminPermissionsQuery.data = {
      isSuperAdmin: false,
      permissions: [
        AdminPermissions.USERS_READ,
        AdminPermissions.USERS_DELETE,
        AdminPermissions.USAGE_READ,
        AdminPermissions.SETTINGS_READ,
        AdminPermissions.SETTINGS_WRITE,
        AdminPermissions.OBSERVABILITY_READ,
      ],
      adminRoles: [
        {
          adminRoleId: 'workspace_admin',
          name: 'Workspace Admin',
          permissions: [
            AdminPermissions.USERS_READ,
            AdminPermissions.USERS_DELETE,
            AdminPermissions.USAGE_READ,
            AdminPermissions.SETTINGS_READ,
            AdminPermissions.SETTINGS_WRITE,
            AdminPermissions.OBSERVABILITY_READ,
          ],
        },
      ],
    };
    mockAdminUsersQuery.data = {
      users: [
        {
          id: 'user-1',
          email: 'user@test.com',
          role: SystemRoles.USER,
          adminRoleIds: [],
          adminRoles: [],
        },
      ],
    };
    mockAdminUserQuery.data = {
      user: {
        id: 'user-1',
        email: 'user@test.com',
        role: SystemRoles.USER,
        adminRoleIds: [],
        adminRoles: [],
        provider: 'local',
        emailVerified: true,
        twoFactorEnabled: false,
        termsAccepted: true,
        favoritesCount: 0,
      },
      usage: {
        userId: 'user-1',
        email: 'user@test.com',
        role: SystemRoles.USER,
        tokenCredits: 0,
        conversationCount: 0,
        messageCount: 0,
        transactionCount: 0,
      },
    };

    render(<AdminConsole />);

    // Users section should appear
    expect(screen.getByText('com_admin_users')).toBeInTheDocument();
    // Manage access should NOT appear (superadmin-only)
    expect(screen.queryByText('com_admin_manage_access')).not.toBeInTheDocument();
  });
});

describe('AdminConsole – platform prompt settings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateAdminSettingsMutateAsync.mockReset();
    mockUser = { role: SystemRoles.ADMIN, adminRoleIds: [] };
    resetQueryDefaults();
    mockAdminPermissionsQuery.isSuccess = true;
    mockAdminPermissionsQuery.data = {
      isSuperAdmin: true,
      permissions: Object.values(AdminPermissions),
      adminRoles: [],
    };
    mockAdminSettingsQuery.data = {
      settingsId: 'global',
      registrationEnabled: true,
      modelSteeringEnabled: false,
      platformPrompt: 'Existing platform policy',
      observability: {
        langfuseUrl: '',
        grafanaUrl: '',
        metricsUrl: '',
        prometheusUrl: '',
      },
      mcpDomainFilterMode: 'denylist',
      mcpAllowedDomains: [],
    };
  });

  afterEach(() => {
    mockAdminSettingsQuery.data = undefined;
  });

  it('renders and saves the admin-only platform prompt', async () => {
    render(<AdminConsole />);

    const textarea = await screen.findByLabelText('com_admin_platform_prompt');
    expect(textarea).toHaveValue('Existing platform policy');

    fireEvent.change(textarea, { target: { value: 'New platform policy' } });
    fireEvent.click(screen.getByText('com_admin_save_settings'));

    await waitFor(() => {
      expect(mockUpdateAdminSettingsMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          platformPrompt: 'New platform policy',
        }),
      );
    });
  });
});

describe('AdminConsole – model discovery refresh section', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateAdminSettingsMutateAsync.mockReset();
    mockRefreshAdminModelsMutate.mockReset();
    mockUser = { role: SystemRoles.ADMIN, adminRoleIds: [] };
    resetQueryDefaults();
    mockAdminPermissionsQuery.isSuccess = true;
    mockAdminPermissionsQuery.data = {
      isSuperAdmin: true,
      permissions: Object.values(AdminPermissions),
      adminRoles: [],
    };
    mockAdminModelsQuery.data = {
      openAI: ['gpt-5', 'gpt-5.5'],
      anthropic: ['claude-4-sonnet'],
    };
  });

  it('renders the Refresh Models section for users with SETTINGS_WRITE', () => {
    render(<AdminConsole />);
    expect(screen.getByText('com_admin_model_discovery')).toBeInTheDocument();
    expect(screen.getByText('com_admin_refresh_all_models')).toBeInTheDocument();
  });

  it('triggers a global refresh when the "Refresh all" button is clicked', () => {
    render(<AdminConsole />);
    fireEvent.click(screen.getByText('com_admin_refresh_all_models'));
    expect(mockRefreshAdminModelsMutate).toHaveBeenCalledTimes(1);
    expect(mockRefreshAdminModelsMutate).toHaveBeenCalledWith(undefined);
  });

  it('triggers a per-provider refresh when a provider button is clicked', () => {
    render(<AdminConsole />);
    const buttons = screen.getAllByText('com_admin_refresh_provider');
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(buttons[0]);
    expect(mockRefreshAdminModelsMutate).toHaveBeenCalledWith({ provider: expect.any(String) });
  });

  it('hides the section when the user lacks SETTINGS_WRITE', () => {
    mockAdminPermissionsQuery.data = {
      isSuperAdmin: false,
      permissions: [AdminPermissions.OBSERVABILITY_READ],
      adminRoles: [],
    };
    mockUser = { role: SystemRoles.USER, adminRoleIds: ['observability_admin'] };

    render(<AdminConsole />);
    expect(screen.queryByText('com_admin_model_discovery')).not.toBeInTheDocument();
  });
});
