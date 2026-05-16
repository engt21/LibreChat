const fs = require('fs');
const http = require('http');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { stopScheduledJobRunner } = require('~/server/services/ScheduledJobs/runner');
const {
  stopAudioTranscriptionRunner,
} = require('~/server/services/Files/Audio/transcriptionQueue');

jest.mock('~/server/services/Config', () => ({
  loadCustomConfig: jest.fn(() => Promise.resolve({})),
  getAppConfig: jest.fn().mockResolvedValue({
    paths: {
      uploads: '/tmp',
      dist: '/tmp/dist',
      fonts: '/tmp/fonts',
      assets: '/tmp/assets',
    },
    fileStrategy: 'local',
    imageOutputType: 'PNG',
  }),
  setCachedTools: jest.fn(),
}));

jest.mock('~/app/clients/tools', () => ({
  createOpenAIImageTools: jest.fn(() => []),
  createYouTubeTools: jest.fn(() => []),
  manifestToolMap: {},
  toolkits: [],
}));

jest.mock('~/config', () => ({
  createMCPServersRegistry: jest.fn(),
  createMCPManager: jest.fn().mockResolvedValue({
    getAppToolFunctions: jest.fn().mockResolvedValue({}),
  }),
}));

describe('Server Configuration', () => {
  // Increase the default timeout to allow for Mongo cleanup
  jest.setTimeout(30_000);

  let mongoServer;
  let app;

  /** Mocked fs.readFileSync for index.html */
  const originalReadFileSync = fs.readFileSync;
  beforeAll(() => {
    fs.readFileSync = function (filepath, options) {
      if (filepath.includes('index.html')) {
        return '<!DOCTYPE html><html><head><title>LibreChat</title></head><body><div id="root"></div></body></html>';
      }
      return originalReadFileSync(filepath, options);
    };
  });

  afterAll(() => {
    // Restore original fs.readFileSync
    fs.readFileSync = originalReadFileSync;
  });

  beforeAll(async () => {
    // Create the required directories and files for the test
    const fs = require('fs');
    const path = require('path');

    const dirs = ['/tmp/dist', '/tmp/fonts', '/tmp/assets'];
    dirs.forEach((dir) => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });

    fs.writeFileSync(
      path.join('/tmp/dist', 'index.html'),
      '<!DOCTYPE html><html><head><title>LibreChat</title></head><body><div id="root"></div></body></html>',
    );

    mongoServer = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongoServer.getUri();
    process.env.PORT = '0'; // Use a random available port
    app = require('~/server');

    // Wait for the app to be healthy
    await healthCheckPoll(app);
  });

  afterAll(async () => {
    // Stop background runners before tearing down Mongo to prevent
    // MongoNotConnectedError from in-flight polling ticks.
    // Drain the audio transcription runner so any in-flight work
    // settles before the Mongo connection is torn down.
    stopScheduledJobRunner();
    await stopAudioTranscriptionRunner({ drain: true });

    // Close the HTTP server so the listening socket is released.
    const httpServer = app?.server;
    if (httpServer && typeof httpServer.close === 'function') {
      await new Promise((resolve) => httpServer.close(resolve));
    }

    await mongoose.disconnect();
    await mongoServer.stop();
  });

  it('should return OK for /health', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.text).toBe('OK');
  });

  it('should not cache index page', async () => {
    const response = await request(app).get('/');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-cache, no-store, must-revalidate');
    expect(response.headers['pragma']).toBe('no-cache');
    expect(response.headers['expires']).toBe('0');
  });

  it('should return 404 JSON for undefined API routes', async () => {
    const response = await request(app).get('/api/nonexistent');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'Endpoint not found' });
  });

  it('should return 404 JSON for nested undefined API routes', async () => {
    const response = await request(app).get('/api/nonexistent/nested/path');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'Endpoint not found' });
  });

  it('should return 404 JSON for non-GET methods on undefined API routes', async () => {
    const post = await request(app).post('/api/nonexistent');
    expect(post.status).toBe(404);
    expect(post.body).toEqual({ message: 'Endpoint not found' });

    const del = await request(app).delete('/api/nonexistent');
    expect(del.status).toBe(404);
    expect(del.body).toEqual({ message: 'Endpoint not found' });
  });

  it('should return 404 JSON for the /api root path', async () => {
    const response = await request(app).get('/api');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'Endpoint not found' });
  });

  it('should serve SPA HTML for non-API unmatched routes', async () => {
    const response = await request(app).get('/this/does/not/exist');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/html/);
  });

  it('should return 500 for unknown errors via ErrorController', async () => {
    // Testing the error handling here on top of unit tests to ensure the middleware is correctly integrated

    // Mock MongoDB operations to fail
    const originalFindOne = mongoose.models.User.findOne;
    const mockError = new Error('MongoDB operation failed');
    mongoose.models.User.findOne = jest.fn().mockImplementation(() => {
      throw mockError;
    });

    try {
      const response = await request(app).post('/api/auth/login').send({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(response.status).toBe(500);
      expect(response.text).toBe('An unknown error occurred.');
    } finally {
      // Restore original function
      mongoose.models.User.findOne = originalFindOne;
    }
  });

  describe('Realtime WebSocket Broker', () => {
    /** Helper: send a raw HTTP upgrade request and collect the response */
    function sendUpgrade(path) {
      return new Promise((resolve, reject) => {
        const addr = app.server.address();
        const req = http.request({
          hostname:
            addr.address === '::' || addr.address === '0.0.0.0' ? '127.0.0.1' : addr.address,
          port: addr.port,
          path,
          headers: {
            Connection: 'Upgrade',
            Upgrade: 'websocket',
            'Sec-WebSocket-Version': '13',
            'Sec-WebSocket-Key': Buffer.from('test-ws-key-1234').toString('base64'),
          },
        });

        req.on('response', (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
        });

        req.on('upgrade', (_res, socket) => {
          // If upgraded, close immediately — this shouldn't happen for unauthenticated requests
          socket.destroy();
          resolve({ statusCode: 101, upgraded: true });
        });

        req.on('error', (err) => {
          // Connection reset / destroyed by server is expected for non-realtime paths
          resolve({ statusCode: null, error: err.code || err.message });
        });

        req.end();
      });
    }

    it('should have a WebSocket upgrade listener on the HTTP server', () => {
      const httpServer = app.server;
      expect(httpServer).toBeDefined();
      const upgradeListeners = httpServer.listeners('upgrade');
      expect(upgradeListeners.length).toBeGreaterThan(0);
    });

    it('should reject unauthenticated WebSocket upgrades to /api/realtime/ws with 401', async () => {
      const result = await sendUpgrade('/api/realtime/ws');
      expect(result.statusCode).toBe(401);
    });

    it('should destroy WebSocket upgrade attempts to non-realtime paths', async () => {
      const result = await sendUpgrade('/api/some/other/path');
      // The broker destroys the socket for non-realtime paths, which causes a connection reset
      expect([null, 'ECONNRESET']).toContain(
        result.error || (result.statusCode === null ? null : undefined),
      );
    });
  });
});

// Polls the /health endpoint every 30ms for up to 10 seconds to wait for the server to start completely
async function healthCheckPoll(app, retries = 0) {
  const maxRetries = Math.floor(10000 / 30); // 10 seconds / 30ms
  try {
    const response = await request(app).get('/health');
    if (response.status === 200) {
      return; // App is healthy
    }
  } catch {
    // Ignore connection errors during polling
  }

  if (retries < maxRetries) {
    await new Promise((resolve) => setTimeout(resolve, 30));
    await healthCheckPoll(app, retries + 1);
  } else {
    throw new Error('App did not become healthy within 10 seconds.');
  }
}
