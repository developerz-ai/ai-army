/**
 * Schema Migration Tests
 *
 * Tests the 001_initial_schema.sql migration for proper table creation,
 * constraints, indexes, and triggers.
 *
 * Uses a per-worker database for parallel test execution.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TEST_DATABASE_URL,
  isDatabaseAvailable,
  createWorkerDatabase,
  dropWorkerDatabase,
} from '../../helpers/setup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = path.resolve(__dirname, '../../../migrations/001_initial_schema.sql');

/**
 * Create a test database connection pool (uses per-worker database)
 */
function createPool() {
  return new pg.Pool({
    connectionString: TEST_DATABASE_URL,
    max: 5,
  });
}

/**
 * Drop all tables for clean test runs
 */
async function dropAllTables(pool) {
  await pool.query(`
    DROP TABLE IF EXISTS tool_calls CASCADE;
    DROP TABLE IF EXISTS sessions CASCADE;
    DROP TABLE IF EXISTS bots CASCADE;
    DROP TABLE IF EXISTS schema_migrations CASCADE;
    DROP FUNCTION IF EXISTS update_updated_at_column CASCADE;
    DROP FUNCTION IF EXISTS notify_bot_change CASCADE;
  `);
}

const DB_AVAILABLE = await isDatabaseAvailable();

if (!DB_AVAILABLE) {
  console.log('Skipping database tests - PostgreSQL not available');
  console.log(
    'Run: docker run -d --name ai-army-test-db ' +
      '-e POSTGRES_DB=ai_army_test -e POSTGRES_USER=test ' +
      '-e POSTGRES_PASSWORD=test -p 5432:5432 postgres:16-alpine'
  );
}

describe('001_initial_schema.sql migration', { skip: !DB_AVAILABLE }, () => {
  let pool;
  let migrationSql;

  before(async () => {
    if (!fs.existsSync(MIGRATION_PATH)) {
      throw new Error(`Migration file not found: ${MIGRATION_PATH}`);
    }

    migrationSql = fs.readFileSync(MIGRATION_PATH, 'utf8');

    await createWorkerDatabase();
    pool = createPool();

    // Clean slate
    await dropAllTables(pool);
  });

  after(async () => {
    if (pool) {
      await pool.end();
    }
    await dropWorkerDatabase();
  });

  it('should run migration without errors', async () => {
    await assert.doesNotReject(pool.query(migrationSql), 'Migration should execute without errors');
  });

  it('should create schema_migrations table', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'schema_migrations'
      ORDER BY ordinal_position
    `);

    assert.equal(result.rows.length, 3, 'schema_migrations should have 3 columns');

    const columns = result.rows.map(r => r.column_name);
    assert.ok(columns.includes('version'), 'Should have version column');
    assert.ok(columns.includes('name'), 'Should have name column');
    assert.ok(columns.includes('executed_at'), 'Should have executed_at column');
  });

  it('should record migration version 1', async () => {
    const result = await pool.query(
      'SELECT version, name FROM schema_migrations WHERE version = $1',
      [1]
    );

    assert.equal(result.rows.length, 1, 'Should have migration record');
    assert.equal(result.rows[0].version, 1, 'Version should be 1');
    assert.equal(result.rows[0].name, '001_initial_schema.sql', 'Name should match file');
  });

  it('should create bots table with correct columns', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'bots'
      ORDER BY ordinal_position
    `);

    const columns = result.rows.map(r => r.column_name);
    const required = ['id', 'config', 'status', 'created_at', 'updated_at'];

    for (const col of required) {
      assert.ok(columns.includes(col), `bots should have ${col} column`);
    }
  });

  it('should enforce bots status constraint', async () => {
    // Valid status should work
    await pool.query(`
      INSERT INTO bots (id, name, config, status)
      VALUES ('test-bot-1', 'Test Bot', '{"model": "claude"}'::jsonb, 'running')
    `);

    // Invalid status should fail
    await assert.rejects(
      pool.query(`
        INSERT INTO bots (id, name, config, status)
        VALUES ('test-bot-2', 'Test Bot', '{"model": "claude"}'::jsonb, 'invalid')
      `),
      /violates check constraint/,
      'Invalid status should be rejected'
    );
  });

  it('should create sessions table with foreign key to bots', async () => {
    // Create valid session
    await pool.query(`
      INSERT INTO sessions (id, bot_id, user_id, channel_id, channel_type)
      VALUES ('test-bot-1:slack:C123:U456', 'test-bot-1', 'U456', 'C123', 'slack')
    `);

    // Check FK constraint - should fail with non-existent bot
    await assert.rejects(
      pool.query(`
        INSERT INTO sessions (id, bot_id, user_id, channel_id, channel_type)
        VALUES ('fake:slack:C123:U456', 'non-existent-bot', 'U456', 'C123', 'slack')
      `),
      /violates foreign key constraint/,
      'Non-existent bot_id should be rejected'
    );
  });

  it('should enforce sessions channel_type constraint', async () => {
    await assert.rejects(
      pool.query(`
        INSERT INTO sessions (id, bot_id, user_id, channel_id, channel_type)
        VALUES ('test-bot-1:invalid:C123:U999', 'test-bot-1', 'U999', 'C123', 'invalid')
      `),
      /violates check constraint/,
      'Invalid channel_type should be rejected'
    );
  });

  it('should cascade delete sessions when bot is deleted', async () => {
    // Count sessions before delete
    const before = await pool.query('SELECT COUNT(*) FROM sessions WHERE bot_id = $1', [
      'test-bot-1',
    ]);
    assert.ok(parseInt(before.rows[0].count) > 0, 'Should have sessions');

    // Delete bot
    await pool.query('DELETE FROM bots WHERE id = $1', ['test-bot-1']);

    // Sessions should be gone
    const after = await pool.query('SELECT COUNT(*) FROM sessions WHERE bot_id = $1', [
      'test-bot-1',
    ]);
    assert.equal(parseInt(after.rows[0].count), 0, 'Sessions should be deleted');
  });

  it('should create tool_calls table', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'tool_calls'
      ORDER BY ordinal_position
    `);

    const columns = result.rows.map(r => r.column_name);
    const required = [
      'id',
      'bot_id',
      'tool_name',
      'parameters',
      'result',
      'success',
      'executed_at',
    ];

    for (const col of required) {
      assert.ok(columns.includes(col), `tool_calls should have ${col} column`);
    }
  });

  it('should auto-generate tool_calls id as BIGSERIAL', async () => {
    // Insert without id
    await pool.query(`
      INSERT INTO tool_calls (bot_id, tool_name, parameters, success)
      VALUES ('test-bot', 'bash', '{"cmd": "ls"}'::jsonb, true)
    `);

    await pool.query(`
      INSERT INTO tool_calls (bot_id, tool_name, parameters, success)
      VALUES ('test-bot', 'readFile', '{"path": "/etc/hosts"}'::jsonb, true)
    `);

    // Check ids are sequential
    const result = await pool.query('SELECT id FROM tool_calls ORDER BY id');
    assert.equal(result.rows.length, 2, 'Should have 2 rows');
    assert.equal(parseInt(result.rows[0].id), 1, 'First id should be 1');
    assert.equal(parseInt(result.rows[1].id), 2, 'Second id should be 2');
  });

  it('should create all required indexes', async () => {
    const result = await pool.query(`
      SELECT indexname, tablename
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname NOT LIKE '%_pkey'
      ORDER BY tablename, indexname
    `);

    const indexes = result.rows.map(r => r.indexname);

    // Check key indexes exist
    const expected = [
      'idx_bots_status',
      'idx_bots_template',
      'idx_bots_worker',
      'idx_sessions_bot',
      'idx_sessions_user',
      'idx_sessions_last_message',
      'idx_tool_calls_bot',
      'idx_tool_calls_tool',
    ];

    for (const idx of expected) {
      assert.ok(indexes.includes(idx), `Index ${idx} should exist`);
    }
  });

  it('should update updated_at trigger on bots', async () => {
    // Insert a bot
    await pool.query(`
      INSERT INTO bots (id, name, config, status)
      VALUES ('trigger-test', 'Trigger Test', '{"test": true}'::jsonb, 'stopped')
    `);

    const before = await pool.query('SELECT updated_at FROM bots WHERE id = $1', ['trigger-test']);

    // Wait a bit to ensure timestamp difference
    await new Promise(resolve => globalThis.setTimeout(resolve, 10));

    // Update the bot
    await pool.query('UPDATE bots SET status = $1 WHERE id = $2', ['running', 'trigger-test']);

    const after = await pool.query('SELECT updated_at FROM bots WHERE id = $1', ['trigger-test']);

    assert.ok(
      after.rows[0].updated_at > before.rows[0].updated_at,
      'updated_at should be updated by trigger'
    );
  });

  it('should have JSONB[] for sessions messages', async () => {
    // Insert session with messages
    await pool.query(`
      INSERT INTO bots (id, name, config, status)
      VALUES ('msg-test', 'Msg Test', '{"test": true}'::jsonb, 'running')
    `);

    await pool.query(`
      INSERT INTO sessions (id, bot_id, user_id, channel_id, channel_type, messages)
      VALUES (
        'msg-test:slack:C1:U1',
        'msg-test',
        'U1',
        'C1',
        'slack',
        ARRAY['{"role": "user", "content": "Hello"}'::jsonb, '{"role": "assistant", "content": "Hi!"}'::jsonb]
      )
    `);

    const result = await pool.query('SELECT messages FROM sessions WHERE id = $1', [
      'msg-test:slack:C1:U1',
    ]);

    assert.equal(result.rows[0].messages.length, 2, 'Should have 2 messages');
    assert.equal(result.rows[0].messages[0].role, 'user', 'First message should be user');
    assert.equal(
      result.rows[0].messages[1].role,
      'assistant',
      'Second message should be assistant'
    );
  });

  it('should be idempotent (re-running should not error)', async () => {
    // Running migration again should not fail
    await assert.doesNotReject(
      pool.query(migrationSql),
      'Re-running migration should be idempotent'
    );

    // Should still only have one migration record
    const result = await pool.query('SELECT COUNT(*) FROM schema_migrations WHERE version = 1');
    assert.equal(parseInt(result.rows[0].count), 1, 'Should still have only one record');
  });
});
