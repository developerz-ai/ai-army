/**
 * Unit tests for PostgresStorage
 *
 * Tests constructor config parsing, connection lifecycle, query delegation,
 * transaction handling with rollback on error, and error wrapping.
 *
 * Uses mock.fn() to mock pg.Pool - no real database required.
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// We'll import these after setting up module mocks
let PostgresStorage, StorageError;

/**
 * Create a mock pg.Pool
 * @param {Object} [overrides={}] - Override default mock implementations
 * @returns {Object} Mock Pool instance
 */
function createMockPool(overrides = {}) {
  const mockClient = {
    query: mock.fn(async () => ({ rows: [], rowCount: 0 })),
    release: mock.fn(),
  };

  return {
    query: mock.fn(async () => ({ rows: [], rowCount: 0 })),
    connect: mock.fn(async () => mockClient),
    end: mock.fn(async () => {}),
    on: mock.fn(),
    totalCount: 0,
    idleCount: 0,
    waitingCount: 0,
    _mockClient: mockClient,
    ...overrides,
  };
}

describe('PostgresStorage - Unit Tests', () => {
  let mockPool;

  beforeEach(async () => {
    // Create a fresh mock pool for each test
    mockPool = createMockPool();

    // Import the module under test
    // Since we can't easily mock ES modules without experimental features,
    // we'll inject the mock pool directly into instances after construction
    const module = await import('../../../../src/adapters/storage/postgres.js');
    ({ PostgresStorage, StorageError } = module);
  });

  // Helper to inject mock pool into storage instance
  function injectMockPool(storage) {
    storage.pool = mockPool;
    storage.connected = true;
  }

  describe('constructor', () => {
    test('accepts connection string and merges with defaults', () => {
      const storage = new PostgresStorage('postgresql://user:pass@localhost/db');

      assert.ok(storage);
      assert.equal(storage.poolConfig.connectionString, 'postgresql://user:pass@localhost/db');
      assert.equal(storage.poolConfig.max, 20);
      assert.equal(storage.poolConfig.idleTimeoutMillis, 30000);
      assert.equal(storage.poolConfig.connectionTimeoutMillis, 2000);
    });

    test('accepts config object and merges with defaults', () => {
      const storage = new PostgresStorage({
        host: 'localhost',
        port: 5432,
        database: 'testdb',
        user: 'testuser',
        password: 'testpass',
        max: 10,
      });

      assert.ok(storage);
      assert.equal(storage.poolConfig.host, 'localhost');
      assert.equal(storage.poolConfig.port, 5432);
      assert.equal(storage.poolConfig.database, 'testdb');
      assert.equal(storage.poolConfig.user, 'testuser');
      assert.equal(storage.poolConfig.password, 'testpass');
      assert.equal(storage.poolConfig.max, 10);
      assert.equal(storage.poolConfig.idleTimeoutMillis, 30000);
      assert.equal(storage.poolConfig.connectionTimeoutMillis, 2000);
    });

    test('config object overrides defaults', () => {
      const storage = new PostgresStorage({
        connectionString: 'postgresql://localhost/db',
        max: 50,
        idleTimeoutMillis: 60000,
      });

      assert.equal(storage.poolConfig.max, 50);
      assert.equal(storage.poolConfig.idleTimeoutMillis, 60000);
      assert.equal(storage.poolConfig.connectionTimeoutMillis, 2000);
    });

    test('initializes with pool as null and connected as false', () => {
      const storage = new PostgresStorage('postgresql://localhost/db');

      assert.equal(storage.pool, null);
      assert.equal(storage.connected, false);
    });
  });

  describe('query()', () => {
    test('delegates query to pool', async () => {
      mockPool.query = mock.fn(async () => ({
        rows: [{ id: 1, name: 'test' }],
        rowCount: 1,
      }));

      const storage = new PostgresStorage('postgresql://localhost/db');
      injectMockPool(storage);

      const result = await storage.query('SELECT * FROM bots WHERE id = $1', ['test-bot']);

      assert.equal(mockPool.query.mock.calls.length, 1);
      const [sql, params] = mockPool.query.mock.calls[0].arguments;
      assert.equal(sql, 'SELECT * FROM bots WHERE id = $1');
      assert.deepEqual(params, ['test-bot']);
      assert.deepEqual(result.rows, [{ id: 1, name: 'test' }]);
      assert.equal(result.rowCount, 1);
    });

    test('uses empty array for params when not provided', async () => {
      const storage = new PostgresStorage('postgresql://localhost/db');
      injectMockPool(storage);

      await storage.query('SELECT NOW()');

      const params = mockPool.query.mock.calls[0].arguments[1];
      assert.deepEqual(params, []);
    });

    test('throws StorageError when pool is not connected', async () => {
      const storage = new PostgresStorage('postgresql://localhost/db');
      // Don't inject pool - leave it as null

      await assert.rejects(
        () => storage.query('SELECT 1'),
        err => {
          assert.ok(err instanceof StorageError);
          assert.match(err.message, /Database not connected/);
          assert.match(err.message, /Call connect\(\) first/);
          assert.equal(err.operation, 'query');
          return true;
        }
      );
    });

    test('wraps query errors in StorageError', async () => {
      const queryError = new Error('syntax error at or near "SELECTT"');
      mockPool.query = mock.fn(async () => {
        throw queryError;
      });

      const storage = new PostgresStorage('postgresql://localhost/db');
      injectMockPool(storage);

      await assert.rejects(
        () => storage.query('SELECTT * FROM bots'),
        err => {
          assert.ok(err instanceof StorageError);
          assert.equal(err.name, 'StorageError');
          assert.match(err.message, /Query failed/);
          assert.match(err.message, /syntax error/);
          assert.equal(err.operation, 'query');
          assert.equal(err.cause, queryError);
          return true;
        }
      );
    });
  });

  describe('transaction()', () => {
    test('executes callback with client and commits on success', async () => {
      const mockClient = createMockPool()._mockClient;
      mockPool.connect = mock.fn(async () => mockClient);

      const storage = new PostgresStorage('postgresql://localhost/db');
      injectMockPool(storage);

      const callback = mock.fn(async client => {
        await client.query('INSERT INTO bots (id, name) VALUES ($1, $2)', ['bot-1', 'Bot 1']);
        return 'success';
      });

      const result = await storage.transaction(callback);

      assert.equal(result, 'success');
      assert.equal(callback.mock.calls.length, 1);
      assert.equal(callback.mock.calls[0].arguments[0], mockClient);

      // Verify BEGIN, callback query, COMMIT
      assert.equal(mockClient.query.mock.calls.length, 3);
      assert.equal(mockClient.query.mock.calls[0].arguments[0], 'BEGIN');
      assert.equal(
        mockClient.query.mock.calls[1].arguments[0],
        'INSERT INTO bots (id, name) VALUES ($1, $2)'
      );
      assert.equal(mockClient.query.mock.calls[2].arguments[0], 'COMMIT');

      // Verify client was released
      assert.equal(mockClient.release.mock.calls.length, 1);
    });

    test('rolls back transaction on callback error', async () => {
      const mockClient = createMockPool()._mockClient;
      mockPool.connect = mock.fn(async () => mockClient);

      const storage = new PostgresStorage('postgresql://localhost/db');
      injectMockPool(storage);

      const callbackError = new Error('Intentional error');
      const callback = mock.fn(async client => {
        await client.query('INSERT INTO bots (id) VALUES ($1)', ['bot-1']);
        throw callbackError;
      });

      await assert.rejects(
        () => storage.transaction(callback),
        err => {
          assert.ok(err instanceof StorageError);
          assert.match(err.message, /Transaction failed/);
          assert.match(err.message, /Intentional error/);
          assert.equal(err.operation, 'transaction');
          assert.equal(err.cause, callbackError);
          return true;
        }
      );

      // Verify BEGIN, callback query, ROLLBACK (no COMMIT)
      assert.equal(mockClient.query.mock.calls.length, 3);
      assert.equal(mockClient.query.mock.calls[0].arguments[0], 'BEGIN');
      assert.equal(
        mockClient.query.mock.calls[1].arguments[0],
        'INSERT INTO bots (id) VALUES ($1)'
      );
      assert.equal(mockClient.query.mock.calls[2].arguments[0], 'ROLLBACK');

      // Verify client was released even after error
      assert.equal(mockClient.release.mock.calls.length, 1);
    });

    test('releases client even if rollback fails', async () => {
      const mockClient = createMockPool()._mockClient;
      mockPool.connect = mock.fn(async () => mockClient);

      const storage = new PostgresStorage('postgresql://localhost/db');
      injectMockPool(storage);

      // Make ROLLBACK fail
      mockClient.query = mock.fn(async sql => {
        if (sql === 'ROLLBACK') {
          throw new Error('Rollback failed');
        }
        if (sql === 'INSERT INTO bots (id) VALUES ($1)') {
          throw new Error('Insert failed');
        }
        return { rows: [], rowCount: 0 };
      });

      const callback = mock.fn(async client => {
        await client.query('INSERT INTO bots (id) VALUES ($1)', ['bot-1']);
      });

      await assert.rejects(() => storage.transaction(callback));

      // Verify client was released
      assert.equal(mockClient.release.mock.calls.length, 1);
    });

    test('throws StorageError when pool is not connected', async () => {
      const storage = new PostgresStorage('postgresql://localhost/db');
      // Don't inject pool

      await assert.rejects(
        () => storage.transaction(async () => {}),
        err => {
          assert.ok(err instanceof StorageError);
          assert.match(err.message, /Database not connected/);
          assert.match(err.message, /Call connect\(\) first/);
          assert.equal(err.operation, 'transaction');
          return true;
        }
      );
    });

    test('returns callback result on success', async () => {
      const mockClient = createMockPool()._mockClient;
      mockPool.connect = mock.fn(async () => mockClient);

      const storage = new PostgresStorage('postgresql://localhost/db');
      injectMockPool(storage);

      const result = await storage.transaction(async () => {
        return { inserted: 5, updated: 3 };
      });

      assert.deepEqual(result, { inserted: 5, updated: 3 });
    });
  });

  describe('isConnected()', () => {
    test('returns false when not connected', () => {
      const storage = new PostgresStorage('postgresql://localhost/db');

      assert.equal(storage.isConnected(), false);
    });

    test('returns false when pool is null', () => {
      const storage = new PostgresStorage('postgresql://localhost/db');
      storage.connected = true;
      storage.pool = null;

      assert.equal(storage.isConnected(), false);
    });

    test('returns true when connected and pool exists', () => {
      const storage = new PostgresStorage('postgresql://localhost/db');
      injectMockPool(storage);

      assert.equal(storage.isConnected(), true);
    });

    test('returns false after disconnect', async () => {
      const storage = new PostgresStorage('postgresql://localhost/db');
      injectMockPool(storage);

      await storage.disconnect();

      assert.equal(storage.isConnected(), false);
    });
  });

  describe('getPoolStats()', () => {
    test('returns zero stats when pool is null', () => {
      const storage = new PostgresStorage('postgresql://localhost/db');

      const stats = storage.getPoolStats();

      assert.deepEqual(stats, {
        totalCount: 0,
        idleCount: 0,
        waitingCount: 0,
      });
    });

    test('returns pool stats when connected', () => {
      mockPool.totalCount = 5;
      mockPool.idleCount = 3;
      mockPool.waitingCount = 1;

      const storage = new PostgresStorage('postgresql://localhost/db');
      injectMockPool(storage);

      const stats = storage.getPoolStats();

      assert.deepEqual(stats, {
        totalCount: 5,
        idleCount: 3,
        waitingCount: 1,
      });
    });
  });

  describe('healthCheck()', () => {
    test('returns true when query succeeds', async () => {
      const storage = new PostgresStorage('postgresql://localhost/db');
      injectMockPool(storage);

      const healthy = await storage.healthCheck();

      assert.equal(healthy, true);
      // Verify it ran a simple query
      assert.equal(mockPool.query.mock.calls.length, 1);
      assert.equal(mockPool.query.mock.calls[0].arguments[0], 'SELECT 1');
    });

    test('returns false when query fails', async () => {
      mockPool.query = mock.fn(async () => {
        throw new Error('Connection lost');
      });

      const storage = new PostgresStorage('postgresql://localhost/db');
      injectMockPool(storage);

      const healthy = await storage.healthCheck();

      assert.equal(healthy, false);
    });

    test('returns false when not connected', async () => {
      const storage = new PostgresStorage('postgresql://localhost/db');
      // Don't inject pool

      const healthy = await storage.healthCheck();

      assert.equal(healthy, false);
    });
  });

  describe('disconnect()', () => {
    test('closes pool and resets state', async () => {
      const storage = new PostgresStorage('postgresql://localhost/db');
      injectMockPool(storage);

      await storage.disconnect();

      assert.equal(mockPool.end.mock.calls.length, 1);
      assert.equal(storage.pool, null);
      assert.equal(storage.connected, false);
    });

    test('is safe to call when not connected', async () => {
      const storage = new PostgresStorage('postgresql://localhost/db');

      // Should not throw
      await storage.disconnect();

      assert.equal(storage.pool, null);
      assert.equal(storage.connected, false);
    });

    test('is safe to call when pool is null', async () => {
      const storage = new PostgresStorage('postgresql://localhost/db');
      storage.pool = null;

      await storage.disconnect();

      assert.equal(storage.pool, null);
    });

    test('wraps disconnect errors in StorageError', async () => {
      const disconnectError = new Error('Failed to close connections');
      mockPool.end = mock.fn(async () => {
        throw disconnectError;
      });

      const storage = new PostgresStorage('postgresql://localhost/db');
      injectMockPool(storage);

      await assert.rejects(
        () => storage.disconnect(),
        err => {
          assert.ok(err instanceof StorageError);
          assert.equal(err.name, 'StorageError');
          assert.match(err.message, /Failed to disconnect from PostgreSQL/);
          assert.equal(err.operation, 'disconnect');
          assert.equal(err.cause, disconnectError);
          return true;
        }
      );
    });
  });
});

describe('StorageError', () => {
  test('is an instance of Error', () => {
    const error = new StorageError('Test error');
    assert.ok(error instanceof Error);
  });

  test('has correct name', () => {
    const error = new StorageError('Test error');
    assert.equal(error.name, 'StorageError');
  });

  test('stores message', () => {
    const error = new StorageError('Something went wrong');
    assert.equal(error.message, 'Something went wrong');
  });

  test('stores operation', () => {
    const error = new StorageError('Test error', { operation: 'query' });
    assert.equal(error.operation, 'query');
  });

  test('stores entityId', () => {
    const error = new StorageError('Test error', { entityId: 'bot-123' });
    assert.equal(error.entityId, 'bot-123');
  });

  test('stores cause', () => {
    const cause = new Error('Original error');
    const error = new StorageError('Test error', { cause });
    assert.equal(error.cause, cause);
  });

  test('stores all options together', () => {
    const cause = new Error('Original');
    const error = new StorageError('Multi-option error', {
      cause,
      operation: 'connect',
      entityId: 'storage-1',
    });

    assert.equal(error.cause, cause);
    assert.equal(error.operation, 'connect');
    assert.equal(error.entityId, 'storage-1');
  });
});
