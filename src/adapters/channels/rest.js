/**
 * RESTAdapter - REST API channel for HTTP-based interactions
 *
 * Provides an HTTP REST endpoint for sending and receiving messages.
 * Useful for custom integrations, webhooks, and API-driven bots.
 *
 * This adapter is a stub. To contribute an implementation, see the
 * channel adapter guide in docs/idea/09-channels.md.
 *
 * Expected REST endpoints (planned):
 * - POST /messages - Receive inbound messages
 * - GET  /messages/:sessionId - Poll for responses
 * - POST /messages/:sessionId/send - Send a message to a session
 *
 * @module adapters/channels/rest
 */

/**
 * Custom error for REST adapter failures
 */
export class RESTAdapterError extends Error {
  /**
   * Create a RESTAdapterError
   * @param {string} message - Error message
   * @param {Object} [options] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - Operation that failed
   * @param {string} [options.reason] - Additional context
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'RESTAdapterError';
    this.operation = options.operation;
    this.reason = options.reason;
  }
}

/**
 * REST channel adapter for HTTP-based messaging (stub)
 *
 * All methods throw {@link RESTAdapterError} until a concrete implementation
 * is provided. See docs/idea/09-channels.md for the adapter interface contract.
 *
 * @example
 * const adapter = new RESTAdapter();
 * // Throws RESTAdapterError - not yet implemented
 * await adapter.initialize({ port: 3000 });
 */
export class RESTAdapter {
  /**
   * Initialize the REST adapter
   *
   * @param {Object} _config - REST adapter configuration
   * @returns {Promise<void>}
   * @throws {RESTAdapterError} Always - not yet implemented
   */
  async initialize(_config) {
    throw new RESTAdapterError(
      'RESTAdapter.initialize() is not implemented. See docs/idea/09-channels.md for contributing.',
      { operation: 'initialize', reason: 'stub adapter' }
    );
  }

  /**
   * Send a message to a session via the REST channel
   *
   * @param {string} _sessionId - Target session identifier
   * @param {string} _text - Message text to send
   * @returns {Promise<void>}
   * @throws {RESTAdapterError} Always - not yet implemented
   */
  async sendMessage(_sessionId, _text) {
    throw new RESTAdapterError(
      'RESTAdapter.sendMessage() is not implemented. See docs/idea/09-channels.md for contributing.',
      { operation: 'sendMessage', reason: 'stub adapter' }
    );
  }

  /**
   * Handle an incoming HTTP request
   *
   * @param {Object} _req - HTTP request object
   * @param {Object} _res - HTTP response object
   * @returns {Promise<void>}
   * @throws {RESTAdapterError} Always - not yet implemented
   */
  async handleRequest(_req, _res) {
    throw new RESTAdapterError(
      'RESTAdapter.handleRequest() is not implemented. See docs/idea/09-channels.md for contributing.',
      { operation: 'handleRequest', reason: 'stub adapter' }
    );
  }
}
