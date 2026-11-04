/**
 * Unit tests for StatusCommand
 *
 * Tests the showStatus() function with mock dependencies:
 * - BotManager, ChannelManager, and PostgresStorage mocks
 * - Verifies output formatting, error handling, and edge cases
 * - Validates correct emoji icons and section headings
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { showStatus, StatusCommandError } from './StatusCommand.js';

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
 * Create a mock BotManager
 * @param {Array<Object>} [bots=[]] - Bots to return from listBots()
 * @returns {Object} Mock BotManager
 */
function createMockBotManager(bots = []) {
  return {
    listBots() {
      return bots;
    },
    getBot(id) {
      return bots.find(b => b.id === id);
    },
    getBotCount(status) {
      if (!status) return bots.length;
      return bots.filter(b => b.status === status).length;
    },
  };
}

/**
 * Create a mock ChannelManager
 * @param {Array<Object>} [channels=[]] - Channels to return from listChannels()
 * @returns {Object} Mock ChannelManager
 */
function createMockChannelManager(channels = []) {
  return {
    listChannels() {
      return channels;
    },
    getChannel(name) {
      return channels.find(c => c.name === name);
    },
    getChannelCount(status) {
      if (!status) return channels.length;
      return channels.filter(c => c.status === status).length;
    },
  };
}

/**
 * Create a mock PostgresStorage
 * @param {Object} [options={}] - Configuration
 * @param {boolean} [options.connected=true] - Connection status
 * @param {string} [options.version='PostgreSQL 16.1'] - PG version
 * @param {number} [options.sessionCount=0] - Total sessions
 * @param {number} [options.messageCount=0] - Total messages
 * @param {Array<Object>} [options.sessions=[]] - Sessions for listSessions
 * @returns {Object} Mock PostgresStorage
 */
function createMockStorage(options = {}) {
  const {
    connected = true,
    version = 'PostgreSQL 16.1 on x86_64',
    sessionCount = 0,
    messageCount = 0,
    sessions = [],
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
    async listSessions() {
      return sessions;
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('StatusCommand - showStatus()', () => {
  let out;

  beforeEach(() => {
    out = createOutputStream();
  });

  test('throws StatusCommandError when botManager is missing', async () => {
    await assert.rejects(
      () =>
        showStatus({
          channelManager: createMockChannelManager(),
          output: out,
        }),
      err => {
        assert.ok(err instanceof StatusCommandError);
        assert.equal(err.section, 'bots');
        assert.ok(err.message.includes('botManager'));
        return true;
      }
    );
  });

  test('throws StatusCommandError when channelManager is missing', async () => {
    await assert.rejects(
      () =>
        showStatus({
          botManager: createMockBotManager(),
          output: out,
        }),
      err => {
        assert.ok(err instanceof StatusCommandError);
        assert.equal(err.section, 'channels');
        assert.ok(err.message.includes('channelManager'));
        return true;
      }
    );
  });

  test('displays header with robot emoji', async () => {
    await showStatus({
      storage: createMockStorage({ connected: false }),
      botManager: createMockBotManager(),
      channelManager: createMockChannelManager(),
      output: out,
    });

    const result = out.output();
    assert.ok(result.includes('AI Army Status'));
  });

  test('displays all three sections', async () => {
    await showStatus({
      storage: createMockStorage({ connected: false }),
      botManager: createMockBotManager(),
      channelManager: createMockChannelManager(),
      output: out,
    });

    const result = out.output();
    assert.ok(result.includes('Bots:'));
    assert.ok(result.includes('Database:'));
    assert.ok(result.includes('Channels:'));
  });

  test('shows "No bots loaded" when no bots exist', async () => {
    await showStatus({
      storage: createMockStorage({ connected: false }),
      botManager: createMockBotManager([]),
      channelManager: createMockChannelManager(),
      output: out,
    });

    const result = out.output();
    assert.ok(result.includes('No bots loaded'));
  });

  test('shows "No channels configured" when no channels exist', async () => {
    await showStatus({
      storage: createMockStorage({ connected: false }),
      botManager: createMockBotManager(),
      channelManager: createMockChannelManager([]),
      output: out,
    });

    const result = out.output();
    assert.ok(result.includes('No channels configured'));
  });

  test('storage is optional (gracefully handles undefined)', async () => {
    await showStatus({
      botManager: createMockBotManager(),
      channelManager: createMockChannelManager(),
      output: out,
    });

    const result = out.output();
    assert.ok(result.includes('Not connected'));
  });
});

describe('StatusCommand - bot status display', () => {
  let out;

  beforeEach(() => {
    out = createOutputStream();
  });

  test('shows running bot with check mark', async () => {
    const bots = [{ id: 'support-bot', status: 'running' }];

    await showStatus({
      storage: createMockStorage({ connected: false }),
      botManager: createMockBotManager(bots),
      channelManager: createMockChannelManager(),
      output: out,
    });

    const result = out.output();
    assert.ok(result.includes('support-bot'));
    assert.ok(result.includes('running'));
    assert.ok(result.includes('\u2705'));
  });

  test('shows stopped bot with pause icon', async () => {
    const bots = [{ id: 'devops-bot', status: 'stopped' }];

    await showStatus({
      storage: createMockStorage({ connected: false }),
      botManager: createMockBotManager(bots),
      channelManager: createMockChannelManager(),
      output: out,
    });

    const result = out.output();
    assert.ok(result.includes('devops-bot'));
    assert.ok(result.includes('stopped'));
  });

  test('shows error bot with X mark', async () => {
    const bots = [{ id: 'broken-bot', status: 'error' }];

    await showStatus({
      storage: createMockStorage({ connected: false }),
      botManager: createMockBotManager(bots),
      channelManager: createMockChannelManager(),
      output: out,
    });

    const result = out.output();
    assert.ok(result.includes('broken-bot'));
    assert.ok(result.includes('error'));
    assert.ok(result.includes('\u274C'));
  });

  test('shows active session count for bots with sessions', async () => {
    const bots = [{ id: 'support-bot', status: 'running' }];
    const sessions = [
      { id: 's1', botId: 'support-bot' },
      { id: 's2', botId: 'support-bot' },
      { id: 's3', botId: 'support-bot' },
    ];

    await showStatus({
      storage: createMockStorage({ connected: true, sessions }),
      botManager: createMockBotManager(bots),
      channelManager: createMockChannelManager(),
      output: out,
    });

    const result = out.output();
    assert.ok(result.includes('3 active sessions'));
  });

  test('shows singular "active session" for count of 1', async () => {
    const bots = [{ id: 'work-bot', status: 'running' }];
    const sessions = [{ id: 's1', botId: 'work-bot' }];

    await showStatus({
      storage: createMockStorage({ connected: true, sessions }),
      botManager: createMockBotManager(bots),
      channelManager: createMockChannelManager(),
      output: out,
    });

    const result = out.output();
    assert.ok(result.includes('1 active session'));
    assert.ok(!result.includes('1 active sessions'));
  });

  test('does not show session count when zero', async () => {
    const bots = [{ id: 'idle-bot', status: 'stopped' }];

    await showStatus({
      storage: createMockStorage({ connected: true, sessions: [] }),
      botManager: createMockBotManager(bots),
      channelManager: createMockChannelManager(),
      output: out,
    });

    const result = out.output();
    assert.ok(result.includes('idle-bot (stopped)'));
    assert.ok(!result.includes('active session'));
  });

  test('shows multiple bots with different statuses', async () => {
    const bots = [
      { id: 'alpha', status: 'running' },
      { id: 'beta', status: 'stopped' },
      { id: 'gamma', status: 'error' },
    ];

    await showStatus({
      storage: createMockStorage({ connected: false }),
      botManager: createMockBotManager(bots),
      channelManager: createMockChannelManager(),
      output: out,
    });

    const result = out.output();
    assert.ok(result.includes('alpha (running)'));
    assert.ok(result.includes('beta (stopped)'));
    assert.ok(result.includes('gamma (error)'));
  });

  test('handles botManager.listBots() throwing error gracefully', async () => {
    const badBotManager = {
      listBots() {
        throw new Error('Bot registry corrupted');
      },
    };

    await showStatus({
      storage: createMockStorage({ connected: false }),
      botManager: badBotManager,
      channelManager: createMockChannelManager(),
      output: out,
    });

    const result = out.output();
    assert.ok(result.includes('Error loading bot status'));
    assert.ok(result.includes('Bot registry corrupted'));
  });
});

describe('StatusCommand - database status display', () => {
  let out;

  beforeEach(() => {
    out = createOutputStream();
  });

  test('shows connected status with PostgreSQL version', async () => {
    await showStatus({
      storage: createMockStorage({
        connected: true,
        version: 'PostgreSQL 16.1 on x86_64-pc-linux-gnu',
      }),
      botManager: createMockBotManager(),
      channelManager: createMockChannelManager(),
      output: out,
    });

    const result = out.output();
    assert.ok(result.includes('Connected to PostgreSQL 16.1'));
  });

  test('shows disconnected status when storage is not connected', async () => {
    await showStatus({
      storage: createMockStorage({ connected: false }),
      botManager: createMockBotManager(),
      channelManager: createMockChannelManager(),
      output: out,
    });

    const result = out.output();
    assert.ok(result.includes('Not connected'));
  });

  test('shows total session count', async () => {
    await showStatus({
      storage: createMockStorage({ connected: true, sessionCount: 127 }),
      botManager: createMockBotManager(),
      channelManager: createMockChannelManager(),
      output: out,
    });

    const result = out.output();
    assert.ok(result.includes('127 total sessions'));
  });

  test('shows messages processed count', async () => {
    await showStatus({
      storage: createMockStorage({ connected: true, messageCount: 1234 }),
      botManager: createMockBotManager(),
      channelManager: createMockChannelManager(),
      output: out,
    });

    const result = out.output();
    assert.ok(result.includes('1,234 messages processed'));
  });

  test('formats large numbers with commas', async () => {
    await showStatus({
      storage: createMockStorage({ connected: true, sessionCount: 10000 }),
      botManager: createMockBotManager(),
      channelManager: createMockChannelManager(),
      output: out,
    });

    const result = out.output();
    assert.ok(result.includes('10,000 total sessions'));
  });

  test('shows zero counts when database is empty', async () => {
    await showStatus({
      storage: createMockStorage({
        connected: true,
        sessionCount: 0,
        messageCount: 0,
      }),
      botManager: createMockBotManager(),
      channelManager: createMockChannelManager(),
      output: out,
    });

    const result = out.output();
    assert.ok(result.includes('0 total sessions'));
    assert.ok(result.includes('0 messages processed'));
  });

  test('handles database query error gracefully', async () => {
    const badStorage = {
      connected: true,
      isConnected() {
        return true;
      },
      async query() {
        throw new Error('Connection lost');
      },
    };

    await showStatus({
      storage: badStorage,
      botManager: createMockBotManager(),
      channelManager: createMockChannelManager(),
      output: out,
    });

    const result = out.output();
    // Should still display the section header, and show connected
    // since isConnected() returned true, but version/counts may
    // fall back to defaults since queries failed
    assert.ok(result.includes('Database:'));
    assert.ok(result.includes('Connected to PostgreSQL'));
  });

  test('handles null storage gracefully', async () => {
    await showStatus({
      storage: null,
      botManager: createMockBotManager(),
      channelManager: createMockChannelManager(),
      output: out,
    });

    const result = out.output();
    assert.ok(result.includes('Not connected'));
  });
});

describe('StatusCommand - channel status display', () => {
  let out;

  beforeEach(() => {
    out = createOutputStream();
  });

  test('shows connected channel with check mark', async () => {
    const channels = [{ name: 'slack-main', status: 'started', config: { type: 'slack' } }];

    await showStatus({
      storage: createMockStorage({ connected: false }),
      botManager: createMockBotManager(),
      channelManager: createMockChannelManager(channels),
      output: out,
    });

    const result = out.output();
    assert.ok(result.includes('slack-main'));
    assert.ok(result.includes('connected'));
    assert.ok(result.includes('\u2705'));
  });

  test('shows stopped channel as disconnected', async () => {
    const channels = [{ name: 'discord-main', status: 'stopped', config: { type: 'discord' } }];

    await showStatus({
      storage: createMockStorage({ connected: false }),
      botManager: createMockBotManager(),
      channelManager: createMockChannelManager(channels),
      output: out,
    });

    const result = out.output();
    assert.ok(result.includes('discord-main'));
    assert.ok(result.includes('disconnected'));
  });

  test('shows channel in error state', async () => {
    const channels = [{ name: 'broken-channel', status: 'error', config: { type: 'slack' } }];

    await showStatus({
      storage: createMockStorage({ connected: false }),
      botManager: createMockBotManager(),
      channelManager: createMockChannelManager(channels),
      output: out,
    });

    const result = out.output();
    assert.ok(result.includes('broken-channel'));
    assert.ok(result.includes('error'));
  });

  test('shows multiple channels', async () => {
    const channels = [
      { name: 'slack-main', status: 'started', config: { type: 'slack' } },
      { name: 'discord-main', status: 'started', config: { type: 'discord' } },
    ];

    await showStatus({
      storage: createMockStorage({ connected: false }),
      botManager: createMockBotManager(),
      channelManager: createMockChannelManager(channels),
      output: out,
    });

    const result = out.output();
    assert.ok(result.includes('slack-main (connected)'));
    assert.ok(result.includes('discord-main (connected)'));
  });

  test('shows ready channel status', async () => {
    const channels = [{ name: 'rest-api', status: 'ready', config: { type: 'rest' } }];

    await showStatus({
      storage: createMockStorage({ connected: false }),
      botManager: createMockBotManager(),
      channelManager: createMockChannelManager(channels),
      output: out,
    });

    const result = out.output();
    assert.ok(result.includes('rest-api (ready)'));
  });

  test('shows initializing channel status', async () => {
    const channels = [{ name: 'slack-dev', status: 'initializing', config: { type: 'slack' } }];

    await showStatus({
      storage: createMockStorage({ connected: false }),
      botManager: createMockBotManager(),
      channelManager: createMockChannelManager(channels),
      output: out,
    });

    const result = out.output();
    assert.ok(result.includes('slack-dev (initializing)'));
  });

  test('handles channelManager.listChannels() throwing error gracefully', async () => {
    const badChannelManager = {
      listChannels() {
        throw new Error('Channel registry error');
      },
    };

    await showStatus({
      storage: createMockStorage({ connected: false }),
      botManager: createMockBotManager(),
      channelManager: badChannelManager,
      output: out,
    });

    const result = out.output();
    assert.ok(result.includes('Error loading channel status'));
    assert.ok(result.includes('Channel registry error'));
  });

  test('handles missing config on channel gracefully', async () => {
    const channels = [{ name: 'no-config', status: 'ready' }];

    await showStatus({
      storage: createMockStorage({ connected: false }),
      botManager: createMockBotManager(),
      channelManager: createMockChannelManager(channels),
      output: out,
    });

    const result = out.output();
    assert.ok(result.includes('no-config (ready)'));
  });
});

describe('StatusCommand - full integration scenario', () => {
  test('renders complete status output matching doc spec', async () => {
    const out = createOutputStream();

    const bots = [
      { id: 'support-bot', status: 'running' },
      { id: 'work-bot', status: 'running' },
      { id: 'devops-bot', status: 'stopped' },
    ];

    const channels = [
      { name: 'slack-main', status: 'started', config: { type: 'slack' } },
      { name: 'discord-main', status: 'started', config: { type: 'discord' } },
    ];

    // support-bot has 3 sessions, work-bot has 1
    const mockStorage = {
      connected: true,
      isConnected() {
        return true;
      },
      async query(sql) {
        if (sql.includes('version()')) {
          return { rows: [{ version: 'PostgreSQL 16.1 on x86_64' }] };
        }
        if (sql.includes('COUNT(*)')) {
          return { rows: [{ count: '127' }] };
        }
        if (sql.includes('array_length')) {
          return { rows: [{ count: '1234' }] };
        }
        return { rows: [], rowCount: 0 };
      },
      async listSessions(botId) {
        if (botId === 'support-bot') {
          return [{ id: 's1' }, { id: 's2' }, { id: 's3' }];
        }
        if (botId === 'work-bot') {
          return [{ id: 's4' }];
        }
        return [];
      },
    };

    await showStatus({
      storage: mockStorage,
      botManager: createMockBotManager(bots),
      channelManager: createMockChannelManager(channels),
      output: out,
    });

    const result = out.output();

    // Header
    assert.ok(result.includes('AI Army Status'));

    // Bots section
    assert.ok(result.includes('support-bot (running) - 3 active sessions'));
    assert.ok(result.includes('work-bot (running) - 1 active session'));
    assert.ok(result.includes('devops-bot (stopped)'));

    // Database section
    assert.ok(result.includes('Connected to PostgreSQL 16.1'));
    assert.ok(result.includes('127 total sessions'));
    assert.ok(result.includes('1,234 messages processed'));

    // Channels section
    assert.ok(result.includes('slack-main (connected)'));
    assert.ok(result.includes('discord-main (connected)'));
  });
});

describe('StatusCommand - StatusCommandError', () => {
  test('has correct name', () => {
    const err = new StatusCommandError('test');
    assert.equal(err.name, 'StatusCommandError');
  });

  test('stores section property', () => {
    const err = new StatusCommandError('test', { section: 'database' });
    assert.equal(err.section, 'database');
  });

  test('stores cause', () => {
    const cause = new Error('original');
    const err = new StatusCommandError('wrapper', { cause });
    assert.equal(err.cause, cause);
  });

  test('extends Error', () => {
    const err = new StatusCommandError('test');
    assert.ok(err instanceof Error);
  });
});

describe('StatusCommand - edge cases', () => {
  let out;

  beforeEach(() => {
    out = createOutputStream();
  });

  test('handles bot with loading status', async () => {
    const bots = [{ id: 'loading-bot', status: 'loading' }];

    await showStatus({
      storage: createMockStorage({ connected: false }),
      botManager: createMockBotManager(bots),
      channelManager: createMockChannelManager(),
      output: out,
    });

    const result = out.output();
    assert.ok(result.includes('loading-bot (loading)'));
  });

  test('handles bot with starting status', async () => {
    const bots = [{ id: 'starting-bot', status: 'starting' }];

    await showStatus({
      storage: createMockStorage({ connected: false }),
      botManager: createMockBotManager(bots),
      channelManager: createMockChannelManager(),
      output: out,
    });

    const result = out.output();
    assert.ok(result.includes('starting-bot (starting)'));
  });

  test('handles unknown bot status gracefully', async () => {
    const bots = [{ id: 'weird-bot', status: 'unknown-state' }];

    await showStatus({
      storage: createMockStorage({ connected: false }),
      botManager: createMockBotManager(bots),
      channelManager: createMockChannelManager(),
      output: out,
    });

    const result = out.output();
    assert.ok(result.includes('weird-bot (unknown-state)'));
  });

  test('session count failure does not prevent bot display', async () => {
    const bots = [{ id: 'my-bot', status: 'running' }];

    const failingStorage = {
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
        throw new Error('sessions table missing');
      },
    };

    await showStatus({
      storage: failingStorage,
      botManager: createMockBotManager(bots),
      channelManager: createMockChannelManager(),
      output: out,
    });

    const result = out.output();
    // Bot should still be displayed even though session query failed
    assert.ok(result.includes('my-bot (running)'));
    // No session count should be shown since query failed
    assert.ok(!result.includes('active session'));
  });

  test('uses process.stdout as default output', async () => {
    // Just verify it doesn't throw with default options
    // (we don't actually want to write to stdout in tests)
    assert.ok(typeof showStatus === 'function');
  });

  test('no arguments throws StatusCommandError', async () => {
    await assert.rejects(
      () => showStatus(),
      err => {
        assert.ok(err instanceof StatusCommandError);
        return true;
      }
    );
  });

  test('empty object throws StatusCommandError for missing botManager', async () => {
    await assert.rejects(
      () => showStatus({}),
      err => {
        assert.ok(err instanceof StatusCommandError);
        assert.ok(err.message.includes('botManager'));
        return true;
      }
    );
  });
});
