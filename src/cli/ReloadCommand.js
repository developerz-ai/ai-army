/**
 * ReloadCommand - Validate and reload configuration (nginx-style)
 *
 * Implements the nginx-style validate-then-reload pattern:
 * 1. Load and validate new configuration
 * 2. If valid, reload via orchestrator
 * 3. Report results (reloaded bots, failures)
 *
 * This is equivalent to `nginx -t && nginx -s reload` but in a single command.
 * Invalid configurations are rejected before any changes are applied.
 *
 * @module cli/ReloadCommand
 */

import { ConfigLoader, ConfigError } from '../config/ConfigLoader.js';
import { ConfigValidator } from '../config/ConfigValidator.js';

/**
 * Custom error for reload command failures
 */
export class ReloadCommandError extends Error {
  /**
   * Create a ReloadCommandError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.configPath] - Path to the config file
   * @param {string} [options.phase] - Phase that failed (validate, reload)
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'ReloadCommandError';
    this.configPath = options.configPath;
    this.phase = options.phase;
  }
}

/**
 * Run the reload command
 *
 * Validates configuration first, then reloads via orchestrator if valid.
 * Outputs a human-readable report to the provided output stream.
 *
 * @param {Object} options - Command options
 * @param {string} [options.configPath='./config.json'] - Path to main config file
 * @param {Object} options.orchestrator - Orchestrator instance for reload
 * @param {Object} [options.output=process.stdout] - Writable stream for output
 * @param {ConfigLoader} [options.configLoader] - ConfigLoader instance (for DI/testing)
 * @param {ConfigValidator} [options.configValidator] - ConfigValidator instance (for DI/testing)
 * @returns {Promise<{ success: boolean, reloaded: string[], failed: Array }>} Reload result
 */
export async function runReload({
  configPath = './config.json',
  orchestrator,
  output = process.stdout,
  configLoader,
  configValidator,
} = {}) {
  const write = msg => output.write(msg);
  const loader = configLoader || new ConfigLoader();
  const validator = configValidator || new ConfigValidator();

  // === Phase 1: Validate ===
  write('🔄 Validating configuration...\n');

  // Load main config
  let mainConfig;
  try {
    mainConfig = await loader.load(configPath);
  } catch (err) {
    if (err instanceof ConfigError) {
      write(`\n❌ Failed to load ${configPath}: ${err.message}\n`);
      return { success: false, reloaded: [], failed: [{ configPath, error: err.message }] };
    }
    throw new ReloadCommandError(`Failed to load configuration: ${err.message}`, {
      cause: err,
      configPath,
      phase: 'validate',
    });
  }

  // Validate main config
  const validation = validator.validateMainConfig(mainConfig);
  if (!validation.valid) {
    const report = validator.generateReport(validation.errors);
    write(`\n❌ Invalid configuration:\n${report}\n`);
    return {
      success: false,
      reloaded: [],
      failed: validation.errors.map(e => ({ path: e.path, error: e.message })),
    };
  }

  write('✅ Configuration valid\n');

  // === Phase 2: Reload ===
  if (!orchestrator) {
    throw new ReloadCommandError('Orchestrator is required for reload', {
      phase: 'reload',
    });
  }

  write('🔄 Reloading...\n');

  let results;
  try {
    results = await orchestrator.reload();
  } catch (err) {
    write(`\n❌ Reload failed: ${err.message}\n`);
    return {
      success: false,
      reloaded: [],
      failed: [{ error: err.message }],
    };
  }

  // === Phase 3: Report ===
  const { reloaded = [], failed = [] } = results;

  if (reloaded.length > 0) {
    write(`\n✅ Reloaded ${reloaded.length} bot(s):\n`);
    for (const botId of reloaded) {
      write(`  ✅ ${botId}\n`);
    }
  }

  if (failed.length > 0) {
    write(`\n⚠️  ${failed.length} bot(s) failed to reload:\n`);
    for (const entry of failed) {
      const id = entry.botId || 'unknown';
      write(`  ❌ ${id}: ${entry.error}\n`);
    }
  }

  if (reloaded.length === 0 && failed.length === 0) {
    write('\n✅ No changes detected\n');
  }

  const success = failed.length === 0;
  write(`\n${success ? '✅' : '⚠️ '} Reload complete\n`);

  return { success, reloaded, failed };
}

export default runReload;
