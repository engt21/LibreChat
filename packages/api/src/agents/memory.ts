/** Memories */
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { tool } from '@langchain/core/tools';
import { Tools } from 'librechat-data-provider';
import { logger } from '@librechat/data-schemas';
import { HumanMessage } from '@langchain/core/messages';
import { Run, Providers, GraphEvents } from '@librechat/agents';
import type {
  OpenAIClientOptions,
  StreamEventData,
  ToolEndCallback,
  ClientOptions,
  EventHandler,
  ToolEndData,
  LLMConfig,
} from '@librechat/agents';
import type { ObjectId, MemoryMethods, IUser } from '@librechat/data-schemas';
import type { TAttachment, MemoryArtifact } from 'librechat-data-provider';
import type { BaseMessage, ToolMessage } from '@langchain/core/messages';
import type { UsageMetadata } from '~/stream/interfaces/IJobStore';
import type { Response as ServerResponse } from 'express';
import { GenerationJobManager } from '~/stream/GenerationJobManager';
import { resolveHeaders, createSafeUser } from '~/utils';
import Tokenizer from '~/utils/tokenizer';
import { normalizeMemoryKey, type MemoryIntent } from './memoryPolicy';

export const MEMORY_PROMPT_VERSION = 'explicit-post-response-v1';
const DEFAULT_MEMORY_LLM_CONFIG: LLMConfig = {
  provider: Providers.OPENAI,
  model: 'gpt-4.1-mini',
  temperature: 0.4,
  streaming: false,
  disableStreaming: true,
};

type RequiredMemoryMethods = Pick<
  MemoryMethods,
  'setMemory' | 'deleteMemory' | 'getFormattedMemories' | 'recordMemoryEvent'
>;

type ToolEndMetadata = Record<string, unknown> & {
  run_id?: string;
  thread_id?: string;
};

export interface MemoryConfig {
  validKeys?: string[];
  instructions?: string;
  llmConfig?: Partial<LLMConfig>;
  tokenLimit?: number;
  charLimit?: number;
  maxValueTokens?: number;
  maxWritesPerTurn?: number;
  maxAttempts?: number;
  consolidateMemories?: boolean;
  auditEnabled?: boolean;
  intent?: MemoryIntent;
  evidence?: string;
  sourceMessageId?: string;
}

export const memoryInstructions = `The system can use saved user memories. When the user explicitly requests a memory action, the application runs a dedicated memory worker after the main response using the completed assistant and tool context. Do not say memory is unavailable merely because no memory tool appears in your own tool list. Do not claim a memory write has already succeeded in the main response; accurately state that the requested information is being passed to the memory workflow.`;

const getDefaultInstructions = (
  validKeys?: string[],
  tokenLimit?: number,
  consolidateMemories = true,
) => `You are a memory mutation worker. The application has already confirmed that the current user explicitly requested a memory action.

Perform the requested memory mutation. Do not answer the user's unrelated task and do not invent facts.

The \`delete_memory\` tool should only be used in two scenarios:
  1. When the user explicitly asks to forget or remove specific information
  2. When updating existing memories, use the \`set_memory\` tool instead of deleting and re-adding the memory.

1. A memory request uses language like:
   - "Remember [that] [I]..."
   - "Don't forget [that] [I]..."
   - "Please remember..."
   - "Store this..."
   - "Forget [that] [I]..."
   - "Delete the memory about..."

2. NEVER store one-off research tasks, tool instructions, search queries, temporary plans, generated documents, or transient conversation state unless the user explicitly requested that exact information be retained.

3. Requests to use other tools do not imply a memory action by themselves. However, when the user explicitly asks to save the results of email, web, file, code, or other tool work, you MUST use the memory tool after consuming the supplied completed tool context.

4. Memory tools are ONLY for explicit memory requests, including explicit requests to retain research-backed or tool-derived results.

5. ${
  consolidateMemories
    ? 'Consolidate related facts into the fewest durable memories possible. Prefer updating an existing key over creating a near-duplicate key.'
    : 'Preserve distinct facts as separate memories when that improves clarity. Reuse an existing key only when it represents the same subject.'
}

6. Memory keys MUST use lowercase letters and underscores only, matching ^[a-z_]+$.

${validKeys && validKeys.length > 0 ? `\nVALID KEYS: ${validKeys.join(', ')}` : ''}

${tokenLimit ? `\nTOKEN LIMIT: Maximum ${tokenLimit} tokens per memory value.` : ''}

Use the available memory tool now. If the requested information depends on research or tool results, use the supplied assistant/tool context as the source of truth.`;

type MutationState = {
  attempted: number;
  successful: number;
  totalTokens: number;
  tokenCountsByKey: Record<string, number>;
};

function getMessageText(message: BaseMessage): string {
  if (typeof message.content === 'string') {
    return message.content.trim();
  }
  if (!Array.isArray(message.content)) {
    return '';
  }
  return message.content
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }
      if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
        return part.text;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function encodeHashAsLetters(value: string): string {
  return createHash('sha256')
    .update(value)
    .digest('hex')
    .slice(0, 10)
    .replace(/[0-9a-f]/g, (character) => String.fromCharCode(97 + Number.parseInt(character, 16)));
}

function getFallbackMemoryPayload(messages: BaseMessage[]): { keySeed: string; value: string } | null {
  const transcript = messages.map(getMessageText).filter(Boolean).join('\n\n').trim();
  if (!transcript) {
    return null;
  }
  const requestSection = transcript.split(/\n# Completed Assistant and Tool Context:/i)[0];
  const requestPattern =
    /(?:^|\n)(?:Human|User):\s*([\s\S]*?)(?=\n(?:AI|Assistant|Human|User|System|Tool):|$)/gi;
  let requestMatch: RegExpExecArray | null;
  let latestRequest = '';
  while ((requestMatch = requestPattern.exec(requestSection)) != null) {
    latestRequest = requestMatch[1]?.trim() || latestRequest;
  }
  const request = (latestRequest || transcript)
    .replace(/^you\s+must\s+use\s+(?:the\s+)?memory\s+tool\s+(?:now\.?\s*)?/i, '')
    .replace(/^save\s+(?:this|the following|all of this)?\s*(?:exact\s+durable\s+fact\s+)?(?:to\s+memory\s*)?:?\s*/i, '')
    .trim();
  const completedContext = transcript.match(
    /# Completed Assistant and Tool Context:\s*([\s\S]*)$/i,
  )?.[1]?.trim();
  return {
    keySeed: request || transcript,
    value: [request || transcript, completedContext].filter(Boolean).join('\n\n').trim(),
  };
}

function splitFallbackMemoryValue(
  value: string,
  maxValueTokens: number | undefined,
  charLimit: number | undefined,
  maxParts: number,
): string[] {
  const parts: string[] = [];
  let remaining = value.trim();
  while (remaining && parts.length < maxParts) {
    let end = charLimit ? Math.min(charLimit, remaining.length) : remaining.length;
    if (maxValueTokens) {
      while (
        end > 1 &&
        Tokenizer.getTokenCount(remaining.slice(0, end), 'o200k_base') > maxValueTokens
      ) {
        end = Math.max(1, Math.floor(end * 0.8));
      }
    }
    if (end < remaining.length) {
      const boundary = remaining.lastIndexOf('\n', end);
      const wordBoundary = remaining.lastIndexOf(' ', end);
      end = Math.max(boundary, wordBoundary, 1);
    }
    parts.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }
  return parts.filter(Boolean);
}

/**
 * Creates a memory tool instance with user context
 */
export const createMemoryTool = ({
  userId,
  setMemory,
  recordMemoryEvent,
  validKeys,
  tokenLimit,
  charLimit,
  maxValueTokens,
  maxWritesPerTurn = 1,
  totalTokens = 0,
  tokenCountsByKey = {},
  mutationState = {
    attempted: 0,
    successful: 0,
    totalTokens,
    tokenCountsByKey: { ...tokenCountsByKey },
  },
  metadata,
}: {
  userId: string | ObjectId;
  setMemory: MemoryMethods['setMemory'];
  recordMemoryEvent?: MemoryMethods['recordMemoryEvent'];
  validKeys?: string[];
  tokenLimit?: number;
  charLimit?: number;
  maxValueTokens?: number;
  maxWritesPerTurn?: number;
  totalTokens?: number;
  tokenCountsByKey?: Record<string, number>;
  mutationState?: MutationState;
  metadata?: NonNullable<Parameters<MemoryMethods['setMemory']>[0]['metadata']>;
}) => {
  const recordEvent = async (
    status: 'saved' | 'rejected' | 'failed' | 'no_action',
    key: string,
    reason?: string,
  ) => {
    if (!recordMemoryEvent || !metadata) return;
    await recordMemoryEvent({
      userId,
      conversationId: metadata.conversationId,
      messageId: metadata.messageId,
      responseMessageId: metadata.responseMessageId,
      intent: 'save',
      key,
      status,
      model: metadata.model,
      promptVersion: metadata.promptVersion,
      evidence: metadata.evidence,
      reason,
    });
  };

  // @ts-expect-error – @langchain/core tool() triggers TS2589 (excessively deep type instantiation); safe at runtime
  return tool(
    async ({ key, value }: { key: string; value: string }) => {
      const normalizedKey = normalizeMemoryKey(key);
      mutationState.attempted += 1;
      try {
        if (mutationState.attempted > maxWritesPerTurn) {
          await recordEvent('rejected', normalizedKey, 'max_writes_per_turn');
          return [`Memory write limit reached for this turn.`, undefined];
        }
        if (!normalizedKey) {
          await recordEvent('rejected', normalizedKey, 'invalid_key');
          return [`Memory key must contain lowercase letters or underscores.`, undefined];
        }
        if (validKeys && validKeys.length > 0 && !validKeys.includes(normalizedKey)) {
          await recordEvent('rejected', normalizedKey, 'invalid_configured_key');
          return [
            `Invalid key "${normalizedKey}". Must be one of: ${validKeys.join(', ')}`,
            undefined,
          ];
        }

        const tokenCount = Tokenizer.getTokenCount(value, 'o200k_base');
        if (charLimit && value.length > charLimit) {
          await recordEvent('rejected', normalizedKey, 'char_limit');
          return [`Memory value exceeds the ${charLimit} character limit.`, undefined];
        }
        if (maxValueTokens && tokenCount > maxValueTokens) {
          await recordEvent('rejected', normalizedKey, 'max_value_tokens');
          return [`Memory value exceeds the ${maxValueTokens} token per-value limit.`, undefined];
        }

        if (tokenLimit) {
          if (mutationState.totalTokens > tokenLimit) {
            const overage = mutationState.totalTokens - tokenLimit;
            const errorArtifact: Record<Tools.memory, MemoryArtifact> = {
              [Tools.memory]: {
                key: 'system',
                type: 'error',
                value: JSON.stringify({
                  errorType: 'already_exceeded',
                  tokenCount: overage,
                  totalTokens: mutationState.totalTokens,
                  tokenLimit,
                }),
                tokenCount: mutationState.totalTokens,
              },
            };
            await recordEvent('rejected', normalizedKey, 'already_over_total_token_limit');
            return [`Memory storage exceeded. Cannot save new memories.`, errorArtifact];
          }
          const previousTokenCount = mutationState.tokenCountsByKey[normalizedKey] || 0;
          const newTotalTokens = mutationState.totalTokens - previousTokenCount + tokenCount;
          const newRemainingTokens = tokenLimit - newTotalTokens;
          if (newRemainingTokens < 0) {
            const errorArtifact: Record<Tools.memory, MemoryArtifact> = {
              [Tools.memory]: {
                key: 'system',
                type: 'error',
                value: JSON.stringify({
                  errorType: 'would_exceed',
                  tokenCount: Math.abs(newRemainingTokens),
                  totalTokens: newTotalTokens,
                  tokenLimit,
                }),
                tokenCount: mutationState.totalTokens,
              },
            };
            await recordEvent('rejected', normalizedKey, 'total_token_limit');
            return [`Memory storage would exceed limit. Cannot save this memory.`, errorArtifact];
          }
        }

        const artifact: Record<Tools.memory, MemoryArtifact> = {
          [Tools.memory]: {
            key: normalizedKey,
            value,
            tokenCount,
            type: 'update',
          },
        };

        const result = await setMemory({
          userId,
          key: normalizedKey,
          value,
          tokenCount,
          ...(metadata ? { metadata } : {}),
        });
        if (result.ok) {
          if (result.changed === false) {
            mutationState.successful += 1;
            await recordEvent('no_action', normalizedKey, 'value_unchanged');
            return [`Memory for key "${normalizedKey}" is already current.`, undefined];
          }
          const previousTokenCount = mutationState.tokenCountsByKey[normalizedKey] || 0;
          mutationState.totalTokens = mutationState.totalTokens - previousTokenCount + tokenCount;
          mutationState.tokenCountsByKey[normalizedKey] = tokenCount;
          mutationState.successful += 1;
          await recordEvent('saved', normalizedKey);
          return [`Memory set for key "${normalizedKey}" (${tokenCount} tokens)`, artifact];
        }
        await recordEvent('failed', normalizedKey, 'set_memory_returned_false');
        return [`Failed to set memory for key "${normalizedKey}"`, undefined];
      } catch (error) {
        logger.error('Memory Agent failed to set memory', error);
        await recordEvent(
          'failed',
          normalizedKey,
          error instanceof Error ? error.message : 'unknown_error',
        );
        return [`Error setting memory for key "${normalizedKey}"`, undefined];
      }
    },
    {
      name: 'set_memory',
      description: 'Saves important information about the user into memory.',
      responseFormat: 'content_and_artifact',
      schema: z.object({
        key: z
          .string()
          .regex(/^[a-z_]+$/, 'Key must contain lowercase letters and underscores only')
          .describe(
            validKeys && validKeys.length > 0
              ? `The key of the memory value. Must be one of: ${validKeys.join(', ')}`
              : 'Lowercase snake_case key using only letters and underscores',
          ),
        value: z
          .string()
          .describe(
            'Value MUST be a complete sentence that fully describes relevant user information.',
          ),
      }),
    },
  );
};

/**
 * Creates a delete memory tool instance with user context
 */
const createDeleteMemoryTool = ({
  userId,
  deleteMemory,
  recordMemoryEvent,
  validKeys,
  maxWritesPerTurn,
  mutationState,
  metadata,
}: {
  userId: string | ObjectId;
  deleteMemory: MemoryMethods['deleteMemory'];
  recordMemoryEvent?: MemoryMethods['recordMemoryEvent'];
  validKeys?: string[];
  maxWritesPerTurn: number;
  mutationState: MutationState;
  metadata: NonNullable<Parameters<MemoryMethods['setMemory']>[0]['metadata']>;
}) => {
  // @ts-expect-error – @langchain/core tool() triggers TS2589 (excessively deep type instantiation); safe at runtime
  return tool(
    async ({ key }: { key: string }) => {
      const normalizedKey = normalizeMemoryKey(key);
      mutationState.attempted += 1;
      try {
        if (mutationState.attempted > maxWritesPerTurn) {
          return [`Memory write limit reached for this turn.`, undefined];
        }
        if (validKeys && validKeys.length > 0 && !validKeys.includes(normalizedKey)) {
          return [
            `Invalid key "${normalizedKey}". Must be one of: ${validKeys.join(', ')}`,
            undefined,
          ];
        }

        const artifact: Record<Tools.memory, MemoryArtifact> = {
          [Tools.memory]: {
            key: normalizedKey,
            type: 'delete',
          },
        };

        const result = await deleteMemory({ userId, key: normalizedKey });
        if (result.ok) {
          mutationState.totalTokens -= mutationState.tokenCountsByKey[normalizedKey] || 0;
          delete mutationState.tokenCountsByKey[normalizedKey];
          mutationState.successful += 1;
          await recordMemoryEvent?.({
            userId,
            conversationId: metadata.conversationId,
            messageId: metadata.messageId,
            responseMessageId: metadata.responseMessageId,
            intent: 'delete',
            key: normalizedKey,
            status: 'deleted',
            model: metadata.model,
            promptVersion: metadata.promptVersion,
            evidence: metadata.evidence,
          });
          return [`Memory deleted for key "${normalizedKey}"`, artifact];
        }
        await recordMemoryEvent?.({
          userId,
          conversationId: metadata.conversationId,
          messageId: metadata.messageId,
          responseMessageId: metadata.responseMessageId,
          intent: 'delete',
          key: normalizedKey,
          status: 'failed',
          model: metadata.model,
          promptVersion: metadata.promptVersion,
          evidence: metadata.evidence,
          reason: 'memory_not_found',
        });
        return [`Failed to delete memory for key "${normalizedKey}"`, undefined];
      } catch (error) {
        logger.error('Memory Agent failed to delete memory', error);
        return [`Error deleting memory for key "${normalizedKey}"`, undefined];
      }
    },
    {
      name: 'delete_memory',
      description:
        'Deletes specific memory data about the user using the provided key. For updating existing memories, use the `set_memory` tool instead',
      responseFormat: 'content_and_artifact',
      schema: z.object({
        key: z
          .string()
          .describe(
            validKeys && validKeys.length > 0
              ? `The key of the memory to delete. Must be one of: ${validKeys.join(', ')}`
              : 'The key identifier of the memory to delete',
          ),
      }),
    },
  );
};
export class BasicModelEndHandler implements EventHandler {
  private collectedUsage: UsageMetadata[];
  private fallbackModel?: string;

  constructor(collectedUsage: UsageMetadata[], fallbackModel?: string) {
    this.collectedUsage = collectedUsage;
    this.fallbackModel = fallbackModel;
  }

  handle(
    event: string,
    data: StreamEventData | undefined,
    metadata?: Record<string, unknown>,
  ): void {
    if (!metadata) {
      console.warn(`Graph or metadata not found in ${event} event`);
      return;
    }
    const output = (data as { output?: { usage_metadata?: UsageMetadata } } | undefined)?.output;
    const usage = output?.usage_metadata;
    if (!usage) {
      return;
    }
    const model =
      (typeof metadata.ls_model_name === 'string' ? metadata.ls_model_name : undefined) ??
      this.fallbackModel;
    this.collectedUsage.push(model ? { ...usage, model } : { ...usage });
  }
}

export class BasicToolEndHandler implements EventHandler {
  private callback?: ToolEndCallback;
  constructor(callback?: ToolEndCallback) {
    this.callback = callback;
  }

  handle(
    event: string,
    data: StreamEventData | undefined,
    metadata?: Record<string, unknown>,
  ): void {
    if (!metadata) {
      console.warn(`Graph or metadata not found in ${event} event`);
      return;
    }
    const toolEndData = data as ToolEndData | undefined;
    if (!toolEndData?.output) {
      console.warn('No output found in tool_end event');
      return;
    }
    this.callback?.(toolEndData, metadata);
  }
}

export async function processMemory({
  res,
  userId,
  setMemory,
  deleteMemory,
  recordMemoryEvent,
  messages,
  memory,
  messageId,
  conversationId,
  validKeys,
  instructions,
  llmConfig,
  tokenLimit,
  charLimit,
  maxValueTokens,
  maxWritesPerTurn = 1,
  maxAttempts = 1,
  intent = 'save',
  evidence,
  sourceMessageId,
  totalTokens = 0,
  tokenCountsByKey = {},
  streamId = null,
  user,
  onUsage,
}: {
  res: ServerResponse;
  setMemory: MemoryMethods['setMemory'];
  deleteMemory: MemoryMethods['deleteMemory'];
  recordMemoryEvent?: MemoryMethods['recordMemoryEvent'];
  userId: string | ObjectId;
  memory: string;
  messageId: string;
  conversationId: string;
  messages: BaseMessage[];
  validKeys?: string[];
  instructions: string;
  tokenLimit?: number;
  charLimit?: number;
  maxValueTokens?: number;
  maxWritesPerTurn?: number;
  maxAttempts?: number;
  intent?: MemoryIntent;
  evidence?: string;
  sourceMessageId?: string;
  totalTokens?: number;
  tokenCountsByKey?: Record<string, number>;
  llmConfig?: Partial<LLMConfig>;
  streamId?: string | null;
  user?: IUser;
  onUsage?: (usage: UsageMetadata[]) => Promise<void> | void;
}): Promise<(TAttachment | null)[] | undefined> {
  const collectedUsage: UsageMetadata[] = [];
  try {
    const mutationState: MutationState = {
      attempted: 0,
      successful: 0,
      totalTokens,
      tokenCountsByKey: { ...tokenCountsByKey },
    };
    const metadata = {
      source: 'automatic' as const,
      conversationId,
      messageId: sourceMessageId,
      responseMessageId: messageId,
      model: (llmConfig as { model?: string } | undefined)?.model,
      promptVersion: MEMORY_PROMPT_VERSION,
      evidence,
    };
    const memoryTool = createMemoryTool({
      userId,
      tokenLimit,
      setMemory,
      recordMemoryEvent,
      validKeys,
      charLimit,
      maxValueTokens,
      maxWritesPerTurn,
      mutationState,
      metadata,
    });
    const deleteMemoryTool = createDeleteMemoryTool({
      userId,
      validKeys,
      deleteMemory,
      recordMemoryEvent,
      maxWritesPerTurn,
      mutationState,
      metadata,
    });

    const currentMemoryTokens = totalTokens;

    let memoryStatus = `# Existing memory:\n${memory ?? 'No existing memories'}`;

    if (tokenLimit) {
      const remainingTokens = tokenLimit - currentMemoryTokens;
      memoryStatus = `# Memory Status:
Current memory usage: ${currentMemoryTokens} tokens
Token limit: ${tokenLimit} tokens
Remaining capacity: ${remainingTokens} tokens

# Existing memory:
${memory ?? 'No existing memories'}`;
    }

    const finalLLMConfig: ClientOptions = {
      ...DEFAULT_MEMORY_LLM_CONFIG,
      ...llmConfig,
      /**
       * Ensure streaming is always disabled for memory processing
       */
      streaming: false,
      disableStreaming: true,
    };

    // Handle GPT-5+ models
    if ('model' in finalLLMConfig && /\bgpt-[5-9](?:\.\d+)?\b/i.test(finalLLMConfig.model ?? '')) {
      // Remove temperature for GPT-5+ models
      delete finalLLMConfig.temperature;

      // Move maxTokens to modelKwargs for GPT-5+ models
      if ('maxTokens' in finalLLMConfig && finalLLMConfig.maxTokens != null) {
        const modelKwargs = (finalLLMConfig as OpenAIClientOptions).modelKwargs ?? {};
        const paramName =
          (finalLLMConfig as OpenAIClientOptions).useResponsesApi === true
            ? 'max_output_tokens'
            : 'max_completion_tokens';
        modelKwargs[paramName] = finalLLMConfig.maxTokens;
        delete finalLLMConfig.maxTokens;
        (finalLLMConfig as OpenAIClientOptions).modelKwargs = modelKwargs;
      }
    }

    const bedrockConfig = finalLLMConfig as {
      additionalModelRequestFields?: { thinking?: unknown };
      temperature?: number;
    };
    if (
      llmConfig?.provider === Providers.BEDROCK &&
      bedrockConfig.additionalModelRequestFields?.thinking != null &&
      bedrockConfig.temperature != null
    ) {
      (finalLLMConfig as unknown as Record<string, unknown>).temperature = 1;
    }

    const anthropicConfig = finalLLMConfig as {
      thinking?: { type?: string };
      temperature?: number;
    };
    if (
      llmConfig?.provider === Providers.ANTHROPIC &&
      anthropicConfig.thinking?.type === 'enabled' &&
      anthropicConfig.temperature != null
    ) {
      delete (finalLLMConfig as Record<string, unknown>).temperature;
    }

    const llmConfigWithHeaders = finalLLMConfig as OpenAIClientOptions;
    if (llmConfigWithHeaders?.configuration?.defaultHeaders != null) {
      llmConfigWithHeaders.configuration.defaultHeaders = resolveHeaders({
        headers: llmConfigWithHeaders.configuration.defaultHeaders as Record<string, string>,
        user: user ? createSafeUser(user) : undefined,
      });
    }

    const artifactPromises: Promise<TAttachment | null>[] = [];
    const memoryCallback = createMemoryCallback({ res, artifactPromises, streamId });
    const customHandlers = {
      [GraphEvents.CHAT_MODEL_END]: new BasicModelEndHandler(
        collectedUsage,
        (finalLLMConfig as { model?: string }).model,
      ),
      [GraphEvents.TOOL_END]: new BasicToolEndHandler(memoryCallback),
    };

    /**
     * For Bedrock provider, include instructions in the user message instead of as a system prompt.
     * Bedrock's Converse API requires conversations to start with a user message, not a system message.
     * Other providers can use the standard system prompt approach.
     */
    const isBedrock = llmConfig?.provider === Providers.BEDROCK;

    let graphInstructions: string | undefined = instructions;
    let graphAdditionalInstructions: string | undefined = memoryStatus;
    let processedMessages = messages;

    if (isBedrock) {
      const combinedInstructions = [instructions, memoryStatus].filter(Boolean).join('\n\n');

      if (messages.length > 0) {
        const firstMessage = messages[0];
        const originalContent =
          typeof firstMessage.content === 'string' ? firstMessage.content : '';

        if (typeof firstMessage.content !== 'string') {
          logger.warn(
            'Bedrock memory processing: First message has non-string content, using empty string',
          );
        }

        const bedrockUserMessage = new HumanMessage(
          `${combinedInstructions}\n\n${originalContent}`,
        );
        processedMessages = [bedrockUserMessage, ...messages.slice(1)];
      } else {
        processedMessages = [new HumanMessage(combinedInstructions)];
      }

      graphInstructions = undefined;
      graphAdditionalInstructions = undefined;
    }

    const memoryProvider = llmConfig?.provider ?? DEFAULT_MEMORY_LLM_CONFIG.provider;
    const config = {
      runName: 'MemoryRun',
      configurable: {
        user_id: userId,
        thread_id: conversationId,
        provider: memoryProvider,
        traceMetadata: {
          category: 'memory',
          operation: 'memory_mutation',
          promptVersion: MEMORY_PROMPT_VERSION,
          intent,
          provider: memoryProvider,
          model: (finalLLMConfig as { model?: string }).model,
        },
      },
      streamMode: 'values',
      recursionLimit: 3,
      version: 'v2',
    } as const;

    const availableTools = intent === 'delete' ? [deleteMemoryTool] : [memoryTool];
    const forcedToolName = intent === 'delete' ? 'delete_memory' : 'set_memory';
    for (let attempt = 1; attempt <= maxAttempts && mutationState.successful === 0; attempt++) {
      let attemptInstructions = graphInstructions;
      if (attempt > 1 && !isBedrock) {
        attemptInstructions = `${graphInstructions ?? instructions}\n\nPrevious attempt made no successful memory mutation. You MUST call the available memory tool now.`;
      }
      const attemptLLMConfig = { ...finalLLMConfig, tool_choice: forcedToolName };
      const run = await Run.create({
        runId: messageId,
        graphConfig: {
          type: 'standard',
          llmConfig: attemptLLMConfig,
          tools: availableTools,
          instructions: attemptInstructions,
          additional_instructions: graphAdditionalInstructions,
          toolEnd: true,
        },
        customHandlers,
        returnContent: true,
      });
      await run.processStream({ messages: processedMessages }, config);
    }
    if (
      mutationState.successful === 0 &&
      intent === 'save' &&
      sourceMessageId &&
      evidence &&
      maxWritesPerTurn > 0
    ) {
      const fallbackPayload = getFallbackMemoryPayload(processedMessages);
      if (fallbackPayload) {
        const fallbackValues = splitFallbackMemoryValue(
          fallbackPayload.value,
          maxValueTokens,
          charLimit,
          validKeys?.[0] ? 1 : maxWritesPerTurn,
        );
        const baseKey = validKeys?.[0]
          ? validKeys[0]
          : normalizeMemoryKey(
              `${fallbackPayload.keySeed.slice(0, 72)}_${encodeHashAsLetters(fallbackPayload.keySeed)}`,
            ) || `explicit_memory_${encodeHashAsLetters(fallbackPayload.keySeed)}`;
        logger.warn('[MemoryAgent] Model skipped explicit save; invoking validated fallback', {
          userId,
          conversationId,
          messageId,
          parts: fallbackValues.length,
        });
        for (let index = 0; index < fallbackValues.length; index++) {
          const key = validKeys?.[0]
            ? baseKey
            : normalizeMemoryKey(
                `${baseKey}${index === 0 ? '' : `_part_${String.fromCharCode(97 + index)}`}`,
              );
          await memoryTool.invoke({ key, value: fallbackValues[index] });
        }
      }
    }
    if (mutationState.successful === 0) {
      await recordMemoryEvent?.({
        userId,
        conversationId,
        messageId: sourceMessageId,
        responseMessageId: messageId,
        intent,
        status: 'no_action',
        model: (llmConfig as { model?: string } | undefined)?.model,
        promptVersion: MEMORY_PROMPT_VERSION,
        evidence,
        reason: 'model_produced_no_successful_mutation',
      });
    }
    return await Promise.all(artifactPromises);
  } catch (error) {
    logger.error(
      `[MemoryAgent] Failed to process memory | userId: ${userId} | conversationId: ${conversationId} | messageId: ${messageId}`,
      { error },
    );
  } finally {
    if (collectedUsage.length > 0 && onUsage) {
      try {
        await onUsage(collectedUsage);
      } catch (error) {
        logger.error('[MemoryAgent] Failed to record memory model usage', { error });
      }
    }
  }
}

export async function createMemoryProcessor({
  res,
  userId,
  messageId,
  memoryMethods,
  conversationId,
  config = {},
  streamId = null,
  user,
  onUsage,
}: {
  res: ServerResponse;
  messageId: string;
  conversationId: string;
  userId: string | ObjectId;
  memoryMethods: RequiredMemoryMethods;
  config?: MemoryConfig;
  streamId?: string | null;
  user?: IUser;
  onUsage?: (usage: UsageMetadata[]) => Promise<void> | void;
}): Promise<[string, (messages: BaseMessage[]) => Promise<(TAttachment | null)[] | undefined>]> {
  const {
    validKeys,
    instructions,
    llmConfig,
    tokenLimit,
    charLimit,
    maxValueTokens,
    maxWritesPerTurn,
    maxAttempts,
    intent,
    evidence,
    sourceMessageId,
    auditEnabled,
    consolidateMemories,
  } = config;
  const finalInstructions =
    instructions || getDefaultInstructions(validKeys, tokenLimit, consolidateMemories);

  const { withKeys, withoutKeys, totalTokens, tokenCountsByKey } =
    await memoryMethods.getFormattedMemories({ userId });

  return [
    withoutKeys,
    async function (messages: BaseMessage[]): Promise<(TAttachment | null)[] | undefined> {
      try {
        return await processMemory({
          res,
          userId,
          messages,
          validKeys,
          llmConfig,
          messageId,
          tokenLimit,
          charLimit,
          maxValueTokens,
          maxWritesPerTurn,
          maxAttempts,
          intent,
          evidence,
          sourceMessageId,
          streamId,
          conversationId,
          memory: withKeys,
          totalTokens: totalTokens || 0,
          tokenCountsByKey: tokenCountsByKey || {},
          instructions: finalInstructions,
          setMemory: memoryMethods.setMemory,
          deleteMemory: memoryMethods.deleteMemory,
          recordMemoryEvent: auditEnabled ? memoryMethods.recordMemoryEvent : undefined,
          user,
          onUsage,
        });
      } catch (error) {
        logger.error('Memory Agent failed to process memory', error);
      }
    },
  ];
}

async function handleMemoryArtifact({
  res,
  data,
  metadata,
  streamId = null,
}: {
  res: ServerResponse;
  data: ToolEndData;
  metadata?: ToolEndMetadata;
  streamId?: string | null;
}) {
  const output = data?.output as ToolMessage | undefined;
  if (!output) {
    return null;
  }

  if (!output.artifact) {
    return null;
  }

  const memoryArtifact = output.artifact[Tools.memory] as MemoryArtifact | undefined;
  if (!memoryArtifact) {
    return null;
  }

  const attachment: Partial<TAttachment> = {
    type: Tools.memory,
    toolCallId: output.tool_call_id,
    messageId: metadata?.run_id ?? '',
    conversationId: metadata?.thread_id ?? '',
    [Tools.memory]: memoryArtifact,
  };
  if (!res.headersSent) {
    return attachment;
  }
  if (streamId) {
    GenerationJobManager.emitChunk(streamId, { event: 'attachment', data: attachment });
  } else {
    res.write(`event: attachment\ndata: ${JSON.stringify(attachment)}\n\n`);
  }
  return attachment;
}

/**
 * Creates a memory callback for handling memory artifacts
 * @param params - The parameters object
 * @param params.res - The server response object
 * @param params.artifactPromises - Array to collect artifact promises
 * @param params.streamId - The stream ID for resumable mode, or null for standard mode
 * @returns The memory callback function
 */
export function createMemoryCallback({
  res,
  artifactPromises,
  streamId = null,
}: {
  res: ServerResponse;
  artifactPromises: Promise<Partial<TAttachment> | null>[];
  streamId?: string | null;
}): ToolEndCallback {
  return async (data: ToolEndData, metadata?: Record<string, unknown>) => {
    const output = data?.output as ToolMessage | undefined;
    const memoryArtifact = output?.artifact?.[Tools.memory] as MemoryArtifact;
    if (memoryArtifact == null) {
      return;
    }
    artifactPromises.push(
      handleMemoryArtifact({ res, data, metadata, streamId }).catch((error) => {
        logger.error('Error processing memory artifact content:', error);
        return null;
      }),
    );
  };
}
