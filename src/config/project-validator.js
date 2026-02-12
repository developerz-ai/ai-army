/**
 * ProjectValidator - Zod schemas for validating YAML project configuration files
 *
 * Validates:
 * - Main config (ai-army.yml) - LLM settings, defaults, worker/server imports
 * - Server definitions (servers.yml) - SSH connection details, resources
 * - Worker configs (workers/*.yml) - container, expertise, deployment settings
 *
 * Uses Zod for runtime validation with descriptive error messages.
 * Follows the pattern established in ConfigValidator.js.
 *
 * @module config/project-validator
 */

import { z } from 'zod';

// =============================================================================
// Custom Error
// =============================================================================

/**
 * Custom error for project configuration validation failures
 */
export class ProjectValidationError extends Error {
  /**
   * Create a ProjectValidationError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {Array<Object>} [options.errors] - Array of validation errors
   * @param {string} [options.configPath] - Path to the config file
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'ProjectValidationError';
    this.errors = options.errors || [];
    this.configPath = options.configPath;
  }
}

// =============================================================================
// Shared Schemas
// =============================================================================

/**
 * Memory size format (e.g., '1g', '512m', '256k')
 */
const MemorySizeSchema = z
  .string()
  .regex(/^\d+[kmgKMG]?$/, 'Must be in format like 1g, 512m, 256k, or numeric bytes');

/**
 * LLM provider types supported by the framework
 */
const LLMProviderTypeSchema = z.enum([
  'anthropic',
  'openai',
  'openrouter',
  'ollama',
  'google',
  'custom',
]);

// =============================================================================
// Main Config Schema (ai-army.yml)
// =============================================================================

/**
 * Schema for LLM configuration within the main config
 */
const LLMConfigSchema = z.object({
  provider: LLMProviderTypeSchema,
  apiKey: z.string().min(1, 'LLM API key is required'),
  model: z.string().min(1, 'LLM model is required'),
  baseUrl: z.string().url().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
});

/**
 * Schema for default settings in the main config
 */
const DefaultsSchema = z
  .object({
    maxSteps: z.number().int().positive().optional(),
    temperature: z.number().min(0).max(2).optional(),
    memory: MemorySizeSchema.optional(),
    cpus: z.number().int().positive().optional(),
    image: z.string().optional(),
    network: z.string().optional(),
  })
  .passthrough();

/**
 * Schema for server import reference in main config
 */
const ServersImportSchema = z.union([
  z.string().min(1, 'Servers import path is required'),
  z.object({ import: z.string().min(1) }),
]);

/**
 * Schema for the main ai-army.yml configuration file
 */
export const MainProjectConfigSchema = z
  .object({
    version: z.union([z.string(), z.number()]).optional(),
    llm: LLMConfigSchema,
    defaults: DefaultsSchema.optional(),
    workers: z.array(z.string()).optional().default([]),
    servers: ServersImportSchema.optional(),
  })
  .passthrough();

// =============================================================================
// Server Config Schema (servers.yml)
// =============================================================================

/**
 * Schema for SSH authentication configuration
 */
const SSHAuthSchema = z
  .object({
    user: z.string().min(1, 'SSH user is required'),
    keyFile: z.string().optional(),
    password: z.string().optional(),
    port: z.number().int().positive().max(65535).optional().default(22),
  })
  .passthrough();

/**
 * Schema for server resource configuration
 */
const ServerResourcesSchema = z
  .object({
    memory: MemorySizeSchema.optional(),
    cpus: z.number().int().positive().optional(),
    disk: z.string().optional(),
    maxWorkers: z.number().int().positive().optional(),
  })
  .passthrough();

/**
 * Schema for a single server definition
 */
export const ServerConfigSchema = z
  .object({
    id: z.string().min(1, 'Server ID is required'),
    host: z.string().min(1, 'Server host is required'),
    ssh: SSHAuthSchema,
    resources: ServerResourcesSchema.optional(),
    labels: z.record(z.string()).optional(),
    enabled: z.boolean().optional().default(true),
  })
  .passthrough();

/**
 * Schema for the servers.yml file
 */
export const ServersFileSchema = z.object({
  servers: z.array(ServerConfigSchema).min(1, 'At least one server is required'),
});

// =============================================================================
// Worker Config Schema (workers/*.yml)
// =============================================================================

/**
 * Schema for worker container configuration
 */
const WorkerContainerSchema = z
  .object({
    image: z.string().min(1, 'Container image is required'),
    memory: MemorySizeSchema.optional(),
    cpus: z.number().int().positive().optional(),
    network: z.string().optional(),
    ports: z.array(z.string()).optional(),
    volumes: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
  })
  .passthrough();

/**
 * Schema for worker expertise configuration
 *
 * Either inline content or a file reference to an .md file
 */
const WorkerExpertiseSchema = z.union([
  z.string(), // inline content
  z.object({
    file: z.string().min(1, 'Expertise file path is required'),
  }),
]);

/**
 * Schema for worker deployment configuration
 */
const WorkerDeploymentSchema = z
  .object({
    server: z.string().optional(),
    replicas: z.number().int().positive().optional().default(1),
    strategy: z.enum(['round-robin', 'least-loaded', 'pinned']).optional(),
    healthCheck: z
      .object({
        interval: z.number().int().positive().optional(),
        timeout: z.number().int().positive().optional(),
        retries: z.number().int().positive().optional(),
      })
      .optional(),
  })
  .passthrough();

/**
 * Schema for worker repository configuration
 */
const WorkerRepoSchema = z
  .object({
    url: z.string().min(1, 'Repository URL is required'),
    branch: z.string().optional().default('main'),
    path: z.string().optional(),
  })
  .passthrough();

/**
 * Schema for a single worker configuration (workers/*.yml)
 */
export const WorkerConfigSchema = z
  .object({
    id: z.string().min(1, 'Worker ID is required'),
    name: z.string().optional(),
    description: z.string().optional(),
    enabled: z.boolean().optional().default(true),
    image: z.string().optional(), // Shorthand for container.image
    container: WorkerContainerSchema.optional(),
    expertise: WorkerExpertiseSchema.optional(),
    deployment: WorkerDeploymentSchema.optional(),
    repo: WorkerRepoSchema.optional(),
    tools: z.array(z.string()).optional(),
    maxSteps: z.number().int().positive().optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
  })
  .passthrough();

// =============================================================================
// Full Project Config Schema (resolved)
// =============================================================================

/**
 * Schema for the fully resolved project configuration
 */
export const ResolvedProjectConfigSchema = z.object({
  main: MainProjectConfigSchema,
  servers: z.array(ServerConfigSchema),
  workers: z.array(WorkerConfigSchema),
});

// =============================================================================
// ProjectValidator Class
// =============================================================================

/**
 * Project configuration validator using Zod schemas
 */
export class ProjectValidator {
  /**
   * Validate main project configuration (ai-army.yml)
   *
   * @param {Object} config - Configuration object to validate
   * @returns {Object} - { valid: boolean, errors: Array, data?: Object }
   */
  validateMainConfig(config) {
    return this._validate(MainProjectConfigSchema, config);
  }

  /**
   * Validate servers configuration (servers.yml)
   *
   * @param {Object} config - Servers configuration object to validate
   * @returns {Object} - { valid: boolean, errors: Array, data?: Object }
   */
  validateServersConfig(config) {
    return this._validate(ServersFileSchema, config);
  }

  /**
   * Validate a single worker configuration (workers/*.yml)
   *
   * @param {Object} config - Worker configuration object to validate
   * @returns {Object} - { valid: boolean, errors: Array, data?: Object }
   */
  validateWorkerConfig(config) {
    return this._validate(WorkerConfigSchema, config);
  }

  /**
   * Validate the fully resolved project configuration
   *
   * @param {Object} config - Resolved project configuration
   * @returns {Object} - { valid: boolean, errors: Array, data?: Object }
   */
  validateResolvedConfig(config) {
    return this._validate(ResolvedProjectConfigSchema, config);
  }

  /**
   * Validate all project configurations and cross-references
   *
   * @param {Object} projectConfig - { main, servers, workers }
   * @returns {Object} - { valid: boolean, errors: Array }
   */
  validateAll(projectConfig) {
    const allErrors = [];

    // Validate main config
    const mainResult = this.validateMainConfig(projectConfig.main);
    if (!mainResult.valid) {
      allErrors.push(
        ...mainResult.errors.map(e => ({
          ...e,
          context: 'ai-army.yml',
        }))
      );
    }

    // Validate servers
    if (projectConfig.servers) {
      for (const [i, server] of projectConfig.servers.entries()) {
        const serverResult = this._validate(ServerConfigSchema, server);
        if (!serverResult.valid) {
          allErrors.push(
            ...serverResult.errors.map(e => ({
              ...e,
              context: `servers[${i}] (${server.id || 'unknown'})`,
            }))
          );
        }
      }
    }

    // Validate workers
    for (const [i, worker] of projectConfig.workers.entries()) {
      const workerResult = this.validateWorkerConfig(worker);
      if (!workerResult.valid) {
        allErrors.push(
          ...workerResult.errors.map(e => ({
            ...e,
            context: `workers[${i}] (${worker.id || 'unknown'})`,
          }))
        );
      }
    }

    // Cross-reference validation
    const crossRefErrors = this._validateCrossReferences(projectConfig);
    allErrors.push(...crossRefErrors);

    return {
      valid: allErrors.length === 0,
      errors: allErrors,
    };
  }

  /**
   * Generate a human-readable error report
   *
   * @param {Array<Object>} errors - Array of error objects
   * @returns {string} - Formatted error report
   */
  generateReport(errors) {
    if (!errors || errors.length === 0) {
      return '✅ All project configurations valid';
    }

    const lines = ['❌ Project configuration errors found:', ''];

    // Group errors by context
    const grouped = {};
    for (const error of errors) {
      const context = error.context || 'general';
      if (!grouped[context]) {
        grouped[context] = [];
      }
      grouped[context].push(error);
    }

    for (const [context, contextErrors] of Object.entries(grouped)) {
      lines.push(`  ${context}:`);
      for (const error of contextErrors) {
        const path = error.path || '(root)';
        lines.push(`    - ${path}: ${error.message}`);
      }
      lines.push('');
    }

    return lines.join('\n').trim();
  }

  /**
   * Validate a value against a Zod schema
   *
   * @private
   * @param {z.ZodSchema} schema - Zod schema to validate against
   * @param {*} value - Value to validate
   * @returns {Object} - { valid: boolean, errors: Array, data?: Object }
   */
  _validate(schema, value) {
    const result = schema.safeParse(value);

    if (result.success) {
      return {
        valid: true,
        errors: [],
        data: result.data,
      };
    }

    return {
      valid: false,
      errors: this._formatZodErrors(result.error),
      data: null,
    };
  }

  /**
   * Format Zod validation errors into a consistent structure
   *
   * @private
   * @param {z.ZodError} zodError - Zod error object
   * @returns {Array<Object>} - Array of formatted error objects
   */
  _formatZodErrors(zodError) {
    return zodError.issues.map(issue => ({
      path: issue.path.join('.') || '(root)',
      message: issue.message,
      code: issue.code,
      expected: issue.expected,
      received: issue.received,
    }));
  }

  /**
   * Validate cross-references between configs
   *
   * @private
   * @param {Object} projectConfig - { main, servers, workers }
   * @returns {Array<Object>} - Array of cross-reference errors
   */
  _validateCrossReferences(projectConfig) {
    const errors = [];
    const serverIds = new Set((projectConfig.servers || []).map(s => s.id).filter(Boolean));

    // Check worker server references
    for (const worker of projectConfig.workers) {
      const deployServer = worker.deployment?.server;
      if (deployServer && serverIds.size > 0 && !serverIds.has(deployServer)) {
        errors.push({
          path: 'deployment.server',
          message: `Server '${deployServer}' not found in servers configuration`,
          code: 'invalid_reference',
          context: `worker '${worker.id}'`,
        });
      }
    }

    // Check for duplicate worker IDs
    const workerIds = new Set();
    for (const worker of projectConfig.workers) {
      if (worker.id && workerIds.has(worker.id)) {
        errors.push({
          path: 'id',
          message: `Duplicate worker ID '${worker.id}'`,
          code: 'duplicate_id',
          context: `worker '${worker.id}'`,
        });
      }
      if (worker.id) {
        workerIds.add(worker.id);
      }
    }

    // Check for duplicate server IDs
    const seenServerIds = new Set();
    for (const server of projectConfig.servers || []) {
      if (server.id && seenServerIds.has(server.id)) {
        errors.push({
          path: 'id',
          message: `Duplicate server ID '${server.id}'`,
          code: 'duplicate_id',
          context: `server '${server.id}'`,
        });
      }
      if (server.id) {
        seenServerIds.add(server.id);
      }
    }

    return errors;
  }
}

// =============================================================================
// Export schemas for external use
// =============================================================================

export {
  LLMProviderTypeSchema,
  LLMConfigSchema,
  DefaultsSchema,
  SSHAuthSchema,
  ServerResourcesSchema,
  WorkerContainerSchema,
  WorkerExpertiseSchema,
  WorkerDeploymentSchema,
  WorkerRepoSchema,
  MemorySizeSchema,
};

export default ProjectValidator;
