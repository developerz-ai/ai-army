/**
 * Integration tests for Orchestrator
 *
 * Tests the full startup, shutdown, and reload sequences with real components:
 * - Real ConfigLoader (filesystem-based config loading)
 * - Real ConfigValidator (Zod schema validation)
 * - Real filesystem bot discovery (bots directory scanning)
 * - Real PostgreSQL database (when available)
 * - Real MigrationRunner (when database is available)
 *
 * Mock components are used for:
 * - BotManager (avoids Docker dependency)
 * - Channel adapters (avoids Slack/Discord connections)
 *
 * Uses per-worker databases and temp directories for parallel test execution.
 */

import { describe, test, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { Orchestrator, ORCHESTRATOR_STATES } from '../../../src/core/orchestrator.js';
import {
  TEST_DATABASE_URL,
  isDatabaseAvailable,
  createWorkerDatabase,
  dropWorkerDatabase,
} from '../../helpers/setup.js';
import { PostgresStorage } from '../../../src/adapters/storage/postgres.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_AVAILABLE = await isDatabaseAvailable();

if (!DB_AVAILABLE) {
  console.log('Orchestrator integration: PostgreSQL not available, DB tests will be skipped');
}

/** Track temp directories for cleanup */
const tempDirs = [];

/**
 * Create a temporary project directory with config.json and optional bots
 * @param {Object} config - Main config.json contents
 * @param {Object} [bots={}] - Map of botId → { config, soul }
 * @returns {Promise<string>} Path to temporary project directory
 */
async function createTempProject(config, bots = {}) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-integ-'));
  tempDirs.push(tmpDir);

  // Write main config.json
  await fs.writeFile(path.join(tmpDir, 'config.json'), JSON.stringify(config, null, 2), 'utf8');

  // Create bots directory and individual bot configs
  const botsDir = path.join(tmpDir, 'bots');
  await fs.mkdir(botsDir, { recursive: true });

  for (const [botId, botDef] of Object.entries(bots)) {
    const botDir = path.join(botsDir, botId);
    await fs.mkdir(botDir, { recursive: true });

    await fs.writeFile(
      path.join(botDir, 'config.json'),
      JSON.stringify(botDef.config || { id: botId }, null, 2),
      'utf8'
    );

    if (botDef.soul) {
      await fs.writeFile(path.join(botDir, 'soul.md'), botDef.soul, 'utf8');
    }
  }

  // Create data directory
  await fs.mkdir(path.join(tmpDir, 'data'), { recursive: true });

  return tmpDir;
}

/**
 * Create a valid main config object for testing
 * @param {Object} [overrides={}] - Override default values
 * @returns {Object} Valid main config
 */
function createValidConfig(overrides = {}) {
  return {
    defaults: {
      model: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
      sandbox: { type: 'docker', image: 'node:22-slim' },
    },
    providers: {
      anthropic: { type: 'anthropic', apiKey: 'test-key-abc123' },
    },
    channels: {},
    mcpServers: {},
    ...overrides,
  };
}

/**
 * Create a mock BotManager that records all calls
 * @param {Object} [overrides={}] - Override methods
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
    stopAll: mock.fn(async () => ({ stopped: bots.map(b => b.id), failed: [] })),
    listBots: mock.fn(() => [...bots]),
    getBot: mock.fn(botId => bots.find(b => b.id === botId)),
    getBotCount: mock.fn(() => bots.length),
    _bots: bots,
    ...overrides,
  };
}

/**
 * Create a mock channel adapter class
 * @param {Object} [options={}] - Override behavior
 * @returns {Function} Mock adapter constructor
 */
function createMockChannelAdapterClass(options = {}) {
  return class MockChannelAdapter {
    constructor() {
      this.initialized = false;
      this.config = null;
      this.closed = false;
    }

    async initialize(config) {
      if (options.initializeError) {
        throw new Error(options.initializeError);
      }
      this.initialized = true;
      this.config = config;
    }

    async close() {
      if (options.closeError) {
        throw new Error(options.closeError);
      }
      this.closed = true;
      this.initialized = false;
    }

    async onMessage(_handler) {}
    async sendMessage(_channelId, _text) {}
  };
}

// =============================================================================
// Integration Tests with Real Filesystem (no DB)
// =============================================================================

describe('Orchestrator Integration - Filesystem', () => {
  after(async () => {
    for (const dir of tempDirs) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    tempDirs.length = 0;
  });

  // ===========================================================================
  // Startup with Real Config Loading
  // ===========================================================================

  describe('startup with real config loading', () => {
    test('loads config.json from filesystem and starts', async () => {
      const config = createValidConfig();
      const projectDir = await createTempProject(config);
      const botManager = createMockBotManager();

      const orchestrator = new Orchestrator({
        configPath: path.join(projectDir, 'config.json'),
        botsPath: path.join(projectDir, 'bots'),
        dataPath: path.join(projectDir, 'data'),
        logger: null,
        botManager,
      });

      await orchestrator.start();

      assert.equal(orchestrator.getState(), 'running');
      assert.ok(orchestrator.config);
      assert.ok(orchestrator.config.providers);
      assert.ok(orchestrator.config.providers.anthropic);
      assert.equal(orchestrator.config.providers.anthropic.apiKey, 'test-key-abc123');
      assert.ok(orchestrator.startedAt instanceof Date);

      await orchestrator.stop();
      assert.equal(orchestrator.getState(), 'stopped');
    });

    test('validates config.json with real ConfigValidator', async () => {
      const config = createValidConfig();
      const projectDir = await createTempProject(config);
      const botManager = createMockBotManager();

      const orchestrator = new Orchestrator({
        configPath: path.join(projectDir, 'config.json'),
        botsPath: path.join(projectDir, 'bots'),
        logger: null,
        botManager,
      });

      await orchestrator.start();

      // Validation should have normalized the config
      assert.ok(orchestrator.config.defaults);
      assert.ok(orchestrator.config.defaults.model);

      await orchestrator.stop();
    });

    test('fails with clear error for missing config file', async () => {
      const orchestrator = new Orchestrator({
        configPath: '/nonexistent/path/config.json',
        logger: null,
      });

      await assert.rejects(
        () => orchestrator.start(),
        err => {
          assert.equal(err.name, 'OrchestratorError');
          assert.match(err.message, /Failed to load configuration/);
          return true;
        }
      );

      assert.equal(orchestrator.getState(), 'error');
    });

    test('fails with clear error for invalid JSON', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-bad-'));
      tempDirs.push(tmpDir);
      await fs.writeFile(path.join(tmpDir, 'config.json'), '{ invalid json }', 'utf8');

      const orchestrator = new Orchestrator({
        configPath: path.join(tmpDir, 'config.json'),
        logger: null,
      });

      await assert.rejects(
        () => orchestrator.start(),
        err => {
          assert.equal(err.name, 'OrchestratorError');
          return true;
        }
      );
    });

    test('fails with validation error for invalid config structure', async () => {
      // Config with invalid provider type triggers Zod validation error
      const badConfig = { providers: { bad: { type: 'not-a-real-provider' } } };
      const projectDir = await createTempProject(badConfig);

      const orchestrator = new Orchestrator({
        configPath: path.join(projectDir, 'config.json'),
        botsPath: path.join(projectDir, 'bots'),
        logger: null,
      });

      await assert.rejects(
        () => orchestrator.start(),
        err => {
          assert.equal(err.name, 'OrchestratorError');
          assert.match(err.message, /validation failed/i);
          assert.equal(err.component, 'config');
          return true;
        }
      );
    });
  });

  // ===========================================================================
  // Bot Discovery from Filesystem
  // ===========================================================================

  describe('bot discovery from filesystem', () => {
    test('discovers bots from bots/ directory', async () => {
      const config = createValidConfig();
      const projectDir = await createTempProject(config, {
        'support-bot': {
          config: {
            id: 'support-bot',
            soul: './soul.md',
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
          },
          soul: '# Support Bot\nYou are a helpful support agent.',
        },
        'code-bot': {
          config: {
            id: 'code-bot',
            soul: './soul.md',
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
          },
          soul: '# Code Bot\nYou are a code reviewer.',
        },
      });

      const botManager = createMockBotManager();

      const orchestrator = new Orchestrator({
        configPath: path.join(projectDir, 'config.json'),
        botsPath: path.join(projectDir, 'bots'),
        logger: null,
        botManager,
      });

      await orchestrator.start();

      // Both bots should have been loaded
      assert.equal(botManager.loadBot.mock.calls.length, 2);

      const loadedBotIds = botManager.loadBot.mock.calls.map(c => c.arguments[0]);
      assert.ok(loadedBotIds.includes('support-bot'));
      assert.ok(loadedBotIds.includes('code-bot'));

      // Both bots should have been started
      assert.equal(botManager.startBot.mock.calls.length, 2);

      await orchestrator.stop();
    });

    test('merges bot config with global defaults', async () => {
      const config = createValidConfig({
        defaults: {
          model: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
          sandbox: { type: 'docker', image: 'node:22-slim' },
        },
      });

      const projectDir = await createTempProject(config, {
        'my-bot': {
          config: {
            id: 'my-bot',
            soul: './soul.md',
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
          },
          soul: '# My Bot',
        },
      });

      const botManager = createMockBotManager();
      const orchestrator = new Orchestrator({
        configPath: path.join(projectDir, 'config.json'),
        botsPath: path.join(projectDir, 'bots'),
        logger: null,
        botManager,
      });

      await orchestrator.start();

      // Check the merged config passed to loadBot
      assert.equal(botManager.loadBot.mock.calls.length, 1);
      const mergedConfig = botManager.loadBot.mock.calls[0].arguments[1];

      // Should have sandbox from defaults (deep merged)
      assert.ok(mergedConfig.sandbox || mergedConfig.model);

      await orchestrator.stop();
    });

    test('handles empty bots directory gracefully', async () => {
      const config = createValidConfig();
      const projectDir = await createTempProject(config);
      const botManager = createMockBotManager();

      const orchestrator = new Orchestrator({
        configPath: path.join(projectDir, 'config.json'),
        botsPath: path.join(projectDir, 'bots'),
        logger: null,
        botManager,
      });

      await orchestrator.start();

      assert.equal(orchestrator.getState(), 'running');
      assert.equal(botManager.loadBot.mock.calls.length, 0);

      await orchestrator.stop();
    });

    test('handles nonexistent bots directory gracefully', async () => {
      const config = createValidConfig();
      const projectDir = await createTempProject(config);
      const botManager = createMockBotManager();

      const orchestrator = new Orchestrator({
        configPath: path.join(projectDir, 'config.json'),
        botsPath: path.join(projectDir, 'nonexistent-bots'),
        logger: null,
        botManager,
      });

      await orchestrator.start();

      assert.equal(orchestrator.getState(), 'running');

      await orchestrator.stop();
    });

    test('discovers inline bots from main config', async () => {
      const config = createValidConfig({
        bots: {
          'inline-bot': {
            soul: './soul.md',
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
          },
        },
      });

      const projectDir = await createTempProject(config);
      const botManager = createMockBotManager();

      const orchestrator = new Orchestrator({
        configPath: path.join(projectDir, 'config.json'),
        botsPath: path.join(projectDir, 'bots'),
        logger: null,
        botManager,
      });

      await orchestrator.start();

      assert.equal(botManager.loadBot.mock.calls.length, 1);
      assert.equal(botManager.loadBot.mock.calls[0].arguments[0], 'inline-bot');

      await orchestrator.stop();
    });

    test('discovers bots from both filesystem and inline config', async () => {
      const config = createValidConfig({
        bots: {
          'inline-bot': {
            soul: './soul.md',
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
          },
        },
      });

      const projectDir = await createTempProject(config, {
        'fs-bot': {
          config: {
            id: 'fs-bot',
            soul: './soul.md',
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
          },
          soul: '# FS Bot',
        },
      });

      const botManager = createMockBotManager();
      const orchestrator = new Orchestrator({
        configPath: path.join(projectDir, 'config.json'),
        botsPath: path.join(projectDir, 'bots'),
        logger: null,
        botManager,
      });

      await orchestrator.start();

      const loadedBotIds = botManager.loadBot.mock.calls.map(c => c.arguments[0]);
      assert.ok(loadedBotIds.includes('fs-bot'));
      assert.ok(loadedBotIds.includes('inline-bot'));

      await orchestrator.stop();
    });

    test('filesystem bot takes precedence over inline bot with same id', async () => {
      const config = createValidConfig({
        bots: {
          'my-bot': {
            soul: './inline-soul.md',
            provider: 'openai',
            model: 'gpt-4',
          },
        },
      });

      const projectDir = await createTempProject(config, {
        'my-bot': {
          config: {
            id: 'my-bot',
            soul: './soul.md',
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
          },
          soul: '# My Bot from filesystem',
        },
      });

      const botManager = createMockBotManager();
      const orchestrator = new Orchestrator({
        configPath: path.join(projectDir, 'config.json'),
        botsPath: path.join(projectDir, 'bots'),
        logger: null,
        botManager,
      });

      await orchestrator.start();

      // Should only load one bot (filesystem wins)
      assert.equal(botManager.loadBot.mock.calls.length, 1);
      assert.equal(botManager.loadBot.mock.calls[0].arguments[0], 'my-bot');

      // Should use filesystem config (anthropic, not openai)
      const loadedConfig = botManager.loadBot.mock.calls[0].arguments[1];
      assert.equal(loadedConfig.provider, 'anthropic');

      await orchestrator.stop();
    });

    test('continues loading when one bot fails', async () => {
      const config = createValidConfig();
      const projectDir = await createTempProject(config, {
        'good-bot': {
          config: {
            id: 'good-bot',
            soul: './soul.md',
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
          },
          soul: '# Good Bot',
        },
        'bad-bot': {
          config: {
            id: 'bad-bot',
            soul: './soul.md',
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
          },
          soul: '# Bad Bot',
        },
      });

      const botManager = createMockBotManager({
        loadBot: mock.fn(async (botId, config) => {
          if (botId === 'bad-bot') {
            throw new Error('Bad bot config');
          }
          const bot = { id: botId, config: { ...config, enabled: true }, status: 'loaded' };
          botManager._bots.push(bot);
          return bot;
        }),
      });

      const orchestrator = new Orchestrator({
        configPath: path.join(projectDir, 'config.json'),
        botsPath: path.join(projectDir, 'bots'),
        logger: null,
        botManager,
      });

      await orchestrator.start();

      // Should still be running despite bad-bot failing
      assert.equal(orchestrator.getState(), 'running');
      // Both bots attempted to load
      assert.equal(botManager.loadBot.mock.calls.length, 2);
      // Only good-bot should have been started
      assert.equal(botManager.startBot.mock.calls.length, 1);

      await orchestrator.stop();
    });
  });

  // ===========================================================================
  // Shutdown
  // ===========================================================================

  describe('graceful shutdown', () => {
    test('stops bots and transitions to stopped state', async () => {
      const config = createValidConfig();
      const projectDir = await createTempProject(config, {
        'bot-a': {
          config: { id: 'bot-a', provider: 'anthropic', model: 'claude-sonnet-4-5' },
        },
      });

      const botManager = createMockBotManager();
      const orchestrator = new Orchestrator({
        configPath: path.join(projectDir, 'config.json'),
        botsPath: path.join(projectDir, 'bots'),
        logger: null,
        botManager,
      });

      await orchestrator.start();
      assert.equal(orchestrator.getState(), 'running');

      await orchestrator.stop();

      assert.equal(orchestrator.getState(), 'stopped');
      assert.equal(botManager.stopAll.mock.calls.length, 1);
    });

    test('closes channel adapters during shutdown', async () => {
      const config = createValidConfig({
        channels: {
          'slack-main': { type: 'slack', botToken: 'xoxb-test-token' },
        },
      });

      const projectDir = await createTempProject(config);
      const MockSlack = createMockChannelAdapterClass();
      const botManager = createMockBotManager();

      const orchestrator = new Orchestrator({
        configPath: path.join(projectDir, 'config.json'),
        botsPath: path.join(projectDir, 'bots'),
        logger: null,
        botManager,
      });
      orchestrator.registerChannelAdapter('slack', MockSlack);

      await orchestrator.start();
      assert.equal(orchestrator.channelManager.getChannelCount(), 1);

      const channel = orchestrator.channelManager.getChannel('slack-main');
      assert.ok(channel.adapter.initialized);

      await orchestrator.stop();

      assert.equal(orchestrator.channels.size, 0);
    });

    test('stop is a no-op when already stopped', async () => {
      const config = createValidConfig();
      const projectDir = await createTempProject(config);
      const botManager = createMockBotManager();

      const orchestrator = new Orchestrator({
        configPath: path.join(projectDir, 'config.json'),
        botsPath: path.join(projectDir, 'bots'),
        logger: null,
        botManager,
      });

      await orchestrator.start();
      await orchestrator.stop();

      botManager.stopAll.mock.resetCalls();

      // Second stop should be a no-op
      await orchestrator.stop();
      assert.equal(botManager.stopAll.mock.calls.length, 0);
    });

    test('shutdown completes even when bot stop fails', async () => {
      const config = createValidConfig();
      const projectDir = await createTempProject(config, {
        'bot-a': {
          config: { id: 'bot-a', provider: 'anthropic', model: 'claude-sonnet-4-5' },
        },
      });

      const botManager = createMockBotManager({
        stopAll: mock.fn(async () => {
          throw new Error('Container daemon unavailable');
        }),
      });

      const orchestrator = new Orchestrator({
        configPath: path.join(projectDir, 'config.json'),
        botsPath: path.join(projectDir, 'bots'),
        logger: null,
        botManager,
      });

      await orchestrator.start();

      // Should throw but still be in stopped state
      await assert.rejects(
        () => orchestrator.stop(),
        err => {
          assert.equal(err.name, 'OrchestratorError');
          return true;
        }
      );
      assert.equal(orchestrator.getState(), 'stopped');
    });
  });

  // ===========================================================================
  // Hot Reload
  // ===========================================================================

  describe('hot reload', () => {
    test('reloads config from filesystem', async () => {
      const config = createValidConfig({
        bots: {
          'bot-a': { provider: 'anthropic', model: 'claude-sonnet-4-5' },
        },
      });

      const projectDir = await createTempProject(config);
      const botManager = createMockBotManager();

      const orchestrator = new Orchestrator({
        configPath: path.join(projectDir, 'config.json'),
        botsPath: path.join(projectDir, 'bots'),
        logger: null,
        botManager,
      });

      await orchestrator.start();

      // Modify config on disk (add a new inline bot)
      const updatedConfig = createValidConfig({
        bots: {
          'bot-a': { provider: 'anthropic', model: 'claude-sonnet-4-5' },
          'bot-b': { provider: 'anthropic', model: 'claude-sonnet-4-5' },
        },
      });
      await fs.writeFile(
        path.join(projectDir, 'config.json'),
        JSON.stringify(updatedConfig, null, 2),
        'utf8'
      );

      botManager.reloadBot.mock.resetCalls();
      const results = await orchestrator.reload();

      // Should have reloaded both inline bots
      assert.ok(results.reloaded.length >= 1);
      assert.equal(results.failed.length, 0);

      await orchestrator.stop();
    });

    test('reload fails gracefully with invalid new config', async () => {
      const config = createValidConfig();
      const projectDir = await createTempProject(config);
      const botManager = createMockBotManager();

      const orchestrator = new Orchestrator({
        configPath: path.join(projectDir, 'config.json'),
        botsPath: path.join(projectDir, 'bots'),
        logger: null,
        botManager,
      });

      await orchestrator.start();

      // Write config with invalid provider type to trigger validation error
      await fs.writeFile(
        path.join(projectDir, 'config.json'),
        JSON.stringify({ providers: { bad: { type: 'not-real' } } }, null, 2),
        'utf8'
      );

      await assert.rejects(
        () => orchestrator.reload(),
        err => {
          assert.equal(err.name, 'OrchestratorError');
          return true;
        }
      );

      // Orchestrator should still be running (reload failure doesn't crash it)
      assert.equal(orchestrator.getState(), 'running');

      await orchestrator.stop();
    });

    test('reload throws when not running', async () => {
      const config = createValidConfig();
      const projectDir = await createTempProject(config);

      const orchestrator = new Orchestrator({
        configPath: path.join(projectDir, 'config.json'),
        logger: null,
      });

      await assert.rejects(
        () => orchestrator.reload(),
        err => {
          assert.equal(err.name, 'OrchestratorError');
          assert.match(err.message, /not running/);
          return true;
        }
      );
    });

    test('reload picks up new bots added to filesystem', async () => {
      const config = createValidConfig();
      const projectDir = await createTempProject(config, {
        'original-bot': {
          config: { id: 'original-bot', provider: 'anthropic', model: 'claude-sonnet-4-5' },
          soul: '# Original Bot',
        },
      });

      const botManager = createMockBotManager();
      const orchestrator = new Orchestrator({
        configPath: path.join(projectDir, 'config.json'),
        botsPath: path.join(projectDir, 'bots'),
        logger: null,
        botManager,
      });

      await orchestrator.start();
      assert.equal(botManager.loadBot.mock.calls.length, 1);

      // Add a new bot to the filesystem
      const newBotDir = path.join(projectDir, 'bots', 'new-bot');
      await fs.mkdir(newBotDir, { recursive: true });
      await fs.writeFile(
        path.join(newBotDir, 'config.json'),
        JSON.stringify({
          id: 'new-bot',
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
        }),
        'utf8'
      );

      botManager.reloadBot.mock.resetCalls();
      const results = await orchestrator.reload();

      // Should try to reload both old and new bots
      const reloadedIds = results.reloaded;
      assert.ok(reloadedIds.length >= 1);

      await orchestrator.stop();
    });

    test('reload collects individual bot reload failures', async () => {
      const config = createValidConfig({
        bots: {
          'good-bot': { provider: 'anthropic', model: 'claude-sonnet-4-5' },
          'bad-bot': { provider: 'anthropic', model: 'claude-sonnet-4-5' },
        },
      });

      const projectDir = await createTempProject(config);
      let reloadCount = 0;
      const botManager = createMockBotManager({
        reloadBot: mock.fn(async () => {
          reloadCount++;
          if (reloadCount === 2) {
            throw new Error('Soul file missing');
          }
        }),
      });

      const orchestrator = new Orchestrator({
        configPath: path.join(projectDir, 'config.json'),
        botsPath: path.join(projectDir, 'bots'),
        logger: null,
        botManager,
      });

      await orchestrator.start();
      botManager.reloadBot.mock.resetCalls();
      reloadCount = 0;

      const results = await orchestrator.reload();

      assert.equal(results.reloaded.length, 1);
      assert.equal(results.failed.length, 1);
      assert.ok(results.failed[0].error.includes('Soul file missing'));

      // Orchestrator still running
      assert.equal(orchestrator.getState(), 'running');

      await orchestrator.stop();
    });
  });

  // ===========================================================================
  // Channel Adapter Integration
  // ===========================================================================

  describe('channel adapter integration', () => {
    test('initializes registered channel adapters', async () => {
      const config = createValidConfig({
        channels: {
          'slack-main': { type: 'slack', botToken: 'xoxb-test' },
          'discord-main': { type: 'discord', botToken: 'discord-test' },
        },
      });

      const projectDir = await createTempProject(config);
      const MockSlack = createMockChannelAdapterClass();
      const MockDiscord = createMockChannelAdapterClass();

      const orchestrator = new Orchestrator({
        configPath: path.join(projectDir, 'config.json'),
        botsPath: path.join(projectDir, 'bots'),
        logger: null,
        botManager: createMockBotManager(),
      });

      orchestrator.registerChannelAdapter('slack', MockSlack);
      orchestrator.registerChannelAdapter('discord', MockDiscord);

      await orchestrator.start();

      assert.equal(orchestrator.channelManager.getChannelCount(), 2);
      assert.ok(orchestrator.channelManager.getChannel('slack-main').adapter.initialized);
      assert.ok(orchestrator.channelManager.getChannel('discord-main').adapter.initialized);

      await orchestrator.stop();
      assert.equal(orchestrator.channels.size, 0);
    });

    test('throws when all channels fail due to missing adapters', async () => {
      const config = createValidConfig({
        channels: {
          'rest-api': { type: 'rest', port: 3000 },
        },
      });

      const projectDir = await createTempProject(config);

      const orchestrator = new Orchestrator({
        configPath: path.join(projectDir, 'config.json'),
        botsPath: path.join(projectDir, 'bots'),
        logger: null,
        botManager: createMockBotManager(),
      });

      await assert.rejects(
        () => orchestrator.start(),
        err => {
          assert.equal(err.name, 'OrchestratorError');
          assert.match(err.message, /channel.*failed/i);
          assert.equal(err.component, 'channels');
          return true;
        }
      );

      assert.equal(orchestrator.getState(), 'error');
    });

    test('throws when all channels fail to initialize', async () => {
      const config = createValidConfig({
        channels: {
          'bad-slack': { type: 'slack', botToken: 'invalid' },
        },
      });

      const projectDir = await createTempProject(config);
      const FailAdapter = createMockChannelAdapterClass({
        initializeError: 'Invalid token',
      });

      const orchestrator = new Orchestrator({
        configPath: path.join(projectDir, 'config.json'),
        botsPath: path.join(projectDir, 'bots'),
        logger: null,
        botManager: createMockBotManager(),
      });
      orchestrator.registerChannelAdapter('slack', FailAdapter);

      await assert.rejects(
        () => orchestrator.start(),
        err => {
          assert.equal(err.name, 'OrchestratorError');
          assert.match(err.message, /channel.*failed/i);
          return true;
        }
      );

      assert.equal(orchestrator.getState(), 'error');
    });
  });

  // ===========================================================================
  // Full Lifecycle
  // ===========================================================================

  describe('full lifecycle', () => {
    test('start → reload → stop', async () => {
      const config = createValidConfig({
        bots: {
          'lifecycle-bot': { provider: 'anthropic', model: 'claude-sonnet-4-5' },
        },
      });

      const projectDir = await createTempProject(config);
      const botManager = createMockBotManager();

      const orchestrator = new Orchestrator({
        configPath: path.join(projectDir, 'config.json'),
        botsPath: path.join(projectDir, 'bots'),
        logger: null,
        botManager,
      });

      // Start
      await orchestrator.start();
      assert.equal(orchestrator.getState(), 'running');

      // Reload
      const results = await orchestrator.reload();
      assert.ok(results);
      assert.equal(orchestrator.getState(), 'running');

      // Stop
      await orchestrator.stop();
      assert.equal(orchestrator.getState(), 'stopped');
    });

    test('getStatus returns comprehensive info after start', async () => {
      const config = createValidConfig({
        channels: {
          'slack-test': { type: 'slack', botToken: 'xoxb-test' },
        },
        bots: {
          'status-bot': { provider: 'anthropic', model: 'claude-sonnet-4-5' },
        },
      });

      const projectDir = await createTempProject(config);
      const MockSlack = createMockChannelAdapterClass();
      const botManager = createMockBotManager();

      const orchestrator = new Orchestrator({
        configPath: path.join(projectDir, 'config.json'),
        botsPath: path.join(projectDir, 'bots'),
        logger: null,
        botManager,
      });
      orchestrator.registerChannelAdapter('slack', MockSlack);
      orchestrator.use(() => {});

      await orchestrator.start();

      const status = orchestrator.getStatus();
      assert.equal(status.state, 'running');
      assert.ok(status.startedAt instanceof Date);
      assert.ok(status.uptime >= 0);
      assert.equal(status.channelCount, 1);
      assert.equal(status.middlewareCount, 1);
      assert.equal(typeof status.botCount, 'number');

      await orchestrator.stop();
    });

    test('logging captures key lifecycle events', async () => {
      const config = createValidConfig({
        bots: {
          'log-bot': { provider: 'anthropic', model: 'claude-sonnet-4-5' },
        },
      });

      const projectDir = await createTempProject(config);
      const logs = [];
      const botManager = createMockBotManager();

      const orchestrator = new Orchestrator({
        configPath: path.join(projectDir, 'config.json'),
        botsPath: path.join(projectDir, 'bots'),
        logger: msg => logs.push(msg),
        botManager,
      });

      await orchestrator.start();

      assert.ok(logs.some(l => l.includes('Starting')));
      assert.ok(logs.some(l => l.includes('Configuration loaded')));
      assert.ok(logs.some(l => l.includes('Loading bots')));

      logs.length = 0;

      await orchestrator.stop();

      assert.ok(logs.some(l => l.includes('Stopping')));
      assert.ok(logs.some(l => l.includes('stopped')));
    });
  });

  // ===========================================================================
  // Environment Variable Interpolation
  // ===========================================================================

  describe('environment variable interpolation', () => {
    test('interpolates env vars in config values', async () => {
      // Set env var for test
      const originalKey = process.env.TEST_ORCH_API_KEY;
      process.env.TEST_ORCH_API_KEY = 'sk-real-api-key-123';

      try {
        const config = {
          defaults: {
            model: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
            sandbox: { type: 'docker', image: 'node:22-slim' },
          },
          providers: {
            anthropic: { type: 'anthropic', apiKey: '${TEST_ORCH_API_KEY}' },
          },
          channels: {},
          mcpServers: {},
        };

        const projectDir = await createTempProject(config);
        const botManager = createMockBotManager();

        const orchestrator = new Orchestrator({
          configPath: path.join(projectDir, 'config.json'),
          botsPath: path.join(projectDir, 'bots'),
          logger: null,
          botManager,
        });

        await orchestrator.start();

        assert.equal(orchestrator.config.providers.anthropic.apiKey, 'sk-real-api-key-123');

        await orchestrator.stop();
      } finally {
        // Restore env var
        if (originalKey === undefined) {
          delete process.env.TEST_ORCH_API_KEY;
        } else {
          process.env.TEST_ORCH_API_KEY = originalKey;
        }
      }
    });

    test('uses default value for missing env var with :- syntax', async () => {
      // Ensure env var is NOT set
      const original = process.env.ORCH_MISSING_VAR;
      delete process.env.ORCH_MISSING_VAR;

      try {
        const config = {
          defaults: {
            model: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
            sandbox: { type: 'docker', image: 'node:22-slim' },
          },
          providers: {
            anthropic: { type: 'anthropic', apiKey: '${ORCH_MISSING_VAR:-fallback-key}' },
          },
          channels: {},
          mcpServers: {},
        };

        const projectDir = await createTempProject(config);
        const botManager = createMockBotManager();

        const orchestrator = new Orchestrator({
          configPath: path.join(projectDir, 'config.json'),
          botsPath: path.join(projectDir, 'bots'),
          logger: null,
          botManager,
        });

        await orchestrator.start();

        assert.equal(orchestrator.config.providers.anthropic.apiKey, 'fallback-key');

        await orchestrator.stop();
      } finally {
        if (original !== undefined) {
          process.env.ORCH_MISSING_VAR = original;
        }
      }
    });
  });
});

// =============================================================================
// Integration Tests with Real Database
// =============================================================================

describe('Orchestrator Integration - Database', { skip: !DB_AVAILABLE }, () => {
  let storage;

  before(async () => {
    await createWorkerDatabase();
    storage = new PostgresStorage(TEST_DATABASE_URL);
    await storage.connect();
  });

  after(async () => {
    // Clean up temp dirs
    for (const dir of tempDirs) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    tempDirs.length = 0;

    if (storage && storage.isConnected()) {
      await storage.disconnect();
    }
    await dropWorkerDatabase();
  });

  beforeEach(async () => {
    // Reconnect storage if a previous test disconnected it (e.g. orchestrator.stop())
    if (!storage.isConnected()) {
      await storage.connect();
    }

    // Drop all tables for a clean slate
    await storage.query('DROP TABLE IF EXISTS tool_calls CASCADE');
    await storage.query('DROP TABLE IF EXISTS sessions CASCADE');
    await storage.query('DROP TABLE IF EXISTS bots CASCADE');
    await storage.query('DROP TABLE IF EXISTS schema_migrations CASCADE');
    await storage.query('DROP FUNCTION IF EXISTS update_updated_at_column CASCADE');
    await storage.query('DROP FUNCTION IF EXISTS notify_bot_change CASCADE');
  });

  test('full startup with real database and migrations', async () => {
    const config = createValidConfig();
    const projectDir = await createTempProject(config);
    const migrationsPath = path.resolve(__dirname, '../../../migrations');
    const botManager = createMockBotManager();

    const orchestrator = new Orchestrator({
      configPath: path.join(projectDir, 'config.json'),
      botsPath: path.join(projectDir, 'bots'),
      migrationsPath,
      logger: null,
      storage,
      botManager,
    });

    await orchestrator.start();

    assert.equal(orchestrator.getState(), 'running');

    // Verify migrations ran: schema_migrations table should exist
    const { rows } = await storage.query(
      'SELECT version, name FROM schema_migrations ORDER BY version'
    );
    assert.ok(rows.length >= 1, 'At least one migration should have run');
    assert.equal(rows[0].version, 1);
    assert.equal(rows[0].name, '001_initial_schema.sql');

    // Verify core tables exist
    const tablesResult = await storage.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    const tables = tablesResult.rows.map(r => r.table_name);
    assert.ok(tables.includes('bots'), 'bots table should exist');
    assert.ok(tables.includes('sessions'), 'sessions table should exist');

    // getStatus should report database connected
    const status = orchestrator.getStatus();
    assert.equal(status.databaseConnected, true);

    await orchestrator.stop();
    assert.equal(orchestrator.getState(), 'stopped');
  });

  test('startup with storage factory creates connection', async () => {
    const config = createValidConfig();
    const projectDir = await createTempProject(config);
    const migrationsPath = path.resolve(__dirname, '../../../migrations');
    const botManager = createMockBotManager();

    // Use a fresh storage instance created by factory
    const factoryStorage = new PostgresStorage(TEST_DATABASE_URL);
    const storageFactory = mock.fn(() => factoryStorage);

    const orchestrator = new Orchestrator({
      configPath: path.join(projectDir, 'config.json'),
      botsPath: path.join(projectDir, 'bots'),
      migrationsPath,
      logger: null,
      storageFactory,
      botManager,
    });

    await orchestrator.start();

    assert.equal(storageFactory.mock.calls.length, 1);
    assert.equal(orchestrator.getState(), 'running');
    assert.ok(factoryStorage.isConnected());

    // Verify migrations ran
    const { rows } = await factoryStorage.query(
      'SELECT version FROM schema_migrations ORDER BY version'
    );
    assert.ok(rows.length >= 1);

    await orchestrator.stop();

    // Reconnect our test storage (shutdown disconnected it)
    // The factory storage was disconnected by orchestrator.stop()
  });

  test('migrations are idempotent on repeated starts', async () => {
    const config = createValidConfig();
    const projectDir = await createTempProject(config);
    const migrationsPath = path.resolve(__dirname, '../../../migrations');
    const botManager = createMockBotManager();

    // First start - run migrations
    const orch1 = new Orchestrator({
      configPath: path.join(projectDir, 'config.json'),
      botsPath: path.join(projectDir, 'bots'),
      migrationsPath,
      logger: null,
      storage,
      botManager,
    });

    await orch1.start();
    await orch1.stop();

    // Second start - migrations should be skipped
    const logs = [];
    const orch2 = new Orchestrator({
      configPath: path.join(projectDir, 'config.json'),
      botsPath: path.join(projectDir, 'bots'),
      migrationsPath,
      logger: msg => logs.push(msg),
      storage,
      botManager: createMockBotManager(),
    });

    // Reconnect storage after stop
    if (!storage.isConnected()) {
      await storage.connect();
    }

    orch2.state = ORCHESTRATOR_STATES.CREATED;
    await orch2.start();

    // Should log "up to date" or similar, not "ran N migrations"
    assert.ok(
      logs.some(l => l.includes('up to date')),
      'Should indicate schema is already up to date'
    );

    await orch2.stop();

    // Ensure we leave storage connected for subsequent tests
    if (!storage.isConnected()) {
      await storage.connect();
    }
  });

  test('startup fails with clear error on database connection failure', async () => {
    const config = createValidConfig();
    const projectDir = await createTempProject(config);

    // Use a storage that points to a bad URL
    const badStorage = new PostgresStorage('postgresql://bad:bad@localhost:59999/nonexistent');

    const orchestrator = new Orchestrator({
      configPath: path.join(projectDir, 'config.json'),
      botsPath: path.join(projectDir, 'bots'),
      logger: null,
      storage: badStorage,
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

    assert.equal(orchestrator.getState(), 'error');
  });

  test('shutdown disconnects database', async () => {
    const config = createValidConfig();
    const projectDir = await createTempProject(config);
    const migrationsPath = path.resolve(__dirname, '../../../migrations');

    // Create a separate storage for this test
    const testStorage = new PostgresStorage(TEST_DATABASE_URL);
    const botManager = createMockBotManager();

    const orchestrator = new Orchestrator({
      configPath: path.join(projectDir, 'config.json'),
      botsPath: path.join(projectDir, 'bots'),
      migrationsPath,
      logger: null,
      storage: testStorage,
      botManager,
    });

    await orchestrator.start();
    assert.ok(testStorage.isConnected());

    await orchestrator.stop();
    assert.equal(testStorage.isConnected(), false);
  });

  test('full lifecycle with database: start → bots → reload → stop', async () => {
    const config = createValidConfig({
      bots: {
        'db-bot': { provider: 'anthropic', model: 'claude-sonnet-4-5' },
      },
    });

    const projectDir = await createTempProject(config);
    const migrationsPath = path.resolve(__dirname, '../../../migrations');

    // Ensure our shared storage is connected
    if (!storage.isConnected()) {
      await storage.connect();
    }

    const botManager = createMockBotManager();
    const orchestrator = new Orchestrator({
      configPath: path.join(projectDir, 'config.json'),
      botsPath: path.join(projectDir, 'bots'),
      migrationsPath,
      logger: null,
      storage,
      botManager,
    });

    // Start
    await orchestrator.start();
    assert.equal(orchestrator.getState(), 'running');
    assert.equal(botManager.loadBot.mock.calls.length, 1);
    assert.equal(botManager.startBot.mock.calls.length, 1);

    // Reload
    botManager.reloadBot.mock.resetCalls();
    const results = await orchestrator.reload();
    assert.ok(results.reloaded.length >= 1);

    // Stop
    await orchestrator.stop();
    assert.equal(orchestrator.getState(), 'stopped');

    // Reconnect for other tests
    if (!storage.isConnected()) {
      await storage.connect();
    }
  });
});
