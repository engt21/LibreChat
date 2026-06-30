const mongoose = require('mongoose');
const { createMethods } = require('@librechat/data-schemas');
const methods = createMethods(mongoose);
const { syncConfiguredSuperAdmins } = require('~/server/services/Admin/superadmin');
const { comparePassword } = require('./userMethods');
const {
  getMessage,
  getMessages,
  saveMessage,
  recordMessage,
  updateMessage,
  deleteMessagesSince,
  deleteMessages,
} = require('./Message');
const { getConvoTitle, getConvo, saveConvo, deleteConvos } = require('./Conversation');
const { getPreset, getPresets, reorderPresets, savePreset, deletePresets } = require('./Preset');
const {
  ScheduledJob,
  createScheduledJob,
  getScheduledJob,
  getScheduledJobs,
  updateScheduledJob,
  deleteScheduledJob,
  deleteUserScheduledJobs,
} = require('./ScheduledJob');
const { File } = require('~/db/models');

const seedDatabase = async () => {
  await methods.initializeRoles();
  await methods.seedDefaultRoles();
  await methods.seedDefaultAdminRoles();
  await methods.ensureDefaultCategories();
  await syncConfiguredSuperAdmins();
};

module.exports = {
  ...methods,
  seedDatabase,
  comparePassword,

  getMessage,
  getMessages,
  saveMessage,
  recordMessage,
  updateMessage,
  deleteMessagesSince,
  deleteMessages,

  getConvoTitle,
  getConvo,
  saveConvo,
  deleteConvos,

  getPreset,
  getPresets,
  reorderPresets,
  savePreset,
  deletePresets,

  ScheduledJob,
  createScheduledJob,
  getScheduledJob,
  getScheduledJobs,
  updateScheduledJob,
  deleteScheduledJob,
  deleteUserScheduledJobs,

  Files: File,
};
