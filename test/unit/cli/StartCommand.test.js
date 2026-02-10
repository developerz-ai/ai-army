/**
 * Unit tests for StartCommand
 *
 * Tests the runStart() function with mock dependencies:
 * - Mock Orchestrator with configurable start/stop behavior
 * - Verifies output formatting, signal handling, and error cases
 * - Tests production mode startup scenarios
 *
 * Mirrors co-located src/cli/StartCommand.test.js into test/unit/cli/ structure
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { runStart, StartCommandError } from '../../../src/cli/StartCommand.js';
import { OrchestratorError } from '../../../src/core/orchestrator.js';

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
 * @param {Object} [options.status] - Status to return from getStatus()
 * @param {Object} [options.apiServer] - Mock API server object
 * @returns {Object} Mock Orchestrator
 */
function createMockOrchestrator(options = {}) {
  const {
    startError,
    stopError,
    status = {
      botCount: 3,
      channelCount: 2,
      databaseConnected: true,
      state: 'running',
      apiServerRunning: false,
      apiServerPort: null,
    },
    apiServer = null,
  } = options;

  return {
    start: mock.fn(async () => {
      if (startError) throw startError;
    }),
    stop: mock.fn(async () => {
      if (stopError) throw stopError;
    }),
    getStatus: mock.fn(() => status),
    getState: mock.fn(() => status.state || 'running'),
    apiServer,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('StartCommand - runStart()', () => {
  let out;
  let proc;

  beforeEach(() => {
    out = createOutputStream();
    proc = createMockProcess();
  });

  describe('startup and output', () => {
    test('outputs production mode message on start', async () => {
      const orch = createMockOrchestrator();

      await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      const result = out.output();
      assert.ok(result.includes('production mode'));
    });

    test('calls orchestrator.start()', async () => {
      const orch = createMockOrchestrator();

      await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      assert.equal(orch.start.mock.calls.length, 1);
    });

    test('displays running message after successful start', async () => {
      const orch = createMockOrchestrator();

      await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      const result = out.output();
      assert.ok(result.includes('AI Army is running'));
      assert.ok(result.includes('Ctrl+C'));
    });

    test('displays bot and channel counts', async () => {
      const orch = createMockOrchestrator({
        status: {
          botCount: 5,
          channelCount: 3,
          databaseConnected: true,
          apiServerRunning: false,
          apiServerPort: null,
        },
      });

      await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      const result = out.output();
      assert.ok(result.includes('Bots: 5'));
      assert.ok(result.includes('Channels: 3'));
      assert.ok(result.includes('Database: connected'));
    });

    test('displays database not connected when disconnected', async () => {
      const orch = createMockOrchestrator({
        status: {
          botCount: 1,
          channelCount: 0,
          databaseConnected: false,
          apiServerRunning: false,
          apiServerPort: null,
        },
      });

      await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      const result = out.output();
      assert.ok(result.includes('Database: not connected'));
    });

    test('displays API server info when running', async () => {
      const orch = createMockOrchestrator({
        status: {
          botCount: 2,
          channelCount: 1,
          databaseConnected: true,
          apiServerRunning: true,
          apiServerPort: 3000,
        },
        apiServer: {
          host: 'localhost',
        },
      });

      await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      const result = out.output();
      assert.ok(result.includes('API:'));
      assert.ok(result.includes('localhost:3000'));
    });

    test('displays API server with default host when host is missing', async () => {
      const orch = createMockOrchestrator({
        status: {
          botCount: 2,
          channelCount: 1,
          databaseConnected: true,
          apiServerRunning: true,
          apiServerPort: 3000,
        },
        apiServer: null,
      });

      await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      const result = out.output();
      assert.ok(result.includes('API:'));
      assert.ok(result.includes('0.0.0.0:3000'));
    });

    test('omits API server info when not running', async () => {
      const orch = createMockOrchestrator({
        status: {
          botCount: 2,
          channelCount: 1,
          databaseConnected: true,
          apiServerRunning: false,
          apiServerPort: null,
        },
      });

      await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      const result = out.output();
      assert.ok(!result.includes('API:'));
    });
  });

  describe('signal handling and shutdown', () => {
    test('registers SIGINT handler', async () => {
      const orch = createMockOrchestrator();

      await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      assert.ok(proc.handlers.SIGINT, 'SIGINT handler should be registered');
    });

    test('registers SIGTERM handler', async () => {
      const orch = createMockOrchestrator();

      await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      assert.ok(proc.handlers.SIGTERM, 'SIGTERM handler should be registered');
    });

    test('SIGINT triggers graceful shutdown', async () => {
      const orch = createMockOrchestrator();

      await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      await proc.emit('SIGINT');

      assert.equal(orch.stop.mock.calls.length, 1);
      assert.ok(out.output().includes('SIGINT'));
      assert.ok(out.output().includes('Shutdown complete'));
    });

    test('SIGTERM triggers graceful shutdown', async () => {
      const orch = createMockOrchestrator();

      await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      await proc.emit('SIGTERM');

      assert.equal(orch.stop.mock.calls.length, 1);
      assert.ok(out.output().includes('SIGTERM'));
      assert.ok(out.output().includes('Shutdown complete'));
    });

    test('calls onShutdown callback after shutdown', async () => {
      const orch = createMockOrchestrator();
      let shutdownCalled = false;

      await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
        onShutdown: () => {
          shutdownCalled = true;
        },
      });

      await proc.emit('SIGINT');
      assert.ok(shutdownCalled);
    });

    test('removes signal handlers after first shutdown', async () => {
      const orch = createMockOrchestrator();

      await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      await proc.emit('SIGINT');

      // Try to emit again - should not call stop again
      await proc.emit('SIGINT');

      assert.equal(orch.stop.mock.calls.length, 1, 'stop should only be called once');
    });

    test('handles shutdown errors gracefully', async () => {
      const orch = createMockOrchestrator({
        stopError: new Error('Shutdown error'),
      });

      await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      await proc.emit('SIGINT');

      const result = out.output();
      assert.ok(result.includes('Shutdown completed with errors'));
      assert.ok(result.includes('Shutdown error'));
    });

    test('onShutdown is called even when shutdown has errors', async () => {
      const orch = createMockOrchestrator({
        stopError: new Error('Shutdown error'),
      });
      let shutdownCalled = false;

      await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
        onShutdown: () => {
          shutdownCalled = true;
        },
      });

      await proc.emit('SIGINT');
      assert.ok(shutdownCalled);
    });
  });

  describe('error handling', () => {
    test('handles OrchestratorError during startup', async () => {
      const startError = new OrchestratorError('Configuration validation failed', {
        operation: 'start',
        component: 'config',
      });
      const orch = createMockOrchestrator({ startError });

      const result = await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      const output = out.output();
      assert.ok(output.includes('Startup failed'));
      assert.ok(output.includes('Configuration validation failed'));
      assert.ok(output.includes('Component: config'));
      assert.ok(result.orchestrator);
    });

    test('handles OrchestratorError without component field', async () => {
      const startError = new OrchestratorError('Generic error', {
        operation: 'start',
      });
      const orch = createMockOrchestrator({ startError });

      const result = await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      const output = out.output();
      assert.ok(output.includes('Startup failed'));
      assert.ok(output.includes('Generic error'));
      assert.ok(!output.includes('Component:'));
      assert.ok(result.orchestrator);
    });

    test('attempts cleanup after OrchestratorError', async () => {
      const startError = new OrchestratorError('Start failed');
      const orch = createMockOrchestrator({ startError });

      await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      assert.equal(orch.stop.mock.calls.length, 1);
    });

    test('ignores cleanup errors after OrchestratorError', async () => {
      const startError = new OrchestratorError('Start failed');
      const stopError = new Error('Stop also failed');
      const orch = createMockOrchestrator({ startError, stopError });

      const result = await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      // Should complete despite cleanup error
      assert.ok(result.orchestrator);
      const output = out.output();
      assert.ok(output.includes('Startup failed'));
    });

    test('throws StartCommandError for non-Orchestrator errors', async () => {
      const startError = new Error('Unexpected error');
      const orch = createMockOrchestrator({ startError });

      await assert.rejects(
        () =>
          runStart({
            orchestrator: orch,
            output: out,
            processRef: proc,
          }),
        err => {
          assert.ok(err instanceof StartCommandError);
          assert.ok(err.message.includes('Startup failed'));
          assert.equal(err.cause, startError);
          return true;
        }
      );
    });
  });

  describe('return value', () => {
    test('returns orchestrator instance', async () => {
      const orch = createMockOrchestrator();

      const result = await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      assert.equal(result.orchestrator, orch);
    });

    test('returns orchestrator even on OrchestratorError', async () => {
      const startError = new OrchestratorError('Start failed');
      const orch = createMockOrchestrator({ startError });

      const result = await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      assert.equal(result.orchestrator, orch);
    });
  });

  describe('Orchestrator creation', () => {
    test('creates Orchestrator when not injected', async () => {
      // Test without injecting orchestrator (uses default paths)
      const result = await runStart({
        output: out,
        processRef: proc,
        configPath: './config.json',
        botsPath: './bots',
        migrationsPath: './migrations',
      });

      assert.ok(result.orchestrator, 'Should create orchestrator');
    });

    test('uses injected orchestrator when provided', async () => {
      const orch = createMockOrchestrator();

      const result = await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      assert.equal(result.orchestrator, orch, 'Should use injected orchestrator');
      assert.equal(orch.start.mock.calls.length, 1);
    });
  });

  describe('default parameters', () => {
    test('uses default output when not provided', async () => {
      const orch = createMockOrchestrator();

      // Should not throw when output is not provided (uses process.stdout)
      const result = await runStart({
        orchestrator: orch,
        processRef: proc,
      });

      assert.ok(result.orchestrator);
    });

    test('uses default processRef when not provided', async () => {
      const orch = createMockOrchestrator();

      // Should not throw when processRef is not provided (uses process)
      const result = await runStart({
        orchestrator: orch,
        output: out,
      });

      assert.ok(result.orchestrator);
    });
  });
});

describe('StartCommand - StartCommandError', () => {
  test('has correct name', () => {
    const err = new StartCommandError('test');
    assert.equal(err.name, 'StartCommandError');
  });

  test('stores cause', () => {
    const cause = new Error('original');
    const err = new StartCommandError('wrapper', { cause });
    assert.equal(err.cause, cause);
  });

  test('extends Error', () => {
    const err = new StartCommandError('test');
    assert.ok(err instanceof Error);
  });

  test('works without options', () => {
    const err = new StartCommandError('test message');
    assert.equal(err.message, 'test message');
    assert.equal(err.name, 'StartCommandError');
  });
});
