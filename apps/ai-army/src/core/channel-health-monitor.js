/**
 * ChannelHealthMonitor - Periodic health checking and auto-reconnect for channels
 *
 * Monitors channel adapter health by running periodic checks.
 * When a channel is detected as unhealthy, the monitor can automatically
 * attempt reconnection. Exposes aggregated health metrics for all channels.
 *
 * @module core/channel-health-monitor
 */

/**
 * Health status constants
 * @type {Readonly<{HEALTHY: string, UNHEALTHY: string, RECONNECTING: string, UNKNOWN: string}>}
 */
const HEALTH_STATUSES = Object.freeze({
  HEALTHY: 'healthy',
  UNHEALTHY: 'unhealthy',
  RECONNECTING: 'reconnecting',
  UNKNOWN: 'unknown',
});

/**
 * Custom error for health monitoring failures
 */
export class ChannelHealthMonitorError extends Error {
  /**
   * Create a ChannelHealthMonitorError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - The operation that failed
   * @param {string} [options.channelName] - Name of the channel involved
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'ChannelHealthMonitorError';
    this.operation = options.operation;
    this.channelName = options.channelName;
  }
}

/**
 * ChannelHealthMonitor - monitors channel health and handles reconnection
 *
 * Stores per-channel health state including status, last check time,
 * consecutive failures, and uptime tracking.
 *
 * @example
 * const monitor = new ChannelHealthMonitor(channelManager, {
 *   checkIntervalMs: 30000,
 *   maxRetries: 3,
 * });
 * monitor.startPeriodicChecks();
 * const metrics = monitor.getHealthMetrics();
 */
export class ChannelHealthMonitor {
  /**
   * Create a ChannelHealthMonitor instance
   *
   * @param {Object} channelManager - ChannelManager instance for accessing channels
   * @param {Object} [options={}] - Configuration options
   * @param {number} [options.checkIntervalMs=30000] - Interval between health checks in ms
   * @param {number} [options.maxRetries=3] - Maximum consecutive reconnect attempts
   * @param {Function|null} [options.logger=null] - Logger function for health events
   */
  constructor(channelManager, options = {}) {
    if (!channelManager) {
      throw new ChannelHealthMonitorError('ChannelManager is required', {
        operation: 'constructor',
      });
    }

    /** @type {Object} ChannelManager instance */
    this.channelManager = channelManager;

    /** @type {number} Health check interval in milliseconds */
    this.checkIntervalMs = options.checkIntervalMs || 30000;

    /** @type {number} Maximum consecutive reconnect attempts */
    this.maxRetries = options.maxRetries || 3;

    /** @type {Function|null} Logger function */
    this.logger = options.logger || null;

    /** @type {Map<string, Object>} Per-channel health state */
    this.healthState = new Map();

    /** @type {ReturnType<typeof setInterval>|null} Periodic check interval handle */
    this._intervalHandle = null;
  }

  /**
   * Check the health of a specific channel
   *
   * Attempts to determine if a channel's adapter is functional by calling
   * the adapter's `isHealthy()` or `ping()` method. Falls back to checking
   * whether the adapter exists and the channel has a valid status.
   *
   * @param {string} name - Channel name to check
   * @returns {Promise<Object>} Health result with status, latencyMs, and error
   */
  async checkHealth(name) {
    if (!name || typeof name !== 'string') {
      throw new ChannelHealthMonitorError('Channel name must be a non-empty string', {
        operation: 'checkHealth',
      });
    }

    const channel = this.channelManager.getChannel(name);
    if (!channel) {
      return this._updateHealthState(name, {
        status: HEALTH_STATUSES.UNKNOWN,
        error: `Channel '${name}' not found`,
      });
    }

    const startTime = Date.now();

    try {
      const { adapter } = channel;
      let healthy = false;

      if (adapter && typeof adapter.isHealthy === 'function') {
        healthy = await adapter.isHealthy();
      } else if (adapter && typeof adapter.ping === 'function') {
        await adapter.ping();
        healthy = true;
      } else {
        // Fallback: assume healthy if adapter exists and channel is in ready/started state
        healthy = !!adapter && (channel.status === 'ready' || channel.status === 'started');
      }

      const latencyMs = Date.now() - startTime;
      const status = healthy ? HEALTH_STATUSES.HEALTHY : HEALTH_STATUSES.UNHEALTHY;

      return this._updateHealthState(name, { status, latencyMs });
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      this._log(`Health check failed for channel '${name}': ${err.message}`);

      return this._updateHealthState(name, {
        status: HEALTH_STATUSES.UNHEALTHY,
        latencyMs,
        error: err.message,
      });
    }
  }

  /**
   * Attempt to reconnect a failed channel
   *
   * Uses the channel's stored config to stop and re-initialize the channel
   * via the ChannelManager. Respects maxRetries; if exceeded, logs and
   * marks the channel as unhealthy without further attempts.
   *
   * @param {string} name - Channel name to reconnect
   * @returns {Promise<Object>} Reconnect result with success boolean and details
   */
  async reconnectOnFailure(name) {
    if (!name || typeof name !== 'string') {
      throw new ChannelHealthMonitorError('Channel name must be a non-empty string', {
        operation: 'reconnectOnFailure',
      });
    }

    const state = this.healthState.get(name);
    const consecutiveFailures = state ? state.consecutiveFailures : 0;

    if (consecutiveFailures >= this.maxRetries) {
      this._log(`Channel '${name}' exceeded max retries (${this.maxRetries}), skipping reconnect`);
      return {
        success: false,
        channelName: name,
        reason: `Exceeded max retries (${this.maxRetries})`,
      };
    }

    const channel = this.channelManager.getChannel(name);
    if (!channel) {
      return {
        success: false,
        channelName: name,
        reason: `Channel '${name}' not found`,
      };
    }

    this._updateHealthState(name, { status: HEALTH_STATUSES.RECONNECTING });
    this._log(`Attempting reconnect for channel '${name}' (attempt ${consecutiveFailures + 1})`);

    try {
      const { config } = channel;
      await this.channelManager.stopChannel(name);
      await this.channelManager.initializeChannel(name, config);

      this._updateHealthState(name, {
        status: HEALTH_STATUSES.HEALTHY,
        consecutiveFailures: 0,
      });

      this._log(`Successfully reconnected channel '${name}'`);
      return { success: true, channelName: name };
    } catch (err) {
      this._log(`Reconnect failed for channel '${name}': ${err.message}`);

      this._updateHealthState(name, {
        status: HEALTH_STATUSES.UNHEALTHY,
        error: err.message,
      });

      return {
        success: false,
        channelName: name,
        reason: err.message,
      };
    }
  }

  /**
   * Get aggregated health metrics for all monitored channels
   *
   * Returns an object with per-channel health states and summary counts.
   *
   * @returns {Object} Health metrics with channels map and summary
   */
  getHealthMetrics() {
    const channels = {};
    let healthyCount = 0;
    let unhealthyCount = 0;
    let unknownCount = 0;

    for (const [name, state] of this.healthState) {
      channels[name] = { ...state };

      if (state.status === HEALTH_STATUSES.HEALTHY) {
        healthyCount++;
      } else if (state.status === HEALTH_STATUSES.UNHEALTHY) {
        unhealthyCount++;
      } else {
        unknownCount++;
      }
    }

    return {
      channels,
      summary: {
        total: this.healthState.size,
        healthy: healthyCount,
        unhealthy: unhealthyCount,
        unknown: unknownCount,
      },
    };
  }

  /**
   * Start periodic health checks for all channels
   *
   * Runs health checks at the configured interval. For any unhealthy channel,
   * automatically triggers a reconnect attempt.
   */
  startPeriodicChecks() {
    if (this._intervalHandle) {
      return;
    }

    this._log(`Starting periodic health checks every ${this.checkIntervalMs}ms`);

    this._intervalHandle = setInterval(async () => {
      await this._runHealthChecks();
    }, this.checkIntervalMs);

    // Allow the process to exit even with this interval running
    if (this._intervalHandle.unref) {
      this._intervalHandle.unref();
    }
  }

  /**
   * Stop periodic health checks
   */
  stopPeriodicChecks() {
    if (this._intervalHandle) {
      clearInterval(this._intervalHandle);
      this._intervalHandle = null;
      this._log('Stopped periodic health checks');
    }
  }

  /**
   * Check if periodic checks are currently running
   *
   * @returns {boolean} True if periodic checks are active
   */
  isRunning() {
    return this._intervalHandle !== null;
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  /**
   * Run health checks on all currently registered channels
   *
   * @returns {Promise<void>}
   * @private
   */
  async _runHealthChecks() {
    const channels = this.channelManager.listChannels();

    for (const channel of channels) {
      const result = await this.checkHealth(channel.name);

      if (result.status === HEALTH_STATUSES.UNHEALTHY) {
        await this.reconnectOnFailure(channel.name);
      }
    }
  }

  /**
   * Update the health state for a channel
   *
   * Merges new state with existing state, updating timestamps and
   * incrementing consecutive failure counts for unhealthy results.
   *
   * @param {string} name - Channel name
   * @param {Object} update - State fields to update
   * @returns {Object} Updated health state
   * @private
   */
  _updateHealthState(name, update) {
    const existing = this.healthState.get(name) || {
      status: HEALTH_STATUSES.UNKNOWN,
      lastCheckAt: null,
      consecutiveFailures: 0,
      latencyMs: null,
      error: null,
    };

    const newState = {
      ...existing,
      ...update,
      lastCheckAt: new Date().toISOString(),
    };

    // Track consecutive failures
    if (
      update.status === HEALTH_STATUSES.UNHEALTHY &&
      typeof update.consecutiveFailures === 'undefined'
    ) {
      newState.consecutiveFailures = existing.consecutiveFailures + 1;
    }

    // Reset failures on healthy
    if (update.status === HEALTH_STATUSES.HEALTHY) {
      newState.consecutiveFailures = 0;
      newState.error = null;
    }

    this.healthState.set(name, newState);
    return newState;
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

export { HEALTH_STATUSES };
export default ChannelHealthMonitor;
