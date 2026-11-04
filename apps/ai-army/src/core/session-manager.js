/**
 * SessionManager - Session and conversation tracking
 *
 * Manages per-user conversation histories and session state.
 * Features:
 * - Session key generation (botId:channelType:channelId:userId format)
 * - Message appending with timestamp tracking
 * - Token counting for context window management
 * - Session compaction to summarize old messages when tokens exceed threshold
 *
 * @module SessionManager
 */

/**
 * Default token threshold for triggering session compaction.
 * When token count exceeds this, old messages are summarized.
 */
const DEFAULT_COMPACTION_THRESHOLD = 50000;

/**
 * Approximate characters per token (rough estimate for estimation).
 * Most models average ~4 characters per token.
 */
const CHARS_PER_TOKEN = 4;

/**
 * Number of recent messages to preserve during compaction.
 * These are kept verbatim while older messages are summarized.
 */
const MESSAGES_TO_PRESERVE = 10;

/**
 * Custom error for session-related failures
 */
export class SessionError extends Error {
  /**
   * Create a SessionError
   * @param {string} message - Error message
   * @param {Object} [options] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - The operation that failed
   * @param {string} [options.sessionId] - ID of the session involved
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'SessionError';
    this.operation = options.operation;
    this.sessionId = options.sessionId;
  }
}

/**
 * SessionManager - manages conversation sessions between users and bots
 */
export class SessionManager {
  /**
   * Create a SessionManager instance
   * @param {Object} storage - PostgresStorage instance for persistence
   * @param {Object} [options={}] - Configuration options
   * @param {number} [options.compactionThreshold] - Token threshold for compaction
   * @param {number} [options.messagesToPreserve] - Messages to keep during compaction
   */
  constructor(storage, options = {}) {
    this.storage = storage;
    this.compactionThreshold = options.compactionThreshold || DEFAULT_COMPACTION_THRESHOLD;
    this.messagesToPreserve = options.messagesToPreserve || MESSAGES_TO_PRESERVE;

    // In-memory cache for active sessions (optional optimization)
    this.sessionCache = new Map();
  }

  /**
   * Generate a session key from bot, channel, and user identifiers
   *
   * Format: botId:channelType:channelId:userId
   * Example: work:slack:C123ABC:U456DEF
   *
   * @param {string} botId - Bot identifier
   * @param {Object} channel - Channel information
   * @param {string} channel.type - Channel type ('slack' | 'discord' | 'rest')
   * @param {string} channel.id - Channel identifier
   * @param {string} userId - User identifier
   * @returns {string} Session key
   */
  getSessionKey(botId, channel, userId) {
    if (!botId || !channel?.type || !channel?.id || !userId) {
      throw new SessionError('Missing required parameters for session key', {
        operation: 'getSessionKey',
      });
    }
    return `${botId}:${channel.type}:${channel.id}:${userId}`;
  }

  /**
   * Get or create a session for a user-bot conversation
   *
   * If the session exists in storage, it is retrieved.
   * If not, a new session is created and saved.
   *
   * @param {string} botId - Bot identifier
   * @param {Object} channel - Channel information
   * @param {string} channel.type - Channel type
   * @param {string} channel.id - Channel identifier
   * @param {string} userId - User identifier
   * @returns {Promise<Object>} Session object with messages array
   */
  async getSession(botId, channel, userId) {
    const key = this.getSessionKey(botId, channel, userId);

    try {
      // Try to get existing session from storage
      let session = await this.storage.getSession(key);

      if (session) {
        // Update cache and return
        this.sessionCache.set(key, session);
        return session;
      }

      // Create new session
      session = {
        id: key,
        botId,
        userId,
        channelId: channel.id,
        channelType: channel.type,
        messages: [],
        tokenCount: 0,
        compactionCount: 0,
        createdAt: new Date(),
        lastMessageAt: new Date(),
      };

      // Save to storage
      await this.storage.saveSession(session);

      // Update cache
      this.sessionCache.set(key, session);

      return session;
    } catch (err) {
      throw new SessionError(`Failed to get session: ${err.message}`, {
        cause: err,
        operation: 'getSession',
        sessionId: key,
      });
    }
  }

  /**
   * Append a message to a session's conversation history
   *
   * Adds the message with a timestamp and updates token count.
   * If token count exceeds threshold, triggers compaction.
   *
   * @param {Object} session - Session object (will be modified in place)
   * @param {string} role - Message role ('user' | 'assistant' | 'system')
   * @param {string} content - Message content
   * @param {Object} [options={}] - Additional options
   * @param {Object} [options.toolCalls] - Tool calls associated with the message
   * @param {Object} [options.toolResults] - Tool results associated with the message
   * @returns {Promise<void>}
   */
  async appendMessage(session, role, content, options = {}) {
    if (!session?.id) {
      throw new SessionError('Invalid session object', {
        operation: 'appendMessage',
      });
    }

    if (!role || typeof content !== 'string') {
      throw new SessionError('Missing required message fields (role, content)', {
        operation: 'appendMessage',
        sessionId: session.id,
      });
    }

    try {
      // Create message object
      const message = {
        role,
        content,
        timestamp: new Date().toISOString(),
      };

      // Add optional fields if present
      if (options.toolCalls) {
        message.toolCalls = options.toolCalls;
      }
      if (options.toolResults) {
        message.toolResults = options.toolResults;
      }

      // Estimate tokens for this message
      const messageTokens = this.estimateTokens(content);

      // Update session in memory
      session.messages.push(message);
      session.tokenCount = (session.tokenCount || 0) + messageTokens;
      session.lastMessageAt = new Date();

      // Persist to storage
      await this.storage.appendMessage(session.id, message);
      await this.storage.updateSessionTokenCount(session.id, session.tokenCount);

      // Update cache
      this.sessionCache.set(session.id, session);

      // Check if compaction is needed
      if (session.tokenCount > this.compactionThreshold) {
        await this.compact(session);
      }
    } catch (err) {
      throw new SessionError(`Failed to append message: ${err.message}`, {
        cause: err,
        operation: 'appendMessage',
        sessionId: session.id,
      });
    }
  }

  /**
   * Compact a session by summarizing old messages
   *
   * Preserves recent messages verbatim while replacing older messages
   * with a summary message. This keeps the context window manageable
   * while retaining conversation context.
   *
   * @param {Object} session - Session object (will be modified in place)
   * @param {Object} [options={}] - Compaction options
   * @param {Function} [options.summarizer] - Custom summarization function
   * @returns {Promise<void>}
   */
  async compact(session, options = {}) {
    if (!session?.id) {
      throw new SessionError('Invalid session object', {
        operation: 'compact',
      });
    }

    try {
      const messages = session.messages || [];

      // Nothing to compact if we have fewer messages than preservation limit
      if (messages.length <= this.messagesToPreserve) {
        return;
      }

      // Split messages: old ones to summarize, recent ones to keep
      const messagesToSummarize = messages.slice(0, -this.messagesToPreserve);
      const recentMessages = messages.slice(-this.messagesToPreserve);

      // Generate summary
      const summary = options.summarizer
        ? await options.summarizer(messagesToSummarize)
        : this._defaultSummarize(messagesToSummarize);

      // Create compacted message array
      const summaryMessage = {
        role: 'system',
        content: `[Conversation Summary]\n${summary}`,
        timestamp: new Date().toISOString(),
        isCompactionSummary: true,
      };

      const compactedMessages = [summaryMessage, ...recentMessages];

      // Calculate new token count
      const newTokenCount = this.estimateTokensForMessages(compactedMessages);

      // Update session in memory
      session.messages = compactedMessages;
      session.tokenCount = newTokenCount;
      session.compactionCount = (session.compactionCount || 0) + 1;

      // Persist entire compacted session to storage
      await this.storage.saveSession({
        id: session.id,
        botId: session.botId,
        userId: session.userId,
        channelId: session.channelId,
        channelType: session.channelType,
        messages: compactedMessages,
        tokenCount: newTokenCount,
        compactionCount: session.compactionCount,
      });

      // Update cache
      this.sessionCache.set(session.id, session);
    } catch (err) {
      throw new SessionError(`Failed to compact session: ${err.message}`, {
        cause: err,
        operation: 'compact',
        sessionId: session.id,
      });
    }
  }

  /**
   * Estimate token count for a string of text
   *
   * Uses a rough approximation of ~4 characters per token.
   * For production use, consider using a proper tokenizer.
   *
   * @param {string} text - Text to estimate tokens for
   * @returns {number} Estimated token count
   */
  estimateTokens(text) {
    if (!text || typeof text !== 'string') {
      return 0;
    }

    // Rough estimation: ~4 characters per token
    // Add 10% buffer for special tokens
    const charCount = text.length;
    return Math.ceil((charCount / CHARS_PER_TOKEN) * 1.1);
  }

  /**
   * Estimate total tokens for an array of messages
   *
   * @param {Array<Object>} messages - Array of message objects
   * @returns {number} Total estimated token count
   */
  estimateTokensForMessages(messages) {
    if (!Array.isArray(messages)) {
      return 0;
    }

    return messages.reduce((total, msg) => {
      let tokens = this.estimateTokens(msg.content || '');

      // Add tokens for role (roughly 1 token per role)
      tokens += 1;

      // Add tokens for tool calls/results if present
      if (msg.toolCalls) {
        tokens += this.estimateTokens(JSON.stringify(msg.toolCalls));
      }
      if (msg.toolResults) {
        tokens += this.estimateTokens(JSON.stringify(msg.toolResults));
      }

      return total + tokens;
    }, 0);
  }

  /**
   * Get all messages for a session formatted for LLM input
   *
   * Returns messages in the format expected by AI SDK:
   * [{ role: 'user', content: '...' }, { role: 'assistant', content: '...' }]
   *
   * @param {Object} session - Session object
   * @returns {Array<Object>} Array of messages formatted for LLM
   */
  getMessagesForLLM(session) {
    if (!session?.messages) {
      return [];
    }

    return session.messages.map(msg => {
      const formatted = {
        role: msg.role,
        content: msg.content,
      };

      // Include tool calls if present
      if (msg.toolCalls) {
        formatted.toolCalls = msg.toolCalls;
      }

      return formatted;
    });
  }

  /**
   * Clear all messages from a session
   *
   * @param {Object} session - Session object
   * @returns {Promise<void>}
   */
  async clearSession(session) {
    if (!session?.id) {
      throw new SessionError('Invalid session object', {
        operation: 'clearSession',
      });
    }

    try {
      session.messages = [];
      session.tokenCount = 0;
      session.lastMessageAt = new Date();

      await this.storage.saveSession({
        id: session.id,
        botId: session.botId,
        userId: session.userId,
        channelId: session.channelId,
        channelType: session.channelType,
        messages: [],
        tokenCount: 0,
        compactionCount: session.compactionCount,
      });

      this.sessionCache.set(session.id, session);
    } catch (err) {
      throw new SessionError(`Failed to clear session: ${err.message}`, {
        cause: err,
        operation: 'clearSession',
        sessionId: session.id,
      });
    }
  }

  /**
   * Delete a session entirely
   *
   * @param {string} sessionId - Session ID to delete
   * @returns {Promise<boolean>} True if session was deleted
   */
  async deleteSession(sessionId) {
    try {
      const deleted = await this.storage.deleteSession(sessionId);
      this.sessionCache.delete(sessionId);
      return deleted;
    } catch (err) {
      throw new SessionError(`Failed to delete session: ${err.message}`, {
        cause: err,
        operation: 'deleteSession',
        sessionId,
      });
    }
  }

  /**
   * Get session statistics
   *
   * @param {Object} session - Session object
   * @returns {Object} Session statistics
   */
  getSessionStats(session) {
    if (!session) {
      return null;
    }

    const messages = session.messages || [];

    return {
      messageCount: messages.length,
      tokenCount: session.tokenCount || this.estimateTokensForMessages(messages),
      compactionCount: session.compactionCount || 0,
      userMessageCount: messages.filter(m => m.role === 'user').length,
      assistantMessageCount: messages.filter(m => m.role === 'assistant').length,
      systemMessageCount: messages.filter(m => m.role === 'system').length,
      hasToolCalls: messages.some(m => m.toolCalls),
      createdAt: session.createdAt,
      lastMessageAt: session.lastMessageAt,
    };
  }

  /**
   * Default summarization function for compaction
   * Creates a simple summary of the conversation
   *
   * @param {Array<Object>} messages - Messages to summarize
   * @returns {string} Summary text
   * @private
   */
  _defaultSummarize(messages) {
    if (!messages || messages.length === 0) {
      return 'No previous conversation history.';
    }

    const userMessages = messages.filter(m => m.role === 'user');
    const assistantMessages = messages.filter(m => m.role === 'assistant');

    const topics = new Set();
    const summaryParts = [];

    // Extract key topics from user messages (simple extraction)
    for (const msg of userMessages) {
      const content = msg.content || '';
      // Extract quoted text or significant phrases
      const words = content.split(/\s+/).filter(w => w.length > 4);
      words.slice(0, 5).forEach(w => topics.add(w.toLowerCase()));
    }

    summaryParts.push(
      `Previous conversation had ${messages.length} messages ` +
        `(${userMessages.length} from user, ${assistantMessages.length} from assistant).`
    );

    if (topics.size > 0) {
      summaryParts.push(`Topics discussed: ${Array.from(topics).slice(0, 10).join(', ')}.`);
    }

    // Include last user message as context
    if (userMessages.length > 0) {
      const lastUserMsg = userMessages[userMessages.length - 1];
      const truncated =
        lastUserMsg.content.length > 200
          ? `${lastUserMsg.content.slice(0, 200)}...`
          : lastUserMsg.content;
      summaryParts.push(`Last user request before summary: "${truncated}"`);
    }

    return summaryParts.join('\n');
  }

  /**
   * Check if a session needs compaction
   *
   * @param {Object} session - Session object
   * @returns {boolean} True if session should be compacted
   */
  needsCompaction(session) {
    return (session?.tokenCount || 0) > this.compactionThreshold;
  }

  /**
   * Get the current compaction threshold
   *
   * @returns {number} Current threshold in tokens
   */
  getCompactionThreshold() {
    return this.compactionThreshold;
  }

  /**
   * Set the compaction threshold
   *
   * @param {number} threshold - New threshold in tokens
   */
  setCompactionThreshold(threshold) {
    if (typeof threshold !== 'number' || threshold <= 0) {
      throw new SessionError('Compaction threshold must be a positive number', {
        operation: 'setCompactionThreshold',
      });
    }
    this.compactionThreshold = threshold;
  }

  /**
   * Clear the in-memory session cache
   */
  clearCache() {
    this.sessionCache.clear();
  }
}

export default SessionManager;
