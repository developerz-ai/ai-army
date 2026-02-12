/**
 * WorkerCommand - Manage worker nodes via CLI
 *
 * Provides subcommands for listing, inspecting, stopping, starting,
 * and updating worker containers in the distributed bot deployment:
 *   list   - List all workers with formatted table
 *   status - Show detailed status for a specific worker
 *   stop   - Stop a worker (mark offline, stop assigned containers)
 *   start  - Start/restore a worker (mark healthy)
 *   update - Update a worker's container image (stop → recreate → start)
 *
 * All subcommands use dependency injection for testability.
 * Delegates to WorkerRegistry for persistence and ContainerPool
 * for container operations.
 *
 * @module cli/WorkerCommand
 */

import { WorkerRegistry, WORKER_STATUSES } from '../core/worker-registry.js';

/**
 * Custom error for worker command failures
 */
export class WorkerCommandError extends Error {
  /**
   * Create a WorkerCommandError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - The subcommand that failed
   * @param {string} [options.workerId] - Worker ID involved
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'WorkerCommandError';
    this.operation = options.operation;
    this.workerId = options.workerId;
  }
}

// =============================================================================
// Subcommand handlers
// =============================================================================

/**
 * List all workers with a formatted table
 *
 * Queries WorkerRegistry and formats results as a table showing
 * ID, host, type, status, and load for each worker.
 *
 * @param {Object} options - Command options
 * @param {Object} options.workerRegistry - WorkerRegistry instance
 * @param {Function} options.write - Output writer function
 * @returns {Promise<Object>} Result with success flag and workers array
 * @private
 */
async function workerList({ workerRegistry, write }) {
  const workers = await workerRegistry.listWorkers();

  if (workers.length === 0) {
    write('No workers registered\n');
    return { success: true, workers: [] };
  }

  // Table header
  const idWidth = 20;
  const hostWidth = 25;
  const typeWidth = 8;
  const statusWidth = 10;
  const loadWidth = 12;

  write(
    `${'ID'.padEnd(idWidth)}` +
      `${'HOST'.padEnd(hostWidth)}` +
      `${'TYPE'.padEnd(typeWidth)}` +
      `${'STATUS'.padEnd(statusWidth)}` +
      `${'LOAD'.padEnd(loadWidth)}\n`
  );
  write(`${'-'.repeat(idWidth + hostWidth + typeWidth + statusWidth + loadWidth)}\n`);

  for (const worker of workers) {
    const loadStr = `${worker.currentLoad}/${worker.maxContainers}`;
    write(
      `${(worker.id || '').padEnd(idWidth)}` +
        `${(worker.host || '').padEnd(hostWidth)}` +
        `${(worker.type || '').padEnd(typeWidth)}` +
        `${(worker.status || '').padEnd(statusWidth)}` +
        `${loadStr.padEnd(loadWidth)}\n`
    );
  }

  write(`\nTotal: ${workers.length} worker(s)\n`);

  return { success: true, workers };
}

/**
 * Show detailed status for a specific worker
 *
 * Looks up the worker by ID and displays comprehensive information
 * including host, type, status, load, heartbeat, and assigned bots.
 *
 * @param {Object} options - Command options
 * @param {string} options.workerId - Worker ID to inspect
 * @param {Object} options.workerRegistry - WorkerRegistry instance
 * @param {Object} [options.containerPool] - ContainerPool instance for container info
 * @param {Function} options.write - Output writer function
 * @returns {Promise<Object>} Result with success flag and worker data
 * @private
 */
async function workerStatus({ workerId, workerRegistry, containerPool, write }) {
  if (!workerId) {
    throw new WorkerCommandError('Worker ID is required for status', {
      operation: 'status',
    });
  }

  const worker = await workerRegistry.getWorker(workerId);
  if (!worker) {
    write(`Worker '${workerId}' not found\n`);
    return { success: false };
  }

  write(`Worker: ${worker.id}\n`);
  write(`${'─'.repeat(40)}\n`);
  write(`  Host:           ${worker.host}\n`);
  write(`  Type:           ${worker.type}\n`);
  write(`  Status:         ${worker.status}\n`);
  write(`  Load:           ${worker.currentLoad}/${worker.maxContainers}\n`);
  write(`  Available:      ${worker.maxContainers - worker.currentLoad} slot(s)\n`);

  if (worker.lastHeartbeat) {
    const ago = Math.floor((Date.now() - worker.lastHeartbeat.getTime()) / 1000);
    write(`  Last heartbeat: ${ago}s ago\n`);
  } else {
    write(`  Last heartbeat: never\n`);
  }

  if (worker.createdAt) {
    write(`  Created:        ${worker.createdAt.toISOString()}\n`);
  }

  // Show assigned containers if ContainerPool is available
  if (containerPool) {
    const botIds = containerPool.getBotIds();
    const assigned = botIds.length > 0 ? botIds.join(', ') : 'none';
    write(`  Containers:     ${assigned}\n`);
  }

  return { success: true, worker };
}

/**
 * Stop a worker node
 *
 * Marks the worker as offline in the WorkerRegistry. Does not stop
 * running containers — that is left to the orchestrator failover logic.
 *
 * @param {Object} options - Command options
 * @param {string} options.workerId - Worker ID to stop
 * @param {Object} options.workerRegistry - WorkerRegistry instance
 * @param {Function} options.write - Output writer function
 * @returns {Promise<Object>} Result with success flag
 * @private
 */
async function workerStop({ workerId, workerRegistry, write }) {
  if (!workerId) {
    throw new WorkerCommandError('Worker ID is required for stop', {
      operation: 'stop',
    });
  }

  const worker = await workerRegistry.getWorker(workerId);
  if (!worker) {
    write(`Worker '${workerId}' not found\n`);
    return { success: false };
  }

  if (worker.status === WORKER_STATUSES.OFFLINE) {
    write(`Worker '${workerId}' is already offline\n`);
    return { success: true, worker };
  }

  try {
    await workerRegistry.updateWorkerStatus(workerId, WORKER_STATUSES.OFFLINE);
    write(`✅ Worker '${workerId}' stopped (marked offline)\n`);

    if (worker.currentLoad > 0) {
      write(
        `⚠️  Worker has ${worker.currentLoad} active container(s). ` +
          'Use orchestrator failover to reassign them.\n'
      );
    }

    return { success: true, worker };
  } catch (err) {
    throw new WorkerCommandError(`Failed to stop worker '${workerId}': ${err.message}`, {
      cause: err,
      operation: 'stop',
      workerId,
    });
  }
}

/**
 * Start (restore) a worker node
 *
 * Marks the worker as healthy in the WorkerRegistry and updates
 * the heartbeat, making it available for new bot container placement.
 *
 * @param {Object} options - Command options
 * @param {string} options.workerId - Worker ID to start
 * @param {Object} options.workerRegistry - WorkerRegistry instance
 * @param {Function} options.write - Output writer function
 * @returns {Promise<Object>} Result with success flag
 * @private
 */
async function workerStart({ workerId, workerRegistry, write }) {
  if (!workerId) {
    throw new WorkerCommandError('Worker ID is required for start', {
      operation: 'start',
    });
  }

  const worker = await workerRegistry.getWorker(workerId);
  if (!worker) {
    write(`Worker '${workerId}' not found\n`);
    return { success: false };
  }

  if (worker.status === WORKER_STATUSES.HEALTHY) {
    write(`Worker '${workerId}' is already healthy\n`);
    return { success: true, worker };
  }

  try {
    await workerRegistry.updateWorkerStatus(workerId, WORKER_STATUSES.HEALTHY);
    await workerRegistry.updateHeartbeat(workerId);
    write(`✅ Worker '${workerId}' started (marked healthy)\n`);
    return { success: true, worker };
  } catch (err) {
    throw new WorkerCommandError(`Failed to start worker '${workerId}': ${err.message}`, {
      cause: err,
      operation: 'start',
      workerId,
    });
  }
}

/**
 * Update a worker's container image
 *
 * Implements the image update flow: stop existing containers,
 * recreate them with the new image, and start them again.
 * Workspace volumes are preserved across the update.
 *
 * @param {Object} options - Command options
 * @param {string} options.workerId - Worker ID to update
 * @param {string} options.image - New Docker image to use
 * @param {Object} options.workerRegistry - WorkerRegistry instance
 * @param {Object} options.containerPool - ContainerPool instance
 * @param {Function} options.write - Output writer function
 * @returns {Promise<Object>} Result with success flag and update details
 * @private
 */
async function workerUpdate({ workerId, image, workerRegistry, containerPool, write }) {
  if (!workerId) {
    throw new WorkerCommandError('Worker ID is required for update', {
      operation: 'update',
    });
  }

  if (!image) {
    throw new WorkerCommandError('Image is required for update (use --image <image>)', {
      operation: 'update',
      workerId,
    });
  }

  const worker = await workerRegistry.getWorker(workerId);
  if (!worker) {
    write(`Worker '${workerId}' not found\n`);
    return { success: false };
  }

  if (!containerPool) {
    throw new WorkerCommandError('ContainerPool is required for update operations', {
      operation: 'update',
      workerId,
    });
  }

  write(`Updating worker '${workerId}' to image '${image}'...\n`);

  // Get the list of bots assigned to this worker's containers
  const botIds = containerPool.getBotIds();
  const updated = [];
  const failed = [];

  if (botIds.length === 0) {
    write(`  No containers to update on worker '${workerId}'\n`);
    write(`\n✅ Worker '${workerId}' image updated to '${image}'\n`);
    return { success: true, worker, image, updated: [], failed: [] };
  }

  write(`  Found ${botIds.length} container(s) to update\n`);

  for (const botId of botIds) {
    write(`  Updating container for bot '${botId}'...\n`);
    try {
      // Get current config and workspace before recycling
      const botConfig = containerPool.botConfigs.get(botId);
      const workspace = containerPool.workspaces.get(botId);

      if (!botConfig || !workspace) {
        write(`    ⚠️  Skipped '${botId}' (missing config/workspace)\n`);
        failed.push({ botId, error: 'Missing config or workspace' });
        continue;
      }

      // Update the image in bot config
      const updatedConfig = {
        ...botConfig,
        sandbox: { ...botConfig.sandbox, image },
      };

      // Recycle existing container (stop + remove)
      await containerPool.recycleContainer(botId);
      write(`    Stopped old container\n`);

      // Recreate with new image (preserves workspace volume)
      await containerPool.initializeContainer(botId, updatedConfig, workspace);
      write(`    Started new container with image '${image}'\n`);

      updated.push(botId);
    } catch (err) {
      write(`    ❌ Failed to update '${botId}': ${err.message}\n`);
      failed.push({ botId, error: err.message });
    }
  }

  if (failed.length === 0) {
    write(
      `\n✅ Worker '${workerId}' updated: ` +
        `${updated.length} container(s) migrated to '${image}'\n`
    );
  } else {
    write(
      `\n⚠️  Worker '${workerId}' partially updated: ` +
        `${updated.length} succeeded, ${failed.length} failed\n`
    );
  }

  return { success: failed.length === 0, worker, image, updated, failed };
}

// =============================================================================
// Main entry point
// =============================================================================

/**
 * Run a worker subcommand
 *
 * Dispatches to the appropriate handler based on the `command` argument.
 *
 * @param {string} command - Subcommand name ('list' | 'status' | 'stop' | 'start' | 'update')
 * @param {Object} [options={}] - Command options
 * @param {string} [options.workerId] - Worker ID (for status/stop/start/update)
 * @param {string} [options.image] - Docker image (for update --image)
 * @param {Object} [options.output=process.stdout] - Writable stream for output
 * @param {Object} [options.storage] - Storage instance (for creating WorkerRegistry)
 * @param {Object} [options.workerRegistry] - Pre-configured WorkerRegistry (for DI/testing)
 * @param {Object} [options.containerPool] - Pre-configured ContainerPool (for DI/testing)
 * @returns {Promise<Object>} Result with success flag and command-specific data
 * @throws {WorkerCommandError} If command is invalid or required options are missing
 */
export async function runWorker(command, options = {}) {
  const {
    output = process.stdout,
    storage,
    workerRegistry: injectedRegistry,
    containerPool: injectedPool,
  } = options;
  const write = msg => output.write(msg);

  // Create or use injected dependencies
  const workerRegistry = injectedRegistry || new WorkerRegistry(storage);
  const containerPool = injectedPool || null;

  const handlerOptions = { ...options, workerRegistry, containerPool, write };

  switch (command) {
    case 'list':
      return await workerList(handlerOptions);
    case 'status':
      return await workerStatus(handlerOptions);
    case 'stop':
      return await workerStop(handlerOptions);
    case 'start':
      return await workerStart(handlerOptions);
    case 'update':
      return await workerUpdate(handlerOptions);
    default:
      throw new WorkerCommandError(
        `Unknown worker command: '${command}'. Valid commands: list, status, stop, start, update`,
        { operation: command }
      );
  }
}

export default runWorker;
