/**
 * Unit tests for IncusBackend
 *
 * Tests that IncusBackend correctly implements the ContainerBackend
 * interface by delegating operations to the underlying IncusClient.
 * Verifies interface compliance, error handling, and Incus-specific
 * behavior like image parsing and container handle format.
 */

import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { IncusBackend } from '../../../src/execution/incus-backend.js';
import { ContainerBackend, BACKEND_TYPES } from '../../../src/execution/container-backend.js';
import { IncusClientError } from '../../../src/execution/incus-client.js';

/**
 * Create a mock IncusClient with all methods stubbed
 * @returns {Object} Mock IncusClient
 */
function createMockClient() {
  return {
    createInstance: mock.fn(async () => ({})),
    startInstance: mock.fn(async () => ({})),
    stopInstance: mock.fn(async () => ({})),
    deleteInstance: mock.fn(async () => ({})),
    getInstanceState: mock.fn(async () => ({ status: 'Running' })),
    listInstances: mock.fn(async () => []),
    execCommand: mock.fn(async () => ({ exitCode: 0, stdout: 'hello', stderr: '' })),
    pushFile: mock.fn(async () => {}),
    pullFile: mock.fn(async () => ''),
    _request: mock.fn(async () => ({
      metadata: { environment: { server_version: '0.7' } },
    })),
  };
}

/**
 * Create an IncusBackend with a mock client injected
 * @returns {{ backend: IncusBackend, mockClient: Object }}
 */
function createMockedBackend() {
  const backend = new IncusBackend();
  const mockClient = createMockClient();
  backend.client = mockClient;
  return { backend, mockClient };
}

describe('IncusBackend', () => {
  describe('constructor', () => {
    test('extends ContainerBackend', () => {
      const backend = new IncusBackend();
      assert.ok(backend instanceof ContainerBackend);
    });

    test('has type set to INCUS', () => {
      const backend = new IncusBackend();
      assert.equal(backend.type, BACKEND_TYPES.INCUS);
      assert.equal(backend.type, 'incus');
    });

    test('creates an internal IncusClient instance', () => {
      const backend = new IncusBackend();
      assert.ok(backend.client);
    });

    test('passes options to IncusClient', () => {
      const backend = new IncusBackend({ socketPath: '/custom/incus.socket' });
      assert.equal(backend.client.socketPath, '/custom/incus.socket');
    });
  });

  describe('createContainer()', () => {
    test('creates instance with correct name', async () => {
      const { backend, mockClient } = createMockedBackend();
      const botConfig = { id: 'test-bot' };
      const workspace = { root: '/data/bots/test-bot' };

      await backend.createContainer(botConfig, workspace);

      assert.equal(mockClient.createInstance.mock.calls.length, 1);
      const args = mockClient.createInstance.mock.calls[0].arguments;
      assert.equal(args[0], 'ai-army-test-bot');
    });

    test('returns handle with name and id', async () => {
      const { backend } = createMockedBackend();

      const result = await backend.createContainer({ id: 'my-bot' }, { root: '/data' });

      assert.deepEqual(result, { name: 'ai-army-my-bot', id: 'ai-army-my-bot' });
    });

    test('uses default image when not specified', async () => {
      const { backend, mockClient } = createMockedBackend();

      await backend.createContainer({ id: 'test' }, { root: '/data' });

      const config = mockClient.createInstance.mock.calls[0].arguments[1];
      assert.equal(config.source.alias, 'ubuntu/24.04/cloud');
    });

    test('uses custom incusImage from botConfig', async () => {
      const { backend, mockClient } = createMockedBackend();
      const botConfig = {
        id: 'test',
        sandbox: { incusImage: 'images:debian/12/cloud' },
      };

      await backend.createContainer(botConfig, { root: '/data' });

      const config = mockClient.createInstance.mock.calls[0].arguments[1];
      assert.equal(config.source.alias, 'debian/12/cloud');
    });

    test('configures resource limits from sandbox config', async () => {
      const { backend, mockClient } = createMockedBackend();
      const botConfig = {
        id: 'test',
        sandbox: { memory: '4GB', cpus: 4 },
      };

      await backend.createContainer(botConfig, { root: '/data' });

      const config = mockClient.createInstance.mock.calls[0].arguments[1];
      assert.equal(config.config['limits.memory'], '4GB');
      assert.equal(config.config['limits.cpu'], '4');
    });

    test('uses default resource limits', async () => {
      const { backend, mockClient } = createMockedBackend();

      await backend.createContainer({ id: 'test' }, { root: '/data' });

      const config = mockClient.createInstance.mock.calls[0].arguments[1];
      assert.equal(config.config['limits.memory'], '2GB');
      assert.equal(config.config['limits.cpu'], '2');
    });

    test('sets ai-army labels in config', async () => {
      const { backend, mockClient } = createMockedBackend();

      await backend.createContainer({ id: 'code-bot' }, { root: '/data' });

      const config = mockClient.createInstance.mock.calls[0].arguments[1];
      assert.equal(config.config['user.ai-army.bot-id'], 'code-bot');
      assert.equal(config.config['user.ai-army.managed'], 'true');
    });

    test('mounts workspace as disk device', async () => {
      const { backend, mockClient } = createMockedBackend();

      await backend.createContainer({ id: 'test' }, { root: '/data/bots/test' });

      const instanceConfig = mockClient.createInstance.mock.calls[0].arguments[1];
      assert.deepEqual(instanceConfig.devices.workspace, {
        type: 'disk',
        source: '/data/bots/test',
        path: '/home/agent',
      });
    });

    test('enables nesting when configured', async () => {
      const { backend, mockClient } = createMockedBackend();
      const botConfig = {
        id: 'test',
        sandbox: { nesting: true },
      };

      await backend.createContainer(botConfig, { root: '/data' });

      const config = mockClient.createInstance.mock.calls[0].arguments[1];
      assert.equal(config.config['security.nesting'], 'true');
    });

    test('does not enable nesting by default', async () => {
      const { backend, mockClient } = createMockedBackend();

      await backend.createContainer({ id: 'test' }, { root: '/data' });

      const config = mockClient.createInstance.mock.calls[0].arguments[1];
      assert.equal(config.config['security.nesting'], undefined);
    });

    test('throws ContainerBackendError when botConfig is missing', async () => {
      const { backend } = createMockedBackend();

      await assert.rejects(
        () => backend.createContainer(null, { root: '/data' }),
        err => {
          assert.equal(err.name, 'ContainerBackendError');
          assert.match(err.message, /Bot configuration with id is required/);
          assert.equal(err.operation, 'createContainer');
          assert.equal(err.backend, 'incus');
          return true;
        }
      );
    });

    test('throws ContainerBackendError when botConfig.id is missing', async () => {
      const { backend } = createMockedBackend();

      await assert.rejects(
        () => backend.createContainer({}, { root: '/data' }),
        err => {
          assert.equal(err.name, 'ContainerBackendError');
          assert.match(err.message, /Bot configuration with id is required/);
          return true;
        }
      );
    });

    test('wraps IncusClientError in ContainerBackendError', async () => {
      const { backend, mockClient } = createMockedBackend();
      mockClient.createInstance = mock.fn(async () => {
        throw new IncusClientError('Instance already exists', {
          operation: 'createInstance',
          instanceName: 'ai-army-test',
          statusCode: 409,
        });
      });

      await assert.rejects(
        () => backend.createContainer({ id: 'test' }, { root: '/data' }),
        err => {
          assert.equal(err.name, 'ContainerBackendError');
          assert.match(err.message, /Failed to create container for bot test/);
          assert.equal(err.operation, 'createContainer');
          assert.equal(err.backend, 'incus');
          assert.ok(err.cause instanceof IncusClientError);
          return true;
        }
      );
    });
  });

  describe('startContainer()', () => {
    test('delegates to client.startInstance()', async () => {
      const { backend, mockClient } = createMockedBackend();
      const container = { name: 'ai-army-test', id: 'ai-army-test' };

      await backend.startContainer(container);

      assert.equal(mockClient.startInstance.mock.calls.length, 1);
      assert.equal(mockClient.startInstance.mock.calls[0].arguments[0], 'ai-army-test');
    });

    test('waits for container to be running', async () => {
      const { backend, mockClient } = createMockedBackend();
      const container = { name: 'ai-army-test', id: 'ai-army-test' };

      await backend.startContainer(container, 5000);

      // getInstanceState should be called to verify running state
      assert.ok(mockClient.getInstanceState.mock.calls.length >= 1);
    });

    test('throws when container handle is missing', async () => {
      const { backend } = createMockedBackend();

      await assert.rejects(
        () => backend.startContainer(null),
        err => {
          assert.equal(err.name, 'ContainerBackendError');
          assert.match(err.message, /Container handle with name is required/);
          assert.equal(err.operation, 'startContainer');
          return true;
        }
      );
    });

    test('throws when container.name is missing', async () => {
      const { backend } = createMockedBackend();

      await assert.rejects(
        () => backend.startContainer({ id: 'test' }),
        err => {
          assert.equal(err.name, 'ContainerBackendError');
          assert.match(err.message, /Container handle with name is required/);
          return true;
        }
      );
    });

    test('wraps IncusClientError on start failure', async () => {
      const { backend, mockClient } = createMockedBackend();
      mockClient.startInstance = mock.fn(async () => {
        throw new IncusClientError('Instance not found', {
          operation: 'startInstance',
          statusCode: 404,
        });
      });

      await assert.rejects(
        () => backend.startContainer({ name: 'ai-army-test', id: 'ai-army-test' }),
        err => {
          assert.equal(err.name, 'ContainerBackendError');
          assert.match(err.message, /Failed to start container/);
          return true;
        }
      );
    });
  });

  describe('stopContainer()', () => {
    test('stops and deletes the instance', async () => {
      const { backend, mockClient } = createMockedBackend();
      const container = { name: 'ai-army-test', id: 'ai-army-test' };

      await backend.stopContainer(container, 30);

      assert.equal(mockClient.stopInstance.mock.calls.length, 1);
      assert.equal(mockClient.stopInstance.mock.calls[0].arguments[0], 'ai-army-test');
      assert.equal(mockClient.stopInstance.mock.calls[0].arguments[1], 30);
      assert.equal(mockClient.deleteInstance.mock.calls.length, 1);
      assert.equal(mockClient.deleteInstance.mock.calls[0].arguments[0], 'ai-army-test');
    });

    test('ignores already-stopped errors during stop', async () => {
      const { backend, mockClient } = createMockedBackend();
      mockClient.stopInstance = mock.fn(async () => {
        throw new IncusClientError('The instance is already stopped', {
          operation: 'stopInstance',
          statusCode: 400,
          incusError: 'The instance is already stopped',
        });
      });
      const container = { name: 'ai-army-test', id: 'ai-army-test' };

      // Should not throw — skips stop and proceeds to delete
      await backend.stopContainer(container);

      assert.equal(mockClient.deleteInstance.mock.calls.length, 1);
    });

    test('ignores not-found errors during delete', async () => {
      const { backend, mockClient } = createMockedBackend();
      mockClient.deleteInstance = mock.fn(async () => {
        throw new IncusClientError('Instance not found', {
          operation: 'deleteInstance',
          statusCode: 404,
        });
      });
      const container = { name: 'ai-army-test', id: 'ai-army-test' };

      // Should not throw
      await backend.stopContainer(container);
    });

    test('throws when container handle is missing', async () => {
      const { backend } = createMockedBackend();

      await assert.rejects(
        () => backend.stopContainer(null),
        err => {
          assert.equal(err.name, 'ContainerBackendError');
          assert.equal(err.operation, 'stopContainer');
          return true;
        }
      );
    });

    test('wraps unexpected errors', async () => {
      const { backend, mockClient } = createMockedBackend();
      mockClient.stopInstance = mock.fn(async () => {
        throw new IncusClientError('Connection refused', {
          operation: 'stopInstance',
          statusCode: 500,
        });
      });
      const container = { name: 'ai-army-test', id: 'ai-army-test' };

      await assert.rejects(
        () => backend.stopContainer(container),
        err => {
          assert.equal(err.name, 'ContainerBackendError');
          assert.match(err.message, /Failed to stop container/);
          return true;
        }
      );
    });
  });

  describe('exec()', () => {
    test('executes command via client.execCommand()', async () => {
      const { backend, mockClient } = createMockedBackend();
      const container = { name: 'ai-army-test', id: 'ai-army-test' };

      const result = await backend.exec(container, 'echo hello');

      assert.equal(mockClient.execCommand.mock.calls.length, 1);
      const args = mockClient.execCommand.mock.calls[0].arguments;
      assert.equal(args[0], 'ai-army-test');
      assert.deepEqual(args[1], ['sh', '-c', 'echo hello']);
      assert.deepEqual(result, { exitCode: 0, stdout: 'hello', stderr: '' });
    });

    test('passes workingDir as cwd option', async () => {
      const { backend, mockClient } = createMockedBackend();
      const container = { name: 'ai-army-test', id: 'ai-army-test' };

      await backend.exec(container, 'ls', { workingDir: '/tmp' });

      const execOptions = mockClient.execCommand.mock.calls[0].arguments[2];
      assert.equal(execOptions.cwd, '/tmp');
    });

    test('maps user "root" to UID 0', async () => {
      const { backend, mockClient } = createMockedBackend();
      const container = { name: 'ai-army-test', id: 'ai-army-test' };

      await backend.exec(container, 'whoami', { user: 'root' });

      const execOptions = mockClient.execCommand.mock.calls[0].arguments[2];
      assert.equal(execOptions.user, 0);
    });

    test('trims stdout and stderr', async () => {
      const { backend, mockClient } = createMockedBackend();
      mockClient.execCommand = mock.fn(async () => ({
        exitCode: 0,
        stdout: '  hello world  \n',
        stderr: '  warning  \n',
      }));
      const container = { name: 'ai-army-test', id: 'ai-army-test' };

      const result = await backend.exec(container, 'echo hello world');

      assert.equal(result.stdout, 'hello world');
      assert.equal(result.stderr, 'warning');
    });

    test('handles empty stdout/stderr gracefully', async () => {
      const { backend, mockClient } = createMockedBackend();
      mockClient.execCommand = mock.fn(async () => ({
        exitCode: 0,
        stdout: null,
        stderr: undefined,
      }));
      const container = { name: 'ai-army-test', id: 'ai-army-test' };

      const result = await backend.exec(container, 'true');

      assert.equal(result.stdout, '');
      assert.equal(result.stderr, '');
    });

    test('throws when container handle is missing', async () => {
      const { backend } = createMockedBackend();

      await assert.rejects(
        () => backend.exec(null, 'echo hello'),
        err => {
          assert.equal(err.name, 'ContainerBackendError');
          assert.equal(err.operation, 'exec');
          return true;
        }
      );
    });

    test('throws when command is empty', async () => {
      const { backend } = createMockedBackend();
      const container = { name: 'ai-army-test', id: 'ai-army-test' };

      await assert.rejects(
        () => backend.exec(container, ''),
        err => {
          assert.equal(err.name, 'ContainerBackendError');
          assert.match(err.message, /Command must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws when command is whitespace only', async () => {
      const { backend } = createMockedBackend();
      const container = { name: 'ai-army-test', id: 'ai-army-test' };

      await assert.rejects(
        () => backend.exec(container, '   '),
        err => {
          assert.equal(err.name, 'ContainerBackendError');
          assert.match(err.message, /Command must be a non-empty string/);
          return true;
        }
      );
    });

    test('wraps IncusClientError on exec failure', async () => {
      const { backend, mockClient } = createMockedBackend();
      mockClient.execCommand = mock.fn(async () => {
        throw new IncusClientError('Instance is not running', {
          operation: 'execCommand',
          instanceName: 'ai-army-test',
        });
      });
      const container = { name: 'ai-army-test', id: 'ai-army-test' };

      await assert.rejects(
        () => backend.exec(container, 'echo hello'),
        err => {
          assert.equal(err.name, 'ContainerBackendError');
          assert.match(err.message, /Failed to execute command/);
          assert.ok(err.cause instanceof IncusClientError);
          return true;
        }
      );
    });
  });

  describe('healthCheck()', () => {
    test('returns true when instance is Running', async () => {
      const { backend, mockClient } = createMockedBackend();
      mockClient.getInstanceState = mock.fn(async () => ({ status: 'Running' }));
      const container = { name: 'ai-army-test', id: 'ai-army-test' };

      const result = await backend.healthCheck(container);

      assert.equal(result, true);
    });

    test('returns false when instance is Stopped', async () => {
      const { backend, mockClient } = createMockedBackend();
      mockClient.getInstanceState = mock.fn(async () => ({ status: 'Stopped' }));
      const container = { name: 'ai-army-test', id: 'ai-army-test' };

      const result = await backend.healthCheck(container);

      assert.equal(result, false);
    });

    test('returns false when container handle is null', async () => {
      const { backend } = createMockedBackend();

      const result = await backend.healthCheck(null);

      assert.equal(result, false);
    });

    test('returns false when container.name is missing', async () => {
      const { backend } = createMockedBackend();

      const result = await backend.healthCheck({ id: 'test' });

      assert.equal(result, false);
    });

    test('returns false on error', async () => {
      const { backend, mockClient } = createMockedBackend();
      mockClient.getInstanceState = mock.fn(async () => {
        throw new IncusClientError('Connection refused', {
          operation: 'getInstanceState',
        });
      });
      const container = { name: 'ai-army-test', id: 'ai-army-test' };

      const result = await backend.healthCheck(container);

      assert.equal(result, false);
    });
  });

  describe('installPackages()', () => {
    test('runs apt-get update and install via exec', async () => {
      const { backend, mockClient } = createMockedBackend();
      const container = { name: 'ai-army-test', id: 'ai-army-test' };

      await backend.installPackages(container, ['git', 'curl']);

      assert.equal(mockClient.execCommand.mock.calls.length, 1);
      const args = mockClient.execCommand.mock.calls[0].arguments;
      assert.equal(args[0], 'ai-army-test');
      assert.deepEqual(args[1], [
        'sh',
        '-c',
        'apt-get update -qq && apt-get install -y --no-install-recommends git curl',
      ]);
    });

    test('runs as root user', async () => {
      const { backend, mockClient } = createMockedBackend();
      const container = { name: 'ai-army-test', id: 'ai-army-test' };

      await backend.installPackages(container, ['git']);

      const execOptions = mockClient.execCommand.mock.calls[0].arguments[2];
      assert.equal(execOptions.user, 0);
    });

    test('skips when packages array is empty', async () => {
      const { backend, mockClient } = createMockedBackend();
      const container = { name: 'ai-army-test', id: 'ai-army-test' };

      await backend.installPackages(container, []);

      assert.equal(mockClient.execCommand.mock.calls.length, 0);
    });

    test('skips when packages is null', async () => {
      const { backend, mockClient } = createMockedBackend();
      const container = { name: 'ai-army-test', id: 'ai-army-test' };

      await backend.installPackages(container, null);

      assert.equal(mockClient.execCommand.mock.calls.length, 0);
    });

    test('throws on invalid package name', async () => {
      const { backend } = createMockedBackend();
      const container = { name: 'ai-army-test', id: 'ai-army-test' };

      await assert.rejects(
        () => backend.installPackages(container, ['git; rm -rf /']),
        err => {
          assert.equal(err.name, 'ContainerBackendError');
          assert.match(err.message, /Invalid package name/);
          assert.equal(err.operation, 'installPackages');
          return true;
        }
      );
    });

    test('throws when install command fails', async () => {
      const { backend, mockClient } = createMockedBackend();
      mockClient.execCommand = mock.fn(async () => ({
        exitCode: 1,
        stdout: '',
        stderr: 'E: Unable to locate package nonexistent',
      }));
      const container = { name: 'ai-army-test', id: 'ai-army-test' };

      await assert.rejects(
        () => backend.installPackages(container, ['nonexistent']),
        err => {
          assert.equal(err.name, 'ContainerBackendError');
          assert.match(err.message, /Package installation failed/);
          return true;
        }
      );
    });

    test('throws when container handle is missing', async () => {
      const { backend } = createMockedBackend();

      await assert.rejects(
        () => backend.installPackages(null, ['git']),
        err => {
          assert.equal(err.name, 'ContainerBackendError');
          assert.equal(err.operation, 'installPackages');
          return true;
        }
      );
    });
  });

  describe('removeContainerByName()', () => {
    test('stops and deletes the instance', async () => {
      const { backend, mockClient } = createMockedBackend();

      const result = await backend.removeContainerByName('ai-army-test');

      assert.equal(result, true);
      assert.equal(mockClient.stopInstance.mock.calls.length, 1);
      assert.equal(mockClient.stopInstance.mock.calls[0].arguments[0], 'ai-army-test');
      assert.equal(mockClient.deleteInstance.mock.calls.length, 1);
      assert.equal(mockClient.deleteInstance.mock.calls[0].arguments[0], 'ai-army-test');
    });

    test('returns false when instance not found', async () => {
      const { backend, mockClient } = createMockedBackend();
      mockClient.deleteInstance = mock.fn(async () => {
        throw new IncusClientError('Instance not found', {
          operation: 'deleteInstance',
          statusCode: 404,
        });
      });

      const result = await backend.removeContainerByName('nonexistent');

      assert.equal(result, false);
    });

    test('ignores stop errors (instance may already be stopped)', async () => {
      const { backend, mockClient } = createMockedBackend();
      mockClient.stopInstance = mock.fn(async () => {
        throw new IncusClientError('Already stopped', {
          operation: 'stopInstance',
          statusCode: 400,
        });
      });

      const result = await backend.removeContainerByName('ai-army-test');

      assert.equal(result, true);
      assert.equal(mockClient.deleteInstance.mock.calls.length, 1);
    });

    test('throws on unexpected errors', async () => {
      const { backend, mockClient } = createMockedBackend();
      mockClient.deleteInstance = mock.fn(async () => {
        throw new IncusClientError('Connection refused', {
          operation: 'deleteInstance',
          statusCode: 500,
        });
      });

      await assert.rejects(
        () => backend.removeContainerByName('ai-army-test'),
        err => {
          assert.equal(err.name, 'ContainerBackendError');
          assert.match(err.message, /Failed to remove container/);
          return true;
        }
      );
    });
  });

  describe('listManagedContainers()', () => {
    test('filters instances by ai-army.managed label', async () => {
      const { backend, mockClient } = createMockedBackend();
      mockClient.listInstances = mock.fn(async () => [
        {
          name: 'ai-army-bot-1',
          status: 'Running',
          config: { 'user.ai-army.managed': 'true', 'user.ai-army.bot-id': 'bot-1' },
        },
        {
          name: 'other-instance',
          status: 'Running',
          config: {},
        },
        {
          name: 'ai-army-bot-2',
          status: 'Stopped',
          config: { 'user.ai-army.managed': 'true', 'user.ai-army.bot-id': 'bot-2' },
        },
      ]);

      const result = await backend.listManagedContainers();

      assert.equal(result.length, 2);
      assert.equal(result[0].name, 'ai-army-bot-1');
      assert.equal(result[1].name, 'ai-army-bot-2');
    });

    test('filters to running only when all=false', async () => {
      const { backend, mockClient } = createMockedBackend();
      mockClient.listInstances = mock.fn(async () => [
        {
          name: 'ai-army-bot-1',
          status: 'Running',
          config: { 'user.ai-army.managed': 'true' },
        },
        {
          name: 'ai-army-bot-2',
          status: 'Stopped',
          config: { 'user.ai-army.managed': 'true' },
        },
      ]);

      const result = await backend.listManagedContainers({ all: false });

      assert.equal(result.length, 1);
      assert.equal(result[0].name, 'ai-army-bot-1');
    });

    test('returns empty array when no managed instances exist', async () => {
      const { backend, mockClient } = createMockedBackend();
      mockClient.listInstances = mock.fn(async () => [
        { name: 'other', status: 'Running', config: {} },
      ]);

      const result = await backend.listManagedContainers();

      assert.deepEqual(result, []);
    });

    test('wraps errors in ContainerBackendError', async () => {
      const { backend, mockClient } = createMockedBackend();
      mockClient.listInstances = mock.fn(async () => {
        throw new IncusClientError('Connection refused', {
          operation: 'listInstances',
        });
      });

      await assert.rejects(
        () => backend.listManagedContainers(),
        err => {
          assert.equal(err.name, 'ContainerBackendError');
          assert.match(err.message, /Failed to list containers/);
          return true;
        }
      );
    });
  });

  describe('getContainerByBotId()', () => {
    test('returns handle for existing bot', async () => {
      const { backend, mockClient } = createMockedBackend();
      mockClient.getInstanceState = mock.fn(async () => ({ status: 'Running' }));

      const result = await backend.getContainerByBotId('test-bot');

      assert.deepEqual(result, { name: 'ai-army-test-bot', id: 'ai-army-test-bot' });
      assert.equal(mockClient.getInstanceState.mock.calls[0].arguments[0], 'ai-army-test-bot');
    });

    test('returns null when bot instance not found', async () => {
      const { backend, mockClient } = createMockedBackend();
      mockClient.getInstanceState = mock.fn(async () => {
        throw new IncusClientError('Instance not found', {
          operation: 'getInstanceState',
          statusCode: 404,
        });
      });

      const result = await backend.getContainerByBotId('nonexistent');

      assert.equal(result, null);
    });

    test('returns null on connection error', async () => {
      const { backend, mockClient } = createMockedBackend();
      mockClient.getInstanceState = mock.fn(async () => {
        throw new IncusClientError('Connection refused', {
          operation: 'getInstanceState',
        });
      });

      const result = await backend.getContainerByBotId('test-bot');

      assert.equal(result, null);
    });
  });

  describe('getInfo()', () => {
    test('returns Incus daemon info', async () => {
      const { backend, mockClient } = createMockedBackend();
      const expectedInfo = { metadata: { environment: { server_version: '0.7' } } };
      mockClient._request = mock.fn(async () => expectedInfo);

      const result = await backend.getInfo();

      assert.deepEqual(result, expectedInfo);
      assert.equal(mockClient._request.mock.calls.length, 1);
      assert.equal(mockClient._request.mock.calls[0].arguments[0], 'GET');
      assert.equal(mockClient._request.mock.calls[0].arguments[1], '/1.0');
    });

    test('wraps connection errors', async () => {
      const { backend, mockClient } = createMockedBackend();
      mockClient._request = mock.fn(async () => {
        throw new IncusClientError('Socket not found', {
          operation: 'GET /1.0',
        });
      });

      await assert.rejects(
        () => backend.getInfo(),
        err => {
          assert.equal(err.name, 'ContainerBackendError');
          assert.match(err.message, /Failed to connect to Incus daemon/);
          assert.equal(err.operation, 'getInfo');
          assert.equal(err.backend, 'incus');
          return true;
        }
      );
    });
  });

  describe('_parseImageSource()', () => {
    test('parses images:alias format', () => {
      const backend = new IncusBackend();
      const source = backend._parseImageSource('images:ubuntu/24.04/cloud');

      assert.equal(source.type, 'image');
      assert.equal(source.alias, 'ubuntu/24.04/cloud');
      assert.equal(source.protocol, 'simplestreams');
      assert.equal(source.server, 'https://images.linuxcontainers.org');
    });

    test('parses local alias format', () => {
      const backend = new IncusBackend();
      const source = backend._parseImageSource('ubuntu/24.04');

      assert.equal(source.type, 'image');
      assert.equal(source.alias, 'ubuntu/24.04');
      assert.equal(source.protocol, undefined);
      assert.equal(source.server, undefined);
    });
  });

  describe('interface compliance', () => {
    test('implements all ContainerBackend abstract methods', () => {
      const backend = new IncusBackend();

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
      await backend.createContainer({ id: 'test' }, { root: '/data' });
      await backend.startContainer({ name: 'ai-army-test', id: 'ai-army-test' });
      await backend.stopContainer({ name: 'ai-army-test', id: 'ai-army-test' });
      await backend.exec({ name: 'ai-army-test', id: 'ai-army-test' }, 'echo hi');
      await backend.healthCheck({ name: 'ai-army-test', id: 'ai-army-test' });
      await backend.installPackages({ name: 'ai-army-test', id: 'ai-army-test' }, ['git']);
      await backend.removeContainerByName('test');
      await backend.listManagedContainers();
      await backend.getContainerByBotId('test');
      await backend.getInfo();
    });
  });
});
