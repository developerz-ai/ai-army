/**
 * Unit tests for QueueRouter
 *
 * Tests the message queue API endpoints:
 * - GET    /api/queue/:botId          -> Get queue depth and stats
 * - GET    /api/queue/:botId/messages -> List queued messages
 * - DELETE /api/queue/:botId          -> Clear pending messages
 *
 * Also covers:
 * - Authentication (API key validation)
 * - Route matching (only handles /api/queue paths)
 * - Error handling
 * - Constructor validation
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { QueueRouter, QueueRouterError } from '../../../src/api/routers/queue-router.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock MessageQueue
 * @param {Object} [overrides={}] - Override default return values
 * @returns {Object} Mock MessageQueue
 */
function createMockMessageQueue(overrides = {}) {
  return {
    getQueueDepth: mock.fn(async () => overrides.depth ?? 5),
    getStats: mock.fn(async () => ({
      pending: 5,
      processing: 2,
      completed: 100,
      failed: 3,
      ...overrides.stats,
    })),
    clearQueue: mock.fn(async () => overrides.cleared ?? 5),
    enqueue: mock.fn(async () => ({})),
    dequeue: mock.fn(async () => null),
    storage: {
      query: mock.fn(async () => ({
        rows: overrides.rows || [
          {
            id: 1,
            bot_id: 'work-bot',
            channel_type: 'slack',
            channel_id: 'ch1',
            user_id: 'user1',
            message_text: 'Hello',
            priority: 0,
            status: 'pending',
            enqueued_at: '2026-02-06T10:00:00.000Z',
            started_at: null,
            completed_at: null,
            error: null,
          },
          {
            id: 2,
            bot_id: 'work-bot',
            channel_type: 'discord',
            channel_id: 'ch2',
            user_id: 'user2',
            message_text: 'Help me',
            priority: 1,
            status: 'pending',
            enqueued_at: '2026-02-06T10:01:00.000Z',
            started_at: null,
            completed_at: null,
            error: null,
          },
        ],
      })),
    },
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

// ============================================================================
// Tests
// ============================================================================

describe('QueueRouter', () => {
  /** @type {Object} */
  let mockQueue;
  /** @type {QueueRouter} */
  let router;

  beforeEach(() => {
    mockQueue = createMockMessageQueue();
    router = new QueueRouter({ messageQueue: mockQueue });
  });

  // --------------------------------------------------------------------------
  // Constructor
  // --------------------------------------------------------------------------

  describe('constructor', () => {
    test('creates instance with messageQueue', () => {
      const r = new QueueRouter({ messageQueue: mockQueue });
      assert.equal(r.messageQueue, mockQueue);
    });

    test('throws without messageQueue', () => {
      assert.throws(
        () => new QueueRouter(),
        err => err instanceof QueueRouterError && err.endpoint === 'constructor'
      );
    });

    test('throws with explicit null messageQueue', () => {
      assert.throws(
        () => new QueueRouter({ messageQueue: null }),
        err => err instanceof QueueRouterError
      );
    });

    test('accepts optional logger and apiKey', () => {
      const logger = mock.fn();
      const r = new QueueRouter({
        messageQueue: mockQueue,
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
  // GET /api/queue/:botId
  // --------------------------------------------------------------------------

  describe('GET /api/queue/:botId', () => {
    test('returns queue depth and stats', async () => {
      const req = createMockRequest({ method: 'GET', url: '/api/queue/work-bot' });
      const { res, getResponse } = createMockResponse();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.botId, 'work-bot');
      assert.equal(response.body.depth, 5);
      assert.ok(response.body.stats);
      assert.equal(response.body.stats.pending, 5);
      assert.equal(response.body.stats.processing, 2);
    });

    test('returns 500 on queue error', async () => {
      mockQueue.getQueueDepth = mock.fn(async () => {
        throw new Error('DB error');
      });
      router = new QueueRouter({ messageQueue: mockQueue, logger: mock.fn() });

      const req = createMockRequest({ method: 'GET', url: '/api/queue/work-bot' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 500);
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/queue/:botId/messages
  // --------------------------------------------------------------------------

  describe('GET /api/queue/:botId/messages', () => {
    test('returns queued messages', async () => {
      const req = createMockRequest({ method: 'GET', url: '/api/queue/work-bot/messages' });
      const { res, getResponse } = createMockResponse();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.count, 2);
      assert.equal(response.body.botId, 'work-bot');
      assert.equal(response.body.data[0].messageText, 'Hello');
      assert.equal(response.body.data[1].priority, 1);
    });

    test('passes status filter to query', async () => {
      const req = createMockRequest({
        method: 'GET',
        url: '/api/queue/work-bot/messages?status=processing',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.body.status, 'processing');
      // Verify the query was called with correct status parameter
      assert.equal(mockQueue.storage.query.mock.calls.length, 1);
      const queryArgs = mockQueue.storage.query.mock.calls[0].arguments;
      assert.equal(queryArgs[1][1], 'processing');
    });

    test('returns 500 on storage error', async () => {
      mockQueue.storage.query = mock.fn(async () => {
        throw new Error('Query failed');
      });
      router = new QueueRouter({ messageQueue: mockQueue, logger: mock.fn() });

      const req = createMockRequest({ method: 'GET', url: '/api/queue/work-bot/messages' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 500);
    });
  });

  // --------------------------------------------------------------------------
  // DELETE /api/queue/:botId
  // --------------------------------------------------------------------------

  describe('DELETE /api/queue/:botId', () => {
    test('clears queue successfully', async () => {
      const req = createMockRequest({ method: 'DELETE', url: '/api/queue/work-bot' });
      const { res, getResponse } = createMockResponse();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.success, true);
      assert.equal(response.body.botId, 'work-bot');
      assert.equal(response.body.cleared, 5);
      assert.equal(mockQueue.clearQueue.mock.calls.length, 1);
    });

    test('returns 500 on clear error', async () => {
      mockQueue.clearQueue = mock.fn(async () => {
        throw new Error('Clear failed');
      });
      router = new QueueRouter({ messageQueue: mockQueue, logger: mock.fn() });

      const req = createMockRequest({ method: 'DELETE', url: '/api/queue/work-bot' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 500);
    });

    test('logs audit event on successful clear', async () => {
      const auditLogger = {
        log: mock.fn(async () => {}),
      };
      router = new QueueRouter({ messageQueue: mockQueue, auditLogger });

      const req = createMockRequest({
        method: 'DELETE',
        url: '/api/queue/work-bot',
        headers: { authorization: 'Bearer mykey123456' },
      });
      const { res } = createMockResponse();

      await router.handleRequest(req, res);

      assert.equal(auditLogger.log.mock.calls.length, 1);
      const event = auditLogger.log.mock.calls[0].arguments[0];
      assert.equal(event.type, 'queue.cleared');
      assert.equal(event.resourceId, 'work-bot');
    });
  });

  // --------------------------------------------------------------------------
  // Authentication
  // --------------------------------------------------------------------------

  describe('authentication', () => {
    test('rejects request when apiKey configured and no auth header', async () => {
      router = new QueueRouter({ messageQueue: mockQueue, apiKey: 'secret123' });
      const req = createMockRequest({ method: 'GET', url: '/api/queue/work-bot' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 401);
    });

    test('allows request with correct API key', async () => {
      router = new QueueRouter({ messageQueue: mockQueue, apiKey: 'secret123' });
      const req = createMockRequest({
        method: 'GET',
        url: '/api/queue/work-bot',
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
      const req = createMockRequest({ method: '', url: '/api/queue/work-bot' });
      const { res } = createMockResponse();

      const handled = await router.handleRequest(req, res);
      assert.equal(handled, false);
    });

    test('returns false for POST /api/queue/:botId (unregistered)', async () => {
      const req = createMockRequest({ method: 'POST', url: '/api/queue/work-bot' });
      const { res } = createMockResponse();

      const handled = await router.handleRequest(req, res);
      assert.equal(handled, false);
    });
  });

  // --------------------------------------------------------------------------
  // QueueRouterError
  // --------------------------------------------------------------------------

  describe('QueueRouterError', () => {
    test('creates error with correct name and fields', () => {
      const cause = new Error('root');
      const err = new QueueRouterError('test error', {
        cause,
        endpoint: '/api/queue',
        statusCode: 500,
      });
      assert.equal(err.name, 'QueueRouterError');
      assert.equal(err.message, 'test error');
      assert.equal(err.endpoint, '/api/queue');
      assert.equal(err.statusCode, 500);
      assert.equal(err.cause, cause);
    });
  });
});
