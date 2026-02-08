/**
 * Unit tests for StatusCommand worker status integration
 *
 * Tests the display of worker node status in the status command output,
 * including healthy, degraded, and offline workers with load information.
 */

import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { showStatus, StatusCommandError } from '../../../src/cli/StatusCommand.js';

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
