/**
 * Unit tests for ChannelHealthMonitor
 *
 * Tests health checking, auto-reconnect, periodic checks, and health metrics.
 */

import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  ChannelHealthMonitor,
  ChannelHealthMonitorError,
  HEALTH_STATUSES,
} from '../../../src/core/channel-health-monitor.js';

/**
 * Create a mock ChannelManager for testing
 * @param {Map} [channelMap] - Pre-populated channels map
 * @returns {Object} Mock ChannelManager
 */
function createMockChannelManager(channelMap = new Map()) {
  return {
    getChannel: mock.fn(name => channelMap.get(name)),
    listChannels: mock.fn(() => Array.from(channelMap.values())),
    stopChannel: mock.fn(async () => {}),
    initializeChannel: mock.fn(async (name, config) => ({
      name,
      config,
      adapter: {},
      status: 'ready',
      createdAt: new Date(),
    })),
  };
}

/**
 * Create a mock channel entry for testing
 * @param {Object} [overrides={}] - Override defaults
 * @returns {Object} Mock channel entry
 */
function createMockChannel(overrides = {}) {
  return {
    name: overrides.name || 'slack-main',
    config: overrides.config || { type: 'slack', botToken: 'xoxb-test' },
    adapter: overrides.adapter || {
      isHealthy: mock.fn(async () => true),
      stop: mock.fn(async () => {}),
    },
    status: overrides.status || 'ready',
    createdAt: new Date(),
  };
}

describe('ChannelHealthMonitor', () => {
  let monitor;
  let channelManager;
  let channelMap;

  beforeEach(() => {
    channelMap = new Map();
    channelManager = createMockChannelManager(channelMap);
    monitor = new ChannelHealthMonitor(channelManager);
  });

  afterEach(() => {
    monitor.stopPeriodicChecks();
  });

  // ========================================================================
  // Constructor
  // ========================================================================

  describe('constructor', () => {
    test('creates instance with ChannelManager', () => {
      assert.ok(monitor);
      assert.equal(monitor.channelManager, channelManager);
    });

    test('sets default checkIntervalMs', () => {
      assert.equal(monitor.checkIntervalMs, 30000);
    });

    test('sets default maxRetries', () => {
      assert.equal(monitor.maxRetries, 3);
    });

    test('accepts custom options', () => {
      const logger = mock.fn();
      const m = new ChannelHealthMonitor(channelManager, {
        checkIntervalMs: 5000,
        maxRetries: 5,
        logger,
      });
      assert.equal(m.checkIntervalMs, 5000);
      assert.equal(m.maxRetries, 5);
      assert.equal(m.logger, logger);
    });

    test('defaults logger to null', () => {
      assert.equal(monitor.logger, null);
    });

    test('initializes empty healthState map', () => {
      assert.ok(monitor.healthState instanceof Map);
      assert.equal(monitor.healthState.size, 0);
    });

    test('throws ChannelHealthMonitorError when channelManager is missing', () => {
      assert.throws(
        () => new ChannelHealthMonitor(),
        err => {
          assert.equal(err.name, 'ChannelHealthMonitorError');
          assert.match(err.message, /ChannelManager is required/);
          assert.equal(err.operation, 'constructor');
          return true;
        }
      );
    });

    test('throws ChannelHealthMonitorError when channelManager is null', () => {
      assert.throws(
        () => new ChannelHealthMonitor(null),
        err => {
          assert.equal(err.name, 'ChannelHealthMonitorError');
          assert.match(err.message, /ChannelManager is required/);
          return true;
        }
      );
    });
  });

  // ========================================================================
  // checkHealth()
  // ========================================================================

  describe('checkHealth()', () => {
    test('returns healthy for channel with isHealthy() returning true', async () => {
      const channel = createMockChannel();
      channelMap.set('slack-main', channel);

      const result = await monitor.checkHealth('slack-main');

      assert.equal(result.status, HEALTH_STATUSES.HEALTHY);
      assert.equal(typeof result.latencyMs, 'number');
      assert.equal(result.error, null);
    });

    test('returns unhealthy for channel with isHealthy() returning false', async () => {
      const channel = createMockChannel({
        adapter: {
          isHealthy: mock.fn(async () => false),
        },
      });
      channelMap.set('slack-main', channel);

      const result = await monitor.checkHealth('slack-main');

      assert.equal(result.status, HEALTH_STATUSES.UNHEALTHY);
    });

    test('uses ping() as fallback when isHealthy() is not available', async () => {
      const pingFn = mock.fn(async () => {});
      const channel = createMockChannel({
        adapter: { ping: pingFn },
      });
      channelMap.set('slack-main', channel);

      const result = await monitor.checkHealth('slack-main');

      assert.equal(result.status, HEALTH_STATUSES.HEALTHY);
      assert.equal(pingFn.mock.calls.length, 1);
    });

    test('falls back to status check when no health methods available', async () => {
      const channel = createMockChannel({
        adapter: {},
        status: 'ready',
      });
      channelMap.set('slack-main', channel);

      const result = await monitor.checkHealth('slack-main');

      assert.equal(result.status, HEALTH_STATUSES.HEALTHY);
    });

    test('returns unhealthy when adapter is null', async () => {
      const channel = createMockChannel({ status: 'error' });
      channel.adapter = null;
      channelMap.set('slack-main', channel);

      const result = await monitor.checkHealth('slack-main');

      assert.equal(result.status, HEALTH_STATUSES.UNHEALTHY);
    });

    test('returns unknown when channel is not found', async () => {
      const result = await monitor.checkHealth('nonexistent');

      assert.equal(result.status, HEALTH_STATUSES.UNKNOWN);
      assert.match(result.error, /not found/);
    });

    test('returns unhealthy when isHealthy() throws', async () => {
      const channel = createMockChannel({
        adapter: {
          isHealthy: mock.fn(async () => {
            throw new Error('Connection refused');
          }),
        },
      });
      channelMap.set('slack-main', channel);

      const result = await monitor.checkHealth('slack-main');

      assert.equal(result.status, HEALTH_STATUSES.UNHEALTHY);
      assert.match(result.error, /Connection refused/);
    });

    test('increments consecutiveFailures on unhealthy check', async () => {
      const channel = createMockChannel({
        adapter: {
          isHealthy: mock.fn(async () => false),
        },
      });
      channelMap.set('slack-main', channel);

      await monitor.checkHealth('slack-main');
      await monitor.checkHealth('slack-main');

      const state = monitor.healthState.get('slack-main');
      assert.equal(state.consecutiveFailures, 2);
    });

    test('resets consecutiveFailures on healthy check', async () => {
      const channel = createMockChannel({
        adapter: {
          isHealthy: mock.fn(async () => false),
        },
      });
      channelMap.set('slack-main', channel);

      // Fail twice
      await monitor.checkHealth('slack-main');
      await monitor.checkHealth('slack-main');

      // Now succeed
      channel.adapter.isHealthy = mock.fn(async () => true);
      await monitor.checkHealth('slack-main');

      const state = monitor.healthState.get('slack-main');
      assert.equal(state.consecutiveFailures, 0);
    });

    test('updates lastCheckAt on each check', async () => {
      const channel = createMockChannel();
      channelMap.set('slack-main', channel);

      await monitor.checkHealth('slack-main');

      const state = monitor.healthState.get('slack-main');
      assert.ok(state.lastCheckAt);
    });

    test('throws when name is empty', async () => {
      await assert.rejects(
        () => monitor.checkHealth(''),
        err => {
          assert.equal(err.name, 'ChannelHealthMonitorError');
          assert.match(err.message, /Channel name must be a non-empty string/);
          assert.equal(err.operation, 'checkHealth');
          return true;
        }
      );
    });

    test('throws when name is null', async () => {
      await assert.rejects(
        () => monitor.checkHealth(null),
        err => {
          assert.equal(err.name, 'ChannelHealthMonitorError');
          return true;
        }
      );
    });
  });

  // ========================================================================
  // reconnectOnFailure()
  // ========================================================================

  describe('reconnectOnFailure()', () => {
    test('successfully reconnects a channel', async () => {
      const channel = createMockChannel();
      channelMap.set('slack-main', channel);

      const result = await monitor.reconnectOnFailure('slack-main');

      assert.equal(result.success, true);
      assert.equal(result.channelName, 'slack-main');
      assert.equal(channelManager.stopChannel.mock.calls.length, 1);
      assert.equal(channelManager.initializeChannel.mock.calls.length, 1);
    });

    test('skips reconnect when max retries exceeded', async () => {
      const channel = createMockChannel({
        adapter: {
          isHealthy: mock.fn(async () => false),
        },
      });
      channelMap.set('slack-main', channel);

      // Simulate consecutive failures up to maxRetries
      monitor.maxRetries = 2;
      monitor.healthState.set('slack-main', {
        status: HEALTH_STATUSES.UNHEALTHY,
        consecutiveFailures: 2,
        lastCheckAt: new Date().toISOString(),
      });

      const result = await monitor.reconnectOnFailure('slack-main');

      assert.equal(result.success, false);
      assert.match(result.reason, /Exceeded max retries/);
      assert.equal(channelManager.stopChannel.mock.calls.length, 0);
    });

    test('returns failure when channel not found', async () => {
      const result = await monitor.reconnectOnFailure('nonexistent');

      assert.equal(result.success, false);
      assert.match(result.reason, /not found/);
    });

    test('returns failure when reconnect throws', async () => {
      const channel = createMockChannel();
      channelMap.set('slack-main', channel);

      channelManager.stopChannel = mock.fn(async () => {
        throw new Error('Stop failed');
      });

      const result = await monitor.reconnectOnFailure('slack-main');

      assert.equal(result.success, false);
      assert.match(result.reason, /Stop failed/);
    });

    test('resets consecutiveFailures on successful reconnect', async () => {
      const channel = createMockChannel();
      channelMap.set('slack-main', channel);

      monitor.healthState.set('slack-main', {
        status: HEALTH_STATUSES.UNHEALTHY,
        consecutiveFailures: 1,
        lastCheckAt: new Date().toISOString(),
      });

      await monitor.reconnectOnFailure('slack-main');

      const state = monitor.healthState.get('slack-main');
      assert.equal(state.consecutiveFailures, 0);
      assert.equal(state.status, HEALTH_STATUSES.HEALTHY);
    });

    test('sets status to reconnecting during attempt', async () => {
      let capturedStatus = null;
      const channel = createMockChannel();
      channelMap.set('slack-main', channel);

      channelManager.stopChannel = mock.fn(async () => {
        capturedStatus = monitor.healthState.get('slack-main').status;
      });

      await monitor.reconnectOnFailure('slack-main');

      assert.equal(capturedStatus, HEALTH_STATUSES.RECONNECTING);
    });

    test('throws when name is empty', async () => {
      await assert.rejects(
        () => monitor.reconnectOnFailure(''),
        err => {
          assert.equal(err.name, 'ChannelHealthMonitorError');
          assert.equal(err.operation, 'reconnectOnFailure');
          return true;
        }
      );
    });
  });

  // ========================================================================
  // getHealthMetrics()
  // ========================================================================

  describe('getHealthMetrics()', () => {
    test('returns empty metrics when no channels monitored', () => {
      const metrics = monitor.getHealthMetrics();

      assert.deepEqual(metrics.channels, {});
      assert.equal(metrics.summary.total, 0);
      assert.equal(metrics.summary.healthy, 0);
      assert.equal(metrics.summary.unhealthy, 0);
      assert.equal(metrics.summary.unknown, 0);
    });

    test('returns metrics for monitored channels', async () => {
      const channel = createMockChannel();
      channelMap.set('slack-main', channel);

      await monitor.checkHealth('slack-main');

      const metrics = monitor.getHealthMetrics();

      assert.ok(metrics.channels['slack-main']);
      assert.equal(metrics.summary.total, 1);
      assert.equal(metrics.summary.healthy, 1);
    });

    test('correctly counts healthy and unhealthy channels', async () => {
      const healthyChannel = createMockChannel({ name: 'slack-main' });
      const unhealthyChannel = createMockChannel({
        name: 'discord-main',
        adapter: { isHealthy: mock.fn(async () => false) },
      });

      channelMap.set('slack-main', healthyChannel);
      channelMap.set('discord-main', unhealthyChannel);

      await monitor.checkHealth('slack-main');
      await monitor.checkHealth('discord-main');

      const metrics = monitor.getHealthMetrics();

      assert.equal(metrics.summary.total, 2);
      assert.equal(metrics.summary.healthy, 1);
      assert.equal(metrics.summary.unhealthy, 1);
    });

    test('returns copies of state, not references', () => {
      monitor.healthState.set('test', {
        status: HEALTH_STATUSES.HEALTHY,
        consecutiveFailures: 0,
        lastCheckAt: new Date().toISOString(),
      });

      const metrics = monitor.getHealthMetrics();
      metrics.channels.test.status = 'modified';

      const state = monitor.healthState.get('test');
      assert.equal(state.status, HEALTH_STATUSES.HEALTHY);
    });
  });

  // ========================================================================
  // startPeriodicChecks() / stopPeriodicChecks()
  // ========================================================================

  describe('startPeriodicChecks()', () => {
    test('starts the interval', () => {
      monitor.startPeriodicChecks();
      assert.equal(monitor.isRunning(), true);
    });

    test('is idempotent - calling twice does not create second interval', () => {
      monitor.startPeriodicChecks();
      const firstHandle = monitor._intervalHandle;
      monitor.startPeriodicChecks();
      assert.equal(monitor._intervalHandle, firstHandle);
    });
  });

  describe('stopPeriodicChecks()', () => {
    test('stops the interval', () => {
      monitor.startPeriodicChecks();
      assert.equal(monitor.isRunning(), true);

      monitor.stopPeriodicChecks();
      assert.equal(monitor.isRunning(), false);
    });

    test('is safe to call when not running', () => {
      assert.doesNotThrow(() => monitor.stopPeriodicChecks());
    });
  });

  describe('isRunning()', () => {
    test('returns false initially', () => {
      assert.equal(monitor.isRunning(), false);
    });

    test('returns true after starting', () => {
      monitor.startPeriodicChecks();
      assert.equal(monitor.isRunning(), true);
    });

    test('returns false after stopping', () => {
      monitor.startPeriodicChecks();
      monitor.stopPeriodicChecks();
      assert.equal(monitor.isRunning(), false);
    });
  });
});

// ==========================================================================
// ChannelHealthMonitorError
// ==========================================================================

describe('ChannelHealthMonitorError', () => {
  test('is an instance of Error', () => {
    const error = new ChannelHealthMonitorError('Test error');
    assert.ok(error instanceof Error);
  });

  test('has correct name', () => {
    const error = new ChannelHealthMonitorError('Test error');
    assert.equal(error.name, 'ChannelHealthMonitorError');
  });

  test('stores message', () => {
    const error = new ChannelHealthMonitorError('Something went wrong');
    assert.equal(error.message, 'Something went wrong');
  });

  test('stores operation', () => {
    const error = new ChannelHealthMonitorError('Test error', { operation: 'checkHealth' });
    assert.equal(error.operation, 'checkHealth');
  });

  test('stores channelName', () => {
    const error = new ChannelHealthMonitorError('Test error', { channelName: 'slack-main' });
    assert.equal(error.channelName, 'slack-main');
  });

  test('stores cause', () => {
    const cause = new Error('Original error');
    const error = new ChannelHealthMonitorError('Test error', { cause });
    assert.equal(error.cause, cause);
  });

  test('defaults optional fields to undefined', () => {
    const error = new ChannelHealthMonitorError('Test error');
    assert.equal(error.operation, undefined);
    assert.equal(error.channelName, undefined);
    assert.equal(error.cause, undefined);
  });
});

// ==========================================================================
// HEALTH_STATUSES
// ==========================================================================

describe('HEALTH_STATUSES', () => {
  test('exports all expected status values', () => {
    assert.equal(HEALTH_STATUSES.HEALTHY, 'healthy');
    assert.equal(HEALTH_STATUSES.UNHEALTHY, 'unhealthy');
    assert.equal(HEALTH_STATUSES.RECONNECTING, 'reconnecting');
    assert.equal(HEALTH_STATUSES.UNKNOWN, 'unknown');
  });

  test('is frozen', () => {
    assert.ok(Object.isFrozen(HEALTH_STATUSES));
  });
});
