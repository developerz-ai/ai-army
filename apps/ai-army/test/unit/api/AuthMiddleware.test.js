/**
 * Unit tests for AuthMiddleware
 *
 * Tests token-based authentication and role-based authorization:
 * - Constructor and token configuration
 * - Bearer token authentication
 * - Development mode (no tokens)
 * - Role hierarchy and authorization
 * - 401/403 response sending
 * - Token redaction for logging
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AuthMiddleware, AuthMiddlewareError } from '../../../src/api/auth-middleware.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock HTTP request
 * @param {Object} options - Request options
 * @returns {Object} Mock request
 */
function createMockRequest({ headers = {} } = {}) {
  return {
    headers: {
      host: 'localhost:3000',
      ...headers,
    },
  };
}

/**
 * Create a mock HTTP response that captures output
 * @returns {{ res: Object, getResponse: () => { statusCode: number, headers: Object, body: Object }}}
 */
function createMockResponse() {
  let statusCode;
  let responseHeaders = {};
  const chunks = [];

  const res = {
    writeHead(code, hdrs) {
      statusCode = code;
      responseHeaders = hdrs;
    },
    end(data) {
      if (data) chunks.push(data);
    },
  };

  return {
    res,
    getResponse() {
      const raw = chunks.join('');
      return {
        statusCode,
        headers: responseHeaders,
        body: raw ? JSON.parse(raw) : null,
      };
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('AuthMiddleware', () => {
  // ==========================================================================
  // Constructor
  // ==========================================================================

  describe('constructor', () => {
    test('creates instance with no options', () => {
      const auth = new AuthMiddleware();
      assert.ok(auth);
      assert.equal(auth.tokenMap.size, 0);
      assert.equal(auth.defaultRole, 'viewer');
    });

    test('creates instance with tokens', () => {
      const auth = new AuthMiddleware({
        tokens: [
          { token: 'admin-key-123', role: 'admin', name: 'Admin User' },
          { token: 'viewer-key-456', role: 'viewer', name: 'Dashboard' },
        ],
      });
      assert.equal(auth.tokenMap.size, 2);
    });

    test('accepts custom default role', () => {
      const auth = new AuthMiddleware({ defaultRole: 'admin' });
      assert.equal(auth.defaultRole, 'admin');
    });

    test('throws when token config has no token field', () => {
      assert.throws(
        () =>
          new AuthMiddleware({
            tokens: [{ role: 'admin', name: 'No Token' }],
          }),
        err => {
          assert.ok(err instanceof AuthMiddlewareError);
          assert.ok(err.message.includes('token'));
          return true;
        }
      );
    });

    test('defaults role to viewer when not specified', () => {
      const auth = new AuthMiddleware({
        tokens: [{ token: 'my-token' }],
      });
      const config = auth.tokenMap.get('my-token');
      assert.equal(config.role, 'viewer');
    });
  });

  // ==========================================================================
  // isEnabled
  // ==========================================================================

  describe('isEnabled', () => {
    test('returns false when no tokens configured', () => {
      const auth = new AuthMiddleware();
      assert.equal(auth.isEnabled(), false);
    });

    test('returns true when tokens configured', () => {
      const auth = new AuthMiddleware({
        tokens: [{ token: 'key-123', role: 'admin' }],
      });
      assert.equal(auth.isEnabled(), true);
    });
  });

  // ==========================================================================
  // authenticate (dev mode)
  // ==========================================================================

  describe('authenticate (dev mode)', () => {
    test('returns default user when no tokens configured', () => {
      const auth = new AuthMiddleware();
      const req = createMockRequest();
      const user = auth.authenticate(req);

      assert.ok(user);
      assert.equal(user.role, 'viewer');
      assert.equal(user.tokenPrefix, 'dev-mode');
      assert.equal(user.name, 'anonymous');
    });

    test('uses custom default role in dev mode', () => {
      const auth = new AuthMiddleware({ defaultRole: 'admin' });
      const req = createMockRequest();
      const user = auth.authenticate(req);

      assert.equal(user.role, 'admin');
    });
  });

  // ==========================================================================
  // authenticate (with tokens)
  // ==========================================================================

  describe('authenticate (with tokens)', () => {
    /** @type {AuthMiddleware} */
    let auth;

    const tokens = [
      { token: 'admin-key-123456789', role: 'admin', name: 'Admin' },
      { token: 'viewer-key-987654321', role: 'viewer', name: 'Dashboard' },
    ];

    test('authenticates valid admin token', () => {
      auth = new AuthMiddleware({ tokens });
      const req = createMockRequest({
        headers: { authorization: 'Bearer admin-key-123456789' },
      });
      const user = auth.authenticate(req);

      assert.ok(user);
      assert.equal(user.role, 'admin');
      assert.equal(user.name, 'Admin');
      assert.ok(user.tokenPrefix.includes('admin-ke'));
    });

    test('authenticates valid viewer token', () => {
      auth = new AuthMiddleware({ tokens });
      const req = createMockRequest({
        headers: { authorization: 'Bearer viewer-key-987654321' },
      });
      const user = auth.authenticate(req);

      assert.ok(user);
      assert.equal(user.role, 'viewer');
      assert.equal(user.name, 'Dashboard');
    });

    test('returns null for missing Authorization header', () => {
      auth = new AuthMiddleware({ tokens });
      const req = createMockRequest();
      const user = auth.authenticate(req);

      assert.equal(user, null);
    });

    test('returns null for invalid token', () => {
      auth = new AuthMiddleware({ tokens });
      const req = createMockRequest({
        headers: { authorization: 'Bearer invalid-token-999' },
      });
      const user = auth.authenticate(req);

      assert.equal(user, null);
    });

    test('returns null for non-Bearer auth scheme', () => {
      auth = new AuthMiddleware({ tokens });
      const req = createMockRequest({
        headers: { authorization: 'Basic YWRtaW46cGFzc3dvcmQ=' },
      });
      const user = auth.authenticate(req);

      assert.equal(user, null);
    });

    test('returns null for malformed auth header (no space)', () => {
      auth = new AuthMiddleware({ tokens });
      const req = createMockRequest({
        headers: { authorization: 'Bearer' },
      });
      const user = auth.authenticate(req);

      assert.equal(user, null);
    });

    test('returns null for auth header with extra spaces', () => {
      auth = new AuthMiddleware({ tokens });
      const req = createMockRequest({
        headers: { authorization: 'Bearer token with spaces' },
      });
      const user = auth.authenticate(req);

      assert.equal(user, null);
    });
  });

  // ==========================================================================
  // authorize
  // ==========================================================================

  describe('authorize', () => {
    /** @type {AuthMiddleware} */
    let auth;

    test('admin can access viewer endpoints', () => {
      auth = new AuthMiddleware();
      const user = { role: 'admin', tokenPrefix: 'test', name: 'admin' };
      assert.equal(auth.authorize(user, 'viewer'), true);
    });

    test('admin can access admin endpoints', () => {
      auth = new AuthMiddleware();
      const user = { role: 'admin', tokenPrefix: 'test', name: 'admin' };
      assert.equal(auth.authorize(user, 'admin'), true);
    });

    test('admin can access operator endpoints', () => {
      auth = new AuthMiddleware();
      const user = { role: 'admin', tokenPrefix: 'test', name: 'admin' };
      assert.equal(auth.authorize(user, 'operator'), true);
    });

    test('viewer cannot access admin endpoints', () => {
      auth = new AuthMiddleware();
      const user = { role: 'viewer', tokenPrefix: 'test', name: 'viewer' };
      assert.equal(auth.authorize(user, 'admin'), false);
    });

    test('viewer cannot access operator endpoints', () => {
      auth = new AuthMiddleware();
      const user = { role: 'viewer', tokenPrefix: 'test', name: 'viewer' };
      assert.equal(auth.authorize(user, 'operator'), false);
    });

    test('viewer can access viewer endpoints', () => {
      auth = new AuthMiddleware();
      const user = { role: 'viewer', tokenPrefix: 'test', name: 'viewer' };
      assert.equal(auth.authorize(user, 'viewer'), true);
    });

    test('operator can access bot endpoints', () => {
      auth = new AuthMiddleware();
      const user = { role: 'operator', tokenPrefix: 'test', name: 'ops' };
      assert.equal(auth.authorize(user, 'bot'), true);
    });

    test('bot cannot access operator endpoints', () => {
      auth = new AuthMiddleware();
      const user = { role: 'bot', tokenPrefix: 'test', name: 'bot' };
      assert.equal(auth.authorize(user, 'operator'), false);
    });

    test('returns false for null user', () => {
      auth = new AuthMiddleware();
      assert.equal(auth.authorize(null, 'viewer'), false);
    });

    test('returns false for unknown role', () => {
      auth = new AuthMiddleware();
      const user = { role: 'unknown-role', tokenPrefix: 'test', name: 'test' };
      assert.equal(auth.authorize(user, 'viewer'), false);
    });

    test('unknown required role requires admin', () => {
      auth = new AuthMiddleware();
      const adminUser = { role: 'admin', tokenPrefix: 'test', name: 'admin' };
      const viewerUser = { role: 'viewer', tokenPrefix: 'test', name: 'viewer' };

      assert.equal(auth.authorize(adminUser, 'superadmin'), true);
      assert.equal(auth.authorize(viewerUser, 'superadmin'), false);
    });
  });

  // ==========================================================================
  // sendUnauthorized
  // ==========================================================================

  describe('sendUnauthorized', () => {
    test('sends 401 response with JSON body', () => {
      const auth = new AuthMiddleware();
      const { res, getResponse } = createMockResponse();

      auth.sendUnauthorized(res);
      const response = getResponse();

      assert.equal(response.statusCode, 401);
      assert.equal(response.body.error, 'Unauthorized');
      assert.ok(response.body.message.includes('API key'));
    });

    test('includes WWW-Authenticate header', () => {
      const auth = new AuthMiddleware();
      const { res, getResponse } = createMockResponse();

      auth.sendUnauthorized(res);
      const response = getResponse();

      assert.equal(response.headers['WWW-Authenticate'], 'Bearer');
    });

    test('includes Content-Type header', () => {
      const auth = new AuthMiddleware();
      const { res, getResponse } = createMockResponse();

      auth.sendUnauthorized(res);
      const response = getResponse();

      assert.equal(response.headers['Content-Type'], 'application/json');
    });
  });

  // ==========================================================================
  // sendForbidden
  // ==========================================================================

  describe('sendForbidden', () => {
    test('sends 403 response with JSON body', () => {
      const auth = new AuthMiddleware();
      const { res, getResponse } = createMockResponse();

      auth.sendForbidden(res);
      const response = getResponse();

      assert.equal(response.statusCode, 403);
      assert.equal(response.body.error, 'Forbidden');
      assert.ok(response.body.message.includes('Insufficient permissions'));
    });

    test('includes required role in message when provided', () => {
      const auth = new AuthMiddleware();
      const { res, getResponse } = createMockResponse();

      auth.sendForbidden(res, 'admin');
      const response = getResponse();

      assert.equal(response.statusCode, 403);
      assert.ok(response.body.message.includes('admin'));
    });

    test('includes Content-Type header', () => {
      const auth = new AuthMiddleware();
      const { res, getResponse } = createMockResponse();

      auth.sendForbidden(res);
      const response = getResponse();

      assert.equal(response.headers['Content-Type'], 'application/json');
    });
  });

  // ==========================================================================
  // getRoles
  // ==========================================================================

  describe('getRoles', () => {
    test('returns role hierarchy', () => {
      const auth = new AuthMiddleware();
      const roles = auth.getRoles();

      assert.ok(Array.isArray(roles));
      assert.ok(roles.includes('viewer'));
      assert.ok(roles.includes('admin'));
      assert.ok(roles.includes('operator'));
      assert.ok(roles.includes('bot'));
    });

    test('returns a copy (not the original)', () => {
      const auth = new AuthMiddleware();
      const roles1 = auth.getRoles();
      const roles2 = auth.getRoles();

      assert.notEqual(roles1, roles2);
      assert.deepEqual(roles1, roles2);
    });
  });

  // ==========================================================================
  // AuthMiddlewareError
  // ==========================================================================

  describe('AuthMiddlewareError', () => {
    test('has correct name', () => {
      const err = new AuthMiddlewareError('test');
      assert.equal(err.name, 'AuthMiddlewareError');
    });

    test('extends Error', () => {
      const err = new AuthMiddlewareError('test');
      assert.ok(err instanceof Error);
    });

    test('stores cause', () => {
      const cause = new Error('original');
      const err = new AuthMiddlewareError('wrapper', { cause });
      assert.equal(err.cause, cause);
    });

    test('stores statusCode', () => {
      const err = new AuthMiddlewareError('forbidden', { statusCode: 403 });
      assert.equal(err.statusCode, 403);
    });

    test('has correct message', () => {
      const err = new AuthMiddlewareError('auth failed');
      assert.equal(err.message, 'auth failed');
    });
  });
});
