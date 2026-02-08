/**
 * Unit tests for built-in health checks
 *
 * Tests the check factory functions for database, bots, channels, workers,
 * and MCP servers. Also tests the registerBuiltInChecks convenience function.
 *
 * Tests:
 * - createDatabaseCheck: healthy, unhealthy, missing storage
 * - createBotsCheck: all running, partial, none running, no bots
 * - createChannelsCheck: all connected, partial, none connected, no channels
 * - createWorkersCheck: all healthy, partial, none healthy, no registry
 * - createMCPCheck: all running, partial, none, no manager
 * - registerBuiltInChecks: registers all available checks
 */

import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDatabaseCheck,
  createBotsCheck,
  createChannelsCheck,
  createWorkersCheck,
  createMCPCheck,
  registerBuiltInChecks,
} from '../../../src/monitoring/health-checks.js';
import { HealthMonitor } from '../../../src/monitoring/HealthMonitor.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock storage instance
 * @param {Object} [overrides={}] - Override defaults
 * @returns {Object} Mock storage
 */
function createMockStorage(overrides = {}) {
  return {
    query: mock.fn(async () => ({ rows: [{ '?column?': 1 }] })),
    ...overrides,
  };
}

/**
 * Create a mock BotManager
 * @param {Array} [bots=[]] - Bots to return from listBots
 * @returns {Object} Mock BotManager
 */
function createMockBotManager(bots = []) {
  return {
    listBots: mock.fn(() => bots),
  };
}

/**
 * Create a mock ChannelManager
 * @param {Array} [channels=[]] - Channels to return from listChannels
 * @returns {Object} Mock ChannelManager
 */
function createMockChannelManager(channels = []) {
  return {
    listChannels: mock.fn(() => channels),
  };
}

/**
 * Create a mock WorkerRegistry
 * @param {Array} [workers=[]] - Workers to return from listWorkers
 * @returns {Object} Mock WorkerRegistry
 */
function createMockWorkerRegistry(workers = []) {
  return {
    listWorkers: mock.fn(async () => workers),
  };
}

/**
 * Create a mock MCPManager
 * @param {Array} [servers=[]] - Servers to return from listServers
 * @returns {Object} Mock MCPManager
 */
function createMockMCPManager(servers = []) {
  return {
    listServers: mock.fn(() => servers),
    getServerCount: mock.fn(() => servers.length),
  };
}

// ============================================================================
// Tests: createDatabaseCheck
// ============================================================================

describe('createDatabaseCheck', () => {
  test('returns healthy when query succeeds', async () => {
    const storage = createMockStorage();
    const check = createDatabaseCheck(storage);

    const result = await check();

    assert.equal(result.status, 'healthy');
    assert.ok(typeof result.latency === 'number');
    assert.ok(result.latency >= 0);
    assert.equal(storage.query.mock.callCount(), 1);
  });

  test('returns unhealthy when query fails', async () => {
    const storage = createMockStorage({
      query: mock.fn(async () => {
        throw new Error('Connection refused');
      }),
    });
    const check = createDatabaseCheck(storage);

    const result = await check();

    assert.equal(result.status, 'unhealthy');
    assert.equal(result.error, 'Connection refused');
  });

  test('returns unhealthy when storage is null', async () => {
    const check = createDatabaseCheck(null);

    const result = await check();

    assert.equal(result.status, 'unhealthy');
    assert.ok(result.error.includes('not available'));
  });

  test('returns unhealthy when storage has no query method', async () => {
    const check = createDatabaseCheck({});

    const result = await check();

    assert.equal(result.status, 'unhealthy');
    assert.ok(result.error.includes('not available'));
  });
});

// ============================================================================
// Tests: createBotsCheck
// ============================================================================

describe('createBotsCheck', () => {
  test('returns healthy when all bots are running', async () => {
    const bots = [
      { id: 'bot-1', status: 'running' },
      { id: 'bot-2', status: 'running' },
    ];
    const check = createBotsCheck(createMockBotManager(bots));

    const result = await check();

    assert.equal(result.status, 'healthy');
    assert.equal(result.running, 2);
    assert.equal(result.total, 2);
    assert.equal(result.errored, 0);
  });

  test('returns degraded when some bots are not running', async () => {
    const bots = [
      { id: 'bot-1', status: 'running' },
      { id: 'bot-2', status: 'stopped' },
      { id: 'bot-3', status: 'error' },
    ];
    const check = createBotsCheck(createMockBotManager(bots));

    const result = await check();

    assert.equal(result.status, 'degraded');
    assert.equal(result.running, 1);
    assert.equal(result.total, 3);
    assert.equal(result.errored, 1);
  });

  test('returns unhealthy when no bots are running', async () => {
    const bots = [
      { id: 'bot-1', status: 'stopped' },
      { id: 'bot-2', status: 'error' },
    ];
    const check = createBotsCheck(createMockBotManager(bots));

    const result = await check();

    assert.equal(result.status, 'unhealthy');
    assert.equal(result.running, 0);
    assert.equal(result.total, 2);
  });

  test('returns healthy when no bots loaded', async () => {
    const check = createBotsCheck(createMockBotManager([]));

    const result = await check();

    assert.equal(result.status, 'healthy');
    assert.equal(result.running, 0);
    assert.equal(result.total, 0);
  });

  test('returns unhealthy when BotManager is null', async () => {
    const check = createBotsCheck(null);

    const result = await check();

    assert.equal(result.status, 'unhealthy');
    assert.ok(result.error.includes('not available'));
  });
});

// ============================================================================
// Tests: createChannelsCheck
// ============================================================================

describe('createChannelsCheck', () => {
  test('returns healthy when all channels are connected', async () => {
    const channels = [
      { name: 'slack', adapter: { isConnected: mock.fn(async () => true) }, status: 'ready' },
      { name: 'discord', adapter: { isConnected: mock.fn(async () => true) }, status: 'ready' },
    ];
    const check = createChannelsCheck(createMockChannelManager(channels));

    const result = await check();

    assert.equal(result.status, 'healthy');
    assert.equal(result.connected, 2);
    assert.equal(result.total, 2);
  });

  test('returns degraded when some channels are disconnected', async () => {
    const channels = [
      { name: 'slack', adapter: { isConnected: mock.fn(async () => true) }, status: 'ready' },
      { name: 'discord', adapter: { isConnected: mock.fn(async () => false) }, status: 'error' },
    ];
    const check = createChannelsCheck(createMockChannelManager(channels));

    const result = await check();

    assert.equal(result.status, 'degraded');
    assert.equal(result.connected, 1);
    assert.equal(result.total, 2);
  });

  test('returns unhealthy when no channels are connected', async () => {
    const channels = [
      { name: 'slack', adapter: { isConnected: mock.fn(async () => false) }, status: 'error' },
      { name: 'discord', adapter: { isConnected: mock.fn(async () => false) }, status: 'error' },
    ];
    const check = createChannelsCheck(createMockChannelManager(channels));

    const result = await check();

    assert.equal(result.status, 'unhealthy');
    assert.equal(result.connected, 0);
    assert.equal(result.total, 2);
  });

  test('returns healthy when no channels configured', async () => {
    const check = createChannelsCheck(createMockChannelManager([]));

    const result = await check();

    assert.equal(result.status, 'healthy');
    assert.equal(result.connected, 0);
    assert.equal(result.total, 0);
  });

  test('falls back to status check when adapter lacks isConnected', async () => {
    const channels = [
      { name: 'rest', adapter: {}, status: 'ready' },
      { name: 'webhook', adapter: {}, status: 'started' },
    ];
    const check = createChannelsCheck(createMockChannelManager(channels));

    const result = await check();

    assert.equal(result.status, 'healthy');
    assert.equal(result.connected, 2);
    assert.equal(result.total, 2);
  });

  test('handles isConnected throwing error', async () => {
    const channels = [
      {
        name: 'slack',
        adapter: {
          isConnected: mock.fn(async () => {
            throw new Error('timeout');
          }),
        },
        status: 'error',
      },
    ];
    const check = createChannelsCheck(createMockChannelManager(channels));

    const result = await check();

    assert.equal(result.status, 'unhealthy');
    assert.equal(result.connected, 0);
  });

  test('returns unhealthy when ChannelManager is null', async () => {
    const check = createChannelsCheck(null);

    const result = await check();

    assert.equal(result.status, 'unhealthy');
    assert.ok(result.error.includes('not available'));
  });
});

// ============================================================================
// Tests: createWorkersCheck
// ============================================================================

describe('createWorkersCheck', () => {
  test('returns healthy when all workers are healthy', async () => {
    const workers = [
      { id: 'local', status: 'healthy' },
      { id: 'remote-1', status: 'healthy' },
    ];
    const check = createWorkersCheck(createMockWorkerRegistry(workers));

    const result = await check();

    assert.equal(result.status, 'healthy');
    assert.equal(result.available, 2);
    assert.equal(result.total, 2);
  });

  test('returns degraded when some workers are offline', async () => {
    const workers = [
      { id: 'local', status: 'healthy' },
      { id: 'remote-1', status: 'offline' },
    ];
    const check = createWorkersCheck(createMockWorkerRegistry(workers));

    const result = await check();

    assert.equal(result.status, 'degraded');
    assert.equal(result.available, 1);
    assert.equal(result.total, 2);
  });

  test('returns unhealthy when all workers are offline', async () => {
    const workers = [
      { id: 'local', status: 'offline' },
      { id: 'remote-1', status: 'offline' },
    ];
    const check = createWorkersCheck(createMockWorkerRegistry(workers));

    const result = await check();

    assert.equal(result.status, 'unhealthy');
    assert.equal(result.available, 0);
    assert.equal(result.total, 2);
  });

  test('returns healthy when no workers registered', async () => {
    const check = createWorkersCheck(createMockWorkerRegistry([]));

    const result = await check();

    assert.equal(result.status, 'healthy');
    assert.equal(result.available, 0);
    assert.equal(result.total, 0);
  });

  test('returns healthy with note when WorkerRegistry is null', async () => {
    const check = createWorkersCheck(null);

    const result = await check();

    assert.equal(result.status, 'healthy');
    assert.ok(result.note.includes('local-only'));
  });

  test('returns unhealthy when listWorkers throws', async () => {
    const registry = {
      listWorkers: mock.fn(async () => {
        throw new Error('DB error');
      }),
    };
    const check = createWorkersCheck(registry);

    const result = await check();

    assert.equal(result.status, 'unhealthy');
    assert.equal(result.error, 'DB error');
  });
});

// ============================================================================
// Tests: createMCPCheck
// ============================================================================

describe('createMCPCheck', () => {
  test('returns healthy when all servers are running', async () => {
    const servers = [
      { id: 'server-1', status: 'running' },
      { id: 'server-2', status: 'running' },
    ];
    const check = createMCPCheck(createMockMCPManager(servers));

    const result = await check();

    assert.equal(result.status, 'healthy');
    assert.equal(result.running, 2);
    assert.equal(result.total, 2);
  });

  test('returns degraded when some servers are not running', async () => {
    const servers = [
      { id: 'server-1', status: 'running' },
      { id: 'server-2', status: 'error' },
    ];
    const check = createMCPCheck(createMockMCPManager(servers));

    const result = await check();

    assert.equal(result.status, 'degraded');
    assert.equal(result.running, 1);
    assert.equal(result.total, 2);
  });

  test('returns unhealthy when no servers are running', async () => {
    const servers = [
      { id: 'server-1', status: 'stopped' },
      { id: 'server-2', status: 'error' },
    ];
    const check = createMCPCheck(createMockMCPManager(servers));

    const result = await check();

    assert.equal(result.status, 'unhealthy');
    assert.equal(result.running, 0);
    assert.equal(result.total, 2);
  });

  test('returns healthy when no servers configured', async () => {
    const check = createMCPCheck(createMockMCPManager([]));

    const result = await check();

    assert.equal(result.status, 'healthy');
    assert.equal(result.running, 0);
    assert.equal(result.total, 0);
  });

  test('returns healthy when MCPManager is null', async () => {
    const check = createMCPCheck(null);

    const result = await check();

    assert.equal(result.status, 'healthy');
    assert.ok(result.note.includes('not available'));
  });

  test('falls back to getServerCount when listServers is not available', async () => {
    const manager = {
      getServerCount: mock.fn(() => 3),
    };
    const check = createMCPCheck(manager);

    const result = await check();

    assert.equal(result.status, 'healthy');
    assert.equal(result.running, 3);
  });

  test('returns unhealthy when listServers throws', async () => {
    const manager = {
      listServers: mock.fn(() => {
        throw new Error('Internal error');
      }),
    };
    const check = createMCPCheck(manager);

    const result = await check();

    assert.equal(result.status, 'unhealthy');
    assert.equal(result.error, 'Internal error');
  });
});

// ============================================================================
// Tests: registerBuiltInChecks
// ============================================================================

describe('registerBuiltInChecks', () => {
  test('registers all checks when all components are provided', () => {
    const monitor = new HealthMonitor();
    const registered = registerBuiltInChecks(monitor, {
      storage: createMockStorage(),
      botManager: createMockBotManager(),
      channelManager: createMockChannelManager(),
      workerRegistry: createMockWorkerRegistry(),
      mcpManager: createMockMCPManager(),
    });

    assert.deepStrictEqual(registered, ['database', 'bots', 'channels', 'workers', 'mcp']);
    assert.equal(monitor.getCheckCount(), 5);
  });

  test('registers only provided components', () => {
    const monitor = new HealthMonitor();
    const registered = registerBuiltInChecks(monitor, {
      storage: createMockStorage(),
      botManager: createMockBotManager(),
    });

    assert.deepStrictEqual(registered, ['database', 'bots']);
    assert.equal(monitor.getCheckCount(), 2);
  });

  test('registers nothing when no components provided', () => {
    const monitor = new HealthMonitor();
    const registered = registerBuiltInChecks(monitor, {});

    assert.deepStrictEqual(registered, []);
    assert.equal(monitor.getCheckCount(), 0);
  });

  test('uses custom intervals when provided', () => {
    const monitor = new HealthMonitor();
    registerBuiltInChecks(monitor, { storage: createMockStorage() }, { databaseInterval: 5000 });

    assert.equal(monitor.checks.get('database').interval, 5000);
  });

  test('uses default intervals when not specified', () => {
    const monitor = new HealthMonitor();
    registerBuiltInChecks(monitor, {
      storage: createMockStorage(),
      botManager: createMockBotManager(),
    });

    assert.equal(monitor.checks.get('database').interval, 15000);
    assert.equal(monitor.checks.get('bots').interval, 30000);
  });

  test('registered checks produce valid results', async () => {
    const monitor = new HealthMonitor();
    registerBuiltInChecks(monitor, {
      storage: createMockStorage(),
      botManager: createMockBotManager([{ id: 'test', status: 'running' }]),
    });

    const results = await monitor.runChecks();

    assert.equal(results.database.status, 'healthy');
    assert.equal(results.bots.status, 'healthy');
    assert.equal(results.bots.running, 1);
    assert.equal(results.bots.total, 1);
  });
});
