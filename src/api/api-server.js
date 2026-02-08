/**
 * APIServer - HTTP API server using Node.js built-in http module
 *
 * Wraps the AdminRouter, HealthRouter, AuditRouter, and any future
 * routers into a single HTTP server with shared authentication,
 * rate limiting, and CORS support.
 *
 * Uses Node.js built-in `http` module (no Express/Fastify dependency).
 * Follows the same `_addRoute()`, `_sendJson()`, `_authenticate()`
 * patterns established in AdminRouter.
 *
 * Features:
 * - Composable router chain (AdminRouter, HealthRouter, custom routers)
 * - Integrated AuthMiddleware for token-based auth
 * - Integrated RateLimiter for per-IP rate limiting
 * - CORS support for cross-origin requests
 * - JSON body parsing for POST/PUT/PATCH requests
 * - Graceful start/stop lifecycle
 *
 * @module api/api-server
 */

import { createServer } from 'node:http';

import { AuthMiddleware } from './auth-middleware.js';
import { RateLimiter } from './rate-limiter.js';

/**
 * Custom error for API server failures
 */
export class APIServerError extends Error {
  /**
   * Create an APIServerError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error
   * @param {string} [options.operation] - The operation that failed
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'APIServerError';
    this.operation = options.operation;
  }
}

/**
 * Route definition for matching incoming requests
 * @typedef {Object} Route
 * @property {string} method - HTTP method (GET, POST, etc.)
 * @property {RegExp} pattern - URL pattern to match
 * @property {string[]} paramNames - Named parameters extracted from URL
 * @property {Function} handler - Request handler function
 * @property {Object} [options] - Route options
 * @property {string} [options.requiredRole] - Required role for this route
 * @property {boolean} [options.skipAuth] - Skip authentication for this route
 * @property {boolean} [options.skipRateLimit] - Skip rate limiting for this route
 */

/**
 * APIServer - HTTP server with routing, auth, and rate limiting
 *
 * @example
 * const server = new APIServer({
 *   routers: [adminRouter, healthRouter],
 *   auth: { tokens: [{ token: 'secret', role: 'admin' }] },
 *   rateLimit: { max: 100, windowMs: 60000 },
 * });
 * await server.start(3000);
 * // ... later
 * await server.stop();
 */
export class APIServer {
  /**
   * Create an APIServer instance
   *
   * @param {Object} [options={}] - Configuration options
   * @param {Object[]} [options.routers=[]] - Array of router instances with handleRequest(req, res)
   * @param {Object} [options.auth={}] - AuthMiddleware options (tokens, defaultRole)
   * @param {Object} [options.rateLimit={}] - RateLimiter options (max, windowMs, bypassIps)
   * @param {Object} [options.cors={}] - CORS configuration
   * @param {string[]} [options.cors.origins=['*']] - Allowed origins
   * @param {string[]} [options.cors.methods] - Allowed methods
   * @param {string[]} [options.cors.headers] - Allowed headers
   * @param {Function|null} [options.logger=null] - Logger function
   */
  constructor(options = {}) {
    /** @type {Object[]} Registered routers */
    this.routers = options.routers || [];

    /** @type {Route[]} Directly registered routes */
    this.routes = [];

    /** @type {AuthMiddleware} Authentication middleware */
    this.auth = new AuthMiddleware(options.auth || {});

    /** @type {RateLimiter} Rate limiter */
    this.rateLimiter = new RateLimiter(options.rateLimit || {});

    /** @type {Object} CORS configuration */
    this.cors = {
      origins: options.cors?.origins || ['*'],
      methods: options.cors?.methods || ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      headers: options.cors?.headers || ['Content-Type', 'Authorization', 'X-Request-ID'],
    };

    /** @type {Function|null} Logger function */
    this.logger = options.logger !== undefined ? options.logger : null;

    /** @type {import('http').Server|null} HTTP server instance */
    this.server = null;

    /** @type {number|null} Port the server is listening on */
    this.port = null;

    /** @type {string} Host the server is bound to */
    this.host = '0.0.0.0';

    /** @type {boolean} Whether the server is running */
    this.running = false;
  }

  /**
   * Add a router to the chain
   *
   * Routers are tried in order. Each router's handleRequest(req, res)
   * method is called; if it returns true, the request is considered handled.
   *
   * @param {Object} router - Router instance with handleRequest(req, res) method
   */
  addRouter(router) {
    if (!router || typeof router.handleRequest !== 'function') {
      throw new APIServerError('Router must have a handleRequest(req, res) method', {
        operation: 'addRouter',
      });
    }
    this.routers.push(router);
  }

  /**
   * Add a route directly to the server
   *
   * Uses the same pattern as AdminRouter._addRoute() for consistency.
   *
   * @param {string} method - HTTP method
   * @param {string} path - URL path pattern (supports :paramName)
   * @param {Function} handler - Async handler function (req) => { statusCode, body }
   * @param {Object} [options={}] - Route options
   * @param {string} [options.requiredRole] - Required role for this route
   * @param {boolean} [options.skipAuth=false] - Skip authentication
   * @param {boolean} [options.skipRateLimit=false] - Skip rate limiting
   */
  _addRoute(method, path, handler, options = {}) {
    const paramNames = [];
    const patternStr = path.replace(/:([a-zA-Z0-9_]+)/g, (_match, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    const pattern = new RegExp(`^${patternStr}$`);
    this.routes.push({
      method: method.toUpperCase(),
      pattern,
      paramNames,
      handler,
      options,
    });
  }

  /**
   * Start the HTTP server
   *
   * @param {number} [port=3000] - Port to listen on
   * @param {string} [host='0.0.0.0'] - Host to bind to
   * @returns {Promise<void>} Resolves when the server is listening
   */
  async start(port = 3000, host = '0.0.0.0') {
    if (this.running) {
      throw new APIServerError('Server is already running', {
        operation: 'start',
      });
    }

    this.port = port;
    this.host = host;

    this.server = createServer((req, res) => {
      this._handleRequest(req, res).catch(err => {
        this._log(`Unhandled error: ${err.message}`);
        if (!res.headersSent) {
          this._sendJson(res, 500, {
            error: 'Internal Server Error',
            message: 'An unexpected error occurred',
          });
        }
      });
    });

    return new Promise((resolve, reject) => {
      this.server.on('error', err => {
        this.running = false;
        reject(
          new APIServerError(`Failed to start server: ${err.message}`, {
            cause: err,
            operation: 'start',
          })
        );
      });

      this.server.listen(port, host, () => {
        this.running = true;
        this._log(`API server listening on ${host}:${port}`);
        resolve();
      });
    });
  }

  /**
   * Stop the HTTP server gracefully
   *
   * @returns {Promise<void>} Resolves when the server has stopped
   */
  async stop() {
    if (!this.server) {
      return;
    }

    this.rateLimiter.destroy();

    return new Promise((resolve, reject) => {
      this.server.close(err => {
        this.running = false;
        this.server = null;
        if (err) {
          reject(
            new APIServerError(`Failed to stop server: ${err.message}`, {
              cause: err,
              operation: 'stop',
            })
          );
        } else {
          this._log('API server stopped');
          resolve();
        }
      });
    });
  }

  /**
   * Handle an incoming HTTP request
   *
   * Processes the request through the middleware chain:
   * 1. CORS preflight handling
   * 2. Rate limiting
   * 3. Route matching (direct routes)
   * 4. Router chain delegation
   * 5. 404 fallback
   *
   * @param {import('http').IncomingMessage} req - HTTP request
   * @param {import('http').ServerResponse} res - HTTP response
   * @returns {Promise<void>}
   * @private
   */
  async _handleRequest(req, res) {
    const method = (typeof req.method === 'string' ? req.method : '').toUpperCase();
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const { pathname } = url;

    // Set CORS headers
    this._setCorsHeaders(req, res);

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Rate limiting (by client IP)
    const clientIp = this._extractIp(req);
    if (!this.rateLimiter.checkRequest(clientIp, res)) {
      return;
    }

    // Try directly registered routes first
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

      // Authentication (unless skipped)
      if (!route.options.skipAuth) {
        const user = this.auth.authenticate(req);
        if (!user) {
          this.auth.sendUnauthorized(res);
          return;
        }
        req.user = user;

        // Authorization
        if (route.options.requiredRole && !this.auth.authorize(user, route.options.requiredRole)) {
          this.auth.sendForbidden(res, route.options.requiredRole);
          return;
        }
      }

      // Parse JSON body for write methods
      if (['POST', 'PUT', 'PATCH'].includes(method)) {
        try {
          req.body = await this._parseJsonBody(req);
        } catch (_err) {
          this._sendJson(res, 400, {
            error: 'Bad Request',
            message: 'Invalid JSON body',
          });
          return;
        }
      }

      // Handle request
      try {
        const result = await route.handler(req);
        this._sendJson(res, result.statusCode || 200, result.body);
      } catch (err) {
        this._log(`API error on ${method} ${pathname}: ${err.message}`);
        const statusCode = err.statusCode || 500;
        this._sendJson(res, statusCode, {
          error: 'Internal Server Error',
          message: err.message,
        });
      }
      return;
    }

    // Delegate to registered routers
    for (const router of this.routers) {
      const handled = await router.handleRequest(req, res);
      if (handled) {
        return;
      }
    }

    // No route matched
    this._sendJson(res, 404, {
      error: 'Not Found',
      message: `${method} ${pathname} not found`,
    });
  }

  /**
   * Parse the JSON body from an incoming request
   *
   * @param {import('http').IncomingMessage} req - HTTP request
   * @returns {Promise<Object>} Parsed JSON body
   * @private
   */
  _parseJsonBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      const maxSize = 1024 * 1024; // 1MB limit

      req.on('data', chunk => {
        size += chunk.length;
        if (size > maxSize) {
          reject(new APIServerError('Request body too large', { operation: 'parseBody' }));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        if (!raw || raw.trim().length === 0) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch (err) {
          reject(err);
        }
      });

      req.on('error', reject);
    });
  }

  /**
   * Set CORS headers on the response
   *
   * @param {import('http').IncomingMessage} req - HTTP request
   * @param {import('http').ServerResponse} res - HTTP response
   * @private
   */
  _setCorsHeaders(req, res) {
    const { origin } = req.headers;

    if (this.cors.origins.includes('*')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else if (origin && this.cors.origins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }

    res.setHeader('Access-Control-Allow-Methods', this.cors.methods.join(', '));
    res.setHeader('Access-Control-Allow-Headers', this.cors.headers.join(', '));
    res.setHeader('Access-Control-Max-Age', '86400');
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
   * Extract the client IP address from an HTTP request
   *
   * Checks X-Forwarded-For header first, then falls back to
   * the socket remote address.
   *
   * @param {import('http').IncomingMessage} req - HTTP request
   * @returns {string} Client IP address
   * @private
   */
  _extractIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      return String(forwarded).split(',')[0].trim();
    }
    return req.socket?.remoteAddress || '127.0.0.1';
  }

  /**
   * Log a message using the configured logger
   *
   * @param {string} message - Message to log
   * @private
   */
  _log(message) {
    if (this.logger) {
      this.logger(`[APIServer] ${message}`);
    }
  }
}

export default APIServer;
