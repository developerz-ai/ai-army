/**
 * Unit tests for MessageRouter
 *
 * Tests message routing to bots based on channel binding and
 * restriction enforcement (allowlists, denylists, DM rules).
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { MessageRouter, MessageRouterError, matchesAny } from '../../../src/core/message-router.js';

/**
 * Create a mock BotManager for testing
 * @returns {Object} Mock BotManager with _bots map for test setup
 */
function createMockBotManager() {
  const bots = new Map();
  return {
    listBots: mock.fn(() => Array.from(bots.values())),
    getBot: mock.fn(botId => bots.get(botId)),
    _bots: bots,
  };
}

/**
 * Create a bot object for testing
 * @param {Object} [overrides={}] - Override default bot values
 * @returns {Object} Bot object
 */
function createBot(overrides = {}) {
  const id = overrides.id || 'test-bot';
  return {
    id,
    config: {
      id,
      channel: 'slack-main',
      restrictions: {},
      ...overrides.config,
    },
    status: 'running',
    soulContent: '',
    container: null,
    createdAt: new Date(),
    lastActiveAt: new Date(),
    ...overrides,
  };
}

/**
 * Create a message object for testing
 * @param {Object} [overrides={}] - Override default message values
 * @returns {Object} Message object
 */
function createMessage(overrides = {}) {
  return {
    type: 'slack',
    channelName: 'slack-main',
    userId: 'U123ABC',
    channelId: 'C456DEF',
    text: 'hello',
    isDM: false,
    ...overrides,
  };
}

/**
 * Helper to add a bot to the mock BotManager
 */
function addBot(botManager, overrides = {}) {
  const bot = createBot(overrides);
  botManager._bots.set(bot.id, bot);
  return bot;
}

describe('MessageRouter', () => {
  let router;
  let botManager;

  beforeEach(() => {
    botManager = createMockBotManager();
    router = new MessageRouter(botManager);
  });

  // ========================================================================
  // Constructor
  // ========================================================================

  describe('constructor', () => {
    test('creates instance with BotManager', () => {
      assert.ok(router);
      assert.equal(router.botManager, botManager);
    });

    test('accepts logger option', () => {
      const logger = mock.fn();
      const r = new MessageRouter(botManager, { logger });
      assert.equal(r.logger, logger);
    });

    test('defaults logger to null', () => {
      assert.equal(router.logger, null);
    });

    test('throws MessageRouterError when botManager is missing', () => {
      assert.throws(
        () => new MessageRouter(),
        err => {
          assert.equal(err.name, 'MessageRouterError');
          assert.match(err.message, /BotManager is required/);
          assert.equal(err.operation, 'constructor');
          return true;
        }
      );
    });

    test('throws MessageRouterError when botManager is null', () => {
      assert.throws(
        () => new MessageRouter(null),
        err => {
          assert.equal(err.name, 'MessageRouterError');
          assert.match(err.message, /BotManager is required/);
          return true;
        }
      );
    });
  });

  // ========================================================================
  // route()
  // ========================================================================

  describe('route()', () => {
    test('routes message to correct bot based on channel binding', async () => {
      addBot(botManager, { id: 'support', config: { channel: 'slack-main' } });
      const message = createMessage({ channelName: 'slack-main' });

      const result = await router.route(message);

      assert.equal(result.allowed, true);
      assert.equal(result.bot.id, 'support');
      assert.equal(result.reason, undefined);
    });

    test('returns not-allowed when no bot found for channel', async () => {
      const message = createMessage({ channelName: 'unknown-channel' });

      const result = await router.route(message);

      assert.equal(result.allowed, false);
      assert.equal(result.bot, null);
      assert.match(result.reason, /No bot found/);
    });

    test('returns not-allowed when bot found but user is restricted', async () => {
      addBot(botManager, {
        id: 'restricted',
        config: {
          channel: 'slack-main',
          restrictions: { deniedUsers: ['U123ABC'] },
        },
      });
      const message = createMessage({ userId: 'U123ABC', channelName: 'slack-main' });

      const result = await router.route(message);

      assert.equal(result.allowed, false);
      assert.equal(result.bot.id, 'restricted');
      assert.match(result.reason, /denylist/);
    });

    test('routes among multiple bots to the one with matching channel', async () => {
      addBot(botManager, { id: 'slack-bot', config: { channel: 'slack-main' } });
      addBot(botManager, { id: 'discord-bot', config: { channel: 'discord-main' } });

      const slackMessage = createMessage({ channelName: 'slack-main' });
      const discordMessage = createMessage({ channelName: 'discord-main' });

      const slackResult = await router.route(slackMessage);
      const discordResult = await router.route(discordMessage);

      assert.equal(slackResult.bot.id, 'slack-bot');
      assert.equal(discordResult.bot.id, 'discord-bot');
    });

    test('logs routing decisions when logger is provided', async () => {
      const logger = mock.fn();
      const r = new MessageRouter(botManager, { logger });
      addBot(botManager, { id: 'test', config: { channel: 'slack-main' } });

      await r.route(createMessage());

      const messages = logger.mock.calls.map(c => c.arguments[0]);
      assert.ok(messages.some(msg => msg.includes('Routed message to bot')));
    });

    test('logs when no bot found', async () => {
      const logger = mock.fn();
      const r = new MessageRouter(botManager, { logger });

      await r.route(createMessage({ channelName: 'unknown' }));

      const messages = logger.mock.calls.map(c => c.arguments[0]);
      assert.ok(messages.some(msg => msg.includes('No bot found')));
    });

    test('logs when message is blocked', async () => {
      const logger = mock.fn();
      const r = new MessageRouter(botManager, { logger });
      addBot(botManager, {
        id: 'blocked',
        config: {
          channel: 'slack-main',
          restrictions: { deniedUsers: ['U123ABC'] },
        },
      });

      await r.route(createMessage());

      const messages = logger.mock.calls.map(c => c.arguments[0]);
      assert.ok(messages.some(msg => msg.includes('blocked')));
    });

    test('throws MessageRouterError when message is null', async () => {
      await assert.rejects(
        () => router.route(null),
        err => {
          assert.equal(err.name, 'MessageRouterError');
          assert.match(err.message, /Message must be a non-null object/);
          assert.equal(err.operation, 'route');
          return true;
        }
      );
    });

    test('throws MessageRouterError when message is not an object', async () => {
      await assert.rejects(
        () => router.route('invalid'),
        err => {
          assert.equal(err.name, 'MessageRouterError');
          assert.match(err.message, /Message must be a non-null object/);
          return true;
        }
      );
    });

    test('throws MessageRouterError when message has no channelName', async () => {
      await assert.rejects(
        () => router.route({ userId: 'U123', channelId: 'C456' }),
        err => {
          assert.equal(err.name, 'MessageRouterError');
          assert.match(err.message, /channelName/);
          assert.equal(err.operation, 'route');
          return true;
        }
      );
    });

    test('throws MessageRouterError when channelName is not a string', async () => {
      await assert.rejects(
        () => router.route({ channelName: 123 }),
        err => {
          assert.equal(err.name, 'MessageRouterError');
          assert.match(err.message, /channelName/);
          return true;
        }
      );
    });
  });

  // ========================================================================
  // checkRestrictions()
  // ========================================================================

  describe('checkRestrictions()', () => {
    describe('DM restrictions', () => {
      test('blocks DMs when dmAllowed is false', () => {
        const config = { restrictions: { dmAllowed: false } };
        const message = createMessage({ isDM: true });

        const result = router.checkRestrictions(config, message);

        assert.equal(result.allowed, false);
        assert.match(result.reason, /DMs not allowed/);
      });

      test('allows DMs when dmAllowed is true', () => {
        const config = { restrictions: { dmAllowed: true } };
        const message = createMessage({ isDM: true });

        const result = router.checkRestrictions(config, message);

        assert.equal(result.allowed, true);
      });

      test('allows DMs when dmAllowed is not specified', () => {
        const config = { restrictions: {} };
        const message = createMessage({ isDM: true });

        const result = router.checkRestrictions(config, message);

        assert.equal(result.allowed, true);
      });

      test('does not block non-DM messages when dmAllowed is false', () => {
        const config = { restrictions: { dmAllowed: false } };
        const message = createMessage({ isDM: false });

        const result = router.checkRestrictions(config, message);

        assert.equal(result.allowed, true);
      });
    });

    describe('user allowlist', () => {
      test('allows user in allowedUsers list', () => {
        const config = { restrictions: { allowedUsers: ['U123ABC', 'U999'] } };
        const message = createMessage({ userId: 'U123ABC' });

        const result = router.checkRestrictions(config, message);

        assert.equal(result.allowed, true);
      });

      test('blocks user not in allowedUsers list', () => {
        const config = { restrictions: { allowedUsers: ['U999', 'U888'] } };
        const message = createMessage({ userId: 'U123ABC' });

        const result = router.checkRestrictions(config, message);

        assert.equal(result.allowed, false);
        assert.match(result.reason, /not in allowlist/);
      });

      test('allows any user when allowedUsers is empty', () => {
        const config = { restrictions: { allowedUsers: [] } };
        const message = createMessage({ userId: 'U123ABC' });

        const result = router.checkRestrictions(config, message);

        assert.equal(result.allowed, true);
      });

      test('allows any user when allowedUsers is not specified', () => {
        const config = { restrictions: {} };
        const message = createMessage({ userId: 'U123ABC' });

        const result = router.checkRestrictions(config, message);

        assert.equal(result.allowed, true);
      });

      test('matches user case-insensitively', () => {
        const config = { restrictions: { allowedUsers: ['alice'] } };
        const message = createMessage({ userId: 'Alice' });

        const result = router.checkRestrictions(config, message);

        assert.equal(result.allowed, true);
      });
    });

    describe('user denylist', () => {
      test('blocks user in deniedUsers list', () => {
        const config = { restrictions: { deniedUsers: ['U123ABC', 'U999'] } };
        const message = createMessage({ userId: 'U123ABC' });

        const result = router.checkRestrictions(config, message);

        assert.equal(result.allowed, false);
        assert.match(result.reason, /denylist/);
      });

      test('allows user not in deniedUsers list', () => {
        const config = { restrictions: { deniedUsers: ['U999'] } };
        const message = createMessage({ userId: 'U123ABC' });

        const result = router.checkRestrictions(config, message);

        assert.equal(result.allowed, true);
      });

      test('allows any user when deniedUsers is empty', () => {
        const config = { restrictions: { deniedUsers: [] } };
        const message = createMessage({ userId: 'U123ABC' });

        const result = router.checkRestrictions(config, message);

        assert.equal(result.allowed, true);
      });

      test('allows any user when deniedUsers is not specified', () => {
        const config = { restrictions: {} };
        const message = createMessage({ userId: 'U123ABC' });

        const result = router.checkRestrictions(config, message);

        assert.equal(result.allowed, true);
      });

      test('matches denied user case-insensitively', () => {
        const config = { restrictions: { deniedUsers: ['ALICE'] } };
        const message = createMessage({ userId: 'alice' });

        const result = router.checkRestrictions(config, message);

        assert.equal(result.allowed, false);
      });
    });

    describe('channel allowlist', () => {
      test('allows channel in allowedChannels list', () => {
        const config = { restrictions: { allowedChannels: ['C456DEF'] } };
        const message = createMessage({ channelId: 'C456DEF', isDM: false });

        const result = router.checkRestrictions(config, message);

        assert.equal(result.allowed, true);
      });

      test('blocks channel not in allowedChannels list', () => {
        const config = { restrictions: { allowedChannels: ['C999'] } };
        const message = createMessage({ channelId: 'C456DEF', isDM: false });

        const result = router.checkRestrictions(config, message);

        assert.equal(result.allowed, false);
        assert.match(result.reason, /Channel not in allowlist/);
      });

      test('allows any channel when allowedChannels is empty', () => {
        const config = { restrictions: { allowedChannels: [] } };
        const message = createMessage({ channelId: 'C456DEF', isDM: false });

        const result = router.checkRestrictions(config, message);

        assert.equal(result.allowed, true);
      });

      test('skips channel allowlist check for DMs', () => {
        const config = { restrictions: { allowedChannels: ['C999'] } };
        const message = createMessage({ channelId: 'C456DEF', isDM: true });

        const result = router.checkRestrictions(config, message);

        assert.equal(result.allowed, true);
      });

      test('matches channel name with # prefix', () => {
        const config = { restrictions: { allowedChannels: ['#engineering'] } };
        const message = createMessage({ channelId: 'engineering', isDM: false });

        const result = router.checkRestrictions(config, message);

        assert.equal(result.allowed, true);
      });

      test('matches channel name with exact # prefix', () => {
        const config = { restrictions: { allowedChannels: ['#engineering'] } };
        const message = createMessage({ channelId: '#engineering', isDM: false });

        const result = router.checkRestrictions(config, message);

        assert.equal(result.allowed, true);
      });
    });

    describe('channel denylist', () => {
      test('blocks channel in deniedChannels list', () => {
        const config = { restrictions: { deniedChannels: ['C456DEF'] } };
        const message = createMessage({ channelId: 'C456DEF' });

        const result = router.checkRestrictions(config, message);

        assert.equal(result.allowed, false);
        assert.match(result.reason, /Channel in denylist/);
      });

      test('allows channel not in deniedChannels list', () => {
        const config = { restrictions: { deniedChannels: ['C999'] } };
        const message = createMessage({ channelId: 'C456DEF' });

        const result = router.checkRestrictions(config, message);

        assert.equal(result.allowed, true);
      });

      test('allows any channel when deniedChannels is empty', () => {
        const config = { restrictions: { deniedChannels: [] } };
        const message = createMessage({ channelId: 'C456DEF' });

        const result = router.checkRestrictions(config, message);

        assert.equal(result.allowed, true);
      });

      test('blocks channel name matched with # prefix', () => {
        const config = { restrictions: { deniedChannels: ['#random'] } };
        const message = createMessage({ channelId: 'random' });

        const result = router.checkRestrictions(config, message);

        assert.equal(result.allowed, false);
      });

      test('blocks DM channels in deniedChannels', () => {
        const config = { restrictions: { deniedChannels: ['D123'] } };
        const message = createMessage({ channelId: 'D123', isDM: true });

        const result = router.checkRestrictions(config, message);

        assert.equal(result.allowed, false);
      });
    });

    describe('restriction resolution order', () => {
      test('DM check happens before user allowlist', () => {
        const config = {
          restrictions: {
            dmAllowed: false,
            allowedUsers: ['U123ABC'],
          },
        };
        const message = createMessage({ userId: 'U123ABC', isDM: true });

        const result = router.checkRestrictions(config, message);

        assert.equal(result.allowed, false);
        assert.match(result.reason, /DMs not allowed/);
      });

      test('user allowlist checked before user denylist', () => {
        const config = {
          restrictions: {
            allowedUsers: ['U999'],
            deniedUsers: ['U123ABC'],
          },
        };
        const message = createMessage({ userId: 'U123ABC' });

        // User is in denylist but NOT in allowlist, should fail on allowlist first
        const result = router.checkRestrictions(config, message);

        assert.equal(result.allowed, false);
        assert.match(result.reason, /not in allowlist/);
      });

      test('user denylist checked before channel allowlist', () => {
        const config = {
          restrictions: {
            deniedUsers: ['U123ABC'],
            allowedChannels: ['C456DEF'],
          },
        };
        const message = createMessage({
          userId: 'U123ABC',
          channelId: 'C456DEF',
          isDM: false,
        });

        const result = router.checkRestrictions(config, message);

        assert.equal(result.allowed, false);
        assert.match(result.reason, /denylist/);
      });
    });

    describe('no restrictions', () => {
      test('allows when restrictions object is empty', () => {
        const config = { restrictions: {} };
        const message = createMessage();

        const result = router.checkRestrictions(config, message);

        assert.equal(result.allowed, true);
      });

      test('allows when restrictions is not present in config', () => {
        const config = {};
        const message = createMessage();

        const result = router.checkRestrictions(config, message);

        assert.equal(result.allowed, true);
      });
    });

    describe('combined restrictions', () => {
      test('allows when user passes all checks', () => {
        const config = {
          restrictions: {
            dmAllowed: true,
            allowedUsers: ['U123ABC'],
            deniedUsers: ['U999'],
            allowedChannels: ['C456DEF'],
            deniedChannels: ['C000'],
          },
        };
        const message = createMessage({
          userId: 'U123ABC',
          channelId: 'C456DEF',
          isDM: false,
        });

        const result = router.checkRestrictions(config, message);

        assert.equal(result.allowed, true);
      });

      test('blocks when user passes user checks but fails channel check', () => {
        const config = {
          restrictions: {
            allowedUsers: ['U123ABC'],
            deniedChannels: ['C456DEF'],
          },
        };
        const message = createMessage({
          userId: 'U123ABC',
          channelId: 'C456DEF',
          isDM: false,
        });

        const result = router.checkRestrictions(config, message);

        assert.equal(result.allowed, false);
        assert.match(result.reason, /Channel in denylist/);
      });
    });

    describe('error handling', () => {
      test('throws when botConfig is null', () => {
        assert.throws(
          () => router.checkRestrictions(null, createMessage()),
          err => {
            assert.equal(err.name, 'MessageRouterError');
            assert.match(err.message, /Bot config must be a non-null object/);
            assert.equal(err.operation, 'checkRestrictions');
            return true;
          }
        );
      });

      test('throws when message is null', () => {
        assert.throws(
          () => router.checkRestrictions({}, null),
          err => {
            assert.equal(err.name, 'MessageRouterError');
            assert.match(err.message, /Message must be a non-null object/);
            assert.equal(err.operation, 'checkRestrictions');
            return true;
          }
        );
      });
    });
  });

  // ========================================================================
  // findBotForMessage()
  // ========================================================================

  describe('findBotForMessage()', () => {
    test('finds bot matching channel binding', () => {
      addBot(botManager, { id: 'support', config: { channel: 'slack-main' } });

      const bot = router.findBotForMessage(createMessage({ channelName: 'slack-main' }));

      assert.ok(bot);
      assert.equal(bot.id, 'support');
    });

    test('returns null when no bots loaded', () => {
      const bot = router.findBotForMessage(createMessage());

      assert.equal(bot, null);
    });

    test('returns null when no bot matches channel', () => {
      addBot(botManager, { id: 'discord-bot', config: { channel: 'discord-main' } });

      const bot = router.findBotForMessage(createMessage({ channelName: 'slack-main' }));

      assert.equal(bot, null);
    });

    test('finds correct bot among multiple bots', () => {
      addBot(botManager, { id: 'slack-bot', config: { channel: 'slack-main' } });
      addBot(botManager, { id: 'discord-bot', config: { channel: 'discord-main' } });
      addBot(botManager, { id: 'slack-dev', config: { channel: 'slack-dev' } });

      const bot = router.findBotForMessage(createMessage({ channelName: 'discord-main' }));

      assert.ok(bot);
      assert.equal(bot.id, 'discord-bot');
    });

    test('returns first match if multiple bots share same channel', () => {
      addBot(botManager, { id: 'bot-a', config: { channel: 'slack-main' } });
      addBot(botManager, { id: 'bot-b', config: { channel: 'slack-main' } });

      const bot = router.findBotForMessage(createMessage({ channelName: 'slack-main' }));

      assert.ok(bot);
      // Should find the first one
      assert.equal(bot.id, 'bot-a');
    });

    test('returns null when channelName is missing from message', () => {
      addBot(botManager, { id: 'support', config: { channel: 'slack-main' } });

      const bot = router.findBotForMessage({ userId: 'U123' });

      assert.equal(bot, null);
    });

    test('handles bot with no config gracefully', () => {
      botManager._bots.set('broken', { id: 'broken', config: null });

      const bot = router.findBotForMessage(createMessage());

      assert.equal(bot, null);
    });

    test('throws when message is null', () => {
      assert.throws(
        () => router.findBotForMessage(null),
        err => {
          assert.equal(err.name, 'MessageRouterError');
          assert.match(err.message, /Message must be a non-null object/);
          assert.equal(err.operation, 'findBotForMessage');
          return true;
        }
      );
    });

    test('throws when message is not an object', () => {
      assert.throws(
        () => router.findBotForMessage('invalid'),
        err => {
          assert.equal(err.name, 'MessageRouterError');
          return true;
        }
      );
    });

    test('calls botManager.listBots()', () => {
      addBot(botManager, { id: 'test', config: { channel: 'slack-main' } });

      router.findBotForMessage(createMessage());

      assert.equal(botManager.listBots.mock.calls.length, 1);
    });
  });
});

// ==========================================================================
// matchesAny()
// ==========================================================================

describe('matchesAny()', () => {
  test('matches exact string', () => {
    assert.equal(matchesAny('U123', ['U123', 'U456']), true);
  });

  test('matches case-insensitively', () => {
    assert.equal(matchesAny('alice', ['ALICE']), true);
    assert.equal(matchesAny('ALICE', ['alice']), true);
    assert.equal(matchesAny('Alice', ['alice']), true);
  });

  test('matches channel with # prefix stripped', () => {
    assert.equal(matchesAny('engineering', ['#engineering']), true);
  });

  test('matches channel with # prefix exactly', () => {
    assert.equal(matchesAny('#engineering', ['#engineering']), true);
  });

  test('returns false when no match', () => {
    assert.equal(matchesAny('U123', ['U456', 'U789']), false);
  });

  test('returns false for empty patterns', () => {
    assert.equal(matchesAny('U123', []), false);
  });

  test('returns false for null value', () => {
    assert.equal(matchesAny(null, ['U123']), false);
  });

  test('returns false for undefined value', () => {
    assert.equal(matchesAny(undefined, ['U123']), false);
  });

  test('returns false for null patterns', () => {
    assert.equal(matchesAny('U123', null), false);
  });

  test('returns false for undefined patterns', () => {
    assert.equal(matchesAny('U123', undefined), false);
  });

  test('matches email patterns case-insensitively', () => {
    assert.equal(matchesAny('alice@example.com', ['Alice@Example.COM']), true);
  });

  test('does not partially match', () => {
    assert.equal(matchesAny('U123', ['U12']), false);
    assert.equal(matchesAny('U12', ['U123']), false);
  });

  test('matches first occurrence in patterns', () => {
    assert.equal(matchesAny('U123', ['U456', 'U123', 'U789']), true);
  });
});

// ==========================================================================
// MessageRouterError
// ==========================================================================

describe('MessageRouterError', () => {
  test('is an instance of Error', () => {
    const error = new MessageRouterError('Test error');
    assert.ok(error instanceof Error);
  });

  test('has correct name', () => {
    const error = new MessageRouterError('Test error');
    assert.equal(error.name, 'MessageRouterError');
  });

  test('stores message', () => {
    const error = new MessageRouterError('Something went wrong');
    assert.equal(error.message, 'Something went wrong');
  });

  test('stores operation', () => {
    const error = new MessageRouterError('Test error', { operation: 'route' });
    assert.equal(error.operation, 'route');
  });

  test('stores botId', () => {
    const error = new MessageRouterError('Test error', { botId: 'test-bot' });
    assert.equal(error.botId, 'test-bot');
  });

  test('stores cause', () => {
    const cause = new Error('Original error');
    const error = new MessageRouterError('Test error', { cause });
    assert.equal(error.cause, cause);
  });

  test('stores all options together', () => {
    const cause = new Error('Original');
    const error = new MessageRouterError('Multi-option error', {
      cause,
      operation: 'checkRestrictions',
      botId: 'admin-bot',
    });

    assert.equal(error.cause, cause);
    assert.equal(error.operation, 'checkRestrictions');
    assert.equal(error.botId, 'admin-bot');
  });

  test('defaults optional fields to undefined', () => {
    const error = new MessageRouterError('Test error');
    assert.equal(error.operation, undefined);
    assert.equal(error.botId, undefined);
    assert.equal(error.cause, undefined);
  });
});
