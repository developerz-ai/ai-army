/**
 * Integration tests for RESTAdapter
 *
 * Tests the REST channel adapter with real HTTP requests against a running
 * server. Unlike unit tests (which test individual methods and validation),
 * these integration tests verify end-to-end flows:
 *
 * - Full lifecycle: init → start → HTTP request → handler → response → poll → stop
 * - Multi-session concurrent request handling
 * - API key authentication with real HTTP requests
 * - basePath routing with real HTTP traffic
 * - Message buffering and draining across multiple poll cycles
 * - Unicode and special character handling over HTTP
 * - CORS headers in real responses
 * - Error recovery and graceful degradation
 *
 * @module test/integration/adapters/RESTAdapter
 */

import { describe, test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { RESTAdapter, RESTAdapterError } from '../../../src/adapters/channels/rest.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Get a random available port by binding to port 0
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
 * Send an HTTP request to the test server and parse the response
 * @param {Object} options - Request options
 * @param {number} options.port - Server port
 * @param {string} [options.method='GET'] - HTTP method
 * @param {string} [options.path='/'] - Request path
 * @param {Object} [options.headers={}] - Request headers
 * @param {string|Object} [options.body] - Request body (objects are JSON-serialized)
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
 * Create, initialize, and start a RESTAdapter on a random port
 * @param {Object} [configOverrides] - Config overrides
 * @returns {Promise<{adapter: RESTAdapter, port: number}>}
 */
async function createRunningAdapter(configOverrides = {}) {
  const port = await getAvailablePort();
  const adapter = new RESTAdapter({ port, ...configOverrides });
  await adapter.initialize();
  await adapter.start();
  return { adapter, port };
}

// ============================================================================
// Integration Tests
// ============================================================================

describe('RESTAdapter integration', () => {
  // ==========================================================================
  // Full Lifecycle Flow
  // ==========================================================================

  describe('full lifecycle flow', () => {
    let adapter;
    let port;

    afterEach(async () => {
      if (adapter && adapter.started) {
        await adapter.stop();
      }
    });

    test('complete init → start → POST → handler → sendMessage → GET → stop', async () => {
      ({ adapter, port } = await createRunningAdapter());

      const receivedMessages = [];
      adapter.onMessage(async msg => {
        receivedMessages.push(msg);
        await adapter.sendMessage(msg.channelId, `Echo: ${msg.text}`);
      });

      // Send inbound message via HTTP
      const postRes = await sendRequest({
        port,
        method: 'POST',
        path: '/messages',
        body: { sessionId: 'session-1', text: 'Hello bot', userId: 'user-42' },
      });

      assert.equal(postRes.statusCode, 200);
      assert.equal(postRes.body.ok, true);
      assert.equal(postRes.body.sessionId, 'session-1');

      // Verify handler received correct message
      assert.equal(receivedMessages.length, 1);
      const msg = receivedMessages[0];
      assert.equal(msg.type, 'rest');
      assert.equal(msg.channelId, 'session-1');
      assert.equal(msg.text, 'Hello bot');
      assert.equal(msg.userId, 'user-42');
      assert.equal(msg.isDM, true);
      assert.deepStrictEqual(msg.metadata, {});

      // Poll for response
      const getRes = await sendRequest({
        port,
        path: '/messages/session-1',
      });

      assert.equal(getRes.statusCode, 200);
      assert.equal(getRes.body.ok, true);
      assert.equal(getRes.body.sessionId, 'session-1');
      assert.equal(getRes.body.messages.length, 1);
      assert.equal(getRes.body.messages[0].text, 'Echo: Hello bot');
      assert.ok(getRes.body.messages[0].timestamp);

      // Stop gracefully
      await adapter.stop();
      assert.equal(adapter.started, false);
    });

    test('multiple request-response cycles on same session', async () => {
      ({ adapter, port } = await createRunningAdapter());

      adapter.onMessage(async msg => {
        await adapter.sendMessage(msg.channelId, `Reply #${msg.text}`);
      });

      for (let i = 1; i <= 3; i++) {
        // Send message
        const postRes = await sendRequest({
          port,
          method: 'POST',
          path: '/messages',
          body: { sessionId: 'cycle-session', text: String(i) },
        });
        assert.equal(postRes.statusCode, 200);

        // Poll response
        const getRes = await sendRequest({
          port,
          path: '/messages/cycle-session',
        });
        assert.equal(getRes.statusCode, 200);
        assert.equal(getRes.body.messages.length, 1);
        assert.equal(getRes.body.messages[0].text, `Reply #${i}`);
      }

      await adapter.stop();
    });

    test('handler that sends multiple responses to one message', async () => {
      ({ adapter, port } = await createRunningAdapter());

      adapter.onMessage(async msg => {
        await adapter.sendMessage(msg.channelId, 'Thinking...');
        await adapter.sendMessage(msg.channelId, 'Here is the answer');
        await adapter.sendMessage(msg.channelId, 'Hope that helps!');
      });

      await sendRequest({
        port,
        method: 'POST',
        path: '/messages',
        body: { sessionId: 'multi-reply', text: 'question' },
      });

      const getRes = await sendRequest({
        port,
        path: '/messages/multi-reply',
      });

      assert.equal(getRes.body.messages.length, 3);
      assert.equal(getRes.body.messages[0].text, 'Thinking...');
      assert.equal(getRes.body.messages[1].text, 'Here is the answer');
      assert.equal(getRes.body.messages[2].text, 'Hope that helps!');

      await adapter.stop();
    });
  });

  // ==========================================================================
  // Multi-Session Handling
  // ==========================================================================

  describe('multi-session handling', () => {
    let adapter;
    let port;

    afterEach(async () => {
      if (adapter && adapter.started) {
        await adapter.stop();
      }
    });

    test('isolates messages between different sessions', async () => {
      ({ adapter, port } = await createRunningAdapter());

      adapter.onMessage(async msg => {
        await adapter.sendMessage(msg.channelId, `For ${msg.channelId}: ${msg.text}`);
      });

      // Send messages to different sessions
      await sendRequest({
        port,
        method: 'POST',
        path: '/messages',
        body: { sessionId: 'alice', text: 'hi from alice' },
      });

      await sendRequest({
        port,
        method: 'POST',
        path: '/messages',
        body: { sessionId: 'bob', text: 'hi from bob' },
      });

      // Poll each session — verify isolation
      const aliceRes = await sendRequest({ port, path: '/messages/alice' });
      assert.equal(aliceRes.body.messages.length, 1);
      assert.equal(aliceRes.body.messages[0].text, 'For alice: hi from alice');

      const bobRes = await sendRequest({ port, path: '/messages/bob' });
      assert.equal(bobRes.body.messages.length, 1);
      assert.equal(bobRes.body.messages[0].text, 'For bob: hi from bob');

      await adapter.stop();
    });

    test('concurrent requests to different sessions', async () => {
      ({ adapter, port } = await createRunningAdapter());

      adapter.onMessage(async msg => {
        await adapter.sendMessage(msg.channelId, `Response for ${msg.userId}`);
      });

      // Fire concurrent POST requests
      const posts = await Promise.all(
        ['user-1', 'user-2', 'user-3'].map(userId =>
          sendRequest({
            port,
            method: 'POST',
            path: '/messages',
            body: { sessionId: `sess-${userId}`, text: 'ping', userId },
          })
        )
      );

      // All should succeed
      for (const res of posts) {
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.ok, true);
      }

      // Verify each session has its response
      for (const userId of ['user-1', 'user-2', 'user-3']) {
        const getRes = await sendRequest({
          port,
          path: `/messages/sess-${userId}`,
        });
        assert.equal(getRes.body.messages.length, 1);
        assert.equal(getRes.body.messages[0].text, `Response for ${userId}`);
      }

      await adapter.stop();
    });

    test('polling drains the buffer — second poll returns empty', async () => {
      ({ adapter, port } = await createRunningAdapter());

      await adapter.sendMessage('drain-test', 'message-1');
      await adapter.sendMessage('drain-test', 'message-2');

      // First poll gets all messages
      const poll1 = await sendRequest({ port, path: '/messages/drain-test' });
      assert.equal(poll1.body.messages.length, 2);

      // Second poll returns empty
      const poll2 = await sendRequest({ port, path: '/messages/drain-test' });
      assert.equal(poll2.body.messages.length, 0);

      // New messages appear on third poll
      await adapter.sendMessage('drain-test', 'message-3');
      const poll3 = await sendRequest({ port, path: '/messages/drain-test' });
      assert.equal(poll3.body.messages.length, 1);
      assert.equal(poll3.body.messages[0].text, 'message-3');

      await adapter.stop();
    });

    test('polling a non-existent session returns empty array', async () => {
      ({ adapter, port } = await createRunningAdapter());

      const res = await sendRequest({ port, path: '/messages/never-existed' });

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.sessionId, 'never-existed');
      assert.deepStrictEqual(res.body.messages, []);

      await adapter.stop();
    });
  });

  // ==========================================================================
  // API Key Authentication Over HTTP
  // ==========================================================================

  describe('API key authentication over HTTP', () => {
    let adapter;
    let port;
    const API_KEY = 'integration-test-secret-key';

    afterEach(async () => {
      if (adapter && adapter.started) {
        await adapter.stop();
      }
    });

    test('rejects POST without API key', async () => {
      ({ adapter, port } = await createRunningAdapter({ apiKey: API_KEY }));

      const res = await sendRequest({
        port,
        method: 'POST',
        path: '/messages',
        body: { sessionId: 'sess-1', text: 'Hello' },
      });

      assert.equal(res.statusCode, 401);
      assert.match(res.body.message, /API key/i);
    });

    test('rejects GET without API key', async () => {
      ({ adapter, port } = await createRunningAdapter({ apiKey: API_KEY }));

      const res = await sendRequest({ port, path: '/messages/sess-1' });

      assert.equal(res.statusCode, 401);
    });

    test('accepts X-API-Key header for full request-response flow', async () => {
      ({ adapter, port } = await createRunningAdapter({ apiKey: API_KEY }));

      const handler = mock.fn();
      adapter.onMessage(handler);

      // POST with API key
      const postRes = await sendRequest({
        port,
        method: 'POST',
        path: '/messages',
        headers: { 'X-API-Key': API_KEY },
        body: { sessionId: 'auth-sess', text: 'Authenticated message' },
      });
      assert.equal(postRes.statusCode, 200);
      assert.equal(handler.mock.callCount(), 1);

      // GET with API key
      await adapter.sendMessage('auth-sess', 'Authenticated reply');
      const getRes = await sendRequest({
        port,
        path: '/messages/auth-sess',
        headers: { 'X-API-Key': API_KEY },
      });
      assert.equal(getRes.statusCode, 200);
      assert.equal(getRes.body.messages.length, 1);
      assert.equal(getRes.body.messages[0].text, 'Authenticated reply');

      await adapter.stop();
    });

    test('accepts Bearer token for full request-response flow', async () => {
      ({ adapter, port } = await createRunningAdapter({ apiKey: API_KEY }));

      const handler = mock.fn();
      adapter.onMessage(handler);

      const postRes = await sendRequest({
        port,
        method: 'POST',
        path: '/messages',
        headers: { Authorization: `Bearer ${API_KEY}` },
        body: { sessionId: 'bearer-sess', text: 'Bearer authenticated' },
      });
      assert.equal(postRes.statusCode, 200);
      assert.equal(handler.mock.callCount(), 1);

      await adapter.stop();
    });

    test('allows CORS preflight without API key', async () => {
      ({ adapter, port } = await createRunningAdapter({ apiKey: API_KEY }));

      const res = await sendRequest({
        port,
        method: 'OPTIONS',
        path: '/messages',
      });

      assert.equal(res.statusCode, 204);
      assert.ok(res.headers['access-control-allow-origin']);

      await adapter.stop();
    });

    test('rejects requests with wrong API key', async () => {
      ({ adapter, port } = await createRunningAdapter({ apiKey: API_KEY }));

      const res = await sendRequest({
        port,
        method: 'POST',
        path: '/messages',
        headers: { 'X-API-Key': 'wrong-key' },
        body: { sessionId: 'sess-1', text: 'Hello' },
      });

      assert.equal(res.statusCode, 401);

      await adapter.stop();
    });
  });

  // ==========================================================================
  // basePath Routing Over HTTP
  // ==========================================================================

  describe('basePath routing over HTTP', () => {
    let adapter;
    let port;

    afterEach(async () => {
      if (adapter && adapter.started) {
        await adapter.stop();
      }
    });

    test('routes requests through basePath prefix', async () => {
      ({ adapter, port } = await createRunningAdapter({ basePath: '/api/v1' }));

      const handler = mock.fn();
      adapter.onMessage(handler);

      // POST to prefixed path
      const postRes = await sendRequest({
        port,
        method: 'POST',
        path: '/api/v1/messages',
        body: { sessionId: 'bp-sess', text: 'basePath message' },
      });
      assert.equal(postRes.statusCode, 200);
      assert.equal(handler.mock.callCount(), 1);

      // GET from prefixed path
      await adapter.sendMessage('bp-sess', 'basePath reply');
      const getRes = await sendRequest({
        port,
        path: '/api/v1/messages/bp-sess',
      });
      assert.equal(getRes.statusCode, 200);
      assert.equal(getRes.body.messages.length, 1);
      assert.equal(getRes.body.messages[0].text, 'basePath reply');

      await adapter.stop();
    });

    test('returns 404 for non-prefixed paths when basePath is set', async () => {
      ({ adapter, port } = await createRunningAdapter({ basePath: '/api/v1' }));

      const res = await sendRequest({
        port,
        method: 'POST',
        path: '/messages',
        body: { sessionId: 'sess-1', text: 'Hello' },
      });

      assert.equal(res.statusCode, 404);

      await adapter.stop();
    });

    test('combined basePath + apiKey authentication', async () => {
      ({ adapter, port } = await createRunningAdapter({
        basePath: '/api/v2',
        apiKey: 'combo-key',
      }));

      const handler = mock.fn();
      adapter.onMessage(handler);

      // Without API key — rejected
      const noKeyRes = await sendRequest({
        port,
        method: 'POST',
        path: '/api/v2/messages',
        body: { sessionId: 'sess-1', text: 'Hello' },
      });
      assert.equal(noKeyRes.statusCode, 401);

      // With API key on correct path — accepted
      const authRes = await sendRequest({
        port,
        method: 'POST',
        path: '/api/v2/messages',
        headers: { 'X-API-Key': 'combo-key' },
        body: { sessionId: 'sess-1', text: 'Hello' },
      });
      assert.equal(authRes.statusCode, 200);
      assert.equal(handler.mock.callCount(), 1);

      await adapter.stop();
    });
  });

  // ==========================================================================
  // CORS Headers
  // ==========================================================================

  describe('CORS headers', () => {
    let adapter;
    let port;

    afterEach(async () => {
      if (adapter && adapter.started) {
        await adapter.stop();
      }
    });

    test('includes CORS headers on POST response', async () => {
      ({ adapter, port } = await createRunningAdapter());

      const res = await sendRequest({
        port,
        method: 'POST',
        path: '/messages',
        body: { sessionId: 'cors-sess', text: 'Hello' },
      });

      assert.equal(res.headers['access-control-allow-origin'], '*');
      assert.ok(res.headers['access-control-allow-methods']);
      assert.ok(res.headers['access-control-allow-headers']);

      await adapter.stop();
    });

    test('includes CORS headers on GET response', async () => {
      ({ adapter, port } = await createRunningAdapter());

      const res = await sendRequest({ port, path: '/messages/any-session' });

      assert.equal(res.headers['access-control-allow-origin'], '*');
      assert.ok(res.headers['access-control-allow-methods'].includes('GET'));
      assert.ok(res.headers['access-control-allow-methods'].includes('POST'));

      await adapter.stop();
    });

    test('includes CORS headers on 404 response', async () => {
      ({ adapter, port } = await createRunningAdapter());

      const res = await sendRequest({ port, path: '/not-found' });

      assert.equal(res.statusCode, 404);
      assert.equal(res.headers['access-control-allow-origin'], '*');

      await adapter.stop();
    });

    test('OPTIONS preflight returns 204 with correct headers', async () => {
      ({ adapter, port } = await createRunningAdapter());

      const res = await sendRequest({
        port,
        method: 'OPTIONS',
        path: '/messages',
      });

      assert.equal(res.statusCode, 204);
      assert.equal(res.headers['access-control-allow-origin'], '*');
      assert.ok(res.headers['access-control-allow-headers'].includes('X-API-Key'));

      await adapter.stop();
    });
  });

  // ==========================================================================
  // Error Handling Over HTTP
  // ==========================================================================

  describe('error handling over HTTP', () => {
    let adapter;
    let port;

    afterEach(async () => {
      if (adapter && adapter.started) {
        await adapter.stop();
      }
    });

    test('returns 400 for invalid JSON body', async () => {
      ({ adapter, port } = await createRunningAdapter());

      const res = await sendRequest({
        port,
        method: 'POST',
        path: '/messages',
        headers: { 'Content-Type': 'application/json', 'Content-Length': '12' },
        body: 'not-valid-js',
      });

      assert.equal(res.statusCode, 400);
      assert.match(res.body.message, /Invalid JSON/i);

      await adapter.stop();
    });

    test('returns 400 for missing sessionId', async () => {
      ({ adapter, port } = await createRunningAdapter());

      const res = await sendRequest({
        port,
        method: 'POST',
        path: '/messages',
        body: { text: 'Hello' },
      });

      assert.equal(res.statusCode, 400);
      assert.match(res.body.message, /sessionId/);

      await adapter.stop();
    });

    test('returns 400 for missing text', async () => {
      ({ adapter, port } = await createRunningAdapter());

      const res = await sendRequest({
        port,
        method: 'POST',
        path: '/messages',
        body: { sessionId: 'sess-1' },
      });

      assert.equal(res.statusCode, 400);
      assert.match(res.body.message, /text/);

      await adapter.stop();
    });

    test('returns 500 when message handler throws synchronously', async () => {
      ({ adapter, port } = await createRunningAdapter());

      adapter.onMessage(() => {
        throw new Error('sync handler explosion');
      });

      const res = await sendRequest({
        port,
        method: 'POST',
        path: '/messages',
        body: { sessionId: 'err-sess', text: 'trigger error' },
      });

      assert.equal(res.statusCode, 500);
      assert.match(res.body.message, /handler/i);

      await adapter.stop();
    });

    test('returns 500 when message handler rejects', async () => {
      ({ adapter, port } = await createRunningAdapter());

      adapter.onMessage(async () => {
        throw new Error('async handler failure');
      });

      const res = await sendRequest({
        port,
        method: 'POST',
        path: '/messages',
        body: { sessionId: 'err-sess', text: 'trigger async error' },
      });

      assert.equal(res.statusCode, 500);
      assert.match(res.body.message, /handler/i);

      await adapter.stop();
    });

    test('returns 404 for unsupported methods', async () => {
      ({ adapter, port } = await createRunningAdapter());

      const deleteRes = await sendRequest({
        port,
        method: 'DELETE',
        path: '/messages',
      });
      assert.equal(deleteRes.statusCode, 404);

      const putRes = await sendRequest({
        port,
        method: 'PUT',
        path: '/messages',
        body: { sessionId: 'sess-1', text: 'Hello' },
      });
      assert.equal(putRes.statusCode, 404);

      await adapter.stop();
    });

    test('succeeds when no handler is registered', async () => {
      ({ adapter, port } = await createRunningAdapter());
      // No onMessage handler registered

      const res = await sendRequest({
        port,
        method: 'POST',
        path: '/messages',
        body: { sessionId: 'no-handler', text: 'Hello' },
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.ok, true);

      await adapter.stop();
    });
  });

  // ==========================================================================
  // Unicode and Special Characters Over HTTP
  // ==========================================================================

  describe('unicode and special characters over HTTP', () => {
    let adapter;
    let port;

    afterEach(async () => {
      if (adapter && adapter.started) {
        await adapter.stop();
      }
    });

    test('handles unicode text in POST and GET', async () => {
      ({ adapter, port } = await createRunningAdapter());

      const unicodeText = 'こんにちは 🤖 Привет مرحبا 你好';
      adapter.onMessage(async msg => {
        await adapter.sendMessage(msg.channelId, `Echo: ${msg.text}`);
      });

      const postRes = await sendRequest({
        port,
        method: 'POST',
        path: '/messages',
        body: { sessionId: 'unicode-sess', text: unicodeText },
      });
      assert.equal(postRes.statusCode, 200);

      const getRes = await sendRequest({ port, path: '/messages/unicode-sess' });
      assert.equal(getRes.body.messages.length, 1);
      assert.equal(getRes.body.messages[0].text, `Echo: ${unicodeText}`);

      await adapter.stop();
    });

    test('handles HTML-like content in messages', async () => {
      ({ adapter, port } = await createRunningAdapter());

      const htmlText = '<script>alert("xss")</script> & "quotes" \'single\'';
      adapter.onMessage(async msg => {
        await adapter.sendMessage(msg.channelId, msg.text);
      });

      await sendRequest({
        port,
        method: 'POST',
        path: '/messages',
        body: { sessionId: 'html-sess', text: htmlText },
      });

      const getRes = await sendRequest({ port, path: '/messages/html-sess' });
      assert.equal(getRes.body.messages[0].text, htmlText);

      await adapter.stop();
    });

    test('handles messages with newlines and special whitespace', async () => {
      ({ adapter, port } = await createRunningAdapter());

      const multilineText = 'Line 1\nLine 2\n\tTabbed line\r\nWindows line';
      adapter.onMessage(async msg => {
        await adapter.sendMessage(msg.channelId, msg.text);
      });

      await sendRequest({
        port,
        method: 'POST',
        path: '/messages',
        body: { sessionId: 'newline-sess', text: multilineText },
      });

      const getRes = await sendRequest({ port, path: '/messages/newline-sess' });
      assert.equal(getRes.body.messages[0].text, multilineText);

      await adapter.stop();
    });

    test('handles URI-encoded session IDs in GET path', async () => {
      ({ adapter, port } = await createRunningAdapter());

      await adapter.sendMessage('session with spaces', 'hello');

      const res = await sendRequest({
        port,
        path: `/messages/${encodeURIComponent('session with spaces')}`,
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.sessionId, 'session with spaces');
      assert.equal(res.body.messages.length, 1);

      await adapter.stop();
    });
  });

  // ==========================================================================
  // Response Content-Type and Format
  // ==========================================================================

  describe('response format', () => {
    let adapter;
    let port;

    afterEach(async () => {
      if (adapter && adapter.started) {
        await adapter.stop();
      }
    });

    test('all responses have application/json content-type', async () => {
      ({ adapter, port } = await createRunningAdapter());

      // GET response
      const getRes = await sendRequest({ port, path: '/messages/any' });
      assert.ok(getRes.headers['content-type'].includes('application/json'));

      // POST success response
      const postRes = await sendRequest({
        port,
        method: 'POST',
        path: '/messages',
        body: { sessionId: 'ct-sess', text: 'Hello' },
      });
      assert.ok(postRes.headers['content-type'].includes('application/json'));

      // 404 response
      const notFoundRes = await sendRequest({ port, path: '/unknown' });
      assert.ok(notFoundRes.headers['content-type'].includes('application/json'));

      await adapter.stop();
    });

    test('POST response includes ok flag and sessionId', async () => {
      ({ adapter, port } = await createRunningAdapter());

      const res = await sendRequest({
        port,
        method: 'POST',
        path: '/messages',
        body: { sessionId: 'format-sess', text: 'Hello' },
      });

      assert.equal(res.body.ok, true);
      assert.equal(res.body.sessionId, 'format-sess');
      assert.equal(typeof res.body.message, 'string');

      await adapter.stop();
    });

    test('GET response includes ok flag, sessionId, and messages array', async () => {
      ({ adapter, port } = await createRunningAdapter());

      const res = await sendRequest({ port, path: '/messages/fmt-sess' });

      assert.equal(res.body.ok, true);
      assert.equal(res.body.sessionId, 'fmt-sess');
      assert.ok(Array.isArray(res.body.messages));

      await adapter.stop();
    });

    test('buffered messages include text and ISO timestamp', async () => {
      ({ adapter, port } = await createRunningAdapter());

      await adapter.sendMessage('ts-sess', 'timestamped');

      const res = await sendRequest({ port, path: '/messages/ts-sess' });

      const msg = res.body.messages[0];
      assert.equal(typeof msg.text, 'string');
      assert.equal(msg.text, 'timestamped');
      assert.equal(typeof msg.timestamp, 'string');
      // Verify valid ISO date
      const parsed = new Date(msg.timestamp);
      assert.ok(!isNaN(parsed.getTime()), 'Timestamp should be a valid ISO date');

      await adapter.stop();
    });
  });

  // ==========================================================================
  // Metadata Handling
  // ==========================================================================

  describe('metadata handling', () => {
    let adapter;
    let port;

    afterEach(async () => {
      if (adapter && adapter.started) {
        await adapter.stop();
      }
    });

    test('passes metadata from POST body to message handler', async () => {
      ({ adapter, port } = await createRunningAdapter());

      const handler = mock.fn();
      adapter.onMessage(handler);

      await sendRequest({
        port,
        method: 'POST',
        path: '/messages',
        body: {
          sessionId: 'meta-sess',
          text: 'Hello',
          metadata: { source: 'web', version: '1.0', tags: ['urgent', 'support'] },
        },
      });

      assert.equal(handler.mock.callCount(), 1);
      const msg = handler.mock.calls[0].arguments[0];
      assert.deepStrictEqual(msg.metadata, {
        source: 'web',
        version: '1.0',
        tags: ['urgent', 'support'],
      });

      await adapter.stop();
    });

    test('defaults metadata to empty object when not provided', async () => {
      ({ adapter, port } = await createRunningAdapter());

      const handler = mock.fn();
      adapter.onMessage(handler);

      await sendRequest({
        port,
        method: 'POST',
        path: '/messages',
        body: { sessionId: 'no-meta', text: 'Hello' },
      });

      const msg = handler.mock.calls[0].arguments[0];
      assert.deepStrictEqual(msg.metadata, {});

      await adapter.stop();
    });

    test('defaults userId to anonymous when not provided', async () => {
      ({ adapter, port } = await createRunningAdapter());

      const handler = mock.fn();
      adapter.onMessage(handler);

      await sendRequest({
        port,
        method: 'POST',
        path: '/messages',
        body: { sessionId: 'anon-sess', text: 'Hello' },
      });

      const msg = handler.mock.calls[0].arguments[0];
      assert.equal(msg.userId, 'anonymous');

      await adapter.stop();
    });
  });

  // ==========================================================================
  // Lifecycle Edge Cases
  // ==========================================================================

  describe('lifecycle edge cases', () => {
    test('start without initialize throws RESTAdapterError', async () => {
      const port = await getAvailablePort();
      const adapter = new RESTAdapter({ port });

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

    test('stop is safe when not started', async () => {
      const port = await getAvailablePort();
      const adapter = new RESTAdapter({ port });
      await adapter.initialize();

      // Should not throw
      await adapter.stop();
      assert.equal(adapter.started, false);
    });

    test('stop is idempotent — can be called multiple times', async () => {
      const { adapter } = await createRunningAdapter();

      await adapter.stop();
      assert.equal(adapter.started, false);

      await adapter.stop();
      assert.equal(adapter.started, false);
    });

    test('initialize is idempotent — does not recreate server', async () => {
      const port = await getAvailablePort();
      const adapter = new RESTAdapter({ port });

      await adapter.initialize();
      const server1 = adapter.server;

      await adapter.initialize();
      const server2 = adapter.server;

      assert.equal(server1, server2, 'Server should not be recreated');
    });

    test('start is idempotent — second call is no-op', async () => {
      const { adapter } = await createRunningAdapter();

      assert.equal(adapter.started, true);
      await adapter.start(); // No-op
      assert.equal(adapter.started, true);

      await adapter.stop();
    });

    test('can restart adapter after stop', async () => {
      const { adapter, port } = await createRunningAdapter();

      // Stop
      await adapter.stop();
      assert.equal(adapter.started, false);

      // Restart
      await adapter.start();
      assert.equal(adapter.started, true);

      // Verify it works after restart
      const res = await sendRequest({ port, path: '/messages/restart-test' });
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.ok, true);

      await adapter.stop();
    });

    test('sendMessage throws when adapter is not initialized', async () => {
      const adapter = new RESTAdapter({ port: 3100 });

      await assert.rejects(
        () => adapter.sendMessage('sess-1', 'hello'),
        err => {
          assert.ok(err instanceof RESTAdapterError);
          assert.equal(err.operation, 'sendMessage');
          return true;
        }
      );
    });
  });

  // ==========================================================================
  // Handler Registration Timing
  // ==========================================================================

  describe('handler registration timing', () => {
    let adapter;
    let port;

    afterEach(async () => {
      if (adapter && adapter.started) {
        await adapter.stop();
      }
    });

    test('handler registered after start still receives messages', async () => {
      ({ adapter, port } = await createRunningAdapter());
      // No handler yet

      // First message — no handler, still succeeds
      const res1 = await sendRequest({
        port,
        method: 'POST',
        path: '/messages',
        body: { sessionId: 'late-handler', text: 'before' },
      });
      assert.equal(res1.statusCode, 200);

      // Register handler
      const handler = mock.fn();
      adapter.onMessage(handler);

      // Second message — handler receives it
      const res2 = await sendRequest({
        port,
        method: 'POST',
        path: '/messages',
        body: { sessionId: 'late-handler', text: 'after' },
      });
      assert.equal(res2.statusCode, 200);
      assert.equal(handler.mock.callCount(), 1);
      assert.equal(handler.mock.calls[0].arguments[0].text, 'after');

      await adapter.stop();
    });

    test('handler can be replaced mid-stream', async () => {
      ({ adapter, port } = await createRunningAdapter());

      const handler1 = mock.fn();
      const handler2 = mock.fn();

      adapter.onMessage(handler1);

      await sendRequest({
        port,
        method: 'POST',
        path: '/messages',
        body: { sessionId: 'swap-handler', text: 'first' },
      });

      // Replace handler
      adapter.onMessage(handler2);

      await sendRequest({
        port,
        method: 'POST',
        path: '/messages',
        body: { sessionId: 'swap-handler', text: 'second' },
      });

      assert.equal(handler1.mock.callCount(), 1);
      assert.equal(handler2.mock.callCount(), 1);

      await adapter.stop();
    });
  });

  // ==========================================================================
  // Adapter Interface Conformance
  // ==========================================================================

  describe('adapter interface conformance', () => {
    test('exposes all required adapter methods', () => {
      const adapter = new RESTAdapter({ port: 3100 });
      assert.equal(typeof adapter.initialize, 'function');
      assert.equal(typeof adapter.start, 'function');
      assert.equal(typeof adapter.stop, 'function');
      assert.equal(typeof adapter.onMessage, 'function');
      assert.equal(typeof adapter.sendMessage, 'function');
    });

    test('works with ChannelManager adapter pattern', async () => {
      // ChannelManager does: new Adapter(config) → initialize() → onMessage(handler) → start()
      const port = await getAvailablePort();
      const adapter = new RESTAdapter({ port });

      await adapter.initialize();

      const handler = mock.fn();
      adapter.onMessage(handler);

      await adapter.start();
      assert.equal(adapter.started, true);
      assert.equal(adapter.initialized, true);

      // Verify it accepts requests
      const res = await sendRequest({
        port,
        method: 'POST',
        path: '/messages',
        body: { sessionId: 'cm-test', text: 'from channel manager' },
      });
      assert.equal(res.statusCode, 200);
      assert.equal(handler.mock.callCount(), 1);

      await adapter.stop();
    });
  });
});
