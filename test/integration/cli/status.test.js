/**
 * Integration tests for StatusCommand
 *
 * Tests showStatus() with real BotManager and ChannelManager instances
 * (using mock lower-level dependencies) to verify the full integration:
 * - Real BotManager with loaded/running/stopped bots
 * - Real ChannelManager with initialized channels
 * - Mock storage with configurable query responses
 * - Output stream capture for verifying rendered status
 *
 * Unlike unit tests that use simple mock objects, these tests exercise
 * the actual manager classes to verify StatusCommand works correctly
 * with the real shape of data returned by listBots() and listChannels().
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { showStatus, StatusCommandError } from '../../../src/cli/StatusCommand.js';
import { BotManager } from '../../../src/core/bot-manager.js';
import { ChannelManager } from '../../../src/core/channel-manager.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a writable stream mock that collects output
 * @returns {{ write: Function, output: () => string }}
 */
function createOutputStream() {
  const chunks = [];
  return {
    write(data) {
      chunks.push(data);
      return true;
    },
    output() {
      return chunks.join('');
    },
  };
}

/**
 * Create a mock ContainerPool for BotManager
 * @returns {Object} Mock ContainerPool
 */
function createMockContainerPool() {
  const containers = new Map();
  return {
    initializeContainer: mock.fn(async botId => {
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
  };
}

/**
 * Create a mock SoulLoader for BotManager
 * @returns {Object} Mock SoulLoader
 */
function createMockSoulLoader() {
  return {
    load: mock.fn(async () => 'You are a helpful test bot.'),
    loadSoulFile: mock.fn(async () => 'You are a helpful test bot.'),
    interpolateVariables: mock.fn(content => content),
  };
}

/**
 * Create a mock ConfigValidator for BotManager
 * @returns {Object} Mock ConfigValidator
 */
function createMockConfigValidator() {
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
  };
}

/**
 * Create a mock PostgresStorage that BotManager needs (for its constructor)
 * and that StatusCommand queries for database info
 * @param {Object} [options={}] - Configuration
 * @returns {Object} Mock storage
 */
function createMockStorage(options = {}) {
  const {
    connected = true,
    version = 'PostgreSQL 16.1 on x86_64-pc-linux-gnu',
    sessionCount = 0,
    messageCount = 0,
    sessionsByBot = {},
  } = options;

  return {
    connected,
    isConnected() {
      return this.connected;
    },
    async query(sql) {
      if (sql.includes('version()')) {
        return { rows: [{ version }] };
      }
      if (sql.includes('COUNT(*)')) {
        return { rows: [{ count: String(sessionCount) }] };
      }
      if (sql.includes('array_length')) {
        return { rows: [{ count: String(messageCount) }] };
      }
      return { rows: [], rowCount: 0 };
    },
    async listSessions(botId) {
      return sessionsByBot[botId] || [];
    },
    transaction: mock.fn(async fn => fn({ query: mock.fn(async () => ({ rows: [] })) })),
  };
}

/**
 * Create a valid bot config for BotManager.loadBot()
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
 * Create a mock adapter class for ChannelManager
 * @returns {Function} Mock adapter class
 */
function createMockAdapterClass() {
  class MockAdapter {
    constructor(config) {
      this.config = config;
    }

    async initialize() {}
    async start() {}
    async stop() {}
    onMessage() {}
    async sendMessage() {}
  }

  return MockAdapter;
}

/**
 * Set up a BotManager with loaded bots
 * @param {Object} storage - Mock storage instance
 * @param {Array<Object>} botConfigs - Array of { id, config, start } objects
 * @returns {Promise<BotManager>} Populated BotManager
 */
async function setupBotManager(storage, botConfigs = []) {
  const containerPool = createMockContainerPool();
  const soulLoader = createMockSoulLoader();
  const configValidator = createMockConfigValidator();

  const botManager = new BotManager(storage, containerPool, soulLoader, {
    configValidator,
  });

  for (const { id, config, start } of botConfigs) {
    await botManager.loadBot(id, config || createBotConfig({ id }));
    if (start) {
      await botManager.startBot(id);
    }
  }

  return botManager;
}

/**
 * Set up a ChannelManager with initialized channels
 * @param {Array<Object>} channelConfigs - Array of { name, type } objects
 * @returns {Promise<ChannelManager>} Populated ChannelManager
 */
async function setupChannelManager(channelConfigs = []) {
  const channelManager = new ChannelManager();

  // Register mock adapter types
  channelManager.registerAdapter('slack', createMockAdapterClass());
  channelManager.registerAdapter('discord', createMockAdapterClass());
  channelManager.registerAdapter('rest', createMockAdapterClass());

  for (const { name, type } of channelConfigs) {
    await channelManager.initializeChannel(name, { type });
  }

  return channelManager;
}

// ============================================================================
// Integration Tests
// ============================================================================

describe('StatusCommand integration - with real BotManager', () => {
  let out;

  beforeEach(() => {
    out = createOutputStream();
  });

  test('displays loaded bots from real BotManager', async () => {
    const storage = createMockStorage({ connected: false });
    const botManager = await setupBotManager(storage, [
      { id: 'alpha-bot', config: createBotConfig({ id: 'alpha-bot', name: 'Alpha Bot' }) },
      { id: 'beta-bot', config: createBotConfig({ id: 'beta-bot', name: 'Beta Bot' }) },
    ]);
    const channelManager = await setupChannelManager();

    await showStatus({ storage, botManager, channelManager, output: out });

    const result = out.output();
    assert.ok(result.includes('alpha-bot'));
    assert.ok(result.includes('beta-bot'));
    assert.ok(result.includes('loaded'));
  });

  test('displays running bots with correct status from real BotManager', async () => {
    const storage = createMockStorage({ connected: false });
    const botManager = await setupBotManager(storage, [
      { id: 'run-bot', config: createBotConfig({ id: 'run-bot' }), start: true },
    ]);
    const channelManager = await setupChannelManager();

    await showStatus({ storage, botManager, channelManager, output: out });

    const result = out.output();
    assert.ok(result.includes('run-bot (running)'));
    assert.ok(result.includes('\u2705'));
  });

  test('displays mix of running and loaded bots', async () => {
    const storage = createMockStorage({ connected: false });
    const botManager = await setupBotManager(storage, [
      { id: 'active-bot', config: createBotConfig({ id: 'active-bot' }), start: true },
      { id: 'idle-bot', config: createBotConfig({ id: 'idle-bot' }), start: false },
    ]);
    const channelManager = await setupChannelManager();

    await showStatus({ storage, botManager, channelManager, output: out });

    const result = out.output();
    assert.ok(result.includes('active-bot (running)'));
    assert.ok(result.includes('idle-bot (loaded)'));
  });

  test('displays stopped bots after start and stop cycle', async () => {
    const storage = createMockStorage({ connected: false });
    const containerPool = createMockContainerPool();
    const soulLoader = createMockSoulLoader();
    const configValidator = createMockConfigValidator();
    const botManager = new BotManager(storage, containerPool, soulLoader, {
      configValidator,
    });

    await botManager.loadBot('cycle-bot', createBotConfig({ id: 'cycle-bot' }));
    await botManager.startBot('cycle-bot');
    await botManager.stopBot('cycle-bot');

    const channelManager = await setupChannelManager();

    await showStatus({ storage, botManager, channelManager, output: out });

    const result = out.output();
    assert.ok(result.includes('cycle-bot (stopped)'));
  });

  test('shows "No bots loaded" when BotManager is empty', async () => {
    const storage = createMockStorage({ connected: false });
    const botManager = await setupBotManager(storage, []);
    const channelManager = await setupChannelManager();

    await showStatus({ storage, botManager, channelManager, output: out });

    const result = out.output();
    assert.ok(result.includes('No bots loaded'));
  });

  test('shows active sessions count from connected storage', async () => {
    const storage = createMockStorage({
      connected: true,
      sessionsByBot: {
        'session-bot': [{ id: 's1' }, { id: 's2' }, { id: 's3' }],
      },
    });
    const botManager = await setupBotManager(storage, [
      { id: 'session-bot', config: createBotConfig({ id: 'session-bot' }), start: true },
    ]);
    const channelManager = await setupChannelManager();

    await showStatus({ storage, botManager, channelManager, output: out });

    const result = out.output();
    assert.ok(result.includes('session-bot (running)'));
    assert.ok(result.includes('3 active sessions'));
  });

  test('shows singular session count correctly', async () => {
    const storage = createMockStorage({
      connected: true,
      sessionsByBot: {
        'one-session-bot': [{ id: 's1' }],
      },
    });
    const botManager = await setupBotManager(storage, [
      {
        id: 'one-session-bot',
        config: createBotConfig({ id: 'one-session-bot' }),
        start: true,
      },
    ]);
    const channelManager = await setupChannelManager();

    await showStatus({ storage, botManager, channelManager, output: out });

    const result = out.output();
    assert.ok(result.includes('1 active session'));
    assert.ok(!result.includes('1 active sessions'));
  });

  test('omits session count when storage is disconnected', async () => {
    const storage = createMockStorage({
      connected: false,
      sessionsByBot: {
        'disconn-bot': [{ id: 's1' }, { id: 's2' }],
      },
    });
    const botManager = await setupBotManager(storage, [
      { id: 'disconn-bot', config: createBotConfig({ id: 'disconn-bot' }), start: true },
    ]);
    const channelManager = await setupChannelManager();

    await showStatus({ storage, botManager, channelManager, output: out });

    const result = out.output();
    assert.ok(result.includes('disconn-bot (running)'));
    // No session count should be displayed when storage is disconnected
    assert.ok(!result.includes('active session'));
  });
});

describe('StatusCommand integration - with real ChannelManager', () => {
  let out;

  beforeEach(() => {
    out = createOutputStream();
  });

  test('displays initialized channels from real ChannelManager', async () => {
    const storage = createMockStorage({ connected: false });
    const botManager = await setupBotManager(storage, []);
    const channelManager = await setupChannelManager([
      { name: 'slack-main', type: 'slack' },
      { name: 'discord-general', type: 'discord' },
    ]);

    await showStatus({ storage, botManager, channelManager, output: out });

    const result = out.output();
    assert.ok(result.includes('slack-main'));
    assert.ok(result.includes('discord-general'));
    // ChannelManager sets status to 'ready' on initialization
    assert.ok(result.includes('ready'));
  });

  test('shows "No channels configured" when ChannelManager is empty', async () => {
    const storage = createMockStorage({ connected: false });
    const botManager = await setupBotManager(storage, []);
    const channelManager = await setupChannelManager([]);

    await showStatus({ storage, botManager, channelManager, output: out });

    const result = out.output();
    assert.ok(result.includes('No channels configured'));
  });

  test('displays multiple channel types correctly', async () => {
    const storage = createMockStorage({ connected: false });
    const botManager = await setupBotManager(storage, []);
    const channelManager = await setupChannelManager([
      { name: 'slack-team', type: 'slack' },
      { name: 'discord-server', type: 'discord' },
      { name: 'rest-api', type: 'rest' },
    ]);

    await showStatus({ storage, botManager, channelManager, output: out });

    const result = out.output();
    assert.ok(result.includes('slack-team'));
    assert.ok(result.includes('discord-server'));
    assert.ok(result.includes('rest-api'));
  });

  test('shows check mark icon for ready channels', async () => {
    const storage = createMockStorage({ connected: false });
    const botManager = await setupBotManager(storage, []);
    const channelManager = await setupChannelManager([{ name: 'slack-main', type: 'slack' }]);

    await showStatus({ storage, botManager, channelManager, output: out });

    const result = out.output();
    assert.ok(result.includes('\u2705'));
    assert.ok(result.includes('slack-main (ready)'));
  });
});

describe('StatusCommand integration - database section', () => {
  let out;

  beforeEach(() => {
    out = createOutputStream();
  });

  test('shows connected database with version, sessions, and messages', async () => {
    const storage = createMockStorage({
      connected: true,
      version: 'PostgreSQL 16.4 on aarch64-linux',
      sessionCount: 42,
      messageCount: 1500,
    });
    const botManager = await setupBotManager(storage, []);
    const channelManager = await setupChannelManager();

    await showStatus({ storage, botManager, channelManager, output: out });

    const result = out.output();
    assert.ok(result.includes('Connected to PostgreSQL 16.4'));
    assert.ok(result.includes('42 total sessions'));
    assert.ok(result.includes('1,500 messages processed'));
  });

  test('shows "Not connected" when storage is disconnected', async () => {
    const storage = createMockStorage({ connected: false });
    const botManager = await setupBotManager(storage, []);
    const channelManager = await setupChannelManager();

    await showStatus({ storage, botManager, channelManager, output: out });

    const result = out.output();
    assert.ok(result.includes('Not connected'));
  });

  test('shows "Not connected" when storage is null', async () => {
    // BotManager needs a storage for its constructor, use separate storage
    const bmStorage = createMockStorage({ connected: false });
    const botManager = await setupBotManager(bmStorage, []);
    const channelManager = await setupChannelManager();

    await showStatus({
      storage: null,
      botManager,
      channelManager,
      output: out,
    });

    const result = out.output();
    assert.ok(result.includes('Not connected'));
  });

  test('formats large numbers with locale separators', async () => {
    const storage = createMockStorage({
      connected: true,
      sessionCount: 10000,
      messageCount: 1234567,
    });
    const botManager = await setupBotManager(storage, []);
    const channelManager = await setupChannelManager();

    await showStatus({ storage, botManager, channelManager, output: out });

    const result = out.output();
    assert.ok(result.includes('10,000 total sessions'));
    assert.ok(result.includes('1,234,567 messages processed'));
  });

  test('handles storage query errors gracefully', async () => {
    const errorStorage = {
      connected: true,
      isConnected() {
        return true;
      },
      async query() {
        throw new Error('Database timeout');
      },
      async listSessions() {
        return [];
      },
      transaction: mock.fn(),
    };
    const botManager = await setupBotManager(errorStorage, []);
    const channelManager = await setupChannelManager();

    await showStatus({
      storage: errorStorage,
      botManager,
      channelManager,
      output: out,
    });

    const result = out.output();
    // Should still display the database section without crashing
    assert.ok(result.includes('Database:'));
    // Connected status comes from isConnected(), which is true
    assert.ok(result.includes('Connected to PostgreSQL'));
  });
});

describe('StatusCommand integration - full scenario', () => {
  test('renders complete status with real managers matching doc spec', async () => {
    const out = createOutputStream();

    const storage = createMockStorage({
      connected: true,
      version: 'PostgreSQL 16.1 on x86_64-pc-linux-gnu',
      sessionCount: 250,
      messageCount: 5678,
      sessionsByBot: {
        'support-bot': [{ id: 's1' }, { id: 's2' }, { id: 's3' }],
        'work-bot': [{ id: 's4' }],
      },
    });

    const botManager = await setupBotManager(storage, [
      { id: 'support-bot', config: createBotConfig({ id: 'support-bot' }), start: true },
      { id: 'work-bot', config: createBotConfig({ id: 'work-bot' }), start: true },
      { id: 'devops-bot', config: createBotConfig({ id: 'devops-bot' }), start: false },
    ]);

    const channelManager = await setupChannelManager([
      { name: 'slack-main', type: 'slack' },
      { name: 'discord-main', type: 'discord' },
    ]);

    await showStatus({ storage, botManager, channelManager, output: out });

    const result = out.output();

    // Header
    assert.ok(result.includes('AI Army Status'));

    // Bots section
    assert.ok(result.includes('Bots:'));
    assert.ok(result.includes('support-bot (running) - 3 active sessions'));
    assert.ok(result.includes('work-bot (running) - 1 active session'));
    assert.ok(result.includes('devops-bot (loaded)'));

    // Database section
    assert.ok(result.includes('Database:'));
    assert.ok(result.includes('Connected to PostgreSQL 16.1'));
    assert.ok(result.includes('250 total sessions'));
    assert.ok(result.includes('5,678 messages processed'));

    // Channels section
    assert.ok(result.includes('Channels:'));
    assert.ok(result.includes('slack-main (ready)'));
    assert.ok(result.includes('discord-main (ready)'));
  });

  test('renders status with bots in various lifecycle stages', async () => {
    const out = createOutputStream();

    const storage = createMockStorage({ connected: true, sessionCount: 5, messageCount: 50 });

    // Create a bot manager manually to test stopped state
    const containerPool = createMockContainerPool();
    const soulLoader = createMockSoulLoader();
    const configValidator = createMockConfigValidator();
    const botManager = new BotManager(storage, containerPool, soulLoader, {
      configValidator,
    });

    // Load a bot, start it, then stop it
    await botManager.loadBot('retired-bot', createBotConfig({ id: 'retired-bot' }));
    await botManager.startBot('retired-bot');
    await botManager.stopBot('retired-bot');

    // Load and start another bot
    await botManager.loadBot('active-bot', createBotConfig({ id: 'active-bot' }));
    await botManager.startBot('active-bot');

    // Load a bot without starting
    await botManager.loadBot('pending-bot', createBotConfig({ id: 'pending-bot' }));

    const channelManager = await setupChannelManager([{ name: 'slack-main', type: 'slack' }]);

    await showStatus({ storage, botManager, channelManager, output: out });

    const result = out.output();
    assert.ok(result.includes('retired-bot (stopped)'));
    assert.ok(result.includes('active-bot (running)'));
    assert.ok(result.includes('pending-bot (loaded)'));
  });
});

describe('StatusCommand integration - error handling', () => {
  let out;

  beforeEach(() => {
    out = createOutputStream();
  });

  test('throws StatusCommandError when botManager is missing', async () => {
    const channelManager = await setupChannelManager();

    await assert.rejects(
      () => showStatus({ channelManager, output: out }),
      err => {
        assert.ok(err instanceof StatusCommandError);
        assert.equal(err.section, 'bots');
        assert.ok(err.message.includes('botManager'));
        return true;
      }
    );
  });

  test('throws StatusCommandError when channelManager is missing', async () => {
    const storage = createMockStorage({ connected: false });
    const botManager = await setupBotManager(storage, []);

    await assert.rejects(
      () => showStatus({ botManager, output: out }),
      err => {
        assert.ok(err instanceof StatusCommandError);
        assert.equal(err.section, 'channels');
        assert.ok(err.message.includes('channelManager'));
        return true;
      }
    );
  });

  test('throws StatusCommandError when called with no arguments', async () => {
    await assert.rejects(
      () => showStatus(),
      err => {
        assert.ok(err instanceof StatusCommandError);
        return true;
      }
    );
  });

  test('handles session listing failure without crashing', async () => {
    const failStorage = {
      connected: true,
      isConnected() {
        return true;
      },
      async query(sql) {
        if (sql.includes('version()')) {
          return { rows: [{ version: 'PostgreSQL 16' }] };
        }
        if (sql.includes('COUNT(*)')) {
          return { rows: [{ count: '0' }] };
        }
        if (sql.includes('array_length')) {
          return { rows: [{ count: '0' }] };
        }
        return { rows: [] };
      },
      async listSessions() {
        throw new Error('sessions table does not exist');
      },
      transaction: mock.fn(async fn => fn({ query: mock.fn(async () => ({ rows: [] })) })),
    };

    const botManager = await setupBotManager(failStorage, [
      { id: 'resilient-bot', config: createBotConfig({ id: 'resilient-bot' }), start: true },
    ]);
    const channelManager = await setupChannelManager();

    await showStatus({
      storage: failStorage,
      botManager,
      channelManager,
      output: out,
    });

    const result = out.output();
    // Bot should still be displayed even though session query failed
    assert.ok(result.includes('resilient-bot (running)'));
    // Session count should not appear since the query failed
    assert.ok(!result.includes('active session'));
  });

  test('all sections render even when one has issues', async () => {
    const partialStorage = {
      connected: true,
      isConnected() {
        return true;
      },
      async query(sql) {
        if (sql.includes('version()')) {
          throw new Error('Version query failed');
        }
        if (sql.includes('COUNT(*)')) {
          return { rows: [{ count: '10' }] };
        }
        if (sql.includes('array_length')) {
          throw new Error('Message count failed');
        }
        return { rows: [] };
      },
      async listSessions() {
        return [];
      },
      transaction: mock.fn(async fn => fn({ query: mock.fn(async () => ({ rows: [] })) })),
    };

    const botManager = await setupBotManager(partialStorage, [
      { id: 'test-bot', config: createBotConfig({ id: 'test-bot' }) },
    ]);
    const channelManager = await setupChannelManager([{ name: 'slack-main', type: 'slack' }]);

    await showStatus({
      storage: partialStorage,
      botManager,
      channelManager,
      output: out,
    });

    const result = out.output();
    // All three sections should be present
    assert.ok(result.includes('Bots:'));
    assert.ok(result.includes('Database:'));
    assert.ok(result.includes('Channels:'));
    // Bot and channel data should still render
    assert.ok(result.includes('test-bot'));
    assert.ok(result.includes('slack-main'));
  });
});

describe('StatusCommand integration - output structure', () => {
  test('output contains sections in correct order', async () => {
    const out = createOutputStream();
    const storage = createMockStorage({
      connected: true,
      sessionCount: 5,
      messageCount: 25,
    });
    const botManager = await setupBotManager(storage, [
      { id: 'order-bot', config: createBotConfig({ id: 'order-bot' }), start: true },
    ]);
    const channelManager = await setupChannelManager([{ name: 'slack-main', type: 'slack' }]);

    await showStatus({ storage, botManager, channelManager, output: out });

    const result = out.output();

    // Verify section order: Header → Bots → Database → Channels
    const headerIdx = result.indexOf('AI Army Status');
    const botsIdx = result.indexOf('Bots:');
    const dbIdx = result.indexOf('Database:');
    const channelsIdx = result.indexOf('Channels:');

    assert.ok(headerIdx >= 0, 'Header should be present');
    assert.ok(botsIdx > headerIdx, 'Bots section should come after header');
    assert.ok(dbIdx > botsIdx, 'Database section should come after bots');
    assert.ok(channelsIdx > dbIdx, 'Channels section should come after database');
  });

  test('output ends with trailing newline', async () => {
    const out = createOutputStream();
    const storage = createMockStorage({ connected: false });
    const botManager = await setupBotManager(storage, []);
    const channelManager = await setupChannelManager();

    await showStatus({ storage, botManager, channelManager, output: out });

    const result = out.output();
    assert.ok(result.endsWith('\n'), 'Output should end with newline');
  });

  test('each bot gets its own line', async () => {
    const out = createOutputStream();
    const storage = createMockStorage({ connected: false });
    const botManager = await setupBotManager(storage, [
      { id: 'bot-a', config: createBotConfig({ id: 'bot-a' }) },
      { id: 'bot-b', config: createBotConfig({ id: 'bot-b' }) },
      { id: 'bot-c', config: createBotConfig({ id: 'bot-c' }) },
    ]);
    const channelManager = await setupChannelManager();

    await showStatus({ storage, botManager, channelManager, output: out });

    const result = out.output();
    const lines = result.split('\n');

    // Each bot should be on a separate line
    const botLines = lines.filter(l => l.includes('bot-'));
    assert.equal(botLines.length, 3);
    assert.ok(botLines.some(l => l.includes('bot-a')));
    assert.ok(botLines.some(l => l.includes('bot-b')));
    assert.ok(botLines.some(l => l.includes('bot-c')));
  });
});
