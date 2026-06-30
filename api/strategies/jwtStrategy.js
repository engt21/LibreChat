const { logger } = require('@librechat/data-schemas');
const { SystemRoles } = require('librechat-data-provider');
const { Strategy: JwtStrategy, ExtractJwt } = require('passport-jwt');
const { getUserById, updateUser } = require('~/models');

// JWT strategy
const jwtLogin = () =>
  new JwtStrategy(
    {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET,
      issuer: process.env.JWT_ISSUER || 'librechat',
      audience: process.env.JWT_AUDIENCE || 'librechat-api',
    },
    async (payload, done) => {
      try {
        if (payload?.tokenType && payload.tokenType !== 'access') {
          return done(null, false);
        }
        const user = await getUserById(payload?.id, '-password -__v -totpSecret -backupCodes');
        if (user) {
          user.id = user._id.toString();
          if (!user.role) {
            user.role = SystemRoles.USER;
            await updateUser(user.id, { role: user.role });
          }
          done(null, user);
        } else {
          logger.warn('[jwtLogin] JwtStrategy => no user found: ' + payload?.id);
          done(null, false);
        }
      } catch (err) {
        done(err, false);
      }
    },
  );

module.exports = jwtLogin;
