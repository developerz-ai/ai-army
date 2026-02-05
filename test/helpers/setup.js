/**
 * Test Setup Helpers
 *
 * Provides utilities for setting up and tearing down test databases.
 *
 * @module test/helpers/setup
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { PostgresStorage } from '../../src/adapters/storage/postgres.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Default test database URL
 * Can be overridden by DATABASE_URL or TEST_DATABASE_URL environment variables
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://test:test@localhost:5432/ai_army_test';

/**
 * Path to migrations directory
 */
const MIGRATIONS_PATH = path.join(__dirname, '../../migrations');

/**
 * Set up test database
 * - Creates a PostgresStorage instance
 * - Connects to the database
 * - Runs all migrations
 *
 * @returns {Promise<PostgresStorage>} Connected storage instance
 */
export async function setupTestDatabase() {
  const storage = new PostgresStorage(TEST_DATABASE_URL);
  await storage.connect();

  // Run migrations
  await runMigrations(storage);

  return storage;
}

/**
 * Clean up test database
 * - Truncates all tables (preserves schema)
 * - Disconnects from database
 *
 * @param {PostgresStorage} storage - Storage instance to clean up
 */
export async function cleanupTestDatabase(storage) {
  if (!storage || !storage.isConnected()) {
    return;
  }

  try {
    // Truncate all data tables (not schema_migrations)
    await storage.query('TRUNCATE bots CASCADE');
    await storage.query('DELETE FROM tool_calls');
  } catch (err) {
    console.warn('Warning: Failed to truncate tables:', err.message);
  }

  await storage.disconnect();
}

/**
 * Run all pending migrations
 *
 * @param {PostgresStorage} storage - Connected storage instance
 */
async function runMigrations(storage) {
  // Ensure schema_migrations table exists
  await storage.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      executed_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

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

    // Run migration in transaction
    await storage.transaction(async client => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [
        version,
        file,
      ]);
    });

    console.log(`✅ Ran migration: ${file}`);
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
