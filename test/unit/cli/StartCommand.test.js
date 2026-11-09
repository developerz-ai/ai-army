/**
 * Unit tests for StartCommand
 *
 * Tests the runStart() function with mock dependencies:
 * - Mock Orchestrator with configurable start/stop behavior
 * - Verifies output formatting, signal handling, and error cases
 * - Tests production mode startup scenarios
 *
 * Mirrors co-located src/cli/StartCommand.test.js into test/unit/cli/ structure
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  runStart,
  StartCommandError,
  _checkProductionWarnings,
} from '../../../src/cli/StartCommand.js';
import { Orchestrator, OrchestratorError } from '../../../src/core/orchestrator.js';
import { MessageRouter } from '../../../src/core/message-router.js';
import SlackAdapter from '../../../src/adapters/channels/slack.js';
import DiscordAdapter from '../../../src/adapters/channels/discord.js';
import RESTAdapter from '../../../src/adapters/channels/rest.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a writable stream mock that collects output
 * @returns {{ write: Function, output: () => string }}
 */
function createOutputStream() {
  const chunks = [];
  return {
    write(data) {
      chunks.push(data);
      return true;
    },
    output() {
      return chunks.join('');
    },
  };
}

/**
 * Create a mock process object for signal handling tests
 * @returns {Object} Mock process with on() and signal tracking
 */
function createMockProcess() {
  const handlers = {};
  return {
    on(signal, handler) {
      handlers[signal] = handler;
    },
    removeListener(signal, handler) {
      if (handlers[signal] === handler) {
        delete handlers[signal];
      }
    },
    async emit(signal) {
      if (handlers[signal]) {
        await handlers[signal]();
      }
    },
    handlers,
  };
}

/**
 * Create a mock Orchestrator
 * @param {Object} [options] - Options
 * @param {Error} [options.startError] - Error to throw from start()
 * @param {Error} [options.stopError] - Error to throw from stop()
 * @param {Object} [options.status] - Status to return from getStatus()
 * @param {Object} [options.apiServer] - Mock API server object
 * @returns {Object} Mock Orchestrator
 */
function createMockOrchestrator(options = {}) {
  const {
    startError,
    stopError,
    status = {
      botCount: 3,
      channelCount: 2,
      databaseConnected: true,
      state: 'running',
      apiServerRunning: false,
      apiServerPort: null,
    },
    apiServer = null,
  } = options;

  return {
    start: mock.fn(async () => {
      if (startError) throw startError;
    }),
    stop: mock.fn(async () => {
      if (stopError) throw stopError;
    }),
    getStatus: mock.fn(() => status),
    getState: mock.fn(() => status.state || 'running'),
    apiServer,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('StartCommand - runStart()', () => {
  let out;
  let proc;

  beforeEach(() => {
    out = createOutputStream();
    proc = createMockProcess();
  });

  describe('startup and output', () => {
    test('outputs production mode message on start', async () => {
      const orch = createMockOrchestrator();

      await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      const result = out.output();
      assert.ok(result.includes('production mode'));
    });

    test('calls orchestrator.start()', async () => {
      const orch = createMockOrchestrator();

      await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      assert.equal(orch.start.mock.calls.length, 1);
    });

    test('displays running message after successful start', async () => {
      const orch = createMockOrchestrator();

      await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      const result = out.output();
      assert.ok(result.includes('AI Army is running'));
      assert.ok(result.includes('Ctrl+C'));
    });

    test('displays bot and channel counts', async () => {
      const orch = createMockOrchestrator({
        status: {
          botCount: 5,
          channelCount: 3,
          databaseConnected: true,
          apiServerRunning: false,
          apiServerPort: null,
        },
      });

      await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      const result = out.output();
      assert.ok(result.includes('Bots: 5'));
      assert.ok(result.includes('Channels: 3'));
      assert.ok(result.includes('Database: connected'));
    });

    test('displays database not connected when disconnected', async () => {
      const orch = createMockOrchestrator({
        status: {
          botCount: 1,
          channelCount: 0,
          databaseConnected: false,
          apiServerRunning: false,
          apiServerPort: null,
        },
      });

      await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      const result = out.output();
      assert.ok(result.includes('Database: not connected'));
    });

    test('displays API server info when running', async () => {
      const orch = createMockOrchestrator({
        status: {
          botCount: 2,
          channelCount: 1,
          databaseConnected: true,
          apiServerRunning: true,
          apiServerPort: 3000,
        },
        apiServer: {
          host: 'localhost',
        },
      });

      await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      const result = out.output();
      assert.ok(result.includes('API:'));
      assert.ok(result.includes('localhost:3000'));
    });

    test('displays API server with default host when host is missing', async () => {
      const orch = createMockOrchestrator({
        status: {
          botCount: 2,
          channelCount: 1,
          databaseConnected: true,
          apiServerRunning: true,
          apiServerPort: 3000,
        },
        apiServer: null,
      });

      await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      const result = out.output();
      assert.ok(result.includes('API:'));
      assert.ok(result.includes('0.0.0.0:3000'));
    });

    test('omits API server info when not running', async () => {
      const orch = createMockOrchestrator({
        status: {
          botCount: 2,
          channelCount: 1,
          databaseConnected: true,
          apiServerRunning: false,
          apiServerPort: null,
        },
      });

      await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      const result = out.output();
      assert.ok(!result.includes('API:'));
    });
  });

  describe('signal handling and shutdown', () => {
    test('registers SIGINT handler', async () => {
      const orch = createMockOrchestrator();

      await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      assert.ok(proc.handlers.SIGINT, 'SIGINT handler should be registered');
    });

    test('registers SIGTERM handler', async () => {
      const orch = createMockOrchestrator();

      await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      assert.ok(proc.handlers.SIGTERM, 'SIGTERM handler should be registered');
    });

    test('SIGINT triggers graceful shutdown', async () => {
      const orch = createMockOrchestrator();

      await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      await proc.emit('SIGINT');

      assert.equal(orch.stop.mock.calls.length, 1);
      assert.ok(out.output().includes('SIGINT'));
      assert.ok(out.output().includes('Shutdown complete'));
    });

    test('SIGTERM triggers graceful shutdown', async () => {
      const orch = createMockOrchestrator();

      await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      await proc.emit('SIGTERM');

      assert.equal(orch.stop.mock.calls.length, 1);
      assert.ok(out.output().includes('SIGTERM'));
      assert.ok(out.output().includes('Shutdown complete'));
    });

    test('calls onShutdown callback after shutdown', async () => {
      const orch = createMockOrchestrator();
      let shutdownCalled = false;

      await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
        onShutdown: () => {
          shutdownCalled = true;
        },
      });

      await proc.emit('SIGINT');
      assert.ok(shutdownCalled);
    });

    test('removes signal handlers after first shutdown', async () => {
      const orch = createMockOrchestrator();

      await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      await proc.emit('SIGINT');

      // Try to emit again - should not call stop again
      await proc.emit('SIGINT');

      assert.equal(orch.stop.mock.calls.length, 1, 'stop should only be called once');
    });

    test('handles shutdown errors gracefully', async () => {
      const orch = createMockOrchestrator({
        stopError: new Error('Shutdown error'),
      });

      await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      await proc.emit('SIGINT');

      const result = out.output();
      assert.ok(result.includes('Shutdown completed with errors'));
      assert.ok(result.includes('Shutdown error'));
    });

    test('onShutdown is called even when shutdown has errors', async () => {
      const orch = createMockOrchestrator({
        stopError: new Error('Shutdown error'),
      });
      let shutdownCalled = false;

      await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
        onShutdown: () => {
          shutdownCalled = true;
        },
      });

      await proc.emit('SIGINT');
      assert.ok(shutdownCalled);
    });
  });

  describe('error handling', () => {
    test('handles OrchestratorError during startup', async () => {
      const startError = new OrchestratorError('Configuration validation failed', {
        operation: 'start',
        component: 'config',
      });
      const orch = createMockOrchestrator({ startError });

      const result = await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      const output = out.output();
      assert.ok(output.includes('Startup failed'));
      assert.ok(output.includes('Configuration validation failed'));
      assert.ok(output.includes('Component: config'));
      assert.ok(result.orchestrator);
    });

    test('handles OrchestratorError without component field', async () => {
      const startError = new OrchestratorError('Generic error', {
        operation: 'start',
      });
      const orch = createMockOrchestrator({ startError });

      const result = await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      const output = out.output();
      assert.ok(output.includes('Startup failed'));
      assert.ok(output.includes('Generic error'));
      assert.ok(!output.includes('Component:'));
      assert.ok(result.orchestrator);
    });

    test('attempts cleanup after OrchestratorError', async () => {
      const startError = new OrchestratorError('Start failed');
      const orch = createMockOrchestrator({ startError });

      await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      assert.equal(orch.stop.mock.calls.length, 1);
    });

    test('ignores cleanup errors after OrchestratorError', async () => {
      const startError = new OrchestratorError('Start failed');
      const stopError = new Error('Stop also failed');
      const orch = createMockOrchestrator({ startError, stopError });

      const result = await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      // Should complete despite cleanup error
      assert.ok(result.orchestrator);
      const output = out.output();
      assert.ok(output.includes('Startup failed'));
    });

    test('throws StartCommandError for non-Orchestrator errors', async () => {
      const startError = new Error('Unexpected error');
      const orch = createMockOrchestrator({ startError });

      await assert.rejects(
        () =>
          runStart({
            orchestrator: orch,
            output: out,
            processRef: proc,
          }),
        err => {
          assert.ok(err instanceof StartCommandError);
          assert.ok(err.message.includes('Startup failed'));
          assert.equal(err.cause, startError);
          return true;
        }
      );
    });
  });

  describe('return value', () => {
    test('returns orchestrator instance', async () => {
      const orch = createMockOrchestrator();

      const result = await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      assert.equal(result.orchestrator, orch);
    });

    test('returns orchestrator even on OrchestratorError', async () => {
      const startError = new OrchestratorError('Start failed');
      const orch = createMockOrchestrator({ startError });

      const result = await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      assert.equal(result.orchestrator, orch);
    });
  });

  describe('Orchestrator creation', () => {
    test('creates Orchestrator when not injected', async () => {
      // Test without injecting orchestrator (uses default paths)
      const result = await runStart({
        output: out,
        processRef: proc,
        configPath: './config.json',
        botsPath: './bots',
        migrationsPath: './migrations',
      });

      assert.ok(result.orchestrator, 'Should create orchestrator');
    });

    test('uses injected orchestrator when provided', async () => {
      const orch = createMockOrchestrator();

      const result = await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      assert.equal(result.orchestrator, orch, 'Should use injected orchestrator');
      assert.equal(orch.start.mock.calls.length, 1);
    });
  });

  describe('channel wiring on a self-built Orchestrator', () => {
    const missingConfig = '/tmp/ai-army-nonexistent-config.json';

    test('passes a messageRouterFactory that builds a MessageRouter', async () => {
      const { orchestrator } = await runStart({
        configPath: missingConfig,
        output: out,
        processRef: proc,
      });

      assert.equal(typeof orchestrator.messageRouterFactory, 'function');
      const botManager = { listBots: () => [] };
      const router = orchestrator.messageRouterFactory(botManager);
      assert.ok(router instanceof MessageRouter);
      assert.equal(router.botManager, botManager);
    });

    test('registers the slack, discord and rest channel adapters', async () => {
      const { orchestrator } = await runStart({
        configPath: missingConfig,
        output: out,
        processRef: proc,
      });

      assert.equal(orchestrator.channelAdapters.get('slack'), SlackAdapter);
      assert.equal(orchestrator.channelAdapters.get('discord'), DiscordAdapter);
      assert.equal(orchestrator.channelAdapters.get('rest'), RESTAdapter);
      assert.equal(orchestrator.channelAdapters.size, 3);
    });

    test('leaves an injected orchestrator untouched', async () => {
      const orch = createMockOrchestrator();

      const { orchestrator } = await runStart({
        orchestrator: orch,
        output: out,
        processRef: proc,
      });

      assert.equal(orchestrator, orch);
      assert.equal(orch.messageRouterFactory, undefined);
      assert.equal(orch.channelAdapters, undefined);
    });

    test('the command-built factory yields a live router: a channel message reaches route()', async () => {
      // Take the factory exactly as the command builds it ...
      const { orchestrator: built } = await runStart({
        configPath: missingConfig,
        output: out,
        processRef: proc,
      });

      // ... and run it in an Orchestrator whose other collaborators are mocks.
      const bots = [];
      const botManager = {
        loadBot: mock.fn(async (botId, config) => {
          const bot = { id: botId, config: { ...config, enabled: true }, status: 'loaded' };
          bots.push(bot);
          return bot;
        }),
        startBot: mock.fn(async () => {}),
        stopBot: mock.fn(async () => {}),
        stopAll: mock.fn(async () => ({ stopped: [], failed: [] })),
        listBots: mock.fn(() => [...bots]),
        getBot: mock.fn(id => bots.find(b => b.id === id)),
        getBotCount: mock.fn(() => bots.length),
      };
      const mainConfig = {
        defaults: {
          model: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
          sandbox: { type: 'incus', incusImage: 'node:22-slim' },
        },
        providers: { anthropic: { type: 'anthropic', apiKey: 'test-key' } },
        mcpServers: {},
        channels: { 'slack-main': { type: 'slack' } },
        bots: {
          'test-bot': {
            soul: './soul.md',
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
            channel: 'slack-main',
          },
        },
      };
      const sent = [];
      class StubSlack {
        async initialize() {}
        async close() {}
        onMessage(handler) {
          this.messageHandler = handler;
        }
        async sendMessage(channelId, text) {
          sent.push({ channelId, text });
        }
      }
      const messageProcessor = {
        processMessage: mock.fn(async () => ({ text: 'AI response' })),
      };

      const orch = new Orchestrator({
        logger: null,
        botsPath: '/tmp/nonexistent-bots-path',
        configLoader: {
          load: mock.fn(async () => mainConfig),
          deepMerge: mock.fn((defaults, overrides) => ({ ...defaults, ...overrides })),
          loadBotConfig: mock.fn(async (_path, defaults) => ({ ...defaults })),
        },
        configValidator: {
          validateMainConfig: mock.fn(config => ({ valid: true, errors: [], data: config })),
          validateBotConfig: mock.fn(config => config),
          generateReport: mock.fn(() => ''),
        },
        storage: {
          connect: mock.fn(async () => {}),
          disconnect: mock.fn(async () => {}),
          query: mock.fn(async () => ({ rows: [] })),
          isConnected: mock.fn(() => true),
          getPoolStats: mock.fn(() => ({ totalCount: 1, idleCount: 1, waitingCount: 0 })),
        },
        botManager,
        migrationRunner: {
          runMigrations: mock.fn(async () => []),
          getMigrationStatus: mock.fn(async () => []),
          ensureMigrationsTable: mock.fn(async () => {}),
        },
        messageProcessor,
        messageRouterFactory: built.messageRouterFactory,
      });
      // Stub the Slack adapter only: the real one needs live credentials
      orch.registerChannelAdapter('slack', StubSlack);

      assert.equal(orch.messageRouter, null);
      await orch.start();
      try {
        assert.ok(orch.messageRouter instanceof MessageRouter, 'messageRouter is non-null');
        const routeSpy = mock.method(orch.messageRouter, 'route');

        const { adapter } = orch.channelManager.getChannel('slack-main');
        await adapter.messageHandler({
          type: 'slack',
          userId: 'U123',
          channelId: 'C456',
          text: 'Hello bot!',
          isDM: false,
        });

        assert.equal(routeSpy.mock.calls.length, 1);
        assert.equal(routeSpy.mock.calls[0].arguments[0].channelName, 'slack-main');
        assert.equal(messageProcessor.processMessage.mock.calls.length, 1);
        assert.deepEqual(sent, [{ channelId: 'C456', text: 'AI response' }]);
      } finally {
        await orch.stop();
      }
    });
  });

  describe('default parameters', () => {
    test('uses default output when not provided', async () => {
      const orch = createMockOrchestrator();

      // Should not throw when output is not provided (uses process.stdout)
      const result = await runStart({
        orchestrator: orch,
        processRef: proc,
      });

      assert.ok(result.orchestrator);
    });

    test('uses default processRef when not provided', async () => {
      const orch = createMockOrchestrator();

      // Should not throw when processRef is not provided (uses process)
      const result = await runStart({
        orchestrator: orch,
        output: out,
      });

      assert.ok(result.orchestrator);
    });
  });
});

// ============================================================================
// Production Warnings Tests
// ============================================================================

describe('StartCommand - _checkProductionWarnings()', () => {
  let out;

  beforeEach(() => {
    out = createOutputStream();
  });

  const write = out => msg => out.write(msg);

  describe('non-production environments', () => {
    test('returns no warnings when NODE_ENV is development', () => {
      const env = { NODE_ENV: 'development' };
      const warnings = _checkProductionWarnings({ write: write(out), env });
      assert.equal(warnings.length, 0);
      assert.equal(out.output(), '');
    });

    test('returns no warnings when NODE_ENV is test', () => {
      const env = { NODE_ENV: 'test' };
      const warnings = _checkProductionWarnings({ write: write(out), env });
      assert.equal(warnings.length, 0);
    });

    test('returns no warnings when NODE_ENV is undefined', () => {
      const env = {};
      const warnings = _checkProductionWarnings({ write: write(out), env });
      assert.equal(warnings.length, 0);
    });

    test('skips all checks when not in production', () => {
      const env = {
        NODE_ENV: 'development',
        API_TOKEN: '',
        DB_PASSWORD: 'ai_army_dev',
        DATABASE_URL: 'postgresql://ai_army:ai_army_dev@localhost:5432/ai_army',
      };
      const warnings = _checkProductionWarnings({ write: write(out), env });
      assert.equal(warnings.length, 0);
    });
  });

  describe('API_TOKEN checks', () => {
    test('warns when API_TOKEN is empty string', () => {
      const env = { NODE_ENV: 'production', API_TOKEN: '' };
      const warnings = _checkProductionWarnings({ write: write(out), env });
      assert.ok(warnings.some(w => w.includes('API_TOKEN')));
      assert.ok(out.output().includes('API_TOKEN'));
    });

    test('warns when API_TOKEN is not set', () => {
      const env = { NODE_ENV: 'production' };
      const warnings = _checkProductionWarnings({ write: write(out), env });
      assert.ok(warnings.some(w => w.includes('API_TOKEN')));
    });

    test('does not warn when API_TOKEN is set', () => {
      const env = {
        NODE_ENV: 'production',
        API_TOKEN: 'sk-prod-secure-token-12345',
      };
      const warnings = _checkProductionWarnings({ write: write(out), env });
      assert.ok(!warnings.some(w => w.includes('API_TOKEN')));
    });
  });

  describe('DB_PASSWORD checks', () => {
    test('warns when DB_PASSWORD is the default dev value', () => {
      const env = { NODE_ENV: 'production', DB_PASSWORD: 'ai_army_dev' };
      const warnings = _checkProductionWarnings({ write: write(out), env });
      assert.ok(warnings.some(w => w.includes('DB_PASSWORD')));
      assert.ok(warnings.some(w => w.includes('ai_army_dev')));
    });

    test('does not warn when DB_PASSWORD is a strong password', () => {
      const env = {
        NODE_ENV: 'production',
        DB_PASSWORD: 'super-secure-prod-password-2024!',
      };
      const warnings = _checkProductionWarnings({ write: write(out), env });
      assert.ok(!warnings.some(w => w.includes('DB_PASSWORD')));
    });

    test('does not warn when DB_PASSWORD is not set', () => {
      const env = { NODE_ENV: 'production' };
      const warnings = _checkProductionWarnings({ write: write(out), env });
      assert.ok(!warnings.some(w => w.includes('DB_PASSWORD')));
    });
  });

  describe('DATABASE_URL checks', () => {
    test('warns when DATABASE_URL points to localhost', () => {
      const env = {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://ai_army:pass@localhost:5432/ai_army',
      };
      const warnings = _checkProductionWarnings({ write: write(out), env });
      assert.ok(warnings.some(w => w.includes('localhost')));
    });

    test('warns when DATABASE_URL points to 127.0.0.1', () => {
      const env = {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://ai_army:pass@127.0.0.1:5432/ai_army',
      };
      const warnings = _checkProductionWarnings({ write: write(out), env });
      assert.ok(warnings.some(w => w.includes('127.0.0.1')));
    });

    test('warns when DATABASE_URL points to postgres (docker internal)', () => {
      const env = {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://ai_army:pass@postgres:5432/ai_army',
      };
      const warnings = _checkProductionWarnings({ write: write(out), env });
      assert.ok(warnings.some(w => w.includes('postgres')));
    });

    test('does not warn when DATABASE_URL points to a remote host', () => {
      const env = {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://ai_army:pass@prod-db.internal:5432/ai_army',
      };
      const warnings = _checkProductionWarnings({ write: write(out), env });
      assert.ok(!warnings.some(w => w.includes('DATABASE_URL')));
    });

    test('does not warn when DATABASE_URL is not set', () => {
      const env = { NODE_ENV: 'production' };
      const warnings = _checkProductionWarnings({ write: write(out), env });
      assert.ok(!warnings.some(w => w.includes('DATABASE_URL')));
    });

    test('does not crash on malformed DATABASE_URL', () => {
      const env = {
        NODE_ENV: 'production',
        DATABASE_URL: 'not-a-valid-url',
      };
      const warnings = _checkProductionWarnings({ write: write(out), env });
      // Should not throw, and should not include a DATABASE_URL warning
      assert.ok(!warnings.some(w => w.includes('DATABASE_URL')));
    });
  });

  describe('combined warnings', () => {
    test('reports all warnings when multiple issues exist', () => {
      const env = {
        NODE_ENV: 'production',
        API_TOKEN: '',
        DB_PASSWORD: 'ai_army_dev',
        DATABASE_URL: 'postgresql://ai_army:ai_army_dev@postgres:5432/ai_army',
      };
      const warnings = _checkProductionWarnings({ write: write(out), env });
      assert.equal(warnings.length, 3);
      assert.ok(warnings.some(w => w.includes('API_TOKEN')));
      assert.ok(warnings.some(w => w.includes('DB_PASSWORD')));
      assert.ok(warnings.some(w => w.includes('DATABASE_URL')));
    });

    test('outputs warning header when warnings exist', () => {
      const env = {
        NODE_ENV: 'production',
        API_TOKEN: '',
      };
      _checkProductionWarnings({ write: write(out), env });
      assert.ok(out.output().includes('Production warnings'));
    });

    test('outputs bullet points for each warning', () => {
      const env = {
        NODE_ENV: 'production',
        API_TOKEN: '',
        DB_PASSWORD: 'ai_army_dev',
      };
      _checkProductionWarnings({ write: write(out), env });
      const output = out.output();
      const bulletCount = (output.match(/•/g) || []).length;
      assert.equal(bulletCount, 2);
    });

    test('does not output header when no warnings', () => {
      const env = {
        NODE_ENV: 'production',
        API_TOKEN: 'secure-token',
        DB_PASSWORD: 'strong-password',
        DATABASE_URL: 'postgresql://user:pass@remote-db.example.com:5432/db',
      };
      _checkProductionWarnings({ write: write(out), env });
      assert.equal(out.output(), '');
    });
  });
});

describe('StartCommand - runStart() production warnings integration', () => {
  let out;
  let proc;

  beforeEach(() => {
    out = createOutputStream();
    proc = createMockProcess();
  });

  test('shows production warnings before startup when NODE_ENV=production', async () => {
    const orch = createMockOrchestrator();
    const env = {
      NODE_ENV: 'production',
      API_TOKEN: '',
      DB_PASSWORD: 'ai_army_dev',
      DATABASE_URL: 'postgresql://ai_army:ai_army_dev@localhost:5432/ai_army',
    };

    await runStart({
      orchestrator: orch,
      output: out,
      processRef: proc,
      env,
    });

    const result = out.output();
    assert.ok(result.includes('Production warnings'));
    assert.ok(result.includes('API_TOKEN'));
    assert.ok(result.includes('DB_PASSWORD'));
    assert.ok(result.includes('localhost'));
    // Warnings should appear before the "running" message
    const warningIdx = result.indexOf('Production warnings');
    const runningIdx = result.indexOf('AI Army is running');
    assert.ok(warningIdx < runningIdx, 'Warnings should appear before running message');
  });

  test('does not show production warnings in development mode', async () => {
    const orch = createMockOrchestrator();
    const env = {
      NODE_ENV: 'development',
      API_TOKEN: '',
      DB_PASSWORD: 'ai_army_dev',
    };

    await runStart({
      orchestrator: orch,
      output: out,
      processRef: proc,
      env,
    });

    const result = out.output();
    assert.ok(!result.includes('Production warnings'));
  });

  test('does not block startup when warnings exist', async () => {
    const orch = createMockOrchestrator();
    const env = {
      NODE_ENV: 'production',
      API_TOKEN: '',
      DB_PASSWORD: 'ai_army_dev',
    };

    const result = await runStart({
      orchestrator: orch,
      output: out,
      processRef: proc,
      env,
    });

    // Orchestrator should still have started
    assert.equal(orch.start.mock.calls.length, 1);
    assert.ok(result.orchestrator);
  });
});

describe('StartCommand - StartCommandError', () => {
  test('has correct name', () => {
    const err = new StartCommandError('test');
    assert.equal(err.name, 'StartCommandError');
  });

  test('stores cause', () => {
    const cause = new Error('original');
    const err = new StartCommandError('wrapper', { cause });
    assert.equal(err.cause, cause);
  });

  test('extends Error', () => {
    const err = new StartCommandError('test');
    assert.ok(err instanceof Error);
  });

  test('works without options', () => {
    const err = new StartCommandError('test message');
    assert.equal(err.message, 'test message');
    assert.equal(err.name, 'StartCommandError');
  });
});
