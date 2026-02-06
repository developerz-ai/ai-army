/**
 * FileTools - Vercel AI SDK tools for file operations in Docker containers
 *
 * Factory functions that create Vercel AI SDK-compatible tools for reading,
 * writing, searching, and finding files inside a bot's Docker container.
 * Each tool uses Zod schema validation and executes via ContainerPool.
 *
 * @module tools/file-tools
 */

import { tool } from 'ai';
import { z } from 'zod';

/** Maximum content length for read operations (100 KB) */
const MAX_CONTENT_LENGTH = 100000;

/** Maximum number of files returned by glob (prevent huge listings) */
const MAX_GLOB_RESULTS = 100;

/** Maximum number of grep matches returned */
const MAX_GREP_MATCHES = 500;

/** Default timeout for file operations in milliseconds */
const DEFAULT_TIMEOUT = 30000;

/**
 * Custom error class for file tool errors
 */
export class FileToolsError extends Error {
  /**
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {string} [options.operation] - The operation that failed
   * @param {string} [options.botId] - Bot ID if applicable
   * @param {string} [options.filePath] - File path involved
   * @param {Error} [options.cause] - Original error that caused this
   */
  constructor(message, options = {}) {
    super(message);
    this.name = 'FileToolsError';
    this.operation = options.operation;
    this.botId = options.botId;
    this.filePath = options.filePath;
    this.cause = options.cause;
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
 * Sanitize a file path to prevent command injection
 *
 * Checks for shell metacharacters that could be used to break out
 * of the quoted context in shell commands.
 *
 * @param {string} filePath - File path to validate
 * @returns {{safe: boolean, error?: string}} Validation result
 */
export function sanitizePath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return { safe: false, error: 'File path must be a non-empty string' };
  }

  if (filePath.length > 4096) {
    return { safe: false, error: 'File path exceeds maximum length (4096)' };
  }

  // Block shell metacharacters that could escape quoted strings
  const dangerousChars = /[`$(){}|;&<>!]/;
  if (dangerousChars.test(filePath)) {
    return {
      safe: false,
      error: 'File path contains potentially dangerous characters',
    };
  }

  return { safe: true };
}

/**
 * Validate factory function arguments (containerPool and botId)
 *
 * @param {Object} containerPool - ContainerPool instance
 * @param {string} botId - Bot identifier
 * @param {string} operation - Name of the calling factory function
 * @throws {FileToolsError} When arguments are invalid
 */
function validateFactoryArgs(containerPool, botId, operation) {
  if (!containerPool) {
    throw new FileToolsError('ContainerPool is required', { operation });
  }

  if (!botId || typeof botId !== 'string') {
    throw new FileToolsError('Bot ID must be a non-empty string', { operation });
  }
}

/**
 * Create a Vercel AI SDK readFile tool for a specific bot
 *
 * Reads file contents from inside the bot's Docker container using `cat`.
 * Supports UTF-8 and base64 encoding. Large file contents are truncated.
 *
 * @param {Object} containerPool - ContainerPool instance for Docker container access
 * @param {string} botId - Bot identifier for container lookup
 * @param {Object} [toolConfig={}] - Optional tool configuration overrides
 * @param {number} [toolConfig.maxContentLength] - Max content before truncation
 * @param {number} [toolConfig.timeout] - Command timeout in ms
 * @returns {Object} Vercel AI SDK tool object with description, parameters, execute
 * @throws {FileToolsError} When containerPool or botId is invalid
 *
 * @example
 * const readFile = createReadFileTool(containerPool, 'support-bot');
 * const result = await readFile.execute({ path: '/home/agent/config.json' });
 * // { success: true, content: '{ "key": "value" }' }
 */
export function createReadFileTool(containerPool, botId, toolConfig = {}) {
  validateFactoryArgs(containerPool, botId, 'createReadFileTool');

  const maxContentLength = toolConfig.maxContentLength || MAX_CONTENT_LENGTH;
  const timeout = toolConfig.timeout || DEFAULT_TIMEOUT;

  return tool({
    description: 'Read the contents of a file from the workspace.',
    parameters: z.object({
      path: z.string().describe('Absolute or relative path to the file to read'),
      encoding: z.enum(['utf8', 'base64']).optional().describe('File encoding (default: utf8)'),
    }),
    execute: async ({ path: filePath, encoding = 'utf8' }) => {
      const pathCheck = sanitizePath(filePath);
      if (!pathCheck.safe) {
        return { success: false, error: pathCheck.error };
      }

      try {
        const container = await containerPool.getContainer(botId);
        const { dockerManager } = containerPool;

        const cmd = encoding === 'base64' ? `base64 "${filePath}"` : `cat "${filePath}"`;

        const result = await dockerManager.exec(container, cmd, { timeout });

        if (result.exitCode !== 0) {
          return {
            success: false,
            error: result.stderr || `Failed to read file: exit code ${result.exitCode}`,
          };
        }

        return {
          success: true,
          content: truncate(result.stdout, maxContentLength),
        };
      } catch (err) {
        return {
          success: false,
          error: `Execution error: ${err.message}`,
        };
      }
    },
  });
}

/**
 * Create a Vercel AI SDK writeFile tool for a specific bot
 *
 * Writes content to a file inside the bot's Docker container. Uses a heredoc
 * approach for safe content transfer. Supports overwrite and append modes.
 *
 * @param {Object} containerPool - ContainerPool instance for Docker container access
 * @param {string} botId - Bot identifier for container lookup
 * @param {Object} [toolConfig={}] - Optional tool configuration overrides
 * @param {number} [toolConfig.timeout] - Command timeout in ms
 * @returns {Object} Vercel AI SDK tool object with description, parameters, execute
 * @throws {FileToolsError} When containerPool or botId is invalid
 *
 * @example
 * const writeFile = createWriteFileTool(containerPool, 'support-bot');
 * const result = await writeFile.execute({
 *   path: '/home/agent/output.txt',
 *   content: 'Hello, world!',
 * });
 * // { success: true }
 */
export function createWriteFileTool(containerPool, botId, toolConfig = {}) {
  validateFactoryArgs(containerPool, botId, 'createWriteFileTool');

  const timeout = toolConfig.timeout || DEFAULT_TIMEOUT;

  return tool({
    description: 'Write content to a file in the workspace. Creates parent directories if needed.',
    parameters: z.object({
      path: z.string().describe('Absolute or relative path to the file to write'),
      content: z.string().describe('Content to write to the file'),
      append: z
        .boolean()
        .optional()
        .describe('Append to file instead of overwrite (default: false)'),
    }),
    execute: async ({ path: filePath, content, append = false }) => {
      const pathCheck = sanitizePath(filePath);
      if (!pathCheck.safe) {
        return { success: false, error: pathCheck.error };
      }

      try {
        const container = await containerPool.getContainer(botId);
        const { dockerManager } = containerPool;

        // Create parent directory first
        const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
        if (dirPath) {
          await dockerManager.exec(container, `mkdir -p "${dirPath}"`, { timeout });
        }

        // Use heredoc for safe content transfer (avoids shell escaping issues)
        const operator = append ? '>>' : '>';
        const delimiter = `_AI_ARMY_EOF_${Date.now()}`;
        const cmd = `cat ${operator} "${filePath}" << '${delimiter}'\n${content}\n${delimiter}`;

        const result = await dockerManager.exec(container, cmd, { timeout });

        if (result.exitCode !== 0) {
          return {
            success: false,
            error: result.stderr || `Failed to write file: exit code ${result.exitCode}`,
          };
        }

        return { success: true };
      } catch (err) {
        return {
          success: false,
          error: `Execution error: ${err.message}`,
        };
      }
    },
  });
}

/**
 * Create a Vercel AI SDK glob tool for a specific bot
 *
 * Finds files matching a glob pattern inside the bot's Docker container
 * using the `find` command. Results are limited to prevent huge listings.
 *
 * @param {Object} containerPool - ContainerPool instance for Docker container access
 * @param {string} botId - Bot identifier for container lookup
 * @param {Object} [toolConfig={}] - Optional tool configuration overrides
 * @param {number} [toolConfig.maxResults] - Maximum number of files to return
 * @param {number} [toolConfig.timeout] - Command timeout in ms
 * @returns {Object} Vercel AI SDK tool object with description, parameters, execute
 * @throws {FileToolsError} When containerPool or botId is invalid
 *
 * @example
 * const glob = createGlobTool(containerPool, 'support-bot');
 * const result = await glob.execute({ pattern: '*.js', cwd: '/home/agent/src' });
 * // { success: true, files: ['app.js', 'index.js'] }
 */
export function createGlobTool(containerPool, botId, toolConfig = {}) {
  validateFactoryArgs(containerPool, botId, 'createGlobTool');

  const maxResults = toolConfig.maxResults || MAX_GLOB_RESULTS;
  const timeout = toolConfig.timeout || DEFAULT_TIMEOUT;

  return tool({
    description: 'Find files matching a glob pattern in the workspace.',
    parameters: z.object({
      pattern: z.string().describe('Glob pattern to match files (e.g., "*.js", "**/*.ts")'),
      cwd: z.string().optional().describe('Directory to search in (default: /home/agent)'),
    }),
    execute: async ({ pattern, cwd }) => {
      const dirCheck = cwd ? sanitizePath(cwd) : { safe: true };
      if (!dirCheck.safe) {
        return { success: false, files: [], error: dirCheck.error };
      }

      // Validate pattern for dangerous chars (same as path sanitization)
      const patternCheck = sanitizePath(pattern);
      if (!patternCheck.safe) {
        return { success: false, files: [], error: patternCheck.error };
      }

      try {
        const container = await containerPool.getContainer(botId);
        const { dockerManager } = containerPool;

        const dir = cwd || '/home/agent';
        const cmd = `find "${dir}" -path "${pattern}" -type f 2>/dev/null | head -${maxResults}`;

        const result = await dockerManager.exec(container, cmd, { timeout });

        const files = result.stdout.trim().split('\n').filter(Boolean);

        return { success: true, files };
      } catch (err) {
        return {
          success: false,
          files: [],
          error: `Execution error: ${err.message}`,
        };
      }
    },
  });
}

/**
 * Create a Vercel AI SDK grep tool for a specific bot
 *
 * Searches file contents for a regex pattern inside the bot's Docker container.
 * Uses `grep` with line numbers. Supports case-insensitive search and match limits.
 *
 * @param {Object} containerPool - ContainerPool instance for Docker container access
 * @param {string} botId - Bot identifier for container lookup
 * @param {Object} [toolConfig={}] - Optional tool configuration overrides
 * @param {number} [toolConfig.maxMatches] - Maximum number of matches to return
 * @param {number} [toolConfig.timeout] - Command timeout in ms
 * @returns {Object} Vercel AI SDK tool object with description, parameters, execute
 * @throws {FileToolsError} When containerPool or botId is invalid
 *
 * @example
 * const grep = createGrepTool(containerPool, 'support-bot');
 * const result = await grep.execute({
 *   pattern: 'TODO',
 *   path: '/home/agent/src',
 *   options: { ignoreCase: true },
 * });
 * // { success: true, matches: [{ file: 'app.js', line: 42, text: '// TODO: fix' }] }
 */
export function createGrepTool(containerPool, botId, toolConfig = {}) {
  validateFactoryArgs(containerPool, botId, 'createGrepTool');

  const maxMatches = toolConfig.maxMatches || MAX_GREP_MATCHES;
  const timeout = toolConfig.timeout || DEFAULT_TIMEOUT;

  return tool({
    description: 'Search for text patterns in files within the workspace.',
    parameters: z.object({
      pattern: z.string().describe('Regex pattern to search for'),
      path: z.string().optional().describe('File or directory to search in (default: /home/agent)'),
      options: z
        .object({
          ignoreCase: z.boolean().optional().describe('Case-insensitive search'),
          maxMatches: z.number().optional().describe('Maximum matches per file'),
        })
        .optional()
        .describe('Search options'),
    }),
    execute: async ({ pattern, path: searchPath = '/home/agent', options = {} }) => {
      const pathCheck = sanitizePath(searchPath);
      if (!pathCheck.safe) {
        return { success: false, matches: [], error: pathCheck.error };
      }

      // Validate pattern - allow regex chars but block shell injection
      const shellInjection = /[`${}|;&<>!]/;
      if (shellInjection.test(pattern)) {
        return {
          success: false,
          matches: [],
          error: 'Search pattern contains potentially dangerous characters',
        };
      }

      try {
        const container = await containerPool.getContainer(botId);
        const { dockerManager } = containerPool;

        // Build grep command with line numbers, recursive search, and always show filename
        let cmd = 'grep -rnH';
        if (options.ignoreCase) cmd += ' -i';
        if (options.maxMatches) cmd += ` -m ${options.maxMatches}`;
        cmd += ` "${pattern}" "${searchPath}" 2>/dev/null | head -${maxMatches}`;

        const result = await dockerManager.exec(container, cmd, { timeout });

        // grep returns exit code 1 when no matches found (not an error)
        if (result.exitCode !== 0 && result.exitCode !== 1) {
          return {
            success: false,
            matches: [],
            error: result.stderr || `Grep failed: exit code ${result.exitCode}`,
          };
        }

        // Parse grep output: file:line:text
        const matches = result.stdout
          .trim()
          .split('\n')
          .filter(Boolean)
          .map(line => {
            const firstColon = line.indexOf(':');
            const secondColon = line.indexOf(':', firstColon + 1);
            if (firstColon === -1 || secondColon === -1) {
              return null;
            }
            return {
              file: line.slice(0, firstColon),
              line: parseInt(line.slice(firstColon + 1, secondColon), 10),
              text: line.slice(secondColon + 1),
            };
          })
          .filter(Boolean);

        return { success: true, matches };
      } catch (err) {
        return {
          success: false,
          matches: [],
          error: `Execution error: ${err.message}`,
        };
      }
    },
  });
}
