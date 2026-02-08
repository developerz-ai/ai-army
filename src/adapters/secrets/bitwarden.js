/**
 * BitwardenAdapter - Bitwarden secret management
 *
 * Provides secret resolution via the Bitwarden Secrets Manager CLI (`bws`).
 * Suitable for teams already using Bitwarden for credential storage.
 *
 * This adapter is a stub. To contribute an implementation, see the
 * secret adapter pattern in src/adapters/secrets/env.js.
 *
 * Planned integration points:
 * - `bws secret get <id>` - Retrieve a secret by its Bitwarden ID
 * - `bws secret list` - List available secrets in a project
 * - Service account token authentication via `BWS_ACCESS_TOKEN`
 *
 * @module BitwardenAdapter
 */

/**
 * Custom error for Bitwarden adapter failures
 */
export class BitwardenAdapterError extends Error {
  /**
   * Create a BitwardenAdapterError
   * @param {string} message - Error message
   * @param {Object} [options] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - Operation that failed
   * @param {string} [options.reason] - Additional context
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'BitwardenAdapterError';
    this.operation = options.operation;
    this.reason = options.reason;
  }
}

/**
 * Bitwarden secret adapter (stub)
 *
 * All methods throw {@link BitwardenAdapterError} until a concrete
 * implementation is provided. See the {@link EnvAdapter} for the
 * expected secret adapter interface.
 *
 * @example
 * const adapter = new BitwardenAdapter();
 * // Throws BitwardenAdapterError - not yet implemented
 * await adapter.initialize({ accessToken: '...' });
 */
export class BitwardenAdapter {
  /**
   * Initialize the Bitwarden adapter
   *
   * @param {Object} _config - Bitwarden adapter configuration
   * @returns {Promise<void>}
   * @throws {BitwardenAdapterError} Always - not yet implemented
   */
  async initialize(_config) {
    throw new BitwardenAdapterError(
      'BitwardenAdapter.initialize() is not implemented. See src/adapters/secrets/env.js for the adapter interface.',
      { operation: 'initialize', reason: 'stub adapter' }
    );
  }

  /**
   * Retrieve a secret by key from Bitwarden
   *
   * @param {string} _key - Secret key or Bitwarden secret ID
   * @returns {Promise<string>} The resolved secret value
   * @throws {BitwardenAdapterError} Always - not yet implemented
   */
  async getSecret(_key) {
    throw new BitwardenAdapterError(
      'BitwardenAdapter.getSecret() is not implemented. See src/adapters/secrets/env.js for the adapter interface.',
      { operation: 'getSecret', reason: 'stub adapter' }
    );
  }
}
