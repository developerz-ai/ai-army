/**
 * SkillParser - Parse SKILL.md files with YAML frontmatter
 *
 * Handles parsing SKILL.md files that contain YAML frontmatter
 * (delimited by `---`) and a Markdown instruction body. Extracts
 * structured metadata (name, description) from the frontmatter
 * and the raw instruction content from the body.
 *
 * Uses manual regex-based frontmatter parsing to avoid adding
 * the gray-matter dependency.
 *
 * @module skills/skill-parser
 */

/**
 * Custom error for skill parsing failures
 */
export class SkillParserError extends Error {
  /**
   * Create a SkillParserError
   * @param {string} message - Error message
   * @param {Object} [options] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.filePath] - Path to the SKILL.md file
   * @param {string} [options.field] - Frontmatter field that caused the issue
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'SkillParserError';
    this.filePath = options.filePath;
    this.field = options.field;
  }
}

/**
 * Parsed skill result
 * @typedef {Object} ParsedSkill
 * @property {string} name - Skill name from frontmatter
 * @property {string} description - Skill description from frontmatter
 * @property {string} instructions - Markdown instruction body (after frontmatter)
 */

/**
 * Parser for SKILL.md files with YAML frontmatter
 *
 * @example
 * const parser = new SkillParser();
 * const result = parser.parse(`---
 * name: code-review
 * description: Review code for quality
 * ---
 *
 * # Code Review Instructions
 * When reviewing code...
 * `);
 * // result = { name: 'code-review', description: 'Review code for quality', instructions: '...' }
 */
export class SkillParser {
  /**
   * Parse a SKILL.md file content string
   *
   * Extracts YAML frontmatter (name, description) and the Markdown
   * instruction body from a SKILL.md file's raw content.
   *
   * @param {string} content - Raw SKILL.md file content
   * @param {string} [filePath] - Optional file path for error context
   * @returns {ParsedSkill} Parsed skill with name, description, and instructions
   * @throws {SkillParserError} If content is invalid or frontmatter is malformed
   */
  parse(content, filePath) {
    if (typeof content !== 'string') {
      throw new SkillParserError('Skill content must be a string', { filePath });
    }

    if (!content.trim()) {
      throw new SkillParserError('Skill content must not be empty', { filePath });
    }

    const { frontmatter, body } = this._extractFrontmatter(content, filePath);
    const metadata = this._parseFrontmatter(frontmatter, filePath);

    return {
      name: metadata.name,
      description: metadata.description,
      instructions: body.trim(),
    };
  }

  /**
   * Extract frontmatter and body from raw content
   *
   * Splits the content at `---` delimiters to separate the YAML
   * frontmatter block from the Markdown body.
   *
   * @param {string} content - Raw file content
   * @param {string} [filePath] - Optional file path for error context
   * @returns {{ frontmatter: string, body: string }} Separated frontmatter and body
   * @throws {SkillParserError} If frontmatter delimiters are not found
   * @private
   */
  _extractFrontmatter(content, filePath) {
    // Match frontmatter block: starts with --- on its own line,
    // followed by content, ended by --- on its own line
    const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/;
    const match = content.match(frontmatterRegex);

    if (!match) {
      throw new SkillParserError(
        'SKILL.md must contain YAML frontmatter delimited by --- markers',
        { filePath }
      );
    }

    const frontmatter = match[1];
    const body = content.slice(match[0].length);

    return { frontmatter, body };
  }

  /**
   * Parse YAML frontmatter string into metadata object
   *
   * Supports simple key-value YAML syntax (`key: value`). Does not
   * support nested objects, arrays, or multi-line values — only the
   * flat fields needed for skill metadata.
   *
   * @param {string} frontmatter - Raw YAML frontmatter string
   * @param {string} [filePath] - Optional file path for error context
   * @returns {{ name: string, description: string }} Parsed metadata
   * @throws {SkillParserError} If required fields are missing
   * @private
   */
  _parseFrontmatter(frontmatter, filePath) {
    const metadata = {};

    const lines = frontmatter.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      // Match simple key: value pairs
      const kvMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/);
      if (kvMatch) {
        const key = kvMatch[1];
        let value = kvMatch[2].trim();

        // Strip surrounding quotes if present
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }

        metadata[key] = value;
      }
    }

    // Validate required fields
    if (!metadata.name || typeof metadata.name !== 'string' || !metadata.name.trim()) {
      throw new SkillParserError('SKILL.md frontmatter must include a "name" field', {
        filePath,
        field: 'name',
      });
    }

    if (
      !metadata.description ||
      typeof metadata.description !== 'string' ||
      !metadata.description.trim()
    ) {
      throw new SkillParserError('SKILL.md frontmatter must include a "description" field', {
        filePath,
        field: 'description',
      });
    }

    return {
      name: metadata.name.trim(),
      description: metadata.description.trim(),
    };
  }
}
