/**
 * ConfigValidator - Validates configuration files using Zod schemas
 *
 * Validates:
 * - Main config (config.json) - providers, channels, defaults, MCP servers
 * - Bot config (bots/{name}/config.json) - id, soul, provider, model, tools
 *
 * Uses Zod for TypeScript-first validation with excellent error messages.
 *
 * @module ConfigValidator
 */

import { z } from 'zod';

/**
 * Custom error for configuration validation failures
 */
export class ConfigValidationError extends Error {
  /**
   * Create a ConfigValidationError
   * @param {string} message - Error message
   * @param {Object} [options] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {Array<Object>} [options.errors] - Array of validation errors
   * @param {string} [options.configPath] - Path to the config file
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'ConfigValidationError';
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
 * Provider types supported by the framework
 */
const ProviderTypeSchema = z.enum([
  'anthropic',
  'openai',
  'openrouter',
  'ollama',
  'google',
  'custom',
]);

/**
 * Channel types supported by the framework
 */
const ChannelTypeSchema = z.enum(['slack', 'discord', 'rest']);

/**
 * Tool names that are built into the framework
 */
const BuiltinToolSchema = z.enum(['bash', 'readFile', 'writeFile', 'glob', 'grep', 'webSearch']);

// =============================================================================
// Provider Configuration Schemas
// =============================================================================

/**
 * Schema for Anthropic provider configuration
 */
const AnthropicProviderSchema = z.object({
  type: z.literal('anthropic'),
  apiKey: z.string().optional(),
  baseUrl: z.string().url().optional(),
  baseURL: z.string().url().optional(),
});

/**
 * Schema for OpenAI provider configuration
 */
const OpenAIProviderSchema = z.object({
  type: z.literal('openai'),
  apiKey: z.string().optional(),
  baseUrl: z.string().url().optional(),
  baseURL: z.string().url().optional(),
  organization: z.string().optional(),
});

/**
 * Schema for OpenRouter provider configuration
 */
const OpenRouterProviderSchema = z.object({
  type: z.literal('openrouter'),
  apiKey: z.string().optional(),
  baseUrl: z.string().url().optional(),
  baseURL: z.string().url().optional(),
  siteUrl: z.string().url().optional(),
  siteName: z.string().optional(),
});

/**
 * Schema for Ollama provider configuration
 */
const OllamaProviderSchema = z.object({
  type: z.literal('ollama'),
  baseUrl: z.string().url().optional(),
  baseURL: z.string().url().optional(),
  apiKey: z.string().optional(),
});

/**
 * Schema for Google provider configuration
 */
const GoogleProviderSchema = z.object({
  type: z.literal('google'),
  apiKey: z.string().optional(),
  baseUrl: z.string().url().optional(),
  baseURL: z.string().url().optional(),
});

/**
 * Schema for custom provider configuration
 */
const CustomProviderSchema = z
  .object({
    type: z.literal('custom'),
    apiKey: z.string().optional(),
    baseUrl: z.string().url().optional(),
    baseURL: z.string().url().optional(),
  })
  .passthrough(); // Custom providers may have arbitrary fields

/**
 * Schema for provider configuration
 * Validates base fields and allows provider-specific fields via passthrough.
 */
const ProviderConfigSchema = z
  .object({
    type: ProviderTypeSchema,
    apiKey: z.string().optional(),
    baseUrl: z.string().url().optional(),
    baseURL: z.string().url().optional(), // Alternative naming
  })
  .passthrough(); // Allow additional provider-specific fields

/**
 * Provider-specific schemas indexed by provider type
 * Used for stricter validation when the type is known.
 * @type {Readonly<Object>}
 */
const ProviderSpecificSchemas = Object.freeze({
  anthropic: AnthropicProviderSchema,
  openai: OpenAIProviderSchema,
  openrouter: OpenRouterProviderSchema,
  ollama: OllamaProviderSchema,
  google: GoogleProviderSchema,
  custom: CustomProviderSchema,
});

// =============================================================================
// Channel Configuration Schemas
// =============================================================================

/**
 * Schema for per-channel restrictions
 *
 * Allows fine-grained access control at the channel level, including
 * allowed/blocked channel IDs, user restrictions, DM policy, and
 * domain verification.
 */
const ChannelRestrictionsSchema = z.object({
  allowedChannels: z.array(z.string()).optional(),
  deniedChannels: z.array(z.string()).optional(),
  allowedUsers: z.array(z.string()).optional(),
  deniedUsers: z.array(z.string()).optional(),
  allowDMs: z.boolean().optional().default(true),
  allowedDomains: z.array(z.string()).optional(),
});

/**
 * Schema for Slack channel configuration
 */
const SlackChannelSchema = z.object({
  type: z.literal('slack'),
  botToken: z.string().min(1, 'Slack bot token is required'),
  appToken: z.string().optional(),
  signingSecret: z.string().optional(),
  restrictions: ChannelRestrictionsSchema.optional(),
});

/**
 * Schema for Discord channel configuration
 */
const DiscordChannelSchema = z.object({
  type: z.literal('discord'),
  botToken: z.string().min(1, 'Discord bot token is required'),
  guildIds: z.array(z.string()).optional(),
  restrictions: ChannelRestrictionsSchema.optional(),
});

/**
 * Schema for REST API channel configuration
 */
const RestChannelSchema = z.object({
  type: z.literal('rest'),
  port: z.number().int().positive().optional(),
  host: z.string().optional(),
  authToken: z.string().optional(),
  restrictions: ChannelRestrictionsSchema.optional(),
});

/**
 * Combined channel configuration schema
 */
const ChannelConfigSchema = z.discriminatedUnion('type', [
  SlackChannelSchema,
  DiscordChannelSchema,
  RestChannelSchema,
]);

/**
 * Schema for a bot-level channel entry in the `channels[]` array
 *
 * Allows bots to define multiple channel connections with per-channel
 * names, types, and restrictions. The `name` field uniquely identifies
 * each channel entry within the bot's config.
 */
const BotChannelConfigSchema = z
  .object({
    name: z.string().min(1, 'Channel name is required'),
    type: ChannelTypeSchema,
    restrictions: ChannelRestrictionsSchema.optional(),
  })
  .passthrough();

// =============================================================================
// MCP Server Configuration Schema
// =============================================================================

/**
 * Schema for MCP server configuration
 */
const McpServerConfigSchema = z.object({
  command: z.string().min(1, 'MCP command is required'),
  args: z.array(z.string()).optional().default([]),
  env: z.record(z.string()).optional(),
});

// =============================================================================
// Sandbox Configuration Schema
// =============================================================================

/**
 * Schema for Docker sandbox configuration
 */
const SandboxConfigSchema = z.object({
  type: z.enum(['docker', 'just-bash']).default('docker'),
  image: z.string().default('node:22-slim'),
  packages: z.array(z.string()).optional(),
  memory: MemorySizeSchema.optional().default('2g'),
  maxMemory: MemorySizeSchema.optional(),
  cpus: z.number().int().positive().optional().default(2),
  maxCpu: z.number().int().positive().optional(),
  network: z
    .union([
      z.string(),
      z.object({
        allowedDomains: z.array(z.string()).optional(),
      }),
    ])
    .optional()
    .default('bridge'),
});

// =============================================================================
// Restrictions Configuration Schema
// =============================================================================

/**
 * Schema for user/channel restrictions
 */
const RestrictionsConfigSchema = z.object({
  allowedUsers: z.array(z.string()).optional(),
  deniedUsers: z.array(z.string()).optional(),
  allowedChannels: z.array(z.string()).optional(),
  deniedChannels: z.array(z.string()).optional(),
  dmAllowed: z.boolean().optional().default(true),
});

// =============================================================================
// Defaults Configuration Schema
// =============================================================================

/**
 * Schema for default model configuration
 */
const DefaultModelConfigSchema = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
  fallbacks: z.array(z.string()).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
});

/**
 * Schema for default configuration section
 */
const DefaultsConfigSchema = z
  .object({
    model: DefaultModelConfigSchema.optional(),
    sandbox: SandboxConfigSchema.optional(),
    tools: z.array(z.string()).optional(),
    maxSteps: z.number().int().positive().optional().default(30),
    compaction: z
      .object({
        enabled: z.boolean().optional().default(true),
        threshold: z.number().int().positive().optional().default(50000),
        flushBeforeCompact: z.boolean().optional().default(true),
      })
      .optional(),
  })
  .passthrough();

// =============================================================================
// Secrets Configuration Schema
// =============================================================================

/**
 * Schema for a single secret adapter configuration
 */
const SecretAdapterConfigSchema = z
  .object({
    type: z.enum(['bitwarden', '1password', 'env']),
  })
  .passthrough(); // Allow adapter-specific fields (sessionToken, account, token, etc.)

/**
 * Schema for secret cache configuration
 */
const SecretCacheConfigSchema = z.object({
  enabled: z.boolean().optional().default(true),
  ttl: z.number().int().positive().optional().default(300000),
});

/**
 * Schema for secrets provider configuration
 *
 * Supports two levels:
 * - Simple: just `provider` and optional `config` (backward-compatible)
 * - Extended: `default` adapter, `adapters` map, and `cache` settings
 */
const SecretsConfigSchema = z.object({
  provider: z.enum(['bitwarden', '1password', 'env']).optional().default('env'),
  config: z.record(z.string()).optional(),
  default: z.enum(['bitwarden', '1password', 'env']).optional(),
  adapters: z.record(SecretAdapterConfigSchema).optional(),
  cache: SecretCacheConfigSchema.optional(),
});

// =============================================================================
// Audit Configuration Schema
// =============================================================================

/**
 * Schema for audit event category toggles
 *
 * Controls which categories of events are recorded in the audit trail.
 * Each category can be individually enabled or disabled.
 */
const AuditEventsConfigSchema = z.object({
  bot: z.boolean().optional().default(true),
  message: z.boolean().optional().default(true),
  tool: z.boolean().optional().default(true),
  admin: z.boolean().optional().default(true),
  security: z.boolean().optional().default(true),
});

/**
 * Schema for audit retention policy configuration
 *
 * Controls automatic cleanup of old audit log entries. When enabled,
 * entries older than the specified number of days are periodically deleted.
 */
const AuditRetentionConfigSchema = z.object({
  enabled: z.boolean().optional().default(true),
  days: z.number().int().positive().optional().default(90),
});

/**
 * Schema for audit logging configuration
 *
 * Controls whether audit logging is enabled, which event categories
 * are tracked, and the retention policy for old entries.
 *
 * @example
 * {
 *   "audit": {
 *     "enabled": true,
 *     "retention": { "enabled": true, "days": 90 },
 *     "events": { "bot": true, "message": true, "tool": true, "admin": true, "security": true }
 *   }
 * }
 */
const AuditConfigSchema = z.object({
  enabled: z.boolean().optional().default(true),
  retention: AuditRetentionConfigSchema.optional(),
  events: AuditEventsConfigSchema.optional(),
});

// =============================================================================
// Queue Configuration Schema
// =============================================================================

/**
 * Schema for message queue configuration
 */
const QueueConfigSchema = z.object({
  enabled: z.boolean().optional().default(false),
  maxConcurrentPerBot: z.number().int().positive().optional().default(3),
  defaultPriority: z.number().int().min(0).optional().default(0),
  retryAttempts: z.number().int().min(0).optional().default(3),
  retryDelay: z.number().int().positive().optional().default(5000),
  pollInterval: z.number().int().positive().optional().default(5000),
});

// =============================================================================
// API Configuration Schema
// =============================================================================

/**
 * Schema for API authentication token configuration
 *
 * Each token entry maps a token string to a role. When `tokens` is
 * provided as an array of strings, each is treated as an admin token.
 */
const APIAuthConfigSchema = z.object({
  enabled: z.boolean().optional().default(true),
  tokens: z
    .union([
      z.array(z.string().min(1)),
      z.array(
        z.object({
          token: z.string().min(1),
          role: z.string().optional().default('admin'),
          name: z.string().optional(),
          bots: z.array(z.string()).nullable().optional(),
        })
      ),
    ])
    .optional()
    .default([]),
  defaultRole: z.string().optional().default('viewer'),
});

/**
 * Schema for API rate limiting configuration
 */
const APIRateLimitConfigSchema = z.object({
  enabled: z.boolean().optional().default(true),
  max: z.number().int().positive().optional().default(100),
  windowMs: z.number().int().positive().optional().default(60000),
  bypassIps: z.array(z.string()).optional().default([]),
});

/**
 * Schema for API CORS configuration
 */
const APICorsConfigSchema = z.object({
  enabled: z.boolean().optional().default(true),
  origins: z.array(z.string()).optional().default(['*']),
  methods: z.array(z.string()).optional(),
  headers: z.array(z.string()).optional(),
});

/**
 * Schema for API server configuration
 *
 * Controls the REST API server lifecycle, authentication,
 * rate limiting, and CORS settings.
 *
 * @example
 * {
 *   "api": {
 *     "enabled": true,
 *     "port": 3000,
 *     "host": "0.0.0.0",
 *     "auth": { "enabled": true, "tokens": ["${API_TOKEN}"] },
 *     "rateLimit": { "enabled": true, "max": 100, "windowMs": 60000 },
 *     "cors": { "enabled": true, "origins": ["*"] }
 *   }
 * }
 */
const APIConfigSchema = z.object({
  enabled: z.boolean().optional().default(false),
  port: z.number().int().positive().max(65535).optional().default(3000),
  host: z.string().optional().default('0.0.0.0'),
  auth: APIAuthConfigSchema.optional(),
  rateLimit: APIRateLimitConfigSchema.optional(),
  cors: APICorsConfigSchema.optional(),
});

// =============================================================================
// Webhook Configuration Schema
// =============================================================================

/**
 * Schema for a single webhook subscription in a bot config
 */
const WebhookSubscriptionSchema = z.object({
  url: z.string().url('Webhook URL must be a valid URL'),
  events: z.array(z.string().min(1)).min(1, 'At least one event is required'),
  method: z.enum(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']).optional().default('POST'),
  headers: z.record(z.string()).optional().default({}),
  retries: z.number().int().min(1).max(10).optional().default(3),
  timeout: z.number().int().positive().optional().default(5000),
});

/**
 * Schema for the webhooks array in a bot config
 *
 * Each bot may define an array of webhook subscriptions. Each subscription
 * specifies a destination URL, events to listen for, and optional delivery
 * settings like retry count and timeout.
 */
const WebhookConfigSchema = z.array(WebhookSubscriptionSchema).optional().default([]);

// =============================================================================
// Template & Instance Configuration Schemas
// =============================================================================

/**
 * Schema for template configuration
 *
 * Templates define reusable bot configurations with optional `{{variable}}`
 * placeholders in both config and soul content. Instances are created from
 * templates with per-instance overrides.
 */
const TemplateConfigSchema = z.object({
  id: z.string().min(1, 'Template ID is required'),
  name: z.string().min(1, 'Template name is required'),
  description: z.string().optional(),
  config: z.object({}).passthrough(),
  soulTemplate: z.string().optional(),
});

/**
 * Schema for instance configuration
 *
 * Instances reference a template and provide per-instance overrides and
 * variables. The orchestrator deep-merges template config + instance overrides
 * and applies `{{variable}}` substitution at startup.
 */
const InstanceConfigSchema = z.object({
  id: z.string().min(1, 'Instance ID is required'),
  templateId: z.string().min(1, 'Template ID is required'),
  name: z.string().optional(),
  overrides: z.object({}).passthrough().optional().default({}),
  variables: z.record(z.string()).optional(),
  status: z.enum(['starting', 'running', 'stopped', 'error']).optional().default('stopped'),
});

// =============================================================================
// Main Configuration Schema
// =============================================================================

/**
 * Schema for the main config.json file
 */
export const MainConfigSchema = z
  .object({
    $schema: z.string().optional(),

    defaults: DefaultsConfigSchema.optional(),

    providers: z.record(ProviderConfigSchema).optional().default({}),

    channels: z.record(ChannelConfigSchema).optional().default({}),

    mcpServers: z.record(McpServerConfigSchema).optional().default({}),

    secrets: SecretsConfigSchema.optional(),

    queue: QueueConfigSchema.optional(),

    audit: AuditConfigSchema.optional(),

    api: APIConfigSchema.optional(),

    // Inline bot definitions (alternative to separate files)
    bots: z.record(z.any()).optional(),
  })
  .passthrough(); // Allow additional fields for extensibility

// =============================================================================
// Bot Configuration Schema
// =============================================================================

/**
 * Schema for bot workspace configuration
 */
const WorkspaceConfigSchema = z.object({
  root: z.string().min(1, 'Workspace root is required'),
  mounts: z
    .record(
      z.object({
        path: z.string(),
        readOnly: z.boolean().optional().default(false),
      })
    )
    .optional(),
});

/**
 * Schema for bot memory configuration
 */
const MemoryConfigSchema = z.object({
  dir: z.string().optional().default('memory'),
  compaction: z
    .object({
      enabled: z.boolean().optional().default(true),
      threshold: z.number().int().positive().optional().default(50000),
      flushBeforeCompact: z.boolean().optional().default(true),
    })
    .optional(),
});

/**
 * Schema for individual bot config.json files
 */
export const BotConfigSchema = z
  .object({
    $schema: z.string().optional(),

    // Required fields
    id: z.string().min(1, 'Bot ID is required'),
    soul: z.string().min(1, 'Soul file path is required'),
    provider: z.string().min(1, 'Provider name is required'),
    model: z.string().min(1, 'Model name is required'),

    // Optional identification
    enabled: z.boolean().optional().default(true),
    name: z.string().optional(),
    description: z.string().optional(),

    // Model configuration
    fallbacks: z.array(z.string()).optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().positive().optional(),

    // Channel assignment (single channel - backward compatible)
    channel: z.string().optional(),
    // Multi-channel support: array of channel configs per bot
    channels: z.array(BotChannelConfigSchema).optional(),
    sessionPer: z.enum(['user', 'channel', 'thread']).optional().default('user'),

    // Workspace
    workspace: WorkspaceConfigSchema.optional(),

    // Sandbox
    sandbox: SandboxConfigSchema.optional(),

    // Tools
    tools: z.array(z.string()).optional().default([]),
    maxSteps: z.number().int().positive().optional().default(30),

    // MCP servers
    mcpServers: z.array(z.string()).optional().default([]),

    // Skills
    skills: z.array(z.string()).optional().default([]),

    // Memory
    memory: MemoryConfigSchema.optional(),

    // Restrictions
    restrictions: RestrictionsConfigSchema.optional(),

    // Webhooks
    webhooks: WebhookConfigSchema,

    // Session compaction
    compactionThreshold: z.number().int().positive().optional().default(50000),
  })
  .passthrough();

// =============================================================================
// ConfigValidator Class
// =============================================================================

/**
 * Configuration validator using Zod schemas
 */
export class ConfigValidator {
  /**
   * Validate main configuration (config.json)
   *
   * @param {Object} config - Configuration object to validate
   * @returns {Object} - { valid: boolean, errors: Array, data?: Object }
   */
  validateMainConfig(config) {
    const result = MainConfigSchema.safeParse(config);

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
   * Validate bot configuration (bots/{name}/config.json)
   *
   * @param {Object} botConfig - Bot configuration object to validate
   * @returns {Object} - Validated and transformed config with defaults applied
   * @throws {ConfigValidationError} - If validation fails
   */
  validateBotConfig(botConfig) {
    const result = BotConfigSchema.safeParse(botConfig);

    if (result.success) {
      return result.data;
    }

    const errors = this._formatZodErrors(result.error);
    const errorMessages = errors.map(e => `${e.path}: ${e.message}`);

    throw new ConfigValidationError(`Bot configuration invalid:\n  ${errorMessages.join('\n  ')}`, {
      errors,
    });
  }

  /**
   * Validate a single provider configuration with provider-specific rules
   *
   * Uses the provider-specific schema if the type is known, otherwise falls
   * back to the general ProviderConfigSchema.
   *
   * @param {Object} providerConfig - Provider configuration object
   * @returns {Object} - { valid: boolean, errors: Array, data?: Object }
   *
   * @example
   * const result = validator.validateProviderConfig({
   *   type: 'anthropic',
   *   apiKey: '${ANTHROPIC_API_KEY}',
   * });
   */
  validateProviderConfig(providerConfig) {
    if (!providerConfig || typeof providerConfig !== 'object') {
      return {
        valid: false,
        errors: [
          {
            path: '(root)',
            message: 'Provider configuration must be an object',
            code: 'invalid_type',
          },
        ],
        data: null,
      };
    }

    // Try provider-specific schema first
    const { type } = providerConfig;
    const specificSchema = type ? ProviderSpecificSchemas[type] : null;
    const schema = specificSchema || ProviderConfigSchema;

    const result = schema.safeParse(providerConfig);

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
   * Check required fields are present in a configuration object
   *
   * @param {Object} config - Configuration object
   * @param {Array<string>} fields - Array of required field names
   * @returns {Array<Object>} - Array of error objects for missing fields
   */
  checkRequiredFields(config, fields) {
    const errors = [];

    for (const field of fields) {
      const value = this._getNestedValue(config, field);
      if (value === undefined || value === null || value === '') {
        errors.push({
          path: field,
          message: `Required field '${field}' is missing`,
          code: 'missing_required_field',
        });
      }
    }

    return errors;
  }

  /**
   * Validate all configurations - main config and all bots
   *
   * @param {Object} mainConfig - Main configuration object
   * @param {Object<string, Object>} botConfigs - Map of bot ID to bot config
   * @returns {Object} - { valid: boolean, errors: Array }
   */
  validateAll(mainConfig, botConfigs = {}) {
    const allErrors = [];

    // Validate main config
    const mainResult = this.validateMainConfig(mainConfig);
    if (!mainResult.valid) {
      allErrors.push(
        ...mainResult.errors.map(e => ({
          ...e,
          context: 'config.json',
        }))
      );
    }

    // Validate each bot config
    for (const [botId, botConfig] of Object.entries(botConfigs)) {
      try {
        this.validateBotConfig(botConfig);
      } catch (err) {
        if (err instanceof ConfigValidationError) {
          allErrors.push(
            ...err.errors.map(e => ({
              ...e,
              context: `bots/${botId}/config.json`,
            }))
          );
        } else {
          allErrors.push({
            path: botId,
            message: err.message,
            code: 'validation_error',
            context: `bots/${botId}/config.json`,
          });
        }
      }
    }

    // Cross-reference validation
    const crossRefErrors = this._validateCrossReferences(mainResult.data || mainConfig, botConfigs);
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
      return '✅ All configurations valid';
    }

    const lines = ['❌ Configuration errors found:', ''];

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
   * Get a nested value from an object using dot notation
   *
   * @private
   * @param {Object} obj - Object to search
   * @param {string} path - Dot-notation path (e.g., 'a.b.c')
   * @returns {*} - Value at path or undefined
   */
  _getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => {
      return current && current[key] !== undefined ? current[key] : undefined;
    }, obj);
  }

  /**
   * Validate that bot skill references exist in a SkillRegistry
   *
   * Checks each bot's `skills` array and verifies every referenced
   * skill name is present in the provided registry. Returns an array
   * of error objects for any missing skills.
   *
   * @param {Object<string, Object>} botConfigs - Map of bot ID to bot config
   * @param {Object} skillRegistry - SkillRegistry instance with a `hasSkill(name)` method
   * @returns {Array<Object>} - Array of validation error objects
   */
  validateBotSkills(botConfigs, skillRegistry) {
    const errors = [];

    if (!skillRegistry || typeof skillRegistry.hasSkill !== 'function') {
      return errors;
    }

    for (const [botId, botConfig] of Object.entries(botConfigs)) {
      const skills = botConfig.skills || [];
      for (const skillName of skills) {
        if (!skillRegistry.hasSkill(skillName)) {
          errors.push({
            path: 'skills',
            message: `Skill '${skillName}' not found in skill registry`,
            code: 'invalid_reference',
            context: `bots/${botId}/config.json`,
          });
        }
      }
    }

    return errors;
  }

  /**
   * Validate a template configuration
   *
   * @param {Object} templateConfig - Template configuration object
   * @returns {Object} - { valid: boolean, errors: Array, data?: Object }
   */
  validateTemplateConfig(templateConfig) {
    if (!templateConfig || typeof templateConfig !== 'object') {
      return {
        valid: false,
        errors: [
          {
            path: '(root)',
            message: 'Template configuration must be an object',
            code: 'invalid_type',
          },
        ],
        data: null,
      };
    }

    const result = TemplateConfigSchema.safeParse(templateConfig);

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
   * Validate an instance configuration
   *
   * @param {Object} instanceConfig - Instance configuration object
   * @returns {Object} - { valid: boolean, errors: Array, data?: Object }
   */
  validateInstanceConfig(instanceConfig) {
    if (!instanceConfig || typeof instanceConfig !== 'object') {
      return {
        valid: false,
        errors: [
          {
            path: '(root)',
            message: 'Instance configuration must be an object',
            code: 'invalid_type',
          },
        ],
        data: null,
      };
    }

    const result = InstanceConfigSchema.safeParse(instanceConfig);

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
   * Validate an audit configuration
   *
   * @param {Object} auditConfig - Audit configuration object
   * @returns {Object} - { valid: boolean, errors: Array, data?: Object }
   */
  validateAuditConfig(auditConfig) {
    if (!auditConfig || typeof auditConfig !== 'object') {
      return {
        valid: false,
        errors: [
          {
            path: '(root)',
            message: 'Audit configuration must be an object',
            code: 'invalid_type',
          },
        ],
        data: null,
      };
    }

    const result = AuditConfigSchema.safeParse(auditConfig);

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
   * Validate a webhook configuration array
   *
   * @param {Array<Object>} webhookConfigs - Array of webhook subscription objects
   * @returns {Object} - { valid: boolean, errors: Array, data?: Array }
   */
  validateWebhookConfig(webhookConfigs) {
    if (!Array.isArray(webhookConfigs)) {
      return {
        valid: false,
        errors: [
          {
            path: '(root)',
            message: 'Webhook configuration must be an array',
            code: 'invalid_type',
          },
        ],
        data: null,
      };
    }

    const result = WebhookConfigSchema.safeParse(webhookConfigs);

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
   * Validate an API server configuration
   *
   * @param {Object} apiConfig - API configuration object
   * @returns {Object} - { valid: boolean, errors: Array, data?: Object }
   */
  validateAPIConfig(apiConfig) {
    if (!apiConfig || typeof apiConfig !== 'object') {
      return {
        valid: false,
        errors: [
          {
            path: '(root)',
            message: 'API configuration must be an object',
            code: 'invalid_type',
          },
        ],
        data: null,
      };
    }

    const result = APIConfigSchema.safeParse(apiConfig);

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
   * Validate cross-references between main config and bot configs
   *
   * @private
   * @param {Object} mainConfig - Main configuration
   * @param {Object<string, Object>} botConfigs - Map of bot configs
   * @returns {Array<Object>} - Array of cross-reference errors
   */
  _validateCrossReferences(mainConfig, botConfigs) {
    const errors = [];
    const providers = Object.keys(mainConfig.providers || {});
    const channels = Object.keys(mainConfig.channels || {});
    const mcpServers = Object.keys(mainConfig.mcpServers || {});

    for (const [botId, botConfig] of Object.entries(botConfigs)) {
      // Check provider reference
      if (botConfig.provider && !providers.includes(botConfig.provider)) {
        // Only warn if there are providers defined - provider could be a type
        if (providers.length > 0 && !ProviderTypeSchema.safeParse(botConfig.provider).success) {
          errors.push({
            path: 'provider',
            message: `Provider '${botConfig.provider}' not found in main config providers`,
            code: 'invalid_reference',
            context: `bots/${botId}/config.json`,
          });
        }
      }

      // Check single channel reference (backward-compatible)
      if (botConfig.channel && channels.length > 0 && !channels.includes(botConfig.channel)) {
        errors.push({
          path: 'channel',
          message: `Channel '${botConfig.channel}' not found in main config channels`,
          code: 'invalid_reference',
          context: `bots/${botId}/config.json`,
        });
      }

      // Check multi-channel references (channels[] array)
      if (Array.isArray(botConfig.channels)) {
        const seenNames = new Set();
        for (const channelEntry of botConfig.channels) {
          const channelName = channelEntry.name;
          if (channelName && seenNames.has(channelName)) {
            errors.push({
              path: 'channels',
              message: `Duplicate channel name '${channelName}' in bot channels array`,
              code: 'duplicate_channel_name',
              context: `bots/${botId}/config.json`,
            });
          }
          if (channelName) {
            seenNames.add(channelName);
          }
        }
      }

      // Check MCP server references
      if (botConfig.mcpServers && mcpServers.length > 0) {
        for (const mcpServer of botConfig.mcpServers) {
          if (!mcpServers.includes(mcpServer)) {
            errors.push({
              path: 'mcpServers',
              message: `MCP server '${mcpServer}' not found in main config mcpServers`,
              code: 'invalid_reference',
              context: `bots/${botId}/config.json`,
            });
          }
        }
      }
    }

    return errors;
  }
}

// Export schemas for external use
export {
  ProviderTypeSchema,
  ChannelTypeSchema,
  BuiltinToolSchema,
  ProviderConfigSchema,
  ProviderSpecificSchemas,
  AnthropicProviderSchema,
  OpenAIProviderSchema,
  OpenRouterProviderSchema,
  OllamaProviderSchema,
  GoogleProviderSchema,
  CustomProviderSchema,
  ChannelConfigSchema,
  ChannelRestrictionsSchema,
  BotChannelConfigSchema,
  McpServerConfigSchema,
  SandboxConfigSchema,
  RestrictionsConfigSchema,
  DefaultsConfigSchema,
  SecretsConfigSchema,
  SecretAdapterConfigSchema,
  SecretCacheConfigSchema,
  QueueConfigSchema,
  AuditConfigSchema,
  AuditEventsConfigSchema,
  AuditRetentionConfigSchema,
  APIConfigSchema,
  APIAuthConfigSchema,
  APIRateLimitConfigSchema,
  APICorsConfigSchema,
  WorkspaceConfigSchema,
  MemoryConfigSchema,
  TemplateConfigSchema,
  InstanceConfigSchema,
  WebhookConfigSchema,
  WebhookSubscriptionSchema,
};

export default ConfigValidator;
