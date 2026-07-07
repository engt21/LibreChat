const { Constants } = require('librechat-data-provider');

const loadRevisionModule = () => {
  jest.resetModules();
  return require('./revision');
};

const createMessage = (overrides = {}) => ({
  messageId: 'message-1',
  parentMessageId: Constants.NO_PARENT,
  unfinished: false,
  error: false,
  finish_reason: null,
  updatedAt: '2026-07-06T12:00:00.000Z',
  text: 'original text',
  ...overrides,
});

describe('MessageGrafts structural revision hashing', () => {
  it('produces the same revision regardless of input ordering', () => {
    const { computeTreeRevision } = loadRevisionModule();
    const messages = [
      createMessage({ messageId: 'message-b', parentMessageId: 'message-a' }),
      createMessage({ messageId: 'message-a' }),
    ];
    const reordered = [messages[1], messages[0]];

    expect(
      computeTreeRevision(messages, {
        active: false,
        provider: null,
        responseMessageId: null,
      }),
    ).toBe(
      computeTreeRevision(reordered, {
        active: false,
        provider: null,
        responseMessageId: null,
      }),
    );
  });

  it('ignores content-only changes when updatedAt is unchanged', () => {
    const { computeTreeRevision } = loadRevisionModule();
    const activeState = {
      active: false,
      provider: null,
      responseMessageId: null,
    };

    expect(
      computeTreeRevision([createMessage({ text: 'first draft' })], activeState),
    ).toBe(computeTreeRevision([createMessage({ text: 'rewritten draft' })], activeState));
  });

  it('changes when the parent linkage changes', () => {
    const { computeTreeRevision } = loadRevisionModule();
    const activeState = {
      active: false,
      provider: null,
      responseMessageId: null,
    };

    expect(
      computeTreeRevision(
        [
          createMessage({ messageId: 'message-a' }),
          createMessage({ messageId: 'message-b', parentMessageId: 'message-a' }),
        ],
        activeState,
      ),
    ).not.toBe(
      computeTreeRevision(
        [
          createMessage({ messageId: 'message-a' }),
          createMessage({ messageId: 'message-b', parentMessageId: Constants.NO_PARENT }),
        ],
        activeState,
      ),
    );
  });

  it('normalizes null and NO_PARENT parent ids to the same revision', () => {
    const { computeTreeRevision } = loadRevisionModule();
    const activeState = {
      active: false,
      provider: 'assistants',
      responseMessageId: null,
    };

    expect(
      computeTreeRevision([createMessage({ parentMessageId: null })], activeState),
    ).toBe(
      computeTreeRevision([createMessage({ parentMessageId: Constants.NO_PARENT })], activeState),
    );
  });

  it('changes when lifecycle fields change', () => {
    const { computeTreeRevision } = loadRevisionModule();
    const activeState = {
      active: false,
      provider: null,
      responseMessageId: null,
    };

    expect(
      computeTreeRevision([createMessage({ unfinished: true })], activeState),
    ).not.toBe(computeTreeRevision([createMessage({ error: true })], activeState));
  });

  it('changes when only the active boolean changes', () => {
    const { computeTreeRevision } = loadRevisionModule();
    const messages = [createMessage({ messageId: 'message-a' })];

    expect(
      computeTreeRevision(messages, {
        active: false,
        provider: null,
        responseMessageId: 'message-a',
      }),
    ).not.toBe(
      computeTreeRevision(messages, {
        active: true,
        provider: 'assistants',
        responseMessageId: 'message-a',
      }),
    );
  });

  it('changes when only the active responseMessageId changes', () => {
    const { computeTreeRevision } = loadRevisionModule();
    const messages = [createMessage({ messageId: 'message-a' })];

    expect(
      computeTreeRevision(messages, {
        active: true,
        provider: 'assistants',
        responseMessageId: 'message-a',
      }),
    ).not.toBe(
      computeTreeRevision(messages, {
        active: true,
        provider: 'assistants',
        responseMessageId: 'message-b',
      }),
    );
  });

  it('ignores provider-only changes in the active state', () => {
    const { computeTreeRevision } = loadRevisionModule();
    const messages = [createMessage({ messageId: 'message-a' })];

    expect(
      computeTreeRevision(messages, {
        active: true,
        provider: 'assistants',
        responseMessageId: 'message-a',
      }),
    ).toBe(
      computeTreeRevision(messages, {
        active: true,
        provider: 'resumable',
        responseMessageId: 'message-a',
      }),
    );
  });
});
