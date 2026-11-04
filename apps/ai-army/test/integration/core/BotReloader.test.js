/**
 * Integration tests for BotReloader
 *
 * Tests BotReloader with realistic multi-step workflows:
 * - Config-only reload: updates model/tools/temperature without container restart
 * - Soul-only reload: updates personality without container restart
 * - Sandbox change restart: recycles and recreates container with new config
 * - Combined workflows: sequential reloads mixing config, soul, and sandbox changes
 * - needsContainerRestart detection integrated with actual reload flow
 * - Error recovery: container failures during reload, state consistency
 *
 * Uses stateful mock BotManager, ContainerPool, and SoulLoader to verify
 * realistic component interaction patterns and state transitions.
 *
 * Run with: npm run test:integration
 */

import { describe, test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { BotReloader, BotReloaderError } from '../../../src/core/BotReloader.js';

// ============================================================================
// Stateful Mock Factories
// ============================================================================

/**
 * Create a stateful mock bot with realistic properties
 * @param {Object} [overrides] - Override default properties
 * @returns {Object} Mock bot
 */
function createStatefulBot(overrides = {}) {
  return {
    id: overrides.id || 'integ-bot',
    config: {
      id: overrides.id || 'integ-bot',
      name: 'Integration Test Bot',
      model: 'claude-haiku-4-5',
      temperature: 0.7,
      tools: ['bash', 'readFile'],
      sandbox: {
        image: 'node:22-slim',
        memory: '256m',
        cpus: 1,
        packages: ['git', 'python3'],
        mounts: ['/data:/data'],
        network: { mode: 'bridge' },
      },
      workspace: { root: './data/integ-bot' },
      ...overrides.config,
    },
    soulContent: overrides.soulContent || '# Integration Bot\nYou are a helpful assistant.',
    container: overrides.container || { id: 'container-abc-123', status: 'running' },
    status: overrides.status || 'running',
    lastActiveAt: overrides.lastActiveAt || new Date('2025-06-01T00:00:00Z'),
  };
}

/**
 * Create a stateful mock BotManager that maintains an internal bots Map
 * @param {Array<Object>} [initialBots] - Bots to preload
 * @returns {Object} Mock BotManager with stateful getBot
 */
function createStatefulBotManager(initialBots = []) {
  const botsMap = new Map();
  for (const bot of initialBots) {
    botsMap.set(bot.id, bot);
  }

  return {
    botsMap,
    getBot: mock.fn(botId => botsMap.get(botId)),
    listBots: mock.fn(() => Array.from(botsMap.values())),
  };
}

/**
 * Create a stateful mock ContainerPool that tracks container lifecycle
 * @param {Object} [options] - Configuration options
 * @returns {Object} Mock ContainerPool with call tracking
 */
function createStatefulContainerPool(options = {}) {
  const containers = new Map();
  let containerSeq = 0;

  // Pre-populate containers for existing bots
  if (options.existingContainers) {
    for (const [botId, container] of Object.entries(options.existingContainers)) {
      containers.set(botId, container);
    }
  }

  return {
    containers,
    hasContainer: mock.fn(botId => containers.has(botId)),
    recycleContainer: mock.fn(async botId => {
      if (options.recycleError) {
        throw new Error(options.recycleError);
      }
      if (!containers.has(botId)) {
        throw new Error(`No container found for '${botId}'`);
      }
      containers.delete(botId);
    }),
    initializeContainer: mock.fn(async (botId, config, _workspace) => {
      if (options.initError) {
        throw new Error(options.initError);
      }
      containerSeq++;
      const container = {
        id: `container-new-${containerSeq}`,
        image: config.sandbox?.image || 'default:latest',
        status: 'running',
      };
      containers.set(botId, container);
      return container;
    }),
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
 * Collect log messages for verification
 * @returns {{ logger: Function, messages: string[] }}
 */
function createLogger() {
  const messages = [];
  const logger = msg => messages.push(msg);
  return { logger, messages };
}

// ============================================================================
// Integration Tests
// ============================================================================

describe('BotReloader Integration', () => {
  let bot;
  let botManager;
  let containerPool;
  let soulLoader;
  let logCapture;
  let reloader;

  beforeEach(() => {
    bot = createStatefulBot();
    botManager = createStatefulBotManager([bot]);
    containerPool = createStatefulContainerPool({
      existingContainers: { 'integ-bot': { id: 'container-abc-123', status: 'running' } },
    });
    soulLoader = createMockSoulLoader();
    logCapture = createLogger();
    reloader = new BotReloader(botManager, containerPool, soulLoader, {
      logger: logCapture.logger,
    });
  });

  // ==========================================================================
  // Config-Only Reload (no container restart)
  // ==========================================================================

  describe('config-only reload', () => {
    test('updates model and temperature without container restart', async () => {
      const originalContainer = bot.container;
      const originalSoul = bot.soulContent;

      const newConfig = {
        ...bot.config,
        model: 'claude-sonnet-4-5',
        temperature: 0.9,
      };

      await reloader.reloadBotConfig('integ-bot', newConfig);

      // Config should be updated
      assert.equal(bot.config.model, 'claude-sonnet-4-5');
      assert.equal(bot.config.temperature, 0.9);

      // Container should be untouched
      assert.equal(bot.container, originalContainer);
      assert.equal(containerPool.recycleContainer.mock.calls.length, 0);
      assert.equal(containerPool.initializeContainer.mock.calls.length, 0);

      // Container should still exist in pool
      assert.ok(containerPool.containers.has('integ-bot'));

      // Soul should be unchanged
      assert.equal(bot.soulContent, originalSoul);
    });

    test('updates tools list without container restart', async () => {
      const newConfig = {
        ...bot.config,
        tools: ['bash', 'readFile', 'writeFile', 'glob', 'grep'],
      };

      await reloader.reloadBotConfig('integ-bot', newConfig);

      assert.deepEqual(bot.config.tools, ['bash', 'readFile', 'writeFile', 'glob', 'grep']);
      assert.equal(containerPool.recycleContainer.mock.calls.length, 0);
    });

    test('preserves bot ID when config lacks it', async () => {
      const newConfig = { model: 'gpt-4o', temperature: 0.5 };

      await reloader.reloadBotConfig('integ-bot', newConfig);

      assert.equal(bot.config.id, 'integ-bot');
      assert.equal(bot.config.model, 'gpt-4o');
    });

    test('updates lastActiveAt timestamp after config reload', async () => {
      const before = bot.lastActiveAt;

      // Small delay to ensure timestamp differs
      await new Promise(r => setTimeout(r, 10));
      await reloader.reloadBotConfig('integ-bot', { ...bot.config });

      assert.ok(bot.lastActiveAt > before, 'lastActiveAt should be updated');
    });

    test('sequential config reloads accumulate correctly', async () => {
      // First reload: change model
      await reloader.reloadBotConfig('integ-bot', {
        ...bot.config,
        model: 'claude-sonnet-4-5',
      });
      assert.equal(bot.config.model, 'claude-sonnet-4-5');

      // Second reload: change temperature (model should still be new)
      await reloader.reloadBotConfig('integ-bot', {
        ...bot.config,
        temperature: 0.3,
      });
      assert.equal(bot.config.model, 'claude-sonnet-4-5');
      assert.equal(bot.config.temperature, 0.3);

      // No container operations at all
      assert.equal(containerPool.recycleContainer.mock.calls.length, 0);
      assert.equal(containerPool.initializeContainer.mock.calls.length, 0);
    });

    test('config reload logs success message with no-restart indication', async () => {
      await reloader.reloadBotConfig('integ-bot', { ...bot.config });

      assert.ok(
        logCapture.messages.some(m => m.includes('config reloaded')),
        'Should log config reloaded'
      );
      assert.ok(
        logCapture.messages.some(m => m.includes('no container restart')),
        'Should indicate no container restart'
      );
    });
  });

  // ==========================================================================
  // Soul-Only Reload (no container restart)
  // ==========================================================================

  describe('soul-only reload', () => {
    test('updates soul content without container restart', async () => {
      const originalConfig = { ...bot.config };
      const originalContainer = bot.container;
      const newSoul = '# Updated Bot\nYou are now a DevOps expert who loves Docker.';

      await reloader.reloadSoul('integ-bot', newSoul);

      // Soul should be updated
      assert.equal(bot.soulContent, newSoul);

      // Config should be preserved
      assert.equal(bot.config.model, originalConfig.model);
      assert.equal(bot.config.temperature, originalConfig.temperature);
      assert.deepEqual(bot.config.sandbox, originalConfig.sandbox);
      assert.deepEqual(bot.config.tools, originalConfig.tools);

      // Container should be untouched
      assert.equal(bot.container, originalContainer);
      assert.equal(containerPool.recycleContainer.mock.calls.length, 0);
      assert.equal(containerPool.initializeContainer.mock.calls.length, 0);
    });

    test('allows replacing soul with empty string', async () => {
      await reloader.reloadSoul('integ-bot', '');

      assert.equal(bot.soulContent, '');
      assert.equal(containerPool.recycleContainer.mock.calls.length, 0);
    });

    test('supports multiline soul content with markdown', async () => {
      const richSoul = [
        '# Code Review Bot',
        '',
        '## Personality',
        'You are a meticulous code reviewer.',
        '',
        '## Rules',
        '- Always check for security vulnerabilities',
        '- Suggest performance improvements',
        '- Be constructive, not critical',
        '',
        '## Tools Available',
        '- `bash`: Run shell commands',
        '- `readFile`: Read source files',
      ].join('\n');

      await reloader.reloadSoul('integ-bot', richSoul);

      assert.equal(bot.soulContent, richSoul);
      assert.ok(bot.soulContent.includes('## Personality'));
      assert.ok(bot.soulContent.includes('security vulnerabilities'));
    });

    test('sequential soul reloads replace content completely', async () => {
      await reloader.reloadSoul('integ-bot', 'Version 1 personality');
      assert.equal(bot.soulContent, 'Version 1 personality');

      await reloader.reloadSoul('integ-bot', 'Version 2 personality');
      assert.equal(bot.soulContent, 'Version 2 personality');

      // No container operations
      assert.equal(containerPool.recycleContainer.mock.calls.length, 0);
    });

    test('updates lastActiveAt timestamp after soul reload', async () => {
      const before = bot.lastActiveAt;

      await new Promise(r => setTimeout(r, 10));
      await reloader.reloadSoul('integ-bot', 'new soul');

      assert.ok(bot.lastActiveAt > before, 'lastActiveAt should be updated');
    });

    test('soul reload logs success message with no-restart indication', async () => {
      await reloader.reloadSoul('integ-bot', 'updated soul');

      assert.ok(
        logCapture.messages.some(m => m.includes('soul reloaded')),
        'Should log soul reloaded'
      );
      assert.ok(
        logCapture.messages.some(m => m.includes('no container restart')),
        'Should indicate no container restart'
      );
    });
  });

  // ==========================================================================
  // Sandbox Change Restart
  // ==========================================================================

  describe('sandbox change restart', () => {
    test('recycles old container and creates new one when image changes', async () => {
      const newSandbox = {
        ...bot.config.sandbox,
        image: 'ubuntu:24.04',
      };

      await reloader.reloadContainer('integ-bot', newSandbox);

      // Old container should have been recycled
      assert.equal(containerPool.recycleContainer.mock.calls.length, 1);
      assert.equal(containerPool.recycleContainer.mock.calls[0].arguments[0], 'integ-bot');

      // New container should have been initialized
      assert.equal(containerPool.initializeContainer.mock.calls.length, 1);
      const [initBotId, initConfig] = containerPool.initializeContainer.mock.calls[0].arguments;
      assert.equal(initBotId, 'integ-bot');
      assert.equal(initConfig.sandbox.image, 'ubuntu:24.04');

      // Bot should reference the new container
      assert.equal(bot.container.id, 'container-new-1');
      assert.ok(containerPool.containers.has('integ-bot'));
    });

    test('restarts container when memory changes', async () => {
      const newSandbox = { ...bot.config.sandbox, memory: '1g' };

      await reloader.reloadContainer('integ-bot', newSandbox);

      assert.equal(containerPool.recycleContainer.mock.calls.length, 1);
      assert.equal(containerPool.initializeContainer.mock.calls.length, 1);
      assert.equal(bot.config.sandbox.memory, '1g');
    });

    test('restarts container when cpus change', async () => {
      const newSandbox = { ...bot.config.sandbox, cpus: 4 };

      await reloader.reloadContainer('integ-bot', newSandbox);

      assert.equal(containerPool.recycleContainer.mock.calls.length, 1);
      assert.equal(containerPool.initializeContainer.mock.calls.length, 1);
      assert.equal(bot.config.sandbox.cpus, 4);
    });

    test('restarts container when packages change', async () => {
      const newSandbox = {
        ...bot.config.sandbox,
        packages: ['git', 'python3', 'ripgrep', 'jq'],
      };

      await reloader.reloadContainer('integ-bot', newSandbox);

      assert.equal(containerPool.recycleContainer.mock.calls.length, 1);
      assert.equal(containerPool.initializeContainer.mock.calls.length, 1);
      assert.deepEqual(bot.config.sandbox.packages, ['git', 'python3', 'ripgrep', 'jq']);
    });

    test('restarts container when mounts change', async () => {
      const newSandbox = {
        ...bot.config.sandbox,
        mounts: ['/data:/data', '/logs:/logs'],
      };

      await reloader.reloadContainer('integ-bot', newSandbox);

      assert.equal(containerPool.recycleContainer.mock.calls.length, 1);
      assert.equal(containerPool.initializeContainer.mock.calls.length, 1);
    });

    test('restarts container when network changes', async () => {
      const newSandbox = {
        ...bot.config.sandbox,
        network: { mode: 'host' },
      };

      await reloader.reloadContainer('integ-bot', newSandbox);

      assert.equal(containerPool.recycleContainer.mock.calls.length, 1);
      assert.equal(containerPool.initializeContainer.mock.calls.length, 1);
    });

    test('updates bot sandbox config after restart', async () => {
      const newSandbox = {
        image: 'python:3.12-slim',
        memory: '512m',
        cpus: 2,
        packages: ['poetry'],
      };

      await reloader.reloadContainer('integ-bot', newSandbox);

      assert.deepEqual(bot.config.sandbox, newSandbox);
    });

    test('preserves non-sandbox config during container restart', async () => {
      const originalModel = bot.config.model;
      const originalTools = [...bot.config.tools];

      await reloader.reloadContainer('integ-bot', {
        image: 'ubuntu:24.04',
        memory: '1g',
      });

      assert.equal(bot.config.model, originalModel);
      assert.deepEqual(bot.config.tools, originalTools);
    });

    test('uses default workspace when bot config has none', async () => {
      delete bot.config.workspace;

      await reloader.reloadContainer('integ-bot', { image: 'alpine:latest' });

      const [, , workspace] = containerPool.initializeContainer.mock.calls[0].arguments;
      assert.deepEqual(workspace, { root: './data/integ-bot' });
    });

    test('skips recycle when no existing container in pool', async () => {
      // Remove the container from the pool
      containerPool.containers.delete('integ-bot');

      await reloader.reloadContainer('integ-bot', { image: 'alpine:latest' });

      // recycleContainer should NOT have been called
      assert.equal(containerPool.recycleContainer.mock.calls.length, 0);
      // But initializeContainer should still be called
      assert.equal(containerPool.initializeContainer.mock.calls.length, 1);

      // New container should be in the pool
      assert.ok(containerPool.containers.has('integ-bot'));
    });

    test('logs restart progress messages', async () => {
      await reloader.reloadContainer('integ-bot', { image: 'alpine:latest' });

      assert.ok(
        logCapture.messages.some(m => m.includes('Restarting container')),
        'Should log restart start'
      );
      assert.ok(
        logCapture.messages.some(m => m.includes('container restarted')),
        'Should log restart completion'
      );
    });

    test('updates lastActiveAt after container restart', async () => {
      const before = bot.lastActiveAt;

      await new Promise(r => setTimeout(r, 10));
      await reloader.reloadContainer('integ-bot', { image: 'alpine:latest' });

      assert.ok(bot.lastActiveAt > before, 'lastActiveAt should be updated');
    });
  });

  // ==========================================================================
  // needsContainerRestart Detection
  // ==========================================================================

  describe('needsContainerRestart detection in workflow', () => {
    test('correctly identifies config-only change as no restart', () => {
      const oldConfig = {
        model: 'claude-haiku-4-5',
        sandbox: { image: 'node:22-slim', memory: '256m' },
      };
      const newConfig = {
        model: 'claude-sonnet-4-5',
        sandbox: { image: 'node:22-slim', memory: '256m' },
      };

      assert.equal(reloader.needsContainerRestart(oldConfig, newConfig), false);
    });

    test('correctly identifies image change as requiring restart', () => {
      const oldConfig = {
        model: 'claude-haiku-4-5',
        sandbox: { image: 'node:22-slim', memory: '256m' },
      };
      const newConfig = {
        model: 'claude-haiku-4-5',
        sandbox: { image: 'python:3.12-slim', memory: '256m' },
      };

      assert.equal(reloader.needsContainerRestart(oldConfig, newConfig), true);
    });

    test('integrates detection with conditional reload flow', async () => {
      const oldConfig = { ...bot.config };
      const newConfig = {
        ...bot.config,
        model: 'claude-sonnet-4-5',
        temperature: 0.5,
      };

      // Step 1: Check if restart is needed
      const needsRestart = reloader.needsContainerRestart(oldConfig, newConfig);
      assert.equal(needsRestart, false);

      // Step 2: Since no restart needed, reload config only
      await reloader.reloadBotConfig('integ-bot', newConfig);

      assert.equal(bot.config.model, 'claude-sonnet-4-5');
      assert.equal(containerPool.recycleContainer.mock.calls.length, 0);
    });

    test('integrates detection and triggers restart for sandbox change', async () => {
      const oldConfig = { ...bot.config };
      const newConfig = {
        ...bot.config,
        sandbox: { ...bot.config.sandbox, image: 'ubuntu:24.04' },
      };

      // Step 1: Check if restart is needed
      const needsRestart = reloader.needsContainerRestart(oldConfig, newConfig);
      assert.equal(needsRestart, true);

      // Step 2: Restart is needed, so reload container
      await reloader.reloadContainer('integ-bot', newConfig.sandbox);

      assert.equal(containerPool.recycleContainer.mock.calls.length, 1);
      assert.equal(containerPool.initializeContainer.mock.calls.length, 1);
    });

    test('no restart for adding non-sandbox fields', () => {
      const oldConfig = { sandbox: { image: 'node:22-slim' } };
      const newConfig = {
        maxTokens: 4096,
        sandbox: { image: 'node:22-slim' },
      };

      assert.equal(reloader.needsContainerRestart(oldConfig, newConfig), false);
    });

    test('restart needed when sandbox removed entirely', () => {
      const oldConfig = { sandbox: { image: 'node:22-slim' } };
      const newConfig = {};

      assert.equal(reloader.needsContainerRestart(oldConfig, newConfig), true);
    });

    test('restart needed when sandbox added to previously bare config', () => {
      const oldConfig = { model: 'claude-haiku-4-5' };
      const newConfig = {
        model: 'claude-haiku-4-5',
        sandbox: { image: 'node:22-slim' },
      };

      assert.equal(reloader.needsContainerRestart(oldConfig, newConfig), true);
    });
  });

  // ==========================================================================
  // Combined Workflows
  // ==========================================================================

  describe('combined workflows', () => {
    test('config reload followed by soul reload (both no restart)', async () => {
      // Step 1: Reload config
      await reloader.reloadBotConfig('integ-bot', {
        ...bot.config,
        model: 'claude-sonnet-4-5',
      });

      // Step 2: Reload soul
      await reloader.reloadSoul('integ-bot', '# New Soul\nYou are a code reviewer.');

      // Verify both updates took effect
      assert.equal(bot.config.model, 'claude-sonnet-4-5');
      assert.equal(bot.soulContent, '# New Soul\nYou are a code reviewer.');

      // No container operations at all
      assert.equal(containerPool.recycleContainer.mock.calls.length, 0);
      assert.equal(containerPool.initializeContainer.mock.calls.length, 0);
    });

    test('config reload then container restart', async () => {
      // Step 1: Config-only reload (no restart)
      await reloader.reloadBotConfig('integ-bot', {
        ...bot.config,
        model: 'claude-sonnet-4-5',
      });

      assert.equal(containerPool.recycleContainer.mock.calls.length, 0);

      // Step 2: Sandbox change (requires restart)
      await reloader.reloadContainer('integ-bot', {
        ...bot.config.sandbox,
        image: 'python:3.12-slim',
      });

      assert.equal(containerPool.recycleContainer.mock.calls.length, 1);
      assert.equal(containerPool.initializeContainer.mock.calls.length, 1);

      // Both changes should be present
      assert.equal(bot.config.model, 'claude-sonnet-4-5');
      assert.equal(bot.config.sandbox.image, 'python:3.12-slim');
    });

    test('soul reload then container restart preserves soul', async () => {
      const newSoul = '# Expert Bot\nYou are a Kubernetes expert.';

      // Step 1: Soul reload
      await reloader.reloadSoul('integ-bot', newSoul);

      // Step 2: Container restart
      await reloader.reloadContainer('integ-bot', {
        ...bot.config.sandbox,
        memory: '2g',
      });

      // Soul should still be the updated version
      assert.equal(bot.soulContent, newSoul);
      assert.equal(bot.config.sandbox.memory, '2g');
    });

    test('full reload cycle: config + soul + container restart', async () => {
      // Step 1: Config reload
      await reloader.reloadBotConfig('integ-bot', {
        ...bot.config,
        model: 'claude-sonnet-4-5',
        temperature: 0.1,
      });

      // Step 2: Soul reload
      await reloader.reloadSoul('integ-bot', '# Precise Bot\nBe exact and concise.');

      // Step 3: Container restart
      await reloader.reloadContainer('integ-bot', {
        image: 'python:3.12-slim',
        memory: '1g',
        cpus: 2,
        packages: ['poetry', 'ruff'],
      });

      // All changes should be applied
      assert.equal(bot.config.model, 'claude-sonnet-4-5');
      assert.equal(bot.config.temperature, 0.1);
      assert.equal(bot.soulContent, '# Precise Bot\nBe exact and concise.');
      assert.equal(bot.config.sandbox.image, 'python:3.12-slim');
      assert.equal(bot.config.sandbox.memory, '1g');
      assert.deepEqual(bot.config.sandbox.packages, ['poetry', 'ruff']);

      // Container operations: 1 recycle + 1 initialize
      assert.equal(containerPool.recycleContainer.mock.calls.length, 1);
      assert.equal(containerPool.initializeContainer.mock.calls.length, 1);

      // New container should be assigned
      assert.equal(bot.container.id, 'container-new-1');
    });

    test('multiple container restarts create incrementing containers', async () => {
      // First restart
      await reloader.reloadContainer('integ-bot', {
        ...bot.config.sandbox,
        image: 'alpine:latest',
      });
      assert.equal(bot.container.id, 'container-new-1');

      // Second restart
      await reloader.reloadContainer('integ-bot', {
        ...bot.config.sandbox,
        image: 'ubuntu:24.04',
      });
      assert.equal(bot.container.id, 'container-new-2');

      // Third restart
      await reloader.reloadContainer('integ-bot', {
        ...bot.config.sandbox,
        image: 'debian:bookworm',
      });
      assert.equal(bot.container.id, 'container-new-3');

      // Should have recycled 3 times and initialized 3 times
      assert.equal(containerPool.recycleContainer.mock.calls.length, 3);
      assert.equal(containerPool.initializeContainer.mock.calls.length, 3);
    });
  });

  // ==========================================================================
  // Multi-Bot Scenarios
  // ==========================================================================

  describe('multi-bot scenarios', () => {
    let bot2;

    beforeEach(() => {
      bot2 = createStatefulBot({
        id: 'second-bot',
        config: {
          name: 'Second Bot',
          model: 'gpt-4o',
          sandbox: { image: 'python:3.12-slim', memory: '512m', cpus: 2 },
        },
        soulContent: '# Second Bot\nYou are a Python expert.',
      });
      botManager.botsMap.set('second-bot', bot2);
      containerPool.containers.set('second-bot', {
        id: 'container-second-456',
        status: 'running',
      });
    });

    test('reloading one bot does not affect another', async () => {
      const originalBot2Config = { ...bot2.config };
      const originalBot2Soul = bot2.soulContent;

      // Reload first bot
      await reloader.reloadBotConfig('integ-bot', {
        ...bot.config,
        model: 'claude-sonnet-4-5',
      });
      await reloader.reloadSoul('integ-bot', '# Updated personality');

      // Second bot should be unchanged
      assert.equal(bot2.config.model, originalBot2Config.model);
      assert.equal(bot2.soulContent, originalBot2Soul);
    });

    test('can reload different bots independently', async () => {
      // Reload first bot config
      await reloader.reloadBotConfig('integ-bot', {
        ...bot.config,
        model: 'claude-sonnet-4-5',
      });

      // Reload second bot soul
      await reloader.reloadSoul('second-bot', '# Updated Python Expert');

      assert.equal(bot.config.model, 'claude-sonnet-4-5');
      assert.equal(bot2.soulContent, '# Updated Python Expert');

      // No container restarts
      assert.equal(containerPool.recycleContainer.mock.calls.length, 0);
    });

    test('container restart for one bot does not recycle another', async () => {
      await reloader.reloadContainer('integ-bot', {
        ...bot.config.sandbox,
        image: 'ubuntu:24.04',
      });

      // First bot's container was recycled and recreated
      assert.equal(bot.container.id, 'container-new-1');

      // Second bot's container should still exist in pool
      assert.ok(containerPool.containers.has('second-bot'));
      assert.equal(containerPool.containers.get('second-bot').id, 'container-second-456');
    });
  });

  // ==========================================================================
  // Error Recovery
  // ==========================================================================

  describe('error recovery', () => {
    test('config reload for non-existent bot throws with context', async () => {
      await assert.rejects(
        () => reloader.reloadBotConfig('ghost-bot', { model: 'test' }),
        err => {
          assert.ok(err instanceof BotReloaderError);
          assert.ok(err.message.includes('ghost-bot'));
          assert.ok(err.message.includes('not found'));
          assert.equal(err.operation, 'reloadBotConfig');
          assert.equal(err.botId, 'ghost-bot');
          return true;
        }
      );
    });

    test('soul reload for non-existent bot throws with context', async () => {
      await assert.rejects(
        () => reloader.reloadSoul('ghost-bot', 'soul content'),
        err => {
          assert.ok(err instanceof BotReloaderError);
          assert.ok(err.message.includes('ghost-bot'));
          assert.equal(err.operation, 'reloadSoul');
          return true;
        }
      );
    });

    test('container restart for non-existent bot throws with context', async () => {
      await assert.rejects(
        () => reloader.reloadContainer('ghost-bot', { image: 'alpine' }),
        err => {
          assert.ok(err instanceof BotReloaderError);
          assert.ok(err.message.includes('ghost-bot'));
          assert.equal(err.operation, 'reloadContainer');
          return true;
        }
      );
    });

    test('container pool init failure wraps error', async () => {
      const failPool = createStatefulContainerPool({
        existingContainers: { 'integ-bot': { id: 'old', status: 'running' } },
        initError: 'Docker daemon not responding',
      });
      const failReloader = new BotReloader(botManager, failPool, soulLoader, {
        logger: logCapture.logger,
      });

      await assert.rejects(
        () => failReloader.reloadContainer('integ-bot', { image: 'alpine' }),
        err => {
          assert.ok(err instanceof BotReloaderError);
          assert.ok(err.message.includes('Docker daemon not responding'));
          assert.equal(err.operation, 'reloadContainer');
          assert.equal(err.botId, 'integ-bot');
          assert.ok(err.cause);
          return true;
        }
      );
    });

    test('container pool recycle failure wraps error', async () => {
      const failPool = createStatefulContainerPool({
        existingContainers: { 'integ-bot': { id: 'old', status: 'running' } },
        recycleError: 'Container locked by another process',
      });
      const failReloader = new BotReloader(botManager, failPool, soulLoader, {
        logger: logCapture.logger,
      });

      await assert.rejects(
        () => failReloader.reloadContainer('integ-bot', { image: 'alpine' }),
        err => {
          assert.ok(err instanceof BotReloaderError);
          assert.ok(err.message.includes('Container locked'));
          assert.equal(err.operation, 'reloadContainer');
          return true;
        }
      );
    });

    test('bot state is preserved after config reload failure', async () => {
      const originalConfig = { ...bot.config };
      const originalSoul = bot.soulContent;

      // Try to reload a non-existent bot (should fail)
      try {
        await reloader.reloadBotConfig('ghost-bot', { model: 'test' });
      } catch {
        // expected
      }

      // Original bot should be completely unchanged
      assert.deepEqual(bot.config.model, originalConfig.model);
      assert.equal(bot.soulContent, originalSoul);
    });

    test('invalid bot ID throws for all methods', async () => {
      const methods = [
        () => reloader.reloadBotConfig('', {}),
        () => reloader.reloadBotConfig(null, {}),
        () => reloader.reloadSoul('', 'soul'),
        () => reloader.reloadSoul(null, 'soul'),
        () => reloader.reloadContainer('', { image: 'alpine' }),
        () => reloader.reloadContainer(null, { image: 'alpine' }),
      ];

      for (const method of methods) {
        await assert.rejects(method, err => {
          assert.ok(err instanceof BotReloaderError);
          assert.ok(err.message.includes('non-empty string'));
          return true;
        });
      }
    });

    test('invalid arguments throw for config and container methods', async () => {
      await assert.rejects(
        () => reloader.reloadBotConfig('integ-bot', null),
        err => {
          assert.ok(err instanceof BotReloaderError);
          assert.ok(err.message.includes('non-null object'));
          return true;
        }
      );

      await assert.rejects(
        () => reloader.reloadContainer('integ-bot', null),
        err => {
          assert.ok(err instanceof BotReloaderError);
          assert.ok(err.message.includes('non-null object'));
          return true;
        }
      );

      await assert.rejects(
        () => reloader.reloadSoul('integ-bot', 42),
        err => {
          assert.ok(err instanceof BotReloaderError);
          assert.ok(err.message.includes('must be a string'));
          return true;
        }
      );
    });
  });

  // ==========================================================================
  // Session Preservation
  // ==========================================================================

  describe('session preservation during reload', () => {
    test('config reload does not touch container pool', async () => {
      await reloader.reloadBotConfig('integ-bot', {
        ...bot.config,
        model: 'claude-sonnet-4-5',
      });

      // No container operations means sessions in DB are safe
      assert.equal(containerPool.hasContainer.mock.calls.length, 0);
      assert.equal(containerPool.recycleContainer.mock.calls.length, 0);
      assert.equal(containerPool.initializeContainer.mock.calls.length, 0);
    });

    test('soul reload does not touch container pool', async () => {
      await reloader.reloadSoul('integ-bot', 'new soul');

      assert.equal(containerPool.hasContainer.mock.calls.length, 0);
      assert.equal(containerPool.recycleContainer.mock.calls.length, 0);
      assert.equal(containerPool.initializeContainer.mock.calls.length, 0);
    });

    test('container restart only affects container, not session state', async () => {
      // Sessions live in PostgreSQL, not in containers.
      // After container restart, bot.container changes but sessions are untouched.
      const originalId = bot.container.id;

      await reloader.reloadContainer('integ-bot', { image: 'ubuntu:24.04' });

      // Container changed
      assert.notEqual(bot.container.id, originalId);
      assert.equal(bot.container.id, 'container-new-1');

      // Bot still exists and is functional
      assert.equal(bot.config.id, 'integ-bot');
      assert.ok(bot.lastActiveAt instanceof Date);
    });
  });

  // ==========================================================================
  // Logging Verification
  // ==========================================================================

  describe('logging', () => {
    test('config reload logs exactly one success message', async () => {
      await reloader.reloadBotConfig('integ-bot', { ...bot.config });

      const successLogs = logCapture.messages.filter(m => m.includes('✅'));
      assert.equal(successLogs.length, 1);
      assert.ok(successLogs[0].includes('integ-bot'));
    });

    test('soul reload logs exactly one success message', async () => {
      await reloader.reloadSoul('integ-bot', 'new soul');

      const successLogs = logCapture.messages.filter(m => m.includes('✅'));
      assert.equal(successLogs.length, 1);
      assert.ok(successLogs[0].includes('integ-bot'));
    });

    test('container restart logs progress and completion', async () => {
      await reloader.reloadContainer('integ-bot', { image: 'alpine:latest' });

      // Should have both "restarting" and "restarted" messages
      assert.ok(
        logCapture.messages.some(m => m.includes('🔄')),
        'Should log restart start'
      );
      assert.ok(
        logCapture.messages.some(m => m.includes('✅')),
        'Should log restart completion'
      );
      assert.equal(logCapture.messages.length, 2, 'Should have exactly 2 log messages');
    });

    test('no logging when logger is not provided', async () => {
      const silentReloader = new BotReloader(botManager, containerPool, soulLoader);

      // Should not throw when logging internally
      await silentReloader.reloadBotConfig('integ-bot', { ...bot.config });
      await silentReloader.reloadSoul('integ-bot', 'new soul');
      await silentReloader.reloadContainer('integ-bot', { image: 'alpine:latest' });

      // If we got here without throwing, logging is handled gracefully
      assert.ok(true);
    });
  });
});
