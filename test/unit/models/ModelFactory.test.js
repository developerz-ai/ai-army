/**
 * Unit tests for ModelFactory
 *
 * Tests multi-provider model creation (anthropic, openai, openrouter, ollama),
 * input validation, error handling, and helper methods.
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ModelFactory, ModelFactoryError } from '../../../src/models/model-factory.js';

describe('ModelFactory', () => {
  describe('createModel()', () => {
    describe('anthropic provider', () => {
      test('creates model instance with API key', () => {
        const model = ModelFactory.createModel('anthropic', 'claude-sonnet-4-5', 'sk-ant-test');

        assert.ok(model, 'Should return a model instance');
        assert.equal(model.modelId, 'claude-sonnet-4-5');
        assert.ok(model.provider.includes('anthropic'), 'Provider should include anthropic');
      });

      test('creates model without API key (falls back to env)', () => {
        const model = ModelFactory.createModel('anthropic', 'claude-haiku-4-5');

        assert.ok(model, 'Should return a model instance');
        assert.equal(model.modelId, 'claude-haiku-4-5');
      });

      test('supports various Claude model names', () => {
        const modelNames = ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4'];
        for (const name of modelNames) {
          const model = ModelFactory.createModel('anthropic', name, 'test-key');
          assert.equal(model.modelId, name, `Model ID should be ${name}`);
        }
      });

      test('model has correct provider prefix', () => {
        const model = ModelFactory.createModel('anthropic', 'claude-sonnet-4-5', 'key');
        assert.ok(model.provider.startsWith('anthropic'));
      });
    });

    describe('openai provider', () => {
      test('creates model instance with API key', () => {
        const model = ModelFactory.createModel('openai', 'gpt-4o', 'sk-test-key');

        assert.ok(model, 'Should return a model instance');
        assert.equal(model.modelId, 'gpt-4o');
        assert.ok(model.provider.includes('openai'), 'Provider should include openai');
      });

      test('creates model without API key (falls back to env)', () => {
        const model = ModelFactory.createModel('openai', 'gpt-4o-mini');

        assert.ok(model, 'Should return a model instance');
        assert.equal(model.modelId, 'gpt-4o-mini');
      });

      test('accepts custom base URL via options', () => {
        const model = ModelFactory.createModel('openai', 'gpt-4o', 'sk-test', {
          baseUrl: 'https://custom-openai.example.com/v1',
        });

        assert.ok(model, 'Should return a model instance');
        assert.equal(model.modelId, 'gpt-4o');
      });

      test('model has correct provider prefix', () => {
        const model = ModelFactory.createModel('openai', 'gpt-4o', 'key');
        assert.ok(model.provider.startsWith('openai'));
      });
    });

    describe('openrouter provider', () => {
      test('creates model with API key', () => {
        const model = ModelFactory.createModel(
          'openrouter',
          'anthropic/claude-sonnet-4-5',
          'sk-or-test'
        );

        assert.ok(model, 'Should return a model instance');
        assert.equal(model.modelId, 'anthropic/claude-sonnet-4-5');
      });

      test('creates model without API key', () => {
        const model = ModelFactory.createModel('openrouter', 'openai/gpt-4o');

        assert.ok(model, 'Should return a model instance');
        assert.equal(model.modelId, 'openai/gpt-4o');
      });

      test('accepts custom base URL via options', () => {
        const model = ModelFactory.createModel('openrouter', 'meta-llama/llama-3', 'key', {
          baseUrl: 'https://custom-router.example.com/v1',
        });

        assert.ok(model, 'Should return a model instance');
        assert.equal(model.modelId, 'meta-llama/llama-3');
      });

      test('uses openai-compatible provider under the hood', () => {
        const model = ModelFactory.createModel('openrouter', 'meta/llama-3', 'key');
        assert.ok(model.provider.startsWith('openai'));
      });
    });

    describe('ollama provider', () => {
      let savedOllamaUrl;

      beforeEach(() => {
        savedOllamaUrl = process.env.OLLAMA_BASE_URL;
      });

      afterEach(() => {
        if (savedOllamaUrl === undefined) {
          delete process.env.OLLAMA_BASE_URL;
        } else {
          process.env.OLLAMA_BASE_URL = savedOllamaUrl;
        }
      });

      test('creates model without API key', () => {
        const model = ModelFactory.createModel('ollama', 'llama3.2:latest');

        assert.ok(model, 'Should return a model instance');
        assert.equal(model.modelId, 'llama3.2:latest');
      });

      test('accepts custom base URL via options', () => {
        const model = ModelFactory.createModel('ollama', 'codellama:7b', undefined, {
          baseUrl: 'http://gpu-server:11434/v1',
        });

        assert.ok(model, 'Should return a model instance');
        assert.equal(model.modelId, 'codellama:7b');
      });

      test('reads OLLAMA_BASE_URL from environment', () => {
        process.env.OLLAMA_BASE_URL = 'http://remote-ollama:11434/v1';

        const model = ModelFactory.createModel('ollama', 'mistral:latest');
        assert.ok(model, 'Should return a model instance');
        assert.equal(model.modelId, 'mistral:latest');
      });

      test('options.baseUrl takes precedence over OLLAMA_BASE_URL env', () => {
        process.env.OLLAMA_BASE_URL = 'http://env-ollama:11434/v1';

        const model = ModelFactory.createModel('ollama', 'phi3:latest', undefined, {
          baseUrl: 'http://option-ollama:11434/v1',
        });
        assert.ok(model, 'Should return a model instance');
        assert.equal(model.modelId, 'phi3:latest');
      });

      test('uses openai-compatible provider under the hood', () => {
        const model = ModelFactory.createModel('ollama', 'phi3:latest');
        assert.ok(model.provider.startsWith('openai'));
      });
    });
  });

  describe('validation errors', () => {
    test('throws ModelFactoryError on unsupported provider', () => {
      assert.throws(
        () => ModelFactory.createModel('cohere', 'command-r', 'key'),
        err => {
          assert.ok(err instanceof ModelFactoryError);
          assert.equal(err.name, 'ModelFactoryError');
          assert.match(err.message, /Unsupported provider: "cohere"/);
          assert.match(err.message, /Supported providers:/);
          assert.equal(err.provider, 'cohere');
          assert.equal(err.modelName, 'command-r');
          return true;
        }
      );
    });

    test('error message lists all supported providers', () => {
      assert.throws(
        () => ModelFactory.createModel('bedrock', 'some-model'),
        err => {
          assert.match(err.message, /anthropic/);
          assert.match(err.message, /openai/);
          assert.match(err.message, /openrouter/);
          assert.match(err.message, /ollama/);
          return true;
        }
      );
    });

    test('throws on empty provider string', () => {
      assert.throws(
        () => ModelFactory.createModel('', 'model-name', 'key'),
        err => {
          assert.ok(err instanceof ModelFactoryError);
          assert.match(err.message, /Provider is required/);
          return true;
        }
      );
    });

    test('throws on null provider', () => {
      assert.throws(
        () => ModelFactory.createModel(null, 'model-name', 'key'),
        err => {
          assert.ok(err instanceof ModelFactoryError);
          assert.match(err.message, /Provider is required/);
          return true;
        }
      );
    });

    test('throws on undefined provider', () => {
      assert.throws(
        () => ModelFactory.createModel(undefined, 'model-name'),
        err => {
          assert.ok(err instanceof ModelFactoryError);
          assert.match(err.message, /Provider is required/);
          return true;
        }
      );
    });

    test('throws on non-string provider (number)', () => {
      assert.throws(
        () => ModelFactory.createModel(42, 'model-name'),
        err => {
          assert.ok(err instanceof ModelFactoryError);
          assert.match(err.message, /Provider is required/);
          return true;
        }
      );
    });

    test('throws on empty model name', () => {
      assert.throws(
        () => ModelFactory.createModel('anthropic', '', 'key'),
        err => {
          assert.ok(err instanceof ModelFactoryError);
          assert.match(err.message, /Model name is required/);
          assert.equal(err.provider, 'anthropic');
          return true;
        }
      );
    });

    test('throws on null model name', () => {
      assert.throws(
        () => ModelFactory.createModel('anthropic', null, 'key'),
        err => {
          assert.ok(err instanceof ModelFactoryError);
          assert.match(err.message, /Model name is required/);
          return true;
        }
      );
    });

    test('throws on undefined model name', () => {
      assert.throws(
        () => ModelFactory.createModel('anthropic'),
        err => {
          assert.ok(err instanceof ModelFactoryError);
          assert.match(err.message, /Model name is required/);
          return true;
        }
      );
    });

    test('throws on non-string model name (number)', () => {
      assert.throws(
        () => ModelFactory.createModel('anthropic', 123),
        err => {
          assert.ok(err instanceof ModelFactoryError);
          assert.match(err.message, /Model name is required/);
          return true;
        }
      );
    });
  });

  describe('model instance properties', () => {
    test('all providers return objects with modelId and specificationVersion', () => {
      const cases = [
        ['anthropic', 'claude-sonnet-4-5', 'key-1'],
        ['openai', 'gpt-4o', 'key-2'],
        ['openrouter', 'anthropic/claude-sonnet-4-5', 'key-3'],
        ['ollama', 'llama3.2:latest', undefined],
      ];

      for (const [provider, modelName, apiKey] of cases) {
        const model = ModelFactory.createModel(provider, modelName, apiKey);
        assert.equal(typeof model, 'object', `${provider} should return an object`);
        assert.equal(model.modelId, modelName, `${provider} modelId should match`);
        assert.ok(model.specificationVersion, `${provider} should have specificationVersion`);
      }
    });
  });

  describe('getSupportedProviders()', () => {
    test('returns array of 4 supported providers', () => {
      const providers = ModelFactory.getSupportedProviders();

      assert.ok(Array.isArray(providers), 'Should return an array');
      assert.equal(providers.length, 4, 'Should have 4 providers');
    });

    test('includes all expected providers', () => {
      const providers = ModelFactory.getSupportedProviders();

      assert.ok(providers.includes('anthropic'));
      assert.ok(providers.includes('openai'));
      assert.ok(providers.includes('openrouter'));
      assert.ok(providers.includes('ollama'));
    });

    test('returns a defensive copy (mutation-safe)', () => {
      const first = ModelFactory.getSupportedProviders();
      const second = ModelFactory.getSupportedProviders();

      assert.notEqual(first, second, 'Should return different array instances');
      assert.deepEqual(first, second, 'Content should be identical');

      // Mutating returned array should not affect future calls
      first.push('custom');
      const third = ModelFactory.getSupportedProviders();
      assert.equal(third.length, 4, 'Original should be unchanged after mutation');
    });
  });

  describe('isProviderSupported()', () => {
    test('returns true for all supported providers', () => {
      assert.equal(ModelFactory.isProviderSupported('anthropic'), true);
      assert.equal(ModelFactory.isProviderSupported('openai'), true);
      assert.equal(ModelFactory.isProviderSupported('openrouter'), true);
      assert.equal(ModelFactory.isProviderSupported('ollama'), true);
    });

    test('returns false for unsupported provider strings', () => {
      assert.equal(ModelFactory.isProviderSupported('cohere'), false);
      assert.equal(ModelFactory.isProviderSupported('google'), false);
      assert.equal(ModelFactory.isProviderSupported('mistral'), false);
      assert.equal(ModelFactory.isProviderSupported('bedrock'), false);
    });

    test('returns false for empty/null/undefined', () => {
      assert.equal(ModelFactory.isProviderSupported(''), false);
      assert.equal(ModelFactory.isProviderSupported(undefined), false);
      assert.equal(ModelFactory.isProviderSupported(null), false);
    });

    test('is case-sensitive', () => {
      assert.equal(ModelFactory.isProviderSupported('Anthropic'), false);
      assert.equal(ModelFactory.isProviderSupported('OPENAI'), false);
      assert.equal(ModelFactory.isProviderSupported('OpenRouter'), false);
    });
  });

  describe('ModelFactoryError', () => {
    test('extends Error with correct name', () => {
      const err = new ModelFactoryError('test error');
      assert.ok(err instanceof Error);
      assert.equal(err.name, 'ModelFactoryError');
      assert.equal(err.message, 'test error');
    });

    test('stores provider and modelName metadata', () => {
      const err = new ModelFactoryError('fail', {
        provider: 'anthropic',
        modelName: 'claude-sonnet-4-5',
      });
      assert.equal(err.provider, 'anthropic');
      assert.equal(err.modelName, 'claude-sonnet-4-5');
    });

    test('stores cause for error chaining', () => {
      const originalError = new Error('original');
      const err = new ModelFactoryError('wrapped', { cause: originalError });
      assert.equal(err.cause, originalError);
    });

    test('defaults optional fields to undefined', () => {
      const err = new ModelFactoryError('test');
      assert.equal(err.provider, undefined);
      assert.equal(err.modelName, undefined);
      assert.equal(err.cause, undefined);
    });
  });
});
