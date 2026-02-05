/**
 * Unit tests for ConfigLoader
 *
 * Tests configuration loading, environment variable interpolation,
 * and deep merging of configuration objects.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { ConfigLoader, ConfigError } from '../../../src/config/ConfigLoader.js';

/**
 * Helper to create a temporary config file
 * @param {Object} config - Configuration object
 * @returns {Promise<string>} - Path to the temp file
 */
async function createTempConfig(config) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'config-test-'));
  const configPath = path.join(tmpDir, 'config.json');
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  return configPath;
}

/**
 * Helper to clean up temp files
 * @param {string} configPath - Path to the config file
 */
async function cleanupTempConfig(configPath) {
  const tmpDir = path.dirname(configPath);
  await fs.rm(tmpDir, { recursive: true, force: true });
}

describe('ConfigLoader', () => {
  let loader;
  let savedEnv;

  beforeEach(() => {
    loader = new ConfigLoader();
    // Save current env vars that might conflict
    savedEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore original env vars
    Object.keys(process.env).forEach(key => {
      if (key.startsWith('TEST_')) {
        delete process.env[key];
      }
    });
    Object.assign(process.env, savedEnv);
  });

  describe('load()', () => {
    test('loads valid JSON configuration file', async () => {
      const config = {
        name: 'test-app',
        version: '1.0.0',
        settings: { debug: true },
      };
      const configPath = await createTempConfig(config);

      try {
        const result = await loader.load(configPath);
        assert.deepEqual(result, config);
      } finally {
        await cleanupTempConfig(configPath);
      }
    });

    test('throws ConfigError for missing file', async () => {
      await assert.rejects(
        () => loader.load('/nonexistent/path/config.json'),
        err => {
          assert.equal(err.name, 'ConfigError');
          assert.match(err.message, /Failed to read configuration file/);
          assert.equal(err.configPath, '/nonexistent/path/config.json');
          return true;
        }
      );
    });

    test('throws ConfigError for invalid JSON', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'config-test-'));
      const configPath = path.join(tmpDir, 'config.json');
      await fs.writeFile(configPath, '{ invalid json }');

      try {
        await assert.rejects(
          () => loader.load(configPath),
          err => {
            assert.equal(err.name, 'ConfigError');
            assert.match(err.message, /Invalid JSON in configuration file/);
            return true;
          }
        );
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    test('interpolates environment variables in loaded config', async () => {
      process.env.TEST_API_KEY = 'sk-test-key-123';

      const config = {
        apiKey: '${TEST_API_KEY}',
        nested: { key: '${TEST_API_KEY}' },
      };
      const configPath = await createTempConfig(config);

      try {
        const result = await loader.load(configPath);
        assert.equal(result.apiKey, 'sk-test-key-123');
        assert.equal(result.nested.key, 'sk-test-key-123');
      } finally {
        await cleanupTempConfig(configPath);
        delete process.env.TEST_API_KEY;
      }
    });
  });

  describe('interpolateEnvVars()', () => {
    test('interpolates required env var ${VAR}', () => {
      process.env.TEST_REQUIRED_VAR = 'required-value';

      const result = loader.interpolateEnvVars({
        key: '${TEST_REQUIRED_VAR}',
      });

      assert.equal(result.key, 'required-value');
    });

    test('throws ConfigError for missing required env var', () => {
      delete process.env.TEST_MISSING_VAR;

      assert.throws(
        () => loader.interpolateEnvVars({ key: '${TEST_MISSING_VAR}' }),
        err => {
          assert.equal(err.name, 'ConfigError');
          assert.match(err.message, /Required environment variable 'TEST_MISSING_VAR' is not set/);
          assert.equal(err.envVar, 'TEST_MISSING_VAR');
          return true;
        }
      );
    });

    test('uses default value with ${VAR:-default} when var not set', () => {
      delete process.env.TEST_OPTIONAL_VAR;

      const result = loader.interpolateEnvVars({
        port: '${TEST_OPTIONAL_VAR:-3000}',
      });

      assert.equal(result.port, '3000');
    });

    test('uses env value with ${VAR:-default} when var is set', () => {
      process.env.TEST_OPTIONAL_VAR = '8080';

      const result = loader.interpolateEnvVars({
        port: '${TEST_OPTIONAL_VAR:-3000}',
      });

      assert.equal(result.port, '8080');
    });

    test('uses default when var is empty string with ${VAR:-default}', () => {
      process.env.TEST_EMPTY_VAR = '';

      const result = loader.interpolateEnvVars({
        value: '${TEST_EMPTY_VAR:-default}',
      });

      assert.equal(result.value, 'default');
    });

    test('uses replacement value with ${VAR:+value} when var is set', () => {
      process.env.TEST_CONDITIONAL_VAR = 'anything';

      const result = loader.interpolateEnvVars({
        flag: '${TEST_CONDITIONAL_VAR:+enabled}',
      });

      assert.equal(result.flag, 'enabled');
    });

    test('returns empty string with ${VAR:+value} when var not set', () => {
      delete process.env.TEST_CONDITIONAL_VAR;

      const result = loader.interpolateEnvVars({
        flag: '${TEST_CONDITIONAL_VAR:+enabled}',
      });

      assert.equal(result.flag, '');
    });

    test('returns empty string with ${VAR:+value} when var is empty', () => {
      process.env.TEST_EMPTY_CONDITIONAL = '';

      const result = loader.interpolateEnvVars({
        flag: '${TEST_EMPTY_CONDITIONAL:+enabled}',
      });

      assert.equal(result.flag, '');
    });

    test('interpolates multiple variables in one string', () => {
      process.env.TEST_HOST = 'localhost';
      process.env.TEST_PORT = '5432';

      const result = loader.interpolateEnvVars({
        url: 'postgres://${TEST_HOST}:${TEST_PORT}/mydb',
      });

      assert.equal(result.url, 'postgres://localhost:5432/mydb');
    });

    test('interpolates nested objects recursively', () => {
      process.env.TEST_NESTED_VAR = 'nested-value';

      const result = loader.interpolateEnvVars({
        level1: {
          level2: {
            level3: '${TEST_NESTED_VAR}',
          },
        },
      });

      assert.equal(result.level1.level2.level3, 'nested-value');
    });

    test('interpolates arrays', () => {
      process.env.TEST_ARRAY_VAR = 'array-value';

      const result = loader.interpolateEnvVars({
        items: ['static', '${TEST_ARRAY_VAR}', 'other'],
      });

      assert.deepEqual(result.items, ['static', 'array-value', 'other']);
    });

    test('preserves non-string primitives', () => {
      const input = {
        number: 42,
        boolean: true,
        nullValue: null,
        string: 'hello',
      };

      const result = loader.interpolateEnvVars(input);

      assert.equal(result.number, 42);
      assert.equal(result.boolean, true);
      assert.equal(result.nullValue, null);
      assert.equal(result.string, 'hello');
    });

    test('handles complex real-world config', () => {
      process.env.TEST_ANTHROPIC_API_KEY = 'sk-ant-123';
      process.env.TEST_DATABASE_URL = 'postgres://user:pass@localhost/db';

      const result = loader.interpolateEnvVars({
        providers: {
          anthropic: {
            type: 'anthropic',
            apiKey: '${TEST_ANTHROPIC_API_KEY}',
          },
        },
        database: '${TEST_DATABASE_URL}',
        debug: '${TEST_DEBUG:-false}',
        optional: '${TEST_OPTIONAL_FEATURE:+enabled}',
      });

      assert.equal(result.providers.anthropic.apiKey, 'sk-ant-123');
      assert.equal(result.database, 'postgres://user:pass@localhost/db');
      assert.equal(result.debug, 'false');
      assert.equal(result.optional, '');
    });
  });

  describe('deepMerge()', () => {
    test('merges flat objects', () => {
      const defaults = { a: 1, b: 2 };
      const overrides = { b: 3, c: 4 };

      const result = loader.deepMerge(defaults, overrides);

      assert.deepEqual(result, { a: 1, b: 3, c: 4 });
    });

    test('deep merges nested objects', () => {
      const defaults = {
        db: { host: 'localhost', port: 5432 },
        logging: { level: 'info' },
      };
      const overrides = {
        db: { port: 5433 },
      };

      const result = loader.deepMerge(defaults, overrides);

      assert.deepEqual(result, {
        db: { host: 'localhost', port: 5433 },
        logging: { level: 'info' },
      });
    });

    test('replaces arrays instead of concatenating', () => {
      const defaults = {
        tools: ['bash', 'readFile', 'writeFile'],
      };
      const overrides = {
        tools: ['bash'],
      };

      const result = loader.deepMerge(defaults, overrides);

      assert.deepEqual(result.tools, ['bash']);
    });

    test('does not mutate input objects', () => {
      const defaults = { a: 1, nested: { b: 2 } };
      const overrides = { nested: { c: 3 } };
      const originalDefaults = JSON.parse(JSON.stringify(defaults));
      const originalOverrides = JSON.parse(JSON.stringify(overrides));

      loader.deepMerge(defaults, overrides);

      assert.deepEqual(defaults, originalDefaults);
      assert.deepEqual(overrides, originalOverrides);
    });

    test('handles deeply nested structures', () => {
      const defaults = {
        model: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          options: { temperature: 0.7 },
        },
      };
      const overrides = {
        model: {
          model: 'claude-haiku-4-5',
          options: { maxTokens: 1000 },
        },
      };

      const result = loader.deepMerge(defaults, overrides);

      assert.deepEqual(result, {
        model: {
          provider: 'anthropic',
          model: 'claude-haiku-4-5',
          options: { temperature: 0.7, maxTokens: 1000 },
        },
      });
    });

    test('handles bot config inheritance scenario', () => {
      const globalDefaults = {
        model: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
        sandbox: { type: 'docker', image: 'node:22-slim' },
        tools: ['bash', 'readFile', 'writeFile'],
      };
      const botConfig = {
        id: 'my-bot',
        model: { model: 'claude-haiku-4-5' },
        tools: ['bash', 'grep'],
      };

      const result = loader.deepMerge(globalDefaults, botConfig);

      assert.deepEqual(result, {
        id: 'my-bot',
        model: { provider: 'anthropic', model: 'claude-haiku-4-5' },
        sandbox: { type: 'docker', image: 'node:22-slim' },
        tools: ['bash', 'grep'],
      });
    });
  });

  describe('loadBotConfig()', () => {
    test('loads and merges bot config with defaults', async () => {
      process.env.TEST_BOT_API_KEY = 'bot-api-key';

      const botConfig = {
        id: 'test-bot',
        model: { model: 'claude-haiku-4-5' },
        apiKey: '${TEST_BOT_API_KEY}',
      };
      const configPath = await createTempConfig(botConfig);

      const defaults = {
        model: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
        tools: ['bash'],
      };

      try {
        const result = await loader.loadBotConfig(configPath, defaults);

        assert.equal(result.id, 'test-bot');
        assert.equal(result.model.provider, 'anthropic');
        assert.equal(result.model.model, 'claude-haiku-4-5');
        assert.equal(result.apiKey, 'bot-api-key');
        assert.deepEqual(result.tools, ['bash']);
      } finally {
        await cleanupTempConfig(configPath);
        delete process.env.TEST_BOT_API_KEY;
      }
    });

    test('works with empty defaults', async () => {
      const botConfig = { id: 'standalone-bot', tools: ['bash'] };
      const configPath = await createTempConfig(botConfig);

      try {
        const result = await loader.loadBotConfig(configPath);
        assert.deepEqual(result, botConfig);
      } finally {
        await cleanupTempConfig(configPath);
      }
    });
  });
});

describe('ConfigError', () => {
  test('is an instance of Error', () => {
    const error = new ConfigError('Test error');
    assert.ok(error instanceof Error);
  });

  test('has correct name', () => {
    const error = new ConfigError('Test error');
    assert.equal(error.name, 'ConfigError');
  });

  test('stores configPath', () => {
    const error = new ConfigError('Test error', { configPath: '/path/to/config.json' });
    assert.equal(error.configPath, '/path/to/config.json');
  });

  test('stores envVar', () => {
    const error = new ConfigError('Test error', { envVar: 'MY_VAR' });
    assert.equal(error.envVar, 'MY_VAR');
  });

  test('stores cause', () => {
    const cause = new Error('Original error');
    const error = new ConfigError('Test error', { cause });
    assert.equal(error.cause, cause);
  });
});
