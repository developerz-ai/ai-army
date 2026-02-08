/**
 * Unit tests for WebhookManager
 *
 * Tests webhook subscription management, event-to-webhook matching,
 * delivery enqueuing, retry, history retrieval, and EventEmitter integration.
 *
 * All database interactions are mocked.
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  WebhookManager,
  WebhookManagerError,
  WEBHOOK_STATUSES,
} from '../../../src/webhooks/webhook-manager.js';
import { BotEventEmitter } from '../../../src/core/event-emitter.js';

// ─── Mock Factories ──────────────────────────────────────────────

/**
 * Create a mock storage object for testing
 * @param {Object} [overrides={}] - Override default mock implementations
 * @returns {Object} Mock storage object
 */
function createMockStorage(overrides = {}) {
  return {
    query: mock.fn(async () => ({ rows: [], rowCount: 0 })),
    transaction: mock.fn(async callback => {
      const mockClient = {
        query: mock.fn(async () => ({ rows: [], rowCount: 0 })),
      };
      return callback(mockClient);
    }),
    ...overrides,
  };
}

/**
 * Create a mock webhook database row
 * @param {Object} [overrides={}] - Override default values
 * @returns {Object} Mock database row
 */
function createMockWebhookRow(overrides = {}) {
  return {
    id: 1,
    bot_id: 'test-bot',
    event: 'message.sent',
    url: 'https://api.example.com/webhook',
    method: 'POST',
    headers: {},
    payload: { event: 'message.sent', bot: { id: 'test-bot' } },
    status: 'pending',
    attempts: 0,
    max_attempts: 3,
    last_attempt_at: null,
    response_code: null,
    response_body: null,
    error: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('WEBHOOK_STATUSES', () => {
  test('has all expected statuses', () => {
    assert.equal(WEBHOOK_STATUSES.PENDING, 'pending');
    assert.equal(WEBHOOK_STATUSES.SENDING, 'sending');
    assert.equal(WEBHOOK_STATUSES.SUCCESS, 'success');
    assert.equal(WEBHOOK_STATUSES.FAILED, 'failed');
  });

  test('is frozen', () => {
    assert.ok(Object.isFrozen(WEBHOOK_STATUSES));
  });
});

describe('WebhookManager', () => {
  let manager;
  let mockStorage;

  beforeEach(() => {
    mockStorage = createMockStorage();
    manager = new WebhookManager(mockStorage);
  });

  describe('constructor', () => {
    test('creates instance with storage', () => {
      const m = new WebhookManager(mockStorage);
      assert.ok(m);
    });

    test('throws when storage is missing', () => {
      assert.throws(() => new WebhookManager(null), {
        name: 'WebhookManagerError',
      });
    });

    test('accepts optional logger', () => {
      const logger = mock.fn();
      const m = new WebhookManager(mockStorage, { logger });
      assert.ok(m);
    });

    test('accepts optional eventEmitter', () => {
      const emitter = new BotEventEmitter();
      const m = new WebhookManager(mockStorage, { eventEmitter: emitter });
      assert.ok(m);
    });
  });

  describe('configure()', () => {
    test('stores webhook configuration for a bot', () => {
      manager.configure('test-bot', [
        { url: 'https://example.com/hook', events: ['message.sent'] },
      ]);

      const configs = manager.getConfig('test-bot');
      assert.equal(configs.length, 1);
      assert.equal(configs[0].url, 'https://example.com/hook');
      assert.deepEqual(configs[0].events, ['message.sent']);
    });

    test('applies defaults to config entries', () => {
      manager.configure('test-bot', [
        { url: 'https://example.com/hook', events: ['message.sent'] },
      ]);

      const configs = manager.getConfig('test-bot');
      assert.equal(configs[0].method, 'POST');
      assert.deepEqual(configs[0].headers, {});
      assert.equal(configs[0].retries, 3);
      assert.equal(configs[0].timeout, 5000);
    });

    test('replaces existing configuration', () => {
      manager.configure('test-bot', [{ url: 'https://example.com/old', events: ['bot.started'] }]);
      manager.configure('test-bot', [{ url: 'https://example.com/new', events: ['message.sent'] }]);

      const configs = manager.getConfig('test-bot');
      assert.equal(configs.length, 1);
      assert.equal(configs[0].url, 'https://example.com/new');
    });

    test('supports multiple subscriptions per bot', () => {
      manager.configure('test-bot', [
        { url: 'https://example.com/a', events: ['message.sent'] },
        { url: 'https://example.com/b', events: ['bot.error'] },
      ]);

      const configs = manager.getConfig('test-bot');
      assert.equal(configs.length, 2);
    });

    test('throws on invalid botId', () => {
      assert.throws(() => manager.configure('', []), { name: 'WebhookManagerError' });
    });

    test('throws when webhookConfigs is not an array', () => {
      assert.throws(() => manager.configure('test-bot', 'not-array'), {
        name: 'WebhookManagerError',
      });
    });
  });

  describe('getConfig()', () => {
    test('returns empty array for unconfigured bot', () => {
      const configs = manager.getConfig('unknown-bot');
      assert.deepEqual(configs, []);
    });
  });

  describe('removeConfig()', () => {
    test('removes webhook configuration for a bot', () => {
      manager.configure('test-bot', [
        { url: 'https://example.com/hook', events: ['message.sent'] },
      ]);
      manager.removeConfig('test-bot');

      const configs = manager.getConfig('test-bot');
      assert.deepEqual(configs, []);
    });
  });

  describe('send()', () => {
    test('queues webhook for matching event subscriptions', async () => {
      const mockRow = createMockWebhookRow();
      mockStorage.query = mock.fn(async () => ({ rows: [mockRow], rowCount: 1 }));

      manager.configure('test-bot', [
        { url: 'https://example.com/hook', events: ['message.sent'] },
      ]);

      const results = await manager.send('test-bot', 'message.sent', { text: 'hello' });

      assert.equal(results.length, 1);
      assert.equal(results[0].id, 1);
      assert.equal(results[0].botId, 'test-bot');
      assert.equal(results[0].event, 'message.sent');
    });

    test('queues multiple webhooks when multiple subscriptions match', async () => {
      let callCount = 0;
      mockStorage.query = mock.fn(async () => {
        callCount++;
        return {
          rows: [createMockWebhookRow({ id: callCount })],
          rowCount: 1,
        };
      });

      manager.configure('test-bot', [
        { url: 'https://example.com/a', events: ['message.sent'] },
        { url: 'https://example.com/b', events: ['message.sent'] },
      ]);

      const results = await manager.send('test-bot', 'message.sent', { text: 'hello' });
      assert.equal(results.length, 2);
    });

    test('returns empty array when no subscriptions match', async () => {
      manager.configure('test-bot', [{ url: 'https://example.com/hook', events: ['bot.started'] }]);

      const results = await manager.send('test-bot', 'message.sent', { text: 'hello' });
      assert.deepEqual(results, []);
    });

    test('returns empty array when bot has no config', async () => {
      const results = await manager.send('test-bot', 'message.sent', { text: 'hello' });
      assert.deepEqual(results, []);
    });

    test('inserts correct data into database', async () => {
      const mockRow = createMockWebhookRow();
      mockStorage.query = mock.fn(async () => ({ rows: [mockRow], rowCount: 1 }));

      manager.configure('test-bot', [
        {
          url: 'https://example.com/hook',
          events: ['message.sent'],
          method: 'PUT',
          headers: { 'X-Custom': 'value' },
          retries: 5,
        },
      ]);

      await manager.send('test-bot', 'message.sent', { text: 'hello' });

      const [sql, params] = mockStorage.query.mock.calls[0].arguments;
      assert.ok(sql.includes('INSERT INTO webhooks'));
      assert.equal(params[0], 'test-bot');
      assert.equal(params[1], 'message.sent');
      assert.equal(params[2], 'https://example.com/hook');
      assert.equal(params[3], 'PUT');
      assert.equal(params[4], JSON.stringify({ 'X-Custom': 'value' }));
      assert.equal(params[6], 5);
    });

    test('throws on empty botId', async () => {
      await assert.rejects(() => manager.send('', 'message.sent', {}), {
        name: 'WebhookManagerError',
      });
    });

    test('throws on empty event', async () => {
      await assert.rejects(() => manager.send('test-bot', '', {}), {
        name: 'WebhookManagerError',
      });
    });

    test('wraps database errors in WebhookManagerError', async () => {
      mockStorage.query = mock.fn(async () => {
        throw new Error('connection refused');
      });

      manager.configure('test-bot', [
        { url: 'https://example.com/hook', events: ['message.sent'] },
      ]);

      await assert.rejects(() => manager.send('test-bot', 'message.sent', {}), {
        name: 'WebhookManagerError',
        message: /Failed to queue webhook delivery/,
      });
    });
  });

  describe('retry()', () => {
    test('resets failed webhook for retry', async () => {
      mockStorage.query = mock.fn(async () => ({ rows: [], rowCount: 1 }));

      const result = await manager.retry(42);

      assert.equal(result, true);
      const [sql, params] = mockStorage.query.mock.calls[0].arguments;
      assert.ok(sql.includes('UPDATE webhooks'));
      assert.equal(params[0], 'pending');
      assert.equal(params[1], 42);
      assert.equal(params[2], 'failed');
    });

    test('returns false when webhook not found', async () => {
      mockStorage.query = mock.fn(async () => ({ rows: [], rowCount: 0 }));

      const result = await manager.retry(999);
      assert.equal(result, false);
    });

    test('throws on invalid webhookId', async () => {
      await assert.rejects(() => manager.retry(0), {
        name: 'WebhookManagerError',
      });
    });

    test('throws on non-integer webhookId', async () => {
      await assert.rejects(() => manager.retry('abc'), {
        name: 'WebhookManagerError',
      });
    });

    test('wraps database errors', async () => {
      mockStorage.query = mock.fn(async () => {
        throw new Error('connection lost');
      });

      await assert.rejects(() => manager.retry(1), {
        name: 'WebhookManagerError',
        message: /Failed to retry webhook/,
      });
    });
  });

  describe('getHistory()', () => {
    test('returns delivery history for a bot', async () => {
      const rows = [
        createMockWebhookRow({ id: 2, status: 'success' }),
        createMockWebhookRow({ id: 1, status: 'failed' }),
      ];
      mockStorage.query = mock.fn(async () => ({ rows, rowCount: 2 }));

      const history = await manager.getHistory('test-bot');

      assert.equal(history.length, 2);
      assert.equal(history[0].id, 2);
      assert.equal(history[0].status, 'success');
      assert.equal(history[1].id, 1);
      assert.equal(history[1].status, 'failed');
    });

    test('respects limit parameter', async () => {
      mockStorage.query = mock.fn(async () => ({ rows: [], rowCount: 0 }));

      await manager.getHistory('test-bot', 10);

      const [sql, params] = mockStorage.query.mock.calls[0].arguments;
      assert.ok(sql.includes('LIMIT'));
      assert.equal(params[1], 10);
    });

    test('defaults limit to 50', async () => {
      mockStorage.query = mock.fn(async () => ({ rows: [], rowCount: 0 }));

      await manager.getHistory('test-bot');

      const [, params] = mockStorage.query.mock.calls[0].arguments;
      assert.equal(params[1], 50);
    });

    test('throws on invalid botId', async () => {
      await assert.rejects(() => manager.getHistory(null), {
        name: 'WebhookManagerError',
      });
    });

    test('wraps database errors', async () => {
      mockStorage.query = mock.fn(async () => {
        throw new Error('query failed');
      });

      await assert.rejects(() => manager.getHistory('test-bot'), {
        name: 'WebhookManagerError',
        message: /Failed to get webhook history/,
      });
    });
  });

  describe('EventEmitter integration', () => {
    test('automatically queues webhooks when events fire', async () => {
      const emitter = new BotEventEmitter();
      const mockRow = createMockWebhookRow();
      mockStorage.query = mock.fn(async () => ({ rows: [mockRow], rowCount: 1 }));

      const m = new WebhookManager(mockStorage, { eventEmitter: emitter });
      m.configure('work-bot', [{ url: 'https://example.com/hook', events: ['bot.started'] }]);

      emitter.emitBotStarted('work-bot', { name: 'Work Assistant' });

      // Allow async event handler to complete
      await new Promise(resolve => setTimeout(resolve, 50));

      assert.ok(mockStorage.query.mock.callCount() > 0);
      const [sql] = mockStorage.query.mock.calls[0].arguments;
      assert.ok(sql.includes('INSERT INTO webhooks'));
    });

    test('does not queue for non-matching events', async () => {
      const emitter = new BotEventEmitter();
      const m = new WebhookManager(mockStorage, { eventEmitter: emitter });
      m.configure('work-bot', [{ url: 'https://example.com/hook', events: ['bot.error'] }]);

      emitter.emitBotStarted('work-bot');

      await new Promise(resolve => setTimeout(resolve, 50));

      // No INSERT should have been called
      assert.equal(mockStorage.query.mock.callCount(), 0);
    });

    test('does not queue for unconfigured bots', async () => {
      const emitter = new BotEventEmitter();
      // Manager must be instantiated to bind to emitter (reference kept by emitter)
      new WebhookManager(mockStorage, { eventEmitter: emitter });

      emitter.emitBotStarted('unknown-bot');

      await new Promise(resolve => setTimeout(resolve, 50));

      assert.equal(mockStorage.query.mock.callCount(), 0);
    });
  });

  describe('WebhookManagerError', () => {
    test('has correct name and message', () => {
      const err = new WebhookManagerError('test error');
      assert.equal(err.name, 'WebhookManagerError');
      assert.equal(err.message, 'test error');
    });

    test('preserves cause chain', () => {
      const cause = new Error('original');
      const err = new WebhookManagerError('wrapped', { cause });
      assert.equal(err.cause, cause);
    });

    test('includes operation and context fields', () => {
      const err = new WebhookManagerError('test', {
        operation: 'send',
        botId: 'test-bot',
        webhookId: 42,
      });

      assert.equal(err.operation, 'send');
      assert.equal(err.botId, 'test-bot');
      assert.equal(err.webhookId, 42);
    });
  });
});
