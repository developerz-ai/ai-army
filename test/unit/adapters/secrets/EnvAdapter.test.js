/**
 * EnvAdapter Tests
 *
 * Tests for environment variable-based secret resolution
 */

import { strict as assert } from 'assert';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { EnvAdapter, EnvAdapterError } from '../../../../src/adapters/secrets/env.js';

describe('EnvAdapter', () => {
  let adapter;
  const savedEnv = {};

  beforeEach(() => {
    adapter = new EnvAdapter();
    // Save original environment variables
    Object.assign(savedEnv, process.env);
  });

  afterEach(() => {
    // Restore original environment variables
    Object.keys(process.env).forEach(key => {
      if (!(key in savedEnv)) {
        delete process.env[key];
      }
    });
    Object.assign(process.env, savedEnv);
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      await adapter.initialize();
      assert.equal(adapter.initialized, true);
    });

    it('should throw when calling getSecret before initialization', async () => {
      const uninitializedAdapter = new EnvAdapter();
      await assert.rejects(
        () => uninitializedAdapter.getSecret('TEST_VAR'),
        err => {
          assert.equal(err.name, 'EnvAdapterError');
          assert.match(err.message, /not initialized/i);
          return true;
        }
      );
    });

    it('should accept optional config parameter', async () => {
      const config = { someOption: 'value' };
      await adapter.initialize(config);
      assert.equal(adapter.initialized, true);
    });
  });

  describe('getSecret - simple variable pattern', () => {
    beforeEach(async () => {
      await adapter.initialize();
      process.env.TEST_VAR = 'test_value';
      process.env.EMPTY_VAR = '';
    });

    it('should return value for existing environment variable', async () => {
      const value = await adapter.getSecret('TEST_VAR');
      assert.equal(value, 'test_value');
    });

    it('should throw error for missing required variable', async () => {
      await assert.rejects(
        () => adapter.getSecret('MISSING_VAR'),
        err => {
          assert.equal(err.name, 'EnvAdapterError');
          assert.match(err.message, /Required environment variable/);
          assert.match(err.message, /MISSING_VAR/);
          assert.equal(err.variableName, 'MISSING_VAR');
          return true;
        }
      );
    });

    it('should throw error for empty environment variable', async () => {
      await assert.rejects(
        () => adapter.getSecret('EMPTY_VAR'),
        err => {
          assert.equal(err.name, 'EnvAdapterError');
          assert.match(err.message, /Required environment variable/);
          return true;
        }
      );
    });

    it('should throw error for invalid key type', async () => {
      await assert.rejects(
        () => adapter.getSecret(null),
        err => {
          assert.equal(err.name, 'EnvAdapterError');
          assert.match(err.message, /Invalid variable name/);
          return true;
        }
      );
    });

    it('should throw error for empty string key', async () => {
      await assert.rejects(
        () => adapter.getSecret(''),
        err => {
          assert.equal(err.name, 'EnvAdapterError');
          assert.match(err.message, /Invalid variable name/);
          return true;
        }
      );
    });
  });

  describe('getSecret - default value pattern (${VAR:-default})', () => {
    beforeEach(async () => {
      await adapter.initialize();
      process.env.EXISTING_VAR = 'existing_value';
    });

    it('should return variable value when it exists', async () => {
      const value = await adapter.getSecret('EXISTING_VAR:-default');
      assert.equal(value, 'existing_value');
    });

    it('should return default value when variable is missing', async () => {
      const value = await adapter.getSecret('MISSING_VAR:-default_value');
      assert.equal(value, 'default_value');
    });

    it('should return default value when variable is empty', async () => {
      process.env.EMPTY_VAR = '';
      const value = await adapter.getSecret('EMPTY_VAR:-default_value');
      assert.equal(value, 'default_value');
    });

    it('should handle empty string as default value', async () => {
      const value = await adapter.getSecret('MISSING_VAR:-');
      assert.equal(value, '');
    });

    it('should handle default with special characters', async () => {
      const value = await adapter.getSecret('MISSING_VAR:-default:with:colons');
      assert.equal(value, 'default:with:colons');
    });

    it('should handle complex default values', async () => {
      const value = await adapter.getSecret('MISSING_VAR:-https://example.com:8080');
      assert.equal(value, 'https://example.com:8080');
    });
  });

  describe('getSecret - conditional value pattern (${VAR:+value})', () => {
    beforeEach(async () => {
      await adapter.initialize();
      process.env.EXISTING_VAR = 'any_value';
    });

    it('should return value when variable is set', async () => {
      const value = await adapter.getSecret('EXISTING_VAR:+custom_value');
      assert.equal(value, 'custom_value');
    });

    it('should return empty string when variable is missing', async () => {
      const value = await adapter.getSecret('MISSING_VAR:+custom_value');
      assert.equal(value, '');
    });

    it('should return empty string when variable is empty', async () => {
      process.env.EMPTY_VAR = '';
      const value = await adapter.getSecret('EMPTY_VAR:+custom_value');
      assert.equal(value, '');
    });

    it('should handle custom_value with special characters', async () => {
      const value = await adapter.getSecret('EXISTING_VAR:+prod-mode-enabled');
      assert.equal(value, 'prod-mode-enabled');
    });
  });

  describe('hasSecret', () => {
    beforeEach(async () => {
      await adapter.initialize();
      process.env.EXISTING_VAR = 'value';
      process.env.EMPTY_VAR = '';
    });

    it('should return true for existing non-empty variable', async () => {
      const has = await adapter.hasSecret('EXISTING_VAR');
      assert.equal(has, true);
    });

    it('should return false for missing variable', async () => {
      const has = await adapter.hasSecret('MISSING_VAR');
      assert.equal(has, false);
    });

    it('should return false for empty variable', async () => {
      const has = await adapter.hasSecret('EMPTY_VAR');
      assert.equal(has, false);
    });

    it('should work before initialization', async () => {
      const uninitializedAdapter = new EnvAdapter();
      const has = await uninitializedAdapter.hasSecret('TEST_VAR');
      assert.equal(has, false);
    });

    it('should parse variable names from patterns', async () => {
      const has = await adapter.hasSecret('EXISTING_VAR:-default');
      assert.equal(has, true);
    });
  });

  describe('listSecrets', () => {
    beforeEach(async () => {
      await adapter.initialize();
      // Clear most env vars for test isolation
      Object.keys(process.env).forEach(key => {
        if (!key.startsWith('NODE_') && !key.startsWith('PATH') && !key.startsWith('npm_')) {
          delete process.env[key];
        }
      });
      process.env.TEST_SECRET_1 = 'value1';
      process.env.TEST_SECRET_2 = 'value2';
    });

    it('should return array of secret names', async () => {
      const secrets = await adapter.listSecrets();
      assert.ok(Array.isArray(secrets));
      assert.ok(secrets.includes('TEST_SECRET_1'));
      assert.ok(secrets.includes('TEST_SECRET_2'));
    });

    it('should throw when called before initialization', async () => {
      const uninitializedAdapter = new EnvAdapter();
      await assert.rejects(
        () => uninitializedAdapter.listSecrets(),
        err => {
          assert.equal(err.name, 'EnvAdapterError');
          assert.match(err.message, /not initialized/i);
          return true;
        }
      );
    });

    it('should include all set environment variables', async () => {
      const secrets = await adapter.listSecrets();
      assert.ok(secrets.length > 0);
      assert.ok(Array.isArray(secrets));
      assert.equal(typeof secrets[0], 'string');
    });
  });

  describe('EnvAdapterError', () => {
    it('should be an Error instance', () => {
      const error = new EnvAdapterError('Test error');
      assert.ok(error instanceof Error);
      assert.ok(error instanceof EnvAdapterError);
    });

    it('should have correct name', () => {
      const error = new EnvAdapterError('Test error');
      assert.equal(error.name, 'EnvAdapterError');
    });

    it('should store variableName option', () => {
      const error = new EnvAdapterError('Test error', { variableName: 'MY_VAR' });
      assert.equal(error.variableName, 'MY_VAR');
    });

    it('should store cause option', () => {
      const cause = new Error('Original error');
      const error = new EnvAdapterError('Wrapper error', { cause });
      assert.equal(error.cause, cause);
    });
  });

  describe('real-world patterns', () => {
    beforeEach(async () => {
      await adapter.initialize();
    });

    it('should handle API key resolution', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-v0-test-key-123';
      const key = await adapter.getSecret('ANTHROPIC_API_KEY');
      assert.equal(key, 'sk-ant-v0-test-key-123');
    });

    it('should handle optional Slack token with default', async () => {
      const token = await adapter.getSecret('SLACK_BOT_TOKEN:-xoxb-default-token');
      assert.equal(token, 'xoxb-default-token');

      process.env.SLACK_BOT_TOKEN = 'xoxb-real-token';
      const token2 = await adapter.getSecret('SLACK_BOT_TOKEN:-xoxb-default-token');
      assert.equal(token2, 'xoxb-real-token');
    });

    it('should handle database URL with default', async () => {
      // Clear DATABASE_URL to test default (CI may have it set)
      delete process.env.DATABASE_URL;

      const dbDefault = 'DATABASE_URL:-postgresql://localhost:5432/ai-army';
      const url = await adapter.getSecret(dbDefault);
      assert.equal(url, 'postgresql://localhost:5432/ai-army');

      process.env.DATABASE_URL = 'postgresql://prod-host:5432/ai-army-prod';
      const url2 = await adapter.getSecret(dbDefault);
      assert.equal(url2, 'postgresql://prod-host:5432/ai-army-prod');
    });

    it('should handle conditional feature flags', async () => {
      process.env.ENABLE_EXPERIMENTAL_FEATURES = '1';
      const flag = await adapter.getSecret('ENABLE_EXPERIMENTAL_FEATURES:+true');
      assert.equal(flag, 'true');

      const disabled = await adapter.getSecret('DISABLED_FEATURE:+true');
      assert.equal(disabled, '');
    });
  });

  describe('edge cases', () => {
    beforeEach(async () => {
      await adapter.initialize();
    });

    it('should handle variable names with underscores and numbers', async () => {
      process.env.MY_VAR_123 = 'value';
      const value = await adapter.getSecret('MY_VAR_123');
      assert.equal(value, 'value');
    });

    it('should handle very long variable names', async () => {
      const longName = 'A'.repeat(256);
      process.env[longName] = 'long_value';
      const value = await adapter.getSecret(longName);
      assert.equal(value, 'long_value');
    });

    it('should handle very long default values', async () => {
      const longDefault = 'x'.repeat(1024);
      const value = await adapter.getSecret(`MISSING_VAR:-${longDefault}`);
      assert.equal(value, longDefault);
    });

    it('should handle numeric string values', async () => {
      process.env.PORT = '3000';
      const value = await adapter.getSecret('PORT');
      assert.equal(value, '3000');
      assert.equal(typeof value, 'string');
    });

    it('should handle special characters in values', async () => {
      process.env.SPECIAL = 'value$with@special#chars!';
      const value = await adapter.getSecret('SPECIAL');
      assert.equal(value, 'value$with@special#chars!');
    });

    it('should handle JSON-like values', async () => {
      const jsonValue = '{"key":"value","number":123}';
      process.env.JSON_CONFIG = jsonValue;
      const value = await adapter.getSecret('JSON_CONFIG');
      assert.equal(value, jsonValue);
    });
  });
});
