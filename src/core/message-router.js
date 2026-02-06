/**
 * MessageRouter - Message routing and restriction enforcement
 *
 * Routes incoming messages to the correct bot based on channel binding,
 * and enforces user/channel restrictions (allowlists, denylists, DM rules).
 *
 * Each bot has a `config.channel` binding that maps it to a named channel
 * (e.g., 'slack-main', 'discord-dev'). When a message arrives from a channel,
 * the router finds the bot bound to that channel and checks restrictions.
 *
 * Restriction resolution order:
 * 1. DM check: if isDM and dmAllowed=false → BLOCK
 * 2. User allowlist: if allowedUsers specified → must be in list
 * 3. User denylist: if deniedUsers specified → must NOT be in list
 * 4. Channel allowlist: if allowedChannels specified (non-DM) → must be in list
 * 5. Channel denylist: if deniedChannels specified → must NOT be in list
 *
 * @module core/message-router
 */

/**
 * Custom error for message routing failures
 */
export class MessageRouterError extends Error {
  /**
   * Create a MessageRouterError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - The operation that failed
   * @param {string} [options.botId] - ID of the bot involved
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'MessageRouterError';
    this.operation = options.operation;
    this.botId = options.botId;
  }
}

/**
 * Check if a value matches any pattern in a list
 *
 * Supports multiple match formats:
 * - IDs: exact match (case-insensitive)
 * - Usernames: exact match (case-insensitive)
 * - Emails: exact match (case-insensitive)
 * - Channel names: '#engineering' matches '#engineering' or 'engineering'
 *
 * @param {string} value - Value to match
 * @param {string[]} patterns - List of patterns to check against
 * @returns {boolean} True if value matches any pattern
 */
function matchesAny(value, patterns) {
  if (!value || !patterns || patterns.length === 0) {
    return false;
  }

  return patterns.some(pattern => {
    // Channel names: '#engineering' matches '#engineering' or 'engineering'
    if (pattern.startsWith('#')) {
      return value === pattern || value === pattern.slice(1);
    }
    // IDs, usernames, emails: case-insensitive match
    return value === pattern || value.toLowerCase() === pattern.toLowerCase();
  });
}

/**
 * MessageRouter - routes messages to bots and enforces restrictions
 *
 * @example
 * const router = new MessageRouter(botManager);
 * const bot = await router.route({
 *   type: 'slack',
 *   userId: 'U123',
 *   channelId: 'C456',
 *   channelName: 'slack-main',
 *   text: 'hello',
 *   isDM: false,
 * });
 */
export class MessageRouter {
  /**
   * Create a MessageRouter instance
   *
   * @param {Object} botManager - BotManager instance for looking up bots
   * @param {Object} [options={}] - Configuration options
   * @param {Function|null} [options.logger=null] - Logger function for routing decisions
   */
  constructor(botManager, options = {}) {
    if (!botManager) {
      throw new MessageRouterError('BotManager is required', {
        operation: 'constructor',
      });
    }

    /** @type {Object} BotManager instance */
    this.botManager = botManager;

    /** @type {Function|null} Logger function */
    this.logger = options.logger || null;
  }

  /**
   * Route a message to the correct bot
   *
   * Finds the bot bound to the message's channel, then checks restrictions.
   * Returns the bot if allowed, or null if no matching bot or restricted.
   *
   * @param {Object} message - Incoming message
   * @param {string} message.channelName - Name of the channel the message arrived on
   * @param {string} message.userId - User ID of the sender
   * @param {string} message.channelId - Channel/conversation ID
   * @param {string} message.text - Message text
   * @param {boolean} message.isDM - Whether this is a direct message
   * @returns {Promise<{bot: Object|null, allowed: boolean, reason?: string}>} Routing result
   * @throws {MessageRouterError} If message is invalid
   */
  async route(message) {
    if (!message || typeof message !== 'object') {
      throw new MessageRouterError('Message must be a non-null object', {
        operation: 'route',
      });
    }

    if (!message.channelName || typeof message.channelName !== 'string') {
      throw new MessageRouterError(
        'Message must include a channelName string identifying the source channel',
        { operation: 'route' }
      );
    }

    // Step 1: Find bot bound to this channel
    const bot = this.findBotForMessage(message);

    if (!bot) {
      this._log(`No bot found for channel '${message.channelName}'`);
      return { bot: null, allowed: false, reason: 'No bot found for channel' };
    }

    // Step 2: Check restrictions
    const restriction = this.checkRestrictions(bot.config, message);

    if (!restriction.allowed) {
      this._log(
        `Message blocked for bot '${bot.id}': ${restriction.reason} ` +
          `(user=${message.userId}, channel=${message.channelId})`
      );
      return { bot, allowed: false, reason: restriction.reason };
    }

    this._log(`Routed message to bot '${bot.id}' from user '${message.userId}'`);
    return { bot, allowed: true };
  }

  /**
   * Check restrictions for a bot config against a message
   *
   * Evaluates in order: DM permission, user allowlist, user denylist,
   * channel allowlist, channel denylist.
   *
   * @param {Object} botConfig - Bot configuration with optional restrictions
   * @param {Object} message - Incoming message
   * @param {string} message.userId - User ID of the sender
   * @param {string} message.channelId - Channel/conversation ID
   * @param {boolean} message.isDM - Whether this is a direct message
   * @returns {{allowed: boolean, reason?: string}} Restriction check result
   */
  checkRestrictions(botConfig, message) {
    if (!botConfig || typeof botConfig !== 'object') {
      throw new MessageRouterError('Bot config must be a non-null object', {
        operation: 'checkRestrictions',
      });
    }

    if (!message || typeof message !== 'object') {
      throw new MessageRouterError('Message must be a non-null object', {
        operation: 'checkRestrictions',
      });
    }

    const restrictions = botConfig.restrictions || {};
    const { userId, channelId, isDM } = message;

    // 1. DM check: if isDM and dmAllowed=false → BLOCK
    if (isDM && restrictions.dmAllowed === false) {
      return { allowed: false, reason: 'DMs not allowed for this bot' };
    }

    // 2. User allowlist: if specified, only these users can interact
    if (restrictions.allowedUsers && restrictions.allowedUsers.length > 0) {
      if (!matchesAny(userId, restrictions.allowedUsers)) {
        return { allowed: false, reason: 'User not in allowlist' };
      }
    }

    // 3. User denylist: block these users
    if (restrictions.deniedUsers && restrictions.deniedUsers.length > 0) {
      if (matchesAny(userId, restrictions.deniedUsers)) {
        return { allowed: false, reason: 'User in denylist' };
      }
    }

    // 4. Channel allowlist: if specified and not a DM, only these channels
    if (restrictions.allowedChannels && restrictions.allowedChannels.length > 0 && !isDM) {
      if (!matchesAny(channelId, restrictions.allowedChannels)) {
        return { allowed: false, reason: 'Channel not in allowlist' };
      }
    }

    // 5. Channel denylist: block these channels
    if (restrictions.deniedChannels && restrictions.deniedChannels.length > 0) {
      if (matchesAny(channelId, restrictions.deniedChannels)) {
        return { allowed: false, reason: 'Channel in denylist' };
      }
    }

    return { allowed: true };
  }

  /**
   * Find the bot that should handle a message based on channel binding
   *
   * Each bot has a `config.channel` property that names the channel it listens on.
   * This method finds the first running bot whose channel matches the message's
   * channelName.
   *
   * @param {Object} message - Incoming message
   * @param {string} message.channelName - Name of the channel (e.g., 'slack-main')
   * @returns {Object|null} Bot object or null if no match found
   */
  findBotForMessage(message) {
    if (!message || typeof message !== 'object') {
      throw new MessageRouterError('Message must be a non-null object', {
        operation: 'findBotForMessage',
      });
    }

    const { channelName } = message;
    if (!channelName) {
      return null;
    }

    const bots = this.botManager.listBots();

    for (const bot of bots) {
      if (bot.config && bot.config.channel === channelName) {
        return bot;
      }
    }

    return null;
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

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

export { matchesAny };
export default MessageRouter;
