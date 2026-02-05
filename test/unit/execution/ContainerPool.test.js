/**
 * Unit tests for ContainerPool
 *
 * Tests container pooling, reuse, health monitoring, and cleanup.
 *
 * Note: These are unit tests with mocked DockerManager.
 * Integration tests with real Docker are in test/integration/execution/
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ContainerPool, ContainerPoolError } from '../../../src/execution/container-pool.js';

/**
 * Create a mock DockerManager
 * @param {Object} [overrides={}] - Override default mock implementations
 * @returns {Object} Mock DockerManager
 */
function createMockDockerManager(overrides = {}) {
  const mockContainer = {
    id: 'container-123',
    start: mock.fn(async () => {}),
    stop: mock.fn(async () => {}),
    remove: mock.fn(async () => {}),
    inspect: mock.fn(async () => ({
      Id: 'container-123',
      State: { Running: true },
    })),
  };

  const mockDockerManager = {
    createContainer: mock.fn(async () => ({ ...mockContainer, id: `container-${Date.now()}` })),
    startContainer: mock.fn(async () => {}),
    stopContainer: mock.fn(async () => {}),
    healthCheck: mock.fn(async () => true),
    installPackages: mock.fn(async () => {}),
    exec: mock.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })),
    ...overrides,
  };

  return { mockDockerManager, mockContainer };
}

describe('ContainerPool', () => {
  describe('constructor', () => {
    test('creates instance with DockerManager', () => {
      const { mockDockerManager } = createMockDockerManager();
      const pool = new ContainerPool(mockDockerManager);

      assert.ok(pool);
      assert.equal(pool.dockerManager, mockDockerManager);
      assert.equal(pool.size, 0);
    });

    test('throws ContainerPoolError when DockerManager is null', () => {
      assert.throws(
        () => new ContainerPool(null),
        err => {
          assert.equal(err.name, 'ContainerPoolError');
          assert.match(err.message, /DockerManager is required/);
          assert.equal(err.operation, 'constructor');
          return true;
        }
      );
    });

    test('throws ContainerPoolError when DockerManager is undefined', () => {
      assert.throws(
        () => new ContainerPool(undefined),
        err => {
          assert.equal(err.name, 'ContainerPoolError');
          assert.match(err.message, /DockerManager is required/);
          return true;
        }
      );
    });
  });

  describe('initializeContainer()', () => {
    let pool;
    let mockDockerManager;

    beforeEach(() => {
      ({ mockDockerManager } = createMockDockerManager());
      pool = new ContainerPool(mockDockerManager);
    });

    test('creates and starts a container', async () => {
      const botConfig = { id: 'test-bot', sandbox: { image: 'node:22-slim' } };
      const workspace = { root: './data/test-bot' };

      const container = await pool.initializeContainer('test-bot', botConfig, workspace);

      assert.ok(container);
      assert.equal(mockDockerManager.createContainer.mock.calls.length, 1);
      assert.equal(mockDockerManager.startContainer.mock.calls.length, 1);
      assert.equal(pool.size, 1);
      assert.ok(pool.hasContainer('test-bot'));
    });

    test('stores bot config and workspace for later recreation', async () => {
      const botConfig = { id: 'test-bot', sandbox: { image: 'node:22-slim' } };
      const workspace = { root: './data/test-bot' };

      await pool.initializeContainer('test-bot', botConfig, workspace);

      assert.ok(pool.botConfigs.has('test-bot'));
      assert.ok(pool.workspaces.has('test-bot'));
    });

    test('installs packages if specified', async () => {
      const botConfig = {
        id: 'test-bot',
        sandbox: { image: 'node:22-slim', packages: ['git', 'curl'] },
      };
      const workspace = { root: './data/test-bot' };

      await pool.initializeContainer('test-bot', botConfig, workspace);

      assert.equal(mockDockerManager.installPackages.mock.calls.length, 1);
      const installArgs = mockDockerManager.installPackages.mock.calls[0].arguments;
      assert.deepEqual(installArgs[1], ['git', 'curl']);
    });

    test('does not install packages if not specified', async () => {
      const botConfig = { id: 'test-bot', sandbox: { image: 'node:22-slim' } };
      const workspace = { root: './data/test-bot' };

      await pool.initializeContainer('test-bot', botConfig, workspace);

      assert.equal(mockDockerManager.installPackages.mock.calls.length, 0);
    });

    test('does not install packages if empty array', async () => {
      const botConfig = {
        id: 'test-bot',
        sandbox: { image: 'node:22-slim', packages: [] },
      };
      const workspace = { root: './data/test-bot' };

      await pool.initializeContainer('test-bot', botConfig, workspace);

      assert.equal(mockDockerManager.installPackages.mock.calls.length, 0);
    });

    test('recycles existing container before creating new one', async () => {
      const botConfig = { id: 'test-bot', sandbox: { image: 'node:22-slim' } };
      const workspace = { root: './data/test-bot' };

      // Initialize twice
      await pool.initializeContainer('test-bot', botConfig, workspace);
      await pool.initializeContainer('test-bot', botConfig, workspace);

      // Should have called stopContainer once (for recycling)
      assert.equal(mockDockerManager.stopContainer.mock.calls.length, 1);
      // Should have created container twice
      assert.equal(mockDockerManager.createContainer.mock.calls.length, 2);
    });

    test('ensures botConfig.id matches botId parameter', async () => {
      const botConfig = { id: 'different-id', sandbox: {} };
      const workspace = { root: './data/test-bot' };

      await pool.initializeContainer('test-bot', botConfig, workspace);

      const createArgs = mockDockerManager.createContainer.mock.calls[0].arguments[0];
      assert.equal(createArgs.id, 'test-bot');
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

    test('throws ContainerPoolError when DockerManager fails', async () => {
      mockDockerManager.createContainer = mock.fn(async () => {
        throw new Error('Docker error');
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
    let mockDockerManager;

    beforeEach(() => {
      ({ mockDockerManager } = createMockDockerManager());
      pool = new ContainerPool(mockDockerManager);
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
      assert.ok(mockDockerManager.healthCheck.mock.calls.length >= 2);
    });

    test('recreates container when unhealthy', async () => {
      const botConfig = { id: 'test-bot', sandbox: {} };
      const workspace = { root: './data' };

      await pool.initializeContainer('test-bot', botConfig, workspace);

      // Make health check fail
      mockDockerManager.healthCheck = mock.fn(async () => false);

      const container = await pool.getContainer('test-bot');

      // Should have created a new container
      assert.ok(container);
      // createContainer called twice: once for init, once for recreation
      assert.equal(mockDockerManager.createContainer.mock.calls.length, 2);
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
      mockDockerManager.healthCheck = mock.fn(async () => false);

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
    let mockDockerManager;

    beforeEach(() => {
      ({ mockDockerManager } = createMockDockerManager());
      pool = new ContainerPool(mockDockerManager);
    });

    test('stops and removes container from pool', async () => {
      const botConfig = { id: 'test-bot', sandbox: {} };
      const workspace = { root: './data' };

      await pool.initializeContainer('test-bot', botConfig, workspace);
      assert.equal(pool.size, 1);

      await pool.recycleContainer('test-bot');

      assert.equal(pool.size, 0);
      assert.ok(!pool.hasContainer('test-bot'));
      assert.equal(mockDockerManager.stopContainer.mock.calls.length, 1);
    });

    test('does nothing when container does not exist', async () => {
      await pool.recycleContainer('nonexistent-bot');

      // Should not throw and should not call stopContainer
      assert.equal(mockDockerManager.stopContainer.mock.calls.length, 0);
    });

    test('continues cleanup even if stopContainer fails', async () => {
      const botConfig = { id: 'test-bot', sandbox: {} };
      const workspace = { root: './data' };

      await pool.initializeContainer('test-bot', botConfig, workspace);

      // Make stopContainer fail
      mockDockerManager.stopContainer = mock.fn(async () => {
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
    let mockDockerManager;

    beforeEach(() => {
      ({ mockDockerManager } = createMockDockerManager());
      pool = new ContainerPool(mockDockerManager);
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
      mockDockerManager.healthCheck = mock.fn(async container => {
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
      mockDockerManager.healthCheck = mock.fn(async container => {
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
      mockDockerManager.healthCheck = mock.fn(async () => {
        throw new Error('Health check failed');
      });

      const results = await pool.healthCheckAll();

      assert.ok(results.unhealthy.includes('error-bot'));
      assert.ok(results.recycled.includes('error-bot'));
    });
  });

  describe('cleanup()', () => {
    let pool;
    let mockDockerManager;

    beforeEach(() => {
      ({ mockDockerManager } = createMockDockerManager());
      pool = new ContainerPool(mockDockerManager);
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
      assert.equal(mockDockerManager.stopContainer.mock.calls.length, 2);
    });

    test('continues cleanup even if some containers fail to stop', async () => {
      const workspace = { root: './data' };

      await pool.initializeContainer('bot-1', { id: 'bot-1', sandbox: {} }, workspace);
      await pool.initializeContainer('bot-2', { id: 'bot-2', sandbox: {} }, workspace);

      // Make stopContainer fail for all calls
      mockDockerManager.stopContainer = mock.fn(async () => {
        throw new Error('Stop failed');
      });

      // Should not throw
      await pool.cleanup();

      // Pool should still be cleared
      assert.equal(pool.size, 0);
    });

    test('does nothing when pool is empty', async () => {
      await pool.cleanup();

      assert.equal(mockDockerManager.stopContainer.mock.calls.length, 0);
      assert.equal(pool.size, 0);
    });
  });

  describe('hasContainer()', () => {
    test('returns true when container exists', async () => {
      const { mockDockerManager } = createMockDockerManager();
      const pool = new ContainerPool(mockDockerManager);

      await pool.initializeContainer('test-bot', { id: 'test-bot', sandbox: {} }, { root: '.' });

      assert.equal(pool.hasContainer('test-bot'), true);
    });

    test('returns false when container does not exist', () => {
      const { mockDockerManager } = createMockDockerManager();
      const pool = new ContainerPool(mockDockerManager);

      assert.equal(pool.hasContainer('nonexistent'), false);
    });
  });

  describe('size', () => {
    test('returns 0 for empty pool', () => {
      const { mockDockerManager } = createMockDockerManager();
      const pool = new ContainerPool(mockDockerManager);

      assert.equal(pool.size, 0);
    });

    test('returns correct count of containers', async () => {
      const { mockDockerManager } = createMockDockerManager();
      const pool = new ContainerPool(mockDockerManager);

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
      const { mockDockerManager } = createMockDockerManager();
      const pool = new ContainerPool(mockDockerManager);

      assert.deepEqual(pool.getBotIds(), []);
    });

    test('returns all bot IDs', async () => {
      const { mockDockerManager } = createMockDockerManager();
      const pool = new ContainerPool(mockDockerManager);

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

  test('stores cause', () => {
    const cause = new Error('Original error');
    const error = new ContainerPoolError('Test error', { cause });
    assert.equal(error.cause, cause);
  });

  test('stores all options together', () => {
    const cause = new Error('Original');
    const error = new ContainerPoolError('Multi-option error', {
      cause,
      operation: 'initializeContainer',
      botId: 'test-bot',
    });

    assert.equal(error.cause, cause);
    assert.equal(error.operation, 'initializeContainer');
    assert.equal(error.botId, 'test-bot');
  });
});
