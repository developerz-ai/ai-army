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
 * Create a mock MessageProcessor
 * @param {Object} [overrides={}] - Override defaults
 * @returns {Object} Mock MessageProcessor
 */
function createMockMessageProcessor(overrides = {}) {
  return {
    processMessage: mock.fn(async () => ({
      text: 'AI response',
      toolCalls: [],
      usage: { promptTokens: 10, completionTokens: 20 },
      sessionId: 'session-123',
      durationMs: 150,
    })),
    ...overrides,
  };
}

/**
 * Create a mock MessageRouter
 * @param {Object} [overrides={}] - Override defaults
 * @returns {Object} Mock MessageRouter
 */
function createMockMessageRouter(overrides = {}) {
  return {
    route: mock.fn(async () => ({
      bot: {
        id: 'test-bot',
        config: {
          id: 'test-bot',
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          channel: 'slack-main',
        },
      },
      allowed: true,
    })),
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
      this.messageHandler = null;
      this.sentMessages = [];
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

    onMessage(handler) {
      this.messageHandler = handler;
    }

    async sendMessage(channelId, text, threadTs) {
      this.sentMessages.push({ channelId, text, threadTs });
    }
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
    botsPath: '/tmp/nonexistent-bots-path', // prevent filesystem discovery
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

  // ===========================================================================
  // _setupChannelHandlers()
  // ===========================================================================

  describe('_setupChannelHandlers()', () => {
    test('wires onMessage handlers when messageRouter and messageProcessor are set', async () => {
      const MockAdapter = createMockChannelAdapterClass();
      const mainConfig = createMainConfig({
        channels: {
          'slack-main': { type: 'slack', botToken: 'xoxb-test' },
        },
      });

      opts.configLoader.load = mock.fn(async () => mainConfig);

      const messageRouter = createMockMessageRouter();
      const messageProcessor = createMockMessageProcessor();

      const orch = new Orchestrator({
        ...opts,
        configLoader: opts.configLoader,
        messageRouter,
        messageProcessor,
      });
      orch.registerChannelAdapter('slack', MockAdapter);

      await orch.start();

      assert.equal(orch.channels.size, 1);
      const adapter = orch.channels.get('slack-main');
      assert.ok(adapter.messageHandler, 'onMessage handler should be registered');

      await orch.stop();
    });

    test('logs wired count when handlers are set', async () => {
      const MockAdapter = createMockChannelAdapterClass();
      const mainConfig = createMainConfig({
        channels: {
          'slack-main': { type: 'slack', botToken: 'xoxb-test' },
        },
      });

      opts.configLoader.load = mock.fn(async () => mainConfig);

      const logs = [];
      const orch = new Orchestrator({
        ...opts,
        configLoader: opts.configLoader,
        messageRouter: createMockMessageRouter(),
        messageProcessor: createMockMessageProcessor(),
        logger: msg => logs.push(msg),
      });
      orch.registerChannelAdapter('slack', MockAdapter);

      await orch.start();

      assert.ok(logs.some(l => l.includes('Wired 1 channel(s) to MessageProcessor')));

      await orch.stop();
    });

    test('skips wiring when messageRouter is missing', async () => {
      const MockAdapter = createMockChannelAdapterClass();
      const mainConfig = createMainConfig({
        channels: {
          'slack-main': { type: 'slack', botToken: 'xoxb-test' },
        },
      });

      opts.configLoader.load = mock.fn(async () => mainConfig);

      const logs = [];
      const orch = new Orchestrator({
        ...opts,
        configLoader: opts.configLoader,
        messageProcessor: createMockMessageProcessor(),
        // no messageRouter
        logger: msg => logs.push(msg),
      });
      orch.registerChannelAdapter('slack', MockAdapter);

      await orch.start();

      const adapter = orch.channels.get('slack-main');
      assert.equal(adapter.messageHandler, null, 'No handler should be set');
      assert.ok(
        logs.some(l => l.includes('skipping channel handler wiring')),
        'Should log skip message'
      );

      await orch.stop();
    });

    test('skips wiring when messageProcessor is missing', async () => {
      const MockAdapter = createMockChannelAdapterClass();
      const mainConfig = createMainConfig({
        channels: {
          'slack-main': { type: 'slack', botToken: 'xoxb-test' },
        },
      });

      opts.configLoader.load = mock.fn(async () => mainConfig);

      const orch = new Orchestrator({
        ...opts,
        configLoader: opts.configLoader,
        messageRouter: createMockMessageRouter(),
        // no messageProcessor
      });
      orch.registerChannelAdapter('slack', MockAdapter);

      await orch.start();

      const adapter = orch.channels.get('slack-main');
      assert.equal(adapter.messageHandler, null);

      await orch.stop();
    });

    test('skips adapters without onMessage method', async () => {
      // Create adapter without onMessage
      const NoOnMessageAdapter = class {
        constructor() {
          this.initialized = false;
        }
        async initialize() {
          this.initialized = true;
        }
        async close() {
          this.initialized = false;
        }
      };

      const mainConfig = createMainConfig({
        channels: {
          'bare-channel': { type: 'bare', botToken: 'test' },
        },
      });

      opts.configLoader.load = mock.fn(async () => mainConfig);

      const logs = [];
      const orch = new Orchestrator({
        ...opts,
        configLoader: opts.configLoader,
        messageRouter: createMockMessageRouter(),
        messageProcessor: createMockMessageProcessor(),
        logger: msg => logs.push(msg),
      });
      orch.registerChannelAdapter('bare', NoOnMessageAdapter);

      await orch.start();

      assert.ok(
        logs.some(l => l.includes('does not support onMessage')),
        'Should log skip for adapters without onMessage'
      );

      await orch.stop();
    });

    test('does not log skip message when no channels configured', async () => {
      const logs = [];
      const orch = new Orchestrator({
        ...opts,
        messageRouter: createMockMessageRouter(),
        // no messageProcessor
        logger: msg => logs.push(msg),
      });

      await orch.start();

      assert.ok(
        !logs.some(l => l.includes('skipping channel handler wiring')),
        'Should not log skip when no channels exist'
      );

      await orch.stop();
    });

    test('creates messageRouter from factory during startup', async () => {
      const mockRouter = createMockMessageRouter();
      const routerFactory = mock.fn(() => mockRouter);

      const orch = new Orchestrator({
        ...opts,
        messageRouterFactory: routerFactory,
        messageProcessor: createMockMessageProcessor(),
      });

      await orch.start();

      assert.equal(routerFactory.mock.calls.length, 1);
      assert.equal(orch.messageRouter, mockRouter);

      await orch.stop();
    });

    test('creates messageProcessor from factory during startup', async () => {
      const mockProcessor = createMockMessageProcessor();
      const processorFactory = mock.fn(() => mockProcessor);

      const orch = new Orchestrator({
        ...opts,
        messageProcessorFactory: processorFactory,
        messageRouter: createMockMessageRouter(),
      });

      await orch.start();

      assert.equal(processorFactory.mock.calls.length, 1);
      assert.equal(orch.messageProcessor, mockProcessor);

      await orch.stop();
    });
  });

  // ===========================================================================
  // _handleChannelMessage()
  // ===========================================================================

  describe('_handleChannelMessage()', () => {
    test('routes message, processes it, and sends response', async () => {
      const MockAdapter = createMockChannelAdapterClass();
      const mainConfig = createMainConfig({
        channels: {
          'slack-main': { type: 'slack', botToken: 'xoxb-test' },
        },
        bots: {
          'test-bot': {
            soul: './soul.md',
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
            channel: 'slack-main',
          },
        },
      });

      opts.configLoader.load = mock.fn(async () => mainConfig);

      const messageRouter = createMockMessageRouter();
      const messageProcessor = createMockMessageProcessor();

      const orch = new Orchestrator({
        ...opts,
        configLoader: opts.configLoader,
        messageRouter,
        messageProcessor,
      });
      orch.registerChannelAdapter('slack', MockAdapter);

      await orch.start();

      // Simulate incoming message
      const adapter = orch.channels.get('slack-main');
      await adapter.messageHandler({
        type: 'slack',
        userId: 'U123',
        channelId: 'C456',
        text: 'Hello bot!',
        isDM: false,
        threadTs: '1234567890.123456',
      });

      // Verify route was called with channelName
      assert.equal(messageRouter.route.mock.calls.length, 1);
      const routeArg = messageRouter.route.mock.calls[0].arguments[0];
      assert.equal(routeArg.channelName, 'slack-main');
      assert.equal(routeArg.userId, 'U123');
      assert.equal(routeArg.text, 'Hello bot!');

      // Verify processMessage was called
      assert.equal(messageProcessor.processMessage.mock.calls.length, 1);

      // Verify response was sent back via adapter
      assert.equal(adapter.sentMessages.length, 1);
      assert.equal(adapter.sentMessages[0].channelId, 'C456');
      assert.equal(adapter.sentMessages[0].text, 'AI response');
      assert.equal(adapter.sentMessages[0].threadTs, '1234567890.123456');

      await orch.stop();
    });

    test('does not process message when routing returns not allowed', async () => {
      const MockAdapter = createMockChannelAdapterClass();
      const mainConfig = createMainConfig({
        channels: {
          'slack-main': { type: 'slack', botToken: 'xoxb-test' },
        },
      });

      opts.configLoader.load = mock.fn(async () => mainConfig);

      const messageRouter = createMockMessageRouter({
        route: mock.fn(async () => ({
          bot: { id: 'test-bot' },
          allowed: false,
          reason: 'User not in allowlist',
        })),
      });
      const messageProcessor = createMockMessageProcessor();

      const orch = new Orchestrator({
        ...opts,
        configLoader: opts.configLoader,
        messageRouter,
        messageProcessor,
      });
      orch.registerChannelAdapter('slack', MockAdapter);

      await orch.start();

      const adapter = orch.channels.get('slack-main');
      await adapter.messageHandler({
        type: 'slack',
        userId: 'U123',
        channelId: 'C456',
        text: 'Hello!',
        isDM: false,
      });

      // processMessage should NOT have been called
      assert.equal(messageProcessor.processMessage.mock.calls.length, 0);
      // No response sent
      assert.equal(adapter.sentMessages.length, 0);

      await orch.stop();
    });

    test('does not process message when no bot found', async () => {
      const MockAdapter = createMockChannelAdapterClass();
      const mainConfig = createMainConfig({
        channels: {
          'slack-main': { type: 'slack', botToken: 'xoxb-test' },
        },
      });

      opts.configLoader.load = mock.fn(async () => mainConfig);

      const messageRouter = createMockMessageRouter({
        route: mock.fn(async () => ({
          bot: null,
          allowed: false,
          reason: 'No bot found for channel',
        })),
      });
      const messageProcessor = createMockMessageProcessor();

      const orch = new Orchestrator({
        ...opts,
        configLoader: opts.configLoader,
        messageRouter,
        messageProcessor,
      });
      orch.registerChannelAdapter('slack', MockAdapter);

      await orch.start();

      const adapter = orch.channels.get('slack-main');
      await adapter.messageHandler({
        type: 'slack',
        userId: 'U123',
        channelId: 'C456',
        text: 'Hello!',
        isDM: false,
      });

      assert.equal(messageProcessor.processMessage.mock.calls.length, 0);
      assert.equal(adapter.sentMessages.length, 0);

      await orch.stop();
    });

    test('does not send empty response text', async () => {
      const MockAdapter = createMockChannelAdapterClass();
      const mainConfig = createMainConfig({
        channels: {
          'slack-main': { type: 'slack', botToken: 'xoxb-test' },
        },
      });

      opts.configLoader.load = mock.fn(async () => mainConfig);

      const messageProcessor = createMockMessageProcessor({
        processMessage: mock.fn(async () => ({
          text: '',
          toolCalls: [],
          usage: {},
          sessionId: 'session-123',
          durationMs: 100,
        })),
      });

      const orch = new Orchestrator({
        ...opts,
        configLoader: opts.configLoader,
        messageRouter: createMockMessageRouter(),
        messageProcessor,
      });
      orch.registerChannelAdapter('slack', MockAdapter);

      await orch.start();

      const adapter = orch.channels.get('slack-main');
      await adapter.messageHandler({
        type: 'slack',
        userId: 'U123',
        channelId: 'C456',
        text: 'Hello!',
        isDM: false,
      });

      // Should not send empty response
      assert.equal(adapter.sentMessages.length, 0);

      await orch.stop();
    });

    test('catches and logs errors during message handling', async () => {
      const MockAdapter = createMockChannelAdapterClass();
      const mainConfig = createMainConfig({
        channels: {
          'slack-main': { type: 'slack', botToken: 'xoxb-test' },
        },
      });

      opts.configLoader.load = mock.fn(async () => mainConfig);

      const messageRouter = createMockMessageRouter({
        route: mock.fn(async () => {
          throw new Error('Router exploded');
        }),
      });

      const logs = [];
      const orch = new Orchestrator({
        ...opts,
        configLoader: opts.configLoader,
        messageRouter,
        messageProcessor: createMockMessageProcessor(),
        logger: msg => logs.push(msg),
      });
      orch.registerChannelAdapter('slack', MockAdapter);

      await orch.start();

      const adapter = orch.channels.get('slack-main');
      // Should not throw even though router errors
      await adapter.messageHandler({
        type: 'slack',
        userId: 'U123',
        channelId: 'C456',
        text: 'Hello!',
        isDM: false,
      });

      assert.ok(
        logs.some(l => l.includes('Error handling message') && l.includes('Router exploded')),
        'Should log error message'
      );

      await orch.stop();
    });

    test('catches and logs errors from processMessage', async () => {
      const MockAdapter = createMockChannelAdapterClass();
      const mainConfig = createMainConfig({
        channels: {
          'slack-main': { type: 'slack', botToken: 'xoxb-test' },
        },
      });

      opts.configLoader.load = mock.fn(async () => mainConfig);

      const messageProcessor = createMockMessageProcessor({
        processMessage: mock.fn(async () => {
          throw new Error('LLM API timeout');
        }),
      });

      const logs = [];
      const orch = new Orchestrator({
        ...opts,
        configLoader: opts.configLoader,
        messageRouter: createMockMessageRouter(),
        messageProcessor,
        logger: msg => logs.push(msg),
      });
      orch.registerChannelAdapter('slack', MockAdapter);

      await orch.start();

      const adapter = orch.channels.get('slack-main');
      await adapter.messageHandler({
        type: 'slack',
        userId: 'U123',
        channelId: 'C456',
        text: 'Hello!',
        isDM: false,
      });

      assert.ok(
        logs.some(l => l.includes('LLM API timeout')),
        'Should log processMessage error'
      );
      // No response sent on error
      assert.equal(adapter.sentMessages.length, 0);

      await orch.stop();
    });

    test('wires multiple channels and routes independently', async () => {
      const MockSlack = createMockChannelAdapterClass();
      const MockDiscord = createMockChannelAdapterClass();

      const mainConfig = createMainConfig({
        channels: {
          'slack-main': { type: 'slack', botToken: 'xoxb-test' },
          'discord-main': { type: 'discord', botToken: 'discord-test' },
        },
      });

      opts.configLoader.load = mock.fn(async () => mainConfig);

      const messageRouter = createMockMessageRouter();
      const messageProcessor = createMockMessageProcessor();

      const orch = new Orchestrator({
        ...opts,
        configLoader: opts.configLoader,
        messageRouter,
        messageProcessor,
      });
      orch.registerChannelAdapter('slack', MockSlack);
      orch.registerChannelAdapter('discord', MockDiscord);

      await orch.start();

      // Both channels should have handlers wired
      const slackAdapter = orch.channels.get('slack-main');
      const discordAdapter = orch.channels.get('discord-main');
      assert.ok(slackAdapter.messageHandler);
      assert.ok(discordAdapter.messageHandler);

      // Simulate message on Slack
      await slackAdapter.messageHandler({
        type: 'slack',
        userId: 'U123',
        channelId: 'C456',
        text: 'Slack message',
        isDM: false,
      });

      // Route should have been called with channelName 'slack-main'
      assert.equal(messageRouter.route.mock.calls.length, 1);
      assert.equal(messageRouter.route.mock.calls[0].arguments[0].channelName, 'slack-main');

      // Simulate message on Discord
      await discordAdapter.messageHandler({
        type: 'discord',
        userId: 'D789',
        channelId: 'DCHAN',
        text: 'Discord message',
        isDM: false,
      });

      // Route should have been called again with channelName 'discord-main'
      assert.equal(messageRouter.route.mock.calls.length, 2);
      assert.equal(messageRouter.route.mock.calls[1].arguments[0].channelName, 'discord-main');

      await orch.stop();
    });
  });

  // ===========================================================================
  // getStatus() with messageProcessor/messageRouter
  // ===========================================================================

  describe('getStatus() - message pipeline fields', () => {
    test('reports messageProcessorReady and messageRouterReady as false by default', () => {
      const status = orchestrator.getStatus();
      assert.equal(status.messageProcessorReady, false);
      assert.equal(status.messageRouterReady, false);
    });

    test('reports messageProcessorReady as true when injected', async () => {
      const orch = new Orchestrator({
        ...opts,
        messageProcessor: createMockMessageProcessor(),
      });

      const status = orch.getStatus();
      assert.equal(status.messageProcessorReady, true);
    });

    test('reports messageRouterReady as true when injected', async () => {
      const orch = new Orchestrator({
        ...opts,
        messageRouter: createMockMessageRouter(),
      });

      const status = orch.getStatus();
      assert.equal(status.messageRouterReady, true);
    });

    test('reports both ready after start with factories', async () => {
      const orch = new Orchestrator({
        ...opts,
        messageRouterFactory: () => createMockMessageRouter(),
        messageProcessorFactory: () => createMockMessageProcessor(),
      });

      await orch.start();

      const status = orch.getStatus();
      assert.equal(status.messageProcessorReady, true);
      assert.equal(status.messageRouterReady, true);

      await orch.stop();
    });
  });

  // ===========================================================================
  // SecretsManager Integration
  // ===========================================================================

  describe('secretsManager', () => {
    test('constructor accepts secretsManager option', () => {
      const mockManager = {
        resolveAll: mock.fn(),
        registerAdapter: mock.fn(),
        initialize: mock.fn(),
      };
      const orch = new Orchestrator({ ...opts, secretsManager: mockManager });
      assert.equal(orch.secretsManager, mockManager);
    });

    test('constructor defaults secretsManager to null', () => {
      const orch = new Orchestrator({ logger: null });
      assert.equal(orch.secretsManager, null);
    });

    test('constructor accepts secretsManagerFactory option', () => {
      const factory = mock.fn();
      const orch = new Orchestrator({ ...opts, secretsManagerFactory: factory });
      assert.equal(orch.secretsManagerFactory, factory);
    });

    test('wires injected secretsManager to configLoader on start', async () => {
      const mockManager = {
        resolveAll: mock.fn(async c => c),
        registerAdapter: mock.fn(),
        initialize: mock.fn(async () => {}),
        initialized: true,
      };
      const orch = new Orchestrator({ ...opts, secretsManager: mockManager });

      await orch.start();

      assert.equal(orch.configLoader.secretsManager, mockManager);
      assert.equal(orch.secretsManager, mockManager);

      await orch.stop();
    });

    test('creates secretsManager via factory when provided', async () => {
      const mockManager = {
        resolveAll: mock.fn(async c => c),
        registerAdapter: mock.fn(),
        initialize: mock.fn(async () => {}),
        initialized: true,
      };
      const factory = mock.fn(() => mockManager);

      const orch = new Orchestrator({ ...opts, secretsManagerFactory: factory });

      await orch.start();

      assert.equal(factory.mock.callCount(), 1);
      assert.equal(orch.secretsManager, mockManager);
      assert.equal(orch.configLoader.secretsManager, mockManager);

      await orch.stop();
    });

    test('auto-creates secretsManager when secrets config section exists', async () => {
      const mainConfigWithSecrets = createMainConfig({
        secrets: {
          provider: 'env',
          cache: { enabled: true, ttl: 60000 },
        },
      });

      const configLoader = createMockConfigLoader({
        mainConfig: mainConfigWithSecrets,
      });

      const orch = new Orchestrator({
        ...opts,
        configLoader,
      });

      await orch.start();

      // SecretsManager should have been created automatically
      assert.ok(orch.secretsManager);
      assert.equal(orch.configLoader.secretsManager, orch.secretsManager);

      // env adapter should be registered
      const adapterNames = orch.secretsManager.getAdapterNames();
      assert.ok(adapterNames.includes('env'));

      await orch.stop();
    });

    test('does not create secretsManager when no secrets config and no adapters', async () => {
      // Default config has no secrets section
      const orch = new Orchestrator(opts);

      await orch.start();

      assert.equal(orch.secretsManager, null);

      await orch.stop();
    });

    test('creates secretsManager when secret adapters are registered', async () => {
      const orch = new Orchestrator(opts);

      // Register a mock secret adapter
      class MockAdapter {
        async initialize() {
          this.initialized = true;
        }
        async getSecret(key) {
          return `resolved-${key}`;
        }
      }
      orch.registerSecretAdapter('mock-vault', MockAdapter);

      await orch.start();

      assert.ok(orch.secretsManager);
      const adapterNames = orch.secretsManager.getAdapterNames();
      assert.ok(adapterNames.includes('env'));
      assert.ok(adapterNames.includes('mock-vault'));

      await orch.stop();
    });

    test('secretsManager uses cache config from secrets section', async () => {
      const mainConfigWithCache = createMainConfig({
        secrets: {
          provider: 'env',
          cache: { enabled: true, ttl: 120000 },
        },
      });

      const configLoader = createMockConfigLoader({
        mainConfig: mainConfigWithCache,
      });

      const orch = new Orchestrator({
        ...opts,
        configLoader,
      });

      await orch.start();

      const stats = orch.secretsManager.getCacheStats();
      assert.ok(stats);
      assert.equal(stats.ttl, 120000);

      await orch.stop();
    });
  });

  // ===========================================================================
  // MCP Integration
  // ===========================================================================

  describe('mcpManager', () => {
    test('constructor accepts mcpManager option', () => {
      const mockMcp = { startServer: mock.fn(), stopAll: mock.fn(), getServerCount: mock.fn() };
      const orch = new Orchestrator({ ...opts, mcpManager: mockMcp });
      assert.equal(orch.mcpManager, mockMcp);
    });

    test('constructor defaults mcpManager to null', () => {
      const orch = new Orchestrator({ logger: null });
      assert.equal(orch.mcpManager, null);
    });

    test('constructor accepts mcpManagerFactory option', () => {
      const factory = mock.fn();
      const orch = new Orchestrator({ ...opts, mcpManagerFactory: factory });
      assert.equal(orch.mcpManagerFactory, factory);
    });

    test('starts MCP servers from config during startup', async () => {
      const mockMcp = {
        startServer: mock.fn(async () => ({ tools: [] })),
        stopAll: mock.fn(async () => ({ stopped: [], failed: [] })),
        getServerCount: mock.fn(() => 1),
      };

      const mainConfig = createMainConfig({
        mcpServers: {
          github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
        },
      });

      opts.configLoader.load = mock.fn(async () => mainConfig);
      const orch = new Orchestrator({
        ...opts,
        configLoader: opts.configLoader,
        mcpManager: mockMcp,
      });

      await orch.start();

      assert.equal(mockMcp.startServer.mock.calls.length, 1);
      const serverConfig = mockMcp.startServer.mock.calls[0].arguments[0];
      assert.equal(serverConfig.id, 'github');
      assert.equal(serverConfig.command, 'npx');

      await orch.stop();
    });

    test('starts multiple MCP servers', async () => {
      const mockMcp = {
        startServer: mock.fn(async () => ({ tools: [] })),
        stopAll: mock.fn(async () => ({ stopped: [], failed: [] })),
        getServerCount: mock.fn(() => 2),
      };

      const mainConfig = createMainConfig({
        mcpServers: {
          github: { command: 'npx', args: ['server-github'] },
          filesystem: { command: 'npx', args: ['server-fs'] },
        },
      });

      opts.configLoader.load = mock.fn(async () => mainConfig);
      const orch = new Orchestrator({
        ...opts,
        configLoader: opts.configLoader,
        mcpManager: mockMcp,
      });

      await orch.start();

      assert.equal(mockMcp.startServer.mock.calls.length, 2);

      await orch.stop();
    });

    test('continues startup when MCP server fails to start', async () => {
      let callCount = 0;
      const mockMcp = {
        startServer: mock.fn(async () => {
          callCount++;
          if (callCount === 1) {
            throw new Error('Server spawn failed');
          }
          return { tools: [] };
        }),
        stopAll: mock.fn(async () => ({ stopped: [], failed: [] })),
        getServerCount: mock.fn(() => 1),
      };

      const mainConfig = createMainConfig({
        mcpServers: {
          badServer: { command: 'bad-cmd' },
          goodServer: { command: 'good-cmd' },
        },
      });

      opts.configLoader.load = mock.fn(async () => mainConfig);
      const orch = new Orchestrator({
        ...opts,
        configLoader: opts.configLoader,
        mcpManager: mockMcp,
      });

      await orch.start();

      assert.equal(orch.state, 'running');
      assert.equal(mockMcp.startServer.mock.calls.length, 2);

      await orch.stop();
    });

    test('skips MCP when no mcpServers configured', async () => {
      const mockMcp = {
        startServer: mock.fn(async () => ({ tools: [] })),
        stopAll: mock.fn(async () => ({ stopped: [], failed: [] })),
        getServerCount: mock.fn(() => 0),
      };

      const orch = new Orchestrator({
        ...opts,
        mcpManager: mockMcp,
      });

      await orch.start();

      assert.equal(mockMcp.startServer.mock.calls.length, 0);

      await orch.stop();
    });

    test('creates mcpManager from factory when provided', async () => {
      const mockMcp = {
        startServer: mock.fn(async () => ({ tools: [] })),
        stopAll: mock.fn(async () => ({ stopped: [], failed: [] })),
        getServerCount: mock.fn(() => 1),
      };
      const factory = mock.fn(() => mockMcp);

      const mainConfig = createMainConfig({
        mcpServers: {
          github: { command: 'npx', args: ['server-github'] },
        },
      });

      opts.configLoader.load = mock.fn(async () => mainConfig);
      const orch = new Orchestrator({
        ...opts,
        configLoader: opts.configLoader,
        mcpManagerFactory: factory,
      });

      await orch.start();

      assert.equal(factory.mock.calls.length, 1);
      assert.equal(orch.mcpManager, mockMcp);
      assert.equal(mockMcp.startServer.mock.calls.length, 1);

      await orch.stop();
    });

    test('does not create mcpManager when no mcpServers and no DI', async () => {
      const orch = new Orchestrator(opts);

      await orch.start();

      assert.equal(orch.mcpManager, null);

      await orch.stop();
    });

    test('stops MCP servers during shutdown', async () => {
      const mockMcp = {
        startServer: mock.fn(async () => ({ tools: [] })),
        stopAll: mock.fn(async () => ({ stopped: [{ id: 'github' }], failed: [] })),
        getServerCount: mock.fn(() => 1),
      };

      const mainConfig = createMainConfig({
        mcpServers: {
          github: { command: 'npx', args: ['server-github'] },
        },
      });

      opts.configLoader.load = mock.fn(async () => mainConfig);
      const orch = new Orchestrator({
        ...opts,
        configLoader: opts.configLoader,
        mcpManager: mockMcp,
      });

      await orch.start();
      await orch.stop();

      assert.equal(mockMcp.stopAll.mock.calls.length, 1);
    });

    test('logs MCP server start failures during startup', async () => {
      const mockMcp = {
        startServer: mock.fn(async () => {
          throw new Error('Spawn failed');
        }),
        stopAll: mock.fn(async () => ({ stopped: [], failed: [] })),
        getServerCount: mock.fn(() => 0),
      };

      const mainConfig = createMainConfig({
        mcpServers: {
          github: { command: 'npx', args: ['server-github'] },
        },
      });

      opts.configLoader.load = mock.fn(async () => mainConfig);
      const logs = [];
      const orch = new Orchestrator({
        ...opts,
        configLoader: opts.configLoader,
        mcpManager: mockMcp,
        logger: msg => logs.push(msg),
      });

      await orch.start();

      assert.ok(logs.some(l => l.includes('Failed to start MCP server')));
      assert.ok(logs.some(l => l.includes('0/1 MCP server(s) started')));

      await orch.stop();
    });

    test('getStatus() includes mcpServerCount', async () => {
      const mockMcp = {
        startServer: mock.fn(async () => ({ tools: [] })),
        stopAll: mock.fn(async () => ({ stopped: [], failed: [] })),
        getServerCount: mock.fn(() => 2),
      };

      const orch = new Orchestrator({
        ...opts,
        mcpManager: mockMcp,
      });

      await orch.start();

      const status = orch.getStatus();
      assert.equal(status.mcpServerCount, 2);

      await orch.stop();
    });

    test('getStatus() returns 0 for mcpServerCount when no mcpManager', () => {
      const status = orchestrator.getStatus();
      assert.equal(status.mcpServerCount, 0);
    });
  });

  // ===========================================================================
  // Queue Integration
  // ===========================================================================

  describe('queue integration', () => {
    /**
     * Create a mock MessageQueue
     * @param {Object} [overrides={}] - Override defaults
     * @returns {Object} Mock MessageQueue
     */
    function createMockMessageQueue(overrides = {}) {
      return {
        enqueue: mock.fn(async () => ({
          id: 1,
          botId: 'test-bot',
          status: 'pending',
          enqueuedAt: new Date(),
        })),
        dequeue: mock.fn(async () => null),
        getQueueDepth: mock.fn(async () => 0),
        clearQueue: mock.fn(async () => 0),
        markCompleted: mock.fn(async () => true),
        markFailed: mock.fn(async () => true),
        getStats: mock.fn(async () => ({
          pending: 0,
          processing: 0,
          completed: 0,
          failed: 0,
        })),
        ...overrides,
      };
    }

    /**
     * Create a mock QueueWorker
     * @param {Object} [overrides={}] - Override defaults
     * @returns {Object} Mock QueueWorker
     */
    function createMockQueueWorker(overrides = {}) {
      let state = 'stopped';
      return {
        start: mock.fn(async () => {
          state = 'running';
        }),
        stop: mock.fn(async () => {
          state = 'stopped';
        }),
        getState: mock.fn(() => state),
        processNext: mock.fn(async () => false),
        ...overrides,
      };
    }

    /**
     * Create a mock ConcurrencyController
     * @param {Object} [overrides={}] - Override defaults
     * @returns {Object} Mock ConcurrencyController
     */
    function createMockConcurrencyController(overrides = {}) {
      return {
        canProcess: mock.fn(() => true),
        startProcessing: mock.fn(),
        finishProcessing: mock.fn(() => true),
        getActiveCount: mock.fn(() => 0),
        reset: mock.fn(),
        getSummary: mock.fn(() => ({ bots: {}, total: 0 })),
        ...overrides,
      };
    }

    test('constructor accepts queue-related options', () => {
      const mq = createMockMessageQueue();
      const qw = createMockQueueWorker();
      const cc = createMockConcurrencyController();
      const orch = new Orchestrator({
        ...opts,
        messageQueue: mq,
        queueWorker: qw,
        concurrencyController: cc,
      });

      assert.equal(orch.messageQueue, mq);
      assert.equal(orch.queueWorker, qw);
      assert.equal(orch.concurrencyController, cc);
    });

    test('constructor defaults queue properties to null', () => {
      const orch = new Orchestrator({ logger: null });
      assert.equal(orch.messageQueue, null);
      assert.equal(orch.queueWorker, null);
      assert.equal(orch.concurrencyController, null);
    });

    test('constructor accepts queue factory options', () => {
      const mqFactory = mock.fn();
      const qwFactory = mock.fn();
      const ccFactory = mock.fn();
      const orch = new Orchestrator({
        ...opts,
        messageQueueFactory: mqFactory,
        queueWorkerFactory: qwFactory,
        concurrencyControllerFactory: ccFactory,
      });

      assert.equal(orch.messageQueueFactory, mqFactory);
      assert.equal(orch.queueWorkerFactory, qwFactory);
      assert.equal(orch.concurrencyControllerFactory, ccFactory);
    });

    test('starts queue worker when queue is enabled', async () => {
      const qw = createMockQueueWorker();
      const mq = createMockMessageQueue();
      const cc = createMockConcurrencyController();

      const mainConfig = createMainConfig({
        queue: { enabled: true, maxConcurrentPerBot: 5 },
      });
      const configLoader = createMockConfigLoader({ mainConfig });

      const orch = new Orchestrator({
        ...opts,
        configLoader,
        messageQueue: mq,
        queueWorker: qw,
        concurrencyController: cc,
        messageProcessor: createMockMessageProcessor(),
      });

      await orch.start();

      assert.equal(qw.start.mock.calls.length, 1);
      assert.equal(qw.getState(), 'running');

      await orch.stop();
    });

    test('does not start queue worker when queue is disabled', async () => {
      const qw = createMockQueueWorker();

      const mainConfig = createMainConfig({
        queue: { enabled: false },
      });
      const configLoader = createMockConfigLoader({ mainConfig });

      const orch = new Orchestrator({
        ...opts,
        configLoader,
        queueWorker: qw,
        messageProcessor: createMockMessageProcessor(),
      });

      await orch.start();

      assert.equal(qw.start.mock.calls.length, 0);

      await orch.stop();
    });

    test('does not start queue worker when no queue config', async () => {
      const qw = createMockQueueWorker();

      const orch = new Orchestrator({
        ...opts,
        queueWorker: qw,
        messageProcessor: createMockMessageProcessor(),
      });

      await orch.start();

      assert.equal(qw.start.mock.calls.length, 0);

      await orch.stop();
    });

    test('stops queue worker during shutdown', async () => {
      const qw = createMockQueueWorker();
      const cc = createMockConcurrencyController();

      const mainConfig = createMainConfig({
        queue: { enabled: true },
      });
      const configLoader = createMockConfigLoader({ mainConfig });

      const orch = new Orchestrator({
        ...opts,
        configLoader,
        messageQueue: createMockMessageQueue(),
        queueWorker: qw,
        concurrencyController: cc,
        messageProcessor: createMockMessageProcessor(),
      });

      await orch.start();
      await orch.stop();

      assert.equal(qw.stop.mock.calls.length, 1);
      assert.equal(cc.reset.mock.calls.length, 1);
    });

    test('skips queue worker stop when no worker exists', async () => {
      // No queue configured, no worker
      const orch = new Orchestrator(opts);

      await orch.start();
      await orch.stop();

      assert.equal(orch.state, 'stopped');
    });

    test('queue worker failure does not block startup', async () => {
      const qw = createMockQueueWorker({
        start: mock.fn(async () => {
          throw new Error('LISTEN failed');
        }),
      });

      const mainConfig = createMainConfig({
        queue: { enabled: true },
      });
      const configLoader = createMockConfigLoader({ mainConfig });

      const logs = [];
      const orch = new Orchestrator({
        ...opts,
        configLoader,
        messageQueue: createMockMessageQueue(),
        queueWorker: qw,
        concurrencyController: createMockConcurrencyController(),
        messageProcessor: createMockMessageProcessor(),
        logger: msg => logs.push(msg),
      });

      await orch.start();

      assert.equal(orch.state, 'running');
      assert.ok(logs.some(l => l.includes('Failed to start queue worker')));

      await orch.stop();
    });

    test('creates queue components from factories when not injected', async () => {
      const mq = createMockMessageQueue();
      const cc = createMockConcurrencyController();
      const qw = createMockQueueWorker();

      const mqFactory = mock.fn(() => mq);
      const ccFactory = mock.fn(() => cc);
      const qwFactory = mock.fn(() => qw);

      const mainConfig = createMainConfig({
        queue: { enabled: true, maxConcurrentPerBot: 5 },
      });
      const configLoader = createMockConfigLoader({ mainConfig });

      const orch = new Orchestrator({
        ...opts,
        configLoader,
        messageProcessor: createMockMessageProcessor(),
        messageQueueFactory: mqFactory,
        queueWorkerFactory: qwFactory,
        concurrencyControllerFactory: ccFactory,
      });

      await orch.start();

      assert.equal(mqFactory.mock.calls.length, 1);
      assert.equal(ccFactory.mock.calls.length, 1);
      assert.equal(qwFactory.mock.calls.length, 1);
      assert.equal(orch.messageQueue, mq);
      assert.equal(orch.concurrencyController, cc);
      assert.equal(orch.queueWorker, qw);
      assert.equal(qw.start.mock.calls.length, 1);

      await orch.stop();
    });

    test('skips queue when enabled but no storage', async () => {
      const mainConfig = createMainConfig({
        queue: { enabled: true },
      });
      const configLoader = createMockConfigLoader({ mainConfig });

      const logs = [];
      const orch = new Orchestrator({
        logger: msg => logs.push(msg),
        configLoader,
        configValidator: opts.configValidator,
        botManager: opts.botManager,
        migrationRunner: opts.migrationRunner,
        // no storage
        messageProcessor: createMockMessageProcessor(),
      });

      await orch.start();

      assert.equal(orch.state, 'running');
      assert.ok(logs.some(l => l.includes('no storage configured')));

      await orch.stop();
    });

    test('skips queue when enabled but no MessageProcessor', async () => {
      const mainConfig = createMainConfig({
        queue: { enabled: true },
      });
      const configLoader = createMockConfigLoader({ mainConfig });

      const logs = [];
      const orch = new Orchestrator({
        ...opts,
        configLoader,
        // no messageProcessor
        logger: msg => logs.push(msg),
      });

      await orch.start();

      assert.equal(orch.state, 'running');
      assert.ok(logs.some(l => l.includes('no MessageProcessor')));

      await orch.stop();
    });

    test('getStatus() reports queueEnabled and queueWorkerRunning', async () => {
      const qw = createMockQueueWorker();

      const mainConfig = createMainConfig({
        queue: { enabled: true },
      });
      const configLoader = createMockConfigLoader({ mainConfig });

      const orch = new Orchestrator({
        ...opts,
        configLoader,
        messageQueue: createMockMessageQueue(),
        queueWorker: qw,
        concurrencyController: createMockConcurrencyController(),
        messageProcessor: createMockMessageProcessor(),
      });

      await orch.start();

      const status = orch.getStatus();
      assert.equal(status.queueEnabled, true);
      assert.equal(status.queueWorkerRunning, true);

      await orch.stop();
    });

    test('getStatus() reports queueEnabled false when no queue config', () => {
      const status = orchestrator.getStatus();
      assert.equal(status.queueEnabled, false);
      assert.equal(status.queueWorkerRunning, false);
    });
  });

  // ===========================================================================
  // _handleChannelMessage() with queue
  // ===========================================================================

  describe('_handleChannelMessage() with queue', () => {
    test('enqueues message when queue is enabled instead of direct processing', async () => {
      const MockAdapter = createMockChannelAdapterClass();
      const messageQueue = {
        enqueue: mock.fn(async () => ({
          id: 1,
          botId: 'test-bot',
          status: 'pending',
        })),
      };

      const mainConfig = createMainConfig({
        channels: {
          'slack-main': { type: 'slack', botToken: 'xoxb-test' },
        },
        queue: { enabled: true, defaultPriority: 5 },
      });

      const configLoader = createMockConfigLoader({ mainConfig });
      const messageRouter = createMockMessageRouter();
      const messageProcessor = createMockMessageProcessor();

      // Create QueueWorker mock that doesn't need storage
      const queueWorker = {
        start: mock.fn(async () => {}),
        stop: mock.fn(async () => {}),
        getState: mock.fn(() => 'running'),
      };

      const orch = new Orchestrator({
        ...opts,
        configLoader,
        messageRouter,
        messageProcessor,
        messageQueue,
        queueWorker,
        concurrencyController: {
          canProcess: mock.fn(() => true),
          reset: mock.fn(),
        },
      });
      orch.registerChannelAdapter('slack', MockAdapter);

      await orch.start();

      const adapter = orch.channels.get('slack-main');
      await adapter.messageHandler({
        type: 'slack',
        userId: 'U123',
        channelId: 'C456',
        text: 'Hello bot!',
        isDM: false,
      });

      // Should have enqueued, not processed directly
      assert.equal(messageQueue.enqueue.mock.calls.length, 1);
      const [botId, msg, priority] = messageQueue.enqueue.mock.calls[0].arguments;
      assert.equal(botId, 'test-bot');
      assert.equal(msg.channelType, 'slack');
      assert.equal(msg.channelId, 'C456');
      assert.equal(msg.userId, 'U123');
      assert.equal(msg.text, 'Hello bot!');
      assert.equal(msg.channelName, 'slack-main');
      assert.equal(priority, 5);

      // processMessage should NOT have been called (queue handles it)
      assert.equal(messageProcessor.processMessage.mock.calls.length, 0);

      // No response sent directly (queue worker will handle response)
      assert.equal(adapter.sentMessages.length, 0);

      await orch.stop();
    });

    test('processes directly when queue is disabled', async () => {
      const MockAdapter = createMockChannelAdapterClass();
      const mainConfig = createMainConfig({
        channels: {
          'slack-main': { type: 'slack', botToken: 'xoxb-test' },
        },
        // No queue config
      });

      const configLoader = createMockConfigLoader({ mainConfig });
      const messageRouter = createMockMessageRouter();
      const messageProcessor = createMockMessageProcessor();

      const orch = new Orchestrator({
        ...opts,
        configLoader,
        messageRouter,
        messageProcessor,
      });
      orch.registerChannelAdapter('slack', MockAdapter);

      await orch.start();

      const adapter = orch.channels.get('slack-main');
      await adapter.messageHandler({
        type: 'slack',
        userId: 'U123',
        channelId: 'C456',
        text: 'Hello!',
        isDM: false,
      });

      // Should have processed directly
      assert.equal(messageProcessor.processMessage.mock.calls.length, 1);
      assert.equal(adapter.sentMessages.length, 1);

      await orch.stop();
    });

    test('falls back to direct processing when queue enabled but no messageQueue', async () => {
      const MockAdapter = createMockChannelAdapterClass();
      const mainConfig = createMainConfig({
        channels: {
          'slack-main': { type: 'slack', botToken: 'xoxb-test' },
        },
        queue: { enabled: true },
      });

      const configLoader = createMockConfigLoader({ mainConfig });
      const messageRouter = createMockMessageRouter();
      const messageProcessor = createMockMessageProcessor();

      const orch = new Orchestrator({
        ...opts,
        configLoader,
        messageRouter,
        messageProcessor,
      });
      orch.registerChannelAdapter('slack', MockAdapter);

      await orch.start();

      // Force messageQueue to null AFTER start to simulate queue startup failure
      // (the handler should fall through to direct processing)
      orch.messageQueue = null;

      const adapter = orch.channels.get('slack-main');
      await adapter.messageHandler({
        type: 'slack',
        userId: 'U123',
        channelId: 'C456',
        text: 'Hello!',
        isDM: false,
      });

      // Should fall through to direct processing
      assert.equal(messageProcessor.processMessage.mock.calls.length, 1);

      await orch.stop();
    });

    test('logs enqueue and does not send response back when queueing', async () => {
      const MockAdapter = createMockChannelAdapterClass();
      const messageQueue = {
        enqueue: mock.fn(async () => ({
          id: 1,
          botId: 'test-bot',
          status: 'pending',
        })),
      };

      const mainConfig = createMainConfig({
        channels: {
          'slack-main': { type: 'slack', botToken: 'xoxb-test' },
        },
        queue: { enabled: true },
      });

      const configLoader = createMockConfigLoader({ mainConfig });
      const logs = [];

      const queueWorker = {
        start: mock.fn(async () => {}),
        stop: mock.fn(async () => {}),
        getState: mock.fn(() => 'running'),
      };

      const orch = new Orchestrator({
        ...opts,
        configLoader,
        messageRouter: createMockMessageRouter(),
        messageProcessor: createMockMessageProcessor(),
        messageQueue,
        queueWorker,
        concurrencyController: { canProcess: mock.fn(() => true), reset: mock.fn() },
        logger: msg => logs.push(msg),
      });
      orch.registerChannelAdapter('slack', MockAdapter);

      await orch.start();

      const adapter = orch.channels.get('slack-main');
      await adapter.messageHandler({
        type: 'slack',
        userId: 'U123',
        channelId: 'C456',
        text: 'Queued message',
        isDM: false,
      });

      // Check that enqueue log was emitted
      assert.ok(logs.some(l => l.includes('Enqueued message')));
      // No response sent
      assert.equal(adapter.sentMessages.length, 0);

      await orch.stop();
    });
  });

  // ===========================================================================
  // ChannelManager Integration
  // ===========================================================================

  describe('ChannelManager integration', () => {
    test('constructor accepts channelManager option', () => {
      const mockChannelManager = {
        registerAdapter: mock.fn(),
        initializeChannel: mock.fn(),
        listChannels: mock.fn(() => []),
        getChannelCount: mock.fn(() => 0),
        getChannelStats: mock.fn(() => ({ total: 0, byStatus: {}, channels: [] })),
        stopAll: mock.fn(async () => ({ stopped: [], failed: [] })),
      };
      const orch = new Orchestrator({ ...opts, channelManager: mockChannelManager });
      assert.equal(orch.channelManager, mockChannelManager);
    });

    test('constructor defaults channelManager to null', () => {
      const orch = new Orchestrator({ logger: null });
      assert.equal(orch.channelManager, null);
    });

    test('constructor defaults healthCheckInterval to 30000', () => {
      const orch = new Orchestrator({ logger: null });
      assert.equal(orch.healthCheckInterval, 30000);
    });

    test('constructor accepts custom healthCheckInterval', () => {
      const orch = new Orchestrator({ logger: null, healthCheckInterval: 10000 });
      assert.equal(orch.healthCheckInterval, 10000);
    });

    test('constructor accepts healthCheckInterval of 0 to disable', () => {
      const orch = new Orchestrator({ logger: null, healthCheckInterval: 0 });
      assert.equal(orch.healthCheckInterval, 0);
    });

    test('creates ChannelManager during channel initialization', async () => {
      const MockAdapter = createMockChannelAdapterClass();
      const mainConfig = createMainConfig({
        channels: {
          'slack-main': { type: 'slack', botToken: 'xoxb-test' },
        },
      });

      opts.configLoader.load = mock.fn(async () => mainConfig);

      const orch = new Orchestrator({
        ...opts,
        configLoader: opts.configLoader,
        healthCheckInterval: 0,
      });
      orch.registerChannelAdapter('slack', MockAdapter);

      await orch.start();

      // ChannelManager should have been created
      assert.ok(orch.channelManager);
      assert.equal(orch.channelManager.getChannelCount(), 1);
      // backward-compat channels map should still be populated
      assert.equal(orch.channels.size, 1);

      await orch.stop();
    });

    test('creates ChannelManager from factory when provided', async () => {
      const MockAdapter = createMockChannelAdapterClass();
      const mockChannelManager = {
        adapterTypes: new Map(),
        registerAdapter: mock.fn((type, cls) => {
          mockChannelManager.adapterTypes.set(type, cls);
        }),
        initializeChannel: mock.fn(async (name, config) => {
          const adapter = new (mockChannelManager.adapterTypes.get(config.type))();
          await adapter.initialize(config);
          return { name, config, adapter, status: 'ready', createdAt: new Date() };
        }),
        getChannel: mock.fn(name => {
          const AdapterClass = mockChannelManager.adapterTypes.get('slack');
          if (AdapterClass) {
            const adapter = new AdapterClass();
            return { name, adapter, status: 'ready' };
          }
          return undefined;
        }),
        listChannels: mock.fn(() => []),
        getChannelCount: mock.fn(() => 1),
        getChannelStats: mock.fn(() => ({ total: 1, byStatus: { ready: 1 }, channels: [] })),
        stopAll: mock.fn(async () => ({ stopped: ['slack-main'], failed: [] })),
      };

      const factory = mock.fn(() => mockChannelManager);

      const mainConfig = createMainConfig({
        channels: {
          'slack-main': { type: 'slack', botToken: 'xoxb-test' },
        },
      });

      opts.configLoader.load = mock.fn(async () => mainConfig);

      const orch = new Orchestrator({
        ...opts,
        configLoader: opts.configLoader,
        channelManagerFactory: factory,
        healthCheckInterval: 0,
      });
      orch.registerChannelAdapter('slack', MockAdapter);

      await orch.start();

      assert.equal(factory.mock.calls.length, 1);
      assert.equal(orch.channelManager, mockChannelManager);

      await orch.stop();
    });

    test('uses ChannelManager.stopAll() during shutdown', async () => {
      const MockAdapter = createMockChannelAdapterClass();
      const mainConfig = createMainConfig({
        channels: {
          'slack-main': { type: 'slack', botToken: 'xoxb-test' },
        },
      });

      opts.configLoader.load = mock.fn(async () => mainConfig);

      const orch = new Orchestrator({
        ...opts,
        configLoader: opts.configLoader,
        healthCheckInterval: 0,
      });
      orch.registerChannelAdapter('slack', MockAdapter);

      await orch.start();

      const stopAllSpy = mock.fn(orch.channelManager.stopAll.bind(orch.channelManager));
      orch.channelManager.stopAll = stopAllSpy;

      await orch.stop();

      assert.equal(stopAllSpy.mock.calls.length, 1);
      assert.equal(orch.channels.size, 0);
    });

    test('getStatus() includes channelStats when ChannelManager is available', async () => {
      const MockAdapter = createMockChannelAdapterClass();
      const mainConfig = createMainConfig({
        channels: {
          'slack-main': { type: 'slack', botToken: 'xoxb-test' },
        },
      });

      opts.configLoader.load = mock.fn(async () => mainConfig);

      const orch = new Orchestrator({
        ...opts,
        configLoader: opts.configLoader,
        healthCheckInterval: 0,
      });
      orch.registerChannelAdapter('slack', MockAdapter);

      await orch.start();

      const status = orch.getStatus();
      assert.ok(status.channelStats);
      assert.equal(status.channelStats.total, 1);
      assert.equal(status.channelCount, 1);

      await orch.stop();
    });

    test('getStatus() returns null channelStats without ChannelManager', () => {
      const status = orchestrator.getStatus();
      assert.equal(status.channelStats, null);
    });

    test('getStatus() includes healthMonitorActive flag', () => {
      const status = orchestrator.getStatus();
      assert.equal(status.healthMonitorActive, false);
    });
  });

  // ===========================================================================
  // Health Monitor
  // ===========================================================================

  describe('health monitor', () => {
    test('does not start health monitor when healthCheckInterval is 0', async () => {
      const MockAdapter = createMockChannelAdapterClass();
      const mainConfig = createMainConfig({
        channels: {
          'slack-main': { type: 'slack', botToken: 'xoxb-test' },
        },
      });

      opts.configLoader.load = mock.fn(async () => mainConfig);

      const orch = new Orchestrator({
        ...opts,
        configLoader: opts.configLoader,
        healthCheckInterval: 0,
      });
      orch.registerChannelAdapter('slack', MockAdapter);

      await orch.start();

      assert.equal(orch._healthCheckTimer, null);

      await orch.stop();
    });

    test('stops health monitor during shutdown', async () => {
      const MockAdapter = createMockChannelAdapterClass();
      const mainConfig = createMainConfig({
        channels: {
          'slack-main': { type: 'slack', botToken: 'xoxb-test' },
        },
      });

      opts.configLoader.load = mock.fn(async () => mainConfig);

      const orch = new Orchestrator({
        ...opts,
        configLoader: opts.configLoader,
        healthCheckInterval: 60000, // Long interval so it doesn't fire
      });
      orch.registerChannelAdapter('slack', MockAdapter);

      await orch.start();

      assert.ok(orch._healthCheckTimer !== null, 'Health timer should be active');

      await orch.stop();

      assert.equal(orch._healthCheckTimer, null, 'Health timer should be cleared after stop');
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
