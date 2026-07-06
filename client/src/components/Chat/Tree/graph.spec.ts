import {
  getInvalidGraftReason,
  normalizeConversationGraph,
  searchTreeNodes,
  semanticDetail,
} from './graph';

type TestMessage = {
  messageId?: string | null;
  parentMessageId?: string | null;
  text?: string;
  content?: unknown;
  isCreatedByUser?: boolean;
  endpoint?: string | null;
  model?: string | null;
  unfinished?: boolean;
  error?: boolean;
  finish_reason?: string | null;
  metadata?: Record<string, unknown>;
  children?: TestMessage[];
};

const createMessage = (overrides: TestMessage = {}): TestMessage => ({
  messageId: 'message-1',
  parentMessageId: null,
  text: '',
  isCreatedByUser: false,
  endpoint: null,
  model: null,
  unfinished: false,
  error: false,
  finish_reason: null,
  metadata: {},
  children: [],
  ...overrides,
});

describe('conversation tree graph normalization', () => {
  it('normalizes mixed flat and nested inputs, including child-before-parent data', () => {
    const nestedAssistant = createMessage({
      messageId: 'assistant-nested',
      text: 'Nested child',
      isCreatedByUser: false,
      parentMessageId: undefined,
    });
    const lateParent = createMessage({
      messageId: 'parent',
      text: 'Prompt',
      isCreatedByUser: true,
      children: [
        createMessage({
          messageId: 'assistant-early',
          parentMessageId: 'parent',
          text: 'Duplicate that should lose to the first copy',
          isCreatedByUser: false,
        }),
        nestedAssistant,
      ],
    });

    const graph = normalizeConversationGraph([
      createMessage({
        messageId: 'assistant-early',
        parentMessageId: 'parent',
        text: 'First assistant copy',
        isCreatedByUser: false,
      }),
      lateParent,
      createMessage({
        messageId: 'leaf',
        parentMessageId: 'assistant-early',
        text: 'Continuation',
        isCreatedByUser: true,
      }),
    ]);

    expect(graph.rootIds).toEqual(['parent']);
    expect(graph.nodes.get('parent')?.childIds).toEqual(['assistant-early', 'assistant-nested']);
    expect(graph.nodes.get('assistant-early')?.parentId).toBe('parent');
    expect(graph.nodes.get('assistant-nested')?.parentId).toBe('parent');
    expect(graph.nodes.get('assistant-early')?.childIds).toEqual(['leaf']);
    expect(graph.nodes.get('assistant-early')?.message.text).toBe('First assistant copy');
  });

  it('normalizes self-parent and dangling-parent messages to roots consistently', () => {
    const graph = normalizeConversationGraph([
      createMessage({
        messageId: 'self-parent',
        parentMessageId: 'self-parent',
        text: 'self parent',
        isCreatedByUser: false,
      }),
      createMessage({
        messageId: 'dangling-parent',
        parentMessageId: 'missing-parent',
        text: 'dangling parent',
        isCreatedByUser: false,
      }),
      createMessage({
        messageId: 'regular-root',
        text: 'regular root',
        isCreatedByUser: true,
      }),
    ]);

    expect(graph.parentById.get('self-parent')).toBeNull();
    expect(graph.parentById.get('dangling-parent')).toBeNull();
    expect(graph.nodes.get('self-parent')?.parentId).toBeNull();
    expect(graph.nodes.get('dangling-parent')?.parentId).toBeNull();
    expect(graph.childrenByParent.get(null)).toEqual([
      'self-parent',
      'dangling-parent',
      'regular-root',
    ]);
    expect(graph.rootIds).toEqual(['self-parent', 'dangling-parent', 'regular-root']);
  });

  it('classifies complete, stopped, aborted, errored, and streaming lifecycles', () => {
    const graph = normalizeConversationGraph(
      [
        createMessage({
          messageId: 'complete',
          text: 'complete',
        }),
        createMessage({
          messageId: 'stopped',
          text: 'stopped',
          unfinished: true,
          finish_reason: 'length',
        }),
        createMessage({
          messageId: 'aborted',
          text: 'aborted',
          unfinished: true,
          metadata: { generationTermination: 'CANCELLED' },
        }),
        createMessage({
          messageId: 'errored',
          text: 'errored',
          error: true,
        }),
        createMessage({
          messageId: 'streaming',
          text: 'streaming',
          unfinished: true,
        }),
      ],
      {
        activeMessageIds: ['streaming'],
      },
    );

    expect(graph.nodes.get('complete')?.lifecycle).toBe('complete');
    expect(graph.nodes.get('stopped')?.lifecycle).toBe('stopped_partial');
    expect(graph.nodes.get('aborted')?.lifecycle).toBe('aborted_partial');
    expect(graph.nodes.get('errored')?.lifecycle).toBe('errored_partial');
    expect(graph.nodes.get('streaming')?.lifecycle).toBe('streaming');
  });

  it('marks generation graft bridges and graft-copy provenance', () => {
    const graph = normalizeConversationGraph([
      createMessage({
        messageId: 'user',
        text: 'prompt',
        isCreatedByUser: true,
      }),
      createMessage({
        messageId: 'bridge',
        parentMessageId: 'user',
        text: 'Bridge text',
        isCreatedByUser: false,
        metadata: {
          generationGraft: {
            kind: 'generation_graft',
            graftId: 'graft-1',
          },
        },
      }),
      createMessage({
        messageId: 'copy',
        parentMessageId: 'bridge',
        text: 'Copied answer',
        isCreatedByUser: false,
        metadata: {
          generationGraftCopy: {
            kind: 'generation_graft_copy',
            graftId: 'graft-1',
            clonedFromMessageId: 'source-message-1',
          },
        },
      }),
    ]);

    expect(graph.nodes.get('bridge')).toMatchObject({
      role: 'graft_bridge',
      graftId: 'graft-1',
    });
    expect(graph.nodes.get('copy')).toMatchObject({
      role: 'assistant',
      graftId: 'graft-1',
      clonedFromMessageId: 'source-message-1',
    });
  });

  it('assigns one-based generation indices only to assistant siblings', () => {
    const graph = normalizeConversationGraph([
      createMessage({
        messageId: 'parent',
        text: 'prompt',
        isCreatedByUser: true,
      }),
      createMessage({
        messageId: 'assistant-1',
        parentMessageId: 'parent',
        text: 'A1',
        isCreatedByUser: false,
      }),
      createMessage({
        messageId: 'bridge',
        parentMessageId: 'parent',
        text: 'bridge',
        isCreatedByUser: false,
        metadata: {
          generationGraft: {
            kind: 'generation_graft',
            graftId: 'graft-2',
          },
        },
      }),
      createMessage({
        messageId: 'assistant-2',
        parentMessageId: 'parent',
        text: 'A2',
        isCreatedByUser: false,
      }),
      createMessage({
        messageId: 'user-follow-up',
        parentMessageId: 'parent',
        text: 'follow-up',
        isCreatedByUser: true,
      }),
    ]);

    expect(graph.nodes.get('assistant-1')?.generationIndex).toBe(1);
    expect(graph.nodes.get('bridge')?.generationIndex).toBe(0);
    expect(graph.nodes.get('assistant-2')?.generationIndex).toBe(2);
    expect(graph.nodes.get('user-follow-up')?.generationIndex).toBe(0);
  });

  it('returns stable graft validation reasons for missing ids, invalid roles, same-node, and overlap', () => {
    const graph = normalizeConversationGraph([
      createMessage({
        messageId: 'root-a',
        text: 'root a',
        isCreatedByUser: true,
      }),
      createMessage({
        messageId: 'assistant-a',
        parentMessageId: 'root-a',
        text: 'assistant a',
        isCreatedByUser: false,
      }),
      createMessage({
        messageId: 'follow-up-a',
        parentMessageId: 'assistant-a',
        text: 'follow up',
        isCreatedByUser: true,
      }),
      createMessage({
        messageId: 'assistant-descendant',
        parentMessageId: 'follow-up-a',
        text: 'assistant descendant',
        isCreatedByUser: false,
      }),
      createMessage({
        messageId: 'root-b',
        text: 'root b',
        isCreatedByUser: true,
      }),
      createMessage({
        messageId: 'assistant-b',
        parentMessageId: 'root-b',
        text: 'assistant b',
        isCreatedByUser: false,
      }),
    ]);

    expect(getInvalidGraftReason(graph, 'missing', 'assistant-b')).toBe('MESSAGE_NOT_FOUND');
    expect(getInvalidGraftReason(graph, 'root-a', 'assistant-b')).toBe('INVALID_SOURCE');
    expect(getInvalidGraftReason(graph, 'assistant-a', 'root-b')).toBe('INVALID_DESTINATION');
    expect(getInvalidGraftReason(graph, 'assistant-a', 'assistant-a')).toBe('INVALID_DESTINATION');
    expect(getInvalidGraftReason(graph, 'assistant-a', 'assistant-descendant')).toBe(
      'OVERLAPPING_BRANCHES',
    );
    expect(getInvalidGraftReason(graph, 'assistant-a', 'assistant-b')).toBeNull();
  });

  it('keeps stopped and streaming assistant nodes valid when they are on separate branches', () => {
    const graph = normalizeConversationGraph(
      [
        createMessage({
          messageId: 'root-a',
          text: 'root a',
          isCreatedByUser: true,
        }),
        createMessage({
          messageId: 'partial-assistant',
          parentMessageId: 'root-a',
          text: 'partial assistant',
          isCreatedByUser: false,
          unfinished: true,
          finish_reason: 'length',
        }),
        createMessage({
          messageId: 'root-b',
          text: 'root b',
          isCreatedByUser: true,
        }),
        createMessage({
          messageId: 'streaming-assistant',
          parentMessageId: 'root-b',
          text: 'streaming assistant',
          isCreatedByUser: false,
          unfinished: true,
        }),
      ],
      {
        activeMessageIds: ['streaming-assistant'],
      },
    );

    expect(graph.nodes.get('partial-assistant')?.lifecycle).toBe('stopped_partial');
    expect(graph.nodes.get('streaming-assistant')?.lifecycle).toBe('streaming');
    expect(getInvalidGraftReason(graph, 'partial-assistant', 'streaming-assistant')).toBeNull();
    expect(getInvalidGraftReason(graph, 'streaming-assistant', 'partial-assistant')).toBeNull();
  });

  it('builds case-folded searchable text and applies semantic detail thresholds', () => {
    const graph = normalizeConversationGraph([
      createMessage({
        messageId: 'message-1',
        text: '',
        isCreatedByUser: false,
        endpoint: 'OpenAI',
        model: 'gpt-5.6',
        content: [
          {
            type: 'text',
            text: 'Visible body',
          },
        ],
        metadata: {
          generationGraftCopy: {
            kind: 'generation_graft_copy',
            graftId: 'graft-9',
            clonedFromMessageId: 'source-9',
          },
        },
      }),
      createMessage({
        messageId: 'message-2',
        text: 'Another Visible Body',
        isCreatedByUser: false,
      }),
    ]);

    expect(searchTreeNodes(graph, '  visible body  ').map((node) => node.id)).toEqual([
      'message-1',
      'message-2',
    ]);
    expect(searchTreeNodes(graph, 'openai').map((node) => node.id)).toEqual(['message-1']);
    expect(searchTreeNodes(graph, 'SOURCE-9').map((node) => node.id)).toEqual(['message-1']);
    expect(searchTreeNodes(graph, '   ')).toEqual([]);

    expect(semanticDetail(0.54)).toBe('far');
    expect(semanticDetail(0.55)).toBe('medium');
    expect(semanticDetail(1.04)).toBe('medium');
    expect(semanticDetail(1.05)).toBe('near');
  });
});
