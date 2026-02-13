/**
 * Unit tests for LegacyRedirectRouter
 *
 * Tests the backward-compatible /api/bots -> /api/v1/workers URL rewriting:
 * - URL rewriting from /api/bots to /api/v1/workers
 * - Endpoint-specific rewrites (/message -> /assign)
 * - Delegation to WorkerRouter after rewriting
 * - Non-matching paths pass through unchanged
 * - X-Legacy-Redirect header is set on handled requests
 * - X-Deprecation-Warning header is set on handled requests
 * - Deprecation warning logged for every legacy request
 * - Query string preservation during rewrite
 *
 * Run with: npm run test:unit
 */

import { describe, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { LegacyRedirectRouter } from '../../../src/api/routers/legacy-redirect-router.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock WorkerRouter
 * @param {boolean} [handles=true] - Whether handleRequest returns true
 * @returns {Object} Mock WorkerRouter
 */
function createMockWorkerRouter(handles = true) {
  return {
    handleRequest: mock.fn(async () => handles),
  };
}

/**
 * Create a mock HTTP request
 * @param {Object} [overrides] - Override defaults
 * @returns {Object} Mock request
 */
function createMockReq(overrides = {}) {
  return {
    url: overrides.url || '/api/bots',
    method: overrides.method || 'GET',
    headers: overrides.headers || { host: 'localhost:3000' },
  };
}

/**
 * Create a mock HTTP response
 * @returns {Object} Mock response with setHeader spy
 */
function createMockRes() {
  const headers = {};
  return {
    setHeader: mock.fn((key, value) => {
      headers[key] = value;
    }),
    _headers: headers,
  };
}

// ============================================================================
// Unit Tests
// ============================================================================

describe('LegacyRedirectRouter', () => {
  // ==========================================================================
  // Constructor
  // ==========================================================================

  describe('constructor', () => {
    test('creates instance with valid workerRouter', () => {
      const workerRouter = createMockWorkerRouter();
      const router = new LegacyRedirectRouter({ workerRouter });
      assert.ok(router);
      assert.equal(router.workerRouter, workerRouter);
    });

    test('throws when workerRouter is missing', () => {
      assert.throws(() => new LegacyRedirectRouter({}), {
        message: 'LegacyRedirectRouter requires a workerRouter',
      });
    });

    test('throws when no options provided', () => {
      assert.throws(() => new LegacyRedirectRouter(), {
        message: 'LegacyRedirectRouter requires a workerRouter',
      });
    });

    test('accepts optional logger', () => {
      const workerRouter = createMockWorkerRouter();
      const logger = mock.fn();
      const router = new LegacyRedirectRouter({ workerRouter, logger });
      assert.equal(router.logger, logger);
    });

    test('defaults logger to null', () => {
      const workerRouter = createMockWorkerRouter();
      const router = new LegacyRedirectRouter({ workerRouter });
      assert.equal(router.logger, null);
    });
  });

  // ==========================================================================
  // URL Rewriting
  // ==========================================================================

  describe('URL rewriting', () => {
    test('rewrites /api/bots to /api/v1/workers', async () => {
      const workerRouter = createMockWorkerRouter();
      const router = new LegacyRedirectRouter({ workerRouter });
      const req = createMockReq({ url: '/api/bots' });
      const res = createMockRes();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      assert.equal(req.url, '/api/v1/workers');
      assert.equal(workerRouter.handleRequest.mock.callCount(), 1);
    });

    test('rewrites /api/bots/:id to /api/v1/workers/:id', async () => {
      const workerRouter = createMockWorkerRouter();
      const router = new LegacyRedirectRouter({ workerRouter });
      const req = createMockReq({ url: '/api/bots/my-bot' });
      const res = createMockRes();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      assert.equal(req.url, '/api/v1/workers/my-bot');
    });

    test('rewrites /api/bots/:id/status to /api/v1/workers/:id/status', async () => {
      const workerRouter = createMockWorkerRouter();
      const router = new LegacyRedirectRouter({ workerRouter });
      const req = createMockReq({ url: '/api/bots/my-bot/status' });
      const res = createMockRes();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      assert.equal(req.url, '/api/v1/workers/my-bot/status');
    });

    test('rewrites /api/bots/:id/stop to /api/v1/workers/:id/stop', async () => {
      const workerRouter = createMockWorkerRouter();
      const router = new LegacyRedirectRouter({ workerRouter });
      const req = createMockReq({ url: '/api/bots/my-bot/stop', method: 'POST' });
      const res = createMockRes();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      assert.equal(req.url, '/api/v1/workers/my-bot/stop');
    });

    test('preserves query string during rewrite', async () => {
      const workerRouter = createMockWorkerRouter();
      const router = new LegacyRedirectRouter({ workerRouter });
      const req = createMockReq({ url: '/api/bots?status=running&limit=10' });
      const res = createMockRes();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      assert.equal(req.url, '/api/v1/workers?status=running&limit=10');
    });
  });

  // ==========================================================================
  // Endpoint-Specific Rewrites
  // ==========================================================================

  describe('endpoint-specific rewrites', () => {
    test('rewrites /api/bots/:id/message to /api/v1/workers/:id/assign', async () => {
      const workerRouter = createMockWorkerRouter();
      const router = new LegacyRedirectRouter({ workerRouter });
      const req = createMockReq({ url: '/api/bots/my-bot/message', method: 'POST' });
      const res = createMockRes();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      assert.equal(req.url, '/api/v1/workers/my-bot/assign');
    });

    test('rewrites /api/bots/:id/message with query params', async () => {
      const workerRouter = createMockWorkerRouter();
      const router = new LegacyRedirectRouter({ workerRouter });
      const req = createMockReq({ url: '/api/bots/my-bot/message?timeout=30', method: 'POST' });
      const res = createMockRes();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      assert.equal(req.url, '/api/v1/workers/my-bot/assign?timeout=30');
    });

    test('sets X-Legacy-Redirect header with correct mapping for /message -> /assign', async () => {
      const workerRouter = createMockWorkerRouter();
      const router = new LegacyRedirectRouter({ workerRouter });
      const req = createMockReq({ url: '/api/bots/my-bot/message', method: 'POST' });
      const res = createMockRes();

      await router.handleRequest(req, res);

      // Find the X-Legacy-Redirect call
      const legacyCall = res.setHeader.mock.calls.find(c => c.arguments[0] === 'X-Legacy-Redirect');
      assert.ok(legacyCall, 'X-Legacy-Redirect header should be set');
      assert.equal(
        legacyCall.arguments[1],
        '/api/bots/my-bot/message -> /api/v1/workers/my-bot/assign'
      );
    });

    test('does not rewrite /api/bots/:id/sessions (no matching rule)', async () => {
      const workerRouter = createMockWorkerRouter();
      const router = new LegacyRedirectRouter({ workerRouter });
      const req = createMockReq({ url: '/api/bots/my-bot/sessions' });
      const res = createMockRes();

      await router.handleRequest(req, res);

      // It still rewrites the base prefix, but /sessions stays unchanged
      assert.equal(req.url, '/api/v1/workers/my-bot/sessions');
    });
  });

  // ==========================================================================
  // Non-matching Paths
  // ==========================================================================

  describe('non-matching paths', () => {
    test('ignores /api/v1/workers paths', async () => {
      const workerRouter = createMockWorkerRouter();
      const router = new LegacyRedirectRouter({ workerRouter });
      const req = createMockReq({ url: '/api/v1/workers' });
      const res = createMockRes();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, false);
      assert.equal(workerRouter.handleRequest.mock.callCount(), 0);
    });

    test('ignores /api/sessions paths', async () => {
      const workerRouter = createMockWorkerRouter();
      const router = new LegacyRedirectRouter({ workerRouter });
      const req = createMockReq({ url: '/api/sessions' });
      const res = createMockRes();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, false);
    });

    test('ignores /health path', async () => {
      const workerRouter = createMockWorkerRouter();
      const router = new LegacyRedirectRouter({ workerRouter });
      const req = createMockReq({ url: '/health' });
      const res = createMockRes();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, false);
    });

    test('ignores /api/v1/servers paths', async () => {
      const workerRouter = createMockWorkerRouter();
      const router = new LegacyRedirectRouter({ workerRouter });
      const req = createMockReq({ url: '/api/v1/servers' });
      const res = createMockRes();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, false);
    });
  });

  // ==========================================================================
  // Response Headers
  // ==========================================================================

  describe('response headers', () => {
    test('sets X-Legacy-Redirect header on handled requests', async () => {
      const workerRouter = createMockWorkerRouter();
      const router = new LegacyRedirectRouter({ workerRouter });
      const req = createMockReq({ url: '/api/bots' });
      const res = createMockRes();

      await router.handleRequest(req, res);

      // Now we set both X-Legacy-Redirect and X-Deprecation-Warning
      assert.equal(res.setHeader.mock.callCount(), 2);
      const [key, value] = res.setHeader.mock.calls[0].arguments;
      assert.equal(key, 'X-Legacy-Redirect');
      assert.equal(value, '/api/bots -> /api/v1/workers');
    });

    test('includes original path in X-Legacy-Redirect header', async () => {
      const workerRouter = createMockWorkerRouter();
      const router = new LegacyRedirectRouter({ workerRouter });
      const req = createMockReq({ url: '/api/bots/my-bot/status' });
      const res = createMockRes();

      await router.handleRequest(req, res);

      const [, value] = res.setHeader.mock.calls[0].arguments;
      assert.equal(value, '/api/bots/my-bot/status -> /api/v1/workers/my-bot/status');
    });

    test('sets X-Deprecation-Warning header on handled requests', async () => {
      const workerRouter = createMockWorkerRouter();
      const router = new LegacyRedirectRouter({ workerRouter });
      const req = createMockReq({ url: '/api/bots' });
      const res = createMockRes();

      await router.handleRequest(req, res);

      const deprecationCall = res.setHeader.mock.calls.find(
        c => c.arguments[0] === 'X-Deprecation-Warning'
      );
      assert.ok(deprecationCall, 'X-Deprecation-Warning header should be set');
      assert.equal(
        deprecationCall.arguments[1],
        '/api/bots is deprecated. Use /api/v1/workers instead.'
      );
    });

    test('X-Deprecation-Warning header shows correct mapping for /message -> /assign', async () => {
      const workerRouter = createMockWorkerRouter();
      const router = new LegacyRedirectRouter({ workerRouter });
      const req = createMockReq({ url: '/api/bots/my-bot/message', method: 'POST' });
      const res = createMockRes();

      await router.handleRequest(req, res);

      const deprecationCall = res.setHeader.mock.calls.find(
        c => c.arguments[0] === 'X-Deprecation-Warning'
      );
      assert.ok(deprecationCall);
      assert.equal(
        deprecationCall.arguments[1],
        '/api/bots/my-bot/message is deprecated. Use /api/v1/workers/my-bot/assign instead.'
      );
    });

    test('does not set headers for non-matching paths', async () => {
      const workerRouter = createMockWorkerRouter();
      const router = new LegacyRedirectRouter({ workerRouter });
      const req = createMockReq({ url: '/api/v1/workers' });
      const res = createMockRes();

      await router.handleRequest(req, res);

      assert.equal(res.setHeader.mock.callCount(), 0);
    });
  });

  // ==========================================================================
  // Delegation Behavior
  // ==========================================================================

  describe('delegation behavior', () => {
    test('restores original URL if worker router does not handle', async () => {
      const workerRouter = createMockWorkerRouter(false); // Returns false
      const router = new LegacyRedirectRouter({ workerRouter });
      const req = createMockReq({ url: '/api/bots/unknown-endpoint' });
      const res = createMockRes();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, false);
      assert.equal(req.url, '/api/bots/unknown-endpoint');
    });

    test('keeps rewritten URL if worker router handles the request', async () => {
      const workerRouter = createMockWorkerRouter(true);
      const router = new LegacyRedirectRouter({ workerRouter });
      const req = createMockReq({ url: '/api/bots/my-bot' });
      const res = createMockRes();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      assert.equal(req.url, '/api/v1/workers/my-bot');
    });

    test('passes req and res to worker router', async () => {
      const workerRouter = createMockWorkerRouter();
      const router = new LegacyRedirectRouter({ workerRouter });
      const req = createMockReq({ url: '/api/bots' });
      const res = createMockRes();

      await router.handleRequest(req, res);

      const [passedReq, passedRes] = workerRouter.handleRequest.mock.calls[0].arguments;
      assert.equal(passedReq, req);
      assert.equal(passedRes, res);
    });
  });

  // ==========================================================================
  // Logging
  // ==========================================================================

  describe('logging', () => {
    test('logs redirect when logger is configured', async () => {
      const workerRouter = createMockWorkerRouter();
      const logger = mock.fn();
      const router = new LegacyRedirectRouter({ workerRouter, logger });
      const req = createMockReq({ url: '/api/bots/my-bot' });
      const res = createMockRes();

      await router.handleRequest(req, res);

      // Should have 2 log calls: redirect + deprecation warning
      assert.ok(logger.mock.callCount() >= 2);
      const logMsg = logger.mock.calls[0].arguments[0];
      assert.match(logMsg, /LegacyRedirectRouter/);
      assert.match(logMsg, /Legacy redirect/);
      assert.match(logMsg, /\/api\/bots\/my-bot/);
      assert.match(logMsg, /\/api\/v1\/workers\/my-bot/);
    });

    test('logs deprecation warning when logger is configured', async () => {
      const workerRouter = createMockWorkerRouter();
      const logger = mock.fn();
      const router = new LegacyRedirectRouter({ workerRouter, logger });
      const req = createMockReq({ url: '/api/bots/my-bot' });
      const res = createMockRes();

      await router.handleRequest(req, res);

      const deprecationLog = logger.mock.calls.find(c =>
        c.arguments[0].includes('DEPRECATION WARNING')
      );
      assert.ok(deprecationLog, 'Should log a deprecation warning');
      assert.match(deprecationLog.arguments[0], /DEPRECATION WARNING/);
      assert.match(deprecationLog.arguments[0], /\/api\/bots\/my-bot/);
      assert.match(deprecationLog.arguments[0], /\/api\/v1\/workers\/my-bot/);
      assert.match(deprecationLog.arguments[0], /deprecated/);
      assert.match(deprecationLog.arguments[0], /migrate/);
    });

    test('logs deprecation warning with correct /assign path for /message', async () => {
      const workerRouter = createMockWorkerRouter();
      const logger = mock.fn();
      const router = new LegacyRedirectRouter({ workerRouter, logger });
      const req = createMockReq({ url: '/api/bots/my-bot/message', method: 'POST' });
      const res = createMockRes();

      await router.handleRequest(req, res);

      const deprecationLog = logger.mock.calls.find(c =>
        c.arguments[0].includes('DEPRECATION WARNING')
      );
      assert.ok(deprecationLog);
      assert.match(deprecationLog.arguments[0], /\/api\/bots\/my-bot\/message/);
      assert.match(deprecationLog.arguments[0], /\/api\/v1\/workers\/my-bot\/assign/);
    });

    test('does not log for non-matching paths', async () => {
      const workerRouter = createMockWorkerRouter();
      const logger = mock.fn();
      const router = new LegacyRedirectRouter({ workerRouter, logger });
      const req = createMockReq({ url: '/api/sessions' });
      const res = createMockRes();

      await router.handleRequest(req, res);

      assert.equal(logger.mock.callCount(), 0);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('edge cases', () => {
    test('handles malformed host header gracefully', async () => {
      const workerRouter = createMockWorkerRouter();
      const router = new LegacyRedirectRouter({ workerRouter });
      const req = createMockReq({
        url: '/api/bots',
        headers: { host: 'invalid:host:header' },
      });
      const res = createMockRes();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      assert.equal(req.url, '/api/v1/workers');
    });

    test('handles missing host header gracefully', async () => {
      const workerRouter = createMockWorkerRouter();
      const router = new LegacyRedirectRouter({ workerRouter });
      const req = createMockReq({
        url: '/api/bots',
        headers: {},
      });
      const res = createMockRes();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      assert.equal(req.url, '/api/v1/workers');
    });
  });
});
