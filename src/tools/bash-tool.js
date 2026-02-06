/**
 * BashTool - Vercel AI SDK tool for executing bash commands in Docker containers
 *
 * Factory function that creates a Vercel AI SDK-compatible tool with Zod schema
 * validation for parameter types. Commands execute inside the bot's Docker container
 * via the ContainerPool and include security checks for dangerous patterns.
 *
 * @module tools/bash-tool
 */

import { tool } from 'ai';
import { z } from 'zod';

/**
 * Dangerous command patterns that should be blocked.
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

/** Maximum stdout length before truncation (50 KB) */
const MAX_STDOUT_LENGTH = 50000;

/** Maximum stderr length before truncation (10 KB) */
const MAX_STDERR_LENGTH = 10000;

/**
 * Custom error class for bash tool errors
 */
export class BashToolError extends Error {
  /**
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {string} [options.operation] - The operation that failed
   * @param {string} [options.botId] - Bot ID if applicable
   * @param {string} [options.command] - The command that failed
   * @param {Error} [options.cause] - Original error that caused this
   */
  constructor(message, options = {}) {
    super(message);
    this.name = 'BashToolError';
    this.operation = options.operation;
    this.botId = options.botId;
    this.command = options.command;
    this.cause = options.cause;
  }
}

/**
 * Check if a command matches any dangerous patterns
 *
 * @param {string} command - Command to check
 * @returns {boolean} True if the command is dangerous
 */
export function isDangerousCommand(command) {
  if (!command || typeof command !== 'string') {
    return false;
  }
  return DANGEROUS_PATTERNS.some(({ pattern }) => pattern.test(command));
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
 * Create a Vercel AI SDK bash tool for a specific bot
 *
 * Returns a tool object compatible with Vercel AI SDK's generateText/streamText.
 * The tool executes bash commands inside the bot's Docker container with security
 * checks and output truncation.
 *
 * @param {Object} containerPool - ContainerPool instance for Docker container access
 * @param {string} botId - Bot identifier for container lookup
 * @param {Object} [toolConfig={}] - Optional tool configuration overrides
 * @param {number} [toolConfig.timeout] - Default command timeout in ms
 * @param {number} [toolConfig.maxStdoutLength] - Max stdout before truncation
 * @param {number} [toolConfig.maxStderrLength] - Max stderr before truncation
 * @returns {Object} Vercel AI SDK tool object with description, parameters, execute
 * @throws {BashToolError} When containerPool or botId is invalid
 *
 * @example
 * const bashTool = createBashTool(containerPool, 'support-bot');
 * // Use with Vercel AI SDK:
 * const result = await generateText({
 *   model,
 *   messages,
 *   tools: { bash: bashTool },
 *   maxSteps: 30
 * });
 */
export function createBashTool(containerPool, botId, toolConfig = {}) {
  if (!containerPool) {
    throw new BashToolError('ContainerPool is required', {
      operation: 'createBashTool',
    });
  }

  if (!botId || typeof botId !== 'string') {
    throw new BashToolError('Bot ID must be a non-empty string', {
      operation: 'createBashTool',
    });
  }

  const timeout = toolConfig.timeout || DEFAULT_TIMEOUT;
  const maxStdoutLength = toolConfig.maxStdoutLength || MAX_STDOUT_LENGTH;
  const maxStderrLength = toolConfig.maxStderrLength || MAX_STDERR_LENGTH;

  return tool({
    description: 'Execute a bash command in the workspace. Returns stdout, stderr, and exit code.',
    parameters: z.object({
      command: z.string().describe('Bash command to execute'),
      timeout: z.number().optional().describe('Timeout in milliseconds (default: 30000)'),
    }),
    execute: async ({ command, timeout: commandTimeout }) => {
      // Security check - return error result instead of throwing
      if (isDangerousCommand(command)) {
        return {
          success: false,
          exitCode: 1,
          stdout: '',
          stderr: 'Command blocked by security policy: dangerous command detected',
        };
      }

      try {
        const container = await containerPool.getContainer(botId);
        const { dockerManager } = containerPool;

        const result = await dockerManager.exec(container, command, {
          timeout: commandTimeout || timeout,
        });

        return {
          success: result.exitCode === 0,
          exitCode: result.exitCode,
          stdout: truncate(result.stdout, maxStdoutLength),
          stderr: truncate(result.stderr, maxStderrLength),
        };
      } catch (err) {
        // Return error as result so LLM can see it (don't throw)
        return {
          success: false,
          exitCode: 1,
          stdout: '',
          stderr: `Execution error: ${err.message}`,
        };
      }
    },
  });
}
