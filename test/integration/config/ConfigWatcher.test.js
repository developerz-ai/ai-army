/**
 * Integration tests for ConfigWatcher
 *
 * Tests ConfigWatcher with real filesystem operations using chokidar:
 * - Real file change detection (no mock watcher)
 * - Validation before reload with real config files
 * - Stop/cleanup lifecycle with real watchers
 * - Concurrent change handling with real file writes
 *
 * Uses temporary directories for isolation and cleanup.
 *
 * Run with: npm run test:integration
 */

import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { ConfigWatcher, ConfigWatcherError } from '../../../src/config/ConfigWatcher.js';

// ============================================================================
// Test Helpers
// ============================================================================

/** Track temp directories for cleanup */
const tempDirs = [];

/**
 * Create a temporary directory with initial config files
 * @param {Object} [options] - Options
 * @param {Object} [options.config] - Initial config.json contents
 * @param {Object} [options.bots] - Map of botId → config contents
 * @returns {Promise<string>} Path to temp directory
 */
async function createTempWatchDir(options = {}) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-integ-'));
  tempDirs.push(tmpDir);

  const config = options.config || {
    defaults: {
      model: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
      sandbox: { type: 'docker', image: 'node:22-slim' },
    },
    providers: {
      anthropic: { type: 'anthropic', apiKey: 'test-key' },
    },
    channels: {},
    mcpServers: {},
  };

  await fs.writeFile(path.join(tmpDir, 'config.json'), JSON.stringify(config, null, 2), 'utf8');

  const botsDir = path.join(tmpDir, 'bots');
  await fs.mkdir(botsDir, { recursive: true });

  if (options.bots) {
    for (const [botId, botConfig] of Object.entries(options.bots)) {
      const botDir = path.join(botsDir, botId);
      await fs.mkdir(botDir, { recursive: true });
      await fs.writeFile(
        path.join(botDir, 'config.json'),
        JSON.stringify(botConfig, null, 2),
        'utf8'
      );
      await fs.writeFile(path.join(botDir, 'soul.md'), `# ${botId}\nYou are ${botId}.`, 'utf8');
    }
  }

  return tmpDir;
}

/**
 * Wait for a condition to become true (polling)
 * @param {Function} condition - Function that returns true when condition is met
 * @param {number} [timeout=5000] - Max wait time in ms
 * @param {number} [interval=50] - Poll interval in ms
 * @returns {Promise<void>}
 */
async function waitFor(condition, timeout = 5000, interval = 50) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (condition()) return;
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error(`waitFor timed out after ${timeout}ms`);
}

/**
 * Create a mock orchestrator that tracks reload calls
 * @param {Object} [options] - Options
 * @param {Function} [options.reloadFn] - Custom reload implementation
 * @returns {Object} Mock orchestrator with call tracking
 */
function createTrackingOrchestrator(options = {}) {
  const calls = [];
  const errors = [];

  return {
    calls,
    errors,
    reload: async () => {
      const call = { timestamp: Date.now() };
      calls.push(call);

      if (options.reloadFn) {
        return options.reloadFn(call);
      }

      return { reloaded: ['bot-1'], failed: [] };
    },
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
// Integration Tests
// ============================================================================

describe('ConfigWatcher Integration - Real File System', () => {
  after(async () => {
    for (const dir of tempDirs) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    tempDirs.length = 0;
  });

  // ==========================================================================
  // File Change Detection (real chokidar watching)
  // ==========================================================================

  describe('file change detection with real chokidar', () => {
    test('detects config.json change on disk', async () => {
      const tmpDir = await createTempWatchDir();
      const orchestrator = createTrackingOrchestrator();
      const { logger, messages } = createLogger();

      const watcher = new ConfigWatcher(orchestrator, {
        logger,
        stabilityThreshold: 100,
        pollInterval: 50,
      });

      const configPath = path.join(tmpDir, 'config.json');
      await watcher.watch([configPath]);

      // Write a change to trigger the watcher
      const newConfig = {
        defaults: {
          model: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
          sandbox: { type: 'docker', image: 'node:22-slim' },
        },
        providers: {
          anthropic: { type: 'anthropic', apiKey: 'updated-key' },
        },
        channels: {},
        mcpServers: {},
      };

      await fs.writeFile(configPath, JSON.stringify(newConfig, null, 2), 'utf8');

      // Wait for chokidar to detect the change and reload to complete
      await waitFor(() => orchestrator.calls.length >= 1, 8000);

      assert.ok(orchestrator.calls.length >= 1, 'reload() should have been called');
      assert.ok(
        messages.some(m => m.includes('Config changed')),
        'Should log config change'
      );
      assert.ok(
        messages.some(m => m.includes('Config reloaded')),
        'Should log successful reload'
      );

      await watcher.stop();
    });

    test('detects new bot config file added', async () => {
      const tmpDir = await createTempWatchDir();
      const orchestrator = createTrackingOrchestrator();
      const { logger } = createLogger();

      const watcher = new ConfigWatcher(orchestrator, {
        logger,
        stabilityThreshold: 100,
        pollInterval: 50,
      });

      const botsGlob = path.join(tmpDir, 'bots', '**', '*.json');
      await watcher.watch([botsGlob]);

      // Add a new bot config file
      const newBotDir = path.join(tmpDir, 'bots', 'new-bot');
      await fs.mkdir(newBotDir, { recursive: true });
      await fs.writeFile(
        path.join(newBotDir, 'config.json'),
        JSON.stringify({ id: 'new-bot', provider: 'anthropic' }, null, 2),
        'utf8'
      );

      await waitFor(() => orchestrator.calls.length >= 1, 8000);

      assert.ok(orchestrator.calls.length >= 1, 'reload() should have been called for new file');

      await watcher.stop();
    });

    test('detects soul.md file changes', async () => {
      const tmpDir = await createTempWatchDir({
        bots: {
          'test-bot': { id: 'test-bot', provider: 'anthropic' },
        },
      });
      const orchestrator = createTrackingOrchestrator();
      const { logger } = createLogger();

      const watcher = new ConfigWatcher(orchestrator, {
        logger,
        stabilityThreshold: 100,
        pollInterval: 50,
      });

      const mdGlob = path.join(tmpDir, 'bots', '**', '*.md');
      await watcher.watch([mdGlob]);

      // Modify the soul.md file
      const soulPath = path.join(tmpDir, 'bots', 'test-bot', 'soul.md');
      await fs.writeFile(soulPath, '# Updated Bot\nYou are now different.', 'utf8');

      await waitFor(() => orchestrator.calls.length >= 1, 8000);

      assert.ok(orchestrator.calls.length >= 1, 'reload() should trigger on soul.md change');

      await watcher.stop();
    });

    test('watches multiple path patterns simultaneously', async () => {
      const tmpDir = await createTempWatchDir({
        bots: {
          'multi-bot': { id: 'multi-bot', provider: 'anthropic' },
        },
      });
      const orchestrator = createTrackingOrchestrator();
      const { logger } = createLogger();

      const watcher = new ConfigWatcher(orchestrator, {
        logger,
        stabilityThreshold: 100,
        pollInterval: 50,
      });

      const paths = [
        path.join(tmpDir, 'config.json'),
        path.join(tmpDir, 'bots', '**', '*.json'),
        path.join(tmpDir, 'bots', '**', '*.md'),
      ];

      await watcher.watch(paths);

      // Change the main config
      const configPath = path.join(tmpDir, 'config.json');
      const current = JSON.parse(await fs.readFile(configPath, 'utf8'));
      current.providers.anthropic.apiKey = 'multi-test-key';
      await fs.writeFile(configPath, JSON.stringify(current, null, 2), 'utf8');

      await waitFor(() => orchestrator.calls.length >= 1, 8000);

      assert.ok(orchestrator.calls.length >= 1, 'Should detect changes across multiple patterns');

      await watcher.stop();
    });
  });

  // ==========================================================================
  // Validation Before Reload
  // ==========================================================================

  describe('validation before reload', () => {
    test('successful reload returns success result', async () => {
      const orchestrator = createTrackingOrchestrator({
        reloadFn: () => ({ reloaded: ['bot-a', 'bot-b'], failed: [] }),
      });
      const { logger } = createLogger();

      const watcher = new ConfigWatcher(orchestrator, { logger });
      const result = await watcher.validateAndReload('./config.json');

      assert.equal(result.success, true);
      assert.deepEqual(result.reloaded, ['bot-a', 'bot-b']);
      assert.deepEqual(result.failed, []);
    });

    test('failed validation returns errors without crashing', async () => {
      const orchestrator = createTrackingOrchestrator({
        reloadFn: () => {
          const err = new Error('Config validation failed');
          err.errors = ['Missing required field: providers', 'Invalid model name'];
          throw err;
        },
      });
      const { logger } = createLogger();

      const watcher = new ConfigWatcher(orchestrator, { logger });
      const result = await watcher.validateAndReload('./config.json');

      assert.equal(result.success, false);
      assert.ok(result.errors.length >= 1);
      assert.ok(result.errors.some(e => e.includes('validation failed')));
      assert.ok(result.errors.some(e => e.includes('Missing required field')));
      assert.ok(result.errors.some(e => e.includes('Invalid model name')));
    });

    test('invalid config keeps old config (nginx-style)', async () => {
      const tmpDir = await createTempWatchDir();
      let shouldFail = true;
      const orchestrator = createTrackingOrchestrator({
        reloadFn: () => {
          if (shouldFail) {
            throw new Error('Invalid JSON in config.json');
          }
          return { reloaded: ['bot-1'], failed: [] };
        },
      });
      const { logger, messages } = createLogger();

      const watcher = new ConfigWatcher(orchestrator, {
        logger,
        stabilityThreshold: 100,
        pollInterval: 50,
      });

      const configPath = path.join(tmpDir, 'config.json');
      await watcher.watch([configPath]);

      // Write config that triggers orchestrator error - should not crash
      await fs.writeFile(configPath, '{ "attempt": "invalid" }', 'utf8');

      await waitFor(() => orchestrator.calls.length >= 1, 8000);

      assert.ok(
        messages.some(m => m.includes('❌')),
        'Should log rejection with ❌ emoji'
      );
      assert.ok(
        messages.some(m => m.includes('Invalid JSON')),
        'Should log the validation error'
      );

      // Now write valid config - should succeed
      shouldFail = false;
      const validConfig = {
        defaults: { model: { provider: 'anthropic', model: 'claude-sonnet-4-5' } },
        providers: { anthropic: { type: 'anthropic', apiKey: 'key' } },
      };
      await fs.writeFile(configPath, JSON.stringify(validConfig, null, 2), 'utf8');

      await waitFor(() => orchestrator.calls.length >= 2, 8000);

      assert.ok(
        messages.some(m => m.includes('✅ Config reloaded')),
        'Should log successful reload after valid config'
      );

      await watcher.stop();
    });

    test('partial bot failure is reported in reload result', async () => {
      const orchestrator = createTrackingOrchestrator({
        reloadFn: () => ({
          reloaded: ['good-bot'],
          failed: [{ botId: 'bad-bot', error: 'Soul file not found' }],
        }),
      });
      const { logger } = createLogger();

      const watcher = new ConfigWatcher(orchestrator, { logger });
      const result = await watcher.validateAndReload('./config.json');

      assert.equal(result.success, true);
      assert.deepEqual(result.reloaded, ['good-bot']);
      assert.equal(result.failed.length, 1);
      assert.equal(result.failed[0].botId, 'bad-bot');
      assert.ok(result.failed[0].error.includes('Soul file not found'));
    });

    test('unknown errors produce fallback message', async () => {
      const orchestrator = createTrackingOrchestrator({
        reloadFn: () => {
          // Error with empty message and no errors array
          const err = new Error();
          throw err;
        },
      });
      const { logger } = createLogger();

      const watcher = new ConfigWatcher(orchestrator, { logger });
      const result = await watcher.validateAndReload('./config.json');

      assert.equal(result.success, false);
      assert.ok(result.errors.length > 0, 'Should have at least one error');
    });
  });

  // ==========================================================================
  // Stop and Cleanup
  // ==========================================================================

  describe('stop and cleanup', () => {
    test('stop closes real chokidar watcher', async () => {
      const tmpDir = await createTempWatchDir();
      const orchestrator = createTrackingOrchestrator();
      const { logger } = createLogger();

      const watcher = new ConfigWatcher(orchestrator, {
        logger,
        stabilityThreshold: 100,
        pollInterval: 50,
      });

      const configPath = path.join(tmpDir, 'config.json');
      await watcher.watch([configPath]);

      assert.ok(watcher.watcher, 'Watcher should be active');

      await watcher.stop();

      assert.equal(watcher.watcher, null, 'Watcher should be null after stop');
      assert.equal(watcher.reloading, false, 'Reloading flag should be reset');
    });

    test('no events fire after stop', async () => {
      const tmpDir = await createTempWatchDir();
      const orchestrator = createTrackingOrchestrator();
      const { logger } = createLogger();

      const watcher = new ConfigWatcher(orchestrator, {
        logger,
        stabilityThreshold: 100,
        pollInterval: 50,
      });

      const configPath = path.join(tmpDir, 'config.json');
      await watcher.watch([configPath]);
      await watcher.stop();

      // Write to config after stop - should NOT trigger reload
      const newConfig = { providers: { test: { type: 'anthropic', apiKey: 'x' } } };
      await fs.writeFile(configPath, JSON.stringify(newConfig, null, 2), 'utf8');

      // Wait a bit to ensure no event fires
      await new Promise(r => setTimeout(r, 500));

      assert.equal(orchestrator.calls.length, 0, 'No reload should fire after stop');
    });

    test('can re-watch after stop', async () => {
      const tmpDir = await createTempWatchDir();
      const orchestrator = createTrackingOrchestrator();
      const { logger } = createLogger();

      const watcher = new ConfigWatcher(orchestrator, {
        logger,
        stabilityThreshold: 100,
        pollInterval: 50,
      });

      const configPath = path.join(tmpDir, 'config.json');

      // First watch/stop cycle
      await watcher.watch([configPath]);
      await watcher.stop();

      // Second watch cycle - should work
      await watcher.watch([configPath]);
      assert.ok(watcher.watcher, 'Watcher should be active after re-watch');

      // Trigger a change to verify it works
      const current = JSON.parse(await fs.readFile(configPath, 'utf8'));
      current.providers.anthropic.apiKey = 're-watch-key';
      await fs.writeFile(configPath, JSON.stringify(current, null, 2), 'utf8');

      await waitFor(() => orchestrator.calls.length >= 1, 8000);

      assert.ok(orchestrator.calls.length >= 1, 'Should detect changes after re-watch');

      await watcher.stop();
    });

    test('stop is idempotent', async () => {
      const tmpDir = await createTempWatchDir();
      const orchestrator = createTrackingOrchestrator();
      const { logger } = createLogger();

      const watcher = new ConfigWatcher(orchestrator, {
        logger,
        stabilityThreshold: 100,
        pollInterval: 50,
      });

      const configPath = path.join(tmpDir, 'config.json');
      await watcher.watch([configPath]);

      // Multiple stops should not throw
      await watcher.stop();
      await watcher.stop();
      await watcher.stop();

      assert.equal(watcher.watcher, null);
    });
  });

  // ==========================================================================
  // Concurrent Reload Prevention (real file writes)
  // ==========================================================================

  describe('concurrent reload prevention with coalescing', () => {
    test('coalesces changes during reload and triggers follow-up reload', async () => {
      const tmpDir = await createTempWatchDir();
      const resolvers = [];
      let reloadCallCount = 0;

      const orchestrator = {
        reload: () => {
          reloadCallCount++;
          return new Promise(resolve => {
            resolvers.push(() => resolve({ reloaded: ['bot-1'], failed: [] }));
          });
        },
      };

      const { logger } = createLogger();

      const watcher = new ConfigWatcher(orchestrator, {
        logger,
        stabilityThreshold: 100,
        pollInterval: 50,
      });

      const configPath = path.join(tmpDir, 'config.json');
      await watcher.watch([configPath]);

      // Trigger first change
      const config1 = { providers: { a: { type: 'anthropic', apiKey: 'k1' } } };
      await fs.writeFile(configPath, JSON.stringify(config1, null, 2), 'utf8');

      // Wait for the first reload to start
      await waitFor(() => reloadCallCount >= 1, 8000);

      // Write more changes while reload is in progress (should be coalesced)
      const config2 = { providers: { a: { type: 'anthropic', apiKey: 'k2' } } };
      await fs.writeFile(configPath, JSON.stringify(config2, null, 2), 'utf8');

      // Small delay for chokidar to process the second write
      await new Promise(r => setTimeout(r, 300));

      // Only 1 reload should be active so far
      assert.equal(reloadCallCount, 1, 'Only one reload should be active');

      // Resolve the first reload - should trigger coalesced follow-up
      resolvers[0]();

      // Wait for the follow-up reload to start
      await waitFor(() => reloadCallCount >= 2, 5000);

      // Resolve the second reload
      resolvers[1]();

      // Wait for completion
      await new Promise(r => setTimeout(r, 200));

      // Coalescing should trigger exactly one follow-up reload
      assert.equal(reloadCallCount, 2, 'Should trigger one follow-up reload for coalesced changes');

      await watcher.stop();
    });

    test('does not trigger follow-up when no changes during reload', async () => {
      const tmpDir = await createTempWatchDir();
      let resolveReload;
      let reloadCallCount = 0;

      const orchestrator = {
        reload: () => {
          reloadCallCount++;
          return new Promise(resolve => {
            resolveReload = () => resolve({ reloaded: ['bot-1'], failed: [] });
          });
        },
      };

      const { logger } = createLogger();

      const watcher = new ConfigWatcher(orchestrator, {
        logger,
        stabilityThreshold: 100,
        pollInterval: 50,
      });

      const configPath = path.join(tmpDir, 'config.json');
      await watcher.watch([configPath]);

      // Trigger one change
      const config1 = { providers: { a: { type: 'anthropic', apiKey: 'k1' } } };
      await fs.writeFile(configPath, JSON.stringify(config1, null, 2), 'utf8');

      // Wait for the reload to start
      await waitFor(() => reloadCallCount >= 1, 8000);

      // Resolve reload without any pending changes
      resolveReload();

      // Wait to confirm no follow-up
      await new Promise(r => setTimeout(r, 500));

      assert.equal(reloadCallCount, 1, 'Should not trigger follow-up without pending changes');

      await watcher.stop();
    });
  });

  // ==========================================================================
  // Error Resilience
  // ==========================================================================

  describe('error resilience', () => {
    test('survives orchestrator.reload() throwing repeatedly', async () => {
      const tmpDir = await createTempWatchDir();
      let callCount = 0;
      const orchestrator = createTrackingOrchestrator({
        reloadFn: () => {
          callCount++;
          throw new Error(`Reload failure #${callCount}`);
        },
      });
      const { logger, messages } = createLogger();

      const watcher = new ConfigWatcher(orchestrator, {
        logger,
        stabilityThreshold: 100,
        pollInterval: 50,
      });

      const configPath = path.join(tmpDir, 'config.json');
      await watcher.watch([configPath]);

      // First failed write
      await fs.writeFile(configPath, JSON.stringify({ attempt: 1 }, null, 2), 'utf8');

      await waitFor(() => orchestrator.calls.length >= 1, 8000);

      // Verify error was logged (validateAndReload catches and returns {success:false})
      assert.ok(
        messages.some(m => m.includes('Invalid config, keeping old')),
        'Should log invalid config rejection'
      );

      // Wait for stability so chokidar treats next write as a new event
      await new Promise(r => setTimeout(r, 300));

      // Second failed write - watcher should still be alive
      await fs.writeFile(configPath, JSON.stringify({ attempt: 2 }, null, 2), 'utf8');

      await waitFor(() => orchestrator.calls.length >= 2, 8000);

      assert.ok(orchestrator.calls.length >= 2, 'Watcher should survive repeated errors');

      await watcher.stop();
    });

    test('reloading flag resets after error', async () => {
      const tmpDir = await createTempWatchDir();
      const orchestrator = createTrackingOrchestrator({
        reloadFn: () => {
          throw new Error('Temporary failure');
        },
      });
      const { logger } = createLogger();

      const watcher = new ConfigWatcher(orchestrator, {
        logger,
        stabilityThreshold: 100,
        pollInterval: 50,
      });

      const configPath = path.join(tmpDir, 'config.json');
      await watcher.watch([configPath]);

      // Trigger an error
      await fs.writeFile(configPath, JSON.stringify({ trigger: 'error' }, null, 2), 'utf8');

      await waitFor(() => orchestrator.calls.length >= 1, 8000);

      // reloading flag should be reset after the error
      assert.equal(watcher.reloading, false, 'Reloading flag should reset after error');

      await watcher.stop();
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('edge cases', () => {
    test('throws ConfigWatcherError for invalid constructor args', () => {
      assert.throws(
        () => new ConfigWatcher(null),
        err => {
          assert.ok(err instanceof ConfigWatcherError);
          assert.ok(err.message.includes('Orchestrator is required'));
          return true;
        }
      );
    });

    test('watch rejects non-array paths', async () => {
      const orchestrator = createTrackingOrchestrator();
      const watcher = new ConfigWatcher(orchestrator);

      await assert.rejects(
        () => watcher.watch('not-an-array'),
        err => {
          assert.ok(err instanceof ConfigWatcherError);
          assert.ok(err.message.includes('non-empty array'));
          return true;
        }
      );
    });

    test('watch rejects empty array', async () => {
      const orchestrator = createTrackingOrchestrator();
      const watcher = new ConfigWatcher(orchestrator);

      await assert.rejects(
        () => watcher.watch([]),
        err => {
          assert.ok(err instanceof ConfigWatcherError);
          assert.ok(err.message.includes('non-empty array'));
          return true;
        }
      );
    });

    test('double watch throws without stop', async () => {
      const tmpDir = await createTempWatchDir();
      const orchestrator = createTrackingOrchestrator();
      const { logger } = createLogger();

      const watcher = new ConfigWatcher(orchestrator, {
        logger,
        stabilityThreshold: 100,
        pollInterval: 50,
      });

      const configPath = path.join(tmpDir, 'config.json');
      await watcher.watch([configPath]);

      await assert.rejects(
        () => watcher.watch([configPath]),
        err => {
          assert.ok(err instanceof ConfigWatcherError);
          assert.ok(err.message.includes('Already watching'));
          return true;
        }
      );

      await watcher.stop();
    });
  });
});
