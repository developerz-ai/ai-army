/**
 * BotReloader - Hot reload individual bot components without full restart
 *
 * Provides granular reload capabilities for bots:
 * - Config-only changes: update config in-memory, no container restart
 * - Soul-only changes: update personality, no container restart
 * - Sandbox changes: graceful container restart (recycle + recreate)
 *
 * Uses the nginx-style pattern: validate first, then apply.
 * Sessions are preserved during all reload operations.
 *
 * @module core/BotReloader
 */

/**
 * Custom error for bot reload failures
 */
export class BotReloaderError extends Error {
  /**
   * Create a BotReloaderError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - The operation that failed
   * @param {string} [options.botId] - ID of the bot involved
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'BotReloaderError';
    this.operation = options.operation;
    this.botId = options.botId;
  }
}

/**
 * Sandbox fields that require a container restart when changed
 * @type {string[]}
 */
const CONTAINER_RESTART_FIELDS = [
  'image',
  'memory',
  'cpus',
  'packages',
  'mounts',
  'network',
  'dockerAccess',
];

/**
 * BotReloader - hot reloads bot config, soul, and containers
 */
export class BotReloader {
  /**
   * Create a BotReloader instance
   *
   * @param {Object} botManager - BotManager instance for bot lifecycle operations
   * @param {Object} containerPool - ContainerPool instance for container management
   * @param {Object} soulLoader - SoulLoader instance for loading soul.md files
   * @param {Object} [options={}] - Configuration options
   * @param {Function} [options.logger] - Logger function (defaults to no-op)
   */
  constructor(botManager, containerPool, soulLoader, options = {}) {
    if (!botManager) {
      throw new BotReloaderError('BotManager is required', {
        operation: 'constructor',
      });
    }
    if (!containerPool) {
      throw new BotReloaderError('ContainerPool is required', {
        operation: 'constructor',
      });
    }
    if (!soulLoader) {
      throw new BotReloaderError('SoulLoader is required', {
        operation: 'constructor',
      });
    }

    if (options.logger !== undefined && typeof options.logger !== 'function') {
      throw new BotReloaderError('Logger must be a function', {
        operation: 'constructor',
      });
    }

    this.botManager = botManager;
    this.containerPool = containerPool;
    this.soulLoader = soulLoader;
    this.logger = typeof options.logger === 'function' ? options.logger : () => {};
  }

  /**
   * Reload a bot's configuration without restarting the container
   *
   * Updates the bot's config in-memory. If sandbox configuration changed,
   * this method will NOT restart the container - use reloadContainer()
   * for that. This is a lightweight update for non-sandbox changes like
   * model, temperature, tools, etc.
   *
   * @param {string} botId - Bot identifier
   * @param {Object} newConfig - New bot configuration object
   * @returns {Promise<void>}
   * @throws {BotReloaderError} If bot is not found or config update fails
   */
  async reloadBotConfig(botId, newConfig) {
    this._validateBotId(botId, 'reloadBotConfig');

    if (!newConfig || typeof newConfig !== 'object') {
      throw new BotReloaderError('New config must be a non-null object', {
        operation: 'reloadBotConfig',
        botId,
      });
    }

    const bot = this.botManager.getBot(botId);
    if (!bot) {
      throw new BotReloaderError(`Bot '${botId}' not found`, {
        operation: 'reloadBotConfig',
        botId,
      });
    }

    try {
      // Update config in-memory on the bot object
      bot.config = { ...newConfig, id: botId };
      bot.lastActiveAt = new Date();

      this._log(`\u2705 Bot '${botId}' config reloaded (no container restart)`);
    } catch (err) {
      throw new BotReloaderError(`Failed to reload config for bot '${botId}': ${err.message}`, {
        cause: err,
        operation: 'reloadBotConfig',
        botId,
      });
    }
  }

  /**
   * Reload a bot's soul/personality content without restarting the container
   *
   * Loads the new soul content (either from provided string or by
   * re-reading the soul file) and updates the bot's soulContent in-memory.
   * The next LLM call will use the updated personality.
   *
   * @param {string} botId - Bot identifier
   * @param {string} newSoulContent - New soul content string
   * @returns {Promise<void>}
   * @throws {BotReloaderError} If bot is not found or soul update fails
   */
  async reloadSoul(botId, newSoulContent) {
    this._validateBotId(botId, 'reloadSoul');

    if (typeof newSoulContent !== 'string') {
      throw new BotReloaderError('Soul content must be a string', {
        operation: 'reloadSoul',
        botId,
      });
    }

    const bot = this.botManager.getBot(botId);
    if (!bot) {
      throw new BotReloaderError(`Bot '${botId}' not found`, {
        operation: 'reloadSoul',
        botId,
      });
    }

    try {
      bot.soulContent = newSoulContent;
      bot.lastActiveAt = new Date();

      this._log(`\u2705 Bot '${botId}' soul reloaded (no container restart)`);
    } catch (err) {
      throw new BotReloaderError(`Failed to reload soul for bot '${botId}': ${err.message}`, {
        cause: err,
        operation: 'reloadSoul',
        botId,
      });
    }
  }

  /**
   * Reload a bot's container with new sandbox configuration
   *
   * Performs a graceful container restart:
   * 1. Recycle the old container via ContainerPool
   * 2. Reinitialize a new container with the updated sandbox config
   *
   * Sessions are preserved because they live in PostgreSQL, not in the container.
   *
   * @param {string} botId - Bot identifier
   * @param {Object} newSandboxConfig - New sandbox configuration
   * @returns {Promise<void>}
   * @throws {BotReloaderError} If bot is not found or container restart fails
   */
  async reloadContainer(botId, newSandboxConfig) {
    this._validateBotId(botId, 'reloadContainer');

    if (!newSandboxConfig || typeof newSandboxConfig !== 'object') {
      throw new BotReloaderError('Sandbox config must be a non-null object', {
        operation: 'reloadContainer',
        botId,
      });
    }

    const bot = this.botManager.getBot(botId);
    if (!bot) {
      throw new BotReloaderError(`Bot '${botId}' not found`, {
        operation: 'reloadContainer',
        botId,
      });
    }

    try {
      this._log(`\u{1F504} Restarting container for bot '${botId}'...`);

      // Step 1: Recycle old container (stop + remove)
      if (this.containerPool.hasContainer(botId)) {
        await this.containerPool.recycleContainer(botId);
      }

      // Step 2: Update the bot's sandbox config
      bot.config = { ...bot.config, sandbox: newSandboxConfig };

      // Step 3: Reinitialize container with new config
      const workspace = bot.config.workspace || { root: `./data/${botId}` };
      const container = await this.containerPool.initializeContainer(botId, bot.config, workspace);

      bot.container = container;
      bot.lastActiveAt = new Date();

      this._log(`\u2705 Bot '${botId}' container restarted`);
    } catch (err) {
      if (err instanceof BotReloaderError) {
        throw err;
      }
      throw new BotReloaderError(`Failed to reload container for bot '${botId}': ${err.message}`, {
        cause: err,
        operation: 'reloadContainer',
        botId,
      });
    }
  }

  /**
   * Detect whether a container restart is needed based on config changes
   *
   * Compares the sandbox-related fields between old and new config.
   * A restart is needed when any of these change:
   * - image: Docker image
   * - memory: Memory limit
   * - cpus: CPU cores
   * - packages: Installed packages
   * - mounts: Volume mounts
   * - network: Network configuration
   *
   * @param {Object} oldConfig - Previous bot configuration
   * @param {Object} newConfig - New bot configuration
   * @returns {boolean} True if container restart is needed
   */
  needsContainerRestart(oldConfig, newConfig) {
    const oldSandbox = oldConfig?.sandbox;
    const newSandbox = newConfig?.sandbox;

    // Both undefined/null => no change
    if (!oldSandbox && !newSandbox) {
      return false;
    }

    // One is undefined/null and the other isn't => changed
    if (!oldSandbox || !newSandbox) {
      return true;
    }

    // Compare each restart-triggering field
    for (const field of CONTAINER_RESTART_FIELDS) {
      const oldVal = oldSandbox[field];
      const newVal = newSandbox[field];

      // Both undefined/null => equal for this field
      if (oldVal == null && newVal == null) {
        continue;
      }

      // One is undefined/null and the other isn't => changed
      if (oldVal == null || newVal == null) {
        return true;
      }

      // Array comparison (packages, mounts)
      if (Array.isArray(oldVal) && Array.isArray(newVal)) {
        if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
          return true;
        }
        continue;
      }

      // Object comparison (network)
      if (typeof oldVal === 'object' && typeof newVal === 'object') {
        if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
          return true;
        }
        continue;
      }

      // Primitive comparison
      if (oldVal !== newVal) {
        return true;
      }
    }

    return false;
  }

  /**
   * Validate a bot ID parameter
   *
   * @param {string} botId - Bot identifier to validate
   * @param {string} operation - Name of the calling operation
   * @throws {BotReloaderError} If botId is invalid
   * @private
   */
  _validateBotId(botId, operation) {
    if (!botId || typeof botId !== 'string') {
      throw new BotReloaderError('Bot ID must be a non-empty string', {
        operation,
      });
    }
  }

  /**
   * Log a message using the configured logger
   *
   * @param {string} message - Message to log
   * @private
   */
  _log(message) {
    this.logger(message);
  }
}

export default BotReloader;
