/**
 * Integration tests for /api/v1/servers endpoints
 *
 * Tests the ServerRouter with a real HTTP server:
 * - POST   /api/v1/servers/register -> Register server
 * - GET    /api/v1/servers          -> List servers
 * - GET    /api/v1/servers/:id      -> Get server details
 * - DELETE /api/v1/servers/:id      -> Unregister server
 *
 * These tests exercise the full HTTP stack over real network connections.
 *
 * Run with: npm run test:integration
 */

import { describe, test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { APIServer } from '../../../src/api/api-server.js';
import { ServerRouter } from '../../../src/api/routers/server-router.js';

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
 * Create a mock WorkerRegistry with stateful server tracking
 * @param {Object[]} [servers] - Initial servers
 * @returns {Object} Mock WorkerRegistry
 */
function createMockWorkerRegistry(servers = []) {
  const serverMap = new Map(servers.map(s => [s.id, s]));

  return {
    getWorker: mock.fn(async id => serverMap.get(id) || null),
    listWorkers: mock.fn(async () => Array.from(serverMap.values())),
    registerWorker: mock.fn(async worker => {
      const registered = {
        id: worker.id,
        host: worker.host,
        type: worker.type || 'local',
        status: worker.status || 'online',
        maxContainers: worker.maxContainers || 10,
        currentLoad: worker.currentLoad || 0,
        lastHeartbeat: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      serverMap.set(registered.id, registered);
      return registered;
    }),
    unregisterWorker: mock.fn(async id => {
      const existed = serverMap.has(id);
      serverMap.delete(id);
      return existed;
    }),
    _serverMap: serverMap,
  };
}

/**
 * Create a mock server object
 * @param {Object} [overrides] - Override default properties
 * @returns {Object} Mock server
 */
function createMockServer(overrides = {}) {
  return {
    id: overrides.id || 'server-1',
    host: overrides.host || '192.168.1.100',
    type: overrides.type || 'local',
    status: overrides.status || 'online',
    maxContainers: overrides.maxContainers || 10,
    currentLoad: overrides.currentLoad || 0,
    lastHeartbeat: new Date('2025-01-02T00:00:00Z'),
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-02T00:00:00Z'),
  };
}

// ============================================================================
// Integration Tests
// ============================================================================

describe('v1 Servers API Integration', () => {
  let server;
  let port;
  let workerRegistry;

  before(async () => {
    workerRegistry = createMockWorkerRegistry([
      createMockServer({ id: 'server-1', host: '192.168.1.10' }),
      createMockServer({ id: 'server-2', host: '192.168.1.20' }),
    ]);

    const serverRouter = new ServerRouter({
      workerRegistry,
      apiKey: null,
      logger: null,
    });

    server = new APIServer({
      routers: [serverRouter],
      logger: null,
    });

    port = await getAvailablePort();
    await server.start(port);
  });

  after(async () => {
    if (server && server.running) {
      await server.stop();
    }
  });

  // ==========================================================================
  // GET /api/v1/servers - List Servers
  // ==========================================================================

  describe('GET /api/v1/servers', () => {
    test('lists all registered servers', async () => {
      const response = await sendRequest({
        port,
        path: '/api/v1/servers',
      });

      assert.equal(response.statusCode, 200);
      assert.ok(response.body.servers);
      assert.equal(response.body.servers.length, 2);
      assert.equal(response.body.servers[0].id, 'server-1');
      assert.equal(response.body.servers[1].id, 'server-2');
      assert.ok(workerRegistry.listWorkers.mock.callCount() >= 1);
    });
  });

  // ==========================================================================
  // GET /api/v1/servers/:id - Get Server Details
  // ==========================================================================

  describe('GET /api/v1/servers/:id', () => {
    test('gets server details by ID', async () => {
      const response = await sendRequest({
        port,
        path: '/api/v1/servers/server-1',
      });

      assert.equal(response.statusCode, 200);
      assert.equal(response.body.id, 'server-1');
      assert.equal(response.body.host, '192.168.1.10');
      assert.ok(workerRegistry.getWorker.mock.callCount() >= 1);
    });

    test('returns 404 for non-existent server', async () => {
      const response = await sendRequest({
        port,
        path: '/api/v1/servers/nonexistent',
      });

      assert.equal(response.statusCode, 404);
      assert.ok(response.body.error);
    });
  });

  // ==========================================================================
  // DELETE /api/v1/servers/:id - Unregister Server
  // ==========================================================================

  describe('DELETE /api/v1/servers/:id', () => {
    test('unregisters an existing server', async () => {
      // First verify server exists
      const getBefore = await sendRequest({
        port,
        path: '/api/v1/servers/server-2',
      });
      assert.equal(getBefore.statusCode, 200);

      const response = await sendRequest({
        port,
        method: 'DELETE',
        path: '/api/v1/servers/server-2',
      });

      assert.equal(response.statusCode, 200);
      assert.equal(response.body.id, 'server-2');
      assert.equal(response.body.status, 'unregistered');
      assert.ok(workerRegistry.unregisterWorker.mock.callCount() >= 1);

      // Verify server is deleted
      const getAfter = await sendRequest({
        port,
        path: '/api/v1/servers/server-2',
      });
      assert.equal(getAfter.statusCode, 404);
    });

    test('returns 404 when unregistering non-existent server', async () => {
      const response = await sendRequest({
        port,
        method: 'DELETE',
        path: '/api/v1/servers/nonexistent',
      });

      assert.equal(response.statusCode, 404);
    });
  });
});

// ============================================================================
// POST /api/v1/servers/register - Register Server (separate instance)
// ============================================================================

describe('v1 Servers API - Registration', () => {
  let server;
  let port;
  let workerRegistry;

  after(async () => {
    if (server && server.running) {
      await server.stop();
    }
  });

  test('registers a new server successfully', async () => {
    workerRegistry = createMockWorkerRegistry([]);

    const serverRouter = new ServerRouter({
      workerRegistry,
      apiKey: null,
      logger: null,
    });

    server = new APIServer({
      routers: [serverRouter],
      logger: null,
    });

    port = await getAvailablePort();
    await server.start(port);

    const response = await sendRequest({
      port,
      method: 'POST',
      path: '/api/v1/servers/register',
      body: {
        id: 'new-server',
        host: '192.168.1.50',
        type: 'remote',
        maxContainers: 20,
      },
    });

    assert.equal(response.statusCode, 201);
    assert.equal(response.body.id, 'new-server');
    assert.equal(response.body.host, '192.168.1.50');
    assert.ok(workerRegistry.registerWorker.mock.callCount() >= 1);
  });

  test('rejects registration with missing required fields', async () => {
    const response = await sendRequest({
      port,
      method: 'POST',
      path: '/api/v1/servers/register',
      body: {
        host: '192.168.1.50',
      },
    });

    assert.equal(response.statusCode, 400);
    assert.ok(response.body.error);
  });
});

// ============================================================================
// Authentication
// ============================================================================

describe('v1 Servers API - Authentication', () => {
  let server;
  let port;

  after(async () => {
    if (server && server.running) {
      await server.stop();
    }
  });

  test('enforces authentication when API key is set', async () => {
    const workerRegistry = createMockWorkerRegistry([
      createMockServer({ id: 'server-1' }),
    ]);

    const serverRouter = new ServerRouter({
      workerRegistry,
      apiKey: 'secret-key-123456',
      logger: null,
    });

    server = new APIServer({
      routers: [serverRouter],
      logger: null,
    });

    port = await getAvailablePort();
    await server.start(port);

    // Request without auth should fail
    const unauthorized = await sendRequest({
      port,
      path: '/api/v1/servers',
    });
    assert.equal(unauthorized.statusCode, 401);

    // Request with valid auth should succeed
    const authorized = await sendRequest({
      port,
      path: '/api/v1/servers',
      headers: { Authorization: 'Bearer secret-key-123456' },
    });
    assert.equal(authorized.statusCode, 200);
  });
});

// ============================================================================
// Error Handling
// ============================================================================

describe('v1 Servers API - Error Handling', () => {
  let server;
  let port;

  after(async () => {
    if (server && server.running) {
      await server.stop();
    }
  });

  test('handles invalid JSON gracefully', async () => {
    const workerRegistry = createMockWorkerRegistry([]);

    const serverRouter = new ServerRouter({
      workerRegistry,
      apiKey: null,
      logger: null,
    });

    server = new APIServer({
      routers: [serverRouter],
      logger: null,
    });

    port = await getAvailablePort();
    await server.start(port);

    const response = await sendRequest({
      port,
      method: 'POST',
      path: '/api/v1/servers/register',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid json',
    });

    assert.equal(response.statusCode, 400);
  });
});
