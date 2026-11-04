/**
 * Unit tests for MetricsRouter
 *
 * Tests the metrics API endpoints:
 * - GET /api/metrics                -> Overall system metrics
 * - GET /api/metrics/bots/:id       -> Bot-specific metrics
 * - GET /api/metrics/channels/:name -> Channel-specific metrics
 *
 * Also covers:
 * - Authentication (API key validation)
 * - Route matching (only handles /api/metrics paths, GET only)
 * - Error handling
 * - Constructor validation
 * - Query parameter handling (since, limit)
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { MetricsRouter, MetricsRouterError } from '../../../src/api/routers/metrics-router.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock MetricsCollector
 * @param {Object[]} [metrics=[]] - Metrics to return from query
 * @param {Object} [latest={}] - Latest metrics snapshot
 * @returns {Object} Mock MetricsCollector
 */
function createMockMetricsCollector(metrics = [], latest = {}) {
  return {
    query: mock.fn(async () => metrics),
    record: mock.fn(async () => {}),
    recordBatch: mock.fn(async () => ({ recorded: 0, failed: 0 })),
    getLatest: mock.fn(async () => latest),
    applyRetention: mock.fn(async () => 0),
  };
}

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

const sampleBots = [
  { id: 'work-bot', status: 'running' },
  { id: 'support-bot', status: 'running' },
  { id: 'test-bot', status: 'stopped' },
];

const sampleMetrics = [
  {
    component: 'messages',
    metric: 'response_time_ms',
    value: 1500,
    timestamp: '2026-02-06T10:00:00.000Z',
  },
  {
    component: 'messages',
    metric: 'response_time_ms',
    value: 2000,
    timestamp: '2026-02-06T10:01:00.000Z',
  },
  {
    component: 'queue',
    metric: 'depth',
    value: 5,
    timestamp: '2026-02-06T10:00:00.000Z',
  },
];

// ============================================================================
// Tests
// ============================================================================

describe('MetricsRouter', () => {
  /** @type {Object} */
  let mockMetrics;
  /** @type {Object} */
  let mockBotManager;
  /** @type {MetricsRouter} */
  let router;

  beforeEach(() => {
    mockMetrics = createMockMetricsCollector(sampleMetrics);
    mockBotManager = createMockBotManager(sampleBots);
    router = new MetricsRouter({
      metricsCollector: mockMetrics,
      botManager: mockBotManager,
    });
  });

  // --------------------------------------------------------------------------
  // Constructor
  // --------------------------------------------------------------------------

  describe('constructor', () => {
    test('creates instance with metricsCollector', () => {
      const r = new MetricsRouter({ metricsCollector: mockMetrics });
      assert.equal(r.metricsCollector, mockMetrics);
    });

    test('throws without metricsCollector', () => {
      assert.throws(
        () => new MetricsRouter(),
        err => err instanceof MetricsRouterError && err.endpoint === 'constructor'
      );
    });

    test('throws with explicit null metricsCollector', () => {
      assert.throws(
        () => new MetricsRouter({ metricsCollector: null }),
        err => err instanceof MetricsRouterError
      );
    });

    test('accepts optional botManager and logger', () => {
      const logger = mock.fn();
      const r = new MetricsRouter({
        metricsCollector: mockMetrics,
        botManager: mockBotManager,
        logger,
        apiKey: 'test-key',
      });
      assert.equal(r.logger, logger);
      assert.equal(r.botManager, mockBotManager);
      assert.equal(r.apiKey, 'test-key');
    });

    test('defaults logger to null', () => {
      const r = new MetricsRouter({ metricsCollector: mockMetrics });
      assert.equal(r.logger, null);
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/metrics
  // --------------------------------------------------------------------------

  describe('GET /api/metrics', () => {
    test('returns system metrics with bot stats', async () => {
      const req = createMockRequest({ method: 'GET', url: '/api/metrics' });
      const { res, getResponse } = createMockResponse();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.ok(response.body.timestamp);
      assert.equal(response.body.bots.total, 3);
      assert.equal(response.body.bots.running, 2);
      assert.equal(response.body.bots.stopped, 1);
      assert.ok(response.body.messages);
      assert.ok(response.body.since);
    });

    test('calculates average response time', async () => {
      const req = createMockRequest({ method: 'GET', url: '/api/metrics' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.body.messages.avgResponseTimeMs, 1750);
    });

    test('handles no botManager gracefully', async () => {
      router = new MetricsRouter({ metricsCollector: mockMetrics });
      const req = createMockRequest({ method: 'GET', url: '/api/metrics' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.bots.total, 0);
    });

    test('accepts since query parameter', async () => {
      const req = createMockRequest({
        method: 'GET',
        url: '/api/metrics?since=2026-02-06T00:00:00.000Z',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(mockMetrics.query.mock.calls.length, 1);
    });

    test('returns 500 on collector error', async () => {
      mockMetrics.query = mock.fn(async () => {
        throw new Error('DB error');
      });
      router = new MetricsRouter({
        metricsCollector: mockMetrics,
        logger: mock.fn(),
      });

      const req = createMockRequest({ method: 'GET', url: '/api/metrics' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 500);
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/metrics/bots/:id
  // --------------------------------------------------------------------------

  describe('GET /api/metrics/bots/:id', () => {
    test('returns bot-specific metrics', async () => {
      const botMetrics = [
        { metric: 'response_time_ms', value: 1200, timestamp: '2026-02-06T10:00:00.000Z' },
      ];
      mockMetrics = createMockMetricsCollector(botMetrics, {
        response_time_ms: { value: 1200, timestamp: new Date() },
      });
      mockMetrics.getLatest = mock.fn(async () => ({
        response_time_ms: { value: 1200, timestamp: new Date() },
      }));
      router = new MetricsRouter({
        metricsCollector: mockMetrics,
        botManager: mockBotManager,
      });

      const req = createMockRequest({ method: 'GET', url: '/api/metrics/bots/work-bot' });
      const { res, getResponse } = createMockResponse();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.botId, 'work-bot');
      assert.ok(response.body.metrics);
      assert.ok(response.body.latest);
      assert.ok(response.body.bot);
      assert.equal(response.body.bot.id, 'work-bot');
    });

    test('returns metrics even if bot not in botManager', async () => {
      const req = createMockRequest({ method: 'GET', url: '/api/metrics/bots/unknown' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.botId, 'unknown');
      assert.equal(response.body.bot, null);
    });

    test('handles getLatest failure gracefully', async () => {
      mockMetrics.getLatest = mock.fn(async () => {
        throw new Error('No data');
      });
      router = new MetricsRouter({ metricsCollector: mockMetrics });

      const req = createMockRequest({ method: 'GET', url: '/api/metrics/bots/work-bot' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.body.latest, {});
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/metrics/channels/:name
  // --------------------------------------------------------------------------

  describe('GET /api/metrics/channels/:name', () => {
    test('returns channel-specific metrics', async () => {
      const channelMetrics = [
        { metric: 'message_count', value: 50, timestamp: '2026-02-06T10:00:00.000Z' },
      ];
      mockMetrics = createMockMetricsCollector(channelMetrics);
      router = new MetricsRouter({ metricsCollector: mockMetrics });

      const req = createMockRequest({ method: 'GET', url: '/api/metrics/channels/slack' });
      const { res, getResponse } = createMockResponse();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.channel, 'slack');
      assert.ok(response.body.metrics);
      assert.equal(response.body.count, 1);
    });

    test('queries with correct component filter', async () => {
      const req = createMockRequest({ method: 'GET', url: '/api/metrics/channels/discord' });
      const { res } = createMockResponse();

      await router.handleRequest(req, res);

      assert.equal(mockMetrics.query.mock.calls.length, 1);
      const filter = mockMetrics.query.mock.calls[0].arguments[0];
      assert.equal(filter.component, 'channel:discord');
    });

    test('handles getLatest failure gracefully', async () => {
      mockMetrics.getLatest = mock.fn(async () => {
        throw new Error('No data');
      });
      router = new MetricsRouter({ metricsCollector: mockMetrics });

      const req = createMockRequest({ method: 'GET', url: '/api/metrics/channels/slack' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.body.latest, {});
    });
  });

  // --------------------------------------------------------------------------
  // Authentication
  // --------------------------------------------------------------------------

  describe('authentication', () => {
    test('rejects request when apiKey configured and no auth header', async () => {
      router = new MetricsRouter({
        metricsCollector: mockMetrics,
        apiKey: 'secret123',
      });
      const req = createMockRequest({ method: 'GET', url: '/api/metrics' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 401);
    });

    test('allows request with correct API key', async () => {
      router = new MetricsRouter({
        metricsCollector: mockMetrics,
        botManager: mockBotManager,
        apiKey: 'secret123',
      });
      const req = createMockRequest({
        method: 'GET',
        url: '/api/metrics',
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

    test('returns false for POST requests', async () => {
      const req = createMockRequest({ method: 'POST', url: '/api/metrics' });
      const { res } = createMockResponse();

      const handled = await router.handleRequest(req, res);
      assert.equal(handled, false);
    });

    test('returns false for empty method', async () => {
      const req = createMockRequest({ method: '', url: '/api/metrics' });
      const { res } = createMockResponse();

      const handled = await router.handleRequest(req, res);
      assert.equal(handled, false);
    });
  });

  // --------------------------------------------------------------------------
  // MetricsRouterError
  // --------------------------------------------------------------------------

  describe('MetricsRouterError', () => {
    test('creates error with correct name and fields', () => {
      const cause = new Error('root');
      const err = new MetricsRouterError('test error', {
        cause,
        endpoint: '/api/metrics',
        statusCode: 500,
      });
      assert.equal(err.name, 'MetricsRouterError');
      assert.equal(err.message, 'test error');
      assert.equal(err.endpoint, '/api/metrics');
      assert.equal(err.statusCode, 500);
      assert.equal(err.cause, cause);
    });
  });
});
