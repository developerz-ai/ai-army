/**
 * TemplateRouter - HTTP router for template browsing and instantiation API endpoints
 *
 * Provides RESTful endpoints for bot template operations:
 * - GET    /api/v1/templates               -> List all templates
 * - GET    /api/v1/templates/:type          -> Get template details by ID
 * - POST   /api/v1/templates/instantiate    -> Create an instance from a template
 *
 * "Templates" are reusable bot configurations with `{{variable}}` placeholders.
 * Instantiation creates a deployed copy with per-instance overrides.
 *
 * Authentication via Bearer token in the Authorization header.
 * Uses Node.js built-in http module (no Express/Fastify dependency).
 *
 * @module api/routers/template-router
 */

/**
 * Custom error for template router failures
 */
export class TemplateRouterError extends Error {
  /**
   * Create a TemplateRouterError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error
   * @param {string} [options.endpoint] - The endpoint that failed
   * @param {number} [options.statusCode] - HTTP status code
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'TemplateRouterError';
    this.endpoint = options.endpoint;
    this.statusCode = options.statusCode;
  }
}

/**
 * Route definition for matching incoming requests
 * @typedef {Object} Route
 * @property {string} method - HTTP method (GET, POST, PUT, DELETE)
 * @property {RegExp} pattern - URL pattern to match
 * @property {string[]} paramNames - Named parameters extracted from URL
 * @property {Function} handler - Request handler function
 */

/**
 * TemplateRouter - lightweight HTTP router for template browsing and instantiation
 *
 * @example
 * const router = new TemplateRouter({
 *   templateManager,
 *   apiKey: 'secret',
 * });
 * // In your HTTP server:
 * const handled = await router.handleRequest(req, res);
 * if (!handled) { // pass to next router }
 */
export class TemplateRouter {
  /**
   * Create a TemplateRouter instance
   *
   * @param {Object} options - Configuration options
   * @param {import('../../core/template-manager.js').TemplateManager} options.templateManager - TemplateManager instance
   * @param {string} [options.apiKey] - API key for authentication
   * @param {Function|null} [options.logger=null] - Logger function
   * @param {Object} [options.auditLogger] - AuditLogger instance for recording audit events
   */
  constructor(options = {}) {
    if (!options.templateManager) {
      throw new TemplateRouterError('TemplateManager is required', {
        endpoint: 'constructor',
      });
    }

    /** @type {import('../../core/template-manager.js').TemplateManager} */
    this.templateManager = options.templateManager;

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
   * Register all template API routes
   * @private
   */
  _registerRoutes() {
    // Instantiate (must come before :type route to avoid matching "instantiate" as :type)
    this._addRoute('POST', '/api/v1/templates/instantiate', req => this._handleInstantiate(req));

    // List templates (must come before :type route)
    this._addRoute('GET', '/api/v1/templates', req => this._handleListTemplates(req));

    // Get template details by type/id
    this._addRoute('GET', '/api/v1/templates/:type', req => this._handleGetTemplate(req));
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

    // Only handle /api/v1/templates paths
    if (!pathname.startsWith('/api/v1/templates')) {
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

      // Parse JSON body for POST, PUT, PATCH, DELETE
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
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
        this._log(`Template API error on ${method} ${pathname}: ${err.message}`);
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
   * GET /api/v1/templates
   *
   * List all available templates with optional filtering.
   *
   * Query params:
   * - search: Filter templates by name or description (case-insensitive)
   *
   * @param {import('http').IncomingMessage} req - HTTP request
   * @returns {Promise<{statusCode: number, body: Object}>} Response
   * @private
   */
  async _handleListTemplates(req) {
    const searchFilter = req.searchParams?.get('search') || null;

    try {
      let templates = await this.templateManager.listTemplates();

      // Apply search filter (by name or description)
      if (searchFilter) {
        const lowerSearch = searchFilter.toLowerCase();
        templates = templates.filter(
          t =>
            (t.name && t.name.toLowerCase().includes(lowerSearch)) ||
            (t.description && t.description.toLowerCase().includes(lowerSearch))
        );
      }

      // Return summary view (omit full config/soul for list endpoint)
      const summaries = templates.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        version: t.version,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      }));

      return {
        statusCode: 200,
        body: {
          templates: summaries,
          total: summaries.length,
        },
      };
    } catch (err) {
      this._log(`Failed to list templates: ${err.message}`);
      return {
        statusCode: 500,
        body: {
          error: 'Internal Server Error',
          message: `Failed to list templates: ${err.message}`,
        },
      };
    }
  }

  /**
   * GET /api/v1/templates/:type
   *
   * Get detailed information about a specific template by its ID.
   * The `:type` param is the template ID.
   *
   * @param {import('http').IncomingMessage} req - HTTP request (with params.type)
   * @returns {Promise<{statusCode: number, body: Object}>} Response
   * @private
   */
  async _handleGetTemplate(req) {
    const { type: templateId } = req.params;

    try {
      const template = await this.templateManager.getTemplate(templateId);

      if (!template) {
        return {
          statusCode: 404,
          body: {
            error: 'Not Found',
            message: `Template '${templateId}' not found`,
            code: 'TEMPLATE_NOT_FOUND',
            details: { templateId },
          },
        };
      }

      return {
        statusCode: 200,
        body: {
          id: template.id,
          name: template.name,
          description: template.description,
          config: template.config,
          soulTemplate: template.soulTemplate,
          version: template.version,
          createdAt: template.createdAt,
          updatedAt: template.updatedAt,
        },
      };
    } catch (err) {
      this._log(`Failed to get template '${templateId}': ${err.message}`);
      return {
        statusCode: 500,
        body: {
          error: 'Internal Server Error',
          message: `Failed to get template '${templateId}': ${err.message}`,
        },
      };
    }
  }

  /**
   * POST /api/v1/templates/instantiate
   *
   * Create an instance from a template. The request body must include
   * a `templateId` and `instanceId`. Optional `name` and `overrides` can be provided.
   *
   * @param {import('http').IncomingMessage} req - HTTP request (with body)
   * @returns {Promise<{statusCode: number, body: Object}>} Response
   * @private
   */
  async _handleInstantiate(req) {
    const body = req.body || {};
    const { templateId, instanceId, name, overrides } = body;

    if (!templateId || typeof templateId !== 'string') {
      return {
        statusCode: 400,
        body: {
          error: 'Validation Error',
          message: '"templateId" is required and must be a non-empty string',
          code: 'VALIDATION_ERROR',
        },
      };
    }

    if (!instanceId || typeof instanceId !== 'string') {
      return {
        statusCode: 400,
        body: {
          error: 'Validation Error',
          message: '"instanceId" is required and must be a non-empty string',
          code: 'VALIDATION_ERROR',
        },
      };
    }

    if (overrides !== undefined && (typeof overrides !== 'object' || overrides === null)) {
      return {
        statusCode: 400,
        body: {
          error: 'Validation Error',
          message: '"overrides" must be an object when provided',
          code: 'VALIDATION_ERROR',
        },
      };
    }

    try {
      const instance = await this.templateManager.createInstance(templateId, {
        id: instanceId,
        name: name || undefined,
        overrides: overrides || {},
      });

      this._auditLog({
        type: 'template.instantiated',
        actor: this._extractActor(req),
        actorType: 'api',
        resourceType: 'template-instance',
        resourceId: instanceId,
        action: 'instantiated',
        metadata: { templateId, instanceId, name: name || instanceId },
        ipAddress: this._extractIp(req),
        userAgent: req.headers?.['user-agent'] || null,
      });

      return {
        statusCode: 201,
        body: {
          id: instance.id,
          templateId: instance.templateId,
          name: instance.name,
          status: instance.status,
          overrides: instance.overrides,
          resolvedConfig: instance.resolvedConfig,
          resolvedSoul: instance.resolvedSoul,
        },
      };
    } catch (err) {
      this._log(`Failed to instantiate template '${templateId}': ${err.message}`);

      // Template not found
      if (err.message && err.message.includes('not found')) {
        return {
          statusCode: 404,
          body: {
            error: 'Not Found',
            message: `Template '${templateId}' not found`,
            code: 'TEMPLATE_NOT_FOUND',
            details: { templateId },
          },
        };
      }

      // Duplicate instance
      if (err.message && err.message.includes('already exists')) {
        return {
          statusCode: 409,
          body: {
            error: 'Conflict',
            message: `Instance '${instanceId}' already exists`,
            code: 'INSTANCE_ALREADY_EXISTS',
            details: { instanceId },
          },
        };
      }

      return {
        statusCode: 500,
        body: {
          error: 'Internal Server Error',
          message: `Failed to instantiate template '${templateId}': ${err.message}`,
          code: 'INSTANTIATION_FAILED',
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
          reject(new TemplateRouterError('Request body too large', { endpoint: 'parseBody' }));
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
      this.logger(`[TemplateRouter] ${message}`);
    }
  }
}

export default TemplateRouter;
