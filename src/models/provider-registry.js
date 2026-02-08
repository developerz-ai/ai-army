/**
 * ProviderRegistry - Registry for managing AI model provider adapters
 *
 * Provides a centralized registry for registering, retrieving, and validating
 * model providers. Built-in providers (anthropic, openai, openrouter, ollama)
 * are registered by default. Custom providers can be added dynamically.
 *
 * @module models/provider-registry
 */

import { PROVIDER_CAPABILITIES } from './capabilities.js';

/**
 * Custom error class for provider registry errors
 */
export class ProviderRegistryError extends Error {
  /**
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {string} [options.provider] - Provider that caused the error
   * @param {Error} [options.cause] - Original error that caused this
   */
  constructor(message, options = {}) {
    super(message);
    this.name = 'ProviderRegistryError';
    this.provider = options.provider;
    this.cause = options.cause;
  }
}

/**
 * Built-in provider type identifiers
 * @type {Readonly<string[]>}
 */
const BUILTIN_PROVIDERS = Object.freeze(['anthropic', 'openai', 'openrouter', 'ollama']);

/**
 * Required fields for a provider configuration
 * @type {Readonly<string[]>}
 */
const REQUIRED_CONFIG_FIELDS = Object.freeze(['type']);

/**
 * Registry for managing AI model provider adapters
 *
 * Maintains a map of provider name to provider configuration and capabilities.
 * Built-in providers are registered on construction with default capabilities.
 *
 * @example
 * const registry = new ProviderRegistry();
 * registry.registerProvider('custom-llm', {
 *   type: 'custom',
 *   createModel: (modelName, config) => { ... },
 * });
 * const provider = registry.getProvider('anthropic');
 */
export class ProviderRegistry {
  /**
   * Create a new ProviderRegistry
   *
   * @param {Object} [options={}] - Registry options
   * @param {boolean} [options.registerBuiltins=true] - Whether to register built-in providers
   */
  constructor(options = {}) {
    const { registerBuiltins = true } = options;

    /** @private */
    this._providers = new Map();

    if (registerBuiltins) {
      this._registerBuiltinProviders();
    }
  }

  /**
   * Register a provider adapter
   *
   * @param {string} name - Unique provider name identifier
   * @param {Object} adapter - Provider adapter configuration
   * @param {string} adapter.type - Provider type ('anthropic', 'openai', 'openrouter', 'ollama', 'custom')
   * @param {Function} [adapter.createModel] - Custom model creation function
   * @param {Object} [adapter.capabilities] - Override capabilities for this provider
   * @throws {ProviderRegistryError} If name is invalid or adapter is missing required fields
   *
   * @example
   * registry.registerProvider('my-openai', {
   *   type: 'openai',
   *   apiKey: 'sk-...',
   *   baseUrl: 'https://custom-endpoint.com/v1',
   * });
   */
  registerProvider(name, adapter) {
    if (!name || typeof name !== 'string') {
      throw new ProviderRegistryError('Provider name is required and must be a non-empty string', {
        provider: name,
      });
    }

    if (!adapter || typeof adapter !== 'object') {
      throw new ProviderRegistryError(
        `Provider adapter is required and must be an object for provider "${name}"`,
        { provider: name }
      );
    }

    if (!adapter.type || typeof adapter.type !== 'string') {
      throw new ProviderRegistryError(
        `Provider adapter must have a "type" field for provider "${name}"`,
        { provider: name }
      );
    }

    const entry = {
      name,
      adapter: { ...adapter },
      capabilities: adapter.capabilities || PROVIDER_CAPABILITIES[adapter.type] || null,
    };

    this._providers.set(name, entry);
  }

  /**
   * Get a registered provider by name
   *
   * @param {string} name - Provider name
   * @returns {Object|null} Provider entry with { name, adapter, capabilities } or null if not found
   *
   * @example
   * const provider = registry.getProvider('anthropic');
   * if (provider) {
   *   console.log(provider.capabilities.streaming); // true
   * }
   */
  getProvider(name) {
    if (!name || typeof name !== 'string') {
      return null;
    }

    const entry = this._providers.get(name);
    if (!entry) {
      return null;
    }

    // Return a defensive copy
    return {
      name: entry.name,
      adapter: { ...entry.adapter },
      capabilities: entry.capabilities ? { ...entry.capabilities } : null,
    };
  }

  /**
   * List all registered provider names
   *
   * @returns {string[]} Array of registered provider names
   *
   * @example
   * const names = registry.listProviders();
   * // ['anthropic', 'openai', 'openrouter', 'ollama']
   */
  listProviders() {
    return [...this._providers.keys()];
  }

  /**
   * Validate a provider configuration object
   *
   * Checks that the configuration has all required fields and valid values
   * for the given provider type.
   *
   * @param {Object} config - Provider configuration to validate
   * @param {string} config.type - Provider type
   * @param {string} [config.apiKey] - API key
   * @param {string} [config.baseUrl] - Base URL
   * @param {string} [config.baseURL] - Alternative base URL field
   * @returns {Object} Validation result { valid: boolean, errors: string[] }
   *
   * @example
   * const result = registry.validateProvider({ type: 'anthropic', apiKey: 'sk-...' });
   * // { valid: true, errors: [] }
   */
  validateProvider(config) {
    const errors = [];

    if (!config || typeof config !== 'object') {
      return { valid: false, errors: ['Provider configuration must be an object'] };
    }

    // Check required fields
    for (const field of REQUIRED_CONFIG_FIELDS) {
      if (!config[field]) {
        errors.push(`Missing required field: "${field}"`);
      }
    }

    // Validate type value
    const validTypes = [...BUILTIN_PROVIDERS, 'google', 'custom'];
    if (config.type && !validTypes.includes(config.type)) {
      errors.push(
        `Invalid provider type: "${config.type}". ` + `Valid types: ${validTypes.join(', ')}`
      );
    }

    // Validate baseUrl/baseURL format if provided
    const baseUrl = config.baseUrl || config.baseURL;
    if (baseUrl && typeof baseUrl === 'string') {
      try {
        new URL(baseUrl);
      } catch (_err) {
        errors.push(`Invalid base URL: "${baseUrl}". Must be a valid URL.`);
      }
    }

    // Provider-specific validation
    if (config.type && !errors.length) {
      const providerErrors = this._validateProviderSpecific(config);
      errors.push(...providerErrors);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Check if a provider is registered
   *
   * @param {string} name - Provider name
   * @returns {boolean} True if provider is registered
   */
  hasProvider(name) {
    return this._providers.has(name);
  }

  /**
   * Remove a registered provider
   *
   * @param {string} name - Provider name to remove
   * @returns {boolean} True if provider was removed, false if not found
   */
  removeProvider(name) {
    return this._providers.delete(name);
  }

  /**
   * Get the number of registered providers
   *
   * @returns {number} Number of registered providers
   */
  get size() {
    return this._providers.size;
  }

  /**
   * Register all built-in providers with their default capabilities
   *
   * @private
   */
  _registerBuiltinProviders() {
    for (const providerName of BUILTIN_PROVIDERS) {
      this._providers.set(providerName, {
        name: providerName,
        adapter: { type: providerName },
        capabilities: PROVIDER_CAPABILITIES[providerName] || null,
      });
    }
  }

  /**
   * Perform provider-specific validation
   *
   * @private
   * @param {Object} config - Provider configuration
   * @returns {string[]} Array of error messages
   */
  _validateProviderSpecific(config) {
    const errors = [];

    switch (config.type) {
      case 'anthropic':
      case 'openai':
      case 'openrouter':
        // These providers require an API key (unless using env vars)
        // We only warn, not error, since env vars can provide the key at runtime
        break;

      case 'ollama':
        // Ollama doesn't require an API key but needs a valid base URL if provided
        break;

      case 'custom':
        // Custom providers should have a createModel function or be validated externally
        break;

      /* c8 ignore next 2 */
      default:
        break;
    }

    return errors;
  }
}
