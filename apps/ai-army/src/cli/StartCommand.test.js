/**
 * Unit tests for StartCommand
 *
 * Tests the runStart() function with mock dependencies:
 * - Mock Orchestrator with configurable start/stop behavior
 * - Verifies output formatting, signal handling, and error cases
 * - Tests production mode startup scenarios
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { runStart, StartCommandError } from './StartCommand.js';
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
 * @param {Object} [options.status] - Status to return from getStatus()
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
    },
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
    assert.ok(out.output().includes('errors'));
  });

  test('returns orchestrator instance', async () => {
    const orch = createMockOrchestrator();

    const result = await runStart({
      orchestrator: orch,
      output: out,
      processRef: proc,
    });

    assert.equal(result.orchestrator, orch);
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
});
