/**
 * ValidateCommand - Validate all configuration files
 *
 * Loads the main config.json and discovers all bot configuration files,
 * then validates them using ConfigValidator with Zod schemas.
 * Reports errors grouped by file with clear, actionable messages.
 *
 * @module cli/ValidateCommand
 */

import fs from 'fs/promises';
import path from 'path';
import { ConfigLoader, ConfigError } from '../config/ConfigLoader.js';
import { ConfigValidator } from '../config/ConfigValidator.js';

/**
 * Custom error for validate command failures
 */
export class ValidateCommandError extends Error {
  /**
   * Create a ValidateCommandError
   * @param {string} message - Error message
   * @param {Object} [options] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.configPath] - Path to the config file
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'ValidateCommandError';
    this.configPath = options.configPath;
  }
}

/**
 * Discover bot configuration files from the bots directory
 *
 * Scans the bots directory for subdirectories containing config.json files.
 * Returns a map of bot ID to loaded configuration.
 *
 * @param {string} botsPath - Path to the bots directory
 * @param {ConfigLoader} loader - ConfigLoader instance for loading/interpolating
 * @returns {Promise<Map<string, Object>>} Map of botId → config
 * @private
 */
async function discoverBotConfigs(botsPath, loader) {
  const configs = new Map();
  const resolvedPath = path.resolve(botsPath);

  let entries;
  try {
    entries = await fs.readdir(resolvedPath, { withFileTypes: true });
  } catch {
    // Bots directory doesn't exist — not an error, just no bots to validate
    return configs;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const botConfigPath = path.join(resolvedPath, entry.name, 'config.json');
    try {
      const botConfig = await loader.load(botConfigPath);
      // Use directory name as map key — the validator schema requires `id`,
      // so configs missing it will correctly fail validation downstream.
      // We intentionally do NOT synthesize an id from the directory name.
      configs.set(entry.name, botConfig);
    } catch {
      // Skip directories without valid config.json — they'll be reported
      // separately or are not bot directories
    }
  }

  return configs;
}

/**
 * Run the validate command
 *
 * Loads and validates the main configuration and all bot configurations.
 * Outputs a human-readable report to the provided output stream.
 *
 * @param {Object} options - Command options
 * @param {string} [options.configPath='./config.json'] - Path to main config file
 * @param {string} [options.botsPath='./bots'] - Path to bots directory
 * @param {Object} [options.output=process.stdout] - Writable stream for output
 * @param {ConfigLoader} [options.configLoader] - ConfigLoader instance (for DI/testing)
 * @param {ConfigValidator} [options.configValidator] - ConfigValidator instance (for DI/testing)
 * @returns {Promise<{ valid: boolean, errors: Array }>} Validation result
 */
export async function runValidate({
  configPath = './config.json',
  botsPath = './bots',
  output = process.stdout,
  configLoader,
  configValidator,
} = {}) {
  const write = msg => output.write(msg);
  const loader = configLoader || new ConfigLoader();
  const validator = configValidator || new ConfigValidator();

  write('🔍 Validating configuration...\n');

  // Step 1: Load main config
  let mainConfig;
  try {
    mainConfig = await loader.load(configPath);
  } catch (err) {
    if (err instanceof ConfigError) {
      write(`\n❌ Failed to load ${configPath}: ${err.message}\n`);
      return { valid: false, errors: [{ path: configPath, message: err.message }] };
    }
    throw new ValidateCommandError(`Failed to load configuration: ${err.message}`, {
      cause: err,
      configPath,
    });
  }

  // Step 2: Discover bot configs
  const botConfigs = await discoverBotConfigs(botsPath, loader);
  const botConfigMap = Object.fromEntries(botConfigs);

  // Step 3: Validate all configs
  const result = validator.validateAll(mainConfig, botConfigMap);

  // Step 4: Generate and output report
  const report = validator.generateReport(result.errors);
  write(`\n${report}\n`);

  if (result.valid) {
    const botCount = botConfigs.size;
    if (botCount > 0) {
      write(`\n  Validated: config.json + ${botCount} bot config(s)\n`);
    }
  }

  return result;
}

export default runValidate;
