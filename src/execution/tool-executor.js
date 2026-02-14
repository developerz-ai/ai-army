/**
 * ToolExecutor - Execute tools in containers
 *
 * Routes tool calls (bash, readFile, writeFile) to bot containers
 * via the ContainerPool abstraction (which handles backend routing).
 * Includes security checks for dangerous commands and output truncation
 * for large responses.
 *
 * @module execution/tool-executor
 */

/**
 * Custom error class for tool execution errors
 */
export class ToolExecutionError extends Error {
  /**
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {string} [options.operation] - The operation that failed
   * @param {string} [options.toolName] - Tool name that was being executed
   * @param {string} [options.botId] - Bot ID if applicable
   * @param {Error} [options.cause] - Original error that caused this
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'ToolExecutionError';
    this.operation = options.operation;
    this.toolName = options.toolName;
    this.botId = options.botId;
  }
}

/**
 * Custom error class for dangerous command detection
 */
export class DangerousCommandError extends Error {
  /**
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {string} [options.command] - The command that was blocked
   * @param {string} [options.pattern] - The pattern that matched
   * @param {Error} [options.cause] - Original error that caused this
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'DangerousCommandError';
    this.command = options.command;
    this.pattern = options.pattern;
  }
}

/**
 * Dangerous command patterns that should be blocked
 * Each entry contains a regex pattern and a human-readable description.
 *
 * @type {Array<{pattern: RegExp, description: string}>}
 */
const DANGEROUS_PATTERNS = [
  { pattern: /rm\s+-rf\s+\/(?!\S)/, description: 'rm -rf /' },
  { pattern: /rm\s+-rf\s+\/\s*$/, description: 'rm -rf / (end of command)' },
  {
    pattern: /rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?--no-preserve-root/,
    description: '--no-preserve-root',
  },
  { pattern: />\s*\/dev\/sd/, description: 'write to disk device' },
  { pattern: />\s*\/dev\/nvme/, description: 'write to NVMe device' },
  { pattern: /mkfs\./, description: 'format filesystem' },
  { pattern: /dd\s+.*of=\/dev\//, description: 'dd to device' },
  { pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, description: 'fork bomb' },
  { pattern: /chmod\s+-R\s+777\s+\/(?!\S)/, description: 'chmod 777 /' },
  { pattern: /chmod\s+-R\s+777\s+\/\s*$/, description: 'chmod 777 / (end of command)' },
];

/** Default command timeout in milliseconds */
const DEFAULT_TIMEOUT = 30000;

/** Maximum stdout length before truncation */
const MAX_STDOUT_LENGTH = 50000;

/** Maximum stderr length before truncation */
const MAX_STDERR_LENGTH = 10000;

/** Maximum file content length before truncation */
const MAX_FILE_CONTENT_LENGTH = 100000;

/** Supported tool names */
const SUPPORTED_TOOLS = ['bash', 'readFile', 'writeFile'];

/**
 * Executes tools in Docker containers via the ContainerPool
 *
 * @example
 * const executor = new ToolExecutor(containerPool);
 *
 * // Execute a bash command
 * const result = await executor.bash('echo "hello"', 'my-bot');
 *
 * // Read a file
 * const fileResult = await executor.readFile('/home/agent/config.json', 'my-bot');
 *
 * // Write a file
 * const writeResult = await executor.writeFile('/home/agent/out.txt', 'content', 'my-bot');
 *
 * // Route via executeTool
 * const toolResult = await executor.executeTool('bash', { command: 'ls -la' }, 'my-bot');
 */
export class ToolExecutor {
  /**
   * Create a new ToolExecutor instance
   *
   * @param {Object} containerPool - ContainerPool instance for container access
   * @param {Object} [options={}] - Configuration options
   * @param {number} [options.timeout=30000] - Default command timeout in ms
   * @param {number} [options.maxStdoutLength=50000] - Max stdout before truncation
   * @param {number} [options.maxStderrLength=10000] - Max stderr before truncation
   * @param {number} [options.maxFileContentLength=100000] - Max file content before truncation
   * @throws {ToolExecutionError} When containerPool is not provided
   */
  constructor(containerPool, options = {}) {
    if (!containerPool) {
      throw new ToolExecutionError('ContainerPool is required', {
        operation: 'constructor',
      });
    }

    /** @type {Object} ContainerPool instance */
    this.containerPool = containerPool;

    /** @type {number} Default command timeout */
    this.timeout = options.timeout || DEFAULT_TIMEOUT;

    /** @type {number} Max stdout length */
    this.maxStdoutLength = options.maxStdoutLength || MAX_STDOUT_LENGTH;

    /** @type {number} Max stderr length */
    this.maxStderrLength = options.maxStderrLength || MAX_STDERR_LENGTH;

    /** @type {number} Max file content length */
    this.maxFileContentLength = options.maxFileContentLength || MAX_FILE_CONTENT_LENGTH;
  }

  /**
   * Execute a tool by name with parameters
   *
   * Routes to the correct tool handler based on toolName.
   *
   * @param {string} toolName - Name of the tool to execute ('bash', 'readFile', 'writeFile')
   * @param {Object} params - Tool parameters
   * @param {string} botId - Bot identifier
   * @returns {Promise<Object>} Tool execution result
   * @throws {ToolExecutionError} When tool name is unsupported or execution fails
   */
  async executeTool(toolName, params, botId) {
    if (!toolName || typeof toolName !== 'string') {
      throw new ToolExecutionError('Tool name must be a non-empty string', {
        operation: 'executeTool',
      });
    }

    if (!params || typeof params !== 'object') {
      throw new ToolExecutionError('Tool parameters must be an object', {
        operation: 'executeTool',
        toolName,
      });
    }

    if (!botId || typeof botId !== 'string') {
      throw new ToolExecutionError('Bot ID must be a non-empty string', {
        operation: 'executeTool',
        toolName,
      });
    }

    if (!SUPPORTED_TOOLS.includes(toolName)) {
      throw new ToolExecutionError(
        `Unsupported tool: ${toolName}. Supported tools: ${SUPPORTED_TOOLS.join(', ')}`,
        {
          operation: 'executeTool',
          toolName,
          botId,
        }
      );
    }

    try {
      switch (toolName) {
        case 'bash':
          return await this.bash(params.command, botId, {
            timeout: params.timeout,
            workingDir: params.workingDir,
          });
        case 'readFile':
          return await this.readFile(params.path, botId, {
            encoding: params.encoding,
          });
        case 'writeFile':
          return await this.writeFile(params.path, params.content, botId, {
            append: params.append,
          });
        default:
          throw new ToolExecutionError(`Unhandled tool: ${toolName}`, {
            operation: 'executeTool',
            toolName,
            botId,
          });
      }
    } catch (err) {
      if (err instanceof ToolExecutionError || err instanceof DangerousCommandError) {
        throw err;
      }

      throw new ToolExecutionError(
        `Failed to execute ${toolName} in bot ${botId}: ${err.message}`,
        {
          operation: 'executeTool',
          toolName,
          botId,
          cause: err,
        }
      );
    }
  }

  /**
   * Execute a bash command in a bot's container
   *
   * Performs security checks before execution and truncates output if needed.
   *
   * @param {string} command - Bash command to execute
   * @param {string} botId - Bot identifier
   * @param {Object} [options={}] - Execution options
   * @param {number} [options.timeout] - Command timeout in ms (overrides default)
   * @param {string} [options.workingDir='/home/agent'] - Working directory
   * @returns {Promise<{success: boolean, stdout: string, stderr: string, exitCode: number}>}
   * @throws {DangerousCommandError} When command matches dangerous patterns
   * @throws {ToolExecutionError} When execution fails
   */
  async bash(command, botId, options = {}) {
    if (!command || typeof command !== 'string') {
      throw new ToolExecutionError('Command must be a non-empty string', {
        operation: 'bash',
        toolName: 'bash',
        botId,
      });
    }

    if (!botId || typeof botId !== 'string') {
      throw new ToolExecutionError('Bot ID must be a non-empty string', {
        operation: 'bash',
        toolName: 'bash',
      });
    }

    // Security check
    if (this.isDangerousCommand(command)) {
      throw new DangerousCommandError('Command blocked by security policy', { command });
    }

    try {
      const execOptions = {
        timeout: options.timeout || this.timeout,
      };

      if (options.workingDir) {
        execOptions.workingDir = options.workingDir;
      }

      const result = await this.containerPool.exec(botId, command, execOptions);

      return {
        success: result.exitCode === 0,
        stdout: truncate(result.stdout, this.maxStdoutLength),
        stderr: truncate(result.stderr, this.maxStderrLength),
        exitCode: result.exitCode,
      };
    } catch (err) {
      if (err instanceof DangerousCommandError || err instanceof ToolExecutionError) {
        throw err;
      }

      throw new ToolExecutionError(
        `Failed to execute bash command in bot ${botId}: ${err.message}`,
        {
          operation: 'bash',
          toolName: 'bash',
          botId,
          cause: err,
        }
      );
    }
  }

  /**
   * Read a file from a bot's container
   *
   * @param {string} filePath - Path to the file inside the container
   * @param {string} botId - Bot identifier
   * @param {Object} [options={}] - Read options
   * @param {string} [options.encoding='utf8'] - File encoding ('utf8' or 'base64')
   * @returns {Promise<{success: boolean, content: string, error?: string}>}
   * @throws {ToolExecutionError} When read operation fails
   */
  async readFile(filePath, botId, options = {}) {
    if (!filePath || typeof filePath !== 'string') {
      throw new ToolExecutionError('File path must be a non-empty string', {
        operation: 'readFile',
        toolName: 'readFile',
        botId,
      });
    }

    if (!botId || typeof botId !== 'string') {
      throw new ToolExecutionError('Bot ID must be a non-empty string', {
        operation: 'readFile',
        toolName: 'readFile',
      });
    }

    try {
      const encoding = options.encoding || 'utf8';

      // Escape the file path for shell usage
      const escapedPath = escapeShellArg(filePath);

      const cmd = encoding === 'base64' ? `base64 ${escapedPath}` : `cat ${escapedPath}`;

      const result = await this.containerPool.exec(botId, cmd, {
        timeout: this.timeout,
      });

      if (result.exitCode !== 0) {
        return {
          success: false,
          content: '',
          error: result.stderr || `Failed to read file: ${filePath}`,
        };
      }

      return {
        success: true,
        content: truncate(result.stdout, this.maxFileContentLength),
      };
    } catch (err) {
      if (err instanceof ToolExecutionError) {
        throw err;
      }

      throw new ToolExecutionError(
        `Failed to read file ${filePath} in bot ${botId}: ${err.message}`,
        {
          operation: 'readFile',
          toolName: 'readFile',
          botId,
          cause: err,
        }
      );
    }
  }

  /**
   * Write content to a file in a bot's container
   *
   * @param {string} filePath - Path to the file inside the container
   * @param {string} content - Content to write
   * @param {string} botId - Bot identifier
   * @param {Object} [options={}] - Write options
   * @param {boolean} [options.append=false] - Append instead of overwrite
   * @returns {Promise<{success: boolean, error?: string}>}
   * @throws {ToolExecutionError} When write operation fails
   */
  async writeFile(filePath, content, botId, options = {}) {
    if (!filePath || typeof filePath !== 'string') {
      throw new ToolExecutionError('File path must be a non-empty string', {
        operation: 'writeFile',
        toolName: 'writeFile',
        botId,
      });
    }

    if (typeof content !== 'string') {
      throw new ToolExecutionError('Content must be a string', {
        operation: 'writeFile',
        toolName: 'writeFile',
        botId,
      });
    }

    if (!botId || typeof botId !== 'string') {
      throw new ToolExecutionError('Bot ID must be a non-empty string', {
        operation: 'writeFile',
        toolName: 'writeFile',
      });
    }

    try {
      // Use heredoc for writing to handle special characters safely
      const escapedPath = escapeShellArg(filePath);
      const operator = options.append ? '>>' : '>';

      // Use base64 encoding to safely transfer content with special chars
      const base64Content = Buffer.from(content).toString('base64');
      const cmd = `echo '${base64Content}' | base64 -d ${operator} ${escapedPath}`;

      const result = await this.containerPool.exec(botId, cmd, {
        timeout: this.timeout,
      });

      if (result.exitCode !== 0) {
        return {
          success: false,
          error: result.stderr || `Failed to write file: ${filePath}`,
        };
      }

      return {
        success: true,
      };
    } catch (err) {
      if (err instanceof ToolExecutionError) {
        throw err;
      }

      throw new ToolExecutionError(
        `Failed to write file ${filePath} in bot ${botId}: ${err.message}`,
        {
          operation: 'writeFile',
          toolName: 'writeFile',
          botId,
          cause: err,
        }
      );
    }
  }

  /**
   * Check if a command matches any dangerous patterns
   *
   * Checks the command against a list of known dangerous patterns
   * such as `rm -rf /`, fork bombs, device writes, etc.
   *
   * @param {string} command - Command to check
   * @returns {boolean} True if the command is dangerous
   */
  isDangerousCommand(command) {
    if (!command || typeof command !== 'string') {
      return false;
    }

    return DANGEROUS_PATTERNS.some(({ pattern }) => pattern.test(command));
  }
}

/**
 * Truncate a string to a maximum length with indicator
 *
 * @param {string} str - String to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated string
 */
function truncate(str, maxLength) {
  if (!str || typeof str !== 'string') {
    return '';
  }

  if (str.length <= maxLength) {
    return str;
  }

  const truncated = str.slice(0, maxLength);
  const remaining = str.length - maxLength;
  return `${truncated}\n... [truncated ${remaining} characters]`;
}

/**
 * Escape a string for safe use in shell arguments
 *
 * @param {string} arg - Argument to escape
 * @returns {string} Escaped argument wrapped in single quotes
 */
function escapeShellArg(arg) {
  // Wrap in single quotes, escaping any embedded single quotes
  return `'${arg.replace(/'/g, "'\\''")}'`;
}
