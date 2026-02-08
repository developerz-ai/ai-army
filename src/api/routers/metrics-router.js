/**
 * MetricsRouter - HTTP router for metrics API endpoints
 *
 * Provides RESTful endpoints for system metrics:
 * - GET /api/metrics                -> Overall system metrics
 * - GET /api/metrics/bots/:id       -> Bot-specific metrics
 * - GET /api/metrics/channels/:name -> Channel-specific metrics
 *
 * Authentication via Bearer token in the Authorization header.
 * Uses Node.js built-in http module (no Express/Fastify dependency).
 *
 * @module api/routers/metrics-router
 */

/**
 * Custom error for metrics router failures
 */
export class MetricsRouterError extends Error {
  /**
   * Create a MetricsRouterError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error
   * @param {string} [options.endpoint] - The endpoint that failed
   * @param {number} [options.statusCode] - HTTP status code
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'MetricsRouterError';
    this.endpoint = options.endpoint;
    this.statusCode = options.statusCode;
  }
}

/**
 * Route definition for matching incoming requests
 * @typedef {Object} Route
 * @property {string} method - HTTP method (GET, etc.)
 * @property {RegExp} pattern - URL pattern to match
 * @property {string[]} paramNames - Named parameters extracted from URL
 * @property {Function} handler - Request handler function
 */

/**
 * MetricsRouter - lightweight HTTP router for metrics endpoints
 *
 * @example
 * const router = new MetricsRouter({
 *   metricsCollector,
 *   botManager,
 *   apiKey: 'secret',
 * });
 * // In your HTTP server:
 * const handled = await router.handleRequest(req, res);
 * if (!handled) { // pass to next router }
 */
export class MetricsRouter {
  /**
   * Create a MetricsRouter instance
   *
   * @param {Object} options - Configuration options
   * @param {import('../../monitoring/MetricsCollector.js').MetricsCollector} options.metricsCollector - MetricsCollector instance
   * @param {import('../../core/bot-manager.js').BotManager} [options.botManager] - BotManager for bot counts
   * @param {string} [options.apiKey] - API key for authentication
   * @param {Function|null} [options.logger=null] - Logger function
   */
  constructor(options = {}) {
    if (!options.metricsCollector) {
      throw new MetricsRouterError('MetricsCollector is required', {
        endpoint: 'constructor',
      });
    }

    /** @type {import('../../monitoring/MetricsCollector.js').MetricsCollector} */
    this.metricsCollector = options.metricsCollector;

    /** @type {import('../../core/bot-manager.js').BotManager|null} */
    this.botManager = options.botManager || null;

    /** @type {string|null} API key for authentication */
    this.apiKey = options.apiKey || null;

    /** @type {Function|null} Logger function */
    this.logger = options.logger !== undefined ? options.logger : null;

    /** @type {Route[]} Registered routes */
    this.routes = [];

    this._registerRoutes();
  }

  /**
   * Register all metrics API routes
   * @private
   */
  _registerRoutes() {
    this._addRoute('GET', '/api/metrics/bots/:id', req => this._handleBotMetrics(req));
    this._addRoute('GET', '/api/metrics/channels/:name', req => this._handleChannelMetrics(req));
    this._addRoute('GET', '/api/metrics', req => this._handleSystemMetrics(req));
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
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const { pathname } = url;
    const method = (typeof req.method === 'string' ? req.method : '').toUpperCase();
    if (!method) return false;

    // Only handle /api/metrics paths and GET method
    if (method !== 'GET' || !pathname.startsWith('/api/metrics')) {
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
        this._log(`Metrics API error on ${method} ${pathname}: ${err.message}`);
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
   * GET /api/metrics
   *
   * Return overall system metrics including bot counts, message stats,
   * and queue status.
   *
   * Query parameters:
   * - since -> ISO 8601 date to filter metrics from (default: last hour)
   *
   * @param {import('http').IncomingMessage} req - HTTP request
   * @returns {Promise<{statusCode: number, body: Object}>} Response
   * @private
   */
  async _handleSystemMetrics(req) {
    try {
      const sinceParam = req.searchParams?.get('since');
      const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 3600000);

      // Gather bot info
      let botStats = { total: 0, running: 0, stopped: 0 };
      if (this.botManager) {
        const bots = this.botManager.listBots();
        botStats = {
          total: bots.length,
          running: bots.filter(b => b.status === 'running').length,
          stopped: bots.filter(b => b.status === 'stopped').length,
        };
      }

      // Query recent metrics
      const recentMetrics = await this.metricsCollector.query({
        since,
        limit: 500,
      });

      // Aggregate message metrics
      const messageMetrics = recentMetrics.filter(m => m.component === 'messages');
      const responseTimeMetrics = recentMetrics.filter(
        m => m.component === 'messages' && m.metric === 'response_time_ms'
      );

      const avgResponseTime =
        responseTimeMetrics.length > 0
          ? Math.round(
              responseTimeMetrics.reduce((sum, m) => sum + m.value, 0) / responseTimeMetrics.length
            )
          : null;

      // Queue metrics
      const queueMetrics = recentMetrics.filter(m => m.component === 'queue');

      return {
        statusCode: 200,
        body: {
          timestamp: new Date().toISOString(),
          bots: botStats,
          messages: {
            total: messageMetrics.length,
            avgResponseTimeMs: avgResponseTime,
          },
          queue: {
            metrics: queueMetrics.length,
          },
          since: since.toISOString(),
          metricsCount: recentMetrics.length,
        },
      };
    } catch (err) {
      this._log(`Failed to get system metrics: ${err.message}`);
      return {
        statusCode: 500,
        body: {
          error: 'Internal Server Error',
          message: `Failed to get system metrics: ${err.message}`,
        },
      };
    }
  }

  /**
   * GET /api/metrics/bots/:id
   *
   * Return metrics for a specific bot.
   *
   * Query parameters:
   * - since -> ISO 8601 date to filter metrics from (default: last hour)
   * - limit -> Maximum metrics to return (default 200, max 1000)
   *
   * @param {import('http').IncomingMessage} req - HTTP request (with params.id)
   * @returns {Promise<{statusCode: number, body: Object}>} Response
   * @private
   */
  async _handleBotMetrics(req) {
    const { id } = req.params;

    try {
      const sinceParam = req.searchParams?.get('since');
      const limitParam = req.searchParams?.get('limit');
      const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 3600000);
      const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 200, 1), 1000) : 200;

      // Query metrics for this specific bot component
      const metrics = await this.metricsCollector.query({
        component: `bot:${id}`,
        since,
        limit,
      });

      // Also get latest snapshot
      let latest = {};
      try {
        latest = await this.metricsCollector.getLatest(`bot:${id}`);
      } catch (_err) {
        // getLatest may fail if no data exists yet
      }

      // Get bot info if available
      let botInfo = null;
      if (this.botManager) {
        const bot = this.botManager.getBot(id);
        if (bot) {
          botInfo = {
            id: bot.id,
            status: bot.status,
          };
        }
      }

      return {
        statusCode: 200,
        body: {
          botId: id,
          bot: botInfo,
          latest,
          metrics: metrics.map(m => ({
            metric: m.metric,
            value: m.value,
            timestamp: m.timestamp,
          })),
          count: metrics.length,
          since: since.toISOString(),
        },
      };
    } catch (err) {
      this._log(`Failed to get metrics for bot '${id}': ${err.message}`);
      return {
        statusCode: 500,
        body: {
          error: 'Internal Server Error',
          message: `Failed to get bot metrics: ${err.message}`,
        },
      };
    }
  }

  /**
   * GET /api/metrics/channels/:name
   *
   * Return metrics for a specific channel.
   *
   * Query parameters:
   * - since -> ISO 8601 date to filter metrics from (default: last hour)
   * - limit -> Maximum metrics to return (default 200, max 1000)
   *
   * @param {import('http').IncomingMessage} req - HTTP request (with params.name)
   * @returns {Promise<{statusCode: number, body: Object}>} Response
   * @private
   */
  async _handleChannelMetrics(req) {
    const { name } = req.params;

    try {
      const sinceParam = req.searchParams?.get('since');
      const limitParam = req.searchParams?.get('limit');
      const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 3600000);
      const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 200, 1), 1000) : 200;

      // Query metrics for this specific channel component
      const metrics = await this.metricsCollector.query({
        component: `channel:${name}`,
        since,
        limit,
      });

      // Also get latest snapshot
      let latest = {};
      try {
        latest = await this.metricsCollector.getLatest(`channel:${name}`);
      } catch (_err) {
        // getLatest may fail if no data exists yet
      }

      return {
        statusCode: 200,
        body: {
          channel: name,
          latest,
          metrics: metrics.map(m => ({
            metric: m.metric,
            value: m.value,
            timestamp: m.timestamp,
          })),
          count: metrics.length,
          since: since.toISOString(),
        },
      };
    } catch (err) {
      this._log(`Failed to get metrics for channel '${name}': ${err.message}`);
      return {
        statusCode: 500,
        body: {
          error: 'Internal Server Error',
          message: `Failed to get channel metrics: ${err.message}`,
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
   * Log a message using the configured logger
   *
   * @param {string} message - Message to log
   * @private
   */
  _log(message) {
    if (this.logger) {
      this.logger(`[MetricsRouter] ${message}`);
    }
  }
}

export default MetricsRouter;
