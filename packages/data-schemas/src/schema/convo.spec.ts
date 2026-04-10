import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createConversationModel } from '~/models/convo';

let Conversation: ReturnType<typeof createConversationModel>;
let mongoServer: MongoMemoryServer;

describe('Conversation schema – transcriptionSpeakerReferences', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    Conversation = createConversationModel(mongoose);
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  afterEach(async () => {
    await Conversation.deleteMany({});
  });

  it('persists speaker references with a `type` field on save', async () => {
    const refs = [
      {
        id: 'ref-1',
        name: 'Alice',
        file_id: 'file-abc',
        filename: 'alice.wav',
        filepath: '/uploads/alice.wav',
        type: 'audio/wav',
        bytes: 1024,
        durationSeconds: 5.2,
        embedded: false,
        source: 'local',
      },
      {
        name: 'Bob',
        file_id: 'file-def',
        filename: 'bob.mp3',
        type: 'audio/mpeg',
        bytes: 2048,
        durationSeconds: 8.0,
        embedded: true,
        source: 'local',
      },
    ];

    const doc = new Conversation({
      conversationId: 'conv-speaker-ref-1',
      user: 'user-1',
      endpoint: 'openAI',
      transcriptionSpeakerReferences: refs,
    });

    const saved = await doc.save();
    const plain = saved.toObject();

    expect(plain.transcriptionSpeakerReferences).toHaveLength(2);
    expect(plain.transcriptionSpeakerReferences![0]).toMatchObject({
      id: 'ref-1',
      name: 'Alice',
      file_id: 'file-abc',
      type: 'audio/wav',
      bytes: 1024,
      durationSeconds: 5.2,
    });
    expect(plain.transcriptionSpeakerReferences![1]).toMatchObject({
      name: 'Bob',
      file_id: 'file-def',
      type: 'audio/mpeg',
    });
    // Subdocuments should NOT have their own _id
    expect(plain.transcriptionSpeakerReferences![0]).not.toHaveProperty('_id');
  });

  it('persists speaker references via findOneAndUpdate (saveConvo path)', async () => {
    // Pre-create the conversation without speaker references
    await new Conversation({
      conversationId: 'conv-update-1',
      user: 'user-1',
      endpoint: 'openAI',
    }).save();

    const refs = [
      {
        name: 'Charlie',
        file_id: 'file-ghi',
        filename: 'charlie.wav',
        type: 'audio/wav',
        bytes: 512,
        durationSeconds: 3.5,
        embedded: false,
        source: 'local',
      },
    ];

    const updated = await Conversation.findOneAndUpdate(
      { conversationId: 'conv-update-1', user: 'user-1' },
      { $set: { transcriptionSpeakerReferences: refs } },
      { new: true },
    ).lean();

    expect(updated).not.toBeNull();
    expect(updated!.transcriptionSpeakerReferences).toHaveLength(1);
    expect(updated!.transcriptionSpeakerReferences![0]).toMatchObject({
      name: 'Charlie',
      file_id: 'file-ghi',
      type: 'audio/wav',
    });
  });

  it('handles empty speaker references array', async () => {
    const doc = new Conversation({
      conversationId: 'conv-empty-refs',
      user: 'user-1',
      endpoint: 'openAI',
      transcriptionSpeakerReferences: [],
    });

    const saved = await doc.save();
    const plain = saved.toObject();
    expect(plain.transcriptionSpeakerReferences).toEqual([]);
  });

  it('omits speaker references when undefined (default)', async () => {
    const doc = new Conversation({
      conversationId: 'conv-no-refs',
      user: 'user-1',
      endpoint: 'openAI',
    });

    const saved = await doc.save();
    const plain = saved.toObject();
    // With `default: undefined`, the field should not be present
    expect(plain.transcriptionSpeakerReferences).toBeUndefined();
  });

  it('handles partial speaker reference fields (undefined optional fields)', async () => {
    const refs = [
      {
        name: 'Dana',
        file_id: 'file-jkl',
        // All other fields are undefined / omitted
      },
    ];

    const doc = new Conversation({
      conversationId: 'conv-partial-refs',
      user: 'user-1',
      endpoint: 'openAI',
      transcriptionSpeakerReferences: refs,
    });

    const saved = await doc.save();
    const plain = saved.toObject();

    expect(plain.transcriptionSpeakerReferences).toHaveLength(1);
    expect(plain.transcriptionSpeakerReferences![0]).toMatchObject({
      name: 'Dana',
      file_id: 'file-jkl',
    });
    // Optional fields should not be present
    expect(plain.transcriptionSpeakerReferences![0].type).toBeUndefined();
    expect(plain.transcriptionSpeakerReferences![0].bytes).toBeUndefined();
  });

  it('roundtrips through upsert (the exact saveConvo code path)', async () => {
    const refs = [
      {
        id: 'ref-round',
        name: 'Eve',
        file_id: 'file-mno',
        filename: 'eve.wav',
        filepath: '/uploads/eve.wav',
        type: 'audio/wav',
        bytes: 768,
        durationSeconds: 4.1,
        embedded: false,
        source: 'local',
      },
    ];

    // Upsert (insert path) — mirrors saveConvo's findOneAndUpdate with upsert: true
    const result = await Conversation.findOneAndUpdate(
      { conversationId: 'conv-upsert-1', user: 'user-1' },
      {
        $set: {
          endpoint: 'openAI',
          title: 'Transcript: test',
          transcriptionModel: 'gpt-4o-transcribe-diarize',
          transcriptionPrompt: null,
          transcriptionSpeakerReferences: refs,
          files: ['file-mno'],
        },
      },
      { new: true, upsert: true },
    ).lean();

    expect(result).not.toBeNull();
    expect(result!.transcriptionSpeakerReferences).toHaveLength(1);
    expect(result!.transcriptionSpeakerReferences![0]).toMatchObject({
      name: 'Eve',
      file_id: 'file-mno',
      type: 'audio/wav',
      durationSeconds: 4.1,
    });

    // Read it back independently to verify persistence
    const readBack = await Conversation.findOne({
      conversationId: 'conv-upsert-1',
    }).lean();
    expect(readBack!.transcriptionSpeakerReferences).toHaveLength(1);
    expect(readBack!.transcriptionSpeakerReferences![0].type).toBe('audio/wav');
  });
});
