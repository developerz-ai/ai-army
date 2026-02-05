/**
 * BotManager - Bot lifecycle management
 *
 * Manages the complete lifecycle of bots: loading, starting, stopping, and reloading.
 * Each bot is stored in an internal Map with its configuration, soul content,
 * container reference, and status.
 *
 * Dependencies:
 * - storage: PostgresStorage instance for persisting bot state
 * - containerPool: ContainerPool instance for Docker container management
 * - soulLoader: SoulLoader instance for loading bot personality files
 * - configValidator: ConfigValidator instance for validating bot configs
 *
 * @module core/bot-manager
 */

import { ConfigValidator, ConfigValidationError } from '../config/ConfigValidator.js';

/**
 * Valid bot status values
 */
const BOT_STATUSES = {
  LOADING: 'loading',
  LOADED: 'loaded',
  STARTING: 'starting',
  RUNNING: 'running',
  STOPPING: 'stopping',
  STOPPED: 'stopped',
  ERROR: 'error',
};

/**
 * Custom error for bot management failures
 */
export class BotManagerError extends Error {
  /**
   * Create a BotManagerError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - The operation that failed
   * @param {string} [options.botId] - ID of the bot involved
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'BotManagerError';
    this.operation = options.operation;
    this.botId = options.botId;
  }
}

/**
 * BotManager - manages bot lifecycle (load, start, stop, reload)
 */
export class BotManager {
  /**
   * Create a BotManager instance
   * @param {Object} storage - PostgresStorage instance for persistence
   * @param {Object} containerPool - ContainerPool instance for Docker containers
   * @param {Object} soulLoader - SoulLoader instance for loading soul.md files
   * @param {Object} [options={}] - Configuration options
   * @param {Object} [options.configValidator] - ConfigValidator instance (created if not provided)
   */
  constructor(storage, containerPool, soulLoader, options = {}) {
    if (!storage) {
      throw new BotManagerError('Storage is required', {
        operation: 'constructor',
      });
    }
    if (!containerPool) {
      throw new BotManagerError('ContainerPool is required', {
        operation: 'constructor',
      });
    }
    if (!soulLoader) {
      throw new BotManagerError('SoulLoader is required', {
        operation: 'constructor',
      });
    }

    this.storage = storage;
    this.containerPool = containerPool;
    this.soulLoader = soulLoader;
    this.configValidator = options.configValidator || new ConfigValidator();

    /** @type {Map<string, Object>} In-memory store of bot objects */
    this.bots = new Map();
  }

  /**
   * Load a bot from its configuration
   *
   * Validates the config, loads the soul content, and stores the bot
   * in the internal Map. Does NOT start the bot or create containers.
   *
   * @param {string} botId - Bot identifier
   * @param {Object} config - Bot configuration object
   * @returns {Promise<Object>} Bot object
   * @throws {BotManagerError} If validation fails or soul cannot be loaded
   */
  async loadBot(botId, config) {
    if (!botId || typeof botId !== 'string') {
      throw new BotManagerError('Bot ID must be a non-empty string', {
        operation: 'loadBot',
      });
    }

    if (!config || typeof config !== 'object') {
      throw new BotManagerError('Bot config must be a non-null object', {
        operation: 'loadBot',
        botId,
      });
    }

    try {
      // Ensure config has the correct id
      const configWithId = { ...config, id: botId };

      // Validate config using ConfigValidator
      let validatedConfig;
      try {
        validatedConfig = this.configValidator.validateBotConfig(configWithId);
      } catch (err) {
        if (err instanceof ConfigValidationError) {
          throw new BotManagerError(`Bot '${botId}' config validation failed: ${err.message}`, {
            cause: err,
            operation: 'loadBot',
            botId,
          });
        }
        throw err;
      }

      // Load soul content
      let soulContent = '';
      if (validatedConfig.soul) {
        try {
          soulContent = await this.soulLoader.load(validatedConfig.soul, {
            botName: validatedConfig.name || botId,
            botId,
          });
        } catch (err) {
          throw new BotManagerError(`Failed to load soul for bot '${botId}': ${err.message}`, {
            cause: err,
            operation: 'loadBot',
            botId,
          });
        }
      }

      // Create bot object
      const now = new Date();
      const bot = {
        id: botId,
        config: validatedConfig,
        soulContent,
        container: null,
        status: BOT_STATUSES.LOADED,
        createdAt: now,
        lastActiveAt: now,
      };

      // Store in memory
      this.bots.set(botId, bot);

      return bot;
    } catch (err) {
      if (err instanceof BotManagerError) {
        throw err;
      }
      throw new BotManagerError(`Failed to load bot '${botId}': ${err.message}`, {
        cause: err,
        operation: 'loadBot',
        botId,
      });
    }
  }

  /**
   * Start a loaded bot
   *
   * Creates a Docker container via the ContainerPool and sets
   * the bot's status to 'running'. The bot must have been loaded first.
   *
   * @param {string} botId - Bot identifier
   * @returns {Promise<void>}
   * @throws {BotManagerError} If bot is not loaded or container creation fails
   */
  async startBot(botId) {
    if (!botId || typeof botId !== 'string') {
      throw new BotManagerError('Bot ID must be a non-empty string', {
        operation: 'startBot',
      });
    }

    const bot = this.bots.get(botId);
    if (!bot) {
      throw new BotManagerError(`Bot '${botId}' not found. Call loadBot() first.`, {
        operation: 'startBot',
        botId,
      });
    }

    if (bot.status === BOT_STATUSES.RUNNING) {
      return; // Already running, no-op
    }

    try {
      bot.status = BOT_STATUSES.STARTING;

      // Determine workspace root
      const workspace = bot.config.workspace || { root: `./data/${botId}` };

      // Create container via ContainerPool
      const container = await this.containerPool.initializeContainer(botId, bot.config, workspace);

      bot.container = container;
      bot.status = BOT_STATUSES.RUNNING;
      bot.lastActiveAt = new Date();
    } catch (err) {
      bot.status = BOT_STATUSES.ERROR;
      if (err instanceof BotManagerError) {
        throw err;
      }
      throw new BotManagerError(`Failed to start bot '${botId}': ${err.message}`, {
        cause: err,
        operation: 'startBot',
        botId,
      });
    }
  }

  /**
   * Stop a running bot
   *
   * Stops the Docker container gracefully and sets the bot's status
   * to 'stopped'. The bot remains in the Map and can be restarted.
   *
   * @param {string} botId - Bot identifier
   * @returns {Promise<void>}
   * @throws {BotManagerError} If bot is not found or container stop fails
   */
  async stopBot(botId) {
    if (!botId || typeof botId !== 'string') {
      throw new BotManagerError('Bot ID must be a non-empty string', {
        operation: 'stopBot',
      });
    }

    const bot = this.bots.get(botId);
    if (!bot) {
      throw new BotManagerError(`Bot '${botId}' not found.`, { operation: 'stopBot', botId });
    }

    if (bot.status === BOT_STATUSES.STOPPED) {
      return; // Already stopped, no-op
    }

    try {
      bot.status = BOT_STATUSES.STOPPING;

      // Recycle container via ContainerPool
      if (this.containerPool.hasContainer(botId)) {
        await this.containerPool.recycleContainer(botId);
      }

      bot.container = null;
      bot.status = BOT_STATUSES.STOPPED;
      bot.lastActiveAt = new Date();
    } catch (err) {
      bot.status = BOT_STATUSES.ERROR;
      if (err instanceof BotManagerError) {
        throw err;
      }
      throw new BotManagerError(`Failed to stop bot '${botId}': ${err.message}`, {
        cause: err,
        operation: 'stopBot',
        botId,
      });
    }
  }

  /**
   * Reload a bot with new configuration
   *
   * Updates the bot's config and soul content. If sandbox configuration
   * changed, the container is recreated. Otherwise, only config and soul
   * are updated without container disruption.
   *
   * @param {string} botId - Bot identifier
   * @param {Object} newConfig - New bot configuration
   * @returns {Promise<void>}
   * @throws {BotManagerError} If bot is not found or reload fails
   */
  async reloadBot(botId, newConfig) {
    if (!botId || typeof botId !== 'string') {
      throw new BotManagerError('Bot ID must be a non-empty string', {
        operation: 'reloadBot',
      });
    }

    if (!newConfig || typeof newConfig !== 'object') {
      throw new BotManagerError('New config must be a non-null object', {
        operation: 'reloadBot',
        botId,
      });
    }

    const bot = this.bots.get(botId);
    if (!bot) {
      throw new BotManagerError(`Bot '${botId}' not found. Call loadBot() first.`, {
        operation: 'reloadBot',
        botId,
      });
    }

    try {
      // Validate new config
      const configWithId = { ...newConfig, id: botId };
      let validatedConfig;
      try {
        validatedConfig = this.configValidator.validateBotConfig(configWithId);
      } catch (err) {
        if (err instanceof ConfigValidationError) {
          throw new BotManagerError(`Bot '${botId}' new config validation failed: ${err.message}`, {
            cause: err,
            operation: 'reloadBot',
            botId,
          });
        }
        throw err;
      }

      // Reload soul content
      let { soulContent } = bot;
      if (validatedConfig.soul) {
        try {
          soulContent = await this.soulLoader.load(validatedConfig.soul, {
            botName: validatedConfig.name || botId,
            botId,
          });
        } catch (err) {
          throw new BotManagerError(`Failed to reload soul for bot '${botId}': ${err.message}`, {
            cause: err,
            operation: 'reloadBot',
            botId,
          });
        }
      }

      // Check if sandbox config changed (requires container recreation)
      const sandboxChanged = this._hasSandboxChanged(bot.config.sandbox, validatedConfig.sandbox);

      // Update bot state
      const oldConfig = bot.config;
      bot.config = validatedConfig;
      bot.soulContent = soulContent;
      bot.lastActiveAt = new Date();

      // Recreate container if sandbox changed and bot was running
      if (sandboxChanged && oldConfig && bot.status === BOT_STATUSES.RUNNING) {
        const workspace = validatedConfig.workspace || { root: `./data/${botId}` };

        // Stop existing container
        if (this.containerPool.hasContainer(botId)) {
          await this.containerPool.recycleContainer(botId);
        }

        // Create new container with updated config
        const container = await this.containerPool.initializeContainer(
          botId,
          validatedConfig,
          workspace
        );
        bot.container = container;
      }
    } catch (err) {
      if (err instanceof BotManagerError) {
        throw err;
      }
      throw new BotManagerError(`Failed to reload bot '${botId}': ${err.message}`, {
        cause: err,
        operation: 'reloadBot',
        botId,
      });
    }
  }

  /**
   * Get a bot by its ID
   *
   * @param {string} botId - Bot identifier
   * @returns {Object|undefined} Bot object or undefined if not found
   */
  getBot(botId) {
    return this.bots.get(botId);
  }

  /**
   * List all loaded bots
   *
   * @returns {Array<Object>} Array of bot objects
   */
  listBots() {
    return Array.from(this.bots.values());
  }

  /**
   * Remove a bot from the manager
   *
   * Stops the bot if running and removes it from the internal Map.
   *
   * @param {string} botId - Bot identifier
   * @returns {Promise<boolean>} True if bot was removed
   * @throws {BotManagerError} If stop fails
   */
  async removeBot(botId) {
    if (!botId || typeof botId !== 'string') {
      throw new BotManagerError('Bot ID must be a non-empty string', {
        operation: 'removeBot',
      });
    }

    const bot = this.bots.get(botId);
    if (!bot) {
      return false;
    }

    // Stop the bot if it's running
    if (bot.status === BOT_STATUSES.RUNNING || bot.status === BOT_STATUSES.STARTING) {
      await this.stopBot(botId);
    }

    this.bots.delete(botId);
    return true;
  }

  /**
   * Get the count of bots in a specific status
   *
   * @param {string} [status] - Status to filter by. If omitted, returns total count.
   * @returns {number} Number of bots matching the status
   */
  getBotCount(status) {
    if (!status) {
      return this.bots.size;
    }
    return this.listBots().filter(bot => bot.status === status).length;
  }

  /**
   * Stop all running bots gracefully
   *
   * @returns {Promise<Object>} Results with stopped/failed arrays
   */
  async stopAll() {
    const results = { stopped: [], failed: [] };

    for (const [botId, bot] of this.bots.entries()) {
      if (bot.status === BOT_STATUSES.RUNNING || bot.status === BOT_STATUSES.STARTING) {
        try {
          await this.stopBot(botId);
          results.stopped.push(botId);
        } catch (err) {
          results.failed.push({ botId, error: err.message });
        }
      }
    }

    return results;
  }

  /**
   * Check if sandbox configuration has changed between two configs
   *
   * Compares image, memory, cpus, and packages fields.
   *
   * @param {Object} [oldSandbox] - Previous sandbox config
   * @param {Object} [newSandbox] - New sandbox config
   * @returns {boolean} True if sandbox config changed
   * @private
   */
  _hasSandboxChanged(oldSandbox, newSandbox) {
    // If both are undefined/null, no change
    if (!oldSandbox && !newSandbox) {
      return false;
    }

    // If one is undefined/null and the other isn't, changed
    if (!oldSandbox || !newSandbox) {
      return true;
    }

    // Compare key sandbox fields
    if (oldSandbox.image !== newSandbox.image) return true;
    if (oldSandbox.memory !== newSandbox.memory) return true;
    if (oldSandbox.cpus !== newSandbox.cpus) return true;
    if (oldSandbox.type !== newSandbox.type) return true;

    // Compare packages arrays
    const oldPkgs = JSON.stringify(oldSandbox.packages || []);
    const newPkgs = JSON.stringify(newSandbox.packages || []);
    if (oldPkgs !== newPkgs) return true;

    return false;
  }
}

export { BOT_STATUSES };
export default BotManager;
