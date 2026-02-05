/**
 * Test Setup Helpers
 *
 * Provides utilities for setting up and tearing down test databases.
 * Uses per-worker databases (like parallel_rspec) so test files can
 * run concurrently without interfering with each other.
 *
 * @module test/helpers/setup
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { PostgresStorage } from '../../src/adapters/storage/postgres.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WORKER_ID = process.pid;

/**
 * Base database URL used for admin operations (CREATE/DROP DATABASE).
 * This database must exist before tests run (created by CI service or locally).
 */
export const BASE_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://test:test@localhost:5432/ai_army_test';

/**
 * Per-worker database URL for test isolation.
 * Each test file runs in its own Node.js child process with a unique PID,
 * so each gets its own database — just like parallel_rspec.
 */
function buildWorkerDatabaseUrl() {
  const url = new URL(BASE_DATABASE_URL);
  const baseName = url.pathname.slice(1);
  url.pathname = `/${baseName}_w${WORKER_ID}`;
  return url.toString();
}

export const TEST_DATABASE_URL = buildWorkerDatabaseUrl();

/**
 * Path to migrations directory
 */
const MIGRATIONS_PATH = path.join(__dirname, '../../migrations');

/**
 * Check if the base database is reachable.
 * Use this at module level to decide whether to skip DB tests.
 *
 * @returns {Promise<boolean>}
 */
export async function isDatabaseAvailable() {
  const pool = new pg.Pool({ connectionString: BASE_DATABASE_URL, max: 1 });
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await pool.end();
  }
}

/**
 * Create the per-worker database.
 * Connects to the base database, drops any stale worker DB, and creates a fresh one.
 */
export async function createWorkerDatabase() {
  const dbName = new URL(TEST_DATABASE_URL).pathname.slice(1);
  const pool = new pg.Pool({ connectionString: BASE_DATABASE_URL, max: 1 });
  try {
    // Terminate existing connections to avoid "database is being accessed" errors
    await pool.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [dbName]
    );
    const safeName = pg.escapeIdentifier(dbName);
    await pool.query(`DROP DATABASE IF EXISTS ${safeName}`);
    await pool.query(`CREATE DATABASE ${safeName}`);
  } finally {
    await pool.end();
  }
}

/**
 * Drop the per-worker database.
 */
export async function dropWorkerDatabase() {
  const dbName = new URL(TEST_DATABASE_URL).pathname.slice(1);
  const pool = new pg.Pool({ connectionString: BASE_DATABASE_URL, max: 1 });
  try {
    await pool.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [dbName]
    );
    await pool.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(dbName)}`);
  } finally {
    await pool.end();
  }
}

/**
 * Set up test database
 * - Creates a per-worker database
 * - Creates a PostgresStorage instance
 * - Connects to the worker database
 * - Runs all migrations
 *
 * @returns {Promise<PostgresStorage>} Connected storage instance
 */
export async function setupTestDatabase() {
  await createWorkerDatabase();

  const storage = new PostgresStorage(TEST_DATABASE_URL);
  await storage.connect();

  // Run migrations
  await runMigrations(storage);

  return storage;
}

/**
 * Clean up test database
 * - Disconnects from database
 * - Drops the per-worker database
 *
 * @param {PostgresStorage} storage - Storage instance to clean up
 */
export async function cleanupTestDatabase(storage) {
  if (storage && storage.isConnected()) {
    await storage.disconnect();
  }

  await dropWorkerDatabase();
}

/**
 * Run all pending migrations
 * Uses CREATE TABLE IF NOT EXISTS and ON CONFLICT to be idempotent
 * and safe for concurrent test execution.
 *
 * @param {PostgresStorage} storage - Connected storage instance
 */
async function runMigrations(storage) {
  // Ensure schema_migrations table exists (idempotent)
  // Wrapped in try-catch for concurrent test execution safety
  try {
    await storage.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        executed_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  } catch (err) {
    // Ignore "type already exists" error from concurrent table creation
    if (err.cause?.code !== '23505') {
      throw err;
    }
  }

  // Get executed migrations
  const { rows } = await storage.query('SELECT version FROM schema_migrations');
  const executed = new Set(rows.map(r => r.version));

  // Read migration files
  let files;
  try {
    files = await fs.readdir(MIGRATIONS_PATH);
  } catch {
    console.warn('Warning: No migrations directory found');
    return;
  }

  const sqlFiles = files.filter(f => f.endsWith('.sql')).sort();

  for (const file of sqlFiles) {
    const version = parseInt(file.split('_')[0]);

    if (executed.has(version)) {
      continue; // Already executed
    }

    const sql = await fs.readFile(path.join(MIGRATIONS_PATH, file), 'utf8');

    // Run migration - the migration file uses IF NOT EXISTS and ON CONFLICT
    // for idempotency, so we don't need to wrap in transaction
    try {
      await storage.query(sql);
    } catch (err) {
      // If migration already ran (table already exists), that's OK
      if (err.cause?.code === '42P07' || err.cause?.code === '23505') {
        // Migration already applied, skip
      } else {
        throw err;
      }
    }
  }
}

/**
 * Reset test database
 * - Drops and recreates all tables
 * - Re-runs all migrations
 *
 * Use this when you need a completely fresh database state.
 *
 * @param {PostgresStorage} storage - Connected storage instance
 */
export async function resetTestDatabase(storage) {
  // Drop tables in reverse order of dependencies
  await storage.query('DROP TABLE IF EXISTS tool_calls CASCADE');
  await storage.query('DROP TABLE IF EXISTS sessions CASCADE');
  await storage.query('DROP TABLE IF EXISTS bots CASCADE');
  await storage.query('DROP TABLE IF EXISTS schema_migrations CASCADE');

  // Drop functions
  await storage.query('DROP FUNCTION IF EXISTS update_updated_at_column CASCADE');
  await storage.query('DROP FUNCTION IF EXISTS notify_bot_change CASCADE');

  // Re-run migrations
  await runMigrations(storage);
}

/**
 * Create a test bot in the database
 * Helper for tests that need a bot to exist
 *
 * @param {PostgresStorage} storage - Connected storage instance
 * @param {Object} [overrides={}] - Override default bot properties
 * @returns {Promise<string>} Bot ID
 */
export async function createTestBot(storage, overrides = {}) {
  const botId = overrides.id || `test-bot-${Date.now()}`;

  await storage.saveBotConfig(
    botId,
    {
      id: botId,
      model: 'claude-sonnet-4-5',
      provider: 'anthropic',
      ...overrides.config,
    },
    {
      name: overrides.name || 'Test Bot',
      description: overrides.description || 'A test bot',
      soulContent: overrides.soulContent || 'You are a helpful test assistant.',
      status: overrides.status || 'stopped',
    }
  );

  return botId;
}

/**
 * Create a test session in the database
 * Helper for tests that need a session to exist
 *
 * @param {PostgresStorage} storage - Connected storage instance
 * @param {string} botId - Bot ID to associate with session
 * @param {Object} [overrides={}] - Override default session properties
 * @returns {Promise<string>} Session ID
 */
export async function createTestSession(storage, botId, overrides = {}) {
  const sessionId =
    overrides.id ||
    `${botId}:${overrides.channelType || 'slack'}:${overrides.channelId || 'C123'}:${overrides.userId || 'U456'}`;

  await storage.saveSession({
    id: sessionId,
    botId,
    userId: overrides.userId || 'U456',
    channelId: overrides.channelId || 'C123',
    channelType: overrides.channelType || 'slack',
    messages: overrides.messages || [],
    tokenCount: overrides.tokenCount || 0,
    compactionCount: overrides.compactionCount || 0,
  });

  return sessionId;
}
