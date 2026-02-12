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
 * - Wire channel handlers to MessageProcessor pipeline
 * - Initialize webhook event system and delivery worker
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
import { MCPManager } from '../mcp/mcp-manager.js';
import { SecretsManager } from '../secrets/secrets-manager.js';
import { EnvAdapter } from '../adapters/secrets/env.js';
import { MessageQueue } from '../queue/message-queue.js';
import { QueueWorker } from '../queue/queue-worker.js';
import { ConcurrencyController } from '../queue/concurrency-controller.js';
import { SkillRegistry } from '../skills/skill-registry.js';
import { SkillLoader } from '../skills/skill-loader.js';
import { TemplateManager } from './template-manager.js';
import { BotEventEmitter } from './event-emitter.js';
import { WebhookManager } from '../webhooks/webhook-manager.js';
import { WebhookWorker } from '../webhooks/webhook-worker.js';
import { DeliveryManager } from '../webhooks/delivery-manager.js';
import { ChannelManager } from './channel-manager.js';
import { WorkerRegistry, WORKER_TYPES } from './worker-registry.js';
import { WorkerAssigner } from './worker-assigner.js';
import { SSHTunnelManager } from '../worker/ssh-tunnel.js';
import { HealthMonitor } from '../monitoring/HealthMonitor.js';
import { registerBuiltInChecks } from '../monitoring/health-checks.js';
import { MetricsCollector } from '../monitoring/MetricsCollector.js';
import { Alerter } from '../monitoring/Alerter.js';
import { AuditLogger } from '../audit/audit-logger.js';
import { AuditRetention } from '../audit/audit-retention.js';
import { APIServer } from '../api/api-server.js';
import { AdminRouter } from '../api/AdminRouter.js';
import { HealthRouter } from '../api/routers/health-router.js';
import { BotRouter } from '../api/routers/bot-router.js';
import { SessionRouter } from '../api/routers/session-router.js';
import { QueueRouter } from '../api/routers/queue-router.js';
import { MetricsRouter } from '../api/routers/metrics-router.js';
import { AuditRouter } from '../api/routers/audit-router.js';
import { WorkerRouter } from '../api/routers/worker-router.js';
import { ServerRouter } from '../api/routers/server-router.js';
import { TemplateRouter } from '../api/routers/template-router.js';
import { LegacyRedirectRouter } from '../api/routers/legacy-redirect-router.js';
import { createLogger } from '../utils/logger.js';

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
   * @param {Function|null} [options.logger] - Logger function or structured logger (null to suppress). Defaults to createLogger({ component: 'Orchestrator' })
   * @param {Object} [options.storage] - Pre-configured storage instance (for DI/testing)
   * @param {Object} [options.botManager] - Pre-configured BotManager instance (for DI/testing)
   * @param {Object} [options.sessionManager] - Pre-configured SessionManager (for DI/testing)
   * @param {Object} [options.messageProcessor] - Pre-configured MessageProcessor (for DI/testing)
   * @param {Object} [options.messageRouter] - Pre-configured MessageRouter (for DI/testing)
   * @param {Object} [options.configLoader] - Pre-configured ConfigLoader (for DI/testing)
   * @param {Object} [options.configValidator] - Pre-configured ConfigValidator (for DI/testing)
   * @param {Object} [options.migrationRunner] - Pre-configured MigrationRunner (for DI/testing)
   * @param {import('../secrets/secrets-manager.js').SecretsManager} [options.secretsManager] -
   *   Pre-configured SecretsManager instance (for DI/testing). If not provided and the loaded
   *   config has a `secrets` section, one is created automatically in _createComponents().
   * @param {Function} [options.secretsManagerFactory] - Factory (config) => SecretsManager
   * @param {Function} [options.storageFactory] - Factory to create storage (for DI/testing)
   * @param {Function} [options.botManagerFactory] - Factory to create BotManager (for DI/testing)
   * @param {Function} [options.sessionManagerFactory] - Factory to create SessionManager (for DI)
   * @param {Function} [options.migrationRunnerFactory] - Factory to create MigrationRunner (for DI)
   * @param {Function} [options.messageProcessorFactory] - Factory to create MessageProcessor
   * @param {Function} [options.messageRouterFactory] - Factory to create MessageRouter
   * @param {Object} [options.mcpManager] - Pre-configured MCPManager instance (for DI/testing)
   * @param {Function} [options.mcpManagerFactory] - Factory (config) => MCPManager
   * @param {Object} [options.botReloader] - Pre-configured BotReloader instance (for DI/testing)
   * @param {Function} [options.botReloaderFactory] - Factory (botManager, config) => BotReloader.
   *   The factory must close over containerPool + soulLoader or supply them internally.
   * @param {Object} [options.messageQueue] - Pre-configured MessageQueue instance (for DI/testing)
   * @param {Object} [options.queueWorker] - Pre-configured QueueWorker instance (for DI/testing)
   * @param {Object} [options.concurrencyController] - Pre-configured ConcurrencyController (for DI)
   * @param {Function} [options.messageQueueFactory] - Factory (storage, config) => MessageQueue
   * @param {Function} [options.queueWorkerFactory] - Factory (queue, processor, cc, storage, opts) => QueueWorker
   * @param {Function} [options.concurrencyControllerFactory] - Factory (config) => ConcurrencyController
   * @param {string} [options.skillsPath='./skills'] - Path to skills directory
   * @param {Object} [options.skillRegistry] - Pre-configured SkillRegistry instance (for DI/testing)
   * @param {Object} [options.skillLoader] - Pre-configured SkillLoader instance (for DI/testing)
   * @param {Object} [options.templateManager] - Pre-configured TemplateManager instance (for DI/testing)
   * @param {Function} [options.templateManagerFactory] - Factory (storage) => TemplateManager
   * @param {Object} [options.eventEmitter] - Pre-configured BotEventEmitter instance (for DI/testing)
   * @param {Object} [options.webhookManager] - Pre-configured WebhookManager instance (for DI/testing)
   * @param {Object} [options.webhookWorker] - Pre-configured WebhookWorker instance (for DI/testing)
   * @param {Object} [options.deliveryManager] - Pre-configured DeliveryManager instance (for DI/testing)
   * @param {Function} [options.webhookManagerFactory] - Factory (storage, opts) => WebhookManager
   * @param {Function} [options.webhookWorkerFactory] - Factory (deliveryManager, storage, opts) => WebhookWorker
   * @param {Function} [options.deliveryManagerFactory] - Factory (storage, opts) => DeliveryManager
   * @param {Function} [options.eventEmitterFactory] - Factory (opts) => BotEventEmitter
   * @param {Object} [options.channelManager] - Pre-configured ChannelManager instance (for DI/testing)
   * @param {Function} [options.channelManagerFactory] - Factory (opts) => ChannelManager
   * @param {number} [options.healthCheckInterval=30000] - Interval in ms between channel health checks (0 to disable)
   * @param {Object} [options.healthMonitor] - Pre-configured HealthMonitor instance (for DI/testing)
   * @param {Object} [options.metricsCollector] - Pre-configured MetricsCollector instance (for DI/testing)
   * @param {Object} [options.alerter] - Pre-configured Alerter instance (for DI/testing)
   * @param {Function} [options.healthMonitorFactory] - Factory (opts) => HealthMonitor
   * @param {Function} [options.metricsCollectorFactory] - Factory (opts) => MetricsCollector
   * @param {Function} [options.alerterFactory] - Factory (opts) => Alerter
   * @param {Object} [options.workerRegistry] - Pre-configured WorkerRegistry instance (for DI/testing)
   * @param {Function} [options.workerRegistryFactory] - Factory (storage, opts) => WorkerRegistry
   * @param {Object} [options.workerAssigner] - Pre-configured WorkerAssigner instance (for DI/testing)
   * @param {Function} [options.workerAssignerFactory] - Factory (registry, opts) => WorkerAssigner
   * @param {Object} [options.sshTunnelManager] - Pre-configured SSHTunnelManager instance (for DI/testing)
   * @param {Function} [options.sshTunnelManagerFactory] - Factory (opts) => SSHTunnelManager
   * @param {string} [options.workersConfigPath] - Path to workers.json config file
   * @param {Object} [options.auditLogger] - Pre-configured AuditLogger instance (for DI/testing)
   * @param {Function} [options.auditLoggerFactory] - Factory (storage, opts) => AuditLogger
   * @param {Object} [options.auditRetention] - Pre-configured AuditRetention instance (for DI/testing)
   * @param {Function} [options.auditRetentionFactory] - Factory (auditLogger, opts) => AuditRetention
   * @param {Object} [options.apiServer] - Pre-configured APIServer instance (for DI/testing)
   * @param {Function} [options.apiServerFactory] - Factory (routers, config) => APIServer
   */
  constructor(options = {}) {
    this.configPath = options.configPath || './config.json';
    this.botsPath = options.botsPath || './bots';
    this.dataPath = options.dataPath || './data';
    this.migrationsPath = options.migrationsPath || './migrations';
    this.skillsPath = options.skillsPath || './skills';
    this.logger =
      options.logger !== undefined ? options.logger : createLogger({ component: 'Orchestrator' });

    // Dependency injection support
    this.storage = options.storage || null;
    this.botManager = options.botManager || null;
    this.sessionManager = options.sessionManager || null;
    this.messageProcessor = options.messageProcessor || null;
    this.messageRouter = options.messageRouter || null;
    this.configLoader = options.configLoader || new ConfigLoader();
    this.configValidator = options.configValidator || new ConfigValidator();
    this.migrationRunner = options.migrationRunner || null;
    this.secretsManager = options.secretsManager || null;

    // MCPManager for MCP server lifecycle
    this.mcpManager = options.mcpManager || null;

    // BotReloader for granular hot-reload
    this.botReloader = options.botReloader || null;

    // Queue components for message queuing
    this.messageQueue = options.messageQueue || null;
    this.queueWorker = options.queueWorker || null;
    this.concurrencyController = options.concurrencyController || null;

    // Skills system
    this.skillRegistry = options.skillRegistry || null;
    this.skillLoader = options.skillLoader || null;

    // Template & instance system
    this.templateManager = options.templateManager || null;
    this.templateManagerFactory = options.templateManagerFactory || null;

    // Webhook & event system
    this.eventEmitter = options.eventEmitter || null;
    this.webhookManager = options.webhookManager || null;
    this.webhookWorker = options.webhookWorker || null;
    this.deliveryManager = options.deliveryManager || null;
    this.webhookManagerFactory = options.webhookManagerFactory || null;
    this.webhookWorkerFactory = options.webhookWorkerFactory || null;
    this.deliveryManagerFactory = options.deliveryManagerFactory || null;
    this.eventEmitterFactory = options.eventEmitterFactory || null;

    // Factories for creating components when not injected
    this.storageFactory = options.storageFactory || null;
    this.botManagerFactory = options.botManagerFactory || null;
    this.sessionManagerFactory = options.sessionManagerFactory || null;
    this.migrationRunnerFactory = options.migrationRunnerFactory || null;
    this.messageProcessorFactory = options.messageProcessorFactory || null;
    this.messageRouterFactory = options.messageRouterFactory || null;
    this.mcpManagerFactory = options.mcpManagerFactory || null;
    this.botReloaderFactory = options.botReloaderFactory || null;
    this.secretsManagerFactory = options.secretsManagerFactory || null;
    this.messageQueueFactory = options.messageQueueFactory || null;
    this.queueWorkerFactory = options.queueWorkerFactory || null;
    this.concurrencyControllerFactory = options.concurrencyControllerFactory || null;

    // ChannelManager for unified channel lifecycle
    this.channelManager = options.channelManager || null;
    this.channelManagerFactory = options.channelManagerFactory || null;

    // Health monitoring
    this.healthCheckInterval = options.healthCheckInterval ?? 30000;
    this._healthCheckTimer = null;
    this.healthMonitor = options.healthMonitor || null;
    this.metricsCollector = options.metricsCollector || null;
    this.alerter = options.alerter || null;
    this.healthMonitorFactory = options.healthMonitorFactory || null;
    this.metricsCollectorFactory = options.metricsCollectorFactory || null;
    this.alerterFactory = options.alerterFactory || null;

    // Worker distribution system
    this.workerRegistry = options.workerRegistry || null;
    this.workerAssigner = options.workerAssigner || null;
    this.sshTunnelManager = options.sshTunnelManager || null;
    this.workerRegistryFactory = options.workerRegistryFactory || null;
    this.workerAssignerFactory = options.workerAssignerFactory || null;
    this.sshTunnelManagerFactory = options.sshTunnelManagerFactory || null;
    this.workersConfigPath = options.workersConfigPath || null;

    // Audit logging
    this.auditLogger = options.auditLogger || null;
    this.auditLoggerFactory = options.auditLoggerFactory || null;
    this.auditRetention = options.auditRetention || null;
    this.auditRetentionFactory = options.auditRetentionFactory || null;

    // REST API server
    this.apiServer = options.apiServer || null;
    this.apiServerFactory = options.apiServerFactory || null;

    // Adapter registries
    this.channelAdapters = new Map();
    this.secretAdapters = new Map();

    // Initialized channel instances (kept for backward compatibility)
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
   * 7. Wire channel handlers to MessageProcessor
   * 8. Log startup complete
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

      // Step 4: Create component instances (BotManager, SessionManager, SecretsManager)
      await this._createComponents();

      // Step 4a: Initialize worker distribution system
      await this._initializeWorkers();

      // Step 4b: Start MCP servers
      await this._startMCPServers();

      // Step 4c: Load skills into SkillRegistry
      await this._loadSkills();

      // Step 5: Discover and load bots
      const { discovered: discoveredCount, loaded: loadedCount } = await this._loadBots();

      // Step 6: Start all loaded bots
      const startResults = await this._startBots();

      // Step 7: Initialize channels
      const channelResults = await this._initializeChannels();

      // Fail startup if channels are configured but ALL failed to initialize
      const channelsConfigured = Object.keys(this.config.channels || {}).length;
      if (channelsConfigured > 0 && channelResults.initialized.length === 0) {
        throw new OrchestratorError(
          `All ${channelsConfigured} configured channel(s) failed to initialize`,
          { operation: 'start', component: 'channels' }
        );
      }

      // Step 8: Wire channel handlers to MessageProcessor
      this._setupChannelHandlers();

      // Step 9: Start message queue worker (if queue is enabled)
      await this._startQueueWorker();

      // Step 10: Start webhook worker (if webhooks are configured)
      await this._startWebhookWorker();

      // Step 11: Initialize pluggable health monitoring
      await this._initializeHealthMonitoring();

      // Step 12: Start audit retention scheduler
      if (this.auditRetention) {
        await this.auditRetention.start();
      }

      // Step 13: Start REST API server (if api.enabled in config)
      await this._startAPIServer();

      this.state = ORCHESTRATOR_STATES.RUNNING;
      this.startedAt = new Date();

      const failedCount = startResults.failed.length;
      const successCount = startResults.started.length;
      const channelFailCount = channelResults.failed.length;

      if (failedCount > 0 || loadedCount < discoveredCount || channelFailCount > 0) {
        const loadFailCount = discoveredCount - loadedCount;
        const parts = [];
        if (loadFailCount > 0 || failedCount > 0) {
          parts.push(
            `${successCount}/${discoveredCount} bots ` +
              `(${loadFailCount} failed to load, ${failedCount} failed to start)`
          );
        }
        if (channelFailCount > 0) {
          parts.push(
            `${channelResults.initialized.length}/${channelsConfigured} channels ` +
              `(${channelFailCount} failed)`
          );
        }
        this._log(`⚠️ AI Army started with ${parts.join(', ')}`);
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

    // Step 0: Stop REST API server
    try {
      await this._stopAPIServer();
    } catch (err) {
      errors.push({ component: 'apiServer', error: err });
    }

    // Step 0a: Stop audit retention scheduler
    try {
      if (this.auditRetention) {
        this.auditRetention.stop();
      }
    } catch (err) {
      errors.push({ component: 'auditRetention', error: err });
    }

    // Step 0b: Stop health monitoring
    try {
      this._stopHealthMonitoring();
    } catch (err) {
      errors.push({ component: 'healthMonitor', error: err });
    }

    // Step 1: Stop webhook worker
    try {
      await this._stopWebhookWorker();
    } catch (err) {
      errors.push({ component: 'webhooks', error: err });
    }

    // Step 2: Stop queue worker
    try {
      await this._stopQueueWorker();
    } catch (err) {
      errors.push({ component: 'queue', error: err });
    }

    // Step 3: Stop all bots
    try {
      await this._stopBots();
    } catch (err) {
      errors.push({ component: 'bots', error: err });
    }

    // Step 3b: Stop worker distribution system
    try {
      await this._stopWorkers();
    } catch (err) {
      errors.push({ component: 'workers', error: err });
    }

    // Step 4: Stop MCP servers
    try {
      await this._stopMCPServers();
    } catch (err) {
      errors.push({ component: 'mcp', error: err });
    }

    // Step 5: Close channels
    try {
      await this._closeChannels();
    } catch (err) {
      errors.push({ component: 'channels', error: err });
    }

    // Step 6: Disconnect database
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
            await this._reloadBot(botId, mergedConfig);
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
    const channelCount = this.channelManager
      ? this.channelManager.getChannelCount()
      : this.channels.size;

    return {
      state: this.state,
      startedAt: this.startedAt,
      uptime: this.startedAt ? Date.now() - this.startedAt.getTime() : 0,
      botCount: this.botManager ? this.botManager.getBotCount() : 0,
      channelCount,
      channelStats: this.channelManager ? this.channelManager.getChannelStats() : null,
      mcpServerCount: this.mcpManager ? this.mcpManager.getServerCount() : 0,
      middlewareCount: this.middlewares.length,
      databaseConnected: this.storage ? this.storage.isConnected() : false,
      messageProcessorReady: !!this.messageProcessor,
      messageRouterReady: !!this.messageRouter,
      queueEnabled: this._isQueueEnabled(),
      queueWorkerRunning: this.queueWorker ? this.queueWorker.getState() === 'running' : false,
      skillCount: this.skillRegistry ? this.skillRegistry.getSkillCount() : 0,
      templateManagerReady: !!this.templateManager,
      eventEmitterReady: !!this.eventEmitter,
      webhookManagerReady: !!this.webhookManager,
      webhookWorkerRunning: this.webhookWorker
        ? this.webhookWorker.getState() === 'running'
        : false,
      healthMonitorActive: this._healthCheckTimer !== null,
      healthMonitorRunning: this.healthMonitor ? this.healthMonitor.isRunning() : false,
      workerRegistryReady: !!this.workerRegistry,
      workerAssignerReady: !!this.workerAssigner,
      sshTunnelManagerReady: !!this.sshTunnelManager,
      apiServerRunning: this.apiServer ? this.apiServer.running : false,
      apiServerPort: this.apiServer ? this.apiServer.port : null,
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
   * @returns {Promise<void>}
   */
  async _createComponents() {
    // Create SecretsManager if not injected and secrets config exists
    await this._createSecretsManager();

    if (!this.botManager && this.botManagerFactory) {
      this.botManager = this.botManagerFactory(this.storage, this.config);
    }

    if (!this.sessionManager && this.sessionManagerFactory) {
      this.sessionManager = this.sessionManagerFactory(this.storage, this.config);
    }

    if (!this.messageRouter && this.messageRouterFactory && this.botManager) {
      this.messageRouter = this.messageRouterFactory(this.botManager);
    }

    if (!this.messageProcessor && this.messageProcessorFactory) {
      this.messageProcessor = this.messageProcessorFactory(
        this.sessionManager,
        this.storage,
        this.config
      );
    }

    // Create TemplateManager if not injected and storage is available
    if (!this.templateManager && this.storage) {
      if (this.templateManagerFactory) {
        this.templateManager = this.templateManagerFactory(this.storage);
      } else {
        this.templateManager = new TemplateManager(this.storage);
      }
    }

    // Create BotEventEmitter if not injected
    if (!this.eventEmitter) {
      if (this.eventEmitterFactory) {
        this.eventEmitter = this.eventEmitterFactory({ logger: this.logger });
      } else {
        this.eventEmitter = new BotEventEmitter({ logger: this.logger });
      }
    }

    // Create WebhookManager if not injected and storage is available
    if (!this.webhookManager && this.storage) {
      if (this.webhookManagerFactory) {
        this.webhookManager = this.webhookManagerFactory(this.storage, {
          eventEmitter: this.eventEmitter,
          logger: this.logger,
        });
      } else {
        this.webhookManager = new WebhookManager(this.storage, {
          eventEmitter: this.eventEmitter,
          logger: this.logger,
        });
      }
    }

    // Create AuditLogger if not injected and storage is available
    if (!this.auditLogger && this.storage) {
      if (this.auditLoggerFactory) {
        this.auditLogger = this.auditLoggerFactory(this.storage, {
          logger: this.logger,
        });
      } else {
        const auditConfig = this.config?.audit || {};
        const retentionDays = auditConfig.retention?.days || 90;
        this.auditLogger = new AuditLogger({
          storage: this.storage,
          logger: this.logger,
          retentionDays,
        });
      }
    }

    // Create AuditRetention if not injected and auditLogger is available
    if (!this.auditRetention && this.auditLogger) {
      const auditConfig = this.config?.audit || {};
      const retentionEnabled = auditConfig.retention?.enabled !== false;

      if (retentionEnabled) {
        if (this.auditRetentionFactory) {
          this.auditRetention = this.auditRetentionFactory(this.auditLogger, {
            logger: this.logger,
          });
        } else {
          this.auditRetention = new AuditRetention({
            auditLogger: this.auditLogger,
            retentionDays: auditConfig.retention?.days || 90,
            logger: this.logger,
            runOnStart: false,
          });
        }
      }
    }

    // Create BotReloader if dependencies are available.
    // The factory receives (botManager, config) and must internally supply
    // containerPool + soulLoader (e.g. closed over at factory creation time).
    if (!this.botReloader && this.botReloaderFactory && this.botManager) {
      const reloader = this.botReloaderFactory(this.botManager, this.config);
      if (!reloader || typeof reloader !== 'object') {
        throw new OrchestratorError('botReloaderFactory must return a BotReloader instance', {
          operation: 'start',
          component: 'botReloader',
        });
      }
      this.botReloader = reloader;
    }
  }

  /**
   * Create and configure SecretsManager from config
   *
   * If a SecretsManager is already injected, wires it into the ConfigLoader.
   * Otherwise, if the loaded config has a `secrets` section or a factory is
   * provided, creates a SecretsManager with the configured adapters and
   * attaches it to the ConfigLoader for subsequent config loads (e.g., bot configs).
   *
   * Always registers an EnvAdapter as the 'env' adapter so plain ${VAR}
   * references continue to work.
   *
   * @private
   * @returns {Promise<void>}
   */
  async _createSecretsManager() {
    if (this.secretsManager) {
      // Wire an already-injected SecretsManager into ConfigLoader
      this.configLoader.secretsManager = this.secretsManager;
      this._log('🔐 SecretsManager injected and wired to ConfigLoader');
      return;
    }

    if (this.secretsManagerFactory) {
      this.secretsManager = this.secretsManagerFactory(this.config);
      this.configLoader.secretsManager = this.secretsManager;
      this._log('🔐 SecretsManager created via factory');
      return;
    }

    const secretsConfig = this.config.secrets;

    // If no secrets config and no registered secret adapters, skip creation
    if (!secretsConfig && this.secretAdapters.size === 0) {
      return;
    }

    // Determine cache settings
    const cacheConfig = secretsConfig?.cache;
    const cacheEnabled = cacheConfig?.enabled !== false;
    const cacheTtl = cacheConfig?.ttl;

    const manager = new SecretsManager({
      cacheEnabled,
      cacheTtl,
    });

    // Always register the env adapter
    const envAdapter = new EnvAdapter();
    manager.registerAdapter('env', envAdapter);

    // Collect adapter configs for initialization
    const adapterConfigs = {};

    // Register adapters from the secretAdapters registry (registered via registerSecretAdapter)
    for (const [name, AdapterClass] of this.secretAdapters) {
      try {
        const adapterConfig = secretsConfig?.adapters?.[name] || {};
        const adapter = new AdapterClass();
        manager.registerAdapter(name, adapter);
        adapterConfigs[name] = adapterConfig;
        this._log(`  🔐 Registered secret adapter: ${name}`);
      } catch (err) {
        this._log(`  ⚠️ Failed to register secret adapter '${name}': ${err.message}`);
      }
    }

    // Initialize all adapters (env adapter needs initialization too)
    try {
      await manager.initialize(adapterConfigs);
    } catch (err) {
      // Log but don't fail — some adapters may have initialized successfully
      this._log(`  ⚠️ SecretsManager initialization warning: ${err.message}`);
    }

    this.secretsManager = manager;
    this.configLoader.secretsManager = manager;
    this._log('🔐 SecretsManager created and wired to ConfigLoader');
  }

  /**
   * Step 4c: Load skills from the skills directory into the SkillRegistry
   *
   * Creates a SkillRegistry and SkillLoader if not injected, then scans
   * the skills directory for SKILL.md files and registers each found skill.
   * Skill loading failures are logged but do not prevent startup.
   *
   * @returns {Promise<void>}
   * @private
   */
  async _loadSkills() {
    // Create SkillRegistry if not injected
    if (!this.skillRegistry) {
      this.skillRegistry = new SkillRegistry({ logger: this.logger });
    }

    // Create SkillLoader if not injected
    if (!this.skillLoader) {
      this.skillLoader = new SkillLoader();
    }

    const skillsDir = path.resolve(this.skillsPath);

    // Check if skills directory exists
    try {
      await fs.access(skillsDir);
    } catch {
      this._log('⏭️ No skills directory found, skipping skill loading');
      return;
    }

    this._log('🎯 Loading skills...');

    try {
      const skills = await this.skillLoader.loadFromDirectory(skillsDir);

      for (const skill of skills) {
        try {
          this.skillRegistry.registerSkill(skill);
        } catch (err) {
          this._log(`  ⚠️ Failed to register skill '${skill.name}': ${err.message}`);
        }
      }

      const count = this.skillRegistry.getSkillCount();
      this._log(`🎯 ${count} skill(s) loaded`);
    } catch (err) {
      // Skill loading failure is non-fatal
      this._log(`⚠️ Failed to load skills: ${err.message}`);
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
      let discoveredCount = botConfigs.size;
      let loadedCount = 0;

      for (const [botId, botConfig] of botConfigs) {
        try {
          // Merge with defaults
          const mergedConfig = this.configLoader.deepMerge(this.config.defaults || {}, botConfig);

          await this.botManager.loadBot(botId, mergedConfig);
          this.botConfigs.set(botId, mergedConfig);
          this._configureWebhooksForBot(botId, mergedConfig);
          loadedCount++;
          this._log(`  ✅ Loaded bot: ${botId}`);
        } catch (err) {
          this._log(`  ❌ Failed to load bot '${botId}': ${err.message}`);
        }
      }

      // Load template instances from database
      const instanceResults = await this._loadInstances();
      discoveredCount += instanceResults.discovered;
      loadedCount += instanceResults.loaded;

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
   * Load template instances from the database and register them as bots
   *
   * For each instance with status != 'stopped', resolves the full config
   * (template config + instance overrides + variable substitution) and loads
   * it into the BotManager. Instance loading failures are logged but do not
   * prevent startup.
   *
   * @returns {Promise<{discovered: number, loaded: number}>} Count of discovered and loaded instances
   * @private
   */
  async _loadInstances() {
    if (!this.templateManager || !this.botManager) {
      return { discovered: 0, loaded: 0 };
    }

    let instances;
    try {
      instances = await this.templateManager.listInstances();
    } catch (err) {
      this._log(`⚠️ Failed to load instances from database: ${err.message}`);
      return { discovered: 0, loaded: 0 };
    }

    if (instances.length === 0) {
      return { discovered: 0, loaded: 0 };
    }

    this._log(`📦 Loading ${instances.length} template instance(s)...`);
    let loadedCount = 0;

    for (const instance of instances) {
      try {
        const resolved = await this.templateManager.resolveInstance(instance.id);
        const botConfig = {
          ...resolved.resolvedConfig,
          id: instance.id,
          soul: resolved.resolvedSoul,
        };

        // Merge with defaults
        const mergedConfig = this.configLoader.deepMerge(this.config.defaults || {}, botConfig);

        await this.botManager.loadBot(instance.id, mergedConfig);
        this.botConfigs.set(instance.id, mergedConfig);
        this._configureWebhooksForBot(instance.id, mergedConfig);
        loadedCount++;
        this._log(`  ✅ Loaded instance: ${instance.id}`);
      } catch (err) {
        this._log(`  ❌ Failed to load instance '${instance.id}': ${err.message}`);
      }
    }

    this._log(`📦 ${loadedCount}/${instances.length} instance(s) loaded`);
    return { discovered: instances.length, loaded: loadedCount };
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
   * Creates a ChannelManager (if not injected), registers all adapter types,
   * and initializes each configured channel. Falls back to direct channel
   * management for backward compatibility.
   *
   * @returns {Promise<{initialized: string[], failed: string[]}>} Results with initialized/failed channel names
   * @private
   */
  async _initializeChannels() {
    const channelsConfig = this.config.channels || {};
    const channelNames = Object.keys(channelsConfig);
    const results = { initialized: [], failed: [] };

    if (channelNames.length === 0) {
      return results;
    }

    this._log('📡 Initializing channels...');

    // Create ChannelManager if not injected
    if (!this.channelManager) {
      if (this.channelManagerFactory) {
        this.channelManager = this.channelManagerFactory({ logger: this.logger });
      } else {
        this.channelManager = new ChannelManager({ logger: this.logger });
      }
    }

    // Register all adapter types with ChannelManager
    for (const [type, AdapterClass] of this.channelAdapters) {
      if (!this.channelManager.adapterTypes.has(type)) {
        this.channelManager.registerAdapter(type, AdapterClass);
      }
    }

    for (const [name, channelConfig] of Object.entries(channelsConfig)) {
      try {
        if (!this.channelManager.adapterTypes.has(channelConfig.type)) {
          this._log(`  ⏭️ No adapter registered for channel type: ${channelConfig.type}`);
          results.failed.push(name);
          continue;
        }

        await this.channelManager.initializeChannel(name, channelConfig);
        // Mirror into this.channels for backward compatibility
        const channel = this.channelManager.getChannel(name);
        if (channel && channel.adapter) {
          this.channels.set(name, channel.adapter);
        }
        results.initialized.push(name);
        this._log(`  📡 Initialized channel: ${name} (${channelConfig.type})`);
      } catch (err) {
        results.failed.push(name);
        this._log(`  ❌ Failed to initialize channel '${name}': ${err.message}`);
      }
    }

    // Start health monitoring after channels are initialized
    this._startHealthMonitor();

    return results;
  }

  // ==========================================================================
  // Private: Channel Handler Wiring
  // ==========================================================================

  /**
   * Step 8: Wire channel handlers to MessageProcessor
   *
   * Registers an onMessage handler on each initialized channel adapter.
   * When a message arrives:
   * 1. MessageRouter finds the bot bound to the channel and checks restrictions
   * 2. MessageProcessor processes the message through the AI pipeline
   * 3. Response is sent back via the channel adapter's sendMessage
   *
   * Requires both messageRouter and messageProcessor to be available.
   * If either is missing, channel handlers are skipped (channels will
   * be initialized but not connected to the processing pipeline).
   *
   * @private
   */
  _setupChannelHandlers() {
    if (!this.messageRouter || !this.messageProcessor) {
      if (this.channels.size > 0) {
        this._log(
          '⏭️ MessageRouter or MessageProcessor not available, ' + 'skipping channel handler wiring'
        );
      }
      return;
    }

    let wiredCount = 0;

    // Use ChannelManager if available, fall back to direct channels map
    const channelEntries = this.channelManager
      ? this.channelManager.listChannels().map(ch => [ch.name, ch.adapter])
      : Array.from(this.channels.entries());

    for (const [channelName, adapter] of channelEntries) {
      if (!adapter || typeof adapter.onMessage !== 'function') {
        this._log(`  ⏭️ Channel '${channelName}' does not support onMessage`);
        continue;
      }

      adapter.onMessage(async message => {
        await this._handleChannelMessage(channelName, adapter, message);
      });

      wiredCount++;
    }

    if (wiredCount > 0) {
      this._log(`🔗 Wired ${wiredCount} channel(s) to MessageProcessor`);
    }
  }

  /**
   * Handle an incoming message from a channel adapter
   *
   * Routes the message to the correct bot via MessageRouter, processes it
   * through the MessageProcessor pipeline, and sends the response back
   * to the channel.
   *
   * @param {string} channelName - Name of the channel (e.g., 'slack-main')
   * @param {Object} adapter - Channel adapter instance for sending responses
   * @param {Object} message - Incoming message from the adapter
   * @param {string} message.type - Channel type ('slack' | 'discord' | 'rest')
   * @param {string} message.userId - User identifier
   * @param {string} message.channelId - Channel/conversation identifier
   * @param {string} message.text - Message text content
   * @param {boolean} [message.isDM=false] - Whether this is a direct message
   * @param {string} [message.threadTs] - Thread timestamp (Slack-specific)
   * @returns {Promise<void>}
   * @private
   */
  async _handleChannelMessage(channelName, adapter, message) {
    try {
      // Step 1: Route message to a bot via MessageRouter
      const routeResult = await this.messageRouter.route({
        ...message,
        channelName,
      });

      if (!routeResult.allowed || !routeResult.bot) {
        this._log(
          `🚫 Message blocked for channel '${channelName}': ` +
            `${routeResult.reason || 'no matching bot'}`
        );
        return;
      }

      const { bot } = routeResult;

      // Step 2: Enqueue or process directly
      if (this._isQueueEnabled() && this.messageQueue) {
        // Queue-based processing: enqueue and let QueueWorker handle it.
        // Include channelName and threadTs so the worker can route responses
        // back to the originating adapter after processing.
        try {
          const priority = this.config.queue?.defaultPriority ?? 0;
          await this.messageQueue.enqueue(
            bot.id,
            {
              channelType: message.type,
              channelId: message.channelId,
              userId: message.userId,
              text: message.text,
              channelName,
              threadTs: message.threadTs || null,
            },
            priority
          );
          this._log(`📥 Enqueued message for bot '${bot.id}' on channel '${channelName}'`);
          return;
        } catch (enqueueErr) {
          // Enqueue failed (DB error / migration mismatch) — fall back to direct processing
          // so the user still gets a response instead of silently dropping the message.
          this._log(
            `⚠️ Enqueue failed for bot '${bot.id}' on channel '${channelName}', ` +
              `falling back to direct processing: ${enqueueErr.message}`
          );
        }
      }

      // Direct processing (queue disabled or enqueue failed)
      const result = await this.messageProcessor.processMessage(bot.config, message);

      // Step 3: Send response back via channel adapter
      if (result.text && typeof adapter.sendMessage === 'function') {
        await adapter.sendMessage(message.channelId, result.text, message.threadTs);
      }
    } catch (err) {
      this._log(`❌ Error handling message on channel '${channelName}': ${err.message}`);
    }
  }

  // ==========================================================================
  // Private: Queue Lifecycle
  // ==========================================================================

  /**
   * Check whether message queuing is enabled in the config
   *
   * @returns {boolean} True if queue.enabled is true in config
   * @private
   */
  _isQueueEnabled() {
    return this.config?.queue?.enabled === true;
  }

  /**
   * Start the message queue worker if queue is enabled
   *
   * Creates MessageQueue, ConcurrencyController, and QueueWorker instances
   * (unless injected), then starts the worker.
   *
   * @returns {Promise<void>}
   * @private
   */
  async _startQueueWorker() {
    if (!this._isQueueEnabled()) {
      return;
    }

    if (!this.storage) {
      this._log('⏭️ Queue enabled but no storage configured, skipping queue worker');
      return;
    }

    if (!this.messageProcessor) {
      this._log('⏭️ Queue enabled but no MessageProcessor available, skipping queue worker');
      return;
    }

    this._log('📬 Starting message queue worker...');

    const queueConfig = this.config.queue;

    try {
      // Create MessageQueue if not injected
      if (!this.messageQueue) {
        if (this.messageQueueFactory) {
          this.messageQueue = this.messageQueueFactory(this.storage, this.config);
        } else {
          this.messageQueue = new MessageQueue(this.storage, {
            logger: this.logger,
          });
        }
      }

      // Create ConcurrencyController if not injected
      if (!this.concurrencyController) {
        if (this.concurrencyControllerFactory) {
          this.concurrencyController = this.concurrencyControllerFactory(this.config);
        } else {
          this.concurrencyController = new ConcurrencyController({
            defaultMaxConcurrent: queueConfig.maxConcurrentPerBot ?? 3,
            logger: this.logger,
          });
        }
      }

      // Create QueueWorker if not injected
      if (!this.queueWorker) {
        const getBotConfig = botId => {
          const botConfig = this.botConfigs.get(botId);
          return botConfig || null;
        };

        // Provide channel adapter lookup so the worker can route responses
        // back to the originating channel after processing queued messages.
        const getChannelAdapter = channelName => {
          if (this.channelManager) {
            return this.channelManager.getAdapter(channelName) || null;
          }
          return this.channels.get(channelName) || null;
        };

        if (this.queueWorkerFactory) {
          this.queueWorker = this.queueWorkerFactory(
            this.messageQueue,
            this.messageProcessor,
            this.concurrencyController,
            this.storage,
            {
              pollInterval: queueConfig.pollInterval ?? 5000,
              retryAttempts: queueConfig.retryAttempts ?? 3,
              retryDelay: queueConfig.retryDelay ?? 5000,
              logger: this.logger,
              getBotConfig,
              getChannelAdapter,
            }
          );
        } else {
          this.queueWorker = new QueueWorker(
            this.messageQueue,
            this.messageProcessor,
            this.concurrencyController,
            this.storage,
            {
              pollInterval: queueConfig.pollInterval ?? 5000,
              retryAttempts: queueConfig.retryAttempts ?? 3,
              retryDelay: queueConfig.retryDelay ?? 5000,
              logger: this.logger,
              getBotConfig,
              getChannelAdapter,
            }
          );
        }
      }

      await this.queueWorker.start();
      this._log('📬 Message queue worker started');
    } catch (err) {
      this._log(`⚠️ Failed to start queue worker: ${err.message}`);
      // Queue failure is non-fatal — fall back to direct processing
    }
  }

  /**
   * Stop the message queue worker
   *
   * @returns {Promise<void>}
   * @private
   */
  async _stopQueueWorker() {
    if (!this.queueWorker) {
      return;
    }

    this._log('📬 Stopping queue worker...');
    await this.queueWorker.stop();

    if (this.concurrencyController) {
      this.concurrencyController.reset();
    }

    this._log('✅ Queue worker stopped');
  }

  // ==========================================================================
  // Private: Webhook Lifecycle
  // ==========================================================================

  /**
   * Start the webhook delivery worker if webhooks are configured
   *
   * Creates a DeliveryManager and WebhookWorker (unless injected), then
   * starts the worker to process pending webhook deliveries.
   *
   * Webhook worker startup failure is non-fatal — webhooks will be queued
   * but not delivered until the worker is restarted.
   *
   * @returns {Promise<void>}
   * @private
   */
  async _startWebhookWorker() {
    if (!this.webhookManager) {
      return;
    }

    if (!this.storage) {
      this._log('⏭️ Webhooks configured but no storage available, skipping webhook worker');
      return;
    }

    this._log('🔔 Starting webhook worker...');

    try {
      // Create DeliveryManager if not injected
      if (!this.deliveryManager) {
        if (this.deliveryManagerFactory) {
          this.deliveryManager = this.deliveryManagerFactory(this.storage, {
            logger: this.logger,
          });
        } else {
          this.deliveryManager = new DeliveryManager(this.storage, {
            logger: this.logger,
          });
        }
      }

      // Create WebhookWorker if not injected
      if (!this.webhookWorker) {
        if (this.webhookWorkerFactory) {
          this.webhookWorker = this.webhookWorkerFactory(this.deliveryManager, this.storage, {
            logger: this.logger,
          });
        } else {
          this.webhookWorker = new WebhookWorker(this.deliveryManager, this.storage, {
            logger: this.logger,
          });
        }
      }

      await this.webhookWorker.start();
      this._log('🔔 Webhook worker started');
    } catch (err) {
      this._log(`⚠️ Failed to start webhook worker: ${err.message}`);
      // Webhook worker failure is non-fatal — deliveries will accumulate
      // in the database and be processed when the worker is restarted.
    }
  }

  /**
   * Stop the webhook delivery worker
   *
   * @returns {Promise<void>}
   * @private
   */
  async _stopWebhookWorker() {
    if (!this.webhookWorker) {
      return;
    }

    this._log('🔔 Stopping webhook worker...');
    await this.webhookWorker.stop();
    this._log('✅ Webhook worker stopped');
  }

  /**
   * Configure webhook subscriptions for a bot from its config
   *
   * If the bot's merged config contains a `webhooks` array and a WebhookManager
   * is available, registers the webhook subscriptions with the manager.
   *
   * @param {string} botId - Bot identifier
   * @param {Object} botConfig - Merged bot configuration
   * @private
   */
  _configureWebhooksForBot(botId, botConfig) {
    if (!this.webhookManager) {
      return;
    }

    const { webhooks } = botConfig;
    if (!Array.isArray(webhooks) || webhooks.length === 0) {
      return;
    }

    try {
      this.webhookManager.configure(botId, webhooks);
    } catch (err) {
      this._log(`⚠️ Failed to configure webhooks for bot '${botId}': ${err.message}`);
    }
  }

  // ==========================================================================
  // Private: Worker Distribution Lifecycle
  // ==========================================================================

  /**
   * Initialize the worker distribution system
   *
   * Loads worker configuration from the main config's `workers` section
   * or from a separate `workers.json` file. Creates WorkerRegistry,
   * SSHTunnelManager, and WorkerAssigner instances (unless injected),
   * then registers all configured workers and sets up SSH tunnels for
   * remote workers.
   *
   * Always registers a local worker if no workers are configured,
   * ensuring at least one worker is available for bot placement.
   *
   * Worker initialization failure is non-fatal — the system falls back
   * to local-only Docker management.
   *
   * @returns {Promise<void>}
   * @private
   */
  async _initializeWorkers() {
    if (!this.storage) {
      this._log('⏭️ No storage configured, skipping worker initialization');
      return;
    }

    this._log('👷 Initializing worker distribution system...');

    try {
      // Load worker configs from main config or workers.json
      const workersConfig = await this._loadWorkersConfig();

      // Create WorkerRegistry if not injected
      if (!this.workerRegistry) {
        if (this.workerRegistryFactory) {
          this.workerRegistry = this.workerRegistryFactory(this.storage, {});
        } else {
          this.workerRegistry = new WorkerRegistry(this.storage);
        }
      }

      // Normalize logger into a structured { info, warn, error, debug } object
      // for worker components. Handles both function loggers (e.g. console.log)
      // and structured loggers (e.g. console or winston-like objects).
      const workerLogger = this._createWorkerLogger();

      // Create SSHTunnelManager if not injected
      if (!this.sshTunnelManager) {
        if (this.sshTunnelManagerFactory) {
          this.sshTunnelManager = this.sshTunnelManagerFactory({
            logger: workerLogger,
          });
        } else {
          this.sshTunnelManager = new SSHTunnelManager({
            logger: workerLogger,
          });
        }
      }

      // Create WorkerAssigner if not injected
      if (!this.workerAssigner) {
        const assignmentRules = workersConfig.assignmentRules || [];
        if (this.workerAssignerFactory) {
          this.workerAssigner = this.workerAssignerFactory(this.workerRegistry, {
            sshTunnelManager: this.sshTunnelManager,
            assignmentRules,
            logger: workerLogger,
          });
        } else {
          this.workerAssigner = new WorkerAssigner(this.workerRegistry, {
            sshTunnelManager: this.sshTunnelManager,
            assignmentRules,
            logger: workerLogger,
          });
        }
      }

      // Register configured workers
      const workerDefs = workersConfig.workers || [];
      let registeredCount = 0;
      let hasLocal = false;

      for (const workerDef of workerDefs) {
        try {
          // Check if worker already exists (e.g., from a previous startup)
          const existing = await this.workerRegistry.getWorker(workerDef.id);
          if (existing) {
            await this.workerRegistry.updateHeartbeat(workerDef.id);
            this._log(`  ✅ Worker already registered: ${workerDef.id}`);
          } else {
            await this.workerRegistry.registerWorker({
              id: workerDef.id,
              host: workerDef.host || 'localhost',
              type: workerDef.type || WORKER_TYPES.LOCAL,
              maxContainers: workerDef.maxContainers || 10,
            });
            this._log(`  ✅ Registered worker: ${workerDef.id}`);
          }

          if (workerDef.type === WORKER_TYPES.LOCAL || !workerDef.type) {
            hasLocal = true;
          }

          // Set up SSH tunnel for remote workers
          if (workerDef.type === WORKER_TYPES.REMOTE && workerDef.host) {
            try {
              await this.sshTunnelManager.createTunnel({
                workerId: workerDef.id,
                host: workerDef.host,
                port: workerDef.port || 22,
                username: workerDef.user || workerDef.username || 'deploy',
                privateKeyPath: workerDef.keyPath || workerDef.privateKeyPath,
                privateKey: workerDef.privateKey,
              });
              this._log(`  🔗 SSH tunnel established for worker: ${workerDef.id}`);
            } catch (tunnelErr) {
              this._log(
                `  ⚠️ Failed to create SSH tunnel for worker '${workerDef.id}': ${tunnelErr.message}`
              );
            }
          }

          registeredCount++;
        } catch (err) {
          this._log(`  ❌ Failed to register worker '${workerDef.id}': ${err.message}`);
        }
      }

      // Register a default local worker if none configured
      if (!hasLocal && workerDefs.length === 0) {
        try {
          const existing = await this.workerRegistry.getWorker('local');
          if (existing) {
            await this.workerRegistry.updateHeartbeat('local');
          } else {
            await this.workerRegistry.registerWorker({
              id: 'local',
              host: 'localhost',
              type: WORKER_TYPES.LOCAL,
              maxContainers: 10,
            });
          }
          registeredCount++;
          this._log('  ✅ Registered default local worker');
        } catch (err) {
          this._log(`  ⚠️ Failed to register default local worker: ${err.message}`);
        }
      }

      this._log(`👷 Worker system initialized with ${registeredCount} worker(s)`);
    } catch (err) {
      // Worker initialization failure is non-fatal
      this._log(`⚠️ Worker initialization failed: ${err.message}`);
      this._log('⚠️ Falling back to local-only Docker management');
    }
  }

  /**
   * Load worker configuration from main config or workers.json file
   *
   * Checks for workers configuration in the following order:
   * 1. Main config `workers` section
   * 2. Separate `workers.json` file (via `workersConfigPath` option)
   * 3. Empty default (no workers configured)
   *
   * @returns {Promise<Object>} Workers configuration with `workers` array and optional `assignmentRules`
   * @private
   */
  async _loadWorkersConfig() {
    // Check main config for workers section
    if (this.config.workers) {
      const workersSection = this.config.workers;
      return {
        workers: Array.isArray(workersSection) ? workersSection : workersSection.nodes || [],
        assignmentRules: workersSection.assignmentRules || [],
      };
    }

    // Try loading workers.json file
    const workersPath = this.workersConfigPath;
    if (workersPath) {
      try {
        const workersFileConfig = await this.configLoader.load(workersPath);
        return {
          workers: workersFileConfig.workers || [],
          assignmentRules: workersFileConfig.assignmentRules || [],
        };
      } catch (err) {
        this._log(`⚠️ Failed to load workers config from '${workersPath}': ${err.message}`);
      }
    }

    // Try default workers.json location (only if the file exists)
    try {
      const defaultPath = path.resolve(path.dirname(this.configPath), 'workers.json');
      await fs.access(defaultPath);
      const workersFileConfig = await this.configLoader.load(defaultPath);
      return {
        workers: workersFileConfig.workers || [],
        assignmentRules: workersFileConfig.assignmentRules || [],
      };
    } catch {
      // No workers.json file found — that's fine
    }

    return { workers: [], assignmentRules: [] };
  }

  /**
   * Stop the worker distribution system
   *
   * Closes all SSH tunnels and cleans up worker resources.
   * Worker registry data persists in the database for the next startup.
   *
   * @returns {Promise<void>}
   * @private
   */
  async _stopWorkers() {
    if (this.sshTunnelManager) {
      this._log('🔗 Closing SSH tunnels...');
      try {
        const closed = await this.sshTunnelManager.closeAll();
        if (closed.length > 0) {
          this._log(`✅ Closed ${closed.length} SSH tunnel(s)`);
        }
      } catch (err) {
        this._log(`⚠️ Error closing SSH tunnels: ${err.message}`);
      }
    }

    this._log('👷 Worker distribution system stopped');
  }

  // ==========================================================================
  // Private: MCP Lifecycle
  // ==========================================================================

  /**
   * Start MCP servers defined in config.mcpServers
   *
   * Creates or reuses an MCPManager and starts each configured MCP server.
   * Failures on individual servers are logged but do not prevent startup.
   *
   * @returns {Promise<void>}
   * @private
   */
  async _startMCPServers() {
    const mcpServersConfig = this.config.mcpServers || {};
    const serverIds = Object.keys(mcpServersConfig);

    if (serverIds.length === 0 && !this.mcpManager) {
      return;
    }

    // Create MCPManager if not injected
    if (!this.mcpManager) {
      if (this.mcpManagerFactory) {
        this.mcpManager = this.mcpManagerFactory(this.config);
      } else {
        this.mcpManager = new MCPManager({ logger: this.logger });
      }
    }

    if (serverIds.length === 0) {
      return;
    }

    this._log('🔌 Starting MCP servers...');

    let startedCount = 0;
    for (const [serverId, serverConfig] of Object.entries(mcpServersConfig)) {
      try {
        await this.mcpManager.startServer({
          id: serverId,
          ...serverConfig,
        });
        startedCount++;
        this._log(`  🔌 Started MCP server: ${serverId}`);
      } catch (err) {
        this._log(`  ❌ Failed to start MCP server '${serverId}': ${err.message}`);
      }
    }

    this._log(`🔌 ${startedCount}/${serverIds.length} MCP server(s) started`);
  }

  /**
   * Stop all running MCP servers
   *
   * @returns {Promise<void>}
   * @private
   */
  async _stopMCPServers() {
    if (!this.mcpManager) {
      return;
    }

    this._log('🔌 Stopping MCP servers...');
    const results = await this.mcpManager.stopAll();

    if (results.failed.length > 0) {
      const failedIds = results.failed.map(f => f.id).join(', ');
      this._log(`⚠️ Some MCP servers failed to stop: ${failedIds}`);
    }

    this._log(`✅ ${results.stopped.length} MCP server(s) stopped`);
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
   * Stops the health monitor and uses ChannelManager.stopAll() when
   * available, falling back to direct adapter cleanup for backward
   * compatibility.
   *
   * @returns {Promise<void>}
   * @private
   */
  async _closeChannels() {
    // Stop health monitoring
    this._stopHealthMonitor();

    // Use ChannelManager for graceful shutdown if available
    if (this.channelManager) {
      const results = await this.channelManager.stopAll();
      if (results.failed.length > 0) {
        const failedNames = results.failed.map(f => f.name).join(', ');
        this._log(`⚠️ Some channels failed to stop: ${failedNames}`);
      }
      this.channels.clear();
      return;
    }

    // Fallback: direct adapter cleanup
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

  // ==========================================================================
  // Private: Pluggable Health Monitoring (HealthMonitor, MetricsCollector, Alerter)
  // ==========================================================================

  /**
   * Initialize the pluggable health monitoring system
   *
   * Creates HealthMonitor, MetricsCollector, and Alerter instances
   * (unless injected), registers built-in health checks, and starts
   * periodic monitoring. Health monitoring initialization failure
   * is non-fatal — the system continues without monitoring.
   *
   * @returns {Promise<void>}
   * @private
   */
  async _initializeHealthMonitoring() {
    const monitoringConfig = this.config.monitoring || {};

    // Skip if monitoring is explicitly disabled
    if (monitoringConfig.enabled === false) {
      this._log('⏭️ Health monitoring disabled in config');
      return;
    }

    this._log('💓 Initializing health monitoring...');

    try {
      // Create HealthMonitor if not injected
      if (!this.healthMonitor) {
        if (this.healthMonitorFactory) {
          this.healthMonitor = this.healthMonitorFactory({ logger: this.logger });
        } else {
          this.healthMonitor = new HealthMonitor({ logger: this.logger });
        }
      }

      // Register built-in health checks based on available components
      const checkOptions = monitoringConfig.checks || {};
      const registeredChecks = registerBuiltInChecks(
        this.healthMonitor,
        {
          storage: this.storage,
          botManager: this.botManager,
          channelManager: this.channelManager,
          workerRegistry: this.workerRegistry,
          mcpManager: this.mcpManager,
        },
        {
          databaseInterval: checkOptions.database?.interval || 15_000,
          botsInterval: checkOptions.bots?.interval || 30_000,
          channelsInterval: checkOptions.channels?.interval || 30_000,
          workersInterval: checkOptions.workers?.interval || 30_000,
          mcpInterval: checkOptions.mcp?.interval || 60_000,
        }
      );

      this._log(
        `  💓 Registered ${registeredChecks.length} health check(s): ${registeredChecks.join(', ')}`
      );

      // Create MetricsCollector if storage is available
      if (this.storage && !this.metricsCollector) {
        if (this.metricsCollectorFactory) {
          this.metricsCollector = this.metricsCollectorFactory({
            storage: this.storage,
            logger: this.logger,
          });
        } else {
          this.metricsCollector = new MetricsCollector({
            storage: this.storage,
            logger: this.logger,
          });
        }
      }

      // Create Alerter if alert configuration exists
      const alertsConfig = monitoringConfig.alerts || {};
      if (!this.alerter && (alertsConfig.slack || alertsConfig.channels?.slack)) {
        const slackConfig = alertsConfig.slack || alertsConfig.channels?.slack || {};
        if (this.alerterFactory) {
          this.alerter = this.alerterFactory({
            logger: this.logger,
            slack: slackConfig,
            threshold: alertsConfig.thresholds?.consecutiveFailures ?? 2,
            cooldownMs: alertsConfig.cooldownMs ?? 5 * 60 * 1000,
          });
        } else {
          this.alerter = new Alerter({
            logger: this.logger,
            slack: slackConfig,
            threshold: alertsConfig.thresholds?.consecutiveFailures ?? 2,
            cooldownMs: alertsConfig.cooldownMs ?? 5 * 60 * 1000,
          });
        }
        this._log('  🔔 Alerter initialized with Slack webhook');
      }

      // Start the health monitor
      await this.healthMonitor.start();
      this._log('💓 Health monitoring started');
    } catch (err) {
      // Health monitoring failure is non-fatal
      this._log(`⚠️ Health monitoring initialization failed: ${err.message}`);
    }
  }

  /**
   * Stop the pluggable health monitoring system
   *
   * Stops the HealthMonitor and cleans up resources.
   *
   * @private
   */
  _stopHealthMonitoring() {
    if (this.healthMonitor && this.healthMonitor.isRunning()) {
      this.healthMonitor.stop();
      this._log('💓 Health monitoring stopped');
    }
  }

  // ==========================================================================
  // Private: Channel Health Monitoring
  // ==========================================================================

  /**
   * Start periodic health checks for all initialized channels
   *
   * Runs at the interval specified by `this.healthCheckInterval`. Each tick
   * iterates over ChannelManager channels and attempts reconnect on any
   * channel whose adapter reports unhealthy (via `isHealthy()` or status).
   *
   * @private
   */
  _startHealthMonitor() {
    if (this.healthCheckInterval <= 0 || !this.channelManager) {
      return;
    }

    this._log(`💓 Starting channel health monitor (interval: ${this.healthCheckInterval}ms)`);

    this._healthCheckTimer = setInterval(async () => {
      try {
        await this._runHealthChecks();
      } catch (err) {
        this._log(`⚠️ Health check error: ${err.message}`);
      }
    }, this.healthCheckInterval);

    // Allow the process to exit even if the timer is still running
    if (this._healthCheckTimer.unref) {
      this._healthCheckTimer.unref();
    }
  }

  /**
   * Stop the channel health monitor
   *
   * @private
   */
  _stopHealthMonitor() {
    if (this._healthCheckTimer) {
      clearInterval(this._healthCheckTimer);
      this._healthCheckTimer = null;
      this._log('💓 Channel health monitor stopped');
    }
  }

  /**
   * Run a single health check pass across all channels
   *
   * For each channel, checks if the adapter supports `isHealthy()`.
   * If the adapter reports unhealthy, attempts reconnection via
   * ChannelManager.reconnectChannel(). After reconnect, re-wires
   * the channel handler so messages continue to flow.
   *
   * @returns {Promise<void>}
   * @private
   */
  async _runHealthChecks() {
    if (!this.channelManager) {
      return;
    }

    const channelList = this.channelManager.listChannels();

    for (const channel of channelList) {
      const { name, adapter, status } = channel;

      // Skip channels without adapters or already in error/stopped state
      if (!adapter) {
        continue;
      }

      try {
        // Check adapter health if the method exists
        const isHealthy =
          typeof adapter.isHealthy === 'function' ? await adapter.isHealthy() : status !== 'error';

        if (!isHealthy) {
          this._log(`⚠️ Channel '${name}' unhealthy, attempting reconnect...`);
          const reconnected = await this.channelManager.reconnectChannel(name);

          // Update backward-compatible channels map
          if (reconnected && reconnected.adapter) {
            this.channels.set(name, reconnected.adapter);
          }

          // Re-wire message handler if processing pipeline is available
          const canWire =
            reconnected && reconnected.adapter && this.messageRouter && this.messageProcessor;
          if (canWire) {
            const newAdapter = reconnected.adapter;
            if (typeof newAdapter.onMessage === 'function') {
              newAdapter.onMessage(async message => {
                await this._handleChannelMessage(name, newAdapter, message);
              });
            }
          }

          this._log(`✅ Channel '${name}' reconnected successfully`);
        }
      } catch (err) {
        this._log(`❌ Health check failed for channel '${name}': ${err.message}`);
      }
    }
  }

  // ==========================================================================
  // Private: REST API Server Lifecycle
  // ==========================================================================

  /**
   * Check whether the REST API server is enabled in the config
   *
   * @returns {boolean} True if api.enabled is true in config
   * @private
   */
  _isAPIEnabled() {
    return this.config?.api?.enabled === true;
  }

  /**
   * Start the REST API server if api.enabled in config
   *
   * Creates the APIServer with all available routers (AdminRouter,
   * HealthRouter, BotRouter, SessionRouter, QueueRouter, MetricsRouter,
   * AuditRouter, WorkerRouter, LegacyRedirectRouter, ServerRouter,
   * TemplateRouter), then starts listening on the configured port/host.
   *
   * The LegacyRedirectRouter provides backward-compatible mapping from
   * `/api/bots` to `/api/v1/workers` for consumers of the legacy API.
   *
   * API server startup failure is non-fatal — the system continues
   * without the REST API.
   *
   * @returns {Promise<void>}
   * @private
   */
  async _startAPIServer() {
    if (!this._isAPIEnabled()) {
      return;
    }

    const apiConfig = this.config.api;
    const port = apiConfig.port || 3000;
    const host = apiConfig.host || '0.0.0.0';

    this._log('🌐 Starting REST API server...');

    try {
      // Build the list of routers based on available components
      const routers = [];

      // AdminRouter — requires the orchestrator itself
      try {
        const adminRouter = new AdminRouter({
          orchestrator: this,
          apiKey: null, // Auth handled at APIServer level
          logger: this.logger,
          auditLogger: this.auditLogger,
        });
        routers.push(adminRouter);
      } catch (err) {
        this._log(`  ⚠️ Failed to create AdminRouter: ${err.message}`);
      }

      // HealthRouter — requires HealthMonitor
      if (this.healthMonitor) {
        try {
          const healthRouter = new HealthRouter({
            healthMonitor: this.healthMonitor,
            logger: this.logger,
          });
          routers.push(healthRouter);
        } catch (err) {
          this._log(`  ⚠️ Failed to create HealthRouter: ${err.message}`);
        }
      }

      // BotRouter — requires BotManager
      if (this.botManager) {
        try {
          const botRouter = new BotRouter({
            botManager: this.botManager,
            sessionManager: this.sessionManager,
            messageProcessor: this.messageProcessor,
            storage: this.storage,
            logger: this.logger,
            auditLogger: this.auditLogger,
          });
          routers.push(botRouter);
        } catch (err) {
          this._log(`  ⚠️ Failed to create BotRouter: ${err.message}`);
        }
      }

      // SessionRouter — requires SessionManager and storage
      if (this.sessionManager && this.storage) {
        try {
          const sessionRouter = new SessionRouter({
            sessionManager: this.sessionManager,
            storage: this.storage,
            logger: this.logger,
            auditLogger: this.auditLogger,
          });
          routers.push(sessionRouter);
        } catch (err) {
          this._log(`  ⚠️ Failed to create SessionRouter: ${err.message}`);
        }
      }

      // QueueRouter — requires MessageQueue
      if (this.messageQueue) {
        try {
          const queueRouter = new QueueRouter({
            messageQueue: this.messageQueue,
            logger: this.logger,
            auditLogger: this.auditLogger,
          });
          routers.push(queueRouter);
        } catch (err) {
          this._log(`  ⚠️ Failed to create QueueRouter: ${err.message}`);
        }
      }

      // MetricsRouter — requires MetricsCollector
      if (this.metricsCollector) {
        try {
          const metricsRouter = new MetricsRouter({
            metricsCollector: this.metricsCollector,
            botManager: this.botManager,
            logger: this.logger,
          });
          routers.push(metricsRouter);
        } catch (err) {
          this._log(`  ⚠️ Failed to create MetricsRouter: ${err.message}`);
        }
      }

      // AuditRouter — requires AuditLogger
      if (this.auditLogger) {
        try {
          const auditRouter = new AuditRouter({
            auditLogger: this.auditLogger,
            logger: this.logger,
          });
          routers.push(auditRouter);
        } catch (err) {
          this._log(`  ⚠️ Failed to create AuditRouter: ${err.message}`);
        }
      }

      // WorkerRouter — requires BotManager (v1 API)
      let workerRouter = null;
      if (this.botManager) {
        try {
          workerRouter = new WorkerRouter({
            botManager: this.botManager,
            sessionManager: this.sessionManager,
            messageProcessor: this.messageProcessor,
            workerRegistry: this.workerRegistry,
            workerAssigner: this.workerAssigner,
            apiKey: null, // Auth handled at APIServer level
            logger: this.logger,
            auditLogger: this.auditLogger,
          });
          routers.push(workerRouter);
        } catch (err) {
          this._log(`  ⚠️ Failed to create WorkerRouter: ${err.message}`);
        }
      }

      // LegacyRedirectRouter — /api/bots -> /api/v1/workers backward compat
      if (workerRouter) {
        try {
          const legacyRouter = new LegacyRedirectRouter({
            workerRouter,
            logger: this.logger,
          });
          routers.push(legacyRouter);
        } catch (err) {
          this._log(`  ⚠️ Failed to create LegacyRedirectRouter: ${err.message}`);
        }
      }

      // ServerRouter — requires WorkerRegistry (v1 API)
      if (this.workerRegistry) {
        try {
          const serverRouter = new ServerRouter({
            workerRegistry: this.workerRegistry,
            sshTunnelManager: this.sshTunnelManager,
            apiKey: null, // Auth handled at APIServer level
            logger: this.logger,
            auditLogger: this.auditLogger,
          });
          routers.push(serverRouter);
        } catch (err) {
          this._log(`  ⚠️ Failed to create ServerRouter: ${err.message}`);
        }
      }

      // TemplateRouter — requires TemplateManager (v1 API)
      if (this.templateManager) {
        try {
          const templateRouter = new TemplateRouter({
            templateManager: this.templateManager,
            apiKey: null, // Auth handled at APIServer level
            logger: this.logger,
            auditLogger: this.auditLogger,
          });
          routers.push(templateRouter);
        } catch (err) {
          this._log(`  ⚠️ Failed to create TemplateRouter: ${err.message}`);
        }
      }

      // Build auth config for APIServer
      const authConfig = apiConfig.auth || {};
      const authTokens = this._normalizeAuthTokens(authConfig.tokens || []);

      // Build rate limit config
      const rateLimitConfig = apiConfig.rateLimit || {};

      // Build CORS config
      const corsConfig = apiConfig.cors || {};

      // Create APIServer
      if (!this.apiServer) {
        if (this.apiServerFactory) {
          this.apiServer = this.apiServerFactory(routers, apiConfig);
        } else {
          this.apiServer = new APIServer({
            routers,
            auth: {
              tokens: authTokens,
              defaultRole: authConfig.defaultRole || 'viewer',
              enabled: authConfig.enabled !== false,
            },
            rateLimit: {
              max: rateLimitConfig.max || 100,
              windowMs: rateLimitConfig.windowMs || 60000,
              bypassIps: rateLimitConfig.bypassIps || [],
              enabled: rateLimitConfig.enabled !== false,
            },
            cors: {
              origins: corsConfig.origins || ['*'],
              methods: corsConfig.methods,
              headers: corsConfig.headers,
            },
            logger: this.logger,
          });
        }
      }

      await this.apiServer.start(port, host);
      this._log(`🌐 REST API server listening on ${host}:${port} (${routers.length} router(s))`);
    } catch (err) {
      // API server failure is non-fatal
      this._log(`⚠️ Failed to start REST API server: ${err.message}`);
    }
  }

  /**
   * Normalize auth tokens from config into the format expected by AuthMiddleware
   *
   * Supports both string arrays (e.g. ["token1", "token2"]) and object arrays
   * (e.g. [{ token: "token1", role: "admin" }]).
   *
   * @param {Array<string|Object>} tokens - Token configurations
   * @returns {Array<Object>} Normalized token objects with token and role
   * @private
   */
  _normalizeAuthTokens(tokens) {
    if (!Array.isArray(tokens)) {
      return [];
    }

    return tokens.map(entry => {
      if (typeof entry === 'string') {
        return { token: entry, role: 'admin' };
      }
      return { token: entry.token, role: entry.role || 'admin' };
    });
  }

  /**
   * Stop the REST API server
   *
   * @returns {Promise<void>}
   * @private
   */
  async _stopAPIServer() {
    if (!this.apiServer) {
      return;
    }

    this._log('🌐 Stopping REST API server...');
    await this.apiServer.stop();
    this._log('✅ REST API server stopped');
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
  // Private: Bot Reload
  // ==========================================================================

  /**
   * Reload a single bot using BotReloader (granular) or BotManager (fallback)
   *
   * If the bot is not yet loaded (newly added to config), loads and starts it
   * via BotManager.loadBot() + startBot().
   *
   * When BotReloader is available, uses granular reload:
   * - Config-only changes: update in-memory, no container restart
   * - Soul-only changes: update personality, no container restart
   * - Sandbox changes: graceful container restart
   *
   * Falls back to BotManager.reloadBot() when BotReloader is not configured.
   *
   * @param {string} botId - Bot identifier
   * @param {Object} mergedConfig - Merged bot configuration (defaults + bot config)
   * @returns {Promise<void>}
   * @private
   */
  async _reloadBot(botId, mergedConfig) {
    const bot = this.botManager.getBot(botId);

    // New bot not yet loaded — load and start it
    if (!bot) {
      this._log(`🆕 New bot detected: '${botId}', loading...`);
      await this.botManager.loadBot(botId, mergedConfig);
      await this.botManager.startBot(botId);
      return;
    }

    if (this.botReloader) {
      const needsRestart = this.botReloader.needsContainerRestart(bot.config, mergedConfig);
      await this.botReloader.reloadBotConfig(botId, mergedConfig);

      // Reload soul if soul path is configured
      if (mergedConfig.soul) {
        try {
          const newSoulContent = await this.botReloader.soulLoader.load(mergedConfig.soul, {
            botName: mergedConfig.name || botId,
            botId,
          });
          await this.botReloader.reloadSoul(botId, newSoulContent);
        } catch (err) {
          this._log(`⚠️  Failed to reload soul for '${botId}': ${err.message}`);
        }
      }

      if (needsRestart) {
        if (mergedConfig.sandbox && typeof mergedConfig.sandbox === 'object') {
          await this.botReloader.reloadContainer(botId, mergedConfig.sandbox);
        } else {
          this._log(
            `⚠️  Sandbox removed for '${botId}'; skipping container reload (no sandbox config)`
          );
        }
      }
    } else {
      await this.botManager.reloadBot(botId, mergedConfig);
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

          // Resolve soul path relative to bot directory
          if (botConfig.soul && !path.isAbsolute(botConfig.soul)) {
            botConfig.soul = path.join(botsDir, entry.name, botConfig.soul);
          }

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

  /**
   * Create a normalized logger object for worker components.
   *
   * Worker components (SSHTunnelManager, WorkerAssigner, etc.) expect a
   * structured logger with info/warn/error/debug methods. This method
   * normalizes both function-style loggers (e.g. console.log) and
   * structured loggers (e.g. console or winston-like objects) into a
   * consistent shape.
   *
   * @returns {{ info: Function, warn: Function, error: Function, debug: Function }}
   * @private
   */
  _createWorkerLogger() {
    if (!this.logger) {
      return console;
    }

    // If the logger is already a structured object with log methods, use it
    if (typeof this.logger === 'object' && typeof this.logger.info === 'function') {
      return {
        info: (...args) => this.logger.info(...args),
        warn:
          typeof this.logger.warn === 'function'
            ? (...args) => this.logger.warn(...args)
            : (...args) => this.logger.info(...args),
        error:
          typeof this.logger.error === 'function'
            ? (...args) => this.logger.error(...args)
            : (...args) => this.logger.info(...args),
        debug:
          typeof this.logger.debug === 'function'
            ? (...args) => this.logger.debug(...args)
            : () => {},
      };
    }

    // If the logger is a function with structured methods (e.g. createLogger()),
    // use the structured methods directly
    if (typeof this.logger === 'function' && typeof this.logger.info === 'function') {
      return {
        info: (...args) => this.logger.info(...args),
        warn:
          typeof this.logger.warn === 'function'
            ? (...args) => this.logger.warn(...args)
            : (...args) => this.logger.info(...args),
        error:
          typeof this.logger.error === 'function'
            ? (...args) => this.logger.error(...args)
            : (...args) => this.logger.info(...args),
        debug:
          typeof this.logger.debug === 'function'
            ? (...args) => this.logger.debug(...args)
            : () => {},
      };
    }

    // If the logger is a plain function (e.g. console.log), wrap it to provide
    // all expected methods with consistent multi-arg support
    if (typeof this.logger === 'function') {
      const fn = this.logger;
      return {
        info: (...args) => fn(...args),
        warn: (...args) => fn(...args),
        error: (...args) => fn(...args),
        debug: () => {},
      };
    }

    // Fallback to console
    return console;
  }
}

export { ORCHESTRATOR_STATES };
export default Orchestrator;
