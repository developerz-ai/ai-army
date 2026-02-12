/**
 * ServerCommand - Manage remote server nodes via CLI
 *
 * Provides subcommands for adding, listing, and testing remote
 * server connections for distributed bot deployment:
 *   add   - Add a new server (validates SSH, registers worker)
 *   list  - List all registered servers
 *   test  - Test SSH connectivity to a registered server
 *
 * All subcommands use dependency injection for testability.
 * Delegates to WorkerRegistry for persistence and SSHTunnelManager
 * for SSH connectivity validation.
 *
 * @module cli/ServerCommand
 */

import { WorkerRegistry, WORKER_TYPES } from '../core/worker-registry.js';
import { SSHTunnelManager } from '../worker/ssh-tunnel.js';

/**
 * Custom error for server command failures
 */
export class ServerCommandError extends Error {
  /**
   * Create a ServerCommandError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - The subcommand that failed
   * @param {string} [options.serverId] - Server/worker ID involved
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'ServerCommandError';
    this.operation = options.operation;
    this.serverId = options.serverId;
  }
}

// =============================================================================
// Subcommand handlers
// =============================================================================

/**
 * Add a new remote server
 *
 * Validates SSH connectivity to the host, then registers it as
 * a remote worker in the WorkerRegistry with the given capacity.
 *
 * @param {Object} options - Command options
 * @param {string} options.host - SSH host address
 * @param {string} [options.user='root'] - SSH username
 * @param {string} [options.key='~/.ssh/id_rsa'] - Path to SSH private key
 * @param {string} [options.labels=''] - Comma-separated labels for the server
 * @param {number} [options.maxWorkers=10] - Max containers for this server
 * @param {Object} options.workerRegistry - WorkerRegistry instance
 * @param {Object} options.sshTunnelManager - SSHTunnelManager instance
 * @param {Function} options.write - Output writer function
 * @returns {Promise<Object>} Result with success flag and worker data
 * @private
 */
async function serverAdd({
  host,
  user = 'root',
  key = '~/.ssh/id_rsa',
  labels = '',
  maxWorkers = 10,
  workerRegistry,
  sshTunnelManager,
  write,
}) {
  if (!host) {
    throw new ServerCommandError('Host is required for add', {
      operation: 'add',
    });
  }

  // Generate a worker ID from the host (replace dots/colons with dashes)
  const serverId = host.replace(/[.:]/g, '-');

  write(`Adding server '${host}'...\n`);
  write(`  User:        ${user}\n`);
  write(`  Key:         ${key}\n`);
  write(`  Max workers: ${maxWorkers}\n`);
  if (labels) {
    write(`  Labels:      ${labels}\n`);
  }

  // Validate SSH connectivity by creating and immediately closing a tunnel
  write(`  Testing SSH connectivity...\n`);
  try {
    await sshTunnelManager.createTunnel({
      workerId: `test-${serverId}`,
      host,
      username: user,
      privateKeyPath: key,
    });
    await sshTunnelManager.closeTunnel(`test-${serverId}`);
    write(`  SSH connection: ✅ OK\n`);
  } catch (err) {
    write(`  SSH connection: ❌ Failed\n`);
    throw new ServerCommandError(`SSH connectivity check failed for '${host}': ${err.message}`, {
      cause: err,
      operation: 'add',
      serverId,
    });
  }

  // Register in WorkerRegistry
  try {
    const worker = await workerRegistry.registerWorker({
      id: serverId,
      host,
      type: WORKER_TYPES.REMOTE,
      maxContainers: maxWorkers,
    });

    write(`\n✅ Server '${host}' registered as worker '${serverId}'\n`);

    return {
      success: true,
      worker,
      labels: labels ? labels.split(',').map(l => l.trim()) : [],
      sshKeyPath: key,
    };
  } catch (err) {
    throw new ServerCommandError(`Failed to register server '${host}': ${err.message}`, {
      cause: err,
      operation: 'add',
      serverId,
    });
  }
}

/**
 * List all registered servers
 *
 * Queries the WorkerRegistry and formats results as a table.
 *
 * @param {Object} options - Command options
 * @param {Object} options.workerRegistry - WorkerRegistry instance
 * @param {Function} options.write - Output writer function
 * @returns {Promise<Object>} Result with success flag and workers array
 * @private
 */
async function serverList({ workerRegistry, write }) {
  const workers = await workerRegistry.listWorkers();

  if (workers.length === 0) {
    write('No servers registered\n');
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

  write(`\nTotal: ${workers.length} server(s)\n`);

  return { success: true, workers };
}

/**
 * Test connectivity to a registered server
 *
 * Looks up the server by ID in WorkerRegistry, then tests SSH
 * connectivity via SSHTunnelManager by creating and closing a tunnel.
 *
 * @param {Object} options - Command options
 * @param {string} options.serverId - Server/worker ID to test
 * @param {string} [options.user='root'] - SSH username for the test
 * @param {string} [options.key='~/.ssh/id_rsa'] - Path to SSH private key
 * @param {Object} options.workerRegistry - WorkerRegistry instance
 * @param {Object} options.sshTunnelManager - SSHTunnelManager instance
 * @param {Function} options.write - Output writer function
 * @returns {Promise<Object>} Result with success flag and health data
 * @private
 */
async function serverTest({
  serverId,
  user = 'root',
  key = '~/.ssh/id_rsa',
  workerRegistry,
  sshTunnelManager,
  write,
}) {
  if (!serverId) {
    throw new ServerCommandError('Server ID is required for test', {
      operation: 'test',
    });
  }

  write(`Testing server '${serverId}'...\n`);

  // Look up worker
  const worker = await workerRegistry.getWorker(serverId);
  if (!worker) {
    write(`Server '${serverId}' not found\n`);
    return { success: false };
  }

  write(`  Host:   ${worker.host}\n`);
  write(`  Type:   ${worker.type}\n`);
  write(`  Status: ${worker.status}\n`);

  // For remote workers, test SSH connectivity
  if (worker.type === WORKER_TYPES.REMOTE) {
    write(`  Testing SSH tunnel...\n`);
    try {
      const tunnelId = `test-${serverId}-${Date.now()}`;
      await sshTunnelManager.createTunnel({
        workerId: tunnelId,
        host: worker.host,
        username: user,
        privateKeyPath: key,
      });

      const health = await sshTunnelManager.healthCheck(tunnelId);
      await sshTunnelManager.closeTunnel(tunnelId);

      write(`  SSH tunnel:  ${health.healthy ? '✅ OK' : '❌ Failed'}\n`);
      write(`\n✅ Server '${serverId}' is reachable\n`);

      return { success: true, worker, health };
    } catch (err) {
      write(`  SSH tunnel:  ❌ Failed - ${err.message}\n`);
      write(`\n❌ Server '${serverId}' is not reachable\n`);
      return { success: false, worker, error: err.message };
    }
  }

  // For local workers, just verify the registry status
  const isHealthy = worker.status === 'healthy';
  write(`\n${isHealthy ? '✅' : '⚠️'} Server '${serverId}' status: ${worker.status}\n`);

  return { success: isHealthy, worker };
}

// =============================================================================
// Main entry point
// =============================================================================

/**
 * Run a server subcommand
 *
 * Dispatches to the appropriate handler based on the `command` argument.
 *
 * @param {string} command - Subcommand name ('add' | 'list' | 'test')
 * @param {Object} [options={}] - Command options
 * @param {string} [options.host] - Server host address (for add)
 * @param {string} [options.serverId] - Server/worker ID (for test)
 * @param {string} [options.user='root'] - SSH username
 * @param {string} [options.key='~/.ssh/id_rsa'] - Path to SSH private key
 * @param {string} [options.labels=''] - Comma-separated labels (for add)
 * @param {number} [options.maxWorkers=10] - Max containers (for add)
 * @param {Object} [options.output=process.stdout] - Writable stream for output
 * @param {Object} [options.storage] - Storage instance (for creating WorkerRegistry)
 * @param {Object} [options.workerRegistry] - Pre-configured WorkerRegistry (for DI/testing)
 * @param {Object} [options.sshTunnelManager] - Pre-configured SSHTunnelManager (for DI/testing)
 * @returns {Promise<Object>} Result with success flag and command-specific data
 * @throws {ServerCommandError} If command is invalid or required options are missing
 */
export async function runServer(command, options = {}) {
  const {
    output = process.stdout,
    storage,
    workerRegistry: injectedRegistry,
    sshTunnelManager: injectedTunnelManager,
  } = options;
  const write = msg => output.write(msg);

  // Create or use injected dependencies
  const workerRegistry = injectedRegistry || new WorkerRegistry(storage);
  const sshTunnelManager = injectedTunnelManager || new SSHTunnelManager();

  const handlerOptions = { ...options, workerRegistry, sshTunnelManager, write };

  switch (command) {
    case 'add':
      return await serverAdd(handlerOptions);
    case 'list':
      return await serverList(handlerOptions);
    case 'test':
      return await serverTest(handlerOptions);
    default:
      throw new ServerCommandError(
        `Unknown server command: '${command}'. Valid commands: add, list, test`,
        { operation: command }
      );
  }
}

export default runServer;
