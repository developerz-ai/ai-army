/**
 * LegacyRedirectRouter - backward-compatible mapping from /api/bots to /api/v1/workers
 *
 * Rewrites incoming `/api/bots*` requests to the equivalent `/api/v1/workers*`
 * path and delegates to the WorkerRouter, providing a seamless migration path
 * for consumers of the legacy API.
 *
 * Mapping:
 * - GET    /api/bots          -> GET    /api/v1/workers
 * - GET    /api/bots/:id      -> GET    /api/v1/workers/:id
 * - POST   /api/bots/:id/...  -> POST   /api/v1/workers/:id/...
 *
 * Note: This router sits *before* the WorkerRouter in the chain.
 * It rewrites `req.url` in-place so the downstream WorkerRouter
 * matches the request as `/api/v1/workers/...`.
 *
 * @module api/routers/legacy-redirect-router
 */

/**
 * LegacyRedirectRouter - lightweight URL rewriter for backward compatibility
 *
 * @example
 * const legacy = new LegacyRedirectRouter({ workerRouter });
 * // In your HTTP server / APIServer chain:
 * const handled = await legacy.handleRequest(req, res);
 */
export class LegacyRedirectRouter {
  /**
   * Create a LegacyRedirectRouter instance
   *
   * @param {Object} options - Configuration options
   * @param {Object} options.workerRouter - WorkerRouter instance to delegate rewritten requests to
   * @param {Function|null} [options.logger=null] - Logger function
   */
  constructor(options = {}) {
    if (!options.workerRouter) {
      throw new Error('LegacyRedirectRouter requires a workerRouter');
    }

    /** @type {Object} */
    this.workerRouter = options.workerRouter;

    /** @type {Function|null} */
    this.logger = options.logger !== undefined ? options.logger : null;
  }

  /**
   * Handle an incoming HTTP request
   *
   * If the request path starts with `/api/bots`, rewrite it to
   * `/api/v1/workers` and delegate to the WorkerRouter.
   * Adds a `X-Legacy-Redirect` response header so consumers can
   * detect the mapping and migrate.
   *
   * @param {import('http').IncomingMessage} req - HTTP request
   * @param {import('http').ServerResponse} res - HTTP response
   * @returns {Promise<boolean>} True if handled, false if path didn't match
   */
  async handleRequest(req, res) {
    // Defensively parse the URL
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch (_err) {
      url = new URL(req.url, 'http://localhost');
    }
    const { pathname } = url;

    // Only intercept /api/bots paths
    if (!pathname.startsWith('/api/bots')) {
      return false;
    }

    // Rewrite /api/bots... -> /api/v1/workers...
    const rewritten = pathname.replace(/^\/api\/bots/, '/api/v1/workers');
    const newUrl = rewritten + (url.search || '');

    this._log(`Legacy redirect: ${pathname} -> ${rewritten}`);

    // Rewrite req.url in-place so the downstream router sees the v1 path
    const originalUrl = req.url;
    req.url = newUrl;

    // Add header to signal the redirect to consumers
    res.setHeader('X-Legacy-Redirect', `${pathname} -> ${rewritten}`);

    // Delegate to WorkerRouter
    const handled = await this.workerRouter.handleRequest(req, res);

    if (!handled) {
      // Restore original URL if the WorkerRouter didn't handle it
      req.url = originalUrl;
    }

    return handled;
  }

  /**
   * Log a message using the configured logger
   *
   * @param {string} message - Message to log
   * @private
   */
  _log(message) {
    if (this.logger) {
      this.logger(`[LegacyRedirectRouter] ${message}`);
    }
  }
}

export default LegacyRedirectRouter;
