/**
 * ChannelMetrics - Per-channel message and performance tracking
 *
 * Tracks messages in/out, errors, and average response time per channel.
 * Provides in-memory metrics that can be queried for dashboards, health
 * reporting, and operational monitoring.
 *
 * @module core/channel-metrics
 */

/**
 * Custom error for channel metrics failures
 */
export class ChannelMetricsError extends Error {
  /**
   * Create a ChannelMetricsError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - The operation that failed
   * @param {string} [options.channelName] - Name of the channel involved
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'ChannelMetricsError';
    this.operation = options.operation;
    this.channelName = options.channelName;
  }
}

/**
 * Create a fresh metrics entry for a channel
 *
 * @returns {Object} Initial metrics state
 */
function createEmptyMetrics() {
  return {
    messagesIn: 0,
    messagesOut: 0,
    errors: 0,
    totalResponseTimeMs: 0,
    responseCount: 0,
    lastMessageAt: null,
    lastErrorAt: null,
    createdAt: new Date().toISOString(),
  };
}

/**
 * ChannelMetrics - tracks per-channel message and performance stats
 *
 * @example
 * const metrics = new ChannelMetrics();
 * metrics.recordMessageIn('slack-main');
 * metrics.recordMessageOut('slack-main', 150);
 * metrics.recordError('slack-main');
 * const stats = metrics.getChannelStats('slack-main');
 */
export class ChannelMetrics {
  /**
   * Create a ChannelMetrics instance
   *
   * @param {Object} [options={}] - Configuration options
   * @param {Function|null} [options.logger=null] - Logger function for metrics events
   */
  constructor(options = {}) {
    /** @type {Function|null} Logger function */
    this.logger = options.logger || null;

    /** @type {Map<string, Object>} Per-channel metrics state */
    this.metrics = new Map();
  }

  /**
   * Record an incoming message for a channel
   *
   * @param {string} channelName - Name of the channel
   */
  recordMessageIn(channelName) {
    this._validateChannelName(channelName, 'recordMessageIn');
    const entry = this._ensureEntry(channelName);
    entry.messagesIn++;
    entry.lastMessageAt = new Date().toISOString();
  }

  /**
   * Record an outgoing message for a channel with optional response time
   *
   * @param {string} channelName - Name of the channel
   * @param {number} [responseTimeMs] - Response time in milliseconds
   */
  recordMessageOut(channelName, responseTimeMs) {
    this._validateChannelName(channelName, 'recordMessageOut');
    const entry = this._ensureEntry(channelName);
    entry.messagesOut++;
    entry.lastMessageAt = new Date().toISOString();

    if (typeof responseTimeMs === 'number' && responseTimeMs >= 0) {
      entry.totalResponseTimeMs += responseTimeMs;
      entry.responseCount++;
    }
  }

  /**
   * Record an error for a channel
   *
   * @param {string} channelName - Name of the channel
   */
  recordError(channelName) {
    this._validateChannelName(channelName, 'recordError');
    const entry = this._ensureEntry(channelName);
    entry.errors++;
    entry.lastErrorAt = new Date().toISOString();
  }

  /**
   * Get metrics for a specific channel
   *
   * Returns computed stats including average response time and error rate.
   *
   * @param {string} channelName - Name of the channel
   * @returns {Object|null} Channel stats or null if not tracked
   */
  getChannelStats(channelName) {
    this._validateChannelName(channelName, 'getChannelStats');
    const entry = this.metrics.get(channelName);

    if (!entry) {
      return null;
    }

    const totalMessages = entry.messagesIn + entry.messagesOut;
    const avgResponseTimeMs =
      entry.responseCount > 0 ? Math.round(entry.totalResponseTimeMs / entry.responseCount) : 0;
    const errorRate = totalMessages > 0 ? Number((entry.errors / totalMessages).toFixed(4)) : 0;

    return {
      channelName,
      messagesIn: entry.messagesIn,
      messagesOut: entry.messagesOut,
      errors: entry.errors,
      avgResponseTimeMs,
      errorRate,
      lastMessageAt: entry.lastMessageAt,
      lastErrorAt: entry.lastErrorAt,
      createdAt: entry.createdAt,
    };
  }

  /**
   * Get aggregated stats for all tracked channels
   *
   * @returns {Object} All channel stats and summary totals
   */
  getAllStats() {
    const channels = {};
    let totalIn = 0;
    let totalOut = 0;
    let totalErrors = 0;

    for (const [name] of this.metrics) {
      const stats = this.getChannelStats(name);
      if (stats) {
        channels[name] = stats;
        totalIn += stats.messagesIn;
        totalOut += stats.messagesOut;
        totalErrors += stats.errors;
      }
    }

    return {
      channels,
      summary: {
        totalChannels: this.metrics.size,
        totalMessagesIn: totalIn,
        totalMessagesOut: totalOut,
        totalErrors,
      },
    };
  }

  /**
   * Reset metrics for a specific channel
   *
   * @param {string} channelName - Name of the channel
   */
  resetChannel(channelName) {
    this._validateChannelName(channelName, 'resetChannel');
    this.metrics.delete(channelName);
  }

  /**
   * Reset all channel metrics
   */
  resetAll() {
    this.metrics.clear();
  }

  /**
   * Get the number of tracked channels
   *
   * @returns {number} Number of tracked channels
   */
  getTrackedChannelCount() {
    return this.metrics.size;
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  /**
   * Ensure a metrics entry exists for a channel
   *
   * @param {string} channelName - Channel name
   * @returns {Object} Existing or newly created metrics entry
   * @private
   */
  _ensureEntry(channelName) {
    if (!this.metrics.has(channelName)) {
      this.metrics.set(channelName, createEmptyMetrics());
    }
    return this.metrics.get(channelName);
  }

  /**
   * Validate that a channel name is a non-empty string
   *
   * @param {string} channelName - Channel name to validate
   * @param {string} operation - Name of the calling operation
   * @throws {ChannelMetricsError} If channelName is invalid
   * @private
   */
  _validateChannelName(channelName, operation) {
    if (!channelName || typeof channelName !== 'string') {
      throw new ChannelMetricsError('Channel name must be a non-empty string', {
        operation,
      });
    }
  }

  /**
   * Log a message if logger is available
   *
   * @param {string} message - Message to log
   * @private
   */
  _log(message) {
    if (this.logger) {
      this.logger(message);
    }
  }
}

export default ChannelMetrics;
