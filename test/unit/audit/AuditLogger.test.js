/**
 * Unit tests for AuditLogger
 *
 * Tests audit event logging, querying with filters, log export in JSON/CSV,
 * retention policy, event validation, and error handling.
 *
 * Tests:
 * - Constructor validation and defaults
 * - log() event recording and validation
 * - query() with actor/resource/event type/time range filters
 * - exportLogs() in JSON and CSV formats
 * - applyRetention() cleanup of old entries
 * - AUDIT_EVENT_TYPES frozen constants
 * - ACTOR_TYPES frozen constants
 * - Error handling and edge cases
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  AuditLogger,
  AuditLoggerError,
  AUDIT_EVENT_TYPES,
  ACTOR_TYPES,
} from '../../../src/audit/audit-logger.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock storage instance
 * @param {Object} [overrides={}] - Override default mock responses
 * @returns {Object} Mock storage with query method
 */
function createMockStorage(overrides = {}) {
  return {
    query: mock.fn(async () => overrides.queryResult || { rows: [], rowCount: 0 }),
  };
}

/**
 * Create a mock storage that tracks all queries for assertion
 * @returns {{storage: Object, queries: Array}} Mock storage and query log
 */
function createTrackingStorage() {
  const queries = [];
  const storage = {
    query: mock.fn(async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [], rowCount: 0 };
    }),
  };
  return { storage, queries };
}

/**
 * Create a valid audit event for testing
 * @param {Object} [overrides={}] - Override default event fields
 * @returns {Object} Valid audit event
 */
function createValidEvent(overrides = {}) {
  return {
    type: AUDIT_EVENT_TYPES.BOT_STARTED,
    actor: 'admin-user',
    actorType: ACTOR_TYPES.USER,
    resourceType: 'bot',
    resourceId: 'work-bot',
    action: 'started',
    metadata: { previousStatus: 'stopped' },
    ipAddress: '192.168.1.100',
    userAgent: 'Mozilla/5.0',
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('AuditLogger', () => {
  let storage;
  let auditLogger;

  beforeEach(() => {
    storage = createMockStorage();
    auditLogger = new AuditLogger({ storage });
  });

  // ========================================================================
  // Constructor
  // ========================================================================

  describe('constructor', () => {
    test('creates instance with required storage', () => {
      const al = new AuditLogger({ storage });
      assert.ok(al);
      assert.equal(al.storage, storage);
      assert.equal(al.logger, null);
      assert.equal(al.retentionDays, 90);
    });

    test('accepts logger option', () => {
      const logger = mock.fn();
      const al = new AuditLogger({ storage, logger });
      assert.equal(al.logger, logger);
    });

    test('accepts retentionDays option', () => {
      const al = new AuditLogger({ storage, retentionDays: 30 });
      assert.equal(al.retentionDays, 30);
    });

    test('throws when storage is missing', () => {
      assert.throws(
        () => new AuditLogger({}),
        err => err instanceof AuditLoggerError && err.operation === 'constructor'
      );
    });

    test('throws when storage lacks query method', () => {
      assert.throws(
        () => new AuditLogger({ storage: {} }),
        err => err instanceof AuditLoggerError && err.operation === 'constructor'
      );
    });

    test('throws when retentionDays is not a positive number', () => {
      assert.throws(
        () => new AuditLogger({ storage, retentionDays: 0 }),
        err => err instanceof AuditLoggerError && err.operation === 'constructor'
      );
    });

    test('throws when retentionDays is negative', () => {
      assert.throws(
        () => new AuditLogger({ storage, retentionDays: -1 }),
        err => err instanceof AuditLoggerError
      );
    });

    test('throws with no arguments', () => {
      assert.throws(
        () => new AuditLogger(),
        err => err instanceof AuditLoggerError
      );
    });
  });

  // ========================================================================
  // log
  // ========================================================================

  describe('log', () => {
    test('inserts a valid event into the audit_log table', async () => {
      const event = createValidEvent();
      await auditLogger.log(event);

      assert.equal(storage.query.mock.callCount(), 1);
      const call = storage.query.mock.calls[0];
      assert.ok(call.arguments[0].includes('INSERT INTO audit_log'));
      assert.deepStrictEqual(call.arguments[1], [
        'bot.started',
        'admin-user',
        'user',
        'bot',
        'work-bot',
        'started',
        { previousStatus: 'stopped' },
        '192.168.1.100',
        'Mozilla/5.0',
      ]);
    });

    test('uses default actorType of user when not provided', async () => {
      const event = createValidEvent();
      delete event.actorType;
      await auditLogger.log(event);

      const call = storage.query.mock.calls[0];
      assert.equal(call.arguments[1][2], 'user');
    });

    test('uses null for optional fields when not provided', async () => {
      await auditLogger.log({
        type: AUDIT_EVENT_TYPES.BOT_CREATED,
        actor: 'system',
        resourceType: 'bot',
        action: 'created',
      });

      const call = storage.query.mock.calls[0];
      const params = call.arguments[1];
      assert.equal(params[4], null); // resourceId
      assert.deepStrictEqual(params[6], {}); // metadata defaults to {}
      assert.equal(params[7], null); // ipAddress
      assert.equal(params[8], null); // userAgent
    });

    test('passes explicit timestamp when provided', async () => {
      const ts = new Date('2026-02-01T12:00:00Z');
      await auditLogger.log(createValidEvent({ timestamp: ts }));

      const call = storage.query.mock.calls[0];
      assert.equal(call.arguments[1].length, 10);
      assert.equal(call.arguments[1][9], ts);
    });

    test('throws on null event', async () => {
      await assert.rejects(
        () => auditLogger.log(null),
        err => err instanceof AuditLoggerError && err.operation === 'log'
      );
    });

    test('throws on non-object event', async () => {
      await assert.rejects(
        () => auditLogger.log('not-an-object'),
        err => err instanceof AuditLoggerError && err.operation === 'log'
      );
    });

    test('throws on missing type', async () => {
      await assert.rejects(
        () => auditLogger.log(createValidEvent({ type: '' })),
        err => err instanceof AuditLoggerError && err.operation === 'log'
      );
    });

    test('throws on missing actor', async () => {
      await assert.rejects(
        () => auditLogger.log(createValidEvent({ actor: '' })),
        err => err instanceof AuditLoggerError && err.operation === 'log'
      );
    });

    test('throws on missing resourceType', async () => {
      await assert.rejects(
        () => auditLogger.log(createValidEvent({ resourceType: '' })),
        err => err instanceof AuditLoggerError && err.operation === 'log'
      );
    });

    test('throws on missing action', async () => {
      await assert.rejects(
        () => auditLogger.log(createValidEvent({ action: '' })),
        err => err instanceof AuditLoggerError && err.operation === 'log'
      );
    });

    test('throws on non-string type', async () => {
      await assert.rejects(
        () => auditLogger.log(createValidEvent({ type: 42 })),
        err => err instanceof AuditLoggerError
      );
    });

    test('wraps storage errors in AuditLoggerError', async () => {
      storage.query = mock.fn(async () => {
        throw new Error('connection lost');
      });

      await assert.rejects(
        () => auditLogger.log(createValidEvent()),
        err =>
          err instanceof AuditLoggerError &&
          err.operation === 'log' &&
          err.eventType === 'bot.started' &&
          err.cause.message === 'connection lost'
      );
    });

    test('logs message when logger is provided', async () => {
      const logFn = mock.fn();
      const al = new AuditLogger({ storage, logger: logFn });

      await al.log(createValidEvent());

      assert.ok(logFn.mock.callCount() > 0);
      const msg = logFn.mock.calls[0].arguments[0];
      assert.ok(msg.includes('[AuditLogger]'));
      assert.ok(msg.includes('bot.started'));
    });
  });

  // ========================================================================
  // query
  // ========================================================================

  describe('query', () => {
    test('queries all audit logs with no filter', async () => {
      const rows = [
        {
          id: 1,
          event_type: 'bot.started',
          actor: 'admin',
          timestamp: new Date(),
        },
      ];
      storage.query = mock.fn(async () => ({ rows }));

      const result = await auditLogger.query();

      assert.deepStrictEqual(result, rows);
      const call = storage.query.mock.calls[0];
      assert.ok(call.arguments[0].includes('SELECT'));
      assert.ok(call.arguments[0].includes('ORDER BY timestamp DESC'));
    });

    test('filters by actor', async () => {
      const { storage: trackStorage, queries } = createTrackingStorage();
      const al = new AuditLogger({ storage: trackStorage });

      await al.query({ actor: 'admin-user' });

      assert.ok(queries[0].sql.includes('actor = $1'));
      assert.equal(queries[0].params[0], 'admin-user');
    });

    test('filters by actorType', async () => {
      const { storage: trackStorage, queries } = createTrackingStorage();
      const al = new AuditLogger({ storage: trackStorage });

      await al.query({ actorType: 'system' });

      assert.ok(queries[0].sql.includes('actor_type = $1'));
      assert.equal(queries[0].params[0], 'system');
    });

    test('filters by resourceType', async () => {
      const { storage: trackStorage, queries } = createTrackingStorage();
      const al = new AuditLogger({ storage: trackStorage });

      await al.query({ resourceType: 'bot' });

      assert.ok(queries[0].sql.includes('resource_type = $1'));
      assert.equal(queries[0].params[0], 'bot');
    });

    test('filters by resourceId', async () => {
      const { storage: trackStorage, queries } = createTrackingStorage();
      const al = new AuditLogger({ storage: trackStorage });

      await al.query({ resourceId: 'work-bot' });

      assert.ok(queries[0].sql.includes('resource_id = $1'));
      assert.equal(queries[0].params[0], 'work-bot');
    });

    test('filters by action', async () => {
      const { storage: trackStorage, queries } = createTrackingStorage();
      const al = new AuditLogger({ storage: trackStorage });

      await al.query({ action: 'started' });

      assert.ok(queries[0].sql.includes('action = $1'));
      assert.equal(queries[0].params[0], 'started');
    });

    test('filters by single eventType as string', async () => {
      const { storage: trackStorage, queries } = createTrackingStorage();
      const al = new AuditLogger({ storage: trackStorage });

      await al.query({ eventTypes: 'bot.started' });

      assert.ok(queries[0].sql.includes('event_type = ANY($1)'));
      assert.deepStrictEqual(queries[0].params[0], ['bot.started']);
    });

    test('filters by multiple eventTypes as array', async () => {
      const { storage: trackStorage, queries } = createTrackingStorage();
      const al = new AuditLogger({ storage: trackStorage });

      await al.query({ eventTypes: ['bot.started', 'bot.stopped'] });

      assert.ok(queries[0].sql.includes('event_type = ANY($1)'));
      assert.deepStrictEqual(queries[0].params[0], ['bot.started', 'bot.stopped']);
    });

    test('filters by startDate', async () => {
      const { storage: trackStorage, queries } = createTrackingStorage();
      const al = new AuditLogger({ storage: trackStorage });
      const startDate = new Date('2026-02-01T00:00:00Z');

      await al.query({ startDate });

      assert.ok(queries[0].sql.includes('timestamp >= $1'));
      assert.equal(queries[0].params[0], startDate);
    });

    test('filters by endDate', async () => {
      const { storage: trackStorage, queries } = createTrackingStorage();
      const al = new AuditLogger({ storage: trackStorage });
      const endDate = new Date('2026-02-28T23:59:59Z');

      await al.query({ endDate });

      assert.ok(queries[0].sql.includes('timestamp <= $1'));
      assert.equal(queries[0].params[0], endDate);
    });

    test('converts string dates to Date objects', async () => {
      const { storage: trackStorage, queries } = createTrackingStorage();
      const al = new AuditLogger({ storage: trackStorage });

      await al.query({ startDate: '2026-02-01', endDate: '2026-02-28' });

      assert.ok(queries[0].params[0] instanceof Date);
      assert.ok(queries[0].params[1] instanceof Date);
    });

    test('combines multiple filters', async () => {
      const { storage: trackStorage, queries } = createTrackingStorage();
      const al = new AuditLogger({ storage: trackStorage });

      await al.query({
        actor: 'admin',
        resourceType: 'bot',
        startDate: new Date('2026-02-01'),
        endDate: new Date('2026-02-28'),
      });

      const { sql } = queries[0];
      assert.ok(sql.includes('actor = $1'));
      assert.ok(sql.includes('resource_type = $2'));
      assert.ok(sql.includes('timestamp >= $3'));
      assert.ok(sql.includes('timestamp <= $4'));
      // 4 filters + limit + offset
      assert.equal(queries[0].params.length, 6);
    });

    test('uses default limit of 100', async () => {
      const { storage: trackStorage, queries } = createTrackingStorage();
      const al = new AuditLogger({ storage: trackStorage });

      await al.query();

      const { params } = queries[0];
      assert.equal(params[0], 100); // limit
      assert.equal(params[1], 0); // offset
    });

    test('accepts custom limit', async () => {
      const { storage: trackStorage, queries } = createTrackingStorage();
      const al = new AuditLogger({ storage: trackStorage });

      await al.query({ limit: 50 });

      assert.equal(queries[0].params[0], 50);
    });

    test('clamps limit to maximum of 10000', async () => {
      const { storage: trackStorage, queries } = createTrackingStorage();
      const al = new AuditLogger({ storage: trackStorage });

      await al.query({ limit: 99999 });

      assert.equal(queries[0].params[0], 10000);
    });

    test('accepts offset for pagination', async () => {
      const { storage: trackStorage, queries } = createTrackingStorage();
      const al = new AuditLogger({ storage: trackStorage });

      await al.query({ offset: 50 });

      const { params } = queries[0];
      assert.equal(params[1], 50);
    });

    test('wraps storage errors in AuditLoggerError', async () => {
      storage.query = mock.fn(async () => {
        throw new Error('query timeout');
      });

      await assert.rejects(
        () => auditLogger.query(),
        err => err instanceof AuditLoggerError && err.operation === 'query'
      );
    });
  });

  // ========================================================================
  // exportLogs
  // ========================================================================

  describe('exportLogs', () => {
    const sampleRows = [
      {
        id: 1,
        event_type: 'bot.started',
        actor: 'admin',
        actor_type: 'user',
        resource_type: 'bot',
        resource_id: 'work-bot',
        action: 'started',
        metadata: { previousStatus: 'stopped' },
        ip_address: '192.168.1.1',
        user_agent: 'curl/7.0',
        timestamp: '2026-02-01T10:00:00.000Z',
      },
      {
        id: 2,
        event_type: 'bot.stopped',
        actor: 'admin',
        actor_type: 'user',
        resource_type: 'bot',
        resource_id: 'work-bot',
        action: 'stopped',
        metadata: {},
        ip_address: null,
        user_agent: null,
        timestamp: '2026-02-01T12:00:00.000Z',
      },
    ];

    test('exports logs as JSON by default', async () => {
      storage.query = mock.fn(async () => ({ rows: sampleRows }));

      const result = await auditLogger.exportLogs(new Date('2026-02-01'), new Date('2026-02-28'));

      const parsed = JSON.parse(result);
      assert.equal(parsed.length, 2);
      assert.equal(parsed[0].event_type, 'bot.started');
    });

    test('exports logs as CSV when specified', async () => {
      storage.query = mock.fn(async () => ({ rows: sampleRows }));

      const result = await auditLogger.exportLogs(
        new Date('2026-02-01'),
        new Date('2026-02-28'),
        'csv'
      );

      const lines = result.split('\n');
      assert.equal(lines.length, 3); // header + 2 data rows
      assert.ok(lines[0].includes('id,event_type,actor'));
      assert.ok(lines[1].includes('bot.started'));
    });

    test('handles empty results', async () => {
      const result = await auditLogger.exportLogs(new Date('2026-02-01'), new Date('2026-02-28'));

      const parsed = JSON.parse(result);
      assert.equal(parsed.length, 0);
    });

    test('passes date range to SQL query', async () => {
      const { storage: trackStorage, queries } = createTrackingStorage();
      const al = new AuditLogger({ storage: trackStorage });
      const start = new Date('2026-02-01');
      const end = new Date('2026-02-28');

      await al.exportLogs(start, end);

      assert.ok(queries[0].sql.includes('timestamp >= $1'));
      assert.ok(queries[0].sql.includes('timestamp <= $2'));
      assert.equal(queries[0].params[0], start);
      assert.equal(queries[0].params[1], end);
    });

    test('converts string dates to Date objects', async () => {
      const { storage: trackStorage, queries } = createTrackingStorage();
      const al = new AuditLogger({ storage: trackStorage });

      await al.exportLogs('2026-02-01', '2026-02-28');

      assert.ok(queries[0].params[0] instanceof Date);
      assert.ok(queries[0].params[1] instanceof Date);
    });

    test('orders results by timestamp ASC for export', async () => {
      const { storage: trackStorage, queries } = createTrackingStorage();
      const al = new AuditLogger({ storage: trackStorage });

      await al.exportLogs(new Date('2026-02-01'), new Date('2026-02-28'));

      assert.ok(queries[0].sql.includes('ORDER BY timestamp ASC'));
    });

    test('throws on missing start date', async () => {
      await assert.rejects(
        () => auditLogger.exportLogs(null, new Date('2026-02-28')),
        err => err instanceof AuditLoggerError && err.operation === 'exportLogs'
      );
    });

    test('throws on missing end date', async () => {
      await assert.rejects(
        () => auditLogger.exportLogs(new Date('2026-02-01'), null),
        err => err instanceof AuditLoggerError && err.operation === 'exportLogs'
      );
    });

    test('throws on invalid format', async () => {
      await assert.rejects(
        () => auditLogger.exportLogs(new Date('2026-02-01'), new Date('2026-02-28'), 'xml'),
        err => err instanceof AuditLoggerError && err.operation === 'exportLogs'
      );
    });

    test('wraps storage errors in AuditLoggerError', async () => {
      storage.query = mock.fn(async () => {
        throw new Error('disk full');
      });

      await assert.rejects(
        () => auditLogger.exportLogs(new Date('2026-02-01'), new Date('2026-02-28')),
        err =>
          err instanceof AuditLoggerError &&
          err.operation === 'exportLogs' &&
          err.cause.message === 'disk full'
      );
    });

    test('CSV properly escapes values with commas', async () => {
      storage.query = mock.fn(async () => ({
        rows: [
          {
            id: 1,
            event_type: 'bot.started',
            actor: 'admin, superuser',
            actor_type: 'user',
            resource_type: 'bot',
            resource_id: 'work-bot',
            action: 'started',
            metadata: { key: 'value' },
            ip_address: '192.168.1.1',
            user_agent: 'Mozilla/5.0',
            timestamp: '2026-02-01T10:00:00.000Z',
          },
        ],
      }));

      const result = await auditLogger.exportLogs(
        new Date('2026-02-01'),
        new Date('2026-02-28'),
        'csv'
      );

      const lines = result.split('\n');
      // Actor with comma should be quoted
      assert.ok(lines[1].includes('"admin, superuser"'));
    });

    test('CSV properly escapes values with double quotes', async () => {
      storage.query = mock.fn(async () => ({
        rows: [
          {
            id: 1,
            event_type: 'bot.started',
            actor: 'admin "the boss"',
            actor_type: 'user',
            resource_type: 'bot',
            resource_id: 'work-bot',
            action: 'started',
            metadata: {},
            ip_address: null,
            user_agent: null,
            timestamp: '2026-02-01T10:00:00.000Z',
          },
        ],
      }));

      const result = await auditLogger.exportLogs(
        new Date('2026-02-01'),
        new Date('2026-02-28'),
        'csv'
      );

      const lines = result.split('\n');
      assert.ok(lines[1].includes('"admin ""the boss"""'));
    });

    test('CSV handles null values as empty strings', async () => {
      storage.query = mock.fn(async () => ({
        rows: [
          {
            id: 1,
            event_type: 'bot.started',
            actor: 'admin',
            actor_type: 'user',
            resource_type: 'bot',
            resource_id: null,
            action: 'started',
            metadata: {},
            ip_address: null,
            user_agent: null,
            timestamp: '2026-02-01T10:00:00.000Z',
          },
        ],
      }));

      const result = await auditLogger.exportLogs(
        new Date('2026-02-01'),
        new Date('2026-02-28'),
        'csv'
      );

      const lines = result.split('\n');
      // Check that null fields produce empty values (consecutive commas)
      assert.ok(lines[1].includes(',,'));
    });
  });

  // ========================================================================
  // applyRetention
  // ========================================================================

  describe('applyRetention', () => {
    test('deletes audit logs older than specified days', async () => {
      storage.query = mock.fn(async () => ({ rowCount: 42 }));

      const deleted = await auditLogger.applyRetention(30);

      assert.equal(deleted, 42);
      const call = storage.query.mock.calls[0];
      assert.ok(call.arguments[0].includes('DELETE FROM audit_log'));
      assert.ok(call.arguments[0].includes("INTERVAL '1 day'"));
      assert.equal(call.arguments[1][0], 30);
    });

    test('uses default retention days when no argument given', async () => {
      storage.query = mock.fn(async () => ({ rowCount: 10 }));
      const al = new AuditLogger({ storage, retentionDays: 60 });

      await al.applyRetention();

      const call = storage.query.mock.calls[0];
      assert.equal(call.arguments[1][0], 60);
    });

    test('returns 0 when no rows deleted', async () => {
      storage.query = mock.fn(async () => ({ rowCount: 0 }));

      const deleted = await auditLogger.applyRetention(90);

      assert.equal(deleted, 0);
    });

    test('throws on non-positive days', async () => {
      await assert.rejects(
        () => auditLogger.applyRetention(0),
        err => err instanceof AuditLoggerError && err.operation === 'applyRetention'
      );
    });

    test('throws on negative days', async () => {
      await assert.rejects(
        () => auditLogger.applyRetention(-5),
        err => err instanceof AuditLoggerError
      );
    });

    test('wraps storage errors in AuditLoggerError', async () => {
      storage.query = mock.fn(async () => {
        throw new Error('permission denied');
      });

      await assert.rejects(
        () => auditLogger.applyRetention(90),
        err =>
          err instanceof AuditLoggerError &&
          err.operation === 'applyRetention' &&
          err.cause.message === 'permission denied'
      );
    });
  });

  // ========================================================================
  // AUDIT_EVENT_TYPES
  // ========================================================================

  describe('AUDIT_EVENT_TYPES', () => {
    test('is a frozen object', () => {
      assert.ok(Object.isFrozen(AUDIT_EVENT_TYPES));
    });

    test('contains bot event types', () => {
      assert.equal(AUDIT_EVENT_TYPES.BOT_CREATED, 'bot.created');
      assert.equal(AUDIT_EVENT_TYPES.BOT_STARTED, 'bot.started');
      assert.equal(AUDIT_EVENT_TYPES.BOT_STOPPED, 'bot.stopped');
      assert.equal(AUDIT_EVENT_TYPES.BOT_DELETED, 'bot.deleted');
      assert.equal(AUDIT_EVENT_TYPES.BOT_CONFIG_UPDATED, 'bot.config_updated');
      assert.equal(AUDIT_EVENT_TYPES.BOT_SOUL_UPDATED, 'bot.soul_updated');
    });

    test('contains message event types', () => {
      assert.equal(AUDIT_EVENT_TYPES.MESSAGE_RECEIVED, 'message.received');
      assert.equal(AUDIT_EVENT_TYPES.MESSAGE_SENT, 'message.sent');
      assert.equal(AUDIT_EVENT_TYPES.MESSAGE_QUEUED, 'message.queued');
      assert.equal(AUDIT_EVENT_TYPES.MESSAGE_FAILED, 'message.failed');
    });

    test('contains tool event types', () => {
      assert.equal(AUDIT_EVENT_TYPES.TOOL_EXECUTED, 'tool.executed');
      assert.equal(AUDIT_EVENT_TYPES.TOOL_FAILED, 'tool.failed');
    });

    test('contains admin event types', () => {
      assert.equal(AUDIT_EVENT_TYPES.CONFIG_RELOADED, 'config.reloaded');
      assert.equal(AUDIT_EVENT_TYPES.INSTANCE_CREATED, 'instance.created');
      assert.equal(AUDIT_EVENT_TYPES.INSTANCE_DELETED, 'instance.deleted');
      assert.equal(AUDIT_EVENT_TYPES.WORKER_REGISTERED, 'worker.registered');
      assert.equal(AUDIT_EVENT_TYPES.WORKER_UNREGISTERED, 'worker.unregistered');
    });

    test('contains security event types', () => {
      assert.equal(AUDIT_EVENT_TYPES.AUTH_LOGIN_SUCCESS, 'auth.login_success');
      assert.equal(AUDIT_EVENT_TYPES.AUTH_LOGIN_FAILED, 'auth.login_failed');
      assert.equal(AUDIT_EVENT_TYPES.AUTH_TOKEN_CREATED, 'auth.token_created');
      assert.equal(AUDIT_EVENT_TYPES.AUTH_UNAUTHORIZED_ACCESS, 'auth.unauthorized_access');
    });

    test('cannot be modified', () => {
      assert.throws(() => {
        AUDIT_EVENT_TYPES.NEW_TYPE = 'new.type';
      });
    });
  });

  // ========================================================================
  // ACTOR_TYPES
  // ========================================================================

  describe('ACTOR_TYPES', () => {
    test('is a frozen object', () => {
      assert.ok(Object.isFrozen(ACTOR_TYPES));
    });

    test('contains all actor types', () => {
      assert.equal(ACTOR_TYPES.USER, 'user');
      assert.equal(ACTOR_TYPES.BOT, 'bot');
      assert.equal(ACTOR_TYPES.SYSTEM, 'system');
      assert.equal(ACTOR_TYPES.API, 'api');
    });

    test('cannot be modified', () => {
      assert.throws(() => {
        ACTOR_TYPES.ADMIN = 'admin';
      });
    });
  });

  // ========================================================================
  // AuditLoggerError
  // ========================================================================

  describe('AuditLoggerError', () => {
    test('has correct name', () => {
      const err = new AuditLoggerError('test error');
      assert.equal(err.name, 'AuditLoggerError');
    });

    test('stores operation', () => {
      const err = new AuditLoggerError('test', { operation: 'log' });
      assert.equal(err.operation, 'log');
    });

    test('stores eventType', () => {
      const err = new AuditLoggerError('test', { eventType: 'bot.started' });
      assert.equal(err.eventType, 'bot.started');
    });

    test('stores cause', () => {
      const cause = new Error('root cause');
      const err = new AuditLoggerError('test', { cause });
      assert.equal(err.cause, cause);
    });

    test('extends Error', () => {
      const err = new AuditLoggerError('test');
      assert.ok(err instanceof Error);
    });
  });

  // ========================================================================
  // Logger integration
  // ========================================================================

  describe('logging', () => {
    test('logs when logger is provided', async () => {
      const logFn = mock.fn();
      const al = new AuditLogger({ storage, logger: logFn });

      await al.log(createValidEvent());

      assert.ok(logFn.mock.callCount() > 0);
      const firstCall = logFn.mock.calls[0].arguments[0];
      assert.ok(firstCall.includes('[AuditLogger]'));
    });

    test('does not throw when logger is null', async () => {
      const al = new AuditLogger({ storage });
      await assert.doesNotReject(() => al.log(createValidEvent()));
    });
  });
});
