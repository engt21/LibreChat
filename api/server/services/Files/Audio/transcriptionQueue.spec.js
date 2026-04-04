jest.mock('@librechat/api', () => ({
  sanitizeMessageForTransmit: jest.fn((message) => message),
}));

jest.mock('~/db/models', () => ({
  File: {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
  },
}));

jest.mock('~/models', () => ({
  getConvo: jest.fn(),
  getMessages: jest.fn(),
  saveConvo: jest.fn(),
  saveMessage: jest.fn(),
  updateMessage: jest.fn(),
  updateFile: jest.fn(),
}));

jest.mock('~/server/services/Config', () => ({
  getAppConfig: jest.fn(),
}));

jest.mock('~/server/services/Files/strategies', () => ({
  getStrategyFunctions: jest.fn(),
}));

jest.mock('./STTService', () => ({
  STTService: {
    getInstance: jest.fn(),
  },
}));

jest.mock('./transcribeMediaFile', () => ({
  resolveMimeType: jest.fn(({ mimetype, filename }) => mimetype || filename || ''),
  transcribeMediaFile: jest.fn(),
}));

const { File } = require('~/db/models');
const { Constants } = require('librechat-data-provider');
const { getConvo, getMessages, saveConvo, saveMessage, updateFile } = require('~/models');
const { getAppConfig } = require('~/server/services/Config');
const {
  createAudioTranscriptionRequest,
  isTranscribableMediaFile,
  startAudioTranscriptionRunner,
  stopAudioTranscriptionRunner,
} = require('./transcriptionQueue');

describe('transcriptionQueue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    File.findOneAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });
    saveMessage.mockImplementation(async (_req, payload) => ({
      ...payload,
      createdAt: new Date('2026-03-24T00:00:00.000Z').toISOString(),
    }));
    saveConvo.mockResolvedValue({
      conversationId: 'conversation-1',
      title: 'Transcript: meeting',
      files: ['file-1'],
    });
    getMessages.mockResolvedValue([]);
    getConvo.mockResolvedValue(null);
    updateFile.mockResolvedValue({});
  });

  it('detects transcribable audio and video uploads', () => {
    expect(isTranscribableMediaFile({ filename: 'meeting.wav', type: 'audio/wav' })).toBe(true);
    expect(isTranscribableMediaFile({ filename: 'recording.mp4', type: 'video/mp4' })).toBe(true);
    expect(isTranscribableMediaFile({ filename: 'notes.pdf', type: 'application/pdf' })).toBe(
      false,
    );
  });

  it('queues a new transcription conversation and placeholder response', async () => {
    File.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        file_id: 'file-1',
        user: 'user-1',
        filename: 'meeting.mp4',
        filepath: '/uploads/meeting.mp4',
        bytes: 1024,
        type: 'video/mp4',
        source: 'local',
        embedded: false,
        metadata: {},
      }),
    });

    const req = {
      user: { id: 'user-1' },
      body: {
        file_id: 'file-1',
        conversationId: Constants.NEW_CONVO,
        endpoint: 'openAI',
        endpointType: 'openAI',
        model: 'gpt-4o-mini',
        transcriptionModel: 'gpt-4o-transcribe',
        prompt: 'Use speaker names',
      },
    };

    const result = await createAudioTranscriptionRequest(req);

    expect(saveMessage).toHaveBeenCalledTimes(2);
    expect(saveMessage).toHaveBeenNthCalledWith(
      1,
      req,
      expect.objectContaining({
        conversationId: expect.any(String),
        sender: 'User',
        text: 'Please transcribe the attached file "meeting.mp4".',
        isCreatedByUser: true,
        files: [
          expect.objectContaining({
            file_id: 'file-1',
            filename: 'meeting.mp4',
          }),
        ],
      }),
      expect.any(Object),
    );
    expect(saveMessage).toHaveBeenNthCalledWith(
      2,
      req,
      expect.objectContaining({
        conversationId: expect.any(String),
        sender: 'Transcription',
        text: expect.stringContaining('Transcribing "meeting.mp4"'),
        unfinished: false,
        metadata: expect.objectContaining({
          transcriptionStatus: 'processing',
        }),
      }),
      expect.any(Object),
    );
    expect(updateFile).toHaveBeenCalledWith(
      expect.objectContaining({
        file_id: 'file-1',
        metadata: expect.objectContaining({
          transcription: expect.objectContaining({
            status: 'queued',
            transcriptionModel: 'gpt-4o-transcribe',
            prompt: 'Use speaker names',
            conversationId: expect.any(String),
            requestMessageId: expect.any(String),
            responseMessageId: expect.any(String),
          }),
        }),
      }),
    );
    expect(result).toMatchObject({
      conversation: {
        conversationId: 'conversation-1',
      },
      messages: expect.arrayContaining([
        expect.objectContaining({ sender: 'User' }),
        expect.objectContaining({ sender: 'Transcription' }),
      ]),
      responseMessageId: expect.any(String),
    });
  });

  it('creates a dedicated non-agent transcript conversation for agent uploads', async () => {
    File.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        file_id: 'file-1',
        user: 'user-1',
        filename: 'meeting.mp3',
        filepath: '/uploads/meeting.mp3',
        bytes: 1024,
        type: 'audio/mpeg',
        source: 'local',
        embedded: false,
        metadata: {},
      }),
    });

    const req = {
      user: { id: 'user-1' },
      body: {
        file_id: 'file-1',
        conversationId: 'existing-convo-id',
        endpoint: 'agents',
        endpointType: 'openAI',
        model: 'gpt-5.1',
        agent_id: 'agent-1',
        iconURL: 'https://example.com/avatar.png',
        spec: 'agent-spec',
      },
    };

    await createAudioTranscriptionRequest(req);

    expect(saveMessage).toHaveBeenNthCalledWith(
      1,
      req,
      expect.objectContaining({
        conversationId: expect.any(String),
        parentMessageId: Constants.NO_PARENT,
        endpoint: 'openAI',
        model: 'gpt-5.1',
      }),
      expect.any(Object),
    );
    expect(saveConvo).toHaveBeenCalledWith(
      req,
      expect.objectContaining({
        conversationId: expect.any(String),
        endpoint: 'openAI',
        endpointType: 'openAI',
        model: 'gpt-5.1',
        files: ['file-1'],
      }),
      expect.any(Object),
    );
    expect(saveConvo.mock.calls[0][1]).not.toHaveProperty('agent_id');
    expect(saveConvo.mock.calls[0][1]).not.toHaveProperty('assistant_id');
    expect(saveConvo.mock.calls[0][1]).not.toHaveProperty('iconURL');
    expect(saveConvo.mock.calls[0][1]).not.toHaveProperty('spec');
  });

  it('returns the existing transcription conversation when already queued', async () => {
    File.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        file_id: 'file-1',
        user: 'user-1',
        filename: 'meeting.mp4',
        filepath: '/uploads/meeting.mp4',
        bytes: 1024,
        type: 'video/mp4',
        source: 'local',
        embedded: false,
        metadata: {
          transcription: {
            conversationId: 'conversation-1',
            requestMessageId: 'request-1',
            responseMessageId: 'response-1',
          },
        },
      }),
    });
    getConvo.mockResolvedValue({ conversationId: 'conversation-1' });
    getMessages.mockResolvedValue([
      { messageId: 'request-1', sender: 'User', text: 'Please transcribe the attached file.' },
      { messageId: 'response-1', sender: 'Transcription', text: 'Transcribing...' },
    ]);

    const result = await createAudioTranscriptionRequest({
      user: { id: 'user-1' },
      body: { file_id: 'file-1' },
    });

    expect(saveMessage).not.toHaveBeenCalled();
    expect(updateFile).not.toHaveBeenCalled();
    expect(result).toEqual({
      conversation: { conversationId: 'conversation-1' },
      messages: [
        { messageId: 'request-1', sender: 'User', text: 'Please transcribe the attached file.' },
        { messageId: 'response-1', sender: 'Transcription', text: 'Transcribing...' },
      ],
      responseMessageId: 'response-1',
    });
  });
});

describe('transcriptionQueue runner drain semantics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    getAppConfig.mockResolvedValue({
      paths: { uploads: '/tmp' },
      fileStrategy: 'local',
    });
  });

  afterEach(async () => {
    jest.useRealTimers();
    // Ensure runner is stopped after each test.
    await stopAudioTranscriptionRunner({ drain: false });
  });

  it('drain-aware stop waits for an in-progress tick before returning', async () => {
    // Simulate a tick that is actively claiming a job. The mock will return
    // one file, causing the tick to start a processClaimedTranscription job.
    // We control when that job resolves to prove stop awaits it.
    let resolveJob;
    const jobDone = new Promise((resolve) => {
      resolveJob = resolve;
    });

    const mockFile = {
      file_id: 'drain-test-1',
      user: 'user-1',
      filename: 'drain.mp3',
      filepath: '/uploads/drain.mp3',
      type: 'audio/mpeg',
      source: 'local',
      metadata: {
        transcription: {
          conversationId: 'conv-1',
          requestMessageId: 'req-1',
          responseMessageId: 'resp-1',
          language: null,
        },
      },
    };

    // First call returns a file, subsequent calls return null (no more work).
    let claimCount = 0;
    File.findOneAndUpdate.mockImplementation(() => ({
      lean: jest.fn().mockImplementation(() => {
        claimCount++;
        return claimCount === 1 ? Promise.resolve(mockFile) : Promise.resolve(null);
      }),
    }));

    // Mock the entire transcription pipeline to be controlled by our promise.
    const { getStrategyFunctions } = require('~/server/services/Files/strategies');
    const { Readable } = require('node:stream');
    getStrategyFunctions.mockReturnValue({
      getDownloadStream: jest.fn().mockResolvedValue(Readable.from(Buffer.from('audio-data'))),
    });

    const { transcribeMediaFile } = require('./transcribeMediaFile');
    transcribeMediaFile.mockImplementation(() => jobDone);

    // updateMessage mock for the completion path.
    const { updateMessage } = require('~/models');
    updateMessage.mockResolvedValue({});
    updateFile.mockResolvedValue({});
    getConvo.mockResolvedValue({ conversationId: 'conv-1' });
    saveConvo.mockResolvedValue({});

    // Start the runner and let the initial kick fire.
    startAudioTranscriptionRunner();
    jest.advanceTimersByTime(0);
    // Let setImmediate fire by switching to real timers momentarily.
    jest.useRealTimers();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // At this point a tick should have started and claimed a job.
    // The job is blocked on our `jobDone` promise.

    // Now stop with drain. This should NOT resolve immediately because
    // the job is still in progress.
    let drainResolved = false;
    const drainPromise = stopAudioTranscriptionRunner({ drain: true }).then(() => {
      drainResolved = true;
    });

    // Give the event loop a chance to settle.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(drainResolved).toBe(false);

    // Now resolve the transcription job.
    resolveJob({
      text: 'Hello world',
      provider: 'openai',
      model: 'whisper-1',
      chunkCount: 1,
      converted: false,
    });

    // Drain should now resolve.
    await drainPromise;
    expect(drainResolved).toBe(true);
  });

  it('no new work is claimed after drain-aware stop returns', async () => {
    // Start with nothing queued.
    File.findOneAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });

    startAudioTranscriptionRunner();

    // Stop immediately with drain.
    jest.useRealTimers();
    await stopAudioTranscriptionRunner({ drain: true });

    // Reset claim counter to detect any post-stop claims.
    File.findOneAndUpdate.mockClear();

    // Advance time and flush microtasks — no new tick should fire.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(File.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('stop without drain does not await active jobs', async () => {
    let resolveJob;
    const jobDone = new Promise((resolve) => {
      resolveJob = resolve;
    });

    const mockFile = {
      file_id: 'no-drain-1',
      user: 'user-1',
      filename: 'quick.mp3',
      filepath: '/uploads/quick.mp3',
      type: 'audio/mpeg',
      source: 'local',
      metadata: {
        transcription: {
          conversationId: 'conv-2',
          requestMessageId: 'req-2',
          responseMessageId: 'resp-2',
          language: null,
        },
      },
    };

    let claimCount = 0;
    File.findOneAndUpdate.mockImplementation(() => ({
      lean: jest.fn().mockImplementation(() => {
        claimCount++;
        return claimCount === 1 ? Promise.resolve(mockFile) : Promise.resolve(null);
      }),
    }));

    const { getStrategyFunctions } = require('~/server/services/Files/strategies');
    const { Readable } = require('node:stream');
    getStrategyFunctions.mockReturnValue({
      getDownloadStream: jest.fn().mockResolvedValue(Readable.from(Buffer.from('audio-data'))),
    });

    const { transcribeMediaFile } = require('./transcribeMediaFile');
    transcribeMediaFile.mockImplementation(() => jobDone);

    startAudioTranscriptionRunner();
    jest.advanceTimersByTime(0);
    jest.useRealTimers();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Stop without drain — should return immediately even though the job is pending.
    await stopAudioTranscriptionRunner({ drain: false });

    // Resolve the job to clean up.
    resolveJob({
      text: 'done',
      provider: 'openai',
      model: 'whisper-1',
      chunkCount: 1,
      converted: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
});
