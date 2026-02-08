/**
 * ContainerPool - Container pooling and lifecycle management
 *
 * Manages persistent Docker containers for bot execution.
 * Provides container reuse, health monitoring, and automatic recycling.
 * Supports remote Docker hosts for distributed worker deployment.
 *
 * @module execution/container-pool
 */

import { DockerManager, DockerError } from './docker-manager.js';

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
 * Manages a pool of Docker containers for bot execution
 *
 * @example
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
   * @param {Object} dockerManager - DockerManager instance for container operations
   * @throws {ContainerPoolError} When dockerManager is not provided
   */
  constructor(dockerManager) {
    if (!dockerManager) {
      throw new ContainerPoolError('DockerManager is required', {
        operation: 'constructor',
      });
    }

    /** @type {Object} Default DockerManager instance (local Docker) */
    this.dockerManager = dockerManager;

    /** @type {Map<string, Object>} Map of botId -> container */
    this.containers = new Map();

    /** @type {Map<string, Object>} Map of botId -> bot configuration */
    this.botConfigs = new Map();

    /** @type {Map<string, Object>} Map of botId -> workspace configuration */
    this.workspaces = new Map();

    /** @type {Map<string, Object>} Map of botId -> DockerManager for remote hosts */
    this.dockerManagers = new Map();
  }

  /**
   * Get an existing container for a bot
   *
   * Returns the container if it exists and is healthy.
   * If the container exists but is unhealthy, recycles it and recreates.
   *
   * @param {string} botId - Bot identifier
   * @returns {Promise<Object>} Docker container object
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

    // Use the correct DockerManager for health checks (may be a remote manager)
    const manager = this.dockerManagers.has(botId)
      ? this.dockerManagers.get(botId)
      : this.dockerManager;

    // Verify container is healthy
    const isHealthy = await manager.healthCheck(container);

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

    // Recycle and recreate the container (preserve remote docker manager)
    await this.recycleContainer(botId);
    return this.initializeContainer(botId, this.botConfigs.get(botId), this.workspaces.get(botId));
  }

  /**
   * Initialize a new container for a bot
   *
   * Creates and starts a container with the specified configuration.
   * If a container already exists for this bot, it will be recycled first.
   * Supports remote Docker hosts via the options.dockerHost parameter,
   * enabling distributed container placement across worker nodes.
   *
   * @param {string} botId - Bot identifier
   * @param {Object} botConfig - Bot configuration
   * @param {string} botConfig.id - Bot ID (should match botId parameter)
   * @param {Object} [botConfig.sandbox] - Sandbox configuration
   * @param {string} [botConfig.sandbox.image] - Docker image
   * @param {string} [botConfig.sandbox.memory] - Memory limit
   * @param {number} [botConfig.sandbox.cpus] - CPU cores
   * @param {Array<string>} [botConfig.sandbox.packages] - Packages to install
   * @param {Object} workspace - Workspace configuration
   * @param {string} workspace.root - Root path for workspace mount
   * @param {Object} [options={}] - Additional options
   * @param {string} [options.dockerHost] - Docker host override for remote workers
   *   (e.g., 'tcp://127.0.0.1:54321' for SSH-tunneled remote Docker)
   * @returns {Promise<Object>} Docker container object
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

      // Determine which DockerManager to use
      const manager = this._getDockerManager(botId, options.dockerHost);

      // Ensure botConfig has the correct id
      const config = { ...botConfig, id: botId };

      // Create and start the container
      const container = await manager.createContainer(config, workspace);
      await manager.startContainer(container);

      // Install packages if specified
      if (botConfig.sandbox?.packages?.length > 0) {
        await manager.installPackages(container, botConfig.sandbox.packages);
      }

      // Store in pool
      this.containers.set(botId, container);
      this.botConfigs.set(botId, config);
      this.workspaces.set(botId, workspace);

      return container;
    } catch (err) {
      // Clean up remote docker manager on failure
      this.dockerManagers.delete(botId);

      if (err instanceof ContainerPoolError || err instanceof DockerError) {
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

    // Use the correct DockerManager for this bot (may be remote)
    const manager = this.dockerManagers.has(botId)
      ? this.dockerManagers.get(botId)
      : this.dockerManager;

    try {
      // Stop and remove the container
      await manager.stopContainer(container);
    } catch (err) {
      // Log but don't fail if stop/remove fails (container might already be gone)
      if (err instanceof DockerError && err.message?.includes('No such container')) {
        // Container already gone, this is fine
      } else {
        // For other errors, still continue with cleanup but wrap the error
        console.warn(`Warning: Failed to stop container for bot ${botId}: ${err.message}`);
      }
    }

    // Remove from pool and clean up remote docker manager
    this.containers.delete(botId);
    this.dockerManagers.delete(botId);
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
        const manager = this.dockerManagers.has(botId)
          ? this.dockerManagers.get(botId)
          : this.dockerManager;
        const isHealthy = await manager.healthCheck(container);

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
        const manager = this.dockerManagers.has(botId)
          ? this.dockerManagers.get(botId)
          : this.dockerManager;
        await manager.stopContainer(container);
      } catch (err) {
        // Collect errors but continue cleanup
        errors.push({ botId, error: err.message });
      }
    }

    // Clear all maps regardless of errors
    this.containers.clear();
    this.botConfigs.clear();
    this.workspaces.clear();
    this.dockerManagers.clear();

    // If there were errors, log them
    if (errors.length > 0) {
      console.warn(
        `Warning: Some containers failed to cleanup: ${errors.map(e => `${e.botId}: ${e.error}`).join(', ')}`
      );
    }
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
   * Get the appropriate DockerManager for a bot, creating a remote one if needed
   *
   * If a dockerHost is provided, creates a new DockerManager instance pointing
   * at the remote Docker daemon. Otherwise returns the default local manager.
   *
   * @param {string} botId - Bot identifier
   * @param {string} [dockerHost] - Docker host URL (e.g., 'tcp://127.0.0.1:54321')
   * @returns {Object} DockerManager instance
   * @private
   */
  _getDockerManager(botId, dockerHost) {
    if (!dockerHost) {
      return this.dockerManager;
    }

    // Parse the Docker host URL into connection options
    const dockerOpts = this._parseDockerHost(dockerHost);
    const manager = new DockerManager(dockerOpts);
    this.dockerManagers.set(botId, manager);
    return manager;
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
