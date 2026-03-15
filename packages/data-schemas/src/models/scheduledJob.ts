import scheduledJobSchema from '~/schema/scheduledJob';
import type * as t from '~/types';

export function createScheduledJobModel(mongoose: typeof import('mongoose')) {
  return (
    mongoose.models.ScheduledJob ||
    mongoose.model<t.IScheduledJob>('ScheduledJob', scheduledJobSchema)
  );
}
