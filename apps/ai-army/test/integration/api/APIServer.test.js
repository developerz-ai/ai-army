/**
 * Integration tests for APIServer
 *
 * Tests the complete HTTP API server with real network requests:
 * - Full HTTP request/response cycle over TCP
 * - Integration with BotRouter and SessionRouter
 * - Real authentication and rate limiting
 * - Concurrent request handling
 * - Multi-step workflows
 * - Error handling across the full stack
 *
 * Unlike unit tests that mock req/res, these tests exercise:
 * TCP connection → HTTP parsing → routing → middleware → handlers → response
 *
 * Run with: npm run test:integration
 */

import { describe, test, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { APIServer } from '../../../src/api/api-server.js';
import { BotRouter } from '../../../src/api/routers/bot-router.js';
import { SessionRouter } from '../../../src/api/routers/session-router.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Get a random available port
 * @returns {Promise<number>} Available port
 */
function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, () => {
      const { port } = server.address();
      server.close(err => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

/**
 * Send an HTTP request to the test server
 * @param {Object} options - Request options
 * @param {number} options.port - Server port
 * @param {string} [options.method='GET'] - HTTP method
 * @param {string} [options.path='/'] - Request path
 * @param {Object} [options.headers={}] - Request headers
 * @param {string|Object} [options.body] - Request body
 * @returns {Promise<{statusCode: number, headers: Object, body: Object|string}>}
 */
function sendRequest({ port, method = 'GET', path = '/', headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const reqHeaders = { ...headers };
    let bodyStr;

    if (body && typeof body === 'object') {
      bodyStr = JSON.stringify(body);
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(bodyStr);
    } else if (body) {
      bodyStr = body;
    }

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: reqHeaders,
      },
      res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch (_e) {
            parsed = raw;
          }
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: parsed,
          });
        });
      }
    );

    req.on('error', reject);

    if (bodyStr) {
      req.write(bodyStr);
    }
    req.end();
  });
}

/**
 * Create a mock bot object
 * @param {Object} [overrides] - Override default properties
 * @returns {Object} Mock bot
 */
function createMockBot(overrides = {}) {
  return {
    id: overrides.id || 'test-bot',
    status: overrides.status || 'running',
    config: {
      id: overrides.id || 'test-bot',
      model: 'claude-haiku-4-5',
      provider: 'anthropic',
      channels: ['rest'],
      ...overrides.config,
    },
    tools: overrides.tools || {},
    soulContent: overrides.soulContent !== undefined ? overrides.soulContent : '# Test Bot',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    lastActiveAt: new Date('2025-01-02T00:00:00Z'),
  };
}

/**
 * Create a mock BotManager with stateful bot tracking
 * @param {Object[]} [bots] - Initial bots
 * @returns {Object} Mock BotManager
 */
function createMockBotManager(bots = [createMockBot()]) {
  const botMap = new Map(bots.map(b => [b.id, b]));
  return {
    getBot: mock.fn(botId => botMap.get(botId)),
    listBots: mock.fn(() => Array.from(botMap.values())),
    getBotCount: mock.fn(() => botMap.size),
    _botMap: botMap,
  };
}

/**
 * Create a mock MessageProcessor
 * @returns {Object} Mock MessageProcessor
 */
function createMockMessageProcessor() {
  return {
    processMessage: mock.fn(async (_botConfig, message) => ({
      text: 'Hello! How can I help you?',
      sessionId: `test-bot:rest:rest-api:${message.userId}`,
      durationMs: 1234,
      usage: { promptTokens: 100, completionTokens: 50 },
    })),
  };
}

/**
 * Create a mock SessionManager
 * @returns {Object} Mock SessionManager
 */
function createMockSessionManager() {
  const sessions = new Map();

  return {
    getSessionStats: mock.fn(session => ({
      messageCount: (session?.messages || []).length,
      tokenCount: session?.tokenCount || 0,
      compactionCount: session?.compactionCount || 0,
      userMessageCount: (session?.messages || []).filter(m => m.role === 'user').length,
      assistantMessageCount: (session?.messages || []).filter(m => m.role === 'assistant').length,
      systemMessageCount: 0,
      hasToolCalls: false,
      createdAt: session?.createdAt,
      lastMessageAt: session?.lastMessageAt,
    })),
    deleteSession: mock.fn(async sessionId => {
      const existed = sessions.has(sessionId);
      sessions.delete(sessionId);
      return existed;
    }),
    _sessions: sessions,
  };
}

/**
 * Create a mock Storage
 * @returns {Object} Mock Storage
 */
function createMockStorage() {
  const sessions = new Map();

  // Add a default test session
  sessions.set('session-123', {
    id: 'session-123',
    botId: 'test-bot',
    userId: 'user-456',
    channelId: 'rest-api',
    channelType: 'rest',
    messages: [
      { role: 'user', content: 'Hello', timestamp: new Date('2025-01-01T10:00:00Z') },
      { role: 'assistant', content: 'Hi there!', timestamp: new Date('2025-01-01T10:00:01Z') },
    ],
    tokenCount: 150,
    compactionCount: 0,
    createdAt: new Date('2025-01-01T10:00:00Z'),
    lastMessageAt: new Date('2025-01-01T10:00:01Z'),
  });

  return {
    getSession: mock.fn(async sessionId => sessions.get(sessionId) || null),
    listSessions: mock.fn(async (botId, options = {}) => {
      const allSessions = Array.from(sessions.values()).filter(s => s.botId === botId);
      let filtered = allSessions;

      if (options.since) {
        filtered = filtered.filter(s => new Date(s.createdAt) >= options.since);
      }

      return filtered.slice(0, options.limit || 100);
    }),
    _sessions: sessions,
  };
}

// ============================================================================
// Integration Tests
// ============================================================================

describe('APIServer Integration', () => {
  /** @type {APIServer} */
  let server;
  /** @type {number} */
  let port;

  after(async () => {
    if (server && server.running) {
      await server.stop();
    }
  });

  // ==========================================================================
  // Full Request Lifecycle
  // ==========================================================================

  describe('full request lifecycle', () => {
    test('handles request through complete stack', async () => {
      const botManager = createMockBotManager();
      const botRouter = new BotRouter({
        botManager,
        logger: null,
        apiKey: null, // No auth for this test
      });

      server = new APIServer({
        routers: [botRouter],
        logger: null,
      });

      port = await getAvailablePort();
      await server.start(port);

      const response = await sendRequest({
        port,
        path: '/api/bots',
      });

      assert.equal(response.statusCode, 200);
      assert.ok(response.body.data);
      assert.equal(response.body.count, 1);
      assert.equal(response.body.data[0].id, 'test-bot');
      assert.ok(botManager.listBots.mock.callCount() >= 1);

      await server.stop();
    });

    test('processes POST request with JSON body through full stack', async () => {
      const botManager = createMockBotManager();
      const messageProcessor = createMockMessageProcessor();
      const botRouter = new BotRouter({
        botManager,
        messageProcessor,
        logger: null,
        apiKey: null,
      });

      server = new APIServer({
        routers: [botRouter],
        logger: null,
      });

      port = await getAvailablePort();
      await server.start(port);

      const response = await sendRequest({
        port,
        method: 'POST',
        path: '/api/bots/test-bot/message',
        body: {
          userId: 'user-123',
          text: 'Hello bot!',
        },
      });

      assert.equal(response.statusCode, 200);
      assert.equal(response.body.text, 'Hello! How can I help you?');
      assert.ok(response.body.sessionId);
      assert.ok(messageProcessor.processMessage.mock.callCount() >= 1);

      await server.stop();
    });
  });

  // ==========================================================================
  // Authentication Integration
  // ==========================================================================

  describe('authentication integration', () => {
    test('enforces authentication across all routers', async () => {
      const botManager = createMockBotManager();
      const botRouter = new BotRouter({
        botManager,
        logger: null,
        apiKey: 'secret-key-123456',
      });

      server = new APIServer({
        routers: [botRouter],
        logger: null,
      });

      port = await getAvailablePort();
      await server.start(port);

      // Request without auth should fail
      const unauthorized = await sendRequest({
        port,
        path: '/api/bots',
      });

      assert.equal(unauthorized.statusCode, 401);
      assert.equal(unauthorized.body.error, 'Unauthorized');

      // Request with valid auth should succeed
      const authorized = await sendRequest({
        port,
        path: '/api/bots',
        headers: { Authorization: 'Bearer secret-key-123456' },
      });

      assert.equal(authorized.statusCode, 200);
      assert.ok(authorized.body.data);

      await server.stop();
    });
  });

  // ==========================================================================
  // Rate Limiting Integration
  // ==========================================================================

  describe('rate limiting integration', () => {
    test('applies rate limits across all endpoints', async () => {
      const botManager = createMockBotManager();
      const botRouter = new BotRouter({
        botManager,
        logger: null,
        apiKey: null,
      });

      server = new APIServer({
        routers: [botRouter],
        rateLimit: { max: 3, windowMs: 60000 },
        logger: null,
      });

      port = await getAvailablePort();
      await server.start(port);

      // First 3 requests should succeed
      const res1 = await sendRequest({ port, path: '/api/bots' });
      assert.equal(res1.statusCode, 200);

      const res2 = await sendRequest({ port, path: '/api/bots' });
      assert.equal(res2.statusCode, 200);

      const res3 = await sendRequest({ port, path: '/api/bots' });
      assert.equal(res3.statusCode, 200);

      // 4th request should be rate limited
      const res4 = await sendRequest({ port, path: '/api/bots' });
      assert.equal(res4.statusCode, 429);
      assert.equal(res4.body.error, 'Too Many Requests');

      await server.stop();
    });
  });

  // ==========================================================================
  // Router Integration
  // ==========================================================================

  describe('router integration', () => {
    test('routes requests to correct router', async () => {
      const botManager = createMockBotManager();
      const sessionManager = createMockSessionManager();
      const storage = createMockStorage();

      const botRouter = new BotRouter({
        botManager,
        storage,
        logger: null,
        apiKey: null,
      });

      const sessionRouter = new SessionRouter({
        sessionManager,
        storage,
        logger: null,
        apiKey: null,
      });

      server = new APIServer({
        routers: [botRouter, sessionRouter],
        logger: null,
      });

      port = await getAvailablePort();
      await server.start(port);

      // BotRouter should handle /api/bots
      const botResponse = await sendRequest({
        port,
        path: '/api/bots',
      });
      assert.equal(botResponse.statusCode, 200);
      assert.ok(botManager.listBots.mock.callCount() >= 1);

      // SessionRouter should handle /api/sessions
      const sessionResponse = await sendRequest({
        port,
        path: '/api/sessions/session-123',
      });
      assert.equal(sessionResponse.statusCode, 200);
      assert.equal(sessionResponse.body.id, 'session-123');
      assert.ok(storage.getSession.mock.callCount() >= 1);

      await server.stop();
    });

    test('tries routers in order until one handles request', async () => {
      const botManager = createMockBotManager();
      const sessionManager = createMockSessionManager();
      const storage = createMockStorage();

      const botRouter = new BotRouter({
        botManager,
        storage,
        logger: null,
        apiKey: null,
      });

      const sessionRouter = new SessionRouter({
        sessionManager,
        storage,
        logger: null,
        apiKey: null,
      });

      // Add in different order
      server = new APIServer({
        routers: [sessionRouter, botRouter],
        logger: null,
      });

      port = await getAvailablePort();
      await server.start(port);

      // Should still route correctly
      const response = await sendRequest({
        port,
        path: '/api/bots',
      });
      assert.equal(response.statusCode, 200);

      await server.stop();
    });
  });

  // ==========================================================================
  // Multi-step Workflows
  // ==========================================================================

  describe('multi-step workflows', () => {
    test('handles message send then session retrieval', async () => {
      const botManager = createMockBotManager();
      const messageProcessor = createMockMessageProcessor();
      const sessionManager = createMockSessionManager();
      const storage = createMockStorage();

      const botRouter = new BotRouter({
        botManager,
        messageProcessor,
        storage,
        logger: null,
        apiKey: null,
      });

      const sessionRouter = new SessionRouter({
        sessionManager,
        storage,
        logger: null,
        apiKey: null,
      });

      server = new APIServer({
        routers: [botRouter, sessionRouter],
        logger: null,
      });

      port = await getAvailablePort();
      await server.start(port);

      // Step 1: Send message
      const messageResponse = await sendRequest({
        port,
        method: 'POST',
        path: '/api/bots/test-bot/message',
        body: {
          userId: 'user-123',
          text: 'Hello!',
        },
      });

      assert.equal(messageResponse.statusCode, 200);
      const { sessionId } = messageResponse.body;
      assert.ok(sessionId);

      // Step 2: Get session details (using the existing session from mock storage)
      const sessionResponse = await sendRequest({
        port,
        path: '/api/sessions/session-123',
      });

      assert.equal(sessionResponse.statusCode, 200);
      assert.equal(sessionResponse.body.id, 'session-123');

      await server.stop();
    });

    test('handles session deletion workflow', async () => {
      const storage = createMockStorage();
      const sessionManager = createMockSessionManager();

      // Override deleteSession to also remove from storage
      sessionManager.deleteSession = mock.fn(async sessionId => {
        const existed = storage._sessions.has(sessionId);
        storage._sessions.delete(sessionId);
        return existed;
      });

      const sessionRouter = new SessionRouter({
        sessionManager,
        storage,
        logger: null,
        apiKey: null,
      });

      server = new APIServer({
        routers: [sessionRouter],
        logger: null,
      });

      port = await getAvailablePort();
      await server.start(port);

      // Step 1: Verify session exists
      const getResponse = await sendRequest({
        port,
        path: '/api/sessions/session-123',
      });
      assert.equal(getResponse.statusCode, 200);

      // Step 2: Delete session
      const deleteResponse = await sendRequest({
        port,
        method: 'DELETE',
        path: '/api/sessions/session-123',
      });
      assert.equal(deleteResponse.statusCode, 200);
      assert.equal(deleteResponse.body.success, true);

      // Step 3: Verify session is deleted
      const getAfterDelete = await sendRequest({
        port,
        path: '/api/sessions/session-123',
      });
      assert.equal(getAfterDelete.statusCode, 404);

      await server.stop();
    });
  });

  // ==========================================================================
  // Concurrent Request Handling
  // ==========================================================================

  describe('concurrent request handling', () => {
    test('handles multiple concurrent GET requests', async () => {
      const botManager = createMockBotManager([
        createMockBot({ id: 'bot-1' }),
        createMockBot({ id: 'bot-2' }),
        createMockBot({ id: 'bot-3' }),
      ]);

      const botRouter = new BotRouter({
        botManager,
        logger: null,
        apiKey: null,
      });

      server = new APIServer({
        routers: [botRouter],
        logger: null,
      });

      port = await getAvailablePort();
      await server.start(port);

      // Send 10 concurrent requests
      const requests = Array.from({ length: 10 }, () =>
        sendRequest({
          port,
          path: '/api/bots',
        })
      );

      const responses = await Promise.all(requests);

      // All should succeed
      responses.forEach(response => {
        assert.equal(response.statusCode, 200);
        assert.equal(response.body.count, 3);
      });

      await server.stop();
    });

    test('handles mixed concurrent requests to different endpoints', async () => {
      const botManager = createMockBotManager();
      const sessionManager = createMockSessionManager();
      const storage = createMockStorage();

      const botRouter = new BotRouter({
        botManager,
        storage,
        logger: null,
        apiKey: null,
      });

      const sessionRouter = new SessionRouter({
        sessionManager,
        storage,
        logger: null,
        apiKey: null,
      });

      server = new APIServer({
        routers: [botRouter, sessionRouter],
        logger: null,
      });

      port = await getAvailablePort();
      await server.start(port);

      // Send concurrent requests to different endpoints
      const requests = [
        sendRequest({ port, path: '/api/bots' }),
        sendRequest({ port, path: '/api/bots/test-bot' }),
        sendRequest({ port, path: '/api/sessions/session-123' }),
        sendRequest({ port, path: '/api/sessions/session-123/messages' }),
        sendRequest({ port, path: '/api/bots' }),
      ];

      const responses = await Promise.all(requests);

      // All should succeed
      responses.forEach(response => {
        assert.equal(response.statusCode, 200);
      });

      await server.stop();
    });
  });

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('error handling', () => {
    test('returns 404 for non-existent routes', async () => {
      server = new APIServer({
        routers: [],
        logger: null,
      });

      port = await getAvailablePort();
      await server.start(port);

      const response = await sendRequest({
        port,
        path: '/api/nonexistent',
      });

      assert.equal(response.statusCode, 404);
      assert.equal(response.body.error, 'Not Found');

      await server.stop();
    });

    test('handles router errors gracefully', async () => {
      const botManager = createMockBotManager();
      // Make getBot throw an error
      botManager.getBot = mock.fn(() => {
        throw new Error('Database connection failed');
      });

      const botRouter = new BotRouter({
        botManager,
        logger: null,
        apiKey: null,
      });

      server = new APIServer({
        routers: [botRouter],
        logger: null,
      });

      port = await getAvailablePort();
      await server.start(port);

      const response = await sendRequest({
        port,
        path: '/api/bots/test-bot',
      });

      assert.equal(response.statusCode, 500);
      assert.equal(response.body.error, 'Internal Server Error');

      await server.stop();
    });
  });

  // ==========================================================================
  // CORS Integration
  // ==========================================================================

  describe('CORS integration', () => {
    test('handles CORS preflight requests', async () => {
      server = new APIServer({
        routers: [],
        logger: null,
      });

      port = await getAvailablePort();
      await server.start(port);

      const response = await sendRequest({
        port,
        method: 'OPTIONS',
        path: '/api/test',
        headers: {
          Origin: 'https://example.com',
          'Access-Control-Request-Method': 'POST',
        },
      });

      assert.equal(response.statusCode, 204);
      assert.ok(response.headers['access-control-allow-origin']);

      await server.stop();
    });

    test('sets CORS headers on all responses', async () => {
      const botManager = createMockBotManager();
      const botRouter = new BotRouter({
        botManager,
        logger: null,
        apiKey: null,
      });

      server = new APIServer({
        routers: [botRouter],
        logger: null,
      });

      port = await getAvailablePort();
      await server.start(port);

      const response = await sendRequest({
        port,
        path: '/api/bots',
      });

      assert.equal(response.statusCode, 200);
      assert.equal(response.headers['access-control-allow-origin'], '*');

      await server.stop();
    });
  });
});
