/**
 * Unit tests for ConfigLoader
 *
 * Tests configuration loading, environment variable interpolation,
 * and deep merging of configuration objects.
 */

import { test, describe, beforeEach, afterEach, mock } from 'node:test';
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

  describe('constructor with secretsManager', () => {
    test('stores secretsManager when provided', () => {
      const mockManager = { resolveAll: mock.fn() };
      const loaderWithSecrets = new ConfigLoader({ secretsManager: mockManager });
      assert.equal(loaderWithSecrets.secretsManager, mockManager);
    });

    test('defaults secretsManager to null', () => {
      const loaderNoSecrets = new ConfigLoader();
      assert.equal(loaderNoSecrets.secretsManager, null);
    });
  });

  describe('load() with SecretsManager', () => {
    /**
     * Create a mock SecretsManager
     * @param {Object} [overrides] - Override mock methods
     * @returns {Object} Mock SecretsManager
     */
    function createMockSecretsManager(overrides = {}) {
      return {
        resolveAll: mock.fn(async config => config),
        resolve: mock.fn(async ref => ref),
        ...overrides,
      };
    }

    test('uses SecretsManager when set on instance', async () => {
      const mockManager = createMockSecretsManager({
        resolveAll: mock.fn(async () => ({
          apiKey: 'resolved-secret',
        })),
      });

      const loaderWithSecrets = new ConfigLoader({ secretsManager: mockManager });
      const config = { apiKey: '${bw:vault/api-key}' };
      const configPath = await createTempConfig(config);

      try {
        const result = await loaderWithSecrets.load(configPath);
        assert.equal(result.apiKey, 'resolved-secret');
        assert.equal(mockManager.resolveAll.mock.callCount(), 1);
      } finally {
        await cleanupTempConfig(configPath);
      }
    });

    test('uses per-call secretsManager over instance-level', async () => {
      const instanceManager = createMockSecretsManager({
        resolveAll: mock.fn(async () => ({ source: 'instance' })),
      });
      const callManager = createMockSecretsManager({
        resolveAll: mock.fn(async () => ({ source: 'call' })),
      });

      const loaderWithSecrets = new ConfigLoader({ secretsManager: instanceManager });
      const config = { key: '${SECRET}' };
      const configPath = await createTempConfig(config);

      try {
        const result = await loaderWithSecrets.load(configPath, { secretsManager: callManager });
        assert.equal(result.source, 'call');
        assert.equal(callManager.resolveAll.mock.callCount(), 1);
        assert.equal(instanceManager.resolveAll.mock.callCount(), 0);
      } finally {
        await cleanupTempConfig(configPath);
      }
    });

    test('falls back to env interpolation when no secretsManager', async () => {
      process.env.TEST_FALLBACK_VAR = 'fallback-value';

      const config = { key: '${TEST_FALLBACK_VAR}' };
      const configPath = await createTempConfig(config);

      try {
        const result = await loader.load(configPath);
        assert.equal(result.key, 'fallback-value');
      } finally {
        await cleanupTempConfig(configPath);
        delete process.env.TEST_FALLBACK_VAR;
      }
    });

    test('wraps SecretsManager errors in ConfigError', async () => {
      const failingManager = createMockSecretsManager({
        resolveAll: mock.fn(async () => {
          throw new Error('Adapter connection failed');
        }),
      });

      const loaderWithSecrets = new ConfigLoader({ secretsManager: failingManager });
      const config = { key: '${bw:vault/missing}' };
      const configPath = await createTempConfig(config);

      try {
        await assert.rejects(
          () => loaderWithSecrets.load(configPath),
          err => {
            assert.equal(err.name, 'ConfigError');
            assert.match(err.message, /Failed to resolve secrets/);
            assert.match(err.message, /Adapter connection failed/);
            assert.ok(err.cause);
            return true;
          }
        );
      } finally {
        await cleanupTempConfig(configPath);
      }
    });

    test('resolves nested objects via SecretsManager', async () => {
      const mockManager = createMockSecretsManager({
        resolveAll: mock.fn(async config => {
          // Simulate resolving all strings in the config
          const resolve = obj => {
            if (typeof obj === 'string' && obj.startsWith('${')) {
              return 'resolved';
            }
            if (Array.isArray(obj)) return obj.map(resolve);
            if (obj !== null && typeof obj === 'object') {
              return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, resolve(v)]));
            }
            return obj;
          };
          return resolve(config);
        }),
      });

      const loaderWithSecrets = new ConfigLoader({ secretsManager: mockManager });
      const config = {
        providers: {
          anthropic: { apiKey: '${ANTHROPIC_KEY}' },
        },
        channels: {
          slack: { botToken: '${bw:prod/slack-token}' },
        },
        debug: true,
      };
      const configPath = await createTempConfig(config);

      try {
        const result = await loaderWithSecrets.load(configPath);
        assert.equal(result.providers.anthropic.apiKey, 'resolved');
        assert.equal(result.channels.slack.botToken, 'resolved');
        assert.equal(result.debug, true);
      } finally {
        await cleanupTempConfig(configPath);
      }
    });
  });

  describe('hasSecretReferences()', () => {
    test('returns true for adapter-prefixed references', () => {
      assert.equal(loader.hasSecretReferences({ key: '${bw:vault/item}' }), true);
      assert.equal(loader.hasSecretReferences({ key: '${1p:vault/item}' }), true);
    });

    test('returns false for plain env var references', () => {
      assert.equal(loader.hasSecretReferences({ key: '${MY_VAR}' }), false);
      assert.equal(loader.hasSecretReferences({ key: '${VAR:-default}' }), false);
    });

    test('returns false for no references', () => {
      assert.equal(loader.hasSecretReferences({ key: 'plain-value' }), false);
      assert.equal(loader.hasSecretReferences({ num: 42 }), false);
    });

    test('detects references in nested objects', () => {
      assert.equal(
        loader.hasSecretReferences({
          level1: { level2: { key: '${bw:vault/secret}' } },
        }),
        true
      );
    });

    test('detects references in arrays', () => {
      assert.equal(loader.hasSecretReferences({ items: ['${1p:vault/secret}', 'plain'] }), true);
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
