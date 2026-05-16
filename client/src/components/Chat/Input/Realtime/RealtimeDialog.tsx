/* eslint-disable i18next/no-literal-string */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useToastContext } from '@librechat/client';
import { Button, OGDialog, OGDialogContent, Spinner } from '@librechat/client';
import { useGetRealtimeModelsQuery, useSaveRealtimeConversationMutation } from '~/data-provider';
import useRealtimeSession from '~/hooks/Realtime/useRealtimeSession';
import { cn } from '~/utils';

type RealtimeDialogProps = {
  open: boolean;
  setOpen: (open: boolean) => void;
  currentEndpoint?: string | null;
  currentModel?: string | null;
};

function RealtimeSelect({
  id,
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  id: string;
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!options.includes(value)) {
      setOpen(false);
    }
  }, [options, value]);

  return (
    <div ref={rootRef} className="space-y-2">
      <label className="text-sm font-medium text-text-primary" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <button
          id={id}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={`${id}-listbox`}
          disabled={disabled || options.length === 0}
          onClick={() => setOpen((prev) => !prev)}
          className="flex w-full items-center justify-between rounded-lg border border-border-light bg-surface-chat px-3 py-2 text-sm text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="truncate text-left">{value || 'Select an option'}</span>
          <span className="ml-2 text-text-secondary">▾</span>
        </button>

        {open && options.length > 0 ? (
          <div
            id={`${id}-listbox`}
            role="listbox"
            className="absolute z-20 mt-2 max-h-60 w-full overflow-y-auto rounded-lg border border-border-light bg-surface-chat shadow-lg"
          >
            {options.map((option) => {
              const selected = option === value;

              return (
                <button
                  key={option}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(option);
                    setOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center px-3 py-2 text-left text-sm text-text-primary hover:bg-surface-hover',
                    selected && 'bg-surface-hover',
                  )}
                >
                  {option}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TranscriptBubble({
  speaker,
  text,
  pending = false,
}: {
  speaker: 'user' | 'assistant';
  text: string;
  pending?: boolean;
}) {
  return (
    <div className={cn('flex', speaker === 'user' ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm',
          speaker === 'user'
            ? 'border border-border-light bg-surface-chat text-text-primary'
            : 'bg-surface-hover text-text-primary',
          pending && 'opacity-80',
        )}
      >
        {text}
      </div>
    </div>
  );
}

export default function RealtimeDialog({
  open,
  setOpen,
  currentEndpoint,
  currentModel,
}: RealtimeDialogProps) {
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const previousEndpointRef = useRef<string | null>(null);
  const savedConversationIdRef = useRef<string | null>(null);
  const [selectedEndpoint, setSelectedEndpoint] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [instructions, setInstructions] = useState('You are a helpful assistant.');
  const [voice, setVoice] = useState('');
  const [textInput, setTextInput] = useState('');

  const { data, isLoading } = useGetRealtimeModelsQuery({ enabled: open });
  const { showToast } = useToastContext();
  const saveRealtimeConversation = useSaveRealtimeConversationMutation();
  const providers = useMemo(() => data?.providers ?? [], [data?.providers]);
  const {
    status,
    sessionEndpoint,
    sessionModel,
    entries,
    currentUserTranscript,
    currentAssistantTranscript,
    isRecording,
    isConnected,
    supportsResponseCancel,
    sessionStartedAt,
    startSession,
    stopSession,
    sendText,
    startMicrophone,
    stopMicrophone,
    cancelResponse,
    clearTranscriptHistory,
    getTranscriptSnapshot,
  } = useRealtimeSession();

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.endpoint === selectedEndpoint) ?? null,
    [providers, selectedEndpoint],
  );
  const selectedProviderModelsKey = useMemo(
    () => selectedProvider?.models.join('\u0000') ?? '',
    [selectedProvider?.models],
  );
  const selectedProviderVoicesKey = useMemo(
    () => (selectedProvider?.voices ?? []).join('\u0000'),
    [selectedProvider?.voices],
  );

  useEffect(() => {
    if (!open || providers.length === 0) {
      return;
    }

    const preferredProvider =
      providers.find((provider) => provider.endpoint === currentEndpoint) ??
      providers.find((provider) => provider.available) ??
      providers[0];

    setSelectedEndpoint((prev) => (prev ? prev : preferredProvider.endpoint));
  }, [currentEndpoint, open, providers]);

  useEffect(() => {
    if (!selectedProvider) {
      return;
    }

    const endpointChanged = previousEndpointRef.current !== selectedProvider.endpoint;

    const preferredModel =
      (currentEndpoint === selectedProvider.endpoint &&
      currentModel &&
      selectedProvider.models.includes(currentModel)
        ? currentModel
        : null) ??
      selectedProvider.defaultModel ??
      selectedProvider.models[0] ??
      '';

    const preferredVoice = selectedProvider.defaultVoice ?? '';

    setSelectedModel((prev) => {
      if (!endpointChanged && prev && selectedProvider.models.includes(prev)) {
        return prev;
      }

      return preferredModel;
    });

    setVoice((prev) => {
      if (!endpointChanged && prev && selectedProvider.voices?.includes(prev)) {
        return prev;
      }

      return preferredVoice;
    });

    previousEndpointRef.current = selectedProvider.endpoint;
  }, [
    currentEndpoint,
    currentModel,
    selectedProvider,
    selectedProviderModelsKey,
    selectedProviderVoicesKey,
  ]);

  useEffect(() => {
    if (open) {
      return;
    }

    previousEndpointRef.current = null;
    savedConversationIdRef.current = null;
  }, [open]);

  useEffect(() => {
    if (!transcriptRef.current) {
      return;
    }

    transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [entries, currentUserTranscript, currentAssistantTranscript]);

  const persistRealtimeConversation = async () => {
    if (saveRealtimeConversation.isLoading || saveRealtimeConversation.isPending) {
      return savedConversationIdRef.current;
    }

    if (savedConversationIdRef.current) {
      return savedConversationIdRef.current;
    }

    const { entries: transcriptEntries, startedAt } = getTranscriptSnapshot();

    if (transcriptEntries.length === 0 || !sessionEndpoint || !sessionModel) {
      return null;
    }

    const conversation = await saveRealtimeConversation.mutateAsync({
      endpoint: sessionEndpoint,
      model: sessionModel,
      instructions,
      startedAt: startedAt ?? sessionStartedAt ?? undefined,
      endedAt: new Date().toISOString(),
      entries: transcriptEntries,
    });

    savedConversationIdRef.current = conversation.conversationId;
    showToast({
      message: 'Saved realtime session to the conversation sidebar.',
      status: 'success',
    });

    return conversation.conversationId;
  };

  const handleOpenChange = async (nextOpen: boolean) => {
    if (!nextOpen) {
      try {
        await persistRealtimeConversation();
      } catch (error) {
        showToast({
          message:
            error instanceof Error ? error.message : 'Failed to save the realtime conversation.',
          status: 'error',
        });
      }

      await stopSession();
      clearTranscriptHistory();
      setTextInput('');
    }

    setOpen(nextOpen);
  };

  const handleDisconnect = async () => {
    try {
      await persistRealtimeConversation();
    } catch (error) {
      showToast({
        message:
          error instanceof Error ? error.message : 'Failed to save the realtime conversation.',
        status: 'error',
      });
    }

    await stopSession();
  };

  const handleConnect = async () => {
    if (!data?.wsPath || !selectedProvider || !selectedModel) {
      return;
    }

    try {
      await persistRealtimeConversation();
    } catch (error) {
      showToast({
        message:
          error instanceof Error
            ? error.message
            : 'Failed to save the previous realtime conversation.',
        status: 'error',
      });
      return;
    }

    savedConversationIdRef.current = null;

    await startSession({
      wsPath: data.wsPath,
      endpoint: selectedProvider.endpoint,
      model: selectedModel,
      instructions,
      voice: voice || selectedProvider.defaultVoice,
    });
  };

  const handleSendText = () => {
    if (!textInput.trim()) {
      return;
    }

    sendText(textInput);
    setTextInput('');
  };

  return (
    <OGDialog open={open} onOpenChange={handleOpenChange}>
      <OGDialogContent className="max-h-[90vh] w-[95vw] max-w-3xl overflow-hidden p-0">
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-border-light px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold text-text-primary">Realtime Voice</h2>
              <p className="text-xs text-text-secondary">
                OpenAI, Azure OpenAI, Gemini Live, and xAI voice sessions through LibreChat.
              </p>
            </div>
            <div className="text-xs text-text-secondary">Status: {status}</div>
          </div>

          <div className="grid gap-4 p-5 md:grid-cols-[320px_minmax(0,1fr)]">
            <div className="space-y-4">
              {isLoading ? (
                <div className="flex min-h-40 items-center justify-center rounded-xl border border-border-light">
                  <Spinner />
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-text-primary">Provider</div>
                    <div className="flex flex-wrap gap-2">
                      {providers.map((provider) => (
                        <button
                          key={provider.endpoint}
                          type="button"
                          onClick={() => setSelectedEndpoint(provider.endpoint)}
                          className={cn(
                            'rounded-full border px-3 py-1.5 text-xs transition-colors',
                            selectedEndpoint === provider.endpoint
                              ? 'border-primary bg-surface-hover text-text-primary'
                              : 'border-border-light text-text-secondary hover:bg-surface-hover',
                          )}
                        >
                          {provider.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <RealtimeSelect
                    id="realtime-model"
                    label="Model"
                    value={selectedModel}
                    options={selectedProvider?.models ?? []}
                    onChange={setSelectedModel}
                  />

                  <RealtimeSelect
                    id="realtime-voice"
                    label="Voice"
                    value={voice}
                    options={selectedProvider?.voices ?? []}
                    onChange={setVoice}
                  />

                  <div className="space-y-2">
                    <label
                      className="text-sm font-medium text-text-primary"
                      htmlFor="realtime-instructions"
                    >
                      Instructions
                    </label>
                    <textarea
                      id="realtime-instructions"
                      value={instructions}
                      onChange={(e) => setInstructions(e.target.value)}
                      rows={5}
                      className="w-full rounded-lg border border-border-light bg-surface-chat px-3 py-2 text-sm text-text-primary"
                    />
                  </div>

                  {selectedProvider?.reason && (
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                      {selectedProvider.reason}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {isConnected ? (
                      <Button variant="destructive" onClick={() => void handleDisconnect()}>
                        Disconnect
                      </Button>
                    ) : (
                      <Button
                        onClick={() => void handleConnect()}
                        disabled={
                          !selectedProvider?.available || !selectedModel || status === 'connecting'
                        }
                      >
                        {status === 'connecting' ? 'Connecting…' : 'Connect'}
                      </Button>
                    )}
                    <Button
                      variant={isRecording ? 'destructive' : 'outline'}
                      onClick={() => void (isRecording ? stopMicrophone() : startMicrophone())}
                      disabled={!isConnected}
                    >
                      {isRecording ? 'Stop mic' : 'Start mic'}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void cancelResponse()}
                      disabled={!isConnected}
                    >
                      {supportsResponseCancel ? 'Stop reply' : 'Stop audio'}
                    </Button>
                  </div>
                </>
              )}
            </div>

            <div className="flex min-h-[420px] flex-col gap-3">
              <div
                ref={transcriptRef}
                className="flex-1 space-y-3 overflow-y-auto rounded-xl border border-border-light bg-surface-chat p-4"
              >
                {entries.length === 0 && !currentUserTranscript && !currentAssistantTranscript ? (
                  <div className="text-sm text-text-secondary">
                    Connect a provider, start the mic, or send text to begin a realtime session.
                  </div>
                ) : (
                  <>
                    {entries.map((entry) => (
                      <TranscriptBubble key={entry.id} speaker={entry.role} text={entry.text} />
                    ))}
                    {currentUserTranscript ? (
                      <TranscriptBubble speaker="user" text={currentUserTranscript} pending />
                    ) : null}
                    {currentAssistantTranscript ? (
                      <TranscriptBubble
                        speaker="assistant"
                        text={currentAssistantTranscript}
                        pending
                      />
                    ) : null}
                  </>
                )}
              </div>

              <div className="flex gap-2">
                <input
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendText();
                    }
                  }}
                  placeholder="Send a text turn to the live session"
                  className="flex-1 rounded-lg border border-border-light bg-surface-chat px-3 py-2 text-sm text-text-primary"
                  disabled={!isConnected}
                />
                <Button
                  variant="outline"
                  onClick={handleSendText}
                  disabled={!isConnected || !textInput.trim()}
                >
                  Send
                </Button>
              </div>

              {!supportsResponseCancel && sessionEndpoint === 'google' ? (
                <div className="text-xs text-text-secondary">
                  Gemini Live currently supports local audio stop only; server-side reply
                  cancellation is unavailable.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}
