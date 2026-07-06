import { fireEvent, render, screen } from '@testing-library/react';
import DeepResearch from './DeepResearch';

const mockDebouncedChange = jest.fn();
let mockSupportsDeepResearch = true;
let mockToggleState = true;
let mockIsPinned = false;
let mockHasAccess = true;

jest.mock('@librechat/client', () => ({
  CheckboxButton: ({ checked, setValue, label }: any) => (
    <button type="button" aria-pressed={checked} onClick={() => setValue({ value: !checked })}>
      {label}
    </button>
  ),
}));

jest.mock('~/Providers', () => ({
  useBadgeRowContext: () => ({
    supportsDeepResearch: mockSupportsDeepResearch,
    deepResearch: {
      toggleState: mockToggleState,
      isPinned: mockIsPinned,
      debouncedChange: mockDebouncedChange,
    },
  }),
}));

jest.mock('~/hooks', () => ({
  useHasAccess: () => mockHasAccess,
  useLocalize: () => (key: string) => (key === 'com_ui_deep_research' ? 'Deep Research' : key),
}));

describe('DeepResearch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSupportsDeepResearch = true;
    mockToggleState = true;
    mockIsPinned = false;
    mockHasAccess = true;
  });

  it('renders and toggles for supported OpenAI chats', () => {
    render(<DeepResearch />);

    fireEvent.click(screen.getByRole('button', { name: 'Deep Research' }));

    expect(mockDebouncedChange).toHaveBeenCalledWith({ value: false });
  });

  it('stays hidden without capability or permission', () => {
    mockSupportsDeepResearch = false;
    render(<DeepResearch />);
    expect(screen.queryByRole('button', { name: 'Deep Research' })).not.toBeInTheDocument();
  });
});
