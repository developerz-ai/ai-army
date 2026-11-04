/**
 * ReferenceParser - Parses secret reference patterns in configuration values
 *
 * Handles multiple reference formats:
 * - ${VAR} - Environment variable (plain, no adapter prefix)
 * - ${VAR:-default} - Environment variable with default value
 * - ${VAR:+value} - Environment variable with conditional value
 * - ${bw:vault/item} - Bitwarden secret reference
 * - ${1p:vault/item} - 1Password secret reference
 *
 * @module ReferenceParser
 */

/**
 * Custom error for reference parsing failures
 */
export class ReferenceParserError extends Error {
  /**
   * Create a ReferenceParserError
   * @param {string} message - Error message
   * @param {Object} [options] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.reference] - The raw reference string that failed to parse
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'ReferenceParserError';
    this.reference = options.reference;
  }
}

/**
 * Supported adapter prefixes for secret references
 * @type {Readonly<Object.<string, string>>}
 */
const ADAPTER_PREFIXES = Object.freeze({
  bw: 'bitwarden',
  '1p': 'onepassword',
});

/**
 * Parsed secret reference
 * @typedef {Object} ParsedReference
 * @property {string} raw - The original raw reference string (e.g., '${bw:vault/item}')
 * @property {string} adapter - The adapter name ('env', 'bitwarden', 'onepassword')
 * @property {string} key - The key to resolve (variable name or path)
 * @property {string|undefined} defaultValue - Default value for env refs with :- operator
 * @property {string|undefined} conditionalValue - Conditional value for env refs with :+ operator
 */

/**
 * ReferenceParser class for parsing secret reference patterns
 *
 * Extracts and parses `${...}` patterns from strings, identifying
 * the adapter type and key for each secret reference. Handles
 * environment variable syntax and adapter-prefixed references.
 */
export class ReferenceParser {
  /**
   * Regex pattern to match all ${...} references in a string.
   * Captures the inner content between ${ and }.
   * @type {RegExp}
   * @private
   */
  static REFERENCE_PATTERN = /\$\{([^}]+)\}/g;

  /**
   * Regex to identify adapter-prefixed references like bw:path or 1p:path.
   * Group 1: adapter prefix (bw, 1p)
   * Group 2: the key/path after the colon
   * @type {RegExp}
   * @private
   */
  static ADAPTER_PREFIX_PATTERN = /^(bw|1p):(.+)$/;

  /**
   * Regex to identify env variable with default value: VAR:-default
   * Group 1: variable name
   * Group 2: default value
   * @type {RegExp}
   * @private
   */
  static ENV_DEFAULT_PATTERN = /^([^:]+):-(.*)$/;

  /**
   * Regex to identify env variable with conditional value: VAR:+value
   * Group 1: variable name
   * Group 2: conditional value
   * @type {RegExp}
   * @private
   */
  static ENV_CONDITIONAL_PATTERN = /^([^:]+):\+(.*)$/;

  /**
   * Parse a single reference expression (the content inside ${...})
   *
   * @param {string} expression - The inner content of a ${...} reference
   * @returns {ParsedReference} Parsed reference object
   * @throws {ReferenceParserError} If the expression is empty or invalid
   */
  parse(expression) {
    if (!expression || typeof expression !== 'string') {
      throw new ReferenceParserError('Reference expression must be a non-empty string', {
        reference: expression,
      });
    }

    const trimmed = expression.trim();

    if (trimmed.length === 0) {
      throw new ReferenceParserError('Reference expression must be a non-empty string', {
        reference: expression,
      });
    }

    // Check for adapter-prefixed references: bw:path or 1p:path
    const adapterMatch = trimmed.match(ReferenceParser.ADAPTER_PREFIX_PATTERN);
    if (adapterMatch) {
      const [, prefix, key] = adapterMatch;
      const adapter = ADAPTER_PREFIXES[prefix];

      if (!key || key.trim().length === 0) {
        throw new ReferenceParserError(`Adapter reference '${prefix}:' is missing a key/path`, {
          reference: `\${${expression}}`,
        });
      }

      return {
        raw: `\${${expression}}`,
        adapter,
        key: key.trim(),
        defaultValue: undefined,
        conditionalValue: undefined,
      };
    }

    // Check for env variable with default: VAR:-default
    const defaultMatch = trimmed.match(ReferenceParser.ENV_DEFAULT_PATTERN);
    if (defaultMatch) {
      const [, varName, defaultValue] = defaultMatch;
      return {
        raw: `\${${expression}}`,
        adapter: 'env',
        key: varName,
        defaultValue,
        conditionalValue: undefined,
      };
    }

    // Check for env variable with conditional: VAR:+value
    const conditionalMatch = trimmed.match(ReferenceParser.ENV_CONDITIONAL_PATTERN);
    if (conditionalMatch) {
      const [, varName, conditionalValue] = conditionalMatch;
      return {
        raw: `\${${expression}}`,
        adapter: 'env',
        key: varName,
        defaultValue: undefined,
        conditionalValue,
      };
    }

    // Plain environment variable reference: VAR
    return {
      raw: `\${${expression}}`,
      adapter: 'env',
      key: trimmed,
      defaultValue: undefined,
      conditionalValue: undefined,
    };
  }

  /**
   * Extract all ${...} references from a string
   *
   * Returns an array of parsed references found in the string.
   * Strings with no references return an empty array.
   *
   * @param {string} str - The string to scan for references
   * @returns {ParsedReference[]} Array of parsed references
   * @throws {ReferenceParserError} If any reference is malformed
   */
  extractReferences(str) {
    if (typeof str !== 'string') {
      return [];
    }

    const references = [];
    // Create a new RegExp each time to avoid shared lastIndex state
    const pattern = new RegExp(ReferenceParser.REFERENCE_PATTERN.source, 'g');
    let match;

    while ((match = pattern.exec(str)) !== null) {
      references.push(this.parse(match[1]));
    }

    return references;
  }

  /**
   * Check whether a string contains any ${...} references
   *
   * @param {string} str - The string to check
   * @returns {boolean} True if the string contains at least one reference
   */
  hasReferences(str) {
    if (typeof str !== 'string') {
      return false;
    }
    // Create a new RegExp to avoid shared lastIndex issues
    const pattern = new RegExp(ReferenceParser.REFERENCE_PATTERN.source);
    return pattern.test(str);
  }

  /**
   * Recursively extract all references from a config object
   *
   * Walks through objects, arrays, and strings to find every
   * ${...} reference in the configuration tree.
   *
   * @param {*} obj - Configuration value to scan (object, array, string, or primitive)
   * @returns {ParsedReference[]} Array of all parsed references found
   */
  extractAllReferences(obj) {
    if (typeof obj === 'string') {
      return this.extractReferences(obj);
    }

    if (Array.isArray(obj)) {
      return obj.flatMap(item => this.extractAllReferences(item));
    }

    if (obj !== null && typeof obj === 'object') {
      return Object.values(obj).flatMap(value => this.extractAllReferences(value));
    }

    return [];
  }

  /**
   * Get the set of known adapter prefixes
   *
   * @returns {Readonly<Object.<string, string>>} Map of prefix to adapter name
   */
  getAdapterPrefixes() {
    return ADAPTER_PREFIXES;
  }
}
