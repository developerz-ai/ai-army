/**
 * Unit tests for BotManager
 *
 * Tests bot lifecycle management: loading, starting, stopping, reloading,
 * config validation, soul loading, and container management.
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { BotManager, BotManagerError, BOT_STATUSES } from '../../../src/core/bot-manager.js';

/**
 * Create a valid bot config for testing
 * @param {Object} [overrides={}] - Override default config values
 * @returns {Object} Bot configuration
 */
function createBotConfig(overrides = {}) {
  return {
    id: 'test-bot',
    soul: './bots/test-bot/soul.md',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    name: 'Test Bot',
    description: 'A test bot',
    tools: ['bash', 'readFile'],
    sandbox: {
      type: 'docker',
      image: 'node:22-slim',
      memory: '2g',
      cpus: 2,
      packages: ['git'],
    },
    workspace: { root: './data/test-bot' },
    ...overrides,
  };
}

/**
 * Create a mock storage object
 * @param {Object} [overrides={}] - Override default mock implementations
 * @returns {Object} Mock storage
 */
function createMockStorage(overrides = {}) {
  return {
    query: mock.fn(async () => ({ rows: [] })),
    transaction: mock.fn(async fn => fn({ query: mock.fn(async () => ({ rows: [] })) })),
    ...overrides,
  };
}

/**
 * Create a mock ContainerPool
 * @param {Object} [overrides={}] - Override default mock implementations
 * @returns {Object} Mock ContainerPool
 */
function createMockContainerPool(overrides = {}) {
  const containers = new Map();
  return {
    initializeContainer: mock.fn(async (botId, _config, _workspace) => {
      const container = { id: `container-${botId}`, botId };
      containers.set(botId, container);
      return container;
    }),
    recycleContainer: mock.fn(async botId => {
      containers.delete(botId);
    }),
    getContainer: mock.fn(async botId => {
      if (!containers.has(botId)) {
        throw new Error(`Container not initialized for bot ${botId}`);
      }
      return containers.get(botId);
    }),
    hasContainer: mock.fn(botId => containers.has(botId)),
    cleanup: mock.fn(async () => {
      containers.clear();
    }),
    _containers: containers,
    ...overrides,
  };
}

/**
 * Create a mock SoulLoader
 * @param {Object} [overrides={}] - Override default mock implementations
 * @returns {Object} Mock SoulLoader
 */
function createMockSoulLoader(overrides = {}) {
  return {
    load: mock.fn(async (_filePath, _variables) => 'You are a helpful test bot.'),
    loadSoulFile: mock.fn(async () => 'You are a helpful test bot.'),
    interpolateVariables: mock.fn(content => content),
    ...overrides,
  };
}

/**
 * Create a mock ConfigValidator
 * @param {Object} [overrides={}] - Override default mock implementations
 * @returns {Object} Mock ConfigValidator
 */
function createMockConfigValidator(overrides = {}) {
  return {
    validateBotConfig: mock.fn(config => ({
      ...config,
      enabled: config.enabled ?? true,
      tools: config.tools || [],
      mcpServers: config.mcpServers || [],
      skills: config.skills || [],
      maxSteps: config.maxSteps || 30,
      sessionPer: config.sessionPer || 'user',
      compactionThreshold: config.compactionThreshold || 50000,
    })),
    ...overrides,
  };
}

describe('BotManager', () => {
  let botManager;
  let mockStorage;
  let mockContainerPool;
  let mockSoulLoader;
  let mockValidator;

  beforeEach(() => {
    mockStorage = createMockStorage();
    mockContainerPool = createMockContainerPool();
    mockSoulLoader = createMockSoulLoader();
    mockValidator = createMockConfigValidator();
    botManager = new BotManager(mockStorage, mockContainerPool, mockSoulLoader, {
      configValidator: mockValidator,
    });
  });

  describe('constructor', () => {
    test('creates instance with required dependencies', () => {
      const manager = new BotManager(mockStorage, mockContainerPool, mockSoulLoader);
      assert.ok(manager);
      assert.ok(manager.bots instanceof Map);
      assert.equal(manager.bots.size, 0);
    });

    test('accepts custom configValidator via options', () => {
      const manager = new BotManager(mockStorage, mockContainerPool, mockSoulLoader, {
        configValidator: mockValidator,
      });
      assert.equal(manager.configValidator, mockValidator);
    });

    test('creates default ConfigValidator when not provided', () => {
      const manager = new BotManager(mockStorage, mockContainerPool, mockSoulLoader);
      assert.ok(manager.configValidator);
      assert.equal(typeof manager.configValidator.validateBotConfig, 'function');
    });

    test('throws BotManagerError when storage is missing', () => {
      assert.throws(
        () => new BotManager(null, mockContainerPool, mockSoulLoader),
        err => {
          assert.equal(err.name, 'BotManagerError');
          assert.match(err.message, /Storage is required/);
          assert.equal(err.operation, 'constructor');
          return true;
        }
      );
    });

    test('throws BotManagerError when containerPool is missing', () => {
      assert.throws(
        () => new BotManager(mockStorage, null, mockSoulLoader),
        err => {
          assert.equal(err.name, 'BotManagerError');
          assert.match(err.message, /ContainerPool is required/);
          assert.equal(err.operation, 'constructor');
          return true;
        }
      );
    });

    test('throws BotManagerError when soulLoader is missing', () => {
      assert.throws(
        () => new BotManager(mockStorage, mockContainerPool, null),
        err => {
          assert.equal(err.name, 'BotManagerError');
          assert.match(err.message, /SoulLoader is required/);
          assert.equal(err.operation, 'constructor');
          return true;
        }
      );
    });
  });

  describe('loadBot()', () => {
    test('loads a bot with valid config', async () => {
      const config = createBotConfig();
      const bot = await botManager.loadBot('test-bot', config);

      assert.equal(bot.id, 'test-bot');
      assert.equal(bot.status, 'loaded');
      assert.equal(bot.soulContent, 'You are a helpful test bot.');
      assert.ok(bot.config);
      assert.equal(bot.container, null);
      assert.ok(bot.createdAt instanceof Date);
      assert.ok(bot.lastActiveAt instanceof Date);
    });

    test('validates config using ConfigValidator', async () => {
      const config = createBotConfig();
      await botManager.loadBot('test-bot', config);

      assert.equal(mockValidator.validateBotConfig.mock.calls.length, 1);
      const passedConfig = mockValidator.validateBotConfig.mock.calls[0].arguments[0];
      assert.equal(passedConfig.id, 'test-bot');
    });

    test('ensures config id matches botId parameter', async () => {
      const config = createBotConfig({ id: 'old-id' });
      await botManager.loadBot('correct-id', config);

      const passedConfig = mockValidator.validateBotConfig.mock.calls[0].arguments[0];
      assert.equal(passedConfig.id, 'correct-id');
    });

    test('loads soul content via SoulLoader', async () => {
      const config = createBotConfig({ soul: './bots/my-bot/soul.md' });
      await botManager.loadBot('my-bot', config);

      assert.equal(mockSoulLoader.load.mock.calls.length, 1);
      const [filePath, variables] = mockSoulLoader.load.mock.calls[0].arguments;
      assert.equal(filePath, './bots/my-bot/soul.md');
      assert.equal(variables.botId, 'my-bot');
      assert.equal(variables.botName, 'Test Bot');
    });

    test('uses botId as botName when name not provided', async () => {
      const config = createBotConfig();
      delete config.name;
      await botManager.loadBot('my-bot', config);

      const variables = mockSoulLoader.load.mock.calls[0].arguments[1];
      assert.equal(variables.botName, 'my-bot');
    });

    test('stores bot in internal Map', async () => {
      const config = createBotConfig();
      await botManager.loadBot('test-bot', config);

      assert.equal(botManager.bots.size, 1);
      assert.ok(botManager.bots.has('test-bot'));
    });

    test('overwrites existing bot with same id', async () => {
      const config1 = createBotConfig({ name: 'First Bot' });
      const config2 = createBotConfig({ name: 'Second Bot' });

      await botManager.loadBot('test-bot', config1);
      await botManager.loadBot('test-bot', config2);

      assert.equal(botManager.bots.size, 1);
      const bot = botManager.getBot('test-bot');
      assert.equal(bot.config.name, 'Second Bot');
    });

    test('loads multiple bots', async () => {
      await botManager.loadBot('bot-1', createBotConfig({ soul: './s1.md' }));
      await botManager.loadBot('bot-2', createBotConfig({ soul: './s2.md' }));
      await botManager.loadBot('bot-3', createBotConfig({ soul: './s3.md' }));

      assert.equal(botManager.bots.size, 3);
    });

    test('throws BotManagerError when botId is empty', async () => {
      await assert.rejects(
        () => botManager.loadBot('', createBotConfig()),
        err => {
          assert.equal(err.name, 'BotManagerError');
          assert.match(err.message, /Bot ID must be a non-empty string/);
          assert.equal(err.operation, 'loadBot');
          return true;
        }
      );
    });

    test('throws BotManagerError when botId is null', async () => {
      await assert.rejects(
        () => botManager.loadBot(null, createBotConfig()),
        err => {
          assert.equal(err.name, 'BotManagerError');
          assert.match(err.message, /Bot ID must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws BotManagerError when botId is not a string', async () => {
      await assert.rejects(
        () => botManager.loadBot(123, createBotConfig()),
        err => {
          assert.equal(err.name, 'BotManagerError');
          assert.match(err.message, /Bot ID must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws BotManagerError when config is null', async () => {
      await assert.rejects(
        () => botManager.loadBot('test-bot', null),
        err => {
          assert.equal(err.name, 'BotManagerError');
          assert.match(err.message, /Bot config must be a non-null object/);
          assert.equal(err.operation, 'loadBot');
          assert.equal(err.botId, 'test-bot');
          return true;
        }
      );
    });

    test('throws BotManagerError when config is not an object', async () => {
      await assert.rejects(
        () => botManager.loadBot('test-bot', 'invalid'),
        err => {
          assert.equal(err.name, 'BotManagerError');
          assert.match(err.message, /Bot config must be a non-null object/);
          return true;
        }
      );
    });

    test('throws BotManagerError when config validation fails', async () => {
      const { ConfigValidationError } = await import('../../../src/config/ConfigValidator.js');
      mockValidator.validateBotConfig = mock.fn(() => {
        throw new ConfigValidationError('Invalid config', {
          errors: [{ path: 'model', message: 'Model name is required' }],
        });
      });

      await assert.rejects(
        () => botManager.loadBot('test-bot', createBotConfig()),
        err => {
          assert.equal(err.name, 'BotManagerError');
          assert.match(err.message, /config validation failed/);
          assert.equal(err.operation, 'loadBot');
          assert.equal(err.botId, 'test-bot');
          assert.ok(err.cause);
          return true;
        }
      );
    });

    test('throws BotManagerError when soul loading fails', async () => {
      mockSoulLoader.load = mock.fn(async () => {
        throw new Error('Soul file not found');
      });

      await assert.rejects(
        () => botManager.loadBot('test-bot', createBotConfig()),
        err => {
          assert.equal(err.name, 'BotManagerError');
          assert.match(err.message, /Failed to load soul/);
          assert.equal(err.operation, 'loadBot');
          assert.equal(err.botId, 'test-bot');
          assert.ok(err.cause);
          return true;
        }
      );
    });

    test('sets empty soul content when no soul path in config', async () => {
      // Override validator to return config without soul
      mockValidator.validateBotConfig = mock.fn(config => ({
        ...config,
        soul: '',
        enabled: true,
        tools: [],
        mcpServers: [],
        skills: [],
        maxSteps: 30,
        sessionPer: 'user',
        compactionThreshold: 50000,
      }));

      const config = createBotConfig({ soul: '' });
      const bot = await botManager.loadBot('test-bot', config);

      assert.equal(bot.soulContent, '');
      assert.equal(mockSoulLoader.load.mock.calls.length, 0);
    });
  });

  describe('startBot()', () => {
    test('starts a loaded bot', async () => {
      await botManager.loadBot('test-bot', createBotConfig());
      await botManager.startBot('test-bot');

      const bot = botManager.getBot('test-bot');
      assert.equal(bot.status, 'running');
      assert.ok(bot.container);
      assert.equal(bot.container.botId, 'test-bot');
    });

    test('creates container via ContainerPool', async () => {
      await botManager.loadBot('test-bot', createBotConfig());
      await botManager.startBot('test-bot');

      assert.equal(mockContainerPool.initializeContainer.mock.calls.length, 1);
      const [botId, config, workspace] =
        mockContainerPool.initializeContainer.mock.calls[0].arguments;
      assert.equal(botId, 'test-bot');
      assert.ok(config);
      assert.ok(workspace);
    });

    test('uses workspace from config', async () => {
      const config = createBotConfig({ workspace: { root: '/custom/workspace' } });
      await botManager.loadBot('test-bot', config);
      await botManager.startBot('test-bot');

      const workspace = mockContainerPool.initializeContainer.mock.calls[0].arguments[2];
      assert.equal(workspace.root, '/custom/workspace');
    });

    test('uses default workspace when not in config', async () => {
      // Override validator to return config without workspace
      mockValidator.validateBotConfig = mock.fn(config => ({
        ...config,
        enabled: true,
        tools: config.tools || [],
        mcpServers: config.mcpServers || [],
        skills: config.skills || [],
        maxSteps: 30,
        sessionPer: 'user',
        compactionThreshold: 50000,
      }));
      const config = createBotConfig();
      delete config.workspace;
      await botManager.loadBot('test-bot', config);
      await botManager.startBot('test-bot');

      const workspace = mockContainerPool.initializeContainer.mock.calls[0].arguments[2];
      assert.equal(workspace.root, './data/test-bot');
    });

    test('updates lastActiveAt timestamp', async () => {
      await botManager.loadBot('test-bot', createBotConfig());
      const bot = botManager.getBot('test-bot');
      const beforeStart = bot.lastActiveAt;

      await botManager.startBot('test-bot');

      assert.ok(bot.lastActiveAt >= beforeStart);
    });

    test('is a no-op when bot is already running', async () => {
      await botManager.loadBot('test-bot', createBotConfig());
      await botManager.startBot('test-bot');

      // Reset mock call count
      mockContainerPool.initializeContainer.mock.resetCalls();

      // Start again - should be no-op
      await botManager.startBot('test-bot');

      assert.equal(mockContainerPool.initializeContainer.mock.calls.length, 0);
      assert.equal(botManager.getBot('test-bot').status, 'running');
    });

    test('throws BotManagerError when botId is empty', async () => {
      await assert.rejects(
        () => botManager.startBot(''),
        err => {
          assert.equal(err.name, 'BotManagerError');
          assert.match(err.message, /Bot ID must be a non-empty string/);
          assert.equal(err.operation, 'startBot');
          return true;
        }
      );
    });

    test('throws BotManagerError when bot not loaded', async () => {
      await assert.rejects(
        () => botManager.startBot('nonexistent'),
        err => {
          assert.equal(err.name, 'BotManagerError');
          assert.match(err.message, /not found/);
          assert.match(err.message, /loadBot/);
          assert.equal(err.operation, 'startBot');
          assert.equal(err.botId, 'nonexistent');
          return true;
        }
      );
    });

    test('sets status to error when container creation fails', async () => {
      mockContainerPool.initializeContainer = mock.fn(async () => {
        throw new Error('Docker daemon unavailable');
      });

      await botManager.loadBot('test-bot', createBotConfig());

      await assert.rejects(
        () => botManager.startBot('test-bot'),
        err => {
          assert.equal(err.name, 'BotManagerError');
          assert.match(err.message, /Failed to start bot/);
          assert.ok(err.cause);
          return true;
        }
      );

      const bot = botManager.getBot('test-bot');
      assert.equal(bot.status, 'error');
    });
  });

  describe('stopBot()', () => {
    test('stops a running bot', async () => {
      await botManager.loadBot('test-bot', createBotConfig());
      await botManager.startBot('test-bot');
      await botManager.stopBot('test-bot');

      const bot = botManager.getBot('test-bot');
      assert.equal(bot.status, 'stopped');
      assert.equal(bot.container, null);
    });

    test('recycles container via ContainerPool', async () => {
      await botManager.loadBot('test-bot', createBotConfig());
      await botManager.startBot('test-bot');
      await botManager.stopBot('test-bot');

      assert.equal(mockContainerPool.recycleContainer.mock.calls.length, 1);
      assert.equal(mockContainerPool.recycleContainer.mock.calls[0].arguments[0], 'test-bot');
    });

    test('is a no-op when bot is already stopped', async () => {
      await botManager.loadBot('test-bot', createBotConfig());
      await botManager.startBot('test-bot');
      await botManager.stopBot('test-bot');

      // Reset mock
      mockContainerPool.recycleContainer.mock.resetCalls();

      // Stop again - should be no-op
      await botManager.stopBot('test-bot');

      assert.equal(mockContainerPool.recycleContainer.mock.calls.length, 0);
      assert.equal(botManager.getBot('test-bot').status, 'stopped');
    });

    test('handles bot with no container gracefully', async () => {
      await botManager.loadBot('test-bot', createBotConfig());
      // Bot is loaded but not started, so no container

      await botManager.stopBot('test-bot');

      const bot = botManager.getBot('test-bot');
      assert.equal(bot.status, 'stopped');
    });

    test('updates lastActiveAt timestamp', async () => {
      await botManager.loadBot('test-bot', createBotConfig());
      await botManager.startBot('test-bot');
      const bot = botManager.getBot('test-bot');
      const beforeStop = bot.lastActiveAt;

      await botManager.stopBot('test-bot');

      assert.ok(bot.lastActiveAt >= beforeStop);
    });

    test('throws BotManagerError when botId is empty', async () => {
      await assert.rejects(
        () => botManager.stopBot(''),
        err => {
          assert.equal(err.name, 'BotManagerError');
          assert.match(err.message, /Bot ID must be a non-empty string/);
          assert.equal(err.operation, 'stopBot');
          return true;
        }
      );
    });

    test('throws BotManagerError when bot not found', async () => {
      await assert.rejects(
        () => botManager.stopBot('nonexistent'),
        err => {
          assert.equal(err.name, 'BotManagerError');
          assert.match(err.message, /not found/);
          assert.equal(err.operation, 'stopBot');
          assert.equal(err.botId, 'nonexistent');
          return true;
        }
      );
    });

    test('sets status to error when container recycle fails', async () => {
      mockContainerPool.recycleContainer = mock.fn(async () => {
        throw new Error('Container removal failed');
      });

      await botManager.loadBot('test-bot', createBotConfig());
      await botManager.startBot('test-bot');

      await assert.rejects(
        () => botManager.stopBot('test-bot'),
        err => {
          assert.equal(err.name, 'BotManagerError');
          assert.match(err.message, /Failed to stop bot/);
          return true;
        }
      );

      const bot = botManager.getBot('test-bot');
      assert.equal(bot.status, 'error');
    });
  });

  describe('reloadBot()', () => {
    test('updates config without recreating container when sandbox unchanged', async () => {
      const originalConfig = createBotConfig({ name: 'Original Bot' });
      await botManager.loadBot('test-bot', originalConfig);
      await botManager.startBot('test-bot');

      // Reset mocks
      mockContainerPool.initializeContainer.mock.resetCalls();
      mockContainerPool.recycleContainer.mock.resetCalls();

      const newConfig = createBotConfig({ name: 'Updated Bot' });
      await botManager.reloadBot('test-bot', newConfig);

      const bot = botManager.getBot('test-bot');
      assert.equal(bot.config.name, 'Updated Bot');
      // Container should NOT have been recreated
      assert.equal(mockContainerPool.initializeContainer.mock.calls.length, 0);
      assert.equal(mockContainerPool.recycleContainer.mock.calls.length, 0);
    });

    test('recreates container when sandbox image changes', async () => {
      const originalConfig = createBotConfig({
        sandbox: { type: 'docker', image: 'node:22-slim', memory: '2g', cpus: 2 },
      });
      await botManager.loadBot('test-bot', originalConfig);
      await botManager.startBot('test-bot');

      // Reset mocks
      mockContainerPool.initializeContainer.mock.resetCalls();
      mockContainerPool.recycleContainer.mock.resetCalls();

      const newConfig = createBotConfig({
        sandbox: { type: 'docker', image: 'python:3.12-slim', memory: '2g', cpus: 2 },
      });
      await botManager.reloadBot('test-bot', newConfig);

      // Container SHOULD have been recreated
      assert.equal(mockContainerPool.recycleContainer.mock.calls.length, 1);
      assert.equal(mockContainerPool.initializeContainer.mock.calls.length, 1);
    });

    test('recreates container when sandbox memory changes', async () => {
      const originalConfig = createBotConfig({
        sandbox: { type: 'docker', image: 'node:22-slim', memory: '2g', cpus: 2 },
      });
      await botManager.loadBot('test-bot', originalConfig);
      await botManager.startBot('test-bot');

      mockContainerPool.initializeContainer.mock.resetCalls();
      mockContainerPool.recycleContainer.mock.resetCalls();

      const newConfig = createBotConfig({
        sandbox: { type: 'docker', image: 'node:22-slim', memory: '4g', cpus: 2 },
      });
      await botManager.reloadBot('test-bot', newConfig);

      assert.equal(mockContainerPool.recycleContainer.mock.calls.length, 1);
      assert.equal(mockContainerPool.initializeContainer.mock.calls.length, 1);
    });

    test('recreates container when sandbox packages change', async () => {
      const originalConfig = createBotConfig({
        sandbox: {
          type: 'docker',
          image: 'node:22-slim',
          memory: '2g',
          cpus: 2,
          packages: ['git'],
        },
      });
      await botManager.loadBot('test-bot', originalConfig);
      await botManager.startBot('test-bot');

      mockContainerPool.initializeContainer.mock.resetCalls();
      mockContainerPool.recycleContainer.mock.resetCalls();

      const newConfig = createBotConfig({
        sandbox: {
          type: 'docker',
          image: 'node:22-slim',
          memory: '2g',
          cpus: 2,
          packages: ['git', 'python3'],
        },
      });
      await botManager.reloadBot('test-bot', newConfig);

      assert.equal(mockContainerPool.recycleContainer.mock.calls.length, 1);
      assert.equal(mockContainerPool.initializeContainer.mock.calls.length, 1);
    });

    test('does not recreate container when bot is not running', async () => {
      const originalConfig = createBotConfig({
        sandbox: { type: 'docker', image: 'node:22-slim', memory: '2g', cpus: 2 },
      });
      await botManager.loadBot('test-bot', originalConfig);
      // Bot loaded but NOT started

      mockContainerPool.initializeContainer.mock.resetCalls();
      mockContainerPool.recycleContainer.mock.resetCalls();

      const newConfig = createBotConfig({
        sandbox: { type: 'docker', image: 'python:3.12', memory: '4g', cpus: 4 },
      });
      await botManager.reloadBot('test-bot', newConfig);

      // Container should NOT be touched since bot is not running
      assert.equal(mockContainerPool.initializeContainer.mock.calls.length, 0);
      assert.equal(mockContainerPool.recycleContainer.mock.calls.length, 0);
    });

    test('reloads soul content', async () => {
      await botManager.loadBot('test-bot', createBotConfig());
      mockSoulLoader.load.mock.resetCalls();

      mockSoulLoader.load = mock.fn(async () => 'Updated soul content!');

      await botManager.reloadBot('test-bot', createBotConfig());

      assert.equal(mockSoulLoader.load.mock.calls.length, 1);
      const bot = botManager.getBot('test-bot');
      assert.equal(bot.soulContent, 'Updated soul content!');
    });

    test('updates lastActiveAt timestamp', async () => {
      await botManager.loadBot('test-bot', createBotConfig());
      const bot = botManager.getBot('test-bot');
      const beforeReload = bot.lastActiveAt;

      await botManager.reloadBot('test-bot', createBotConfig());

      assert.ok(bot.lastActiveAt >= beforeReload);
    });

    test('validates new config', async () => {
      await botManager.loadBot('test-bot', createBotConfig());
      mockValidator.validateBotConfig.mock.resetCalls();

      await botManager.reloadBot('test-bot', createBotConfig({ name: 'New Name' }));

      assert.equal(mockValidator.validateBotConfig.mock.calls.length, 1);
    });

    test('throws BotManagerError when botId is empty', async () => {
      await assert.rejects(
        () => botManager.reloadBot('', createBotConfig()),
        err => {
          assert.equal(err.name, 'BotManagerError');
          assert.match(err.message, /Bot ID must be a non-empty string/);
          assert.equal(err.operation, 'reloadBot');
          return true;
        }
      );
    });

    test('throws BotManagerError when newConfig is null', async () => {
      await botManager.loadBot('test-bot', createBotConfig());

      await assert.rejects(
        () => botManager.reloadBot('test-bot', null),
        err => {
          assert.equal(err.name, 'BotManagerError');
          assert.match(err.message, /New config must be a non-null object/);
          assert.equal(err.operation, 'reloadBot');
          assert.equal(err.botId, 'test-bot');
          return true;
        }
      );
    });

    test('throws BotManagerError when bot not found', async () => {
      await assert.rejects(
        () => botManager.reloadBot('nonexistent', createBotConfig()),
        err => {
          assert.equal(err.name, 'BotManagerError');
          assert.match(err.message, /not found/);
          assert.equal(err.operation, 'reloadBot');
          assert.equal(err.botId, 'nonexistent');
          return true;
        }
      );
    });

    test('throws BotManagerError when new config validation fails', async () => {
      const { ConfigValidationError } = await import('../../../src/config/ConfigValidator.js');
      await botManager.loadBot('test-bot', createBotConfig());

      mockValidator.validateBotConfig = mock.fn(() => {
        throw new ConfigValidationError('Invalid new config');
      });

      await assert.rejects(
        () => botManager.reloadBot('test-bot', createBotConfig()),
        err => {
          assert.equal(err.name, 'BotManagerError');
          assert.match(err.message, /new config validation failed/);
          assert.equal(err.operation, 'reloadBot');
          assert.equal(err.botId, 'test-bot');
          assert.ok(err.cause);
          return true;
        }
      );
    });

    test('throws BotManagerError when soul reload fails', async () => {
      await botManager.loadBot('test-bot', createBotConfig());

      mockSoulLoader.load = mock.fn(async () => {
        throw new Error('File not found');
      });

      await assert.rejects(
        () => botManager.reloadBot('test-bot', createBotConfig()),
        err => {
          assert.equal(err.name, 'BotManagerError');
          assert.match(err.message, /Failed to reload soul/);
          assert.equal(err.operation, 'reloadBot');
          assert.equal(err.botId, 'test-bot');
          return true;
        }
      );
    });
  });

  describe('getBot()', () => {
    test('returns a loaded bot', async () => {
      await botManager.loadBot('test-bot', createBotConfig());

      const bot = botManager.getBot('test-bot');

      assert.ok(bot);
      assert.equal(bot.id, 'test-bot');
    });

    test('returns undefined for unknown bot', () => {
      const bot = botManager.getBot('nonexistent');
      assert.equal(bot, undefined);
    });

    test('returns bot with all expected properties', async () => {
      await botManager.loadBot('test-bot', createBotConfig());

      const bot = botManager.getBot('test-bot');

      assert.equal(typeof bot.id, 'string');
      assert.equal(typeof bot.config, 'object');
      assert.equal(typeof bot.soulContent, 'string');
      assert.equal(typeof bot.status, 'string');
      assert.ok(bot.createdAt instanceof Date);
      assert.ok(bot.lastActiveAt instanceof Date);
    });
  });

  describe('listBots()', () => {
    test('returns empty array when no bots loaded', () => {
      const bots = botManager.listBots();
      assert.deepEqual(bots, []);
    });

    test('returns all loaded bots', async () => {
      await botManager.loadBot('bot-1', createBotConfig({ soul: './s1.md' }));
      await botManager.loadBot('bot-2', createBotConfig({ soul: './s2.md' }));
      await botManager.loadBot('bot-3', createBotConfig({ soul: './s3.md' }));

      const bots = botManager.listBots();

      assert.equal(bots.length, 3);
      const ids = bots.map(b => b.id);
      assert.ok(ids.includes('bot-1'));
      assert.ok(ids.includes('bot-2'));
      assert.ok(ids.includes('bot-3'));
    });

    test('returns array not a Map iterator', () => {
      const bots = botManager.listBots();
      assert.ok(Array.isArray(bots));
    });
  });

  describe('removeBot()', () => {
    test('removes a loaded bot', async () => {
      await botManager.loadBot('test-bot', createBotConfig());

      const removed = await botManager.removeBot('test-bot');

      assert.equal(removed, true);
      assert.equal(botManager.getBot('test-bot'), undefined);
      assert.equal(botManager.bots.size, 0);
    });

    test('stops a running bot before removing', async () => {
      await botManager.loadBot('test-bot', createBotConfig());
      await botManager.startBot('test-bot');

      const removed = await botManager.removeBot('test-bot');

      assert.equal(removed, true);
      assert.equal(mockContainerPool.recycleContainer.mock.calls.length, 1);
    });

    test('returns false when bot not found', async () => {
      const removed = await botManager.removeBot('nonexistent');
      assert.equal(removed, false);
    });

    test('throws BotManagerError when botId is empty', async () => {
      await assert.rejects(
        () => botManager.removeBot(''),
        err => {
          assert.equal(err.name, 'BotManagerError');
          assert.match(err.message, /Bot ID must be a non-empty string/);
          assert.equal(err.operation, 'removeBot');
          return true;
        }
      );
    });
  });

  describe('getBotCount()', () => {
    test('returns 0 when no bots loaded', () => {
      assert.equal(botManager.getBotCount(), 0);
    });

    test('returns total count when no status filter', async () => {
      await botManager.loadBot('bot-1', createBotConfig({ soul: './s1.md' }));
      await botManager.loadBot('bot-2', createBotConfig({ soul: './s2.md' }));

      assert.equal(botManager.getBotCount(), 2);
    });

    test('returns count filtered by status', async () => {
      await botManager.loadBot('bot-1', createBotConfig({ soul: './s1.md' }));
      await botManager.loadBot('bot-2', createBotConfig({ soul: './s2.md' }));
      await botManager.startBot('bot-1');

      assert.equal(botManager.getBotCount('running'), 1);
      assert.equal(botManager.getBotCount('loaded'), 1);
      assert.equal(botManager.getBotCount('stopped'), 0);
    });
  });

  describe('stopAll()', () => {
    test('stops all running bots', async () => {
      await botManager.loadBot('bot-1', createBotConfig({ soul: './s1.md' }));
      await botManager.loadBot('bot-2', createBotConfig({ soul: './s2.md' }));
      await botManager.startBot('bot-1');
      await botManager.startBot('bot-2');

      const results = await botManager.stopAll();

      assert.equal(results.stopped.length, 2);
      assert.equal(results.failed.length, 0);
      assert.ok(results.stopped.includes('bot-1'));
      assert.ok(results.stopped.includes('bot-2'));
    });

    test('skips bots that are not running', async () => {
      await botManager.loadBot('bot-1', createBotConfig({ soul: './s1.md' }));
      await botManager.loadBot('bot-2', createBotConfig({ soul: './s2.md' }));
      await botManager.startBot('bot-1');
      // bot-2 is not started

      const results = await botManager.stopAll();

      assert.equal(results.stopped.length, 1);
      assert.ok(results.stopped.includes('bot-1'));
    });

    test('collects failures without throwing', async () => {
      await botManager.loadBot('bot-1', createBotConfig({ soul: './s1.md' }));
      await botManager.loadBot('bot-2', createBotConfig({ soul: './s2.md' }));
      await botManager.startBot('bot-1');
      await botManager.startBot('bot-2');

      // Make recycleContainer fail for bot-2
      let callCount = 0;
      mockContainerPool.recycleContainer = mock.fn(async () => {
        callCount++;
        if (callCount === 2) {
          throw new Error('Container stuck');
        }
      });

      const results = await botManager.stopAll();

      // bot-1 should succeed, bot-2 should fail
      assert.equal(results.stopped.length + results.failed.length, 2);
    });

    test('returns empty results when no bots are running', async () => {
      await botManager.loadBot('bot-1', createBotConfig({ soul: './s1.md' }));

      const results = await botManager.stopAll();

      assert.deepEqual(results, { stopped: [], failed: [] });
    });
  });

  describe('_hasSandboxChanged()', () => {
    test('returns false when both sandbox configs are undefined', () => {
      assert.equal(botManager._hasSandboxChanged(undefined, undefined), false);
    });

    test('returns false when both sandbox configs are null', () => {
      assert.equal(botManager._hasSandboxChanged(null, null), false);
    });

    test('returns true when old is undefined and new is defined', () => {
      assert.equal(botManager._hasSandboxChanged(undefined, { image: 'node:22' }), true);
    });

    test('returns true when old is defined and new is undefined', () => {
      assert.equal(botManager._hasSandboxChanged({ image: 'node:22' }, undefined), true);
    });

    test('returns false when sandbox configs are identical', () => {
      const sandbox = {
        type: 'docker',
        image: 'node:22-slim',
        memory: '2g',
        cpus: 2,
        packages: ['git'],
      };
      assert.equal(botManager._hasSandboxChanged(sandbox, { ...sandbox }), false);
    });

    test('returns true when image changes', () => {
      const old = { type: 'docker', image: 'node:22-slim', memory: '2g', cpus: 2 };
      const neu = { type: 'docker', image: 'python:3.12', memory: '2g', cpus: 2 };
      assert.equal(botManager._hasSandboxChanged(old, neu), true);
    });

    test('returns true when memory changes', () => {
      const old = { type: 'docker', image: 'node:22-slim', memory: '2g', cpus: 2 };
      const neu = { type: 'docker', image: 'node:22-slim', memory: '4g', cpus: 2 };
      assert.equal(botManager._hasSandboxChanged(old, neu), true);
    });

    test('returns true when cpus change', () => {
      const old = { type: 'docker', image: 'node:22-slim', memory: '2g', cpus: 2 };
      const neu = { type: 'docker', image: 'node:22-slim', memory: '2g', cpus: 4 };
      assert.equal(botManager._hasSandboxChanged(old, neu), true);
    });

    test('returns true when type changes', () => {
      const old = { type: 'docker', image: 'node:22-slim', memory: '2g', cpus: 2 };
      const neu = { type: 'just-bash', image: 'node:22-slim', memory: '2g', cpus: 2 };
      assert.equal(botManager._hasSandboxChanged(old, neu), true);
    });

    test('returns true when packages change', () => {
      const old = { type: 'docker', image: 'node:22', packages: ['git'] };
      const neu = { type: 'docker', image: 'node:22', packages: ['git', 'python3'] };
      assert.equal(botManager._hasSandboxChanged(old, neu), true);
    });

    test('returns false when packages are the same', () => {
      const old = { type: 'docker', image: 'node:22', packages: ['git'] };
      const neu = { type: 'docker', image: 'node:22', packages: ['git'] };
      assert.equal(botManager._hasSandboxChanged(old, neu), false);
    });

    test('treats undefined packages and empty packages as equal', () => {
      const old = { type: 'docker', image: 'node:22' };
      const neu = { type: 'docker', image: 'node:22', packages: [] };
      assert.equal(botManager._hasSandboxChanged(old, neu), false);
    });
  });

  describe('toolRegistry integration', () => {
    test('resolves tools via toolRegistry during loadBot', async () => {
      const mockToolRegistry = {
        getToolsForBot: mock.fn(async () => ({
          bash: { description: 'Bash tool', execute: async () => ({}) },
          github__list_repos: { description: 'List repos', execute: async () => ({}) },
        })),
      };

      const manager = new BotManager(mockStorage, mockContainerPool, mockSoulLoader, {
        configValidator: mockValidator,
        toolRegistry: mockToolRegistry,
      });

      const bot = await manager.loadBot('test-bot', createBotConfig({ mcpServers: ['github'] }));

      assert.ok(bot.tools);
      assert.ok(bot.tools.bash);
      assert.ok(bot.tools['github__list_repos']);
      assert.equal(mockToolRegistry.getToolsForBot.mock.calls.length, 1);
    });

    test('passes validated config to toolRegistry.getToolsForBot', async () => {
      const mockToolRegistry = {
        getToolsForBot: mock.fn(async () => ({})),
      };

      const manager = new BotManager(mockStorage, mockContainerPool, mockSoulLoader, {
        configValidator: mockValidator,
        toolRegistry: mockToolRegistry,
      });

      await manager.loadBot(
        'test-bot',
        createBotConfig({
          tools: ['bash', 'readFile'],
          mcpServers: ['github'],
        })
      );

      const passedConfig = mockToolRegistry.getToolsForBot.mock.calls[0].arguments[0];
      assert.equal(passedConfig.id, 'test-bot');
      assert.ok(passedConfig.tools.includes('bash'));
      assert.ok(passedConfig.mcpServers.includes('github'));
    });

    test('bot.tools is empty object when no toolRegistry provided', async () => {
      const bot = await botManager.loadBot('test-bot', createBotConfig());

      assert.deepEqual(bot.tools, {});
    });

    test('throws BotManagerError when toolRegistry.getToolsForBot fails', async () => {
      const mockToolRegistry = {
        getToolsForBot: mock.fn(async () => {
          throw new Error('MCP connection failed');
        }),
      };

      const manager = new BotManager(mockStorage, mockContainerPool, mockSoulLoader, {
        configValidator: mockValidator,
        toolRegistry: mockToolRegistry,
      });

      await assert.rejects(
        () => manager.loadBot('test-bot', createBotConfig({ mcpServers: ['github'] })),
        err => {
          assert.equal(err.name, 'BotManagerError');
          assert.match(err.message, /Failed to resolve tools/);
          assert.equal(err.operation, 'loadBot');
          assert.equal(err.botId, 'test-bot');
          assert.ok(err.cause);
          return true;
        }
      );
    });

    test('re-resolves tools during reloadBot', async () => {
      const mockToolRegistry = {
        getToolsForBot: mock.fn(async () => ({
          bash: { description: 'Bash tool', execute: async () => ({}) },
        })),
      };

      const manager = new BotManager(mockStorage, mockContainerPool, mockSoulLoader, {
        configValidator: mockValidator,
        toolRegistry: mockToolRegistry,
      });

      await manager.loadBot('test-bot', createBotConfig());
      mockToolRegistry.getToolsForBot.mock.resetCalls();

      // Now reload with new config that includes MCP servers
      mockToolRegistry.getToolsForBot = mock.fn(async () => ({
        bash: { description: 'Bash tool', execute: async () => ({}) },
        github__list_repos: { description: 'List repos', execute: async () => ({}) },
      }));

      await manager.reloadBot('test-bot', createBotConfig({ mcpServers: ['github'] }));

      const bot = manager.getBot('test-bot');
      assert.ok(bot.tools['github__list_repos']);
    });

    test('throws BotManagerError when toolRegistry fails during reloadBot', async () => {
      const mockToolRegistry = {
        getToolsForBot: mock.fn(async () => ({})),
      };

      const manager = new BotManager(mockStorage, mockContainerPool, mockSoulLoader, {
        configValidator: mockValidator,
        toolRegistry: mockToolRegistry,
      });

      await manager.loadBot('test-bot', createBotConfig());

      mockToolRegistry.getToolsForBot = mock.fn(async () => {
        throw new Error('MCP server crashed');
      });

      await assert.rejects(
        () => manager.reloadBot('test-bot', createBotConfig({ mcpServers: ['github'] })),
        err => {
          assert.equal(err.name, 'BotManagerError');
          assert.match(err.message, /Failed to resolve tools/);
          assert.equal(err.operation, 'reloadBot');
          assert.equal(err.botId, 'test-bot');
          return true;
        }
      );
    });
  });

  describe('skillRegistry integration', () => {
    /**
     * Create a mock SkillRegistry
     * @param {Object} [overrides={}] - Override mock implementations
     * @returns {Object} Mock SkillRegistry
     */
    function createMockSkillRegistry(overrides = {}) {
      const attached = new Map();
      return {
        attachToBot: mock.fn((botId, skillNames) => {
          // Validate skill names exist (mimics real SkillRegistry)
          attached.set(botId, [...skillNames]);
        }),
        detachFromBot: mock.fn(botId => {
          const had = attached.has(botId);
          attached.delete(botId);
          return had;
        }),
        getAttachedSkills: mock.fn(botId => attached.get(botId) || []),
        getSkillInstructions: mock.fn(() => '# Code Review\nReview carefully.'),
        getSkillTools: mock.fn(() => ({})),
        hasSkill: mock.fn(() => true),
        _attached: attached,
        ...overrides,
      };
    }

    test('attaches skills and merges instructions into soulContent during loadBot', async () => {
      const mockSkillRegistry = createMockSkillRegistry({
        getSkillInstructions: mock.fn(() => '# Code Review\nReview code carefully.'),
        getSkillTools: mock.fn(() => ({})),
      });

      const manager = new BotManager(mockStorage, mockContainerPool, mockSoulLoader, {
        configValidator: mockValidator,
        skillRegistry: mockSkillRegistry,
      });

      const config = createBotConfig({ skills: ['code-review'] });
      const bot = await manager.loadBot('test-bot', config);

      // Verify attachToBot was called
      assert.equal(mockSkillRegistry.attachToBot.mock.calls.length, 1);
      const [attachedBotId, attachedSkills] = mockSkillRegistry.attachToBot.mock.calls[0].arguments;
      assert.equal(attachedBotId, 'test-bot');
      assert.deepEqual(attachedSkills, ['code-review']);

      // Verify instructions were merged into soulContent
      assert.ok(bot.soulContent.includes('You are a helpful test bot.'));
      assert.ok(bot.soulContent.includes('## Skills'));
      assert.ok(bot.soulContent.includes('Review code carefully.'));
    });

    test('merges skill tools into resolved tools during loadBot', async () => {
      const skillTool = { description: 'Lint code', execute: async () => ({}) };
      const mockSkillRegistry = createMockSkillRegistry({
        getSkillInstructions: mock.fn(() => ''),
        getSkillTools: mock.fn(() => ({ lintCode: skillTool })),
      });

      const manager = new BotManager(mockStorage, mockContainerPool, mockSoulLoader, {
        configValidator: mockValidator,
        skillRegistry: mockSkillRegistry,
      });

      const config = createBotConfig({ skills: ['code-review'] });
      const bot = await manager.loadBot('test-bot', config);

      assert.ok(bot.tools.lintCode);
      assert.equal(bot.tools.lintCode, skillTool);
    });

    test('builtin/MCP tools take precedence over skill tools', async () => {
      const skillBash = { description: 'Skill bash', execute: async () => ({}) };
      const mockSkillRegistry = createMockSkillRegistry({
        getSkillInstructions: mock.fn(() => ''),
        getSkillTools: mock.fn(() => ({ bash: skillBash })),
      });

      const registryBash = { description: 'Registry bash', execute: async () => ({}) };
      const mockToolRegistry = {
        getToolsForBot: mock.fn(async () => ({ bash: registryBash })),
      };

      const manager = new BotManager(mockStorage, mockContainerPool, mockSoulLoader, {
        configValidator: mockValidator,
        skillRegistry: mockSkillRegistry,
        toolRegistry: mockToolRegistry,
      });

      const config = createBotConfig({ skills: ['code-review'], tools: ['bash'] });
      const bot = await manager.loadBot('test-bot', config);

      // ToolRegistry bash should win over skill bash
      assert.equal(bot.tools.bash, registryBash);
    });

    test('does not modify soulContent when skills have no instructions', async () => {
      const mockSkillRegistry = createMockSkillRegistry({
        getSkillInstructions: mock.fn(() => ''),
        getSkillTools: mock.fn(() => ({})),
      });

      const manager = new BotManager(mockStorage, mockContainerPool, mockSoulLoader, {
        configValidator: mockValidator,
        skillRegistry: mockSkillRegistry,
      });

      const config = createBotConfig({ skills: ['empty-skill'] });
      const bot = await manager.loadBot('test-bot', config);

      assert.equal(bot.soulContent, 'You are a helpful test bot.');
    });

    test('skips skill resolution when no skillRegistry is set', async () => {
      const config = createBotConfig({ skills: ['code-review'] });
      const bot = await botManager.loadBot('test-bot', config);

      // Should load normally without skill instructions
      assert.equal(bot.soulContent, 'You are a helpful test bot.');
    });

    test('skips skill resolution when skills array is empty', async () => {
      const mockSkillRegistry = createMockSkillRegistry();

      const manager = new BotManager(mockStorage, mockContainerPool, mockSoulLoader, {
        configValidator: mockValidator,
        skillRegistry: mockSkillRegistry,
      });

      const config = createBotConfig({ skills: [] });
      await manager.loadBot('test-bot', config);

      assert.equal(mockSkillRegistry.attachToBot.mock.calls.length, 0);
    });

    test('throws BotManagerError when skill resolution fails during loadBot', async () => {
      const mockSkillRegistry = createMockSkillRegistry({
        attachToBot: mock.fn(() => {
          throw new Error('Skills not found in registry: nonexistent');
        }),
      });

      const manager = new BotManager(mockStorage, mockContainerPool, mockSoulLoader, {
        configValidator: mockValidator,
        skillRegistry: mockSkillRegistry,
      });

      const config = createBotConfig({ skills: ['nonexistent'] });

      await assert.rejects(
        () => manager.loadBot('test-bot', config),
        err => {
          assert.equal(err.name, 'BotManagerError');
          assert.match(err.message, /Failed to resolve skills/);
          assert.equal(err.operation, 'loadBot');
          assert.equal(err.botId, 'test-bot');
          assert.ok(err.cause);
          return true;
        }
      );
    });

    test('re-resolves skills during reloadBot', async () => {
      const mockSkillRegistry = createMockSkillRegistry({
        getSkillInstructions: mock.fn(() => 'Initial instructions'),
        getSkillTools: mock.fn(() => ({})),
      });

      const manager = new BotManager(mockStorage, mockContainerPool, mockSoulLoader, {
        configValidator: mockValidator,
        skillRegistry: mockSkillRegistry,
      });

      await manager.loadBot('test-bot', createBotConfig({ skills: ['code-review'] }));

      // Change instructions for reload
      mockSkillRegistry.getSkillInstructions = mock.fn(() => 'Updated instructions');

      await manager.reloadBot('test-bot', createBotConfig({ skills: ['code-review'] }));

      const bot = manager.getBot('test-bot');
      assert.ok(bot.soulContent.includes('Updated instructions'));
    });

    test('detaches skills during reloadBot when new config has no skills', async () => {
      const mockSkillRegistry = createMockSkillRegistry({
        getSkillInstructions: mock.fn(() => 'Some instructions'),
        getSkillTools: mock.fn(() => ({})),
      });

      const manager = new BotManager(mockStorage, mockContainerPool, mockSoulLoader, {
        configValidator: mockValidator,
        skillRegistry: mockSkillRegistry,
      });

      await manager.loadBot('test-bot', createBotConfig({ skills: ['code-review'] }));
      await manager.reloadBot('test-bot', createBotConfig({ skills: [] }));

      assert.equal(mockSkillRegistry.detachFromBot.mock.calls.length, 1);
      assert.equal(mockSkillRegistry.detachFromBot.mock.calls[0].arguments[0], 'test-bot');
    });

    test('throws BotManagerError when skill resolution fails during reloadBot', async () => {
      const mockSkillRegistry = createMockSkillRegistry({
        getSkillInstructions: mock.fn(() => 'Instructions'),
        getSkillTools: mock.fn(() => ({})),
      });

      const manager = new BotManager(mockStorage, mockContainerPool, mockSoulLoader, {
        configValidator: mockValidator,
        skillRegistry: mockSkillRegistry,
      });

      await manager.loadBot('test-bot', createBotConfig({ skills: ['code-review'] }));

      // Make attachToBot fail on reload
      mockSkillRegistry.attachToBot = mock.fn(() => {
        throw new Error('Skills not found in registry: missing-skill');
      });

      await assert.rejects(
        () => manager.reloadBot('test-bot', createBotConfig({ skills: ['missing-skill'] })),
        err => {
          assert.equal(err.name, 'BotManagerError');
          assert.match(err.message, /Failed to resolve skills/);
          assert.equal(err.operation, 'reloadBot');
          assert.equal(err.botId, 'test-bot');
          return true;
        }
      );
    });
  });

  describe('full lifecycle', () => {
    test('load → start → stop → restart flow', async () => {
      const config = createBotConfig();

      // Load
      const bot = await botManager.loadBot('lifecycle-bot', config);
      assert.equal(bot.status, 'loaded');

      // Start
      await botManager.startBot('lifecycle-bot');
      assert.equal(botManager.getBot('lifecycle-bot').status, 'running');
      assert.ok(botManager.getBot('lifecycle-bot').container);

      // Stop
      await botManager.stopBot('lifecycle-bot');
      assert.equal(botManager.getBot('lifecycle-bot').status, 'stopped');
      assert.equal(botManager.getBot('lifecycle-bot').container, null);

      // Restart
      await botManager.startBot('lifecycle-bot');
      assert.equal(botManager.getBot('lifecycle-bot').status, 'running');
      assert.ok(botManager.getBot('lifecycle-bot').container);
    });

    test('load → start → reload → verify running', async () => {
      const config = createBotConfig({ name: 'Before Reload' });

      await botManager.loadBot('reload-bot', config);
      await botManager.startBot('reload-bot');

      const newConfig = createBotConfig({ name: 'After Reload' });
      await botManager.reloadBot('reload-bot', newConfig);

      const bot = botManager.getBot('reload-bot');
      assert.equal(bot.config.name, 'After Reload');
      assert.equal(bot.status, 'running');
    });

    test('manages multiple bots independently', async () => {
      await botManager.loadBot('bot-a', createBotConfig({ soul: './a.md', name: 'Bot A' }));
      await botManager.loadBot('bot-b', createBotConfig({ soul: './b.md', name: 'Bot B' }));

      await botManager.startBot('bot-a');
      // bot-b stays loaded

      assert.equal(botManager.getBot('bot-a').status, 'running');
      assert.equal(botManager.getBot('bot-b').status, 'loaded');

      await botManager.stopBot('bot-a');
      await botManager.startBot('bot-b');

      assert.equal(botManager.getBot('bot-a').status, 'stopped');
      assert.equal(botManager.getBot('bot-b').status, 'running');
    });
  });
});

describe('BotManagerError', () => {
  test('is an instance of Error', () => {
    const error = new BotManagerError('Test error');
    assert.ok(error instanceof Error);
  });

  test('has correct name', () => {
    const error = new BotManagerError('Test error');
    assert.equal(error.name, 'BotManagerError');
  });

  test('stores message', () => {
    const error = new BotManagerError('Something went wrong');
    assert.equal(error.message, 'Something went wrong');
  });

  test('stores operation', () => {
    const error = new BotManagerError('Test error', { operation: 'loadBot' });
    assert.equal(error.operation, 'loadBot');
  });

  test('stores botId', () => {
    const error = new BotManagerError('Test error', { botId: 'my-bot' });
    assert.equal(error.botId, 'my-bot');
  });

  test('stores cause', () => {
    const cause = new Error('Original error');
    const error = new BotManagerError('Test error', { cause });
    assert.equal(error.cause, cause);
  });

  test('stores all options together', () => {
    const cause = new Error('Original');
    const error = new BotManagerError('Multi-option error', {
      cause,
      operation: 'startBot',
      botId: 'test-bot',
    });

    assert.equal(error.cause, cause);
    assert.equal(error.operation, 'startBot');
    assert.equal(error.botId, 'test-bot');
  });
});

describe('BOT_STATUSES', () => {
  test('exports all expected status values', () => {
    assert.equal(BOT_STATUSES.LOADING, 'loading');
    assert.equal(BOT_STATUSES.LOADED, 'loaded');
    assert.equal(BOT_STATUSES.STARTING, 'starting');
    assert.equal(BOT_STATUSES.RUNNING, 'running');
    assert.equal(BOT_STATUSES.STOPPING, 'stopping');
    assert.equal(BOT_STATUSES.STOPPED, 'stopped');
    assert.equal(BOT_STATUSES.ERROR, 'error');
  });
});
