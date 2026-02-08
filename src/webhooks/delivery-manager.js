/**
 * DeliveryManager - HTTP webhook delivery with exponential backoff retry
 *
 * Provides:
 * - HTTP delivery using the built-in fetch() API
 * - Configurable request timeout via AbortController
 * - Exponential backoff retry scheduling
 * - Response and error logging to the database
 * - Content-Type header injection for JSON payloads
 *
 * @module webhooks/delivery-manager
 */

import { WEBHOOK_STATUSES } from './webhook-manager.js';

/**
 * Default delivery configuration
 * @type {Readonly<Object>}
 */
const DEFAULTS = Object.freeze({
  /** Default request timeout in milliseconds */
  timeout: 5000,
  /** Maximum backoff delay in milliseconds (60 seconds) */
  maxBackoffDelay: 60000,
  /** Base backoff delay in milliseconds */
  baseBackoffDelay: 1000,
});

/**
 * Custom error for delivery failures
 */
export class DeliveryError extends Error {
  /**
   * Create a DeliveryError
   * @param {string} message - Error message
   * @param {Object} [options] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - The operation that failed
   * @param {number} [options.webhookId] - Webhook delivery ID involved
   * @param {number} [options.statusCode] - HTTP response status code
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'DeliveryError';
    this.operation = options.operation;
    this.webhookId = options.webhookId;
    this.statusCode = options.statusCode;
  }
}

/**
 * DeliveryManager - delivers webhooks via HTTP and manages retry logic
 *
 * @example
 * const deliveryManager = new DeliveryManager(storage, {
 *   timeout: 5000,
 * });
 *
 * const result = await deliveryManager.deliver({
 *   id: 1,
 *   url: 'https://api.example.com/webhook',
 *   method: 'POST',
 *   headers: { Authorization: 'Bearer token' },
 *   payload: { event: 'message.sent', bot: { id: 'work-bot' } },
 *   attempts: 0,
 *   maxAttempts: 3,
 * });
 */
export class DeliveryManager {
  /**
   * Create a DeliveryManager instance
   *
   * @param {Object} storage - PostgresStorage instance with query() method
   * @param {Object} [options={}] - Configuration options
   * @param {number} [options.timeout=5000] - Default request timeout in milliseconds
   * @param {number} [options.maxBackoffDelay=60000] - Maximum backoff delay in milliseconds
   * @param {number} [options.baseBackoffDelay=1000] - Base backoff delay in milliseconds
   * @param {Function|null} [options.logger=null] - Optional logging function
   * @param {Function} [options.fetchFn=fetch] - HTTP fetch function (for testing)
   */
  constructor(storage, options = {}) {
    if (!storage) {
      throw new DeliveryError('Storage is required', {
        operation: 'constructor',
      });
    }

    /** @type {Object} PostgresStorage instance */
    this.storage = storage;

    /** @type {number} Default request timeout in ms */
    this.timeout = options.timeout ?? DEFAULTS.timeout;

    /** @type {number} Maximum backoff delay in ms */
    this.maxBackoffDelay = options.maxBackoffDelay ?? DEFAULTS.maxBackoffDelay;

    /** @type {number} Base backoff delay in ms */
    this.baseBackoffDelay = options.baseBackoffDelay ?? DEFAULTS.baseBackoffDelay;

    /** @type {Function|null} Logger function */
    this.logger = options.logger || null;

    /** @type {Function} HTTP fetch function */
    this.fetchFn = options.fetchFn || globalThis.fetch;
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Deliver a webhook via HTTP
   *
   * Marks the webhook as 'sending', performs the HTTP request, and updates
   * the delivery record with the response or error. On success (2xx response),
   * marks as 'success'. On failure, either schedules a retry or marks as 'failed'
   * if max attempts are exhausted.
   *
   * @param {Object} webhook - Webhook delivery record from the database
   * @param {number} webhook.id - Webhook delivery ID
   * @param {string} webhook.url - Destination URL
   * @param {string} webhook.method - HTTP method
   * @param {Object} webhook.headers - Request headers
   * @param {Object} webhook.payload - Request body payload
   * @param {number} webhook.attempts - Current attempt count
   * @param {number} webhook.maxAttempts - Maximum delivery attempts
   * @returns {Promise<Object>} Delivery result with status, responseCode, and error
   * @throws {DeliveryError} If the delivery process itself fails unexpectedly
   */
  async deliver(webhook) {
    const { id } = webhook;
    const attempt = webhook.attempts + 1;

    this._log(`Delivering webhook ${id} (attempt ${attempt}/${webhook.maxAttempts})`);

    // Mark as sending
    await this._updateStatus(id, WEBHOOK_STATUSES.SENDING, { attempts: attempt });

    try {
      const { responseCode, responseBody } = await this._executeRequest(webhook);

      if (responseCode >= 200 && responseCode < 300) {
        // Success
        await this._updateStatus(id, WEBHOOK_STATUSES.SUCCESS, {
          attempts: attempt,
          responseCode,
          responseBody: this._truncateBody(responseBody),
        });

        this._log(`Webhook ${id} delivered successfully (HTTP ${responseCode})`);
        return { status: WEBHOOK_STATUSES.SUCCESS, responseCode, error: null };
      }

      // Non-2xx response — treat as failure
      const errorMessage = `HTTP ${responseCode}`;
      return this._handleFailure(webhook, attempt, errorMessage, responseCode, responseBody);
    } catch (err) {
      // Network/timeout error
      const errorMessage = err.name === 'AbortError' ? 'Request timeout' : err.message;
      return this._handleFailure(webhook, attempt, errorMessage, null, null);
    }
  }

  /**
   * Calculate the backoff delay for a given attempt number
   *
   * Uses exponential backoff: delay = min(base * 2^attempt, maxDelay)
   *
   * @param {number} attempt - Current attempt number (1-based)
   * @returns {number} Delay in milliseconds
   */
  calculateBackoff(attempt) {
    const delay = this.baseBackoffDelay * Math.pow(2, attempt - 1);
    return Math.min(delay, this.maxBackoffDelay);
  }

  // ==========================================================================
  // HTTP Request Execution
  // ==========================================================================

  /**
   * Execute the HTTP request for a webhook delivery
   *
   * @param {Object} webhook - Webhook delivery record
   * @returns {Promise<{responseCode: number, responseBody: string}>} Response details
   * @private
   */
  async _executeRequest(webhook) {
    const headers = {
      'Content-Type': 'application/json',
      ...webhook.headers,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await this.fetchFn(webhook.url, {
        method: webhook.method,
        headers,
        body: JSON.stringify(webhook.payload),
        signal: controller.signal,
      });

      const responseBody = await response.text();
      return { responseCode: response.status, responseBody };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ==========================================================================
  // Failure Handling
  // ==========================================================================

  /**
   * Handle a delivery failure — retry or mark as permanently failed
   *
   * @param {Object} webhook - Webhook delivery record
   * @param {number} attempt - Current attempt number
   * @param {string} errorMessage - Error description
   * @param {number|null} responseCode - HTTP response code (null for network errors)
   * @param {string|null} responseBody - HTTP response body (null for network errors)
   * @returns {Promise<Object>} Delivery result
   * @private
   */
  async _handleFailure(webhook, attempt, errorMessage, responseCode, responseBody) {
    const { id, maxAttempts } = webhook;
    const canRetry = attempt < maxAttempts;

    if (canRetry) {
      const backoff = this.calculateBackoff(attempt);

      await this._updateStatus(id, WEBHOOK_STATUSES.PENDING, {
        attempts: attempt,
        responseCode,
        responseBody: this._truncateBody(responseBody),
        error: errorMessage,
      });

      this._log(
        `Webhook ${id} failed (attempt ${attempt}/${maxAttempts}): ${errorMessage}. ` +
          `Retrying in ${backoff}ms`
      );

      return {
        status: WEBHOOK_STATUSES.PENDING,
        responseCode,
        error: errorMessage,
        retryIn: backoff,
      };
    }

    // Exhausted all retries
    await this._updateStatus(id, WEBHOOK_STATUSES.FAILED, {
      attempts: attempt,
      responseCode,
      responseBody: this._truncateBody(responseBody),
      error: errorMessage,
    });

    this._log(`Webhook ${id} permanently failed after ${attempt} attempts: ${errorMessage}`);

    return { status: WEBHOOK_STATUSES.FAILED, responseCode, error: errorMessage };
  }

  // ==========================================================================
  // Database Helpers
  // ==========================================================================

  /**
   * Update webhook delivery status and metadata in the database
   *
   * @param {number} webhookId - Webhook delivery ID
   * @param {string} status - New status
   * @param {Object} [fields={}] - Additional fields to update
   * @param {number} [fields.attempts] - Updated attempt count
   * @param {number|null} [fields.responseCode] - HTTP response code
   * @param {string|null} [fields.responseBody] - HTTP response body
   * @param {string|null} [fields.error] - Error message
   * @returns {Promise<void>}
   * @private
   */
  async _updateStatus(webhookId, status, fields = {}) {
    try {
      await this.storage.query(
        `UPDATE webhooks
         SET status = $1,
             attempts = COALESCE($2, attempts),
             last_attempt_at = NOW(),
             response_code = COALESCE($3, response_code),
             response_body = COALESCE($4, response_body),
             error = $5
         WHERE id = $6`,
        [
          status,
          fields.attempts ?? null,
          fields.responseCode ?? null,
          fields.responseBody ?? null,
          fields.error ?? null,
          webhookId,
        ]
      );
    } catch (err) {
      this._log(`Failed to update webhook ${webhookId} status to ${status}: ${err.message}`);
      throw new DeliveryError(`Failed to update webhook status: ${err.message}`, {
        cause: err,
        operation: 'updateStatus',
        webhookId,
      });
    }
  }

  // ==========================================================================
  // Internal Helpers
  // ==========================================================================

  /**
   * Truncate response body to prevent storing excessive data
   *
   * @param {string|null} body - Response body
   * @param {number} [maxLength=4096] - Maximum length
   * @returns {string|null} Truncated body or null
   * @private
   */
  _truncateBody(body, maxLength = 4096) {
    if (!body) {
      return null;
    }
    if (body.length <= maxLength) {
      return body;
    }
    return `${body.slice(0, maxLength)}... [truncated]`;
  }

  /**
   * Log a message if logger is available
   * @param {string} message - Message to log
   * @private
   */
  _log(message) {
    if (this.logger) {
      this.logger(`[DeliveryManager] ${message}`);
    }
  }
}
