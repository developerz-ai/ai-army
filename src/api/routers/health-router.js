/**
 * HealthRouter - HTTP router providing the GET /health endpoint
 *
 * Returns aggregated health status JSON from the HealthMonitor.
 * Designed to work with load balancer health checks and monitoring
 * dashboards. Does not require authentication so that external
 * health probes (e.g., Docker, Kubernetes, ALB) can reach it.
 *
 * Response format:
 * ```json
 * {
 *   "status": "healthy",
 *   "timestamp": "2026-02-06T10:30:00Z",
 *   "uptime": 86400,
 *   "checks": {
 *     "database": { "status": "healthy", "latency": 5 },
 *     "bots": { "status": "healthy", "running": 4, "total": 5 }
 *   }
 * }
 * ```
 *
 * HTTP status codes:
 * - 200 → healthy or degraded
 * - 503 → unhealthy
 *
 * @module api/routers/health-router
 */

/**
 * Custom error for health router failures
 */
export class HealthRouterError extends Error {
  /**
   * Create a HealthRouterError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error
   * @param {string} [options.endpoint] - The endpoint that failed
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'HealthRouterError';
    this.endpoint = options.endpoint;
  }
}

/**
 * HealthRouter - lightweight HTTP router for the health endpoint
 *
 * @example
 * const router = new HealthRouter({ healthMonitor });
 * // In your HTTP server:
 * const handled = await router.handleRequest(req, res);
 * if (!handled) { // pass to next router }
 */
export class HealthRouter {
  /**
   * Create a HealthRouter instance
   *
   * @param {Object} options - Configuration options
   * @param {import('../../monitoring/HealthMonitor.js').HealthMonitor} options.healthMonitor - HealthMonitor instance
   * @param {Function} [options.logger] - Logger function (defaults to null)
   */
  constructor(options = {}) {
    if (!options.healthMonitor) {
      throw new HealthRouterError('HealthMonitor is required', {
        endpoint: 'constructor',
      });
    }

    /** @type {import('../../monitoring/HealthMonitor.js').HealthMonitor} */
    this.healthMonitor = options.healthMonitor;

    /** @type {Function|null} */
    this.logger = options.logger !== undefined ? options.logger : null;
  }

  /**
   * Handle an incoming HTTP request
   *
   * Matches GET /health and returns aggregated health status.
   * No authentication is required for health checks.
   *
   * @param {import('http').IncomingMessage} req - HTTP request
   * @param {import('http').ServerResponse} res - HTTP response
   * @returns {Promise<boolean>} True if the request was handled, false if no route matched
   */
  async handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const { pathname } = url;
    const method = (typeof req.method === 'string' ? req.method : '').toUpperCase();

    if (!method) {
      return false;
    }

    // GET /health
    if (method === 'GET' && pathname === '/health') {
      try {
        const result = await this._handleHealth();
        this._sendJson(res, result.statusCode, result.body);
      } catch (err) {
        this._log(`Health endpoint error: ${err.message}`);
        this._sendJson(res, 500, {
          status: 'unhealthy',
          error: 'Internal server error',
          timestamp: new Date().toISOString(),
        });
      }
      return true;
    }

    return false;
  }

  /**
   * GET /health handler
   *
   * Returns aggregated health status from the HealthMonitor.
   * Maps overall status to HTTP status codes:
   * - healthy/degraded → 200
   * - unhealthy → 503
   *
   * @returns {Promise<{statusCode: number, body: Object}>} Response
   * @private
   */
  async _handleHealth() {
    const healthStatus = this.healthMonitor.getStatus();

    // Map overall status to HTTP status code
    const statusCode = healthStatus.status === 'unhealthy' ? 503 : 200;

    return {
      statusCode,
      body: {
        status: healthStatus.status,
        timestamp: healthStatus.timestamp,
        uptime: healthStatus.uptime,
        checks: healthStatus.checks,
      },
    };
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
      this.logger(`[HealthRouter] ${message}`);
    }
  }
}

export default HealthRouter;
