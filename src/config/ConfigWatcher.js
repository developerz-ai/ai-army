/**
 * ConfigWatcher - Watches configuration files for changes and triggers hot reload
 *
 * Uses chokidar to watch config.json, bots/**\/*.json, and bots/**\/*.md files.
 * When a change is detected, validates the new configuration before applying it.
 * Invalid configs are rejected with clear error messages (nginx-style reload).
 *
 * @module config/ConfigWatcher
 */

import chokidar from 'chokidar';

/**
 * Custom error for config watcher failures
 */
export class ConfigWatcherError extends Error {
  /**
   * Create a ConfigWatcherError
   * @param {string} message - Error message
   * @param {Object} [options] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.changedPath] - Path that triggered the error
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'ConfigWatcherError';
    this.changedPath = options.changedPath;
  }
}

/**
 * Watches config files and triggers validated hot reloads
 */
export class ConfigWatcher {
  /**
   * Create a ConfigWatcher
   * @param {Object} orchestrator - Orchestrator instance with reload() method
   * @param {Object} [options] - Watcher options
   * @param {Function} [options.logger] - Logger function (defaults to console.log)
   * @param {number} [options.stabilityThreshold=300] - File write stability threshold in ms
   * @param {number} [options.pollInterval=100] - Poll interval for write finish detection in ms
   * @param {Function} [options.chokidarWatch] - Chokidar watch function (for DI/testing)
   */
  constructor(orchestrator, options = {}) {
    if (!orchestrator) {
      throw new ConfigWatcherError('Orchestrator is required');
    }

    this.orchestrator = orchestrator;
    this.logger = options.logger || (msg => console.log(msg));
    this.stabilityThreshold = options.stabilityThreshold ?? 300;
    this.pollInterval = options.pollInterval ?? 100;
    this.chokidarWatch = options.chokidarWatch || chokidar.watch.bind(chokidar);

    /** @type {import('chokidar').FSWatcher|null} */
    this.watcher = null;

    /** @type {boolean} */
    this.reloading = false;

    /** @type {string|null} Coalesced pending change path during reload */
    this.pendingChange = null;
  }

  /**
   * Start watching the given file paths for changes
   *
   * Watches for 'change' and 'add' events. When a file changes,
   * triggers validateAndReload() to safely apply the new config.
   *
   * @param {string[]} paths - File paths or glob patterns to watch
   * @returns {Promise<void>}
   * @throws {ConfigWatcherError} If already watching or paths are invalid
   */
  async watch(paths) {
    if (this.watcher) {
      throw new ConfigWatcherError('Already watching files. Call stop() first.');
    }

    if (!Array.isArray(paths) || paths.length === 0) {
      throw new ConfigWatcherError('Paths must be a non-empty array');
    }

    this.watcher = this.chokidarWatch(paths, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: this.stabilityThreshold,
        pollInterval: this.pollInterval,
      },
    });

    const handleChange = async changedPath => {
      if (this.reloading) {
        this.pendingChange = changedPath;
        return;
      }
      this.reloading = true;

      this.logger(`\u{1F4DD} Config changed: ${changedPath}`);

      try {
        const result = await this.validateAndReload(changedPath);

        if (result.success) {
          this.logger('\u2705 Config reloaded');
        } else {
          this.logger('\u274C Invalid config, keeping old:');
          result.errors.forEach(e => this.logger(`  ${e}`));
        }
      } catch (err) {
        this.logger(`\u274C Reload error: ${err.message}`);
      } finally {
        this.reloading = false;

        // Coalesce: if changes arrived during reload, trigger one more reload
        if (this.pendingChange) {
          const pending = this.pendingChange;
          this.pendingChange = null;
          handleChange(pending);
        }
      }
    };

    this.watcher.on('change', handleChange);
    this.watcher.on('add', handleChange);

    // Wait for the watcher to be ready
    await new Promise((resolve, reject) => {
      this.watcher.on('ready', resolve);
      this.watcher.on('error', reject);
    });
  }

  /**
   * Validate the current configuration and reload if valid
   *
   * Delegates to orchestrator.reload() which handles:
   * 1. Loading the main config
   * 2. Validating with ConfigValidator
   * 3. Discovering and validating bot configs
   * 4. Reloading changed bots via BotManager
   *
   * @param {string} changedPath - The file path that triggered the reload
   * @returns {Promise<{success: boolean, errors?: string[], reloaded?: string[], failed?: Array}>}
   */
  async validateAndReload(changedPath) {
    try {
      const result = await this.orchestrator.reload();

      return {
        success: true,
        reloaded: result.reloaded || [],
        failed: result.failed || [],
      };
    } catch (err) {
      // Extract meaningful error messages
      const errors = [];

      if (err.message) {
        errors.push(err.message);
      }

      if (err.errors && Array.isArray(err.errors)) {
        errors.push(...err.errors.map(e => (typeof e === 'string' ? e : e.message || String(e))));
      }

      return {
        success: false,
        errors: errors.length > 0 ? errors : ['Unknown validation error'],
        changedPath,
      };
    }
  }

  /**
   * Stop watching files
   *
   * Closes the chokidar watcher and cleans up resources.
   * Safe to call multiple times.
   *
   * @returns {Promise<void>}
   */
  async stop() {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    this.reloading = false;
    this.pendingChange = null;
  }
}

export default ConfigWatcher;
