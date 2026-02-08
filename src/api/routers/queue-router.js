/**
 * QueueRouter - HTTP router for message queue API endpoints
 *
 * Provides RESTful endpoints for queue operations:
 * - GET    /api/queue/:botId          -> Get queue depth and stats
 * - GET    /api/queue/:botId/messages -> List queued messages
 * - DELETE /api/queue/:botId          -> Clear pending messages
 *
 * Authentication via Bearer token in the Authorization header.
 * Uses Node.js built-in http module (no Express/Fastify dependency).
 *
 * @module api/routers/queue-router
 */

/**
 * Custom error for queue router failures
 */
export class QueueRouterError extends Error {
  /**
   * Create a QueueRouterError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error
   * @param {string} [options.endpoint] - The endpoint that failed
   * @param {number} [options.statusCode] - HTTP status code
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'QueueRouterError';
    this.endpoint = options.endpoint;
    this.statusCode = options.statusCode;
  }
}

/**
 * Route definition for matching incoming requests
 * @typedef {Object} Route
 * @property {string} method - HTTP method (GET, DELETE, etc.)
 * @property {RegExp} pattern - URL pattern to match
 * @property {string[]} paramNames - Named parameters extracted from URL
 * @property {Function} handler - Request handler function
 */

/**
 * QueueRouter - lightweight HTTP router for message queue endpoints
 *
 * @example
 * const router = new QueueRouter({
 *   messageQueue,
 *   apiKey: 'secret',
 * });
 * // In your HTTP server:
 * const handled = await router.handleRequest(req, res);
 * if (!handled) { // pass to next router }
 */
export class QueueRouter {
  /**
   * Create a QueueRouter instance
   *
   * @param {Object} options - Configuration options
   * @param {import('../../queue/message-queue.js').MessageQueue} options.messageQueue - MessageQueue instance
   * @param {string} [options.apiKey] - API key for authentication
   * @param {Function|null} [options.logger=null] - Logger function
   * @param {Object} [options.auditLogger] - AuditLogger instance for recording audit events
   */
  constructor(options = {}) {
    if (!options.messageQueue) {
      throw new QueueRouterError('MessageQueue is required', {
        endpoint: 'constructor',
      });
    }

    /** @type {import('../../queue/message-queue.js').MessageQueue} */
    this.messageQueue = options.messageQueue;

    /** @type {string|null} API key for authentication */
    this.apiKey = options.apiKey || null;

    /** @type {Function|null} Logger function */
    this.logger = options.logger !== undefined ? options.logger : null;

    /** @type {Object|null} AuditLogger for recording audit events */
    this.auditLogger = options.auditLogger || null;

    /** @type {Route[]} Registered routes */
    this.routes = [];

    this._registerRoutes();
  }

  /**
   * Register all queue API routes
   * @private
   */
  _registerRoutes() {
    this._addRoute('GET', '/api/queue/:botId/messages', req => this._handleListMessages(req));
    this._addRoute('GET', '/api/queue/:botId', req => this._handleGetQueue(req));
    this._addRoute('DELETE', '/api/queue/:botId', req => this._handleClearQueue(req));
  }

  /**
   * Add a route to the router
   *
   * @param {string} method - HTTP method
   * @param {string} path - URL path pattern (supports :paramName)
   * @param {Function} handler - Async handler function
   * @private
   */
  _addRoute(method, path, handler) {
    const paramNames = [];
    const patternStr = path.replace(/:([a-zA-Z0-9_]+)/g, (_match, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    const pattern = new RegExp(`^${patternStr}$`);
    this.routes.push({ method: method.toUpperCase(), pattern, paramNames, handler });
  }

  /**
   * Handle an incoming HTTP request
   *
   * Matches the request against registered routes, validates authentication,
   * and dispatches to the appropriate handler.
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
    if (!method) return false;

    // Only handle /api/queue paths
    if (!pathname.startsWith('/api/queue')) {
      return false;
    }

    // Find matching route
    for (const route of this.routes) {
      if (route.method !== method) continue;

      const match = pathname.match(route.pattern);
      if (!match) continue;

      // Extract params
      const params = {};
      route.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(match[i + 1]);
      });
      req.params = params;
      req.searchParams = url.searchParams;

      // Authenticate
      if (!this._authenticate(req)) {
        this._sendJson(res, 401, {
          error: 'Unauthorized',
          message: 'Valid API key required via Authorization: Bearer <key>',
        });
        return true;
      }

      // Handle request
      try {
        const result = await route.handler(req);
        this._sendJson(res, result.statusCode || 200, result.body);
      } catch (err) {
        this._log(`Queue API error on ${method} ${pathname}: ${err.message}`);
        const statusCode = err.statusCode || 500;
        this._sendJson(res, statusCode, {
          error: 'Internal Server Error',
          message: err.message,
        });
      }

      return true;
    }

    return false;
  }

  // ==========================================================================
  // Route Handlers
  // ==========================================================================

  /**
   * GET /api/queue/:botId
   *
   * Get queue depth and statistics for a bot.
   *
   * @param {import('http').IncomingMessage} req - HTTP request (with params.botId)
   * @returns {Promise<{statusCode: number, body: Object}>} Response
   * @private
   */
  async _handleGetQueue(req) {
    const { botId } = req.params;

    try {
      const [depth, stats] = await Promise.all([
        this.messageQueue.getQueueDepth(botId),
        this.messageQueue.getStats(botId),
      ]);

      return {
        statusCode: 200,
        body: {
          botId,
          depth,
          stats,
        },
      };
    } catch (err) {
      this._log(`Failed to get queue info for bot '${botId}': ${err.message}`);
      return {
        statusCode: 500,
        body: {
          error: 'Internal Server Error',
          message: `Failed to get queue info: ${err.message}`,
        },
      };
    }
  }

  /**
   * GET /api/queue/:botId/messages
   *
   * List queued messages for a bot. Returns pending and processing messages
   * from the database, ordered by priority and enqueue time.
   *
   * Query parameters:
   * - status -> Filter by message status (pending, processing, completed, failed)
   * - limit  -> Maximum messages to return (default 100, max 1000)
   *
   * @param {import('http').IncomingMessage} req - HTTP request (with params.botId)
   * @returns {Promise<{statusCode: number, body: Object}>} Response
   * @private
   */
  async _handleListMessages(req) {
    const { botId } = req.params;

    try {
      const statusFilter = req.searchParams?.get('status') || 'pending';
      const limitParam = req.searchParams?.get('limit');
      const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 100, 1), 1000) : 100;

      // Query directly from storage since MessageQueue doesn't have a list method
      const { rows } = await this.messageQueue.storage.query(
        `SELECT id, bot_id, channel_type, channel_id, user_id,
                message_text, priority, status, enqueued_at,
                started_at, completed_at, error
         FROM message_queue
         WHERE bot_id = $1 AND status = $2
         ORDER BY priority DESC, enqueued_at ASC
         LIMIT $3`,
        [botId, statusFilter, limit]
      );

      const messages = rows.map(row => ({
        id: row.id,
        botId: row.bot_id,
        channelType: row.channel_type,
        channelId: row.channel_id,
        userId: row.user_id,
        messageText: row.message_text,
        priority: row.priority,
        status: row.status,
        enqueuedAt: row.enqueued_at,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        error: row.error || null,
      }));

      return {
        statusCode: 200,
        body: {
          data: messages,
          count: messages.length,
          botId,
          status: statusFilter,
        },
      };
    } catch (err) {
      this._log(`Failed to list queue messages for bot '${botId}': ${err.message}`);
      return {
        statusCode: 500,
        body: {
          error: 'Internal Server Error',
          message: `Failed to list queue messages: ${err.message}`,
        },
      };
    }
  }

  /**
   * DELETE /api/queue/:botId
   *
   * Clear all pending messages from a bot's queue.
   *
   * @param {import('http').IncomingMessage} req - HTTP request (with params.botId)
   * @returns {Promise<{statusCode: number, body: Object}>} Response
   * @private
   */
  async _handleClearQueue(req) {
    const { botId } = req.params;

    try {
      const cleared = await this.messageQueue.clearQueue(botId);

      this._auditLog({
        type: 'queue.cleared',
        actor: this._extractActor(req),
        actorType: 'api',
        resourceType: 'queue',
        resourceId: botId,
        action: 'cleared',
        metadata: { cleared },
        ipAddress: this._extractIp(req),
        userAgent: req.headers?.['user-agent'] || null,
      });

      return {
        statusCode: 200,
        body: {
          success: true,
          botId,
          cleared,
          message: `Cleared ${cleared} pending message(s) from queue`,
        },
      };
    } catch (err) {
      this._log(`Failed to clear queue for bot '${botId}': ${err.message}`);
      return {
        statusCode: 500,
        body: {
          error: 'Internal Server Error',
          message: `Failed to clear queue: ${err.message}`,
        },
      };
    }
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

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
   * Log an audit event if an audit logger is available
   *
   * @param {Object} event - Audit event to log
   * @private
   */
  _auditLog(event) {
    if (this.auditLogger && typeof this.auditLogger.log === 'function') {
      this.auditLogger.log(event).catch(_err => {
        // Audit logging should never break the main flow
      });
    }
  }

  /**
   * Extract the actor identity from an HTTP request
   *
   * @param {import('http').IncomingMessage} req - HTTP request
   * @returns {string} Actor identifier
   * @private
   */
  _extractActor(req) {
    const authHeader = req?.headers?.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return `api-key:${authHeader.slice(7, 15)}***`;
    }
    return 'anonymous';
  }

  /**
   * Extract the client IP address from an HTTP request
   *
   * @param {import('http').IncomingMessage} req - HTTP request
   * @returns {string|null} Client IP address
   * @private
   */
  _extractIp(req) {
    const forwarded = req?.headers?.['x-forwarded-for'];
    if (forwarded) {
      return String(forwarded).split(',')[0].trim();
    }
    return req?.socket?.remoteAddress || null;
  }

  /**
   * Log a message using the configured logger
   *
   * @param {string} message - Message to log
   * @private
   */
  _log(message) {
    if (this.logger) {
      this.logger(`[QueueRouter] ${message}`);
    }
  }
}

export default QueueRouter;
