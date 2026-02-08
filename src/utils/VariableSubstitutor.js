/**
 * VariableSubstitutor - Template variable replacement engine
 *
 * Replaces `{{varName}}` placeholders in text and configuration objects.
 * Used by TemplateManager to apply per-instance variables to soul templates
 * and config strings.
 *
 * This uses double-brace syntax `{{varName}}` which is distinct from:
 * - SoulLoader's single-brace `{varName}` syntax
 * - Environment variable `${ENV_VAR}` syntax in config files
 *
 * @module utils/VariableSubstitutor
 */

/**
 * Custom error for variable substitution failures
 */
export class VariableSubstitutorError extends Error {
  /**
   * Create a VariableSubstitutorError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - The operation that failed
   * @param {string} [options.variableName] - Variable name involved
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'VariableSubstitutorError';
    this.operation = options.operation;
    this.variableName = options.variableName;
  }
}

/**
 * Pattern matching `{{varName}}` placeholders.
 * Captures the variable name between double braces.
 * Does not match nested braces or `${VAR}` env var syntax.
 * @type {RegExp}
 */
const VARIABLE_PATTERN = /\{\{(\w+)\}\}/g;

/**
 * Variable substitution engine for template placeholders
 */
export class VariableSubstitutor {
  /**
   * Replace `{{varName}}` placeholders in a string with variable values
   *
   * Unknown variables (not present in the variables object) are left unchanged.
   *
   * @param {string} text - Text containing `{{varName}}` placeholders
   * @param {Object<string, string>} [variables={}] - Key-value pairs for replacement
   * @returns {string} Text with variables replaced
   * @throws {VariableSubstitutorError} If text is not a string or variables is invalid
   */
  substitute(text, variables = {}) {
    if (typeof text !== 'string') {
      throw new VariableSubstitutorError('Text must be a string', {
        operation: 'substitute',
      });
    }

    if (!variables || typeof variables !== 'object' || Array.isArray(variables)) {
      throw new VariableSubstitutorError('Variables must be a plain object', {
        operation: 'substitute',
      });
    }

    return text.replace(VARIABLE_PATTERN, (match, varName) => {
      const trimmed = varName.trim();
      if (!Object.prototype.hasOwnProperty.call(variables, trimmed)) {
        return match;
      }
      const value = variables[trimmed];
      // Treat null/undefined as "not provided" — leave placeholder unchanged
      if (value === null || value === undefined) {
        return match;
      }
      return String(value);
    });
  }

  /**
   * Recursively apply variable substitution to all string values in an object
   *
   * Traverses objects and arrays, replacing `{{varName}}` placeholders
   * in any string values found. Non-string values (numbers, booleans, null)
   * are passed through unchanged.
   *
   * @param {*} value - Value to process (string, object, array, or primitive)
   * @param {Object<string, string>} [variables={}] - Key-value pairs for replacement
   * @returns {*} Value with all string fields substituted
   * @throws {VariableSubstitutorError} If variables is invalid
   */
  substituteDeep(value, variables = {}) {
    if (!variables || typeof variables !== 'object' || Array.isArray(variables)) {
      throw new VariableSubstitutorError('Variables must be a plain object', {
        operation: 'substituteDeep',
      });
    }

    return this._substituteValue(value, variables);
  }

  /**
   * Extract all `{{varName}}` placeholder names from a string
   *
   * @param {string} text - Text to scan for placeholders
   * @returns {string[]} Array of unique variable names found
   * @throws {VariableSubstitutorError} If text is not a string
   */
  extractVariables(text) {
    if (typeof text !== 'string') {
      throw new VariableSubstitutorError('Text must be a string', {
        operation: 'extractVariables',
      });
    }

    const variables = new Set();
    let match;
    const pattern = new RegExp(VARIABLE_PATTERN.source, 'g');

    while ((match = pattern.exec(text)) !== null) {
      variables.add(match[1].trim());
    }

    return [...variables];
  }

  /**
   * Check if all required variables are provided
   *
   * Scans the text for `{{varName}}` placeholders and returns any
   * variable names that are not present in the provided variables object.
   *
   * @param {string} text - Text to check for required variables
   * @param {Object<string, string>} variables - Available variables
   * @returns {string[]} Array of missing variable names (empty if all provided)
   * @throws {VariableSubstitutorError} If text is not a string
   */
  getMissingVariables(text, variables = {}) {
    const required = this.extractVariables(text);
    return required.filter(name => !Object.prototype.hasOwnProperty.call(variables, name));
  }

  /**
   * Recursively substitute variables in a value
   *
   * @param {*} value - Value to process
   * @param {Object<string, string>} variables - Replacement variables
   * @returns {*} Processed value
   * @private
   */
  _substituteValue(value, variables) {
    if (typeof value === 'string') {
      return this.substitute(value, variables);
    }

    if (Array.isArray(value)) {
      return value.map(item => this._substituteValue(item, variables));
    }

    if (value !== null && typeof value === 'object') {
      const result = {};
      for (const [key, val] of Object.entries(value)) {
        result[key] = this._substituteValue(val, variables);
      }
      return result;
    }

    // Primitives (numbers, booleans, null, undefined) pass through unchanged
    return value;
  }
}
