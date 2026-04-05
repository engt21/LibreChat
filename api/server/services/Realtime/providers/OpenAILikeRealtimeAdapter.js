const WebSocket = require('ws');

class OpenAILikeRealtimeAdapter {
  constructor({
    provider,
    wsURL,
    headers,
    audioConfig,
    instructions,
    voice,
    transcriptionModel,
    onEvent,
  }) {
    this.provider = provider;
    this.wsURL = wsURL;
    this.headers = headers;
    this.audioConfig = audioConfig;
    this.instructions = instructions;
    this.voice = voice || audioConfig.defaultVoice;
    this.transcriptionModel = transcriptionModel;
    this.onEvent = onEvent;
    this.socket = null;
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(this.wsURL, { headers: this.headers });
      let settled = false;

      socket.once('open', () => {
        this.socket = socket;
        this.attachSocketHandlers(socket);
        this.send(this.buildSessionUpdate());
        settled = true;
        resolve();
      });

      socket.once('error', (error) => {
        if (settled) {
          this.emit({ type: 'error', message: error.message });
          return;
        }

        settled = true;
        reject(error);
      });
    });
  }

  attachSocketHandlers(socket) {
    socket.on('message', (data) => {
      let event;

      try {
        event = JSON.parse(data.toString());
      } catch {
        this.emit({ type: 'error', message: 'Failed to parse realtime provider event.' });
        return;
      }

      this.handleProviderEvent(event);
    });

    socket.on('error', (error) => {
      this.emit({ type: 'error', message: error.message });
    });

    socket.on('close', (code, reason) => {
      this.emit({
        type: 'session.closed',
        code,
        reason: reason?.toString?.() || '',
      });
    });
  }

  buildSessionUpdate() {
    if (this.provider === 'xai') {
      return {
        type: 'session.update',
        session: {
          voice: this.voice,
          instructions: this.instructions,
          turn_detection: { type: 'server_vad' },
          audio: {
            input: {
              format: {
                type: 'audio/pcm',
                rate: this.audioConfig.inputSampleRate,
              },
            },
            output: {
              format: {
                type: 'audio/pcm',
                rate: this.audioConfig.outputSampleRate,
              },
            },
          },
        },
      };
    }

    const session = {
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions: this.instructions,
        voice: this.voice,
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        turn_detection: {
          type: 'server_vad',
        },
      },
    };

    if (this.transcriptionModel) {
      session.session.input_audio_transcription = {
        model: this.transcriptionModel,
      };
    }

    return session;
  }

  emit(event) {
    if (typeof this.onEvent === 'function') {
      this.onEvent(event);
    }
  }

  send(event) {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }

    this.socket.send(JSON.stringify(event));
  }

  updateSession({ instructions, voice }) {
    if (instructions) {
      this.instructions = instructions;
    }

    if (voice) {
      this.voice = voice;
    }

    this.send(this.buildSessionUpdate());
  }

  appendInputAudio(audio) {
    this.send({
      type: 'input_audio_buffer.append',
      audio,
    });
  }

  commitInputAudio() {
    this.send({ type: 'input_audio_buffer.commit' });
  }

  clearInputAudio() {
    this.send({ type: 'input_audio_buffer.clear' });
  }

  sendText(text) {
    this.send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text }],
      },
    });

    this.send({
      type: 'response.create',
      response: {
        modalities: ['text', 'audio'],
      },
    });
  }

  cancelResponse() {
    this.send({ type: 'response.cancel' });
  }

  close() {
    if (!this.socket) {
      return;
    }

    if (
      this.socket.readyState === WebSocket.OPEN ||
      this.socket.readyState === WebSocket.CONNECTING
    ) {
      this.socket.close(1000, 'Client closed realtime session');
    }

    this.socket = null;
  }

  handleProviderEvent(event) {
    switch (event?.type) {
      case 'session.created':
      case 'session.updated':
        this.emit({ type: 'session.updated', session: event.session ?? null });
        break;
      case 'input_audio_buffer.speech_started':
      case 'input_audio_buffer.speech_stopped':
      case 'input_audio_buffer.committed':
        this.emit({ type: event.type });
        break;
      case 'conversation.item.input_audio_transcription.completed':
        this.emit({
          type: 'transcript.input',
          text: event.transcript ?? '',
          mode: 'final',
          source: 'input_transcription',
        });
        break;
      case 'response.audio.delta':
        this.emit({
          type: 'audio.output',
          audio: event.delta,
          sampleRate: this.audioConfig.outputSampleRate,
        });
        break;
      case 'response.audio.done':
        this.emit({ type: 'audio.output.done' });
        break;
      case 'response.audio_transcript.delta':
        this.emit({
          type: 'transcript.output',
          text: event.delta ?? '',
          mode: 'delta',
          source: 'audio_transcript',
        });
        break;
      case 'response.audio_transcript.done':
        this.emit({
          type: 'transcript.output',
          text: event.transcript ?? '',
          mode: 'final',
          source: 'audio_transcript',
        });
        break;
      case 'response.text.delta':
        this.emit({
          type: 'transcript.output',
          text: event.delta ?? '',
          mode: 'delta',
          source: 'text',
        });
        break;
      case 'response.text.done':
        this.emit({
          type: 'transcript.output',
          text: event.text ?? '',
          mode: 'final',
          source: 'text',
        });
        break;
      case 'response.created':
        this.emit({ type: 'response.started' });
        break;
      case 'response.done':
        this.emit({ type: 'response.done' });
        break;
      case 'error':
        this.emit({
          type: 'error',
          message: event.error?.message ?? 'Realtime provider error.',
          code: event.error?.code,
        });
        break;
      default:
        break;
    }
  }
}

module.exports = OpenAILikeRealtimeAdapter;
