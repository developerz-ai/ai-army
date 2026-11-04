/**
 * Unit tests for ConcurrencyController
 *
 * Tests the in-memory per-bot concurrency limiter including:
 * - Checking processing availability (canProcess)
 * - Starting and finishing processing
 * - Per-bot concurrency limits
 * - Active message tracking
 * - Reset and summary operations
 * - Input validation
 * - Memory cleanup (empty set removal)
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  ConcurrencyController,
  ConcurrencyControllerError,
} from '../../../src/queue/concurrency-controller.js';

describe('ConcurrencyController', () => {
  let controller;

  beforeEach(() => {
    controller = new ConcurrencyController();
  });

  describe('constructor', () => {
    test('creates instance with default settings', () => {
      const c = new ConcurrencyController();
      assert.ok(c);
      assert.equal(c.defaultMaxConcurrent, 3);
    });

    test('accepts custom default max concurrent', () => {
      const c = new ConcurrencyController({ defaultMaxConcurrent: 5 });
      assert.equal(c.defaultMaxConcurrent, 5);
    });

    test('accepts per-bot limits', () => {
      const c = new ConcurrencyController({
        botLimits: { 'work-bot': 1, 'fast-bot': 10 },
      });
      assert.equal(c.botLimits['work-bot'], 1);
      assert.equal(c.botLimits['fast-bot'], 10);
    });

    test('accepts optional logger', () => {
      const logger = mock.fn();
      const c = new ConcurrencyController({ logger });
      assert.ok(c);
    });

    test('starts with empty active map', () => {
      assert.equal(controller.active.size, 0);
    });
  });

  describe('canProcess()', () => {
    test('returns true when no messages are active', () => {
      assert.equal(controller.canProcess('test-bot'), true);
    });

    test('returns true when under limit', () => {
      controller.startProcessing('test-bot', 1);
      controller.startProcessing('test-bot', 2);
      assert.equal(controller.canProcess('test-bot'), true);
    });

    test('returns false when at limit', () => {
      controller.startProcessing('test-bot', 1);
      controller.startProcessing('test-bot', 2);
      controller.startProcessing('test-bot', 3);
      assert.equal(controller.canProcess('test-bot'), false);
    });

    test('respects per-bot limits', () => {
      const c = new ConcurrencyController({
        botLimits: { 'slow-bot': 1 },
      });

      c.startProcessing('slow-bot', 1);
      assert.equal(c.canProcess('slow-bot'), false);
    });

    test('uses default limit for unknown bots', () => {
      const c = new ConcurrencyController({
        defaultMaxConcurrent: 2,
        botLimits: { 'special-bot': 5 },
      });

      c.startProcessing('regular-bot', 1);
      c.startProcessing('regular-bot', 2);
      assert.equal(c.canProcess('regular-bot'), false);
    });

    test('different bots have independent limits', () => {
      controller.startProcessing('bot-a', 1);
      controller.startProcessing('bot-a', 2);
      controller.startProcessing('bot-a', 3);

      assert.equal(controller.canProcess('bot-a'), false);
      assert.equal(controller.canProcess('bot-b'), true);
    });

    test('throws on empty botId', () => {
      assert.throws(() => controller.canProcess(''), {
        name: 'ConcurrencyControllerError',
      });
    });

    test('throws on null botId', () => {
      assert.throws(() => controller.canProcess(null), {
        name: 'ConcurrencyControllerError',
      });
    });
  });

  describe('startProcessing()', () => {
    test('adds message to active set', () => {
      controller.startProcessing('test-bot', 1);
      assert.equal(controller.getActiveCount('test-bot'), 1);
    });

    test('tracks multiple messages for same bot', () => {
      controller.startProcessing('test-bot', 1);
      controller.startProcessing('test-bot', 2);
      controller.startProcessing('test-bot', 3);
      assert.equal(controller.getActiveCount('test-bot'), 3);
    });

    test('throws when bot is at concurrency limit', () => {
      controller.startProcessing('test-bot', 1);
      controller.startProcessing('test-bot', 2);
      controller.startProcessing('test-bot', 3);

      assert.throws(() => controller.startProcessing('test-bot', 4), {
        name: 'ConcurrencyControllerError',
        message: /concurrency limit/,
      });
    });

    test('throws with correct context on limit exceeded', () => {
      controller.startProcessing('test-bot', 1);
      controller.startProcessing('test-bot', 2);
      controller.startProcessing('test-bot', 3);

      try {
        controller.startProcessing('test-bot', 4);
        assert.fail('Should have thrown');
      } catch (err) {
        assert.equal(err.botId, 'test-bot');
        assert.equal(err.messageId, 4);
        assert.equal(err.operation, 'startProcessing');
      }
    });

    test('allows same message ID to be added again (idempotent via Set)', () => {
      controller.startProcessing('test-bot', 1);
      controller.startProcessing('test-bot', 1);
      // Set deduplicates, so count stays at 1
      assert.equal(controller.getActiveCount('test-bot'), 1);
    });

    test('throws on invalid messageId', () => {
      assert.throws(() => controller.startProcessing('test-bot', 0), {
        name: 'ConcurrencyControllerError',
      });
    });

    test('throws on non-integer messageId', () => {
      assert.throws(() => controller.startProcessing('test-bot', 'abc'), {
        name: 'ConcurrencyControllerError',
      });
    });

    test('throws on negative messageId', () => {
      assert.throws(() => controller.startProcessing('test-bot', -1), {
        name: 'ConcurrencyControllerError',
      });
    });

    test('throws on empty botId', () => {
      assert.throws(() => controller.startProcessing('', 1), {
        name: 'ConcurrencyControllerError',
      });
    });

    test('logs start event when logger is provided', () => {
      const logger = mock.fn();
      const c = new ConcurrencyController({ logger });

      c.startProcessing('test-bot', 1);

      assert.equal(logger.mock.callCount(), 1);
      assert.ok(logger.mock.calls[0].arguments[0].includes('[ConcurrencyController]'));
      assert.ok(logger.mock.calls[0].arguments[0].includes('Started processing'));
    });
  });

  describe('finishProcessing()', () => {
    test('removes message from active set', () => {
      controller.startProcessing('test-bot', 1);
      controller.startProcessing('test-bot', 2);

      const removed = controller.finishProcessing('test-bot', 1);

      assert.equal(removed, true);
      assert.equal(controller.getActiveCount('test-bot'), 1);
    });

    test('returns false for unknown bot', () => {
      const removed = controller.finishProcessing('unknown-bot', 1);
      assert.equal(removed, false);
    });

    test('returns false for unknown message', () => {
      controller.startProcessing('test-bot', 1);
      const removed = controller.finishProcessing('test-bot', 999);
      assert.equal(removed, false);
    });

    test('cleans up empty sets to prevent memory leaks', () => {
      controller.startProcessing('test-bot', 1);
      controller.finishProcessing('test-bot', 1);

      assert.equal(controller.active.has('test-bot'), false);
    });

    test('allows bot to process more messages after finishing', () => {
      // Fill to limit
      controller.startProcessing('test-bot', 1);
      controller.startProcessing('test-bot', 2);
      controller.startProcessing('test-bot', 3);
      assert.equal(controller.canProcess('test-bot'), false);

      // Finish one
      controller.finishProcessing('test-bot', 2);
      assert.equal(controller.canProcess('test-bot'), true);

      // Start another
      controller.startProcessing('test-bot', 4);
      assert.equal(controller.getActiveCount('test-bot'), 3);
    });

    test('throws on invalid messageId', () => {
      assert.throws(() => controller.finishProcessing('test-bot', 0), {
        name: 'ConcurrencyControllerError',
      });
    });

    test('throws on empty botId', () => {
      assert.throws(() => controller.finishProcessing('', 1), {
        name: 'ConcurrencyControllerError',
      });
    });

    test('logs finish event when logger is provided', () => {
      const logger = mock.fn();
      const c = new ConcurrencyController({ logger });

      c.startProcessing('test-bot', 1);
      c.finishProcessing('test-bot', 1);

      assert.equal(logger.mock.callCount(), 2);
      assert.ok(logger.mock.calls[1].arguments[0].includes('Finished processing'));
    });
  });

  describe('getActiveCount()', () => {
    test('returns 0 for unknown bot', () => {
      assert.equal(controller.getActiveCount('unknown'), 0);
    });

    test('returns correct count for active bot', () => {
      controller.startProcessing('test-bot', 1);
      controller.startProcessing('test-bot', 2);
      assert.equal(controller.getActiveCount('test-bot'), 2);
    });

    test('returns 0 after all messages finish', () => {
      controller.startProcessing('test-bot', 1);
      controller.finishProcessing('test-bot', 1);
      assert.equal(controller.getActiveCount('test-bot'), 0);
    });
  });

  describe('getActiveMessages()', () => {
    test('returns empty array for unknown bot', () => {
      assert.deepStrictEqual(controller.getActiveMessages('unknown'), []);
    });

    test('returns array of active message IDs', () => {
      controller.startProcessing('test-bot', 10);
      controller.startProcessing('test-bot', 20);
      controller.startProcessing('test-bot', 30);

      const messages = controller.getActiveMessages('test-bot');
      assert.equal(messages.length, 3);
      assert.ok(messages.includes(10));
      assert.ok(messages.includes(20));
      assert.ok(messages.includes(30));
    });

    test('returns a copy, not the original set', () => {
      controller.startProcessing('test-bot', 1);
      const messages = controller.getActiveMessages('test-bot');
      messages.push(999);
      assert.equal(controller.getActiveCount('test-bot'), 1);
    });
  });

  describe('setBotLimit()', () => {
    test('sets custom limit for a bot', () => {
      controller.setBotLimit('special-bot', 10);

      // Fill to default (3) - should still allow more
      controller.startProcessing('special-bot', 1);
      controller.startProcessing('special-bot', 2);
      controller.startProcessing('special-bot', 3);
      controller.startProcessing('special-bot', 4);
      assert.equal(controller.canProcess('special-bot'), true);
    });

    test('overrides existing bot limit', () => {
      controller.setBotLimit('test-bot', 5);
      controller.setBotLimit('test-bot', 1);

      controller.startProcessing('test-bot', 1);
      assert.equal(controller.canProcess('test-bot'), false);
    });

    test('throws on non-positive maxConcurrent', () => {
      assert.throws(() => controller.setBotLimit('test-bot', 0), {
        name: 'ConcurrencyControllerError',
      });
    });

    test('throws on non-integer maxConcurrent', () => {
      assert.throws(() => controller.setBotLimit('test-bot', 2.5), {
        name: 'ConcurrencyControllerError',
      });
    });

    test('throws on empty botId', () => {
      assert.throws(() => controller.setBotLimit('', 5), {
        name: 'ConcurrencyControllerError',
      });
    });
  });

  describe('reset()', () => {
    test('clears all active state', () => {
      controller.startProcessing('bot-a', 1);
      controller.startProcessing('bot-a', 2);
      controller.startProcessing('bot-b', 1);

      controller.reset();

      assert.equal(controller.getActiveCount('bot-a'), 0);
      assert.equal(controller.getActiveCount('bot-b'), 0);
      assert.equal(controller.active.size, 0);
    });

    test('preserves bot limits after reset', () => {
      controller.setBotLimit('test-bot', 1);
      controller.startProcessing('test-bot', 1);

      controller.reset();

      controller.startProcessing('test-bot', 2);
      assert.equal(controller.canProcess('test-bot'), false);
    });
  });

  describe('getSummary()', () => {
    test('returns empty summary when no bots are active', () => {
      const summary = controller.getSummary();
      assert.deepStrictEqual(summary, { bots: {}, total: 0 });
    });

    test('returns per-bot summary with active counts', () => {
      controller.startProcessing('bot-a', 1);
      controller.startProcessing('bot-a', 2);
      controller.startProcessing('bot-b', 10);

      const summary = controller.getSummary();

      assert.equal(summary.total, 3);
      assert.equal(summary.bots['bot-a'].active, 2);
      assert.equal(summary.bots['bot-a'].maxConcurrent, 3);
      assert.deepStrictEqual(summary.bots['bot-a'].messageIds.sort(), [1, 2]);
      assert.equal(summary.bots['bot-b'].active, 1);
      assert.deepStrictEqual(summary.bots['bot-b'].messageIds, [10]);
    });

    test('reflects per-bot limits in summary', () => {
      const c = new ConcurrencyController({
        botLimits: { 'special-bot': 10 },
      });

      c.startProcessing('special-bot', 1);
      const summary = c.getSummary();

      assert.equal(summary.bots['special-bot'].maxConcurrent, 10);
    });
  });

  describe('ConcurrencyControllerError', () => {
    test('has correct name and message', () => {
      const err = new ConcurrencyControllerError('test error');
      assert.equal(err.name, 'ConcurrencyControllerError');
      assert.equal(err.message, 'test error');
    });

    test('preserves cause chain', () => {
      const cause = new Error('original');
      const err = new ConcurrencyControllerError('wrapped', { cause });
      assert.equal(err.cause, cause);
    });

    test('includes operation and context fields', () => {
      const err = new ConcurrencyControllerError('test', {
        operation: 'startProcessing',
        botId: 'test-bot',
        messageId: 42,
      });

      assert.equal(err.operation, 'startProcessing');
      assert.equal(err.botId, 'test-bot');
      assert.equal(err.messageId, 42);
    });
  });
});
