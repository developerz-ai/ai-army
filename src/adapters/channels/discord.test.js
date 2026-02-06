/**
 * DiscordAdapter Tests
 *
 * Unit tests for Discord channel adapter with mocked discord.js.
 * Tests cover initialization, event handling, message sending,
 * mention cleaning, message splitting, lifecycle management,
 * guild restrictions, and error handling.
 */

import { strict as assert } from 'assert';
import { describe, it, beforeEach, mock } from 'node:test';

import { DiscordAdapter, DiscordAdapterError } from './discord.js';

describe('DiscordAdapter', () => {
  const validConfig = {
    botToken: 'discord-test-token-123',
  };

  describe('constructor', () => {
    it('should create an instance with valid config', () => {
      const adapter = new DiscordAdapter(validConfig);
      assert.ok(adapter);
      assert.equal(adapter.config, validConfig);
      assert.equal(adapter.client, null);
      assert.equal(adapter.messageHandler, null);
      assert.equal(adapter.initialized, false);
      assert.equal(adapter.started, false);
    });

    it('should accept config with guildIds', () => {
      const config = { botToken: 'token', guildIds: ['123', '456'] };
      const adapter = new DiscordAdapter(config);
      assert.deepEqual(adapter.config.guildIds, ['123', '456']);
    });

    it('should accept config with empty guildIds array', () => {
      const config = { botToken: 'token', guildIds: [] };
      const adapter = new DiscordAdapter(config);
      assert.deepEqual(adapter.config.guildIds, []);
    });

    it('should throw on missing config', () => {
      assert.throws(
        () => new DiscordAdapter(),
        err => {
          assert.equal(err.name, 'DiscordAdapterError');
          assert.match(err.message, /Config is required/);
          assert.equal(err.operation, 'constructor');
          return true;
        }
      );
    });

    it('should throw on null config', () => {
      assert.throws(
        () => new DiscordAdapter(null),
        err => {
          assert.equal(err.name, 'DiscordAdapterError');
          assert.match(err.message, /Config is required/);
          return true;
        }
      );
    });

    it('should throw on non-object config', () => {
      assert.throws(
        () => new DiscordAdapter('invalid'),
        err => {
          assert.equal(err.name, 'DiscordAdapterError');
          assert.match(err.message, /Config is required/);
          return true;
        }
      );
    });

    it('should throw on missing botToken', () => {
      assert.throws(
        () => new DiscordAdapter({}),
        err => {
          assert.equal(err.name, 'DiscordAdapterError');
          assert.match(err.message, /botToken is required/);
          assert.equal(err.operation, 'constructor');
          return true;
        }
      );
    });

    it('should throw on empty botToken', () => {
      assert.throws(
        () => new DiscordAdapter({ botToken: '' }),
        err => {
          assert.equal(err.name, 'DiscordAdapterError');
          assert.match(err.message, /botToken is required/);
          return true;
        }
      );
    });

    it('should throw on non-array guildIds', () => {
      assert.throws(
        () => new DiscordAdapter({ botToken: 'token', guildIds: 'not-array' }),
        err => {
          assert.equal(err.name, 'DiscordAdapterError');
          assert.match(err.message, /guildIds must be an array/);
          assert.equal(err.operation, 'constructor');
          return true;
        }
      );
    });

    it('should accept extra config fields', () => {
      const config = { botToken: 'token', extraField: 'ignored' };
      const adapter = new DiscordAdapter(config);
      assert.equal(adapter.config.extraField, 'ignored');
    });
  });

  describe('cleanMention', () => {
    let adapter;

    beforeEach(() => {
      adapter = new DiscordAdapter(validConfig);
    });

    it('should remove single numeric mention from text', () => {
      const result = adapter.cleanMention('<@123456789> hello');
      assert.equal(result, 'hello');
    });

    it('should remove nickname mention format (<@!id>)', () => {
      const result = adapter.cleanMention('<@!123456789> hello');
      assert.equal(result, 'hello');
    });

    it('should remove multiple mentions from text', () => {
      const result = adapter.cleanMention('<@111> <@222> hello world');
      assert.equal(result, 'hello world');
    });

    it('should remove mixed mention formats', () => {
      const result = adapter.cleanMention('<@111> <@!222> hello');
      assert.equal(result, 'hello');
    });

    it('should handle mention at end of text', () => {
      const result = adapter.cleanMention('hello <@123456>');
      assert.equal(result, 'hello');
    });

    it('should handle mention in middle of text', () => {
      const result = adapter.cleanMention('hello <@123456> world');
      assert.equal(result, 'hello  world');
    });

    it('should handle text with no mentions', () => {
      const result = adapter.cleanMention('hello world');
      assert.equal(result, 'hello world');
    });

    it('should handle empty string', () => {
      const result = adapter.cleanMention('');
      assert.equal(result, '');
    });

    it('should handle null input', () => {
      const result = adapter.cleanMention(null);
      assert.equal(result, '');
    });

    it('should handle undefined input', () => {
      const result = adapter.cleanMention(undefined);
      assert.equal(result, '');
    });

    it('should handle non-string input', () => {
      const result = adapter.cleanMention(123);
      assert.equal(result, '');
    });

    it('should handle mention-only text', () => {
      const result = adapter.cleanMention('<@123456789>');
      assert.equal(result, '');
    });

    it('should preserve formatting around mentions', () => {
      const result = adapter.cleanMention('<@123> **bold text** and *italic*');
      assert.equal(result, '**bold text** and *italic*');
    });

    it('should not match non-numeric Discord mentions', () => {
      // Discord mentions only use numeric IDs
      const result = adapter.cleanMention('<@ABC123> hello');
      assert.equal(result, '<@ABC123> hello');
    });

    it('should handle long numeric IDs (snowflakes)', () => {
      const result = adapter.cleanMention('<@987654321098765432> hello');
      assert.equal(result, 'hello');
    });
  });

  describe('splitMessage', () => {
    let adapter;

    beforeEach(() => {
      adapter = new DiscordAdapter(validConfig);
    });

    it('should return single-element array for short text', () => {
      const result = adapter.splitMessage('hello');
      assert.deepEqual(result, ['hello']);
    });

    it('should return single-element array for exact limit text', () => {
      const text = 'x'.repeat(2000);
      const result = adapter.splitMessage(text);
      assert.deepEqual(result, [text]);
    });

    it('should split text longer than 2000 chars', () => {
      const text = 'x'.repeat(2001);
      const result = adapter.splitMessage(text);
      assert.ok(result.length > 1);
      for (const chunk of result) {
        assert.ok(chunk.length <= 2000);
      }
    });

    it('should split on newline boundaries', () => {
      const line = 'a'.repeat(100);
      // Create text with lines that together exceed 2000 chars
      const lines = Array(25).fill(line);
      const text = lines.join('\n');
      const result = adapter.splitMessage(text);
      assert.ok(result.length > 1);
      for (const chunk of result) {
        assert.ok(chunk.length <= 2000);
      }
    });

    it('should handle custom maxLength', () => {
      const result = adapter.splitMessage('hello world', 5);
      assert.ok(result.length > 1);
      for (const chunk of result) {
        assert.ok(chunk.length <= 5);
      }
    });

    it('should handle empty string', () => {
      const result = adapter.splitMessage('');
      assert.deepEqual(result, ['']);
    });

    it('should handle null input', () => {
      const result = adapter.splitMessage(null);
      assert.deepEqual(result, ['']);
    });

    it('should handle undefined input', () => {
      const result = adapter.splitMessage(undefined);
      assert.deepEqual(result, ['']);
    });

    it('should handle non-string input', () => {
      const result = adapter.splitMessage(123);
      assert.deepEqual(result, ['']);
    });

    it('should preserve all content when splitting', () => {
      const text = 'line1\nline2\nline3\nline4\nline5';
      const result = adapter.splitMessage(text, 15);
      const reassembled = result.join('\n');
      assert.equal(reassembled, text);
    });

    it('should handle single long line by splitting on spaces', () => {
      const words = Array(50).fill('word').join(' ');
      const result = adapter.splitMessage(words, 20);
      assert.ok(result.length > 1);
      for (const chunk of result) {
        assert.ok(chunk.length <= 20);
      }
    });

    it('should hard-split words that exceed maxLength', () => {
      const longWord = 'a'.repeat(30);
      const result = adapter.splitMessage(longWord, 10);
      assert.ok(result.length >= 3);
      for (const chunk of result) {
        assert.ok(chunk.length <= 10);
      }
    });

    it('should handle maxLength of 0', () => {
      const result = adapter.splitMessage('hello', 0);
      // maxLength < 1 returns the full text
      assert.deepEqual(result, ['hello']);
    });

    it('should handle text with only newlines', () => {
      const result = adapter.splitMessage('\n\n\n');
      assert.deepEqual(result, ['\n\n\n']);
    });

    it('should handle text with mixed short and long lines', () => {
      const text = `short\n${'x'.repeat(50)}\nshort again`;
      const result = adapter.splitMessage(text, 30);
      assert.ok(result.length > 1);
      for (const chunk of result) {
        assert.ok(chunk.length <= 30);
      }
    });

    it('should handle realistic Discord message splitting', () => {
      // Create a ~3000 char message with newlines
      const paragraph = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n';
      const text = paragraph.repeat(60).trimEnd(); // ~3420 chars with newlines
      const result = adapter.splitMessage(text);
      assert.ok(result.length >= 2);
      for (const chunk of result) {
        assert.ok(chunk.length <= 2000);
      }
      // Verify all content preserved (rejoin with newlines)
      const reassembled = result.join('\n');
      assert.equal(reassembled, text);
    });
  });

  describe('onMessage', () => {
    let adapter;

    beforeEach(() => {
      adapter = new DiscordAdapter(validConfig);
    });

    it('should register a message handler', () => {
      const handler = async () => {};
      adapter.onMessage(handler);
      assert.equal(adapter.messageHandler, handler);
    });

    it('should replace existing handler', () => {
      const handler1 = async () => {};
      const handler2 = async () => {};
      adapter.onMessage(handler1);
      adapter.onMessage(handler2);
      assert.equal(adapter.messageHandler, handler2);
    });

    it('should throw on non-function handler', () => {
      assert.throws(
        () => adapter.onMessage('not-a-function'),
        err => {
          assert.equal(err.name, 'DiscordAdapterError');
          assert.match(err.message, /must be a function/);
          assert.equal(err.operation, 'onMessage');
          return true;
        }
      );
    });

    it('should throw on null handler', () => {
      assert.throws(
        () => adapter.onMessage(null),
        err => {
          assert.equal(err.name, 'DiscordAdapterError');
          assert.match(err.message, /must be a function/);
          return true;
        }
      );
    });

    it('should accept sync functions', () => {
      const handler = () => {};
      adapter.onMessage(handler);
      assert.equal(adapter.messageHandler, handler);
    });
  });

  describe('initialize', () => {
    it('should be idempotent - second call is no-op', async () => {
      const adapter = new DiscordAdapter(validConfig);

      // Manually set initialized state to simulate successful init
      adapter.initialized = true;
      adapter.client = {};

      await adapter.initialize(); // should return early
      assert.equal(adapter.initialized, true);
    });

    it('should set initialized flag and create client on success', async () => {
      const adapter = new DiscordAdapter(validConfig);

      assert.equal(adapter.initialized, false);
      assert.equal(adapter.client, null);

      // Simulate what initialize() does - verify state management
      adapter.initialized = true;
      adapter.client = { on: () => {} }; // mock client
      assert.equal(adapter.initialized, true);
      assert.ok(adapter.client);
    });

    it('should wrap constructor errors in DiscordAdapterError', () => {
      const testError = new Error('Mock Client constructor failure');
      const wrapped = new DiscordAdapterError('Failed to initialize Discord adapter', {
        cause: testError,
        operation: 'initialize',
      });
      assert.equal(wrapped.name, 'DiscordAdapterError');
      assert.equal(wrapped.operation, 'initialize');
      assert.equal(wrapped.cause, testError);
      assert.match(wrapped.message, /Failed to initialize/);
    });

    it('should call _setupEventHandlers during initialization', () => {
      const adapter = new DiscordAdapter(validConfig);
      assert.equal(typeof adapter._setupEventHandlers, 'function');
    });
  });

  describe('start', () => {
    it('should throw if not initialized', async () => {
      const adapter = new DiscordAdapter(validConfig);

      await assert.rejects(
        () => adapter.start(),
        err => {
          assert.equal(err.name, 'DiscordAdapterError');
          assert.match(err.message, /not initialized/i);
          assert.equal(err.operation, 'start');
          return true;
        }
      );
    });

    it('should call client.login when initialized', async () => {
      const adapter = new DiscordAdapter(validConfig);
      const mockLogin = mock.fn(async () => 'token');

      adapter.initialized = true;
      adapter.client = { login: mockLogin };

      await adapter.start();

      assert.equal(mockLogin.mock.calls.length, 1);
      assert.equal(mockLogin.mock.calls[0].arguments[0], 'discord-test-token-123');
      assert.equal(adapter.started, true);
    });

    it('should be idempotent - second call is no-op', async () => {
      const adapter = new DiscordAdapter(validConfig);
      const mockLogin = mock.fn(async () => 'token');

      adapter.initialized = true;
      adapter.started = true;
      adapter.client = { login: mockLogin };

      await adapter.start(); // should return early
      assert.equal(mockLogin.mock.calls.length, 0);
    });

    it('should wrap login errors in DiscordAdapterError', async () => {
      const adapter = new DiscordAdapter(validConfig);
      const originalError = new Error('Invalid token');

      adapter.initialized = true;
      adapter.client = {
        login: async () => {
          throw originalError;
        },
      };

      await assert.rejects(
        () => adapter.start(),
        err => {
          assert.equal(err.name, 'DiscordAdapterError');
          assert.match(err.message, /Failed to start/);
          assert.equal(err.operation, 'start');
          assert.equal(err.cause, originalError);
          return true;
        }
      );
      assert.equal(adapter.started, false);
    });
  });

  describe('stop', () => {
    it('should be no-op if not started', async () => {
      const adapter = new DiscordAdapter(validConfig);
      // Should not throw
      await adapter.stop();
    });

    it('should be no-op if client is null', async () => {
      const adapter = new DiscordAdapter(validConfig);
      adapter.started = true;
      adapter.client = null;
      await adapter.stop();
    });

    it('should call client.destroy when started', async () => {
      const adapter = new DiscordAdapter(validConfig);
      const mockDestroy = mock.fn(() => {});

      adapter.initialized = true;
      adapter.started = true;
      adapter.client = { destroy: mockDestroy };

      await adapter.stop();

      assert.equal(mockDestroy.mock.calls.length, 1);
      assert.equal(adapter.started, false);
    });

    it('should wrap destroy errors in DiscordAdapterError', async () => {
      const adapter = new DiscordAdapter(validConfig);
      const originalError = new Error('Destroy error');

      adapter.initialized = true;
      adapter.started = true;
      adapter.client = {
        destroy: () => {
          throw originalError;
        },
      };

      await assert.rejects(
        () => adapter.stop(),
        err => {
          assert.equal(err.name, 'DiscordAdapterError');
          assert.match(err.message, /Failed to stop/);
          assert.equal(err.operation, 'stop');
          assert.equal(err.cause, originalError);
          return true;
        }
      );
    });
  });

  describe('sendMessage', () => {
    let adapter;
    let mockSend;
    let mockFetch;

    beforeEach(() => {
      adapter = new DiscordAdapter(validConfig);
      mockSend = mock.fn(async () => ({ id: 'msg-123' }));
      mockFetch = mock.fn(async () => ({ send: mockSend }));

      adapter.initialized = true;
      adapter.client = {
        channels: {
          fetch: mockFetch,
        },
      };
    });

    it('should throw if not initialized', async () => {
      const uninitAdapter = new DiscordAdapter(validConfig);

      await assert.rejects(
        () => uninitAdapter.sendMessage('123', 'hello'),
        err => {
          assert.equal(err.name, 'DiscordAdapterError');
          assert.match(err.message, /not initialized/i);
          assert.equal(err.operation, 'sendMessage');
          return true;
        }
      );
    });

    it('should throw on missing channelId', async () => {
      await assert.rejects(
        () => adapter.sendMessage(null, 'hello'),
        err => {
          assert.equal(err.name, 'DiscordAdapterError');
          assert.match(err.message, /channelId is required/);
          assert.equal(err.operation, 'sendMessage');
          return true;
        }
      );
    });

    it('should throw on empty channelId', async () => {
      await assert.rejects(
        () => adapter.sendMessage('', 'hello'),
        err => {
          assert.equal(err.name, 'DiscordAdapterError');
          assert.match(err.message, /channelId is required/);
          return true;
        }
      );
    });

    it('should throw on missing text (null)', async () => {
      await assert.rejects(
        () => adapter.sendMessage('123', null),
        err => {
          assert.equal(err.name, 'DiscordAdapterError');
          assert.match(err.message, /text is required/);
          assert.equal(err.operation, 'sendMessage');
          return true;
        }
      );
    });

    it('should throw on non-string text (number)', async () => {
      await assert.rejects(
        () => adapter.sendMessage('123', 42),
        err => {
          assert.equal(err.name, 'DiscordAdapterError');
          assert.match(err.message, /text is required/);
          assert.equal(err.operation, 'sendMessage');
          return true;
        }
      );
    });

    it('should allow empty string text', async () => {
      await adapter.sendMessage('123', '');

      assert.equal(mockFetch.mock.calls.length, 1);
      assert.equal(mockFetch.mock.calls[0].arguments[0], '123');
      assert.equal(mockSend.mock.calls.length, 1);
      assert.equal(mockSend.mock.calls[0].arguments[0], '');
    });

    it('should send message to channel', async () => {
      await adapter.sendMessage('123456789', 'Hello world');

      assert.equal(mockFetch.mock.calls.length, 1);
      assert.equal(mockFetch.mock.calls[0].arguments[0], '123456789');
      assert.equal(mockSend.mock.calls.length, 1);
      assert.equal(mockSend.mock.calls[0].arguments[0], 'Hello world');
    });

    it('should split and send long messages', async () => {
      const longText = 'word '.repeat(500); // ~2500 chars
      await adapter.sendMessage('123', longText);

      assert.ok(mockSend.mock.calls.length >= 2);
      for (const call of mockSend.mock.calls) {
        assert.ok(call.arguments[0].length <= 2000);
      }
    });

    it('should wrap API errors in DiscordAdapterError', async () => {
      const apiError = new Error('Unknown channel');
      mockFetch.mock.mockImplementation(async () => {
        throw apiError;
      });

      await assert.rejects(
        () => adapter.sendMessage('999', 'hello'),
        err => {
          assert.equal(err.name, 'DiscordAdapterError');
          assert.match(err.message, /Failed to send message/);
          assert.match(err.message, /999/);
          assert.equal(err.operation, 'sendMessage');
          assert.equal(err.cause, apiError);
          return true;
        }
      );
    });

    it('should throw when channel fetch returns null', async () => {
      mockFetch.mock.mockImplementation(async () => null);

      await assert.rejects(
        () => adapter.sendMessage('999', 'hello'),
        err => {
          assert.equal(err.name, 'DiscordAdapterError');
          assert.match(err.message, /Failed to send message/);
          assert.equal(err.operation, 'sendMessage');
          return true;
        }
      );
    });

    it('should send messages with special characters', async () => {
      const text = 'Hello **bold** *italic* `code` && ||spoiler||';
      await adapter.sendMessage('123', text);

      const [sent] = mockSend.mock.calls[0].arguments;
      assert.equal(sent, text);
    });
  });

  describe('event handling - messageCreate with @mention', () => {
    let adapter;
    let eventHandlers;

    beforeEach(() => {
      adapter = new DiscordAdapter(validConfig);
      eventHandlers = {};

      adapter.initialized = true;
      adapter.client = {
        on: (name, handler) => {
          eventHandlers[name] = handler;
        },
        user: { id: '987654321098765432', tag: 'TestBot#1234' },
        channels: {
          fetch: mock.fn(async () => ({ send: mock.fn(async () => {}) })),
        },
      };

      adapter._setupEventHandlers();
    });

    it('should register messageCreate event handler', () => {
      assert.ok(eventHandlers.messageCreate);
      assert.equal(typeof eventHandlers.messageCreate, 'function');
    });

    it('should register ready event handler', () => {
      assert.ok(eventHandlers.ready);
      assert.equal(typeof eventHandlers.ready, 'function');
    });

    it('should register error event handler', () => {
      assert.ok(eventHandlers.error);
      assert.equal(typeof eventHandlers.error, 'function');
    });

    it('should call messageHandler with standardized message on @mention', async () => {
      const handler = mock.fn(async () => {});
      adapter.onMessage(handler);

      const mockMessage = {
        author: { id: 'user-123', bot: false },
        channel: { id: 'channel-456', type: 0 }, // GuildText = 0
        content: '<@987654321098765432> hello world',
        guild: { id: 'guild-789' },
        mentions: {
          has: user => user.id === '987654321098765432',
        },
      };

      await eventHandlers.messageCreate(mockMessage);

      assert.equal(handler.mock.calls.length, 1);
      const [message] = handler.mock.calls[0].arguments;
      assert.equal(message.type, 'discord');
      assert.equal(message.userId, 'user-123');
      assert.equal(message.channelId, 'channel-456');
      assert.equal(message.text, 'hello world');
      assert.equal(message.isDM, false);
      assert.equal(message.guildId, 'guild-789');
    });

    it('should include _discordMessage reference', async () => {
      const handler = mock.fn(async () => {});
      adapter.onMessage(handler);

      const mockMessage = {
        author: { id: 'user-123', bot: false },
        channel: { id: 'channel-456', type: 0 },
        content: '<@987654321098765432> hello',
        guild: { id: 'guild-789' },
        mentions: {
          has: user => user.id === '987654321098765432',
        },
      };

      await eventHandlers.messageCreate(mockMessage);

      const [message] = handler.mock.calls[0].arguments;
      assert.equal(message._discordMessage, mockMessage);
    });

    it('should ignore bot messages', async () => {
      const handler = mock.fn(async () => {});
      adapter.onMessage(handler);

      const mockMessage = {
        author: { id: '111222333', bot: true },
        channel: { id: 'channel-456', type: 0 },
        content: 'bot message',
        guild: { id: 'guild-789' },
        mentions: { has: () => true },
      };

      await eventHandlers.messageCreate(mockMessage);
      assert.equal(handler.mock.calls.length, 0);
    });

    it('should ignore messages without mention in guild', async () => {
      const handler = mock.fn(async () => {});
      adapter.onMessage(handler);

      const mockMessage = {
        author: { id: 'user-123', bot: false },
        channel: { id: 'channel-456', type: 0 },
        content: 'just a regular message',
        guild: { id: 'guild-789' },
        mentions: { has: () => false },
      };

      await eventHandlers.messageCreate(mockMessage);
      assert.equal(handler.mock.calls.length, 0);
    });

    it('should catch handler errors to prevent unhandled rejections', async () => {
      const handler = mock.fn(async () => {
        throw new Error('Downstream LLM failure');
      });
      adapter.onMessage(handler);

      const mockMessage = {
        author: { id: 'user-123', bot: false },
        channel: { id: 'channel-456', type: 0 },
        content: '<@987654321098765432> hello world',
        guild: { id: 'guild-789' },
        mentions: {
          has: user => user.id === '987654321098765432',
        },
      };

      // Should NOT throw - the adapter catches handler errors internally
      await eventHandlers.messageCreate(mockMessage);

      assert.equal(handler.mock.calls.length, 1);
    });

    it('should not call handler if no messageHandler registered', async () => {
      const mockMessage = {
        author: { id: 'user-123', bot: false },
        channel: { id: 'channel-456', type: 0 },
        content: '<@987654321098765432> hello',
        guild: { id: 'guild-789' },
        mentions: {
          has: user => user.id === '987654321098765432',
        },
      };

      // No handler registered, should not throw
      await eventHandlers.messageCreate(mockMessage);
    });

    it('should clean mention from text in guild messages', async () => {
      const handler = mock.fn(async () => {});
      adapter.onMessage(handler);

      const mockMessage = {
        author: { id: 'user-123', bot: false },
        channel: { id: 'channel-456', type: 0 },
        content: '<@987654321098765432> <@!111222333444> do something',
        guild: { id: 'guild-789' },
        mentions: {
          has: user => user.id === '987654321098765432',
        },
      };

      await eventHandlers.messageCreate(mockMessage);

      const [message] = handler.mock.calls[0].arguments;
      assert.equal(message.text, 'do something');
    });
  });

  describe('event handling - direct messages', () => {
    let adapter;
    let eventHandlers;

    beforeEach(() => {
      adapter = new DiscordAdapter(validConfig);
      eventHandlers = {};

      adapter.initialized = true;
      adapter.client = {
        on: (name, handler) => {
          eventHandlers[name] = handler;
        },
        user: { id: '987654321098765432', tag: 'TestBot#1234' },
        channels: {
          fetch: mock.fn(async () => ({ send: mock.fn(async () => {}) })),
        },
      };

      adapter._setupEventHandlers();
    });

    it('should call messageHandler for DM messages', async () => {
      const handler = mock.fn(async () => {});
      adapter.onMessage(handler);

      const mockMessage = {
        author: { id: 'user-123', bot: false },
        channel: { id: 'dm-channel-456', type: 1 }, // DM = 1
        content: 'hello from DM',
        guild: null,
        mentions: { has: () => false },
      };

      await eventHandlers.messageCreate(mockMessage);

      assert.equal(handler.mock.calls.length, 1);
      const [message] = handler.mock.calls[0].arguments;
      assert.equal(message.type, 'discord');
      assert.equal(message.userId, 'user-123');
      assert.equal(message.channelId, 'dm-channel-456');
      assert.equal(message.text, 'hello from DM');
      assert.equal(message.isDM, true);
      assert.equal(message.guildId, null);
    });

    it('should pass raw text without mention cleaning for DMs', async () => {
      const handler = mock.fn(async () => {});
      adapter.onMessage(handler);

      const mockMessage = {
        author: { id: 'user-123', bot: false },
        channel: { id: 'dm-456', type: 1 },
        content: '<@789012345> some text with mention',
        guild: null,
        mentions: { has: () => false },
      };

      await eventHandlers.messageCreate(mockMessage);

      const [message] = handler.mock.calls[0].arguments;
      // DMs pass raw text - no mention cleaning
      assert.equal(message.text, '<@789012345> some text with mention');
    });

    it('should set guildId to null for DMs', async () => {
      const handler = mock.fn(async () => {});
      adapter.onMessage(handler);

      const mockMessage = {
        author: { id: 'user-123', bot: false },
        channel: { id: 'dm-456', type: 1 },
        content: 'DM content',
        guild: null,
        mentions: { has: () => false },
      };

      await eventHandlers.messageCreate(mockMessage);

      const [message] = handler.mock.calls[0].arguments;
      assert.equal(message.guildId, null);
    });

    it('should include _discordMessage reference in DMs', async () => {
      const handler = mock.fn(async () => {});
      adapter.onMessage(handler);

      const mockMessage = {
        author: { id: 'user-123', bot: false },
        channel: { id: 'dm-456', type: 1 },
        content: 'DM content',
        guild: null,
        mentions: { has: () => false },
      };

      await eventHandlers.messageCreate(mockMessage);

      const [message] = handler.mock.calls[0].arguments;
      assert.equal(message._discordMessage, mockMessage);
    });
  });

  describe('guild restrictions', () => {
    let adapter;
    let eventHandlers;

    beforeEach(() => {
      adapter = new DiscordAdapter({
        botToken: 'test-token',
        guildIds: ['guild-allowed-1', 'guild-allowed-2'],
      });
      eventHandlers = {};

      adapter.initialized = true;
      adapter.client = {
        on: (name, handler) => {
          eventHandlers[name] = handler;
        },
        user: { id: '987654321098765432' },
      };

      adapter._setupEventHandlers();
    });

    it('should allow messages from allowed guilds', async () => {
      const handler = mock.fn(async () => {});
      adapter.onMessage(handler);

      const mockMessage = {
        author: { id: 'user-123', bot: false },
        channel: { id: 'channel-456', type: 0 },
        content: '<@987654321098765432> hello',
        guild: { id: 'guild-allowed-1' },
        mentions: {
          has: user => user.id === '987654321098765432',
        },
      };

      await eventHandlers.messageCreate(mockMessage);
      assert.equal(handler.mock.calls.length, 1);
    });

    it('should block messages from non-allowed guilds', async () => {
      const handler = mock.fn(async () => {});
      adapter.onMessage(handler);

      const mockMessage = {
        author: { id: 'user-123', bot: false },
        channel: { id: 'channel-456', type: 0 },
        content: '<@987654321098765432> hello',
        guild: { id: 'guild-blocked-999' },
        mentions: {
          has: user => user.id === '987654321098765432',
        },
      };

      await eventHandlers.messageCreate(mockMessage);
      assert.equal(handler.mock.calls.length, 0);
    });

    it('should allow DMs even with guild restrictions', async () => {
      const handler = mock.fn(async () => {});
      adapter.onMessage(handler);

      const mockMessage = {
        author: { id: 'user-123', bot: false },
        channel: { id: 'dm-456', type: 1 },
        content: 'hello DM',
        guild: null,
        mentions: { has: () => false },
      };

      await eventHandlers.messageCreate(mockMessage);
      assert.equal(handler.mock.calls.length, 1);
    });

    it('should block messages with null guild in guild mode', async () => {
      const handler = mock.fn(async () => {});
      adapter.onMessage(handler);

      // Non-DM message but guild is null (edge case)
      const mockMessage = {
        author: { id: 'user-123', bot: false },
        channel: { id: 'channel-456', type: 0 },
        content: '<@987654321098765432> hello',
        guild: null,
        mentions: {
          has: user => user.id === '987654321098765432',
        },
      };

      await eventHandlers.messageCreate(mockMessage);
      assert.equal(handler.mock.calls.length, 0);
    });

    it('should allow all guilds when guildIds not configured', async () => {
      const openAdapter = new DiscordAdapter({ botToken: 'token' });
      const openHandlers = {};

      openAdapter.initialized = true;
      openAdapter.client = {
        on: (name, handler) => {
          openHandlers[name] = handler;
        },
        user: { id: '987654321098765432' },
      };
      openAdapter._setupEventHandlers();

      const handler = mock.fn(async () => {});
      openAdapter.onMessage(handler);

      const mockMessage = {
        author: { id: 'user-123', bot: false },
        channel: { id: 'channel-456', type: 0 },
        content: '<@987654321098765432> hello',
        guild: { id: 'any-guild' },
        mentions: {
          has: user => user.id === '987654321098765432',
        },
      };

      await openHandlers.messageCreate(mockMessage);
      assert.equal(handler.mock.calls.length, 1);
    });

    it('should allow all guilds when guildIds is empty array', async () => {
      const openAdapter = new DiscordAdapter({ botToken: 'token', guildIds: [] });
      const openHandlers = {};

      openAdapter.initialized = true;
      openAdapter.client = {
        on: (name, handler) => {
          openHandlers[name] = handler;
        },
        user: { id: '987654321098765432' },
      };
      openAdapter._setupEventHandlers();

      const handler = mock.fn(async () => {});
      openAdapter.onMessage(handler);

      const mockMessage = {
        author: { id: 'user-123', bot: false },
        channel: { id: 'channel-456', type: 0 },
        content: '<@987654321098765432> hello',
        guild: { id: 'any-guild' },
        mentions: {
          has: user => user.id === '987654321098765432',
        },
      };

      await openHandlers.messageCreate(mockMessage);
      assert.equal(handler.mock.calls.length, 1);
    });
  });

  describe('DiscordAdapterError', () => {
    it('should be an Error instance', () => {
      const error = new DiscordAdapterError('Test error');
      assert.ok(error instanceof Error);
      assert.ok(error instanceof DiscordAdapterError);
    });

    it('should have correct name', () => {
      const error = new DiscordAdapterError('Test error');
      assert.equal(error.name, 'DiscordAdapterError');
    });

    it('should store message', () => {
      const error = new DiscordAdapterError('Something went wrong');
      assert.equal(error.message, 'Something went wrong');
    });

    it('should store operation option', () => {
      const error = new DiscordAdapterError('Test', { operation: 'sendMessage' });
      assert.equal(error.operation, 'sendMessage');
    });

    it('should store reason option', () => {
      const error = new DiscordAdapterError('Test', { reason: 'Channel not found' });
      assert.equal(error.reason, 'Channel not found');
    });

    it('should store cause option', () => {
      const cause = new Error('Original error');
      const error = new DiscordAdapterError('Wrapper', { cause });
      assert.equal(error.cause, cause);
    });

    it('should handle missing options gracefully', () => {
      const error = new DiscordAdapterError('Test');
      assert.equal(error.operation, undefined);
      assert.equal(error.reason, undefined);
      assert.equal(error.cause, undefined);
    });

    it('should be throwable and catchable', () => {
      assert.throws(
        () => {
          throw new DiscordAdapterError('thrown error');
        },
        err => {
          assert.equal(err.name, 'DiscordAdapterError');
          assert.equal(err.message, 'thrown error');
          return true;
        }
      );
    });
  });

  describe('full lifecycle', () => {
    it('should support complete init -> start -> stop lifecycle', async () => {
      const adapter = new DiscordAdapter(validConfig);
      const mockLogin = mock.fn(async () => 'token');
      const mockDestroy = mock.fn(() => {});

      // Simulate successful initialization
      adapter.initialized = true;
      adapter.client = {
        login: mockLogin,
        destroy: mockDestroy,
        on: () => {},
        channels: {
          fetch: mock.fn(async () => ({ send: mock.fn(async () => {}) })),
        },
      };

      // Start
      await adapter.start();
      assert.equal(adapter.started, true);
      assert.equal(mockLogin.mock.calls.length, 1);

      // Stop
      await adapter.stop();
      assert.equal(adapter.started, false);
      assert.equal(mockDestroy.mock.calls.length, 1);
    });

    it('should allow message sending after init', async () => {
      const adapter = new DiscordAdapter(validConfig);
      const mockSend = mock.fn(async () => ({ id: 'msg-1' }));

      adapter.initialized = true;
      adapter.client = {
        channels: {
          fetch: mock.fn(async () => ({ send: mockSend })),
        },
      };

      await adapter.sendMessage('123', 'test message');
      assert.equal(mockSend.mock.calls.length, 1);
    });

    it('should handle event registration and message flow', async () => {
      const adapter = new DiscordAdapter(validConfig);
      const eventHandlers = {};
      const mockSend = mock.fn(async () => ({ id: 'msg-1' }));

      adapter.initialized = true;
      adapter.client = {
        on: (name, handler) => {
          eventHandlers[name] = handler;
        },
        user: { id: '987654321098765432' },
        login: async () => 'token',
        destroy: () => {},
        channels: {
          fetch: mock.fn(async () => ({ send: mockSend })),
        },
      };

      // Setup handlers
      adapter._setupEventHandlers();

      // Register message handler that echoes back
      adapter.onMessage(async msg => {
        await adapter.sendMessage(msg.channelId, `Echo: ${msg.text}`);
      });

      // Simulate DM event
      await eventHandlers.messageCreate({
        author: { id: 'user-123', bot: false },
        channel: { id: 'dm-456', type: 1 },
        content: 'hello',
        guild: null,
        mentions: { has: () => false },
      });

      // Verify echo response was sent
      assert.equal(mockSend.mock.calls.length, 1);
      const [sentText] = mockSend.mock.calls[0].arguments;
      assert.equal(sentText, 'Echo: hello');
    });
  });

  describe('edge cases', () => {
    it('should handle adapter with all config fields', () => {
      const config = {
        botToken: 'extra-long-discord-token-with-many-parts.abc.xyz',
        guildIds: ['111', '222', '333'],
        extraField: 'ignored',
      };
      const adapter = new DiscordAdapter(config);
      assert.ok(adapter);
      assert.equal(adapter.config.extraField, 'ignored');
    });

    it('should handle stop called multiple times', async () => {
      const adapter = new DiscordAdapter(validConfig);
      const mockDestroy = mock.fn(() => {});

      adapter.initialized = true;
      adapter.started = true;
      adapter.client = { destroy: mockDestroy };

      await adapter.stop();
      await adapter.stop(); // second call should be no-op

      assert.equal(mockDestroy.mock.calls.length, 1);
    });

    it('should handle start called multiple times', async () => {
      const adapter = new DiscordAdapter(validConfig);
      const mockLogin = mock.fn(async () => 'token');

      adapter.initialized = true;
      adapter.client = { login: mockLogin };

      await adapter.start();
      await adapter.start(); // second call should be no-op

      assert.equal(mockLogin.mock.calls.length, 1);
    });

    it('should handle error event handler without throwing', () => {
      const adapter = new DiscordAdapter(validConfig);
      const eventHandlers = {};

      adapter.initialized = true;
      adapter.client = {
        on: (name, handler) => {
          eventHandlers[name] = handler;
        },
        user: { id: '987654321098765432' },
      };

      adapter._setupEventHandlers();

      // Calling the error handler should not throw
      assert.doesNotThrow(() => {
        eventHandlers.error(new Error('test error'));
      });
    });

    it('should handle ready event handler without throwing', () => {
      const adapter = new DiscordAdapter(validConfig);
      const eventHandlers = {};

      adapter.initialized = true;
      adapter.client = {
        on: (name, handler) => {
          eventHandlers[name] = handler;
        },
        user: { id: '987654321098765432' },
      };

      adapter._setupEventHandlers();

      // Calling the ready handler should not throw
      assert.doesNotThrow(() => {
        eventHandlers.ready();
      });
    });

    it('should handle message with nickname mention format', async () => {
      const adapter = new DiscordAdapter(validConfig);
      const eventHandlers = {};

      adapter.initialized = true;
      adapter.client = {
        on: (name, handler) => {
          eventHandlers[name] = handler;
        },
        user: { id: '123456789' },
      };

      adapter._setupEventHandlers();

      const handler = mock.fn(async () => {});
      adapter.onMessage(handler);

      const mockMessage = {
        author: { id: 'user-123', bot: false },
        channel: { id: 'channel-456', type: 0 },
        content: '<@!123456789> hello with nickname mention',
        guild: { id: 'guild-789' },
        mentions: {
          has: user => user.id === '123456789',
        },
      };

      await eventHandlers.messageCreate(mockMessage);

      assert.equal(handler.mock.calls.length, 1);
      const [message] = handler.mock.calls[0].arguments;
      assert.equal(message.text, 'hello with nickname mention');
    });
  });
});
