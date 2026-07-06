const { EModelEndpoint, ImageDetail } = require('librechat-data-provider');
const { resolveImageDetail } = require('./encode');

describe('resolveImageDetail', () => {
  test('uses original detail for supported OpenAI models when detail is automatic', () => {
    expect(
      resolveImageDetail({
        requestedDetail: ImageDetail.auto,
        provider: EModelEndpoint.openAI,
        model: 'gpt-5.5',
      }),
    ).toBe('original');

    expect(
      resolveImageDetail({
        requestedDetail: ImageDetail.auto,
        provider: EModelEndpoint.openAI,
        model: 'gpt-5.4-pro',
      }),
    ).toBe('original');

    expect(
      resolveImageDetail({
        requestedDetail: ImageDetail.auto,
        provider: EModelEndpoint.openAI,
        model: 'gpt-5.6-terra',
      }),
    ).toBe('original');
  });

  test('uses high detail for other providers and OpenAI models without original support', () => {
    expect(
      resolveImageDetail({
        requestedDetail: ImageDetail.auto,
        provider: EModelEndpoint.anthropic,
        model: 'claude-opus-4-8',
      }),
    ).toBe(ImageDetail.high);

    expect(
      resolveImageDetail({
        requestedDetail: ImageDetail.auto,
        provider: EModelEndpoint.openAI,
        model: 'gpt-5.4-mini',
      }),
    ).toBe(ImageDetail.high);
  });

  test('preserves an explicit user detail selection', () => {
    expect(
      resolveImageDetail({
        requestedDetail: ImageDetail.low,
        provider: EModelEndpoint.openAI,
        model: 'gpt-5.5',
      }),
    ).toBe(ImageDetail.low);
  });
});
