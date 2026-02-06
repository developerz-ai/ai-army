/**
 * Unit tests for ConfigWatcher
 *
 * Tests file watching, validate-and-reload flow, error handling,
 * and lifecycle management using mock orchestrator and chokidar.
 *
 * Tests:
 * - Detects file changes
 * - Validates before applying
 * - Rejects invalid configs
 * - Reloads valid configs
 * - Can be stopped
 * - Prevents concurrent reloads
 * - Handles edge cases
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigWatcher, ConfigWatcherError } from './ConfigWatcher.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock chokidar watcher
 * @returns {{ watcher: Object, emit: Function }}
 */
function createMockWatcher() {
  const handlers = {};
  const watcher = {
    on(event, handler) {
      handlers[event] = handler;
      // Auto-resolve 'ready' so watch() completes
      if (event === 'ready') {
        Promise.resolve().then(() => handler());
      }
      return watcher;
    },
    close: mock.fn(async () => {}),
    handlers,
  };

  const emit = async (event, ...args) => {
    if (handlers[event]) {
      await handlers[event](...args);
    }
  };

  return { watcher, emit };
}

/**
 * Create a mock chokidar.watch function
 * @param {Object} mockWatcher - The mock watcher to return
 * @returns {Function} Mock watch function
 */
function createMockChokidarWatch(mockWatcher) {
  return mock.fn((_paths, _opts) => mockWatcher);
}

/**
 * Create a mock orchestrator
 * @param {Object} [options] - Options
 * @param {Object} [options.reloadResult] - Result from reload()
 * @param {Error} [options.reloadError] - Error to throw from reload()
 * @returns {Object} Mock orchestrator
 */
function createMockOrchestrator(options = {}) {
  const { reloadResult = { reloaded: ['bot-1'], failed: [] }, reloadError } = options;

  return {
    reload: mock.fn(async () => {
      if (reloadError) throw reloadError;
      return reloadResult;
    }),
  };
}

/**
 * Collect log messages
 * @returns {{ logger: Function, messages: string[] }}
 */
function createLogger() {
  const messages = [];
  const logger = msg => messages.push(msg);
  return { logger, messages };
}

// ============================================================================
// Tests
// ============================================================================

describe('ConfigWatcher', () => {
  let orchestrator;
  let logCapture;

  beforeEach(() => {
    orchestrator = createMockOrchestrator();
    logCapture = createLogger();
  });

  describe('constructor', () => {
    test('creates instance with orchestrator', () => {
      const watcher = new ConfigWatcher(orchestrator);
      assert.ok(watcher);
      assert.equal(watcher.orchestrator, orchestrator);
    });

    test('throws ConfigWatcherError without orchestrator', () => {
      assert.throws(
        () => new ConfigWatcher(null),
        err => {
          assert.ok(err instanceof ConfigWatcherError);
          assert.ok(err.message.includes('Orchestrator is required'));
          return true;
        }
      );
    });

    test('accepts custom logger', () => {
      const { logger } = createLogger();
      const watcher = new ConfigWatcher(orchestrator, { logger });
      assert.equal(watcher.logger, logger);
    });

    test('accepts custom stability threshold and poll interval', () => {
      const watcher = new ConfigWatcher(orchestrator, {
        stabilityThreshold: 500,
        pollInterval: 200,
      });
      assert.equal(watcher.stabilityThreshold, 500);
      assert.equal(watcher.pollInterval, 200);
    });

    test('uses default stability threshold of 300ms', () => {
      const watcher = new ConfigWatcher(orchestrator);
      assert.equal(watcher.stabilityThreshold, 300);
    });

    test('uses default poll interval of 100ms', () => {
      const watcher = new ConfigWatcher(orchestrator);
      assert.equal(watcher.pollInterval, 100);
    });
  });

  describe('watch()', () => {
    test('starts watching provided paths', async () => {
      const { watcher: mockWatcher } = createMockWatcher();
      const mockWatch = createMockChokidarWatch(mockWatcher);

      const cw = new ConfigWatcher(orchestrator, {
        logger: logCapture.logger,
        chokidarWatch: mockWatch,
      });

      const paths = ['./config.json', './bots/**/*.json', './bots/**/*.md'];
      await cw.watch(paths);

      assert.equal(mockWatch.mock.calls.length, 1);
      const [calledPaths, calledOpts] = mockWatch.mock.calls[0].arguments;
      assert.deepEqual(calledPaths, paths);
      assert.equal(calledOpts.persistent, true);
      assert.equal(calledOpts.ignoreInitial, true);
      assert.equal(calledOpts.awaitWriteFinish.stabilityThreshold, 300);
      assert.equal(calledOpts.awaitWriteFinish.pollInterval, 100);

      await cw.stop();
    });

    test('throws if already watching', async () => {
      const { watcher: mockWatcher } = createMockWatcher();
      const mockWatch = createMockChokidarWatch(mockWatcher);

      const cw = new ConfigWatcher(orchestrator, {
        logger: logCapture.logger,
        chokidarWatch: mockWatch,
      });

      await cw.watch(['./config.json']);

      await assert.rejects(
        () => cw.watch(['./config.json']),
        err => {
          assert.ok(err instanceof ConfigWatcherError);
          assert.ok(err.message.includes('Already watching'));
          return true;
        }
      );

      await cw.stop();
    });

    test('throws if paths is empty', async () => {
      const cw = new ConfigWatcher(orchestrator, {
        logger: logCapture.logger,
      });

      await assert.rejects(
        () => cw.watch([]),
        err => {
          assert.ok(err instanceof ConfigWatcherError);
          assert.ok(err.message.includes('non-empty array'));
          return true;
        }
      );
    });

    test('throws if paths is not an array', async () => {
      const cw = new ConfigWatcher(orchestrator, {
        logger: logCapture.logger,
      });

      await assert.rejects(
        () => cw.watch('./config.json'),
        err => {
          assert.ok(err instanceof ConfigWatcherError);
          assert.ok(err.message.includes('non-empty array'));
          return true;
        }
      );
    });
  });

  describe('file change detection', () => {
    test('detects file changes and triggers reload', async () => {
      const { watcher: mockWatcher, emit } = createMockWatcher();
      const mockWatch = createMockChokidarWatch(mockWatcher);

      const cw = new ConfigWatcher(orchestrator, {
        logger: logCapture.logger,
        chokidarWatch: mockWatch,
      });

      await cw.watch(['./config.json']);

      // Simulate file change
      await emit('change', './config.json');

      assert.equal(orchestrator.reload.mock.calls.length, 1);
      assert.ok(logCapture.messages.some(m => m.includes('Config changed: ./config.json')));
      assert.ok(logCapture.messages.some(m => m.includes('Config reloaded')));

      await cw.stop();
    });

    test('detects file additions and triggers reload', async () => {
      const { watcher: mockWatcher, emit } = createMockWatcher();
      const mockWatch = createMockChokidarWatch(mockWatcher);

      const cw = new ConfigWatcher(orchestrator, {
        logger: logCapture.logger,
        chokidarWatch: mockWatch,
      });

      await cw.watch(['./bots/**/*.json']);

      // Simulate file addition
      await emit('add', './bots/new-bot/config.json');

      assert.equal(orchestrator.reload.mock.calls.length, 1);
      assert.ok(
        logCapture.messages.some(m => m.includes('Config changed: ./bots/new-bot/config.json'))
      );

      await cw.stop();
    });

    test('logs emoji status for changes', async () => {
      const { watcher: mockWatcher, emit } = createMockWatcher();
      const mockWatch = createMockChokidarWatch(mockWatcher);

      const cw = new ConfigWatcher(orchestrator, {
        logger: logCapture.logger,
        chokidarWatch: mockWatch,
      });

      await cw.watch(['./config.json']);
      await emit('change', './config.json');

      // Check emoji status messages
      assert.ok(logCapture.messages.some(m => m.startsWith('\u{1F4DD}')));
      assert.ok(logCapture.messages.some(m => m.startsWith('\u2705')));

      await cw.stop();
    });
  });

  describe('validateAndReload()', () => {
    test('returns success when orchestrator reload succeeds', async () => {
      const orch = createMockOrchestrator({
        reloadResult: { reloaded: ['bot-1', 'bot-2'], failed: [] },
      });

      const cw = new ConfigWatcher(orch, {
        logger: logCapture.logger,
      });

      const result = await cw.validateAndReload('./config.json');

      assert.equal(result.success, true);
      assert.deepEqual(result.reloaded, ['bot-1', 'bot-2']);
      assert.deepEqual(result.failed, []);
    });

    test('returns failure when orchestrator reload throws', async () => {
      const orch = createMockOrchestrator({
        reloadError: new Error('Reload config validation failed:\nInvalid provider'),
      });

      const cw = new ConfigWatcher(orch, {
        logger: logCapture.logger,
      });

      const result = await cw.validateAndReload('./config.json');

      assert.equal(result.success, false);
      assert.ok(result.errors.length > 0);
      assert.ok(result.errors[0].includes('validation failed'));
    });

    test('returns failure with error array from orchestrator', async () => {
      const err = new Error('Validation failed');
      err.errors = ['Missing provider field', 'Invalid model name'];

      const orch = createMockOrchestrator({ reloadError: err });

      const cw = new ConfigWatcher(orch, {
        logger: logCapture.logger,
      });

      const result = await cw.validateAndReload('./config.json');

      assert.equal(result.success, false);
      assert.ok(result.errors.some(e => e.includes('Validation failed')));
      assert.ok(result.errors.some(e => e.includes('Missing provider field')));
      assert.ok(result.errors.some(e => e.includes('Invalid model name')));
    });

    test('includes changedPath in failure result', async () => {
      const orch = createMockOrchestrator({
        reloadError: new Error('Bad config'),
      });

      const cw = new ConfigWatcher(orch, {
        logger: logCapture.logger,
      });

      const result = await cw.validateAndReload('./bots/test/config.json');

      assert.equal(result.success, false);
      assert.equal(result.changedPath, './bots/test/config.json');
    });

    test('handles errors with no message gracefully', async () => {
      const err = new Error();
      const orch = createMockOrchestrator({ reloadError: err });

      const cw = new ConfigWatcher(orch, {
        logger: logCapture.logger,
      });

      const result = await cw.validateAndReload('./config.json');

      assert.equal(result.success, false);
      assert.ok(result.errors.length > 0);
    });
  });

  describe('rejects invalid configs', () => {
    test('logs error details when config is invalid', async () => {
      const orch = createMockOrchestrator({
        reloadError: new Error('Invalid JSON in config.json'),
      });

      const { watcher: mockWatcher, emit } = createMockWatcher();
      const mockWatch = createMockChokidarWatch(mockWatcher);

      const cw = new ConfigWatcher(orch, {
        logger: logCapture.logger,
        chokidarWatch: mockWatch,
      });

      await cw.watch(['./config.json']);
      await emit('change', './config.json');

      assert.ok(logCapture.messages.some(m => m.includes('\u274C')));
      assert.ok(logCapture.messages.some(m => m.includes('Invalid JSON')));

      await cw.stop();
    });

    test('does not crash on repeated invalid configs', async () => {
      const orch = createMockOrchestrator({
        reloadError: new Error('Bad config'),
      });

      const { watcher: mockWatcher, emit } = createMockWatcher();
      const mockWatch = createMockChokidarWatch(mockWatcher);

      const cw = new ConfigWatcher(orch, {
        logger: logCapture.logger,
        chokidarWatch: mockWatch,
      });

      await cw.watch(['./config.json']);

      // Multiple invalid changes - should not crash
      await emit('change', './config.json');
      await emit('change', './config.json');
      await emit('change', './config.json');

      const errorMessages = logCapture.messages.filter(m => m.includes('\u274C'));
      assert.ok(errorMessages.length >= 3);

      await cw.stop();
    });
  });

  describe('reloads valid configs', () => {
    test('calls orchestrator.reload() on valid config change', async () => {
      const orch = createMockOrchestrator({
        reloadResult: { reloaded: ['support-bot'], failed: [] },
      });

      const { watcher: mockWatcher, emit } = createMockWatcher();
      const mockWatch = createMockChokidarWatch(mockWatcher);

      const cw = new ConfigWatcher(orch, {
        logger: logCapture.logger,
        chokidarWatch: mockWatch,
      });

      await cw.watch(['./config.json']);
      await emit('change', './config.json');

      assert.equal(orch.reload.mock.calls.length, 1);
      assert.ok(logCapture.messages.some(m => m.includes('\u2705 Config reloaded')));

      await cw.stop();
    });

    test('handles reload with partial failures', async () => {
      const orch = createMockOrchestrator({
        reloadResult: {
          reloaded: ['bot-1'],
          failed: [{ botId: 'bot-2', error: 'Missing soul' }],
        },
      });

      const cw = new ConfigWatcher(orch, {
        logger: logCapture.logger,
      });

      const result = await cw.validateAndReload('./config.json');

      assert.equal(result.success, true);
      assert.deepEqual(result.reloaded, ['bot-1']);
      assert.equal(result.failed.length, 1);
      assert.equal(result.failed[0].botId, 'bot-2');
    });
  });

  describe('stop()', () => {
    test('closes the watcher', async () => {
      const { watcher: mockWatcher } = createMockWatcher();
      const mockWatch = createMockChokidarWatch(mockWatcher);

      const cw = new ConfigWatcher(orchestrator, {
        logger: logCapture.logger,
        chokidarWatch: mockWatch,
      });

      await cw.watch(['./config.json']);
      assert.ok(cw.watcher);

      await cw.stop();

      assert.equal(cw.watcher, null);
      assert.equal(mockWatcher.close.mock.calls.length, 1);
    });

    test('is safe to call multiple times', async () => {
      const { watcher: mockWatcher } = createMockWatcher();
      const mockWatch = createMockChokidarWatch(mockWatcher);

      const cw = new ConfigWatcher(orchestrator, {
        logger: logCapture.logger,
        chokidarWatch: mockWatch,
      });

      await cw.watch(['./config.json']);

      await cw.stop();
      await cw.stop();
      await cw.stop();

      assert.equal(mockWatcher.close.mock.calls.length, 1);
    });

    test('is safe to call without watching', async () => {
      const cw = new ConfigWatcher(orchestrator, {
        logger: logCapture.logger,
      });

      // Should not throw
      await cw.stop();
      assert.equal(cw.watcher, null);
    });

    test('resets reloading flag', async () => {
      const cw = new ConfigWatcher(orchestrator, {
        logger: logCapture.logger,
      });

      cw.reloading = true;
      await cw.stop();
      assert.equal(cw.reloading, false);
    });

    test('allows re-watching after stop', async () => {
      const { watcher: mockWatcher1 } = createMockWatcher();
      const { watcher: mockWatcher2 } = createMockWatcher();
      let callCount = 0;
      const mockWatch = mock.fn((_paths, _opts) => {
        callCount++;
        return callCount === 1 ? mockWatcher1 : mockWatcher2;
      });

      const cw = new ConfigWatcher(orchestrator, {
        logger: logCapture.logger,
        chokidarWatch: mockWatch,
      });

      await cw.watch(['./config.json']);
      await cw.stop();
      await cw.watch(['./config.json']);

      assert.equal(mockWatch.mock.calls.length, 2);
      assert.ok(cw.watcher);

      await cw.stop();
    });
  });

  describe('concurrent reload prevention', () => {
    test('prevents concurrent reloads', async () => {
      let reloadCount = 0;
      let resolveReload;
      const orch = {
        reload: mock.fn(() => {
          reloadCount++;
          return new Promise(resolve => {
            resolveReload = () => resolve({ reloaded: [], failed: [] });
          });
        }),
      };

      const { watcher: mockWatcher, emit } = createMockWatcher();
      const mockWatch = createMockChokidarWatch(mockWatcher);

      const cw = new ConfigWatcher(orch, {
        logger: logCapture.logger,
        chokidarWatch: mockWatch,
      });

      await cw.watch(['./config.json']);

      // Trigger first change (starts async reload)
      const firstReload = emit('change', './config.json');

      // Trigger second change while first is in progress - should be ignored
      await emit('change', './bots/test/config.json');

      // Resolve the first reload
      resolveReload();
      await firstReload;

      assert.equal(reloadCount, 1, 'Only one reload should have been triggered');

      await cw.stop();
    });

    test('allows reload after previous completes', async () => {
      const { watcher: mockWatcher, emit } = createMockWatcher();
      const mockWatch = createMockChokidarWatch(mockWatcher);

      const cw = new ConfigWatcher(orchestrator, {
        logger: logCapture.logger,
        chokidarWatch: mockWatch,
      });

      await cw.watch(['./config.json']);

      // First change
      await emit('change', './config.json');
      // Second change after first completes
      await emit('change', './config.json');

      assert.equal(orchestrator.reload.mock.calls.length, 2);

      await cw.stop();
    });
  });

  describe('ConfigWatcherError', () => {
    test('has correct name', () => {
      const err = new ConfigWatcherError('test');
      assert.equal(err.name, 'ConfigWatcherError');
    });

    test('stores cause', () => {
      const cause = new Error('original');
      const err = new ConfigWatcherError('wrapper', { cause });
      assert.equal(err.cause, cause);
    });

    test('stores changedPath', () => {
      const err = new ConfigWatcherError('test', { changedPath: './config.json' });
      assert.equal(err.changedPath, './config.json');
    });

    test('extends Error', () => {
      const err = new ConfigWatcherError('test');
      assert.ok(err instanceof Error);
    });

    test('has correct message', () => {
      const err = new ConfigWatcherError('Something went wrong');
      assert.equal(err.message, 'Something went wrong');
    });
  });
});
