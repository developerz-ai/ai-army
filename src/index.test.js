/**
 * Tests for main exports
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  // Core
  Orchestrator,
  BotManager,
  BotReloader,
  SessionManager,
  TemplateManager,
  MessageProcessor,
  MessageRouter,
  ChannelManager,
  BotEventEmitter,
  BOT_EVENTS,
  WorkerRegistry,
  WorkerAssigner,
  // Agent
  AgentRunner,
  // Execution
  ContainerPool,
  IncusBackend,
  IncusClient,
  ToolExecutor,
  // Tools
  ToolRegistry,
  // Utils
  VariableSubstitutor,
  ErrorHandler,
  SoulLoader,
  // Config
  ConfigLoader,
  ConfigValidator,
  // API
  APIServer,
  AdminRouter,
  // Monitoring
  HealthMonitor,
  // Queue
  MessageQueue,
  // Webhooks
  WebhookManager,
  // Secrets
  SecretsManager,
  // Skills
  SkillRegistry,
  // Audit
  AuditLogger,
  // Database
  MigrationRunner,
  // Channel Adapters
  SlackAdapter,
  DiscordAdapter,
  RESTAdapter,
  // Secret Adapters
  BitwardenAdapter,
  OnePasswordAdapter,
  EnvAdapter,
  // Storage Adapters
  PostgresStorage,
} from './index.js';

describe('Core exports', () => {
  test('Orchestrator exports correctly', () => {
    assert.ok(Orchestrator);
    assert.strictEqual(typeof Orchestrator, 'function');
  });

  test('BotManager exports correctly', () => {
    assert.ok(BotManager);
    assert.strictEqual(typeof BotManager, 'function');
  });

  test('BotReloader exports correctly', () => {
    assert.ok(BotReloader);
    assert.strictEqual(typeof BotReloader, 'function');
  });

  test('SessionManager exports correctly', () => {
    assert.ok(SessionManager);
    assert.strictEqual(typeof SessionManager, 'function');
  });

  test('TemplateManager exports correctly', () => {
    assert.ok(TemplateManager);
    assert.strictEqual(typeof TemplateManager, 'function');
  });

  test('MessageProcessor exports correctly', () => {
    assert.ok(MessageProcessor);
    assert.strictEqual(typeof MessageProcessor, 'function');
  });

  test('MessageRouter exports correctly', () => {
    assert.ok(MessageRouter);
    assert.strictEqual(typeof MessageRouter, 'function');
  });

  test('ChannelManager exports correctly', () => {
    assert.ok(ChannelManager);
    assert.strictEqual(typeof ChannelManager, 'function');
  });

  test('BotEventEmitter exports correctly', () => {
    assert.ok(BotEventEmitter);
    assert.strictEqual(typeof BotEventEmitter, 'function');
  });

  test('BOT_EVENTS exports correctly', () => {
    assert.ok(BOT_EVENTS);
    assert.strictEqual(typeof BOT_EVENTS, 'object');
  });

  test('WorkerRegistry exports correctly', () => {
    assert.ok(WorkerRegistry);
    assert.strictEqual(typeof WorkerRegistry, 'function');
  });

  test('WorkerAssigner exports correctly', () => {
    assert.ok(WorkerAssigner);
    assert.strictEqual(typeof WorkerAssigner, 'function');
  });
});

describe('Agent exports', () => {
  test('AgentRunner exports correctly', () => {
    assert.ok(AgentRunner);
    assert.strictEqual(typeof AgentRunner, 'function');
  });
});

describe('Execution exports', () => {
  test('ContainerPool exports correctly', () => {
    assert.ok(ContainerPool);
    assert.strictEqual(typeof ContainerPool, 'function');
  });

  test('IncusBackend exports correctly', () => {
    assert.ok(IncusBackend);
    assert.strictEqual(typeof IncusBackend, 'function');
  });

  test('IncusClient exports correctly', () => {
    assert.ok(IncusClient);
    assert.strictEqual(typeof IncusClient, 'function');
  });

  test('ToolExecutor exports correctly', () => {
    assert.ok(ToolExecutor);
    assert.strictEqual(typeof ToolExecutor, 'function');
  });
});

describe('Tools exports', () => {
  test('ToolRegistry exports correctly', () => {
    assert.ok(ToolRegistry);
    assert.strictEqual(typeof ToolRegistry, 'function');
  });
});

describe('Utils exports', () => {
  test('VariableSubstitutor exports correctly', () => {
    assert.ok(VariableSubstitutor);
    assert.strictEqual(typeof VariableSubstitutor, 'function');
  });

  test('ErrorHandler exports correctly', () => {
    assert.ok(ErrorHandler);
    assert.strictEqual(typeof ErrorHandler, 'function');
  });

  test('SoulLoader exports correctly', () => {
    assert.ok(SoulLoader);
    assert.strictEqual(typeof SoulLoader, 'function');
  });
});

describe('Config exports', () => {
  test('ConfigLoader exports correctly', () => {
    assert.ok(ConfigLoader);
    assert.strictEqual(typeof ConfigLoader, 'function');
  });

  test('ConfigValidator exports correctly', () => {
    assert.ok(ConfigValidator);
    assert.strictEqual(typeof ConfigValidator, 'function');
  });
});

describe('API exports', () => {
  test('APIServer exports correctly', () => {
    assert.ok(APIServer);
    assert.strictEqual(typeof APIServer, 'function');
  });

  test('AdminRouter exports correctly', () => {
    assert.ok(AdminRouter);
    assert.strictEqual(typeof AdminRouter, 'function');
  });
});

describe('Monitoring exports', () => {
  test('HealthMonitor exports correctly', () => {
    assert.ok(HealthMonitor);
    assert.strictEqual(typeof HealthMonitor, 'function');
  });
});

describe('Queue exports', () => {
  test('MessageQueue exports correctly', () => {
    assert.ok(MessageQueue);
    assert.strictEqual(typeof MessageQueue, 'function');
  });
});

describe('Webhooks exports', () => {
  test('WebhookManager exports correctly', () => {
    assert.ok(WebhookManager);
    assert.strictEqual(typeof WebhookManager, 'function');
  });
});

describe('Secrets exports', () => {
  test('SecretsManager exports correctly', () => {
    assert.ok(SecretsManager);
    assert.strictEqual(typeof SecretsManager, 'function');
  });
});

describe('Skills exports', () => {
  test('SkillRegistry exports correctly', () => {
    assert.ok(SkillRegistry);
    assert.strictEqual(typeof SkillRegistry, 'function');
  });
});

describe('Audit exports', () => {
  test('AuditLogger exports correctly', () => {
    assert.ok(AuditLogger);
    assert.strictEqual(typeof AuditLogger, 'function');
  });
});

describe('Database exports', () => {
  test('MigrationRunner exports correctly', () => {
    assert.ok(MigrationRunner);
    assert.strictEqual(typeof MigrationRunner, 'function');
  });
});

describe('Channel Adapters exports', () => {
  test('SlackAdapter exports correctly', () => {
    assert.ok(SlackAdapter);
    assert.strictEqual(typeof SlackAdapter, 'function');
  });

  test('DiscordAdapter exports correctly', () => {
    assert.ok(DiscordAdapter);
    assert.strictEqual(typeof DiscordAdapter, 'function');
  });

  test('RESTAdapter exports correctly', () => {
    assert.ok(RESTAdapter);
    assert.strictEqual(typeof RESTAdapter, 'function');
  });
});

describe('Secret Adapters exports', () => {
  test('BitwardenAdapter exports correctly', () => {
    assert.ok(BitwardenAdapter);
    assert.strictEqual(typeof BitwardenAdapter, 'function');
  });

  test('OnePasswordAdapter exports correctly', () => {
    assert.ok(OnePasswordAdapter);
    assert.strictEqual(typeof OnePasswordAdapter, 'function');
  });

  test('EnvAdapter exports correctly', () => {
    assert.ok(EnvAdapter);
    assert.strictEqual(typeof EnvAdapter, 'function');
  });
});

describe('Storage Adapters exports', () => {
  test('PostgresStorage exports correctly', () => {
    assert.ok(PostgresStorage);
    assert.strictEqual(typeof PostgresStorage, 'function');
  });
});
