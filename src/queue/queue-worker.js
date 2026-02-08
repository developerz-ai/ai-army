/**
 * QueueWorker - Real-time message queue processor with LISTEN/NOTIFY and fallback polling
 *
 * Provides:
 * - Real-time processing via PostgreSQL LISTEN/NOTIFY on the 'message_queue' channel
 * - Dedicated PostgreSQL client for LISTEN (separate from pool queries)
 * - Fallback polling interval (default 5s) to catch missed notifications
 * - Concurrency-aware dequeuing via ConcurrencyController
 * - Exponential backoff retry with configurable attempts and delay
 * - Graceful start/stop lifecycle management
 *
 * Architecture:
 * - On NOTIFY: immediately attempt to dequeue and process for the notified botId
 * - On poll tick: scan all known bots for pending work
 * - Processing: dequeue via MessageQueue, execute via MessageProcessor, mark result
 * - Retry: failed messages are re-enqueued with exponential backoff up to retryAttempts
 *
 * @module queue/queue-worker
 */

import { MESSAGE_STATUSES } from './message-queue.js';

/**
 * Default configuration for QueueWorker
 * @type {Readonly<Object>}
 */
const DEFAULTS = Object.freeze({
  /** Fallback polling interval in milliseconds */
  pollInterval: 5000,
  /** Maximum retry attempts for failed messages */
  retryAttempts: 3,
  /** Base retry delay in milliseconds (doubles on each retry) */
  retryDelay: 5000,
  /** PostgreSQL channel name for LISTEN/NOTIFY */
  channel: 'message_queue',
});

/**
 * Worker lifecycle states
 * @type {Readonly<{STOPPED: string, STARTING: string, RUNNING: string, STOPPING: string}>}
 */
export const WORKER_STATES = Object.freeze({
  STOPPED: 'stopped',
  STARTING: 'starting',
  RUNNING: 'running',
  STOPPING: 'stopping',
});

/**
 * Custom error for queue worker failures
 */
export class QueueWorkerError extends Error {
  /**
   * Create a QueueWorkerError
   * @param {string} message - Error message
   * @param {Object} [options] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - The operation that failed
   * @param {string} [options.botId] - Bot ID involved
   * @param {number} [options.messageId] - Queue message ID involved
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'QueueWorkerError';
    this.operation = options.operation;
    this.botId = options.botId;
    this.messageId = options.messageId;
  }
}

/**
 * QueueWorker - processes messages from the queue using LISTEN/NOTIFY and fallback polling
 *
 * @example
 * const worker = new QueueWorker(messageQueue, messageProcessor, concurrencyController, storage, {
 *   pollInterval: 5000,
 *   retryAttempts: 3,
 *   retryDelay: 5000,
 * });
 * await worker.start();
 * // ... worker processes messages in background ...
 * await worker.stop();
 */
export class QueueWorker {
  /**
   * Create a QueueWorker instance
   * @param {Object} messageQueue - MessageQueue instance for enqueue/dequeue operations
   * @param {Object} messageProcessor - MessageProcessor instance for processing messages
   * @param {Object} concurrencyController - ConcurrencyController for per-bot concurrency limits
   * @param {Object} storage - PostgresStorage instance (must have pool property after connect)
   * @param {Object} [options] - Configuration options
   * @param {number} [options.pollInterval=5000] - Fallback polling interval in milliseconds
   * @param {number} [options.retryAttempts=3] - Maximum retry attempts for failed messages
   * @param {number} [options.retryDelay=5000] - Base retry delay in milliseconds
   * @param {Function} [options.logger] - Optional logging function
   * @param {Function} [options.getBotConfig] - Function to get bot config by ID (botId => config)
   * @param {string} [options.channel='message_queue'] - PostgreSQL LISTEN/NOTIFY channel name
   * @param {Function} [options.getChannelAdapter] - Function to resolve a channel adapter by name
   *   (channelName => adapter). Used to send responses back to originating channels.
   */
  constructor(messageQueue, messageProcessor, concurrencyController, storage, options = {}) {
    if (!messageQueue) {
      throw new QueueWorkerError('messageQueue is required', { operation: 'constructor' });
    }
    if (!messageProcessor) {
      throw new QueueWorkerError('messageProcessor is required', { operation: 'constructor' });
    }
    if (!concurrencyController) {
      throw new QueueWorkerError('concurrencyController is required', {
        operation: 'constructor',
      });
    }
    if (!storage) {
      throw new QueueWorkerError('storage is required', { operation: 'constructor' });
    }

    /** @type {Object} MessageQueue instance */
    this.messageQueue = messageQueue;

    /** @type {Object} MessageProcessor instance */
    this.messageProcessor = messageProcessor;

    /** @type {Object} ConcurrencyController instance */
    this.concurrencyController = concurrencyController;

    /** @type {Object} PostgresStorage instance */
    this.storage = storage;

    /** @type {number} Fallback polling interval in ms */
    this.pollInterval = options.pollInterval ?? DEFAULTS.pollInterval;

    /** @type {number} Maximum retry attempts */
    this.retryAttempts = options.retryAttempts ?? DEFAULTS.retryAttempts;

    /** @type {number} Base retry delay in ms */
    this.retryDelay = options.retryDelay ?? DEFAULTS.retryDelay;

    /** @type {string} PostgreSQL LISTEN/NOTIFY channel name */
    this.channel = options.channel ?? DEFAULTS.channel;

    /** @type {Function|null} Optional logger */
    this.logger = options.logger || null;

    /** @type {Function|null} Function to resolve bot config from botId */
    this.getBotConfig = options.getBotConfig || null;

    /** @type {Function|null} Function to resolve channel adapter by name for reply routing */
    this.getChannelAdapter = options.getChannelAdapter || null;

    /** @type {string} Current worker state */
    this.state = WORKER_STATES.STOPPED;

    /** @type {Object|null} Dedicated PostgreSQL client for LISTEN */
    this._listenClient = null;

    /** @type {Object|null} Polling interval timer reference */
    this._pollTimer = null;

    /** @type {Map<string, number>} Content key -> retry count for in-flight retries */
    this._retryCounts = new Map();

    /** @type {Set<string>} Bot IDs with pending process requests (dedup rapid notifications) */
    this._pendingBotIds = new Set();
  }

  /**
   * Start the queue worker
   *
   * Sets up a dedicated PostgreSQL client with LISTEN on the message_queue channel
   * and starts the fallback polling timer. Both mechanisms trigger processNext().
   *
   * @returns {Promise<void>}
   * @throws {QueueWorkerError} If worker is already running or connection fails
   */
  async start() {
    if (this.state === WORKER_STATES.RUNNING || this.state === WORKER_STATES.STARTING) {
      throw new QueueWorkerError('Worker is already running', { operation: 'start' });
    }

    this.state = WORKER_STATES.STARTING;
    this._log('Starting queue worker...');

    try {
      // Set up dedicated LISTEN client
      await this._setupListenClient();

      // Start fallback polling
      this._startPolling();

      this.state = WORKER_STATES.RUNNING;
      this._log('Queue worker started successfully');
    } catch (err) {
      this.state = WORKER_STATES.STOPPED;
      throw new QueueWorkerError(`Failed to start queue worker: ${err.message}`, {
        cause: err,
        operation: 'start',
      });
    }
  }

  /**
   * Stop the queue worker gracefully
   *
   * Releases the LISTEN client, stops the polling timer, and resets the
   * concurrency controller. Does not wait for in-flight messages to complete.
   *
   * @returns {Promise<void>}
   */
  async stop() {
    if (this.state === WORKER_STATES.STOPPED) {
      return;
    }

    this.state = WORKER_STATES.STOPPING;
    this._log('Stopping queue worker...');

    // Stop polling
    this._stopPolling();

    // Release LISTEN client
    await this._releaseListenClient();

    // Clean up state
    this._retryCounts.clear();
    this._pendingBotIds.clear();

    // Reset concurrency controller to release any held slots
    this.concurrencyController.reset();

    this.state = WORKER_STATES.STOPPED;
    this._log('Queue worker stopped');
  }

  /**
   * Process the next pending message for a specific bot
   *
   * Checks concurrency limits, dequeues the next message, processes it via
   * MessageProcessor, and marks the result. On failure, retries with exponential
   * backoff up to the configured retryAttempts.
   *
   * @param {string} botId - Bot identifier to process for
   * @returns {Promise<boolean>} True if a message was processed, false if queue was empty or at capacity
   */
  async processNext(botId) {
    if (!botId || typeof botId !== 'string') {
      this._log('processNext called with invalid botId, skipping');
      return false;
    }

    if (this.state !== WORKER_STATES.RUNNING) {
      return false;
    }

    // Check concurrency limit
    if (!this.concurrencyController.canProcess(botId)) {
      this._log(`Bot ${botId} at concurrency limit, skipping`);
      return false;
    }

    // Dequeue next message
    let queueMessage;
    try {
      queueMessage = await this.messageQueue.dequeue(botId);
    } catch (err) {
      this._log(`Failed to dequeue for bot ${botId}: ${err.message}`);
      return false;
    }

    if (!queueMessage) {
      return false;
    }

    // Register with concurrency controller
    this.concurrencyController.startProcessing(botId, queueMessage.id);

    this._log(`Processing message ${queueMessage.id} for bot ${botId}`);

    try {
      // Build the message object expected by MessageProcessor
      const processorMessage = {
        type: queueMessage.channelType,
        userId: queueMessage.userId,
        channelId: queueMessage.channelId,
        text: queueMessage.messageText,
      };

      // Resolve bot config
      const botConfig = await this._resolveBotConfig(botId);

      // Process via MessageProcessor
      const result = await this.messageProcessor.processMessage(botConfig, processorMessage);

      // Send response back to the originating channel adapter if routing info is available
      if (result && result.text && queueMessage.channelName && this.getChannelAdapter) {
        try {
          const adapter = this.getChannelAdapter(queueMessage.channelName);
          if (adapter && typeof adapter.sendMessage === 'function') {
            await adapter.sendMessage(queueMessage.channelId, result.text, queueMessage.threadTs);
          }
        } catch (sendErr) {
          this._log(`Failed to send response for message ${queueMessage.id}: ${sendErr.message}`);
        }
      }

      // Mark completed
      await this.messageQueue.markCompleted(queueMessage.id);
      this._log(`Message ${queueMessage.id} completed for bot ${botId}`);

      // Clear retry count on success (both content key and message ID)
      this._retryCounts.delete(this._retryKey(botId, queueMessage));
      this._retryCounts.delete(queueMessage.id);

      return true;
    } catch (err) {
      return this._handleProcessingError(botId, queueMessage, err);
    } finally {
      // Release concurrency slot via macrotask so that the slot remains occupied
      // through the current microtask cycle. This ensures proper concurrency
      // enforcement when multiple processNext calls are chained synchronously.
      const releaseBotId = botId;
      const releaseMessageId = queueMessage.id;
      setTimeout(() => {
        this.concurrencyController.finishProcessing(releaseBotId, releaseMessageId);
      }, 0);
    }
  }

  /**
   * Get the current state of the worker
   * @returns {string} Current worker state
   */
  getState() {
    return this.state;
  }

  /**
   * Get retry count for a specific message
   * @param {number|string} messageIdOrKey - Queue message ID or content key
   * @returns {number} Number of retries attempted
   */
  getRetryCount(messageIdOrKey) {
    return this._retryCounts.get(messageIdOrKey) || 0;
  }

  /**
   * Generate a content-based key for retry tracking
   *
   * Uses botId + userId + channelId + messageText so that retries are tracked
   * across re-enqueued messages (which get new IDs).
   *
   * @param {string} botId - Bot identifier
   * @param {Object} queueMessage - Queue message object
   * @returns {string} Content-based retry key
   */
  _retryKey(botId, queueMessage) {
    return `${botId}:${queueMessage.userId}:${queueMessage.channelId}:${queueMessage.messageText}`;
  }

  // ============================================================================
  // LISTEN/NOTIFY Setup
  // ============================================================================

  /**
   * Set up a dedicated PostgreSQL client for LISTEN/NOTIFY
   *
   * Acquires a client from the storage pool and issues a LISTEN command on
   * the message_queue channel. On notification, triggers processNext() for
   * the notified bot.
   *
   * @returns {Promise<void>}
   * @throws {QueueWorkerError} If LISTEN setup fails
   * @private
   */
  async _setupListenClient() {
    if (!this.storage.pool) {
      throw new QueueWorkerError('Storage pool is not available. Call storage.connect() first.', {
        operation: 'start',
      });
    }

    try {
      this._listenClient = await this.storage.pool.connect();

      // Handle client errors (e.g. connection drops)
      this._listenClient.on('error', err => {
        this._log(`LISTEN client error: ${err.message}`);
        this._handleListenClientError(err);
      });

      // Handle notifications
      this._listenClient.on('notification', msg => {
        this._handleNotification(msg);
      });

      // Start listening
      await this._listenClient.query(`LISTEN ${this.channel}`);
      this._log(`Listening on PostgreSQL channel "${this.channel}"`);
    } catch (err) {
      // Release client if acquired but LISTEN failed
      if (this._listenClient) {
        try {
          this._listenClient.release();
        } catch (_releaseErr) {
          // Ignore release errors during setup failure
        }
        this._listenClient = null;
      }

      throw new QueueWorkerError(`Failed to set up LISTEN client: ${err.message}`, {
        cause: err,
        operation: 'start',
      });
    }
  }

  /**
   * Release the dedicated LISTEN client back to the pool
   * @returns {Promise<void>}
   * @private
   */
  async _releaseListenClient() {
    if (!this._listenClient) {
      return;
    }

    try {
      await this._listenClient.query(`UNLISTEN ${this.channel}`);
    } catch (_err) {
      // Ignore UNLISTEN errors during shutdown
    }

    // Remove event listeners before releasing back to pool to prevent
    // MaxListenersExceededWarning when the client is reused
    if (typeof this._listenClient.removeAllListeners === 'function') {
      this._listenClient.removeAllListeners('notification');
      this._listenClient.removeAllListeners('error');
    }

    try {
      this._listenClient.release();
    } catch (_err) {
      // Ignore release errors during shutdown
    }

    this._listenClient = null;
  }

  /**
   * Handle a PostgreSQL NOTIFY event
   *
   * The notification payload is the bot_id from the trigger.
   * Triggers processNext() for the relevant bot.
   *
   * @param {Object} msg - PostgreSQL notification object
   * @param {string} msg.channel - Channel name
   * @param {string} msg.payload - Notification payload (botId)
   * @private
   */
  _handleNotification(msg) {
    if (msg.channel !== this.channel) {
      return;
    }

    const botId = msg.payload;
    if (!botId) {
      return;
    }

    this._log(`Received NOTIFY for bot ${botId}`);
    this._scheduleProcessNext(botId);
  }

  /**
   * Handle LISTEN client connection errors
   *
   * When the dedicated LISTEN client encounters an error (e.g. connection drop),
   * attempts to re-establish the listener after a brief delay.
   *
   * @param {Error} _err - The connection error
   * @private
   */
  _handleListenClientError(_err) {
    this._listenClient = null;

    if (this.state !== WORKER_STATES.RUNNING) {
      return;
    }

    // Attempt reconnection after a delay
    setTimeout(async () => {
      if (this.state !== WORKER_STATES.RUNNING) {
        return;
      }

      this._log('Attempting to reconnect LISTEN client...');
      try {
        await this._setupListenClient();
        this._log('LISTEN client reconnected successfully');
      } catch (reconnectErr) {
        this._log(`Failed to reconnect LISTEN client: ${reconnectErr.message}`);
        // Polling will continue as fallback; retry reconnect on next poll cycle
      }
    }, this.pollInterval);
  }

  // ============================================================================
  // Polling
  // ============================================================================

  /**
   * Start the fallback polling timer
   *
   * Periodically triggers processNext() for all bots with pending messages,
   * catching any notifications that may have been missed.
   *
   * @private
   */
  _startPolling() {
    this._stopPolling();

    this._pollTimer = setInterval(() => {
      this._pollAllBots();
    }, this.pollInterval);

    // Don't prevent Node.js from exiting if only the poll timer is keeping it alive
    if (this._pollTimer.unref) {
      this._pollTimer.unref();
    }

    this._log(`Fallback polling started (interval: ${this.pollInterval}ms)`);
  }

  /**
   * Stop the fallback polling timer
   * @private
   */
  _stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  /**
   * Poll for pending messages across all bots
   *
   * Queries the message_queue table for distinct bot_ids with pending messages
   * whose backoff period (next_attempt_at) has elapsed, and triggers
   * processNext() for each one. Messages still in exponential backoff are
   * excluded to avoid unnecessary dequeue attempts.
   *
   * @returns {Promise<void>}
   * @private
   */
  async _pollAllBots() {
    if (this.state !== WORKER_STATES.RUNNING) {
      return;
    }

    try {
      const { rows } = await this.storage.query(
        `SELECT DISTINCT bot_id FROM message_queue
         WHERE status = $1
           AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())`,
        [MESSAGE_STATUSES.PENDING]
      );

      for (const row of rows) {
        this._scheduleProcessNext(row.bot_id);
      }
    } catch (err) {
      this._log(`Poll failed: ${err.message}`);
    }
  }

  // ============================================================================
  // Processing Helpers
  // ============================================================================

  /**
   * Schedule a processNext() call for a bot, deduplicating rapid requests
   *
   * Uses a Set to prevent multiple concurrent processNext() calls for the same
   * bot from piling up (e.g. multiple rapid NOTIFY events).
   *
   * @param {string} botId - Bot identifier
   * @private
   */
  _scheduleProcessNext(botId) {
    if (this._pendingBotIds.has(botId)) {
      return;
    }

    this._pendingBotIds.add(botId);

    // Use setTimeout for non-blocking execution, scheduled as a macrotask
    // to avoid interfering with in-progress microtask chains (e.g. rapid enqueues)
    setTimeout(async () => {
      try {
        await this.processNext(botId);
      } catch (err) {
        this._log(`Scheduled processNext failed for bot ${botId}: ${err.message}`);
      } finally {
        this._pendingBotIds.delete(botId);
      }
    }, 0);
  }

  /**
   * Handle a processing error with exponential backoff retry
   *
   * If the message has not exceeded the retry limit, the message row is
   * atomically reset to 'pending' with an incremented retry_count and a
   * future next_attempt_at timestamp (exponential backoff). The dequeue
   * query filters on next_attempt_at, so the message won't be picked up
   * until the backoff period has elapsed — even across worker restarts.
   *
   * @param {string} botId - Bot identifier
   * @param {Object} queueMessage - The dequeued message that failed
   * @param {Error} err - The processing error
   * @returns {Promise<boolean>} False (message was not successfully processed)
   * @private
   */
  async _handleProcessingError(botId, queueMessage, err) {
    const retryKey = this._retryKey(botId, queueMessage);
    // Check retry count by content key first (persists across re-enqueued messages),
    // then fall back to message ID for backward compatibility
    const retryCount =
      this._retryCounts.get(retryKey) || this._retryCounts.get(queueMessage.id) || 0;
    const canRetry = retryCount < this.retryAttempts;

    this._log(
      `Message ${queueMessage.id} failed for bot ${botId} ` +
        `(attempt ${retryCount + 1}/${this.retryAttempts + 1}): ${err.message}`
    );

    if (canRetry) {
      // Calculate exponential backoff delay
      const delay = this.retryDelay * Math.pow(2, retryCount);
      const newCount = retryCount + 1;

      // Track retry count by content key (persists across re-enqueued messages)
      // and by message ID (for backward-compatible getRetryCount lookups)
      this._retryCounts.set(retryKey, newCount);
      this._retryCounts.set(queueMessage.id, newCount);

      this._log(
        `Scheduling retry for message ${queueMessage.id} in ${delay}ms (delay: ${delay}ms)`
      );

      // Atomically reset the same row back to 'pending' with a future
      // next_attempt_at so the dequeue query will skip it until the
      // backoff period has elapsed. This is crash-safe: the row is always
      // in a valid state and cannot be lost or duplicated.
      try {
        await this.storage.query(
          `UPDATE message_queue
           SET status = 'pending',
               started_at = NULL,
               error = NULL,
               retry_count = $1,
               next_attempt_at = NOW() + ($2 || ' milliseconds')::interval
           WHERE id = $3`,
          [newCount, String(delay), queueMessage.id]
        );
      } catch (retryErr) {
        this._log(`Failed to reset message ${queueMessage.id} for retry: ${retryErr.message}`);
        await this._markFailedSafe(queueMessage.id, err);
      }
    } else {
      this._log(
        `Message ${queueMessage.id} exceeded retry limit (${this.retryAttempts}), marking as failed`
      );
      await this._markFailedSafe(queueMessage.id, err);
      this._retryCounts.delete(retryKey);
      this._retryCounts.delete(queueMessage.id);
    }

    return false;
  }

  /**
   * Safely mark a message as failed, catching any errors during the mark operation
   *
   * @param {number} messageId - Queue message ID
   * @param {Error} err - The error to record
   * @returns {Promise<void>}
   * @private
   */
  async _markFailedSafe(messageId, err) {
    try {
      await this.messageQueue.markFailed(messageId, err);
    } catch (markErr) {
      this._log(`Failed to mark message ${messageId} as failed: ${markErr.message}`);
    }
  }

  /**
   * Resolve a bot configuration from a bot ID
   *
   * Uses the getBotConfig callback if provided, otherwise returns a minimal
   * config object with just the botId.
   *
   * @param {string} botId - Bot identifier
   * @returns {Promise<Object>} Bot configuration object
   * @private
   */
  async _resolveBotConfig(botId) {
    if (this.getBotConfig) {
      const config = await this.getBotConfig(botId);
      if (config) {
        return config;
      }
    }

    // Fallback: return minimal config (MessageProcessor needs at minimum id, provider, model)
    this._log(
      `No getBotConfig callback or config not found for bot ${botId}, using minimal config`
    );
    return { id: botId, provider: 'unknown', model: 'unknown' };
  }

  // ============================================================================
  // Internal Helpers
  // ============================================================================

  /**
   * Log a message if logger is available
   * @param {string} message - Message to log
   * @private
   */
  _log(message) {
    if (this.logger) {
      this.logger(`[QueueWorker] ${message}`);
    }
  }
}
