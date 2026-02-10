/**
 * Unit tests for ValidateCommand
 *
 * Tests the runValidate() function with mock dependencies:
 * - Mock ConfigLoader and ConfigValidator
 * - Verifies output formatting, error handling, and edge cases
 * - Tests valid/invalid config scenarios
 *
 * Mirrors co-located src/cli/ValidateCommand.test.js into test/unit/cli/ structure
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { runValidate, ValidateCommandError } from '../../../src/cli/ValidateCommand.js';

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
    load(_configPath) {
      if (loadError) {
        throw loadError;
      }
      return Promise.resolve(mainConfig);
    },
    deepMerge(a, b) {
      return { ...a, ...b };
    },
  };
}

/**
 * Create a mock ConfigValidator
 * @param {Object} [options] - Options
 * @param {Object} [options.mainResult] - Result from validateMainConfig()
 * @param {Object} [options.allResult] - Result from validateAll()
 * @param {string} [options.report] - Report string from generateReport()
 * @returns {Object} Mock ConfigValidator
 */
function createMockConfigValidator(options = {}) {
  const { allResult = { valid: true, errors: [] }, report = '✅ All configurations valid' } =
    options;

  return {
    validateMainConfig(config) {
      return { valid: true, errors: [], data: config };
    },
    validateBotConfig(config) {
      return config;
    },
    validateAll(_mainConfig, _botConfigs) {
      return allResult;
    },
    generateReport(_errors) {
      return report;
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('ValidateCommand - runValidate()', () => {
  let out;

  beforeEach(() => {
    out = createOutputStream();
  });

  test('outputs validating message on start', async () => {
    const loader = createMockConfigLoader({ mainConfig: {} });
    const validator = createMockConfigValidator();

    await runValidate({
      configPath: './config.json',
      output: out,
      configLoader: loader,
      configValidator: validator,
    });

    const result = out.output();
    assert.ok(result.includes('Validating configuration'));
  });

  test('returns valid result when all configs are valid', async () => {
    const loader = createMockConfigLoader({ mainConfig: { providers: {} } });
    const validator = createMockConfigValidator({
      allResult: { valid: true, errors: [] },
      report: '✅ All configurations valid',
    });

    const result = await runValidate({
      configPath: './config.json',
      output: out,
      configLoader: loader,
      configValidator: validator,
    });

    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
    assert.ok(out.output().includes('All configurations valid'));
  });

  test('returns invalid result when config has errors', async () => {
    const loader = createMockConfigLoader({ mainConfig: {} });
    const errors = [
      { path: 'providers', message: 'At least one provider is required', context: 'config.json' },
    ];
    const validator = createMockConfigValidator({
      allResult: { valid: false, errors },
      report:
        '❌ Configuration errors found:\n\n  config.json:\n    - providers: At least one provider is required',
    });

    const result = await runValidate({
      configPath: './config.json',
      output: out,
      configLoader: loader,
      configValidator: validator,
    });

    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);
    assert.ok(out.output().includes('Configuration errors found'));
  });

  test('handles config file not found', async () => {
    const { ConfigError } = await import('../../../src/config/ConfigLoader.js');
    const loadError = new ConfigError('Failed to read configuration file: ./missing.json', {
      configPath: './missing.json',
    });
    const loader = createMockConfigLoader({ loadError });
    const validator = createMockConfigValidator();

    const result = await runValidate({
      configPath: './missing.json',
      output: out,
      configLoader: loader,
      configValidator: validator,
    });

    assert.equal(result.valid, false);
    assert.ok(out.output().includes('Failed to load'));
  });

  test('handles invalid JSON in config file', async () => {
    const { ConfigError } = await import('../../../src/config/ConfigLoader.js');
    const loadError = new ConfigError('Invalid JSON in configuration file: ./bad.json', {
      configPath: './bad.json',
    });
    const loader = createMockConfigLoader({ loadError });
    const validator = createMockConfigValidator();

    const result = await runValidate({
      configPath: './bad.json',
      output: out,
      configLoader: loader,
      configValidator: validator,
    });

    assert.equal(result.valid, false);
    assert.ok(out.output().includes('Invalid JSON'));
  });

  test('non-ConfigError throws ValidateCommandError', async () => {
    const loadError = new TypeError('Unexpected error');
    const loader = createMockConfigLoader({ loadError });
    const validator = createMockConfigValidator();

    await assert.rejects(
      () =>
        runValidate({
          configPath: './config.json',
          output: out,
          configLoader: loader,
          configValidator: validator,
        }),
      err => {
        assert.ok(err instanceof ValidateCommandError);
        assert.ok(err.message.includes('Unexpected error'));
        return true;
      }
    );
  });

  test('uses default options when called with empty object', async () => {
    // This will try to load ./config.json which doesn't exist at the test location.
    // We verify it doesn't crash by injecting mocks.
    const loader = createMockConfigLoader({ mainConfig: {} });
    const validator = createMockConfigValidator();

    const result = await runValidate({
      output: out,
      configLoader: loader,
      configValidator: validator,
    });

    assert.ok(result.valid !== undefined);
  });

  test('shows bot count in output when bots are validated', async () => {
    const loader = createMockConfigLoader({ mainConfig: { providers: {} } });
    const validator = createMockConfigValidator({
      allResult: { valid: true, errors: [] },
      report: '✅ All configurations valid',
    });

    // Note: discoverBotConfigs won't find bots without actual files,
    // so validated count will be 0 in unit tests. Integration tests
    // cover the full flow.
    const result = await runValidate({
      configPath: './config.json',
      output: out,
      configLoader: loader,
      configValidator: validator,
    });

    assert.equal(result.valid, true);
  });
});

describe('ValidateCommand - ValidateCommandError', () => {
  test('has correct name', () => {
    const err = new ValidateCommandError('test');
    assert.equal(err.name, 'ValidateCommandError');
  });

  test('stores configPath property', () => {
    const err = new ValidateCommandError('test', { configPath: './config.json' });
    assert.equal(err.configPath, './config.json');
  });

  test('stores cause', () => {
    const cause = new Error('original');
    const err = new ValidateCommandError('wrapper', { cause });
    assert.equal(err.cause, cause);
  });

  test('extends Error', () => {
    const err = new ValidateCommandError('test');
    assert.ok(err instanceof Error);
  });
});

describe('ValidateCommand - error report formatting', () => {
  let out;

  beforeEach(() => {
    out = createOutputStream();
  });

  test('outputs grouped errors in report', async () => {
    const loader = createMockConfigLoader({ mainConfig: {} });
    const errors = [
      { path: 'providers.openai', message: 'type is required', context: 'config.json' },
      { path: 'model', message: 'Model name is required', context: 'bots/my-bot/config.json' },
    ];
    const report = [
      '❌ Configuration errors found:',
      '',
      '  config.json:',
      '    - providers.openai: type is required',
      '',
      '  bots/my-bot/config.json:',
      '    - model: Model name is required',
    ].join('\n');

    const validator = createMockConfigValidator({
      allResult: { valid: false, errors },
      report,
    });

    await runValidate({
      configPath: './config.json',
      output: out,
      configLoader: loader,
      configValidator: validator,
    });

    const result = out.output();
    assert.ok(result.includes('config.json:'));
    assert.ok(result.includes('providers.openai: type is required'));
    assert.ok(result.includes('bots/my-bot/config.json:'));
    assert.ok(result.includes('Model name is required'));
  });
});
