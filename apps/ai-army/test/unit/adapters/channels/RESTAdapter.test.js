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
    assert.ok(error instanceof RESTAdapterError);
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

  test('should handle missing options gracefully', () => {
    const error = new RESTAdapterError('no options');
    assert.equal(error.operation, undefined);
    assert.equal(error.reason, undefined);
    assert.equal(error.cause, undefined);
    assert.equal(error.message, 'no options');
  });

  test('should be throwable and catchable', () => {
    assert.throws(
      () => {
        throw new RESTAdapterError('thrown error');
      },
      err => {
        assert.equal(err.name, 'RESTAdapterError');
        assert.equal(err.message, 'thrown error');
        return true;
      }
    );
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

    test('should throw on null config', () => {
      assert.throws(
        () => new RESTAdapter(null),
        err => {
          assert.ok(err instanceof RESTAdapterError);
          assert.match(err.message, /Config is required/);
          assert.equal(err.operation, 'constructor');
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

    test('should throw if port is NaN', () => {
      assert.throws(
        () => new RESTAdapter({ port: NaN }),
        err => {
          assert.ok(err instanceof RESTAdapterError);
          assert.equal(err.operation, 'constructor');
          assert.match(err.message, /port/);
          return true;
        }
      );
    });

    test('should throw if port is Infinity', () => {
      assert.throws(
        () => new RESTAdapter({ port: Infinity }),
        err => {
          assert.ok(err instanceof RESTAdapterError);
          assert.equal(err.operation, 'constructor');
          assert.match(err.message, /port/);
          return true;
        }
      );
    });

    test('should throw if port is negative Infinity', () => {
      assert.throws(
        () => new RESTAdapter({ port: -Infinity }),
        err => {
          assert.ok(err instanceof RESTAdapterError);
          assert.equal(err.operation, 'constructor');
          assert.match(err.message, /port/);
          return true;
        }
      );
    });

    test('should accept port 0 for ephemeral port binding', () => {
      const adapter = new RESTAdapter({ port: 0 });
      assert.ok(adapter);
      assert.equal(adapter.config.port, 0);
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
      assert.equal(adapter.server, null);
      assert.ok(adapter.responseBuffers instanceof Map);
      assert.equal(adapter.responseBuffers.size, 0);
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

    test('should strip multiple trailing slashes from basePath', () => {
      const adapter = new RESTAdapter({ port: 3100, basePath: '/api///' });
      assert.equal(adapter.config.basePath, '/api');
    });

    test('should add leading slash to basePath when missing', () => {
      const adapter = new RESTAdapter({ port: 3100, basePath: 'api/v1' });
      assert.equal(adapter.config.basePath, '/api/v1');
    });

    test('should normalize basePath with missing leading slash and trailing slash', () => {
      const adapter = new RESTAdapter({ port: 3100, basePath: 'api/v1/' });
      assert.equal(adapter.config.basePath, '/api/v1');
    });

    test('should keep empty basePath as empty string', () => {
      const adapter = new RESTAdapter({ port: 3100, basePath: '' });
      assert.equal(adapter.config.basePath, '');
    });

    test('should accept extra config fields', () => {
      const adapter = new RESTAdapter({ port: 3100, extraField: 'ignored' });
      assert.ok(adapter);
      // Extra fields are not preserved in normalized config
      assert.equal(adapter.config.port, 3100);
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

    test('should throw RESTAdapterError for NaN port override in initialize config', async () => {
      const adapter = new RESTAdapter({ port: 3100 });
      await assert.rejects(
        () => adapter.initialize({ port: NaN }),
        err => {
          assert.ok(err instanceof RESTAdapterError);
          assert.equal(err.operation, 'initialize');
          assert.match(err.message, /port must be a finite number/);
          return true;
        }
      );
      // Port should remain unchanged
      assert.equal(adapter.config.port, 3100);
    });

    test('should throw RESTAdapterError for Infinity port override in initialize config', async () => {
      const adapter = new RESTAdapter({ port: 3100 });
      await assert.rejects(
        () => adapter.initialize({ port: Infinity }),
        err => {
          assert.ok(err instanceof RESTAdapterError);
          assert.equal(err.operation, 'initialize');
          assert.match(err.message, /port must be a finite number/);
          return true;
        }
      );
      // Port should remain unchanged
      assert.equal(adapter.config.port, 3100);
    });

    test('should accept valid port override in initialize config', async () => {
      const adapter = new RESTAdapter({ port: 3100 });
      await adapter.initialize({ port: 4200 });
      assert.equal(adapter.config.port, 4200);
    });
  });

  describe('onMessage', () => {
    test('should register a handler function', () => {
      const adapter = new RESTAdapter({ port: 3100 });
      const handler = mock.fn();
      adapter.onMessage(handler);
      assert.equal(adapter.messageHandler, handler);
    });

    test('should replace existing handler', () => {
      const adapter = new RESTAdapter({ port: 3100 });
      const handler1 = mock.fn();
      const handler2 = mock.fn();
      adapter.onMessage(handler1);
      adapter.onMessage(handler2);
      assert.equal(adapter.messageHandler, handler2);
    });

    test('should accept sync functions', () => {
      const adapter = new RESTAdapter({ port: 3100 });
      const handler = () => {};
      adapter.onMessage(handler);
      assert.equal(adapter.messageHandler, handler);
    });

    test('should accept async functions', () => {
      const adapter = new RESTAdapter({ port: 3100 });
      const handler = async () => {};
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
          assert.match(err.reason, /object/);
          return true;
        }
      );
    });

    test('should throw if handler is a number', () => {
      const adapter = new RESTAdapter({ port: 3100 });
      assert.throws(
        () => adapter.onMessage(42),
        err => {
          assert.ok(err instanceof RESTAdapterError);
          assert.equal(err.operation, 'onMessage');
          assert.match(err.reason, /number/);
          return true;
        }
      );
    });

    test('should throw if handler is undefined', () => {
      const adapter = new RESTAdapter({ port: 3100 });
      assert.throws(
        () => adapter.onMessage(undefined),
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

    test('should throw if channelId is null', async () => {
      const adapter = new RESTAdapter({ port: 3100 });
      await adapter.initialize();
      await assert.rejects(
        () => adapter.sendMessage(null, 'hello'),
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

    test('should throw if text is null', async () => {
      const adapter = new RESTAdapter({ port: 3100 });
      await adapter.initialize();
      await assert.rejects(
        () => adapter.sendMessage('session-1', null),
        err => {
          assert.ok(err instanceof RESTAdapterError);
          assert.equal(err.operation, 'sendMessage');
          assert.match(err.message, /text/);
          return true;
        }
      );
    });

    test('should allow empty string text', async () => {
      const adapter = new RESTAdapter({ port: 3100 });
      await adapter.initialize();
      await adapter.sendMessage('session-1', '');

      const buf = adapter.responseBuffers.get('session-1');
      assert.equal(buf.length, 1);
      assert.equal(buf[0].text, '');
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

    test('should include ISO timestamp in buffered messages', async () => {
      const adapter = new RESTAdapter({ port: 3100 });
      await adapter.initialize();
      await adapter.sendMessage('session-1', 'test');

      const buf = adapter.responseBuffers.get('session-1');
      assert.equal(buf.length, 1);
      // Verify it's a valid ISO date string
      const parsed = new Date(buf[0].timestamp);
      assert.ok(!isNaN(parsed.getTime()));
    });

    test('should send messages with special characters', async () => {
      const adapter = new RESTAdapter({ port: 3100 });
      await adapter.initialize();
      const text = 'Hello <b>bold</b> & "quotes" \'single\' `backticks`';
      await adapter.sendMessage('session-1', text);

      const buf = adapter.responseBuffers.get('session-1');
      assert.equal(buf[0].text, text);
    });

    test('should send long messages', async () => {
      const adapter = new RESTAdapter({ port: 3100 });
      await adapter.initialize();
      const longText = 'x'.repeat(10000);
      await adapter.sendMessage('session-1', longText);

      const buf = adapter.responseBuffers.get('session-1');
      assert.equal(buf[0].text, longText);
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

    test('should include CORS headers on regular responses', async () => {
      const res = await sendRequest({ port, path: '/messages/test-session' });
      assert.equal(res.headers['access-control-allow-origin'], '*');
      assert.ok(res.headers['access-control-allow-methods']);
      assert.ok(res.headers['access-control-allow-headers']);
    });

    test('should return 404 for unsupported HTTP methods', async () => {
      const res = await sendRequest({ port, method: 'DELETE', path: '/messages' });
      assert.equal(res.statusCode, 404);
    });

    test('should return 404 for PUT to /messages', async () => {
      const res = await sendRequest({
        port,
        method: 'PUT',
        path: '/messages',
        body: { sessionId: 'sess-1', text: 'Hello' },
      });
      assert.equal(res.statusCode, 404);
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

      test('should return 500 when async message handler rejects', async () => {
        adapter.onMessage(async () => {
          throw new Error('async handler failed');
        });

        const res = await sendRequest({
          port,
          method: 'POST',
          path: '/messages',
          body: { sessionId: 'sess-1', text: 'Hello' },
        });

        assert.equal(res.statusCode, 500);
        assert.match(res.body.message, /async handler/i);
      });

      test('should return 400 for non-string sessionId', async () => {
        const res = await sendRequest({
          port,
          method: 'POST',
          path: '/messages',
          body: { sessionId: 123, text: 'Hello' },
        });

        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /sessionId/);
      });

      test('should return 400 for empty-string sessionId', async () => {
        const res = await sendRequest({
          port,
          method: 'POST',
          path: '/messages',
          body: { sessionId: '', text: 'Hello' },
        });

        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /sessionId/);
      });

      test('should return 400 for non-string text', async () => {
        const res = await sendRequest({
          port,
          method: 'POST',
          path: '/messages',
          body: { sessionId: 'sess-1', text: 42 },
        });

        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /text/);
      });

      test('should default metadata to empty object when not provided', async () => {
        const handler = mock.fn();
        adapter.onMessage(handler);

        await sendRequest({
          port,
          method: 'POST',
          path: '/messages',
          body: { sessionId: 'sess-1', text: 'Hello' },
        });

        const msg = handler.mock.calls[0].arguments[0];
        assert.deepStrictEqual(msg.metadata, {});
      });

      test('should handle empty body gracefully', async () => {
        const res = await sendRequest({
          port,
          method: 'POST',
          path: '/messages',
          headers: { 'Content-Type': 'application/json', 'Content-Length': '0' },
        });

        // Empty body parses to {} which lacks sessionId
        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /sessionId/);
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

      test('should not grow responseBuffers map when polling unknown sessions', async () => {
        const sizeBefore = adapter.responseBuffers.size;

        await sendRequest({ port, path: '/messages/random-session-1' });
        await sendRequest({ port, path: '/messages/random-session-2' });
        await sendRequest({ port, path: '/messages/random-session-3' });

        assert.equal(adapter.responseBuffers.size, sizeBefore);
      });

      test('should delete buffer entry after draining messages', async () => {
        await adapter.sendMessage('drain-sess', 'hello');
        assert.equal(adapter.responseBuffers.has('drain-sess'), true);

        await sendRequest({ port, path: '/messages/drain-sess' });
        assert.equal(adapter.responseBuffers.has('drain-sess'), false);
      });

      test('should return 400 for malformed percent-encoded session ID', async () => {
        const res = await sendRequest({
          port,
          path: '/messages/%E0%A4',
        });

        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /URL encoding/i);
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

      test('should include timestamp in polled messages', async () => {
        await adapter.sendMessage('sess-ts', 'timestamped');

        const res = await sendRequest({
          port,
          path: '/messages/sess-ts',
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.messages.length, 1);
        assert.ok(res.body.messages[0].timestamp);
        // Verify it's a valid ISO date string
        const parsed = new Date(res.body.messages[0].timestamp);
        assert.ok(!isNaN(parsed.getTime()));
      });

      test('should isolate buffers between sessions', async () => {
        await adapter.sendMessage('sess-a', 'for-a');
        await adapter.sendMessage('sess-b', 'for-b');

        const resA = await sendRequest({ port, path: '/messages/sess-a' });
        const resB = await sendRequest({ port, path: '/messages/sess-b' });

        assert.equal(resA.body.messages.length, 1);
        assert.equal(resA.body.messages[0].text, 'for-a');
        assert.equal(resB.body.messages.length, 1);
        assert.equal(resB.body.messages[0].text, 'for-b');
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

    test('should reject POST /messages without API key', async () => {
      const res = await sendRequest({
        port,
        method: 'POST',
        path: '/messages',
        body: { sessionId: 'sess-1', text: 'Hello' },
      });

      assert.equal(res.statusCode, 401);
    });

    test('should accept POST /messages with correct API key', async () => {
      const handler = mock.fn();
      adapter.onMessage(handler);

      const res = await sendRequest({
        port,
        method: 'POST',
        path: '/messages',
        headers: { 'X-API-Key': 'test-api-key' },
        body: { sessionId: 'sess-1', text: 'Hello' },
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.ok, true);
      assert.equal(handler.mock.callCount(), 1);
    });

    test('should reject requests with malformed Bearer token', async () => {
      const res = await sendRequest({
        port,
        path: '/messages/sess-1',
        headers: { Authorization: 'Basic dXNlcjpwYXNz' },
      });

      assert.equal(res.statusCode, 401);
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

    test('should have private helper methods', () => {
      const adapter = new RESTAdapter({ port: 3100 });
      assert.equal(typeof adapter._handleRequest, 'function');
      assert.equal(typeof adapter._handleInboundMessage, 'function');
      assert.equal(typeof adapter._handlePollMessages, 'function');
      assert.equal(typeof adapter._parseJsonBody, 'function');
      assert.equal(typeof adapter._sendJson, 'function');
      assert.equal(typeof adapter._extractBearerToken, 'function');
      assert.equal(typeof adapter._escapeRegExp, 'function');
      assert.equal(typeof adapter._normalizeBasePath, 'function');
    });
  });

  // ==========================================================================
  // Full Lifecycle Tests
  // ==========================================================================

  describe('full lifecycle', () => {
    test('should support complete init -> start -> stop lifecycle', async () => {
      const port = await getAvailablePort();
      const adapter = new RESTAdapter({ port });

      // Initialize
      await adapter.initialize();
      assert.equal(adapter.initialized, true);
      assert.ok(adapter.server);

      // Start
      await adapter.start();
      assert.equal(adapter.started, true);

      // Stop
      await adapter.stop();
      assert.equal(adapter.started, false);
    });

    test('should support port 0 for ephemeral port binding', async () => {
      const adapter = new RESTAdapter({ port: 0 });
      await adapter.initialize();
      await adapter.start();

      // The OS assigns an ephemeral port; verify the server is listening
      const addr = adapter.server.address();
      assert.ok(addr.port > 0, 'OS should assign a non-zero ephemeral port');

      // Verify HTTP works on the ephemeral port
      const res = await sendRequest({
        port: addr.port,
        path: '/messages/test-session',
      });
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.ok, true);

      await adapter.stop();
    });

    test('should allow message sending after init', async () => {
      const adapter = new RESTAdapter({ port: 3100 });
      await adapter.initialize();

      await adapter.sendMessage('session-1', 'test message');
      const buf = adapter.responseBuffers.get('session-1');
      assert.equal(buf.length, 1);
      assert.equal(buf[0].text, 'test message');
    });

    test('should handle event registration and message flow', async () => {
      const port = await getAvailablePort();
      const adapter = new RESTAdapter({ port });
      await adapter.initialize();
      await adapter.start();

      // Register handler that echoes back via sendMessage
      adapter.onMessage(async msg => {
        await adapter.sendMessage(msg.channelId, `Echo: ${msg.text}`);
      });

      // Send inbound message
      const postRes = await sendRequest({
        port,
        method: 'POST',
        path: '/messages',
        body: { sessionId: 'echo-sess', text: 'hello' },
      });
      assert.equal(postRes.statusCode, 200);

      // Poll for response
      const getRes = await sendRequest({
        port,
        path: '/messages/echo-sess',
      });
      assert.equal(getRes.statusCode, 200);
      assert.equal(getRes.body.messages.length, 1);
      assert.equal(getRes.body.messages[0].text, 'Echo: hello');

      await adapter.stop();
    });

    test('should handle multiple request-response cycles', async () => {
      const port = await getAvailablePort();
      const adapter = new RESTAdapter({ port });
      await adapter.initialize();
      await adapter.start();

      adapter.onMessage(async msg => {
        await adapter.sendMessage(msg.channelId, `Reply to: ${msg.text}`);
      });

      // First cycle
      await sendRequest({
        port,
        method: 'POST',
        path: '/messages',
        body: { sessionId: 'multi-sess', text: 'first' },
      });

      const res1 = await sendRequest({ port, path: '/messages/multi-sess' });
      assert.equal(res1.body.messages.length, 1);
      assert.equal(res1.body.messages[0].text, 'Reply to: first');

      // Second cycle
      await sendRequest({
        port,
        method: 'POST',
        path: '/messages',
        body: { sessionId: 'multi-sess', text: 'second' },
      });

      const res2 = await sendRequest({ port, path: '/messages/multi-sess' });
      assert.equal(res2.body.messages.length, 1);
      assert.equal(res2.body.messages[0].text, 'Reply to: second');

      await adapter.stop();
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('edge cases', () => {
    test('should handle stop called multiple times', async () => {
      const port = await getAvailablePort();
      const adapter = new RESTAdapter({ port });
      await adapter.initialize();
      await adapter.start();

      await adapter.stop();
      // Second call should be no-op
      await adapter.stop();
      assert.equal(adapter.started, false);
    });

    test('should handle start called multiple times', async () => {
      const port = await getAvailablePort();
      const adapter = new RESTAdapter({ port });
      await adapter.initialize();

      await adapter.start();
      // Second call should be no-op (idempotent)
      await adapter.start();
      assert.equal(adapter.started, true);

      await adapter.stop();
    });

    test('should handle adapter with all config fields', () => {
      const adapter = new RESTAdapter({
        port: 3100,
        host: '127.0.0.1',
        basePath: '/api/v1',
        apiKey: 'my-secret',
      });
      assert.ok(adapter);
      assert.equal(adapter.config.port, 3100);
      assert.equal(adapter.config.host, '127.0.0.1');
      assert.equal(adapter.config.basePath, '/api/v1');
      assert.equal(adapter.config.apiKey, 'my-secret');
    });

    test('should handle _extractBearerToken with various inputs', () => {
      const adapter = new RESTAdapter({ port: 3100 });

      assert.equal(adapter._extractBearerToken('Bearer my-token'), 'my-token');
      assert.equal(adapter._extractBearerToken('bearer MY-TOKEN'), 'MY-TOKEN');
      assert.equal(adapter._extractBearerToken('Basic dXNlcjpwYXNz'), null);
      assert.equal(adapter._extractBearerToken(''), null);
      assert.equal(adapter._extractBearerToken(null), null);
      assert.equal(adapter._extractBearerToken(undefined), null);
      assert.equal(adapter._extractBearerToken(123), null);
    });

    test('should handle _normalizeBasePath with various inputs', () => {
      const adapter = new RESTAdapter({ port: 3100 });

      assert.equal(adapter._normalizeBasePath('/api/v1'), '/api/v1');
      assert.equal(adapter._normalizeBasePath('api/v1'), '/api/v1');
      assert.equal(adapter._normalizeBasePath('/api/v1/'), '/api/v1');
      assert.equal(adapter._normalizeBasePath('api/v1/'), '/api/v1');
      assert.equal(adapter._normalizeBasePath(''), '');
      assert.equal(adapter._normalizeBasePath(null), '');
      assert.equal(adapter._normalizeBasePath(undefined), '');
      assert.equal(adapter._normalizeBasePath('/'), '');
      assert.equal(adapter._normalizeBasePath('///'), '');
    });

    test('should handle _escapeRegExp with special characters', () => {
      const adapter = new RESTAdapter({ port: 3100 });

      // Forward slashes are not special regex chars, so not escaped
      assert.equal(adapter._escapeRegExp('/api/v1'), '/api/v1');
      assert.equal(adapter._escapeRegExp('test.path'), 'test\\.path');
      assert.equal(adapter._escapeRegExp(''), '');
      assert.equal(adapter._escapeRegExp('simple'), 'simple');
      assert.equal(adapter._escapeRegExp('a+b*c?'), 'a\\+b\\*c\\?');
      assert.equal(adapter._escapeRegExp('(group)'), '\\(group\\)');
      assert.equal(adapter._escapeRegExp('[bracket]'), '\\[bracket\\]');
    });

    test('should handle basePath with special regex characters', async () => {
      const port = await getAvailablePort();
      const adapter = new RESTAdapter({ port, basePath: '/api.v1' });
      await adapter.initialize();
      await adapter.start();

      const handler = mock.fn();
      adapter.onMessage(handler);

      const res = await sendRequest({
        port,
        method: 'POST',
        path: '/api.v1/messages',
        body: { sessionId: 'sess-1', text: 'Hello' },
      });

      assert.equal(res.statusCode, 200);
      assert.equal(handler.mock.callCount(), 1);

      await adapter.stop();
    });

    test('should handle concurrent messages to different sessions', async () => {
      const adapter = new RESTAdapter({ port: 3100 });
      await adapter.initialize();

      // Send messages concurrently
      await Promise.all([
        adapter.sendMessage('sess-a', 'msg-a'),
        adapter.sendMessage('sess-b', 'msg-b'),
        adapter.sendMessage('sess-c', 'msg-c'),
      ]);

      assert.equal(adapter.responseBuffers.get('sess-a').length, 1);
      assert.equal(adapter.responseBuffers.get('sess-b').length, 1);
      assert.equal(adapter.responseBuffers.get('sess-c').length, 1);
    });

    test('should handle response content-type as JSON', async () => {
      const port = await getAvailablePort();
      const adapter = new RESTAdapter({ port });
      await adapter.initialize();
      await adapter.start();

      const res = await sendRequest({ port, path: '/messages/test' });
      assert.ok(res.headers['content-type'].includes('application/json'));

      await adapter.stop();
    });
  });
});
