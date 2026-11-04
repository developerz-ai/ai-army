/**
 * Integration tests for v1 Router Registration in APIServer
 *
 * Tests the complete HTTP lifecycle with v1 routers (WorkerRouter,
 * ServerRouter, TemplateRouter) wired into the APIServer:
 * - WorkerRouter serves /api/v1/workers
 * - ServerRouter serves /api/v1/servers
 * - TemplateRouter serves /api/v1/templates
 * - Multiple routers coexist in a single APIServer
 *
 * Run with: npm run test:integration
 */

import { describe, test, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { APIServer } from '../../../src/api/api-server.js';
import { WorkerRouter } from '../../../src/api/routers/worker-router.js';
import { ServerRouter } from '../../../src/api/routers/server-router.js';
import { TemplateRouter } from '../../../src/api/routers/template-router.js';

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
 * Create a mock bot (used by WorkerRouter via BotManager)
 * @param {Object} [overrides] - Override defaults
 * @returns {Object} Mock bot
 */
function createMockBot(overrides = {}) {
  return {
    id: overrides.id || 'test-worker',
    status: overrides.status || 'running',
    config: {
      id: overrides.id || 'test-worker',
      name: overrides.name || 'Test Worker',
      model: 'claude-haiku-4-5',
      provider: 'anthropic',
      channels: ['rest'],
      ...overrides.config,
    },
    tools: overrides.tools || {},
    soulContent: overrides.soulContent !== undefined ? overrides.soulContent : '# Test Worker',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    lastActiveAt: new Date('2025-01-02T00:00:00Z'),
  };
}

/**
 * Create a mock BotManager
 * @param {Object[]} [bots] - Initial bots
 * @returns {Object} Mock BotManager
 */
function createMockBotManager(bots = [createMockBot()]) {
  const botMap = new Map(bots.map(b => [b.id, b]));
  return {
    getBot: mock.fn(botId => botMap.get(botId)),
    listBots: mock.fn(() => Array.from(botMap.values())),
    getBotCount: mock.fn(() => botMap.size),
    _botMap: botMap,
  };
}

/**
 * Create a mock WorkerRegistry (used by ServerRouter)
 *
 * ServerRouter calls workerRegistry.listWorkers() and workerRegistry.getWorker()
 * @returns {Object} Mock WorkerRegistry
 */
function createMockWorkerRegistry() {
  const workers = new Map();
  workers.set('server-1', {
    id: 'server-1',
    host: '192.168.1.10',
    type: 'local',
    status: 'online',
    maxContainers: 10,
    currentLoad: 3,
    lastHeartbeat: new Date('2025-01-02T00:00:00Z'),
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-02T00:00:00Z'),
  });

  return {
    getWorker: mock.fn(async id => workers.get(id) || null),
    listWorkers: mock.fn(async () => Array.from(workers.values())),
    registerWorker: mock.fn(async worker => {
      workers.set(worker.id, worker);
      return worker;
    }),
    unregisterWorker: mock.fn(async id => {
      const existed = workers.has(id);
      workers.delete(id);
      return existed;
    }),
    _workers: workers,
  };
}

/**
 * Create a mock TemplateManager (used by TemplateRouter)
 *
 * TemplateRouter calls templateManager.listTemplates() and templateManager.getTemplate()
 * @returns {Object} Mock TemplateManager
 */
function createMockTemplateManager() {
  const templates = [
    {
      id: 'support-bot',
      name: 'Support Bot',
      description: 'Customer support bot template',
      variables: ['company_name', 'tone'],
      config: { model: 'claude-haiku-4-5', provider: 'anthropic' },
    },
    {
      id: 'code-bot',
      name: 'Code Assistant',
      description: 'Code review and assistance bot',
      variables: ['language', 'framework'],
      config: { model: 'claude-sonnet-4-20250514', provider: 'anthropic' },
    },
  ];

  return {
    listTemplates: mock.fn(async () => templates),
    getTemplate: mock.fn(async id => templates.find(t => t.id === id) || null),
    instantiate: mock.fn(async (id, overrides = {}) => ({
      id: `${id}-instance-1`,
      templateId: id,
      config: { ...templates.find(t => t.id === id)?.config, ...overrides },
    })),
  };
}

// ============================================================================
// Integration Tests
// ============================================================================

describe('v1 Router Registration Integration', () => {
  /** @type {APIServer} */
  let server;

  after(async () => {
    if (server && server.running) {
      await server.stop();
    }
  });

  // ==========================================================================
  // WorkerRouter via APIServer
  // ==========================================================================

  describe('WorkerRouter via APIServer', () => {
    test('GET /api/v1/workers returns worker list', async () => {
      const botManager = createMockBotManager();
      const workerRouter = new WorkerRouter({
        botManager,
        apiKey: null,
        logger: null,
      });

      server = new APIServer({
        routers: [workerRouter],
        logger: null,
      });

      const port = await getAvailablePort();
      await server.start(port);

      const response = await sendRequest({
        port,
        path: '/api/v1/workers',
      });

      assert.equal(response.statusCode, 200);
      assert.ok(response.body.workers);
      assert.equal(response.body.workers.length, 1);
      assert.equal(response.body.workers[0].id, 'test-worker');
      assert.ok(response.body.pagination);

      await server.stop();
    });

    test('GET /api/v1/workers/:id returns worker details', async () => {
      const botManager = createMockBotManager();
      const workerRouter = new WorkerRouter({
        botManager,
        apiKey: null,
        logger: null,
      });

      server = new APIServer({
        routers: [workerRouter],
        logger: null,
      });

      const port = await getAvailablePort();
      await server.start(port);

      const response = await sendRequest({
        port,
        path: '/api/v1/workers/test-worker',
      });

      assert.equal(response.statusCode, 200);
      assert.equal(response.body.id, 'test-worker');

      await server.stop();
    });
  });

  // ==========================================================================
  // ServerRouter via APIServer
  // ==========================================================================

  describe('ServerRouter via APIServer', () => {
    test('GET /api/v1/servers returns server list', async () => {
      const workerRegistry = createMockWorkerRegistry();
      const serverRouter = new ServerRouter({
        workerRegistry,
        apiKey: null,
        logger: null,
      });

      server = new APIServer({
        routers: [serverRouter],
        logger: null,
      });

      const port = await getAvailablePort();
      await server.start(port);

      const response = await sendRequest({
        port,
        path: '/api/v1/servers',
      });

      assert.equal(response.statusCode, 200);
      assert.ok(response.body.servers);
      assert.equal(response.body.servers.length, 1);
      assert.equal(response.body.servers[0].id, 'server-1');

      await server.stop();
    });

    test('GET /api/v1/servers/:id returns server details', async () => {
      const workerRegistry = createMockWorkerRegistry();
      const serverRouter = new ServerRouter({
        workerRegistry,
        apiKey: null,
        logger: null,
      });

      server = new APIServer({
        routers: [serverRouter],
        logger: null,
      });

      const port = await getAvailablePort();
      await server.start(port);

      const response = await sendRequest({
        port,
        path: '/api/v1/servers/server-1',
      });

      assert.equal(response.statusCode, 200);
      assert.equal(response.body.id, 'server-1');

      await server.stop();
    });
  });

  // ==========================================================================
  // TemplateRouter via APIServer
  // ==========================================================================

  describe('TemplateRouter via APIServer', () => {
    test('GET /api/v1/templates returns template list', async () => {
      const templateManager = createMockTemplateManager();
      const templateRouter = new TemplateRouter({
        templateManager,
        apiKey: null,
        logger: null,
      });

      server = new APIServer({
        routers: [templateRouter],
        logger: null,
      });

      const port = await getAvailablePort();
      await server.start(port);

      const response = await sendRequest({
        port,
        path: '/api/v1/templates',
      });

      assert.equal(response.statusCode, 200);
      assert.ok(response.body.templates);
      assert.equal(response.body.templates.length, 2);

      await server.stop();
    });

    test('GET /api/v1/templates/:type returns template details', async () => {
      const templateManager = createMockTemplateManager();
      const templateRouter = new TemplateRouter({
        templateManager,
        apiKey: null,
        logger: null,
      });

      server = new APIServer({
        routers: [templateRouter],
        logger: null,
      });

      const port = await getAvailablePort();
      await server.start(port);

      const response = await sendRequest({
        port,
        path: '/api/v1/templates/support-bot',
      });

      assert.equal(response.statusCode, 200);
      assert.equal(response.body.id, 'support-bot');

      await server.stop();
    });
  });

  // ==========================================================================
  // Multiple Routers Coexisting
  // ==========================================================================

  describe('multiple v1 routers coexisting', () => {
    test('all v1 routers serve their respective endpoints', async () => {
      const botManager = createMockBotManager();
      const workerRegistry = createMockWorkerRegistry();
      const templateManager = createMockTemplateManager();

      const workerRouter = new WorkerRouter({
        botManager,
        apiKey: null,
        logger: null,
      });
      const serverRouter = new ServerRouter({
        workerRegistry,
        apiKey: null,
        logger: null,
      });
      const templateRouter = new TemplateRouter({
        templateManager,
        apiKey: null,
        logger: null,
      });

      server = new APIServer({
        routers: [workerRouter, serverRouter, templateRouter],
        logger: null,
      });

      const port = await getAvailablePort();
      await server.start(port);

      // Test workers endpoint
      const workersRes = await sendRequest({ port, path: '/api/v1/workers' });
      assert.equal(workersRes.statusCode, 200);
      assert.equal(workersRes.body.workers.length, 1);

      // Test servers endpoint
      const serversRes = await sendRequest({ port, path: '/api/v1/servers' });
      assert.equal(serversRes.statusCode, 200);
      assert.equal(serversRes.body.servers.length, 1);

      // Test templates endpoint
      const templatesRes = await sendRequest({ port, path: '/api/v1/templates' });
      assert.equal(templatesRes.statusCode, 200);
      assert.equal(templatesRes.body.templates.length, 2);

      // Non-matching path returns 404
      const notFoundRes = await sendRequest({ port, path: '/api/v1/unknown' });
      assert.equal(notFoundRes.statusCode, 404);

      await server.stop();
    });
  });
});
