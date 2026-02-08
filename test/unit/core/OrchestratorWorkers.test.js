/**
 * Unit tests for Orchestrator worker distribution integration
 *
 * Tests the integration of WorkerRegistry, WorkerAssigner, and SSHTunnelManager
 * into the Orchestrator lifecycle, including:
 * - Worker initialization during startup
 * - Workers config loading from main config and workers.json
 * - Default local worker registration
 * - SSH tunnel creation for remote workers
 * - Worker system shutdown
 * - Worker status in getStatus()
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Orchestrator, ORCHESTRATOR_STATES } from '../../../src/core/orchestrator.js';

// =============================================================================
// Mock Factories
// =============================================================================

/**
 * Create a valid main config for testing
 * @param {Object} [overrides={}] - Override default config values
 * @returns {Object} Main configuration
 */
function createMainConfig(overrides = {}) {
  return {
    defaults: {
      model: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
      sandbox: { type: 'docker', image: 'node:22-slim' },
    },
    providers: {
      anthropic: { type: 'anthropic', apiKey: 'test-key' },
    },
    channels: {},
    mcpServers: {},
    ...overrides,
  };
}

/**
 * Create a mock ConfigLoader
 * @param {Object} [options={}] - Override defaults
 * @returns {Object} Mock ConfigLoader
 */
function createMockConfigLoader(options = {}) {
  const mainConfig = options.mainConfig || createMainConfig();
  return {
    load: mock.fn(async path => {
      if (options.loadHandlers && options.loadHandlers[path]) {
        return options.loadHandlers[path]();
      }
      return mainConfig;
    }),
    deepMerge: mock.fn((defaults, overrides) => ({ ...defaults, ...overrides })),
    loadBotConfig: mock.fn(async (_path, defaults) => ({ ...defaults })),
  };
}

/**
 * Create a mock ConfigValidator
 * @returns {Object} Mock ConfigValidator
 */
function createMockConfigValidator() {
  return {
    validateMainConfig: mock.fn(config => ({
      valid: true,
      errors: [],
      data: config,
    })),
    validateBotConfig: mock.fn(config => config),
    generateReport: mock.fn(errors => errors.map(e => e.message).join('\n')),
  };
}

/**
 * Create a mock storage instance
 * @param {Object} [overrides={}] - Override defaults
 * @returns {Object} Mock storage
 */
function createMockStorage(overrides = {}) {
  return {
    connect: mock.fn(async () => {}),
    disconnect: mock.fn(async () => {}),
    query: mock.fn(async () => ({ rows: [] })),
    transaction: mock.fn(async fn => fn({ query: mock.fn(async () => ({ rows: [] })) })),
    isConnected: mock.fn(() => true),
    getPoolStats: mock.fn(() => ({ totalCount: 5, idleCount: 3, waitingCount: 0 })),
    ...overrides,
  };
}

/**
 * Create a mock BotManager
 * @returns {Object} Mock BotManager
 */
function createMockBotManager() {
  const bots = [];
  return {
    loadBot: mock.fn(async (botId, config) => {
      bots.push({
        id: botId,
        config: { ...config, enabled: config.enabled ?? true },
        status: 'loaded',
      });
    }),
    startBot: mock.fn(async () => {}),
    stopBot: mock.fn(async () => {}),
    reloadBot: mock.fn(async () => {}),
    stopAll: mock.fn(async () => ({ stopped: [], failed: [] })),
    listBots: mock.fn(() => [...bots]),
    getBot: mock.fn(botId => bots.find(b => b.id === botId)),
    getBotCount: mock.fn(() => bots.length),
    _bots: bots,
  };
}

/**
 * Create a mock MigrationRunner
 * @returns {Object} Mock MigrationRunner
 */
function createMockMigrationRunner() {
  return {
    runMigrations: mock.fn(async () => []),
    getMigrationStatus: mock.fn(async () => []),
    ensureMigrationsTable: mock.fn(async () => {}),
  };
}

/**
 * Create a mock WorkerRegistry
 * @param {Object} [overrides={}] - Override defaults
 * @returns {Object} Mock WorkerRegistry
 */
function createMockWorkerRegistry(overrides = {}) {
  const workers = new Map();
  return {
    registerWorker: mock.fn(async config => {
      const worker = {
        id: config.id,
        host: config.host,
        type: config.type,
        maxContainers: config.maxContainers || 10,
        currentLoad: 0,
        status: 'healthy',
        lastHeartbeat: new Date(),
        createdAt: new Date(),
      };
      workers.set(config.id, worker);
      return worker;
    }),
    unregisterWorker: mock.fn(async () => true),
    listWorkers: mock.fn(async () => [...workers.values()]),
    getWorker: mock.fn(async workerId => workers.get(workerId) || null),
    getAvailableWorker: mock.fn(async () => workers.values().next().value || null),
    updateHeartbeat: mock.fn(async workerId => workers.get(workerId) || null),
    incrementLoad: mock.fn(async workerId => workers.get(workerId) || null),
    decrementLoad: mock.fn(async workerId => workers.get(workerId) || null),
    detectDeadWorkers: mock.fn(async () => []),
    _workers: workers,
    ...overrides,
  };
}

/**
 * Create a mock SSHTunnelManager
 * @param {Object} [overrides={}] - Override defaults
 * @returns {Object} Mock SSHTunnelManager
 */
function createMockSSHTunnelManager(overrides = {}) {
  const tunnels = new Map();
  return {
    createTunnel: mock.fn(async config => {
      const tunnel = {
        workerId: config.workerId,
        dockerHost: `tcp://127.0.0.1:${54000 + tunnels.size}`,
        localPort: 54000 + tunnels.size,
        state: 'connected',
      };
      tunnels.set(config.workerId, tunnel);
      return tunnel;
    }),
    closeTunnel: mock.fn(async workerId => {
      tunnels.delete(workerId);
      return true;
    }),
    closeAll: mock.fn(async () => {
      const ids = [...tunnels.keys()];
      tunnels.clear();
      return ids;
    }),
    healthCheck: mock.fn(async workerId => ({
      workerId,
      healthy: tunnels.has(workerId),
      state: tunnels.has(workerId) ? 'connected' : 'closed',
    })),
    getDockerHost: mock.fn(workerId => {
      const tunnel = tunnels.get(workerId);
      return tunnel ? tunnel.dockerHost : null;
    }),
    listTunnels: mock.fn(() => [...tunnels.values()]),
    _tunnels: tunnels,
    ...overrides,
  };
}

/**
 * Create a mock WorkerAssigner
 * @param {Object} [overrides={}] - Override defaults
 * @returns {Object} Mock WorkerAssigner
 */
function createMockWorkerAssigner(overrides = {}) {
  return {
    assignBot: mock.fn(async () => ({
      workerId: 'local',
      dockerHost: null,
      workerType: 'local',
    })),
    releaseBot: mock.fn(async () => true),
    getAssignment: mock.fn(() => 'local'),
    rebalance: mock.fn(async () => []),
    failover: mock.fn(async () => ({ reassigned: [], failed: [] })),
    ...overrides,
  };
}

/**
 * Build a default set of orchestrator options for worker testing
 * @param {Object} [overrides={}] - Override defaults
 * @returns {Object} Orchestrator options
 */
function createOrchestratorOptions(overrides = {}) {
  return {
    logger: null, // suppress logging in tests
    botsPath: '/tmp/nonexistent-bots-path',
    configLoader: createMockConfigLoader(),
    configValidator: createMockConfigValidator(),
    storage: createMockStorage(),
    botManager: createMockBotManager(),
    migrationRunner: createMockMigrationRunner(),
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('Orchestrator - Worker Distribution Integration', () => {
  let orchestrator;
  let opts;

  beforeEach(() => {
    opts = createOrchestratorOptions();
    orchestrator = new Orchestrator(opts);
  });

  // ===========================================================================
  // Constructor
  // ===========================================================================

  describe('constructor - worker properties', () => {
    test('initializes worker properties to null by default', () => {
      assert.equal(orchestrator.workerRegistry, null);
      assert.equal(orchestrator.workerAssigner, null);
      assert.equal(orchestrator.sshTunnelManager, null);
      assert.equal(orchestrator.workerRegistryFactory, null);
      assert.equal(orchestrator.workerAssignerFactory, null);
      assert.equal(orchestrator.sshTunnelManagerFactory, null);
      assert.equal(orchestrator.workersConfigPath, null);
    });

    test('accepts injected worker components', () => {
      const workerRegistry = createMockWorkerRegistry();
      const workerAssigner = createMockWorkerAssigner();
      const sshTunnelManager = createMockSSHTunnelManager();

      const orch = new Orchestrator({
        ...opts,
        workerRegistry,
        workerAssigner,
        sshTunnelManager,
      });

      assert.equal(orch.workerRegistry, workerRegistry);
      assert.equal(orch.workerAssigner, workerAssigner);
      assert.equal(orch.sshTunnelManager, sshTunnelManager);
    });

    test('accepts worker factories', () => {
      const workerRegistryFactory = mock.fn();
      const workerAssignerFactory = mock.fn();
      const sshTunnelManagerFactory = mock.fn();

      const orch = new Orchestrator({
        ...opts,
        workerRegistryFactory,
        workerAssignerFactory,
        sshTunnelManagerFactory,
      });

      assert.equal(orch.workerRegistryFactory, workerRegistryFactory);
      assert.equal(orch.workerAssignerFactory, workerAssignerFactory);
      assert.equal(orch.sshTunnelManagerFactory, sshTunnelManagerFactory);
    });

    test('accepts custom workersConfigPath', () => {
      const orch = new Orchestrator({
        ...opts,
        workersConfigPath: '/custom/workers.json',
      });

      assert.equal(orch.workersConfigPath, '/custom/workers.json');
    });
  });

  // ===========================================================================
  // Worker Initialization During Startup
  // ===========================================================================

  describe('start() - worker initialization', () => {
    test('initializes worker system with default local worker', async () => {
      await orchestrator.start();

      assert.equal(orchestrator.state, ORCHESTRATOR_STATES.RUNNING);
      assert.ok(orchestrator.workerRegistry, 'WorkerRegistry should be created');
      assert.ok(orchestrator.workerAssigner, 'WorkerAssigner should be created');
      assert.ok(orchestrator.sshTunnelManager, 'SSHTunnelManager should be created');
    });

    test('uses injected WorkerRegistry', async () => {
      const workerRegistry = createMockWorkerRegistry();
      orchestrator = new Orchestrator({
        ...opts,
        workerRegistry,
      });

      await orchestrator.start();

      assert.equal(orchestrator.workerRegistry, workerRegistry);
      // Should have called getWorker to check if 'local' exists
      assert.ok(workerRegistry.getWorker.mock.calls.length > 0);
    });

    test('uses workerRegistryFactory when no instance injected', async () => {
      const workerRegistry = createMockWorkerRegistry();
      const workerRegistryFactory = mock.fn(() => workerRegistry);

      orchestrator = new Orchestrator({
        ...opts,
        workerRegistryFactory,
      });

      await orchestrator.start();

      assert.equal(workerRegistryFactory.mock.calls.length, 1);
      assert.equal(orchestrator.workerRegistry, workerRegistry);
    });

    test('uses workerAssignerFactory when no instance injected', async () => {
      const workerAssigner = createMockWorkerAssigner();
      const workerAssignerFactory = mock.fn(() => workerAssigner);

      orchestrator = new Orchestrator({
        ...opts,
        workerAssignerFactory,
      });

      await orchestrator.start();

      assert.equal(workerAssignerFactory.mock.calls.length, 1);
      assert.equal(orchestrator.workerAssigner, workerAssigner);
    });

    test('uses sshTunnelManagerFactory when no instance injected', async () => {
      const sshTunnelManager = createMockSSHTunnelManager();
      const sshTunnelManagerFactory = mock.fn(() => sshTunnelManager);

      orchestrator = new Orchestrator({
        ...opts,
        sshTunnelManagerFactory,
      });

      await orchestrator.start();

      assert.equal(sshTunnelManagerFactory.mock.calls.length, 1);
      assert.equal(orchestrator.sshTunnelManager, sshTunnelManager);
    });

    test('registers default local worker when no workers configured', async () => {
      const workerRegistry = createMockWorkerRegistry();
      orchestrator = new Orchestrator({
        ...opts,
        workerRegistry,
      });

      await orchestrator.start();

      // Should have tried to get 'local' worker, then registered it
      const getWorkerCalls = workerRegistry.getWorker.mock.calls;
      assert.ok(
        getWorkerCalls.some(c => c.arguments[0] === 'local'),
        'Should check for existing local worker'
      );

      const registerCalls = workerRegistry.registerWorker.mock.calls;
      assert.ok(
        registerCalls.some(c => c.arguments[0].id === 'local'),
        'Should register default local worker'
      );
    });

    test('updates heartbeat if local worker already exists', async () => {
      const workerRegistry = createMockWorkerRegistry();
      // Pre-populate the local worker
      workerRegistry._workers.set('local', {
        id: 'local',
        host: 'localhost',
        type: 'local',
        maxContainers: 10,
        currentLoad: 0,
        status: 'healthy',
      });

      orchestrator = new Orchestrator({
        ...opts,
        workerRegistry,
      });

      await orchestrator.start();

      // Should update heartbeat instead of registering
      assert.ok(
        workerRegistry.updateHeartbeat.mock.calls.some(c => c.arguments[0] === 'local'),
        'Should update heartbeat for existing local worker'
      );
    });

    test('skips worker initialization when no storage configured', async () => {
      orchestrator = new Orchestrator({
        ...opts,
        storage: null,
        storageFactory: null,
      });

      await orchestrator.start();

      assert.equal(orchestrator.workerRegistry, null);
      assert.equal(orchestrator.workerAssigner, null);
    });

    test('registers workers from main config workers section', async () => {
      const mainConfig = createMainConfig({
        workers: [
          { id: 'local', type: 'local', host: 'localhost', maxContainers: 5 },
          { id: 'gpu-server', type: 'remote', host: '192.168.1.100', maxContainers: 10 },
        ],
      });

      const configLoader = createMockConfigLoader({ mainConfig });
      const workerRegistry = createMockWorkerRegistry();
      const sshTunnelManager = createMockSSHTunnelManager();

      orchestrator = new Orchestrator({
        ...opts,
        configLoader,
        workerRegistry,
        sshTunnelManager,
      });

      await orchestrator.start();

      const registerCalls = workerRegistry.registerWorker.mock.calls;
      assert.ok(
        registerCalls.some(c => c.arguments[0].id === 'local'),
        'Should register local worker from config'
      );
      assert.ok(
        registerCalls.some(c => c.arguments[0].id === 'gpu-server'),
        'Should register remote worker from config'
      );
    });

    test('creates SSH tunnels for remote workers', async () => {
      const mainConfig = createMainConfig({
        workers: [
          {
            id: 'gpu-server',
            type: 'remote',
            host: '192.168.1.100',
            user: 'deploy',
            keyPath: '~/.ssh/id_rsa',
            maxContainers: 10,
          },
        ],
      });

      const configLoader = createMockConfigLoader({ mainConfig });
      const workerRegistry = createMockWorkerRegistry();
      const sshTunnelManager = createMockSSHTunnelManager();

      orchestrator = new Orchestrator({
        ...opts,
        configLoader,
        workerRegistry,
        sshTunnelManager,
      });

      await orchestrator.start();

      const tunnelCalls = sshTunnelManager.createTunnel.mock.calls;
      assert.equal(tunnelCalls.length, 1);
      assert.equal(tunnelCalls[0].arguments[0].workerId, 'gpu-server');
      assert.equal(tunnelCalls[0].arguments[0].host, '192.168.1.100');
      assert.equal(tunnelCalls[0].arguments[0].username, 'deploy');
    });

    test('handles SSH tunnel failure gracefully', async () => {
      const mainConfig = createMainConfig({
        workers: [
          {
            id: 'gpu-server',
            type: 'remote',
            host: '192.168.1.100',
            user: 'deploy',
            keyPath: '~/.ssh/id_rsa',
          },
        ],
      });

      const configLoader = createMockConfigLoader({ mainConfig });
      const workerRegistry = createMockWorkerRegistry();
      const sshTunnelManager = createMockSSHTunnelManager({
        createTunnel: mock.fn(async () => {
          throw new Error('Connection refused');
        }),
      });

      orchestrator = new Orchestrator({
        ...opts,
        configLoader,
        workerRegistry,
        sshTunnelManager,
      });

      // Should NOT throw — tunnel failure is non-fatal
      await orchestrator.start();
      assert.equal(orchestrator.state, ORCHESTRATOR_STATES.RUNNING);
    });

    test('handles worker registration failure gracefully', async () => {
      const mainConfig = createMainConfig({
        workers: [{ id: 'bad-worker', type: 'local', host: 'localhost' }],
      });

      const configLoader = createMockConfigLoader({ mainConfig });
      const workerRegistry = createMockWorkerRegistry({
        registerWorker: mock.fn(async () => {
          throw new Error('DB connection failed');
        }),
        getWorker: mock.fn(async () => null),
      });

      orchestrator = new Orchestrator({
        ...opts,
        configLoader,
        workerRegistry,
      });

      // Should NOT throw — worker registration failure is non-fatal
      await orchestrator.start();
      assert.equal(orchestrator.state, ORCHESTRATOR_STATES.RUNNING);
    });

    test('loads workers from workers.nodes when config is an object', async () => {
      const mainConfig = createMainConfig({
        workers: {
          nodes: [{ id: 'obj-local', type: 'local', host: 'localhost', maxContainers: 5 }],
          assignmentRules: [{ pattern: 'ml-*', workerId: 'gpu-server' }],
        },
      });

      const configLoader = createMockConfigLoader({ mainConfig });
      const workerRegistry = createMockWorkerRegistry();

      orchestrator = new Orchestrator({
        ...opts,
        configLoader,
        workerRegistry,
      });

      await orchestrator.start();

      const registerCalls = workerRegistry.registerWorker.mock.calls;
      assert.ok(
        registerCalls.some(c => c.arguments[0].id === 'obj-local'),
        'Should register worker from workers.nodes'
      );
    });
  });

  // ===========================================================================
  // Worker System Shutdown
  // ===========================================================================

  describe('stop() - worker shutdown', () => {
    test('closes SSH tunnels during shutdown', async () => {
      const sshTunnelManager = createMockSSHTunnelManager();
      orchestrator = new Orchestrator({
        ...opts,
        sshTunnelManager,
      });

      await orchestrator.start();
      await orchestrator.stop();

      assert.equal(sshTunnelManager.closeAll.mock.calls.length, 1);
    });

    test('handles SSH tunnel close errors during shutdown', async () => {
      const sshTunnelManager = createMockSSHTunnelManager({
        closeAll: mock.fn(async () => {
          throw new Error('Tunnel close failed');
        }),
      });

      orchestrator = new Orchestrator({
        ...opts,
        sshTunnelManager,
      });

      await orchestrator.start();

      // Should not throw - tunnel close errors are non-fatal during shutdown
      await orchestrator.stop();
      assert.equal(orchestrator.state, ORCHESTRATOR_STATES.STOPPED);
    });
  });

  // ===========================================================================
  // getStatus() - Worker Status
  // ===========================================================================

  describe('getStatus() - worker status', () => {
    test('includes worker status fields', async () => {
      const workerRegistry = createMockWorkerRegistry();
      const workerAssigner = createMockWorkerAssigner();
      const sshTunnelManager = createMockSSHTunnelManager();

      orchestrator = new Orchestrator({
        ...opts,
        workerRegistry,
        workerAssigner,
        sshTunnelManager,
      });

      await orchestrator.start();

      const status = orchestrator.getStatus();
      assert.equal(status.workerRegistryReady, true);
      assert.equal(status.workerAssignerReady, true);
      assert.equal(status.sshTunnelManagerReady, true);
    });

    test('reports false when worker components not initialized', () => {
      const status = orchestrator.getStatus();
      assert.equal(status.workerRegistryReady, false);
      assert.equal(status.workerAssignerReady, false);
      assert.equal(status.sshTunnelManagerReady, false);
    });
  });
});
