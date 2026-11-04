/**
 * ChannelManager - Channel adapter lifecycle management
 *
 * Manages channel adapters through a factory/registry pattern.
 * Registers adapter classes by type (e.g., 'slack', 'discord'),
 * initializes channel instances from config, and provides
 * graceful shutdown of all channels.
 *
 * Built-in adapter types are registered automatically:
 * - 'slack' -> SlackAdapter
 * - 'discord' -> DiscordAdapter
 *
 * Custom adapter types can be registered via registerAdapter().
 *
 * @module core/channel-manager
 */

/**
 * Channel statuses for tracking lifecycle
 */
const CHANNEL_STATUSES = {
  INITIALIZING: 'initializing',
  READY: 'ready',
  STARTED: 'started',
  STOPPING: 'stopping',
  STOPPED: 'stopped',
  ERROR: 'error',
};

/**
 * Custom error for channel management failures
 */
export class ChannelManagerError extends Error {
  /**
   * Create a ChannelManagerError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - The operation that failed
   * @param {string} [options.channelName] - Name of the channel involved
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'ChannelManagerError';
    this.operation = options.operation;
    this.channelName = options.channelName;
  }
}

/**
 * ChannelManager - manages channel adapter lifecycle
 *
 * Maintains two registries:
 * - adapterTypes: Map<string, Function> - adapter class constructors by type
 * - channels: Map<string, Object> - initialized channel instances by name
 *
 * @example
 * const manager = new ChannelManager();
 * manager.registerAdapter('slack', SlackAdapter);
 * await manager.initializeChannel('slack-main', {
 *   type: 'slack',
 *   botToken: 'xoxb-...',
 *   appToken: 'xapp-...',
 *   signingSecret: '...'
 * });
 * const channel = manager.getChannel('slack-main');
 */
export class ChannelManager {
  /**
   * Create a ChannelManager instance
   *
   * @param {Object} [options={}] - Configuration options
   * @param {Function|null} [options.logger=null] - Logger function for status messages
   */
  constructor(options = {}) {
    /** @type {Function|null} Logger function */
    this.logger = options.logger || null;

    /** @type {Map<string, Function>} Adapter class registry by type */
    this.adapterTypes = new Map();

    /** @type {Map<string, Object>} Initialized channel instances by name */
    this.channels = new Map();
  }

  /**
   * Register a channel adapter class for a given type
   *
   * The adapter class must be a constructor/class with the standard
   * adapter interface: constructor(config), initialize(), start(),
   * stop(), onMessage(handler), sendMessage(channelId, text).
   *
   * @param {string} type - Channel type identifier (e.g., 'slack', 'discord')
   * @param {Function} AdapterClass - Adapter class/constructor
   * @throws {ChannelManagerError} If type or AdapterClass is invalid
   */
  registerAdapter(type, AdapterClass) {
    if (!type || typeof type !== 'string') {
      throw new ChannelManagerError('Adapter type must be a non-empty string', {
        operation: 'registerAdapter',
      });
    }

    if (!AdapterClass || typeof AdapterClass !== 'function') {
      throw new ChannelManagerError('AdapterClass must be a constructor function or class', {
        operation: 'registerAdapter',
      });
    }

    this.adapterTypes.set(type, AdapterClass);
    this._log(`Registered adapter type: ${type}`);
  }

  /**
   * Initialize a channel from its configuration
   *
   * Looks up the adapter class from the type registry, creates an instance,
   * calls initialize(), and stores it in the channels map. The config must
   * include a `type` field matching a registered adapter type.
   *
   * @param {string} name - Unique channel name (e.g., 'slack-main')
   * @param {Object} config - Channel configuration
   * @param {string} config.type - Adapter type (must be registered)
   * @returns {Promise<Object>} Channel entry with adapter, config, status, name
   * @throws {ChannelManagerError} If name, config, or adapter type is invalid
   */
  async initializeChannel(name, config) {
    if (!name || typeof name !== 'string') {
      throw new ChannelManagerError('Channel name must be a non-empty string', {
        operation: 'initializeChannel',
      });
    }

    if (!config || typeof config !== 'object') {
      throw new ChannelManagerError('Channel config must be a non-null object', {
        operation: 'initializeChannel',
        channelName: name,
      });
    }

    if (!config.type || typeof config.type !== 'string') {
      throw new ChannelManagerError(
        `Channel '${name}' config must include a 'type' string (e.g., 'slack', 'discord')`,
        { operation: 'initializeChannel', channelName: name }
      );
    }

    const AdapterClass = this.adapterTypes.get(config.type);
    if (!AdapterClass) {
      throw new ChannelManagerError(
        `No adapter registered for channel type '${config.type}'. ` +
          `Registered types: ${this._registeredTypes()}`,
        { operation: 'initializeChannel', channelName: name }
      );
    }

    // Stop existing channel with same name before re-initializing.
    // Must stop before replacing the map entry so the old adapter
    // is properly cleaned up (connections, event handlers, etc.).
    if (this.channels.has(name)) {
      this._log(`Re-initializing channel '${name}', stopping existing instance...`);
      await this._stopChannel(name);
      this.channels.delete(name);
    }

    const channel = {
      name,
      config,
      adapter: null,
      status: CHANNEL_STATUSES.INITIALIZING,
      createdAt: new Date(),
    };

    // Store early so the channel is tracked during initialization.
    // Rolled back (removed) on failure below.
    this.channels.set(name, channel);

    try {
      const adapter = new AdapterClass(config);
      await adapter.initialize(config);

      channel.adapter = adapter;
      channel.status = CHANNEL_STATUSES.READY;
      this._log(`Initialized channel: ${name} (${config.type})`);

      return channel;
    } catch (err) {
      channel.status = CHANNEL_STATUSES.ERROR;
      this.channels.delete(name);
      if (err instanceof ChannelManagerError) {
        throw err;
      }
      throw new ChannelManagerError(
        `Failed to initialize channel '${name}' (${config.type}): ${err.message}`,
        { cause: err, operation: 'initializeChannel', channelName: name }
      );
    }
  }

  /**
   * Get a channel by name
   *
   * @param {string} name - Channel name
   * @returns {Object|undefined} Channel entry or undefined if not found
   */
  getChannel(name) {
    return this.channels.get(name);
  }

  /**
   * Get the adapter instance for a channel by name
   *
   * Convenience method that returns just the adapter, not the full channel entry.
   *
   * @param {string} name - Channel name
   * @returns {Object|undefined} Adapter instance or undefined if not found
   */
  getAdapter(name) {
    const channel = this.channels.get(name);
    return channel ? channel.adapter : undefined;
  }

  /**
   * Check if a channel exists by name
   *
   * @param {string} name - Channel name
   * @returns {boolean} True if channel exists
   */
  hasChannel(name) {
    return this.channels.has(name);
  }

  /**
   * List all initialized channels
   *
   * @returns {Array<Object>} Array of channel entries
   */
  listChannels() {
    return Array.from(this.channels.values());
  }

  /**
   * Get count of channels, optionally filtered by status
   *
   * @param {string} [status] - Status to filter by. If omitted, returns total count.
   * @returns {number} Number of channels matching the status
   */
  getChannelCount(status) {
    if (!status) {
      return this.channels.size;
    }
    return this.listChannels().filter(ch => ch.status === status).length;
  }

  /**
   * Stop all initialized channels gracefully
   *
   * Iterates over all channels and calls stop() on each adapter.
   * Collects results and continues even if individual channels fail.
   *
   * @returns {Promise<Object>} Results with stopped/failed arrays
   */
  async stopAll() {
    const results = { stopped: [], failed: [] };

    for (const [name] of this.channels) {
      try {
        await this._stopChannel(name);
        results.stopped.push(name);
      } catch (err) {
        results.failed.push({ name, error: err.message });
      }
    }

    this.channels.clear();
    return results;
  }

  /**
   * Stop a single channel by name
   *
   * @param {string} name - Channel name to stop
   * @returns {Promise<void>}
   * @throws {ChannelManagerError} If channel not found or stop fails
   */
  async stopChannel(name) {
    if (!name || typeof name !== 'string') {
      throw new ChannelManagerError('Channel name must be a non-empty string', {
        operation: 'stopChannel',
      });
    }

    if (!this.channels.has(name)) {
      throw new ChannelManagerError(`Channel '${name}' not found`, {
        operation: 'stopChannel',
        channelName: name,
      });
    }

    await this._stopChannel(name);
    this.channels.delete(name);
  }

  /**
   * Broadcast a message to all initialized channels
   *
   * Sends the same message text to every channel. Each channel's adapter
   * must support `sendMessage(channelId, text)`. Collects results and
   * continues even if individual sends fail.
   *
   * @param {string} message - Message text to broadcast
   * @param {Object} [options={}] - Broadcast options
   * @param {string} [options.channelId] - Target channel/conversation ID on each adapter
   * @returns {Promise<Object>} Results with sent/failed arrays
   * @throws {ChannelManagerError} If message is not a non-empty string
   */
  async broadcastToAll(message, options = {}) {
    if (!message || typeof message !== 'string') {
      throw new ChannelManagerError('Broadcast message must be a non-empty string', {
        operation: 'broadcastToAll',
      });
    }

    const results = { sent: [], failed: [] };

    for (const [name, channel] of this.channels) {
      try {
        const { adapter } = channel;
        if (adapter && typeof adapter.sendMessage === 'function') {
          const targetChannelId = options.channelId || name;
          await adapter.sendMessage(targetChannelId, message);
          results.sent.push(name);
          this._log(`Broadcast sent to channel: ${name}`);
        } else {
          results.failed.push({
            name,
            error: 'Adapter does not support sendMessage',
          });
        }
      } catch (err) {
        results.failed.push({ name, error: err.message });
        this._log(`Broadcast failed for channel '${name}': ${err.message}`);
      }
    }

    return results;
  }

  /**
   * Get the current status of a channel
   *
   * Returns a snapshot of the channel's state including status, type,
   * creation time, and whether the adapter is present.
   *
   * @param {string} name - Channel name
   * @returns {Object|null} Channel status object or null if not found
   */
  getChannelStatus(name) {
    const channel = this.channels.get(name);
    if (!channel) {
      return null;
    }

    return {
      name: channel.name,
      status: channel.status,
      type: channel.config ? channel.config.type : null,
      hasAdapter: !!channel.adapter,
      createdAt: channel.createdAt,
    };
  }

  /**
   * Reconnect a channel by stopping and re-initializing it
   *
   * Uses the channel's stored configuration to perform a clean
   * stop-and-reinitialize cycle.
   *
   * @param {string} name - Channel name to reconnect
   * @returns {Promise<Object>} The re-initialized channel entry
   * @throws {ChannelManagerError} If channel not found or reconnect fails
   */
  async reconnectChannel(name) {
    if (!name || typeof name !== 'string') {
      throw new ChannelManagerError('Channel name must be a non-empty string', {
        operation: 'reconnectChannel',
      });
    }

    const channel = this.channels.get(name);
    if (!channel) {
      throw new ChannelManagerError(`Channel '${name}' not found`, {
        operation: 'reconnectChannel',
        channelName: name,
      });
    }

    const { config } = channel;
    this._log(`Reconnecting channel '${name}'...`);

    try {
      await this._stopChannel(name);
      this.channels.delete(name);
      const reconnected = await this.initializeChannel(name, config);
      this._log(`Reconnected channel: ${name}`);
      return reconnected;
    } catch (err) {
      if (err instanceof ChannelManagerError) {
        throw err;
      }
      throw new ChannelManagerError(`Failed to reconnect channel '${name}': ${err.message}`, {
        cause: err,
        operation: 'reconnectChannel',
        channelName: name,
      });
    }
  }

  /**
   * Update the configuration of an existing channel
   *
   * Merges new config values into the channel's existing config,
   * then stops and re-initializes the channel with the merged config.
   *
   * @param {string} name - Channel name to update
   * @param {Object} configUpdates - Config fields to merge/override
   * @returns {Promise<Object>} The re-initialized channel entry
   * @throws {ChannelManagerError} If channel not found or update fails
   */
  async updateChannelConfig(name, configUpdates) {
    if (!name || typeof name !== 'string') {
      throw new ChannelManagerError('Channel name must be a non-empty string', {
        operation: 'updateChannelConfig',
      });
    }

    if (!configUpdates || typeof configUpdates !== 'object') {
      throw new ChannelManagerError('Config updates must be a non-null object', {
        operation: 'updateChannelConfig',
        channelName: name,
      });
    }

    const channel = this.channels.get(name);
    if (!channel) {
      throw new ChannelManagerError(`Channel '${name}' not found`, {
        operation: 'updateChannelConfig',
        channelName: name,
      });
    }

    const mergedConfig = { ...channel.config, ...configUpdates };
    this._log(`Updating config for channel '${name}'`);

    try {
      await this._stopChannel(name);
      this.channels.delete(name);
      const updated = await this.initializeChannel(name, mergedConfig);
      this._log(`Updated channel config: ${name}`);
      return updated;
    } catch (err) {
      if (err instanceof ChannelManagerError) {
        throw err;
      }
      throw new ChannelManagerError(
        `Failed to update channel config for '${name}': ${err.message}`,
        { cause: err, operation: 'updateChannelConfig', channelName: name }
      );
    }
  }

  /**
   * Get stats for all channels as a summary object
   *
   * Returns counts by status and basic info about each channel.
   *
   * @returns {Object} Channel stats with byStatus counts and channels array
   */
  getChannelStats() {
    const byStatus = {};
    const channelList = [];

    for (const [name, channel] of this.channels) {
      const { status } = channel;
      byStatus[status] = (byStatus[status] || 0) + 1;

      channelList.push({
        name,
        status,
        type: channel.config ? channel.config.type : null,
        createdAt: channel.createdAt,
      });
    }

    return {
      total: this.channels.size,
      byStatus,
      channels: channelList,
    };
  }

  /**
   * Get registered adapter type names
   *
   * @returns {string[]} Array of registered type names
   */
  getRegisteredTypes() {
    return Array.from(this.adapterTypes.keys());
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  /**
   * Stop a single channel adapter
   *
   * Tries adapter.stop(), then adapter.close(), then adapter.disconnect()
   * to accommodate different adapter interfaces.
   *
   * @param {string} name - Channel name
   * @returns {Promise<void>}
   * @private
   */
  async _stopChannel(name) {
    const channel = this.channels.get(name);
    if (!channel || !channel.adapter) {
      return;
    }

    channel.status = CHANNEL_STATUSES.STOPPING;

    try {
      const { adapter } = channel;
      if (typeof adapter.stop === 'function') {
        await adapter.stop();
      } else if (typeof adapter.close === 'function') {
        await adapter.close();
      } else if (typeof adapter.disconnect === 'function') {
        await adapter.disconnect();
      }

      channel.status = CHANNEL_STATUSES.STOPPED;
      this._log(`Stopped channel: ${name}`);
    } catch (err) {
      channel.status = CHANNEL_STATUSES.ERROR;
      throw new ChannelManagerError(`Failed to stop channel '${name}': ${err.message}`, {
        cause: err,
        operation: 'stopChannel',
        channelName: name,
      });
    }
  }

  /**
   * Format registered type names for error messages
   *
   * @returns {string} Comma-separated list of types or 'none'
   * @private
   */
  _registeredTypes() {
    const types = this.getRegisteredTypes();
    return types.length > 0 ? types.join(', ') : 'none';
  }

  /**
   * Log a message if logger is available
   *
   * @param {string} message - Message to log
   * @private
   */
  _log(message) {
    if (this.logger) {
      this.logger(message);
    }
  }
}

export { CHANNEL_STATUSES };
export default ChannelManager;
