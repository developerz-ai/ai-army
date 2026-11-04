/**
 * HealthMonitor - Pluggable health monitoring with periodic checks
 *
 * Provides a central registry for health check functions that can be run
 * on demand or on a periodic schedule. Each registered check runs at its
 * own configurable interval and returns a standardized result object.
 *
 * Features:
 * - Register named health checks with custom intervals
 * - Run all checks on demand or periodically
 * - Aggregate individual check results into an overall system status
 * - Track uptime and check history
 * - Unregister checks dynamically
 *
 * Each check function must return an object with at minimum:
 *   { status: 'healthy' | 'degraded' | 'unhealthy', ...details }
 *
 * @module monitoring/HealthMonitor
 */

/**
 * Valid health status values
 * @type {Readonly<{HEALTHY: string, DEGRADED: string, UNHEALTHY: string}>}
 */
export const HEALTH_STATUSES = Object.freeze({
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  UNHEALTHY: 'unhealthy',
});

/**
 * Default check interval in milliseconds (30 seconds)
 * @type {number}
 */
const DEFAULT_CHECK_INTERVAL_MS = 30_000;

/**
 * Default timeout for individual check execution in milliseconds (10 seconds)
 * @type {number}
 */
const DEFAULT_CHECK_TIMEOUT_MS = 10_000;

/**
 * Custom error for health monitor failures
 */
export class HealthMonitorError extends Error {
  /**
   * Create a HealthMonitorError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - The operation that failed
   * @param {string} [options.checkName] - Name of the health check involved
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'HealthMonitorError';
    this.operation = options.operation;
    this.checkName = options.checkName;
  }
}

/**
 * HealthMonitor - central health check registry and runner
 *
 * @example
 * const monitor = new HealthMonitor({ logger: console.log });
 * monitor.registerCheck('database', async () => {
 *   await db.query('SELECT 1');
 *   return { status: 'healthy', latency: 5 };
 * }, 15000);
 * await monitor.start();
 * const status = monitor.getStatus();
 * await monitor.stop();
 */
export class HealthMonitor {
  /**
   * Create a HealthMonitor instance
   *
   * @param {Object} [options={}] - Configuration options
   * @param {Function|null} [options.logger=null] - Logger function for health events
   * @param {number} [options.checkTimeoutMs=10000] - Timeout per individual check in ms
   */
  constructor(options = {}) {
    /** @type {Function|null} Logger function */
    this.logger = options.logger || null;

    /** @type {number} Timeout per individual check in ms */
    this.checkTimeoutMs = options.checkTimeoutMs || DEFAULT_CHECK_TIMEOUT_MS;

    /**
     * Registered health checks
     * @type {Map<string, {fn: Function, interval: number}>}
     */
    this.checks = new Map();

    /**
     * Latest results for each check
     * @type {Map<string, Object>}
     */
    this.results = new Map();

    /**
     * Per-check interval timer handles
     * @type {Map<string, ReturnType<typeof setInterval>>}
     */
    this._timers = new Map();

    /** @type {boolean} Whether the monitor is actively running */
    this._running = false;

    /** @type {Date|null} When the monitor was started */
    this._startedAt = null;
  }

  /**
   * Register a named health check
   *
   * The check function should be async and return an object containing
   * at minimum a `status` field ('healthy', 'degraded', or 'unhealthy')
   * along with any additional detail fields.
   *
   * @param {string} name - Unique name for the check (e.g. 'database', 'bots')
   * @param {Function} checkFn - Async function returning { status, ...details }
   * @param {number} [intervalMs=30000] - How often to run this check in ms
   * @throws {HealthMonitorError} If name is invalid or checkFn is not a function
   */
  registerCheck(name, checkFn, intervalMs = DEFAULT_CHECK_INTERVAL_MS) {
    if (!name || typeof name !== 'string') {
      throw new HealthMonitorError('Check name must be a non-empty string', {
        operation: 'registerCheck',
      });
    }

    if (typeof checkFn !== 'function') {
      throw new HealthMonitorError('Check function must be a function', {
        operation: 'registerCheck',
        checkName: name,
      });
    }

    if (typeof intervalMs !== 'number' || intervalMs <= 0) {
      throw new HealthMonitorError('Interval must be a positive number', {
        operation: 'registerCheck',
        checkName: name,
      });
    }

    // Stop existing timer if re-registering
    if (this._timers.has(name)) {
      clearInterval(this._timers.get(name));
      this._timers.delete(name);
    }

    this.checks.set(name, { fn: checkFn, interval: intervalMs });
    this._log(`Registered health check: ${name} (interval: ${intervalMs}ms)`);

    // If already running, start the timer for this new check immediately
    if (this._running) {
      this._startCheckTimer(name);
    }
  }

  /**
   * Unregister a health check by name
   *
   * Stops the check's periodic timer and removes its results.
   *
   * @param {string} name - Name of the check to remove
   * @returns {boolean} True if the check was found and removed
   */
  unregisterCheck(name) {
    if (!this.checks.has(name)) {
      return false;
    }

    // Stop timer if running
    if (this._timers.has(name)) {
      clearInterval(this._timers.get(name));
      this._timers.delete(name);
    }

    this.checks.delete(name);
    this.results.delete(name);
    this._log(`Unregistered health check: ${name}`);
    return true;
  }

  /**
   * Run all registered checks and return aggregated results
   *
   * Executes each check function with a timeout. If a check throws or
   * times out, it is recorded as unhealthy. Returns an object mapping
   * check names to their results.
   *
   * @returns {Promise<Object>} Map of check name to result object
   */
  async runChecks() {
    const results = {};

    for (const [name, check] of this.checks) {
      results[name] = await this._executeCheck(name, check.fn);
    }

    return results;
  }

  /**
   * Start periodic health checking
   *
   * Runs an initial check for all registered checks, then starts
   * individual timers based on each check's configured interval.
   *
   * @returns {Promise<void>}
   * @throws {HealthMonitorError} If the monitor is already running
   */
  async start() {
    if (this._running) {
      return;
    }

    this._running = true;
    this._startedAt = new Date();
    this._log('Starting health monitor...');

    // Run an initial check for all registered checks
    await this.runChecks();

    // Start individual timers for each check
    for (const [name] of this.checks) {
      this._startCheckTimer(name);
    }

    this._log(`Health monitor started with ${this.checks.size} check(s)`);
  }

  /**
   * Stop periodic health checking
   *
   * Clears all periodic timers. Results are preserved for querying.
   */
  stop() {
    if (!this._running) {
      return;
    }

    // Clear all timers
    for (const [name, timer] of this._timers) {
      clearInterval(timer);
      this._log(`Stopped timer for check: ${name}`);
    }
    this._timers.clear();

    this._running = false;
    this._log('Health monitor stopped');
  }

  /**
   * Get the aggregated health status
   *
   * Returns an object with the overall system status, timestamp,
   * uptime, and individual check results. The overall status is
   * determined by the worst status among all checks:
   * - If any check is 'unhealthy', overall is 'unhealthy'
   * - If any check is 'degraded', overall is 'degraded'
   * - Otherwise, overall is 'healthy'
   *
   * @returns {Object} Health status report
   */
  getStatus() {
    const checks = {};
    let overallStatus = HEALTH_STATUSES.HEALTHY;

    for (const [name, result] of this.results) {
      checks[name] = { ...result };

      if (result.status === HEALTH_STATUSES.UNHEALTHY) {
        overallStatus = HEALTH_STATUSES.UNHEALTHY;
      } else if (
        result.status === HEALTH_STATUSES.DEGRADED &&
        overallStatus !== HEALTH_STATUSES.UNHEALTHY
      ) {
        overallStatus = HEALTH_STATUSES.DEGRADED;
      }
    }

    const now = new Date();

    return {
      status: overallStatus,
      timestamp: now.toISOString(),
      uptime: this._startedAt ? Math.floor((now.getTime() - this._startedAt.getTime()) / 1000) : 0,
      checks,
    };
  }

  /**
   * Check if the monitor is currently running
   *
   * @returns {boolean} True if periodic checks are active
   */
  isRunning() {
    return this._running;
  }

  /**
   * Get the number of registered checks
   *
   * @returns {number} Count of registered checks
   */
  getCheckCount() {
    return this.checks.size;
  }

  /**
   * Get the result of a specific check by name
   *
   * @param {string} name - Check name
   * @returns {Object|undefined} Latest result or undefined if not found
   */
  getCheckResult(name) {
    return this.results.get(name);
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  /**
   * Execute a single health check with timeout protection
   *
   * @param {string} name - Check name
   * @param {Function} checkFn - Check function to execute
   * @returns {Promise<Object>} Check result
   * @private
   */
  async _executeCheck(name, checkFn) {
    const startTime = Date.now();

    try {
      const result = await Promise.race([
        checkFn(),
        new Promise((_resolve, reject) => {
          const msg = `Health check '${name}' timed out after ${this.checkTimeoutMs}ms`;
          setTimeout(() => reject(new Error(msg)), this.checkTimeoutMs);
        }),
      ]);

      const latencyMs = Date.now() - startTime;

      // Ensure result has required status field
      const normalizedResult = {
        status: HEALTH_STATUSES.HEALTHY,
        ...result,
        lastCheckAt: new Date().toISOString(),
        latencyMs,
      };

      this.results.set(name, normalizedResult);
      return normalizedResult;
    } catch (err) {
      const latencyMs = Date.now() - startTime;

      const errorResult = {
        status: HEALTH_STATUSES.UNHEALTHY,
        error: err.message,
        lastCheckAt: new Date().toISOString(),
        latencyMs,
      };

      this.results.set(name, errorResult);
      this._log(`Health check '${name}' failed: ${err.message}`);
      return errorResult;
    }
  }

  /**
   * Start a periodic timer for a specific check
   *
   * @param {string} name - Check name
   * @private
   */
  _startCheckTimer(name) {
    const check = this.checks.get(name);
    if (!check) {
      return;
    }

    const timer = setInterval(async () => {
      await this._executeCheck(name, check.fn);
    }, check.interval);

    // Allow the process to exit even with timers running
    if (timer.unref) {
      timer.unref();
    }

    this._timers.set(name, timer);
  }

  /**
   * Log a message if logger is available
   *
   * @param {string} message - Message to log
   * @private
   */
  _log(message) {
    if (this.logger) {
      this.logger(`[HealthMonitor] ${message}`);
    }
  }
}

export default HealthMonitor;
