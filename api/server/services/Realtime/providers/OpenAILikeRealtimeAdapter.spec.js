const OpenAILikeRealtimeAdapter = require('~/server/services/Realtime/providers/OpenAILikeRealtimeAdapter');

describe('OpenAILikeRealtimeAdapter', () => {
  it('builds the OpenAI GA realtime session shape with transcription and low reasoning', () => {
    const adapter = new OpenAILikeRealtimeAdapter({
      provider: 'openai',
      model: 'gpt-realtime-2',
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
        type: 'realtime',
        output_modalities: ['audio'],
        reasoning: { effort: 'low' },
        audio: {
          input: {
            transcription: {
              model: 'gpt-4o-mini-transcribe',
            },
            turn_detection: {
              type: 'semantic_vad',
              eagerness: 'low',
              create_response: true,
              interrupt_response: true,
            },
          },
          output: {
            voice: 'alloy',
          },
        },
      },
    });
  });

  it('configures function tools and maps completed calls', () => {
    const onEvent = jest.fn();
    const adapter = new OpenAILikeRealtimeAdapter({
      provider: 'openai',
      model: 'gpt-realtime-2',
      wsURL: 'wss://example.test/realtime',
      headers: {},
      audioConfig: {
        defaultVoice: 'marin',
        inputSampleRate: 24000,
        outputSampleRate: 24000,
      },
      instructions: 'You are helpful.',
      tools: [{ type: 'function', name: 'web_search', parameters: { type: 'object' } }],
      onEvent,
    });

    expect(adapter.buildSessionUpdate().session).toMatchObject({
      tool_choice: 'auto',
      tools: [expect.objectContaining({ name: 'web_search' })],
    });

    adapter.handleProviderEvent({
      type: 'response.output_item.done',
      item: { type: 'function_call', call_id: 'call-1', name: 'web_search', arguments: '{}' },
    });

    expect(onEvent).toHaveBeenCalledWith({
      type: 'tool.call',
      callId: 'call-1',
      name: 'web_search',
      arguments: '{}',
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

    expect(adapter.buildSessionUpdate().session.audio.input.transcription).toBeUndefined();
  });

  it.each([
    ['response.output_audio.delta', { delta: 'audio' }, 'audio.output'],
    ['response.output_audio_transcript.delta', { delta: 'hello' }, 'transcript.output'],
    ['response.output_audio_transcript.done', { transcript: 'hello' }, 'transcript.output'],
    ['response.output_text.delta', { delta: 'hello' }, 'transcript.output'],
    ['response.output_text.done', { text: 'hello' }, 'transcript.output'],
  ])('maps GA event %s to broker event %s', (type, payload, expectedType) => {
    const onEvent = jest.fn();
    const adapter = new OpenAILikeRealtimeAdapter({
      provider: 'openai',
      wsURL: 'wss://example.test/realtime',
      headers: {},
      audioConfig: {
        defaultVoice: 'marin',
        inputSampleRate: 24000,
        outputSampleRate: 24000,
      },
      instructions: 'You are helpful.',
      transcriptionModel: 'gpt-4o-mini-transcribe',
      onEvent,
    });

    adapter.handleProviderEvent({ type, ...payload });

    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: expectedType }));
  });
});
