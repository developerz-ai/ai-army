/**
 * DeployCommand - Deploy workers to servers via CLI
 *
 * Loads project configuration via ProjectLoader, registers servers
 * if needed, and provisions workers per their deployment config:
 *   deploy           - Deploy all workers defined in the project
 *   deploy <worker>  - Deploy a single worker by ID
 *
 * Supports --dry-run to preview the deployment plan without executing.
 *
 * All subcommands use dependency injection for testability.
 * Delegates to ProjectLoader for config, WorkerRegistry for worker
 * persistence, and SSHTunnelManager for SSH connectivity.
 *
 * @module cli/DeployCommand
 */

import { ProjectLoader } from '../config/project-loader.js';
import { WorkerRegistry, WORKER_TYPES } from '../core/worker-registry.js';

/**
 * Custom error for deploy command failures
 */
export class DeployCommandError extends Error {
  /**
   * Create a DeployCommandError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - The operation that failed
   * @param {string} [options.workerId] - Worker ID involved
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'DeployCommandError';
    this.operation = options.operation;
    this.workerId = options.workerId;
  }
}

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * Build a deployment plan from project configuration
 *
 * Creates an ordered list of steps: register servers, then provision workers.
 * Each step includes the target, action, and relevant config.
 *
 * @param {Object} projectConfig - Resolved project config from ProjectLoader
 * @param {string} [workerId] - Optional single worker ID to filter
 * @returns {Object} Plan with steps array and summary
 * @private
 */
function buildPlan(projectConfig, workerId) {
  const { servers = [], workers = [] } = projectConfig;
  const steps = [];

  // Filter to a single worker when workerId is provided
  const targetWorkers = workerId
    ? workers.filter(w => w.id === workerId)
    : workers.filter(w => w.enabled !== false);

  if (workerId && targetWorkers.length === 0) {
    return { steps: [], targetWorkers: [], servers, notFound: workerId };
  }

  // Step 1: Register servers that workers reference
  const referencedServers = new Set();
  for (const worker of targetWorkers) {
    const serverId = worker.deployment?.server;
    if (serverId) {
      referencedServers.add(serverId);
    }
  }

  for (const server of servers) {
    if (referencedServers.has(server.id)) {
      steps.push({
        type: 'register-server',
        serverId: server.id,
        host: server.host,
        config: server,
      });
    }
  }

  // Step 2: Provision each worker
  for (const worker of targetWorkers) {
    const replicas = worker.deployment?.replicas || 1;
    steps.push({
      type: 'provision-worker',
      workerId: worker.id,
      name: worker.name || worker.id,
      server: worker.deployment?.server || 'local',
      replicas,
      config: worker,
    });
  }

  return { steps, targetWorkers, servers };
}

/**
 * Format a deployment plan for display
 *
 * @param {Array<Object>} steps - Plan steps
 * @param {Function} write - Output writer function
 * @private
 */
function displayPlan(steps, write) {
  if (steps.length === 0) {
    write('  No steps to execute\n');
    return;
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const num = `${i + 1}.`;

    if (step.type === 'register-server') {
      write(`  ${num} Register server '${step.serverId}' (${step.host || 'unknown'})\n`);
    } else if (step.type === 'provision-worker') {
      write(
        `  ${num} Provision worker '${step.workerId}'` +
          ` → server '${step.server}'` +
          ` (${step.replicas} replica${step.replicas !== 1 ? 's' : ''})\n`
      );
    }
  }
}

/**
 * Execute a deployment plan
 *
 * Walks through each step, registering servers and provisioning workers.
 * Collects successes and failures.
 *
 * @param {Array<Object>} steps - Plan steps to execute
 * @param {Object} deps - Dependencies
 * @param {Object} deps.workerRegistry - WorkerRegistry instance
 * @param {Function} deps.write - Output writer function
 * @returns {Promise<Object>} Result with deployed and failed arrays
 * @private
 */
async function executePlan(steps, { workerRegistry, write }) {
  const deployed = [];
  const failed = [];

  for (const step of steps) {
    if (step.type === 'register-server') {
      try {
        // Check if server is already registered
        const existing = await workerRegistry.getWorker(step.serverId);
        if (existing) {
          write(`  ✅ Server '${step.serverId}' already registered\n`);
          deployed.push({ type: 'server', id: step.serverId, action: 'exists' });
          continue;
        }

        await workerRegistry.registerWorker({
          id: step.serverId,
          host: step.host || step.serverId,
          type: WORKER_TYPES.REMOTE,
          maxContainers: step.config.maxWorkers || 10,
        });
        write(`  ✅ Registered server '${step.serverId}'\n`);
        deployed.push({ type: 'server', id: step.serverId, action: 'registered' });
      } catch (err) {
        write(`  ❌ Failed to register server '${step.serverId}': ${err.message}\n`);
        failed.push({ type: 'server', id: step.serverId, error: err.message });
      }
    } else if (step.type === 'provision-worker') {
      try {
        // Check if worker is already registered
        const existing = await workerRegistry.getWorker(step.workerId);
        if (existing) {
          write(`  ✅ Worker '${step.workerId}' already provisioned\n`);
          deployed.push({ type: 'worker', id: step.workerId, action: 'exists' });
          continue;
        }

        const workerType = step.server === 'local' ? WORKER_TYPES.LOCAL : WORKER_TYPES.REMOTE;

        await workerRegistry.registerWorker({
          id: step.workerId,
          host: step.server,
          type: workerType,
          maxContainers: step.replicas,
        });
        write(`  ✅ Provisioned worker '${step.workerId}' on '${step.server}'\n`);
        deployed.push({ type: 'worker', id: step.workerId, action: 'provisioned' });
      } catch (err) {
        write(`  ❌ Failed to provision worker '${step.workerId}': ${err.message}\n`);
        failed.push({ type: 'worker', id: step.workerId, error: err.message });
      }
    }
  }

  return { deployed, failed };
}

// =============================================================================
// Main entry point
// =============================================================================

/**
 * Run the deploy command
 *
 * Loads project config, builds a deployment plan, and optionally executes it.
 *
 * @param {Object} [options={}] - Command options
 * @param {string} [options.projectPath='.'] - Path to project root
 * @param {string} [options.workerId] - Deploy only this worker (optional)
 * @param {boolean} [options.dryRun=false] - Preview plan without executing
 * @param {Object} [options.output=process.stdout] - Writable stream for output
 * @param {Object} [options.storage] - Storage instance (for creating WorkerRegistry)
 * @param {Object} [options.workerRegistry] - Pre-configured WorkerRegistry (for DI/testing)
 * @param {Object} [options.projectLoader] - Pre-configured ProjectLoader (for DI/testing)
 * @returns {Promise<Object>} Result with success flag and deployment data
 * @throws {DeployCommandError} If project config cannot be loaded
 */
export async function runDeploy(options = {}) {
  const {
    projectPath = '.',
    workerId,
    dryRun = false,
    output = process.stdout,
    storage,
    workerRegistry: injectedRegistry,
    projectLoader: injectedLoader,
  } = options;
  const write = msg => output.write(msg);

  // Create or use injected dependencies
  const projectLoader = injectedLoader || new ProjectLoader({ validate: false });
  const workerRegistry = injectedRegistry || new WorkerRegistry(storage);

  // 1. Load project configuration
  write('📦 Loading project configuration...\n');
  let projectConfig;
  try {
    projectConfig = await projectLoader.loadProject(projectPath);
  } catch (err) {
    throw new DeployCommandError(`Failed to load project: ${err.message}`, {
      cause: err,
      operation: 'loadProject',
    });
  }

  const workerCount = (projectConfig.workers || []).length;
  const serverCount = (projectConfig.servers || []).length;
  write(`   Found ${workerCount} worker(s) and ${serverCount} server(s)\n\n`);

  // 2. Build deployment plan
  const plan = buildPlan(projectConfig, workerId);

  if (plan.notFound) {
    write(`❌ Worker '${plan.notFound}' not found in project configuration\n`);
    return { success: false, reason: `Worker '${plan.notFound}' not found` };
  }

  write(`📋 Deployment plan (${plan.steps.length} step${plan.steps.length !== 1 ? 's' : ''}):\n`);
  displayPlan(plan.steps, write);
  write('\n');

  // 3. Dry run — stop here
  if (dryRun) {
    write('🏁 Dry run complete — no changes applied\n');
    return { success: true, dryRun: true, steps: plan.steps };
  }

  // 4. Execute the plan
  if (plan.steps.length === 0) {
    write('Nothing to deploy\n');
    return { success: true, deployed: [], failed: [] };
  }

  write('🚀 Deploying...\n');
  const { deployed, failed } = await executePlan(plan.steps, { workerRegistry, write });

  write('\n');
  if (failed.length === 0) {
    write(`✅ Deployment complete: ${deployed.length} step(s) succeeded\n`);
  } else {
    write(
      `⚠️  Deployment partially complete: ${deployed.length} succeeded, ${failed.length} failed\n`
    );
  }

  return { success: failed.length === 0, deployed, failed };
}

export default runDeploy;
