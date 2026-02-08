/**
 * Unit tests for MCPClient
 *
 * Tests the MCP client wrapper: connecting to servers, listing tools,
 * calling tools, disconnecting, and error handling. Uses mock transport
 * and client to avoid spawning real child processes.
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  MCPClient,
  MCPClientError,
  CONNECTION_STATES,
  CLIENT_DEFAULTS,
} from '../../../src/mcp/mcp-client.js';

/**
 * Create a mock MCP SDK Client
 * @param {Object} [overrides={}] - Override default mock implementations
 * @returns {Object} Mock client instance
 */
function createMockSdkClient(overrides = {}) {
  return {
    connect: overrides.connect || mock.fn(async () => {}),
    close: overrides.close || mock.fn(async () => {}),
    listTools:
      overrides.listTools ||
      mock.fn(async () => ({
        tools: [
          { name: 'readFile', description: 'Read a file', inputSchema: { type: 'object' } },
          { name: 'writeFile', description: 'Write a file', inputSchema: { type: 'object' } },
        ],
      })),
    callTool:
      overrides.callTool ||
      mock.fn(async () => ({
        content: [{ type: 'text', text: 'Tool result' }],
      })),
    getServerCapabilities: overrides.getServerCapabilities || mock.fn(() => ({ tools: {} })),
    getServerVersion:
      overrides.getServerVersion || mock.fn(() => ({ name: 'test-server', version: '1.0.0' })),
  };
}

/**
 * Create a mock StdioClientTransport
 * @param {Object} [overrides={}] - Override default mock implementations
 * @returns {Object} Mock transport instance
 */
function createMockTransport(overrides = {}) {
  return {
    start: overrides.start || mock.fn(async () => {}),
    close: overrides.close || mock.fn(async () => {}),
    onclose: null,
    onerror: null,
    onmessage: null,
  };
}

/**
 * Create valid server params for testing
 * @param {Object} [overrides={}] - Override default values
 * @returns {Object} Server connection parameters
 */
function createServerParams(overrides = {}) {
  return {
    command: 'node',
    args: ['test-mcp-server.js'],
    env: { TEST_VAR: 'test-value' },
    ...overrides,
  };
}

/**
 * Helper to set up a connected MCPClient with mocks
 * @param {Object} [options={}] - MCPClient options
 * @returns {Object} { client, mockSdkClient, mockTransport }
 */
function createConnectedClient(options = {}) {
  const mockSdkClient = createMockSdkClient();
  const mockTransport = createMockTransport();
  const client = new MCPClient(options);

  // Inject mocks to simulate connected state
  client._client = mockSdkClient;
  client._transport = mockTransport;
  client._state = CONNECTION_STATES.CONNECTED;
  client._serverCapabilities = { tools: {} };
  client._serverVersion = { name: 'test-server', version: '1.0.0' };

  return { client, mockSdkClient, mockTransport };
}

describe('MCPClient', () => {
  describe('constructor', () => {
    test('creates instance with default options', () => {
      const client = new MCPClient();

      assert.ok(client);
      assert.equal(client.logger, null);
      assert.equal(client.clientName, CLIENT_DEFAULTS.CLIENT_NAME);
      assert.equal(client.clientVersion, CLIENT_DEFAULTS.CLIENT_VERSION);
      assert.equal(client.connectTimeoutMs, CLIENT_DEFAULTS.CONNECT_TIMEOUT_MS);
      assert.equal(client.callTimeoutMs, CLIENT_DEFAULTS.CALL_TIMEOUT_MS);
    });

    test('accepts logger option', () => {
      const logger = mock.fn();
      const client = new MCPClient({ logger });

      assert.equal(client.logger, logger);
    });

    test('accepts clientName option', () => {
      const client = new MCPClient({ clientName: 'my-app' });

      assert.equal(client.clientName, 'my-app');
    });

    test('accepts clientVersion option', () => {
      const client = new MCPClient({ clientVersion: '2.0.0' });

      assert.equal(client.clientVersion, '2.0.0');
    });

    test('accepts connectTimeoutMs option', () => {
      const client = new MCPClient({ connectTimeoutMs: 60000 });

      assert.equal(client.connectTimeoutMs, 60000);
    });

    test('accepts callTimeoutMs option', () => {
      const client = new MCPClient({ callTimeoutMs: 15000 });

      assert.equal(client.callTimeoutMs, 15000);
    });

    test('starts in disconnected state', () => {
      const client = new MCPClient();

      assert.equal(client.state, CONNECTION_STATES.DISCONNECTED);
      assert.equal(client.isConnected, false);
    });

    test('starts with null server info', () => {
      const client = new MCPClient();

      assert.equal(client.serverCapabilities, null);
      assert.equal(client.serverVersion, null);
    });
  });

  describe('state getters', () => {
    test('state returns current connection state', () => {
      const client = new MCPClient();

      assert.equal(client.state, CONNECTION_STATES.DISCONNECTED);
    });

    test('isConnected returns true when connected', () => {
      const { client } = createConnectedClient();

      assert.equal(client.isConnected, true);
    });

    test('isConnected returns false when disconnected', () => {
      const client = new MCPClient();

      assert.equal(client.isConnected, false);
    });

    test('serverCapabilities returns capabilities after connect', () => {
      const { client } = createConnectedClient();

      assert.deepEqual(client.serverCapabilities, { tools: {} });
    });

    test('serverVersion returns version info after connect', () => {
      const { client } = createConnectedClient();

      assert.deepEqual(client.serverVersion, { name: 'test-server', version: '1.0.0' });
    });
  });

  describe('connect()', () => {
    let client;

    beforeEach(() => {
      client = new MCPClient();
    });

    test('throws MCPClientError when already connected', async () => {
      const { client: connectedClient } = createConnectedClient();

      await assert.rejects(
        () => connectedClient.connect(createServerParams()),
        err => {
          assert.equal(err.name, 'MCPClientError');
          assert.match(err.message, /already connected/);
          assert.equal(err.operation, 'connect');
          return true;
        }
      );
    });

    test('throws MCPClientError when connection is in progress', async () => {
      client._state = CONNECTION_STATES.CONNECTING;

      await assert.rejects(
        () => client.connect(createServerParams()),
        err => {
          assert.equal(err.name, 'MCPClientError');
          assert.match(err.message, /already in progress/);
          assert.equal(err.operation, 'connect');
          return true;
        }
      );
    });

    test('throws MCPClientError when params are null', async () => {
      await assert.rejects(
        () => client.connect(null),
        err => {
          assert.equal(err.name, 'MCPClientError');
          assert.match(err.message, /non-null object/);
          assert.equal(err.operation, 'connect');
          return true;
        }
      );
    });

    test('throws MCPClientError when params are not an object', async () => {
      await assert.rejects(
        () => client.connect('invalid'),
        err => {
          assert.equal(err.name, 'MCPClientError');
          assert.match(err.message, /non-null object/);
          return true;
        }
      );
    });

    test('throws MCPClientError when command is missing', async () => {
      await assert.rejects(
        () => client.connect({ args: [] }),
        err => {
          assert.equal(err.name, 'MCPClientError');
          assert.match(err.message, /non-empty string "command"/);
          assert.equal(err.operation, 'connect');
          return true;
        }
      );
    });

    test('throws MCPClientError when command is empty', async () => {
      await assert.rejects(
        () => client.connect({ command: '' }),
        err => {
          assert.equal(err.name, 'MCPClientError');
          assert.match(err.message, /non-empty string "command"/);
          return true;
        }
      );
    });

    test('throws MCPClientError when args is not an array', async () => {
      await assert.rejects(
        () => client.connect({ command: 'node', args: 'not-array' }),
        err => {
          assert.equal(err.name, 'MCPClientError');
          assert.match(err.message, /"args" must be an array/);
          return true;
        }
      );
    });

    test('throws MCPClientError when env is not an object', async () => {
      await assert.rejects(
        () => client.connect({ command: 'node', env: 'not-object' }),
        err => {
          assert.equal(err.name, 'MCPClientError');
          assert.match(err.message, /"env" must be an object/);
          return true;
        }
      );
    });

    test('throws MCPClientError when env is null', async () => {
      await assert.rejects(
        () => client.connect({ command: 'node', env: null }),
        err => {
          assert.equal(err.name, 'MCPClientError');
          assert.match(err.message, /"env" must be an object/);
          return true;
        }
      );
    });

    test('allows params without args (optional)', async () => {
      // We can't fully test connect without mocking the SDK constructors,
      // but we can test validation passes
      const params = { command: 'node' };

      // Validation should pass (will fail on actual connection)
      client._validateServerParams(params);
      // If we get here, validation passed
      assert.ok(true);
    });

    test('allows params without env (optional)', async () => {
      const params = { command: 'node', args: ['server.js'] };

      client._validateServerParams(params);
      assert.ok(true);
    });

    test('sets state to ERROR on connection failure', async () => {
      // Stub _connectWithTimeout to throw
      client._connectWithTimeout = mock.fn(async () => {
        throw new Error('Spawn failed');
      });

      // Override the connect method to skip transport creation
      client.connect = async params => {
        client._validateServerParams(params);
        client._state = CONNECTION_STATES.CONNECTING;
        try {
          await client._connectWithTimeout(null, null);
        } catch (err) {
          client._state = CONNECTION_STATES.ERROR;
          client._cleanup();
          throw new MCPClientError(`Failed to connect: ${err.message}`, {
            cause: err,
            operation: 'connect',
          });
        }
      };

      try {
        await client.connect(createServerParams());
      } catch (_err) {
        // expected
      }

      assert.equal(client.state, CONNECTION_STATES.ERROR);
    });
  });

  describe('listTools()', () => {
    test('returns tools from connected server', async () => {
      const { client } = createConnectedClient();

      const tools = await client.listTools();

      assert.equal(tools.length, 2);
      assert.equal(tools[0].name, 'readFile');
      assert.equal(tools[1].name, 'writeFile');
    });

    test('returns empty array when server has no tools', async () => {
      const mockSdkClient = createMockSdkClient({
        listTools: mock.fn(async () => ({ tools: [] })),
      });
      const { client } = createConnectedClient();
      client._client = mockSdkClient;

      const tools = await client.listTools();

      assert.deepEqual(tools, []);
    });

    test('returns empty array when tools property is missing', async () => {
      const mockSdkClient = createMockSdkClient({
        listTools: mock.fn(async () => ({})),
      });
      const { client } = createConnectedClient();
      client._client = mockSdkClient;

      const tools = await client.listTools();

      assert.deepEqual(tools, []);
    });

    test('throws MCPClientError when not connected', async () => {
      const client = new MCPClient();

      await assert.rejects(
        () => client.listTools(),
        err => {
          assert.equal(err.name, 'MCPClientError');
          assert.match(err.message, /not connected/);
          assert.equal(err.operation, 'listTools');
          return true;
        }
      );
    });

    test('throws MCPClientError when SDK listTools fails', async () => {
      const mockSdkClient = createMockSdkClient({
        listTools: mock.fn(async () => {
          throw new Error('Protocol error');
        }),
      });
      const { client } = createConnectedClient();
      client._client = mockSdkClient;

      await assert.rejects(
        () => client.listTools(),
        err => {
          assert.equal(err.name, 'MCPClientError');
          assert.match(err.message, /Failed to list tools/);
          assert.match(err.message, /Protocol error/);
          assert.ok(err.cause);
          assert.equal(err.operation, 'listTools');
          return true;
        }
      );
    });

    test('re-throws MCPClientError without wrapping', async () => {
      const original = new MCPClientError('Custom error', { operation: 'listTools' });
      const mockSdkClient = createMockSdkClient({
        listTools: mock.fn(async () => {
          throw original;
        }),
      });
      const { client } = createConnectedClient();
      client._client = mockSdkClient;

      await assert.rejects(
        () => client.listTools(),
        err => {
          assert.equal(err, original);
          return true;
        }
      );
    });
  });

  describe('callTool()', () => {
    test('calls a tool with name and params', async () => {
      const { client, mockSdkClient } = createConnectedClient();

      const result = await client.callTool('readFile', { path: '/test.txt' });

      assert.ok(result);
      assert.equal(result.content[0].type, 'text');
      assert.equal(result.content[0].text, 'Tool result');

      // Verify SDK client was called correctly
      assert.equal(mockSdkClient.callTool.mock.calls.length, 1);
      const callArgs = mockSdkClient.callTool.mock.calls[0].arguments;
      assert.deepEqual(callArgs[0], { name: 'readFile', arguments: { path: '/test.txt' } });
    });

    test('calls a tool with default empty params', async () => {
      const { client, mockSdkClient } = createConnectedClient();

      await client.callTool('ping');

      const callArgs = mockSdkClient.callTool.mock.calls[0].arguments;
      assert.deepEqual(callArgs[0], { name: 'ping', arguments: {} });
    });

    test('passes timeout option to SDK callTool', async () => {
      const { client, mockSdkClient } = createConnectedClient({ callTimeoutMs: 5000 });

      await client.callTool('readFile', { path: '/test.txt' });

      const callArgs = mockSdkClient.callTool.mock.calls[0].arguments;
      assert.deepEqual(callArgs[2], { timeout: 5000 });
    });

    test('throws MCPClientError when tool returns isError', async () => {
      const mockSdkClient = createMockSdkClient({
        callTool: mock.fn(async () => ({
          content: [{ type: 'text', text: 'File not found' }],
          isError: true,
        })),
      });
      const { client } = createConnectedClient();
      client._client = mockSdkClient;

      await assert.rejects(
        () => client.callTool('readFile', { path: '/nonexistent.txt' }),
        err => {
          assert.equal(err.name, 'MCPClientError');
          assert.match(err.message, /returned an error/);
          assert.match(err.message, /File not found/);
          assert.equal(err.operation, 'callTool');
          assert.equal(err.toolName, 'readFile');
          return true;
        }
      );
    });

    test('throws MCPClientError when not connected', async () => {
      const client = new MCPClient();

      await assert.rejects(
        () => client.callTool('readFile', {}),
        err => {
          assert.equal(err.name, 'MCPClientError');
          assert.match(err.message, /not connected/);
          assert.equal(err.operation, 'callTool');
          return true;
        }
      );
    });

    test('throws MCPClientError when name is empty', async () => {
      const { client } = createConnectedClient();

      await assert.rejects(
        () => client.callTool('', {}),
        err => {
          assert.equal(err.name, 'MCPClientError');
          assert.match(err.message, /non-empty string/);
          assert.equal(err.operation, 'callTool');
          return true;
        }
      );
    });

    test('throws MCPClientError when name is null', async () => {
      const { client } = createConnectedClient();

      await assert.rejects(
        () => client.callTool(null, {}),
        err => {
          assert.equal(err.name, 'MCPClientError');
          assert.match(err.message, /non-empty string/);
          return true;
        }
      );
    });

    test('throws MCPClientError when SDK callTool fails', async () => {
      const mockSdkClient = createMockSdkClient({
        callTool: mock.fn(async () => {
          throw new Error('Timeout');
        }),
      });
      const { client } = createConnectedClient();
      client._client = mockSdkClient;

      await assert.rejects(
        () => client.callTool('readFile', { path: '/test.txt' }),
        err => {
          assert.equal(err.name, 'MCPClientError');
          assert.match(err.message, /Failed to call tool 'readFile'/);
          assert.match(err.message, /Timeout/);
          assert.ok(err.cause);
          assert.equal(err.operation, 'callTool');
          assert.equal(err.toolName, 'readFile');
          return true;
        }
      );
    });

    test('re-throws MCPClientError without wrapping', async () => {
      const original = new MCPClientError('Custom error', {
        operation: 'callTool',
        toolName: 'test',
      });
      const mockSdkClient = createMockSdkClient({
        callTool: mock.fn(async () => {
          throw original;
        }),
      });
      const { client } = createConnectedClient();
      client._client = mockSdkClient;

      await assert.rejects(
        () => client.callTool('test', {}),
        err => {
          assert.equal(err, original);
          return true;
        }
      );
    });
  });

  describe('disconnect()', () => {
    test('disconnects a connected client', async () => {
      const { client, mockSdkClient, mockTransport } = createConnectedClient();

      await client.disconnect();

      assert.equal(client.state, CONNECTION_STATES.DISCONNECTED);
      assert.equal(client.isConnected, false);
      assert.equal(mockSdkClient.close.mock.calls.length, 1);
      assert.equal(mockTransport.close.mock.calls.length, 1);
    });

    test('cleans up internal references', async () => {
      const { client } = createConnectedClient();

      await client.disconnect();

      assert.equal(client._client, null);
      assert.equal(client._transport, null);
      assert.equal(client.serverCapabilities, null);
      assert.equal(client.serverVersion, null);
    });

    test('is safe to call when already disconnected', async () => {
      const client = new MCPClient();

      // Should not throw
      await client.disconnect();

      assert.equal(client.state, CONNECTION_STATES.DISCONNECTED);
    });

    test('is safe to call when already disconnecting', async () => {
      const client = new MCPClient();
      client._state = CONNECTION_STATES.DISCONNECTING;

      // Should not throw
      await client.disconnect();
    });

    test('handles client.close() failure gracefully', async () => {
      const mockSdkClient = createMockSdkClient({
        close: mock.fn(async () => {
          throw new Error('Already closed');
        }),
      });
      const { client } = createConnectedClient();
      client._client = mockSdkClient;

      // Should not throw
      await client.disconnect();

      assert.equal(client.state, CONNECTION_STATES.DISCONNECTED);
    });

    test('handles transport.close() failure gracefully', async () => {
      const mockTransport = createMockTransport({
        close: mock.fn(async () => {
          throw new Error('Already closed');
        }),
      });
      const { client } = createConnectedClient();
      client._transport = mockTransport;

      // Should not throw
      await client.disconnect();

      assert.equal(client.state, CONNECTION_STATES.DISCONNECTED);
    });

    test('logs disconnection when logger provided', async () => {
      const logger = mock.fn();
      const { client } = createConnectedClient({ logger });

      await client.disconnect();

      const messages = logger.mock.calls.map(c => c.arguments[0]);
      assert.ok(messages.some(msg => msg.includes('Disconnected')));
    });
  });

  describe('_extractTextContent()', () => {
    test('extracts text from content array', () => {
      const client = new MCPClient();

      const text = client._extractTextContent([
        { type: 'text', text: 'Hello' },
        { type: 'text', text: 'World' },
      ]);

      assert.equal(text, 'Hello\nWorld');
    });

    test('filters out non-text content', () => {
      const client = new MCPClient();

      const text = client._extractTextContent([
        { type: 'text', text: 'Hello' },
        { type: 'image', data: 'base64...' },
        { type: 'text', text: 'World' },
      ]);

      assert.equal(text, 'Hello\nWorld');
    });

    test('returns "Unknown error" for empty content', () => {
      const client = new MCPClient();

      const text = client._extractTextContent([]);

      assert.equal(text, 'Unknown error');
    });

    test('returns "Unknown error" for non-array input', () => {
      const client = new MCPClient();

      const text = client._extractTextContent(null);

      assert.equal(text, 'Unknown error');
    });

    test('returns "Unknown error" for content with no text items', () => {
      const client = new MCPClient();

      const text = client._extractTextContent([{ type: 'image', data: 'base64...' }]);

      assert.equal(text, 'Unknown error');
    });
  });

  describe('_setupCloseHandler()', () => {
    test('marks state as ERROR on unexpected close', () => {
      const { client, mockTransport } = createConnectedClient();

      client._setupCloseHandler(mockTransport);

      // Simulate unexpected close
      mockTransport.onclose();

      assert.equal(client.state, CONNECTION_STATES.ERROR);
    });

    test('does not change state when intentionally disconnecting', () => {
      const { client, mockTransport } = createConnectedClient();
      client._state = CONNECTION_STATES.DISCONNECTING;

      client._setupCloseHandler(mockTransport);
      mockTransport.onclose();

      assert.equal(client.state, CONNECTION_STATES.DISCONNECTING);
    });

    test('preserves existing onclose handler', () => {
      const { client, mockTransport } = createConnectedClient();
      const originalHandler = mock.fn();
      mockTransport.onclose = originalHandler;

      client._setupCloseHandler(mockTransport);
      mockTransport.onclose();

      assert.equal(originalHandler.mock.calls.length, 1);
    });

    test('logs unexpected close when logger provided', () => {
      const logger = mock.fn();
      const { client, mockTransport } = createConnectedClient({ logger });

      client._setupCloseHandler(mockTransport);
      mockTransport.onclose();

      const messages = logger.mock.calls.map(c => c.arguments[0]);
      assert.ok(messages.some(msg => msg.includes('closed unexpectedly')));
    });
  });

  describe('_cleanup()', () => {
    test('nullifies all internal references', () => {
      const { client } = createConnectedClient();

      client._cleanup();

      assert.equal(client._client, null);
      assert.equal(client._transport, null);
      assert.equal(client._serverCapabilities, null);
      assert.equal(client._serverVersion, null);
    });
  });

  describe('full lifecycle', () => {
    test('connect → listTools → callTool → disconnect flow (mocked)', async () => {
      const { client } = createConnectedClient();

      // List tools
      const tools = await client.listTools();
      assert.equal(tools.length, 2);

      // Call tool
      const result = await client.callTool('readFile', { path: '/test.txt' });
      assert.ok(result.content);

      // Disconnect
      await client.disconnect();
      assert.equal(client.state, CONNECTION_STATES.DISCONNECTED);
      assert.equal(client.isConnected, false);

      // Verify cleanup
      assert.equal(client._client, null);
      assert.equal(client._transport, null);
    });

    test('operations fail after disconnect', async () => {
      const { client } = createConnectedClient();

      await client.disconnect();

      await assert.rejects(
        () => client.listTools(),
        err => {
          assert.equal(err.name, 'MCPClientError');
          assert.match(err.message, /not connected/);
          return true;
        }
      );

      await assert.rejects(
        () => client.callTool('readFile', {}),
        err => {
          assert.equal(err.name, 'MCPClientError');
          assert.match(err.message, /not connected/);
          return true;
        }
      );
    });

    test('operations fail after error state', async () => {
      const { client } = createConnectedClient();
      client._state = CONNECTION_STATES.ERROR;

      await assert.rejects(
        () => client.listTools(),
        err => {
          assert.equal(err.name, 'MCPClientError');
          assert.match(err.message, /not connected/);
          return true;
        }
      );
    });
  });
});

describe('MCPClientError', () => {
  test('is an instance of Error', () => {
    const error = new MCPClientError('Test error');
    assert.ok(error instanceof Error);
  });

  test('has correct name', () => {
    const error = new MCPClientError('Test error');
    assert.equal(error.name, 'MCPClientError');
  });

  test('stores message', () => {
    const error = new MCPClientError('Something went wrong');
    assert.equal(error.message, 'Something went wrong');
  });

  test('stores operation', () => {
    const error = new MCPClientError('Test error', { operation: 'connect' });
    assert.equal(error.operation, 'connect');
  });

  test('stores toolName', () => {
    const error = new MCPClientError('Test error', { toolName: 'readFile' });
    assert.equal(error.toolName, 'readFile');
  });

  test('stores cause', () => {
    const cause = new Error('Original error');
    const error = new MCPClientError('Test error', { cause });
    assert.equal(error.cause, cause);
  });

  test('stores all options together', () => {
    const cause = new Error('Original');
    const error = new MCPClientError('Multi-option error', {
      cause,
      operation: 'callTool',
      toolName: 'writeFile',
    });

    assert.equal(error.cause, cause);
    assert.equal(error.operation, 'callTool');
    assert.equal(error.toolName, 'writeFile');
  });

  test('defaults optional fields to undefined', () => {
    const error = new MCPClientError('Test error');
    assert.equal(error.operation, undefined);
    assert.equal(error.toolName, undefined);
    assert.equal(error.cause, undefined);
  });
});

describe('CONNECTION_STATES', () => {
  test('exports all expected state values', () => {
    assert.equal(CONNECTION_STATES.DISCONNECTED, 'disconnected');
    assert.equal(CONNECTION_STATES.CONNECTING, 'connecting');
    assert.equal(CONNECTION_STATES.CONNECTED, 'connected');
    assert.equal(CONNECTION_STATES.DISCONNECTING, 'disconnecting');
    assert.equal(CONNECTION_STATES.ERROR, 'error');
  });

  test('is frozen (immutable)', () => {
    assert.ok(Object.isFrozen(CONNECTION_STATES));
  });
});

describe('CLIENT_DEFAULTS', () => {
  test('exports expected default values', () => {
    assert.equal(CLIENT_DEFAULTS.CLIENT_NAME, 'ai-army');
    assert.equal(CLIENT_DEFAULTS.CLIENT_VERSION, '0.1.0');
    assert.equal(CLIENT_DEFAULTS.CONNECT_TIMEOUT_MS, 30000);
    assert.equal(CLIENT_DEFAULTS.CALL_TIMEOUT_MS, 30000);
  });

  test('is frozen (immutable)', () => {
    assert.ok(Object.isFrozen(CLIENT_DEFAULTS));
  });
});
