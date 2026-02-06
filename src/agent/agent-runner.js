/**
 * AgentRunner - Executes AI agent with multi-step tool calling
 *
 * Wraps Vercel AI SDK's generateText/streamText with the framework's
 * ModelFactory and ToolRegistry. Provides the core agent loop where
 * the LLM iteratively calls tools, receives results, and continues
 * until it reaches a final answer.
 *
 * @module agent/agent-runner
 */

import { generateText, streamText } from 'ai';

/**
 * Default maximum number of agent loop steps
 * @type {number}
 */
const DEFAULT_MAX_STEPS = 30;

/**
 * Default generation timeout in milliseconds (2 minutes)
 * @type {number}
 */
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Custom error class for agent runner errors
 */
export class AgentRunnerError extends Error {
  /**
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {string} [options.operation] - The operation that failed
   * @param {string} [options.botId] - Bot ID if applicable
   * @param {Error} [options.cause] - Original error that caused this
   */
  constructor(message, options = {}) {
    super(message);
    this.name = 'AgentRunnerError';
    this.operation = options.operation;
    this.botId = options.botId;
    this.cause = options.cause;
  }
}

/**
 * Executes AI agents with multi-step tool calling via Vercel AI SDK
 *
 * The AgentRunner orchestrates the interaction between an LLM and tools.
 * It uses ModelFactory to create model instances and ToolRegistry to
 * resolve available tools for each bot.
 *
 * @example
 * const runner = new AgentRunner(ModelFactory, toolRegistry);
 * const result = await runner.run(
 *   { id: 'support', provider: 'anthropic', model: 'claude-sonnet-4-5', tools: ['bash'] },
 *   [{ role: 'user', content: 'List files in /home/agent' }]
 * );
 * console.log(result.text);
 */
export class AgentRunner {
  /**
   * Create a new AgentRunner instance
   *
   * @param {Object} modelFactory - ModelFactory class with static createModel()
   * @param {Object} toolRegistry - ToolRegistry instance with getToolsForBot()
   * @throws {AgentRunnerError} When modelFactory or toolRegistry is not provided
   */
  constructor(modelFactory, toolRegistry) {
    if (!modelFactory) {
      throw new AgentRunnerError('ModelFactory is required', {
        operation: 'constructor',
      });
    }

    if (!toolRegistry) {
      throw new AgentRunnerError('ToolRegistry is required', {
        operation: 'constructor',
      });
    }

    /** @type {Object} ModelFactory class */
    this.modelFactory = modelFactory;

    /** @type {Object} ToolRegistry instance */
    this.toolRegistry = toolRegistry;
  }

  /**
   * Execute AI agent with multi-step tool calling
   *
   * Resolves the model and tools for the given bot config, then runs
   * the Vercel AI SDK generateText loop with maxSteps for multi-step
   * tool calling.
   *
   * @param {Object} botConfig - Bot configuration object
   * @param {string} botConfig.id - Bot identifier
   * @param {string} botConfig.provider - AI provider ('anthropic', 'openai', etc.)
   * @param {string} botConfig.model - Model name (e.g., 'claude-sonnet-4-5')
   * @param {string} [botConfig.apiKey] - API key for the provider
   * @param {string[]} [botConfig.tools=[]] - Built-in tool names to enable
   * @param {number} [botConfig.maxSteps=30] - Maximum agent loop iterations
   * @param {number} [botConfig.temperature] - Sampling temperature
   * @param {number} [botConfig.timeout] - Generation timeout in ms
   * @param {Array<Object>} messages - Conversation messages in AI SDK format
   * @returns {Promise<Object>} Result with text, toolCalls, usage, and steps
   * @throws {AgentRunnerError} When botConfig or messages are invalid, or generation fails
   *
   * @example
   * const result = await runner.run(botConfig, [
   *   { role: 'system', content: 'You are a helpful assistant.' },
   *   { role: 'user', content: 'Create a file called hello.txt' }
   * ]);
   * // result.text - Final text response
   * // result.toolCalls - Array of tool calls made
   * // result.usage - Token usage statistics
   */
  async run(botConfig, messages) {
    validateBotConfig(botConfig, 'run');
    validateMessages(messages, 'run');

    const { model, tools, generateOptions } = await this._resolveConfig(botConfig);

    try {
      const result = await withTimeout(
        generateText({
          model,
          messages,
          tools,
          maxSteps: generateOptions.maxSteps,
          ...(generateOptions.temperature !== undefined && {
            temperature: generateOptions.temperature,
          }),
        }),
        generateOptions.timeout,
        botConfig.id
      );

      return {
        text: result.text,
        toolCalls: result.toolCalls || [],
        usage: result.usage || {},
        steps: result.steps || [],
        finishReason: result.finishReason,
      };
    } catch (err) {
      if (err instanceof AgentRunnerError) {
        throw err;
      }
      throw new AgentRunnerError(`Agent run failed for bot "${botConfig.id}": ${err.message}`, {
        operation: 'run',
        botId: botConfig.id,
        cause: err,
      });
    }
  }

  /**
   * Stream AI agent response with multi-step tool calling
   *
   * Similar to run() but streams text chunks as they arrive via
   * the onChunk callback. Returns usage stats after completion.
   *
   * @param {Object} botConfig - Bot configuration (same as run())
   * @param {Array<Object>} messages - Conversation messages in AI SDK format
   * @param {Function} onChunk - Callback for each text chunk: (chunk: string) => void
   * @returns {Promise<Object>} Result with text, usage, and toolCalls
   * @throws {AgentRunnerError} When botConfig, messages, or onChunk are invalid
   *
   * @example
   * const result = await runner.stream(botConfig, messages, chunk => {
   *   process.stdout.write(chunk);
   * });
   */
  async stream(botConfig, messages, onChunk) {
    validateBotConfig(botConfig, 'stream');
    validateMessages(messages, 'stream');

    if (typeof onChunk !== 'function') {
      throw new AgentRunnerError('onChunk callback must be a function', {
        operation: 'stream',
        botId: botConfig.id,
      });
    }

    const { model, tools, generateOptions } = await this._resolveConfig(botConfig);
    const { controller, cleanup } = createStreamTimeout(generateOptions.timeout, botConfig.id);

    let callbackError = null;

    try {
      const result = streamText({
        model,
        messages,
        tools,
        maxSteps: generateOptions.maxSteps,
        ...(generateOptions.temperature !== undefined && {
          temperature: generateOptions.temperature,
        }),
        abortSignal: controller.signal,
      });

      let fullText = '';

      for await (const chunk of result.textStream) {
        fullText += chunk;
        try {
          onChunk(chunk);
        } catch (cbErr) {
          callbackError = cbErr;
          controller.abort(cbErr);
          throw cbErr;
        }
      }

      // Await final result for usage stats
      const finalResult = await result;

      return {
        text: fullText,
        toolCalls: finalResult.toolCalls || [],
        usage: finalResult.usage || {},
        finishReason: finalResult.finishReason,
      };
    } catch (err) {
      if (err instanceof AgentRunnerError) {
        throw err;
      }
      // Convert AbortError to a timeout-specific error (but not callback aborts)
      if (!callbackError && (err.name === 'AbortError' || controller.signal.aborted)) {
        throw new AgentRunnerError(
          `Stream timed out after ${generateOptions.timeout}ms for bot "${botConfig.id}"`,
          { operation: 'stream', botId: botConfig.id, cause: err }
        );
      }
      throw new AgentRunnerError(`Agent stream failed for bot "${botConfig.id}": ${err.message}`, {
        operation: 'stream',
        botId: botConfig.id,
        cause: err,
      });
    } finally {
      cleanup();
    }
  }

  /**
   * Resolve model, tools, and options from bot config
   *
   * @param {Object} botConfig - Bot configuration
   * @returns {Promise<Object>} Resolved model, tools, and options
   * @private
   */
  async _resolveConfig(botConfig) {
    let model;
    try {
      model = this.modelFactory.createModel(botConfig.provider, botConfig.model, botConfig.apiKey);
    } catch (err) {
      throw new AgentRunnerError(
        `Failed to create model for bot "${botConfig.id}": ${err.message}`,
        { operation: '_resolveConfig', botId: botConfig.id, cause: err }
      );
    }

    let tools;
    try {
      tools = await this.toolRegistry.getToolsForBot(botConfig);
    } catch (err) {
      throw new AgentRunnerError(
        `Failed to resolve tools for bot "${botConfig.id}": ${err.message}`,
        { operation: '_resolveConfig', botId: botConfig.id, cause: err }
      );
    }

    const generateOptions = {
      maxSteps: botConfig.maxSteps ?? DEFAULT_MAX_STEPS,
      temperature: botConfig.temperature,
      timeout: botConfig.timeout ?? DEFAULT_TIMEOUT_MS,
    };

    return { model, tools, generateOptions };
  }
}

/**
 * Validate bot configuration object
 *
 * @param {Object} botConfig - Bot configuration to validate
 * @param {string} operation - Operation name for error context
 * @throws {AgentRunnerError} When botConfig is invalid
 * @private
 */
function validateBotConfig(botConfig, operation) {
  if (!botConfig || typeof botConfig !== 'object') {
    throw new AgentRunnerError('Bot config must be an object', {
      operation,
    });
  }

  if (!botConfig.id || typeof botConfig.id !== 'string') {
    throw new AgentRunnerError('Bot config must have a string "id" property', {
      operation,
    });
  }

  if (!botConfig.provider || typeof botConfig.provider !== 'string') {
    throw new AgentRunnerError('Bot config must have a string "provider" property', {
      operation,
      botId: botConfig.id,
    });
  }

  if (!botConfig.model || typeof botConfig.model !== 'string') {
    throw new AgentRunnerError('Bot config must have a string "model" property', {
      operation,
      botId: botConfig.id,
    });
  }
}

/**
 * Validate messages array
 *
 * @param {Array} messages - Messages to validate
 * @param {string} operation - Operation name for error context
 * @throws {AgentRunnerError} When messages are invalid
 * @private
 */
function validateMessages(messages, operation) {
  if (!Array.isArray(messages)) {
    throw new AgentRunnerError('Messages must be an array', {
      operation,
    });
  }

  if (messages.length === 0) {
    throw new AgentRunnerError('Messages array must not be empty', {
      operation,
    });
  }
}

/**
 * Wrap a promise with a timeout
 *
 * @param {Promise} promise - Promise to wrap
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} botId - Bot ID for error context
 * @returns {Promise} The original promise or rejection on timeout
 * @private
 */
function withTimeout(promise, timeoutMs, botId) {
  if (!timeoutMs || timeoutMs <= 0) {
    return promise;
  }

  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      setTimeout(
        () =>
          reject(
            new AgentRunnerError(`Generation timed out after ${timeoutMs}ms for bot "${botId}"`, {
              operation: 'run',
              botId,
            })
          ),
        timeoutMs
      );
    }),
  ]);
}

/**
 * Create an AbortController with a timeout for streaming operations
 *
 * Returns a controller whose signal can be passed to streamText, and a
 * cleanup function to clear the timer when streaming completes.
 *
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} botId - Bot ID for error context
 * @returns {{ controller: AbortController, cleanup: Function }}
 * @private
 */
function createStreamTimeout(timeoutMs, botId) {
  const controller = new AbortController();

  if (!timeoutMs || timeoutMs <= 0) {
    return { controller, cleanup: () => {} };
  }

  const timer = setTimeout(() => {
    controller.abort(
      new AgentRunnerError(`Stream timed out after ${timeoutMs}ms for bot "${botId}"`, {
        operation: 'stream',
        botId,
      })
    );
  }, timeoutMs);

  const cleanup = () => clearTimeout(timer);

  return { controller, cleanup };
}
