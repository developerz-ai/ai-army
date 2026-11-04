/**
 * SecretsManager - Central coordinator for secret resolution
 *
 * Routes secret references to the appropriate adapter (env, Bitwarden,
 * 1Password) and resolves all ${...} patterns in configuration objects.
 * Integrates with SecretCache for TTL-based caching of resolved values.
 *
 * @module SecretsManager
 */

import { ReferenceParser } from './reference-parser.js';
import { SecretCache } from './secret-cache.js';

/**
 * Custom error for secrets management failures
 */
export class SecretsManagerError extends Error {
  /**
   * Create a SecretsManagerError
   * @param {string} message - Error message
   * @param {Object} [options] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.adapter] - Name of the adapter that failed
   * @param {string} [options.reference] - The reference string that failed to resolve
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'SecretsManagerError';
    this.adapter = options.adapter;
    this.reference = options.reference;
  }
}

/**
 * SecretsManager class for resolving secret references
 *
 * Manages a registry of secret adapters and resolves configuration
 * values that contain ${...} reference patterns. Each adapter handles
 * a specific secret backend (environment variables, Bitwarden, 1Password).
 *
 * @example
 * ```js
 * const manager = new SecretsManager();
 * manager.registerAdapter('env', new EnvAdapter());
 * manager.registerAdapter('bitwarden', new BitwardenAdapter());
 * await manager.initialize();
 *
 * // Resolve a single reference
 * const value = await manager.resolve('${ANTHROPIC_API_KEY}');
 *
 * // Resolve all references in a config object
 * const resolved = await manager.resolveAll(config);
 * ```
 */
export class SecretsManager {
  /**
   * Create a SecretsManager instance
   *
   * @param {Object} [options] - Manager configuration
   * @param {number} [options.cacheTtl=300000] - Cache TTL in milliseconds (default 5 minutes)
   * @param {boolean} [options.cacheEnabled=true] - Whether to enable secret caching
   */
  constructor(options = {}) {
    const { cacheTtl, cacheEnabled = true } = options;

    /** @type {Map<string, Object>} Map of adapter name to adapter instance */
    this.adapters = new Map();

    /** @type {ReferenceParser} */
    this.parser = new ReferenceParser();

    /** @type {SecretCache|null} */
    this.cache = cacheEnabled ? new SecretCache({ ttl: cacheTtl }) : null;

    /** @type {boolean} */
    this.initialized = false;
  }

  /**
   * Register a secret adapter
   *
   * @param {string} name - Adapter name (e.g., 'env', 'bitwarden', 'onepassword')
   * @param {Object} adapter - Adapter instance with getSecret(key) method
   * @throws {SecretsManagerError} If the adapter name or instance is invalid
   */
  registerAdapter(name, adapter) {
    if (!name || typeof name !== 'string') {
      throw new SecretsManagerError('Adapter name must be a non-empty string');
    }

    if (!adapter || typeof adapter.getSecret !== 'function') {
      throw new SecretsManagerError(`Adapter '${name}' must have a getSecret(key) method`, {
        adapter: name,
      });
    }

    this.adapters.set(name, adapter);
  }

  /**
   * Initialize all registered adapters
   *
   * Calls initialize() on each adapter that has an initialize method.
   * Adapters that fail to initialize are logged but do not prevent
   * other adapters from initializing.
   *
   * @param {Object} [adapterConfigs] - Map of adapter name to config object
   * @returns {Promise<void>}
   * @throws {SecretsManagerError} If no adapters are registered
   */
  async initialize(adapterConfigs = {}) {
    if (this.adapters.size === 0) {
      throw new SecretsManagerError('No adapters registered. Call registerAdapter() first.');
    }

    const errors = [];

    for (const [name, adapter] of this.adapters) {
      if (typeof adapter.initialize === 'function') {
        try {
          const config = adapterConfigs[name];
          await adapter.initialize(config);
        } catch (err) {
          errors.push({ name, error: err });
        }
      }
    }

    this.initialized = true;

    if (errors.length > 0) {
      const names = errors.map(e => e.name).join(', ');
      throw new SecretsManagerError(`Failed to initialize adapter(s): ${names}`, {
        cause: errors[0].error,
      });
    }
  }

  /**
   * Resolve a single secret reference string
   *
   * Parses the reference, determines the adapter, and fetches the secret.
   * If the reference is a plain string (no ${...} pattern), returns it as-is.
   *
   * @param {string} ref - A reference string, e.g., '${ANTHROPIC_API_KEY}' or '${bw:vault/item}'
   * @returns {Promise<string>} The resolved secret value
   * @throws {SecretsManagerError} If resolution fails or adapter is missing
   */
  async resolve(ref) {
    if (typeof ref !== 'string') {
      throw new SecretsManagerError('Reference must be a string', {
        reference: String(ref),
      });
    }

    if (!this.parser.hasReferences(ref)) {
      return ref;
    }

    return this._resolveString(ref);
  }

  /**
   * Recursively resolve all secret references in a configuration object
   *
   * Walks through objects, arrays, and strings, resolving every ${...}
   * reference encountered. Non-string primitives are returned unchanged.
   *
   * @param {*} config - Configuration value to resolve (object, array, string, or primitive)
   * @returns {Promise<*>} The config with all secret references resolved
   * @throws {SecretsManagerError} If any reference fails to resolve
   */
  async resolveAll(config) {
    if (typeof config === 'string') {
      return this._resolveString(config);
    }

    if (Array.isArray(config)) {
      return Promise.all(config.map(item => this.resolveAll(item)));
    }

    if (config !== null && typeof config === 'object') {
      const entries = Object.entries(config);
      const resolved = await Promise.all(
        entries.map(async ([key, value]) => [key, await this.resolveAll(value)])
      );
      return Object.fromEntries(resolved);
    }

    // Return primitives (number, boolean, null) as-is
    return config;
  }

  /**
   * Resolve all ${...} references in a single string
   *
   * Handles strings with multiple embedded references, e.g.,
   * 'https://${USER}:${PASS}@host'. Each reference is independently
   * resolved and the results are spliced back into the string.
   *
   * @private
   * @param {string} str - String containing ${...} references
   * @returns {Promise<string>} String with all references resolved
   * @throws {SecretsManagerError} If any reference fails to resolve
   */
  async _resolveString(str) {
    const references = this.parser.extractReferences(str);

    if (references.length === 0) {
      return str;
    }

    let result = str;

    for (const ref of references) {
      const value = await this._resolveReference(ref);
      result = result.replace(ref.raw, value);
    }

    return result;
  }

  /**
   * Resolve a single parsed reference via the appropriate adapter
   *
   * Checks the cache first, then delegates to the adapter's getSecret method.
   * Results are cached for future lookups.
   *
   * @private
   * @param {import('./reference-parser.js').ParsedReference} ref - Parsed reference
   * @returns {Promise<string>} Resolved secret value
   * @throws {SecretsManagerError} If the adapter is not registered or resolution fails
   */
  async _resolveReference(ref) {
    const cacheKey = `${ref.adapter}:${ref.key}`;

    // Check cache first
    if (this.cache) {
      const cached = this.cache.get(cacheKey);
      if (cached !== null) {
        return cached;
      }
    }

    const adapter = this.adapters.get(ref.adapter);

    if (!adapter) {
      throw new SecretsManagerError(
        `No adapter registered for '${ref.adapter}'. ` +
          `Available adapters: ${[...this.adapters.keys()].join(', ') || 'none'}`,
        { adapter: ref.adapter, reference: ref.raw }
      );
    }

    try {
      // Build the key to pass to the adapter
      const adapterKey = this._buildAdapterKey(ref);
      const value = await adapter.getSecret(adapterKey);

      // Throw if adapter returned null/undefined for a required reference
      // (i.e. no default value was specified via :- syntax)
      if (value === null || value === undefined) {
        if (ref.defaultValue === undefined) {
          throw new Error(`Secret '${ref.raw}' resolved to null`);
        }
        return ref.defaultValue;
      }

      // Cache the resolved value
      if (this.cache) {
        this.cache.set(cacheKey, value);
      }

      return value;
    } catch (err) {
      throw new SecretsManagerError(
        `Failed to resolve secret reference '${ref.raw}' via '${ref.adapter}' adapter`,
        { cause: err, adapter: ref.adapter, reference: ref.raw }
      );
    }
  }

  /**
   * Build the key string to pass to an adapter's getSecret method
   *
   * For env adapter, reconstructs expressions like 'VAR:-default' or 'VAR:+value'.
   * For other adapters, passes the key directly.
   *
   * @private
   * @param {import('./reference-parser.js').ParsedReference} ref - Parsed reference
   * @returns {string} The key to pass to the adapter
   */
  _buildAdapterKey(ref) {
    if (ref.adapter !== 'env') {
      return ref.key;
    }

    // Reconstruct env adapter key with modifiers
    if (ref.defaultValue !== undefined) {
      return `${ref.key}:-${ref.defaultValue}`;
    }

    if (ref.conditionalValue !== undefined) {
      return `${ref.key}:+${ref.conditionalValue}`;
    }

    return ref.key;
  }

  /**
   * Get the list of registered adapter names
   *
   * @returns {string[]} Array of adapter names
   */
  getAdapterNames() {
    return [...this.adapters.keys()];
  }

  /**
   * Get cache statistics (or null if caching is disabled)
   *
   * @returns {{ size: number, ttl: number }|null} Cache stats or null
   */
  getCacheStats() {
    return this.cache ? this.cache.stats() : null;
  }

  /**
   * Clear the secret cache
   */
  clearCache() {
    if (this.cache) {
      this.cache.clear();
    }
  }
}
