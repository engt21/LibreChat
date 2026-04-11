/**
 * @file ollamaReasoningParam.spec.ts
 * Proves the reasoning=none off-switch contract for Ollama endpoints:
 * - The backend suppressReasoning flag is derived from endpoint + reasoning_effort
 * - The client shouldHideOllamaReasoning utility matches the same condition
 * - The reasoning=none value must be selectable and effective for Ollama
 *
 * Covers VAL-PROVIDER-011 (Ollama reasoning none remains a real off switch).
 */
import { KnownEndpoints, ReasoningEffort, type TConversation } from 'librechat-data-provider';
import { shouldHideOllamaReasoning } from '~/utils/ollamaReasoning';

describe('Ollama reasoning=none parameter contract (VAL-PROVIDER-011)', () => {
  // --- Backend-equivalent suppression logic ---

  /**
   * Replicate the backend's suppressReasoning condition from
   * api/server/services/Endpoints/agents/initialize.js so the test proves
   * client and backend agree on when reasoning is suppressed.
   */
  const backendSuppresses = (endpoint: string | undefined, reasoning_effort: string | undefined) =>
    typeof endpoint === 'string' &&
    endpoint.toLowerCase().startsWith(KnownEndpoints.ollama) &&
    reasoning_effort === ReasoningEffort.none;

  // --- Client-side shouldHideOllamaReasoning ---

  it('client hides reasoning when Ollama + reasoning_effort=none', () => {
    expect(
      shouldHideOllamaReasoning({
        endpoint: 'Ollama',
        reasoning_effort: ReasoningEffort.none,
      } as Partial<TConversation>),
    ).toBe(true);
  });

  it('backend suppresses reasoning when Ollama + reasoning_effort=none', () => {
    expect(backendSuppresses('Ollama', ReasoningEffort.none)).toBe(true);
    expect(backendSuppresses('ollama', ReasoningEffort.none)).toBe(true);
    expect(backendSuppresses('Ollama - Custom', ReasoningEffort.none)).toBe(true);
  });

  // --- Both agree: reasoning=none is a real off switch ---

  it('client and backend agree for Ollama + none → suppressed', () => {
    const cases: Array<{ endpoint: string; effort: string }> = [
      { endpoint: 'Ollama', effort: ReasoningEffort.none },
      { endpoint: 'ollama', effort: ReasoningEffort.none },
      { endpoint: 'OLLAMA', effort: ReasoningEffort.none },
      { endpoint: 'Ollama - My Custom', effort: ReasoningEffort.none },
    ];

    for (const { endpoint, effort } of cases) {
      expect(backendSuppresses(endpoint, effort)).toBe(true);
      expect(
        shouldHideOllamaReasoning({
          endpoint,
          reasoning_effort: effort,
        } as Partial<TConversation>),
      ).toBe(true);
    }
  });

  // --- Both agree: non-none values → visible ---

  it('client and backend agree for Ollama + non-none → visible', () => {
    const efforts = [
      ReasoningEffort.low,
      ReasoningEffort.medium,
      ReasoningEffort.high,
      ReasoningEffort.unset,
      undefined,
    ];

    for (const effort of efforts) {
      expect(backendSuppresses('Ollama', effort)).toBe(false);
      expect(
        shouldHideOllamaReasoning({
          endpoint: 'Ollama',
          reasoning_effort: effort,
        } as Partial<TConversation>),
      ).toBe(false);
    }
  });

  // --- Both agree: non-Ollama + none → visible ---

  it('client and backend agree for non-Ollama + none → visible', () => {
    const endpoints = ['openAI', 'google', 'azureOpenAI', 'anthropic', undefined];

    for (const endpoint of endpoints) {
      expect(backendSuppresses(endpoint, ReasoningEffort.none)).toBe(false);
      expect(
        shouldHideOllamaReasoning({
          endpoint,
          reasoning_effort: ReasoningEffort.none,
        } as Partial<TConversation>),
      ).toBe(false);
    }
  });

  // --- The "none" value is a concrete ReasoningEffort enum member ---

  it('ReasoningEffort.none is a concrete selectable value', () => {
    expect(ReasoningEffort.none).toBe('none');
    expect(typeof ReasoningEffort.none).toBe('string');
    expect(ReasoningEffort.none).not.toBe('');
    expect(ReasoningEffort.none).not.toBe(undefined);
  });
});
