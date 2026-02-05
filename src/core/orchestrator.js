/**
 * Orchestrator - Main orchestration engine
 *
 * Coordinates the full startup and shutdown sequence for the AI Assistants Army framework.
 * Responsibilities:
 * - Load and validate configuration
 * - Initialize database connection and run migrations
 * - Create and manage component dependencies (BotManager, SessionManager)
 * - Load and start all configured bots
 * - Initialize channel adapters
 * - Provide graceful shutdown
 * - Support hot reload of configuration
 *
 * @module core/orchestrator
 */

import fs from 'fs/promises';
import path from 'path';
import { ConfigLoader } from '../config/ConfigLoader.js';
import { ConfigValidator } from '../config/ConfigValidator.js';
import { MigrationRunner } from '../database/MigrationRunner.js';

/**
 * Orchestrator lifecycle states
 */
const ORCHESTRATOR_STATES = {
  CREATED: 'created',
  STARTING: 'starting',
  RUNNING: 'running',
  STOPPING: 'stopping',
  STOPPED: 'stopped',
  ERROR: 'error',
};

/**
 * Custom error for orchestrator-related failures
 */
export class OrchestratorError extends Error {
  /**
   * Create an OrchestratorError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - The operation that failed
   * @param {string} [options.component] - The component that failed
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'OrchestratorError';
    this.operation = options.operation;
    this.component = options.component;
  }
}

/**
 * Main orchestration engine for AI Assistants Army
 */
export class Orchestrator {
  /**
   * Create an Orchestrator instance
   *
   * @param {Object} [options={}] - Configuration options
   * @param {string} [options.configPath='./config.json'] - Path to main config file
   * @param {string} [options.botsPath='./bots'] - Path to bots directory
   * @param {string} [options.dataPath='./data'] - Path to bot data/workspace directory
   * @param {string} [options.migrationsPath='./migrations'] - Path to migrations directory
   * @param {Function|null} [options.logger=console.log] - Logger function (null to suppress)
   * @param {Object} [options.storage] - Pre-configured storage instance (for DI/testing)
   * @param {Object} [options.botManager] - Pre-configured BotManager instance (for DI/testing)
   * @param {Object} [options.sessionManager] - Pre-configured SessionManager (for DI/testing)
   * @param {Object} [options.configLoader] - Pre-configured ConfigLoader (for DI/testing)
   * @param {Object} [options.configValidator] - Pre-configured ConfigValidator (for DI/testing)
   * @param {Object} [options.migrationRunner] - Pre-configured MigrationRunner (for DI/testing)
   * @param {Function} [options.storageFactory] - Factory to create storage (for DI/testing)
   * @param {Function} [options.botManagerFactory] - Factory to create BotManager (for DI/testing)
   * @param {Function} [options.sessionManagerFactory] - Factory to create SessionManager (for DI)
   * @param {Function} [options.migrationRunnerFactory] - Factory to create MigrationRunner (for DI)
   */
  constructor(options = {}) {
    this.configPath = options.configPath || './config.json';
    this.botsPath = options.botsPath || './bots';
    this.dataPath = options.dataPath || './data';
    this.migrationsPath = options.migrationsPath || './migrations';
    this.logger = options.logger !== undefined ? options.logger : console.log;

    // Dependency injection support
    this.storage = options.storage || null;
    this.botManager = options.botManager || null;
    this.sessionManager = options.sessionManager || null;
    this.configLoader = options.configLoader || new ConfigLoader();
    this.configValidator = options.configValidator || new ConfigValidator();
    this.migrationRunner = options.migrationRunner || null;

    // Factories for creating components when not injected
    this.storageFactory = options.storageFactory || null;
    this.botManagerFactory = options.botManagerFactory || null;
    this.sessionManagerFactory = options.sessionManagerFactory || null;
    this.migrationRunnerFactory = options.migrationRunnerFactory || null;

    // Adapter registries
    this.channelAdapters = new Map();
    this.secretAdapters = new Map();

    // Initialized channel instances
    this.channels = new Map();

    // Middleware chain
    this.middlewares = [];

    // State
    this.state = ORCHESTRATOR_STATES.CREATED;
    this.config = null;
    this.botConfigs = new Map();
    this.startedAt = null;
  }

  /**
   * Start the orchestrator - full startup sequence
   *
   * Sequence:
   * 1. Load and validate config.json
   * 2. Connect to database
   * 3. Run pending migrations
   * 4. Discover and load bot configurations
   * 5. Start all enabled bots
   * 6. Initialize channel adapters
   * 7. Log startup complete
   *
   * @returns {Promise<void>}
   * @throws {OrchestratorError} If any startup step fails
   */
  async start() {
    if (this.state === ORCHESTRATOR_STATES.RUNNING) {
      return;
    }

    this.state = ORCHESTRATOR_STATES.STARTING;
    this._log('🚀 Starting AI Assistants Army orchestrator...');

    try {
      // Step 1: Load and validate config
      await this._loadConfig();

      // Step 2: Connect to database
      await this._connectDatabase();

      // Step 3: Run migrations
      await this._runMigrations();

      // Step 4: Create component instances (BotManager, SessionManager)
      this._createComponents();

      // Step 5: Discover and load bots
      const { discovered: discoveredCount, loaded: loadedCount } = await this._loadBots();

      // Step 6: Start all loaded bots
      const startResults = await this._startBots();

      // Step 7: Initialize channels
      await this._initializeChannels();

      this.state = ORCHESTRATOR_STATES.RUNNING;
      this.startedAt = new Date();

      const failedCount = startResults.failed.length;
      const successCount = startResults.started.length;

      if (failedCount > 0 || loadedCount < discoveredCount) {
        const loadFailCount = discoveredCount - loadedCount;
        this._log(
          `⚠️ AI Army started with ${successCount}/${discoveredCount} bots ` +
            `(${loadFailCount} failed to load, ${failedCount} failed to start)`
        );
      } else {
        this._log(`🚀 AI Army started with ${successCount} bots`);
      }
    } catch (err) {
      this.state = ORCHESTRATOR_STATES.ERROR;
      if (err instanceof OrchestratorError) {
        throw err;
      }
      throw new OrchestratorError(`Startup failed: ${err.message}`, {
        cause: err,
        operation: 'start',
      });
    }
  }

  /**
   * Stop the orchestrator - graceful shutdown
   *
   * Sequence:
   * 1. Stop all running bots
   * 2. Close channel connections
   * 3. Disconnect from database
   *
   * @returns {Promise<void>}
   * @throws {OrchestratorError} If shutdown fails
   */
  async stop() {
    if (this.state === ORCHESTRATOR_STATES.STOPPED) {
      return;
    }

    const wasError = this.state === ORCHESTRATOR_STATES.ERROR;
    this.state = ORCHESTRATOR_STATES.STOPPING;
    this._log('🛑 Stopping orchestrator...');

    const errors = [];

    // Step 1: Stop all bots
    try {
      await this._stopBots();
    } catch (err) {
      errors.push({ component: 'bots', error: err });
    }

    // Step 2: Close channels
    try {
      await this._closeChannels();
    } catch (err) {
      errors.push({ component: 'channels', error: err });
    }

    // Step 3: Disconnect database
    try {
      await this._disconnectDatabase();
    } catch (err) {
      errors.push({ component: 'database', error: err });
    }

    // Preserve ERROR state so callers can distinguish a failed start
    // from a clean shutdown
    this.state = wasError ? ORCHESTRATOR_STATES.ERROR : ORCHESTRATOR_STATES.STOPPED;
    this._log(
      wasError ? '🛑 Orchestrator stopped (was in error state)' : '✅ Orchestrator stopped'
    );

    if (errors.length > 0) {
      const components = errors.map(e => e.component).join(', ');
      throw new OrchestratorError(`Shutdown completed with errors in: ${components}`, {
        operation: 'stop',
        cause: errors[0].error,
      });
    }
  }

  /**
   * Reload configuration and update bots without full restart
   *
   * Reloads the main config and all bot configs, then reloads
   * changed bots in the BotManager.
   *
   * @returns {Promise<Object>} Reload results with reloaded/failed arrays
   * @throws {OrchestratorError} If config reload fails
   */
  async reload() {
    if (this.state !== ORCHESTRATOR_STATES.RUNNING) {
      throw new OrchestratorError('Cannot reload: orchestrator is not running', {
        operation: 'reload',
      });
    }

    this._log('🔄 Reloading configuration...');

    try {
      // Reload main config
      const newConfig = await this.configLoader.load(this.configPath);
      const validation = this.configValidator.validateMainConfig(newConfig);
      if (!validation.valid) {
        const report = this.configValidator.generateReport(validation.errors);
        throw new OrchestratorError(`Reload config validation failed:\n${report}`, {
          operation: 'reload',
          component: 'config',
        });
      }
      this.config = validation.data;

      // Reload bot configs and update BotManager
      const results = { reloaded: [], failed: [] };

      if (this.botManager) {
        const newBotConfigs = await this._discoverBotConfigs();

        // Track which bots are still present in the new config
        const activeBotIds = new Set();

        for (const [botId, botConfig] of newBotConfigs) {
          activeBotIds.add(botId);
          try {
            const mergedConfig = this.configLoader.deepMerge(this.config.defaults || {}, botConfig);
            await this.botManager.reloadBot(botId, mergedConfig);
            this.botConfigs.set(botId, mergedConfig);
            results.reloaded.push(botId);
          } catch (err) {
            results.failed.push({ botId, error: err.message });
          }
        }

        // Remove bots that are no longer in config
        for (const botId of this.botConfigs.keys()) {
          if (!activeBotIds.has(botId)) {
            this.botConfigs.delete(botId);
          }
        }
      }

      this._log(
        `🔄 Reload complete: ${results.reloaded.length} reloaded, ` +
          `${results.failed.length} failed`
      );

      return results;
    } catch (err) {
      if (err instanceof OrchestratorError) {
        throw err;
      }
      throw new OrchestratorError(`Reload failed: ${err.message}`, {
        cause: err,
        operation: 'reload',
      });
    }
  }

  /**
   * Register a custom channel adapter class
   *
   * @param {string} name - Channel type name (e.g., 'telegram', 'teams')
   * @param {Function} AdapterClass - Channel adapter class
   * @throws {OrchestratorError} If name or adapter is invalid
   */
  registerChannelAdapter(name, AdapterClass) {
    if (!name || typeof name !== 'string') {
      throw new OrchestratorError('Channel adapter name must be a non-empty string', {
        operation: 'registerChannelAdapter',
      });
    }
    if (!AdapterClass || typeof AdapterClass !== 'function') {
      throw new OrchestratorError('Channel adapter must be a constructor function or class', {
        operation: 'registerChannelAdapter',
      });
    }
    this.channelAdapters.set(name, AdapterClass);
    this._log(`📝 Registered channel adapter: ${name}`);
  }

  /**
   * Register a custom secret adapter class
   *
   * @param {string} name - Secret provider name (e.g., 'vault', 'aws-secrets')
   * @param {Function} AdapterClass - Secret adapter class
   * @throws {OrchestratorError} If name or adapter is invalid
   */
  registerSecretAdapter(name, AdapterClass) {
    if (!name || typeof name !== 'string') {
      throw new OrchestratorError('Secret adapter name must be a non-empty string', {
        operation: 'registerSecretAdapter',
      });
    }
    if (!AdapterClass || typeof AdapterClass !== 'function') {
      throw new OrchestratorError('Secret adapter must be a constructor function or class', {
        operation: 'registerSecretAdapter',
      });
    }
    this.secretAdapters.set(name, AdapterClass);
    this._log(`🔐 Registered secret adapter: ${name}`);
  }

  /**
   * Register a middleware function
   *
   * Middlewares are called in order during message processing.
   *
   * @param {Function} middleware - Middleware function
   * @throws {OrchestratorError} If middleware is not a function
   */
  use(middleware) {
    if (typeof middleware !== 'function') {
      throw new OrchestratorError('Middleware must be a function', {
        operation: 'use',
      });
    }
    this.middlewares.push(middleware);
    this._log('🔌 Registered middleware');
  }

  /**
   * Get the current orchestrator state
   *
   * @returns {string} Current state
   */
  getState() {
    return this.state;
  }

  /**
   * Get orchestrator status summary
   *
   * @returns {Object} Status information
   */
  getStatus() {
    return {
      state: this.state,
      startedAt: this.startedAt,
      uptime: this.startedAt ? Date.now() - this.startedAt.getTime() : 0,
      botCount: this.botManager ? this.botManager.getBotCount() : 0,
      channelCount: this.channels.size,
      middlewareCount: this.middlewares.length,
      databaseConnected: this.storage ? this.storage.isConnected() : false,
    };
  }

  // ==========================================================================
  // Private: Startup Steps
  // ==========================================================================

  /**
   * Step 1: Load and validate main configuration
   *
   * @returns {Promise<void>}
   * @throws {OrchestratorError} If config loading or validation fails
   * @private
   */
  async _loadConfig() {
    this._log('📋 Loading configuration...');

    try {
      const rawConfig = await this.configLoader.load(this.configPath);
      const validation = this.configValidator.validateMainConfig(rawConfig);

      if (!validation.valid) {
        const report = this.configValidator.generateReport(validation.errors);
        throw new OrchestratorError(`Configuration validation failed:\n${report}`, {
          operation: 'start',
          component: 'config',
        });
      }

      this.config = validation.data;
      this._log('✅ Configuration loaded and validated');
    } catch (err) {
      if (err instanceof OrchestratorError) {
        throw err;
      }
      throw new OrchestratorError(`Failed to load configuration: ${err.message}`, {
        cause: err,
        operation: 'start',
        component: 'config',
      });
    }
  }

  /**
   * Step 2: Connect to database
   *
   * @returns {Promise<void>}
   * @throws {OrchestratorError} If database connection fails
   * @private
   */
  async _connectDatabase() {
    // Skip if no storage is configured or injected
    if (!this.storage && !this.storageFactory) {
      this._log('⏭️ No database configured, skipping');
      return;
    }

    this._log('🗄️ Connecting to database...');

    try {
      if (!this.storage && this.storageFactory) {
        this.storage = this.storageFactory(this.config);
      }

      await this.storage.connect();
      this._log('✅ Database connected');
    } catch (err) {
      throw new OrchestratorError(`Failed to connect to database: ${err.message}`, {
        cause: err,
        operation: 'start',
        component: 'database',
      });
    }
  }

  /**
   * Step 3: Run pending database migrations
   *
   * @returns {Promise<void>}
   * @throws {OrchestratorError} If migration fails
   * @private
   */
  async _runMigrations() {
    if (!this.storage) {
      return;
    }

    this._log('📦 Running database migrations...');

    try {
      if (!this.migrationRunner) {
        if (this.migrationRunnerFactory) {
          this.migrationRunner = this.migrationRunnerFactory(this.storage);
        } else {
          this.migrationRunner = new MigrationRunner(this.storage, {
            logger: this.logger,
          });
        }
      }

      const completed = await this.migrationRunner.runMigrations(this.migrationsPath);

      if (completed.length > 0) {
        this._log(`✅ Ran ${completed.length} migration(s)`);
      } else {
        this._log('✅ Database schema up to date');
      }
    } catch (err) {
      throw new OrchestratorError(`Migration failed: ${err.message}`, {
        cause: err,
        operation: 'start',
        component: 'migrations',
      });
    }
  }

  /**
   * Create component instances that weren't injected
   *
   * @private
   */
  _createComponents() {
    if (!this.botManager && this.botManagerFactory) {
      this.botManager = this.botManagerFactory(this.storage, this.config);
    }

    if (!this.sessionManager && this.sessionManagerFactory) {
      this.sessionManager = this.sessionManagerFactory(this.storage, this.config);
    }
  }

  /**
   * Step 5: Discover and load all bot configurations
   *
   * Scans the bots directory for bot config files, merges each
   * with global defaults, and loads them into the BotManager.
   *
   * Also handles inline bot definitions from the main config.
   *
   * @returns {Promise<number>} Number of bots loaded
   * @throws {OrchestratorError} If bot discovery or loading fails
   * @private
   */
  async _loadBots() {
    if (!this.botManager) {
      this._log('⏭️ No BotManager configured, skipping bot loading');
      return { discovered: 0, loaded: 0 };
    }

    this._log('🤖 Loading bots...');

    try {
      const botConfigs = await this._discoverBotConfigs();
      const discoveredCount = botConfigs.size;
      let loadedCount = 0;

      for (const [botId, botConfig] of botConfigs) {
        try {
          // Merge with defaults
          const mergedConfig = this.configLoader.deepMerge(this.config.defaults || {}, botConfig);

          await this.botManager.loadBot(botId, mergedConfig);
          this.botConfigs.set(botId, mergedConfig);
          loadedCount++;
          this._log(`  ✅ Loaded bot: ${botId}`);
        } catch (err) {
          this._log(`  ❌ Failed to load bot '${botId}': ${err.message}`);
        }
      }

      this._log(`🤖 ${loadedCount}/${discoveredCount} bot(s) loaded`);
      return { discovered: discoveredCount, loaded: loadedCount };
    } catch (err) {
      if (err instanceof OrchestratorError) {
        throw err;
      }
      throw new OrchestratorError(`Failed to load bots: ${err.message}`, {
        cause: err,
        operation: 'start',
        component: 'bots',
      });
    }
  }

  /**
   * Step 6: Start all loaded bots
   *
   * @returns {Promise<Object>} Results with started/failed arrays
   * @private
   */
  async _startBots() {
    if (!this.botManager) {
      return { started: [], failed: [] };
    }

    this._log('▶️ Starting bots...');

    const results = { started: [], failed: [] };
    const bots = this.botManager.listBots();

    for (const bot of bots) {
      // Skip disabled bots
      if (bot.config.enabled === false) {
        this._log(`  ⏭️ Skipping disabled bot: ${bot.id}`);
        continue;
      }

      try {
        await this.botManager.startBot(bot.id);
        results.started.push(bot.id);
        this._log(`  ▶️ Started bot: ${bot.id}`);
      } catch (err) {
        results.failed.push({ botId: bot.id, error: err.message });
        this._log(`  ❌ Failed to start bot '${bot.id}': ${err.message}`);
      }
    }

    return results;
  }

  /**
   * Step 7: Initialize channel adapters from config
   *
   * @returns {Promise<void>}
   * @private
   */
  async _initializeChannels() {
    const channelsConfig = this.config.channels || {};
    const channelNames = Object.keys(channelsConfig);

    if (channelNames.length === 0) {
      return;
    }

    this._log('📡 Initializing channels...');

    for (const [name, channelConfig] of Object.entries(channelsConfig)) {
      try {
        const AdapterClass = this.channelAdapters.get(channelConfig.type);
        if (!AdapterClass) {
          this._log(`  ⏭️ No adapter registered for channel type: ${channelConfig.type}`);
          continue;
        }

        const adapter = new AdapterClass();
        await adapter.initialize(channelConfig);
        this.channels.set(name, adapter);
        this._log(`  📡 Initialized channel: ${name} (${channelConfig.type})`);
      } catch (err) {
        this._log(`  ❌ Failed to initialize channel '${name}': ${err.message}`);
      }
    }
  }

  // ==========================================================================
  // Private: Shutdown Steps
  // ==========================================================================

  /**
   * Stop all running bots
   *
   * @returns {Promise<void>}
   * @private
   */
  async _stopBots() {
    if (!this.botManager) {
      return;
    }

    this._log('🛑 Stopping all bots...');
    const results = await this.botManager.stopAll();

    if (results.failed.length > 0) {
      const failedIds = results.failed.map(f => f.botId).join(', ');
      this._log(`⚠️ Some bots failed to stop: ${failedIds}`);
    }

    this._log(`✅ ${results.stopped.length} bot(s) stopped`);
  }

  /**
   * Close all channel connections
   *
   * @returns {Promise<void>}
   * @private
   */
  async _closeChannels() {
    for (const [name, adapter] of this.channels) {
      try {
        if (typeof adapter.close === 'function') {
          await adapter.close();
        } else if (typeof adapter.disconnect === 'function') {
          await adapter.disconnect();
        }
      } catch (err) {
        this._log(`⚠️ Failed to close channel '${name}': ${err.message}`);
      }
    }
    this.channels.clear();
  }

  /**
   * Disconnect from database
   *
   * @returns {Promise<void>}
   * @private
   */
  async _disconnectDatabase() {
    if (!this.storage) {
      return;
    }

    try {
      await this.storage.disconnect();
      this._log('✅ Database disconnected');
    } catch (err) {
      throw new OrchestratorError(`Failed to disconnect database: ${err.message}`, {
        cause: err,
        operation: 'stop',
        component: 'database',
      });
    }
  }

  // ==========================================================================
  // Private: Bot Discovery
  // ==========================================================================

  /**
   * Discover bot configurations from both filesystem and inline config
   *
   * Scans the bots directory for directories containing config.json,
   * and also checks for inline bot definitions in the main config.
   *
   * @returns {Promise<Map<string, Object>>} Map of botId → config
   * @private
   */
  async _discoverBotConfigs() {
    const configs = new Map();

    // 1. Discover bots from filesystem (bots/{name}/config.json)
    try {
      const botsDir = path.resolve(this.botsPath);
      const entries = await fs.readdir(botsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const botConfigPath = path.join(botsDir, entry.name, 'config.json');
        try {
          const botConfig = await this.configLoader.load(botConfigPath);
          const botId = botConfig.id || entry.name;
          configs.set(botId, botConfig);
        } catch (_err) {
          // Skip directories without valid config.json
          this._log(`  ⏭️ Skipping ${entry.name}: no valid config.json`);
        }
      }
    } catch (_err) {
      // Bots directory may not exist — not an error
      this._log('⏭️ Bots directory not found, checking inline config');
    }

    // 2. Discover inline bot definitions from main config
    const inlineBots = this.config.bots || {};
    for (const [botId, botConfig] of Object.entries(inlineBots)) {
      if (!configs.has(botId)) {
        // Spread botConfig first, then force id to match the map key
        // This prevents an inline config's own `id` field from disagreeing
        // with the key used to store it
        configs.set(botId, { ...botConfig, id: botId });
      }
    }

    return configs;
  }

  // ==========================================================================
  // Private: Utilities
  // ==========================================================================

  /**
   * Log a message using the configured logger
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

export { ORCHESTRATOR_STATES };
export default Orchestrator;
