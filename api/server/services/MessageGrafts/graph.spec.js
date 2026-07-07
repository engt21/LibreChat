const { Constants } = require('librechat-data-provider');

const loadGraphModule = () => {
  jest.resetModules();
  return {
    ...require('./constants'),
    ...require('./graph'),
  };
};

const createMessage = (overrides = {}) => ({
  messageId: 'message-1',
  parentMessageId: Constants.NO_PARENT,
  isCreatedByUser: false,
  unfinished: false,
  error: false,
  finish_reason: null,
  metadata: {},
  ...overrides,
});

const expectGraftError = (fn, expectedCode, expectedStatusCode) => {
  try {
    fn();
    throw new Error('Expected function to throw');
  } catch (error) {
    expect(error.name).toBe('GenerationGraftError');
    expect(error.code).toBe(expectedCode);
    if (expectedStatusCode != null) {
      expect(error.statusCode).toBe(expectedStatusCode);
    }
    return error;
  }
};

describe('MessageGrafts graph primitives', () => {
  describe('constants', () => {
    const originalMaxMessages = process.env.GRAFT_MAX_MESSAGES;
    const originalMaxPayloadBytes = process.env.GRAFT_MAX_PAYLOAD_BYTES;

    afterEach(() => {
      if (originalMaxMessages === undefined) {
        delete process.env.GRAFT_MAX_MESSAGES;
      } else {
        process.env.GRAFT_MAX_MESSAGES = originalMaxMessages;
      }

      if (originalMaxPayloadBytes === undefined) {
        delete process.env.GRAFT_MAX_PAYLOAD_BYTES;
      } else {
        process.env.GRAFT_MAX_PAYLOAD_BYTES = originalMaxPayloadBytes;
      }
    });

    it('exports the canonical graft bridge and warning text', () => {
      const { GRAFT_BRIDGE_TEXT, PARTIAL_GRAFT_WARNING } = loadGraphModule();

      expect(GRAFT_BRIDGE_TEXT).toBe(
        'An alternate completed assistant generation was grafted into this branch. Treat the following assistant message and any copied continuation as prior conversation context.',
      );
      expect(PARTIAL_GRAFT_WARNING).toBe(
        'One or both grafted generations are incomplete. Treat their content as partial prior context and do not assume that either represents a finished answer.',
      );
    });

    it('parses positive environment overrides and falls back for invalid values', () => {
      process.env.GRAFT_MAX_MESSAGES = '512';
      process.env.GRAFT_MAX_PAYLOAD_BYTES = '33554432';

      let constants = loadGraphModule();
      expect(constants.MAX_GRAFT_MESSAGES).toBe(512);
      expect(constants.MAX_GRAFT_PAYLOAD_BYTES).toBe(33554432);

      process.env.GRAFT_MAX_MESSAGES = '0';
      process.env.GRAFT_MAX_PAYLOAD_BYTES = '-1';

      constants = loadGraphModule();
      expect(constants.MAX_GRAFT_MESSAGES).toBe(250);
      expect(constants.MAX_GRAFT_PAYLOAD_BYTES).toBe(8 * 1024 * 1024);
    });

    it('preserves graft error metadata on GenerationGraftError instances', () => {
      const { GenerationGraftError } = loadGraphModule();
      const error = new GenerationGraftError('GRAFT_BUSY', 'Graft is busy', 409, {
        activeMessageIds: ['message-1'],
      });

      expect(error.message).toBe('Graft is busy');
      expect(error.name).toBe('GenerationGraftError');
      expect(error.code).toBe('GRAFT_BUSY');
      expect(error.statusCode).toBe(409);
      expect(error.details).toEqual({ activeMessageIds: ['message-1'] });
      expect(error.activeMessageIds).toEqual(['message-1']);
    });
  });

  describe('buildMessageGraph', () => {
    it('rejects non-array inputs, missing ids, and duplicate ids', () => {
      const { buildMessageGraph } = loadGraphModule();

      expectGraftError(() => buildMessageGraph(null), 'INVALID_SOURCE', 400);
      expectGraftError(
        () => buildMessageGraph([createMessage({ messageId: null })]),
        'INVALID_SOURCE',
        400,
      );
      expectGraftError(
        () =>
          buildMessageGraph([
            createMessage({ messageId: 'duplicate-1' }),
            createMessage({ messageId: 'duplicate-1' }),
          ]),
        'INVALID_SOURCE',
        400,
      );
    });

    it('preserves deterministic child ordering from the input array', () => {
      const { buildMessageGraph } = loadGraphModule();
      const root = createMessage({ messageId: 'root' });
      const childB = createMessage({ messageId: 'child-b', parentMessageId: 'root' });
      const childA = createMessage({ messageId: 'child-a', parentMessageId: 'root' });

      const graph = buildMessageGraph([root, childB, childA]);

      expect(graph.messages).toEqual([root, childB, childA]);
      expect(graph.byId.get('root')).toBe(root);
      expect(graph.childrenByParent.get('root')).toEqual(['child-b', 'child-a']);
    });
  });

  describe('collectDescendantIds', () => {
    it('returns the root first, then descendants in deterministic parent-first order', () => {
      const { buildMessageGraph, collectDescendantIds } = loadGraphModule();
      const graph = buildMessageGraph([
        createMessage({ messageId: 'root' }),
        createMessage({ messageId: 'branch-a', parentMessageId: 'root' }),
        createMessage({ messageId: 'branch-b', parentMessageId: 'root' }),
        createMessage({ messageId: 'leaf-a1', parentMessageId: 'branch-a' }),
      ]);

      expect(collectDescendantIds(graph, 'root')).toEqual([
        'root',
        'branch-a',
        'leaf-a1',
        'branch-b',
      ]);
    });

    it('rejects unknown roots and cyclic subtrees', () => {
      const { buildMessageGraph, collectDescendantIds } = loadGraphModule();
      const cyclicGraph = buildMessageGraph([
        createMessage({ messageId: 'cycle-a', parentMessageId: 'cycle-b' }),
        createMessage({ messageId: 'cycle-b', parentMessageId: 'cycle-a' }),
      ]);

      expectGraftError(
        () => collectDescendantIds(cyclicGraph, 'missing-root'),
        'MESSAGE_NOT_FOUND',
        404,
      );
      expectGraftError(() => collectDescendantIds(cyclicGraph, 'cycle-a'), 'INVALID_SOURCE', 400);
    });
  });

  describe('collectAncestorIds', () => {
    it('walks from the parent to the root and tolerates missing roots', () => {
      const { buildMessageGraph, collectAncestorIds } = loadGraphModule();
      const graph = buildMessageGraph([
        createMessage({ messageId: 'root' }),
        createMessage({ messageId: 'branch', parentMessageId: 'root' }),
        createMessage({ messageId: 'leaf', parentMessageId: 'branch' }),
        createMessage({ messageId: 'orphan', parentMessageId: 'missing-root' }),
      ]);

      expect(collectAncestorIds(graph, 'leaf')).toEqual(['branch', 'root']);
      expect(collectAncestorIds(graph, 'orphan')).toEqual([]);
    });

    it('rejects unknown messages and parent cycles', () => {
      const { buildMessageGraph, collectAncestorIds } = loadGraphModule();
      const cyclicGraph = buildMessageGraph([
        createMessage({ messageId: 'cycle-a', parentMessageId: 'cycle-b' }),
        createMessage({ messageId: 'cycle-b', parentMessageId: 'cycle-a' }),
      ]);

      expectGraftError(
        () => collectAncestorIds(cyclicGraph, 'missing-message'),
        'MESSAGE_NOT_FOUND',
        404,
      );
      expectGraftError(() => collectAncestorIds(cyclicGraph, 'cycle-a'), 'INVALID_SOURCE', 400);
    });

    it('rejects invalid graph objects as invalid sources', () => {
      const { collectAncestorIds } = loadGraphModule();

      expectGraftError(
        () => collectAncestorIds({ byId: {}, childrenByParent: new Map() }, 'message-1'),
        'INVALID_SOURCE',
        400,
      );
    });
  });

  describe('classifyLifecycle', () => {
    it('classifies stopped, aborted, errored, streaming, and complete assistant states', () => {
      const { classifyLifecycle } = loadGraphModule();

      expect(
        classifyLifecycle(createMessage({ messageId: 'streaming-message' }), {
          active: true,
          provider: 'assistants',
          responseMessageId: 'streaming-message',
        }),
      ).toBe('streaming');
      expect(
        classifyLifecycle(createMessage({ messageId: 'selected-message' }), {
          active: true,
          provider: 'assistants',
          responseMessageId: null,
        }),
      ).toBe('streaming');
      expect(classifyLifecycle(createMessage({ error: true }), { active: false })).toBe(
        'errored_partial',
      );
      expect(
        classifyLifecycle(
          createMessage({
            unfinished: true,
            metadata: { generationTermination: 'CANCELLED' },
          }),
          { active: false },
        ),
      ).toBe('aborted_partial');
      expect(
        classifyLifecycle(
          createMessage({
            unfinished: true,
            finish_reason: 'canceled',
          }),
          { active: false },
        ),
      ).toBe('aborted_partial');
      expect(classifyLifecycle(createMessage({ unfinished: true }), { active: false })).toBe(
        'stopped_partial',
      );
      expect(classifyLifecycle(createMessage(), { active: false })).toBe('complete');
    });

    it('keeps unfinished non-abort terminations as stopped_partial', () => {
      const { classifyLifecycle } = loadGraphModule();

      expect(
        classifyLifecycle(
          createMessage({
            unfinished: true,
            metadata: { generationTermination: 'stop' },
          }),
          { active: false },
        ),
      ).toBe('stopped_partial');
      expect(
        classifyLifecycle(
          createMessage({
            unfinished: true,
            metadata: { generationTermination: 'length' },
          }),
          { active: false },
        ),
      ).toBe('stopped_partial');
      expect(
        classifyLifecycle(
          createMessage({
            unfinished: true,
            finish_reason: 'length',
          }),
          { active: false },
        ),
      ).toBe('stopped_partial');
    });
  });

  describe('validateSelection', () => {
    it('accepts complete and partial assistant combinations in both directions', () => {
      const { buildMessageGraph, validateSelection } = loadGraphModule();
      const messages = [
        createMessage({ messageId: 'complete' }),
        createMessage({ messageId: 'partial', unfinished: true }),
        createMessage({ messageId: 'errored', error: true }),
      ];
      const graph = buildMessageGraph(messages);

      expect(validateSelection(graph, 'complete', 'partial')).toEqual({
        source: messages[0],
        destination: messages[1],
      });
      expect(validateSelection(graph, 'partial', 'complete')).toEqual({
        source: messages[1],
        destination: messages[0],
      });
      expect(validateSelection(graph, 'partial', 'errored')).toEqual({
        source: messages[1],
        destination: messages[2],
      });
    });

    it('rejects overlapping branches and user-authored endpoints', () => {
      const { buildMessageGraph, validateSelection } = loadGraphModule();
      const graph = buildMessageGraph([
        createMessage({ messageId: 'root' }),
        createMessage({ messageId: 'child', parentMessageId: 'root' }),
        createMessage({ messageId: 'user-source', isCreatedByUser: true }),
        createMessage({ messageId: 'user-destination', isCreatedByUser: true }),
      ]);

      expectGraftError(() => validateSelection(graph, 'root', 'child'), 'OVERLAPPING_BRANCHES', 400);
      expectGraftError(() => validateSelection(graph, 'user-source', 'child'), 'INVALID_SOURCE', 400);
      expectGraftError(
        () => validateSelection(graph, 'child', 'user-destination'),
        'INVALID_DESTINATION',
        400,
      );
    });

    it('rejects selecting the same assistant message twice', () => {
      const { buildMessageGraph, validateSelection } = loadGraphModule();
      const graph = buildMessageGraph([createMessage({ messageId: 'same-message' })]);

      expectGraftError(
        () => validateSelection(graph, 'same-message', 'same-message'),
        'INVALID_DESTINATION',
        400,
      );
    });
  });
});
