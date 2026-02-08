/**
 * AuditLogger - Immutable audit trail for system events
 *
 * Records all significant system events (bot operations, message handling,
 * tool execution, admin actions, security events) into the `audit_log`
 * PostgreSQL table. Supports querying with filters, pagination, and
 * exporting logs for compliance (SOC 2, GDPR, HIPAA).
 *
 * Features:
 * - Log structured audit events with actor, resource, and metadata context
 * - Query historical events with flexible filters and pagination
 * - Export logs in JSON or CSV format for compliance reporting
 * - Configurable retention policy for automatic cleanup
 * - Frozen event type constants for type-safe event categorization
 *
 * @module audit/audit-logger
 */

/**
 * All recognized audit event types, organized by category.
 *
 * @type {Readonly<Object>}
 */
export const AUDIT_EVENT_TYPES = Object.freeze({
  // Bot operations
  BOT_CREATED: 'bot.created',
  BOT_STARTED: 'bot.started',
  BOT_STOPPED: 'bot.stopped',
  BOT_DELETED: 'bot.deleted',
  BOT_CONFIG_UPDATED: 'bot.config_updated',
  BOT_SOUL_UPDATED: 'bot.soul_updated',

  // Message operations
  MESSAGE_RECEIVED: 'message.received',
  MESSAGE_SENT: 'message.sent',
  MESSAGE_QUEUED: 'message.queued',
  MESSAGE_FAILED: 'message.failed',

  // Tool operations
  TOOL_EXECUTED: 'tool.executed',
  TOOL_FAILED: 'tool.failed',

  // Admin operations
  CONFIG_RELOADED: 'config.reloaded',
  INSTANCE_CREATED: 'instance.created',
  INSTANCE_DELETED: 'instance.deleted',
  WORKER_REGISTERED: 'worker.registered',
  WORKER_UNREGISTERED: 'worker.unregistered',

  // Security events
  AUTH_LOGIN_SUCCESS: 'auth.login_success',
  AUTH_LOGIN_FAILED: 'auth.login_failed',
  AUTH_TOKEN_CREATED: 'auth.token_created',
  AUTH_UNAUTHORIZED_ACCESS: 'auth.unauthorized_access',
});

/**
 * Valid actor types for audit events
 * @type {Readonly<Object>}
 */
export const ACTOR_TYPES = Object.freeze({
  USER: 'user',
  BOT: 'bot',
  SYSTEM: 'system',
  API: 'api',
});

/**
 * Default maximum rows returned from queries
 * @type {number}
 */
const DEFAULT_QUERY_LIMIT = 100;

/**
 * Maximum allowed query limit to prevent excessive memory usage
 * @type {number}
 */
const MAX_QUERY_LIMIT = 10000;

/**
 * Default retention period in days (90 days)
 * @type {number}
 */
const DEFAULT_RETENTION_DAYS = 90;

/**
 * Custom error for audit logger failures
 */
export class AuditLoggerError extends Error {
  /**
   * Create an AuditLoggerError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - The operation that failed
   * @param {string} [options.eventType] - Event type involved
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'AuditLoggerError';
    this.operation = options.operation;
    this.eventType = options.eventType;
  }
}

/**
 * AuditLogger - records and queries audit trail events in PostgreSQL
 *
 * @example
 * const logger = new AuditLogger({ storage, logger: console.log });
 * await logger.log({
 *   type: 'bot.started',
 *   actor: 'admin-user',
 *   actorType: 'user',
 *   resourceType: 'bot',
 *   resourceId: 'work-bot',
 *   action: 'started',
 *   metadata: { previousStatus: 'stopped' },
 *   ipAddress: '192.168.1.100',
 * });
 * const logs = await logger.query({ actor: 'admin-user', limit: 50 });
 */
export class AuditLogger {
  /**
   * Create an AuditLogger instance
   *
   * @param {Object} options - Configuration options
   * @param {Object} options.storage - PostgresStorage instance with query() method
   * @param {Function|null} [options.logger=null] - Logger function for internal events
   * @param {number} [options.retentionDays=90] - Default retention period in days
   */
  constructor(options = {}) {
    const { storage, logger = null, retentionDays = DEFAULT_RETENTION_DAYS } = options;

    if (!storage) {
      throw new AuditLoggerError('Storage instance is required', {
        operation: 'constructor',
      });
    }

    if (typeof storage.query !== 'function') {
      throw new AuditLoggerError('Storage must have a query() method', {
        operation: 'constructor',
      });
    }

    if (typeof retentionDays !== 'number' || retentionDays <= 0) {
      throw new AuditLoggerError('retentionDays must be a positive number', {
        operation: 'constructor',
      });
    }

    /** @type {Object} PostgresStorage instance */
    this.storage = storage;

    /** @type {Function|null} Logger function */
    this.logger = logger;

    /** @type {number} Default retention period in days */
    this.retentionDays = retentionDays;
  }

  /**
   * Log an audit event
   *
   * Records a structured event into the audit_log table. Required fields
   * are type, actor, resourceType, and action. Optional fields include
   * actorType, resourceId, metadata, ipAddress, and userAgent.
   *
   * @param {Object} event - Audit event to record
   * @param {string} event.type - Event type (e.g., 'bot.started')
   * @param {string} event.actor - Who performed the action
   * @param {string} [event.actorType='user'] - Type of actor (user, bot, system, api)
   * @param {string} event.resourceType - Type of resource affected
   * @param {string} [event.resourceId] - Identifier of the specific resource
   * @param {string} event.action - Action performed
   * @param {Object} [event.metadata={}] - Additional contextual data
   * @param {string} [event.ipAddress] - IP address of the request origin
   * @param {string} [event.userAgent] - User-Agent header from the request
   * @param {Date} [event.timestamp] - Optional explicit timestamp (defaults to NOW())
   * @returns {Promise<void>}
   * @throws {AuditLoggerError} If event validation fails or storage write fails
   */
  async log(event) {
    this._validateEvent(event);

    const {
      type,
      actor,
      actorType = ACTOR_TYPES.USER,
      resourceType,
      resourceId = null,
      action,
      metadata = {},
      ipAddress = null,
      userAgent = null,
      timestamp,
    } = event;

    try {
      if (timestamp) {
        await this.storage.query(
          `INSERT INTO audit_log
             (event_type, actor, actor_type, resource_type, resource_id, action, metadata, ip_address, user_agent, timestamp)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            type,
            actor,
            actorType,
            resourceType,
            resourceId,
            action,
            metadata,
            ipAddress,
            userAgent,
            timestamp,
          ]
        );
      } else {
        await this.storage.query(
          `INSERT INTO audit_log
             (event_type, actor, actor_type, resource_type, resource_id, action, metadata, ip_address, user_agent)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [type, actor, actorType, resourceType, resourceId, action, metadata, ipAddress, userAgent]
        );
      }

      this._log(`Audit event logged: ${type} by ${actor} on ${resourceType}/${resourceId || '*'}`);
    } catch (err) {
      throw new AuditLoggerError(`Failed to log audit event: ${err.message}`, {
        cause: err,
        operation: 'log',
        eventType: type,
      });
    }
  }

  /**
   * Query audit logs with flexible filters
   *
   * Supports filtering by actor, event type(s), resource type/id, action,
   * and time range. Results are ordered by timestamp descending with
   * configurable limit and offset for pagination.
   *
   * @param {Object} [filters={}] - Query filters
   * @param {string} [filters.actor] - Filter by actor
   * @param {string} [filters.actorType] - Filter by actor type
   * @param {string} [filters.resourceType] - Filter by resource type
   * @param {string} [filters.resourceId] - Filter by resource ID
   * @param {string} [filters.action] - Filter by action
   * @param {string|string[]} [filters.eventTypes] - Filter by event type(s)
   * @param {Date|string} [filters.startDate] - Only events after this time
   * @param {Date|string} [filters.endDate] - Only events before this time
   * @param {number} [filters.limit=100] - Maximum rows to return
   * @param {number} [filters.offset=0] - Number of rows to skip (pagination)
   * @returns {Promise<Array<Object>>} Matching audit log entries
   * @throws {AuditLoggerError} If query fails
   */
  async query(filters = {}) {
    const {
      actor,
      actorType,
      resourceType,
      resourceId,
      action,
      eventTypes,
      startDate,
      endDate,
      limit = DEFAULT_QUERY_LIMIT,
      offset = 0,
    } = filters;

    const clampedLimit = Math.min(Math.max(1, limit), MAX_QUERY_LIMIT);

    try {
      let sql =
        'SELECT id, event_type, actor, actor_type, resource_type, resource_id, action, metadata, ip_address, user_agent, timestamp FROM audit_log WHERE 1=1';
      const params = [];

      if (actor) {
        params.push(actor);
        sql += ` AND actor = $${params.length}`;
      }

      if (actorType) {
        params.push(actorType);
        sql += ` AND actor_type = $${params.length}`;
      }

      if (resourceType) {
        params.push(resourceType);
        sql += ` AND resource_type = $${params.length}`;
      }

      if (resourceId) {
        params.push(resourceId);
        sql += ` AND resource_id = $${params.length}`;
      }

      if (action) {
        params.push(action);
        sql += ` AND action = $${params.length}`;
      }

      if (eventTypes) {
        const types = Array.isArray(eventTypes) ? eventTypes : [eventTypes];
        if (types.length > 0) {
          params.push(types);
          sql += ` AND event_type = ANY($${params.length})`;
        }
      }

      if (startDate) {
        params.push(startDate instanceof Date ? startDate : new Date(startDate));
        sql += ` AND timestamp >= $${params.length}`;
      }

      if (endDate) {
        params.push(endDate instanceof Date ? endDate : new Date(endDate));
        sql += ` AND timestamp <= $${params.length}`;
      }

      params.push(clampedLimit);
      sql += ` ORDER BY timestamp DESC LIMIT $${params.length}`;

      params.push(offset);
      sql += ` OFFSET $${params.length}`;

      const { rows } = await this.storage.query(sql, params);
      return rows;
    } catch (err) {
      throw new AuditLoggerError(`Failed to query audit logs: ${err.message}`, {
        cause: err,
        operation: 'query',
      });
    }
  }

  /**
   * Export audit logs for a date range in the specified format
   *
   * Retrieves all audit log entries within the given time window and
   * formats them for export. Supports JSON and CSV output formats.
   *
   * @param {Date|string} start - Start of the export period
   * @param {Date|string} end - End of the export period
   * @param {string} [format='json'] - Export format ('json' or 'csv')
   * @returns {Promise<string>} Formatted export data
   * @throws {AuditLoggerError} If export fails or format is invalid
   */
  async exportLogs(start, end, format = 'json') {
    if (!start) {
      throw new AuditLoggerError('Start date is required for export', {
        operation: 'exportLogs',
      });
    }

    if (!end) {
      throw new AuditLoggerError('End date is required for export', {
        operation: 'exportLogs',
      });
    }

    const validFormats = ['json', 'csv'];
    if (!validFormats.includes(format)) {
      throw new AuditLoggerError(
        `Invalid export format: ${format}. Must be one of: ${validFormats.join(', ')}`,
        {
          operation: 'exportLogs',
        }
      );
    }

    try {
      const startDate = start instanceof Date ? start : new Date(start);
      const endDate = end instanceof Date ? end : new Date(end);

      const { rows } = await this.storage.query(
        `SELECT id, event_type, actor, actor_type, resource_type, resource_id, action, metadata, ip_address, user_agent, timestamp
         FROM audit_log
         WHERE timestamp >= $1 AND timestamp <= $2
         ORDER BY timestamp ASC`,
        [startDate, endDate]
      );

      this._log(
        `Exporting ${rows.length} audit log entries (${format}) from ${startDate.toISOString()} to ${endDate.toISOString()}`
      );

      if (format === 'csv') {
        return this._formatCsv(rows);
      }

      return JSON.stringify(rows, null, 2);
    } catch (err) {
      if (err instanceof AuditLoggerError) {
        throw err;
      }

      throw new AuditLoggerError(`Failed to export audit logs: ${err.message}`, {
        cause: err,
        operation: 'exportLogs',
      });
    }
  }

  /**
   * Apply retention policy by deleting audit logs older than the specified number of days
   *
   * @param {number} [days] - Number of days to retain (defaults to this.retentionDays)
   * @returns {Promise<number>} Number of deleted rows
   * @throws {AuditLoggerError} If deletion fails
   */
  async applyRetention(days) {
    const retentionDays = days ?? this.retentionDays;

    if (typeof retentionDays !== 'number' || retentionDays <= 0) {
      throw new AuditLoggerError('Retention days must be a positive number', {
        operation: 'applyRetention',
      });
    }

    try {
      const { rowCount } = await this.storage.query(
        `DELETE FROM audit_log WHERE timestamp < NOW() - $1 * INTERVAL '1 day'`,
        [retentionDays]
      );

      this._log(
        `Retention applied: deleted ${rowCount} audit log entries older than ${retentionDays} days`
      );
      return rowCount;
    } catch (err) {
      throw new AuditLoggerError(`Failed to apply retention: ${err.message}`, {
        cause: err,
        operation: 'applyRetention',
      });
    }
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  /**
   * Validate an audit event has required fields
   *
   * @param {Object} event - Event to validate
   * @throws {AuditLoggerError} If validation fails
   * @private
   */
  _validateEvent(event) {
    if (!event || typeof event !== 'object') {
      throw new AuditLoggerError('Event must be a non-null object', {
        operation: 'log',
      });
    }

    if (!event.type || typeof event.type !== 'string') {
      throw new AuditLoggerError('Event type must be a non-empty string', {
        operation: 'log',
      });
    }

    if (!event.actor || typeof event.actor !== 'string') {
      throw new AuditLoggerError('Event actor must be a non-empty string', {
        operation: 'log',
        eventType: event.type,
      });
    }

    if (!event.resourceType || typeof event.resourceType !== 'string') {
      throw new AuditLoggerError('Event resourceType must be a non-empty string', {
        operation: 'log',
        eventType: event.type,
      });
    }

    if (!event.action || typeof event.action !== 'string') {
      throw new AuditLoggerError('Event action must be a non-empty string', {
        operation: 'log',
        eventType: event.type,
      });
    }
  }

  /**
   * Format rows as CSV string
   *
   * @param {Array<Object>} rows - Database rows to format
   * @returns {string} CSV formatted string with headers
   * @private
   */
  _formatCsv(rows) {
    const headers = [
      'id',
      'event_type',
      'actor',
      'actor_type',
      'resource_type',
      'resource_id',
      'action',
      'metadata',
      'ip_address',
      'user_agent',
      'timestamp',
    ];

    const csvLines = [headers.join(',')];

    for (const row of rows) {
      const values = headers.map(header => {
        const val = row[header];
        if (val === null || val === undefined) {
          return '';
        }
        if (typeof val === 'object') {
          return `"${JSON.stringify(val).replace(/"/g, '""')}"`;
        }
        const str = String(val);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      });
      csvLines.push(values.join(','));
    }

    return csvLines.join('\n');
  }

  /**
   * Log a message if logger is available
   *
   * @param {string} message - Message to log
   * @private
   */
  _log(message) {
    if (this.logger) {
      this.logger(`[AuditLogger] ${message}`);
    }
  }
}
