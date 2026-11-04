/**
 * Unit tests for SessionRouter
 *
 * Tests the session management API endpoints:
 * - GET    /api/sessions/:id          -> Get session details
 * - DELETE /api/sessions/:id          -> Delete a session
 * - GET    /api/sessions/:id/messages -> List session messages
 *
 * Also covers:
 * - Authentication (API key validation)
 * - Route matching (only handles /api/sessions paths)
 * - Error handling
 * - Constructor validation
 * - Pagination for messages
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { SessionRouter, SessionRouterError } from '../../../src/api/routers/session-router.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock SessionManager
 * @returns {Object} Mock SessionManager
 */
function createMockSessionManager() {
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
    deleteSession: mock.fn(async () => true),
    clearSession: mock.fn(async () => {}),
  };
}

/**
 * Create a mock storage
 * @param {Object|null} [session=null] - Session to return from getSession
 * @returns {Object} Mock storage
 */
function createMockStorage(session = null) {
  return {
    getSession: mock.fn(async () => session),
    listSessions: mock.fn(async () => []),
  };
}

/**
 * Create a mock HTTP request
 * @param {Object} options - Request options
 * @returns {Object} Mock request
 */
function createMockRequest({ method = 'GET', url = '/', headers = {} } = {}) {
  return {
    method,
    url,
    headers: {
      host: 'localhost:3000',
      ...headers,
    },
    socket: { remoteAddress: '127.0.0.1' },
  };
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

const sampleSession = {
  id: 'work-bot:slack:ch1:user1',
  botId: 'work-bot',
  userId: 'user1',
  channelId: 'ch1',
  channelType: 'slack',
  messages: [
    { role: 'user', content: 'Hello', timestamp: '2026-02-06T10:00:00.000Z' },
    { role: 'assistant', content: 'Hi there!', timestamp: '2026-02-06T10:00:01.000Z' },
    { role: 'user', content: 'How are you?', timestamp: '2026-02-06T10:00:02.000Z' },
  ],
  tokenCount: 150,
  compactionCount: 0,
  createdAt: '2026-02-01T00:00:00.000Z',
  lastMessageAt: '2026-02-06T10:00:02.000Z',
};

// ============================================================================
// Tests
// ============================================================================

describe('SessionRouter', () => {
  /** @type {Object} */
  let mockSessionManager;
  /** @type {Object} */
  let mockStorage;
  /** @type {SessionRouter} */
  let router;

  beforeEach(() => {
    mockSessionManager = createMockSessionManager();
    mockStorage = createMockStorage(sampleSession);
    router = new SessionRouter({
      sessionManager: mockSessionManager,
      storage: mockStorage,
    });
  });

  // --------------------------------------------------------------------------
  // Constructor
  // --------------------------------------------------------------------------

  describe('constructor', () => {
    test('creates instance with required deps', () => {
      const r = new SessionRouter({
        sessionManager: mockSessionManager,
        storage: mockStorage,
      });
      assert.equal(r.sessionManager, mockSessionManager);
      assert.equal(r.storage, mockStorage);
    });

    test('throws without sessionManager', () => {
      assert.throws(
        () => new SessionRouter({ storage: mockStorage }),
        err => err instanceof SessionRouterError && err.endpoint === 'constructor'
      );
    });

    test('throws without storage', () => {
      assert.throws(
        () => new SessionRouter({ sessionManager: mockSessionManager }),
        err => err instanceof SessionRouterError && err.endpoint === 'constructor'
      );
    });

    test('accepts optional logger and apiKey', () => {
      const logger = mock.fn();
      const r = new SessionRouter({
        sessionManager: mockSessionManager,
        storage: mockStorage,
        logger,
        apiKey: 'test-key',
      });
      assert.equal(r.logger, logger);
      assert.equal(r.apiKey, 'test-key');
    });

    test('defaults logger to null', () => {
      assert.equal(router.logger, null);
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/sessions/:id
  // --------------------------------------------------------------------------

  describe('GET /api/sessions/:id', () => {
    test('returns session details with stats', async () => {
      const req = createMockRequest({
        method: 'GET',
        url: '/api/sessions/work-bot:slack:ch1:user1',
      });
      const { res, getResponse } = createMockResponse();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.id, 'work-bot:slack:ch1:user1');
      assert.equal(response.body.botId, 'work-bot');
      assert.equal(response.body.tokenCount, 150);
      assert.ok(response.body.stats);
      assert.equal(response.body.stats.messageCount, 3);
    });

    test('returns 404 for unknown session', async () => {
      mockStorage = createMockStorage(null);
      router = new SessionRouter({
        sessionManager: mockSessionManager,
        storage: mockStorage,
      });

      const req = createMockRequest({ method: 'GET', url: '/api/sessions/unknown' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 404);
      assert.equal(response.body.error, 'Not Found');
    });

    test('returns 500 on storage error', async () => {
      mockStorage.getSession = mock.fn(async () => {
        throw new Error('DB connection failed');
      });
      router = new SessionRouter({
        sessionManager: mockSessionManager,
        storage: mockStorage,
        logger: mock.fn(),
      });

      const req = createMockRequest({ method: 'GET', url: '/api/sessions/test' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 500);
    });
  });

  // --------------------------------------------------------------------------
  // DELETE /api/sessions/:id
  // --------------------------------------------------------------------------

  describe('DELETE /api/sessions/:id', () => {
    test('deletes session successfully', async () => {
      const req = createMockRequest({
        method: 'DELETE',
        url: '/api/sessions/work-bot:slack:ch1:user1',
      });
      const { res, getResponse } = createMockResponse();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.success, true);
      assert.equal(mockSessionManager.deleteSession.mock.calls.length, 1);
    });

    test('returns 404 when session not found', async () => {
      mockSessionManager.deleteSession = mock.fn(async () => false);
      router = new SessionRouter({
        sessionManager: mockSessionManager,
        storage: mockStorage,
      });

      const req = createMockRequest({ method: 'DELETE', url: '/api/sessions/unknown' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 404);
    });

    test('returns 500 on delete error', async () => {
      mockSessionManager.deleteSession = mock.fn(async () => {
        throw new Error('Delete failed');
      });
      router = new SessionRouter({
        sessionManager: mockSessionManager,
        storage: mockStorage,
        logger: mock.fn(),
      });

      const req = createMockRequest({ method: 'DELETE', url: '/api/sessions/test' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 500);
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/sessions/:id/messages
  // --------------------------------------------------------------------------

  describe('GET /api/sessions/:id/messages', () => {
    test('returns all messages', async () => {
      const req = createMockRequest({
        method: 'GET',
        url: '/api/sessions/work-bot:slack:ch1:user1/messages',
      });
      const { res, getResponse } = createMockResponse();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.count, 3);
      assert.equal(response.body.total, 3);
      assert.equal(response.body.data.length, 3);
    });

    test('supports pagination with limit and offset', async () => {
      const req = createMockRequest({
        method: 'GET',
        url: '/api/sessions/work-bot:slack:ch1:user1/messages?limit=1&offset=1',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.count, 1);
      assert.equal(response.body.total, 3);
      assert.equal(response.body.data[0].content, 'Hi there!');
      assert.equal(response.body.limit, 1);
      assert.equal(response.body.offset, 1);
    });

    test('returns 404 for unknown session', async () => {
      mockStorage = createMockStorage(null);
      router = new SessionRouter({
        sessionManager: mockSessionManager,
        storage: mockStorage,
      });

      const req = createMockRequest({
        method: 'GET',
        url: '/api/sessions/unknown/messages',
      });
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
      router = new SessionRouter({
        sessionManager: mockSessionManager,
        storage: mockStorage,
        apiKey: 'secret123',
      });
      const req = createMockRequest({
        method: 'GET',
        url: '/api/sessions/test',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 401);
    });

    test('allows request with correct API key', async () => {
      router = new SessionRouter({
        sessionManager: mockSessionManager,
        storage: mockStorage,
        apiKey: 'secret123',
      });
      const req = createMockRequest({
        method: 'GET',
        url: '/api/sessions/work-bot:slack:ch1:user1',
        headers: { authorization: 'Bearer secret123' },
      });
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
      const req = createMockRequest({ method: 'GET', url: '/api/bots' });
      const { res } = createMockResponse();

      const handled = await router.handleRequest(req, res);
      assert.equal(handled, false);
    });

    test('returns false for empty method', async () => {
      const req = createMockRequest({ method: '', url: '/api/sessions/test' });
      const { res } = createMockResponse();

      const handled = await router.handleRequest(req, res);
      assert.equal(handled, false);
    });

    test('returns false for POST /api/sessions/:id (unregistered)', async () => {
      const req = createMockRequest({ method: 'POST', url: '/api/sessions/test' });
      const { res } = createMockResponse();

      const handled = await router.handleRequest(req, res);
      assert.equal(handled, false);
    });
  });

  // --------------------------------------------------------------------------
  // SessionRouterError
  // --------------------------------------------------------------------------

  describe('SessionRouterError', () => {
    test('creates error with correct name and fields', () => {
      const cause = new Error('root');
      const err = new SessionRouterError('test error', {
        cause,
        endpoint: '/api/sessions',
        statusCode: 500,
      });
      assert.equal(err.name, 'SessionRouterError');
      assert.equal(err.message, 'test error');
      assert.equal(err.endpoint, '/api/sessions');
      assert.equal(err.statusCode, 500);
      assert.equal(err.cause, cause);
    });
  });
});
