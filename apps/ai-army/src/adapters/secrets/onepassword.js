/**
 * OnePasswordAdapter - 1Password secret management
 *
 * Provides secret resolution via the 1Password CLI (`op`) or
 * 1Password Connect server API.
 * Suitable for teams already using 1Password for credential storage.
 *
 * This adapter is a stub. To contribute an implementation, see the
 * secret adapter pattern in src/adapters/secrets/env.js.
 *
 * Planned integration points:
 * - `op read "op://<vault>/<item>/<field>"` - Retrieve a secret reference
 * - `op item list` - List available items in a vault
 * - Service account token authentication via `OP_SERVICE_ACCOUNT_TOKEN`
 *
 * @module adapters/secrets/onepassword
 */

/**
 * Custom error for 1Password adapter failures
 */
export class OnePasswordAdapterError extends Error {
  /**
   * Create a OnePasswordAdapterError
   * @param {string} message - Error message
   * @param {Object} [options] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - Operation that failed
   * @param {string} [options.reason] - Additional context
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'OnePasswordAdapterError';
    this.operation = options.operation;
    this.reason = options.reason;
  }
}

/**
 * 1Password secret adapter (stub)
 *
 * All methods throw {@link OnePasswordAdapterError} until a concrete
 * implementation is provided. See the {@link EnvAdapter} for the
 * expected secret adapter interface.
 *
 * @example
 * const adapter = new OnePasswordAdapter();
 * // Throws OnePasswordAdapterError - not yet implemented
 * await adapter.initialize({ serviceAccountToken: '...' });
 */
export class OnePasswordAdapter {
  /**
   * Initialize the 1Password adapter
   *
   * @param {Object} _config - 1Password adapter configuration
   * @returns {Promise<void>}
   * @throws {OnePasswordAdapterError} Always - not yet implemented
   */
  async initialize(_config) {
    throw new OnePasswordAdapterError(
      'OnePasswordAdapter.initialize() is not implemented. See src/adapters/secrets/env.js for the adapter interface.',
      { operation: 'initialize', reason: 'stub adapter' }
    );
  }

  /**
   * Retrieve a secret by key from 1Password
   *
   * @param {string} _key - Secret key or 1Password secret reference
   * @returns {Promise<string>} The resolved secret value
   * @throws {OnePasswordAdapterError} Always - not yet implemented
   */
  async getSecret(_key) {
    throw new OnePasswordAdapterError(
      'OnePasswordAdapter.getSecret() is not implemented. See src/adapters/secrets/env.js for the adapter interface.',
      { operation: 'getSecret', reason: 'stub adapter' }
    );
  }
}
