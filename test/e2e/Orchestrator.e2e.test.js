/**
 * End-to-End tests for the Orchestrator
 *
 * Tests the complete message flow from channel to AI response:
 *   Slack message arrives
 *   -> Orchestrator routes via MessageRouter
 *   -> MessageProcessor processes through AI pipeline
 *   -> Tool calls logged to real PostgreSQL
 *   -> Response sent back via channel adapter
 *   -> Graceful shutdown
 *
 * Uses real components:
 * - Real ConfigLoader (filesystem-based config loading)
 * - Real ConfigValidator (Zod schema validation)
 * - Real PostgresStorage with real PostgreSQL (per-worker database)
 * - Real SessionManager (conversation tracking with DB persistence)
 * - Real MessageRouter (channel binding + restriction enforcement)
 * - Real MessageProcessor (full AI pipeline orchestration)
 * - Real MigrationRunner (schema setup)
 *
 * Mock components:
 * - AgentRunner (to avoid real LLM API calls)
 * - Channel adapters (to avoid Slack/Discord connections)
 * - BotManager (to avoid Docker dependency)
 *
 * Uses per-worker databases for parallel test execution.
 */

import { describe, test, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { Orchestrator } from '../../src/core/orchestrator.js';
import { MessageProcessor } from '../../src/core/message-processor.js';
import { MessageRouter } from '../../src/core/message-router.js';
import { SessionManager } from '../../src/core/session-manager.js';
import { PostgresStorage } from '../../src/adapters/storage/postgres.js';
import {
  TEST_DATABASE_URL,
  isDatabaseAvailable,
  createWorkerDatabase,
  dropWorkerDatabase,
} from '../helpers/setup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_AVAILABLE = await isDatabaseAvailable();

if (!DB_AVAILABLE) {
  console.log('Orchestrator E2E: PostgreSQL not available, tests will be skipped');
}

/** Track temp directories for cleanup */
const tempDirs = [];

// =============================================================================
// Helper Factories
// =============================================================================

/**
 * Create a temporary project directory with config.json and optional bots
 * @param {Object} config - Main config.json contents
 * @param {Object} [bots={}] - Map of botId -> { config, soul }
 * @returns {Promise<string>} Path to temporary project directory
 */
async function createTempProject(config, bots = {}) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-e2e-'));
  tempDirs.push(tmpDir);

  // Write main config.json
  await fs.writeFile(path.join(tmpDir, 'config.json'), JSON.stringify(config, null, 2), 'utf8');

  // Create bots directory and individual bot configs
  const botsDir = path.join(tmpDir, 'bots');
  await fs.mkdir(botsDir, { recursive: true });

  for (const [botId, botDef] of Object.entries(bots)) {
    const botDir = path.join(botsDir, botId);
    await fs.mkdir(botDir, { recursive: true });

    await fs.writeFile(
      path.join(botDir, 'config.json'),
      JSON.stringify(botDef.config || { id: botId }, null, 2),
      'utf8'
    );

    if (botDef.soul) {
      await fs.writeFile(path.join(botDir, 'soul.md'), botDef.soul, 'utf8');
    }
  }

  // Create data directory
  await fs.mkdir(path.join(tmpDir, 'data'), { recursive: true });

  return tmpDir;
}

/**
 * Create a valid main config for E2E testing
 * @param {Object} [overrides={}] - Override default values
 * @returns {Object} Valid main config
 */
function createValidConfig(overrides = {}) {
  return {
    defaults: {
      model: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
      sandbox: { type: 'docker', image: 'node:22-slim' },
    },
    providers: {
      anthropic: { type: 'anthropic', apiKey: 'test-key-e2e-123' },
    },
    channels: {},
    mcpServers: {},
    ...overrides,
  };
}

/**
 * Create a mock BotManager that records all calls and tracks bot state.
 * When a dbStorage instance is provided, also persists the bot config to
 * PostgreSQL so that foreign key constraints (e.g., sessions.bot_id) are satisfied.
 *
 * @param {Object} [options={}] - Options
 * @param {Object} [options.dbStorage] - PostgresStorage instance for FK satisfaction
 * @param {Object} [options.overrides={}] - Override individual methods
 * @returns {Object} Mock BotManager
 */
function createMockBotManager(options = {}) {
  const { dbStorage, overrides = {} } =
    typeof options.dbStorage !== 'undefined' ? options : { dbStorage: null, overrides: options };
  const bots = [];
  return {
    loadBot: mock.fn(async (botId, config) => {
      const bot = {
        id: botId,
        config: { ...config, enabled: config.enabled ?? true },
        status: 'loaded',
      };
      bots.push(bot);

      // Persist to database for FK constraints (sessions.bot_id → bots.id)
      if (dbStorage) {
        await dbStorage.saveBotConfig(botId, config, {
          name: botId,
          description: `E2E test bot: ${botId}`,
          soulContent: config.soulContent || '',
          status: 'stopped',
        });
      }

      return bot;
    }),
    startBot: mock.fn(async botId => {
      const bot = bots.find(b => b.id === botId);
      if (bot) bot.status = 'running';
    }),
    stopBot: mock.fn(async () => {}),
    reloadBot: mock.fn(async () => {}),
    stopAll: mock.fn(async () => ({ stopped: bots.map(b => b.id), failed: [] })),
    listBots: mock.fn(() => [...bots]),
    getBot: mock.fn(botId => bots.find(b => b.id === botId)),
    getBotCount: mock.fn(() => bots.length),
    _bots: bots,
    ...overrides,
  };
}

/**
 * Create a mock channel adapter class with programmable message handling
 *
 * Captures onMessage handlers so tests can simulate incoming messages,
 * and records sendMessage calls so tests can verify responses.
 *
 * @param {Object} [options={}] - Adapter behavior options
 * @returns {Function} Mock adapter constructor
 */
function createMockChannelAdapterClass(options = {}) {
  return class MockChannelAdapter {
    constructor() {
      this.initialized = false;
      this.config = null;
      this.closed = false;
      this.messageHandler = null;
      this.sentMessages = [];
    }

    async initialize(config) {
      if (options.initializeError) {
        throw new Error(options.initializeError);
      }
      this.initialized = true;
      this.config = config;
    }

    onMessage(handler) {
      this.messageHandler = handler;
    }

    async sendMessage(channelId, text, threadTs) {
      this.sentMessages.push({ channelId, text, threadTs });
    }

    async close() {
      if (options.closeError) {
        throw new Error(options.closeError);
      }
      this.closed = true;
      this.initialized = false;
    }
  };
}

/**
 * Create a mock AgentRunner that returns configurable results
 * @param {Object} [result] - Result to return from run()
 * @returns {Object} Mock agent runner
 */
function createMockAgentRunner(result) {
  const defaultResult = {
    text: 'Hello! I am your AI assistant. How can I help you today?',
    toolCalls: [],
    usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    steps: [],
    finishReason: 'end',
  };

  return {
    run: mock.fn(async (_botConfig, _messages) => result || defaultResult),
  };
}

/**
 * Create a mock AgentRunner that simulates tool calling (Docker-like execution)
 * @param {Object} [options={}] - Tool behavior options
 * @returns {Object} Mock agent runner with tool calls
 */
function createMockAgentRunnerWithTools(options = {}) {
  const toolCalls = options.toolCalls || [
    { toolName: 'bash', toolCallId: 'call_1', args: { command: 'ls -la /home/agent' } },
  ];

  const steps = options.steps || [
    {
      content: [
        {
          type: 'tool-call',
          toolName: 'bash',
          toolCallId: 'call_1',
          input: { command: 'ls -la /home/agent' },
        },
        {
          type: 'tool-result',
          toolCallId: 'call_1',
          output:
            'total 8\ndrwxr-xr-x 2 agent agent 4096 Jan 1 00:00 .\n-rw-r--r-- 1 agent agent  42 Jan 1 00:00 README.md',
          isError: false,
        },
      ],
    },
  ];

  return {
    run: mock.fn(async () => ({
      text: options.text || 'I found the following files in your workspace.',
      toolCalls,
      usage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 },
      steps,
      finishReason: 'end',
    })),
  };
}

// =============================================================================
// E2E Tests
// =============================================================================

describe('Orchestrator E2E - Full Message Flow', { skip: !DB_AVAILABLE }, () => {
  let storage;
  const migrationsPath = path.resolve(__dirname, '../../migrations');

  before(async () => {
    await createWorkerDatabase();
    storage = new PostgresStorage(TEST_DATABASE_URL);
    await storage.connect();
  });

  after(async () => {
    // Clean up temp dirs
    for (const dir of tempDirs) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    tempDirs.length = 0;

    if (storage && storage.isConnected()) {
      await storage.disconnect();
    }
    await dropWorkerDatabase();
  });

  beforeEach(async () => {
    // Reconnect storage if a previous test disconnected it
    if (!storage.isConnected()) {
      await storage.connect();
    }

    // Drop all tables for a clean slate
    await storage.query('DROP TABLE IF EXISTS tool_calls CASCADE');
    await storage.query('DROP TABLE IF EXISTS sessions CASCADE');
    await storage.query('DROP TABLE IF EXISTS bots CASCADE');
    await storage.query('DROP TABLE IF EXISTS schema_migrations CASCADE');
    await storage.query('DROP FUNCTION IF EXISTS update_updated_at_column CASCADE');
    await storage.query('DROP FUNCTION IF EXISTS notify_bot_change CASCADE');
  });

  // ===========================================================================
  // Full Slack -> AI -> Response Flow
  // ===========================================================================

  describe('Slack -> AI -> Response flow', () => {
    test('complete message lifecycle: startup -> slack message -> AI response -> shutdown', async () => {
      // --- Setup: Create project with a bot bound to a Slack channel ---
      const config = createValidConfig({
        channels: {
          'slack-main': { type: 'slack', botToken: 'xoxb-e2e-test' },
        },
      });

      // Note: soulContent is included directly in the bot config because the
      // mock BotManager does not resolve soul.md paths. In production, BotManager
      // reads the soul file and sets soulContent on the config automatically.
      const projectDir = await createTempProject(config, {
        'support-bot': {
          config: {
            id: 'support-bot',
            soul: './soul.md',
            soulContent:
              '# Support Bot\nYou are a friendly support assistant. Always be helpful and concise.',
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
            channel: 'slack-main',
          },
          soul: '# Support Bot\nYou are a friendly support assistant. Always be helpful and concise.',
        },
      });

      // --- Build components with DI (real where possible, mocked for external) ---
      const agentRunner = createMockAgentRunner({
        text: 'Sure! I can help you with that. Node.js is a JavaScript runtime.',
        toolCalls: [],
        usage: { promptTokens: 120, completionTokens: 35, totalTokens: 155 },
        steps: [],
        finishReason: 'end',
      });

      const botManager = createMockBotManager({ dbStorage: storage });
      const MockSlackAdapter = createMockChannelAdapterClass();
      const logs = [];

      const sessionManager = new SessionManager(storage);

      const orchestrator = new Orchestrator({
        configPath: path.join(projectDir, 'config.json'),
        botsPath: path.join(projectDir, 'bots'),
        dataPath: path.join(projectDir, 'data'),
        migrationsPath,
        logger: msg => logs.push(msg),
        storage,
        botManager,
        sessionManagerFactory: () => sessionManager,
        messageRouterFactory: bm => new MessageRouter(bm, { logger: msg => logs.push(msg) }),
        messageProcessorFactory: (sm, _storage, _config) =>
          new MessageProcessor(sm, agentRunner, storage, { logger: msg => logs.push(msg) }),
      });

      orchestrator.registerChannelAdapter('slack', MockSlackAdapter);

      // === Step 1: Start the orchestrator ===
      await orchestrator.start();

      assert.equal(orchestrator.getState(), 'running');
      assert.ok(orchestrator.startedAt instanceof Date);

      // Verify bot was discovered, loaded, and started
      assert.equal(botManager.loadBot.mock.calls.length, 1);
      assert.equal(botManager.loadBot.mock.calls[0].arguments[0], 'support-bot');
      assert.equal(botManager.startBot.mock.calls.length, 1);

      // Verify channel was initialized
      assert.equal(orchestrator.channels.size, 1);
      const slackAdapter = orchestrator.channels.get('slack-main');
      assert.ok(slackAdapter.initialized);
      assert.ok(slackAdapter.messageHandler, 'Channel handler should be wired');

      // Verify wiring logs
      assert.ok(
        logs.some(l => l.includes('Wired')),
        'Should log channel wiring'
      );

      // === Step 2: Simulate a Slack message ===
      const incomingMessage = {
        type: 'slack',
        userId: 'U_E2E_USER',
        channelId: 'C_GENERAL',
        text: 'What is Node.js?',
        isDM: false,
      };

      // Trigger the handler that the orchestrator wired
      await slackAdapter.messageHandler(incomingMessage);

      // === Step 3: Verify response was sent back to Slack ===
      assert.equal(slackAdapter.sentMessages.length, 1, 'Should have sent one response');
      assert.equal(slackAdapter.sentMessages[0].channelId, 'C_GENERAL');
      assert.equal(
        slackAdapter.sentMessages[0].text,
        'Sure! I can help you with that. Node.js is a JavaScript runtime.'
      );

      // === Step 4: Verify AgentRunner was called with correct args ===
      assert.equal(agentRunner.run.mock.calls.length, 1);
      const [passedConfig, passedMessages] = agentRunner.run.mock.calls[0].arguments;
      assert.equal(passedConfig.id, 'support-bot');
      assert.equal(passedConfig.provider, 'anthropic');

      // Soul.md should be prepended as system message
      assert.equal(passedMessages[0].role, 'system');
      assert.ok(passedMessages[0].content.includes('friendly support assistant'));

      // User message should be in the messages
      const userMsg = passedMessages.find(m => m.role === 'user');
      assert.ok(userMsg);
      assert.equal(userMsg.content, 'What is Node.js?');

      // === Step 5: Verify session was persisted in database ===
      const expectedSessionId = 'support-bot:slack:C_GENERAL:U_E2E_USER';
      const session = await storage.getSession(expectedSessionId);
      assert.ok(session, 'Session should be persisted in database');
      assert.equal(session.botId, 'support-bot');
      assert.equal(session.userId, 'U_E2E_USER');
      assert.equal(session.channelId, 'C_GENERAL');
      assert.equal(session.channelType, 'slack');

      // Session should have both user and assistant messages
      const sessionUserMsg = session.messages.find(m => m.role === 'user');
      const sessionAssistantMsg = session.messages.find(m => m.role === 'assistant');
      assert.ok(sessionUserMsg, 'Session should have user message');
      assert.equal(sessionUserMsg.content, 'What is Node.js?');
      assert.ok(sessionAssistantMsg, 'Session should have assistant message');
      assert.equal(
        sessionAssistantMsg.content,
        'Sure! I can help you with that. Node.js is a JavaScript runtime.'
      );

      // === Step 6: Verify getStatus ===
      const status = orchestrator.getStatus();
      assert.equal(status.state, 'running');
      assert.equal(status.databaseConnected, true);
      assert.equal(status.channelCount, 1);
      assert.equal(status.messageProcessorReady, true);
      assert.equal(status.messageRouterReady, true);

      // === Step 7: Graceful shutdown ===
      await orchestrator.stop();
      assert.equal(orchestrator.getState(), 'stopped');
      assert.equal(botManager.stopAll.mock.calls.length, 1);

      // Reconnect for subsequent tests
      if (!storage.isConnected()) {
        await storage.connect();
      }
    });

    test('message with tool calls: Slack -> AI -> Docker bash -> response', async () => {
      const config = createValidConfig({
        channels: {
          'slack-dev': { type: 'slack', botToken: 'xoxb-e2e-dev' },
        },
      });

      const projectDir = await createTempProject(config, {
        'devops-bot': {
          config: {
            id: 'devops-bot',
            soul: './soul.md',
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
            channel: 'slack-dev',
          },
          soul: '# DevOps Bot\nYou are a DevOps assistant. Execute commands safely.',
        },
      });

      const agentRunner = createMockAgentRunnerWithTools({
        toolCalls: [
          { toolName: 'bash', toolCallId: 'tc_ls', args: { command: 'ls -la /home/agent' } },
          { toolName: 'readFile', toolCallId: 'tc_read', args: { path: '/home/agent/README.md' } },
        ],
        steps: [
          {
            content: [
              {
                type: 'tool-call',
                toolName: 'bash',
                toolCallId: 'tc_ls',
                input: { command: 'ls -la /home/agent' },
              },
              {
                type: 'tool-result',
                toolCallId: 'tc_ls',
                output: 'README.md\npackage.json\nsrc/',
                isError: false,
              },
            ],
          },
          {
            content: [
              {
                type: 'tool-call',
                toolName: 'readFile',
                toolCallId: 'tc_read',
                input: { path: '/home/agent/README.md' },
              },
              {
                type: 'tool-result',
                toolCallId: 'tc_read',
                output: '# My Project\nThis is a Node.js project.',
                isError: false,
              },
            ],
          },
        ],
        text: 'Here are the files in your workspace. The README says it is a Node.js project.',
      });

      const botManager = createMockBotManager({ dbStorage: storage });
      const MockSlack = createMockChannelAdapterClass();
      const sessionManager = new SessionManager(storage);

      const orchestrator = new Orchestrator({
        configPath: path.join(projectDir, 'config.json'),
        botsPath: path.join(projectDir, 'bots'),
        migrationsPath,
        logger: null,
        storage,
        botManager,
        sessionManagerFactory: () => sessionManager,
        messageRouterFactory: bm => new MessageRouter(bm),
        messageProcessorFactory: sm => new MessageProcessor(sm, agentRunner, storage),
      });

      orchestrator.registerChannelAdapter('slack', MockSlack);
      await orchestrator.start();

      const adapter = orchestrator.channels.get('slack-dev');

      // Simulate incoming message
      await adapter.messageHandler({
        type: 'slack',
        userId: 'U_DEV',
        channelId: 'C_DEV_OPS',
        text: 'Show me the project files',
        isDM: false,
      });

      // Verify response was sent back
      assert.equal(adapter.sentMessages.length, 1);
      assert.ok(adapter.sentMessages[0].text.includes('Node.js project'));

      // Verify tool calls were logged to PostgreSQL
      const { rows: toolCallRows } = await storage.query(
        'SELECT * FROM tool_calls WHERE bot_id = $1 ORDER BY id',
        ['devops-bot']
      );

      assert.equal(toolCallRows.length, 2, 'Should have logged 2 tool calls');
      assert.equal(toolCallRows[0].tool_name, 'bash');
      assert.equal(toolCallRows[1].tool_name, 'readFile');
      assert.equal(toolCallRows[0].success, true);
      assert.equal(toolCallRows[1].success, true);

      // Verify bash command params were stored
      assert.ok(toolCallRows[0].parameters);
      assert.equal(toolCallRows[0].parameters.command, 'ls -la /home/agent');

      // Verify readFile params
      assert.ok(toolCallRows[1].parameters);
      assert.equal(toolCallRows[1].parameters.path, '/home/agent/README.md');

      // Verify tool results were stored
      assert.ok(
        JSON.stringify(toolCallRows[0].result).includes('README.md'),
        'Bash tool result should contain file listing'
      );

      // Verify session has tool call info
      const session = await storage.getSession('devops-bot:slack:C_DEV_OPS:U_DEV');
      const assistantMsg = session.messages.find(m => m.role === 'assistant');
      assert.ok(assistantMsg.toolCalls, 'Assistant message should include tool calls');
      assert.equal(assistantMsg.toolCalls.length, 2);

      await orchestrator.stop();
      if (!storage.isConnected()) await storage.connect();
    });
  });

  // ===========================================================================
  // Multi-Turn Conversation E2E
  // ===========================================================================

  describe('multi-turn conversation', () => {
    test('maintains conversation context across multiple messages', async () => {
      const config = createValidConfig({
        channels: {
          'slack-main': { type: 'slack', botToken: 'xoxb-e2e-multi' },
        },
      });

      const projectDir = await createTempProject(config, {
        'chat-bot': {
          config: {
            id: 'chat-bot',
            soul: './soul.md',
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
            channel: 'slack-main',
          },
          soul: '# Chat Bot\nYou are a conversational assistant.',
        },
      });

      let callCount = 0;
      const agentRunner = {
        run: mock.fn(async (_config, _messages) => {
          callCount++;
          return {
            text: `Response #${callCount}`,
            toolCalls: [],
            usage: { promptTokens: 50 * callCount, completionTokens: 20, totalTokens: 70 },
            steps: [],
            finishReason: 'end',
          };
        }),
      };

      const botManager = createMockBotManager({ dbStorage: storage });
      const MockSlack = createMockChannelAdapterClass();
      const sessionManager = new SessionManager(storage);

      const orchestrator = new Orchestrator({
        configPath: path.join(projectDir, 'config.json'),
        botsPath: path.join(projectDir, 'bots'),
        migrationsPath,
        logger: null,
        storage,
        botManager,
        sessionManagerFactory: () => sessionManager,
        messageRouterFactory: bm => new MessageRouter(bm),
        messageProcessorFactory: sm => new MessageProcessor(sm, agentRunner, storage),
      });

      orchestrator.registerChannelAdapter('slack', MockSlack);
      await orchestrator.start();

      const adapter = orchestrator.channels.get('slack-main');

      // Turn 1: First message
      await adapter.messageHandler({
        type: 'slack',
        userId: 'U_MULTI',
        channelId: 'C_CHAT',
        text: 'Hello, who are you?',
        isDM: false,
      });

      // Turn 2: Follow-up
      await adapter.messageHandler({
        type: 'slack',
        userId: 'U_MULTI',
        channelId: 'C_CHAT',
        text: 'Tell me more about yourself.',
        isDM: false,
      });

      // Turn 3: Another follow-up
      await adapter.messageHandler({
        type: 'slack',
        userId: 'U_MULTI',
        channelId: 'C_CHAT',
        text: 'What can you do?',
        isDM: false,
      });

      // Verify all 3 responses were sent
      assert.equal(adapter.sentMessages.length, 3);
      assert.equal(adapter.sentMessages[0].text, 'Response #1');
      assert.equal(adapter.sentMessages[1].text, 'Response #2');
      assert.equal(adapter.sentMessages[2].text, 'Response #3');

      // Verify conversation context grows with each turn
      const call1Messages = agentRunner.run.mock.calls[0].arguments[1];
      const call2Messages = agentRunner.run.mock.calls[1].arguments[1];
      const call3Messages = agentRunner.run.mock.calls[2].arguments[1];

      assert.ok(
        call2Messages.length > call1Messages.length,
        'Second call should include more context'
      );
      assert.ok(
        call3Messages.length > call2Messages.length,
        'Third call should include even more context'
      );

      // Verify session in database has accumulated messages
      const session = await storage.getSession('chat-bot:slack:C_CHAT:U_MULTI');
      assert.ok(session);

      const userMessages = session.messages.filter(m => m.role === 'user');
      const assistantMessages = session.messages.filter(m => m.role === 'assistant');
      assert.equal(userMessages.length, 3);
      assert.equal(assistantMessages.length, 3);

      await orchestrator.stop();
      if (!storage.isConnected()) await storage.connect();
    });

    test('different users get isolated sessions on same channel', async () => {
      const config = createValidConfig({
        channels: {
          'slack-team': { type: 'slack', botToken: 'xoxb-e2e-team' },
        },
      });

      const projectDir = await createTempProject(config, {
        'team-bot': {
          config: {
            id: 'team-bot',
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
            channel: 'slack-team',
          },
        },
      });

      const agentRunner = createMockAgentRunner();
      const botManager = createMockBotManager({ dbStorage: storage });
      const MockSlack = createMockChannelAdapterClass();
      const sessionManager = new SessionManager(storage);

      const orchestrator = new Orchestrator({
        configPath: path.join(projectDir, 'config.json'),
        botsPath: path.join(projectDir, 'bots'),
        migrationsPath,
        logger: null,
        storage,
        botManager,
        sessionManagerFactory: () => sessionManager,
        messageRouterFactory: bm => new MessageRouter(bm),
        messageProcessorFactory: sm => new MessageProcessor(sm, agentRunner, storage),
      });

      orchestrator.registerChannelAdapter('slack', MockSlack);
      await orchestrator.start();

      const adapter = orchestrator.channels.get('slack-team');

      // Alice sends a message
      await adapter.messageHandler({
        type: 'slack',
        userId: 'U_ALICE',
        channelId: 'C_TEAM',
        text: 'Hello from Alice',
        isDM: false,
      });

      // Bob sends a message
      await adapter.messageHandler({
        type: 'slack',
        userId: 'U_BOB',
        channelId: 'C_TEAM',
        text: 'Hello from Bob',
        isDM: false,
      });

      // Verify both got responses
      assert.equal(adapter.sentMessages.length, 2);

      // Verify isolated sessions
      const aliceSession = await storage.getSession('team-bot:slack:C_TEAM:U_ALICE');
      const bobSession = await storage.getSession('team-bot:slack:C_TEAM:U_BOB');

      assert.ok(aliceSession, 'Alice should have her own session');
      assert.ok(bobSession, 'Bob should have his own session');
      assert.notEqual(aliceSession.id, bobSession.id);

      // Verify each session has only their messages
      const aliceUserMsg = aliceSession.messages.find(m => m.role === 'user');
      assert.equal(aliceUserMsg.content, 'Hello from Alice');

      const bobUserMsg = bobSession.messages.find(m => m.role === 'user');
      assert.equal(bobUserMsg.content, 'Hello from Bob');

      await orchestrator.stop();
      if (!storage.isConnected()) await storage.connect();
    });
  });

  // ===========================================================================
  // Restriction Enforcement E2E
  // ===========================================================================

  describe('restriction enforcement', () => {
    test('blocks messages from users not in allowlist', async () => {
      const config = createValidConfig({
        channels: {
          'slack-restricted': { type: 'slack', botToken: 'xoxb-e2e-restrict' },
        },
      });

      const projectDir = await createTempProject(config, {
        'restricted-bot': {
          config: {
            id: 'restricted-bot',
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
            channel: 'slack-restricted',
            restrictions: {
              allowedUsers: ['U_ADMIN', 'U_VIP'],
              dmAllowed: true,
            },
          },
        },
      });

      const agentRunner = createMockAgentRunner();
      const botManager = createMockBotManager({ dbStorage: storage });
      const MockSlack = createMockChannelAdapterClass();
      const sessionManager = new SessionManager(storage);
      const logs = [];

      const orchestrator = new Orchestrator({
        configPath: path.join(projectDir, 'config.json'),
        botsPath: path.join(projectDir, 'bots'),
        migrationsPath,
        logger: msg => logs.push(msg),
        storage,
        botManager,
        sessionManagerFactory: () => sessionManager,
        messageRouterFactory: bm => new MessageRouter(bm, { logger: msg => logs.push(msg) }),
        messageProcessorFactory: sm => new MessageProcessor(sm, agentRunner, storage),
      });

      orchestrator.registerChannelAdapter('slack', MockSlack);
      await orchestrator.start();

      const adapter = orchestrator.channels.get('slack-restricted');

      // Message from unauthorized user
      await adapter.messageHandler({
        type: 'slack',
        userId: 'U_RANDOM',
        channelId: 'C_GENERAL',
        text: 'Can I use this bot?',
        isDM: false,
      });

      // Should NOT have sent a response (message blocked)
      assert.equal(adapter.sentMessages.length, 0, 'Blocked user should get no response');

      // Agent should NOT have been called
      assert.equal(agentRunner.run.mock.calls.length, 0, 'Agent should not run for blocked user');

      // Blocking should be logged
      assert.ok(
        logs.some(l => l.includes('blocked') || l.includes('Message blocked')),
        'Should log message blocking'
      );

      // Now send from an allowed user
      await adapter.messageHandler({
        type: 'slack',
        userId: 'U_ADMIN',
        channelId: 'C_GENERAL',
        text: 'Admin here, what is up?',
        isDM: false,
      });

      // Should have sent a response for the allowed user
      assert.equal(adapter.sentMessages.length, 1, 'Allowed user should get response');
      assert.equal(agentRunner.run.mock.calls.length, 1, 'Agent should run for allowed user');

      await orchestrator.stop();
      if (!storage.isConnected()) await storage.connect();
    });

    test('blocks DMs when dmAllowed is false', async () => {
      const config = createValidConfig({
        channels: {
          'slack-nodm': { type: 'slack', botToken: 'xoxb-e2e-nodm' },
        },
      });

      const projectDir = await createTempProject(config, {
        'no-dm-bot': {
          config: {
            id: 'no-dm-bot',
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
            channel: 'slack-nodm',
            restrictions: {
              dmAllowed: false,
            },
          },
        },
      });

      const agentRunner = createMockAgentRunner();
      const botManager = createMockBotManager({ dbStorage: storage });
      const MockSlack = createMockChannelAdapterClass();
      const sessionManager = new SessionManager(storage);

      const orchestrator = new Orchestrator({
        configPath: path.join(projectDir, 'config.json'),
        botsPath: path.join(projectDir, 'bots'),
        migrationsPath,
        logger: null,
        storage,
        botManager,
        sessionManagerFactory: () => sessionManager,
        messageRouterFactory: bm => new MessageRouter(bm),
        messageProcessorFactory: sm => new MessageProcessor(sm, agentRunner, storage),
      });

      orchestrator.registerChannelAdapter('slack', MockSlack);
      await orchestrator.start();

      const adapter = orchestrator.channels.get('slack-nodm');

      // DM message
      await adapter.messageHandler({
        type: 'slack',
        userId: 'U_DM_USER',
        channelId: 'D_DM_CHANNEL',
        text: 'Hello via DM',
        isDM: true,
      });

      // Should be blocked
      assert.equal(adapter.sentMessages.length, 0, 'DM should be blocked');
      assert.equal(agentRunner.run.mock.calls.length, 0);

      // Channel message should work
      await adapter.messageHandler({
        type: 'slack',
        userId: 'U_DM_USER',
        channelId: 'C_PUBLIC',
        text: 'Hello in channel',
        isDM: false,
      });

      assert.equal(adapter.sentMessages.length, 1, 'Channel message should work');

      await orchestrator.stop();
      if (!storage.isConnected()) await storage.connect();
    });
  });

  // ===========================================================================
  // Multi-Channel / Multi-Bot E2E
  // ===========================================================================

  describe('multi-channel multi-bot', () => {
    test('routes messages to correct bot based on channel binding', async () => {
      const config = createValidConfig({
        channels: {
          'slack-support': { type: 'slack', botToken: 'xoxb-e2e-support' },
          'slack-devops': { type: 'slack', botToken: 'xoxb-e2e-devops' },
        },
      });

      const projectDir = await createTempProject(config, {
        'support-bot': {
          config: {
            id: 'support-bot',
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
            channel: 'slack-support',
          },
          soul: 'You are a support assistant.',
        },
        'devops-bot': {
          config: {
            id: 'devops-bot',
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
            channel: 'slack-devops',
          },
          soul: 'You are a DevOps assistant.',
        },
      });

      let callCount = 0;
      const agentRunner = {
        run: mock.fn(async (botConfig, _messages) => {
          callCount++;
          return {
            text: `Response from ${botConfig.id} (#${callCount})`,
            toolCalls: [],
            usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
            steps: [],
            finishReason: 'end',
          };
        }),
      };

      const botManager = createMockBotManager({ dbStorage: storage });
      const MockSlack = createMockChannelAdapterClass();
      const sessionManager = new SessionManager(storage);

      const orchestrator = new Orchestrator({
        configPath: path.join(projectDir, 'config.json'),
        botsPath: path.join(projectDir, 'bots'),
        migrationsPath,
        logger: null,
        storage,
        botManager,
        sessionManagerFactory: () => sessionManager,
        messageRouterFactory: bm => new MessageRouter(bm),
        messageProcessorFactory: sm => new MessageProcessor(sm, agentRunner, storage),
      });

      orchestrator.registerChannelAdapter('slack', MockSlack);
      await orchestrator.start();

      // Verify 2 channels initialized
      assert.equal(orchestrator.channels.size, 2);

      const supportAdapter = orchestrator.channels.get('slack-support');
      const devopsAdapter = orchestrator.channels.get('slack-devops');

      // Send message on support channel
      await supportAdapter.messageHandler({
        type: 'slack',
        userId: 'U_USER1',
        channelId: 'C_SUPPORT',
        text: 'I need help with billing',
        isDM: false,
      });

      // Send message on devops channel
      await devopsAdapter.messageHandler({
        type: 'slack',
        userId: 'U_USER1',
        channelId: 'C_DEVOPS',
        text: 'Deploy to production',
        isDM: false,
      });

      // Verify each channel got its own response
      assert.equal(supportAdapter.sentMessages.length, 1);
      assert.ok(supportAdapter.sentMessages[0].text.includes('support-bot'));

      assert.equal(devopsAdapter.sentMessages.length, 1);
      assert.ok(devopsAdapter.sentMessages[0].text.includes('devops-bot'));

      // Verify different sessions were created
      const supportSession = await storage.getSession('support-bot:slack:C_SUPPORT:U_USER1');
      const devopsSession = await storage.getSession('devops-bot:slack:C_DEVOPS:U_USER1');

      assert.ok(supportSession);
      assert.ok(devopsSession);
      assert.notEqual(supportSession.id, devopsSession.id);

      await orchestrator.stop();
      if (!storage.isConnected()) await storage.connect();
    });

    test('message to unbound channel is silently dropped', async () => {
      const config = createValidConfig({
        channels: {
          'slack-main': { type: 'slack', botToken: 'xoxb-e2e-unbound' },
        },
      });

      // Bot binds to a different channel than what is configured
      const projectDir = await createTempProject(config, {
        'mismatched-bot': {
          config: {
            id: 'mismatched-bot',
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
            channel: 'some-other-channel',
          },
        },
      });

      const agentRunner = createMockAgentRunner();
      const botManager = createMockBotManager({ dbStorage: storage });
      const MockSlack = createMockChannelAdapterClass();
      const sessionManager = new SessionManager(storage);
      const logs = [];

      const orchestrator = new Orchestrator({
        configPath: path.join(projectDir, 'config.json'),
        botsPath: path.join(projectDir, 'bots'),
        migrationsPath,
        logger: msg => logs.push(msg),
        storage,
        botManager,
        sessionManagerFactory: () => sessionManager,
        messageRouterFactory: bm => new MessageRouter(bm, { logger: msg => logs.push(msg) }),
        messageProcessorFactory: sm => new MessageProcessor(sm, agentRunner, storage),
      });

      orchestrator.registerChannelAdapter('slack', MockSlack);
      await orchestrator.start();

      const adapter = orchestrator.channels.get('slack-main');

      // Message arrives on slack-main, but no bot is bound to it
      await adapter.messageHandler({
        type: 'slack',
        userId: 'U_ORPHAN',
        channelId: 'C_ORPHAN',
        text: 'Is anyone there?',
        isDM: false,
      });

      // No response should be sent
      assert.equal(adapter.sentMessages.length, 0);
      assert.equal(agentRunner.run.mock.calls.length, 0);

      // Should be logged
      assert.ok(
        logs.some(l => l.includes('no matching bot') || l.includes('No bot found')),
        'Should log that no bot was found for channel'
      );

      await orchestrator.stop();
      if (!storage.isConnected()) await storage.connect();
    });
  });

  // ===========================================================================
  // Reload E2E
  // ===========================================================================

  describe('hot reload during operation', () => {
    test('reload updates bot config while preserving active sessions', async () => {
      const config = createValidConfig({
        channels: {
          'slack-main': { type: 'slack', botToken: 'xoxb-e2e-reload' },
        },
        bots: {
          'reload-bot': {
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
            channel: 'slack-main',
          },
        },
      });

      const projectDir = await createTempProject(config);

      const agentRunner = createMockAgentRunner();
      const botManager = createMockBotManager({ dbStorage: storage });
      const MockSlack = createMockChannelAdapterClass();
      const sessionManager = new SessionManager(storage);

      const orchestrator = new Orchestrator({
        configPath: path.join(projectDir, 'config.json'),
        botsPath: path.join(projectDir, 'bots'),
        migrationsPath,
        logger: null,
        storage,
        botManager,
        sessionManagerFactory: () => sessionManager,
        messageRouterFactory: bm => new MessageRouter(bm),
        messageProcessorFactory: sm => new MessageProcessor(sm, agentRunner, storage),
      });

      orchestrator.registerChannelAdapter('slack', MockSlack);
      await orchestrator.start();

      // Send a message before reload to create a session
      const adapter = orchestrator.channels.get('slack-main');
      await adapter.messageHandler({
        type: 'slack',
        userId: 'U_RELOAD',
        channelId: 'C_RELOAD',
        text: 'Before reload',
        isDM: false,
      });

      assert.equal(adapter.sentMessages.length, 1);

      // Reload config
      const results = await orchestrator.reload();
      assert.ok(results.reloaded.length >= 1);
      assert.equal(results.failed.length, 0);

      // Send another message after reload - session should persist
      await adapter.messageHandler({
        type: 'slack',
        userId: 'U_RELOAD',
        channelId: 'C_RELOAD',
        text: 'After reload',
        isDM: false,
      });

      assert.equal(adapter.sentMessages.length, 2);

      // Session should have both messages (pre and post reload)
      const session = await storage.getSession('reload-bot:slack:C_RELOAD:U_RELOAD');
      assert.ok(session);
      const userMsgs = session.messages.filter(m => m.role === 'user');
      assert.equal(userMsgs.length, 2);
      assert.equal(userMsgs[0].content, 'Before reload');
      assert.equal(userMsgs[1].content, 'After reload');

      await orchestrator.stop();
      if (!storage.isConnected()) await storage.connect();
    });
  });

  // ===========================================================================
  // Error Handling E2E
  // ===========================================================================

  describe('error handling', () => {
    test('agent failure does not crash orchestrator or channel', async () => {
      const config = createValidConfig({
        channels: {
          'slack-err': { type: 'slack', botToken: 'xoxb-e2e-err' },
        },
      });

      const projectDir = await createTempProject(config, {
        'error-bot': {
          config: {
            id: 'error-bot',
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
            channel: 'slack-err',
          },
        },
      });

      let callCount = 0;
      const agentRunner = {
        run: mock.fn(async () => {
          callCount++;
          if (callCount === 1) {
            throw new Error('API rate limit exceeded');
          }
          return {
            text: 'Recovery response',
            toolCalls: [],
            usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
            steps: [],
            finishReason: 'end',
          };
        }),
      };

      const botManager = createMockBotManager({ dbStorage: storage });
      const MockSlack = createMockChannelAdapterClass();
      const sessionManager = new SessionManager(storage);
      const logs = [];

      const orchestrator = new Orchestrator({
        configPath: path.join(projectDir, 'config.json'),
        botsPath: path.join(projectDir, 'bots'),
        migrationsPath,
        logger: msg => logs.push(msg),
        storage,
        botManager,
        sessionManagerFactory: () => sessionManager,
        messageRouterFactory: bm => new MessageRouter(bm),
        messageProcessorFactory: sm => new MessageProcessor(sm, agentRunner, storage),
      });

      orchestrator.registerChannelAdapter('slack', MockSlack);
      await orchestrator.start();

      const adapter = orchestrator.channels.get('slack-err');

      // First message triggers agent error
      await adapter.messageHandler({
        type: 'slack',
        userId: 'U_ERR',
        channelId: 'C_ERR',
        text: 'This will fail',
        isDM: false,
      });

      // No response should be sent on error
      assert.equal(adapter.sentMessages.length, 0);

      // Error should be logged
      assert.ok(
        logs.some(l => l.includes('Error handling message')),
        'Should log error handling message'
      );

      // Orchestrator should still be running
      assert.equal(orchestrator.getState(), 'running');

      // Second message should succeed (orchestrator recovered)
      await adapter.messageHandler({
        type: 'slack',
        userId: 'U_ERR',
        channelId: 'C_ERR',
        text: 'This should work',
        isDM: false,
      });

      assert.equal(adapter.sentMessages.length, 1);
      assert.equal(adapter.sentMessages[0].text, 'Recovery response');

      await orchestrator.stop();
      if (!storage.isConnected()) await storage.connect();
    });

    test('failed tool call logging does not prevent response', async () => {
      const config = createValidConfig({
        channels: {
          'slack-toolerr': { type: 'slack', botToken: 'xoxb-e2e-toolerr' },
        },
      });

      const projectDir = await createTempProject(config, {
        'toolerr-bot': {
          config: {
            id: 'toolerr-bot',
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
            channel: 'slack-toolerr',
          },
        },
      });

      const agentRunner = createMockAgentRunnerWithTools({
        toolCalls: [{ toolName: 'bash', toolCallId: 'tc_fail', args: { command: 'cat /missing' } }],
        steps: [
          {
            toolCalls: [
              { toolName: 'bash', toolCallId: 'tc_fail', args: { command: 'cat /missing' } },
            ],
            toolResults: [
              {
                toolCallId: 'tc_fail',
                result: 'Error: No such file or directory',
                isError: true,
              },
            ],
          },
        ],
        text: 'The file was not found.',
      });

      const botManager = createMockBotManager({ dbStorage: storage });
      const MockSlack = createMockChannelAdapterClass();
      const sessionManager = new SessionManager(storage);

      const orchestrator = new Orchestrator({
        configPath: path.join(projectDir, 'config.json'),
        botsPath: path.join(projectDir, 'bots'),
        migrationsPath,
        logger: null,
        storage,
        botManager,
        sessionManagerFactory: () => sessionManager,
        messageRouterFactory: bm => new MessageRouter(bm),
        messageProcessorFactory: sm => new MessageProcessor(sm, agentRunner, storage),
      });

      orchestrator.registerChannelAdapter('slack', MockSlack);
      await orchestrator.start();

      const adapter = orchestrator.channels.get('slack-toolerr');

      await adapter.messageHandler({
        type: 'slack',
        userId: 'U_TOOL_ERR',
        channelId: 'C_TOOL_ERR',
        text: 'Read a missing file',
        isDM: false,
      });

      // Response should still be sent
      assert.equal(adapter.sentMessages.length, 1);
      assert.equal(adapter.sentMessages[0].text, 'The file was not found.');

      // Tool call should be logged as failed
      const { rows } = await storage.query('SELECT * FROM tool_calls WHERE bot_id = $1', [
        'toolerr-bot',
      ]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].success, false);
      assert.ok(rows[0].error);
      assert.match(rows[0].error, /No such file or directory/);

      await orchestrator.stop();
      if (!storage.isConnected()) await storage.connect();
    });
  });

  // ===========================================================================
  // Thread Support (Slack threadTs)
  // ===========================================================================

  describe('Slack thread support', () => {
    test('forwards threadTs in response for threaded conversations', async () => {
      const config = createValidConfig({
        channels: {
          'slack-threads': { type: 'slack', botToken: 'xoxb-e2e-threads' },
        },
      });

      const projectDir = await createTempProject(config, {
        'thread-bot': {
          config: {
            id: 'thread-bot',
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
            channel: 'slack-threads',
          },
        },
      });

      const agentRunner = createMockAgentRunner({
        text: 'Reply in thread.',
        toolCalls: [],
        usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
        steps: [],
        finishReason: 'end',
      });

      const botManager = createMockBotManager({ dbStorage: storage });
      const MockSlack = createMockChannelAdapterClass();
      const sessionManager = new SessionManager(storage);

      const orchestrator = new Orchestrator({
        configPath: path.join(projectDir, 'config.json'),
        botsPath: path.join(projectDir, 'bots'),
        migrationsPath,
        logger: null,
        storage,
        botManager,
        sessionManagerFactory: () => sessionManager,
        messageRouterFactory: bm => new MessageRouter(bm),
        messageProcessorFactory: sm => new MessageProcessor(sm, agentRunner, storage),
      });

      orchestrator.registerChannelAdapter('slack', MockSlack);
      await orchestrator.start();

      const adapter = orchestrator.channels.get('slack-threads');

      // Simulate a threaded message
      await adapter.messageHandler({
        type: 'slack',
        userId: 'U_THREAD',
        channelId: 'C_THREADS',
        text: 'Thread message here',
        isDM: false,
        threadTs: '1234567890.123456',
      });

      // Response should include threadTs
      assert.equal(adapter.sentMessages.length, 1);
      assert.equal(adapter.sentMessages[0].threadTs, '1234567890.123456');
      assert.equal(adapter.sentMessages[0].text, 'Reply in thread.');

      await orchestrator.stop();
      if (!storage.isConnected()) await storage.connect();
    });
  });

  // ===========================================================================
  // Full Lifecycle E2E
  // ===========================================================================

  describe('full lifecycle', () => {
    test('start -> process messages -> reload -> process more -> stop', async () => {
      const config = createValidConfig({
        channels: {
          'slack-lifecycle': { type: 'slack', botToken: 'xoxb-lifecycle' },
        },
        bots: {
          'lifecycle-bot': {
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
            channel: 'slack-lifecycle',
          },
        },
      });

      const projectDir = await createTempProject(config);

      let responseNum = 0;
      const agentRunner = {
        run: mock.fn(async () => {
          responseNum++;
          return {
            text: `Lifecycle response #${responseNum}`,
            toolCalls: [],
            usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
            steps: [],
            finishReason: 'end',
          };
        }),
      };

      const botManager = createMockBotManager({ dbStorage: storage });
      const MockSlack = createMockChannelAdapterClass();
      const sessionManager = new SessionManager(storage);
      const logs = [];

      const orchestrator = new Orchestrator({
        configPath: path.join(projectDir, 'config.json'),
        botsPath: path.join(projectDir, 'bots'),
        migrationsPath,
        logger: msg => logs.push(msg),
        storage,
        botManager,
        sessionManagerFactory: () => sessionManager,
        messageRouterFactory: bm => new MessageRouter(bm),
        messageProcessorFactory: sm => new MessageProcessor(sm, agentRunner, storage),
      });

      orchestrator.registerChannelAdapter('slack', MockSlack);

      // === Phase 1: Startup ===
      await orchestrator.start();
      assert.equal(orchestrator.getState(), 'running');
      assert.ok(logs.some(l => l.includes('Starting')));

      const adapter = orchestrator.channels.get('slack-lifecycle');

      // === Phase 2: Process messages ===
      await adapter.messageHandler({
        type: 'slack',
        userId: 'U_LIFECYCLE',
        channelId: 'C_LIFECYCLE',
        text: 'Phase 2 message',
        isDM: false,
      });
      assert.equal(adapter.sentMessages.length, 1);

      // === Phase 3: Hot reload ===
      const reloadResults = await orchestrator.reload();
      assert.ok(reloadResults);
      assert.equal(orchestrator.getState(), 'running');

      // === Phase 4: Process more messages after reload ===
      await adapter.messageHandler({
        type: 'slack',
        userId: 'U_LIFECYCLE',
        channelId: 'C_LIFECYCLE',
        text: 'Phase 4 message after reload',
        isDM: false,
      });
      assert.equal(adapter.sentMessages.length, 2);
      assert.equal(adapter.sentMessages[1].text, 'Lifecycle response #2');

      // === Phase 5: Verify accumulated state ===
      const session = await storage.getSession('lifecycle-bot:slack:C_LIFECYCLE:U_LIFECYCLE');
      assert.ok(session);
      assert.equal(session.messages.filter(m => m.role === 'user').length, 2);
      assert.equal(session.messages.filter(m => m.role === 'assistant').length, 2);
      assert.ok(session.tokenCount > 0);

      // === Phase 6: Graceful shutdown ===
      await orchestrator.stop();
      assert.equal(orchestrator.getState(), 'stopped');
      assert.ok(logs.some(l => l.includes('Stopping')));

      if (!storage.isConnected()) await storage.connect();
    });

    test('getStatus reflects accurate state at each phase', async () => {
      const config = createValidConfig({
        channels: {
          'slack-status': { type: 'slack', botToken: 'xoxb-status' },
        },
        bots: {
          'status-bot': {
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
            channel: 'slack-status',
          },
        },
      });

      const projectDir = await createTempProject(config);

      const agentRunner = createMockAgentRunner();
      const botManager = createMockBotManager({ dbStorage: storage });
      const MockSlack = createMockChannelAdapterClass();
      const sessionManager = new SessionManager(storage);

      const orchestrator = new Orchestrator({
        configPath: path.join(projectDir, 'config.json'),
        botsPath: path.join(projectDir, 'bots'),
        migrationsPath,
        logger: null,
        storage,
        botManager,
        sessionManagerFactory: () => sessionManager,
        messageRouterFactory: bm => new MessageRouter(bm),
        messageProcessorFactory: sm => new MessageProcessor(sm, agentRunner, storage),
      });

      orchestrator.registerChannelAdapter('slack', MockSlack);

      // Before start
      const statusBefore = orchestrator.getStatus();
      assert.equal(statusBefore.state, 'created');
      assert.equal(statusBefore.uptime, 0);

      // After start
      await orchestrator.start();
      const statusRunning = orchestrator.getStatus();
      assert.equal(statusRunning.state, 'running');
      assert.ok(statusRunning.startedAt instanceof Date);
      assert.ok(statusRunning.uptime >= 0);
      assert.equal(statusRunning.databaseConnected, true);
      assert.equal(statusRunning.channelCount, 1);
      assert.equal(statusRunning.messageProcessorReady, true);
      assert.equal(statusRunning.messageRouterReady, true);
      assert.equal(typeof statusRunning.botCount, 'number');

      // After stop
      await orchestrator.stop();
      const statusStopped = orchestrator.getStatus();
      assert.equal(statusStopped.state, 'stopped');

      if (!storage.isConnected()) await storage.connect();
    });
  });
});
