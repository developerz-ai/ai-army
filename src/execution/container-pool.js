/**
 * ContainerPool - Container pooling and lifecycle management
 *
 * Manages persistent Docker containers for bot execution.
 * Provides container reuse, health monitoring, and automatic recycling.
 *
 * @module execution/container-pool
 */

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
    super(message);
    this.name = 'ContainerPoolError';
    this.operation = options.operation;
    this.botId = options.botId;
    this.cause = options.cause;
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

    /** @type {Object} DockerManager instance */
    this.dockerManager = dockerManager;

    /** @type {Map<string, Object>} Map of botId -> container */
    this.containers = new Map();

    /** @type {Map<string, Object>} Map of botId -> bot configuration */
    this.botConfigs = new Map();

    /** @type {Map<string, Object>} Map of botId -> workspace configuration */
    this.workspaces = new Map();
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

    // Verify container is healthy
    const isHealthy = await this.dockerManager.healthCheck(container);

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

    // Recycle and recreate the container
    await this.recycleContainer(botId);
    return this.initializeContainer(botId, this.botConfigs.get(botId), this.workspaces.get(botId));
  }

  /**
   * Initialize a new container for a bot
   *
   * Creates and starts a container with the specified configuration.
   * If a container already exists for this bot, it will be recycled first.
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
   * @returns {Promise<Object>} Docker container object
   * @throws {ContainerPoolError} When container creation fails
   */
  async initializeContainer(botId, botConfig, workspace) {
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

      // Ensure botConfig has the correct id
      const config = { ...botConfig, id: botId };

      // Create and start the container
      const container = await this.dockerManager.createContainer(config, workspace);
      await this.dockerManager.startContainer(container);

      // Install packages if specified
      if (botConfig.sandbox?.packages?.length > 0) {
        await this.dockerManager.installPackages(container, botConfig.sandbox.packages);
      }

      // Store in pool
      this.containers.set(botId, container);
      this.botConfigs.set(botId, config);
      this.workspaces.set(botId, workspace);

      return container;
    } catch (err) {
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

    try {
      // Stop and remove the container
      await this.dockerManager.stopContainer(container);
    } catch (err) {
      // Log but don't fail if stop/remove fails (container might already be gone)
      if (err instanceof DockerError && err.message?.includes('No such container')) {
        // Container already gone, this is fine
      } else {
        // For other errors, still continue with cleanup but wrap the error
        console.warn(`Warning: Failed to stop container for bot ${botId}: ${err.message}`);
      }
    }

    // Remove from pool
    this.containers.delete(botId);
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
        const isHealthy = await this.dockerManager.healthCheck(container);

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
        await this.dockerManager.stopContainer(container);
      } catch (err) {
        // Collect errors but continue cleanup
        errors.push({ botId, error: err.message });
      }
    }

    // Clear all maps regardless of errors
    this.containers.clear();
    this.botConfigs.clear();
    this.workspaces.clear();

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
}
