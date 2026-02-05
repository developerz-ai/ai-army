/**
 * SoulLoader - Load and process bot soul.md personality files
 *
 * Handles:
 * - Loading Markdown soul files from the filesystem
 * - Interpolating template variables ({botName}, {teamName}, etc.)
 *
 * Soul files define a bot's personality, values, and instructions.
 * They are injected as the system prompt when talking to the LLM.
 *
 * @module SoulLoader
 */

import fs from 'fs/promises';
import path from 'path';

/**
 * Custom error for soul loading failures
 */
export class SoulLoaderError extends Error {
  /**
   * Create a SoulLoaderError
   * @param {string} message - Error message
   * @param {Object} [options] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.filePath] - Path to the soul file
   * @param {string} [options.variableName] - Variable name that caused the issue
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'SoulLoaderError';
    this.filePath = options.filePath;
    this.variableName = options.variableName;
  }
}

/**
 * Soul file loader and variable interpolator
 */
export class SoulLoader {
  /**
   * Load a soul Markdown file from disk
   *
   * Reads the file as UTF-8 text and returns its contents.
   * The file should be a Markdown document defining the bot's personality.
   *
   * @param {string} filePath - Absolute or relative path to the soul.md file
   * @returns {Promise<string>} - Raw file contents
   * @throws {SoulLoaderError} - If the file cannot be read
   */
  async loadSoulFile(filePath) {
    if (!filePath || typeof filePath !== 'string') {
      throw new SoulLoaderError('Soul file path must be a non-empty string', {
        filePath,
      });
    }

    const resolved = path.resolve(filePath);

    try {
      const content = await fs.readFile(resolved, 'utf8');
      return content;
    } catch (err) {
      if (err.code === 'ENOENT') {
        throw new SoulLoaderError(`Soul file not found: ${resolved}`, {
          cause: err,
          filePath: resolved,
        });
      }

      if (err.code === 'EACCES') {
        throw new SoulLoaderError(`Permission denied reading soul file: ${resolved}`, {
          cause: err,
          filePath: resolved,
        });
      }

      throw new SoulLoaderError(`Failed to read soul file: ${resolved}`, {
        cause: err,
        filePath: resolved,
      });
    }
  }

  /**
   * Interpolate template variables in soul content
   *
   * Replaces `{varName}` placeholders with values from the variables object.
   * Unknown variables (not present in the variables object) are left unchanged.
   *
   * This uses single-brace syntax `{varName}` which is different from
   * the environment variable syntax `${VAR}` used in config files.
   *
   * @param {string} content - Soul file content with {variable} placeholders
   * @param {Object<string, string>} [variables={}] - Key-value pairs for replacement
   * @returns {string} - Content with variables replaced
   * @throws {SoulLoaderError} - If content is not a string
   */
  interpolateVariables(content, variables = {}) {
    if (typeof content !== 'string') {
      throw new SoulLoaderError('Soul content must be a string');
    }

    if (!variables || typeof variables !== 'object' || Array.isArray(variables)) {
      throw new SoulLoaderError('Variables must be a plain object');
    }

    // Pattern: {varName} - single braces, no nested braces
    // Does NOT match ${varName} (env var syntax) - the $ prefix prevents matching
    return content.replace(/\{([^{}]+)\}/g, (match, varName) => {
      const trimmed = varName.trim();
      return Object.prototype.hasOwnProperty.call(variables, trimmed)
        ? String(variables[trimmed])
        : match;
    });
  }

  /**
   * Load a soul file and interpolate variables in one step
   *
   * Convenience method that combines loadSoulFile() and interpolateVariables().
   *
   * @param {string} filePath - Path to the soul.md file
   * @param {Object<string, string>} [variables={}] - Variables to interpolate
   * @returns {Promise<string>} - Processed soul content
   * @throws {SoulLoaderError} - If file cannot be read or content is invalid
   */
  async load(filePath, variables = {}) {
    const content = await this.loadSoulFile(filePath);
    return this.interpolateVariables(content, variables);
  }
}

export default SoulLoader;
