/**
 * Unit tests for IncusClient
 *
 * Tests Incus REST API client methods, async operation handling,
 * file operations, error handling, and connection failures.
 *
 * Note: These are unit tests with a mocked HTTP layer.
 * No real Incus daemon is required.
 */

import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setImmediate } from 'node:timers';
import { IncusClient, IncusClientError } from '../../../src/execution/incus-client.js';

/**
 * Create a mock HTTP response with controllable behavior
 * @param {number} statusCode - HTTP status code
 * @param {string|Object} body - Response body (object will be JSON-stringified)
 * @returns {Object} Mock response object
 */
function createMockResponse(statusCode, body) {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  const listeners = {};

  return {
    statusCode,
    on(event, callback) {
      listeners[event] = callback;
      return this;
    },
    emit(event, ...args) {
      if (listeners[event]) listeners[event](...args);
    },
    _deliver() {
      // Deliver body data and end the response
      if (listeners.data) listeners.data(Buffer.from(bodyStr));
      if (listeners.end) listeners.end();
    },
  };
}

/**
 * Create a mock HTTP request with controllable behavior
 * @param {Object} mockResponse - Mock response to deliver
 * @returns {Object} Mock request object
 */
function createMockRequest(mockResponse) {
  const listeners = {};
  let writtenData = '';

  return {
    on(event, callback) {
      listeners[event] = callback;
      return this;
    },
    setTimeout(timeout, callback) {
      this._timeoutMs = timeout;
      this._timeoutCallback = callback;
      return this;
    },
    write(data) {
      writtenData += data;
    },
    end() {
      // Simulate async response delivery
      setImmediate(() => {
        if (this._responseCallback) {
          this._responseCallback(mockResponse);
          mockResponse._deliver();
        }
      });
    },
    destroy(err) {
      if (listeners.error) listeners.error(err);
    },
    _responseCallback: null,
    _writtenData: () => writtenData,
    _emitError(err) {
      if (listeners.error) listeners.error(err);
    },
  };
}

/**
 * Set up http.request mock that returns predefined responses
 * @param {Array<{statusCode: number, body: Object}>} responses - Ordered responses to return
 * @returns {{ requestMock: Function, calls: Array }}
 */
function setupHttpMock(responses) {
  const calls = [];
  let callIndex = 0;

  const requestMock = mock.fn((options, callback) => {
    const responseSpec = responses[callIndex] || responses[responses.length - 1];
    callIndex++;

    const mockRes = createMockResponse(responseSpec.statusCode, responseSpec.body);
    const mockReq = createMockRequest(mockRes);
    mockReq._responseCallback = callback;

    calls.push({ options, mockReq, mockRes });

    return mockReq;
  });

  return { requestMock, calls };
}

describe('IncusClient', () => {
  let originalRequest;

  beforeEach(() => {
    originalRequest = http.request;
  });

  afterEach(() => {
    http.request = originalRequest;
  });

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  describe('constructor', () => {
    test('creates instance with default options', () => {
      const client = new IncusClient();
      assert.equal(client.socketPath, '/var/lib/incus/unix.socket');
      assert.equal(client.operationTimeout, 60_000);
      assert.equal(client.requestTimeout, 30_000);
    });

    test('creates instance with custom socket path', () => {
      const client = new IncusClient({ socketPath: '/custom/incus.socket' });
      assert.equal(client.socketPath, '/custom/incus.socket');
    });

    test('creates instance with custom timeouts', () => {
      const client = new IncusClient({
        operationTimeout: 120_000,
        requestTimeout: 60_000,
      });
      assert.equal(client.operationTimeout, 120_000);
      assert.equal(client.requestTimeout, 60_000);
    });
  });

  // ---------------------------------------------------------------------------
  // IncusClientError
  // ---------------------------------------------------------------------------

  describe('IncusClientError', () => {
    test('creates error with all properties', () => {
      const cause = new Error('root cause');
      const err = new IncusClientError('test error', {
        operation: 'createInstance',
        instanceName: 'test-inst',
        statusCode: 404,
        incusError: 'Instance not found',
        cause,
      });

      assert.equal(err.name, 'IncusClientError');
      assert.equal(err.message, 'test error');
      assert.equal(err.operation, 'createInstance');
      assert.equal(err.instanceName, 'test-inst');
      assert.equal(err.statusCode, 404);
      assert.equal(err.incusError, 'Instance not found');
      assert.equal(err.cause, cause);
    });

    test('creates error with minimal options', () => {
      const err = new IncusClientError('simple error');
      assert.equal(err.name, 'IncusClientError');
      assert.equal(err.message, 'simple error');
      assert.equal(err.operation, undefined);
      assert.equal(err.instanceName, undefined);
    });

    test('is an instance of Error', () => {
      const err = new IncusClientError('test');
      assert.ok(err instanceof Error);
    });
  });

  // ---------------------------------------------------------------------------
  // createInstance
  // ---------------------------------------------------------------------------

  describe('createInstance', () => {
    test('sends POST /1.0/instances and waits for async operation', async () => {
      const client = new IncusClient();

      const { requestMock, calls } = setupHttpMock([
        // First call: POST /1.0/instances → async response
        {
          statusCode: 202,
          body: {
            type: 'async',
            status: 'Operation created',
            status_code: 100,
            operation: '/1.0/operations/op-uuid-123',
            metadata: { id: 'op-uuid-123' },
          },
        },
        // Second call: GET /1.0/operations/op-uuid-123/wait → completed
        {
          statusCode: 200,
          body: {
            type: 'sync',
            status: 'Success',
            metadata: {
              id: 'op-uuid-123',
              status: 'Success',
              status_code: 200,
            },
          },
        },
      ]);

      http.request = requestMock;

      const result = await client.createInstance('test-container', {
        source: { type: 'image', alias: 'ubuntu/24.04' },
        config: { 'limits.memory': '2GB' },
      });

      assert.equal(calls.length, 2);
      assert.equal(calls[0].options.method, 'POST');
      assert.equal(calls[0].options.path, '/1.0/instances');
      assert.equal(calls[1].options.method, 'GET');
      assert.ok(calls[1].options.path.includes('/1.0/operations/op-uuid-123/wait'));
      assert.equal(result.status, 'Success');
    });

    test('includes instance name in request body', async () => {
      const client = new IncusClient();

      const { requestMock, calls } = setupHttpMock([
        {
          statusCode: 200,
          body: { type: 'sync', status: 'Success', metadata: {} },
        },
      ]);

      http.request = requestMock;

      await client.createInstance('my-bot', {
        source: { type: 'image', alias: 'ubuntu/24.04' },
      });

      const writtenBody = JSON.parse(calls[0].mockReq._writtenData());
      assert.equal(writtenBody.name, 'my-bot');
      assert.deepEqual(writtenBody.source, { type: 'image', alias: 'ubuntu/24.04' });
    });
  });

  // ---------------------------------------------------------------------------
  // startInstance
  // ---------------------------------------------------------------------------

  describe('startInstance', () => {
    test('sends PUT /1.0/instances/{name}/state with start action', async () => {
      const client = new IncusClient();

      const { requestMock, calls } = setupHttpMock([
        {
          statusCode: 200,
          body: { type: 'sync', status: 'Success', metadata: {} },
        },
      ]);

      http.request = requestMock;

      await client.startInstance('test-container');

      assert.equal(calls[0].options.method, 'PUT');
      assert.equal(calls[0].options.path, '/1.0/instances/test-container/state');

      const writtenBody = JSON.parse(calls[0].mockReq._writtenData());
      assert.equal(writtenBody.action, 'start');
    });
  });

  // ---------------------------------------------------------------------------
  // stopInstance
  // ---------------------------------------------------------------------------

  describe('stopInstance', () => {
    test('sends PUT /1.0/instances/{name}/state with stop action', async () => {
      const client = new IncusClient();

      const { requestMock, calls } = setupHttpMock([
        {
          statusCode: 200,
          body: { type: 'sync', status: 'Success', metadata: {} },
        },
      ]);

      http.request = requestMock;

      await client.stopInstance('test-container', 15);

      assert.equal(calls[0].options.method, 'PUT');
      assert.equal(calls[0].options.path, '/1.0/instances/test-container/state');

      const writtenBody = JSON.parse(calls[0].mockReq._writtenData());
      assert.equal(writtenBody.action, 'stop');
      assert.equal(writtenBody.timeout, 15);
    });

    test('uses default timeout of 30 seconds', async () => {
      const client = new IncusClient();

      const { requestMock, calls } = setupHttpMock([
        {
          statusCode: 200,
          body: { type: 'sync', status: 'Success', metadata: {} },
        },
      ]);

      http.request = requestMock;

      await client.stopInstance('test-container');

      const writtenBody = JSON.parse(calls[0].mockReq._writtenData());
      assert.equal(writtenBody.timeout, 30);
    });
  });

  // ---------------------------------------------------------------------------
  // deleteInstance
  // ---------------------------------------------------------------------------

  describe('deleteInstance', () => {
    test('sends DELETE /1.0/instances/{name}', async () => {
      const client = new IncusClient();

      const { requestMock, calls } = setupHttpMock([
        {
          statusCode: 200,
          body: { type: 'sync', status: 'Success', metadata: {} },
        },
      ]);

      http.request = requestMock;

      await client.deleteInstance('test-container');

      assert.equal(calls[0].options.method, 'DELETE');
      assert.equal(calls[0].options.path, '/1.0/instances/test-container');
    });
  });

  // ---------------------------------------------------------------------------
  // getInstanceState
  // ---------------------------------------------------------------------------

  describe('getInstanceState', () => {
    test('sends GET /1.0/instances/{name}/state and returns metadata', async () => {
      const client = new IncusClient();

      const stateMetadata = {
        status: 'Running',
        status_code: 103,
        cpu: { usage: 12345 },
        memory: { usage: 1024000 },
      };

      const { requestMock, calls } = setupHttpMock([
        {
          statusCode: 200,
          body: { type: 'sync', status: 'Success', metadata: stateMetadata },
        },
      ]);

      http.request = requestMock;

      const result = await client.getInstanceState('test-container');

      assert.equal(calls[0].options.method, 'GET');
      assert.equal(calls[0].options.path, '/1.0/instances/test-container/state');
      assert.deepEqual(result, stateMetadata);
    });
  });

  // ---------------------------------------------------------------------------
  // listInstances
  // ---------------------------------------------------------------------------

  describe('listInstances', () => {
    test('sends GET /1.0/instances with recursion=1', async () => {
      const client = new IncusClient();

      const instances = [
        { name: 'container-1', status: 'Running' },
        { name: 'container-2', status: 'Stopped' },
      ];

      const { requestMock, calls } = setupHttpMock([
        {
          statusCode: 200,
          body: { type: 'sync', status: 'Success', metadata: instances },
        },
      ]);

      http.request = requestMock;

      const result = await client.listInstances();

      assert.equal(calls[0].options.method, 'GET');
      assert.equal(calls[0].options.path, '/1.0/instances?recursion=1');
      assert.deepEqual(result, instances);
    });
  });

  // ---------------------------------------------------------------------------
  // getServerInfo
  // ---------------------------------------------------------------------------

  describe('getServerInfo', () => {
    test('sends GET /1.0 and returns server info', async () => {
      const client = new IncusClient();

      const serverInfo = {
        type: 'sync',
        metadata: { environment: { server_version: '0.7' } },
      };

      const { requestMock, calls } = setupHttpMock([
        { statusCode: 200, body: serverInfo },
      ]);

      http.request = requestMock;

      const result = await client.getServerInfo();

      assert.equal(calls[0].options.method, 'GET');
      assert.equal(calls[0].options.path, '/1.0');
      assert.deepEqual(result, serverInfo);
    });
  });

  // ---------------------------------------------------------------------------
  // execCommand
  // ---------------------------------------------------------------------------

  describe('execCommand', () => {
    test('sends POST /1.0/instances/{name}/exec with command', async () => {
      const client = new IncusClient();

      const { requestMock, calls } = setupHttpMock([
        // exec POST → async
        {
          statusCode: 202,
          body: {
            type: 'async',
            operation: '/1.0/operations/exec-op-1',
            metadata: {},
          },
        },
        // wait GET → completed
        {
          statusCode: 200,
          body: {
            type: 'sync',
            metadata: {
              id: 'exec-op-1',
              status: 'Success',
              metadata: { return: 0, output: {} },
            },
          },
        },
      ]);

      http.request = requestMock;

      const result = await client.execCommand('test-container', ['echo', 'hello']);

      assert.equal(calls[0].options.method, 'POST');
      assert.equal(calls[0].options.path, '/1.0/instances/test-container/exec');

      const writtenBody = JSON.parse(calls[0].mockReq._writtenData());
      assert.deepEqual(writtenBody.command, ['echo', 'hello']);
      assert.equal(writtenBody['wait-for-websocket'], false);
      assert.equal(writtenBody['record-output'], true);
      assert.equal(writtenBody.interactive, false);

      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr, '');
    });

    test('includes environment and cwd options', async () => {
      const client = new IncusClient();

      const { requestMock, calls } = setupHttpMock([
        {
          statusCode: 200,
          body: {
            type: 'sync',
            metadata: {
              status: 'Success',
              metadata: { return: 0, output: {} },
            },
          },
        },
      ]);

      http.request = requestMock;

      await client.execCommand('test-container', ['ls'], {
        environment: { HOME: '/home/agent' },
        cwd: '/home/agent',
        user: 1000,
        group: 1000,
      });

      const writtenBody = JSON.parse(calls[0].mockReq._writtenData());
      assert.deepEqual(writtenBody.environment, { HOME: '/home/agent' });
      assert.equal(writtenBody.cwd, '/home/agent');
      assert.equal(writtenBody.user, 1000);
      assert.equal(writtenBody.group, 1000);
    });

    test('returns exit code from operation metadata', async () => {
      const client = new IncusClient();

      const { requestMock } = setupHttpMock([
        {
          statusCode: 200,
          body: {
            type: 'sync',
            metadata: {
              status: 'Success',
              metadata: { return: 42, output: {} },
            },
          },
        },
      ]);

      http.request = requestMock;

      const result = await client.execCommand('test-container', ['false']);
      assert.equal(result.exitCode, 42);
    });

    test('returns -1 exit code when metadata is missing', async () => {
      const client = new IncusClient();

      const { requestMock } = setupHttpMock([
        {
          statusCode: 200,
          body: {
            type: 'sync',
            metadata: {
              status: 'Success',
              metadata: {},
            },
          },
        },
      ]);

      http.request = requestMock;

      const result = await client.execCommand('test-container', ['test']);
      assert.equal(result.exitCode, -1);
    });

    test('forwards timeout option to HTTP request', async () => {
      const client = new IncusClient();

      const { requestMock, calls } = setupHttpMock([
        {
          statusCode: 200,
          body: {
            type: 'sync',
            metadata: {
              status: 'Success',
              metadata: { return: 0, output: {} },
            },
          },
        },
      ]);

      http.request = requestMock;

      await client.execCommand('test-container', ['apt-get', 'install', '-y', 'git'], {
        timeout: 120_000,
      });

      // The mock request should have been given the custom timeout
      assert.equal(calls[0].mockReq._timeoutMs, 120_000);
    });

    test('uses default request timeout when no timeout option provided', async () => {
      const client = new IncusClient({ requestTimeout: 30_000 });

      const { requestMock, calls } = setupHttpMock([
        {
          statusCode: 200,
          body: {
            type: 'sync',
            metadata: {
              status: 'Success',
              metadata: { return: 0, output: {} },
            },
          },
        },
      ]);

      http.request = requestMock;

      await client.execCommand('test-container', ['echo', 'hello']);

      // Should use the default requestTimeout
      assert.equal(calls[0].mockReq._timeoutMs, 30_000);
    });
  });

  // ---------------------------------------------------------------------------
  // pushFile
  // ---------------------------------------------------------------------------

  describe('pushFile', () => {
    test('sends POST with file content to files endpoint', async () => {
      const client = new IncusClient();

      const { requestMock, calls } = setupHttpMock([{ statusCode: 200, body: '' }]);

      http.request = requestMock;

      await client.pushFile('test-container', '/home/agent/test.txt', 'hello world');

      assert.equal(calls[0].options.method, 'POST');
      assert.ok(calls[0].options.path.includes('/1.0/instances/test-container/files'));
      assert.ok(calls[0].options.path.includes('path=%2Fhome%2Fagent%2Ftest.txt'));
      assert.equal(calls[0].options.headers['Content-Type'], 'application/octet-stream');
    });

    test('includes uid, gid, and mode headers when provided', async () => {
      const client = new IncusClient();

      const { requestMock, calls } = setupHttpMock([{ statusCode: 200, body: '' }]);

      http.request = requestMock;

      await client.pushFile('test-container', '/tmp/test.txt', 'content', {
        uid: 1000,
        gid: 1000,
        mode: '0644',
      });

      assert.equal(calls[0].options.headers['X-Incus-uid'], '1000');
      assert.equal(calls[0].options.headers['X-Incus-gid'], '1000');
      assert.equal(calls[0].options.headers['X-Incus-mode'], '0644');
    });
  });

  // ---------------------------------------------------------------------------
  // pullFile
  // ---------------------------------------------------------------------------

  describe('pullFile', () => {
    test('sends GET to files endpoint and returns content', async () => {
      const client = new IncusClient();

      const { requestMock, calls } = setupHttpMock([
        { statusCode: 200, body: 'file content here' },
      ]);

      http.request = requestMock;

      const result = await client.pullFile('test-container', '/home/agent/test.txt');

      assert.equal(calls[0].options.method, 'GET');
      assert.ok(calls[0].options.path.includes('/1.0/instances/test-container/files'));
      assert.ok(calls[0].options.path.includes('path=%2Fhome%2Fagent%2Ftest.txt'));
      assert.equal(result, 'file content here');
    });
  });

  // ---------------------------------------------------------------------------
  // getOperationResult
  // ---------------------------------------------------------------------------

  describe('getOperationResult', () => {
    test('sends GET /1.0/operations/{id}/wait with timeout', async () => {
      const client = new IncusClient();

      const operationResult = {
        id: 'op-123',
        status: 'Success',
        status_code: 200,
      };

      const { requestMock, calls } = setupHttpMock([
        {
          statusCode: 200,
          body: { type: 'sync', status: 'Success', metadata: operationResult },
        },
      ]);

      http.request = requestMock;

      const result = await client.getOperationResult('op-123');

      assert.equal(calls[0].options.method, 'GET');
      assert.ok(calls[0].options.path.includes('/1.0/operations/op-123/wait'));
      assert.ok(calls[0].options.path.includes('timeout=60'));
      assert.deepEqual(result, operationResult);
    });

    test('uses custom timeout', async () => {
      const client = new IncusClient();

      const { requestMock, calls } = setupHttpMock([
        {
          statusCode: 200,
          body: { type: 'sync', metadata: { status: 'Success' } },
        },
      ]);

      http.request = requestMock;

      await client.getOperationResult('op-456', 120);

      assert.ok(calls[0].options.path.includes('timeout=120'));
    });
  });

  // ---------------------------------------------------------------------------
  // Async operation handling
  // ---------------------------------------------------------------------------

  describe('async operation handling', () => {
    test('handles async 202 response by waiting on operation', async () => {
      const client = new IncusClient();

      const { requestMock, calls } = setupHttpMock([
        // Initial async response
        {
          statusCode: 202,
          body: {
            type: 'async',
            operation: '/1.0/operations/async-op-1',
            metadata: {},
          },
        },
        // Operation wait result
        {
          statusCode: 200,
          body: {
            type: 'sync',
            metadata: {
              id: 'async-op-1',
              status: 'Success',
              status_code: 200,
            },
          },
        },
      ]);

      http.request = requestMock;

      await client.startInstance('test-container');

      // Should have made 2 HTTP calls: PUT state + GET operation/wait
      assert.equal(calls.length, 2);
    });

    test('throws when async operation fails', async () => {
      const client = new IncusClient();

      const { requestMock } = setupHttpMock([
        // Start → async
        {
          statusCode: 202,
          body: {
            type: 'async',
            operation: '/1.0/operations/fail-op',
            metadata: {},
          },
        },
        // Wait → failure
        {
          statusCode: 200,
          body: {
            type: 'sync',
            metadata: {
              id: 'fail-op',
              status: 'Failure',
              err: 'Instance not found',
            },
          },
        },
      ]);

      http.request = requestMock;

      await assert.rejects(
        () => client.startInstance('missing-container'),
        err => {
          assert.equal(err.name, 'IncusClientError');
          assert.ok(err.message.includes('Instance not found'));
          assert.equal(err.operation, 'startInstance');
          return true;
        }
      );
    });

    test('throws when no operation ID in async response', async () => {
      const client = new IncusClient();

      const { requestMock } = setupHttpMock([
        {
          statusCode: 202,
          body: {
            type: 'async',
            // Missing operation field
            metadata: {},
          },
        },
      ]);

      http.request = requestMock;

      await assert.rejects(
        () => client.startInstance('test-container'),
        err => {
          assert.equal(err.name, 'IncusClientError');
          assert.ok(err.message.includes('no operation ID'));
          return true;
        }
      );
    });

    test('throws on unexpected response type', async () => {
      const client = new IncusClient();

      const { requestMock } = setupHttpMock([
        {
          statusCode: 200,
          body: { type: 'unknown', metadata: {} },
        },
      ]);

      http.request = requestMock;

      await assert.rejects(
        () => client.startInstance('test-container'),
        err => {
          assert.equal(err.name, 'IncusClientError');
          assert.ok(err.message.includes('Unexpected Incus response type'));
          return true;
        }
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------------

  describe('error handling', () => {
    test('throws IncusClientError on Incus API error response', async () => {
      const client = new IncusClient();

      const { requestMock } = setupHttpMock([
        {
          statusCode: 404,
          body: {
            type: 'error',
            error: 'Instance not found',
            error_code: 404,
          },
        },
      ]);

      http.request = requestMock;

      await assert.rejects(
        () => client.getInstanceState('nonexistent'),
        err => {
          assert.equal(err.name, 'IncusClientError');
          assert.equal(err.statusCode, 404);
          assert.ok(err.message.includes('Instance not found'));
          return true;
        }
      );
    });

    test('throws on invalid JSON response', async () => {
      const client = new IncusClient();

      const { requestMock } = setupHttpMock([
        {
          statusCode: 200,
          body: 'this is not json{{{',
        },
      ]);

      http.request = requestMock;

      await assert.rejects(
        () => client.getInstanceState('test'),
        err => {
          assert.equal(err.name, 'IncusClientError');
          assert.ok(err.message.includes('Invalid JSON'));
          return true;
        }
      );
    });

    test('throws descriptive error on ENOENT (socket not found)', async () => {
      const client = new IncusClient();

      http.request = mock.fn((_options, _callback) => {
        const listeners = {};
        const req = {
          on(event, cb) {
            listeners[event] = cb;
            return req;
          },
          setTimeout() {
            return req;
          },
          write() {},
          end() {
            setImmediate(() => {
              const err = new Error('ENOENT');
              err.code = 'ENOENT';
              if (listeners.error) listeners.error(err);
            });
          },
          destroy() {},
        };
        return req;
      });

      await assert.rejects(
        () => client.listInstances(),
        err => {
          assert.equal(err.name, 'IncusClientError');
          assert.ok(err.message.includes('socket not found'));
          assert.ok(err.message.includes('Incus daemon running'));
          return true;
        }
      );
    });

    test('throws descriptive error on ECONNREFUSED', async () => {
      const client = new IncusClient();

      http.request = mock.fn((_options, _callback) => {
        const listeners = {};
        const req = {
          on(event, cb) {
            listeners[event] = cb;
            return req;
          },
          setTimeout() {
            return req;
          },
          write() {},
          end() {
            setImmediate(() => {
              const err = new Error('ECONNREFUSED');
              err.code = 'ECONNREFUSED';
              if (listeners.error) listeners.error(err);
            });
          },
          destroy() {},
        };
        return req;
      });

      await assert.rejects(
        () => client.listInstances(),
        err => {
          assert.equal(err.name, 'IncusClientError');
          assert.ok(err.message.includes('Connection refused'));
          return true;
        }
      );
    });

    test('throws generic connection error for unknown error codes', async () => {
      const client = new IncusClient();

      http.request = mock.fn((_options, _callback) => {
        const listeners = {};
        const req = {
          on(event, cb) {
            listeners[event] = cb;
            return req;
          },
          setTimeout() {
            return req;
          },
          write() {},
          end() {
            setImmediate(() => {
              const err = new Error('Something unknown');
              err.code = 'EUNKNOWN';
              if (listeners.error) listeners.error(err);
            });
          },
          destroy() {},
        };
        return req;
      });

      await assert.rejects(
        () => client.listInstances(),
        err => {
          assert.equal(err.name, 'IncusClientError');
          assert.ok(err.message.includes('Failed to connect'));
          return true;
        }
      );
    });

    test('throws on file pull 404', async () => {
      const client = new IncusClient();

      const { requestMock } = setupHttpMock([{ statusCode: 404, body: 'not found' }]);

      http.request = requestMock;

      await assert.rejects(
        () => client.pullFile('test', '/nonexistent'),
        err => {
          assert.equal(err.name, 'IncusClientError');
          assert.equal(err.statusCode, 404);
          return true;
        }
      );
    });

    test('throws on file push error', async () => {
      const client = new IncusClient();

      const { requestMock } = setupHttpMock([
        {
          statusCode: 500,
          body: JSON.stringify({ error: 'Internal error' }),
        },
      ]);

      http.request = requestMock;

      await assert.rejects(
        () => client.pushFile('test', '/tmp/fail.txt', 'content'),
        err => {
          assert.equal(err.name, 'IncusClientError');
          assert.ok(err.message.includes('file operation failed'));
          return true;
        }
      );
    });

    test('handles error_code >= 400 in response body', async () => {
      const client = new IncusClient();

      const { requestMock } = setupHttpMock([
        {
          statusCode: 200,
          body: {
            type: 'sync',
            error: 'Bad request',
            error_code: 400,
          },
        },
      ]);

      http.request = requestMock;

      await assert.rejects(
        () => client.listInstances(),
        err => {
          assert.equal(err.name, 'IncusClientError');
          assert.equal(err.statusCode, 400);
          assert.ok(err.message.includes('Bad request'));
          return true;
        }
      );
    });
  });

  // ---------------------------------------------------------------------------
  // URL encoding
  // ---------------------------------------------------------------------------

  describe('URL encoding', () => {
    test('encodes instance names in URL paths', async () => {
      const client = new IncusClient();

      const { requestMock, calls } = setupHttpMock([
        {
          statusCode: 200,
          body: { type: 'sync', metadata: { status: 'Running' } },
        },
      ]);

      http.request = requestMock;

      await client.getInstanceState('instance with spaces');

      assert.ok(calls[0].options.path.includes('instance%20with%20spaces'));
    });

    test('encodes file paths in query parameters', async () => {
      const client = new IncusClient();

      const { requestMock, calls } = setupHttpMock([{ statusCode: 200, body: 'file content' }]);

      http.request = requestMock;

      await client.pullFile('test', '/path/with spaces/file.txt');

      assert.ok(calls[0].options.path.includes('%2Fpath%2Fwith%20spaces%2Ffile.txt'));
    });
  });

  // ---------------------------------------------------------------------------
  // _extractOperationId
  // ---------------------------------------------------------------------------

  describe('_extractOperationId', () => {
    test('extracts UUID from operation path', () => {
      const client = new IncusClient();
      const id = client._extractOperationId({
        operation: '/1.0/operations/abc-def-123',
      });
      assert.equal(id, 'abc-def-123');
    });

    test('returns null when operation field is missing', () => {
      const client = new IncusClient();
      const id = client._extractOperationId({});
      assert.equal(id, null);
    });

    test('returns null when response is null', () => {
      const client = new IncusClient();
      const id = client._extractOperationId(null);
      assert.equal(id, null);
    });
  });

  // ---------------------------------------------------------------------------
  // Socket path configuration
  // ---------------------------------------------------------------------------

  describe('socket path', () => {
    test('uses socket path in HTTP request options', async () => {
      const client = new IncusClient({ socketPath: '/custom/path.socket' });

      const { requestMock, calls } = setupHttpMock([
        {
          statusCode: 200,
          body: { type: 'sync', metadata: [] },
        },
      ]);

      http.request = requestMock;

      await client.listInstances();

      assert.equal(calls[0].options.socketPath, '/custom/path.socket');
    });
  });
});
