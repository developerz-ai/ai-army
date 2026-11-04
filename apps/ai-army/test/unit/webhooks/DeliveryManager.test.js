/**
 * Unit tests for DeliveryManager
 *
 * Tests HTTP webhook delivery, exponential backoff retry,
 * timeout handling, response logging, and error handling.
 *
 * All HTTP requests and database interactions are mocked.
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { DeliveryManager, DeliveryError } from '../../../src/webhooks/delivery-manager.js';
import { WEBHOOK_STATUSES } from '../../../src/webhooks/webhook-manager.js';

// ─── Mock Factories ──────────────────────────────────────────────

/**
 * Create a mock storage object for testing
 * @param {Object} [overrides={}] - Override default mock implementations
 * @returns {Object} Mock storage object
 */
function createMockStorage(overrides = {}) {
  return {
    query: mock.fn(async () => ({ rows: [], rowCount: 0 })),
    ...overrides,
  };
}

/**
 * Create a mock fetch function that returns a successful response
 * @param {Object} [options={}] - Override response options
 * @returns {Function} Mock fetch function
 */
function createMockFetch(options = {}) {
  const { status = 200, body = '{"ok":true}', shouldThrow = false, throwError = null } = options;

  return mock.fn(async () => {
    if (shouldThrow) {
      throw throwError || new Error('Network error');
    }
    return {
      status,
      ok: status >= 200 && status < 300,
      text: async () => body,
    };
  });
}

/**
 * Create a test webhook delivery record
 * @param {Object} [overrides={}] - Override default values
 * @returns {Object} Test webhook record
 */
function createTestWebhook(overrides = {}) {
  return {
    id: 1,
    botId: 'test-bot',
    event: 'message.sent',
    url: 'https://api.example.com/webhook',
    method: 'POST',
    headers: {},
    payload: { event: 'message.sent', bot: { id: 'test-bot' } },
    attempts: 0,
    maxAttempts: 3,
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('DeliveryManager', () => {
  let deliveryManager;
  let mockStorage;
  let mockFetch;

  beforeEach(() => {
    mockStorage = createMockStorage();
    mockFetch = createMockFetch();
    deliveryManager = new DeliveryManager(mockStorage, { fetchFn: mockFetch });
  });

  describe('constructor', () => {
    test('creates instance with storage', () => {
      const dm = new DeliveryManager(mockStorage);
      assert.ok(dm);
    });

    test('throws when storage is missing', () => {
      assert.throws(() => new DeliveryManager(null), {
        name: 'DeliveryError',
      });
    });

    test('accepts optional logger', () => {
      const logger = mock.fn();
      const dm = new DeliveryManager(mockStorage, { logger });
      assert.ok(dm);
    });

    test('accepts custom timeout', () => {
      const dm = new DeliveryManager(mockStorage, { timeout: 10000 });
      assert.equal(dm.timeout, 10000);
    });

    test('defaults timeout to 5000', () => {
      const dm = new DeliveryManager(mockStorage);
      assert.equal(dm.timeout, 5000);
    });

    test('accepts custom fetch function', () => {
      const customFetch = mock.fn();
      const dm = new DeliveryManager(mockStorage, { fetchFn: customFetch });
      assert.equal(dm.fetchFn, customFetch);
    });
  });

  describe('deliver()', () => {
    test('delivers webhook successfully on 200 response', async () => {
      const webhook = createTestWebhook();
      const result = await deliveryManager.deliver(webhook);

      assert.equal(result.status, WEBHOOK_STATUSES.SUCCESS);
      assert.equal(result.responseCode, 200);
      assert.equal(result.error, null);
    });

    test('calls fetch with correct parameters', async () => {
      const webhook = createTestWebhook({
        method: 'PUT',
        headers: { Authorization: 'Bearer token' },
        payload: { test: true },
      });

      await deliveryManager.deliver(webhook);

      assert.equal(mockFetch.mock.callCount(), 1);
      const [url, options] = mockFetch.mock.calls[0].arguments;
      assert.equal(url, 'https://api.example.com/webhook');
      assert.equal(options.method, 'PUT');
      assert.equal(options.headers['Content-Type'], 'application/json');
      assert.equal(options.headers.Authorization, 'Bearer token');
      assert.equal(options.body, JSON.stringify({ test: true }));
    });

    test('marks webhook as sending before delivery', async () => {
      const webhook = createTestWebhook();
      await deliveryManager.deliver(webhook);

      // First query should be the status update to 'sending'
      const [sql, params] = mockStorage.query.mock.calls[0].arguments;
      assert.ok(sql.includes('UPDATE webhooks'));
      assert.equal(params[0], WEBHOOK_STATUSES.SENDING);
    });

    test('marks webhook as success on 2xx response', async () => {
      mockFetch = createMockFetch({ status: 201 });
      deliveryManager = new DeliveryManager(mockStorage, { fetchFn: mockFetch });

      const webhook = createTestWebhook();
      const result = await deliveryManager.deliver(webhook);

      assert.equal(result.status, WEBHOOK_STATUSES.SUCCESS);
      assert.equal(result.responseCode, 201);
    });

    test('schedules retry on 4xx response when attempts remain', async () => {
      mockFetch = createMockFetch({ status: 400, body: 'Bad Request' });
      deliveryManager = new DeliveryManager(mockStorage, { fetchFn: mockFetch });

      const webhook = createTestWebhook({ attempts: 0, maxAttempts: 3 });
      const result = await deliveryManager.deliver(webhook);

      assert.equal(result.status, WEBHOOK_STATUSES.PENDING);
      assert.equal(result.responseCode, 400);
      assert.equal(result.error, 'HTTP 400');
      assert.ok(result.retryIn > 0);
    });

    test('persists next_attempt_at when scheduling retry', async () => {
      mockFetch = createMockFetch({ status: 500, body: 'Server Error' });
      deliveryManager = new DeliveryManager(mockStorage, { fetchFn: mockFetch });

      const webhook = createTestWebhook({ attempts: 0, maxAttempts: 3 });
      await deliveryManager.deliver(webhook);

      // The retry update is the second query call (first is 'sending')
      const retryCall = mockStorage.query.mock.calls[1];
      const params = retryCall.arguments[1];
      // params[5] is next_attempt_at (Date), params[6] is webhookId
      assert.ok(params[5] instanceof Date, 'next_attempt_at should be a Date');
      assert.ok(params[5].getTime() > Date.now() - 1000, 'next_attempt_at should be in the future');
    });

    test('marks as failed on 5xx when max attempts exhausted', async () => {
      mockFetch = createMockFetch({ status: 500, body: 'Server Error' });
      deliveryManager = new DeliveryManager(mockStorage, { fetchFn: mockFetch });

      const webhook = createTestWebhook({ attempts: 2, maxAttempts: 3 });
      const result = await deliveryManager.deliver(webhook);

      assert.equal(result.status, WEBHOOK_STATUSES.FAILED);
      assert.equal(result.responseCode, 500);
      assert.equal(result.error, 'HTTP 500');
    });

    test('handles network errors with retry', async () => {
      mockFetch = createMockFetch({ shouldThrow: true });
      deliveryManager = new DeliveryManager(mockStorage, { fetchFn: mockFetch });

      const webhook = createTestWebhook({ attempts: 0, maxAttempts: 3 });
      const result = await deliveryManager.deliver(webhook);

      assert.equal(result.status, WEBHOOK_STATUSES.PENDING);
      assert.equal(result.error, 'Network error');
    });

    test('handles timeout errors', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      mockFetch = createMockFetch({ shouldThrow: true, throwError: abortError });
      deliveryManager = new DeliveryManager(mockStorage, { fetchFn: mockFetch });

      const webhook = createTestWebhook({ attempts: 0, maxAttempts: 3 });
      const result = await deliveryManager.deliver(webhook);

      assert.equal(result.status, WEBHOOK_STATUSES.PENDING);
      assert.equal(result.error, 'Request timeout');
    });

    test('marks as permanently failed on network error when exhausted', async () => {
      mockFetch = createMockFetch({ shouldThrow: true });
      deliveryManager = new DeliveryManager(mockStorage, { fetchFn: mockFetch });

      const webhook = createTestWebhook({ attempts: 2, maxAttempts: 3 });
      const result = await deliveryManager.deliver(webhook);

      assert.equal(result.status, WEBHOOK_STATUSES.FAILED);
      assert.equal(result.error, 'Network error');
    });

    test('increments attempt count on delivery', async () => {
      const webhook = createTestWebhook({ attempts: 1 });
      await deliveryManager.deliver(webhook);

      // Check the 'sending' update includes the incremented attempt
      const [, params] = mockStorage.query.mock.calls[0].arguments;
      assert.equal(params[1], 2); // attempts: 1 + 1
    });
  });

  describe('calculateBackoff()', () => {
    test('returns exponential backoff delays', () => {
      assert.equal(deliveryManager.calculateBackoff(1), 1000);
      assert.equal(deliveryManager.calculateBackoff(2), 2000);
      assert.equal(deliveryManager.calculateBackoff(3), 4000);
      assert.equal(deliveryManager.calculateBackoff(4), 8000);
    });

    test('caps at maxBackoffDelay', () => {
      const dm = new DeliveryManager(mockStorage, {
        fetchFn: mockFetch,
        maxBackoffDelay: 10000,
        baseBackoffDelay: 1000,
      });

      assert.equal(dm.calculateBackoff(10), 10000);
    });

    test('uses custom baseBackoffDelay', () => {
      const dm = new DeliveryManager(mockStorage, {
        fetchFn: mockFetch,
        baseBackoffDelay: 500,
      });

      assert.equal(dm.calculateBackoff(1), 500);
      assert.equal(dm.calculateBackoff(2), 1000);
      assert.equal(dm.calculateBackoff(3), 2000);
    });
  });

  describe('response body truncation', () => {
    test('truncates long response bodies', async () => {
      const longBody = 'x'.repeat(5000);
      mockFetch = createMockFetch({ status: 200, body: longBody });
      deliveryManager = new DeliveryManager(mockStorage, { fetchFn: mockFetch });

      const webhook = createTestWebhook();
      await deliveryManager.deliver(webhook);

      // Check the success update includes truncated body
      const successCall = mockStorage.query.mock.calls[1]; // second call is the success update
      const responseBody = successCall.arguments[1][3]; // params[3] is response_body
      assert.ok(responseBody.length < longBody.length);
      assert.ok(responseBody.includes('[truncated]'));
    });

    test('does not truncate short response bodies', async () => {
      const shortBody = '{"ok":true}';
      mockFetch = createMockFetch({ status: 200, body: shortBody });
      deliveryManager = new DeliveryManager(mockStorage, { fetchFn: mockFetch });

      const webhook = createTestWebhook();
      await deliveryManager.deliver(webhook);

      const successCall = mockStorage.query.mock.calls[1];
      const responseBody = successCall.arguments[1][3];
      assert.equal(responseBody, shortBody);
    });
  });

  describe('DeliveryError', () => {
    test('has correct name and message', () => {
      const err = new DeliveryError('test error');
      assert.equal(err.name, 'DeliveryError');
      assert.equal(err.message, 'test error');
    });

    test('preserves cause chain', () => {
      const cause = new Error('original');
      const err = new DeliveryError('wrapped', { cause });
      assert.equal(err.cause, cause);
    });

    test('includes operation and context fields', () => {
      const err = new DeliveryError('test', {
        operation: 'deliver',
        webhookId: 42,
        statusCode: 500,
      });

      assert.equal(err.operation, 'deliver');
      assert.equal(err.webhookId, 42);
      assert.equal(err.statusCode, 500);
    });
  });
});
