/**
 * RateLimiter - Sliding window rate limiter per client IP
 *
 * Tracks request timestamps in a sliding window to enforce
 * configurable request limits per time period. Designed to work
 * with the APIServer as middleware that checks incoming requests
 * before they reach route handlers.
 *
 * Features:
 * - Sliding window algorithm for smooth rate limiting
 * - Per-IP tracking with automatic cleanup of expired entries
 * - Configurable max requests and window duration
 * - Bypass list for trusted IPs (e.g., internal health checks)
 * - Returns standard 429 Too Many Requests with Retry-After header
 *
 * @module api/rate-limiter
 */

/**
 * Custom error for rate limiter failures
 */
export class RateLimiterError extends Error {
  /**
   * Create a RateLimiterError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error
   * @param {string} [options.ip] - Client IP that triggered the error
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'RateLimiterError';
    this.ip = options.ip;
  }
}

/**
 * RateLimiter - sliding window rate limiter per client IP
 *
 * @example
 * const limiter = new RateLimiter({ max: 100, windowMs: 60000 });
 * // In your HTTP server request handler:
 * if (limiter.isRateLimited(clientIp)) {
 *   limiter.sendLimited(res);
 *   return;
 * }
 * limiter.recordRequest(clientIp);
 */
export class RateLimiter {
  /**
   * Create a RateLimiter instance
   *
   * @param {Object} [options={}] - Configuration options
   * @param {number} [options.max=100] - Maximum number of requests per window
   * @param {number} [options.windowMs=60000] - Window duration in milliseconds
   * @param {string[]} [options.bypassIps=[]] - IPs to bypass rate limiting
   * @param {Function|null} [options.logger=null] - Logger function
   */
  constructor(options = {}) {
    const { max = 100, windowMs = 60000 } = options;

    if (typeof max !== 'number' || max < 1) {
      throw new RateLimiterError('max must be a positive number');
    }
    if (typeof windowMs !== 'number' || windowMs < 1) {
      throw new RateLimiterError('windowMs must be a positive number');
    }

    /** @type {number} Maximum requests per window */
    this.max = max;

    /** @type {number} Window duration in milliseconds */
    this.windowMs = windowMs;

    /** @type {Set<string>} IPs to bypass rate limiting */
    this.bypassIps = new Set(options.bypassIps || []);

    /** @type {Function|null} Logger function */
    this.logger = options.logger !== undefined ? options.logger : null;

    /**
     * Map of IP → array of request timestamps
     * @type {Map<string, number[]>}
     */
    this.requests = new Map();

    /** @type {NodeJS.Timeout|null} Cleanup timer */
    this._cleanupTimer = null;

    this._startCleanup();
  }

  /**
   * Check if a client IP is rate limited
   *
   * Removes expired timestamps from the window and checks
   * whether the request count exceeds the configured maximum.
   *
   * @param {string} ip - Client IP address
   * @returns {boolean} True if the IP is rate limited
   */
  isRateLimited(ip) {
    if (this.bypassIps.has(ip)) {
      return false;
    }

    const now = Date.now();
    const windowStart = now - this.windowMs;

    const timestamps = this.requests.get(ip);
    if (!timestamps) {
      return false;
    }

    // Remove expired timestamps
    const valid = timestamps.filter(t => t > windowStart);
    this.requests.set(ip, valid);

    return valid.length >= this.max;
  }

  /**
   * Record a request from a client IP
   *
   * @param {string} ip - Client IP address
   */
  recordRequest(ip) {
    const now = Date.now();
    const timestamps = this.requests.get(ip) || [];
    timestamps.push(now);
    this.requests.set(ip, timestamps);
  }

  /**
   * Get the number of remaining requests for a client IP
   *
   * @param {string} ip - Client IP address
   * @returns {number} Number of remaining requests in the current window
   */
  getRemaining(ip) {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const timestamps = this.requests.get(ip) || [];
    const valid = timestamps.filter(t => t > windowStart);
    return Math.max(0, this.max - valid.length);
  }

  /**
   * Get the time in milliseconds until the rate limit resets
   *
   * @param {string} ip - Client IP address
   * @returns {number} Milliseconds until the oldest request in the window expires
   */
  getResetMs(ip) {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const timestamps = this.requests.get(ip) || [];
    const valid = timestamps.filter(t => t > windowStart);

    if (valid.length === 0) {
      return 0;
    }

    // Time until the oldest request in the window expires
    const oldest = Math.min(...valid);
    return Math.max(0, oldest + this.windowMs - now);
  }

  /**
   * Send a 429 Too Many Requests response
   *
   * @param {import('http').ServerResponse} res - HTTP response
   * @param {string} [ip] - Client IP for computing Retry-After
   */
  sendLimited(res, ip) {
    const retryAfterMs = ip ? this.getResetMs(ip) : this.windowMs;
    const retryAfterSec = Math.ceil(retryAfterMs / 1000);

    const body = JSON.stringify({
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Try again in ${retryAfterSec} seconds.`,
      retryAfter: retryAfterSec,
    });

    res.writeHead(429, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'Retry-After': String(retryAfterSec),
      'X-RateLimit-Limit': String(this.max),
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': String(retryAfterSec),
    });
    res.end(body);
  }

  /**
   * Check a request and send 429 if rate limited
   *
   * Convenience method that combines isRateLimited, recordRequest,
   * and sendLimited. Returns true if the request was allowed through.
   *
   * @param {string} ip - Client IP address
   * @param {import('http').ServerResponse} res - HTTP response
   * @returns {boolean} True if the request is allowed, false if rate limited
   */
  checkRequest(ip, res) {
    if (this.isRateLimited(ip)) {
      this._log(`Rate limit exceeded for ${ip}`);
      this.sendLimited(res, ip);
      return false;
    }

    this.recordRequest(ip);
    return true;
  }

  /**
   * Reset all tracked requests (useful for testing)
   */
  reset() {
    this.requests.clear();
  }

  /**
   * Stop the cleanup timer and release resources
   */
  destroy() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
    this.requests.clear();
  }

  /**
   * Start periodic cleanup of expired entries
   *
   * Runs every windowMs to remove IPs that have no recent requests.
   * The timer is unref'd so it does not prevent process exit.
   *
   * @private
   */
  _startCleanup() {
    // Cleanup every window period
    this._cleanupTimer = setInterval(() => {
      this._cleanup();
    }, this.windowMs);

    // Allow Node.js to exit even if the timer is still running
    if (this._cleanupTimer.unref) {
      this._cleanupTimer.unref();
    }
  }

  /**
   * Remove expired entries from the requests map
   *
   * @private
   */
  _cleanup() {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    for (const [ip, timestamps] of this.requests) {
      const valid = timestamps.filter(t => t > windowStart);
      if (valid.length === 0) {
        this.requests.delete(ip);
      } else {
        this.requests.set(ip, valid);
      }
    }
  }

  /**
   * Log a message using the configured logger
   *
   * @param {string} message - Message to log
   * @private
   */
  _log(message) {
    if (this.logger) {
      this.logger(`[RateLimiter] ${message}`);
    }
  }
}

export default RateLimiter;
