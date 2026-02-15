/**
 * AI Assistants Army - Main Entry Point
 * Framework for building multi-bot AI systems
 *
 * @module ai-assistants-army
 *
 * @exports {Orchestrator} - Core orchestrator for managing bot lifecycle
 * @exports {BotManager} - Manages bot instances and state
 * @exports {BotReloader} - Hot-reloads bot configurations
 * @exports {SessionManager} - Manages conversation sessions
 * @exports {TemplateManager} - Manages bot templates
 * @exports {MessageProcessor} - Processes incoming messages
 * @exports {MessageRouter} - Routes messages to appropriate bots
 * @exports {ChannelManager} - Manages communication channels
 * @exports {BotEventEmitter} - Event emitter for bot lifecycle events
 * @exports {BOT_EVENTS} - Enum of bot event types
 * @exports {WorkerRegistry} - Registry for worker instances
 * @exports {WorkerAssigner} - Assigns work to available workers
 * @exports {AgentRunner} - Runs AI agent execution loops
 * @exports {ContainerPool} - Manages pooled containers
 * @exports {ToolExecutor} - Executes tools in sandboxed environments
 * @exports {ToolRegistry} - Registry for available tools
 * @exports {VariableSubstitutor} - Substitutes variables in templates
 * @exports {ErrorHandler} - Centralized error handling
 * @exports {SoulLoader} - Loads bot soul/personality files
 * @exports {ConfigLoader} - Loads configuration files
 * @exports {ConfigValidator} - Validates configuration schemas
 * @exports {APIServer} - HTTP API server
 * @exports {AdminRouter} - Admin API routes
 * @exports {HealthMonitor} - Health check monitoring
 * @exports {MessageQueue} - Message queuing system
 * @exports {WebhookManager} - Manages outbound webhooks
 * @exports {SecretsManager} - Manages secret resolution
 * @exports {SkillRegistry} - Registry for bot skills
 * @exports {AuditLogger} - Audit event logging
 * @exports {MigrationRunner} - Database migration runner
 * @exports {SlackAdapter} - Slack channel adapter
 * @exports {DiscordAdapter} - Discord channel adapter
 * @exports {RESTAdapter} - REST channel adapter
 * @exports {BitwardenAdapter} - Bitwarden secrets adapter
 * @exports {OnePasswordAdapter} - 1Password secrets adapter
 * @exports {EnvAdapter} - Environment variable secrets adapter
 * @exports {PostgresStorage} - PostgreSQL storage adapter
 */

// Core
export { Orchestrator } from './core/orchestrator.js';
export { BotManager } from './core/bot-manager.js';
export { BotReloader } from './core/BotReloader.js';
export { SessionManager } from './core/session-manager.js';
export { TemplateManager } from './core/template-manager.js';
export { MessageProcessor } from './core/message-processor.js';
export { MessageRouter } from './core/message-router.js';
export { ChannelManager } from './core/channel-manager.js';
export { BotEventEmitter, BOT_EVENTS } from './core/event-emitter.js';
export { WorkerRegistry } from './core/worker-registry.js';
export { WorkerAssigner } from './core/worker-assigner.js';

// Agent
export { AgentRunner } from './agent/agent-runner.js';

// Execution
export { ContainerPool } from './execution/container-pool.js';
export { ToolExecutor } from './execution/tool-executor.js';

// Tools
export { ToolRegistry } from './tools/tool-registry.js';

// Utils
export { VariableSubstitutor } from './utils/VariableSubstitutor.js';
export { ErrorHandler } from './utils/ErrorHandler.js';
export { SoulLoader } from './utils/SoulLoader.js';

// Config
export { ConfigLoader } from './config/ConfigLoader.js';
export { ConfigValidator } from './config/ConfigValidator.js';

// API
export { APIServer } from './api/api-server.js';
export { AdminRouter } from './api/AdminRouter.js';

// Monitoring
export { HealthMonitor } from './monitoring/HealthMonitor.js';

// Queue
export { MessageQueue } from './queue/message-queue.js';

// Webhooks
export { WebhookManager } from './webhooks/webhook-manager.js';

// Secrets
export { SecretsManager } from './secrets/secrets-manager.js';

// Skills
export { SkillRegistry } from './skills/skill-registry.js';

// Audit
export { AuditLogger } from './audit/audit-logger.js';

// Database
export { MigrationRunner } from './database/MigrationRunner.js';

// Channel Adapters
export { SlackAdapter } from './adapters/channels/slack.js';
export { DiscordAdapter } from './adapters/channels/discord.js';
export { RESTAdapter } from './adapters/channels/rest.js';

// Secret Adapters
export { BitwardenAdapter } from './adapters/secrets/bitwarden.js';
export { OnePasswordAdapter } from './adapters/secrets/onepassword.js';
export { EnvAdapter } from './adapters/secrets/env.js';

// Storage Adapters
export { PostgresStorage } from './adapters/storage/postgres.js';
