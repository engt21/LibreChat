const express = require('express');
const request = require('supertest');

jest.mock('~/models', () => ({
  getUserKey: jest.fn(),
  updateUserKey: jest.fn(),
  deleteUserKey: jest.fn(),
  getUserKeyExpiry: jest.fn(),
  getUserKeyValues: jest.fn(),
}));

jest.mock('~/server/middleware/requireJwtAuth', () => (req, res, next) => next());

jest.mock('~/server/middleware', () => ({
  requireJwtAuth: (req, res, next) => next(),
}));

jest.mock('~/server/services/Models/refreshModels', () => ({
  invalidateModelDiscoveryCaches: jest.fn(),
}));

describe('Keys Routes', () => {
  let app;
  const {
    getUserKey,
    updateUserKey,
    deleteUserKey,
    getUserKeyExpiry,
    getUserKeyValues,
  } = require('~/models');
  const { invalidateModelDiscoveryCaches } = require('~/server/services/Models/refreshModels');

  beforeAll(() => {
    const keysRouter = require('../keys');

    app = express();
    app.use(express.json());

    app.use((req, res, next) => {
      req.user = { id: 'test-user-123' };
      next();
    });

    app.use('/api/keys', keysRouter);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('PUT /', () => {
    it('should update a user key with the authenticated user ID', async () => {
      updateUserKey.mockResolvedValue({});

      const response = await request(app)
        .put('/api/keys')
        .send({ name: 'openAI', value: 'sk-test-key-123', expiresAt: '2026-12-31' });

      expect(response.status).toBe(201);
      expect(updateUserKey).toHaveBeenCalledWith({
        userId: 'test-user-123',
        name: 'openAI',
        value: 'sk-test-key-123',
        expiresAt: '2026-12-31',
      });
      expect(updateUserKey).toHaveBeenCalledTimes(1);
      expect(invalidateModelDiscoveryCaches).toHaveBeenCalledTimes(1);
    });

    it('should not allow userId override via request body (IDOR prevention)', async () => {
      updateUserKey.mockResolvedValue({});

      const response = await request(app).put('/api/keys').send({
        userId: 'attacker-injected-id',
        name: 'openAI',
        value: 'sk-attacker-key',
      });

      expect(response.status).toBe(201);
      expect(updateUserKey).toHaveBeenCalledWith({
        userId: 'test-user-123',
        name: 'openAI',
        value: 'sk-attacker-key',
        expiresAt: undefined,
      });
    });

    it('should ignore extraneous fields from request body', async () => {
      updateUserKey.mockResolvedValue({});

      const response = await request(app).put('/api/keys').send({
        name: 'openAI',
        value: 'sk-test-key',
        expiresAt: '2026-12-31',
        _id: 'injected-mongo-id',
        __v: 99,
        extra: 'should-be-ignored',
      });

      expect(response.status).toBe(201);
      expect(updateUserKey).toHaveBeenCalledWith({
        userId: 'test-user-123',
        name: 'openAI',
        value: 'sk-test-key',
        expiresAt: '2026-12-31',
      });
    });

    it('should handle missing optional fields', async () => {
      updateUserKey.mockResolvedValue({});

      const response = await request(app)
        .put('/api/keys')
        .send({ name: 'anthropic', value: 'sk-ant-key' });

      expect(response.status).toBe(201);
      expect(updateUserKey).toHaveBeenCalledWith({
        userId: 'test-user-123',
        name: 'anthropic',
        value: 'sk-ant-key',
        expiresAt: undefined,
      });
    });

    it('should merge partial JSON key updates with existing stored values', async () => {
      getUserKeyValues.mockResolvedValue({
        apiKey: 'saved-key',
        baseURL: 'https://example.openai.azure.com/openai/v1',
        models: 'gpt-4.1',
      });
      updateUserKey.mockResolvedValue({});

      const response = await request(app)
        .put('/api/keys')
        .send({
          name: 'azureOpenAI',
          value: JSON.stringify({ models: 'gpt-4.1,gpt-4o-mini' }),
          merge: true,
        });

      expect(response.status).toBe(201);
      expect(getUserKeyValues).toHaveBeenCalledWith({
        userId: 'test-user-123',
        name: 'azureOpenAI',
      });
      expect(updateUserKey).toHaveBeenCalledWith({
        userId: 'test-user-123',
        name: 'azureOpenAI',
        value: JSON.stringify({
          apiKey: 'saved-key',
          baseURL: 'https://example.openai.azure.com/openai/v1',
          models: 'gpt-4.1,gpt-4o-mini',
        }),
        expiresAt: undefined,
      });
    });

    it('should remove a saved base URL when a merged update clears it', async () => {
      getUserKeyValues.mockResolvedValue({
        apiKey: 'saved-key',
        baseURL: 'https://us.api.openai.com/v1',
      });
      updateUserKey.mockResolvedValue({});

      const response = await request(app)
        .put('/api/keys')
        .send({
          name: 'openAI',
          value: JSON.stringify({ baseURL: '' }),
          merge: true,
        });

      expect(response.status).toBe(201);
      expect(updateUserKey).toHaveBeenCalledWith({
        userId: 'test-user-123',
        name: 'openAI',
        value: JSON.stringify({ apiKey: 'saved-key' }),
        expiresAt: undefined,
      });
    });

    it('should keep partial JSON payloads when no existing key is stored', async () => {
      getUserKeyValues.mockRejectedValue(new Error('missing key'));
      updateUserKey.mockResolvedValue({});

      const response = await request(app)
        .put('/api/keys')
        .send({
          name: 'azureOpenAI',
          value: JSON.stringify({ models: 'gpt-4.1,gpt-4o-mini' }),
          merge: true,
        });

      expect(response.status).toBe(201);
      expect(updateUserKey).toHaveBeenCalledWith({
        userId: 'test-user-123',
        name: 'azureOpenAI',
        value: JSON.stringify({ models: 'gpt-4.1,gpt-4o-mini' }),
        expiresAt: undefined,
      });
    });

    it('should return 400 when request body is null', async () => {
      const response = await request(app)
        .put('/api/keys')
        .set('Content-Type', 'application/json')
        .send('null');

      expect(response.status).toBe(400);
      expect(updateUserKey).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /:name', () => {
    it('should delete a user key by name', async () => {
      deleteUserKey.mockResolvedValue({});

      const response = await request(app).delete('/api/keys/openAI');

      expect(response.status).toBe(204);
      expect(deleteUserKey).toHaveBeenCalledWith({
        userId: 'test-user-123',
        name: 'openAI',
      });
      expect(deleteUserKey).toHaveBeenCalledTimes(1);
      expect(invalidateModelDiscoveryCaches).toHaveBeenCalledTimes(1);
    });
  });

  describe('DELETE /', () => {
    it('should delete all keys when all=true', async () => {
      deleteUserKey.mockResolvedValue({});

      const response = await request(app).delete('/api/keys?all=true');

      expect(response.status).toBe(204);
      expect(deleteUserKey).toHaveBeenCalledWith({
        userId: 'test-user-123',
        all: true,
      });
      expect(invalidateModelDiscoveryCaches).toHaveBeenCalledTimes(1);
    });

    it('should return 400 when all query param is not true', async () => {
      const response = await request(app).delete('/api/keys');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Specify either all=true to delete.' });
      expect(deleteUserKey).not.toHaveBeenCalled();
      expect(invalidateModelDiscoveryCaches).not.toHaveBeenCalled();
    });
  });

  describe('GET /', () => {
    it('should return key expiry for a given key name', async () => {
      const mockExpiry = { expiresAt: '2026-12-31' };
      getUserKeyExpiry.mockResolvedValue(mockExpiry);

      const response = await request(app).get('/api/keys?name=openAI');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockExpiry);
      expect(getUserKeyExpiry).toHaveBeenCalledWith({
        userId: 'test-user-123',
        name: 'openAI',
      });
    });

    it('should include the decrypted key value when explicitly requested', async () => {
      getUserKeyExpiry.mockResolvedValue({ expiresAt: 'never' });
      getUserKey.mockResolvedValue('{"apiKey":"saved-key"}');

      const response = await request(app).get('/api/keys?name=openAI&includeValue=true');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        expiresAt: 'never',
        value: '{"apiKey":"saved-key"}',
      });
      expect(getUserKey).toHaveBeenCalledWith({
        userId: 'test-user-123',
        name: 'openAI',
      });
    });

    it('should not fetch the decrypted key when no key exists', async () => {
      getUserKeyExpiry.mockResolvedValue({ expiresAt: null });

      const response = await request(app).get('/api/keys?name=openAI&includeValue=true');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ expiresAt: null });
      expect(getUserKey).not.toHaveBeenCalled();
    });
  });
});
