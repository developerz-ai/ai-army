/**
 * Integration tests for MigrationRunner
 *
 * Tests migration execution, skip-if-run, status reporting,
 * and rollback on error against a real PostgreSQL database.
 *
 * Uses per-worker databases for parallel test execution.
 */

import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  TEST_DATABASE_URL,
  isDatabaseAvailable,
  createWorkerDatabase,
  dropWorkerDatabase,
} from '../../helpers/setup.js';
import { PostgresStorage } from '../../../src/adapters/storage/postgres.js';
import { MigrationRunner, MigrationError } from '../../../src/database/MigrationRunner.js';

const DB_AVAILABLE = await isDatabaseAvailable();

if (!DB_AVAILABLE) {
  console.log('Skipping MigrationRunner tests - PostgreSQL not available');
}

/** Track temp directories for cleanup */
const tempDirs = [];

/**
 * Create a temporary migrations directory with given SQL files
 * @param {Object<string, string>} files - Map of filename to SQL content
 * @returns {Promise<string>} Path to temporary directory
 */
async function createTempMigrations(files) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'migration-test-'));
  tempDirs.push(tmpDir);
  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(tmpDir, name), content, 'utf8');
  }
  return tmpDir;
}

describe('MigrationRunner', { skip: !DB_AVAILABLE }, () => {
  let storage;

  before(async () => {
    await createWorkerDatabase();
    storage = new PostgresStorage(TEST_DATABASE_URL);
    await storage.connect();
  });

  after(async () => {
    // Clean up temp dirs
    for (const dir of tempDirs) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    tempDirs.length = 0;

    if (storage && storage.isConnected()) {
      await storage.disconnect();
    }
    await dropWorkerDatabase();
  });

  beforeEach(async () => {
    // Drop all tables for a clean slate before each test
    await storage.query('DROP TABLE IF EXISTS test_table CASCADE');
    await storage.query('DROP TABLE IF EXISTS test_table_two CASCADE');
    await storage.query('DROP TABLE IF EXISTS schema_migrations CASCADE');
  });

  // ============================================================================
  // Constructor
  // ============================================================================

  describe('constructor', () => {
    test('creates instance with storage', () => {
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
  });

  // ============================================================================
  // ensureMigrationsTable()
  // ============================================================================

  describe('ensureMigrationsTable()', () => {
    test('creates schema_migrations table if not exists', async () => {
      const runner = new MigrationRunner(storage);

      await runner.ensureMigrationsTable();

      const { rows } = await storage.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'schema_migrations'
        ORDER BY ordinal_position
      `);

      assert.equal(rows.length, 3);
      const columns = rows.map(r => r.column_name);
      assert.ok(columns.includes('version'));
      assert.ok(columns.includes('name'));
      assert.ok(columns.includes('executed_at'));
    });

    test('is idempotent - does not error on second call', async () => {
      const runner = new MigrationRunner(storage);

      await runner.ensureMigrationsTable();
      await assert.doesNotReject(
        () => runner.ensureMigrationsTable(),
        'Second call should not error'
      );
    });
  });

  // ============================================================================
  // getMigrationStatus()
  // ============================================================================

  describe('getMigrationStatus()', () => {
    test('returns empty array when no migrations have been run', async () => {
      const runner = new MigrationRunner(storage);

      const status = await runner.getMigrationStatus();

      assert.deepEqual(status, []);
    });

    test('returns executed migrations ordered by version', async () => {
      const runner = new MigrationRunner(storage);
      await runner.ensureMigrationsTable();

      // Manually insert migration records
      await storage.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [
        2,
        '002_add_indexes.sql',
      ]);
      await storage.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [
        1,
        '001_initial.sql',
      ]);

      const status = await runner.getMigrationStatus();

      assert.equal(status.length, 2);
      assert.equal(status[0].version, 1);
      assert.equal(status[0].name, '001_initial.sql');
      assert.equal(status[1].version, 2);
      assert.equal(status[1].name, '002_add_indexes.sql');
      assert.ok(status[0].executed_at instanceof Date);
      assert.ok(status[1].executed_at instanceof Date);
    });
  });

  // ============================================================================
  // runMigrations()
  // ============================================================================

  describe('runMigrations()', () => {
    test('runs pending migrations in version order', async () => {
      const runner = new MigrationRunner(storage);
      const migrationsDir = await createTempMigrations({
        '001_create_test.sql': `
          CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            executed_at TIMESTAMPTZ DEFAULT NOW()
          );
          CREATE TABLE test_table (id SERIAL PRIMARY KEY, name TEXT NOT NULL);
          INSERT INTO schema_migrations (version, name) VALUES (1, '001_create_test.sql') ON CONFLICT DO NOTHING;
        `,
        '002_add_column.sql': `
          ALTER TABLE test_table ADD COLUMN IF NOT EXISTS description TEXT;
          INSERT INTO schema_migrations (version, name) VALUES (2, '002_add_column.sql') ON CONFLICT DO NOTHING;
        `,
      });

      const completed = await runner.runMigrations(migrationsDir);

      assert.equal(completed.length, 2);
      assert.equal(completed[0].version, 1);
      assert.equal(completed[0].name, '001_create_test.sql');
      assert.equal(completed[1].version, 2);
      assert.equal(completed[1].name, '002_add_column.sql');

      // Verify table was created with both columns
      const { rows } = await storage.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'test_table'
        ORDER BY ordinal_position
      `);
      const columns = rows.map(r => r.column_name);
      assert.ok(columns.includes('id'));
      assert.ok(columns.includes('name'));
      assert.ok(columns.includes('description'));
    });

    test('skips already-run migrations', async () => {
      const runner = new MigrationRunner(storage);
      const migrationsDir = await createTempMigrations({
        '001_create_test.sql': `
          CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            executed_at TIMESTAMPTZ DEFAULT NOW()
          );
          CREATE TABLE test_table (id SERIAL PRIMARY KEY, name TEXT NOT NULL);
          INSERT INTO schema_migrations (version, name) VALUES (1, '001_create_test.sql') ON CONFLICT DO NOTHING;
        `,
        '002_add_column.sql': `
          ALTER TABLE test_table ADD COLUMN IF NOT EXISTS description TEXT;
          INSERT INTO schema_migrations (version, name) VALUES (2, '002_add_column.sql') ON CONFLICT DO NOTHING;
        `,
      });

      // Run once
      await runner.runMigrations(migrationsDir);

      // Run again - should skip all
      const completed = await runner.runMigrations(migrationsDir);

      assert.equal(completed.length, 0);
    });

    test('only runs new migrations when some already exist', async () => {
      const runner = new MigrationRunner(storage);

      // First run with just migration 001
      const dir1 = await createTempMigrations({
        '001_create_test.sql': `
          CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            executed_at TIMESTAMPTZ DEFAULT NOW()
          );
          CREATE TABLE test_table (id SERIAL PRIMARY KEY, name TEXT NOT NULL);
          INSERT INTO schema_migrations (version, name) VALUES (1, '001_create_test.sql') ON CONFLICT DO NOTHING;
        `,
      });
      await runner.runMigrations(dir1);

      // Now run with both 001 and 002
      const dir2 = await createTempMigrations({
        '001_create_test.sql': `
          CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            executed_at TIMESTAMPTZ DEFAULT NOW()
          );
          CREATE TABLE test_table (id SERIAL PRIMARY KEY, name TEXT NOT NULL);
          INSERT INTO schema_migrations (version, name) VALUES (1, '001_create_test.sql') ON CONFLICT DO NOTHING;
        `,
        '002_add_column.sql': `
          ALTER TABLE test_table ADD COLUMN IF NOT EXISTS description TEXT;
          INSERT INTO schema_migrations (version, name) VALUES (2, '002_add_column.sql') ON CONFLICT DO NOTHING;
        `,
      });

      const completed = await runner.runMigrations(dir2);

      assert.equal(completed.length, 1);
      assert.equal(completed[0].version, 2);
      assert.equal(completed[0].name, '002_add_column.sql');
    });

    test('tracks migrations in schema_migrations table', async () => {
      const runner = new MigrationRunner(storage);
      const migrationsDir = await createTempMigrations({
        '001_create_test.sql': `
          CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            executed_at TIMESTAMPTZ DEFAULT NOW()
          );
          CREATE TABLE test_table (id SERIAL PRIMARY KEY, name TEXT NOT NULL);
          INSERT INTO schema_migrations (version, name) VALUES (1, '001_create_test.sql') ON CONFLICT DO NOTHING;
        `,
      });

      await runner.runMigrations(migrationsDir);

      const status = await runner.getMigrationStatus();
      assert.equal(status.length, 1);
      assert.equal(status[0].version, 1);
      assert.equal(status[0].name, '001_create_test.sql');
      assert.ok(status[0].executed_at instanceof Date);
    });

    test('rolls back on migration error', async () => {
      const runner = new MigrationRunner(storage);
      await runner.ensureMigrationsTable();

      const migrationsDir = await createTempMigrations({
        '001_bad_sql.sql': `
          THIS IS NOT VALID SQL AT ALL;
        `,
      });

      await assert.rejects(
        () => runner.runMigrations(migrationsDir),
        err => {
          assert.equal(err.name, 'MigrationError');
          assert.ok(err.message.includes('001_bad_sql.sql'));
          assert.equal(err.version, 1);
          assert.equal(err.filename, '001_bad_sql.sql');
          assert.ok(err.cause);
          return true;
        }
      );

      // Verify migration was NOT recorded
      const { rows } = await storage.query('SELECT version FROM schema_migrations');
      assert.equal(rows.length, 0, 'Failed migration should not be recorded');
    });

    test('stops on first failing migration', async () => {
      const runner = new MigrationRunner(storage);
      const migrationsDir = await createTempMigrations({
        '001_create_test.sql': `
          CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            executed_at TIMESTAMPTZ DEFAULT NOW()
          );
          CREATE TABLE test_table (id SERIAL PRIMARY KEY, name TEXT NOT NULL);
          INSERT INTO schema_migrations (version, name) VALUES (1, '001_create_test.sql') ON CONFLICT DO NOTHING;
        `,
        '002_bad_migration.sql': 'INVALID SQL THAT WILL FAIL;',
        '003_never_reached.sql': `
          CREATE TABLE test_table_two (id SERIAL PRIMARY KEY);
        `,
      });

      await assert.rejects(() => runner.runMigrations(migrationsDir));

      // Migration 001 should have succeeded
      const status = await runner.getMigrationStatus();
      assert.equal(status.length, 1);
      assert.equal(status[0].version, 1);

      // Migration 003 should NOT have run
      const { rows } = await storage.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_name = 'test_table_two' AND table_schema = 'public'
      `);
      assert.equal(rows.length, 0, 'Migration 003 should not have run');
    });

    test('returns empty array when no migrations are pending', async () => {
      const runner = new MigrationRunner(storage);
      const migrationsDir = await createTempMigrations({});

      const completed = await runner.runMigrations(migrationsDir);

      assert.deepEqual(completed, []);
    });

    test('ignores non-SQL files', async () => {
      const runner = new MigrationRunner(storage);
      const migrationsDir = await createTempMigrations({
        'README.md': '# Migrations',
        '.gitkeep': '',
        '001_create_test.sql': `
          CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            executed_at TIMESTAMPTZ DEFAULT NOW()
          );
          CREATE TABLE test_table (id SERIAL PRIMARY KEY);
          INSERT INTO schema_migrations (version, name) VALUES (1, '001_create_test.sql') ON CONFLICT DO NOTHING;
        `,
      });

      const completed = await runner.runMigrations(migrationsDir);

      assert.equal(completed.length, 1);
      assert.equal(completed[0].name, '001_create_test.sql');
    });

    test('ignores SQL files with invalid naming', async () => {
      const runner = new MigrationRunner(storage);
      const migrationsDir = await createTempMigrations({
        'random.sql': 'SELECT 1;',
        'no-number.sql': 'SELECT 2;',
        '001_valid.sql': `
          CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            executed_at TIMESTAMPTZ DEFAULT NOW()
          );
          CREATE TABLE test_table (id SERIAL PRIMARY KEY);
          INSERT INTO schema_migrations (version, name) VALUES (1, '001_valid.sql') ON CONFLICT DO NOTHING;
        `,
      });

      const completed = await runner.runMigrations(migrationsDir);

      assert.equal(completed.length, 1);
      assert.equal(completed[0].name, '001_valid.sql');
    });

    test('throws MigrationError for invalid migrations path', async () => {
      const runner = new MigrationRunner(storage);

      await assert.rejects(
        () => runner.runMigrations('/nonexistent/directory'),
        err => {
          assert.equal(err.name, 'MigrationError');
          assert.match(err.message, /Failed to read migrations directory/);
          assert.ok(err.cause);
          return true;
        }
      );
    });

    test('throws MigrationError for null path', async () => {
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
  });

  // ============================================================================
  // runMigration()
  // ============================================================================

  describe('runMigration()', () => {
    test('runs a single migration file', async () => {
      const runner = new MigrationRunner(storage);
      await runner.ensureMigrationsTable();

      const migrationsDir = await createTempMigrations({
        '001_create_test.sql': `
          CREATE TABLE test_table (id SERIAL PRIMARY KEY, name TEXT NOT NULL);
        `,
      });

      await runner.runMigration(migrationsDir, '001_create_test.sql');

      // Verify table was created
      const { rows } = await storage.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_name = 'test_table' AND table_schema = 'public'
      `);
      assert.equal(rows.length, 1);

      // Verify migration was tracked
      const { rows: migRows } = await storage.query(
        'SELECT version, name FROM schema_migrations WHERE version = $1',
        [1]
      );
      assert.equal(migRows.length, 1);
      assert.equal(migRows[0].name, '001_create_test.sql');
    });

    test('rolls back single migration on failure', async () => {
      const runner = new MigrationRunner(storage);
      await runner.ensureMigrationsTable();

      const migrationsDir = await createTempMigrations({
        '001_bad.sql': 'CREATE TABLE test_table (INVALID COLUMN DEFINITION);',
      });

      await assert.rejects(
        () => runner.runMigration(migrationsDir, '001_bad.sql'),
        err => {
          assert.equal(err.name, 'MigrationError');
          assert.equal(err.version, 1);
          assert.equal(err.filename, '001_bad.sql');
          return true;
        }
      );

      // Table should not exist
      const { rows } = await storage.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_name = 'test_table' AND table_schema = 'public'
      `);
      assert.equal(rows.length, 0);

      // Migration should not be recorded
      const { rows: migRows } = await storage.query(
        'SELECT version FROM schema_migrations WHERE version = $1',
        [1]
      );
      assert.equal(migRows.length, 0);
    });

    test('throws MigrationError for invalid filename pattern', async () => {
      const runner = new MigrationRunner(storage);
      await runner.ensureMigrationsTable();

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

    test('throws MigrationError for missing migration file', async () => {
      const runner = new MigrationRunner(storage);
      await runner.ensureMigrationsTable();

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
  });

  // ============================================================================
  // Integration with real migrations
  // ============================================================================

  describe('real migrations directory', () => {
    test('runs the actual 001_initial_schema.sql migration', async () => {
      const runner = new MigrationRunner(storage);
      const migrationsPath = path.resolve(
        path.dirname(new URL(import.meta.url).pathname),
        '../../../migrations'
      );

      const completed = await runner.runMigrations(migrationsPath);

      // Should have run at least migration 001
      assert.ok(completed.length >= 1, 'Should run at least one migration');
      assert.equal(completed[0].version, 1);
      assert.equal(completed[0].name, '001_initial_schema.sql');

      // Verify core tables exist
      const { rows } = await storage.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name
      `);
      const tables = rows.map(r => r.table_name);
      assert.ok(tables.includes('bots'), 'bots table should exist');
      assert.ok(tables.includes('sessions'), 'sessions table should exist');
      assert.ok(tables.includes('tool_calls'), 'tool_calls table should exist');
      assert.ok(tables.includes('schema_migrations'), 'schema_migrations table should exist');
    });

    test('running real migrations twice is idempotent', async () => {
      const runner = new MigrationRunner(storage);
      const migrationsPath = path.resolve(
        path.dirname(new URL(import.meta.url).pathname),
        '../../../migrations'
      );

      // First run
      await runner.runMigrations(migrationsPath);

      // Second run - should skip all
      const completed = await runner.runMigrations(migrationsPath);
      assert.equal(completed.length, 0, 'No migrations should run on second pass');

      // Verify status
      const status = await runner.getMigrationStatus();
      assert.ok(status.length >= 1);
      assert.equal(status[0].version, 1);
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
