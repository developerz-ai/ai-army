/**
 * ErrorHandler - Centralized error handling with classification and secret redaction
 *
 * Handles:
 * - Logging errors to stdout and optionally to database
 * - Classifying errors by type (config, runtime, network, docker, database)
 * - Redacting API keys and secrets from error messages
 *
 * @module utils/ErrorHandler
 */

/**
 * Custom error for error handler failures
 */
export class ErrorHandlerError extends Error {
  /**
   * Create an ErrorHandlerError
   * @param {string} message - Error message
   * @param {Object} [options] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - The operation that failed
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'ErrorHandlerError';
    this.operation = options.operation;
  }
}

/**
 * Patterns for detecting and redacting secrets in error messages.
 * Each entry maps a regex pattern to its redaction label.
 *
 * @type {Array<{pattern: RegExp, label: string}>}
 */
const REDACT_PATTERNS = [
  { pattern: /sk-ant-[a-zA-Z0-9-]+/g, label: '[REDACTED_ANTHROPIC_KEY]' },
  { pattern: /sk-or-[a-zA-Z0-9-]+/g, label: '[REDACTED_OPENROUTER_KEY]' },
  { pattern: /sk-[a-zA-Z0-9]{20,}/g, label: '[REDACTED_OPENAI_KEY]' },
  { pattern: /xoxb-[a-zA-Z0-9-]+/g, label: '[REDACTED_SLACK_BOT_TOKEN]' },
  { pattern: /xapp-[a-zA-Z0-9-]+/g, label: '[REDACTED_SLACK_APP_TOKEN]' },
  { pattern: /xoxp-[a-zA-Z0-9-]+/g, label: '[REDACTED_SLACK_USER_TOKEN]' },
  { pattern: /ghp_[a-zA-Z0-9]+/g, label: '[REDACTED_GITHUB_TOKEN]' },
  { pattern: /gho_[a-zA-Z0-9]+/g, label: '[REDACTED_GITHUB_OAUTH_TOKEN]' },
  { pattern: /ghs_[a-zA-Z0-9]+/g, label: '[REDACTED_GITHUB_SERVER_TOKEN]' },
];

/**
 * Mapping of error class names to error categories.
 * Used by classifyError() to determine the error type.
 *
 * @type {Object<string, string>}
 */
const ERROR_CLASS_MAP = {
  // Config errors
  ConfigValidationError: 'config',
  ConfigError: 'config',

  // Docker / execution errors
  DockerError: 'docker',
  ContainerPoolError: 'docker',
  ToolExecutionError: 'docker',
  DangerousCommandError: 'docker',

  // Database errors
  StorageError: 'database',
  MigrationError: 'database',
  SessionError: 'database',

  // Network / channel errors
  SlackAdapterError: 'network',
  DiscordAdapterError: 'network',
  ChannelManagerError: 'network',
};

/**
 * Keywords in error messages that hint at the error category.
 * Checked in order; first match wins.
 *
 * @type {Array<{keywords: string[], category: string}>}
 */
const ERROR_MESSAGE_HINTS = [
  {
    keywords: ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'socket', 'network'],
    category: 'network',
  },
  { keywords: ['docker', 'container', 'image'], category: 'docker' },
  { keywords: ['database', 'postgres', 'sql', 'query', 'connection pool'], category: 'database' },
  {
    keywords: [
      'config',
      'configuration',
      'validation failed',
      'invalid config',
      'schema validation',
    ],
    category: 'config',
  },
];

/**
 * ErrorHandler - Centralized error logging, classification, and secret redaction
 *
 * @example
 * const handler = new ErrorHandler(storage, { logger: console.error });
 * handler.logError(new Error('API call failed with key sk-ant-abc123'), {
 *   botId: 'support',
 *   operation: 'processMessage',
 * });
 * // Logs: "API call failed with key [REDACTED_ANTHROPIC_KEY]"
 *
 * @example
 * const category = handler.classifyError(new DockerError('Container crashed'));
 * // Returns: 'docker'
 *
 * @example
 * const safe = handler.redactSecrets('Token: xoxb-1234-abcd');
 * // Returns: 'Token: [REDACTED_SLACK_BOT_TOKEN]'
 */
export class ErrorHandler {
  /**
   * Create an ErrorHandler instance
   *
   * @param {Object} [storage=null] - Storage adapter for database logging (must have query())
   * @param {Object} [options={}] - Configuration options
   * @param {Function} [options.logger=null] - Logger function for stdout output
   */
  constructor(storage = null, options = {}) {
    this.storage = storage;
    this.logger = options.logger || null;
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Log an error to stdout and optionally to the database
   *
   * Redacts secrets from the error message and stack trace before logging.
   * If storage is available, attempts to insert the error record into the
   * database. Database failures are logged but do not throw.
   *
   * @param {Error} error - The error to log
   * @param {Object} [context={}] - Additional context for the error
   * @param {string} [context.botId] - Bot that encountered the error
   * @param {string} [context.operation] - Operation that failed
   * @param {string} [context.sessionId] - Session context
   * @returns {Promise<void>}
   */
  async logError(error, context = {}) {
    if (!error || !(error instanceof Error)) {
      this._log('[ErrorHandler] logError called with non-Error value');
      return;
    }

    const category = this.classifyError(error);
    const redactedMessage = this.redactSecrets(error.message || '');
    const redactedStack = error.stack ? this.redactSecrets(error.stack) : undefined;

    // Build structured log entry
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: 'error',
      category,
      error: {
        name: error.name || 'Error',
        message: redactedMessage,
        stack: redactedStack,
      },
      ...context,
    };

    // Log to stdout via logger
    this._log(`[${category}] ${error.name}: ${redactedMessage}`);

    // Log to database if storage is available
    if (this.storage) {
      try {
        await this.storage.query(
          `INSERT INTO error_logs (category, error_name, message, stack, context, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [
            category,
            error.name || 'Error',
            redactedMessage,
            redactedStack || null,
            JSON.stringify(context),
          ]
        );
      } catch (dbErr) {
        // Database logging should never prevent error handling
        this._log(`[ErrorHandler] Failed to log error to database: ${dbErr.message}`);
      }
    }

    return logEntry;
  }

  /**
   * Classify an error into a category
   *
   * Classification strategy (in priority order):
   * 1. Match error class name against known error classes
   * 2. Match error message against keyword patterns
   * 3. Default to 'runtime'
   *
   * @param {Error} error - The error to classify
   * @returns {string} Category: 'config' | 'runtime' | 'network' | 'docker' | 'database'
   */
  classifyError(error) {
    if (!error || !(error instanceof Error)) {
      return 'runtime';
    }

    // Strategy 1: Match by error class name
    const className = error.name || error.constructor?.name;
    if (className && ERROR_CLASS_MAP[className]) {
      return ERROR_CLASS_MAP[className];
    }

    // Strategy 2: Match by error message keywords
    const messageLower = (error.message || '').toLowerCase();
    for (const { keywords, category } of ERROR_MESSAGE_HINTS) {
      for (const keyword of keywords) {
        if (messageLower.includes(keyword.toLowerCase())) {
          return category;
        }
      }
    }

    // Strategy 3: Check cause chain
    if (error.cause && error.cause instanceof Error) {
      const causeCategory = this.classifyError(error.cause);
      if (causeCategory !== 'runtime') {
        return causeCategory;
      }
    }

    // Default
    return 'runtime';
  }

  /**
   * Redact secrets and API keys from a text string
   *
   * Replaces known secret patterns (API keys, tokens) with labeled
   * redaction markers. Safe to call on any string.
   *
   * @param {string} text - Text that may contain secrets
   * @returns {string} Text with secrets replaced by redaction markers
   */
  redactSecrets(text) {
    if (typeof text !== 'string') {
      return '';
    }

    let result = text;
    for (const { pattern, label } of REDACT_PATTERNS) {
      // Reset lastIndex for global regex patterns
      pattern.lastIndex = 0;
      result = result.replace(pattern, label);
    }
    return result;
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

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

export default ErrorHandler;
