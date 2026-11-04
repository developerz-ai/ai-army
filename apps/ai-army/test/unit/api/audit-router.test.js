/**
 * Unit tests for AuditRouter
 *
 * Tests the audit API endpoints:
 * - GET /api/audit        → Query audit logs with filters and pagination
 * - GET /api/audit/export → Export audit logs in CSV or JSON format
 * - GET /api/audit/stats  → Audit statistics aggregated from the database
 *
 * Also covers:
 * - Authentication via Bearer token
 * - Query parameter parsing
 * - Error handling
 * - Route matching (only handles GET /api/audit*)
 * - Constructor validation
 * - CSV and JSON response formats
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { AuditRouter, AuditRouterError } from '../../../src/api/routers/audit-router.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock AuditLogger instance
 * @param {Object} [overrides={}] - Override default mock responses
 * @returns {Object} Mock AuditLogger
 */
function createMockAuditLogger(overrides = {}) {
  return {
    query: mock.fn(async () => overrides.queryResult || []),
    exportLogs: mock.fn(async () => overrides.exportResult || '[]'),
    storage: {
      query: mock.fn(async () => overrides.storageResult || { rows: [], rowCount: 0 }),
    },
  };
}

/**
 * Create a mock HTTP request
 * @param {Object} options - Request options
 * @returns {Object} Mock request
 */
function createMockRequest({ method = 'GET', url = '/', headers = {} } = {}) {
  return {
    method,
    url,
    headers: {
      host: 'localhost:3000',
      ...headers,
    },
  };
}

/**
 * Create a mock HTTP response that captures output
 * @returns {{ res: Object, getResponse: () => { statusCode: number, headers: Object, body: *, raw: string }}}
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
      const isJson = responseHeaders['Content-Type'] === 'application/json';
      return {
        statusCode,
        headers: responseHeaders,
        body: isJson && raw ? JSON.parse(raw) : raw || null,
        raw,
      };
    },
  };
}

/**
 * Create a sample audit log entry
 * @param {Object} [overrides={}] - Override default fields
 * @returns {Object} Audit log entry
 */
function createSampleLogEntry(overrides = {}) {
  return {
    id: 1,
    event_type: 'bot.started',
    actor: 'admin-user',
    actor_type: 'user',
    resource_type: 'bot',
    resource_id: 'work-bot',
    action: 'started',
    metadata: { previousStatus: 'stopped' },
    ip_address: '192.168.1.100',
    user_agent: 'Mozilla/5.0',
    timestamp: '2026-02-06T10:30:00.000Z',
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('AuditRouter', () => {
  /** @type {Object} */
  let mockAuditLogger;
  /** @type {AuditRouter} */
  let router;

  beforeEach(() => {
    mockAuditLogger = createMockAuditLogger();
    router = new AuditRouter({ auditLogger: mockAuditLogger });
  });

  // --------------------------------------------------------------------------
  // Constructor
  // --------------------------------------------------------------------------

  describe('constructor', () => {
    test('creates instance with required options', () => {
      const r = new AuditRouter({ auditLogger: mockAuditLogger });
      assert.ok(r);
      assert.strictEqual(r.auditLogger, mockAuditLogger);
      assert.strictEqual(r.apiKey, null);
      assert.strictEqual(r.logger, null);
    });

    test('throws when auditLogger is missing', () => {
      assert.throws(() => new AuditRouter(), {
        name: 'AuditRouterError',
        message: /AuditLogger is required/,
      });
    });

    test('throws when auditLogger is missing (empty options)', () => {
      assert.throws(() => new AuditRouter({}), {
        name: 'AuditRouterError',
      });
    });

    test('stores apiKey when provided', () => {
      const r = new AuditRouter({ auditLogger: mockAuditLogger, apiKey: 'test-key' });
      assert.strictEqual(r.apiKey, 'test-key');
    });

    test('stores logger when provided', () => {
      const logger = mock.fn();
      const r = new AuditRouter({ auditLogger: mockAuditLogger, logger });
      assert.strictEqual(r.logger, logger);
    });
  });

  // --------------------------------------------------------------------------
  // AuditRouterError
  // --------------------------------------------------------------------------

  describe('AuditRouterError', () => {
    test('sets name to AuditRouterError', () => {
      const err = new AuditRouterError('test');
      assert.strictEqual(err.name, 'AuditRouterError');
    });

    test('stores endpoint option', () => {
      const err = new AuditRouterError('test', { endpoint: '/api/audit' });
      assert.strictEqual(err.endpoint, '/api/audit');
    });

    test('stores statusCode option', () => {
      const err = new AuditRouterError('test', { statusCode: 500 });
      assert.strictEqual(err.statusCode, 500);
    });

    test('stores cause option', () => {
      const cause = new Error('original');
      const err = new AuditRouterError('test', { cause });
      assert.strictEqual(err.cause, cause);
    });
  });

  // --------------------------------------------------------------------------
  // Route matching
  // --------------------------------------------------------------------------

  describe('handleRequest - route matching', () => {
    test('returns false for non-matching paths', async () => {
      const req = createMockRequest({ url: '/api/admin/status' });
      const { res } = createMockResponse();
      const handled = await router.handleRequest(req, res);
      assert.strictEqual(handled, false);
    });

    test('returns false for POST method', async () => {
      const req = createMockRequest({ method: 'POST', url: '/api/audit' });
      const { res } = createMockResponse();
      const handled = await router.handleRequest(req, res);
      assert.strictEqual(handled, false);
    });

    test('returns false for PUT method', async () => {
      const req = createMockRequest({ method: 'PUT', url: '/api/audit' });
      const { res } = createMockResponse();
      const handled = await router.handleRequest(req, res);
      assert.strictEqual(handled, false);
    });

    test('returns false for empty method', async () => {
      const req = createMockRequest({ method: '', url: '/api/audit' });
      const { res } = createMockResponse();
      const handled = await router.handleRequest(req, res);
      assert.strictEqual(handled, false);
    });

    test('returns false for /api/audit/unknown path', async () => {
      const req = createMockRequest({ url: '/api/audit/unknown' });
      const { res } = createMockResponse();
      const handled = await router.handleRequest(req, res);
      assert.strictEqual(handled, false);
    });

    test('handles GET /api/audit', async () => {
      const req = createMockRequest({ url: '/api/audit' });
      const { res } = createMockResponse();
      const handled = await router.handleRequest(req, res);
      assert.strictEqual(handled, true);
    });

    test('handles GET /api/audit/export', async () => {
      const req = createMockRequest({
        url: '/api/audit/export?startDate=2026-01-01&endDate=2026-02-01',
      });
      const { res } = createMockResponse();
      const handled = await router.handleRequest(req, res);
      assert.strictEqual(handled, true);
    });

    test('handles GET /api/audit/stats', async () => {
      mockAuditLogger.storage.query = mock.fn(async () => ({
        rows: [{ total: 0 }],
        rowCount: 1,
      }));
      const req = createMockRequest({ url: '/api/audit/stats' });
      const { res } = createMockResponse();
      const handled = await router.handleRequest(req, res);
      assert.strictEqual(handled, true);
    });
  });

  // --------------------------------------------------------------------------
  // Authentication
  // --------------------------------------------------------------------------

  describe('authentication', () => {
    test('allows requests when no apiKey is configured', async () => {
      const req = createMockRequest({ url: '/api/audit' });
      const { res, getResponse } = createMockResponse();
      await router.handleRequest(req, res);
      const response = getResponse();
      assert.strictEqual(response.statusCode, 200);
    });

    test('returns 401 when apiKey is configured but no auth header', async () => {
      const authedRouter = new AuditRouter({
        auditLogger: mockAuditLogger,
        apiKey: 'secret-key',
      });
      const req = createMockRequest({ url: '/api/audit' });
      const { res, getResponse } = createMockResponse();
      await authedRouter.handleRequest(req, res);
      const response = getResponse();
      assert.strictEqual(response.statusCode, 401);
      assert.strictEqual(response.body.error, 'Unauthorized');
    });

    test('returns 401 when apiKey does not match', async () => {
      const authedRouter = new AuditRouter({
        auditLogger: mockAuditLogger,
        apiKey: 'secret-key',
      });
      const req = createMockRequest({
        url: '/api/audit',
        headers: { authorization: 'Bearer wrong-key' },
      });
      const { res, getResponse } = createMockResponse();
      await authedRouter.handleRequest(req, res);
      const response = getResponse();
      assert.strictEqual(response.statusCode, 401);
    });

    test('returns 401 for malformed auth header', async () => {
      const authedRouter = new AuditRouter({
        auditLogger: mockAuditLogger,
        apiKey: 'secret-key',
      });
      const req = createMockRequest({
        url: '/api/audit',
        headers: { authorization: 'Basic secret-key' },
      });
      const { res, getResponse } = createMockResponse();
      await authedRouter.handleRequest(req, res);
      const response = getResponse();
      assert.strictEqual(response.statusCode, 401);
    });

    test('allows requests with valid Bearer token', async () => {
      const authedRouter = new AuditRouter({
        auditLogger: mockAuditLogger,
        apiKey: 'secret-key',
      });
      const req = createMockRequest({
        url: '/api/audit',
        headers: { authorization: 'Bearer secret-key' },
      });
      const { res, getResponse } = createMockResponse();
      await authedRouter.handleRequest(req, res);
      const response = getResponse();
      assert.strictEqual(response.statusCode, 200);
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/audit
  // --------------------------------------------------------------------------

  describe('GET /api/audit', () => {
    test('returns 200 with empty data when no logs', async () => {
      const req = createMockRequest({ url: '/api/audit' });
      const { res, getResponse } = createMockResponse();
      await router.handleRequest(req, res);
      const response = getResponse();
      assert.strictEqual(response.statusCode, 200);
      assert.deepStrictEqual(response.body.data, []);
      assert.strictEqual(response.body.count, 0);
    });

    test('returns data from auditLogger.query()', async () => {
      const entries = [createSampleLogEntry(), createSampleLogEntry({ id: 2, actor: 'user2' })];
      mockAuditLogger.query = mock.fn(async () => entries);

      const req = createMockRequest({ url: '/api/audit' });
      const { res, getResponse } = createMockResponse();
      await router.handleRequest(req, res);
      const response = getResponse();
      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(response.body.count, 2);
      assert.deepStrictEqual(response.body.data, entries);
    });

    test('passes actor filter to auditLogger.query()', async () => {
      const req = createMockRequest({ url: '/api/audit?actor=admin-user' });
      const { res } = createMockResponse();
      await router.handleRequest(req, res);
      const callArgs = mockAuditLogger.query.mock.calls[0].arguments[0];
      assert.strictEqual(callArgs.actor, 'admin-user');
    });

    test('passes actorType filter', async () => {
      const req = createMockRequest({ url: '/api/audit?actorType=system' });
      const { res } = createMockResponse();
      await router.handleRequest(req, res);
      const callArgs = mockAuditLogger.query.mock.calls[0].arguments[0];
      assert.strictEqual(callArgs.actorType, 'system');
    });

    test('passes resourceType filter', async () => {
      const req = createMockRequest({ url: '/api/audit?resourceType=bot' });
      const { res } = createMockResponse();
      await router.handleRequest(req, res);
      const callArgs = mockAuditLogger.query.mock.calls[0].arguments[0];
      assert.strictEqual(callArgs.resourceType, 'bot');
    });

    test('passes resourceId filter', async () => {
      const req = createMockRequest({ url: '/api/audit?resourceId=work-bot' });
      const { res } = createMockResponse();
      await router.handleRequest(req, res);
      const callArgs = mockAuditLogger.query.mock.calls[0].arguments[0];
      assert.strictEqual(callArgs.resourceId, 'work-bot');
    });

    test('passes action filter', async () => {
      const req = createMockRequest({ url: '/api/audit?action=started' });
      const { res } = createMockResponse();
      await router.handleRequest(req, res);
      const callArgs = mockAuditLogger.query.mock.calls[0].arguments[0];
      assert.strictEqual(callArgs.action, 'started');
    });

    test('parses comma-separated eventTypes', async () => {
      const req = createMockRequest({
        url: '/api/audit?eventTypes=bot.started,bot.stopped',
      });
      const { res } = createMockResponse();
      await router.handleRequest(req, res);
      const callArgs = mockAuditLogger.query.mock.calls[0].arguments[0];
      assert.deepStrictEqual(callArgs.eventTypes, ['bot.started', 'bot.stopped']);
    });

    test('passes startDate and endDate', async () => {
      const req = createMockRequest({
        url: '/api/audit?startDate=2026-01-01&endDate=2026-02-01',
      });
      const { res } = createMockResponse();
      await router.handleRequest(req, res);
      const callArgs = mockAuditLogger.query.mock.calls[0].arguments[0];
      assert.strictEqual(callArgs.startDate, '2026-01-01');
      assert.strictEqual(callArgs.endDate, '2026-02-01');
    });

    test('parses limit and offset as integers', async () => {
      const req = createMockRequest({ url: '/api/audit?limit=50&offset=10' });
      const { res } = createMockResponse();
      await router.handleRequest(req, res);
      const callArgs = mockAuditLogger.query.mock.calls[0].arguments[0];
      assert.strictEqual(callArgs.limit, 50);
      assert.strictEqual(callArgs.offset, 10);
    });

    test('ignores invalid limit values', async () => {
      const req = createMockRequest({ url: '/api/audit?limit=abc' });
      const { res } = createMockResponse();
      await router.handleRequest(req, res);
      const callArgs = mockAuditLogger.query.mock.calls[0].arguments[0];
      assert.strictEqual(callArgs.limit, undefined);
    });

    test('ignores negative limit', async () => {
      const req = createMockRequest({ url: '/api/audit?limit=-5' });
      const { res } = createMockResponse();
      await router.handleRequest(req, res);
      const callArgs = mockAuditLogger.query.mock.calls[0].arguments[0];
      assert.strictEqual(callArgs.limit, undefined);
    });

    test('ignores negative offset', async () => {
      const req = createMockRequest({ url: '/api/audit?offset=-1' });
      const { res } = createMockResponse();
      await router.handleRequest(req, res);
      const callArgs = mockAuditLogger.query.mock.calls[0].arguments[0];
      assert.strictEqual(callArgs.offset, undefined);
    });

    test('includes filters in response body', async () => {
      const req = createMockRequest({ url: '/api/audit?actor=admin' });
      const { res, getResponse } = createMockResponse();
      await router.handleRequest(req, res);
      const response = getResponse();
      assert.strictEqual(response.body.filters.actor, 'admin');
    });

    test('returns null for unset filters', async () => {
      const req = createMockRequest({ url: '/api/audit' });
      const { res, getResponse } = createMockResponse();
      await router.handleRequest(req, res);
      const response = getResponse();
      assert.strictEqual(response.body.filters.actor, null);
      assert.strictEqual(response.body.filters.actorType, null);
      assert.strictEqual(response.body.filters.resourceType, null);
      assert.strictEqual(response.body.filters.eventTypes, null);
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/audit/export
  // --------------------------------------------------------------------------

  describe('GET /api/audit/export', () => {
    test('returns 400 when startDate is missing', async () => {
      const req = createMockRequest({ url: '/api/audit/export?endDate=2026-02-01' });
      const { res, getResponse } = createMockResponse();
      await router.handleRequest(req, res);
      const response = getResponse();
      assert.strictEqual(response.statusCode, 400);
      assert.match(response.body.message, /startDate/);
    });

    test('returns 400 when endDate is missing', async () => {
      const req = createMockRequest({ url: '/api/audit/export?startDate=2026-01-01' });
      const { res, getResponse } = createMockResponse();
      await router.handleRequest(req, res);
      const response = getResponse();
      assert.strictEqual(response.statusCode, 400);
      assert.match(response.body.message, /endDate/);
    });

    test('returns 400 for invalid format', async () => {
      const req = createMockRequest({
        url: '/api/audit/export?startDate=2026-01-01&endDate=2026-02-01&format=xml',
      });
      const { res, getResponse } = createMockResponse();
      await router.handleRequest(req, res);
      const response = getResponse();
      assert.strictEqual(response.statusCode, 400);
      assert.match(response.body.message, /Invalid format/);
    });

    test('exports JSON by default', async () => {
      const entries = [createSampleLogEntry()];
      mockAuditLogger.exportLogs = mock.fn(async () => JSON.stringify(entries, null, 2));

      const req = createMockRequest({
        url: '/api/audit/export?startDate=2026-01-01&endDate=2026-02-01',
      });
      const { res, getResponse } = createMockResponse();
      await router.handleRequest(req, res);
      const response = getResponse();
      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(response.headers['Content-Type'], 'application/json');
      assert.strictEqual(response.body.format, 'json');
      assert.strictEqual(response.body.count, 1);
      assert.deepStrictEqual(response.body.data, entries);
    });

    test('calls auditLogger.exportLogs with correct args for JSON', async () => {
      mockAuditLogger.exportLogs = mock.fn(async () => '[]');

      const req = createMockRequest({
        url: '/api/audit/export?startDate=2026-01-01&endDate=2026-02-01&format=json',
      });
      const { res } = createMockResponse();
      await router.handleRequest(req, res);

      assert.strictEqual(mockAuditLogger.exportLogs.mock.callCount(), 1);
      const args = mockAuditLogger.exportLogs.mock.calls[0].arguments;
      assert.strictEqual(args[0], '2026-01-01');
      assert.strictEqual(args[1], '2026-02-01');
      assert.strictEqual(args[2], 'json');
    });

    test('exports CSV with correct content type', async () => {
      const csvData = 'id,event_type,actor\n1,bot.started,admin';
      mockAuditLogger.exportLogs = mock.fn(async () => csvData);

      const req = createMockRequest({
        url: '/api/audit/export?startDate=2026-01-01&endDate=2026-02-01&format=csv',
      });
      const { res, getResponse } = createMockResponse();
      await router.handleRequest(req, res);
      const response = getResponse();
      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(response.headers['Content-Type'], 'text/csv');
      assert.ok(response.headers['Content-Disposition'].includes('audit-logs.csv'));
      assert.strictEqual(response.raw, csvData);
    });

    test('includes startDate and endDate in JSON response', async () => {
      mockAuditLogger.exportLogs = mock.fn(async () => '[]');

      const req = createMockRequest({
        url: '/api/audit/export?startDate=2026-01-01&endDate=2026-02-01',
      });
      const { res, getResponse } = createMockResponse();
      await router.handleRequest(req, res);
      const response = getResponse();
      assert.strictEqual(response.body.startDate, '2026-01-01');
      assert.strictEqual(response.body.endDate, '2026-02-01');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/audit/stats
  // --------------------------------------------------------------------------

  describe('GET /api/audit/stats', () => {
    test('returns stats with totals', async () => {
      let callIndex = 0;
      mockAuditLogger.storage.query = mock.fn(async () => {
        callIndex++;
        if (callIndex === 1) return { rows: [{ total: 42 }], rowCount: 1 };
        if (callIndex === 2) {
          return {
            rows: [
              { event_type: 'bot.started', count: 20 },
              { event_type: 'bot.stopped', count: 10 },
            ],
            rowCount: 2,
          };
        }
        if (callIndex === 3) {
          return {
            rows: [{ actor_type: 'user', count: 30 }],
            rowCount: 1,
          };
        }
        return {
          rows: [{ resource_type: 'bot', count: 25 }],
          rowCount: 1,
        };
      });

      const req = createMockRequest({ url: '/api/audit/stats' });
      const { res, getResponse } = createMockResponse();
      await router.handleRequest(req, res);
      const response = getResponse();
      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(response.body.total, 42);
      assert.deepStrictEqual(response.body.byEventType, {
        'bot.started': 20,
        'bot.stopped': 10,
      });
      assert.deepStrictEqual(response.body.byActorType, { user: 30 });
      assert.deepStrictEqual(response.body.byResourceType, { bot: 25 });
    });

    test('returns empty stats when no data', async () => {
      mockAuditLogger.storage.query = mock.fn(async () => ({
        rows: [{ total: 0 }],
        rowCount: 1,
      }));

      // Override to return different results per call
      let callIndex = 0;
      mockAuditLogger.storage.query = mock.fn(async () => {
        callIndex++;
        if (callIndex === 1) return { rows: [{ total: 0 }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      });

      const req = createMockRequest({ url: '/api/audit/stats' });
      const { res, getResponse } = createMockResponse();
      await router.handleRequest(req, res);
      const response = getResponse();
      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(response.body.total, 0);
      assert.deepStrictEqual(response.body.byEventType, {});
      assert.deepStrictEqual(response.body.byActorType, {});
      assert.deepStrictEqual(response.body.byResourceType, {});
    });

    test('passes date filters when provided', async () => {
      let callIndex = 0;
      mockAuditLogger.storage.query = mock.fn(async () => {
        callIndex++;
        if (callIndex === 1) return { rows: [{ total: 5 }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      });

      const req = createMockRequest({
        url: '/api/audit/stats?startDate=2026-01-01&endDate=2026-02-01',
      });
      const { res, getResponse } = createMockResponse();
      await router.handleRequest(req, res);
      const response = getResponse();

      // Verify WHERE clause was used
      const firstCall = mockAuditLogger.storage.query.mock.calls[0].arguments[0];
      assert.ok(firstCall.includes('WHERE'));
      assert.ok(firstCall.includes('timestamp >='));
      assert.ok(firstCall.includes('timestamp <='));

      // Verify response includes filters
      assert.strictEqual(response.body.filters.startDate, '2026-01-01');
      assert.strictEqual(response.body.filters.endDate, '2026-02-01');
    });

    test('returns null date filters when not provided', async () => {
      let callIndex = 0;
      mockAuditLogger.storage.query = mock.fn(async () => {
        callIndex++;
        if (callIndex === 1) return { rows: [{ total: 0 }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      });

      const req = createMockRequest({ url: '/api/audit/stats' });
      const { res, getResponse } = createMockResponse();
      await router.handleRequest(req, res);
      const response = getResponse();
      assert.strictEqual(response.body.filters.startDate, null);
      assert.strictEqual(response.body.filters.endDate, null);
    });
  });

  // --------------------------------------------------------------------------
  // Error handling
  // --------------------------------------------------------------------------

  describe('error handling', () => {
    test('returns 500 when auditLogger.query() throws', async () => {
      mockAuditLogger.query = mock.fn(async () => {
        throw new Error('Database connection lost');
      });

      const req = createMockRequest({ url: '/api/audit' });
      const { res, getResponse } = createMockResponse();
      await router.handleRequest(req, res);
      const response = getResponse();
      assert.strictEqual(response.statusCode, 500);
      assert.strictEqual(response.body.error, 'Internal Server Error');
      assert.match(response.body.message, /Database connection lost/);
    });

    test('returns 500 when exportLogs throws', async () => {
      mockAuditLogger.exportLogs = mock.fn(async () => {
        throw new Error('Export failed');
      });

      const req = createMockRequest({
        url: '/api/audit/export?startDate=2026-01-01&endDate=2026-02-01',
      });
      const { res, getResponse } = createMockResponse();
      await router.handleRequest(req, res);
      const response = getResponse();
      assert.strictEqual(response.statusCode, 500);
      assert.match(response.body.message, /Export failed/);
    });

    test('returns 500 when stats storage query throws', async () => {
      mockAuditLogger.storage.query = mock.fn(async () => {
        throw new Error('Stats query failed');
      });

      const req = createMockRequest({ url: '/api/audit/stats' });
      const { res, getResponse } = createMockResponse();
      await router.handleRequest(req, res);
      const response = getResponse();
      assert.strictEqual(response.statusCode, 500);
      assert.match(response.body.message, /Stats query failed/);
    });

    test('logs error message when logger is available', async () => {
      const logger = mock.fn();
      const errorRouter = new AuditRouter({
        auditLogger: mockAuditLogger,
        logger,
      });
      mockAuditLogger.query = mock.fn(async () => {
        throw new Error('DB error');
      });

      const req = createMockRequest({ url: '/api/audit' });
      const { res } = createMockResponse();
      await errorRouter.handleRequest(req, res);

      assert.strictEqual(logger.mock.callCount(), 1);
      assert.ok(logger.mock.calls[0].arguments[0].includes('[AuditRouter]'));
      assert.ok(logger.mock.calls[0].arguments[0].includes('DB error'));
    });
  });

  // --------------------------------------------------------------------------
  // JSON response format
  // --------------------------------------------------------------------------

  describe('_sendJson', () => {
    test('sets correct Content-Type header', async () => {
      const req = createMockRequest({ url: '/api/audit' });
      const { res, getResponse } = createMockResponse();
      await router.handleRequest(req, res);
      const response = getResponse();
      assert.strictEqual(response.headers['Content-Type'], 'application/json');
    });

    test('sets Content-Length header', async () => {
      const req = createMockRequest({ url: '/api/audit' });
      const { res, getResponse } = createMockResponse();
      await router.handleRequest(req, res);
      const response = getResponse();
      assert.ok(response.headers['Content-Length'] > 0);
    });
  });
});
