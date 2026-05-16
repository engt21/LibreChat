import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TConversation } from 'librechat-data-provider';
import TranscriptionSettings from '../TranscriptionSettings';

jest.mock('@librechat/client', () => ({
  Dropdown: ({ value, onChange, options, testId, className }: any) => (
    <select
      data-testid={testId}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={className}
    >
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
  TextareaAutosize: (props: any) => <textarea {...props} />,
  useToastContext: () => ({ showToast: jest.fn() }),
}));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
});

const renderComponent = (
  conversation: Partial<TConversation>,
  setOption: ReturnType<typeof jest.fn> = jest.fn(() => jest.fn()),
) =>
  render(
    <QueryClientProvider client={queryClient}>
      <TranscriptionSettings conversation={conversation as TConversation} setOption={setOption} />
    </QueryClientProvider>,
  );

describe('TranscriptionSettings', () => {
  it('updates the conversation transcription model from the session dropdown', () => {
    const setOption = jest.fn(() => jest.fn());

    renderComponent(
      {
        conversationId: 'convo-1',
        endpoint: 'openAI' as any,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        transcriptionModel: '',
      },
      setOption,
    );

    fireEvent.change(screen.getByTestId('SessionTranscriptionModelDropdown'), {
      target: { value: 'gpt-4o-transcribe' },
    });

    expect(setOption).toHaveBeenCalledWith('transcriptionModel');
    expect(setOption.mock.results[0].value).toHaveBeenCalledWith('gpt-4o-transcribe');
  });

  it('shows diarization speaker controls and disables prompt editing for diarize mode', () => {
    renderComponent({
      conversationId: 'convo-1',
      endpoint: 'openAI' as any,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      transcriptionModel: 'gpt-4o-transcribe-diarize',
      transcriptionPrompt: 'ignored',
    });

    expect(screen.getByText('Known speakers')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Prompt is unavailable for diarized transcription.')).toBeDisabled();
  });
});
