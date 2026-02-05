/**
 * ConfigLoader - Loads and processes configuration files with environment variable interpolation
 *
 * Handles:
 * - Loading JSON configuration files
 * - Environment variable interpolation (${VAR}, ${VAR:-default}, ${VAR:+value})
 * - Deep merging of configuration objects
 *
 * @module ConfigLoader
 */

import fs from 'fs/promises';
import deepmerge from 'deepmerge';

/**
 * Custom error for configuration-related failures
 */
export class ConfigError extends Error {
  /**
   * Create a ConfigError
   * @param {string} message - Error message
   * @param {Object} [options] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.configPath] - Path to the config file
   * @param {string} [options.envVar] - Environment variable name
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'ConfigError';
    this.configPath = options.configPath;
    this.envVar = options.envVar;
  }
}

/**
 * Configuration loader class
 */
export class ConfigLoader {
  /**
   * Load a configuration file, parse JSON, and interpolate environment variables
   *
   * @param {string} configPath - Path to the configuration file
   * @returns {Promise<Object>} - Parsed and interpolated configuration object
   * @throws {ConfigError} - If file doesn't exist, is invalid JSON, or has missing required env vars
   */
  async load(configPath) {
    let raw;

    try {
      raw = await fs.readFile(configPath, 'utf8');
    } catch (err) {
      throw new ConfigError(`Failed to read configuration file: ${configPath}`, {
        cause: err,
        configPath,
      });
    }

    let config;
    try {
      config = JSON.parse(raw);
    } catch (err) {
      throw new ConfigError(`Invalid JSON in configuration file: ${configPath}`, {
        cause: err,
        configPath,
      });
    }

    return this.interpolateEnvVars(config);
  }

  /**
   * Recursively interpolate environment variables in an object
   *
   * Supports three patterns:
   * - ${VAR} - Required variable, throws if not set
   * - ${VAR:-default} - Use default value if VAR is not set or empty
   * - ${VAR:+value} - Use value only if VAR is set and non-empty
   *
   * @param {*} obj - Value to process (object, array, string, or primitive)
   * @returns {*} - Processed value with env vars interpolated
   * @throws {ConfigError} - If a required env var is not set
   */
  interpolateEnvVars(obj) {
    if (typeof obj === 'string') {
      return this._interpolateString(obj);
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.interpolateEnvVars(item));
    }

    if (obj !== null && typeof obj === 'object') {
      return Object.fromEntries(
        Object.entries(obj).map(([key, value]) => [key, this.interpolateEnvVars(value)])
      );
    }

    // Return primitives as-is (number, boolean, null)
    return obj;
  }

  /**
   * Interpolate environment variables in a single string
   *
   * @private
   * @param {string} str - String to interpolate
   * @returns {string} - Interpolated string
   * @throws {ConfigError} - If a required env var is not set
   */
  _interpolateString(str) {
    // Pattern: ${VAR}, ${VAR:-default}, ${VAR:+value}
    // Groups: (1) var name, (2) operator (:-|:+), (3) value after operator
    const pattern = /\$\{([^}:]+)(?:(:[-+])([^}]*))?\}/g;

    return str.replace(pattern, (match, varName, operator, value) => {
      const envValue = process.env[varName];
      const hasValue = envValue !== undefined && envValue !== '';

      if (operator === ':-') {
        // ${VAR:-default} - use default if not set or empty
        return hasValue ? envValue : value;
      }

      if (operator === ':+') {
        // ${VAR:+value} - use value only if VAR is set and non-empty
        return hasValue ? value : '';
      }

      // ${VAR} - required, error if not set
      if (!hasValue) {
        throw new ConfigError(`Required environment variable '${varName}' is not set`, {
          envVar: varName,
        });
      }

      return envValue;
    });
  }

  /**
   * Deep merge two configuration objects
   *
   * Arrays are replaced entirely (not concatenated) to allow bot configs
   * to override default tool arrays completely.
   *
   * @param {Object} defaults - Default configuration
   * @param {Object} overrides - Configuration to merge on top
   * @returns {Object} - Merged configuration (new object, inputs not mutated)
   */
  deepMerge(defaults, overrides) {
    return deepmerge(defaults, overrides, {
      // Replace arrays instead of concatenating
      arrayMerge: (_target, source) => source,
    });
  }

  /**
   * Load a bot configuration and merge it with defaults
   *
   * @param {string} botConfigPath - Path to the bot's config.json
   * @param {Object} defaults - Default configuration to merge with
   * @returns {Promise<Object>} - Merged and interpolated bot configuration
   */
  async loadBotConfig(botConfigPath, defaults = {}) {
    const botConfig = await this.load(botConfigPath);
    return this.deepMerge(defaults, botConfig);
  }
}

export default ConfigLoader;
