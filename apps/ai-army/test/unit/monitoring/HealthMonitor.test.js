/**
 * Unit tests for HealthMonitor
 *
 * Tests pluggable health check registration, execution, periodic scheduling,
 * status aggregation, and error handling.
 *
 * Tests:
 * - Constructor and default options
 * - registerCheck / unregisterCheck
 * - runChecks with healthy, degraded, unhealthy results
 * - Check timeout handling
 * - start / stop periodic scheduling
 * - getStatus aggregation
 * - Error handling and validation
 */

import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  HealthMonitor,
  HealthMonitorError,
  HEALTH_STATUSES,
} from '../../../src/monitoring/HealthMonitor.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a healthy check function
 * @param {Object} [extra={}] - Additional fields to return
 * @returns {Function} Mock check function
 */
function createHealthyCheck(extra = {}) {
  return mock.fn(async () => ({
    status: HEALTH_STATUSES.HEALTHY,
    ...extra,
  }));
}

/**
 * Create a degraded check function
 * @param {Object} [extra={}] - Additional fields to return
 * @returns {Function} Mock check function
 */
function createDegradedCheck(extra = {}) {
  return mock.fn(async () => ({
    status: HEALTH_STATUSES.DEGRADED,
    ...extra,
  }));
}

/**
 * Create an unhealthy check function
 * @param {string} [error='Component failed'] - Error message
 * @returns {Function} Mock check function
 */
function createUnhealthyCheck(error = 'Component failed') {
  return mock.fn(async () => ({
    status: HEALTH_STATUSES.UNHEALTHY,
    error,
  }));
}

/**
 * Create a check function that throws
 * @param {string} [message='Check exploded'] - Error message
 * @returns {Function} Mock check function
 */
function createThrowingCheck(message = 'Check exploded') {
  return mock.fn(async () => {
    throw new Error(message);
  });
}

/**
 * Create a slow check function for timeout testing
 * @param {number} delayMs - How long to delay
 * @returns {Function} Mock check function
 */
function createSlowCheck(delayMs) {
  return mock.fn(
    () => new Promise(resolve => setTimeout(() => resolve({ status: 'healthy' }), delayMs))
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('HealthMonitor', () => {
  let monitor;

  beforeEach(() => {
    monitor = new HealthMonitor({ checkTimeoutMs: 500 });
  });

  afterEach(() => {
    monitor.stop();
  });

  // ========================================================================
  // Constructor
  // ========================================================================

  describe('constructor', () => {
    test('creates instance with default options', () => {
      const m = new HealthMonitor();
      assert.ok(m);
      assert.equal(m.logger, null);
      assert.equal(m.checkTimeoutMs, 10000);
      assert.equal(m.checks.size, 0);
      assert.equal(m.results.size, 0);
      assert.equal(m.isRunning(), false);
    });

    test('accepts logger option', () => {
      const logger = mock.fn();
      const m = new HealthMonitor({ logger });
      assert.equal(m.logger, logger);
    });

    test('accepts checkTimeoutMs option', () => {
      const m = new HealthMonitor({ checkTimeoutMs: 5000 });
      assert.equal(m.checkTimeoutMs, 5000);
    });
  });

  // ========================================================================
  // HEALTH_STATUSES
  // ========================================================================

  describe('HEALTH_STATUSES', () => {
    test('has expected values', () => {
      assert.equal(HEALTH_STATUSES.HEALTHY, 'healthy');
      assert.equal(HEALTH_STATUSES.DEGRADED, 'degraded');
      assert.equal(HEALTH_STATUSES.UNHEALTHY, 'unhealthy');
    });

    test('is frozen', () => {
      assert.ok(Object.isFrozen(HEALTH_STATUSES));
    });
  });

  // ========================================================================
  // registerCheck
  // ========================================================================

  describe('registerCheck', () => {
    test('registers a check with name and function', () => {
      const checkFn = createHealthyCheck();
      monitor.registerCheck('db', checkFn, 5000);

      assert.equal(monitor.checks.size, 1);
      assert.ok(monitor.checks.has('db'));
      assert.equal(monitor.checks.get('db').fn, checkFn);
      assert.equal(monitor.checks.get('db').interval, 5000);
    });

    test('uses default interval when not specified', () => {
      monitor.registerCheck('db', createHealthyCheck());
      assert.equal(monitor.checks.get('db').interval, 30000);
    });

    test('throws on empty name', () => {
      assert.throws(
        () => monitor.registerCheck('', createHealthyCheck()),
        err => err instanceof HealthMonitorError && err.operation === 'registerCheck'
      );
    });

    test('throws on non-string name', () => {
      assert.throws(
        () => monitor.registerCheck(42, createHealthyCheck()),
        err => err instanceof HealthMonitorError
      );
    });

    test('throws on non-function checkFn', () => {
      assert.throws(
        () => monitor.registerCheck('db', 'not-a-function'),
        err => err instanceof HealthMonitorError && err.checkName === 'db'
      );
    });

    test('throws on invalid interval', () => {
      assert.throws(
        () => monitor.registerCheck('db', createHealthyCheck(), -1),
        err => err instanceof HealthMonitorError
      );
    });

    test('throws on zero interval', () => {
      assert.throws(
        () => monitor.registerCheck('db', createHealthyCheck(), 0),
        err => err instanceof HealthMonitorError
      );
    });

    test('replaces existing check with same name', () => {
      const checkFn1 = createHealthyCheck();
      const checkFn2 = createDegradedCheck();

      monitor.registerCheck('db', checkFn1, 5000);
      monitor.registerCheck('db', checkFn2, 10000);

      assert.equal(monitor.checks.size, 1);
      assert.equal(monitor.checks.get('db').fn, checkFn2);
      assert.equal(monitor.checks.get('db').interval, 10000);
    });
  });

  // ========================================================================
  // unregisterCheck
  // ========================================================================

  describe('unregisterCheck', () => {
    test('removes a registered check', () => {
      monitor.registerCheck('db', createHealthyCheck());
      const removed = monitor.unregisterCheck('db');

      assert.ok(removed);
      assert.equal(monitor.checks.size, 0);
    });

    test('returns false for non-existent check', () => {
      const removed = monitor.unregisterCheck('nonexistent');
      assert.equal(removed, false);
    });

    test('removes results for unregistered check', async () => {
      monitor.registerCheck('db', createHealthyCheck());
      await monitor.runChecks();
      assert.ok(monitor.results.has('db'));

      monitor.unregisterCheck('db');
      assert.equal(monitor.results.has('db'), false);
    });
  });

  // ========================================================================
  // runChecks
  // ========================================================================

  describe('runChecks', () => {
    test('runs all registered checks and returns results', async () => {
      monitor.registerCheck('db', createHealthyCheck({ latency: 5 }));
      monitor.registerCheck('bots', createDegradedCheck({ running: 2, total: 3 }));

      const results = await monitor.runChecks();

      assert.equal(results.db.status, 'healthy');
      assert.equal(results.db.latency, 5);
      assert.equal(results.bots.status, 'degraded');
      assert.equal(results.bots.running, 2);
    });

    test('returns empty object when no checks registered', async () => {
      const results = await monitor.runChecks();
      assert.deepStrictEqual(results, {});
    });

    test('records unhealthy status when check throws', async () => {
      monitor.registerCheck('db', createThrowingCheck('Connection refused'));

      const results = await monitor.runChecks();

      assert.equal(results.db.status, 'unhealthy');
      assert.equal(results.db.error, 'Connection refused');
    });

    test('records unhealthy status when check times out', async () => {
      monitor.registerCheck('slow', createSlowCheck(2000));

      const results = await monitor.runChecks();

      assert.equal(results.slow.status, 'unhealthy');
      assert.ok(results.slow.error.includes('timed out'));
    });

    test('stores results in results map', async () => {
      monitor.registerCheck('db', createHealthyCheck());
      await monitor.runChecks();

      const stored = monitor.results.get('db');
      assert.ok(stored);
      assert.equal(stored.status, 'healthy');
      assert.ok(stored.lastCheckAt);
      assert.ok(typeof stored.latencyMs === 'number');
    });

    test('includes latencyMs in results', async () => {
      monitor.registerCheck('db', createHealthyCheck());
      const results = await monitor.runChecks();

      assert.ok(typeof results.db.latencyMs === 'number');
      assert.ok(results.db.latencyMs >= 0);
    });

    test('includes lastCheckAt in results', async () => {
      monitor.registerCheck('db', createHealthyCheck());
      const results = await monitor.runChecks();

      assert.ok(results.db.lastCheckAt);
      // Validate ISO string format
      assert.ok(!isNaN(new Date(results.db.lastCheckAt).getTime()));
    });
  });

  // ========================================================================
  // start / stop
  // ========================================================================

  describe('start', () => {
    test('starts the monitor and runs initial checks', async () => {
      const checkFn = createHealthyCheck();
      monitor.registerCheck('db', checkFn, 60000);

      await monitor.start();

      assert.ok(monitor.isRunning());
      assert.equal(checkFn.mock.callCount(), 1);
    });

    test('is idempotent when already running', async () => {
      const checkFn = createHealthyCheck();
      monitor.registerCheck('db', checkFn, 60000);

      await monitor.start();
      await monitor.start(); // Should not run checks again

      assert.equal(checkFn.mock.callCount(), 1);
    });

    test('sets startedAt timestamp', async () => {
      await monitor.start();
      assert.ok(monitor._startedAt instanceof Date);
    });
  });

  describe('stop', () => {
    test('stops the monitor', async () => {
      monitor.registerCheck('db', createHealthyCheck(), 60000);
      await monitor.start();

      monitor.stop();

      assert.equal(monitor.isRunning(), false);
      assert.equal(monitor._timers.size, 0);
    });

    test('is idempotent when not running', () => {
      monitor.stop(); // Should not throw
      assert.equal(monitor.isRunning(), false);
    });

    test('preserves results after stopping', async () => {
      monitor.registerCheck('db', createHealthyCheck());
      await monitor.start();
      monitor.stop();

      assert.ok(monitor.results.has('db'));
      assert.equal(monitor.results.get('db').status, 'healthy');
    });
  });

  // ========================================================================
  // getStatus
  // ========================================================================

  describe('getStatus', () => {
    test('returns healthy when all checks are healthy', async () => {
      monitor.registerCheck('db', createHealthyCheck());
      monitor.registerCheck('bots', createHealthyCheck());
      await monitor.runChecks();

      const status = monitor.getStatus();

      assert.equal(status.status, 'healthy');
      assert.ok(status.timestamp);
      assert.ok(status.checks.db);
      assert.ok(status.checks.bots);
    });

    test('returns degraded when any check is degraded', async () => {
      monitor.registerCheck('db', createHealthyCheck());
      monitor.registerCheck('bots', createDegradedCheck());
      await monitor.runChecks();

      const status = monitor.getStatus();
      assert.equal(status.status, 'degraded');
    });

    test('returns unhealthy when any check is unhealthy', async () => {
      monitor.registerCheck('db', createUnhealthyCheck());
      monitor.registerCheck('bots', createDegradedCheck());
      await monitor.runChecks();

      const status = monitor.getStatus();
      assert.equal(status.status, 'unhealthy');
    });

    test('unhealthy takes precedence over degraded', async () => {
      monitor.registerCheck('db', createUnhealthyCheck());
      monitor.registerCheck('bots', createDegradedCheck());
      monitor.registerCheck('channels', createHealthyCheck());
      await monitor.runChecks();

      const status = monitor.getStatus();
      assert.equal(status.status, 'unhealthy');
    });

    test('returns healthy with empty checks', () => {
      const status = monitor.getStatus();
      assert.equal(status.status, 'healthy');
      assert.deepStrictEqual(status.checks, {});
    });

    test('includes uptime when started', async () => {
      await monitor.start();

      // Wait a tiny bit so uptime is > 0
      await new Promise(resolve => setTimeout(resolve, 50));

      const status = monitor.getStatus();
      assert.ok(status.uptime >= 0);
    });

    test('uptime is 0 when not started', () => {
      const status = monitor.getStatus();
      assert.equal(status.uptime, 0);
    });

    test('includes timestamp as ISO string', async () => {
      monitor.registerCheck('db', createHealthyCheck());
      await monitor.runChecks();

      const status = monitor.getStatus();
      assert.ok(status.timestamp);
      assert.ok(!isNaN(new Date(status.timestamp).getTime()));
    });
  });

  // ========================================================================
  // getCheckCount
  // ========================================================================

  describe('getCheckCount', () => {
    test('returns 0 for no checks', () => {
      assert.equal(monitor.getCheckCount(), 0);
    });

    test('returns correct count after registration', () => {
      monitor.registerCheck('db', createHealthyCheck());
      monitor.registerCheck('bots', createHealthyCheck());
      assert.equal(monitor.getCheckCount(), 2);
    });

    test('decrements after unregister', () => {
      monitor.registerCheck('db', createHealthyCheck());
      monitor.registerCheck('bots', createHealthyCheck());
      monitor.unregisterCheck('db');
      assert.equal(monitor.getCheckCount(), 1);
    });
  });

  // ========================================================================
  // getCheckResult
  // ========================================================================

  describe('getCheckResult', () => {
    test('returns undefined for unregistered check', () => {
      assert.equal(monitor.getCheckResult('nonexistent'), undefined);
    });

    test('returns result after running check', async () => {
      monitor.registerCheck('db', createHealthyCheck({ latency: 5 }));
      await monitor.runChecks();

      const result = monitor.getCheckResult('db');
      assert.ok(result);
      assert.equal(result.status, 'healthy');
      assert.equal(result.latency, 5);
    });
  });

  // ========================================================================
  // HealthMonitorError
  // ========================================================================

  describe('HealthMonitorError', () => {
    test('has correct name', () => {
      const err = new HealthMonitorError('test error');
      assert.equal(err.name, 'HealthMonitorError');
    });

    test('stores operation', () => {
      const err = new HealthMonitorError('test', { operation: 'registerCheck' });
      assert.equal(err.operation, 'registerCheck');
    });

    test('stores checkName', () => {
      const err = new HealthMonitorError('test', { checkName: 'db' });
      assert.equal(err.checkName, 'db');
    });

    test('stores cause', () => {
      const cause = new Error('root cause');
      const err = new HealthMonitorError('test', { cause });
      assert.equal(err.cause, cause);
    });

    test('extends Error', () => {
      const err = new HealthMonitorError('test');
      assert.ok(err instanceof Error);
    });
  });

  // ========================================================================
  // Logger integration
  // ========================================================================

  describe('logging', () => {
    test('logs when logger is provided', () => {
      const logger = mock.fn();
      const m = new HealthMonitor({ logger });

      m.registerCheck('db', createHealthyCheck());

      assert.ok(logger.mock.callCount() > 0);
      const firstCall = logger.mock.calls[0].arguments[0];
      assert.ok(firstCall.includes('[HealthMonitor]'));
    });

    test('does not throw when logger is null', () => {
      const m = new HealthMonitor();
      assert.doesNotThrow(() => m.registerCheck('db', createHealthyCheck()));
    });
  });

  // ========================================================================
  // Dynamic registration while running
  // ========================================================================

  describe('dynamic registration while running', () => {
    test('starts timer for newly registered check when monitor is running', async () => {
      await monitor.start();

      const checkFn = createHealthyCheck();
      monitor.registerCheck('new-check', checkFn, 60000);

      assert.ok(monitor._timers.has('new-check'));
    });

    test('unregistering while running clears the timer', async () => {
      monitor.registerCheck('db', createHealthyCheck(), 60000);
      await monitor.start();

      assert.ok(monitor._timers.has('db'));

      monitor.unregisterCheck('db');
      assert.equal(monitor._timers.has('db'), false);
    });
  });
});
