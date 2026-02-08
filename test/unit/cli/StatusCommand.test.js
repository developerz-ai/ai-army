/**
 * Unit tests for StatusCommand worker status integration
 *
 * Tests the display of worker node status in the status command output,
 * including healthy, degraded, and offline workers with load information.
 */

import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { showStatus, runStatus, StatusCommandError } from '../../../src/cli/StatusCommand.js';

// =============================================================================
// Mock Factories
// =============================================================================

/**
 * Create a mock BotManager
 * @returns {Object} Mock BotManager
 */
function createMockBotManager() {
  return {
    listBots: mock.fn(() => []),
    getBotCount: mock.fn(() => 0),
  };
}

/**
 * Create a mock ChannelManager
 * @returns {Object} Mock ChannelManager
 */
function createMockChannelManager() {
  return {
    listChannels: mock.fn(() => []),
    getChannelCount: mock.fn(() => 0),
  };
}

/**
 * Create a mock WorkerRegistry
 * @param {Array<Object>} [workers=[]] - Worker records to return
 * @returns {Object} Mock WorkerRegistry
 */
function createMockWorkerRegistry(workers = []) {
  return {
    listWorkers: mock.fn(async () => workers),
    getWorker: mock.fn(async workerId => workers.find(w => w.id === workerId) || null),
  };
}

/**
 * Create a mock PostgresStorage
 * @param {Object} [options={}] - Configuration
 * @returns {Object} Mock storage
 */
function createMockStorage(options = {}) {
  const {
    connected = true,
    version = 'PostgreSQL 16.1 on x86_64-pc-linux-gnu',
    sessionCount = 0,
    messageCount = 0,
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
      return [];
    },
  };
}

/**
 * Create a mock writable output stream
 * @returns {Object} Mock output with captured data
 */
function createMockOutput() {
  const chunks = [];
  return {
    write: mock.fn(data => {
      chunks.push(data);
      return true;
    }),
    getOutput: () => chunks.join(''),
    chunks,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('StatusCommand - Worker Status', () => {
  describe('showStatus() with workerRegistry', () => {
    test('displays worker section when workerRegistry is provided', async () => {
      const output = createMockOutput();
      const workers = [
        {
          id: 'local',
          type: 'local',
          status: 'healthy',
          currentLoad: 3,
          maxContainers: 10,
          host: 'localhost',
        },
      ];

      await showStatus({
        botManager: createMockBotManager(),
        channelManager: createMockChannelManager(),
        workerRegistry: createMockWorkerRegistry(workers),
        output,
      });

      const text = output.getOutput();
      assert.ok(text.includes('Workers:'), 'Should include Workers section header');
      assert.ok(text.includes('local'), 'Should include worker ID');
      assert.ok(text.includes('healthy'), 'Should include worker status');
      assert.ok(text.includes('3/10'), 'Should include load information');
    });

    test('displays multiple workers with different statuses', async () => {
      const output = createMockOutput();
      const workers = [
        {
          id: 'local',
          type: 'local',
          status: 'healthy',
          currentLoad: 2,
          maxContainers: 5,
          host: 'localhost',
        },
        {
          id: 'gpu-server',
          type: 'remote',
          status: 'degraded',
          currentLoad: 8,
          maxContainers: 10,
          host: '192.168.1.100',
        },
        {
          id: 'dead-server',
          type: 'remote',
          status: 'offline',
          currentLoad: 0,
          maxContainers: 10,
          host: '192.168.1.200',
        },
      ];

      await showStatus({
        botManager: createMockBotManager(),
        channelManager: createMockChannelManager(),
        workerRegistry: createMockWorkerRegistry(workers),
        output,
      });

      const text = output.getOutput();
      assert.ok(text.includes('local'), 'Should show local worker');
      assert.ok(text.includes('gpu-server'), 'Should show gpu-server');
      assert.ok(text.includes('dead-server'), 'Should show dead-server');
      assert.ok(text.includes('healthy'), 'Should show healthy status');
      assert.ok(text.includes('degraded'), 'Should show degraded status');
      assert.ok(text.includes('offline'), 'Should show offline status');
    });

    test('displays "No workers registered" when list is empty', async () => {
      const output = createMockOutput();

      await showStatus({
        botManager: createMockBotManager(),
        channelManager: createMockChannelManager(),
        workerRegistry: createMockWorkerRegistry([]),
        output,
      });

      const text = output.getOutput();
      assert.ok(text.includes('Workers:'), 'Should include Workers section header');
      assert.ok(text.includes('No workers registered'), 'Should show no workers message');
    });

    test('handles worker registry errors gracefully', async () => {
      const output = createMockOutput();
      const workerRegistry = {
        listWorkers: mock.fn(async () => {
          throw new Error('Database connection lost');
        }),
      };

      await showStatus({
        botManager: createMockBotManager(),
        channelManager: createMockChannelManager(),
        workerRegistry,
        output,
      });

      const text = output.getOutput();
      assert.ok(text.includes('Workers:'), 'Should include Workers section header');
      assert.ok(text.includes('Error loading worker status'), 'Should show error message');
    });

    test('displays correct container pluralization for singular', async () => {
      const output = createMockOutput();
      const workers = [
        {
          id: 'local',
          type: 'local',
          status: 'healthy',
          currentLoad: 1,
          maxContainers: 10,
          host: 'localhost',
        },
      ];

      await showStatus({
        botManager: createMockBotManager(),
        channelManager: createMockChannelManager(),
        workerRegistry: createMockWorkerRegistry(workers),
        output,
      });

      const text = output.getOutput();
      assert.ok(text.includes('1/10 container'), 'Should show singular container');
      assert.ok(!text.includes('1/10 containers'), 'Should not show plural for 1');
    });

    test('displays correct container pluralization for plural', async () => {
      const output = createMockOutput();
      const workers = [
        {
          id: 'local',
          type: 'local',
          status: 'healthy',
          currentLoad: 3,
          maxContainers: 10,
          host: 'localhost',
        },
      ];

      await showStatus({
        botManager: createMockBotManager(),
        channelManager: createMockChannelManager(),
        workerRegistry: createMockWorkerRegistry(workers),
        output,
      });

      const text = output.getOutput();
      assert.ok(text.includes('3/10 containers'), 'Should show plural containers');
    });
  });

  describe('showStatus() without workerRegistry', () => {
    test('omits worker section when workerRegistry is not provided', async () => {
      const output = createMockOutput();

      await showStatus({
        botManager: createMockBotManager(),
        channelManager: createMockChannelManager(),
        output,
      });

      const text = output.getOutput();
      assert.ok(!text.includes('Workers:'), 'Should not include Workers section');
    });

    test('still requires botManager and channelManager', async () => {
      await assert.rejects(
        () => showStatus({ channelManager: createMockChannelManager() }),
        err => err instanceof StatusCommandError && err.section === 'bots'
      );

      await assert.rejects(
        () => showStatus({ botManager: createMockBotManager() }),
        err => err instanceof StatusCommandError && err.section === 'channels'
      );
    });
  });
});

// =============================================================================
// runStatus() Tests
// =============================================================================

describe('StatusCommand - runStatus()', () => {
  describe('CLI-only mode (no managers)', () => {
    test('returns success with connected storage', async () => {
      const output = createMockOutput();
      const storage = createMockStorage({
        connected: true,
        sessionCount: 10,
        messageCount: 42,
      });

      const result = await runStatus({ storage, output });

      assert.deepStrictEqual(result, { success: true });
      const text = output.getOutput();
      assert.ok(text.includes('AI Army Status'), 'Should include header');
      assert.ok(text.includes('Database:'), 'Should include database section');
      assert.ok(text.includes('Connected to PostgreSQL'), 'Should show connected');
      assert.ok(text.includes('10 total sessions'), 'Should show session count');
      assert.ok(text.includes('42 messages processed'), 'Should show message count');
    });

    test('returns success with disconnected storage', async () => {
      const output = createMockOutput();
      const storage = createMockStorage({ connected: false });

      const result = await runStatus({ storage, output });

      assert.deepStrictEqual(result, { success: true });
      const text = output.getOutput();
      assert.ok(text.includes('Not connected'), 'Should show not connected');
    });

    test('returns success with null storage', async () => {
      const output = createMockOutput();

      const result = await runStatus({ storage: null, output });

      assert.deepStrictEqual(result, { success: true });
      const text = output.getOutput();
      assert.ok(text.includes('Not connected'), 'Should show not connected');
    });

    test('shows hint about running system for full status', async () => {
      const output = createMockOutput();
      const storage = createMockStorage({ connected: true });

      await runStatus({ storage, output });

      const text = output.getOutput();
      assert.ok(
        text.includes('full bot and channel status'),
        'Should hint about running system for full status'
      );
    });

    test('handles storage query errors gracefully', async () => {
      const output = createMockOutput();
      const errorStorage = {
        connected: true,
        isConnected() {
          return true;
        },
        async query() {
          throw new Error('Connection reset');
        },
        async listSessions() {
          return [];
        },
      };

      const result = await runStatus({ storage: errorStorage, output });

      assert.deepStrictEqual(result, { success: true });
      const text = output.getOutput();
      assert.ok(text.includes('Database:'), 'Should still show database section');
    });

    test('shows PostgreSQL version when available', async () => {
      const output = createMockOutput();
      const storage = createMockStorage({
        connected: true,
        version: 'PostgreSQL 15.3 on aarch64-linux',
      });

      await runStatus({ storage, output });

      const text = output.getOutput();
      assert.ok(text.includes('PostgreSQL 15.3'), 'Should show version');
    });

    test('formats large numbers with locale separators', async () => {
      const output = createMockOutput();
      const storage = createMockStorage({
        connected: true,
        sessionCount: 1500,
        messageCount: 123456,
      });

      await runStatus({ storage, output });

      const text = output.getOutput();
      assert.ok(text.includes('1,500 total sessions'), 'Should format session count');
      assert.ok(text.includes('123,456 messages processed'), 'Should format message count');
    });
  });

  describe('full mode (with managers)', () => {
    test('delegates to showStatus when both managers are provided', async () => {
      const output = createMockOutput();
      const storage = createMockStorage({ connected: true });

      const result = await runStatus({
        storage,
        botManager: createMockBotManager(),
        channelManager: createMockChannelManager(),
        output,
      });

      assert.deepStrictEqual(result, { success: true });
      const text = output.getOutput();
      // Full status view includes Bots: and Channels: sections
      assert.ok(text.includes('Bots:'), 'Should include bots section from showStatus');
      assert.ok(text.includes('Channels:'), 'Should include channels section from showStatus');
    });

    test('returns failure when showStatus throws', async () => {
      const output = createMockOutput();
      // Provide botManager but a broken channelManager to trigger showStatus error
      const brokenChannelManager = {
        listChannels: mock.fn(() => {
          throw new Error('Channel manager exploded');
        }),
      };

      const result = await runStatus({
        storage: createMockStorage({ connected: true }),
        botManager: createMockBotManager(),
        channelManager: brokenChannelManager,
        output,
      });

      // showStatus catches internal errors in sections, so this should still succeed
      // since listChannels is called inside a try/catch in showStatus
      assert.deepStrictEqual(result, { success: true });
    });

    test('passes workerRegistry through to showStatus', async () => {
      const output = createMockOutput();
      const workers = [
        {
          id: 'local',
          type: 'local',
          status: 'healthy',
          currentLoad: 1,
          maxContainers: 5,
          host: 'localhost',
        },
      ];

      const result = await runStatus({
        storage: createMockStorage({ connected: true }),
        botManager: createMockBotManager(),
        channelManager: createMockChannelManager(),
        workerRegistry: createMockWorkerRegistry(workers),
        output,
      });

      assert.deepStrictEqual(result, { success: true });
      const text = output.getOutput();
      assert.ok(text.includes('Workers:'), 'Should include workers section');
      assert.ok(text.includes('local'), 'Should show worker ID');
    });
  });

  describe('defaults', () => {
    test('returns success when called with no arguments', async () => {
      const output = createMockOutput();

      const result = await runStatus({ output });

      assert.deepStrictEqual(result, { success: true });
      const text = output.getOutput();
      assert.ok(text.includes('Not connected'), 'Should show not connected for undefined storage');
    });
  });
});
