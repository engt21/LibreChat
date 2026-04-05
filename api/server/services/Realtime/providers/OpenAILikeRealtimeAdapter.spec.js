const OpenAILikeRealtimeAdapter = require('~/server/services/Realtime/providers/OpenAILikeRealtimeAdapter');

describe('OpenAILikeRealtimeAdapter', () => {
  it('includes input transcription for direct OpenAI realtime sessions', () => {
    const adapter = new OpenAILikeRealtimeAdapter({
      provider: 'openai',
      wsURL: 'wss://example.test/realtime',
      headers: {},
      audioConfig: {
        defaultVoice: 'alloy',
        inputSampleRate: 24000,
        outputSampleRate: 24000,
      },
      instructions: 'You are helpful.',
      transcriptionModel: 'gpt-4o-mini-transcribe',
    });

    expect(adapter.buildSessionUpdate()).toMatchObject({
      type: 'session.update',
      session: {
        voice: 'alloy',
        input_audio_transcription: {
          model: 'gpt-4o-mini-transcribe',
        },
      },
    });
  });

  it('omits hardcoded input transcription for Azure realtime sessions', () => {
    const adapter = new OpenAILikeRealtimeAdapter({
      provider: 'azure',
      wsURL: 'wss://example.test/realtime',
      headers: {},
      audioConfig: {
        defaultVoice: 'alloy',
        inputSampleRate: 24000,
        outputSampleRate: 24000,
      },
      instructions: 'You are helpful.',
      transcriptionModel: null,
    });

    expect(adapter.buildSessionUpdate().session.input_audio_transcription).toBeUndefined();
  });
});
