/**
 * MessageProcessor - Central message processing pipeline
 *
 * Orchestrates the full message processing flow:
 * 1. Get/create session via SessionManager
 * 2. Append user message to session
 * 3. Format messages for LLM
 * 4. Prepend soul.md system prompt
 * 5. Execute via AgentRunner
 * 6. Log tool calls for audit trail
 * 7. Append assistant response to session
 * 8. Return response text
 *
 * This is the central coordination point between user messages
 * and AI responses, connecting SessionManager, AgentRunner, and storage.
 *
 * @module core/message-processor
 */

/**
 * Custom error for message processing failures
 */
export class MessageProcessorError extends Error {
  /**
   * Create a MessageProcessorError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - The operation that failed
   * @param {string} [options.botId] - Bot ID involved
   * @param {string} [options.sessionId] - Session ID involved
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'MessageProcessorError';
    this.operation = options.operation;
    this.botId = options.botId;
    this.sessionId = options.sessionId;
  }
}

/**
 * MessageProcessor - processes incoming messages through the AI pipeline
 *
 * @example
 * const processor = new MessageProcessor(sessionManager, agentRunner, storage);
 * const result = await processor.processMessage(botConfig, {
 *   type: 'slack',
 *   userId: 'U123',
 *   channelId: 'C456',
 *   text: 'Hello!',
 * });
 * console.log(result.text); // AI response
 */
export class MessageProcessor {
  /**
   * Create a MessageProcessor instance
   *
   * @param {Object} sessionManager - SessionManager instance for conversation tracking
   * @param {Object} agentRunner - AgentRunner instance for LLM execution
   * @param {Object} storage - PostgresStorage instance for tool call logging
   * @param {Object} [options={}] - Configuration options
   * @param {Function|null} [options.logger=null] - Logger function for processing events
   * @param {Object} [options.eventEmitter=null] - BotEventEmitter instance for emitting message events
   * @param {Object} [options.auditLogger=null] - AuditLogger instance for recording audit events
   */
  constructor(sessionManager, agentRunner, storage, options = {}) {
    if (!sessionManager) {
      throw new MessageProcessorError('SessionManager is required', {
        operation: 'constructor',
      });
    }
    if (!agentRunner) {
      throw new MessageProcessorError('AgentRunner is required', {
        operation: 'constructor',
      });
    }
    if (!storage) {
      throw new MessageProcessorError('Storage is required', {
        operation: 'constructor',
      });
    }

    /** @type {Object} SessionManager instance */
    this.sessionManager = sessionManager;

    /** @type {Object} AgentRunner instance */
    this.agentRunner = agentRunner;

    /** @type {Object} PostgresStorage instance */
    this.storage = storage;

    /** @type {Function|null} Logger function */
    this.logger = options.logger || null;

    /** @type {Object|null} BotEventEmitter for emitting message events */
    this.eventEmitter = options.eventEmitter || null;

    /** @type {Object|null} AuditLogger for recording audit events */
    this.auditLogger = options.auditLogger || null;
  }

  /**
   * Process an incoming message through the full AI pipeline
   *
   * Flow:
   * 1. Get or create session for user-bot conversation
   * 2. Append user message to session
   * 3. Get formatted messages for LLM (with soul.md system prompt)
   * 4. Call AgentRunner to get AI response
   * 5. Log any tool calls for audit trail
   * 6. Append assistant response to session
   * 7. Return result
   *
   * @param {Object} botConfig - Bot configuration object
   * @param {string} botConfig.id - Bot identifier
   * @param {string} botConfig.provider - AI provider name
   * @param {string} botConfig.model - Model name
   * @param {string} [botConfig.soulContent] - Soul.md system prompt content
   * @param {string} [botConfig.channel] - Channel name
   * @param {Object} message - Incoming message
   * @param {string} message.type - Channel type ('slack' | 'discord' | 'rest')
   * @param {string} message.userId - User identifier
   * @param {string} message.channelId - Channel/conversation identifier
   * @param {string} message.text - Message text content
   * @returns {Promise<Object>} Processing result
   * @returns {string} result.text - AI response text
   * @returns {Array} result.toolCalls - Tool calls made during processing
   * @returns {Object} result.usage - Token usage statistics
   * @returns {string} result.sessionId - Session ID used
   * @throws {MessageProcessorError} If processing fails
   */
  async processMessage(botConfig, message) {
    this._validateBotConfig(botConfig);
    this._validateMessage(message);

    const channel = { type: message.type, id: message.channelId };
    let session;
    let sessionId;

    try {
      // Step 1: Get or create session
      session = await this.sessionManager.getSession(botConfig.id, channel, message.userId);
      sessionId = session.id;

      this._log(`Processing message for bot "${botConfig.id}" ` + `session "${sessionId}"`);

      // Emit message.received event
      this._emitEvent('messageReceived', botConfig.id, {
        userId: message.userId,
        channelId: message.channelId,
        text: message.text,
        sessionId,
      });

      this._auditLog({
        type: 'message.received',
        actor: message.userId,
        actorType: 'user',
        resourceType: 'message',
        resourceId: sessionId,
        action: 'received',
        metadata: {
          botId: botConfig.id,
          channelId: message.channelId,
          channelType: message.type,
        },
      });

      // Step 2: Append user message to session
      await this.sessionManager.appendMessage(session, 'user', message.text);

      // Step 3: Get messages formatted for LLM
      const llmMessages = this.sessionManager.getMessagesForLLM(session);

      // Step 4: Prepend soul.md system prompt if available
      const messagesWithSoul = this._prependSoulPrompt(llmMessages, botConfig.soulContent);

      // Step 5: Call AgentRunner
      const startTime = Date.now();
      const result = await this.agentRunner.run(botConfig, messagesWithSoul);
      const durationMs = Date.now() - startTime;

      this._log(
        `Agent completed for bot "${botConfig.id}" ` +
          `in ${durationMs}ms (${result.toolCalls.length} tool calls)`
      );

      // Step 6: Log tool calls for audit trail
      await this._logToolCalls(botConfig.id, sessionId, result.steps || [], result.toolCalls);

      // Emit tool events for each tool call
      this._emitToolEvents(botConfig.id, sessionId, result.steps || [], result.toolCalls);

      // Step 6.5: If text is empty but tools were used, construct response from tool results
      let finalText = result.text;
      if (!finalText && result.steps?.length > 0) {
        const toolOutputs = [];
        for (const step of result.steps) {
          // Vercel AI SDK stores results in step.toolResults (array of {toolCallId, toolName, result})
          const stepToolResults = step.toolResults || [];
          for (const tr of stepToolResults) {
            const output = tr.result;
            if (output?.stdout) {
              toolOutputs.push(output.stdout);
            } else if (output?.content) {
              toolOutputs.push(output.content);
            } else if (typeof output === 'string') {
              toolOutputs.push(output);
            } else if (output != null) {
              toolOutputs.push(JSON.stringify(output));
            }
          }
        }
        if (toolOutputs.length > 0) {
          finalText = toolOutputs.join('\n\n');
        } else {
          // Last resort: summarize what tools were called
          const toolNames = result.steps
            .flatMap(s => (s.toolCalls || []).map(tc => tc.toolName))
            .filter(Boolean);
          if (toolNames.length > 0) {
            finalText = `I executed ${toolNames.join(', ')} but received no output.`;
          }
        }
      }

      // Step 7: Append assistant response to session
      const appendOptions = {};
      if (result.toolCalls.length > 0) {
        appendOptions.toolCalls = result.toolCalls;
      }
      await this.sessionManager.appendMessage(session, 'assistant', finalText, appendOptions);

      // Emit message.sent event
      this._emitEvent('messageSent', botConfig.id, {
        userId: message.userId,
        channelId: message.channelId,
        text: result.text,
        sessionId,
        durationMs,
        toolCalls: result.toolCalls,
      });

      this._auditLog({
        type: 'message.sent',
        actor: botConfig.id,
        actorType: 'bot',
        resourceType: 'message',
        resourceId: sessionId,
        action: 'sent',
        metadata: {
          botId: botConfig.id,
          userId: message.userId,
          channelId: message.channelId,
          durationMs,
          toolCallCount: result.toolCalls.length,
        },
      });

      return {
        text: finalText,
        toolCalls: result.toolCalls,
        usage: result.usage,
        sessionId,
        durationMs,
      };
    } catch (err) {
      // Emit message.error event
      this._emitEvent('messageError', botConfig.id, err, {
        userId: message.userId,
        channelId: message.channelId,
        sessionId,
      });

      this._auditLog({
        type: 'message.failed',
        actor: message.userId,
        actorType: 'user',
        resourceType: 'message',
        resourceId: sessionId || null,
        action: 'failed',
        metadata: {
          botId: botConfig.id,
          channelId: message.channelId,
          error: err.message,
        },
      });

      if (err instanceof MessageProcessorError) {
        throw err;
      }
      throw new MessageProcessorError(
        `Failed to process message for bot "${botConfig.id}": ${err.message}`,
        {
          cause: err,
          operation: 'processMessage',
          botId: botConfig.id,
          sessionId,
        }
      );
    }
  }

  /**
   * Log tool calls from agent execution to the audit trail
   *
   * Iterates through all steps and their tool calls, logging each one
   * to PostgreSQL via the storage adapter.
   *
   * @param {string} botId - Bot identifier
   * @param {string} sessionId - Session identifier
   * @param {Array} steps - Agent execution steps from AI SDK
   * @param {Array} topLevelToolCalls - Top-level tool calls from result
   * @returns {Promise<number[]>} Array of inserted tool call IDs
   */
  async logToolCalls(botId, sessionId, steps, topLevelToolCalls) {
    return this._logToolCalls(botId, sessionId, steps, topLevelToolCalls);
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Log tool calls from agent steps to the database
   *
   * Extracts tool calls from AI SDK steps (which contain per-step tool results)
   * and also handles top-level tool calls for simpler result formats.
   *
   * @param {string} botId - Bot identifier
   * @param {string} sessionId - Session identifier
   * @param {Array} steps - Agent execution steps
   * @param {Array} topLevelToolCalls - Top-level tool calls
   * @returns {Promise<number[]>} Inserted tool call IDs
   * @private
   */
  async _logToolCalls(botId, sessionId, steps, topLevelToolCalls) {
    const loggedIds = [];

    // Log tool calls from steps (AI SDK provides per-step results)
    if (Array.isArray(steps)) {
      for (const step of steps) {
        // Extract tool calls and results from Vercel AI SDK step properties
        const stepToolCalls = step.toolCalls || [];
        const stepToolResults = step.toolResults || [];

        for (const toolCall of stepToolCalls) {
          const matchingResult = stepToolResults.find(r => r.toolCallId === toolCall.toolCallId);

          try {
            const id = await this.storage.logToolCall({
              botId,
              sessionId,
              toolName: toolCall.toolName,
              parameters: toolCall.args || null,
              result: matchingResult?.result || null,
              success: matchingResult ? !matchingResult.isError : true,
              error: matchingResult?.isError
                ? String(matchingResult.result || 'Unknown error')
                : null,
              durationMs: null,
            });
            loggedIds.push(id);
          } catch (err) {
            this._log(
              `Warning: Failed to log tool call "${toolCall.toolName}": ` + `${err.message}`
            );
          }
        }
      }
    }

    // Log top-level tool calls that weren't already logged via steps
    if (Array.isArray(topLevelToolCalls) && loggedIds.length === 0) {
      for (const toolCall of topLevelToolCalls) {
        try {
          const id = await this.storage.logToolCall({
            botId,
            sessionId,
            toolName: toolCall.toolName,
            parameters: toolCall.args || null,
            result: null,
            success: true,
            error: null,
            durationMs: null,
          });
          loggedIds.push(id);
        } catch (err) {
          this._log(`Warning: Failed to log tool call "${toolCall.toolName}": ` + `${err.message}`);
        }
      }
    }

    return loggedIds;
  }

  /**
   * Prepend soul.md system prompt to the messages array
   *
   * If the bot has soul content, inserts it as the first system message.
   * If messages already start with a system message, the soul prompt
   * is prepended before it.
   *
   * @param {Array<Object>} messages - LLM-formatted messages
   * @param {string} [soulContent] - Soul.md content to prepend
   * @returns {Array<Object>} Messages with soul prompt prepended
   * @private
   */
  _prependSoulPrompt(messages, soulContent) {
    if (!soulContent) {
      return messages;
    }

    const soulMessage = {
      role: 'system',
      content: soulContent,
    };

    return [soulMessage, ...messages];
  }

  /**
   * Validate bot configuration for message processing
   *
   * @param {Object} botConfig - Bot configuration to validate
   * @throws {MessageProcessorError} If botConfig is invalid
   * @private
   */
  _validateBotConfig(botConfig) {
    if (!botConfig || typeof botConfig !== 'object') {
      throw new MessageProcessorError('Bot config must be a non-null object', {
        operation: 'processMessage',
      });
    }

    if (!botConfig.id || typeof botConfig.id !== 'string') {
      throw new MessageProcessorError('Bot config must have a string "id" property', {
        operation: 'processMessage',
      });
    }

    if (!botConfig.provider || typeof botConfig.provider !== 'string') {
      throw new MessageProcessorError('Bot config must have a string "provider" property', {
        operation: 'processMessage',
        botId: botConfig.id,
      });
    }

    if (!botConfig.model || typeof botConfig.model !== 'string') {
      throw new MessageProcessorError('Bot config must have a string "model" property', {
        operation: 'processMessage',
        botId: botConfig.id,
      });
    }
  }

  /**
   * Validate incoming message object
   *
   * @param {Object} message - Message to validate
   * @throws {MessageProcessorError} If message is invalid
   * @private
   */
  _validateMessage(message) {
    if (!message || typeof message !== 'object') {
      throw new MessageProcessorError('Message must be a non-null object', {
        operation: 'processMessage',
      });
    }

    if (!message.type || typeof message.type !== 'string') {
      throw new MessageProcessorError('Message must have a string "type" property', {
        operation: 'processMessage',
      });
    }

    if (!message.userId || typeof message.userId !== 'string') {
      throw new MessageProcessorError('Message must have a string "userId" property', {
        operation: 'processMessage',
      });
    }

    if (!message.channelId || typeof message.channelId !== 'string') {
      throw new MessageProcessorError('Message must have a string "channelId" property', {
        operation: 'processMessage',
      });
    }

    if (typeof message.text !== 'string') {
      throw new MessageProcessorError('Message must have a string "text" property', {
        operation: 'processMessage',
      });
    }
  }

  /**
   * Emit tool events for each tool call in the processing result
   *
   * Iterates through steps and emits tool.called or tool.error events
   * for each tool invocation.
   *
   * @param {string} botId - Bot identifier
   * @param {string} sessionId - Session identifier
   * @param {Array} steps - Agent execution steps
   * @param {Array} topLevelToolCalls - Top-level tool calls
   * @private
   */
  _emitToolEvents(botId, sessionId, steps, topLevelToolCalls) {
    if (!this.eventEmitter) return;

    // Emit events from steps (AI SDK provides per-step results)
    if (Array.isArray(steps)) {
      for (const step of steps) {
        const stepToolCalls = step.toolCalls || [];
        const stepToolResults = step.toolResults || [];

        for (const toolCall of stepToolCalls) {
          const matchingResult = stepToolResults.find(r => r.toolCallId === toolCall.toolCallId);
          const isError = matchingResult?.isError === true;

          if (isError) {
            this._emitEvent('toolError', botId, {
              toolName: toolCall.toolName,
              args: toolCall.args || null,
              error: matchingResult?.result || 'Unknown tool error',
              sessionId,
            });
          } else {
            this._emitEvent('toolCalled', botId, {
              toolName: toolCall.toolName,
              args: toolCall.args || null,
              result: matchingResult?.result || null,
              sessionId,
            });
          }
        }
      }
    }

    // Emit events from top-level tool calls if no steps were processed
    if (Array.isArray(topLevelToolCalls) && (!Array.isArray(steps) || steps.length === 0)) {
      for (const toolCall of topLevelToolCalls) {
        this._emitEvent('toolCalled', botId, {
          toolName: toolCall.toolName,
          args: toolCall.args || null,
          sessionId,
        });
      }
    }
  }

  /**
   * Emit an event via the event emitter if available
   *
   * Safely calls the event emitter method, catching any errors to prevent
   * event emission from breaking the main flow.
   *
   * @param {string} method - Event emitter method name
   * @param {...*} args - Arguments to pass to the emitter method
   * @private
   */
  _emitEvent(event, ...args) {
    const method = `emit${event.charAt(0).toUpperCase()}${event.slice(1)}`;
    if (this.eventEmitter && typeof this.eventEmitter[method] === 'function') {
      try {
        this.eventEmitter[method](...args);
      } catch (_err) {
        // Event emission should never break the main flow
      }
    }
  }

  /**
   * Log an audit event if an audit logger is available
   *
   * Safely calls the audit logger, catching any errors to prevent
   * audit logging from breaking the main flow.
   *
   * @param {Object} event - Audit event to log
   * @private
   */
  _auditLog(event) {
    if (this.auditLogger && typeof this.auditLogger.log === 'function') {
      this.auditLogger.log(event).catch(_err => {
        // Audit logging should never break the main flow
      });
    }
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

export default MessageProcessor;
