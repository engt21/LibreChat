import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createModels } from '~/models';
import { createMemoryMethods } from './memory';

let mongoServer: MongoMemoryServer;
let memoryMethods: ReturnType<typeof createMemoryMethods>;
let modelsToCleanup: string[] = [];

describe('Memory Methods', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    const models = createModels(mongoose);
    modelsToCleanup = Object.keys(models);
    Object.assign(mongoose.models, models);
    memoryMethods = createMemoryMethods(mongoose);
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    for (const modelName of modelsToCleanup) {
      delete mongoose.models[modelName];
    }
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await mongoose.models.MemoryEntry.deleteMany({});
  });

  it('updates only the changed key timestamp and leaves identical values untouched', async () => {
    const userId = new mongoose.Types.ObjectId();
    const firstTimestamp = new Date('2026-01-01T00:00:00.000Z');
    const secondTimestamp = new Date('2026-02-01T00:00:00.000Z');

    await mongoose.models.MemoryEntry.create([
      {
        userId,
        key: 'first_memory',
        value: 'First value.',
        tokenCount: 3,
        updated_at: firstTimestamp,
      },
      {
        userId,
        key: 'second_memory',
        value: 'Second value.',
        tokenCount: 3,
        updated_at: secondTimestamp,
      },
    ]);

    const changed = await memoryMethods.setMemory({
      userId,
      key: 'first_memory',
      value: 'Updated first value.',
      tokenCount: 4,
    });
    expect(changed).toEqual({ ok: true, changed: true });

    const afterChange = await mongoose.models.MemoryEntry.find({ userId }).lean();
    const firstAfterChange = afterChange.find((memory) => memory.key === 'first_memory');
    const secondAfterChange = afterChange.find((memory) => memory.key === 'second_memory');
    expect(firstAfterChange?.updated_at).not.toEqual(firstTimestamp);
    expect(secondAfterChange?.updated_at).toEqual(secondTimestamp);

    const unchangedTimestamp = firstAfterChange?.updated_at;
    const unchanged = await memoryMethods.setMemory({
      userId,
      key: 'first_memory',
      value: 'Updated first value.',
      tokenCount: 4,
    });
    expect(unchanged).toEqual({ ok: true, changed: false });

    const finalMemory = await mongoose.models.MemoryEntry.findOne({
      userId,
      key: 'first_memory',
    }).lean();
    expect(finalMemory?.updated_at).toEqual(unchangedTimestamp);
  });
});
