/**
 * Unit tests for Orchestrator
 *
 * Tests the full startup sequence, graceful shutdown, hot reload,
 * adapter registration, middleware, and error handling.
 *
 * All external dependencies are mocked for isolation.
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  Orchestrator,
  OrchestratorError,
  ORCHESTRATOR_STATES,
} from '../../../src/core/orchestrator.js';

// =============================================================================
// Mock Factories
// =============================================================================

/**
 * Create a valid main config for testing
 * @param {Object} [overrides={}] - Override default config values
 * @returns {Object} Main configuration
 */
function createMainConfig(overrides = {}) {
  return {
    defaults: {
      model: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
      sandbox: { type: 'docker', image: 'node:22-slim' },
    },
    providers: {
      anthropic: { type: 'anthropic', apiKey: 'test-key' },
    },
    channels: {},
    mcpServers: {},
    ...overrides,
  };
}

/**
 * Create a mock ConfigLoader
 * @param {Object} [options={}] - Override defaults
 * @returns {Object} Mock ConfigLoader
 */
function createMockConfigLoader(options = {}) {
  const mainConfig = options.mainConfig || createMainConfig();
  return {
    load: mock.fn(async () => mainConfig),
    deepMerge: mock.fn((defaults, overrides) => ({ ...defaults, ...overrides })),
    loadBotConfig: mock.fn(async (_path, defaults) => ({ ...defaults })),
  };
}

/**
 * Create a mock ConfigValidator
 * @param {Object} [options={}] - Override defaults
 * @returns {Object} Mock ConfigValidator
 */
function createMockConfigValidator(options = {}) {
  return {
    validateMainConfig: mock.fn(config => ({
      valid: true,
      errors: [],
      data: config,
    })),
    validateBotConfig: mock.fn(config => config),
    generateReport: mock.fn(errors => errors.map(e => e.message).join('\n')),
    ...options,
  };
}

/**
 * Create a mock storage instance
 * @param {Object} [overrides={}] - Override defaults
 * @returns {Object} Mock storage
 */
function createMockStorage(overrides = {}) {
  return {
    connect: mock.fn(async () => {}),
    disconnect: mock.fn(async () => {}),
    query: mock.fn(async () => ({ rows: [] })),
    transaction: mock.fn(async fn => fn({ query: mock.fn(async () => ({ rows: [] })) })),
    isConnected: mock.fn(() => true),
    getPoolStats: mock.fn(() => ({ totalCount: 5, idleCount: 3, waitingCount: 0 })),
    ...overrides,
  };
}

/**
 * Create a mock BotManager
 * @param {Object} [overrides={}] - Override defaults
 * @returns {Object} Mock BotManager
 */
function createMockBotManager(overrides = {}) {
  const bots = [];
  return {
    loadBot: mock.fn(async (botId, config) => {
      const bot = {
        id: botId,
        config: { ...config, enabled: config.enabled ?? true },
        status: 'loaded',
      };
      bots.push(bot);
      return bot;
    }),
    startBot: mock.fn(async () => {}),
    stopBot: mock.fn(async () => {}),
    reloadBot: mock.fn(async () => {}),
    stopAll: mock.fn(async () => ({ stopped: [], failed: [] })),
    listBots: mock.fn(() => [...bots]),
    getBot: mock.fn(botId => bots.find(b => b.id === botId)),
    getBotCount: mock.fn(() => bots.length),
    _bots: bots,
    ...overrides,
  };
}

/**
 * Create a mock MigrationRunner
 * @param {Object} [overrides={}] - Override defaults
 * @returns {Object} Mock MigrationRunner
 */
function createMockMigrationRunner(overrides = {}) {
  return {
    runMigrations: mock.fn(async () => []),
    getMigrationStatus: mock.fn(async () => []),
    ensureMigrationsTable: mock.fn(async () => {}),
    ...overrides,
  };
}

/**
 * Create a mock channel adapter class
 * @param {Object} [overrides={}] - Override method behavior
 * @returns {Function} Mock adapter constructor
 */
function createMockChannelAdapterClass(overrides = {}) {
  return class MockChannelAdapter {
    constructor() {
      this.initialized = false;
      this.config = null;
    }

    async initialize(config) {
      if (overrides.initializeError) {
        throw new Error(overrides.initializeError);
      }
      this.initialized = true;
      this.config = config;
    }

    async close() {
      if (overrides.closeError) {
        throw new Error(overrides.closeError);
      }
      this.initialized = false;
    }

    async onMessage(_handler) {}
    async sendMessage(_channelId, _text) {}
  };
}

/**
 * Build a default set of orchestrator options for testing
 * @param {Object} [overrides={}] - Override defaults
 * @returns {Object} Orchestrator options
 */
function createOrchestratorOptions(overrides = {}) {
  return {
    logger: null, // suppress logging in tests
    configLoader: createMockConfigLoader(),
    configValidator: createMockConfigValidator(),
    storage: createMockStorage(),
    botManager: createMockBotManager(),
    migrationRunner: createMockMigrationRunner(),
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('Orchestrator', () => {
  let orchestrator;
  let opts;

  beforeEach(() => {
    opts = createOrchestratorOptions();
    orchestrator = new Orchestrator(opts);
  });

  // ===========================================================================
  // Constructor
  // ===========================================================================

  describe('constructor', () => {
    test('creates instance with default options', () => {
      const orch = new Orchestrator({ logger: null });
      assert.equal(orch.configPath, './config.json');
      assert.equal(orch.botsPath, './bots');
      assert.equal(orch.dataPath, './data');
      assert.equal(orch.migrationsPath, './migrations');
      assert.equal(orch.state, 'created');
      assert.equal(orch.config, null);
      assert.equal(orch.startedAt, null);
    });

    test('accepts custom paths', () => {
      const orch = new Orchestrator({
        logger: null,
        configPath: '/custom/config.json',
        botsPath: '/custom/bots',
        dataPath: '/custom/data',
        migrationsPath: '/custom/migrations',
      });
      assert.equal(orch.configPath, '/custom/config.json');
      assert.equal(orch.botsPath, '/custom/bots');
      assert.equal(orch.dataPath, '/custom/data');
      assert.equal(orch.migrationsPath, '/custom/migrations');
    });

    test('accepts injected dependencies', () => {
      assert.equal(orchestrator.storage, opts.storage);
      assert.equal(orchestrator.botManager, opts.botManager);
      assert.equal(orchestrator.configLoader, opts.configLoader);
      assert.equal(orchestrator.configValidator, opts.configValidator);
      assert.equal(orchestrator.migrationRunner, opts.migrationRunner);
    });

    test('initializes empty adapter registries', () => {
      assert.ok(orchestrator.channelAdapters instanceof Map);
      assert.equal(orchestrator.channelAdapters.size, 0);
      assert.ok(orchestrator.secretAdapters instanceof Map);
      assert.equal(orchestrator.secretAdapters.size, 0);
    });

    test('initializes empty channels and middlewares', () => {
      assert.ok(orchestrator.channels instanceof Map);
      assert.equal(orchestrator.channels.size, 0);
      assert.ok(Array.isArray(orchestrator.middlewares));
      assert.equal(orchestrator.middlewares.length, 0);
    });

    test('sets logger to null when explicitly passed null', () => {
      const orch = new Orchestrator({ logger: null });
      assert.equal(orch.logger, null);
    });

    test('defaults logger to console.log when not specified', () => {
      const orch = new Orchestrator({});
      assert.equal(orch.logger, console.log);
    });

    test('accepts factories for deferred creation', () => {
      const storageFactory = mock.fn();
      const botManagerFactory = mock.fn();
      const orch = new Orchestrator({
        logger: null,
        storageFactory,
        botManagerFactory,
      });
      assert.equal(orch.storageFactory, storageFactory);
      assert.equal(orch.botManagerFactory, botManagerFactory);
    });
  });

  // ===========================================================================
  // start()
  // ===========================================================================

  describe('start()', () => {
    test('executes full startup sequence', async () => {
      await orchestrator.start();

      assert.equal(orchestrator.state, 'running');
      assert.ok(orchestrator.startedAt instanceof Date);
      assert.ok(orchestrator.config);
    });

    test('loads config via ConfigLoader', async () => {
      await orchestrator.start();

      assert.equal(opts.configLoader.load.mock.calls.length, 1);
    });

    test('validates config via ConfigValidator', async () => {
      await orchestrator.start();

      assert.equal(opts.configValidator.validateMainConfig.mock.calls.length, 1);
    });

    test('connects to database', async () => {
      await orchestrator.start();

      assert.equal(opts.storage.connect.mock.calls.length, 1);
    });

    test('runs migrations', async () => {
      await orchestrator.start();

      assert.equal(opts.migrationRunner.runMigrations.mock.calls.length, 1);
    });

    test('is a no-op when already running', async () => {
      await orchestrator.start();
      opts.configLoader.load.mock.resetCalls();

      await orchestrator.start();

      assert.equal(opts.configLoader.load.mock.calls.length, 0);
      assert.equal(orchestrator.state, 'running');
    });

    test('sets state to error on failure', async () => {
      opts.configLoader.load = mock.fn(async () => {
        throw new Error('Config file not found');
      });

      await assert.rejects(
        () => orchestrator.start(),
        err => {
          assert.equal(err.name, 'OrchestratorError');
          return true;
        }
      );

      assert.equal(orchestrator.state, 'error');
    });

    test('throws OrchestratorError when config validation fails', async () => {
      opts.configValidator.validateMainConfig = mock.fn(() => ({
        valid: false,
        errors: [{ message: 'Missing providers' }],
        data: null,
      }));

      await assert.rejects(
        () => orchestrator.start(),
        err => {
          assert.equal(err.name, 'OrchestratorError');
          assert.match(err.message, /validation failed/);
          assert.equal(err.component, 'config');
          return true;
        }
      );
    });

    test('throws OrchestratorError when database connection fails', async () => {
      opts.storage.connect = mock.fn(async () => {
        throw new Error('Connection refused');
      });

      await assert.rejects(
        () => orchestrator.start(),
        err => {
          assert.equal(err.name, 'OrchestratorError');
          assert.match(err.message, /database/i);
          assert.equal(err.component, 'database');
          return true;
        }
      );
    });

    test('throws OrchestratorError when migration fails', async () => {
      opts.migrationRunner.runMigrations = mock.fn(async () => {
        throw new Error('Migration 002 failed');
      });

      await assert.rejects(
        () => orchestrator.start(),
        err => {
          assert.equal(err.name, 'OrchestratorError');
          assert.match(err.message, /Migration failed/);
          assert.equal(err.component, 'migrations');
          return true;
        }
      );
    });

    test('skips database when no storage is configured', async () => {
      const orch = new Orchestrator({
        logger: null,
        configLoader: opts.configLoader,
        configValidator: opts.configValidator,
        botManager: opts.botManager,
        migrationRunner: opts.migrationRunner,
        // no storage, no storageFactory
      });

      await orch.start();

      assert.equal(orch.state, 'running');
    });

    test('creates storage from factory if not injected', async () => {
      const mockStorage = createMockStorage();
      const storageFactory = mock.fn(() => mockStorage);

      const orch = new Orchestrator({
        logger: null,
        configLoader: opts.configLoader,
        configValidator: opts.configValidator,
        botManager: opts.botManager,
        migrationRunner: opts.migrationRunner,
        storageFactory,
      });

      await orch.start();

      assert.equal(storageFactory.mock.calls.length, 1);
      assert.equal(orch.storage, mockStorage);
      assert.equal(mockStorage.connect.mock.calls.length, 1);
    });

    test('creates BotManager from factory if not injected', async () => {
      const mockBotManager = createMockBotManager();
      const botManagerFactory = mock.fn(() => mockBotManager);

      const orch = new Orchestrator({
        logger: null,
        configLoader: opts.configLoader,
        configValidator: opts.configValidator,
        storage: opts.storage,
        migrationRunner: opts.migrationRunner,
        botManagerFactory,
      });

      await orch.start();

      assert.equal(botManagerFactory.mock.calls.length, 1);
      assert.equal(orch.botManager, mockBotManager);
    });

    test('creates MigrationRunner from factory if not injected', async () => {
      const mockRunner = createMockMigrationRunner();
      const migrationRunnerFactory = mock.fn(() => mockRunner);

      const orch = new Orchestrator({
        logger: null,
        configLoader: opts.configLoader,
        configValidator: opts.configValidator,
        storage: opts.storage,
        botManager: opts.botManager,
        migrationRunnerFactory,
      });

      await orch.start();

      assert.equal(migrationRunnerFactory.mock.calls.length, 1);
      assert.equal(mockRunner.runMigrations.mock.calls.length, 1);
    });

    test('logs completed migrations count', async () => {
      const logs = [];
      opts.migrationRunner.runMigrations = mock.fn(async () => [
        { version: 1, name: '001_initial.sql' },
        { version: 2, name: '002_sessions.sql' },
      ]);

      const orch = new Orchestrator({
        ...opts,
        logger: msg => logs.push(msg),
      });

      await orch.start();

      assert.ok(logs.some(l => l.includes('2 migration(s)')));
    });

    test('logs "up to date" when no migrations pending', async () => {
      const logs = [];
      const orch = new Orchestrator({
        ...opts,
        logger: msg => logs.push(msg),
      });

      await orch.start();

      assert.ok(logs.some(l => l.includes('up to date')));
    });
  });

  // ===========================================================================
  // start() - Bot Loading & Starting
  // ===========================================================================

  describe('start() - bot loading', () => {
    test('loads bots from inline config', async () => {
      const mainConfig = createMainConfig({
        bots: {
          'support-bot': {
            soul: './bots/support/soul.md',
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
          },
        },
      });

      opts.configLoader.load = mock.fn(async () => mainConfig);

      await orchestrator.start();

      assert.equal(opts.botManager.loadBot.mock.calls.length, 1);
      const [botId] = opts.botManager.loadBot.mock.calls[0].arguments;
      assert.equal(botId, 'support-bot');
    });

    test('starts all loaded bots', async () => {
      const mainConfig = createMainConfig({
        bots: {
          'bot-a': { soul: './a.md', provider: 'anthropic', model: 'claude-sonnet-4-5' },
          'bot-b': { soul: './b.md', provider: 'anthropic', model: 'claude-sonnet-4-5' },
        },
      });

      opts.configLoader.load = mock.fn(async () => mainConfig);

      await orchestrator.start();

      assert.equal(opts.botManager.startBot.mock.calls.length, 2);
    });

    test('skips disabled bots during start', async () => {
      const bots = [];
      opts.botManager.loadBot = mock.fn(async (botId, config) => {
        const bot = {
          id: botId,
          config: { ...config, enabled: config.enabled ?? true },
          status: 'loaded',
        };
        bots.push(bot);
        return bot;
      });
      opts.botManager.listBots = mock.fn(() => [...bots]);

      const mainConfig = createMainConfig({
        bots: {
          'active-bot': {
            soul: './a.md',
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
            enabled: true,
          },
          'disabled-bot': {
            soul: './b.md',
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
            enabled: false,
          },
        },
      });

      opts.configLoader.load = mock.fn(async () => mainConfig);

      await orchestrator.start();

      // Only active-bot should have been started
      assert.equal(opts.botManager.startBot.mock.calls.length, 1);
      assert.equal(opts.botManager.startBot.mock.calls[0].arguments[0], 'active-bot');
    });

    test('continues startup even if a bot fails to load', async () => {
      let callCount = 0;
      const bots = [];
      opts.botManager.loadBot = mock.fn(async (botId, config) => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Config validation failed');
        }
        const bot = {
          id: botId,
          config: { ...config, enabled: true },
          status: 'loaded',
        };
        bots.push(bot);
        return bot;
      });
      opts.botManager.listBots = mock.fn(() => [...bots]);

      const mainConfig = createMainConfig({
        bots: {
          'bad-bot': { soul: './bad.md', provider: 'anthropic', model: 'x' },
          'good-bot': { soul: './good.md', provider: 'anthropic', model: 'y' },
        },
      });

      opts.configLoader.load = mock.fn(async () => mainConfig);

      await orchestrator.start();

      assert.equal(orchestrator.state, 'running');
      // good-bot should still have been started
      assert.equal(opts.botManager.startBot.mock.calls.length, 1);
    });

    test('continues startup even if a bot fails to start', async () => {
      let startCallCount = 0;
      opts.botManager.startBot = mock.fn(async () => {
        startCallCount++;
        if (startCallCount === 1) {
          throw new Error('Docker daemon unavailable');
        }
      });

      const mainConfig = createMainConfig({
        bots: {
          'bot-a': { soul: './a.md', provider: 'anthropic', model: 'x' },
          'bot-b': { soul: './b.md', provider: 'anthropic', model: 'y' },
        },
      });

      opts.configLoader.load = mock.fn(async () => mainConfig);

      await orchestrator.start();

      assert.equal(orchestrator.state, 'running');
      assert.equal(opts.botManager.startBot.mock.calls.length, 2);
    });

    test('logs failure count when some bots fail to start', async () => {
      const logs = [];
      opts.botManager.startBot = mock.fn(async () => {
        throw new Error('Container error');
      });

      const mainConfig = createMainConfig({
        bots: {
          'bot-a': { soul: './a.md', provider: 'anthropic', model: 'x' },
        },
      });

      const orch = new Orchestrator({
        ...opts,
        configLoader: createMockConfigLoader({ mainConfig }),
        logger: msg => logs.push(msg),
      });

      await orch.start();

      assert.ok(logs.some(l => l.includes('failed to start')));
    });

    test('skips bot loading when no BotManager configured', async () => {
      const orch = new Orchestrator({
        logger: null,
        configLoader: opts.configLoader,
        configValidator: opts.configValidator,
        storage: opts.storage,
        migrationRunner: opts.migrationRunner,
        // no botManager
      });

      await orch.start();

      assert.equal(orch.state, 'running');
    });

    test('merges bot config with defaults', async () => {
      const mainConfig = createMainConfig({
        defaults: {
          model: { provider: 'anthropic' },
          sandbox: { type: 'docker', image: 'node:22-slim' },
        },
        bots: {
          'my-bot': {
            soul: './soul.md',
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
          },
        },
      });

      opts.configLoader.load = mock.fn(async () => mainConfig);

      await orchestrator.start();

      assert.equal(opts.configLoader.deepMerge.mock.calls.length, 1);
      const [defaults] = opts.configLoader.deepMerge.mock.calls[0].arguments;
      assert.ok(defaults.model);
    });
  });

  // ===========================================================================
  // start() - Channel Initialization
  // ===========================================================================

  describe('start() - channel initialization', () => {
    test('initializes channels when adapters are registered', async () => {
      const MockAdapter = createMockChannelAdapterClass();
      orchestrator.registerChannelAdapter('slack', MockAdapter);

      const mainConfig = createMainConfig({
        channels: {
          'slack-main': { type: 'slack', botToken: 'xoxb-test' },
        },
      });

      opts.configLoader.load = mock.fn(async () => mainConfig);
      orchestrator = new Orchestrator({
        ...opts,
        configLoader: opts.configLoader,
      });
      orchestrator.registerChannelAdapter('slack', MockAdapter);

      await orchestrator.start();

      assert.equal(orchestrator.channels.size, 1);
      assert.ok(orchestrator.channels.has('slack-main'));
      const adapter = orchestrator.channels.get('slack-main');
      assert.equal(adapter.initialized, true);
    });

    test('skips channels without registered adapter and counts as failed', async () => {
      const mainConfig = createMainConfig({
        channels: {
          'slack-main': { type: 'slack', botToken: 'xoxb-test' },
        },
      });

      opts.configLoader.load = mock.fn(async () => mainConfig);

      // All configured channels fail (no adapter registered), so startup throws
      await assert.rejects(
        () => orchestrator.start(),
        err => {
          assert.equal(err.name, 'OrchestratorError');
          assert.match(err.message, /channel.*failed/i);
          return true;
        }
      );
    });

    test('throws when ALL configured channels fail to initialize', async () => {
      const FailAdapter = createMockChannelAdapterClass({
        initializeError: 'Invalid token',
      });
      orchestrator.registerChannelAdapter('slack', FailAdapter);

      const mainConfig = createMainConfig({
        channels: {
          'slack-main': { type: 'slack', botToken: 'invalid' },
        },
      });

      opts.configLoader.load = mock.fn(async () => mainConfig);
      orchestrator = new Orchestrator({
        ...opts,
        configLoader: opts.configLoader,
      });
      orchestrator.registerChannelAdapter('slack', FailAdapter);

      await assert.rejects(
        () => orchestrator.start(),
        err => {
          assert.equal(err.name, 'OrchestratorError');
          assert.match(err.message, /channel.*failed/i);
          assert.equal(err.component, 'channels');
          return true;
        }
      );

      assert.equal(orchestrator.state, 'error');
    });

    test('throws when channels are configured but no adapters registered', async () => {
      const mainConfig = createMainConfig({
        channels: {
          'slack-main': { type: 'slack', botToken: 'xoxb-test' },
        },
      });

      opts.configLoader.load = mock.fn(async () => mainConfig);

      await assert.rejects(
        () => orchestrator.start(),
        err => {
          assert.equal(err.name, 'OrchestratorError');
          assert.match(err.message, /channel.*failed/i);
          return true;
        }
      );

      assert.equal(orchestrator.state, 'error');
    });

    test('starts successfully when at least one channel initializes', async () => {
      const GoodAdapter = createMockChannelAdapterClass();
      const FailAdapter = createMockChannelAdapterClass({
        initializeError: 'Invalid token',
      });

      const mainConfig = createMainConfig({
        channels: {
          'slack-main': { type: 'slack', botToken: 'xoxb-test' },
          'discord-main': { type: 'discord', token: 'bad-token' },
        },
      });

      opts.configLoader.load = mock.fn(async () => mainConfig);
      orchestrator = new Orchestrator({
        ...opts,
        configLoader: opts.configLoader,
      });
      orchestrator.registerChannelAdapter('slack', GoodAdapter);
      orchestrator.registerChannelAdapter('discord', FailAdapter);

      await orchestrator.start();

      assert.equal(orchestrator.state, 'running');
      assert.equal(orchestrator.channels.size, 1);
      assert.ok(orchestrator.channels.has('slack-main'));
    });
  });

  // ===========================================================================
  // stop()
  // ===========================================================================

  describe('stop()', () => {
    test('stops all components gracefully', async () => {
      await orchestrator.start();
      await orchestrator.stop();

      assert.equal(orchestrator.state, 'stopped');
      assert.equal(opts.botManager.stopAll.mock.calls.length, 1);
      assert.equal(opts.storage.disconnect.mock.calls.length, 1);
    });

    test('is a no-op when already stopped', async () => {
      await orchestrator.start();
      await orchestrator.stop();

      opts.storage.disconnect.mock.resetCalls();
      await orchestrator.stop();

      assert.equal(opts.storage.disconnect.mock.calls.length, 0);
    });

    test('closes channel adapters during shutdown', async () => {
      const MockAdapter = createMockChannelAdapterClass();
      orchestrator.registerChannelAdapter('slack', MockAdapter);

      const mainConfig = createMainConfig({
        channels: {
          'slack-main': { type: 'slack', botToken: 'xoxb-test' },
        },
      });
      opts.configLoader.load = mock.fn(async () => mainConfig);
      orchestrator = new Orchestrator({ ...opts, configLoader: opts.configLoader });
      orchestrator.registerChannelAdapter('slack', MockAdapter);

      await orchestrator.start();
      assert.equal(orchestrator.channels.size, 1);

      await orchestrator.stop();

      assert.equal(orchestrator.channels.size, 0);
    });

    test('sets state to stopped even when components fail', async () => {
      opts.storage.disconnect = mock.fn(async () => {
        throw new Error('Pool already ended');
      });

      await orchestrator.start();

      await assert.rejects(
        () => orchestrator.stop(),
        err => {
          assert.equal(err.name, 'OrchestratorError');
          assert.match(err.message, /errors/);
          return true;
        }
      );

      assert.equal(orchestrator.state, 'stopped');
    });

    test('throws OrchestratorError with first error as cause', async () => {
      const dbError = new Error('DB disconnect failed');
      opts.storage.disconnect = mock.fn(async () => {
        throw dbError;
      });

      await orchestrator.start();

      await assert.rejects(
        () => orchestrator.stop(),
        err => {
          assert.equal(err.name, 'OrchestratorError');
          assert.equal(err.operation, 'stop');
          assert.ok(err.cause);
          return true;
        }
      );
    });

    test('preserves error state when stop() is called from error state', async () => {
      await orchestrator.start();

      // Simulate an error state (e.g., a runtime failure after start)
      orchestrator.state = ORCHESTRATOR_STATES.ERROR;

      await orchestrator.stop();

      // stop() should preserve the ERROR state, not overwrite with STOPPED
      assert.equal(orchestrator.state, 'error');
    });

    test('preserves error state even when shutdown components fail', async () => {
      opts.storage.disconnect = mock.fn(async () => {
        throw new Error('Pool already ended');
      });

      await orchestrator.start();

      // Simulate an error state before calling stop()
      orchestrator.state = ORCHESTRATOR_STATES.ERROR;

      await assert.rejects(
        () => orchestrator.stop(),
        err => {
          assert.equal(err.name, 'OrchestratorError');
          return true;
        }
      );

      // Should still be in error state, not stopped
      assert.equal(orchestrator.state, 'error');
    });

    test('skips bot stopping when no BotManager', async () => {
      const orch = new Orchestrator({
        logger: null,
        configLoader: opts.configLoader,
        configValidator: opts.configValidator,
        storage: opts.storage,
        migrationRunner: opts.migrationRunner,
      });

      await orch.start();
      await orch.stop();

      assert.equal(orch.state, 'stopped');
    });

    test('skips database disconnect when no storage', async () => {
      const orch = new Orchestrator({
        logger: null,
        configLoader: opts.configLoader,
        configValidator: opts.configValidator,
        botManager: opts.botManager,
        migrationRunner: opts.migrationRunner,
      });

      await orch.start();
      await orch.stop();

      assert.equal(orch.state, 'stopped');
    });
  });

  // ===========================================================================
  // reload()
  // ===========================================================================

  describe('reload()', () => {
    test('reloads config and bots', async () => {
      const mainConfig = createMainConfig({
        bots: {
          'bot-a': { soul: './a.md', provider: 'anthropic', model: 'x' },
        },
      });
      opts.configLoader.load = mock.fn(async () => mainConfig);

      await orchestrator.start();

      opts.configLoader.load.mock.resetCalls();
      opts.botManager.reloadBot.mock.resetCalls();

      const results = await orchestrator.reload();

      assert.equal(opts.configLoader.load.mock.calls.length, 1);
      assert.equal(opts.botManager.reloadBot.mock.calls.length, 1);
      assert.ok(results.reloaded.includes('bot-a'));
      assert.equal(results.failed.length, 0);
    });

    test('throws when not running', async () => {
      await assert.rejects(
        () => orchestrator.reload(),
        err => {
          assert.equal(err.name, 'OrchestratorError');
          assert.match(err.message, /not running/);
          assert.equal(err.operation, 'reload');
          return true;
        }
      );
    });

    test('throws when new config is invalid', async () => {
      await orchestrator.start();

      opts.configValidator.validateMainConfig = mock.fn(() => ({
        valid: false,
        errors: [{ message: 'Invalid field' }],
        data: null,
      }));

      await assert.rejects(
        () => orchestrator.reload(),
        err => {
          assert.equal(err.name, 'OrchestratorError');
          assert.match(err.message, /validation failed/);
          return true;
        }
      );
    });

    test('collects reload failures without throwing', async () => {
      const mainConfig = createMainConfig({
        bots: {
          'good-bot': { soul: './g.md', provider: 'anthropic', model: 'x' },
          'bad-bot': { soul: './b.md', provider: 'anthropic', model: 'y' },
        },
      });
      opts.configLoader.load = mock.fn(async () => mainConfig);

      await orchestrator.start();

      let reloadCount = 0;
      opts.botManager.reloadBot = mock.fn(async () => {
        reloadCount++;
        if (reloadCount === 2) {
          throw new Error('Soul file missing');
        }
      });

      const results = await orchestrator.reload();

      assert.equal(results.reloaded.length, 1);
      assert.equal(results.failed.length, 1);
      assert.equal(results.failed[0].botId, 'bad-bot');
    });

    test('works without BotManager', async () => {
      const orch = new Orchestrator({
        logger: null,
        configLoader: opts.configLoader,
        configValidator: opts.configValidator,
        storage: opts.storage,
        migrationRunner: opts.migrationRunner,
      });

      await orch.start();

      const results = await orch.reload();

      assert.deepEqual(results, { reloaded: [], failed: [] });
    });
  });

  // ===========================================================================
  // registerChannelAdapter()
  // ===========================================================================

  describe('registerChannelAdapter()', () => {
    test('registers a channel adapter class', () => {
      const MockAdapter = createMockChannelAdapterClass();

      orchestrator.registerChannelAdapter('telegram', MockAdapter);

      assert.ok(orchestrator.channelAdapters.has('telegram'));
      assert.equal(orchestrator.channelAdapters.get('telegram'), MockAdapter);
    });

    test('overwrites existing adapter for same name', () => {
      const Adapter1 = createMockChannelAdapterClass();
      const Adapter2 = createMockChannelAdapterClass();

      orchestrator.registerChannelAdapter('slack', Adapter1);
      orchestrator.registerChannelAdapter('slack', Adapter2);

      assert.equal(orchestrator.channelAdapters.get('slack'), Adapter2);
    });

    test('throws when name is empty', () => {
      assert.throws(
        () => orchestrator.registerChannelAdapter('', class {}),
        err => {
          assert.equal(err.name, 'OrchestratorError');
          assert.match(err.message, /non-empty string/);
          assert.equal(err.operation, 'registerChannelAdapter');
          return true;
        }
      );
    });

    test('throws when name is null', () => {
      assert.throws(
        () => orchestrator.registerChannelAdapter(null, class {}),
        err => {
          assert.equal(err.name, 'OrchestratorError');
          return true;
        }
      );
    });

    test('throws when adapter is not a function', () => {
      assert.throws(
        () => orchestrator.registerChannelAdapter('slack', {}),
        err => {
          assert.equal(err.name, 'OrchestratorError');
          assert.match(err.message, /constructor function or class/);
          assert.equal(err.operation, 'registerChannelAdapter');
          return true;
        }
      );
    });

    test('throws when adapter is null', () => {
      assert.throws(
        () => orchestrator.registerChannelAdapter('slack', null),
        err => {
          assert.equal(err.name, 'OrchestratorError');
          return true;
        }
      );
    });
  });

  // ===========================================================================
  // registerSecretAdapter()
  // ===========================================================================

  describe('registerSecretAdapter()', () => {
    test('registers a secret adapter class', () => {
      class VaultAdapter {}
      orchestrator.registerSecretAdapter('vault', VaultAdapter);

      assert.ok(orchestrator.secretAdapters.has('vault'));
      assert.equal(orchestrator.secretAdapters.get('vault'), VaultAdapter);
    });

    test('throws when name is empty', () => {
      assert.throws(
        () => orchestrator.registerSecretAdapter('', class {}),
        err => {
          assert.equal(err.name, 'OrchestratorError');
          assert.match(err.message, /non-empty string/);
          assert.equal(err.operation, 'registerSecretAdapter');
          return true;
        }
      );
    });

    test('throws when adapter is not a function', () => {
      assert.throws(
        () => orchestrator.registerSecretAdapter('vault', 'not-a-class'),
        err => {
          assert.equal(err.name, 'OrchestratorError');
          assert.match(err.message, /constructor function or class/);
          assert.equal(err.operation, 'registerSecretAdapter');
          return true;
        }
      );
    });
  });

  // ===========================================================================
  // use() - Middleware
  // ===========================================================================

  describe('use()', () => {
    test('registers a middleware function', () => {
      const mw = () => {};
      orchestrator.use(mw);

      assert.equal(orchestrator.middlewares.length, 1);
      assert.equal(orchestrator.middlewares[0], mw);
    });

    test('registers multiple middlewares in order', () => {
      const mw1 = () => {};
      const mw2 = () => {};
      const mw3 = () => {};

      orchestrator.use(mw1);
      orchestrator.use(mw2);
      orchestrator.use(mw3);

      assert.equal(orchestrator.middlewares.length, 3);
      assert.equal(orchestrator.middlewares[0], mw1);
      assert.equal(orchestrator.middlewares[1], mw2);
      assert.equal(orchestrator.middlewares[2], mw3);
    });

    test('throws when middleware is not a function', () => {
      assert.throws(
        () => orchestrator.use('not-a-function'),
        err => {
          assert.equal(err.name, 'OrchestratorError');
          assert.match(err.message, /must be a function/);
          assert.equal(err.operation, 'use');
          return true;
        }
      );
    });

    test('throws when middleware is null', () => {
      assert.throws(
        () => orchestrator.use(null),
        err => {
          assert.equal(err.name, 'OrchestratorError');
          return true;
        }
      );
    });
  });

  // ===========================================================================
  // getState() / getStatus()
  // ===========================================================================

  describe('getState()', () => {
    test('returns created before start', () => {
      assert.equal(orchestrator.getState(), 'created');
    });

    test('returns running after start', async () => {
      await orchestrator.start();
      assert.equal(orchestrator.getState(), 'running');
    });

    test('returns stopped after stop', async () => {
      await orchestrator.start();
      await orchestrator.stop();
      assert.equal(orchestrator.getState(), 'stopped');
    });
  });

  describe('getStatus()', () => {
    test('returns status before start', () => {
      const status = orchestrator.getStatus();
      assert.equal(status.state, 'created');
      assert.equal(status.startedAt, null);
      assert.equal(status.uptime, 0);
    });

    test('returns full status after start', async () => {
      await orchestrator.start();

      const status = orchestrator.getStatus();
      assert.equal(status.state, 'running');
      assert.ok(status.startedAt instanceof Date);
      assert.ok(status.uptime >= 0);
      assert.equal(typeof status.botCount, 'number');
      assert.equal(status.channelCount, 0);
      assert.equal(status.middlewareCount, 0);
      assert.equal(status.databaseConnected, true);
    });

    test('includes middleware count', () => {
      orchestrator.use(() => {});
      orchestrator.use(() => {});

      const status = orchestrator.getStatus();
      assert.equal(status.middlewareCount, 2);
    });
  });

  // ===========================================================================
  // Full Lifecycle
  // ===========================================================================

  describe('full lifecycle', () => {
    test('start → stop → start again', async () => {
      await orchestrator.start();
      assert.equal(orchestrator.state, 'running');

      await orchestrator.stop();
      assert.equal(orchestrator.state, 'stopped');

      // Reset mocks for second start
      opts.storage.connect.mock.resetCalls();
      opts.configLoader.load.mock.resetCalls();

      // Need to reset state to allow restart
      orchestrator.state = ORCHESTRATOR_STATES.CREATED;
      await orchestrator.start();
      assert.equal(orchestrator.state, 'running');
    });

    test('start → reload → stop', async () => {
      const mainConfig = createMainConfig({
        bots: {
          'bot-a': { soul: './a.md', provider: 'anthropic', model: 'x' },
        },
      });
      opts.configLoader.load = mock.fn(async () => mainConfig);

      await orchestrator.start();
      assert.equal(orchestrator.state, 'running');

      const results = await orchestrator.reload();
      assert.ok(results.reloaded.length >= 0);

      await orchestrator.stop();
      assert.equal(orchestrator.state, 'stopped');
    });

    test('start with all components', async () => {
      const MockSlack = createMockChannelAdapterClass();
      const mainConfig = createMainConfig({
        channels: {
          'slack-main': { type: 'slack', botToken: 'xoxb-test' },
        },
        bots: {
          'support-bot': { soul: './soul.md', provider: 'anthropic', model: 'x' },
        },
      });

      opts.configLoader.load = mock.fn(async () => mainConfig);

      const logs = [];
      const orch = new Orchestrator({
        ...opts,
        configLoader: opts.configLoader,
        logger: msg => logs.push(msg),
      });

      orch.registerChannelAdapter('slack', MockSlack);
      orch.use(() => {});

      await orch.start();

      assert.equal(orch.state, 'running');
      assert.equal(orch.channels.size, 1);
      assert.equal(orch.middlewares.length, 1);
      assert.ok(logs.some(l => l.includes('AI Army started')));

      await orch.stop();

      assert.equal(orch.state, 'stopped');
      assert.equal(orch.channels.size, 0);
    });
  });

  // ===========================================================================
  // Logging
  // ===========================================================================

  describe('logging', () => {
    test('calls logger during startup', async () => {
      const logs = [];
      const orch = new Orchestrator({
        ...opts,
        logger: msg => logs.push(msg),
      });

      await orch.start();

      assert.ok(logs.length > 0);
      assert.ok(logs.some(l => l.includes('Starting')));
      assert.ok(logs.some(l => l.includes('Configuration loaded')));
      assert.ok(logs.some(l => l.includes('Database connected')));
    });

    test('suppresses logging when logger is null', async () => {
      // This should not throw even though logger is null
      const orch = new Orchestrator({
        ...opts,
        logger: null,
      });

      await orch.start();
      await orch.stop();

      assert.equal(orch.state, 'stopped');
    });

    test('calls logger during shutdown', async () => {
      const logs = [];
      const orch = new Orchestrator({
        ...opts,
        logger: msg => logs.push(msg),
      });

      await orch.start();
      logs.length = 0; // clear startup logs

      await orch.stop();

      assert.ok(logs.some(l => l.includes('Stopping')));
      assert.ok(logs.some(l => l.includes('Orchestrator stopped')));
    });
  });
});

// =============================================================================
// OrchestratorError
// =============================================================================

describe('OrchestratorError', () => {
  test('is an instance of Error', () => {
    const error = new OrchestratorError('Test error');
    assert.ok(error instanceof Error);
  });

  test('has correct name', () => {
    const error = new OrchestratorError('Test error');
    assert.equal(error.name, 'OrchestratorError');
  });

  test('stores message', () => {
    const error = new OrchestratorError('Something went wrong');
    assert.equal(error.message, 'Something went wrong');
  });

  test('stores operation', () => {
    const error = new OrchestratorError('Test error', { operation: 'start' });
    assert.equal(error.operation, 'start');
  });

  test('stores component', () => {
    const error = new OrchestratorError('Test error', { component: 'database' });
    assert.equal(error.component, 'database');
  });

  test('stores cause', () => {
    const cause = new Error('Original error');
    const error = new OrchestratorError('Test error', { cause });
    assert.equal(error.cause, cause);
  });

  test('stores all options together', () => {
    const cause = new Error('Original');
    const error = new OrchestratorError('Multi-option error', {
      cause,
      operation: 'start',
      component: 'config',
    });

    assert.equal(error.cause, cause);
    assert.equal(error.operation, 'start');
    assert.equal(error.component, 'config');
  });
});

// =============================================================================
// ORCHESTRATOR_STATES
// =============================================================================

describe('ORCHESTRATOR_STATES', () => {
  test('exports all expected state values', () => {
    assert.equal(ORCHESTRATOR_STATES.CREATED, 'created');
    assert.equal(ORCHESTRATOR_STATES.STARTING, 'starting');
    assert.equal(ORCHESTRATOR_STATES.RUNNING, 'running');
    assert.equal(ORCHESTRATOR_STATES.STOPPING, 'stopping');
    assert.equal(ORCHESTRATOR_STATES.STOPPED, 'stopped');
    assert.equal(ORCHESTRATOR_STATES.ERROR, 'error');
  });
});
