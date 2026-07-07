import { render, screen } from '@testing-library/react';
import ChatView from './ChatView';

const mockUseGetMessagesByConvoId = jest.fn();
let mockFileMap: Record<string, unknown> | undefined = {};
let mockConversationId = 'empty-fork-conversation';

jest.mock('react-router-dom', () => ({
  useParams: () => ({ conversationId: mockConversationId }),
}));

jest.mock('recoil', () => ({
  useRecoilValue: jest.fn(() => null),
}));

jest.mock('~/store', () => ({
  __esModule: true,
  default: {
    submissionByIndex: () => 'submission-state',
    centerFormOnLanding: 'center-form-state',
  },
}));

jest.mock('@librechat/client', () => ({
  Spinner: () => <div data-testid="loading-spinner" />,
}));

jest.mock('~/data-provider', () => ({
  useGetMessagesByConvoId: (...args: unknown[]) => mockUseGetMessagesByConvoId(...args),
}));

jest.mock('~/Providers', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const PassthroughProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;

  return {
    ChatContext: React.createContext(null),
    AddedChatContext: React.createContext(null),
    ChatFormProvider: PassthroughProvider,
    useFileMapContext: () => mockFileMap,
  };
});

jest.mock('~/hooks', () => ({
  useAddedResponse: () => ({}),
  useResumeOnLoad: jest.fn(),
  useAdaptiveSSE: jest.fn(),
  useChatHelpers: () => ({}),
}));

jest.mock('./Messages/MessagesView', () => ({
  __esModule: true,
  default: ({ messagesTree }: { messagesTree: unknown[] | null }) => (
    <div data-testid="empty-conversation">
      {messagesTree == null || messagesTree.length === 0 ? 'No messages yet' : 'Messages'}
    </div>
  ),
}));

jest.mock('./Input/ChatForm', () => ({
  __esModule: true,
  default: () => <div data-testid="chat-form">New message</div>,
}));

jest.mock('./Presentation', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('./Header', () => ({ __esModule: true, default: () => <div>Header</div> }));
jest.mock('./Footer', () => ({ __esModule: true, default: () => <div>Footer</div> }));
jest.mock('./Landing', () => ({ __esModule: true, default: () => <div>Landing</div> }));
jest.mock('./Input/ConversationStarters', () => ({
  __esModule: true,
  default: () => <div>Conversation starters</div>,
}));

describe('ChatView', () => {
  beforeEach(() => {
    mockUseGetMessagesByConvoId.mockReset();
    mockFileMap = {};
    mockConversationId = 'empty-fork-conversation';
  });

  it('keeps the loading spinner while an existing conversation query is loading', () => {
    mockUseGetMessagesByConvoId.mockReturnValue({ data: null, isLoading: true });

    render(<ChatView />);

    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
    expect(screen.queryByTestId('empty-conversation')).not.toBeInTheDocument();
  });

  it('loads messages even when file metadata is unavailable', () => {
    mockFileMap = undefined;
    mockUseGetMessagesByConvoId.mockImplementation((_conversationId, config) => ({
      data: config.select([]),
      isLoading: false,
    }));

    render(<ChatView />);

    expect(mockUseGetMessagesByConvoId).toHaveBeenCalledWith(
      'empty-fork-conversation',
      expect.objectContaining({ enabled: true }),
    );
    expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
    expect(screen.getByTestId('empty-conversation')).toHaveTextContent('No messages yet');
  });

  it('renders a recoverable new-message surface when an existing fork resolves empty', () => {
    mockUseGetMessagesByConvoId.mockImplementation((_conversationId, config) => ({
      data: config.select([]),
      isLoading: false,
    }));

    render(<ChatView />);

    expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
    expect(screen.getByTestId('empty-conversation')).toHaveTextContent('No messages yet');
    expect(screen.getByTestId('chat-form')).toHaveTextContent('New message');
  });

  it('renders the header immediately for a new conversation while the disabled query is loading', () => {
    mockConversationId = 'new';
    mockUseGetMessagesByConvoId.mockReturnValue({ data: null, isLoading: true });

    render(<ChatView />);

    expect(screen.getByText('Header')).toBeInTheDocument();
    expect(screen.getByText('Landing')).toBeInTheDocument();
    expect(screen.getByTestId('chat-form')).toHaveTextContent('New message');
    expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
    expect(mockUseGetMessagesByConvoId).toHaveBeenCalledWith(
      'new',
      expect.objectContaining({ enabled: false }),
    );
  });
});
