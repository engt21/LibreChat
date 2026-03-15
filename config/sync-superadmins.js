const path = require('path');
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const { silentExit } = require('./helpers');
const connect = require('./connect');
const {
  getConfiguredSuperAdminEmails,
  syncConfiguredSuperAdmins,
} = require('~/server/services/Admin/superadmin');

(async () => {
  await connect();

  console.purple('-----------------------------');
  console.purple('Sync configured superadmins');
  console.purple('-----------------------------');

  const configuredEmails = getConfiguredSuperAdminEmails();
  if (!configuredEmails.length) {
    console.yellow('No SUPERADMIN_EMAILS are configured. Nothing to do.');
    silentExit(0);
  }

  console.white(`Configured emails: ${configuredEmails.join(', ')}`);
  const result = await syncConfiguredSuperAdmins();

  console.green(`Configured: ${result.configured}`);
  console.green(`Matched users: ${result.matched}`);
  console.green(`Promoted to ADMIN: ${result.promoted}`);

  silentExit(0);
})().catch((error) => {
  console.red('Failed to sync superadmins');
  console.error(error);
  process.exit(1);
});
