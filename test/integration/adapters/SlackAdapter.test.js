/**
 * Integration tests for SlackAdapter
 *
 * Tests the Slack channel adapter with mock Slack events.
 * Uses a mock @slack/bolt App to simulate Slack event delivery,
 * message sending, and connection lifecycle without requiring
 * real Slack credentials.
 *
 * Covers:
 * - Constructor validation
 * - Initialization and lifecycle (start/stop)
 * - app_mention event handling
 * - DM (im) message handling
 * - Message sending via chat.postMessage
 * - cleanMention() text processing
 * - Error propagation
 *
 * @module test/integration/adapters/SlackAdapter
 */

import { describe, test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Mock @slack/bolt
//
// The SlackAdapter imports `bolt` from '@slack/bolt' and destructures `App`.
// We mock the module so that `new App(...)` returns our controllable fake.
// ---------------------------------------------------------------------------

/** Captured event listeners registered via `app.event(eventName, handler)` */
let eventHandlers;

/** Spy for `app.client.chat.postMessage` */
let postMessageSpy;

/** Controls whether `app.start()` / `app.stop()` reject */
let startShouldFail;
let stopShouldFail;

/**
 * Reset all mock state before each test
 */
function resetMockState() {
  eventHandlers = {};
  postMessageSpy = mock.fn(async () => ({ ok: true, ts: '1234567890.123456' }));
  startShouldFail = false;
  stopShouldFail = false;
}

/**
 * Fake Bolt App constructor
 * Records config and provides controllable event/start/stop/client mocks.
 */
class MockBoltApp {
  constructor(config) {
    this._config = config;
    this.client = {
      chat: {
        postMessage: postMessageSpy,
      },
    };
  }

  event(eventName, handler) {
    if (!eventHandlers[eventName]) {
      eventHandlers[eventName] = [];
    }
    eventHandlers[eventName].push(handler);
  }

  async start() {
    if (startShouldFail) {
      throw new Error('Mock Slack connection failed');
    }
  }

  async stop() {
    if (stopShouldFail) {
      throw new Error('Mock Slack disconnect failed');
    }
  }
}

// Register the mock before importing SlackAdapter.
// Note: Node.js mock.module() uses `defaultExport` (not `default`) to set the
// module's default export. The source does `import bolt from '@slack/bolt'` then
// `const { App } = bolt`, so we provide App on the default export object.
// Named export is also provided for completeness.
mock.module('@slack/bolt', {
  defaultExport: { App: MockBoltApp },
  namedExports: { App: MockBoltApp },
});

// Dynamic import AFTER mock registration
const { SlackAdapter, SlackAdapterError } = await import('../../../src/adapters/channels/slack.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a valid config object for the adapter
 * @param {Object} overrides - Properties to override
 * @returns {Object} Slack config
 */
function createValidConfig(overrides = {}) {
  return {
    botToken: 'xoxb-test-bot-token-123',
    appToken: 'xapp-test-app-token-456',
    signingSecret: 'test-signing-secret-789',
    ...overrides,
  };
}

/**
 * Create and initialize a SlackAdapter ready for testing
 * @param {Object} [configOverrides] - Config overrides
 * @returns {Promise<SlackAdapter>} Initialized adapter
 */
async function createInitializedAdapter(configOverrides = {}) {
  const adapter = new SlackAdapter(createValidConfig(configOverrides));
  await adapter.initialize();
  return adapter;
}

/**
 * Simulate a Slack app_mention event through the mock
 * @param {Object} event - Slack app_mention event payload
 */
async function simulateAppMention(event) {
  const handlers = eventHandlers.app_mention || [];
  for (const handler of handlers) {
    await handler({ event });
  }
}

/**
 * Simulate a Slack message event through the mock
 * @param {Object} event - Slack message event payload
 */
async function simulateMessage(event) {
  const handlers = eventHandlers.message || [];
  for (const handler of handlers) {
    await handler({ event });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SlackAdapter', () => {
  beforeEach(() => {
    resetMockState();
  });

  // ========================================================================
  // Constructor Validation
  // ========================================================================

  describe('constructor', () => {
    test('creates instance with valid config', () => {
      const config = createValidConfig();
      const adapter = new SlackAdapter(config);

      assert.ok(adapter, 'Adapter should be created');
      assert.equal(adapter.initialized, false);
      assert.equal(adapter.started, false);
      assert.equal(adapter.messageHandler, null);
    });

    test('throws SlackAdapterError when config is missing', () => {
      assert.throws(
        () => new SlackAdapter(),
        err => {
          assert.ok(err instanceof SlackAdapterError);
          assert.equal(err.name, 'SlackAdapterError');
          assert.match(err.message, /config.*required/i);
          assert.equal(err.operation, 'constructor');
          return true;
        }
      );
    });

    test('throws SlackAdapterError when config is not an object', () => {
      assert.throws(
        () => new SlackAdapter('not-an-object'),
        err => {
          assert.ok(err instanceof SlackAdapterError);
          assert.match(err.message, /config.*required/i);
          return true;
        }
      );
    });

    test('throws SlackAdapterError when botToken is missing', () => {
      assert.throws(
        () => new SlackAdapter({ appToken: 'xapp-test', signingSecret: 'secret' }),
        err => {
          assert.ok(err instanceof SlackAdapterError);
          assert.match(err.message, /botToken.*required/i);
          assert.equal(err.operation, 'constructor');
          return true;
        }
      );
    });

    test('throws SlackAdapterError when appToken is missing', () => {
      assert.throws(
        () => new SlackAdapter({ botToken: 'xoxb-test', signingSecret: 'secret' }),
        err => {
          assert.ok(err instanceof SlackAdapterError);
          assert.match(err.message, /appToken.*required/i);
          assert.equal(err.operation, 'constructor');
          return true;
        }
      );
    });

    test('throws SlackAdapterError when signingSecret is missing', () => {
      assert.throws(
        () => new SlackAdapter({ botToken: 'xoxb-test', appToken: 'xapp-test' }),
        err => {
          assert.ok(err instanceof SlackAdapterError);
          assert.match(err.message, /signingSecret.*required/i);
          assert.equal(err.operation, 'constructor');
          return true;
        }
      );
    });
  });

  // ========================================================================
  // Initialization
  // ========================================================================

  describe('initialize()', () => {
    test('initializes successfully with valid config', async () => {
      const adapter = new SlackAdapter(createValidConfig());

      await adapter.initialize();

      assert.equal(adapter.initialized, true);
      assert.ok(adapter.app, 'Should have Bolt App instance');
    });

    test('registers app_mention and message event handlers', async () => {
      const adapter = new SlackAdapter(createValidConfig());

      await adapter.initialize();

      assert.ok(eventHandlers.app_mention, 'Should register app_mention handler');
      assert.ok(eventHandlers.message, 'Should register message handler');
      assert.equal(eventHandlers.app_mention.length, 1);
      assert.equal(eventHandlers.message.length, 1);
    });

    test('is idempotent - second call is a no-op', async () => {
      const adapter = new SlackAdapter(createValidConfig());

      await adapter.initialize();
      const appAfterFirst = adapter.app;

      await adapter.initialize();
      const appAfterSecond = adapter.app;

      assert.equal(appAfterFirst, appAfterSecond, 'App should not be recreated');
    });

    test('passes correct config to Bolt App', async () => {
      const config = createValidConfig();
      const adapter = new SlackAdapter(config);

      await adapter.initialize();

      assert.equal(adapter.app._config.token, config.botToken);
      assert.equal(adapter.app._config.appToken, config.appToken);
      assert.equal(adapter.app._config.socketMode, true);
      assert.equal(adapter.app._config.signingSecret, config.signingSecret);
    });
  });

  // ========================================================================
  // Start / Stop Lifecycle
  // ========================================================================

  describe('start()', () => {
    test('starts successfully after initialization', async () => {
      const adapter = await createInitializedAdapter();

      await adapter.start();

      assert.equal(adapter.started, true);
    });

    test('throws if not initialized', async () => {
      const adapter = new SlackAdapter(createValidConfig());

      await assert.rejects(
        () => adapter.start(),
        err => {
          assert.ok(err instanceof SlackAdapterError);
          assert.match(err.message, /not initialized/i);
          assert.equal(err.operation, 'start');
          return true;
        }
      );
    });

    test('is idempotent - second call is a no-op', async () => {
      const adapter = await createInitializedAdapter();

      await adapter.start();
      await adapter.start(); // Should not throw

      assert.equal(adapter.started, true);
    });

    test('wraps Bolt start errors in SlackAdapterError', async () => {
      startShouldFail = true;
      const adapter = await createInitializedAdapter();

      await assert.rejects(
        () => adapter.start(),
        err => {
          assert.ok(err instanceof SlackAdapterError);
          assert.match(err.message, /failed to start/i);
          assert.equal(err.operation, 'start');
          assert.ok(err.cause, 'Should preserve original error as cause');
          assert.match(err.cause.message, /Mock Slack connection failed/);
          return true;
        }
      );
    });
  });

  describe('stop()', () => {
    test('stops a started adapter', async () => {
      const adapter = await createInitializedAdapter();
      await adapter.start();

      await adapter.stop();

      assert.equal(adapter.started, false);
    });

    test('is a no-op when not started', async () => {
      const adapter = await createInitializedAdapter();

      await adapter.stop(); // Should not throw

      assert.equal(adapter.started, false);
    });

    test('is a no-op when app is null', async () => {
      const adapter = new SlackAdapter(createValidConfig());

      await adapter.stop(); // Should not throw
    });

    test('wraps Bolt stop errors in SlackAdapterError', async () => {
      const adapter = await createInitializedAdapter();
      await adapter.start();
      stopShouldFail = true;

      await assert.rejects(
        () => adapter.stop(),
        err => {
          assert.ok(err instanceof SlackAdapterError);
          assert.match(err.message, /failed to stop/i);
          assert.equal(err.operation, 'stop');
          assert.ok(err.cause, 'Should preserve original error as cause');
          return true;
        }
      );
    });
  });

  // ========================================================================
  // onMessage Handler Registration
  // ========================================================================

  describe('onMessage()', () => {
    test('registers a message handler', async () => {
      const adapter = await createInitializedAdapter();
      const handler = mock.fn();

      adapter.onMessage(handler);

      assert.equal(adapter.messageHandler, handler);
    });

    test('throws when handler is not a function', async () => {
      const adapter = await createInitializedAdapter();

      assert.throws(
        () => adapter.onMessage('not-a-function'),
        err => {
          assert.ok(err instanceof SlackAdapterError);
          assert.match(err.message, /must be a function/i);
          assert.equal(err.operation, 'onMessage');
          return true;
        }
      );
    });

    test('throws when handler is null', () => {
      const adapter = new SlackAdapter(createValidConfig());

      assert.throws(
        () => adapter.onMessage(null),
        err => {
          assert.ok(err instanceof SlackAdapterError);
          return true;
        }
      );
    });

    test('replaces previously registered handler', async () => {
      const adapter = await createInitializedAdapter();
      const handler1 = mock.fn();
      const handler2 = mock.fn();

      adapter.onMessage(handler1);
      adapter.onMessage(handler2);

      assert.equal(adapter.messageHandler, handler2);
    });
  });

  // ========================================================================
  // app_mention Event Handling
  // ========================================================================

  describe('app_mention events', () => {
    test('dispatches app_mention event to handler with cleaned text', async () => {
      const adapter = await createInitializedAdapter();
      const handler = mock.fn();
      adapter.onMessage(handler);

      await simulateAppMention({
        user: 'U123ABC',
        channel: 'C456DEF',
        text: '<@U999BOT> hello world',
        ts: '1234567890.123456',
      });

      assert.equal(handler.mock.callCount(), 1);
      const msg = handler.mock.calls[0].arguments[0];
      assert.equal(msg.type, 'slack');
      assert.equal(msg.userId, 'U123ABC');
      assert.equal(msg.channelId, 'C456DEF');
      assert.equal(msg.text, 'hello world');
      assert.equal(msg.isDM, false);
      assert.equal(msg.threadTs, '1234567890.123456');
    });

    test('uses thread_ts when message is in a thread', async () => {
      const adapter = await createInitializedAdapter();
      const handler = mock.fn();
      adapter.onMessage(handler);

      await simulateAppMention({
        user: 'U123ABC',
        channel: 'C456DEF',
        text: '<@U999BOT> review this',
        ts: '1234567890.999999',
        thread_ts: '1234567890.000001',
      });

      assert.equal(handler.mock.callCount(), 1);
      const msg = handler.mock.calls[0].arguments[0];
      assert.equal(msg.threadTs, '1234567890.000001', 'Should use thread_ts over ts');
    });

    test('falls back to ts when thread_ts is not present', async () => {
      const adapter = await createInitializedAdapter();
      const handler = mock.fn();
      adapter.onMessage(handler);

      await simulateAppMention({
        user: 'U123ABC',
        channel: 'C456DEF',
        text: '<@U999BOT> new message',
        ts: '1111111111.111111',
      });

      const msg = handler.mock.calls[0].arguments[0];
      assert.equal(msg.threadTs, '1111111111.111111');
    });

    test('cleans multiple mentions from text', async () => {
      const adapter = await createInitializedAdapter();
      const handler = mock.fn();
      adapter.onMessage(handler);

      await simulateAppMention({
        user: 'U123ABC',
        channel: 'C456DEF',
        text: '<@U999BOT> hey <@U888OTHER> check this',
        ts: '1111111111.111111',
      });

      const msg = handler.mock.calls[0].arguments[0];
      assert.equal(msg.text, 'hey  check this');
    });

    test('silently drops event when no handler is registered', async () => {
      await createInitializedAdapter();
      // No handler registered

      // Should not throw
      await simulateAppMention({
        user: 'U123ABC',
        channel: 'C456DEF',
        text: '<@U999BOT> hello',
        ts: '1111111111.111111',
      });
    });
  });

  // ========================================================================
  // DM (message) Event Handling
  // ========================================================================

  describe('DM message events', () => {
    test('dispatches DM event to handler', async () => {
      const adapter = await createInitializedAdapter();
      const handler = mock.fn();
      adapter.onMessage(handler);

      await simulateMessage({
        user: 'U789XYZ',
        channel: 'D111DM',
        channel_type: 'im',
        text: 'Hello bot, I need help',
        ts: '9999999999.999999',
      });

      assert.equal(handler.mock.callCount(), 1);
      const msg = handler.mock.calls[0].arguments[0];
      assert.equal(msg.type, 'slack');
      assert.equal(msg.userId, 'U789XYZ');
      assert.equal(msg.channelId, 'D111DM');
      assert.equal(msg.text, 'Hello bot, I need help');
      assert.equal(msg.isDM, true);
      assert.equal(msg.threadTs, null, 'DMs should have null threadTs');
    });

    test('ignores non-DM messages (channel messages)', async () => {
      const adapter = await createInitializedAdapter();
      const handler = mock.fn();
      adapter.onMessage(handler);

      await simulateMessage({
        user: 'U789XYZ',
        channel: 'C222CHAN',
        channel_type: 'channel',
        text: 'regular channel message',
        ts: '9999999999.999999',
      });

      assert.equal(handler.mock.callCount(), 0, 'Should not dispatch non-DM messages');
    });

    test('ignores messages with subtypes (edits, deletes, bot messages)', async () => {
      const adapter = await createInitializedAdapter();
      const handler = mock.fn();
      adapter.onMessage(handler);

      // Message edit
      await simulateMessage({
        user: 'U789XYZ',
        channel: 'D111DM',
        channel_type: 'im',
        text: 'edited message',
        subtype: 'message_changed',
        ts: '9999999999.999999',
      });

      // Bot message
      await simulateMessage({
        user: 'U789XYZ',
        channel: 'D111DM',
        channel_type: 'im',
        text: 'bot message',
        subtype: 'bot_message',
        ts: '9999999999.999999',
      });

      // Message delete
      await simulateMessage({
        user: 'U789XYZ',
        channel: 'D111DM',
        channel_type: 'im',
        text: 'deleted message',
        subtype: 'message_deleted',
        ts: '9999999999.999999',
      });

      assert.equal(handler.mock.callCount(), 0, 'Should ignore all messages with subtypes');
    });

    test('silently drops DM when no handler is registered', async () => {
      await createInitializedAdapter();

      // Should not throw
      await simulateMessage({
        user: 'U789XYZ',
        channel: 'D111DM',
        channel_type: 'im',
        text: 'hello',
        ts: '9999999999.999999',
      });
    });

    test('handles group DM channel type as non-DM', async () => {
      const adapter = await createInitializedAdapter();
      const handler = mock.fn();
      adapter.onMessage(handler);

      await simulateMessage({
        user: 'U789XYZ',
        channel: 'G333GROUP',
        channel_type: 'mpim',
        text: 'group dm message',
        ts: '9999999999.999999',
      });

      assert.equal(handler.mock.callCount(), 0, 'Should ignore mpim channel_type');
    });
  });

  // ========================================================================
  // sendMessage
  // ========================================================================

  describe('sendMessage()', () => {
    test('sends a basic message to a channel', async () => {
      const adapter = await createInitializedAdapter();

      await adapter.sendMessage('C456DEF', 'Hello from bot!');

      assert.equal(postMessageSpy.mock.callCount(), 1);
      const payload = postMessageSpy.mock.calls[0].arguments[0];
      assert.equal(payload.channel, 'C456DEF');
      assert.equal(payload.text, 'Hello from bot!');
      assert.equal(payload.thread_ts, undefined, 'Should not include thread_ts when not provided');
    });

    test('sends a threaded reply when threadTs is provided', async () => {
      const adapter = await createInitializedAdapter();

      await adapter.sendMessage('C456DEF', 'Threaded reply', '1234567890.123456');

      assert.equal(postMessageSpy.mock.callCount(), 1);
      const payload = postMessageSpy.mock.calls[0].arguments[0];
      assert.equal(payload.channel, 'C456DEF');
      assert.equal(payload.text, 'Threaded reply');
      assert.equal(payload.thread_ts, '1234567890.123456');
    });

    test('throws if not initialized', async () => {
      const adapter = new SlackAdapter(createValidConfig());

      await assert.rejects(
        () => adapter.sendMessage('C456DEF', 'hello'),
        err => {
          assert.ok(err instanceof SlackAdapterError);
          assert.match(err.message, /not initialized/i);
          assert.equal(err.operation, 'sendMessage');
          return true;
        }
      );
    });

    test('throws when channelId is missing', async () => {
      const adapter = await createInitializedAdapter();

      await assert.rejects(
        () => adapter.sendMessage(null, 'hello'),
        err => {
          assert.ok(err instanceof SlackAdapterError);
          assert.match(err.message, /channelId.*required/i);
          assert.equal(err.operation, 'sendMessage');
          return true;
        }
      );
    });

    test('throws when channelId is empty string', async () => {
      const adapter = await createInitializedAdapter();

      await assert.rejects(
        () => adapter.sendMessage('', 'hello'),
        err => {
          assert.ok(err instanceof SlackAdapterError);
          assert.match(err.message, /channelId.*required/i);
          return true;
        }
      );
    });

    test('throws when text is null', async () => {
      const adapter = await createInitializedAdapter();

      await assert.rejects(
        () => adapter.sendMessage('C456DEF', null),
        err => {
          assert.ok(err instanceof SlackAdapterError);
          assert.match(err.message, /text.*required/i);
          assert.equal(err.operation, 'sendMessage');
          return true;
        }
      );
    });

    test('throws when text is undefined', async () => {
      const adapter = await createInitializedAdapter();

      await assert.rejects(
        () => adapter.sendMessage('C456DEF', undefined),
        err => {
          assert.ok(err instanceof SlackAdapterError);
          assert.match(err.message, /text.*required/i);
          assert.equal(err.operation, 'sendMessage');
          return true;
        }
      );
    });

    test('throws when text is a number (non-string)', async () => {
      const adapter = await createInitializedAdapter();

      await assert.rejects(
        () => adapter.sendMessage('C456DEF', 42),
        err => {
          assert.ok(err instanceof SlackAdapterError);
          assert.match(err.message, /text.*required/i);
          assert.equal(err.operation, 'sendMessage');
          return true;
        }
      );
    });

    test('allows empty string text', async () => {
      const adapter = await createInitializedAdapter();

      await adapter.sendMessage('C456DEF', '');

      assert.equal(postMessageSpy.mock.callCount(), 1);
      const payload = postMessageSpy.mock.calls[0].arguments[0];
      assert.equal(payload.channel, 'C456DEF');
      assert.equal(payload.text, '');
    });

    test('wraps Slack API errors in SlackAdapterError', async () => {
      const adapter = await createInitializedAdapter();
      postMessageSpy.mock.mockImplementation(async () => {
        throw new Error('channel_not_found');
      });

      await assert.rejects(
        () => adapter.sendMessage('C999INVALID', 'hello'),
        err => {
          assert.ok(err instanceof SlackAdapterError);
          assert.match(err.message, /failed to send message/i);
          assert.match(err.message, /C999INVALID/);
          assert.equal(err.operation, 'sendMessage');
          assert.ok(err.cause, 'Should preserve original Slack API error');
          assert.match(err.cause.message, /channel_not_found/);
          return true;
        }
      );
    });

    test('does not include thread_ts when threadTs is undefined', async () => {
      const adapter = await createInitializedAdapter();

      await adapter.sendMessage('C456DEF', 'No thread');

      const payload = postMessageSpy.mock.calls[0].arguments[0];
      assert.ok(!('thread_ts' in payload), 'Payload should not have thread_ts key');
    });
  });

  // ========================================================================
  // cleanMention
  // ========================================================================

  describe('cleanMention()', () => {
    let adapter;

    beforeEach(() => {
      adapter = new SlackAdapter(createValidConfig());
    });

    test('removes a single mention from text', () => {
      const result = adapter.cleanMention('<@U123ABC> hello world');
      assert.equal(result, 'hello world');
    });

    test('removes multiple mentions from text', () => {
      const result = adapter.cleanMention('<@U123ABC> <@U456DEF> hello');
      assert.equal(result, 'hello');
    });

    test('removes mention from middle of text', () => {
      const result = adapter.cleanMention('hey <@U123ABC> check this');
      assert.equal(result, 'hey  check this');
    });

    test('removes mention at end of text', () => {
      const result = adapter.cleanMention('hello <@U123ABC>');
      assert.equal(result, 'hello');
    });

    test('handles text with no mentions', () => {
      const result = adapter.cleanMention('hello world');
      assert.equal(result, 'hello world');
    });

    test('handles mention-only text', () => {
      const result = adapter.cleanMention('<@U123ABC>');
      assert.equal(result, '');
    });

    test('handles multiple mention-only text', () => {
      const result = adapter.cleanMention('<@U123ABC> <@U456DEF>');
      assert.equal(result, '');
    });

    test('trims surrounding whitespace', () => {
      const result = adapter.cleanMention('  <@U123ABC>   hello   ');
      assert.equal(result, 'hello');
    });

    test('returns empty string for null input', () => {
      const result = adapter.cleanMention(null);
      assert.equal(result, '');
    });

    test('returns empty string for undefined input', () => {
      const result = adapter.cleanMention(undefined);
      assert.equal(result, '');
    });

    test('returns empty string for empty string input', () => {
      const result = adapter.cleanMention('');
      assert.equal(result, '');
    });

    test('returns empty string for non-string input', () => {
      const result = adapter.cleanMention(123);
      assert.equal(result, '');
    });

    test('preserves special characters in text', () => {
      const result = adapter.cleanMention('<@U123ABC> hello! @here #general $100');
      assert.equal(result, 'hello! @here #general $100');
    });

    test('handles mention with numeric-only user ID', () => {
      // Slack user IDs are typically alphanumeric starting with U
      const result = adapter.cleanMention('<@U1234567890> hello');
      assert.equal(result, 'hello');
    });

    test('does not remove non-standard mention formats', () => {
      // Lowercase IDs should not match the pattern
      const result = adapter.cleanMention('<@u123abc> hello');
      assert.equal(result, '<@u123abc> hello');
    });
  });

  // ========================================================================
  // SlackAdapterError
  // ========================================================================

  describe('SlackAdapterError', () => {
    test('is an instance of Error', () => {
      const error = new SlackAdapterError('Test error');
      assert.ok(error instanceof Error);
    });

    test('has correct name', () => {
      const error = new SlackAdapterError('Test error');
      assert.equal(error.name, 'SlackAdapterError');
    });

    test('stores message', () => {
      const error = new SlackAdapterError('Something went wrong');
      assert.equal(error.message, 'Something went wrong');
    });

    test('stores operation', () => {
      const error = new SlackAdapterError('Test', { operation: 'sendMessage' });
      assert.equal(error.operation, 'sendMessage');
    });

    test('stores reason', () => {
      const error = new SlackAdapterError('Test', { reason: 'Missing channel' });
      assert.equal(error.reason, 'Missing channel');
    });

    test('stores cause', () => {
      const cause = new Error('Original failure');
      const error = new SlackAdapterError('Wrapped error', { cause });
      assert.equal(error.cause, cause);
    });

    test('works without options', () => {
      const error = new SlackAdapterError('Simple error');
      assert.equal(error.message, 'Simple error');
      assert.equal(error.operation, undefined);
      assert.equal(error.reason, undefined);
    });
  });

  // ========================================================================
  // Full Integration Scenarios
  // ========================================================================

  describe('full flow scenarios', () => {
    test('complete app_mention flow: init → start → receive → respond → stop', async () => {
      const adapter = new SlackAdapter(createValidConfig());
      const receivedMessages = [];

      adapter.onMessage(async msg => {
        receivedMessages.push(msg);
        // Respond in the same thread
        await adapter.sendMessage(msg.channelId, 'Bot response', msg.threadTs);
      });

      await adapter.initialize();
      await adapter.start();

      // Simulate mention
      await simulateAppMention({
        user: 'U111USER',
        channel: 'C222CHAN',
        text: '<@U999BOT> deploy to production',
        ts: '5555555555.555555',
      });

      // Verify received
      assert.equal(receivedMessages.length, 1);
      assert.equal(receivedMessages[0].text, 'deploy to production');
      assert.equal(receivedMessages[0].isDM, false);

      // Verify sent response
      assert.equal(postMessageSpy.mock.callCount(), 1);
      const sentPayload = postMessageSpy.mock.calls[0].arguments[0];
      assert.equal(sentPayload.channel, 'C222CHAN');
      assert.equal(sentPayload.text, 'Bot response');
      assert.equal(sentPayload.thread_ts, '5555555555.555555');

      await adapter.stop();
      assert.equal(adapter.started, false);
    });

    test('complete DM flow: init → start → receive DM → respond → stop', async () => {
      const adapter = new SlackAdapter(createValidConfig());
      const receivedMessages = [];

      adapter.onMessage(async msg => {
        receivedMessages.push(msg);
        await adapter.sendMessage(msg.channelId, 'DM reply');
      });

      await adapter.initialize();
      await adapter.start();

      await simulateMessage({
        user: 'U333USER',
        channel: 'D444DM',
        channel_type: 'im',
        text: 'Private question',
        ts: '7777777777.777777',
      });

      assert.equal(receivedMessages.length, 1);
      assert.equal(receivedMessages[0].text, 'Private question');
      assert.equal(receivedMessages[0].isDM, true);
      assert.equal(receivedMessages[0].threadTs, null);

      assert.equal(postMessageSpy.mock.callCount(), 1);
      const sentPayload = postMessageSpy.mock.calls[0].arguments[0];
      assert.equal(sentPayload.channel, 'D444DM');
      assert.equal(sentPayload.text, 'DM reply');

      await adapter.stop();
    });

    test('handles multiple sequential messages', async () => {
      const adapter = await createInitializedAdapter();
      const messages = [];
      adapter.onMessage(async msg => messages.push(msg));
      await adapter.start();

      // Send 5 mentions sequentially
      for (let i = 0; i < 5; i++) {
        await simulateAppMention({
          user: `U${i}00USER`,
          channel: 'C222CHAN',
          text: `<@UBOT> message ${i}`,
          ts: `${i}000000000.000000`,
        });
      }

      assert.equal(messages.length, 5);
      for (let i = 0; i < 5; i++) {
        assert.equal(messages[i].text, `message ${i}`);
        assert.equal(messages[i].userId, `U${i}00USER`);
      }

      await adapter.stop();
    });

    test('interleaves DMs and mentions correctly', async () => {
      const adapter = await createInitializedAdapter();
      const messages = [];
      adapter.onMessage(async msg => messages.push(msg));
      await adapter.start();

      // Mention
      await simulateAppMention({
        user: 'U111',
        channel: 'C222',
        text: '<@UBOT> channel message',
        ts: '1000.000',
      });

      // DM
      await simulateMessage({
        user: 'U333',
        channel: 'D444',
        channel_type: 'im',
        text: 'dm message',
        ts: '2000.000',
      });

      // Another mention
      await simulateAppMention({
        user: 'U555',
        channel: 'C666',
        text: '<@UBOT> another channel message',
        ts: '3000.000',
      });

      assert.equal(messages.length, 3);
      assert.equal(messages[0].isDM, false);
      assert.equal(messages[0].text, 'channel message');
      assert.equal(messages[1].isDM, true);
      assert.equal(messages[1].text, 'dm message');
      assert.equal(messages[2].isDM, false);
      assert.equal(messages[2].text, 'another channel message');

      await adapter.stop();
    });
  });

  // ========================================================================
  // Edge Cases
  // ========================================================================

  describe('edge cases', () => {
    test('handler registered after initialization still works', async () => {
      const adapter = await createInitializedAdapter();
      await adapter.start();

      // Register handler AFTER start
      const handler = mock.fn();
      adapter.onMessage(handler);

      await simulateAppMention({
        user: 'U123',
        channel: 'C456',
        text: '<@UBOT> late handler',
        ts: '1000.000',
      });

      assert.equal(handler.mock.callCount(), 1);
      await adapter.stop();
    });

    test('handler can be replaced mid-stream', async () => {
      const adapter = await createInitializedAdapter();
      const handler1 = mock.fn();
      const handler2 = mock.fn();

      adapter.onMessage(handler1);
      await adapter.start();

      await simulateAppMention({
        user: 'U123',
        channel: 'C456',
        text: '<@UBOT> first',
        ts: '1000.000',
      });

      // Replace handler
      adapter.onMessage(handler2);

      await simulateAppMention({
        user: 'U123',
        channel: 'C456',
        text: '<@UBOT> second',
        ts: '2000.000',
      });

      assert.equal(handler1.mock.callCount(), 1);
      assert.equal(handler2.mock.callCount(), 1);

      await adapter.stop();
    });

    test('handles empty text in mention event', async () => {
      const adapter = await createInitializedAdapter();
      const handler = mock.fn();
      adapter.onMessage(handler);

      await simulateAppMention({
        user: 'U123',
        channel: 'C456',
        text: '<@UBOT>',
        ts: '1000.000',
      });

      assert.equal(handler.mock.callCount(), 1);
      const msg = handler.mock.calls[0].arguments[0];
      assert.equal(msg.text, '');
    });

    test('handles empty text in DM event', async () => {
      const adapter = await createInitializedAdapter();
      const handler = mock.fn();
      adapter.onMessage(handler);

      await simulateMessage({
        user: 'U123',
        channel: 'D456',
        channel_type: 'im',
        text: '',
        ts: '1000.000',
      });

      assert.equal(handler.mock.callCount(), 1);
      const msg = handler.mock.calls[0].arguments[0];
      assert.equal(msg.text, '');
    });

    test('preserves unicode text in messages', async () => {
      const adapter = await createInitializedAdapter();
      const handler = mock.fn();
      adapter.onMessage(handler);

      const unicodeText = 'こんにちは 🤖 Привет مرحبا';
      await simulateMessage({
        user: 'U123',
        channel: 'D456',
        channel_type: 'im',
        text: unicodeText,
        ts: '1000.000',
      });

      const msg = handler.mock.calls[0].arguments[0];
      assert.equal(msg.text, unicodeText);
    });

    test('handles long messages', async () => {
      const adapter = await createInitializedAdapter();
      const handler = mock.fn();
      adapter.onMessage(handler);

      const longText = 'A'.repeat(10000);
      await simulateMessage({
        user: 'U123',
        channel: 'D456',
        channel_type: 'im',
        text: longText,
        ts: '1000.000',
      });

      const msg = handler.mock.calls[0].arguments[0];
      assert.equal(msg.text.length, 10000);
    });
  });
});
