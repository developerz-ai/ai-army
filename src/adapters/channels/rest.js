/**
 * RESTAdapter - REST API channel for HTTP-based interactions
 *
 * Provides an HTTP REST endpoint for sending and receiving messages.
 * Useful for custom integrations, webhooks, and API-driven bots.
 *
 * Uses Node.js built-in `http` module (no Express dependency), consistent
 * with the pattern established in src/api/api-server.js.
 *
 * REST endpoints:
 * - POST {basePath}/messages          - Receive inbound messages
 * - GET  {basePath}/messages/:sessionId - Poll for responses
 *
 * Config: { port, host, basePath, apiKey }
 *
 * @module adapters/channels/rest
 */

import { createServer } from 'node:http';

/**
 * Custom error for REST adapter failures
 */
export class RESTAdapterError extends Error {
  /**
   * Create a RESTAdapterError
   * @param {string} message - Error message
   * @param {Object} [options] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - Operation that failed
   * @param {string} [options.reason] - Additional context
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'RESTAdapterError';
    this.operation = options.operation;
    this.reason = options.reason;
  }
}

/**
 * REST channel adapter for HTTP-based messaging
 *
 * Implements the standard channel adapter interface:
 * constructor(config), initialize(), start(), stop(),
 * onMessage(handler), sendMessage(channelId, text).
 *
 * Inbound messages arrive via POST /messages and are dispatched to the
 * registered message handler. Outbound messages are buffered per session
 * and retrieved via GET /messages/:sessionId polling.
 *
 * @example
 * const adapter = new RESTAdapter({
 *   port: 3100,
 *   host: '0.0.0.0',
 *   basePath: '/api/v1',
 *   apiKey: 'my-secret-key',
 * });
 * await adapter.initialize();
 * adapter.onMessage(async msg => console.log(msg));
 * await adapter.start();
 */
export class RESTAdapter {
  /**
   * Create a RESTAdapter instance
   * @param {Object} config - REST adapter configuration
   * @param {number} config.port - Port to listen on (use 0 for ephemeral port)
   * @param {string} [config.host='0.0.0.0'] - Host to bind to
   * @param {string} [config.basePath=''] - Base path prefix for endpoints
   * @param {string} [config.apiKey] - Optional API key for authentication
   */
  constructor(config) {
    if (!config || typeof config !== 'object') {
      throw new RESTAdapterError('Config is required', {
        operation: 'constructor',
        reason: 'Missing or invalid config object',
      });
    }

    if (config.port == null || !Number.isFinite(config.port)) {
      throw new RESTAdapterError('port is required and must be a finite number', {
        operation: 'constructor',
        reason: 'Missing or invalid port in config',
      });
    }

    this.config = {
      port: config.port,
      host: config.host || '0.0.0.0',
      basePath: this._normalizeBasePath(config.basePath),
      apiKey: config.apiKey || null,
    };

    /** @type {import('http').Server|null} */
    this.server = null;

    /** @type {Function|null} Registered message handler */
    this.messageHandler = null;

    /** @type {boolean} Whether initialize() has been called */
    this.initialized = false;

    /** @type {boolean} Whether start() has been called */
    this.started = false;

    /**
     * Outbound message buffer keyed by sessionId.
     * Messages are appended by sendMessage() and drained by GET /messages/:sessionId.
     * @type {Map<string, Array<{text: string, timestamp: string}>>}
     */
    this.responseBuffers = new Map();
  }

  /**
   * Initialize the REST adapter
   *
   * Creates the HTTP server and configures request routing.
   * Does not start listening — call start() after initialize().
   *
   * Accepts an optional config parameter for consistency with the adapter
   * contract used by ChannelManager (which calls `adapter.initialize(config)`).
   * When provided, runtime config values are merged into the existing config.
   *
   * @param {Object} [config] - Optional runtime config overrides
   * @returns {Promise<void>}
   * @throws {RESTAdapterError} If initialization fails
   */
  async initialize(config) {
    if (this.initialized) {
      return;
    }

    // Merge runtime config overrides when provided by ChannelManager
    if (config && typeof config === 'object') {
      if (config.port != null && Number.isFinite(config.port)) {
        this.config.port = config.port;
      }
      if (config.host !== undefined) {
        this.config.host = config.host ?? '0.0.0.0';
      }
      if (config.basePath !== undefined) {
        this.config.basePath = this._normalizeBasePath(config.basePath);
      }
      if (config.apiKey !== undefined) {
        this.config.apiKey = config.apiKey || null;
      }
    }

    try {
      this.server = createServer((req, res) => {
        this._handleRequest(req, res).catch(err => {
          if (!res.headersSent) {
            this._sendJson(res, 500, {
              error: 'Internal Server Error',
              message: err.message,
            });
          }
        });
      });
      this.initialized = true;
    } catch (err) {
      throw new RESTAdapterError('Failed to initialize REST adapter', {
        cause: err,
        operation: 'initialize',
      });
    }
  }

  /**
   * Register a message handler callback
   *
   * The handler will be called with a standardized message object
   * for each incoming POST /messages request.
   *
   * @param {Function} handler - Async function to handle incoming messages
   * @throws {RESTAdapterError} If handler is not a function
   */
  onMessage(handler) {
    if (typeof handler !== 'function') {
      throw new RESTAdapterError('Message handler must be a function', {
        operation: 'onMessage',
        reason: `Expected function, got ${typeof handler}`,
      });
    }

    this.messageHandler = handler;
  }

  /**
   * Start listening for HTTP requests
   *
   * Begins accepting connections on the configured port and host.
   * The adapter must be initialized before calling start().
   *
   * @returns {Promise<void>}
   * @throws {RESTAdapterError} If not initialized or start fails
   */
  async start() {
    if (!this.initialized) {
      throw new RESTAdapterError('RESTAdapter not initialized. Call initialize() first', {
        operation: 'start',
      });
    }

    if (this.started) {
      return;
    }

    return new Promise((resolve, reject) => {
      let settled = false;

      const onError = err => {
        if (settled) return;
        settled = true;
        this.started = false;
        reject(
          new RESTAdapterError(`Failed to start REST adapter: ${err.message}`, {
            cause: err,
            operation: 'start',
          })
        );
      };

      this.server.once('error', onError);

      this.server.listen(this.config.port, this.config.host, () => {
        if (settled) return;
        settled = true;
        this.server.removeListener('error', onError);
        this.started = true;
        resolve();
      });
    });
  }

  /**
   * Stop the HTTP server gracefully
   *
   * Closes the server and stops accepting new connections.
   * Safe to call even if not started (will be a no-op).
   *
   * @returns {Promise<void>}
   * @throws {RESTAdapterError} If stop fails
   */
  async stop() {
    if (!this.started || !this.server) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.server.close(err => {
        this.started = false;
        if (err) {
          reject(
            new RESTAdapterError(`Failed to stop REST adapter: ${err.message}`, {
              cause: err,
              operation: 'stop',
            })
          );
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Send a message to a session via the REST channel
   *
   * Buffers the message for the given session. The message will be
   * available when the client polls GET /messages/:sessionId.
   *
   * @param {string} channelId - Target session/channel identifier
   * @param {string} text - Message text to send
   * @returns {Promise<void>}
   * @throws {RESTAdapterError} If not initialized or parameters are invalid
   */
  async sendMessage(channelId, text) {
    if (!this.initialized) {
      throw new RESTAdapterError('RESTAdapter not initialized. Call initialize() first', {
        operation: 'sendMessage',
      });
    }

    if (!channelId) {
      throw new RESTAdapterError('channelId is required', {
        operation: 'sendMessage',
        reason: 'Missing channelId parameter',
      });
    }

    if (typeof text !== 'string') {
      throw new RESTAdapterError('text is required and must be a string', {
        operation: 'sendMessage',
        reason: 'Missing or non-string text parameter',
      });
    }

    if (!this.responseBuffers.has(channelId)) {
      this.responseBuffers.set(channelId, []);
    }

    this.responseBuffers.get(channelId).push({
      text,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Handle an incoming HTTP request
   *
   * Routes requests to the appropriate handler based on method and path:
   * - POST {basePath}/messages          → _handleInboundMessage
   * - GET  {basePath}/messages/:sessionId → _handlePollMessages
   *
   * @param {import('http').IncomingMessage} req - HTTP request
   * @param {import('http').ServerResponse} res - HTTP response
   * @returns {Promise<void>}
   * @private
   */
  async _handleRequest(req, res) {
    const method = (typeof req.method === 'string' ? req.method : '').toUpperCase();

    let pathname;
    try {
      // Always use a fixed base — never trust the client-supplied Host header,
      // which can contain invalid characters or alter the parsed pathname.
      ({ pathname } = new URL(req.url, 'http://localhost'));
    } catch (_err) {
      pathname = req.url?.split('?')[0] || '/';
    }

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // API key authentication
    if (this.config.apiKey) {
      const rawApiKey = req.headers['x-api-key'];
      const rawAuth = req.headers.authorization;
      const apiKeyHeader = Array.isArray(rawApiKey) ? rawApiKey[0] : rawApiKey;
      const authHeader = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth;
      const providedKey = apiKeyHeader || this._extractBearerToken(authHeader);

      if (providedKey !== this.config.apiKey) {
        this._sendJson(res, 401, { error: 'Unauthorized', message: 'Invalid or missing API key' });
        return;
      }
    }

    const { basePath } = this.config;

    // POST {basePath}/messages — inbound message
    if (method === 'POST' && pathname === `${basePath}/messages`) {
      await this._handleInboundMessage(req, res);
      return;
    }

    // GET {basePath}/messages/:sessionId — poll for responses
    const pollPattern = new RegExp(`^${this._escapeRegExp(basePath)}/messages/([^/]+)$`);
    const pollMatch = pathname.match(pollPattern);
    if (method === 'GET' && pollMatch) {
      let sessionId;
      try {
        sessionId = decodeURIComponent(pollMatch[1]);
      } catch (_err) {
        this._sendJson(res, 400, {
          error: 'Bad Request',
          message: 'Invalid URL encoding in session ID',
        });
        return;
      }
      this._handlePollMessages(res, sessionId);
      return;
    }

    this._sendJson(res, 404, { error: 'Not Found', message: `${method} ${pathname} not found` });
  }

  /**
   * Handle an inbound POST /messages request
   *
   * Parses the JSON body and dispatches to the registered message handler.
   * Expected body: { sessionId, text, userId? }
   *
   * @param {import('http').IncomingMessage} req - HTTP request
   * @param {import('http').ServerResponse} res - HTTP response
   * @returns {Promise<void>}
   * @private
   */
  async _handleInboundMessage(req, res) {
    let body;
    try {
      body = await this._parseJsonBody(req);
    } catch (err) {
      if (err instanceof RESTAdapterError && err.operation === 'parseBody') {
        this._sendJson(res, 413, {
          error: 'Payload Too Large',
          message: 'Request body too large',
        });
        return;
      }
      this._sendJson(res, 400, { error: 'Bad Request', message: 'Invalid JSON body' });
      return;
    }

    if (!body.sessionId || typeof body.sessionId !== 'string') {
      this._sendJson(res, 400, {
        error: 'Bad Request',
        message: 'sessionId is required and must be a string',
      });
      return;
    }

    if (!body.text || typeof body.text !== 'string') {
      this._sendJson(res, 400, {
        error: 'Bad Request',
        message: 'text is required and must be a string',
      });
      return;
    }

    const message = {
      type: 'rest',
      userId: body.userId || 'anonymous',
      channelId: body.sessionId,
      text: body.text,
      isDM: true,
      metadata: body.metadata || {},
    };

    if (this.messageHandler) {
      try {
        await this.messageHandler(message);
      } catch (err) {
        this._sendJson(res, 500, {
          error: 'Internal Server Error',
          message: `Message handler failed: ${err.message}`,
        });
        return;
      }
    }

    this._sendJson(res, 200, {
      ok: true,
      sessionId: body.sessionId,
      message: 'Message received',
    });
  }

  /**
   * Handle a GET /messages/:sessionId polling request
   *
   * Returns and drains all buffered messages for the given session.
   *
   * @param {import('http').ServerResponse} res - HTTP response
   * @param {string} sessionId - Session to poll messages for
   * @private
   */
  _handlePollMessages(res, sessionId) {
    const messages = this.responseBuffers.get(sessionId) || [];

    // Delete the buffer entry after draining to prevent unbounded map growth.
    // Without this, repeated GET /messages/<random> requests would create and
    // retain empty Map entries forever (memory leak under untrusted traffic).
    if (this.responseBuffers.has(sessionId)) {
      this.responseBuffers.delete(sessionId);
    }

    this._sendJson(res, 200, {
      ok: true,
      sessionId,
      messages,
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
      let settled = false;

      const onData = chunk => {
        if (settled) return;
        size += chunk.length;
        if (size > maxSize) {
          settled = true;
          req.removeListener('data', onData);
          req.removeListener('end', onEnd);
          req.removeListener('error', onError);
          reject(
            new RESTAdapterError('Request body too large', {
              operation: 'parseBody',
              reason: 'Exceeded 1MB limit',
            })
          );
          req.destroy();
          return;
        }
        chunks.push(chunk);
      };

      const onEnd = () => {
        if (settled) return;
        settled = true;
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
      };

      const onError = err => {
        if (settled) return;
        settled = true;
        reject(err);
      };

      req.on('data', onData);
      req.on('end', onEnd);
      req.on('error', onError);
    });
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
    if (res.headersSent) {
      res.end();
      return;
    }
    const json = JSON.stringify(body);
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(json),
    });
    res.end(json);
  }

  /**
   * Extract a bearer token from the Authorization header
   *
   * @param {string} [authHeader] - Authorization header value
   * @returns {string|null} Token or null if not present
   * @private
   */
  _extractBearerToken(authHeader) {
    if (!authHeader || typeof authHeader !== 'string') return null;
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    return match ? match[1] : null;
  }

  /**
   * Normalize a basePath value
   *
   * Ensures the path starts with a leading slash (unless empty) and
   * strips trailing slashes. This prevents misconfiguration where
   * `basePath: 'api/v1'` would cause all routes to 404.
   *
   * @param {string} [basePath] - Raw basePath value
   * @returns {string} Normalized basePath
   * @private
   */
  _normalizeBasePath(basePath) {
    let normalized = (basePath || '').replace(/\/+$/, '');
    if (normalized && !normalized.startsWith('/')) {
      normalized = `/${normalized}`;
    }
    return normalized;
  }

  /**
   * Escape special regex characters in a string
   *
   * @param {string} str - String to escape
   * @returns {string} Escaped string safe for RegExp
   * @private
   */
  _escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

export default RESTAdapter;
