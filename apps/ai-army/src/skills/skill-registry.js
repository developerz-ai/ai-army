/**
 * SkillRegistry - In-memory registry for loaded skills
 *
 * Stores loaded skills and manages bot-to-skill mappings.
 * Provides skill lookup by name, listing, and the ability
 * to attach skills to bots and retrieve merged skill instructions.
 *
 * Works with SkillLoader to register skills from the filesystem
 * and with SoulLoader to inject skill instructions into bot souls.
 *
 * @module skills/skill-registry
 */

/**
 * Custom error for skill registry failures
 */
export class SkillRegistryError extends Error {
  /**
   * Create a SkillRegistryError
   * @param {string} message - Error message
   * @param {Object} [options] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - The operation that failed
   * @param {string} [options.skillName] - Skill name involved
   * @param {string} [options.botId] - Bot ID involved
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'SkillRegistryError';
    this.operation = options.operation;
    this.skillName = options.skillName;
    this.botId = options.botId;
  }
}

/**
 * In-memory registry for managing skills and bot-skill attachments
 *
 * @example
 * const registry = new SkillRegistry();
 *
 * // Register skills
 * registry.registerSkill({ name: 'code-review', description: '...', instructions: '...', path: '...', tools: null });
 *
 * // Attach skills to a bot
 * registry.attachToBot('work-bot', ['code-review']);
 *
 * // Get merged instructions for a bot's skills
 * const instructions = registry.getSkillInstructions(['code-review']);
 */
export class SkillRegistry {
  /**
   * Create a SkillRegistry instance
   *
   * @param {Object} [options={}] - Registry options
   * @param {Function|null} [options.logger=null] - Logger function
   */
  constructor(options = {}) {
    /** @type {Map<string, import('./skill-loader.js').LoadedSkill>} Registered skills by name */
    this.skills = new Map();

    /** @type {Map<string, string[]>} Bot-to-skill-name mappings */
    this.botSkills = new Map();

    /** @type {Function|null} Logger function */
    this.logger = options.logger || null;
  }

  /**
   * Register a loaded skill in the registry
   *
   * If a skill with the same name already exists, it will be replaced.
   *
   * @param {import('./skill-loader.js').LoadedSkill} skill - Loaded skill object
   * @throws {SkillRegistryError} If skill is invalid
   */
  registerSkill(skill) {
    if (!skill || typeof skill !== 'object' || Array.isArray(skill)) {
      throw new SkillRegistryError('Skill must be a non-null object', {
        operation: 'registerSkill',
      });
    }

    if (!skill.name || typeof skill.name !== 'string') {
      throw new SkillRegistryError('Skill must have a non-empty string "name"', {
        operation: 'registerSkill',
      });
    }

    if (!skill.description || typeof skill.description !== 'string') {
      throw new SkillRegistryError('Skill must have a non-empty string "description"', {
        operation: 'registerSkill',
        skillName: skill.name,
      });
    }

    if (typeof skill.instructions !== 'string') {
      throw new SkillRegistryError('Skill must have a string "instructions" field', {
        operation: 'registerSkill',
        skillName: skill.name,
      });
    }

    const existed = this.skills.has(skill.name);
    this.skills.set(skill.name, skill);
    this._log(existed ? `🔄 Replaced skill: ${skill.name}` : `📝 Registered skill: ${skill.name}`);
  }

  /**
   * Get a skill by name
   *
   * @param {string} name - Skill name
   * @returns {import('./skill-loader.js').LoadedSkill|undefined} Skill object or undefined
   */
  getSkill(name) {
    return this.skills.get(name);
  }

  /**
   * List all registered skills
   *
   * @returns {import('./skill-loader.js').LoadedSkill[]} Array of all registered skills
   */
  listSkills() {
    return Array.from(this.skills.values());
  }

  /**
   * Attach skills to a bot by name
   *
   * Associates a list of skill names with a bot ID. Validates that all
   * referenced skill names exist in the registry. Replaces any existing
   * skill attachment for the bot.
   *
   * @param {string} botId - Bot identifier
   * @param {string[]} skillNames - Array of skill names to attach
   * @throws {SkillRegistryError} If botId is invalid, skillNames is invalid,
   *   or any skill name is not registered
   */
  attachToBot(botId, skillNames) {
    if (!botId || typeof botId !== 'string') {
      throw new SkillRegistryError('Bot ID must be a non-empty string', {
        operation: 'attachToBot',
      });
    }

    if (!Array.isArray(skillNames)) {
      throw new SkillRegistryError('Skill names must be an array', {
        operation: 'attachToBot',
        botId,
      });
    }

    // Validate all skill names exist before attaching
    const missing = skillNames.filter(name => !this.skills.has(name));
    if (missing.length > 0) {
      throw new SkillRegistryError(`Skills not found in registry: ${missing.join(', ')}`, {
        operation: 'attachToBot',
        botId,
        skillName: missing[0],
      });
    }

    this.botSkills.set(botId, [...skillNames]);
    this._log(
      `🔗 Attached ${skillNames.length} skill(s) to bot '${botId}': ${skillNames.join(', ')}`
    );
  }

  /**
   * Get skill names attached to a bot
   *
   * @param {string} botId - Bot identifier
   * @returns {string[]} Array of skill names (empty if none attached)
   */
  getAttachedSkills(botId) {
    return this.botSkills.get(botId) || [];
  }

  /**
   * Detach all skills from a bot
   *
   * @param {string} botId - Bot identifier
   * @returns {boolean} True if the bot had skills that were removed
   */
  detachFromBot(botId) {
    const had = this.botSkills.has(botId);
    this.botSkills.delete(botId);
    if (had) {
      this._log(`🔓 Detached skills from bot '${botId}'`);
    }
    return had;
  }

  /**
   * Get merged skill instructions for a list of skill names
   *
   * Retrieves the instructions from each named skill and joins them
   * with double newlines. Skips any skill names that are not found
   * in the registry (logs a warning instead of throwing).
   *
   * @param {string[]} skillNames - Array of skill names
   * @returns {string} Merged instruction text (empty string if no skills found)
   */
  getSkillInstructions(skillNames) {
    if (!Array.isArray(skillNames)) {
      return '';
    }

    const parts = [];

    for (const name of skillNames) {
      const skill = this.skills.get(name);
      if (!skill) {
        this._log(`⚠️ Skill '${name}' not found in registry, skipping instructions`);
        continue;
      }

      if (skill.instructions) {
        parts.push(skill.instructions);
      }
    }

    return parts.join('\n\n');
  }

  /**
   * Get collected tools from a list of skill names
   *
   * Merges all tool exports from the named skills into a single object.
   * If multiple skills export tools with the same key, later skills
   * take precedence.
   *
   * @param {string[]} skillNames - Array of skill names
   * @returns {Object} Merged tools object (empty object if no tools)
   */
  getSkillTools(skillNames) {
    if (!Array.isArray(skillNames)) {
      return {};
    }

    const merged = {};

    for (const name of skillNames) {
      const skill = this.skills.get(name);
      if (skill?.tools) {
        Object.assign(merged, skill.tools);
      }
    }

    return merged;
  }

  /**
   * Check if a skill is registered
   *
   * @param {string} name - Skill name
   * @returns {boolean} True if the skill exists in the registry
   */
  hasSkill(name) {
    return this.skills.has(name);
  }

  /**
   * Get the count of registered skills
   *
   * @returns {number} Number of registered skills
   */
  getSkillCount() {
    return this.skills.size;
  }

  /**
   * Remove a skill from the registry
   *
   * Also removes the skill from all bot attachments.
   *
   * @param {string} name - Skill name to remove
   * @returns {boolean} True if the skill was removed
   */
  removeSkill(name) {
    const removed = this.skills.delete(name);

    if (removed) {
      // Remove from all bot attachments
      for (const [botId, skills] of this.botSkills) {
        const filtered = skills.filter(s => s !== name);
        if (filtered.length !== skills.length) {
          if (filtered.length === 0) {
            this.botSkills.delete(botId);
          } else {
            this.botSkills.set(botId, filtered);
          }
        }
      }
      this._log(`🗑️ Removed skill: ${name}`);
    }

    return removed;
  }

  /**
   * Clear all registered skills and bot attachments
   */
  clear() {
    this.skills.clear();
    this.botSkills.clear();
    this._log('🧹 Cleared all skills and bot attachments');
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
