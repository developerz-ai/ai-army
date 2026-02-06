/**
 * ToolRegistry - Registry for built-in and MCP tools
 *
 * Manages tool registration and per-bot tool resolution. Built-in tools are
 * registered as factory functions that create Vercel AI SDK tool objects.
 * MCP tools are fetched dynamically from the McpManager.
 *
 * Each bot config declares which tools it needs via `tools` (builtin) and
 * `mcpServers` (MCP). The registry resolves these into a tools object
 * suitable for passing to `generateText()` / `streamText()`.
 *
 * @module tools/tool-registry
 */

/**
 * Known built-in tool names
 * @type {string[]}
 */
const BUILTIN_TOOL_NAMES = [
  'bash',
  'readFile',
  'writeFile',
  'glob',
  'grep',
  'webSearch',
  'webFetch',
];

/**
 * Custom error class for tool registry errors
 */
export class ToolRegistryError extends Error {
  /**
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {string} [options.operation] - The operation that failed
   * @param {string} [options.toolName] - Tool name involved
   * @param {string} [options.botId] - Bot ID if applicable
   * @param {Error} [options.cause] - Original error that caused this
   */
  constructor(message, options = {}) {
    super(message);
    this.name = 'ToolRegistryError';
    this.operation = options.operation;
    this.toolName = options.toolName;
    this.botId = options.botId;
    this.cause = options.cause;
  }
}

/**
 * Registry for built-in and MCP tools
 *
 * Built-in tools are registered as factory functions with the signature:
 * `(containerPool, botId, toolConfig) => VercelAITool`
 *
 * @example
 * const registry = new ToolRegistry(containerPool, mcpManager);
 *
 * // Register a custom tool factory
 * registry.registerTool('myTool', (containerPool, botId, config) => ({
 *   description: 'My custom tool',
 *   parameters: z.object({ input: z.string() }),
 *   execute: async ({ input }) => ({ result: input })
 * }));
 *
 * // Get tools for a bot
 * const tools = await registry.getToolsForBot({
 *   id: 'support',
 *   tools: ['bash', 'readFile', 'myTool'],
 *   mcpServers: ['github']
 * });
 */
export class ToolRegistry {
  /**
   * Create a new ToolRegistry instance
   *
   * @param {Object} containerPool - ContainerPool instance for Docker container access
   * @param {Object} [mcpManager=null] - McpManager instance for MCP server tools
   * @throws {ToolRegistryError} When containerPool is not provided
   */
  constructor(containerPool, mcpManager = null) {
    if (!containerPool) {
      throw new ToolRegistryError('ContainerPool is required', {
        operation: 'constructor',
      });
    }

    /** @type {Object} ContainerPool instance */
    this.containerPool = containerPool;

    /** @type {Object|null} McpManager instance */
    this.mcpManager = mcpManager;

    /**
     * Map of tool name to factory function
     * Factory signature: (containerPool, botId, toolConfig?) => VercelAITool
     * @type {Map<string, Function>}
     */
    this.builtinTools = new Map();
  }

  /**
   * Register a built-in tool factory function
   *
   * Tool factories receive (containerPool, botId, toolConfig) and must
   * return a Vercel AI SDK tool object with `description`, `parameters`,
   * and `execute` properties.
   *
   * @param {string} name - Unique tool name (e.g., 'bash', 'readFile')
   * @param {Function} factory - Factory function that creates the tool
   * @throws {ToolRegistryError} When name or factory is invalid
   *
   * @example
   * registry.registerTool('bash', createBashTool);
   */
  registerTool(name, factory) {
    if (!name || typeof name !== 'string') {
      throw new ToolRegistryError('Tool name must be a non-empty string', {
        operation: 'registerTool',
      });
    }

    if (typeof factory !== 'function') {
      throw new ToolRegistryError(`Tool factory for "${name}" must be a function`, {
        operation: 'registerTool',
        toolName: name,
      });
    }

    this.builtinTools.set(name, factory);
  }

  /**
   * Check if a built-in tool is registered
   *
   * @param {string} name - Tool name to check
   * @returns {boolean} True if the tool is registered
   *
   * @example
   * registry.hasTool('bash'); // true
   * registry.hasTool('unknown'); // false
   */
  hasTool(name) {
    return this.builtinTools.has(name);
  }

  /**
   * Get all registered built-in tool names
   *
   * @returns {string[]} Array of registered tool names
   *
   * @example
   * registry.getRegisteredToolNames(); // ['bash', 'readFile', 'writeFile']
   */
  getRegisteredToolNames() {
    return [...this.builtinTools.keys()];
  }

  /**
   * Unregister a built-in tool
   *
   * @param {string} name - Tool name to remove
   * @returns {boolean} True if the tool was removed, false if it didn't exist
   *
   * @example
   * registry.unregisterTool('webSearch'); // true
   */
  unregisterTool(name) {
    return this.builtinTools.delete(name);
  }

  /**
   * Resolve tools for a specific bot configuration
   *
   * Combines built-in tools (from botConfig.tools) and MCP tools
   * (from botConfig.mcpServers) into a single tools object suitable
   * for passing to Vercel AI SDK's generateText/streamText.
   *
   * Unknown tool names in botConfig.tools are silently skipped (logged as warning).
   *
   * @param {Object} botConfig - Bot configuration object
   * @param {string} botConfig.id - Bot identifier
   * @param {string[]} [botConfig.tools=[]] - Array of built-in tool names to include
   * @param {Object} [botConfig.toolConfig={}] - Per-tool configuration overrides
   * @param {string[]} [botConfig.mcpServers=[]] - Array of MCP server names to include
   * @returns {Promise<Object>} Object mapping tool names to Vercel AI SDK tool objects
   * @throws {ToolRegistryError} When botConfig is invalid or tool creation fails
   *
   * @example
   * const tools = await registry.getToolsForBot({
   *   id: 'support',
   *   tools: ['bash', 'readFile'],
   *   toolConfig: { bash: { timeout: 60000 } },
   *   mcpServers: ['github']
   * });
   * // tools = { bash: {...}, readFile: {...}, github__list_repos: {...} }
   */
  async getToolsForBot(botConfig) {
    if (!botConfig || typeof botConfig !== 'object') {
      throw new ToolRegistryError('Bot config must be an object', {
        operation: 'getToolsForBot',
      });
    }

    if (!botConfig.id || typeof botConfig.id !== 'string') {
      throw new ToolRegistryError('Bot config must have a string "id" property', {
        operation: 'getToolsForBot',
      });
    }

    const { id: botId } = botConfig;
    const tools = {};

    // Resolve built-in tools
    const requestedTools = botConfig.tools || [];
    for (const toolName of requestedTools) {
      const factory = this.builtinTools.get(toolName);
      if (!factory) {
        // Warn but don't throw - allows graceful degradation
        continue;
      }

      try {
        const toolConfig = botConfig.toolConfig?.[toolName];
        tools[toolName] = factory(this.containerPool, botId, toolConfig);
      } catch (err) {
        throw new ToolRegistryError(
          `Failed to create tool "${toolName}" for bot "${botId}": ${err.message}`,
          {
            operation: 'getToolsForBot',
            toolName,
            botId,
            cause: err,
          }
        );
      }
    }

    // Resolve MCP tools (if McpManager is available)
    if (this.mcpManager && botConfig.mcpServers?.length > 0) {
      try {
        const mcpTools = await this.mcpManager.getToolsForBot(botConfig);
        for (const tool of mcpTools) {
          tools[tool.name] = tool;
        }
      } catch (err) {
        throw new ToolRegistryError(`Failed to get MCP tools for bot "${botId}": ${err.message}`, {
          operation: 'getToolsForBot',
          botId,
          cause: err,
        });
      }
    }

    return tools;
  }

  /**
   * Get the list of known built-in tool names
   *
   * Returns the canonical list of built-in tool names recognized by
   * the framework, regardless of whether they are currently registered.
   *
   * @returns {string[]} Array of known built-in tool names
   *
   * @example
   * ToolRegistry.getBuiltinToolNames();
   * // ['bash', 'readFile', 'writeFile', 'glob', 'grep', 'webSearch', 'webFetch']
   */
  static getBuiltinToolNames() {
    return [...BUILTIN_TOOL_NAMES];
  }
}
