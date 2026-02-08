/**
 * Unit tests for HealthRouter
 *
 * Tests the health API endpoint:
 * - GET /health → Returns aggregated health status JSON
 *
 * Also covers:
 * - HTTP status code mapping (200 for healthy/degraded, 503 for unhealthy)
 * - JSON response formatting
 * - Route matching (only handles GET /health)
 * - Error handling
 * - Constructor validation
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { HealthRouter, HealthRouterError } from '../../../src/api/routers/health-router.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock HealthMonitor
 * @param {Object} [statusOverrides={}] - Override status fields
 * @returns {Object} Mock HealthMonitor
 */
function createMockHealthMonitor(statusOverrides = {}) {
  return {
    getStatus: mock.fn(() => ({
      status: 'healthy',
      timestamp: '2026-02-06T10:30:00.000Z',
      uptime: 86400,
      checks: {
        database: {
          status: 'healthy',
          latency: 5,
          lastCheckAt: '2026-02-06T10:30:00.000Z',
          latencyMs: 5,
        },
        bots: {
          status: 'healthy',
          running: 4,
          total: 5,
          lastCheckAt: '2026-02-06T10:30:00.000Z',
          latencyMs: 2,
        },
      },
      ...statusOverrides,
    })),
    isRunning: mock.fn(() => true),
    start: mock.fn(async () => {}),
    stop: mock.fn(() => {}),
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

describe('HealthRouter', () => {
  /** @type {Object} */
  let mockMonitor;
  /** @type {HealthRouter} */
  let router;

  beforeEach(() => {
    mockMonitor = createMockHealthMonitor();
    router = new HealthRouter({ healthMonitor: mockMonitor });
  });

  // --------------------------------------------------------------------------
  // Constructor
  // --------------------------------------------------------------------------

  describe('constructor', () => {
    test('creates instance with healthMonitor', () => {
      const r = new HealthRouter({ healthMonitor: mockMonitor });
      assert.equal(r.healthMonitor, mockMonitor);
    });

    test('throws without healthMonitor', () => {
      assert.throws(
        () => new HealthRouter(),
        err => err instanceof HealthRouterError && err.endpoint === 'constructor'
      );
    });

    test('throws with explicit null healthMonitor', () => {
      assert.throws(
        () => new HealthRouter({ healthMonitor: null }),
        err => err instanceof HealthRouterError
      );
    });

    test('accepts optional logger', () => {
      const logger = mock.fn();
      const r = new HealthRouter({ healthMonitor: mockMonitor, logger });
      assert.equal(r.logger, logger);
    });

    test('defaults logger to null', () => {
      const r = new HealthRouter({ healthMonitor: mockMonitor });
      assert.equal(r.logger, null);
    });
  });

  // --------------------------------------------------------------------------
  // GET /health - Healthy status
  // --------------------------------------------------------------------------

  describe('GET /health - healthy', () => {
    test('returns 200 with healthy status', async () => {
      const req = createMockRequest({ method: 'GET', url: '/health' });
      const { res, getResponse } = createMockResponse();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.status, 'healthy');
      assert.equal(response.body.uptime, 86400);
      assert.ok(response.body.timestamp);
      assert.ok(response.body.checks);
    });

    test('includes check details in response', async () => {
      const req = createMockRequest({ method: 'GET', url: '/health' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.ok(response.body.checks.database);
      assert.equal(response.body.checks.database.status, 'healthy');
      assert.ok(response.body.checks.bots);
      assert.equal(response.body.checks.bots.running, 4);
    });

    test('sets Content-Type to application/json', async () => {
      const req = createMockRequest({ method: 'GET', url: '/health' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.headers['Content-Type'], 'application/json');
    });
  });

  // --------------------------------------------------------------------------
  // GET /health - Degraded status
  // --------------------------------------------------------------------------

  describe('GET /health - degraded', () => {
    test('returns 200 with degraded status', async () => {
      mockMonitor = createMockHealthMonitor({
        status: 'degraded',
        checks: {
          database: { status: 'healthy', latency: 5 },
          bots: { status: 'degraded', running: 2, total: 5 },
        },
      });
      router = new HealthRouter({ healthMonitor: mockMonitor });

      const req = createMockRequest({ method: 'GET', url: '/health' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.status, 'degraded');
    });
  });

  // --------------------------------------------------------------------------
  // GET /health - Unhealthy status
  // --------------------------------------------------------------------------

  describe('GET /health - unhealthy', () => {
    test('returns 503 with unhealthy status', async () => {
      mockMonitor = createMockHealthMonitor({
        status: 'unhealthy',
        checks: {
          database: { status: 'unhealthy', error: 'Connection refused' },
          bots: { status: 'healthy', running: 3, total: 3 },
        },
      });
      router = new HealthRouter({ healthMonitor: mockMonitor });

      const req = createMockRequest({ method: 'GET', url: '/health' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 503);
      assert.equal(response.body.status, 'unhealthy');
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

    test('returns false for POST /health', async () => {
      const req = createMockRequest({ method: 'POST', url: '/health' });
      const { res } = createMockResponse();

      const handled = await router.handleRequest(req, res);
      assert.equal(handled, false);
    });

    test('returns false for GET /healthz', async () => {
      const req = createMockRequest({ method: 'GET', url: '/healthz' });
      const { res } = createMockResponse();

      const handled = await router.handleRequest(req, res);
      assert.equal(handled, false);
    });

    test('returns false for empty method', async () => {
      const req = createMockRequest({ method: '', url: '/health' });
      const { res } = createMockResponse();

      const handled = await router.handleRequest(req, res);
      assert.equal(handled, false);
    });

    test('handles GET /health with query params', async () => {
      const req = createMockRequest({ method: 'GET', url: '/health?verbose=true' });
      const { res, getResponse } = createMockResponse();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      const response = getResponse();
      assert.equal(response.statusCode, 200);
    });
  });

  // --------------------------------------------------------------------------
  // Error handling
  // --------------------------------------------------------------------------

  describe('error handling', () => {
    test('returns 500 when getStatus throws', async () => {
      mockMonitor.getStatus = mock.fn(() => {
        throw new Error('Monitor exploded');
      });

      const logs = [];
      router = new HealthRouter({
        healthMonitor: mockMonitor,
        logger: msg => logs.push(msg),
      });

      const req = createMockRequest({ method: 'GET', url: '/health' });
      const { res, getResponse } = createMockResponse();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      const response = getResponse();
      assert.equal(response.statusCode, 500);
      assert.equal(response.body.status, 'unhealthy');
      assert.ok(response.body.error);
      assert.ok(logs.some(l => l.includes('Monitor exploded')));
    });
  });

  // --------------------------------------------------------------------------
  // HealthRouterError
  // --------------------------------------------------------------------------

  describe('HealthRouterError', () => {
    test('creates error with correct name and fields', () => {
      const cause = new Error('root');
      const err = new HealthRouterError('test error', {
        cause,
        endpoint: '/health',
      });
      assert.equal(err.name, 'HealthRouterError');
      assert.equal(err.message, 'test error');
      assert.equal(err.endpoint, '/health');
      assert.equal(err.cause, cause);
    });
  });
});
