/**
 * RESTAdapter Tests
 *
 * Tests for the REST channel adapter:
 * - RESTAdapterError construction and fields
 * - Constructor config validation
 * - Lifecycle: initialize(), start(), stop()
 * - onMessage() handler registration
 * - sendMessage() buffering
 * - HTTP endpoints: POST /messages, GET /messages/:sessionId
 * - API key authentication
 * - CORS preflight handling
 * - Error handling for invalid JSON, missing fields, handler errors
 */

import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { RESTAdapter, RESTAdapterError } from '../../../../src/adapters/channels/rest.js';

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

// ============================================================================
// RESTAdapterError Tests
// ============================================================================

describe('RESTAdapterError', () => {
  test('should be an instance of Error', () => {
    const error = new RESTAdapterError('test error');
    assert.ok(error instanceof Error);
    assert.equal(error.name, 'RESTAdapterError');
    assert.equal(error.message, 'test error');
  });

  test('should store operation and reason', () => {
    const error = new RESTAdapterError('failed', {
      operation: 'initialize',
      reason: 'test reason',
    });
    assert.equal(error.operation, 'initialize');
    assert.equal(error.reason, 'test reason');
  });

  test('should store cause', () => {
    const cause = new Error('original');
    const error = new RESTAdapterError('wrapped', { cause });
    assert.equal(error.cause, cause);
  });

  test('should default optional fields to undefined', () => {
    const error = new RESTAdapterError('minimal');
    assert.equal(error.operation, undefined);
    assert.equal(error.reason, undefined);
    assert.equal(error.cause, undefined);
  });
});

// ============================================================================
// Constructor Tests
// ============================================================================

describe('RESTAdapter', () => {
  describe('constructor', () => {
    test('should throw if config is missing', () => {
      assert.throws(
        () => new RESTAdapter(),
        err => {
          assert.ok(err instanceof RESTAdapterError);
          assert.equal(err.operation, 'constructor');
          assert.match(err.message, /Config is required/);
          return true;
        }
      );
    });

    test('should throw if config is not an object', () => {
      assert.throws(
        () => new RESTAdapter('bad'),
        err => {
          assert.ok(err instanceof RESTAdapterError);
          assert.equal(err.operation, 'constructor');
          return true;
        }
      );
    });

    test('should throw if port is missing', () => {
      assert.throws(
        () => new RESTAdapter({}),
        err => {
          assert.ok(err instanceof RESTAdapterError);
          assert.equal(err.operation, 'constructor');
          assert.match(err.message, /port/);
          return true;
        }
      );
    });

    test('should throw if port is not a number', () => {
      assert.throws(
        () => new RESTAdapter({ port: '3000' }),
        err => {
          assert.ok(err instanceof RESTAdapterError);
          assert.equal(err.operation, 'constructor');
          return true;
        }
      );
    });

    test('should create instance with valid config', () => {
      const adapter = new RESTAdapter({ port: 3100 });
      assert.ok(adapter);
      assert.equal(adapter.config.port, 3100);
      assert.equal(adapter.config.host, '0.0.0.0');
      assert.equal(adapter.config.basePath, '');
      assert.equal(adapter.config.apiKey, null);
      assert.equal(adapter.initialized, false);
      assert.equal(adapter.started, false);
      assert.equal(adapter.messageHandler, null);
      assert.ok(adapter.responseBuffers instanceof Map);
    });

    test('should store optional config values', () => {
      const adapter = new RESTAdapter({
        port: 3100,
        host: '127.0.0.1',
        basePath: '/api/v1',
        apiKey: 'secret-key',
      });
      assert.equal(adapter.config.host, '127.0.0.1');
      assert.equal(adapter.config.basePath, '/api/v1');
      assert.equal(adapter.config.apiKey, 'secret-key');
    });

    test('should strip trailing slashes from basePath', () => {
      const adapter = new RESTAdapter({ port: 3100, basePath: '/api/v1/' });
      assert.equal(adapter.config.basePath, '/api/v1');
    });
  });

  // ==========================================================================
  // Lifecycle Tests (without HTTP)
  // ==========================================================================

  describe('initialize', () => {
    test('should set initialized to true', async () => {
      const adapter = new RESTAdapter({ port: 3100 });
      await adapter.initialize();
      assert.equal(adapter.initialized, true);
      assert.ok(adapter.server);
    });

    test('should be idempotent', async () => {
      const adapter = new RESTAdapter({ port: 3100 });
      await adapter.initialize();
      const server1 = adapter.server;
      await adapter.initialize();
      assert.equal(adapter.server, server1);
    });
  });

  describe('onMessage', () => {
    test('should register a handler function', () => {
      const adapter = new RESTAdapter({ port: 3100 });
      const handler = mock.fn();
      adapter.onMessage(handler);
      assert.equal(adapter.messageHandler, handler);
    });

    test('should throw if handler is not a function', () => {
      const adapter = new RESTAdapter({ port: 3100 });
      assert.throws(
        () => adapter.onMessage('not-a-function'),
        err => {
          assert.ok(err instanceof RESTAdapterError);
          assert.equal(err.operation, 'onMessage');
          assert.match(err.reason, /string/);
          return true;
        }
      );
    });

    test('should throw if handler is null', () => {
      const adapter = new RESTAdapter({ port: 3100 });
      assert.throws(
        () => adapter.onMessage(null),
        err => {
          assert.ok(err instanceof RESTAdapterError);
          assert.equal(err.operation, 'onMessage');
          return true;
        }
      );
    });
  });

  describe('start', () => {
    test('should throw if not initialized', async () => {
      const adapter = new RESTAdapter({ port: 3100 });
      await assert.rejects(
        () => adapter.start(),
        err => {
          assert.ok(err instanceof RESTAdapterError);
          assert.equal(err.operation, 'start');
          assert.match(err.message, /not initialized/i);
          return true;
        }
      );
    });
  });

  describe('stop', () => {
    test('should be no-op if not started', async () => {
      const adapter = new RESTAdapter({ port: 3100 });
      // Should not throw
      await adapter.stop();
    });

    test('should be no-op if initialized but not started', async () => {
      const adapter = new RESTAdapter({ port: 3100 });
      await adapter.initialize();
      await adapter.stop();
      assert.equal(adapter.started, false);
    });
  });

  describe('sendMessage', () => {
    test('should throw if not initialized', async () => {
      const adapter = new RESTAdapter({ port: 3100 });
      await assert.rejects(
        () => adapter.sendMessage('session-1', 'hello'),
        err => {
          assert.ok(err instanceof RESTAdapterError);
          assert.equal(err.operation, 'sendMessage');
          assert.match(err.message, /not initialized/i);
          return true;
        }
      );
    });

    test('should throw if channelId is missing', async () => {
      const adapter = new RESTAdapter({ port: 3100 });
      await adapter.initialize();
      await assert.rejects(
        () => adapter.sendMessage('', 'hello'),
        err => {
          assert.ok(err instanceof RESTAdapterError);
          assert.equal(err.operation, 'sendMessage');
          assert.match(err.message, /channelId/);
          return true;
        }
      );
    });

    test('should throw if text is not a string', async () => {
      const adapter = new RESTAdapter({ port: 3100 });
      await adapter.initialize();
      await assert.rejects(
        () => adapter.sendMessage('session-1', 123),
        err => {
          assert.ok(err instanceof RESTAdapterError);
          assert.equal(err.operation, 'sendMessage');
          assert.match(err.message, /text/);
          return true;
        }
      );
    });

    test('should buffer messages by channelId', async () => {
      const adapter = new RESTAdapter({ port: 3100 });
      await adapter.initialize();
      await adapter.sendMessage('session-1', 'hello');
      await adapter.sendMessage('session-1', 'world');
      await adapter.sendMessage('session-2', 'other');

      const buf1 = adapter.responseBuffers.get('session-1');
      assert.equal(buf1.length, 2);
      assert.equal(buf1[0].text, 'hello');
      assert.equal(buf1[1].text, 'world');
      assert.ok(buf1[0].timestamp);

      const buf2 = adapter.responseBuffers.get('session-2');
      assert.equal(buf2.length, 1);
      assert.equal(buf2[0].text, 'other');
    });
  });

  // ==========================================================================
  // HTTP Integration Tests
  // ==========================================================================

  describe('HTTP integration', () => {
    let adapter;
    let port;

    beforeEach(async () => {
      port = await getAvailablePort();
      adapter = new RESTAdapter({ port });
      await adapter.initialize();
      await adapter.start();
    });

    afterEach(async () => {
      if (adapter && adapter.started) {
        await adapter.stop();
      }
    });

    test('should start and stop successfully', async () => {
      assert.equal(adapter.started, true);
      await adapter.stop();
      assert.equal(adapter.started, false);
    });

    test('start should be idempotent', async () => {
      assert.equal(adapter.started, true);
      await adapter.start(); // second call should be no-op
      assert.equal(adapter.started, true);
    });

    test('should return 404 for unknown routes', async () => {
      const res = await sendRequest({ port, path: '/unknown' });
      assert.equal(res.statusCode, 404);
      assert.equal(res.body.error, 'Not Found');
    });

    test('should handle CORS preflight', async () => {
      const res = await sendRequest({ port, method: 'OPTIONS', path: '/messages' });
      assert.equal(res.statusCode, 204);
      assert.ok(res.headers['access-control-allow-origin']);
      assert.ok(res.headers['access-control-allow-methods']);
    });

    // POST /messages tests
    describe('POST /messages', () => {
      test('should accept valid inbound message', async () => {
        const handler = mock.fn();
        adapter.onMessage(handler);

        const res = await sendRequest({
          port,
          method: 'POST',
          path: '/messages',
          body: { sessionId: 'sess-1', text: 'Hello bot' },
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.ok, true);
        assert.equal(res.body.sessionId, 'sess-1');

        assert.equal(handler.mock.callCount(), 1);
        const msg = handler.mock.calls[0].arguments[0];
        assert.equal(msg.type, 'rest');
        assert.equal(msg.channelId, 'sess-1');
        assert.equal(msg.text, 'Hello bot');
        assert.equal(msg.userId, 'anonymous');
        assert.equal(msg.isDM, true);
      });

      test('should accept message with optional userId', async () => {
        const handler = mock.fn();
        adapter.onMessage(handler);

        const res = await sendRequest({
          port,
          method: 'POST',
          path: '/messages',
          body: { sessionId: 'sess-1', text: 'Hello', userId: 'user-42' },
        });

        assert.equal(res.statusCode, 200);
        const msg = handler.mock.calls[0].arguments[0];
        assert.equal(msg.userId, 'user-42');
      });

      test('should accept message with metadata', async () => {
        const handler = mock.fn();
        adapter.onMessage(handler);

        const res = await sendRequest({
          port,
          method: 'POST',
          path: '/messages',
          body: {
            sessionId: 'sess-1',
            text: 'Hello',
            metadata: { source: 'test' },
          },
        });

        assert.equal(res.statusCode, 200);
        const msg = handler.mock.calls[0].arguments[0];
        assert.deepStrictEqual(msg.metadata, { source: 'test' });
      });

      test('should return 400 for missing sessionId', async () => {
        const res = await sendRequest({
          port,
          method: 'POST',
          path: '/messages',
          body: { text: 'Hello' },
        });

        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /sessionId/);
      });

      test('should return 400 for missing text', async () => {
        const res = await sendRequest({
          port,
          method: 'POST',
          path: '/messages',
          body: { sessionId: 'sess-1' },
        });

        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /text/);
      });

      test('should return 400 for invalid JSON body', async () => {
        const res = await sendRequest({
          port,
          method: 'POST',
          path: '/messages',
          headers: { 'Content-Type': 'application/json', 'Content-Length': '7' },
          body: 'invalid',
        });

        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /Invalid JSON/i);
      });

      test('should succeed without a message handler', async () => {
        // No handler registered — message should still be accepted
        const res = await sendRequest({
          port,
          method: 'POST',
          path: '/messages',
          body: { sessionId: 'sess-1', text: 'Hello' },
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.ok, true);
      });

      test('should return 500 when message handler throws', async () => {
        adapter.onMessage(() => {
          throw new Error('handler exploded');
        });

        const res = await sendRequest({
          port,
          method: 'POST',
          path: '/messages',
          body: { sessionId: 'sess-1', text: 'Hello' },
        });

        assert.equal(res.statusCode, 500);
        assert.match(res.body.message, /handler/i);
      });
    });

    // GET /messages/:sessionId tests
    describe('GET /messages/:sessionId', () => {
      test('should return empty array for unknown session', async () => {
        const res = await sendRequest({
          port,
          path: '/messages/unknown-session',
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.ok, true);
        assert.equal(res.body.sessionId, 'unknown-session');
        assert.deepStrictEqual(res.body.messages, []);
      });

      test('should return buffered messages and drain the buffer', async () => {
        await adapter.sendMessage('sess-poll', 'reply-1');
        await adapter.sendMessage('sess-poll', 'reply-2');

        const res1 = await sendRequest({
          port,
          path: '/messages/sess-poll',
        });

        assert.equal(res1.statusCode, 200);
        assert.equal(res1.body.messages.length, 2);
        assert.equal(res1.body.messages[0].text, 'reply-1');
        assert.equal(res1.body.messages[1].text, 'reply-2');

        // Second poll should be empty (buffer drained)
        const res2 = await sendRequest({
          port,
          path: '/messages/sess-poll',
        });

        assert.equal(res2.statusCode, 200);
        assert.deepStrictEqual(res2.body.messages, []);
      });

      test('should decode URI-encoded sessionId', async () => {
        await adapter.sendMessage('session with spaces', 'hello');

        const res = await sendRequest({
          port,
          path: `/messages/${encodeURIComponent('session with spaces')}`,
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.sessionId, 'session with spaces');
        assert.equal(res.body.messages.length, 1);
      });
    });
  });

  // ==========================================================================
  // API Key Authentication Tests
  // ==========================================================================

  describe('API key authentication', () => {
    let adapter;
    let port;

    beforeEach(async () => {
      port = await getAvailablePort();
      adapter = new RESTAdapter({ port, apiKey: 'test-api-key' });
      await adapter.initialize();
      await adapter.start();
    });

    afterEach(async () => {
      if (adapter && adapter.started) {
        await adapter.stop();
      }
    });

    test('should reject requests without API key', async () => {
      const res = await sendRequest({
        port,
        path: '/messages/sess-1',
      });

      assert.equal(res.statusCode, 401);
      assert.match(res.body.message, /API key/i);
    });

    test('should reject requests with wrong API key', async () => {
      const res = await sendRequest({
        port,
        path: '/messages/sess-1',
        headers: { 'X-API-Key': 'wrong-key' },
      });

      assert.equal(res.statusCode, 401);
    });

    test('should accept requests with correct X-API-Key header', async () => {
      const res = await sendRequest({
        port,
        path: '/messages/sess-1',
        headers: { 'X-API-Key': 'test-api-key' },
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.ok, true);
    });

    test('should accept requests with correct Bearer token', async () => {
      const res = await sendRequest({
        port,
        path: '/messages/sess-1',
        headers: { Authorization: 'Bearer test-api-key' },
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.ok, true);
    });

    test('should allow CORS preflight without API key', async () => {
      const res = await sendRequest({
        port,
        method: 'OPTIONS',
        path: '/messages',
      });

      assert.equal(res.statusCode, 204);
    });
  });

  // ==========================================================================
  // Base Path Tests
  // ==========================================================================

  describe('basePath', () => {
    let adapter;
    let port;

    beforeEach(async () => {
      port = await getAvailablePort();
      adapter = new RESTAdapter({ port, basePath: '/api/v1' });
      await adapter.initialize();
      await adapter.start();
    });

    afterEach(async () => {
      if (adapter && adapter.started) {
        await adapter.stop();
      }
    });

    test('should route POST /api/v1/messages', async () => {
      const handler = mock.fn();
      adapter.onMessage(handler);

      const res = await sendRequest({
        port,
        method: 'POST',
        path: '/api/v1/messages',
        body: { sessionId: 'sess-1', text: 'Hello' },
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.ok, true);
      assert.equal(handler.mock.callCount(), 1);
    });

    test('should route GET /api/v1/messages/:sessionId', async () => {
      await adapter.sendMessage('bp-sess', 'test');

      const res = await sendRequest({
        port,
        path: '/api/v1/messages/bp-sess',
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.messages.length, 1);
    });

    test('should return 404 for non-prefixed paths', async () => {
      const res = await sendRequest({
        port,
        method: 'POST',
        path: '/messages',
        body: { sessionId: 'sess-1', text: 'Hello' },
      });

      assert.equal(res.statusCode, 404);
    });
  });

  // ==========================================================================
  // Adapter Interface Conformance
  // ==========================================================================

  describe('adapter interface conformance', () => {
    test('should have all required methods', () => {
      const adapter = new RESTAdapter({ port: 3100 });
      assert.equal(typeof adapter.initialize, 'function');
      assert.equal(typeof adapter.start, 'function');
      assert.equal(typeof adapter.stop, 'function');
      assert.equal(typeof adapter.onMessage, 'function');
      assert.equal(typeof adapter.sendMessage, 'function');
    });

    test('should work with ChannelManager adapter registration pattern', async () => {
      // Simulates what ChannelManager.initializeChannel does
      const config = { port: 3100 };
      const adapter = new RESTAdapter(config);
      await adapter.initialize(config);
      assert.equal(adapter.initialized, true);

      const handler = mock.fn();
      adapter.onMessage(handler);
      assert.equal(adapter.messageHandler, handler);
    });
  });
});
