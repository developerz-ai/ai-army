/**
 * MigrationRunner - Execute and track database schema migrations
 *
 * Handles:
 * - Reading SQL migration files from a directory
 * - Tracking executed migrations in the schema_migrations table
 * - Running pending migrations in order within transactions
 * - Reporting migration status
 *
 * Migration files must follow the naming convention: NNN_description.sql
 * where NNN is a zero-padded version number (e.g., 001_initial_schema.sql).
 *
 * Each migration runs in its own transaction. If a migration fails,
 * it is rolled back and no subsequent migrations are attempted.
 *
 * @module MigrationRunner
 */

import fs from 'fs/promises';
import path from 'path';
import { StorageError } from '../adapters/storage/postgres.js';

/**
 * Custom error for migration-related failures
 */
export class MigrationError extends Error {
  /**
   * Create a MigrationError
   * @param {string} message - Error message
   * @param {Object} [options] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {number} [options.version] - Migration version number
   * @param {string} [options.filename] - Migration filename
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'MigrationError';
    this.version = options.version;
    this.filename = options.filename;
  }
}

/**
 * SQL migration file naming pattern: NNN_description.sql
 * Extracts the numeric version prefix.
 */
const MIGRATION_FILE_PATTERN = /^(\d+)_.+\.sql$/;

/**
 * Parse a migration filename into version number and name
 * @param {string} filename - Migration filename (e.g., '001_initial_schema.sql')
 * @returns {{ version: number, name: string } | null} Parsed migration or null
 */
function parseMigrationFilename(filename) {
  const match = filename.match(MIGRATION_FILE_PATTERN);
  if (!match) {
    return null;
  }
  return {
    version: parseInt(match[1], 10),
    name: filename,
  };
}

/**
 * Database migration runner
 *
 * Manages schema migrations using a PostgresStorage instance.
 * Migrations are SQL files read from a directory, executed in version order,
 * and tracked in the schema_migrations table.
 */
export class MigrationRunner {
  /**
   * Create a MigrationRunner
   * @param {import('../adapters/storage/postgres.js').PostgresStorage} storage - Connected storage
   * @param {Object} [options] - Runner options
   * @param {Function|null} [options.logger=null] - Logger function for migration output (e.g., console.log). Set to null to suppress logging.
   */
  constructor(storage, options = {}) {
    if (!storage) {
      throw new MigrationError('Storage instance is required');
    }
    this.storage = storage;
    this.logger = options.logger ?? null;
  }

  /**
   * Ensure the schema_migrations table exists
   *
   * Creates the tracking table if it does not already exist.
   * Uses IF NOT EXISTS for idempotency.
   *
   * @returns {Promise<void>}
   * @throws {MigrationError} If table creation fails
   */
  async ensureMigrationsTable() {
    try {
      await this.storage.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          executed_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
    } catch (err) {
      throw new MigrationError('Failed to create schema_migrations table', {
        cause: err,
      });
    }
  }

  /**
   * Get the status of all executed migrations
   *
   * Returns an array of migration records sorted by version,
   * each containing version, name, and executed_at timestamp.
   *
   * @returns {Promise<Array<{ version: number, name: string, executed_at: Date }>>}
   * @throws {MigrationError} If query fails
   */
  async getMigrationStatus() {
    try {
      await this.ensureMigrationsTable();
      const { rows } = await this.storage.query(
        'SELECT version, name, executed_at FROM schema_migrations ORDER BY version ASC'
      );
      return rows.map(row => ({
        ...row,
        executed_at: row.executed_at instanceof Date ? row.executed_at : new Date(row.executed_at),
      }));
    } catch (err) {
      if (err instanceof MigrationError) {
        throw err;
      }
      throw new MigrationError(`Failed to get migration status: ${err.message}`, {
        cause: err,
      });
    }
  }

  /**
   * Run all pending migrations from a directory
   *
   * Reads SQL files from the given path, determines which have not yet
   * been executed, and runs them in version order. Each migration runs
   * in its own transaction for atomicity.
   *
   * @param {string} migrationsPath - Absolute or relative path to migrations directory
   * @returns {Promise<Array<{ version: number, name: string }>>} List of migrations that were run
   * @throws {MigrationError} If any migration fails (subsequent migrations are skipped)
   */
  async runMigrations(migrationsPath) {
    if (!migrationsPath || typeof migrationsPath !== 'string') {
      throw new MigrationError('Migrations path must be a non-empty string');
    }

    const resolvedPath = path.resolve(migrationsPath);

    // Ensure tracking table exists
    await this.ensureMigrationsTable();

    // Get already-executed versions
    const { rows } = await this.storage.query('SELECT version FROM schema_migrations');
    const executed = new Set(rows.map(r => r.version));

    // Read migration files
    let files;
    try {
      files = await fs.readdir(resolvedPath);
    } catch (err) {
      throw new MigrationError(`Failed to read migrations directory: ${resolvedPath}`, {
        cause: err,
      });
    }

    // Parse and filter to valid SQL migration files
    const migrations = files
      .map(parseMigrationFilename)
      .filter(m => m !== null)
      .sort((a, b) => a.version - b.version);

    // Find pending migrations
    const pending = migrations.filter(m => !executed.has(m.version));

    if (pending.length === 0) {
      return [];
    }

    const completed = [];

    for (const migration of pending) {
      await this.runMigration(resolvedPath, migration.name);
      completed.push({ version: migration.version, name: migration.name });
      if (this.logger) {
        this.logger(`Ran migration: ${migration.name}`);
      }
    }

    return completed;
  }

  /**
   * Run a single migration file within a transaction
   *
   * Reads the SQL file, executes it inside a transaction, and records
   * the migration in schema_migrations. On failure, the transaction
   * is rolled back and a MigrationError is thrown.
   *
   * @param {string} migrationsDir - Directory containing migration files
   * @param {string} filename - Migration filename (e.g., '001_initial_schema.sql')
   * @returns {Promise<void>}
   * @throws {MigrationError} If migration fails (transaction is rolled back)
   */
  async runMigration(migrationsDir, filename) {
    const parsed = parseMigrationFilename(filename);
    if (!parsed) {
      throw new MigrationError(`Invalid migration filename: ${filename}`, {
        filename,
      });
    }

    const { version } = parsed;
    const filePath = path.join(migrationsDir, filename);

    // Read SQL file
    let sql;
    try {
      sql = await fs.readFile(filePath, 'utf8');
    } catch (err) {
      throw new MigrationError(`Failed to read migration file: ${filename}`, {
        cause: err,
        version,
        filename,
      });
    }

    // Execute in transaction
    try {
      await this.storage.transaction(async client => {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING',
          [version, filename]
        );
      });
    } catch (err) {
      // Unwrap StorageError to preserve the original driver error (e.g., pg error
      // with code, position, etc.) as the direct cause of MigrationError.
      const rootCause = err instanceof StorageError && err.cause ? err.cause : err;
      throw new MigrationError(`Migration ${version} (${filename}) failed: ${err.message}`, {
        cause: rootCause,
        version,
        filename,
      });
    }
  }
}

export default MigrationRunner;
