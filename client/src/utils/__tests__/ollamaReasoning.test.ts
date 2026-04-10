import { EModelEndpoint, ReasoningEffort, type TConversation } from 'librechat-data-provider';
import { shouldHideOllamaReasoning } from '../ollamaReasoning';

describe('shouldHideOllamaReasoning', () => {
  it('returns true for Ollama conversations with reasoning turned off', () => {
    expect(
      shouldHideOllamaReasoning({
        endpoint: 'Ollama' as EModelEndpoint,
        reasoning_effort: ReasoningEffort.none,
      } as Partial<TConversation>),
    ).toBe(true);
  });

  it('returns false for non-Ollama conversations', () => {
    expect(
      shouldHideOllamaReasoning({
        endpoint: EModelEndpoint.openAI,
        reasoning_effort: ReasoningEffort.none,
      } as Partial<TConversation>),
    ).toBe(false);
  });

  it('returns false when Ollama reasoning is not turned off', () => {
    expect(
      shouldHideOllamaReasoning({
        endpoint: 'Ollama' as EModelEndpoint,
        reasoning_effort: ReasoningEffort.low,
      } as Partial<TConversation>),
    ).toBe(false);
  });

  // --- VAL-PROVIDER-011: Comprehensive off-switch verification ---

  it('treats empty string (unset/auto) as reasoning visible', () => {
    expect(
      shouldHideOllamaReasoning({
        endpoint: 'Ollama' as EModelEndpoint,
        reasoning_effort: ReasoningEffort.unset,
      } as Partial<TConversation>),
    ).toBe(false);
  });

  it('treats medium and high as reasoning visible', () => {
    expect(
      shouldHideOllamaReasoning({
        endpoint: 'Ollama' as EModelEndpoint,
        reasoning_effort: ReasoningEffort.medium,
      } as Partial<TConversation>),
    ).toBe(false);

    expect(
      shouldHideOllamaReasoning({
        endpoint: 'Ollama' as EModelEndpoint,
        reasoning_effort: ReasoningEffort.high,
      } as Partial<TConversation>),
    ).toBe(false);
  });

  it('handles case-insensitive Ollama endpoint names', () => {
    expect(
      shouldHideOllamaReasoning({
        endpoint: 'ollama' as EModelEndpoint,
        reasoning_effort: ReasoningEffort.none,
      } as Partial<TConversation>),
    ).toBe(true);

    expect(
      shouldHideOllamaReasoning({
        endpoint: 'OLLAMA' as EModelEndpoint,
        reasoning_effort: ReasoningEffort.none,
      } as Partial<TConversation>),
    ).toBe(true);
  });

  it('returns false for null or undefined conversation', () => {
    expect(shouldHideOllamaReasoning(null)).toBe(false);
    expect(shouldHideOllamaReasoning(undefined)).toBe(false);
  });

  it('returns false when reasoning_effort is undefined', () => {
    expect(
      shouldHideOllamaReasoning({
        endpoint: 'Ollama' as EModelEndpoint,
      } as Partial<TConversation>),
    ).toBe(false);
  });
});
