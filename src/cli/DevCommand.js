/**
 * DevCommand - Start the AI Army framework in development mode
 *
 * Same as start command but with file watching for hot reload.
 * Watches config.json and bots directory for changes, validates
 * and reloads configuration without full restart.
 *
 * Full hot reload implementation is Phase 10; this provides the
 * basic structure with file watching and reload triggering.
 *
 * @module cli/DevCommand
 */

import path from 'path';
import { Orchestrator, OrchestratorError } from '../core/orchestrator.js';

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
 * Creates an Orchestrator, starts it, then watches config files for changes.
 * On change, validates the new config and reloads bots without full restart.
 *
 * @param {Object} options - Command options
 * @param {string} [options.configPath='./config.json'] - Path to main config file
 * @param {string} [options.botsPath='./bots'] - Path to bots directory
 * @param {string} [options.migrationsPath='./migrations'] - Path to migrations directory
 * @param {Object} [options.output=process.stdout] - Writable stream for output
 * @param {Object} [options.orchestrator] - Pre-configured Orchestrator (for DI/testing)
 * @param {Function} [options.watcherFactory] - Factory to create file watcher (for DI/testing)
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
  watcherFactory,
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

    // Setup file watching
    let watcher = null;

    const watchPaths = [path.resolve(configPath), path.resolve(botsPath)];

    if (watcherFactory) {
      // Use injected watcher factory (for testing)
      watcher = watcherFactory(watchPaths);
    } else {
      // Try to use chokidar for file watching
      try {
        const chokidar = await import('chokidar');
        watcher = chokidar.watch(watchPaths, {
          ignoreInitial: true,
          awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
        });
      } catch {
        write('\n⚠️ chokidar not available, file watching disabled\n');
      }
    }

    if (watcher) {
      let reloading = false;

      const handleChange = async changedPath => {
        if (reloading) return;
        reloading = true;

        write(`\n🔄 File changed: ${changedPath}\n`);
        write('🔄 Validating and reloading configuration...\n');

        try {
          const result = await orch.reload();
          const reloaded = result.reloaded.length;
          const failed = result.failed.length;
          write(`✅ Reload complete: ${reloaded} reloaded, ${failed} failed\n`);
        } catch (err) {
          write(`❌ Reload failed: ${err.message}\n`);
        }

        reloading = false;
      };

      watcher.on('change', handleChange);
      watcher.on('add', handleChange);

      write('\n🔄 Watching config files for changes...\n');
      write('🎉 AI Army is ready! Press Ctrl+C to stop.\n');
    } else {
      write('\n🎉 AI Army is running! Press Ctrl+C to stop.\n');
    }

    // Setup graceful shutdown handlers
    const shutdown = async signal => {
      // Remove signal handlers to prevent duplicate shutdowns
      processRef.removeListener('SIGINT', onSigInt);
      processRef.removeListener('SIGTERM', onSigTerm);

      write(`\n\n🛑 Received ${signal}, shutting down gracefully...\n`);

      // Close file watcher
      if (watcher && typeof watcher.close === 'function') {
        await watcher.close();
      }

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

    return { orchestrator: orch, watcher };
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
