/**
 * Unit tests for BotEventEmitter
 *
 * Tests event emission for bot lifecycle, message, and tool events.
 * Verifies payload structure, event type validation, and integration
 * with BotManager, MessageProcessor, and ToolRegistry.
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { BotEventEmitter, BOT_EVENTS } from '../../../src/core/event-emitter.js';

describe('BOT_EVENTS', () => {
  test('defines all expected event types', () => {
    assert.equal(BOT_EVENTS.BOT_STARTED, 'bot.started');
    assert.equal(BOT_EVENTS.BOT_STOPPED, 'bot.stopped');
    assert.equal(BOT_EVENTS.BOT_ERROR, 'bot.error');
    assert.equal(BOT_EVENTS.MESSAGE_RECEIVED, 'message.received');
    assert.equal(BOT_EVENTS.MESSAGE_SENT, 'message.sent');
    assert.equal(BOT_EVENTS.MESSAGE_ERROR, 'message.error');
    assert.equal(BOT_EVENTS.TOOL_CALLED, 'tool.called');
    assert.equal(BOT_EVENTS.TOOL_ERROR, 'tool.error');
  });

  test('is a frozen object', () => {
    assert.ok(Object.isFrozen(BOT_EVENTS));
  });

  test('cannot be modified', () => {
    assert.throws(() => {
      BOT_EVENTS.NEW_EVENT = 'new.event';
    });
  });

  test('has exactly 8 event types', () => {
    assert.equal(Object.keys(BOT_EVENTS).length, 8);
  });
});

describe('BotEventEmitter', () => {
  let emitter;

  beforeEach(() => {
    emitter = new BotEventEmitter();
  });

  describe('constructor', () => {
    test('creates instance without options', () => {
      const instance = new BotEventEmitter();
      assert.ok(instance);
      assert.equal(instance.logger, null);
    });

    test('accepts logger option', () => {
      const logger = mock.fn();
      const instance = new BotEventEmitter({ logger });
      assert.equal(instance.logger, logger);
    });

    test('extends EventEmitter', () => {
      assert.equal(typeof emitter.on, 'function');
      assert.equal(typeof emitter.emit, 'function');
      assert.equal(typeof emitter.off, 'function');
      assert.equal(typeof emitter.removeAllListeners, 'function');
    });
  });

  describe('static isValidEvent()', () => {
    test('returns true for valid event names', () => {
      assert.ok(BotEventEmitter.isValidEvent('bot.started'));
      assert.ok(BotEventEmitter.isValidEvent('bot.stopped'));
      assert.ok(BotEventEmitter.isValidEvent('bot.error'));
      assert.ok(BotEventEmitter.isValidEvent('message.received'));
      assert.ok(BotEventEmitter.isValidEvent('message.sent'));
      assert.ok(BotEventEmitter.isValidEvent('message.error'));
      assert.ok(BotEventEmitter.isValidEvent('tool.called'));
      assert.ok(BotEventEmitter.isValidEvent('tool.error'));
    });

    test('returns false for invalid event names', () => {
      assert.equal(BotEventEmitter.isValidEvent('invalid.event'), false);
      assert.equal(BotEventEmitter.isValidEvent(''), false);
      assert.equal(BotEventEmitter.isValidEvent('bot'), false);
      assert.equal(BotEventEmitter.isValidEvent('message'), false);
    });
  });

  describe('static getEventNames()', () => {
    test('returns all valid event names', () => {
      const names = BotEventEmitter.getEventNames();
      assert.ok(Array.isArray(names));
      assert.equal(names.length, 8);
      assert.ok(names.includes('bot.started'));
      assert.ok(names.includes('bot.stopped'));
      assert.ok(names.includes('bot.error'));
      assert.ok(names.includes('message.received'));
      assert.ok(names.includes('message.sent'));
      assert.ok(names.includes('message.error'));
      assert.ok(names.includes('tool.called'));
      assert.ok(names.includes('tool.error'));
    });

    test('returns a new array each time', () => {
      const names1 = BotEventEmitter.getEventNames();
      const names2 = BotEventEmitter.getEventNames();
      assert.notEqual(names1, names2);
      assert.deepEqual(names1, names2);
    });
  });

  describe('emitBotStarted()', () => {
    test('emits bot.started event with correct payload', () => {
      const handler = mock.fn();
      emitter.on(BOT_EVENTS.BOT_STARTED, handler);

      emitter.emitBotStarted('work-bot', { name: 'Work Assistant' });

      assert.equal(handler.mock.calls.length, 1);
      const payload = handler.mock.calls[0].arguments[0];
      assert.equal(payload.event, 'bot.started');
      assert.equal(payload.bot.id, 'work-bot');
      assert.equal(payload.bot.name, 'Work Assistant');
      assert.ok(payload.timestamp);
    });

    test('uses botId as name when name not provided', () => {
      const handler = mock.fn();
      emitter.on(BOT_EVENTS.BOT_STARTED, handler);

      emitter.emitBotStarted('work-bot');

      const payload = handler.mock.calls[0].arguments[0];
      assert.equal(payload.bot.name, 'work-bot');
    });

    test('includes ISO timestamp', () => {
      const handler = mock.fn();
      emitter.on(BOT_EVENTS.BOT_STARTED, handler);

      emitter.emitBotStarted('work-bot');

      const payload = handler.mock.calls[0].arguments[0];
      // Verify it's a valid ISO string
      const parsed = new Date(payload.timestamp);
      assert.ok(!isNaN(parsed.getTime()));
    });
  });

  describe('emitBotStopped()', () => {
    test('emits bot.stopped event with correct payload', () => {
      const handler = mock.fn();
      emitter.on(BOT_EVENTS.BOT_STOPPED, handler);

      emitter.emitBotStopped('work-bot', { name: 'Work Assistant' });

      assert.equal(handler.mock.calls.length, 1);
      const payload = handler.mock.calls[0].arguments[0];
      assert.equal(payload.event, 'bot.stopped');
      assert.equal(payload.bot.id, 'work-bot');
      assert.equal(payload.bot.name, 'Work Assistant');
      assert.ok(payload.timestamp);
    });

    test('uses botId as name when name not provided', () => {
      const handler = mock.fn();
      emitter.on(BOT_EVENTS.BOT_STOPPED, handler);

      emitter.emitBotStopped('work-bot');

      const payload = handler.mock.calls[0].arguments[0];
      assert.equal(payload.bot.name, 'work-bot');
    });
  });

  describe('emitBotError()', () => {
    test('emits bot.error event with Error object', () => {
      const handler = mock.fn();
      emitter.on(BOT_EVENTS.BOT_ERROR, handler);

      const error = new Error('Container failed');
      emitter.emitBotError('work-bot', error, {
        name: 'Work Assistant',
        operation: 'startBot',
      });

      assert.equal(handler.mock.calls.length, 1);
      const payload = handler.mock.calls[0].arguments[0];
      assert.equal(payload.event, 'bot.error');
      assert.equal(payload.bot.id, 'work-bot');
      assert.equal(payload.bot.name, 'Work Assistant');
      assert.equal(payload.error.message, 'Container failed');
      assert.equal(payload.error.operation, 'startBot');
      assert.ok(payload.timestamp);
    });

    test('emits bot.error event with string error', () => {
      const handler = mock.fn();
      emitter.on(BOT_EVENTS.BOT_ERROR, handler);

      emitter.emitBotError('work-bot', 'Something went wrong');

      const payload = handler.mock.calls[0].arguments[0];
      assert.equal(payload.error.message, 'Something went wrong');
      assert.equal(payload.error.operation, null);
    });
  });

  describe('emitMessageReceived()', () => {
    test('emits message.received event with correct payload', () => {
      const handler = mock.fn();
      emitter.on(BOT_EVENTS.MESSAGE_RECEIVED, handler);

      emitter.emitMessageReceived('work-bot', {
        userId: 'U123',
        channelId: 'C456',
        text: 'Hello bot!',
        sessionId: 'work-bot:slack:C456:U123',
      });

      assert.equal(handler.mock.calls.length, 1);
      const payload = handler.mock.calls[0].arguments[0];
      assert.equal(payload.event, 'message.received');
      assert.equal(payload.bot.id, 'work-bot');
      assert.equal(payload.message.userId, 'U123');
      assert.equal(payload.message.channelId, 'C456');
      assert.equal(payload.message.text, 'Hello bot!');
      assert.equal(payload.message.sessionId, 'work-bot:slack:C456:U123');
      assert.ok(payload.timestamp);
    });

    test('sets sessionId to null when not provided', () => {
      const handler = mock.fn();
      emitter.on(BOT_EVENTS.MESSAGE_RECEIVED, handler);

      emitter.emitMessageReceived('work-bot', {
        userId: 'U123',
        channelId: 'C456',
        text: 'Hello!',
      });

      const payload = handler.mock.calls[0].arguments[0];
      assert.equal(payload.message.sessionId, null);
    });
  });

  describe('emitMessageSent()', () => {
    test('emits message.sent event with correct payload', () => {
      const handler = mock.fn();
      emitter.on(BOT_EVENTS.MESSAGE_SENT, handler);

      emitter.emitMessageSent('work-bot', {
        userId: 'U123',
        channelId: 'C456',
        text: 'Here is my response.',
        sessionId: 'work-bot:slack:C456:U123',
        durationMs: 1500,
        toolCalls: [{ toolName: 'bash', args: { command: 'ls' } }],
      });

      assert.equal(handler.mock.calls.length, 1);
      const payload = handler.mock.calls[0].arguments[0];
      assert.equal(payload.event, 'message.sent');
      assert.equal(payload.bot.id, 'work-bot');
      assert.equal(payload.message.userId, 'U123');
      assert.equal(payload.message.channelId, 'C456');
      assert.equal(payload.message.text, 'Here is my response.');
      assert.equal(payload.message.sessionId, 'work-bot:slack:C456:U123');
      assert.equal(payload.message.durationMs, 1500);
      assert.equal(payload.message.toolCalls.length, 1);
      assert.ok(payload.timestamp);
    });

    test('defaults optional fields to null/empty', () => {
      const handler = mock.fn();
      emitter.on(BOT_EVENTS.MESSAGE_SENT, handler);

      emitter.emitMessageSent('work-bot', {
        userId: 'U123',
        channelId: 'C456',
        text: 'Response.',
      });

      const payload = handler.mock.calls[0].arguments[0];
      assert.equal(payload.message.sessionId, null);
      assert.equal(payload.message.durationMs, null);
      assert.deepEqual(payload.message.toolCalls, []);
    });
  });

  describe('emitMessageError()', () => {
    test('emits message.error event with Error object', () => {
      const handler = mock.fn();
      emitter.on(BOT_EVENTS.MESSAGE_ERROR, handler);

      const error = new Error('LLM timeout');
      emitter.emitMessageError('work-bot', error, {
        userId: 'U123',
        channelId: 'C456',
        sessionId: 'work-bot:slack:C456:U123',
      });

      assert.equal(handler.mock.calls.length, 1);
      const payload = handler.mock.calls[0].arguments[0];
      assert.equal(payload.event, 'message.error');
      assert.equal(payload.bot.id, 'work-bot');
      assert.equal(payload.error.message, 'LLM timeout');
      assert.equal(payload.message.userId, 'U123');
      assert.equal(payload.message.channelId, 'C456');
      assert.equal(payload.message.sessionId, 'work-bot:slack:C456:U123');
      assert.ok(payload.timestamp);
    });

    test('emits message.error event with string error', () => {
      const handler = mock.fn();
      emitter.on(BOT_EVENTS.MESSAGE_ERROR, handler);

      emitter.emitMessageError('work-bot', 'Processing failed');

      const payload = handler.mock.calls[0].arguments[0];
      assert.equal(payload.error.message, 'Processing failed');
    });

    test('defaults message context to null', () => {
      const handler = mock.fn();
      emitter.on(BOT_EVENTS.MESSAGE_ERROR, handler);

      emitter.emitMessageError('work-bot', 'Error');

      const payload = handler.mock.calls[0].arguments[0];
      assert.equal(payload.message.userId, null);
      assert.equal(payload.message.channelId, null);
      assert.equal(payload.message.sessionId, null);
    });
  });

  describe('emitToolCalled()', () => {
    test('emits tool.called event with correct payload', () => {
      const handler = mock.fn();
      emitter.on(BOT_EVENTS.TOOL_CALLED, handler);

      emitter.emitToolCalled('work-bot', {
        toolName: 'bash',
        args: { command: 'ls -la' },
        result: 'file1.txt\nfile2.txt',
        sessionId: 'work-bot:slack:C456:U123',
      });

      assert.equal(handler.mock.calls.length, 1);
      const payload = handler.mock.calls[0].arguments[0];
      assert.equal(payload.event, 'tool.called');
      assert.equal(payload.bot.id, 'work-bot');
      assert.equal(payload.tool.name, 'bash');
      assert.deepEqual(payload.tool.args, { command: 'ls -la' });
      assert.equal(payload.tool.result, 'file1.txt\nfile2.txt');
      assert.equal(payload.tool.sessionId, 'work-bot:slack:C456:U123');
      assert.ok(payload.timestamp);
    });

    test('defaults optional fields to null', () => {
      const handler = mock.fn();
      emitter.on(BOT_EVENTS.TOOL_CALLED, handler);

      emitter.emitToolCalled('work-bot', {
        toolName: 'readFile',
      });

      const payload = handler.mock.calls[0].arguments[0];
      assert.equal(payload.tool.args, null);
      assert.equal(payload.tool.result, null);
      assert.equal(payload.tool.sessionId, null);
    });
  });

  describe('emitToolError()', () => {
    test('emits tool.error event with Error object', () => {
      const handler = mock.fn();
      emitter.on(BOT_EVENTS.TOOL_ERROR, handler);

      const error = new Error('Permission denied');
      emitter.emitToolError('work-bot', {
        toolName: 'bash',
        args: { command: 'rm -rf /' },
        error,
        sessionId: 'work-bot:slack:C456:U123',
      });

      assert.equal(handler.mock.calls.length, 1);
      const payload = handler.mock.calls[0].arguments[0];
      assert.equal(payload.event, 'tool.error');
      assert.equal(payload.bot.id, 'work-bot');
      assert.equal(payload.tool.name, 'bash');
      assert.deepEqual(payload.tool.args, { command: 'rm -rf /' });
      assert.equal(payload.tool.sessionId, 'work-bot:slack:C456:U123');
      assert.equal(payload.error.message, 'Permission denied');
      assert.ok(payload.timestamp);
    });

    test('emits tool.error event with string error', () => {
      const handler = mock.fn();
      emitter.on(BOT_EVENTS.TOOL_ERROR, handler);

      emitter.emitToolError('work-bot', {
        toolName: 'webFetch',
        error: 'Network timeout',
      });

      const payload = handler.mock.calls[0].arguments[0];
      assert.equal(payload.error.message, 'Network timeout');
    });
  });

  describe('logging', () => {
    test('calls logger when events are emitted', () => {
      const logger = mock.fn();
      const instance = new BotEventEmitter({ logger });

      instance.emitBotStarted('work-bot');

      assert.equal(logger.mock.calls.length, 1);
      assert.ok(logger.mock.calls[0].arguments[0].includes('bot.started'));
      assert.ok(logger.mock.calls[0].arguments[0].includes('work-bot'));
    });

    test('does not throw when logger is null', () => {
      const instance = new BotEventEmitter();
      assert.doesNotThrow(() => {
        instance.emitBotStarted('work-bot');
      });
    });
  });

  describe('multiple listeners', () => {
    test('notifies all listeners for the same event', () => {
      const handler1 = mock.fn();
      const handler2 = mock.fn();

      emitter.on(BOT_EVENTS.BOT_STARTED, handler1);
      emitter.on(BOT_EVENTS.BOT_STARTED, handler2);

      emitter.emitBotStarted('work-bot');

      assert.equal(handler1.mock.calls.length, 1);
      assert.equal(handler2.mock.calls.length, 1);
    });

    test('only notifies listeners for the emitted event', () => {
      const startHandler = mock.fn();
      const stopHandler = mock.fn();

      emitter.on(BOT_EVENTS.BOT_STARTED, startHandler);
      emitter.on(BOT_EVENTS.BOT_STOPPED, stopHandler);

      emitter.emitBotStarted('work-bot');

      assert.equal(startHandler.mock.calls.length, 1);
      assert.equal(stopHandler.mock.calls.length, 0);
    });
  });

  describe('once listeners', () => {
    test('supports once listeners via EventEmitter', () => {
      const handler = mock.fn();
      emitter.once(BOT_EVENTS.BOT_STARTED, handler);

      emitter.emitBotStarted('work-bot');
      emitter.emitBotStarted('work-bot');

      assert.equal(handler.mock.calls.length, 1);
    });
  });

  describe('listener removal', () => {
    test('supports removing listeners', () => {
      const handler = mock.fn();
      emitter.on(BOT_EVENTS.BOT_STARTED, handler);

      emitter.emitBotStarted('work-bot');
      assert.equal(handler.mock.calls.length, 1);

      emitter.off(BOT_EVENTS.BOT_STARTED, handler);
      emitter.emitBotStarted('work-bot');
      assert.equal(handler.mock.calls.length, 1);
    });
  });
});

describe('BotEventEmitter integration with BotManager', () => {
  test('BotManager emits bot.started on successful startBot', async () => {
    const { BotManager } = await import('../../../src/core/bot-manager.js');

    const emitter = new BotEventEmitter();
    const handler = mock.fn();
    emitter.on(BOT_EVENTS.BOT_STARTED, handler);

    const mockStorage = { query: mock.fn(async () => ({ rows: [] })) };
    const mockContainerPool = {
      initializeContainer: mock.fn(async botId => ({ id: `c-${botId}`, botId })),
      recycleContainer: mock.fn(async () => {}),
      hasContainer: mock.fn(() => false),
    };
    const mockSoulLoader = {
      load: mock.fn(async () => 'You are a test bot.'),
    };
    const mockValidator = {
      validateBotConfig: mock.fn(config => ({
        ...config,
        enabled: true,
        tools: config.tools || [],
        mcpServers: config.mcpServers || [],
        skills: config.skills || [],
        maxSteps: 30,
        sessionPer: 'user',
        compactionThreshold: 50000,
      })),
    };

    const manager = new BotManager(mockStorage, mockContainerPool, mockSoulLoader, {
      configValidator: mockValidator,
      eventEmitter: emitter,
    });

    await manager.loadBot('test-bot', {
      id: 'test-bot',
      soul: './soul.md',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      name: 'Test Bot',
    });
    await manager.startBot('test-bot');

    assert.equal(handler.mock.calls.length, 1);
    const payload = handler.mock.calls[0].arguments[0];
    assert.equal(payload.event, 'bot.started');
    assert.equal(payload.bot.id, 'test-bot');
    assert.equal(payload.bot.name, 'Test Bot');
  });

  test('BotManager emits bot.stopped on successful stopBot', async () => {
    const { BotManager } = await import('../../../src/core/bot-manager.js');

    const emitter = new BotEventEmitter();
    const handler = mock.fn();
    emitter.on(BOT_EVENTS.BOT_STOPPED, handler);

    const mockStorage = { query: mock.fn(async () => ({ rows: [] })) };
    const mockContainerPool = {
      initializeContainer: mock.fn(async botId => ({ id: `c-${botId}`, botId })),
      recycleContainer: mock.fn(async () => {}),
      hasContainer: mock.fn(() => true),
    };
    const mockSoulLoader = {
      load: mock.fn(async () => 'You are a test bot.'),
    };
    const mockValidator = {
      validateBotConfig: mock.fn(config => ({
        ...config,
        enabled: true,
        tools: config.tools || [],
        mcpServers: config.mcpServers || [],
        skills: config.skills || [],
        maxSteps: 30,
        sessionPer: 'user',
        compactionThreshold: 50000,
      })),
    };

    const manager = new BotManager(mockStorage, mockContainerPool, mockSoulLoader, {
      configValidator: mockValidator,
      eventEmitter: emitter,
    });

    await manager.loadBot('test-bot', {
      id: 'test-bot',
      soul: './soul.md',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      name: 'Test Bot',
    });
    await manager.startBot('test-bot');
    await manager.stopBot('test-bot');

    assert.equal(handler.mock.calls.length, 1);
    const payload = handler.mock.calls[0].arguments[0];
    assert.equal(payload.event, 'bot.stopped');
    assert.equal(payload.bot.id, 'test-bot');
  });

  test('BotManager emits bot.error on startBot failure', async () => {
    const { BotManager } = await import('../../../src/core/bot-manager.js');

    const emitter = new BotEventEmitter();
    const handler = mock.fn();
    emitter.on(BOT_EVENTS.BOT_ERROR, handler);

    const mockStorage = { query: mock.fn(async () => ({ rows: [] })) };
    const mockContainerPool = {
      initializeContainer: mock.fn(async () => {
        throw new Error('Docker daemon unavailable');
      }),
      recycleContainer: mock.fn(async () => {}),
      hasContainer: mock.fn(() => false),
    };
    const mockSoulLoader = {
      load: mock.fn(async () => 'You are a test bot.'),
    };
    const mockValidator = {
      validateBotConfig: mock.fn(config => ({
        ...config,
        enabled: true,
        tools: config.tools || [],
        mcpServers: config.mcpServers || [],
        skills: config.skills || [],
        maxSteps: 30,
        sessionPer: 'user',
        compactionThreshold: 50000,
      })),
    };

    const manager = new BotManager(mockStorage, mockContainerPool, mockSoulLoader, {
      configValidator: mockValidator,
      eventEmitter: emitter,
    });

    await manager.loadBot('test-bot', {
      id: 'test-bot',
      soul: './soul.md',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      name: 'Test Bot',
    });

    await assert.rejects(() => manager.startBot('test-bot'));

    assert.equal(handler.mock.calls.length, 1);
    const payload = handler.mock.calls[0].arguments[0];
    assert.equal(payload.event, 'bot.error');
    assert.equal(payload.bot.id, 'test-bot');
    assert.ok(payload.error.message.includes('Docker daemon unavailable'));
    assert.equal(payload.error.operation, 'startBot');
  });

  test('BotManager works normally without eventEmitter', async () => {
    const { BotManager } = await import('../../../src/core/bot-manager.js');

    const mockStorage = { query: mock.fn(async () => ({ rows: [] })) };
    const mockContainerPool = {
      initializeContainer: mock.fn(async botId => ({ id: `c-${botId}`, botId })),
      recycleContainer: mock.fn(async () => {}),
      hasContainer: mock.fn(() => false),
    };
    const mockSoulLoader = {
      load: mock.fn(async () => 'You are a test bot.'),
    };
    const mockValidator = {
      validateBotConfig: mock.fn(config => ({
        ...config,
        enabled: true,
        tools: config.tools || [],
        mcpServers: config.mcpServers || [],
        skills: config.skills || [],
        maxSteps: 30,
        sessionPer: 'user',
        compactionThreshold: 50000,
      })),
    };

    // No eventEmitter provided
    const manager = new BotManager(mockStorage, mockContainerPool, mockSoulLoader, {
      configValidator: mockValidator,
    });

    await manager.loadBot('test-bot', {
      id: 'test-bot',
      soul: './soul.md',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
    });

    // Should not throw
    await manager.startBot('test-bot');
    await manager.stopBot('test-bot');
  });
});

describe('BotEventEmitter integration with MessageProcessor', () => {
  /**
   * Create mock dependencies for MessageProcessor
   */
  function createMockDeps() {
    return {
      sessionManager: {
        getSession: mock.fn(async () => ({ id: 'session-123', messages: [] })),
        appendMessage: mock.fn(async () => {}),
        getMessagesForLLM: mock.fn(() => []),
      },
      agentRunner: {
        run: mock.fn(async () => ({
          text: 'Hello! How can I help?',
          toolCalls: [],
          usage: { totalTokens: 100 },
          steps: [],
        })),
      },
      storage: {
        logToolCall: mock.fn(async () => 1),
      },
    };
  }

  test('MessageProcessor emits message.received and message.sent', async () => {
    const { MessageProcessor } = await import('../../../src/core/message-processor.js');
    const deps = createMockDeps();
    const emitter = new BotEventEmitter();
    const receivedHandler = mock.fn();
    const sentHandler = mock.fn();

    emitter.on(BOT_EVENTS.MESSAGE_RECEIVED, receivedHandler);
    emitter.on(BOT_EVENTS.MESSAGE_SENT, sentHandler);

    const processor = new MessageProcessor(deps.sessionManager, deps.agentRunner, deps.storage, {
      eventEmitter: emitter,
    });

    await processor.processMessage(
      { id: 'work-bot', provider: 'anthropic', model: 'claude-sonnet-4-5' },
      { type: 'slack', userId: 'U123', channelId: 'C456', text: 'Hello!' }
    );

    // message.received should fire
    assert.equal(receivedHandler.mock.calls.length, 1);
    const receivedPayload = receivedHandler.mock.calls[0].arguments[0];
    assert.equal(receivedPayload.event, 'message.received');
    assert.equal(receivedPayload.bot.id, 'work-bot');
    assert.equal(receivedPayload.message.userId, 'U123');
    assert.equal(receivedPayload.message.text, 'Hello!');

    // message.sent should fire
    assert.equal(sentHandler.mock.calls.length, 1);
    const sentPayload = sentHandler.mock.calls[0].arguments[0];
    assert.equal(sentPayload.event, 'message.sent');
    assert.equal(sentPayload.bot.id, 'work-bot');
    assert.equal(sentPayload.message.text, 'Hello! How can I help?');
    assert.ok(sentPayload.message.durationMs >= 0);
  });

  test('MessageProcessor emits message.error on failure', async () => {
    const { MessageProcessor } = await import('../../../src/core/message-processor.js');
    const deps = createMockDeps();
    deps.agentRunner.run = mock.fn(async () => {
      throw new Error('LLM timeout');
    });

    const emitter = new BotEventEmitter();
    const errorHandler = mock.fn();
    emitter.on(BOT_EVENTS.MESSAGE_ERROR, errorHandler);

    const processor = new MessageProcessor(deps.sessionManager, deps.agentRunner, deps.storage, {
      eventEmitter: emitter,
    });

    await assert.rejects(() =>
      processor.processMessage(
        { id: 'work-bot', provider: 'anthropic', model: 'claude-sonnet-4-5' },
        { type: 'slack', userId: 'U123', channelId: 'C456', text: 'Hello!' }
      )
    );

    assert.equal(errorHandler.mock.calls.length, 1);
    const payload = errorHandler.mock.calls[0].arguments[0];
    assert.equal(payload.event, 'message.error');
    assert.equal(payload.bot.id, 'work-bot');
    assert.ok(payload.error.message.includes('LLM timeout'));
  });

  test('MessageProcessor emits tool.called for successful tool calls', async () => {
    const { MessageProcessor } = await import('../../../src/core/message-processor.js');
    const deps = createMockDeps();
    deps.agentRunner.run = mock.fn(async () => ({
      text: 'Done!',
      toolCalls: [{ toolName: 'bash', args: { command: 'ls' } }],
      usage: { totalTokens: 200 },
      steps: [
        {
          toolCalls: [{ toolCallId: 'tc-1', toolName: 'bash', args: { command: 'ls' } }],
          toolResults: [{ toolCallId: 'tc-1', result: 'file1.txt', isError: false }],
        },
      ],
    }));

    const emitter = new BotEventEmitter();
    const toolHandler = mock.fn();
    emitter.on(BOT_EVENTS.TOOL_CALLED, toolHandler);

    const processor = new MessageProcessor(deps.sessionManager, deps.agentRunner, deps.storage, {
      eventEmitter: emitter,
    });

    await processor.processMessage(
      { id: 'work-bot', provider: 'anthropic', model: 'claude-sonnet-4-5' },
      { type: 'slack', userId: 'U123', channelId: 'C456', text: 'List files' }
    );

    assert.equal(toolHandler.mock.calls.length, 1);
    const payload = toolHandler.mock.calls[0].arguments[0];
    assert.equal(payload.event, 'tool.called');
    assert.equal(payload.tool.name, 'bash');
    assert.equal(payload.tool.result, 'file1.txt');
  });

  test('MessageProcessor emits tool.error for failed tool calls', async () => {
    const { MessageProcessor } = await import('../../../src/core/message-processor.js');
    const deps = createMockDeps();
    deps.agentRunner.run = mock.fn(async () => ({
      text: 'Tool failed.',
      toolCalls: [{ toolName: 'bash', args: { command: 'rm /' } }],
      usage: { totalTokens: 200 },
      steps: [
        {
          toolCalls: [{ toolCallId: 'tc-1', toolName: 'bash', args: { command: 'rm /' } }],
          toolResults: [{ toolCallId: 'tc-1', result: 'Permission denied', isError: true }],
        },
      ],
    }));

    const emitter = new BotEventEmitter();
    const toolErrorHandler = mock.fn();
    emitter.on(BOT_EVENTS.TOOL_ERROR, toolErrorHandler);

    const processor = new MessageProcessor(deps.sessionManager, deps.agentRunner, deps.storage, {
      eventEmitter: emitter,
    });

    await processor.processMessage(
      { id: 'work-bot', provider: 'anthropic', model: 'claude-sonnet-4-5' },
      { type: 'slack', userId: 'U123', channelId: 'C456', text: 'Delete everything' }
    );

    assert.equal(toolErrorHandler.mock.calls.length, 1);
    const payload = toolErrorHandler.mock.calls[0].arguments[0];
    assert.equal(payload.event, 'tool.error');
    assert.equal(payload.tool.name, 'bash');
    assert.equal(payload.error.message, 'Permission denied');
  });

  test('MessageProcessor works normally without eventEmitter', async () => {
    const { MessageProcessor } = await import('../../../src/core/message-processor.js');
    const deps = createMockDeps();

    // No eventEmitter provided
    const processor = new MessageProcessor(deps.sessionManager, deps.agentRunner, deps.storage);

    // Should not throw
    const result = await processor.processMessage(
      { id: 'work-bot', provider: 'anthropic', model: 'claude-sonnet-4-5' },
      { type: 'slack', userId: 'U123', channelId: 'C456', text: 'Hello!' }
    );

    assert.equal(result.text, 'Hello! How can I help?');
  });
});
