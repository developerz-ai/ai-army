/**
 * MetricsCollector - Time-series health metrics storage and querying
 *
 * Collects health check results and stores them as time-series metrics in the
 * `health_metrics` database table. Supports recording individual data points,
 * querying historical data with filtering, and applying a retention policy to
 * automatically purge old metrics.
 *
 * Features:
 * - Record metric data points (component, metric name, value)
 * - Batch-record multiple metrics at once
 * - Query historical metrics with component/metric/time-range filters
 * - Configurable retention policy for automatic cleanup
 * - Integration with HealthMonitor check results
 *
 * @module monitoring/MetricsCollector
 */

/**
 * Default retention period in days (30 days)
 * @type {number}
 */
const DEFAULT_RETENTION_DAYS = 30;

/**
 * Default maximum rows to return from queries
 * @type {number}
 */
const DEFAULT_QUERY_LIMIT = 1000;

/**
 * Custom error for metrics collector failures
 */
export class MetricsCollectorError extends Error {
  /**
   * Create a MetricsCollectorError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - The operation that failed
   * @param {string} [options.component] - Component name involved
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'MetricsCollectorError';
    this.operation = options.operation;
    this.component = options.component;
  }
}

/**
 * MetricsCollector - stores and queries health metrics in PostgreSQL
 *
 * @example
 * const collector = new MetricsCollector({ storage, logger: console.log });
 * await collector.record('database', 'latency_ms', 5.2);
 * const history = await collector.query({ component: 'database', metric: 'latency_ms' });
 * await collector.applyRetention(7);
 */
export class MetricsCollector {
  /**
   * Create a MetricsCollector instance
   *
   * @param {Object} options - Configuration options
   * @param {Object} options.storage - PostgresStorage instance with query() method
   * @param {Function|null} [options.logger=null] - Logger function for events
   * @param {number} [options.retentionDays=30] - Default retention period in days
   */
  constructor(options = {}) {
    const { storage, logger = null, retentionDays = DEFAULT_RETENTION_DAYS } = options;

    if (!storage) {
      throw new MetricsCollectorError('Storage instance is required', {
        operation: 'constructor',
      });
    }

    if (typeof storage.query !== 'function') {
      throw new MetricsCollectorError('Storage must have a query() method', {
        operation: 'constructor',
      });
    }

    if (typeof retentionDays !== 'number' || retentionDays <= 0) {
      throw new MetricsCollectorError('retentionDays must be a positive number', {
        operation: 'constructor',
      });
    }

    /** @type {Object} PostgresStorage instance */
    this.storage = storage;

    /** @type {Function|null} Logger function */
    this.logger = logger;

    /** @type {number} Default retention period in days */
    this.retentionDays = retentionDays;
  }

  /**
   * Record a single metric data point
   *
   * @param {string} component - Component name (e.g., 'database', 'bots')
   * @param {string} metric - Metric name (e.g., 'latency_ms', 'error_rate')
   * @param {number} value - Numeric metric value
   * @param {Date} [timestamp] - Optional timestamp (defaults to NOW())
   * @returns {Promise<void>}
   * @throws {MetricsCollectorError} If recording fails
   */
  async record(component, metric, value, timestamp) {
    if (!component || typeof component !== 'string') {
      throw new MetricsCollectorError('Component must be a non-empty string', {
        operation: 'record',
      });
    }

    if (!metric || typeof metric !== 'string') {
      throw new MetricsCollectorError('Metric must be a non-empty string', {
        operation: 'record',
        component,
      });
    }

    if (typeof value !== 'number' || Number.isNaN(value)) {
      throw new MetricsCollectorError('Value must be a valid number', {
        operation: 'record',
        component,
      });
    }

    try {
      if (timestamp) {
        await this.storage.query(
          `INSERT INTO health_metrics (component, metric, value, timestamp)
           VALUES ($1, $2, $3, $4)`,
          [component, metric, value, timestamp]
        );
      } else {
        await this.storage.query(
          `INSERT INTO health_metrics (component, metric, value)
           VALUES ($1, $2, $3)`,
          [component, metric, value]
        );
      }

      this._log(`Recorded metric: ${component}.${metric} = ${value}`);
    } catch (err) {
      throw new MetricsCollectorError(`Failed to record metric: ${err.message}`, {
        cause: err,
        operation: 'record',
        component,
      });
    }
  }

  /**
   * Record multiple metrics in a single batch
   *
   * Each entry should have { component, metric, value, timestamp? }.
   * All entries are inserted individually but failures are collected
   * and reported after attempting all inserts.
   *
   * @param {Array<{component: string, metric: string, value: number, timestamp?: Date}>} entries - Metric entries
   * @returns {Promise<{recorded: number, failed: number}>} Result counts
   * @throws {MetricsCollectorError} If entries is not an array
   */
  async recordBatch(entries) {
    if (!Array.isArray(entries)) {
      throw new MetricsCollectorError('Entries must be an array', {
        operation: 'recordBatch',
      });
    }

    if (entries.length === 0) {
      return { recorded: 0, failed: 0 };
    }

    let recorded = 0;
    let failed = 0;

    for (const entry of entries) {
      try {
        await this.record(entry.component, entry.metric, entry.value, entry.timestamp);
        recorded++;
      } catch (_err) {
        failed++;
        this._log(`Failed to record batch entry: ${entry.component}.${entry.metric}`);
      }
    }

    this._log(`Batch complete: ${recorded} recorded, ${failed} failed`);
    return { recorded, failed };
  }

  /**
   * Store health check results from HealthMonitor
   *
   * Extracts numeric fields from each check result and stores them as
   * individual metrics. The check status is mapped to a numeric value
   * (healthy=1, degraded=0.5, unhealthy=0).
   *
   * @param {Object} checkResults - Map of check name to result object from HealthMonitor.runChecks()
   * @returns {Promise<{recorded: number, failed: number}>} Result counts
   */
  async storeCheckResults(checkResults) {
    const entries = [];

    for (const [name, result] of Object.entries(checkResults)) {
      // Map status to numeric value
      const statusValue = this._statusToValue(result.status);
      entries.push({ component: name, metric: 'status', value: statusValue });

      // Store latencyMs if present
      if (typeof result.latencyMs === 'number') {
        entries.push({ component: name, metric: 'latency_ms', value: result.latencyMs });
      }

      // Store any other numeric fields from the result
      for (const [key, val] of Object.entries(result)) {
        if (key === 'status' || key === 'latencyMs' || key === 'lastCheckAt' || key === 'error') {
          continue;
        }
        if (typeof val === 'number') {
          entries.push({ component: name, metric: key, value: val });
        }
      }
    }

    return this.recordBatch(entries);
  }

  /**
   * Query historical metrics with optional filters
   *
   * @param {Object} [filter={}] - Query filters
   * @param {string} [filter.component] - Filter by component name
   * @param {string} [filter.metric] - Filter by metric name
   * @param {Date} [filter.since] - Only metrics after this time
   * @param {Date} [filter.until] - Only metrics before this time
   * @param {number} [filter.limit=1000] - Maximum rows to return
   * @returns {Promise<Array<{component: string, metric: string, value: number, timestamp: Date}>>} Metric records
   * @throws {MetricsCollectorError} If query fails
   */
  async query(filter = {}) {
    const { component, metric, since, until, limit = DEFAULT_QUERY_LIMIT } = filter;

    try {
      let sql = 'SELECT component, metric, value, timestamp FROM health_metrics WHERE 1=1';
      const params = [];

      if (component) {
        params.push(component);
        sql += ` AND component = $${params.length}`;
      }

      if (metric) {
        params.push(metric);
        sql += ` AND metric = $${params.length}`;
      }

      if (since) {
        params.push(since);
        sql += ` AND timestamp >= $${params.length}`;
      }

      if (until) {
        params.push(until);
        sql += ` AND timestamp <= $${params.length}`;
      }

      params.push(limit);
      sql += ` ORDER BY timestamp DESC LIMIT $${params.length}`;

      const { rows } = await this.storage.query(sql, params);
      return rows;
    } catch (err) {
      throw new MetricsCollectorError(`Failed to query metrics: ${err.message}`, {
        cause: err,
        operation: 'query',
        component,
      });
    }
  }

  /**
   * Apply retention policy by deleting metrics older than the specified number of days
   *
   * @param {number} [days] - Number of days to retain (defaults to this.retentionDays)
   * @returns {Promise<number>} Number of deleted rows
   * @throws {MetricsCollectorError} If deletion fails
   */
  async applyRetention(days) {
    const retentionDays = days ?? this.retentionDays;

    if (typeof retentionDays !== 'number' || retentionDays <= 0) {
      throw new MetricsCollectorError('Retention days must be a positive number', {
        operation: 'applyRetention',
      });
    }

    try {
      const { rowCount } = await this.storage.query(
        `DELETE FROM health_metrics WHERE timestamp < NOW() - $1 * INTERVAL '1 day'`,
        [retentionDays]
      );

      this._log(`Retention applied: deleted ${rowCount} metrics older than ${retentionDays} days`);
      return rowCount;
    } catch (err) {
      throw new MetricsCollectorError(`Failed to apply retention: ${err.message}`, {
        cause: err,
        operation: 'applyRetention',
      });
    }
  }

  /**
   * Get the latest value for each metric of a given component
   *
   * @param {string} component - Component name
   * @returns {Promise<Object>} Map of metric name to latest value and timestamp
   * @throws {MetricsCollectorError} If query fails
   */
  async getLatest(component) {
    if (!component || typeof component !== 'string') {
      throw new MetricsCollectorError('Component must be a non-empty string', {
        operation: 'getLatest',
      });
    }

    try {
      const { rows } = await this.storage.query(
        `SELECT DISTINCT ON (metric) metric, value, timestamp
         FROM health_metrics
         WHERE component = $1
         ORDER BY metric, timestamp DESC`,
        [component]
      );

      const result = {};
      for (const row of rows) {
        result[row.metric] = { value: row.value, timestamp: row.timestamp };
      }

      return result;
    } catch (err) {
      throw new MetricsCollectorError(`Failed to get latest metrics: ${err.message}`, {
        cause: err,
        operation: 'getLatest',
        component,
      });
    }
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  /**
   * Map a health status string to a numeric value
   *
   * @param {string} status - Health status ('healthy', 'degraded', 'unhealthy')
   * @returns {number} Numeric value (1 = healthy, 0.5 = degraded, 0 = unhealthy)
   * @private
   */
  _statusToValue(status) {
    switch (status) {
      case 'healthy':
        return 1;
      case 'degraded':
        return 0.5;
      case 'unhealthy':
        return 0;
      default:
        return 0;
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
      this.logger(`[MetricsCollector] ${message}`);
    }
  }
}
