/**
 * Unit tests for capabilities module
 *
 * Tests PROVIDER_CAPABILITIES, FALLBACK_STATUS_CODES, getProviderCapabilities,
 * and hasCapability helper functions.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROVIDER_CAPABILITIES,
  FALLBACK_STATUS_CODES,
  DEFAULT_MAX_FALLBACK_ATTEMPTS,
  getProviderCapabilities,
  hasCapability,
} from '../../../src/models/capabilities.js';

describe('capabilities', () => {
  describe('PROVIDER_CAPABILITIES', () => {
    test('is a frozen object', () => {
      assert.ok(Object.isFrozen(PROVIDER_CAPABILITIES));
    });

    test('has entries for all built-in providers', () => {
      const expectedProviders = ['anthropic', 'openai', 'openrouter', 'ollama', 'google'];
      for (const provider of expectedProviders) {
        assert.ok(PROVIDER_CAPABILITIES[provider], `Should have capabilities for ${provider}`);
      }
    });

    test('each provider has required capability fields', () => {
      const requiredFields = ['streaming', 'tools', 'vision', 'maxTokens', 'models'];

      for (const [provider, caps] of Object.entries(PROVIDER_CAPABILITIES)) {
        for (const field of requiredFields) {
          assert.ok(field in caps, `${provider} should have "${field}" capability`);
        }
      }
    });

    describe('anthropic capabilities', () => {
      const caps = PROVIDER_CAPABILITIES.anthropic;

      test('supports streaming', () => {
        assert.equal(caps.streaming, true);
      });

      test('supports tools', () => {
        assert.equal(caps.tools, true);
      });

      test('supports vision', () => {
        assert.equal(caps.vision, true);
      });

      test('has maxTokens of 200000', () => {
        assert.equal(caps.maxTokens, 200000);
      });

      test('has known Claude models', () => {
        assert.ok(Array.isArray(caps.models));
        assert.ok(caps.models.length > 0);
        assert.ok(caps.models.includes('claude-sonnet-4-5'));
        assert.ok(caps.models.includes('claude-haiku-4-5'));
      });

      test('models array is frozen', () => {
        assert.ok(Object.isFrozen(caps.models));
      });
    });

    describe('openai capabilities', () => {
      const caps = PROVIDER_CAPABILITIES.openai;

      test('supports streaming, tools, and vision', () => {
        assert.equal(caps.streaming, true);
        assert.equal(caps.tools, true);
        assert.equal(caps.vision, true);
      });

      test('has maxTokens of 128000', () => {
        assert.equal(caps.maxTokens, 128000);
      });

      test('has known GPT models', () => {
        assert.ok(Array.isArray(caps.models));
        assert.ok(caps.models.includes('gpt-4o'));
        assert.ok(caps.models.includes('gpt-4o-mini'));
      });
    });

    describe('openrouter capabilities', () => {
      const caps = PROVIDER_CAPABILITIES.openrouter;

      test('supports streaming and tools', () => {
        assert.equal(caps.streaming, true);
        assert.equal(caps.tools, true);
      });

      test('has null maxTokens (dynamic)', () => {
        assert.equal(caps.maxTokens, null);
      });

      test('has null models (dynamic)', () => {
        assert.equal(caps.models, null);
      });
    });

    describe('ollama capabilities', () => {
      const caps = PROVIDER_CAPABILITIES.ollama;

      test('supports streaming and tools', () => {
        assert.equal(caps.streaming, true);
        assert.equal(caps.tools, true);
      });

      test('does not support vision', () => {
        assert.equal(caps.vision, false);
      });

      test('has null maxTokens and models (dynamic)', () => {
        assert.equal(caps.maxTokens, null);
        assert.equal(caps.models, null);
      });
    });

    describe('google capabilities', () => {
      const caps = PROVIDER_CAPABILITIES.google;

      test('supports streaming, tools, and vision', () => {
        assert.equal(caps.streaming, true);
        assert.equal(caps.tools, true);
        assert.equal(caps.vision, true);
      });

      test('has maxTokens of 1000000', () => {
        assert.equal(caps.maxTokens, 1000000);
      });

      test('has known Gemini models', () => {
        assert.ok(Array.isArray(caps.models));
        assert.ok(caps.models.includes('gemini-2.0-flash'));
      });
    });
  });

  describe('FALLBACK_STATUS_CODES', () => {
    test('is a frozen array', () => {
      assert.ok(Object.isFrozen(FALLBACK_STATUS_CODES));
    });

    test('includes rate limit code (429)', () => {
      assert.ok(FALLBACK_STATUS_CODES.includes(429));
    });

    test('includes server error codes (500, 502, 503, 504)', () => {
      assert.ok(FALLBACK_STATUS_CODES.includes(500));
      assert.ok(FALLBACK_STATUS_CODES.includes(502));
      assert.ok(FALLBACK_STATUS_CODES.includes(503));
      assert.ok(FALLBACK_STATUS_CODES.includes(504));
    });

    test('does not include client error codes (400, 401, 403)', () => {
      assert.ok(!FALLBACK_STATUS_CODES.includes(400));
      assert.ok(!FALLBACK_STATUS_CODES.includes(401));
      assert.ok(!FALLBACK_STATUS_CODES.includes(403));
    });
  });

  describe('DEFAULT_MAX_FALLBACK_ATTEMPTS', () => {
    test('is a positive number', () => {
      assert.equal(typeof DEFAULT_MAX_FALLBACK_ATTEMPTS, 'number');
      assert.ok(DEFAULT_MAX_FALLBACK_ATTEMPTS > 0);
    });

    test('is 3', () => {
      assert.equal(DEFAULT_MAX_FALLBACK_ATTEMPTS, 3);
    });
  });

  describe('getProviderCapabilities()', () => {
    test('returns capabilities for known providers', () => {
      const caps = getProviderCapabilities('anthropic');
      assert.ok(caps);
      assert.equal(caps.streaming, true);
      assert.equal(caps.maxTokens, 200000);
    });

    test('returns null for unknown provider', () => {
      assert.equal(getProviderCapabilities('unknown'), null);
    });

    test('returns null for empty string', () => {
      assert.equal(getProviderCapabilities(''), null);
    });

    test('returns null for null', () => {
      assert.equal(getProviderCapabilities(null), null);
    });

    test('returns null for undefined', () => {
      assert.equal(getProviderCapabilities(undefined), null);
    });

    test('returns null for non-string', () => {
      assert.equal(getProviderCapabilities(42), null);
    });
  });

  describe('hasCapability()', () => {
    test('returns true for supported capability', () => {
      assert.equal(hasCapability('anthropic', 'streaming'), true);
      assert.equal(hasCapability('anthropic', 'tools'), true);
      assert.equal(hasCapability('anthropic', 'vision'), true);
    });

    test('returns false for unsupported capability', () => {
      assert.equal(hasCapability('ollama', 'vision'), false);
    });

    test('returns false for unknown provider', () => {
      assert.equal(hasCapability('unknown', 'streaming'), false);
    });

    test('returns false for null provider', () => {
      assert.equal(hasCapability(null, 'streaming'), false);
    });

    test('returns false for non-boolean capability', () => {
      // maxTokens is a number, not true
      assert.equal(hasCapability('anthropic', 'maxTokens'), false);
    });
  });
});
