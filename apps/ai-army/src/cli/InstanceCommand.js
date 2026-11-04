/**
 * InstanceCommand - Manage template instances via CLI
 *
 * Provides subcommands for the full instance lifecycle:
 *   create  - Create a new instance from a template
 *   list    - List all instances (optionally filtered by template)
 *   scale   - Create multiple instances from a template
 *   stop    - Stop a running instance
 *   rm      - Remove (delete) an instance
 *
 * All subcommands delegate to TemplateManager for actual persistence and
 * use dependency injection for storage and output to support testability.
 *
 * @module cli/InstanceCommand
 */

import { TemplateManager, INSTANCE_STATUSES } from '../core/template-manager.js';

/**
 * Custom error for instance command failures
 */
export class InstanceCommandError extends Error {
  /**
   * Create an InstanceCommandError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - The subcommand that failed
   * @param {string} [options.instanceId] - Instance ID involved
   * @param {string} [options.templateId] - Template ID involved
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'InstanceCommandError';
    this.operation = options.operation;
    this.instanceId = options.instanceId;
    this.templateId = options.templateId;
  }
}

/**
 * Parse `--override key=value` pairs into an overrides object
 *
 * Supports dot-notation keys for nested values (e.g., `variables.teamName=Acme`).
 *
 * @param {Array<string>} overridePairs - Array of "key=value" strings
 * @returns {Object} Parsed overrides object
 * @private
 */
function parseOverrides(overridePairs) {
  const result = {};

  for (const pair of overridePairs) {
    const eqIndex = pair.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }

    const key = pair.slice(0, eqIndex).trim();
    const value = pair.slice(eqIndex + 1).trim();

    // Support dot-notation for nested keys (e.g., "variables.teamName")
    const parts = key.split('.');
    let current = result;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]] || typeof current[parts[i]] !== 'object') {
        current[parts[i]] = {};
      }
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
  }

  return result;
}

// =============================================================================
// Subcommand handlers
// =============================================================================

/**
 * Create a new instance from a template
 *
 * @param {Object} options - Command options
 * @param {string} options.templateId - Template to create instance from
 * @param {string} options.instanceId - Unique ID for the new instance
 * @param {string} [options.name] - Human-readable instance name
 * @param {Array<string>} [options.overrides=[]] - Key=value override pairs
 * @param {Object} options.templateManager - TemplateManager instance
 * @param {Function} options.write - Output writer function
 * @returns {Promise<Object>} Result with success flag and instance data
 * @private
 */
async function instanceCreate({
  templateId,
  instanceId,
  name,
  overrides = [],
  templateManager,
  write,
}) {
  if (!templateId) {
    throw new InstanceCommandError('Template ID is required for create', {
      operation: 'create',
    });
  }

  if (!instanceId) {
    throw new InstanceCommandError('Instance ID is required for create', {
      operation: 'create',
      templateId,
    });
  }

  const parsedOverrides = parseOverrides(overrides);

  const instance = await templateManager.createInstance(templateId, {
    id: instanceId,
    name: name || instanceId,
    overrides: parsedOverrides,
  });

  write(`Created instance '${instance.id}' from template '${templateId}'\n`);
  write(`  Name:   ${instance.name}\n`);
  write(`  Status: ${instance.status}\n`);

  return { success: true, instance };
}

/**
 * List instances, optionally filtered by template
 *
 * @param {Object} options - Command options
 * @param {string} [options.templateId] - Filter by template ID
 * @param {string} [options.status] - Filter by instance status
 * @param {Object} options.templateManager - TemplateManager instance
 * @param {Function} options.write - Output writer function
 * @returns {Promise<Object>} Result with success flag and instances array
 * @private
 */
async function instanceList({ templateId, status, templateManager, write }) {
  const filter = {};
  if (templateId) {
    filter.templateId = templateId;
  }
  if (status) {
    filter.status = status;
  }

  const instances = await templateManager.listInstances(filter);

  if (instances.length === 0) {
    write('No instances found\n');
    return { success: true, instances: [] };
  }

  write(`Instances (${instances.length}):\n`);
  for (const inst of instances) {
    write(
      `  ${inst.id}  template=${inst.templateId}  status=${inst.status}  name=${inst.name || '-'}\n`
    );
  }

  return { success: true, instances };
}

/**
 * Scale a template by creating multiple instances
 *
 * Creates `count` instances with auto-generated IDs:
 *   `{templateId}-{1..count}`
 *
 * @param {Object} options - Command options
 * @param {string} options.templateId - Template to scale
 * @param {number} options.count - Number of instances to create
 * @param {Array<string>} [options.overrides=[]] - Key=value override pairs
 * @param {Object} options.templateManager - TemplateManager instance
 * @param {Function} options.write - Output writer function
 * @returns {Promise<Object>} Result with success flag and created/failed arrays
 * @private
 */
async function instanceScale({ templateId, count, overrides = [], templateManager, write }) {
  if (!templateId) {
    throw new InstanceCommandError('Template ID is required for scale', {
      operation: 'scale',
    });
  }

  if (!count || count < 1) {
    throw new InstanceCommandError('Count must be a positive integer', {
      operation: 'scale',
      templateId,
    });
  }

  const parsedOverrides = parseOverrides(overrides);
  const created = [];
  const failed = [];

  write(`Scaling template '${templateId}' to ${count} instance(s)...\n`);

  for (let i = 1; i <= count; i++) {
    const instanceId = `${templateId}-${i}`;
    try {
      const instance = await templateManager.createInstance(templateId, {
        id: instanceId,
        name: `${templateId} #${i}`,
        overrides: parsedOverrides,
      });
      created.push(instance);
      write(`  Created: ${instance.id}\n`);
    } catch (err) {
      failed.push({ instanceId, error: err.message });
      write(`  Failed:  ${instanceId} - ${err.message}\n`);
    }
  }

  write(`Scale complete: ${created.length} created, ${failed.length} failed\n`);

  return { success: failed.length === 0, created, failed };
}

/**
 * Stop a running instance by updating its status
 *
 * @param {Object} options - Command options
 * @param {string} options.instanceId - Instance to stop
 * @param {Object} options.templateManager - TemplateManager instance
 * @param {Function} options.write - Output writer function
 * @returns {Promise<Object>} Result with success flag
 * @private
 */
async function instanceStop({ instanceId, templateManager, write }) {
  if (!instanceId) {
    throw new InstanceCommandError('Instance ID is required for stop', {
      operation: 'stop',
    });
  }

  const updated = await templateManager.updateInstanceStatus(instanceId, INSTANCE_STATUSES.STOPPED);

  if (!updated) {
    write(`Instance '${instanceId}' not found\n`);
    return { success: false };
  }

  write(`Stopped instance '${instanceId}'\n`);
  return { success: true };
}

/**
 * Remove (delete) an instance
 *
 * @param {Object} options - Command options
 * @param {string} options.instanceId - Instance to remove
 * @param {Object} options.templateManager - TemplateManager instance
 * @param {Function} options.write - Output writer function
 * @returns {Promise<Object>} Result with success flag
 * @private
 */
async function instanceRm({ instanceId, templateManager, write }) {
  if (!instanceId) {
    throw new InstanceCommandError('Instance ID is required for rm', {
      operation: 'rm',
    });
  }

  const deleted = await templateManager.deleteInstance(instanceId);

  if (!deleted) {
    write(`Instance '${instanceId}' not found\n`);
    return { success: false };
  }

  write(`Removed instance '${instanceId}'\n`);
  return { success: true };
}

// =============================================================================
// Main entry point
// =============================================================================

/**
 * Run an instance subcommand
 *
 * Dispatches to the appropriate handler based on the `command` argument.
 *
 * @param {string} command - Subcommand name ('create' | 'list' | 'scale' | 'stop' | 'rm')
 * @param {Object} [options={}] - Command options
 * @param {string} [options.templateId] - Template ID (for create, list, scale)
 * @param {string} [options.instanceId] - Instance ID (for create, stop, rm)
 * @param {string} [options.name] - Instance name (for create)
 * @param {number} [options.count] - Instance count (for scale)
 * @param {string} [options.status] - Status filter (for list)
 * @param {Array<string>} [options.overrides=[]] - Key=value override pairs
 * @param {Object} [options.output=process.stdout] - Writable stream for output
 * @param {Object} [options.storage] - Storage instance (for creating TemplateManager)
 * @param {Object} [options.templateManager] - Pre-configured TemplateManager (for DI/testing)
 * @returns {Promise<Object>} Result with success flag and command-specific data
 * @throws {InstanceCommandError} If command is invalid or required options are missing
 */
export async function runInstance(command, options = {}) {
  const { output = process.stdout, storage, templateManager: injectedManager } = options;
  const write = msg => output.write(msg);

  // Create or use injected TemplateManager
  const templateManager = injectedManager || new TemplateManager(storage);

  const handlerOptions = { ...options, templateManager, write };

  switch (command) {
    case 'create':
      return await instanceCreate(handlerOptions);
    case 'list':
      return await instanceList(handlerOptions);
    case 'scale':
      return await instanceScale(handlerOptions);
    case 'stop':
      return await instanceStop(handlerOptions);
    case 'rm':
      return await instanceRm(handlerOptions);
    default:
      throw new InstanceCommandError(
        `Unknown instance command: '${command}'. Valid commands: create, list, scale, stop, rm`,
        { operation: command }
      );
  }
}

export { parseOverrides };
export default runInstance;
