/**
 * AuditRetention - Scheduled cleanup of old audit log entries
 *
 * Manages the lifecycle of audit log data by periodically deleting
 * entries older than a configurable retention period. Uses the
 * AuditLogger.applyRetention() method to perform the actual deletion
 * and schedules cleanup via setInterval.
 *
 * Features:
 * - Configurable retention period in days (default 90)
 * - Configurable cleanup interval in milliseconds (default 24 hours)
 * - Safe start/stop lifecycle with idempotent operations
 * - Error-resilient: cleanup failures are logged but do not crash the scheduler
 *
 * @module audit/audit-retention
 */

/**
 * Default retention period in days
 * @type {number}
 */
const DEFAULT_RETENTION_DAYS = 90;

/**
 * Default cleanup interval: 24 hours in milliseconds
 * @type {number}
 */
const DEFAULT_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Custom error for audit retention failures
 */
export class AuditRetentionError extends Error {
  /**
   * Create an AuditRetentionError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - The operation that failed
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'AuditRetentionError';
    this.operation = options.operation;
  }
}

/**
 * AuditRetention - schedules and executes periodic cleanup of old audit logs
 *
 * @example
 * const retention = new AuditRetention({
 *   auditLogger,
 *   retentionDays: 90,
 *   intervalMs: 24 * 60 * 60 * 1000,
 *   logger: console.log,
 * });
 * retention.start();
 * // ... later ...
 * retention.stop();
 */
export class AuditRetention {
  /**
   * Create an AuditRetention instance
   *
   * @param {Object} options - Configuration options
   * @param {Object} options.auditLogger - AuditLogger instance with applyRetention() method
   * @param {number} [options.retentionDays=90] - Number of days to retain audit logs
   * @param {number} [options.intervalMs=86400000] - Cleanup interval in milliseconds (default 24h)
   * @param {Function|null} [options.logger=null] - Logger function for internal events
   * @param {boolean} [options.runOnStart=false] - Whether to run cleanup immediately on start()
   */
  constructor(options = {}) {
    const {
      auditLogger,
      retentionDays = DEFAULT_RETENTION_DAYS,
      intervalMs = DEFAULT_CLEANUP_INTERVAL_MS,
      logger = null,
      runOnStart = false,
    } = options;

    if (!auditLogger) {
      throw new AuditRetentionError('AuditLogger instance is required', {
        operation: 'constructor',
      });
    }

    if (typeof auditLogger.applyRetention !== 'function') {
      throw new AuditRetentionError('AuditLogger must have an applyRetention() method', {
        operation: 'constructor',
      });
    }

    if (typeof retentionDays !== 'number' || retentionDays <= 0) {
      throw new AuditRetentionError('retentionDays must be a positive number', {
        operation: 'constructor',
      });
    }

    if (typeof intervalMs !== 'number' || intervalMs <= 0) {
      throw new AuditRetentionError('intervalMs must be a positive number', {
        operation: 'constructor',
      });
    }

    /** @type {Object} AuditLogger instance */
    this.auditLogger = auditLogger;

    /** @type {number} Retention period in days */
    this.retentionDays = retentionDays;

    /** @type {number} Cleanup interval in milliseconds */
    this.intervalMs = intervalMs;

    /** @type {Function|null} Logger function */
    this.logger = logger;

    /** @type {boolean} Whether to run cleanup immediately on start */
    this.runOnStart = runOnStart;

    /** @type {NodeJS.Timeout|null} Interval timer reference */
    this._timer = null;

    /** @type {boolean} Whether the retention scheduler is running */
    this._running = false;
  }

  /**
   * Start the scheduled cleanup
   *
   * Begins periodic cleanup of audit logs older than the configured
   * retention period. If runOnStart is true, performs an immediate cleanup.
   * Calling start() when already running is a no-op.
   *
   * @returns {Promise<void>}
   */
  async start() {
    if (this._running) {
      return;
    }

    this._running = true;

    this._log(
      `Audit retention started: cleaning logs older than ${this.retentionDays} days ` +
        `every ${this.intervalMs}ms`
    );

    if (this.runOnStart) {
      await this.cleanOldLogs(this.retentionDays);
    }

    this._timer = setInterval(() => {
      this.cleanOldLogs(this.retentionDays).catch(err => {
        this._log(`Scheduled cleanup error: ${err.message}`);
      });
    }, this.intervalMs);

    // Allow the timer to not prevent Node.js from exiting
    if (this._timer && typeof this._timer.unref === 'function') {
      this._timer.unref();
    }
  }

  /**
   * Stop the scheduled cleanup
   *
   * Clears the interval timer and marks the scheduler as stopped.
   * Calling stop() when not running is a no-op.
   */
  stop() {
    if (!this._running) {
      return;
    }

    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }

    this._running = false;
    this._log('Audit retention stopped');
  }

  /**
   * Clean old audit logs based on the retention period
   *
   * Delegates to AuditLogger.applyRetention() to delete audit log entries
   * older than the specified number of days. Errors are caught and logged
   * to prevent the scheduler from crashing.
   *
   * @param {number} [retentionDays] - Number of days to retain (defaults to this.retentionDays)
   * @returns {Promise<number>} Number of deleted rows
   */
  async cleanOldLogs(retentionDays) {
    const days = retentionDays ?? this.retentionDays;

    try {
      const deleted = await this.auditLogger.applyRetention(days);
      this._log(`Cleaned ${deleted} audit log entries older than ${days} days`);
      return deleted;
    } catch (err) {
      this._log(`Failed to clean old audit logs: ${err.message}`);
      throw new AuditRetentionError(`Failed to clean old audit logs: ${err.message}`, {
        cause: err,
        operation: 'cleanOldLogs',
      });
    }
  }

  /**
   * Check if the retention scheduler is currently running
   *
   * @returns {boolean} True if the scheduler is active
   */
  isRunning() {
    return this._running;
  }

  /**
   * Log a message if logger is available
   *
   * @param {string} message - Message to log
   * @private
   */
  _log(message) {
    if (this.logger) {
      this.logger(`[AuditRetention] ${message}`);
    }
  }
}
