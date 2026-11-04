/**
 * Unit tests for ReloadCommand
 *
 * Tests the runReload() function with mock dependencies:
 * - Mock ConfigLoader, ConfigValidator, and Orchestrator
 * - Verifies validate-then-reload flow (nginx-style)
 * - Tests valid/invalid config scenarios
 * - Tests orchestrator reload success and failure
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { runReload, ReloadCommandError } from './ReloadCommand.js';

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
 * Create a mock ConfigLoader
 * @param {Object} [options] - Options
 * @param {Object} [options.mainConfig] - Config to return from load()
 * @param {Error} [options.loadError] - Error to throw from load()
 * @returns {Object} Mock ConfigLoader
 */
function createMockConfigLoader(options = {}) {
  const { mainConfig = {}, loadError } = options;
  return {
    load: mock.fn(async _configPath => {
      if (loadError) {
        throw loadError;
      }
      return mainConfig;
    }),
  };
}

/**
 * Create a mock ConfigValidator
 * @param {Object} [options] - Options
 * @param {Object} [options.mainResult] - Result from validateMainConfig()
 * @param {string} [options.report] - Report string from generateReport()
 * @returns {Object} Mock ConfigValidator
 */
function createMockConfigValidator(options = {}) {
  const {
    mainResult = { valid: true, errors: [], data: {} },
    report = '✅ All configurations valid',
  } = options;

  return {
    validateMainConfig: mock.fn(_config => mainResult),
    generateReport: mock.fn(_errors => report),
  };
}

/**
 * Create a mock Orchestrator
 * @param {Object} [options] - Options
 * @param {Object} [options.reloadResult] - Result from reload()
 * @param {Error} [options.reloadError] - Error to throw from reload()
 * @returns {Object} Mock Orchestrator
 */
function createMockOrchestrator(options = {}) {
  const { reloadResult = { reloaded: [], failed: [] }, reloadError } = options;

  return {
    reload: mock.fn(async () => {
      if (reloadError) {
        throw reloadError;
      }
      return reloadResult;
    }),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('ReloadCommand - runReload()', () => {
  let out;

  beforeEach(() => {
    out = createOutputStream();
  });

  test('outputs validating message on start', async () => {
    const loader = createMockConfigLoader({ mainConfig: {} });
    const validator = createMockConfigValidator();
    const orchestrator = createMockOrchestrator();

    await runReload({
      configPath: './config.json',
      output: out,
      configLoader: loader,
      configValidator: validator,
      orchestrator,
    });

    const result = out.output();
    assert.ok(result.includes('Validating configuration'));
  });

  test('validates before reloading (nginx-style flow)', async () => {
    const loader = createMockConfigLoader({ mainConfig: { providers: {} } });
    const validator = createMockConfigValidator({
      mainResult: { valid: true, errors: [], data: { providers: {} } },
    });
    const orchestrator = createMockOrchestrator({
      reloadResult: { reloaded: ['bot-a'], failed: [] },
    });

    const result = await runReload({
      configPath: './config.json',
      output: out,
      configLoader: loader,
      configValidator: validator,
      orchestrator,
    });

    assert.equal(result.success, true);
    // Validator must be called before orchestrator
    assert.equal(validator.validateMainConfig.mock.callCount(), 1);
    assert.equal(orchestrator.reload.mock.callCount(), 1);
  });

  test('returns success with reloaded bots', async () => {
    const loader = createMockConfigLoader({ mainConfig: { providers: {} } });
    const validator = createMockConfigValidator();
    const orchestrator = createMockOrchestrator({
      reloadResult: { reloaded: ['support-bot', 'work-bot'], failed: [] },
    });

    const result = await runReload({
      configPath: './config.json',
      output: out,
      configLoader: loader,
      configValidator: validator,
      orchestrator,
    });

    assert.equal(result.success, true);
    assert.deepEqual(result.reloaded, ['support-bot', 'work-bot']);
    assert.equal(result.failed.length, 0);

    const output = out.output();
    assert.ok(output.includes('Reloaded 2 bot(s)'));
    assert.ok(output.includes('support-bot'));
    assert.ok(output.includes('work-bot'));
    assert.ok(output.includes('Reload complete'));
  });

  test('rejects invalid configs without calling orchestrator.reload()', async () => {
    const loader = createMockConfigLoader({ mainConfig: {} });
    const errors = [{ path: 'providers', message: 'At least one provider is required' }];
    const validator = createMockConfigValidator({
      mainResult: { valid: false, errors },
      report: '❌ providers: At least one provider is required',
    });
    const orchestrator = createMockOrchestrator();

    const result = await runReload({
      configPath: './config.json',
      output: out,
      configLoader: loader,
      configValidator: validator,
      orchestrator,
    });

    assert.equal(result.success, false);
    assert.ok(result.failed.length > 0);
    // Orchestrator should NOT be called when validation fails
    assert.equal(orchestrator.reload.mock.callCount(), 0);

    const output = out.output();
    assert.ok(output.includes('Invalid configuration'));
  });

  test('handles config file not found', async () => {
    const { ConfigError } = await import('../config/ConfigLoader.js');
    const loadError = new ConfigError('Failed to read configuration file: ./missing.json', {
      configPath: './missing.json',
    });
    const loader = createMockConfigLoader({ loadError });
    const validator = createMockConfigValidator();
    const orchestrator = createMockOrchestrator();

    const result = await runReload({
      configPath: './missing.json',
      output: out,
      configLoader: loader,
      configValidator: validator,
      orchestrator,
    });

    assert.equal(result.success, false);
    assert.ok(out.output().includes('Failed to load'));
    // Orchestrator should NOT be called
    assert.equal(orchestrator.reload.mock.callCount(), 0);
  });

  test('non-ConfigError throws ReloadCommandError', async () => {
    const loadError = new TypeError('Unexpected error');
    const loader = createMockConfigLoader({ loadError });
    const validator = createMockConfigValidator();
    const orchestrator = createMockOrchestrator();

    await assert.rejects(
      () =>
        runReload({
          configPath: './config.json',
          output: out,
          configLoader: loader,
          configValidator: validator,
          orchestrator,
        }),
      err => {
        assert.ok(err instanceof ReloadCommandError);
        assert.ok(err.message.includes('Unexpected error'));
        assert.equal(err.phase, 'validate');
        return true;
      }
    );
  });

  test('returns validate-only result when orchestrator is missing', async () => {
    const loader = createMockConfigLoader({ mainConfig: {} });
    const validator = createMockConfigValidator();

    const result = await runReload({
      configPath: './config.json',
      output: out,
      configLoader: loader,
      configValidator: validator,
      // No orchestrator provided
    });

    assert.equal(result.success, true);
    assert.equal(result.validateOnly, true);
    assert.deepEqual(result.reloaded, []);
    assert.deepEqual(result.failed, []);

    const output = out.output();
    assert.ok(output.includes('validate-only mode'));
    assert.ok(output.includes('ai-army dev'));
  });

  test('handles orchestrator reload failure gracefully', async () => {
    const loader = createMockConfigLoader({ mainConfig: {} });
    const validator = createMockConfigValidator();
    const orchestrator = createMockOrchestrator({
      reloadError: new Error('Cannot reload: orchestrator is not running'),
    });

    const result = await runReload({
      configPath: './config.json',
      output: out,
      configLoader: loader,
      configValidator: validator,
      orchestrator,
    });

    assert.equal(result.success, false);
    const output = out.output();
    assert.ok(output.includes('Reload failed'));
    assert.ok(output.includes('not running'));
  });

  test('reports partial failures (some bots failed)', async () => {
    const loader = createMockConfigLoader({ mainConfig: {} });
    const validator = createMockConfigValidator();
    const orchestrator = createMockOrchestrator({
      reloadResult: {
        reloaded: ['support-bot'],
        failed: [{ botId: 'work-bot', error: 'Invalid sandbox config' }],
      },
    });

    const result = await runReload({
      configPath: './config.json',
      output: out,
      configLoader: loader,
      configValidator: validator,
      orchestrator,
    });

    assert.equal(result.success, false);
    assert.deepEqual(result.reloaded, ['support-bot']);
    assert.equal(result.failed.length, 1);

    const output = out.output();
    assert.ok(output.includes('Reloaded 1 bot(s)'));
    assert.ok(output.includes('support-bot'));
    assert.ok(output.includes('1 bot(s) failed'));
    assert.ok(output.includes('work-bot'));
    assert.ok(output.includes('Invalid sandbox config'));
  });

  test('reports no changes when nothing reloaded or failed', async () => {
    const loader = createMockConfigLoader({ mainConfig: {} });
    const validator = createMockConfigValidator();
    const orchestrator = createMockOrchestrator({
      reloadResult: { reloaded: [], failed: [] },
    });

    const result = await runReload({
      configPath: './config.json',
      output: out,
      configLoader: loader,
      configValidator: validator,
      orchestrator,
    });

    assert.equal(result.success, true);
    const output = out.output();
    assert.ok(output.includes('No changes detected'));
  });

  test('uses default options when called with minimal args', async () => {
    const loader = createMockConfigLoader({ mainConfig: {} });
    const validator = createMockConfigValidator();
    const orchestrator = createMockOrchestrator();

    const result = await runReload({
      output: out,
      configLoader: loader,
      configValidator: validator,
      orchestrator,
    });

    assert.ok(result.success !== undefined);
  });

  test('outputs Configuration valid before reloading', async () => {
    const loader = createMockConfigLoader({ mainConfig: {} });
    const validator = createMockConfigValidator();
    const orchestrator = createMockOrchestrator();

    await runReload({
      configPath: './config.json',
      output: out,
      configLoader: loader,
      configValidator: validator,
      orchestrator,
    });

    const output = out.output();
    const validIdx = output.indexOf('Configuration valid');
    const reloadIdx = output.indexOf('Reloading...');
    assert.ok(validIdx >= 0, 'Should output "Configuration valid"');
    assert.ok(reloadIdx > validIdx, 'Reload should come after validation');
  });
});

describe('ReloadCommand - ReloadCommandError', () => {
  test('has correct name', () => {
    const err = new ReloadCommandError('test');
    assert.equal(err.name, 'ReloadCommandError');
  });

  test('stores configPath property', () => {
    const err = new ReloadCommandError('test', { configPath: './config.json' });
    assert.equal(err.configPath, './config.json');
  });

  test('stores phase property', () => {
    const err = new ReloadCommandError('test', { phase: 'validate' });
    assert.equal(err.phase, 'validate');
  });

  test('stores cause', () => {
    const cause = new Error('original');
    const err = new ReloadCommandError('wrapper', { cause });
    assert.equal(err.cause, cause);
  });

  test('extends Error', () => {
    const err = new ReloadCommandError('test');
    assert.ok(err instanceof Error);
  });
});
