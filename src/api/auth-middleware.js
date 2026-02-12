/**
 * AuthMiddleware - Token-based authentication and role-based authorization
 *
 * Provides a lightweight authentication layer for the API server using
 * Bearer token validation and optional role-based access control.
 *
 * Token configuration supports multiple tokens with associated roles,
 * allowing different access levels (e.g., admin, viewer, bot).
 *
 * Features:
 * - Bearer token authentication via Authorization header
 * - Multiple tokens with role assignments
 * - Role-based authorization checks
 * - Development mode (no auth required when no tokens configured)
 * - Redacts token values from error messages and logs
 *
 * @module api/auth-middleware
 */

/**
 * Custom error for auth middleware failures
 */
export class AuthMiddlewareError extends Error {
  /**
   * Create an AuthMiddlewareError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error
   * @param {number} [options.statusCode] - HTTP status code
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'AuthMiddlewareError';
    this.statusCode = options.statusCode;
  }
}

/**
 * Token definition for authentication
 * @typedef {Object} TokenConfig
 * @property {string} token - The bearer token value
 * @property {string} [role='viewer'] - Role assigned to this token
 * @property {string} [name] - Human-readable name for the token holder
 * @property {string[]} [bots] - Array of bot IDs this token can access (empty/null = all bots)
 */

/**
 * Authenticated user context attached to the request
 * @typedef {Object} AuthUser
 * @property {string} role - User's role
 * @property {string} tokenPrefix - Redacted token prefix for logging
 * @property {string} [name] - Token holder name
 * @property {string[]} [bots] - Array of bot IDs this user can access (null/empty = all)
 */

/**
 * Role hierarchy for authorization checks
 * Higher index = more permissions
 * @type {Readonly<string[]>}
 */
const ROLE_HIERARCHY = Object.freeze(['viewer', 'bot', 'operator', 'admin']);

/**
 * AuthMiddleware - token-based authentication and role-based authorization
 *
 * @example
 * const auth = new AuthMiddleware({
 *   tokens: [
 *     { token: 'admin-key-123', role: 'admin', name: 'admin' },
 *     { token: 'viewer-key-456', role: 'viewer', name: 'dashboard' },
 *   ],
 * });
 *
 * // In request handler:
 * const user = auth.authenticate(req);
 * if (!user) {
 *   auth.sendUnauthorized(res);
 *   return;
 * }
 * if (!auth.authorize(user, 'admin')) {
 *   auth.sendForbidden(res);
 *   return;
 * }
 */
export class AuthMiddleware {
  /**
   * Create an AuthMiddleware instance
   *
   * @param {Object} [options={}] - Configuration options
   * @param {TokenConfig[]} [options.tokens=[]] - Array of token configurations
   * @param {string} [options.defaultRole='viewer'] - Default role when no tokens configured
   * @param {Function|null} [options.logger=null] - Logger function
   */
  constructor(options = {}) {
    /** @type {Map<string, TokenConfig>} Token lookup by token value */
    this.tokenMap = new Map();

    /** @type {string} Default role for unauthenticated access in dev mode */
    this.defaultRole = options.defaultRole || 'viewer';

    /** @type {Function|null} Logger function */
    this.logger = options.logger !== undefined ? options.logger : null;

    // Build token lookup map
    const tokens = options.tokens || [];
    for (const tokenConfig of tokens) {
      if (!tokenConfig.token) {
        throw new AuthMiddlewareError('Each token config must have a "token" field');
      }
      this.tokenMap.set(tokenConfig.token, {
        token: tokenConfig.token,
        role: tokenConfig.role || 'viewer',
        name: tokenConfig.name || null,
        bots: tokenConfig.bots || null,
      });
    }
  }

  /**
   * Check if authentication is enabled
   *
   * When no tokens are configured, authentication is disabled
   * (development mode) and all requests are allowed through.
   *
   * @returns {boolean} True if authentication is enabled
   */
  isEnabled() {
    return this.tokenMap.size > 0;
  }

  /**
   * Authenticate an incoming HTTP request
   *
   * Extracts the Bearer token from the Authorization header and
   * validates it against the configured token list.
   *
   * If no tokens are configured (dev mode), returns a default user
   * with the defaultRole.
   *
   * @param {import('http').IncomingMessage} req - HTTP request
   * @returns {AuthUser|null} Authenticated user context, or null if authentication failed
   */
  authenticate(req) {
    // Dev mode: no tokens configured, allow everything
    if (!this.isEnabled()) {
      return {
        role: this.defaultRole,
        tokenPrefix: 'dev-mode',
        name: 'anonymous',
      };
    }

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return null;
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return null;
    }

    const token = parts[1];
    const tokenConfig = this.tokenMap.get(token);

    if (!tokenConfig) {
      this._log(`Authentication failed: invalid token ${this._redactToken(token)}`);
      return null;
    }

    return {
      role: tokenConfig.role,
      tokenPrefix: this._redactToken(token),
      name: tokenConfig.name,
      bots: tokenConfig.bots,
    };
  }

  /**
   * Check if a user has the required role
   *
   * Uses a role hierarchy where higher roles include all permissions
   * of lower roles. For example, 'admin' can access 'viewer' endpoints.
   *
   * Hierarchy (lowest to highest): viewer → bot → operator → admin
   *
   * @param {AuthUser} user - Authenticated user context
   * @param {string} requiredRole - The minimum role required
   * @returns {boolean} True if the user has sufficient permissions
   */
  authorize(user, requiredRole) {
    if (!user) {
      return false;
    }

    const userLevel = ROLE_HIERARCHY.indexOf(user.role);
    const requiredLevel = ROLE_HIERARCHY.indexOf(requiredRole);

    // Unknown roles are treated as having no permissions
    if (userLevel === -1) {
      return false;
    }

    // Unknown required role defaults to requiring admin
    if (requiredLevel === -1) {
      return userLevel >= ROLE_HIERARCHY.indexOf('admin');
    }

    return userLevel >= requiredLevel;
  }

  /**
   * Send a 401 Unauthorized response
   *
   * @param {import('http').ServerResponse} res - HTTP response
   */
  sendUnauthorized(res) {
    const body = JSON.stringify({
      error: 'Unauthorized',
      message: 'Valid API key required via Authorization: Bearer <key>',
    });
    res.writeHead(401, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'WWW-Authenticate': 'Bearer',
    });
    res.end(body);
  }

  /**
   * Send a 403 Forbidden response
   *
   * @param {import('http').ServerResponse} res - HTTP response
   * @param {string} [requiredRole] - The role that was required
   */
  sendForbidden(res, requiredRole) {
    const message = requiredRole
      ? `Insufficient permissions. Required role: ${requiredRole}`
      : 'Insufficient permissions';
    const body = JSON.stringify({
      error: 'Forbidden',
      message,
    });
    res.writeHead(403, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  }

  /**
   * Check if a user has access to a specific bot
   *
   * @param {AuthUser} user - Authenticated user context
   * @param {string} botId - Bot ID to check access for
   * @returns {boolean} True if user can access this bot
   */
  canAccessBot(user, botId) {
    if (!user) {
      return false;
    }

    // Admin role has access to all bots
    if (user.role === 'admin') {
      return true;
    }

    // If no bot restrictions specified, allow access to all
    if (!user.bots || user.bots.length === 0) {
      return true;
    }

    // Check if bot is in the allowed list
    return user.bots.includes(botId);
  }

  /**
   * Get the list of configured roles
   *
   * @returns {string[]} Available roles in hierarchy order
   */
  getRoles() {
    return [...ROLE_HIERARCHY];
  }

  /**
   * Redact a token value for safe logging
   *
   * Shows only the first 8 characters followed by '***'.
   *
   * @param {string} token - Token value to redact
   * @returns {string} Redacted token
   * @private
   */
  _redactToken(token) {
    if (!token || token.length <= 8) {
      return '***';
    }
    return `${token.slice(0, 8)}***`;
  }

  /**
   * Log a message using the configured logger
   *
   * @param {string} message - Message to log
   * @private
   */
  _log(message) {
    if (this.logger) {
      this.logger(`[AuthMiddleware] ${message}`);
    }
  }
}

export default AuthMiddleware;
