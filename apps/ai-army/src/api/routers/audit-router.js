/**
 * AuditRouter - HTTP router providing audit log query, export, and stats endpoints
 *
 * Provides RESTful endpoints for accessing the audit trail:
 * - GET /api/audit          → Query audit logs with filters and pagination
 * - GET /api/audit/export   → Export logs in CSV or JSON format
 * - GET /api/audit/stats    → Audit log statistics and summaries
 *
 * Authentication via Bearer token in the Authorization header.
 * Uses Node.js built-in http module (no Express/Fastify dependency).
 *
 * Query parameters for GET /api/audit:
 * - actor        → Filter by actor identity
 * - actorType    → Filter by actor type (user, bot, system, api)
 * - resourceType → Filter by resource type
 * - resourceId   → Filter by resource identifier
 * - action       → Filter by action
 * - eventTypes   → Comma-separated list of event types
 * - startDate    → ISO 8601 start date
 * - endDate      → ISO 8601 end date
 * - limit        → Max rows to return (default 100, max 10000)
 * - offset       → Pagination offset
 *
 * Query parameters for GET /api/audit/export:
 * - startDate    → ISO 8601 start date (required)
 * - endDate      → ISO 8601 end date (required)
 * - format       → Export format: 'json' or 'csv' (default 'json')
 *
 * Query parameters for GET /api/audit/stats:
 * - startDate    → ISO 8601 start date (optional)
 * - endDate      → ISO 8601 end date (optional)
 *
 * @module api/routers/audit-router
 */

/**
 * Custom error for audit router failures
 */
export class AuditRouterError extends Error {
  /**
   * Create an AuditRouterError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error
   * @param {string} [options.endpoint] - The endpoint that failed
   * @param {number} [options.statusCode] - HTTP status code
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'AuditRouterError';
    this.endpoint = options.endpoint;
    this.statusCode = options.statusCode;
  }
}

/**
 * AuditRouter - lightweight HTTP router for audit log endpoints
 *
 * @example
 * const router = new AuditRouter({ auditLogger, apiKey: 'secret' });
 * // In your HTTP server:
 * const handled = await router.handleRequest(req, res);
 * if (!handled) { // pass to next router }
 */
export class AuditRouter {
  /**
   * Create an AuditRouter instance
   *
   * @param {Object} options - Configuration options
   * @param {import('../../audit/audit-logger.js').AuditLogger} options.auditLogger - AuditLogger instance
   * @param {string} [options.apiKey] - API key for authentication
   * @param {Function|null} [options.logger=null] - Logger function
   */
  constructor(options = {}) {
    if (!options.auditLogger) {
      throw new AuditRouterError('AuditLogger is required', {
        endpoint: 'constructor',
      });
    }

    /** @type {import('../../audit/audit-logger.js').AuditLogger} */
    this.auditLogger = options.auditLogger;

    /** @type {string|null} API key for authentication */
    this.apiKey = options.apiKey || null;

    /** @type {Function|null} Logger function */
    this.logger = options.logger !== undefined ? options.logger : null;
  }

  /**
   * Handle an incoming HTTP request
   *
   * Matches the request against registered audit endpoints and dispatches
   * to the appropriate handler. Requires Bearer token authentication.
   *
   * @param {import('http').IncomingMessage} req - HTTP request
   * @param {import('http').ServerResponse} res - HTTP response
   * @returns {Promise<boolean>} True if the request was handled, false if no route matched
   */
  async handleRequest(req, res) {
    // Defensively parse the URL to avoid crashes from malformed Host headers
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch (_err) {
      url = new URL(req.url, 'http://localhost');
    }
    const { pathname } = url;
    const method = (typeof req.method === 'string' ? req.method : '').toUpperCase();

    if (!method || method !== 'GET') {
      return false;
    }

    // Only handle /api/audit paths
    if (!pathname.startsWith('/api/audit')) {
      return false;
    }

    // Authenticate
    if (!this._authenticate(req)) {
      this._sendJson(res, 401, {
        error: 'Unauthorized',
        message: 'Valid API key required via Authorization: Bearer <key>',
      });
      return true;
    }

    try {
      // GET /api/audit/export (must match before /api/audit)
      if (pathname === '/api/audit/export') {
        const result = await this._handleExport(url.searchParams);
        if (result.contentType === 'text/csv') {
          this._sendCsv(res, result.statusCode, result.body);
        } else {
          this._sendJson(res, result.statusCode, result.body);
        }
        return true;
      }

      // GET /api/audit/stats
      if (pathname === '/api/audit/stats') {
        const result = await this._handleStats(url.searchParams);
        this._sendJson(res, result.statusCode, result.body);
        return true;
      }

      // GET /api/audit (exact match)
      if (pathname === '/api/audit') {
        const result = await this._handleQuery(url.searchParams);
        this._sendJson(res, result.statusCode, result.body);
        return true;
      }
    } catch (err) {
      this._log(`Audit endpoint error: ${err.message}`);
      this._sendJson(res, 500, {
        error: 'Internal Server Error',
        message: err.message,
      });
      return true;
    }

    return false;
  }

  /**
   * GET /api/audit handler
   *
   * Query audit logs with flexible filters and pagination.
   *
   * @param {URLSearchParams} searchParams - URL query parameters
   * @returns {Promise<{statusCode: number, body: Object}>} Response
   * @private
   */
  async _handleQuery(searchParams) {
    const filters = this._parseQueryFilters(searchParams);

    const logs = await this.auditLogger.query(filters);

    return {
      statusCode: 200,
      body: {
        data: logs,
        count: logs.length,
        filters: {
          actor: filters.actor || null,
          actorType: filters.actorType || null,
          resourceType: filters.resourceType || null,
          resourceId: filters.resourceId || null,
          action: filters.action || null,
          eventTypes: filters.eventTypes || null,
          startDate: filters.startDate || null,
          endDate: filters.endDate || null,
          limit: filters.limit,
          offset: filters.offset,
        },
      },
    };
  }

  /**
   * GET /api/audit/export handler
   *
   * Export audit logs for a date range in CSV or JSON format.
   * Both startDate and endDate are required query parameters.
   *
   * @param {URLSearchParams} searchParams - URL query parameters
   * @returns {Promise<{statusCode: number, body: *, contentType: string}>} Response
   * @private
   */
  async _handleExport(searchParams) {
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const format = searchParams.get('format') || 'json';

    if (!startDate) {
      return {
        statusCode: 400,
        contentType: 'application/json',
        body: {
          error: 'Bad Request',
          message: 'startDate query parameter is required',
        },
      };
    }

    if (!endDate) {
      return {
        statusCode: 400,
        contentType: 'application/json',
        body: {
          error: 'Bad Request',
          message: 'endDate query parameter is required',
        },
      };
    }

    if (!['json', 'csv'].includes(format)) {
      return {
        statusCode: 400,
        contentType: 'application/json',
        body: {
          error: 'Bad Request',
          message: `Invalid format: ${format}. Must be 'json' or 'csv'`,
        },
      };
    }

    const exportData = await this.auditLogger.exportLogs(startDate, endDate, format);

    if (format === 'csv') {
      return {
        statusCode: 200,
        contentType: 'text/csv',
        body: exportData,
      };
    }

    // For JSON format, parse the string back to return as structured JSON
    const parsed = JSON.parse(exportData);
    return {
      statusCode: 200,
      contentType: 'application/json',
      body: {
        format,
        startDate,
        endDate,
        count: parsed.length,
        data: parsed,
      },
    };
  }

  /**
   * GET /api/audit/stats handler
   *
   * Return audit log statistics aggregated from the database.
   * Queries total count, counts by event type, by actor type, and by resource type.
   *
   * @param {URLSearchParams} searchParams - URL query parameters
   * @returns {Promise<{statusCode: number, body: Object}>} Response
   * @private
   */
  async _handleStats(searchParams) {
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    const filters = {};
    if (startDate) {
      filters.startDate = startDate;
    }
    if (endDate) {
      filters.endDate = endDate;
    }

    // Build WHERE clause for date filtering
    const { whereClause, params } = this._buildDateWhereClause(filters);

    // Run all stat queries in parallel
    const [totalResult, byEventTypeResult, byActorTypeResult, byResourceTypeResult] =
      await Promise.all([
        this.auditLogger.storage.query(
          `SELECT COUNT(*)::int AS total FROM audit_log${whereClause}`,
          params
        ),
        this.auditLogger.storage.query(
          `SELECT event_type, COUNT(*)::int AS count FROM audit_log${whereClause} GROUP BY event_type ORDER BY count DESC`,
          params
        ),
        this.auditLogger.storage.query(
          `SELECT actor_type, COUNT(*)::int AS count FROM audit_log${whereClause} GROUP BY actor_type ORDER BY count DESC`,
          params
        ),
        this.auditLogger.storage.query(
          `SELECT resource_type, COUNT(*)::int AS count FROM audit_log${whereClause} GROUP BY resource_type ORDER BY count DESC`,
          params
        ),
      ]);

    const total = totalResult.rows[0]?.total ?? 0;

    // Transform rows into key-value maps
    const byEventType = {};
    for (const row of byEventTypeResult.rows) {
      byEventType[row.event_type] = row.count;
    }

    const byActorType = {};
    for (const row of byActorTypeResult.rows) {
      byActorType[row.actor_type] = row.count;
    }

    const byResourceType = {};
    for (const row of byResourceTypeResult.rows) {
      byResourceType[row.resource_type] = row.count;
    }

    return {
      statusCode: 200,
      body: {
        total,
        byEventType,
        byActorType,
        byResourceType,
        filters: {
          startDate: startDate || null,
          endDate: endDate || null,
        },
      },
    };
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  /**
   * Parse query parameters into filter object for AuditLogger.query()
   *
   * @param {URLSearchParams} searchParams - URL query parameters
   * @returns {Object} Parsed filters
   * @private
   */
  _parseQueryFilters(searchParams) {
    const filters = {};

    const actor = searchParams.get('actor');
    if (actor) {
      filters.actor = actor;
    }

    const actorType = searchParams.get('actorType');
    if (actorType) {
      filters.actorType = actorType;
    }

    const resourceType = searchParams.get('resourceType');
    if (resourceType) {
      filters.resourceType = resourceType;
    }

    const resourceId = searchParams.get('resourceId');
    if (resourceId) {
      filters.resourceId = resourceId;
    }

    const action = searchParams.get('action');
    if (action) {
      filters.action = action;
    }

    const eventTypes = searchParams.get('eventTypes');
    if (eventTypes) {
      filters.eventTypes = eventTypes.split(',').map(t => t.trim());
    }

    const startDate = searchParams.get('startDate');
    if (startDate) {
      filters.startDate = startDate;
    }

    const endDate = searchParams.get('endDate');
    if (endDate) {
      filters.endDate = endDate;
    }

    const limit = searchParams.get('limit');
    if (limit) {
      const parsed = parseInt(limit, 10);
      if (!isNaN(parsed) && parsed > 0) {
        filters.limit = parsed;
      }
    }

    const offset = searchParams.get('offset');
    if (offset) {
      const parsed = parseInt(offset, 10);
      if (!isNaN(parsed) && parsed >= 0) {
        filters.offset = parsed;
      }
    }

    return filters;
  }

  /**
   * Build a WHERE clause for date filtering in stats queries
   *
   * @param {Object} filters - Filter object with optional startDate and endDate
   * @returns {{whereClause: string, params: Array}} SQL WHERE clause and parameters
   * @private
   */
  _buildDateWhereClause(filters) {
    const conditions = [];
    const params = [];

    if (filters.startDate) {
      params.push(
        filters.startDate instanceof Date ? filters.startDate : new Date(filters.startDate)
      );
      conditions.push(`timestamp >= $${params.length}`);
    }

    if (filters.endDate) {
      params.push(filters.endDate instanceof Date ? filters.endDate : new Date(filters.endDate));
      conditions.push(`timestamp <= $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

    return { whereClause, params };
  }

  /**
   * Validate the Authorization header against the configured API key
   *
   * If no API key is configured, all requests are allowed (development mode).
   *
   * @param {import('http').IncomingMessage} req - HTTP request
   * @returns {boolean} True if authenticated
   * @private
   */
  _authenticate(req) {
    if (!this.apiKey) {
      return true;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return false;
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return false;
    }

    return parts[1] === this.apiKey;
  }

  /**
   * Send a JSON response
   *
   * @param {import('http').ServerResponse} res - HTTP response
   * @param {number} statusCode - HTTP status code
   * @param {Object} body - Response body
   * @private
   */
  _sendJson(res, statusCode, body) {
    const json = JSON.stringify(body);
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(json),
    });
    res.end(json);
  }

  /**
   * Send a CSV response
   *
   * @param {import('http').ServerResponse} res - HTTP response
   * @param {number} statusCode - HTTP status code
   * @param {string} csvData - CSV string content
   * @private
   */
  _sendCsv(res, statusCode, csvData) {
    res.writeHead(statusCode, {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="audit-logs.csv"',
      'Content-Length': Buffer.byteLength(csvData),
    });
    res.end(csvData);
  }

  /**
   * Log a message using the configured logger
   *
   * @param {string} message - Message to log
   * @private
   */
  _log(message) {
    if (this.logger) {
      this.logger(`[AuditRouter] ${message}`);
    }
  }
}

export default AuditRouter;
