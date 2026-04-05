import fs from 'fs';
import os from 'os';
import path from 'path';
import { AuthKeys, GoogleAuthMode } from 'librechat-data-provider';
import {
  prepareGoogleCredentials,
  resolveGoogleClientAuth,
  normalizeGoogleAuthMode,
  parseGoogleCredentials,
} from './auth';

describe('google auth helpers', () => {
  const originalEnv = process.env;
  let tempDir: string | undefined;

  const writeTempCredentials = (fileName: string, projectId: string) => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'librechat-google-auth-'));
    const filePath = path.join(tempDir, fileName);

    fs.writeFileSync(
      filePath,
      JSON.stringify({
        type: 'service_account',
        project_id: projectId,
        client_email: 'vertex@test-project.iam.gserviceaccount.com',
        private_key:
          '-----BEGIN PRIVATE KEY-----\n' + 'x'.repeat(610) + '\n-----END PRIVATE KEY-----\n',
      }),
    );

    return filePath;
  };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GOOGLE_AUTH_MODE;
    delete process.env.GOOGLE_SERVICE_KEY_FILE;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_VERTEX_PROJECT;
    delete process.env.GOOGLE_PROJECT_ID;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GCLOUD_PROJECT;
    delete process.env.GOOGLE_LOC;
    delete process.env.GOOGLE_CLOUD_LOCATION;
    delete process.env.GOOGLE_VERTEX_LOCATION;
  });

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('loads Vertex AI service account credentials from GOOGLE_SERVICE_KEY_FILE', async () => {
    process.env.GOOGLE_AUTH_MODE = GoogleAuthMode.VERTEX_SERVICE_ACCOUNT;
    process.env.GOOGLE_SERVICE_KEY_FILE = writeTempCredentials(
      'service-account.json',
      'vertex-project',
    );

    const credentials = await prepareGoogleCredentials();
    const auth = resolveGoogleClientAuth(credentials);

    expect(credentials[AuthKeys.GOOGLE_AUTH_MODE]).toBe(GoogleAuthMode.VERTEX_SERVICE_ACCOUNT);
    expect(credentials[AuthKeys.GOOGLE_SERVICE_KEY]).toMatchObject({
      project_id: 'vertex-project',
    });
    expect(auth.useVertex).toBe(true);
    expect(auth.isConfigured).toBe(true);
    expect(auth.projectId).toBe('vertex-project');
    expect(auth.clientOptions).toMatchObject({
      vertexai: true,
      project: 'vertex-project',
      location: 'us-central1',
      googleAuthOptions: {
        credentials: expect.objectContaining({
          project_id: 'vertex-project',
        }),
      },
    });
  });

  it('resolves Vertex AI application default credentials from GOOGLE_APPLICATION_CREDENTIALS', async () => {
    process.env.GOOGLE_AUTH_MODE = GoogleAuthMode.VERTEX_APPLICATION_DEFAULT;
    process.env.GOOGLE_APPLICATION_CREDENTIALS = writeTempCredentials('adc.json', 'adc-project');
    process.env.GOOGLE_CLOUD_LOCATION = 'europe-west1';

    const credentials = await prepareGoogleCredentials();
    const auth = resolveGoogleClientAuth(credentials);

    expect(credentials[AuthKeys.GOOGLE_AUTH_MODE]).toBe(GoogleAuthMode.VERTEX_APPLICATION_DEFAULT);
    expect(credentials[AuthKeys.GOOGLE_VERTEX_PROJECT]).toBe('adc-project');
    expect(auth.useVertex).toBe(true);
    expect(auth.isConfigured).toBe(true);
    expect(auth.serviceKey).toBeUndefined();
    expect(auth.clientOptions).toMatchObject({
      vertexai: true,
      project: 'adc-project',
      location: 'europe-west1',
    });
    expect(auth.clientOptions).not.toHaveProperty('apiKey');
    expect(auth.clientOptions).not.toHaveProperty('googleAuthOptions');
  });

  describe('API key mode', () => {
    it('resolves API key from user-provided credentials', async () => {
      const credentials = await prepareGoogleCredentials({
        credentials: JSON.stringify({
          [AuthKeys.GOOGLE_API_KEY]: 'my-api-key',
        }),
      });
      const auth = resolveGoogleClientAuth(credentials);

      expect(credentials[AuthKeys.GOOGLE_AUTH_MODE]).toBe(GoogleAuthMode.API_KEY);
      expect(credentials[AuthKeys.GOOGLE_API_KEY]).toBe('my-api-key');
      expect(auth.useVertex).toBe(false);
      expect(auth.isConfigured).toBe(true);
      expect(auth.apiKey).toBe('my-api-key');
      expect(auth.authMode).toBe(GoogleAuthMode.API_KEY);
      expect(auth.clientOptions).toEqual({ apiKey: 'my-api-key' });
    });

    it('resolves API key from raw string when acceptRawApiKey is enabled', async () => {
      const credentials = await prepareGoogleCredentials({
        credentials: 'raw-api-key-value',
        acceptRawApiKey: true,
      });

      expect(credentials[AuthKeys.GOOGLE_API_KEY]).toBe('raw-api-key-value');
    });

    it('treats raw string as JSON when acceptRawApiKey is disabled', () => {
      expect(() => parseGoogleCredentials('not-valid-json', false)).toThrow(
        'Error parsing string credentials',
      );
    });
  });

  describe('normalizeGoogleAuthMode', () => {
    it('maps API key variants', () => {
      expect(normalizeGoogleAuthMode('api_key')).toBe(GoogleAuthMode.API_KEY);
      expect(normalizeGoogleAuthMode('apikey')).toBe(GoogleAuthMode.API_KEY);
      expect(normalizeGoogleAuthMode('API')).toBe(GoogleAuthMode.API_KEY);
      expect(normalizeGoogleAuthMode('gemini_api')).toBe(GoogleAuthMode.API_KEY);
      expect(normalizeGoogleAuthMode('developer_api')).toBe(GoogleAuthMode.API_KEY);
    });

    it('maps Vertex service account variants', () => {
      expect(normalizeGoogleAuthMode('vertex_service_account')).toBe(
        GoogleAuthMode.VERTEX_SERVICE_ACCOUNT,
      );
      expect(normalizeGoogleAuthMode('service_account')).toBe(
        GoogleAuthMode.VERTEX_SERVICE_ACCOUNT,
      );
      expect(normalizeGoogleAuthMode('serviceaccount')).toBe(GoogleAuthMode.VERTEX_SERVICE_ACCOUNT);
      expect(normalizeGoogleAuthMode('vertex')).toBe(GoogleAuthMode.VERTEX_SERVICE_ACCOUNT);
      expect(normalizeGoogleAuthMode('vertex_ai')).toBe(GoogleAuthMode.VERTEX_SERVICE_ACCOUNT);
    });

    it('maps Vertex ADC variants', () => {
      expect(normalizeGoogleAuthMode('vertex_application_default')).toBe(
        GoogleAuthMode.VERTEX_APPLICATION_DEFAULT,
      );
      expect(normalizeGoogleAuthMode('adc')).toBe(GoogleAuthMode.VERTEX_APPLICATION_DEFAULT);
      expect(normalizeGoogleAuthMode('vertex_adc')).toBe(GoogleAuthMode.VERTEX_APPLICATION_DEFAULT);
      expect(normalizeGoogleAuthMode('application_default_credentials')).toBe(
        GoogleAuthMode.VERTEX_APPLICATION_DEFAULT,
      );
    });

    it('returns undefined for empty, whitespace, or unrecognized values', () => {
      expect(normalizeGoogleAuthMode(undefined)).toBeUndefined();
      expect(normalizeGoogleAuthMode(null)).toBeUndefined();
      expect(normalizeGoogleAuthMode('')).toBeUndefined();
      expect(normalizeGoogleAuthMode('   ')).toBeUndefined();
      expect(normalizeGoogleAuthMode('unknown_mode')).toBeUndefined();
    });

    it('normalizes case and whitespace before matching', () => {
      expect(normalizeGoogleAuthMode('  API_KEY  ')).toBe(GoogleAuthMode.API_KEY);
      expect(normalizeGoogleAuthMode('Vertex-Service-Account')).toBe(
        GoogleAuthMode.VERTEX_SERVICE_ACCOUNT,
      );
    });
  });

  describe('parseGoogleCredentials', () => {
    it('returns empty object for null/undefined input', () => {
      expect(parseGoogleCredentials(null)).toEqual({});
      expect(parseGoogleCredentials(undefined)).toEqual({});
    });

    it('parses valid JSON string credentials', () => {
      const creds = { [AuthKeys.GOOGLE_API_KEY]: 'key-123' };
      expect(parseGoogleCredentials(JSON.stringify(creds))).toEqual(creds);
    });

    it('passes through object credentials unchanged', () => {
      const creds = { [AuthKeys.GOOGLE_API_KEY]: 'key-456' };
      expect(parseGoogleCredentials(creds)).toBe(creds);
    });

    it('throws on invalid JSON string when not accepting raw key', () => {
      expect(() => parseGoogleCredentials('invalid-json')).toThrow();
    });
  });

  describe('resolveGoogleClientAuth edge cases', () => {
    it('returns isConfigured=false when no credentials are available', () => {
      const auth = resolveGoogleClientAuth(undefined, { env: {} });

      expect(auth.isConfigured).toBe(false);
      expect(auth.useVertex).toBe(false);
      expect(auth.authMode).toBeUndefined();
      expect(auth.clientOptions).toEqual({});
    });

    it('uses env project ID fallback chain: GOOGLE_VERTEX_PROJECT first', () => {
      const env = {
        GOOGLE_VERTEX_PROJECT: 'vertex-proj',
        GOOGLE_PROJECT_ID: 'project-id-proj',
        GOOGLE_CLOUD_PROJECT: 'cloud-proj',
      };
      const auth = resolveGoogleClientAuth({ [AuthKeys.GOOGLE_API_KEY]: 'key' }, { env });

      expect(auth.projectId).toBe('vertex-proj');
    });

    it('falls back to GOOGLE_PROJECT_ID when GOOGLE_VERTEX_PROJECT is missing', () => {
      const env = {
        GOOGLE_PROJECT_ID: 'project-id-proj',
        GOOGLE_CLOUD_PROJECT: 'cloud-proj',
      };
      const auth = resolveGoogleClientAuth({ [AuthKeys.GOOGLE_API_KEY]: 'key' }, { env });

      expect(auth.projectId).toBe('project-id-proj');
    });

    it('uses default us-central1 location when no location env is set', () => {
      const auth = resolveGoogleClientAuth({ [AuthKeys.GOOGLE_API_KEY]: 'key' }, { env: {} });

      expect(auth.location).toBe('us-central1');
    });

    it('prefers GOOGLE_VERTEX_LOCATION over GOOGLE_LOC', () => {
      const env = {
        GOOGLE_VERTEX_LOCATION: 'asia-east1',
        GOOGLE_LOC: 'europe-west1',
      };
      const auth = resolveGoogleClientAuth({ [AuthKeys.GOOGLE_API_KEY]: 'key' }, { env });

      expect(auth.location).toBe('asia-east1');
    });

    it('prefers credential-embedded location over env location', () => {
      const env = { GOOGLE_VERTEX_LOCATION: 'us-east1' };
      const auth = resolveGoogleClientAuth(
        {
          [AuthKeys.GOOGLE_API_KEY]: 'key',
          [AuthKeys.GOOGLE_VERTEX_LOCATION]: 'asia-southeast1',
        },
        { env },
      );

      expect(auth.location).toBe('asia-southeast1');
    });

    it('infers ADC mode from GOOGLE_APPLICATION_CREDENTIALS env when no explicit mode', () => {
      const auth = resolveGoogleClientAuth(undefined, {
        env: {
          GOOGLE_APPLICATION_CREDENTIALS: '/path/to/adc.json',
          GOOGLE_VERTEX_PROJECT: 'adc-env-project',
        },
      });

      expect(auth.authMode).toBe(GoogleAuthMode.VERTEX_APPLICATION_DEFAULT);
      expect(auth.useVertex).toBe(true);
      expect(auth.isConfigured).toBe(true);
    });

    it('sets useVertex=false for API key mode', () => {
      const auth = resolveGoogleClientAuth({
        [AuthKeys.GOOGLE_API_KEY]: 'key-abc',
        [AuthKeys.GOOGLE_AUTH_MODE]: GoogleAuthMode.API_KEY,
      });

      expect(auth.useVertex).toBe(false);
      expect(auth.isConfigured).toBe(true);
      expect(auth.clientOptions).toEqual({ apiKey: 'key-abc' });
    });
  });
});
