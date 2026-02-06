/**
 * Unit tests for MessageProcessor
 *
 * Tests the full message processing pipeline including:
 * - Session management (get/create/append)
 * - AgentRunner execution with mock AI responses
 * - Tool call logging for audit trail
 * - Soul.md system prompt injection
 * - Error handling and validation
 * - Session compaction triggers
 *
 * All dependencies (SessionManager, AgentRunner, Storage) are mocked.
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { MessageProcessor, MessageProcessorError } from '../../../src/core/message-processor.js';

// ─── Mock Factories ──────────────────────────────────────────────

/**
 * Create a mock SessionManager
 * @param {Object} [overrides={}] - Override specific methods
 * @returns {Object} Mock session manager
 */
function createMockSessionManager(overrides = {}) {
  const sessions = new Map();

  return {
    getSession: mock.fn(async (botId, channel, userId) => {
      const key = `${botId}:${channel.type}:${channel.id}:${userId}`;
      if (sessions.has(key)) {
        return sessions.get(key);
      }
      const session = {
        id: key,
        botId,
        userId,
        channelId: channel.id,
        channelType: channel.type,
        messages: [],
        tokenCount: 0,
        compactionCount: 0,
        createdAt: new Date(),
        lastMessageAt: new Date(),
      };
      sessions.set(key, session);
      return session;
    }),
    appendMessage: mock.fn(async (session, role, content, _options = {}) => {
      session.messages.push({
        role,
        content,
        timestamp: new Date().toISOString(),
      });
      session.tokenCount += Math.ceil((content.length / 4) * 1.1);
    }),
    getMessagesForLLM: mock.fn(session => {
      return (session.messages || []).map(m => ({
        role: m.role,
        content: m.content,
      }));
    }),
    needsCompaction: mock.fn(_session => false),
    compact: mock.fn(async _session => {}),
    _sessions: sessions,
    ...overrides,
  };
}

/**
 * Create a mock AgentRunner
 * @param {Object} [result] - Result to return from run()
 * @returns {Object} Mock agent runner
 */
function createMockAgentRunner(result) {
  const defaultResult = {
    text: 'Hello! How can I help you?',
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
 * Create a mock AgentRunner that returns tool calls
 * @param {Array} [toolCalls] - Tool calls to include
 * @param {Array} [steps] - Steps to include
 * @returns {Object} Mock agent runner with tool calls
 */
function createMockAgentRunnerWithTools(toolCalls, steps) {
  const defaultToolCalls = toolCalls || [
    { toolName: 'bash', toolCallId: 'call_1', args: { command: 'ls -la' } },
  ];

  const defaultSteps = steps || [
    {
      toolCalls: defaultToolCalls,
      toolResults: [
        {
          toolCallId: 'call_1',
          result: 'file1.txt\nfile2.txt',
          isError: false,
        },
      ],
    },
  ];

  return {
    run: mock.fn(async () => ({
      text: 'Here are the files in the directory.',
      toolCalls: defaultToolCalls,
      usage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 },
      steps: defaultSteps,
      finishReason: 'end',
    })),
  };
}

/**
 * Create a mock Storage instance
 * @param {Object} [overrides={}] - Override specific methods
 * @returns {Object} Mock storage
 */
function createMockStorage(overrides = {}) {
  let nextId = 1;

  return {
    logToolCall: mock.fn(async _toolCall => nextId++),
    ...overrides,
  };
}

/**
 * Create a valid bot config for testing
 * @param {Object} [overrides={}] - Config overrides
 * @returns {Object} Bot config
 */
function createBotConfig(overrides = {}) {
  return {
    id: 'test-bot',
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
    userId: 'U123ABC',
    channelId: 'C456DEF',
    text: 'Hello, bot!',
    isDM: false,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────

describe('MessageProcessor', () => {
  let sessionManager;
  let agentRunner;
  let storage;
  let processor;

  beforeEach(() => {
    sessionManager = createMockSessionManager();
    agentRunner = createMockAgentRunner();
    storage = createMockStorage();
    processor = new MessageProcessor(sessionManager, agentRunner, storage);
  });

  describe('constructor', () => {
    test('creates instance with required dependencies', () => {
      const proc = new MessageProcessor(sessionManager, agentRunner, storage);

      assert.equal(proc.sessionManager, sessionManager);
      assert.equal(proc.agentRunner, agentRunner);
      assert.equal(proc.storage, storage);
      assert.equal(proc.logger, null);
    });

    test('accepts optional logger', () => {
      const logger = mock.fn();
      const proc = new MessageProcessor(sessionManager, agentRunner, storage, { logger });

      assert.equal(proc.logger, logger);
    });

    test('throws when sessionManager is missing', () => {
      assert.throws(
        () => new MessageProcessor(null, agentRunner, storage),
        err => {
          assert.equal(err.name, 'MessageProcessorError');
          assert.match(err.message, /SessionManager is required/);
          assert.equal(err.operation, 'constructor');
          return true;
        }
      );
    });

    test('throws when agentRunner is missing', () => {
      assert.throws(
        () => new MessageProcessor(sessionManager, null, storage),
        err => {
          assert.equal(err.name, 'MessageProcessorError');
          assert.match(err.message, /AgentRunner is required/);
          assert.equal(err.operation, 'constructor');
          return true;
        }
      );
    });

    test('throws when storage is missing', () => {
      assert.throws(
        () => new MessageProcessor(sessionManager, agentRunner, null),
        err => {
          assert.equal(err.name, 'MessageProcessorError');
          assert.match(err.message, /Storage is required/);
          assert.equal(err.operation, 'constructor');
          return true;
        }
      );
    });
  });

  describe('processMessage()', () => {
    test('processes a simple message end-to-end', async () => {
      const botConfig = createBotConfig();
      const message = createMessage();

      const result = await processor.processMessage(botConfig, message);

      assert.equal(result.text, 'Hello! How can I help you?');
      assert.deepEqual(result.toolCalls, []);
      assert.ok(result.usage);
      assert.equal(result.sessionId, 'test-bot:slack:C456DEF:U123ABC');
      assert.ok(typeof result.durationMs === 'number');
    });

    test('creates session via SessionManager', async () => {
      const botConfig = createBotConfig();
      const message = createMessage();

      await processor.processMessage(botConfig, message);

      assert.equal(sessionManager.getSession.mock.calls.length, 1);
      const [botId, channel, userId] = sessionManager.getSession.mock.calls[0].arguments;
      assert.equal(botId, 'test-bot');
      assert.deepEqual(channel, { type: 'slack', id: 'C456DEF' });
      assert.equal(userId, 'U123ABC');
    });

    test('appends user message to session', async () => {
      const botConfig = createBotConfig();
      const message = createMessage({ text: 'What is JavaScript?' });

      await processor.processMessage(botConfig, message);

      // First call appends user message, second appends assistant response
      assert.ok(sessionManager.appendMessage.mock.calls.length >= 2);
      const [, role, content] = sessionManager.appendMessage.mock.calls[0].arguments;
      assert.equal(role, 'user');
      assert.equal(content, 'What is JavaScript?');
    });

    test('appends assistant response to session', async () => {
      const botConfig = createBotConfig();
      const message = createMessage();

      await processor.processMessage(botConfig, message);

      const lastCall = sessionManager.appendMessage.mock.calls[1];
      const [, role, content] = lastCall.arguments;
      assert.equal(role, 'assistant');
      assert.equal(content, 'Hello! How can I help you?');
    });

    test('calls getMessagesForLLM to format messages', async () => {
      const botConfig = createBotConfig();
      const message = createMessage();

      await processor.processMessage(botConfig, message);

      assert.equal(sessionManager.getMessagesForLLM.mock.calls.length, 1);
    });

    test('calls AgentRunner.run with bot config and messages', async () => {
      const botConfig = createBotConfig();
      const message = createMessage();

      await processor.processMessage(botConfig, message);

      assert.equal(agentRunner.run.mock.calls.length, 1);
      const [passedConfig, passedMessages] = agentRunner.run.mock.calls[0].arguments;
      assert.equal(passedConfig.id, 'test-bot');
      assert.ok(Array.isArray(passedMessages));
    });

    test('returns durationMs timing', async () => {
      const botConfig = createBotConfig();
      const message = createMessage();

      const result = await processor.processMessage(botConfig, message);

      assert.ok(result.durationMs >= 0);
      assert.ok(typeof result.durationMs === 'number');
    });

    test('processes message with Discord channel', async () => {
      const botConfig = createBotConfig({ id: 'discord-bot' });
      const message = createMessage({
        type: 'discord',
        userId: 'discord-user-123',
        channelId: 'discord-channel-456',
      });

      const result = await processor.processMessage(botConfig, message);

      assert.equal(result.sessionId, 'discord-bot:discord:discord-channel-456:discord-user-123');
    });

    test('processes message with REST channel', async () => {
      const botConfig = createBotConfig({ id: 'api-bot' });
      const message = createMessage({
        type: 'rest',
        userId: 'api-client-1',
        channelId: 'api-v1',
      });

      const result = await processor.processMessage(botConfig, message);

      assert.equal(result.sessionId, 'api-bot:rest:api-v1:api-client-1');
    });
  });

  describe('processMessage() - soul.md injection', () => {
    test('prepends soul content as system message', async () => {
      const botConfig = createBotConfig({
        soulContent: 'You are a helpful coding assistant.',
      });
      const message = createMessage();

      await processor.processMessage(botConfig, message);

      const [, passedMessages] = agentRunner.run.mock.calls[0].arguments;

      assert.equal(passedMessages[0].role, 'system');
      assert.equal(passedMessages[0].content, 'You are a helpful coding assistant.');
    });

    test('does not prepend soul message when soulContent is empty', async () => {
      const botConfig = createBotConfig({ soulContent: '' });
      const message = createMessage();

      await processor.processMessage(botConfig, message);

      const [, passedMessages] = agentRunner.run.mock.calls[0].arguments;

      // Should not have a soul system message prepended
      const hasSystemSoul = passedMessages.some(m => m.role === 'system' && m.content === '');
      assert.equal(hasSystemSoul, false);
    });

    test('does not prepend soul message when soulContent is undefined', async () => {
      const botConfig = createBotConfig();
      const message = createMessage();

      await processor.processMessage(botConfig, message);

      const [, passedMessages] = agentRunner.run.mock.calls[0].arguments;

      // First message should be the user message, not a system message
      assert.equal(passedMessages[0].role, 'user');
    });

    test('soul message is before conversation messages', async () => {
      const botConfig = createBotConfig({
        soulContent: 'I am a support bot.',
      });
      const message = createMessage({ text: 'Help me!' });

      await processor.processMessage(botConfig, message);

      const [, passedMessages] = agentRunner.run.mock.calls[0].arguments;

      assert.equal(passedMessages[0].role, 'system');
      assert.equal(passedMessages[0].content, 'I am a support bot.');
      // User message should follow
      assert.equal(passedMessages[passedMessages.length - 1].role, 'user');
    });
  });

  describe('processMessage() - tool call logging', () => {
    test('logs tool calls from agent steps', async () => {
      const toolRunner = createMockAgentRunnerWithTools();
      const proc = new MessageProcessor(sessionManager, toolRunner, storage);

      const botConfig = createBotConfig();
      const message = createMessage();

      await proc.processMessage(botConfig, message);

      assert.equal(storage.logToolCall.mock.calls.length, 1);
      const loggedCall = storage.logToolCall.mock.calls[0].arguments[0];
      assert.equal(loggedCall.botId, 'test-bot');
      assert.equal(loggedCall.toolName, 'bash');
      assert.deepEqual(loggedCall.parameters, { command: 'ls -la' });
      assert.equal(loggedCall.success, true);
    });

    test('logs tool call result from step results', async () => {
      const toolRunner = createMockAgentRunnerWithTools();
      const proc = new MessageProcessor(sessionManager, toolRunner, storage);

      const botConfig = createBotConfig();
      const message = createMessage();

      await proc.processMessage(botConfig, message);

      const loggedCall = storage.logToolCall.mock.calls[0].arguments[0];
      assert.equal(loggedCall.result, 'file1.txt\nfile2.txt');
    });

    test('logs multiple tool calls', async () => {
      const toolCalls = [
        { toolName: 'bash', toolCallId: 'call_1', args: { command: 'ls' } },
        {
          toolName: 'readFile',
          toolCallId: 'call_2',
          args: { path: '/home/agent/file.txt' },
        },
      ];
      const steps = [
        {
          toolCalls,
          toolResults: [
            {
              toolCallId: 'call_1',
              result: 'file1.txt',
              isError: false,
            },
            {
              toolCallId: 'call_2',
              result: 'Hello World',
              isError: false,
            },
          ],
        },
      ];
      const toolRunner = createMockAgentRunnerWithTools(toolCalls, steps);
      const proc = new MessageProcessor(sessionManager, toolRunner, storage);

      await proc.processMessage(createBotConfig(), createMessage());

      assert.equal(storage.logToolCall.mock.calls.length, 2);
      assert.equal(storage.logToolCall.mock.calls[0].arguments[0].toolName, 'bash');
      assert.equal(storage.logToolCall.mock.calls[1].arguments[0].toolName, 'readFile');
    });

    test('logs failed tool calls with error info', async () => {
      const toolCalls = [
        {
          toolName: 'bash',
          toolCallId: 'call_1',
          args: { command: 'rm -rf /' },
        },
      ];
      const steps = [
        {
          toolCalls,
          toolResults: [
            {
              toolCallId: 'call_1',
              result: 'Permission denied: dangerous command blocked',
              isError: true,
            },
          ],
        },
      ];
      const toolRunner = createMockAgentRunnerWithTools(toolCalls, steps);
      const proc = new MessageProcessor(sessionManager, toolRunner, storage);

      await proc.processMessage(createBotConfig(), createMessage());

      const loggedCall = storage.logToolCall.mock.calls[0].arguments[0];
      assert.equal(loggedCall.success, false);
      assert.ok(loggedCall.error);
      assert.match(loggedCall.error, /Permission denied/);
    });

    test('includes session ID in tool call log', async () => {
      const toolRunner = createMockAgentRunnerWithTools();
      const proc = new MessageProcessor(sessionManager, toolRunner, storage);

      await proc.processMessage(createBotConfig(), createMessage());

      const loggedCall = storage.logToolCall.mock.calls[0].arguments[0];
      assert.equal(loggedCall.sessionId, 'test-bot:slack:C456DEF:U123ABC');
    });

    test('does not fail if tool call logging fails', async () => {
      const failingStorage = createMockStorage({
        logToolCall: mock.fn(async () => {
          throw new Error('Database write failed');
        }),
      });
      const toolRunner = createMockAgentRunnerWithTools();
      const logger = mock.fn();
      const proc = new MessageProcessor(sessionManager, toolRunner, failingStorage, { logger });

      // Should not throw
      const result = await proc.processMessage(createBotConfig(), createMessage());

      assert.ok(result.text);
      assert.ok(logger.mock.calls.length > 0);
      const warningCall = logger.mock.calls.find(c => c.arguments[0].includes('Warning'));
      assert.ok(warningCall);
    });

    test('no tool calls when agent returns none', async () => {
      const botConfig = createBotConfig();
      const message = createMessage();

      await processor.processMessage(botConfig, message);

      assert.equal(storage.logToolCall.mock.calls.length, 0);
    });

    test('includes tool calls in assistant message options', async () => {
      const toolRunner = createMockAgentRunnerWithTools();
      const proc = new MessageProcessor(sessionManager, toolRunner, storage);

      await proc.processMessage(createBotConfig(), createMessage());

      // The second appendMessage call (assistant) should include toolCalls
      const assistantCall = sessionManager.appendMessage.mock.calls[1];
      const options = assistantCall.arguments[3];
      assert.ok(options.toolCalls);
      assert.equal(options.toolCalls.length, 1);
      assert.equal(options.toolCalls[0].toolName, 'bash');
    });

    test('falls back to top-level tool calls when no steps', async () => {
      const topLevelToolCalls = [
        {
          toolName: 'bash',
          toolCallId: 'call_1',
          args: { command: 'echo hello' },
        },
      ];
      const toolRunner = {
        run: mock.fn(async () => ({
          text: 'Done',
          toolCalls: topLevelToolCalls,
          usage: {},
          steps: [], // empty steps
          finishReason: 'end',
        })),
      };
      const proc = new MessageProcessor(sessionManager, toolRunner, storage);

      await proc.processMessage(createBotConfig(), createMessage());

      assert.equal(storage.logToolCall.mock.calls.length, 1);
      const loggedCall = storage.logToolCall.mock.calls[0].arguments[0];
      assert.equal(loggedCall.toolName, 'bash');
      assert.equal(loggedCall.result, null);
    });
  });

  describe('processMessage() - validation', () => {
    test('throws when botConfig is null', async () => {
      await assert.rejects(
        () => processor.processMessage(null, createMessage()),
        err => {
          assert.equal(err.name, 'MessageProcessorError');
          assert.match(err.message, /Bot config must be a non-null object/);
          assert.equal(err.operation, 'processMessage');
          return true;
        }
      );
    });

    test('throws when botConfig is not an object', async () => {
      await assert.rejects(
        () => processor.processMessage('not-an-object', createMessage()),
        err => {
          assert.equal(err.name, 'MessageProcessorError');
          assert.match(err.message, /Bot config must be a non-null object/);
          return true;
        }
      );
    });

    test('throws when botConfig.id is missing', async () => {
      await assert.rejects(
        () => processor.processMessage({ provider: 'anthropic', model: 'claude' }, createMessage()),
        err => {
          assert.equal(err.name, 'MessageProcessorError');
          assert.match(err.message, /string "id" property/);
          return true;
        }
      );
    });

    test('throws when botConfig.provider is missing', async () => {
      await assert.rejects(
        () => processor.processMessage({ id: 'bot1', model: 'claude' }, createMessage()),
        err => {
          assert.equal(err.name, 'MessageProcessorError');
          assert.match(err.message, /string "provider" property/);
          assert.equal(err.botId, 'bot1');
          return true;
        }
      );
    });

    test('throws when botConfig.model is missing', async () => {
      await assert.rejects(
        () => processor.processMessage({ id: 'bot1', provider: 'anthropic' }, createMessage()),
        err => {
          assert.equal(err.name, 'MessageProcessorError');
          assert.match(err.message, /string "model" property/);
          assert.equal(err.botId, 'bot1');
          return true;
        }
      );
    });

    test('throws when message is null', async () => {
      await assert.rejects(
        () => processor.processMessage(createBotConfig(), null),
        err => {
          assert.equal(err.name, 'MessageProcessorError');
          assert.match(err.message, /Message must be a non-null object/);
          return true;
        }
      );
    });

    test('throws when message.type is missing', async () => {
      await assert.rejects(
        () =>
          processor.processMessage(createBotConfig(), {
            userId: 'U1',
            channelId: 'C1',
            text: 'hi',
          }),
        err => {
          assert.equal(err.name, 'MessageProcessorError');
          assert.match(err.message, /string "type" property/);
          return true;
        }
      );
    });

    test('throws when message.userId is missing', async () => {
      await assert.rejects(
        () =>
          processor.processMessage(createBotConfig(), {
            type: 'slack',
            channelId: 'C1',
            text: 'hi',
          }),
        err => {
          assert.equal(err.name, 'MessageProcessorError');
          assert.match(err.message, /string "userId" property/);
          return true;
        }
      );
    });

    test('throws when message.channelId is missing', async () => {
      await assert.rejects(
        () =>
          processor.processMessage(createBotConfig(), { type: 'slack', userId: 'U1', text: 'hi' }),
        err => {
          assert.equal(err.name, 'MessageProcessorError');
          assert.match(err.message, /string "channelId" property/);
          return true;
        }
      );
    });

    test('throws when message.text is not a string', async () => {
      await assert.rejects(
        () =>
          processor.processMessage(createBotConfig(), {
            type: 'slack',
            userId: 'U1',
            channelId: 'C1',
            text: 123,
          }),
        err => {
          assert.equal(err.name, 'MessageProcessorError');
          assert.match(err.message, /string "text" property/);
          return true;
        }
      );
    });
  });

  describe('processMessage() - error handling', () => {
    test('wraps SessionManager errors', async () => {
      sessionManager.getSession = mock.fn(async () => {
        throw new Error('Database connection lost');
      });

      await assert.rejects(
        () => processor.processMessage(createBotConfig(), createMessage()),
        err => {
          assert.equal(err.name, 'MessageProcessorError');
          assert.match(err.message, /Database connection lost/);
          assert.equal(err.operation, 'processMessage');
          assert.equal(err.botId, 'test-bot');
          assert.ok(err.cause);
          return true;
        }
      );
    });

    test('wraps AgentRunner errors', async () => {
      agentRunner.run = mock.fn(async () => {
        throw new Error('Model API rate limited');
      });

      await assert.rejects(
        () => processor.processMessage(createBotConfig(), createMessage()),
        err => {
          assert.equal(err.name, 'MessageProcessorError');
          assert.match(err.message, /Model API rate limited/);
          assert.equal(err.operation, 'processMessage');
          assert.equal(err.botId, 'test-bot');
          return true;
        }
      );
    });

    test('wraps appendMessage errors', async () => {
      sessionManager.appendMessage = mock.fn(async () => {
        throw new Error('Storage write failed');
      });

      await assert.rejects(
        () => processor.processMessage(createBotConfig(), createMessage()),
        err => {
          assert.equal(err.name, 'MessageProcessorError');
          assert.match(err.message, /Storage write failed/);
          return true;
        }
      );
    });

    test('includes sessionId in error when available', async () => {
      // Let getSession succeed but agentRunner fail
      agentRunner.run = mock.fn(async () => {
        throw new Error('LLM failure');
      });

      await assert.rejects(
        () => processor.processMessage(createBotConfig(), createMessage()),
        err => {
          assert.equal(err.sessionId, 'test-bot:slack:C456DEF:U123ABC');
          return true;
        }
      );
    });

    test('does not double-wrap MessageProcessorError', async () => {
      const original = new MessageProcessorError('Already processed', {
        operation: 'processMessage',
      });
      sessionManager.getSession = mock.fn(async () => {
        throw original;
      });

      await assert.rejects(
        () => processor.processMessage(createBotConfig(), createMessage()),
        err => {
          assert.equal(err, original);
          return true;
        }
      );
    });
  });

  describe('processMessage() - logging', () => {
    test('logs processing start and completion', async () => {
      const logger = mock.fn();
      const proc = new MessageProcessor(sessionManager, agentRunner, storage, { logger });

      await proc.processMessage(createBotConfig(), createMessage());

      assert.ok(logger.mock.calls.length >= 2);
      const messages = logger.mock.calls.map(c => c.arguments[0]);
      assert.ok(messages.some(m => m.includes('Processing message')));
      assert.ok(messages.some(m => m.includes('Agent completed')));
    });

    test('logs include bot id', async () => {
      const logger = mock.fn();
      const proc = new MessageProcessor(sessionManager, agentRunner, storage, { logger });

      await proc.processMessage(createBotConfig({ id: 'my-bot' }), createMessage());

      const messages = logger.mock.calls.map(c => c.arguments[0]);
      assert.ok(messages.some(m => m.includes('my-bot')));
    });

    test('logs duration in completion message', async () => {
      const logger = mock.fn();
      const proc = new MessageProcessor(sessionManager, agentRunner, storage, { logger });

      await proc.processMessage(createBotConfig(), createMessage());

      const messages = logger.mock.calls.map(c => c.arguments[0]);
      const completionMsg = messages.find(m => m.includes('Agent completed'));
      assert.ok(completionMsg);
      assert.match(completionMsg, /\d+ms/);
    });

    test('does not throw when logger is null', async () => {
      const proc = new MessageProcessor(sessionManager, agentRunner, storage);

      // Should not throw
      const result = await proc.processMessage(createBotConfig(), createMessage());
      assert.ok(result.text);
    });
  });

  describe('logToolCalls() - public method', () => {
    test('logs tool calls and returns IDs', async () => {
      const steps = [
        {
          toolCalls: [
            {
              toolName: 'bash',
              toolCallId: 'call_1',
              args: { command: 'pwd' },
            },
          ],
          toolResults: [
            {
              toolCallId: 'call_1',
              result: '/home/agent',
              isError: false,
            },
          ],
        },
      ];

      const ids = await processor.logToolCalls('bot1', 'session1', steps, []);

      assert.equal(ids.length, 1);
      assert.ok(typeof ids[0] === 'number');
    });

    test('returns empty array when no tool calls', async () => {
      const ids = await processor.logToolCalls('bot1', 'session1', [], []);

      assert.deepEqual(ids, []);
    });

    test('handles null steps gracefully', async () => {
      const ids = await processor.logToolCalls('bot1', 'session1', null, []);

      assert.deepEqual(ids, []);
    });
  });

  describe('_prependSoulPrompt()', () => {
    test('prepends soul content as system message', () => {
      const messages = [{ role: 'user', content: 'Hello' }];
      const result = processor._prependSoulPrompt(messages, 'You are helpful.');

      assert.equal(result.length, 2);
      assert.equal(result[0].role, 'system');
      assert.equal(result[0].content, 'You are helpful.');
      assert.equal(result[1].role, 'user');
    });

    test('returns original messages when soulContent is falsy', () => {
      const messages = [{ role: 'user', content: 'Hello' }];

      assert.equal(processor._prependSoulPrompt(messages, null), messages);
      assert.equal(processor._prependSoulPrompt(messages, undefined), messages);
      assert.equal(processor._prependSoulPrompt(messages, ''), messages);
    });

    test('does not mutate original messages array', () => {
      const messages = [{ role: 'user', content: 'Hello' }];
      const result = processor._prependSoulPrompt(messages, 'Soul');

      assert.equal(messages.length, 1);
      assert.equal(result.length, 2);
    });
  });

  describe('processMessage() - multi-step conversations', () => {
    test('builds on existing session messages', async () => {
      const botConfig = createBotConfig();
      const message1 = createMessage({ text: 'First message' });
      const message2 = createMessage({ text: 'Second message' });

      await processor.processMessage(botConfig, message1);
      await processor.processMessage(botConfig, message2);

      // Second run should have session with previous messages
      assert.equal(agentRunner.run.mock.calls.length, 2);

      // The session should have accumulated messages
      const session = sessionManager._sessions.get('test-bot:slack:C456DEF:U123ABC');
      assert.ok(session.messages.length >= 2);
    });

    test('reuses existing session for same user', async () => {
      const botConfig = createBotConfig();

      await processor.processMessage(botConfig, createMessage({ text: 'First' }));
      await processor.processMessage(botConfig, createMessage({ text: 'Second' }));

      // getSession called twice but same session returned
      assert.equal(sessionManager.getSession.mock.calls.length, 2);

      const session1 = await sessionManager.getSession.mock.calls[0].result;
      const session2 = await sessionManager.getSession.mock.calls[1].result;
      assert.equal(session1.id, session2.id);
    });
  });
});

describe('MessageProcessorError', () => {
  test('is an instance of Error', () => {
    const error = new MessageProcessorError('Test error');
    assert.ok(error instanceof Error);
  });

  test('has correct name', () => {
    const error = new MessageProcessorError('Test error');
    assert.equal(error.name, 'MessageProcessorError');
  });

  test('stores operation', () => {
    const error = new MessageProcessorError('Test error', {
      operation: 'processMessage',
    });
    assert.equal(error.operation, 'processMessage');
  });

  test('stores botId', () => {
    const error = new MessageProcessorError('Test error', {
      botId: 'my-bot',
    });
    assert.equal(error.botId, 'my-bot');
  });

  test('stores sessionId', () => {
    const error = new MessageProcessorError('Test error', {
      sessionId: 'bot:slack:C123:U456',
    });
    assert.equal(error.sessionId, 'bot:slack:C123:U456');
  });

  test('stores cause', () => {
    const cause = new Error('Original error');
    const error = new MessageProcessorError('Test error', { cause });
    assert.equal(error.cause, cause);
  });

  test('stores all options together', () => {
    const cause = new Error('Original');
    const error = new MessageProcessorError('Multi-option error', {
      cause,
      operation: 'processMessage',
      botId: 'my-bot',
      sessionId: 'test-session',
    });

    assert.equal(error.cause, cause);
    assert.equal(error.operation, 'processMessage');
    assert.equal(error.botId, 'my-bot');
    assert.equal(error.sessionId, 'test-session');
  });
});
