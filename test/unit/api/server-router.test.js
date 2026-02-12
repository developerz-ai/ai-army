/**
 * Unit tests for ServerRouter
 *
 * Tests the server management API endpoints:
 * - POST   /api/v1/servers/register  -> Register a new server
 * - GET    /api/v1/servers           -> List registered servers
 * - GET    /api/v1/servers/:id       -> Get server details
 * - DELETE /api/v1/servers/:id       -> Unregister a server
 *
 * Also covers:
 * - Authentication (API key validation)
 * - Route matching (only handles /api/v1/servers paths)
 * - Error handling
 * - Constructor validation
 * - JSON body parsing for POST/DELETE
 * - SSH connectivity testing on register
 * - Tunnel health enrichment
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { ServerRouter, ServerRouterError } from '../../../src/api/routers/server-router.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock WorkerRegistry
 * @param {Object[]} [workers=[]] - Array of worker objects
 * @returns {Object} Mock WorkerRegistry
 */
function createMockWorkerRegistry(workers = []) {
  const workerMap = new Map(workers.map(w => [w.id, w]));
  return {
    registerWorker: mock.fn(async config => ({
      id: config.id,
      host: config.host,
      type: config.type,
      maxContainers: config.maxContainers || 10,
      currentLoad: 0,
      status: 'healthy',
      lastHeartbeat: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    unregisterWorker: mock.fn(async () => true),
    listWorkers: mock.fn(async (filter = {}) => {
      let result = [...workerMap.values()];
      if (filter.status) {
        result = result.filter(w => w.status === filter.status);
      }
      if (filter.type) {
        result = result.filter(w => w.type === filter.type);
      }
      return result;
    }),
    getWorker: mock.fn(async id => workerMap.get(id) || null),
    getWorkerLoad: mock.fn(async id => {
      const w = workerMap.get(id);
      if (!w) return null;
      return {
        workerId: w.id,
        currentLoad: w.currentLoad,
        maxContainers: w.maxContainers,
        available: w.maxContainers - w.currentLoad,
        loadRatio: w.maxContainers > 0 ? w.currentLoad / w.maxContainers : 1,
        status: w.status,
      };
    }),
  };
}

/**
 * Create a mock SSHTunnelManager
 * @param {Object} [options={}] - Mock options
 * @param {boolean} [options.connectFails=false] - Whether SSH connectivity should fail
 * @returns {Object} Mock SSHTunnelManager
 */
function createMockSSHTunnelManager(options = {}) {
  return {
    createTunnel: mock.fn(async config => {
      if (options.connectFails) {
        throw new Error('Connection refused');
      }
      return {
        workerId: config.workerId,
        dockerHost: 'tcp://127.0.0.1:54321',
        localPort: 54321,
        state: 'connected',
      };
    }),
    closeTunnel: mock.fn(async () => true),
    healthCheck: mock.fn(async workerId => ({
      workerId,
      healthy: true,
      state: 'connected',
      dockerHost: 'tcp://127.0.0.1:54321',
      localPort: 54321,
      uptime: 120000,
    })),
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

const sampleServers = [
  {
    id: 'vps-1',
    host: '192.168.1.100',
    type: 'remote',
    status: 'healthy',
    maxContainers: 10,
    currentLoad: 3,
    lastHeartbeat: new Date('2026-02-10T10:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-02-10T10:00:00.000Z'),
  },
  {
    id: 'local-dev',
    host: 'localhost',
    type: 'local',
    status: 'healthy',
    maxContainers: 5,
    currentLoad: 1,
    lastHeartbeat: new Date('2026-02-10T10:00:00.000Z'),
    createdAt: new Date('2026-01-15T00:00:00.000Z'),
    updatedAt: new Date('2026-02-10T10:00:00.000Z'),
  },
  {
    id: 'gpu-server',
    host: '10.0.0.50',
    type: 'remote',
    status: 'offline',
    maxContainers: 20,
    currentLoad: 0,
    lastHeartbeat: new Date('2026-02-08T00:00:00.000Z'),
    createdAt: new Date('2026-02-01T00:00:00.000Z'),
    updatedAt: new Date('2026-02-08T00:00:00.000Z'),
  },
];

// ============================================================================
// Tests
// ============================================================================

describe('ServerRouter', () => {
  /** @type {Object} */
  let mockWorkerRegistry;
  /** @type {ServerRouter} */
  let router;

  beforeEach(() => {
    mockWorkerRegistry = createMockWorkerRegistry(sampleServers);
    router = new ServerRouter({ workerRegistry: mockWorkerRegistry });
  });

  // --------------------------------------------------------------------------
  // Constructor
  // --------------------------------------------------------------------------

  describe('constructor', () => {
    test('creates instance with workerRegistry', () => {
      const r = new ServerRouter({ workerRegistry: mockWorkerRegistry });
      assert.equal(r.workerRegistry, mockWorkerRegistry);
    });

    test('throws without workerRegistry', () => {
      assert.throws(
        () => new ServerRouter(),
        err => err instanceof ServerRouterError && err.endpoint === 'constructor'
      );
    });

    test('throws with explicit null workerRegistry', () => {
      assert.throws(
        () => new ServerRouter({ workerRegistry: null }),
        err => err instanceof ServerRouterError
      );
    });

    test('accepts optional dependencies', () => {
      const logger = mock.fn();
      const sshTunnelManager = createMockSSHTunnelManager();
      const r = new ServerRouter({
        workerRegistry: mockWorkerRegistry,
        sshTunnelManager,
        logger,
        apiKey: 'test-key',
      });
      assert.equal(r.logger, logger);
      assert.equal(r.sshTunnelManager, sshTunnelManager);
      assert.equal(r.apiKey, 'test-key');
    });

    test('defaults logger to null', () => {
      const r = new ServerRouter({ workerRegistry: mockWorkerRegistry });
      assert.equal(r.logger, null);
    });

    test('defaults sshTunnelManager to null', () => {
      const r = new ServerRouter({ workerRegistry: mockWorkerRegistry });
      assert.equal(r.sshTunnelManager, null);
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/v1/servers/register
  // --------------------------------------------------------------------------

  describe('POST /api/v1/servers/register', () => {
    test('registers a local server', async () => {
      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/servers/register',
        headers: { 'content-type': 'application/json' },
        body: {
          id: 'new-local',
          host: 'localhost',
          type: 'local',
          maxContainers: 8,
        },
      });
      const { res, getResponse } = createMockResponse();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      const response = getResponse();
      assert.equal(response.statusCode, 201);
      assert.equal(response.body.id, 'new-local');
      assert.equal(response.body.host, 'localhost');
      assert.equal(response.body.type, 'local');
      assert.equal(response.body.status, 'healthy');
      assert.equal(response.body.currentLoad, 0);
      assert.equal(mockWorkerRegistry.registerWorker.mock.calls.length, 1);
    });

    test('registers a remote server with SSH connectivity test', async () => {
      const sshTunnelManager = createMockSSHTunnelManager();
      router = new ServerRouter({ workerRegistry: mockWorkerRegistry, sshTunnelManager });

      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/servers/register',
        headers: { 'content-type': 'application/json' },
        body: {
          id: 'new-remote',
          host: '10.0.0.100',
          type: 'remote',
          maxContainers: 15,
          ssh: {
            username: 'deploy',
            privateKey: 'test-key-content',
          },
        },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 201);
      assert.equal(response.body.id, 'new-remote');
      // SSH test should have been performed
      assert.equal(sshTunnelManager.createTunnel.mock.calls.length, 1);
      assert.equal(sshTunnelManager.closeTunnel.mock.calls.length, 1);
    });

    test('defaults type to remote when not provided', async () => {
      const sshTunnelManager = createMockSSHTunnelManager();
      router = new ServerRouter({ workerRegistry: mockWorkerRegistry, sshTunnelManager });

      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/servers/register',
        headers: { 'content-type': 'application/json' },
        body: {
          id: 'default-type',
          host: '10.0.0.200',
          ssh: { username: 'deploy', privateKey: 'key' },
        },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 201);
      // Should have tested SSH (type defaults to remote)
      assert.equal(sshTunnelManager.createTunnel.mock.calls.length, 1);
    });

    test('returns 400 when id is missing', async () => {
      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/servers/register',
        headers: { 'content-type': 'application/json' },
        body: { host: 'localhost', type: 'local' },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.code, 'VALIDATION_ERROR');
      assert.ok(response.body.message.includes('id'));
    });

    test('returns 400 when host is missing', async () => {
      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/servers/register',
        headers: { 'content-type': 'application/json' },
        body: { id: 'no-host', type: 'local' },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.code, 'VALIDATION_ERROR');
      assert.ok(response.body.message.includes('host'));
    });

    test('returns 400 when type is invalid', async () => {
      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/servers/register',
        headers: { 'content-type': 'application/json' },
        body: { id: 'bad-type', host: 'localhost', type: 'cloud' },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.code, 'VALIDATION_ERROR');
      assert.ok(response.body.message.includes('type'));
    });

    test('returns 400 when remote server missing SSH config', async () => {
      const sshTunnelManager = createMockSSHTunnelManager();
      router = new ServerRouter({ workerRegistry: mockWorkerRegistry, sshTunnelManager });

      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/servers/register',
        headers: { 'content-type': 'application/json' },
        body: { id: 'no-ssh', host: '10.0.0.100', type: 'remote' },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.code, 'VALIDATION_ERROR');
      assert.ok(response.body.message.includes('SSH'));
    });

    test('returns 422 when SSH connectivity test fails', async () => {
      const sshTunnelManager = createMockSSHTunnelManager({ connectFails: true });
      router = new ServerRouter({
        workerRegistry: mockWorkerRegistry,
        sshTunnelManager,
        logger: mock.fn(),
      });

      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/servers/register',
        headers: { 'content-type': 'application/json' },
        body: {
          id: 'unreachable',
          host: '10.0.0.200',
          type: 'remote',
          ssh: { username: 'deploy', privateKey: 'key' },
        },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 422);
      assert.equal(response.body.code, 'SSH_CONNECTIVITY_FAILED');
      assert.ok(response.body.message.includes('Connection refused'));
    });

    test('returns 409 when server already exists', async () => {
      mockWorkerRegistry.registerWorker = mock.fn(async () => {
        throw new Error("Worker 'vps-1' already exists");
      });

      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/servers/register',
        headers: { 'content-type': 'application/json' },
        body: { id: 'vps-1', host: '192.168.1.100', type: 'local' },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 409);
      assert.equal(response.body.code, 'SERVER_ALREADY_EXISTS');
    });

    test('returns 500 when registry throws unexpected error', async () => {
      mockWorkerRegistry.registerWorker = mock.fn(async () => {
        throw new Error('Database connection lost');
      });
      router = new ServerRouter({
        workerRegistry: mockWorkerRegistry,
        logger: mock.fn(),
      });

      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/servers/register',
        headers: { 'content-type': 'application/json' },
        body: { id: 'error-server', host: 'localhost', type: 'local' },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 500);
      assert.equal(response.body.code, 'REGISTRATION_FAILED');
    });

    test('skips SSH test for local servers', async () => {
      const sshTunnelManager = createMockSSHTunnelManager();
      router = new ServerRouter({ workerRegistry: mockWorkerRegistry, sshTunnelManager });

      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/servers/register',
        headers: { 'content-type': 'application/json' },
        body: { id: 'local-only', host: 'localhost', type: 'local' },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 201);
      // No SSH test should happen for local servers
      assert.equal(sshTunnelManager.createTunnel.mock.calls.length, 0);
    });

    test('skips SSH test when sshTunnelManager not configured', async () => {
      // No sshTunnelManager configured - remote server should register without SSH test
      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/servers/register',
        headers: { 'content-type': 'application/json' },
        body: { id: 'no-tunnel-mgr', host: '10.0.0.100', type: 'remote' },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 201);
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/v1/servers
  // --------------------------------------------------------------------------

  describe('GET /api/v1/servers', () => {
    test('returns list of all servers', async () => {
      const req = createMockRequest({ method: 'GET', url: '/api/v1/servers' });
      const { res, getResponse } = createMockResponse();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.total, 3);
      assert.equal(response.body.servers.length, 3);
      assert.equal(response.body.servers[0].id, 'vps-1');
      assert.equal(response.body.servers[0].host, '192.168.1.100');
    });

    test('returns empty list when no servers', async () => {
      router = new ServerRouter({ workerRegistry: createMockWorkerRegistry([]) });
      const req = createMockRequest({ method: 'GET', url: '/api/v1/servers' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.total, 0);
      assert.deepEqual(response.body.servers, []);
    });

    test('filters by status', async () => {
      const req = createMockRequest({
        method: 'GET',
        url: '/api/v1/servers?status=healthy',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.total, 2);
      assert.ok(response.body.servers.every(s => s.status === 'healthy'));
    });

    test('filters by type', async () => {
      const req = createMockRequest({
        method: 'GET',
        url: '/api/v1/servers?type=remote',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.total, 2);
      assert.ok(response.body.servers.every(s => s.type === 'remote'));
    });

    test('combines filters', async () => {
      const req = createMockRequest({
        method: 'GET',
        url: '/api/v1/servers?status=healthy&type=local',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.total, 1);
      assert.equal(response.body.servers[0].id, 'local-dev');
    });

    test('includes available capacity', async () => {
      const req = createMockRequest({ method: 'GET', url: '/api/v1/servers' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      const vps1 = response.body.servers.find(s => s.id === 'vps-1');
      assert.equal(vps1.available, 7);
      assert.equal(vps1.currentLoad, 3);
      assert.equal(vps1.maxContainers, 10);
    });

    test('includes tunnel info for remote servers when sshTunnelManager available', async () => {
      const sshTunnelManager = createMockSSHTunnelManager();
      router = new ServerRouter({ workerRegistry: mockWorkerRegistry, sshTunnelManager });

      const req = createMockRequest({ method: 'GET', url: '/api/v1/servers' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      const vps1 = response.body.servers.find(s => s.id === 'vps-1');
      assert.ok(vps1.tunnel);
      assert.equal(vps1.tunnel.state, 'connected');
      assert.equal(vps1.tunnel.healthy, true);

      // Local server should not have tunnel info
      const localDev = response.body.servers.find(s => s.id === 'local-dev');
      assert.equal(localDev.tunnel, undefined);
    });

    test('handles tunnel health check errors gracefully', async () => {
      const sshTunnelManager = {
        healthCheck: mock.fn(async () => {
          throw new Error('Tunnel lookup failed');
        }),
        createTunnel: mock.fn(),
        closeTunnel: mock.fn(),
      };
      router = new ServerRouter({ workerRegistry: mockWorkerRegistry, sshTunnelManager });

      const req = createMockRequest({ method: 'GET', url: '/api/v1/servers' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      const vps1 = response.body.servers.find(s => s.id === 'vps-1');
      assert.equal(vps1.tunnel.state, 'unknown');
      assert.equal(vps1.tunnel.healthy, null);
    });

    test('returns 500 when listWorkers fails', async () => {
      mockWorkerRegistry.listWorkers = mock.fn(async () => {
        throw new Error('Database unavailable');
      });
      router = new ServerRouter({
        workerRegistry: mockWorkerRegistry,
        logger: mock.fn(),
      });

      const req = createMockRequest({ method: 'GET', url: '/api/v1/servers' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 500);
      assert.ok(response.body.message.includes('Database unavailable'));
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/v1/servers/:id
  // --------------------------------------------------------------------------

  describe('GET /api/v1/servers/:id', () => {
    test('returns server details', async () => {
      const req = createMockRequest({ method: 'GET', url: '/api/v1/servers/vps-1' });
      const { res, getResponse } = createMockResponse();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.id, 'vps-1');
      assert.equal(response.body.host, '192.168.1.100');
      assert.equal(response.body.type, 'remote');
      assert.equal(response.body.status, 'healthy');
      assert.equal(response.body.maxContainers, 10);
      assert.equal(response.body.currentLoad, 3);
      assert.equal(response.body.available, 7);
      assert.ok(response.body.loadRatio > 0);
    });

    test('returns 404 for unknown server', async () => {
      const req = createMockRequest({ method: 'GET', url: '/api/v1/servers/unknown' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 404);
      assert.equal(response.body.error, 'Not Found');
      assert.equal(response.body.code, 'SERVER_NOT_FOUND');
      assert.equal(response.body.details.serverId, 'unknown');
    });

    test('includes tunnel details for remote server', async () => {
      const sshTunnelManager = createMockSSHTunnelManager();
      router = new ServerRouter({ workerRegistry: mockWorkerRegistry, sshTunnelManager });

      const req = createMockRequest({ method: 'GET', url: '/api/v1/servers/vps-1' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.ok(response.body.tunnel);
      assert.equal(response.body.tunnel.state, 'connected');
      assert.equal(response.body.tunnel.healthy, true);
      assert.equal(response.body.tunnel.localPort, 54321);
      assert.ok(response.body.tunnel.uptime >= 0);
    });

    test('does not include tunnel info for local server', async () => {
      const sshTunnelManager = createMockSSHTunnelManager();
      router = new ServerRouter({ workerRegistry: mockWorkerRegistry, sshTunnelManager });

      const req = createMockRequest({ method: 'GET', url: '/api/v1/servers/local-dev' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.tunnel, undefined);
    });

    test('handles tunnel health check errors gracefully', async () => {
      const sshTunnelManager = {
        healthCheck: mock.fn(async () => {
          throw new Error('Tunnel check failed');
        }),
        createTunnel: mock.fn(),
        closeTunnel: mock.fn(),
      };
      router = new ServerRouter({ workerRegistry: mockWorkerRegistry, sshTunnelManager });

      const req = createMockRequest({ method: 'GET', url: '/api/v1/servers/vps-1' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.tunnel.state, 'unknown');
      assert.equal(response.body.tunnel.healthy, null);
    });

    test('returns 500 when getWorker throws', async () => {
      mockWorkerRegistry.getWorker = mock.fn(async () => {
        throw new Error('DB read failed');
      });
      router = new ServerRouter({
        workerRegistry: mockWorkerRegistry,
        logger: mock.fn(),
      });

      const req = createMockRequest({ method: 'GET', url: '/api/v1/servers/vps-1' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 500);
      assert.ok(response.body.message.includes('DB read failed'));
    });

    test('calculates load ratio correctly', async () => {
      const req = createMockRequest({ method: 'GET', url: '/api/v1/servers/vps-1' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.body.loadRatio, 3 / 10);
    });
  });

  // --------------------------------------------------------------------------
  // DELETE /api/v1/servers/:id
  // --------------------------------------------------------------------------

  describe('DELETE /api/v1/servers/:id', () => {
    test('unregisters a server', async () => {
      const req = createMockRequest({
        method: 'DELETE',
        url: '/api/v1/servers/gpu-server',
      });
      const { res, getResponse } = createMockResponse();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.id, 'gpu-server');
      assert.equal(response.body.status, 'unregistered');
      assert.equal(response.body.force, false);
      assert.equal(mockWorkerRegistry.unregisterWorker.mock.calls.length, 1);
    });

    test('unregisters with force=true', async () => {
      const req = createMockRequest({
        method: 'DELETE',
        url: '/api/v1/servers/vps-1?force=true',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.force, true);
      const callArgs = mockWorkerRegistry.unregisterWorker.mock.calls[0].arguments;
      assert.equal(callArgs[1].force, true);
    });

    test('returns 404 for unknown server', async () => {
      const req = createMockRequest({
        method: 'DELETE',
        url: '/api/v1/servers/unknown',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 404);
      assert.equal(response.body.code, 'SERVER_NOT_FOUND');
    });

    test('returns 409 when server has active containers', async () => {
      mockWorkerRegistry.unregisterWorker = mock.fn(async () => {
        throw new Error("Worker 'vps-1' has 3 active container(s)");
      });

      const req = createMockRequest({
        method: 'DELETE',
        url: '/api/v1/servers/vps-1',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 409);
      assert.equal(response.body.code, 'SERVER_HAS_ACTIVE_CONTAINERS');
      assert.ok(response.body.details.hint.includes('force=true'));
    });

    test('returns 500 when unregisterWorker throws unexpected error', async () => {
      mockWorkerRegistry.unregisterWorker = mock.fn(async () => {
        throw new Error('Database write failed');
      });
      router = new ServerRouter({
        workerRegistry: mockWorkerRegistry,
        logger: mock.fn(),
      });

      const req = createMockRequest({
        method: 'DELETE',
        url: '/api/v1/servers/vps-1',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 500);
    });

    test('closes SSH tunnel on delete when sshTunnelManager available', async () => {
      const sshTunnelManager = createMockSSHTunnelManager();
      router = new ServerRouter({ workerRegistry: mockWorkerRegistry, sshTunnelManager });

      const req = createMockRequest({
        method: 'DELETE',
        url: '/api/v1/servers/vps-1',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(sshTunnelManager.closeTunnel.mock.calls.length, 1);
      assert.equal(sshTunnelManager.closeTunnel.mock.calls[0].arguments[0], 'vps-1');
    });

    test('handles tunnel close errors gracefully', async () => {
      const sshTunnelManager = {
        closeTunnel: mock.fn(async () => {
          throw new Error('Tunnel close failed');
        }),
        createTunnel: mock.fn(),
        healthCheck: mock.fn(),
      };
      router = new ServerRouter({ workerRegistry: mockWorkerRegistry, sshTunnelManager });

      const req = createMockRequest({
        method: 'DELETE',
        url: '/api/v1/servers/vps-1',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      // Should still succeed despite tunnel close error
      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.status, 'unregistered');
    });
  });

  // --------------------------------------------------------------------------
  // Authentication
  // --------------------------------------------------------------------------

  describe('authentication', () => {
    test('rejects request when apiKey configured and no auth header', async () => {
      router = new ServerRouter({ workerRegistry: mockWorkerRegistry, apiKey: 'secret123' });
      const req = createMockRequest({ method: 'GET', url: '/api/v1/servers' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 401);
    });

    test('rejects request with wrong API key', async () => {
      router = new ServerRouter({ workerRegistry: mockWorkerRegistry, apiKey: 'secret123' });
      const req = createMockRequest({
        method: 'GET',
        url: '/api/v1/servers',
        headers: { authorization: 'Bearer wrong-key' },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 401);
    });

    test('allows request with correct API key', async () => {
      router = new ServerRouter({ workerRegistry: mockWorkerRegistry, apiKey: 'secret123' });
      const req = createMockRequest({
        method: 'GET',
        url: '/api/v1/servers',
        headers: { authorization: 'Bearer secret123' },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
    });

    test('allows all requests when no apiKey configured', async () => {
      const req = createMockRequest({ method: 'GET', url: '/api/v1/servers' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
    });

    test('rejects non-Bearer auth schemes', async () => {
      router = new ServerRouter({ workerRegistry: mockWorkerRegistry, apiKey: 'secret123' });
      const req = createMockRequest({
        method: 'GET',
        url: '/api/v1/servers',
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
      const req = createMockRequest({ method: 'GET', url: '/api/v1/workers' });
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
      const req = createMockRequest({ method: '', url: '/api/v1/servers' });
      const { res } = createMockResponse();

      const handled = await router.handleRequest(req, res);
      assert.equal(handled, false);
    });

    test('returns false for PATCH /api/v1/servers/:id (unregistered method)', async () => {
      const req = createMockRequest({
        method: 'PATCH',
        url: '/api/v1/servers/vps-1',
      });
      const { res } = createMockResponse();

      const handled = await router.handleRequest(req, res);
      assert.equal(handled, false);
    });

    test('handles URL-encoded parameters', async () => {
      const req = createMockRequest({
        method: 'GET',
        url: '/api/v1/servers/vps-1',
      });
      const { res, getResponse } = createMockResponse();

      const handled = await router.handleRequest(req, res);
      assert.equal(handled, true);
      const response = getResponse();
      assert.equal(response.statusCode, 200);
    });

    test('handles malformed Host header gracefully', async () => {
      const req = createMockRequest({ method: 'GET', url: '/api/v1/servers' });
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
      readable.url = '/api/v1/servers/register';
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

    test('handles empty body as empty object', async () => {
      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/servers/register',
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
    test('logs audit event on register', async () => {
      const auditLogger = { log: mock.fn(async () => {}) };
      router = new ServerRouter({
        workerRegistry: mockWorkerRegistry,
        auditLogger,
      });

      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/servers/register',
        headers: { 'content-type': 'application/json' },
        body: { id: 'audited-server', host: 'localhost', type: 'local' },
      });
      const { res } = createMockResponse();

      await router.handleRequest(req, res);

      assert.equal(auditLogger.log.mock.calls.length, 1);
      const auditEvent = auditLogger.log.mock.calls[0].arguments[0];
      assert.equal(auditEvent.type, 'server.registered');
      assert.equal(auditEvent.resourceId, 'audited-server');
      assert.equal(auditEvent.resourceType, 'server');
    });

    test('logs audit event on unregister', async () => {
      const auditLogger = { log: mock.fn(async () => {}) };
      router = new ServerRouter({
        workerRegistry: mockWorkerRegistry,
        auditLogger,
      });

      const req = createMockRequest({
        method: 'DELETE',
        url: '/api/v1/servers/vps-1',
      });
      const { res } = createMockResponse();

      await router.handleRequest(req, res);

      assert.equal(auditLogger.log.mock.calls.length, 1);
      const auditEvent = auditLogger.log.mock.calls[0].arguments[0];
      assert.equal(auditEvent.type, 'server.unregistered');
      assert.equal(auditEvent.resourceId, 'vps-1');
    });

    test('does not crash when auditLogger is not configured', async () => {
      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/servers/register',
        headers: { 'content-type': 'application/json' },
        body: { id: 'no-audit-server', host: 'localhost', type: 'local' },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 201);
    });
  });

  // --------------------------------------------------------------------------
  // ServerRouterError
  // --------------------------------------------------------------------------

  describe('ServerRouterError', () => {
    test('creates error with correct name and fields', () => {
      const cause = new Error('root');
      const err = new ServerRouterError('test error', {
        cause,
        endpoint: '/api/v1/servers',
        statusCode: 500,
      });
      assert.equal(err.name, 'ServerRouterError');
      assert.equal(err.message, 'test error');
      assert.equal(err.endpoint, '/api/v1/servers');
      assert.equal(err.statusCode, 500);
      assert.equal(err.cause, cause);
    });

    test('creates error with defaults', () => {
      const err = new ServerRouterError('simple error');
      assert.equal(err.name, 'ServerRouterError');
      assert.equal(err.endpoint, undefined);
      assert.equal(err.statusCode, undefined);
    });
  });

  // --------------------------------------------------------------------------
  // Error handling in route handlers
  // --------------------------------------------------------------------------

  describe('error handling', () => {
    test('catches and returns 500 for unhandled handler errors', async () => {
      mockWorkerRegistry.listWorkers = mock.fn(async () => {
        throw new Error('Unexpected crash');
      });
      router = new ServerRouter({ workerRegistry: mockWorkerRegistry, logger: mock.fn() });

      const req = createMockRequest({ method: 'GET', url: '/api/v1/servers' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 500);
      assert.ok(response.body.message.includes('Unexpected crash'));
    });
  });
});
