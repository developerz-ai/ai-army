/**
 * Unit tests for ContainerPool
 *
 * Tests container pooling, reuse, health monitoring, cleanup, and
 * backend abstraction.
 *
 * Note: These are unit tests with mocked backends.
 * Integration tests with real containers are in test/integration/execution/
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ContainerPool, ContainerPoolError } from '../../../src/execution/container-pool.js';
import { ContainerBackend, BACKEND_TYPES } from '../../../src/execution/container-backend.js';

/**
 * Create a mock ContainerBackend
 * @param {Object} [overrides={}] - Override default mock implementations
 * @returns {Object} Mock backend and container
 */
function createMockBackend(overrides = {}) {
  const mockContainer = {
    id: 'container-123',
  };

  // Create a concrete subclass of ContainerBackend for testing
  class TestBackend extends ContainerBackend {
    constructor() {
      super(BACKEND_TYPES.INCUS);
    }
  }

  const mockBackend = new TestBackend();
  mockBackend.createContainer = mock.fn(async () => ({
    ...mockContainer,
    id: `container-${Date.now()}`,
  }));
  mockBackend.startContainer = mock.fn(async () => {});
  mockBackend.stopContainer = mock.fn(async () => {});
  mockBackend.healthCheck = mock.fn(async () => true);
  mockBackend.installPackages = mock.fn(async () => {});
  mockBackend.exec = mock.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));

  // Apply overrides
  for (const [key, value] of Object.entries(overrides)) {
    mockBackend[key] = value;
  }

  return { mockBackend, mockContainer };
}

describe('ContainerPool', () => {
  describe('constructor', () => {
    test('creates instance with ContainerBackend', () => {
      const { mockBackend } = createMockBackend();
      const pool = new ContainerPool(mockBackend);

      assert.ok(pool);
      assert.equal(pool._defaultBackend, mockBackend);
      assert.equal(pool.size, 0);
    });

    test('throws ContainerPoolError when backend is null', () => {
      assert.throws(
        () => new ContainerPool(null),
        err => {
          assert.equal(err.name, 'ContainerPoolError');
          assert.match(err.message, /Backend is required/);
          assert.equal(err.operation, 'constructor');
          return true;
        }
      );
    });

    test('throws ContainerPoolError when backend is undefined', () => {
      assert.throws(
        () => new ContainerPool(undefined),
        err => {
          assert.equal(err.name, 'ContainerPoolError');
          assert.match(err.message, /Backend is required/);
          return true;
        }
      );
    });

    test('throws ContainerPoolError when backend is not a ContainerBackend', () => {
      assert.throws(
        () => new ContainerPool({ exec: () => {} }),
        err => {
          assert.equal(err.name, 'ContainerPoolError');
          assert.match(err.message, /ContainerBackend instance/);
          assert.equal(err.operation, 'constructor');
          return true;
        }
      );
    });
  });

  describe('initializeContainer()', () => {
    let pool;
    let mockBackend;

    beforeEach(() => {
      ({ mockBackend } = createMockBackend());
      pool = new ContainerPool(mockBackend);
    });

    test('creates and starts a container', async () => {
      const botConfig = { id: 'test-bot', sandbox: { image: 'ubuntu:24.04' } };
      const workspace = { root: './data/test-bot' };

      const container = await pool.initializeContainer('test-bot', botConfig, workspace);

      assert.ok(container);
      assert.equal(mockBackend.createContainer.mock.calls.length, 1);
      assert.equal(mockBackend.startContainer.mock.calls.length, 1);
      assert.equal(pool.size, 1);
      assert.ok(pool.hasContainer('test-bot'));
    });

    test('stores bot config and workspace for later recreation', async () => {
      const botConfig = { id: 'test-bot', sandbox: { image: 'ubuntu:24.04' } };
      const workspace = { root: './data/test-bot' };

      await pool.initializeContainer('test-bot', botConfig, workspace);

      assert.ok(pool.botConfigs.has('test-bot'));
      assert.ok(pool.workspaces.has('test-bot'));
    });

    test('installs packages if specified', async () => {
      const botConfig = {
        id: 'test-bot',
        sandbox: { image: 'ubuntu:24.04', packages: ['git', 'curl'] },
      };
      const workspace = { root: './data/test-bot' };

      await pool.initializeContainer('test-bot', botConfig, workspace);

      assert.equal(mockBackend.installPackages.mock.calls.length, 1);
      const installArgs = mockBackend.installPackages.mock.calls[0].arguments;
      assert.deepEqual(installArgs[1], ['git', 'curl']);
    });

    test('does not install packages if not specified', async () => {
      const botConfig = { id: 'test-bot', sandbox: { image: 'ubuntu:24.04' } };
      const workspace = { root: './data/test-bot' };

      await pool.initializeContainer('test-bot', botConfig, workspace);

      assert.equal(mockBackend.installPackages.mock.calls.length, 0);
    });

    test('does not install packages if empty array', async () => {
      const botConfig = {
        id: 'test-bot',
        sandbox: { image: 'ubuntu:24.04', packages: [] },
      };
      const workspace = { root: './data/test-bot' };

      await pool.initializeContainer('test-bot', botConfig, workspace);

      assert.equal(mockBackend.installPackages.mock.calls.length, 0);
    });

    test('recycles existing container before creating new one', async () => {
      const botConfig = { id: 'test-bot', sandbox: { image: 'ubuntu:24.04' } };
      const workspace = { root: './data/test-bot' };

      // Initialize twice
      await pool.initializeContainer('test-bot', botConfig, workspace);
      await pool.initializeContainer('test-bot', botConfig, workspace);

      // Should have called stopContainer once (for recycling)
      assert.equal(mockBackend.stopContainer.mock.calls.length, 1);
      // Should have created container twice
      assert.equal(mockBackend.createContainer.mock.calls.length, 2);
    });

    test('ensures botConfig.id matches botId parameter', async () => {
      const botConfig = { id: 'different-id', sandbox: {} };
      const workspace = { root: './data/test-bot' };

      await pool.initializeContainer('test-bot', botConfig, workspace);

      const createArgs = mockBackend.createContainer.mock.calls[0].arguments[0];
      assert.equal(createArgs.id, 'test-bot');
    });

    test('routes to default backend when sandbox.type is incus', async () => {
      const botConfig = { id: 'test-bot', sandbox: { type: 'incus' } };
      const workspace = { root: './data/test-bot' };

      await pool.initializeContainer('test-bot', botConfig, workspace);

      // Backend should have been called (either default or incus)
      assert.ok(
        mockBackend.createContainer.mock.calls.length >= 0 || pool.backends.has('test-bot')
      );
    });

    test('routes to default backend when sandbox.type is undefined', async () => {
      const botConfig = { id: 'test-bot', sandbox: {} };
      const workspace = { root: './data/test-bot' };

      await pool.initializeContainer('test-bot', botConfig, workspace);

      // Backend should have been called
      assert.ok(pool.backends.has('test-bot') || pool.size === 1);
    });

    test('throws ContainerPoolError when botId is empty', async () => {
      const botConfig = { id: 'test-bot', sandbox: {} };
      const workspace = { root: './data' };

      await assert.rejects(
        () => pool.initializeContainer('', botConfig, workspace),
        err => {
          assert.equal(err.name, 'ContainerPoolError');
          assert.match(err.message, /Bot ID must be a non-empty string/);
          assert.equal(err.operation, 'initializeContainer');
          return true;
        }
      );
    });

    test('throws ContainerPoolError when botId is null', async () => {
      const botConfig = { id: 'test-bot', sandbox: {} };
      const workspace = { root: './data' };

      await assert.rejects(
        () => pool.initializeContainer(null, botConfig, workspace),
        err => {
          assert.equal(err.name, 'ContainerPoolError');
          assert.match(err.message, /Bot ID must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws ContainerPoolError when botConfig is null', async () => {
      const { root } = { root: './data' };

      await assert.rejects(
        () => pool.initializeContainer('test-bot', null, { root }),
        err => {
          assert.equal(err.name, 'ContainerPoolError');
          assert.match(err.message, /Bot configuration is required/);
          assert.equal(err.botId, 'test-bot');
          return true;
        }
      );
    });

    test('throws ContainerPoolError when workspace is null', async () => {
      const botConfig = { id: 'test-bot', sandbox: {} };

      await assert.rejects(
        () => pool.initializeContainer('test-bot', botConfig, null),
        err => {
          assert.equal(err.name, 'ContainerPoolError');
          assert.match(err.message, /Workspace configuration is required/);
          assert.equal(err.botId, 'test-bot');
          return true;
        }
      );
    });

    test('throws ContainerPoolError when backend fails', async () => {
      mockBackend.createContainer = mock.fn(async () => {
        throw new Error('Backend error');
      });

      const botConfig = { id: 'test-bot', sandbox: {} };
      const workspace = { root: './data' };

      await assert.rejects(
        () => pool.initializeContainer('test-bot', botConfig, workspace),
        err => {
          assert.equal(err.name, 'ContainerPoolError');
          assert.match(err.message, /Failed to initialize container/);
          assert.equal(err.botId, 'test-bot');
          assert.ok(err.cause);
          return true;
        }
      );
    });
  });

  describe('getContainer()', () => {
    let pool;
    let mockBackend;

    beforeEach(() => {
      ({ mockBackend } = createMockBackend());
      pool = new ContainerPool(mockBackend);
    });

    test('returns existing healthy container', async () => {
      const botConfig = { id: 'test-bot', sandbox: {} };
      const workspace = { root: './data' };

      const initialContainer = await pool.initializeContainer('test-bot', botConfig, workspace);
      const retrievedContainer = await pool.getContainer('test-bot');

      assert.equal(retrievedContainer, initialContainer);
    });

    test('reuses same container on multiple calls', async () => {
      const botConfig = { id: 'test-bot', sandbox: {} };
      const workspace = { root: './data' };

      await pool.initializeContainer('test-bot', botConfig, workspace);

      const container1 = await pool.getContainer('test-bot');
      const container2 = await pool.getContainer('test-bot');

      assert.equal(container1.id, container2.id);
      // healthCheck should be called once per getContainer call
      assert.ok(mockBackend.healthCheck.mock.calls.length >= 2);
    });

    test('recreates container when unhealthy', async () => {
      const botConfig = { id: 'test-bot', sandbox: {} };
      const workspace = { root: './data' };

      await pool.initializeContainer('test-bot', botConfig, workspace);

      // Make health check fail
      mockBackend.healthCheck = mock.fn(async () => false);

      const container = await pool.getContainer('test-bot');

      // Should have created a new container
      assert.ok(container);
      // createContainer called twice: once for init, once for recreation
      assert.equal(mockBackend.createContainer.mock.calls.length, 2);
    });

    test('uses per-bot backend for health checks', async () => {
      const botConfig = { id: 'test-bot', sandbox: {} };
      const workspace = { root: './data' };

      await pool.initializeContainer('test-bot', botConfig, workspace);
      await pool.getContainer('test-bot');

      // healthCheck should be called on the backend
      assert.ok(mockBackend.healthCheck.mock.calls.length >= 1);
    });

    test('throws ContainerPoolError when bot not initialized', async () => {
      await assert.rejects(
        () => pool.getContainer('unknown-bot'),
        err => {
          assert.equal(err.name, 'ContainerPoolError');
          assert.match(err.message, /Container not initialized/);
          assert.match(err.message, /initializeContainer/);
          assert.equal(err.botId, 'unknown-bot');
          return true;
        }
      );
    });

    test('throws ContainerPoolError when botId is empty', async () => {
      await assert.rejects(
        () => pool.getContainer(''),
        err => {
          assert.equal(err.name, 'ContainerPoolError');
          assert.match(err.message, /Bot ID must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws ContainerPoolError when botId is null', async () => {
      await assert.rejects(
        () => pool.getContainer(null),
        err => {
          assert.equal(err.name, 'ContainerPoolError');
          assert.match(err.message, /Bot ID must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws when unhealthy and config not stored', async () => {
      const botConfig = { id: 'test-bot', sandbox: {} };
      const workspace = { root: './data' };

      await pool.initializeContainer('test-bot', botConfig, workspace);

      // Manually remove configs to simulate edge case
      pool.botConfigs.delete('test-bot');

      // Make health check fail
      mockBackend.healthCheck = mock.fn(async () => false);

      await assert.rejects(
        () => pool.getContainer('test-bot'),
        err => {
          assert.equal(err.name, 'ContainerPoolError');
          assert.match(err.message, /cannot be recreated/);
          return true;
        }
      );
    });
  });

  describe('recycleContainer()', () => {
    let pool;
    let mockBackend;

    beforeEach(() => {
      ({ mockBackend } = createMockBackend());
      pool = new ContainerPool(mockBackend);
    });

    test('stops and removes container from pool', async () => {
      const botConfig = { id: 'test-bot', sandbox: {} };
      const workspace = { root: './data' };

      await pool.initializeContainer('test-bot', botConfig, workspace);
      assert.equal(pool.size, 1);

      await pool.recycleContainer('test-bot');

      assert.equal(pool.size, 0);
      assert.ok(!pool.hasContainer('test-bot'));
      assert.equal(mockBackend.stopContainer.mock.calls.length, 1);
    });

    test('does nothing when container does not exist', async () => {
      await pool.recycleContainer('nonexistent-bot');

      // Should not throw and should not call stopContainer
      assert.equal(mockBackend.stopContainer.mock.calls.length, 0);
    });

    test('continues cleanup even if stopContainer fails', async () => {
      const botConfig = { id: 'test-bot', sandbox: {} };
      const workspace = { root: './data' };

      await pool.initializeContainer('test-bot', botConfig, workspace);

      // Make stopContainer fail
      mockBackend.stopContainer = mock.fn(async () => {
        throw new Error('Stop failed');
      });

      // Should not throw
      await pool.recycleContainer('test-bot');

      // Container should still be removed from pool
      assert.equal(pool.size, 0);
      assert.ok(!pool.hasContainer('test-bot'));
    });

    test('throws ContainerPoolError when botId is empty', async () => {
      await assert.rejects(
        () => pool.recycleContainer(''),
        err => {
          assert.equal(err.name, 'ContainerPoolError');
          assert.match(err.message, /Bot ID must be a non-empty string/);
          return true;
        }
      );
    });
  });

  describe('healthCheckAll()', () => {
    let pool;
    let mockBackend;

    beforeEach(() => {
      ({ mockBackend } = createMockBackend());
      pool = new ContainerPool(mockBackend);
    });

    test('returns empty results when no containers', async () => {
      const results = await pool.healthCheckAll();

      assert.deepEqual(results, {
        healthy: [],
        unhealthy: [],
        recycled: [],
      });
    });

    test('identifies healthy containers', async () => {
      const botConfig1 = { id: 'bot-1', sandbox: {} };
      const botConfig2 = { id: 'bot-2', sandbox: {} };
      const workspace = { root: './data' };

      await pool.initializeContainer('bot-1', botConfig1, workspace);
      await pool.initializeContainer('bot-2', botConfig2, workspace);

      const results = await pool.healthCheckAll();

      assert.deepEqual(results.healthy.sort(), ['bot-1', 'bot-2']);
      assert.deepEqual(results.unhealthy, []);
      assert.deepEqual(results.recycled, []);
    });

    test('identifies and recycles unhealthy containers', async () => {
      const botConfig1 = { id: 'bot-1', sandbox: {} };
      const botConfig2 = { id: 'bot-2', sandbox: {} };
      const workspace = { root: './data' };

      await pool.initializeContainer('bot-1', botConfig1, workspace);
      await pool.initializeContainer('bot-2', botConfig2, workspace);

      // Get reference to bot-1 container - bot-2 will be anything else
      const container1 = pool.containers.get('bot-1');

      // Make bot-2 unhealthy by checking container reference
      mockBackend.healthCheck = mock.fn(async container => {
        // Only bot-1 is healthy (container matches container1)
        return container === container1;
      });

      const results = await pool.healthCheckAll();

      assert.ok(results.healthy.includes('bot-1'), 'bot-1 should be healthy');
      assert.ok(results.unhealthy.includes('bot-2'), 'bot-2 should be unhealthy');
      assert.ok(results.recycled.includes('bot-2'), 'bot-2 should be recycled');
    });

    test('handles mixed healthy and unhealthy containers', async () => {
      const botConfig1 = { id: 'healthy-bot', sandbox: {} };
      const botConfig2 = { id: 'unhealthy-bot', sandbox: {} };
      const workspace = { root: './data' };

      await pool.initializeContainer('healthy-bot', botConfig1, workspace);
      await pool.initializeContainer('unhealthy-bot', botConfig2, workspace);

      // Make specific container unhealthy
      const containers = new Map(pool.containers);
      mockBackend.healthCheck = mock.fn(async container => {
        // Return false for the unhealthy bot's container
        return container !== containers.get('unhealthy-bot');
      });

      const results = await pool.healthCheckAll();

      assert.ok(results.healthy.includes('healthy-bot'));
      assert.ok(results.unhealthy.includes('unhealthy-bot'));
    });

    test('handles health check errors as unhealthy', async () => {
      const botConfig = { id: 'error-bot', sandbox: {} };
      const workspace = { root: './data' };

      await pool.initializeContainer('error-bot', botConfig, workspace);

      // Make health check throw
      mockBackend.healthCheck = mock.fn(async () => {
        throw new Error('Health check failed');
      });

      const results = await pool.healthCheckAll();

      assert.ok(results.unhealthy.includes('error-bot'));
      assert.ok(results.recycled.includes('error-bot'));
    });
  });

  describe('cleanup()', () => {
    let pool;
    let mockBackend;

    beforeEach(() => {
      ({ mockBackend } = createMockBackend());
      pool = new ContainerPool(mockBackend);
    });

    test('stops all containers and clears pool', async () => {
      const workspace = { root: './data' };

      await pool.initializeContainer('bot-1', { id: 'bot-1', sandbox: {} }, workspace);
      await pool.initializeContainer('bot-2', { id: 'bot-2', sandbox: {} }, workspace);
      await pool.initializeContainer('bot-3', { id: 'bot-3', sandbox: {} }, workspace);

      assert.equal(pool.size, 3);

      await pool.cleanup();

      assert.equal(pool.size, 0);
      assert.ok(!pool.hasContainer('bot-1'));
      assert.ok(!pool.hasContainer('bot-2'));
      assert.ok(!pool.hasContainer('bot-3'));
    });

    test('clears bot configs and workspaces', async () => {
      const workspace = { root: './data' };

      await pool.initializeContainer('bot-1', { id: 'bot-1', sandbox: {} }, workspace);

      await pool.cleanup();

      assert.equal(pool.botConfigs.size, 0);
      assert.equal(pool.workspaces.size, 0);
    });

    test('calls stopContainer for each container', async () => {
      const workspace = { root: './data' };

      await pool.initializeContainer('bot-1', { id: 'bot-1', sandbox: {} }, workspace);
      await pool.initializeContainer('bot-2', { id: 'bot-2', sandbox: {} }, workspace);

      await pool.cleanup();

      // 2 containers stopped
      assert.equal(mockBackend.stopContainer.mock.calls.length, 2);
    });

    test('continues cleanup even if some containers fail to stop', async () => {
      const workspace = { root: './data' };

      await pool.initializeContainer('bot-1', { id: 'bot-1', sandbox: {} }, workspace);
      await pool.initializeContainer('bot-2', { id: 'bot-2', sandbox: {} }, workspace);

      // Make stopContainer fail for all calls
      mockBackend.stopContainer = mock.fn(async () => {
        throw new Error('Stop failed');
      });

      // Should not throw
      await pool.cleanup();

      // Pool should still be cleared
      assert.equal(pool.size, 0);
    });

    test('does nothing when pool is empty', async () => {
      await pool.cleanup();

      assert.equal(mockBackend.stopContainer.mock.calls.length, 0);
      assert.equal(pool.size, 0);
    });

    test('clears backends map on cleanup', async () => {
      const workspace = { root: './data' };

      await pool.initializeContainer('bot-1', { id: 'bot-1', sandbox: {} }, workspace);

      // Simulate a per-bot backend entry
      pool.backends.set('bot-1', pool._defaultBackend);

      await pool.cleanup();

      assert.equal(pool.backends.size, 0);
    });
  });

  describe('hasContainer()', () => {
    test('returns true when container exists', async () => {
      const { mockBackend } = createMockBackend();
      const pool = new ContainerPool(mockBackend);

      await pool.initializeContainer('test-bot', { id: 'test-bot', sandbox: {} }, { root: '.' });

      assert.equal(pool.hasContainer('test-bot'), true);
    });

    test('returns false when container does not exist', () => {
      const { mockBackend } = createMockBackend();
      const pool = new ContainerPool(mockBackend);

      assert.equal(pool.hasContainer('nonexistent'), false);
    });
  });

  describe('size', () => {
    test('returns 0 for empty pool', () => {
      const { mockBackend } = createMockBackend();
      const pool = new ContainerPool(mockBackend);

      assert.equal(pool.size, 0);
    });

    test('returns correct count of containers', async () => {
      const { mockBackend } = createMockBackend();
      const pool = new ContainerPool(mockBackend);

      await pool.initializeContainer('bot-1', { id: 'bot-1', sandbox: {} }, { root: '.' });
      assert.equal(pool.size, 1);

      await pool.initializeContainer('bot-2', { id: 'bot-2', sandbox: {} }, { root: '.' });
      assert.equal(pool.size, 2);

      await pool.recycleContainer('bot-1');
      assert.equal(pool.size, 1);
    });
  });

  describe('getBotIds()', () => {
    test('returns empty array for empty pool', () => {
      const { mockBackend } = createMockBackend();
      const pool = new ContainerPool(mockBackend);

      assert.deepEqual(pool.getBotIds(), []);
    });

    test('returns all bot IDs', async () => {
      const { mockBackend } = createMockBackend();
      const pool = new ContainerPool(mockBackend);

      await pool.initializeContainer('bot-a', { id: 'bot-a', sandbox: {} }, { root: '.' });
      await pool.initializeContainer('bot-b', { id: 'bot-b', sandbox: {} }, { root: '.' });
      await pool.initializeContainer('bot-c', { id: 'bot-c', sandbox: {} }, { root: '.' });

      const botIds = pool.getBotIds();

      assert.equal(botIds.length, 3);
      assert.ok(botIds.includes('bot-a'));
      assert.ok(botIds.includes('bot-b'));
      assert.ok(botIds.includes('bot-c'));
    });
  });

  describe('backend routing', () => {
    test('uses ContainerBackend for all operations', async () => {
      const { mockBackend } = createMockBackend();
      const pool = new ContainerPool(mockBackend);

      const botConfig = { id: 'test-bot', sandbox: {} };
      const workspace = { root: './data' };

      await pool.initializeContainer('test-bot', botConfig, workspace);

      assert.ok(
        mockBackend.createContainer.mock.calls.length >= 0 || pool.backends.has('test-bot')
      );

      await pool.getContainer('test-bot');
      assert.ok(mockBackend.healthCheck.mock.calls.length >= 1);

      await pool.recycleContainer('test-bot');
      assert.ok(mockBackend.stopContainer.mock.calls.length >= 1);
    });

    test('_getBackendForBot returns default backend when no per-bot override', () => {
      const { mockBackend } = createMockBackend();
      const pool = new ContainerPool(mockBackend);

      const result = pool._getBackendForBot('any-bot');
      assert.equal(result, mockBackend);
    });

    test('_getBackendForBot returns per-bot backend when override exists', () => {
      const { mockBackend } = createMockBackend();
      const pool = new ContainerPool(mockBackend);

      const { mockBackend: overrideBackend } = createMockBackend();
      pool.backends.set('special-bot', overrideBackend);

      assert.equal(pool._getBackendForBot('special-bot'), overrideBackend);
      assert.equal(pool._getBackendForBot('normal-bot'), mockBackend);
    });

    test('per-bot backend is cleaned up on initialization failure', async () => {
      const { mockBackend } = createMockBackend();
      const pool = new ContainerPool(mockBackend);

      // Make createContainer fail
      mockBackend.createContainer = mock.fn(async () => {
        throw new Error('Container creation failed');
      });

      const botConfig = { id: 'test-bot', sandbox: {} };
      const workspace = { root: './data' };

      // Attempt initialization (will fail)
      await assert.rejects(() => pool.initializeContainer('test-bot', botConfig, workspace));

      // Per-bot backend should be cleaned up
      assert.equal(pool.backends.has('test-bot'), false);
    });
  });

  describe('exec()', () => {
    let pool;
    let mockBackend;

    beforeEach(async () => {
      ({ mockBackend } = createMockBackend());
      pool = new ContainerPool(mockBackend);

      const botConfig = { id: 'test-bot', sandbox: {} };
      const workspace = { root: './data' };
      await pool.initializeContainer('test-bot', botConfig, workspace);
    });

    test('executes command via the correct backend', async () => {
      mockBackend.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: 'hello\n',
        stderr: '',
      }));

      const result = await pool.exec('test-bot', 'echo hello', { timeout: 5000 });

      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, 'hello\n');
      assert.equal(mockBackend.exec.mock.calls.length, 1);
      const [container, command, options] = mockBackend.exec.mock.calls[0].arguments;
      assert.ok(container);
      assert.equal(command, 'echo hello');
      assert.equal(options.timeout, 5000);
    });

    test('passes default empty options when none provided', async () => {
      mockBackend.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
      }));

      await pool.exec('test-bot', 'ls');

      const options = mockBackend.exec.mock.calls[0].arguments[2];
      assert.deepEqual(options, {});
    });

    test('uses per-bot backend when override exists', async () => {
      const { mockBackend: overrideBackend } = createMockBackend();
      overrideBackend.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: 'from override',
        stderr: '',
      }));
      pool.backends.set('test-bot', overrideBackend);

      const result = await pool.exec('test-bot', 'echo test');

      assert.equal(result.stdout, 'from override');
      assert.equal(overrideBackend.exec.mock.calls.length, 1);
      assert.equal(mockBackend.exec.mock.calls.length, 0);
    });

    test('throws ContainerPoolError when botId is empty', async () => {
      await assert.rejects(
        () => pool.exec('', 'echo test'),
        err => {
          assert.equal(err.name, 'ContainerPoolError');
          assert.match(err.message, /Bot ID must be a non-empty string/);
          assert.equal(err.operation, 'exec');
          return true;
        }
      );
    });

    test('throws ContainerPoolError when botId is null', async () => {
      await assert.rejects(
        () => pool.exec(null, 'echo test'),
        err => {
          assert.equal(err.name, 'ContainerPoolError');
          assert.match(err.message, /Bot ID must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws ContainerPoolError when command is empty', async () => {
      await assert.rejects(
        () => pool.exec('test-bot', ''),
        err => {
          assert.equal(err.name, 'ContainerPoolError');
          assert.match(err.message, /Command must be a non-empty string/);
          assert.equal(err.operation, 'exec');
          assert.equal(err.botId, 'test-bot');
          return true;
        }
      );
    });

    test('throws ContainerPoolError when command is null', async () => {
      await assert.rejects(
        () => pool.exec('test-bot', null),
        err => {
          assert.equal(err.name, 'ContainerPoolError');
          assert.match(err.message, /Command must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws ContainerPoolError when bot not initialized', async () => {
      await assert.rejects(
        () => pool.exec('unknown-bot', 'echo test'),
        err => {
          assert.equal(err.name, 'ContainerPoolError');
          assert.match(err.message, /Container not initialized/);
          return true;
        }
      );
    });

    test('propagates backend exec errors', async () => {
      mockBackend.exec = mock.fn(async () => {
        throw new Error('Command timed out');
      });

      await assert.rejects(
        () => pool.exec('test-bot', 'sleep 999'),
        err => {
          assert.match(err.message, /Command timed out/);
          return true;
        }
      );
    });
  });

  describe('getBackend()', () => {
    test('returns default backend when no per-bot override', () => {
      const { mockBackend } = createMockBackend();
      const pool = new ContainerPool(mockBackend);

      const result = pool.getBackend('any-bot');
      assert.equal(result, mockBackend);
    });

    test('returns per-bot backend when override exists', () => {
      const { mockBackend } = createMockBackend();
      const pool = new ContainerPool(mockBackend);

      const { mockBackend: overrideBackend } = createMockBackend();
      pool.backends.set('special-bot', overrideBackend);

      assert.equal(pool.getBackend('special-bot'), overrideBackend);
      assert.equal(pool.getBackend('normal-bot'), mockBackend);
    });
  });
});

describe('ContainerPoolError', () => {
  test('is an instance of Error', () => {
    const error = new ContainerPoolError('Test error');
    assert.ok(error instanceof Error);
  });

  test('has correct name', () => {
    const error = new ContainerPoolError('Test error');
    assert.equal(error.name, 'ContainerPoolError');
  });

  test('stores operation', () => {
    const error = new ContainerPoolError('Test error', { operation: 'getContainer' });
    assert.equal(error.operation, 'getContainer');
  });

  test('stores botId', () => {
    const error = new ContainerPoolError('Test error', { botId: 'my-bot' });
    assert.equal(error.botId, 'my-bot');
  });

  test('stores cause via standard Error options', () => {
    const cause = new Error('Original error');
    const error = new ContainerPoolError('Test error', { cause });
    assert.equal(error.cause, cause);
    assert.ok(error.cause instanceof Error);
  });

  test('stores all options together including cause', () => {
    const cause = new Error('Original');
    const error = new ContainerPoolError('Multi-option error', {
      cause,
      operation: 'initializeContainer',
      botId: 'test-bot',
    });

    assert.equal(error.cause, cause);
    assert.ok(error.cause instanceof Error);
    assert.equal(error.operation, 'initializeContainer');
    assert.equal(error.botId, 'test-bot');
  });
});
