const { Constants } = require('librechat-data-provider');

const { GRAFT_BRIDGE_TEXT, PARTIAL_GRAFT_WARNING } = require('./constants');

const loadCloneModule = () => {
  jest.resetModules();
  return require('./clone');
};

const createMessage = (overrides = {}) => ({
  messageId: 'message-1',
  conversationId: 'source-convo',
  parentMessageId: Constants.NO_PARENT,
  isCreatedByUser: false,
  sender: 'Assistant',
  text: 'assistant text',
  content: [],
  files: [],
  attachments: [],
  metadata: {},
  unfinished: false,
  error: false,
  model: 'gpt-test',
  endpoint: 'openAI',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  user: 'source-user',
  ...overrides,
});

const createToolCall = (overrides = {}) => ({
  _id: 'tool-doc-1',
  conversationId: 'source-convo',
  messageId: 'message-1',
  toolId: 'tool-1',
  user: 'source-user',
  result: {},
  attachments: [],
  blockIndex: 0,
  partIndex: 0,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

const expectGraftError = (fn, expectedCode) => {
  try {
    fn();
    throw new Error('Expected function to throw');
  } catch (error) {
    expect(error.name).toBe('GenerationGraftError');
    expect(error.code).toBe(expectedCode);
    return error;
  }
};

describe('MessageGrafts clone plan', () => {
  it('builds the bridge and copied messages in exact output order with parent remapping', () => {
    const { buildClonePlan } = loadCloneModule();
    const now = new Date('2026-07-06T16:00:00.000Z');
    const ids = ['bridge-1', 'copy-root', 'copy-child'];
    const uuid = jest.fn(() => ids.shift());
    const messages = [
      createMessage({
        messageId: 'source-root',
        text: 'root',
      }),
      createMessage({
        messageId: 'source-child',
        parentMessageId: 'source-root',
        text: 'child',
      }),
    ];

    const plan = buildClonePlan({
      messages,
      toolCalls: [],
      conversationId: 'shared-convo',
      destinationMessageId: 'dest-assistant',
      graftId: 'graft-1',
      idempotencyKey: 'idempotency-1',
      mode: 'subtree',
      sourceState: 'complete',
      destinationState: 'complete',
      userId: 'dest-user',
      activeSourceLeafMessageId: 'source-child',
      uuid,
      now,
    });

    expect(plan).toMatchObject({
      bridgeMessageId: 'bridge-1',
      copiedRootMessageId: 'copy-root',
      activeCopiedMessageId: 'copy-child',
      copiedMessageIds: ['copy-root', 'copy-child'],
      toolCalls: [],
    });
    expect(plan.messages.map((message) => message.messageId)).toEqual([
      'bridge-1',
      'copy-root',
      'copy-child',
    ]);
    expect(plan.messages[0]).toMatchObject({
      conversationId: 'shared-convo',
      parentMessageId: 'dest-assistant',
      isCreatedByUser: true,
      sender: 'Graft',
      text: GRAFT_BRIDGE_TEXT,
      unfinished: false,
      error: false,
      user: 'dest-user',
      metadata: {
        generationGraft: {
          kind: 'generation_graft',
          graftId: 'graft-1',
          idempotencyKey: 'idempotency-1',
          sourceConversationId: 'shared-convo',
          sourceRootMessageId: 'source-root',
          sourceMessageIds: ['source-root', 'source-child'],
          destinationConversationId: 'shared-convo',
          destinationMessageId: 'dest-assistant',
          copiedRootMessageId: 'copy-root',
          copiedMessageIds: ['copy-root', 'copy-child'],
          activeCopiedMessageId: 'copy-child',
          mode: 'subtree',
          sourceState: 'complete',
          destinationState: 'complete',
          createdAt: now.toISOString(),
        },
      },
    });
    expect(plan.messages[1]).toMatchObject({
      messageId: 'copy-root',
      parentMessageId: 'bridge-1',
      conversationId: 'shared-convo',
      user: 'dest-user',
      metadata: {
        generationGraftCopy: {
          kind: 'generation_graft_copy',
          graftId: 'graft-1',
          clonedFromMessageId: 'source-root',
          usageSourceMessageId: 'source-root',
        },
      },
    });
    expect(plan.messages[2]).toMatchObject({
      messageId: 'copy-child',
      parentMessageId: 'copy-root',
      conversationId: 'shared-convo',
      user: 'dest-user',
      metadata: {
        generationGraftCopy: {
          kind: 'generation_graft_copy',
          graftId: 'graft-1',
          clonedFromMessageId: 'source-child',
          usageSourceMessageId: 'source-child',
        },
      },
    });
    expect(plan.messages[0].createdAt.toISOString()).toBe('2026-07-06T16:00:00.000Z');
    expect(plan.messages[1].createdAt.toISOString()).toBe('2026-07-06T16:00:00.001Z');
    expect(plan.messages[2].createdAt.toISOString()).toBe('2026-07-06T16:00:00.002Z');
    expect(uuid).toHaveBeenCalledTimes(3);
  });

  it('remaps only LibreChat-owned file and attachment back-references without changing stored file identifiers', () => {
    const { buildClonePlan } = loadCloneModule();
    const sourceMessages = [
      createMessage({
        messageId: 'source-root',
        files: [
          {
            file_id: 'file-1',
            filepath: '/tmp/file-1.txt',
            image_path: '/tmp/image.png',
            messageId: 'source-root',
          },
        ],
        attachments: [
          {
            file_id: 'attach-1',
            filepath: '/tmp/attach-1.txt',
            metadata: {
              messageId: 'source-root',
              toolId: 'tool-1',
            },
          },
        ],
        content: [
          {
            type: 'text',
            text: { value: 'hello' },
            messageId: 'source-root',
            image_path: '/tmp/content.png',
            file_id: 'content-file-1',
          },
          {
            type: 'tool_call',
            tool_call: {
              id: 'call-1',
              toolId: 'tool-1',
              metadata: {
                messageId: 'source-root',
              },
            },
          },
        ],
        metadata: {
          nested: {
            messageId: 'source-root',
            file_id: 'meta-file-1',
            filepath: '/tmp/meta.txt',
          },
        },
      }),
    ];
    const sourceToolCalls = [
      createToolCall({
        messageId: 'source-root',
        attachments: [
          {
            file_id: 'tool-file-1',
            filepath: '/tmp/tool-file.txt',
            messageId: 'source-root',
          },
        ],
        result: {
          outputs: [
            {
              type: 'json',
              payload: {
                messageId: 'source-root',
                file_id: 'tool-result-file-1',
                filepath: '/tmp/tool-result.txt',
              },
            },
          ],
        },
      }),
    ];
    const sourceMessagesBefore = structuredClone(sourceMessages);
    const sourceToolCallsBefore = structuredClone(sourceToolCalls);
    const ids = ['bridge-1', 'copy-root'];
    const plan = buildClonePlan({
      messages: sourceMessages,
      toolCalls: sourceToolCalls,
      conversationId: 'shared-convo',
      destinationMessageId: 'dest-assistant',
      graftId: 'graft-1',
      idempotencyKey: 'idempotency-1',
      mode: 'generation',
      sourceState: 'complete',
      destinationState: 'complete',
      userId: 'dest-user',
      uuid: () => ids.shift(),
      now: new Date('2026-07-06T16:00:00.000Z'),
    });

    const copiedMessage = plan.messages[1];
    const copiedToolCall = plan.toolCalls[0];

    expect(copiedMessage.files[0]).toMatchObject({
      file_id: 'file-1',
      filepath: '/tmp/file-1.txt',
      image_path: '/tmp/image.png',
      messageId: 'copy-root',
    });
    expect(copiedMessage.attachments[0]).toMatchObject({
      file_id: 'attach-1',
      filepath: '/tmp/attach-1.txt',
      metadata: {
        messageId: 'copy-root',
        toolId: 'tool-1',
      },
    });
    expect(copiedMessage.content[0]).toMatchObject({
      messageId: 'source-root',
      image_path: '/tmp/content.png',
      file_id: 'content-file-1',
    });
    expect(copiedMessage.content[1].tool_call.metadata.messageId).toBe('source-root');
    expect(copiedMessage.metadata.nested).toMatchObject({
      messageId: 'source-root',
      file_id: 'meta-file-1',
      filepath: '/tmp/meta.txt',
    });

    expect(copiedToolCall).toMatchObject({
      conversationId: 'shared-convo',
      messageId: 'copy-root',
      toolId: 'tool-1',
      user: 'dest-user',
      attachments: [
        {
          file_id: 'tool-file-1',
          filepath: '/tmp/tool-file.txt',
          messageId: 'copy-root',
        },
      ],
    });
    expect(copiedToolCall.result.outputs[0].payload).toMatchObject({
      messageId: 'source-root',
      file_id: 'tool-result-file-1',
      filepath: '/tmp/tool-result.txt',
    });
    expect(sourceMessages).toEqual(sourceMessagesBefore);
    expect(sourceToolCalls).toEqual(sourceToolCallsBefore);
  });

  it('preserves arbitrary content, metadata, and tool result messageId values even when they match source ids', () => {
    const { buildClonePlan } = loadCloneModule();
    const ids = ['bridge-1', 'copy-root'];

    const plan = buildClonePlan({
      messages: [
        createMessage({
          messageId: 'source-root',
          files: [{ file_id: 'file-1', filepath: '/tmp/file.txt', messageId: 'source-root' }],
          attachments: [
            { file_id: 'attach-1', filepath: '/tmp/attach.txt', messageId: 'source-root' },
          ],
          content: [
            {
              type: 'text',
              text: { value: 'hello' },
              messageId: 'source-root',
            },
          ],
          metadata: {
            arbitraryMessageId: 'source-root',
            nested: { messageId: 'source-root' },
          },
        }),
      ],
      toolCalls: [
        createToolCall({
          messageId: 'source-root',
          attachments: [
            { file_id: 'tool-file-1', filepath: '/tmp/tool.txt', messageId: 'source-root' },
          ],
          result: {
            nested: {
              messageId: 'source-root',
            },
          },
        }),
      ],
      conversationId: 'shared-convo',
      destinationMessageId: 'dest-assistant',
      graftId: 'graft-1',
      idempotencyKey: 'idempotency-1',
      mode: 'generation',
      sourceState: 'complete',
      destinationState: 'complete',
      userId: 'dest-user',
      uuid: () => ids.shift(),
      now: new Date('2026-07-06T16:00:00.000Z'),
    });

    expect(plan.messages[1].files[0].messageId).toBe('copy-root');
    expect(plan.messages[1].attachments[0].messageId).toBe('copy-root');
    expect(plan.messages[1].content[0].messageId).toBe('source-root');
    expect(plan.messages[1].metadata).toMatchObject({
      arbitraryMessageId: 'source-root',
      nested: { messageId: 'source-root' },
    });
    expect(plan.toolCalls[0].attachments[0].messageId).toBe('copy-root');
    expect(plan.toolCalls[0].result).toEqual({
      nested: {
        messageId: 'source-root',
      },
    });
  });

  it('uses the canonical warning text whenever either side is partial and preserves source partial flags', () => {
    const { buildClonePlan } = loadCloneModule();
    const stableStates = ['complete', 'stopped_partial', 'aborted_partial', 'errored_partial'];

    for (const sourceState of stableStates) {
      for (const destinationState of stableStates) {
        const ids = ['bridge-1', 'copy-root'];
        const unfinished = sourceState === 'stopped_partial' || sourceState === 'aborted_partial';
        const error = sourceState === 'errored_partial';
        const text =
          sourceState === 'complete' && destinationState === 'complete'
            ? GRAFT_BRIDGE_TEXT
            : `${GRAFT_BRIDGE_TEXT}\n\n${PARTIAL_GRAFT_WARNING}`;
        const plan = buildClonePlan({
          messages: [
            createMessage({
              messageId: 'source-root',
              unfinished,
              error,
            }),
          ],
          toolCalls: [],
          conversationId: 'shared-convo',
          destinationMessageId: 'dest-assistant',
          graftId: 'graft-1',
          idempotencyKey: 'idempotency-1',
          mode: 'generation',
          sourceState,
          destinationState,
          userId: 'dest-user',
          uuid: () => ids.shift(),
          now: new Date('2026-07-06T16:00:00.000Z'),
        });

        expect(plan.messages[0].text).toBe(text);
        expect(plan.messages[1].unfinished).toBe(unfinished);
        expect(plan.messages[1].error).toBe(error);
      }
    }
  });

  it('maps the active source leaf to the copied subtree and rejects invalid active leaf ids', () => {
    const { buildClonePlan } = loadCloneModule();
    const messages = [
      createMessage({ messageId: 'source-root' }),
      createMessage({ messageId: 'source-child', parentMessageId: 'source-root' }),
    ];

    const validIds = ['bridge-1', 'copy-root', 'copy-child'];
    const plan = buildClonePlan({
      messages,
      toolCalls: [],
      conversationId: 'shared-convo',
      destinationMessageId: 'dest-assistant',
      graftId: 'graft-1',
      idempotencyKey: 'idempotency-1',
      mode: 'subtree',
      sourceState: 'complete',
      destinationState: 'complete',
      userId: 'dest-user',
      activeSourceLeafMessageId: 'source-child',
      uuid: () => validIds.shift(),
      now: new Date('2026-07-06T16:00:00.000Z'),
    });

    expect(plan.activeCopiedMessageId).toBe('copy-child');

    const invalidIds = ['bridge-2', 'copy-root-2', 'copy-child-2'];
    expectGraftError(
      () =>
        buildClonePlan({
          messages,
          toolCalls: [],
          conversationId: 'shared-convo',
          destinationMessageId: 'dest-assistant',
          graftId: 'graft-2',
          idempotencyKey: 'idempotency-2',
          mode: 'subtree',
          sourceState: 'complete',
          destinationState: 'complete',
          userId: 'dest-user',
          activeSourceLeafMessageId: 'missing-leaf',
          uuid: () => invalidIds.shift(),
          now: new Date('2026-07-06T16:00:00.000Z'),
        }),
      'INVALID_SOURCE',
    );
  });

  it('defaults an omitted active source leaf to the copied root', () => {
    const { buildClonePlan } = loadCloneModule();
    const ids = ['bridge-1', 'copy-root', 'copy-child'];

    const plan = buildClonePlan({
      messages: [
        createMessage({ messageId: 'source-root' }),
        createMessage({ messageId: 'source-child', parentMessageId: 'source-root' }),
      ],
      toolCalls: [],
      conversationId: 'shared-convo',
      destinationMessageId: 'dest-assistant',
      graftId: 'graft-1',
      idempotencyKey: 'idempotency-1',
      mode: 'generation',
      sourceState: 'complete',
      destinationState: 'complete',
      userId: 'dest-user',
      uuid: () => ids.shift(),
      now: new Date('2026-07-06T16:00:00.000Z'),
    });

    expect(plan.activeCopiedMessageId).toBe('copy-root');
    expect(plan.messages[0].metadata.generationGraft.activeCopiedMessageId).toBe('copy-root');
  });

  it('remaps nested graft metadata with stable nested graft ids and remapped sourceRootMessageId', () => {
    const { buildClonePlan } = loadCloneModule();
    const ids = ['bridge-1', 'copy-root', 'copy-child', 'nested-graft-1', 'nested-idempotency-1'];
    const plan = buildClonePlan({
      messages: [
        createMessage({
          messageId: 'source-root',
          metadata: {
            generationGraft: {
              kind: 'generation_graft',
              graftId: 'nested-old-graft',
              idempotencyKey: 'nested-old-idempotency',
              sourceConversationId: 'older-convo',
              sourceRootMessageId: 'source-root',
              sourceMessageIds: ['source-root', 'source-child', 'external-message'],
              destinationConversationId: 'older-dest-convo',
              destinationMessageId: 'source-child',
              copiedRootMessageId: 'source-root',
              copiedMessageIds: ['source-root', 'source-child'],
              activeCopiedMessageId: 'source-child',
            },
          },
        }),
        createMessage({
          messageId: 'source-child',
          parentMessageId: 'source-root',
          metadata: {
            generationGraft: {
              kind: 'generation_graft',
              graftId: 'nested-old-graft',
              idempotencyKey: 'nested-old-idempotency',
              sourceConversationId: 'older-convo',
              sourceRootMessageId: 'source-root',
              sourceMessageIds: ['source-root', 'source-child'],
              destinationConversationId: 'older-dest-convo',
              destinationMessageId: 'source-child',
              copiedRootMessageId: 'source-root',
              copiedMessageIds: ['source-root', 'source-child'],
              activeCopiedMessageId: 'source-child',
            },
          },
        }),
      ],
      toolCalls: [],
      conversationId: 'shared-convo',
      destinationMessageId: 'dest-assistant',
      graftId: 'graft-1',
      idempotencyKey: 'idempotency-1',
      mode: 'subtree',
      sourceState: 'complete',
      destinationState: 'complete',
      userId: 'dest-user',
      activeSourceLeafMessageId: 'source-child',
      uuid: () => ids.shift(),
      now: new Date('2026-07-06T16:00:00.000Z'),
    });

    const nestedRoot = plan.messages[1].metadata.generationGraft;
    const nestedChild = plan.messages[2].metadata.generationGraft;

    expect(nestedRoot.graftId).toBe('nested-graft-1');
    expect(nestedRoot.idempotencyKey).toBe('nested-idempotency-1');
    expect(nestedChild.graftId).toBe('nested-graft-1');
    expect(nestedChild.idempotencyKey).toBe('nested-idempotency-1');
    expect(nestedRoot.sourceRootMessageId).toBe('copy-root');
    expect(nestedRoot.sourceMessageIds).toEqual(['copy-root', 'copy-child', 'external-message']);
    expect(nestedRoot.destinationMessageId).toBe('copy-child');
    expect(nestedRoot.copiedRootMessageId).toBe('copy-root');
    expect(nestedRoot.copiedMessageIds).toEqual(['copy-root', 'copy-child']);
    expect(nestedRoot.activeCopiedMessageId).toBe('copy-child');
    expect(plan.messages[1].metadata.generationGraftCopy).toEqual({
      kind: 'generation_graft_copy',
      graftId: 'graft-1',
      clonedFromMessageId: 'source-root',
      usageSourceMessageId: 'source-root',
    });
    expect(plan.messages[2].metadata.generationGraftCopy).toEqual({
      kind: 'generation_graft_copy',
      graftId: 'graft-1',
      clonedFromMessageId: 'source-child',
      usageSourceMessageId: 'source-child',
    });
  });

  it('preserves the original usage source when a graft copy is grafted again', () => {
    const { buildClonePlan } = loadCloneModule();
    const ids = ['bridge-2', 'copy-second'];
    const plan = buildClonePlan({
      messages: [
        createMessage({
          messageId: 'copy-first',
          metadata: {
            generationGraftCopy: {
              kind: 'generation_graft_copy',
              graftId: 'graft-1',
              clonedFromMessageId: 'source-root',
              usageSourceMessageId: 'source-original',
            },
          },
        }),
      ],
      toolCalls: [],
      conversationId: 'shared-convo',
      destinationMessageId: 'dest-assistant',
      graftId: 'graft-2',
      idempotencyKey: 'idempotency-2',
      mode: 'generation',
      sourceState: 'complete',
      destinationState: 'complete',
      userId: 'dest-user',
      uuid: () => ids.shift(),
      now: new Date('2026-07-06T16:00:00.000Z'),
    });

    expect(plan.messages[1].metadata.generationGraftCopy).toEqual({
      kind: 'generation_graft_copy',
      graftId: 'graft-2',
      clonedFromMessageId: 'copy-first',
      usageSourceMessageId: 'source-original',
    });
  });

  it('strips Mongo fields from lean objects and Mongoose-like toObject records', () => {
    const { stripMongoFields, remapEmbeddedMessageIds, remapNestedGraftMetadata } =
      loadCloneModule();

    expect(
      stripMongoFields({
        _id: 'doc-1',
        __v: 7,
        id: 'virtual-doc-1',
        user: 'source-user',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:01.000Z'),
        $__: { internal: true },
        isNew: true,
        messageId: 'source-root',
        nested: { keep: true },
      }),
    ).toEqual({
      messageId: 'source-root',
      nested: { keep: true },
    });

    const mongooseLike = {
      toObject: () => ({
        _id: 'doc-2',
        __v: 2,
        user: 'source-user',
        messageId: 'source-child',
        metadata: {
          generationGraft: {
            graftId: 'nested-old-graft',
            sourceRootMessageId: 'source-child',
            sourceMessageIds: ['source-child'],
            destinationMessageId: 'source-child',
            copiedRootMessageId: 'source-child',
            copiedMessageIds: ['source-child'],
            activeCopiedMessageId: 'source-child',
          },
        },
      }),
    };
    const stripped = stripMongoFields(mongooseLike);
    const remapped = remapEmbeddedMessageIds(stripped, new Map([['source-child', 'copy-child']]));
    const nested = remapNestedGraftMetadata(remapped, {
      sourceToCopyMessageId: new Map([['source-child', 'copy-child']]),
      nestedGraftIds: new Map([['nested-old-graft', 'nested-graft-1']]),
      nestedIdempotencyKeys: new Map([['nested-old-graft', 'nested-idempotency-1']]),
      uuid: () => {
        throw new Error('uuid should not be called when nested mapping exists');
      },
    });

    expect(nested).toEqual({
      messageId: 'copy-child',
      metadata: {
        generationGraft: {
          graftId: 'nested-graft-1',
          idempotencyKey: 'nested-idempotency-1',
          sourceRootMessageId: 'copy-child',
          sourceMessageIds: ['copy-child'],
          destinationMessageId: 'copy-child',
          copiedRootMessageId: 'copy-child',
          copiedMessageIds: ['copy-child'],
          activeCopiedMessageId: 'copy-child',
        },
      },
    });
  });

  it('clones mixed values safely without flattening buffers, typed arrays, maps, sets, or immutable objects', () => {
    const { buildClonePlan, stripMongoFields } = loadCloneModule();
    const sourceBuffer = Buffer.from('hello');
    const sourceTypedArray = new Uint16Array([4, 8, 15, 16, 23, 42]);
    const sourceArrayBuffer = sourceTypedArray.buffer.slice(0);
    const sourceMap = new Map([
      ['messageId', 'source-root'],
      ['nested', { keep: true }],
    ]);
    const sourceSet = new Set(['source-root', 'other-id']);
    const bsonLike = {
      value: 'opaque',
      clone: jest.fn(function clone() {
        return { kind: 'bson-like-clone', value: this.value };
      }),
    };
    const opaque = Object.create({ inherited: true });
    opaque.value = 'opaque';

    const stripped = stripMongoFields({
      _id: 'doc-1',
      messageId: 'source-root',
      payload: {
        buffer: sourceBuffer,
        typed: sourceTypedArray,
        arrayBuffer: sourceArrayBuffer,
        map: sourceMap,
        set: sourceSet,
        bsonLike,
        opaque,
      },
    });

    expect(Buffer.isBuffer(stripped.payload.buffer)).toBe(true);
    expect(stripped.payload.buffer).not.toBe(sourceBuffer);
    expect(stripped.payload.buffer.equals(sourceBuffer)).toBe(true);
    expect(stripped.payload.typed).toBeInstanceOf(Uint16Array);
    expect(stripped.payload.typed).not.toBe(sourceTypedArray);
    expect(Array.from(stripped.payload.typed)).toEqual(Array.from(sourceTypedArray));
    expect(Object.prototype.toString.call(stripped.payload.arrayBuffer)).toBe(
      '[object ArrayBuffer]',
    );
    expect(stripped.payload.arrayBuffer).not.toBe(sourceArrayBuffer);
    expect(Array.from(new Uint16Array(stripped.payload.arrayBuffer))).toEqual(
      Array.from(new Uint16Array(sourceArrayBuffer)),
    );
    expect(stripped.payload.map).toBeInstanceOf(Map);
    expect(stripped.payload.map).not.toBe(sourceMap);
    expect(Array.from(stripped.payload.map.entries())).toEqual(Array.from(sourceMap.entries()));
    expect(stripped.payload.set).toBeInstanceOf(Set);
    expect(stripped.payload.set).not.toBe(sourceSet);
    expect(Array.from(stripped.payload.set.values())).toEqual(Array.from(sourceSet.values()));
    expect(bsonLike.clone).toHaveBeenCalledTimes(1);
    expect(stripped.payload.bsonLike).toEqual({ kind: 'bson-like-clone', value: 'opaque' });
    expect(stripped.payload.bsonLike).not.toBe(bsonLike);
    expect(stripped.payload.opaque).toBe(opaque);

    const messageSourceBuffer = Buffer.from('world');
    const messageSourceMap = new Map([['key', 'value']]);
    const messageSourceSet = new Set(['alpha', 'beta']);
    const messageSourceTypedArray = new Uint8Array([1, 2, 3]);
    const messageBsonLike = {
      value: 'message-opaque',
      clone: jest.fn(function clone() {
        return { kind: 'message-bson-clone', value: this.value };
      }),
    };
    const sourceMessages = [
      createMessage({
        messageId: 'source-root',
        metadata: {
          buffer: messageSourceBuffer,
          map: messageSourceMap,
          set: messageSourceSet,
          typed: messageSourceTypedArray,
          bsonLike: messageBsonLike,
        },
      }),
    ];
    const ids = ['bridge-1', 'copy-root'];

    const plan = buildClonePlan({
      messages: sourceMessages,
      toolCalls: [],
      conversationId: 'shared-convo',
      destinationMessageId: 'dest-assistant',
      graftId: 'graft-1',
      idempotencyKey: 'idempotency-1',
      mode: 'generation',
      sourceState: 'complete',
      destinationState: 'complete',
      userId: 'dest-user',
      uuid: () => ids.shift(),
      now: new Date('2026-07-06T16:00:00.000Z'),
    });

    expect(Buffer.isBuffer(plan.messages[1].metadata.buffer)).toBe(true);
    expect(plan.messages[1].metadata.buffer).not.toBe(messageSourceBuffer);
    expect(plan.messages[1].metadata.buffer.equals(messageSourceBuffer)).toBe(true);
    expect(plan.messages[1].metadata.map).toBeInstanceOf(Map);
    expect(plan.messages[1].metadata.map).not.toBe(messageSourceMap);
    expect(Array.from(plan.messages[1].metadata.map.entries())).toEqual(
      Array.from(messageSourceMap.entries()),
    );
    expect(plan.messages[1].metadata.set).toBeInstanceOf(Set);
    expect(plan.messages[1].metadata.set).not.toBe(messageSourceSet);
    expect(Array.from(plan.messages[1].metadata.set.values())).toEqual(
      Array.from(messageSourceSet.values()),
    );
    expect(plan.messages[1].metadata.typed).toBeInstanceOf(Uint8Array);
    expect(plan.messages[1].metadata.typed).not.toBe(messageSourceTypedArray);
    expect(Array.from(plan.messages[1].metadata.typed)).toEqual(
      Array.from(messageSourceTypedArray),
    );
    expect(messageBsonLike.clone).toHaveBeenCalledTimes(1);
    expect(plan.messages[1].metadata.bsonLike).toEqual({
      kind: 'message-bson-clone',
      value: 'message-opaque',
    });
    expect(sourceMessages[0].metadata.buffer).toBe(messageSourceBuffer);
    expect(sourceMessages[0].metadata.map).toBe(messageSourceMap);
    expect(sourceMessages[0].metadata.set).toBe(messageSourceSet);
    expect(sourceMessages[0].metadata.typed).toBe(messageSourceTypedArray);
    expect(sourceMessages[0].metadata.bsonLike).toBe(messageBsonLike);
  });

  it('rejects empty, duplicate, and non-topological message inputs', () => {
    const { buildClonePlan } = loadCloneModule();
    const basePayload = {
      toolCalls: [],
      conversationId: 'shared-convo',
      destinationMessageId: 'dest-assistant',
      graftId: 'graft-1',
      idempotencyKey: 'idempotency-1',
      mode: 'generation',
      sourceState: 'complete',
      destinationState: 'complete',
      userId: 'dest-user',
      uuid: () => 'unused',
      now: new Date('2026-07-06T16:00:00.000Z'),
    };

    expectGraftError(() => buildClonePlan({ ...basePayload, messages: [] }), 'INVALID_SOURCE');
    expectGraftError(
      () =>
        buildClonePlan({
          ...basePayload,
          messages: [
            createMessage({ messageId: 'duplicate' }),
            createMessage({ messageId: 'duplicate' }),
          ],
        }),
      'INVALID_SOURCE',
    );
    expectGraftError(
      () =>
        buildClonePlan({
          ...basePayload,
          messages: [
            createMessage({ messageId: 'child', parentMessageId: 'root' }),
            createMessage({ messageId: 'root' }),
          ],
        }),
      'INVALID_SOURCE',
    );
    expectGraftError(
      () =>
        buildClonePlan({
          ...basePayload,
          messages: [createMessage({ messageId: 'root' })],
          sourceState: 'streaming',
        }),
      'INVALID_SOURCE',
    );
    expectGraftError(
      () =>
        buildClonePlan({
          ...basePayload,
          messages: [createMessage({ messageId: 'root' })],
          conversationId: '',
        }),
      'INVALID_SOURCE',
    );
    expectGraftError(
      () =>
        buildClonePlan({
          ...basePayload,
          messages: [createMessage({ messageId: 'root' })],
          graftId: '',
        }),
      'INVALID_SOURCE',
    );
    expectGraftError(
      () =>
        buildClonePlan({
          ...basePayload,
          messages: [createMessage({ messageId: 'root' })],
          idempotencyKey: '',
        }),
      'INVALID_SOURCE',
    );
    expectGraftError(
      () =>
        buildClonePlan({
          ...basePayload,
          messages: [createMessage({ messageId: 'root' })],
          destinationMessageId: '',
        }),
      'INVALID_SOURCE',
    );
    expectGraftError(
      () =>
        buildClonePlan({
          ...basePayload,
          messages: [createMessage({ messageId: 'root' })],
          mode: 'clone',
        }),
      'INVALID_SOURCE',
    );
  });

  it('rejects tool calls that point outside the copied subtree', () => {
    const { buildClonePlan } = loadCloneModule();

    expectGraftError(
      () =>
        buildClonePlan({
          messages: [createMessage({ messageId: 'source-root' })],
          toolCalls: [createToolCall({ messageId: 'outside-message' })],
          conversationId: 'shared-convo',
          destinationMessageId: 'dest-assistant',
          graftId: 'graft-1',
          idempotencyKey: 'idempotency-1',
          mode: 'generation',
          sourceState: 'complete',
          destinationState: 'complete',
          userId: 'dest-user',
          uuid: () => 'unused',
          now: new Date('2026-07-06T16:00:00.000Z'),
        }),
      'INVALID_SOURCE',
    );
  });

  it('rejects repeated generated identities instead of returning a colliding plan', () => {
    const { buildClonePlan } = loadCloneModule();

    expectGraftError(
      () =>
        buildClonePlan({
          messages: [
            createMessage({ messageId: 'source-root' }),
            createMessage({ messageId: 'source-child', parentMessageId: 'source-root' }),
          ],
          toolCalls: [],
          conversationId: 'shared-convo',
          destinationMessageId: 'dest-assistant',
          graftId: 'graft-outer',
          idempotencyKey: 'idempotency-outer',
          mode: 'subtree',
          sourceState: 'complete',
          destinationState: 'complete',
          userId: 'dest-user',
          activeSourceLeafMessageId: 'source-child',
          uuid: (() => {
            const ids = ['bridge-1', 'bridge-1', 'copy-child'];
            return () => ids.shift();
          })(),
          now: new Date('2026-07-06T16:00:00.000Z'),
        }),
      'INVALID_SOURCE',
    );

    expectGraftError(
      () =>
        buildClonePlan({
          messages: [
            createMessage({
              messageId: 'source-root',
              metadata: {
                generationGraft: {
                  kind: 'generation_graft',
                  graftId: 'nested-old-graft',
                  idempotencyKey: 'nested-old-idempotency',
                  sourceRootMessageId: 'source-root',
                  sourceMessageIds: ['source-root'],
                  destinationMessageId: 'source-root',
                  copiedRootMessageId: 'source-root',
                  copiedMessageIds: ['source-root'],
                  activeCopiedMessageId: 'source-root',
                },
              },
            }),
          ],
          toolCalls: [],
          conversationId: 'shared-convo',
          destinationMessageId: 'dest-assistant',
          graftId: 'graft-outer',
          idempotencyKey: 'idempotency-outer',
          mode: 'generation',
          sourceState: 'complete',
          destinationState: 'complete',
          userId: 'dest-user',
          uuid: (() => {
            const ids = ['bridge-1', 'copy-root', 'graft-outer', 'nested-idempotency-1'];
            return () => ids.shift();
          })(),
          now: new Date('2026-07-06T16:00:00.000Z'),
        }),
      'INVALID_SOURCE',
    );
  });
});
