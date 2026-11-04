/**
 * WebhookManager - Manages webhook subscriptions and queues deliveries for bot events
 *
 * Provides:
 * - Per-bot webhook configuration management
 * - Event-to-webhook matching based on subscription configs
 * - Webhook delivery enqueuing into PostgreSQL for reliable delivery
 * - Delivery history retrieval and manual retry support
 * - Integration with BotEventEmitter for automatic event forwarding
 *
 * @module webhooks/webhook-manager
 */

import { BotEventEmitter } from '../core/event-emitter.js';

/**
 * Valid webhook delivery statuses
 * @type {Readonly<{PENDING: string, SENDING: string, SUCCESS: string, FAILED: string}>}
 */
export const WEBHOOK_STATUSES = Object.freeze({
  PENDING: 'pending',
  SENDING: 'sending',
  SUCCESS: 'success',
  FAILED: 'failed',
});

/**
 * Custom error for webhook manager failures
 */
export class WebhookManagerError extends Error {
  /**
   * Create a WebhookManagerError
   * @param {string} message - Error message
   * @param {Object} [options] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - The operation that failed
   * @param {string} [options.botId] - Bot ID involved in the operation
   * @param {number} [options.webhookId] - Webhook delivery ID involved
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'WebhookManagerError';
    this.operation = options.operation;
    this.botId = options.botId;
    this.webhookId = options.webhookId;
  }
}

/**
 * WebhookManager - queues webhook deliveries when bot events fire
 *
 * @example
 * const manager = new WebhookManager(storage, {
 *   eventEmitter: botEventEmitter,
 * });
 *
 * // Configure webhooks for a bot
 * manager.configure('work-bot', [
 *   { url: 'https://api.example.com/events', events: ['message.sent'] },
 * ]);
 *
 * // Events from the emitter will be automatically queued for delivery
 */
export class WebhookManager {
  /**
   * Create a WebhookManager instance
   *
   * @param {Object} storage - PostgresStorage instance with query() and transaction() methods
   * @param {Object} [options={}] - Configuration options
   * @param {Object} [options.eventEmitter] - BotEventEmitter instance for automatic event forwarding
   * @param {Function|null} [options.logger=null] - Optional logging function
   */
  constructor(storage, options = {}) {
    if (!storage) {
      throw new WebhookManagerError('Storage is required', {
        operation: 'constructor',
      });
    }

    /** @type {Object} PostgresStorage instance */
    this.storage = storage;

    /** @type {Object|null} BotEventEmitter instance */
    this.eventEmitter = options.eventEmitter || null;

    /** @type {Function|null} Logger function */
    this.logger = options.logger || null;

    /**
     * In-memory webhook configs per bot
     * @type {Map<string, Array<Object>>}
     * @private
     */
    this._configs = new Map();

    // Wire up event emitter if provided
    if (this.eventEmitter) {
      this._bindEventEmitter();
    }
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Queue a webhook delivery for a bot event
   *
   * Matches the event against the bot's webhook subscriptions and inserts
   * a delivery record into the webhooks table for each matching subscription.
   *
   * @param {string} botId - Bot identifier that triggered the event
   * @param {string} event - Event type (e.g. 'message.sent', 'bot.started')
   * @param {Object} payload - Event payload to deliver
   * @returns {Promise<Array<Object>>} Array of created webhook delivery records
   * @throws {WebhookManagerError} If botId or event is invalid, or database insert fails
   */
  async send(botId, event, payload) {
    this._validateBotId(botId);
    this._validateEvent(event);

    const configs = this._configs.get(botId) || [];
    const matchingConfigs = configs.filter(c => c.events.includes(event));

    if (matchingConfigs.length === 0) {
      this._log(`No webhook subscriptions for bot ${botId} event ${event}`);
      return [];
    }

    const results = [];

    for (const config of matchingConfigs) {
      try {
        const record = await this._insertWebhook({
          botId,
          event,
          url: config.url,
          method: config.method || 'POST',
          headers: config.headers || {},
          payload,
          maxAttempts: config.retries || 3,
        });
        results.push(record);
        this._log(`Queued webhook ${record.id} for bot ${botId} event ${event} -> ${config.url}`);
      } catch (err) {
        this._log(
          `Failed to queue webhook for bot ${botId} event ${event} -> ${config.url}: ${err.message}`
        );
        throw new WebhookManagerError(`Failed to queue webhook delivery: ${err.message}`, {
          cause: err,
          operation: 'send',
          botId,
        });
      }
    }

    return results;
  }

  /**
   * Retry a failed webhook delivery
   *
   * Resets the webhook status to 'pending' and clears the attempt counter
   * so the worker will pick it up for re-delivery.
   *
   * @param {number} webhookId - Webhook delivery ID to retry
   * @returns {Promise<boolean>} True if the webhook was found and reset for retry
   * @throws {WebhookManagerError} If webhookId is invalid or update fails
   */
  async retry(webhookId) {
    this._validateWebhookId(webhookId);

    try {
      const { rowCount } = await this.storage.query(
        `UPDATE webhooks
         SET status = $1, attempts = 0, error = NULL,
             response_code = NULL, response_body = NULL,
             last_attempt_at = NULL
         WHERE id = $2 AND status = $3`,
        [WEBHOOK_STATUSES.PENDING, webhookId, WEBHOOK_STATUSES.FAILED]
      );

      if (rowCount > 0) {
        this._log(`Reset webhook ${webhookId} for retry`);
      }
      return rowCount > 0;
    } catch (err) {
      throw new WebhookManagerError(`Failed to retry webhook: ${err.message}`, {
        cause: err,
        operation: 'retry',
        webhookId,
      });
    }
  }

  /**
   * Get webhook delivery history for a bot
   *
   * @param {string} botId - Bot identifier
   * @param {number} [limit=50] - Maximum number of records to return
   * @returns {Promise<Array<Object>>} Array of webhook delivery records (newest first)
   * @throws {WebhookManagerError} If botId is invalid or query fails
   */
  async getHistory(botId, limit = 50) {
    this._validateBotId(botId);

    try {
      const { rows } = await this.storage.query(
        `SELECT * FROM webhooks
         WHERE bot_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [botId, limit]
      );

      return rows.map(row => this._transformRow(row));
    } catch (err) {
      throw new WebhookManagerError(`Failed to get webhook history: ${err.message}`, {
        cause: err,
        operation: 'getHistory',
        botId,
      });
    }
  }

  /**
   * Configure webhook subscriptions for a bot
   *
   * Replaces any existing webhook configuration for the bot with the new
   * subscription list. Each subscription specifies a URL, events to listen
   * for, and optional delivery settings.
   *
   * @param {string} botId - Bot identifier
   * @param {Array<Object>} webhookConfigs - Array of webhook subscription objects
   * @param {string} webhookConfigs[].url - Destination URL
   * @param {Array<string>} webhookConfigs[].events - Event types to subscribe to
   * @param {string} [webhookConfigs[].method='POST'] - HTTP method
   * @param {Object} [webhookConfigs[].headers={}] - Request headers
   * @param {number} [webhookConfigs[].retries=3] - Maximum retry attempts
   * @param {number} [webhookConfigs[].timeout=5000] - Request timeout in ms
   */
  configure(botId, webhookConfigs) {
    this._validateBotId(botId);

    if (!Array.isArray(webhookConfigs)) {
      throw new WebhookManagerError('webhookConfigs must be an array', {
        operation: 'configure',
        botId,
      });
    }

    // Normalize configs with defaults
    const normalized = webhookConfigs.map(config => ({
      url: config.url,
      events: config.events || [],
      method: config.method || 'POST',
      headers: config.headers || {},
      retries: config.retries ?? 3,
      timeout: config.timeout ?? 5000,
    }));

    this._configs.set(botId, normalized);
    this._log(`Configured ${normalized.length} webhook(s) for bot ${botId}`);
  }

  /**
   * Get the current webhook configuration for a bot
   *
   * @param {string} botId - Bot identifier
   * @returns {Array<Object>} Array of webhook subscription configs (empty if none)
   */
  getConfig(botId) {
    return this._configs.get(botId) || [];
  }

  /**
   * Remove all webhook configurations for a bot
   *
   * @param {string} botId - Bot identifier
   */
  removeConfig(botId) {
    this._configs.delete(botId);
    this._log(`Removed webhook configuration for bot ${botId}`);
  }

  // ==========================================================================
  // Event Emitter Integration
  // ==========================================================================

  /**
   * Bind to all BotEventEmitter events for automatic webhook forwarding
   *
   * Listens to all valid bot events and queues webhook deliveries for each
   * event that matches a bot's webhook subscriptions.
   *
   * @private
   */
  _bindEventEmitter() {
    const eventNames = BotEventEmitter.getEventNames();

    for (const eventName of eventNames) {
      this.eventEmitter.on(eventName, async payload => {
        const botId = payload.bot?.id;
        if (!botId) {
          return;
        }

        try {
          await this.send(botId, eventName, payload);
        } catch (err) {
          this._log(
            `Failed to forward event ${eventName} for bot ${botId} to webhooks: ${err.message}`
          );
        }
      });
    }

    this._log('Bound to BotEventEmitter for automatic webhook forwarding');
  }

  // ==========================================================================
  // Database Helpers
  // ==========================================================================

  /**
   * Insert a webhook delivery record into the database
   *
   * @param {Object} webhook - Webhook data to insert
   * @param {string} webhook.botId - Bot identifier
   * @param {string} webhook.event - Event type
   * @param {string} webhook.url - Destination URL
   * @param {string} webhook.method - HTTP method
   * @param {Object} webhook.headers - Request headers
   * @param {Object} webhook.payload - Request body payload
   * @param {number} webhook.maxAttempts - Maximum delivery attempts
   * @returns {Promise<Object>} Inserted webhook record
   * @private
   */
  async _insertWebhook(webhook) {
    const { rows } = await this.storage.query(
      `INSERT INTO webhooks (bot_id, event, url, method, headers, payload, max_attempts)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        webhook.botId,
        webhook.event,
        webhook.url,
        webhook.method,
        JSON.stringify(webhook.headers),
        JSON.stringify(webhook.payload),
        webhook.maxAttempts,
      ]
    );

    return this._transformRow(rows[0]);
  }

  /**
   * Transform a database row to a camelCase record
   *
   * @param {Object} row - Raw database row
   * @returns {Object} Transformed record
   * @private
   */
  _transformRow(row) {
    return {
      id: row.id,
      botId: row.bot_id,
      event: row.event,
      url: row.url,
      method: row.method,
      headers: row.headers || {},
      payload: row.payload,
      status: row.status,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      lastAttemptAt: row.last_attempt_at,
      responseCode: row.response_code,
      responseBody: row.response_body,
      error: row.error,
      createdAt: row.created_at,
    };
  }

  // ==========================================================================
  // Validation Helpers
  // ==========================================================================

  /**
   * Validate bot ID parameter
   * @param {string} botId - Bot identifier to validate
   * @throws {WebhookManagerError} If botId is invalid
   * @private
   */
  _validateBotId(botId) {
    if (!botId || typeof botId !== 'string') {
      throw new WebhookManagerError('botId is required and must be a non-empty string', {
        operation: 'validate',
      });
    }
  }

  /**
   * Validate event name parameter
   * @param {string} event - Event name to validate
   * @throws {WebhookManagerError} If event is invalid
   * @private
   */
  _validateEvent(event) {
    if (!event || typeof event !== 'string') {
      throw new WebhookManagerError('event is required and must be a non-empty string', {
        operation: 'validate',
      });
    }
  }

  /**
   * Validate webhook ID parameter
   * @param {number} webhookId - Webhook ID to validate
   * @throws {WebhookManagerError} If webhookId is invalid
   * @private
   */
  _validateWebhookId(webhookId) {
    if (typeof webhookId !== 'number' || !Number.isInteger(webhookId) || webhookId <= 0) {
      throw new WebhookManagerError('webhookId must be a positive integer', {
        operation: 'validate',
      });
    }
  }

  // ==========================================================================
  // Internal Helpers
  // ==========================================================================

  /**
   * Log a message if logger is available
   * @param {string} message - Message to log
   * @private
   */
  _log(message) {
    if (this.logger) {
      this.logger(`[WebhookManager] ${message}`);
    }
  }
}
