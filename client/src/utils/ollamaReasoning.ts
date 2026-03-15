import { KnownEndpoints, ReasoningEffort, type TConversation } from 'librechat-data-provider';

export function shouldHideOllamaReasoning(conversation?: Partial<TConversation> | null): boolean {
  return (
    typeof conversation?.endpoint === 'string' &&
    conversation.endpoint.toLowerCase().startsWith(KnownEndpoints.ollama) &&
    conversation.reasoning_effort === ReasoningEffort.none
  );
}
