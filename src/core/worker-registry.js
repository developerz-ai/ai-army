/**
 * WorkerRegistry - Distributed worker node management with PostgreSQL persistence
 *
 * Manages the lifecycle of worker nodes in the distributed bot deployment system.
 * Workers can be local (same machine) or remote (connected via SSH tunnels).
 * Each worker has a capacity (max containers), current load, health status,
 * and heartbeat tracking for dead worker detection.
 *
 * Features:
 * - Register and unregister worker nodes
 * - Heartbeat-based health monitoring with configurable thresholds
 * - Load-aware worker selection for bot placement
 * - Dead worker detection (marks workers offline when heartbeat exceeds threshold)
 *
 * Dependencies:
 * - storage: PostgresStorage instance for persisting worker state
 *
 * @module core/worker-registry
 */

/**
 * Valid worker status values
 * @type {Readonly<Object>}
 */
export const WORKER_STATUSES = Object.freeze({
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  OFFLINE: 'offline',
});

/**
 * Valid worker type values
 * @type {Readonly<Object>}
 */
export const WORKER_TYPES = Object.freeze({
  LOCAL: 'local',
  REMOTE: 'remote',
});

/**
 * Default heartbeat threshold in milliseconds (30 seconds)
 * Workers with heartbeats older than this are considered unhealthy.
 * @type {number}
 */
const DEFAULT_HEARTBEAT_THRESHOLD_MS = 30_000;

/**
 * Custom error for worker registry failures
 */
export class WorkerRegistryError extends Error {
  /**
   * Create a WorkerRegistryError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - The operation that failed
   * @param {string} [options.workerId] - ID of the worker involved
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'WorkerRegistryError';
    this.operation = options.operation;
    this.workerId = options.workerId;
  }
}

/**
 * WorkerRegistry - manages distributed worker nodes with PostgreSQL persistence
 */
export class WorkerRegistry {
  /**
   * Create a WorkerRegistry instance
   * @param {Object} storage - PostgresStorage instance for persistence
   * @param {Object} [options={}] - Configuration options
   * @param {number} [options.heartbeatThresholdMs=30000] - Heartbeat threshold in ms for dead worker detection
   */
  constructor(storage, options = {}) {
    if (!storage) {
      throw new WorkerRegistryError('Storage is required', {
        operation: 'constructor',
      });
    }

    this.storage = storage;

    /** @type {number} Heartbeat threshold in ms for dead worker detection */
    this.heartbeatThresholdMs = options.heartbeatThresholdMs || DEFAULT_HEARTBEAT_THRESHOLD_MS;
  }

  // ============================================================================
  // Worker Registration
  // ============================================================================

  /**
   * Register a new worker node
   *
   * Inserts a worker record into the database with initial healthy status
   * and sets the first heartbeat timestamp. The worker is immediately
   * available for bot container placement.
   *
   * @param {Object} config - Worker configuration
   * @param {string} config.id - Unique worker identifier (e.g., 'local', 'gpu-server')
   * @param {string} config.host - Worker hostname or IP address
   * @param {string} config.type - Worker type: 'local' or 'remote'
   * @param {number} [config.maxContainers=10] - Maximum number of bot containers
   * @returns {Promise<Object>} Registered worker record
   * @throws {WorkerRegistryError} If validation fails or worker already exists
   */
  async registerWorker(config) {
    if (!config || typeof config !== 'object') {
      throw new WorkerRegistryError('Worker config must be a non-null object', {
        operation: 'registerWorker',
      });
    }

    const { id, host, type, maxContainers = 10 } = config;

    if (!id || typeof id !== 'string') {
      throw new WorkerRegistryError('Worker ID must be a non-empty string', {
        operation: 'registerWorker',
      });
    }

    if (!host || typeof host !== 'string') {
      throw new WorkerRegistryError('Worker host must be a non-empty string', {
        operation: 'registerWorker',
        workerId: id,
      });
    }

    if (!type || !Object.values(WORKER_TYPES).includes(type)) {
      throw new WorkerRegistryError(
        `Worker type must be one of: ${Object.values(WORKER_TYPES).join(', ')}`,
        {
          operation: 'registerWorker',
          workerId: id,
        }
      );
    }

    if (typeof maxContainers !== 'number' || maxContainers < 1) {
      throw new WorkerRegistryError('maxContainers must be a positive integer', {
        operation: 'registerWorker',
        workerId: id,
      });
    }

    try {
      // Check for existing worker
      const existing = await this._getWorkerRow(id);
      if (existing) {
        throw new WorkerRegistryError(`Worker '${id}' already exists`, {
          operation: 'registerWorker',
          workerId: id,
        });
      }

      const { rows } = await this.storage.query(
        `INSERT INTO workers (id, host, type, max_containers, current_load, status, last_heartbeat)
         VALUES ($1, $2, $3, $4, 0, $5, NOW())
         RETURNING *`,
        [id, host, type, maxContainers, WORKER_STATUSES.HEALTHY]
      );

      return this._toWorker(rows[0]);
    } catch (err) {
      if (err instanceof WorkerRegistryError) {
        throw err;
      }
      throw new WorkerRegistryError(`Failed to register worker '${id}': ${err.message}`, {
        cause: err,
        operation: 'registerWorker',
        workerId: id,
      });
    }
  }

  /**
   * Unregister a worker node
   *
   * Removes the worker record from the database. The worker must not
   * have any active containers (current_load must be 0) unless force is true.
   *
   * @param {string} workerId - Worker identifier
   * @param {Object} [options={}] - Unregister options
   * @param {boolean} [options.force=false] - Force unregister even if worker has active containers
   * @returns {Promise<boolean>} True if worker was removed, false if not found
   * @throws {WorkerRegistryError} If worker has active containers and force is false
   */
  async unregisterWorker(workerId, options = {}) {
    if (!workerId || typeof workerId !== 'string') {
      throw new WorkerRegistryError('Worker ID must be a non-empty string', {
        operation: 'unregisterWorker',
      });
    }

    try {
      const existing = await this._getWorkerRow(workerId);
      if (!existing) {
        return false;
      }

      if (existing.current_load > 0 && !options.force) {
        throw new WorkerRegistryError(
          `Worker '${workerId}' has ${existing.current_load} active container(s). ` +
            'Use force option to unregister anyway.',
          {
            operation: 'unregisterWorker',
            workerId,
          }
        );
      }

      const { rowCount } = await this.storage.query('DELETE FROM workers WHERE id = $1', [
        workerId,
      ]);

      return rowCount > 0;
    } catch (err) {
      if (err instanceof WorkerRegistryError) {
        throw err;
      }
      throw new WorkerRegistryError(`Failed to unregister worker '${workerId}': ${err.message}`, {
        cause: err,
        operation: 'unregisterWorker',
        workerId,
      });
    }
  }

  // ============================================================================
  // Worker Queries
  // ============================================================================

  /**
   * List all registered workers
   *
   * Returns all workers ordered by creation date (newest first).
   * Optionally filter by status or type.
   *
   * @param {Object} [filter={}] - Optional filters
   * @param {string} [filter.status] - Filter by status ('healthy', 'degraded', 'offline')
   * @param {string} [filter.type] - Filter by type ('local', 'remote')
   * @returns {Promise<Array<Object>>} Array of worker records
   * @throws {WorkerRegistryError} If query fails
   */
  async listWorkers(filter = {}) {
    try {
      let sql = 'SELECT * FROM workers';
      const params = [];
      const conditions = [];

      if (filter.status) {
        conditions.push(`status = $${params.length + 1}`);
        params.push(filter.status);
      }

      if (filter.type) {
        conditions.push(`type = $${params.length + 1}`);
        params.push(filter.type);
      }

      if (conditions.length > 0) {
        sql += ` WHERE ${conditions.join(' AND ')}`;
      }

      sql += ' ORDER BY created_at DESC';

      const { rows } = await this.storage.query(sql, params);
      return rows.map(row => this._toWorker(row));
    } catch (err) {
      throw new WorkerRegistryError(`Failed to list workers: ${err.message}`, {
        cause: err,
        operation: 'listWorkers',
      });
    }
  }

  /**
   * Get a worker by ID
   *
   * @param {string} workerId - Worker identifier
   * @returns {Promise<Object|null>} Worker record or null if not found
   * @throws {WorkerRegistryError} If query fails
   */
  async getWorker(workerId) {
    if (!workerId || typeof workerId !== 'string') {
      throw new WorkerRegistryError('Worker ID must be a non-empty string', {
        operation: 'getWorker',
      });
    }

    try {
      const row = await this._getWorkerRow(workerId);
      return row ? this._toWorker(row) : null;
    } catch (err) {
      if (err instanceof WorkerRegistryError) {
        throw err;
      }
      throw new WorkerRegistryError(`Failed to get worker '${workerId}': ${err.message}`, {
        cause: err,
        operation: 'getWorker',
        workerId,
      });
    }
  }

  /**
   * Get an available worker for bot placement
   *
   * Selects the healthiest worker with available capacity using a
   * least-loaded strategy. Only considers workers in 'healthy' status
   * with current_load < max_containers.
   *
   * Selection criteria (in order):
   * 1. Worker must be healthy
   * 2. Worker must have available capacity
   * 3. Worker with the lowest load ratio (current_load / max_containers) is preferred
   *
   * @param {string} _botId - Bot identifier (reserved for future affinity-based assignment)
   * @returns {Promise<Object|null>} Available worker record or null if none available
   * @throws {WorkerRegistryError} If query fails
   */
  async getAvailableWorker(_botId) {
    try {
      const { rows } = await this.storage.query(
        `SELECT * FROM workers
         WHERE status = $1
           AND current_load < max_containers
         ORDER BY (current_load::float / max_containers::float) ASC, created_at ASC
         LIMIT 1`,
        [WORKER_STATUSES.HEALTHY]
      );

      return rows.length > 0 ? this._toWorker(rows[0]) : null;
    } catch (err) {
      throw new WorkerRegistryError(`Failed to get available worker: ${err.message}`, {
        cause: err,
        operation: 'getAvailableWorker',
      });
    }
  }

  // ============================================================================
  // Heartbeat & Health
  // ============================================================================

  /**
   * Update a worker's heartbeat timestamp
   *
   * Records the current time as the worker's last heartbeat.
   * If the worker was previously degraded, it is restored to healthy status.
   *
   * @param {string} workerId - Worker identifier
   * @returns {Promise<Object|null>} Updated worker record or null if not found
   * @throws {WorkerRegistryError} If update fails
   */
  async updateHeartbeat(workerId) {
    if (!workerId || typeof workerId !== 'string') {
      throw new WorkerRegistryError('Worker ID must be a non-empty string', {
        operation: 'updateHeartbeat',
      });
    }

    try {
      const { rows } = await this.storage.query(
        `UPDATE workers
         SET last_heartbeat = NOW(),
             status = CASE
               WHEN status = $2 THEN $3
               ELSE status
             END
         WHERE id = $1
         RETURNING *`,
        [workerId, WORKER_STATUSES.DEGRADED, WORKER_STATUSES.HEALTHY]
      );

      return rows.length > 0 ? this._toWorker(rows[0]) : null;
    } catch (err) {
      throw new WorkerRegistryError(
        `Failed to update heartbeat for worker '${workerId}': ${err.message}`,
        {
          cause: err,
          operation: 'updateHeartbeat',
          workerId,
        }
      );
    }
  }

  /**
   * Get the current load for a worker
   *
   * Returns the worker's load information including current containers,
   * maximum capacity, and load ratio.
   *
   * @param {string} workerId - Worker identifier
   * @returns {Promise<Object|null>} Load info or null if worker not found
   * @throws {WorkerRegistryError} If query fails
   */
  async getWorkerLoad(workerId) {
    if (!workerId || typeof workerId !== 'string') {
      throw new WorkerRegistryError('Worker ID must be a non-empty string', {
        operation: 'getWorkerLoad',
      });
    }

    try {
      const { rows } = await this.storage.query(
        'SELECT id, current_load, max_containers, status FROM workers WHERE id = $1',
        [workerId]
      );

      if (rows.length === 0) {
        return null;
      }

      const row = rows[0];
      return {
        workerId: row.id,
        currentLoad: row.current_load,
        maxContainers: row.max_containers,
        available: row.max_containers - row.current_load,
        loadRatio: row.max_containers > 0 ? row.current_load / row.max_containers : 1,
        status: row.status,
      };
    } catch (err) {
      throw new WorkerRegistryError(`Failed to get load for worker '${workerId}': ${err.message}`, {
        cause: err,
        operation: 'getWorkerLoad',
        workerId,
      });
    }
  }

  /**
   * Increment the current load of a worker
   *
   * Atomically increments the worker's current_load by 1.
   * Fails if the worker is at capacity.
   *
   * @param {string} workerId - Worker identifier
   * @returns {Promise<Object|null>} Updated worker record or null if not found/at capacity
   * @throws {WorkerRegistryError} If update fails
   */
  async incrementLoad(workerId) {
    if (!workerId || typeof workerId !== 'string') {
      throw new WorkerRegistryError('Worker ID must be a non-empty string', {
        operation: 'incrementLoad',
      });
    }

    try {
      const { rows } = await this.storage.query(
        `UPDATE workers
         SET current_load = current_load + 1
         WHERE id = $1
           AND current_load < max_containers
         RETURNING *`,
        [workerId]
      );

      return rows.length > 0 ? this._toWorker(rows[0]) : null;
    } catch (err) {
      throw new WorkerRegistryError(
        `Failed to increment load for worker '${workerId}': ${err.message}`,
        {
          cause: err,
          operation: 'incrementLoad',
          workerId,
        }
      );
    }
  }

  /**
   * Decrement the current load of a worker
   *
   * Atomically decrements the worker's current_load by 1.
   * Fails if the worker's load is already 0.
   *
   * @param {string} workerId - Worker identifier
   * @returns {Promise<Object|null>} Updated worker record or null if not found/already at 0
   * @throws {WorkerRegistryError} If update fails
   */
  async decrementLoad(workerId) {
    if (!workerId || typeof workerId !== 'string') {
      throw new WorkerRegistryError('Worker ID must be a non-empty string', {
        operation: 'decrementLoad',
      });
    }

    try {
      const { rows } = await this.storage.query(
        `UPDATE workers
         SET current_load = current_load - 1
         WHERE id = $1
           AND current_load > 0
         RETURNING *`,
        [workerId]
      );

      return rows.length > 0 ? this._toWorker(rows[0]) : null;
    } catch (err) {
      throw new WorkerRegistryError(
        `Failed to decrement load for worker '${workerId}': ${err.message}`,
        {
          cause: err,
          operation: 'decrementLoad',
          workerId,
        }
      );
    }
  }

  /**
   * Detect and mark dead workers
   *
   * Scans for workers whose last heartbeat exceeds the configured threshold.
   * Workers with stale heartbeats are marked as 'offline' and returned.
   *
   * @returns {Promise<Array<Object>>} Array of workers that were marked offline
   * @throws {WorkerRegistryError} If detection fails
   */
  async detectDeadWorkers() {
    try {
      const thresholdSeconds = Math.floor(this.heartbeatThresholdMs / 1000);

      const { rows } = await this.storage.query(
        `UPDATE workers
         SET status = $1
         WHERE status != $1
           AND (last_heartbeat IS NULL
                OR last_heartbeat < NOW() - ($2 || ' seconds')::interval)
         RETURNING *`,
        [WORKER_STATUSES.OFFLINE, String(thresholdSeconds)]
      );

      return rows.map(row => this._toWorker(row));
    } catch (err) {
      throw new WorkerRegistryError(`Failed to detect dead workers: ${err.message}`, {
        cause: err,
        operation: 'detectDeadWorkers',
      });
    }
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Fetch a raw worker row from the database by ID
   *
   * @param {string} workerId - Worker identifier
   * @returns {Promise<Object|null>} Raw database row or null
   * @private
   */
  async _getWorkerRow(workerId) {
    const { rows } = await this.storage.query('SELECT * FROM workers WHERE id = $1', [workerId]);
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Transform a database row into a camelCase worker object
   *
   * Maps snake_case database columns to camelCase JavaScript properties
   * for consistent API usage.
   *
   * @param {Object} row - Raw database row
   * @returns {Object} Worker object with camelCase keys
   * @private
   */
  _toWorker(row) {
    return {
      id: row.id,
      host: row.host,
      type: row.type,
      maxContainers: row.max_containers,
      currentLoad: row.current_load,
      status: row.status,
      lastHeartbeat: row.last_heartbeat ? new Date(row.last_heartbeat) : null,
      createdAt: row.created_at ? new Date(row.created_at) : null,
      updatedAt: row.updated_at ? new Date(row.updated_at) : null,
    };
  }
}
