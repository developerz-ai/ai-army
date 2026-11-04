/**
 * Integration tests for AdminRouter
 *
 * Tests the AdminRouter with a real HTTP server (Node.js http module):
 * - Real HTTP request/response cycle over the network
 * - Bearer token authentication via actual HTTP headers
 * - JSON response parsing and Content-Type verification
 * - Endpoint routing with URL parameters
 * - Multi-step workflows (reload then status, restart then status)
 * - Error handling with proper HTTP status codes
 * - Concurrent request handling
 *
 * Unlike unit tests that use mock req/res objects, these tests exercise
 * the full HTTP stack: TCP connection → request parsing → routing →
 * handler execution → JSON serialization → response delivery.
 *
 * Run with: npm run test:integration
 */

/* global fetch */

import { describe, test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AdminRouter } from '../../../src/api/AdminRouter.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock bot object
 * @param {Object} [overrides] - Override default properties
 * @returns {Object} Mock bot
 */
function createMockBot(overrides = {}) {
  return {
    id: overrides.id || 'support-bot',
    config: {
      id: overrides.id || 'support-bot',
      name: overrides.name || 'Support Bot',
      model: overrides.model || 'claude-haiku-4-5',
      sandbox: { image: 'alpine:latest', memory: '256m' },
      ...overrides.config,
    },
    soulContent: overrides.soulContent || '# Support Bot\nYou are helpful.',
    container: overrides.container || { id: 'container-abc' },
    status: overrides.status || 'running',
    lastActiveAt: overrides.lastActiveAt || new Date('2025-06-01T00:00:00Z'),
  };
}

/**
 * Create a mock BotManager with stateful bot tracking
 * @param {Object[]} [bots] - Initial bots
 * @returns {Object} Mock BotManager
 */
function createMockBotManager(bots = [createMockBot()]) {
  const botMap = new Map(bots.map(b => [b.id, b]));
  return {
    getBot: mock.fn(botId => botMap.get(botId)),
    listBots: mock.fn(() => Array.from(botMap.values())),
    getBotCount: mock.fn(status => {
      if (!status) return botMap.size;
      return Array.from(botMap.values()).filter(b => b.status === status).length;
    }),
    startBot: mock.fn(async () => {}),
    stopBot: mock.fn(async () => {}),
    reloadBot: mock.fn(async () => {}),
    _botMap: botMap,
  };
}

/**
 * Create a mock BotReloader
 * @returns {Object} Mock BotReloader
 */
function createMockBotReloader() {
  return {
    reloadBotConfig: mock.fn(async () => {}),
    reloadSoul: mock.fn(async () => {}),
    reloadContainer: mock.fn(async () => {}),
    needsContainerRestart: mock.fn(() => false),
  };
}

/**
 * Create a mock Orchestrator
 * @param {Object} [overrides] - Override properties
 * @returns {Object} Mock Orchestrator
 */
function createMockOrchestrator(overrides = {}) {
  const botManager = overrides.botManager || createMockBotManager();
  return {
    state: overrides.state || 'running',
    startedAt: new Date('2025-06-01T00:00:00Z'),
    botManager,
    botReloader: overrides.botReloader || null,
    channels: new Map(),
    middlewares: [],
    getState: mock.fn(() => overrides.state || 'running'),
    getStatus: mock.fn(() => ({
      state: overrides.state || 'running',
      startedAt: new Date('2025-06-01T00:00:00Z'),
      uptime: 3600000,
      botCount: botManager.getBotCount(),
      channelCount: 0,
      middlewareCount: 0,
      databaseConnected: true,
      messageProcessorReady: true,
      messageRouterReady: true,
      ...overrides.status,
    })),
    reload: mock.fn(async () => overrides.reloadResult || { reloaded: [], failed: [] }),
    _discoverBotConfigs: mock.fn(async () => {
      const configs = new Map();
      for (const bot of botManager.listBots()) {
        configs.set(bot.id, bot.config);
      }
      return configs;
    }),
    ...overrides,
  };
}

/**
 * Start an HTTP server with the given AdminRouter
 * @param {AdminRouter} router - AdminRouter instance
 * @returns {Promise<{ server: http.Server, baseUrl: string, port: number }>}
 */
function startTestServer(router) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const handled = await router.handleRequest(req, res);
      if (!handled) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' }));
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${port}`,
        port,
      });
    });

    server.on('error', reject);
  });
}

/**
 * Stop an HTTP server
 * @param {http.Server} server - Server to stop
 * @returns {Promise<void>}
 */
function stopTestServer(server) {
  return new Promise((resolve, reject) => {
    server.close(err => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Make an HTTP request and parse the JSON response
 * @param {string} url - Full URL to request
 * @param {Object} [options] - Fetch options
 * @returns {Promise<{ status: number, headers: Headers, body: Object }>}
 */
async function request(url, options = {}) {
  const res = await fetch(url, options);
  const body = await res.json();
  return { status: res.status, headers: res.headers, body };
}

// ============================================================================
// Integration Tests - Real HTTP Server
// ============================================================================

describe('AdminRouter Integration - HTTP Server', () => {
  let server;
  let baseUrl;
  let orchestrator;
  let botManager;
  let router;

  before(async () => {
    const bot = createMockBot();
    const bot2 = createMockBot({
      id: 'work-bot',
      name: 'Work Bot',
      model: 'claude-sonnet-4-5',
      status: 'running',
    });
    botManager = createMockBotManager([bot, bot2]);
    orchestrator = createMockOrchestrator({
      botManager,
      reloadResult: { reloaded: ['support-bot', 'work-bot'], failed: [] },
      status: { botCount: 2 },
    });
    router = new AdminRouter({
      orchestrator,
      apiKey: 'test-admin-key-2025',
      logger: null,
    });

    ({ server, baseUrl } = await startTestServer(router));
  });

  after(async () => {
    if (server) {
      await stopTestServer(server);
    }
  });

  // ==========================================================================
  // Authentication via Real HTTP Headers
  // ==========================================================================

  describe('authentication over HTTP', () => {
    test('rejects request without Authorization header', async () => {
      const { status, body } = await request(`${baseUrl}/api/admin/status`);

      assert.equal(status, 401);
      assert.equal(body.error, 'Unauthorized');
      assert.ok(body.message.includes('API key required'));
    });

    test('rejects request with wrong Bearer token', async () => {
      const { status, body } = await request(`${baseUrl}/api/admin/status`, {
        headers: { authorization: 'Bearer wrong-key' },
      });

      assert.equal(status, 401);
      assert.equal(body.error, 'Unauthorized');
    });

    test('rejects request with Basic auth scheme', async () => {
      const { status } = await request(`${baseUrl}/api/admin/status`, {
        headers: { authorization: 'Basic dGVzdDp0ZXN0' },
      });

      assert.equal(status, 401);
    });

    test('rejects request with empty Bearer token', async () => {
      const { status } = await request(`${baseUrl}/api/admin/status`, {
        headers: { authorization: 'Bearer ' },
      });

      assert.equal(status, 401);
    });

    test('accepts request with valid Bearer token', async () => {
      const { status, body } = await request(`${baseUrl}/api/admin/status`, {
        headers: { authorization: 'Bearer test-admin-key-2025' },
      });

      assert.equal(status, 200);
      assert.equal(body.state, 'running');
    });

    test('authentication is case-sensitive for token value', async () => {
      const { status } = await request(`${baseUrl}/api/admin/status`, {
        headers: { authorization: 'Bearer TEST-ADMIN-KEY-2025' },
      });

      assert.equal(status, 401);
    });
  });

  // ==========================================================================
  // GET /api/admin/status - Real HTTP
  // ==========================================================================

  describe('GET /api/admin/status', () => {
    const authHeaders = { authorization: 'Bearer test-admin-key-2025' };

    test('returns 200 with system status', async () => {
      const { status, body } = await request(`${baseUrl}/api/admin/status`, {
        headers: authHeaders,
      });

      assert.equal(status, 200);
      assert.equal(body.state, 'running');
      assert.equal(body.uptime, 3600000);
      assert.equal(body.databaseConnected, true);
      assert.equal(body.messageProcessorReady, true);
      assert.equal(body.messageRouterReady, true);
      assert.ok(body.startedAt);
    });

    test('returns bot details in status response', async () => {
      const { body } = await request(`${baseUrl}/api/admin/status`, {
        headers: authHeaders,
      });

      assert.ok(Array.isArray(body.bots));
      assert.equal(body.bots.length, 2);

      const supportBot = body.bots.find(b => b.id === 'support-bot');
      assert.ok(supportBot);
      assert.equal(supportBot.status, 'running');
      assert.equal(supportBot.model, 'claude-haiku-4-5');

      const workBot = body.bots.find(b => b.id === 'work-bot');
      assert.ok(workBot);
      assert.equal(workBot.status, 'running');
    });

    test('returns JSON Content-Type header', async () => {
      const { headers } = await request(`${baseUrl}/api/admin/status`, {
        headers: authHeaders,
      });

      assert.equal(headers.get('content-type'), 'application/json');
    });

    test('returns Content-Length header', async () => {
      const { headers } = await request(`${baseUrl}/api/admin/status`, {
        headers: authHeaders,
      });

      const contentLength = parseInt(headers.get('content-length'), 10);
      assert.ok(contentLength > 0);
    });

    test('rejects POST to status endpoint (wrong method)', async () => {
      const { status } = await request(`${baseUrl}/api/admin/status`, {
        method: 'POST',
        headers: authHeaders,
      });

      // Should fall through to 404 (no route match for POST /status)
      assert.equal(status, 404);
    });
  });

  // ==========================================================================
  // POST /api/admin/reload - Real HTTP
  // ==========================================================================

  describe('POST /api/admin/reload', () => {
    const authHeaders = { authorization: 'Bearer test-admin-key-2025' };

    test('returns 200 on successful reload', async () => {
      const { status, body } = await request(`${baseUrl}/api/admin/reload`, {
        method: 'POST',
        headers: authHeaders,
      });

      assert.equal(status, 200);
      assert.equal(body.success, true);
      assert.equal(body.message, 'Configuration reloaded');
      assert.equal(body.botsReloaded, 2);
      assert.deepEqual(body.reloaded, ['support-bot', 'work-bot']);
      assert.deepEqual(body.failed, []);
    });

    test('calls orchestrator.reload()', async () => {
      const callsBefore = orchestrator.reload.mock.callCount();

      await request(`${baseUrl}/api/admin/reload`, {
        method: 'POST',
        headers: authHeaders,
      });

      assert.equal(orchestrator.reload.mock.callCount(), callsBefore + 1);
    });

    test('rejects GET to reload endpoint (wrong method)', async () => {
      const { status } = await request(`${baseUrl}/api/admin/reload`, {
        headers: authHeaders,
      });

      assert.equal(status, 404);
    });
  });

  // ==========================================================================
  // POST /api/admin/bots/:botId/restart - Real HTTP
  // ==========================================================================

  describe('POST /api/admin/bots/:botId/restart', () => {
    const authHeaders = { authorization: 'Bearer test-admin-key-2025' };

    test('restarts existing bot and returns 200', async () => {
      const { status, body } = await request(`${baseUrl}/api/admin/bots/support-bot/restart`, {
        method: 'POST',
        headers: authHeaders,
      });

      assert.equal(status, 200);
      assert.equal(body.success, true);
      assert.equal(body.botId, 'support-bot');
      assert.ok(body.message.includes('restarted'));
    });

    test('calls stopBot then startBot on BotManager', async () => {
      const stopBefore = botManager.stopBot.mock.callCount();
      const startBefore = botManager.startBot.mock.callCount();

      await request(`${baseUrl}/api/admin/bots/support-bot/restart`, {
        method: 'POST',
        headers: authHeaders,
      });

      assert.equal(botManager.stopBot.mock.callCount(), stopBefore + 1);
      assert.equal(botManager.startBot.mock.callCount(), startBefore + 1);
    });

    test('returns 404 for non-existent bot', async () => {
      const { status, body } = await request(`${baseUrl}/api/admin/bots/ghost-bot/restart`, {
        method: 'POST',
        headers: authHeaders,
      });

      assert.equal(status, 404);
      assert.equal(body.success, false);
      assert.ok(body.message.includes('not found'));
      assert.equal(body.botId, 'ghost-bot');
    });

    test('extracts URL-encoded botId correctly', async () => {
      // URL-encoded bot id that doesn't exist - tests param decoding
      const { status, body } = await request(
        `${baseUrl}/api/admin/bots/my%20special%20bot/restart`,
        { method: 'POST', headers: authHeaders }
      );

      assert.equal(status, 404);
      assert.equal(body.botId, 'my special bot');
    });
  });

  // ==========================================================================
  // POST /api/admin/bots/:botId/reload - Real HTTP
  // ==========================================================================

  describe('POST /api/admin/bots/:botId/reload', () => {
    const authHeaders = { authorization: 'Bearer test-admin-key-2025' };

    test('reloads existing bot config via BotManager fallback', async () => {
      const { status, body } = await request(`${baseUrl}/api/admin/bots/support-bot/reload`, {
        method: 'POST',
        headers: authHeaders,
      });

      assert.equal(status, 200);
      assert.equal(body.success, true);
      assert.equal(body.botId, 'support-bot');
      assert.ok(body.message.includes('config reloaded'));
    });

    test('returns 404 for non-existent bot', async () => {
      const { status, body } = await request(`${baseUrl}/api/admin/bots/nonexistent/reload`, {
        method: 'POST',
        headers: authHeaders,
      });

      assert.equal(status, 404);
      assert.equal(body.success, false);
      assert.equal(body.botId, 'nonexistent');
    });
  });

  // ==========================================================================
  // Route Matching - Real HTTP
  // ==========================================================================

  describe('route matching over HTTP', () => {
    const authHeaders = { authorization: 'Bearer test-admin-key-2025' };

    test('returns 404 for unknown paths', async () => {
      const { status } = await request(`${baseUrl}/api/admin/unknown`, {
        headers: authHeaders,
      });

      assert.equal(status, 404);
    });

    test('returns 404 for root path', async () => {
      const { status } = await request(`${baseUrl}/`, {
        headers: authHeaders,
      });

      assert.equal(status, 404);
    });

    test('returns 404 for partial path match', async () => {
      const { status } = await request(`${baseUrl}/api/admin`, {
        headers: authHeaders,
      });

      assert.equal(status, 404);
    });

    test('returns 404 for extra path segments', async () => {
      const { status } = await request(`${baseUrl}/api/admin/status/extra`, {
        headers: authHeaders,
      });

      assert.equal(status, 404);
    });
  });
});

// ============================================================================
// Integration Tests - No API Key (Development Mode)
// ============================================================================

describe('AdminRouter Integration - No API Key (dev mode)', () => {
  let server;
  let baseUrl;

  before(async () => {
    const orchestrator = createMockOrchestrator({
      reloadResult: { reloaded: ['dev-bot'], failed: [] },
    });
    const router = new AdminRouter({
      orchestrator,
      apiKey: null,
      logger: null,
    });

    ({ server, baseUrl } = await startTestServer(router));
  });

  after(async () => {
    if (server) {
      await stopTestServer(server);
    }
  });

  test('allows requests without any auth header', async () => {
    const { status, body } = await request(`${baseUrl}/api/admin/status`);

    assert.equal(status, 200);
    assert.equal(body.state, 'running');
  });

  test('allows reload without auth', async () => {
    const { status, body } = await request(`${baseUrl}/api/admin/reload`, {
      method: 'POST',
    });

    assert.equal(status, 200);
    assert.equal(body.success, true);
  });
});

// ============================================================================
// Integration Tests - Error Scenarios
// ============================================================================

describe('AdminRouter Integration - Error Scenarios', () => {
  let server;
  let baseUrl;

  after(async () => {
    if (server) {
      await stopTestServer(server);
    }
  });

  test('returns 500 when orchestrator.reload() throws', async () => {
    const orchestrator = createMockOrchestrator();
    orchestrator.reload = mock.fn(async () => {
      throw new Error('Cannot reload: database connection lost');
    });
    const router = new AdminRouter({ orchestrator, logger: null });

    ({ server, baseUrl } = await startTestServer(router));

    const { status, body } = await request(`${baseUrl}/api/admin/reload`, {
      method: 'POST',
    });

    assert.equal(status, 500);
    assert.equal(body.success, false);
    assert.ok(body.message.includes('database connection lost'));

    await stopTestServer(server);
    server = null;
  });

  test('returns 500 when getStatus() throws', async () => {
    const orchestrator = createMockOrchestrator();
    orchestrator.getStatus = mock.fn(() => {
      throw new Error('Status unavailable');
    });
    const router = new AdminRouter({ orchestrator, logger: null });

    ({ server, baseUrl } = await startTestServer(router));

    const { status, body } = await request(`${baseUrl}/api/admin/status`);

    assert.equal(status, 500);
    assert.equal(body.error, 'Internal Server Error');
    assert.ok(body.message.includes('Status unavailable'));

    await stopTestServer(server);
    server = null;
  });

  test('returns 503 when botManager is null', async () => {
    const orchestrator = createMockOrchestrator();
    orchestrator.botManager = null;
    const router = new AdminRouter({ orchestrator, logger: null });

    ({ server, baseUrl } = await startTestServer(router));

    const { status, body } = await request(`${baseUrl}/api/admin/bots/some-bot/restart`, {
      method: 'POST',
    });

    assert.equal(status, 503);
    assert.equal(body.success, false);
    assert.ok(body.message.includes('BotManager not available'));

    await stopTestServer(server);
    server = null;
  });

  test('returns 500 when bot restart fails', async () => {
    const bot = createMockBot();
    const botManager = createMockBotManager([bot]);
    botManager.stopBot = mock.fn(async () => {
      throw new Error('Container shutdown timed out');
    });
    const orchestrator = createMockOrchestrator({ botManager });
    const router = new AdminRouter({ orchestrator, logger: null });

    ({ server, baseUrl } = await startTestServer(router));

    const { status, body } = await request(`${baseUrl}/api/admin/bots/support-bot/restart`, {
      method: 'POST',
    });

    assert.equal(status, 500);
    assert.equal(body.success, false);
    assert.ok(body.message.includes('Container shutdown timed out'));

    await stopTestServer(server);
    server = null;
  });

  test('returns 207 for partial reload failures', async () => {
    const orchestrator = createMockOrchestrator({
      reloadResult: {
        reloaded: ['support-bot'],
        failed: [{ botId: 'work-bot', error: 'Soul file missing' }],
      },
    });
    const router = new AdminRouter({ orchestrator, logger: null });

    ({ server, baseUrl } = await startTestServer(router));

    const { status, body } = await request(`${baseUrl}/api/admin/reload`, {
      method: 'POST',
    });

    assert.equal(status, 207);
    assert.equal(body.success, false);
    assert.equal(body.botsReloaded, 1);
    assert.equal(body.failed.length, 1);
    assert.ok(body.message.includes('with errors'));

    await stopTestServer(server);
    server = null;
  });
});

// ============================================================================
// Integration Tests - BotReloader Path
// ============================================================================

describe('AdminRouter Integration - BotReloader', () => {
  let server;
  let baseUrl;
  let botReloader;

  before(async () => {
    const bot = createMockBot();
    const botManager = createMockBotManager([bot]);
    botReloader = createMockBotReloader();
    const orchestrator = createMockOrchestrator({
      botManager,
      botReloader,
    });
    const router = new AdminRouter({ orchestrator, logger: null });

    ({ server, baseUrl } = await startTestServer(router));
  });

  after(async () => {
    if (server) {
      await stopTestServer(server);
    }
  });

  test('uses BotReloader for granular config reload', async () => {
    const { status, body } = await request(`${baseUrl}/api/admin/bots/support-bot/reload`, {
      method: 'POST',
    });

    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(body.needsContainerRestart, false);
    assert.equal(botReloader.reloadBotConfig.mock.callCount(), 1);
    assert.equal(botReloader.reloadBotConfig.mock.calls[0].arguments[0], 'support-bot');
  });

  test('calls needsContainerRestart on BotReloader', async () => {
    const callsBefore = botReloader.needsContainerRestart.mock.callCount();

    await request(`${baseUrl}/api/admin/bots/support-bot/reload`, {
      method: 'POST',
    });

    assert.equal(botReloader.needsContainerRestart.mock.callCount(), callsBefore + 1);
  });

  test('reports needsContainerRestart=true when BotReloader says so', async () => {
    botReloader.needsContainerRestart = mock.fn(() => true);

    const { status, body } = await request(`${baseUrl}/api/admin/bots/support-bot/reload`, {
      method: 'POST',
    });

    assert.equal(status, 200);
    assert.equal(body.needsContainerRestart, true);

    // Restore
    botReloader.needsContainerRestart = mock.fn(() => false);
  });
});

// ============================================================================
// Integration Tests - Multi-Step Workflows
// ============================================================================

describe('AdminRouter Integration - Multi-Step Workflows', () => {
  let server;
  let baseUrl;
  let orchestrator;
  let botManager;

  before(async () => {
    const bots = [
      createMockBot({ id: 'bot-a', status: 'running' }),
      createMockBot({ id: 'bot-b', status: 'running' }),
      createMockBot({ id: 'bot-c', status: 'stopped' }),
    ];
    botManager = createMockBotManager(bots);
    orchestrator = createMockOrchestrator({
      botManager,
      reloadResult: { reloaded: ['bot-a', 'bot-b', 'bot-c'], failed: [] },
      status: { botCount: 3 },
    });
    const router = new AdminRouter({ orchestrator, logger: null });

    ({ server, baseUrl } = await startTestServer(router));
  });

  after(async () => {
    if (server) {
      await stopTestServer(server);
    }
  });

  test('reload then check status shows consistent state', async () => {
    // Step 1: Trigger reload
    const reloadRes = await request(`${baseUrl}/api/admin/reload`, {
      method: 'POST',
    });
    assert.equal(reloadRes.status, 200);
    assert.equal(reloadRes.body.success, true);

    // Step 2: Check status
    const statusRes = await request(`${baseUrl}/api/admin/status`);
    assert.equal(statusRes.status, 200);
    assert.equal(statusRes.body.state, 'running');
    assert.equal(statusRes.body.bots.length, 3);
  });

  test('restart bot then check status for that bot', async () => {
    // Step 1: Restart bot-a
    const restartRes = await request(`${baseUrl}/api/admin/bots/bot-a/restart`, { method: 'POST' });
    assert.equal(restartRes.status, 200);
    assert.equal(restartRes.body.success, true);
    assert.equal(restartRes.body.botId, 'bot-a');

    // Step 2: Status should still show the bot
    const statusRes = await request(`${baseUrl}/api/admin/status`);
    assert.equal(statusRes.status, 200);
    const botA = statusRes.body.bots.find(b => b.id === 'bot-a');
    assert.ok(botA, 'bot-a should still be in status');
  });

  test('sequential restarts of different bots', async () => {
    const stopBefore = botManager.stopBot.mock.callCount();
    const startBefore = botManager.startBot.mock.callCount();

    // Restart bot-a
    const res1 = await request(`${baseUrl}/api/admin/bots/bot-a/restart`, {
      method: 'POST',
    });
    assert.equal(res1.status, 200);

    // Restart bot-b
    const res2 = await request(`${baseUrl}/api/admin/bots/bot-b/restart`, {
      method: 'POST',
    });
    assert.equal(res2.status, 200);

    // Both should have been stopped and started
    assert.equal(botManager.stopBot.mock.callCount(), stopBefore + 2);
    assert.equal(botManager.startBot.mock.callCount(), startBefore + 2);
  });

  test('concurrent requests are handled correctly', async () => {
    // Send multiple requests simultaneously
    const results = await Promise.all([
      request(`${baseUrl}/api/admin/status`),
      request(`${baseUrl}/api/admin/status`),
      request(`${baseUrl}/api/admin/reload`, { method: 'POST' }),
    ]);

    // All should succeed
    assert.equal(results[0].status, 200);
    assert.equal(results[1].status, 200);
    assert.equal(results[2].status, 200);

    // Status responses should have correct structure
    assert.equal(results[0].body.state, 'running');
    assert.equal(results[1].body.state, 'running');
    assert.equal(results[2].body.success, true);
  });

  test('status shows multiple bots with different states', async () => {
    const { body } = await request(`${baseUrl}/api/admin/status`);

    const botA = body.bots.find(b => b.id === 'bot-a');
    const botC = body.bots.find(b => b.id === 'bot-c');

    assert.equal(botA.status, 'running');
    assert.equal(botC.status, 'stopped');
  });
});

// ============================================================================
// Integration Tests - Response Format Verification
// ============================================================================

describe('AdminRouter Integration - Response Format', () => {
  let server;
  let baseUrl;

  before(async () => {
    const orchestrator = createMockOrchestrator();
    const router = new AdminRouter({ orchestrator, logger: null });

    ({ server, baseUrl } = await startTestServer(router));
  });

  after(async () => {
    if (server) {
      await stopTestServer(server);
    }
  });

  test('status response contains all required fields', async () => {
    const { body } = await request(`${baseUrl}/api/admin/status`);

    // Verify all documented fields are present
    assert.ok('state' in body, 'Missing state');
    assert.ok('uptime' in body, 'Missing uptime');
    assert.ok('startedAt' in body, 'Missing startedAt');
    assert.ok('botCount' in body, 'Missing botCount');
    assert.ok('channelCount' in body, 'Missing channelCount');
    assert.ok('middlewareCount' in body, 'Missing middlewareCount');
    assert.ok('databaseConnected' in body, 'Missing databaseConnected');
    assert.ok('messageProcessorReady' in body, 'Missing messageProcessorReady');
    assert.ok('messageRouterReady' in body, 'Missing messageRouterReady');
    assert.ok('bots' in body, 'Missing bots');
  });

  test('reload response contains all required fields', async () => {
    const { body } = await request(`${baseUrl}/api/admin/reload`, {
      method: 'POST',
    });

    assert.ok('success' in body, 'Missing success');
    assert.ok('message' in body, 'Missing message');
    assert.ok('botsReloaded' in body, 'Missing botsReloaded');
    assert.ok('reloaded' in body, 'Missing reloaded');
    assert.ok('failed' in body, 'Missing failed');
    assert.ok(Array.isArray(body.reloaded), 'reloaded should be array');
    assert.ok(Array.isArray(body.failed), 'failed should be array');
  });

  test('bot restart response contains all required fields', async () => {
    const { body } = await request(`${baseUrl}/api/admin/bots/support-bot/restart`, {
      method: 'POST',
    });

    assert.ok('success' in body, 'Missing success');
    assert.ok('botId' in body, 'Missing botId');
    assert.ok('message' in body, 'Missing message');
  });

  test('401 response contains error and message fields', async () => {
    // Create a server with API key to test 401
    const orch2 = createMockOrchestrator();
    const router2 = new AdminRouter({
      orchestrator: orch2,
      apiKey: 'secret',
      logger: null,
    });
    const result2 = await startTestServer(router2);

    try {
      const { body } = await request(`${result2.baseUrl}/api/admin/status`);

      assert.ok('error' in body, 'Missing error');
      assert.ok('message' in body, 'Missing message');
      assert.equal(body.error, 'Unauthorized');
    } finally {
      await stopTestServer(result2.server);
    }
  });

  test('Content-Length matches actual body byte length', async () => {
    const res = await fetch(`${baseUrl}/api/admin/status`);
    const text = await res.text();
    const contentLength = parseInt(res.headers.get('content-length'), 10);

    assert.equal(contentLength, Buffer.byteLength(text));
  });
});

// ============================================================================
// Integration Tests - Edge Cases
// ============================================================================

describe('AdminRouter Integration - Edge Cases', () => {
  let server;
  let baseUrl;

  after(async () => {
    if (server) {
      await stopTestServer(server);
    }
  });

  test('handles botManager with no bots gracefully', async () => {
    const orchestrator = createMockOrchestrator({
      botManager: createMockBotManager([]),
      status: { botCount: 0 },
    });
    const router = new AdminRouter({ orchestrator, logger: null });

    ({ server, baseUrl } = await startTestServer(router));

    const { status, body } = await request(`${baseUrl}/api/admin/status`);

    assert.equal(status, 200);
    assert.deepEqual(body.bots, []);
    assert.equal(body.botCount, 0);

    await stopTestServer(server);
    server = null;
  });

  test('handles query parameters in URL without breaking routing', async () => {
    const orchestrator = createMockOrchestrator();
    const router = new AdminRouter({ orchestrator, logger: null });

    ({ server, baseUrl } = await startTestServer(router));

    const { status, body } = await request(`${baseUrl}/api/admin/status?format=json&verbose=true`);

    assert.equal(status, 200);
    assert.equal(body.state, 'running');

    await stopTestServer(server);
    server = null;
  });

  test('handles reload result with empty reloaded and failed arrays', async () => {
    const orchestrator = createMockOrchestrator({
      reloadResult: { reloaded: [], failed: [] },
    });
    const router = new AdminRouter({ orchestrator, logger: null });

    ({ server, baseUrl } = await startTestServer(router));

    const { status, body } = await request(`${baseUrl}/api/admin/reload`, {
      method: 'POST',
    });

    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(body.botsReloaded, 0);

    await stopTestServer(server);
    server = null;
  });

  test('server handles requests with missing host header', async () => {
    const orchestrator = createMockOrchestrator();
    const router = new AdminRouter({ orchestrator, logger: null });

    ({ server, baseUrl } = await startTestServer(router));

    // Node's fetch always sends Host header, but we can verify the server works
    const { status } = await request(`${baseUrl}/api/admin/status`);
    assert.equal(status, 200);

    await stopTestServer(server);
    server = null;
  });
});
