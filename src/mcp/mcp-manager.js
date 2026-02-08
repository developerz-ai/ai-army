/**
 * MCPManager - MCP server process lifecycle management
 *
 * Spawns and manages MCP (Model Context Protocol) server processes using
 * stdio transport. Maintains an in-memory registry of running servers,
 * handles server crashes with configurable auto-restart, and exposes
 * discovered tools from each server.
 *
 * Each server entry in the registry contains:
 * - config: original server configuration
 * - process: child process reference (via transport)
 * - client: MCP SDK Client instance
 * - transport: StdioClientTransport instance
 * - tools: array of discovered MCP tools
 * - status: current lifecycle status
 * - restartCount: number of auto-restarts performed
 *
 * @module mcp/mcp-manager
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * Server lifecycle statuses
 */
const SERVER_STATUSES = Object.freeze({
  STARTING: 'starting',
  RUNNING: 'running',
  STOPPING: 'stopping',
  STOPPED: 'stopped',
  RESTARTING: 'restarting',
  ERROR: 'error',
});

/**
 * Default configuration values
 */
const DEFAULTS = Object.freeze({
  MAX_RESTARTS: 3,
  RESTART_DELAY_MS: 1000,
  CONNECT_TIMEOUT_MS: 30000,
  CLIENT_NAME: 'ai-army',
  CLIENT_VERSION: '0.1.0',
});

/**
 * Custom error for MCP manager failures
 */
export class MCPManagerError extends Error {
  /**
   * Create an MCPManagerError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - The operation that failed
   * @param {string} [options.serverId] - ID of the server involved
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'MCPManagerError';
    this.operation = options.operation;
    this.serverId = options.serverId;
  }
}

/**
 * MCPManager - manages MCP server process lifecycle
 *
 * Spawns MCP servers via child_process (stdio transport), maintains
 * client connections, discovers tools, and handles crash recovery.
 *
 * @example
 * const manager = new MCPManager();
 * await manager.startServer({
 *   id: 'github',
 *   command: 'npx',
 *   args: ['-y', '@modelcontextprotocol/server-github'],
 *   env: { GITHUB_TOKEN: 'ghp_...' }
 * });
 * const tools = manager.getServerTools('github');
 * await manager.stopServer('github');
 */
export class MCPManager {
  /**
   * Create an MCPManager instance
   *
   * @param {Object} [options={}] - Configuration options
   * @param {Function|null} [options.logger=null] - Logger function for status messages
   * @param {number} [options.maxRestarts=3] - Maximum auto-restarts per server on crash
   * @param {number} [options.restartDelayMs=1000] - Delay in ms before auto-restart
   * @param {number} [options.connectTimeoutMs=30000] - Timeout in ms for server connection
   */
  constructor(options = {}) {
    /** @type {Function|null} Logger function */
    this.logger = options.logger || null;

    /** @type {number} Maximum auto-restarts per server */
    this.maxRestarts = options.maxRestarts ?? DEFAULTS.MAX_RESTARTS;

    /** @type {number} Delay before auto-restart in ms */
    this.restartDelayMs = options.restartDelayMs ?? DEFAULTS.RESTART_DELAY_MS;

    /** @type {number} Connection timeout in ms */
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULTS.CONNECT_TIMEOUT_MS;

    /** @type {Map<string, Object>} Server registry by ID */
    this.servers = new Map();
  }

  /**
   * Start an MCP server from its configuration
   *
   * Spawns the server process via stdio transport, connects an MCP client,
   * discovers available tools, and registers the server in the internal Map.
   * Sets up crash detection with auto-restart.
   *
   * @param {Object} config - Server configuration
   * @param {string} config.id - Unique server identifier
   * @param {string} config.command - Command to spawn the server process
   * @param {string[]} [config.args=[]] - Arguments for the command
   * @param {Object} [config.env={}] - Environment variables for the process
   * @returns {Promise<Object>} Server entry with client, tools, status
   * @throws {MCPManagerError} If config is invalid, spawn fails, or connection fails
   */
  async startServer(config) {
    this._validateConfig(config);

    const { id } = config;

    // Stop existing server with same id before re-starting
    if (this.servers.has(id)) {
      this._log(`Re-starting server '${id}', stopping existing instance...`);
      await this._stopServer(id);
      this.servers.delete(id);
    }

    const server = {
      id,
      config,
      transport: null,
      client: null,
      tools: [],
      status: SERVER_STATUSES.STARTING,
      restartCount: 0,
      createdAt: new Date(),
    };

    // Store early so the server is tracked during startup
    this.servers.set(id, server);

    try {
      await this._connectServer(server);

      server.status = SERVER_STATUSES.RUNNING;
      this._log(`Started MCP server: ${id} (${config.command}) with ${server.tools.length} tools`);

      return server;
    } catch (err) {
      server.status = SERVER_STATUSES.ERROR;
      this.servers.delete(id);
      if (err instanceof MCPManagerError) {
        throw err;
      }
      throw new MCPManagerError(`Failed to start MCP server '${id}': ${err.message}`, {
        cause: err,
        operation: 'startServer',
        serverId: id,
      });
    }
  }

  /**
   * Stop a running MCP server by ID
   *
   * Disconnects the client, closes the transport, and removes
   * the server from the registry.
   *
   * @param {string} id - Server identifier
   * @returns {Promise<void>}
   * @throws {MCPManagerError} If id is invalid or server is not found
   */
  async stopServer(id) {
    if (!id || typeof id !== 'string') {
      throw new MCPManagerError('Server ID must be a non-empty string', {
        operation: 'stopServer',
      });
    }

    if (!this.servers.has(id)) {
      throw new MCPManagerError(`Server '${id}' not found`, {
        operation: 'stopServer',
        serverId: id,
      });
    }

    await this._stopServer(id);
    this.servers.delete(id);
  }

  /**
   * List all registered servers
   *
   * @returns {Array<Object>} Array of server entries
   */
  listServers() {
    return Array.from(this.servers.values());
  }

  /**
   * Get the tools exposed by a specific server
   *
   * @param {string} id - Server identifier
   * @returns {Array<Object>} Array of MCP tool definitions
   * @throws {MCPManagerError} If id is invalid or server is not found
   */
  getServerTools(id) {
    if (!id || typeof id !== 'string') {
      throw new MCPManagerError('Server ID must be a non-empty string', {
        operation: 'getServerTools',
      });
    }

    const server = this.servers.get(id);
    if (!server) {
      throw new MCPManagerError(`Server '${id}' not found`, {
        operation: 'getServerTools',
        serverId: id,
      });
    }

    return [...server.tools];
  }

  /**
   * Get a server entry by ID
   *
   * @param {string} id - Server identifier
   * @returns {Object|undefined} Server entry or undefined if not found
   */
  getServer(id) {
    return this.servers.get(id);
  }

  /**
   * Check if a server exists by ID
   *
   * @param {string} id - Server identifier
   * @returns {boolean} True if server exists
   */
  hasServer(id) {
    return this.servers.has(id);
  }

  /**
   * Get count of servers, optionally filtered by status
   *
   * @param {string} [status] - Status to filter by. If omitted, returns total count.
   * @returns {number} Number of servers matching the status
   */
  getServerCount(status) {
    if (!status) {
      return this.servers.size;
    }
    return this.listServers().filter(s => s.status === status).length;
  }

  /**
   * Stop all running servers gracefully
   *
   * Iterates over all servers and stops each one.
   * Collects results and continues even if individual servers fail.
   *
   * @returns {Promise<Object>} Results with stopped/failed arrays
   */
  async stopAll() {
    const results = { stopped: [], failed: [] };

    for (const [id] of this.servers) {
      try {
        await this._stopServer(id);
        results.stopped.push(id);
      } catch (err) {
        results.failed.push({ id, error: err.message });
      }
    }

    this.servers.clear();
    return results;
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  /**
   * Validate server configuration
   *
   * @param {Object} config - Server configuration to validate
   * @throws {MCPManagerError} If config is invalid
   * @private
   */
  _validateConfig(config) {
    if (!config || typeof config !== 'object') {
      throw new MCPManagerError('Server config must be a non-null object', {
        operation: 'startServer',
      });
    }

    if (!config.id || typeof config.id !== 'string') {
      throw new MCPManagerError('Server config must include a non-empty string "id"', {
        operation: 'startServer',
      });
    }

    if (!config.command || typeof config.command !== 'string') {
      throw new MCPManagerError(
        `Server '${config.id}' config must include a non-empty string "command"`,
        { operation: 'startServer', serverId: config.id }
      );
    }

    if (config.args !== undefined && !Array.isArray(config.args)) {
      throw new MCPManagerError(
        `Server '${config.id}' config "args" must be an array if provided`,
        { operation: 'startServer', serverId: config.id }
      );
    }

    if (config.env !== undefined && (typeof config.env !== 'object' || config.env === null)) {
      throw new MCPManagerError(
        `Server '${config.id}' config "env" must be an object if provided`,
        { operation: 'startServer', serverId: config.id }
      );
    }
  }

  /**
   * Connect to an MCP server by creating transport, client, and discovering tools
   *
   * @param {Object} server - Server entry from the registry
   * @returns {Promise<void>}
   * @private
   */
  async _connectServer(server) {
    const { config } = server;

    // Create stdio transport
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args || [],
      env: { ...process.env, ...(config.env || {}) },
      stderr: 'pipe',
    });

    // Create MCP client
    const client = new Client(
      { name: DEFAULTS.CLIENT_NAME, version: DEFAULTS.CLIENT_VERSION },
      { capabilities: {} }
    );

    // Connect client to transport
    await client.connect(transport);

    // Discover tools
    let tools = [];
    try {
      const result = await client.listTools();
      tools = result.tools || [];
    } catch (_err) {
      // Server may not support tools - that's okay
      this._log(`Server '${config.id}' does not expose tools or tool listing failed`);
    }

    server.transport = transport;
    server.client = client;
    server.tools = tools;

    // Set up crash detection
    this._setupCrashHandler(server);
  }

  /**
   * Set up crash detection and auto-restart for a server
   *
   * Listens for the transport close event. If the server was not
   * intentionally stopped and the restart limit has not been reached,
   * it will attempt an auto-restart after a configurable delay.
   *
   * @param {Object} server - Server entry from the registry
   * @private
   */
  _setupCrashHandler(server) {
    const { transport } = server;
    if (!transport) {
      return;
    }

    const originalOnClose = transport.onclose;
    transport.onclose = () => {
      if (originalOnClose) {
        originalOnClose();
      }

      // Only auto-restart if the server was running (not intentionally stopped)
      if (server.status !== SERVER_STATUSES.RUNNING) {
        return;
      }

      server.status = SERVER_STATUSES.ERROR;
      this._log(`MCP server '${server.id}' crashed`);

      if (server.restartCount < this.maxRestarts) {
        this._autoRestart(server);
      } else {
        this._log(
          `MCP server '${server.id}' exceeded max restarts (${this.maxRestarts}), not restarting`
        );
      }
    };
  }

  /**
   * Attempt to auto-restart a crashed server
   *
   * @param {Object} server - Server entry from the registry
   * @private
   */
  _autoRestart(server) {
    server.status = SERVER_STATUSES.RESTARTING;
    server.restartCount += 1;
    this._log(
      `Auto-restarting MCP server '${server.id}' (attempt ${server.restartCount}/${this.maxRestarts})`
    );

    setTimeout(async () => {
      try {
        await this._connectServer(server);
        server.status = SERVER_STATUSES.RUNNING;
        this._log(
          `MCP server '${server.id}' restarted successfully with ${server.tools.length} tools`
        );
      } catch (err) {
        server.status = SERVER_STATUSES.ERROR;
        this._log(`Failed to restart MCP server '${server.id}': ${err.message}`);

        // Try again if under the limit
        if (server.restartCount < this.maxRestarts) {
          this._autoRestart(server);
        } else {
          this._log(
            `MCP server '${server.id}' exceeded max restarts (${this.maxRestarts}), giving up`
          );
        }
      }
    }, this.restartDelayMs);
  }

  /**
   * Stop a single server (internal helper - does not remove from map)
   *
   * @param {string} id - Server identifier
   * @returns {Promise<void>}
   * @private
   */
  async _stopServer(id) {
    const server = this.servers.get(id);
    if (!server) {
      return;
    }

    server.status = SERVER_STATUSES.STOPPING;

    try {
      // Close client connection
      if (server.client) {
        try {
          await server.client.close();
        } catch (_err) {
          // Client may already be disconnected
        }
      }

      // Close transport (kills child process)
      if (server.transport) {
        try {
          await server.transport.close();
        } catch (_err) {
          // Transport may already be closed
        }
      }

      server.client = null;
      server.transport = null;
      server.tools = [];
      server.status = SERVER_STATUSES.STOPPED;
      this._log(`Stopped MCP server: ${id}`);
    } catch (err) {
      server.status = SERVER_STATUSES.ERROR;
      throw new MCPManagerError(`Failed to stop MCP server '${id}': ${err.message}`, {
        cause: err,
        operation: 'stopServer',
        serverId: id,
      });
    }
  }

  /**
   * Log a message if logger is available
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

export { SERVER_STATUSES, DEFAULTS };
