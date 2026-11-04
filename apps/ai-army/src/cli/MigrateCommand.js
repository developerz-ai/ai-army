/**
 * MigrateCommand - Run pending database migrations
 *
 * Connects to the database, creates a MigrationRunner, and executes
 * all pending SQL migrations from the migrations directory.
 * Reports which migrations were run and handles errors gracefully.
 *
 * @module cli/MigrateCommand
 */

import { MigrationRunner, MigrationError } from '../database/MigrationRunner.js';

/**
 * Custom error for migrate command failures
 */
export class MigrateCommandError extends Error {
  /**
   * Create a MigrateCommandError
   * @param {string} message - Error message
   * @param {Object} [options] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'MigrateCommandError';
  }
}

/**
 * Run the migrate command
 *
 * Connects to the database and runs all pending migrations.
 * Reports which migrations were executed and handles errors.
 *
 * @param {Object} options - Command options
 * @param {string} [options.migrationsPath='./migrations'] - Path to migrations directory
 * @param {Object} [options.output=process.stdout] - Writable stream for output
 * @param {Object} [options.storage] - Pre-configured storage instance (required)
 * @param {Object} [options.migrationRunner] - Pre-configured MigrationRunner (for DI/testing)
 * @returns {Promise<{ success: boolean, migrations: Array }>} Migration result
 * @throws {MigrateCommandError} If storage is not provided
 */
export async function runMigrate({
  migrationsPath = './migrations',
  output = process.stdout,
  storage,
  migrationRunner,
} = {}) {
  const write = msg => output.write(msg);

  if (!storage) {
    throw new MigrateCommandError('Database storage is required for migrations');
  }

  write('🔄 Running database migrations...\n');

  // Create migration runner if not injected
  const runner =
    migrationRunner ||
    new MigrationRunner(storage, {
      logger: msg => write(`  ${msg}\n`),
    });

  try {
    const completed = await runner.runMigrations(migrationsPath);

    if (completed.length === 0) {
      write('\n✅ All migrations up to date (0 pending)\n');
    } else {
      const names = completed.map(m => m.name).join(', ');
      write(`\n✅ Ran ${completed.length} migration(s): ${names}\n`);
    }

    return { success: true, migrations: completed };
  } catch (err) {
    if (err instanceof MigrationError) {
      write(`\n❌ Migration failed: ${err.message}\n`);
      if (err.filename) {
        write(`   File: ${err.filename}\n`);
      }
      return { success: false, migrations: [] };
    }
    throw new MigrateCommandError(`Migration failed: ${err.message}`, {
      cause: err,
    });
  }
}

export default runMigrate;
