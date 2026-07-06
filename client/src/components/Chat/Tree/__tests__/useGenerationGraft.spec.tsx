import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { dataService, QueryKeys } from 'librechat-data-provider';
import type {
  TGenerationGraftCreateResponse,
  TGenerationGraftDetailsResponse,
  TGenerationGraftErrorResponse,
  TGenerationGraftPreviewResponse,
} from 'librechat-data-provider';
import { normalizeConversationGraph } from '../graph';
import useGenerationGraft from '../useGenerationGraft';

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');

  return {
    ...actual,
    dataService: {
      ...actual.dataService,
      getGenerationGraft: jest.fn(),
      undoGenerationGraft: jest.fn(),
    },
  };
});

const mockPreviewMutateAsync = jest.fn();
const mockCreateMutateAsync = jest.fn();
const mockUndoMutateAsync = jest.fn();
const mockStopGenerating = jest.fn();
const mockSetLatestMessage = jest.fn();
const mockShowToast = jest.fn();
const mockFetchStreamStatus = jest.fn();
const mockUuid = jest.fn();

jest.mock('uuid', () => ({
  v4: () => mockUuid(),
}));

jest.mock('@librechat/client', () => ({
  useToastContext: () => ({
    showToast: mockShowToast,
  }),
}));

jest.mock('~/hooks/useLocalize', () => ({
  __esModule: true,
  default: () => (key: string) =>
    ({
      com_ui_generation_tree_error_invalid: 'Choose a valid generation for this action.',
      com_ui_generation_tree_error_source: 'Choose an assistant generation as the source.',
      com_ui_generation_tree_error_destination:
        'Choose an assistant generation as the destination.',
      com_ui_generation_tree_error_overlap:
        'Choose a different destination outside the source branch.',
      com_ui_generation_tree_error_busy: 'The conversation is still changing. Try again shortly.',
      com_ui_generation_tree_error_timeout:
        'The active generation did not stabilize within 30 seconds. Wait longer or stop it first.',
      com_ui_generation_tree_error_stale: 'The conversation tree changed. Refresh and try again.',
      com_ui_generation_tree_error_undo_details:
        'Could not load continuation details. Try Undo again.',
      com_ui_generation_tree_created_success: 'Generation graft created.',
      com_ui_generation_tree_undo: 'Undo',
    })[key] ?? key,
}));

jest.mock('~/Providers/ChatContext', () => ({
  useChatContext: () => ({
    stopGenerating: mockStopGenerating,
    setLatestMessage: mockSetLatestMessage,
  }),
}));

jest.mock('~/data-provider/Messages/generationGrafts', () => ({
  usePreviewGenerationGraft: () => ({
    mutateAsync: mockPreviewMutateAsync,
    isPending: false,
  }),
  useCreateGenerationGraft: () => ({
    mutateAsync: mockCreateMutateAsync,
    isPending: false,
  }),
  useUndoGenerationGraft: () => ({
    mutateAsync: mockUndoMutateAsync,
    isPending: false,
  }),
  generationGraftDetailsQueryKey: (conversationId: string, graftId: string) => [
    'generationGraft',
    conversationId,
    graftId,
  ],
}));

jest.mock('~/data-provider/SSE/queries', () => ({
  fetchStreamStatus: (...args: unknown[]) => mockFetchStreamStatus(...args),
}));

const mockedDataService = dataService as jest.Mocked<typeof dataService>;

type TestMessage = {
  messageId: string;
  parentMessageId?: string | null;
  text: string;
  isCreatedByUser: boolean;
  unfinished?: boolean;
  error?: boolean;
  finish_reason?: string;
};

const createMessage = (overrides: Partial<TestMessage>): TestMessage => ({
  messageId: 'message-1',
  parentMessageId: null,
  text: '',
  isCreatedByUser: false,
  ...overrides,
});

const baseMessages = [
  createMessage({
    messageId: 'prompt',
    text: 'Prompt',
    isCreatedByUser: true,
  }),
  createMessage({
    messageId: 'complete-source',
    parentMessageId: 'prompt',
    text: 'Complete source',
  }),
  createMessage({
    messageId: 'complete-destination',
    parentMessageId: 'prompt',
    text: 'Complete destination',
  }),
  createMessage({
    messageId: 'stopped-source',
    parentMessageId: 'prompt',
    text: 'Stopped source',
    unfinished: true,
  }),
  createMessage({
    messageId: 'aborted-destination',
    parentMessageId: 'prompt',
    text: 'Aborted destination',
    unfinished: true,
    finish_reason: 'cancelled',
  }),
  createMessage({
    messageId: 'errored-destination',
    parentMessageId: 'prompt',
    text: 'Errored destination',
    error: true,
  }),
  createMessage({
    messageId: 'streaming-source',
    parentMessageId: 'prompt',
    text: 'Streaming source',
  }),
  createMessage({
    messageId: 'streaming-source-child',
    parentMessageId: 'streaming-source',
    text: 'Streaming source child',
  }),
  createMessage({
    messageId: 'streaming-destination',
    parentMessageId: 'prompt',
    text: 'Streaming destination',
  }),
];

const createGraph = (activeMessageIds: string[] = []) =>
  normalizeConversationGraph(baseMessages, { activeMessageIds });

const createPreviewResponse = (
  overrides: Partial<TGenerationGraftPreviewResponse> = {},
): TGenerationGraftPreviewResponse => ({
  conversationId: 'convo-1',
  sourceMessageId: 'complete-source',
  destinationMessageId: 'complete-destination',
  mode: 'generation',
  sourceState: 'complete',
  destinationState: 'complete',
  copiedMessageIds: ['complete-source'],
  activeSourceLeafMessageId: 'complete-source',
  destinationChildCount: 0,
  counts: {
    messages: 1,
    toolCalls: 0,
    files: 0,
    images: 0,
    approximateTokens: 24,
  },
  warnings: [],
  treeRevision: 'server-rev-1',
  requiresStabilization: false,
  activeMessageIds: [],
  conversationActiveWithoutMessageId: false,
  canCreate: true,
  ...overrides,
});

const createResult: TGenerationGraftCreateResponse = {
  graftId: 'graft-1',
  bridgeMessageId: 'bridge-1',
  copiedRootMessageId: 'copy-1',
  activeCopiedMessageId: 'copy-3',
  copiedMessageCount: 3,
  createdMessages: [
    {
      messageId: 'bridge-1',
      conversationId: 'convo-1',
      text: 'Bridge',
    } as never,
    {
      messageId: 'copy-1',
      conversationId: 'convo-1',
      text: 'Copy 1',
    } as never,
    {
      messageId: 'copy-2',
      conversationId: 'convo-1',
      text: 'Copy 2',
    } as never,
    {
      messageId: 'copy-3',
      conversationId: 'convo-1',
      text: 'Copy 3',
    } as never,
  ],
};

const createCreateResult = (
  overrides: Partial<TGenerationGraftCreateResponse> = {},
): TGenerationGraftCreateResponse => ({
  ...createResult,
  ...overrides,
  createdMessages: overrides.createdMessages ?? createResult.createdMessages,
});

const createDetails = (
  overrides: Partial<TGenerationGraftDetailsResponse> = {},
): TGenerationGraftDetailsResponse => ({
  graftId: 'graft-1',
  bridgeMessageId: 'bridge-1',
  copiedMessageIds: ['copy-1'],
  continuationMessageIds: ['later-1'],
  copiedCounts: {
    messages: 1,
    toolCalls: 0,
    files: 0,
    images: 0,
    approximateTokens: 10,
  },
  continuationCounts: {
    messages: 1,
    toolCalls: 0,
    files: 0,
    images: 0,
    approximateTokens: 12,
  },
  canUndoWithoutContinuations: false,
  mode: 'generation',
  sourceState: 'complete',
  destinationState: 'complete',
  copiedRootMessageId: 'copy-1',
  activeCopiedMessageId: 'copy-2',
  ...overrides,
});

function createGraftError(
  details: Partial<TGenerationGraftErrorResponse> & { error: string; code?: string },
) {
  const error = new Error(details.error) as Error & {
    response?: { data?: TGenerationGraftErrorResponse; status?: number };
    code?: string;
  };

  error.code = details.code;
  error.response = {
    status: details.code === 'GRAFT_HAS_CONTINUATIONS' ? 409 : 400,
    data: details,
  };

  return error;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

const createWrapper = (queryClient: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('useGenerationGraft', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockPreviewMutateAsync.mockReset();
    mockCreateMutateAsync.mockReset();
    mockUndoMutateAsync.mockReset();
    mockStopGenerating.mockReset();
    mockSetLatestMessage.mockReset();
    mockShowToast.mockReset();
    mockFetchStreamStatus.mockReset();
    mockUuid.mockReset();
    mockUuid
      .mockReturnValueOnce('uuid-1')
      .mockReturnValueOnce('uuid-2')
      .mockReturnValueOnce('uuid-3')
      .mockReturnValueOnce('uuid-4');
    mockPreviewMutateAsync.mockResolvedValue(createPreviewResponse());
    mockCreateMutateAsync.mockResolvedValue(createResult);
    mockUndoMutateAsync.mockResolvedValue({
      graftId: 'graft-1',
      deletedMessageIds: ['bridge-1', 'copy-1'],
      deletedCount: 2,
    });
    mockFetchStreamStatus.mockResolvedValue({ active: false, responseMessageId: null });
    mockedDataService.getGenerationGraft.mockReset();
    mockedDataService.getGenerationGraft.mockResolvedValue(createDetails());
    mockedDataService.undoGenerationGraft.mockReset();
    mockedDataService.undoGenerationGraft.mockResolvedValue({
      graftId: 'graft-1',
      deletedMessageIds: ['bridge-1', 'copy-1'],
      deletedCount: 2,
    } as never);
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  const setup = (overrides?: {
    graph?: ReturnType<typeof createGraph>;
    initialSourceMessageId?: string | null;
    treeRevision?: string;
    activeLeafMessageId?: string | null;
    sessionKey?: string;
    onFocusMessage?: jest.Mock;
    onFitSelection?: jest.Mock;
    onFitCreated?: jest.Mock;
  }) => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const refetchSpy = jest.spyOn(queryClient, 'refetchQueries');
    const wrapper = createWrapper(queryClient);
    const onFocusMessage = overrides?.onFocusMessage ?? jest.fn();
    const onFitSelection = overrides?.onFitSelection ?? jest.fn();
    const onFitCreated = overrides?.onFitCreated ?? jest.fn();
    const hook = renderHook(
      (props: {
        graph: ReturnType<typeof createGraph>;
        treeRevision: string;
        activeLeafMessageId: string | null;
        sessionKey: string;
      }) =>
        useGenerationGraft({
          conversationId: 'convo-1',
          graph: props.graph,
          initialSourceMessageId: overrides?.initialSourceMessageId ?? 'complete-source',
          treeRevision: props.treeRevision,
          activeLeafMessageId: props.activeLeafMessageId,
          sessionKey: props.sessionKey,
          onFocusMessage,
          onFitSelection,
          onFitCreated,
        }),
      {
        wrapper,
        initialProps: {
          graph: overrides?.graph ?? createGraph(),
          treeRevision: overrides?.treeRevision ?? 'tree-rev-1',
          activeLeafMessageId: overrides?.activeLeafMessageId ?? null,
          sessionKey: overrides?.sessionKey ?? 'session-1',
        },
      },
    );

    return { ...hook, queryClient, refetchSpy, onFocusMessage, onFitSelection, onFitCreated };
  };

  it.each([
    ['complete-source', 'complete-destination', 'complete', 'complete'],
    ['stopped-source', 'complete-destination', 'stopped_partial', 'complete'],
    ['complete-source', 'aborted-destination', 'complete', 'aborted_partial'],
    ['stopped-source', 'errored-destination', 'stopped_partial', 'errored_partial'],
  ])(
    'accepts stable lifecycle pairing %s -> %s',
    async (sourceMessageId, destinationMessageId, sourceState, destinationState) => {
      mockPreviewMutateAsync.mockResolvedValueOnce(
        createPreviewResponse({
          sourceMessageId,
          destinationMessageId,
          sourceState: sourceState as TGenerationGraftPreviewResponse['sourceState'],
          destinationState: destinationState as TGenerationGraftPreviewResponse['destinationState'],
        }),
      );
      const { result } = setup();

      act(() => {
        result.current.selectSourceMessage(sourceMessageId);
        result.current.selectDestinationMessage(destinationMessageId);
      });

      await act(async () => {
        await result.current.requestPreview(destinationMessageId);
      });

      expect(mockPreviewMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceMessageId,
          destinationMessageId,
        }),
      );
      expect(result.current.phase).toBe('ready');
      expect(result.current.preview?.sourceState).toBe(sourceState);
      expect(result.current.preview?.destinationState).toBe(destinationState);
    },
  );

  it('moves into stabilization for active source selections and stopAndGraft waits for stop, polls, refetches messages, and retries preview', async () => {
    const events: string[] = [];
    mockPreviewMutateAsync.mockImplementationOnce(async (payload) => {
      events.push(`preview:${payload.sourceMessageId}:${payload.destinationMessageId}`);
      return createPreviewResponse({
        sourceMessageId: 'streaming-source',
        destinationMessageId: 'complete-destination',
        activeSourceLeafMessageId: 'streaming-source',
      });
    });
    mockStopGenerating.mockImplementation(async () => {
      events.push('stop');
    });
    mockFetchStreamStatus
      .mockImplementationOnce(async () => {
        events.push('poll:1');
        return { active: true, responseMessageId: 'streaming-source' };
      })
      .mockImplementationOnce(async () => {
        events.push('poll:2');
        return { active: false, responseMessageId: null };
      });

    const { result, refetchSpy } = setup({
      graph: createGraph(['streaming-source']),
      initialSourceMessageId: 'streaming-source',
    });
    refetchSpy.mockImplementation(async () => {
      events.push('refetch');
      return undefined as never;
    });

    act(() => {
      result.current.selectDestinationMessage('complete-destination');
    });

    await act(async () => {
      await result.current.requestPreview('complete-destination');
    });

    expect(result.current.phase).toBe('stabilization');
    expect(result.current.stabilization?.activeMessageIds).toEqual(['streaming-source']);

    await act(async () => {
      const promise = result.current.stopAndGraft();
      await jest.advanceTimersByTimeAsync(500);
      await jest.advanceTimersByTimeAsync(500);
      await promise;
    });

    expect(mockStopGenerating).toHaveBeenCalledTimes(1);
    expect(mockFetchStreamStatus).toHaveBeenCalledTimes(2);
    expect(refetchSpy).toHaveBeenCalledWith({
      queryKey: [QueryKeys.messages, 'convo-1'],
    });
    expect(events).toEqual([
      'stop',
      'poll:1',
      'poll:2',
      'refetch',
      'preview:streaming-source:complete-destination',
    ]);
    expect(result.current.phase).toBe('ready');
  });

  it('moves into stabilization for active destination selections and waitForCompletion skips stop', async () => {
    mockPreviewMutateAsync.mockResolvedValueOnce(
      createPreviewResponse({
        destinationMessageId: 'streaming-destination',
      }),
    );
    mockFetchStreamStatus
      .mockResolvedValueOnce({ active: true, responseMessageId: 'streaming-destination' })
      .mockResolvedValueOnce({ active: false, responseMessageId: null });

    const { result } = setup({
      graph: createGraph(['streaming-destination']),
    });

    act(() => {
      result.current.selectDestinationMessage('streaming-destination');
    });

    await act(async () => {
      await result.current.requestPreview('streaming-destination');
    });

    await act(async () => {
      const promise = result.current.waitForCompletion();
      await jest.advanceTimersByTimeAsync(1_000);
      await promise;
    });

    expect(mockStopGenerating).not.toHaveBeenCalled();
    expect(result.current.phase).toBe('ready');
  });

  it('treats conversationActiveWithoutMessageId as active and times out after 30 seconds', async () => {
    mockPreviewMutateAsync.mockRejectedValueOnce(
      createGraftError({
        error: 'Conversation is still active.',
        code: 'GRAFT_REQUIRES_STABILIZATION',
        conversationActiveWithoutMessageId: true,
      }),
    );
    mockFetchStreamStatus.mockResolvedValue({ active: true, responseMessageId: null });

    const { result } = setup();

    act(() => {
      result.current.selectDestinationMessage('complete-destination');
    });

    await act(async () => {
      await result.current.requestPreview('complete-destination');
    });

    expect(result.current.stabilization?.conversationActiveWithoutMessageId).toBe(true);

    await act(async () => {
      const promise = result.current.waitForCompletion();
      await jest.advanceTimersByTimeAsync(30_000);
      await promise;
    });

    expect(result.current.phase).toBe('error');
    expect(result.current.error?.error).toBe(
      'The active generation did not stabilize within 30 seconds. Wait longer or stop it first.',
    );
  });

  it('ignores stale preview completions after the selection changes', async () => {
    const firstPreview = deferred<TGenerationGraftPreviewResponse>();
    mockPreviewMutateAsync.mockImplementation(() => firstPreview.promise);
    const { result } = setup();

    act(() => {
      result.current.selectDestinationMessage('complete-destination');
    });

    act(() => {
      void result.current.requestPreview('complete-destination');
    });

    act(() => {
      result.current.selectDestinationMessage('errored-destination');
    });

    firstPreview.resolve(
      createPreviewResponse({
        destinationMessageId: 'complete-destination',
      }),
    );
    await flushMicrotasks();

    expect(result.current.preview).toBeNull();
    expect(result.current.destinationMessageId).toBe('errored-destination');
    expect(result.current.phase).toBe('selecting');
  });

  it('reuses an idempotency key for the same create retry and regenerates it after selection, revision, and TREE_CHANGED refreshes', async () => {
    mockPreviewMutateAsync
      .mockResolvedValueOnce(createPreviewResponse())
      .mockResolvedValueOnce(
        createPreviewResponse({
          destinationMessageId: 'errored-destination',
        }),
      )
      .mockResolvedValueOnce(
        createPreviewResponse({
          destinationMessageId: 'errored-destination',
        }),
      )
      .mockResolvedValueOnce(
        createPreviewResponse({
          destinationMessageId: 'errored-destination',
        }),
      );
    const { result, rerender } = setup();

    act(() => {
      result.current.selectDestinationMessage('complete-destination');
    });

    await act(async () => {
      await result.current.requestPreview('complete-destination');
    });
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    mockCreateMutateAsync
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(createResult);

    let temporaryFailure: unknown;
    await act(async () => {
      try {
        await result.current.createGraft();
      } catch (error) {
        temporaryFailure = error;
      }
    });

    expect(temporaryFailure).toBeInstanceOf(Error);
    expect((temporaryFailure as Error).message).toBe('temporary failure');

    await act(async () => {
      await result.current.createGraft();
    });

    expect(mockCreateMutateAsync).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ idempotencyKey: 'uuid-1' }),
    );
    expect(mockCreateMutateAsync).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ idempotencyKey: 'uuid-1' }),
    );

    act(() => {
      result.current.selectDestinationMessage('errored-destination');
    });

    await act(async () => {
      await result.current.requestPreview('errored-destination');
    });
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    await act(async () => {
      await result.current.createGraft();
    });

    expect(mockCreateMutateAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ idempotencyKey: 'uuid-2' }),
    );

    rerender({
      graph: createGraph(),
      treeRevision: 'tree-rev-2',
      activeLeafMessageId: null,
      sessionKey: 'session-1',
    });
    await act(async () => {
      await result.current.requestPreview('errored-destination');
    });
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    await act(async () => {
      await result.current.createGraft();
    });

    expect(mockCreateMutateAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ idempotencyKey: 'uuid-3' }),
    );

    mockCreateMutateAsync.mockRejectedValueOnce(
      createGraftError({
        error: 'The conversation tree changed before the graft could be created.',
        code: 'TREE_CHANGED',
      }),
    );

    let treeChangedFailure: unknown;
    await act(async () => {
      try {
        await result.current.createGraft();
      } catch (error) {
        treeChangedFailure = error;
      }
    });

    expect(treeChangedFailure).toBeInstanceOf(Error);

    mockCreateMutateAsync.mockResolvedValueOnce(createResult);
    await act(async () => {
      await result.current.requestPreview('errored-destination');
    });
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    await act(async () => {
      await result.current.createGraft();
    });

    expect(mockCreateMutateAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ idempotencyKey: 'uuid-4' }),
    );
  });

  it('resets phase, destination, preview, created state, undo details, errors, and idempotency after the session key changes', async () => {
    const continuationConflict = createGraftError({
      error: 'The graft has continuations.',
      code: 'GRAFT_HAS_CONTINUATIONS',
      continuationMessageIds: ['later-1'],
    });
    mockUndoMutateAsync.mockRejectedValueOnce(continuationConflict);
    mockedDataService.undoGenerationGraft.mockRejectedValueOnce(continuationConflict as never);

    const { result, rerender } = setup({
      sessionKey: 'session-1',
    });

    act(() => {
      result.current.selectDestinationMessage('complete-destination');
    });

    await act(async () => {
      await result.current.requestPreview('complete-destination');
    });
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    await act(async () => {
      await result.current.createGraft();
    });
    await waitFor(() => expect(result.current.phase).toBe('created'));

    await act(async () => {
      await result.current.undoGraft();
    });
    await waitFor(() => expect(result.current.phase).toBe('undo-preview'));

    rerender({
      graph: createGraph(),
      treeRevision: 'tree-rev-1',
      activeLeafMessageId: null,
      sessionKey: 'session-2',
    });

    expect(result.current.phase).toBe('selecting');
    expect(result.current.sourceMessageId).toBe('complete-source');
    expect(result.current.destinationMessageId).toBeNull();
    expect(result.current.preview).toBeNull();
    expect(result.current.created).toBeNull();
    expect(result.current.undoDetails).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.stabilization).toBeNull();

    act(() => {
      result.current.selectDestinationMessage('complete-destination');
    });

    await act(async () => {
      await result.current.requestPreview('complete-destination');
    });
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    await act(async () => {
      await result.current.createGraft();
    });

    expect(mockCreateMutateAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ idempotencyKey: 'uuid-2' }),
    );
  });

  it('keeps stabilization alive across tree revision and active leaf churn, refetches messages, and retries preview with the latest revision exactly once', async () => {
    mockPreviewMutateAsync.mockResolvedValueOnce(
      createPreviewResponse({
        sourceMessageId: 'streaming-source',
        destinationMessageId: 'complete-destination',
        activeSourceLeafMessageId: 'streaming-source-child',
      }),
    );
    mockFetchStreamStatus
      .mockResolvedValueOnce({ active: true, responseMessageId: 'streaming-source' })
      .mockResolvedValueOnce({ active: false, responseMessageId: null });

    const { result, rerender, refetchSpy } = setup({
      graph: createGraph(['streaming-source']),
      initialSourceMessageId: 'streaming-source',
      activeLeafMessageId: 'streaming-source',
      treeRevision: 'tree-rev-1',
      sessionKey: 'session-1',
    });

    act(() => {
      result.current.selectDestinationMessage('complete-destination');
    });

    await act(async () => {
      await result.current.requestPreview('complete-destination');
    });

    expect(result.current.phase).toBe('stabilization');

    await act(async () => {
      const waitPromise = result.current.waitForCompletion();
      await Promise.resolve();
      rerender({
        graph: createGraph(),
        treeRevision: 'tree-rev-2',
        activeLeafMessageId: 'streaming-source-child',
        sessionKey: 'session-1',
      });
      await jest.advanceTimersByTimeAsync(500);
      await waitPromise;
    });

    expect(refetchSpy).toHaveBeenCalledWith({
      queryKey: [QueryKeys.messages, 'convo-1'],
    });
    expect(mockPreviewMutateAsync).toHaveBeenCalledTimes(1);
    expect(mockPreviewMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceMessageId: 'streaming-source',
        destinationMessageId: 'complete-destination',
        sourceActiveLeafMessageId: 'streaming-source-child',
        expectedTreeRevision: 'tree-rev-2',
      }),
    );
    expect(result.current.phase).toBe('ready');
  });

  it('sets latest/focus/fit and shows a 10-second Undo toast after create', async () => {
    const { result, onFocusMessage, onFitCreated } = setup();

    act(() => {
      result.current.selectDestinationMessage('complete-destination');
    });

    await act(async () => {
      await result.current.requestPreview('complete-destination');
    });
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    await act(async () => {
      await result.current.createGraft();
    });

    expect(result.current.phase).toBe('created');
    expect(mockSetLatestMessage).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'copy-3' }),
    );
    expect(onFocusMessage).toHaveBeenCalledWith('copy-3');
    expect(onFitCreated).toHaveBeenCalledWith(['bridge-1', 'copy-1', 'copy-2', 'copy-3']);
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Generation graft created.',
        actionLabel: 'Undo',
        duration: 10_000,
      }),
    );
  });

  it('binds each toast undo action to the graft that created that toast, even after another graft is created later', async () => {
    mockCreateMutateAsync
      .mockResolvedValueOnce(
        createCreateResult({
          graftId: 'graft-a',
          bridgeMessageId: 'bridge-a',
          copiedRootMessageId: 'copy-a-1',
          activeCopiedMessageId: 'copy-a-2',
          createdMessages: [
            { messageId: 'bridge-a', conversationId: 'convo-1', text: 'Bridge A' } as never,
            { messageId: 'copy-a-1', conversationId: 'convo-1', text: 'Copy A1' } as never,
            { messageId: 'copy-a-2', conversationId: 'convo-1', text: 'Copy A2' } as never,
          ],
        }),
      )
      .mockResolvedValueOnce(
        createCreateResult({
          graftId: 'graft-b',
          bridgeMessageId: 'bridge-b',
          copiedRootMessageId: 'copy-b-1',
          activeCopiedMessageId: 'copy-b-2',
          createdMessages: [
            { messageId: 'bridge-b', conversationId: 'convo-1', text: 'Bridge B' } as never,
            { messageId: 'copy-b-1', conversationId: 'convo-1', text: 'Copy B1' } as never,
            { messageId: 'copy-b-2', conversationId: 'convo-1', text: 'Copy B2' } as never,
          ],
        }),
      );

    const { result } = setup();

    act(() => {
      result.current.selectDestinationMessage('complete-destination');
    });

    await act(async () => {
      await result.current.requestPreview('complete-destination');
    });
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    await act(async () => {
      await result.current.createGraft();
    });

    act(() => {
      result.current.selectDestinationMessage('errored-destination');
    });

    await act(async () => {
      await result.current.requestPreview('errored-destination');
    });
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    await act(async () => {
      await result.current.createGraft();
    });

    const firstToast = mockShowToast.mock.calls[0]?.[0];
    expect(firstToast).toBeDefined();

    await act(async () => {
      firstToast.onAction();
      await Promise.resolve();
    });

    expect(mockedDataService.undoGenerationGraft).toHaveBeenCalledWith('convo-1', 'graft-a', {
      includeContinuations: false,
    });
    expect(mockedDataService.undoGenerationGraft).not.toHaveBeenCalledWith(
      'convo-1',
      'graft-b',
      expect.anything(),
    );
  });

  it('performs a safe undo and exits created state on success', async () => {
    const { result } = setup();

    act(() => {
      result.current.selectDestinationMessage('complete-destination');
    });

    await act(async () => {
      await result.current.requestPreview('complete-destination');
    });
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    await act(async () => {
      await result.current.createGraft();
    });
    await waitFor(() => expect(result.current.phase).toBe('created'));

    await act(async () => {
      await result.current.undoGraft();
    });

    expect(mockedDataService.undoGenerationGraft).toHaveBeenCalledWith('convo-1', 'graft-1', {
      includeContinuations: false,
    });
    expect(result.current.phase).toBe('selecting');
    expect(result.current.created).toBeNull();
  });

  it('prevents overlapping stabilization loops from stop double clicks', async () => {
    mockPreviewMutateAsync.mockResolvedValueOnce(
      createPreviewResponse({
        sourceMessageId: 'streaming-source',
        destinationMessageId: 'complete-destination',
        activeSourceLeafMessageId: 'streaming-source',
      }),
    );
    mockFetchStreamStatus
      .mockResolvedValueOnce({ active: true, responseMessageId: 'streaming-source' })
      .mockResolvedValueOnce({ active: false, responseMessageId: null });

    const { result } = setup({
      graph: createGraph(['streaming-source']),
      initialSourceMessageId: 'streaming-source',
    });

    act(() => {
      result.current.selectDestinationMessage('complete-destination');
    });

    await act(async () => {
      await result.current.requestPreview('complete-destination');
    });
    expect(result.current.phase).toBe('stabilization');

    await act(async () => {
      const firstStop = result.current.stopAndGraft();
      const secondStop = result.current.stopAndGraft();
      await jest.advanceTimersByTimeAsync(500);
      await Promise.all([firstStop, secondStop]);
    });

    expect(mockStopGenerating).toHaveBeenCalledTimes(1);
    expect(mockFetchStreamStatus).toHaveBeenCalledTimes(2);
  });

  it('loads continuation details after a safe undo conflict and requires an explicit destructive confirmation for includeContinuations=true', async () => {
    const continuationConflict = createGraftError({
      error: 'The graft has continuations.',
      code: 'GRAFT_HAS_CONTINUATIONS',
      continuationMessageIds: ['later-1'],
    });
    mockUndoMutateAsync.mockRejectedValueOnce(continuationConflict).mockResolvedValueOnce({
      graftId: 'graft-1',
      deletedMessageIds: ['bridge-1', 'copy-1', 'later-1'],
      deletedCount: 3,
    });
    mockedDataService.undoGenerationGraft
      .mockRejectedValueOnce(continuationConflict as never)
      .mockResolvedValueOnce({
        graftId: 'graft-1',
        deletedMessageIds: ['bridge-1', 'copy-1', 'later-1'],
        deletedCount: 3,
      } as never);

    const { result } = setup();

    act(() => {
      result.current.selectDestinationMessage('complete-destination');
    });

    await act(async () => {
      await result.current.requestPreview('complete-destination');
    });
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    await act(async () => {
      await result.current.createGraft();
    });
    await waitFor(() => expect(result.current.phase).toBe('created'));

    await act(async () => {
      await result.current.undoGraft();
    });

    expect(mockedDataService.getGenerationGraft).toHaveBeenCalledWith('convo-1', 'graft-1');
    expect(result.current.phase).toBe('undo-preview');
    expect(result.current.undoDetails?.continuationMessageIds).toEqual(['later-1']);

    await act(async () => {
      await result.current.confirmUndoContinuations();
    });

    expect(mockedDataService.undoGenerationGraft).toHaveBeenNthCalledWith(2, 'convo-1', 'graft-1', {
      includeContinuations: true,
    });
    expect(result.current.phase).toBe('selecting');
  });

  it('prevents overlapping safe undo requests from double clicks', async () => {
    const undoRequest = deferred<{
      graftId: string;
      deletedMessageIds: string[];
      deletedCount: number;
    }>();
    mockedDataService.undoGenerationGraft.mockImplementationOnce(
      () => undoRequest.promise as never,
    );

    const { result } = setup();

    act(() => {
      result.current.selectDestinationMessage('complete-destination');
    });

    await act(async () => {
      await result.current.requestPreview('complete-destination');
    });
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    await act(async () => {
      await result.current.createGraft();
    });
    await waitFor(() => expect(result.current.phase).toBe('created'));

    act(() => {
      void result.current.undoGraft();
      void result.current.undoGraft();
    });

    expect(mockedDataService.undoGenerationGraft).toHaveBeenCalledTimes(1);

    await act(async () => {
      undoRequest.resolve({
        graftId: 'graft-1',
        deletedMessageIds: ['bridge-1', 'copy-1'],
        deletedCount: 2,
      });
      await Promise.resolve();
    });
  });

  it('recovers when continuation details fail to load and allows a retry without leaving undoing state stuck', async () => {
    const continuationConflict = createGraftError({
      error: 'The graft has continuations.',
      code: 'GRAFT_HAS_CONTINUATIONS',
      continuationMessageIds: ['later-1'],
    });
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mockUndoMutateAsync
        .mockRejectedValueOnce(continuationConflict)
        .mockRejectedValueOnce(continuationConflict);
      mockedDataService.undoGenerationGraft
        .mockRejectedValueOnce(continuationConflict as never)
        .mockRejectedValueOnce(continuationConflict as never);
      mockedDataService.getGenerationGraft
        .mockRejectedValueOnce(new Error('details unavailable'))
        .mockResolvedValueOnce(createDetails());

      const { result } = setup();

      act(() => {
        result.current.selectDestinationMessage('complete-destination');
      });

      await act(async () => {
        await result.current.requestPreview('complete-destination');
      });
      await waitFor(() => expect(result.current.phase).toBe('ready'));

      await act(async () => {
        await result.current.createGraft();
      });
      await waitFor(() => expect(result.current.phase).toBe('created'));

      await act(async () => {
        await result.current.undoGraft();
      });

      expect(result.current.phase).toBe('created');
      expect(result.current.created?.graftId).toBe('graft-1');
      expect(result.current.error?.error).toBe(
        'Could not load continuation details. Try Undo again.',
      );

      await act(async () => {
        await result.current.undoGraft();
      });

      expect(result.current.phase).toBe('undo-preview');
      expect(result.current.undoDetails?.graftId).toBe('graft-1');
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('clears timers on unmount and ignores late async completions', async () => {
    const latePreview = deferred<TGenerationGraftPreviewResponse>();
    mockPreviewMutateAsync.mockImplementationOnce(() => latePreview.promise);
    const { result, unmount } = setup();

    act(() => {
      result.current.selectDestinationMessage('complete-destination');
    });

    act(() => {
      void result.current.requestPreview('complete-destination');
    });

    unmount();

    latePreview.resolve(createPreviewResponse());
    await flushMicrotasks();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5_000);
    });

    expect(mockShowToast).not.toHaveBeenCalled();
    expect(mockSetLatestMessage).not.toHaveBeenCalled();
  });
});
