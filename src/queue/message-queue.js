/**
 * MessageQueue - PostgreSQL-backed durable message queue for bot message processing
 *
 * Provides:
 * - Priority-based message enqueuing with PostgreSQL persistence
 * - Safe concurrent dequeue using SELECT ... FOR UPDATE SKIP LOCKED
 * - Queue depth monitoring per bot
 * - Message lifecycle management (pending -> processing -> completed/failed)
 *
 * @module queue/message-queue
 */

/**
 * Valid queue message statuses
 * @type {Readonly<{PENDING: string, PROCESSING: string, COMPLETED: string, FAILED: string}>}
 */
export const MESSAGE_STATUSES = Object.freeze({
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
});

/**
 * Custom error for message queue failures
 */
export class MessageQueueError extends Error {
  /**
   * Create a MessageQueueError
   * @param {string} message - Error message
   * @param {Object} [options] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - The operation that failed
   * @param {string} [options.botId] - Bot ID involved in the operation
   * @param {number} [options.messageId] - Queue message ID involved
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'MessageQueueError';
    this.operation = options.operation;
    this.botId = options.botId;
    this.messageId = options.messageId;
  }
}

/**
 * PostgreSQL-backed message queue for durable, priority-based message processing
 */
export class MessageQueue {
  /**
   * Create a MessageQueue instance
   * @param {Object} storage - PostgresStorage instance with query() and transaction() methods
   * @param {Object} [options] - Configuration options
   * @param {Function} [options.logger] - Optional logging function
   */
  constructor(storage, options = {}) {
    if (!storage) {
      throw new MessageQueueError('Storage is required', {
        operation: 'constructor',
      });
    }

    this.storage = storage;
    this.logger = options.logger || null;
  }

  /**
   * Enqueue a message for a specific bot
   * @param {string} botId - Target bot identifier
   * @param {Object} message - Message to enqueue
   * @param {string} message.channelType - Source channel type ('slack' | 'discord' | 'rest')
   * @param {string} message.channelId - Source channel identifier
   * @param {string} message.userId - User who sent the message
   * @param {string} message.text - Message content
   * @param {string} [message.channelName] - Orchestrator channel name for reply routing
   * @param {string} [message.threadTs] - Thread timestamp for threaded replies
   * @param {number} [priority=0] - Processing priority (higher = processed first)
   * @returns {Promise<Object>} Enqueued message record with id and enqueued_at
   * @throws {MessageQueueError} If enqueue fails
   */
  async enqueue(botId, message, priority = 0) {
    this._validateBotId(botId);
    this._validateMessage(message);
    this._validatePriority(priority);

    try {
      const { rows } = await this.storage.query(
        `INSERT INTO message_queue (bot_id, channel_type, channel_id, user_id, message_text, priority, channel_name, thread_ts)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, bot_id, channel_type, channel_id, user_id, message_text, priority, status, enqueued_at, channel_name, thread_ts`,
        [
          botId,
          message.channelType,
          message.channelId,
          message.userId,
          message.text,
          priority,
          message.channelName || null,
          message.threadTs || null,
        ]
      );

      const record = this._transformRow(rows[0]);
      this._log(`Enqueued message ${record.id} for bot ${botId} with priority ${priority}`);
      return record;
    } catch (err) {
      throw new MessageQueueError(`Failed to enqueue message: ${err.message}`, {
        cause: err,
        operation: 'enqueue',
        botId,
      });
    }
  }

  /**
   * Dequeue the next pending message for a bot using SELECT ... FOR UPDATE SKIP LOCKED
   *
   * Atomically selects the highest-priority, oldest pending message and marks it
   * as processing. Uses SKIP LOCKED to allow safe concurrent dequeue from
   * multiple workers without blocking.
   *
   * @param {string} botId - Bot identifier to dequeue for
   * @returns {Promise<Object|null>} Dequeued message record or null if queue is empty
   * @throws {MessageQueueError} If dequeue fails
   */
  async dequeue(botId) {
    this._validateBotId(botId);

    try {
      const result = await this.storage.transaction(async client => {
        // Select the next pending message, locking it for this transaction.
        // SKIP LOCKED ensures concurrent workers don't block on the same row.
        // ORDER BY priority DESC (highest first), enqueued_at ASC (FIFO within same priority)
        const { rows } = await client.query(
          `SELECT *
           FROM message_queue
           WHERE bot_id = $1 AND status = $2
           ORDER BY priority DESC, enqueued_at ASC
           LIMIT 1
           FOR UPDATE SKIP LOCKED`,
          [botId, MESSAGE_STATUSES.PENDING]
        );

        if (rows.length === 0) {
          return null;
        }

        const row = rows[0];

        // Atomically update status to processing
        const { rows: updatedRows } = await client.query(
          `UPDATE message_queue
           SET status = $1, started_at = NOW()
           WHERE id = $2
           RETURNING *`,
          [MESSAGE_STATUSES.PROCESSING, row.id]
        );

        return updatedRows[0];
      });

      if (!result) {
        return null;
      }

      const record = this._transformRow(result);
      this._log(`Dequeued message ${record.id} for bot ${botId}`);
      return record;
    } catch (err) {
      throw new MessageQueueError(`Failed to dequeue message: ${err.message}`, {
        cause: err,
        operation: 'dequeue',
        botId,
      });
    }
  }

  /**
   * Get the number of pending messages for a bot
   * @param {string} botId - Bot identifier
   * @returns {Promise<number>} Number of pending messages
   * @throws {MessageQueueError} If query fails
   */
  async getQueueDepth(botId) {
    this._validateBotId(botId);

    try {
      const { rows } = await this.storage.query(
        `SELECT COUNT(*)::int AS depth
         FROM message_queue
         WHERE bot_id = $1 AND status = $2`,
        [botId, MESSAGE_STATUSES.PENDING]
      );

      return rows[0].depth;
    } catch (err) {
      throw new MessageQueueError(`Failed to get queue depth: ${err.message}`, {
        cause: err,
        operation: 'getQueueDepth',
        botId,
      });
    }
  }

  /**
   * Clear all pending messages for a bot
   * @param {string} botId - Bot identifier
   * @returns {Promise<number>} Number of messages cleared
   * @throws {MessageQueueError} If clear fails
   */
  async clearQueue(botId) {
    this._validateBotId(botId);

    try {
      const { rowCount } = await this.storage.query(
        `DELETE FROM message_queue
         WHERE bot_id = $1 AND status = $2`,
        [botId, MESSAGE_STATUSES.PENDING]
      );

      this._log(`Cleared ${rowCount} pending messages for bot ${botId}`);
      return rowCount;
    } catch (err) {
      throw new MessageQueueError(`Failed to clear queue: ${err.message}`, {
        cause: err,
        operation: 'clearQueue',
        botId,
      });
    }
  }

  /**
   * Mark a message as completed
   * @param {number} id - Queue message ID
   * @returns {Promise<boolean>} True if message was found and marked completed
   * @throws {MessageQueueError} If update fails
   */
  async markCompleted(id) {
    this._validateId(id);

    try {
      const { rowCount } = await this.storage.query(
        `UPDATE message_queue
         SET status = $1, completed_at = NOW()
         WHERE id = $2 AND status = $3`,
        [MESSAGE_STATUSES.COMPLETED, id, MESSAGE_STATUSES.PROCESSING]
      );

      if (rowCount > 0) {
        this._log(`Marked message ${id} as completed`);
      }
      return rowCount > 0;
    } catch (err) {
      throw new MessageQueueError(`Failed to mark message completed: ${err.message}`, {
        cause: err,
        operation: 'markCompleted',
        messageId: id,
      });
    }
  }

  /**
   * Mark a message as failed with an error message
   * @param {number} id - Queue message ID
   * @param {string|Error} error - Error message or Error object
   * @returns {Promise<boolean>} True if message was found and marked failed
   * @throws {MessageQueueError} If update fails
   */
  async markFailed(id, error) {
    this._validateId(id);

    const errorMessage = error instanceof Error ? error.message : String(error);

    try {
      const { rowCount } = await this.storage.query(
        `UPDATE message_queue
         SET status = $1, completed_at = NOW(), error = $2
         WHERE id = $3 AND status = $4`,
        [MESSAGE_STATUSES.FAILED, errorMessage, id, MESSAGE_STATUSES.PROCESSING]
      );

      if (rowCount > 0) {
        this._log(`Marked message ${id} as failed: ${errorMessage}`);
      }
      return rowCount > 0;
    } catch (err) {
      throw new MessageQueueError(`Failed to mark message failed: ${err.message}`, {
        cause: err,
        operation: 'markFailed',
        messageId: id,
      });
    }
  }

  /**
   * Get queue statistics for a bot (counts by status)
   * @param {string} botId - Bot identifier
   * @returns {Promise<Object>} Stats object with pending, processing, completed, failed counts
   * @throws {MessageQueueError} If query fails
   */
  async getStats(botId) {
    this._validateBotId(botId);

    try {
      const { rows } = await this.storage.query(
        `SELECT status, COUNT(*)::int AS count
         FROM message_queue
         WHERE bot_id = $1
         GROUP BY status`,
        [botId]
      );

      const stats = {
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
      };

      for (const row of rows) {
        stats[row.status] = row.count;
      }

      return stats;
    } catch (err) {
      throw new MessageQueueError(`Failed to get queue stats: ${err.message}`, {
        cause: err,
        operation: 'getStats',
        botId,
      });
    }
  }

  // ============================================================================
  // Validation Helpers
  // ============================================================================

  /**
   * Validate bot ID parameter
   * @param {string} botId - Bot identifier to validate
   * @throws {MessageQueueError} If botId is invalid
   * @private
   */
  _validateBotId(botId) {
    if (!botId || typeof botId !== 'string') {
      throw new MessageQueueError('botId is required and must be a non-empty string', {
        operation: 'validate',
      });
    }
  }

  /**
   * Validate message object for enqueuing
   * @param {Object} message - Message to validate
   * @throws {MessageQueueError} If message is invalid
   * @private
   */
  _validateMessage(message) {
    if (!message || typeof message !== 'object') {
      throw new MessageQueueError('message is required and must be an object', {
        operation: 'validate',
      });
    }

    const required = ['channelType', 'channelId', 'userId', 'text'];
    for (const field of required) {
      if (!message[field] || typeof message[field] !== 'string') {
        throw new MessageQueueError(`message.${field} is required and must be a non-empty string`, {
          operation: 'validate',
        });
      }
    }

    const validChannelTypes = ['slack', 'discord', 'rest'];
    if (!validChannelTypes.includes(message.channelType)) {
      throw new MessageQueueError(
        `message.channelType must be one of: ${validChannelTypes.join(', ')}`,
        { operation: 'validate' }
      );
    }
  }

  /**
   * Validate priority parameter
   * @param {number} priority - Priority to validate
   * @throws {MessageQueueError} If priority is invalid
   * @private
   */
  _validatePriority(priority) {
    if (typeof priority !== 'number' || !Number.isInteger(priority) || priority < 0) {
      throw new MessageQueueError('priority must be a non-negative integer', {
        operation: 'validate',
      });
    }
  }

  /**
   * Validate message ID parameter
   * @param {number} id - Message ID to validate
   * @throws {MessageQueueError} If id is invalid
   * @private
   */
  _validateId(id) {
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
      throw new MessageQueueError('id must be a positive integer', {
        operation: 'validate',
      });
    }
  }

  // ============================================================================
  // Internal Helpers
  // ============================================================================

  /**
   * Transform a database row to a camelCase record
   * @param {Object} row - Raw database row
   * @returns {Object} Transformed record
   * @private
   */
  _transformRow(row) {
    return {
      id: row.id,
      botId: row.bot_id,
      channelType: row.channel_type,
      channelId: row.channel_id,
      userId: row.user_id,
      messageText: row.message_text,
      priority: row.priority,
      status: row.status,
      enqueuedAt: row.enqueued_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      error: row.error,
      channelName: row.channel_name || null,
      threadTs: row.thread_ts || null,
    };
  }

  /**
   * Log a message if logger is available
   * @param {string} message - Message to log
   * @private
   */
  _log(message) {
    if (this.logger) {
      this.logger(`[MessageQueue] ${message}`);
    }
  }
}
