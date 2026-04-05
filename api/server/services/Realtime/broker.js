const { logger } = require('@librechat/data-schemas');
const { EModelEndpoint } = require('librechat-data-provider');
const { WebSocketServer, WebSocket } = require('ws');
const { getAppConfig } = require('~/server/services/Config/app');
const { authenticateRealtimeRequest } = require('./auth');
const { resolveRealtimeSessionConfig, validateRealtimeModelAccess } = require('./modelService');
const GeminiRealtimeAdapter = require('./providers/GeminiRealtimeAdapter');
const OpenAILikeRealtimeAdapter = require('./providers/OpenAILikeRealtimeAdapter');

function safeSend(socket, event) {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(event));
}

function createAdapter({ providerConfig, instructions, voice, onEvent }) {
  if (providerConfig.provider === 'google') {
    return new GeminiRealtimeAdapter({
      clientOptions: providerConfig.clientOptions,
      apiKey: providerConfig.apiKey,
      model: providerConfig.model,
      audioConfig: providerConfig.audioConfig,
      instructions,
      voice,
      onEvent,
    });
  }

  return new OpenAILikeRealtimeAdapter({
    provider: providerConfig.provider,
    wsURL: providerConfig.wsURL,
    headers: providerConfig.headers,
    audioConfig: providerConfig.audioConfig,
    instructions,
    voice,
    transcriptionModel: providerConfig.transcriptionModel,
    onEvent,
  });
}

async function handleConnection(socket, req, user) {
  let adapter = null;

  const closeAdapter = () => {
    if (!adapter) {
      return;
    }

    adapter.close();
    adapter = null;
  };

  const handleAdapterEvent = (event) => {
    if (event?.type === 'session.closed') {
      adapter = null;
    }

    safeSend(socket, event);
  };

  socket.on('message', async (payload) => {
    let event;

    try {
      event = JSON.parse(payload.toString());
    } catch {
      safeSend(socket, { type: 'error', message: 'Invalid realtime client message.' });
      return;
    }

    try {
      switch (event?.type) {
        case 'session.start': {
          closeAdapter();

          const endpoint = event.endpoint;
          const model = event.model;

          if (!endpoint) {
            throw new Error('Realtime session.start requires an endpoint.');
          }

          if (!model && endpoint === EModelEndpoint.openAI) {
            throw new Error('Realtime session.start requires a model.');
          }

          if (!model && endpoint === EModelEndpoint.azureOpenAI) {
            throw new Error('Realtime session.start requires a model.');
          }

          if (!model && endpoint === EModelEndpoint.google) {
            throw new Error('Realtime session.start requires a model.');
          }

          const appConfig = await getAppConfig({ role: user.role });
          const providerConfig = await resolveRealtimeSessionConfig({
            req: { user },
            appConfig,
            endpoint,
            model,
          });

          // Validate against the resolved model so providers that legitimately
          // resolve a default model server-side (e.g. xAI) are not rejected
          // prematurely when the client omits `model`.
          validateRealtimeModelAccess({
            user,
            endpoint,
            model: providerConfig.model,
          });

          adapter = createAdapter({
            providerConfig,
            instructions: event.instructions || 'You are a helpful assistant.',
            voice: event.voice,
            onEvent: handleAdapterEvent,
          });

          await adapter.connect();

          safeSend(socket, {
            type: 'session.started',
            endpoint: providerConfig.endpoint,
            provider: providerConfig.provider,
            model: providerConfig.model,
            audioConfig: providerConfig.audioConfig,
          });
          break;
        }
        case 'session.update':
          adapter?.updateSession(event);
          break;
        case 'session.stop':
          closeAdapter();
          safeSend(socket, { type: 'session.stopped' });
          break;
        case 'input_audio_buffer.append':
          adapter?.appendInputAudio(event.audio);
          break;
        case 'input_audio_buffer.commit':
          adapter?.commitInputAudio();
          break;
        case 'input_audio_buffer.clear':
          adapter?.clearInputAudio();
          break;
        case 'conversation.text':
          adapter?.sendText(event.text || '');
          break;
        case 'response.cancel':
          adapter?.cancelResponse();
          break;
        default:
          safeSend(socket, {
            type: 'error',
            message: `Unsupported realtime client event: ${event?.type || 'unknown'}`,
          });
      }
    } catch (error) {
      logger.error('[realtime] Client event failed', error);
      safeSend(socket, {
        type: 'error',
        message: error.message || 'Realtime request failed.',
      });
    }
  });

  socket.on('close', () => {
    closeAdapter();
  });
}

function initializeRealtimeServer(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (req, socket, head) => {
    const origin = `http://${req.headers.host || 'localhost'}`;
    const requestURL = new URL(req.url, origin);

    if (!requestURL.pathname.endsWith('/api/realtime/ws')) {
      socket.destroy();
      return;
    }

    try {
      const user = await authenticateRealtimeRequest(req);
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req, user);
      });
    } catch (error) {
      logger.warn('[realtime] Upgrade rejected', error.message);
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
    }
  });

  wss.on('connection', (socket, req, user) => {
    handleConnection(socket, req, user).catch((error) => {
      logger.error('[realtime] Connection setup failed', error);
      safeSend(socket, {
        type: 'error',
        message: error.message || 'Failed to initialize realtime session.',
      });
      socket.close(1011, 'Realtime initialization failed');
    });
  });

  return wss;
}

module.exports = {
  initializeRealtimeServer,
};
