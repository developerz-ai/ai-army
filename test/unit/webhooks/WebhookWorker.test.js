/**
 * Unit tests for WebhookWorker
 *
 * Tests background webhook processing, LISTEN/NOTIFY setup,
 * fallback polling, batch processing, and lifecycle management.
 *
 * All database interactions and delivery calls are mocked.
 */

import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  WebhookWorker,
  WebhookWorkerError,
  WORKER_STATES,
} from '../../../src/webhooks/webhook-worker.js';
import { WEBHOOK_STATUSES } from '../../../src/webhooks/webhook-manager.js';

// ─── Mock Factories ──────────────────────────────────────────────

/**
 * Create a mock delivery manager
 * @param {Object} [overrides={}] - Override default implementations
 * @returns {Object} Mock delivery manager
 */
function createMockDeliveryManager(overrides = {}) {
  return {
    deliver: mock.fn(async () => ({
      status: WEBHOOK_STATUSES.SUCCESS,
      responseCode: 200,
      error: null,
    })),
    ...overrides,
  };
}

/**
 * Create a mock storage with a mock pool for LISTEN/NOTIFY
 * @param {Object} [overrides={}] - Override default implementations
 * @returns {Object} Mock storage object
 */
function createMockStorage(overrides = {}) {
  const mockClient = {
    query: mock.fn(async () => ({ rows: [], rowCount: 0 })),
    on: mock.fn(),
    release: mock.fn(),
    removeAllListeners: mock.fn(),
  };

  return {
    query: mock.fn(async () => ({ rows: [], rowCount: 0 })),
    transaction: mock.fn(async callback => {
      const txClient = {
        query: mock.fn(async () => ({ rows: [], rowCount: 0 })),
      };
      return callback(txClient);
    }),
    pool: {
      connect: mock.fn(async () => mockClient),
    },
    _mockClient: mockClient,
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
    payload: { event: 'message.sent' },
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

describe('WebhookWorker', () => {
  let worker;
  let mockDeliveryManager;
  let mockStorage;

  beforeEach(() => {
    mockDeliveryManager = createMockDeliveryManager();
    mockStorage = createMockStorage();
    worker = new WebhookWorker(mockDeliveryManager, mockStorage, {
      pollInterval: 60000, // Long interval to prevent auto-polling during tests
    });
  });

  afterEach(async () => {
    if (worker.getState() !== WORKER_STATES.STOPPED) {
      await worker.stop();
    }
  });

  describe('constructor', () => {
    test('creates instance with required dependencies', () => {
      const w = new WebhookWorker(mockDeliveryManager, mockStorage);
      assert.ok(w);
      assert.equal(w.getState(), WORKER_STATES.STOPPED);
    });

    test('throws when deliveryManager is missing', () => {
      assert.throws(() => new WebhookWorker(null, mockStorage), {
        name: 'WebhookWorkerError',
      });
    });

    test('throws when storage is missing', () => {
      assert.throws(() => new WebhookWorker(mockDeliveryManager, null), {
        name: 'WebhookWorkerError',
      });
    });

    test('accepts optional configuration', () => {
      const w = new WebhookWorker(mockDeliveryManager, mockStorage, {
        pollInterval: 10000,
        batchSize: 5,
        channel: 'custom_channel',
      });

      assert.equal(w.pollInterval, 10000);
      assert.equal(w.batchSize, 5);
      assert.equal(w.channel, 'custom_channel');
    });

    test('defaults pollInterval to 5000', () => {
      const w = new WebhookWorker(mockDeliveryManager, mockStorage);
      assert.equal(w.pollInterval, 5000);
    });

    test('defaults batchSize to 10', () => {
      const w = new WebhookWorker(mockDeliveryManager, mockStorage);
      assert.equal(w.batchSize, 10);
    });

    test('defaults channel to webhook_queue', () => {
      const w = new WebhookWorker(mockDeliveryManager, mockStorage);
      assert.equal(w.channel, 'webhook_queue');
    });

    test('throws on invalid channel name', () => {
      assert.throws(
        () =>
          new WebhookWorker(mockDeliveryManager, mockStorage, {
            channel: 'invalid-channel!',
          }),
        { name: 'WebhookWorkerError' }
      );
    });

    test('accepts optional logger', () => {
      const logger = mock.fn();
      const w = new WebhookWorker(mockDeliveryManager, mockStorage, { logger });
      assert.ok(w);
    });
  });

  describe('start()', () => {
    test('transitions to running state', async () => {
      await worker.start();
      assert.equal(worker.getState(), WORKER_STATES.RUNNING);
    });

    test('sets up LISTEN client', async () => {
      await worker.start();
      assert.equal(mockStorage.pool.connect.mock.callCount(), 1);
    });

    test('issues LISTEN command', async () => {
      await worker.start();
      const client = mockStorage._mockClient;
      const listenCall = client.query.mock.calls.find(call => call.arguments[0].includes('LISTEN'));
      assert.ok(listenCall);
      assert.ok(listenCall.arguments[0].includes('webhook_queue'));
    });

    test('throws when already running', async () => {
      await worker.start();
      await assert.rejects(() => worker.start(), {
        name: 'WebhookWorkerError',
      });
    });

    test('throws when pool is not available', async () => {
      const storageCopy = { ...mockStorage, pool: null };
      const w = new WebhookWorker(mockDeliveryManager, storageCopy);

      await assert.rejects(() => w.start(), {
        name: 'WebhookWorkerError',
      });
    });

    test('resets to stopped state on failure', async () => {
      const failStorage = createMockStorage();
      failStorage.pool.connect = mock.fn(async () => {
        throw new Error('Connection failed');
      });
      const w = new WebhookWorker(mockDeliveryManager, failStorage);

      await assert.rejects(() => w.start());
      assert.equal(w.getState(), WORKER_STATES.STOPPED);
    });
  });

  describe('stop()', () => {
    test('transitions to stopped state', async () => {
      await worker.start();
      await worker.stop();
      assert.equal(worker.getState(), WORKER_STATES.STOPPED);
    });

    test('releases LISTEN client', async () => {
      await worker.start();
      await worker.stop();

      const client = mockStorage._mockClient;
      assert.equal(client.release.mock.callCount(), 1);
    });

    test('issues UNLISTEN command', async () => {
      await worker.start();
      await worker.stop();

      const client = mockStorage._mockClient;
      const unlistenCall = client.query.mock.calls.find(call =>
        call.arguments[0].includes('UNLISTEN')
      );
      assert.ok(unlistenCall);
    });

    test('is idempotent when already stopped', async () => {
      await worker.stop(); // Should not throw
      assert.equal(worker.getState(), WORKER_STATES.STOPPED);
    });

    test('clears in-flight tracking', async () => {
      await worker.start();
      worker._inFlight.add(1);
      worker._inFlight.add(2);

      await worker.stop();
      assert.equal(worker._inFlight.size, 0);
    });
  });

  describe('processPending()', () => {
    test('returns 0 when not running', async () => {
      const count = await worker.processPending();
      assert.equal(count, 0);
    });

    test('returns 0 when no pending webhooks', async () => {
      await worker.start();

      mockStorage.transaction = mock.fn(async callback => {
        const txClient = {
          query: mock.fn(async () => ({ rows: [], rowCount: 0 })),
        };
        return callback(txClient);
      });

      const count = await worker.processPending();
      assert.equal(count, 0);
    });

    test('processes pending webhooks and returns count', async () => {
      await worker.start();

      const rows = [createMockWebhookRow({ id: 1 }), createMockWebhookRow({ id: 2 })];
      mockStorage.transaction = mock.fn(async callback => {
        const txClient = {
          query: mock.fn(async () => ({ rows, rowCount: 2 })),
        };
        return callback(txClient);
      });

      const count = await worker.processPending();
      assert.equal(count, 2);
      assert.equal(mockDeliveryManager.deliver.mock.callCount(), 2);
    });

    test('uses FOR UPDATE SKIP LOCKED query within a transaction', async () => {
      await worker.start();

      let capturedSql;
      mockStorage.transaction = mock.fn(async callback => {
        const txClient = {
          query: mock.fn(async (sql) => {
            capturedSql = sql;
            return { rows: [], rowCount: 0 };
          }),
        };
        return callback(txClient);
      });

      await worker.processPending();

      assert.ok(capturedSql.includes('FOR UPDATE SKIP LOCKED'));
    });

    test('filters by next_attempt_at for retry scheduling', async () => {
      await worker.start();

      let capturedSql;
      mockStorage.transaction = mock.fn(async callback => {
        const txClient = {
          query: mock.fn(async (sql) => {
            capturedSql = sql;
            return { rows: [], rowCount: 0 };
          }),
        };
        return callback(txClient);
      });

      await worker.processPending();

      assert.ok(capturedSql.includes('next_attempt_at'));
    });

    test('limits batch size', async () => {
      const w = new WebhookWorker(mockDeliveryManager, mockStorage, {
        pollInterval: 60000,
        batchSize: 5,
      });
      await w.start();

      let capturedParams;
      mockStorage.transaction = mock.fn(async callback => {
        const txClient = {
          query: mock.fn(async (_sql, params) => {
            capturedParams = params;
            return { rows: [], rowCount: 0 };
          }),
        };
        return callback(txClient);
      });

      await w.processPending();

      assert.equal(capturedParams[1], 5);
      await w.stop();
    });

    test('handles delivery errors gracefully', async () => {
      await worker.start();

      mockDeliveryManager.deliver = mock.fn(async () => {
        throw new Error('Delivery failed');
      });

      const rows = [createMockWebhookRow()];
      mockStorage.transaction = mock.fn(async callback => {
        const txClient = {
          query: mock.fn(async () => ({ rows, rowCount: 1 })),
        };
        return callback(txClient);
      });

      // Should not throw
      const count = await worker.processPending();
      assert.equal(count, 1);
    });
  });

  describe('processOne()', () => {
    test('delivers a single webhook by ID', async () => {
      await worker.start();

      const row = createMockWebhookRow({ id: 42 });
      mockStorage.query = mock.fn(async () => ({ rows: [row], rowCount: 1 }));

      const result = await worker.processOne(42);
      assert.equal(result, true);
      assert.equal(mockDeliveryManager.deliver.mock.callCount(), 1);
    });

    test('returns false when webhook not found', async () => {
      await worker.start();

      mockStorage.query = mock.fn(async () => ({ rows: [], rowCount: 0 }));

      const result = await worker.processOne(999);
      assert.equal(result, false);
    });

    test('skips webhooks already in flight', async () => {
      await worker.start();
      worker._inFlight.add(42);

      const result = await worker.processOne(42);
      assert.equal(result, false);
    });
  });

  describe('notification handling', () => {
    test('registers notification handler on LISTEN client', async () => {
      await worker.start();

      const client = mockStorage._mockClient;
      const notificationCall = client.on.mock.calls.find(
        call => call.arguments[0] === 'notification'
      );
      assert.ok(notificationCall);
    });

    test('handles valid notification payloads', async () => {
      await worker.start();

      // Get the notification handler
      const client = mockStorage._mockClient;
      const notificationCall = client.on.mock.calls.find(
        call => call.arguments[0] === 'notification'
      );
      const handler = notificationCall.arguments[1];

      // Set up for processOne
      const row = createMockWebhookRow({ id: 5 });
      mockStorage.query = mock.fn(async () => ({ rows: [row], rowCount: 1 }));

      handler({
        channel: 'webhook_queue',
        payload: JSON.stringify({ webhook_id: 5, bot_id: 'test-bot', event: 'message.sent' }),
      });

      // Allow setTimeout to fire
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should have attempted to deliver
      assert.ok(mockDeliveryManager.deliver.mock.callCount() > 0);
    });

    test('ignores notifications from other channels', async () => {
      await worker.start();

      const client = mockStorage._mockClient;
      const notificationCall = client.on.mock.calls.find(
        call => call.arguments[0] === 'notification'
      );
      const handler = notificationCall.arguments[1];

      handler({
        channel: 'other_channel',
        payload: JSON.stringify({ webhook_id: 5 }),
      });

      await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(mockDeliveryManager.deliver.mock.callCount(), 0);
    });

    test('handles invalid JSON payloads gracefully', async () => {
      await worker.start();

      const client = mockStorage._mockClient;
      const notificationCall = client.on.mock.calls.find(
        call => call.arguments[0] === 'notification'
      );
      const handler = notificationCall.arguments[1];

      // Should not throw
      handler({
        channel: 'webhook_queue',
        payload: 'not-json',
      });

      await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(mockDeliveryManager.deliver.mock.callCount(), 0);
    });
  });

  describe('WebhookWorkerError', () => {
    test('has correct name and message', () => {
      const err = new WebhookWorkerError('test error');
      assert.equal(err.name, 'WebhookWorkerError');
      assert.equal(err.message, 'test error');
    });

    test('preserves cause chain', () => {
      const cause = new Error('original');
      const err = new WebhookWorkerError('wrapped', { cause });
      assert.equal(err.cause, cause);
    });

    test('includes operation and context fields', () => {
      const err = new WebhookWorkerError('test', {
        operation: 'start',
        webhookId: 42,
      });

      assert.equal(err.operation, 'start');
      assert.equal(err.webhookId, 42);
    });
  });
});
