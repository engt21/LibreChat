/**
 * @jest-environment @happy-dom/jest-environment
 */
/* eslint-disable i18next/no-literal-string */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Constants, EModelEndpoint, SystemRoles } from 'librechat-data-provider';
import ChatRoute from '../ChatRoute';

if (typeof Request === 'undefined') {
  global.Request = class Request {
    constructor(
      public url: string,
      public init?: RequestInit,
    ) {}
  } as any;
}

const mockNewConversation = jest.fn();
const mockShowToast = jest.fn();
const mockSetIsTemporary = jest.fn();
const mockRoleRefetch = jest.fn();
const mockUseGetRole = jest.fn((..._args: unknown[]) => mockUserRoleQuery);
const mockModelsRefetch = jest.fn();
const mockStartupConfigRefetch = jest.fn();
const mockEndpointsRefetch = jest.fn();
const mockInitialConvoRefetch = jest.fn();

type MockQuery<T> = {
  data?: T;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  refetch: jest.Mock;
};

let mockStartupConfigQuery: MockQuery<Record<string, unknown>>;
let mockUserRoleQuery: MockQuery<Record<string, unknown>>;
let mockModelsQuery: MockQuery<Record<string, unknown>>;
let mockEndpointsQuery: MockQuery<Record<string, unknown>>;
let mockInitialConvoQuery: MockQuery<Record<string, unknown> | undefined>;
let mockAssistantListMap: Record<string, unknown>;
let mockAuthState: {
  isAuthenticated: boolean;
  user: { role: string } | null;
  roles: Record<string, Record<string, unknown> | null>;
};
let mockRouteState: {
  hasSetConversation: { current: boolean };
  conversation: { conversationId: string } | null;
};

const createQuery = <T,>(
  overrides: Partial<MockQuery<T>> = {},
  refetch = jest.fn(),
): MockQuery<T> => ({
  data: undefined,
  isLoading: false,
  isFetching: false,
  isError: false,
  error: null,
  refetch,
  ...overrides,
});

jest.mock('recoil', () => ({
  useRecoilValue: jest.fn(() => false),
  useRecoilCallback: jest.fn(() => mockSetIsTemporary),
}));

jest.mock('@librechat/client', () => ({
  Spinner: () => <div data-testid="spinner">spinner</div>,
  useToastContext: () => ({ showToast: mockShowToast }),
}));

jest.mock('librechat-data-provider/react-query', () => ({
  useGetModelsQuery: jest.fn(() => mockModelsQuery),
}));

jest.mock('~/hooks', () => ({
  useNewConvo: jest.fn(() => ({ newConversation: mockNewConversation })),
  useAppStartup: jest.fn(),
  useAssistantListMap: jest.fn(() => mockAssistantListMap),
  useIdChangeEffect: jest.fn(),
  useLocalize: jest.fn(() => (key: string) => key),
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: jest.fn(() => mockStartupConfigQuery),
  useGetConvoIdQuery: jest.fn(() => mockInitialConvoQuery),
  useGetEndpointsQuery: jest.fn(() => mockEndpointsQuery),
  useGetRole: jest.fn((...args: unknown[]) => mockUseGetRole(...args)),
}));

jest.mock('../useAuthRedirect', () => ({
  __esModule: true,
  default: jest.fn(() => mockAuthState),
}));

jest.mock('~/Providers', () => ({
  ToolCallsMapProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tool-calls-map">{children}</div>
  ),
}));

jest.mock('~/components/Chat/ChatView', () => () => <div data-testid="chat-view">ChatView</div>);

jest.mock('~/store/temporary', () => ({
  __esModule: true,
  default: {
    defaultTemporaryChat: Symbol('defaultTemporaryChat'),
    isTemporary: Symbol('isTemporary'),
  },
}));

jest.mock('~/store', () => ({
  __esModule: true,
  default: {
    useCreateConversationAtom: jest.fn(() => ({
      hasSetConversation: mockRouteState.hasSetConversation,
      conversation: mockRouteState.conversation,
    })),
  },
}));

jest.mock('~/utils', () => ({
  getDefaultModelSpec: jest.fn(() => undefined),
  getModelSpecPreset: jest.fn(() => undefined),
  processValidSettings: jest.fn(() => ({})),
  logger: { log: jest.fn() },
  isNotFoundError: jest.fn(
    (error: { status?: number } | null | undefined) => error?.status === 404,
  ),
}));

function renderRoute(path = '/c/new') {
  let renderKey = 0;
  const renderElement = () => (
    <MemoryRouter key={`${path}-${renderKey}`} initialEntries={[path]}>
      <Routes>
        <Route path="/c/:conversationId" element={<ChatRoute />} />
      </Routes>
    </MemoryRouter>
  );

  const view = render(renderElement());
  return {
    ...view,
    rerenderRoute: () => {
      renderKey += 1;
      view.rerender(renderElement());
    },
  };
}

describe('ChatRoute bootstrap handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStartupConfigQuery = createQuery({ data: { interface: {} } }, mockStartupConfigRefetch);
    mockUserRoleQuery = createQuery({ data: { permissions: {} } }, mockRoleRefetch);
    mockModelsQuery = createQuery(
      {
        data: {
          [EModelEndpoint.openAI]: ['gpt-5.6'],
        },
      },
      mockModelsRefetch,
    );
    mockEndpointsQuery = createQuery(
      {
        data: {
          [EModelEndpoint.openAI]: { type: EModelEndpoint.openAI },
        },
      },
      mockEndpointsRefetch,
    );
    mockInitialConvoQuery = createQuery({}, mockInitialConvoRefetch);
    mockAssistantListMap = {};
    mockAuthState = {
      isAuthenticated: true,
      user: { role: SystemRoles.USER },
      roles: {
        [SystemRoles.USER]: { permissions: {} },
        [SystemRoles.ADMIN]: null,
      },
    };
    mockRouteState = {
      hasSetConversation: { current: false },
      conversation: null,
    };
  });

  it('initializes a healthy /c/new exactly once', async () => {
    const view = renderRoute('/c/new');

    await waitFor(() => {
      expect(mockNewConversation).toHaveBeenCalledTimes(1);
    });

    expect(mockUseGetRole).toHaveBeenCalledWith(SystemRoles.USER, { enabled: true });
    expect(mockNewConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        modelsData: mockModelsQuery.data,
      }),
    );

    mockRouteState.conversation = { conversationId: Constants.NEW_CONVO };
    view.rerenderRoute();

    expect(screen.getByTestId('chat-view')).toBeInTheDocument();
    expect(mockNewConversation).toHaveBeenCalledTimes(1);
  });

  it('keeps the active chat mounted while a new conversation receives its server ID', () => {
    mockRouteState.hasSetConversation.current = true;
    mockRouteState.conversation = { conversationId: 'server-conversation-id' };

    renderRoute('/c/new');

    expect(screen.getByTestId('chat-view')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(mockNewConversation).not.toHaveBeenCalled();
  });

  it('preserves deep links by hydrating the requested conversation', async () => {
    mockInitialConvoQuery = createQuery(
      {
        data: {
          conversationId: 'abc123',
          endpoint: EModelEndpoint.openAI,
        },
      },
      mockInitialConvoRefetch,
    );

    const view = renderRoute('/c/abc123');

    await waitFor(() => {
      expect(mockNewConversation).toHaveBeenCalledTimes(1);
    });

    expect(mockNewConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        template: mockInitialConvoQuery.data,
        preset: mockInitialConvoQuery.data,
        modelsData: mockModelsQuery.data,
        keepLatestMessage: true,
      }),
    );

    mockRouteState.conversation = { conversationId: 'abc123' };
    view.rerenderRoute();

    expect(screen.getByTestId('chat-view')).toBeInTheDocument();
  });

  it('shows visible loading while startup config is pending', () => {
    mockStartupConfigQuery = createQuery(
      {
        isLoading: true,
        isFetching: true,
      },
      mockStartupConfigRefetch,
    );

    renderRoute('/c/new');

    expect(screen.getByRole('status')).toHaveTextContent('com_ui_loading');
    expect(screen.getByTestId('spinner')).toBeInTheDocument();
    expect(mockNewConversation).not.toHaveBeenCalled();
  });

  it('uses cached startup config when a background refetch fails', async () => {
    mockStartupConfigQuery = createQuery(
      {
        data: { interface: {} },
        isError: true,
        error: new Error('startup refresh failed'),
      },
      mockStartupConfigRefetch,
    );

    renderRoute('/c/new');

    await waitFor(() => {
      expect(mockNewConversation).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows visible loading while endpoints are pending', () => {
    mockEndpointsQuery = createQuery(
      {
        isLoading: true,
        isFetching: true,
      },
      mockEndpointsRefetch,
    );

    renderRoute('/c/new');

    expect(screen.getByRole('status')).toHaveTextContent('com_ui_loading');
    expect(screen.getByTestId('spinner')).toBeInTheDocument();
    expect(mockNewConversation).not.toHaveBeenCalled();
  });

  it('uses cached endpoints when a background refetch fails', async () => {
    mockEndpointsQuery = createQuery(
      {
        data: {
          [EModelEndpoint.openAI]: { type: EModelEndpoint.openAI },
        },
        isError: true,
        error: new Error('endpoints refresh failed'),
      },
      mockEndpointsRefetch,
    );

    renderRoute('/c/new');

    await waitFor(() => {
      expect(mockNewConversation).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows manual retry UI for an exhausted USER-role error and recovers', async () => {
    mockAuthState.roles[SystemRoles.USER] = null;
    mockUserRoleQuery = createQuery(
      {
        isError: true,
        error: new Error('role bootstrap failed'),
      },
      mockRoleRefetch,
    );

    const view = renderRoute('/c/new');

    expect(await screen.findByRole('alert')).toHaveTextContent('com_ui_permissions_failed_load');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(mockNewConversation).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_retry' }));
    expect(mockRoleRefetch).toHaveBeenCalledTimes(1);

    mockAuthState.roles[SystemRoles.USER] = { permissions: {} };
    mockUserRoleQuery = createQuery({ data: { permissions: {} } }, mockRoleRefetch);
    view.rerenderRoute();

    await waitFor(() => {
      expect(mockNewConversation).toHaveBeenCalledTimes(1);
    });
  });

  it('uses a cached USER role when a background refetch fails', async () => {
    mockUserRoleQuery = createQuery(
      {
        data: { permissions: {} },
        isError: true,
        error: new Error('role refresh failed'),
      },
      mockRoleRefetch,
    );

    renderRoute('/c/new');

    await waitFor(() => {
      expect(mockNewConversation).toHaveBeenCalledTimes(1);
    });
    expect(mockUseGetRole).toHaveBeenCalledWith(SystemRoles.USER, { enabled: true });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('treats the initial empty-model sentinel as loading, then retries and recovers', async () => {
    mockModelsQuery = createQuery(
      {
        data: {
          initial: [],
          [EModelEndpoint.openAI]: ['gpt-5.6'],
        },
      },
      mockModelsRefetch,
    );

    const view = renderRoute('/c/new');

    expect(screen.getByRole('status')).toHaveTextContent('com_ui_loading');
    expect(mockNewConversation).not.toHaveBeenCalled();

    mockModelsQuery = createQuery(
      {
        data: {
          initial: [],
          [EModelEndpoint.openAI]: ['gpt-5.6'],
        },
        isError: true,
        error: new Error('models failed'),
      },
      mockModelsRefetch,
    );
    view.rerenderRoute();

    expect(await screen.findByRole('alert')).toHaveTextContent('com_error_models_not_loaded');

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_retry' }));
    expect(mockModelsRefetch).toHaveBeenCalledTimes(1);

    mockModelsQuery = createQuery(
      {
        data: {
          [EModelEndpoint.openAI]: ['gpt-5.6'],
        },
      },
      mockModelsRefetch,
    );
    view.rerenderRoute();

    await waitFor(() => {
      expect(mockNewConversation).toHaveBeenCalledTimes(1);
    });
  });

  it('uses cached loaded models when a background refetch fails', async () => {
    mockModelsQuery = createQuery(
      {
        data: {
          [EModelEndpoint.openAI]: ['gpt-5.6'],
        },
        isError: true,
        error: new Error('models refresh failed'),
      },
      mockModelsRefetch,
    );

    renderRoute('/c/new');

    await waitFor(() => {
      expect(mockNewConversation).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows visible loading while the USER role is still unresolved', () => {
    mockAuthState.roles[SystemRoles.USER] = null;
    mockUserRoleQuery = createQuery(
      {
        isLoading: true,
        isFetching: true,
      },
      mockRoleRefetch,
    );

    renderRoute('/c/new');

    expect(screen.getByRole('status')).toHaveTextContent('com_ui_loading');
    expect(mockNewConversation).not.toHaveBeenCalled();
  });

  it('uses cached deep-link data when a background refetch fails', async () => {
    mockInitialConvoQuery = createQuery(
      {
        data: {
          conversationId: 'abc123',
          endpoint: EModelEndpoint.openAI,
        },
        isError: true,
        error: new Error('conversation refresh failed'),
      },
      mockInitialConvoRefetch,
    );

    renderRoute('/c/abc123');

    await waitFor(() => {
      expect(mockNewConversation).toHaveBeenCalledTimes(1);
    });
    expect(mockNewConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        template: mockInitialConvoQuery.data,
        keepLatestMessage: true,
      }),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('treats a refetch 404 as authoritative over cached deep-link data', async () => {
    const staleConversation = {
      conversationId: 'abc123',
      endpoint: EModelEndpoint.openAI,
    };
    mockInitialConvoQuery = createQuery(
      {
        data: staleConversation,
        isError: true,
        error: { status: 404 },
      },
      mockInitialConvoRefetch,
    );

    renderRoute('/c/abc123');

    await waitFor(() => {
      expect(mockNewConversation).toHaveBeenCalledTimes(1);
    });
    expect(mockNewConversation).not.toHaveBeenCalledWith(
      expect.objectContaining({
        template: staleConversation,
      }),
    );
    expect(mockNewConversation).toHaveBeenCalledWith({
      modelsData: mockModelsQuery.data,
    });
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'com_ui_conversation_not_found',
      }),
    );
  });

  it('does not duplicate initialization after bootstrap dependencies rerender', async () => {
    const view = renderRoute('/c/new');

    await waitFor(() => {
      expect(mockNewConversation).toHaveBeenCalledTimes(1);
    });

    mockRouteState.conversation = { conversationId: Constants.NEW_CONVO };
    view.rerenderRoute();

    mockModelsQuery = createQuery(
      {
        data: {
          [EModelEndpoint.openAI]: ['gpt-5.6'],
          [EModelEndpoint.anthropic]: ['claude-opus-4-1'],
        },
      },
      mockModelsRefetch,
    );
    mockUserRoleQuery = createQuery(
      { data: { permissions: {} }, isFetching: true },
      mockRoleRefetch,
    );
    view.rerenderRoute();

    expect(screen.getByTestId('chat-view')).toBeInTheDocument();
    expect(mockNewConversation).toHaveBeenCalledTimes(1);
  });
});
