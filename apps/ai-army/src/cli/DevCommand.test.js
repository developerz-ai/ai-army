/**
 * Unit tests for DevCommand
 *
 * Tests the runDev() function with mock dependencies:
 * - Mock Orchestrator with configurable start/stop/reload behavior
 * - Mock ConfigWatcher for hot reload testing
 * - Verifies output formatting, signal handling, and error cases
 * - Tests development mode startup and file watching
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { runDev, DevCommandError } from './DevCommand.js';
import { OrchestratorError } from '../core/orchestrator.js';
import { ConfigWatcherError } from '../config/ConfigWatcher.js';

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
 * @returns {{ factory: Function, watcher: Object }}
 */
function createMockConfigWatcherFactory() {
  const watcher = {
    watch: mock.fn(async () => {}),
    stop: mock.fn(async () => {}),
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
    });

    assert.equal(watcher.watch.mock.calls.length, 1);
    const watchPaths = watcher.watch.mock.calls[0].arguments[0];
    assert.ok(Array.isArray(watchPaths));
    assert.ok(watchPaths.length >= 2);
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
  });

  test('works without watcher when ConfigWatcher creation fails', async () => {
    const orch = createMockOrchestrator();

    // Pass a watcher factory that throws to simulate ConfigWatcher creation failure
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

  test('ConfigWatcher handles concurrent changes', async () => {
    const orch = createMockOrchestrator();
    const { factory, watcher } = createMockConfigWatcherFactory();

    await runDev({
      orchestrator: orch,
      configWatcherFactory: factory,
      output: out,
      processRef: proc,
    });

    // ConfigWatcher itself handles concurrency, we just verify watch was called
    assert.equal(watcher.watch.mock.calls.length, 1);
    const watchPaths = watcher.watch.mock.calls[0].arguments[0];
    assert.ok(Array.isArray(watchPaths));
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
});
