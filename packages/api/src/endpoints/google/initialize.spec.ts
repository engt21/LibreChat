import fs from 'fs';
import os from 'os';
import path from 'path';
import { AuthKeys, ErrorTypes, GoogleAuthMode } from 'librechat-data-provider';
import type { BaseInitializeParams } from '~/types';
import { initializeGoogle } from './initialize';
import { getGoogleConfig } from './llm';
import { getGoogleModelCapability } from '../models';

jest.mock('./llm', () => ({
  getGoogleConfig: jest.fn((_credentials: unknown, clientOptions: Record<string, unknown>) => ({
    llmConfig: {
      model: (clientOptions.modelOptions as { model?: string } | undefined)?.model,
    },
  })),
}));

jest.mock('../models', () => ({
  getGoogleModelCapability: jest.fn(),
}));

const mockedGetGoogleConfig = jest.mocked(getGoogleConfig);
const mockedGetGoogleModelCapability = jest.mocked(getGoogleModelCapability);

const createParams = (): BaseInitializeParams =>
  ({
    req: {
      config: {
        endpoints: {},
      },
      body: {
        key: 'never',
      },
      user: {
        id: 'user-1',
      },
    },
    endpoint: 'google',
    model_parameters: {
      model: 'gemini-2.5-flash-lite',
    },
    db: {
      getUserKey: jest.fn(),
    },
  }) as unknown as BaseInitializeParams;

describe('initializeGoogle', () => {
  const originalEnv = process.env;
  let tempDir: string | undefined;

  const writeTempCredentials = (fileName: string, projectId: string) => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'librechat-google-init-'));
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
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.GOOGLE_AUTH_MODE;
    delete process.env.GOOGLE_SERVICE_KEY_FILE;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_VERTEX_PROJECT;
    delete process.env.GOOGLE_VERTEX_LOCATION;
    delete process.env.GOOGLE_REVERSE_PROXY;
    delete process.env.GOOGLE_AUTH_HEADER;
    delete process.env.PROXY;
    mockedGetGoogleModelCapability.mockResolvedValue(undefined);
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

  it('falls back to server Vertex credentials when the user key is missing', async () => {
    process.env.GOOGLE_KEY = 'user_provided';
    process.env.GOOGLE_AUTH_MODE = GoogleAuthMode.VERTEX_SERVICE_ACCOUNT;
    process.env.GOOGLE_SERVICE_KEY_FILE = writeTempCredentials(
      'service-account.json',
      'vertex-project',
    );

    const params = createParams();
    const missingKeyError = new Error(JSON.stringify({ type: ErrorTypes.NO_USER_KEY }));
    params.db.getUserKey = jest.fn().mockRejectedValue(missingKeyError);

    await initializeGoogle(params);

    expect(params.db.getUserKey).toHaveBeenCalledWith({
      userId: 'user-1',
      name: 'google',
    });
    expect(mockedGetGoogleConfig).toHaveBeenCalledTimes(1);
    expect(mockedGetGoogleConfig.mock.calls[0][0]).toMatchObject({
      [AuthKeys.GOOGLE_AUTH_MODE]: GoogleAuthMode.VERTEX_SERVICE_ACCOUNT,
      [AuthKeys.GOOGLE_VERTEX_PROJECT]: 'vertex-project',
      [AuthKeys.GOOGLE_VERTEX_LOCATION]: 'us-central1',
      [AuthKeys.GOOGLE_SERVICE_KEY]: expect.objectContaining({
        project_id: 'vertex-project',
      }),
    });
  });

  it('passes the discovered Vertex location override into Google config', async () => {
    process.env.GOOGLE_KEY = 'user_provided';
    process.env.GOOGLE_AUTH_MODE = GoogleAuthMode.VERTEX_SERVICE_ACCOUNT;
    process.env.GOOGLE_SERVICE_KEY_FILE = writeTempCredentials(
      'service-account.json',
      'vertex-project',
    );
    mockedGetGoogleModelCapability.mockResolvedValue({
      name: 'gemini-3.1-pro-preview',
      vertexLocation: 'global',
      vertexLocations: ['global'],
    });

    const params = createParams();
    const missingKeyError = new Error(JSON.stringify({ type: ErrorTypes.NO_USER_KEY }));
    params.model_parameters = { model: 'gemini-3.1-pro-preview' };
    params.db.getUserKey = jest.fn().mockRejectedValue(missingKeyError);

    await initializeGoogle(params);

    expect(mockedGetGoogleModelCapability).toHaveBeenCalledWith({
      model: 'gemini-3.1-pro-preview',
      googleAuth: expect.objectContaining({
        useVertex: true,
        projectId: 'vertex-project',
      }),
    });
    expect(mockedGetGoogleConfig).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        vertexLocation: 'global',
      }),
    );
  });

  it('adds Vertex fallbacks for multi-location callable models', async () => {
    process.env.GOOGLE_KEY = 'user_provided';
    process.env.GOOGLE_AUTH_MODE = GoogleAuthMode.VERTEX_SERVICE_ACCOUNT;
    process.env.GOOGLE_SERVICE_KEY_FILE = writeTempCredentials(
      'service-account.json',
      'vertex-project',
    );
    mockedGetGoogleConfig.mockImplementationOnce((_credentials, clientOptions) => ({
      llmConfig: {
        model: (clientOptions.modelOptions as { model?: string } | undefined)?.model,
        location: clientOptions.vertexLocation,
        authOptions: {
          projectId: 'vertex-project',
          credentials: {
            project_id: 'vertex-project',
            client_email: 'vertex@test-project.iam.gserviceaccount.com',
            private_key: 'test-private-key',
          },
        },
      },
    }));
    mockedGetGoogleModelCapability.mockResolvedValue({
      name: 'gemini-3.1-pro-preview',
      vertexLocation: 'global',
      vertexLocations: ['global', 'us-central1'],
    });

    const params = createParams();
    const missingKeyError = new Error(JSON.stringify({ type: ErrorTypes.NO_USER_KEY }));
    params.model_parameters = { model: 'gemini-3.1-pro-preview' };
    params.db.getUserKey = jest.fn().mockRejectedValue(missingKeyError);

    const result = await initializeGoogle(params);

    expect((result.llmConfig as Record<string, unknown>).fallbacks).toEqual([
      {
        provider: 'vertexai',
        clientOptions: expect.objectContaining({
          model: 'gemini-3.1-pro-preview',
          location: 'us-central1',
        }),
      },
    ]);
  });

  it('preserves the missing user key error when no server fallback exists', async () => {
    process.env.GOOGLE_KEY = 'user_provided';

    const params = createParams();
    const missingKeyError = new Error(JSON.stringify({ type: ErrorTypes.NO_USER_KEY }));
    params.db.getUserKey = jest.fn().mockRejectedValue(missingKeyError);

    await expect(initializeGoogle(params)).rejects.toThrow(missingKeyError.message);
    expect(mockedGetGoogleConfig).not.toHaveBeenCalled();
  });
});
