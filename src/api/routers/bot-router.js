/**
 * BotRouter - HTTP router for bot management API endpoints
 *
 * Provides RESTful endpoints for bot operations:
 * - GET   /api/bots              -> List all bots
 * - GET   /api/bots/:id          -> Get bot details
 * - POST  /api/bots/:id/message  -> Send message to bot
 * - PATCH /api/bots/:id/config   -> Update bot configuration
 * - GET   /api/bots/:id/sessions -> List bot sessions
 * - GET   /api/bots/:id/status   -> Get bot status
 *
 * Authentication via Bearer token in the Authorization header.
 * Uses Node.js built-in http module (no Express/Fastify dependency).
 *
 * @module api/routers/bot-router
 */

/**
 * Custom error for bot router failures
 */
export class BotRouterError extends Error {
  /**
   * Create a BotRouterError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error
   * @param {string} [options.endpoint] - The endpoint that failed
   * @param {number} [options.statusCode] - HTTP status code
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'BotRouterError';
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
 * BotRouter - lightweight HTTP router for bot management endpoints
 *
 * @example
 * const router = new BotRouter({
 *   botManager,
 *   sessionManager,
 *   messageProcessor,
 *   apiKey: 'secret',
 * });
 * // In your HTTP server:
 * const handled = await router.handleRequest(req, res);
 * if (!handled) { // pass to next router }
 */
export class BotRouter {
  /**
   * Create a BotRouter instance
   *
   * @param {Object} options - Configuration options
   * @param {import('../../core/bot-manager.js').BotManager} options.botManager - BotManager instance
   * @param {import('../../core/session-manager.js').SessionManager} [options.sessionManager] - SessionManager instance
   * @param {import('../../core/message-processor.js').MessageProcessor} [options.messageProcessor] - MessageProcessor instance
   * @param {Object} [options.storage] - Storage instance for listing sessions
   * @param {string} [options.apiKey] - API key for authentication
   * @param {Function|null} [options.logger=null] - Logger function
   * @param {Object} [options.auditLogger] - AuditLogger instance for recording audit events
   */
  constructor(options = {}) {
    if (!options.botManager) {
      throw new BotRouterError('BotManager is required', {
        endpoint: 'constructor',
      });
    }

    /** @type {import('../../core/bot-manager.js').BotManager} */
    this.botManager = options.botManager;

    /** @type {import('../../core/session-manager.js').SessionManager|null} */
    this.sessionManager = options.sessionManager || null;

    /** @type {import('../../core/message-processor.js').MessageProcessor|null} */
    this.messageProcessor = options.messageProcessor || null;

    /** @type {Object|null} Storage instance */
    this.storage = options.storage || null;

    /** @type {string|null} API key for authentication */
    this.apiKey = options.apiKey || null;

    /** @type {Function|null} Logger function */
    this.logger = options.logger !== undefined ? options.logger : null;

    /** @type {Object|null} AuditLogger for recording audit events */
    this.auditLogger = options.auditLogger || null;

    /** @type {Object|null} BotReloader for hot-reloading bot config/containers */
    this.botReloader = options.botReloader || null;

    /** @type {Route[]} Registered routes */
    this.routes = [];

    this._registerRoutes();
  }

  /**
   * Register all bot API routes
   * @private
   */
  _registerRoutes() {
    this._addRoute('GET', '/api/bots', req => this._handleListBots(req));
    this._addRoute('GET', '/api/bots/:id/sessions', req => this._handleBotSessions(req));
    this._addRoute('GET', '/api/bots/:id/status', req => this._handleBotStatus(req));
    this._addRoute('POST', '/api/bots/:id/message', req => this._handleSendMessage(req));
    this._addRoute('PATCH', '/api/bots/:id/config', req => this._handleUpdateConfig(req));
    this._addRoute('GET', '/api/bots/:id', req => this._handleGetBot(req));
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

    // Only handle /api/bots paths
    if (!pathname.startsWith('/api/bots')) {
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

      // Parse JSON body for POST/PATCH/PUT
      if (['POST', 'PATCH', 'PUT'].includes(method)) {
        try {
          req.body = await this._parseJsonBody(req);
        } catch (_err) {
          this._sendJson(res, 400, {
            error: 'Bad Request',
            message: 'Invalid JSON body',
          });
          return true;
        }
      }

      // Handle request
      try {
        const result = await route.handler(req);
        this._sendJson(res, result.statusCode || 200, result.body);
      } catch (err) {
        this._log(`Bot API error on ${method} ${pathname}: ${err.message}`);
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
   * GET /api/bots
   *
   * List all loaded bots with their current status.
   *
   * @param {import('http').IncomingMessage} _req - HTTP request
   * @returns {Promise<{statusCode: number, body: Object}>} Response
   * @private
   */
  async _handleListBots(_req) {
    const bots = this.botManager.listBots();

    const data = bots.map(bot => ({
      id: bot.id,
      status: bot.status,
      model: bot.config?.model || null,
      provider: bot.config?.provider || null,
      channels: bot.config?.channels || [],
      createdAt: bot.createdAt || null,
      lastActiveAt: bot.lastActiveAt || null,
    }));

    return {
      statusCode: 200,
      body: {
        data,
        count: data.length,
      },
    };
  }

  /**
   * GET /api/bots/:id
   *
   * Get detailed information about a specific bot.
   *
   * @param {import('http').IncomingMessage} req - HTTP request (with params.id)
   * @returns {Promise<{statusCode: number, body: Object}>} Response
   * @private
   */
  async _handleGetBot(req) {
    const { id } = req.params;
    const bot = this.botManager.getBot(id);

    if (!bot) {
      return {
        statusCode: 404,
        body: {
          error: 'Not Found',
          message: `Bot '${id}' not found`,
        },
      };
    }

    return {
      statusCode: 200,
      body: {
        id: bot.id,
        status: bot.status,
        model: bot.config?.model || null,
        provider: bot.config?.provider || null,
        channels: bot.config?.channels || [],
        tools: bot.tools ? Object.keys(bot.tools) : [],
        soulContent: bot.soulContent ? true : false,
        createdAt: bot.createdAt || null,
        lastActiveAt: bot.lastActiveAt || null,
      },
    };
  }

  /**
   * POST /api/bots/:id/message
   *
   * Send a message to a bot and receive the AI response.
   * Requires messageProcessor to be configured.
   *
   * @param {import('http').IncomingMessage} req - HTTP request (with params.id and body)
   * @returns {Promise<{statusCode: number, body: Object}>} Response
   * @private
   */
  async _handleSendMessage(req) {
    const { id } = req.params;

    if (!this.messageProcessor) {
      return {
        statusCode: 503,
        body: {
          error: 'Service Unavailable',
          message: 'Message processing is not available',
        },
      };
    }

    const bot = this.botManager.getBot(id);
    if (!bot) {
      return {
        statusCode: 404,
        body: {
          error: 'Not Found',
          message: `Bot '${id}' not found`,
        },
      };
    }

    // Check bot-specific access if user is authenticated
    if (req.user && req.user.bots && !req.user.bots.includes(id)) {
      return {
        statusCode: 403,
        body: {
          error: 'Forbidden',
          message: `Access denied to bot '${id}'`,
        },
      };
    }

    const { userId, text } = req.body || {};
    if (!userId || !text) {
      return {
        statusCode: 400,
        body: {
          error: 'Bad Request',
          message: 'Both userId and text are required in the request body',
        },
      };
    }

    try {
      const result = await this.messageProcessor.processMessage(bot.config, {
        type: 'rest',
        userId,
        channelId: 'rest-api',
        text,
      });

      this._auditLog({
        type: 'message.sent',
        actor: this._extractActor(req),
        actorType: 'api',
        resourceType: 'bot',
        resourceId: id,
        action: 'message_sent',
        metadata: {
          userId,
          sessionId: result.sessionId,
          durationMs: result.durationMs,
        },
        ipAddress: this._extractIp(req),
        userAgent: req.headers?.['user-agent'] || null,
      });

      return {
        statusCode: 200,
        body: {
          text: result.text,
          sessionId: result.sessionId,
          durationMs: result.durationMs,
          usage: result.usage || null,
        },
      };
    } catch (err) {
      this._log(`Message processing failed for bot '${id}': ${err.message}`);
      return {
        statusCode: 500,
        body: {
          error: 'Internal Server Error',
          message: `Failed to process message: ${err.message}`,
        },
      };
    }
  }

  /**
   * GET /api/bots/:id/sessions
   *
   * List sessions associated with a specific bot.
   * Requires storage instance to be configured.
   *
   * @param {import('http').IncomingMessage} req - HTTP request (with params.id)
   * @returns {Promise<{statusCode: number, body: Object}>} Response
   * @private
   */
  async _handleBotSessions(req) {
    const { id } = req.params;

    const bot = this.botManager.getBot(id);
    if (!bot) {
      return {
        statusCode: 404,
        body: {
          error: 'Not Found',
          message: `Bot '${id}' not found`,
        },
      };
    }

    if (!this.storage) {
      return {
        statusCode: 503,
        body: {
          error: 'Service Unavailable',
          message: 'Storage is not available for session listing',
        },
      };
    }

    try {
      const limit = parseInt(req.searchParams?.get('limit') || '100', 10);
      const sinceParam = req.searchParams?.get('since');
      const options = {
        limit: Math.min(Math.max(limit, 1), 1000),
      };

      if (sinceParam) {
        options.since = new Date(sinceParam);
      }

      const sessions = await this.storage.listSessions(id, options);

      return {
        statusCode: 200,
        body: {
          data: sessions.map(s => ({
            id: s.id,
            botId: s.botId,
            userId: s.userId,
            channelId: s.channelId,
            channelType: s.channelType,
            messageCount: (s.messages || []).length,
            tokenCount: s.tokenCount,
            createdAt: s.createdAt,
            lastMessageAt: s.lastMessageAt,
          })),
          count: sessions.length,
          botId: id,
        },
      };
    } catch (err) {
      this._log(`Failed to list sessions for bot '${id}': ${err.message}`);
      return {
        statusCode: 500,
        body: {
          error: 'Internal Server Error',
          message: `Failed to list sessions: ${err.message}`,
        },
      };
    }
  }

  /**
   * GET /api/bots/:id/status
   *
   * Get the current status of a specific bot.
   *
   * @param {import('http').IncomingMessage} req - HTTP request (with params.id)
   * @returns {Promise<{statusCode: number, body: Object}>} Response
   * @private
   */
  async _handleBotStatus(req) {
    const { id } = req.params;
    const bot = this.botManager.getBot(id);

    if (!bot) {
      return {
        statusCode: 404,
        body: {
          error: 'Not Found',
          message: `Bot '${id}' not found`,
        },
      };
    }

    return {
      statusCode: 200,
      body: {
        id: bot.id,
        status: bot.status,
        createdAt: bot.createdAt || null,
        lastActiveAt: bot.lastActiveAt || null,
      },
    };
  }

  /**
   * PATCH /api/bots/:id/config
   *
   * Update a bot's configuration. Supports updating:
   * - sandbox.image: Docker image (triggers container restart)
   * - sandbox.packages: Installed packages (triggers container restart)
   * - sandbox.memory/cpus: Resource limits (triggers container restart)
   * - model, provider, temperature, maxSteps: AI settings (no restart)
   * - tools: Tool list (no restart)
   *
   * Requires operator access to the bot or admin role.
   *
   * @param {import('http').IncomingMessage} req - HTTP request
   * @returns {Promise<{statusCode: number, body: Object}>} Response
   * @private
   */
  async _handleUpdateConfig(req) {
    const { id } = req.params;

    const bot = this.botManager.getBot(id);
    if (!bot) {
      return {
        statusCode: 404,
        body: { error: 'Not Found', message: `Bot '${id}' not found` },
      };
    }

    // Check bot-specific access
    if (req.user && req.user.bots && !req.user.bots.includes(id)) {
      return {
        statusCode: 403,
        body: { error: 'Forbidden', message: `Access denied to bot '${id}'` },
      };
    }

    const updates = req.body || {};
    if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
      return {
        statusCode: 400,
        body: { error: 'Bad Request', message: 'Request body must contain config fields to update' },
      };
    }

    // Allowlist of updatable fields
    const ALLOWED_FIELDS = [
      'model', 'provider', 'temperature', 'maxSteps', 'timeout',
      'tools', 'mcpServers', 'sandbox',
    ];
    const unknownFields = Object.keys(updates).filter(k => !ALLOWED_FIELDS.includes(k));
    if (unknownFields.length > 0) {
      return {
        statusCode: 400,
        body: {
          error: 'Bad Request',
          message: `Unknown fields: ${unknownFields.join(', ')}. Allowed: ${ALLOWED_FIELDS.join(', ')}`,
        },
      };
    }

    try {
      const oldConfig = { ...bot.config };
      const newConfig = { ...bot.config, ...updates };

      // Check if sandbox changed (needs container restart)
      const sandboxChanged = this.botReloader
        ? this.botReloader.needsContainerRestart(oldConfig, newConfig)
        : false;

      // Apply config update
      if (this.botReloader) {
        await this.botReloader.reloadBotConfig(id, newConfig);

        if (sandboxChanged && newConfig.sandbox) {
          await this.botReloader.reloadContainer(id, newConfig.sandbox);
        }
      } else {
        // Fallback: update in-memory directly
        bot.config = newConfig;
      }

      this._auditLog({
        type: 'bot.config_updated',
        actor: this._extractActor(req),
        actorType: 'api',
        resourceType: 'bot',
        resourceId: id,
        action: 'config_updated',
        metadata: {
          updatedFields: Object.keys(updates),
          containerRestarted: sandboxChanged,
        },
        ipAddress: this._extractIp(req),
        userAgent: req.headers?.['user-agent'] || null,
      });

      this._log(`Bot '${id}' config updated (fields: ${Object.keys(updates).join(', ')}${sandboxChanged ? ', container restarted' : ''})`);

      return {
        statusCode: 200,
        body: {
          message: `Bot '${id}' configuration updated`,
          updatedFields: Object.keys(updates),
          containerRestarted: sandboxChanged,
          bot: {
            id: bot.id,
            status: bot.status,
            model: bot.config?.model || null,
            provider: bot.config?.provider || null,
            sandbox: bot.config?.sandbox || null,
          },
        },
      };
    } catch (err) {
      this._log(`Failed to update config for bot '${id}': ${err.message}`);
      return {
        statusCode: 500,
        body: {
          error: 'Internal Server Error',
          message: `Failed to update config: ${err.message}`,
        },
      };
    }
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

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
          reject(new BotRouterError('Request body too large', { endpoint: 'parseBody' }));
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
      this.logger(`[BotRouter] ${message}`);
    }
  }
}

export default BotRouter;
