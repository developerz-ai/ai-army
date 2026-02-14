/**
 * WorkerAssigner - Intelligent bot-to-worker assignment with load balancing and failover
 *
 * Determines which worker node should host a given bot based on:
 * - Pattern-based assignment rules (e.g., `devops-*` → GPU worker)
 * - Load balancing using least-loaded strategy (lowest current_load / max_containers ratio)
 * - Worker preference hints from bot configuration
 * - Automatic failover when a worker goes offline
 * - Rebalancing to redistribute bots across workers
 *
 * Dependencies:
 * - workerRegistry: WorkerRegistry instance for worker state queries
 * - sshTunnelManager: SSHTunnelManager instance for remote Docker access (optional)
 *
 * @module core/worker-assigner
 */

import { WORKER_STATUSES, WORKER_TYPES } from './worker-registry.js';

/**
 * Custom error class for WorkerAssigner failures
 */
export class WorkerAssignerError extends Error {
  /**
   * Create a WorkerAssignerError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - The operation that failed
   * @param {string} [options.botId] - ID of the bot involved
   * @param {string} [options.workerId] - ID of the worker involved
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'WorkerAssignerError';
    this.operation = options.operation;
    this.botId = options.botId;
    this.workerId = options.workerId;
  }
}

/**
 * WorkerAssigner - assigns bots to workers with load balancing and failover
 *
 * @example
 * const assigner = new WorkerAssigner(workerRegistry, {
 *   sshTunnelManager: tunnelManager,
 *   assignmentRules: [
 *     { pattern: 'devops-*', workerId: 'gpu-server' },
 *     { pattern: 'ml-*', workerId: 'gpu-server' },
 *   ],
 * });
 *
 * // Assign a bot to a worker
 * const assignment = await assigner.assignBot('devops-deploy');
 * // => { workerId: 'gpu-server', dockerHost: 'tcp://127.0.0.1:54321', incusHost: null }
 *
 * // Failover bots from a dead worker
 * const reassigned = await assigner.failover('gpu-server');
 *
 * // Rebalance bots across workers
 * const moves = await assigner.rebalance();
 */
export class WorkerAssigner {
  /**
   * Create a WorkerAssigner instance
   *
   * @param {Object} workerRegistry - WorkerRegistry instance for worker state
   * @param {Object} [options={}] - Configuration options
   * @param {Object} [options.sshTunnelManager] - SSHTunnelManager for remote Docker access
   * @param {Array<Object>} [options.assignmentRules=[]] - Pattern-based assignment rules
   * @param {string} options.assignmentRules[].pattern - Glob-like pattern for bot ID matching
   * @param {string} options.assignmentRules[].workerId - Target worker ID for matching bots
   * @param {Object} [options.logger=console] - Logger instance
   */
  constructor(workerRegistry, options = {}) {
    if (!workerRegistry) {
      throw new WorkerAssignerError('WorkerRegistry is required', {
        operation: 'constructor',
      });
    }

    /** @type {Object} WorkerRegistry instance */
    this.workerRegistry = workerRegistry;

    /** @type {Object|null} SSHTunnelManager for remote Docker access */
    this.sshTunnelManager = options.sshTunnelManager || null;

    /** @type {Array<Object>} Pattern-based assignment rules */
    this.assignmentRules = options.assignmentRules || [];

    /** @type {Object} Logger instance */
    this.logger = options.logger || console;

    /** @type {Map<string, string>} In-memory map of botId -> workerId assignments */
    this.assignments = new Map();
  }

  // ============================================================================
  // Bot Assignment
  // ============================================================================

  /**
   * Assign a bot to the most suitable worker
   *
   * Selection strategy:
   * 1. If a worker preference is provided, try that worker first
   * 2. Check assignment rules for pattern-based matching
   * 3. Fall back to load-balanced selection (least-loaded healthy worker)
   *
   * After selecting a worker, increments its load counter and resolves
   * the Docker host (local socket or SSH tunnel endpoint).
   *
   * @param {string} botId - Bot identifier
   * @param {Object} [preference={}] - Assignment preferences
   * @param {string} [preference.workerId] - Preferred worker ID
   * @returns {Promise<Object>} Assignment result
   * @returns {string} result.workerId - Assigned worker ID
   * @returns {string|null} result.dockerHost - Docker host for container creation
   * @returns {string|null} result.incusHost - Incus host for container creation (tunneled socket)
   * @returns {string} result.workerType - Worker type ('local' or 'remote')
   * @throws {WorkerAssignerError} If no worker is available or assignment fails
   */
  async assignBot(botId, preference = {}) {
    if (!botId || typeof botId !== 'string') {
      throw new WorkerAssignerError('Bot ID must be a non-empty string', {
        operation: 'assignBot',
      });
    }

    try {
      let worker = null;

      // Strategy 1: Try explicit worker preference
      if (preference.workerId) {
        worker = await this._tryPreferredWorker(preference.workerId, botId);
      }

      // Strategy 2: Check pattern-based assignment rules
      if (!worker) {
        worker = await this._tryPatternMatch(botId);
      }

      // Strategy 3: Fall back to least-loaded worker
      if (!worker) {
        worker = await this._selectLeastLoadedWorker();
      }

      if (!worker) {
        throw new WorkerAssignerError(
          `No available worker for bot '${botId}'. All workers are at capacity or offline.`,
          {
            operation: 'assignBot',
            botId,
          }
        );
      }

      // Increment the worker's load count
      const updated = await this.workerRegistry.incrementLoad(worker.id);
      if (!updated) {
        throw new WorkerAssignerError(
          `Failed to reserve capacity on worker '${worker.id}' for bot '${botId}'`,
          {
            operation: 'assignBot',
            botId,
            workerId: worker.id,
          }
        );
      }

      // Resolve Docker and Incus hosts for this worker
      const dockerHost = this._resolveDockerHost(worker);
      const incusHost = this._resolveIncusHost(worker);

      // Track assignment
      this.assignments.set(botId, worker.id);

      this.logger.info(
        `[WorkerAssigner] Assigned bot '${botId}' to worker '${worker.id}' ` +
          `(type: ${worker.type}, load: ${worker.currentLoad + 1}/${worker.maxContainers})`
      );

      return {
        workerId: worker.id,
        dockerHost,
        incusHost,
        workerType: worker.type,
      };
    } catch (err) {
      if (err instanceof WorkerAssignerError) {
        throw err;
      }
      throw new WorkerAssignerError(`Failed to assign bot '${botId}': ${err.message}`, {
        cause: err,
        operation: 'assignBot',
        botId,
      });
    }
  }

  /**
   * Release a bot's worker assignment
   *
   * Decrements the worker's load counter and removes the assignment tracking.
   *
   * @param {string} botId - Bot identifier
   * @returns {Promise<boolean>} True if assignment was released, false if not found
   * @throws {WorkerAssignerError} If release fails
   */
  async releaseBot(botId) {
    if (!botId || typeof botId !== 'string') {
      throw new WorkerAssignerError('Bot ID must be a non-empty string', {
        operation: 'releaseBot',
      });
    }

    const workerId = this.assignments.get(botId);
    if (!workerId) {
      return false;
    }

    try {
      await this.workerRegistry.decrementLoad(workerId);
      this.assignments.delete(botId);

      this.logger.info(`[WorkerAssigner] Released bot '${botId}' from worker '${workerId}'`);

      return true;
    } catch (err) {
      throw new WorkerAssignerError(
        `Failed to release bot '${botId}' from worker '${workerId}': ${err.message}`,
        {
          cause: err,
          operation: 'releaseBot',
          botId,
          workerId,
        }
      );
    }
  }

  /**
   * Get the current worker assignment for a bot
   *
   * @param {string} botId - Bot identifier
   * @returns {string|undefined} Worker ID or undefined if not assigned
   */
  getAssignment(botId) {
    return this.assignments.get(botId);
  }

  // ============================================================================
  // Rebalancing
  // ============================================================================

  /**
   * Rebalance bot assignments across workers
   *
   * Identifies overloaded workers and moves bots to workers with more
   * available capacity. Uses a threshold-based approach: workers loaded
   * above the average load ratio are candidates for offloading.
   *
   * @returns {Promise<Array<Object>>} Array of moves performed
   * @returns {string} move.botId - Bot that was moved
   * @returns {string} move.fromWorkerId - Previous worker
   * @returns {string} move.toWorkerId - New worker
   * @throws {WorkerAssignerError} If rebalancing fails
   */
  async rebalance() {
    try {
      const workers = await this.workerRegistry.listWorkers({
        status: WORKER_STATUSES.HEALTHY,
      });

      if (workers.length < 2) {
        this.logger.info('[WorkerAssigner] Rebalance skipped: fewer than 2 healthy workers');
        return [];
      }

      // Calculate average load ratio
      const totalLoadRatio = workers.reduce((sum, w) => {
        const ratio = w.maxContainers > 0 ? w.currentLoad / w.maxContainers : 1;
        return sum + ratio;
      }, 0);
      const avgLoadRatio = totalLoadRatio / workers.length;

      // Identify overloaded workers (above average + 10% threshold)
      const rebalanceThreshold = avgLoadRatio + 0.1;
      const overloaded = workers.filter(w => {
        const ratio = w.maxContainers > 0 ? w.currentLoad / w.maxContainers : 1;
        return ratio > rebalanceThreshold;
      });

      // Identify underloaded workers (below average) sorted by load ratio asc
      const underloaded = workers
        .filter(w => {
          const ratio = w.maxContainers > 0 ? w.currentLoad / w.maxContainers : 1;
          return ratio < avgLoadRatio && w.currentLoad < w.maxContainers;
        })
        .sort((a, b) => {
          const ratioA = a.maxContainers > 0 ? a.currentLoad / a.maxContainers : 1;
          const ratioB = b.maxContainers > 0 ? b.currentLoad / b.maxContainers : 1;
          return ratioA - ratioB;
        });

      if (overloaded.length === 0 || underloaded.length === 0) {
        this.logger.info('[WorkerAssigner] Rebalance: no moves needed, load is balanced');
        return [];
      }

      const moves = [];

      // Find bots on overloaded workers and move them to underloaded ones
      for (const overWorker of overloaded) {
        const botsOnWorker = this._getBotsOnWorker(overWorker.id);

        // Move bots until this worker is at or below average
        for (const botId of botsOnWorker) {
          // Recompute ratio each iteration using updated currentLoad
          const ratio =
            overWorker.maxContainers > 0 ? overWorker.currentLoad / overWorker.maxContainers : 1;

          if (ratio <= avgLoadRatio || underloaded.length === 0) {
            break;
          }

          // Find a target worker with capacity
          const target = underloaded.find(w => w.currentLoad < w.maxContainers);
          if (!target) {
            break;
          }

          // Perform the move (decrement source, increment target)
          const decremented = await this.workerRegistry.decrementLoad(overWorker.id);
          const updated = await this.workerRegistry.incrementLoad(target.id);

          if (updated) {
            this.assignments.set(botId, target.id);
            target.currentLoad += 1;
            overWorker.currentLoad -= 1;

            moves.push({
              botId,
              fromWorkerId: overWorker.id,
              toWorkerId: target.id,
            });

            this.logger.info(
              `[WorkerAssigner] Rebalance: moved bot '${botId}' ` +
                `from '${overWorker.id}' to '${target.id}'`
            );
          } else if (decremented) {
            // Rollback source decrement only if it actually succeeded
            await this.workerRegistry.incrementLoad(overWorker.id);
          }
        }
      }

      this.logger.info(`[WorkerAssigner] Rebalance complete: ${moves.length} bot(s) moved`);

      return moves;
    } catch (err) {
      if (err instanceof WorkerAssignerError) {
        throw err;
      }
      throw new WorkerAssignerError(`Failed to rebalance: ${err.message}`, {
        cause: err,
        operation: 'rebalance',
      });
    }
  }

  // ============================================================================
  // Failover
  // ============================================================================

  /**
   * Failover bots from a failed worker to healthy workers
   *
   * When a worker goes offline, reassigns all its bots to other healthy
   * workers using load-balanced selection. Each bot is independently
   * reassigned; if some reassignments fail, the others still succeed.
   *
   * @param {string} failedWorkerId - ID of the failed worker
   * @returns {Promise<Object>} Failover results
   * @returns {Array<Object>} results.reassigned - Successfully reassigned bots
   * @returns {Array<Object>} results.failed - Bots that could not be reassigned
   * @throws {WorkerAssignerError} If failedWorkerId is invalid
   */
  async failover(failedWorkerId) {
    if (!failedWorkerId || typeof failedWorkerId !== 'string') {
      throw new WorkerAssignerError('Failed worker ID must be a non-empty string', {
        operation: 'failover',
      });
    }

    try {
      const results = {
        reassigned: [],
        failed: [],
      };

      // Find all bots assigned to the failed worker
      const affectedBots = this._getBotsOnWorker(failedWorkerId);

      if (affectedBots.length === 0) {
        this.logger.info(
          `[WorkerAssigner] Failover: no bots assigned to worker '${failedWorkerId}'`
        );
        return results;
      }

      this.logger.info(
        `[WorkerAssigner] Failover: reassigning ${affectedBots.length} bot(s) ` +
          `from failed worker '${failedWorkerId}'`
      );

      // Reassign each bot to a healthy worker
      for (const botId of affectedBots) {
        let loadIncremented = false;
        let targetWorkerId = null;
        try {
          // Remove old assignment
          this.assignments.delete(botId);

          // Find a new worker (exclude the failed one)
          const newWorker = await this._selectLeastLoadedWorker([failedWorkerId]);

          if (!newWorker) {
            results.failed.push({
              botId,
              reason: 'No healthy worker available',
            });
            this.logger.warn(`[WorkerAssigner] Failover: no worker available for bot '${botId}'`);
            continue;
          }

          targetWorkerId = newWorker.id;

          // Reserve capacity on the new worker
          const updated = await this.workerRegistry.incrementLoad(newWorker.id);

          if (!updated) {
            results.failed.push({
              botId,
              reason: `Worker '${newWorker.id}' at capacity`,
            });
            continue;
          }

          loadIncremented = true;

          // Track new assignment
          this.assignments.set(botId, newWorker.id);
          const dockerHost = this._resolveDockerHost(newWorker);
          const incusHost = this._resolveIncusHost(newWorker);

          results.reassigned.push({
            botId,
            fromWorkerId: failedWorkerId,
            toWorkerId: newWorker.id,
            dockerHost,
            incusHost,
          });

          this.logger.info(
            `[WorkerAssigner] Failover: reassigned bot '${botId}' ` +
              `from '${failedWorkerId}' to '${newWorker.id}'`
          );
        } catch (err) {
          // Rollback load increment if it succeeded before the error
          if (loadIncremented && targetWorkerId) {
            try {
              await this.workerRegistry.decrementLoad(targetWorkerId);
            } catch (_rollbackErr) {
              this.logger.error(
                `[WorkerAssigner] Failover: failed to rollback load for worker '${targetWorkerId}'`
              );
            }
          }
          results.failed.push({
            botId,
            reason: err.message,
          });
          this.logger.error(
            `[WorkerAssigner] Failover: failed to reassign bot '${botId}': ${err.message}`
          );
        }
      }

      // Decrement load on the failed worker for each successfully reassigned bot
      for (let i = 0; i < results.reassigned.length; i++) {
        try {
          await this.workerRegistry.decrementLoad(failedWorkerId);
        } catch (_err) {
          // Failed worker may not respond to load decrements - this is expected
        }
      }

      this.logger.info(
        `[WorkerAssigner] Failover complete: ${results.reassigned.length} reassigned, ` +
          `${results.failed.length} failed`
      );

      return results;
    } catch (err) {
      if (err instanceof WorkerAssignerError) {
        throw err;
      }
      throw new WorkerAssignerError(
        `Failed to failover from worker '${failedWorkerId}': ${err.message}`,
        {
          cause: err,
          operation: 'failover',
          workerId: failedWorkerId,
        }
      );
    }
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Try to use a preferred worker for assignment
   *
   * Validates the preferred worker exists, is healthy, and has capacity.
   *
   * @param {string} workerId - Preferred worker ID
   * @param {string} botId - Bot identifier (for logging)
   * @returns {Promise<Object|null>} Worker object or null if unavailable
   * @private
   */
  async _tryPreferredWorker(workerId, botId) {
    try {
      const worker = await this.workerRegistry.getWorker(workerId);

      if (!worker) {
        this.logger.warn(
          `[WorkerAssigner] Preferred worker '${workerId}' not found for bot '${botId}'`
        );
        return null;
      }

      if (worker.status !== WORKER_STATUSES.HEALTHY) {
        this.logger.warn(
          `[WorkerAssigner] Preferred worker '${workerId}' is ${worker.status} ` +
            `for bot '${botId}', trying alternatives`
        );
        return null;
      }

      if (worker.currentLoad >= worker.maxContainers) {
        this.logger.warn(
          `[WorkerAssigner] Preferred worker '${workerId}' is at capacity ` +
            `(${worker.currentLoad}/${worker.maxContainers}) for bot '${botId}'`
        );
        return null;
      }

      return worker;
    } catch (err) {
      this.logger.warn(
        `[WorkerAssigner] Error checking preferred worker '${workerId}': ${err.message}`
      );
      return null;
    }
  }

  /**
   * Try to match a bot against pattern-based assignment rules
   *
   * Converts glob-like patterns (e.g., `devops-*`) to regex patterns
   * and tests the bot ID against each rule in order. The first matching
   * rule determines the target worker.
   *
   * @param {string} botId - Bot identifier to match
   * @returns {Promise<Object|null>} Worker object or null if no pattern matches
   * @private
   */
  async _tryPatternMatch(botId) {
    for (const rule of this.assignmentRules) {
      if (!rule.pattern || !rule.workerId) {
        continue;
      }

      if (this._matchPattern(botId, rule.pattern)) {
        try {
          const worker = await this.workerRegistry.getWorker(rule.workerId);

          if (
            worker &&
            worker.status === WORKER_STATUSES.HEALTHY &&
            worker.currentLoad < worker.maxContainers
          ) {
            this.logger.info(
              `[WorkerAssigner] Pattern match: bot '${botId}' matched rule ` +
                `'${rule.pattern}' → worker '${rule.workerId}'`
            );
            return worker;
          }

          this.logger.warn(
            `[WorkerAssigner] Pattern match: worker '${rule.workerId}' for pattern ` +
              `'${rule.pattern}' is unavailable, falling through`
          );
        } catch (err) {
          this.logger.warn(
            `[WorkerAssigner] Pattern match error for rule '${rule.pattern}': ${err.message}`
          );
        }
      }
    }

    return null;
  }

  /**
   * Select the least-loaded healthy worker
   *
   * Queries all healthy workers with available capacity and selects the one
   * with the lowest load ratio (current_load / max_containers).
   *
   * @param {Array<string>} [excludeIds=[]] - Worker IDs to exclude from selection
   * @returns {Promise<Object|null>} Worker object or null if none available
   * @private
   */
  async _selectLeastLoadedWorker(excludeIds = []) {
    const workers = await this.workerRegistry.listWorkers({
      status: WORKER_STATUSES.HEALTHY,
    });

    const candidates = workers
      .filter(w => !excludeIds.includes(w.id) && w.currentLoad < w.maxContainers)
      .sort((a, b) => {
        const ratioA = a.maxContainers > 0 ? a.currentLoad / a.maxContainers : 1;
        const ratioB = b.maxContainers > 0 ? b.currentLoad / b.maxContainers : 1;
        return ratioA - ratioB;
      });

    return candidates.length > 0 ? candidates[0] : null;
  }

  /**
   * Match a bot ID against a glob-like pattern
   *
   * Supports `*` as a wildcard for any sequence of characters.
   * The match is case-sensitive.
   *
   * @param {string} botId - Bot identifier to test
   * @param {string} pattern - Glob-like pattern (e.g., 'devops-*', '*-gpu')
   * @returns {boolean} True if botId matches the pattern
   * @private
   */
  _matchPattern(botId, pattern) {
    // Escape regex special chars except *, then replace * with .*
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`^${escaped.replace(/\*/g, '.*')}$`);
    return regex.test(botId);
  }

  /**
   * Resolve the Docker host for a worker
   *
   * For local workers, returns null (uses default Docker socket).
   * For remote workers, returns the SSH tunnel Docker host URL
   * from the SSHTunnelManager.
   *
   * @param {Object} worker - Worker object from registry
   * @returns {string|null} Docker host URL or null for local
   * @private
   */
  _resolveDockerHost(worker) {
    if (worker.type === WORKER_TYPES.LOCAL) {
      return null;
    }

    // For remote workers, get Docker host from SSH tunnel
    if (this.sshTunnelManager) {
      const dockerHost = this.sshTunnelManager.getDockerHost(worker.id);
      if (dockerHost) {
        return dockerHost;
      }

      this.logger.warn(
        `[WorkerAssigner] No SSH tunnel found for remote worker '${worker.id}', ` +
          'using worker host directly'
      );
    }

    // Fallback: construct Docker host from worker's host address
    return `tcp://${worker.host}:2375`;
  }

  /**
   * Resolve the Incus host for a worker
   *
   * For local workers, returns null (uses default Incus socket).
   * For remote workers, returns the SSH tunnel Incus host URL
   * from the SSHTunnelManager.
   *
   * @param {Object} worker - Worker object from registry
   * @returns {string|null} Incus host URL or null for local
   * @private
   */
  _resolveIncusHost(worker) {
    if (worker.type === WORKER_TYPES.LOCAL) {
      return null;
    }

    // For remote workers, get Incus host from SSH tunnel
    if (this.sshTunnelManager && typeof this.sshTunnelManager.getIncusHost === 'function') {
      const incusHost = this.sshTunnelManager.getIncusHost(worker.id);
      if (incusHost) {
        return incusHost;
      }
    }

    // No Incus tunnel available — return null (Docker fallback handled separately)
    return null;
  }

  /**
   * Get all bot IDs assigned to a specific worker
   *
   * @param {string} workerId - Worker identifier
   * @returns {Array<string>} Array of bot IDs
   * @private
   */
  _getBotsOnWorker(workerId) {
    const bots = [];
    for (const [botId, assignedWorkerId] of this.assignments) {
      if (assignedWorkerId === workerId) {
        bots.push(botId);
      }
    }
    return bots;
  }
}
