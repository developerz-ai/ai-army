/**
 * Unit tests for AdminRouter
 *
 * Tests the admin API endpoints:
 * - POST /api/admin/reload       → Validate and reload config
 * - GET  /api/admin/status       → Show bot states, uptime, health
 * - POST /api/admin/bots/:botId/restart → Restart specific bot
 * - POST /api/admin/bots/:botId/reload  → Reload specific bot config
 *
 * Also covers:
 * - Bearer token authentication
 * - Error handling and edge cases
 * - JSON response formatting
 * - Route matching and parameter extraction
 */

import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { AdminRouter, AdminRouterError } from './AdminRouter.js';

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
    id: 'support-bot',
    config: {
      id: 'support-bot',
      name: 'Support Bot',
      model: 'claude-haiku-4-5',
      sandbox: { image: 'alpine:latest', memory: '256m' },
    },
    soulContent: '# Support Bot\nYou are helpful.',
    container: { id: 'container-abc' },
    status: 'running',
    lastActiveAt: new Date('2025-06-01T00:00:00Z'),
    ...overrides,
  };
}

/**
 * Create a mock BotManager
 * @param {Object[]} [bots] - Bots to manage
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

  // Build a config map from botManager's bots for _discoverBotConfigs
  const botConfigs = new Map();
  if (botManager && typeof botManager.listBots === 'function') {
    for (const bot of botManager.listBots()) {
      botConfigs.set(bot.id, bot.config);
    }
  }

  return {
    state: 'running',
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
    _discoverBotConfigs: mock.fn(async () => botConfigs),
    ...overrides,
  };
}

/**
 * Create a mock HTTP request
 * @param {Object} options - Request options
 * @returns {Object} Mock request
 */
function createMockRequest({ method = 'GET', url = '/', headers = {} } = {}) {
  return {
    method,
    url,
    headers: {
      host: 'localhost:3000',
      ...headers,
    },
    params: {},
  };
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

/**
 * Create a logger that captures messages
 * @returns {{ logger: Function, messages: string[] }}
 */
function createLogger() {
  const messages = [];
  const logger = msg => messages.push(msg);
  return { logger, messages };
}

// ============================================================================
// Constructor Tests
// ============================================================================

describe('AdminRouter', () => {
  describe('constructor', () => {
    test('creates instance with orchestrator', () => {
      const orchestrator = createMockOrchestrator();
      const router = new AdminRouter({ orchestrator });
      assert.ok(router);
      assert.equal(router.orchestrator, orchestrator);
    });

    test('throws AdminRouterError without orchestrator', () => {
      assert.throws(
        () => new AdminRouter({}),
        err => {
          assert.ok(err instanceof AdminRouterError);
          assert.ok(err.message.includes('Orchestrator is required'));
          return true;
        }
      );
    });

    test('throws AdminRouterError with no options', () => {
      assert.throws(
        () => new AdminRouter(),
        err => {
          assert.ok(err instanceof AdminRouterError);
          return true;
        }
      );
    });

    test('accepts apiKey option', () => {
      const orchestrator = createMockOrchestrator();
      const router = new AdminRouter({ orchestrator, apiKey: 'test-key-123' });
      assert.equal(router.apiKey, 'test-key-123');
    });

    test('defaults apiKey to null when not provided', () => {
      const orchestrator = createMockOrchestrator();
      // Clear env just in case
      const original = process.env.ADMIN_API_KEY;
      delete process.env.ADMIN_API_KEY;
      const router = new AdminRouter({ orchestrator });
      assert.equal(router.apiKey, null);
      if (original) process.env.ADMIN_API_KEY = original;
    });

    test('accepts custom logger', () => {
      const orchestrator = createMockOrchestrator();
      const { logger } = createLogger();
      const router = new AdminRouter({ orchestrator, logger });
      assert.equal(router.logger, logger);
    });

    test('accepts null logger to suppress output', () => {
      const orchestrator = createMockOrchestrator();
      const router = new AdminRouter({ orchestrator, logger: null });
      assert.equal(router.logger, null);
    });

    test('registers routes on construction', () => {
      const orchestrator = createMockOrchestrator();
      const router = new AdminRouter({ orchestrator });
      assert.ok(router.routes.length >= 4);
    });
  });

  // ==========================================================================
  // Authentication Tests
  // ==========================================================================

  describe('authentication', () => {
    test('allows requests when no API key is configured', async () => {
      const orchestrator = createMockOrchestrator();
      const router = new AdminRouter({ orchestrator, logger: null });
      const req = createMockRequest({ method: 'GET', url: '/api/admin/status' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);
      const response = getResponse();
      assert.equal(response.statusCode, 200);
    });

    test('allows requests with valid Bearer token', async () => {
      const orchestrator = createMockOrchestrator();
      const router = new AdminRouter({
        orchestrator,
        apiKey: 'secret-key',
        logger: null,
      });
      const req = createMockRequest({
        method: 'GET',
        url: '/api/admin/status',
        headers: { authorization: 'Bearer secret-key' },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);
      const response = getResponse();
      assert.equal(response.statusCode, 200);
    });

    test('rejects requests without Authorization header', async () => {
      const orchestrator = createMockOrchestrator();
      const router = new AdminRouter({
        orchestrator,
        apiKey: 'secret-key',
        logger: null,
      });
      const req = createMockRequest({ method: 'GET', url: '/api/admin/status' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);
      const response = getResponse();
      assert.equal(response.statusCode, 401);
      assert.equal(response.body.error, 'Unauthorized');
    });

    test('rejects requests with wrong API key', async () => {
      const orchestrator = createMockOrchestrator();
      const router = new AdminRouter({
        orchestrator,
        apiKey: 'secret-key',
        logger: null,
      });
      const req = createMockRequest({
        method: 'GET',
        url: '/api/admin/status',
        headers: { authorization: 'Bearer wrong-key' },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);
      const response = getResponse();
      assert.equal(response.statusCode, 401);
    });

    test('rejects requests with non-Bearer auth scheme', async () => {
      const orchestrator = createMockOrchestrator();
      const router = new AdminRouter({
        orchestrator,
        apiKey: 'secret-key',
        logger: null,
      });
      const req = createMockRequest({
        method: 'GET',
        url: '/api/admin/status',
        headers: { authorization: 'Basic c2VjcmV0LWtleQ==' },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);
      const response = getResponse();
      assert.equal(response.statusCode, 401);
    });

    test('rejects malformed authorization header', async () => {
      const orchestrator = createMockOrchestrator();
      const router = new AdminRouter({
        orchestrator,
        apiKey: 'secret-key',
        logger: null,
      });
      const req = createMockRequest({
        method: 'GET',
        url: '/api/admin/status',
        headers: { authorization: 'Bearer' },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);
      const response = getResponse();
      assert.equal(response.statusCode, 401);
    });
  });

  // ==========================================================================
  // Route Matching Tests
  // ==========================================================================

  describe('route matching', () => {
    test('returns false for unmatched routes', async () => {
      const orchestrator = createMockOrchestrator();
      const router = new AdminRouter({ orchestrator, logger: null });
      const req = createMockRequest({ method: 'GET', url: '/api/unknown' });
      const { res } = createMockResponse();

      const handled = await router.handleRequest(req, res);
      assert.equal(handled, false);
    });

    test('returns false for wrong HTTP method', async () => {
      const orchestrator = createMockOrchestrator();
      const router = new AdminRouter({ orchestrator, logger: null });
      const req = createMockRequest({ method: 'GET', url: '/api/admin/reload' });
      const { res } = createMockResponse();

      const handled = await router.handleRequest(req, res);
      assert.equal(handled, false);
    });

    test('returns true for matched routes', async () => {
      const orchestrator = createMockOrchestrator();
      const router = new AdminRouter({ orchestrator, logger: null });
      const req = createMockRequest({ method: 'GET', url: '/api/admin/status' });
      const { res } = createMockResponse();

      const handled = await router.handleRequest(req, res);
      assert.equal(handled, true);
    });

    test('extracts URL parameters correctly', async () => {
      const bot = createMockBot();
      const orchestrator = createMockOrchestrator({
        botManager: createMockBotManager([bot]),
      });
      const router = new AdminRouter({ orchestrator, logger: null });
      const req = createMockRequest({
        method: 'POST',
        url: '/api/admin/bots/support-bot/restart',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);
      const response = getResponse();
      assert.equal(response.body.botId, 'support-bot');
    });

    test('decodes URL-encoded parameters', async () => {
      const bot = createMockBot({ id: 'my bot' });
      const orchestrator = createMockOrchestrator({
        botManager: createMockBotManager([bot]),
      });
      const router = new AdminRouter({ orchestrator, logger: null });
      const req = createMockRequest({
        method: 'POST',
        url: '/api/admin/bots/my%20bot/restart',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);
      const response = getResponse();
      assert.equal(response.body.botId, 'my bot');
    });
  });

  // ==========================================================================
  // POST /api/admin/reload
  // ==========================================================================

  describe('POST /api/admin/reload', () => {
    test('returns success with reloaded bots', async () => {
      const orchestrator = createMockOrchestrator({
        reloadResult: {
          reloaded: ['support-bot', 'work-bot'],
          failed: [],
        },
      });
      const router = new AdminRouter({ orchestrator, logger: null });
      const req = createMockRequest({ method: 'POST', url: '/api/admin/reload' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);
      const response = getResponse();

      assert.equal(response.statusCode, 200);
      assert.equal(response.body.success, true);
      assert.equal(response.body.message, 'Configuration reloaded');
      assert.equal(response.body.botsReloaded, 2);
      assert.deepEqual(response.body.reloaded, ['support-bot', 'work-bot']);
      assert.deepEqual(response.body.failed, []);
    });

    test('returns 207 with partial failures', async () => {
      const orchestrator = createMockOrchestrator({
        reloadResult: {
          reloaded: ['support-bot'],
          failed: [{ botId: 'work-bot', error: 'Soul file not found' }],
        },
      });
      const router = new AdminRouter({ orchestrator, logger: null });
      const req = createMockRequest({ method: 'POST', url: '/api/admin/reload' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);
      const response = getResponse();

      assert.equal(response.statusCode, 207);
      assert.equal(response.body.success, false);
      assert.equal(response.body.botsReloaded, 1);
      assert.equal(response.body.failed.length, 1);
      assert.ok(response.body.message.includes('with errors'));
    });

    test('returns 200 with no changes', async () => {
      const orchestrator = createMockOrchestrator({
        reloadResult: { reloaded: [], failed: [] },
      });
      const router = new AdminRouter({ orchestrator, logger: null });
      const req = createMockRequest({ method: 'POST', url: '/api/admin/reload' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);
      const response = getResponse();

      assert.equal(response.statusCode, 200);
      assert.equal(response.body.success, true);
      assert.equal(response.body.botsReloaded, 0);
    });

    test('handles orchestrator.reload() throwing', async () => {
      const orchestrator = createMockOrchestrator();
      orchestrator.reload = mock.fn(async () => {
        throw new Error('Cannot reload: orchestrator is not running');
      });
      const router = new AdminRouter({ orchestrator, logger: null });
      const req = createMockRequest({ method: 'POST', url: '/api/admin/reload' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);
      const response = getResponse();

      assert.equal(response.statusCode, 500);
      assert.equal(response.body.success, false);
      assert.ok(response.body.message.includes('not running'));
    });

    test('calls orchestrator.reload() exactly once', async () => {
      const orchestrator = createMockOrchestrator();
      const router = new AdminRouter({ orchestrator, logger: null });
      const req = createMockRequest({ method: 'POST', url: '/api/admin/reload' });
      const { res } = createMockResponse();

      await router.handleRequest(req, res);
      assert.equal(orchestrator.reload.mock.callCount(), 1);
    });
  });

  // ==========================================================================
  // GET /api/admin/status
  // ==========================================================================

  describe('GET /api/admin/status', () => {
    test('returns system status with bot details', async () => {
      const bot = createMockBot();
      const orchestrator = createMockOrchestrator({
        botManager: createMockBotManager([bot]),
      });
      const router = new AdminRouter({ orchestrator, logger: null });
      const req = createMockRequest({ method: 'GET', url: '/api/admin/status' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);
      const response = getResponse();

      assert.equal(response.statusCode, 200);
      assert.equal(response.body.state, 'running');
      assert.equal(response.body.uptime, 3600000);
      assert.equal(response.body.botCount, 1);
      assert.equal(response.body.databaseConnected, true);
      assert.equal(response.body.bots.length, 1);
      assert.equal(response.body.bots[0].id, 'support-bot');
      assert.equal(response.body.bots[0].status, 'running');
      assert.equal(response.body.bots[0].model, 'claude-haiku-4-5');
    });

    test('returns empty bots array when no bots loaded', async () => {
      const orchestrator = createMockOrchestrator({
        botManager: createMockBotManager([]),
        status: { botCount: 0 },
      });
      const router = new AdminRouter({ orchestrator, logger: null });
      const req = createMockRequest({ method: 'GET', url: '/api/admin/status' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);
      const response = getResponse();

      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.body.bots, []);
    });

    test('returns status when botManager is null', async () => {
      const orchestrator = createMockOrchestrator();
      orchestrator.botManager = null;
      const router = new AdminRouter({ orchestrator, logger: null });
      const req = createMockRequest({ method: 'GET', url: '/api/admin/status' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);
      const response = getResponse();

      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.body.bots, []);
    });

    test('includes multiple bots in status', async () => {
      const bots = [
        createMockBot({ id: 'bot-a', status: 'running' }),
        createMockBot({ id: 'bot-b', status: 'stopped' }),
        createMockBot({ id: 'bot-c', status: 'error' }),
      ];
      const orchestrator = createMockOrchestrator({
        botManager: createMockBotManager(bots),
        status: { botCount: 3 },
      });
      const router = new AdminRouter({ orchestrator, logger: null });
      const req = createMockRequest({ method: 'GET', url: '/api/admin/status' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);
      const response = getResponse();

      assert.equal(response.body.bots.length, 3);
      assert.equal(response.body.bots[0].id, 'bot-a');
      assert.equal(response.body.bots[1].id, 'bot-b');
      assert.equal(response.body.bots[2].id, 'bot-c');
      assert.equal(response.body.bots[1].status, 'stopped');
    });

    test('calls orchestrator.getStatus() exactly once', async () => {
      const orchestrator = createMockOrchestrator();
      const router = new AdminRouter({ orchestrator, logger: null });
      const req = createMockRequest({ method: 'GET', url: '/api/admin/status' });
      const { res } = createMockResponse();

      await router.handleRequest(req, res);
      assert.equal(orchestrator.getStatus.mock.callCount(), 1);
    });

    test('returns JSON Content-Type header', async () => {
      const orchestrator = createMockOrchestrator();
      const router = new AdminRouter({ orchestrator, logger: null });
      const req = createMockRequest({ method: 'GET', url: '/api/admin/status' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);
      const response = getResponse();

      assert.equal(response.headers['Content-Type'], 'application/json');
    });
  });

  // ==========================================================================
  // POST /api/admin/bots/:botId/restart
  // ==========================================================================

  describe('POST /api/admin/bots/:botId/restart', () => {
    test('restarts a running bot successfully', async () => {
      const bot = createMockBot();
      const botManager = createMockBotManager([bot]);
      const orchestrator = createMockOrchestrator({ botManager });
      const router = new AdminRouter({ orchestrator, logger: null });
      const req = createMockRequest({
        method: 'POST',
        url: '/api/admin/bots/support-bot/restart',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);
      const response = getResponse();

      assert.equal(response.statusCode, 200);
      assert.equal(response.body.success, true);
      assert.equal(response.body.botId, 'support-bot');
      assert.ok(response.body.message.includes('restarted'));
    });

    test('calls stopBot then startBot', async () => {
      const bot = createMockBot();
      const botManager = createMockBotManager([bot]);
      const orchestrator = createMockOrchestrator({ botManager });
      const router = new AdminRouter({ orchestrator, logger: null });
      const req = createMockRequest({
        method: 'POST',
        url: '/api/admin/bots/support-bot/restart',
      });
      const { res } = createMockResponse();

      await router.handleRequest(req, res);

      assert.equal(botManager.stopBot.mock.callCount(), 1);
      assert.equal(botManager.startBot.mock.callCount(), 1);
      assert.equal(botManager.stopBot.mock.calls[0].arguments[0], 'support-bot');
      assert.equal(botManager.startBot.mock.calls[0].arguments[0], 'support-bot');
    });

    test('returns 404 for non-existent bot', async () => {
      const orchestrator = createMockOrchestrator({
        botManager: createMockBotManager([]),
      });
      const router = new AdminRouter({ orchestrator, logger: null });
      const req = createMockRequest({
        method: 'POST',
        url: '/api/admin/bots/nonexistent/restart',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);
      const response = getResponse();

      assert.equal(response.statusCode, 404);
      assert.equal(response.body.success, false);
      assert.ok(response.body.message.includes('not found'));
    });

    test('returns 503 when botManager is unavailable', async () => {
      const orchestrator = createMockOrchestrator();
      orchestrator.botManager = null;
      const router = new AdminRouter({ orchestrator, logger: null });
      const req = createMockRequest({
        method: 'POST',
        url: '/api/admin/bots/support-bot/restart',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);
      const response = getResponse();

      assert.equal(response.statusCode, 503);
      assert.equal(response.body.success, false);
      assert.ok(response.body.message.includes('BotManager not available'));
    });

    test('handles restart failure gracefully', async () => {
      const bot = createMockBot();
      const botManager = createMockBotManager([bot]);
      botManager.stopBot = mock.fn(async () => {
        throw new Error('Container shutdown timed out');
      });
      const orchestrator = createMockOrchestrator({ botManager });
      const router = new AdminRouter({ orchestrator, logger: null });
      const req = createMockRequest({
        method: 'POST',
        url: '/api/admin/bots/support-bot/restart',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);
      const response = getResponse();

      assert.equal(response.statusCode, 500);
      assert.equal(response.body.success, false);
      assert.ok(response.body.message.includes('Container shutdown timed out'));
    });
  });

  // ==========================================================================
  // POST /api/admin/bots/:botId/reload
  // ==========================================================================

  describe('POST /api/admin/bots/:botId/reload', () => {
    test('reloads bot config using BotReloader when available', async () => {
      const bot = createMockBot();
      const botReloader = createMockBotReloader();
      const orchestrator = createMockOrchestrator({
        botManager: createMockBotManager([bot]),
        botReloader,
      });
      const router = new AdminRouter({ orchestrator, logger: null });
      const req = createMockRequest({
        method: 'POST',
        url: '/api/admin/bots/support-bot/reload',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);
      const response = getResponse();

      assert.equal(response.statusCode, 200);
      assert.equal(response.body.success, true);
      assert.equal(response.body.botId, 'support-bot');
      assert.equal(response.body.needsContainerRestart, false);
      assert.equal(botReloader.reloadBotConfig.mock.callCount(), 1);
    });

    test('falls back to botManager.reloadBot when no BotReloader', async () => {
      const bot = createMockBot();
      const botManager = createMockBotManager([bot]);
      const orchestrator = createMockOrchestrator({
        botManager,
        botReloader: null,
      });
      const router = new AdminRouter({ orchestrator, logger: null });
      const req = createMockRequest({
        method: 'POST',
        url: '/api/admin/bots/support-bot/reload',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);
      const response = getResponse();

      assert.equal(response.statusCode, 200);
      assert.equal(response.body.success, true);
      assert.equal(botManager.reloadBot.mock.callCount(), 1);
    });

    test('returns 404 for non-existent bot', async () => {
      const orchestrator = createMockOrchestrator({
        botManager: createMockBotManager([]),
      });
      const router = new AdminRouter({ orchestrator, logger: null });
      const req = createMockRequest({
        method: 'POST',
        url: '/api/admin/bots/nonexistent/reload',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);
      const response = getResponse();

      assert.equal(response.statusCode, 404);
      assert.equal(response.body.success, false);
    });

    test('returns 503 when botManager is unavailable', async () => {
      const orchestrator = createMockOrchestrator();
      orchestrator.botManager = null;
      const router = new AdminRouter({ orchestrator, logger: null });
      const req = createMockRequest({
        method: 'POST',
        url: '/api/admin/bots/support-bot/reload',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);
      const response = getResponse();

      assert.equal(response.statusCode, 503);
    });

    test('handles reload failure gracefully', async () => {
      const bot = createMockBot();
      const botReloader = createMockBotReloader();
      botReloader.reloadBotConfig = mock.fn(async () => {
        throw new Error('Config validation failed');
      });
      const orchestrator = createMockOrchestrator({
        botManager: createMockBotManager([bot]),
        botReloader,
      });
      const router = new AdminRouter({ orchestrator, logger: null });
      const req = createMockRequest({
        method: 'POST',
        url: '/api/admin/bots/support-bot/reload',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);
      const response = getResponse();

      assert.equal(response.statusCode, 500);
      assert.equal(response.body.success, false);
      assert.ok(response.body.message.includes('Config validation failed'));
    });

    test('reports needsContainerRestart correctly', async () => {
      const bot = createMockBot();
      const botReloader = createMockBotReloader();
      botReloader.needsContainerRestart = mock.fn(() => true);
      const orchestrator = createMockOrchestrator({
        botManager: createMockBotManager([bot]),
        botReloader,
      });
      const router = new AdminRouter({ orchestrator, logger: null });
      const req = createMockRequest({
        method: 'POST',
        url: '/api/admin/bots/support-bot/reload',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);
      const response = getResponse();

      assert.equal(response.body.needsContainerRestart, true);
    });
  });

  // ==========================================================================
  // JSON Response Formatting
  // ==========================================================================

  describe('JSON response formatting', () => {
    test('sets Content-Type header to application/json', async () => {
      const orchestrator = createMockOrchestrator();
      const router = new AdminRouter({ orchestrator, logger: null });
      const req = createMockRequest({ method: 'GET', url: '/api/admin/status' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);
      const response = getResponse();

      assert.equal(response.headers['Content-Type'], 'application/json');
    });

    test('sets Content-Length header', async () => {
      const orchestrator = createMockOrchestrator();
      const router = new AdminRouter({ orchestrator, logger: null });
      const req = createMockRequest({ method: 'GET', url: '/api/admin/status' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);
      const response = getResponse();

      assert.ok(response.headers['Content-Length'] > 0);
    });

    test('returns valid JSON body', async () => {
      const orchestrator = createMockOrchestrator();
      const router = new AdminRouter({ orchestrator, logger: null });
      const req = createMockRequest({ method: 'GET', url: '/api/admin/status' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);
      const response = getResponse();

      assert.ok(response.body);
      assert.equal(typeof response.body, 'object');
    });
  });

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('error handling', () => {
    test('logs errors and returns 500 for unexpected handler errors', async () => {
      const { logger, messages } = createLogger();
      const orchestrator = createMockOrchestrator();
      orchestrator.getStatus = mock.fn(() => {
        throw new Error('Unexpected failure');
      });
      const router = new AdminRouter({ orchestrator, logger });
      const req = createMockRequest({ method: 'GET', url: '/api/admin/status' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);
      const response = getResponse();

      assert.equal(response.statusCode, 500);
      assert.equal(response.body.error, 'Internal Server Error');
      assert.ok(messages.some(m => m.includes('Unexpected failure')));
    });
  });

  // ==========================================================================
  // AdminRouterError
  // ==========================================================================

  describe('AdminRouterError', () => {
    test('has correct name', () => {
      const err = new AdminRouterError('test');
      assert.equal(err.name, 'AdminRouterError');
    });

    test('extends Error', () => {
      const err = new AdminRouterError('test');
      assert.ok(err instanceof Error);
    });

    test('stores cause', () => {
      const cause = new Error('original');
      const err = new AdminRouterError('wrapper', { cause });
      assert.equal(err.cause, cause);
    });

    test('stores endpoint', () => {
      const err = new AdminRouterError('test', { endpoint: '/api/admin/reload' });
      assert.equal(err.endpoint, '/api/admin/reload');
    });

    test('stores statusCode', () => {
      const err = new AdminRouterError('test', { statusCode: 503 });
      assert.equal(err.statusCode, 503);
    });

    test('has correct message', () => {
      const err = new AdminRouterError('Something went wrong');
      assert.equal(err.message, 'Something went wrong');
    });
  });
});
