/**
 * SlackAdapter - Slack channel integration via @slack/bolt SDK
 *
 * Provides Slack connectivity using Socket Mode for real-time messaging.
 * Handles app_mention events (channel mentions) and DM messages.
 *
 * Required Slack bot scopes:
 * - app_mentions:read - Receive @mentions
 * - chat:write - Send messages
 * - channels:history - Read channel messages
 * - im:history - Read DM history
 *
 * Required app-level token scope:
 * - connections:write - Socket Mode connectivity
 *
 * @module SlackAdapter
 */

import bolt from '@slack/bolt';

const { App } = bolt;

/**
 * Custom error for Slack adapter failures
 */
export class SlackAdapterError extends Error {
  /**
   * Create a SlackAdapterError
   * @param {string} message - Error message
   * @param {Object} [options] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - Operation that failed
   * @param {string} [options.reason] - Additional context
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'SlackAdapterError';
    this.operation = options.operation;
    this.reason = options.reason;
  }
}

/**
 * Slack channel adapter using @slack/bolt with Socket Mode
 *
 * Listens for app_mention and DM events, normalizes them into
 * a standard message format, and provides message sending capabilities.
 *
 * @example
 * const adapter = new SlackAdapter({
 *   botToken: 'xoxb-...',
 *   appToken: 'xapp-...',
 *   signingSecret: '...'
 * });
 * await adapter.initialize();
 * adapter.onMessage(async msg => console.log(msg));
 * await adapter.start();
 */
export class SlackAdapter {
  /**
   * Create a SlackAdapter instance
   * @param {Object} config - Slack configuration
   * @param {string} config.botToken - Slack bot token (xoxb-...)
   * @param {string} config.appToken - Slack app-level token (xapp-...)
   * @param {string} config.signingSecret - Slack signing secret
   */
  constructor(config) {
    if (!config || typeof config !== 'object') {
      throw new SlackAdapterError('Config is required', {
        operation: 'constructor',
        reason: 'Missing or invalid config object',
      });
    }

    if (!config.botToken) {
      throw new SlackAdapterError('botToken is required', {
        operation: 'constructor',
        reason: 'Missing botToken in config',
      });
    }

    if (!config.appToken) {
      throw new SlackAdapterError('appToken is required', {
        operation: 'constructor',
        reason: 'Missing appToken in config',
      });
    }

    if (!config.signingSecret) {
      throw new SlackAdapterError('signingSecret is required', {
        operation: 'constructor',
        reason: 'Missing signingSecret in config',
      });
    }

    this.config = config;
    this.app = null;
    this.messageHandler = null;
    this.initialized = false;
    this.started = false;
  }

  /**
   * Initialize the Slack Bolt app with Socket Mode
   *
   * Creates the Bolt App instance and registers event handlers
   * for app_mention and direct message events.
   *
   * @returns {Promise<void>}
   * @throws {SlackAdapterError} If initialization fails
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      this.app = new App({
        token: this.config.botToken,
        appToken: this.config.appToken,
        socketMode: true,
        signingSecret: this.config.signingSecret,
      });

      this._setupEventHandlers();
      this.initialized = true;
    } catch (err) {
      throw new SlackAdapterError('Failed to initialize Slack adapter', {
        cause: err,
        operation: 'initialize',
      });
    }
  }

  /**
   * Register internal event handlers for Slack events
   *
   * Sets up listeners for:
   * - app_mention: When the bot is @mentioned in a channel
   * - message: When a DM is sent to the bot
   * @private
   */
  _setupEventHandlers() {
    // Handle @mentions in channels
    this.app.event('app_mention', async ({ event }) => {
      if (!this.messageHandler) return;

      const message = {
        type: 'slack',
        userId: event.user,
        channelId: event.channel,
        text: this.cleanMention(event.text),
        isDM: false,
        threadTs: event.thread_ts || event.ts,
      };

      await this.messageHandler(message);
    });

    // Handle direct messages
    this.app.event('message', async ({ event }) => {
      // Only handle DMs (im channel type)
      if (event.channel_type !== 'im') return;
      // Ignore message subtypes (edits, deletes, bot messages, etc.)
      if (event.subtype) return;
      if (!this.messageHandler) return;

      const message = {
        type: 'slack',
        userId: event.user,
        channelId: event.channel,
        text: event.text,
        isDM: true,
        threadTs: null,
      };

      await this.messageHandler(message);
    });
  }

  /**
   * Remove bot mention tags from message text
   *
   * Strips Slack mention format `<@U123ABC>` from the text
   * and trims any surrounding whitespace.
   *
   * @param {string} text - Raw message text containing mentions
   * @returns {string} Cleaned text without mention tags
   */
  cleanMention(text) {
    if (!text || typeof text !== 'string') return '';
    return text.replace(/<@[A-Z0-9]+>/g, '').trim();
  }

  /**
   * Register a message handler callback
   *
   * The handler will be called with a standardized message object
   * for each incoming app_mention or DM event.
   *
   * @param {Function} handler - Async function to handle incoming messages
   * @throws {SlackAdapterError} If handler is not a function
   */
  onMessage(handler) {
    if (typeof handler !== 'function') {
      throw new SlackAdapterError('Message handler must be a function', {
        operation: 'onMessage',
        reason: `Expected function, got ${typeof handler}`,
      });
    }

    this.messageHandler = handler;
  }

  /**
   * Start the Slack Socket Mode connection
   *
   * Begins listening for events from Slack. The adapter must
   * be initialized before calling start().
   *
   * @returns {Promise<void>}
   * @throws {SlackAdapterError} If not initialized or start fails
   */
  async start() {
    if (!this.initialized) {
      throw new SlackAdapterError('SlackAdapter not initialized. Call initialize() first', {
        operation: 'start',
      });
    }

    if (this.started) {
      return;
    }

    try {
      await this.app.start();
      this.started = true;
    } catch (err) {
      throw new SlackAdapterError('Failed to start Slack adapter', {
        cause: err,
        operation: 'start',
      });
    }
  }

  /**
   * Stop the Slack Socket Mode connection
   *
   * Gracefully disconnects from Slack. Safe to call even if
   * not started (will be a no-op).
   *
   * @returns {Promise<void>}
   * @throws {SlackAdapterError} If stop fails
   */
  async stop() {
    if (!this.started || !this.app) {
      return;
    }

    try {
      await this.app.stop();
      this.started = false;
    } catch (err) {
      throw new SlackAdapterError('Failed to stop Slack adapter', {
        cause: err,
        operation: 'stop',
      });
    }
  }

  /**
   * Send a message to a Slack channel
   *
   * Posts a text message to the specified channel, optionally
   * as a threaded reply.
   *
   * @param {string} channelId - Slack channel ID (e.g., 'C123ABC')
   * @param {string} text - Message text to send
   * @param {string} [threadTs] - Thread timestamp for threaded replies
   * @returns {Promise<void>}
   * @throws {SlackAdapterError} If not initialized or send fails
   */
  async sendMessage(channelId, text, threadTs) {
    if (!this.initialized) {
      throw new SlackAdapterError('SlackAdapter not initialized. Call initialize() first', {
        operation: 'sendMessage',
      });
    }

    if (!channelId) {
      throw new SlackAdapterError('channelId is required', {
        operation: 'sendMessage',
        reason: 'Missing channelId parameter',
      });
    }

    if (typeof text !== 'string') {
      throw new SlackAdapterError('text is required and must be a string', {
        operation: 'sendMessage',
        reason: 'Missing or non-string text parameter',
      });
    }

    try {
      const payload = {
        channel: channelId,
        text,
      };

      if (threadTs) {
        payload.thread_ts = threadTs;
      }

      await this.app.client.chat.postMessage(payload);
    } catch (err) {
      throw new SlackAdapterError(`Failed to send message to channel ${channelId}`, {
        cause: err,
        operation: 'sendMessage',
        reason: err.message,
      });
    }
  }
}

export default SlackAdapter;
