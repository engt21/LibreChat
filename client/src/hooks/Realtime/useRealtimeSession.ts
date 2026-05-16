import { useCallback, useEffect, useRef, useState } from 'react';
import { apiBaseUrl, EModelEndpoint, request } from 'librechat-data-provider';
import type { TRealtimeAudioConfig } from 'librechat-data-provider';
import { useToastContext } from '@librechat/client';
import { useAuthContext } from '~/hooks';
import usePCMPlayer from './usePCMPlayer';
import useRealtimeMicrophone from './useRealtimeMicrophone';

type ConnectionStatus = 'idle' | 'connecting' | 'connected';

export type RealtimeTranscriptEntry = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  source: 'voice' | 'text';
};

type StartSessionParams = {
  wsPath: string;
  endpoint: string;
  model: string;
  instructions: string;
  voice?: string;
};

type TranscriptEvent = {
  text: string;
  mode: 'delta' | 'replace' | 'final';
  source?: string;
};

const sourcePriority = {
  input_transcription: 2,
  output_transcription: 3,
  audio_transcript: 3,
  text: 1,
} as const;

type AssistantTranscriptSource = keyof typeof sourcePriority;
type AssistantDrafts = Partial<Record<AssistantTranscriptSource, string>>;

const TOKEN_REFRESH_WINDOW_MS = 30_000;

const nextId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function getHighestPriorityAssistantDraft(drafts: AssistantDrafts) {
  let bestSource: AssistantTranscriptSource | null = null;
  let bestText = '';
  let bestPriority = -1;

  for (const [source, text] of Object.entries(drafts) as [AssistantTranscriptSource, string][]) {
    if (!text.trim()) {
      continue;
    }

    const priority = sourcePriority[source] ?? 0;
    if (priority >= bestPriority) {
      bestPriority = priority;
      bestSource = source;
      bestText = text;
    }
  }

  if (!bestSource) {
    return null;
  }

  return {
    source: bestSource,
    text: bestText,
  };
}

function buildRealtimeWebSocketUrl(wsPath: string, token?: string) {
  const basePath = apiBaseUrl();
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const combinedPath = `${basePath}${wsPath}`.replace(/\/+/g, '/');
  const url = new URL(`${protocol}//${window.location.host}${combinedPath}`);

  if (token) {
    url.searchParams.set('token', token);
  }

  return url.toString();
}

function getJwtExpiry(token?: string) {
  if (!token) {
    return null;
  }

  try {
    const payload = token.split('.')[1];

    if (!payload) {
      return null;
    }

    const normalizedPayload = payload.replace(/-/g, '+').replace(/_/g, '/');
    const paddedPayload = normalizedPayload.padEnd(
      Math.ceil(normalizedPayload.length / 4) * 4,
      '=',
    );
    const decodedPayload = JSON.parse(window.atob(paddedPayload));

    return typeof decodedPayload?.exp === 'number' ? decodedPayload.exp * 1000 : null;
  } catch {
    return null;
  }
}

async function resolveRealtimeToken(token?: string): Promise<string> {
  const expiresAt = getJwtExpiry(token);

  if (token && (expiresAt == null || expiresAt - Date.now() > TOKEN_REFRESH_WINDOW_MS)) {
    return token;
  }

  try {
    const refreshResponse = await request.refreshToken();
    const refreshedToken = refreshResponse?.token?.trim();

    if (refreshedToken) {
      window.dispatchEvent(new CustomEvent<string>('tokenUpdated', { detail: refreshedToken }));
      return refreshedToken;
    }
  } catch {
    if (token && expiresAt != null && expiresAt > Date.now()) {
      return token;
    }

    throw new Error('Your session expired. Please refresh and sign in again.');
  }

  if (token && expiresAt != null && expiresAt > Date.now()) {
    return token;
  }

  throw new Error('Your session expired. Please refresh and sign in again.');
}

export default function useRealtimeSession() {
  const { token } = useAuthContext();
  const { showToast } = useToastContext();
  const player = usePCMPlayer();
  const microphone = useRealtimeMicrophone();

  const socketRef = useRef<WebSocket | null>(null);
  const stopSessionRef = useRef<(() => Promise<void>) | null>(null);
  const assistantSourceRef = useRef<string | null>(null);
  const assistantDraftsRef = useRef<AssistantDrafts>({});
  const assistantDidFinalizeRef = useRef(false);
  const sessionAudioRef = useRef<TRealtimeAudioConfig | null>(null);
  const currentUserTranscriptRef = useRef('');
  const currentAssistantTranscriptRef = useRef('');

  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [sessionEndpoint, setSessionEndpoint] = useState<string | null>(null);
  const [sessionModel, setSessionModel] = useState<string | null>(null);
  const [sessionStartedAt, setSessionStartedAt] = useState<string | null>(null);
  const [entries, setEntries] = useState<RealtimeTranscriptEntry[]>([]);
  const [currentUserTranscript, setCurrentUserTranscript] = useState('');
  const [currentAssistantTranscript, setCurrentAssistantTranscript] = useState('');

  useEffect(() => {
    currentUserTranscriptRef.current = currentUserTranscript;
  }, [currentUserTranscript]);

  useEffect(() => {
    currentAssistantTranscriptRef.current = currentAssistantTranscript;
  }, [currentAssistantTranscript]);

  const finalizeTranscript = useCallback(
    (role: 'user' | 'assistant', text: string, source: 'voice' | 'text') => {
      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }

      setEntries((prev) => [...prev, { id: nextId(), role, text: trimmed, source }]);
    },
    [],
  );

  const resetDrafts = useCallback(() => {
    assistantDraftsRef.current = {};
    assistantDidFinalizeRef.current = false;
    assistantSourceRef.current = null;
    currentUserTranscriptRef.current = '';
    currentAssistantTranscriptRef.current = '';
    setCurrentUserTranscript('');
    setCurrentAssistantTranscript('');
  }, []);

  const syncAssistantDraft = useCallback((drafts: AssistantDrafts = assistantDraftsRef.current) => {
    const bestDraft = getHighestPriorityAssistantDraft(drafts);

    assistantSourceRef.current = bestDraft?.source ?? null;
    currentAssistantTranscriptRef.current = bestDraft?.text ?? '';
    setCurrentAssistantTranscript(bestDraft?.text ?? '');

    return bestDraft;
  }, []);

  const clearSessionState = useCallback(() => {
    sessionAudioRef.current = null;
    setStatus('idle');
    resetDrafts();
  }, [resetDrafts]);

  const clearTranscriptHistory = useCallback(() => {
    setEntries([]);
    setSessionEndpoint(null);
    setSessionModel(null);
    setSessionStartedAt(null);
    resetDrafts();
  }, [resetDrafts]);

  const closeSocket = useCallback(() => {
    const socket = socketRef.current;
    socketRef.current = null;

    if (socket) {
      socket.close();
    }
  }, []);

  const stopSession = useCallback(async () => {
    await microphone.stopRecording();
    await player.stopAll();
    closeSocket();
    clearSessionState();
  }, [clearSessionState, closeSocket, microphone, player]);

  useEffect(() => {
    stopSessionRef.current = stopSession;
  }, [stopSession]);

  const getTranscriptSnapshot = useCallback(() => {
    const finalizedEntries = entries.map(({ role, text, source }) => ({
      role,
      text: text.trim(),
      source,
    }));

    if (currentUserTranscriptRef.current.trim()) {
      finalizedEntries.push({
        role: 'user',
        text: currentUserTranscriptRef.current.trim(),
        source: 'voice',
      });
    }

    if (currentAssistantTranscriptRef.current.trim()) {
      finalizedEntries.push({
        role: 'assistant',
        text: currentAssistantTranscriptRef.current.trim(),
        source: 'voice',
      });
    }

    return {
      entries: finalizedEntries,
      startedAt: sessionStartedAt,
    };
  }, [entries, sessionStartedAt]);

  const handleInputTranscript = useCallback(
    ({ text, mode }: TranscriptEvent) => {
      if (mode === 'delta') {
        setCurrentUserTranscript((prev) => prev + text);
        return;
      }

      if (mode === 'replace') {
        setCurrentUserTranscript(text);
        return;
      }

      finalizeTranscript('user', text || currentUserTranscriptRef.current, 'voice');
      setCurrentUserTranscript('');
    },
    [finalizeTranscript],
  );

  const handleAssistantTranscript = useCallback(
    ({ text, mode, source }: TranscriptEvent) => {
      if (!source || !(source in sourcePriority)) {
        return;
      }

      const assistantSource = source as AssistantTranscriptSource;
      const drafts = assistantDraftsRef.current;

      if (mode === 'delta') {
        drafts[assistantSource] = `${drafts[assistantSource] ?? ''}${text}`;
        syncAssistantDraft(drafts);
        return;
      }

      drafts[assistantSource] = text;
      const bestDraft = syncAssistantDraft(drafts);

      if (mode === 'replace') {
        return;
      }

      if (bestDraft?.source !== assistantSource) {
        return;
      }

      assistantDidFinalizeRef.current = true;
      finalizeTranscript('assistant', bestDraft.text, 'voice');
      assistantDraftsRef.current = {};
      syncAssistantDraft({});
    },
    [finalizeTranscript, syncAssistantDraft],
  );

  const handleServerEvent = useCallback(
    (event: Record<string, unknown>) => {
      switch (event.type) {
        case 'session.started':
          sessionAudioRef.current = (event.audioConfig as TRealtimeAudioConfig) ?? null;
          setSessionEndpoint((event.endpoint as string) ?? null);
          setSessionModel((event.model as string) ?? null);
          setStatus('connected');
          break;
        case 'session.stopped':
        case 'session.closed':
          void stopSession();
          break;
        case 'input_audio_buffer.speech_started':
        case 'response.interrupted':
          void player.stopAll();
          break;
        case 'transcript.input':
          handleInputTranscript(event as unknown as TranscriptEvent);
          break;
        case 'transcript.output':
          handleAssistantTranscript(event as unknown as TranscriptEvent);
          break;
        case 'audio.output':
          if (typeof event.audio === 'string' && typeof event.sampleRate === 'number') {
            void player.enqueue(event.audio, event.sampleRate);
          }
          break;
        case 'audio.output.done':
          break;
        case 'response.started':
          assistantDraftsRef.current = {};
          assistantDidFinalizeRef.current = false;
          syncAssistantDraft({});
          break;
        case 'response.done':
          if (!assistantDidFinalizeRef.current) {
            const bestDraft = getHighestPriorityAssistantDraft(assistantDraftsRef.current);

            if (bestDraft?.text.trim()) {
              finalizeTranscript('assistant', bestDraft.text, 'voice');
            }
          }

          assistantDraftsRef.current = {};
          assistantDidFinalizeRef.current = false;
          syncAssistantDraft({});
          break;
        case 'error':
          showToast({
            message: (event.message as string) || 'Realtime request failed.',
            status: 'error',
          });

          if (status === 'connecting') {
            closeSocket();
            clearSessionState();
          }
          break;
        default:
          break;
      }
    },
    [
      clearSessionState,
      closeSocket,
      finalizeTranscript,
      handleAssistantTranscript,
      handleInputTranscript,
      player,
      status,
      showToast,
      syncAssistantDraft,
      stopSession,
    ],
  );

  const startSession = useCallback(
    async ({ wsPath, endpoint, model, instructions, voice }: StartSessionParams) => {
      await stopSession();
      clearTranscriptHistory();
      const nextSessionStartedAt = new Date().toISOString();
      setSessionStartedAt(nextSessionStartedAt);
      setSessionEndpoint(endpoint);
      setSessionModel(model);
      setStatus('connecting');

      let realtimeToken: string;

      try {
        realtimeToken = await resolveRealtimeToken(token);
      } catch (error) {
        showToast({
          message:
            error instanceof Error ? error.message : 'Failed to refresh realtime authentication.',
          status: 'error',
        });
        clearSessionState();
        return;
      }

      const socket = new WebSocket(buildRealtimeWebSocketUrl(wsPath, realtimeToken));
      socketRef.current = socket;

      const clearSocketState = () => {
        if (socketRef.current !== socket) {
          return;
        }

        socketRef.current = null;
        void microphone.stopRecording();
        void player.stopAll();
        clearSessionState();
      };

      socket.onopen = () => {
        socket.send(
          JSON.stringify({
            type: 'session.start',
            endpoint,
            model,
            instructions,
            voice,
          }),
        );
      };

      socket.onmessage = (message) => {
        try {
          const event = JSON.parse(message.data as string) as Record<string, unknown>;
          handleServerEvent(event);
        } catch {
          showToast({ message: 'Failed to parse realtime server event.', status: 'error' });
        }
      };

      socket.onerror = () => {
        showToast({ message: 'Realtime websocket connection failed.', status: 'error' });

        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close();
        }
      };

      socket.onclose = () => {
        clearSocketState();
      };
    },
    [
      clearSessionState,
      handleServerEvent,
      microphone,
      player,
      clearTranscriptHistory,
      showToast,
      stopSession,
      token,
    ],
  );

  const sendText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || socketRef.current?.readyState !== WebSocket.OPEN) {
        return;
      }

      finalizeTranscript('user', trimmed, 'text');
      socketRef.current.send(JSON.stringify({ type: 'conversation.text', text: trimmed }));
    },
    [finalizeTranscript],
  );

  const startMicrophone = useCallback(async () => {
    if (status !== 'connected' || !sessionAudioRef.current || !socketRef.current) {
      showToast({
        message: 'Connect a realtime session before enabling the microphone.',
        status: 'warning',
      });
      return;
    }

    try {
      await microphone.startRecording({
        sampleRate: sessionAudioRef.current.inputSampleRate,
        onChunk: (audio) => {
          if (socketRef.current?.readyState !== WebSocket.OPEN) {
            return;
          }

          socketRef.current.send(JSON.stringify({ type: 'input_audio_buffer.append', audio }));
        },
      });
    } catch (error) {
      showToast({
        message: error instanceof Error ? error.message : 'Failed to start the microphone.',
        status: 'error',
      });
      await microphone.stopRecording();
    }
  }, [microphone, showToast, status]);

  const stopMicrophone = useCallback(async () => {
    await microphone.stopRecording();

    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    }
  }, [microphone]);

  const cancelResponse = useCallback(async () => {
    if (sessionEndpoint === EModelEndpoint.google) {
      await player.stopAll();
      return;
    }

    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'response.cancel' }));
    }

    await player.stopAll();
  }, [player, sessionEndpoint]);

  useEffect(
    () => () => {
      void stopSessionRef.current?.();
    },
    [],
  );

  return {
    status,
    sessionEndpoint,
    sessionModel,
    sessionStartedAt,
    entries,
    currentUserTranscript,
    currentAssistantTranscript,
    isRecording: microphone.isRecording,
    isConnected: status === 'connected',
    supportsResponseCancel: sessionEndpoint !== EModelEndpoint.google,
    startSession,
    stopSession,
    sendText,
    startMicrophone,
    stopMicrophone,
    cancelResponse,
    clearTranscriptHistory,
    getTranscriptSnapshot,
  };
}
