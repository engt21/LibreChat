/**
 * Unit tests for `applyImageGenerationTool` from `api/models/Agent.js`.
 *
 * These tests avoid any DB setup by mocking the modules `Agent.js` requires
 * for its other (un-tested-here) responsibilities. The function under test is
 * pure and operates purely on its arguments.
 */

jest.mock('~/server/services/Config', () => ({
  getCachedTools: jest.fn(),
  getMCPServerTools: jest.fn(),
  cacheMCPServerTools: jest.fn(),
}));

jest.mock('~/server/services/Tools/ollama', () => ({
  applyOllamaWebSearchMode: jest.fn(),
}));

jest.mock('~/server/services/Tools/mcp', () => ({
  reinitMCPServer: jest.fn(),
}));

jest.mock('~/server/services/PermissionService', () => ({
  removeAllPermissions: jest.fn(),
}));

jest.mock('~/config', () => ({
  getMCPServersRegistry: () => ({
    getServerConfig: jest.fn(),
  }),
}));

jest.mock('~/db/models', () => ({
  Agent: { find: jest.fn(), findOne: jest.fn() },
  AclEntry: { find: jest.fn() },
  User: { findOne: jest.fn() },
}));

jest.mock('../Project', () => ({
  removeAgentFromAllProjects: jest.fn(),
  removeAgentIdsFromProject: jest.fn(),
  addAgentIdsToProject: jest.fn(),
}));

jest.mock('../Action', () => ({ getActions: jest.fn() }));

jest.mock('@librechat/api', () => ({
  getCustomEndpointConfig: jest.fn(),
}));

jest.mock('@librechat/data-schemas', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { ImageGenProvider, imageGenProviderToolKey } = require('librechat-data-provider');
const { applyImageGenerationTool } = require('../Agent');

const oaiKey = imageGenProviderToolKey[ImageGenProvider.openai];
const googleKey = imageGenProviderToolKey[ImageGenProvider.google];
const fluxKey = imageGenProviderToolKey[ImageGenProvider.flux];
const stabilityKey = imageGenProviderToolKey[ImageGenProvider.stability];

describe('applyImageGenerationTool', () => {
  it('does nothing when neither toggle, prefs, nor spec opt in', () => {
    const tools = [];
    applyImageGenerationTool({
      endpoint: 'openai',
      ephemeralAgent: { image_generation: false },
      modelSpec: null,
      user: { imageGenerationPrefs: { enabledByDefault: false } },
      tools,
    });
    expect(tools).toEqual([]);
  });

  it('opts in via ephemeralAgent.image_generation === true', () => {
    const tools = [];
    applyImageGenerationTool({
      endpoint: 'openai',
      ephemeralAgent: { image_generation: true },
      modelSpec: null,
      user: undefined,
      tools,
    });
    expect(tools).toContain(oaiKey);
  });

  it('opts in via user.imageGenerationPrefs.enabledByDefault', () => {
    const tools = [];
    applyImageGenerationTool({
      endpoint: 'google',
      ephemeralAgent: undefined,
      modelSpec: null,
      user: { imageGenerationPrefs: { enabledByDefault: true } },
      tools,
    });
    expect(tools).toContain(googleKey);
  });

  it('opts in via modelSpec.imageGeneration', () => {
    const tools = [];
    applyImageGenerationTool({
      endpoint: 'openai',
      ephemeralAgent: null,
      modelSpec: { imageGeneration: true },
      user: undefined,
      tools,
    });
    expect(tools).toContain(oaiKey);
  });

  it('honors preferredProvider when provided', () => {
    const tools = [];
    applyImageGenerationTool({
      endpoint: 'openai',
      ephemeralAgent: { image_generation: true },
      modelSpec: null,
      user: {
        imageGenerationPrefs: { preferredProvider: ImageGenProvider.flux },
      },
      tools,
    });
    expect(tools).toContain(fluxKey);
  });

  it('routes Azure endpoint to the OAI tool key', () => {
    const tools = [];
    applyImageGenerationTool({
      endpoint: 'azureOpenAI',
      ephemeralAgent: { image_generation: true },
      modelSpec: null,
      user: undefined,
      tools,
    });
    // azure shares oaiKey
    expect(tools).toContain(oaiKey);
  });

  it('routes Vertex endpoint to the Google tool key', () => {
    const tools = [];
    applyImageGenerationTool({
      endpoint: 'vertex',
      ephemeralAgent: { image_generation: true },
      modelSpec: null,
      user: undefined,
      tools,
    });
    expect(tools).toContain(googleKey);
  });

  it('routes xAI endpoint to the OAI tool key', () => {
    const tools = [];
    applyImageGenerationTool({
      endpoint: 'xai',
      ephemeralAgent: { image_generation: true },
      modelSpec: null,
      user: undefined,
      tools,
    });
    expect(tools).toContain(oaiKey);
  });

  it('falls back to openai when endpoint is unknown', () => {
    const tools = [];
    applyImageGenerationTool({
      endpoint: 'unknown-endpoint',
      ephemeralAgent: { image_generation: true },
      modelSpec: null,
      user: undefined,
      tools,
    });
    expect(tools).toContain(oaiKey);
  });

  it('does not push duplicate tool keys', () => {
    const tools = [oaiKey];
    applyImageGenerationTool({
      endpoint: 'openai',
      ephemeralAgent: { image_generation: true },
      modelSpec: null,
      user: undefined,
      tools,
    });
    expect(tools.filter((t) => t === oaiKey).length).toBe(1);
  });

  it('honors stability preferredProvider over endpoint default', () => {
    const tools = [];
    applyImageGenerationTool({
      endpoint: 'google',
      ephemeralAgent: { image_generation: true },
      modelSpec: null,
      user: {
        imageGenerationPrefs: { preferredProvider: ImageGenProvider.stability },
      },
      tools,
    });
    expect(tools).toContain(stabilityKey);
  });
});
