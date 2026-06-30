require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  if (!email) {
    throw new Error('Usage: node scripts/admin-reset-user-mfa.js user@example.com');
  }
  await mongoose.connect(process.env.MONGO_URI);
  const users = mongoose.connection.collection('users');
  const sessions = mongoose.connection.collection('sessions');
  const user = await users.findOne({ email }, { projection: { _id: 1 } });
  if (!user) {
    throw new Error('User not found');
  }
  await users.updateOne(
    { _id: user._id },
    {
      $set: { twoFactorEnabled: false },
      $unset: {
        totpSecret: '',
        backupCodes: '',
        pendingTotpSecret: '',
        pendingBackupCodes: '',
      },
    },
  );
  await sessions.deleteMany({ user: user._id });
  console.log(`MFA reset and active sessions revoked for ${email}`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
