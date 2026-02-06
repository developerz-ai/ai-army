/**
 * Unit tests for DevCommand
 *
 * Tests the runDev() function with mock dependencies:
 * - Mock Orchestrator with configurable start/stop/reload behavior
 * - Mock file watcher for hot reload testing
 * - Verifies output formatting, signal handling, and error cases
 * - Tests development mode startup and file watching
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { runDev, DevCommandError } from './DevCommand.js';
import { OrchestratorError } from '../core/orchestrator.js';

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
 * Create a mock watcher factory
 * @returns {{ factory: Function, watcher: Object }}
 */
function createMockWatcherFactory() {
  const handlers = {};
  const watcher = {
    on(event, handler) {
      handlers[event] = handler;
      return watcher;
    },
    close: mock.fn(async () => {}),
    handlers,
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
    const { factory } = createMockWatcherFactory();

    await runDev({
      orchestrator: orch,
      watcherFactory: factory,
      output: out,
      processRef: proc,
    });

    const result = out.output();
    assert.ok(result.includes('development mode'));
    assert.ok(result.includes('hot reload'));
  });

  test('calls orchestrator.start()', async () => {
    const orch = createMockOrchestrator();
    const { factory } = createMockWatcherFactory();

    await runDev({
      orchestrator: orch,
      watcherFactory: factory,
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
    const { factory } = createMockWatcherFactory();

    await runDev({
      orchestrator: orch,
      watcherFactory: factory,
      output: out,
      processRef: proc,
    });

    const result = out.output();
    assert.ok(result.includes('Bots: 4'));
    assert.ok(result.includes('Channels: 2'));
  });

  test('shows watching message when watcher is active', async () => {
    const orch = createMockOrchestrator();
    const { factory } = createMockWatcherFactory();

    await runDev({
      orchestrator: orch,
      watcherFactory: factory,
      output: out,
      processRef: proc,
    });

    const result = out.output();
    assert.ok(result.includes('Watching config files'));
  });

  test('registers file change handler', async () => {
    const orch = createMockOrchestrator();
    const { factory, watcher } = createMockWatcherFactory();

    await runDev({
      orchestrator: orch,
      watcherFactory: factory,
      output: out,
      processRef: proc,
    });

    assert.ok(watcher.handlers.change, 'change handler should be registered');
    assert.ok(watcher.handlers.add, 'add handler should be registered');
  });

  test('file change triggers reload', async () => {
    const orch = createMockOrchestrator();
    const { factory, watcher } = createMockWatcherFactory();

    await runDev({
      orchestrator: orch,
      watcherFactory: factory,
      output: out,
      processRef: proc,
    });

    // Simulate file change
    await watcher.handlers.change('./config.json');

    assert.equal(orch.reload.mock.calls.length, 1);
    const result = out.output();
    assert.ok(result.includes('File changed'));
    assert.ok(result.includes('Reload complete'));
  });

  test('handles reload error gracefully', async () => {
    const orch = createMockOrchestrator({
      reloadError: new Error('Config validation failed'),
    });
    const { factory, watcher } = createMockWatcherFactory();

    await runDev({
      orchestrator: orch,
      watcherFactory: factory,
      output: out,
      processRef: proc,
    });

    // Simulate file change
    await watcher.handlers.change('./config.json');

    assert.ok(out.output().includes('Reload failed'));
    assert.ok(out.output().includes('Config validation failed'));
  });

  test('SIGINT triggers graceful shutdown and closes watcher', async () => {
    const orch = createMockOrchestrator();
    const { factory, watcher } = createMockWatcherFactory();

    await runDev({
      orchestrator: orch,
      watcherFactory: factory,
      output: out,
      processRef: proc,
    });

    await proc.emit('SIGINT');

    assert.equal(watcher.close.mock.calls.length, 1);
    assert.equal(orch.stop.mock.calls.length, 1);
    assert.ok(out.output().includes('Shutdown complete'));
  });

  test('calls onShutdown callback after shutdown', async () => {
    const orch = createMockOrchestrator();
    const { factory } = createMockWatcherFactory();
    let shutdownCalled = false;

    await runDev({
      orchestrator: orch,
      watcherFactory: factory,
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
    const { factory } = createMockWatcherFactory();

    const result = await runDev({
      orchestrator: orch,
      watcherFactory: factory,
      output: out,
      processRef: proc,
    });

    const output = out.output();
    assert.ok(output.includes('Startup failed'));
    assert.ok(output.includes('Database connection failed'));
    assert.ok(output.includes('Component: database'));
    assert.equal(result.watcher, null);
  });

  test('works without watcher (null watcher factory returns null)', async () => {
    const orch = createMockOrchestrator();

    // Pass a watcher factory that returns null to simulate chokidar not available
    const result = await runDev({
      orchestrator: orch,
      watcherFactory: () => null,
      output: out,
      processRef: proc,
    });

    assert.ok(result.orchestrator);
    assert.equal(result.watcher, null);
    // Should still work even without file watching
    const output = out.output();
    assert.ok(output.includes('development mode'));
    assert.ok(output.includes('AI Army is running'));
  });

  test('returns orchestrator and watcher', async () => {
    const orch = createMockOrchestrator();
    const { factory, watcher } = createMockWatcherFactory();

    const result = await runDev({
      orchestrator: orch,
      watcherFactory: factory,
      output: out,
      processRef: proc,
    });

    assert.equal(result.orchestrator, orch);
    assert.equal(result.watcher, watcher);
  });

  test('prevents concurrent reloads', async () => {
    let reloadCount = 0;
    let resolveReload;
    const orch = createMockOrchestrator();
    // Override reload with a controllable promise barrier
    orch.reload = mock.fn(() => {
      reloadCount++;
      return new Promise(resolve => {
        resolveReload = () => resolve({ reloaded: [], failed: [] });
      });
    });

    const { factory, watcher } = createMockWatcherFactory();

    await runDev({
      orchestrator: orch,
      watcherFactory: factory,
      output: out,
      processRef: proc,
    });

    // Trigger first change — starts reload (sets reloading = true)
    const firstReload = watcher.handlers.change('./config.json');

    // Trigger second change while first is still in progress — should be ignored
    watcher.handlers.change('./bots/test/config.json');

    // Release the first reload and await it
    resolveReload();
    await firstReload;

    // Only one reload should have been triggered
    assert.equal(reloadCount, 1);
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
