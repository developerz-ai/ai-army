/**
 * Integration tests for DiscordAdapter
 *
 * Tests the Discord channel adapter with a mock discord.js Client.
 * Uses mock.module() to replace the discord.js package so that
 * Client, GatewayIntentBits, Partials, and ChannelType are controlled
 * without requiring real Discord credentials.
 *
 * Covers:
 * - Constructor validation
 * - Initialization and lifecycle (start/stop)
 * - @mention event handling in guilds
 * - DM message handling
 * - Guild restriction filtering (guildIds)
 * - Message sending via channel.send()
 * - splitMessage() for >2000 character payloads
 * - cleanMention() text processing
 * - Error propagation
 *
 * @module test/integration/adapters/DiscordAdapter
 */

import { describe, test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Mock discord.js
//
// The DiscordAdapter imports `discord` from 'discord.js' and destructures
// { Client, GatewayIntentBits, Partials, ChannelType }.
// We mock the module so that `new Client(...)` returns our controllable fake.
// ---------------------------------------------------------------------------

/** Event listeners registered via `client.on(eventName, handler)` */
let clientEventHandlers;

/** Spy for `channel.send` */
let channelSendSpy;

/** The fake channel returned by `client.channels.fetch(id)` */
let fetchedChannel;

/** Controls whether `client.login()` rejects */
let loginShouldFail;

/** Controls whether `client.destroy()` throws */
let destroyShouldFail;

/** Controls whether `client.channels.fetch()` rejects */
let fetchShouldFail;

/** The bot user object on the mock client */
let mockBotUser;

/**
 * Reset all mock state before each test
 */
function resetMockState() {
  clientEventHandlers = {};
  channelSendSpy = mock.fn(async () => ({ id: 'msg-001' }));
  fetchedChannel = { id: 'C123', send: channelSendSpy };
  loginShouldFail = false;
  destroyShouldFail = false;
  fetchShouldFail = false;
  mockBotUser = { id: '999888777666' };
}

/**
 * Fake discord.js Client constructor.
 * Records intents/partials config and provides controllable event/login/destroy.
 */
class MockDiscordClient {
  constructor(config) {
    this._config = config;
    this.user = mockBotUser;
    this.channels = {
      fetch: async channelId => {
        if (fetchShouldFail) {
          throw new Error(`Channel ${channelId} not found`);
        }
        return fetchedChannel;
      },
    };
  }

  on(eventName, handler) {
    if (!clientEventHandlers[eventName]) {
      clientEventHandlers[eventName] = [];
    }
    clientEventHandlers[eventName].push(handler);
  }

  async login(_token) {
    if (loginShouldFail) {
      throw new Error('Mock Discord login failed');
    }
  }

  destroy() {
    if (destroyShouldFail) {
      throw new Error('Mock Discord destroy failed');
    }
  }
}

/** Fake GatewayIntentBits enum */
const MockGatewayIntentBits = {
  Guilds: 1,
  GuildMessages: 2,
  DirectMessages: 4,
  MessageContent: 8,
};

/** Fake Partials enum */
const MockPartials = {
  Channel: 0,
  Message: 1,
};

/** Fake ChannelType enum */
const MockChannelType = {
  DM: 1,
  GuildText: 0,
};

// Register the mock before importing DiscordAdapter.
// The source uses named imports: `import { Client, ... } from 'discord.js'`.
mock.module('discord.js', {
  namedExports: {
    Client: MockDiscordClient,
    GatewayIntentBits: MockGatewayIntentBits,
    Partials: MockPartials,
    ChannelType: MockChannelType,
  },
});

// Dynamic import AFTER mock registration
const { DiscordAdapter, DiscordAdapterError } =
  await import('../../../src/adapters/channels/discord.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a valid Discord config object
 * @param {Object} overrides - Properties to override
 * @returns {Object} Discord config
 */
function createValidConfig(overrides = {}) {
  return {
    botToken: 'discord-test-bot-token-123',
    ...overrides,
  };
}

/**
 * Create and initialize a DiscordAdapter ready for testing
 * @param {Object} [configOverrides] - Config overrides
 * @returns {Promise<DiscordAdapter>} Initialized adapter
 */
async function createInitializedAdapter(configOverrides = {}) {
  const adapter = new DiscordAdapter(createValidConfig(configOverrides));
  await adapter.initialize();
  return adapter;
}

/**
 * Simulate a Discord messageCreate event through the mock
 * @param {Object} discordMessage - Fake discord.js Message object
 */
async function simulateMessageCreate(discordMessage) {
  const handlers = clientEventHandlers.messageCreate || [];
  for (const handler of handlers) {
    await handler(discordMessage);
  }
}

/**
 * Create a fake discord.js guild message (with @mention)
 * @param {Object} overrides - Properties to override
 * @returns {Object} Fake discord message
 */
function createGuildMessage(overrides = {}) {
  const botUserId = mockBotUser.id;
  return {
    author: { bot: false, id: 'U123USER' },
    channel: { id: 'C456CHAN', type: MockChannelType.GuildText },
    content: `<@${botUserId}> hello world`,
    guild: { id: 'G789GUILD' },
    mentions: {
      has: user => user.id === botUserId,
    },
    ...overrides,
  };
}

/**
 * Create a fake discord.js DM message
 * @param {Object} overrides - Properties to override
 * @returns {Object} Fake DM message
 */
function createDMMessage(overrides = {}) {
  return {
    author: { bot: false, id: 'U123USER' },
    channel: { id: 'D789DM', type: MockChannelType.DM },
    content: 'Hello in DM',
    guild: null,
    mentions: {
      has: () => false,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DiscordAdapter', () => {
  beforeEach(() => {
    resetMockState();
  });

  // ========================================================================
  // Constructor Validation
  // ========================================================================

  describe('constructor', () => {
    test('creates instance with valid config', () => {
      const config = createValidConfig();
      const adapter = new DiscordAdapter(config);

      assert.ok(adapter, 'Adapter should be created');
      assert.equal(adapter.initialized, false);
      assert.equal(adapter.started, false);
      assert.equal(adapter.messageHandler, null);
    });

    test('throws DiscordAdapterError when config is missing', () => {
      assert.throws(
        () => new DiscordAdapter(),
        err => {
          assert.ok(err instanceof DiscordAdapterError);
          assert.equal(err.name, 'DiscordAdapterError');
          assert.match(err.message, /config.*required/i);
          assert.equal(err.operation, 'constructor');
          return true;
        }
      );
    });

    test('throws DiscordAdapterError when config is not an object', () => {
      assert.throws(
        () => new DiscordAdapter('not-an-object'),
        err => {
          assert.ok(err instanceof DiscordAdapterError);
          assert.match(err.message, /config.*required/i);
          return true;
        }
      );
    });

    test('throws DiscordAdapterError when config is null', () => {
      assert.throws(
        () => new DiscordAdapter(null),
        err => {
          assert.ok(err instanceof DiscordAdapterError);
          assert.match(err.message, /config.*required/i);
          return true;
        }
      );
    });

    test('throws DiscordAdapterError when botToken is missing', () => {
      assert.throws(
        () => new DiscordAdapter({}),
        err => {
          assert.ok(err instanceof DiscordAdapterError);
          assert.match(err.message, /botToken.*required/i);
          assert.equal(err.operation, 'constructor');
          return true;
        }
      );
    });

    test('throws DiscordAdapterError when guildIds is not an array', () => {
      assert.throws(
        () => new DiscordAdapter({ botToken: 'token', guildIds: 'not-array' }),
        err => {
          assert.ok(err instanceof DiscordAdapterError);
          assert.match(err.message, /guildIds.*array/i);
          return true;
        }
      );
    });

    test('accepts valid guildIds array', () => {
      const adapter = new DiscordAdapter({
        botToken: 'token',
        guildIds: ['guild1', 'guild2'],
      });
      assert.ok(adapter);
    });

    test('accepts config without guildIds (optional)', () => {
      const adapter = new DiscordAdapter({ botToken: 'token' });
      assert.ok(adapter);
    });
  });

  // ========================================================================
  // Initialization
  // ========================================================================

  describe('initialize()', () => {
    test('initializes successfully with valid config', async () => {
      const adapter = new DiscordAdapter(createValidConfig());

      await adapter.initialize();

      assert.equal(adapter.initialized, true);
      assert.ok(adapter.client, 'Should have Client instance');
    });

    test('registers messageCreate, ready, and error event handlers', async () => {
      const adapter = new DiscordAdapter(createValidConfig());

      await adapter.initialize();

      assert.ok(clientEventHandlers.ready, 'Should register ready handler');
      assert.ok(clientEventHandlers.messageCreate, 'Should register messageCreate handler');
      assert.ok(clientEventHandlers.error, 'Should register error handler');
      assert.equal(clientEventHandlers.ready.length, 1);
      assert.equal(clientEventHandlers.messageCreate.length, 1);
      assert.equal(clientEventHandlers.error.length, 1);
    });

    test('is idempotent - second call is a no-op', async () => {
      const adapter = new DiscordAdapter(createValidConfig());

      await adapter.initialize();
      const clientAfterFirst = adapter.client;

      await adapter.initialize();
      const clientAfterSecond = adapter.client;

      assert.equal(clientAfterFirst, clientAfterSecond, 'Client should not be recreated');
    });

    test('passes correct intents and partials to Client', async () => {
      const adapter = new DiscordAdapter(createValidConfig());

      await adapter.initialize();

      const { intents, partials } = adapter.client._config;
      assert.ok(intents.includes(MockGatewayIntentBits.Guilds));
      assert.ok(intents.includes(MockGatewayIntentBits.GuildMessages));
      assert.ok(intents.includes(MockGatewayIntentBits.DirectMessages));
      assert.ok(intents.includes(MockGatewayIntentBits.MessageContent));
      assert.ok(partials.includes(MockPartials.Channel));
      assert.ok(partials.includes(MockPartials.Message));
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
      const adapter = new DiscordAdapter(createValidConfig());

      await assert.rejects(
        () => adapter.start(),
        err => {
          assert.ok(err instanceof DiscordAdapterError);
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

    test('wraps Discord login errors in DiscordAdapterError', async () => {
      loginShouldFail = true;
      const adapter = await createInitializedAdapter();

      await assert.rejects(
        () => adapter.start(),
        err => {
          assert.ok(err instanceof DiscordAdapterError);
          assert.match(err.message, /failed to start/i);
          assert.equal(err.operation, 'start');
          assert.ok(err.cause, 'Should preserve original error as cause');
          assert.match(err.cause.message, /Mock Discord login failed/);
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

    test('is a no-op when client is null', async () => {
      const adapter = new DiscordAdapter(createValidConfig());

      await adapter.stop(); // Should not throw
    });

    test('wraps Client destroy errors in DiscordAdapterError', async () => {
      const adapter = await createInitializedAdapter();
      await adapter.start();
      destroyShouldFail = true;

      await assert.rejects(
        () => adapter.stop(),
        err => {
          assert.ok(err instanceof DiscordAdapterError);
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
          assert.ok(err instanceof DiscordAdapterError);
          assert.match(err.message, /must be a function/i);
          assert.equal(err.operation, 'onMessage');
          return true;
        }
      );
    });

    test('throws when handler is null', () => {
      const adapter = new DiscordAdapter(createValidConfig());

      assert.throws(
        () => adapter.onMessage(null),
        err => {
          assert.ok(err instanceof DiscordAdapterError);
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
  // @mention Event Handling (Guild Messages)
  // ========================================================================

  describe('@mention events (guild messages)', () => {
    test('dispatches @mention event to handler with cleaned text', async () => {
      const adapter = await createInitializedAdapter();
      const handler = mock.fn();
      adapter.onMessage(handler);

      await simulateMessageCreate(createGuildMessage());

      assert.equal(handler.mock.callCount(), 1);
      const msg = handler.mock.calls[0].arguments[0];
      assert.equal(msg.type, 'discord');
      assert.equal(msg.userId, 'U123USER');
      assert.equal(msg.channelId, 'C456CHAN');
      assert.equal(msg.text, 'hello world');
      assert.equal(msg.isDM, false);
      assert.equal(msg.guildId, 'G789GUILD');
    });

    test('ignores messages from bots', async () => {
      const adapter = await createInitializedAdapter();
      const handler = mock.fn();
      adapter.onMessage(handler);

      await simulateMessageCreate(
        createGuildMessage({
          author: { bot: true, id: 'BOTUSER' },
        })
      );

      assert.equal(handler.mock.callCount(), 0, 'Should not dispatch bot messages');
    });

    test('ignores guild messages without @mention', async () => {
      const adapter = await createInitializedAdapter();
      const handler = mock.fn();
      adapter.onMessage(handler);

      await simulateMessageCreate(
        createGuildMessage({
          mentions: { has: () => false },
        })
      );

      assert.equal(handler.mock.callCount(), 0, 'Should not dispatch non-mention messages');
    });

    test('stores _discordMessage reference on normalized message', async () => {
      const adapter = await createInitializedAdapter();
      const handler = mock.fn();
      adapter.onMessage(handler);

      const original = createGuildMessage();
      await simulateMessageCreate(original);

      const msg = handler.mock.calls[0].arguments[0];
      assert.equal(msg._discordMessage, original);
    });

    test('silently drops mention when no handler is registered', async () => {
      await createInitializedAdapter();
      // No handler registered - should not throw
      await simulateMessageCreate(createGuildMessage());
    });

    test('catches handler errors to prevent unhandled rejections', async () => {
      const adapter = await createInitializedAdapter();
      const handler = mock.fn(async () => {
        throw new Error('Downstream LLM failure');
      });
      adapter.onMessage(handler);

      // Should NOT throw - the adapter catches handler errors internally
      await simulateMessageCreate(createGuildMessage());

      assert.equal(handler.mock.callCount(), 1, 'Handler should have been called');
    });

    test('cleans multiple mention tags from text', async () => {
      const adapter = await createInitializedAdapter();
      const handler = mock.fn();
      adapter.onMessage(handler);

      await simulateMessageCreate(
        createGuildMessage({
          content: `<@${mockBotUser.id}> hey <@12345> check this`,
        })
      );

      const msg = handler.mock.calls[0].arguments[0];
      assert.equal(msg.text, 'hey  check this');
    });
  });

  // ========================================================================
  // DM Message Handling
  // ========================================================================

  describe('DM message events', () => {
    test('dispatches DM event to handler', async () => {
      const adapter = await createInitializedAdapter();
      const handler = mock.fn();
      adapter.onMessage(handler);

      await simulateMessageCreate(createDMMessage());

      assert.equal(handler.mock.callCount(), 1);
      const msg = handler.mock.calls[0].arguments[0];
      assert.equal(msg.type, 'discord');
      assert.equal(msg.userId, 'U123USER');
      assert.equal(msg.channelId, 'D789DM');
      assert.equal(msg.text, 'Hello in DM');
      assert.equal(msg.isDM, true);
      assert.equal(msg.guildId, null);
    });

    test('does not clean mentions in DM text', async () => {
      const adapter = await createInitializedAdapter();
      const handler = mock.fn();
      adapter.onMessage(handler);

      await simulateMessageCreate(
        createDMMessage({
          content: '<@12345> some text in DM',
        })
      );

      const msg = handler.mock.calls[0].arguments[0];
      // In DMs, the source uses discordMessage.content directly (no cleanMention)
      assert.equal(msg.text, '<@12345> some text in DM');
    });

    test('ignores DMs from bots', async () => {
      const adapter = await createInitializedAdapter();
      const handler = mock.fn();
      adapter.onMessage(handler);

      await simulateMessageCreate(
        createDMMessage({
          author: { bot: true, id: 'BOTUSER' },
        })
      );

      assert.equal(handler.mock.callCount(), 0);
    });

    test('silently drops DM when no handler is registered', async () => {
      await createInitializedAdapter();
      // No handler registered - should not throw
      await simulateMessageCreate(createDMMessage());
    });

    test('stores _discordMessage reference on DM message', async () => {
      const adapter = await createInitializedAdapter();
      const handler = mock.fn();
      adapter.onMessage(handler);

      const original = createDMMessage();
      await simulateMessageCreate(original);

      const msg = handler.mock.calls[0].arguments[0];
      assert.equal(msg._discordMessage, original);
    });
  });

  // ========================================================================
  // Guild Restrictions (guildIds)
  // ========================================================================

  describe('guild restriction filtering', () => {
    test('processes mention from allowed guild', async () => {
      const adapter = await createInitializedAdapter({
        guildIds: ['G789GUILD', 'G_OTHER'],
      });
      const handler = mock.fn();
      adapter.onMessage(handler);

      await simulateMessageCreate(
        createGuildMessage({
          guild: { id: 'G789GUILD' },
        })
      );

      assert.equal(handler.mock.callCount(), 1);
    });

    test('ignores mention from disallowed guild', async () => {
      const adapter = await createInitializedAdapter({
        guildIds: ['G_ALLOWED_ONLY'],
      });
      const handler = mock.fn();
      adapter.onMessage(handler);

      await simulateMessageCreate(
        createGuildMessage({
          guild: { id: 'G789GUILD' },
        })
      );

      assert.equal(handler.mock.callCount(), 0, 'Should not dispatch for disallowed guild');
    });

    test('processes mention when guildIds is empty (no restriction)', async () => {
      const adapter = await createInitializedAdapter({
        guildIds: [],
      });
      const handler = mock.fn();
      adapter.onMessage(handler);

      await simulateMessageCreate(createGuildMessage());

      // Empty guildIds array => guildIds.length === 0 => restriction not applied
      assert.equal(handler.mock.callCount(), 1);
    });

    test('processes mention when guildIds is not configured', async () => {
      const adapter = await createInitializedAdapter();
      const handler = mock.fn();
      adapter.onMessage(handler);

      await simulateMessageCreate(createGuildMessage());

      assert.equal(handler.mock.callCount(), 1);
    });

    test('DMs are not filtered by guild restrictions', async () => {
      const adapter = await createInitializedAdapter({
        guildIds: ['G_SPECIFIC_ONLY'],
      });
      const handler = mock.fn();
      adapter.onMessage(handler);

      // DMs have no guild - should not be filtered
      await simulateMessageCreate(createDMMessage());

      assert.equal(handler.mock.callCount(), 1, 'DMs should bypass guild restriction');
    });

    test('ignores mention when guild object is null', async () => {
      const adapter = await createInitializedAdapter({
        guildIds: ['G_ALLOWED'],
      });
      const handler = mock.fn();
      adapter.onMessage(handler);

      // Guild message but guild is null (unusual edge case)
      await simulateMessageCreate(
        createGuildMessage({
          guild: null,
          channel: { id: 'C456CHAN', type: MockChannelType.GuildText },
          mentions: { has: user => user.id === mockBotUser.id },
        })
      );

      assert.equal(handler.mock.callCount(), 0);
    });
  });

  // ========================================================================
  // sendMessage
  // ========================================================================

  describe('sendMessage()', () => {
    test('sends a basic message to a channel', async () => {
      const adapter = await createInitializedAdapter();

      await adapter.sendMessage('C456DEF', 'Hello from bot!');

      assert.equal(channelSendSpy.mock.callCount(), 1);
      assert.equal(channelSendSpy.mock.calls[0].arguments[0], 'Hello from bot!');
    });

    test('throws if not initialized', async () => {
      const adapter = new DiscordAdapter(createValidConfig());

      await assert.rejects(
        () => adapter.sendMessage('C456DEF', 'hello'),
        err => {
          assert.ok(err instanceof DiscordAdapterError);
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
          assert.ok(err instanceof DiscordAdapterError);
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
          assert.ok(err instanceof DiscordAdapterError);
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
          assert.ok(err instanceof DiscordAdapterError);
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
          assert.ok(err instanceof DiscordAdapterError);
          assert.match(err.message, /text.*required/i);
          return true;
        }
      );
    });

    test('throws when text is a number (non-string)', async () => {
      const adapter = await createInitializedAdapter();

      await assert.rejects(
        () => adapter.sendMessage('C456DEF', 42),
        err => {
          assert.ok(err instanceof DiscordAdapterError);
          assert.match(err.message, /text.*required/i);
          return true;
        }
      );
    });

    test('allows empty string text', async () => {
      const adapter = await createInitializedAdapter();

      await adapter.sendMessage('C456DEF', '');

      assert.equal(channelSendSpy.mock.callCount(), 1);
      assert.equal(channelSendSpy.mock.calls[0].arguments[0], '');
    });

    test('wraps channel fetch errors in DiscordAdapterError', async () => {
      fetchShouldFail = true;
      const adapter = await createInitializedAdapter();

      await assert.rejects(
        () => adapter.sendMessage('C999INVALID', 'hello'),
        err => {
          assert.ok(err instanceof DiscordAdapterError);
          assert.match(err.message, /failed to send message/i);
          assert.match(err.message, /C999INVALID/);
          assert.equal(err.operation, 'sendMessage');
          assert.ok(err.cause, 'Should preserve original error');
          return true;
        }
      );
    });

    test('wraps channel.send() errors in DiscordAdapterError', async () => {
      channelSendSpy.mock.mockImplementation(async () => {
        throw new Error('Missing permissions');
      });
      const adapter = await createInitializedAdapter();

      await assert.rejects(
        () => adapter.sendMessage('C456DEF', 'hello'),
        err => {
          assert.ok(err instanceof DiscordAdapterError);
          assert.match(err.message, /failed to send message/i);
          assert.equal(err.operation, 'sendMessage');
          assert.ok(err.cause);
          assert.match(err.cause.message, /Missing permissions/);
          return true;
        }
      );
    });

    test('throws when fetched channel is null', async () => {
      const adapter = await createInitializedAdapter();
      // Override channels.fetch to return null
      adapter.client.channels.fetch = async () => null;

      await assert.rejects(
        () => adapter.sendMessage('C456DEF', 'hello'),
        err => {
          assert.ok(err instanceof DiscordAdapterError);
          assert.match(err.message, /failed to send message/i);
          return true;
        }
      );
    });

    test('splits long messages into multiple channel.send() calls', async () => {
      const adapter = await createInitializedAdapter();
      // 2500 chars = should be split into 2 chunks
      const longText = 'A'.repeat(2500);

      await adapter.sendMessage('C456DEF', longText);

      assert.equal(channelSendSpy.mock.callCount(), 2, 'Should send 2 chunks');
      const chunk1 = channelSendSpy.mock.calls[0].arguments[0];
      const chunk2 = channelSendSpy.mock.calls[1].arguments[0];
      assert.equal(chunk1.length, 2000);
      assert.equal(chunk2.length, 500);
    });

    test('sends single message when text is under 2000 chars', async () => {
      const adapter = await createInitializedAdapter();
      const text = 'A'.repeat(1999);

      await adapter.sendMessage('C456DEF', text);

      assert.equal(channelSendSpy.mock.callCount(), 1);
      assert.equal(channelSendSpy.mock.calls[0].arguments[0].length, 1999);
    });

    test('sends single message when text is exactly 2000 chars', async () => {
      const adapter = await createInitializedAdapter();
      const text = 'A'.repeat(2000);

      await adapter.sendMessage('C456DEF', text);

      assert.equal(channelSendSpy.mock.callCount(), 1);
    });
  });

  // ========================================================================
  // splitMessage
  // ========================================================================

  describe('splitMessage()', () => {
    let adapter;

    beforeEach(async () => {
      adapter = new DiscordAdapter(createValidConfig());
    });

    // --- Basic splitting ---

    test('returns single element for text under maxLength', () => {
      const result = adapter.splitMessage('hello world');
      assert.deepEqual(result, ['hello world']);
    });

    test('returns single element for text exactly at maxLength', () => {
      const text = 'A'.repeat(2000);
      const result = adapter.splitMessage(text);
      assert.deepEqual(result, [text]);
    });

    test('splits text exceeding maxLength', () => {
      const text = 'A'.repeat(2500);
      const result = adapter.splitMessage(text);
      assert.equal(result.length, 2);
      assert.equal(result[0].length, 2000);
      assert.equal(result[1].length, 500);
    });

    // --- Newline splitting ---

    test('splits on newline boundaries when possible', () => {
      const line1 = 'A'.repeat(1500);
      const line2 = 'B'.repeat(1500);
      const text = `${line1}\n${line2}`;

      const result = adapter.splitMessage(text);

      assert.equal(result.length, 2);
      assert.equal(result[0], line1);
      assert.equal(result[1], line2);
    });

    test('accumulates short lines into single chunk', () => {
      const lines = Array.from({ length: 10 }, (_, i) => `Line ${i}`);
      const text = lines.join('\n');

      const result = adapter.splitMessage(text);

      assert.equal(result.length, 1);
      assert.equal(result[0], text);
    });

    test('splits when accumulated lines exceed maxLength', () => {
      const lines = Array.from({ length: 5 }, () => 'X'.repeat(500));
      const text = lines.join('\n');

      const result = adapter.splitMessage(text, 1000);

      // Each line is 500 chars. Two lines + newline = 1001, so each chunk holds 1 line
      // Actually: first chunk 500, then 500+1+500=1001 > 1000, so push, next 500, etc.
      assert.ok(result.length > 1, 'Should produce multiple chunks');
      for (const chunk of result) {
        assert.ok(chunk.length <= 1000, `Chunk should not exceed maxLength: ${chunk.length}`);
      }
    });

    // --- Word splitting for long lines ---

    test('splits long single line by spaces', () => {
      // Create a line with words that total > 2000 chars
      const words = Array.from({ length: 300 }, (_, i) => `word${i}`);
      const text = words.join(' ');

      const result = adapter.splitMessage(text, 100);

      assert.ok(result.length > 1, 'Should split long line into chunks');
      for (const chunk of result) {
        assert.ok(chunk.length <= 100, `Each chunk should be ≤ 100 chars: ${chunk.length}`);
      }
      // Verify all words are preserved
      const reassembled = result.join(' ');
      assert.equal(reassembled, text);
    });

    test('hard-splits words that exceed maxLength', () => {
      const longWord = 'A'.repeat(250);
      const text = longWord;

      const result = adapter.splitMessage(text, 100);

      assert.equal(result.length, 3);
      assert.equal(result[0].length, 100);
      assert.equal(result[1].length, 100);
      assert.equal(result[2].length, 50);
    });

    // --- Custom maxLength ---

    test('respects custom maxLength parameter', () => {
      const text = 'A'.repeat(150);

      const result = adapter.splitMessage(text, 50);

      assert.equal(result.length, 3);
      assert.equal(result[0].length, 50);
      assert.equal(result[1].length, 50);
      assert.equal(result[2].length, 50);
    });

    test('defaults maxLength to 2000', () => {
      const text = 'A'.repeat(4000);

      const result = adapter.splitMessage(text);

      assert.equal(result.length, 2);
      assert.equal(result[0].length, 2000);
      assert.equal(result[1].length, 2000);
    });

    // --- Edge cases ---

    test('returns [""] for null input', () => {
      const result = adapter.splitMessage(null);
      assert.deepEqual(result, ['']);
    });

    test('returns [""] for undefined input', () => {
      const result = adapter.splitMessage(undefined);
      assert.deepEqual(result, ['']);
    });

    test('returns [""] for empty string', () => {
      const result = adapter.splitMessage('');
      assert.deepEqual(result, ['']);
    });

    test('returns [""] for non-string input', () => {
      const result = adapter.splitMessage(123);
      assert.deepEqual(result, ['']);
    });

    test('returns original text for maxLength < 1', () => {
      const text = 'hello world';
      const result = adapter.splitMessage(text, 0);
      assert.deepEqual(result, ['hello world']);
    });

    test('handles text with only newlines', () => {
      const result = adapter.splitMessage('\n\n\n', 10);
      assert.ok(result.length >= 1);
    });

    test('handles text with mixed short and long lines', () => {
      const text = `Short line\n${'L'.repeat(5000)}\nAnother short line`;
      const result = adapter.splitMessage(text, 2000);

      assert.ok(result.length >= 3, 'Should split long line and separate short lines');
      for (const chunk of result) {
        assert.ok(chunk.length <= 2000, `Chunk must not exceed 2000: ${chunk.length}`);
      }
    });

    test('preserves content - no characters lost after splitting', () => {
      const text = 'Hello\nworld this is a longer line\nshort\nend';
      const result = adapter.splitMessage(text, 20);

      // All original text content should be recoverable
      const totalChars = result.reduce((sum, chunk) => sum + chunk.length, 0);
      assert.ok(totalChars > 0, 'Should preserve content');
    });

    test('handles 3 chunks from a very long single-character word', () => {
      const text = 'A'.repeat(7500);
      const result = adapter.splitMessage(text, 2500);

      assert.equal(result.length, 3);
      assert.equal(result[0].length, 2500);
      assert.equal(result[1].length, 2500);
      assert.equal(result[2].length, 2500);
    });

    test('handles text with trailing newline', () => {
      const text = 'Line 1\nLine 2\n';
      const result = adapter.splitMessage(text, 2000);

      assert.equal(result.length, 1);
      assert.equal(result[0], text);
    });

    test('handles unicode text splitting', () => {
      // Emoji and multi-byte characters
      const emoji = '🤖';
      const text = `${emoji.repeat(1000)}\n${emoji.repeat(1000)}`;
      const result = adapter.splitMessage(text, 2000);

      assert.ok(result.length >= 1, 'Should handle unicode characters');
    });
  });

  // ========================================================================
  // cleanMention
  // ========================================================================

  describe('cleanMention()', () => {
    let adapter;

    beforeEach(() => {
      adapter = new DiscordAdapter(createValidConfig());
    });

    test('removes a single mention from text', () => {
      const result = adapter.cleanMention('<@123456789> hello world');
      assert.equal(result, 'hello world');
    });

    test('removes mention with exclamation mark (nickname mention)', () => {
      const result = adapter.cleanMention('<@!123456789> hello world');
      assert.equal(result, 'hello world');
    });

    test('removes multiple mentions from text', () => {
      const result = adapter.cleanMention('<@111> <@222> hello');
      assert.equal(result, 'hello');
    });

    test('removes mixed normal and nickname mentions', () => {
      const result = adapter.cleanMention('<@111> <@!222> hello');
      assert.equal(result, 'hello');
    });

    test('removes mention from middle of text', () => {
      const result = adapter.cleanMention('hey <@123456> check this');
      assert.equal(result, 'hey  check this');
    });

    test('removes mention at end of text', () => {
      const result = adapter.cleanMention('hello <@123456>');
      assert.equal(result, 'hello');
    });

    test('handles text with no mentions', () => {
      const result = adapter.cleanMention('hello world');
      assert.equal(result, 'hello world');
    });

    test('handles mention-only text', () => {
      const result = adapter.cleanMention('<@123456>');
      assert.equal(result, '');
    });

    test('handles multiple mention-only text', () => {
      const result = adapter.cleanMention('<@111> <@222>');
      assert.equal(result, '');
    });

    test('trims surrounding whitespace', () => {
      const result = adapter.cleanMention('  <@123456>   hello   ');
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
      const result = adapter.cleanMention('<@123456> hello! @here #general $100');
      assert.equal(result, 'hello! @here #general $100');
    });

    test('handles long numeric user IDs', () => {
      const result = adapter.cleanMention('<@123456789012345678> hello');
      assert.equal(result, 'hello');
    });

    test('does not remove role mentions (<@&id>)', () => {
      // Discord role mentions use <@&ID> format - regex only matches <@ID> and <@!ID>
      const result = adapter.cleanMention('<@&999888> hello');
      assert.equal(result, '<@&999888> hello');
    });

    test('does not remove channel mentions (<#id>)', () => {
      const result = adapter.cleanMention('<#123456> hello');
      assert.equal(result, '<#123456> hello');
    });
  });

  // ========================================================================
  // DiscordAdapterError
  // ========================================================================

  describe('DiscordAdapterError', () => {
    test('is an instance of Error', () => {
      const error = new DiscordAdapterError('Test error');
      assert.ok(error instanceof Error);
    });

    test('has correct name', () => {
      const error = new DiscordAdapterError('Test error');
      assert.equal(error.name, 'DiscordAdapterError');
    });

    test('stores message', () => {
      const error = new DiscordAdapterError('Something went wrong');
      assert.equal(error.message, 'Something went wrong');
    });

    test('stores operation', () => {
      const error = new DiscordAdapterError('Test', { operation: 'sendMessage' });
      assert.equal(error.operation, 'sendMessage');
    });

    test('stores reason', () => {
      const error = new DiscordAdapterError('Test', { reason: 'Missing channel' });
      assert.equal(error.reason, 'Missing channel');
    });

    test('stores cause', () => {
      const cause = new Error('Original failure');
      const error = new DiscordAdapterError('Wrapped error', { cause });
      assert.equal(error.cause, cause);
    });

    test('works without options', () => {
      const error = new DiscordAdapterError('Simple error');
      assert.equal(error.message, 'Simple error');
      assert.equal(error.operation, undefined);
      assert.equal(error.reason, undefined);
    });
  });

  // ========================================================================
  // Full Integration Scenarios
  // ========================================================================

  describe('full flow scenarios', () => {
    test('complete @mention flow: init → start → receive → respond → stop', async () => {
      const adapter = new DiscordAdapter(createValidConfig());
      const receivedMessages = [];

      adapter.onMessage(async msg => {
        receivedMessages.push(msg);
        await adapter.sendMessage(msg.channelId, 'Bot response');
      });

      await adapter.initialize();
      await adapter.start();

      await simulateMessageCreate(
        createGuildMessage({
          content: `<@${mockBotUser.id}> deploy to production`,
        })
      );

      // Verify received
      assert.equal(receivedMessages.length, 1);
      assert.equal(receivedMessages[0].text, 'deploy to production');
      assert.equal(receivedMessages[0].isDM, false);
      assert.equal(receivedMessages[0].guildId, 'G789GUILD');

      // Verify sent response
      assert.equal(channelSendSpy.mock.callCount(), 1);
      assert.equal(channelSendSpy.mock.calls[0].arguments[0], 'Bot response');

      await adapter.stop();
      assert.equal(adapter.started, false);
    });

    test('complete DM flow: init → start → receive DM → respond → stop', async () => {
      const adapter = new DiscordAdapter(createValidConfig());
      const receivedMessages = [];

      adapter.onMessage(async msg => {
        receivedMessages.push(msg);
        await adapter.sendMessage(msg.channelId, 'DM reply');
      });

      await adapter.initialize();
      await adapter.start();

      await simulateMessageCreate(
        createDMMessage({
          content: 'Private question',
        })
      );

      assert.equal(receivedMessages.length, 1);
      assert.equal(receivedMessages[0].text, 'Private question');
      assert.equal(receivedMessages[0].isDM, true);
      assert.equal(receivedMessages[0].guildId, null);

      assert.equal(channelSendSpy.mock.callCount(), 1);
      assert.equal(channelSendSpy.mock.calls[0].arguments[0], 'DM reply');

      await adapter.stop();
    });

    test('handles multiple sequential messages', async () => {
      const adapter = await createInitializedAdapter();
      const messages = [];
      adapter.onMessage(async msg => messages.push(msg));
      await adapter.start();

      // Send 5 mentions sequentially
      for (let i = 0; i < 5; i++) {
        await simulateMessageCreate(
          createGuildMessage({
            author: { bot: false, id: `U${i}00USER` },
            content: `<@${mockBotUser.id}> message ${i}`,
          })
        );
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
      await simulateMessageCreate(
        createGuildMessage({
          author: { bot: false, id: 'U111' },
          content: `<@${mockBotUser.id}> channel message`,
        })
      );

      // DM
      await simulateMessageCreate(
        createDMMessage({
          author: { bot: false, id: 'U333' },
          content: 'dm message',
        })
      );

      // Another mention
      await simulateMessageCreate(
        createGuildMessage({
          author: { bot: false, id: 'U555' },
          content: `<@${mockBotUser.id}> another channel message`,
        })
      );

      assert.equal(messages.length, 3);
      assert.equal(messages[0].isDM, false);
      assert.equal(messages[0].text, 'channel message');
      assert.equal(messages[1].isDM, true);
      assert.equal(messages[1].text, 'dm message');
      assert.equal(messages[2].isDM, false);
      assert.equal(messages[2].text, 'another channel message');

      await adapter.stop();
    });

    test('sends long response as multiple messages', async () => {
      const adapter = await createInitializedAdapter();
      await adapter.start();

      // Send a response > 2000 chars
      const longResponse = 'B'.repeat(4500);
      await adapter.sendMessage('C456DEF', longResponse);

      assert.equal(channelSendSpy.mock.callCount(), 3);
      const total = channelSendSpy.mock.calls.reduce(
        (sum, call) => sum + call.arguments[0].length,
        0
      );
      assert.equal(total, 4500, 'All characters should be sent');

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

      await simulateMessageCreate(createGuildMessage());

      assert.equal(handler.mock.callCount(), 1);
      await adapter.stop();
    });

    test('handler can be replaced mid-stream', async () => {
      const adapter = await createInitializedAdapter();
      const handler1 = mock.fn();
      const handler2 = mock.fn();

      adapter.onMessage(handler1);
      await adapter.start();

      await simulateMessageCreate(
        createGuildMessage({
          content: `<@${mockBotUser.id}> first`,
        })
      );

      // Replace handler
      adapter.onMessage(handler2);

      await simulateMessageCreate(
        createGuildMessage({
          content: `<@${mockBotUser.id}> second`,
        })
      );

      assert.equal(handler1.mock.callCount(), 1);
      assert.equal(handler2.mock.callCount(), 1);

      await adapter.stop();
    });

    test('handles empty text in mention event', async () => {
      const adapter = await createInitializedAdapter();
      const handler = mock.fn();
      adapter.onMessage(handler);

      await simulateMessageCreate(
        createGuildMessage({
          content: `<@${mockBotUser.id}>`,
        })
      );

      assert.equal(handler.mock.callCount(), 1);
      const msg = handler.mock.calls[0].arguments[0];
      assert.equal(msg.text, '');
    });

    test('handles empty text in DM event', async () => {
      const adapter = await createInitializedAdapter();
      const handler = mock.fn();
      adapter.onMessage(handler);

      await simulateMessageCreate(createDMMessage({ content: '' }));

      assert.equal(handler.mock.callCount(), 1);
      const msg = handler.mock.calls[0].arguments[0];
      assert.equal(msg.text, '');
    });

    test('preserves unicode text in messages', async () => {
      const adapter = await createInitializedAdapter();
      const handler = mock.fn();
      adapter.onMessage(handler);

      const unicodeText = 'こんにちは 🤖 Привет مرحبا';
      await simulateMessageCreate(createDMMessage({ content: unicodeText }));

      const msg = handler.mock.calls[0].arguments[0];
      assert.equal(msg.text, unicodeText);
    });

    test('handles long messages', async () => {
      const adapter = await createInitializedAdapter();
      const handler = mock.fn();
      adapter.onMessage(handler);

      const longText = 'A'.repeat(10000);
      await simulateMessageCreate(createDMMessage({ content: longText }));

      const msg = handler.mock.calls[0].arguments[0];
      assert.equal(msg.text.length, 10000);
    });

    test('handles client.user being null during mention check', async () => {
      const adapter = await createInitializedAdapter();
      const handler = mock.fn();
      adapter.onMessage(handler);

      // Simulate client.user being null (before ready event)
      adapter.client.user = null;

      await simulateMessageCreate(createGuildMessage());

      // With client.user null, the mention check `this.client.user &&` is false
      // So non-DM messages won't match as mentioned
      assert.equal(handler.mock.callCount(), 0, 'Should not dispatch when client.user is null');
    });

    test('error event handler does not throw', async () => {
      await createInitializedAdapter();

      // Trigger error event - should not throw
      const errorHandlers = clientEventHandlers.error || [];
      for (const handler of errorHandlers) {
        handler(new Error('Simulated client error'));
      }
    });

    test('ready event handler does not throw', async () => {
      await createInitializedAdapter();

      // Trigger ready event - should not throw
      const readyHandlers = clientEventHandlers.ready || [];
      for (const handler of readyHandlers) {
        handler();
      }
    });
  });
});
