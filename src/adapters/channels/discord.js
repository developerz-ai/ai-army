/**
 * DiscordAdapter - Discord channel integration via discord.js v14
 *
 * Provides Discord connectivity using Gateway Intents for real-time messaging.
 * Handles @mention events in guild channels and direct messages.
 *
 * Required Discord bot permissions:
 * - Send Messages - Send responses
 * - Read Message History - Access conversation context
 *
 * Required privileged Gateway Intents (enable in Developer Portal):
 * - Message Content Intent - Access message.content
 * - Server Members Intent - (optional, for member info)
 *
 * OAuth2 scopes required:
 * - bot - Bot user
 * - applications.commands - Slash commands (future)
 *
 * @module DiscordAdapter
 */

import discord from 'discord.js';

const { Client, GatewayIntentBits, Partials, ChannelType } = discord;

/**
 * Custom error for Discord adapter failures
 */
export class DiscordAdapterError extends Error {
  /**
   * Create a DiscordAdapterError
   * @param {string} message - Error message
   * @param {Object} [options] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - Operation that failed
   * @param {string} [options.reason] - Additional context
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'DiscordAdapterError';
    this.operation = options.operation;
    this.reason = options.reason;
  }
}

/**
 * Discord channel adapter using discord.js v14 with Gateway Intents
 *
 * Listens for @mention and DM events, normalizes them into
 * a standard message format, and provides message sending capabilities.
 *
 * @example
 * const adapter = new DiscordAdapter({
 *   botToken: 'your-discord-bot-token'
 * });
 * await adapter.initialize();
 * adapter.onMessage(async msg => console.log(msg));
 * await adapter.start();
 */
export class DiscordAdapter {
  /**
   * Create a DiscordAdapter instance
   * @param {Object} config - Discord configuration
   * @param {string} config.botToken - Discord bot token
   * @param {string[]} [config.guildIds] - Optional list of guild IDs to restrict to
   */
  constructor(config) {
    if (!config || typeof config !== 'object') {
      throw new DiscordAdapterError('Config is required', {
        operation: 'constructor',
        reason: 'Missing or invalid config object',
      });
    }

    if (!config.botToken) {
      throw new DiscordAdapterError('botToken is required', {
        operation: 'constructor',
        reason: 'Missing botToken in config',
      });
    }

    if (config.guildIds !== undefined && !Array.isArray(config.guildIds)) {
      throw new DiscordAdapterError('guildIds must be an array of strings', {
        operation: 'constructor',
        reason: 'Invalid guildIds in config',
      });
    }

    this.config = config;
    this.client = null;
    this.messageHandler = null;
    this.initialized = false;
    this.started = false;
  }

  /**
   * Initialize the Discord.js client with Gateway Intents
   *
   * Creates the Client instance with required intents and partials,
   * and registers event handlers for messageCreate and ready events.
   *
   * @returns {Promise<void>}
   * @throws {DiscordAdapterError} If initialization fails
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      this.client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.DirectMessages,
          GatewayIntentBits.MessageContent,
        ],
        partials: [Partials.Channel, Partials.Message],
      });

      this._setupEventHandlers();
      this.initialized = true;
    } catch (err) {
      throw new DiscordAdapterError('Failed to initialize Discord adapter', {
        cause: err,
        operation: 'initialize',
      });
    }
  }

  /**
   * Register internal event handlers for Discord events
   *
   * Sets up listeners for:
   * - ready: When the bot successfully connects
   * - messageCreate: When a message is received
   * - error: When a client error occurs
   * @private
   */
  _setupEventHandlers() {
    this.client.on('ready', () => {
      // Bot connected successfully
    });

    this.client.on('messageCreate', async discordMessage => {
      // Ignore bot messages (prevents loops)
      if (discordMessage.author.bot) return;

      // Determine if this is a DM
      const isDM = discordMessage.channel.type === ChannelType.DM;

      // Check if bot was mentioned (only relevant for guild messages)
      const mentioned = !isDM && this.client.user && discordMessage.mentions.has(this.client.user);

      // Only process @mentions in guilds or DMs
      if (!mentioned && !isDM) return;

      // Check guild restrictions
      if (!isDM && this.config.guildIds && this.config.guildIds.length > 0) {
        if (!discordMessage.guild || !this.config.guildIds.includes(discordMessage.guild.id)) {
          return;
        }
      }

      if (!this.messageHandler) return;

      const message = {
        type: 'discord',
        userId: discordMessage.author.id,
        channelId: discordMessage.channel.id,
        text: isDM ? discordMessage.content : this.cleanMention(discordMessage.content),
        isDM,
        guildId: discordMessage.guild?.id || null,
      };

      // Store reference for reply capabilities
      message._discordMessage = discordMessage;

      await this.messageHandler(message);
    });

    this.client.on('error', _error => {
      // Client errors are handled internally by discord.js
      // Consumers can monitor via external logging
    });
  }

  /**
   * Remove bot mention tags from message text
   *
   * Strips Discord mention format `<@123456>` or `<@!123456>` from
   * the text and trims any surrounding whitespace.
   *
   * @param {string} text - Raw message text containing mentions
   * @returns {string} Cleaned text without mention tags
   */
  cleanMention(text) {
    if (!text || typeof text !== 'string') return '';
    return text.replace(/<@!?\d+>/g, '').trim();
  }

  /**
   * Split a message into chunks that fit Discord's 2000 character limit
   *
   * Splits on newline boundaries first. If a single line exceeds the
   * max length, it splits on space boundaries. As a last resort,
   * it hard-splits at the character limit.
   *
   * @param {string} text - Message text to split
   * @param {number} [maxLength=2000] - Maximum chunk length
   * @returns {string[]} Array of message chunks
   */
  splitMessage(text, maxLength = 2000) {
    if (!text || typeof text !== 'string') return [''];
    if (text.length <= maxLength) return [text];
    if (maxLength < 1) return [text];

    const chunks = [];
    let current = '';

    for (const line of text.split('\n')) {
      // If a single line is longer than maxLength, split by spaces
      if (line.length > maxLength) {
        // Push any accumulated content first
        if (current) {
          chunks.push(current);
          current = '';
        }

        // Split the long line by spaces
        const words = line.split(' ');
        let wordBuffer = '';

        for (const word of words) {
          if (word.length > maxLength) {
            // Word itself is too long - hard split
            if (wordBuffer) {
              chunks.push(wordBuffer);
              wordBuffer = '';
            }
            for (let i = 0; i < word.length; i += maxLength) {
              const slice = word.slice(i, i + maxLength);
              if (i + maxLength < word.length) {
                chunks.push(slice);
              } else {
                wordBuffer = slice;
              }
            }
          } else if (wordBuffer.length + word.length + 1 > maxLength) {
            chunks.push(wordBuffer);
            wordBuffer = word;
          } else {
            wordBuffer += (wordBuffer ? ' ' : '') + word;
          }
        }

        if (wordBuffer) {
          current = wordBuffer;
        }
      } else if (current.length + line.length + 1 > maxLength) {
        chunks.push(current);
        current = line;
      } else {
        current += (current ? '\n' : '') + line;
      }
    }

    if (current) chunks.push(current);
    return chunks;
  }

  /**
   * Register a message handler callback
   *
   * The handler will be called with a standardized message object
   * for each incoming @mention or DM event.
   *
   * @param {Function} handler - Async function to handle incoming messages
   * @throws {DiscordAdapterError} If handler is not a function
   */
  onMessage(handler) {
    if (typeof handler !== 'function') {
      throw new DiscordAdapterError('Message handler must be a function', {
        operation: 'onMessage',
        reason: `Expected function, got ${typeof handler}`,
      });
    }

    this.messageHandler = handler;
  }

  /**
   * Start the Discord bot connection
   *
   * Logs into Discord using the bot token. The adapter must
   * be initialized before calling start().
   *
   * @returns {Promise<void>}
   * @throws {DiscordAdapterError} If not initialized or login fails
   */
  async start() {
    if (!this.initialized) {
      throw new DiscordAdapterError('DiscordAdapter not initialized. Call initialize() first', {
        operation: 'start',
      });
    }

    if (this.started) {
      return;
    }

    try {
      await this.client.login(this.config.botToken);
      this.started = true;
    } catch (err) {
      throw new DiscordAdapterError('Failed to start Discord adapter', {
        cause: err,
        operation: 'start',
      });
    }
  }

  /**
   * Stop the Discord bot connection
   *
   * Gracefully destroys the client connection. Safe to call even if
   * not started (will be a no-op).
   *
   * @returns {Promise<void>}
   * @throws {DiscordAdapterError} If stop fails
   */
  async stop() {
    if (!this.started || !this.client) {
      return;
    }

    try {
      this.client.destroy();
      this.started = false;
    } catch (err) {
      throw new DiscordAdapterError('Failed to stop Discord adapter', {
        cause: err,
        operation: 'stop',
      });
    }
  }

  /**
   * Send a message to a Discord channel
   *
   * Fetches the channel and sends the text. Messages exceeding
   * Discord's 2000 character limit are automatically split into
   * multiple messages.
   *
   * @param {string} channelId - Discord channel ID
   * @param {string} text - Message text to send
   * @returns {Promise<void>}
   * @throws {DiscordAdapterError} If not initialized or send fails
   */
  async sendMessage(channelId, text) {
    if (!this.initialized) {
      throw new DiscordAdapterError('DiscordAdapter not initialized. Call initialize() first', {
        operation: 'sendMessage',
      });
    }

    if (!channelId) {
      throw new DiscordAdapterError('channelId is required', {
        operation: 'sendMessage',
        reason: 'Missing channelId parameter',
      });
    }

    if (typeof text !== 'string') {
      throw new DiscordAdapterError('text is required and must be a string', {
        operation: 'sendMessage',
        reason: 'Missing or non-string text parameter',
      });
    }

    try {
      const channel = await this.client.channels.fetch(channelId);

      if (!channel) {
        throw new Error(`Channel ${channelId} not found`);
      }

      const chunks = this.splitMessage(text);
      for (const chunk of chunks) {
        await channel.send(chunk);
      }
    } catch (err) {
      if (err instanceof DiscordAdapterError) throw err;
      throw new DiscordAdapterError(`Failed to send message to channel ${channelId}`, {
        cause: err,
        operation: 'sendMessage',
        reason: err.message,
      });
    }
  }
}

export default DiscordAdapter;
