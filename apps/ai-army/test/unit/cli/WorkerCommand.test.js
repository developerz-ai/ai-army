/**
 * Unit tests for WorkerCommand
 *
 * Tests all worker subcommands: list, status, stop, start, update.
 * Uses mock WorkerRegistry and ContainerPool via dependency injection.
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { runWorker, WorkerCommandError } from '../../../src/cli/WorkerCommand.js';

/**
 * Create a mock WorkerRegistry for testing
 * @returns {Object} Mock WorkerRegistry with in-memory Map storage
 */
function createMockWorkerRegistry() {
  const workers = new Map();

  return {
    workers,
    listWorkers: mock.fn(async () => [...workers.values()]),
    getWorker: mock.fn(async id => workers.get(id) || null),
    updateWorkerStatus: mock.fn(async (id, status) => {
      const worker = workers.get(id);
      if (!worker) return null;
      worker.status = status;
      return worker;
    }),
    updateHeartbeat: mock.fn(async id => {
      const worker = workers.get(id);
      if (!worker) return null;
      worker.lastHeartbeat = new Date();
      return worker;
    }),
  };
}

/**
 * Create a mock ContainerPool for testing
 * @param {Object} [options={}] - Options
 * @param {Array<string>} [options.botIds=[]] - Bot IDs in the pool
 * @param {boolean} [options.recycleShouldFail=false] - Whether recycleContainer should fail
 * @param {boolean} [options.initShouldFail=false] - Whether initializeContainer should fail
 * @returns {Object} Mock ContainerPool
 */
function createMockContainerPool(options = {}) {
  const { botIds = [], recycleShouldFail = false, initShouldFail = false } = options;
  const configs = new Map();
  const workspaces = new Map();

  // Seed configs and workspaces for each botId
  for (const botId of botIds) {
    configs.set(botId, {
      id: botId,
      sandbox: { image: 'node:20-slim', memory: '512m' },
    });
    workspaces.set(botId, { root: `/workspace/${botId}` });
  }

  return {
    botConfigs: configs,
    workspaces,
    getBotIds: mock.fn(() => [...botIds]),
    recycleContainer: mock.fn(async _botId => {
      if (recycleShouldFail) {
        throw new Error('Failed to recycle container');
      }
    }),
    initializeContainer: mock.fn(async (_botId, _config, _workspace) => {
      if (initShouldFail) {
        throw new Error('Failed to initialize container');
      }
      return { id: `container-${_botId}` };
    }),
  };
}

/**
 * Create a mock writable output stream
 * @returns {Object} Mock output with write() and captured lines
 */
function createMockOutput() {
  const lines = [];
  return {
    lines,
    write: mock.fn(msg => {
      lines.push(msg);
      return true;
    }),
  };
}

describe('WorkerCommand', () => {
  let mockRegistry;
  let mockOutput;

  beforeEach(() => {
    mockRegistry = createMockWorkerRegistry();
    mockOutput = createMockOutput();
  });

  // ============================================================================
  // list subcommand
  // ============================================================================

  describe('list', () => {
    test('lists all workers', async () => {
      mockRegistry.workers.set('local', {
        id: 'local',
        host: 'localhost',
        type: 'local',
        status: 'healthy',
        currentLoad: 1,
        maxContainers: 5,
      });
      mockRegistry.workers.set('gpu-server', {
        id: 'gpu-server',
        host: '10.0.0.50',
        type: 'remote',
        status: 'healthy',
        currentLoad: 3,
        maxContainers: 20,
      });

      const result = await runWorker('list', {
        output: mockOutput,
        workerRegistry: mockRegistry,
      });

      assert.equal(result.success, true);
      assert.equal(result.workers.length, 2);
    });

    test('formats output as table with headers', async () => {
      mockRegistry.workers.set('gpu-server', {
        id: 'gpu-server',
        host: '10.0.0.50',
        type: 'remote',
        status: 'healthy',
        currentLoad: 3,
        maxContainers: 20,
      });

      await runWorker('list', {
        output: mockOutput,
        workerRegistry: mockRegistry,
      });

      const output = mockOutput.lines.join('');
      assert.match(output, /ID/);
      assert.match(output, /HOST/);
      assert.match(output, /TYPE/);
      assert.match(output, /STATUS/);
      assert.match(output, /LOAD/);
      assert.match(output, /gpu-server/);
      assert.match(output, /10\.0\.0\.50/);
      assert.match(output, /3\/20/);
      assert.match(output, /Total: 1 worker/);
    });

    test('shows message when no workers found', async () => {
      const result = await runWorker('list', {
        output: mockOutput,
        workerRegistry: mockRegistry,
      });

      assert.equal(result.success, true);
      assert.equal(result.workers.length, 0);

      const output = mockOutput.lines.join('');
      assert.match(output, /No workers registered/);
    });

    test('shows separator line in table', async () => {
      mockRegistry.workers.set('srv-1', {
        id: 'srv-1',
        host: '10.0.0.1',
        type: 'remote',
        status: 'healthy',
        currentLoad: 0,
        maxContainers: 10,
      });

      await runWorker('list', {
        output: mockOutput,
        workerRegistry: mockRegistry,
      });

      const output = mockOutput.lines.join('');
      assert.match(output, /---/);
    });
  });

  // ============================================================================
  // status subcommand
  // ============================================================================

  describe('status', () => {
    test('shows detailed status for a worker', async () => {
      mockRegistry.workers.set('gpu-server', {
        id: 'gpu-server',
        host: '10.0.0.50',
        type: 'remote',
        status: 'healthy',
        currentLoad: 3,
        maxContainers: 20,
        lastHeartbeat: new Date(),
        createdAt: new Date('2025-01-01T00:00:00Z'),
      });

      const result = await runWorker('status', {
        workerId: 'gpu-server',
        output: mockOutput,
        workerRegistry: mockRegistry,
      });

      assert.equal(result.success, true);
      assert.ok(result.worker);
      assert.equal(result.worker.id, 'gpu-server');
    });

    test('shows worker details in output', async () => {
      mockRegistry.workers.set('gpu-server', {
        id: 'gpu-server',
        host: '10.0.0.50',
        type: 'remote',
        status: 'healthy',
        currentLoad: 3,
        maxContainers: 20,
        lastHeartbeat: new Date(),
        createdAt: new Date('2025-01-01T00:00:00Z'),
      });

      await runWorker('status', {
        workerId: 'gpu-server',
        output: mockOutput,
        workerRegistry: mockRegistry,
      });

      const output = mockOutput.lines.join('');
      assert.match(output, /Worker: gpu-server/);
      assert.match(output, /Host:.*10\.0\.0\.50/);
      assert.match(output, /Type:.*remote/);
      assert.match(output, /Status:.*healthy/);
      assert.match(output, /Load:.*3\/20/);
      assert.match(output, /Available:.*17 slot/);
      assert.match(output, /Last heartbeat:.*\d+s ago/);
      assert.match(output, /Created:/);
    });

    test('shows "never" for missing heartbeat', async () => {
      mockRegistry.workers.set('new-worker', {
        id: 'new-worker',
        host: '10.0.0.1',
        type: 'remote',
        status: 'offline',
        currentLoad: 0,
        maxContainers: 10,
        lastHeartbeat: null,
        createdAt: null,
      });

      await runWorker('status', {
        workerId: 'new-worker',
        output: mockOutput,
        workerRegistry: mockRegistry,
      });

      const output = mockOutput.lines.join('');
      assert.match(output, /Last heartbeat: never/);
    });

    test('shows container info when containerPool is provided', async () => {
      mockRegistry.workers.set('local', {
        id: 'local',
        host: 'localhost',
        type: 'local',
        status: 'healthy',
        currentLoad: 2,
        maxContainers: 5,
        lastHeartbeat: new Date(),
        createdAt: new Date(),
      });

      const mockPool = createMockContainerPool({ botIds: ['bot-a', 'bot-b'] });

      await runWorker('status', {
        workerId: 'local',
        output: mockOutput,
        workerRegistry: mockRegistry,
        containerPool: mockPool,
      });

      const output = mockOutput.lines.join('');
      assert.match(output, /Containers:.*bot-a, bot-b/);
    });

    test('shows "none" for containers when pool has no bots', async () => {
      mockRegistry.workers.set('local', {
        id: 'local',
        host: 'localhost',
        type: 'local',
        status: 'healthy',
        currentLoad: 0,
        maxContainers: 5,
        lastHeartbeat: new Date(),
        createdAt: new Date(),
      });

      const mockPool = createMockContainerPool({ botIds: [] });

      await runWorker('status', {
        workerId: 'local',
        output: mockOutput,
        workerRegistry: mockRegistry,
        containerPool: mockPool,
      });

      const output = mockOutput.lines.join('');
      assert.match(output, /Containers:.*none/);
    });

    test('returns failure when worker not found', async () => {
      const result = await runWorker('status', {
        workerId: 'non-existent',
        output: mockOutput,
        workerRegistry: mockRegistry,
      });

      assert.equal(result.success, false);

      const output = mockOutput.lines.join('');
      assert.match(output, /not found/);
    });

    test('throws when workerId is missing', async () => {
      await assert.rejects(
        () =>
          runWorker('status', {
            output: mockOutput,
            workerRegistry: mockRegistry,
          }),
        err => {
          assert.equal(err.name, 'WorkerCommandError');
          assert.match(err.message, /Worker ID is required/);
          assert.equal(err.operation, 'status');
          return true;
        }
      );
    });
  });

  // ============================================================================
  // stop subcommand
  // ============================================================================

  describe('stop', () => {
    test('stops a healthy worker by marking it offline', async () => {
      mockRegistry.workers.set('gpu-server', {
        id: 'gpu-server',
        host: '10.0.0.50',
        type: 'remote',
        status: 'healthy',
        currentLoad: 0,
        maxContainers: 20,
      });

      const result = await runWorker('stop', {
        workerId: 'gpu-server',
        output: mockOutput,
        workerRegistry: mockRegistry,
      });

      assert.equal(result.success, true);
      assert.equal(mockRegistry.updateWorkerStatus.mock.calls.length, 1);
      assert.equal(mockRegistry.updateWorkerStatus.mock.calls[0].arguments[1], 'offline');
    });

    test('writes success message on stop', async () => {
      mockRegistry.workers.set('gpu-server', {
        id: 'gpu-server',
        host: '10.0.0.50',
        type: 'remote',
        status: 'healthy',
        currentLoad: 0,
        maxContainers: 20,
      });

      await runWorker('stop', {
        workerId: 'gpu-server',
        output: mockOutput,
        workerRegistry: mockRegistry,
      });

      const output = mockOutput.lines.join('');
      assert.match(output, /stopped.*marked offline/);
    });

    test('warns about active containers when stopping', async () => {
      mockRegistry.workers.set('busy-server', {
        id: 'busy-server',
        host: '10.0.0.51',
        type: 'remote',
        status: 'healthy',
        currentLoad: 3,
        maxContainers: 20,
      });

      await runWorker('stop', {
        workerId: 'busy-server',
        output: mockOutput,
        workerRegistry: mockRegistry,
      });

      const output = mockOutput.lines.join('');
      assert.match(output, /3 active container/);
      assert.match(output, /failover/);
    });

    test('handles already-offline worker gracefully', async () => {
      mockRegistry.workers.set('offline-srv', {
        id: 'offline-srv',
        host: '10.0.0.99',
        type: 'remote',
        status: 'offline',
        currentLoad: 0,
        maxContainers: 10,
      });

      const result = await runWorker('stop', {
        workerId: 'offline-srv',
        output: mockOutput,
        workerRegistry: mockRegistry,
      });

      assert.equal(result.success, true);
      // Should NOT call updateWorkerStatus when already offline
      assert.equal(mockRegistry.updateWorkerStatus.mock.calls.length, 0);

      const output = mockOutput.lines.join('');
      assert.match(output, /already offline/);
    });

    test('returns failure when worker not found', async () => {
      const result = await runWorker('stop', {
        workerId: 'non-existent',
        output: mockOutput,
        workerRegistry: mockRegistry,
      });

      assert.equal(result.success, false);
    });

    test('throws when workerId is missing', async () => {
      await assert.rejects(
        () =>
          runWorker('stop', {
            output: mockOutput,
            workerRegistry: mockRegistry,
          }),
        err => {
          assert.equal(err.name, 'WorkerCommandError');
          assert.match(err.message, /Worker ID is required/);
          assert.equal(err.operation, 'stop');
          return true;
        }
      );
    });

    test('throws when updateWorkerStatus fails', async () => {
      mockRegistry.workers.set('fail-srv', {
        id: 'fail-srv',
        host: '10.0.0.1',
        type: 'remote',
        status: 'healthy',
        currentLoad: 0,
        maxContainers: 10,
      });

      mockRegistry.updateWorkerStatus = mock.fn(async () => {
        throw new Error('Database connection lost');
      });

      await assert.rejects(
        () =>
          runWorker('stop', {
            workerId: 'fail-srv',
            output: mockOutput,
            workerRegistry: mockRegistry,
          }),
        err => {
          assert.equal(err.name, 'WorkerCommandError');
          assert.match(err.message, /Failed to stop worker/);
          assert.ok(err.cause);
          return true;
        }
      );
    });
  });

  // ============================================================================
  // start subcommand
  // ============================================================================

  describe('start', () => {
    test('starts an offline worker by marking it healthy', async () => {
      mockRegistry.workers.set('gpu-server', {
        id: 'gpu-server',
        host: '10.0.0.50',
        type: 'remote',
        status: 'offline',
        currentLoad: 0,
        maxContainers: 20,
      });

      const result = await runWorker('start', {
        workerId: 'gpu-server',
        output: mockOutput,
        workerRegistry: mockRegistry,
      });

      assert.equal(result.success, true);
      assert.equal(mockRegistry.updateWorkerStatus.mock.calls.length, 1);
      assert.equal(mockRegistry.updateWorkerStatus.mock.calls[0].arguments[1], 'healthy');
    });

    test('updates heartbeat when starting a worker', async () => {
      mockRegistry.workers.set('gpu-server', {
        id: 'gpu-server',
        host: '10.0.0.50',
        type: 'remote',
        status: 'offline',
        currentLoad: 0,
        maxContainers: 20,
      });

      await runWorker('start', {
        workerId: 'gpu-server',
        output: mockOutput,
        workerRegistry: mockRegistry,
      });

      assert.equal(mockRegistry.updateHeartbeat.mock.calls.length, 1);
      assert.equal(mockRegistry.updateHeartbeat.mock.calls[0].arguments[0], 'gpu-server');
    });

    test('writes success message on start', async () => {
      mockRegistry.workers.set('gpu-server', {
        id: 'gpu-server',
        host: '10.0.0.50',
        type: 'remote',
        status: 'offline',
        currentLoad: 0,
        maxContainers: 20,
      });

      await runWorker('start', {
        workerId: 'gpu-server',
        output: mockOutput,
        workerRegistry: mockRegistry,
      });

      const output = mockOutput.lines.join('');
      assert.match(output, /started.*marked healthy/);
    });

    test('handles already-healthy worker gracefully', async () => {
      mockRegistry.workers.set('healthy-srv', {
        id: 'healthy-srv',
        host: '10.0.0.1',
        type: 'local',
        status: 'healthy',
        currentLoad: 0,
        maxContainers: 5,
      });

      const result = await runWorker('start', {
        workerId: 'healthy-srv',
        output: mockOutput,
        workerRegistry: mockRegistry,
      });

      assert.equal(result.success, true);
      // Should NOT call updateWorkerStatus when already healthy
      assert.equal(mockRegistry.updateWorkerStatus.mock.calls.length, 0);

      const output = mockOutput.lines.join('');
      assert.match(output, /already healthy/);
    });

    test('starts a degraded worker', async () => {
      mockRegistry.workers.set('degraded-srv', {
        id: 'degraded-srv',
        host: '10.0.0.2',
        type: 'remote',
        status: 'degraded',
        currentLoad: 1,
        maxContainers: 10,
      });

      const result = await runWorker('start', {
        workerId: 'degraded-srv',
        output: mockOutput,
        workerRegistry: mockRegistry,
      });

      assert.equal(result.success, true);
      assert.equal(mockRegistry.updateWorkerStatus.mock.calls.length, 1);
      assert.equal(mockRegistry.updateWorkerStatus.mock.calls[0].arguments[1], 'healthy');
    });

    test('returns failure when worker not found', async () => {
      const result = await runWorker('start', {
        workerId: 'non-existent',
        output: mockOutput,
        workerRegistry: mockRegistry,
      });

      assert.equal(result.success, false);
    });

    test('throws when workerId is missing', async () => {
      await assert.rejects(
        () =>
          runWorker('start', {
            output: mockOutput,
            workerRegistry: mockRegistry,
          }),
        err => {
          assert.equal(err.name, 'WorkerCommandError');
          assert.match(err.message, /Worker ID is required/);
          assert.equal(err.operation, 'start');
          return true;
        }
      );
    });

    test('throws when updateWorkerStatus fails', async () => {
      mockRegistry.workers.set('fail-srv', {
        id: 'fail-srv',
        host: '10.0.0.1',
        type: 'remote',
        status: 'offline',
        currentLoad: 0,
        maxContainers: 10,
      });

      mockRegistry.updateWorkerStatus = mock.fn(async () => {
        throw new Error('Database connection lost');
      });

      await assert.rejects(
        () =>
          runWorker('start', {
            workerId: 'fail-srv',
            output: mockOutput,
            workerRegistry: mockRegistry,
          }),
        err => {
          assert.equal(err.name, 'WorkerCommandError');
          assert.match(err.message, /Failed to start worker/);
          assert.ok(err.cause);
          return true;
        }
      );
    });
  });

  // ============================================================================
  // update subcommand
  // ============================================================================

  describe('update', () => {
    test('updates containers with new image', async () => {
      mockRegistry.workers.set('gpu-server', {
        id: 'gpu-server',
        host: '10.0.0.50',
        type: 'remote',
        status: 'healthy',
        currentLoad: 2,
        maxContainers: 20,
      });

      const mockPool = createMockContainerPool({ botIds: ['bot-a', 'bot-b'] });

      const result = await runWorker('update', {
        workerId: 'gpu-server',
        image: 'node:22-slim',
        output: mockOutput,
        workerRegistry: mockRegistry,
        containerPool: mockPool,
      });

      assert.equal(result.success, true);
      assert.equal(result.image, 'node:22-slim');
      assert.deepEqual(result.updated, ['bot-a', 'bot-b']);
      assert.deepEqual(result.failed, []);
    });

    test('recycles and recreates each container', async () => {
      mockRegistry.workers.set('gpu-server', {
        id: 'gpu-server',
        host: '10.0.0.50',
        type: 'remote',
        status: 'healthy',
        currentLoad: 1,
        maxContainers: 20,
      });

      const mockPool = createMockContainerPool({ botIds: ['bot-a'] });

      await runWorker('update', {
        workerId: 'gpu-server',
        image: 'node:22-slim',
        output: mockOutput,
        workerRegistry: mockRegistry,
        containerPool: mockPool,
      });

      assert.equal(mockPool.recycleContainer.mock.calls.length, 1);
      assert.equal(mockPool.recycleContainer.mock.calls[0].arguments[0], 'bot-a');
      assert.equal(mockPool.initializeContainer.mock.calls.length, 1);

      // Verify new image is passed in the config
      const initConfig = mockPool.initializeContainer.mock.calls[0].arguments[1];
      assert.equal(initConfig.sandbox.image, 'node:22-slim');
    });

    test('preserves workspace volume during update', async () => {
      mockRegistry.workers.set('gpu-server', {
        id: 'gpu-server',
        host: '10.0.0.50',
        type: 'remote',
        status: 'healthy',
        currentLoad: 1,
        maxContainers: 20,
      });

      const mockPool = createMockContainerPool({ botIds: ['bot-a'] });

      await runWorker('update', {
        workerId: 'gpu-server',
        image: 'node:22-slim',
        output: mockOutput,
        workerRegistry: mockRegistry,
        containerPool: mockPool,
      });

      // Verify workspace is passed through from the original config
      const workspace = mockPool.initializeContainer.mock.calls[0].arguments[2];
      assert.deepEqual(workspace, { root: '/workspace/bot-a' });
    });

    test('handles no containers to update', async () => {
      mockRegistry.workers.set('empty-srv', {
        id: 'empty-srv',
        host: '10.0.0.1',
        type: 'remote',
        status: 'healthy',
        currentLoad: 0,
        maxContainers: 10,
      });

      const mockPool = createMockContainerPool({ botIds: [] });

      const result = await runWorker('update', {
        workerId: 'empty-srv',
        image: 'node:22-slim',
        output: mockOutput,
        workerRegistry: mockRegistry,
        containerPool: mockPool,
      });

      assert.equal(result.success, true);
      assert.deepEqual(result.updated, []);
      assert.deepEqual(result.failed, []);

      const output = mockOutput.lines.join('');
      assert.match(output, /No containers to update/);
    });

    test('reports partial failures', async () => {
      mockRegistry.workers.set('gpu-server', {
        id: 'gpu-server',
        host: '10.0.0.50',
        type: 'remote',
        status: 'healthy',
        currentLoad: 2,
        maxContainers: 20,
      });

      // First bot succeeds, second bot fails on init
      let initCallCount = 0;
      const mockPool = createMockContainerPool({ botIds: ['bot-a', 'bot-b'] });
      mockPool.initializeContainer = mock.fn(async () => {
        initCallCount++;
        if (initCallCount === 2) {
          throw new Error('Image pull failed');
        }
        return { id: 'new-container' };
      });

      const result = await runWorker('update', {
        workerId: 'gpu-server',
        image: 'bad-image:latest',
        output: mockOutput,
        workerRegistry: mockRegistry,
        containerPool: mockPool,
      });

      assert.equal(result.success, false);
      assert.equal(result.updated.length, 1);
      assert.equal(result.failed.length, 1);
      assert.equal(result.failed[0].botId, 'bot-b');

      const output = mockOutput.lines.join('');
      assert.match(output, /partially updated/);
      assert.match(output, /1 succeeded/);
      assert.match(output, /1 failed/);
    });

    test('skips bots with missing config/workspace', async () => {
      mockRegistry.workers.set('gpu-server', {
        id: 'gpu-server',
        host: '10.0.0.50',
        type: 'remote',
        status: 'healthy',
        currentLoad: 1,
        maxContainers: 20,
      });

      const mockPool = createMockContainerPool({ botIds: ['bot-a'] });
      // Clear configs to simulate missing config
      mockPool.botConfigs.clear();

      const result = await runWorker('update', {
        workerId: 'gpu-server',
        image: 'node:22-slim',
        output: mockOutput,
        workerRegistry: mockRegistry,
        containerPool: mockPool,
      });

      assert.equal(result.success, false);
      assert.equal(result.failed.length, 1);
      assert.match(result.failed[0].error, /Missing config/);

      const output = mockOutput.lines.join('');
      assert.match(output, /Skipped/);
    });

    test('writes progress output during update', async () => {
      mockRegistry.workers.set('gpu-server', {
        id: 'gpu-server',
        host: '10.0.0.50',
        type: 'remote',
        status: 'healthy',
        currentLoad: 1,
        maxContainers: 20,
      });

      const mockPool = createMockContainerPool({ botIds: ['bot-a'] });

      await runWorker('update', {
        workerId: 'gpu-server',
        image: 'node:22-slim',
        output: mockOutput,
        workerRegistry: mockRegistry,
        containerPool: mockPool,
      });

      const output = mockOutput.lines.join('');
      assert.match(output, /Updating worker 'gpu-server'/);
      assert.match(output, /node:22-slim/);
      assert.match(output, /Found 1 container/);
      assert.match(output, /Updating container for bot 'bot-a'/);
      assert.match(output, /Stopped old container/);
      assert.match(output, /Started new container/);
      assert.match(output, /1 container\(s\) migrated/);
    });

    test('returns failure when worker not found', async () => {
      const mockPool = createMockContainerPool();

      const result = await runWorker('update', {
        workerId: 'non-existent',
        image: 'node:22-slim',
        output: mockOutput,
        workerRegistry: mockRegistry,
        containerPool: mockPool,
      });

      assert.equal(result.success, false);
    });

    test('throws when workerId is missing', async () => {
      await assert.rejects(
        () =>
          runWorker('update', {
            image: 'node:22-slim',
            output: mockOutput,
            workerRegistry: mockRegistry,
          }),
        err => {
          assert.equal(err.name, 'WorkerCommandError');
          assert.match(err.message, /Worker ID is required/);
          assert.equal(err.operation, 'update');
          return true;
        }
      );
    });

    test('throws when image is missing', async () => {
      await assert.rejects(
        () =>
          runWorker('update', {
            workerId: 'gpu-server',
            output: mockOutput,
            workerRegistry: mockRegistry,
          }),
        err => {
          assert.equal(err.name, 'WorkerCommandError');
          assert.match(err.message, /Image is required/);
          assert.equal(err.operation, 'update');
          return true;
        }
      );
    });

    test('throws when containerPool is not provided', async () => {
      mockRegistry.workers.set('gpu-server', {
        id: 'gpu-server',
        host: '10.0.0.50',
        type: 'remote',
        status: 'healthy',
        currentLoad: 0,
        maxContainers: 20,
      });

      await assert.rejects(
        () =>
          runWorker('update', {
            workerId: 'gpu-server',
            image: 'node:22-slim',
            output: mockOutput,
            workerRegistry: mockRegistry,
          }),
        err => {
          assert.equal(err.name, 'WorkerCommandError');
          assert.match(err.message, /ContainerPool is required/);
          return true;
        }
      );
    });
  });

  // ============================================================================
  // unknown subcommand
  // ============================================================================

  describe('unknown command', () => {
    test('throws for unknown subcommand', async () => {
      await assert.rejects(
        () =>
          runWorker('deploy', {
            output: mockOutput,
            workerRegistry: mockRegistry,
          }),
        err => {
          assert.equal(err.name, 'WorkerCommandError');
          assert.match(err.message, /Unknown worker command/);
          assert.match(err.message, /deploy/);
          return true;
        }
      );
    });

    test('lists valid commands in error message', async () => {
      await assert.rejects(
        () =>
          runWorker('invalid', {
            output: mockOutput,
            workerRegistry: mockRegistry,
          }),
        err => {
          assert.match(err.message, /list/);
          assert.match(err.message, /status/);
          assert.match(err.message, /stop/);
          assert.match(err.message, /start/);
          assert.match(err.message, /update/);
          return true;
        }
      );
    });
  });

  // ============================================================================
  // runWorker with injected deps
  // ============================================================================

  describe('runWorker with injected deps', () => {
    test('uses injected workerRegistry', async () => {
      mockRegistry.workers.set('test-srv', {
        id: 'test-srv',
        host: '10.0.0.1',
        type: 'remote',
        status: 'healthy',
        currentLoad: 0,
        maxContainers: 10,
      });

      const result = await runWorker('list', {
        output: mockOutput,
        workerRegistry: mockRegistry,
      });

      assert.equal(result.success, true);
      assert.equal(result.workers.length, 1);
    });

    test('defaults to process.stdout when no output provided', () => {
      assert.equal(typeof runWorker, 'function');
    });
  });
});

// =============================================================================
// WorkerCommandError
// =============================================================================

describe('WorkerCommandError', () => {
  test('is an instance of Error', () => {
    const error = new WorkerCommandError('Test error');
    assert.ok(error instanceof Error);
  });

  test('has correct name', () => {
    const error = new WorkerCommandError('Test error');
    assert.equal(error.name, 'WorkerCommandError');
  });

  test('stores operation', () => {
    const error = new WorkerCommandError('Test', { operation: 'stop' });
    assert.equal(error.operation, 'stop');
  });

  test('stores workerId', () => {
    const error = new WorkerCommandError('Test', { workerId: 'gpu-server' });
    assert.equal(error.workerId, 'gpu-server');
  });

  test('stores cause', () => {
    const cause = new Error('Original');
    const error = new WorkerCommandError('Test', { cause });
    assert.equal(error.cause, cause);
  });

  test('has correct message', () => {
    const error = new WorkerCommandError('Something went wrong');
    assert.equal(error.message, 'Something went wrong');
  });
});
