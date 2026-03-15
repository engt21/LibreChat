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
});
