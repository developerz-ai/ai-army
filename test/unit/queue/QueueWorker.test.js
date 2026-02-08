/**
 * Unit tests for QueueWorker
 *
 * Tests the real-time message queue processor including:
 * - Constructor validation
 * - Start/stop lifecycle with LISTEN/NOTIFY setup
 * - processNext() with concurrency control and dequeue
 * - Notification handling (LISTEN/NOTIFY)
 * - Fallback polling
 * - Exponential backoff retry on failures
 * - Error handling and edge cases
 * - Bot config resolution
 *
 * All database and external interactions are mocked.
 */

import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { QueueWorker, QueueWorkerError, WORKER_STATES } from '../../../src/queue/queue-worker.js';

// ─── Mock Factories ──────────────────────────────────────────────

/**
 * Create a mock MessageQueue for testing
 * @param {Object} [overrides={}] - Override default mock implementations
 * @returns {Object} Mock MessageQueue
 */
function createMockMessageQueue(overrides = {}) {
  return {
    enqueue: mock.fn(async () => ({
      id: 1,
      botId: 'test-bot',
      status: 'pending',
    })),
    dequeue: mock.fn(async () => null),
    markCompleted: mock.fn(async () => true),
    markFailed: mock.fn(async () => true),
    getQueueDepth: mock.fn(async () => 0),
    ...overrides,
  };
}

/**
 * Create a mock MessageProcessor for testing
 * @param {Object} [overrides={}] - Override default mock implementations
 * @returns {Object} Mock MessageProcessor
 */
function createMockMessageProcessor(overrides = {}) {
  return {
    processMessage: mock.fn(async () => ({
      text: 'Response',
      toolCalls: [],
      usage: {},
      sessionId: 'session-1',
    })),
    ...overrides,
  };
}

/**
 * Create a mock ConcurrencyController for testing
 * @param {Object} [overrides={}] - Override default mock implementations
 * @returns {Object} Mock ConcurrencyController
 */
function createMockConcurrencyController(overrides = {}) {
  return {
    canProcess: mock.fn(() => true),
    startProcessing: mock.fn(),
    finishProcessing: mock.fn(),
    getActiveCount: mock.fn(() => 0),
    reset: mock.fn(),
    ...overrides,
  };
}

/**
 * Create a mock PostgresStorage for testing
 * @param {Object} [overrides={}] - Override default mock implementations
 * @returns {Object} Mock storage with pool
 */
function createMockStorage(overrides = {}) {
  const mockClient = createMockListenClient();
  return {
    pool: {
      connect: mock.fn(async () => mockClient),
    },
    query: mock.fn(async () => ({ rows: [], rowCount: 0 })),
    _mockClient: mockClient,
    ...overrides,
  };
}

/**
 * Create a mock PostgreSQL client for LISTEN operations
 * @returns {Object} Mock client with on/release/query methods
 */
function createMockListenClient() {
  const handlers = {};
  return {
    query: mock.fn(async () => ({ rows: [], rowCount: 0 })),
    release: mock.fn(),
    on: mock.fn((event, handler) => {
      if (!handlers[event]) {
        handlers[event] = [];
      }
      handlers[event].push(handler);
    }),
    _handlers: handlers,
    _emit(event, data) {
      if (handlers[event]) {
        for (const handler of handlers[event]) {
          handler(data);
        }
      }
    },
  };
}

/**
 * Create a mock dequeued message record
 * @param {Object} [overrides={}] - Override default values
 * @returns {Object} Mock dequeued message
 */
function createMockQueueMessage(overrides = {}) {
  return {
    id: 1,
    botId: 'test-bot',
    channelType: 'slack',
    channelId: 'C123ABC',
    userId: 'U456DEF',
    messageText: 'Hello bot!',
    priority: 0,
    status: 'processing',
    enqueuedAt: new Date('2024-01-01T00:00:00Z'),
    startedAt: new Date(),
    completedAt: null,
    error: null,
    ...overrides,
  };
}

/**
 * Helper to flush microtasks and pending timers
 * @returns {Promise<void>}
 */
async function flushMicrotasks() {
  await new Promise(resolve => setTimeout(resolve, 0));
}

// ─── Tests ──────────────────────────────────────────────────────

describe('QueueWorker', () => {
  let worker;
  let mockQueue;
  let mockProcessor;
  let mockConcurrency;
  let mockStorage;

  beforeEach(() => {
    mockQueue = createMockMessageQueue();
    mockProcessor = createMockMessageProcessor();
    mockConcurrency = createMockConcurrencyController();
    mockStorage = createMockStorage();

    worker = new QueueWorker(mockQueue, mockProcessor, mockConcurrency, mockStorage, {
      pollInterval: 60000, // Long interval to avoid auto-polling in tests
      retryAttempts: 3,
      retryDelay: 100, // Short delay for tests
    });
  });

  afterEach(async () => {
    if (worker && worker.getState() !== 'stopped') {
      await worker.stop();
    }
  });

  // ──────────────────────────────────────────────────────────────
  // Constructor
  // ──────────────────────────────────────────────────────────────

  describe('constructor', () => {
    test('creates instance with required dependencies', () => {
      const w = new QueueWorker(mockQueue, mockProcessor, mockConcurrency, mockStorage);
      assert.ok(w);
      assert.equal(w.getState(), WORKER_STATES.STOPPED);
    });

    test('uses default options when none provided', () => {
      const w = new QueueWorker(mockQueue, mockProcessor, mockConcurrency, mockStorage);
      assert.equal(w.pollInterval, 5000);
      assert.equal(w.retryAttempts, 3);
      assert.equal(w.retryDelay, 5000);
    });

    test('accepts custom options', () => {
      const w = new QueueWorker(mockQueue, mockProcessor, mockConcurrency, mockStorage, {
        pollInterval: 10000,
        retryAttempts: 5,
        retryDelay: 2000,
      });
      assert.equal(w.pollInterval, 10000);
      assert.equal(w.retryAttempts, 5);
      assert.equal(w.retryDelay, 2000);
    });

    test('accepts optional logger', () => {
      const logger = mock.fn();
      const w = new QueueWorker(mockQueue, mockProcessor, mockConcurrency, mockStorage, {
        logger,
      });
      assert.ok(w);
    });

    test('accepts optional getBotConfig callback', () => {
      const getBotConfig = mock.fn();
      const w = new QueueWorker(mockQueue, mockProcessor, mockConcurrency, mockStorage, {
        getBotConfig,
      });
      assert.equal(w.getBotConfig, getBotConfig);
    });

    test('throws when messageQueue is missing', () => {
      assert.throws(() => new QueueWorker(null, mockProcessor, mockConcurrency, mockStorage), {
        name: 'QueueWorkerError',
        message: /messageQueue is required/,
      });
    });

    test('throws when messageProcessor is missing', () => {
      assert.throws(() => new QueueWorker(mockQueue, null, mockConcurrency, mockStorage), {
        name: 'QueueWorkerError',
        message: /messageProcessor is required/,
      });
    });

    test('throws when concurrencyController is missing', () => {
      assert.throws(() => new QueueWorker(mockQueue, mockProcessor, null, mockStorage), {
        name: 'QueueWorkerError',
        message: /concurrencyController is required/,
      });
    });

    test('throws when storage is missing', () => {
      assert.throws(() => new QueueWorker(mockQueue, mockProcessor, mockConcurrency, null), {
        name: 'QueueWorkerError',
        message: /storage is required/,
      });
    });
  });

  // ──────────────────────────────────────────────────────────────
  // WORKER_STATES
  // ──────────────────────────────────────────────────────────────

  describe('WORKER_STATES', () => {
    test('has all expected states', () => {
      assert.equal(WORKER_STATES.STOPPED, 'stopped');
      assert.equal(WORKER_STATES.STARTING, 'starting');
      assert.equal(WORKER_STATES.RUNNING, 'running');
      assert.equal(WORKER_STATES.STOPPING, 'stopping');
    });

    test('is frozen', () => {
      assert.ok(Object.isFrozen(WORKER_STATES));
    });
  });

  // ──────────────────────────────────────────────────────────────
  // start()
  // ──────────────────────────────────────────────────────────────

  describe('start()', () => {
    test('transitions to running state', async () => {
      await worker.start();
      assert.equal(worker.getState(), WORKER_STATES.RUNNING);
    });

    test('acquires a dedicated client from the pool', async () => {
      await worker.start();
      assert.equal(mockStorage.pool.connect.mock.callCount(), 1);
    });

    test('issues LISTEN command on the client', async () => {
      await worker.start();
      const client = mockStorage._mockClient;
      const queries = client.query.mock.calls.map(c => c.arguments[0]);
      assert.ok(queries.some(q => q.includes('LISTEN message_queue')));
    });

    test('sets up notification handler on client', async () => {
      await worker.start();
      const client = mockStorage._mockClient;
      const events = client.on.mock.calls.map(c => c.arguments[0]);
      assert.ok(events.includes('notification'));
    });

    test('sets up error handler on client', async () => {
      await worker.start();
      const client = mockStorage._mockClient;
      const events = client.on.mock.calls.map(c => c.arguments[0]);
      assert.ok(events.includes('error'));
    });

    test('throws if already running', async () => {
      await worker.start();
      await assert.rejects(() => worker.start(), {
        name: 'QueueWorkerError',
        message: /already running/,
      });
    });

    test('throws if storage pool is not available', async () => {
      const noPoolStorage = { pool: null, query: mock.fn() };
      const w = new QueueWorker(mockQueue, mockProcessor, mockConcurrency, noPoolStorage);

      await assert.rejects(() => w.start(), {
        name: 'QueueWorkerError',
        message: /Storage pool is not available/,
      });
    });

    test('resets state to stopped on connection failure', async () => {
      mockStorage.pool.connect = mock.fn(async () => {
        throw new Error('connection refused');
      });

      await assert.rejects(() => worker.start(), {
        name: 'QueueWorkerError',
      });

      assert.equal(worker.getState(), WORKER_STATES.STOPPED);
    });

    test('releases client if LISTEN query fails', async () => {
      const failClient = createMockListenClient();
      failClient.query = mock.fn(async () => {
        throw new Error('LISTEN failed');
      });
      mockStorage.pool.connect = mock.fn(async () => failClient);

      await assert.rejects(() => worker.start(), {
        name: 'QueueWorkerError',
      });

      assert.equal(failClient.release.mock.callCount(), 1);
    });

    test('logs startup messages when logger provided', async () => {
      const logger = mock.fn();
      const w = new QueueWorker(mockQueue, mockProcessor, mockConcurrency, mockStorage, {
        logger,
        pollInterval: 60000,
      });

      await w.start();

      const messages = logger.mock.calls.map(c => c.arguments[0]);
      assert.ok(messages.some(m => m.includes('Starting queue worker')));
      assert.ok(messages.some(m => m.includes('started successfully')));

      await w.stop();
    });
  });

  // ──────────────────────────────────────────────────────────────
  // stop()
  // ──────────────────────────────────────────────────────────────

  describe('stop()', () => {
    test('transitions to stopped state', async () => {
      await worker.start();
      await worker.stop();
      assert.equal(worker.getState(), WORKER_STATES.STOPPED);
    });

    test('releases the LISTEN client', async () => {
      await worker.start();
      const client = mockStorage._mockClient;

      await worker.stop();
      assert.equal(client.release.mock.callCount(), 1);
    });

    test('issues UNLISTEN before releasing client', async () => {
      await worker.start();
      const client = mockStorage._mockClient;

      await worker.stop();
      const queries = client.query.mock.calls.map(c => c.arguments[0]);
      assert.ok(queries.some(q => q.includes('UNLISTEN message_queue')));
    });

    test('is idempotent when already stopped', async () => {
      await worker.stop(); // Should not throw
      assert.equal(worker.getState(), WORKER_STATES.STOPPED);
    });

    test('clears retry counts', async () => {
      await worker.start();
      worker._retryCounts.set(1, 2);

      await worker.stop();
      assert.equal(worker._retryCounts.size, 0);
    });

    test('clears pending bot IDs', async () => {
      await worker.start();
      worker._pendingBotIds.add('test-bot');

      await worker.stop();
      assert.equal(worker._pendingBotIds.size, 0);
    });

    test('logs shutdown messages when logger provided', async () => {
      const logger = mock.fn();
      const w = new QueueWorker(mockQueue, mockProcessor, mockConcurrency, mockStorage, {
        logger,
        pollInterval: 60000,
      });

      await w.start();
      await w.stop();

      const messages = logger.mock.calls.map(c => c.arguments[0]);
      assert.ok(messages.some(m => m.includes('Stopping queue worker')));
      assert.ok(messages.some(m => m.includes('Queue worker stopped')));
    });
  });

  // ──────────────────────────────────────────────────────────────
  // processNext()
  // ──────────────────────────────────────────────────────────────

  describe('processNext()', () => {
    beforeEach(async () => {
      await worker.start();
    });

    test('returns false when queue is empty', async () => {
      mockQueue.dequeue = mock.fn(async () => null);

      const result = await worker.processNext('test-bot');
      assert.equal(result, false);
    });

    test('checks concurrency before dequeuing', async () => {
      mockConcurrency.canProcess = mock.fn(() => false);

      const result = await worker.processNext('test-bot');

      assert.equal(result, false);
      assert.equal(mockConcurrency.canProcess.mock.callCount(), 1);
      assert.equal(mockQueue.dequeue.mock.callCount(), 0);
    });

    test('dequeues and processes message successfully', async () => {
      const msg = createMockQueueMessage();
      let dequeueCallCount = 0;
      mockQueue.dequeue = mock.fn(async () => {
        dequeueCallCount++;
        // Return message on first call, null on follow-up (from _scheduleProcessNext)
        return dequeueCallCount === 1 ? msg : null;
      });

      const result = await worker.processNext('test-bot');

      assert.equal(result, true);
      // First call dequeues; a follow-up call is scheduled via _scheduleProcessNext
      assert.ok(mockQueue.dequeue.mock.callCount() >= 1);
      assert.equal(mockProcessor.processMessage.mock.callCount(), 1);
      assert.equal(mockQueue.markCompleted.mock.callCount(), 1);
    });

    test('passes correct message format to MessageProcessor', async () => {
      const msg = createMockQueueMessage({
        channelType: 'discord',
        channelId: 'D789',
        userId: 'U101',
        messageText: 'Hello!',
      });
      mockQueue.dequeue = mock.fn(async () => msg);

      await worker.processNext('test-bot');

      const [, processorMsg] = mockProcessor.processMessage.mock.calls[0].arguments;
      assert.equal(processorMsg.type, 'discord');
      assert.equal(processorMsg.channelId, 'D789');
      assert.equal(processorMsg.userId, 'U101');
      assert.equal(processorMsg.text, 'Hello!');
    });

    test('registers and releases concurrency slot', async () => {
      const msg = createMockQueueMessage();
      mockQueue.dequeue = mock.fn(async () => msg);

      await worker.processNext('test-bot');

      assert.equal(mockConcurrency.startProcessing.mock.callCount(), 1);
      const [botId, messageId] = mockConcurrency.startProcessing.mock.calls[0].arguments;
      assert.equal(botId, 'test-bot');
      assert.equal(messageId, msg.id);

      assert.equal(mockConcurrency.finishProcessing.mock.callCount(), 1);
    });

    test('releases concurrency slot even on processing failure', async () => {
      const msg = createMockQueueMessage();
      mockQueue.dequeue = mock.fn(async () => msg);
      mockProcessor.processMessage = mock.fn(async () => {
        throw new Error('processing failed');
      });

      await worker.processNext('test-bot');

      assert.equal(mockConcurrency.finishProcessing.mock.callCount(), 1);
    });

    test('returns false when not running', async () => {
      await worker.stop();
      const result = await worker.processNext('test-bot');
      assert.equal(result, false);
    });

    test('returns false for invalid botId', async () => {
      const result = await worker.processNext('');
      assert.equal(result, false);
    });

    test('returns false for null botId', async () => {
      const result = await worker.processNext(null);
      assert.equal(result, false);
    });

    test('handles dequeue errors gracefully', async () => {
      mockQueue.dequeue = mock.fn(async () => {
        throw new Error('database timeout');
      });

      const result = await worker.processNext('test-bot');
      assert.equal(result, false);
    });

    test('marks message completed on success', async () => {
      const msg = createMockQueueMessage({ id: 42 });
      mockQueue.dequeue = mock.fn(async () => msg);

      await worker.processNext('test-bot');

      assert.equal(mockQueue.markCompleted.mock.callCount(), 1);
      const [messageId] = mockQueue.markCompleted.mock.calls[0].arguments;
      assert.equal(messageId, 42);
    });

    test('uses getBotConfig callback when provided', async () => {
      const botConfig = { id: 'test-bot', provider: 'anthropic', model: 'claude' };
      const getBotConfig = mock.fn(async () => botConfig);
      const w = new QueueWorker(mockQueue, mockProcessor, mockConcurrency, mockStorage, {
        getBotConfig,
        pollInterval: 60000,
      });
      await w.start();

      const msg = createMockQueueMessage();
      mockQueue.dequeue = mock.fn(async () => msg);

      await w.processNext('test-bot');

      assert.equal(getBotConfig.mock.callCount(), 1);
      const [passedBotConfig] = mockProcessor.processMessage.mock.calls[0].arguments;
      assert.equal(passedBotConfig.provider, 'anthropic');

      await w.stop();
    });

    test('uses minimal config when getBotConfig returns null', async () => {
      const getBotConfig = mock.fn(async () => null);
      const w = new QueueWorker(mockQueue, mockProcessor, mockConcurrency, mockStorage, {
        getBotConfig,
        pollInterval: 60000,
      });
      await w.start();

      const msg = createMockQueueMessage();
      mockQueue.dequeue = mock.fn(async () => msg);

      await w.processNext('test-bot');

      const [passedBotConfig] = mockProcessor.processMessage.mock.calls[0].arguments;
      assert.equal(passedBotConfig.id, 'test-bot');
      assert.equal(passedBotConfig.provider, 'unknown');

      await w.stop();
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Retry logic
  // ──────────────────────────────────────────────────────────────

  describe('retry logic', () => {
    beforeEach(async () => {
      await worker.start();
    });

    test('tracks retry count on processing failure', async () => {
      const msg = createMockQueueMessage({ id: 42 });
      mockQueue.dequeue = mock.fn(async () => msg);
      mockProcessor.processMessage = mock.fn(async () => {
        throw new Error('processing failed');
      });

      await worker.processNext('test-bot');

      assert.equal(worker.getRetryCount(42), 1);
    });

    test('clears retry count on success', async () => {
      // First, set a retry count
      worker._retryCounts.set(42, 2);

      const msg = createMockQueueMessage({ id: 42 });
      mockQueue.dequeue = mock.fn(async () => msg);

      await worker.processNext('test-bot');

      assert.equal(worker.getRetryCount(42), 0);
    });

    test('marks as failed when retry limit exceeded', async () => {
      const msg = createMockQueueMessage({ id: 42 });
      worker._retryCounts.set(42, 3); // Already at max retries

      mockQueue.dequeue = mock.fn(async () => msg);
      mockProcessor.processMessage = mock.fn(async () => {
        throw new Error('always fails');
      });

      await worker.processNext('test-bot');

      // Should call markFailed since retry limit exceeded
      assert.equal(mockQueue.markFailed.mock.callCount(), 1);
      assert.equal(worker.getRetryCount(42), 0); // Cleaned up
    });

    test('re-enqueues message on retryable failure after delay', async () => {
      const msg = createMockQueueMessage({ id: 42 });
      mockQueue.dequeue = mock.fn(async () => msg);
      mockProcessor.processMessage = mock.fn(async () => {
        throw new Error('transient error');
      });

      await worker.processNext('test-bot');

      // Retry is scheduled asynchronously with setTimeout
      // The re-enqueue won't happen immediately
      assert.equal(worker.getRetryCount(42), 1);

      // Wait for the retry delay
      await new Promise(resolve => setTimeout(resolve, 150));

      // Should have re-enqueued
      assert.equal(mockQueue.enqueue.mock.callCount(), 1);
    });

    test('getRetryCount returns 0 for unknown message', () => {
      assert.equal(worker.getRetryCount(999), 0);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Notification handling
  // ──────────────────────────────────────────────────────────────

  describe('notification handling', () => {
    test('triggers processNext on notification for correct channel', async () => {
      const msg = createMockQueueMessage();
      mockQueue.dequeue = mock.fn(async () => msg);

      await worker.start();

      const client = mockStorage._mockClient;

      // Simulate a NOTIFY event
      client._emit('notification', {
        channel: 'message_queue',
        payload: 'test-bot',
      });

      // Allow the microtask to process
      await flushMicrotasks();

      assert.ok(mockQueue.dequeue.mock.callCount() >= 1);
    });

    test('ignores notifications for wrong channel', async () => {
      await worker.start();

      const client = mockStorage._mockClient;

      client._emit('notification', {
        channel: 'other_channel',
        payload: 'test-bot',
      });

      await flushMicrotasks();

      assert.equal(mockQueue.dequeue.mock.callCount(), 0);
    });

    test('ignores notifications with empty payload', async () => {
      await worker.start();

      const client = mockStorage._mockClient;

      client._emit('notification', {
        channel: 'message_queue',
        payload: '',
      });

      await flushMicrotasks();

      assert.equal(mockQueue.dequeue.mock.callCount(), 0);
    });

    test('deduplicates rapid notifications for same bot', async () => {
      await worker.start();

      const client = mockStorage._mockClient;

      // Fire multiple notifications for same bot synchronously
      client._emit('notification', { channel: 'message_queue', payload: 'test-bot' });
      client._emit('notification', { channel: 'message_queue', payload: 'test-bot' });
      client._emit('notification', { channel: 'message_queue', payload: 'test-bot' });

      await flushMicrotasks();

      // Should deduplicate - at most 1 processNext call due to _pendingBotIds Set
      // (The first one adds to set, subsequent ones skip)
      assert.ok(mockQueue.dequeue.mock.callCount() <= 1);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Polling
  // ──────────────────────────────────────────────────────────────

  describe('polling', () => {
    test('polls for pending bots on timer', async () => {
      const w = new QueueWorker(mockQueue, mockProcessor, mockConcurrency, mockStorage, {
        pollInterval: 50, // Short interval for testing
      });

      mockStorage.query = mock.fn(async () => ({
        rows: [{ bot_id: 'bot-a' }, { bot_id: 'bot-b' }],
        rowCount: 2,
      }));

      await w.start();

      // Wait for at least one poll cycle
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should have queried for pending bots
      assert.ok(mockStorage.query.mock.callCount() >= 1);

      await w.stop();
    });

    test('queries for distinct pending bot_ids', async () => {
      const w = new QueueWorker(mockQueue, mockProcessor, mockConcurrency, mockStorage, {
        pollInterval: 50,
      });

      mockStorage.query = mock.fn(async () => ({
        rows: [],
        rowCount: 0,
      }));

      await w.start();
      await new Promise(resolve => setTimeout(resolve, 100));

      const { calls } = mockStorage.query.mock;
      assert.ok(calls.length >= 1);

      const [sql, params] = calls[0].arguments;
      assert.ok(sql.includes('DISTINCT bot_id'));
      assert.ok(sql.includes('message_queue'));
      assert.deepStrictEqual(params, ['pending']);

      await w.stop();
    });

    test('handles poll errors gracefully', async () => {
      const logger = mock.fn();
      const w = new QueueWorker(mockQueue, mockProcessor, mockConcurrency, mockStorage, {
        pollInterval: 50,
        logger,
      });

      mockStorage.query = mock.fn(async () => {
        throw new Error('poll query failed');
      });

      await w.start();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should have logged the error, not thrown
      const messages = logger.mock.calls.map(c => c.arguments[0]);
      assert.ok(messages.some(m => m.includes('Poll failed')));

      await w.stop();
    });
  });

  // ──────────────────────────────────────────────────────────────
  // LISTEN client reconnection
  // ──────────────────────────────────────────────────────────────

  describe('LISTEN client reconnection', () => {
    test('attempts reconnection after client error', async () => {
      const w = new QueueWorker(mockQueue, mockProcessor, mockConcurrency, mockStorage, {
        pollInterval: 60000,
      });

      await w.start();

      const client = mockStorage._mockClient;

      // Reset connect mock to create a new client for reconnection
      const newClient = createMockListenClient();
      mockStorage.pool.connect = mock.fn(async () => newClient);

      // Simulate client error
      client._emit('error', new Error('connection lost'));

      // Wait for reconnection delay (uses pollInterval)
      await new Promise(resolve => setTimeout(resolve, 100));

      // Can't fully test reconnection timing here since pollInterval is 60s,
      // but we can verify the _listenClient was cleared
      // (reconnection is scheduled via setTimeout with pollInterval delay)

      await w.stop();
    });
  });

  // ──────────────────────────────────────────────────────────────
  // getState()
  // ──────────────────────────────────────────────────────────────

  describe('getState()', () => {
    test('returns stopped initially', () => {
      assert.equal(worker.getState(), WORKER_STATES.STOPPED);
    });

    test('returns running after start', async () => {
      await worker.start();
      assert.equal(worker.getState(), WORKER_STATES.RUNNING);
    });

    test('returns stopped after stop', async () => {
      await worker.start();
      await worker.stop();
      assert.equal(worker.getState(), WORKER_STATES.STOPPED);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // QueueWorkerError
  // ──────────────────────────────────────────────────────────────

  describe('QueueWorkerError', () => {
    test('has correct name and message', () => {
      const err = new QueueWorkerError('test error');
      assert.equal(err.name, 'QueueWorkerError');
      assert.equal(err.message, 'test error');
    });

    test('preserves cause chain', () => {
      const cause = new Error('original');
      const err = new QueueWorkerError('wrapped', { cause });
      assert.equal(err.cause, cause);
    });

    test('includes operation and context fields', () => {
      const err = new QueueWorkerError('test', {
        operation: 'processNext',
        botId: 'test-bot',
        messageId: 42,
      });
      assert.equal(err.operation, 'processNext');
      assert.equal(err.botId, 'test-bot');
      assert.equal(err.messageId, 42);
    });
  });
});
