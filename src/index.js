/**
 * AI Assistants Army - Main Entry Point
 * Framework for building multi-bot AI systems
 */

export { Orchestrator } from './core/orchestrator.js';
export { BotManager } from './core/bot-manager.js';
export { BotReloader } from './core/BotReloader.js';
export { SessionManager } from './core/session-manager.js';
export { TemplateManager } from './core/template-manager.js';

// Utils
export { VariableSubstitutor } from './utils/VariableSubstitutor.js';

// Adapters
export { SlackAdapter } from './adapters/channels/slack.js';
export { DiscordAdapter } from './adapters/channels/discord.js';
export { RESTAdapter } from './adapters/channels/rest.js';

export { BitwardenAdapter } from './adapters/secrets/bitwarden.js';
export { OnePasswordAdapter } from './adapters/secrets/onepassword.js';
export { EnvAdapter } from './adapters/secrets/env.js';

export { PostgresStorage } from './adapters/storage/postgres.js';

// API
export { AdminRouter } from './api/AdminRouter.js';

// Types (when we add TypeScript types)
// export type { BotConfig, TemplateConfig, ChannelAdapter } from './types/index.js';
