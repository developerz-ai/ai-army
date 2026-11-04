/**
 * Unit tests for Alerter
 *
 * Tests threshold-based alerting, Slack webhook delivery, cooldown logic,
 * recovery detection, and alert history tracking.
 *
 * Tests:
 * - Constructor validation
 * - Threshold-based alerting (consecutive failures)
 * - Cooldown period enforcement
 * - Recovery detection
 * - Slack webhook integration
 * - Alert history management
 * - Reset behavior
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Alerter, AlerterError, ALERT_SEVERITIES } from '../../../src/monitoring/Alerter.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock fetch function that returns a successful response
 * @returns {Function} Mock fetch function
 */
function createMockFetch() {
  return mock.fn(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
  }));
}

/**
 * Create a mock fetch that returns an error response
 * @param {number} [status=500] - HTTP status code
 * @returns {Function} Mock fetch function
 */
function createFailingFetch(status = 500) {
  return mock.fn(async () => ({
    ok: false,
    status,
    statusText: 'Internal Server Error',
  }));
}

/**
 * Create check results for testing
 * @param {Object} overrides - Per-check status overrides
 * @returns {Object} Check results
 */
function createCheckResults(overrides = {}) {
  return {
    database: { status: 'healthy', latency: 5, ...overrides.database },
    bots: { status: 'healthy', running: 3, total: 3, ...overrides.bots },
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Alerter', () => {
  /** @type {Alerter} */
  let alerter;
  /** @type {Function} */
  let mockFetch;

  beforeEach(() => {
    mockFetch = createMockFetch();
    alerter = new Alerter({
      logger: null,
      threshold: 2,
      cooldownMs: 0, // No cooldown for tests
      slack: { webhook: 'https://hooks.slack.com/services/test/webhook' },
      fetch: mockFetch,
    });
  });

  // --------------------------------------------------------------------------
  // Constructor
  // --------------------------------------------------------------------------

  describe('constructor', () => {
    test('creates instance with default options', () => {
      const a = new Alerter();
      assert.equal(a.threshold, 2);
      assert.equal(a.cooldownMs, 5 * 60 * 1000);
      assert.equal(a.slack, null);
      assert.deepStrictEqual(a.alertHistory, []);
    });

    test('accepts custom options', () => {
      const a = new Alerter({
        threshold: 5,
        cooldownMs: 60000,
        slack: { webhook: 'https://example.com/hook' },
      });
      assert.equal(a.threshold, 5);
      assert.equal(a.cooldownMs, 60000);
      assert.equal(a.slack.webhook, 'https://example.com/hook');
    });

    test('throws on invalid threshold', () => {
      assert.throws(
        () => new Alerter({ threshold: 0 }),
        err => err instanceof AlerterError && err.operation === 'constructor'
      );
      assert.throws(
        () => new Alerter({ threshold: -1 }),
        err => err instanceof AlerterError
      );
    });

    test('throws on negative cooldown', () => {
      assert.throws(
        () => new Alerter({ cooldownMs: -1 }),
        err => err instanceof AlerterError && err.operation === 'constructor'
      );
    });
  });

  // --------------------------------------------------------------------------
  // evaluate
  // --------------------------------------------------------------------------

  describe('evaluate', () => {
    test('returns empty array for null/undefined input', async () => {
      const result = await alerter.evaluate(null);
      assert.deepStrictEqual(result, []);
    });

    test('does not alert on healthy checks', async () => {
      const results = createCheckResults();
      const alerts = await alerter.evaluate(results);
      assert.equal(alerts.length, 0);
    });

    test('does not alert before threshold is reached', async () => {
      const results = createCheckResults({
        database: { status: 'unhealthy', error: 'Connection refused' },
      });

      // First evaluation — failure count = 1, threshold = 2
      const alerts = await alerter.evaluate(results);
      assert.equal(alerts.length, 0);
      assert.equal(alerter.getFailureCount('database'), 1);
    });

    test('alerts when threshold is reached', async () => {
      const results = createCheckResults({
        database: { status: 'unhealthy', error: 'Connection refused' },
      });

      // First evaluation — failure count = 1
      await alerter.evaluate(results);
      // Second evaluation — failure count = 2 (threshold met)
      const alerts = await alerter.evaluate(results);

      assert.equal(alerts.length, 1);
      assert.equal(alerts[0].checkName, 'database');
      assert.equal(alerts[0].severity, ALERT_SEVERITIES.CRITICAL);
      assert.equal(alerts[0].status, 'unhealthy');
    });

    test('sends warning for degraded status', async () => {
      const results = createCheckResults({
        bots: { status: 'degraded', running: 1, total: 3 },
      });

      await alerter.evaluate(results);
      const alerts = await alerter.evaluate(results);

      const botAlert = alerts.find(a => a.checkName === 'bots');
      assert.ok(botAlert);
      assert.equal(botAlert.severity, ALERT_SEVERITIES.WARNING);
    });

    test('sends recovery alert when returning to healthy', async () => {
      const unhealthyResults = createCheckResults({
        database: { status: 'unhealthy', error: 'Down' },
      });
      const healthyResults = createCheckResults({
        database: { status: 'healthy', latency: 3 },
      });

      // Trigger alerting state
      await alerter.evaluate(unhealthyResults);
      await alerter.evaluate(unhealthyResults);

      // Now recover
      const alerts = await alerter.evaluate(healthyResults);

      const recovery = alerts.find(
        a => a.checkName === 'database' && a.severity === ALERT_SEVERITIES.RECOVERY
      );
      assert.ok(recovery, 'Should have a recovery alert');
      assert.equal(recovery.status, 'healthy');
    });

    test('resets failure count on recovery', async () => {
      const unhealthyResults = createCheckResults({
        database: { status: 'unhealthy', error: 'Down' },
      });
      const healthyResults = createCheckResults();

      await alerter.evaluate(unhealthyResults);
      assert.equal(alerter.getFailureCount('database'), 1);

      await alerter.evaluate(healthyResults);
      assert.equal(alerter.getFailureCount('database'), 0);
    });

    test('tracks failure count across evaluations', async () => {
      const unhealthyResults = createCheckResults({
        database: { status: 'unhealthy', error: 'Down' },
      });

      await alerter.evaluate(unhealthyResults);
      assert.equal(alerter.getFailureCount('database'), 1);

      await alerter.evaluate(unhealthyResults);
      assert.equal(alerter.getFailureCount('database'), 2);

      await alerter.evaluate(unhealthyResults);
      assert.equal(alerter.getFailureCount('database'), 3);
    });
  });

  // --------------------------------------------------------------------------
  // Cooldown
  // --------------------------------------------------------------------------

  describe('cooldown', () => {
    test('respects cooldown period', async () => {
      const cooldownAlerter = new Alerter({
        threshold: 1,
        cooldownMs: 60000, // 60 seconds
        slack: { webhook: 'https://hooks.slack.com/services/test' },
        fetch: mockFetch,
      });

      const results = createCheckResults({
        database: { status: 'unhealthy', error: 'Down' },
      });

      // First alert should go through
      const firstAlerts = await cooldownAlerter.evaluate(results);
      assert.equal(firstAlerts.length, 1);

      // Second alert should be blocked by cooldown
      const secondAlerts = await cooldownAlerter.evaluate(results);
      assert.equal(secondAlerts.length, 0);
    });

    test('allows alert after cooldown expires', async () => {
      const cooldownAlerter = new Alerter({
        threshold: 1,
        cooldownMs: 0, // No cooldown
        slack: { webhook: 'https://hooks.slack.com/services/test' },
        fetch: mockFetch,
      });

      const results = createCheckResults({
        database: { status: 'unhealthy', error: 'Down' },
      });

      const firstAlerts = await cooldownAlerter.evaluate(results);
      assert.equal(firstAlerts.length, 1);

      const secondAlerts = await cooldownAlerter.evaluate(results);
      assert.equal(secondAlerts.length, 1);
    });
  });

  // --------------------------------------------------------------------------
  // Slack Integration
  // --------------------------------------------------------------------------

  describe('Slack integration', () => {
    test('sends webhook request for critical alert', async () => {
      const results = createCheckResults({
        database: { status: 'unhealthy', error: 'Connection refused' },
      });

      await alerter.evaluate(results);
      await alerter.evaluate(results);

      assert.equal(mockFetch.mock.callCount(), 1);

      const [url, options] = mockFetch.mock.calls[0].arguments;
      assert.equal(url, 'https://hooks.slack.com/services/test/webhook');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers['Content-Type'], 'application/json');

      const payload = JSON.parse(options.body);
      assert.ok(payload.text.includes('database'));
      assert.ok(payload.text.includes('unhealthy'));
      assert.ok(payload.attachments);
      assert.equal(payload.attachments[0].color, '#dc3545'); // Critical = red
    });

    test('sends recovery alert to Slack', async () => {
      const unhealthyResults = createCheckResults({
        database: { status: 'unhealthy', error: 'Down' },
      });
      const healthyResults = createCheckResults();

      await alerter.evaluate(unhealthyResults);
      await alerter.evaluate(unhealthyResults);

      // Reset mock count to isolate recovery call
      const callCountBeforeRecovery = mockFetch.mock.callCount();

      await alerter.evaluate(healthyResults);

      assert.equal(mockFetch.mock.callCount(), callCountBeforeRecovery + 1);
      const lastCall = mockFetch.mock.calls[mockFetch.mock.callCount() - 1];
      const payload = JSON.parse(lastCall.arguments[1].body);
      assert.ok(payload.text.includes('Recovery'));
      assert.equal(payload.attachments[0].color, '#28a745'); // Recovery = green
    });

    test('includes channel and username overrides', async () => {
      const a = new Alerter({
        threshold: 1,
        cooldownMs: 0,
        slack: {
          webhook: 'https://hooks.slack.com/services/test',
          channel: '#ops-alerts',
          username: 'Health Bot',
        },
        fetch: mockFetch,
      });

      await a.evaluate({
        db: { status: 'unhealthy', error: 'Down' },
      });

      const payload = JSON.parse(mockFetch.mock.calls[0].arguments[1].body);
      assert.equal(payload.channel, '#ops-alerts');
      assert.equal(payload.username, 'Health Bot');
    });

    test('handles Slack webhook failure gracefully', async () => {
      const failFetch = createFailingFetch(500);
      const logs = [];
      const a = new Alerter({
        threshold: 1,
        cooldownMs: 0,
        slack: { webhook: 'https://hooks.slack.com/services/test' },
        fetch: failFetch,
        logger: msg => logs.push(msg),
      });

      const results = { db: { status: 'unhealthy', error: 'Down' } };
      const alerts = await a.evaluate(results);

      // Alert record should still be created
      assert.equal(alerts.length, 1);
      // But 'slack' should not be in delivered
      assert.ok(!alerts[0].delivered.includes('slack'));
      // Should have logged the failure
      assert.ok(logs.some(l => l.includes('Failed to send Slack alert')));
    });

    test('works without Slack configuration', async () => {
      const a = new Alerter({
        threshold: 1,
        cooldownMs: 0,
      });

      const alerts = await a.evaluate({
        db: { status: 'unhealthy', error: 'Down' },
      });

      // Alert should still be created (just not delivered anywhere)
      assert.equal(alerts.length, 1);
      assert.deepStrictEqual(alerts[0].delivered, []);
    });
  });

  // --------------------------------------------------------------------------
  // Alert History
  // --------------------------------------------------------------------------

  describe('alert history', () => {
    test('records alerts in history', async () => {
      const results = createCheckResults({
        database: { status: 'unhealthy', error: 'Down' },
      });

      await alerter.evaluate(results);
      await alerter.evaluate(results);

      const history = alerter.getAlertHistory();
      assert.equal(history.length, 1);
      assert.equal(history[0].checkName, 'database');
      assert.ok(history[0].timestamp);
    });

    test('returns limited history', async () => {
      // Generate multiple alerts
      for (let i = 0; i < 5; i++) {
        await alerter.evaluate({
          [`check${i}`]: { status: 'unhealthy', error: 'Down' },
        });
        await alerter.evaluate({
          [`check${i}`]: { status: 'unhealthy', error: 'Down' },
        });
      }

      const limited = alerter.getAlertHistory(3);
      assert.equal(limited.length, 3);
    });

    test('caps history at 100 entries', async () => {
      // Create alerter with threshold 1 for fast alert generation
      const a = new Alerter({
        threshold: 1,
        cooldownMs: 0,
        fetch: mockFetch,
      });

      // Generate more than 100 alerts
      for (let i = 0; i < 110; i++) {
        await a.evaluate({
          [`check${i}`]: { status: 'unhealthy', error: 'Down' },
        });
      }

      assert.equal(a.alertHistory.length, 100);
    });

    test('most recent alerts come first', async () => {
      const a = new Alerter({
        threshold: 1,
        cooldownMs: 0,
        fetch: mockFetch,
      });

      await a.evaluate({ checkA: { status: 'unhealthy', error: 'Down' } });
      await a.evaluate({ checkB: { status: 'unhealthy', error: 'Down' } });

      const history = a.getAlertHistory(2);
      assert.equal(history[0].checkName, 'checkB');
      assert.equal(history[1].checkName, 'checkA');
    });
  });

  // --------------------------------------------------------------------------
  // getFailureCount
  // --------------------------------------------------------------------------

  describe('getFailureCount', () => {
    test('returns 0 for unknown check', () => {
      assert.equal(alerter.getFailureCount('unknown'), 0);
    });

    test('returns current failure count', async () => {
      await alerter.evaluate({
        db: { status: 'unhealthy', error: 'Down' },
      });
      assert.equal(alerter.getFailureCount('db'), 1);
    });
  });

  // --------------------------------------------------------------------------
  // reset
  // --------------------------------------------------------------------------

  describe('reset', () => {
    test('clears all tracking state', async () => {
      await alerter.evaluate({
        db: { status: 'unhealthy', error: 'Down' },
      });

      assert.equal(alerter.getFailureCount('db'), 1);

      alerter.reset();

      assert.equal(alerter.getFailureCount('db'), 0);
    });
  });

  // --------------------------------------------------------------------------
  // ALERT_SEVERITIES
  // --------------------------------------------------------------------------

  describe('ALERT_SEVERITIES', () => {
    test('exports frozen severity constants', () => {
      assert.equal(ALERT_SEVERITIES.WARNING, 'warning');
      assert.equal(ALERT_SEVERITIES.CRITICAL, 'critical');
      assert.equal(ALERT_SEVERITIES.RECOVERY, 'recovery');
      assert.ok(Object.isFrozen(ALERT_SEVERITIES));
    });
  });

  // --------------------------------------------------------------------------
  // AlerterError
  // --------------------------------------------------------------------------

  describe('AlerterError', () => {
    test('creates error with correct name and fields', () => {
      const cause = new Error('root cause');
      const err = new AlerterError('test error', {
        cause,
        operation: 'testOp',
        checkName: 'database',
      });
      assert.equal(err.name, 'AlerterError');
      assert.equal(err.message, 'test error');
      assert.equal(err.operation, 'testOp');
      assert.equal(err.checkName, 'database');
      assert.equal(err.cause, cause);
    });
  });
});
