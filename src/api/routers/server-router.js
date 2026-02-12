/**
 * ServerRouter - HTTP router for server management API endpoints
 *
 * Provides RESTful endpoints for server (worker node) operations:
 * - POST   /api/v1/servers/register  -> Register a new server
 * - GET    /api/v1/servers           -> List registered servers
 * - GET    /api/v1/servers/:id       -> Get server details
 * - DELETE /api/v1/servers/:id       -> Unregister a server
 *
 * "Servers" represent physical or virtual machines that run worker containers.
 * Registration tests SSH connectivity before persisting to the WorkerRegistry.
 *
 * Authentication via Bearer token in the Authorization header.
 * Uses Node.js built-in http module (no Express/Fastify dependency).
 *
 * @module api/routers/server-router
 */

/**
 * Custom error for server router failures
 */
export class ServerRouterError extends Error {
  /**
   * Create a ServerRouterError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error
   * @param {string} [options.endpoint] - The endpoint that failed
   * @param {number} [options.statusCode] - HTTP status code
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'ServerRouterError';
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
 * ServerRouter - lightweight HTTP router for server management endpoints
 *
 * @example
 * const router = new ServerRouter({
 *   workerRegistry,
 *   sshTunnelManager,
 *   apiKey: 'secret',
 * });
 * // In your HTTP server:
 * const handled = await router.handleRequest(req, res);
 * if (!handled) { // pass to next router }
 */
export class ServerRouter {
  /**
   * Create a ServerRouter instance
   *
   * @param {Object} options - Configuration options
   * @param {import('../../core/worker-registry.js').WorkerRegistry} options.workerRegistry - WorkerRegistry instance
   * @param {import('../../worker/ssh-tunnel.js').SSHTunnelManager} [options.sshTunnelManager] - SSHTunnelManager for connectivity testing
   * @param {string} [options.apiKey] - API key for authentication
   * @param {Function|null} [options.logger=null] - Logger function
   * @param {Object} [options.auditLogger] - AuditLogger instance for recording audit events
   */
  constructor(options = {}) {
    if (!options.workerRegistry) {
      throw new ServerRouterError('WorkerRegistry is required', {
        endpoint: 'constructor',
      });
    }

    /** @type {import('../../core/worker-registry.js').WorkerRegistry} */
    this.workerRegistry = options.workerRegistry;

    /** @type {import('../../worker/ssh-tunnel.js').SSHTunnelManager|null} */
    this.sshTunnelManager = options.sshTunnelManager || null;

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
   * Register all server API routes
   * @private
   */
  _registerRoutes() {
    // Register server (must come before :id routes)
    this._addRoute('POST', '/api/v1/servers/register', req => this._handleRegisterServer(req));

    // List servers (must come before :id routes)
    this._addRoute('GET', '/api/v1/servers', req => this._handleListServers(req));

    // Get server details
    this._addRoute('GET', '/api/v1/servers/:id', req => this._handleGetServer(req));

    // Unregister server
    this._addRoute('DELETE', '/api/v1/servers/:id', req => this._handleDeleteServer(req));
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

    // Only handle /api/v1/servers paths
    if (!pathname.startsWith('/api/v1/servers')) {
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
        this._log(`Server API error on ${method} ${pathname}: ${err.message}`);
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
   * POST /api/v1/servers/register
   *
   * Register a new server. Tests SSH connectivity for remote servers
   * before persisting to the WorkerRegistry.
   *
   * @param {import('http').IncomingMessage} req - HTTP request (with body)
   * @returns {Promise<{statusCode: number, body: Object}>} Response
   * @private
   */
  async _handleRegisterServer(req) {
    const body = req.body || {};
    const { id, host, type, maxContainers, ssh } = body;

    if (!id || typeof id !== 'string') {
      return {
        statusCode: 400,
        body: {
          error: 'Validation Error',
          message: 'Server "id" is required and must be a non-empty string',
          code: 'VALIDATION_ERROR',
        },
      };
    }

    if (!host || typeof host !== 'string') {
      return {
        statusCode: 400,
        body: {
          error: 'Validation Error',
          message: 'Server "host" is required and must be a non-empty string',
          code: 'VALIDATION_ERROR',
        },
      };
    }

    const serverType = type || 'remote';
    if (serverType !== 'local' && serverType !== 'remote') {
      return {
        statusCode: 400,
        body: {
          error: 'Validation Error',
          message: 'Server "type" must be "local" or "remote"',
          code: 'VALIDATION_ERROR',
        },
      };
    }

    // Test SSH connectivity for remote servers
    if (serverType === 'remote' && this.sshTunnelManager) {
      if (!ssh || typeof ssh !== 'object') {
        return {
          statusCode: 400,
          body: {
            error: 'Validation Error',
            message:
              'SSH configuration is required for remote servers (ssh.username, ssh.privateKey or ssh.privateKeyPath)',
            code: 'VALIDATION_ERROR',
          },
        };
      }

      try {
        await this._testSSHConnectivity({
          workerId: `test-${id}`,
          host,
          port: ssh.port || 22,
          username: ssh.username,
          privateKey: ssh.privateKey,
          privateKeyPath: ssh.privateKeyPath,
          passphrase: ssh.passphrase,
        });
      } catch (err) {
        this._log(`SSH connectivity test failed for server '${id}': ${err.message}`);
        return {
          statusCode: 422,
          body: {
            error: 'SSH Connectivity Failed',
            message: `Cannot connect to server '${id}' at ${host}: ${err.message}`,
            code: 'SSH_CONNECTIVITY_FAILED',
          },
        };
      }
    }

    try {
      const worker = await this.workerRegistry.registerWorker({
        id,
        host,
        type: serverType,
        maxContainers: maxContainers || 10,
      });

      this._auditLog({
        type: 'server.registered',
        actor: this._extractActor(req),
        actorType: 'api',
        resourceType: 'server',
        resourceId: id,
        action: 'registered',
        metadata: { host, type: serverType, maxContainers: maxContainers || 10 },
        ipAddress: this._extractIp(req),
        userAgent: req.headers?.['user-agent'] || null,
      });

      return {
        statusCode: 201,
        body: {
          id: worker.id,
          host: worker.host,
          type: worker.type,
          maxContainers: worker.maxContainers,
          currentLoad: worker.currentLoad,
          status: worker.status,
          createdAt: worker.createdAt,
        },
      };
    } catch (err) {
      this._log(`Failed to register server '${id}': ${err.message}`);

      // Check for duplicate server
      if (err.message && err.message.includes('already exists')) {
        return {
          statusCode: 409,
          body: {
            error: 'Conflict',
            message: `Server '${id}' already exists`,
            code: 'SERVER_ALREADY_EXISTS',
          },
        };
      }

      return {
        statusCode: 500,
        body: {
          error: 'Internal Server Error',
          message: `Failed to register server '${id}': ${err.message}`,
          code: 'REGISTRATION_FAILED',
        },
      };
    }
  }

  /**
   * GET /api/v1/servers
   *
   * List all registered servers with optional filtering.
   *
   * Query params:
   * - status: Filter by status (healthy, degraded, offline)
   * - type: Filter by type (local, remote)
   *
   * @param {import('http').IncomingMessage} req - HTTP request
   * @returns {Promise<{statusCode: number, body: Object}>} Response
   * @private
   */
  async _handleListServers(req) {
    const statusFilter = req.searchParams?.get('status') || null;
    const typeFilter = req.searchParams?.get('type') || null;

    try {
      const filter = {};
      if (statusFilter) filter.status = statusFilter;
      if (typeFilter) filter.type = typeFilter;

      const workers = await this.workerRegistry.listWorkers(filter);

      // Enrich with tunnel health if sshTunnelManager is available
      const servers = await Promise.all(
        workers.map(async w => {
          const server = {
            id: w.id,
            host: w.host,
            type: w.type,
            status: w.status,
            maxContainers: w.maxContainers,
            currentLoad: w.currentLoad,
            available: w.maxContainers - w.currentLoad,
            lastHeartbeat: w.lastHeartbeat,
            createdAt: w.createdAt,
          };

          // Add tunnel info for remote servers
          if (w.type === 'remote' && this.sshTunnelManager) {
            try {
              const health = await this.sshTunnelManager.healthCheck(w.id);
              server.tunnel = {
                state: health.state,
                healthy: health.healthy,
                dockerHost: health.dockerHost,
              };
            } catch (_err) {
              server.tunnel = { state: 'unknown', healthy: null, dockerHost: null };
            }
          }

          return server;
        })
      );

      return {
        statusCode: 200,
        body: {
          servers,
          total: servers.length,
        },
      };
    } catch (err) {
      this._log(`Failed to list servers: ${err.message}`);
      return {
        statusCode: 500,
        body: {
          error: 'Internal Server Error',
          message: `Failed to list servers: ${err.message}`,
        },
      };
    }
  }

  /**
   * GET /api/v1/servers/:id
   *
   * Get detailed information about a specific server.
   *
   * @param {import('http').IncomingMessage} req - HTTP request (with params.id)
   * @returns {Promise<{statusCode: number, body: Object}>} Response
   * @private
   */
  async _handleGetServer(req) {
    const { id } = req.params;

    try {
      const worker = await this.workerRegistry.getWorker(id);

      if (!worker) {
        return {
          statusCode: 404,
          body: {
            error: 'Not Found',
            message: `Server '${id}' not found`,
            code: 'SERVER_NOT_FOUND',
            details: { serverId: id },
          },
        };
      }

      const server = {
        id: worker.id,
        host: worker.host,
        type: worker.type,
        status: worker.status,
        maxContainers: worker.maxContainers,
        currentLoad: worker.currentLoad,
        available: worker.maxContainers - worker.currentLoad,
        loadRatio: worker.maxContainers > 0 ? worker.currentLoad / worker.maxContainers : 0,
        lastHeartbeat: worker.lastHeartbeat,
        createdAt: worker.createdAt,
        updatedAt: worker.updatedAt,
      };

      // Add tunnel info for remote servers
      if (worker.type === 'remote' && this.sshTunnelManager) {
        try {
          const health = await this.sshTunnelManager.healthCheck(worker.id);
          server.tunnel = {
            state: health.state,
            healthy: health.healthy,
            dockerHost: health.dockerHost,
            localPort: health.localPort,
            uptime: health.uptime,
          };
        } catch (_err) {
          server.tunnel = {
            state: 'unknown',
            healthy: null,
            dockerHost: null,
            localPort: null,
            uptime: null,
          };
        }
      }

      return {
        statusCode: 200,
        body: server,
      };
    } catch (err) {
      this._log(`Failed to get server '${id}': ${err.message}`);
      return {
        statusCode: 500,
        body: {
          error: 'Internal Server Error',
          message: `Failed to get server '${id}': ${err.message}`,
        },
      };
    }
  }

  /**
   * DELETE /api/v1/servers/:id
   *
   * Unregister a server. Optionally force-remove even if it has active containers.
   *
   * Query params:
   * - force: If 'true', force unregister even with active containers
   *
   * @param {import('http').IncomingMessage} req - HTTP request (with params.id)
   * @returns {Promise<{statusCode: number, body: Object}>} Response
   * @private
   */
  async _handleDeleteServer(req) {
    const { id } = req.params;
    const force = req.searchParams?.get('force') === 'true';

    try {
      // Check if server exists first
      const worker = await this.workerRegistry.getWorker(id);
      if (!worker) {
        return {
          statusCode: 404,
          body: {
            error: 'Not Found',
            message: `Server '${id}' not found`,
            code: 'SERVER_NOT_FOUND',
            details: { serverId: id },
          },
        };
      }

      // Close SSH tunnel if exists
      if (this.sshTunnelManager) {
        try {
          await this.sshTunnelManager.closeTunnel(id);
        } catch (_err) {
          // Tunnel cleanup is best-effort
        }
      }

      await this.workerRegistry.unregisterWorker(id, { force });

      this._auditLog({
        type: 'server.unregistered',
        actor: this._extractActor(req),
        actorType: 'api',
        resourceType: 'server',
        resourceId: id,
        action: 'unregistered',
        metadata: { force, host: worker.host, type: worker.type },
        ipAddress: this._extractIp(req),
        userAgent: req.headers?.['user-agent'] || null,
      });

      return {
        statusCode: 200,
        body: {
          id,
          status: 'unregistered',
          force,
        },
      };
    } catch (err) {
      this._log(`Failed to unregister server '${id}': ${err.message}`);

      // Check for active containers error
      if (err.message && err.message.includes('active container')) {
        return {
          statusCode: 409,
          body: {
            error: 'Conflict',
            message: err.message,
            code: 'SERVER_HAS_ACTIVE_CONTAINERS',
            details: { serverId: id, hint: 'Use ?force=true to force unregister' },
          },
        };
      }

      return {
        statusCode: 500,
        body: {
          error: 'Internal Server Error',
          message: `Failed to unregister server '${id}': ${err.message}`,
        },
      };
    }
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  /**
   * Test SSH connectivity to a remote server
   *
   * Creates a temporary tunnel and immediately closes it to verify
   * that the SSH connection can be established.
   *
   * @param {Object} config - SSH tunnel configuration
   * @returns {Promise<void>}
   * @throws {Error} If SSH connection fails
   * @private
   */
  async _testSSHConnectivity(config) {
    if (!this.sshTunnelManager) {
      throw new ServerRouterError('SSHTunnelManager not available for connectivity test', {
        endpoint: 'register',
      });
    }

    try {
      const tunnel = await this.sshTunnelManager.createTunnel(config);
      // Connection succeeded, close the test tunnel
      await this.sshTunnelManager.closeTunnel(tunnel.workerId);
    } catch (err) {
      // Ensure cleanup of any partial tunnel state
      try {
        await this.sshTunnelManager.closeTunnel(config.workerId);
      } catch (_cleanupErr) {
        // Ignore cleanup errors
      }
      throw err;
    }
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
          reject(new ServerRouterError('Request body too large', { endpoint: 'parseBody' }));
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
      this.logger(`[ServerRouter] ${message}`);
    }
  }
}

export default ServerRouter;
