/**
 * Unit tests for MCPManager
 *
 * Tests MCP server process lifecycle management: starting, stopping,
 * tool discovery, crash recovery with auto-restart, and error handling.
 *
 * Uses mock transport and client to avoid spawning real child processes.
 */

import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  MCPManager,
  MCPManagerError,
  SERVER_STATUSES,
  DEFAULTS,
} from '../../../src/mcp/mcp-manager.js';

/**
 * Create a mock MCP client
 * @param {Object} [overrides={}] - Override default mock implementations
 * @returns {Object} Mock client instance
 */
function createMockClient(overrides = {}) {
  return {
    connect: overrides.connect || mock.fn(async () => {}),
    close: overrides.close || mock.fn(async () => {}),
    listTools:
      overrides.listTools ||
      mock.fn(async () => ({
        tools: [{ name: 'test-tool', description: 'A test tool', inputSchema: { type: 'object' } }],
      })),
    callTool: overrides.callTool || mock.fn(async () => ({ content: [] })),
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
 * Create a valid server config for testing
 * @param {Object} [overrides={}] - Override default config values
 * @returns {Object} Server configuration
 */
function createServerConfig(overrides = {}) {
  return {
    id: 'test-server',
    command: 'node',
    args: ['test-mcp-server.js'],
    env: { TEST_VAR: 'test-value' },
    ...overrides,
  };
}

describe('MCPManager', () => {
  let manager;
  let mockClient;
  let mockTransport;
  beforeEach(() => {
    mockClient = createMockClient();
    mockTransport = createMockTransport();

    manager = new MCPManager();

    // Stub _connectServer to use mocks instead of real MCP SDK
    manager._connectServer = mock.fn(async server => {
      server.transport = mockTransport;
      server.client = mockClient;
      server.tools = [
        { name: 'test-tool', description: 'A test tool', inputSchema: { type: 'object' } },
      ];
    });
  });

  afterEach(async () => {
    // Ensure all servers are cleaned up
    for (const [id] of manager.servers) {
      const server = manager.servers.get(id);
      if (server) {
        server.status = SERVER_STATUSES.STOPPING;
      }
    }
    manager.servers.clear();
  });

  describe('constructor', () => {
    test('creates instance with empty server registry', () => {
      const m = new MCPManager();
      assert.ok(m);
      assert.ok(m.servers instanceof Map);
      assert.equal(m.servers.size, 0);
    });

    test('accepts logger option', () => {
      const logger = mock.fn();
      const m = new MCPManager({ logger });
      assert.equal(m.logger, logger);
    });

    test('defaults logger to null', () => {
      const m = new MCPManager();
      assert.equal(m.logger, null);
    });

    test('accepts maxRestarts option', () => {
      const m = new MCPManager({ maxRestarts: 5 });
      assert.equal(m.maxRestarts, 5);
    });

    test('defaults maxRestarts to DEFAULTS.MAX_RESTARTS', () => {
      const m = new MCPManager();
      assert.equal(m.maxRestarts, DEFAULTS.MAX_RESTARTS);
    });

    test('accepts restartDelayMs option', () => {
      const m = new MCPManager({ restartDelayMs: 2000 });
      assert.equal(m.restartDelayMs, 2000);
    });

    test('defaults restartDelayMs to DEFAULTS.RESTART_DELAY_MS', () => {
      const m = new MCPManager();
      assert.equal(m.restartDelayMs, DEFAULTS.RESTART_DELAY_MS);
    });

    test('accepts connectTimeoutMs option', () => {
      const m = new MCPManager({ connectTimeoutMs: 60000 });
      assert.equal(m.connectTimeoutMs, 60000);
    });

    test('defaults connectTimeoutMs to DEFAULTS.CONNECT_TIMEOUT_MS', () => {
      const m = new MCPManager();
      assert.equal(m.connectTimeoutMs, DEFAULTS.CONNECT_TIMEOUT_MS);
    });

    test('allows maxRestarts of 0', () => {
      const m = new MCPManager({ maxRestarts: 0 });
      assert.equal(m.maxRestarts, 0);
    });
  });

  describe('startServer()', () => {
    test('starts a server with valid config', async () => {
      const config = createServerConfig();
      const server = await manager.startServer(config);

      assert.ok(server);
      assert.equal(server.id, 'test-server');
      assert.equal(server.status, SERVER_STATUSES.RUNNING);
      assert.ok(server.createdAt instanceof Date);
    });

    test('stores server in registry', async () => {
      const config = createServerConfig();
      await manager.startServer(config);

      assert.equal(manager.servers.size, 1);
      assert.ok(manager.servers.has('test-server'));
    });

    test('calls _connectServer with server entry', async () => {
      const config = createServerConfig();
      await manager.startServer(config);

      assert.equal(manager._connectServer.mock.calls.length, 1);
      const serverArg = manager._connectServer.mock.calls[0].arguments[0];
      assert.equal(serverArg.id, 'test-server');
      assert.equal(serverArg.config, config);
    });

    test('discovers tools during startup', async () => {
      const config = createServerConfig();
      const server = await manager.startServer(config);

      assert.equal(server.tools.length, 1);
      assert.equal(server.tools[0].name, 'test-tool');
    });

    test('initializes restartCount to 0', async () => {
      const config = createServerConfig();
      const server = await manager.startServer(config);

      assert.equal(server.restartCount, 0);
    });

    test('stores config on server entry', async () => {
      const config = createServerConfig();
      const server = await manager.startServer(config);

      assert.equal(server.config, config);
    });

    test('starts multiple servers', async () => {
      await manager.startServer(createServerConfig({ id: 'server-1' }));
      await manager.startServer(createServerConfig({ id: 'server-2' }));

      assert.equal(manager.servers.size, 2);
      assert.ok(manager.servers.has('server-1'));
      assert.ok(manager.servers.has('server-2'));
    });

    test('stops existing server when re-starting same id', async () => {
      await manager.startServer(createServerConfig());

      const firstServer = manager.servers.get('test-server');
      const firstTransport = firstServer.transport;

      await manager.startServer(createServerConfig());

      // Old transport should have been closed
      assert.equal(firstTransport.close.mock.calls.length, 1);
      assert.equal(manager.servers.size, 1);
    });

    test('logs startup when logger provided', async () => {
      const logger = mock.fn();
      manager.logger = logger;

      await manager.startServer(createServerConfig());

      const messages = logger.mock.calls.map(c => c.arguments[0]);
      assert.ok(messages.some(msg => msg.includes('Started MCP server: test-server')));
    });

    test('includes tool count in log message', async () => {
      const logger = mock.fn();
      manager.logger = logger;

      await manager.startServer(createServerConfig());

      const messages = logger.mock.calls.map(c => c.arguments[0]);
      assert.ok(messages.some(msg => msg.includes('1 tools')));
    });

    test('throws MCPManagerError when config is null', async () => {
      await assert.rejects(
        () => manager.startServer(null),
        err => {
          assert.equal(err.name, 'MCPManagerError');
          assert.match(err.message, /Server config must be a non-null object/);
          assert.equal(err.operation, 'startServer');
          return true;
        }
      );
    });

    test('throws MCPManagerError when config is not an object', async () => {
      await assert.rejects(
        () => manager.startServer('invalid'),
        err => {
          assert.equal(err.name, 'MCPManagerError');
          assert.match(err.message, /Server config must be a non-null object/);
          return true;
        }
      );
    });

    test('throws MCPManagerError when config.id is missing', async () => {
      await assert.rejects(
        () => manager.startServer({ command: 'node' }),
        err => {
          assert.equal(err.name, 'MCPManagerError');
          assert.match(err.message, /non-empty string "id"/);
          assert.equal(err.operation, 'startServer');
          return true;
        }
      );
    });

    test('throws MCPManagerError when config.id is empty', async () => {
      await assert.rejects(
        () => manager.startServer({ id: '', command: 'node' }),
        err => {
          assert.equal(err.name, 'MCPManagerError');
          assert.match(err.message, /non-empty string "id"/);
          return true;
        }
      );
    });

    test('throws MCPManagerError when config.command is missing', async () => {
      await assert.rejects(
        () => manager.startServer({ id: 'test' }),
        err => {
          assert.equal(err.name, 'MCPManagerError');
          assert.match(err.message, /non-empty string "command"/);
          assert.equal(err.serverId, 'test');
          return true;
        }
      );
    });

    test('throws MCPManagerError when config.command is empty', async () => {
      await assert.rejects(
        () => manager.startServer({ id: 'test', command: '' }),
        err => {
          assert.equal(err.name, 'MCPManagerError');
          assert.match(err.message, /non-empty string "command"/);
          return true;
        }
      );
    });

    test('throws MCPManagerError when config.args is not an array', async () => {
      await assert.rejects(
        () => manager.startServer({ id: 'test', command: 'node', args: 'not-array' }),
        err => {
          assert.equal(err.name, 'MCPManagerError');
          assert.match(err.message, /"args" must be an array/);
          assert.equal(err.serverId, 'test');
          return true;
        }
      );
    });

    test('throws MCPManagerError when config.env is not an object', async () => {
      await assert.rejects(
        () => manager.startServer({ id: 'test', command: 'node', env: 'not-object' }),
        err => {
          assert.equal(err.name, 'MCPManagerError');
          assert.match(err.message, /"env" must be an object/);
          assert.equal(err.serverId, 'test');
          return true;
        }
      );
    });

    test('allows config without args (optional)', async () => {
      const config = createServerConfig();
      delete config.args;
      const server = await manager.startServer(config);

      assert.equal(server.status, SERVER_STATUSES.RUNNING);
    });

    test('allows config without env (optional)', async () => {
      const config = createServerConfig();
      delete config.env;
      const server = await manager.startServer(config);

      assert.equal(server.status, SERVER_STATUSES.RUNNING);
    });

    test('throws MCPManagerError when connection fails', async () => {
      manager._connectServer = mock.fn(async () => {
        throw new Error('Connection refused');
      });

      await assert.rejects(
        () => manager.startServer(createServerConfig()),
        err => {
          assert.equal(err.name, 'MCPManagerError');
          assert.match(err.message, /Failed to start MCP server 'test-server'/);
          assert.match(err.message, /Connection refused/);
          assert.ok(err.cause);
          assert.equal(err.operation, 'startServer');
          assert.equal(err.serverId, 'test-server');
          return true;
        }
      );
    });

    test('does not store server in registry when connection fails', async () => {
      manager._connectServer = mock.fn(async () => {
        throw new Error('Connection refused');
      });

      try {
        await manager.startServer(createServerConfig());
      } catch (_err) {
        // expected
      }

      assert.equal(manager.servers.has('test-server'), false);
    });

    test('re-throws MCPManagerError without wrapping', async () => {
      const original = new MCPManagerError('Custom error', {
        operation: 'startServer',
        serverId: 'test-server',
      });
      manager._connectServer = mock.fn(async () => {
        throw original;
      });

      await assert.rejects(
        () => manager.startServer(createServerConfig()),
        err => {
          assert.equal(err, original);
          return true;
        }
      );
    });
  });

  describe('stopServer()', () => {
    test('stops a running server', async () => {
      await manager.startServer(createServerConfig());

      await manager.stopServer('test-server');

      assert.equal(manager.servers.has('test-server'), false);
    });

    test('closes client and transport', async () => {
      await manager.startServer(createServerConfig());

      await manager.stopServer('test-server');

      assert.equal(mockClient.close.mock.calls.length, 1);
      assert.equal(mockTransport.close.mock.calls.length, 1);
    });

    test('removes server from registry', async () => {
      await manager.startServer(createServerConfig());
      assert.equal(manager.servers.size, 1);

      await manager.stopServer('test-server');
      assert.equal(manager.servers.size, 0);
    });

    test('logs stop when logger provided', async () => {
      const logger = mock.fn();
      manager.logger = logger;

      await manager.startServer(createServerConfig());
      await manager.stopServer('test-server');

      const messages = logger.mock.calls.map(c => c.arguments[0]);
      assert.ok(messages.some(msg => msg.includes('Stopped MCP server: test-server')));
    });

    test('throws MCPManagerError when id is empty', async () => {
      await assert.rejects(
        () => manager.stopServer(''),
        err => {
          assert.equal(err.name, 'MCPManagerError');
          assert.match(err.message, /Server ID must be a non-empty string/);
          assert.equal(err.operation, 'stopServer');
          return true;
        }
      );
    });

    test('throws MCPManagerError when id is null', async () => {
      await assert.rejects(
        () => manager.stopServer(null),
        err => {
          assert.equal(err.name, 'MCPManagerError');
          assert.match(err.message, /Server ID must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws MCPManagerError when server not found', async () => {
      await assert.rejects(
        () => manager.stopServer('nonexistent'),
        err => {
          assert.equal(err.name, 'MCPManagerError');
          assert.match(err.message, /Server 'nonexistent' not found/);
          assert.equal(err.operation, 'stopServer');
          assert.equal(err.serverId, 'nonexistent');
          return true;
        }
      );
    });

    test('handles client.close() failure gracefully', async () => {
      mockClient.close = mock.fn(async () => {
        throw new Error('Already closed');
      });

      await manager.startServer(createServerConfig());

      // Should not throw
      await manager.stopServer('test-server');
      assert.equal(manager.servers.has('test-server'), false);
    });

    test('handles transport.close() failure gracefully', async () => {
      mockTransport.close = mock.fn(async () => {
        throw new Error('Already closed');
      });

      await manager.startServer(createServerConfig());

      // Should not throw
      await manager.stopServer('test-server');
      assert.equal(manager.servers.has('test-server'), false);
    });

    test('clears tools on stop', async () => {
      await manager.startServer(createServerConfig());

      const server = manager.servers.get('test-server');
      assert.equal(server.tools.length, 1);

      // Directly check internal state before deletion
      await manager._stopServer('test-server');
      assert.equal(server.tools.length, 0);
    });

    test('nullifies client and transport on stop', async () => {
      await manager.startServer(createServerConfig());

      const server = manager.servers.get('test-server');
      await manager._stopServer('test-server');

      assert.equal(server.client, null);
      assert.equal(server.transport, null);
    });
  });

  describe('listServers()', () => {
    test('returns empty array when no servers registered', () => {
      const servers = manager.listServers();
      assert.deepEqual(servers, []);
    });

    test('returns all registered servers', async () => {
      await manager.startServer(createServerConfig({ id: 'server-1' }));
      await manager.startServer(createServerConfig({ id: 'server-2' }));

      const servers = manager.listServers();

      assert.equal(servers.length, 2);
      const ids = servers.map(s => s.id);
      assert.ok(ids.includes('server-1'));
      assert.ok(ids.includes('server-2'));
    });

    test('returns array not a Map iterator', () => {
      const servers = manager.listServers();
      assert.ok(Array.isArray(servers));
    });
  });

  describe('getServerTools()', () => {
    test('returns tools for a running server', async () => {
      await manager.startServer(createServerConfig());

      const tools = manager.getServerTools('test-server');

      assert.equal(tools.length, 1);
      assert.equal(tools[0].name, 'test-tool');
    });

    test('returns a copy of the tools array', async () => {
      await manager.startServer(createServerConfig());

      const tools1 = manager.getServerTools('test-server');
      const tools2 = manager.getServerTools('test-server');

      assert.notEqual(tools1, tools2);
      assert.deepEqual(tools1, tools2);
    });

    test('throws MCPManagerError when id is empty', () => {
      assert.throws(
        () => manager.getServerTools(''),
        err => {
          assert.equal(err.name, 'MCPManagerError');
          assert.match(err.message, /Server ID must be a non-empty string/);
          assert.equal(err.operation, 'getServerTools');
          return true;
        }
      );
    });

    test('throws MCPManagerError when id is null', () => {
      assert.throws(
        () => manager.getServerTools(null),
        err => {
          assert.equal(err.name, 'MCPManagerError');
          assert.match(err.message, /Server ID must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws MCPManagerError when server not found', () => {
      assert.throws(
        () => manager.getServerTools('nonexistent'),
        err => {
          assert.equal(err.name, 'MCPManagerError');
          assert.match(err.message, /Server 'nonexistent' not found/);
          assert.equal(err.operation, 'getServerTools');
          assert.equal(err.serverId, 'nonexistent');
          return true;
        }
      );
    });
  });

  describe('getServer()', () => {
    test('returns server entry for existing server', async () => {
      await manager.startServer(createServerConfig());

      const server = manager.getServer('test-server');

      assert.ok(server);
      assert.equal(server.id, 'test-server');
      assert.equal(server.status, SERVER_STATUSES.RUNNING);
    });

    test('returns undefined for unknown server', () => {
      const server = manager.getServer('nonexistent');
      assert.equal(server, undefined);
    });

    test('returns server with all expected properties', async () => {
      await manager.startServer(createServerConfig());

      const server = manager.getServer('test-server');

      assert.equal(typeof server.id, 'string');
      assert.equal(typeof server.config, 'object');
      assert.ok(server.client);
      assert.ok(server.transport);
      assert.ok(Array.isArray(server.tools));
      assert.equal(typeof server.status, 'string');
      assert.equal(typeof server.restartCount, 'number');
      assert.ok(server.createdAt instanceof Date);
    });
  });

  describe('hasServer()', () => {
    test('returns true for existing server', async () => {
      await manager.startServer(createServerConfig());
      assert.equal(manager.hasServer('test-server'), true);
    });

    test('returns false for unknown server', () => {
      assert.equal(manager.hasServer('nonexistent'), false);
    });
  });

  describe('getServerCount()', () => {
    test('returns 0 when no servers registered', () => {
      assert.equal(manager.getServerCount(), 0);
    });

    test('returns total count when no status filter', async () => {
      await manager.startServer(createServerConfig({ id: 'server-1' }));
      await manager.startServer(createServerConfig({ id: 'server-2' }));

      assert.equal(manager.getServerCount(), 2);
    });

    test('returns count filtered by status', async () => {
      await manager.startServer(createServerConfig({ id: 'server-1' }));
      await manager.startServer(createServerConfig({ id: 'server-2' }));

      assert.equal(manager.getServerCount(SERVER_STATUSES.RUNNING), 2);
      assert.equal(manager.getServerCount(SERVER_STATUSES.STOPPED), 0);
    });
  });

  describe('stopAll()', () => {
    test('stops all registered servers', async () => {
      await manager.startServer(createServerConfig({ id: 'server-1' }));
      await manager.startServer(createServerConfig({ id: 'server-2' }));

      const results = await manager.stopAll();

      assert.equal(results.stopped.length, 2);
      assert.equal(results.failed.length, 0);
      assert.ok(results.stopped.includes('server-1'));
      assert.ok(results.stopped.includes('server-2'));
    });

    test('clears server registry after stopping', async () => {
      await manager.startServer(createServerConfig());

      await manager.stopAll();

      assert.equal(manager.servers.size, 0);
    });

    test('collects failures without throwing', async () => {
      await manager.startServer(createServerConfig({ id: 'server-1' }));

      // Make the second server's stop fail
      const failTransport = createMockTransport();
      const failClient = createMockClient();
      manager._connectServer = mock.fn(async server => {
        server.transport = failTransport;
        server.client = failClient;
        server.tools = [];
      });
      await manager.startServer(createServerConfig({ id: 'server-2' }));

      // Make _stopServer throw for server-2
      const originalStop = manager._stopServer.bind(manager);
      manager._stopServer = async id => {
        if (id === 'server-2') {
          throw new Error('Stop failed for server-2');
        }
        return originalStop(id);
      };

      const results = await manager.stopAll();

      assert.equal(results.stopped.length, 1);
      assert.equal(results.failed.length, 1);
      assert.ok(results.stopped.includes('server-1'));
      assert.equal(results.failed[0].id, 'server-2');
      assert.ok(results.failed[0].error);
    });

    test('returns empty results when no servers registered', async () => {
      const results = await manager.stopAll();

      assert.deepEqual(results, { stopped: [], failed: [] });
    });
  });

  describe('crash recovery', () => {
    test('sets up crash handler on transport', async () => {
      // Use real _setupCrashHandler
      const realConnect = async server => {
        server.transport = mockTransport;
        server.client = mockClient;
        server.tools = [];
        manager._setupCrashHandler(server);
      };
      manager._connectServer = mock.fn(realConnect);

      await manager.startServer(createServerConfig());

      const server = manager.servers.get('test-server');
      assert.ok(server.transport.onclose);
    });

    test('detects crash when transport closes unexpectedly', async () => {
      const logger = mock.fn();
      manager.logger = logger;
      manager.maxRestarts = 0; // Disable auto-restart for this test

      const realConnect = async server => {
        server.transport = mockTransport;
        server.client = mockClient;
        server.tools = [];
        manager._setupCrashHandler(server);
      };
      manager._connectServer = mock.fn(realConnect);

      await manager.startServer(createServerConfig());

      const server = manager.servers.get('test-server');
      assert.equal(server.status, SERVER_STATUSES.RUNNING);

      // Simulate crash
      mockTransport.onclose();

      assert.equal(server.status, SERVER_STATUSES.ERROR);
      const messages = logger.mock.calls.map(c => c.arguments[0]);
      assert.ok(messages.some(msg => msg.includes('crashed')));
    });

    test('does not trigger restart when server is intentionally stopped', async () => {
      const logger = mock.fn();
      manager.logger = logger;

      const realConnect = async server => {
        server.transport = mockTransport;
        server.client = mockClient;
        server.tools = [];
        manager._setupCrashHandler(server);
      };
      manager._connectServer = mock.fn(realConnect);

      await manager.startServer(createServerConfig());

      const server = manager.servers.get('test-server');
      server.status = SERVER_STATUSES.STOPPING;

      // Simulate transport close during intentional shutdown
      mockTransport.onclose();

      // Status should not change to ERROR
      assert.equal(server.status, SERVER_STATUSES.STOPPING);
    });

    test('logs when max restarts exceeded', async () => {
      const logger = mock.fn();
      manager.logger = logger;
      manager.maxRestarts = 0;

      const realConnect = async server => {
        server.transport = mockTransport;
        server.client = mockClient;
        server.tools = [];
        manager._setupCrashHandler(server);
      };
      manager._connectServer = mock.fn(realConnect);

      await manager.startServer(createServerConfig());

      // Simulate crash
      mockTransport.onclose();

      const messages = logger.mock.calls.map(c => c.arguments[0]);
      assert.ok(messages.some(msg => msg.includes('exceeded max restarts')));
    });

    test('attempts auto-restart on crash within restart limit', async () => {
      const logger = mock.fn();
      manager.logger = logger;
      manager.maxRestarts = 3;
      manager.restartDelayMs = 10; // Fast restart for tests

      let connectCallCount = 0;
      const realConnect = async server => {
        connectCallCount++;
        server.transport = createMockTransport();
        server.client = createMockClient();
        server.tools = [];
        if (connectCallCount === 1) {
          // First connect - set up crash handler
          manager._setupCrashHandler(server);
        }
      };
      manager._connectServer = mock.fn(realConnect);

      await manager.startServer(createServerConfig());

      const server = manager.servers.get('test-server');

      // Simulate crash
      server.transport.onclose();

      assert.equal(server.status, SERVER_STATUSES.RESTARTING);
      assert.equal(server.restartCount, 1);

      // Wait for restart
      await new Promise(resolve => setTimeout(resolve, 50));

      const messages = logger.mock.calls.map(c => c.arguments[0]);
      assert.ok(messages.some(msg => msg.includes('Auto-restarting')));
    });

    test('increments restartCount on each auto-restart attempt', async () => {
      manager.maxRestarts = 3;
      manager.restartDelayMs = 10;

      const realConnect = async server => {
        server.transport = createMockTransport();
        server.client = createMockClient();
        server.tools = [];
        manager._setupCrashHandler(server);
      };
      manager._connectServer = mock.fn(realConnect);

      await manager.startServer(createServerConfig());
      const server = manager.servers.get('test-server');

      // Simulate first crash
      server.transport.onclose();
      assert.equal(server.restartCount, 1);
    });
  });

  describe('full lifecycle', () => {
    test('start → get → getTools → stop flow', async () => {
      const config = createServerConfig();

      // Start
      const server = await manager.startServer(config);
      assert.equal(server.status, SERVER_STATUSES.RUNNING);

      // Get
      const retrieved = manager.getServer('test-server');
      assert.equal(retrieved, server);

      // GetTools
      const tools = manager.getServerTools('test-server');
      assert.equal(tools.length, 1);

      // Stop
      await manager.stopServer('test-server');
      assert.equal(manager.servers.size, 0);
    });

    test('starts and stops multiple servers independently', async () => {
      await manager.startServer(createServerConfig({ id: 'server-1' }));
      await manager.startServer(createServerConfig({ id: 'server-2' }));

      assert.equal(manager.servers.size, 2);

      await manager.stopServer('server-1');

      assert.equal(manager.servers.size, 1);
      assert.ok(manager.servers.has('server-2'));

      await manager.stopServer('server-2');
      assert.equal(manager.servers.size, 0);
    });

    test('re-starts server after stopping', async () => {
      await manager.startServer(createServerConfig());
      await manager.stopServer('test-server');

      const server = await manager.startServer(createServerConfig());
      assert.equal(server.status, SERVER_STATUSES.RUNNING);
      assert.equal(manager.servers.size, 1);
    });

    test('stopAll clears everything', async () => {
      await manager.startServer(createServerConfig({ id: 'server-1' }));
      await manager.startServer(createServerConfig({ id: 'server-2' }));

      const results = await manager.stopAll();

      assert.equal(results.stopped.length, 2);
      assert.equal(manager.servers.size, 0);
      assert.equal(manager.getServerCount(), 0);
    });
  });
});

describe('MCPManagerError', () => {
  test('is an instance of Error', () => {
    const error = new MCPManagerError('Test error');
    assert.ok(error instanceof Error);
  });

  test('has correct name', () => {
    const error = new MCPManagerError('Test error');
    assert.equal(error.name, 'MCPManagerError');
  });

  test('stores message', () => {
    const error = new MCPManagerError('Something went wrong');
    assert.equal(error.message, 'Something went wrong');
  });

  test('stores operation', () => {
    const error = new MCPManagerError('Test error', { operation: 'startServer' });
    assert.equal(error.operation, 'startServer');
  });

  test('stores serverId', () => {
    const error = new MCPManagerError('Test error', { serverId: 'github' });
    assert.equal(error.serverId, 'github');
  });

  test('stores cause', () => {
    const cause = new Error('Original error');
    const error = new MCPManagerError('Test error', { cause });
    assert.equal(error.cause, cause);
  });

  test('stores all options together', () => {
    const cause = new Error('Original');
    const error = new MCPManagerError('Multi-option error', {
      cause,
      operation: 'stopServer',
      serverId: 'filesystem',
    });

    assert.equal(error.cause, cause);
    assert.equal(error.operation, 'stopServer');
    assert.equal(error.serverId, 'filesystem');
  });

  test('defaults optional fields to undefined', () => {
    const error = new MCPManagerError('Test error');
    assert.equal(error.operation, undefined);
    assert.equal(error.serverId, undefined);
    assert.equal(error.cause, undefined);
  });
});

describe('SERVER_STATUSES', () => {
  test('exports all expected status values', () => {
    assert.equal(SERVER_STATUSES.STARTING, 'starting');
    assert.equal(SERVER_STATUSES.RUNNING, 'running');
    assert.equal(SERVER_STATUSES.STOPPING, 'stopping');
    assert.equal(SERVER_STATUSES.STOPPED, 'stopped');
    assert.equal(SERVER_STATUSES.RESTARTING, 'restarting');
    assert.equal(SERVER_STATUSES.ERROR, 'error');
  });

  test('is frozen (immutable)', () => {
    assert.ok(Object.isFrozen(SERVER_STATUSES));
  });
});

describe('DEFAULTS', () => {
  test('exports expected default values', () => {
    assert.equal(DEFAULTS.MAX_RESTARTS, 3);
    assert.equal(DEFAULTS.RESTART_DELAY_MS, 1000);
    assert.equal(DEFAULTS.CONNECT_TIMEOUT_MS, 30000);
    assert.equal(DEFAULTS.CLIENT_NAME, 'ai-army');
    assert.equal(DEFAULTS.CLIENT_VERSION, '0.1.0');
  });

  test('is frozen (immutable)', () => {
    assert.ok(Object.isFrozen(DEFAULTS));
  });
});
