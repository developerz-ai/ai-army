/**
 * Unit tests for WorkerAssigner
 *
 * Tests bot-to-worker assignment with pattern matching, load balancing,
 * failover, rebalancing, and Docker host resolution.
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { WorkerAssigner } from '../../../src/core/worker-assigner.js';
import { WORKER_STATUSES, WORKER_TYPES } from '../../../src/core/worker-registry.js';

/**
 * Create a mock WorkerRegistry for testing
 * @param {Object} [overrides={}] - Override default mock implementations
 * @returns {Object} Mock WorkerRegistry
 */
function createMockWorkerRegistry(overrides = {}) {
  const workers = new Map();

  return {
    _workers: workers,
    getWorker: mock.fn(async workerId => {
      const row = workers.get(workerId);
      return row || null;
    }),
    listWorkers: mock.fn(async (filter = {}) => {
      const all = Array.from(workers.values());
      return all.filter(w => {
        if (filter.status && w.status !== filter.status) return false;
        if (filter.type && w.type !== filter.type) return false;
        return true;
      });
    }),
    incrementLoad: mock.fn(async workerId => {
      const row = workers.get(workerId);
      if (row && row.currentLoad < row.maxContainers) {
        row.currentLoad += 1;
        return row;
      }
      return null;
    }),
    decrementLoad: mock.fn(async workerId => {
      const row = workers.get(workerId);
      if (row && row.currentLoad > 0) {
        row.currentLoad -= 1;
        return row;
      }
      return null;
    }),
    ...overrides,
  };
}

/**
 * Create a worker object for the mock registry
 * @param {Object} [overrides={}] - Override default worker values
 * @returns {Object} Worker object
 */
function createWorker(overrides = {}) {
  return {
    id: 'worker-1',
    host: 'localhost',
    type: WORKER_TYPES.LOCAL,
    maxContainers: 10,
    currentLoad: 0,
    status: WORKER_STATUSES.HEALTHY,
    lastHeartbeat: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * Create a mock SSHTunnelManager for testing
 * @param {Object} [overrides={}] - Override default mock implementations
 * @returns {Object} Mock SSHTunnelManager
 */
function createMockSSHTunnelManager(overrides = {}) {
  const tunnels = new Map();
  const incusTunnels = new Map();

  return {
    _tunnels: tunnels,
    _incusTunnels: incusTunnels,
    getDockerHost: mock.fn(workerId => tunnels.get(workerId) || null),
    getIncusHost: mock.fn(workerId => incusTunnels.get(workerId) || null),
    ...overrides,
  };
}

/**
 * Create a silent logger to suppress test output
 * @returns {Object} Silent logger
 */
function createSilentLogger() {
  return {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
  };
}

describe('WorkerAssigner', () => {
  let registry;
  let logger;

  beforeEach(() => {
    registry = createMockWorkerRegistry();
    logger = createSilentLogger();
  });

  // ==========================================================================
  // Constructor
  // ==========================================================================

  describe('constructor', () => {
    test('creates instance with valid workerRegistry', () => {
      const assigner = new WorkerAssigner(registry, { logger });
      assert.ok(assigner);
      assert.equal(assigner.workerRegistry, registry);
    });

    test('throws when workerRegistry is not provided', () => {
      assert.throws(
        () => new WorkerAssigner(null),
        err => {
          assert.equal(err.name, 'WorkerAssignerError');
          assert.match(err.message, /WorkerRegistry is required/);
          return true;
        }
      );
    });

    test('stores assignment rules', () => {
      const rules = [{ pattern: 'devops-*', workerId: 'gpu-server' }];
      const assigner = new WorkerAssigner(registry, {
        assignmentRules: rules,
        logger,
      });
      assert.deepEqual(assigner.assignmentRules, rules);
    });

    test('stores sshTunnelManager', () => {
      const tunnel = createMockSSHTunnelManager();
      const assigner = new WorkerAssigner(registry, {
        sshTunnelManager: tunnel,
        logger,
      });
      assert.equal(assigner.sshTunnelManager, tunnel);
    });

    test('defaults to empty assignment rules', () => {
      const assigner = new WorkerAssigner(registry, { logger });
      assert.deepEqual(assigner.assignmentRules, []);
    });
  });

  // ==========================================================================
  // assignBot
  // ==========================================================================

  describe('assignBot', () => {
    test('assigns bot to least-loaded worker', async () => {
      const worker1 = createWorker({ id: 'w1', currentLoad: 5, maxContainers: 10 });
      const worker2 = createWorker({ id: 'w2', currentLoad: 2, maxContainers: 10 });
      registry._workers.set('w1', worker1);
      registry._workers.set('w2', worker2);

      const assigner = new WorkerAssigner(registry, { logger });
      const result = await assigner.assignBot('my-bot');

      assert.equal(result.workerId, 'w2');
      assert.equal(result.workerType, WORKER_TYPES.LOCAL);
      assert.equal(result.dockerHost, null); // Local worker
    });

    test('throws when botId is empty', async () => {
      const assigner = new WorkerAssigner(registry, { logger });

      await assert.rejects(
        () => assigner.assignBot(''),
        err => {
          assert.equal(err.name, 'WorkerAssignerError');
          assert.match(err.message, /Bot ID must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws when no workers are available', async () => {
      const assigner = new WorkerAssigner(registry, { logger });

      await assert.rejects(
        () => assigner.assignBot('my-bot'),
        err => {
          assert.equal(err.name, 'WorkerAssignerError');
          assert.match(err.message, /No available worker/);
          return true;
        }
      );
    });

    test('throws when all workers are at capacity', async () => {
      const worker = createWorker({ id: 'w1', currentLoad: 10, maxContainers: 10 });
      registry._workers.set('w1', worker);

      const assigner = new WorkerAssigner(registry, { logger });

      await assert.rejects(
        () => assigner.assignBot('my-bot'),
        err => {
          assert.match(err.message, /No available worker/);
          return true;
        }
      );
    });

    test('increments worker load on assignment', async () => {
      const worker = createWorker({ id: 'w1', currentLoad: 3, maxContainers: 10 });
      registry._workers.set('w1', worker);

      const assigner = new WorkerAssigner(registry, { logger });
      await assigner.assignBot('my-bot');

      assert.equal(registry.incrementLoad.mock.callCount(), 1);
      assert.deepEqual(registry.incrementLoad.mock.calls[0].arguments, ['w1']);
    });

    test('tracks assignment in internal map', async () => {
      const worker = createWorker({ id: 'w1' });
      registry._workers.set('w1', worker);

      const assigner = new WorkerAssigner(registry, { logger });
      await assigner.assignBot('my-bot');

      assert.equal(assigner.getAssignment('my-bot'), 'w1');
    });

    test('uses preferred worker when available', async () => {
      const worker1 = createWorker({ id: 'w1', currentLoad: 0, maxContainers: 10 });
      const worker2 = createWorker({ id: 'w2', currentLoad: 5, maxContainers: 10 });
      registry._workers.set('w1', worker1);
      registry._workers.set('w2', worker2);

      const assigner = new WorkerAssigner(registry, { logger });
      const result = await assigner.assignBot('my-bot', { workerId: 'w2' });

      assert.equal(result.workerId, 'w2');
    });

    test('falls back to least-loaded when preferred worker is offline', async () => {
      const worker1 = createWorker({ id: 'w1', currentLoad: 0, maxContainers: 10 });
      const worker2 = createWorker({
        id: 'w2',
        currentLoad: 0,
        maxContainers: 10,
        status: WORKER_STATUSES.OFFLINE,
      });
      registry._workers.set('w1', worker1);
      registry._workers.set('w2', worker2);

      const assigner = new WorkerAssigner(registry, { logger });
      const result = await assigner.assignBot('my-bot', { workerId: 'w2' });

      assert.equal(result.workerId, 'w1');
    });

    test('falls back when preferred worker is at capacity', async () => {
      const worker1 = createWorker({ id: 'w1', currentLoad: 0, maxContainers: 10 });
      const worker2 = createWorker({ id: 'w2', currentLoad: 10, maxContainers: 10 });
      registry._workers.set('w1', worker1);
      registry._workers.set('w2', worker2);

      const assigner = new WorkerAssigner(registry, { logger });
      const result = await assigner.assignBot('my-bot', { workerId: 'w2' });

      assert.equal(result.workerId, 'w1');
    });

    test('falls back when preferred worker does not exist', async () => {
      const worker1 = createWorker({ id: 'w1', currentLoad: 0, maxContainers: 10 });
      registry._workers.set('w1', worker1);

      const assigner = new WorkerAssigner(registry, { logger });
      const result = await assigner.assignBot('my-bot', { workerId: 'nonexistent' });

      assert.equal(result.workerId, 'w1');
    });

    test('throws when incrementLoad returns null (race condition)', async () => {
      const worker = createWorker({ id: 'w1', currentLoad: 0, maxContainers: 10 });
      registry._workers.set('w1', worker);

      // Override incrementLoad to simulate race condition
      registry.incrementLoad = mock.fn(async () => null);

      const assigner = new WorkerAssigner(registry, { logger });

      await assert.rejects(
        () => assigner.assignBot('my-bot'),
        err => {
          assert.match(err.message, /Failed to reserve capacity/);
          return true;
        }
      );
    });
  });

  // ==========================================================================
  // Pattern-based assignment
  // ==========================================================================

  describe('pattern-based assignment', () => {
    test('matches simple wildcard pattern', async () => {
      const gpuWorker = createWorker({ id: 'gpu-server', currentLoad: 0, maxContainers: 10 });
      const localWorker = createWorker({ id: 'local', currentLoad: 0, maxContainers: 10 });
      registry._workers.set('gpu-server', gpuWorker);
      registry._workers.set('local', localWorker);

      const assigner = new WorkerAssigner(registry, {
        assignmentRules: [{ pattern: 'devops-*', workerId: 'gpu-server' }],
        logger,
      });

      const result = await assigner.assignBot('devops-deploy');
      assert.equal(result.workerId, 'gpu-server');
    });

    test('matches suffix wildcard pattern', async () => {
      const gpuWorker = createWorker({ id: 'gpu-server', currentLoad: 0, maxContainers: 10 });
      registry._workers.set('gpu-server', gpuWorker);

      const assigner = new WorkerAssigner(registry, {
        assignmentRules: [{ pattern: '*-gpu', workerId: 'gpu-server' }],
        logger,
      });

      const result = await assigner.assignBot('ml-training-gpu');
      assert.equal(result.workerId, 'gpu-server');
    });

    test('does not match unrelated bot IDs', async () => {
      const gpuWorker = createWorker({ id: 'gpu-server', currentLoad: 5, maxContainers: 10 });
      const localWorker = createWorker({ id: 'local', currentLoad: 0, maxContainers: 10 });
      registry._workers.set('gpu-server', gpuWorker);
      registry._workers.set('local', localWorker);

      const assigner = new WorkerAssigner(registry, {
        assignmentRules: [{ pattern: 'devops-*', workerId: 'gpu-server' }],
        logger,
      });

      const result = await assigner.assignBot('support-bot');
      // Should fall through to least-loaded, which is local (load 0)
      assert.equal(result.workerId, 'local');
    });

    test('falls through when pattern-matched worker is unavailable', async () => {
      const gpuWorker = createWorker({
        id: 'gpu-server',
        currentLoad: 10,
        maxContainers: 10,
      });
      const localWorker = createWorker({ id: 'local', currentLoad: 0, maxContainers: 10 });
      registry._workers.set('gpu-server', gpuWorker);
      registry._workers.set('local', localWorker);

      const assigner = new WorkerAssigner(registry, {
        assignmentRules: [{ pattern: 'devops-*', workerId: 'gpu-server' }],
        logger,
      });

      const result = await assigner.assignBot('devops-deploy');
      assert.equal(result.workerId, 'local');
    });

    test('skips rules with missing pattern or workerId', async () => {
      const localWorker = createWorker({ id: 'local', currentLoad: 0, maxContainers: 10 });
      registry._workers.set('local', localWorker);

      const assigner = new WorkerAssigner(registry, {
        assignmentRules: [{ pattern: null, workerId: 'gpu-server' }, { pattern: 'devops-*' }],
        logger,
      });

      const result = await assigner.assignBot('devops-deploy');
      assert.equal(result.workerId, 'local');
    });

    test('applies first matching rule', async () => {
      const gpu1 = createWorker({ id: 'gpu-1', currentLoad: 0, maxContainers: 10 });
      const gpu2 = createWorker({ id: 'gpu-2', currentLoad: 0, maxContainers: 10 });
      registry._workers.set('gpu-1', gpu1);
      registry._workers.set('gpu-2', gpu2);

      const assigner = new WorkerAssigner(registry, {
        assignmentRules: [
          { pattern: 'devops-*', workerId: 'gpu-1' },
          { pattern: 'devops-*', workerId: 'gpu-2' },
        ],
        logger,
      });

      const result = await assigner.assignBot('devops-deploy');
      assert.equal(result.workerId, 'gpu-1');
    });
  });

  // ==========================================================================
  // Load balancing
  // ==========================================================================

  describe('load balancing', () => {
    test('selects worker with lowest load ratio', async () => {
      const w1 = createWorker({ id: 'w1', currentLoad: 8, maxContainers: 10 }); // 80%
      const w2 = createWorker({ id: 'w2', currentLoad: 2, maxContainers: 5 }); // 40%
      const w3 = createWorker({ id: 'w3', currentLoad: 5, maxContainers: 10 }); // 50%
      registry._workers.set('w1', w1);
      registry._workers.set('w2', w2);
      registry._workers.set('w3', w3);

      const assigner = new WorkerAssigner(registry, { logger });
      const result = await assigner.assignBot('my-bot');

      assert.equal(result.workerId, 'w2');
    });

    test('skips offline workers', async () => {
      const w1 = createWorker({
        id: 'w1',
        currentLoad: 0,
        maxContainers: 10,
        status: WORKER_STATUSES.OFFLINE,
      });
      const w2 = createWorker({ id: 'w2', currentLoad: 5, maxContainers: 10 });
      registry._workers.set('w1', w1);
      registry._workers.set('w2', w2);

      const assigner = new WorkerAssigner(registry, { logger });
      const result = await assigner.assignBot('my-bot');

      assert.equal(result.workerId, 'w2');
    });

    test('skips degraded workers', async () => {
      const w1 = createWorker({
        id: 'w1',
        currentLoad: 0,
        maxContainers: 10,
        status: WORKER_STATUSES.DEGRADED,
      });
      const w2 = createWorker({ id: 'w2', currentLoad: 5, maxContainers: 10 });
      registry._workers.set('w1', w1);
      registry._workers.set('w2', w2);

      const assigner = new WorkerAssigner(registry, { logger });
      const result = await assigner.assignBot('my-bot');

      assert.equal(result.workerId, 'w2');
    });
  });

  // ==========================================================================
  // Docker host resolution
  // ==========================================================================

  describe('Docker host resolution', () => {
    test('returns null dockerHost for local workers', async () => {
      const worker = createWorker({ id: 'local', type: WORKER_TYPES.LOCAL });
      registry._workers.set('local', worker);

      const assigner = new WorkerAssigner(registry, { logger });
      const result = await assigner.assignBot('my-bot');

      assert.equal(result.dockerHost, null);
      assert.equal(result.workerType, WORKER_TYPES.LOCAL);
    });

    test('returns SSH tunnel dockerHost for remote workers', async () => {
      const worker = createWorker({
        id: 'gpu-server',
        type: WORKER_TYPES.REMOTE,
        host: '192.168.1.100',
      });
      registry._workers.set('gpu-server', worker);

      const tunnelManager = createMockSSHTunnelManager();
      tunnelManager._tunnels.set('gpu-server', 'tcp://127.0.0.1:54321');

      const assigner = new WorkerAssigner(registry, {
        sshTunnelManager: tunnelManager,
        logger,
      });

      const result = await assigner.assignBot('my-bot');

      assert.equal(result.dockerHost, 'tcp://127.0.0.1:54321');
      assert.equal(result.workerType, WORKER_TYPES.REMOTE);
    });

    test('falls back to direct host for remote worker without tunnel', async () => {
      const worker = createWorker({
        id: 'gpu-server',
        type: WORKER_TYPES.REMOTE,
        host: '192.168.1.100',
      });
      registry._workers.set('gpu-server', worker);

      const tunnelManager = createMockSSHTunnelManager();
      // No tunnel set for gpu-server

      const assigner = new WorkerAssigner(registry, {
        sshTunnelManager: tunnelManager,
        logger,
      });

      const result = await assigner.assignBot('my-bot');

      assert.equal(result.dockerHost, 'tcp://192.168.1.100:2375');
    });

    test('uses direct host when no sshTunnelManager provided', async () => {
      const worker = createWorker({
        id: 'gpu-server',
        type: WORKER_TYPES.REMOTE,
        host: '10.0.0.5',
      });
      registry._workers.set('gpu-server', worker);

      const assigner = new WorkerAssigner(registry, { logger });
      const result = await assigner.assignBot('my-bot');

      assert.equal(result.dockerHost, 'tcp://10.0.0.5:2375');
    });
  });

  // ==========================================================================
  // Incus host resolution
  // ==========================================================================

  describe('Incus host resolution', () => {
    test('returns null incusHost for local workers', async () => {
      const worker = createWorker({ id: 'local', type: WORKER_TYPES.LOCAL });
      registry._workers.set('local', worker);

      const assigner = new WorkerAssigner(registry, { logger });
      const result = await assigner.assignBot('my-bot');

      assert.equal(result.incusHost, null);
    });

    test('returns SSH tunnel incusHost for remote workers', async () => {
      const worker = createWorker({
        id: 'incus-server',
        type: WORKER_TYPES.REMOTE,
        host: '192.168.1.200',
      });
      registry._workers.set('incus-server', worker);

      const tunnelManager = createMockSSHTunnelManager();
      tunnelManager._incusTunnels.set('incus-server', 'tcp://127.0.0.1:54322');

      const assigner = new WorkerAssigner(registry, {
        sshTunnelManager: tunnelManager,
        logger,
      });

      const result = await assigner.assignBot('my-bot');

      assert.equal(result.incusHost, 'tcp://127.0.0.1:54322');
      assert.equal(result.workerType, WORKER_TYPES.REMOTE);
    });

    test('returns null incusHost when no Incus tunnel exists for remote worker', async () => {
      const worker = createWorker({
        id: 'docker-server',
        type: WORKER_TYPES.REMOTE,
        host: '192.168.1.100',
      });
      registry._workers.set('docker-server', worker);

      const tunnelManager = createMockSSHTunnelManager();
      tunnelManager._tunnels.set('docker-server', 'tcp://127.0.0.1:54321');
      // No Incus tunnel set

      const assigner = new WorkerAssigner(registry, {
        sshTunnelManager: tunnelManager,
        logger,
      });

      const result = await assigner.assignBot('my-bot');

      assert.equal(result.dockerHost, 'tcp://127.0.0.1:54321');
      assert.equal(result.incusHost, null);
    });

    test('returns both dockerHost and incusHost when both tunnels exist', async () => {
      const worker = createWorker({
        id: 'dual-server',
        type: WORKER_TYPES.REMOTE,
        host: '192.168.1.150',
      });
      registry._workers.set('dual-server', worker);

      const tunnelManager = createMockSSHTunnelManager();
      tunnelManager._tunnels.set('dual-server', 'tcp://127.0.0.1:54321');
      tunnelManager._incusTunnels.set('dual-server', 'tcp://127.0.0.1:54322');

      const assigner = new WorkerAssigner(registry, {
        sshTunnelManager: tunnelManager,
        logger,
      });

      const result = await assigner.assignBot('my-bot');

      assert.equal(result.dockerHost, 'tcp://127.0.0.1:54321');
      assert.equal(result.incusHost, 'tcp://127.0.0.1:54322');
    });

    test('returns null incusHost when no sshTunnelManager is provided', async () => {
      const worker = createWorker({
        id: 'remote-server',
        type: WORKER_TYPES.REMOTE,
        host: '10.0.0.5',
      });
      registry._workers.set('remote-server', worker);

      const assigner = new WorkerAssigner(registry, { logger });
      const result = await assigner.assignBot('my-bot');

      assert.equal(result.incusHost, null);
      // Docker falls back to direct host
      assert.equal(result.dockerHost, 'tcp://10.0.0.5:2375');
    });

    test('handles sshTunnelManager without getIncusHost method', async () => {
      const worker = createWorker({
        id: 'remote-server',
        type: WORKER_TYPES.REMOTE,
        host: '10.0.0.5',
      });
      registry._workers.set('remote-server', worker);

      // SSHTunnelManager that only has getDockerHost (no getIncusHost)
      const tunnelManager = {
        getDockerHost: mock.fn(() => 'tcp://127.0.0.1:54321'),
      };

      const assigner = new WorkerAssigner(registry, {
        sshTunnelManager: tunnelManager,
        logger,
      });
      const result = await assigner.assignBot('my-bot');

      assert.equal(result.incusHost, null);
      assert.equal(result.dockerHost, 'tcp://127.0.0.1:54321');
    });

    test('includes incusHost in failover reassignment results', async () => {
      const w1 = createWorker({
        id: 'w1',
        type: WORKER_TYPES.REMOTE,
        host: '192.168.1.100',
        currentLoad: 2,
        maxContainers: 10,
        status: WORKER_STATUSES.OFFLINE,
      });
      const w2 = createWorker({
        id: 'w2',
        type: WORKER_TYPES.REMOTE,
        host: '192.168.1.200',
        currentLoad: 0,
        maxContainers: 10,
      });
      registry._workers.set('w1', w1);
      registry._workers.set('w2', w2);

      const tunnelManager = createMockSSHTunnelManager();
      tunnelManager._incusTunnels.set('w2', 'tcp://127.0.0.1:55322');
      tunnelManager._tunnels.set('w2', 'tcp://127.0.0.1:55321');

      const assigner = new WorkerAssigner(registry, {
        sshTunnelManager: tunnelManager,
        logger,
      });
      assigner.assignments.set('bot-a', 'w1');

      const results = await assigner.failover('w1');

      assert.equal(results.reassigned.length, 1);
      assert.equal(results.reassigned[0].toWorkerId, 'w2');
      assert.equal(results.reassigned[0].dockerHost, 'tcp://127.0.0.1:55321');
      assert.equal(results.reassigned[0].incusHost, 'tcp://127.0.0.1:55322');
    });
  });

  // ==========================================================================
  // releaseBot
  // ==========================================================================

  describe('releaseBot', () => {
    test('releases assignment and decrements worker load', async () => {
      const worker = createWorker({ id: 'w1', currentLoad: 0, maxContainers: 10 });
      registry._workers.set('w1', worker);

      const assigner = new WorkerAssigner(registry, { logger });
      await assigner.assignBot('my-bot');
      assert.equal(assigner.getAssignment('my-bot'), 'w1');

      const released = await assigner.releaseBot('my-bot');
      assert.equal(released, true);
      assert.equal(assigner.getAssignment('my-bot'), undefined);
      assert.equal(registry.decrementLoad.mock.callCount(), 1);
    });

    test('returns false if bot was not assigned', async () => {
      const assigner = new WorkerAssigner(registry, { logger });
      const released = await assigner.releaseBot('nonexistent');
      assert.equal(released, false);
    });

    test('throws when botId is empty', async () => {
      const assigner = new WorkerAssigner(registry, { logger });
      await assert.rejects(
        () => assigner.releaseBot(''),
        err => {
          assert.equal(err.name, 'WorkerAssignerError');
          return true;
        }
      );
    });
  });

  // ==========================================================================
  // rebalance
  // ==========================================================================

  describe('rebalance', () => {
    test('moves bots from overloaded to underloaded workers', async () => {
      const w1 = createWorker({ id: 'w1', currentLoad: 9, maxContainers: 10 }); // 90%
      const w2 = createWorker({ id: 'w2', currentLoad: 1, maxContainers: 10 }); // 10%
      registry._workers.set('w1', w1);
      registry._workers.set('w2', w2);

      const assigner = new WorkerAssigner(registry, { logger });
      // Simulate bots assigned to w1
      assigner.assignments.set('bot-a', 'w1');
      assigner.assignments.set('bot-b', 'w1');

      const moves = await assigner.rebalance();

      assert.ok(moves.length > 0);
      assert.equal(moves[0].fromWorkerId, 'w1');
      assert.equal(moves[0].toWorkerId, 'w2');
    });

    test('returns empty when only one worker exists', async () => {
      const w1 = createWorker({ id: 'w1', currentLoad: 5, maxContainers: 10 });
      registry._workers.set('w1', w1);

      const assigner = new WorkerAssigner(registry, { logger });
      const moves = await assigner.rebalance();

      assert.deepEqual(moves, []);
    });

    test('returns empty when load is balanced', async () => {
      const w1 = createWorker({ id: 'w1', currentLoad: 5, maxContainers: 10 }); // 50%
      const w2 = createWorker({ id: 'w2', currentLoad: 5, maxContainers: 10 }); // 50%
      registry._workers.set('w1', w1);
      registry._workers.set('w2', w2);

      const assigner = new WorkerAssigner(registry, { logger });
      const moves = await assigner.rebalance();

      assert.deepEqual(moves, []);
    });

    test('returns empty when no healthy workers exist', async () => {
      const w1 = createWorker({
        id: 'w1',
        currentLoad: 5,
        maxContainers: 10,
        status: WORKER_STATUSES.OFFLINE,
      });
      registry._workers.set('w1', w1);

      const assigner = new WorkerAssigner(registry, { logger });
      const moves = await assigner.rebalance();

      assert.deepEqual(moves, []);
    });
  });

  // ==========================================================================
  // failover
  // ==========================================================================

  describe('failover', () => {
    test('reassigns bots from failed worker to healthy workers', async () => {
      const w1 = createWorker({
        id: 'w1',
        currentLoad: 3,
        maxContainers: 10,
        status: WORKER_STATUSES.OFFLINE,
      });
      const w2 = createWorker({ id: 'w2', currentLoad: 0, maxContainers: 10 });
      registry._workers.set('w1', w1);
      registry._workers.set('w2', w2);

      const assigner = new WorkerAssigner(registry, { logger });
      assigner.assignments.set('bot-a', 'w1');
      assigner.assignments.set('bot-b', 'w1');
      assigner.assignments.set('bot-c', 'w2');

      const results = await assigner.failover('w1');

      assert.equal(results.reassigned.length, 2);
      assert.equal(results.failed.length, 0);

      // Verify bots were moved to w2
      for (const reassignment of results.reassigned) {
        assert.equal(reassignment.fromWorkerId, 'w1');
        assert.equal(reassignment.toWorkerId, 'w2');
      }

      // Verify assignments updated
      assert.equal(assigner.getAssignment('bot-a'), 'w2');
      assert.equal(assigner.getAssignment('bot-b'), 'w2');
      // bot-c should remain on w2
      assert.equal(assigner.getAssignment('bot-c'), 'w2');
    });

    test('reports failed reassignments when no workers available', async () => {
      // Only one worker exists and it's the failed one
      const w1 = createWorker({
        id: 'w1',
        currentLoad: 2,
        maxContainers: 10,
        status: WORKER_STATUSES.OFFLINE,
      });
      registry._workers.set('w1', w1);

      const assigner = new WorkerAssigner(registry, { logger });
      assigner.assignments.set('bot-a', 'w1');

      const results = await assigner.failover('w1');

      assert.equal(results.reassigned.length, 0);
      assert.equal(results.failed.length, 1);
      assert.equal(results.failed[0].botId, 'bot-a');
    });

    test('handles empty failover (no bots on failed worker)', async () => {
      const assigner = new WorkerAssigner(registry, { logger });
      const results = await assigner.failover('nonexistent');

      assert.equal(results.reassigned.length, 0);
      assert.equal(results.failed.length, 0);
    });

    test('throws when failedWorkerId is empty', async () => {
      const assigner = new WorkerAssigner(registry, { logger });

      await assert.rejects(
        () => assigner.failover(''),
        err => {
          assert.equal(err.name, 'WorkerAssignerError');
          assert.match(err.message, /Failed worker ID must be a non-empty string/);
          return true;
        }
      );
    });

    test('continues reassigning when individual bots fail', async () => {
      const w1 = createWorker({
        id: 'w1',
        currentLoad: 2,
        maxContainers: 10,
        status: WORKER_STATUSES.OFFLINE,
      });
      const w2 = createWorker({ id: 'w2', currentLoad: 9, maxContainers: 10 });
      registry._workers.set('w1', w1);
      registry._workers.set('w2', w2);

      const assigner = new WorkerAssigner(registry, { logger });
      assigner.assignments.set('bot-a', 'w1');
      assigner.assignments.set('bot-b', 'w1');

      const results = await assigner.failover('w1');

      // w2 can only take 1 more bot (9/10)
      assert.equal(results.reassigned.length, 1);
      assert.equal(results.failed.length, 1);
    });
  });

  // ==========================================================================
  // getAssignment
  // ==========================================================================

  describe('getAssignment', () => {
    test('returns workerId for assigned bot', async () => {
      const worker = createWorker({ id: 'w1' });
      registry._workers.set('w1', worker);

      const assigner = new WorkerAssigner(registry, { logger });
      await assigner.assignBot('my-bot');

      assert.equal(assigner.getAssignment('my-bot'), 'w1');
    });

    test('returns undefined for unassigned bot', () => {
      const assigner = new WorkerAssigner(registry, { logger });
      assert.equal(assigner.getAssignment('unassigned'), undefined);
    });
  });

  // ==========================================================================
  // _matchPattern
  // ==========================================================================

  describe('_matchPattern', () => {
    let assigner;

    beforeEach(() => {
      assigner = new WorkerAssigner(registry, { logger });
    });

    test('matches exact bot ID', () => {
      assert.equal(assigner._matchPattern('devops-bot', 'devops-bot'), true);
    });

    test('matches prefix wildcard', () => {
      assert.equal(assigner._matchPattern('devops-deploy', 'devops-*'), true);
    });

    test('matches suffix wildcard', () => {
      assert.equal(assigner._matchPattern('ml-training-gpu', '*-gpu'), true);
    });

    test('matches middle wildcard', () => {
      assert.equal(assigner._matchPattern('devops-staging-bot', 'devops-*-bot'), true);
    });

    test('matches multiple wildcards', () => {
      assert.equal(assigner._matchPattern('a-b-c', '*-*-*'), true);
    });

    test('does not match different prefix', () => {
      assert.equal(assigner._matchPattern('support-bot', 'devops-*'), false);
    });

    test('does not match partial', () => {
      assert.equal(assigner._matchPattern('devops', 'devops-*'), false);
    });

    test('handles regex special characters in pattern', () => {
      assert.equal(assigner._matchPattern('bot.v2', 'bot.v2'), true);
      assert.equal(assigner._matchPattern('botzv2', 'bot.v2'), false);
    });
  });
});
