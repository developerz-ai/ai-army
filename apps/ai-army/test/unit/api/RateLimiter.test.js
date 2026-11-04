/**
 * Unit tests for RateLimiter
 *
 * Tests the sliding window rate limiter:
 * - Constructor validation
 * - Rate limit checking (isRateLimited)
 * - Request recording (recordRequest)
 * - Remaining count and reset timing
 * - 429 response sending
 * - checkRequest convenience method
 * - Bypass IPs
 * - Cleanup and destroy lifecycle
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter, RateLimiterError } from '../../../src/api/rate-limiter.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock HTTP response that captures output
 * @returns {{ res: Object, getResponse: () => { statusCode: number, headers: Object, body: Object }}}
 */
function createMockResponse() {
  let statusCode;
  let responseHeaders = {};
  const chunks = [];

  const res = {
    writeHead(code, hdrs) {
      statusCode = code;
      responseHeaders = hdrs;
    },
    end(data) {
      if (data) chunks.push(data);
    },
  };

  return {
    res,
    getResponse() {
      const raw = chunks.join('');
      return {
        statusCode,
        headers: responseHeaders,
        body: raw ? JSON.parse(raw) : null,
      };
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('RateLimiter', () => {
  /** @type {RateLimiter} */
  let limiter;

  afterEach(() => {
    if (limiter) {
      limiter.destroy();
      limiter = null;
    }
  });

  // ==========================================================================
  // Constructor
  // ==========================================================================

  describe('constructor', () => {
    test('creates instance with default options', () => {
      limiter = new RateLimiter();
      assert.equal(limiter.max, 100);
      assert.equal(limiter.windowMs, 60000);
      assert.equal(limiter.bypassIps.size, 0);
    });

    test('accepts custom max and windowMs', () => {
      limiter = new RateLimiter({ max: 50, windowMs: 30000 });
      assert.equal(limiter.max, 50);
      assert.equal(limiter.windowMs, 30000);
    });

    test('accepts bypass IPs', () => {
      limiter = new RateLimiter({ bypassIps: ['127.0.0.1', '::1'] });
      assert.equal(limiter.bypassIps.size, 2);
      assert.ok(limiter.bypassIps.has('127.0.0.1'));
      assert.ok(limiter.bypassIps.has('::1'));
    });

    test('throws on invalid max', () => {
      assert.throws(
        () => new RateLimiter({ max: 0 }),
        err => {
          assert.ok(err instanceof RateLimiterError);
          assert.ok(err.message.includes('max'));
          return true;
        }
      );
    });

    test('throws on negative max', () => {
      assert.throws(
        () => new RateLimiter({ max: -5 }),
        err => {
          assert.ok(err instanceof RateLimiterError);
          return true;
        }
      );
    });

    test('throws on invalid windowMs', () => {
      assert.throws(
        () => new RateLimiter({ windowMs: 0 }),
        err => {
          assert.ok(err instanceof RateLimiterError);
          assert.ok(err.message.includes('windowMs'));
          return true;
        }
      );
    });

    test('throws on non-numeric max', () => {
      assert.throws(
        () => new RateLimiter({ max: 'many' }),
        err => {
          assert.ok(err instanceof RateLimiterError);
          return true;
        }
      );
    });
  });

  // ==========================================================================
  // isRateLimited
  // ==========================================================================

  describe('isRateLimited', () => {
    beforeEach(() => {
      limiter = new RateLimiter({ max: 3, windowMs: 60000 });
    });

    test('returns false for new IP', () => {
      assert.equal(limiter.isRateLimited('1.2.3.4'), false);
    });

    test('returns false when under limit', () => {
      limiter.recordRequest('1.2.3.4');
      limiter.recordRequest('1.2.3.4');
      assert.equal(limiter.isRateLimited('1.2.3.4'), false);
    });

    test('returns true when at limit', () => {
      limiter.recordRequest('1.2.3.4');
      limiter.recordRequest('1.2.3.4');
      limiter.recordRequest('1.2.3.4');
      assert.equal(limiter.isRateLimited('1.2.3.4'), true);
    });

    test('returns true when over limit', () => {
      for (let i = 0; i < 5; i++) {
        limiter.recordRequest('1.2.3.4');
      }
      assert.equal(limiter.isRateLimited('1.2.3.4'), true);
    });

    test('tracks IPs independently', () => {
      limiter.recordRequest('1.2.3.4');
      limiter.recordRequest('1.2.3.4');
      limiter.recordRequest('1.2.3.4');

      assert.equal(limiter.isRateLimited('1.2.3.4'), true);
      assert.equal(limiter.isRateLimited('5.6.7.8'), false);
    });

    test('bypasses rate limiting for bypass IPs', () => {
      limiter = new RateLimiter({ max: 1, windowMs: 60000, bypassIps: ['127.0.0.1'] });
      limiter.recordRequest('127.0.0.1');
      limiter.recordRequest('127.0.0.1');
      limiter.recordRequest('127.0.0.1');
      assert.equal(limiter.isRateLimited('127.0.0.1'), false);
    });

    test('does not bypass non-bypass IPs', () => {
      limiter = new RateLimiter({ max: 1, windowMs: 60000, bypassIps: ['127.0.0.1'] });
      limiter.recordRequest('1.2.3.4');
      assert.equal(limiter.isRateLimited('1.2.3.4'), true);
    });
  });

  // ==========================================================================
  // getRemaining
  // ==========================================================================

  describe('getRemaining', () => {
    beforeEach(() => {
      limiter = new RateLimiter({ max: 5, windowMs: 60000 });
    });

    test('returns max for new IP', () => {
      assert.equal(limiter.getRemaining('1.2.3.4'), 5);
    });

    test('returns remaining after requests', () => {
      limiter.recordRequest('1.2.3.4');
      limiter.recordRequest('1.2.3.4');
      assert.equal(limiter.getRemaining('1.2.3.4'), 3);
    });

    test('returns 0 when at limit', () => {
      for (let i = 0; i < 5; i++) {
        limiter.recordRequest('1.2.3.4');
      }
      assert.equal(limiter.getRemaining('1.2.3.4'), 0);
    });

    test('returns 0 when over limit', () => {
      for (let i = 0; i < 10; i++) {
        limiter.recordRequest('1.2.3.4');
      }
      assert.equal(limiter.getRemaining('1.2.3.4'), 0);
    });
  });

  // ==========================================================================
  // getResetMs
  // ==========================================================================

  describe('getResetMs', () => {
    test('returns 0 for new IP', () => {
      limiter = new RateLimiter({ max: 5, windowMs: 60000 });
      assert.equal(limiter.getResetMs('1.2.3.4'), 0);
    });

    test('returns positive value for active IP', () => {
      limiter = new RateLimiter({ max: 5, windowMs: 60000 });
      limiter.recordRequest('1.2.3.4');
      const resetMs = limiter.getResetMs('1.2.3.4');
      assert.ok(resetMs > 0);
      assert.ok(resetMs <= 60000);
    });
  });

  // ==========================================================================
  // sendLimited
  // ==========================================================================

  describe('sendLimited', () => {
    test('sends 429 response', () => {
      limiter = new RateLimiter({ max: 5, windowMs: 60000 });
      const { res, getResponse } = createMockResponse();

      limiter.sendLimited(res);
      const response = getResponse();

      assert.equal(response.statusCode, 429);
      assert.equal(response.body.error, 'Too Many Requests');
      assert.ok(response.body.message.includes('Rate limit exceeded'));
    });

    test('includes rate limit headers', () => {
      limiter = new RateLimiter({ max: 5, windowMs: 60000 });
      const { res, getResponse } = createMockResponse();

      limiter.sendLimited(res);
      const response = getResponse();

      assert.equal(response.headers['Content-Type'], 'application/json');
      assert.ok(response.headers['Retry-After']);
      assert.equal(response.headers['X-RateLimit-Limit'], '5');
      assert.equal(response.headers['X-RateLimit-Remaining'], '0');
    });

    test('includes Retry-After computed from IP', () => {
      limiter = new RateLimiter({ max: 1, windowMs: 30000 });
      limiter.recordRequest('1.2.3.4');
      const { res, getResponse } = createMockResponse();

      limiter.sendLimited(res, '1.2.3.4');
      const response = getResponse();

      const retryAfter = parseInt(response.headers['Retry-After'], 10);
      assert.ok(retryAfter > 0);
      assert.ok(retryAfter <= 30);
    });
  });

  // ==========================================================================
  // checkRequest
  // ==========================================================================

  describe('checkRequest', () => {
    test('returns true and records when under limit', () => {
      limiter = new RateLimiter({ max: 3, windowMs: 60000 });
      const { res } = createMockResponse();

      const allowed = limiter.checkRequest('1.2.3.4', res);

      assert.equal(allowed, true);
      assert.equal(limiter.requests.get('1.2.3.4').length, 1);
    });

    test('returns false and sends 429 when at limit', () => {
      limiter = new RateLimiter({ max: 2, windowMs: 60000 });

      limiter.recordRequest('1.2.3.4');
      limiter.recordRequest('1.2.3.4');

      const { res, getResponse } = createMockResponse();
      const allowed = limiter.checkRequest('1.2.3.4', res);

      assert.equal(allowed, false);
      const response = getResponse();
      assert.equal(response.statusCode, 429);
    });
  });

  // ==========================================================================
  // reset
  // ==========================================================================

  describe('reset', () => {
    test('clears all tracked requests', () => {
      limiter = new RateLimiter({ max: 5, windowMs: 60000 });
      limiter.recordRequest('1.2.3.4');
      limiter.recordRequest('5.6.7.8');

      assert.equal(limiter.requests.size, 2);

      limiter.reset();
      assert.equal(limiter.requests.size, 0);
    });
  });

  // ==========================================================================
  // destroy
  // ==========================================================================

  describe('destroy', () => {
    test('clears requests and stops cleanup timer', () => {
      limiter = new RateLimiter({ max: 5, windowMs: 60000 });
      limiter.recordRequest('1.2.3.4');

      limiter.destroy();

      assert.equal(limiter.requests.size, 0);
      assert.equal(limiter._cleanupTimer, null);
      // Prevent double-destroy in afterEach
      limiter = null;
    });
  });

  // ==========================================================================
  // RateLimiterError
  // ==========================================================================

  describe('RateLimiterError', () => {
    test('has correct name', () => {
      const err = new RateLimiterError('test');
      assert.equal(err.name, 'RateLimiterError');
    });

    test('extends Error', () => {
      const err = new RateLimiterError('test');
      assert.ok(err instanceof Error);
    });

    test('stores cause', () => {
      const cause = new Error('original');
      const err = new RateLimiterError('wrapper', { cause });
      assert.equal(err.cause, cause);
    });

    test('stores ip', () => {
      const err = new RateLimiterError('test', { ip: '1.2.3.4' });
      assert.equal(err.ip, '1.2.3.4');
    });

    test('has correct message', () => {
      const err = new RateLimiterError('limit exceeded');
      assert.equal(err.message, 'limit exceeded');
    });
  });
});
