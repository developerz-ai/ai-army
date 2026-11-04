/**
 * Unit tests for ContainerBackend
 *
 * Tests the abstract ContainerBackend interface contract:
 * - Abstract class cannot be instantiated directly
 * - All abstract methods throw when not implemented
 * - Custom error class (ContainerBackendError) works correctly
 *
 * Note: These are unit tests for the interface contract.
 * IncusBackend.test.js tests the concrete implementation.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ContainerBackend,
  ContainerBackendError,
  BACKEND_TYPES,
} from '../../../src/execution/container-backend.js';

/**
 * Create a test subclass of ContainerBackend
 * @param {Object} [implementations={}] - Method implementations to override
 * @returns {ContainerBackend} Test backend instance
 */
function createTestBackend(implementations = {}) {
  class TestBackend extends ContainerBackend {
    constructor() {
      super(BACKEND_TYPES.INCUS);
    }
  }

  const backend = new TestBackend();

  // Override with provided implementations
  for (const [method, implementation] of Object.entries(implementations)) {
    backend[method] = implementation;
  }

  return backend;
}

describe('ContainerBackend', () => {
  describe('constructor', () => {
    test('cannot be instantiated directly', () => {
      assert.throws(
        () => new ContainerBackend(BACKEND_TYPES.INCUS),
        err => {
          assert.equal(err.name, 'ContainerBackendError');
          assert.match(err.message, /abstract and cannot be instantiated directly/);
          assert.equal(err.operation, 'constructor');
          return true;
        }
      );
    });

    test('can be extended by subclasses', () => {
      class TestBackend extends ContainerBackend {
        constructor() {
          super(BACKEND_TYPES.INCUS);
        }
      }

      const backend = new TestBackend();
      assert.ok(backend instanceof ContainerBackend);
      assert.equal(backend.type, BACKEND_TYPES.INCUS);
    });

    test('stores backend type', () => {
      class TestBackend extends ContainerBackend {
        constructor() {
          super(BACKEND_TYPES.INCUS);
        }
      }

      const backend = new TestBackend();
      assert.equal(backend.type, BACKEND_TYPES.INCUS);
    });
  });

  describe('abstract methods', () => {
    test('createContainer() throws when not implemented', async () => {
      const backend = createTestBackend();

      await assert.rejects(
        () => backend.createContainer({ id: 'test' }, { root: './data' }),
        err => {
          assert.equal(err.name, 'ContainerBackendError');
          assert.match(err.message, /createContainer\(\) not implemented/);
          assert.equal(err.operation, 'createContainer');
          assert.equal(err.backend, BACKEND_TYPES.INCUS);
          return true;
        }
      );
    });

    test('startContainer() throws when not implemented', async () => {
      const backend = createTestBackend();

      await assert.rejects(
        () => backend.startContainer({ id: 'container-123' }),
        err => {
          assert.equal(err.name, 'ContainerBackendError');
          assert.match(err.message, /startContainer\(\) not implemented/);
          assert.equal(err.operation, 'startContainer');
          assert.equal(err.backend, BACKEND_TYPES.INCUS);
          return true;
        }
      );
    });

    test('stopContainer() throws when not implemented', async () => {
      const backend = createTestBackend();

      await assert.rejects(
        () => backend.stopContainer({ id: 'container-123' }),
        err => {
          assert.equal(err.name, 'ContainerBackendError');
          assert.match(err.message, /stopContainer\(\) not implemented/);
          assert.equal(err.operation, 'stopContainer');
          assert.equal(err.backend, BACKEND_TYPES.INCUS);
          return true;
        }
      );
    });

    test('exec() throws when not implemented', async () => {
      const backend = createTestBackend();

      await assert.rejects(
        () => backend.exec({ id: 'container-123' }, 'echo hello'),
        err => {
          assert.equal(err.name, 'ContainerBackendError');
          assert.match(err.message, /exec\(\) not implemented/);
          assert.equal(err.operation, 'exec');
          assert.equal(err.backend, BACKEND_TYPES.INCUS);
          return true;
        }
      );
    });

    test('healthCheck() throws when not implemented', async () => {
      const backend = createTestBackend();

      await assert.rejects(
        () => backend.healthCheck({ id: 'container-123' }),
        err => {
          assert.equal(err.name, 'ContainerBackendError');
          assert.match(err.message, /healthCheck\(\) not implemented/);
          assert.equal(err.operation, 'healthCheck');
          assert.equal(err.backend, BACKEND_TYPES.INCUS);
          return true;
        }
      );
    });

    test('installPackages() throws when not implemented', async () => {
      const backend = createTestBackend();

      await assert.rejects(
        () => backend.installPackages({ id: 'container-123' }, ['git', 'curl']),
        err => {
          assert.equal(err.name, 'ContainerBackendError');
          assert.match(err.message, /installPackages\(\) not implemented/);
          assert.equal(err.operation, 'installPackages');
          assert.equal(err.backend, BACKEND_TYPES.INCUS);
          return true;
        }
      );
    });

    test('removeContainerByName() throws when not implemented', async () => {
      const backend = createTestBackend();

      await assert.rejects(
        () => backend.removeContainerByName('ai-army-test-bot'),
        err => {
          assert.equal(err.name, 'ContainerBackendError');
          assert.match(err.message, /removeContainerByName\(\) not implemented/);
          assert.equal(err.operation, 'removeContainerByName');
          assert.equal(err.backend, BACKEND_TYPES.INCUS);
          return true;
        }
      );
    });

    test('listManagedContainers() throws when not implemented', async () => {
      const backend = createTestBackend();

      await assert.rejects(
        () => backend.listManagedContainers({ all: true }),
        err => {
          assert.equal(err.name, 'ContainerBackendError');
          assert.match(err.message, /listManagedContainers\(\) not implemented/);
          assert.equal(err.operation, 'listManagedContainers');
          assert.equal(err.backend, BACKEND_TYPES.INCUS);
          return true;
        }
      );
    });

    test('getContainerByBotId() throws when not implemented', async () => {
      const backend = createTestBackend();

      await assert.rejects(
        () => backend.getContainerByBotId('test-bot'),
        err => {
          assert.equal(err.name, 'ContainerBackendError');
          assert.match(err.message, /getContainerByBotId\(\) not implemented/);
          assert.equal(err.operation, 'getContainerByBotId');
          assert.equal(err.backend, BACKEND_TYPES.INCUS);
          return true;
        }
      );
    });

    test('getInfo() throws when not implemented', async () => {
      const backend = createTestBackend();

      await assert.rejects(
        () => backend.getInfo(),
        err => {
          assert.equal(err.name, 'ContainerBackendError');
          assert.match(err.message, /getInfo\(\) not implemented/);
          assert.equal(err.operation, 'getInfo');
          assert.equal(err.backend, BACKEND_TYPES.INCUS);
          return true;
        }
      );
    });
  });

  describe('method implementations', () => {
    test('implemented methods work correctly', async () => {
      const backend = createTestBackend({
        createContainer: async (botConfig, _workspace) => ({
          id: `container-${botConfig.id}`,
        }),
      });

      const container = await backend.createContainer({ id: 'test-bot' }, { root: './data' });

      assert.equal(container.id, 'container-test-bot');
    });

    test('implemented methods can return values', async () => {
      const backend = createTestBackend({
        healthCheck: async () => true,
      });

      const result = await backend.healthCheck({ id: 'container-123' });

      assert.equal(result, true);
    });

    test('implemented methods can throw custom errors', async () => {
      const backend = createTestBackend({
        exec: async () => {
          throw new ContainerBackendError('Command failed', {
            operation: 'exec',
            containerId: 'container-123',
          });
        },
      });

      await assert.rejects(
        () => backend.exec({ id: 'container-123' }, 'false'),
        err => {
          assert.equal(err.name, 'ContainerBackendError');
          assert.match(err.message, /Command failed/);
          assert.equal(err.operation, 'exec');
          assert.equal(err.containerId, 'container-123');
          return true;
        }
      );
    });
  });

  describe('BACKEND_TYPES', () => {
    test('defines INCUS backend type', () => {
      assert.equal(BACKEND_TYPES.INCUS, 'incus');
    });

    test('defines JUST_BASH backend type', () => {
      assert.equal(BACKEND_TYPES.JUST_BASH, 'just-bash');
    });

    test('does not define DOCKER backend type', () => {
      assert.equal(BACKEND_TYPES.DOCKER, undefined);
    });
  });
});

describe('ContainerBackendError', () => {
  test('is an instance of Error', () => {
    const error = new ContainerBackendError('Test error');
    assert.ok(error instanceof Error);
  });

  test('has correct name', () => {
    const error = new ContainerBackendError('Test error');
    assert.equal(error.name, 'ContainerBackendError');
  });

  test('stores operation', () => {
    const error = new ContainerBackendError('Test error', { operation: 'createContainer' });
    assert.equal(error.operation, 'createContainer');
  });

  test('stores containerId', () => {
    const error = new ContainerBackendError('Test error', { containerId: 'container-123' });
    assert.equal(error.containerId, 'container-123');
  });

  test('stores botId', () => {
    const error = new ContainerBackendError('Test error', { botId: 'test-bot' });
    assert.equal(error.botId, 'test-bot');
  });

  test('stores backend', () => {
    const error = new ContainerBackendError('Test error', { backend: BACKEND_TYPES.INCUS });
    assert.equal(error.backend, BACKEND_TYPES.INCUS);
  });

  test('stores cause via standard Error options', () => {
    const cause = new Error('Original error');
    const error = new ContainerBackendError('Test error', { cause });
    assert.equal(error.cause, cause);
    assert.ok(error.cause instanceof Error);
  });

  test('stores all options together including cause', () => {
    const cause = new Error('Original');
    const error = new ContainerBackendError('Multi-option error', {
      cause,
      operation: 'exec',
      containerId: 'container-123',
      botId: 'test-bot',
      backend: BACKEND_TYPES.INCUS,
    });

    assert.equal(error.cause, cause);
    assert.ok(error.cause instanceof Error);
    assert.equal(error.operation, 'exec');
    assert.equal(error.containerId, 'container-123');
    assert.equal(error.botId, 'test-bot');
    assert.equal(error.backend, BACKEND_TYPES.INCUS);
  });
});
