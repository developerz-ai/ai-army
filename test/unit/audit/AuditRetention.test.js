/**
 * Unit tests for AuditRetention
 *
 * Tests scheduled cleanup of old audit log entries, lifecycle management
 * (start/stop), constructor validation, and error handling.
 *
 * Tests:
 * - Constructor validation and defaults
 * - start() lifecycle and scheduling
 * - stop() cleanup and idempotency
 * - cleanOldLogs() delegation to AuditLogger.applyRetention()
 * - isRunning() state tracking
 * - Error handling for cleanup failures
 */

import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { AuditRetention, AuditRetentionError } from '../../../src/audit/audit-retention.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock AuditLogger instance
 * @param {Object} [overrides={}] - Override default mock responses
 * @returns {Object} Mock AuditLogger with applyRetention method
 */
function createMockAuditLogger(overrides = {}) {
  return {
    applyRetention: mock.fn(async () => overrides.deletedCount ?? 0),
    log: mock.fn(async () => {}),
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('AuditRetention', () => {
  let auditLogger;
  let retention;

  beforeEach(() => {
    auditLogger = createMockAuditLogger();
    retention = new AuditRetention({ auditLogger });
  });

  afterEach(() => {
    // Always stop the retention scheduler to avoid timer leaks
    if (retention && retention.isRunning()) {
      retention.stop();
    }
  });

  // ========================================================================
  // Constructor
  // ========================================================================

  describe('constructor', () => {
    test('creates instance with required auditLogger', () => {
      const ar = new AuditRetention({ auditLogger });
      assert.ok(ar);
      assert.equal(ar.auditLogger, auditLogger);
      assert.equal(ar.retentionDays, 90);
      assert.equal(ar.intervalMs, 24 * 60 * 60 * 1000);
      assert.equal(ar.logger, null);
      assert.equal(ar.runOnStart, false);
    });

    test('accepts retentionDays option', () => {
      const ar = new AuditRetention({ auditLogger, retentionDays: 30 });
      assert.equal(ar.retentionDays, 30);
    });

    test('accepts intervalMs option', () => {
      const ar = new AuditRetention({ auditLogger, intervalMs: 60000 });
      assert.equal(ar.intervalMs, 60000);
    });

    test('accepts logger option', () => {
      const logger = mock.fn();
      const ar = new AuditRetention({ auditLogger, logger });
      assert.equal(ar.logger, logger);
    });

    test('accepts runOnStart option', () => {
      const ar = new AuditRetention({ auditLogger, runOnStart: true });
      assert.equal(ar.runOnStart, true);
    });

    test('throws when auditLogger is missing', () => {
      assert.throws(
        () => new AuditRetention({}),
        err => err instanceof AuditRetentionError && err.operation === 'constructor'
      );
    });

    test('throws when auditLogger lacks applyRetention method', () => {
      assert.throws(
        () => new AuditRetention({ auditLogger: {} }),
        err => err instanceof AuditRetentionError && err.operation === 'constructor'
      );
    });

    test('throws when retentionDays is not a positive number', () => {
      assert.throws(
        () => new AuditRetention({ auditLogger, retentionDays: 0 }),
        err => err instanceof AuditRetentionError && err.operation === 'constructor'
      );
    });

    test('throws when retentionDays is negative', () => {
      assert.throws(
        () => new AuditRetention({ auditLogger, retentionDays: -1 }),
        err => err instanceof AuditRetentionError
      );
    });

    test('throws when intervalMs is not a positive number', () => {
      assert.throws(
        () => new AuditRetention({ auditLogger, intervalMs: 0 }),
        err => err instanceof AuditRetentionError && err.operation === 'constructor'
      );
    });

    test('throws when intervalMs is negative', () => {
      assert.throws(
        () => new AuditRetention({ auditLogger, intervalMs: -1000 }),
        err => err instanceof AuditRetentionError
      );
    });

    test('throws with no arguments', () => {
      assert.throws(
        () => new AuditRetention(),
        err => err instanceof AuditRetentionError
      );
    });
  });

  // ========================================================================
  // start
  // ========================================================================

  describe('start', () => {
    test('sets running state to true', async () => {
      assert.equal(retention.isRunning(), false);
      await retention.start();
      assert.equal(retention.isRunning(), true);
    });

    test('is a no-op when already running', async () => {
      await retention.start();
      assert.equal(retention.isRunning(), true);

      // Start again should not throw or change state
      await retention.start();
      assert.equal(retention.isRunning(), true);
    });

    test('runs cleanup immediately when runOnStart is true', async () => {
      const ar = new AuditRetention({
        auditLogger,
        runOnStart: true,
        intervalMs: 100000,
      });

      await ar.start();

      assert.equal(auditLogger.applyRetention.mock.callCount(), 1);
      assert.equal(auditLogger.applyRetention.mock.calls[0].arguments[0], 90);
      ar.stop();
    });

    test('does not run cleanup immediately when runOnStart is false', async () => {
      await retention.start();

      assert.equal(auditLogger.applyRetention.mock.callCount(), 0);
    });

    test('logs start message when logger is provided', async () => {
      const logger = mock.fn();
      const ar = new AuditRetention({ auditLogger, logger });

      await ar.start();

      assert.ok(logger.mock.callCount() > 0);
      const msg = logger.mock.calls[0].arguments[0];
      assert.ok(msg.includes('[AuditRetention]'));
      assert.ok(msg.includes('started'));
      ar.stop();
    });
  });

  // ========================================================================
  // stop
  // ========================================================================

  describe('stop', () => {
    test('sets running state to false', async () => {
      await retention.start();
      assert.equal(retention.isRunning(), true);

      retention.stop();
      assert.equal(retention.isRunning(), false);
    });

    test('is a no-op when not running', () => {
      assert.equal(retention.isRunning(), false);
      retention.stop(); // should not throw
      assert.equal(retention.isRunning(), false);
    });

    test('clears the interval timer', async () => {
      await retention.start();
      assert.ok(retention._timer !== null);

      retention.stop();
      assert.equal(retention._timer, null);
    });

    test('logs stop message when logger is provided', async () => {
      const logger = mock.fn();
      const ar = new AuditRetention({ auditLogger, logger });

      await ar.start();
      ar.stop();

      const stopMsg = logger.mock.calls.find(call => call.arguments[0].includes('stopped'));
      assert.ok(stopMsg, 'Expected a stop log message');
    });
  });

  // ========================================================================
  // cleanOldLogs
  // ========================================================================

  describe('cleanOldLogs', () => {
    test('delegates to auditLogger.applyRetention with given days', async () => {
      auditLogger.applyRetention = mock.fn(async () => 42);

      const deleted = await retention.cleanOldLogs(30);

      assert.equal(deleted, 42);
      assert.equal(auditLogger.applyRetention.mock.callCount(), 1);
      assert.equal(auditLogger.applyRetention.mock.calls[0].arguments[0], 30);
    });

    test('uses default retentionDays when no argument given', async () => {
      auditLogger.applyRetention = mock.fn(async () => 10);

      await retention.cleanOldLogs();

      assert.equal(auditLogger.applyRetention.mock.calls[0].arguments[0], 90);
    });

    test('uses custom retentionDays from constructor', async () => {
      const ar = new AuditRetention({ auditLogger, retentionDays: 60 });
      auditLogger.applyRetention = mock.fn(async () => 5);

      await ar.cleanOldLogs();

      assert.equal(auditLogger.applyRetention.mock.calls[0].arguments[0], 60);
    });

    test('returns the number of deleted rows', async () => {
      auditLogger.applyRetention = mock.fn(async () => 100);

      const result = await retention.cleanOldLogs(90);

      assert.equal(result, 100);
    });

    test('returns 0 when no rows deleted', async () => {
      auditLogger.applyRetention = mock.fn(async () => 0);

      const result = await retention.cleanOldLogs(90);

      assert.equal(result, 0);
    });

    test('throws AuditRetentionError when applyRetention fails', async () => {
      auditLogger.applyRetention = mock.fn(async () => {
        throw new Error('connection lost');
      });

      await assert.rejects(
        () => retention.cleanOldLogs(90),
        err =>
          err instanceof AuditRetentionError &&
          err.operation === 'cleanOldLogs' &&
          err.cause.message === 'connection lost'
      );
    });

    test('logs success message when logger is provided', async () => {
      const logger = mock.fn();
      const ar = new AuditRetention({ auditLogger, logger });
      auditLogger.applyRetention = mock.fn(async () => 25);

      await ar.cleanOldLogs(30);

      const cleanMsg = logger.mock.calls.find(call => call.arguments[0].includes('Cleaned 25'));
      assert.ok(cleanMsg, 'Expected a cleanup success log message');
    });

    test('logs failure message when applyRetention fails', async () => {
      const logger = mock.fn();
      const ar = new AuditRetention({ auditLogger, logger });
      auditLogger.applyRetention = mock.fn(async () => {
        throw new Error('disk full');
      });

      await assert.rejects(() => ar.cleanOldLogs(30));

      const failMsg = logger.mock.calls.find(call => call.arguments[0].includes('Failed to clean'));
      assert.ok(failMsg, 'Expected a cleanup failure log message');
    });
  });

  // ========================================================================
  // isRunning
  // ========================================================================

  describe('isRunning', () => {
    test('returns false initially', () => {
      assert.equal(retention.isRunning(), false);
    });

    test('returns true after start', async () => {
      await retention.start();
      assert.equal(retention.isRunning(), true);
    });

    test('returns false after stop', async () => {
      await retention.start();
      retention.stop();
      assert.equal(retention.isRunning(), false);
    });
  });

  // ========================================================================
  // AuditRetentionError
  // ========================================================================

  describe('AuditRetentionError', () => {
    test('has correct name', () => {
      const err = new AuditRetentionError('test error');
      assert.equal(err.name, 'AuditRetentionError');
    });

    test('stores operation', () => {
      const err = new AuditRetentionError('test', { operation: 'cleanOldLogs' });
      assert.equal(err.operation, 'cleanOldLogs');
    });

    test('stores cause', () => {
      const cause = new Error('root cause');
      const err = new AuditRetentionError('test', { cause });
      assert.equal(err.cause, cause);
    });

    test('extends Error', () => {
      const err = new AuditRetentionError('test');
      assert.ok(err instanceof Error);
    });
  });
});
