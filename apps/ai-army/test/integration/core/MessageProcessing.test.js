/**
 * Integration tests for full message processing pipeline
 *
 * Tests the complete end-to-end flow:
 * 1. SessionManager → session creation and message appending
 * 2. MessageProcessor → coordinates the full pipeline
 * 3. Mock AgentRunner → simulates LLM responses without real API calls
 * 4. Storage → persists sessions, tool calls, and audit trail
 *
 * This integration test verifies that all components work together correctly,
 * covering:
 * - Session creation and message appending
 * - Soul prompt injection
 * - Agent execution with tool calls
 * - Response appending to session
 * - Event emission (messageReceived, messageSent, toolCalled, etc.)
 * - Error paths (agent failure, session failure, invalid config)
 *
 * Uses real PostgresStorage and SessionManager with mock AgentRunner.
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
  console.log('MessageProcessing integration: PostgreSQL not available, skipping tests');
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
 * Create a mock EventEmitter for testing event emission
 * @returns {Object} Mock event emitter
 */
function createMockEventEmitter() {
  return {
    emitMessageReceived: mock.fn(),
    emitMessageSent: mock.fn(),
    emitMessageError: mock.fn(),
    emitToolCalled: mock.fn(),
    emitToolError: mock.fn(),
  };
}

/**
 * Create a mock AuditLogger for testing audit logging
 * @returns {Object} Mock audit logger
 */
function createMockAuditLogger() {
  return {
    log: mock.fn(async () => {}),
  };
}

/**
 * Create a valid bot config for testing
 * @param {Object} [overrides={}] - Config overrides
 * @returns {Object} Bot config
 */
function createBotConfig(overrides = {}) {
  return {
    id: 'pipeline-test-bot',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    tools: ['bash', 'readFile'],
    ...overrides,
  };
}

/**
 * Create a valid incoming message for testing
 * @param {Object} [overrides={}] - Message overrides
 * @returns {Object} Message object
 */
function createMessage(overrides = {}) {
  return {
    type: 'slack',
    userId: 'U_PIPELINE_TEST',
    channelId: 'C_PIPELINE_TEST',
    text: 'Hello, bot!',
    ...overrides,
  };
}

// ─── Integration Tests ───────────────────────────────────────────

describe('Full Message Processing Pipeline Integration', { skip: !DB_AVAILABLE }, () => {
  let storage;
  let sessionManager;

  before(async () => {
    storage = await setupTestDatabase();
  });

  after(async () => {
    await cleanupTestDatabase(storage);
  });

  beforeEach(async () => {
    // Clean database for a fresh state
    await storage.query('DELETE FROM tool_calls');
    await storage.query('DELETE FROM sessions');
    await storage.query('DELETE FROM bots');

    // Create test bot for FK constraints
    await createTestBot(storage, { id: 'pipeline-test-bot' });

    // Create fresh SessionManager with real storage
    sessionManager = new SessionManager(storage);
  });

  // ===========================================================================
  // End-to-End Pipeline Tests
  // ===========================================================================

  describe('end-to-end message processing', () => {
    test('processes message through full pipeline: session → agent → response', async () => {
      const agentRunner = createMockAgentRunner({
        text: 'I can help you with that!',
        toolCalls: [],
        usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
        steps: [],
        finishReason: 'end',
      });

      const processor = new MessageProcessor(sessionManager, agentRunner, storage);
      const botConfig = createBotConfig();
      const message = createMessage({ text: 'How can you help me?' });

      const result = await processor.processMessage(botConfig, message);

      // Verify response
      assert.equal(result.text, 'I can help you with that!');
      assert.equal(result.sessionId, 'pipeline-test-bot:slack:C_PIPELINE_TEST:U_PIPELINE_TEST');
      assert.ok(result.usage);
      assert.ok(typeof result.durationMs === 'number');

      // Verify AgentRunner was called with correct arguments
      assert.equal(agentRunner.run.mock.calls.length, 1);
      const [passedConfig, passedMessages] = agentRunner.run.mock.calls[0].arguments;
      assert.equal(passedConfig.id, 'pipeline-test-bot');
      assert.ok(Array.isArray(passedMessages));

      // Verify session was created and persisted
      const session = await storage.getSession(result.sessionId);
      assert.ok(session);
      assert.equal(session.botId, 'pipeline-test-bot');
      assert.equal(session.userId, 'U_PIPELINE_TEST');
      assert.equal(session.channelId, 'C_PIPELINE_TEST');
      assert.equal(session.channelType, 'slack');

      // Verify session contains user and assistant messages
      assert.ok(session.messages.length >= 2);
      const userMsg = session.messages.find(m => m.role === 'user');
      const assistantMsg = session.messages.find(m => m.role === 'assistant');
      assert.ok(userMsg);
      assert.equal(userMsg.content, 'How can you help me?');
      assert.ok(assistantMsg);
      assert.equal(assistantMsg.content, 'I can help you with that!');
    });

    test('session is created before agent execution', async () => {
      const agentRunner = {
        run: mock.fn(async () => {
          // During agent execution, verify session already exists
          const sessionId = 'pipeline-test-bot:slack:C_PIPELINE_TEST:U_PIPELINE_TEST';
          const session = await storage.getSession(sessionId);
          assert.ok(session, 'Session should exist before agent execution');
          assert.ok(
            session.messages.some(m => m.role === 'user'),
            'User message should be in session before agent runs'
          );

          return {
            text: 'Response',
            toolCalls: [],
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
            steps: [],
            finishReason: 'end',
          };
        }),
      };

      const processor = new MessageProcessor(sessionManager, agentRunner, storage);
      await processor.processMessage(createBotConfig(), createMessage());

      assert.equal(agentRunner.run.mock.calls.length, 1);
    });

    test('user message is appended to session before agent call', async () => {
      const agentRunner = createMockAgentRunner();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage);
      const message = createMessage({ text: 'My question' });

      await processor.processMessage(createBotConfig(), message);

      // Verify AgentRunner received the user message
      const [, passedMessages] = agentRunner.run.mock.calls[0].arguments;
      const userMsg = passedMessages.find(m => m.role === 'user');
      assert.ok(userMsg);
      assert.equal(userMsg.content, 'My question');
    });

    test('assistant response is appended to session after agent execution', async () => {
      const agentRunner = createMockAgentRunner({
        text: 'Here is my answer',
        toolCalls: [],
        usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
        steps: [],
        finishReason: 'end',
      });

      const processor = new MessageProcessor(sessionManager, agentRunner, storage);
      const result = await processor.processMessage(createBotConfig(), createMessage());

      // Reload session from DB
      const session = await storage.getSession(result.sessionId);
      const assistantMsg = session.messages.find(m => m.role === 'assistant');
      assert.ok(assistantMsg);
      assert.equal(assistantMsg.content, 'Here is my answer');
    });
  });

  // ===========================================================================
  // Soul Prompt Injection Tests
  // ===========================================================================

  describe('soul prompt injection', () => {
    test('prepends soul.md content as system message to agent', async () => {
      const agentRunner = createMockAgentRunner();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage);
      const botConfig = createBotConfig({
        soulContent: 'You are a helpful DevOps assistant who loves automation.',
      });
      const message = createMessage({ text: 'Deploy my app' });

      await processor.processMessage(botConfig, message);

      // Verify soul prompt was prepended
      const [, passedMessages] = agentRunner.run.mock.calls[0].arguments;
      assert.ok(passedMessages.length >= 2);
      assert.equal(passedMessages[0].role, 'system');
      assert.equal(
        passedMessages[0].content,
        'You are a helpful DevOps assistant who loves automation.'
      );

      // User message should come after soul prompt
      const userMsg = passedMessages.find(m => m.role === 'user');
      assert.ok(userMsg);
      assert.equal(userMsg.content, 'Deploy my app');
    });

    test('soul prompt persists across multiple conversation turns', async () => {
      const agentRunner = createMockAgentRunner();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage);
      const botConfig = createBotConfig({
        soulContent: 'Always be concise and technical.',
      });

      // First turn
      await processor.processMessage(botConfig, createMessage({ text: 'First question' }));

      // Second turn
      await processor.processMessage(botConfig, createMessage({ text: 'Second question' }));

      // Both calls should have soul prompt at position 0
      const [, msgs1] = agentRunner.run.mock.calls[0].arguments;
      const [, msgs2] = agentRunner.run.mock.calls[1].arguments;

      assert.equal(msgs1[0].role, 'system');
      assert.equal(msgs1[0].content, 'Always be concise and technical.');
      assert.equal(msgs2[0].role, 'system');
      assert.equal(msgs2[0].content, 'Always be concise and technical.');
    });

    test('skips soul injection when soulContent is undefined', async () => {
      const agentRunner = createMockAgentRunner();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage);
      const botConfig = createBotConfig(); // no soulContent

      await processor.processMessage(botConfig, createMessage({ text: 'Hello' }));

      const [, messages] = agentRunner.run.mock.calls[0].arguments;
      // First message should be user message, not system
      assert.equal(messages[0].role, 'user');
      assert.equal(messages[0].content, 'Hello');
    });
  });

  // ===========================================================================
  // Tool Call Integration Tests
  // ===========================================================================

  describe('tool call processing', () => {
    test('logs tool calls to database when agent uses tools', async () => {
      const agentRunner = createMockAgentRunnerWithTools();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage);

      await processor.processMessage(createBotConfig(), createMessage());

      // Verify tool calls were logged to DB
      const { rows } = await storage.query('SELECT * FROM tool_calls WHERE bot_id = $1', [
        'pipeline-test-bot',
      ]);

      assert.equal(rows.length, 1);
      assert.equal(rows[0].tool_name, 'bash');
      assert.equal(rows[0].success, true);
      assert.ok(rows[0].parameters);
      assert.equal(rows[0].parameters.command, 'ls -la');
      assert.ok(rows[0].result);
    });

    test('tool calls are included in assistant message in session', async () => {
      const agentRunner = createMockAgentRunnerWithTools();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage);
      const result = await processor.processMessage(createBotConfig(), createMessage());

      // Reload session from DB
      const session = await storage.getSession(result.sessionId);
      const assistantMsg = session.messages.find(m => m.role === 'assistant');

      assert.ok(assistantMsg);
      assert.ok(assistantMsg.toolCalls);
      assert.equal(assistantMsg.toolCalls.length, 1);
      assert.equal(assistantMsg.toolCalls[0].toolName, 'bash');
    });

    test('handles multiple tool calls in sequence', async () => {
      const toolCalls = [
        { toolName: 'bash', toolCallId: 'call_1', args: { command: 'ls' } },
        { toolName: 'readFile', toolCallId: 'call_2', args: { path: '/app.js' } },
        { toolName: 'bash', toolCallId: 'call_3', args: { command: 'npm test' } },
      ];
      const steps = [
        {
          toolCalls: [
            { toolName: 'bash', toolCallId: 'call_1', args: { command: 'ls' } },
            { toolName: 'readFile', toolCallId: 'call_2', args: { path: '/app.js' } },
          ],
          toolResults: [
            { toolCallId: 'call_1', output: 'app.js', isError: false },
            { toolCallId: 'call_2', output: 'console.log("hi")', isError: false },
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

      // Verify all tool calls were logged
      const { rows } = await storage.query(
        'SELECT * FROM tool_calls WHERE bot_id = $1 ORDER BY id',
        ['pipeline-test-bot']
      );

      assert.equal(rows.length, 3);
      assert.equal(rows[0].tool_name, 'bash');
      assert.equal(rows[1].tool_name, 'readFile');
      assert.equal(rows[2].tool_name, 'bash');
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
        'pipeline-test-bot',
      ]);

      assert.equal(rows.length, 1);
      assert.equal(rows[0].success, false);
      assert.ok(rows[0].error);
      assert.match(rows[0].error, /No such file or directory/);
    });
  });

  // ===========================================================================
  // Event Emission Tests
  // ===========================================================================

  describe('event emission', () => {
    test('emits messageReceived event when message arrives', async () => {
      const agentRunner = createMockAgentRunner();
      const eventEmitter = createMockEventEmitter();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage, {
        eventEmitter,
      });

      const message = createMessage({ text: 'Hello' });
      await processor.processMessage(createBotConfig(), message);

      // Verify messageReceived was emitted
      assert.equal(eventEmitter.emitMessageReceived.mock.calls.length, 1);
      const [botId, eventData] = eventEmitter.emitMessageReceived.mock.calls[0].arguments;
      assert.equal(botId, 'pipeline-test-bot');
      assert.equal(eventData.userId, 'U_PIPELINE_TEST');
      assert.equal(eventData.channelId, 'C_PIPELINE_TEST');
      assert.equal(eventData.text, 'Hello');
      assert.ok(eventData.sessionId);
    });

    test('emits messageSent event after agent responds', async () => {
      const agentRunner = createMockAgentRunner({
        text: 'My response',
        toolCalls: [],
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        steps: [],
        finishReason: 'end',
      });
      const eventEmitter = createMockEventEmitter();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage, {
        eventEmitter,
      });

      await processor.processMessage(createBotConfig(), createMessage());

      // Verify messageSent was emitted
      assert.equal(eventEmitter.emitMessageSent.mock.calls.length, 1);
      const [botId, eventData] = eventEmitter.emitMessageSent.mock.calls[0].arguments;
      assert.equal(botId, 'pipeline-test-bot');
      assert.equal(eventData.text, 'My response');
      assert.ok(eventData.sessionId);
      assert.ok(typeof eventData.durationMs === 'number');
    });

    test('emits toolCalled events for each successful tool call', async () => {
      const toolCalls = [
        { toolName: 'bash', toolCallId: 'call_1', args: { command: 'ls' } },
        { toolName: 'readFile', toolCallId: 'call_2', args: { path: '/file.txt' } },
      ];
      const steps = [
        {
          toolCalls,
          toolResults: [
            { toolCallId: 'call_1', result: 'files', isError: false },
            { toolCallId: 'call_2', result: 'content', isError: false },
          ],
        },
      ];

      const agentRunner = createMockAgentRunnerWithTools(toolCalls, steps);
      const eventEmitter = createMockEventEmitter();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage, {
        eventEmitter,
      });

      await processor.processMessage(createBotConfig(), createMessage());

      // Verify toolCalled was emitted twice
      assert.equal(eventEmitter.emitToolCalled.mock.calls.length, 2);

      const [botId1, toolEvent1] = eventEmitter.emitToolCalled.mock.calls[0].arguments;
      assert.equal(botId1, 'pipeline-test-bot');
      assert.equal(toolEvent1.toolName, 'bash');
      assert.equal(toolEvent1.args.command, 'ls');

      const [botId2, toolEvent2] = eventEmitter.emitToolCalled.mock.calls[1].arguments;
      assert.equal(botId2, 'pipeline-test-bot');
      assert.equal(toolEvent2.toolName, 'readFile');
      assert.equal(toolEvent2.args.path, '/file.txt');
    });

    test('emits toolError event for failed tool calls', async () => {
      const toolCalls = [
        { toolName: 'bash', toolCallId: 'call_err', args: { command: 'invalid' } },
      ];
      const steps = [
        {
          toolCalls,
          toolResults: [{ toolCallId: 'call_err', result: 'Command not found', isError: true }],
        },
      ];

      const agentRunner = createMockAgentRunnerWithTools(toolCalls, steps);
      const eventEmitter = createMockEventEmitter();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage, {
        eventEmitter,
      });

      await processor.processMessage(createBotConfig(), createMessage());

      // Verify toolError was emitted
      assert.equal(eventEmitter.emitToolError.mock.calls.length, 1);
      const [botId, errorEvent] = eventEmitter.emitToolError.mock.calls[0].arguments;
      assert.equal(botId, 'pipeline-test-bot');
      assert.equal(errorEvent.toolName, 'bash');
      assert.equal(errorEvent.error, 'Command not found');
    });

    test('emits messageError event when agent fails', async () => {
      const agentRunner = {
        run: mock.fn(async () => {
          throw new Error('API rate limit exceeded');
        }),
      };
      const eventEmitter = createMockEventEmitter();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage, {
        eventEmitter,
      });

      try {
        await processor.processMessage(createBotConfig(), createMessage());
      } catch {
        // Expected to throw
      }

      // Verify messageError was emitted
      assert.equal(eventEmitter.emitMessageError.mock.calls.length, 1);
      const [botId, error] = eventEmitter.emitMessageError.mock.calls[0].arguments;
      assert.equal(botId, 'pipeline-test-bot');
      assert.match(error.message, /API rate limit exceeded/);
    });
  });

  // ===========================================================================
  // Audit Logging Tests
  // ===========================================================================

  describe('audit logging', () => {
    test('logs message.received audit event', async () => {
      const agentRunner = createMockAgentRunner();
      const auditLogger = createMockAuditLogger();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage, {
        auditLogger,
      });

      await processor.processMessage(createBotConfig(), createMessage({ text: 'Test' }));

      // Find the message.received audit log
      const receivedLog = auditLogger.log.mock.calls.find(
        call => call.arguments[0].type === 'message.received'
      );
      assert.ok(receivedLog);

      const event = receivedLog.arguments[0];
      assert.equal(event.actor, 'U_PIPELINE_TEST');
      assert.equal(event.actorType, 'user');
      assert.equal(event.resourceType, 'message');
      assert.equal(event.action, 'received');
      assert.equal(event.metadata.botId, 'pipeline-test-bot');
      assert.equal(event.metadata.channelId, 'C_PIPELINE_TEST');
    });

    test('logs message.sent audit event', async () => {
      const agentRunner = createMockAgentRunner({
        text: 'Response',
        toolCalls: [],
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        steps: [],
        finishReason: 'end',
      });
      const auditLogger = createMockAuditLogger();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage, {
        auditLogger,
      });

      await processor.processMessage(createBotConfig(), createMessage());

      // Find the message.sent audit log
      const sentLog = auditLogger.log.mock.calls.find(
        call => call.arguments[0].type === 'message.sent'
      );
      assert.ok(sentLog);

      const event = sentLog.arguments[0];
      assert.equal(event.actor, 'pipeline-test-bot');
      assert.equal(event.actorType, 'bot');
      assert.equal(event.resourceType, 'message');
      assert.equal(event.action, 'sent');
      assert.ok(event.metadata.durationMs >= 0);
    });

    test('logs message.failed audit event on errors', async () => {
      const agentRunner = {
        run: mock.fn(async () => {
          throw new Error('Model unavailable');
        }),
      };
      const auditLogger = createMockAuditLogger();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage, {
        auditLogger,
      });

      try {
        await processor.processMessage(createBotConfig(), createMessage());
      } catch {
        // Expected to throw
      }

      // Find the message.failed audit log
      const failedLog = auditLogger.log.mock.calls.find(
        call => call.arguments[0].type === 'message.failed'
      );
      assert.ok(failedLog);

      const event = failedLog.arguments[0];
      assert.equal(event.action, 'failed');
      assert.ok(event.metadata.error);
      assert.match(event.metadata.error, /Model unavailable/);
    });
  });

  // ===========================================================================
  // Error Handling Tests
  // ===========================================================================

  describe('error handling', () => {
    test('throws error when bot config is invalid', async () => {
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
    });

    test('throws error when bot config is missing required fields', async () => {
      const agentRunner = createMockAgentRunner();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage);

      await assert.rejects(
        () => processor.processMessage({ id: 'bot' }, createMessage()),
        err => {
          assert.equal(err.name, 'MessageProcessorError');
          assert.match(err.message, /provider/);
          return true;
        }
      );
    });

    test('throws error when message is invalid', async () => {
      const agentRunner = createMockAgentRunner();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage);

      await assert.rejects(
        () => processor.processMessage(createBotConfig(), null),
        err => {
          assert.equal(err.name, 'MessageProcessorError');
          assert.match(err.message, /Message must be a non-null object/);
          return true;
        }
      );
    });

    test('wraps agent errors with context', async () => {
      const agentRunner = {
        run: mock.fn(async () => {
          throw new Error('API rate limit exceeded');
        }),
      };
      const processor = new MessageProcessor(sessionManager, agentRunner, storage);

      await assert.rejects(
        () => processor.processMessage(createBotConfig(), createMessage()),
        err => {
          assert.equal(err.name, 'MessageProcessorError');
          assert.match(err.message, /Failed to process message/);
          assert.match(err.message, /API rate limit exceeded/);
          assert.equal(err.botId, 'pipeline-test-bot');
          assert.ok(err.cause);
          return true;
        }
      );
    });

    test('session is created even when agent fails', async () => {
      const agentRunner = {
        run: mock.fn(async () => {
          throw new Error('Model unavailable');
        }),
      };
      const processor = new MessageProcessor(sessionManager, agentRunner, storage);

      try {
        await processor.processMessage(createBotConfig(), createMessage());
      } catch {
        // Expected to throw
      }

      // Session should still exist
      const sessionId = 'pipeline-test-bot:slack:C_PIPELINE_TEST:U_PIPELINE_TEST';
      const session = await storage.getSession(sessionId);
      assert.ok(session);
      assert.ok(session.messages.some(m => m.role === 'user'));
    });

    test('gracefully handles session failure', async () => {
      const failingSessionManager = {
        getSession: mock.fn(async () => {
          throw new Error('Database connection lost');
        }),
        appendMessage: mock.fn(),
        getMessagesForLLM: mock.fn(),
      };

      const agentRunner = createMockAgentRunner();
      const processor = new MessageProcessor(failingSessionManager, agentRunner, storage);

      await assert.rejects(
        () => processor.processMessage(createBotConfig(), createMessage()),
        err => {
          assert.equal(err.name, 'MessageProcessorError');
          assert.match(err.message, /Failed to process message/);
          assert.match(err.cause.message, /Database connection lost/);
          return true;
        }
      );
    });

    test('continues processing even if tool call logging fails', async () => {
      const agentRunner = createMockAgentRunnerWithTools();

      // Replace storage.logToolCall to simulate failure
      const originalLogToolCall = storage.logToolCall.bind(storage);
      storage.logToolCall = mock.fn(async () => {
        throw new Error('Tool call table write failed');
      });

      try {
        const logs = [];
        const processor = new MessageProcessor(sessionManager, agentRunner, storage, {
          logger: msg => logs.push(msg),
        });

        const result = await processor.processMessage(createBotConfig(), createMessage());

        // Should still complete successfully
        assert.ok(result.text);
        assert.ok(result.sessionId);

        // Should log a warning
        assert.ok(logs.some(l => l.includes('Warning')));
      } finally {
        // Restore original
        storage.logToolCall = originalLogToolCall;
      }
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

      // Should use same session
      assert.equal(result1.sessionId, result2.sessionId);

      // Session should have accumulated messages
      const session = await storage.getSession(result1.sessionId);
      assert.ok(session.messages.length >= 4); // 2 user + 2 assistant
    });

    test('second message includes context from first turn', async () => {
      const agentRunner = createMockAgentRunner();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage);
      const botConfig = createBotConfig();

      await processor.processMessage(botConfig, createMessage({ text: 'First question' }));
      await processor.processMessage(botConfig, createMessage({ text: 'Follow up' }));

      // Second call should have more messages than first
      const firstCallMessages = agentRunner.run.mock.calls[0].arguments[1];
      const secondCallMessages = agentRunner.run.mock.calls[1].arguments[1];

      assert.ok(
        secondCallMessages.length > firstCallMessages.length,
        'Second call should include previous context'
      );
    });

    test('different users get different sessions', async () => {
      const agentRunner = createMockAgentRunner();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage);
      const botConfig = createBotConfig();

      const result1 = await processor.processMessage(
        botConfig,
        createMessage({ userId: 'alice', text: 'Hello from Alice' })
      );
      const result2 = await processor.processMessage(
        botConfig,
        createMessage({ userId: 'bob', text: 'Hello from Bob' })
      );

      assert.notEqual(result1.sessionId, result2.sessionId);
    });

    test('different channels get different sessions', async () => {
      const agentRunner = createMockAgentRunner();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage);
      const botConfig = createBotConfig();

      const result1 = await processor.processMessage(
        botConfig,
        createMessage({ channelId: 'channel-A' })
      );
      const result2 = await processor.processMessage(
        botConfig,
        createMessage({ channelId: 'channel-B' })
      );

      assert.notEqual(result1.sessionId, result2.sessionId);
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

      const results = await Promise.all([
        processor.processMessage(
          botConfig,
          createMessage({ userId: 'user-1', text: 'Hello from user 1' })
        ),
        processor.processMessage(
          botConfig,
          createMessage({ userId: 'user-2', text: 'Hello from user 2' })
        ),
        processor.processMessage(
          botConfig,
          createMessage({ userId: 'user-3', text: 'Hello from user 3' })
        ),
      ]);

      assert.equal(results.length, 3);

      // All should have different session IDs
      const sessionIds = new Set(results.map(r => r.sessionId));
      assert.equal(sessionIds.size, 3);
    });

    test('concurrent messages with tool calls do not interfere', async () => {
      const agentRunner = createMockAgentRunnerWithTools();
      const processor = new MessageProcessor(sessionManager, agentRunner, storage);
      const botConfig = createBotConfig();

      await Promise.all([
        processor.processMessage(botConfig, createMessage({ userId: 'tool-user-1' })),
        processor.processMessage(botConfig, createMessage({ userId: 'tool-user-2' })),
      ]);

      // Each should have its own tool call logged
      const { rows } = await storage.query('SELECT * FROM tool_calls WHERE bot_id = $1', [
        'pipeline-test-bot',
      ]);

      assert.equal(rows.length, 2);
    });
  });
});
