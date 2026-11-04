/**
 * TemplateLoader - Filesystem-based YAML template loader for worker templates
 *
 * Reads worker template definitions from YAML files on disk (e.g. `templates/workers/*.yml`).
 * Designed for open-source distribution where templates live in the repo rather
 * than in a database. Different from the DB-backed `TemplateManager`.
 *
 * Responsibilities:
 * - Load and parse all YAML templates from a directory
 * - Retrieve a specific template by type/id
 * - List all available templates
 * - Instantiate a worker config by merging a template with overrides
 *
 * Used by `GenerateCommand` and template API endpoints.
 *
 * @module core/template-loader
 */

import yaml from 'js-yaml';
import fs from 'node:fs/promises';
import path from 'node:path';

// =============================================================================
// Custom Error
// =============================================================================

/**
 * Custom error for template loading failures
 */
export class TemplateLoaderError extends Error {
  /**
   * Create a TemplateLoaderError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - The operation that failed
   * @param {string} [options.templateId] - Template ID involved
   * @param {string} [options.filePath] - File path involved
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'TemplateLoaderError';
    this.operation = options.operation;
    this.templateId = options.templateId;
    this.filePath = options.filePath;
  }
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Glob pattern suffix for YAML files
 * @type {string}
 */
const YAML_EXT = '.yml';

// =============================================================================
// TemplateLoader Class
// =============================================================================

/**
 * Loads worker templates from YAML files on the filesystem
 *
 * @example
 * const loader = new TemplateLoader();
 * await loader.loadTemplates('templates/workers');
 * const tpl = loader.getTemplate('backend-developer');
 * const worker = loader.instantiateWorker('backend-developer', { deployment: { replicas: 3 } });
 */
export class TemplateLoader {
  /**
   * Create a TemplateLoader instance
   *
   * @param {Object} [options={}] - Loader options
   * @param {Object} [options.fs] - File system module (for DI/testing)
   */
  constructor(options = {}) {
    /** @type {Map<string, Object>} Loaded templates indexed by id */
    this.templates = new Map();

    /** @type {boolean} Whether templates have been loaded */
    this.loaded = false;

    /** @type {Object} File system module */
    this._fs = options.fs || fs;
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Load all YAML templates from a directory
   *
   * Reads every `*.yml` file in `templatesDir`, parses it, validates
   * that it contains an `id` field, and stores it in the in-memory map.
   * Subsequent calls reload templates from disk (allows hot-reload).
   *
   * @param {string} templatesDir - Absolute or relative path to the templates directory
   * @returns {Promise<Map<string, Object>>} Map of template id -> parsed config
   * @throws {TemplateLoaderError} If the directory cannot be read or any YAML is invalid
   */
  async loadTemplates(templatesDir) {
    const absDir = path.resolve(templatesDir);

    // Verify directory exists
    let dirStat;
    try {
      dirStat = await this._fs.stat(absDir);
    } catch (err) {
      throw new TemplateLoaderError(`Templates directory not found: ${absDir}`, {
        cause: err,
        operation: 'loadTemplates',
        filePath: absDir,
      });
    }

    if (!dirStat.isDirectory()) {
      throw new TemplateLoaderError(`Not a directory: ${absDir}`, {
        operation: 'loadTemplates',
        filePath: absDir,
      });
    }

    // Read directory entries
    let entries;
    try {
      entries = await this._fs.readdir(absDir);
    } catch (err) {
      throw new TemplateLoaderError(`Failed to read templates directory: ${absDir}`, {
        cause: err,
        operation: 'loadTemplates',
        filePath: absDir,
      });
    }

    // Filter to .yml files and sort for deterministic order
    const ymlFiles = entries.filter(f => f.endsWith(YAML_EXT)).sort();

    if (ymlFiles.length === 0) {
      this.templates.clear();
      this.loaded = true;
      return this.templates;
    }

    // Clear existing templates (reload scenario)
    const newTemplates = new Map();

    for (const file of ymlFiles) {
      const filePath = path.join(absDir, file);
      const template = await this._loadYamlFile(filePath);

      // Validate that the template has an id
      if (!template.id || typeof template.id !== 'string') {
        throw new TemplateLoaderError(`Template file '${file}' is missing a valid 'id' field`, {
          operation: 'loadTemplates',
          filePath,
        });
      }

      // Check for duplicate ids
      if (newTemplates.has(template.id)) {
        throw new TemplateLoaderError(`Duplicate template id '${template.id}' found in '${file}'`, {
          operation: 'loadTemplates',
          templateId: template.id,
          filePath,
        });
      }

      // Store the source file path for reference
      template._filePath = filePath;
      newTemplates.set(template.id, template);
    }

    this.templates = newTemplates;
    this.loaded = true;
    return this.templates;
  }

  /**
   * Get a template by its type/id
   *
   * @param {string} type - Template identifier (e.g., 'backend-developer')
   * @returns {Object|null} Template object or null if not found
   * @throws {TemplateLoaderError} If templates have not been loaded yet
   */
  getTemplate(type) {
    if (!type || typeof type !== 'string') {
      throw new TemplateLoaderError('Template type must be a non-empty string', {
        operation: 'getTemplate',
      });
    }

    this._ensureLoaded('getTemplate');

    const template = this.templates.get(type);
    return template ? { ...template } : null;
  }

  /**
   * List all available templates
   *
   * Returns an array of template summary objects (id, name, description).
   *
   * @returns {Array<Object>} Array of template summaries
   * @throws {TemplateLoaderError} If templates have not been loaded yet
   */
  listTemplates() {
    this._ensureLoaded('listTemplates');

    const list = [];
    for (const template of this.templates.values()) {
      list.push({
        id: template.id,
        name: template.name || template.id,
        description: template.description || null,
        enabled: template.enabled !== false,
        tools: template.tools || [],
        container: template.container || null,
      });
    }

    return list;
  }

  /**
   * Instantiate a worker configuration from a template with overrides
   *
   * Deep-merges the template with the provided overrides object.
   * The overrides take precedence over template values.
   * Internal metadata fields (prefixed with `_`) are stripped from the result.
   *
   * @param {string} type - Template type/id
   * @param {Object} [overrides={}] - Configuration overrides to merge on top
   * @returns {Object} Merged worker configuration
   * @throws {TemplateLoaderError} If template not found or type is invalid
   */
  instantiateWorker(type, overrides = {}) {
    if (!type || typeof type !== 'string') {
      throw new TemplateLoaderError('Template type must be a non-empty string', {
        operation: 'instantiateWorker',
      });
    }

    this._ensureLoaded('instantiateWorker');

    const template = this.templates.get(type);
    if (!template) {
      throw new TemplateLoaderError(`Template '${type}' not found`, {
        operation: 'instantiateWorker',
        templateId: type,
      });
    }

    // Deep merge template with overrides
    const merged = this._deepMerge(template, overrides);

    // Strip internal metadata fields
    return this._stripInternal(merged);
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  /**
   * Ensure templates have been loaded before accessing them
   *
   * @param {string} operation - Name of the calling operation
   * @throws {TemplateLoaderError} If templates have not been loaded
   * @private
   */
  _ensureLoaded(operation) {
    if (!this.loaded) {
      throw new TemplateLoaderError('Templates have not been loaded. Call loadTemplates() first.', {
        operation,
      });
    }
  }

  /**
   * Load and parse a single YAML file
   *
   * @param {string} filePath - Absolute path to the YAML file
   * @returns {Promise<Object>} Parsed YAML content
   * @throws {TemplateLoaderError} If file cannot be read or YAML is invalid
   * @private
   */
  async _loadYamlFile(filePath) {
    let content;
    try {
      content = await this._fs.readFile(filePath, 'utf8');
    } catch (err) {
      throw new TemplateLoaderError(`Failed to read template file: ${filePath}`, {
        cause: err,
        operation: 'loadTemplates',
        filePath,
      });
    }

    try {
      const parsed = yaml.load(content);
      if (parsed === null || parsed === undefined || typeof parsed !== 'object') {
        throw new TemplateLoaderError(
          `Template file '${path.basename(filePath)}' did not parse to an object`,
          {
            operation: 'loadTemplates',
            filePath,
          }
        );
      }
      return parsed;
    } catch (err) {
      if (err instanceof TemplateLoaderError) {
        throw err;
      }
      throw new TemplateLoaderError(
        `Failed to parse YAML in '${path.basename(filePath)}': ${err.message}`,
        {
          cause: err,
          operation: 'loadTemplates',
          filePath,
        }
      );
    }
  }

  /**
   * Deep merge two objects (target + source)
   *
   * Source values override target values. Arrays are replaced (not concatenated).
   * Nested objects are merged recursively.
   *
   * @param {Object} target - Base object (template)
   * @param {Object} source - Override object
   * @returns {Object} Merged object (new object, inputs are not mutated)
   * @private
   */
  _deepMerge(target, source) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      return target;
    }

    if (!target || typeof target !== 'object' || Array.isArray(target)) {
      return source;
    }

    const result = { ...target };

    for (const [key, val] of Object.entries(source)) {
      if (
        val !== null &&
        typeof val === 'object' &&
        !Array.isArray(val) &&
        target[key] !== null &&
        typeof target[key] === 'object' &&
        !Array.isArray(target[key])
      ) {
        result[key] = this._deepMerge(target[key], val);
      } else {
        result[key] = val;
      }
    }

    return result;
  }

  /**
   * Strip internal metadata fields (keys starting with `_`) from an object
   *
   * @param {Object} obj - Object to strip
   * @returns {Object} New object without internal fields
   * @private
   */
  _stripInternal(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return obj;
    }

    const result = {};
    for (const [key, val] of Object.entries(obj)) {
      if (key.startsWith('_')) continue;

      if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
        result[key] = this._stripInternal(val);
      } else {
        result[key] = val;
      }
    }
    return result;
  }
}

export default TemplateLoader;
