/**
 * SessionRouter - HTTP router for session management API endpoints
 *
 * Provides RESTful endpoints for session operations:
 * - GET    /api/sessions/:id          -> Get session details with history
 * - DELETE /api/sessions/:id          -> Delete a session
 * - GET    /api/sessions/:id/messages -> List session messages
 *
 * Authentication via Bearer token in the Authorization header.
 * Uses Node.js built-in http module (no Express/Fastify dependency).
 *
 * @module api/routers/session-router
 */

/**
 * Custom error for session router failures
 */
export class SessionRouterError extends Error {
  /**
   * Create a SessionRouterError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error
   * @param {string} [options.endpoint] - The endpoint that failed
   * @param {number} [options.statusCode] - HTTP status code
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'SessionRouterError';
    this.endpoint = options.endpoint;
    this.statusCode = options.statusCode;
  }
}

/**
 * Route definition for matching incoming requests
 * @typedef {Object} Route
 * @property {string} method - HTTP method (GET, POST, DELETE, etc.)
 * @property {RegExp} pattern - URL pattern to match
 * @property {string[]} paramNames - Named parameters extracted from URL
 * @property {Function} handler - Request handler function
 */

/**
 * SessionRouter - lightweight HTTP router for session management endpoints
 *
 * @example
 * const router = new SessionRouter({
 *   sessionManager,
 *   storage,
 *   apiKey: 'secret',
 * });
 * // In your HTTP server:
 * const handled = await router.handleRequest(req, res);
 * if (!handled) { // pass to next router }
 */
export class SessionRouter {
  /**
   * Create a SessionRouter instance
   *
   * @param {Object} options - Configuration options
   * @param {import('../../core/session-manager.js').SessionManager} options.sessionManager - SessionManager instance
   * @param {Object} options.storage - Storage instance for session lookups
   * @param {string} [options.apiKey] - API key for authentication
   * @param {Function|null} [options.logger=null] - Logger function
   * @param {Object} [options.auditLogger] - AuditLogger instance for recording audit events
   */
  constructor(options = {}) {
    if (!options.sessionManager) {
      throw new SessionRouterError('SessionManager is required', {
        endpoint: 'constructor',
      });
    }

    if (!options.storage) {
      throw new SessionRouterError('Storage is required', {
        endpoint: 'constructor',
      });
    }

    /** @type {import('../../core/session-manager.js').SessionManager} */
    this.sessionManager = options.sessionManager;

    /** @type {Object} Storage instance */
    this.storage = options.storage;

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
   * Register all session API routes
   * @private
   */
  _registerRoutes() {
    this._addRoute('GET', '/api/sessions/:id/messages', req => this._handleGetMessages(req));
    this._addRoute('GET', '/api/sessions/:id', req => this._handleGetSession(req));
    this._addRoute('DELETE', '/api/sessions/:id', req => this._handleDeleteSession(req));
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

    // Only handle /api/sessions paths
    if (!pathname.startsWith('/api/sessions')) {
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
        this._log(`Session API error on ${method} ${pathname}: ${err.message}`);
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
   * GET /api/sessions/:id
   *
   * Get session details including metadata and statistics.
   *
   * @param {import('http').IncomingMessage} req - HTTP request (with params.id)
   * @returns {Promise<{statusCode: number, body: Object}>} Response
   * @private
   */
  async _handleGetSession(req) {
    const { id } = req.params;

    try {
      const session = await this.storage.getSession(id);

      if (!session) {
        return {
          statusCode: 404,
          body: {
            error: 'Not Found',
            message: `Session '${id}' not found`,
          },
        };
      }

      const stats = this.sessionManager.getSessionStats(session);

      return {
        statusCode: 200,
        body: {
          id: session.id,
          botId: session.botId,
          userId: session.userId,
          channelId: session.channelId,
          channelType: session.channelType,
          tokenCount: session.tokenCount,
          compactionCount: session.compactionCount,
          createdAt: session.createdAt,
          lastMessageAt: session.lastMessageAt,
          stats,
        },
      };
    } catch (err) {
      this._log(`Failed to get session '${id}': ${err.message}`);
      return {
        statusCode: 500,
        body: {
          error: 'Internal Server Error',
          message: `Failed to get session: ${err.message}`,
        },
      };
    }
  }

  /**
   * DELETE /api/sessions/:id
   *
   * Delete a session and all its messages.
   *
   * @param {import('http').IncomingMessage} req - HTTP request (with params.id)
   * @returns {Promise<{statusCode: number, body: Object}>} Response
   * @private
   */
  async _handleDeleteSession(req) {
    const { id } = req.params;

    try {
      const deleted = await this.sessionManager.deleteSession(id);

      if (!deleted) {
        return {
          statusCode: 404,
          body: {
            error: 'Not Found',
            message: `Session '${id}' not found`,
          },
        };
      }

      this._auditLog({
        type: 'session.deleted',
        actor: this._extractActor(req),
        actorType: 'api',
        resourceType: 'session',
        resourceId: id,
        action: 'deleted',
        metadata: {},
        ipAddress: this._extractIp(req),
        userAgent: req.headers?.['user-agent'] || null,
      });

      return {
        statusCode: 200,
        body: {
          success: true,
          message: `Session '${id}' deleted`,
        },
      };
    } catch (err) {
      this._log(`Failed to delete session '${id}': ${err.message}`);
      return {
        statusCode: 500,
        body: {
          error: 'Internal Server Error',
          message: `Failed to delete session: ${err.message}`,
        },
      };
    }
  }

  /**
   * GET /api/sessions/:id/messages
   *
   * List messages within a session with optional pagination.
   *
   * Query parameters:
   * - limit  -> Maximum messages to return (default 100, max 1000)
   * - offset -> Number of messages to skip (default 0)
   *
   * @param {import('http').IncomingMessage} req - HTTP request (with params.id)
   * @returns {Promise<{statusCode: number, body: Object}>} Response
   * @private
   */
  async _handleGetMessages(req) {
    const { id } = req.params;

    try {
      const session = await this.storage.getSession(id);

      if (!session) {
        return {
          statusCode: 404,
          body: {
            error: 'Not Found',
            message: `Session '${id}' not found`,
          },
        };
      }

      const messages = session.messages || [];

      // Parse pagination params
      const limitParam = req.searchParams?.get('limit');
      const offsetParam = req.searchParams?.get('offset');

      const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 100, 1), 1000) : 100;
      const offset = offsetParam ? Math.max(parseInt(offsetParam, 10) || 0, 0) : 0;

      const paginated = messages.slice(offset, offset + limit);

      return {
        statusCode: 200,
        body: {
          data: paginated,
          count: paginated.length,
          total: messages.length,
          sessionId: id,
          limit,
          offset,
        },
      };
    } catch (err) {
      this._log(`Failed to get messages for session '${id}': ${err.message}`);
      return {
        statusCode: 500,
        body: {
          error: 'Internal Server Error',
          message: `Failed to get session messages: ${err.message}`,
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
      this.logger(`[SessionRouter] ${message}`);
    }
  }
}

export default SessionRouter;
