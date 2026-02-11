/**
 * Unit tests for BotReloader
 *
 * Tests hot reload of bot configuration, soul content, and containers.
 * Uses mock BotManager, ContainerPool, and SoulLoader to verify behavior
 * without requiring real Docker or database infrastructure.
 *
 * Tests:
 * - Config change -> no container restart
 * - Soul change -> no container restart
 * - Sandbox change -> container restarts
 * - Sessions preserved during reload
 * - needsContainerRestart detection
 * - Error handling and validation
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { BotReloader, BotReloaderError } from './BotReloader.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock bot object
 * @param {Object} [overrides] - Override default properties
 * @returns {Object} Mock bot
 */
function createMockBot(overrides = {}) {
  return {
    id: 'test-bot',
    config: {
      id: 'test-bot',
      name: 'Test Bot',
      model: 'claude-haiku-4-5',
      sandbox: {
        image: 'alpine:latest',
        memory: '256m',
        cpus: 1,
        packages: ['git', 'python3'],
      },
      workspace: { root: './data/test-bot' },
    },
    soulContent: '# Test Bot\nYou are a helpful assistant.',
    container: { id: 'container-123' },
    status: 'running',
    lastActiveAt: new Date('2025-01-01'),
    ...overrides,
  };
}

/**
 * Create a mock BotManager
 * @param {Object} [bot] - Bot to return from getBot
 * @returns {Object} Mock BotManager
 */
function createMockBotManager(bot = createMockBot()) {
  return {
    getBot: mock.fn(botId => (botId === bot.id ? bot : undefined)),
    listBots: mock.fn(() => [bot]),
    startBot: mock.fn(async () => {}),
    stopBot: mock.fn(async () => {}),
  };
}

/**
 * Create a mock ContainerPool
 * @returns {Object} Mock ContainerPool
 */
function createMockContainerPool() {
  return {
    hasContainer: mock.fn(() => true),
    recycleContainer: mock.fn(async () => {}),
    initializeContainer: mock.fn(async (_botId, _config, _ws) => ({
      id: 'new-container-456',
    })),
    getContainer: mock.fn(async () => ({ id: 'container-123' })),
  };
}

/**
 * Create a mock SoulLoader
 * @returns {Object} Mock SoulLoader
 */
function createMockSoulLoader() {
  return {
    load: mock.fn(async () => '# Loaded Soul\nNew personality content.'),
    loadSoulFile: mock.fn(async () => '# Raw Soul Content'),
    interpolateVariables: mock.fn(content => content),
  };
}

/**
 * Collect log messages
 * @returns {{ logger: Function, messages: string[] }}
 */
function createLogger() {
  const messages = [];
  const logger = msg => messages.push(msg);
  return { logger, messages };
}

// ============================================================================
// Tests
// ============================================================================

describe('BotReloader', () => {
  let bot;
  let botManager;
  let containerPool;
  let soulLoader;
  let logCapture;

  beforeEach(() => {
    bot = createMockBot();
    botManager = createMockBotManager(bot);
    containerPool = createMockContainerPool();
    soulLoader = createMockSoulLoader();
    logCapture = createLogger();
  });

  describe('constructor', () => {
    test('creates instance with all dependencies', () => {
      const reloader = new BotReloader(botManager, containerPool, soulLoader);
      assert.ok(reloader);
      assert.equal(reloader.botManager, botManager);
      assert.equal(reloader.containerPool, containerPool);
      assert.equal(reloader.soulLoader, soulLoader);
    });

    test('throws BotReloaderError without botManager', () => {
      assert.throws(
        () => new BotReloader(null, containerPool, soulLoader),
        err => {
          assert.ok(err instanceof BotReloaderError);
          assert.ok(err.message.includes('BotManager is required'));
          assert.equal(err.operation, 'constructor');
          return true;
        }
      );
    });

    test('throws BotReloaderError without containerPool', () => {
      assert.throws(
        () => new BotReloader(botManager, null, soulLoader),
        err => {
          assert.ok(err instanceof BotReloaderError);
          assert.ok(err.message.includes('ContainerPool is required'));
          return true;
        }
      );
    });

    test('throws BotReloaderError without soulLoader', () => {
      assert.throws(
        () => new BotReloader(botManager, containerPool, null),
        err => {
          assert.ok(err instanceof BotReloaderError);
          assert.ok(err.message.includes('SoulLoader is required'));
          return true;
        }
      );
    });

    test('accepts custom logger', () => {
      const { logger } = createLogger();
      const reloader = new BotReloader(botManager, containerPool, soulLoader, { logger });
      assert.equal(reloader.logger, logger);
    });

    test('uses null logger when none provided', () => {
      const reloader = new BotReloader(botManager, containerPool, soulLoader);
      assert.equal(reloader.logger, null);
    });
  });

  describe('reloadBotConfig()', () => {
    test('updates bot config without container restart', async () => {
      const reloader = new BotReloader(botManager, containerPool, soulLoader, {
        logger: logCapture.logger,
      });

      const newConfig = {
        ...bot.config,
        model: 'claude-sonnet-4-5',
        temperature: 0.8,
      };

      await reloader.reloadBotConfig('test-bot', newConfig);

      // Bot config should be updated
      assert.equal(bot.config.model, 'claude-sonnet-4-5');
      assert.equal(bot.config.temperature, 0.8);
      assert.equal(bot.config.id, 'test-bot');

      // Container should NOT be recycled or restarted
      assert.equal(containerPool.recycleContainer.mock.calls.length, 0);
      assert.equal(containerPool.initializeContainer.mock.calls.length, 0);

      // Should log success
      assert.ok(logCapture.messages.some(m => m.includes('config reloaded')));
      assert.ok(logCapture.messages.some(m => m.includes('no container restart')));
    });

    test('updates lastActiveAt timestamp', async () => {
      const reloader = new BotReloader(botManager, containerPool, soulLoader, {
        logger: logCapture.logger,
      });

      const before = bot.lastActiveAt;
      await reloader.reloadBotConfig('test-bot', { ...bot.config });

      assert.ok(bot.lastActiveAt >= before);
    });

    test('preserves bot id in config', async () => {
      const reloader = new BotReloader(botManager, containerPool, soulLoader, {
        logger: logCapture.logger,
      });

      await reloader.reloadBotConfig('test-bot', { model: 'gpt-4' });

      assert.equal(bot.config.id, 'test-bot');
    });

    test('throws for invalid bot ID', async () => {
      const reloader = new BotReloader(botManager, containerPool, soulLoader);

      await assert.rejects(
        () => reloader.reloadBotConfig('', {}),
        err => {
          assert.ok(err instanceof BotReloaderError);
          assert.ok(err.message.includes('non-empty string'));
          assert.equal(err.operation, 'reloadBotConfig');
          return true;
        }
      );
    });

    test('throws for null config', async () => {
      const reloader = new BotReloader(botManager, containerPool, soulLoader);

      await assert.rejects(
        () => reloader.reloadBotConfig('test-bot', null),
        err => {
          assert.ok(err instanceof BotReloaderError);
          assert.ok(err.message.includes('non-null object'));
          return true;
        }
      );
    });

    test('throws for non-existent bot', async () => {
      const reloader = new BotReloader(botManager, containerPool, soulLoader);

      await assert.rejects(
        () => reloader.reloadBotConfig('unknown-bot', { model: 'test' }),
        err => {
          assert.ok(err instanceof BotReloaderError);
          assert.ok(err.message.includes('not found'));
          assert.equal(err.botId, 'unknown-bot');
          return true;
        }
      );
    });
  });

  describe('reloadSoul()', () => {
    test('updates soul content without container restart', async () => {
      const reloader = new BotReloader(botManager, containerPool, soulLoader, {
        logger: logCapture.logger,
      });

      const newSoul = '# Updated Bot\nYou are now a coding assistant.';
      await reloader.reloadSoul('test-bot', newSoul);

      // Soul content should be updated
      assert.equal(bot.soulContent, newSoul);

      // Container should NOT be recycled or restarted
      assert.equal(containerPool.recycleContainer.mock.calls.length, 0);
      assert.equal(containerPool.initializeContainer.mock.calls.length, 0);

      // Should log success
      assert.ok(logCapture.messages.some(m => m.includes('soul reloaded')));
      assert.ok(logCapture.messages.some(m => m.includes('no container restart')));
    });

    test('updates lastActiveAt timestamp', async () => {
      const reloader = new BotReloader(botManager, containerPool, soulLoader, {
        logger: logCapture.logger,
      });

      const before = bot.lastActiveAt;
      await reloader.reloadSoul('test-bot', 'new content');

      assert.ok(bot.lastActiveAt >= before);
    });

    test('preserves existing config when soul changes', async () => {
      const reloader = new BotReloader(botManager, containerPool, soulLoader, {
        logger: logCapture.logger,
      });

      const originalConfig = { ...bot.config };
      await reloader.reloadSoul('test-bot', 'new soul');

      assert.deepEqual(bot.config.model, originalConfig.model);
      assert.deepEqual(bot.config.sandbox, originalConfig.sandbox);
    });

    test('allows empty string as soul content', async () => {
      const reloader = new BotReloader(botManager, containerPool, soulLoader, {
        logger: logCapture.logger,
      });

      await reloader.reloadSoul('test-bot', '');
      assert.equal(bot.soulContent, '');
    });

    test('throws for non-string soul content', async () => {
      const reloader = new BotReloader(botManager, containerPool, soulLoader);

      await assert.rejects(
        () => reloader.reloadSoul('test-bot', 42),
        err => {
          assert.ok(err instanceof BotReloaderError);
          assert.ok(err.message.includes('must be a string'));
          return true;
        }
      );
    });

    test('throws for null soul content', async () => {
      const reloader = new BotReloader(botManager, containerPool, soulLoader);

      await assert.rejects(
        () => reloader.reloadSoul('test-bot', null),
        err => {
          assert.ok(err instanceof BotReloaderError);
          assert.ok(err.message.includes('must be a string'));
          return true;
        }
      );
    });

    test('throws for invalid bot ID', async () => {
      const reloader = new BotReloader(botManager, containerPool, soulLoader);

      await assert.rejects(
        () => reloader.reloadSoul(null, 'content'),
        err => {
          assert.ok(err instanceof BotReloaderError);
          assert.ok(err.message.includes('non-empty string'));
          return true;
        }
      );
    });

    test('throws for non-existent bot', async () => {
      const reloader = new BotReloader(botManager, containerPool, soulLoader);

      await assert.rejects(
        () => reloader.reloadSoul('unknown-bot', 'content'),
        err => {
          assert.ok(err instanceof BotReloaderError);
          assert.ok(err.message.includes('not found'));
          return true;
        }
      );
    });
  });

  describe('reloadContainer()', () => {
    test('recycles and recreates container with new sandbox config', async () => {
      const reloader = new BotReloader(botManager, containerPool, soulLoader, {
        logger: logCapture.logger,
      });

      const newSandbox = {
        image: 'ubuntu:22.04',
        memory: '512m',
        cpus: 2,
        packages: ['git', 'python3', 'ripgrep'],
      };

      await reloader.reloadContainer('test-bot', newSandbox);

      // Old container should have been recycled
      assert.equal(containerPool.recycleContainer.mock.calls.length, 1);
      assert.equal(containerPool.recycleContainer.mock.calls[0].arguments[0], 'test-bot');

      // New container should have been initialized
      assert.equal(containerPool.initializeContainer.mock.calls.length, 1);
      const [initBotId, initConfig] = containerPool.initializeContainer.mock.calls[0].arguments;
      assert.equal(initBotId, 'test-bot');
      assert.deepEqual(initConfig.sandbox, newSandbox);

      // Bot should have the new container reference
      assert.deepEqual(bot.container, { id: 'new-container-456' });

      // Bot's sandbox config should be updated
      assert.deepEqual(bot.config.sandbox, newSandbox);
    });

    test('updates lastActiveAt timestamp', async () => {
      const reloader = new BotReloader(botManager, containerPool, soulLoader, {
        logger: logCapture.logger,
      });

      const before = bot.lastActiveAt;
      await reloader.reloadContainer('test-bot', { image: 'alpine:latest' });

      assert.ok(bot.lastActiveAt >= before);
    });

    test('uses default workspace when not in config', async () => {
      bot.config.workspace = undefined;

      const reloader = new BotReloader(botManager, containerPool, soulLoader, {
        logger: logCapture.logger,
      });

      await reloader.reloadContainer('test-bot', { image: 'alpine:latest' });

      const [, , workspace] = containerPool.initializeContainer.mock.calls[0].arguments;
      assert.deepEqual(workspace, { root: './data/test-bot' });
    });

    test('skips recycle when no existing container', async () => {
      containerPool.hasContainer = mock.fn(() => false);

      const reloader = new BotReloader(botManager, containerPool, soulLoader, {
        logger: logCapture.logger,
      });

      await reloader.reloadContainer('test-bot', { image: 'alpine:latest' });

      // recycleContainer should NOT have been called
      assert.equal(containerPool.recycleContainer.mock.calls.length, 0);
      // But initializeContainer should still be called
      assert.equal(containerPool.initializeContainer.mock.calls.length, 1);
    });

    test('logs restart progress', async () => {
      const reloader = new BotReloader(botManager, containerPool, soulLoader, {
        logger: logCapture.logger,
      });

      await reloader.reloadContainer('test-bot', { image: 'alpine:latest' });

      assert.ok(logCapture.messages.some(m => m.includes('Restarting container')));
      assert.ok(logCapture.messages.some(m => m.includes('container restarted')));
    });

    test('throws for invalid bot ID', async () => {
      const reloader = new BotReloader(botManager, containerPool, soulLoader);

      await assert.rejects(
        () => reloader.reloadContainer('', { image: 'alpine' }),
        err => {
          assert.ok(err instanceof BotReloaderError);
          assert.equal(err.operation, 'reloadContainer');
          return true;
        }
      );
    });

    test('throws for null sandbox config', async () => {
      const reloader = new BotReloader(botManager, containerPool, soulLoader);

      await assert.rejects(
        () => reloader.reloadContainer('test-bot', null),
        err => {
          assert.ok(err instanceof BotReloaderError);
          assert.ok(err.message.includes('non-null object'));
          return true;
        }
      );
    });

    test('throws for non-existent bot', async () => {
      const reloader = new BotReloader(botManager, containerPool, soulLoader);

      await assert.rejects(
        () => reloader.reloadContainer('unknown-bot', { image: 'alpine' }),
        err => {
          assert.ok(err instanceof BotReloaderError);
          assert.ok(err.message.includes('not found'));
          return true;
        }
      );
    });

    test('wraps container pool errors', async () => {
      containerPool.initializeContainer = mock.fn(async () => {
        throw new Error('Docker daemon not running');
      });

      const reloader = new BotReloader(botManager, containerPool, soulLoader, {
        logger: logCapture.logger,
      });

      await assert.rejects(
        () => reloader.reloadContainer('test-bot', { image: 'alpine' }),
        err => {
          assert.ok(err instanceof BotReloaderError);
          assert.ok(err.message.includes('Docker daemon not running'));
          assert.equal(err.operation, 'reloadContainer');
          assert.equal(err.botId, 'test-bot');
          return true;
        }
      );
    });
  });

  describe('needsContainerRestart()', () => {
    let reloader;

    beforeEach(() => {
      reloader = new BotReloader(botManager, containerPool, soulLoader);
    });

    test('returns false when both configs have no sandbox', () => {
      assert.equal(reloader.needsContainerRestart({}, {}), false);
    });

    test('returns false when both sandbox configs are identical', () => {
      const config = {
        sandbox: {
          image: 'alpine:latest',
          memory: '256m',
          cpus: 1,
          packages: ['git'],
        },
      };
      assert.equal(reloader.needsContainerRestart(config, { ...config }), false);
    });

    test('returns true when image changes', () => {
      const oldConfig = { sandbox: { image: 'alpine:latest' } };
      const newConfig = { sandbox: { image: 'ubuntu:22.04' } };
      assert.equal(reloader.needsContainerRestart(oldConfig, newConfig), true);
    });

    test('returns true when memory changes', () => {
      const oldConfig = { sandbox: { memory: '256m' } };
      const newConfig = { sandbox: { memory: '512m' } };
      assert.equal(reloader.needsContainerRestart(oldConfig, newConfig), true);
    });

    test('returns true when cpus changes', () => {
      const oldConfig = { sandbox: { cpus: 1 } };
      const newConfig = { sandbox: { cpus: 2 } };
      assert.equal(reloader.needsContainerRestart(oldConfig, newConfig), true);
    });

    test('returns true when packages change', () => {
      const oldConfig = { sandbox: { packages: ['git'] } };
      const newConfig = { sandbox: { packages: ['git', 'python3'] } };
      assert.equal(reloader.needsContainerRestart(oldConfig, newConfig), true);
    });

    test('returns true when mounts change', () => {
      const oldConfig = { sandbox: { mounts: ['/data:/data'] } };
      const newConfig = { sandbox: { mounts: ['/data:/data', '/logs:/logs'] } };
      assert.equal(reloader.needsContainerRestart(oldConfig, newConfig), true);
    });

    test('returns true when network changes', () => {
      const oldConfig = { sandbox: { network: { mode: 'bridge' } } };
      const newConfig = { sandbox: { network: { mode: 'host' } } };
      assert.equal(reloader.needsContainerRestart(oldConfig, newConfig), true);
    });

    test('returns true when sandbox added to config', () => {
      const oldConfig = {};
      const newConfig = { sandbox: { image: 'alpine:latest' } };
      assert.equal(reloader.needsContainerRestart(oldConfig, newConfig), true);
    });

    test('returns true when sandbox removed from config', () => {
      const oldConfig = { sandbox: { image: 'alpine:latest' } };
      const newConfig = {};
      assert.equal(reloader.needsContainerRestart(oldConfig, newConfig), true);
    });

    test('returns false when non-sandbox fields change', () => {
      const oldConfig = {
        model: 'claude-haiku-4-5',
        sandbox: { image: 'alpine:latest' },
      };
      const newConfig = {
        model: 'claude-sonnet-4-5',
        sandbox: { image: 'alpine:latest' },
      };
      assert.equal(reloader.needsContainerRestart(oldConfig, newConfig), false);
    });

    test('returns false when both sandboxes are null', () => {
      assert.equal(reloader.needsContainerRestart({ sandbox: null }, { sandbox: null }), false);
    });

    test('returns false when both sandboxes are undefined', () => {
      assert.equal(
        reloader.needsContainerRestart({ sandbox: undefined }, { sandbox: undefined }),
        false
      );
    });

    test('handles null configs gracefully', () => {
      assert.equal(reloader.needsContainerRestart(null, null), false);
    });

    test('handles undefined configs gracefully', () => {
      assert.equal(reloader.needsContainerRestart(undefined, undefined), false);
    });

    test('returns true when one config is null and other has sandbox', () => {
      assert.equal(reloader.needsContainerRestart(null, { sandbox: { image: 'alpine' } }), true);
    });

    test('returns false when packages arrays are same content', () => {
      const oldConfig = { sandbox: { packages: ['git', 'python3'] } };
      const newConfig = { sandbox: { packages: ['git', 'python3'] } };
      assert.equal(reloader.needsContainerRestart(oldConfig, newConfig), false);
    });

    test('returns true when packages order changes', () => {
      const oldConfig = { sandbox: { packages: ['git', 'python3'] } };
      const newConfig = { sandbox: { packages: ['python3', 'git'] } };
      // JSON.stringify preserves order, so different order = different
      assert.equal(reloader.needsContainerRestart(oldConfig, newConfig), true);
    });

    test('treats missing field same as null/undefined', () => {
      const oldConfig = { sandbox: { image: 'alpine' } };
      const newConfig = { sandbox: { image: 'alpine', memory: undefined } };
      assert.equal(reloader.needsContainerRestart(oldConfig, newConfig), false);
    });
  });

  describe('sessions preserved during reload', () => {
    test('config reload does not touch sessions', async () => {
      const reloader = new BotReloader(botManager, containerPool, soulLoader, {
        logger: logCapture.logger,
      });

      // Sessions are in PostgreSQL, not in memory
      // Verify no container operations (which would lose ephemeral state)
      await reloader.reloadBotConfig('test-bot', {
        ...bot.config,
        model: 'claude-sonnet-4-5',
      });

      assert.equal(containerPool.recycleContainer.mock.calls.length, 0);
      assert.equal(containerPool.initializeContainer.mock.calls.length, 0);
    });

    test('soul reload does not touch sessions', async () => {
      const reloader = new BotReloader(botManager, containerPool, soulLoader, {
        logger: logCapture.logger,
      });

      await reloader.reloadSoul('test-bot', '# New personality');

      assert.equal(containerPool.recycleContainer.mock.calls.length, 0);
      assert.equal(containerPool.initializeContainer.mock.calls.length, 0);
    });

    test('container reload preserves sessions (they live in DB)', async () => {
      const reloader = new BotReloader(botManager, containerPool, soulLoader, {
        logger: logCapture.logger,
      });

      // Sessions are stored in PostgreSQL, not in containers.
      // After container restart, session data is still in the database.
      await reloader.reloadContainer('test-bot', { image: 'ubuntu:22.04' });

      // Container was recycled and recreated, but sessions are in DB
      assert.equal(containerPool.recycleContainer.mock.calls.length, 1);
      assert.equal(containerPool.initializeContainer.mock.calls.length, 1);

      // Bot still has a valid container reference
      assert.ok(bot.container);
      assert.equal(bot.container.id, 'new-container-456');
    });
  });

  describe('BotReloaderError', () => {
    test('has correct name', () => {
      const err = new BotReloaderError('test');
      assert.equal(err.name, 'BotReloaderError');
    });

    test('extends Error', () => {
      const err = new BotReloaderError('test');
      assert.ok(err instanceof Error);
    });

    test('stores cause', () => {
      const cause = new Error('original');
      const err = new BotReloaderError('wrapper', { cause });
      assert.equal(err.cause, cause);
    });

    test('stores operation', () => {
      const err = new BotReloaderError('test', { operation: 'reloadBotConfig' });
      assert.equal(err.operation, 'reloadBotConfig');
    });

    test('stores botId', () => {
      const err = new BotReloaderError('test', { botId: 'my-bot' });
      assert.equal(err.botId, 'my-bot');
    });

    test('has correct message', () => {
      const err = new BotReloaderError('Something went wrong');
      assert.equal(err.message, 'Something went wrong');
    });
  });
});
