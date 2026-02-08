/**
 * WebhookWorker - Background worker for processing pending webhook deliveries
 *
 * Provides:
 * - Real-time processing via PostgreSQL LISTEN/NOTIFY on the 'webhook_queue' channel
 * - Dedicated PostgreSQL client for LISTEN (separate from pool queries)
 * - Fallback polling interval (default 5s) to catch missed notifications
 * - Concurrent delivery with SELECT ... FOR UPDATE SKIP LOCKED
 * - Graceful start/stop lifecycle management
 *
 * Architecture:
 * - On NOTIFY: immediately attempt to deliver the notified webhook
 * - On poll tick: scan for pending webhooks ready for delivery
 * - Processing: claim via SELECT FOR UPDATE SKIP LOCKED, deliver via DeliveryManager
 *
 * @module webhooks/webhook-worker
 */

import { WEBHOOK_STATUSES } from './webhook-manager.js';

/**
 * Default configuration for WebhookWorker
 * @type {Readonly<Object>}
 */
const DEFAULTS = Object.freeze({
  /** Fallback polling interval in milliseconds */
  pollInterval: 5000,
  /** Maximum webhooks to process per poll cycle */
  batchSize: 10,
  /** PostgreSQL channel name for LISTEN/NOTIFY */
  channel: 'webhook_queue',
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
 * Custom error for webhook worker failures
 */
export class WebhookWorkerError extends Error {
  /**
   * Create a WebhookWorkerError
   * @param {string} message - Error message
   * @param {Object} [options] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - The operation that failed
   * @param {number} [options.webhookId] - Webhook delivery ID involved
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'WebhookWorkerError';
    this.operation = options.operation;
    this.webhookId = options.webhookId;
  }
}

/**
 * WebhookWorker - polls or listens for pending webhooks and delivers them
 *
 * @example
 * const worker = new WebhookWorker(deliveryManager, storage, {
 *   pollInterval: 5000,
 *   batchSize: 10,
 * });
 * await worker.start();
 * // ... worker delivers webhooks in background ...
 * await worker.stop();
 */
export class WebhookWorker {
  /**
   * Create a WebhookWorker instance
   *
   * @param {Object} deliveryManager - DeliveryManager instance for HTTP delivery
   * @param {Object} storage - PostgresStorage instance (must have pool property after connect)
   * @param {Object} [options={}] - Configuration options
   * @param {number} [options.pollInterval=5000] - Fallback polling interval in milliseconds
   * @param {number} [options.batchSize=10] - Max webhooks to process per poll cycle
   * @param {string} [options.channel='webhook_queue'] - PostgreSQL LISTEN/NOTIFY channel name
   * @param {Function|null} [options.logger=null] - Optional logging function
   */
  constructor(deliveryManager, storage, options = {}) {
    if (!deliveryManager) {
      throw new WebhookWorkerError('deliveryManager is required', {
        operation: 'constructor',
      });
    }
    if (!storage) {
      throw new WebhookWorkerError('storage is required', {
        operation: 'constructor',
      });
    }

    /** @type {Object} DeliveryManager instance */
    this.deliveryManager = deliveryManager;

    /** @type {Object} PostgresStorage instance */
    this.storage = storage;

    /** @type {number} Fallback polling interval in ms */
    this.pollInterval = options.pollInterval ?? DEFAULTS.pollInterval;

    /** @type {number} Max webhooks per poll cycle */
    this.batchSize = options.batchSize ?? DEFAULTS.batchSize;

    /** @type {string} PostgreSQL LISTEN/NOTIFY channel name */
    const rawChannel = options.channel ?? DEFAULTS.channel;
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(rawChannel)) {
      throw new WebhookWorkerError(
        `Invalid channel name "${rawChannel}": must be a valid PostgreSQL identifier`,
        { operation: 'constructor' }
      );
    }
    this.channel = rawChannel;

    /** @type {Function|null} Optional logger */
    this.logger = options.logger || null;

    /** @type {string} Current worker state */
    this.state = WORKER_STATES.STOPPED;

    /** @type {Object|null} Dedicated PostgreSQL client for LISTEN */
    this._listenClient = null;

    /** @type {Object|null} Polling interval timer reference */
    this._pollTimer = null;

    /** @type {Set<number>} Webhook IDs currently being processed (dedup) */
    this._inFlight = new Set();
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Start the webhook worker
   *
   * Sets up a dedicated PostgreSQL client with LISTEN on the webhook_queue
   * channel and starts the fallback polling timer.
   *
   * @returns {Promise<void>}
   * @throws {WebhookWorkerError} If worker is already running or connection fails
   */
  async start() {
    if (this.state === WORKER_STATES.RUNNING || this.state === WORKER_STATES.STARTING) {
      throw new WebhookWorkerError('Worker is already running', { operation: 'start' });
    }

    this.state = WORKER_STATES.STARTING;
    this._log('Starting webhook worker...');

    try {
      // Set up dedicated LISTEN client
      await this._setupListenClient();

      // Start fallback polling
      this._startPolling();

      this.state = WORKER_STATES.RUNNING;
      this._log('Webhook worker started successfully');
    } catch (err) {
      this.state = WORKER_STATES.STOPPED;
      throw new WebhookWorkerError(`Failed to start webhook worker: ${err.message}`, {
        cause: err,
        operation: 'start',
      });
    }
  }

  /**
   * Stop the webhook worker gracefully
   *
   * Releases the LISTEN client, stops the polling timer, and clears in-flight
   * tracking. Does not wait for in-flight deliveries to complete.
   *
   * @returns {Promise<void>}
   */
  async stop() {
    if (this.state === WORKER_STATES.STOPPED) {
      return;
    }

    this.state = WORKER_STATES.STOPPING;
    this._log('Stopping webhook worker...');

    // Stop polling
    this._stopPolling();

    // Release LISTEN client
    await this._releaseListenClient();

    // Clean up state
    this._inFlight.clear();

    this.state = WORKER_STATES.STOPPED;
    this._log('Webhook worker stopped');
  }

  /**
   * Get the current state of the worker
   * @returns {string} Current worker state
   */
  getState() {
    return this.state;
  }

  // ==========================================================================
  // Processing
  // ==========================================================================

  /**
   * Process pending webhooks
   *
   * Claims up to batchSize pending webhooks using SELECT ... FOR UPDATE SKIP LOCKED
   * and delivers them via the DeliveryManager. This ensures safe concurrent
   * processing across multiple workers.
   *
   * @returns {Promise<number>} Number of webhooks processed
   */
  async processPending() {
    if (this.state !== WORKER_STATES.RUNNING) {
      return 0;
    }

    try {
      const webhooks = await this._claimPendingWebhooks();

      if (webhooks.length === 0) {
        return 0;
      }

      this._log(`Processing ${webhooks.length} pending webhook(s)`);

      const deliveryPromises = webhooks.map(webhook => this._deliverSafe(webhook));
      await Promise.allSettled(deliveryPromises);

      return webhooks.length;
    } catch (err) {
      this._log(`Failed to process pending webhooks: ${err.message}`);
      return 0;
    }
  }

  /**
   * Process a single webhook by ID
   *
   * @param {number} webhookId - Webhook delivery ID to process
   * @returns {Promise<boolean>} True if the webhook was delivered (success or failure)
   */
  async processOne(webhookId) {
    if (this._inFlight.has(webhookId)) {
      this._log(`Webhook ${webhookId} is already in flight, skipping`);
      return false;
    }

    try {
      const webhook = await this._getWebhook(webhookId);
      if (!webhook) {
        this._log(`Webhook ${webhookId} not found or not in deliverable state`);
        return false;
      }

      await this._deliverSafe(webhook);
      return true;
    } catch (err) {
      this._log(`Failed to process webhook ${webhookId}: ${err.message}`);
      return false;
    }
  }

  // ==========================================================================
  // LISTEN/NOTIFY Setup
  // ==========================================================================

  /**
   * Set up a dedicated PostgreSQL client for LISTEN/NOTIFY
   *
   * @returns {Promise<void>}
   * @throws {WebhookWorkerError} If LISTEN setup fails
   * @private
   */
  async _setupListenClient() {
    if (!this.storage.pool) {
      throw new WebhookWorkerError('Storage pool is not available. Call storage.connect() first.', {
        operation: 'start',
      });
    }

    try {
      this._listenClient = await this.storage.pool.connect();

      // Handle client errors
      this._listenClient.on('error', err => {
        this._log(`LISTEN client error: ${err.message}`);
        this._handleListenClientError(err);
      });

      // Handle notifications
      this._listenClient.on('notification', msg => {
        this._handleNotification(msg);
      });

      // Start listening
      await this._listenClient.query(`LISTEN "${this.channel}"`);
      this._log(`Listening on PostgreSQL channel "${this.channel}"`);
    } catch (err) {
      if (this._listenClient) {
        try {
          this._listenClient.release();
        } catch (_releaseErr) {
          // Ignore release errors during setup failure
        }
        this._listenClient = null;
      }

      throw new WebhookWorkerError(`Failed to set up LISTEN client: ${err.message}`, {
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
      await this._listenClient.query(`UNLISTEN "${this.channel}"`);
    } catch (_err) {
      // Ignore UNLISTEN errors during shutdown
    }

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
   * Handle a PostgreSQL NOTIFY event from the webhook_queue channel
   *
   * @param {Object} msg - PostgreSQL notification object
   * @param {string} msg.channel - Channel name
   * @param {string} msg.payload - Notification payload (JSON with webhook_id)
   * @private
   */
  _handleNotification(msg) {
    if (msg.channel !== this.channel) {
      return;
    }

    let webhookId;
    try {
      const data = JSON.parse(msg.payload);
      webhookId = data.webhook_id;
    } catch (_err) {
      this._log(`Invalid NOTIFY payload: ${msg.payload}`);
      return;
    }

    if (!webhookId) {
      return;
    }

    this._log(`Received NOTIFY for webhook ${webhookId}`);
    this._scheduleProcess(webhookId);
  }

  /**
   * Handle LISTEN client connection errors with reconnection
   *
   * @param {Error} _err - The connection error
   * @private
   */
  _handleListenClientError(_err) {
    this._listenClient = null;

    if (this.state !== WORKER_STATES.RUNNING) {
      return;
    }

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
      }
    }, this.pollInterval);
  }

  // ==========================================================================
  // Polling
  // ==========================================================================

  /**
   * Start the fallback polling timer
   * @private
   */
  _startPolling() {
    this._stopPolling();

    this._pollTimer = setInterval(() => {
      this.processPending();
    }, this.pollInterval);

    // Don't prevent Node.js from exiting
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

  // ==========================================================================
  // Database Helpers
  // ==========================================================================

  /**
   * Claim pending webhooks using SELECT ... FOR UPDATE SKIP LOCKED
   *
   * Atomically selects and marks pending webhooks as ready for delivery
   * within an explicit transaction. Uses SKIP LOCKED to allow safe
   * concurrent processing across workers. The row locks are held through
   * the status update to 'sending', ensuring no other worker can pick up
   * the same rows.
   *
   * @returns {Promise<Array<Object>>} Array of claimed webhook records
   * @private
   */
  async _claimPendingWebhooks() {
    const rows = await this.storage.transaction(async client => {
      const { rows: selected } = await client.query(
        `SELECT * FROM webhooks
         WHERE status = $1
           AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
         ORDER BY created_at ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED`,
        [WEBHOOK_STATUSES.PENDING, this.batchSize]
      );

      if (selected.length > 0) {
        const ids = selected.map(r => r.id);
        await client.query(
          `UPDATE webhooks SET status = $1 WHERE id = ANY($2)`,
          [WEBHOOK_STATUSES.SENDING, ids]
        );
      }

      return selected;
    });

    return rows.map(row => this._transformRow(row));
  }

  /**
   * Get a single webhook by ID (only if in a deliverable state)
   *
   * @param {number} webhookId - Webhook delivery ID
   * @returns {Promise<Object|null>} Webhook record or null
   * @private
   */
  async _getWebhook(webhookId) {
    const { rows } = await this.storage.query(
      `SELECT * FROM webhooks
       WHERE id = $1 AND status IN ($2, $3)`,
      [webhookId, WEBHOOK_STATUSES.PENDING, WEBHOOK_STATUSES.SENDING]
    );

    if (rows.length === 0) {
      return null;
    }

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
      nextAttemptAt: row.next_attempt_at,
      responseCode: row.response_code,
      responseBody: row.response_body,
      error: row.error,
      createdAt: row.created_at,
    };
  }

  // ==========================================================================
  // Processing Helpers
  // ==========================================================================

  /**
   * Schedule processing for a webhook via non-blocking macrotask
   *
   * @param {number} webhookId - Webhook delivery ID
   * @private
   */
  _scheduleProcess(webhookId) {
    if (this._inFlight.has(webhookId)) {
      return;
    }

    setTimeout(async () => {
      try {
        await this.processOne(webhookId);
      } catch (err) {
        this._log(`Scheduled delivery failed for webhook ${webhookId}: ${err.message}`);
      }
    }, 0);
  }

  /**
   * Safely deliver a webhook, catching errors and tracking in-flight state
   *
   * @param {Object} webhook - Webhook delivery record
   * @returns {Promise<void>}
   * @private
   */
  async _deliverSafe(webhook) {
    this._inFlight.add(webhook.id);

    try {
      await this.deliveryManager.deliver(webhook);
    } catch (err) {
      this._log(`Delivery failed for webhook ${webhook.id}: ${err.message}`);
    } finally {
      this._inFlight.delete(webhook.id);
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
      this.logger(`[WebhookWorker] ${message}`);
    }
  }
}
