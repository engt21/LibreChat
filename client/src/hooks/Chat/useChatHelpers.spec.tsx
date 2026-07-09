import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QueryKeys } from 'librechat-data-provider';

type MockConversation = {
  conversationId?: string;
  endpoint?: string;
  endpointType?: string;
};

type MockMessage = {
  messageId?: string;
  conversationId?: string;
  parentMessageId?: string | null;
  depth?: number;
};

const mockClearAllSubmissions = jest.fn();
const mockSetConversation = jest.fn();
const mockAsk = jest.fn();
const mockRegenerate = jest.fn();
const mockNewConversation = jest.fn();
const mockStopMutateAsync = jest.fn();
const mockAbortMutateAsync = jest.fn();
const mockSetSiblingIdx = jest.fn();
const mockSetSubmission = jest.fn();
const mockResetLatestMessage = jest.fn();
const mockSetLatestMessage = jest.fn();

const createDeferred = <T,>() => {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
};

const atoms = {
  files: { key: 'files' },
  latestMessage: { key: 'latestMessage' },
  isSubmitting: { key: 'isSubmitting' },
  showStopButton: { key: 'showStopButton' },
  siblingIdx: { key: 'siblingIdx' },
  submission: { key: 'submission' },
  preset: { key: 'preset' },
  showPopover: { key: 'showPopover' },
  abortScroll: { key: 'abortScroll' },
  optionSettings: { key: 'optionSettings' },
};

let mockConversation: MockConversation;
let mockLatestMessage: MockMessage | null;
let mockIsSubmitting = true;
let mockShowStopButton = true;

jest.mock('recoil', () => ({
  useRecoilCallback: jest.fn((factory) => factory({ set: jest.fn() })),
  useRecoilState: jest.fn(),
  useRecoilValue: jest.fn(),
  useResetRecoilState: jest.fn(),
  useSetRecoilState: jest.fn(),
}));

jest.mock('~/store', () => ({
  __esModule: true,
  default: {
    useClearSubmissionState: jest.fn(() => mockClearAllSubmissions),
    filesByIndex: jest.fn(() => atoms.files),
    useCreateConversationAtom: jest.fn(() => ({
      conversation: mockConversation,
      setConversation: mockSetConversation,
    })),
    latestMessageFamily: jest.fn(() => atoms.latestMessage),
    isSubmittingFamily: jest.fn(() => atoms.isSubmitting),
    showStopButtonByIndex: jest.fn(() => atoms.showStopButton),
    messagesSiblingIdxFamily: jest.fn(() => atoms.siblingIdx),
    submissionByIndex: jest.fn(() => atoms.submission),
    presetByIndex: jest.fn(() => atoms.preset),
    showPopoverFamily: jest.fn(() => atoms.showPopover),
    abortScrollFamily: jest.fn(() => atoms.abortScroll),
    optionSettingsFamily: jest.fn(() => atoms.optionSettings),
  },
}));

jest.mock('~/data-provider', () => ({
  useAbortStreamMutation: jest.fn(() => ({ mutateAsync: mockAbortMutateAsync })),
  useStopGenerationMutation: jest.fn(() => ({ mutateAsync: mockStopMutateAsync })),
  useGetStartupConfig: jest.fn(() => ({ data: {} })),
  useGetUserQuery: jest.fn(() => ({ data: {} })),
}));

jest.mock('./useChatFunctions', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    ask: mockAsk,
    regenerate: mockRegenerate,
  })),
}));

jest.mock('../useNewConvo', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    newConversation: mockNewConversation,
  })),
}));

describe('useChatHelpers stopGenerating', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConversation = {
      conversationId: 'convo-1',
      endpoint: 'openAI',
    };
    mockLatestMessage = {
      messageId: 'message-1',
      conversationId: 'convo-1',
      parentMessageId: 'parent-1',
      depth: 3,
    };

    const recoil = jest.requireMock('recoil');
    recoil.useRecoilState.mockImplementation((atom: { key: string }) => {
      if (atom === atoms.files) {
        return [[], jest.fn()];
      }

      if (atom === atoms.isSubmitting) {
        return [mockIsSubmitting, jest.fn()];
      }

      if (atom === atoms.latestMessage) {
        return [mockLatestMessage, mockSetLatestMessage];
      }

      if (atom === atoms.preset) {
        return [null, jest.fn()];
      }

      if (atom === atoms.showPopover) {
        return [false, jest.fn()];
      }

      if (atom === atoms.abortScroll) {
        return [false, jest.fn()];
      }

      if (atom === atoms.optionSettings) {
        return [{}, jest.fn()];
      }

      return [null, jest.fn()];
    });
    recoil.useRecoilValue.mockImplementation((atom: { key: string }) => {
      if (atom === atoms.showStopButton) {
        return mockShowStopButton;
      }

      return null;
    });
    recoil.useSetRecoilState.mockImplementation((atom: { key: string }) => {
      if (atom === atoms.siblingIdx) {
        return mockSetSiblingIdx;
      }

      if (atom === atoms.submission) {
        return mockSetSubmission;
      }

      return jest.fn();
    });
    recoil.useResetRecoilState.mockImplementation(() => mockResetLatestMessage);
  });

  const createWrapper = (queryClient: QueryClient) =>
    function Wrapper({ children }: { children: React.ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    };

  const loadUseChatHelpers = () =>
    require('./useChatHelpers').default as typeof import('./useChatHelpers').default;

  it('waits for non-assistant stop settlement before clearing or invalidating while optimistically removing active jobs', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
    const wrapper = createWrapper(queryClient);
    const useChatHelpers = loadUseChatHelpers();

    const deferredStop = createDeferred<{ success: boolean }>();
    mockStopMutateAsync.mockReturnValueOnce(deferredStop.promise);
    queryClient.setQueryData([QueryKeys.activeJobs], {
      activeJobIds: ['convo-1', 'convo-2'],
    });

    const { result } = renderHook(() => useChatHelpers(0, 'convo-1'), { wrapper });

    let pendingStop: Promise<void> | undefined;
    act(() => {
      pendingStop = result.current.stopGenerating();
    });

    expect(mockClearAllSubmissions).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(queryClient.getQueryData([QueryKeys.activeJobs])).toEqual({
      activeJobIds: ['convo-2'],
    });

    await act(async () => {
      deferredStop.resolve({ success: true });
      await pendingStop;
    });

    await waitFor(() => {
      expect(mockClearAllSubmissions).toHaveBeenCalledTimes(1);
    });
    expect(mockStopMutateAsync).toHaveBeenCalledWith({
      conversationId: 'convo-1',
      endpoint: 'openAI',
      latestMessageId: 'message-1',
    });
    expect(invalidateSpy).toHaveBeenCalledWith([QueryKeys.messages, 'convo-1']);
  });

  it('waits for assistant stop settlement before clearing or invalidating and leaves active jobs untouched', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
    const wrapper = createWrapper(queryClient);
    const useChatHelpers = loadUseChatHelpers();

    mockConversation = {
      conversationId: 'convo-1',
      endpoint: 'assistants',
    };

    const deferredStop = createDeferred<{ success: boolean }>();
    mockStopMutateAsync.mockReturnValueOnce(deferredStop.promise);
    queryClient.setQueryData([QueryKeys.activeJobs], {
      activeJobIds: ['convo-1', 'convo-2'],
    });

    const { result } = renderHook(() => useChatHelpers(0, 'convo-1'), { wrapper });

    let pendingStop: Promise<void> | undefined;
    act(() => {
      pendingStop = result.current.stopGenerating();
    });

    expect(mockStopMutateAsync).toHaveBeenCalledWith({
      conversationId: 'convo-1',
      endpoint: 'assistants',
      latestMessageId: 'message-1',
    });
    expect(mockClearAllSubmissions).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(queryClient.getQueryData([QueryKeys.activeJobs])).toEqual({
      activeJobIds: ['convo-1', 'convo-2'],
    });

    await act(async () => {
      deferredStop.resolve({ success: true });
      await pendingStop;
    });

    await waitFor(() => {
      expect(mockClearAllSubmissions).toHaveBeenCalledTimes(1);
    });
    expect(invalidateSpy).toHaveBeenCalledWith([QueryKeys.messages, 'convo-1']);
  });

  it('still clears once and invalidates messages when stop generation fails', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
    const wrapper = createWrapper(queryClient);
    const useChatHelpers = loadUseChatHelpers();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    mockStopMutateAsync.mockRejectedValueOnce(new Error('stop failed'));

    const { result } = renderHook(() => useChatHelpers(0, 'convo-1'), { wrapper });

    await act(async () => {
      await result.current.stopGenerating();
    });

    expect(errorSpy).toHaveBeenCalled();
    expect(mockClearAllSubmissions).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith([QueryKeys.messages, 'convo-1']);

    errorSpy.mockRestore();
  });
});
