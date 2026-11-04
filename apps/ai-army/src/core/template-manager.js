/**
 * TemplateManager - Reusable bot template and instance management
 *
 * Manages the full lifecycle of templates and instances:
 * - Templates: reusable bot configurations with `{{variable}}` placeholders
 * - Instances: deployed copies of templates with per-instance overrides
 *
 * Instance creation merges the template config with instance overrides
 * (deep merge), then applies variable substitution via VariableSubstitutor.
 *
 * Dependencies:
 * - storage: PostgresStorage instance for persisting templates and instances
 * - variableSubstitutor: VariableSubstitutor for `{{var}}` replacement (optional, created if not provided)
 *
 * @module core/template-manager
 */

import { VariableSubstitutor } from '../utils/VariableSubstitutor.js';

/**
 * Valid instance status values
 * @type {Readonly<Object>}
 */
export const INSTANCE_STATUSES = Object.freeze({
  STARTING: 'starting',
  RUNNING: 'running',
  STOPPED: 'stopped',
  ERROR: 'error',
});

/**
 * Custom error for template management failures
 */
export class TemplateManagerError extends Error {
  /**
   * Create a TemplateManagerError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - The operation that failed
   * @param {string} [options.templateId] - Template ID involved
   * @param {string} [options.instanceId] - Instance ID involved
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'TemplateManagerError';
    this.operation = options.operation;
    this.templateId = options.templateId;
    this.instanceId = options.instanceId;
  }
}

/**
 * TemplateManager - manages reusable bot templates and their instances
 */
export class TemplateManager {
  /**
   * Create a TemplateManager instance
   * @param {Object} storage - PostgresStorage instance for persistence
   * @param {Object} [options={}] - Configuration options
   * @param {VariableSubstitutor} [options.variableSubstitutor] - Custom VariableSubstitutor
   */
  constructor(storage, options = {}) {
    if (!storage) {
      throw new TemplateManagerError('Storage is required', {
        operation: 'constructor',
      });
    }

    this.storage = storage;
    this.variableSubstitutor = options.variableSubstitutor || new VariableSubstitutor();
  }

  // ============================================================================
  // Template CRUD
  // ============================================================================

  /**
   * Create a new template
   *
   * Stores a reusable bot configuration template in the database.
   * The config may contain `{{variable}}` placeholders that will be
   * resolved when instances are created.
   *
   * @param {Object} templateConfig - Template definition
   * @param {string} templateConfig.id - Unique template identifier
   * @param {string} templateConfig.name - Human-readable template name
   * @param {string} [templateConfig.description] - What this template is for
   * @param {Object} templateConfig.config - Bot configuration (model, tools, channel, etc.)
   * @param {string} [templateConfig.soulTemplate] - Soul.md content with `{{variable}}` placeholders
   * @returns {Promise<Object>} Created template record
   * @throws {TemplateManagerError} If validation or storage fails
   */
  async createTemplate(templateConfig) {
    if (!templateConfig || typeof templateConfig !== 'object') {
      throw new TemplateManagerError('Template config must be a non-null object', {
        operation: 'createTemplate',
      });
    }

    const { id, name, description, config, soulTemplate } = templateConfig;

    if (!id || typeof id !== 'string') {
      throw new TemplateManagerError('Template ID must be a non-empty string', {
        operation: 'createTemplate',
      });
    }

    if (!name || typeof name !== 'string') {
      throw new TemplateManagerError('Template name must be a non-empty string', {
        operation: 'createTemplate',
        templateId: id,
      });
    }

    if (!config || typeof config !== 'object') {
      throw new TemplateManagerError('Template config.config must be a non-null object', {
        operation: 'createTemplate',
        templateId: id,
      });
    }

    try {
      // Check for duplicate
      const existing = await this._getTemplateRow(id);
      if (existing) {
        throw new TemplateManagerError(`Template '${id}' already exists`, {
          operation: 'createTemplate',
          templateId: id,
        });
      }

      await this.storage.query(
        `INSERT INTO templates (id, name, description, config, soul_template)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, name, description || null, JSON.stringify(config), soulTemplate || null]
      );

      return this._toTemplate({ id, name, description, config, soul_template: soulTemplate });
    } catch (err) {
      if (err instanceof TemplateManagerError) {
        throw err;
      }
      throw new TemplateManagerError(`Failed to create template '${id}': ${err.message}`, {
        cause: err,
        operation: 'createTemplate',
        templateId: id,
      });
    }
  }

  /**
   * Get a template by ID
   *
   * @param {string} templateId - Template identifier
   * @returns {Promise<Object|null>} Template record or null if not found
   * @throws {TemplateManagerError} If query fails
   */
  async getTemplate(templateId) {
    if (!templateId || typeof templateId !== 'string') {
      throw new TemplateManagerError('Template ID must be a non-empty string', {
        operation: 'getTemplate',
      });
    }

    try {
      const row = await this._getTemplateRow(templateId);
      return row ? this._toTemplate(row) : null;
    } catch (err) {
      if (err instanceof TemplateManagerError) {
        throw err;
      }
      throw new TemplateManagerError(`Failed to get template '${templateId}': ${err.message}`, {
        cause: err,
        operation: 'getTemplate',
        templateId,
      });
    }
  }

  /**
   * List all templates
   *
   * @returns {Promise<Array<Object>>} Array of template records ordered by creation date
   * @throws {TemplateManagerError} If query fails
   */
  async listTemplates() {
    try {
      const { rows } = await this.storage.query('SELECT * FROM templates ORDER BY created_at DESC');
      return rows.map(row => this._toTemplate(row));
    } catch (err) {
      throw new TemplateManagerError(`Failed to list templates: ${err.message}`, {
        cause: err,
        operation: 'listTemplates',
      });
    }
  }

  /**
   * Delete a template by ID
   *
   * Also deletes all associated instances (via CASCADE in database).
   *
   * @param {string} templateId - Template identifier
   * @returns {Promise<boolean>} True if template was deleted
   * @throws {TemplateManagerError} If delete fails
   */
  async deleteTemplate(templateId) {
    if (!templateId || typeof templateId !== 'string') {
      throw new TemplateManagerError('Template ID must be a non-empty string', {
        operation: 'deleteTemplate',
      });
    }

    try {
      const { rowCount } = await this.storage.query('DELETE FROM templates WHERE id = $1', [
        templateId,
      ]);
      return rowCount > 0;
    } catch (err) {
      throw new TemplateManagerError(`Failed to delete template '${templateId}': ${err.message}`, {
        cause: err,
        operation: 'deleteTemplate',
        templateId,
      });
    }
  }

  // ============================================================================
  // Instance CRUD
  // ============================================================================

  /**
   * Create an instance from a template
   *
   * Merges the template config with instance-specific overrides (deep merge),
   * then applies variable substitution to the soul template and all config
   * string values.
   *
   * @param {string} templateId - Template to create instance from
   * @param {Object} instanceConfig - Instance definition
   * @param {string} instanceConfig.id - Unique instance identifier
   * @param {string} [instanceConfig.name] - Human-readable instance name
   * @param {Object} [instanceConfig.overrides={}] - Config overrides (variables, channel, etc.)
   * @returns {Promise<Object>} Created instance record with resolved config
   * @throws {TemplateManagerError} If template not found, validation fails, or storage fails
   */
  async createInstance(templateId, instanceConfig) {
    if (!templateId || typeof templateId !== 'string') {
      throw new TemplateManagerError('Template ID must be a non-empty string', {
        operation: 'createInstance',
      });
    }

    if (!instanceConfig || typeof instanceConfig !== 'object') {
      throw new TemplateManagerError('Instance config must be a non-null object', {
        operation: 'createInstance',
        templateId,
      });
    }

    const { id: instanceId, name, overrides = {} } = instanceConfig;

    if (!instanceId || typeof instanceId !== 'string') {
      throw new TemplateManagerError('Instance ID must be a non-empty string', {
        operation: 'createInstance',
        templateId,
      });
    }

    try {
      // Fetch the template
      const template = await this.getTemplate(templateId);
      if (!template) {
        throw new TemplateManagerError(`Template '${templateId}' not found`, {
          operation: 'createInstance',
          templateId,
          instanceId,
        });
      }

      // Check for duplicate instance
      const existingInstance = await this._getInstanceRow(instanceId);
      if (existingInstance) {
        throw new TemplateManagerError(`Instance '${instanceId}' already exists`, {
          operation: 'createInstance',
          templateId,
          instanceId,
        });
      }

      // Deep merge template config + instance overrides
      const mergedConfig = this._deepMerge(template.config, overrides);

      // Extract variables from overrides (or merged config)
      const variables = mergedConfig.variables || {};

      // Apply variable substitution to the merged config
      const resolvedConfig = this.variableSubstitutor.substituteDeep(mergedConfig, variables);

      // Apply variable substitution to soul template
      let resolvedSoul = template.soulTemplate || null;
      if (resolvedSoul && typeof resolvedSoul === 'string') {
        resolvedSoul = this.variableSubstitutor.substitute(resolvedSoul, variables);
      }

      // Store the instance
      await this.storage.query(
        `INSERT INTO instances (id, template_id, name, overrides, status)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          instanceId,
          templateId,
          name || instanceId,
          JSON.stringify(overrides),
          INSTANCE_STATUSES.STOPPED,
        ]
      );

      return {
        id: instanceId,
        templateId,
        name: name || instanceId,
        overrides,
        status: INSTANCE_STATUSES.STOPPED,
        resolvedConfig,
        resolvedSoul,
      };
    } catch (err) {
      if (err instanceof TemplateManagerError) {
        throw err;
      }
      throw new TemplateManagerError(
        `Failed to create instance '${instanceId}' from template '${templateId}': ${err.message}`,
        {
          cause: err,
          operation: 'createInstance',
          templateId,
          instanceId,
        }
      );
    }
  }

  /**
   * List instances, optionally filtered by template ID
   *
   * @param {Object} [filter={}] - Filter options
   * @param {string} [filter.templateId] - Filter by template ID
   * @param {string} [filter.status] - Filter by instance status
   * @returns {Promise<Array<Object>>} Array of instance records
   * @throws {TemplateManagerError} If query fails
   */
  async listInstances(filter = {}) {
    try {
      let sql = 'SELECT * FROM instances';
      const params = [];
      const conditions = [];

      if (filter.templateId) {
        conditions.push(`template_id = $${params.length + 1}`);
        params.push(filter.templateId);
      }

      if (filter.status) {
        conditions.push(`status = $${params.length + 1}`);
        params.push(filter.status);
      }

      if (conditions.length > 0) {
        sql += ` WHERE ${conditions.join(' AND ')}`;
      }

      sql += ' ORDER BY created_at DESC';

      const { rows } = await this.storage.query(sql, params);
      return rows.map(row => this._toInstance(row));
    } catch (err) {
      throw new TemplateManagerError(`Failed to list instances: ${err.message}`, {
        cause: err,
        operation: 'listInstances',
      });
    }
  }

  /**
   * Get an instance by ID
   *
   * @param {string} instanceId - Instance identifier
   * @returns {Promise<Object|null>} Instance record or null if not found
   * @throws {TemplateManagerError} If query fails
   */
  async getInstance(instanceId) {
    if (!instanceId || typeof instanceId !== 'string') {
      throw new TemplateManagerError('Instance ID must be a non-empty string', {
        operation: 'getInstance',
      });
    }

    try {
      const row = await this._getInstanceRow(instanceId);
      return row ? this._toInstance(row) : null;
    } catch (err) {
      if (err instanceof TemplateManagerError) {
        throw err;
      }
      throw new TemplateManagerError(`Failed to get instance '${instanceId}': ${err.message}`, {
        cause: err,
        operation: 'getInstance',
        instanceId,
      });
    }
  }

  /**
   * Update instance status
   *
   * @param {string} instanceId - Instance identifier
   * @param {string} status - New status ('starting' | 'running' | 'stopped' | 'error')
   * @returns {Promise<boolean>} True if instance was found and updated
   * @throws {TemplateManagerError} If update fails or status is invalid
   */
  async updateInstanceStatus(instanceId, status) {
    if (!instanceId || typeof instanceId !== 'string') {
      throw new TemplateManagerError('Instance ID must be a non-empty string', {
        operation: 'updateInstanceStatus',
      });
    }

    const validStatuses = Object.values(INSTANCE_STATUSES);
    if (!validStatuses.includes(status)) {
      throw new TemplateManagerError(
        `Invalid instance status '${status}'. Must be one of: ${validStatuses.join(', ')}`,
        {
          operation: 'updateInstanceStatus',
          instanceId,
        }
      );
    }

    try {
      const { rowCount } = await this.storage.query(
        'UPDATE instances SET status = $1 WHERE id = $2',
        [status, instanceId]
      );
      return rowCount > 0;
    } catch (err) {
      throw new TemplateManagerError(
        `Failed to update instance '${instanceId}' status: ${err.message}`,
        {
          cause: err,
          operation: 'updateInstanceStatus',
          instanceId,
        }
      );
    }
  }

  /**
   * Delete an instance by ID
   *
   * @param {string} instanceId - Instance identifier
   * @returns {Promise<boolean>} True if instance was deleted
   * @throws {TemplateManagerError} If delete fails
   */
  async deleteInstance(instanceId) {
    if (!instanceId || typeof instanceId !== 'string') {
      throw new TemplateManagerError('Instance ID must be a non-empty string', {
        operation: 'deleteInstance',
      });
    }

    try {
      const { rowCount } = await this.storage.query('DELETE FROM instances WHERE id = $1', [
        instanceId,
      ]);
      return rowCount > 0;
    } catch (err) {
      throw new TemplateManagerError(`Failed to delete instance '${instanceId}': ${err.message}`, {
        cause: err,
        operation: 'deleteInstance',
        instanceId,
      });
    }
  }

  // ============================================================================
  // Resolve helpers (for Orchestrator integration)
  // ============================================================================

  /**
   * Resolve an instance's full configuration by merging template + overrides
   *
   * Useful for the Orchestrator to get the final bot config from an instance.
   *
   * @param {string} instanceId - Instance identifier
   * @returns {Promise<Object>} Resolved config with `resolvedConfig` and `resolvedSoul`
   * @throws {TemplateManagerError} If instance or template not found
   */
  async resolveInstance(instanceId) {
    if (!instanceId || typeof instanceId !== 'string') {
      throw new TemplateManagerError('Instance ID must be a non-empty string', {
        operation: 'resolveInstance',
      });
    }

    try {
      const instance = await this.getInstance(instanceId);
      if (!instance) {
        throw new TemplateManagerError(`Instance '${instanceId}' not found`, {
          operation: 'resolveInstance',
          instanceId,
        });
      }

      const template = await this.getTemplate(instance.templateId);
      if (!template) {
        throw new TemplateManagerError(
          `Template '${instance.templateId}' not found for instance '${instanceId}'`,
          {
            operation: 'resolveInstance',
            templateId: instance.templateId,
            instanceId,
          }
        );
      }

      // Deep merge and substitute
      const mergedConfig = this._deepMerge(template.config, instance.overrides);
      const variables = mergedConfig.variables || {};
      const resolvedConfig = this.variableSubstitutor.substituteDeep(mergedConfig, variables);

      let resolvedSoul = template.soulTemplate || null;
      if (resolvedSoul && typeof resolvedSoul === 'string') {
        resolvedSoul = this.variableSubstitutor.substitute(resolvedSoul, variables);
      }

      return {
        id: instance.id,
        templateId: instance.templateId,
        name: instance.name,
        status: instance.status,
        resolvedConfig,
        resolvedSoul,
      };
    } catch (err) {
      if (err instanceof TemplateManagerError) {
        throw err;
      }
      throw new TemplateManagerError(`Failed to resolve instance '${instanceId}': ${err.message}`, {
        cause: err,
        operation: 'resolveInstance',
        instanceId,
      });
    }
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  /**
   * Fetch a raw template row from the database
   *
   * @param {string} templateId - Template identifier
   * @returns {Promise<Object|null>} Raw database row or null
   * @private
   */
  async _getTemplateRow(templateId) {
    const { rows } = await this.storage.query('SELECT * FROM templates WHERE id = $1', [
      templateId,
    ]);
    return rows[0] || null;
  }

  /**
   * Fetch a raw instance row from the database
   *
   * @param {string} instanceId - Instance identifier
   * @returns {Promise<Object|null>} Raw database row or null
   * @private
   */
  async _getInstanceRow(instanceId) {
    const { rows } = await this.storage.query('SELECT * FROM instances WHERE id = $1', [
      instanceId,
    ]);
    return rows[0] || null;
  }

  /**
   * Transform a database template row to a camelCase template object
   *
   * @param {Object} row - Raw database row
   * @returns {Object} Template object with camelCase keys
   * @private
   */
  _toTemplate(row) {
    return {
      id: row.id,
      name: row.name,
      description: row.description || null,
      config: typeof row.config === 'string' ? JSON.parse(row.config) : row.config,
      soulTemplate: row.soul_template || row.soulTemplate || null,
      version: row.version ?? 1,
      createdAt: row.created_at || row.createdAt || null,
      updatedAt: row.updated_at || row.updatedAt || null,
    };
  }

  /**
   * Transform a database instance row to a camelCase instance object
   *
   * @param {Object} row - Raw database row
   * @returns {Object} Instance object with camelCase keys
   * @private
   */
  _toInstance(row) {
    return {
      id: row.id,
      templateId: row.template_id || row.templateId,
      name: row.name || null,
      overrides:
        typeof row.overrides === 'string' ? JSON.parse(row.overrides) : row.overrides || {},
      status: row.status,
      createdAt: row.created_at || row.createdAt || null,
      updatedAt: row.updated_at || row.updatedAt || null,
    };
  }

  /**
   * Deep merge two objects (target + source)
   *
   * Source values override target values. Arrays are replaced (not concatenated).
   * Nested objects are merged recursively.
   *
   * @param {Object} target - Base object (template config)
   * @param {Object} source - Override object (instance overrides)
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
}
