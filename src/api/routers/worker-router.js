/**
 * WorkerRouter - HTTP router for worker management API endpoints
 *
 * Provides RESTful endpoints for worker operations:
 * - POST   /api/v1/workers              -> Provision a new worker
 * - GET    /api/v1/workers              -> List workers (with filters & pagination)
 * - GET    /api/v1/workers/:id          -> Get worker details
 * - GET    /api/v1/workers/:id/status   -> Get comprehensive worker status
 * - PUT    /api/v1/workers/:id/image    -> Update worker image
 * - PUT    /api/v1/workers/:id/expertise -> Update worker expertise
 * - POST   /api/v1/workers/:id/reload   -> Reload worker configuration
 * - POST   /api/v1/workers/:id/stop     -> Stop a worker
 * - POST   /api/v1/workers/:id/start    -> Start a worker
 * - DELETE /api/v1/workers/:id          -> Deprovision a worker
 * - POST   /api/v1/workers/:id/assign   -> Assign a task to a worker
 *
 * Authentication via Bearer token in the Authorization header.
 * Uses Node.js built-in http module (no Express/Fastify dependency).
 *
 * @module api/routers/worker-router
 */

/**
 * Custom error for worker router failures
 */
export class WorkerRouterError extends Error {
  /**
   * Create a WorkerRouterError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error
   * @param {string} [options.endpoint] - The endpoint that failed
   * @param {number} [options.statusCode] - HTTP status code
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'WorkerRouterError';
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
 * WorkerRouter - lightweight HTTP router for worker management endpoints
 *
 * @example
 * const router = new WorkerRouter({
 *   botManager,
 *   sessionManager,
 *   messageProcessor,
 *   apiKey: 'secret',
 * });
 * // In your HTTP server:
 * const handled = await router.handleRequest(req, res);
 * if (!handled) { // pass to next router }
 */
export class WorkerRouter {
  /**
   * Create a WorkerRouter instance
   *
   * @param {Object} options - Configuration options
   * @param {import('../../core/bot-manager.js').BotManager} options.botManager - BotManager instance
   * @param {import('../../core/session-manager.js').SessionManager} [options.sessionManager] - SessionManager instance
   * @param {import('../../core/message-processor.js').MessageProcessor} [options.messageProcessor] - MessageProcessor instance
   * @param {Object} [options.workerRegistry] - WorkerRegistry instance for worker state
   * @param {Object} [options.workerAssigner] - WorkerAssigner instance for task assignment
   * @param {string} [options.apiKey] - API key for authentication
   * @param {Function|null} [options.logger=null] - Logger function
   * @param {Object} [options.auditLogger] - AuditLogger instance for recording audit events
   */
  constructor(options = {}) {
    if (!options.botManager) {
      throw new WorkerRouterError('BotManager is required', {
        endpoint: 'constructor',
      });
    }

    /** @type {import('../../core/bot-manager.js').BotManager} */
    this.botManager = options.botManager;

    /** @type {import('../../core/session-manager.js').SessionManager|null} */
    this.sessionManager = options.sessionManager || null;

    /** @type {import('../../core/message-processor.js').MessageProcessor|null} */
    this.messageProcessor = options.messageProcessor || null;

    /** @type {Object|null} WorkerRegistry for worker state queries */
    this.workerRegistry = options.workerRegistry || null;

    /** @type {Object|null} WorkerAssigner for task assignment */
    this.workerAssigner = options.workerAssigner || null;

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
   * Register all worker API routes
   * @private
   */
  _registerRoutes() {
    // List workers (must come before :id routes)
    this._addRoute('GET', '/api/v1/workers', req => this._handleListWorkers(req));

    // Worker status (must come before generic :id GET)
    this._addRoute('GET', '/api/v1/workers/:id/status', req => this._handleWorkerStatus(req));

    // Worker details
    this._addRoute('GET', '/api/v1/workers/:id', req => this._handleGetWorker(req));

    // Provision worker
    this._addRoute('POST', '/api/v1/workers', req => this._handleProvisionWorker(req));

    // Update worker image
    this._addRoute('PUT', '/api/v1/workers/:id/image', req => this._handleUpdateImage(req));

    // Update worker expertise
    this._addRoute('PUT', '/api/v1/workers/:id/expertise', req => this._handleUpdateExpertise(req));

    // Reload worker
    this._addRoute('POST', '/api/v1/workers/:id/reload', req => this._handleReloadWorker(req));

    // Stop worker
    this._addRoute('POST', '/api/v1/workers/:id/stop', req => this._handleStopWorker(req));

    // Start worker
    this._addRoute('POST', '/api/v1/workers/:id/start', req => this._handleStartWorker(req));

    // Deprovision worker
    this._addRoute('DELETE', '/api/v1/workers/:id', req => this._handleDeprovisionWorker(req));

    // Assign task
    this._addRoute('POST', '/api/v1/workers/:id/assign', req => this._handleAssignTask(req));
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

    // Only handle /api/v1/workers paths
    if (!pathname.startsWith('/api/v1/workers')) {
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
        this._log(`Worker API error on ${method} ${pathname}: ${err.message}`);
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
   * POST /api/v1/workers
   *
   * Provision a new worker. Loads the bot config, starts the bot,
   * and returns the provisioned worker info.
   *
   * @param {import('http').IncomingMessage} req - HTTP request (with body)
   * @returns {Promise<{statusCode: number, body: Object}>} Response
   * @private
   */
  async _handleProvisionWorker(req) {
    const body = req.body || {};
    const { id, name, type, image, expertise, resources, tools, mcpServers, llm } = body;

    if (!id || typeof id !== 'string') {
      return {
        statusCode: 400,
        body: {
          error: 'Validation Error',
          message: 'Worker "id" is required and must be a non-empty string',
          code: 'VALIDATION_ERROR',
        },
      };
    }

    // Check if worker already exists
    const existing = this.botManager.getBot(id);
    if (existing) {
      return {
        statusCode: 409,
        body: {
          error: 'Conflict',
          message: `Worker '${id}' already exists`,
          code: 'WORKER_ALREADY_EXISTS',
        },
      };
    }

    try {
      // Build a bot config from worker provision request
      const botConfig = {
        id,
        name: name || id,
        model: llm?.model || 'default',
        provider: llm?.provider || 'anthropic',
        channels: ['rest'],
        sandbox: {
          image: image || 'ai-army/worker:latest',
          ...(resources?.memory && { memory: resources.memory }),
          ...(resources?.cpu && { cpus: resources.cpu }),
        },
        ...(tools && { tools }),
        ...(mcpServers && { mcpServers }),
        ...(type && { type }),
      };

      // Load the bot
      await this.botManager.loadBot(id, botConfig);

      // Start the bot
      await this.botManager.startBot(id);

      const bot = this.botManager.getBot(id);

      // Update expertise/soul content if provided
      if (expertise && bot) {
        bot.soulContent = expertise;
      }

      this._auditLog({
        type: 'worker.provisioned',
        actor: this._extractActor(req),
        actorType: 'api',
        resourceType: 'worker',
        resourceId: id,
        action: 'provisioned',
        metadata: { name: name || id, type, image },
        ipAddress: this._extractIp(req),
        userAgent: req.headers?.['user-agent'] || null,
      });

      return {
        statusCode: 201,
        body: {
          workerId: id,
          serverId: bot?.workerId || null,
          status: bot?.status || 'running',
          name: name || id,
          type: type || null,
          image: image || 'ai-army/worker:latest',
          createdAt: bot?.createdAt || new Date().toISOString(),
        },
      };
    } catch (err) {
      this._log(`Failed to provision worker '${id}': ${err.message}`);

      // Clean up partial state
      try {
        await this.botManager.removeBot(id);
      } catch (_cleanupErr) {
        // Ignore cleanup errors
      }

      return {
        statusCode: 500,
        body: {
          error: 'Deployment Failed',
          message: `Failed to provision worker '${id}': ${err.message}`,
          code: 'DEPLOYMENT_FAILED',
        },
      };
    }
  }

  /**
   * GET /api/v1/workers
   *
   * List all workers with optional filtering and pagination.
   *
   * Query params:
   * - status: Filter by status (running, stopped, error)
   * - serverId: Filter by server/worker ID
   * - type: Filter by worker type
   * - page: Page number (default: 1)
   * - limit: Items per page (default: 50, max: 250)
   *
   * @param {import('http').IncomingMessage} req - HTTP request
   * @returns {Promise<{statusCode: number, body: Object}>} Response
   * @private
   */
  async _handleListWorkers(req) {
    const statusFilter = req.searchParams?.get('status') || null;
    const serverIdFilter = req.searchParams?.get('serverId') || null;
    const typeFilter = req.searchParams?.get('type') || null;
    const page = Math.max(parseInt(req.searchParams?.get('page') || '1', 10), 1);
    const rawLimit = Math.max(parseInt(req.searchParams?.get('limit') || '50', 10), 1);
    const limit = Math.min(rawLimit, 250);

    let workers = this.botManager.listBots();

    // Apply filters
    if (statusFilter) {
      workers = workers.filter(w => w.status === statusFilter);
    }

    if (serverIdFilter) {
      workers = workers.filter(w => w.workerId === serverIdFilter);
    }

    if (typeFilter) {
      workers = workers.filter(w => w.config?.type === typeFilter);
    }

    // Calculate pagination
    const total = workers.length;
    const pages = Math.ceil(total / limit) || 1;
    const offset = (page - 1) * limit;
    const paginatedWorkers = workers.slice(offset, offset + limit);

    const data = paginatedWorkers.map(w => ({
      id: w.id,
      name: w.config?.name || w.id,
      type: w.config?.type || null,
      status: w.status,
      serverId: w.workerId || null,
      image: w.config?.sandbox?.image || null,
      createdAt: w.createdAt || null,
      lastActiveAt: w.lastActiveAt || null,
    }));

    return {
      statusCode: 200,
      body: {
        workers: data,
        total,
        pagination: {
          page,
          limit,
          total,
          pages,
        },
      },
    };
  }

  /**
   * GET /api/v1/workers/:id
   *
   * Get detailed information about a specific worker.
   *
   * @param {import('http').IncomingMessage} req - HTTP request (with params.id)
   * @returns {Promise<{statusCode: number, body: Object}>} Response
   * @private
   */
  async _handleGetWorker(req) {
    const { id } = req.params;
    const bot = this.botManager.getBot(id);

    if (!bot) {
      return {
        statusCode: 404,
        body: {
          error: 'Not Found',
          message: `Worker '${id}' not found`,
          code: 'WORKER_NOT_FOUND',
          details: { workerId: id },
        },
      };
    }

    return {
      statusCode: 200,
      body: {
        id: bot.id,
        name: bot.config?.name || bot.id,
        type: bot.config?.type || null,
        status: bot.status,
        server: {
          id: bot.workerId || null,
        },
        container: {
          id: bot.container?.id || null,
          image: bot.config?.sandbox?.image || null,
        },
        config: {
          tools: bot.config?.tools ? Object.keys(bot.config.tools) : [],
          mcpServers: bot.config?.mcpServers || [],
          resources: {
            cpu: bot.config?.sandbox?.cpus || null,
            memory: bot.config?.sandbox?.memory || null,
          },
        },
        expertise: bot.soulContent ? true : false,
        createdAt: bot.createdAt || null,
        lastActiveAt: bot.lastActiveAt || null,
      },
    };
  }

  /**
   * GET /api/v1/workers/:id/status
   *
   * Get comprehensive status of a specific worker.
   *
   * @param {import('http').IncomingMessage} req - HTTP request (with params.id)
   * @returns {Promise<{statusCode: number, body: Object}>} Response
   * @private
   */
  async _handleWorkerStatus(req) {
    const { id } = req.params;
    const bot = this.botManager.getBot(id);

    if (!bot) {
      return {
        statusCode: 404,
        body: {
          error: 'Not Found',
          message: `Worker '${id}' not found`,
          code: 'WORKER_NOT_FOUND',
          details: { workerId: id },
        },
      };
    }

    // Determine health based on status
    let health = 'unknown';
    if (bot.status === 'running') health = 'healthy';
    else if (bot.status === 'stopped') health = 'stopped';
    else if (bot.status === 'error') health = 'unhealthy';

    // Get worker registry info if available
    let workerInfo = null;
    if (this.workerRegistry && bot.workerId) {
      try {
        const load = await this.workerRegistry.getWorkerLoad(bot.workerId);
        if (load) {
          workerInfo = {
            id: bot.workerId,
            status: load.status,
            currentLoad: load.currentLoad,
            maxContainers: load.maxContainers,
          };
        }
      } catch (_err) {
        // Worker registry info is optional
      }
    }

    return {
      statusCode: 200,
      body: {
        workerId: bot.id,
        status: bot.status,
        health,
        server: workerInfo
          ? { id: workerInfo.id, healthy: workerInfo.status === 'healthy' }
          : { id: bot.workerId || null, healthy: null },
        container: {
          id: bot.container?.id || null,
          state: bot.status,
          restartCount: 0,
        },
        resources: {
          cpu: bot.config?.sandbox?.cpus || null,
          memory: bot.config?.sandbox?.memory || null,
        },
        createdAt: bot.createdAt || null,
        lastActiveAt: bot.lastActiveAt || null,
      },
    };
  }

  /**
   * PUT /api/v1/workers/:id/image
   *
   * Update a worker's Docker image.
   *
   * @param {import('http').IncomingMessage} req - HTTP request (with params.id and body)
   * @returns {Promise<{statusCode: number, body: Object}>} Response
   * @private
   */
  async _handleUpdateImage(req) {
    const { id } = req.params;
    const bot = this.botManager.getBot(id);

    if (!bot) {
      return {
        statusCode: 404,
        body: {
          error: 'Not Found',
          message: `Worker '${id}' not found`,
          code: 'WORKER_NOT_FOUND',
        },
      };
    }

    const { image } = req.body || {};
    if (!image || typeof image !== 'string') {
      return {
        statusCode: 400,
        body: {
          error: 'Validation Error',
          message: '"image" is required and must be a non-empty string',
          code: 'VALIDATION_ERROR',
        },
      };
    }

    const previousImage = bot.config?.sandbox?.image || null;

    // Update the sandbox image in config
    if (!bot.config.sandbox) {
      bot.config.sandbox = {};
    }
    bot.config.sandbox.image = image;
    bot.lastActiveAt = new Date();

    this._auditLog({
      type: 'worker.image_updated',
      actor: this._extractActor(req),
      actorType: 'api',
      resourceType: 'worker',
      resourceId: id,
      action: 'image_updated',
      metadata: { previousImage, newImage: image },
      ipAddress: this._extractIp(req),
      userAgent: req.headers?.['user-agent'] || null,
    });

    return {
      statusCode: 200,
      body: {
        workerId: id,
        previousImage,
        newImage: image,
        status: 'updated',
      },
    };
  }

  /**
   * PUT /api/v1/workers/:id/expertise
   *
   * Update a worker's expertise (soul content / system prompt).
   *
   * @param {import('http').IncomingMessage} req - HTTP request (with params.id and body)
   * @returns {Promise<{statusCode: number, body: Object}>} Response
   * @private
   */
  async _handleUpdateExpertise(req) {
    const { id } = req.params;
    const bot = this.botManager.getBot(id);

    if (!bot) {
      return {
        statusCode: 404,
        body: {
          error: 'Not Found',
          message: `Worker '${id}' not found`,
          code: 'WORKER_NOT_FOUND',
        },
      };
    }

    const { expertise } = req.body || {};
    if (!expertise || typeof expertise !== 'string') {
      return {
        statusCode: 400,
        body: {
          error: 'Validation Error',
          message: '"expertise" is required and must be a non-empty string',
          code: 'VALIDATION_ERROR',
        },
      };
    }

    bot.soulContent = expertise;
    bot.lastActiveAt = new Date();

    this._auditLog({
      type: 'worker.expertise_updated',
      actor: this._extractActor(req),
      actorType: 'api',
      resourceType: 'worker',
      resourceId: id,
      action: 'expertise_updated',
      metadata: { expertiseLength: expertise.length },
      ipAddress: this._extractIp(req),
      userAgent: req.headers?.['user-agent'] || null,
    });

    return {
      statusCode: 200,
      body: {
        workerId: id,
        status: 'updated',
        expertiseLength: expertise.length,
      },
    };
  }

  /**
   * POST /api/v1/workers/:id/reload
   *
   * Reload worker configuration without restarting the container.
   *
   * @param {import('http').IncomingMessage} req - HTTP request (with params.id)
   * @returns {Promise<{statusCode: number, body: Object}>} Response
   * @private
   */
  async _handleReloadWorker(req) {
    const { id } = req.params;
    const bot = this.botManager.getBot(id);

    if (!bot) {
      return {
        statusCode: 404,
        body: {
          error: 'Not Found',
          message: `Worker '${id}' not found`,
          code: 'WORKER_NOT_FOUND',
        },
      };
    }

    try {
      await this.botManager.reloadBot(id, bot.config);

      this._auditLog({
        type: 'worker.reloaded',
        actor: this._extractActor(req),
        actorType: 'api',
        resourceType: 'worker',
        resourceId: id,
        action: 'reloaded',
        ipAddress: this._extractIp(req),
        userAgent: req.headers?.['user-agent'] || null,
      });

      return {
        statusCode: 200,
        body: {
          workerId: id,
          status: 'reloaded',
        },
      };
    } catch (err) {
      this._log(`Failed to reload worker '${id}': ${err.message}`);
      return {
        statusCode: 500,
        body: {
          error: 'Internal Server Error',
          message: `Failed to reload worker '${id}': ${err.message}`,
        },
      };
    }
  }

  /**
   * POST /api/v1/workers/:id/stop
   *
   * Stop a running worker.
   *
   * @param {import('http').IncomingMessage} req - HTTP request (with params.id)
   * @returns {Promise<{statusCode: number, body: Object}>} Response
   * @private
   */
  async _handleStopWorker(req) {
    const { id } = req.params;
    const bot = this.botManager.getBot(id);

    if (!bot) {
      return {
        statusCode: 404,
        body: {
          error: 'Not Found',
          message: `Worker '${id}' not found`,
          code: 'WORKER_NOT_FOUND',
        },
      };
    }

    if (bot.status === 'stopped') {
      return {
        statusCode: 200,
        body: {
          workerId: id,
          status: 'stopped',
          message: 'Worker is already stopped',
        },
      };
    }

    try {
      await this.botManager.stopBot(id);

      this._auditLog({
        type: 'worker.stopped',
        actor: this._extractActor(req),
        actorType: 'api',
        resourceType: 'worker',
        resourceId: id,
        action: 'stopped',
        ipAddress: this._extractIp(req),
        userAgent: req.headers?.['user-agent'] || null,
      });

      return {
        statusCode: 200,
        body: {
          workerId: id,
          status: 'stopped',
        },
      };
    } catch (err) {
      this._log(`Failed to stop worker '${id}': ${err.message}`);
      return {
        statusCode: 500,
        body: {
          error: 'Internal Server Error',
          message: `Failed to stop worker '${id}': ${err.message}`,
        },
      };
    }
  }

  /**
   * POST /api/v1/workers/:id/start
   *
   * Start a stopped worker.
   *
   * @param {import('http').IncomingMessage} req - HTTP request (with params.id)
   * @returns {Promise<{statusCode: number, body: Object}>} Response
   * @private
   */
  async _handleStartWorker(req) {
    const { id } = req.params;
    const bot = this.botManager.getBot(id);

    if (!bot) {
      return {
        statusCode: 404,
        body: {
          error: 'Not Found',
          message: `Worker '${id}' not found`,
          code: 'WORKER_NOT_FOUND',
        },
      };
    }

    if (bot.status === 'running') {
      return {
        statusCode: 200,
        body: {
          workerId: id,
          status: 'running',
          message: 'Worker is already running',
        },
      };
    }

    try {
      await this.botManager.startBot(id);

      this._auditLog({
        type: 'worker.started',
        actor: this._extractActor(req),
        actorType: 'api',
        resourceType: 'worker',
        resourceId: id,
        action: 'started',
        ipAddress: this._extractIp(req),
        userAgent: req.headers?.['user-agent'] || null,
      });

      return {
        statusCode: 200,
        body: {
          workerId: id,
          status: 'running',
        },
      };
    } catch (err) {
      this._log(`Failed to start worker '${id}': ${err.message}`);
      return {
        statusCode: 500,
        body: {
          error: 'Internal Server Error',
          message: `Failed to start worker '${id}': ${err.message}`,
        },
      };
    }
  }

  /**
   * DELETE /api/v1/workers/:id
   *
   * Deprovision a worker. Stops the bot and removes it from the manager.
   *
   * Query params:
   * - preserveWorkspace: If 'true', keep the workspace volume (default: false)
   *
   * @param {import('http').IncomingMessage} req - HTTP request (with params.id)
   * @returns {Promise<{statusCode: number, body: Object}>} Response
   * @private
   */
  async _handleDeprovisionWorker(req) {
    const { id } = req.params;
    const bot = this.botManager.getBot(id);

    if (!bot) {
      return {
        statusCode: 404,
        body: {
          error: 'Not Found',
          message: `Worker '${id}' not found`,
          code: 'WORKER_NOT_FOUND',
        },
      };
    }

    const preserveWorkspace = req.searchParams?.get('preserveWorkspace') === 'true';

    try {
      await this.botManager.removeBot(id);

      this._auditLog({
        type: 'worker.deprovisioned',
        actor: this._extractActor(req),
        actorType: 'api',
        resourceType: 'worker',
        resourceId: id,
        action: 'deprovisioned',
        metadata: { preserveWorkspace },
        ipAddress: this._extractIp(req),
        userAgent: req.headers?.['user-agent'] || null,
      });

      return {
        statusCode: 200,
        body: {
          workerId: id,
          status: 'deprovisioned',
          preserveWorkspace,
        },
      };
    } catch (err) {
      this._log(`Failed to deprovision worker '${id}': ${err.message}`);
      return {
        statusCode: 500,
        body: {
          error: 'Internal Server Error',
          message: `Failed to deprovision worker '${id}': ${err.message}`,
        },
      };
    }
  }

  /**
   * POST /api/v1/workers/:id/assign
   *
   * Assign a task to a worker.
   *
   * @param {import('http').IncomingMessage} req - HTTP request (with params.id and body)
   * @returns {Promise<{statusCode: number, body: Object}>} Response
   * @private
   */
  async _handleAssignTask(req) {
    const { id } = req.params;
    const bot = this.botManager.getBot(id);

    if (!bot) {
      return {
        statusCode: 404,
        body: {
          error: 'Not Found',
          message: `Worker '${id}' not found`,
          code: 'WORKER_NOT_FOUND',
        },
      };
    }

    if (!this.messageProcessor) {
      return {
        statusCode: 503,
        body: {
          error: 'Service Unavailable',
          message: 'Message processing is not available',
        },
      };
    }

    const { task, context } = req.body || {};
    if (!task || typeof task !== 'string') {
      return {
        statusCode: 400,
        body: {
          error: 'Validation Error',
          message: '"task" is required and must be a non-empty string',
          code: 'VALIDATION_ERROR',
        },
      };
    }

    // Build task text with optional context
    let taskText = task;
    if (context) {
      if (context.files && Array.isArray(context.files)) {
        taskText += `\n\nRelevant files: ${context.files.join(', ')}`;
      }
      if (context.requirements) {
        taskText += `\n\nRequirements: ${context.requirements}`;
      }
    }

    try {
      const assignmentId = `asgn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const result = await this.messageProcessor.processMessage(bot.config, {
        type: 'rest',
        userId: 'api-assignment',
        channelId: 'rest-api',
        text: taskText,
      });

      this._auditLog({
        type: 'worker.task_assigned',
        actor: this._extractActor(req),
        actorType: 'api',
        resourceType: 'worker',
        resourceId: id,
        action: 'task_assigned',
        metadata: {
          assignmentId,
          task,
          sessionId: result.sessionId,
          durationMs: result.durationMs,
        },
        ipAddress: this._extractIp(req),
        userAgent: req.headers?.['user-agent'] || null,
      });

      return {
        statusCode: 200,
        body: {
          assignmentId,
          workerId: id,
          status: 'completed',
          result: {
            text: result.text,
            sessionId: result.sessionId,
            durationMs: result.durationMs,
            usage: result.usage || null,
          },
        },
      };
    } catch (err) {
      this._log(`Failed to assign task to worker '${id}': ${err.message}`);
      return {
        statusCode: 500,
        body: {
          error: 'Internal Server Error',
          message: `Failed to assign task to worker '${id}': ${err.message}`,
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
          reject(new WorkerRouterError('Request body too large', { endpoint: 'parseBody' }));
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
      this.logger(`[WorkerRouter] ${message}`);
    }
  }
}

export default WorkerRouter;
