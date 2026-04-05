const { GoogleGenAI, Modality } = require('@google/genai');

function parseSampleRate(mimeType, fallbackRate) {
  const match = /rate=(\d+)/i.exec(mimeType || '');
  return match ? Number(match[1]) : fallbackRate;
}

class GeminiRealtimeAdapter {
  constructor({ clientOptions, apiKey, model, audioConfig, instructions, voice, onEvent }) {
    this.client = new GoogleGenAI(clientOptions ?? { apiKey });
    this.model = model;
    this.audioConfig = audioConfig;
    this.instructions = instructions;
    this.voice = voice || audioConfig.defaultVoice;
    this.onEvent = onEvent;
    this.session = null;
    this.lastInputTranscript = '';
    this.lastOutputTranscript = '';
    this.lastTextOutput = '';
  }

  emit(event) {
    if (typeof this.onEvent === 'function') {
      this.onEvent(event);
    }
  }

  async connect() {
    this.session = await this.client.live.connect({
      model: this.model,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: this.instructions,
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: this.voice,
            },
          },
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
      callbacks: {
        onopen: () => {
          this.emit({ type: 'session.updated' });
        },
        onclose: (event) => {
          this.emit({
            type: 'session.closed',
            code: event?.code,
            reason: event?.reason,
          });
        },
        onerror: (event) => {
          this.emit({
            type: 'error',
            message: event?.error?.message || 'Gemini realtime connection error.',
          });
        },
        onmessage: (event) => this.handleServerMessage(event),
      },
    });
  }

  handleServerMessage(event) {
    if (event?.setupComplete) {
      this.emit({ type: 'session.updated', sessionId: event.setupComplete.sessionId });
    }

    const content = event?.serverContent;
    if (!content) {
      return;
    }

    if (content.interrupted) {
      this.emit({ type: 'response.interrupted' });
    }

    if (
      content.inputTranscription?.text &&
      content.inputTranscription.text !== this.lastInputTranscript
    ) {
      this.lastInputTranscript = content.inputTranscription.text;
      this.emit({
        type: 'transcript.input',
        text: content.inputTranscription.text,
        mode: content.turnComplete ? 'final' : 'replace',
        source: 'input_transcription',
      });
    }

    if (
      content.outputTranscription?.text &&
      content.outputTranscription.text !== this.lastOutputTranscript
    ) {
      this.lastOutputTranscript = content.outputTranscription.text;
      this.emit({
        type: 'transcript.output',
        text: content.outputTranscription.text,
        mode: content.turnComplete ? 'final' : 'replace',
        source: 'output_transcription',
      });
    }

    const parts = Array.isArray(content.modelTurn?.parts) ? content.modelTurn.parts : [];
    if (parts.length > 0) {
      this.emit({ type: 'response.started' });
    }

    for (const part of parts) {
      if (part?.inlineData?.data) {
        this.emit({
          type: 'audio.output',
          audio: part.inlineData.data,
          sampleRate: parseSampleRate(part.inlineData.mimeType, this.audioConfig.outputSampleRate),
        });
      }

      if (part?.text) {
        this.lastTextOutput += part.text;
        this.emit({
          type: 'transcript.output',
          text: this.lastTextOutput,
          mode: content.turnComplete ? 'final' : 'replace',
          source: 'text',
        });
      }
    }

    if (content.turnComplete || content.generationComplete) {
      this.emit({ type: 'audio.output.done' });
      this.emit({ type: 'response.done' });
      this.lastOutputTranscript = '';
      this.lastTextOutput = '';
      this.lastInputTranscript = '';
    }
  }

  updateSession({ instructions, voice }) {
    if (instructions) {
      this.instructions = instructions;
    }

    if (voice) {
      this.voice = voice;
    }
  }

  appendInputAudio(audio) {
    this.session?.sendRealtimeInput({
      audio: {
        data: audio,
        mimeType: this.audioConfig.inputMimeType,
      },
    });
  }

  commitInputAudio() {
    this.session?.sendRealtimeInput({ audioStreamEnd: true });
  }

  clearInputAudio() {
    this.session?.sendRealtimeInput({ audioStreamEnd: true });
  }

  sendText(text) {
    this.session?.sendClientContent({
      turns: [
        {
          role: 'user',
          parts: [{ text }],
        },
      ],
      turnComplete: true,
    });
  }

  cancelResponse() {}

  close() {
    this.session?.close();
    this.session = null;
  }
}

module.exports = GeminiRealtimeAdapter;
