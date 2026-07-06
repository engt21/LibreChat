import {
  extractResumableErrorText,
  serializeResumableErrorPayload,
} from './useResumableSSE';

describe('useResumableSSE error serialization', () => {
  it('keeps provider JSON strings intact for SSE error events', () => {
    const structuredError =
      '{"type":"illegal_model_request","info":"openAI|gpt-5.6","status":403}';

    expect(extractResumableErrorText({ error: structuredError })).toBe(structuredError);
  });

  it('serializes object-shaped SSE error payloads without dropping fields', () => {
    const errorText = extractResumableErrorText({
      error: {
        type: 'model_rate_limit',
        limit: 3,
        current: 3,
        window: '24h',
        status: 429,
      },
    });

    expect(JSON.parse(errorText ?? '')).toEqual({
      type: 'model_rate_limit',
      limit: 3,
      current: 3,
      window: '24h',
      status: 429,
    });
  });

  it('serializes axios response payloads for startup errors the same way', () => {
    const errorText = extractResumableErrorText({
      type: 'model_rate_limit',
      limit: 5,
      current: 5,
      window: '24h',
      status: 429,
    });

    expect(JSON.parse(errorText ?? '')).toEqual({
      type: 'model_rate_limit',
      limit: 5,
      current: 5,
      window: '24h',
      status: 429,
    });
  });

  it('passes plain strings through unchanged', () => {
    expect(serializeResumableErrorPayload('Illegal model request')).toBe('Illegal model request');
  });
});
