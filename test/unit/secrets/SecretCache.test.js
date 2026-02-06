/**
 * SecretCache Tests
 *
 * Tests for TTL-based secret caching
 */

import { strict as assert } from 'assert';
import { describe, it, beforeEach } from 'node:test';
import { SecretCache } from '../../../src/secrets/secret-cache.js';

describe('SecretCache', () => {
  let cache;

  beforeEach(() => {
    cache = new SecretCache();
  });

  describe('constructor', () => {
    it('should create cache with default TTL of 5 minutes', () => {
      const c = new SecretCache();
      assert.equal(c.ttl, 300_000);
    });

    it('should accept custom TTL', () => {
      const c = new SecretCache({ ttl: 60_000 });
      assert.equal(c.ttl, 60_000);
    });

    it('should start with empty cache', () => {
      assert.equal(cache.size, 0);
    });
  });

  describe('set and get', () => {
    it('should store and retrieve a value', () => {
      cache.set('key1', 'secret-value');
      assert.equal(cache.get('key1'), 'secret-value');
    });

    it('should return null for missing key', () => {
      assert.equal(cache.get('nonexistent'), null);
    });

    it('should overwrite existing value', () => {
      cache.set('key1', 'value1');
      cache.set('key1', 'value2');
      assert.equal(cache.get('key1'), 'value2');
    });

    it('should handle empty string values', () => {
      cache.set('key1', '');
      assert.equal(cache.get('key1'), '');
    });

    it('should handle long values', () => {
      const longValue = 'x'.repeat(10_000);
      cache.set('key1', longValue);
      assert.equal(cache.get('key1'), longValue);
    });
  });

  describe('TTL expiration', () => {
    it('should return null for expired entries', () => {
      const shortCache = new SecretCache({ ttl: 50 });

      // Manually create a cache entry with an old timestamp
      shortCache.cache.set('key1', {
        value: 'value',
        timestamp: Date.now() - 200,
      });

      assert.equal(shortCache.get('key1'), null);
    });

    it('should delete expired entries on access', () => {
      cache = new SecretCache({ ttl: 1 });

      // Set an entry with an old timestamp
      cache.cache.set('key1', {
        value: 'old-value',
        timestamp: Date.now() - 100,
      });

      assert.equal(cache.get('key1'), null);
      assert.equal(cache.cache.has('key1'), false);
    });

    it('should return valid entries within TTL', () => {
      cache.set('key1', 'fresh-value');
      assert.equal(cache.get('key1'), 'fresh-value');
    });
  });

  describe('has', () => {
    it('should return true for existing non-expired key', () => {
      cache.set('key1', 'value');
      assert.equal(cache.has('key1'), true);
    });

    it('should return false for missing key', () => {
      assert.equal(cache.has('missing'), false);
    });

    it('should return false for expired key', () => {
      cache = new SecretCache({ ttl: 1 });
      cache.cache.set('key1', {
        value: 'value',
        timestamp: Date.now() - 100,
      });
      assert.equal(cache.has('key1'), false);
    });
  });

  describe('delete', () => {
    it('should remove existing entry', () => {
      cache.set('key1', 'value');
      const result = cache.delete('key1');
      assert.equal(result, true);
      assert.equal(cache.get('key1'), null);
    });

    it('should return false for missing key', () => {
      const result = cache.delete('nonexistent');
      assert.equal(result, false);
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');
      cache.clear();
      assert.equal(cache.size, 0);
      assert.equal(cache.get('key1'), null);
    });
  });

  describe('size', () => {
    it('should reflect number of entries', () => {
      assert.equal(cache.size, 0);
      cache.set('key1', 'value1');
      assert.equal(cache.size, 1);
      cache.set('key2', 'value2');
      assert.equal(cache.size, 2);
    });

    it('should not double-count overwrites', () => {
      cache.set('key1', 'v1');
      cache.set('key1', 'v2');
      assert.equal(cache.size, 1);
    });
  });

  describe('stats', () => {
    it('should return size and TTL', () => {
      cache.set('key1', 'value');
      const stats = cache.stats();
      assert.equal(stats.size, 1);
      assert.equal(stats.ttl, 300_000);
    });

    it('should reflect custom TTL', () => {
      const customCache = new SecretCache({ ttl: 60_000 });
      const stats = customCache.stats();
      assert.equal(stats.ttl, 60_000);
    });
  });
});
