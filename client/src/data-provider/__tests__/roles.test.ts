import { useQuery } from '@tanstack/react-query';
import { useGetRole } from '../roles';

jest.mock('@tanstack/react-query', () => ({
  useMutation: jest.fn(),
  useQuery: jest.fn(),
  useQueryClient: jest.fn(),
}));

jest.mock('librechat-data-provider', () => ({
  QueryKeys: { roles: 'roles' },
  dataService: { getRole: jest.fn() },
  promptPermissionsSchema: {},
  memoryPermissionsSchema: {},
  mcpServersPermissionsSchema: {},
  marketplacePermissionsSchema: {},
  peoplePickerPermissionsSchema: {},
  remoteAgentsPermissionsSchema: {},
}));

const mockUseQuery = useQuery as jest.MockedFunction<typeof useQuery>;

function getRoleQueryOptions() {
  mockUseQuery.mockReturnValue({} as ReturnType<typeof useQuery>);
  useGetRole('USER');
  return mockUseQuery.mock.calls[0][2];
}

describe('useGetRole query options', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('retries transient network and 5xx errors up to three times', () => {
    const options = getRoleQueryOptions();
    const retry = options.retry as (failureCount: number, error: unknown) => boolean;
    const networkError = new Error('network unavailable');
    const serverError = { response: { status: 503 } };

    for (const error of [networkError, serverError]) {
      expect(retry(0, error)).toBe(true);
      expect(retry(1, error)).toBe(true);
      expect(retry(2, error)).toBe(true);
      expect(retry(3, error)).toBe(false);
    }
  });

  it('does not retry non-retryable 4xx errors', () => {
    const options = getRoleQueryOptions();
    const retry = options.retry as (failureCount: number, error: unknown) => boolean;

    for (const status of [400, 401, 403, 404]) {
      expect(retry(0, { response: { status } })).toBe(false);
    }
  });

  it('refetches on reconnect and every mount', () => {
    const options = getRoleQueryOptions();

    expect(options.refetchOnReconnect).toBe(true);
    expect(options.refetchOnMount).toBe('always');
  });
});
