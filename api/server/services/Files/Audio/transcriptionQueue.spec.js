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

  it('falls back to temp_file_id lookup when file_id does not match (VAL-FILES-006 /c/new handoff)', async () => {
    // Simulate the race condition where the client still holds the temp
    // file_id (the pre-upload UUID) when clicking "Transcribe" immediately
    // after upload, before the server-assigned file_id propagates back.
    const serverFileId = 'server-assigned-uuid';
    const tempFileId = 'client-generated-temp-uuid';

    let findOneCallCount = 0;
    File.findOne.mockImplementation((query) => {
      findOneCallCount++;
      if (query.file_id === tempFileId) {
        // First lookup by file_id: not found
        return { lean: jest.fn().mockResolvedValue(null) };
      }
      if (query.temp_file_id === tempFileId) {
        // Fallback lookup by temp_file_id: found
        return {
          lean: jest.fn().mockResolvedValue({
            file_id: serverFileId,
            temp_file_id: tempFileId,
            user: 'user-1',
            filename: 'meeting.mp3',
            filepath: '/uploads/meeting.mp3',
            bytes: 2048,
            type: 'audio/mpeg',
            source: 'local',
            embedded: false,
            metadata: {},
          }),
        };
      }
      return { lean: jest.fn().mockResolvedValue(null) };
    });

    const req = {
      user: { id: 'user-1' },
      body: {
        file_id: tempFileId,
        endpoint: 'openAI',
        model: 'gpt-4o-mini',
        transcriptionModel: 'gpt-4o-transcribe',
      },
    };

    const result = await createAudioTranscriptionRequest(req);

    // Both lookups should have been attempted
    expect(findOneCallCount).toBe(2);

    // The file metadata should be updated using the server-assigned file_id
    expect(updateFile).toHaveBeenCalledWith(
      expect.objectContaining({
        file_id: serverFileId,
        metadata: expect.objectContaining({
          transcription: expect.objectContaining({
            status: 'queued',
            conversationId: expect.any(String),
          }),
        }),
      }),
    );

    expect(result).toMatchObject({
      conversation: expect.any(Object),
      messages: expect.arrayContaining([
        expect.objectContaining({ sender: 'User' }),
        expect.objectContaining({ sender: 'Transcription' }),
      ]),
      responseMessageId: expect.any(String),
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

    // The job was claimed, proving the runner started. Stop returned without draining.
    expect(claimCount).toBeGreaterThanOrEqual(1);

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

describe('transcriptionQueue — per-conversation settings reuse (VAL-FILES-004)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    File.findOneAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });
    saveMessage.mockImplementation(async (_req, payload) => ({
      ...payload,
      createdAt: new Date().toISOString(),
    }));
    getMessages.mockResolvedValue([]);
    getConvo.mockResolvedValue(null);
    updateFile.mockResolvedValue({});
    saveConvo.mockResolvedValue({
      conversationId: 'conv-settings-1',
      title: 'Transcript: settings-test',
      files: ['file-settings'],
    });
  });

  it('persists transcriptionModel, transcriptionPrompt, and speakerReferences on the conversation', async () => {
    File.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        file_id: 'file-settings',
        user: 'user-1',
        filename: 'settings-test.mp3',
        filepath: '/uploads/settings-test.mp3',
        bytes: 512,
        type: 'audio/mpeg',
        source: 'local',
        embedded: false,
        metadata: {},
      }),
    });

    const req = {
      user: { id: 'user-1' },
      body: {
        file_id: 'file-settings',
        endpoint: 'openAI',
        model: 'gpt-4o-mini',
        transcriptionModel: 'gpt-4o-transcribe-diarize',
        prompt: 'Speaker names: Alice, Bob',
        speakerReferences: [
          { name: 'Alice', file_id: 'ref-alice', filename: 'alice.wav' },
          { name: 'Bob', file_id: 'ref-bob', filename: 'bob.wav' },
        ],
      },
    };

    await createAudioTranscriptionRequest(req);

    expect(saveConvo).toHaveBeenCalledWith(
      req,
      expect.objectContaining({
        transcriptionModel: 'gpt-4o-transcribe-diarize',
        transcriptionPrompt: 'Speaker names: Alice, Bob',
        transcriptionSpeakerReferences: expect.arrayContaining([
          expect.objectContaining({ name: 'Alice', file_id: 'ref-alice' }),
          expect.objectContaining({ name: 'Bob', file_id: 'ref-bob' }),
        ]),
      }),
      expect.any(Object),
    );
  });

  it('also persists transcription settings on the file metadata for the background runner', async () => {
    File.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        file_id: 'file-settings-2',
        user: 'user-1',
        filename: 'settings2.mp3',
        filepath: '/uploads/settings2.mp3',
        bytes: 256,
        type: 'audio/mpeg',
        source: 'local',
        embedded: false,
        metadata: {},
      }),
    });

    const req = {
      user: { id: 'user-1' },
      body: {
        file_id: 'file-settings-2',
        endpoint: 'openAI',
        model: 'gpt-4o',
        transcriptionModel: 'gpt-4o-transcribe',
        prompt: 'Technical terms: FFT, STFT',
        speakerReferences: [],
      },
    };

    await createAudioTranscriptionRequest(req);

    expect(updateFile).toHaveBeenCalledWith(
      expect.objectContaining({
        file_id: 'file-settings-2',
        metadata: expect.objectContaining({
          transcription: expect.objectContaining({
            transcriptionModel: 'gpt-4o-transcribe',
            prompt: 'Technical terms: FFT, STFT',
            speakerReferences: [],
          }),
        }),
      }),
    );
  });
});

describe('transcriptionQueue — diarization speaker reference persistence (VAL-FILES-006)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    File.findOneAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });
    saveMessage.mockImplementation(async (_req, payload) => ({
      ...payload,
      createdAt: new Date().toISOString(),
    }));
    getMessages.mockResolvedValue([]);
    getConvo.mockResolvedValue(null);
    updateFile.mockResolvedValue({});
    saveConvo.mockResolvedValue({
      conversationId: 'conv-diarize-1',
      title: 'Transcript: diarize-test',
      files: ['file-diarize'],
    });
  });

  it('normalizes speaker references with all fields for conversation and file metadata', async () => {
    File.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        file_id: 'file-diarize',
        user: 'user-1',
        filename: 'meeting.mp4',
        filepath: '/uploads/meeting.mp4',
        bytes: 4096,
        type: 'video/mp4',
        source: 'local',
        embedded: false,
        metadata: {},
      }),
    });

    const req = {
      user: { id: 'user-1' },
      body: {
        file_id: 'file-diarize',
        endpoint: 'openAI',
        model: 'gpt-4o-mini',
        transcriptionModel: 'gpt-4o-transcribe-diarize',
        speakerReferences: [
          {
            id: 'ref-1',
            name: 'Alice',
            file_id: 'ref-alice',
            filename: 'alice.wav',
            filepath: '/uploads/ref/alice.wav',
            type: 'audio/wav',
            bytes: 512,
            durationSeconds: 4.2,
            embedded: false,
            source: 'local',
          },
          {
            id: 'ref-2',
            name: 'Bob',
            file_id: 'ref-bob',
            filename: 'bob.mp3',
            filepath: '/uploads/ref/bob.mp3',
            type: 'audio/mpeg',
            bytes: 768,
            durationSeconds: 6.0,
            embedded: true,
            source: 'local',
          },
        ],
      },
    };

    await createAudioTranscriptionRequest(req);

    // Conversation must receive the full speaker reference objects
    expect(saveConvo).toHaveBeenCalledWith(
      req,
      expect.objectContaining({
        transcriptionModel: 'gpt-4o-transcribe-diarize',
        transcriptionSpeakerReferences: [
          expect.objectContaining({
            id: 'ref-1',
            name: 'Alice',
            file_id: 'ref-alice',
            filename: 'alice.wav',
            filepath: '/uploads/ref/alice.wav',
            type: 'audio/wav',
            bytes: 512,
            durationSeconds: 4.2,
            embedded: false,
            source: 'local',
          }),
          expect.objectContaining({
            id: 'ref-2',
            name: 'Bob',
            file_id: 'ref-bob',
            filename: 'bob.mp3',
            filepath: '/uploads/ref/bob.mp3',
            type: 'audio/mpeg',
            bytes: 768,
            durationSeconds: 6.0,
            embedded: true,
            source: 'local',
          }),
        ],
      }),
      expect.any(Object),
    );

    // File metadata must also contain the speaker references for the runner
    expect(updateFile).toHaveBeenCalledWith(
      expect.objectContaining({
        file_id: 'file-diarize',
        metadata: expect.objectContaining({
          transcription: expect.objectContaining({
            transcriptionModel: 'gpt-4o-transcribe-diarize',
            speakerReferences: [
              expect.objectContaining({
                name: 'Alice',
                file_id: 'ref-alice',
                type: 'audio/wav',
              }),
              expect.objectContaining({
                name: 'Bob',
                file_id: 'ref-bob',
                type: 'audio/mpeg',
              }),
            ],
          }),
        }),
      }),
    );
  });

  it('strips invalid speaker references and caps at 4 entries', async () => {
    File.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        file_id: 'file-diarize-2',
        user: 'user-1',
        filename: 'meeting2.mp3',
        filepath: '/uploads/meeting2.mp3',
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
        file_id: 'file-diarize-2',
        endpoint: 'openAI',
        model: 'gpt-4o-mini',
        transcriptionModel: 'gpt-4o-transcribe-diarize',
        speakerReferences: [
          { name: 'A', file_id: 'f1' },
          { name: '', file_id: 'f2' }, // empty name -> filtered
          { name: 'B', file_id: '' }, // empty file_id -> filtered
          { name: 'C', file_id: 'f3' },
          { name: 'D', file_id: 'f4' },
          { name: 'E', file_id: 'f5' },
          { name: 'F', file_id: 'f6' }, // past the 4-cap
        ],
      },
    };

    await createAudioTranscriptionRequest(req);

    const savedRefs = saveConvo.mock.calls[0][1].transcriptionSpeakerReferences;
    expect(savedRefs).toHaveLength(4);
    expect(savedRefs[0]).toMatchObject({ name: 'A', file_id: 'f1' });
    expect(savedRefs[1]).toMatchObject({ name: 'C', file_id: 'f3' });
    expect(savedRefs[2]).toMatchObject({ name: 'D', file_id: 'f4' });
    expect(savedRefs[3]).toMatchObject({ name: 'E', file_id: 'f5' });
  });
});

describe('transcriptionQueue — delete-during-processing resilience (VAL-FILES-009)', () => {
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
    await stopAudioTranscriptionRunner({ drain: false });
  });

  it('completes without crashing when the response message is deleted mid-transcription', async () => {
    const mockFile = {
      file_id: 'delete-test-1',
      user: 'user-1',
      filename: 'deleted.mp3',
      filepath: '/uploads/deleted.mp3',
      type: 'audio/mpeg',
      source: 'local',
      usage: 0,
      metadata: {
        transcription: {
          conversationId: 'conv-deleted',
          requestMessageId: 'req-deleted',
          responseMessageId: 'resp-deleted',
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
    transcribeMediaFile.mockResolvedValue({
      text: 'Transcribed text',
      provider: 'openai',
      model: 'whisper-1',
      chunkCount: 1,
      converted: false,
    });

    // Simulate message deletion: updateMessage throws because message no longer exists
    const { updateMessage } = require('~/models');
    updateMessage.mockRejectedValue(new Error('Message not found'));
    updateFile.mockResolvedValue({});
    getConvo.mockResolvedValue({ conversationId: 'conv-deleted' });
    saveConvo.mockResolvedValue({});

    // Start runner and let it process the job
    startAudioTranscriptionRunner();
    jest.advanceTimersByTime(0);
    jest.useRealTimers();

    // Wait enough for processing to complete
    await new Promise((resolve) => setTimeout(resolve, 200));
    await stopAudioTranscriptionRunner({ drain: true });

    // The file metadata should still be updated to 'completed' despite message update failure
    expect(updateFile).toHaveBeenCalledWith(
      expect.objectContaining({
        file_id: 'delete-test-1',
        metadata: expect.objectContaining({
          transcription: expect.objectContaining({
            status: 'completed',
          }),
        }),
      }),
    );
  });

  it('subsequent transcription jobs process normally after a deleted-message job', async () => {
    const deletedFile = {
      file_id: 'deleted-mid-1',
      user: 'user-1',
      filename: 'first.mp3',
      filepath: '/uploads/first.mp3',
      type: 'audio/mpeg',
      source: 'local',
      usage: 0,
      metadata: {
        transcription: {
          conversationId: 'conv-d1',
          requestMessageId: 'req-d1',
          responseMessageId: 'resp-d1',
          language: null,
        },
      },
    };

    const normalFile = {
      file_id: 'normal-after-1',
      user: 'user-1',
      filename: 'second.mp3',
      filepath: '/uploads/second.mp3',
      type: 'audio/mpeg',
      source: 'local',
      usage: 0,
      metadata: {
        transcription: {
          conversationId: 'conv-n1',
          requestMessageId: 'req-n1',
          responseMessageId: 'resp-n1',
          language: null,
        },
      },
    };

    let claimCount = 0;
    File.findOneAndUpdate.mockImplementation(() => ({
      lean: jest.fn().mockImplementation(() => {
        claimCount++;
        if (claimCount === 1) {
          return Promise.resolve(deletedFile);
        }
        if (claimCount === 2) {
          return Promise.resolve(normalFile);
        }
        return Promise.resolve(null);
      }),
    }));

    const { getStrategyFunctions } = require('~/server/services/Files/strategies');
    const { Readable } = require('node:stream');
    getStrategyFunctions.mockReturnValue({
      getDownloadStream: jest.fn().mockResolvedValue(Readable.from(Buffer.from('audio-data'))),
    });

    const { transcribeMediaFile } = require('./transcribeMediaFile');
    transcribeMediaFile.mockResolvedValue({
      text: 'Transcribed text',
      provider: 'openai',
      model: 'whisper-1',
      chunkCount: 1,
      converted: false,
    });

    const { updateMessage } = require('~/models');
    // First call rejects (deleted message), second call succeeds
    updateMessage.mockRejectedValueOnce(new Error('Message not found')).mockResolvedValueOnce({});
    updateFile.mockResolvedValue({});
    getConvo.mockResolvedValue({ conversationId: 'conv-n1' });
    saveConvo.mockResolvedValue({});

    startAudioTranscriptionRunner();
    jest.advanceTimersByTime(0);
    jest.useRealTimers();

    // Wait enough for both jobs to process
    await new Promise((resolve) => setTimeout(resolve, 400));
    await stopAudioTranscriptionRunner({ drain: true });

    // Both files should have their metadata updated
    const updateFileCalls = updateFile.mock.calls;
    const fileIds = updateFileCalls
      .filter((call) => call[0]?.metadata?.transcription?.status === 'completed')
      .map((call) => call[0].file_id);

    expect(fileIds).toContain('deleted-mid-1');
    expect(fileIds).toContain('normal-after-1');
  });
});

describe('transcriptionQueue — completion and failure message updates (VAL-FILES-005)', () => {
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
    await stopAudioTranscriptionRunner({ drain: false });
  });

  it('updates response message with completed text and metadata on success', async () => {
    const mockFile = {
      file_id: 'complete-test-1',
      user: 'user-1',
      filename: 'complete.mp3',
      filepath: '/uploads/complete.mp3',
      type: 'audio/mpeg',
      source: 'local',
      usage: 0,
      metadata: {
        transcription: {
          conversationId: 'conv-complete',
          requestMessageId: 'req-complete',
          responseMessageId: 'resp-complete',
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
    transcribeMediaFile.mockResolvedValue({
      text: 'Hello world from the transcription',
      provider: 'openai',
      model: 'whisper-1',
      chunkCount: 1,
      converted: false,
    });

    const { updateMessage } = require('~/models');
    updateMessage.mockResolvedValue({});
    updateFile.mockResolvedValue({});
    getConvo.mockResolvedValue({ conversationId: 'conv-complete' });
    saveConvo.mockResolvedValue({});

    startAudioTranscriptionRunner();
    jest.advanceTimersByTime(0);
    jest.useRealTimers();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await stopAudioTranscriptionRunner({ drain: true });

    expect(updateMessage).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        messageId: 'resp-complete',
        sender: 'Transcription',
        text: expect.stringContaining('Hello world from the transcription'),
        unfinished: false,
        error: false,
        metadata: expect.objectContaining({
          transcriptionStatus: 'completed',
          provider: 'openai',
          model: 'whisper-1',
        }),
      }),
      expect.any(Object),
    );

    // File metadata should also be completed
    expect(updateFile).toHaveBeenCalledWith(
      expect.objectContaining({
        file_id: 'complete-test-1',
        text: 'Hello world from the transcription',
        metadata: expect.objectContaining({
          transcription: expect.objectContaining({
            status: 'completed',
            provider: 'openai',
            model: 'whisper-1',
          }),
        }),
      }),
    );
  });

  it('marks response message as failed with error text on transcription failure', async () => {
    const mockFile = {
      file_id: 'fail-test-1',
      user: 'user-1',
      filename: 'fail.mp3',
      filepath: '/uploads/fail.mp3',
      type: 'audio/mpeg',
      source: 'local',
      usage: 0,
      metadata: {
        transcription: {
          conversationId: 'conv-fail',
          requestMessageId: 'req-fail',
          responseMessageId: 'resp-fail',
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
    transcribeMediaFile.mockRejectedValue(new Error('Audio codec not supported'));

    const { updateMessage } = require('~/models');
    updateMessage.mockResolvedValue({});
    updateFile.mockResolvedValue({});
    getConvo.mockResolvedValue({ conversationId: 'conv-fail' });
    saveConvo.mockResolvedValue({});

    startAudioTranscriptionRunner();
    jest.advanceTimersByTime(0);
    jest.useRealTimers();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await stopAudioTranscriptionRunner({ drain: true });

    expect(updateMessage).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        messageId: 'resp-fail',
        sender: 'Transcription',
        text: expect.stringContaining('Audio codec not supported'),
        unfinished: false,
        error: true,
        metadata: expect.objectContaining({
          transcriptionStatus: 'failed',
          error: 'Audio codec not supported',
        }),
      }),
      expect.any(Object),
    );

    // File metadata should also be marked as failed
    expect(updateFile).toHaveBeenCalledWith(
      expect.objectContaining({
        file_id: 'fail-test-1',
        metadata: expect.objectContaining({
          transcription: expect.objectContaining({
            status: 'failed',
            error: 'Audio codec not supported',
          }),
        }),
      }),
    );
  });

  it('renders speaker-labeled transcript lines for diarized transcription (VAL-FILES-006)', async () => {
    const mockFile = {
      file_id: 'diarize-complete-1',
      user: 'user-1',
      filename: 'interview.mp3',
      filepath: '/uploads/interview.mp3',
      type: 'audio/mpeg',
      source: 'local',
      usage: 0,
      metadata: {
        transcription: {
          conversationId: 'conv-diarize',
          requestMessageId: 'req-diarize',
          responseMessageId: 'resp-diarize',
          language: null,
          transcriptionModel: 'gpt-4o-transcribe-diarize',
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
    transcribeMediaFile.mockResolvedValue({
      text: '[Alice]: Hello, how are you?\n[Bob]: I am doing well, thanks!',
      provider: 'openai',
      model: 'gpt-4o-transcribe-diarize',
      chunkCount: 1,
      converted: false,
      isDiarize: true,
    });

    const { updateMessage } = require('~/models');
    updateMessage.mockResolvedValue({});
    updateFile.mockResolvedValue({});
    getConvo.mockResolvedValue({ conversationId: 'conv-diarize' });
    saveConvo.mockResolvedValue({});

    startAudioTranscriptionRunner();
    jest.advanceTimersByTime(0);
    jest.useRealTimers();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await stopAudioTranscriptionRunner({ drain: true });

    // The completed response must contain speaker-labeled lines
    expect(updateMessage).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        messageId: 'resp-diarize',
        sender: 'Transcription',
        text: expect.stringContaining('[Alice]: Hello, how are you?'),
        unfinished: false,
        error: false,
        model: 'gpt-4o-transcribe-diarize',
        metadata: expect.objectContaining({
          transcriptionStatus: 'completed',
          model: 'gpt-4o-transcribe-diarize',
        }),
      }),
      expect.any(Object),
    );

    // Verify both speaker labels are present in the completed text
    const completedMessageCall = updateMessage.mock.calls.find(
      (call) => call[1]?.messageId === 'resp-diarize',
    );
    expect(completedMessageCall).toBeDefined();
    expect(completedMessageCall[1].text).toContain('[Alice]:');
    expect(completedMessageCall[1].text).toContain('[Bob]:');
    expect(completedMessageCall[1].text).toContain('Transcript for "interview.mp3"');

    // File metadata should record the diarized transcript text
    expect(updateFile).toHaveBeenCalledWith(
      expect.objectContaining({
        file_id: 'diarize-complete-1',
        text: '[Alice]: Hello, how are you?\n[Bob]: I am doing well, thanks!',
        metadata: expect.objectContaining({
          transcription: expect.objectContaining({
            status: 'completed',
            model: 'gpt-4o-transcribe-diarize',
          }),
        }),
      }),
    );
  });
});

describe('transcriptionQueue — /c/new upload→transcribe file_id handoff (VAL-FILES-006)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    File.findOneAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });
    saveMessage.mockImplementation(async (_req, payload) => ({
      ...payload,
      createdAt: new Date().toISOString(),
    }));
    getMessages.mockResolvedValue([]);
    getConvo.mockResolvedValue(null);
    updateFile.mockResolvedValue({});
    saveConvo.mockResolvedValue({
      conversationId: 'conv-handoff-1',
      title: 'Transcript: handoff-test',
      files: ['server-uuid'],
    });
  });

  it('handles /c/new flow where server-assigned file_id is available at transcribe time', async () => {
    // In the normal /c/new flow, the client uploads the file first. The server
    // assigns file_id (via multer req.file_id) and stores temp_file_id from the
    // client's UUID. When the upload response returns, the React state updates
    // extendedFile.file_id to the server-assigned value. The transcription
    // request then sends the server-assigned file_id.
    const serverFileId = 'server-assigned-file-uuid';
    const tempFileId = 'client-temp-uuid';

    File.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        file_id: serverFileId,
        temp_file_id: tempFileId,
        user: 'user-1',
        filename: 'meeting.mp3',
        filepath: '/uploads/meeting.mp3',
        bytes: 4096,
        type: 'audio/mpeg',
        source: 'local',
        embedded: false,
        metadata: {},
      }),
    });

    const req = {
      user: { id: 'user-1' },
      body: {
        file_id: serverFileId, // Client sends server-assigned ID after upload completes
        endpoint: 'openAI',
        model: 'gpt-4o-mini',
        transcriptionModel: 'gpt-4o-transcribe-diarize',
        speakerReferences: [
          { name: 'Alice', file_id: 'ref-alice' },
          { name: 'Bob', file_id: 'ref-bob' },
        ],
      },
    };

    const result = await createAudioTranscriptionRequest(req);

    // File should be found on the first lookup (by server-assigned file_id)
    expect(File.findOne).toHaveBeenCalledTimes(1);
    expect(File.findOne).toHaveBeenCalledWith({
      file_id: serverFileId,
      user: 'user-1',
    });

    // The transcription metadata should use the server-assigned file_id
    expect(updateFile).toHaveBeenCalledWith(
      expect.objectContaining({
        file_id: serverFileId,
        metadata: expect.objectContaining({
          transcription: expect.objectContaining({
            status: 'queued',
            transcriptionModel: 'gpt-4o-transcribe-diarize',
            speakerReferences: expect.arrayContaining([
              expect.objectContaining({ name: 'Alice', file_id: 'ref-alice' }),
              expect.objectContaining({ name: 'Bob', file_id: 'ref-bob' }),
            ]),
          }),
        }),
      }),
    );

    expect(result).toMatchObject({
      conversation: expect.any(Object),
      messages: expect.arrayContaining([
        expect.objectContaining({ sender: 'User' }),
        expect.objectContaining({ sender: 'Transcription' }),
      ]),
      responseMessageId: expect.any(String),
    });
  });

  it('handles /c/new race where client sends temp_file_id before upload response arrives', async () => {
    // When the user clicks "Transcribe" immediately after the file starts
    // uploading, the React state may still hold the temp UUID (the pre-upload
    // file_id generated by v4()). The server must resolve this via temp_file_id
    // fallback and still queue the transcription successfully.
    const serverFileId = 'server-uuid-race';
    const tempFileId = 'client-temp-uuid-race';

    let findOneCallCount = 0;
    File.findOne.mockImplementation((query) => {
      findOneCallCount++;
      if (query.file_id === tempFileId) {
        return { lean: jest.fn().mockResolvedValue(null) };
      }
      if (query.temp_file_id === tempFileId) {
        return {
          lean: jest.fn().mockResolvedValue({
            file_id: serverFileId,
            temp_file_id: tempFileId,
            user: 'user-1',
            filename: 'diarize-meeting.mp4',
            filepath: '/uploads/diarize-meeting.mp4',
            bytes: 8192,
            type: 'video/mp4',
            source: 'local',
            embedded: false,
            metadata: {},
          }),
        };
      }
      return { lean: jest.fn().mockResolvedValue(null) };
    });

    const req = {
      user: { id: 'user-1' },
      body: {
        file_id: tempFileId, // Client still holds the temp UUID
        endpoint: 'openAI',
        model: 'gpt-4o',
        transcriptionModel: 'gpt-4o-transcribe-diarize',
        speakerReferences: [
          { name: 'Speaker A', file_id: 'ref-a' },
        ],
      },
    };

    const result = await createAudioTranscriptionRequest(req);

    // Both lookups should have been attempted (file_id miss → temp_file_id hit)
    expect(findOneCallCount).toBe(2);

    // Transcription should proceed using the server-assigned file_id
    expect(updateFile).toHaveBeenCalledWith(
      expect.objectContaining({
        file_id: serverFileId,
        metadata: expect.objectContaining({
          transcription: expect.objectContaining({
            status: 'queued',
            transcriptionModel: 'gpt-4o-transcribe-diarize',
            conversationId: expect.any(String),
            requestMessageId: expect.any(String),
            responseMessageId: expect.any(String),
          }),
        }),
      }),
    );

    // The conversation and messages should be created with proper structure
    expect(saveConvo).toHaveBeenCalledWith(
      req,
      expect.objectContaining({
        transcriptionModel: 'gpt-4o-transcribe-diarize',
        transcriptionSpeakerReferences: expect.arrayContaining([
          expect.objectContaining({ name: 'Speaker A', file_id: 'ref-a' }),
        ]),
      }),
      expect.any(Object),
    );

    expect(result).toMatchObject({
      conversation: expect.any(Object),
      messages: expect.arrayContaining([
        expect.objectContaining({ sender: 'User' }),
        expect.objectContaining({
          sender: 'Transcription',
          metadata: expect.objectContaining({
            transcriptionStatus: 'processing',
          }),
        }),
      ]),
      responseMessageId: expect.any(String),
    });
  });

  it('returns 404 when neither file_id nor temp_file_id matches any uploaded file', async () => {
    File.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });

    const req = {
      user: { id: 'user-1' },
      body: {
        file_id: 'nonexistent-uuid',
        endpoint: 'openAI',
        model: 'gpt-4o-mini',
        transcriptionModel: 'gpt-4o-transcribe-diarize',
      },
    };

    await expect(createAudioTranscriptionRequest(req)).rejects.toThrow('File not found.');
    try {
      await createAudioTranscriptionRequest(req);
    } catch (error) {
      expect(error.statusCode).toBe(404);
    }
  });
});
