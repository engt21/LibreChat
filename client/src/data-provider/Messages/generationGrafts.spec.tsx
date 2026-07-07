import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as ReactQuery from '@tanstack/react-query';
import { QueryKeys, dataService, request } from 'librechat-data-provider';

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');

  return {
    ...actual,
    apiBaseUrl: jest.fn(() => '/api-base'),
    EndpointURLs: {
      ...actual.EndpointURLs,
      assistants: '/api-base/api/assistants/v2/chat',
      azureAssistants: '/api-base/api/assistants/v1/chat',
      agents: '/api-base/api/agents/chat',
    },
    request: {
      post: jest.fn(),
      get: jest.fn(),
      deleteWithOptions: jest.fn(),
    },
    dataService: {
      ...actual.dataService,
      previewGenerationGraft: jest.fn(),
      createGenerationGraft: jest.fn(),
      getGenerationGraft: jest.fn(),
      undoGenerationGraft: jest.fn(),
    },
  };
});

type InvalidateArg = Parameters<QueryClient['invalidateQueries']>[0];

const mockedRequest = request as jest.Mocked<typeof request>;
const mockedDataService = dataService as jest.Mocked<typeof dataService>;

const createWrapper = (queryClient: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };

const loadSSEMutations = () => require('../SSE/mutations') as typeof import('../SSE/mutations');
const loadSSEQueries = () => require('../SSE/queries') as typeof import('../SSE/queries');
const loadGenerationGrafts = () =>
  require('./generationGrafts') as typeof import('./generationGrafts');
const loadMessagesIndex = () => require('./index') as typeof import('./index');

const wasInvalidated = (calls: Array<[InvalidateArg]>, expectedKey: unknown[]) =>
  calls.some(([arg]) => {
    if (Array.isArray(arg)) {
      return JSON.stringify(arg) === JSON.stringify(expectedKey);
    }

    return JSON.stringify(arg?.queryKey) === JSON.stringify(expectedKey);
  });

describe('generation graft client hooks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRequest.post.mockResolvedValue({ success: true } as never);
    mockedRequest.get.mockResolvedValue({ active: false } as never);
    mockedDataService.previewGenerationGraft.mockResolvedValue({} as never);
    mockedDataService.createGenerationGraft.mockResolvedValue({
      graftId: 'graft-1',
      bridgeMessageId: 'bridge-1',
      copiedRootMessageId: 'copy-1',
      activeCopiedMessageId: 'copy-2',
      copiedMessageCount: 3,
      createdMessages: [],
    } as never);
    mockedDataService.getGenerationGraft.mockResolvedValue({ graftId: 'graft-1' } as never);
    mockedDataService.undoGenerationGraft.mockResolvedValue({
      graftId: 'graft-1',
      deletedCount: 1,
      deletedMessageIds: ['copy-1'],
    } as never);
  });

  it('routes non-assistant providers through the shared abort endpoint', async () => {
    const { stopGeneration } = loadSSEMutations();

    await stopGeneration({
      conversationId: 'convo-1',
      endpoint: 'openAI',
      latestMessageId: 'message-1',
    });

    expect(mockedRequest.post).toHaveBeenCalledWith('/api-base/api/agents/chat/abort', {
      conversationId: 'convo-1',
    });
  });

  it('routes assistants and azure assistants through provider abort without double-prefixing', async () => {
    const { stopGeneration } = loadSSEMutations();

    await stopGeneration({
      conversationId: 'convo-1',
      endpoint: 'assistants',
      latestMessageId: 'message-1',
    });

    await stopGeneration({
      conversationId: 'convo-2',
      endpoint: 'azureAssistants',
      latestMessageId: 'message-2',
    });

    expect(mockedRequest.post).toHaveBeenNthCalledWith(
      1,
      '/api-base/api/assistants/v2/chat/abort',
      {
        abortKey: 'convo-1:message-1',
        endpoint: 'assistants',
      },
    );
    expect(mockedRequest.post).toHaveBeenNthCalledWith(
      2,
      '/api-base/api/assistants/v1/chat/abort',
      {
        abortKey: 'convo-2:message-2',
        endpoint: 'azureAssistants',
      },
    );
    expect(mockedRequest.post).not.toHaveBeenCalledWith(
      expect.stringContaining('/api-base/api-base/'),
      expect.anything(),
    );
  });

  it('passes polling intervals to useStreamStatus', () => {
    const useQuerySpy = jest.spyOn(ReactQuery, 'useQuery').mockReturnValue({} as never);
    const { useStreamStatus } = loadSSEQueries();

    renderHook(() => useStreamStatus('convo-1', true, 2500));

    expect(useQuerySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['streamStatus', 'convo-1'],
        enabled: true,
        refetchInterval: 2500,
        retry: false,
      }),
    );

    useQuerySpy.mockRestore();
  });

  it('exports generation graft hooks from the Messages barrel', () => {
    const messagesModule = loadMessagesIndex();

    expect(typeof messagesModule.usePreviewGenerationGraft).toBe('function');
    expect(typeof messagesModule.useCreateGenerationGraft).toBe('function');
    expect(typeof messagesModule.useGenerationGraftDetails).toBe('function');
    expect(typeof messagesModule.useUndoGenerationGraft).toBe('function');
  });

  it('calls preview and details data services with conversation and graft identifiers', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const wrapper = createWrapper(queryClient);
    const previewPayload = {
      sourceMessageId: 'source-root',
      destinationMessageId: 'destination',
      mode: 'generation' as const,
    };
    const { usePreviewGenerationGraft, useGenerationGraftDetails } = loadGenerationGrafts();

    const previewHook = renderHook(() => usePreviewGenerationGraft('convo-1'), { wrapper });
    await act(async () => {
      await previewHook.result.current.mutateAsync(previewPayload);
    });

    expect(mockedDataService.previewGenerationGraft).toHaveBeenCalledWith(
      'convo-1',
      previewPayload,
    );

    renderHook(() => useGenerationGraftDetails('convo-1', 'graft-1', true), { wrapper });

    await waitFor(() => {
      expect(mockedDataService.getGenerationGraft).toHaveBeenCalledWith('convo-1', 'graft-1');
    });
  });

  it('disables generation graft details queries without both identifiers and retries', () => {
    const useQuerySpy = jest.spyOn(ReactQuery, 'useQuery').mockReturnValue({} as never);
    const {
      useGenerationGraftDetails,
      generationGraftDetailsQueryKey,
      generationGraftDetailsQueryKeyPrefix,
    } = loadGenerationGrafts();

    renderHook(() => useGenerationGraftDetails('', '', true));

    expect(useQuerySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
        retry: false,
      }),
    );
    expect(generationGraftDetailsQueryKey('convo-1', 'graft-1')).toEqual([
      ...generationGraftDetailsQueryKeyPrefix('convo-1'),
      'graft-1',
    ]);

    useQuerySpy.mockRestore();
  });

  it('appends created graft messages once, preserves order, and invalidates related prefixes', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
    const wrapper = createWrapper(queryClient);
    const existingMessages = [{ messageId: 'existing-1', text: 'Existing' }];
    const createdMessages = [
      { messageId: 'bridge-1', text: 'Bridge' },
      { messageId: 'copy-1', text: 'Copy 1' },
      { messageId: 'copy-1', text: 'Copy 1 duplicate' },
      { messageId: 'copy-2', text: 'Copy 2' },
    ];

    queryClient.setQueryData([QueryKeys.messages, 'convo-1'], existingMessages);
    mockedDataService.createGenerationGraft.mockResolvedValueOnce({
      graftId: 'graft-1',
      bridgeMessageId: 'bridge-1',
      copiedRootMessageId: 'copy-1',
      activeCopiedMessageId: 'copy-2',
      copiedMessageCount: 3,
      createdMessages,
    } as never);

    const { useCreateGenerationGraft } = loadGenerationGrafts();
    const { result } = renderHook(() => useCreateGenerationGraft('convo-1'), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        sourceMessageId: 'source-root',
        destinationMessageId: 'destination',
        mode: 'generation',
        idempotencyKey: 'idem-1',
        expectedTreeRevision: 'rev-1',
      });
    });

    expect(mockedDataService.createGenerationGraft).toHaveBeenCalledWith('convo-1', {
      sourceMessageId: 'source-root',
      destinationMessageId: 'destination',
      mode: 'generation',
      idempotencyKey: 'idem-1',
      expectedTreeRevision: 'rev-1',
    });
    expect(queryClient.getQueryData([QueryKeys.messages, 'convo-1'])).toEqual([
      { messageId: 'existing-1', text: 'Existing' },
      { messageId: 'bridge-1', text: 'Bridge' },
      { messageId: 'copy-1', text: 'Copy 1' },
      { messageId: 'copy-2', text: 'Copy 2' },
    ]);
    expect(
      wasInvalidated(invalidateSpy.mock.calls as Array<[InvalidateArg]>, [
        QueryKeys.messages,
        'convo-1',
      ]),
    ).toBe(true);
    expect(
      wasInvalidated(invalidateSpy.mock.calls as Array<[InvalidateArg]>, [
        QueryKeys.toolCalls,
        'convo-1',
      ]),
    ).toBe(true);
    expect(
      wasInvalidated(invalidateSpy.mock.calls as Array<[InvalidateArg]>, [
        QueryKeys.conversationUsage,
        'convo-1',
      ]),
    ).toBe(true);
    expect(
      wasInvalidated(invalidateSpy.mock.calls as Array<[InvalidateArg]>, [
        'generationGraft',
        'convo-1',
      ]),
    ).toBe(true);
  });

  it('uses created messages as the cache when no messages are cached yet', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const wrapper = createWrapper(queryClient);
    mockedDataService.createGenerationGraft.mockResolvedValueOnce({
      graftId: 'graft-1',
      bridgeMessageId: 'bridge-1',
      copiedRootMessageId: 'copy-1',
      activeCopiedMessageId: 'copy-1',
      copiedMessageCount: 2,
      createdMessages: [
        { messageId: 'bridge-1', text: 'Bridge' },
        { messageId: 'bridge-1', text: 'Bridge duplicate' },
        { messageId: 'copy-1', text: 'Copy 1' },
      ],
    } as never);

    const { useCreateGenerationGraft } = loadGenerationGrafts();
    const { result } = renderHook(() => useCreateGenerationGraft('convo-1'), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        sourceMessageId: 'source-root',
        destinationMessageId: 'destination',
        mode: 'generation',
        idempotencyKey: 'idem-1',
        expectedTreeRevision: 'rev-1',
      });
    });

    expect(queryClient.getQueryData([QueryKeys.messages, 'convo-1'])).toEqual([
      { messageId: 'bridge-1', text: 'Bridge' },
      { messageId: 'copy-1', text: 'Copy 1' },
    ]);
  });

  it('calls undo generation graft and invalidates related prefixes', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
    const wrapper = createWrapper(queryClient);
    const { useUndoGenerationGraft } = loadGenerationGrafts();
    const { result } = renderHook(() => useUndoGenerationGraft('convo-1', 'graft-1'), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({ includeContinuations: true });
    });

    expect(mockedDataService.undoGenerationGraft).toHaveBeenCalledWith('convo-1', 'graft-1', {
      includeContinuations: true,
    });
    expect(
      wasInvalidated(invalidateSpy.mock.calls as Array<[InvalidateArg]>, [
        QueryKeys.messages,
        'convo-1',
      ]),
    ).toBe(true);
    expect(
      wasInvalidated(invalidateSpy.mock.calls as Array<[InvalidateArg]>, [
        QueryKeys.toolCalls,
        'convo-1',
      ]),
    ).toBe(true);
    expect(
      wasInvalidated(invalidateSpy.mock.calls as Array<[InvalidateArg]>, [
        QueryKeys.conversationUsage,
        'convo-1',
      ]),
    ).toBe(true);
    expect(
      wasInvalidated(invalidateSpy.mock.calls as Array<[InvalidateArg]>, [
        'generationGraft',
        'convo-1',
      ]),
    ).toBe(true);
  });

  it('preserves authoritative generation graft detail fields from the server response', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const wrapper = createWrapper(queryClient);
    mockedDataService.getGenerationGraft.mockResolvedValueOnce({
      graftId: 'graft-1',
      bridgeMessageId: 'bridge-1',
      copiedMessageIds: ['copy-1'],
      continuationMessageIds: ['later-1'],
      copiedCounts: {
        messages: 1,
        toolCalls: 0,
        files: 0,
        images: 0,
        approximateTokens: 16,
      },
      continuationCounts: {
        messages: 1,
        toolCalls: 1,
        files: 0,
        images: 0,
        approximateTokens: 20,
      },
      canUndoWithoutContinuations: false,
      mode: 'subtree',
      sourceState: 'complete',
      destinationState: 'aborted_partial',
      copiedRootMessageId: 'copy-1',
      activeCopiedMessageId: 'copy-2',
    } as never);

    const { useGenerationGraftDetails } = loadGenerationGrafts();
    const { result } = renderHook(() => useGenerationGraftDetails('convo-1', 'graft-1', true), {
      wrapper,
    });

    await waitFor(() =>
      expect(result.current.data).toMatchObject({
        graftId: 'graft-1',
        mode: 'subtree',
        sourceState: 'complete',
        destinationState: 'aborted_partial',
        copiedRootMessageId: 'copy-1',
        activeCopiedMessageId: 'copy-2',
        continuationMessageIds: ['later-1'],
      }),
    );
  });
});
