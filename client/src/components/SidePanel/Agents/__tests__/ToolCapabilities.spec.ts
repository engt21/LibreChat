import { EModelEndpoint } from 'librechat-data-provider';
import { getProviderToolAvailability } from '../ToolCapabilities';

describe('getProviderToolAvailability', () => {
  it('exposes OpenAI hosted tools for Responses-capable models', () => {
    expect(getProviderToolAvailability(EModelEndpoint.openAI, 'gpt-5')).toMatchObject({
      name: 'OpenAI',
      code: true,
      codeFiles: true,
      exclusive: false,
      fileSearch: true,
    });
  });

  it('exposes Anthropic native tools without provider file uploads', () => {
    expect(
      getProviderToolAvailability(EModelEndpoint.anthropic, 'claude-sonnet-4-5'),
    ).toMatchObject({
      name: 'Anthropic',
      codeFiles: false,
      exclusive: false,
      fileSearch: false,
    });
  });

  it('marks Gemini native tools exclusive from structured local tools', () => {
    expect(getProviderToolAvailability(EModelEndpoint.google, 'gemini-2.5-pro')).toMatchObject({
      name: 'Google',
      code: true,
      codeFiles: false,
      exclusive: true,
      fileSearch: false,
    });
  });

  it('leaves provider tools unavailable for custom providers', () => {
    expect(getProviderToolAvailability('custom-provider', 'custom-model')).toEqual({
      name: 'custom-provider',
      code: false,
      codeFiles: false,
      exclusive: false,
      fileSearch: false,
      webSearch: false,
    });
  });
});
