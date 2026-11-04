/**
 * Unit tests for ProviderRegistry
 *
 * Tests provider registration, retrieval, listing, validation,
 * built-in provider management, and error handling.
 */

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderRegistry, ProviderRegistryError } from '../../../src/models/provider-registry.js';
import { PROVIDER_CAPABILITIES } from '../../../src/models/capabilities.js';

describe('ProviderRegistry', () => {
  let registry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  describe('constructor', () => {
    test('registers built-in providers by default', () => {
      const providers = registry.listProviders();
      assert.ok(providers.includes('anthropic'));
      assert.ok(providers.includes('openai'));
      assert.ok(providers.includes('openrouter'));
      assert.ok(providers.includes('ollama'));
    });

    test('has 4 built-in providers', () => {
      assert.equal(registry.size, 4);
    });

    test('can skip built-in providers with registerBuiltins: false', () => {
      const emptyRegistry = new ProviderRegistry({ registerBuiltins: false });
      assert.equal(emptyRegistry.size, 0);
      assert.deepEqual(emptyRegistry.listProviders(), []);
    });
  });

  describe('registerProvider()', () => {
    test('registers a new provider', () => {
      registry.registerProvider('custom-llm', { type: 'custom' });
      assert.ok(registry.hasProvider('custom-llm'));
      assert.equal(registry.size, 5);
    });

    test('overwrites existing provider', () => {
      registry.registerProvider('anthropic', {
        type: 'anthropic',
        apiKey: 'new-key',
      });

      const provider = registry.getProvider('anthropic');
      assert.equal(provider.adapter.apiKey, 'new-key');
    });

    test('stores capabilities from PROVIDER_CAPABILITIES', () => {
      registry.registerProvider('my-openai', { type: 'openai' });
      const provider = registry.getProvider('my-openai');
      assert.deepEqual(provider.capabilities, PROVIDER_CAPABILITIES.openai);
    });

    test('allows custom capabilities override', () => {
      const customCaps = {
        streaming: false,
        tools: false,
        vision: false,
        maxTokens: 1000,
        models: null,
      };
      registry.registerProvider('limited', {
        type: 'custom',
        capabilities: customCaps,
      });

      const provider = registry.getProvider('limited');
      assert.equal(provider.capabilities.streaming, false);
      assert.equal(provider.capabilities.maxTokens, 1000);
    });

    test('throws on empty name', () => {
      assert.throws(
        () => registry.registerProvider('', { type: 'custom' }),
        err => {
          assert.ok(err instanceof ProviderRegistryError);
          assert.match(err.message, /name is required/);
          return true;
        }
      );
    });

    test('throws on null name', () => {
      assert.throws(
        () => registry.registerProvider(null, { type: 'custom' }),
        err => {
          assert.ok(err instanceof ProviderRegistryError);
          return true;
        }
      );
    });

    test('throws on non-object adapter', () => {
      assert.throws(
        () => registry.registerProvider('test', 'not-an-object'),
        err => {
          assert.ok(err instanceof ProviderRegistryError);
          assert.match(err.message, /must be an object/);
          return true;
        }
      );
    });

    test('throws on null adapter', () => {
      assert.throws(
        () => registry.registerProvider('test', null),
        err => {
          assert.ok(err instanceof ProviderRegistryError);
          return true;
        }
      );
    });

    test('throws on adapter without type', () => {
      assert.throws(
        () => registry.registerProvider('test', { apiKey: 'key' }),
        err => {
          assert.ok(err instanceof ProviderRegistryError);
          assert.match(err.message, /must have a "type" field/);
          return true;
        }
      );
    });
  });

  describe('getProvider()', () => {
    test('returns provider entry for built-in provider', () => {
      const provider = registry.getProvider('anthropic');
      assert.ok(provider);
      assert.equal(provider.name, 'anthropic');
      assert.equal(provider.adapter.type, 'anthropic');
      assert.ok(provider.capabilities);
    });

    test('returns defensive copy (mutation-safe)', () => {
      const first = registry.getProvider('anthropic');
      const second = registry.getProvider('anthropic');
      assert.notEqual(first, second);
      assert.notEqual(first.adapter, second.adapter);

      first.adapter.apiKey = 'mutated';
      const third = registry.getProvider('anthropic');
      assert.equal(third.adapter.apiKey, undefined);
    });

    test('returns null for unknown provider', () => {
      assert.equal(registry.getProvider('nonexistent'), null);
    });

    test('returns null for empty string', () => {
      assert.equal(registry.getProvider(''), null);
    });

    test('returns null for null', () => {
      assert.equal(registry.getProvider(null), null);
    });

    test('returns null for undefined', () => {
      assert.equal(registry.getProvider(undefined), null);
    });

    test('returns null for non-string', () => {
      assert.equal(registry.getProvider(42), null);
    });
  });

  describe('listProviders()', () => {
    test('returns array of provider names', () => {
      const names = registry.listProviders();
      assert.ok(Array.isArray(names));
      assert.equal(names.length, 4);
    });

    test('returns defensive copy', () => {
      const first = registry.listProviders();
      const second = registry.listProviders();
      assert.notEqual(first, second);
      assert.deepEqual(first, second);
    });

    test('reflects newly registered providers', () => {
      registry.registerProvider('custom-1', { type: 'custom' });
      const names = registry.listProviders();
      assert.ok(names.includes('custom-1'));
      assert.equal(names.length, 5);
    });
  });

  describe('validateProvider()', () => {
    test('returns valid for correct anthropic config', () => {
      const result = registry.validateProvider({
        type: 'anthropic',
        apiKey: 'sk-ant-test',
      });
      assert.equal(result.valid, true);
      assert.deepEqual(result.errors, []);
    });

    test('returns valid for ollama config without apiKey', () => {
      const result = registry.validateProvider({
        type: 'ollama',
        baseUrl: 'http://localhost:11434',
      });
      assert.equal(result.valid, true);
    });

    test('returns valid for openrouter config', () => {
      const result = registry.validateProvider({
        type: 'openrouter',
        apiKey: 'sk-or-test',
        baseURL: 'https://openrouter.ai/api/v1',
      });
      assert.equal(result.valid, true);
    });

    test('returns invalid for missing type', () => {
      const result = registry.validateProvider({ apiKey: 'key' });
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('type')));
    });

    test('returns invalid for unknown type', () => {
      const result = registry.validateProvider({ type: 'bedrock' });
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('Invalid provider type')));
    });

    test('returns invalid for non-object config', () => {
      const result = registry.validateProvider('not-an-object');
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('must be an object')));
    });

    test('returns invalid for null config', () => {
      const result = registry.validateProvider(null);
      assert.equal(result.valid, false);
    });

    test('returns invalid for invalid base URL', () => {
      const result = registry.validateProvider({
        type: 'openai',
        baseUrl: 'not-a-url',
      });
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('Invalid base URL')));
    });

    test('accepts valid baseURL alternative field', () => {
      const result = registry.validateProvider({
        type: 'openai',
        baseURL: 'https://api.example.com/v1',
      });
      assert.equal(result.valid, true);
    });

    test('accepts custom provider type', () => {
      const result = registry.validateProvider({ type: 'custom' });
      assert.equal(result.valid, true);
    });

    test('accepts google provider type', () => {
      const result = registry.validateProvider({ type: 'google' });
      assert.equal(result.valid, true);
    });
  });

  describe('hasProvider()', () => {
    test('returns true for built-in providers', () => {
      assert.equal(registry.hasProvider('anthropic'), true);
      assert.equal(registry.hasProvider('openai'), true);
    });

    test('returns false for unknown provider', () => {
      assert.equal(registry.hasProvider('nonexistent'), false);
    });

    test('returns true after registration', () => {
      registry.registerProvider('new-one', { type: 'custom' });
      assert.equal(registry.hasProvider('new-one'), true);
    });
  });

  describe('removeProvider()', () => {
    test('removes existing provider and returns true', () => {
      assert.equal(registry.removeProvider('anthropic'), true);
      assert.equal(registry.hasProvider('anthropic'), false);
      assert.equal(registry.size, 3);
    });

    test('returns false for non-existent provider', () => {
      assert.equal(registry.removeProvider('nonexistent'), false);
    });
  });

  describe('size', () => {
    test('returns correct count', () => {
      assert.equal(registry.size, 4);
      registry.registerProvider('extra', { type: 'custom' });
      assert.equal(registry.size, 5);
      registry.removeProvider('extra');
      assert.equal(registry.size, 4);
    });
  });

  describe('ProviderRegistryError', () => {
    test('extends Error with correct name', () => {
      const err = new ProviderRegistryError('test error');
      assert.ok(err instanceof Error);
      assert.equal(err.name, 'ProviderRegistryError');
      assert.equal(err.message, 'test error');
    });

    test('stores provider metadata', () => {
      const err = new ProviderRegistryError('fail', { provider: 'anthropic' });
      assert.equal(err.provider, 'anthropic');
    });

    test('stores cause for error chaining', () => {
      const originalError = new Error('original');
      const err = new ProviderRegistryError('wrapped', { cause: originalError });
      assert.equal(err.cause, originalError);
    });

    test('defaults optional fields to undefined', () => {
      const err = new ProviderRegistryError('test');
      assert.equal(err.provider, undefined);
      assert.equal(err.cause, undefined);
    });
  });
});
