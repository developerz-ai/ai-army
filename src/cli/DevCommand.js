/**
 * DevCommand - Start the AI Army framework in development mode
 *
 * Same as start command but with file watching for hot reload.
 * Watches config.json and bots directory for changes, validates
 * and reloads configuration without full restart using ConfigWatcher.
 *
 * Full hot reload implementation is Phase 10; ConfigWatcher handles
 * file watching, validation, and reloading.
 *
 * @module cli/DevCommand
 */

import path from 'path';
import { Orchestrator, OrchestratorError } from '../core/orchestrator.js';
import { ConfigWatcher, ConfigWatcherError } from '../config/ConfigWatcher.js';

/**
 * Custom error for dev command failures
 */
export class DevCommandError extends Error {
  /**
   * Create a DevCommandError
   * @param {string} message - Error message
   * @param {Object} [options] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'DevCommandError';
  }
}

/**
 * Run the dev command
 *
 * Creates an Orchestrator, starts it, then uses ConfigWatcher to watch
 * config files for changes. On change, validates the new config and
 * reloads bots without full restart.
 *
 * @param {Object} options - Command options
 * @param {string} [options.configPath='./config.json'] - Path to main config file
 * @param {string} [options.botsPath='./bots'] - Path to bots directory
 * @param {string} [options.migrationsPath='./migrations'] - Path to migrations directory
 * @param {Object} [options.output=process.stdout] - Writable stream for output
 * @param {Object} [options.orchestrator] - Pre-configured Orchestrator (for DI/testing)
 * @param {Function} [options.configWatcherFactory] - Factory to create ConfigWatcher (for DI/testing)
 * @param {Function} [options.onShutdown] - Callback after graceful shutdown
 * @param {Object} [options.processRef=process] - Process reference for signal handling
 * @returns {Promise<{ orchestrator: Object, watcher: Object|null }>} Started orchestrator and watcher
 */
export async function runDev({
  configPath = './config.json',
  botsPath = './bots',
  migrationsPath = './migrations',
  output = process.stdout,
  orchestrator,
  configWatcherFactory,
  onShutdown,
  processRef = process,
} = {}) {
  const write = msg => output.write(msg);

  write('🛠️  Starting AI Army in development mode (hot reload enabled)...\n\n');

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
    write(`\n✅ AI Army started in development mode\n`);
    write(`   Bots: ${status.botCount}\n`);
    write(`   Channels: ${status.channelCount}\n`);
    write(`   Database: ${status.databaseConnected ? 'connected' : 'not connected'}\n`);

    // Setup file watching using ConfigWatcher
    let configWatcher = null;

    const watchPaths = [path.resolve(configPath), path.resolve(botsPath)];

    try {
      if (configWatcherFactory) {
        // Use injected watcher factory (for testing)
        configWatcher = configWatcherFactory();
      } else {
        // Create ConfigWatcher with logger
        configWatcher = new ConfigWatcher(orch, {
          logger: msg => write(`${msg}\n`),
        });
      }

      await configWatcher.watch(watchPaths);
      write('\n👁️  Watching config files for changes...\n');
      write('🎉 AI Army is ready! Press Ctrl+C to stop.\n');
    } catch (_err) {
      if (_err instanceof ConfigWatcherError) {
        write('\n⚠️ File watching not available, running without hot reload\n');
        write(`   (${_err.message})\n`);
      } else {
        write('\n⚠️ File watching disabled\n');
      }
    }

    // Setup graceful shutdown handlers
    const shutdown = async signal => {
      // Remove signal handlers to prevent duplicate shutdowns
      processRef.removeListener('SIGINT', onSigInt);
      processRef.removeListener('SIGTERM', onSigTerm);

      write(`\n\n🛑 Received ${signal}, shutting down gracefully...\n`);

      // Stop config watcher
      if (configWatcher) {
        try {
          await configWatcher.stop();
        } catch (_err) {
          // Ignore watcher cleanup errors
        }
      }

      try {
        await orch.stop();
        write('✅ Shutdown complete\n');
      } catch (shutdownErr) {
        write(`⚠️ Shutdown completed with errors: ${shutdownErr.message}\n`);
      }

      if (onShutdown) {
        onShutdown();
      }
    };

    const onSigInt = async () => shutdown('SIGINT');
    const onSigTerm = async () => shutdown('SIGTERM');
    processRef.on('SIGINT', onSigInt);
    processRef.on('SIGTERM', onSigTerm);

    return { orchestrator: orch, watcher: configWatcher };
  } catch (err) {
    if (err instanceof OrchestratorError) {
      write(`\n❌ Startup failed: ${err.message}\n`);
      if (err.component) {
        write(`   Component: ${err.component}\n`);
      }
      try {
        await orch.stop();
      } catch {
        // Ignore cleanup errors
      }
      return { orchestrator: orch, watcher: null };
    }
    throw new DevCommandError(`Startup failed: ${err.message}`, {
      cause: err,
    });
  }
}

export default runDev;
