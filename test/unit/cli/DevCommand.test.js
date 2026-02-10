/**
 * Unit tests for DevCommand
 *
 * Tests the runDev() function with mock dependencies:
 * - Mock Orchestrator with configurable start/stop/reload behavior
 * - Mock ConfigWatcher for hot reload testing
 * - Verifies output formatting, signal handling, and error cases
 * - Tests development mode startup and file watching
 *
 * Mirrors co-located src/cli/DevCommand.test.js into test/unit/cli/ structure
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { runDev, DevCommandError } from '../../../src/cli/DevCommand.js';
import { OrchestratorError } from '../../../src/core/orchestrator.js';
import { ConfigWatcherError } from '../../../src/config/ConfigWatcher.js';

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
 * Create a mock process object for signal handling tests
 * @returns {Object} Mock process with on() and signal tracking
 */
function createMockProcess() {
  const handlers = {};
  return {
    on(signal, handler) {
      handlers[signal] = handler;
    },
    removeListener(signal, handler) {
      if (handlers[signal] === handler) {
        delete handlers[signal];
      }
    },
    async emit(signal) {
      if (handlers[signal]) {
        await handlers[signal]();
      }
    },
    handlers,
  };
}

/**
 * Create a mock Orchestrator
 * @param {Object} [options] - Options
 * @param {Error} [options.startError] - Error to throw from start()
 * @param {Error} [options.stopError] - Error to throw from stop()
 * @param {Object} [options.reloadResult] - Result from reload()
 * @param {Error} [options.reloadError] - Error to throw from reload()
 * @param {Object} [options.status] - Status to return from getStatus()
 * @returns {Object} Mock Orchestrator
 */
function createMockOrchestrator(options = {}) {
  const {
    startError,
    stopError,
    reloadResult = { reloaded: ['bot1'], failed: [] },
    reloadError,
    status = {
      botCount: 2,
      channelCount: 1,
      databaseConnected: true,
      state: 'running',
    },
  } = options;

  return {
    start: mock.fn(async () => {
      if (startError) throw startError;
    }),
    stop: mock.fn(async () => {
      if (stopError) throw stopError;
    }),
    reload: mock.fn(async () => {
      if (reloadError) throw reloadError;
      return reloadResult;
    }),
    getStatus: mock.fn(() => status),
    getState: mock.fn(() => status.state || 'running'),
  };
}

/**
 * Create a mock ConfigWatcher factory
 * @param {Object} [options] - Options
 * @param {Error} [options.watchError] - Error to throw from watch()
 * @param {Error} [options.stopError] - Error to throw from stop()
 * @returns {{ factory: Function, watcher: Object }}
 */
function createMockConfigWatcherFactory(options = {}) {
  const { watchError, stopError } = options;

  const watcher = {
    watch: mock.fn(async () => {
      if (watchError) throw watchError;
    }),
    stop: mock.fn(async () => {
      if (stopError) throw stopError;
    }),
  };

  const factory = mock.fn(() => watcher);

  return { factory, watcher };
}

// ============================================================================
// Tests
// ============================================================================

describe('DevCommand - runDev()', () => {
  let out;
  let proc;

  beforeEach(() => {
    out = createOutputStream();
    proc = createMockProcess();
  });

  describe('startup and output', () => {
    test('outputs development mode message on start', async () => {
      const orch = createMockOrchestrator();
      const { factory } = createMockConfigWatcherFactory();

      await runDev({
        orchestrator: orch,
        configWatcherFactory: factory,
        output: out,
        processRef: proc,
      });

      const result = out.output();
      assert.ok(result.includes('development mode'));
      assert.ok(result.includes('hot reload'));
    });

    test('calls orchestrator.start()', async () => {
      const orch = createMockOrchestrator();
      const { factory } = createMockConfigWatcherFactory();

      await runDev({
        orchestrator: orch,
        configWatcherFactory: factory,
        output: out,
        processRef: proc,
      });

      assert.equal(orch.start.mock.calls.length, 1);
    });

    test('displays bot and channel counts', async () => {
      const orch = createMockOrchestrator({
        status: {
          botCount: 4,
          channelCount: 2,
          databaseConnected: true,
        },
      });
      const { factory } = createMockConfigWatcherFactory();

      await runDev({
        orchestrator: orch,
        configWatcherFactory: factory,
        output: out,
        processRef: proc,
      });

      const result = out.output();
      assert.ok(result.includes('Bots: 4'));
      assert.ok(result.includes('Channels: 2'));
    });

    test('displays database connection status', async () => {
      const orch = createMockOrchestrator({
        status: {
          botCount: 1,
          channelCount: 1,
          databaseConnected: true,
        },
      });
      const { factory } = createMockConfigWatcherFactory();

      await runDev({
        orchestrator: orch,
        configWatcherFactory: factory,
        output: out,
        processRef: proc,
      });

      const result = out.output();
      assert.ok(result.includes('Database: connected'));
    });

    test('displays database not connected status', async () => {
      const orch = createMockOrchestrator({
        status: {
          botCount: 1,
          channelCount: 1,
          databaseConnected: false,
        },
      });
      const { factory } = createMockConfigWatcherFactory();

      await runDev({
        orchestrator: orch,
        configWatcherFactory: factory,
        output: out,
        processRef: proc,
      });

      const result = out.output();
      assert.ok(result.includes('Database: not connected'));
    });
  });

  describe('ConfigWatcher integration', () => {
    test('shows watching message when watcher is active', async () => {
      const orch = createMockOrchestrator();
      const { factory } = createMockConfigWatcherFactory();

      await runDev({
        orchestrator: orch,
        configWatcherFactory: factory,
        output: out,
        processRef: proc,
      });

      const result = out.output();
      assert.ok(result.includes('Watching config files'));
    });

    test('calls ConfigWatcher.watch() with correct paths', async () => {
      const orch = createMockOrchestrator();
      const { factory, watcher } = createMockConfigWatcherFactory();

      await runDev({
        orchestrator: orch,
        configWatcherFactory: factory,
        output: out,
        processRef: proc,
        configPath: './config.json',
        botsPath: './bots',
      });

      assert.equal(watcher.watch.mock.calls.length, 1);
      const watchPaths = watcher.watch.mock.calls[0].arguments[0];
      assert.ok(Array.isArray(watchPaths));
      assert.equal(watchPaths.length, 2);
    });

    test('ConfigWatcher is created with orchestrator and logger', async () => {
      const orch = createMockOrchestrator();
      const { factory, watcher } = createMockConfigWatcherFactory();

      await runDev({
        orchestrator: orch,
        configWatcherFactory: factory,
        output: out,
        processRef: proc,
      });

      // Verify factory was called (creating ConfigWatcher)
      assert.equal(factory.mock.calls.length, 1);
      assert.equal(factory.mock.calls[0].arguments[0], orch);
      assert.ok(watcher.watch.mock.calls.length > 0);
    });

    test('handles ConfigWatcher creation error gracefully', async () => {
      const orch = createMockOrchestrator();
      const factory = mock.fn(() => {
        throw new ConfigWatcherError('chokidar not available');
      });

      await runDev({
        orchestrator: orch,
        configWatcherFactory: factory,
        output: out,
        processRef: proc,
      });

      const result = out.output();
      assert.ok(result.includes('File watching not available'));
      assert.ok(result.includes('running without hot reload'));
    });

    test('handles ConfigWatcher.watch() error gracefully', async () => {
      const orch = createMockOrchestrator();
      const { factory } = createMockConfigWatcherFactory({
        watchError: new ConfigWatcherError('fs.watch not supported'),
      });

      await runDev({
        orchestrator: orch,
        configWatcherFactory: factory,
        output: out,
        processRef: proc,
      });

      const result = out.output();
      assert.ok(result.includes('File watching not available'));
    });

    test('handles generic watcher creation error', async () => {
      const orch = createMockOrchestrator();
      const factory = mock.fn(() => {
        throw new Error('unexpected error');
      });

      await runDev({
        orchestrator: orch,
        configWatcherFactory: factory,
        output: out,
        processRef: proc,
      });

      const result = out.output();
      assert.ok(result.includes('File watching disabled'));
    });

    test('works without watcher when ConfigWatcher creation fails', async () => {
      const orch = createMockOrchestrator();

      const factory = mock.fn(() => {
        throw new Error('chokidar not available');
      });

      const result = await runDev({
        orchestrator: orch,
        configWatcherFactory: factory,
        output: out,
        processRef: proc,
      });

      assert.ok(result.orchestrator);
      assert.equal(result.watcher, null);
      // Should still work even without file watching
      const output = out.output();
      assert.ok(output.includes('development mode'));
      assert.ok(output.includes('File watching disabled'));
    });
  });

  describe('signal handling and shutdown', () => {
    test('SIGINT triggers graceful shutdown and stops watcher', async () => {
      const orch = createMockOrchestrator();
      const { factory, watcher } = createMockConfigWatcherFactory();

      await runDev({
        orchestrator: orch,
        configWatcherFactory: factory,
        output: out,
        processRef: proc,
      });

      await proc.emit('SIGINT');

      assert.equal(watcher.stop.mock.calls.length, 1);
      assert.equal(orch.stop.mock.calls.length, 1);
      assert.ok(out.output().includes('Shutdown complete'));
    });

    test('SIGTERM triggers graceful shutdown', async () => {
      const orch = createMockOrchestrator();
      const { factory, watcher } = createMockConfigWatcherFactory();

      await runDev({
        orchestrator: orch,
        configWatcherFactory: factory,
        output: out,
        processRef: proc,
      });

      await proc.emit('SIGTERM');

      assert.equal(watcher.stop.mock.calls.length, 1);
      assert.equal(orch.stop.mock.calls.length, 1);
      assert.ok(out.output().includes('Shutdown complete'));
    });

    test('calls onShutdown callback after shutdown', async () => {
      const orch = createMockOrchestrator();
      const { factory } = createMockConfigWatcherFactory();
      let shutdownCalled = false;

      await runDev({
        orchestrator: orch,
        configWatcherFactory: factory,
        output: out,
        processRef: proc,
        onShutdown: () => {
          shutdownCalled = true;
        },
      });

      await proc.emit('SIGINT');
      assert.ok(shutdownCalled);
    });

    test('handles watcher stop errors during shutdown', async () => {
      const orch = createMockOrchestrator();
      const { factory } = createMockConfigWatcherFactory({
        stopError: new Error('watcher stop failed'),
      });

      await runDev({
        orchestrator: orch,
        configWatcherFactory: factory,
        output: out,
        processRef: proc,
      });

      await proc.emit('SIGINT');

      // Should still complete shutdown despite watcher error
      assert.equal(orch.stop.mock.calls.length, 1);
      assert.ok(out.output().includes('Shutdown complete'));
    });

    test('handles orchestrator stop errors during shutdown', async () => {
      const orch = createMockOrchestrator({
        stopError: new Error('orchestrator stop failed'),
      });
      const { factory } = createMockConfigWatcherFactory();

      await runDev({
        orchestrator: orch,
        configWatcherFactory: factory,
        output: out,
        processRef: proc,
      });

      await proc.emit('SIGINT');

      assert.ok(out.output().includes('Shutdown completed with errors'));
      assert.ok(out.output().includes('orchestrator stop failed'));
    });

    test('removes signal handlers after first shutdown', async () => {
      const orch = createMockOrchestrator();
      const { factory, watcher } = createMockConfigWatcherFactory();

      await runDev({
        orchestrator: orch,
        configWatcherFactory: factory,
        output: out,
        processRef: proc,
      });

      await proc.emit('SIGINT');

      // Try to emit again - should not call stop again
      await proc.emit('SIGINT');

      assert.equal(watcher.stop.mock.calls.length, 1);
      assert.equal(orch.stop.mock.calls.length, 1);
    });

    test('handles shutdown when watcher is null', async () => {
      const orch = createMockOrchestrator();
      const factory = mock.fn(() => {
        throw new Error('no watcher');
      });

      await runDev({
        orchestrator: orch,
        configWatcherFactory: factory,
        output: out,
        processRef: proc,
      });

      await proc.emit('SIGINT');

      // Should still shutdown orchestrator gracefully
      assert.equal(orch.stop.mock.calls.length, 1);
      assert.ok(out.output().includes('Shutdown complete'));
    });
  });

  describe('error handling', () => {
    test('handles OrchestratorError during startup', async () => {
      const startError = new OrchestratorError('Database connection failed', {
        operation: 'start',
        component: 'database',
      });
      const orch = createMockOrchestrator({ startError });
      const { factory } = createMockConfigWatcherFactory();

      const result = await runDev({
        orchestrator: orch,
        configWatcherFactory: factory,
        output: out,
        processRef: proc,
      });

      const output = out.output();
      assert.ok(output.includes('Startup failed'));
      assert.ok(output.includes('Database connection failed'));
      assert.ok(output.includes('Component: database'));
      assert.equal(result.watcher, null);
      assert.equal(orch.stop.mock.calls.length, 1);
    });

    test('throws DevCommandError for non-Orchestrator errors', async () => {
      const startError = new Error('Unexpected error');
      const orch = createMockOrchestrator({ startError });
      const { factory } = createMockConfigWatcherFactory();

      await assert.rejects(
        () =>
          runDev({
            orchestrator: orch,
            configWatcherFactory: factory,
            output: out,
            processRef: proc,
          }),
        err => {
          assert.ok(err instanceof DevCommandError);
          assert.ok(err.message.includes('Startup failed'));
          assert.equal(err.cause, startError);
          return true;
        }
      );
    });

    test('handles OrchestratorError without component field', async () => {
      const startError = new OrchestratorError('Generic error', {
        operation: 'start',
      });
      const orch = createMockOrchestrator({ startError });
      const { factory } = createMockConfigWatcherFactory();

      const result = await runDev({
        orchestrator: orch,
        configWatcherFactory: factory,
        output: out,
        processRef: proc,
      });

      const output = out.output();
      assert.ok(output.includes('Startup failed'));
      assert.ok(output.includes('Generic error'));
      assert.ok(!output.includes('Component:'));
      assert.equal(result.watcher, null);
    });

    test('attempts cleanup after OrchestratorError', async () => {
      const startError = new OrchestratorError('Start failed');
      const orch = createMockOrchestrator({ startError });
      const { factory } = createMockConfigWatcherFactory();

      await runDev({
        orchestrator: orch,
        configWatcherFactory: factory,
        output: out,
        processRef: proc,
      });

      assert.equal(orch.stop.mock.calls.length, 1);
    });

    test('ignores cleanup errors after OrchestratorError', async () => {
      const startError = new OrchestratorError('Start failed');
      const stopError = new Error('Stop also failed');
      const orch = createMockOrchestrator({ startError, stopError });
      const { factory } = createMockConfigWatcherFactory();

      const result = await runDev({
        orchestrator: orch,
        configWatcherFactory: factory,
        output: out,
        processRef: proc,
      });

      // Should complete despite cleanup error
      assert.equal(result.watcher, null);
      const output = out.output();
      assert.ok(output.includes('Startup failed'));
    });
  });

  describe('return value', () => {
    test('returns orchestrator and watcher', async () => {
      const orch = createMockOrchestrator();
      const { factory, watcher } = createMockConfigWatcherFactory();

      const result = await runDev({
        orchestrator: orch,
        configWatcherFactory: factory,
        output: out,
        processRef: proc,
      });

      assert.equal(result.orchestrator, orch);
      assert.equal(result.watcher, watcher);
    });

    test('returns null watcher when watcher fails to create', async () => {
      const orch = createMockOrchestrator();
      const factory = mock.fn(() => {
        throw new Error('no watcher');
      });

      const result = await runDev({
        orchestrator: orch,
        configWatcherFactory: factory,
        output: out,
        processRef: proc,
      });

      assert.equal(result.orchestrator, orch);
      assert.equal(result.watcher, null);
    });

    test('returns orchestrator and null watcher on OrchestratorError', async () => {
      const startError = new OrchestratorError('Start failed');
      const orch = createMockOrchestrator({ startError });
      const { factory } = createMockConfigWatcherFactory();

      const result = await runDev({
        orchestrator: orch,
        configWatcherFactory: factory,
        output: out,
        processRef: proc,
      });

      assert.equal(result.orchestrator, orch);
      assert.equal(result.watcher, null);
    });
  });

  describe('default parameters', () => {
    test('uses default configPath when not provided', async () => {
      const orch = createMockOrchestrator();
      const { factory, watcher } = createMockConfigWatcherFactory();

      await runDev({
        orchestrator: orch,
        configWatcherFactory: factory,
        output: out,
        processRef: proc,
      });

      const watchPaths = watcher.watch.mock.calls[0].arguments[0];
      assert.ok(watchPaths.some(p => p.includes('config.json')));
    });

    test('uses default botsPath when not provided', async () => {
      const orch = createMockOrchestrator();
      const { factory, watcher } = createMockConfigWatcherFactory();

      await runDev({
        orchestrator: orch,
        configWatcherFactory: factory,
        output: out,
        processRef: proc,
      });

      const watchPaths = watcher.watch.mock.calls[0].arguments[0];
      assert.ok(watchPaths.some(p => p.includes('bots')));
    });

    test('uses custom configPath when provided', async () => {
      const orch = createMockOrchestrator();
      const { factory, watcher } = createMockConfigWatcherFactory();

      await runDev({
        orchestrator: orch,
        configWatcherFactory: factory,
        output: out,
        processRef: proc,
        configPath: './custom-config.json',
      });

      const watchPaths = watcher.watch.mock.calls[0].arguments[0];
      assert.ok(watchPaths.some(p => p.includes('custom-config.json')));
    });
  });
});

describe('DevCommand - DevCommandError', () => {
  test('has correct name', () => {
    const err = new DevCommandError('test');
    assert.equal(err.name, 'DevCommandError');
  });

  test('stores cause', () => {
    const cause = new Error('original');
    const err = new DevCommandError('wrapper', { cause });
    assert.equal(err.cause, cause);
  });

  test('extends Error', () => {
    const err = new DevCommandError('test');
    assert.ok(err instanceof Error);
  });

  test('works without options', () => {
    const err = new DevCommandError('test message');
    assert.equal(err.message, 'test message');
    assert.equal(err.name, 'DevCommandError');
  });
});
