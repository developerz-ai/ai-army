/**
 * Unit tests for MigrationRunner
 *
 * Tests error handling, filename parsing, constructor validation,
 * and StorageError cause unwrapping using mocked storage.
 */

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { MigrationRunner, MigrationError } from '../../../src/database/MigrationRunner.js';
import { StorageError } from '../../../src/adapters/storage/postgres.js';

/** Track temp directories for cleanup */
const tempDirs = [];

/**
 * Create a temporary migrations directory with given SQL files
 * @param {Object<string, string>} files - Map of filename to SQL content
 * @returns {Promise<string>} Path to temporary directory
 */
async function createTempMigrations(files) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'migration-unit-'));
  tempDirs.push(tmpDir);
  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(tmpDir, name), content, 'utf8');
  }
  return tmpDir;
}

/**
 * Create a mock storage instance
 * @param {Object} [overrides] - Method overrides
 * @returns {Object} Mock storage
 */
function createMockStorage(overrides = {}) {
  return {
    query: overrides.query || (async () => ({ rows: [], rowCount: 0 })),
    transaction:
      overrides.transaction ||
      (async callback => {
        const mockClient = {
          query: async () => ({ rows: [], rowCount: 0 }),
        };
        return await callback(mockClient);
      }),
  };
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  tempDirs.length = 0;
});

// ============================================================================
// Constructor
// ============================================================================

describe('MigrationRunner', () => {
  describe('constructor', () => {
    test('creates instance with storage', () => {
      const storage = createMockStorage();
      const runner = new MigrationRunner(storage);
      assert.ok(runner);
      assert.equal(runner.storage, storage);
    });

    test('throws MigrationError when storage is null', () => {
      assert.throws(
        () => new MigrationRunner(null),
        err => {
          assert.equal(err.name, 'MigrationError');
          assert.match(err.message, /Storage instance is required/);
          return true;
        }
      );
    });

    test('throws MigrationError when storage is undefined', () => {
      assert.throws(
        () => new MigrationRunner(undefined),
        err => {
          assert.equal(err.name, 'MigrationError');
          assert.match(err.message, /Storage instance is required/);
          return true;
        }
      );
    });

    test('accepts optional logger', () => {
      const storage = createMockStorage();
      const logger = () => {};
      const runner = new MigrationRunner(storage, { logger });
      assert.equal(runner.logger, logger);
    });

    test('defaults logger to null', () => {
      const storage = createMockStorage();
      const runner = new MigrationRunner(storage);
      assert.equal(runner.logger, null);
    });
  });

  // ============================================================================
  // runMigrations() - path validation
  // ============================================================================

  describe('runMigrations()', () => {
    test('throws MigrationError for null path', async () => {
      const storage = createMockStorage();
      const runner = new MigrationRunner(storage);

      await assert.rejects(
        () => runner.runMigrations(null),
        err => {
          assert.equal(err.name, 'MigrationError');
          assert.match(err.message, /Migrations path must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws MigrationError for empty string path', async () => {
      const storage = createMockStorage();
      const runner = new MigrationRunner(storage);

      await assert.rejects(
        () => runner.runMigrations(''),
        err => {
          assert.equal(err.name, 'MigrationError');
          assert.match(err.message, /Migrations path must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws MigrationError for nonexistent directory', async () => {
      const storage = createMockStorage();
      const runner = new MigrationRunner(storage);

      await assert.rejects(
        () => runner.runMigrations('/nonexistent/path/to/migrations'),
        err => {
          assert.equal(err.name, 'MigrationError');
          assert.match(err.message, /Failed to read migrations directory/);
          assert.ok(err.cause);
          return true;
        }
      );
    });

    test('returns empty array when no migration files exist', async () => {
      const storage = createMockStorage();
      const runner = new MigrationRunner(storage);
      const migrationsDir = await createTempMigrations({});

      const completed = await runner.runMigrations(migrationsDir);

      assert.deepEqual(completed, []);
    });

    test('ignores non-SQL and invalid migration files', async () => {
      const storage = createMockStorage();
      const runner = new MigrationRunner(storage);
      const migrationsDir = await createTempMigrations({
        'README.md': '# Migrations',
        '.gitkeep': '',
        'random.sql': 'SELECT 1;',
      });

      const completed = await runner.runMigrations(migrationsDir);

      assert.deepEqual(completed, []);
    });

    test('calls logger for each migration run', async () => {
      const logged = [];
      const storage = createMockStorage();
      const runner = new MigrationRunner(storage, { logger: msg => logged.push(msg) });
      const migrationsDir = await createTempMigrations({
        '001_first.sql': 'SELECT 1;',
        '002_second.sql': 'SELECT 2;',
      });

      await runner.runMigrations(migrationsDir);

      assert.equal(logged.length, 2);
      assert.ok(logged[0].includes('001_first.sql'));
      assert.ok(logged[1].includes('002_second.sql'));
    });
  });

  // ============================================================================
  // runMigration() - single migration
  // ============================================================================

  describe('runMigration()', () => {
    test('throws MigrationError for invalid filename', async () => {
      const storage = createMockStorage();
      const runner = new MigrationRunner(storage);
      const migrationsDir = await createTempMigrations({
        'invalid-name.sql': 'SELECT 1;',
      });

      await assert.rejects(
        () => runner.runMigration(migrationsDir, 'invalid-name.sql'),
        err => {
          assert.equal(err.name, 'MigrationError');
          assert.match(err.message, /Invalid migration filename/);
          return true;
        }
      );
    });

    test('throws MigrationError for missing file', async () => {
      const storage = createMockStorage();
      const runner = new MigrationRunner(storage);
      const migrationsDir = await createTempMigrations({});

      await assert.rejects(
        () => runner.runMigration(migrationsDir, '001_missing.sql'),
        err => {
          assert.equal(err.name, 'MigrationError');
          assert.match(err.message, /Failed to read migration file/);
          assert.equal(err.version, 1);
          assert.equal(err.filename, '001_missing.sql');
          return true;
        }
      );
    });

    test('unwraps StorageError cause to preserve original driver error', async () => {
      // Simulate a pg driver error with SQL-specific properties
      const pgError = new Error('syntax error at or near "INVALID"');
      pgError.code = '42601';
      pgError.position = '1';
      pgError.severity = 'ERROR';

      // StorageError wraps the pg error (as PostgresStorage.transaction() does)
      const storageError = new StorageError(`Transaction failed: ${pgError.message}`, {
        cause: pgError,
        operation: 'transaction',
      });

      const storage = createMockStorage({
        transaction: async () => {
          throw storageError;
        },
      });

      const runner = new MigrationRunner(storage);
      const migrationsDir = await createTempMigrations({
        '001_bad.sql': 'INVALID SQL;',
      });

      await assert.rejects(
        () => runner.runMigration(migrationsDir, '001_bad.sql'),
        err => {
          assert.equal(err.name, 'MigrationError');
          assert.equal(err.version, 1);
          assert.equal(err.filename, '001_bad.sql');
          // The cause should be the original pg error, NOT the StorageError wrapper
          assert.equal(err.cause, pgError, 'MigrationError.cause should be the original pg error');
          assert.equal(err.cause.code, '42601', 'Original pg error code should be preserved');
          assert.equal(err.cause.position, '1', 'Original pg error position should be preserved');
          assert.notEqual(err.cause, storageError, 'Should not be the StorageError wrapper');
          return true;
        }
      );
    });

    test('preserves non-StorageError causes directly', async () => {
      // If the error is not a StorageError, it should be preserved as-is
      const directError = new Error('Some other error');
      directError.customProp = 'test';

      const storage = createMockStorage({
        transaction: async () => {
          throw directError;
        },
      });

      const runner = new MigrationRunner(storage);
      const migrationsDir = await createTempMigrations({
        '001_test.sql': 'SELECT 1;',
      });

      await assert.rejects(
        () => runner.runMigration(migrationsDir, '001_test.sql'),
        err => {
          assert.equal(err.name, 'MigrationError');
          // Non-StorageError should be passed through directly
          assert.equal(err.cause, directError);
          assert.equal(err.cause.customProp, 'test');
          return true;
        }
      );
    });

    test('handles StorageError without cause gracefully', async () => {
      // StorageError with no cause (e.g., "not connected" error)
      const storageError = new StorageError('Database not connected', {
        operation: 'transaction',
      });

      const storage = createMockStorage({
        transaction: async () => {
          throw storageError;
        },
      });

      const runner = new MigrationRunner(storage);
      const migrationsDir = await createTempMigrations({
        '001_test.sql': 'SELECT 1;',
      });

      await assert.rejects(
        () => runner.runMigration(migrationsDir, '001_test.sql'),
        err => {
          assert.equal(err.name, 'MigrationError');
          // StorageError without cause should be preserved as-is
          assert.equal(err.cause, storageError);
          return true;
        }
      );
    });
  });
});

// ============================================================================
// MigrationError
// ============================================================================

describe('MigrationError', () => {
  test('is an instance of Error', () => {
    const err = new MigrationError('Test error');
    assert.ok(err instanceof Error);
  });

  test('has correct name', () => {
    const err = new MigrationError('Test error');
    assert.equal(err.name, 'MigrationError');
  });

  test('stores version', () => {
    const err = new MigrationError('Test error', { version: 5 });
    assert.equal(err.version, 5);
  });

  test('stores filename', () => {
    const err = new MigrationError('Test error', { filename: '005_test.sql' });
    assert.equal(err.filename, '005_test.sql');
  });

  test('stores cause', () => {
    const cause = new Error('Original error');
    const err = new MigrationError('Test error', { cause });
    assert.equal(err.cause, cause);
  });

  test('has correct message', () => {
    const err = new MigrationError('Migration 1 failed');
    assert.equal(err.message, 'Migration 1 failed');
  });

  test('defaults to undefined for optional properties', () => {
    const err = new MigrationError('Test error');
    assert.equal(err.version, undefined);
    assert.equal(err.filename, undefined);
    assert.equal(err.cause, undefined);
  });

  test('stores all options together', () => {
    const cause = new Error('Original');
    const err = new MigrationError('All options', {
      cause,
      version: 3,
      filename: '003_test.sql',
    });

    assert.equal(err.cause, cause);
    assert.equal(err.version, 3);
    assert.equal(err.filename, '003_test.sql');
  });
});
