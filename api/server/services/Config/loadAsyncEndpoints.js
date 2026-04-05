const {
  isUserProvided,
  prepareGoogleCredentials,
  resolveGoogleClientAuth,
} = require('@librechat/api');
const { config } = require('./EndpointService');

async function loadAsyncEndpoints() {
  const { googleKey } = config;
  const googleUserProvides = isUserProvided(googleKey);

  if (googleUserProvides) {
    return {
      google: {
        userProvide: true,
      },
    };
  }

  const googleCredentials = await prepareGoogleCredentials({ rawApiKey: googleKey });
  const googleAuth = resolveGoogleClientAuth(googleCredentials);

  return {
    google: googleAuth.isConfigured ? { userProvide: false } : false,
  };
}

module.exports = loadAsyncEndpoints;
