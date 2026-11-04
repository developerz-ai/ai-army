/**
 * Logger - Structured logging factory for production and development
 *
 * Provides a factory function that creates a logger appropriate for the
 * current environment:
 * - **Development** (`NODE_ENV !== 'production'`): human-readable console output
 *   with timestamps and level prefixes
 * - **Production** (`NODE_ENV === 'production'`): JSON Lines format with
 *   structured fields `{ timestamp, level, message, component }`
 *
 * The returned logger exposes `.info()`, `.warn()`, `.error()`, and `.debug()`
 * methods, plus a callable function interface for backward compatibility with
 * code that expects `logger(message)` (delegates to `.info()`).
 *
 * @module utils/logger
 */

/**
 * Custom error for logger configuration failures
 */
export class LoggerError extends Error {
  /**
   * Create a LoggerError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - The operation that failed
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'LoggerError';
    this.operation = options.operation;
  }
}

/**
 * Log levels ordered by severity.
 * Lower index = more severe. Used to filter messages by minimum level.
 * @type {string[]}
 */
const LOG_LEVELS = ['error', 'warn', 'info', 'debug'];

/**
 * Default level prefixes for human-readable (dev) output
 * @type {Object<string, string>}
 */
const LEVEL_PREFIXES = {
  error: 'ERROR',
  warn: 'WARN',
  info: 'INFO',
  debug: 'DEBUG',
};

/**
 * Format a log entry as a human-readable string for development
 *
 * @param {string} level - Log level
 * @param {string} message - Log message
 * @param {string} [component] - Optional component name
 * @returns {string} Formatted log line
 * @private
 */
function formatDev(level, message, component) {
  const timestamp = new Date().toISOString();
  const prefix = LEVEL_PREFIXES[level] || level.toUpperCase();
  const comp = component ? ` [${component}]` : '';
  return `${timestamp} ${prefix}${comp} ${message}`;
}

/**
 * Format a log entry as a JSON line for production
 *
 * @param {string} level - Log level
 * @param {string} message - Log message
 * @param {string} [component] - Optional component name
 * @returns {string} JSON-stringified log line
 * @private
 */
function formatJson(level, message, component) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };
  if (component) {
    entry.component = component;
  }
  return JSON.stringify(entry);
}

/**
 * Resolve the effective minimum log level index.
 *
 * @param {string} minLevel - Minimum level name
 * @returns {number} Index into LOG_LEVELS (0 = error only, 3 = all)
 * @private
 */
function resolveLevelIndex(minLevel) {
  const idx = LOG_LEVELS.indexOf(minLevel);
  return idx === -1 ? LOG_LEVELS.indexOf('info') : idx;
}

/**
 * Create a structured logger instance
 *
 * Returns a callable function that also exposes `.info()`, `.warn()`,
 * `.error()`, and `.debug()` methods. Calling the function directly
 * delegates to `.info()` for backward compatibility with code that
 * uses `logger(message)`.
 *
 * @param {Object} [options={}] - Logger configuration
 * @param {string} [options.component] - Component name included in every log entry
 * @param {string} [options.level='info'] - Minimum log level: 'error' | 'warn' | 'info' | 'debug'
 * @param {boolean} [options.json] - Force JSON output (defaults to `true` when `NODE_ENV=production`)
 * @param {Function} [options.writer] - Output function for all levels (overrides both stdout and stderr defaults)
 * @param {Function} [options.errorWriter] - Output function for error/warn levels (defaults to `console.error`; ignored when `writer` is set)
 * @returns {Function & { info: Function, warn: Function, error: Function, debug: Function }}
 *
 * @example
 * // Development usage (human-readable output)
 * const logger = createLogger({ component: 'Orchestrator' });
 * logger('Starting up...');
 * // => 2025-01-15T10:30:00.000Z INFO [Orchestrator] Starting up...
 *
 * @example
 * // Production usage (JSON Lines output)
 * const logger = createLogger({ component: 'Orchestrator', json: true });
 * logger.error('Connection failed');
 * // => {"timestamp":"2025-01-15T10:30:00.000Z","level":"error","message":"Connection failed","component":"Orchestrator"}
 */
export function createLogger(options = {}) {
  const { component } = options;
  const useJson = options.json !== undefined ? options.json : process.env.NODE_ENV === 'production';
  const minLevelIndex = resolveLevelIndex(options.level || 'info');
  const format = useJson ? formatJson : formatDev;

  // Resolve writer functions — when a single `writer` is provided it handles
  // every level; otherwise fall back to console.log / console.error (or an
  // explicit `errorWriter` for warn+error output).
  const stdWriter = options.writer || console.log;
  const errWriter = options.writer || options.errorWriter || console.error;

  /**
   * Emit a log entry if the level meets the minimum threshold
   * @param {string} level - Log level
   * @param {string} message - Log message
   * @private
   */
  function emit(level, message) {
    const levelIndex = LOG_LEVELS.indexOf(level);
    if (levelIndex === -1 || levelIndex > minLevelIndex) {
      return;
    }
    const line = format(level, message, component);
    const writer = level === 'error' || level === 'warn' ? errWriter : stdWriter;
    writer(line);
  }

  // Create a callable function that delegates to info()
  const logger = msg => emit('info', msg);

  /** @param {string} message */
  logger.info = msg => emit('info', msg);

  /** @param {string} message */
  logger.warn = msg => emit('warn', msg);

  /** @param {string} message */
  logger.error = msg => emit('error', msg);

  /** @param {string} message */
  logger.debug = msg => emit('debug', msg);

  return logger;
}

export default createLogger;
