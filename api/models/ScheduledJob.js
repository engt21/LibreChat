const { ScheduledJob } = require('~/db/models');

const DEFAULT_SORT = { createdAt: -1 };

const createScheduledJob = async (data) => {
  const schedule = await ScheduledJob.create(data);
  return schedule.toObject();
};

const getScheduledJob = async ({ user, scheduleId }, projection = null) => {
  const query = ScheduledJob.findOne({ user, scheduleId });
  if (projection) {
    query.select(projection);
  }
  return await query.lean();
};

const getScheduledJobs = async (user, filter = {}, projection = null) => {
  const query = ScheduledJob.find({ user, ...filter }).sort(DEFAULT_SORT);
  if (projection) {
    query.select(projection);
  }
  return await query.lean();
};

const updateScheduledJob = async ({ user, scheduleId }, update, options = {}) => {
  return await ScheduledJob.findOneAndUpdate(
    { user, scheduleId },
    update,
    {
      new: true,
      runValidators: true,
      ...options,
    },
  ).lean();
};

const deleteScheduledJob = async ({ user, scheduleId }) => {
  return await ScheduledJob.deleteOne({ user, scheduleId });
};

const deleteUserScheduledJobs = async (user) => {
  return await ScheduledJob.deleteMany({ user });
};

module.exports = {
  ScheduledJob,
  createScheduledJob,
  getScheduledJob,
  getScheduledJobs,
  updateScheduledJob,
  deleteScheduledJob,
  deleteUserScheduledJobs,
};
