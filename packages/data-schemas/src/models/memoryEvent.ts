import memoryEventSchema from '~/schema/memoryEvent';
import type { IMemoryEvent } from '~/types/memory';

export function createMemoryEventModel(mongoose: typeof import('mongoose')) {
  return (
    mongoose.models.MemoryEvent || mongoose.model<IMemoryEvent>('MemoryEvent', memoryEventSchema)
  );
}
