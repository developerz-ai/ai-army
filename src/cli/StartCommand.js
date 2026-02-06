/**
 * StartCommand - Start the AI Army framework in production mode
 *
 * Validates configuration, initializes the Orchestrator, starts all
 * components, and handles graceful shutdown on SIGINT/SIGTERM.
 *
 * @module cli/StartCommand
 */

import { Orchestrator, OrchestratorError } from '../core/orchestrator.js';

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
} = {}) {
  const write = msg => output.write(msg);

  write('🚀 Starting AI Army in production mode...\n\n');

  // Create orchestrator if not injected
  const orch =
    orchestrator ||
    new Orchestrator({
      configPath,
      botsPath,
      migrationsPath,
      logger: msg => write(`${msg}\n`),
    });

  try {
    await orch.start();

    const status = orch.getStatus();
    write('\n🎉 AI Army is running! Press Ctrl+C to stop.\n');
    write(`   Bots: ${status.botCount}\n`);
    write(`   Channels: ${status.channelCount}\n`);
    write(`   Database: ${status.databaseConnected ? 'connected' : 'not connected'}\n`);

    // Setup graceful shutdown handlers
    const shutdown = async signal => {
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

    processRef.on('SIGINT', async () => shutdown('SIGINT'));
    processRef.on('SIGTERM', async () => shutdown('SIGTERM'));

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
