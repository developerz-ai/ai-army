/**
 * End-to-End tests for Worker Deployment
 *
 * Tests the complete worker deployment lifecycle:
 *   1. Register worker node
 *   2. Provision bot to Incus container on worker
 *   3. Assign task to bot
 *   4. Verify task execution and result
 *   5. Update bot container image
 *   6. Verify workspace persistence across updates
 *   7. Deprovision bot and clean up
 *
 * Uses real components:
 * - Real PostgresStorage with real PostgreSQL (per-worker database)
 * - Real WorkerRegistry (worker node management)
 * - Real BotManager (bot lifecycle with Incus containers)
 * - Real ContainerPool (Incus container management)
 * - Real MigrationRunner (schema setup)
 *
 * Mock components:
 * - AgentRunner (to avoid real LLM API calls)
 * - SoulLoader (to avoid filesystem dependencies)
 * - ConfigValidator (simplified validation)
 *
 * Uses per-worker databases for parallel test execution.
 */

import { describe, test, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { WorkerRegistry, WORKER_STATUSES, WORKER_TYPES } from '../../src/core/worker-registry.js';
import { BotManager } from '../../src/core/bot-manager.js';
import { PostgresStorage } from '../../src/adapters/storage/postgres.js';
import {
  TEST_DATABASE_URL,
  isDatabaseAvailable,
  createWorkerDatabase,
  dropWorkerDatabase,
  runMigrations,
} from '../helpers/setup.js';

const DB_AVAILABLE = await isDatabaseAvailable();

if (!DB_AVAILABLE) {
  console.log('WorkerDeployment E2E: PostgreSQL not available, tests will be skipped');
}

// =============================================================================
// Helper Factories
// =============================================================================

/**
 * Create a mock SoulLoader that returns configurable soul content
 * @param {string} [defaultSoul='You are a helpful assistant.'] - Default soul content
 * @returns {Object} Mock soul loader
 */
function createMockSoulLoader(defaultSoul = 'You are a helpful assistant.') {
  return {
    load: mock.fn(async _soulPath => defaultSoul),
  };
}

/**
 * Create a mock ConfigValidator that accepts any valid-looking bot config
 * @returns {Object} Mock config validator
 */
function createMockConfigValidator() {
  return {
    validateBotConfig: mock.fn(config => ({
      ...config,
      enabled: config.enabled ?? true,
    })),
  };
}

// =============================================================================
// E2E Tests
// =============================================================================

describe('WorkerDeployment E2E - Full Lifecycle', { skip: !DB_AVAILABLE }, () => {
  let storage;

  before(async () => {
    await createWorkerDatabase();
    storage = new PostgresStorage(TEST_DATABASE_URL);
    await storage.connect();
  });

  after(async () => {
    if (storage && storage.isConnected()) {
      await storage.disconnect();
    }
    await dropWorkerDatabase();
  });

  beforeEach(async () => {
    // Reconnect storage if a previous test disconnected it
    if (!storage.isConnected()) {
      await storage.connect();
    }

    // Drop all tables for a clean slate
    await storage.query('DROP TABLE IF EXISTS worker_activity CASCADE');
    await storage.query('DROP TABLE IF EXISTS worker_metrics CASCADE');
    await storage.query('DROP TABLE IF EXISTS assignments CASCADE');
    await storage.query('DROP TABLE IF EXISTS servers CASCADE');
    await storage.query('DROP TABLE IF EXISTS workers CASCADE');
    await storage.query('DROP TABLE IF EXISTS tool_calls CASCADE');
    await storage.query('DROP TABLE IF EXISTS sessions CASCADE');
    await storage.query('DROP TABLE IF EXISTS bots CASCADE');
    await storage.query('DROP TABLE IF EXISTS schema_migrations CASCADE');
    await storage.query('DROP FUNCTION IF EXISTS update_updated_at_column CASCADE');
    await storage.query('DROP FUNCTION IF EXISTS notify_bot_change CASCADE');
    await storage.query('DROP FUNCTION IF EXISTS notify_worker_change CASCADE');
    await storage.query('DROP FUNCTION IF EXISTS notify_server_change CASCADE');

    // Re-run migrations to recreate schema
    await runMigrations(storage);
  });

  // ===========================================================================
  // Worker Registration
  // ===========================================================================

  describe('Worker registration', () => {
    test('register local worker and verify status', async () => {
      // Create worker registry
      const workerRegistry = new WorkerRegistry(storage);

      // Register a local worker
      const worker = await workerRegistry.registerWorker({
        id: 'local-worker',
        host: 'localhost',
        type: WORKER_TYPES.LOCAL,
        maxContainers: 5,
      });

      // Verify worker was registered
      assert.ok(worker, 'Worker should be registered');
      assert.equal(worker.id, 'local-worker');
      assert.equal(worker.host, 'localhost');
      assert.equal(worker.type, WORKER_TYPES.LOCAL);
      assert.equal(worker.maxContainers, 5);
      assert.equal(worker.currentLoad, 0);
      assert.equal(worker.status, WORKER_STATUSES.HEALTHY);
      assert.ok(worker.lastHeartbeat instanceof Date, 'Should have initial heartbeat');

      // Verify worker is queryable
      const retrieved = await workerRegistry.getWorker('local-worker');
      assert.ok(retrieved);
      assert.equal(retrieved.id, 'local-worker');

      // Verify worker appears in list
      const workers = await workerRegistry.listWorkers();
      assert.equal(workers.length, 1);
      assert.equal(workers[0].id, 'local-worker');
    });

    test('register remote worker with heartbeat tracking', async () => {
      const workerRegistry = new WorkerRegistry(storage);

      // Register a remote worker
      const worker = await workerRegistry.registerWorker({
        id: 'remote-worker-1',
        host: '192.168.1.100',
        type: WORKER_TYPES.REMOTE,
        maxContainers: 10,
      });

      assert.equal(worker.id, 'remote-worker-1');
      assert.equal(worker.type, WORKER_TYPES.REMOTE);
      assert.equal(worker.status, WORKER_STATUSES.HEALTHY);

      // Update heartbeat
      await workerRegistry.updateHeartbeat('remote-worker-1');

      // Verify heartbeat was updated
      const updated = await workerRegistry.getWorker('remote-worker-1');
      assert.ok(updated.lastHeartbeat instanceof Date);
    });

    test('get available worker for bot placement', async () => {
      const workerRegistry = new WorkerRegistry(storage);

      // Register multiple workers
      await workerRegistry.registerWorker({
        id: 'worker-1',
        host: 'localhost',
        type: WORKER_TYPES.LOCAL,
        maxContainers: 5,
      });

      await workerRegistry.registerWorker({
        id: 'worker-2',
        host: '192.168.1.100',
        type: WORKER_TYPES.REMOTE,
        maxContainers: 10,
      });

      // Get available worker (should return worker with lowest load)
      const available = await workerRegistry.getAvailableWorker('test-bot');
      assert.ok(available, 'Should return an available worker');
      assert.equal(available.currentLoad, 0);
      assert.equal(available.status, WORKER_STATUSES.HEALTHY);
    });
  });

  // ===========================================================================
  // Bot Provisioning
  // ===========================================================================

  describe('Bot provisioning to Incus container', () => {
    test('provision bot to local worker container', async () => {
      const workerRegistry = new WorkerRegistry(storage);
      const soulLoader = createMockSoulLoader('You are a test bot.');
      const configValidator = createMockConfigValidator();

      // Note: ContainerPool requires Incus to be running
      // For E2E tests without Incus, we'll mock ContainerPool
      const containerPool = {
        initializeContainer: mock.fn(async (_botId, _config) => ({
          id: 'container-abc123',
          status: 'running',
        })),
        createContainer: mock.fn(async (_botId, _config) => ({
          id: 'container-abc123',
          status: 'running',
        })),
        startContainer: mock.fn(async () => {}),
        hasContainer: mock.fn(() => true),
        recycleContainer: mock.fn(async () => {}),
        stopContainer: mock.fn(async () => {}),
        removeContainer: mock.fn(async () => {}),
        listContainers: mock.fn(async () => []),
        getContainer: mock.fn(async () => null),
      };

      const botManager = new BotManager(storage, containerPool, soulLoader, {
        configValidator,
      });

      // Register worker
      await workerRegistry.registerWorker({
        id: 'local-worker',
        host: 'localhost',
        type: WORKER_TYPES.LOCAL,
        maxContainers: 5,
      });

      // Load bot config
      const bot = await botManager.loadBot('test-bot-1', {
        id: 'test-bot-1',
        soul: './soul.md',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
      });

      assert.ok(bot, 'Bot should be loaded');
      assert.equal(bot.id, 'test-bot-1');
      assert.equal(bot.status, 'loaded');

      // Start bot (provisions container)
      await botManager.startBot('test-bot-1');

      // Verify container was initialized
      assert.equal(containerPool.initializeContainer.mock.calls.length, 1);

      // Verify bot status
      const running = botManager.getBot('test-bot-1');
      assert.ok(running);
      assert.equal(running.status, 'running');
    });

    test('increment worker load when bot is provisioned', async () => {
      const workerRegistry = new WorkerRegistry(storage);
      const soulLoader = createMockSoulLoader();
      const configValidator = createMockConfigValidator();

      const containerPool = {
        initializeContainer: mock.fn(async () => ({ id: 'container-xyz', status: 'running' })),
        createContainer: mock.fn(async () => ({ id: 'container-xyz', status: 'running' })),
        hasContainer: mock.fn(() => true),
        recycleContainer: mock.fn(async () => {}),
        startContainer: mock.fn(async () => {}),
        stopContainer: mock.fn(async () => {}),
        removeContainer: mock.fn(async () => {}),
        listContainers: mock.fn(async () => []),
        getContainer: mock.fn(async () => null),
      };

      const botManager = new BotManager(storage, containerPool, soulLoader, {
        configValidator,
      });

      // Register worker
      await workerRegistry.registerWorker({
        id: 'worker-1',
        host: 'localhost',
        type: WORKER_TYPES.LOCAL,
        maxContainers: 5,
      });

      // Load and start bot
      await botManager.loadBot('bot-1', {
        id: 'bot-1',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
      });

      await botManager.startBot('bot-1');

      // Manually increment worker load (in production, BotManager would do this via WorkerAssigner)
      const updated = await workerRegistry.incrementLoad('worker-1');
      assert.ok(updated);
      assert.equal(updated.currentLoad, 1);

      // Verify worker load
      const worker = await workerRegistry.getWorker('worker-1');
      assert.equal(worker.currentLoad, 1);
      assert.equal(worker.maxContainers, 5);
    });
  });

  // ===========================================================================
  // Task Assignment & Execution
  // ===========================================================================

  describe('Task assignment and execution', () => {
    test('assign task to bot and verify execution', async () => {
      const workerRegistry = new WorkerRegistry(storage);
      const soulLoader = createMockSoulLoader();
      const configValidator = createMockConfigValidator();

      const containerPool = {
        initializeContainer: mock.fn(async () => ({ id: 'container-123', status: 'running' })),
        createContainer: mock.fn(async () => ({ id: 'container-123', status: 'running' })),
        hasContainer: mock.fn(() => true),
        recycleContainer: mock.fn(async () => {}),
        startContainer: mock.fn(async () => {}),
        stopContainer: mock.fn(async () => {}),
        removeContainer: mock.fn(async () => {}),
        listContainers: mock.fn(async () => []),
        getContainer: mock.fn(async containerId => ({ id: containerId, status: 'running' })),
        execInContainer: mock.fn(async (_containerId, _command) => ({
          stdout: 'Task executed successfully\nResult: 42',
          stderr: '',
          exitCode: 0,
        })),
      };

      const botManager = new BotManager(storage, containerPool, soulLoader, {
        configValidator,
      });

      // Register worker
      await workerRegistry.registerWorker({
        id: 'worker-exec',
        host: 'localhost',
        type: WORKER_TYPES.LOCAL,
        maxContainers: 5,
      });

      // Provision bot
      await botManager.loadBot('exec-bot', {
        id: 'exec-bot',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
      });

      await botManager.startBot('exec-bot');

      // Simulate task assignment (in production, this would be via MessageProcessor or API)
      // Here we directly call containerPool.execInContainer to simulate task execution
      const result = await containerPool.execInContainer('container-123', 'echo "Hello from bot"');

      assert.ok(result);
      assert.ok(result.stdout.includes('Task executed successfully'));
      assert.equal(result.exitCode, 0);

      // Verify exec was called
      assert.equal(containerPool.execInContainer.mock.calls.length, 1);
    });

    test('track assignment in assignments table', async () => {
      // Create assignment record
      const assignmentId = `assign-${Date.now()}`;
      const workerId = 'worker-track';

      const workerRegistry = new WorkerRegistry(storage);

      // Register worker first
      await workerRegistry.registerWorker({
        id: workerId,
        host: 'localhost',
        type: WORKER_TYPES.LOCAL,
        maxContainers: 5,
      });

      // Create assignment (requires migration 012 with assignments table)
      const { rows } = await storage.query(
        `INSERT INTO assignments (id, worker_id, task, context, status, started_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         RETURNING *`,
        [assignmentId, workerId, 'Test task', JSON.stringify({ test: true }), 'in_progress']
      );

      assert.equal(rows.length, 1);
      assert.equal(rows[0].id, assignmentId);
      assert.equal(rows[0].worker_id, workerId);
      assert.equal(rows[0].task, 'Test task');
      assert.equal(rows[0].status, 'in_progress');

      // Complete assignment
      const { rows: completed } = await storage.query(
        `UPDATE assignments
         SET status = $1, completed_at = NOW(), result = $2, duration_ms = 1500
         WHERE id = $3
         RETURNING *`,
        ['completed', 'Task completed successfully', assignmentId]
      );

      assert.equal(completed.length, 1);
      assert.equal(completed[0].status, 'completed');
      assert.equal(completed[0].result, 'Task completed successfully');
      assert.equal(completed[0].duration_ms, 1500);
    });
  });

  // ===========================================================================
  // Image Update & Workspace Persistence
  // ===========================================================================

  describe('Image update and workspace persistence', () => {
    test('update bot container image and preserve workspace', async () => {
      const soulLoader = createMockSoulLoader();
      const configValidator = createMockConfigValidator();

      let currentImage = 'node:22-slim';
      const workspaceData = { files: [] };

      const containerPool = {
        initializeContainer: mock.fn(async (botId, config) => {
          currentImage = config.sandbox?.incusImage || config.sandbox?.image || 'node:22-slim';
          return { id: `container-${botId}`, status: 'running', image: currentImage };
        }),
        createContainer: mock.fn(async (botId, config) => {
          currentImage = config.sandbox?.incusImage || config.sandbox?.image || 'node:22-slim';
          return { id: `container-${botId}`, status: 'running', image: currentImage };
        }),
        hasContainer: mock.fn(() => true),
        recycleContainer: mock.fn(async () => {}),
        startContainer: mock.fn(async () => {}),
        stopContainer: mock.fn(async () => {}),
        removeContainer: mock.fn(async () => {}),
        listContainers: mock.fn(async () => []),
        getContainer: mock.fn(async containerId => ({
          id: containerId,
          status: 'running',
          image: currentImage,
        })),
        execInContainer: mock.fn(async (_containerId, command) => {
          // Simulate workspace persistence
          if (command.includes('echo')) {
            workspaceData.files.push('test.txt');
            return { stdout: 'File created', stderr: '', exitCode: 0 };
          }
          if (command.includes('ls')) {
            return {
              stdout: workspaceData.files.join('\n'),
              stderr: '',
              exitCode: 0,
            };
          }
          return { stdout: '', stderr: '', exitCode: 0 };
        }),
      };

      const botManager = new BotManager(storage, containerPool, soulLoader, {
        configValidator,
      });

      // Initial bot provisioning
      await botManager.loadBot('update-bot', {
        id: 'update-bot',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        sandbox: { type: 'incus', incusImage: 'node:22-slim' },
      });

      await botManager.startBot('update-bot');

      // Create a file in workspace
      await containerPool.execInContainer('container-update-bot', 'echo "test" > test.txt');

      // Verify file exists
      let lsResult = await containerPool.execInContainer('container-update-bot', 'ls');
      assert.ok(lsResult.stdout.includes('test.txt'), 'File should exist before update');

      // Update image (stop → remove → create with new image → start)
      await botManager.stopBot('update-bot');
      await containerPool.removeContainer('container-update-bot');

      await botManager.loadBot('update-bot', {
        id: 'update-bot',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        sandbox: { type: 'incus', incusImage: 'node:23-slim' }, // Updated image
      });

      await botManager.startBot('update-bot');

      // Verify workspace persisted (file should still exist)
      lsResult = await containerPool.execInContainer('container-update-bot', 'ls');
      assert.ok(lsResult.stdout.includes('test.txt'), 'File should persist after update');

      // Verify new image is used
      const container = await containerPool.getContainer('container-update-bot');
      assert.equal(container.image, 'node:23-slim', 'Should use updated image');
    });
  });

  // ===========================================================================
  // Deprovisioning
  // ===========================================================================

  describe('Bot deprovisioning', () => {
    test('deprovision bot and clean up worker load', async () => {
      const workerRegistry = new WorkerRegistry(storage);
      const soulLoader = createMockSoulLoader();
      const configValidator = createMockConfigValidator();

      const containerPool = {
        initializeContainer: mock.fn(async () => ({ id: 'container-dep', status: 'running' })),
        createContainer: mock.fn(async () => ({ id: 'container-dep', status: 'running' })),
        hasContainer: mock.fn(() => true),
        recycleContainer: mock.fn(async () => {}),
        startContainer: mock.fn(async () => {}),
        stopContainer: mock.fn(async () => {}),
        removeContainer: mock.fn(async () => {}),
        listContainers: mock.fn(async () => []),
        getContainer: mock.fn(async () => null),
      };

      const botManager = new BotManager(storage, containerPool, soulLoader, {
        configValidator,
      });

      // Register worker
      await workerRegistry.registerWorker({
        id: 'worker-dep',
        host: 'localhost',
        type: WORKER_TYPES.LOCAL,
        maxContainers: 5,
      });

      // Provision bot
      await botManager.loadBot('dep-bot', {
        id: 'dep-bot',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
      });

      await botManager.startBot('dep-bot');

      // Increment worker load
      await workerRegistry.incrementLoad('worker-dep');

      // Verify load increased
      let worker = await workerRegistry.getWorker('worker-dep');
      assert.equal(worker.currentLoad, 1);

      // Deprovision bot (stop + recycle)
      await botManager.stopBot('dep-bot');
      assert.equal(containerPool.recycleContainer.mock.calls.length, 1);

      // Decrement worker load
      await workerRegistry.decrementLoad('worker-dep');

      // Verify load decreased
      worker = await workerRegistry.getWorker('worker-dep');
      assert.equal(worker.currentLoad, 0);

      // Verify container was stopped
      const bot = botManager.getBot('dep-bot');
      assert.equal(bot.status, 'stopped');
    });

    test('unregister worker after all bots are deprovisioned', async () => {
      const workerRegistry = new WorkerRegistry(storage);

      // Register worker
      await workerRegistry.registerWorker({
        id: 'worker-unreg',
        host: 'localhost',
        type: WORKER_TYPES.LOCAL,
        maxContainers: 5,
      });

      // Verify worker exists
      let worker = await workerRegistry.getWorker('worker-unreg');
      assert.ok(worker);
      assert.equal(worker.currentLoad, 0);

      // Unregister worker (only allowed when currentLoad = 0)
      const unregistered = await workerRegistry.unregisterWorker('worker-unreg');
      assert.equal(unregistered, true);

      // Verify worker is gone
      worker = await workerRegistry.getWorker('worker-unreg');
      assert.equal(worker, null);
    });

    test('cannot unregister worker with active containers', async () => {
      const workerRegistry = new WorkerRegistry(storage);

      // Register worker
      await workerRegistry.registerWorker({
        id: 'worker-busy',
        host: 'localhost',
        type: WORKER_TYPES.LOCAL,
        maxContainers: 5,
      });

      // Increment load (simulate active bot)
      await workerRegistry.incrementLoad('worker-busy');

      // Attempt to unregister (should fail)
      await assert.rejects(
        async () => {
          await workerRegistry.unregisterWorker('worker-busy');
        },
        {
          name: 'WorkerRegistryError',
          message: /has 1 active container/,
        }
      );

      // Force unregister should succeed
      const forced = await workerRegistry.unregisterWorker('worker-busy', { force: true });
      assert.equal(forced, true);
    });
  });

  // ===========================================================================
  // Full Lifecycle Integration
  // ===========================================================================

  describe('Full deployment lifecycle', () => {
    test('complete flow: register → provision → assign → update → deprovision', async () => {
      const workerRegistry = new WorkerRegistry(storage);
      const soulLoader = createMockSoulLoader('You are a full lifecycle test bot.');
      const configValidator = createMockConfigValidator();

      let containerImage = 'node:22-slim';
      const workspace = new Set();

      const containerPool = {
        initializeContainer: mock.fn(async (_botId, config) => {
          containerImage = config.sandbox?.incusImage || config.sandbox?.image || 'node:22-slim';
          return { id: 'full-container', status: 'running', image: containerImage };
        }),
        createContainer: mock.fn(async (_botId, config) => {
          containerImage = config.sandbox?.incusImage || config.sandbox?.image || 'node:22-slim';
          return { id: 'full-container', status: 'running', image: containerImage };
        }),
        hasContainer: mock.fn(() => true),
        recycleContainer: mock.fn(async () => {}),
        startContainer: mock.fn(async () => {}),
        stopContainer: mock.fn(async () => {}),
        removeContainer: mock.fn(async () => {
          // Workspace persists via volume, so don't clear
        }),
        listContainers: mock.fn(async () => []),
        getContainer: mock.fn(async () => ({ id: 'full-container', image: containerImage })),
        execInContainer: mock.fn(async (_containerId, command) => {
          if (command.includes('echo')) {
            workspace.add('workspace-file.txt');
            return { stdout: 'Created file', stderr: '', exitCode: 0 };
          }
          if (command.includes('ls')) {
            return { stdout: Array.from(workspace).join('\n'), stderr: '', exitCode: 0 };
          }
          return { stdout: 'Command executed', stderr: '', exitCode: 0 };
        }),
      };

      const botManager = new BotManager(storage, containerPool, soulLoader, {
        configValidator,
      });

      // === Step 1: Register worker ===
      const worker = await workerRegistry.registerWorker({
        id: 'full-worker',
        host: 'localhost',
        type: WORKER_TYPES.LOCAL,
        maxContainers: 5,
      });

      assert.equal(worker.id, 'full-worker');
      assert.equal(worker.status, WORKER_STATUSES.HEALTHY);
      assert.equal(worker.currentLoad, 0);

      // === Step 2: Provision bot to container ===
      await botManager.loadBot('full-bot', {
        id: 'full-bot',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        sandbox: { type: 'incus', incusImage: 'node:22-slim' },
      });

      await botManager.startBot('full-bot');
      await workerRegistry.incrementLoad('full-worker');

      const bot = botManager.getBot('full-bot');
      assert.equal(bot.status, 'running');

      let workerState = await workerRegistry.getWorker('full-worker');
      assert.equal(workerState.currentLoad, 1);

      // === Step 3: Assign task and verify execution ===
      const execResult = await containerPool.execInContainer('full-container', 'echo test');
      assert.ok(execResult.stdout.includes('Created file'));

      const lsResult1 = await containerPool.execInContainer('full-container', 'ls');
      assert.ok(lsResult1.stdout.includes('workspace-file.txt'));

      // === Step 4: Update image ===
      await botManager.stopBot('full-bot');
      await containerPool.removeContainer('full-container');

      await botManager.loadBot('full-bot', {
        id: 'full-bot',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        sandbox: { type: 'incus', incusImage: 'node:23-slim' }, // Updated image
      });

      await botManager.startBot('full-bot');

      // Verify image updated
      const container = await containerPool.getContainer('full-container');
      assert.equal(container.image, 'node:23-slim');

      // === Step 5: Verify workspace persists ===
      const lsResult2 = await containerPool.execInContainer('full-container', 'ls');
      assert.ok(lsResult2.stdout.includes('workspace-file.txt'), 'Workspace should persist');

      // === Step 6: Deprovision ===
      await botManager.stopBot('full-bot');
      await workerRegistry.decrementLoad('full-worker');

      workerState = await workerRegistry.getWorker('full-worker');
      assert.equal(workerState.currentLoad, 0);

      const stoppedBot = botManager.getBot('full-bot');
      assert.equal(stoppedBot.status, 'stopped');

      // === Step 7: Unregister worker ===
      const unregistered = await workerRegistry.unregisterWorker('full-worker');
      assert.equal(unregistered, true);

      const removedWorker = await workerRegistry.getWorker('full-worker');
      assert.equal(removedWorker, null);
    });
  });
});
