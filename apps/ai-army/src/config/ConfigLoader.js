/**
 * ConfigLoader - Loads and processes configuration files with environment variable interpolation
 *
 * Handles:
 * - Loading JSON configuration files
 * - Environment variable interpolation (${VAR}, ${VAR:-default}, ${VAR:+value})
 * - Secret resolution via SecretsManager (${bw:vault/item}, ${1p:vault/item})
 * - Deep merging of configuration objects
 *
 * @module ConfigLoader
 */

import fs from 'fs/promises';
import deepmerge from 'deepmerge';
import { ReferenceParser } from '../secrets/reference-parser.js';

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
   * Create a ConfigLoader instance
   *
   * @param {Object} [options] - Loader options
   * @param {import('../secrets/secrets-manager.js').SecretsManager} [options.secretsManager] -
   *   Optional SecretsManager for resolving secret references (${bw:...}, ${1p:...}).
   *   When provided, secret resolution runs after JSON parsing, replacing the default
   *   env-only interpolation for strings that contain adapter-prefixed references.
   *   Plain ${VAR} references are still routed through the SecretsManager's env adapter.
   */
  constructor(options = {}) {
    /** @type {import('../secrets/secrets-manager.js').SecretsManager|null} */
    this.secretsManager = options.secretsManager || null;

    /** @type {ReferenceParser} */
    this._refParser = new ReferenceParser();
  }

  /**
   * Load a configuration file, parse JSON, and resolve secrets / interpolate env vars
   *
   * When a SecretsManager is configured, all ${...} references (including adapter-prefixed
   * ones like ${bw:vault/item}) are resolved via the SecretsManager. Otherwise, falls back
   * to the legacy env-only interpolation.
   *
   * @param {string} configPath - Path to the configuration file
   * @param {Object} [options] - Load options
   * @param {import('../secrets/secrets-manager.js').SecretsManager} [options.secretsManager] -
   *   Per-call SecretsManager override. Takes precedence over instance-level secretsManager.
   * @returns {Promise<Object>} - Parsed and interpolated configuration object
   * @throws {ConfigError} - If file doesn't exist, is invalid JSON, or has missing required env vars
   */
  async load(configPath, options = {}) {
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

    // Prefer per-call secretsManager, then instance-level, then fall back to env interpolation
    const manager = options.secretsManager || this.secretsManager;

    if (manager) {
      return this._resolveSecrets(config, manager);
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
   * Recursively resolve secret references in a configuration object via SecretsManager
   *
   * Walks through objects, arrays, and strings, resolving every ${...}
   * reference using the provided SecretsManager. This supports adapter-prefixed
   * references (${bw:vault/item}, ${1p:vault/item}) in addition to plain
   * env var references (${VAR}, ${VAR:-default}, ${VAR:+value}).
   *
   * @private
   * @param {*} obj - Value to process (object, array, string, or primitive)
   * @param {import('../secrets/secrets-manager.js').SecretsManager} manager - SecretsManager instance
   * @returns {Promise<*>} - Processed value with secrets resolved
   * @throws {ConfigError} - If secret resolution fails
   */
  async _resolveSecrets(obj, manager) {
    try {
      return await manager.resolveAll(obj);
    } catch (err) {
      throw new ConfigError(`Failed to resolve secrets: ${err.message}`, {
        cause: err,
      });
    }
  }

  /**
   * Check whether a configuration value contains any adapter-prefixed secret references
   *
   * This is useful for determining whether a SecretsManager is needed to resolve
   * a config, or if plain env interpolation would suffice.
   *
   * @param {*} obj - Value to check (object, array, string, or primitive)
   * @returns {boolean} True if any adapter-prefixed references are found
   */
  hasSecretReferences(obj) {
    const refs = this._refParser.extractAllReferences(obj);
    return refs.some(ref => ref.adapter !== 'env');
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
