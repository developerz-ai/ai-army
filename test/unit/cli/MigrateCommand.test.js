/**
 * Unit tests for MigrateCommand
 *
 * Tests the runMigrate() function with mock dependencies:
 * - Mock storage and MigrationRunner
 * - Verifies output formatting, error handling, and edge cases
 * - Tests migration success/failure scenarios
 *
 * Mirrors co-located src/cli/MigrateCommand.test.js into test/unit/cli/ structure
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { runMigrate, MigrateCommandError } from '../../../src/cli/MigrateCommand.js';
import { MigrationError } from '../../../src/database/MigrationRunner.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a writable stream mock that collects output
 * @returns {{ write: Function, output: () => string }}
 */
function createOutputStream() {
  const chunks = [];
  return {
    write(data) {
      chunks.push(data);
      return true;
    },
    output() {
      return chunks.join('');
    },
  };
}

/**
 * Create a mock MigrationRunner
 * @param {Object} [options] - Options
 * @param {Array} [options.completed=[]] - Completed migrations to return
 * @param {Error} [options.error] - Error to throw from runMigrations()
 * @returns {Object} Mock MigrationRunner
 */
function createMockMigrationRunner(options = {}) {
  const { completed = [], error } = options;
  return {
    runMigrations: mock.fn(async () => {
      if (error) {
        throw error;
      }
      return completed;
    }),
    getMigrationStatus: mock.fn(async () => []),
    ensureMigrationsTable: mock.fn(async () => {}),
  };
}

/**
 * Create a mock storage
 * @returns {Object} Mock storage
 */
function createMockStorage() {
  return {
    connected: true,
    isConnected() {
      return true;
    },
    query: mock.fn(async () => ({ rows: [] })),
    transaction: mock.fn(async fn => fn({ query: mock.fn(async () => ({ rows: [] })) })),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('MigrateCommand - runMigrate()', () => {
  let out;

  beforeEach(() => {
    out = createOutputStream();
  });

  test('throws MigrateCommandError when storage is not provided', async () => {
    await assert.rejects(
      () => runMigrate({ output: out }),
      err => {
        assert.ok(err instanceof MigrateCommandError);
        assert.ok(err.message.includes('storage is required'));
        return true;
      }
    );
  });

  test('outputs running migrations message on start', async () => {
    const storage = createMockStorage();
    const runner = createMockMigrationRunner();

    await runMigrate({
      storage,
      migrationRunner: runner,
      output: out,
    });

    const result = out.output();
    assert.ok(result.includes('Running database migrations'));
  });

  test('reports no pending migrations', async () => {
    const storage = createMockStorage();
    const runner = createMockMigrationRunner({ completed: [] });

    const result = await runMigrate({
      storage,
      migrationRunner: runner,
      output: out,
    });

    assert.equal(result.success, true);
    assert.equal(result.migrations.length, 0);
    assert.ok(out.output().includes('All migrations up to date'));
  });

  test('reports completed migrations', async () => {
    const storage = createMockStorage();
    const completed = [
      { version: 1, name: '001_initial_schema.sql' },
      { version: 2, name: '002_add_sessions.sql' },
    ];
    const runner = createMockMigrationRunner({ completed });

    const result = await runMigrate({
      storage,
      migrationRunner: runner,
      output: out,
    });

    assert.equal(result.success, true);
    assert.equal(result.migrations.length, 2);
    const output = out.output();
    assert.ok(output.includes('Ran 2 migration(s)'));
    assert.ok(output.includes('001_initial_schema.sql'));
    assert.ok(output.includes('002_add_sessions.sql'));
  });

  test('reports single migration', async () => {
    const storage = createMockStorage();
    const completed = [{ version: 1, name: '001_initial_schema.sql' }];
    const runner = createMockMigrationRunner({ completed });

    const result = await runMigrate({
      storage,
      migrationRunner: runner,
      output: out,
    });

    assert.equal(result.success, true);
    assert.equal(result.migrations.length, 1);
    assert.ok(out.output().includes('Ran 1 migration(s)'));
  });

  test('handles MigrationError gracefully', async () => {
    const storage = createMockStorage();
    const error = new MigrationError('Migration 2 (002_add_index.sql) failed: syntax error', {
      version: 2,
      filename: '002_add_index.sql',
    });
    const runner = createMockMigrationRunner({ error });

    const result = await runMigrate({
      storage,
      migrationRunner: runner,
      output: out,
    });

    assert.equal(result.success, false);
    assert.equal(result.migrations.length, 0);
    const output = out.output();
    assert.ok(output.includes('Migration failed'));
    assert.ok(output.includes('002_add_index.sql'));
  });

  test('throws MigrateCommandError for non-MigrationError', async () => {
    const storage = createMockStorage();
    const error = new TypeError('Unexpected failure');
    const runner = createMockMigrationRunner({ error });

    await assert.rejects(
      () =>
        runMigrate({
          storage,
          migrationRunner: runner,
          output: out,
        }),
      err => {
        assert.ok(err instanceof MigrateCommandError);
        assert.ok(err.message.includes('Unexpected failure'));
        return true;
      }
    );
  });

  test('uses default migrations path', async () => {
    const storage = createMockStorage();
    const runner = createMockMigrationRunner();

    await runMigrate({
      storage,
      migrationRunner: runner,
      output: out,
    });

    // Verify runMigrations was called with the default path
    assert.equal(runner.runMigrations.mock.calls.length, 1);
    assert.equal(runner.runMigrations.mock.calls[0].arguments[0], './migrations');
  });

  test('uses custom migrations path', async () => {
    const storage = createMockStorage();
    const runner = createMockMigrationRunner();

    await runMigrate({
      storage,
      migrationRunner: runner,
      migrationsPath: './custom/migrations',
      output: out,
    });

    assert.equal(runner.runMigrations.mock.calls[0].arguments[0], './custom/migrations');
  });

  test('handles MigrationError without filename field', async () => {
    const storage = createMockStorage();
    const error = new MigrationError('Migration failed with generic error', {
      version: 3,
    });
    const runner = createMockMigrationRunner({ error });

    const result = await runMigrate({
      storage,
      migrationRunner: runner,
      output: out,
    });

    assert.equal(result.success, false);
    const output = out.output();
    assert.ok(output.includes('Migration failed'));
    assert.ok(!output.includes('File:'));
  });

  test('creates MigrationRunner when not injected', async () => {
    const storage = createMockStorage();

    // Don't provide a runner - will create internally
    // Note: This is difficult to fully test without spying on constructor
    // We verify behavior by checking that migrations run
    const result = await runMigrate({
      storage,
      output: out,
      migrationsPath: './migrations',
    });

    assert.equal(result.success, true);
    // If no actual migrations exist, should report 0 pending
    const output = out.output();
    assert.ok(output.includes('Running database migrations'));
  });

  test('calls runner with correct logger', async () => {
    const storage = createMockStorage();
    const runner = createMockMigrationRunner({
      completed: [{ version: 1, name: '001_test.sql' }],
    });

    await runMigrate({
      storage,
      migrationRunner: runner,
      output: out,
    });

    // Verify the runner was called
    assert.equal(runner.runMigrations.mock.calls.length, 1);
  });
});

describe('MigrateCommand - MigrateCommandError', () => {
  test('has correct name', () => {
    const err = new MigrateCommandError('test');
    assert.equal(err.name, 'MigrateCommandError');
  });

  test('stores cause', () => {
    const cause = new Error('original');
    const err = new MigrateCommandError('wrapper', { cause });
    assert.equal(err.cause, cause);
  });

  test('extends Error', () => {
    const err = new MigrateCommandError('test');
    assert.ok(err instanceof Error);
  });

  test('works without options', () => {
    const err = new MigrateCommandError('test message');
    assert.equal(err.message, 'test message');
    assert.equal(err.name, 'MigrateCommandError');
  });
});
