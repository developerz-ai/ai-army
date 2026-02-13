/**
 * Unit tests for 012_multi_server.sql migration
 *
 * Validates the migration file structure, SQL content, and
 * compatibility with the MigrationRunner auto-discovery mechanism.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '../../../migrations');
const MIGRATION_FILE = path.join(MIGRATIONS_DIR, '012_multi_server.sql');

describe('012_multi_server.sql migration', () => {
  // ============================================================================
  // File existence and naming
  // ============================================================================

  test('migration file exists', async () => {
    const stat = await fs.stat(MIGRATION_FILE);
    assert.ok(stat.isFile(), 'Migration file should exist');
  });

  test('filename matches MigrationRunner NNN_description.sql pattern', () => {
    const filename = path.basename(MIGRATION_FILE);
    const pattern = /^(\d+)_.+\.sql$/;
    const match = filename.match(pattern);
    assert.ok(match, `Filename "${filename}" should match NNN_description.sql pattern`);
    assert.equal(parseInt(match[1], 10), 12, 'Migration version should be 12');
  });

  // ============================================================================
  // SQL content validation
  // ============================================================================

  describe('SQL content', () => {
    let sql;

    test('can read migration file', async () => {
      sql = await fs.readFile(MIGRATION_FILE, 'utf8');
      assert.ok(sql.length > 0, 'Migration file should not be empty');
    });

    test('uses CREATE TABLE IF NOT EXISTS for new tables', async () => {
      sql = sql || (await fs.readFile(MIGRATION_FILE, 'utf8'));

      assert.match(sql, /CREATE TABLE IF NOT EXISTS servers/i, 'Should create servers table');
      assert.match(
        sql,
        /CREATE TABLE IF NOT EXISTS assignments/i,
        'Should create assignments table'
      );
      assert.match(
        sql,
        /CREATE TABLE IF NOT EXISTS worker_metrics/i,
        'Should create worker_metrics table'
      );
      assert.match(
        sql,
        /CREATE TABLE IF NOT EXISTS worker_activity/i,
        'Should create worker_activity table'
      );
    });

    test('uses ALTER TABLE ADD COLUMN IF NOT EXISTS for worker enhancements', async () => {
      sql = sql || (await fs.readFile(MIGRATION_FILE, 'utf8'));

      assert.match(
        sql,
        /ALTER TABLE workers ADD COLUMN IF NOT EXISTS server_id/i,
        'Should add server_id to workers'
      );
      assert.match(
        sql,
        /ALTER TABLE workers ADD COLUMN IF NOT EXISTS last_health_check/i,
        'Should add last_health_check to workers'
      );
      assert.match(
        sql,
        /ALTER TABLE workers ADD COLUMN IF NOT EXISTS current_assignment_id/i,
        'Should add current_assignment_id to workers'
      );
      assert.match(
        sql,
        /ALTER TABLE workers ADD COLUMN IF NOT EXISTS total_assignments/i,
        'Should add total_assignments to workers'
      );
      assert.match(
        sql,
        /ALTER TABLE workers ADD COLUMN IF NOT EXISTS total_errors/i,
        'Should add total_errors to workers'
      );
      assert.match(
        sql,
        /ALTER TABLE workers ADD COLUMN IF NOT EXISTS avg_completion_time_ms/i,
        'Should add avg_completion_time_ms to workers'
      );
    });

    test('adds server_id to bots table', async () => {
      sql = sql || (await fs.readFile(MIGRATION_FILE, 'utf8'));

      assert.match(
        sql,
        /ALTER TABLE bots ADD COLUMN IF NOT EXISTS server_id/i,
        'Should add server_id to bots table'
      );
    });

    test('creates performance indexes', async () => {
      sql = sql || (await fs.readFile(MIGRATION_FILE, 'utf8'));

      // Server indexes
      assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_servers_status/i);
      assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_servers_heartbeat/i);
      assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_servers_available/i);

      // Worker server_id index
      assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_workers_server_id/i);

      // Bot server_id index
      assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_bots_server_id/i);

      // Assignment indexes
      assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_assignments_worker_id/i);
      assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_assignments_status/i);
      assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_assignments_started_at/i);
      assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_assignments_worker_status/i);

      // Worker metrics indexes
      assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_worker_metrics_worker_time/i);
      assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_worker_metrics_timestamp/i);

      // Worker activity indexes
      assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_worker_activity_worker_time/i);
      assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_worker_activity_type/i);
    });

    test('records migration in schema_migrations', async () => {
      sql = sql || (await fs.readFile(MIGRATION_FILE, 'utf8'));

      assert.match(
        sql,
        /INSERT INTO schema_migrations.*VALUES\s*\(12,\s*'012_multi_server\.sql'\)/is,
        'Should insert version 12 into schema_migrations'
      );
      assert.match(
        sql,
        /ON CONFLICT.*DO NOTHING/i,
        'Should use ON CONFLICT DO NOTHING for idempotency'
      );
    });

    test('includes update triggers following existing pattern', async () => {
      sql = sql || (await fs.readFile(MIGRATION_FILE, 'utf8'));

      // Server update trigger
      assert.match(sql, /DROP TRIGGER IF EXISTS servers_updated_at/i);
      assert.match(sql, /CREATE TRIGGER servers_updated_at/i);

      // Assignment update trigger
      assert.match(sql, /DROP TRIGGER IF EXISTS assignments_updated_at/i);
      assert.match(sql, /CREATE TRIGGER assignments_updated_at/i);

      // Uses shared update_updated_at_column function
      assert.match(sql, /EXECUTE FUNCTION update_updated_at_column\(\)/i);
    });

    test('includes LISTEN/NOTIFY trigger for servers', async () => {
      sql = sql || (await fs.readFile(MIGRATION_FILE, 'utf8'));

      assert.match(sql, /CREATE OR REPLACE FUNCTION notify_server_change/i);
      assert.match(sql, /pg_notify\('server_changes'/i);
      assert.match(sql, /CREATE TRIGGER server_change_trigger/i);
    });

    test('servers table has required columns', async () => {
      sql = sql || (await fs.readFile(MIGRATION_FILE, 'utf8'));

      assert.match(sql, /id TEXT PRIMARY KEY/i);
      assert.match(sql, /host TEXT NOT NULL/i);
      assert.match(sql, /ssh_user TEXT/i);
      assert.match(sql, /ssh_key_encrypted TEXT/i);
      assert.match(sql, /max_workers INT/i);
      assert.match(sql, /current_workers INT/i);
      assert.match(sql, /labels TEXT\[\]/i);
      assert.match(sql, /docker_version TEXT/i);
    });

    test('assignments table has required columns', async () => {
      sql = sql || (await fs.readFile(MIGRATION_FILE, 'utf8'));

      // Extract assignments CREATE TABLE block
      const assignmentsMatch = sql.match(
        /CREATE TABLE IF NOT EXISTS assignments\s*\(([\s\S]*?)\);/i
      );
      assert.ok(assignmentsMatch, 'Should have assignments CREATE TABLE');
      const assignmentsCols = assignmentsMatch[1];

      assert.match(assignmentsCols, /id TEXT PRIMARY KEY/i);
      assert.match(assignmentsCols, /worker_id TEXT/i);
      assert.match(assignmentsCols, /task TEXT NOT NULL/i);
      assert.match(assignmentsCols, /context JSONB/i);
      assert.match(assignmentsCols, /status TEXT/i);
      assert.match(assignmentsCols, /result TEXT/i);
      assert.match(assignmentsCols, /started_at TIMESTAMPTZ/i);
      assert.match(assignmentsCols, /completed_at TIMESTAMPTZ/i);
      assert.match(assignmentsCols, /duration_ms INT/i);
    });

    test('worker_metrics table has required columns', async () => {
      sql = sql || (await fs.readFile(MIGRATION_FILE, 'utf8'));

      // Extract worker_metrics CREATE TABLE block
      const metricsMatch = sql.match(
        /CREATE TABLE IF NOT EXISTS worker_metrics\s*\(([\s\S]*?)\);/i
      );
      assert.ok(metricsMatch, 'Should have worker_metrics CREATE TABLE');
      const metricsCols = metricsMatch[1];

      assert.match(metricsCols, /id SERIAL PRIMARY KEY/i);
      assert.match(metricsCols, /worker_id TEXT.*REFERENCES workers\(id\)/i);
      assert.match(metricsCols, /timestamp TIMESTAMPTZ/i);
      assert.match(metricsCols, /cpu_usage NUMERIC/i);
      assert.match(metricsCols, /memory_usage NUMERIC/i);
      assert.match(metricsCols, /disk_usage NUMERIC/i);
      assert.match(metricsCols, /active BOOLEAN/i);
    });

    test('includes table and column comments', async () => {
      sql = sql || (await fs.readFile(MIGRATION_FILE, 'utf8'));

      assert.match(sql, /COMMENT ON TABLE servers/i);
      assert.match(sql, /COMMENT ON TABLE assignments/i);
      assert.match(sql, /COMMENT ON TABLE worker_metrics/i);
      assert.match(sql, /COMMENT ON TABLE worker_activity/i);
    });

    test('includes constraint checks', async () => {
      sql = sql || (await fs.readFile(MIGRATION_FILE, 'utf8'));

      // Server constraints
      assert.match(sql, /servers_status_check/i);
      assert.match(sql, /servers_max_workers_check/i);

      // Assignment constraints
      assert.match(sql, /assignments_status_check/i);
    });
  });

  // ============================================================================
  // MigrationRunner auto-discovery compatibility
  // ============================================================================

  describe('MigrationRunner auto-discovery', () => {
    test('migration file is in the migrations directory', async () => {
      const files = await fs.readdir(MIGRATIONS_DIR);
      assert.ok(
        files.includes('012_multi_server.sql'),
        'Migration file should be in the migrations directory'
      );
    });

    test('version 12 does not conflict with existing migrations', async () => {
      const files = await fs.readdir(MIGRATIONS_DIR);
      const pattern = /^(\d+)_.+\.sql$/;
      const versions = files
        .map(f => f.match(pattern))
        .filter(m => m !== null)
        .map(m => parseInt(m[1], 10));

      // Count how many times version 12 appears
      const version12Count = versions.filter(v => v === 12).length;
      assert.equal(version12Count, 1, 'Version 12 should appear exactly once');
    });

    test('version 12 follows sequentially after existing migrations', async () => {
      const files = await fs.readdir(MIGRATIONS_DIR);
      const pattern = /^(\d+)_.+\.sql$/;
      const versions = files
        .map(f => f.match(pattern))
        .filter(m => m !== null)
        .map(m => parseInt(m[1], 10))
        .sort((a, b) => a - b);

      const maxVersion = Math.max(...versions);
      assert.equal(maxVersion, 12, 'Version 12 should be the latest migration');
      assert.ok(versions.includes(11), 'Previous version 11 should exist');
    });
  });
});
