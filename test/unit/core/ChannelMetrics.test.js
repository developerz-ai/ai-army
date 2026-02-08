/**
 * Unit tests for ChannelMetrics
 *
 * Tests per-channel message tracking, error recording, response time
 * averaging, and aggregated stats.
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ChannelMetrics, ChannelMetricsError } from '../../../src/core/channel-metrics.js';

describe('ChannelMetrics', () => {
  let metrics;

  beforeEach(() => {
    metrics = new ChannelMetrics();
  });

  // ========================================================================
  // Constructor
  // ========================================================================

  describe('constructor', () => {
    test('creates instance with empty metrics map', () => {
      assert.ok(metrics);
      assert.ok(metrics.metrics instanceof Map);
      assert.equal(metrics.metrics.size, 0);
    });

    test('accepts logger option', () => {
      const logger = mock.fn();
      const m = new ChannelMetrics({ logger });
      assert.equal(m.logger, logger);
    });

    test('defaults logger to null', () => {
      assert.equal(metrics.logger, null);
    });
  });

  // ========================================================================
  // recordMessageIn()
  // ========================================================================

  describe('recordMessageIn()', () => {
    test('increments messagesIn count', () => {
      metrics.recordMessageIn('slack-main');
      metrics.recordMessageIn('slack-main');

      const stats = metrics.getChannelStats('slack-main');
      assert.equal(stats.messagesIn, 2);
    });

    test('creates entry if channel not tracked yet', () => {
      metrics.recordMessageIn('slack-main');
      assert.equal(metrics.getTrackedChannelCount(), 1);
    });

    test('updates lastMessageAt', () => {
      metrics.recordMessageIn('slack-main');
      const stats = metrics.getChannelStats('slack-main');
      assert.ok(stats.lastMessageAt);
    });

    test('throws when channelName is empty', () => {
      assert.throws(
        () => metrics.recordMessageIn(''),
        err => {
          assert.equal(err.name, 'ChannelMetricsError');
          assert.match(err.message, /Channel name must be a non-empty string/);
          assert.equal(err.operation, 'recordMessageIn');
          return true;
        }
      );
    });

    test('throws when channelName is null', () => {
      assert.throws(
        () => metrics.recordMessageIn(null),
        err => {
          assert.equal(err.name, 'ChannelMetricsError');
          return true;
        }
      );
    });
  });

  // ========================================================================
  // recordMessageOut()
  // ========================================================================

  describe('recordMessageOut()', () => {
    test('increments messagesOut count', () => {
      metrics.recordMessageOut('slack-main');
      metrics.recordMessageOut('slack-main');

      const stats = metrics.getChannelStats('slack-main');
      assert.equal(stats.messagesOut, 2);
    });

    test('tracks response time when provided', () => {
      metrics.recordMessageOut('slack-main', 100);
      metrics.recordMessageOut('slack-main', 200);

      const stats = metrics.getChannelStats('slack-main');
      assert.equal(stats.avgResponseTimeMs, 150);
    });

    test('ignores response time when not a number', () => {
      metrics.recordMessageOut('slack-main', 'not-a-number');

      const stats = metrics.getChannelStats('slack-main');
      assert.equal(stats.avgResponseTimeMs, 0);
    });

    test('ignores negative response time', () => {
      metrics.recordMessageOut('slack-main', -100);

      const stats = metrics.getChannelStats('slack-main');
      assert.equal(stats.avgResponseTimeMs, 0);
    });

    test('tracks response time of zero', () => {
      metrics.recordMessageOut('slack-main', 0);

      const stats = metrics.getChannelStats('slack-main');
      assert.equal(stats.avgResponseTimeMs, 0);
      assert.equal(stats.messagesOut, 1);
    });

    test('updates lastMessageAt', () => {
      metrics.recordMessageOut('slack-main');
      const stats = metrics.getChannelStats('slack-main');
      assert.ok(stats.lastMessageAt);
    });

    test('throws when channelName is empty', () => {
      assert.throws(
        () => metrics.recordMessageOut(''),
        err => {
          assert.equal(err.name, 'ChannelMetricsError');
          assert.equal(err.operation, 'recordMessageOut');
          return true;
        }
      );
    });
  });

  // ========================================================================
  // recordError()
  // ========================================================================

  describe('recordError()', () => {
    test('increments error count', () => {
      metrics.recordError('slack-main');
      metrics.recordError('slack-main');

      const stats = metrics.getChannelStats('slack-main');
      assert.equal(stats.errors, 2);
    });

    test('updates lastErrorAt', () => {
      metrics.recordError('slack-main');
      const stats = metrics.getChannelStats('slack-main');
      assert.ok(stats.lastErrorAt);
    });

    test('creates entry if channel not tracked yet', () => {
      metrics.recordError('slack-main');
      assert.equal(metrics.getTrackedChannelCount(), 1);
    });

    test('throws when channelName is empty', () => {
      assert.throws(
        () => metrics.recordError(''),
        err => {
          assert.equal(err.name, 'ChannelMetricsError');
          assert.equal(err.operation, 'recordError');
          return true;
        }
      );
    });
  });

  // ========================================================================
  // getChannelStats()
  // ========================================================================

  describe('getChannelStats()', () => {
    test('returns null for untracked channel', () => {
      const stats = metrics.getChannelStats('nonexistent');
      assert.equal(stats, null);
    });

    test('returns full stats for tracked channel', () => {
      metrics.recordMessageIn('slack-main');
      metrics.recordMessageOut('slack-main', 100);
      metrics.recordError('slack-main');

      const stats = metrics.getChannelStats('slack-main');

      assert.equal(stats.channelName, 'slack-main');
      assert.equal(stats.messagesIn, 1);
      assert.equal(stats.messagesOut, 1);
      assert.equal(stats.errors, 1);
      assert.equal(stats.avgResponseTimeMs, 100);
      assert.ok(stats.createdAt);
    });

    test('computes average response time correctly', () => {
      metrics.recordMessageOut('slack-main', 100);
      metrics.recordMessageOut('slack-main', 200);
      metrics.recordMessageOut('slack-main', 300);

      const stats = metrics.getChannelStats('slack-main');
      assert.equal(stats.avgResponseTimeMs, 200);
    });

    test('returns 0 for avgResponseTimeMs when no responses tracked', () => {
      metrics.recordMessageIn('slack-main');

      const stats = metrics.getChannelStats('slack-main');
      assert.equal(stats.avgResponseTimeMs, 0);
    });

    test('computes error rate correctly', () => {
      metrics.recordMessageIn('slack-main');
      metrics.recordMessageOut('slack-main');
      metrics.recordError('slack-main');

      const stats = metrics.getChannelStats('slack-main');
      // 1 error / 2 total messages = 0.5
      assert.equal(stats.errorRate, 0.5);
    });

    test('returns 0 error rate when no messages', () => {
      metrics.recordError('slack-main');

      const stats = metrics.getChannelStats('slack-main');
      // Only errors, no in/out messages → errorRate denominator includes only in+out
      // 1 error / 0 total messages = 0
      assert.equal(stats.errorRate, 0);
    });

    test('throws when channelName is empty', () => {
      assert.throws(
        () => metrics.getChannelStats(''),
        err => {
          assert.equal(err.name, 'ChannelMetricsError');
          assert.equal(err.operation, 'getChannelStats');
          return true;
        }
      );
    });
  });

  // ========================================================================
  // getAllStats()
  // ========================================================================

  describe('getAllStats()', () => {
    test('returns empty results when no channels tracked', () => {
      const stats = metrics.getAllStats();

      assert.deepEqual(stats.channels, {});
      assert.equal(stats.summary.totalChannels, 0);
      assert.equal(stats.summary.totalMessagesIn, 0);
      assert.equal(stats.summary.totalMessagesOut, 0);
      assert.equal(stats.summary.totalErrors, 0);
    });

    test('returns aggregated stats for all channels', () => {
      metrics.recordMessageIn('slack-main');
      metrics.recordMessageOut('slack-main');
      metrics.recordMessageIn('discord-main');
      metrics.recordError('discord-main');

      const stats = metrics.getAllStats();

      assert.equal(stats.summary.totalChannels, 2);
      assert.equal(stats.summary.totalMessagesIn, 2);
      assert.equal(stats.summary.totalMessagesOut, 1);
      assert.equal(stats.summary.totalErrors, 1);
      assert.ok(stats.channels['slack-main']);
      assert.ok(stats.channels['discord-main']);
    });
  });

  // ========================================================================
  // resetChannel() / resetAll()
  // ========================================================================

  describe('resetChannel()', () => {
    test('removes metrics for specified channel', () => {
      metrics.recordMessageIn('slack-main');
      metrics.recordMessageIn('discord-main');

      metrics.resetChannel('slack-main');

      assert.equal(metrics.getChannelStats('slack-main'), null);
      assert.ok(metrics.getChannelStats('discord-main'));
    });

    test('is safe when channel not tracked', () => {
      assert.doesNotThrow(() => metrics.resetChannel('nonexistent'));
    });

    test('throws when channelName is empty', () => {
      assert.throws(
        () => metrics.resetChannel(''),
        err => {
          assert.equal(err.name, 'ChannelMetricsError');
          assert.equal(err.operation, 'resetChannel');
          return true;
        }
      );
    });
  });

  describe('resetAll()', () => {
    test('clears all channel metrics', () => {
      metrics.recordMessageIn('slack-main');
      metrics.recordMessageIn('discord-main');

      metrics.resetAll();

      assert.equal(metrics.getTrackedChannelCount(), 0);
    });
  });

  // ========================================================================
  // getTrackedChannelCount()
  // ========================================================================

  describe('getTrackedChannelCount()', () => {
    test('returns 0 when no channels tracked', () => {
      assert.equal(metrics.getTrackedChannelCount(), 0);
    });

    test('returns correct count', () => {
      metrics.recordMessageIn('slack-main');
      metrics.recordMessageIn('discord-main');

      assert.equal(metrics.getTrackedChannelCount(), 2);
    });
  });
});

// ==========================================================================
// ChannelMetricsError
// ==========================================================================

describe('ChannelMetricsError', () => {
  test('is an instance of Error', () => {
    const error = new ChannelMetricsError('Test error');
    assert.ok(error instanceof Error);
  });

  test('has correct name', () => {
    const error = new ChannelMetricsError('Test error');
    assert.equal(error.name, 'ChannelMetricsError');
  });

  test('stores message', () => {
    const error = new ChannelMetricsError('Something went wrong');
    assert.equal(error.message, 'Something went wrong');
  });

  test('stores operation', () => {
    const error = new ChannelMetricsError('Test error', { operation: 'recordMessageIn' });
    assert.equal(error.operation, 'recordMessageIn');
  });

  test('stores channelName', () => {
    const error = new ChannelMetricsError('Test error', { channelName: 'slack-main' });
    assert.equal(error.channelName, 'slack-main');
  });

  test('stores cause', () => {
    const cause = new Error('Original error');
    const error = new ChannelMetricsError('Test error', { cause });
    assert.equal(error.cause, cause);
  });

  test('defaults optional fields to undefined', () => {
    const error = new ChannelMetricsError('Test error');
    assert.equal(error.operation, undefined);
    assert.equal(error.channelName, undefined);
    assert.equal(error.cause, undefined);
  });
});
