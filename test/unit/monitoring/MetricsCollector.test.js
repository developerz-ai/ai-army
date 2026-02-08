/**
 * Unit tests for MetricsCollector
 *
 * Tests time-series metric recording, batch operations, health check result
 * storage, historical querying, retention policy, and error handling.
 *
 * Tests:
 * - Constructor validation and defaults
 * - record() single metric data points
 * - recordBatch() multiple metrics at once
 * - storeCheckResults() from HealthMonitor output
 * - query() with component/metric/time filters
 * - applyRetention() cleanup of old data
 * - getLatest() per-component latest values
 * - Error handling and edge cases
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  MetricsCollector,
  MetricsCollectorError,
} from '../../../src/monitoring/MetricsCollector.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock storage instance
 * @param {Object} [overrides={}] - Override default mock responses
 * @returns {Object} Mock storage with query method
 */
function createMockStorage(overrides = {}) {
  return {
    query: mock.fn(async () => overrides.queryResult || { rows: [], rowCount: 0 }),
  };
}

/**
 * Create a mock storage that tracks all queries for assertion
 * @returns {{storage: Object, queries: Array}} Mock storage and query log
 */
function createTrackingStorage() {
  const queries = [];
  const storage = {
    query: mock.fn(async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [], rowCount: 0 };
    }),
  };
  return { storage, queries };
}

/**
 * Create sample health check results matching HealthMonitor output
 * @returns {Object} Check results map
 */
function createSampleCheckResults() {
  return {
    database: {
      status: 'healthy',
      latencyMs: 5,
      lastCheckAt: '2026-01-01T00:00:00.000Z',
    },
    bots: {
      status: 'degraded',
      running: 2,
      total: 3,
      latencyMs: 12,
      lastCheckAt: '2026-01-01T00:00:00.000Z',
    },
    channels: {
      status: 'unhealthy',
      error: 'Connection refused',
      latencyMs: 0,
      lastCheckAt: '2026-01-01T00:00:00.000Z',
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('MetricsCollector', () => {
  let storage;
  let collector;

  beforeEach(() => {
    storage = createMockStorage();
    collector = new MetricsCollector({ storage });
  });

  // ========================================================================
  // Constructor
  // ========================================================================

  describe('constructor', () => {
    test('creates instance with required storage', () => {
      const c = new MetricsCollector({ storage });
      assert.ok(c);
      assert.equal(c.storage, storage);
      assert.equal(c.logger, null);
      assert.equal(c.retentionDays, 30);
    });

    test('accepts logger option', () => {
      const logger = mock.fn();
      const c = new MetricsCollector({ storage, logger });
      assert.equal(c.logger, logger);
    });

    test('accepts retentionDays option', () => {
      const c = new MetricsCollector({ storage, retentionDays: 7 });
      assert.equal(c.retentionDays, 7);
    });

    test('throws when storage is missing', () => {
      assert.throws(
        () => new MetricsCollector({}),
        err => err instanceof MetricsCollectorError && err.operation === 'constructor'
      );
    });

    test('throws when storage lacks query method', () => {
      assert.throws(
        () => new MetricsCollector({ storage: {} }),
        err => err instanceof MetricsCollectorError && err.operation === 'constructor'
      );
    });

    test('throws when retentionDays is not a positive number', () => {
      assert.throws(
        () => new MetricsCollector({ storage, retentionDays: 0 }),
        err => err instanceof MetricsCollectorError && err.operation === 'constructor'
      );
    });

    test('throws when retentionDays is negative', () => {
      assert.throws(
        () => new MetricsCollector({ storage, retentionDays: -1 }),
        err => err instanceof MetricsCollectorError
      );
    });

    test('throws with no arguments', () => {
      assert.throws(
        () => new MetricsCollector(),
        err => err instanceof MetricsCollectorError
      );
    });
  });

  // ========================================================================
  // record
  // ========================================================================

  describe('record', () => {
    test('records a metric with component, metric, and value', async () => {
      await collector.record('database', 'latency_ms', 5.2);

      assert.equal(storage.query.mock.callCount(), 1);
      const call = storage.query.mock.calls[0];
      assert.ok(call.arguments[0].includes('INSERT INTO health_metrics'));
      assert.deepStrictEqual(call.arguments[1], ['database', 'latency_ms', 5.2]);
    });

    test('records a metric with explicit timestamp', async () => {
      const ts = new Date('2026-01-15T10:00:00Z');
      await collector.record('bots', 'count', 5, ts);

      const call = storage.query.mock.calls[0];
      assert.deepStrictEqual(call.arguments[1], ['bots', 'count', 5, ts]);
    });

    test('throws on empty component', async () => {
      await assert.rejects(
        () => collector.record('', 'latency_ms', 5),
        err => err instanceof MetricsCollectorError && err.operation === 'record'
      );
    });

    test('throws on non-string component', async () => {
      await assert.rejects(
        () => collector.record(42, 'latency_ms', 5),
        err => err instanceof MetricsCollectorError
      );
    });

    test('throws on empty metric name', async () => {
      await assert.rejects(
        () => collector.record('database', '', 5),
        err => err instanceof MetricsCollectorError && err.component === 'database'
      );
    });

    test('throws on non-number value', async () => {
      await assert.rejects(
        () => collector.record('database', 'latency_ms', 'not-a-number'),
        err => err instanceof MetricsCollectorError
      );
    });

    test('throws on NaN value', async () => {
      await assert.rejects(
        () => collector.record('database', 'latency_ms', NaN),
        err => err instanceof MetricsCollectorError
      );
    });

    test('wraps storage errors in MetricsCollectorError', async () => {
      storage.query = mock.fn(async () => {
        throw new Error('connection lost');
      });

      await assert.rejects(
        () => collector.record('database', 'latency_ms', 5),
        err =>
          err instanceof MetricsCollectorError &&
          err.operation === 'record' &&
          err.component === 'database' &&
          err.cause.message === 'connection lost'
      );
    });

    test('allows zero value', async () => {
      await collector.record('database', 'errors', 0);

      const call = storage.query.mock.calls[0];
      assert.deepStrictEqual(call.arguments[1], ['database', 'errors', 0]);
    });

    test('allows negative value', async () => {
      await collector.record('database', 'drift_ms', -10.5);

      const call = storage.query.mock.calls[0];
      assert.deepStrictEqual(call.arguments[1], ['database', 'drift_ms', -10.5]);
    });
  });

  // ========================================================================
  // recordBatch
  // ========================================================================

  describe('recordBatch', () => {
    test('records multiple entries', async () => {
      const entries = [
        { component: 'database', metric: 'latency_ms', value: 5 },
        { component: 'bots', metric: 'count', value: 3 },
      ];

      const result = await collector.recordBatch(entries);

      assert.equal(result.recorded, 2);
      assert.equal(result.failed, 0);
      assert.equal(storage.query.mock.callCount(), 2);
    });

    test('returns zeros for empty array', async () => {
      const result = await collector.recordBatch([]);

      assert.equal(result.recorded, 0);
      assert.equal(result.failed, 0);
    });

    test('throws on non-array input', async () => {
      await assert.rejects(
        () => collector.recordBatch('not-array'),
        err => err instanceof MetricsCollectorError && err.operation === 'recordBatch'
      );
    });

    test('counts failures without stopping batch', async () => {
      const entries = [
        { component: 'database', metric: 'latency_ms', value: 5 },
        { component: '', metric: 'bad', value: 0 }, // invalid - empty component
        { component: 'bots', metric: 'count', value: 3 },
      ];

      const result = await collector.recordBatch(entries);

      assert.equal(result.recorded, 2);
      assert.equal(result.failed, 1);
    });

    test('handles all entries failing', async () => {
      storage.query = mock.fn(async () => {
        throw new Error('db down');
      });

      const entries = [
        { component: 'database', metric: 'latency_ms', value: 5 },
        { component: 'bots', metric: 'count', value: 3 },
      ];

      const result = await collector.recordBatch(entries);

      assert.equal(result.recorded, 0);
      assert.equal(result.failed, 2);
    });
  });

  // ========================================================================
  // storeCheckResults
  // ========================================================================

  describe('storeCheckResults', () => {
    test('stores status as numeric value for each check', async () => {
      const { storage: trackStorage, queries } = createTrackingStorage();
      const c = new MetricsCollector({ storage: trackStorage });

      await c.storeCheckResults({
        database: { status: 'healthy', latencyMs: 5, lastCheckAt: '2026-01-01T00:00:00Z' },
      });

      // Should have status + latency_ms = 2 inserts
      assert.ok(queries.length >= 2);
      // First insert is status=1 (healthy)
      assert.deepStrictEqual(queries[0].params, ['database', 'status', 1]);
    });

    test('maps healthy status to 1', async () => {
      const { storage: trackStorage, queries } = createTrackingStorage();
      const c = new MetricsCollector({ storage: trackStorage });

      await c.storeCheckResults({
        db: { status: 'healthy', lastCheckAt: '2026-01-01T00:00:00Z' },
      });

      assert.deepStrictEqual(queries[0].params, ['db', 'status', 1]);
    });

    test('maps degraded status to 0.5', async () => {
      const { storage: trackStorage, queries } = createTrackingStorage();
      const c = new MetricsCollector({ storage: trackStorage });

      await c.storeCheckResults({
        bots: { status: 'degraded', lastCheckAt: '2026-01-01T00:00:00Z' },
      });

      assert.deepStrictEqual(queries[0].params, ['bots', 'status', 0.5]);
    });

    test('maps unhealthy status to 0', async () => {
      const { storage: trackStorage, queries } = createTrackingStorage();
      const c = new MetricsCollector({ storage: trackStorage });

      await c.storeCheckResults({
        channels: {
          status: 'unhealthy',
          error: 'Connection refused',
          lastCheckAt: '2026-01-01T00:00:00Z',
        },
      });

      assert.deepStrictEqual(queries[0].params, ['channels', 'status', 0]);
    });

    test('stores latencyMs when present', async () => {
      const { storage: trackStorage, queries } = createTrackingStorage();
      const c = new MetricsCollector({ storage: trackStorage });

      await c.storeCheckResults({
        database: { status: 'healthy', latencyMs: 5.2, lastCheckAt: '2026-01-01T00:00:00Z' },
      });

      // Second insert should be latency_ms
      assert.deepStrictEqual(queries[1].params, ['database', 'latency_ms', 5.2]);
    });

    test('stores additional numeric fields from results', async () => {
      const { storage: trackStorage, queries } = createTrackingStorage();
      const c = new MetricsCollector({ storage: trackStorage });

      await c.storeCheckResults({
        bots: {
          status: 'degraded',
          running: 2,
          total: 3,
          latencyMs: 10,
          lastCheckAt: '2026-01-01T00:00:00Z',
        },
      });

      // Expect: status, latency_ms, running, total = 4 entries
      const metrics = queries.map(q => q.params[1]);
      assert.ok(metrics.includes('status'));
      assert.ok(metrics.includes('latency_ms'));
      assert.ok(metrics.includes('running'));
      assert.ok(metrics.includes('total'));
    });

    test('skips non-numeric fields', async () => {
      const { storage: trackStorage, queries } = createTrackingStorage();
      const c = new MetricsCollector({ storage: trackStorage });

      await c.storeCheckResults({
        channels: {
          status: 'unhealthy',
          error: 'Connection refused',
          lastCheckAt: '2026-01-01T00:00:00Z',
        },
      });

      // Only status should be recorded (error and lastCheckAt are skipped)
      assert.equal(queries.length, 1);
      assert.deepStrictEqual(queries[0].params, ['channels', 'status', 0]);
    });

    test('handles multiple check results', async () => {
      const results = createSampleCheckResults();
      const result = await collector.storeCheckResults(results);

      assert.ok(result.recorded > 0);
    });

    test('handles empty check results', async () => {
      const result = await collector.storeCheckResults({});

      assert.equal(result.recorded, 0);
      assert.equal(result.failed, 0);
    });
  });

  // ========================================================================
  // query
  // ========================================================================

  describe('query', () => {
    test('queries all metrics with no filter', async () => {
      const rows = [
        { component: 'database', metric: 'latency_ms', value: 5, timestamp: new Date() },
      ];
      storage.query = mock.fn(async () => ({ rows }));

      const result = await collector.query();

      assert.deepStrictEqual(result, rows);
      const call = storage.query.mock.calls[0];
      assert.ok(call.arguments[0].includes('SELECT'));
      assert.ok(call.arguments[0].includes('ORDER BY timestamp DESC'));
    });

    test('filters by component', async () => {
      const { storage: trackStorage, queries } = createTrackingStorage();
      const c = new MetricsCollector({ storage: trackStorage });

      await c.query({ component: 'database' });

      assert.ok(queries[0].sql.includes('component = $1'));
      assert.equal(queries[0].params[0], 'database');
    });

    test('filters by metric', async () => {
      const { storage: trackStorage, queries } = createTrackingStorage();
      const c = new MetricsCollector({ storage: trackStorage });

      await c.query({ metric: 'latency_ms' });

      assert.ok(queries[0].sql.includes('metric = $1'));
      assert.equal(queries[0].params[0], 'latency_ms');
    });

    test('filters by since', async () => {
      const { storage: trackStorage, queries } = createTrackingStorage();
      const c = new MetricsCollector({ storage: trackStorage });
      const since = new Date('2026-01-01T00:00:00Z');

      await c.query({ since });

      assert.ok(queries[0].sql.includes('timestamp >= $1'));
      assert.equal(queries[0].params[0], since);
    });

    test('filters by until', async () => {
      const { storage: trackStorage, queries } = createTrackingStorage();
      const c = new MetricsCollector({ storage: trackStorage });
      const until = new Date('2026-01-31T23:59:59Z');

      await c.query({ until });

      assert.ok(queries[0].sql.includes('timestamp <= $1'));
      assert.equal(queries[0].params[0], until);
    });

    test('combines multiple filters', async () => {
      const { storage: trackStorage, queries } = createTrackingStorage();
      const c = new MetricsCollector({ storage: trackStorage });
      const since = new Date('2026-01-01T00:00:00Z');
      const until = new Date('2026-01-31T23:59:59Z');

      await c.query({ component: 'database', metric: 'latency_ms', since, until });

      const { sql } = queries[0];
      assert.ok(sql.includes('component = $1'));
      assert.ok(sql.includes('metric = $2'));
      assert.ok(sql.includes('timestamp >= $3'));
      assert.ok(sql.includes('timestamp <= $4'));
      assert.equal(queries[0].params.length, 5); // 4 filters + limit
    });

    test('uses default limit of 1000', async () => {
      const { storage: trackStorage, queries } = createTrackingStorage();
      const c = new MetricsCollector({ storage: trackStorage });

      await c.query();

      const lastParam = queries[0].params[queries[0].params.length - 1];
      assert.equal(lastParam, 1000);
    });

    test('accepts custom limit', async () => {
      const { storage: trackStorage, queries } = createTrackingStorage();
      const c = new MetricsCollector({ storage: trackStorage });

      await c.query({ limit: 50 });

      const lastParam = queries[0].params[queries[0].params.length - 1];
      assert.equal(lastParam, 50);
    });

    test('wraps storage errors in MetricsCollectorError', async () => {
      storage.query = mock.fn(async () => {
        throw new Error('query timeout');
      });

      await assert.rejects(
        () => collector.query(),
        err => err instanceof MetricsCollectorError && err.operation === 'query'
      );
    });
  });

  // ========================================================================
  // applyRetention
  // ========================================================================

  describe('applyRetention', () => {
    test('deletes metrics older than specified days', async () => {
      storage.query = mock.fn(async () => ({ rowCount: 42 }));

      const deleted = await collector.applyRetention(7);

      assert.equal(deleted, 42);
      const call = storage.query.mock.calls[0];
      assert.ok(call.arguments[0].includes('DELETE FROM health_metrics'));
      assert.ok(call.arguments[0].includes("INTERVAL '1 day'"));
      assert.equal(call.arguments[1][0], 7);
    });

    test('uses default retention days when no argument given', async () => {
      storage.query = mock.fn(async () => ({ rowCount: 10 }));
      const c = new MetricsCollector({ storage, retentionDays: 14 });

      await c.applyRetention();

      const call = storage.query.mock.calls[0];
      assert.equal(call.arguments[1][0], 14);
    });

    test('returns 0 when no rows deleted', async () => {
      storage.query = mock.fn(async () => ({ rowCount: 0 }));

      const deleted = await collector.applyRetention(30);

      assert.equal(deleted, 0);
    });

    test('throws on non-positive days', async () => {
      await assert.rejects(
        () => collector.applyRetention(0),
        err => err instanceof MetricsCollectorError && err.operation === 'applyRetention'
      );
    });

    test('throws on negative days', async () => {
      await assert.rejects(
        () => collector.applyRetention(-5),
        err => err instanceof MetricsCollectorError
      );
    });

    test('wraps storage errors in MetricsCollectorError', async () => {
      storage.query = mock.fn(async () => {
        throw new Error('permission denied');
      });

      await assert.rejects(
        () => collector.applyRetention(30),
        err =>
          err instanceof MetricsCollectorError &&
          err.operation === 'applyRetention' &&
          err.cause.message === 'permission denied'
      );
    });
  });

  // ========================================================================
  // getLatest
  // ========================================================================

  describe('getLatest', () => {
    test('returns latest values for a component', async () => {
      const ts = new Date('2026-01-15T10:00:00Z');
      storage.query = mock.fn(async () => ({
        rows: [
          { metric: 'latency_ms', value: 5.2, timestamp: ts },
          { metric: 'status', value: 1, timestamp: ts },
        ],
      }));

      const result = await collector.getLatest('database');

      assert.deepStrictEqual(result, {
        latency_ms: { value: 5.2, timestamp: ts },
        status: { value: 1, timestamp: ts },
      });
    });

    test('uses DISTINCT ON query pattern', async () => {
      const { storage: trackStorage, queries } = createTrackingStorage();
      const c = new MetricsCollector({ storage: trackStorage });

      await c.getLatest('database');

      assert.ok(queries[0].sql.includes('DISTINCT ON (metric)'));
      assert.equal(queries[0].params[0], 'database');
    });

    test('returns empty object when no metrics exist', async () => {
      const result = await collector.getLatest('nonexistent');

      assert.deepStrictEqual(result, {});
    });

    test('throws on empty component', async () => {
      await assert.rejects(
        () => collector.getLatest(''),
        err => err instanceof MetricsCollectorError && err.operation === 'getLatest'
      );
    });

    test('throws on non-string component', async () => {
      await assert.rejects(
        () => collector.getLatest(null),
        err => err instanceof MetricsCollectorError
      );
    });

    test('wraps storage errors in MetricsCollectorError', async () => {
      storage.query = mock.fn(async () => {
        throw new Error('connection lost');
      });

      await assert.rejects(
        () => collector.getLatest('database'),
        err =>
          err instanceof MetricsCollectorError &&
          err.operation === 'getLatest' &&
          err.component === 'database'
      );
    });
  });

  // ========================================================================
  // MetricsCollectorError
  // ========================================================================

  describe('MetricsCollectorError', () => {
    test('has correct name', () => {
      const err = new MetricsCollectorError('test error');
      assert.equal(err.name, 'MetricsCollectorError');
    });

    test('stores operation', () => {
      const err = new MetricsCollectorError('test', { operation: 'record' });
      assert.equal(err.operation, 'record');
    });

    test('stores component', () => {
      const err = new MetricsCollectorError('test', { component: 'database' });
      assert.equal(err.component, 'database');
    });

    test('stores cause', () => {
      const cause = new Error('root cause');
      const err = new MetricsCollectorError('test', { cause });
      assert.equal(err.cause, cause);
    });

    test('extends Error', () => {
      const err = new MetricsCollectorError('test');
      assert.ok(err instanceof Error);
    });
  });

  // ========================================================================
  // Logger integration
  // ========================================================================

  describe('logging', () => {
    test('logs when logger is provided', async () => {
      const logger = mock.fn();
      const c = new MetricsCollector({ storage, logger });

      await c.record('database', 'latency_ms', 5);

      assert.ok(logger.mock.callCount() > 0);
      const firstCall = logger.mock.calls[0].arguments[0];
      assert.ok(firstCall.includes('[MetricsCollector]'));
    });

    test('does not throw when logger is null', async () => {
      const c = new MetricsCollector({ storage });
      await assert.doesNotReject(() => c.record('database', 'latency_ms', 5));
    });
  });
});
