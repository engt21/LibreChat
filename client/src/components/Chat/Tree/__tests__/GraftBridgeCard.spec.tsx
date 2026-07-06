import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ContentTypes } from 'librechat-data-provider';
import type {
  TGenerationGraftDetailsResponse,
  TGenerationGraftMetadata,
  TMessage,
} from 'librechat-data-provider';
import GraftBridgeCard from '../GraftBridgeCard';
import MessageParts from '../../Messages/MessageParts';
import MessageRender from '../../Messages/ui/MessageRender';

const mockOpenTree = jest.fn();
const mockRefetchDetails = jest.fn();
const mockUndoMutateAsync = jest.fn();
const mockUseGenerationGraftDetails = jest.fn();
const mockUseUndoGenerationGraft = jest.fn();
const mockUseMessageActions = jest.fn();
const mockUseMessageHelpers = jest.fn();

jest.mock('jotai', () => ({
  useAtomValue: () => 'text-sm',
}));

jest.mock('recoil', () => ({
  atom: (config: unknown) => config,
  useRecoilValue: () => false,
}));

jest.mock('~/store/fontSize', () => ({
  fontSizeAtom: 'font-size-atom',
}));

jest.mock('~/store', () => ({
  maximizeChatSpace: 'maximizeChatSpace',
  enableUserMsgMarkdown: 'enableUserMsgMarkdown',
}));

jest.mock('@librechat/client', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  DelayedRender: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  OGDialog: ({ open, children }: { open?: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="dialog-root">{children}</div> : null,
  OGDialogClose: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  OGDialogContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
  OGDialogDescription: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p {...props}>{children}</p>
  ),
  OGDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  OGDialogTitle: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2 {...props}>{children}</h2>
  ),
  Spinner: () => <span data-testid="spinner">spinner</span>,
}));

jest.mock('~/Providers', () => {
  const React = require('react');
  return {
    MessageContext: React.createContext(null),
    MessagesViewContext: React.createContext(null),
    SearchContext: React.createContext({}),
    useGenerationTree: () => ({
      openTree: mockOpenTree,
    }),
    useMessageContext: () => ({
      isSubmitting: false,
      isLatestMessage: false,
    }),
  };
});

jest.mock('~/data-provider/Messages/generationGrafts', () => ({
  useGenerationGraftDetails: (...args: unknown[]) => mockUseGenerationGraftDetails(...args),
  useUndoGenerationGraft: (...args: unknown[]) => mockUseUndoGenerationGraft(...args),
}));

jest.mock('~/hooks', () => ({
  useAttachments: () => ({
    attachments: [],
    searchResults: {},
  }),
  useContentMetadata: () => ({
    hasParallelContent: false,
  }),
  useLocalize: () => (key: string, options?: Record<string, unknown>) =>
    ({
      com_ui_generation_graft_card_title: 'Grafted generation',
      com_ui_generation_graft_summary: `Source ${String(options?.sourceId ?? '')} was copied into this branch as prior context.`,
      com_ui_generation_graft_view_tree: 'View in tree',
      com_ui_generation_graft_undo: 'Undo graft',
      com_ui_generation_graft_checking_undo: 'Checking graft details…',
      com_ui_generation_graft_undoing: 'Undoing graft…',
      com_ui_generation_graft_source_id: `Source ${String(options?.sourceId ?? '')}`,
      com_ui_generation_graft_undo_confirm_title: 'Undo graft and delete later continuations?',
      com_ui_generation_graft_undo_confirm_description: `This deletes ${String(options?.copiedCount ?? 0)} copied messages and ${String(options?.continuationCount ?? 0)} later continuation messages from this branch only. The original source generation is not changed.`,
      com_ui_generation_graft_copied_messages: `Copied by graft: ${String(options?.count ?? 0)}`,
      com_ui_generation_tree_source: 'Source',
      com_ui_generation_tree_destination: 'Destination',
      com_ui_generation_tree_mode_generation: 'Generation only',
      com_ui_generation_tree_mode_subtree: 'Generation and subtree',
      com_ui_generation_tree_state_complete: 'Complete',
      com_ui_generation_tree_state_stopped_partial: 'Stopped partial',
      com_ui_generation_tree_state_aborted_partial: 'Aborted partial',
      com_ui_generation_tree_state_errored_partial: 'Errored partial',
      com_ui_generation_tree_copied_counts: 'Copied by graft',
      com_ui_generation_tree_continuation_counts: 'Later continuations',
      com_ui_cancel: 'Cancel',
      com_ui_generating: 'Generating',
      com_user_message: 'User heading',
      com_ui_assistant: 'Assistant heading',
      com_endpoint_message_new: `Message ${String(options?.[0] ?? '')}`,
      com_endpoint_message: 'Message',
    })[key] ?? key,
  useMessageActions: (...args: unknown[]) => mockUseMessageActions(...args),
  useMessageHelpers: (...args: unknown[]) => mockUseMessageHelpers(...args),
}));

jest.mock('~/components/Chat/Messages/MessageIcon', () => () => (
  <div data-testid="message-icon">icon</div>
));

jest.mock('~/components/Chat/Messages/SiblingSwitch', () => () => (
  <div data-testid="sibling-switch">sibling-switch</div>
));

jest.mock('~/components/Chat/Messages/HoverButtons', () => () => (
  <div data-testid="hover-buttons">hover-buttons</div>
));

jest.mock('~/components/Chat/Messages/ui/PlaceholderRow', () => () => (
  <div data-testid="placeholder-row">placeholder-row</div>
));

jest.mock('~/components/Chat/Messages/Content/ContentParts', () => () => (
  <div data-testid="content-parts">content-parts</div>
));

jest.mock('../../Messages/MultiMessage', () => () => null);

jest.mock('~/components/Web/Sources', () => () => null);
jest.mock('~/components/Messages/Content/Error', () => ({
  __esModule: true,
  default: ({ text }: { text: string }) => <div>{text}</div>,
}));
jest.mock('~/components/Chat/Messages/Content/EditMessage', () => ({
  __esModule: true,
  default: ({ text }: { text: string }) => <div>{text}</div>,
}));
jest.mock('~/components/Chat/Messages/Content/Markdown', () => ({
  __esModule: true,
  default: ({ content }: { content: string }) => <div>{content}</div>,
}));
jest.mock('~/components/Chat/Messages/Content/MarkdownLite', () => ({
  __esModule: true,
  default: ({ content }: { content: string }) => <div>{content}</div>,
}));
jest.mock('~/components/Chat/Messages/Content/Parts/Thinking', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock('~/components/Chat/Messages/Content/Container', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock('~/utils/googleGrounding', () => ({
  injectGroundingCitations: (content: string) => content,
}));
jest.mock('~/utils/ollamaReasoning', () => ({
  shouldHideOllamaReasoning: () => false,
}));

const generationGraftMetadata: TGenerationGraftMetadata = {
  kind: 'generation_graft',
  graftId: 'graft-1',
  idempotencyKey: 'idempotency-1',
  sourceConversationId: 'conversation-1',
  sourceRootMessageId: 'assistant-source-89abcdef',
  sourceMessageIds: ['assistant-source-89abcdef'],
  destinationConversationId: 'conversation-1',
  destinationMessageId: 'assistant-destination-12345678',
  copiedRootMessageId: 'copied-root-1',
  copiedMessageIds: ['copy-1', 'copy-2', 'copy-3'],
  activeCopiedMessageId: 'copy-3',
  mode: 'subtree',
  sourceState: 'complete',
  destinationState: 'stopped_partial',
  requestFingerprint: 'fingerprint-1',
  createdAt: '2026-07-06T10:00:00.000Z',
};

const createBridgeMessage = (
  overrides: Partial<TMessage> = {},
  metadata: TGenerationGraftMetadata = generationGraftMetadata,
): TMessage =>
  ({
    messageId: 'bridge-1',
    conversationId: 'conversation-1',
    parentMessageId: 'parent-1',
    text: 'An alternate completed assistant generation was grafted into this branch. Treat the following assistant message and any copied continuation as prior conversation context.',
    isCreatedByUser: true,
    metadata: {
      generationGraft: metadata,
    },
    children: [],
    ...overrides,
  }) as TMessage;

const safeUndoDetails: TGenerationGraftDetailsResponse = {
  graftId: 'graft-1',
  bridgeMessageId: 'bridge-1',
  copiedMessageIds: ['copy-1', 'copy-2', 'copy-3', 'copy-4'],
  continuationMessageIds: [],
  copiedCounts: {
    messages: 4,
    toolCalls: 0,
    files: 0,
    images: 0,
    approximateTokens: 32,
  },
  continuationCounts: {
    messages: 0,
    toolCalls: 0,
    files: 0,
    images: 0,
    approximateTokens: 0,
  },
  canUndoWithoutContinuations: true,
  mode: 'subtree',
  sourceState: 'complete',
  destinationState: 'stopped_partial',
  copiedRootMessageId: 'copied-root-1',
  activeCopiedMessageId: 'copy-4',
};

const destructiveUndoDetails: TGenerationGraftDetailsResponse = {
  ...safeUndoDetails,
  continuationMessageIds: ['continuation-1', 'continuation-2'],
  continuationCounts: {
    messages: 2,
    toolCalls: 0,
    files: 0,
    images: 0,
    approximateTokens: 11,
  },
  canUndoWithoutContinuations: false,
};

describe('GraftBridgeCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockRefetchDetails.mockResolvedValue({ data: safeUndoDetails });
    mockUseGenerationGraftDetails.mockImplementation(() => ({
      data: undefined,
      isFetching: false,
      error: null,
      refetch: mockRefetchDetails,
    }));
    mockUseUndoGenerationGraft.mockImplementation(() => ({
      mutateAsync: mockUndoMutateAsync,
      isPending: false,
      isLoading: false,
      status: 'idle',
    }));
    mockUseMessageActions.mockImplementation(() => ({
      ask: null,
      edit: false,
      index: 0,
      agent: null,
      assistant: null,
      enterEdit: jest.fn(),
      conversation: { conversationId: 'conversation-1', endpoint: 'openAI', model: 'gpt' },
      messageLabel: 'User heading',
      handleFeedback: jest.fn(),
      handleContinue: jest.fn(),
      latestMessageId: 'bridge-1',
      copyToClipboard: jest.fn(),
      regenerateMessage: jest.fn(),
      latestMessageDepth: 0,
    }));
    mockUseMessageHelpers.mockImplementation(() => ({
      edit: false,
      index: 0,
      agent: null,
      isLast: false,
      enterEdit: jest.fn(),
      assistant: null,
      handleScroll: jest.fn(),
      conversation: { conversationId: 'conversation-1', endpoint: 'openAI', model: 'gpt' },
      isSubmitting: false,
      latestMessageId: 'bridge-1',
      handleContinue: jest.fn(),
      copyToClipboard: jest.fn(),
      regenerateMessage: jest.fn(),
    }));
  });

  it('renders an accessible provenance summary with source state, destination state, mode, and authoritative copied count', () => {
    mockUseGenerationGraftDetails.mockImplementation(() => ({
      data: safeUndoDetails,
      isFetching: false,
      error: null,
      refetch: mockRefetchDetails,
    }));

    render(<GraftBridgeCard message={createBridgeMessage()} />);

    expect(screen.getByRole('region', { name: 'Grafted generation' })).toBeInTheDocument();
    expect(screen.getByText('Source 89abcdef')).toBeInTheDocument();
    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.getByText('Stopped partial')).toBeInTheDocument();
    expect(screen.getByText('Generation and subtree')).toBeInTheDocument();
    expect(screen.getByText('Copied by graft: 4')).toBeInTheDocument();
  });

  it('opens the generation tree focused on the bridge message', () => {
    render(<GraftBridgeCard message={createBridgeMessage()} />);

    fireEvent.click(screen.getByRole('button', { name: 'View in tree' }));

    expect(mockOpenTree).toHaveBeenCalledWith({ focusMessageId: 'bridge-1' });
  });

  it('fetches details first and safely undoes a graft without continuations', async () => {
    mockRefetchDetails.mockResolvedValue({ data: safeUndoDetails });
    mockUndoMutateAsync.mockResolvedValue({ deletedCount: 4 });

    render(<GraftBridgeCard message={createBridgeMessage()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Undo graft' }));

    await waitFor(() => expect(mockRefetchDetails).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockUndoMutateAsync).toHaveBeenCalledWith({}));
    expect(screen.queryByTestId('dialog-root')).not.toBeInTheDocument();
  });

  it('requires an explicit destructive confirmation before undoing later continuations', async () => {
    mockRefetchDetails.mockResolvedValue({ data: destructiveUndoDetails });
    mockUndoMutateAsync.mockResolvedValue({ deletedCount: 6 });

    render(<GraftBridgeCard message={createBridgeMessage()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Undo graft' }));

    expect(
      await screen.findByText('Undo graft and delete later continuations?'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'This deletes 4 copied messages and 2 later continuation messages from this branch only. The original source generation is not changed.',
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Undo graft' })[1]);

    await waitFor(() =>
      expect(mockUndoMutateAsync).toHaveBeenCalledWith({ includeContinuations: true }),
    );
  });

  it('cancels a destructive undo without mutating the graft', async () => {
    mockRefetchDetails.mockResolvedValue({ data: destructiveUndoDetails });

    render(<GraftBridgeCard message={createBridgeMessage()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Undo graft' }));
    expect(
      await screen.findByText('Undo graft and delete later continuations?'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(
        screen.queryByText('Undo graft and delete later continuations?'),
      ).not.toBeInTheDocument(),
    );
    expect(mockUndoMutateAsync).not.toHaveBeenCalled();
  });
});

describe('graft bridge transcript integration', () => {
  it('renders the provenance card in the text message path and suppresses normal user chrome while preserving controls and the anchor', () => {
    const message = createBridgeMessage({
      depth: 0,
    });

    const { container } = render(
      <MessageRender
        message={message}
        currentEditId={null}
        setCurrentEditId={jest.fn()}
        siblingIdx={0}
        setSiblingIdx={jest.fn()}
        siblingCount={2}
        isSubmitting={false}
      />,
    );

    expect(screen.getByRole('region', { name: 'Grafted generation' })).toBeInTheDocument();
    expect(
      screen.queryByText(
        'An alternate completed assistant generation was grafted into this branch. Treat the following assistant message and any copied continuation as prior conversation context.',
      ),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('User heading')).not.toBeInTheDocument();
    expect(screen.queryByTestId('message-icon')).not.toBeInTheDocument();
    expect(screen.getByTestId('sibling-switch')).toBeInTheDocument();
    expect(screen.getByTestId('hover-buttons')).toBeInTheDocument();
    expect(container.querySelector('#bridge-1')).toBeInTheDocument();
  });

  it('renders the provenance card in the structured message path and preserves sibling controls without rendering normal structured content', () => {
    const message = createBridgeMessage({
      content: [
        {
          type: ContentTypes.TEXT,
          text: 'An alternate completed assistant generation was grafted into this branch. Treat the following assistant message and any copied continuation as prior conversation context.',
        },
      ],
      depth: 0,
    });

    const { container } = render(
      <MessageParts
        message={message}
        currentEditId={null}
        setCurrentEditId={jest.fn()}
        siblingIdx={0}
        setSiblingIdx={jest.fn()}
        siblingCount={2}
      />,
    );

    expect(screen.getByRole('region', { name: 'Grafted generation' })).toBeInTheDocument();
    expect(screen.queryByText('User heading')).not.toBeInTheDocument();
    expect(screen.queryByTestId('message-icon')).not.toBeInTheDocument();
    expect(screen.queryByTestId('content-parts')).not.toBeInTheDocument();
    expect(screen.getByTestId('sibling-switch')).toBeInTheDocument();
    expect(screen.getByTestId('hover-buttons')).toBeInTheDocument();
    expect(container.querySelector('#bridge-1')).toBeInTheDocument();
  });
});
