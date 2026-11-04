/**
 * SecretCache - TTL-based cache for resolved secrets
 *
 * Caches resolved secret values to reduce repeated calls to
 * external secret managers (Bitwarden, 1Password, etc.).
 * Entries expire after a configurable TTL (default: 5 minutes).
 *
 * @module SecretCache
 */

/**
 * Default time-to-live for cached secrets in milliseconds (5 minutes)
 * @type {number}
 */
const DEFAULT_TTL = 300_000;

/**
 * Cache entry storing a secret value with its creation timestamp
 * @typedef {Object} CacheEntry
 * @property {string} value - The cached secret value
 * @property {number} timestamp - When the entry was stored (Date.now())
 */

/**
 * SecretCache class with TTL-based expiration
 *
 * Provides a simple in-memory cache for secret values. Each entry
 * is stored with a timestamp and automatically expires after the
 * configured TTL. Expired entries are lazily removed on access.
 */
export class SecretCache {
  /**
   * Create a SecretCache instance
   *
   * @param {Object} [options] - Cache configuration options
   * @param {number} [options.ttl=300000] - Time-to-live in milliseconds (default 5 minutes)
   */
  constructor(options = {}) {
    const { ttl = DEFAULT_TTL } = options;

    /** @type {number} */
    this.ttl = ttl;

    /** @type {Map<string, CacheEntry>} */
    this.cache = new Map();
  }

  /**
   * Get a cached secret value
   *
   * Returns the cached value if it exists and has not expired.
   * Expired entries are automatically deleted on access.
   *
   * @param {string} key - The cache key to look up
   * @returns {string|null} The cached value, or null if not found or expired
   */
  get(key) {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.value;
  }

  /**
   * Store a secret value in the cache
   *
   * Overwrites any existing entry for the same key, resetting
   * the TTL countdown.
   *
   * @param {string} key - The cache key
   * @param {string} value - The secret value to cache
   */
  set(key, value) {
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
    });
  }

  /**
   * Check whether a key exists and has not expired
   *
   * @param {string} key - The cache key to check
   * @returns {boolean} True if the key exists and is not expired
   */
  has(key) {
    return this.get(key) !== null;
  }

  /**
   * Remove a specific entry from the cache
   *
   * @param {string} key - The cache key to remove
   * @returns {boolean} True if the entry was found and removed
   */
  delete(key) {
    return this.cache.delete(key);
  }

  /**
   * Remove all entries from the cache
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get the number of entries in the cache (including potentially expired ones)
   *
   * @returns {number} Number of entries in the cache
   */
  get size() {
    return this.cache.size;
  }

  /**
   * Get cache statistics
   *
   * @returns {{ size: number, ttl: number }} Cache stats object
   */
  stats() {
    return {
      size: this.cache.size,
      ttl: this.ttl,
    };
  }
}
