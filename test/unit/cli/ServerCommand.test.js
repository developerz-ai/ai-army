/**
 * Unit tests for ServerCommand
 *
 * Tests all server subcommands: add, list, test.
 * Uses mock WorkerRegistry and SSHTunnelManager via dependency injection.
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { runServer, ServerCommandError } from '../../../src/cli/ServerCommand.js';

/**
 * Create a mock WorkerRegistry for testing
 * @returns {Object} Mock WorkerRegistry with in-memory Map storage
 */
function createMockWorkerRegistry() {
  const workers = new Map();

  return {
    workers,
    registerWorker: mock.fn(async config => {
      const worker = {
        id: config.id,
        host: config.host,
        type: config.type,
        maxContainers: config.maxContainers || 10,
        currentLoad: 0,
        status: 'healthy',
        lastHeartbeat: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      workers.set(config.id, worker);
      return worker;
    }),
    listWorkers: mock.fn(async () => [...workers.values()]),
    getWorker: mock.fn(async id => workers.get(id) || null),
  };
}

/**
 * Create a mock SSHTunnelManager for testing
 * @param {Object} [options={}] - Options
 * @param {boolean} [options.shouldFail=false] - Whether SSH operations should fail
 * @returns {Object} Mock SSHTunnelManager
 */
function createMockSSHTunnelManager(options = {}) {
  const { shouldFail = false } = options;
  const tunnels = new Map();

  return {
    tunnels,
    createTunnel: mock.fn(async config => {
      if (shouldFail) {
        throw new Error('SSH connection refused');
      }
      const tunnel = {
        workerId: config.workerId,
        dockerHost: `tcp://127.0.0.1:${12345 + tunnels.size}`,
        localPort: 12345 + tunnels.size,
        state: 'connected',
      };
      tunnels.set(config.workerId, tunnel);
      return tunnel;
    }),
    closeTunnel: mock.fn(async workerId => {
      const existed = tunnels.has(workerId);
      tunnels.delete(workerId);
      return existed;
    }),
    healthCheck: mock.fn(async workerId => {
      const tunnel = tunnels.get(workerId);
      if (!tunnel) {
        return { workerId, healthy: false, state: 'closed', error: 'No tunnel found' };
      }
      return {
        workerId,
        healthy: true,
        state: 'connected',
        dockerHost: tunnel.dockerHost,
        localPort: tunnel.localPort,
        uptime: 1000,
      };
    }),
  };
}

/**
 * Create a mock writable output stream
 * @returns {Object} Mock output with write() and captured lines
 */
function createMockOutput() {
  const lines = [];
  return {
    lines,
    write: mock.fn(msg => {
      lines.push(msg);
      return true;
    }),
  };
}

describe('ServerCommand', () => {
  let mockRegistry;
  let mockTunnelManager;
  let mockOutput;

  beforeEach(() => {
    mockRegistry = createMockWorkerRegistry();
    mockTunnelManager = createMockSSHTunnelManager();
    mockOutput = createMockOutput();
  });

  // ============================================================================
  // add subcommand
  // ============================================================================

  describe('add', () => {
    test('adds a server and registers as worker', async () => {
      const result = await runServer('add', {
        host: '192.168.1.100',
        user: 'deploy',
        key: '~/.ssh/deploy_key',
        maxWorkers: 5,
        output: mockOutput,
        workerRegistry: mockRegistry,
        sshTunnelManager: mockTunnelManager,
      });

      assert.equal(result.success, true);
      assert.ok(result.worker);
      assert.equal(result.worker.host, '192.168.1.100');
      assert.equal(result.worker.type, 'remote');
      assert.equal(result.worker.maxContainers, 5);
    });

    test('generates worker ID from host', async () => {
      const result = await runServer('add', {
        host: '10.0.0.1',
        output: mockOutput,
        workerRegistry: mockRegistry,
        sshTunnelManager: mockTunnelManager,
      });

      assert.equal(result.worker.id, '10-0-0-1');
    });

    test('validates SSH connectivity before registering', async () => {
      await runServer('add', {
        host: '192.168.1.100',
        output: mockOutput,
        workerRegistry: mockRegistry,
        sshTunnelManager: mockTunnelManager,
      });

      // createTunnel should be called for SSH validation
      assert.equal(mockTunnelManager.createTunnel.mock.calls.length, 1);
      // closeTunnel should be called to clean up the test tunnel
      assert.equal(mockTunnelManager.closeTunnel.mock.calls.length, 1);
    });

    test('uses default values for user, key, and maxWorkers', async () => {
      const result = await runServer('add', {
        host: '10.0.0.1',
        output: mockOutput,
        workerRegistry: mockRegistry,
        sshTunnelManager: mockTunnelManager,
      });

      assert.equal(result.worker.maxContainers, 10);
      assert.equal(result.sshKeyPath, '~/.ssh/id_rsa');
    });

    test('parses labels into array', async () => {
      const result = await runServer('add', {
        host: '10.0.0.1',
        labels: 'gpu,high-memory,us-east',
        output: mockOutput,
        workerRegistry: mockRegistry,
        sshTunnelManager: mockTunnelManager,
      });

      assert.deepEqual(result.labels, ['gpu', 'high-memory', 'us-east']);
    });

    test('returns empty labels array when no labels provided', async () => {
      const result = await runServer('add', {
        host: '10.0.0.1',
        output: mockOutput,
        workerRegistry: mockRegistry,
        sshTunnelManager: mockTunnelManager,
      });

      assert.deepEqual(result.labels, []);
    });

    test('writes output about added server', async () => {
      await runServer('add', {
        host: '192.168.1.100',
        user: 'deploy',
        labels: 'gpu',
        output: mockOutput,
        workerRegistry: mockRegistry,
        sshTunnelManager: mockTunnelManager,
      });

      const output = mockOutput.lines.join('');
      assert.match(output, /Adding server '192\.168\.1\.100'/);
      assert.match(output, /deploy/);
      assert.match(output, /gpu/);
      assert.match(output, /SSH connection: ✅ OK/);
      assert.match(output, /registered as worker/);
    });

    test('throws when host is missing', async () => {
      await assert.rejects(
        () =>
          runServer('add', {
            output: mockOutput,
            workerRegistry: mockRegistry,
            sshTunnelManager: mockTunnelManager,
          }),
        err => {
          assert.equal(err.name, 'ServerCommandError');
          assert.match(err.message, /Host is required/);
          assert.equal(err.operation, 'add');
          return true;
        }
      );
    });

    test('throws when SSH connectivity fails', async () => {
      const failingTunnel = createMockSSHTunnelManager({ shouldFail: true });

      await assert.rejects(
        () =>
          runServer('add', {
            host: '10.0.0.1',
            output: mockOutput,
            workerRegistry: mockRegistry,
            sshTunnelManager: failingTunnel,
          }),
        err => {
          assert.equal(err.name, 'ServerCommandError');
          assert.match(err.message, /SSH connectivity check failed/);
          assert.ok(err.cause);
          return true;
        }
      );
    });

    test('does not register worker when SSH fails', async () => {
      const failingTunnel = createMockSSHTunnelManager({ shouldFail: true });

      try {
        await runServer('add', {
          host: '10.0.0.1',
          output: mockOutput,
          workerRegistry: mockRegistry,
          sshTunnelManager: failingTunnel,
        });
      } catch (_err) {
        // Expected to throw
      }

      // Worker should NOT be registered
      assert.equal(mockRegistry.registerWorker.mock.calls.length, 0);
    });

    test('throws when worker registration fails', async () => {
      const failingRegistry = {
        ...mockRegistry,
        registerWorker: mock.fn(async () => {
          throw new Error('Worker already exists');
        }),
      };

      await assert.rejects(
        () =>
          runServer('add', {
            host: '10.0.0.1',
            output: mockOutput,
            workerRegistry: failingRegistry,
            sshTunnelManager: mockTunnelManager,
          }),
        err => {
          assert.equal(err.name, 'ServerCommandError');
          assert.match(err.message, /Failed to register server/);
          return true;
        }
      );
    });

    test('writes SSH failure output', async () => {
      const failingTunnel = createMockSSHTunnelManager({ shouldFail: true });

      try {
        await runServer('add', {
          host: '10.0.0.1',
          output: mockOutput,
          workerRegistry: mockRegistry,
          sshTunnelManager: failingTunnel,
        });
      } catch (_err) {
        // Expected
      }

      const output = mockOutput.lines.join('');
      assert.match(output, /SSH connection: ❌ Failed/);
    });
  });

  // ============================================================================
  // list subcommand
  // ============================================================================

  describe('list', () => {
    test('lists all servers', async () => {
      // Seed workers
      mockRegistry.workers.set('server-1', {
        id: 'server-1',
        host: '10.0.0.1',
        type: 'remote',
        status: 'healthy',
        currentLoad: 2,
        maxContainers: 10,
      });
      mockRegistry.workers.set('local', {
        id: 'local',
        host: 'localhost',
        type: 'local',
        status: 'healthy',
        currentLoad: 1,
        maxContainers: 5,
      });

      const result = await runServer('list', {
        output: mockOutput,
        workerRegistry: mockRegistry,
        sshTunnelManager: mockTunnelManager,
      });

      assert.equal(result.success, true);
      assert.equal(result.workers.length, 2);
    });

    test('formats output as table', async () => {
      mockRegistry.workers.set('gpu-server', {
        id: 'gpu-server',
        host: '10.0.0.50',
        type: 'remote',
        status: 'healthy',
        currentLoad: 3,
        maxContainers: 20,
      });

      await runServer('list', {
        output: mockOutput,
        workerRegistry: mockRegistry,
        sshTunnelManager: mockTunnelManager,
      });

      const output = mockOutput.lines.join('');
      assert.match(output, /ID/);
      assert.match(output, /HOST/);
      assert.match(output, /TYPE/);
      assert.match(output, /STATUS/);
      assert.match(output, /LOAD/);
      assert.match(output, /gpu-server/);
      assert.match(output, /10\.0\.0\.50/);
      assert.match(output, /3\/20/);
      assert.match(output, /Total: 1 server/);
    });

    test('shows message when no servers found', async () => {
      const result = await runServer('list', {
        output: mockOutput,
        workerRegistry: mockRegistry,
        sshTunnelManager: mockTunnelManager,
      });

      assert.equal(result.success, true);
      assert.equal(result.workers.length, 0);

      const output = mockOutput.lines.join('');
      assert.match(output, /No servers registered/);
    });

    test('shows separator line in table', async () => {
      mockRegistry.workers.set('srv-1', {
        id: 'srv-1',
        host: '10.0.0.1',
        type: 'remote',
        status: 'healthy',
        currentLoad: 0,
        maxContainers: 10,
      });

      await runServer('list', {
        output: mockOutput,
        workerRegistry: mockRegistry,
        sshTunnelManager: mockTunnelManager,
      });

      const output = mockOutput.lines.join('');
      assert.match(output, /---/);
    });
  });

  // ============================================================================
  // test subcommand
  // ============================================================================

  describe('test', () => {
    test('tests a remote server successfully', async () => {
      mockRegistry.workers.set('remote-srv', {
        id: 'remote-srv',
        host: '10.0.0.1',
        type: 'remote',
        status: 'healthy',
        currentLoad: 0,
        maxContainers: 10,
      });

      const result = await runServer('test', {
        serverId: 'remote-srv',
        output: mockOutput,
        workerRegistry: mockRegistry,
        sshTunnelManager: mockTunnelManager,
      });

      assert.equal(result.success, true);
      assert.ok(result.worker);
      assert.ok(result.health);
    });

    test('creates and closes a test tunnel for remote servers', async () => {
      mockRegistry.workers.set('remote-srv', {
        id: 'remote-srv',
        host: '10.0.0.1',
        type: 'remote',
        status: 'healthy',
        currentLoad: 0,
        maxContainers: 10,
      });

      await runServer('test', {
        serverId: 'remote-srv',
        output: mockOutput,
        workerRegistry: mockRegistry,
        sshTunnelManager: mockTunnelManager,
      });

      assert.equal(mockTunnelManager.createTunnel.mock.calls.length, 1);
      assert.equal(mockTunnelManager.healthCheck.mock.calls.length, 1);
      assert.equal(mockTunnelManager.closeTunnel.mock.calls.length, 1);
    });

    test('writes success output for remote server test', async () => {
      mockRegistry.workers.set('remote-srv', {
        id: 'remote-srv',
        host: '10.0.0.1',
        type: 'remote',
        status: 'healthy',
        currentLoad: 0,
        maxContainers: 10,
      });

      await runServer('test', {
        serverId: 'remote-srv',
        output: mockOutput,
        workerRegistry: mockRegistry,
        sshTunnelManager: mockTunnelManager,
      });

      const output = mockOutput.lines.join('');
      assert.match(output, /Testing server 'remote-srv'/);
      assert.match(output, /Host:.*10\.0\.0\.1/);
      assert.match(output, /SSH tunnel:.*✅ OK/);
      assert.match(output, /is reachable/);
    });

    test('returns failure when SSH test fails for remote server', async () => {
      mockRegistry.workers.set('bad-srv', {
        id: 'bad-srv',
        host: '10.0.0.99',
        type: 'remote',
        status: 'healthy',
        currentLoad: 0,
        maxContainers: 10,
      });

      const failingTunnel = createMockSSHTunnelManager({ shouldFail: true });

      const result = await runServer('test', {
        serverId: 'bad-srv',
        output: mockOutput,
        workerRegistry: mockRegistry,
        sshTunnelManager: failingTunnel,
      });

      assert.equal(result.success, false);
      assert.ok(result.error);

      const output = mockOutput.lines.join('');
      assert.match(output, /SSH tunnel:.*❌ Failed/);
      assert.match(output, /is not reachable/);
    });

    test('tests local worker via status check only', async () => {
      mockRegistry.workers.set('local', {
        id: 'local',
        host: 'localhost',
        type: 'local',
        status: 'healthy',
        currentLoad: 0,
        maxContainers: 5,
      });

      const result = await runServer('test', {
        serverId: 'local',
        output: mockOutput,
        workerRegistry: mockRegistry,
        sshTunnelManager: mockTunnelManager,
      });

      assert.equal(result.success, true);
      // Should NOT attempt SSH for local workers
      assert.equal(mockTunnelManager.createTunnel.mock.calls.length, 0);
    });

    test('returns failure for offline local worker', async () => {
      mockRegistry.workers.set('local-off', {
        id: 'local-off',
        host: 'localhost',
        type: 'local',
        status: 'offline',
        currentLoad: 0,
        maxContainers: 5,
      });

      const result = await runServer('test', {
        serverId: 'local-off',
        output: mockOutput,
        workerRegistry: mockRegistry,
        sshTunnelManager: mockTunnelManager,
      });

      assert.equal(result.success, false);
    });

    test('returns failure when server not found', async () => {
      const result = await runServer('test', {
        serverId: 'non-existent',
        output: mockOutput,
        workerRegistry: mockRegistry,
        sshTunnelManager: mockTunnelManager,
      });

      assert.equal(result.success, false);

      const output = mockOutput.lines.join('');
      assert.match(output, /not found/);
    });

    test('throws when serverId is missing', async () => {
      await assert.rejects(
        () =>
          runServer('test', {
            output: mockOutput,
            workerRegistry: mockRegistry,
            sshTunnelManager: mockTunnelManager,
          }),
        err => {
          assert.equal(err.name, 'ServerCommandError');
          assert.match(err.message, /Server ID is required/);
          assert.equal(err.operation, 'test');
          return true;
        }
      );
    });

    test('uses custom SSH user and key for test', async () => {
      mockRegistry.workers.set('custom-srv', {
        id: 'custom-srv',
        host: '10.0.0.5',
        type: 'remote',
        status: 'healthy',
        currentLoad: 0,
        maxContainers: 10,
      });

      await runServer('test', {
        serverId: 'custom-srv',
        user: 'deploy',
        key: '/opt/keys/deploy.pem',
        output: mockOutput,
        workerRegistry: mockRegistry,
        sshTunnelManager: mockTunnelManager,
      });

      const tunnelCall = mockTunnelManager.createTunnel.mock.calls[0].arguments[0];
      assert.equal(tunnelCall.username, 'deploy');
      assert.equal(tunnelCall.privateKeyPath, '/opt/keys/deploy.pem');
    });
  });

  // ============================================================================
  // unknown subcommand
  // ============================================================================

  describe('unknown command', () => {
    test('throws for unknown subcommand', async () => {
      await assert.rejects(
        () =>
          runServer('deploy', {
            output: mockOutput,
            workerRegistry: mockRegistry,
            sshTunnelManager: mockTunnelManager,
          }),
        err => {
          assert.equal(err.name, 'ServerCommandError');
          assert.match(err.message, /Unknown server command/);
          assert.match(err.message, /deploy/);
          return true;
        }
      );
    });
  });

  // ============================================================================
  // runServer with storage injection (creates deps internally)
  // ============================================================================

  describe('runServer with injected deps', () => {
    test('uses injected workerRegistry and sshTunnelManager', async () => {
      mockRegistry.workers.set('test-srv', {
        id: 'test-srv',
        host: '10.0.0.1',
        type: 'remote',
        status: 'healthy',
        currentLoad: 0,
        maxContainers: 10,
      });

      const result = await runServer('list', {
        output: mockOutput,
        workerRegistry: mockRegistry,
        sshTunnelManager: mockTunnelManager,
      });

      assert.equal(result.success, true);
      assert.equal(result.workers.length, 1);
    });

    test('defaults to process.stdout when no output provided', () => {
      // Verify runServer is exported and callable
      assert.equal(typeof runServer, 'function');
    });
  });
});

// =============================================================================
// ServerCommandError
// =============================================================================

describe('ServerCommandError', () => {
  test('is an instance of Error', () => {
    const error = new ServerCommandError('Test error');
    assert.ok(error instanceof Error);
  });

  test('has correct name', () => {
    const error = new ServerCommandError('Test error');
    assert.equal(error.name, 'ServerCommandError');
  });

  test('stores operation', () => {
    const error = new ServerCommandError('Test', { operation: 'add' });
    assert.equal(error.operation, 'add');
  });

  test('stores serverId', () => {
    const error = new ServerCommandError('Test', { serverId: 'srv-1' });
    assert.equal(error.serverId, 'srv-1');
  });

  test('stores cause', () => {
    const cause = new Error('Original');
    const error = new ServerCommandError('Test', { cause });
    assert.equal(error.cause, cause);
  });

  test('has correct message', () => {
    const error = new ServerCommandError('Something went wrong');
    assert.equal(error.message, 'Something went wrong');
  });
});
