/**
 * StartCommand - Start the AI Army framework in production mode
 *
 * Validates configuration, initializes the Orchestrator, starts all
 * components, and handles graceful shutdown on SIGINT/SIGTERM.
 *
 * @module cli/StartCommand
 */

import { Orchestrator, OrchestratorError } from '../core/orchestrator.js';
import { PostgresStorage } from '../adapters/storage/postgres.js';
import { BotManager } from '../core/bot-manager.js';
import { ContainerPool } from '../execution/container-pool.js';
import { DockerManager } from '../execution/docker-manager.js';
import { SoulLoader } from '../utils/SoulLoader.js';
import { SessionManager } from '../core/session-manager.js';
import { MessageProcessor } from '../core/message-processor.js';
import { AgentRunner } from '../agent/agent-runner.js';
import { ModelFactory } from '../models/model-factory.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import { createBashTool } from '../tools/bash-tool.js';
import {
  createReadFileTool,
  createWriteFileTool,
  createGlobTool,
  createGrepTool,
} from '../tools/file-tools.js';

/**
 * Custom error for start command failures
 */
export class StartCommandError extends Error {
  /**
   * Create a StartCommandError
   * @param {string} message - Error message
   * @param {Object} [options] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'StartCommandError';
  }
}

/**
 * Default development database password used in .env.example and docker-compose
 * @constant {string}
 */
const DEFAULT_DEV_DB_PASSWORD = 'ai_army_dev';

/**
 * Hostnames that indicate a local/docker-internal database
 * @constant {string[]}
 */
const LOCAL_DB_HOSTS = ['localhost', '127.0.0.1', 'postgres'];

/**
 * Check production environment for common misconfigurations.
 *
 * When NODE_ENV=production, warns about:
 * - Empty API_TOKEN (API has no authentication)
 * - Default DB_PASSWORD (insecure database credentials)
 * - DATABASE_URL pointing to localhost or docker-internal hostname
 *
 * Warnings are informational only and do not block startup.
 *
 * @param {Object} options - Options
 * @param {Function} options.write - Output function (msg => ...)
 * @param {Object} [options.env=process.env] - Environment variables to check
 * @returns {string[]} Array of warning messages emitted
 */
export function _checkProductionWarnings({ write, env = process.env } = {}) {
  const warnings = [];

  if (env.NODE_ENV !== 'production') {
    return warnings;
  }

  // Check API_TOKEN
  if (!env.API_TOKEN) {
    warnings.push('API_TOKEN is not set — REST API has no authentication');
  }

  // Check DB_PASSWORD
  if (env.DB_PASSWORD === DEFAULT_DEV_DB_PASSWORD) {
    warnings.push(
      `DB_PASSWORD is set to the default dev value ('${DEFAULT_DEV_DB_PASSWORD}') — use a strong password in production`
    );
  }

  // Check DATABASE_URL for local/docker-internal hosts
  if (env.DATABASE_URL) {
    try {
      const url = new URL(env.DATABASE_URL);
      if (LOCAL_DB_HOSTS.includes(url.hostname)) {
        warnings.push(
          `DATABASE_URL points to '${url.hostname}' — use a remote database host in production`
        );
      }
    } catch {
      // If URL is malformed, skip host check — other validators will catch it
    }
  }

  if (warnings.length > 0) {
    write('\n⚠️  Production warnings:\n');
    for (const warning of warnings) {
      write(`   • ${warning}\n`);
    }
    write('\n');
  }

  return warnings;
}

/**
 * Run the start command
 *
 * Creates an Orchestrator with the given config path, starts it,
 * and sets up signal handlers for graceful shutdown.
 *
 * @param {Object} options - Command options
 * @param {string} [options.configPath='./config.json'] - Path to main config file
 * @param {string} [options.botsPath='./bots'] - Path to bots directory
 * @param {string} [options.migrationsPath='./migrations'] - Path to migrations directory
 * @param {Object} [options.output=process.stdout] - Writable stream for output
 * @param {Object} [options.orchestrator] - Pre-configured Orchestrator (for DI/testing)
 * @param {Function} [options.onShutdown] - Callback after graceful shutdown
 * @param {Object} [options.processRef=process] - Process reference for signal handling
 * @param {Object} [options.env=process.env] - Environment variables (for DI/testing)
 * @returns {Promise<{ orchestrator: Object }>} Started orchestrator
 */
export async function runStart({
  configPath = './config.json',
  botsPath = './bots',
  migrationsPath = './migrations',
  output = process.stdout,
  orchestrator,
  onShutdown,
  processRef = process,
  env = process.env,
} = {}) {
  const write = msg => output.write(msg);

  write('🚀 Starting AI Army in production mode...\n\n');

  // Check for production misconfigurations before starting
  _checkProductionWarnings({ write, env });

  // Shared instances for components that need to communicate
  let sharedDockerManager;
  let sharedContainerPool;

  // Create orchestrator if not injected
  const orch =
    orchestrator ||
    new Orchestrator({
      configPath,
      botsPath,
      migrationsPath,
      logger: msg => write(`${msg}\n`),
      // Provide factories for auto-creating components
      storageFactory: config => {
        if (!config.database?.url) return null;
        return new PostgresStorage(config.database.url);
      },
      botManagerFactory: (storage, _config) => {
        if (!storage) return null;
        // Create shared DockerManager and ContainerPool
        if (!sharedDockerManager) {
          sharedDockerManager = new DockerManager();
          sharedContainerPool = new ContainerPool(sharedDockerManager);
        }
        const soulLoader = new SoulLoader();
        return new BotManager(storage, sharedContainerPool, soulLoader, {
          toolRegistry: null,
          skillRegistry: null,
        });
      },
      sessionManagerFactory: (storage, _config) => {
        if (!storage) return null;
        return new SessionManager(storage);
      },
      messageProcessorFactory: (sessionManager, storage, _config) => {
        if (!sessionManager || !storage) return null;
        // Reuse the shared ContainerPool from botManagerFactory
        if (!sharedContainerPool) {
          sharedDockerManager = new DockerManager();
          sharedContainerPool = new ContainerPool(sharedDockerManager);
        }
        const toolRegistry = new ToolRegistry(sharedContainerPool);
        // Register built-in tools
        toolRegistry.registerTool('bash', createBashTool);
        toolRegistry.registerTool('readFile', createReadFileTool);
        toolRegistry.registerTool('writeFile', createWriteFileTool);
        toolRegistry.registerTool('glob', createGlobTool);
        toolRegistry.registerTool('grep', createGrepTool);
        const agentRunner = new AgentRunner(ModelFactory, toolRegistry);
        return new MessageProcessor(sessionManager, agentRunner, storage);
      },
    });

  try {
    await orch.start();

    const status = orch.getStatus();
    write('\n🎉 AI Army is running! Press Ctrl+C to stop.\n');
    write(`   Bots: ${status.botCount}\n`);
    write(`   Channels: ${status.channelCount}\n`);
    write(`   Database: ${status.databaseConnected ? 'connected' : 'not connected'}\n`);
    if (status.apiServerRunning) {
      write(`   API: http://${orch.apiServer?.host || '0.0.0.0'}:${status.apiServerPort}\n`);
    }

    // Setup graceful shutdown handlers
    const shutdown = async signal => {
      // Remove signal handlers to prevent duplicate shutdowns
      processRef.removeListener('SIGINT', onSigInt);
      processRef.removeListener('SIGTERM', onSigTerm);

      write(`\n\n🛑 Received ${signal}, shutting down gracefully...\n`);
      try {
        await orch.stop();
        write('✅ Shutdown complete\n');
      } catch (err) {
        write(`⚠️ Shutdown completed with errors: ${err.message}\n`);
      }
      if (onShutdown) {
        onShutdown();
      }
    };

    const onSigInt = async () => shutdown('SIGINT');
    const onSigTerm = async () => shutdown('SIGTERM');
    processRef.on('SIGINT', onSigInt);
    processRef.on('SIGTERM', onSigTerm);

    return { orchestrator: orch };
  } catch (err) {
    if (err instanceof OrchestratorError) {
      write(`\n❌ Startup failed: ${err.message}\n`);
      if (err.component) {
        write(`   Component: ${err.component}\n`);
      }
      // Attempt cleanup
      try {
        await orch.stop();
      } catch {
        // Ignore cleanup errors during startup failure
      }
      return { orchestrator: orch };
    }
    throw new StartCommandError(`Startup failed: ${err.message}`, {
      cause: err,
    });
  }
}

export default runStart;
