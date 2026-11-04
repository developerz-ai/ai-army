/**
 * Unit tests for WorkerRegistry
 *
 * Tests worker registration, unregistration, listing, heartbeat management,
 * load tracking, dead worker detection, and available worker selection.
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  WorkerRegistry,
  WorkerRegistryError,
  WORKER_STATUSES,
  WORKER_TYPES,
} from '../../../src/core/worker-registry.js';

/**
 * Create a mock storage object for testing
 * @param {Object} [overrides={}] - Override default mock implementations
 * @returns {Object} Mock storage object
 */
function createMockStorage(overrides = {}) {
  const workers = new Map();

  return {
    workers,
    query: mock.fn(async (sql, params = []) => {
      // INSERT INTO workers ... RETURNING *
      if (sql.includes('INSERT INTO workers')) {
        const [id, host, type, maxContainers, status] = params;
        const now = new Date();
        const row = {
          id,
          host,
          type,
          max_containers: maxContainers,
          current_load: 0,
          status,
          last_heartbeat: now,
          created_at: now,
          updated_at: now,
        };
        workers.set(id, row);
        return { rows: [row], rowCount: 1 };
      }

      // DELETE FROM workers WHERE id = $1
      if (sql.includes('DELETE FROM workers')) {
        const existed = workers.has(params[0]);
        workers.delete(params[0]);
        return { rowCount: existed ? 1 : 0 };
      }

      // UPDATE workers SET current_load = current_load + 1
      if (sql.includes('current_load = current_load + 1')) {
        const row = workers.get(params[0]);
        if (row && row.current_load < row.max_containers) {
          row.current_load += 1;
          row.updated_at = new Date();
          return { rows: [row], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      // UPDATE workers SET current_load = current_load - 1
      if (sql.includes('current_load = current_load - 1')) {
        const row = workers.get(params[0]);
        if (row && row.current_load > 0) {
          row.current_load -= 1;
          row.updated_at = new Date();
          return { rows: [row], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      // UPDATE workers SET last_heartbeat (heartbeat update)
      if (sql.includes('SET last_heartbeat = NOW()')) {
        const row = workers.get(params[0]);
        if (row) {
          row.last_heartbeat = new Date();
          if (row.status === WORKER_STATUSES.DEGRADED) {
            row.status = WORKER_STATUSES.HEALTHY;
          }
          row.updated_at = new Date();
          return { rows: [row], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      // UPDATE workers SET status (dead worker detection)
      if (sql.includes('SET status') && sql.includes('last_heartbeat')) {
        const deadWorkers = [];
        for (const row of workers.values()) {
          if (row.status !== WORKER_STATUSES.OFFLINE) {
            if (!row.last_heartbeat || row.last_heartbeat < new Date(Date.now() - 30_000)) {
              row.status = WORKER_STATUSES.OFFLINE;
              deadWorkers.push(row);
            }
          }
        }
        return { rows: deadWorkers, rowCount: deadWorkers.length };
      }

      // SELECT ... FROM workers WHERE id = $1 (single worker by ID)
      if (
        sql.includes('SELECT') &&
        sql.includes('FROM workers') &&
        sql.includes('WHERE id = $1') &&
        !sql.includes('current_load < max_containers')
      ) {
        const row = workers.get(params[0]);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }

      // SELECT ... WHERE status = $1 AND current_load < max_containers (available worker)
      if (sql.includes('current_load < max_containers') && sql.includes('ORDER BY')) {
        const available = [...workers.values()]
          .filter(r => r.status === params[0] && r.current_load < r.max_containers)
          .sort((a, b) => {
            const ratioA = a.current_load / a.max_containers;
            const ratioB = b.current_load / b.max_containers;
            return ratioA - ratioB;
          });
        const result = available.length > 0 ? [available[0]] : [];
        return { rows: result, rowCount: result.length };
      }

      // SELECT * FROM workers (list with optional filters)
      if (sql.includes('SELECT') && sql.includes('FROM workers')) {
        let rows = [...workers.values()];

        // Apply status filter
        if (sql.includes('status = $') && params.length > 0) {
          const statusIdx = (sql.match(/status = \$(\d+)/) || [])[1];
          if (statusIdx) {
            rows = rows.filter(r => r.status === params[Number(statusIdx) - 1]);
          }
        }

        // Apply type filter
        if (sql.includes('type = $')) {
          const typeIdx = (sql.match(/type = \$(\d+)/) || [])[1];
          if (typeIdx) {
            rows = rows.filter(r => r.type === params[Number(typeIdx) - 1]);
          }
        }

        return { rows, rowCount: rows.length };
      }

      return { rows: [], rowCount: 0 };
    }),
    ...overrides,
  };
}

// ============================================================================
// Constants
// ============================================================================

describe('WORKER_STATUSES', () => {
  test('exports frozen status constants', () => {
    assert.equal(WORKER_STATUSES.HEALTHY, 'healthy');
    assert.equal(WORKER_STATUSES.DEGRADED, 'degraded');
    assert.equal(WORKER_STATUSES.OFFLINE, 'offline');
    assert.ok(Object.isFrozen(WORKER_STATUSES));
  });
});

describe('WORKER_TYPES', () => {
  test('exports frozen type constants', () => {
    assert.equal(WORKER_TYPES.LOCAL, 'local');
    assert.equal(WORKER_TYPES.REMOTE, 'remote');
    assert.ok(Object.isFrozen(WORKER_TYPES));
  });
});

// ============================================================================
// WorkerRegistryError
// ============================================================================

describe('WorkerRegistryError', () => {
  test('creates error with message', () => {
    const err = new WorkerRegistryError('test error');
    assert.equal(err.message, 'test error');
    assert.equal(err.name, 'WorkerRegistryError');
    assert.equal(err.operation, undefined);
    assert.equal(err.workerId, undefined);
  });

  test('creates error with all options', () => {
    const cause = new Error('root cause');
    const err = new WorkerRegistryError('test error', {
      cause,
      operation: 'registerWorker',
      workerId: 'worker-1',
    });
    assert.equal(err.message, 'test error');
    assert.equal(err.name, 'WorkerRegistryError');
    assert.equal(err.operation, 'registerWorker');
    assert.equal(err.workerId, 'worker-1');
    assert.equal(err.cause, cause);
  });

  test('is an instance of Error', () => {
    const err = new WorkerRegistryError('test');
    assert.ok(err instanceof Error);
  });
});

// ============================================================================
// WorkerRegistry
// ============================================================================

describe('WorkerRegistry', () => {
  let registry;
  let mockStorage;

  beforeEach(() => {
    mockStorage = createMockStorage();
    registry = new WorkerRegistry(mockStorage);
  });

  // --------------------------------------------------------------------------
  // Constructor
  // --------------------------------------------------------------------------

  describe('constructor', () => {
    test('creates instance with valid storage', () => {
      assert.ok(registry);
      assert.equal(registry.storage, mockStorage);
      assert.equal(registry.heartbeatThresholdMs, 30_000);
    });

    test('accepts custom heartbeat threshold', () => {
      const custom = new WorkerRegistry(mockStorage, { heartbeatThresholdMs: 60_000 });
      assert.equal(custom.heartbeatThresholdMs, 60_000);
    });

    test('throws WorkerRegistryError when storage is missing', () => {
      assert.throws(
        () => new WorkerRegistry(null),
        err => {
          assert.equal(err.name, 'WorkerRegistryError');
          assert.equal(err.operation, 'constructor');
          assert.match(err.message, /Storage is required/);
          return true;
        }
      );
    });

    test('throws WorkerRegistryError when storage is undefined', () => {
      assert.throws(
        () => new WorkerRegistry(undefined),
        err => {
          assert.equal(err.name, 'WorkerRegistryError');
          return true;
        }
      );
    });
  });

  // --------------------------------------------------------------------------
  // registerWorker()
  // --------------------------------------------------------------------------

  describe('registerWorker()', () => {
    test('registers a new local worker with defaults', async () => {
      const worker = await registry.registerWorker({
        id: 'worker-1',
        host: 'localhost',
        type: 'local',
      });

      assert.equal(worker.id, 'worker-1');
      assert.equal(worker.host, 'localhost');
      assert.equal(worker.type, 'local');
      assert.equal(worker.maxContainers, 10);
      assert.equal(worker.currentLoad, 0);
      assert.equal(worker.status, 'healthy');
      assert.ok(worker.lastHeartbeat instanceof Date);
      assert.ok(worker.createdAt instanceof Date);
    });

    test('registers a remote worker with custom maxContainers', async () => {
      const worker = await registry.registerWorker({
        id: 'gpu-server',
        host: '192.168.1.100',
        type: 'remote',
        maxContainers: 20,
      });

      assert.equal(worker.id, 'gpu-server');
      assert.equal(worker.host, '192.168.1.100');
      assert.equal(worker.type, 'remote');
      assert.equal(worker.maxContainers, 20);
    });

    test('throws when config is null', async () => {
      await assert.rejects(
        () => registry.registerWorker(null),
        err => {
          assert.equal(err.name, 'WorkerRegistryError');
          assert.equal(err.operation, 'registerWorker');
          assert.match(err.message, /non-null object/);
          return true;
        }
      );
    });

    test('throws when config is not an object', async () => {
      await assert.rejects(
        () => registry.registerWorker('invalid'),
        err => {
          assert.equal(err.name, 'WorkerRegistryError');
          return true;
        }
      );
    });

    test('throws when ID is missing', async () => {
      await assert.rejects(
        () => registry.registerWorker({ host: 'localhost', type: 'local' }),
        err => {
          assert.equal(err.operation, 'registerWorker');
          assert.match(err.message, /Worker ID/);
          return true;
        }
      );
    });

    test('throws when host is missing', async () => {
      await assert.rejects(
        () => registry.registerWorker({ id: 'w1', type: 'local' }),
        err => {
          assert.equal(err.operation, 'registerWorker');
          assert.equal(err.workerId, 'w1');
          assert.match(err.message, /host/);
          return true;
        }
      );
    });

    test('throws when type is invalid', async () => {
      await assert.rejects(
        () => registry.registerWorker({ id: 'w1', host: 'localhost', type: 'cloud' }),
        err => {
          assert.equal(err.operation, 'registerWorker');
          assert.match(err.message, /type must be one of/);
          return true;
        }
      );
    });

    test('throws when maxContainers is zero', async () => {
      await assert.rejects(
        () =>
          registry.registerWorker({
            id: 'w1',
            host: 'localhost',
            type: 'local',
            maxContainers: 0,
          }),
        err => {
          assert.match(err.message, /maxContainers/);
          return true;
        }
      );
    });

    test('throws when maxContainers is negative', async () => {
      await assert.rejects(
        () =>
          registry.registerWorker({
            id: 'w1',
            host: 'localhost',
            type: 'local',
            maxContainers: -5,
          }),
        err => {
          assert.match(err.message, /maxContainers/);
          return true;
        }
      );
    });

    test('throws when worker already exists', async () => {
      await registry.registerWorker({ id: 'w1', host: 'localhost', type: 'local' });

      await assert.rejects(
        () => registry.registerWorker({ id: 'w1', host: 'localhost', type: 'local' }),
        err => {
          assert.equal(err.name, 'WorkerRegistryError');
          assert.equal(err.workerId, 'w1');
          assert.match(err.message, /already exists/);
          return true;
        }
      );
    });

    test('wraps storage errors', async () => {
      const failStorage = createMockStorage({
        query: mock.fn(async () => {
          throw new Error('Connection refused');
        }),
      });
      const failRegistry = new WorkerRegistry(failStorage);

      await assert.rejects(
        () => failRegistry.registerWorker({ id: 'w1', host: 'localhost', type: 'local' }),
        err => {
          assert.equal(err.name, 'WorkerRegistryError');
          assert.equal(err.operation, 'registerWorker');
          assert.match(err.message, /Connection refused/);
          assert.ok(err.cause);
          return true;
        }
      );
    });
  });

  // --------------------------------------------------------------------------
  // unregisterWorker()
  // --------------------------------------------------------------------------

  describe('unregisterWorker()', () => {
    test('removes an existing worker', async () => {
      await registry.registerWorker({ id: 'w1', host: 'localhost', type: 'local' });
      const removed = await registry.unregisterWorker('w1');
      assert.equal(removed, true);
    });

    test('returns false for non-existent worker', async () => {
      const removed = await registry.unregisterWorker('nonexistent');
      assert.equal(removed, false);
    });

    test('throws when ID is empty', async () => {
      await assert.rejects(
        () => registry.unregisterWorker(''),
        err => {
          assert.equal(err.name, 'WorkerRegistryError');
          assert.equal(err.operation, 'unregisterWorker');
          return true;
        }
      );
    });

    test('throws when worker has active containers', async () => {
      await registry.registerWorker({ id: 'w1', host: 'localhost', type: 'local' });
      // Simulate load
      mockStorage.workers.get('w1').current_load = 3;

      await assert.rejects(
        () => registry.unregisterWorker('w1'),
        err => {
          assert.equal(err.name, 'WorkerRegistryError');
          assert.match(err.message, /3 active container/);
          return true;
        }
      );
    });

    test('force unregisters worker with active containers', async () => {
      await registry.registerWorker({ id: 'w1', host: 'localhost', type: 'local' });
      mockStorage.workers.get('w1').current_load = 3;

      const removed = await registry.unregisterWorker('w1', { force: true });
      assert.equal(removed, true);
    });

    test('wraps storage errors', async () => {
      const failStorage = createMockStorage({
        query: mock.fn(async () => {
          throw new Error('DB error');
        }),
      });
      const failRegistry = new WorkerRegistry(failStorage);

      await assert.rejects(
        () => failRegistry.unregisterWorker('w1'),
        err => {
          assert.equal(err.name, 'WorkerRegistryError');
          assert.equal(err.operation, 'unregisterWorker');
          assert.ok(err.cause);
          return true;
        }
      );
    });
  });

  // --------------------------------------------------------------------------
  // listWorkers()
  // --------------------------------------------------------------------------

  describe('listWorkers()', () => {
    test('returns empty array when no workers registered', async () => {
      const workers = await registry.listWorkers();
      assert.deepEqual(workers, []);
    });

    test('returns all registered workers', async () => {
      await registry.registerWorker({ id: 'w1', host: 'localhost', type: 'local' });
      await registry.registerWorker({ id: 'w2', host: '10.0.0.1', type: 'remote' });

      const workers = await registry.listWorkers();
      assert.equal(workers.length, 2);
    });

    test('filters by status', async () => {
      await registry.registerWorker({ id: 'w1', host: 'localhost', type: 'local' });
      await registry.registerWorker({ id: 'w2', host: '10.0.0.1', type: 'remote' });
      mockStorage.workers.get('w2').status = 'offline';

      const healthy = await registry.listWorkers({ status: 'healthy' });
      assert.equal(healthy.length, 1);
      assert.equal(healthy[0].id, 'w1');
    });

    test('filters by type', async () => {
      await registry.registerWorker({ id: 'w1', host: 'localhost', type: 'local' });
      await registry.registerWorker({ id: 'w2', host: '10.0.0.1', type: 'remote' });

      const remoteOnly = await registry.listWorkers({ type: 'remote' });
      assert.equal(remoteOnly.length, 1);
      assert.equal(remoteOnly[0].id, 'w2');
    });

    test('returns worker objects with camelCase keys', async () => {
      await registry.registerWorker({ id: 'w1', host: 'localhost', type: 'local' });

      const workers = await registry.listWorkers();
      const worker = workers[0];
      assert.equal(typeof worker.maxContainers, 'number');
      assert.equal(typeof worker.currentLoad, 'number');
      assert.ok(worker.lastHeartbeat instanceof Date);
      assert.ok(worker.createdAt instanceof Date);
    });

    test('wraps storage errors', async () => {
      const failStorage = createMockStorage({
        query: mock.fn(async () => {
          throw new Error('Query timeout');
        }),
      });
      const failRegistry = new WorkerRegistry(failStorage);

      await assert.rejects(
        () => failRegistry.listWorkers(),
        err => {
          assert.equal(err.name, 'WorkerRegistryError');
          assert.equal(err.operation, 'listWorkers');
          return true;
        }
      );
    });
  });

  // --------------------------------------------------------------------------
  // getWorker()
  // --------------------------------------------------------------------------

  describe('getWorker()', () => {
    test('returns worker by ID', async () => {
      await registry.registerWorker({ id: 'w1', host: 'localhost', type: 'local' });

      const worker = await registry.getWorker('w1');
      assert.equal(worker.id, 'w1');
      assert.equal(worker.host, 'localhost');
    });

    test('returns null for non-existent worker', async () => {
      const worker = await registry.getWorker('nonexistent');
      assert.equal(worker, null);
    });

    test('throws when ID is empty', async () => {
      await assert.rejects(
        () => registry.getWorker(''),
        err => {
          assert.equal(err.name, 'WorkerRegistryError');
          assert.equal(err.operation, 'getWorker');
          return true;
        }
      );
    });
  });

  // --------------------------------------------------------------------------
  // getAvailableWorker()
  // --------------------------------------------------------------------------

  describe('getAvailableWorker()', () => {
    test('returns least-loaded healthy worker', async () => {
      await registry.registerWorker({
        id: 'w1',
        host: 'localhost',
        type: 'local',
        maxContainers: 10,
      });
      await registry.registerWorker({
        id: 'w2',
        host: '10.0.0.1',
        type: 'remote',
        maxContainers: 10,
      });
      mockStorage.workers.get('w1').current_load = 5;
      mockStorage.workers.get('w2').current_load = 2;

      const worker = await registry.getAvailableWorker('some-bot');
      assert.equal(worker.id, 'w2');
    });

    test('returns null when no workers available', async () => {
      const worker = await registry.getAvailableWorker('some-bot');
      assert.equal(worker, null);
    });

    test('excludes workers at full capacity', async () => {
      await registry.registerWorker({
        id: 'w1',
        host: 'localhost',
        type: 'local',
        maxContainers: 2,
      });
      mockStorage.workers.get('w1').current_load = 2;

      const worker = await registry.getAvailableWorker('some-bot');
      assert.equal(worker, null);
    });

    test('excludes offline workers', async () => {
      await registry.registerWorker({ id: 'w1', host: 'localhost', type: 'local' });
      mockStorage.workers.get('w1').status = 'offline';

      const worker = await registry.getAvailableWorker('some-bot');
      assert.equal(worker, null);
    });

    test('excludes degraded workers', async () => {
      await registry.registerWorker({ id: 'w1', host: 'localhost', type: 'local' });
      mockStorage.workers.get('w1').status = 'degraded';

      const worker = await registry.getAvailableWorker('some-bot');
      assert.equal(worker, null);
    });

    test('wraps storage errors', async () => {
      const failStorage = createMockStorage({
        query: mock.fn(async () => {
          throw new Error('Connection lost');
        }),
      });
      const failRegistry = new WorkerRegistry(failStorage);

      await assert.rejects(
        () => failRegistry.getAvailableWorker('bot'),
        err => {
          assert.equal(err.name, 'WorkerRegistryError');
          assert.equal(err.operation, 'getAvailableWorker');
          return true;
        }
      );
    });
  });

  // --------------------------------------------------------------------------
  // updateHeartbeat()
  // --------------------------------------------------------------------------

  describe('updateHeartbeat()', () => {
    test('updates heartbeat for existing worker', async () => {
      await registry.registerWorker({ id: 'w1', host: 'localhost', type: 'local' });

      const updated = await registry.updateHeartbeat('w1');
      assert.equal(updated.id, 'w1');
      assert.ok(updated.lastHeartbeat instanceof Date);
    });

    test('restores degraded worker to healthy on heartbeat', async () => {
      await registry.registerWorker({ id: 'w1', host: 'localhost', type: 'local' });
      mockStorage.workers.get('w1').status = 'degraded';

      const updated = await registry.updateHeartbeat('w1');
      assert.equal(updated.status, 'healthy');
    });

    test('returns null for non-existent worker', async () => {
      const result = await registry.updateHeartbeat('nonexistent');
      assert.equal(result, null);
    });

    test('throws when ID is empty', async () => {
      await assert.rejects(
        () => registry.updateHeartbeat(''),
        err => {
          assert.equal(err.name, 'WorkerRegistryError');
          assert.equal(err.operation, 'updateHeartbeat');
          return true;
        }
      );
    });

    test('wraps storage errors', async () => {
      const failStorage = createMockStorage({
        query: mock.fn(async () => {
          throw new Error('Update failed');
        }),
      });
      const failRegistry = new WorkerRegistry(failStorage);

      await assert.rejects(
        () => failRegistry.updateHeartbeat('w1'),
        err => {
          assert.equal(err.name, 'WorkerRegistryError');
          assert.match(err.message, /Update failed/);
          return true;
        }
      );
    });
  });

  // --------------------------------------------------------------------------
  // getWorkerLoad()
  // --------------------------------------------------------------------------

  describe('getWorkerLoad()', () => {
    test('returns load info for existing worker', async () => {
      await registry.registerWorker({
        id: 'w1',
        host: 'localhost',
        type: 'local',
        maxContainers: 10,
      });
      mockStorage.workers.get('w1').current_load = 3;

      const load = await registry.getWorkerLoad('w1');
      assert.equal(load.workerId, 'w1');
      assert.equal(load.currentLoad, 3);
      assert.equal(load.maxContainers, 10);
      assert.equal(load.available, 7);
      assert.equal(load.loadRatio, 0.3);
      assert.equal(load.status, 'healthy');
    });

    test('returns null for non-existent worker', async () => {
      const load = await registry.getWorkerLoad('nonexistent');
      assert.equal(load, null);
    });

    test('throws when ID is empty', async () => {
      await assert.rejects(
        () => registry.getWorkerLoad(''),
        err => {
          assert.equal(err.name, 'WorkerRegistryError');
          assert.equal(err.operation, 'getWorkerLoad');
          return true;
        }
      );
    });

    test('handles zero max_containers gracefully', async () => {
      await registry.registerWorker({
        id: 'w1',
        host: 'localhost',
        type: 'local',
        maxContainers: 1,
      });
      // Manually set to test edge case
      mockStorage.workers.get('w1').max_containers = 0;

      const load = await registry.getWorkerLoad('w1');
      // When max_containers is 0, loadRatio should be 1 (fully loaded)
      assert.equal(load.loadRatio, 1);
    });
  });

  // --------------------------------------------------------------------------
  // incrementLoad()
  // --------------------------------------------------------------------------

  describe('incrementLoad()', () => {
    test('increments load for worker with capacity', async () => {
      await registry.registerWorker({
        id: 'w1',
        host: 'localhost',
        type: 'local',
        maxContainers: 5,
      });

      const updated = await registry.incrementLoad('w1');
      assert.equal(updated.currentLoad, 1);
    });

    test('returns null when worker is at capacity', async () => {
      await registry.registerWorker({
        id: 'w1',
        host: 'localhost',
        type: 'local',
        maxContainers: 2,
      });
      mockStorage.workers.get('w1').current_load = 2;

      const result = await registry.incrementLoad('w1');
      assert.equal(result, null);
    });

    test('returns null for non-existent worker', async () => {
      const result = await registry.incrementLoad('nonexistent');
      assert.equal(result, null);
    });

    test('throws when ID is empty', async () => {
      await assert.rejects(
        () => registry.incrementLoad(''),
        err => {
          assert.equal(err.name, 'WorkerRegistryError');
          assert.equal(err.operation, 'incrementLoad');
          return true;
        }
      );
    });
  });

  // --------------------------------------------------------------------------
  // decrementLoad()
  // --------------------------------------------------------------------------

  describe('decrementLoad()', () => {
    test('decrements load for worker with load > 0', async () => {
      await registry.registerWorker({
        id: 'w1',
        host: 'localhost',
        type: 'local',
        maxContainers: 5,
      });
      mockStorage.workers.get('w1').current_load = 3;

      const updated = await registry.decrementLoad('w1');
      assert.equal(updated.currentLoad, 2);
    });

    test('returns null when worker load is already 0', async () => {
      await registry.registerWorker({
        id: 'w1',
        host: 'localhost',
        type: 'local',
      });

      const result = await registry.decrementLoad('w1');
      assert.equal(result, null);
    });

    test('returns null for non-existent worker', async () => {
      const result = await registry.decrementLoad('nonexistent');
      assert.equal(result, null);
    });

    test('throws when ID is empty', async () => {
      await assert.rejects(
        () => registry.decrementLoad(''),
        err => {
          assert.equal(err.name, 'WorkerRegistryError');
          assert.equal(err.operation, 'decrementLoad');
          return true;
        }
      );
    });
  });

  // --------------------------------------------------------------------------
  // detectDeadWorkers()
  // --------------------------------------------------------------------------

  describe('detectDeadWorkers()', () => {
    test('marks workers with stale heartbeats as offline', async () => {
      await registry.registerWorker({ id: 'w1', host: 'localhost', type: 'local' });
      // Set heartbeat to 60 seconds ago
      mockStorage.workers.get('w1').last_heartbeat = new Date(Date.now() - 60_000);

      const dead = await registry.detectDeadWorkers();
      assert.equal(dead.length, 1);
      assert.equal(dead[0].id, 'w1');
      assert.equal(dead[0].status, 'offline');
    });

    test('marks workers with null heartbeat as offline', async () => {
      await registry.registerWorker({ id: 'w1', host: 'localhost', type: 'local' });
      mockStorage.workers.get('w1').last_heartbeat = null;

      const dead = await registry.detectDeadWorkers();
      assert.equal(dead.length, 1);
    });

    test('does not mark recently heartbeated workers', async () => {
      await registry.registerWorker({ id: 'w1', host: 'localhost', type: 'local' });
      // Heartbeat is recent (just registered)

      const dead = await registry.detectDeadWorkers();
      assert.equal(dead.length, 0);
    });

    test('does not re-mark already offline workers', async () => {
      await registry.registerWorker({ id: 'w1', host: 'localhost', type: 'local' });
      mockStorage.workers.get('w1').status = 'offline';
      mockStorage.workers.get('w1').last_heartbeat = new Date(Date.now() - 60_000);

      const dead = await registry.detectDeadWorkers();
      assert.equal(dead.length, 0);
    });

    test('returns empty array when all workers are healthy', async () => {
      await registry.registerWorker({ id: 'w1', host: 'localhost', type: 'local' });
      await registry.registerWorker({ id: 'w2', host: '10.0.0.1', type: 'remote' });

      const dead = await registry.detectDeadWorkers();
      assert.equal(dead.length, 0);
    });

    test('wraps storage errors', async () => {
      const failStorage = createMockStorage({
        query: mock.fn(async () => {
          throw new Error('Scan failed');
        }),
      });
      const failRegistry = new WorkerRegistry(failStorage);

      await assert.rejects(
        () => failRegistry.detectDeadWorkers(),
        err => {
          assert.equal(err.name, 'WorkerRegistryError');
          assert.equal(err.operation, 'detectDeadWorkers');
          return true;
        }
      );
    });
  });

  // --------------------------------------------------------------------------
  // _toWorker() (via public API)
  // --------------------------------------------------------------------------

  describe('row transformation', () => {
    test('converts snake_case database row to camelCase object', async () => {
      await registry.registerWorker({
        id: 'w1',
        host: 'localhost',
        type: 'local',
        maxContainers: 15,
      });

      const worker = await registry.getWorker('w1');
      assert.equal(worker.id, 'w1');
      assert.equal(worker.host, 'localhost');
      assert.equal(worker.type, 'local');
      assert.equal(worker.maxContainers, 15);
      assert.equal(worker.currentLoad, 0);
      assert.equal(worker.status, 'healthy');
      assert.ok(worker.lastHeartbeat instanceof Date);
      assert.ok(worker.createdAt instanceof Date);
      assert.ok(worker.updatedAt instanceof Date);
    });

    test('handles null heartbeat', () => {
      const worker = registry._toWorker({
        id: 'w1',
        host: 'localhost',
        type: 'local',
        max_containers: 10,
        current_load: 0,
        status: 'healthy',
        last_heartbeat: null,
        created_at: null,
        updated_at: null,
      });

      assert.equal(worker.lastHeartbeat, null);
      assert.equal(worker.createdAt, null);
      assert.equal(worker.updatedAt, null);
    });
  });
});
