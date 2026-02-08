/**
 * Integration tests for Queue Processing
 *
 * Tests the full message queue processing pipeline with real components:
 * - Real PostgreSQL database (with per-worker test database)
 * - Real MessageQueue (with actual DB queries)
 * - Real QueueWorker (with LISTEN/NOTIFY)
 * - Real ConcurrencyController (in-memory concurrency tracking)
 * - Mock MessageProcessor (to avoid real LLM API calls)
 *
 * Test categories:
 * 1. Full pipeline - enqueue -> worker dequeue -> process -> mark completed
 * 2. LISTEN/NOTIFY - real-time message processing via PostgreSQL notifications
 * 3. Concurrency control - respects per-bot concurrency limits
 * 4. Retry logic - automatic retry with exponential backoff on failures
 * 5. Queue persistence - queue survives restarts (data in PostgreSQL)
 * 6. Priority ordering - high-priority messages processed first
 *
 * Requires PostgreSQL to be running and accessible.
 */

import { test, describe, before, after, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { MessageQueue, MESSAGE_STATUSES } from '../../../src/queue/message-queue.js';
import { QueueWorker, WORKER_STATES } from '../../../src/queue/queue-worker.js';
import { ConcurrencyController } from '../../../src/queue/concurrency-controller.js';
import {
  setupTestDatabase,
  cleanupTestDatabase,
  isDatabaseAvailable,
} from '../../helpers/setup.js';

const DB_AVAILABLE = await isDatabaseAvailable();

if (!DB_AVAILABLE) {
  console.log('Queue integration tests: PostgreSQL not available, skipping tests');
}

// ─── Mock Factories ──────────────────────────────────────────────

/**
 * Create a mock MessageProcessor for testing
 * @param {Object} [result] - Result to return from processMessage()
 * @returns {Object} Mock message processor
 */
function createMockMessageProcessor(result) {
  const defaultResult = {
    text: 'Message processed successfully',
    toolCalls: [],
    usage: { promptTokens: 50, completionTokens: 25, totalTokens: 75 },
    sessionId: 'test-session-1',
  };

  return {
    processMessage: mock.fn(async () => result || defaultResult),
  };
}

/**
 * Create a test message object
 * @param {Object} [overrides={}] - Override default values
 * @returns {Object} Test message
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
 * Helper to wait for a condition to be true
 * @param {Function} condition - Function that returns true when condition is met
 * @param {number} timeout - Max time to wait in ms
 * @param {number} interval - Check interval in ms
 */
async function waitFor(condition, timeout = 5000, interval = 50) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  throw new Error('waitFor timeout');
}

// ─── Tests ──────────────────────────────────────────────────────

describe('Queue Processing Integration', { skip: !DB_AVAILABLE }, () => {
  let storage;
  let messageQueue;
  let queueWorker;
  let concurrencyController;
  let mockProcessor;

  /** Track all workers created during a test so we can stop them all in afterEach */
  let activeWorkers;

  before(async () => {
    storage = await setupTestDatabase();
  });

  after(async () => {
    if (storage) {
      await cleanupTestDatabase(storage);
    }
  });

  beforeEach(async () => {
    activeWorkers = [];

    // Clean message queue table between tests
    await storage.query('DELETE FROM message_queue');

    // Create fresh instances
    messageQueue = new MessageQueue(storage);
    concurrencyController = new ConcurrencyController({ defaultMaxConcurrent: 3 });
    mockProcessor = createMockMessageProcessor();

    // Create worker with short polling interval for faster tests
    queueWorker = new QueueWorker(messageQueue, mockProcessor, concurrencyController, storage, {
      pollInterval: 1000,
      retryAttempts: 2,
      retryDelay: 100,
    });
    activeWorkers.push(queueWorker);
  });

  afterEach(async () => {
    // Stop ALL workers created during this test (prevents leaked LISTEN clients)
    for (const worker of activeWorkers) {
      if (worker && worker.getState() !== WORKER_STATES.STOPPED) {
        await worker.stop();
      }
    }
    activeWorkers = [];
  });

  // ──────────────────────────────────────────────────────────────
  // Full Pipeline
  // ──────────────────────────────────────────────────────────────

  describe('full message processing pipeline', () => {
    test('enqueues, dequeues, processes, and marks completed', async () => {
      // Enqueue a message
      const enqueued = await messageQueue.enqueue('test-bot', createTestMessage(), 0);
      assert.equal(enqueued.status, MESSAGE_STATUSES.PENDING);
      assert.equal(enqueued.botId, 'test-bot');

      // Verify it's in the queue
      const depth = await messageQueue.getQueueDepth('test-bot');
      assert.equal(depth, 1);

      // Start worker
      await queueWorker.start();

      // Process the message
      const processed = await queueWorker.processNext('test-bot');
      assert.equal(processed, true);

      // Verify processor was called
      assert.equal(mockProcessor.processMessage.mock.callCount(), 1);

      // Verify message was marked completed
      const stats = await messageQueue.getStats('test-bot');
      assert.equal(stats.pending, 0);
      assert.equal(stats.completed, 1);
      assert.equal(stats.failed, 0);
    });

    test('processes multiple messages in order', async () => {
      // Enqueue 3 messages
      await messageQueue.enqueue('test-bot', createTestMessage({ text: 'Message 1' }), 0);
      await messageQueue.enqueue('test-bot', createTestMessage({ text: 'Message 2' }), 0);
      await messageQueue.enqueue('test-bot', createTestMessage({ text: 'Message 3' }), 0);

      const depth = await messageQueue.getQueueDepth('test-bot');
      assert.equal(depth, 3);

      await queueWorker.start();

      // Process all messages
      await queueWorker.processNext('test-bot');
      await queueWorker.processNext('test-bot');
      await queueWorker.processNext('test-bot');

      // Verify all processed
      assert.equal(mockProcessor.processMessage.mock.callCount(), 3);

      const stats = await messageQueue.getStats('test-bot');
      assert.equal(stats.completed, 3);
    });

    test('handles empty queue gracefully', async () => {
      await queueWorker.start();

      const processed = await queueWorker.processNext('test-bot');
      assert.equal(processed, false);

      // Processor should not have been called
      assert.equal(mockProcessor.processMessage.mock.callCount(), 0);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // LISTEN/NOTIFY
  // ──────────────────────────────────────────────────────────────

  describe('LISTEN/NOTIFY real-time processing', () => {
    test('automatically processes message on INSERT notification', async () => {
      await queueWorker.start();

      // Enqueue triggers NOTIFY via database trigger
      await messageQueue.enqueue('test-bot', createTestMessage(), 0);

      // Wait for notification to be processed (worker should dequeue automatically)
      await waitFor(
        async () => {
          const stats = await messageQueue.getStats('test-bot');
          return stats.completed > 0;
        },
        3000,
        100
      );

      // Verify message was processed
      const stats = await messageQueue.getStats('test-bot');
      assert.equal(stats.completed, 1);
      assert.equal(mockProcessor.processMessage.mock.callCount(), 1);
    });

    test('processes multiple rapid notifications', async () => {
      await queueWorker.start();

      // Enqueue multiple messages rapidly
      await Promise.all([
        messageQueue.enqueue('test-bot', createTestMessage({ text: 'Msg 1' }), 0),
        messageQueue.enqueue('test-bot', createTestMessage({ text: 'Msg 2' }), 0),
        messageQueue.enqueue('test-bot', createTestMessage({ text: 'Msg 3' }), 0),
      ]);

      // Wait for all to be processed
      await waitFor(
        async () => {
          const stats = await messageQueue.getStats('test-bot');
          return stats.completed >= 3;
        },
        5000,
        100
      );

      const stats = await messageQueue.getStats('test-bot');
      assert.equal(stats.completed, 3);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Concurrency Control
  // ──────────────────────────────────────────────────────────────

  describe('concurrency control', () => {
    test('respects bot concurrency limit', async () => {
      // Set low concurrency limit
      const strictController = new ConcurrencyController({ defaultMaxConcurrent: 1 });
      const strictWorker = new QueueWorker(messageQueue, mockProcessor, strictController, storage, {
        pollInterval: 5000,
      });
      activeWorkers.push(strictWorker);

      // Enqueue 3 messages
      await messageQueue.enqueue('test-bot', createTestMessage({ text: 'M1' }), 0);
      await messageQueue.enqueue('test-bot', createTestMessage({ text: 'M2' }), 0);
      await messageQueue.enqueue('test-bot', createTestMessage({ text: 'M3' }), 0);

      await strictWorker.start();

      // First processNext should succeed
      const first = await strictWorker.processNext('test-bot');
      assert.equal(first, true);

      // Second processNext should fail (concurrency limit reached)
      const second = await strictWorker.processNext('test-bot');
      assert.equal(second, false);

      await strictWorker.stop();
    });

    test('allows processing after concurrency slot is released', async () => {
      const strictController = new ConcurrencyController({ defaultMaxConcurrent: 1 });
      const strictWorker = new QueueWorker(messageQueue, mockProcessor, strictController, storage, {
        pollInterval: 5000,
      });
      activeWorkers.push(strictWorker);

      await messageQueue.enqueue('test-bot', createTestMessage({ text: 'M1' }), 0);
      await messageQueue.enqueue('test-bot', createTestMessage({ text: 'M2' }), 0);

      await strictWorker.start();

      // Process first message
      await strictWorker.processNext('test-bot');

      // Wait a moment for it to complete and release slot
      await new Promise(resolve => setTimeout(resolve, 50));

      // Now second should succeed
      const second = await strictWorker.processNext('test-bot');
      assert.equal(second, true);

      await strictWorker.stop();
    });

    test('different bots have independent concurrency', async () => {
      await messageQueue.enqueue('bot-a', createTestMessage({ text: 'A1' }), 0);
      await messageQueue.enqueue('bot-b', createTestMessage({ text: 'B1' }), 0);

      await queueWorker.start();

      // Both should succeed (different bots)
      const processA = await queueWorker.processNext('bot-a');
      const processB = await queueWorker.processNext('bot-b');

      assert.equal(processA, true);
      assert.equal(processB, true);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Retry Logic
  // ──────────────────────────────────────────────────────────────

  describe('retry logic', () => {
    test('retries failed message up to retry limit', async () => {
      // Create processor that always fails
      const failingProcessor = {
        processMessage: mock.fn(async () => {
          throw new Error('Processing failed');
        }),
      };

      const retryWorker = new QueueWorker(
        messageQueue,
        failingProcessor,
        concurrencyController,
        storage,
        {
          pollInterval: 5000,
          retryAttempts: 2,
          retryDelay: 100,
        }
      );
      activeWorkers.push(retryWorker);

      await messageQueue.enqueue('test-bot', createTestMessage(), 0);
      await retryWorker.start();

      // First attempt - fails, message reset to pending with next_attempt_at = now + 100ms
      await retryWorker.processNext('test-bot');

      // Wait for the first retry delay (100ms) to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      // Second attempt (retry 1) - fails, message reset with next_attempt_at = now + 200ms
      await retryWorker.processNext('test-bot');

      // Wait for the second retry delay (200ms) to expire
      await new Promise(resolve => setTimeout(resolve, 250));

      // Third attempt (retry 2 - exceeds retryAttempts, should mark failed)
      await retryWorker.processNext('test-bot');

      // The message should now be marked as failed immediately (no async delay)
      const stats = await messageQueue.getStats('test-bot');
      assert.equal(stats.failed, 1);

      await retryWorker.stop();
    });

    test('clears retry count on successful processing', async () => {
      let callCount = 0;
      const flakyProcessor = {
        processMessage: mock.fn(async () => {
          callCount++;
          if (callCount === 1) {
            throw new Error('First attempt fails');
          }
          return { text: 'Success on retry', toolCalls: [], usage: {}, sessionId: 'test' };
        }),
      };

      const retryWorker = new QueueWorker(
        messageQueue,
        flakyProcessor,
        concurrencyController,
        storage,
        {
          pollInterval: 5000,
          retryAttempts: 3,
          retryDelay: 100,
        }
      );
      activeWorkers.push(retryWorker);

      await messageQueue.enqueue('test-bot', createTestMessage(), 0);
      await retryWorker.start();

      // First attempt (fails) - message reset to pending with next_attempt_at = now + 100ms
      await retryWorker.processNext('test-bot');

      // Wait for retry delay to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      // Second attempt (succeeds)
      await retryWorker.processNext('test-bot');

      // Verify completed (markCompleted is synchronous in processNext, no waitFor needed)
      const stats = await messageQueue.getStats('test-bot');
      assert.equal(stats.completed, 1);
      assert.equal(stats.failed, 0);

      await retryWorker.stop();
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Queue Persistence
  // ──────────────────────────────────────────────────────────────

  describe('queue persistence', () => {
    test('pending messages survive worker restart', async () => {
      // Enqueue messages before starting the worker to avoid LISTEN/NOTIFY auto-processing
      await messageQueue.enqueue('test-bot', createTestMessage({ text: 'M1' }), 0);
      await messageQueue.enqueue('test-bot', createTestMessage({ text: 'M2' }), 0);

      // Start and stop worker without processing
      await queueWorker.start();
      await queueWorker.stop();

      // Verify messages still in queue
      const depth = await messageQueue.getQueueDepth('test-bot');
      assert.equal(depth, 2);

      // Create new worker and process
      const newWorker = new QueueWorker(
        messageQueue,
        mockProcessor,
        new ConcurrencyController({ defaultMaxConcurrent: 3 }),
        storage,
        { pollInterval: 5000 }
      );
      activeWorkers.push(newWorker);

      await newWorker.start();
      await newWorker.processNext('test-bot');
      await newWorker.processNext('test-bot');

      // Verify processed
      const stats = await messageQueue.getStats('test-bot');
      assert.equal(stats.completed, 2);

      await newWorker.stop();
    });

    test('completed messages are persisted in database', async () => {
      await messageQueue.enqueue('test-bot', createTestMessage(), 0);

      await queueWorker.start();
      await queueWorker.processNext('test-bot');

      // Query database directly
      const { rows } = await storage.query(
        'SELECT * FROM message_queue WHERE bot_id = $1 AND status = $2',
        ['test-bot', MESSAGE_STATUSES.COMPLETED]
      );

      assert.equal(rows.length, 1);
      assert.ok(rows[0].completed_at instanceof Date);
    });

    test('failed messages are persisted with error details', async () => {
      const failProcessor = {
        processMessage: mock.fn(async () => {
          throw new Error('Test error message');
        }),
      };

      const failWorker = new QueueWorker(
        messageQueue,
        failProcessor,
        concurrencyController,
        storage,
        {
          pollInterval: 5000,
          retryAttempts: 0, // No retries
        }
      );
      activeWorkers.push(failWorker);

      await messageQueue.enqueue('test-bot', createTestMessage(), 0);
      await failWorker.start();
      await failWorker.processNext('test-bot');

      // With retryAttempts: 0, markFailed is called synchronously in processNext
      const stats = await messageQueue.getStats('test-bot');
      assert.equal(stats.failed, 1);

      // Query database for error details
      const { rows } = await storage.query(
        'SELECT * FROM message_queue WHERE bot_id = $1 AND status = $2',
        ['test-bot', MESSAGE_STATUSES.FAILED]
      );

      assert.equal(rows.length, 1);
      assert.ok(rows[0].error.includes('Test error message'));

      await failWorker.stop();
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Priority Ordering
  // ──────────────────────────────────────────────────────────────

  describe('priority ordering', () => {
    test('processes high-priority messages first', async () => {
      // Enqueue in wrong order
      await messageQueue.enqueue('test-bot', createTestMessage({ text: 'Low' }), 0);
      await messageQueue.enqueue('test-bot', createTestMessage({ text: 'High' }), 10);
      await messageQueue.enqueue('test-bot', createTestMessage({ text: 'Medium' }), 5);

      await queueWorker.start();

      // Process all
      await queueWorker.processNext('test-bot');
      await queueWorker.processNext('test-bot');
      await queueWorker.processNext('test-bot');

      // Check call order - should be High (10), Medium (5), Low (0)
      const { calls } = mockProcessor.processMessage.mock;
      const messages = calls.map(call => call.arguments[1].text);

      assert.equal(messages[0], 'High');
      assert.equal(messages[1], 'Medium');
      assert.equal(messages[2], 'Low');
    });

    test('uses FIFO for messages with same priority', async () => {
      // Enqueue with same priority
      await messageQueue.enqueue('test-bot', createTestMessage({ text: 'First' }), 5);
      await messageQueue.enqueue('test-bot', createTestMessage({ text: 'Second' }), 5);
      await messageQueue.enqueue('test-bot', createTestMessage({ text: 'Third' }), 5);

      await queueWorker.start();

      await queueWorker.processNext('test-bot');
      await queueWorker.processNext('test-bot');
      await queueWorker.processNext('test-bot');

      const { calls } = mockProcessor.processMessage.mock;
      const messages = calls.map(call => call.arguments[1].text);

      assert.equal(messages[0], 'First');
      assert.equal(messages[1], 'Second');
      assert.equal(messages[2], 'Third');
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Clear Queue
  // ──────────────────────────────────────────────────────────────

  describe('clear queue', () => {
    test('clears all pending messages for a bot', async () => {
      await messageQueue.enqueue('test-bot', createTestMessage({ text: 'M1' }), 0);
      await messageQueue.enqueue('test-bot', createTestMessage({ text: 'M2' }), 0);
      await messageQueue.enqueue('test-bot', createTestMessage({ text: 'M3' }), 0);

      const cleared = await messageQueue.clearQueue('test-bot');
      assert.equal(cleared, 3);

      const depth = await messageQueue.getQueueDepth('test-bot');
      assert.equal(depth, 0);
    });

    test('does not clear messages from other bots', async () => {
      await messageQueue.enqueue('bot-a', createTestMessage({ text: 'A1' }), 0);
      await messageQueue.enqueue('bot-b', createTestMessage({ text: 'B1' }), 0);

      const cleared = await messageQueue.clearQueue('bot-a');
      assert.equal(cleared, 1);

      const depthA = await messageQueue.getQueueDepth('bot-a');
      const depthB = await messageQueue.getQueueDepth('bot-b');

      assert.equal(depthA, 0);
      assert.equal(depthB, 1);
    });

    test('does not clear processing messages', async () => {
      await messageQueue.enqueue('test-bot', createTestMessage(), 0);

      // Dequeue (status becomes processing) then process completes (status becomes completed)
      await queueWorker.start();
      await queueWorker.processNext('test-bot');

      // Try to clear - should find 0 pending messages to clear
      const cleared = await messageQueue.clearQueue('test-bot');
      assert.equal(cleared, 0);

      // Verify the message is still there (as completed since mock processor succeeds)
      const stats = await messageQueue.getStats('test-bot');
      assert.ok(stats.processing > 0 || stats.completed > 0);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Worker Lifecycle
  // ──────────────────────────────────────────────────────────────

  describe('worker lifecycle', () => {
    test('worker starts in stopped state', () => {
      const newWorker = new QueueWorker(
        messageQueue,
        mockProcessor,
        concurrencyController,
        storage
      );
      assert.equal(newWorker.getState(), WORKER_STATES.STOPPED);
    });

    test('worker transitions to running on start', async () => {
      await queueWorker.start();
      assert.equal(queueWorker.getState(), WORKER_STATES.RUNNING);
    });

    test('worker transitions to stopped on stop', async () => {
      await queueWorker.start();
      await queueWorker.stop();
      assert.equal(queueWorker.getState(), WORKER_STATES.STOPPED);
    });

    test('cannot start worker twice', async () => {
      await queueWorker.start();
      await assert.rejects(() => queueWorker.start(), {
        message: /already running/i,
      });
    });

    test('can restart worker after stop', async () => {
      await queueWorker.start();
      await queueWorker.stop();
      await queueWorker.start();
      assert.equal(queueWorker.getState(), WORKER_STATES.RUNNING);
    });
  });
});
