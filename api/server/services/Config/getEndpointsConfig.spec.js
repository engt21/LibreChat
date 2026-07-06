const { EModelEndpoint } = require('librechat-data-provider');
const { applyAdminBYOKEndpointConfig } = require('./getEndpointsConfig');

describe('applyAdminBYOKEndpointConfig', () => {
  it('exposes key and optional base URL controls for enabled OpenAI BYOK', () => {
    const endpointsConfig = {
      [EModelEndpoint.openAI]: { order: 0, userProvide: false },
    };

    applyAdminBYOKEndpointConfig(endpointsConfig, {
      byok: {
        providers: {
          [EModelEndpoint.openAI]: {
            enabled: true,
            allowBaseURL: true,
          },
        },
      },
    });

    expect(endpointsConfig[EModelEndpoint.openAI]).toEqual({
      order: 0,
      userProvide: true,
      userProvideURL: true,
    });
  });

  it('keeps the base URL control hidden when the policy forbids overrides', () => {
    const endpointsConfig = {};

    applyAdminBYOKEndpointConfig(endpointsConfig, {
      byok: {
        providers: {
          [EModelEndpoint.openAI]: {
            enabled: true,
            allowBaseURL: false,
          },
        },
      },
    });

    expect(endpointsConfig[EModelEndpoint.openAI]).toEqual({
      userProvide: true,
      userProvideURL: false,
    });
  });

  it('does not change disabled provider endpoint controls', () => {
    const endpointsConfig = {
      [EModelEndpoint.openAI]: { order: 0, userProvide: false },
    };

    applyAdminBYOKEndpointConfig(endpointsConfig, {
      byok: {
        providers: {
          [EModelEndpoint.openAI]: {
            enabled: false,
            allowBaseURL: true,
          },
        },
      },
    });

    expect(endpointsConfig[EModelEndpoint.openAI]).toEqual({ order: 0, userProvide: false });
  });
});
