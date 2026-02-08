/**
 * Unit tests for APIServer
 *
 * Tests the HTTP API server:
 * - Constructor and configuration
 * - Server start/stop lifecycle
 * - Route matching and parameter extraction
 * - Router chain delegation
 * - CORS handling
 * - Rate limiting integration
 * - Authentication integration
 * - JSON body parsing
 * - Error handling and 404 responses
 */

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { APIServer, APIServerError } from '../../../src/api/api-server.js';

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
 * Create a mock router with a handleRequest method
 * @param {Function} handler - Handler function
 * @returns {Object} Mock router
 */
function createMockRouter(handler) {
  return {
    handleRequest: handler,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('APIServer', () => {
  /** @type {APIServer} */
  let server;

  afterEach(async () => {
    if (server && server.running) {
      await server.stop();
    }
    server = null;
  });

  // ==========================================================================
  // Constructor
  // ==========================================================================

  describe('constructor', () => {
    test('creates instance with default options', () => {
      server = new APIServer();
      assert.ok(server);
      assert.deepEqual(server.routers, []);
      assert.deepEqual(server.routes, []);
      assert.equal(server.running, false);
      assert.equal(server.server, null);
    });

    test('accepts routers option', () => {
      const router = createMockRouter(async () => false);
      server = new APIServer({ routers: [router] });
      assert.equal(server.routers.length, 1);
    });

    test('accepts auth options', () => {
      server = new APIServer({
        auth: {
          tokens: [{ token: 'test-key', role: 'admin' }],
        },
      });
      assert.ok(server.auth.isEnabled());
    });

    test('accepts rate limit options', () => {
      server = new APIServer({
        rateLimit: { max: 50, windowMs: 30000 },
      });
      assert.equal(server.rateLimiter.max, 50);
      assert.equal(server.rateLimiter.windowMs, 30000);
    });

    test('accepts CORS options', () => {
      server = new APIServer({
        cors: { origins: ['https://example.com'] },
      });
      assert.deepEqual(server.cors.origins, ['https://example.com']);
    });
  });

  // ==========================================================================
  // addRouter
  // ==========================================================================

  describe('addRouter', () => {
    test('adds a valid router', () => {
      server = new APIServer();
      const router = createMockRouter(async () => false);
      server.addRouter(router);
      assert.equal(server.routers.length, 1);
    });

    test('throws for router without handleRequest', () => {
      server = new APIServer();
      assert.throws(
        () => server.addRouter({}),
        err => {
          assert.ok(err instanceof APIServerError);
          assert.ok(err.message.includes('handleRequest'));
          return true;
        }
      );
    });

    test('throws for null router', () => {
      server = new APIServer();
      assert.throws(
        () => server.addRouter(null),
        err => {
          assert.ok(err instanceof APIServerError);
          return true;
        }
      );
    });
  });

  // ==========================================================================
  // _addRoute
  // ==========================================================================

  describe('_addRoute', () => {
    test('registers a route', () => {
      server = new APIServer();
      server._addRoute('GET', '/api/test', async () => ({ statusCode: 200, body: { ok: true } }));
      assert.equal(server.routes.length, 1);
      assert.equal(server.routes[0].method, 'GET');
    });

    test('extracts parameter names', () => {
      server = new APIServer();
      server._addRoute('GET', '/api/bots/:botId/sessions/:sessionId', async () => ({
        statusCode: 200,
        body: {},
      }));
      assert.deepEqual(server.routes[0].paramNames, ['botId', 'sessionId']);
    });

    test('stores route options', () => {
      server = new APIServer();
      server._addRoute('POST', '/api/admin/reload', async () => ({ statusCode: 200, body: {} }), {
        requiredRole: 'admin',
        skipAuth: false,
      });
      assert.equal(server.routes[0].options.requiredRole, 'admin');
    });
  });

  // ==========================================================================
  // start / stop
  // ==========================================================================

  describe('start and stop', () => {
    test('starts and stops the server', async () => {
      server = new APIServer({ logger: null });
      const port = await getAvailablePort();

      await server.start(port);
      assert.equal(server.running, true);
      assert.equal(server.port, port);

      await server.stop();
      assert.equal(server.running, false);
    });

    test('throws when starting already running server', async () => {
      server = new APIServer({ logger: null });
      const port = await getAvailablePort();

      await server.start(port);
      await assert.rejects(
        () => server.start(port + 1),
        err => {
          assert.ok(err instanceof APIServerError);
          assert.ok(err.message.includes('already running'));
          return true;
        }
      );
    });

    test('stop is idempotent when not running', async () => {
      server = new APIServer({ logger: null });
      await server.stop(); // Should not throw
    });
  });

  // ==========================================================================
  // HTTP Request Handling
  // ==========================================================================

  describe('HTTP request handling', () => {
    test('returns 404 for unmatched routes', async () => {
      server = new APIServer({ logger: null });
      const port = await getAvailablePort();
      await server.start(port);

      const response = await sendRequest({ port, path: '/nonexistent' });
      assert.equal(response.statusCode, 404);
      assert.equal(response.body.error, 'Not Found');
    });

    test('handles directly registered routes', async () => {
      server = new APIServer({ logger: null });
      server._addRoute(
        'GET',
        '/api/ping',
        async () => ({
          statusCode: 200,
          body: { pong: true },
        }),
        { skipAuth: true }
      );

      const port = await getAvailablePort();
      await server.start(port);

      const response = await sendRequest({ port, path: '/api/ping' });
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.pong, true);
    });

    test('extracts URL parameters', async () => {
      server = new APIServer({ logger: null });
      server._addRoute(
        'GET',
        '/api/bots/:botId',
        async req => ({
          statusCode: 200,
          body: { botId: req.params.botId },
        }),
        { skipAuth: true }
      );

      const port = await getAvailablePort();
      await server.start(port);

      const response = await sendRequest({ port, path: '/api/bots/my-bot' });
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.botId, 'my-bot');
    });

    test('decodes URL-encoded parameters', async () => {
      server = new APIServer({ logger: null });
      server._addRoute(
        'GET',
        '/api/bots/:botId',
        async req => ({
          statusCode: 200,
          body: { botId: req.params.botId },
        }),
        { skipAuth: true }
      );

      const port = await getAvailablePort();
      await server.start(port);

      const response = await sendRequest({ port, path: '/api/bots/my%20bot' });
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.botId, 'my bot');
    });

    test('delegates to registered routers', async () => {
      const mockRouter = createMockRouter(async (req, res) => {
        const url = new URL(req.url, `http://${req.headers.host}`);
        if (url.pathname === '/custom/endpoint') {
          const json = JSON.stringify({ custom: true });
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(json),
          });
          res.end(json);
          return true;
        }
        return false;
      });

      server = new APIServer({ routers: [mockRouter], logger: null });
      const port = await getAvailablePort();
      await server.start(port);

      const response = await sendRequest({ port, path: '/custom/endpoint' });
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.custom, true);
    });

    test('tries routers in order', async () => {
      const callOrder = [];

      const router1 = createMockRouter(async () => {
        callOrder.push('router1');
        return false;
      });

      const router2 = createMockRouter(async (req, res) => {
        callOrder.push('router2');
        const json = JSON.stringify({ from: 'router2' });
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(json),
        });
        res.end(json);
        return true;
      });

      server = new APIServer({ routers: [router1, router2], logger: null });
      const port = await getAvailablePort();
      await server.start(port);

      const response = await sendRequest({ port, path: '/some/path' });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(callOrder, ['router1', 'router2']);
    });
  });

  // ==========================================================================
  // CORS
  // ==========================================================================

  describe('CORS', () => {
    test('handles OPTIONS preflight with 204', async () => {
      server = new APIServer({ logger: null });
      const port = await getAvailablePort();
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
    });

    test('sets CORS headers with wildcard origin', async () => {
      server = new APIServer({ logger: null });
      server._addRoute('GET', '/api/test', async () => ({ statusCode: 200, body: {} }), {
        skipAuth: true,
      });
      const port = await getAvailablePort();
      await server.start(port);

      const response = await sendRequest({ port, path: '/api/test' });
      assert.equal(response.headers['access-control-allow-origin'], '*');
    });

    test('sets specific origin when configured', async () => {
      server = new APIServer({
        cors: { origins: ['https://dashboard.example.com'] },
        logger: null,
      });
      server._addRoute('GET', '/api/test', async () => ({ statusCode: 200, body: {} }), {
        skipAuth: true,
      });
      const port = await getAvailablePort();
      await server.start(port);

      const response = await sendRequest({
        port,
        path: '/api/test',
        headers: { Origin: 'https://dashboard.example.com' },
      });
      assert.equal(
        response.headers['access-control-allow-origin'],
        'https://dashboard.example.com'
      );
    });
  });

  // ==========================================================================
  // Authentication
  // ==========================================================================

  describe('authentication', () => {
    test('returns 401 when auth enabled and no token provided', async () => {
      server = new APIServer({
        auth: {
          tokens: [{ token: 'secret-key-123456', role: 'admin' }],
        },
        logger: null,
      });
      server._addRoute('GET', '/api/protected', async () => ({
        statusCode: 200,
        body: { ok: true },
      }));

      const port = await getAvailablePort();
      await server.start(port);

      const response = await sendRequest({ port, path: '/api/protected' });
      assert.equal(response.statusCode, 401);
      assert.equal(response.body.error, 'Unauthorized');
    });

    test('allows request with valid token', async () => {
      server = new APIServer({
        auth: {
          tokens: [{ token: 'secret-key-123456', role: 'admin' }],
        },
        logger: null,
      });
      server._addRoute('GET', '/api/protected', async () => ({
        statusCode: 200,
        body: { ok: true },
      }));

      const port = await getAvailablePort();
      await server.start(port);

      const response = await sendRequest({
        port,
        path: '/api/protected',
        headers: { Authorization: 'Bearer secret-key-123456' },
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.ok, true);
    });

    test('skips auth when skipAuth option is true', async () => {
      server = new APIServer({
        auth: {
          tokens: [{ token: 'secret-key-123456', role: 'admin' }],
        },
        logger: null,
      });
      server._addRoute(
        'GET',
        '/api/public',
        async () => ({ statusCode: 200, body: { public: true } }),
        { skipAuth: true }
      );

      const port = await getAvailablePort();
      await server.start(port);

      const response = await sendRequest({ port, path: '/api/public' });
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.public, true);
    });

    test('returns 403 when role is insufficient', async () => {
      server = new APIServer({
        auth: {
          tokens: [{ token: 'viewer-key-123456', role: 'viewer' }],
        },
        logger: null,
      });
      server._addRoute(
        'POST',
        '/api/admin/action',
        async () => ({ statusCode: 200, body: { ok: true } }),
        { requiredRole: 'admin' }
      );

      const port = await getAvailablePort();
      await server.start(port);

      const response = await sendRequest({
        port,
        method: 'POST',
        path: '/api/admin/action',
        headers: { Authorization: 'Bearer viewer-key-123456' },
      });
      assert.equal(response.statusCode, 403);
      assert.equal(response.body.error, 'Forbidden');
    });
  });

  // ==========================================================================
  // JSON Body Parsing
  // ==========================================================================

  describe('JSON body parsing', () => {
    test('parses JSON body for POST requests', async () => {
      server = new APIServer({ logger: null });
      server._addRoute(
        'POST',
        '/api/echo',
        async req => ({
          statusCode: 200,
          body: { received: req.body },
        }),
        { skipAuth: true }
      );

      const port = await getAvailablePort();
      await server.start(port);

      const response = await sendRequest({
        port,
        method: 'POST',
        path: '/api/echo',
        body: { message: 'hello' },
      });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.body.received, { message: 'hello' });
    });

    test('returns 400 for invalid JSON body', async () => {
      server = new APIServer({ logger: null });
      server._addRoute(
        'POST',
        '/api/echo',
        async req => ({
          statusCode: 200,
          body: { received: req.body },
        }),
        { skipAuth: true }
      );

      const port = await getAvailablePort();
      await server.start(port);

      const response = await sendRequest({
        port,
        method: 'POST',
        path: '/api/echo',
        body: 'not json {{{',
        headers: { 'Content-Type': 'application/json' },
      });
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.error, 'Bad Request');
    });

    test('handles empty POST body gracefully', async () => {
      server = new APIServer({ logger: null });
      server._addRoute(
        'POST',
        '/api/echo',
        async req => ({
          statusCode: 200,
          body: { received: req.body },
        }),
        { skipAuth: true }
      );

      const port = await getAvailablePort();
      await server.start(port);

      const response = await sendRequest({
        port,
        method: 'POST',
        path: '/api/echo',
      });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.body.received, {});
    });
  });

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('error handling', () => {
    test('returns 500 for handler errors', async () => {
      server = new APIServer({ logger: null });
      server._addRoute(
        'GET',
        '/api/error',
        async () => {
          throw new Error('Something went wrong');
        },
        { skipAuth: true }
      );

      const port = await getAvailablePort();
      await server.start(port);

      const response = await sendRequest({ port, path: '/api/error' });
      assert.equal(response.statusCode, 500);
      assert.equal(response.body.error, 'Internal Server Error');
    });

    test('uses custom statusCode from error', async () => {
      server = new APIServer({ logger: null });
      server._addRoute(
        'GET',
        '/api/error',
        async () => {
          const err = new Error('Not implemented');
          err.statusCode = 501;
          throw err;
        },
        { skipAuth: true }
      );

      const port = await getAvailablePort();
      await server.start(port);

      const response = await sendRequest({ port, path: '/api/error' });
      assert.equal(response.statusCode, 501);
    });
  });

  // ==========================================================================
  // Rate Limiting Integration
  // ==========================================================================

  describe('rate limiting', () => {
    test('applies rate limiting to requests', async () => {
      server = new APIServer({
        rateLimit: { max: 2, windowMs: 60000 },
        logger: null,
      });
      server._addRoute(
        'GET',
        '/api/limited',
        async () => ({ statusCode: 200, body: { ok: true } }),
        { skipAuth: true }
      );

      const port = await getAvailablePort();
      await server.start(port);

      // First two requests should succeed
      const res1 = await sendRequest({ port, path: '/api/limited' });
      assert.equal(res1.statusCode, 200);

      const res2 = await sendRequest({ port, path: '/api/limited' });
      assert.equal(res2.statusCode, 200);

      // Third request should be rate limited
      const res3 = await sendRequest({ port, path: '/api/limited' });
      assert.equal(res3.statusCode, 429);
      assert.equal(res3.body.error, 'Too Many Requests');
    });
  });

  // ==========================================================================
  // APIServerError
  // ==========================================================================

  describe('APIServerError', () => {
    test('has correct name', () => {
      const err = new APIServerError('test');
      assert.equal(err.name, 'APIServerError');
    });

    test('extends Error', () => {
      const err = new APIServerError('test');
      assert.ok(err instanceof Error);
    });

    test('stores cause', () => {
      const cause = new Error('original');
      const err = new APIServerError('wrapper', { cause });
      assert.equal(err.cause, cause);
    });

    test('stores operation', () => {
      const err = new APIServerError('test', { operation: 'start' });
      assert.equal(err.operation, 'start');
    });

    test('has correct message', () => {
      const err = new APIServerError('server failed');
      assert.equal(err.message, 'server failed');
    });
  });
});
