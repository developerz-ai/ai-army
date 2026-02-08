/**
 * Unit tests for BotRouter
 *
 * Tests the bot management API endpoints:
 * - GET  /api/bots              -> List all bots
 * - GET  /api/bots/:id          -> Get bot details
 * - POST /api/bots/:id/message  -> Send message to bot
 * - GET  /api/bots/:id/sessions -> List bot sessions
 * - GET  /api/bots/:id/status   -> Get bot status
 *
 * Also covers:
 * - Authentication (API key validation)
 * - Route matching (only handles /api/bots paths)
 * - Error handling
 * - Constructor validation
 * - JSON body parsing for POST
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { BotRouter, BotRouterError } from '../../../src/api/routers/bot-router.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock BotManager
 * @param {Object[]} [bots=[]] - Array of bot objects
 * @returns {Object} Mock BotManager
 */
function createMockBotManager(bots = []) {
  const botMap = new Map(bots.map(b => [b.id, b]));
  return {
    listBots: mock.fn(() => [...botMap.values()]),
    getBot: mock.fn(id => botMap.get(id)),
    startBot: mock.fn(async () => {}),
    stopBot: mock.fn(async () => {}),
    getBotCount: mock.fn(() => botMap.size),
  };
}

/**
 * Create a mock MessageProcessor
 * @param {Object} [response={}] - Default response from processMessage
 * @returns {Object} Mock MessageProcessor
 */
function createMockMessageProcessor(response = {}) {
  return {
    processMessage: mock.fn(async () => ({
      text: 'Hello, I can help with that!',
      sessionId: 'work-bot:rest:rest-api:user123',
      durationMs: 1500,
      usage: { promptTokens: 100, completionTokens: 50 },
      ...response,
    })),
  };
}

/**
 * Create a mock storage
 * @param {Object[]} [sessions=[]] - Sessions for listSessions
 * @returns {Object} Mock storage
 */
function createMockStorage(sessions = []) {
  return {
    listSessions: mock.fn(async () => sessions),
    getSession: mock.fn(async () => null),
  };
}

/**
 * Create a mock HTTP request
 * @param {Object} options - Request options
 * @returns {Object} Mock request
 */
function createMockRequest({ method = 'GET', url = '/', headers = {}, body = null } = {}) {
  const readable = new Readable({ read() {} });
  readable.method = method;
  readable.url = url;
  readable.headers = {
    host: 'localhost:3000',
    ...headers,
  };
  readable.socket = { remoteAddress: '127.0.0.1' };

  if (body) {
    const json = JSON.stringify(body);
    process.nextTick(() => {
      readable.push(json);
      readable.push(null);
    });
  } else {
    process.nextTick(() => readable.push(null));
  }

  return readable;
}

/**
 * Create a mock HTTP response that captures output
 * @returns {{ res: Object, getResponse: () => { statusCode: number, headers: Object, body: Object }}}
 */
function createMockResponse() {
  let statusCode;
  let responseHeaders = {};
  const chunks = [];

  const res = {
    writeHead(code, hdrs) {
      statusCode = code;
      responseHeaders = hdrs;
    },
    end(data) {
      if (data) chunks.push(data);
    },
    headersSent: false,
  };

  return {
    res,
    getResponse() {
      const raw = chunks.join('');
      return {
        statusCode,
        headers: responseHeaders,
        body: raw ? JSON.parse(raw) : null,
      };
    },
  };
}

const sampleBots = [
  {
    id: 'work-bot',
    status: 'running',
    config: { model: 'gpt-4', provider: 'openai', channels: ['slack'] },
    tools: { search: {}, calendar: {} },
    soulContent: 'You are a helpful work assistant.',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastActiveAt: '2026-02-06T10:00:00.000Z',
  },
  {
    id: 'support-bot',
    status: 'stopped',
    config: { model: 'claude-3', provider: 'anthropic', channels: ['discord', 'rest'] },
    tools: null,
    soulContent: null,
    createdAt: '2026-01-15T00:00:00.000Z',
    lastActiveAt: null,
  },
];

// ============================================================================
// Tests
// ============================================================================

describe('BotRouter', () => {
  /** @type {Object} */
  let mockBotManager;
  /** @type {BotRouter} */
  let router;

  beforeEach(() => {
    mockBotManager = createMockBotManager(sampleBots);
    router = new BotRouter({ botManager: mockBotManager });
  });

  // --------------------------------------------------------------------------
  // Constructor
  // --------------------------------------------------------------------------

  describe('constructor', () => {
    test('creates instance with botManager', () => {
      const r = new BotRouter({ botManager: mockBotManager });
      assert.equal(r.botManager, mockBotManager);
    });

    test('throws without botManager', () => {
      assert.throws(
        () => new BotRouter(),
        err => err instanceof BotRouterError && err.endpoint === 'constructor'
      );
    });

    test('throws with explicit null botManager', () => {
      assert.throws(
        () => new BotRouter({ botManager: null }),
        err => err instanceof BotRouterError
      );
    });

    test('accepts optional dependencies', () => {
      const logger = mock.fn();
      const messageProcessor = createMockMessageProcessor();
      const storage = createMockStorage();
      const r = new BotRouter({
        botManager: mockBotManager,
        messageProcessor,
        storage,
        logger,
        apiKey: 'test-key',
      });
      assert.equal(r.logger, logger);
      assert.equal(r.messageProcessor, messageProcessor);
      assert.equal(r.storage, storage);
      assert.equal(r.apiKey, 'test-key');
    });

    test('defaults logger to null', () => {
      const r = new BotRouter({ botManager: mockBotManager });
      assert.equal(r.logger, null);
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/bots
  // --------------------------------------------------------------------------

  describe('GET /api/bots', () => {
    test('returns list of all bots', async () => {
      const req = createMockRequest({ method: 'GET', url: '/api/bots' });
      const { res, getResponse } = createMockResponse();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.count, 2);
      assert.equal(response.body.data.length, 2);
      assert.equal(response.body.data[0].id, 'work-bot');
      assert.equal(response.body.data[0].status, 'running');
      assert.equal(response.body.data[1].id, 'support-bot');
    });

    test('returns empty list when no bots', async () => {
      router = new BotRouter({ botManager: createMockBotManager([]) });
      const req = createMockRequest({ method: 'GET', url: '/api/bots' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.count, 0);
      assert.deepEqual(response.body.data, []);
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/bots/:id
  // --------------------------------------------------------------------------

  describe('GET /api/bots/:id', () => {
    test('returns bot details', async () => {
      const req = createMockRequest({ method: 'GET', url: '/api/bots/work-bot' });
      const { res, getResponse } = createMockResponse();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.id, 'work-bot');
      assert.equal(response.body.status, 'running');
      assert.equal(response.body.model, 'gpt-4');
      assert.equal(response.body.provider, 'openai');
      assert.deepEqual(response.body.tools, ['search', 'calendar']);
      assert.equal(response.body.soulContent, true);
    });

    test('returns 404 for unknown bot', async () => {
      const req = createMockRequest({ method: 'GET', url: '/api/bots/unknown' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 404);
      assert.equal(response.body.error, 'Not Found');
    });

    test('handles bot with null config fields', async () => {
      const req = createMockRequest({ method: 'GET', url: '/api/bots/support-bot' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.soulContent, false);
      assert.deepEqual(response.body.tools, []);
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/bots/:id/message
  // --------------------------------------------------------------------------

  describe('POST /api/bots/:id/message', () => {
    test('sends message and returns response', async () => {
      const messageProcessor = createMockMessageProcessor();
      router = new BotRouter({ botManager: mockBotManager, messageProcessor });

      const req = createMockRequest({
        method: 'POST',
        url: '/api/bots/work-bot/message',
        headers: { 'content-type': 'application/json' },
        body: { userId: 'user123', text: 'What tasks do I have?' },
      });
      const { res, getResponse } = createMockResponse();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.text, 'Hello, I can help with that!');
      assert.ok(response.body.sessionId);
      assert.ok(response.body.durationMs);
    });

    test('returns 503 when messageProcessor not available', async () => {
      const req = createMockRequest({
        method: 'POST',
        url: '/api/bots/work-bot/message',
        headers: { 'content-type': 'application/json' },
        body: { userId: 'user123', text: 'Hello' },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 503);
      assert.equal(response.body.error, 'Service Unavailable');
    });

    test('returns 404 for unknown bot', async () => {
      const messageProcessor = createMockMessageProcessor();
      router = new BotRouter({ botManager: mockBotManager, messageProcessor });

      const req = createMockRequest({
        method: 'POST',
        url: '/api/bots/unknown/message',
        headers: { 'content-type': 'application/json' },
        body: { userId: 'user123', text: 'Hello' },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 404);
    });

    test('returns 400 when userId missing', async () => {
      const messageProcessor = createMockMessageProcessor();
      router = new BotRouter({ botManager: mockBotManager, messageProcessor });

      const req = createMockRequest({
        method: 'POST',
        url: '/api/bots/work-bot/message',
        headers: { 'content-type': 'application/json' },
        body: { text: 'Hello' },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.error, 'Bad Request');
    });

    test('returns 400 when text missing', async () => {
      const messageProcessor = createMockMessageProcessor();
      router = new BotRouter({ botManager: mockBotManager, messageProcessor });

      const req = createMockRequest({
        method: 'POST',
        url: '/api/bots/work-bot/message',
        headers: { 'content-type': 'application/json' },
        body: { userId: 'user123' },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 400);
    });

    test('returns 500 when processMessage fails', async () => {
      const messageProcessor = {
        processMessage: mock.fn(async () => {
          throw new Error('LLM timeout');
        }),
      };
      router = new BotRouter({
        botManager: mockBotManager,
        messageProcessor,
        logger: mock.fn(),
      });

      const req = createMockRequest({
        method: 'POST',
        url: '/api/bots/work-bot/message',
        headers: { 'content-type': 'application/json' },
        body: { userId: 'user123', text: 'Hello' },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 500);
      assert.ok(response.body.message.includes('LLM timeout'));
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/bots/:id/sessions
  // --------------------------------------------------------------------------

  describe('GET /api/bots/:id/sessions', () => {
    test('returns bot sessions', async () => {
      const sessions = [
        {
          id: 'work-bot:slack:ch1:user1',
          botId: 'work-bot',
          userId: 'user1',
          channelId: 'ch1',
          channelType: 'slack',
          messages: [{ role: 'user', content: 'hi' }],
          tokenCount: 100,
          createdAt: '2026-02-01T00:00:00.000Z',
          lastMessageAt: '2026-02-06T10:00:00.000Z',
        },
      ];
      const storage = createMockStorage(sessions);
      router = new BotRouter({ botManager: mockBotManager, storage });

      const req = createMockRequest({ method: 'GET', url: '/api/bots/work-bot/sessions' });
      const { res, getResponse } = createMockResponse();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.count, 1);
      assert.equal(response.body.botId, 'work-bot');
      assert.equal(response.body.data[0].messageCount, 1);
    });

    test('returns 404 for unknown bot', async () => {
      const storage = createMockStorage();
      router = new BotRouter({ botManager: mockBotManager, storage });

      const req = createMockRequest({ method: 'GET', url: '/api/bots/unknown/sessions' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 404);
    });

    test('returns 503 when storage not available', async () => {
      const req = createMockRequest({ method: 'GET', url: '/api/bots/work-bot/sessions' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 503);
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/bots/:id/status
  // --------------------------------------------------------------------------

  describe('GET /api/bots/:id/status', () => {
    test('returns bot status', async () => {
      const req = createMockRequest({ method: 'GET', url: '/api/bots/work-bot/status' });
      const { res, getResponse } = createMockResponse();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.id, 'work-bot');
      assert.equal(response.body.status, 'running');
    });

    test('returns 404 for unknown bot', async () => {
      const req = createMockRequest({ method: 'GET', url: '/api/bots/unknown/status' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 404);
    });
  });

  // --------------------------------------------------------------------------
  // Authentication
  // --------------------------------------------------------------------------

  describe('authentication', () => {
    test('rejects request when apiKey configured and no auth header', async () => {
      router = new BotRouter({ botManager: mockBotManager, apiKey: 'secret123' });
      const req = createMockRequest({ method: 'GET', url: '/api/bots' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 401);
    });

    test('rejects request with wrong API key', async () => {
      router = new BotRouter({ botManager: mockBotManager, apiKey: 'secret123' });
      const req = createMockRequest({
        method: 'GET',
        url: '/api/bots',
        headers: { authorization: 'Bearer wrong-key' },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 401);
    });

    test('allows request with correct API key', async () => {
      router = new BotRouter({ botManager: mockBotManager, apiKey: 'secret123' });
      const req = createMockRequest({
        method: 'GET',
        url: '/api/bots',
        headers: { authorization: 'Bearer secret123' },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
    });

    test('allows all requests when no apiKey configured', async () => {
      const req = createMockRequest({ method: 'GET', url: '/api/bots' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
    });
  });

  // --------------------------------------------------------------------------
  // Route matching
  // --------------------------------------------------------------------------

  describe('route matching', () => {
    test('returns false for non-matching paths', async () => {
      const req = createMockRequest({ method: 'GET', url: '/api/admin/status' });
      const { res } = createMockResponse();

      const handled = await router.handleRequest(req, res);
      assert.equal(handled, false);
    });

    test('returns false for empty method', async () => {
      const req = createMockRequest({ method: '', url: '/api/bots' });
      const { res } = createMockResponse();

      const handled = await router.handleRequest(req, res);
      assert.equal(handled, false);
    });

    test('returns false for PUT /api/bots/:id (unregistered method)', async () => {
      const req = createMockRequest({ method: 'PUT', url: '/api/bots/work-bot' });
      const { res } = createMockResponse();

      const handled = await router.handleRequest(req, res);
      assert.equal(handled, false);
    });
  });

  // --------------------------------------------------------------------------
  // BotRouterError
  // --------------------------------------------------------------------------

  describe('BotRouterError', () => {
    test('creates error with correct name and fields', () => {
      const cause = new Error('root');
      const err = new BotRouterError('test error', {
        cause,
        endpoint: '/api/bots',
        statusCode: 500,
      });
      assert.equal(err.name, 'BotRouterError');
      assert.equal(err.message, 'test error');
      assert.equal(err.endpoint, '/api/bots');
      assert.equal(err.statusCode, 500);
      assert.equal(err.cause, cause);
    });
  });
});
