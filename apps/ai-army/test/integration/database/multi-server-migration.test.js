/**
 * Multi-Server Migration Tests
 *
 * Tests the 012_multi_server.sql migration for proper table creation,
 * constraints, indexes, and triggers for multi-server orchestration.
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
const MIGRATION_001_PATH = path.resolve(__dirname, '../../../migrations/001_initial_schema.sql');
const MIGRATION_009_PATH = path.resolve(__dirname, '../../../migrations/009_workers.sql');
const MIGRATION_012_PATH = path.resolve(__dirname, '../../../migrations/012_multi_server.sql');

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
    DROP TABLE IF EXISTS worker_activity CASCADE;
    DROP TABLE IF EXISTS worker_metrics CASCADE;
    DROP TABLE IF EXISTS assignments CASCADE;
    DROP TABLE IF EXISTS servers CASCADE;
    DROP TABLE IF EXISTS workers CASCADE;
    DROP TABLE IF EXISTS tool_calls CASCADE;
    DROP TABLE IF EXISTS sessions CASCADE;
    DROP TABLE IF EXISTS bots CASCADE;
    DROP TABLE IF EXISTS schema_migrations CASCADE;
    DROP FUNCTION IF EXISTS update_updated_at_column CASCADE;
    DROP FUNCTION IF EXISTS notify_bot_change CASCADE;
    DROP FUNCTION IF EXISTS notify_server_change CASCADE;
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

describe('012_multi_server.sql migration', { skip: !DB_AVAILABLE }, () => {
  let pool;
  let migration001Sql;
  let migration009Sql;
  let migration012Sql;

  before(async () => {
    // Load all required migrations
    if (!fs.existsSync(MIGRATION_001_PATH)) {
      throw new Error(`Migration file not found: ${MIGRATION_001_PATH}`);
    }
    if (!fs.existsSync(MIGRATION_009_PATH)) {
      throw new Error(`Migration file not found: ${MIGRATION_009_PATH}`);
    }
    if (!fs.existsSync(MIGRATION_012_PATH)) {
      throw new Error(`Migration file not found: ${MIGRATION_012_PATH}`);
    }

    migration001Sql = fs.readFileSync(MIGRATION_001_PATH, 'utf8');
    migration009Sql = fs.readFileSync(MIGRATION_009_PATH, 'utf8');
    migration012Sql = fs.readFileSync(MIGRATION_012_PATH, 'utf8');

    await createWorkerDatabase();
    pool = createPool();

    // Clean slate
    await dropAllTables(pool);

    // Run prerequisite migrations (001 and 009 required for 012)
    await pool.query(migration001Sql);
    await pool.query(migration009Sql);
  });

  after(async () => {
    if (pool) {
      await pool.end();
    }
    await dropWorkerDatabase();
  });

  it('should run migration without errors', async () => {
    await assert.doesNotReject(
      pool.query(migration012Sql),
      'Migration should execute without errors'
    );
  });

  it('should record migration version 12', async () => {
    const result = await pool.query(
      'SELECT version, name FROM schema_migrations WHERE version = $1',
      [12]
    );

    assert.equal(result.rows.length, 1, 'Should have migration record');
    assert.equal(result.rows[0].version, 12, 'Version should be 12');
    assert.equal(result.rows[0].name, '012_multi_server.sql', 'Name should match file');
  });

  it('should create servers table with correct columns', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'servers'
      ORDER BY ordinal_position
    `);

    const columns = result.rows.map(r => r.column_name);
    const required = [
      'id',
      'host',
      'ssh_user',
      'ssh_key_encrypted',
      'max_workers',
      'current_workers',
      'labels',
      'status',
      'docker_version',
      'last_heartbeat',
      'created_at',
      'updated_at',
    ];

    for (const col of required) {
      assert.ok(columns.includes(col), `servers should have ${col} column`);
    }
  });

  it('should enforce servers status constraint', async () => {
    // Valid status should work
    await pool.query(`
      INSERT INTO servers (id, host, status)
      VALUES ('test-server-1', '192.168.1.100', 'online')
    `);

    // Invalid status should fail
    await assert.rejects(
      pool.query(`
        INSERT INTO servers (id, host, status)
        VALUES ('test-server-2', '192.168.1.101', 'invalid')
      `),
      /violates check constraint/,
      'Invalid status should be rejected'
    );
  });

  it('should enforce servers worker capacity constraints', async () => {
    // Valid capacity should work
    await pool.query(`
      INSERT INTO servers (id, host, max_workers, current_workers)
      VALUES ('capacity-test', '192.168.1.102', 10, 5)
    `);

    // max_workers must be >= 1
    await assert.rejects(
      pool.query(`
        INSERT INTO servers (id, host, max_workers)
        VALUES ('bad-max', '192.168.1.103', 0)
      `),
      /violates check constraint/,
      'max_workers < 1 should be rejected'
    );

    // current_workers must be >= 0
    await assert.rejects(
      pool.query(`
        INSERT INTO servers (id, host, current_workers)
        VALUES ('bad-current', '192.168.1.104', -1)
      `),
      /violates check constraint/,
      'current_workers < 0 should be rejected'
    );

    // current_workers must be <= max_workers
    await assert.rejects(
      pool.query(`
        INSERT INTO servers (id, host, max_workers, current_workers)
        VALUES ('bad-capacity', '192.168.1.105', 5, 10)
      `),
      /violates check constraint/,
      'current_workers > max_workers should be rejected'
    );
  });

  it('should add server_id column to workers table', async () => {
    const result = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'workers' AND column_name = 'server_id'
    `);

    assert.equal(result.rows.length, 1, 'workers should have server_id column');
  });

  it('should add health tracking columns to workers table', async () => {
    const result = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'workers'
        AND column_name IN ('last_health_check', 'current_assignment_id', 'total_assignments', 'total_errors', 'avg_completion_time_ms')
      ORDER BY column_name
    `);

    assert.equal(result.rows.length, 5, 'workers should have all health tracking columns');
  });

  it('should add server_id column to bots table', async () => {
    const result = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'bots' AND column_name = 'server_id'
    `);

    assert.equal(result.rows.length, 1, 'bots should have server_id column');
  });

  it('should create assignments table with correct columns', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'assignments'
      ORDER BY ordinal_position
    `);

    const columns = result.rows.map(r => r.column_name);
    const required = [
      'id',
      'worker_id',
      'task',
      'context',
      'status',
      'result',
      'started_at',
      'completed_at',
      'duration_ms',
      'created_at',
      'updated_at',
    ];

    for (const col of required) {
      assert.ok(columns.includes(col), `assignments should have ${col} column`);
    }
  });

  it('should enforce assignments status constraint', async () => {
    // Create a worker first
    await pool.query(`
      INSERT INTO workers (id, host, type, status)
      VALUES ('test-worker-1', 'localhost', 'local', 'healthy')
    `);

    // Valid status should work
    await pool.query(`
      INSERT INTO assignments (id, worker_id, task, status)
      VALUES ('assign-1', 'test-worker-1', 'Process message', 'pending')
    `);

    // Invalid status should fail
    await assert.rejects(
      pool.query(`
        INSERT INTO assignments (id, worker_id, task, status)
        VALUES ('assign-2', 'test-worker-1', 'Process message', 'invalid')
      `),
      /violates check constraint/,
      'Invalid status should be rejected'
    );
  });

  it('should handle assignments CRUD operations', async () => {
    const assignmentId = `assign-test-${Date.now()}`;

    // Create assignment
    await pool.query(
      `
      INSERT INTO assignments (id, worker_id, task, context, status)
      VALUES ($1, 'test-worker-1', 'Test task', '{"key": "value"}'::jsonb, 'pending')
    `,
      [assignmentId]
    );

    // Read assignment
    let result = await pool.query('SELECT * FROM assignments WHERE id = $1', [assignmentId]);
    assert.equal(result.rows.length, 1, 'Assignment should exist');
    assert.equal(result.rows[0].status, 'pending', 'Status should be pending');
    assert.deepEqual(result.rows[0].context, { key: 'value' }, 'Context should be preserved');

    // Update assignment status
    await pool.query(
      `
      UPDATE assignments
      SET status = 'in_progress', started_at = NOW()
      WHERE id = $1
    `,
      [assignmentId]
    );

    result = await pool.query('SELECT status FROM assignments WHERE id = $1', [assignmentId]);
    assert.equal(result.rows[0].status, 'in_progress', 'Status should be updated');

    // Complete assignment
    await pool.query(
      `
      UPDATE assignments
      SET status = 'completed', completed_at = NOW(), duration_ms = 1500, result = 'Success'
      WHERE id = $1
    `,
      [assignmentId]
    );

    result = await pool.query('SELECT * FROM assignments WHERE id = $1', [assignmentId]);
    assert.equal(result.rows[0].status, 'completed', 'Status should be completed');
    assert.equal(result.rows[0].result, 'Success', 'Result should be set');
    assert.equal(result.rows[0].duration_ms, 1500, 'Duration should be set');

    // Delete assignment
    await pool.query('DELETE FROM assignments WHERE id = $1', [assignmentId]);

    result = await pool.query('SELECT * FROM assignments WHERE id = $1', [assignmentId]);
    assert.equal(result.rows.length, 0, 'Assignment should be deleted');
  });

  it('should create worker_metrics table with correct columns', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'worker_metrics'
      ORDER BY ordinal_position
    `);

    const columns = result.rows.map(r => r.column_name);
    const required = [
      'id',
      'worker_id',
      'timestamp',
      'cpu_usage',
      'memory_usage',
      'disk_usage',
      'active',
    ];

    for (const col of required) {
      assert.ok(columns.includes(col), `worker_metrics should have ${col} column`);
    }
  });

  it('should handle worker_metrics insert and query operations', async () => {
    // Insert metrics
    await pool.query(`
      INSERT INTO worker_metrics (worker_id, cpu_usage, memory_usage, disk_usage, active)
      VALUES ('test-worker-1', 45.5, 62.3, 78.1, true)
    `);

    await pool.query(`
      INSERT INTO worker_metrics (worker_id, cpu_usage, memory_usage, disk_usage, active)
      VALUES ('test-worker-1', 50.2, 65.8, 79.5, true)
    `);

    // Query latest metrics for worker
    const result = await pool.query(`
      SELECT cpu_usage, memory_usage, disk_usage, active
      FROM worker_metrics
      WHERE worker_id = 'test-worker-1'
      ORDER BY timestamp DESC
      LIMIT 1
    `);

    assert.equal(result.rows.length, 1, 'Should have metrics');
    assert.equal(parseFloat(result.rows[0].cpu_usage), 50.2, 'CPU usage should match');
    assert.equal(parseFloat(result.rows[0].memory_usage), 65.8, 'Memory usage should match');
    assert.equal(parseFloat(result.rows[0].disk_usage), 79.5, 'Disk usage should match');
    assert.equal(result.rows[0].active, true, 'Active flag should match');
  });

  it('should cascade delete worker_metrics when worker is deleted', async () => {
    // Count metrics before delete
    const before = await pool.query('SELECT COUNT(*) FROM worker_metrics WHERE worker_id = $1', [
      'test-worker-1',
    ]);
    assert.ok(parseInt(before.rows[0].count) > 0, 'Should have metrics');

    // Delete worker
    await pool.query('DELETE FROM workers WHERE id = $1', ['test-worker-1']);

    // Metrics should be gone
    const after = await pool.query('SELECT COUNT(*) FROM worker_metrics WHERE worker_id = $1', [
      'test-worker-1',
    ]);
    assert.equal(parseInt(after.rows[0].count), 0, 'Metrics should be deleted');
  });

  it('should create worker_activity table with correct columns', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'worker_activity'
      ORDER BY ordinal_position
    `);

    const columns = result.rows.map(r => r.column_name);
    const required = ['id', 'worker_id', 'activity_type', 'details', 'timestamp'];

    for (const col of required) {
      assert.ok(columns.includes(col), `worker_activity should have ${col} column`);
    }
  });

  it('should enforce worker_activity type constraint', async () => {
    // Create worker for activity tests
    await pool.query(`
      INSERT INTO workers (id, host, type, status)
      VALUES ('activity-worker', 'localhost', 'local', 'healthy')
    `);

    // Valid activity type should work
    await pool.query(`
      INSERT INTO worker_activity (worker_id, activity_type, details)
      VALUES ('activity-worker', 'tool_execution', '{"tool": "bash", "command": "ls"}'::jsonb)
    `);

    // Empty activity type should fail
    await assert.rejects(
      pool.query(`
        INSERT INTO worker_activity (worker_id, activity_type, details)
        VALUES ('activity-worker', '', '{}'::jsonb)
      `),
      /violates check constraint/,
      'Empty activity_type should be rejected'
    );
  });

  it('should create all required indexes for servers', async () => {
    const result = await pool.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'servers'
        AND indexname NOT LIKE '%_pkey'
      ORDER BY indexname
    `);

    const indexes = result.rows.map(r => r.indexname);
    const expected = ['idx_servers_status', 'idx_servers_heartbeat', 'idx_servers_available'];

    for (const idx of expected) {
      assert.ok(indexes.includes(idx), `Index ${idx} should exist`);
    }
  });

  it('should create all required indexes for assignments', async () => {
    const result = await pool.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'assignments'
        AND indexname NOT LIKE '%_pkey'
      ORDER BY indexname
    `);

    const indexes = result.rows.map(r => r.indexname);
    const expected = [
      'idx_assignments_worker_id',
      'idx_assignments_status',
      'idx_assignments_started_at',
      'idx_assignments_completed_at',
      'idx_assignments_worker_status',
    ];

    for (const idx of expected) {
      assert.ok(indexes.includes(idx), `Index ${idx} should exist`);
    }
  });

  it('should create all required indexes for worker_metrics', async () => {
    const result = await pool.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'worker_metrics'
        AND indexname NOT LIKE '%_pkey'
      ORDER BY indexname
    `);

    const indexes = result.rows.map(r => r.indexname);
    const expected = [
      'idx_worker_metrics_worker_time',
      'idx_worker_metrics_timestamp',
      'idx_worker_metrics_active',
    ];

    for (const idx of expected) {
      assert.ok(indexes.includes(idx), `Index ${idx} should exist`);
    }
  });

  it('should create all required indexes for worker_activity', async () => {
    const result = await pool.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'worker_activity'
        AND indexname NOT LIKE '%_pkey'
      ORDER BY indexname
    `);

    const indexes = result.rows.map(r => r.indexname);
    const expected = [
      'idx_worker_activity_worker_time',
      'idx_worker_activity_type',
      'idx_worker_activity_timestamp',
    ];

    for (const idx of expected) {
      assert.ok(indexes.includes(idx), `Index ${idx} should exist`);
    }
  });

  it('should create indexes for workers.server_id and bots.server_id', async () => {
    const result = await pool.query(`
      SELECT indexname, tablename
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN ('idx_workers_server_id', 'idx_bots_server_id')
      ORDER BY indexname
    `);

    assert.equal(result.rows.length, 2, 'Should have both server_id indexes');
    assert.ok(
      result.rows.some(r => r.indexname === 'idx_workers_server_id'),
      'idx_workers_server_id should exist'
    );
    assert.ok(
      result.rows.some(r => r.indexname === 'idx_bots_server_id'),
      'idx_bots_server_id should exist'
    );
  });

  it('should update updated_at trigger on servers', async () => {
    // Insert a server
    await pool.query(`
      INSERT INTO servers (id, host, status)
      VALUES ('trigger-test', '192.168.1.200', 'online')
    `);

    const before = await pool.query('SELECT updated_at FROM servers WHERE id = $1', [
      'trigger-test',
    ]);

    // Wait a bit to ensure timestamp difference
    await new Promise(resolve => globalThis.setTimeout(resolve, 10));

    // Update the server
    await pool.query('UPDATE servers SET status = $1 WHERE id = $2', [
      'maintenance',
      'trigger-test',
    ]);

    const after = await pool.query('SELECT updated_at FROM servers WHERE id = $1', [
      'trigger-test',
    ]);

    assert.ok(
      after.rows[0].updated_at > before.rows[0].updated_at,
      'updated_at should be updated by trigger'
    );
  });

  it('should update updated_at trigger on assignments', async () => {
    // Create a worker and assignment
    await pool.query(`
      INSERT INTO workers (id, host, type, status)
      VALUES ('trigger-worker', 'localhost', 'local', 'healthy')
    `);

    await pool.query(`
      INSERT INTO assignments (id, worker_id, task, status)
      VALUES ('trigger-assign', 'trigger-worker', 'Trigger test', 'pending')
    `);

    const before = await pool.query('SELECT updated_at FROM assignments WHERE id = $1', [
      'trigger-assign',
    ]);

    // Wait a bit to ensure timestamp difference
    await new Promise(resolve => globalThis.setTimeout(resolve, 10));

    // Update the assignment
    await pool.query('UPDATE assignments SET status = $1 WHERE id = $2', [
      'in_progress',
      'trigger-assign',
    ]);

    const after = await pool.query('SELECT updated_at FROM assignments WHERE id = $1', [
      'trigger-assign',
    ]);

    assert.ok(
      after.rows[0].updated_at > before.rows[0].updated_at,
      'updated_at should be updated by trigger'
    );
  });

  it('should have notify_server_change function and trigger', async () => {
    // Check function exists
    const funcResult = await pool.query(`
      SELECT proname
      FROM pg_proc
      WHERE proname = 'notify_server_change'
    `);

    assert.equal(funcResult.rows.length, 1, 'notify_server_change function should exist');

    // Check trigger exists
    const trigResult = await pool.query(`
      SELECT tgname
      FROM pg_trigger
      WHERE tgname = 'server_change_trigger'
    `);

    assert.equal(trigResult.rows.length, 1, 'server_change_trigger should exist');
  });

  it('should be idempotent (re-running should not error)', async () => {
    // Running migration again should not fail
    await assert.doesNotReject(
      pool.query(migration012Sql),
      'Re-running migration should be idempotent'
    );

    // Should still only have one migration record
    const result = await pool.query('SELECT COUNT(*) FROM schema_migrations WHERE version = 12');
    assert.equal(parseInt(result.rows[0].count), 1, 'Should still have only one record');
  });
});
