/**
 * BotEventEmitter - Centralized event system for bot lifecycle and message events
 *
 * Extends Node.js EventEmitter to provide a typed event system for the bot framework.
 * Used by BotManager, MessageProcessor, and ToolRegistry to emit events that can be
 * consumed by webhooks, logging, analytics, and other integrations.
 *
 * @module core/event-emitter
 */

import { EventEmitter } from 'node:events';

/**
 * Frozen object defining all bot event types
 *
 * @type {Readonly<{
 *   BOT_STARTED: string,
 *   BOT_STOPPED: string,
 *   BOT_ERROR: string,
 *   MESSAGE_RECEIVED: string,
 *   MESSAGE_SENT: string,
 *   MESSAGE_ERROR: string,
 *   TOOL_CALLED: string,
 *   TOOL_ERROR: string
 * }>}
 */
const BOT_EVENTS = Object.freeze({
  BOT_STARTED: 'bot.started',
  BOT_STOPPED: 'bot.stopped',
  BOT_ERROR: 'bot.error',
  MESSAGE_RECEIVED: 'message.received',
  MESSAGE_SENT: 'message.sent',
  MESSAGE_ERROR: 'message.error',
  TOOL_CALLED: 'tool.called',
  TOOL_ERROR: 'tool.error',
});

/**
 * Set of all valid event names for validation
 * @type {Set<string>}
 */
const VALID_EVENTS = new Set(Object.values(BOT_EVENTS));

/**
 * BotEventEmitter - centralized event bus for the bot framework
 *
 * Provides structured event emission with consistent payload shapes.
 * All event payloads include `event`, `timestamp`, and `bot` fields.
 *
 * @example
 * const emitter = new BotEventEmitter();
 *
 * emitter.on(BOT_EVENTS.BOT_STARTED, (payload) => {
 *   console.log(`Bot ${payload.bot.id} started`);
 * });
 *
 * emitter.emitBotStarted('work-bot', { name: 'Work Assistant' });
 */
export class BotEventEmitter extends EventEmitter {
  /**
   * Create a BotEventEmitter instance
   *
   * @param {Object} [options={}] - Configuration options
   * @param {Function|null} [options.logger=null] - Logger function for event emission
   */
  constructor(options = {}) {
    super();

    /** @type {Function|null} Logger function */
    this.logger = options.logger || null;
  }

  // ==========================================================================
  // Bot Lifecycle Events
  // ==========================================================================

  /**
   * Emit a bot.started event
   *
   * @param {string} botId - Bot identifier
   * @param {Object} [details={}] - Additional bot details
   * @param {string} [details.name] - Bot display name
   */
  emitBotStarted(botId, details = {}) {
    const payload = this._buildPayload(BOT_EVENTS.BOT_STARTED, botId, {
      bot: { id: botId, name: details.name || botId },
    });
    this._emitEvent(BOT_EVENTS.BOT_STARTED, payload);
  }

  /**
   * Emit a bot.stopped event
   *
   * @param {string} botId - Bot identifier
   * @param {Object} [details={}] - Additional bot details
   * @param {string} [details.name] - Bot display name
   */
  emitBotStopped(botId, details = {}) {
    const payload = this._buildPayload(BOT_EVENTS.BOT_STOPPED, botId, {
      bot: { id: botId, name: details.name || botId },
    });
    this._emitEvent(BOT_EVENTS.BOT_STOPPED, payload);
  }

  /**
   * Emit a bot.error event
   *
   * @param {string} botId - Bot identifier
   * @param {Error|string} error - Error that occurred
   * @param {Object} [details={}] - Additional details
   * @param {string} [details.name] - Bot display name
   * @param {string} [details.operation] - Operation that failed
   */
  emitBotError(botId, error, details = {}) {
    const payload = this._buildPayload(BOT_EVENTS.BOT_ERROR, botId, {
      bot: { id: botId, name: details.name || botId },
      error: {
        message: error instanceof Error ? error.message : String(error),
        operation: details.operation || null,
      },
    });
    this._emitEvent(BOT_EVENTS.BOT_ERROR, payload);
  }

  // ==========================================================================
  // Message Events
  // ==========================================================================

  /**
   * Emit a message.received event
   *
   * @param {string} botId - Bot identifier
   * @param {Object} message - Message details
   * @param {string} message.userId - User identifier
   * @param {string} message.channelId - Channel identifier
   * @param {string} message.text - Message text
   * @param {string} [message.sessionId] - Session identifier
   */
  emitMessageReceived(botId, message) {
    const payload = this._buildPayload(BOT_EVENTS.MESSAGE_RECEIVED, botId, {
      bot: { id: botId },
      message: {
        userId: message.userId,
        channelId: message.channelId,
        text: message.text,
        sessionId: message.sessionId || null,
      },
    });
    this._emitEvent(BOT_EVENTS.MESSAGE_RECEIVED, payload);
  }

  /**
   * Emit a message.sent event
   *
   * @param {string} botId - Bot identifier
   * @param {Object} message - Message details
   * @param {string} message.userId - User identifier
   * @param {string} message.channelId - Channel identifier
   * @param {string} message.text - Response text
   * @param {string} [message.sessionId] - Session identifier
   * @param {number} [message.durationMs] - Processing duration in milliseconds
   * @param {Array} [message.toolCalls] - Tool calls made during processing
   */
  emitMessageSent(botId, message) {
    const payload = this._buildPayload(BOT_EVENTS.MESSAGE_SENT, botId, {
      bot: { id: botId },
      message: {
        userId: message.userId,
        channelId: message.channelId,
        text: message.text,
        sessionId: message.sessionId || null,
        durationMs: message.durationMs || null,
        toolCalls: message.toolCalls || [],
      },
    });
    this._emitEvent(BOT_EVENTS.MESSAGE_SENT, payload);
  }

  /**
   * Emit a message.error event
   *
   * @param {string} botId - Bot identifier
   * @param {Error|string} error - Error that occurred
   * @param {Object} [message={}] - Message context
   * @param {string} [message.userId] - User identifier
   * @param {string} [message.channelId] - Channel identifier
   * @param {string} [message.sessionId] - Session identifier
   */
  emitMessageError(botId, error, message = {}) {
    const payload = this._buildPayload(BOT_EVENTS.MESSAGE_ERROR, botId, {
      bot: { id: botId },
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
      message: {
        userId: message.userId || null,
        channelId: message.channelId || null,
        sessionId: message.sessionId || null,
      },
    });
    this._emitEvent(BOT_EVENTS.MESSAGE_ERROR, payload);
  }

  // ==========================================================================
  // Tool Events
  // ==========================================================================

  /**
   * Emit a tool.called event
   *
   * @param {string} botId - Bot identifier
   * @param {Object} toolCall - Tool call details
   * @param {string} toolCall.toolName - Name of the tool called
   * @param {Object} [toolCall.args] - Arguments passed to the tool
   * @param {*} [toolCall.result] - Tool execution result
   * @param {string} [toolCall.sessionId] - Session identifier
   */
  emitToolCalled(botId, toolCall) {
    const payload = this._buildPayload(BOT_EVENTS.TOOL_CALLED, botId, {
      bot: { id: botId },
      tool: {
        name: toolCall.toolName,
        args: toolCall.args || null,
        result: toolCall.result || null,
        sessionId: toolCall.sessionId || null,
      },
    });
    this._emitEvent(BOT_EVENTS.TOOL_CALLED, payload);
  }

  /**
   * Emit a tool.error event
   *
   * @param {string} botId - Bot identifier
   * @param {Object} toolCall - Tool call details
   * @param {string} toolCall.toolName - Name of the tool that failed
   * @param {Object} [toolCall.args] - Arguments passed to the tool
   * @param {Error|string} toolCall.error - Error that occurred
   * @param {string} [toolCall.sessionId] - Session identifier
   */
  emitToolError(botId, toolCall) {
    const errorMessage =
      toolCall.error instanceof Error ? toolCall.error.message : String(toolCall.error);
    const payload = this._buildPayload(BOT_EVENTS.TOOL_ERROR, botId, {
      bot: { id: botId },
      tool: {
        name: toolCall.toolName,
        args: toolCall.args || null,
        sessionId: toolCall.sessionId || null,
      },
      error: {
        message: errorMessage,
      },
    });
    this._emitEvent(BOT_EVENTS.TOOL_ERROR, payload);
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Check if an event name is a valid bot event
   *
   * @param {string} eventName - Event name to validate
   * @returns {boolean} True if the event name is valid
   */
  static isValidEvent(eventName) {
    return VALID_EVENTS.has(eventName);
  }

  /**
   * Get all valid event names
   *
   * @returns {string[]} Array of valid event names
   */
  static getEventNames() {
    return [...VALID_EVENTS];
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Build a standardized event payload
   *
   * @param {string} event - Event type name
   * @param {string} botId - Bot identifier
   * @param {Object} [data={}] - Additional payload data
   * @returns {Object} Standardized event payload
   * @private
   */
  _buildPayload(event, botId, data = {}) {
    return {
      event,
      timestamp: new Date().toISOString(),
      ...data,
    };
  }

  /**
   * Emit an event with logging
   *
   * @param {string} eventName - Event name
   * @param {Object} payload - Event payload
   * @private
   */
  _emitEvent(eventName, payload) {
    this._log(`Event emitted: ${eventName} for bot "${payload.bot?.id || 'unknown'}"`);
    this.emit(eventName, payload);
  }

  /**
   * Log a message using the configured logger
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

export { BOT_EVENTS };
export default BotEventEmitter;
