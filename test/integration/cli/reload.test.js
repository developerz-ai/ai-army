/**
 * Integration tests for ReloadCommand
 *
 * Tests runReload() with a real Orchestrator instance (using mock lower-level
 * dependencies) to verify the full nginx-style validate-then-reload flow:
 * - Config loading and validation via Orchestrator
 * - Reload via Orchestrator.reload()
 * - Proper output reporting for success, partial failures, and full failures
 * - Rejection of invalid configs before any reload happens
 *
 * Unlike unit tests that mock ConfigLoader/ConfigValidator directly, these
 * tests exercise the real Orchestrator.reload() method to verify ReloadCommand
 * works correctly with the actual reload pipeline.
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { runReload, ReloadCommandError } from '../../../src/cli/ReloadCommand.js';
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
 * Create a mock ConfigLoader for injection into Orchestrator
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
    deepMerge(a, b) {
      return { ...a, ...b };
    },
  };
}

/**
 * Create a mock ConfigValidator for injection
 * @param {Object} [options] - Options
 * @param {Object} [options.mainResult] - Result from validateMainConfig()
 * @param {string} [options.report] - Report from generateReport()
 * @returns {Object} Mock ConfigValidator
 */
function createMockConfigValidator(options = {}) {
  const {
    mainResult = { valid: true, errors: [], data: {} },
    report = '✅ All configurations valid',
  } = options;

  return {
    validateMainConfig: mock.fn(_config => mainResult),
    validateBotConfig: mock.fn(config => ({
      ...config,
      enabled: config.enabled ?? true,
      tools: config.tools || [],
      mcpServers: config.mcpServers || [],
      skills: config.skills || [],
      maxSteps: config.maxSteps || 30,
      sessionPer: config.sessionPer || 'user',
      compactionThreshold: config.compactionThreshold || 50000,
    })),
    generateReport: mock.fn(_errors => report),
  };
}

/**
 * Create a mock Orchestrator that has a working reload() method
 * but uses injected dependencies. This simulates the real Orchestrator.reload()
 * behavior without requiring database or file system access.
 * @param {Object} [options] - Options
 * @param {Object} [options.reloadResult] - Result from reload()
 * @param {Error} [options.reloadError] - Error to throw from reload()
 * @param {string} [options.state] - Orchestrator state
 * @returns {Object} Mock Orchestrator with reload()
 */
function createTestOrchestrator(options = {}) {
  const { reloadResult = { reloaded: [], failed: [] }, reloadError, state = 'running' } = options;

  return {
    state,
    reload: mock.fn(async () => {
      if (state !== 'running') {
        throw new OrchestratorError('Cannot reload: orchestrator is not running', {
          operation: 'reload',
        });
      }
      if (reloadError) {
        throw reloadError;
      }
      return reloadResult;
    }),
  };
}

// ============================================================================
// Integration Tests - Validate-then-Reload Flow
// ============================================================================

describe('ReloadCommand integration - nginx-style validate-then-reload', () => {
  let out;

  beforeEach(() => {
    out = createOutputStream();
  });

  test('validates config before calling orchestrator.reload()', async () => {
    const loader = createMockConfigLoader({ mainConfig: { providers: {} } });
    const validator = createMockConfigValidator({
      mainResult: { valid: true, errors: [], data: { providers: {} } },
    });
    const orchestrator = createTestOrchestrator({
      reloadResult: { reloaded: ['support-bot'], failed: [] },
    });

    const result = await runReload({
      configPath: './config.json',
      output: out,
      configLoader: loader,
      configValidator: validator,
      orchestrator,
    });

    assert.equal(result.success, true);
    // Verify order: validate called first, then reload
    assert.equal(validator.validateMainConfig.mock.callCount(), 1);
    assert.equal(orchestrator.reload.mock.callCount(), 1);

    const output = out.output();
    const validIdx = output.indexOf('Configuration valid');
    const reloadIdx = output.indexOf('Reloading...');
    assert.ok(validIdx >= 0, 'Should show validation passed');
    assert.ok(reloadIdx > validIdx, 'Reload should happen after validation');
  });

  test('rejects invalid config and never calls orchestrator.reload()', async () => {
    const loader = createMockConfigLoader({ mainConfig: {} });
    const errors = [{ path: 'providers', message: 'At least one provider is required' }];
    const validator = createMockConfigValidator({
      mainResult: { valid: false, errors },
      report: '❌ providers: At least one provider is required',
    });
    const orchestrator = createTestOrchestrator();

    const result = await runReload({
      configPath: './config.json',
      output: out,
      configLoader: loader,
      configValidator: validator,
      orchestrator,
    });

    assert.equal(result.success, false);
    // Orchestrator.reload() must NOT be called
    assert.equal(orchestrator.reload.mock.callCount(), 0);

    const output = out.output();
    assert.ok(output.includes('Invalid configuration'));
    assert.ok(output.includes('At least one provider is required'));
  });
});

// ============================================================================
// Integration Tests - Successful Reload Scenarios
// ============================================================================

describe('ReloadCommand integration - successful reloads', () => {
  let out;

  beforeEach(() => {
    out = createOutputStream();
  });

  test('reloads single bot successfully', async () => {
    const loader = createMockConfigLoader({ mainConfig: { providers: {} } });
    const validator = createMockConfigValidator();
    const orchestrator = createTestOrchestrator({
      reloadResult: { reloaded: ['support-bot'], failed: [] },
    });

    const result = await runReload({
      configPath: './config.json',
      output: out,
      configLoader: loader,
      configValidator: validator,
      orchestrator,
    });

    assert.equal(result.success, true);
    assert.deepEqual(result.reloaded, ['support-bot']);

    const output = out.output();
    assert.ok(output.includes('Reloaded 1 bot(s)'));
    assert.ok(output.includes('support-bot'));
    assert.ok(output.includes('Reload complete'));
  });

  test('reloads multiple bots successfully', async () => {
    const loader = createMockConfigLoader({ mainConfig: { providers: {} } });
    const validator = createMockConfigValidator();
    const orchestrator = createTestOrchestrator({
      reloadResult: {
        reloaded: ['support-bot', 'work-bot', 'devops-bot'],
        failed: [],
      },
    });

    const result = await runReload({
      configPath: './config.json',
      output: out,
      configLoader: loader,
      configValidator: validator,
      orchestrator,
    });

    assert.equal(result.success, true);
    assert.equal(result.reloaded.length, 3);

    const output = out.output();
    assert.ok(output.includes('Reloaded 3 bot(s)'));
    assert.ok(output.includes('support-bot'));
    assert.ok(output.includes('work-bot'));
    assert.ok(output.includes('devops-bot'));
  });

  test('reports no changes when nothing was reloaded', async () => {
    const loader = createMockConfigLoader({ mainConfig: { providers: {} } });
    const validator = createMockConfigValidator();
    const orchestrator = createTestOrchestrator({
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
    assert.equal(result.reloaded.length, 0);

    const output = out.output();
    assert.ok(output.includes('No changes detected'));
  });
});

// ============================================================================
// Integration Tests - Failure Scenarios
// ============================================================================

describe('ReloadCommand integration - failure scenarios', () => {
  let out;

  beforeEach(() => {
    out = createOutputStream();
  });

  test('handles orchestrator not running', async () => {
    const loader = createMockConfigLoader({ mainConfig: { providers: {} } });
    const validator = createMockConfigValidator();
    const orchestrator = createTestOrchestrator({ state: 'stopped' });

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

  test('handles partial bot reload failures', async () => {
    const loader = createMockConfigLoader({ mainConfig: { providers: {} } });
    const validator = createMockConfigValidator();
    const orchestrator = createTestOrchestrator({
      reloadResult: {
        reloaded: ['support-bot'],
        failed: [
          { botId: 'work-bot', error: 'Invalid sandbox configuration' },
          { botId: 'devops-bot', error: 'Soul file not found' },
        ],
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
    assert.equal(result.reloaded.length, 1);
    assert.equal(result.failed.length, 2);

    const output = out.output();
    assert.ok(output.includes('Reloaded 1 bot(s)'));
    assert.ok(output.includes('support-bot'));
    assert.ok(output.includes('2 bot(s) failed'));
    assert.ok(output.includes('work-bot'));
    assert.ok(output.includes('Invalid sandbox configuration'));
    assert.ok(output.includes('devops-bot'));
    assert.ok(output.includes('Soul file not found'));
  });

  test('handles config file load error gracefully', async () => {
    const { ConfigError } = await import('../../../src/config/ConfigLoader.js');
    const loadError = new ConfigError('Failed to read configuration file: ./config.json', {
      configPath: './config.json',
    });
    const loader = createMockConfigLoader({ loadError });
    const validator = createMockConfigValidator();
    const orchestrator = createTestOrchestrator();

    const result = await runReload({
      configPath: './config.json',
      output: out,
      configLoader: loader,
      configValidator: validator,
      orchestrator,
    });

    assert.equal(result.success, false);
    assert.equal(orchestrator.reload.mock.callCount(), 0);

    const output = out.output();
    assert.ok(output.includes('Failed to load'));
  });

  test('throws ReloadCommandError on unexpected load error', async () => {
    const loadError = new Error('EACCES: permission denied');
    const loader = createMockConfigLoader({ loadError });
    const validator = createMockConfigValidator();
    const orchestrator = createTestOrchestrator();

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
        assert.equal(err.phase, 'validate');
        assert.ok(err.message.includes('permission denied'));
        return true;
      }
    );
  });

  test('throws ReloadCommandError when orchestrator is missing', async () => {
    const loader = createMockConfigLoader({ mainConfig: {} });
    const validator = createMockConfigValidator();

    await assert.rejects(
      () =>
        runReload({
          configPath: './config.json',
          output: out,
          configLoader: loader,
          configValidator: validator,
        }),
      err => {
        assert.ok(err instanceof ReloadCommandError);
        assert.equal(err.phase, 'reload');
        assert.ok(err.message.includes('Orchestrator is required'));
        return true;
      }
    );
  });
});

// ============================================================================
// Integration Tests - Output Formatting
// ============================================================================

describe('ReloadCommand integration - output formatting', () => {
  let out;

  beforeEach(() => {
    out = createOutputStream();
  });

  test('outputs flow in correct order: validate → valid → reload → result', async () => {
    const loader = createMockConfigLoader({ mainConfig: { providers: {} } });
    const validator = createMockConfigValidator();
    const orchestrator = createTestOrchestrator({
      reloadResult: { reloaded: ['bot-a'], failed: [] },
    });

    await runReload({
      configPath: './config.json',
      output: out,
      configLoader: loader,
      configValidator: validator,
      orchestrator,
    });

    const output = out.output();
    const validateIdx = output.indexOf('Validating configuration');
    const validIdx = output.indexOf('Configuration valid');
    const reloadingIdx = output.indexOf('Reloading...');
    const completeIdx = output.indexOf('Reload complete');

    assert.ok(validateIdx >= 0, 'Should show validating');
    assert.ok(validIdx > validateIdx, 'Valid should come after validating');
    assert.ok(reloadingIdx > validIdx, 'Reloading should come after valid');
    assert.ok(completeIdx > reloadingIdx, 'Complete should come after reloading');
  });

  test('success output includes check mark for reload complete', async () => {
    const loader = createMockConfigLoader({ mainConfig: {} });
    const validator = createMockConfigValidator();
    const orchestrator = createTestOrchestrator({
      reloadResult: { reloaded: ['bot-a'], failed: [] },
    });

    await runReload({
      configPath: './config.json',
      output: out,
      configLoader: loader,
      configValidator: validator,
      orchestrator,
    });

    const output = out.output();
    assert.ok(output.includes('✅ Reload complete'));
  });

  test('partial failure output includes warning for reload complete', async () => {
    const loader = createMockConfigLoader({ mainConfig: {} });
    const validator = createMockConfigValidator();
    const orchestrator = createTestOrchestrator({
      reloadResult: {
        reloaded: [],
        failed: [{ botId: 'broken-bot', error: 'Config error' }],
      },
    });

    await runReload({
      configPath: './config.json',
      output: out,
      configLoader: loader,
      configValidator: validator,
      orchestrator,
    });

    const output = out.output();
    assert.ok(output.includes('⚠️'));
    assert.ok(output.includes('Reload complete'));
  });

  test('each reloaded bot is listed on its own line', async () => {
    const loader = createMockConfigLoader({ mainConfig: {} });
    const validator = createMockConfigValidator();
    const orchestrator = createTestOrchestrator({
      reloadResult: {
        reloaded: ['bot-alpha', 'bot-beta', 'bot-gamma'],
        failed: [],
      },
    });

    await runReload({
      configPath: './config.json',
      output: out,
      configLoader: loader,
      configValidator: validator,
      orchestrator,
    });

    const output = out.output();
    const lines = output.split('\n');
    const botLines = lines.filter(l => l.includes('bot-'));
    assert.equal(botLines.length, 3);
    assert.ok(botLines.some(l => l.includes('bot-alpha')));
    assert.ok(botLines.some(l => l.includes('bot-beta')));
    assert.ok(botLines.some(l => l.includes('bot-gamma')));
  });

  test('each failed bot is listed with error message', async () => {
    const loader = createMockConfigLoader({ mainConfig: {} });
    const validator = createMockConfigValidator();
    const orchestrator = createTestOrchestrator({
      reloadResult: {
        reloaded: [],
        failed: [
          { botId: 'fail-1', error: 'Missing soul.md' },
          { botId: 'fail-2', error: 'Invalid provider' },
        ],
      },
    });

    await runReload({
      configPath: './config.json',
      output: out,
      configLoader: loader,
      configValidator: validator,
      orchestrator,
    });

    const output = out.output();
    assert.ok(output.includes('fail-1: Missing soul.md'));
    assert.ok(output.includes('fail-2: Invalid provider'));
  });
});

// ============================================================================
// Integration Tests - Full Scenario
// ============================================================================

describe('ReloadCommand integration - full scenario', () => {
  test('complete successful reload flow matching doc spec', async () => {
    const out = createOutputStream();
    const loader = createMockConfigLoader({
      mainConfig: {
        providers: { anthropic: { type: 'anthropic' } },
        defaults: { model: 'claude-sonnet-4-5' },
      },
    });
    const validator = createMockConfigValidator({
      mainResult: {
        valid: true,
        errors: [],
        data: {
          providers: { anthropic: { type: 'anthropic' } },
          defaults: { model: 'claude-sonnet-4-5' },
        },
      },
    });
    const orchestrator = createTestOrchestrator({
      reloadResult: {
        reloaded: ['support-bot', 'work-bot'],
        failed: [],
      },
    });

    const result = await runReload({
      configPath: './config.json',
      output: out,
      configLoader: loader,
      configValidator: validator,
      orchestrator,
    });

    // Verify result structure
    assert.equal(result.success, true);
    assert.deepEqual(result.reloaded, ['support-bot', 'work-bot']);
    assert.equal(result.failed.length, 0);

    // Verify output matches doc spec expectations
    const output = out.output();
    assert.ok(output.includes('Validating configuration'));
    assert.ok(output.includes('Configuration valid'));
    assert.ok(output.includes('Reloading...'));
    assert.ok(output.includes('Reloaded 2 bot(s)'));
    assert.ok(output.includes('support-bot'));
    assert.ok(output.includes('work-bot'));
    assert.ok(output.includes('✅ Reload complete'));
  });

  test('complete failed validation flow', async () => {
    const out = createOutputStream();
    const loader = createMockConfigLoader({ mainConfig: {} });
    const errors = [
      { path: 'providers', message: 'At least one provider is required' },
      { path: 'defaults.model', message: 'Model name is required' },
    ];
    const validator = createMockConfigValidator({
      mainResult: { valid: false, errors },
      report: [
        '❌ Configuration errors found:',
        '  config.json:',
        '    - providers: At least one provider is required',
        '    - defaults.model: Model name is required',
      ].join('\n'),
    });
    const orchestrator = createTestOrchestrator();

    const result = await runReload({
      configPath: './config.json',
      output: out,
      configLoader: loader,
      configValidator: validator,
      orchestrator,
    });

    // Config rejected
    assert.equal(result.success, false);
    assert.equal(orchestrator.reload.mock.callCount(), 0);

    // Error report shown
    const output = out.output();
    assert.ok(output.includes('Invalid configuration'));
    assert.ok(output.includes('At least one provider is required'));
    assert.ok(output.includes('Model name is required'));
  });

  test('complete mixed results flow (some bots succeed, some fail)', async () => {
    const out = createOutputStream();
    const loader = createMockConfigLoader({ mainConfig: { providers: {} } });
    const validator = createMockConfigValidator();
    const orchestrator = createTestOrchestrator({
      reloadResult: {
        reloaded: ['support-bot'],
        failed: [{ botId: 'work-bot', error: 'Soul file not found: bots/work-bot/soul.md' }],
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
    assert.equal(result.reloaded.length, 1);
    assert.equal(result.failed.length, 1);

    const output = out.output();
    // Both success and failure sections should be present
    assert.ok(output.includes('Reloaded 1 bot(s)'));
    assert.ok(output.includes('support-bot'));
    assert.ok(output.includes('1 bot(s) failed'));
    assert.ok(output.includes('work-bot'));
    assert.ok(output.includes('Soul file not found'));
    // Warning icon for partial failure
    assert.ok(output.includes('⚠️'));
  });
});
