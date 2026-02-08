/**
 * Unit tests for SSHTunnelManager
 *
 * Tests tunnel creation, closure, health checks, reconnection logic,
 * configuration validation, and resource cleanup.
 *
 * SSH connections and network servers are mocked to enable pure unit testing
 * without requiring actual SSH infrastructure.
 */

import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { SSHTunnelManager, SSHTunnelError, TUNNEL_STATES } from '../../../src/worker/ssh-tunnel.js';

/**
 * Create a mock SSH connection that behaves like an ssh2 Client
 * @param {Object} [overrides={}] - Override default mock behavior
 * @returns {Object} Mock SSH connection
 */
function createMockSSHConnection(overrides = {}) {
  const emitter = new EventEmitter();
  return {
    on: emitter.on.bind(emitter),
    emit: emitter.emit.bind(emitter),
    removeAllListeners: emitter.removeAllListeners.bind(emitter),
    connect: mock.fn(() => {
      // Simulate async ready event
      process.nextTick(() => emitter.emit('ready'));
    }),
    end: mock.fn(),
    openssh_forwardOutStreamLocal: mock.fn((_socketPath, cb) => {
      const stream = new EventEmitter();
      stream.pipe = mock.fn(() => stream);
      stream.destroy = mock.fn();
      cb(null, stream);
    }),
    ...overrides,
  };
}

/**
 * Create a mock logger that captures log calls
 * @returns {Object} Mock logger with captured messages
 */
function createMockLogger() {
  return {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };
}

/**
 * Create a valid tunnel configuration for testing
 * @param {Object} [overrides={}] - Override default config values
 * @returns {Object} Tunnel configuration
 */
function createTunnelConfig(overrides = {}) {
  return {
    workerId: 'gpu-server',
    host: '192.168.1.100',
    port: 22,
    username: 'deploy',
    privateKey: 'mock-private-key-content',
    ...overrides,
  };
}

// ============================================================================
// Constants
// ============================================================================

describe('TUNNEL_STATES', () => {
  test('exports frozen state constants', () => {
    assert.equal(TUNNEL_STATES.CONNECTING, 'connecting');
    assert.equal(TUNNEL_STATES.CONNECTED, 'connected');
    assert.equal(TUNNEL_STATES.RECONNECTING, 'reconnecting');
    assert.equal(TUNNEL_STATES.CLOSED, 'closed');
    assert.equal(TUNNEL_STATES.FAILED, 'failed');
    assert.ok(Object.isFrozen(TUNNEL_STATES));
  });
});

// ============================================================================
// SSHTunnelError
// ============================================================================

describe('SSHTunnelError', () => {
  test('creates error with message', () => {
    const err = new SSHTunnelError('tunnel failed');
    assert.equal(err.message, 'tunnel failed');
    assert.equal(err.name, 'SSHTunnelError');
    assert.equal(err.operation, undefined);
    assert.equal(err.workerId, undefined);
  });

  test('creates error with all options', () => {
    const cause = new Error('root cause');
    const err = new SSHTunnelError('tunnel failed', {
      cause,
      operation: 'createTunnel',
      workerId: 'worker-1',
    });
    assert.equal(err.message, 'tunnel failed');
    assert.equal(err.name, 'SSHTunnelError');
    assert.equal(err.operation, 'createTunnel');
    assert.equal(err.workerId, 'worker-1');
    assert.equal(err.cause, cause);
  });

  test('is an instance of Error', () => {
    const err = new SSHTunnelError('test');
    assert.ok(err instanceof Error);
  });
});

// ============================================================================
// SSHTunnelManager
// ============================================================================

describe('SSHTunnelManager', () => {
  let manager;
  let mockLogger;
  let mockConn;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockConn = createMockSSHConnection();

    manager = new SSHTunnelManager({
      keepAliveIntervalMs: 5_000,
      keepAliveCountMax: 2,
      reconnectDelayMs: 100,
      maxReconnectAttempts: 3,
      connectTimeoutMs: 5_000,
      logger: mockLogger,
    });

    // Override the SSH connection creation to use our mock
    manager._createSSHConnection = mock.fn(async () => mockConn);
  });

  afterEach(async () => {
    // Clean up any open tunnels
    await manager.closeAll();
  });

  // --------------------------------------------------------------------------
  // Constructor
  // --------------------------------------------------------------------------

  describe('constructor', () => {
    test('creates instance with default options', () => {
      const defaultManager = new SSHTunnelManager();
      assert.equal(defaultManager.keepAliveIntervalMs, 10_000);
      assert.equal(defaultManager.keepAliveCountMax, 3);
      assert.equal(defaultManager.reconnectDelayMs, 2_000);
      assert.equal(defaultManager.maxReconnectAttempts, 5);
      assert.equal(defaultManager.connectTimeoutMs, 15_000);
      assert.ok(defaultManager.tunnels instanceof Map);
      assert.equal(defaultManager.tunnels.size, 0);
    });

    test('creates instance with custom options', () => {
      assert.equal(manager.keepAliveIntervalMs, 5_000);
      assert.equal(manager.keepAliveCountMax, 2);
      assert.equal(manager.reconnectDelayMs, 100);
      assert.equal(manager.maxReconnectAttempts, 3);
      assert.equal(manager.connectTimeoutMs, 5_000);
      assert.equal(manager.logger, mockLogger);
    });
  });

  // --------------------------------------------------------------------------
  // _validateConfig()
  // --------------------------------------------------------------------------

  describe('_validateConfig()', () => {
    test('passes for valid config', () => {
      assert.doesNotThrow(() => {
        manager._validateConfig(createTunnelConfig());
      });
    });

    test('throws when config is null', () => {
      assert.throws(
        () => manager._validateConfig(null),
        err => {
          assert.equal(err.name, 'SSHTunnelError');
          assert.equal(err.operation, 'createTunnel');
          assert.match(err.message, /non-null object/);
          return true;
        }
      );
    });

    test('throws when config is not an object', () => {
      assert.throws(
        () => manager._validateConfig('invalid'),
        err => {
          assert.equal(err.name, 'SSHTunnelError');
          return true;
        }
      );
    });

    test('throws when workerId is missing', () => {
      assert.throws(
        () =>
          manager._validateConfig({
            host: '10.0.0.1',
            username: 'user',
            privateKey: 'key',
          }),
        err => {
          assert.equal(err.name, 'SSHTunnelError');
          assert.match(err.message, /Worker ID/);
          return true;
        }
      );
    });

    test('throws when host is missing', () => {
      assert.throws(
        () =>
          manager._validateConfig({
            workerId: 'w1',
            username: 'user',
            privateKey: 'key',
          }),
        err => {
          assert.equal(err.name, 'SSHTunnelError');
          assert.equal(err.workerId, 'w1');
          assert.match(err.message, /Host/);
          return true;
        }
      );
    });

    test('throws when username is missing', () => {
      assert.throws(
        () =>
          manager._validateConfig({
            workerId: 'w1',
            host: '10.0.0.1',
            privateKey: 'key',
          }),
        err => {
          assert.equal(err.name, 'SSHTunnelError');
          assert.equal(err.workerId, 'w1');
          assert.match(err.message, /Username/);
          return true;
        }
      );
    });

    test('throws when both privateKeyPath and privateKey are missing', () => {
      assert.throws(
        () =>
          manager._validateConfig({
            workerId: 'w1',
            host: '10.0.0.1',
            username: 'user',
          }),
        err => {
          assert.equal(err.name, 'SSHTunnelError');
          assert.match(err.message, /privateKeyPath or privateKey/);
          return true;
        }
      );
    });

    test('accepts privateKey directly', () => {
      assert.doesNotThrow(() => {
        manager._validateConfig({
          workerId: 'w1',
          host: '10.0.0.1',
          username: 'user',
          privateKey: 'key-content',
        });
      });
    });

    test('accepts privateKeyPath', () => {
      assert.doesNotThrow(() => {
        manager._validateConfig({
          workerId: 'w1',
          host: '10.0.0.1',
          username: 'user',
          privateKeyPath: '/home/user/.ssh/id_rsa',
        });
      });
    });
  });

  // --------------------------------------------------------------------------
  // createTunnel()
  // --------------------------------------------------------------------------

  describe('createTunnel()', () => {
    test('creates a tunnel and returns tunnel info', async () => {
      const config = createTunnelConfig();
      const result = await manager.createTunnel(config);

      assert.equal(result.workerId, 'gpu-server');
      assert.equal(result.state, TUNNEL_STATES.CONNECTED);
      assert.ok(typeof result.localPort === 'number');
      assert.ok(result.localPort > 0);
      assert.match(result.dockerHost, /^tcp:\/\/127\.0\.0\.1:\d+$/);
    });

    test('stores tunnel in internal map', async () => {
      const config = createTunnelConfig();
      await manager.createTunnel(config);

      assert.equal(manager.tunnels.size, 1);
      assert.ok(manager.tunnels.has('gpu-server'));
    });

    test('creates tunnel with default SSH port', async () => {
      const config = createTunnelConfig({ port: undefined });
      const result = await manager.createTunnel(config);

      assert.equal(result.state, TUNNEL_STATES.CONNECTED);
    });

    test('throws when tunnel already exists and is connected', async () => {
      const config = createTunnelConfig();
      await manager.createTunnel(config);

      await assert.rejects(
        () => manager.createTunnel(config),
        err => {
          assert.equal(err.name, 'SSHTunnelError');
          assert.equal(err.operation, 'createTunnel');
          assert.equal(err.workerId, 'gpu-server');
          assert.match(err.message, /already exists/);
          return true;
        }
      );
    });

    test('replaces a failed tunnel', async () => {
      const config = createTunnelConfig();
      await manager.createTunnel(config);

      // Manually set tunnel state to failed
      manager.tunnels.get('gpu-server').state = TUNNEL_STATES.FAILED;

      // Should succeed since previous tunnel is failed
      const result = await manager.createTunnel(config);
      assert.equal(result.state, TUNNEL_STATES.CONNECTED);
    });

    test('throws when SSH connection fails', async () => {
      manager._createSSHConnection = mock.fn(async () => {
        throw new Error('Connection refused');
      });

      await assert.rejects(
        () => manager.createTunnel(createTunnelConfig()),
        err => {
          assert.equal(err.name, 'SSHTunnelError');
          assert.equal(err.operation, 'createTunnel');
          assert.match(err.message, /Connection refused/);
          return true;
        }
      );
    });

    test('cleans up on failure', async () => {
      manager._createSSHConnection = mock.fn(async () => {
        throw new Error('Auth failed');
      });

      await assert.rejects(() => manager.createTunnel(createTunnelConfig()));

      // Tunnel should be cleaned up
      assert.equal(manager.tunnels.size, 0);
    });

    test('throws for invalid config', async () => {
      await assert.rejects(
        () => manager.createTunnel(null),
        err => {
          assert.equal(err.name, 'SSHTunnelError');
          assert.match(err.message, /non-null object/);
          return true;
        }
      );
    });

    test('logs tunnel creation info', async () => {
      await manager.createTunnel(createTunnelConfig());

      assert.ok(mockLogger.info.mock.calls.length > 0);
      const logMsg = mockLogger.info.mock.calls[0].arguments[0];
      assert.match(logMsg, /Tunnel established/);
      assert.match(logMsg, /gpu-server/);
    });

    test('creates multiple tunnels for different workers', async () => {
      await manager.createTunnel(createTunnelConfig({ workerId: 'worker-1' }));
      await manager.createTunnel(createTunnelConfig({ workerId: 'worker-2' }));

      assert.equal(manager.tunnels.size, 2);
      assert.ok(manager.tunnels.has('worker-1'));
      assert.ok(manager.tunnels.has('worker-2'));
    });
  });

  // --------------------------------------------------------------------------
  // closeTunnel()
  // --------------------------------------------------------------------------

  describe('closeTunnel()', () => {
    test('closes an existing tunnel', async () => {
      await manager.createTunnel(createTunnelConfig());
      const result = await manager.closeTunnel('gpu-server');

      assert.equal(result, true);
      assert.equal(manager.tunnels.size, 0);
    });

    test('returns false for non-existent tunnel', async () => {
      const result = await manager.closeTunnel('nonexistent');
      assert.equal(result, false);
    });

    test('throws when workerId is empty', async () => {
      await assert.rejects(
        () => manager.closeTunnel(''),
        err => {
          assert.equal(err.name, 'SSHTunnelError');
          assert.equal(err.operation, 'closeTunnel');
          assert.match(err.message, /Worker ID/);
          return true;
        }
      );
    });

    test('throws when workerId is null', async () => {
      await assert.rejects(
        () => manager.closeTunnel(null),
        err => {
          assert.equal(err.name, 'SSHTunnelError');
          assert.equal(err.operation, 'closeTunnel');
          return true;
        }
      );
    });

    test('ends the SSH connection on close', async () => {
      await manager.createTunnel(createTunnelConfig());
      await manager.closeTunnel('gpu-server');

      assert.ok(mockConn.end.mock.calls.length > 0);
    });

    test('logs tunnel closure', async () => {
      await manager.createTunnel(createTunnelConfig());
      await manager.closeTunnel('gpu-server');

      const closeLogs = mockLogger.info.mock.calls.filter(call =>
        call.arguments[0].includes('Tunnel closed')
      );
      assert.ok(closeLogs.length > 0);
    });
  });

  // --------------------------------------------------------------------------
  // closeAll()
  // --------------------------------------------------------------------------

  describe('closeAll()', () => {
    test('closes all open tunnels', async () => {
      await manager.createTunnel(createTunnelConfig({ workerId: 'worker-1' }));
      await manager.createTunnel(createTunnelConfig({ workerId: 'worker-2' }));

      const closed = await manager.closeAll();

      assert.equal(closed.length, 2);
      assert.ok(closed.includes('worker-1'));
      assert.ok(closed.includes('worker-2'));
      assert.equal(manager.tunnels.size, 0);
    });

    test('returns empty array when no tunnels exist', async () => {
      const closed = await manager.closeAll();
      assert.deepEqual(closed, []);
    });

    test('continues closing remaining tunnels if one fails', async () => {
      await manager.createTunnel(createTunnelConfig({ workerId: 'worker-1' }));
      await manager.createTunnel(createTunnelConfig({ workerId: 'worker-2' }));

      // Make first tunnel cleanup fail
      const originalCleanup = manager._cleanupTunnel.bind(manager);
      let callCount = 0;
      manager._cleanupTunnel = async workerId => {
        callCount += 1;
        if (callCount === 1) {
          throw new Error('Cleanup failed');
        }
        return originalCleanup(workerId);
      };

      const closed = await manager.closeAll();

      // Should still close the second tunnel
      assert.ok(closed.length >= 1);
    });
  });

  // --------------------------------------------------------------------------
  // healthCheck()
  // --------------------------------------------------------------------------

  describe('healthCheck()', () => {
    test('returns healthy for connected tunnel', async () => {
      await manager.createTunnel(createTunnelConfig());

      const health = await manager.healthCheck('gpu-server');

      assert.equal(health.workerId, 'gpu-server');
      assert.equal(health.healthy, true);
      assert.equal(health.state, TUNNEL_STATES.CONNECTED);
      assert.ok(health.dockerHost);
      assert.ok(typeof health.localPort === 'number');
      assert.ok(typeof health.uptime === 'number');
      assert.ok(health.uptime >= 0);
    });

    test('returns unhealthy when no tunnel found', async () => {
      const health = await manager.healthCheck('nonexistent');

      assert.equal(health.workerId, 'nonexistent');
      assert.equal(health.healthy, false);
      assert.equal(health.state, TUNNEL_STATES.CLOSED);
      assert.equal(health.dockerHost, null);
      assert.equal(health.localPort, null);
      assert.equal(health.uptime, null);
      assert.equal(health.error, 'No tunnel found');
    });

    test('returns unhealthy when tunnel is reconnecting', async () => {
      await manager.createTunnel(createTunnelConfig());

      // Simulate reconnecting state
      manager.tunnels.get('gpu-server').state = TUNNEL_STATES.RECONNECTING;

      const health = await manager.healthCheck('gpu-server');
      assert.equal(health.healthy, false);
      assert.equal(health.state, TUNNEL_STATES.RECONNECTING);
    });

    test('returns unhealthy when connection is null', async () => {
      await manager.createTunnel(createTunnelConfig());

      // Simulate lost connection
      manager.tunnels.get('gpu-server').connection = null;

      const health = await manager.healthCheck('gpu-server');
      assert.equal(health.healthy, false);
    });

    test('throws when workerId is empty', async () => {
      await assert.rejects(
        () => manager.healthCheck(''),
        err => {
          assert.equal(err.name, 'SSHTunnelError');
          assert.equal(err.operation, 'healthCheck');
          return true;
        }
      );
    });

    test('throws when workerId is null', async () => {
      await assert.rejects(
        () => manager.healthCheck(null),
        err => {
          assert.equal(err.name, 'SSHTunnelError');
          assert.equal(err.operation, 'healthCheck');
          return true;
        }
      );
    });
  });

  // --------------------------------------------------------------------------
  // getDockerHost()
  // --------------------------------------------------------------------------

  describe('getDockerHost()', () => {
    test('returns docker host for connected tunnel', async () => {
      await manager.createTunnel(createTunnelConfig());

      const host = manager.getDockerHost('gpu-server');
      assert.match(host, /^tcp:\/\/127\.0\.0\.1:\d+$/);
    });

    test('returns null for non-existent tunnel', () => {
      const host = manager.getDockerHost('nonexistent');
      assert.equal(host, null);
    });

    test('returns null for disconnected tunnel', async () => {
      await manager.createTunnel(createTunnelConfig());
      manager.tunnels.get('gpu-server').state = TUNNEL_STATES.FAILED;

      const host = manager.getDockerHost('gpu-server');
      assert.equal(host, null);
    });
  });

  // --------------------------------------------------------------------------
  // listTunnels()
  // --------------------------------------------------------------------------

  describe('listTunnels()', () => {
    test('returns empty array when no tunnels exist', () => {
      const tunnels = manager.listTunnels();
      assert.deepEqual(tunnels, []);
    });

    test('returns all tunnel statuses', async () => {
      await manager.createTunnel(createTunnelConfig({ workerId: 'worker-1' }));
      await manager.createTunnel(createTunnelConfig({ workerId: 'worker-2' }));

      const tunnels = manager.listTunnels();
      assert.equal(tunnels.length, 2);

      const ids = tunnels.map(t => t.workerId);
      assert.ok(ids.includes('worker-1'));
      assert.ok(ids.includes('worker-2'));
    });

    test('includes expected fields in tunnel status', async () => {
      await manager.createTunnel(createTunnelConfig());

      const tunnels = manager.listTunnels();
      const tunnel = tunnels[0];

      assert.equal(tunnel.workerId, 'gpu-server');
      assert.equal(tunnel.state, TUNNEL_STATES.CONNECTED);
      assert.ok(tunnel.dockerHost);
      assert.ok(typeof tunnel.localPort === 'number');
      assert.equal(tunnel.host, '192.168.1.100');
      assert.equal(tunnel.reconnectAttempts, 0);
      assert.ok(tunnel.createdAt instanceof Date);
    });
  });

  // --------------------------------------------------------------------------
  // _readPrivateKey()
  // --------------------------------------------------------------------------

  describe('_readPrivateKey()', () => {
    test('returns privateKey directly when provided', () => {
      const key = manager._readPrivateKey({ privateKey: 'direct-key-content' });
      assert.equal(key, 'direct-key-content');
    });

    test('throws when file cannot be read', () => {
      assert.throws(
        () =>
          manager._readPrivateKey({
            privateKeyPath: '/nonexistent/path/id_rsa',
            workerId: 'w1',
          }),
        err => {
          assert.equal(err.name, 'SSHTunnelError');
          assert.equal(err.operation, 'createTunnel');
          assert.equal(err.workerId, 'w1');
          assert.match(err.message, /Failed to read SSH private key/);
          assert.ok(err.cause);
          return true;
        }
      );
    });
  });

  // --------------------------------------------------------------------------
  // Reconnection Logic
  // --------------------------------------------------------------------------

  describe('reconnection', () => {
    test('attempts reconnect on connection error', async () => {
      await manager.createTunnel(createTunnelConfig());

      // Override sleep to speed up tests
      manager._sleep = mock.fn(async () => {});

      // Simulate connection error
      mockConn.emit('error', new Error('Connection lost'));

      // Allow reconnection to process
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should have attempted reconnect
      assert.ok(
        mockLogger.info.mock.calls.some(call =>
          call.arguments[0].includes('Attempting to reconnect')
        )
      );
    });

    test('reconnect succeeds and resets attempt counter', async () => {
      await manager.createTunnel(createTunnelConfig());

      // Override sleep to speed up tests
      manager._sleep = mock.fn(async () => {});

      // The reconnect logic will call _establishTunnel, which calls _createSSHConnection
      // Both are already mocked, so reconnection should succeed

      // Simulate connection close
      mockConn.emit('close');

      // Allow reconnection to process
      await new Promise(resolve => setTimeout(resolve, 100));

      // After reconnection, attempts should reset to 0
      const updatedTunnel = manager.tunnels.get('gpu-server');
      if (updatedTunnel) {
        assert.equal(updatedTunnel.reconnectAttempts, 0);
        assert.equal(updatedTunnel.state, TUNNEL_STATES.CONNECTED);
      }
    });

    test('marks tunnel as failed after max reconnect attempts', async () => {
      await manager.createTunnel(createTunnelConfig());

      // Override sleep and SSH connection to fail
      manager._sleep = mock.fn(async () => {});
      manager._createSSHConnection = mock.fn(async () => {
        throw new Error('Connection refused');
      });

      // Simulate disconnection
      mockConn.emit('error', new Error('Connection reset'));

      // Allow reconnection attempts to exhaust
      await new Promise(resolve => setTimeout(resolve, 300));

      // Tunnel should be marked as failed
      const tunnel = manager.tunnels.get('gpu-server');
      if (tunnel) {
        assert.equal(tunnel.state, TUNNEL_STATES.FAILED);
      }
    });

    test('does not double-handle disconnect', async () => {
      await manager.createTunnel(createTunnelConfig());

      manager._sleep = mock.fn(async () => {});

      const tunnel = manager.tunnels.get('gpu-server');
      tunnel.state = TUNNEL_STATES.RECONNECTING;

      // Should not trigger another reconnection attempt
      mockConn.emit('error', new Error('Already reconnecting'));

      await new Promise(resolve => setTimeout(resolve, 50));

      // Should not log additional reconnection attempts
      const reconnectLogs = mockLogger.info.mock.calls.filter(call =>
        call.arguments[0].includes('Attempting to reconnect')
      );
      assert.equal(reconnectLogs.length, 0);
    });

    test('stops reconnecting if tunnel is explicitly closed', async () => {
      await manager.createTunnel(createTunnelConfig());

      let sleepResolve;
      manager._sleep = mock.fn(
        () =>
          new Promise(resolve => {
            sleepResolve = resolve;
          })
      );
      manager._createSSHConnection = mock.fn(async () => {
        throw new Error('Fail');
      });

      // Trigger disconnection
      mockConn.emit('error', new Error('Connection lost'));

      // Wait for first sleep call
      await new Promise(resolve => setTimeout(resolve, 50));

      // Close the tunnel while it's trying to reconnect
      await manager.closeTunnel('gpu-server');

      // Resolve the sleep to let reconnection logic continue
      if (sleepResolve) {
        sleepResolve();
      }

      await new Promise(resolve => setTimeout(resolve, 50));

      // Tunnel should be removed entirely
      assert.equal(manager.tunnels.has('gpu-server'), false);
    });
  });

  // --------------------------------------------------------------------------
  // _closeConnection()
  // --------------------------------------------------------------------------

  describe('_closeConnection()', () => {
    test('calls end on connection', async () => {
      await manager.createTunnel(createTunnelConfig());

      const tunnel = manager.tunnels.get('gpu-server');
      manager._closeConnection(tunnel);

      assert.ok(mockConn.end.mock.calls.length > 0);
      assert.equal(tunnel.connection, null);
    });

    test('handles null connection gracefully', () => {
      const tunnel = { connection: null };
      assert.doesNotThrow(() => manager._closeConnection(tunnel));
    });

    test('ignores errors during connection end', () => {
      const failConn = {
        end: mock.fn(() => {
          throw new Error('Already closed');
        }),
      };

      const tunnel = { connection: failConn };
      assert.doesNotThrow(() => manager._closeConnection(tunnel));
      assert.equal(tunnel.connection, null);
    });
  });

  // --------------------------------------------------------------------------
  // _sleep()
  // --------------------------------------------------------------------------

  describe('_sleep()', () => {
    test('resolves after specified delay', async () => {
      const start = Date.now();
      await manager._sleep(50);
      const elapsed = Date.now() - start;

      // Allow for timer imprecision
      assert.ok(elapsed >= 40);
    });
  });

  // --------------------------------------------------------------------------
  // Edge Cases
  // --------------------------------------------------------------------------

  describe('edge cases', () => {
    test('handles server listening on random port', async () => {
      const config = createTunnelConfig();
      const result = await manager.createTunnel(config);

      // Port should be a valid ephemeral port
      assert.ok(result.localPort > 0);
      assert.ok(result.localPort <= 65535);
    });

    test('tunnel entry tracks createdAt timestamp', async () => {
      const before = new Date();
      await manager.createTunnel(createTunnelConfig());
      const after = new Date();

      const tunnel = manager.tunnels.get('gpu-server');
      assert.ok(tunnel.createdAt >= before);
      assert.ok(tunnel.createdAt <= after);
    });

    test('tunnel config is stored as a copy', async () => {
      const config = createTunnelConfig();
      await manager.createTunnel(config);

      const tunnel = manager.tunnels.get('gpu-server');
      // Modifying original config should not affect tunnel
      config.host = 'different-host';
      assert.equal(tunnel.config.host, '192.168.1.100');
    });
  });
});
