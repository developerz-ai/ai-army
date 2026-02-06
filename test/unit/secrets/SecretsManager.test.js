/**
 * SecretsManager Tests
 *
 * Tests for the central secret resolution coordinator
 */

import { strict as assert } from 'assert';
import { describe, it, beforeEach, mock } from 'node:test';
import { SecretsManager, SecretsManagerError } from '../../../src/secrets/secrets-manager.js';

/**
 * Create a mock adapter that resolves keys from a predefined map
 * @param {Object.<string, string>} secrets - Map of key to value
 * @returns {Object} Mock adapter with getSecret and initialize methods
 */
const createMockAdapter = (secrets = {}) => ({
  initialized: false,
  initialize: mock.fn(async () => {
    // no-op
  }),
  getSecret: mock.fn(async key => {
    if (key in secrets) {
      return secrets[key];
    }
    throw new Error(`Secret not found: ${key}`);
  }),
});

/**
 * Create a mock env adapter that resolves from a predefined map
 * Supports :- and :+ syntax like the real EnvAdapter
 * @param {Object.<string, string>} env - Map of variable name to value
 * @returns {Object} Mock env adapter
 */
const createMockEnvAdapter = (env = {}) => ({
  initialized: false,
  initialize: mock.fn(async () => {
    // no-op
  }),
  getSecret: mock.fn(async key => {
    // Parse :- and :+ patterns like the real EnvAdapter
    const defaultMatch = key.match(/^([^:]+):-(.*)$/);
    const conditionalMatch = key.match(/^([^:]+):\+(.*)$/);

    let varName;
    let defaultValue;
    let conditionalValue;

    if (defaultMatch) {
      [, varName, defaultValue] = defaultMatch;
    } else if (conditionalMatch) {
      [, varName, conditionalValue] = conditionalMatch;
    } else {
      varName = key;
    }

    const value = env[varName];
    const hasValue = value !== undefined && value !== '';

    if (defaultValue !== undefined) {
      return hasValue ? value : defaultValue;
    }

    if (conditionalValue !== undefined) {
      return hasValue ? conditionalValue : '';
    }

    if (!hasValue) {
      throw new Error(`Required environment variable '${varName}' is not set`);
    }

    return value;
  }),
});

describe('SecretsManager', () => {
  let manager;

  beforeEach(() => {
    manager = new SecretsManager();
  });

  describe('constructor', () => {
    it('should create with default options', () => {
      const m = new SecretsManager();
      assert.equal(m.initialized, false);
      assert.equal(m.adapters.size, 0);
      assert.notEqual(m.cache, null);
    });

    it('should allow disabling cache', () => {
      const m = new SecretsManager({ cacheEnabled: false });
      assert.equal(m.cache, null);
    });

    it('should accept custom cache TTL', () => {
      const m = new SecretsManager({ cacheTtl: 60_000 });
      assert.equal(m.cache.ttl, 60_000);
    });
  });

  describe('registerAdapter', () => {
    it('should register a valid adapter', () => {
      const adapter = createMockAdapter();
      manager.registerAdapter('env', adapter);
      assert.equal(manager.adapters.size, 1);
    });

    it('should register multiple adapters', () => {
      manager.registerAdapter('env', createMockAdapter());
      manager.registerAdapter('bitwarden', createMockAdapter());
      assert.equal(manager.adapters.size, 2);
    });

    it('should throw for empty adapter name', () => {
      assert.throws(
        () => manager.registerAdapter('', createMockAdapter()),
        err => {
          assert.ok(err instanceof SecretsManagerError);
          assert.match(err.message, /non-empty string/);
          return true;
        }
      );
    });

    it('should throw for null adapter name', () => {
      assert.throws(
        () => manager.registerAdapter(null, createMockAdapter()),
        err => {
          assert.ok(err instanceof SecretsManagerError);
          return true;
        }
      );
    });

    it('should throw for adapter without getSecret method', () => {
      assert.throws(
        () => manager.registerAdapter('bad', {}),
        err => {
          assert.ok(err instanceof SecretsManagerError);
          assert.match(err.message, /getSecret/);
          return true;
        }
      );
    });

    it('should throw for null adapter', () => {
      assert.throws(
        () => manager.registerAdapter('test', null),
        err => {
          assert.ok(err instanceof SecretsManagerError);
          return true;
        }
      );
    });
  });

  describe('initialize', () => {
    it('should initialize all registered adapters', async () => {
      const env = createMockAdapter();
      const bw = createMockAdapter();
      manager.registerAdapter('env', env);
      manager.registerAdapter('bitwarden', bw);

      await manager.initialize();

      assert.equal(env.initialize.mock.callCount(), 1);
      assert.equal(bw.initialize.mock.callCount(), 1);
      assert.equal(manager.initialized, true);
    });

    it('should pass adapter-specific configs', async () => {
      const bw = createMockAdapter();
      manager.registerAdapter('bitwarden', bw);

      await manager.initialize({ bitwarden: { sessionToken: 'abc' } });

      const callArgs = bw.initialize.mock.calls[0].arguments;
      assert.deepEqual(callArgs[0], { sessionToken: 'abc' });
    });

    it('should throw when no adapters are registered', async () => {
      await assert.rejects(
        () => manager.initialize(),
        err => {
          assert.ok(err instanceof SecretsManagerError);
          assert.match(err.message, /No adapters registered/);
          return true;
        }
      );
    });

    it('should throw when an adapter fails to initialize', async () => {
      const failing = createMockAdapter();
      failing.initialize = mock.fn(async () => {
        throw new Error('Connection refused');
      });
      manager.registerAdapter('failing', failing);

      await assert.rejects(
        () => manager.initialize(),
        err => {
          assert.ok(err instanceof SecretsManagerError);
          assert.match(err.message, /Failed to initialize/);
          assert.match(err.message, /failing/);
          return true;
        }
      );
    });

    it('should still mark initialized even when adapters fail', async () => {
      const failing = createMockAdapter();
      failing.initialize = mock.fn(async () => {
        throw new Error('fail');
      });
      manager.registerAdapter('failing', failing);

      try {
        await manager.initialize();
      } catch (_e) {
        // expected
      }

      assert.equal(manager.initialized, true);
    });
  });

  describe('resolve', () => {
    beforeEach(() => {
      const envAdapter = createMockEnvAdapter({
        API_KEY: 'sk-test-123',
        HOST: 'localhost',
        PORT: '3000',
      });
      manager.registerAdapter('env', envAdapter);
    });

    it('should resolve a simple env reference', async () => {
      const value = await manager.resolve('${API_KEY}');
      assert.equal(value, 'sk-test-123');
    });

    it('should return plain strings without references as-is', async () => {
      const value = await manager.resolve('just-a-string');
      assert.equal(value, 'just-a-string');
    });

    it('should resolve reference with default value', async () => {
      const value = await manager.resolve('${MISSING:-fallback}');
      assert.equal(value, 'fallback');
    });

    it('should resolve reference with conditional value', async () => {
      const value = await manager.resolve('${API_KEY:+present}');
      assert.equal(value, 'present');
    });

    it('should resolve embedded references in a string', async () => {
      const value = await manager.resolve('https://${HOST}:${PORT}/api');
      assert.equal(value, 'https://localhost:3000/api');
    });

    it('should throw for non-string input', async () => {
      await assert.rejects(
        () => manager.resolve(123),
        err => {
          assert.ok(err instanceof SecretsManagerError);
          assert.match(err.message, /must be a string/);
          return true;
        }
      );
    });

    it('should throw when env variable is missing and required', async () => {
      await assert.rejects(
        () => manager.resolve('${NONEXISTENT}'),
        err => {
          assert.ok(err instanceof SecretsManagerError);
          assert.match(err.message, /Failed to resolve/);
          return true;
        }
      );
    });

    it('should resolve Bitwarden references', async () => {
      const bwAdapter = createMockAdapter({ 'prod/slack-token': 'xoxb-real-token' });
      manager.registerAdapter('bitwarden', bwAdapter);

      const value = await manager.resolve('${bw:prod/slack-token}');
      assert.equal(value, 'xoxb-real-token');
    });

    it('should resolve 1Password references', async () => {
      const opAdapter = createMockAdapter({ 'vault/api-key': 'op-secret-123' });
      manager.registerAdapter('onepassword', opAdapter);

      const value = await manager.resolve('${1p:vault/api-key}');
      assert.equal(value, 'op-secret-123');
    });

    it('should throw for unregistered adapter', async () => {
      // bw: prefix resolves to 'bitwarden' adapter, which is not registered
      await assert.rejects(
        () => manager.resolve('${bw:vault/secret}'),
        err => {
          assert.ok(err instanceof SecretsManagerError);
          assert.match(err.message, /No adapter registered/);
          assert.match(err.message, /bitwarden/);
          return true;
        }
      );
    });

    it('should treat unrecognized prefix as plain env variable', async () => {
      // vault: is not a known adapter prefix, so it's treated as env var key
      await assert.rejects(
        () => manager.resolve('${vault:secret/path}'),
        err => {
          assert.ok(err instanceof SecretsManagerError);
          assert.match(err.message, /Failed to resolve/);
          return true;
        }
      );
    });
  });

  describe('resolveAll', () => {
    beforeEach(() => {
      const envAdapter = createMockEnvAdapter({
        API_KEY: 'sk-test-123',
        SLACK_TOKEN: 'xoxb-token',
        DB_HOST: 'db.example.com',
      });
      manager.registerAdapter('env', envAdapter);
    });

    it('should resolve all references in a flat object', async () => {
      const config = {
        apiKey: '${API_KEY}',
        token: '${SLACK_TOKEN}',
      };

      const resolved = await manager.resolveAll(config);
      assert.equal(resolved.apiKey, 'sk-test-123');
      assert.equal(resolved.token, 'xoxb-token');
    });

    it('should resolve nested objects', async () => {
      const config = {
        providers: {
          anthropic: {
            apiKey: '${API_KEY}',
          },
        },
        database: {
          host: '${DB_HOST}',
        },
      };

      const resolved = await manager.resolveAll(config);
      assert.equal(resolved.providers.anthropic.apiKey, 'sk-test-123');
      assert.equal(resolved.database.host, 'db.example.com');
    });

    it('should resolve arrays', async () => {
      const config = ['${API_KEY}', 'plain', '${SLACK_TOKEN}'];
      const resolved = await manager.resolveAll(config);
      assert.deepEqual(resolved, ['sk-test-123', 'plain', 'xoxb-token']);
    });

    it('should preserve non-string primitives', async () => {
      const config = {
        port: 3000,
        enabled: true,
        nullable: null,
        key: '${API_KEY}',
      };

      const resolved = await manager.resolveAll(config);
      assert.equal(resolved.port, 3000);
      assert.equal(resolved.enabled, true);
      assert.equal(resolved.nullable, null);
      assert.equal(resolved.key, 'sk-test-123');
    });

    it('should handle empty objects', async () => {
      const resolved = await manager.resolveAll({});
      assert.deepEqual(resolved, {});
    });

    it('should handle deeply nested config', async () => {
      const config = {
        l1: {
          l2: {
            l3: {
              secret: '${API_KEY}',
            },
          },
        },
      };

      const resolved = await manager.resolveAll(config);
      assert.equal(resolved.l1.l2.l3.secret, 'sk-test-123');
    });

    it('should resolve mixed adapter references', async () => {
      const bwAdapter = createMockAdapter({ 'prod/bw-secret': 'bw-value' });
      manager.registerAdapter('bitwarden', bwAdapter);

      const config = {
        envSecret: '${API_KEY}',
        bwSecret: '${bw:prod/bw-secret}',
      };

      const resolved = await manager.resolveAll(config);
      assert.equal(resolved.envSecret, 'sk-test-123');
      assert.equal(resolved.bwSecret, 'bw-value');
    });

    it('should not mutate the original config', async () => {
      const config = {
        key: '${API_KEY}',
        nested: { token: '${SLACK_TOKEN}' },
      };

      const original = JSON.parse(JSON.stringify(config));
      await manager.resolveAll(config);

      assert.deepEqual(config, original);
    });
  });

  describe('caching', () => {
    it('should cache resolved values', async () => {
      const adapter = createMockAdapter({ mykey: 'value' });
      manager.registerAdapter('bitwarden', adapter);

      await manager.resolve('${bw:mykey}');
      await manager.resolve('${bw:mykey}');

      // getSecret should only be called once due to caching
      assert.equal(adapter.getSecret.mock.callCount(), 1);
    });

    it('should not cache when caching is disabled', async () => {
      const noCacheManager = new SecretsManager({ cacheEnabled: false });
      const adapter = createMockAdapter({ mykey: 'value' });
      noCacheManager.registerAdapter('bitwarden', adapter);

      await noCacheManager.resolve('${bw:mykey}');
      await noCacheManager.resolve('${bw:mykey}');

      // getSecret should be called each time
      assert.equal(adapter.getSecret.mock.callCount(), 2);
    });

    it('should return correct cache stats', () => {
      const stats = manager.getCacheStats();
      assert.equal(stats.size, 0);
      assert.equal(stats.ttl, 300_000);
    });

    it('should return null stats when caching is disabled', () => {
      const noCacheManager = new SecretsManager({ cacheEnabled: false });
      assert.equal(noCacheManager.getCacheStats(), null);
    });

    it('should clear cache', async () => {
      const adapter = createMockAdapter({ key: 'val' });
      manager.registerAdapter('bitwarden', adapter);

      await manager.resolve('${bw:key}');
      assert.equal(manager.getCacheStats().size, 1);

      manager.clearCache();
      assert.equal(manager.getCacheStats().size, 0);
    });
  });

  describe('getAdapterNames', () => {
    it('should return empty array when no adapters registered', () => {
      assert.deepEqual(manager.getAdapterNames(), []);
    });

    it('should return all registered adapter names', () => {
      manager.registerAdapter('env', createMockAdapter());
      manager.registerAdapter('bitwarden', createMockAdapter());
      const names = manager.getAdapterNames();
      assert.ok(names.includes('env'));
      assert.ok(names.includes('bitwarden'));
      assert.equal(names.length, 2);
    });
  });

  describe('SecretsManagerError', () => {
    it('should be an Error instance', () => {
      const err = new SecretsManagerError('test');
      assert.ok(err instanceof Error);
      assert.ok(err instanceof SecretsManagerError);
    });

    it('should have correct name', () => {
      const err = new SecretsManagerError('test');
      assert.equal(err.name, 'SecretsManagerError');
    });

    it('should store adapter option', () => {
      const err = new SecretsManagerError('test', { adapter: 'bitwarden' });
      assert.equal(err.adapter, 'bitwarden');
    });

    it('should store reference option', () => {
      const err = new SecretsManagerError('test', { reference: '${bw:vault/item}' });
      assert.equal(err.reference, '${bw:vault/item}');
    });

    it('should store cause option', () => {
      const cause = new Error('root cause');
      const err = new SecretsManagerError('wrapper', { cause });
      assert.equal(err.cause, cause);
    });
  });
});
