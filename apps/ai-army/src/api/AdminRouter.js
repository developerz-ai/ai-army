/**
 * AdminRouter - HTTP Admin API for managing the AI Army
 *
 * Provides RESTful endpoints for runtime management:
 * - POST /api/admin/reload       → Validate and reload configuration
 * - GET  /api/admin/status       → Show bot states, uptime, system health
 * - POST /api/admin/bots/:botId/restart → Restart a specific bot
 * - POST /api/admin/bots/:botId/reload  → Reload a specific bot config
 *
 * Authentication via Bearer token in the Authorization header.
 * Uses Node.js built-in http module (no Express/Fastify dependency).
 *
 * @module api/AdminRouter
 */

/**
 * Custom error for admin API failures
 */
export class AdminRouterError extends Error {
  /**
   * Create an AdminRouterError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error
   * @param {string} [options.endpoint] - The endpoint that failed
   * @param {number} [options.statusCode] - HTTP status code
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'AdminRouterError';
    this.endpoint = options.endpoint;
    this.statusCode = options.statusCode;
  }
}

/**
 * Route definition for matching incoming requests
 * @typedef {Object} Route
 * @property {string} method - HTTP method (GET, POST, etc.)
 * @property {RegExp} pattern - URL pattern to match
 * @property {string[]} paramNames - Named parameters extracted from URL
 * @property {Function} handler - Request handler function
 */

/**
 * AdminRouter - lightweight HTTP router for admin endpoints
 */
export class AdminRouter {
  /**
   * Create an AdminRouter instance
   *
   * @param {Object} options - Configuration options
   * @param {Object} options.orchestrator - Orchestrator instance for reload/status
   * @param {string} [options.apiKey] - Admin API key for authentication
   * @param {Function} [options.logger] - Logger function (defaults to console.log)
   * @param {Object} [options.auditLogger] - AuditLogger instance for recording audit events
   */
  constructor(options = {}) {
    if (!options.orchestrator) {
      throw new AdminRouterError('Orchestrator is required', {
        endpoint: 'constructor',
      });
    }

    this.orchestrator = options.orchestrator;
    this.apiKey = options.apiKey || process.env.ADMIN_API_KEY || null;
    this.logger = options.logger !== undefined ? options.logger : console.log;

    /** @type {Object|null} AuditLogger for recording audit events */
    this.auditLogger = options.auditLogger || null;

    /** @type {Route[]} */
    this.routes = [];

    this._registerRoutes();
  }

  /**
   * Register all admin API routes
   * @private
   */
  _registerRoutes() {
    this._addRoute('POST', '/api/admin/reload', req => this._handleReload(req));
    this._addRoute('GET', '/api/admin/status', req => this._handleStatus(req));
    this._addRoute('POST', '/api/admin/bots/:botId/restart', req => this._handleBotRestart(req));
    this._addRoute('POST', '/api/admin/bots/:botId/reload', req => this._handleBotReload(req));
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
   * @param {http.IncomingMessage} req - HTTP request
   * @param {http.ServerResponse} res - HTTP response
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
        this._log(`Admin API error on ${method} ${pathname}: ${err.message}`);
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

  /**
   * POST /api/admin/reload
   *
   * Validate and reload the full configuration via orchestrator.reload().
   *
   * @param {http.IncomingMessage} _req - HTTP request
   * @returns {Promise<{statusCode: number, body: Object}>} Response
   * @private
   */
  async _handleReload(_req) {
    try {
      const result = await this.orchestrator.reload();
      const { reloaded = [], failed = [] } = result;

      const success = failed.length === 0;
      const statusCode = success ? 200 : 207;

      const actor = this._extractActor(_req);
      this._auditLog({
        type: 'config.reloaded',
        actor,
        actorType: 'api',
        resourceType: 'config',
        resourceId: null,
        action: 'reloaded',
        metadata: {
          success,
          botsReloaded: reloaded.length,
          failedCount: failed.length,
        },
        ipAddress: this._extractIp(_req),
        userAgent: _req.headers?.['user-agent'] || null,
      });

      return {
        statusCode,
        body: {
          success,
          message: success ? 'Configuration reloaded' : 'Configuration reloaded with errors',
          botsReloaded: reloaded.length,
          reloaded,
          failed,
        },
      };
    } catch (err) {
      return {
        statusCode: 500,
        body: {
          success: false,
          message: `Reload failed: ${err.message}`,
          botsReloaded: 0,
          reloaded: [],
          failed: [{ error: err.message }],
        },
      };
    }
  }

  /**
   * GET /api/admin/status
   *
   * Return system status including bot states, uptime, and component health.
   *
   * @param {http.IncomingMessage} _req - HTTP request
   * @returns {Promise<{statusCode: number, body: Object}>} Response
   * @private
   */
  async _handleStatus(_req) {
    const status = this.orchestrator.getStatus();

    // Build per-bot status list
    const bots = [];
    if (this.orchestrator.botManager) {
      for (const bot of this.orchestrator.botManager.listBots()) {
        bots.push({
          id: bot.id,
          status: bot.status,
          model: bot.config?.model || null,
          lastActiveAt: bot.lastActiveAt || null,
        });
      }
    }

    return {
      statusCode: 200,
      body: {
        state: status.state,
        uptime: status.uptime,
        startedAt: status.startedAt,
        botCount: status.botCount,
        channelCount: status.channelCount,
        middlewareCount: status.middlewareCount,
        databaseConnected: status.databaseConnected,
        messageProcessorReady: status.messageProcessorReady,
        messageRouterReady: status.messageRouterReady,
        bots,
      },
    };
  }

  /**
   * POST /api/admin/bots/:botId/restart
   *
   * Restart a specific bot by stopping and starting it.
   *
   * @param {http.IncomingMessage} req - HTTP request (with params.botId)
   * @returns {Promise<{statusCode: number, body: Object}>} Response
   * @private
   */
  async _handleBotRestart(req) {
    const { botId } = req.params;

    if (!this.orchestrator.botManager) {
      return {
        statusCode: 503,
        body: {
          success: false,
          botId,
          message: 'BotManager not available',
        },
      };
    }

    const bot = this.orchestrator.botManager.getBot(botId);
    if (!bot) {
      return {
        statusCode: 404,
        body: {
          success: false,
          botId,
          message: `Bot '${botId}' not found`,
        },
      };
    }

    try {
      await this.orchestrator.botManager.stopBot(botId);
      await this.orchestrator.botManager.startBot(botId);

      const actor = this._extractActor(req);
      this._auditLog({
        type: 'bot.started',
        actor,
        actorType: 'api',
        resourceType: 'bot',
        resourceId: botId,
        action: 'restarted',
        metadata: { triggeredBy: 'admin_api' },
        ipAddress: this._extractIp(req),
        userAgent: req.headers?.['user-agent'] || null,
      });

      return {
        statusCode: 200,
        body: {
          success: true,
          botId,
          message: `Bot '${botId}' restarted`,
        },
      };
    } catch (err) {
      return {
        statusCode: 500,
        body: {
          success: false,
          botId,
          message: `Failed to restart bot '${botId}': ${err.message}`,
        },
      };
    }
  }

  /**
   * POST /api/admin/bots/:botId/reload
   *
   * Reload a specific bot's configuration without full restart.
   * Uses BotReloader for granular reload when available, falls back
   * to BotManager.reloadBot().
   *
   * @param {http.IncomingMessage} req - HTTP request (with params.botId)
   * @returns {Promise<{statusCode: number, body: Object}>} Response
   * @private
   */
  async _handleBotReload(req) {
    const { botId } = req.params;

    if (!this.orchestrator.botManager) {
      return {
        statusCode: 503,
        body: {
          success: false,
          botId,
          message: 'BotManager not available',
        },
      };
    }

    const bot = this.orchestrator.botManager.getBot(botId);
    if (!bot) {
      return {
        statusCode: 404,
        body: {
          success: false,
          botId,
          message: `Bot '${botId}' not found`,
        },
      };
    }

    try {
      // Load fresh config from disk to compare against current
      const newConfigs = await this.orchestrator._discoverBotConfigs();
      const newConfig = newConfigs.get(botId);
      if (!newConfig) {
        return {
          statusCode: 404,
          body: {
            success: false,
            botId,
            message: `Config for bot '${botId}' not found on disk`,
          },
        };
      }

      let needsContainerRestart = false;

      if (this.orchestrator.botReloader) {
        needsContainerRestart = this.orchestrator.botReloader.needsContainerRestart(
          bot.config,
          newConfig
        );
        await this.orchestrator.botReloader.reloadBotConfig(botId, newConfig);
      } else if (typeof this.orchestrator.botManager.reloadBot === 'function') {
        await this.orchestrator.botManager.reloadBot(botId, newConfig);
      } else {
        return {
          statusCode: 501,
          body: {
            success: false,
            botId,
            message: 'No reload mechanism available (neither BotReloader nor BotManager.reloadBot)',
          },
        };
      }

      const actor = this._extractActor(req);
      this._auditLog({
        type: 'bot.config_updated',
        actor,
        actorType: 'api',
        resourceType: 'bot',
        resourceId: botId,
        action: 'config_reloaded',
        metadata: {
          needsContainerRestart,
          triggeredBy: 'admin_api',
        },
        ipAddress: this._extractIp(req),
        userAgent: req.headers?.['user-agent'] || null,
      });

      return {
        statusCode: 200,
        body: {
          success: true,
          botId,
          needsContainerRestart,
          message: `Bot '${botId}' config reloaded`,
        },
      };
    } catch (err) {
      return {
        statusCode: 500,
        body: {
          success: false,
          botId,
          message: `Failed to reload bot '${botId}': ${err.message}`,
        },
      };
    }
  }

  /**
   * Validate the Authorization header against the configured API key
   *
   * If no API key is configured, all requests are allowed (development mode).
   *
   * @param {http.IncomingMessage} req - HTTP request
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
   * @param {http.ServerResponse} res - HTTP response
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
   * Safely calls the audit logger, catching any errors to prevent
   * audit logging from breaking the main flow.
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
   * Uses the Authorization header to identify the actor. Falls back
   * to 'anonymous' if no auth header is present.
   *
   * @param {http.IncomingMessage} req - HTTP request
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
   * Checks X-Forwarded-For header first, then falls back to
   * the socket remote address.
   *
   * @param {http.IncomingMessage} req - HTTP request
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
      this.logger(message);
    }
  }
}

export default AdminRouter;
