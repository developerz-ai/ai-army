/**
 * ContainerPool - Container pooling and lifecycle management
 *
 * Manages persistent containers for bot execution using pluggable backends.
 * Provides container reuse, health monitoring, and automatic recycling.
 * Supports multiple backend types (Docker, Incus) and remote hosts.
 *
 * @module execution/container-pool
 */

import { ContainerBackend, ContainerBackendError, BACKEND_TYPES } from './container-backend.js';
import { DockerBackend } from './docker-backend.js';
import { IncusBackend } from './incus-backend.js';
import { DockerError } from './docker-manager.js';

/**
 * Custom error class for ContainerPool-related errors
 */
export class ContainerPoolError extends Error {
  /**
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {string} [options.operation] - The operation that failed
   * @param {string} [options.botId] - Bot ID if applicable
   * @param {Error} [options.cause] - Original error that caused this
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'ContainerPoolError';
    this.operation = options.operation;
    this.botId = options.botId;
  }
}

/**
 * Manages a pool of containers for bot execution
 *
 * Supports pluggable container backends (Docker, Incus, etc.) via the
 * ContainerBackend interface. Accepts either a ContainerBackend instance
 * or a legacy DockerManager for backward compatibility.
 *
 * @example
 * // Using a ContainerBackend (preferred)
 * const backend = new DockerBackend();
 * const pool = new ContainerPool(backend);
 *
 * // Using a legacy DockerManager (backward compatible)
 * const pool = new ContainerPool(dockerManager);
 *
 * // Initialize a container for a bot
 * await pool.initializeContainer('my-bot', botConfig, workspace);
 *
 * // Get the container (reuses existing or throws if not initialized)
 * const container = await pool.getContainer('my-bot');
 *
 * // Clean up when done
 * await pool.cleanup();
 */
export class ContainerPool {
  /**
   * Create a new ContainerPool instance
   *
   * Accepts either a ContainerBackend instance or a DockerManager for
   * backward compatibility. When a DockerManager is passed, it is
   * automatically wrapped in a DockerBackend adapter.
   *
   * @param {ContainerBackend|Object} backend - ContainerBackend or DockerManager instance
   * @throws {ContainerPoolError} When backend is not provided
   */
  constructor(backend) {
    if (!backend) {
      throw new ContainerPoolError('DockerManager is required', {
        operation: 'constructor',
      });
    }

    // Determine if we received a ContainerBackend or a legacy DockerManager
    if (backend instanceof ContainerBackend) {
      /** @type {ContainerBackend} Default backend for container operations */
      this._defaultBackend = backend;
    } else {
      // Legacy path: wrap DockerManager in a DockerBackend adapter
      // Create a DockerBackend that reuses the existing DockerManager instance
      const dockerBackend = new DockerBackend();
      // Replace the internally-created DockerManager with the provided one
      dockerBackend.manager = backend;
      this._defaultBackend = dockerBackend;
    }

    /**
     * Backward-compatible alias for the default DockerManager.
     * Tools (bash-tool.js, file-tools.js) reference `containerPool.dockerManager`
     * for exec operations. This property provides that access regardless of
     * whether the pool was constructed with a backend or DockerManager.
     *
     * @type {Object} DockerManager-compatible object with exec(), healthCheck(), etc.
     */
    this.dockerManager = this._defaultBackend.manager || this._defaultBackend;

    /** @type {Map<string, Object>} Map of botId -> container */
    this.containers = new Map();

    /** @type {Map<string, Object>} Map of botId -> bot configuration */
    this.botConfigs = new Map();

    /** @type {Map<string, Object>} Map of botId -> workspace configuration */
    this.workspaces = new Map();

    /** @type {Map<string, ContainerBackend>} Map of botId -> backend for per-bot overrides */
    this.backends = new Map();

    /**
     * Backward-compatible alias for `this.backends`.
     * Existing code that references `this.dockerManagers` continues to work.
     * @type {Map<string, Object>}
     * @deprecated Use `this.backends` instead
     */
    this.dockerManagers = this.backends;
  }

  /**
   * Get an existing container for a bot
   *
   * Returns the container if it exists and is healthy.
   * If the container exists but is unhealthy, recycles it and recreates.
   *
   * @param {string} botId - Bot identifier
   * @returns {Promise<Object>} Container object
   * @throws {ContainerPoolError} When bot container is not initialized
   */
  async getContainer(botId) {
    if (!botId || typeof botId !== 'string') {
      throw new ContainerPoolError('Bot ID must be a non-empty string', {
        operation: 'getContainer',
      });
    }

    // Check if container exists in pool
    if (!this.containers.has(botId)) {
      throw new ContainerPoolError(
        `Container not initialized for bot ${botId}. Call initializeContainer() first.`,
        {
          operation: 'getContainer',
          botId,
        }
      );
    }

    const container = this.containers.get(botId);

    // Use the correct backend for health checks (may be a per-bot override)
    const backend = this._getBackendForBot(botId);

    // Verify container is healthy
    const isHealthy = await backend.healthCheck(container);

    if (isHealthy) {
      return container;
    }

    // Container is unhealthy - check if we have config to recreate
    if (!this.botConfigs.has(botId) || !this.workspaces.has(botId)) {
      throw new ContainerPoolError(
        `Container for bot ${botId} is unhealthy and cannot be recreated (missing config)`,
        {
          operation: 'getContainer',
          botId,
        }
      );
    }

    // Recycle and recreate the container (preserve per-bot backend)
    await this.recycleContainer(botId);
    return this.initializeContainer(botId, this.botConfigs.get(botId), this.workspaces.get(botId));
  }

  /**
   * Initialize a new container for a bot
   *
   * Creates and starts a container with the specified configuration.
   * If a container already exists for this bot, it will be recycled first.
   * Routes to the correct backend based on `botConfig.sandbox.type`:
   * - `'docker'` or undefined → Docker backend (default)
   * - `'incus'` → Incus backend (when available)
   * Supports remote Docker hosts via the options.dockerHost parameter.
   *
   * @param {string} botId - Bot identifier
   * @param {Object} botConfig - Bot configuration
   * @param {string} botConfig.id - Bot ID (should match botId parameter)
   * @param {Object} [botConfig.sandbox] - Sandbox configuration
   * @param {string} [botConfig.sandbox.type] - Backend type ('docker', 'incus', 'just-bash')
   * @param {string} [botConfig.sandbox.image] - Docker image
   * @param {string} [botConfig.sandbox.memory] - Memory limit
   * @param {number} [botConfig.sandbox.cpus] - CPU cores
   * @param {Array<string>} [botConfig.sandbox.packages] - Packages to install
   * @param {Object} workspace - Workspace configuration
   * @param {string} workspace.root - Root path for workspace mount
   * @param {Object} [options={}] - Additional options
   * @param {string} [options.dockerHost] - Docker host override for remote workers
   *   (e.g., 'tcp://127.0.0.1:54321' for SSH-tunneled remote Docker)
   * @returns {Promise<Object>} Container object
   * @throws {ContainerPoolError} When container creation fails
   */
  async initializeContainer(botId, botConfig, workspace, options = {}) {
    if (!botId || typeof botId !== 'string') {
      throw new ContainerPoolError('Bot ID must be a non-empty string', {
        operation: 'initializeContainer',
      });
    }

    if (!botConfig) {
      throw new ContainerPoolError('Bot configuration is required', {
        operation: 'initializeContainer',
        botId,
      });
    }

    if (!workspace) {
      throw new ContainerPoolError('Workspace configuration is required', {
        operation: 'initializeContainer',
        botId,
      });
    }

    try {
      // Recycle existing container if present
      if (this.containers.has(botId)) {
        await this.recycleContainer(botId);
      }

      // Determine which backend to use based on sandbox type and options
      const backend = this._getBackend(botId, botConfig, options);

      // Ensure botConfig has the correct id
      const config = { ...botConfig, id: botId };

      // Create and start the container
      const container = await backend.createContainer(config, workspace);
      await backend.startContainer(container);

      // Build package list (auto-add Docker CLI when dockerAccess enabled)
      const packages = [...(botConfig.sandbox?.packages || [])];
      if (botConfig.sandbox?.dockerAccess && !packages.includes('docker.io')) {
        packages.push('docker.io');
      }

      // Install packages if specified
      if (packages.length > 0) {
        await backend.installPackages(container, packages);
      }

      // Store in pool
      this.containers.set(botId, container);
      this.botConfigs.set(botId, config);
      this.workspaces.set(botId, workspace);

      return container;
    } catch (err) {
      // Clean up per-bot backend on failure
      this.backends.delete(botId);

      if (
        err instanceof ContainerPoolError ||
        err instanceof DockerError ||
        err instanceof ContainerBackendError
      ) {
        throw err;
      }

      throw new ContainerPoolError(
        `Failed to initialize container for bot ${botId}: ${err.message}`,
        {
          operation: 'initializeContainer',
          botId,
          cause: err,
        }
      );
    }
  }

  /**
   * Recycle a container (stop, remove, and delete from pool)
   *
   * @param {string} botId - Bot identifier
   * @returns {Promise<void>}
   * @throws {ContainerPoolError} When recycling fails
   */
  async recycleContainer(botId) {
    if (!botId || typeof botId !== 'string') {
      throw new ContainerPoolError('Bot ID must be a non-empty string', {
        operation: 'recycleContainer',
      });
    }

    const container = this.containers.get(botId);

    if (!container) {
      // No container to recycle - this is not an error
      return;
    }

    // Use the correct backend for this bot (may be a per-bot override)
    const backend = this._getBackendForBot(botId);

    try {
      // Stop and remove the container
      await backend.stopContainer(container);
    } catch (err) {
      // Log but don't fail if stop/remove fails (container might already be gone)
      if (err instanceof DockerError && err.message?.includes('No such container')) {
        // Container already gone, this is fine
      } else {
        // For other errors, still continue with cleanup but wrap the error
        console.warn(`Warning: Failed to stop container for bot ${botId}: ${err.message}`);
      }
    }

    // Remove from pool and clean up per-bot backend
    this.containers.delete(botId);
    this.backends.delete(botId);
  }

  /**
   * Perform health check on all containers in the pool
   *
   * Checks each container's health and recycles unhealthy ones.
   * Returns a summary of the health check results.
   *
   * @returns {Promise<Object>} Health check results
   * @returns {Array<string>} results.healthy - Bot IDs with healthy containers
   * @returns {Array<string>} results.unhealthy - Bot IDs with unhealthy containers
   * @returns {Array<string>} results.recycled - Bot IDs of recycled containers
   */
  async healthCheckAll() {
    const results = {
      healthy: [],
      unhealthy: [],
      recycled: [],
    };

    for (const [botId, container] of this.containers.entries()) {
      try {
        const backend = this._getBackendForBot(botId);
        const isHealthy = await backend.healthCheck(container);

        if (isHealthy) {
          results.healthy.push(botId);
        } else {
          results.unhealthy.push(botId);

          // Recycle unhealthy container
          await this.recycleContainer(botId);
          results.recycled.push(botId);
        }
      } catch (_err) {
        // If health check fails, consider it unhealthy
        results.unhealthy.push(botId);

        try {
          await this.recycleContainer(botId);
          results.recycled.push(botId);
        } catch (_recycleErr) {
          // Ignore recycle errors, already marked as unhealthy
        }
      }
    }

    return results;
  }

  /**
   * Clean up all containers in the pool
   *
   * Stops and removes all managed containers.
   *
   * @returns {Promise<void>}
   */
  async cleanup() {
    const errors = [];

    for (const [botId, container] of this.containers.entries()) {
      try {
        const backend = this._getBackendForBot(botId);
        await backend.stopContainer(container);
      } catch (err) {
        // Collect errors but continue cleanup
        errors.push({ botId, error: err.message });
      }
    }

    // Clear all maps regardless of errors
    this.containers.clear();
    this.botConfigs.clear();
    this.workspaces.clear();
    this.backends.clear();

    // If there were errors, log them
    if (errors.length > 0) {
      console.warn(
        `Warning: Some containers failed to cleanup: ${errors.map(e => `${e.botId}: ${e.error}`).join(', ')}`
      );
    }
  }

  /**
   * Execute a command in a bot's container
   *
   * Convenience method that abstracts the backend from callers.
   * Gets the container and correct backend for the bot, then delegates
   * the exec call. Tools should call this instead of manually retrieving
   * the container and backend.
   *
   * @param {string} botId - Bot identifier
   * @param {string} command - Bash command to execute
   * @param {Object} [options={}] - Execution options
   * @param {number} [options.timeout=30000] - Command timeout in milliseconds
   * @param {string} [options.user] - User to run command as
   * @param {string} [options.workingDir='/home/agent'] - Working directory
   * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
   * @throws {ContainerPoolError} When bot container is not initialized or exec fails
   */
  async exec(botId, command, options = {}) {
    if (!botId || typeof botId !== 'string') {
      throw new ContainerPoolError('Bot ID must be a non-empty string', {
        operation: 'exec',
      });
    }

    if (!command || typeof command !== 'string') {
      throw new ContainerPoolError('Command must be a non-empty string', {
        operation: 'exec',
        botId,
      });
    }

    const container = await this.getContainer(botId);
    const backend = this._getBackendForBot(botId);
    return backend.exec(container, command, options);
  }

  /**
   * Get the backend assigned to a specific bot
   *
   * Returns the per-bot backend override if one exists, otherwise
   * returns the default backend. This is the public API for callers
   * who need direct backend access (e.g., for health checks or
   * non-exec operations).
   *
   * @param {string} botId - Bot identifier
   * @returns {ContainerBackend} Backend instance for this bot
   */
  getBackend(botId) {
    return this._getBackendForBot(botId);
  }

  /**
   * Check if a container is initialized for a bot
   *
   * @param {string} botId - Bot identifier
   * @returns {boolean} True if container exists in pool
   */
  hasContainer(botId) {
    return this.containers.has(botId);
  }

  /**
   * Get the number of containers in the pool
   *
   * @returns {number} Number of containers
   */
  get size() {
    return this.containers.size;
  }

  /**
   * Get all bot IDs with containers in the pool
   *
   * @returns {Array<string>} Array of bot IDs
   */
  getBotIds() {
    return Array.from(this.containers.keys());
  }

  /**
   * Get the appropriate backend for a bot, considering sandbox type and remote hosts
   *
   * Routes to the correct backend based on:
   * 1. `botConfig.sandbox.type` — selects backend type (docker, incus, etc.)
   * 2. `options.dockerHost` — creates a remote Docker backend if specified
   * 3. `options.incusHost` — creates an Incus backend with a remote socket if specified
   *
   * For Docker backends with a remote host, creates a new DockerBackend instance
   * pointing at the remote Docker daemon. For Incus backends with a remote host,
   * creates an IncusBackend pointing at the tunneled socket.
   *
   * @param {string} botId - Bot identifier
   * @param {Object} botConfig - Bot configuration
   * @param {Object} [options={}] - Backend options
   * @param {string} [options.dockerHost] - Docker host URL (e.g., 'tcp://127.0.0.1:54321')
   * @param {string} [options.incusHost] - Incus socket path for remote Incus daemon
   * @returns {ContainerBackend} Backend instance
   * @private
   */
  _getBackend(botId, botConfig, options = {}) {
    const { dockerHost, incusHost } = options;
    const sandboxType = botConfig.sandbox?.type || BACKEND_TYPES.DOCKER;

    // Route based on sandbox type
    switch (sandboxType) {
      case BACKEND_TYPES.INCUS: {
        // Create an Incus backend for this bot, optionally with remote socket
        const incusOpts = incusHost ? { socketPath: incusHost } : {};
        const incusBackend = new IncusBackend(incusOpts);
        this.backends.set(botId, incusBackend);
        return incusBackend;
      }

      case BACKEND_TYPES.DOCKER:
      default: {
        // Docker backend: check for remote host override
        if (!dockerHost) {
          return this._defaultBackend;
        }

        // Create a remote Docker backend
        const dockerOpts = this._parseDockerHost(dockerHost);
        const remoteBackend = new DockerBackend(dockerOpts);
        this.backends.set(botId, remoteBackend);
        return remoteBackend;
      }
    }
  }

  /**
   * Get the backend assigned to a specific bot
   *
   * Returns the per-bot backend override if one exists, otherwise
   * returns the default backend.
   *
   * @param {string} botId - Bot identifier
   * @returns {ContainerBackend} Backend instance for this bot
   * @private
   */
  _getBackendForBot(botId) {
    return this.backends.has(botId) ? this.backends.get(botId) : this._defaultBackend;
  }

  /**
   * Parse a Docker host URL into dockerode connection options
   *
   * Supports formats:
   * - `tcp://host:port` → { host, port }
   * - `unix:///path/to/socket` → { socketPath }
   * - `/path/to/socket` → socketPath string
   *
   * @param {string} dockerHost - Docker host URL
   * @returns {Object|string} Dockerode connection options
   * @private
   */
  _parseDockerHost(dockerHost) {
    if (dockerHost.startsWith('tcp://')) {
      const url = new URL(dockerHost);
      return {
        host: url.hostname,
        port: parseInt(url.port, 10) || 2375,
      };
    }

    if (dockerHost.startsWith('unix://')) {
      return { socketPath: dockerHost.slice(7) };
    }

    // Assume it's a socket path
    return dockerHost;
  }
}
