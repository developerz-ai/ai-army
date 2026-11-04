/**
 * ConcurrencyController - In-memory per-bot concurrency limiter for message processing
 *
 * Tracks active message processing per bot using an in-memory Map of Sets.
 * Prevents bots from exceeding their configured maximum concurrent message limit.
 *
 * Thread-safe within a single Node.js process (uses synchronous Map/Set operations).
 * For multi-process deployments, the PostgreSQL row-locking in MessageQueue
 * provides the cross-process coordination.
 *
 * @module queue/concurrency-controller
 */

/**
 * Default maximum concurrent messages per bot
 * @type {number}
 */
const DEFAULT_MAX_CONCURRENT = 3;

/**
 * Custom error for concurrency controller failures
 */
export class ConcurrencyControllerError extends Error {
  /**
   * Create a ConcurrencyControllerError
   * @param {string} message - Error message
   * @param {Object} [options] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - The operation that failed
   * @param {string} [options.botId] - Bot ID involved
   * @param {number} [options.messageId] - Message ID involved
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'ConcurrencyControllerError';
    this.operation = options.operation;
    this.botId = options.botId;
    this.messageId = options.messageId;
  }
}

/**
 * In-memory concurrency controller that tracks active messages per bot
 */
export class ConcurrencyController {
  /**
   * Create a ConcurrencyController instance
   * @param {Object} [options] - Configuration options
   * @param {number} [options.defaultMaxConcurrent=3] - Default max concurrent messages per bot
   * @param {Object} [options.botLimits] - Per-bot concurrency overrides (botId -> maxConcurrent)
   * @param {Function} [options.logger] - Optional logging function
   */
  constructor(options = {}) {
    const {
      defaultMaxConcurrent = DEFAULT_MAX_CONCURRENT,
      botLimits = {},
      logger = null,
    } = options;

    /** @type {Map<string, Set<number>>} Map of botId -> Set of active message IDs */
    this.active = new Map();

    /** @type {number} Default concurrency limit per bot */
    this.defaultMaxConcurrent = defaultMaxConcurrent;

    /** @type {Object} Per-bot concurrency overrides */
    this.botLimits = { ...botLimits };

    /** @type {Function|null} Optional logger */
    this.logger = logger;
  }

  /**
   * Check whether a bot can process another message without exceeding its concurrency limit
   * @param {string} botId - Bot identifier
   * @returns {boolean} True if the bot can accept another message for processing
   */
  canProcess(botId) {
    this._validateBotId(botId);

    const maxConcurrent = this._getMaxConcurrent(botId);
    const currentCount = this.active.get(botId)?.size || 0;
    return currentCount < maxConcurrent;
  }

  /**
   * Register a message as actively being processed by a bot
   * @param {string} botId - Bot identifier
   * @param {number} messageId - Queue message ID being processed
   * @throws {ConcurrencyControllerError} If bot has reached its concurrency limit
   */
  startProcessing(botId, messageId) {
    this._validateBotId(botId);
    this._validateMessageId(messageId);

    const maxConcurrent = this._getMaxConcurrent(botId);
    const activeSet = this.active.get(botId);
    const currentCount = activeSet?.size || 0;

    if (currentCount >= maxConcurrent) {
      throw new ConcurrencyControllerError(
        `Bot ${botId} has reached its concurrency limit of ${maxConcurrent}`,
        { operation: 'startProcessing', botId, messageId }
      );
    }

    if (!activeSet) {
      this.active.set(botId, new Set([messageId]));
    } else {
      activeSet.add(messageId);
    }

    this._log(
      `Started processing message ${messageId} for bot ${botId} ` +
        `(${this.getActiveCount(botId)}/${maxConcurrent})`
    );
  }

  /**
   * Remove a message from a bot's active processing set
   * @param {string} botId - Bot identifier
   * @param {number} messageId - Queue message ID that finished processing
   * @returns {boolean} True if the message was found and removed
   */
  finishProcessing(botId, messageId) {
    this._validateBotId(botId);
    this._validateMessageId(messageId);

    const activeSet = this.active.get(botId);
    if (!activeSet) {
      return false;
    }

    const removed = activeSet.delete(messageId);

    // Clean up empty sets to prevent memory leaks
    if (activeSet.size === 0) {
      this.active.delete(botId);
    }

    if (removed) {
      const maxConcurrent = this._getMaxConcurrent(botId);
      this._log(
        `Finished processing message ${messageId} for bot ${botId} ` +
          `(${this.getActiveCount(botId)}/${maxConcurrent})`
      );
    }

    return removed;
  }

  /**
   * Get the number of messages currently being processed by a bot
   * @param {string} botId - Bot identifier
   * @returns {number} Number of active messages
   */
  getActiveCount(botId) {
    return this.active.get(botId)?.size || 0;
  }

  /**
   * Get the set of active message IDs for a bot
   * @param {string} botId - Bot identifier
   * @returns {Array<number>} Array of active message IDs
   */
  getActiveMessages(botId) {
    const activeSet = this.active.get(botId);
    return activeSet ? [...activeSet] : [];
  }

  /**
   * Set the concurrency limit for a specific bot
   * @param {string} botId - Bot identifier
   * @param {number} maxConcurrent - Maximum concurrent messages
   */
  setBotLimit(botId, maxConcurrent) {
    this._validateBotId(botId);

    if (
      typeof maxConcurrent !== 'number' ||
      !Number.isInteger(maxConcurrent) ||
      maxConcurrent < 1
    ) {
      throw new ConcurrencyControllerError('maxConcurrent must be a positive integer', {
        operation: 'setBotLimit',
        botId,
      });
    }

    this.botLimits[botId] = maxConcurrent;
    this._log(`Set concurrency limit for bot ${botId} to ${maxConcurrent}`);
  }

  /**
   * Reset all active tracking state (useful for shutdown/restart)
   */
  reset() {
    this.active.clear();
    this._log('Reset all active processing state');
  }

  /**
   * Get a summary of all active processing across all bots
   * @returns {Object} Summary with per-bot active counts and total
   */
  getSummary() {
    const bots = {};
    let total = 0;

    for (const [botId, activeSet] of this.active) {
      bots[botId] = {
        active: activeSet.size,
        maxConcurrent: this._getMaxConcurrent(botId),
        messageIds: [...activeSet],
      };
      total += activeSet.size;
    }

    return { bots, total };
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Get the effective concurrency limit for a bot
   * @param {string} botId - Bot identifier
   * @returns {number} Concurrency limit
   * @private
   */
  _getMaxConcurrent(botId) {
    return this.botLimits[botId] || this.defaultMaxConcurrent;
  }

  /**
   * Validate bot ID parameter
   * @param {string} botId - Bot identifier to validate
   * @throws {ConcurrencyControllerError} If botId is invalid
   * @private
   */
  _validateBotId(botId) {
    if (!botId || typeof botId !== 'string') {
      throw new ConcurrencyControllerError('botId is required and must be a non-empty string', {
        operation: 'validate',
      });
    }
  }

  /**
   * Validate message ID parameter
   * @param {number} messageId - Message ID to validate
   * @throws {ConcurrencyControllerError} If messageId is invalid
   * @private
   */
  _validateMessageId(messageId) {
    if (typeof messageId !== 'number' || !Number.isInteger(messageId) || messageId <= 0) {
      throw new ConcurrencyControllerError('messageId must be a positive integer', {
        operation: 'validate',
      });
    }
  }

  /**
   * Log a message if logger is available
   * @param {string} message - Message to log
   * @private
   */
  _log(message) {
    if (this.logger) {
      this.logger(`[ConcurrencyController] ${message}`);
    }
  }
}
