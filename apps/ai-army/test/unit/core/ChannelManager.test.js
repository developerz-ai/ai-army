/**
 * Unit tests for ChannelManager
 *
 * Tests channel adapter lifecycle management: registration, initialization,
 * retrieval, listing, stopping, and error handling.
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  ChannelManager,
  ChannelManagerError,
  CHANNEL_STATUSES,
} from '../../../src/core/channel-manager.js';

/**
 * Create a mock adapter class for testing
 * @param {Object} [overrides={}] - Override default mock implementations
 * @returns {Function} Mock adapter class constructor
 */
function createMockAdapterClass(overrides = {}) {
  const initializeFn = overrides.initialize || mock.fn(async () => {});
  const startFn = overrides.start || mock.fn(async () => {});
  const stopFn = overrides.stop || mock.fn(async () => {});
  const onMessageFn = overrides.onMessage || mock.fn(() => {});
  const sendMessageFn = overrides.sendMessage || mock.fn(async () => {});

  class MockAdapter {
    constructor(config) {
      this.config = config;
      this.initialize = initializeFn;
      this.start = startFn;
      this.stop = stopFn;
      this.onMessage = onMessageFn;
      this.sendMessage = sendMessageFn;
      MockAdapter._lastInstance = this;
      MockAdapter._instances.push(this);
    }
  }

  MockAdapter._instances = [];
  MockAdapter._lastInstance = null;

  return MockAdapter;
}

/**
 * Create a valid channel config for testing
 * @param {Object} [overrides={}] - Override default config values
 * @returns {Object} Channel configuration
 */
function createChannelConfig(overrides = {}) {
  return {
    type: 'slack',
    botToken: 'xoxb-test-token',
    appToken: 'xapp-test-token',
    signingSecret: 'test-signing-secret',
    ...overrides,
  };
}

describe('ChannelManager', () => {
  let manager;
  let MockSlackAdapter;
  let MockDiscordAdapter;

  beforeEach(() => {
    MockSlackAdapter = createMockAdapterClass();
    MockDiscordAdapter = createMockAdapterClass();
    manager = new ChannelManager();
    manager.registerAdapter('slack', MockSlackAdapter);
    manager.registerAdapter('discord', MockDiscordAdapter);
  });

  describe('constructor', () => {
    test('creates instance with empty registries', () => {
      const m = new ChannelManager();
      assert.ok(m);
      assert.ok(m.adapterTypes instanceof Map);
      assert.ok(m.channels instanceof Map);
      assert.equal(m.adapterTypes.size, 0);
      assert.equal(m.channels.size, 0);
    });

    test('accepts logger option', () => {
      const logger = mock.fn();
      const m = new ChannelManager({ logger });
      assert.equal(m.logger, logger);
    });

    test('defaults logger to null', () => {
      const m = new ChannelManager();
      assert.equal(m.logger, null);
    });
  });

  describe('registerAdapter()', () => {
    test('registers an adapter class for a type', () => {
      const m = new ChannelManager();
      const Adapter = createMockAdapterClass();
      m.registerAdapter('test', Adapter);

      assert.ok(m.adapterTypes.has('test'));
      assert.equal(m.adapterTypes.get('test'), Adapter);
    });

    test('overwrites existing adapter for same type', () => {
      const m = new ChannelManager();
      const Adapter1 = createMockAdapterClass();
      const Adapter2 = createMockAdapterClass();

      m.registerAdapter('test', Adapter1);
      m.registerAdapter('test', Adapter2);

      assert.equal(m.adapterTypes.get('test'), Adapter2);
    });

    test('registers multiple adapter types', () => {
      const m = new ChannelManager();
      m.registerAdapter('slack', createMockAdapterClass());
      m.registerAdapter('discord', createMockAdapterClass());
      m.registerAdapter('telegram', createMockAdapterClass());

      assert.equal(m.adapterTypes.size, 3);
    });

    test('logs registration when logger provided', () => {
      const logger = mock.fn();
      const m = new ChannelManager({ logger });
      m.registerAdapter('slack', createMockAdapterClass());

      assert.equal(logger.mock.calls.length, 1);
      assert.match(logger.mock.calls[0].arguments[0], /Registered adapter type: slack/);
    });

    test('throws ChannelManagerError when type is empty', () => {
      assert.throws(
        () => manager.registerAdapter('', createMockAdapterClass()),
        err => {
          assert.equal(err.name, 'ChannelManagerError');
          assert.match(err.message, /Adapter type must be a non-empty string/);
          assert.equal(err.operation, 'registerAdapter');
          return true;
        }
      );
    });

    test('throws ChannelManagerError when type is null', () => {
      assert.throws(
        () => manager.registerAdapter(null, createMockAdapterClass()),
        err => {
          assert.equal(err.name, 'ChannelManagerError');
          assert.match(err.message, /Adapter type must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws ChannelManagerError when type is not a string', () => {
      assert.throws(
        () => manager.registerAdapter(123, createMockAdapterClass()),
        err => {
          assert.equal(err.name, 'ChannelManagerError');
          assert.match(err.message, /Adapter type must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws ChannelManagerError when AdapterClass is null', () => {
      assert.throws(
        () => manager.registerAdapter('test', null),
        err => {
          assert.equal(err.name, 'ChannelManagerError');
          assert.match(err.message, /AdapterClass must be a constructor/);
          assert.equal(err.operation, 'registerAdapter');
          return true;
        }
      );
    });

    test('throws ChannelManagerError when AdapterClass is not a function', () => {
      assert.throws(
        () => manager.registerAdapter('test', 'not-a-class'),
        err => {
          assert.equal(err.name, 'ChannelManagerError');
          assert.match(err.message, /AdapterClass must be a constructor/);
          return true;
        }
      );
    });

    test('throws ChannelManagerError when AdapterClass is an object', () => {
      assert.throws(
        () => manager.registerAdapter('test', {}),
        err => {
          assert.equal(err.name, 'ChannelManagerError');
          assert.match(err.message, /AdapterClass must be a constructor/);
          return true;
        }
      );
    });
  });

  describe('initializeChannel()', () => {
    test('initializes a channel with valid config', async () => {
      const config = createChannelConfig();
      const channel = await manager.initializeChannel('slack-main', config);

      assert.ok(channel);
      assert.equal(channel.name, 'slack-main');
      assert.equal(channel.status, CHANNEL_STATUSES.READY);
      assert.ok(channel.adapter);
      assert.equal(channel.config, config);
      assert.ok(channel.createdAt instanceof Date);
    });

    test('creates adapter with config', async () => {
      const config = createChannelConfig();
      await manager.initializeChannel('slack-main', config);

      assert.equal(MockSlackAdapter._instances.length, 1);
      assert.equal(MockSlackAdapter._lastInstance.config, config);
    });

    test('calls adapter.initialize() with config', async () => {
      const config = createChannelConfig();
      await manager.initializeChannel('slack-main', config);

      const adapter = MockSlackAdapter._lastInstance;
      assert.equal(adapter.initialize.mock.calls.length, 1);
      assert.equal(adapter.initialize.mock.calls[0].arguments[0], config);
    });

    test('stores channel in channels map', async () => {
      const config = createChannelConfig();
      await manager.initializeChannel('slack-main', config);

      assert.equal(manager.channels.size, 1);
      assert.ok(manager.channels.has('slack-main'));
    });

    test('initializes multiple channels', async () => {
      await manager.initializeChannel('slack-main', createChannelConfig());
      await manager.initializeChannel('discord-main', createChannelConfig({ type: 'discord' }));

      assert.equal(manager.channels.size, 2);
      assert.ok(manager.channels.has('slack-main'));
      assert.ok(manager.channels.has('discord-main'));
    });

    test('selects correct adapter class based on config.type', async () => {
      await manager.initializeChannel('slack-main', createChannelConfig({ type: 'slack' }));
      await manager.initializeChannel('discord-main', createChannelConfig({ type: 'discord' }));

      assert.equal(MockSlackAdapter._instances.length, 1);
      assert.equal(MockDiscordAdapter._instances.length, 1);
    });

    test('stops existing channel when re-initializing same name', async () => {
      await manager.initializeChannel('slack-main', createChannelConfig());

      // Capture the adapter from the stored channel entry (not static mock state)
      // to verify _stopChannel finds and stops the adapter via the map
      const firstChannel = manager.getChannel('slack-main');
      const firstAdapter = firstChannel.adapter;

      await manager.initializeChannel('slack-main', createChannelConfig());

      assert.equal(firstAdapter.stop.mock.calls.length, 1);
      assert.equal(manager.channels.size, 1);

      // Verify the stored channel now holds the new adapter, not the old one
      const updatedChannel = manager.getChannel('slack-main');
      assert.notEqual(updatedChannel.adapter, firstAdapter);
      assert.equal(updatedChannel.status, CHANNEL_STATUSES.READY);
    });

    test('logs initialization when logger provided', async () => {
      const logger = mock.fn();
      const m = new ChannelManager({ logger });
      m.registerAdapter('slack', createMockAdapterClass());

      await m.initializeChannel('slack-main', createChannelConfig());

      const messages = logger.mock.calls.map(c => c.arguments[0]);
      assert.ok(messages.some(msg => msg.includes('Initialized channel: slack-main')));
    });

    test('throws ChannelManagerError when name is empty', async () => {
      await assert.rejects(
        () => manager.initializeChannel('', createChannelConfig()),
        err => {
          assert.equal(err.name, 'ChannelManagerError');
          assert.match(err.message, /Channel name must be a non-empty string/);
          assert.equal(err.operation, 'initializeChannel');
          return true;
        }
      );
    });

    test('throws ChannelManagerError when name is null', async () => {
      await assert.rejects(
        () => manager.initializeChannel(null, createChannelConfig()),
        err => {
          assert.equal(err.name, 'ChannelManagerError');
          assert.match(err.message, /Channel name must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws ChannelManagerError when config is null', async () => {
      await assert.rejects(
        () => manager.initializeChannel('slack-main', null),
        err => {
          assert.equal(err.name, 'ChannelManagerError');
          assert.match(err.message, /Channel config must be a non-null object/);
          assert.equal(err.operation, 'initializeChannel');
          assert.equal(err.channelName, 'slack-main');
          return true;
        }
      );
    });

    test('throws ChannelManagerError when config is not an object', async () => {
      await assert.rejects(
        () => manager.initializeChannel('slack-main', 'invalid'),
        err => {
          assert.equal(err.name, 'ChannelManagerError');
          assert.match(err.message, /Channel config must be a non-null object/);
          return true;
        }
      );
    });

    test('throws ChannelManagerError when config.type is missing', async () => {
      await assert.rejects(
        () => manager.initializeChannel('slack-main', { botToken: 'xoxb-...' }),
        err => {
          assert.equal(err.name, 'ChannelManagerError');
          assert.match(err.message, /must include a 'type' string/);
          assert.equal(err.channelName, 'slack-main');
          return true;
        }
      );
    });

    test('throws ChannelManagerError when config.type is not a string', async () => {
      await assert.rejects(
        () => manager.initializeChannel('slack-main', { type: 123 }),
        err => {
          assert.equal(err.name, 'ChannelManagerError');
          assert.match(err.message, /must include a 'type' string/);
          return true;
        }
      );
    });

    test('throws ChannelManagerError for unregistered adapter type', async () => {
      await assert.rejects(
        () => manager.initializeChannel('tg-main', { type: 'telegram' }),
        err => {
          assert.equal(err.name, 'ChannelManagerError');
          assert.match(err.message, /No adapter registered for channel type 'telegram'/);
          assert.match(err.message, /Registered types:/);
          assert.equal(err.operation, 'initializeChannel');
          assert.equal(err.channelName, 'tg-main');
          return true;
        }
      );
    });

    test('includes registered types in unregistered type error', async () => {
      await assert.rejects(
        () => manager.initializeChannel('tg-main', { type: 'telegram' }),
        err => {
          assert.match(err.message, /slack/);
          assert.match(err.message, /discord/);
          return true;
        }
      );
    });

    test('shows "none" when no types registered and type not found', async () => {
      const m = new ChannelManager();
      await assert.rejects(
        () => m.initializeChannel('tg-main', { type: 'telegram' }),
        err => {
          assert.match(err.message, /Registered types: none/);
          return true;
        }
      );
    });

    test('throws ChannelManagerError when adapter constructor throws', async () => {
      const FailingAdapter = function () {
        throw new Error('Constructor failed');
      };
      manager.registerAdapter('failing', FailingAdapter);

      await assert.rejects(
        () => manager.initializeChannel('fail-chan', { type: 'failing' }),
        err => {
          assert.equal(err.name, 'ChannelManagerError');
          assert.match(err.message, /Failed to initialize channel 'fail-chan'/);
          assert.match(err.message, /Constructor failed/);
          assert.ok(err.cause);
          assert.equal(err.operation, 'initializeChannel');
          assert.equal(err.channelName, 'fail-chan');
          return true;
        }
      );
    });

    test('throws ChannelManagerError when adapter.initialize() rejects', async () => {
      const FailingInit = createMockAdapterClass({
        initialize: mock.fn(async () => {
          throw new Error('Init failed');
        }),
      });
      manager.registerAdapter('failing', FailingInit);

      await assert.rejects(
        () => manager.initializeChannel('fail-chan', { type: 'failing' }),
        err => {
          assert.equal(err.name, 'ChannelManagerError');
          assert.match(err.message, /Failed to initialize channel 'fail-chan'/);
          assert.match(err.message, /Init failed/);
          assert.ok(err.cause);
          return true;
        }
      );
    });

    test('does not store channel in map when initialization fails', async () => {
      const FailingInit = createMockAdapterClass({
        initialize: mock.fn(async () => {
          throw new Error('Init failed');
        }),
      });
      manager.registerAdapter('failing', FailingInit);

      try {
        await manager.initializeChannel('fail-chan', { type: 'failing' });
      } catch (_err) {
        // expected
      }

      assert.equal(manager.channels.has('fail-chan'), false);
    });

    test('cleans up old channel on re-init even when new init fails', async () => {
      await manager.initializeChannel('slack-main', createChannelConfig());
      const firstChannel = manager.getChannel('slack-main');
      const firstAdapter = firstChannel.adapter;

      const FailingInit = createMockAdapterClass({
        initialize: mock.fn(async () => {
          throw new Error('Re-init failed');
        }),
      });
      manager.registerAdapter('slack', FailingInit);

      try {
        await manager.initializeChannel('slack-main', createChannelConfig());
      } catch (_err) {
        // expected
      }

      // Old adapter must have been stopped
      assert.equal(firstAdapter.stop.mock.calls.length, 1);
      // Failed re-init should not leave stale entry in the map
      assert.equal(manager.channels.has('slack-main'), false);
    });
  });

  describe('getChannel()', () => {
    test('returns initialized channel', async () => {
      await manager.initializeChannel('slack-main', createChannelConfig());

      const channel = manager.getChannel('slack-main');

      assert.ok(channel);
      assert.equal(channel.name, 'slack-main');
      assert.ok(channel.adapter);
    });

    test('returns undefined for unknown channel', () => {
      const channel = manager.getChannel('nonexistent');
      assert.equal(channel, undefined);
    });

    test('returns channel with all expected properties', async () => {
      await manager.initializeChannel('slack-main', createChannelConfig());

      const channel = manager.getChannel('slack-main');

      assert.equal(typeof channel.name, 'string');
      assert.equal(typeof channel.config, 'object');
      assert.ok(channel.adapter);
      assert.equal(typeof channel.status, 'string');
      assert.ok(channel.createdAt instanceof Date);
    });
  });

  describe('getAdapter()', () => {
    test('returns adapter instance for initialized channel', async () => {
      await manager.initializeChannel('slack-main', createChannelConfig());

      const adapter = manager.getAdapter('slack-main');

      assert.ok(adapter);
      assert.equal(adapter, MockSlackAdapter._lastInstance);
    });

    test('returns undefined for unknown channel', () => {
      const adapter = manager.getAdapter('nonexistent');
      assert.equal(adapter, undefined);
    });
  });

  describe('hasChannel()', () => {
    test('returns true for initialized channel', async () => {
      await manager.initializeChannel('slack-main', createChannelConfig());
      assert.equal(manager.hasChannel('slack-main'), true);
    });

    test('returns false for unknown channel', () => {
      assert.equal(manager.hasChannel('nonexistent'), false);
    });
  });

  describe('listChannels()', () => {
    test('returns empty array when no channels initialized', () => {
      const channels = manager.listChannels();
      assert.deepEqual(channels, []);
    });

    test('returns all initialized channels', async () => {
      await manager.initializeChannel('slack-main', createChannelConfig());
      await manager.initializeChannel('discord-main', createChannelConfig({ type: 'discord' }));

      const channels = manager.listChannels();

      assert.equal(channels.length, 2);
      const names = channels.map(ch => ch.name);
      assert.ok(names.includes('slack-main'));
      assert.ok(names.includes('discord-main'));
    });

    test('returns array not a Map iterator', () => {
      const channels = manager.listChannels();
      assert.ok(Array.isArray(channels));
    });
  });

  describe('getChannelCount()', () => {
    test('returns 0 when no channels initialized', () => {
      assert.equal(manager.getChannelCount(), 0);
    });

    test('returns total count when no status filter', async () => {
      await manager.initializeChannel('slack-main', createChannelConfig());
      await manager.initializeChannel('discord-main', createChannelConfig({ type: 'discord' }));

      assert.equal(manager.getChannelCount(), 2);
    });

    test('returns count filtered by status', async () => {
      await manager.initializeChannel('slack-main', createChannelConfig());
      await manager.initializeChannel('discord-main', createChannelConfig({ type: 'discord' }));

      assert.equal(manager.getChannelCount(CHANNEL_STATUSES.READY), 2);
      assert.equal(manager.getChannelCount(CHANNEL_STATUSES.STOPPED), 0);
    });
  });

  describe('stopAll()', () => {
    test('stops all initialized channels', async () => {
      await manager.initializeChannel('slack-main', createChannelConfig());
      await manager.initializeChannel('discord-main', createChannelConfig({ type: 'discord' }));

      const slackAdapter = MockSlackAdapter._lastInstance;
      const discordAdapter = MockDiscordAdapter._lastInstance;

      const results = await manager.stopAll();

      assert.equal(results.stopped.length, 2);
      assert.equal(results.failed.length, 0);
      assert.ok(results.stopped.includes('slack-main'));
      assert.ok(results.stopped.includes('discord-main'));
      assert.equal(slackAdapter.stop.mock.calls.length, 1);
      assert.equal(discordAdapter.stop.mock.calls.length, 1);
    });

    test('clears channels map after stopping', async () => {
      await manager.initializeChannel('slack-main', createChannelConfig());

      await manager.stopAll();

      assert.equal(manager.channels.size, 0);
    });

    test('collects failures without throwing', async () => {
      const FailingStop = createMockAdapterClass({
        stop: mock.fn(async () => {
          throw new Error('Stop failed');
        }),
      });
      manager.registerAdapter('failing', FailingStop);

      await manager.initializeChannel('slack-main', createChannelConfig());
      await manager.initializeChannel('fail-chan', createChannelConfig({ type: 'failing' }));

      const results = await manager.stopAll();

      assert.equal(results.stopped.length, 1);
      assert.equal(results.failed.length, 1);
      assert.ok(results.stopped.includes('slack-main'));
      assert.equal(results.failed[0].name, 'fail-chan');
      assert.ok(results.failed[0].error);
    });

    test('returns empty results when no channels initialized', async () => {
      const m = new ChannelManager();
      const results = await m.stopAll();

      assert.deepEqual(results, { stopped: [], failed: [] });
    });

    test('tries adapter.close() if stop() is not available', async () => {
      const closeFn = mock.fn(async () => {});

      class CloseAdapter {
        constructor() {
          this.close = closeFn;
          this.initialize = mock.fn(async () => {});
        }
      }

      manager.registerAdapter('closeable', CloseAdapter);
      await manager.initializeChannel('close-chan', { type: 'closeable' });

      await manager.stopAll();

      assert.equal(closeFn.mock.calls.length, 1);
    });

    test('tries adapter.disconnect() if stop() and close() are not available', async () => {
      const disconnectFn = mock.fn(async () => {});

      class DisconnectAdapter {
        constructor() {
          this.disconnect = disconnectFn;
          this.initialize = mock.fn(async () => {});
        }
      }

      manager.registerAdapter('disconnectable', DisconnectAdapter);
      await manager.initializeChannel('dc-chan', { type: 'disconnectable' });

      await manager.stopAll();

      assert.equal(disconnectFn.mock.calls.length, 1);
    });

    test('handles adapter with no stop/close/disconnect gracefully', async () => {
      class MinimalAdapter {
        constructor() {
          this.initialize = mock.fn(async () => {});
        }
      }

      manager.registerAdapter('minimal', MinimalAdapter);
      await manager.initializeChannel('min-chan', { type: 'minimal' });

      const results = await manager.stopAll();

      assert.equal(results.stopped.length, 1);
      assert.equal(results.failed.length, 0);
    });
  });

  describe('stopChannel()', () => {
    test('stops a specific channel', async () => {
      await manager.initializeChannel('slack-main', createChannelConfig());
      const adapter = MockSlackAdapter._lastInstance;

      await manager.stopChannel('slack-main');

      assert.equal(adapter.stop.mock.calls.length, 1);
      assert.equal(manager.channels.has('slack-main'), false);
    });

    test('removes channel from map after stopping', async () => {
      await manager.initializeChannel('slack-main', createChannelConfig());
      await manager.initializeChannel('discord-main', createChannelConfig({ type: 'discord' }));

      await manager.stopChannel('slack-main');

      assert.equal(manager.channels.size, 1);
      assert.ok(manager.channels.has('discord-main'));
    });

    test('throws ChannelManagerError when name is empty', async () => {
      await assert.rejects(
        () => manager.stopChannel(''),
        err => {
          assert.equal(err.name, 'ChannelManagerError');
          assert.match(err.message, /Channel name must be a non-empty string/);
          assert.equal(err.operation, 'stopChannel');
          return true;
        }
      );
    });

    test('throws ChannelManagerError when channel not found', async () => {
      await assert.rejects(
        () => manager.stopChannel('nonexistent'),
        err => {
          assert.equal(err.name, 'ChannelManagerError');
          assert.match(err.message, /Channel 'nonexistent' not found/);
          assert.equal(err.operation, 'stopChannel');
          assert.equal(err.channelName, 'nonexistent');
          return true;
        }
      );
    });

    test('throws ChannelManagerError when adapter.stop() fails', async () => {
      const FailingStop = createMockAdapterClass({
        stop: mock.fn(async () => {
          throw new Error('Stop failed');
        }),
      });
      manager.registerAdapter('failing', FailingStop);
      await manager.initializeChannel('fail-chan', createChannelConfig({ type: 'failing' }));

      await assert.rejects(
        () => manager.stopChannel('fail-chan'),
        err => {
          assert.equal(err.name, 'ChannelManagerError');
          assert.match(err.message, /Failed to stop channel 'fail-chan'/);
          assert.ok(err.cause);
          return true;
        }
      );
    });
  });

  describe('getRegisteredTypes()', () => {
    test('returns registered type names', () => {
      const types = manager.getRegisteredTypes();
      assert.ok(types.includes('slack'));
      assert.ok(types.includes('discord'));
    });

    test('returns empty array when no types registered', () => {
      const m = new ChannelManager();
      const types = m.getRegisteredTypes();
      assert.deepEqual(types, []);
    });

    test('returns array not Map iterator', () => {
      const types = manager.getRegisteredTypes();
      assert.ok(Array.isArray(types));
    });
  });

  describe('broadcastToAll()', () => {
    test('broadcasts message to all channels', async () => {
      await manager.initializeChannel('slack-main', createChannelConfig());
      await manager.initializeChannel('discord-main', createChannelConfig({ type: 'discord' }));

      const results = await manager.broadcastToAll('Hello everyone!');

      assert.equal(results.sent.length, 2);
      assert.equal(results.failed.length, 0);
      assert.ok(results.sent.includes('slack-main'));
      assert.ok(results.sent.includes('discord-main'));
    });

    test('uses custom channelId when provided', async () => {
      await manager.initializeChannel('slack-main', createChannelConfig());

      const slackAdapter = MockSlackAdapter._lastInstance;
      await manager.broadcastToAll('Test message', { channelId: 'C123456' });

      assert.equal(slackAdapter.sendMessage.mock.calls.length, 1);
      assert.equal(slackAdapter.sendMessage.mock.calls[0].arguments[0], 'C123456');
      assert.equal(slackAdapter.sendMessage.mock.calls[0].arguments[1], 'Test message');
    });

    test('defaults to channel name when no channelId provided', async () => {
      await manager.initializeChannel('slack-main', createChannelConfig());

      const slackAdapter = MockSlackAdapter._lastInstance;
      await manager.broadcastToAll('Test message');

      assert.equal(slackAdapter.sendMessage.mock.calls[0].arguments[0], 'slack-main');
    });

    test('collects failures for channels without sendMessage', async () => {
      class NoSendAdapter {
        constructor(config) {
          this.config = config;
          this.initialize = mock.fn(async () => {});
          this.stop = mock.fn(async () => {});
        }
      }
      manager.registerAdapter('nosend', NoSendAdapter);

      await manager.initializeChannel('slack-main', createChannelConfig());
      await manager.initializeChannel('nosend-chan', createChannelConfig({ type: 'nosend' }));

      const results = await manager.broadcastToAll('Hello');

      assert.equal(results.sent.length, 1);
      assert.equal(results.failed.length, 1);
      assert.equal(results.failed[0].name, 'nosend-chan');
      assert.match(results.failed[0].error, /does not support sendMessage/);
    });

    test('collects failures when sendMessage throws', async () => {
      const FailingSend = createMockAdapterClass({
        sendMessage: mock.fn(async () => {
          throw new Error('Send failed');
        }),
      });
      manager.registerAdapter('failing', FailingSend);

      await manager.initializeChannel('slack-main', createChannelConfig());
      await manager.initializeChannel('fail-chan', createChannelConfig({ type: 'failing' }));

      const results = await manager.broadcastToAll('Hello');

      assert.equal(results.sent.length, 1);
      assert.equal(results.failed.length, 1);
      assert.equal(results.failed[0].name, 'fail-chan');
      assert.match(results.failed[0].error, /Send failed/);
    });

    test('throws when message is empty', async () => {
      await assert.rejects(
        () => manager.broadcastToAll(''),
        err => {
          assert.equal(err.name, 'ChannelManagerError');
          assert.match(err.message, /Broadcast message must be a non-empty string/);
          assert.equal(err.operation, 'broadcastToAll');
          return true;
        }
      );
    });

    test('throws when message is null', async () => {
      await assert.rejects(
        () => manager.broadcastToAll(null),
        err => {
          assert.equal(err.name, 'ChannelManagerError');
          return true;
        }
      );
    });

    test('returns empty results when no channels exist', async () => {
      const results = await manager.broadcastToAll('Hello');

      assert.equal(results.sent.length, 0);
      assert.equal(results.failed.length, 0);
    });
  });

  describe('getChannelStatus()', () => {
    test('returns status for initialized channel', async () => {
      await manager.initializeChannel('slack-main', createChannelConfig());

      const status = manager.getChannelStatus('slack-main');

      assert.ok(status);
      assert.equal(status.name, 'slack-main');
      assert.equal(status.status, CHANNEL_STATUSES.READY);
      assert.equal(status.type, 'slack');
      assert.equal(status.hasAdapter, true);
      assert.ok(status.createdAt instanceof Date);
    });

    test('returns null for unknown channel', () => {
      const status = manager.getChannelStatus('nonexistent');
      assert.equal(status, null);
    });

    test('shows hasAdapter false when adapter is null', async () => {
      await manager.initializeChannel('slack-main', createChannelConfig());
      const channel = manager.getChannel('slack-main');
      channel.adapter = null;

      const status = manager.getChannelStatus('slack-main');

      assert.equal(status.hasAdapter, false);
    });
  });

  describe('reconnectChannel()', () => {
    test('reconnects a channel successfully', async () => {
      await manager.initializeChannel('slack-main', createChannelConfig());
      const firstAdapter = MockSlackAdapter._lastInstance;

      const reconnected = await manager.reconnectChannel('slack-main');

      assert.equal(firstAdapter.stop.mock.calls.length, 1);
      assert.equal(reconnected.name, 'slack-main');
      assert.equal(reconnected.status, CHANNEL_STATUSES.READY);
      assert.notEqual(reconnected.adapter, firstAdapter);
    });

    test('uses original config when reconnecting', async () => {
      const config = createChannelConfig({ botToken: 'xoxb-original' });
      await manager.initializeChannel('slack-main', config);

      await manager.reconnectChannel('slack-main');

      const newAdapter = MockSlackAdapter._lastInstance;
      assert.equal(newAdapter.config.botToken, 'xoxb-original');
    });

    test('throws when name is empty', async () => {
      await assert.rejects(
        () => manager.reconnectChannel(''),
        err => {
          assert.equal(err.name, 'ChannelManagerError');
          assert.match(err.message, /Channel name must be a non-empty string/);
          assert.equal(err.operation, 'reconnectChannel');
          return true;
        }
      );
    });

    test('throws when channel not found', async () => {
      await assert.rejects(
        () => manager.reconnectChannel('nonexistent'),
        err => {
          assert.equal(err.name, 'ChannelManagerError');
          assert.match(err.message, /Channel 'nonexistent' not found/);
          assert.equal(err.operation, 'reconnectChannel');
          assert.equal(err.channelName, 'nonexistent');
          return true;
        }
      );
    });

    test('throws when re-initialization fails', async () => {
      await manager.initializeChannel('slack-main', createChannelConfig());

      // Replace adapter with one that fails on initialize
      const FailingInit = createMockAdapterClass({
        initialize: mock.fn(async () => {
          throw new Error('Reconnect init failed');
        }),
      });
      manager.registerAdapter('slack', FailingInit);

      await assert.rejects(
        () => manager.reconnectChannel('slack-main'),
        err => {
          assert.equal(err.name, 'ChannelManagerError');
          // The error from initializeChannel is re-thrown as-is
          assert.match(err.message, /Failed to initialize channel 'slack-main'/);
          assert.ok(err.cause);
          return true;
        }
      );
    });
  });

  describe('updateChannelConfig()', () => {
    test('updates channel config and reinitializes', async () => {
      const config = createChannelConfig({ botToken: 'xoxb-old' });
      await manager.initializeChannel('slack-main', config);
      const firstAdapter = MockSlackAdapter._lastInstance;

      const updated = await manager.updateChannelConfig('slack-main', { botToken: 'xoxb-new' });

      assert.equal(firstAdapter.stop.mock.calls.length, 1);
      assert.equal(updated.config.botToken, 'xoxb-new');
      assert.notEqual(updated.adapter, firstAdapter);
    });

    test('merges config updates with existing config', async () => {
      const config = createChannelConfig({ botToken: 'xoxb-old', appToken: 'xapp-old' });
      await manager.initializeChannel('slack-main', config);

      await manager.updateChannelConfig('slack-main', { botToken: 'xoxb-new' });

      const newAdapter = MockSlackAdapter._lastInstance;
      assert.equal(newAdapter.config.botToken, 'xoxb-new');
      assert.equal(newAdapter.config.appToken, 'xapp-old');
    });

    test('throws when name is empty', async () => {
      await assert.rejects(
        () => manager.updateChannelConfig('', {}),
        err => {
          assert.equal(err.name, 'ChannelManagerError');
          assert.match(err.message, /Channel name must be a non-empty string/);
          assert.equal(err.operation, 'updateChannelConfig');
          return true;
        }
      );
    });

    test('throws when configUpdates is null', async () => {
      await assert.rejects(
        () => manager.updateChannelConfig('slack-main', null),
        err => {
          assert.equal(err.name, 'ChannelManagerError');
          assert.match(err.message, /Config updates must be a non-null object/);
          assert.equal(err.operation, 'updateChannelConfig');
          return true;
        }
      );
    });

    test('throws when channel not found', async () => {
      await assert.rejects(
        () => manager.updateChannelConfig('nonexistent', { botToken: 'xoxb-new' }),
        err => {
          assert.equal(err.name, 'ChannelManagerError');
          assert.match(err.message, /Channel 'nonexistent' not found/);
          assert.equal(err.operation, 'updateChannelConfig');
          assert.equal(err.channelName, 'nonexistent');
          return true;
        }
      );
    });

    test('throws when re-initialization fails', async () => {
      await manager.initializeChannel('slack-main', createChannelConfig());

      // Replace adapter with one that fails on initialize
      const FailingInit = createMockAdapterClass({
        initialize: mock.fn(async () => {
          throw new Error('Update init failed');
        }),
      });
      manager.registerAdapter('slack', FailingInit);

      await assert.rejects(
        () => manager.updateChannelConfig('slack-main', { botToken: 'xoxb-new' }),
        err => {
          assert.equal(err.name, 'ChannelManagerError');
          // The error from initializeChannel is re-thrown as-is
          assert.match(err.message, /Failed to initialize channel 'slack-main'/);
          assert.ok(err.cause);
          return true;
        }
      );
    });
  });

  describe('getChannelStats()', () => {
    test('returns empty stats when no channels', () => {
      const stats = manager.getChannelStats();

      assert.equal(stats.total, 0);
      assert.deepEqual(stats.byStatus, {});
      assert.deepEqual(stats.channels, []);
    });

    test('returns stats for all channels', async () => {
      await manager.initializeChannel('slack-main', createChannelConfig());
      await manager.initializeChannel('discord-main', createChannelConfig({ type: 'discord' }));

      const stats = manager.getChannelStats();

      assert.equal(stats.total, 2);
      assert.equal(stats.byStatus[CHANNEL_STATUSES.READY], 2);
      assert.equal(stats.channels.length, 2);
    });

    test('includes channel details in channels array', async () => {
      await manager.initializeChannel('slack-main', createChannelConfig());

      const stats = manager.getChannelStats();
      const channelInfo = stats.channels[0];

      assert.equal(channelInfo.name, 'slack-main');
      assert.equal(channelInfo.status, CHANNEL_STATUSES.READY);
      assert.equal(channelInfo.type, 'slack');
      assert.ok(channelInfo.createdAt instanceof Date);
    });

    test('groups channels by status', async () => {
      await manager.initializeChannel('slack-main', createChannelConfig());
      await manager.initializeChannel('discord-main', createChannelConfig({ type: 'discord' }));

      // Manually set one channel to error status
      const channel = manager.getChannel('discord-main');
      channel.status = CHANNEL_STATUSES.ERROR;

      const stats = manager.getChannelStats();

      assert.equal(stats.byStatus[CHANNEL_STATUSES.READY], 1);
      assert.equal(stats.byStatus[CHANNEL_STATUSES.ERROR], 1);
    });
  });

  describe('full lifecycle', () => {
    test('register → initialize → get → stop flow', async () => {
      const m = new ChannelManager();
      const Adapter = createMockAdapterClass();

      // Register
      m.registerAdapter('slack', Adapter);
      assert.equal(m.adapterTypes.size, 1);

      // Initialize
      const config = createChannelConfig();
      const channel = await m.initializeChannel('slack-main', config);
      assert.equal(channel.status, CHANNEL_STATUSES.READY);

      // Get
      const retrieved = m.getChannel('slack-main');
      assert.equal(retrieved, channel);
      assert.ok(retrieved.adapter);

      // Stop
      await m.stopChannel('slack-main');
      assert.equal(m.channels.size, 0);
    });

    test('initializes and stops multiple channels independently', async () => {
      await manager.initializeChannel('slack-main', createChannelConfig());
      await manager.initializeChannel('discord-main', createChannelConfig({ type: 'discord' }));

      assert.equal(manager.channels.size, 2);

      await manager.stopChannel('slack-main');

      assert.equal(manager.channels.size, 1);
      assert.ok(manager.channels.has('discord-main'));

      await manager.stopChannel('discord-main');
      assert.equal(manager.channels.size, 0);
    });

    test('re-initializes channel after stopping', async () => {
      await manager.initializeChannel('slack-main', createChannelConfig());
      await manager.stopChannel('slack-main');

      const channel = await manager.initializeChannel('slack-main', createChannelConfig());
      assert.equal(channel.status, CHANNEL_STATUSES.READY);
      assert.equal(manager.channels.size, 1);
    });

    test('stopAll clears everything', async () => {
      await manager.initializeChannel('slack-main', createChannelConfig());
      await manager.initializeChannel('discord-main', createChannelConfig({ type: 'discord' }));

      const results = await manager.stopAll();

      assert.equal(results.stopped.length, 2);
      assert.equal(manager.channels.size, 0);
      assert.equal(manager.getChannelCount(), 0);
    });
  });
});

describe('ChannelManagerError', () => {
  test('is an instance of Error', () => {
    const error = new ChannelManagerError('Test error');
    assert.ok(error instanceof Error);
  });

  test('has correct name', () => {
    const error = new ChannelManagerError('Test error');
    assert.equal(error.name, 'ChannelManagerError');
  });

  test('stores message', () => {
    const error = new ChannelManagerError('Something went wrong');
    assert.equal(error.message, 'Something went wrong');
  });

  test('stores operation', () => {
    const error = new ChannelManagerError('Test error', { operation: 'initializeChannel' });
    assert.equal(error.operation, 'initializeChannel');
  });

  test('stores channelName', () => {
    const error = new ChannelManagerError('Test error', { channelName: 'slack-main' });
    assert.equal(error.channelName, 'slack-main');
  });

  test('stores cause', () => {
    const cause = new Error('Original error');
    const error = new ChannelManagerError('Test error', { cause });
    assert.equal(error.cause, cause);
  });

  test('stores all options together', () => {
    const cause = new Error('Original');
    const error = new ChannelManagerError('Multi-option error', {
      cause,
      operation: 'stopChannel',
      channelName: 'discord-main',
    });

    assert.equal(error.cause, cause);
    assert.equal(error.operation, 'stopChannel');
    assert.equal(error.channelName, 'discord-main');
  });

  test('defaults optional fields to undefined', () => {
    const error = new ChannelManagerError('Test error');
    assert.equal(error.operation, undefined);
    assert.equal(error.channelName, undefined);
    assert.equal(error.cause, undefined);
  });
});

describe('CHANNEL_STATUSES', () => {
  test('exports all expected status values', () => {
    assert.equal(CHANNEL_STATUSES.INITIALIZING, 'initializing');
    assert.equal(CHANNEL_STATUSES.READY, 'ready');
    assert.equal(CHANNEL_STATUSES.STARTED, 'started');
    assert.equal(CHANNEL_STATUSES.STOPPING, 'stopping');
    assert.equal(CHANNEL_STATUSES.STOPPED, 'stopped');
    assert.equal(CHANNEL_STATUSES.ERROR, 'error');
  });
});
