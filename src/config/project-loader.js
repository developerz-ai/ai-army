/**
 * ProjectLoader - Loads YAML-based project configurations for AI Army
 *
 * Handles loading and resolving a multi-file project configuration:
 * - `ai-army.yml` - Main project configuration (LLM, defaults, imports)
 * - `servers.yml` - Server definitions (SSH, resources)
 * - `workers/*.yml` - Individual worker configurations
 * - `expertise/*.md` - Soul/expertise content for workers
 *
 * Supports `${ENV_VAR}` substitution in all string values, following
 * the pattern from VariableSubstitutor.js but for env-var syntax.
 *
 * @module config/project-loader
 */

import yaml from 'js-yaml';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ProjectValidator, ProjectValidationError } from './project-validator.js';

// =============================================================================
// Custom Error
// =============================================================================

/**
 * Custom error for project loading failures
 */
export class ProjectLoadError extends Error {
  /**
   * Create a ProjectLoadError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - The operation that failed
   * @param {string} [options.filePath] - File path involved
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'ProjectLoadError';
    this.operation = options.operation;
    this.filePath = options.filePath;
  }
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Pattern matching `${VAR_NAME}` environment variable placeholders.
 * Captures the variable name between `${` and `}`.
 * Supports alphanumeric characters and underscores.
 * @type {RegExp}
 */
const ENV_VAR_PATTERN = /\$\{(\w+)\}/g;

/**
 * Default file names for project configuration
 */
const DEFAULT_FILES = Object.freeze({
  main: 'ai-army.yml',
  servers: 'servers.yml',
  workersDir: 'workers',
  expertiseDir: 'expertise',
});

// =============================================================================
// ProjectLoader Class
// =============================================================================

/**
 * Loads and resolves YAML-based project configurations
 */
export class ProjectLoader {
  /**
   * Create a ProjectLoader instance
   *
   * @param {Object} [options={}] - Loader options
   * @param {ProjectValidator} [options.validator] - Custom validator instance
   * @param {boolean} [options.validate] - Whether to validate after loading (default: true)
   * @param {boolean} [options.resolveEnv] - Whether to resolve env vars (default: true)
   */
  constructor(options = {}) {
    /** @type {ProjectValidator} */
    this.validator = options.validator || new ProjectValidator();

    /** @type {boolean} */
    this.validateOnLoad = options.validate !== false;

    /** @type {boolean} */
    this.resolveEnv = options.resolveEnv !== false;
  }

  /**
   * Load a full project configuration from a directory
   *
   * Reads ai-army.yml, servers.yml, and all worker YAML files,
   * resolves env vars, loads expertise files, and optionally validates.
   *
   * @param {string} projectPath - Path to the project root directory
   * @returns {Promise<Object>} Resolved project config: { main, servers, workers }
   * @throws {ProjectLoadError} If any file cannot be read or parsed
   * @throws {ProjectValidationError} If validation is enabled and config is invalid
   */
  async loadProject(projectPath) {
    const absPath = path.resolve(projectPath);

    // 1. Load main config
    const main = await this.loadMainConfig(path.join(absPath, DEFAULT_FILES.main));

    // 2. Load servers
    const serversFile = this._resolveServersPath(absPath, main);
    let servers = [];
    if (await this._fileExists(serversFile)) {
      servers = await this.loadServers(serversFile);
    }

    // 3. Load all workers
    const workers = await this.loadWorkers(absPath, main.workers || []);

    // 4. Build resolved config
    let resolved = { main, servers, workers };

    // 5. Resolve environment variables
    if (this.resolveEnv) {
      resolved = this.resolveEnvVars(resolved);
    }

    // 6. Validate
    if (this.validateOnLoad) {
      const validation = this.validator.validateAll(resolved);
      if (!validation.valid) {
        const report = this.validator.generateReport(validation.errors);
        throw new ProjectValidationError(`Invalid project configuration:\n${report}`, {
          errors: validation.errors,
          configPath: absPath,
        });
      }
    }

    return resolved;
  }

  /**
   * Load the main project configuration file (ai-army.yml)
   *
   * @param {string} filePath - Absolute path to ai-army.yml
   * @returns {Promise<Object>} Parsed main configuration
   * @throws {ProjectLoadError} If file cannot be read or parsed
   */
  async loadMainConfig(filePath) {
    return this._loadYaml(filePath, 'loadMainConfig');
  }

  /**
   * Load server definitions from a YAML file (servers.yml)
   *
   * @param {string} filePath - Absolute path to servers.yml
   * @returns {Promise<Array<Object>>} Array of server configurations
   * @throws {ProjectLoadError} If file cannot be read or parsed
   */
  async loadServers(filePath) {
    const data = await this._loadYaml(filePath, 'loadServers');

    // servers.yml can be { servers: [...] } or just an array
    if (Array.isArray(data)) {
      return data;
    }
    if (data && Array.isArray(data.servers)) {
      return data.servers;
    }

    throw new ProjectLoadError(
      `Invalid servers file format: expected { servers: [...] } or an array`,
      { operation: 'loadServers', filePath }
    );
  }

  /**
   * Load worker configurations from YAML files
   *
   * Resolves worker file paths relative to the project root,
   * and loads expertise file content when referenced.
   *
   * @param {string} projectPath - Project root directory
   * @param {Array<string>} workerPaths - Array of relative paths to worker YAML files
   * @returns {Promise<Array<Object>>} Array of worker configurations
   * @throws {ProjectLoadError} If any worker file cannot be read or parsed
   */
  async loadWorkers(projectPath, workerPaths) {
    const workers = [];

    for (const workerPath of workerPaths) {
      const fullPath = path.join(projectPath, workerPath);
      const workerConfig = await this._loadYaml(fullPath, 'loadWorkers');

      // Load expertise file if referenced as { file: 'path.md' }
      if (workerConfig.expertise && typeof workerConfig.expertise === 'object') {
        if (workerConfig.expertise.file) {
          const expertisePath = path.join(projectPath, workerConfig.expertise.file);
          try {
            workerConfig.expertise = await fs.readFile(expertisePath, 'utf8');
          } catch (err) {
            throw new ProjectLoadError(`Failed to read expertise file: ${expertisePath}`, {
              cause: err,
              operation: 'loadWorkers',
              filePath: expertisePath,
            });
          }
        }
      }

      workers.push(workerConfig);
    }

    return workers;
  }

  /**
   * Resolve `${ENV_VAR}` placeholders in all string values of a config object
   *
   * Performs a deep clone first to avoid mutating the original config.
   * Unknown env vars (not set in process.env) are left unchanged.
   *
   * @param {Object} config - Configuration object to resolve
   * @returns {Object} New config with env vars resolved
   */
  resolveEnvVars(config) {
    const cloned = JSON.parse(JSON.stringify(config));
    this._resolveEnvVarsRecursive(cloned);
    return cloned;
  }

  /**
   * Detect changes between two project configurations
   *
   * Compares old and new configs and returns a summary of what changed.
   * Useful for hot-reload scenarios.
   *
   * @param {Object} oldConfig - Previous project configuration
   * @param {Object} newConfig - New project configuration
   * @returns {Object} Changes summary: { hasChanges, main, servers, workers }
   */
  detectChanges(oldConfig, newConfig) {
    const changes = {
      hasChanges: false,
      main: false,
      servers: { added: [], removed: [], modified: [] },
      workers: { added: [], removed: [], modified: [] },
    };

    // Compare main config
    if (JSON.stringify(oldConfig.main) !== JSON.stringify(newConfig.main)) {
      changes.main = true;
      changes.hasChanges = true;
    }

    // Compare servers
    const oldServerMap = this._indexById(oldConfig.servers || []);
    const newServerMap = this._indexById(newConfig.servers || []);
    this._diffMaps(oldServerMap, newServerMap, changes.servers);
    if (
      changes.servers.added.length > 0 ||
      changes.servers.removed.length > 0 ||
      changes.servers.modified.length > 0
    ) {
      changes.hasChanges = true;
    }

    // Compare workers
    const oldWorkerMap = this._indexById(oldConfig.workers || []);
    const newWorkerMap = this._indexById(newConfig.workers || []);
    this._diffMaps(oldWorkerMap, newWorkerMap, changes.workers);
    if (
      changes.workers.added.length > 0 ||
      changes.workers.removed.length > 0 ||
      changes.workers.modified.length > 0
    ) {
      changes.hasChanges = true;
    }

    return changes;
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  /**
   * Load and parse a YAML file
   *
   * @private
   * @param {string} filePath - Absolute path to the YAML file
   * @param {string} operation - Name of the calling operation (for errors)
   * @returns {Promise<Object>} Parsed YAML content
   * @throws {ProjectLoadError} If file cannot be read or YAML is invalid
   */
  async _loadYaml(filePath, operation) {
    let content;
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch (err) {
      throw new ProjectLoadError(`Failed to read file: ${filePath}`, {
        cause: err,
        operation,
        filePath,
      });
    }

    try {
      const parsed = yaml.load(content);
      if (parsed === null || parsed === undefined) {
        return {};
      }
      return parsed;
    } catch (err) {
      throw new ProjectLoadError(`Failed to parse YAML: ${filePath}`, {
        cause: err,
        operation,
        filePath,
      });
    }
  }

  /**
   * Resolve the path to the servers file based on main config
   *
   * @private
   * @param {string} projectPath - Project root directory
   * @param {Object} mainConfig - Parsed main configuration
   * @returns {string} Absolute path to servers file
   */
  _resolveServersPath(projectPath, mainConfig) {
    const serversDef = mainConfig.servers;

    if (!serversDef) {
      return path.join(projectPath, DEFAULT_FILES.servers);
    }

    if (typeof serversDef === 'string') {
      return path.join(projectPath, serversDef);
    }

    if (typeof serversDef === 'object' && serversDef.import) {
      return path.join(projectPath, serversDef.import);
    }

    return path.join(projectPath, DEFAULT_FILES.servers);
  }

  /**
   * Recursively replace `${VAR}` placeholders in an object
   *
   * @private
   * @param {*} obj - Object to process in-place
   */
  _resolveEnvVarsRecursive(obj) {
    if (obj === null || obj === undefined) return;

    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        if (typeof obj[i] === 'string') {
          obj[i] = this._replaceEnvVars(obj[i]);
        } else if (typeof obj[i] === 'object') {
          this._resolveEnvVarsRecursive(obj[i]);
        }
      }
      return;
    }

    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === 'string') {
        obj[key] = this._replaceEnvVars(obj[key]);
      } else if (typeof obj[key] === 'object') {
        this._resolveEnvVarsRecursive(obj[key]);
      }
    }
  }

  /**
   * Replace `${VAR}` patterns in a string with env var values
   *
   * @private
   * @param {string} str - String to process
   * @returns {string} String with env vars replaced
   */
  _replaceEnvVars(str) {
    return str.replace(ENV_VAR_PATTERN, (match, varName) => {
      const value = process.env[varName];
      return value !== undefined ? value : match;
    });
  }

  /**
   * Check if a file exists
   *
   * @private
   * @param {string} filePath - Path to check
   * @returns {Promise<boolean>} Whether the file exists
   */
  async _fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Index an array of objects by their `id` property
   *
   * @private
   * @param {Array<Object>} items - Array of items with `id` fields
   * @returns {Map<string, Object>} Map of id -> item
   */
  _indexById(items) {
    const map = new Map();
    for (const item of items) {
      if (item.id) {
        map.set(item.id, item);
      }
    }
    return map;
  }

  /**
   * Compute added/removed/modified between two id-indexed maps
   *
   * @private
   * @param {Map<string, Object>} oldMap - Previous items
   * @param {Map<string, Object>} newMap - New items
   * @param {Object} target - Target object with added/removed/modified arrays
   */
  _diffMaps(oldMap, newMap, target) {
    // Added: in new but not in old
    for (const id of newMap.keys()) {
      if (!oldMap.has(id)) {
        target.added.push(id);
      }
    }

    // Removed: in old but not in new
    for (const id of oldMap.keys()) {
      if (!newMap.has(id)) {
        target.removed.push(id);
      }
    }

    // Modified: in both but different
    for (const [id, newItem] of newMap.entries()) {
      const oldItem = oldMap.get(id);
      if (oldItem && JSON.stringify(oldItem) !== JSON.stringify(newItem)) {
        target.modified.push(id);
      }
    }
  }
}

export default ProjectLoader;
