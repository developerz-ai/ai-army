/**
 * Integration tests for /api/v1/workers endpoints
 *
 * Tests the WorkerRouter with a real HTTP server:
 * - POST   /api/v1/workers           -> Provision worker
 * - GET    /api/v1/workers           -> List workers
 * - GET    /api/v1/workers/:id       -> Get worker details
 * - GET    /api/v1/workers/:id/status -> Get worker status
 * - POST   /api/v1/workers/:id/stop  -> Stop worker
 * - POST   /api/v1/workers/:id/start -> Start worker
 * - DELETE /api/v1/workers/:id       -> Delete worker
 *
 * These tests exercise the full HTTP stack over real network connections.
 *
 * Run with: npm run test:integration
 */

import { describe, test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { APIServer } from '../../../src/api/api-server.js';
import { WorkerRouter } from '../../../src/api/routers/worker-router.js';

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
 * Create a mock bot object
 * @param {Object} [overrides] - Override default properties
 * @returns {Object} Mock bot
 */
function createMockBot(overrides = {}) {
  return {
    id: overrides.id || 'worker-1',
    status: overrides.status || 'running',
    config: {
      id: overrides.id || 'worker-1',
      name: overrides.name || 'Worker 1',
      model: 'claude-haiku-4-5',
      provider: 'anthropic',
      channels: ['rest'],
      ...overrides.config,
    },
    tools: overrides.tools || {},
    soulContent: overrides.soulContent !== undefined ? overrides.soulContent : '# Worker',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    lastActiveAt: new Date('2025-01-02T00:00:00Z'),
  };
}

/**
 * Create a mock BotManager with stateful bot tracking
 * @param {Object[]} [bots] - Initial bots
 * @returns {Object} Mock BotManager
 */
function createMockBotManager(bots = []) {
  const botMap = new Map(bots.map(b => [b.id, b]));

  return {
    getBot: mock.fn(botId => botMap.get(botId)),
    listBots: mock.fn(() => Array.from(botMap.values())),
    getBotCount: mock.fn(() => botMap.size),
    loadBot: mock.fn(async (id, config) => {
      const bot = createMockBot({ id, name: config.name, config });
      botMap.set(bot.id, bot);
      return bot;
    }),
    removeBot: mock.fn(async botId => {
      const existed = botMap.has(botId);
      botMap.delete(botId);
      return existed;
    }),
    stopBot: mock.fn(async botId => {
      const bot = botMap.get(botId);
      if (bot) {
        bot.status = 'stopped';
      }
    }),
    startBot: mock.fn(async botId => {
      const bot = botMap.get(botId);
      if (bot) {
        bot.status = 'running';
      }
    }),
    reloadBot: mock.fn(async () => {}),
    _botMap: botMap,
  };
}

// ============================================================================
// Integration Tests
// ============================================================================

describe('v1 Workers API Integration', () => {
  let server;
  let port;
  let botManager;

  before(async () => {
    botManager = createMockBotManager([
      createMockBot({ id: 'worker-1', name: 'Worker 1' }),
      createMockBot({ id: 'worker-2', name: 'Worker 2' }),
    ]);

    const workerRouter = new WorkerRouter({
      botManager,
      apiKey: null,
      logger: null,
    });

    server = new APIServer({
      routers: [workerRouter],
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
  // GET /api/v1/workers - List Workers
  // ==========================================================================

  describe('GET /api/v1/workers', () => {
    test('lists all workers', async () => {
      const response = await sendRequest({
        port,
        path: '/api/v1/workers',
      });

      assert.equal(response.statusCode, 200);
      assert.ok(response.body.workers);
      assert.equal(response.body.workers.length, 2);
      assert.equal(response.body.workers[0].id, 'worker-1');
      assert.equal(response.body.workers[1].id, 'worker-2');
      assert.ok(response.body.pagination);
    });

    test('returns pagination info', async () => {
      const response = await sendRequest({
        port,
        path: '/api/v1/workers',
      });

      assert.equal(response.statusCode, 200);
      assert.ok(response.body.pagination);
      assert.ok('total' in response.body.pagination);
    });
  });

  // ==========================================================================
  // GET /api/v1/workers/:id - Get Worker Details
  // ==========================================================================

  describe('GET /api/v1/workers/:id', () => {
    test('gets worker details by ID', async () => {
      const response = await sendRequest({
        port,
        path: '/api/v1/workers/worker-1',
      });

      assert.equal(response.statusCode, 200);
      assert.equal(response.body.id, 'worker-1');
      assert.equal(response.body.name, 'Worker 1');
      assert.ok(botManager.getBot.mock.callCount() >= 1);
    });

    test('returns 404 for non-existent worker', async () => {
      const response = await sendRequest({
        port,
        path: '/api/v1/workers/nonexistent',
      });

      assert.equal(response.statusCode, 404);
      assert.ok(response.body.error);
    });
  });

  // ==========================================================================
  // GET /api/v1/workers/:id/status - Get Worker Status
  // ==========================================================================

  describe('GET /api/v1/workers/:id/status', () => {
    test('gets comprehensive worker status', async () => {
      const response = await sendRequest({
        port,
        path: '/api/v1/workers/worker-1/status',
      });

      assert.equal(response.statusCode, 200);
      assert.equal(response.body.workerId, 'worker-1');
      assert.ok('status' in response.body);
    });

    test('returns 404 for non-existent worker status', async () => {
      const response = await sendRequest({
        port,
        path: '/api/v1/workers/nonexistent/status',
      });

      assert.equal(response.statusCode, 404);
    });
  });

  // ==========================================================================
  // POST /api/v1/workers/:id/stop - Stop Worker
  // ==========================================================================

  describe('POST /api/v1/workers/:id/stop', () => {
    test('stops a running worker', async () => {
      const response = await sendRequest({
        port,
        method: 'POST',
        path: '/api/v1/workers/worker-1/stop',
      });

      assert.equal(response.statusCode, 200);
      assert.equal(response.body.workerId, 'worker-1');
      assert.equal(response.body.status, 'stopped');
      assert.ok(botManager.stopBot.mock.callCount() >= 1);
    });

    test('returns 404 when stopping non-existent worker', async () => {
      const response = await sendRequest({
        port,
        method: 'POST',
        path: '/api/v1/workers/nonexistent/stop',
      });

      assert.equal(response.statusCode, 404);
    });
  });

  // ==========================================================================
  // POST /api/v1/workers/:id/start - Start Worker
  // ==========================================================================

  describe('POST /api/v1/workers/:id/start', () => {
    test('starts a stopped worker', async () => {
      const response = await sendRequest({
        port,
        method: 'POST',
        path: '/api/v1/workers/worker-1/start',
      });

      assert.equal(response.statusCode, 200);
      assert.equal(response.body.workerId, 'worker-1');
      assert.equal(response.body.status, 'running');
      assert.ok(botManager.startBot.mock.callCount() >= 1);
    });

    test('returns 404 when starting non-existent worker', async () => {
      const response = await sendRequest({
        port,
        method: 'POST',
        path: '/api/v1/workers/nonexistent/start',
      });

      assert.equal(response.statusCode, 404);
    });
  });

  // ==========================================================================
  // DELETE /api/v1/workers/:id - Delete Worker
  // ==========================================================================

  describe('DELETE /api/v1/workers/:id', () => {
    test('deletes an existing worker', async () => {
      // First verify worker exists
      const getBefore = await sendRequest({
        port,
        path: '/api/v1/workers/worker-2',
      });
      assert.equal(getBefore.statusCode, 200);

      const response = await sendRequest({
        port,
        method: 'DELETE',
        path: '/api/v1/workers/worker-2',
      });

      assert.equal(response.statusCode, 200);
      assert.equal(response.body.workerId, 'worker-2');
      assert.equal(response.body.status, 'deprovisioned');
      assert.ok(botManager.removeBot.mock.callCount() >= 1);

      // Verify worker is deleted
      const getAfter = await sendRequest({
        port,
        path: '/api/v1/workers/worker-2',
      });
      assert.equal(getAfter.statusCode, 404);
    });

    test('returns 404 when deleting non-existent worker', async () => {
      const response = await sendRequest({
        port,
        method: 'DELETE',
        path: '/api/v1/workers/nonexistent',
      });

      assert.equal(response.statusCode, 404);
    });
  });
});

// ============================================================================
// POST /api/v1/workers - Provision Worker (separate server instance)
// ============================================================================

describe('v1 Workers API - Provision', () => {
  let server;
  let port;
  let botManager;

  after(async () => {
    if (server && server.running) {
      await server.stop();
    }
  });

  test('provisions a new worker successfully', async () => {
    botManager = createMockBotManager([]);

    const workerRouter = new WorkerRouter({
      botManager,
      apiKey: null,
      logger: null,
    });

    server = new APIServer({
      routers: [workerRouter],
      logger: null,
    });

    port = await getAvailablePort();
    await server.start(port);

    const response = await sendRequest({
      port,
      method: 'POST',
      path: '/api/v1/workers',
      body: {
        id: 'new-worker',
        name: 'New Worker',
      },
    });

    assert.equal(response.statusCode, 201);
    assert.equal(response.body.workerId, 'new-worker');
    assert.equal(response.body.name, 'New Worker');
    assert.ok(botManager.loadBot.mock.callCount() >= 1);
  });

  test('rejects provision with missing id', async () => {
    const response = await sendRequest({
      port,
      method: 'POST',
      path: '/api/v1/workers',
      body: {
        name: 'Incomplete Worker',
      },
    });

    assert.equal(response.statusCode, 400);
    assert.ok(response.body.error);
  });
});

// ============================================================================
// Authentication
// ============================================================================

describe('v1 Workers API - Authentication', () => {
  let server;
  let port;

  after(async () => {
    if (server && server.running) {
      await server.stop();
    }
  });

  test('enforces authentication when API key is set', async () => {
    const botManager = createMockBotManager([
      createMockBot({ id: 'worker-1' }),
    ]);

    const workerRouter = new WorkerRouter({
      botManager,
      apiKey: 'secret-key-123456',
      logger: null,
    });

    server = new APIServer({
      routers: [workerRouter],
      logger: null,
    });

    port = await getAvailablePort();
    await server.start(port);

    // Request without auth should fail
    const unauthorized = await sendRequest({
      port,
      path: '/api/v1/workers',
    });
    assert.equal(unauthorized.statusCode, 401);

    // Request with valid auth should succeed
    const authorized = await sendRequest({
      port,
      path: '/api/v1/workers',
      headers: { Authorization: 'Bearer secret-key-123456' },
    });
    assert.equal(authorized.statusCode, 200);
  });
});

// ============================================================================
// Error Handling
// ============================================================================

describe('v1 Workers API - Error Handling', () => {
  let server;
  let port;

  after(async () => {
    if (server && server.running) {
      await server.stop();
    }
  });

  test('handles invalid JSON gracefully', async () => {
    const botManager = createMockBotManager([]);

    const workerRouter = new WorkerRouter({
      botManager,
      apiKey: null,
      logger: null,
    });

    server = new APIServer({
      routers: [workerRouter],
      logger: null,
    });

    port = await getAvailablePort();
    await server.start(port);

    const response = await sendRequest({
      port,
      method: 'POST',
      path: '/api/v1/workers',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid json',
    });

    assert.equal(response.statusCode, 400);
  });
});
