/**
 * Integration tests for CLI commands (validate, migrate, start, dev)
 *
 * Tests the full command flow with real ConfigLoader, ConfigValidator,
 * and mock infrastructure. Verifies:
 * - validate: loads real configs from temp dirs, validates with Zod
 * - migrate: runs migrations with mock storage/runner
 * - start: starts orchestrator with mock components
 * - dev: starts with file watching using mock watcher
 *
 * Unlike unit tests that mock everything, these tests exercise the real
 * command modules and their interactions with real validators/loaders.
 */

import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

import { runValidate } from '../../../src/cli/ValidateCommand.js';
import { runMigrate, MigrateCommandError } from '../../../src/cli/MigrateCommand.js';
import { runStart } from '../../../src/cli/StartCommand.js';
import { runDev } from '../../../src/cli/DevCommand.js';
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
 * Create a mock process for signal handling
 * @returns {Object} Mock process
 */
function createMockProcess() {
  const handlers = {};
  return {
    on(signal, handler) {
      handlers[signal] = handler;
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
 * Create a temporary directory for test config files
 * @returns {Promise<string>} Path to temp dir
 */
async function createTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ai-army-test-'));
}

/**
 * Write a JSON config file to a path
 * @param {string} filePath - Path to write to
 * @param {Object} config - Config object to write
 */
async function writeConfig(filePath, config) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(config, null, 2));
}

/**
 * Create a mock MigrationRunner
 * @param {Object} [options] - Options
 * @returns {Object} Mock MigrationRunner
 */
function createMockMigrationRunner(options = {}) {
  const { completed = [], error } = options;
  return {
    runMigrations: mock.fn(async () => {
      if (error) throw error;
      return completed;
    }),
    getMigrationStatus: mock.fn(async () => []),
    ensureMigrationsTable: mock.fn(async () => {}),
  };
}

/**
 * Create a mock storage
 * @returns {Object} Mock storage
 */
function createMockStorage() {
  return {
    connected: true,
    isConnected: () => true,
    query: mock.fn(async () => ({ rows: [] })),
    transaction: mock.fn(async fn => fn({ query: mock.fn(async () => ({ rows: [] })) })),
    connect: mock.fn(async () => {}),
    disconnect: mock.fn(async () => {}),
  };
}

/**
 * Create a mock Orchestrator
 * @param {Object} [options] - Options
 * @returns {Object} Mock Orchestrator
 */
function createMockOrchestrator(options = {}) {
  const {
    startError,
    stopError,
    reloadResult = { reloaded: ['bot1'], failed: [] },
    reloadError,
    status = { botCount: 2, channelCount: 1, databaseConnected: true },
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
    getState: mock.fn(() => 'running'),
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
  return { factory: mock.fn(() => watcher), watcher };
}

// ============================================================================
// validate command integration tests
// ============================================================================

describe('validate command - integration with real ConfigLoader/Validator', () => {
  let tempDir;
  let out;

  beforeEach(async () => {
    tempDir = await createTempDir();
    out = createOutputStream();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('validates valid main config with real loader and validator', async () => {
    const config = {
      providers: {
        anthropic: { type: 'anthropic', apiKey: 'test-key' },
      },
      channels: {},
    };
    const configPath = path.join(tempDir, 'config.json');
    await writeConfig(configPath, config);

    const result = await runValidate({
      configPath,
      botsPath: path.join(tempDir, 'bots'),
      output: out,
    });

    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
    assert.ok(out.output().includes('All configurations valid'));
  });

  test('validates valid main config with bot configs', async () => {
    const mainConfig = {
      providers: {
        anthropic: { type: 'anthropic', apiKey: 'test-key' },
      },
      channels: {},
    };
    const botConfig = {
      id: 'test-bot',
      soul: './soul.md',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
    };

    const configPath = path.join(tempDir, 'config.json');
    await writeConfig(configPath, mainConfig);
    await writeConfig(path.join(tempDir, 'bots', 'test-bot', 'config.json'), botConfig);

    const result = await runValidate({
      configPath,
      botsPath: path.join(tempDir, 'bots'),
      output: out,
    });

    assert.equal(result.valid, true);
    const output = out.output();
    assert.ok(output.includes('All configurations valid'));
    assert.ok(output.includes('1 bot config'));
  });

  test('reports invalid bot config with missing required fields', async () => {
    const mainConfig = {
      providers: {
        anthropic: { type: 'anthropic', apiKey: 'test-key' },
      },
      channels: {},
    };
    const invalidBotConfig = {
      id: 'bad-bot',
      // Missing: soul, provider, model (all required)
    };

    const configPath = path.join(tempDir, 'config.json');
    await writeConfig(configPath, mainConfig);
    await writeConfig(path.join(tempDir, 'bots', 'bad-bot', 'config.json'), invalidBotConfig);

    const result = await runValidate({
      configPath,
      botsPath: path.join(tempDir, 'bots'),
      output: out,
    });

    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);
    const output = out.output();
    assert.ok(output.includes('Configuration errors found'));
  });

  test('reports cross-reference errors for invalid provider', async () => {
    const mainConfig = {
      providers: {
        anthropic: { type: 'anthropic', apiKey: 'test-key' },
      },
      channels: {},
    };
    const botConfig = {
      id: 'ref-bot',
      soul: './soul.md',
      provider: 'nonexistent-provider',
      model: 'some-model',
    };

    const configPath = path.join(tempDir, 'config.json');
    await writeConfig(configPath, mainConfig);
    await writeConfig(path.join(tempDir, 'bots', 'ref-bot', 'config.json'), botConfig);

    const result = await runValidate({
      configPath,
      botsPath: path.join(tempDir, 'bots'),
      output: out,
    });

    assert.equal(result.valid, false);
    const output = out.output();
    assert.ok(output.includes('not found'));
  });

  test('handles missing config.json file', async () => {
    const result = await runValidate({
      configPath: path.join(tempDir, 'missing.json'),
      botsPath: path.join(tempDir, 'bots'),
      output: out,
    });

    assert.equal(result.valid, false);
    assert.ok(out.output().includes('Failed to load'));
  });

  test('handles invalid JSON in config file', async () => {
    const configPath = path.join(tempDir, 'config.json');
    await fs.writeFile(configPath, '{invalid json!!!');

    const result = await runValidate({
      configPath,
      botsPath: path.join(tempDir, 'bots'),
      output: out,
    });

    assert.equal(result.valid, false);
    assert.ok(out.output().includes('Failed to load'));
  });

  test('handles empty bots directory', async () => {
    const config = {
      providers: {},
      channels: {},
    };
    const configPath = path.join(tempDir, 'config.json');
    await writeConfig(configPath, config);
    await fs.mkdir(path.join(tempDir, 'bots'), { recursive: true });

    const result = await runValidate({
      configPath,
      botsPath: path.join(tempDir, 'bots'),
      output: out,
    });

    assert.equal(result.valid, true);
  });

  test('handles nonexistent bots directory', async () => {
    const config = {
      providers: {},
      channels: {},
    };
    const configPath = path.join(tempDir, 'config.json');
    await writeConfig(configPath, config);

    const result = await runValidate({
      configPath,
      botsPath: path.join(tempDir, 'no-bots'),
      output: out,
    });

    assert.equal(result.valid, true);
  });

  test('validates multiple bot configs', async () => {
    const mainConfig = {
      providers: {
        anthropic: { type: 'anthropic', apiKey: 'key' },
      },
      channels: {
        'slack-main': { type: 'slack', botToken: 'xoxb-test' },
      },
    };

    const bot1 = {
      id: 'bot-1',
      soul: './soul.md',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      channel: 'slack-main',
    };

    const bot2 = {
      id: 'bot-2',
      soul: './soul.md',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
    };

    const configPath = path.join(tempDir, 'config.json');
    await writeConfig(configPath, mainConfig);
    await writeConfig(path.join(tempDir, 'bots', 'bot-1', 'config.json'), bot1);
    await writeConfig(path.join(tempDir, 'bots', 'bot-2', 'config.json'), bot2);

    const result = await runValidate({
      configPath,
      botsPath: path.join(tempDir, 'bots'),
      output: out,
    });

    assert.equal(result.valid, true);
    assert.ok(out.output().includes('2 bot config'));
  });

  test('skips non-directory entries in bots directory', async () => {
    const config = {
      providers: {},
      channels: {},
    };
    const configPath = path.join(tempDir, 'config.json');
    await writeConfig(configPath, config);

    const botsDir = path.join(tempDir, 'bots');
    await fs.mkdir(botsDir, { recursive: true });
    // Create a regular file (not a directory) in bots/
    await fs.writeFile(path.join(botsDir, 'README.md'), '# Bots');

    const result = await runValidate({
      configPath,
      botsPath: botsDir,
      output: out,
    });

    assert.equal(result.valid, true);
  });
});

// ============================================================================
// migrate command integration tests
// ============================================================================

describe('migrate command - integration with mock storage', () => {
  let out;

  beforeEach(() => {
    out = createOutputStream();
  });

  test('runs migrations with mock runner and reports success', async () => {
    const storage = createMockStorage();
    const runner = createMockMigrationRunner({
      completed: [{ version: 1, name: '001_initial_schema.sql' }],
    });

    const result = await runMigrate({
      storage,
      migrationRunner: runner,
      output: out,
    });

    assert.equal(result.success, true);
    assert.equal(result.migrations.length, 1);
    assert.ok(out.output().includes('001_initial_schema.sql'));
  });

  test('reports no pending migrations', async () => {
    const storage = createMockStorage();
    const runner = createMockMigrationRunner({ completed: [] });

    const result = await runMigrate({
      storage,
      migrationRunner: runner,
      output: out,
    });

    assert.equal(result.success, true);
    assert.ok(out.output().includes('up to date'));
  });

  test('reports multiple completed migrations', async () => {
    const storage = createMockStorage();
    const runner = createMockMigrationRunner({
      completed: [
        { version: 1, name: '001_initial_schema.sql' },
        { version: 2, name: '002_add_indexes.sql' },
        { version: 3, name: '003_add_tool_calls.sql' },
      ],
    });

    const result = await runMigrate({
      storage,
      migrationRunner: runner,
      output: out,
    });

    assert.equal(result.success, true);
    assert.equal(result.migrations.length, 3);
    assert.ok(out.output().includes('Ran 3 migration(s)'));
  });

  test('handles migration failure gracefully', async () => {
    const { MigrationError } = await import('../../../src/database/MigrationRunner.js');
    const storage = createMockStorage();
    const runner = createMockMigrationRunner({
      error: new MigrationError('Migration 2 (002_bad.sql) failed: syntax error', {
        version: 2,
        filename: '002_bad.sql',
      }),
    });

    const result = await runMigrate({
      storage,
      migrationRunner: runner,
      output: out,
    });

    assert.equal(result.success, false);
    assert.ok(out.output().includes('Migration failed'));
    assert.ok(out.output().includes('002_bad.sql'));
  });

  test('throws when storage is missing', async () => {
    await assert.rejects(
      () => runMigrate({ output: out }),
      err => {
        assert.ok(err instanceof MigrateCommandError);
        assert.ok(err.message.includes('storage is required'));
        return true;
      }
    );
  });
});

// ============================================================================
// start command integration tests
// ============================================================================

describe('start command - integration with mock orchestrator', () => {
  let out;
  let proc;

  beforeEach(() => {
    out = createOutputStream();
    proc = createMockProcess();
  });

  test('starts orchestrator and shows running status', async () => {
    const orch = createMockOrchestrator({
      status: { botCount: 3, channelCount: 2, databaseConnected: true },
    });

    const result = await runStart({
      orchestrator: orch,
      output: out,
      processRef: proc,
    });

    assert.ok(result.orchestrator);
    assert.equal(orch.start.mock.calls.length, 1);

    const output = out.output();
    assert.ok(output.includes('production mode'));
    assert.ok(output.includes('AI Army is running'));
    assert.ok(output.includes('Bots: 3'));
    assert.ok(output.includes('Channels: 2'));
    assert.ok(output.includes('Database: connected'));
  });

  test('handles startup failure and shows error', async () => {
    const orch = createMockOrchestrator({
      startError: new OrchestratorError('Config validation failed', {
        component: 'config',
      }),
    });

    await runStart({
      orchestrator: orch,
      output: out,
      processRef: proc,
    });

    const output = out.output();
    assert.ok(output.includes('Startup failed'));
    assert.ok(output.includes('Config validation failed'));
  });

  test('graceful shutdown on SIGINT', async () => {
    const orch = createMockOrchestrator();

    await runStart({
      orchestrator: orch,
      output: out,
      processRef: proc,
    });

    await proc.emit('SIGINT');

    assert.equal(orch.stop.mock.calls.length, 1);
    assert.ok(out.output().includes('Shutdown complete'));
  });

  test('graceful shutdown on SIGTERM', async () => {
    const orch = createMockOrchestrator();

    await runStart({
      orchestrator: orch,
      output: out,
      processRef: proc,
    });

    await proc.emit('SIGTERM');

    assert.equal(orch.stop.mock.calls.length, 1);
    assert.ok(out.output().includes('SIGTERM'));
  });

  test('handles shutdown errors', async () => {
    const orch = createMockOrchestrator({
      stopError: new Error('Shutdown failed for channels'),
    });

    await runStart({
      orchestrator: orch,
      output: out,
      processRef: proc,
    });

    await proc.emit('SIGINT');

    assert.ok(out.output().includes('errors'));
  });

  test('calls onShutdown callback', async () => {
    const orch = createMockOrchestrator();
    let called = false;

    await runStart({
      orchestrator: orch,
      output: out,
      processRef: proc,
      onShutdown: () => {
        called = true;
      },
    });

    await proc.emit('SIGINT');
    assert.ok(called);
  });
});

// ============================================================================
// dev command integration tests
// ============================================================================

describe('dev command - integration with mock orchestrator and watcher', () => {
  let out;
  let proc;

  beforeEach(() => {
    out = createOutputStream();
    proc = createMockProcess();
  });

  test('starts in development mode with file watching', async () => {
    const orch = createMockOrchestrator();
    const { factory } = createMockWatcherFactory();

    const result = await runDev({
      orchestrator: orch,
      watcherFactory: factory,
      output: out,
      processRef: proc,
    });

    assert.ok(result.orchestrator);
    assert.ok(result.watcher);

    const output = out.output();
    assert.ok(output.includes('development mode'));
    assert.ok(output.includes('hot reload'));
    assert.ok(output.includes('Watching config files'));
  });

  test('reloads on file change', async () => {
    const orch = createMockOrchestrator({
      reloadResult: { reloaded: ['bot-1', 'bot-2'], failed: [] },
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

    assert.equal(orch.reload.mock.calls.length, 1);
    const output = out.output();
    assert.ok(output.includes('File changed'));
    assert.ok(output.includes('Reload complete: 2 reloaded'));
  });

  test('handles reload failure', async () => {
    const orch = createMockOrchestrator({
      reloadError: new OrchestratorError('Validation failed'),
    });
    const { factory, watcher } = createMockWatcherFactory();

    await runDev({
      orchestrator: orch,
      watcherFactory: factory,
      output: out,
      processRef: proc,
    });

    await watcher.handlers.change('./config.json');

    assert.ok(out.output().includes('Reload failed'));
  });

  test('closes watcher on shutdown', async () => {
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
  });

  test('handles startup failure in dev mode', async () => {
    const orch = createMockOrchestrator({
      startError: new OrchestratorError('DB connection failed', {
        component: 'database',
      }),
    });
    const { factory } = createMockWatcherFactory();

    const result = await runDev({
      orchestrator: orch,
      watcherFactory: factory,
      output: out,
      processRef: proc,
    });

    assert.equal(result.watcher, null);
    assert.ok(out.output().includes('Startup failed'));
  });

  test('shows reload with failed bots', async () => {
    const orch = createMockOrchestrator({
      reloadResult: { reloaded: ['bot-1'], failed: [{ botId: 'bot-2', error: 'bad config' }] },
    });
    const { factory, watcher } = createMockWatcherFactory();

    await runDev({
      orchestrator: orch,
      watcherFactory: factory,
      output: out,
      processRef: proc,
    });

    await watcher.handlers.change('./config.json');

    const output = out.output();
    assert.ok(output.includes('1 reloaded, 1 failed'));
  });
});

// ============================================================================
// Cross-command integration tests
// ============================================================================

describe('CLI commands - cross-command integration', () => {
  let tempDir;
  let out;

  beforeEach(async () => {
    tempDir = await createTempDir();
    out = createOutputStream();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('validate followed by migrate flow', async () => {
    // First validate
    const config = {
      providers: {
        anthropic: { type: 'anthropic', apiKey: 'key' },
      },
      channels: {},
    };
    const configPath = path.join(tempDir, 'config.json');
    await writeConfig(configPath, config);

    const validateResult = await runValidate({
      configPath,
      botsPath: path.join(tempDir, 'bots'),
      output: out,
    });

    assert.equal(validateResult.valid, true);

    // Then migrate
    const out2 = createOutputStream();
    const storage = createMockStorage();
    const runner = createMockMigrationRunner({
      completed: [{ version: 1, name: '001_initial_schema.sql' }],
    });

    const migrateResult = await runMigrate({
      storage,
      migrationRunner: runner,
      output: out2,
    });

    assert.equal(migrateResult.success, true);
  });

  test('validate failure prevents start', async () => {
    // Validate with invalid config
    const configPath = path.join(tempDir, 'missing.json');

    const validateResult = await runValidate({
      configPath,
      botsPath: path.join(tempDir, 'bots'),
      output: out,
    });

    assert.equal(validateResult.valid, false);
    // In real CLI, exitCode would be set to 1 and start wouldn't run
  });
});
