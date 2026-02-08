/**
 * Unit tests for MessageQueue
 *
 * Tests the PostgreSQL-backed message queue including:
 * - Message enqueuing with priority support
 * - Concurrent-safe dequeuing with FOR UPDATE SKIP LOCKED
 * - Queue depth monitoring
 * - Queue clearing
 * - Message lifecycle (markCompleted, markFailed)
 * - Queue statistics
 * - Input validation
 * - Error handling
 *
 * All database interactions are mocked.
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  MessageQueue,
  MessageQueueError,
  MESSAGE_STATUSES,
} from '../../../src/queue/message-queue.js';

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
 * Create a valid message object for testing
 * @param {Object} [overrides={}] - Override default values
 * @returns {Object} Valid message object
 */
function createTestMessage(overrides = {}) {
  return {
    channelType: 'slack',
    channelId: 'C123ABC',
    userId: 'U456DEF',
    text: 'Hello bot!',
    ...overrides,
  };
}

/**
 * Create a mock database row for testing
 * @param {Object} [overrides={}] - Override default values
 * @returns {Object} Mock database row
 */
function createMockRow(overrides = {}) {
  return {
    id: 1,
    bot_id: 'test-bot',
    channel_type: 'slack',
    channel_id: 'C123ABC',
    user_id: 'U456DEF',
    message_text: 'Hello bot!',
    priority: 0,
    status: 'pending',
    enqueued_at: new Date('2024-01-01T00:00:00Z'),
    started_at: null,
    completed_at: null,
    error: null,
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('MessageQueue', () => {
  let queue;
  let mockStorage;

  beforeEach(() => {
    mockStorage = createMockStorage();
    queue = new MessageQueue(mockStorage);
  });

  describe('constructor', () => {
    test('creates instance with storage', () => {
      const q = new MessageQueue(mockStorage);
      assert.ok(q);
    });

    test('throws when storage is missing', () => {
      assert.throws(() => new MessageQueue(null), {
        name: 'MessageQueueError',
      });
    });

    test('accepts optional logger', () => {
      const logger = mock.fn();
      const q = new MessageQueue(mockStorage, { logger });
      assert.ok(q);
    });
  });

  describe('MESSAGE_STATUSES', () => {
    test('has all expected statuses', () => {
      assert.equal(MESSAGE_STATUSES.PENDING, 'pending');
      assert.equal(MESSAGE_STATUSES.PROCESSING, 'processing');
      assert.equal(MESSAGE_STATUSES.COMPLETED, 'completed');
      assert.equal(MESSAGE_STATUSES.FAILED, 'failed');
    });

    test('is frozen', () => {
      assert.ok(Object.isFrozen(MESSAGE_STATUSES));
    });
  });

  describe('enqueue()', () => {
    test('inserts message into database with correct parameters', async () => {
      const mockRow = createMockRow();
      mockStorage.query = mock.fn(async () => ({ rows: [mockRow], rowCount: 1 }));

      const message = createTestMessage();
      await queue.enqueue('test-bot', message, 5);

      assert.equal(mockStorage.query.mock.callCount(), 1);
      const [sql, params] = mockStorage.query.mock.calls[0].arguments;
      assert.ok(sql.includes('INSERT INTO message_queue'));
      assert.deepStrictEqual(params, [
        'test-bot',
        'slack',
        'C123ABC',
        'U456DEF',
        'Hello bot!',
        5,
        null,
        null,
      ]);
    });

    test('returns transformed record', async () => {
      const mockRow = createMockRow({ priority: 5 });
      mockStorage.query = mock.fn(async () => ({ rows: [mockRow], rowCount: 1 }));

      const result = await queue.enqueue('test-bot', createTestMessage(), 5);

      assert.equal(result.id, 1);
      assert.equal(result.botId, 'test-bot');
      assert.equal(result.channelType, 'slack');
      assert.equal(result.channelId, 'C123ABC');
      assert.equal(result.userId, 'U456DEF');
      assert.equal(result.messageText, 'Hello bot!');
      assert.equal(result.priority, 5);
      assert.equal(result.status, 'pending');
    });

    test('defaults priority to 0', async () => {
      const mockRow = createMockRow();
      mockStorage.query = mock.fn(async () => ({ rows: [mockRow], rowCount: 1 }));

      await queue.enqueue('test-bot', createTestMessage());

      const [, params] = mockStorage.query.mock.calls[0].arguments;
      assert.equal(params[5], 0);
    });

    test('throws on empty botId', async () => {
      await assert.rejects(() => queue.enqueue('', createTestMessage()), {
        name: 'MessageQueueError',
      });
    });

    test('throws on null botId', async () => {
      await assert.rejects(() => queue.enqueue(null, createTestMessage()), {
        name: 'MessageQueueError',
      });
    });

    test('throws on missing message fields', async () => {
      await assert.rejects(() => queue.enqueue('test-bot', {}), {
        name: 'MessageQueueError',
      });
    });

    test('throws on invalid channelType', async () => {
      await assert.rejects(
        () => queue.enqueue('test-bot', createTestMessage({ channelType: 'invalid' })),
        { name: 'MessageQueueError' }
      );
    });

    test('throws on negative priority', async () => {
      await assert.rejects(() => queue.enqueue('test-bot', createTestMessage(), -1), {
        name: 'MessageQueueError',
      });
    });

    test('throws on non-integer priority', async () => {
      await assert.rejects(() => queue.enqueue('test-bot', createTestMessage(), 1.5), {
        name: 'MessageQueueError',
      });
    });

    test('wraps database errors in MessageQueueError', async () => {
      mockStorage.query = mock.fn(async () => {
        throw new Error('connection refused');
      });

      await assert.rejects(() => queue.enqueue('test-bot', createTestMessage()), {
        name: 'MessageQueueError',
        message: /Failed to enqueue message/,
      });
    });

    test('logs enqueue when logger is provided', async () => {
      const logger = mock.fn();
      const q = new MessageQueue(mockStorage, { logger });
      const mockRow = createMockRow();
      mockStorage.query = mock.fn(async () => ({ rows: [mockRow], rowCount: 1 }));

      await q.enqueue('test-bot', createTestMessage());

      assert.equal(logger.mock.callCount(), 1);
      assert.ok(logger.mock.calls[0].arguments[0].includes('[MessageQueue]'));
    });
  });

  describe('dequeue()', () => {
    test('returns null when queue is empty', async () => {
      const result = await queue.dequeue('test-bot');
      assert.equal(result, null);
    });

    test('calls transaction for atomic dequeue', async () => {
      await queue.dequeue('test-bot');
      assert.equal(mockStorage.transaction.mock.callCount(), 1);
    });

    test('uses FOR UPDATE SKIP LOCKED in select query', async () => {
      const clientQueries = [];
      mockStorage.transaction = mock.fn(async callback => {
        const mockClient = {
          query: mock.fn(async (sql, _params) => {
            clientQueries.push(sql);
            return { rows: [], rowCount: 0 };
          }),
        };
        return callback(mockClient);
      });

      await queue.dequeue('test-bot');

      assert.ok(clientQueries.length > 0);
      assert.ok(clientQueries[0].includes('FOR UPDATE SKIP LOCKED'));
    });

    test('orders by priority DESC, enqueued_at ASC', async () => {
      const clientQueries = [];
      mockStorage.transaction = mock.fn(async callback => {
        const mockClient = {
          query: mock.fn(async (sql, _params) => {
            clientQueries.push(sql);
            return { rows: [], rowCount: 0 };
          }),
        };
        return callback(mockClient);
      });

      await queue.dequeue('test-bot');

      assert.ok(clientQueries[0].includes('ORDER BY priority DESC, enqueued_at ASC'));
    });

    test('updates status to processing when message found', async () => {
      const clientQueries = [];
      const mockRow = createMockRow();
      const updatedRow = createMockRow({ status: 'processing', started_at: new Date() });

      mockStorage.transaction = mock.fn(async callback => {
        let callCount = 0;
        const mockClient = {
          query: mock.fn(async (sql, _params) => {
            clientQueries.push(sql);
            callCount++;
            if (callCount === 1) {
              return { rows: [mockRow], rowCount: 1 };
            }
            return { rows: [updatedRow], rowCount: 1 };
          }),
        };
        return callback(mockClient);
      });

      const result = await queue.dequeue('test-bot');

      assert.equal(clientQueries.length, 2);
      assert.ok(clientQueries[1].includes('UPDATE message_queue'));
      assert.ok(clientQueries[1].includes('status = $1'));
      assert.equal(result.status, 'processing');
    });

    test('returns transformed record on successful dequeue', async () => {
      const updatedRow = createMockRow({
        id: 42,
        status: 'processing',
        started_at: new Date(),
      });

      mockStorage.transaction = mock.fn(async callback => {
        let callCount = 0;
        const mockClient = {
          query: mock.fn(async () => {
            callCount++;
            if (callCount === 1) {
              return { rows: [createMockRow({ id: 42 })], rowCount: 1 };
            }
            return { rows: [updatedRow], rowCount: 1 };
          }),
        };
        return callback(mockClient);
      });

      const result = await queue.dequeue('test-bot');

      assert.equal(result.id, 42);
      assert.equal(result.botId, 'test-bot');
      assert.equal(result.status, 'processing');
    });

    test('throws on empty botId', async () => {
      await assert.rejects(() => queue.dequeue(''), {
        name: 'MessageQueueError',
      });
    });

    test('wraps transaction errors in MessageQueueError', async () => {
      mockStorage.transaction = mock.fn(async () => {
        throw new Error('deadlock detected');
      });

      await assert.rejects(() => queue.dequeue('test-bot'), {
        name: 'MessageQueueError',
        message: /Failed to dequeue message/,
      });
    });
  });

  describe('getQueueDepth()', () => {
    test('returns count of pending messages', async () => {
      mockStorage.query = mock.fn(async () => ({
        rows: [{ depth: 7 }],
        rowCount: 1,
      }));

      const depth = await queue.getQueueDepth('test-bot');
      assert.equal(depth, 7);
    });

    test('queries with correct parameters', async () => {
      mockStorage.query = mock.fn(async () => ({
        rows: [{ depth: 0 }],
        rowCount: 1,
      }));

      await queue.getQueueDepth('work-bot');

      const [sql, params] = mockStorage.query.mock.calls[0].arguments;
      assert.ok(sql.includes('COUNT'));
      assert.deepStrictEqual(params, ['work-bot', 'pending']);
    });

    test('returns 0 for empty queue', async () => {
      mockStorage.query = mock.fn(async () => ({
        rows: [{ depth: 0 }],
        rowCount: 1,
      }));

      const depth = await queue.getQueueDepth('empty-bot');
      assert.equal(depth, 0);
    });

    test('throws on invalid botId', async () => {
      await assert.rejects(() => queue.getQueueDepth(null), {
        name: 'MessageQueueError',
      });
    });

    test('wraps database errors', async () => {
      mockStorage.query = mock.fn(async () => {
        throw new Error('timeout');
      });

      await assert.rejects(() => queue.getQueueDepth('test-bot'), {
        name: 'MessageQueueError',
        message: /Failed to get queue depth/,
      });
    });
  });

  describe('clearQueue()', () => {
    test('deletes pending messages for a bot', async () => {
      mockStorage.query = mock.fn(async () => ({ rows: [], rowCount: 5 }));

      const cleared = await queue.clearQueue('test-bot');

      assert.equal(cleared, 5);
      const [sql, params] = mockStorage.query.mock.calls[0].arguments;
      assert.ok(sql.includes('DELETE FROM message_queue'));
      assert.deepStrictEqual(params, ['test-bot', 'pending']);
    });

    test('returns 0 when no pending messages', async () => {
      mockStorage.query = mock.fn(async () => ({ rows: [], rowCount: 0 }));

      const cleared = await queue.clearQueue('test-bot');
      assert.equal(cleared, 0);
    });

    test('only clears pending messages, not processing ones', async () => {
      mockStorage.query = mock.fn(async () => ({ rows: [], rowCount: 0 }));

      await queue.clearQueue('test-bot');

      const [sql, params] = mockStorage.query.mock.calls[0].arguments;
      assert.ok(sql.includes('status = $2'));
      assert.equal(params[1], 'pending');
    });

    test('throws on invalid botId', async () => {
      await assert.rejects(() => queue.clearQueue(''), {
        name: 'MessageQueueError',
      });
    });

    test('wraps database errors', async () => {
      mockStorage.query = mock.fn(async () => {
        throw new Error('permission denied');
      });

      await assert.rejects(() => queue.clearQueue('test-bot'), {
        name: 'MessageQueueError',
        message: /Failed to clear queue/,
      });
    });
  });

  describe('markCompleted()', () => {
    test('updates processing message to completed', async () => {
      mockStorage.query = mock.fn(async () => ({ rows: [], rowCount: 1 }));

      const result = await queue.markCompleted(42);

      assert.equal(result, true);
      const [sql, params] = mockStorage.query.mock.calls[0].arguments;
      assert.ok(sql.includes('UPDATE message_queue'));
      assert.ok(sql.includes('completed_at = NOW()'));
      assert.deepStrictEqual(params, ['completed', 42, 'processing']);
    });

    test('returns false when message not found', async () => {
      mockStorage.query = mock.fn(async () => ({ rows: [], rowCount: 0 }));

      const result = await queue.markCompleted(999);
      assert.equal(result, false);
    });

    test('only updates messages with processing status', async () => {
      mockStorage.query = mock.fn(async () => ({ rows: [], rowCount: 0 }));

      await queue.markCompleted(1);

      const [sql, params] = mockStorage.query.mock.calls[0].arguments;
      assert.ok(sql.includes('status = $3'));
      assert.equal(params[2], 'processing');
    });

    test('throws on invalid id', async () => {
      await assert.rejects(() => queue.markCompleted(0), {
        name: 'MessageQueueError',
      });
    });

    test('throws on non-integer id', async () => {
      await assert.rejects(() => queue.markCompleted('abc'), {
        name: 'MessageQueueError',
      });
    });

    test('wraps database errors', async () => {
      mockStorage.query = mock.fn(async () => {
        throw new Error('constraint violation');
      });

      await assert.rejects(() => queue.markCompleted(1), {
        name: 'MessageQueueError',
        message: /Failed to mark message completed/,
      });
    });
  });

  describe('markFailed()', () => {
    test('updates processing message to failed with error', async () => {
      mockStorage.query = mock.fn(async () => ({ rows: [], rowCount: 1 }));

      const result = await queue.markFailed(42, 'Bot timeout');

      assert.equal(result, true);
      const [sql, params] = mockStorage.query.mock.calls[0].arguments;
      assert.ok(sql.includes('UPDATE message_queue'));
      assert.ok(sql.includes('error = $2'));
      assert.deepStrictEqual(params, ['failed', 'Bot timeout', 42, 'processing']);
    });

    test('extracts message from Error objects', async () => {
      mockStorage.query = mock.fn(async () => ({ rows: [], rowCount: 1 }));

      await queue.markFailed(42, new Error('Connection lost'));

      const [, params] = mockStorage.query.mock.calls[0].arguments;
      assert.equal(params[1], 'Connection lost');
    });

    test('returns false when message not found', async () => {
      mockStorage.query = mock.fn(async () => ({ rows: [], rowCount: 0 }));

      const result = await queue.markFailed(999, 'error');
      assert.equal(result, false);
    });

    test('throws on invalid id', async () => {
      await assert.rejects(() => queue.markFailed(-1, 'error'), {
        name: 'MessageQueueError',
      });
    });

    test('wraps database errors', async () => {
      mockStorage.query = mock.fn(async () => {
        throw new Error('connection lost');
      });

      await assert.rejects(() => queue.markFailed(1, 'error'), {
        name: 'MessageQueueError',
        message: /Failed to mark message failed/,
      });
    });
  });

  describe('getStats()', () => {
    test('returns counts grouped by status', async () => {
      mockStorage.query = mock.fn(async () => ({
        rows: [
          { status: 'pending', count: 10 },
          { status: 'processing', count: 2 },
          { status: 'completed', count: 50 },
          { status: 'failed', count: 3 },
        ],
        rowCount: 4,
      }));

      const stats = await queue.getStats('test-bot');

      assert.deepStrictEqual(stats, {
        pending: 10,
        processing: 2,
        completed: 50,
        failed: 3,
      });
    });

    test('returns zero counts for missing statuses', async () => {
      mockStorage.query = mock.fn(async () => ({
        rows: [{ status: 'pending', count: 5 }],
        rowCount: 1,
      }));

      const stats = await queue.getStats('test-bot');

      assert.equal(stats.pending, 5);
      assert.equal(stats.processing, 0);
      assert.equal(stats.completed, 0);
      assert.equal(stats.failed, 0);
    });

    test('returns all zeros for bot with no messages', async () => {
      mockStorage.query = mock.fn(async () => ({
        rows: [],
        rowCount: 0,
      }));

      const stats = await queue.getStats('empty-bot');

      assert.deepStrictEqual(stats, {
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
      });
    });

    test('throws on invalid botId', async () => {
      await assert.rejects(() => queue.getStats(null), {
        name: 'MessageQueueError',
      });
    });

    test('wraps database errors', async () => {
      mockStorage.query = mock.fn(async () => {
        throw new Error('query failed');
      });

      await assert.rejects(() => queue.getStats('test-bot'), {
        name: 'MessageQueueError',
        message: /Failed to get queue stats/,
      });
    });
  });

  describe('MessageQueueError', () => {
    test('has correct name and message', () => {
      const err = new MessageQueueError('test error');
      assert.equal(err.name, 'MessageQueueError');
      assert.equal(err.message, 'test error');
    });

    test('preserves cause chain', () => {
      const cause = new Error('original');
      const err = new MessageQueueError('wrapped', { cause });
      assert.equal(err.cause, cause);
    });

    test('includes operation and context fields', () => {
      const err = new MessageQueueError('test', {
        operation: 'enqueue',
        botId: 'test-bot',
        messageId: 42,
      });

      assert.equal(err.operation, 'enqueue');
      assert.equal(err.botId, 'test-bot');
      assert.equal(err.messageId, 42);
    });
  });
});
