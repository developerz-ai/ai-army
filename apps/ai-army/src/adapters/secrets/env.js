/**
 * EnvAdapter - Environment variable secret management
 *
 * Provides simple environment variable-based secret resolution.
 * Suitable for local development and single-server deployments.
 *
 * Supports three variable patterns:
 * - ${VAR} - Required variable, throws if not set
 * - ${VAR:-default} - Use default value if VAR is not set or empty
 * - ${VAR:+value} - Use value only if VAR is set and non-empty
 *
 * @module EnvAdapter
 */

/**
 * Custom error for environment variable resolution failures
 */
export class EnvAdapterError extends Error {
  /**
   * Create an EnvAdapterError
   * @param {string} message - Error message
   * @param {Object} [options] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.variableName] - Name of the environment variable
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'EnvAdapterError';
    this.variableName = options.variableName;
  }
}

/**
 * Environment adapter class for secret resolution
 *
 * This adapter resolves secrets from process.env environment variables.
 * It is the default and simplest secret provider, suitable for development
 * and single-server deployments.
 */
export class EnvAdapter {
  /**
   * Create an EnvAdapter instance
   */
  constructor() {
    this.initialized = false;
  }

  /**
   * Initialize the adapter (mostly a no-op for env adapter)
   *
   * For environment variables, initialization just validates that
   * we can access process.env and prepares for secret resolution.
   *
   * @param {Object} [_config] - Configuration object (unused for env adapter)
   * @returns {Promise<void>}
   * @throws {EnvAdapterError} - If initialization fails
   */
  async initialize(_config) {
    try {
      // Validate that process.env is accessible
      if (typeof process.env !== 'object') {
        throw new Error('process.env is not accessible');
      }
      this.initialized = true;
    } catch (err) {
      throw new EnvAdapterError('Failed to initialize environment adapter', {
        cause: err,
      });
    }
  }

  /**
   * Resolve a single environment variable
   *
   * Supports patterns:
   * - `key` - Simple variable name, returns value or throws
   * - `key:-default` - Variable with default value
   * - `key:+value` - Variable with conditional value
   *
   * @param {string} key - Variable name or expression (e.g., "MY_VAR" or "MY_VAR:-default")
   * @returns {Promise<string|null>} - Resolved secret value or null if not found
   * @throws {EnvAdapterError} - If a required variable is not set
   */
  async getSecret(key) {
    if (!this.initialized) {
      throw new EnvAdapterError('EnvAdapter not initialized. Call initialize() first');
    }

    if (!key || typeof key !== 'string') {
      throw new EnvAdapterError('Invalid variable name', {
        variableName: key,
      });
    }

    // Parse the key for patterns: VAR, VAR:-default, VAR:+value
    const defaultPattern = /^([^:]+):-(.*)$/;
    const setPattern = /^([^:]+):\+(.*)$/;

    const defaultMatch = key.match(defaultPattern);
    const setMatch = key.match(setPattern);

    let varName;
    let defaultValue;
    let setValue;

    if (defaultMatch) {
      [, varName, defaultValue] = defaultMatch;
    } else if (setMatch) {
      [, varName, setValue] = setMatch;
    } else {
      varName = key;
    }

    const envValue = process.env[varName];
    const hasValue = envValue !== undefined && envValue !== '';

    // Handle ${VAR:-default} pattern
    if (defaultValue !== undefined) {
      return hasValue ? envValue : defaultValue;
    }

    // Handle ${VAR:+value} pattern
    if (setValue !== undefined) {
      return hasValue ? setValue : '';
    }

    // Handle ${VAR} pattern - required, error if not set
    if (!hasValue) {
      throw new EnvAdapterError(`Required environment variable '${varName}' is not set`, {
        variableName: varName,
      });
    }

    return envValue;
  }

  /**
   * Check if a secret exists without raising an error
   *
   * @param {string} key - Variable name to check
   * @returns {Promise<boolean>} - True if variable is set and non-empty
   */
  async hasSecret(key) {
    if (!this.initialized) {
      return false;
    }

    // Parse the key for variable name
    const match = key.match(/^([^:]+)/);
    const varName = match ? match[1] : key;

    const envValue = process.env[varName];
    return envValue !== undefined && envValue !== '';
  }

  /**
   * Get all available environment variable names that are set
   *
   * @returns {Promise<string[]>} - Array of environment variable names
   */
  async listSecrets() {
    if (!this.initialized) {
      throw new EnvAdapterError('EnvAdapter not initialized. Call initialize() first');
    }

    return Object.keys(process.env).filter(key => process.env[key] !== undefined);
  }
}

export default EnvAdapter;
