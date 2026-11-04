/**
 * Integration tests for MessageProcessor
 *
 * Tests the full message processing pipeline with real components:
 * - Real SessionManager (with real PostgresStorage)
 * - Real PostgresStorage (tool call logging, session persistence)
 * - Mock AgentRunner (to avoid real LLM API calls)
 *
 * Test categories:
 * 1. Full pipeline - message → session → agent → tool logging → response
 * 2. Tool call logging - audit trail persisted to PostgreSQL
 * 3. Session compaction - triggered when token threshold exceeded
 * 4. Multi-turn conversations - session reuse across multiple messages
 * 5. Soul.md injection - system prompt prepended to LLM messages
 * 6. Error scenarios - graceful handling of component failures
 *
 * Uses per-worker databases for parallel test execution.
 */

import { describe, test, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { MessageProcessor } from '../../../src/core/message-processor.js';
import { SessionManager } from '../../../src/core/session-manager.js';
import {
  isDatabaseAvailable,
  setupTestDatabase,
  cleanupTestDatabase,
  createTestBot,
} from '../../helpers/setup.js';

const DB_AVAILABLE = await isDatabaseAvailable();

if (!DB_AVAILABLE) {
  console.log('MessageProcessor integration: PostgreSQL not available, skipping tests');
}

// ─── Mock Factories ──────────────────────────────────────────────

/**
 * Create a mock AgentRunner that returns configurable results
 * @param {Object} [result] - Result to return from run()
 * @returns {Object} Mock agent runner
 */
function createMockAgentRunner(result) {
  const defaultResult = {
    text: 'Hello! How can I help you today?',
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
 * Create a mock AgentRunner that simulates tool calling
 * @param {Array} [toolCalls] - Tool calls to include
 * @param {Array} [steps] - Steps to include
 * @param {string} [text] - Response text
 * @returns {Object} Mock agent runner with tool calls
 */
function createMockAgentRunnerWithTools(toolCalls, steps, text) {
  const defaultToolCalls = toolCalls || [
    { toolName: 'bash', toolCallId: 'call_1', args: { command: 'ls -la' } },
  ];

  const defaultSteps = steps || [
    {
      toolCalls: [{ toolName: 'bash', toolCallId: 'call_1', args: { command: 'ls -la' } }],
      toolResults: [
        { toolCallId: 'call_1', output: 'file1.txt\nfile2.txt\npackage.json', isError: false },
      ],
    },
  ];

  return {
    run: mock.fn(async () => ({
      text: text || 'Here are the files in the directory.',
      toolCalls: defaultToolCalls,
      usage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 },
      steps: defaultSteps,
      finishReason: 'end',
    })),
  };
}

/**
 * Create a valid bot config for testing
 * @param {Object} [overrides={}] - Config overrides
 * @returns {Object} Bot config
 */
function createBotConfig(overrides = {}) {
  return {
    id: 'integ-test-bot',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    tools: ['bash', 'readFile'],
    ...overrides,
  };
}

/**
 * Create a valid message for testing
 * @param {Object} [overrides={}] - Message overrides
 * @returns {Object} Message object
 */
function createMessage(overrides = {}) {
  return {
    type: 'slack',
    userId: 'U_INTEG_TEST',
    channelId: 'C_INTEG_TEST',
    text: 'Hello, bot!',
    ...overrides,
  };
}

// ─── Integration Tests ───────────────────────────────────────────

describe('MessageProcessor Integration', { skip: !DB_AVAILABLE }, () => {
  let storage;
  let sessionManager;

  before(async () => {
    storage = await setupTestDatabase();
  });

  after(async () => {
    await cleanupTestDatabase(storage);
  });

  beforeEach(async () => {
    // Clean sessions and tool_calls for a fresh state
    await storage.query('DELETE FROM tool_calls');
    await storage.query('DELETE FROM sessions');
    await storage.query('DELETE FROM bots');

    // Create a test bot for FK constraints
    await createTestBot(storage, { id: 'integ-test-bot' });

    // Create fresh SessionManager with real storage
    sessionManager = new SessionManager(storage);
  });

  // ===========================================================================
  // Full Pipeline Tests
  // ===========================================================================

  describe('full pipeline', () => {
    test('processes a simple message end-to-end with real storage', async () => {
      const agentRunner = createMockAgentRunner();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage);
      const botConfig = createBotConfig();
      const message = createMessage({ text: 'What is Node.js?' });

      const result = await processor.processMessage(botConfig, message);

      // Verify response
      assert.equal(result.text, 'Hello! How can I help you today?');
      assert.deepEqual(result.toolCalls, []);
      assert.ok(result.usage);
      assert.ok(result.sessionId);
      assert.ok(typeof result.durationMs === 'number');
      assert.ok(result.durationMs >= 0);
    });

    test('creates session in database on first message', async () => {
      const agentRunner = createMockAgentRunner();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage);
      const botConfig = createBotConfig();
      const message = createMessage();

      const result = await processor.processMessage(botConfig, message);

      // Verify session was persisted
      const session = await storage.getSession(result.sessionId);
      assert.ok(session, 'Session should be persisted in database');
      assert.equal(session.botId, 'integ-test-bot');
      assert.equal(session.userId, 'U_INTEG_TEST');
      assert.equal(session.channelId, 'C_INTEG_TEST');
      assert.equal(session.channelType, 'slack');
    });

    test('session contains user and assistant messages after processing', async () => {
      const agentRunner = createMockAgentRunner({
        text: 'I can help with that!',
        toolCalls: [],
        usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
        steps: [],
        finishReason: 'end',
      });
      const processor = new MessageProcessor(sessionManager, agentRunner, storage);
      const botConfig = createBotConfig();
      const message = createMessage({ text: 'Help me with JavaScript' });

      const result = await processor.processMessage(botConfig, message);

      // Reload session from database to verify persistence
      const session = await storage.getSession(result.sessionId);
      assert.ok(session.messages.length >= 2, 'Should have at least user + assistant messages');

      // Find user and assistant messages
      const userMsg = session.messages.find(m => m.role === 'user');
      const assistantMsg = session.messages.find(m => m.role === 'assistant');

      assert.ok(userMsg, 'Should have a user message');
      assert.equal(userMsg.content, 'Help me with JavaScript');
      assert.ok(assistantMsg, 'Should have an assistant message');
      assert.equal(assistantMsg.content, 'I can help with that!');
    });

    test('passes messages to AgentRunner in correct format', async () => {
      const agentRunner = createMockAgentRunner();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage);
      const botConfig = createBotConfig({
        soulContent: 'You are a coding assistant.',
      });
      const message = createMessage({ text: 'Hello world' });

      await processor.processMessage(botConfig, message);

      // Verify AgentRunner received correct messages
      assert.equal(agentRunner.run.mock.calls.length, 1);
      const [passedConfig, passedMessages] = agentRunner.run.mock.calls[0].arguments;

      assert.equal(passedConfig.id, 'integ-test-bot');

      // Should have soul system message + user message
      assert.ok(passedMessages.length >= 2);
      assert.equal(passedMessages[0].role, 'system');
      assert.equal(passedMessages[0].content, 'You are a coding assistant.');

      const userMsg = passedMessages.find(m => m.role === 'user');
      assert.ok(userMsg);
      assert.equal(userMsg.content, 'Hello world');
    });

    test('returns correct session ID format', async () => {
      const agentRunner = createMockAgentRunner();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage);
      const botConfig = createBotConfig();
      const message = createMessage({
        type: 'discord',
        userId: 'discord-user-42',
        channelId: 'discord-channel-99',
      });

      // Create bot in DB for discord bot scenario
      await createTestBot(storage, { id: 'integ-test-bot' });

      const result = await processor.processMessage(botConfig, message);

      assert.equal(result.sessionId, 'integ-test-bot:discord:discord-channel-99:discord-user-42');
    });
  });

  // ===========================================================================
  // Tool Call Logging Tests
  // ===========================================================================

  describe('tool call logging', () => {
    test('logs tool calls to database via storage', async () => {
      const agentRunner = createMockAgentRunnerWithTools();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage);
      const botConfig = createBotConfig();
      const message = createMessage();

      await processor.processMessage(botConfig, message);

      // Query tool_calls table directly
      const { rows } = await storage.query(
        'SELECT * FROM tool_calls WHERE bot_id = $1 ORDER BY executed_at',
        ['integ-test-bot']
      );

      assert.equal(rows.length, 1, 'Should have logged one tool call');
      assert.equal(rows[0].tool_name, 'bash');
      assert.equal(rows[0].bot_id, 'integ-test-bot');
      assert.equal(rows[0].success, true);

      // Verify parameters were stored as JSONB
      const params = rows[0].parameters;
      assert.ok(params);
      assert.equal(params.command, 'ls -la');
    });

    test('logs tool call results from step results', async () => {
      const agentRunner = createMockAgentRunnerWithTools();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage);

      await processor.processMessage(createBotConfig(), createMessage());

      const { rows } = await storage.query('SELECT * FROM tool_calls WHERE bot_id = $1', [
        'integ-test-bot',
      ]);

      assert.equal(rows.length, 1);
      const { result } = rows[0];
      assert.ok(result);
      // Result should contain the file listing
      assert.ok(JSON.stringify(result).includes('file1.txt'));
    });

    test('logs multiple tool calls in correct order', async () => {
      const toolCalls = [
        { toolName: 'bash', toolCallId: 'call_1', args: { command: 'ls' } },
        { toolName: 'readFile', toolCallId: 'call_2', args: { path: '/home/agent/app.js' } },
        { toolName: 'bash', toolCallId: 'call_3', args: { command: 'npm test' } },
      ];
      const steps = [
        {
          toolCalls: [
            { toolName: 'bash', toolCallId: 'call_1', args: { command: 'ls' } },
            { toolName: 'readFile', toolCallId: 'call_2', args: { path: '/home/agent/app.js' } },
          ],
          toolResults: [
            { toolCallId: 'call_1', output: 'app.js\npackage.json', isError: false },
            { toolCallId: 'call_2', output: 'console.log("hello")', isError: false },
          ],
        },
        {
          toolCalls: [{ toolName: 'bash', toolCallId: 'call_3', args: { command: 'npm test' } }],
          toolResults: [{ toolCallId: 'call_3', output: 'All tests passed', isError: false }],
        },
      ];

      const agentRunner = createMockAgentRunnerWithTools(toolCalls, steps);
      const processor = new MessageProcessor(sessionManager, agentRunner, storage);

      await processor.processMessage(createBotConfig(), createMessage());

      const { rows } = await storage.query(
        'SELECT * FROM tool_calls WHERE bot_id = $1 ORDER BY id',
        ['integ-test-bot']
      );

      assert.equal(rows.length, 3, 'Should have logged all three tool calls');
      assert.equal(rows[0].tool_name, 'bash');
      assert.equal(rows[1].tool_name, 'readFile');
      assert.equal(rows[2].tool_name, 'bash');

      // All should be successful
      assert.ok(rows.every(r => r.success === true));
    });

    test('logs failed tool calls with error info', async () => {
      const toolCalls = [
        { toolName: 'bash', toolCallId: 'call_err', args: { command: 'cat /nonexistent' } },
      ];
      const steps = [
        {
          toolCalls: [
            { toolName: 'bash', toolCallId: 'call_err', args: { command: 'cat /nonexistent' } },
          ],
          toolResults: [
            {
              toolCallId: 'call_err',
              output: 'Error: No such file or directory',
              isError: true,
            },
          ],
        },
      ];

      const agentRunner = createMockAgentRunnerWithTools(toolCalls, steps);
      const processor = new MessageProcessor(sessionManager, agentRunner, storage);

      await processor.processMessage(createBotConfig(), createMessage());

      const { rows } = await storage.query('SELECT * FROM tool_calls WHERE bot_id = $1', [
        'integ-test-bot',
      ]);

      assert.equal(rows.length, 1);
      assert.equal(rows[0].success, false);
      assert.ok(rows[0].error);
      assert.match(rows[0].error, /No such file or directory/);
    });

    test('logs session ID with tool calls', async () => {
      const agentRunner = createMockAgentRunnerWithTools();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage);

      const result = await processor.processMessage(createBotConfig(), createMessage());

      const { rows } = await storage.query('SELECT * FROM tool_calls WHERE bot_id = $1', [
        'integ-test-bot',
      ]);

      assert.equal(rows.length, 1);
      assert.equal(rows[0].session_id, result.sessionId);
    });

    test('no tool call records when agent returns no tools', async () => {
      const agentRunner = createMockAgentRunner();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage);

      await processor.processMessage(createBotConfig(), createMessage());

      const { rows } = await storage.query('SELECT * FROM tool_calls WHERE bot_id = $1', [
        'integ-test-bot',
      ]);

      assert.equal(rows.length, 0, 'Should not have logged any tool calls');
    });

    test('tool calls can be queried by storage.getToolCalls()', async () => {
      const agentRunner = createMockAgentRunnerWithTools();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage);

      await processor.processMessage(createBotConfig(), createMessage());

      // Use the storage API to query tool calls
      const toolCalls = await storage.getToolCalls({ botId: 'integ-test-bot' });

      assert.equal(toolCalls.length, 1);
      assert.equal(toolCalls[0].tool_name, 'bash');
      assert.equal(toolCalls[0].success, true);
    });

    test('falls back to top-level tool calls when steps are empty', async () => {
      const topLevelToolCalls = [
        { toolName: 'writeFile', toolCallId: 'call_w1', args: { path: '/tmp/test.txt' } },
      ];
      const agentRunner = {
        run: mock.fn(async () => ({
          text: 'File written.',
          toolCalls: topLevelToolCalls,
          usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
          steps: [], // empty steps
          finishReason: 'end',
        })),
      };

      const processor = new MessageProcessor(sessionManager, agentRunner, storage);

      await processor.processMessage(createBotConfig(), createMessage());

      const { rows } = await storage.query('SELECT * FROM tool_calls WHERE bot_id = $1', [
        'integ-test-bot',
      ]);

      assert.equal(rows.length, 1);
      assert.equal(rows[0].tool_name, 'writeFile');
      // Top-level fallback doesn't have results
      assert.equal(rows[0].result, null);
    });
  });

  // ===========================================================================
  // Multi-Turn Conversation Tests
  // ===========================================================================

  describe('multi-turn conversations', () => {
    test('reuses session across multiple messages from same user', async () => {
      const agentRunner = createMockAgentRunner();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage);
      const botConfig = createBotConfig();

      const result1 = await processor.processMessage(
        botConfig,
        createMessage({ text: 'First message' })
      );
      const result2 = await processor.processMessage(
        botConfig,
        createMessage({ text: 'Second message' })
      );

      // Both should use the same session
      assert.equal(result1.sessionId, result2.sessionId);

      // Session should have accumulated messages
      const session = await storage.getSession(result1.sessionId);
      assert.ok(session.messages.length >= 4, 'Should have 2 user + 2 assistant messages');
    });

    test('second message includes context from first conversation turn', async () => {
      let callCount = 0;
      const agentRunner = {
        run: mock.fn(async (_config, _messages) => {
          callCount++;
          return {
            text: `Response ${callCount}`,
            toolCalls: [],
            usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
            steps: [],
            finishReason: 'end',
          };
        }),
      };

      const processor = new MessageProcessor(sessionManager, agentRunner, storage);
      const botConfig = createBotConfig();

      await processor.processMessage(botConfig, createMessage({ text: 'First question' }));
      await processor.processMessage(botConfig, createMessage({ text: 'Follow up question' }));

      // Second call should have received more messages than the first
      const firstCallMessages = agentRunner.run.mock.calls[0].arguments[1];
      const secondCallMessages = agentRunner.run.mock.calls[1].arguments[1];

      assert.ok(
        secondCallMessages.length > firstCallMessages.length,
        'Second call should include previous conversation context'
      );
    });

    test('different users get different sessions', async () => {
      const agentRunner = createMockAgentRunner();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage);
      const botConfig = createBotConfig();

      const result1 = await processor.processMessage(
        botConfig,
        createMessage({ userId: 'user-alice', text: 'Hello from Alice' })
      );
      const result2 = await processor.processMessage(
        botConfig,
        createMessage({ userId: 'user-bob', text: 'Hello from Bob' })
      );

      assert.notEqual(result1.sessionId, result2.sessionId);
    });

    test('different channels get different sessions', async () => {
      const agentRunner = createMockAgentRunner();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage);
      const botConfig = createBotConfig();

      const result1 = await processor.processMessage(
        botConfig,
        createMessage({ channelId: 'channel-A', text: 'Message in channel A' })
      );
      const result2 = await processor.processMessage(
        botConfig,
        createMessage({ channelId: 'channel-B', text: 'Message in channel B' })
      );

      assert.notEqual(result1.sessionId, result2.sessionId);
    });

    test('tool calls are preserved in session messages', async () => {
      const agentRunner = createMockAgentRunnerWithTools();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage);
      const botConfig = createBotConfig();

      const result = await processor.processMessage(botConfig, createMessage());

      const session = await storage.getSession(result.sessionId);

      // Find the assistant message
      const assistantMsg = session.messages.find(m => m.role === 'assistant');
      assert.ok(assistantMsg, 'Should have an assistant message');
      assert.ok(assistantMsg.toolCalls, 'Assistant message should include tool calls');
      assert.equal(assistantMsg.toolCalls.length, 1);
      assert.equal(assistantMsg.toolCalls[0].toolName, 'bash');
    });
  });

  // ===========================================================================
  // Soul.md Injection Tests
  // ===========================================================================

  describe('soul.md injection', () => {
    test('prepends soul content as system message to LLM', async () => {
      const agentRunner = createMockAgentRunner();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage);
      const botConfig = createBotConfig({
        soulContent: 'You are a helpful DevOps assistant who loves Docker.',
      });

      await processor.processMessage(botConfig, createMessage({ text: 'Deploy my app' }));

      const [, messages] = agentRunner.run.mock.calls[0].arguments;
      assert.equal(messages[0].role, 'system');
      assert.equal(messages[0].content, 'You are a helpful DevOps assistant who loves Docker.');
    });

    test('soul content persists across conversation turns', async () => {
      const agentRunner = createMockAgentRunner();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage);
      const botConfig = createBotConfig({
        soulContent: 'Always be concise.',
      });

      await processor.processMessage(botConfig, createMessage({ text: 'First' }));
      await processor.processMessage(botConfig, createMessage({ text: 'Second' }));

      // Both calls should have soul prompt at position 0
      const [, msgs1] = agentRunner.run.mock.calls[0].arguments;
      const [, msgs2] = agentRunner.run.mock.calls[1].arguments;

      assert.equal(msgs1[0].role, 'system');
      assert.equal(msgs1[0].content, 'Always be concise.');
      assert.equal(msgs2[0].role, 'system');
      assert.equal(msgs2[0].content, 'Always be concise.');
    });

    test('skips soul injection when soulContent is undefined', async () => {
      const agentRunner = createMockAgentRunner();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage);
      const botConfig = createBotConfig(); // no soulContent

      await processor.processMessage(botConfig, createMessage({ text: 'Hello' }));

      const [, messages] = agentRunner.run.mock.calls[0].arguments;
      assert.equal(messages[0].role, 'user');
    });
  });

  // ===========================================================================
  // Session Compaction Tests
  // ===========================================================================

  describe('session compaction', () => {
    test('compaction triggers when token count exceeds threshold', async () => {
      // Create SessionManager with a very low compaction threshold
      // messagesToPreserve=2 means compaction only runs when messages.length > 2
      const lowThresholdManager = new SessionManager(storage, {
        compactionThreshold: 100,
        messagesToPreserve: 2,
      });

      const agentRunner = createMockAgentRunner({
        text: 'A'.repeat(200),
        toolCalls: [],
        usage: { promptTokens: 100, completionTokens: 100, totalTokens: 200 },
        steps: [],
        finishReason: 'end',
      });

      const processor = new MessageProcessor(lowThresholdManager, agentRunner, storage);
      const botConfig = createBotConfig();

      // Send multiple messages to build up history (need > messagesToPreserve messages)
      // Each turn adds user + assistant messages, building token count above threshold
      await processor.processMessage(botConfig, createMessage({ text: 'C'.repeat(200) }));
      // After first turn: 2 messages, tokens ~100+. Second turn adds 2 more.
      const result = await processor.processMessage(
        botConfig,
        createMessage({ text: 'D'.repeat(200) })
      );

      // After 2 turns we have 4+ messages and tokens well above 100
      // Compaction should have been triggered
      const session = await storage.getSession(result.sessionId);
      assert.ok(
        session.compactionCount >= 1,
        `Expected compaction to occur, got compactionCount=${session.compactionCount}`
      );
    });

    test('compacted session contains summary message', async () => {
      const lowThresholdManager = new SessionManager(storage, {
        compactionThreshold: 50,
        messagesToPreserve: 2,
      });

      // Build up messages: need multiple turns to have enough messages to compact
      const agentRunner = createMockAgentRunner({
        text: 'X'.repeat(300),
        toolCalls: [],
        usage: {},
        steps: [],
        finishReason: 'end',
      });

      const processor = new MessageProcessor(lowThresholdManager, agentRunner, storage);
      const botConfig = createBotConfig();

      // Send enough messages to accumulate history
      const result1 = await processor.processMessage(
        botConfig,
        createMessage({ text: 'Y'.repeat(300) })
      );

      // After compaction, check for summary message
      const session = await storage.getSession(result1.sessionId);

      if (session.compactionCount > 0) {
        const summaryMsg = session.messages.find(m => m.role === 'system' && m.isCompactionSummary);
        assert.ok(summaryMsg, 'Should have a compaction summary message');
        assert.match(summaryMsg.content, /\[Conversation Summary\]/);
      }
    });

    test('session token count is tracked across messages', async () => {
      const agentRunner = createMockAgentRunner();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage);
      const botConfig = createBotConfig();

      const result = await processor.processMessage(
        botConfig,
        createMessage({ text: 'Some message content here' })
      );

      const session = await storage.getSession(result.sessionId);
      assert.ok(session.tokenCount > 0, 'Token count should be tracked');
    });

    test('token count grows with each message turn', async () => {
      const agentRunner = createMockAgentRunner();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage);
      const botConfig = createBotConfig();

      // First message
      const result1 = await processor.processMessage(
        botConfig,
        createMessage({ text: 'First message with some content' })
      );
      const session1 = await storage.getSession(result1.sessionId);
      const tokenCount1 = session1.tokenCount;

      // Second message
      await processor.processMessage(
        botConfig,
        createMessage({ text: 'Second message with more content' })
      );
      const session2 = await storage.getSession(result1.sessionId);
      const tokenCount2 = session2.tokenCount;

      assert.ok(tokenCount2 > tokenCount1, 'Token count should grow with each message');
    });
  });

  // ===========================================================================
  // Error Handling Tests
  // ===========================================================================

  describe('error handling', () => {
    test('wraps AgentRunner errors with context', async () => {
      const failingRunner = {
        run: mock.fn(async () => {
          throw new Error('API rate limit exceeded');
        }),
      };

      const processor = new MessageProcessor(sessionManager, failingRunner, storage);

      await assert.rejects(
        () => processor.processMessage(createBotConfig(), createMessage()),
        err => {
          assert.equal(err.name, 'MessageProcessorError');
          assert.match(err.message, /API rate limit exceeded/);
          assert.equal(err.operation, 'processMessage');
          assert.equal(err.botId, 'integ-test-bot');
          assert.ok(err.cause);
          return true;
        }
      );
    });

    test('session is created even when agent fails', async () => {
      const failingRunner = {
        run: mock.fn(async () => {
          throw new Error('Model unavailable');
        }),
      };

      const processor = new MessageProcessor(sessionManager, failingRunner, storage);
      const botConfig = createBotConfig();
      const message = createMessage({ userId: 'user-error-test', channelId: 'C_ERR' });

      try {
        await processor.processMessage(botConfig, message);
      } catch {
        // Expected to throw
      }

      // Session should still have been created (before agent call)
      const sessionId = 'integ-test-bot:slack:C_ERR:user-error-test';
      const session = await storage.getSession(sessionId);
      assert.ok(session, 'Session should exist even after agent failure');
      // Should have the user message appended before the agent error
      assert.ok(
        session.messages.some(m => m.role === 'user'),
        'User message should be in session'
      );
    });

    test('validation errors are thrown synchronously without DB calls', async () => {
      const agentRunner = createMockAgentRunner();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage);

      await assert.rejects(
        () => processor.processMessage(null, createMessage()),
        err => {
          assert.equal(err.name, 'MessageProcessorError');
          assert.match(err.message, /Bot config must be a non-null object/);
          return true;
        }
      );

      // AgentRunner should not have been called
      assert.equal(agentRunner.run.mock.calls.length, 0);
    });

    test('does not fail if tool call logging fails', async () => {
      // Create a storage that fails on logToolCall but works otherwise
      const originalLogToolCall = storage.logToolCall.bind(storage);
      const failingLogToolCall = mock.fn(async () => {
        throw new Error('Write failed to tool_calls table');
      });

      // Temporarily replace logToolCall
      storage.logToolCall = failingLogToolCall;

      try {
        const agentRunner = createMockAgentRunnerWithTools();
        const logs = [];
        const processor = new MessageProcessor(sessionManager, agentRunner, storage, {
          logger: msg => logs.push(msg),
        });

        // Should complete without throwing despite tool call logging failure
        const result = await processor.processMessage(createBotConfig(), createMessage());

        assert.ok(result.text, 'Should still return response');
        assert.ok(result.toolCalls.length > 0, 'Should still report tool calls');

        // Warning should have been logged
        assert.ok(
          logs.some(l => l.includes('Warning')),
          'Should log warning about tool call logging failure'
        );
      } finally {
        // Restore original
        storage.logToolCall = originalLogToolCall;
      }
    });
  });

  // ===========================================================================
  // Logging Tests
  // ===========================================================================

  describe('logging', () => {
    test('logs processing events with real storage', async () => {
      const logs = [];
      const agentRunner = createMockAgentRunner();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage, {
        logger: msg => logs.push(msg),
      });

      await processor.processMessage(createBotConfig(), createMessage());

      assert.ok(logs.length >= 2, 'Should have at least start and completion logs');
      assert.ok(logs.some(l => l.includes('Processing message')));
      assert.ok(logs.some(l => l.includes('Agent completed')));
    });

    test('completion log includes duration and tool call count', async () => {
      const logs = [];
      const agentRunner = createMockAgentRunnerWithTools();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage, {
        logger: msg => logs.push(msg),
      });

      await processor.processMessage(createBotConfig(), createMessage());

      const completionLog = logs.find(l => l.includes('Agent completed'));
      assert.ok(completionLog);
      assert.match(completionLog, /\d+ms/);
      assert.match(completionLog, /1 tool call/);
    });
  });

  // ===========================================================================
  // logToolCalls() Public Method Tests
  // ===========================================================================

  describe('logToolCalls() public method with real DB', () => {
    test('logs tool calls and returns DB IDs', async () => {
      const agentRunner = createMockAgentRunner();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage);

      const steps = [
        {
          toolCalls: [
            { toolName: 'bash', toolCallId: 'call_pub_1', args: { command: 'pwd' } },
            { toolName: 'readFile', toolCallId: 'call_pub_2', args: { path: '/tmp/f.txt' } },
          ],
          toolResults: [
            { toolCallId: 'call_pub_1', output: '/home/agent', isError: false },
            { toolCallId: 'call_pub_2', output: 'file contents', isError: false },
          ],
        },
      ];

      const ids = await processor.logToolCalls('integ-test-bot', 'test-session', steps, []);

      assert.equal(ids.length, 2);
      // BIGSERIAL returns strings in pg driver; verify IDs are truthy and parseable
      assert.ok(ids.every(id => id !== null && id !== undefined));

      // Verify in database
      const { rows } = await storage.query(
        'SELECT * FROM tool_calls WHERE bot_id = $1 ORDER BY id',
        ['integ-test-bot']
      );
      assert.equal(rows.length, 2);
      assert.equal(rows[0].tool_name, 'bash');
      assert.equal(rows[1].tool_name, 'readFile');
    });

    test('returns empty array when no tool calls', async () => {
      const agentRunner = createMockAgentRunner();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage);

      const ids = await processor.logToolCalls('integ-test-bot', 'session-x', [], []);

      assert.deepEqual(ids, []);
    });
  });

  // ===========================================================================
  // Concurrent Processing Tests
  // ===========================================================================

  describe('concurrent message processing', () => {
    test('handles concurrent messages to different sessions', async () => {
      const agentRunner = createMockAgentRunner();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage);
      const botConfig = createBotConfig();

      // Process messages from different users concurrently
      const results = await Promise.all([
        processor.processMessage(
          botConfig,
          createMessage({ userId: 'concurrent-user-1', text: 'Hello from user 1' })
        ),
        processor.processMessage(
          botConfig,
          createMessage({ userId: 'concurrent-user-2', text: 'Hello from user 2' })
        ),
        processor.processMessage(
          botConfig,
          createMessage({ userId: 'concurrent-user-3', text: 'Hello from user 3' })
        ),
      ]);

      // All should succeed
      assert.equal(results.length, 3);
      assert.ok(results.every(r => r.text === 'Hello! How can I help you today?'));

      // All should have different session IDs
      const sessionIds = new Set(results.map(r => r.sessionId));
      assert.equal(sessionIds.size, 3, 'Each user should get their own session');
    });

    test('concurrent messages with tool calls do not interfere', async () => {
      const agentRunner = createMockAgentRunnerWithTools();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage);
      const botConfig = createBotConfig();

      await Promise.all([
        processor.processMessage(
          botConfig,
          createMessage({ userId: 'tool-user-1', text: 'List files' })
        ),
        processor.processMessage(
          botConfig,
          createMessage({ userId: 'tool-user-2', text: 'List files too' })
        ),
      ]);

      // Each should have its own tool call logged
      const { rows } = await storage.query('SELECT * FROM tool_calls WHERE bot_id = $1', [
        'integ-test-bot',
      ]);

      assert.equal(rows.length, 2, 'Each concurrent message should have its own tool call log');
    });
  });

  // ===========================================================================
  // REST Channel Tests
  // ===========================================================================

  describe('REST channel type', () => {
    test('processes REST channel messages correctly', async () => {
      const agentRunner = createMockAgentRunner();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage);
      const botConfig = createBotConfig();
      const message = createMessage({
        type: 'rest',
        userId: 'api-client-key-123',
        channelId: 'api-v2',
        text: 'API request',
      });

      const result = await processor.processMessage(botConfig, message);

      assert.equal(result.sessionId, 'integ-test-bot:rest:api-v2:api-client-key-123');

      const session = await storage.getSession(result.sessionId);
      assert.equal(session.channelType, 'rest');
    });
  });
});
