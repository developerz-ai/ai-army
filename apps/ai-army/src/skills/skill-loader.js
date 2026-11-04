/**
 * SkillLoader - Load skill definitions from the filesystem
 *
 * Handles loading SKILL.md files and optional tools.js modules from
 * skill directories. Each skill directory should contain at minimum
 * a SKILL.md file with YAML frontmatter (name, description) and
 * Markdown instructions.
 *
 * Supports:
 * - Loading a single skill from a directory path
 * - Scanning a parent directory for all skill subdirectories
 * - Loading optional tools.js via dynamic import()
 * - Validating loaded skill objects
 *
 * @module skills/skill-loader
 */

import fs from 'fs/promises';
import path from 'path';
import { SkillParser, SkillParserError } from './skill-parser.js';

/**
 * Custom error for skill loading failures
 */
export class SkillLoaderError extends Error {
  /**
   * Create a SkillLoaderError
   * @param {string} message - Error message
   * @param {Object} [options] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - The operation that failed
   * @param {string} [options.skillPath] - Path to the skill directory
   * @param {string} [options.skillName] - Skill name involved
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'SkillLoaderError';
    this.operation = options.operation;
    this.skillPath = options.skillPath;
    this.skillName = options.skillName;
  }
}

/**
 * Loaded skill object
 * @typedef {Object} LoadedSkill
 * @property {string} name - Skill name from frontmatter
 * @property {string} description - Skill description from frontmatter
 * @property {string} instructions - Markdown instruction body
 * @property {string} path - Absolute path to the skill directory
 * @property {Object<string, Object>|null} tools - Exported tools from tools.js, or null
 */

/**
 * Skill validation result
 * @typedef {Object} SkillValidationResult
 * @property {boolean} valid - Whether the skill is valid
 * @property {string[]} errors - List of validation error messages
 */

/**
 * Loader for skill directories containing SKILL.md and optional tools.js
 *
 * @example
 * const loader = new SkillLoader();
 *
 * // Load a single skill
 * const skill = await loader.loadSkill('./skills/code-review');
 * // { name: 'code-review', description: '...', instructions: '...', path: '...', tools: null }
 *
 * // Load all skills from a directory
 * const skills = await loader.loadFromDirectory('./skills');
 * // [{ name: 'code-review', ... }, { name: 'deploy', ... }]
 */
export class SkillLoader {
  /**
   * Create a new SkillLoader instance
   *
   * @param {Object} [options={}] - Loader options
   * @param {SkillParser} [options.parser] - SkillParser instance (created if not provided)
   */
  constructor(options = {}) {
    /** @type {SkillParser} */
    this.parser = options.parser || new SkillParser();
  }

  /**
   * Load a skill from a directory path
   *
   * Reads the SKILL.md file, parses frontmatter and instructions,
   * and optionally loads tools.js if present.
   *
   * @param {string} skillPath - Path to the skill directory
   * @returns {Promise<LoadedSkill>} Loaded skill object
   * @throws {SkillLoaderError} If the skill directory or SKILL.md cannot be read
   */
  async loadSkill(skillPath) {
    if (!skillPath || typeof skillPath !== 'string') {
      throw new SkillLoaderError('Skill path must be a non-empty string', {
        operation: 'loadSkill',
      });
    }

    const resolved = path.resolve(skillPath);

    // Verify the directory exists
    await this._verifyDirectory(resolved);

    // Read and parse SKILL.md
    const skillMdPath = path.join(resolved, 'SKILL.md');
    const content = await this._readSkillFile(skillMdPath, resolved);
    const parsed = this._parseSkillContent(content, skillMdPath, resolved);

    // Load optional tools.js
    const tools = await this._loadTools(resolved);

    return {
      name: parsed.name,
      description: parsed.description,
      instructions: parsed.instructions,
      path: resolved,
      tools,
    };
  }

  /**
   * Load all skills from a parent directory
   *
   * Scans the directory for subdirectories containing SKILL.md files
   * and loads each one. Subdirectories without SKILL.md are silently skipped.
   *
   * @param {string} dir - Path to the parent skills directory
   * @returns {Promise<LoadedSkill[]>} Array of loaded skill objects
   * @throws {SkillLoaderError} If the directory cannot be read
   */
  async loadFromDirectory(dir) {
    if (!dir || typeof dir !== 'string') {
      throw new SkillLoaderError('Directory path must be a non-empty string', {
        operation: 'loadFromDirectory',
      });
    }

    const resolved = path.resolve(dir);

    let entries;
    try {
      entries = await fs.readdir(resolved, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') {
        throw new SkillLoaderError(`Skills directory not found: ${resolved}`, {
          cause: err,
          operation: 'loadFromDirectory',
          skillPath: resolved,
        });
      }

      throw new SkillLoaderError(`Failed to read skills directory: ${resolved}`, {
        cause: err,
        operation: 'loadFromDirectory',
        skillPath: resolved,
      });
    }

    const skills = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const skillDir = path.join(resolved, entry.name);
      const skillMdPath = path.join(skillDir, 'SKILL.md');

      // Check if SKILL.md exists in this subdirectory
      const hasSkillMd = await this._fileExists(skillMdPath);
      if (!hasSkillMd) {
        continue;
      }

      try {
        const skill = await this.loadSkill(skillDir);
        skills.push(skill);
      } catch (err) {
        // Re-throw with context about which skill failed
        throw new SkillLoaderError(`Failed to load skill from "${entry.name}": ${err.message}`, {
          cause: err,
          operation: 'loadFromDirectory',
          skillPath: skillDir,
          skillName: entry.name,
        });
      }
    }

    return skills;
  }

  /**
   * Validate a loaded skill object
   *
   * Checks that the skill has all required fields with correct types.
   *
   * @param {LoadedSkill} skill - Skill object to validate
   * @returns {SkillValidationResult} Validation result with errors array
   */
  validateSkill(skill) {
    const errors = [];

    if (!skill || typeof skill !== 'object' || Array.isArray(skill)) {
      return { valid: false, errors: ['Skill must be a plain object'] };
    }

    if (!skill.name || typeof skill.name !== 'string') {
      errors.push('Skill must have a non-empty string "name"');
    }

    if (!skill.description || typeof skill.description !== 'string') {
      errors.push('Skill must have a non-empty string "description"');
    }

    if (typeof skill.instructions !== 'string') {
      errors.push('Skill must have a string "instructions" field');
    }

    if (!skill.path || typeof skill.path !== 'string') {
      errors.push('Skill must have a non-empty string "path"');
    }

    if (skill.tools !== null && typeof skill.tools !== 'object') {
      errors.push('Skill "tools" must be an object or null');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Verify that a path points to a valid directory
   *
   * @param {string} dirPath - Absolute directory path
   * @throws {SkillLoaderError} If the path is not a directory
   * @private
   */
  async _verifyDirectory(dirPath) {
    try {
      const stat = await fs.stat(dirPath);
      if (!stat.isDirectory()) {
        throw new SkillLoaderError(`Skill path is not a directory: ${dirPath}`, {
          operation: 'loadSkill',
          skillPath: dirPath,
        });
      }
    } catch (err) {
      if (err instanceof SkillLoaderError) {
        throw err;
      }

      if (err.code === 'ENOENT') {
        throw new SkillLoaderError(`Skill directory not found: ${dirPath}`, {
          cause: err,
          operation: 'loadSkill',
          skillPath: dirPath,
        });
      }

      throw new SkillLoaderError(`Failed to access skill directory: ${dirPath}`, {
        cause: err,
        operation: 'loadSkill',
        skillPath: dirPath,
      });
    }
  }

  /**
   * Read the SKILL.md file content
   *
   * @param {string} filePath - Absolute path to SKILL.md
   * @param {string} skillDir - Skill directory path (for error context)
   * @returns {Promise<string>} File content
   * @throws {SkillLoaderError} If the file cannot be read
   * @private
   */
  async _readSkillFile(filePath, skillDir) {
    try {
      return await fs.readFile(filePath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') {
        throw new SkillLoaderError(`SKILL.md not found in skill directory: ${skillDir}`, {
          cause: err,
          operation: 'loadSkill',
          skillPath: skillDir,
        });
      }

      throw new SkillLoaderError(`Failed to read SKILL.md: ${filePath}`, {
        cause: err,
        operation: 'loadSkill',
        skillPath: skillDir,
      });
    }
  }

  /**
   * Parse SKILL.md content using SkillParser
   *
   * @param {string} content - Raw SKILL.md content
   * @param {string} filePath - Path to SKILL.md (for error context)
   * @param {string} skillDir - Skill directory path (for error context)
   * @returns {import('./skill-parser.js').ParsedSkill} Parsed skill data
   * @throws {SkillLoaderError} If parsing fails
   * @private
   */
  _parseSkillContent(content, filePath, skillDir) {
    try {
      return this.parser.parse(content, filePath);
    } catch (err) {
      if (err instanceof SkillParserError) {
        throw new SkillLoaderError(`Failed to parse SKILL.md in ${skillDir}: ${err.message}`, {
          cause: err,
          operation: 'loadSkill',
          skillPath: skillDir,
        });
      }

      throw err;
    }
  }

  /**
   * Load optional tools.js from the skill directory
   *
   * Uses dynamic import() to load the tools module. Returns null
   * if tools.js does not exist in the skill directory.
   *
   * @param {string} skillDir - Absolute path to the skill directory
   * @returns {Promise<Object<string, Object>|null>} Tool exports or null
   * @private
   */
  async _loadTools(skillDir) {
    const toolsPath = path.join(skillDir, 'tools.js');

    const exists = await this._fileExists(toolsPath);
    if (!exists) {
      return null;
    }

    try {
      // Use file:// URL for dynamic import compatibility
      const toolsUrl = new URL(`file://${toolsPath}`);
      const toolsModule = await import(toolsUrl.href);

      // Return all named exports (excluding default if present)
      const tools = {};
      for (const [key, value] of Object.entries(toolsModule)) {
        if (key !== 'default') {
          tools[key] = value;
        }
      }

      return Object.keys(tools).length > 0 ? tools : null;
    } catch (err) {
      throw new SkillLoaderError(`Failed to load tools.js from skill directory: ${skillDir}`, {
        cause: err,
        operation: 'loadSkill',
        skillPath: skillDir,
      });
    }
  }

  /**
   * Check if a file exists
   *
   * @param {string} filePath - Absolute file path
   * @returns {Promise<boolean>} True if the file exists
   * @private
   */
  async _fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
