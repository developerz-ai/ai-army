/**
 * Unit tests for DockerBackend
 *
 * Tests that DockerBackend correctly implements the ContainerBackend
 * interface by delegating all operations to the underlying DockerManager.
 * Verifies interface compliance and adapter behavior.
 */

import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { DockerBackend } from '../../../src/execution/docker-backend.js';
import { ContainerBackend, BACKEND_TYPES } from '../../../src/execution/container-backend.js';
import { DockerError } from '../../../src/execution/docker-manager.js';

/**
 * Create a mock DockerManager with all methods stubbed
 * @returns {Object} Mock DockerManager
 */
function createMockManager() {
  return {
    createContainer: mock.fn(async () => ({ id: 'container-123' })),
    startContainer: mock.fn(async () => {}),
    stopContainer: mock.fn(async () => {}),
    exec: mock.fn(async () => ({ stdout: 'hello', stderr: '', exitCode: 0 })),
    healthCheck: mock.fn(async () => true),
    installPackages: mock.fn(async () => {}),
    removeContainerByName: mock.fn(async () => true),
    listManagedContainers: mock.fn(async () => []),
    getContainerByBotId: mock.fn(async () => ({ id: 'container-123' })),
    getInfo: mock.fn(async () => ({ ServerVersion: '24.0.0' })),
  };
}

/**
 * Create a DockerBackend with a mock manager injected
 * @returns {{ backend: DockerBackend, mockManager: Object }}
 */
function createMockedBackend() {
  const backend = new DockerBackend();
  const mockManager = createMockManager();
  backend.manager = mockManager;
  return { backend, mockManager };
}

describe('DockerBackend', () => {
  describe('constructor', () => {
    test('extends ContainerBackend', () => {
      const backend = new DockerBackend();
      assert.ok(backend instanceof ContainerBackend);
    });

    test('has type set to DOCKER', () => {
      const backend = new DockerBackend();
      assert.equal(backend.type, BACKEND_TYPES.DOCKER);
      assert.equal(backend.type, 'docker');
    });

    test('creates an internal DockerManager instance', () => {
      const backend = new DockerBackend();
      assert.ok(backend.manager);
    });

    test('passes dockerHost to DockerManager', () => {
      const backend = new DockerBackend('/custom/docker.sock');
      assert.ok(backend.manager);
    });
  });

  describe('createContainer()', () => {
    test('delegates to manager.createContainer()', async () => {
      const { backend, mockManager } = createMockedBackend();
      const botConfig = { id: 'test-bot' };
      const workspace = { root: './data' };

      const result = await backend.createContainer(botConfig, workspace);

      assert.equal(mockManager.createContainer.mock.calls.length, 1);
      const args = mockManager.createContainer.mock.calls[0].arguments;
      assert.equal(args[0], botConfig);
      assert.equal(args[1], workspace);
      assert.deepEqual(result, { id: 'container-123' });
    });

    test('propagates DockerError from manager', async () => {
      const { backend, mockManager } = createMockedBackend();

      mockManager.createContainer = mock.fn(async () => {
        throw new DockerError('Bot configuration with id is required', {
          operation: 'createContainer',
        });
      });

      await assert.rejects(
        () => backend.createContainer(null, { root: './data' }),
        err => {
          assert.equal(err.name, 'DockerError');
          assert.match(err.message, /Bot configuration with id is required/);
          assert.equal(err.operation, 'createContainer');
          return true;
        }
      );
    });
  });

  describe('startContainer()', () => {
    test('delegates to manager.startContainer()', async () => {
      const { backend, mockManager } = createMockedBackend();
      const container = { id: 'container-123' };

      await backend.startContainer(container, 5000);

      assert.equal(mockManager.startContainer.mock.calls.length, 1);
      const args = mockManager.startContainer.mock.calls[0].arguments;
      assert.equal(args[0], container);
      assert.equal(args[1], 5000);
    });

    test('propagates DockerError from manager', async () => {
      const { backend, mockManager } = createMockedBackend();

      mockManager.startContainer = mock.fn(async () => {
        throw new DockerError('Failed to start container: timeout', {
          operation: 'startContainer',
          containerId: 'container-123',
        });
      });

      await assert.rejects(
        () => backend.startContainer({ id: 'container-123' }),
        err => {
          assert.equal(err.name, 'DockerError');
          assert.match(err.message, /Failed to start container/);
          return true;
        }
      );
    });
  });

  describe('stopContainer()', () => {
    test('delegates to manager.stopContainer()', async () => {
      const { backend, mockManager } = createMockedBackend();
      const container = { id: 'container-123' };

      await backend.stopContainer(container, 30);

      assert.equal(mockManager.stopContainer.mock.calls.length, 1);
      const args = mockManager.stopContainer.mock.calls[0].arguments;
      assert.equal(args[0], container);
      assert.equal(args[1], 30);
    });

    test('propagates DockerError from manager', async () => {
      const { backend, mockManager } = createMockedBackend();

      mockManager.stopContainer = mock.fn(async () => {
        throw new DockerError('Failed to stop container', {
          operation: 'stopContainer',
        });
      });

      await assert.rejects(
        () => backend.stopContainer({ id: 'container-123' }),
        err => {
          assert.equal(err.name, 'DockerError');
          return true;
        }
      );
    });
  });

  describe('exec()', () => {
    test('delegates to manager.exec()', async () => {
      const { backend, mockManager } = createMockedBackend();
      const container = { id: 'container-123' };
      const options = { timeout: 5000, user: 'root' };

      const result = await backend.exec(container, 'echo hello', options);

      assert.equal(mockManager.exec.mock.calls.length, 1);
      const args = mockManager.exec.mock.calls[0].arguments;
      assert.equal(args[0], container);
      assert.equal(args[1], 'echo hello');
      assert.equal(args[2], options);
      assert.deepEqual(result, { stdout: 'hello', stderr: '', exitCode: 0 });
    });

    test('propagates DockerError from manager', async () => {
      const { backend, mockManager } = createMockedBackend();

      mockManager.exec = mock.fn(async () => {
        throw new DockerError('Command must be a non-empty string', {
          operation: 'exec',
        });
      });

      await assert.rejects(
        () => backend.exec({ id: 'container-123' }, ''),
        err => {
          assert.equal(err.name, 'DockerError');
          assert.match(err.message, /Command must be a non-empty string/);
          return true;
        }
      );
    });
  });

  describe('healthCheck()', () => {
    test('delegates to manager.healthCheck()', async () => {
      const { backend, mockManager } = createMockedBackend();
      const container = { id: 'container-123' };

      const result = await backend.healthCheck(container);

      assert.equal(mockManager.healthCheck.mock.calls.length, 1);
      assert.equal(mockManager.healthCheck.mock.calls[0].arguments[0], container);
      assert.equal(result, true);
    });

    test('returns false when manager returns false', async () => {
      const { backend, mockManager } = createMockedBackend();

      mockManager.healthCheck = mock.fn(async () => false);

      const result = await backend.healthCheck(null);

      assert.equal(result, false);
    });
  });

  describe('installPackages()', () => {
    test('delegates to manager.installPackages()', async () => {
      const { backend, mockManager } = createMockedBackend();
      const container = { id: 'container-123' };
      const packages = ['git', 'curl'];
      const options = { timeout: 60000 };

      await backend.installPackages(container, packages, options);

      assert.equal(mockManager.installPackages.mock.calls.length, 1);
      const args = mockManager.installPackages.mock.calls[0].arguments;
      assert.equal(args[0], container);
      assert.deepEqual(args[1], packages);
      assert.equal(args[2], options);
    });

    test('propagates DockerError from manager', async () => {
      const { backend, mockManager } = createMockedBackend();

      mockManager.installPackages = mock.fn(async () => {
        throw new DockerError('Container is required', {
          operation: 'installPackages',
        });
      });

      await assert.rejects(
        () => backend.installPackages(null, ['git']),
        err => {
          assert.equal(err.name, 'DockerError');
          assert.match(err.message, /Container is required/);
          return true;
        }
      );
    });
  });

  describe('removeContainerByName()', () => {
    test('delegates to manager.removeContainerByName()', async () => {
      const { backend, mockManager } = createMockedBackend();

      const result = await backend.removeContainerByName('ai-army-test-bot');

      assert.equal(mockManager.removeContainerByName.mock.calls.length, 1);
      assert.equal(
        mockManager.removeContainerByName.mock.calls[0].arguments[0],
        'ai-army-test-bot'
      );
      assert.equal(result, true);
    });

    test('returns false when manager returns false', async () => {
      const { backend, mockManager } = createMockedBackend();

      mockManager.removeContainerByName = mock.fn(async () => false);

      const result = await backend.removeContainerByName('nonexistent');

      assert.equal(result, false);
    });
  });

  describe('listManagedContainers()', () => {
    test('delegates to manager.listManagedContainers()', async () => {
      const { backend, mockManager } = createMockedBackend();
      const containers = [{ Id: 'c1' }, { Id: 'c2' }];
      mockManager.listManagedContainers = mock.fn(async () => containers);

      const result = await backend.listManagedContainers({ all: false });

      assert.equal(mockManager.listManagedContainers.mock.calls.length, 1);
      assert.deepEqual(mockManager.listManagedContainers.mock.calls[0].arguments[0], {
        all: false,
      });
      assert.deepEqual(result, containers);
    });
  });

  describe('getContainerByBotId()', () => {
    test('delegates to manager.getContainerByBotId()', async () => {
      const { backend, mockManager } = createMockedBackend();

      const result = await backend.getContainerByBotId('test-bot');

      assert.equal(mockManager.getContainerByBotId.mock.calls.length, 1);
      assert.equal(mockManager.getContainerByBotId.mock.calls[0].arguments[0], 'test-bot');
      assert.deepEqual(result, { id: 'container-123' });
    });

    test('returns null when manager returns null', async () => {
      const { backend, mockManager } = createMockedBackend();

      mockManager.getContainerByBotId = mock.fn(async () => null);

      const result = await backend.getContainerByBotId('nonexistent');

      assert.equal(result, null);
    });
  });

  describe('getInfo()', () => {
    test('delegates to manager.getInfo()', async () => {
      const { backend, mockManager } = createMockedBackend();

      const result = await backend.getInfo();

      assert.equal(mockManager.getInfo.mock.calls.length, 1);
      assert.deepEqual(result, { ServerVersion: '24.0.0' });
    });

    test('propagates DockerError from manager', async () => {
      const { backend, mockManager } = createMockedBackend();

      mockManager.getInfo = mock.fn(async () => {
        throw new DockerError('Failed to connect to Docker daemon', {
          operation: 'getInfo',
        });
      });

      await assert.rejects(
        () => backend.getInfo(),
        err => {
          assert.equal(err.name, 'DockerError');
          assert.match(err.message, /Failed to connect to Docker daemon/);
          return true;
        }
      );
    });
  });

  describe('interface compliance', () => {
    test('implements all ContainerBackend abstract methods', () => {
      const backend = new DockerBackend();

      // All methods from ContainerBackend should exist
      assert.equal(typeof backend.createContainer, 'function');
      assert.equal(typeof backend.startContainer, 'function');
      assert.equal(typeof backend.stopContainer, 'function');
      assert.equal(typeof backend.exec, 'function');
      assert.equal(typeof backend.healthCheck, 'function');
      assert.equal(typeof backend.installPackages, 'function');
      assert.equal(typeof backend.removeContainerByName, 'function');
      assert.equal(typeof backend.listManagedContainers, 'function');
      assert.equal(typeof backend.getContainerByBotId, 'function');
      assert.equal(typeof backend.getInfo, 'function');
    });

    test('does not call ContainerBackend default implementations', async () => {
      const { backend } = createMockedBackend();

      // None of these should throw ContainerBackendError
      // (which would mean the base class method was called instead of the override)
      await backend.createContainer({ id: 'test' }, { root: './data' });
      await backend.startContainer({ id: 'c1' });
      await backend.stopContainer({ id: 'c1' });
      await backend.exec({ id: 'c1' }, 'echo hi');
      await backend.healthCheck({ id: 'c1' });
      await backend.installPackages({ id: 'c1' }, ['git']);
      await backend.removeContainerByName('test');
      await backend.listManagedContainers();
      await backend.getContainerByBotId('test');
      await backend.getInfo();
    });
  });
});
