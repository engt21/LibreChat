import { render, screen, waitFor } from '@testing-library/react';
import { SystemRoles } from 'librechat-data-provider';

// --- mock data-provider hooks ---
const mockAdminPermissionsQuery = {
  data: undefined as any,
  isSuccess: false,
  isLoading: false,
  isError: false,
};

jest.mock('~/data-provider', () => ({
  useAdminPermissionsQuery: () => mockAdminPermissionsQuery,
  useGetStartupConfig: () => ({ data: undefined }),
  useGetUserBalance: () => ({ data: null }),
}));

// --- mock auth context ---
let mockUser: Record<string, unknown> | null = null;

jest.mock('~/hooks/AuthContext', () => ({
  useAuthContext: () => ({
    user: mockUser,
    isAuthenticated: Boolean(mockUser),
    logout: jest.fn(),
  }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

// --- mock navigation ---
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

// --- mock heavy child components ---
jest.mock('~/components/Chat/Input/Files/MyFilesModal', () => ({
  MyFilesModal: () => null,
}));

jest.mock('../Settings', () => () => null);

jest.mock('@librechat/client', () => {
  const React = require('react');
  return {
    LinkIcon: () => React.createElement('span', null, 'LinkIcon'),
    GearIcon: () => React.createElement('span', null, 'GearIcon'),
    DropdownMenuSeparator: () => React.createElement('hr'),
    Avatar: () => React.createElement('span', null, 'avatar'),
  };
});

// --- ariakit menu mocks ---
jest.mock('@ariakit/react/menu', () => {
  const React = require('react');
  return {
    MenuProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', null, children),
    MenuButton: React.forwardRef(
      (
        { children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>,
        ref: React.Ref<HTMLButtonElement>,
      ) => React.createElement('button', { ref, ...rest }, children),
    ),
    Menu: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', { role: 'menu' }, children),
    MenuItem: ({
      children,
      onClick,
      ...rest
    }: React.HTMLAttributes<HTMLDivElement> & { onClick?: () => void }) =>
      React.createElement('div', { role: 'menuitem', onClick, ...rest }, children),
  };
});

import AccountSettings from '../AccountSettings';

describe('AccountSettings – Admin Console entry visibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = null;
    mockAdminPermissionsQuery.data = undefined;
    mockAdminPermissionsQuery.isSuccess = false;
    mockAdminPermissionsQuery.isLoading = false;
    mockAdminPermissionsQuery.isError = false;
  });

  it('hides admin console entry for a normal user with no admin roles', () => {
    mockUser = { role: SystemRoles.USER, adminRoleIds: [], email: 'user@test.com' };

    render(<AccountSettings />);

    expect(screen.queryByText('com_nav_admin_console')).not.toBeInTheDocument();
  });

  it('shows admin console entry when a superadmin has resolved permissions', () => {
    mockUser = { role: SystemRoles.ADMIN, adminRoleIds: [], email: 'admin@test.com' };
    mockAdminPermissionsQuery.isSuccess = true;
    mockAdminPermissionsQuery.data = {
      isSuperAdmin: true,
      permissions: [],
      adminRoles: [],
    };

    render(<AccountSettings />);

    expect(screen.getByText('com_nav_admin_console')).toBeInTheDocument();
  });

  it('shows admin console entry for lower-tier admin with resolved permissions', () => {
    mockUser = {
      role: SystemRoles.USER,
      adminRoleIds: ['workspace_admin'],
      email: 'workspace@test.com',
    };
    mockAdminPermissionsQuery.isSuccess = true;
    mockAdminPermissionsQuery.data = {
      isSuperAdmin: false,
      permissions: ['users.read', 'settings.read'],
      adminRoles: [{ adminRoleId: 'workspace_admin', name: 'Workspace Admin' }],
    };

    render(<AccountSettings />);

    expect(screen.getByText('com_nav_admin_console')).toBeInTheDocument();
  });

  it('hides admin console entry when adminRoleIds are stale and permissions fail to resolve', () => {
    mockUser = {
      role: SystemRoles.USER,
      adminRoleIds: ['stale_role'],
      email: 'stale@test.com',
    };
    mockAdminPermissionsQuery.isSuccess = false;
    mockAdminPermissionsQuery.isError = true;
    mockAdminPermissionsQuery.data = undefined;

    render(<AccountSettings />);

    expect(screen.queryByText('com_nav_admin_console')).not.toBeInTheDocument();
  });

  it('hides admin console entry when permissions are still loading', () => {
    mockUser = { role: SystemRoles.ADMIN, adminRoleIds: [], email: 'admin@test.com' };
    mockAdminPermissionsQuery.isSuccess = false;
    mockAdminPermissionsQuery.isLoading = true;

    render(<AccountSettings />);

    expect(screen.queryByText('com_nav_admin_console')).not.toBeInTheDocument();
  });

  it('hides admin console entry when adminRoleIds exist but permissions resolve to empty', () => {
    mockUser = {
      role: SystemRoles.USER,
      adminRoleIds: ['invalid_role'],
      email: 'invalid@test.com',
    };
    mockAdminPermissionsQuery.isSuccess = true;
    mockAdminPermissionsQuery.data = {
      isSuperAdmin: false,
      permissions: [],
      adminRoles: [],
    };

    render(<AccountSettings />);

    expect(screen.queryByText('com_nav_admin_console')).not.toBeInTheDocument();
  });
});
