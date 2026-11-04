/**
 * Unit tests for WorkerRouter
 *
 * Tests the worker management API endpoints:
 * - POST   /api/v1/workers              -> Provision a new worker
 * - GET    /api/v1/workers              -> List workers (with filters & pagination)
 * - GET    /api/v1/workers/:id          -> Get worker details
 * - GET    /api/v1/workers/:id/status   -> Get comprehensive worker status
 * - PUT    /api/v1/workers/:id/image    -> Update worker image
 * - PUT    /api/v1/workers/:id/expertise -> Update worker expertise
 * - POST   /api/v1/workers/:id/reload   -> Reload worker configuration
 * - POST   /api/v1/workers/:id/stop     -> Stop a worker
 * - POST   /api/v1/workers/:id/start    -> Start a worker
 * - DELETE /api/v1/workers/:id          -> Deprovision a worker
 * - POST   /api/v1/workers/:id/assign   -> Assign a task to a worker
 *
 * Also covers:
 * - Authentication (API key validation)
 * - Route matching (only handles /api/v1/workers paths)
 * - Error handling
 * - Constructor validation
 * - JSON body parsing for POST/PUT/DELETE
 * - Pagination and filtering
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { WorkerRouter, WorkerRouterError } from '../../../src/api/routers/worker-router.js';

// ============================================================================
// Test Helpers
// ============================================================================

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
    loadBot: mock.fn(async () => {}),
    startBot: mock.fn(async () => {}),
    stopBot: mock.fn(async () => {}),
    reloadBot: mock.fn(async () => {}),
    removeBot: mock.fn(async () => true),
    getBotCount: mock.fn(() => botMap.size),
  };
}

/**
 * Create a mock MessageProcessor
 * @param {Object} [response={}] - Default response from processMessage
 * @returns {Object} Mock MessageProcessor
 */
function createMockMessageProcessor(response = {}) {
  return {
    processMessage: mock.fn(async () => ({
      text: 'Task completed successfully',
      sessionId: 'worker:rest:rest-api:api-assignment',
      durationMs: 2500,
      usage: { promptTokens: 200, completionTokens: 100 },
      ...response,
    })),
  };
}

/**
 * Create a mock WorkerRegistry
 * @returns {Object} Mock WorkerRegistry
 */
function createMockWorkerRegistry() {
  return {
    getWorkerLoad: mock.fn(async () => ({
      workerId: 'vps-1',
      currentLoad: 3,
      maxContainers: 10,
      available: 7,
      loadRatio: 0.3,
      status: 'healthy',
    })),
    getWorker: mock.fn(async () => null),
    listWorkers: mock.fn(async () => []),
  };
}

/**
 * Create a mock HTTP request
 * @param {Object} options - Request options
 * @returns {Object} Mock request
 */
function createMockRequest({ method = 'GET', url = '/', headers = {}, body = null } = {}) {
  const readable = new Readable({ read() {} });
  readable.method = method;
  readable.url = url;
  readable.headers = {
    host: 'localhost:3000',
    ...headers,
  };
  readable.socket = { remoteAddress: '127.0.0.1' };

  if (body) {
    const json = JSON.stringify(body);
    process.nextTick(() => {
      readable.push(json);
      readable.push(null);
    });
  } else {
    process.nextTick(() => readable.push(null));
  }

  return readable;
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
    headersSent: false,
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

const sampleWorkers = [
  {
    id: 'sarah-frontend',
    status: 'running',
    config: {
      name: 'Sarah (Frontend Developer)',
      type: 'frontend-developer',
      model: 'claude-3',
      provider: 'anthropic',
      channels: ['rest'],
      sandbox: { image: 'ai-army/frontend-developer:latest', cpus: '4', memory: '8Gi' },
      tools: { bash: {}, git: {}, npm: {} },
      mcpServers: ['filesystem', 'github'],
    },
    workerId: 'vps-1',
    container: { id: 'abc123' },
    soulContent: 'You are Sarah, a React expert...',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastActiveAt: '2026-02-06T10:00:00.000Z',
  },
  {
    id: 'mike-backend',
    status: 'stopped',
    config: {
      name: 'Mike (Backend Developer)',
      type: 'backend-developer',
      model: 'gpt-4',
      provider: 'openai',
      channels: ['rest'],
      sandbox: { image: 'ai-army/backend-developer:latest' },
    },
    workerId: 'vps-2',
    container: null,
    soulContent: null,
    createdAt: '2026-01-15T00:00:00.000Z',
    lastActiveAt: null,
  },
  {
    id: 'devops-worker',
    status: 'running',
    config: {
      name: 'DevOps Worker',
      type: 'devops',
      model: 'claude-3',
      provider: 'anthropic',
      channels: ['rest'],
      sandbox: { image: 'ai-army/devops:latest' },
    },
    workerId: 'vps-1',
    container: { id: 'def456' },
    soulContent: 'You are a DevOps expert...',
    createdAt: '2026-02-01T00:00:00.000Z',
    lastActiveAt: '2026-02-10T08:00:00.000Z',
  },
];

// ============================================================================
// Tests
// ============================================================================

describe('WorkerRouter', () => {
  /** @type {Object} */
  let mockBotManager;
  /** @type {WorkerRouter} */
  let router;

  beforeEach(() => {
    mockBotManager = createMockBotManager(sampleWorkers);
    router = new WorkerRouter({ botManager: mockBotManager });
  });

  // --------------------------------------------------------------------------
  // Constructor
  // --------------------------------------------------------------------------

  describe('constructor', () => {
    test('creates instance with botManager', () => {
      const r = new WorkerRouter({ botManager: mockBotManager });
      assert.equal(r.botManager, mockBotManager);
    });

    test('throws without botManager', () => {
      assert.throws(
        () => new WorkerRouter(),
        err => err instanceof WorkerRouterError && err.endpoint === 'constructor'
      );
    });

    test('throws with explicit null botManager', () => {
      assert.throws(
        () => new WorkerRouter({ botManager: null }),
        err => err instanceof WorkerRouterError
      );
    });

    test('accepts optional dependencies', () => {
      const logger = mock.fn();
      const messageProcessor = createMockMessageProcessor();
      const workerRegistry = createMockWorkerRegistry();
      const r = new WorkerRouter({
        botManager: mockBotManager,
        messageProcessor,
        workerRegistry,
        logger,
        apiKey: 'test-key',
      });
      assert.equal(r.logger, logger);
      assert.equal(r.messageProcessor, messageProcessor);
      assert.equal(r.workerRegistry, workerRegistry);
      assert.equal(r.apiKey, 'test-key');
    });

    test('defaults logger to null', () => {
      const r = new WorkerRouter({ botManager: mockBotManager });
      assert.equal(r.logger, null);
    });

    test('defaults workerRegistry to null', () => {
      const r = new WorkerRouter({ botManager: mockBotManager });
      assert.equal(r.workerRegistry, null);
    });

    test('defaults messageProcessor to null', () => {
      const r = new WorkerRouter({ botManager: mockBotManager });
      assert.equal(r.messageProcessor, null);
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/v1/workers
  // --------------------------------------------------------------------------

  describe('GET /api/v1/workers', () => {
    test('returns list of all workers', async () => {
      const req = createMockRequest({ method: 'GET', url: '/api/v1/workers' });
      const { res, getResponse } = createMockResponse();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.total, 3);
      assert.equal(response.body.workers.length, 3);
      assert.equal(response.body.workers[0].id, 'sarah-frontend');
      assert.equal(response.body.workers[0].name, 'Sarah (Frontend Developer)');
      assert.equal(response.body.workers[0].status, 'running');
    });

    test('returns empty list when no workers', async () => {
      router = new WorkerRouter({ botManager: createMockBotManager([]) });
      const req = createMockRequest({ method: 'GET', url: '/api/v1/workers' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.total, 0);
      assert.deepEqual(response.body.workers, []);
    });

    test('filters by status', async () => {
      const req = createMockRequest({
        method: 'GET',
        url: '/api/v1/workers?status=running',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.total, 2);
      assert.ok(response.body.workers.every(w => w.status === 'running'));
    });

    test('filters by serverId', async () => {
      const req = createMockRequest({
        method: 'GET',
        url: '/api/v1/workers?serverId=vps-1',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.total, 2);
      assert.ok(response.body.workers.every(w => w.serverId === 'vps-1'));
    });

    test('filters by type', async () => {
      const req = createMockRequest({
        method: 'GET',
        url: '/api/v1/workers?type=frontend-developer',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.total, 1);
      assert.equal(response.body.workers[0].id, 'sarah-frontend');
    });

    test('supports pagination', async () => {
      const req = createMockRequest({
        method: 'GET',
        url: '/api/v1/workers?page=1&limit=2',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.workers.length, 2);
      assert.equal(response.body.pagination.page, 1);
      assert.equal(response.body.pagination.limit, 2);
      assert.equal(response.body.pagination.total, 3);
      assert.equal(response.body.pagination.pages, 2);
    });

    test('returns second page of results', async () => {
      const req = createMockRequest({
        method: 'GET',
        url: '/api/v1/workers?page=2&limit=2',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.workers.length, 1);
      assert.equal(response.body.pagination.page, 2);
    });

    test('clamps limit to max 250', async () => {
      const req = createMockRequest({
        method: 'GET',
        url: '/api/v1/workers?limit=500',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.pagination.limit, 250);
    });

    test('clamps limit to min 1', async () => {
      const req = createMockRequest({
        method: 'GET',
        url: '/api/v1/workers?limit=0',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.pagination.limit, 1);
    });

    test('clamps page to min 1', async () => {
      const req = createMockRequest({
        method: 'GET',
        url: '/api/v1/workers?page=0',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.pagination.page, 1);
    });

    test('combines filters', async () => {
      const req = createMockRequest({
        method: 'GET',
        url: '/api/v1/workers?status=running&serverId=vps-1',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.total, 2);
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/v1/workers/:id
  // --------------------------------------------------------------------------

  describe('GET /api/v1/workers/:id', () => {
    test('returns worker details', async () => {
      const req = createMockRequest({ method: 'GET', url: '/api/v1/workers/sarah-frontend' });
      const { res, getResponse } = createMockResponse();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.id, 'sarah-frontend');
      assert.equal(response.body.name, 'Sarah (Frontend Developer)');
      assert.equal(response.body.type, 'frontend-developer');
      assert.equal(response.body.status, 'running');
      assert.equal(response.body.server.id, 'vps-1');
      assert.equal(response.body.container.id, 'abc123');
      assert.equal(response.body.container.image, 'ai-army/frontend-developer:latest');
      assert.equal(response.body.expertise, true);
    });

    test('returns 404 for unknown worker', async () => {
      const req = createMockRequest({ method: 'GET', url: '/api/v1/workers/unknown' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 404);
      assert.equal(response.body.error, 'Not Found');
      assert.equal(response.body.code, 'WORKER_NOT_FOUND');
      assert.equal(response.body.details.workerId, 'unknown');
    });

    test('handles worker with null config fields', async () => {
      const req = createMockRequest({ method: 'GET', url: '/api/v1/workers/mike-backend' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.expertise, false);
      assert.equal(response.body.container.id, null);
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/v1/workers/:id/status
  // --------------------------------------------------------------------------

  describe('GET /api/v1/workers/:id/status', () => {
    test('returns comprehensive worker status', async () => {
      const req = createMockRequest({
        method: 'GET',
        url: '/api/v1/workers/sarah-frontend/status',
      });
      const { res, getResponse } = createMockResponse();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.workerId, 'sarah-frontend');
      assert.equal(response.body.status, 'running');
      assert.equal(response.body.health, 'healthy');
      assert.ok(response.body.container);
      assert.ok(response.body.server);
    });

    test('returns 404 for unknown worker', async () => {
      const req = createMockRequest({
        method: 'GET',
        url: '/api/v1/workers/unknown/status',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 404);
      assert.equal(response.body.code, 'WORKER_NOT_FOUND');
    });

    test('returns health=stopped for stopped worker', async () => {
      const req = createMockRequest({
        method: 'GET',
        url: '/api/v1/workers/mike-backend/status',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.health, 'stopped');
    });

    test('includes worker registry info when available', async () => {
      const workerRegistry = createMockWorkerRegistry();
      router = new WorkerRouter({
        botManager: mockBotManager,
        workerRegistry,
      });

      const req = createMockRequest({
        method: 'GET',
        url: '/api/v1/workers/sarah-frontend/status',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.server.id, 'vps-1');
      assert.equal(response.body.server.healthy, true);
    });

    test('handles worker registry errors gracefully', async () => {
      const workerRegistry = {
        getWorkerLoad: mock.fn(async () => {
          throw new Error('DB connection failed');
        }),
      };
      router = new WorkerRouter({
        botManager: mockBotManager,
        workerRegistry,
      });

      const req = createMockRequest({
        method: 'GET',
        url: '/api/v1/workers/sarah-frontend/status',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      // Should still return status, just without detailed registry info
      assert.equal(response.body.workerId, 'sarah-frontend');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/v1/workers (Provision)
  // --------------------------------------------------------------------------

  describe('POST /api/v1/workers', () => {
    test('provisions a new worker', async () => {
      // Use a fresh bot manager that doesn't have the new worker
      const botManager = createMockBotManager([]);
      // After loadBot+startBot, getBot should return the new bot
      const newBot = {
        id: 'new-worker',
        status: 'running',
        config: { name: 'New Worker' },
        workerId: 'vps-1',
        createdAt: new Date().toISOString(),
      };
      // First call returns undefined (existence check), subsequent calls return the bot
      let getBotCallCount = 0;
      botManager.getBot = mock.fn(id => {
        getBotCallCount++;
        if (id === 'new-worker' && getBotCallCount > 1) return newBot;
        return undefined;
      });

      router = new WorkerRouter({ botManager });

      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/workers',
        headers: { 'content-type': 'application/json' },
        body: {
          id: 'new-worker',
          name: 'New Worker',
          type: 'general',
          image: 'ai-army/general:latest',
        },
      });
      const { res, getResponse } = createMockResponse();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      const response = getResponse();
      assert.equal(response.statusCode, 201);
      assert.equal(response.body.workerId, 'new-worker');
      assert.equal(response.body.status, 'running');
      assert.equal(botManager.loadBot.mock.calls.length, 1);
      assert.equal(botManager.startBot.mock.calls.length, 1);
    });

    test('returns 400 when id is missing', async () => {
      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/workers',
        headers: { 'content-type': 'application/json' },
        body: { name: 'No ID Worker' },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.code, 'VALIDATION_ERROR');
    });

    test('returns 409 when worker already exists', async () => {
      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/workers',
        headers: { 'content-type': 'application/json' },
        body: { id: 'sarah-frontend', name: 'Duplicate' },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 409);
      assert.equal(response.body.error, 'Conflict');
    });

    test('returns 500 when loadBot fails', async () => {
      const botManager = createMockBotManager([]);
      botManager.loadBot = mock.fn(async () => {
        throw new Error('Config validation failed');
      });
      router = new WorkerRouter({ botManager, logger: mock.fn() });

      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/workers',
        headers: { 'content-type': 'application/json' },
        body: { id: 'broken-worker' },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 500);
      assert.equal(response.body.code, 'DEPLOYMENT_FAILED');
      // Should try to clean up
      assert.equal(botManager.removeBot.mock.calls.length, 1);
    });

    test('provisions worker with LLM config', async () => {
      const botManager = createMockBotManager([]);
      const newBot = {
        id: 'llm-worker',
        status: 'running',
        config: { name: 'LLM Worker' },
        createdAt: new Date().toISOString(),
      };
      // First call returns undefined (existence check), subsequent calls return the bot
      let getBotCallCount = 0;
      botManager.getBot = mock.fn(id => {
        getBotCallCount++;
        if (id === 'llm-worker' && getBotCallCount > 1) return newBot;
        return undefined;
      });
      router = new WorkerRouter({ botManager });

      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/workers',
        headers: { 'content-type': 'application/json' },
        body: {
          id: 'llm-worker',
          llm: { provider: 'openai', model: 'gpt-4' },
        },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 201);
      // Verify loadBot was called with the right config
      const loadBotArgs = botManager.loadBot.mock.calls[0].arguments;
      assert.equal(loadBotArgs[0], 'llm-worker');
      assert.equal(loadBotArgs[1].provider, 'openai');
      assert.equal(loadBotArgs[1].model, 'gpt-4');
    });
  });

  // --------------------------------------------------------------------------
  // PUT /api/v1/workers/:id/image
  // --------------------------------------------------------------------------

  describe('PUT /api/v1/workers/:id/image', () => {
    test('updates worker image', async () => {
      const req = createMockRequest({
        method: 'PUT',
        url: '/api/v1/workers/sarah-frontend/image',
        headers: { 'content-type': 'application/json' },
        body: { image: 'ai-army/frontend-developer:v2.0' },
      });
      const { res, getResponse } = createMockResponse();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.workerId, 'sarah-frontend');
      assert.equal(response.body.previousImage, 'ai-army/frontend-developer:latest');
      assert.equal(response.body.newImage, 'ai-army/frontend-developer:v2.0');
      assert.equal(response.body.status, 'updated');
    });

    test('returns 404 for unknown worker', async () => {
      const req = createMockRequest({
        method: 'PUT',
        url: '/api/v1/workers/unknown/image',
        headers: { 'content-type': 'application/json' },
        body: { image: 'new-image:latest' },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 404);
    });

    test('returns 400 when image is missing', async () => {
      const req = createMockRequest({
        method: 'PUT',
        url: '/api/v1/workers/sarah-frontend/image',
        headers: { 'content-type': 'application/json' },
        body: {},
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.code, 'VALIDATION_ERROR');
    });

    test('returns 400 when image is not a string', async () => {
      const req = createMockRequest({
        method: 'PUT',
        url: '/api/v1/workers/sarah-frontend/image',
        headers: { 'content-type': 'application/json' },
        body: { image: 123 },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 400);
    });
  });

  // --------------------------------------------------------------------------
  // PUT /api/v1/workers/:id/expertise
  // --------------------------------------------------------------------------

  describe('PUT /api/v1/workers/:id/expertise', () => {
    test('updates worker expertise', async () => {
      const req = createMockRequest({
        method: 'PUT',
        url: '/api/v1/workers/sarah-frontend/expertise',
        headers: { 'content-type': 'application/json' },
        body: {
          expertise: 'You are Sarah, senior React developer with accessibility expertise...',
        },
      });
      const { res, getResponse } = createMockResponse();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.workerId, 'sarah-frontend');
      assert.equal(response.body.status, 'updated');
      assert.ok(response.body.expertiseLength > 0);
    });

    test('returns 404 for unknown worker', async () => {
      const req = createMockRequest({
        method: 'PUT',
        url: '/api/v1/workers/unknown/expertise',
        headers: { 'content-type': 'application/json' },
        body: { expertise: 'New expertise' },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 404);
    });

    test('returns 400 when expertise is missing', async () => {
      const req = createMockRequest({
        method: 'PUT',
        url: '/api/v1/workers/sarah-frontend/expertise',
        headers: { 'content-type': 'application/json' },
        body: {},
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.code, 'VALIDATION_ERROR');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/v1/workers/:id/reload
  // --------------------------------------------------------------------------

  describe('POST /api/v1/workers/:id/reload', () => {
    test('reloads worker configuration', async () => {
      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/workers/sarah-frontend/reload',
        headers: { 'content-type': 'application/json' },
        body: {},
      });
      const { res, getResponse } = createMockResponse();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.workerId, 'sarah-frontend');
      assert.equal(response.body.status, 'reloaded');
      assert.equal(mockBotManager.reloadBot.mock.calls.length, 1);
    });

    test('returns 404 for unknown worker', async () => {
      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/workers/unknown/reload',
        headers: { 'content-type': 'application/json' },
        body: {},
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 404);
    });

    test('returns 500 when reloadBot fails', async () => {
      mockBotManager.reloadBot = mock.fn(async () => {
        throw new Error('Reload failed');
      });
      router = new WorkerRouter({ botManager: mockBotManager, logger: mock.fn() });

      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/workers/sarah-frontend/reload',
        headers: { 'content-type': 'application/json' },
        body: {},
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 500);
      assert.ok(response.body.message.includes('Reload failed'));
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/v1/workers/:id/stop
  // --------------------------------------------------------------------------

  describe('POST /api/v1/workers/:id/stop', () => {
    test('stops a running worker', async () => {
      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/workers/sarah-frontend/stop',
        headers: { 'content-type': 'application/json' },
        body: {},
      });
      const { res, getResponse } = createMockResponse();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.workerId, 'sarah-frontend');
      assert.equal(response.body.status, 'stopped');
      assert.equal(mockBotManager.stopBot.mock.calls.length, 1);
    });

    test('returns 200 for already stopped worker', async () => {
      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/workers/mike-backend/stop',
        headers: { 'content-type': 'application/json' },
        body: {},
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.ok(response.body.message.includes('already stopped'));
      assert.equal(mockBotManager.stopBot.mock.calls.length, 0);
    });

    test('returns 404 for unknown worker', async () => {
      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/workers/unknown/stop',
        headers: { 'content-type': 'application/json' },
        body: {},
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 404);
    });

    test('returns 500 when stopBot fails', async () => {
      mockBotManager.stopBot = mock.fn(async () => {
        throw new Error('Container stop timeout');
      });
      router = new WorkerRouter({ botManager: mockBotManager, logger: mock.fn() });

      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/workers/sarah-frontend/stop',
        headers: { 'content-type': 'application/json' },
        body: {},
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 500);
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/v1/workers/:id/start
  // --------------------------------------------------------------------------

  describe('POST /api/v1/workers/:id/start', () => {
    test('starts a stopped worker', async () => {
      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/workers/mike-backend/start',
        headers: { 'content-type': 'application/json' },
        body: {},
      });
      const { res, getResponse } = createMockResponse();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.workerId, 'mike-backend');
      assert.equal(response.body.status, 'running');
      assert.equal(mockBotManager.startBot.mock.calls.length, 1);
    });

    test('returns 200 for already running worker', async () => {
      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/workers/sarah-frontend/start',
        headers: { 'content-type': 'application/json' },
        body: {},
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.ok(response.body.message.includes('already running'));
      assert.equal(mockBotManager.startBot.mock.calls.length, 0);
    });

    test('returns 404 for unknown worker', async () => {
      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/workers/unknown/start',
        headers: { 'content-type': 'application/json' },
        body: {},
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 404);
    });

    test('returns 500 when startBot fails', async () => {
      mockBotManager.startBot = mock.fn(async () => {
        throw new Error('Container start failed');
      });
      router = new WorkerRouter({ botManager: mockBotManager, logger: mock.fn() });

      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/workers/mike-backend/start',
        headers: { 'content-type': 'application/json' },
        body: {},
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 500);
    });
  });

  // --------------------------------------------------------------------------
  // DELETE /api/v1/workers/:id
  // --------------------------------------------------------------------------

  describe('DELETE /api/v1/workers/:id', () => {
    test('deprovisions a worker', async () => {
      const req = createMockRequest({
        method: 'DELETE',
        url: '/api/v1/workers/sarah-frontend',
      });
      const { res, getResponse } = createMockResponse();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.workerId, 'sarah-frontend');
      assert.equal(response.body.status, 'deprovisioned');
      assert.equal(response.body.preserveWorkspace, false);
      assert.equal(mockBotManager.removeBot.mock.calls.length, 1);
    });

    test('deprovisions with preserveWorkspace=true', async () => {
      const req = createMockRequest({
        method: 'DELETE',
        url: '/api/v1/workers/sarah-frontend?preserveWorkspace=true',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.preserveWorkspace, true);
    });

    test('returns 404 for unknown worker', async () => {
      const req = createMockRequest({
        method: 'DELETE',
        url: '/api/v1/workers/unknown',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 404);
    });

    test('returns 500 when removeBot fails', async () => {
      mockBotManager.removeBot = mock.fn(async () => {
        throw new Error('Container cleanup failed');
      });
      router = new WorkerRouter({ botManager: mockBotManager, logger: mock.fn() });

      const req = createMockRequest({
        method: 'DELETE',
        url: '/api/v1/workers/sarah-frontend',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 500);
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/v1/workers/:id/assign
  // --------------------------------------------------------------------------

  describe('POST /api/v1/workers/:id/assign', () => {
    test('assigns a task to a worker', async () => {
      const messageProcessor = createMockMessageProcessor();
      router = new WorkerRouter({ botManager: mockBotManager, messageProcessor });

      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/workers/sarah-frontend/assign',
        headers: { 'content-type': 'application/json' },
        body: {
          task: 'Implement login UI component',
          context: {
            files: ['src/pages/Login.tsx'],
            requirements: 'Use Tailwind, add loading state',
          },
        },
      });
      const { res, getResponse } = createMockResponse();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.ok(response.body.assignmentId.startsWith('asgn-'));
      assert.equal(response.body.workerId, 'sarah-frontend');
      assert.equal(response.body.status, 'completed');
      assert.ok(response.body.result.text);
      assert.ok(response.body.result.sessionId);
    });

    test('returns 503 when messageProcessor not available', async () => {
      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/workers/sarah-frontend/assign',
        headers: { 'content-type': 'application/json' },
        body: { task: 'Some task' },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 503);
      assert.equal(response.body.error, 'Service Unavailable');
    });

    test('returns 404 for unknown worker', async () => {
      const messageProcessor = createMockMessageProcessor();
      router = new WorkerRouter({ botManager: mockBotManager, messageProcessor });

      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/workers/unknown/assign',
        headers: { 'content-type': 'application/json' },
        body: { task: 'Some task' },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 404);
    });

    test('returns 400 when task is missing', async () => {
      const messageProcessor = createMockMessageProcessor();
      router = new WorkerRouter({ botManager: mockBotManager, messageProcessor });

      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/workers/sarah-frontend/assign',
        headers: { 'content-type': 'application/json' },
        body: {},
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.code, 'VALIDATION_ERROR');
    });

    test('returns 500 when processMessage fails', async () => {
      const messageProcessor = {
        processMessage: mock.fn(async () => {
          throw new Error('LLM timeout');
        }),
      };
      router = new WorkerRouter({
        botManager: mockBotManager,
        messageProcessor,
        logger: mock.fn(),
      });

      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/workers/sarah-frontend/assign',
        headers: { 'content-type': 'application/json' },
        body: { task: 'Some task' },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 500);
      assert.ok(response.body.message.includes('LLM timeout'));
    });

    test('assigns task without context', async () => {
      const messageProcessor = createMockMessageProcessor();
      router = new WorkerRouter({ botManager: mockBotManager, messageProcessor });

      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/workers/sarah-frontend/assign',
        headers: { 'content-type': 'application/json' },
        body: { task: 'Simple task without context' },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      // Verify processMessage was called with just the task text
      const callArgs = messageProcessor.processMessage.mock.calls[0].arguments;
      assert.equal(callArgs[1].text, 'Simple task without context');
    });
  });

  // --------------------------------------------------------------------------
  // Authentication
  // --------------------------------------------------------------------------

  describe('authentication', () => {
    test('rejects request when apiKey configured and no auth header', async () => {
      router = new WorkerRouter({ botManager: mockBotManager, apiKey: 'secret123' });
      const req = createMockRequest({ method: 'GET', url: '/api/v1/workers' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 401);
    });

    test('rejects request with wrong API key', async () => {
      router = new WorkerRouter({ botManager: mockBotManager, apiKey: 'secret123' });
      const req = createMockRequest({
        method: 'GET',
        url: '/api/v1/workers',
        headers: { authorization: 'Bearer wrong-key' },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 401);
    });

    test('allows request with correct API key', async () => {
      router = new WorkerRouter({ botManager: mockBotManager, apiKey: 'secret123' });
      const req = createMockRequest({
        method: 'GET',
        url: '/api/v1/workers',
        headers: { authorization: 'Bearer secret123' },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
    });

    test('allows all requests when no apiKey configured', async () => {
      const req = createMockRequest({ method: 'GET', url: '/api/v1/workers' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
    });

    test('rejects non-Bearer auth schemes', async () => {
      router = new WorkerRouter({ botManager: mockBotManager, apiKey: 'secret123' });
      const req = createMockRequest({
        method: 'GET',
        url: '/api/v1/workers',
        headers: { authorization: 'Basic dXNlcjpwYXNz' },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 401);
    });
  });

  // --------------------------------------------------------------------------
  // Route matching
  // --------------------------------------------------------------------------

  describe('route matching', () => {
    test('returns false for non-matching paths', async () => {
      const req = createMockRequest({ method: 'GET', url: '/api/v1/servers' });
      const { res } = createMockResponse();

      const handled = await router.handleRequest(req, res);
      assert.equal(handled, false);
    });

    test('returns false for legacy /api/bots path', async () => {
      const req = createMockRequest({ method: 'GET', url: '/api/bots' });
      const { res } = createMockResponse();

      const handled = await router.handleRequest(req, res);
      assert.equal(handled, false);
    });

    test('returns false for empty method', async () => {
      const req = createMockRequest({ method: '', url: '/api/v1/workers' });
      const { res } = createMockResponse();

      const handled = await router.handleRequest(req, res);
      assert.equal(handled, false);
    });

    test('returns false for PATCH /api/v1/workers/:id (unregistered method)', async () => {
      const req = createMockRequest({
        method: 'PATCH',
        url: '/api/v1/workers/sarah-frontend',
      });
      const { res } = createMockResponse();

      const handled = await router.handleRequest(req, res);
      assert.equal(handled, false);
    });

    test('handles URL-encoded parameters', async () => {
      // Create a worker with a special character in ID
      const bots = [
        {
          id: 'worker-with-spaces',
          status: 'running',
          config: { name: 'Special Worker' },
          createdAt: new Date().toISOString(),
        },
      ];
      router = new WorkerRouter({ botManager: createMockBotManager(bots) });

      const req = createMockRequest({
        method: 'GET',
        url: '/api/v1/workers/worker-with-spaces',
      });
      const { res, getResponse } = createMockResponse();

      const handled = await router.handleRequest(req, res);
      assert.equal(handled, true);
      const response = getResponse();
      assert.equal(response.statusCode, 200);
    });

    test('handles malformed Host header gracefully', async () => {
      const req = createMockRequest({ method: 'GET', url: '/api/v1/workers' });
      req.headers.host = 'invalid host with spaces';
      const { res, getResponse } = createMockResponse();

      const handled = await router.handleRequest(req, res);
      assert.equal(handled, true);
      const response = getResponse();
      assert.equal(response.statusCode, 200);
    });
  });

  // --------------------------------------------------------------------------
  // JSON body parsing
  // --------------------------------------------------------------------------

  describe('JSON body parsing', () => {
    test('returns 400 for invalid JSON body on POST', async () => {
      const readable = new Readable({ read() {} });
      readable.method = 'POST';
      readable.url = '/api/v1/workers';
      readable.headers = { host: 'localhost:3000', 'content-type': 'application/json' };
      readable.socket = { remoteAddress: '127.0.0.1' };

      process.nextTick(() => {
        readable.push('not valid json{{{');
        readable.push(null);
      });

      const { res, getResponse } = createMockResponse();
      await router.handleRequest(readable, res);

      const response = getResponse();
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.error, 'Bad Request');
    });

    test('returns 400 for invalid JSON body on PUT', async () => {
      const readable = new Readable({ read() {} });
      readable.method = 'PUT';
      readable.url = '/api/v1/workers/sarah-frontend/image';
      readable.headers = { host: 'localhost:3000', 'content-type': 'application/json' };
      readable.socket = { remoteAddress: '127.0.0.1' };

      process.nextTick(() => {
        readable.push('{bad json');
        readable.push(null);
      });

      const { res, getResponse } = createMockResponse();
      await router.handleRequest(readable, res);

      const response = getResponse();
      assert.equal(response.statusCode, 400);
    });

    test('handles empty body as empty object', async () => {
      const botManager = createMockBotManager([]);
      router = new WorkerRouter({ botManager });

      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/workers',
        headers: { 'content-type': 'application/json' },
        // body: null -> empty body
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      // Should return 400 because id is missing, not crash
      assert.equal(response.statusCode, 400);
    });
  });

  // --------------------------------------------------------------------------
  // Audit logging
  // --------------------------------------------------------------------------

  describe('audit logging', () => {
    test('logs audit event on provision', async () => {
      const auditLogger = { log: mock.fn(async () => {}) };
      const botManager = createMockBotManager([]);
      const newBot = {
        id: 'audited-worker',
        status: 'running',
        config: { name: 'Audited Worker' },
        createdAt: new Date().toISOString(),
      };
      // First call returns undefined (existence check), subsequent calls return the bot
      let getBotCallCount = 0;
      botManager.getBot = mock.fn(id => {
        getBotCallCount++;
        if (id === 'audited-worker' && getBotCallCount > 1) return newBot;
        return undefined;
      });

      router = new WorkerRouter({ botManager, auditLogger });

      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/workers',
        headers: { 'content-type': 'application/json' },
        body: { id: 'audited-worker' },
      });
      const { res } = createMockResponse();

      await router.handleRequest(req, res);

      assert.equal(auditLogger.log.mock.calls.length, 1);
      const auditEvent = auditLogger.log.mock.calls[0].arguments[0];
      assert.equal(auditEvent.type, 'worker.provisioned');
      assert.equal(auditEvent.resourceId, 'audited-worker');
    });

    test('does not crash when auditLogger is not configured', async () => {
      const botManager = createMockBotManager([]);
      const newBot = {
        id: 'no-audit-worker',
        status: 'running',
        config: { name: 'No Audit Worker' },
        createdAt: new Date().toISOString(),
      };
      // First call returns undefined (existence check), subsequent calls return the bot
      let getBotCallCount = 0;
      botManager.getBot = mock.fn(id => {
        getBotCallCount++;
        if (id === 'no-audit-worker' && getBotCallCount > 1) return newBot;
        return undefined;
      });

      router = new WorkerRouter({ botManager });

      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/workers',
        headers: { 'content-type': 'application/json' },
        body: { id: 'no-audit-worker' },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 201);
    });
  });

  // --------------------------------------------------------------------------
  // WorkerRouterError
  // --------------------------------------------------------------------------

  describe('WorkerRouterError', () => {
    test('creates error with correct name and fields', () => {
      const cause = new Error('root');
      const err = new WorkerRouterError('test error', {
        cause,
        endpoint: '/api/v1/workers',
        statusCode: 500,
      });
      assert.equal(err.name, 'WorkerRouterError');
      assert.equal(err.message, 'test error');
      assert.equal(err.endpoint, '/api/v1/workers');
      assert.equal(err.statusCode, 500);
      assert.equal(err.cause, cause);
    });

    test('creates error with defaults', () => {
      const err = new WorkerRouterError('simple error');
      assert.equal(err.name, 'WorkerRouterError');
      assert.equal(err.endpoint, undefined);
      assert.equal(err.statusCode, undefined);
    });
  });

  // --------------------------------------------------------------------------
  // Error handling in route handlers
  // --------------------------------------------------------------------------

  describe('error handling', () => {
    test('catches and returns 500 for unhandled handler errors', async () => {
      mockBotManager.listBots = mock.fn(() => {
        throw new Error('Unexpected crash');
      });
      router = new WorkerRouter({ botManager: mockBotManager, logger: mock.fn() });

      const req = createMockRequest({ method: 'GET', url: '/api/v1/workers' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 500);
      assert.equal(response.body.error, 'Internal Server Error');
    });
  });
});
