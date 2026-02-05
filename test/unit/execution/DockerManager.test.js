/**
 * Unit tests for DockerManager
 *
 * Tests Docker container management, command execution,
 * memory parsing, mount configuration, and health checks.
 *
 * Note: These are unit tests with mocked Docker API.
 * Integration tests with real Docker are in test/integration/execution/
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'timers';
import { DockerManager, DockerError } from '../../../src/execution/docker-manager.js';

/**
 * Create a mock Docker client
 * @param {Object} [overrides={}] - Override default mock implementations
 * @returns {Object} Mock Docker client
 */
function createMockDocker(overrides = {}) {
  const mockImage = {
    inspect: mock.fn(async () => ({ RepoTags: ['node:22-slim'] })),
  };

  const mockExec = {
    start: mock.fn(async () => ({
      on: mock.fn((event, callback) => {
        if (event === 'end') {
          // Simulate async completion
          setImmediate(callback);
        }
      }),
      destroy: mock.fn(),
    })),
    inspect: mock.fn(async () => ({ ExitCode: 0 })),
  };

  const mockContainer = {
    id: 'container-123',
    start: mock.fn(async () => {}),
    stop: mock.fn(async () => {}),
    remove: mock.fn(async () => {}),
    inspect: mock.fn(async () => ({
      Id: 'container-123',
      State: { Running: true },
    })),
    exec: mock.fn(async () => mockExec),
    modem: {
      demuxStream: mock.fn((_stream, _stdout, _stderr) => {}),
    },
  };

  const mockDocker = {
    createContainer: mock.fn(async () => mockContainer),
    getImage: mock.fn(() => mockImage),
    getContainer: mock.fn(() => mockContainer),
    listContainers: mock.fn(async () => []),
    pull: mock.fn((imageName, callback) => {
      callback(null, { pipe: mock.fn() });
    }),
    info: mock.fn(async () => ({ ServerVersion: '24.0.0' })),
    modem: {
      followProgress: mock.fn((_stream, callback) => {
        callback(null, []);
      }),
    },
    ...overrides,
  };

  return { mockDocker, mockContainer, mockExec, mockImage };
}

/**
 * Create a DockerManager with a mock Docker client
 * @param {Object} [mockOverrides={}] - Override mock implementations
 * @returns {{manager: DockerManager, mocks: Object}}
 */
function createMockedManager(mockOverrides = {}) {
  const mocks = createMockDocker(mockOverrides);
  const manager = new DockerManager();
  manager.docker = mocks.mockDocker;
  return { manager, ...mocks };
}

describe('DockerManager', () => {
  describe('constructor', () => {
    test('creates instance with default socket path', () => {
      const manager = new DockerManager();
      assert.ok(manager.docker);
    });

    test('creates instance with custom socket path string', () => {
      const manager = new DockerManager('/custom/docker.sock');
      assert.ok(manager.docker);
    });

    test('creates instance with connection options object', () => {
      const manager = new DockerManager({ host: 'localhost', port: 2375 });
      assert.ok(manager.docker);
    });
  });

  describe('parseMemory()', () => {
    let manager;

    beforeEach(() => {
      manager = new DockerManager();
    });

    test('parses kilobytes (k)', () => {
      assert.equal(manager.parseMemory('512k'), 512 * 1024);
    });

    test('parses megabytes (m)', () => {
      assert.equal(manager.parseMemory('512m'), 512 * 1024 ** 2);
    });

    test('parses gigabytes (g)', () => {
      assert.equal(manager.parseMemory('2g'), 2 * 1024 ** 3);
    });

    test('parses uppercase units', () => {
      assert.equal(manager.parseMemory('1G'), 1024 ** 3);
      assert.equal(manager.parseMemory('512M'), 512 * 1024 ** 2);
    });

    test('returns number directly if already a number', () => {
      assert.equal(manager.parseMemory(1073741824), 1073741824);
    });

    test('throws DockerError for invalid format', () => {
      assert.throws(
        () => manager.parseMemory('invalid'),
        err => {
          assert.equal(err.name, 'DockerError');
          assert.match(err.message, /Invalid memory format/);
          assert.equal(err.operation, 'parseMemory');
          return true;
        }
      );
    });

    test('throws DockerError for missing unit', () => {
      assert.throws(
        () => manager.parseMemory('512'),
        err => {
          assert.equal(err.name, 'DockerError');
          assert.match(err.message, /Invalid memory format/);
          return true;
        }
      );
    });

    test('throws DockerError for invalid unit', () => {
      assert.throws(
        () => manager.parseMemory('512t'),
        err => {
          assert.equal(err.name, 'DockerError');
          assert.match(err.message, /Invalid memory format/);
          return true;
        }
      );
    });
  });

  describe('buildMounts()', () => {
    let manager;

    beforeEach(() => {
      manager = new DockerManager();
    });

    test('builds mount with relative workspace root', () => {
      const mounts = manager.buildMounts({ root: './data/test-bot' });

      assert.equal(mounts.length, 1);
      assert.match(mounts[0], /\/data\/test-bot:\/home\/agent:rw$/);
    });

    test('builds mount with absolute workspace root', () => {
      const mounts = manager.buildMounts({ root: '/absolute/path/data' });

      assert.equal(mounts.length, 1);
      assert.equal(mounts[0], '/absolute/path/data:/home/agent:rw');
    });

    test('uses default ./data when workspace is empty', () => {
      const mounts = manager.buildMounts({});

      assert.equal(mounts.length, 1);
      assert.match(mounts[0], /\/data:\/home\/agent:rw$/);
    });

    test('uses default ./data when workspace is null', () => {
      const mounts = manager.buildMounts(null);

      assert.equal(mounts.length, 1);
      assert.match(mounts[0], /\/data:\/home\/agent:rw$/);
    });
  });

  describe('createContainer()', () => {
    test('creates container with correct configuration', async () => {
      const { manager, mockDocker, mockImage } = createMockedManager();

      const botConfig = {
        id: 'test-bot',
        sandbox: {
          image: 'node:22-slim',
          memory: '1g',
          cpus: 2,
          network: 'bridge',
        },
      };
      const workspace = { root: './test-data' };

      const container = await manager.createContainer(botConfig, workspace);

      assert.ok(container);
      assert.equal(mockDocker.createContainer.mock.calls.length, 1);

      const createArgs = mockDocker.createContainer.mock.calls[0].arguments[0];
      assert.equal(createArgs.Image, 'node:22-slim');
      assert.equal(createArgs.name, 'ai-army-test-bot');
      assert.equal(createArgs.WorkingDir, '/home/agent');
      assert.deepEqual(createArgs.Cmd, ['tail', '-f', '/dev/null']);
      assert.equal(createArgs.Labels['ai-army.bot-id'], 'test-bot');
      assert.equal(createArgs.Labels['ai-army.managed'], 'true');

      // Verify image was checked
      assert.equal(mockDocker.getImage.mock.calls.length, 1);
      assert.equal(mockImage.inspect.mock.calls.length, 1);
    });

    test('creates container with default values when sandbox not specified', async () => {
      const { manager, mockDocker } = createMockedManager();

      const botConfig = { id: 'minimal-bot' };
      const workspace = { root: './data' };

      await manager.createContainer(botConfig, workspace);

      const createArgs = mockDocker.createContainer.mock.calls[0].arguments[0];
      assert.equal(createArgs.Image, 'node:22-slim');
      assert.equal(createArgs.HostConfig.Memory, 2 * 1024 ** 3); // 2g default
      assert.equal(createArgs.HostConfig.NanoCPUs, 2 * 1e9); // 2 cpus default
      assert.equal(createArgs.HostConfig.NetworkMode, 'bridge');
    });

    test('pulls image if not present locally', async () => {
      const { manager, mockDocker, mockImage } = createMockedManager();

      // Make inspect fail to simulate missing image
      mockImage.inspect = mock.fn(async () => {
        const err = new Error('No such image');
        err.statusCode = 404;
        throw err;
      });

      await manager.createContainer({ id: 'test-bot' }, { root: './data' });

      // Should have tried to pull
      assert.equal(mockDocker.pull.mock.calls.length, 1);
    });

    test('throws DockerError when botConfig is missing', async () => {
      const { manager } = createMockedManager();

      await assert.rejects(
        () => manager.createContainer(null, { root: './data' }),
        err => {
          assert.equal(err.name, 'DockerError');
          assert.match(err.message, /Bot configuration with id is required/);
          assert.equal(err.operation, 'createContainer');
          return true;
        }
      );
    });

    test('throws DockerError when botConfig.id is missing', async () => {
      const { manager } = createMockedManager();

      await assert.rejects(
        () => manager.createContainer({}, { root: './data' }),
        err => {
          assert.equal(err.name, 'DockerError');
          assert.match(err.message, /Bot configuration with id is required/);
          return true;
        }
      );
    });

    test('throws DockerError when Docker API fails', async () => {
      const { manager, mockDocker } = createMockedManager();

      mockDocker.createContainer = mock.fn(async () => {
        throw new Error('Docker API error');
      });

      await assert.rejects(
        () => manager.createContainer({ id: 'test-bot' }, { root: './data' }),
        err => {
          assert.equal(err.name, 'DockerError');
          assert.match(err.message, /Failed to create container/);
          assert.equal(err.operation, 'createContainer');
          assert.equal(err.botId, 'test-bot');
          assert.ok(err.cause);
          return true;
        }
      );
    });
  });

  describe('startContainer()', () => {
    test('starts container and waits for healthy', async () => {
      const { manager, mockContainer } = createMockedManager();

      await manager.startContainer(mockContainer);

      assert.equal(mockContainer.start.mock.calls.length, 1);
      assert.ok(mockContainer.inspect.mock.calls.length >= 1);
    });

    test('ignores already started error (304)', async () => {
      const { manager, mockContainer } = createMockedManager();

      mockContainer.start = mock.fn(async () => {
        const err = new Error('Container already started');
        err.statusCode = 304;
        throw err;
      });

      // Should not throw
      await manager.startContainer(mockContainer);
    });

    test('throws DockerError when container is null', async () => {
      const { manager } = createMockedManager();

      await assert.rejects(
        () => manager.startContainer(null),
        err => {
          assert.equal(err.name, 'DockerError');
          assert.match(err.message, /Container is required/);
          assert.equal(err.operation, 'startContainer');
          return true;
        }
      );
    });

    test('throws DockerError when start fails', async () => {
      const { manager, mockContainer } = createMockedManager();

      mockContainer.start = mock.fn(async () => {
        throw new Error('Failed to start');
      });

      await assert.rejects(
        () => manager.startContainer(mockContainer),
        err => {
          assert.equal(err.name, 'DockerError');
          assert.match(err.message, /Failed to start container/);
          assert.ok(err.cause);
          return true;
        }
      );
    });
  });

  describe('stopContainer()', () => {
    test('stops and removes container', async () => {
      const { manager, mockContainer } = createMockedManager();

      await manager.stopContainer(mockContainer);

      assert.equal(mockContainer.stop.mock.calls.length, 1);
      assert.equal(mockContainer.remove.mock.calls.length, 1);

      // Verify stop was called with timeout
      const stopArgs = mockContainer.stop.mock.calls[0].arguments[0];
      assert.equal(stopArgs.t, 10);
    });

    test('accepts custom timeout', async () => {
      const { manager, mockContainer } = createMockedManager();

      await manager.stopContainer(mockContainer, 30);

      const stopArgs = mockContainer.stop.mock.calls[0].arguments[0];
      assert.equal(stopArgs.t, 30);
    });

    test('ignores already stopped error (304)', async () => {
      const { manager, mockContainer } = createMockedManager();

      mockContainer.stop = mock.fn(async () => {
        const err = new Error('Container not running');
        err.statusCode = 304;
        throw err;
      });

      // Should not throw
      await manager.stopContainer(mockContainer);
      assert.equal(mockContainer.remove.mock.calls.length, 1);
    });

    test('ignores not found error (404)', async () => {
      const { manager, mockContainer } = createMockedManager();

      mockContainer.stop = mock.fn(async () => {
        const err = new Error('No such container');
        err.statusCode = 404;
        throw err;
      });

      // Should not throw
      await manager.stopContainer(mockContainer);
    });

    test('throws DockerError when container is null', async () => {
      const { manager } = createMockedManager();

      await assert.rejects(
        () => manager.stopContainer(null),
        err => {
          assert.equal(err.name, 'DockerError');
          assert.match(err.message, /Container is required/);
          assert.equal(err.operation, 'stopContainer');
          return true;
        }
      );
    });
  });

  describe('exec()', () => {
    test('executes command and returns output', async () => {
      const { manager, mockContainer, mockExec } = createMockedManager();

      // Set up exec result
      mockExec.inspect = mock.fn(async () => ({ ExitCode: 0 }));

      const result = await manager.exec(mockContainer, 'echo hello');

      assert.equal(typeof result.stdout, 'string');
      assert.equal(typeof result.stderr, 'string');
      assert.equal(result.exitCode, 0);

      // Verify exec was created with correct config
      assert.equal(mockContainer.exec.mock.calls.length, 1);
      const execConfig = mockContainer.exec.mock.calls[0].arguments[0];
      assert.deepEqual(execConfig.Cmd, ['sh', '-c', 'echo hello']);
      assert.equal(execConfig.AttachStdout, true);
      assert.equal(execConfig.AttachStderr, true);
    });

    test('includes user option when specified', async () => {
      const { manager, mockContainer } = createMockedManager();

      await manager.exec(mockContainer, 'ls', { user: 'root' });

      const execConfig = mockContainer.exec.mock.calls[0].arguments[0];
      assert.equal(execConfig.User, 'root');
    });

    test('includes workingDir option when specified', async () => {
      const { manager, mockContainer } = createMockedManager();

      await manager.exec(mockContainer, 'pwd', { workingDir: '/tmp' });

      const execConfig = mockContainer.exec.mock.calls[0].arguments[0];
      assert.equal(execConfig.WorkingDir, '/tmp');
    });

    test('throws DockerError when container is null', async () => {
      const { manager } = createMockedManager();

      await assert.rejects(
        () => manager.exec(null, 'echo hello'),
        err => {
          assert.equal(err.name, 'DockerError');
          assert.match(err.message, /Container is required/);
          assert.equal(err.operation, 'exec');
          return true;
        }
      );
    });

    test('throws DockerError when command is empty', async () => {
      const { manager, mockContainer } = createMockedManager();

      await assert.rejects(
        () => manager.exec(mockContainer, ''),
        err => {
          assert.equal(err.name, 'DockerError');
          assert.match(err.message, /Command must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws DockerError when command is not a string', async () => {
      const { manager, mockContainer } = createMockedManager();

      await assert.rejects(
        () => manager.exec(mockContainer, 123),
        err => {
          assert.equal(err.name, 'DockerError');
          assert.match(err.message, /Command must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws DockerError when command is whitespace only', async () => {
      const { manager, mockContainer } = createMockedManager();

      await assert.rejects(
        () => manager.exec(mockContainer, '   '),
        err => {
          assert.equal(err.name, 'DockerError');
          assert.match(err.message, /Command must be a non-empty string/);
          return true;
        }
      );
    });
  });

  describe('healthCheck()', () => {
    test('returns true when container is running', async () => {
      const { manager, mockContainer } = createMockedManager();

      mockContainer.inspect = mock.fn(async () => ({
        State: { Running: true },
      }));

      const result = await manager.healthCheck(mockContainer);

      assert.equal(result, true);
    });

    test('returns false when container is stopped', async () => {
      const { manager, mockContainer } = createMockedManager();

      mockContainer.inspect = mock.fn(async () => ({
        State: { Running: false },
      }));

      const result = await manager.healthCheck(mockContainer);

      assert.equal(result, false);
    });

    test('returns false when container is null', async () => {
      const { manager } = createMockedManager();

      const result = await manager.healthCheck(null);

      assert.equal(result, false);
    });

    test('returns false when inspect fails', async () => {
      const { manager, mockContainer } = createMockedManager();

      mockContainer.inspect = mock.fn(async () => {
        throw new Error('Container not found');
      });

      const result = await manager.healthCheck(mockContainer);

      assert.equal(result, false);
    });
  });

  describe('installPackages()', () => {
    test('updates apt and installs packages', async () => {
      const { manager, mockContainer, mockExec } = createMockedManager();

      // Track exec calls
      const execCalls = [];
      mockContainer.exec = mock.fn(async config => {
        execCalls.push(config.Cmd);
        return mockExec;
      });

      await manager.installPackages(mockContainer, ['git', 'curl']);

      // Should have called exec twice (update + install)
      assert.equal(mockContainer.exec.mock.calls.length, 2);

      // Verify update command
      assert.deepEqual(execCalls[0], ['sh', '-c', 'apt-get update -qq']);

      // Verify install command
      assert.ok(execCalls[1][2].includes('apt-get install'));
      assert.ok(execCalls[1][2].includes('git'));
      assert.ok(execCalls[1][2].includes('curl'));
    });

    test('runs as root user', async () => {
      const { manager, mockContainer } = createMockedManager();

      await manager.installPackages(mockContainer, ['git']);

      const execConfig = mockContainer.exec.mock.calls[0].arguments[0];
      assert.equal(execConfig.User, 'root');
    });

    test('does nothing when packages is empty', async () => {
      const { manager, mockContainer } = createMockedManager();

      await manager.installPackages(mockContainer, []);

      assert.equal(mockContainer.exec.mock.calls.length, 0);
    });

    test('does nothing when packages is null', async () => {
      const { manager, mockContainer } = createMockedManager();

      await manager.installPackages(mockContainer, null);

      assert.equal(mockContainer.exec.mock.calls.length, 0);
    });

    test('throws DockerError when container is null', async () => {
      const { manager } = createMockedManager();

      await assert.rejects(
        () => manager.installPackages(null, ['git']),
        err => {
          assert.equal(err.name, 'DockerError');
          assert.match(err.message, /Container is required/);
          assert.equal(err.operation, 'installPackages');
          return true;
        }
      );
    });

    test('throws DockerError when apt-get update fails', async () => {
      const { manager, mockContainer, mockExec } = createMockedManager();

      // Make update fail
      mockExec.inspect = mock.fn(async () => ({ ExitCode: 1 }));

      await assert.rejects(
        () => manager.installPackages(mockContainer, ['git']),
        err => {
          assert.equal(err.name, 'DockerError');
          assert.match(err.message, /apt-get update failed/);
          return true;
        }
      );
    });
  });

  describe('getInfo()', () => {
    test('returns Docker daemon info', async () => {
      const { manager, mockDocker } = createMockedManager();

      const info = await manager.getInfo();

      assert.ok(info.ServerVersion);
      assert.equal(mockDocker.info.mock.calls.length, 1);
    });

    test('throws DockerError when connection fails', async () => {
      const { manager, mockDocker } = createMockedManager();

      mockDocker.info = mock.fn(async () => {
        throw new Error('Connection refused');
      });

      await assert.rejects(
        () => manager.getInfo(),
        err => {
          assert.equal(err.name, 'DockerError');
          assert.match(err.message, /Failed to connect to Docker daemon/);
          assert.equal(err.operation, 'getInfo');
          assert.ok(err.cause);
          return true;
        }
      );
    });
  });

  describe('listManagedContainers()', () => {
    test('lists containers with ai-army label', async () => {
      const { manager, mockDocker } = createMockedManager();

      mockDocker.listContainers = mock.fn(async () => [
        { Id: 'container-1', Names: ['/ai-army-bot1'] },
        { Id: 'container-2', Names: ['/ai-army-bot2'] },
      ]);

      const containers = await manager.listManagedContainers();

      assert.equal(containers.length, 2);
      assert.equal(mockDocker.listContainers.mock.calls.length, 1);

      // Verify filter was applied
      const listArgs = mockDocker.listContainers.mock.calls[0].arguments[0];
      assert.deepEqual(listArgs.filters.label, ['ai-army.managed=true']);
      assert.equal(listArgs.all, true);
    });

    test('respects all option', async () => {
      const { manager, mockDocker } = createMockedManager();

      await manager.listManagedContainers({ all: false });

      const listArgs = mockDocker.listContainers.mock.calls[0].arguments[0];
      assert.equal(listArgs.all, false);
    });
  });

  describe('getContainerByBotId()', () => {
    test('returns container for existing bot', async () => {
      const { manager, mockDocker } = createMockedManager();

      mockDocker.listContainers = mock.fn(async () => [
        { Id: 'container-123', Labels: { 'ai-army.bot-id': 'test-bot' } },
      ]);

      const container = await manager.getContainerByBotId('test-bot');

      assert.ok(container);
      assert.equal(mockDocker.getContainer.mock.calls.length, 1);
    });

    test('returns null when bot container not found', async () => {
      const { manager, mockDocker } = createMockedManager();

      mockDocker.listContainers = mock.fn(async () => []);

      const container = await manager.getContainerByBotId('nonexistent-bot');

      assert.equal(container, null);
    });

    test('returns null when Docker API fails', async () => {
      const { manager, mockDocker } = createMockedManager();

      mockDocker.listContainers = mock.fn(async () => {
        throw new Error('Docker API error');
      });

      const container = await manager.getContainerByBotId('test-bot');

      assert.equal(container, null);
    });
  });

  describe('removeContainerByName()', () => {
    test('removes container and returns true', async () => {
      const { manager, mockContainer } = createMockedManager();

      const result = await manager.removeContainerByName('ai-army-test-bot');

      assert.equal(result, true);
      assert.equal(mockContainer.remove.mock.calls.length, 1);

      // Verify force removal
      const removeArgs = mockContainer.remove.mock.calls[0].arguments[0];
      assert.equal(removeArgs.force, true);
    });

    test('returns false when container not found', async () => {
      const { manager, mockDocker } = createMockedManager();

      mockDocker.getContainer = mock.fn(() => ({
        remove: mock.fn(async () => {
          const err = new Error('No such container');
          err.statusCode = 404;
          throw err;
        }),
      }));

      const result = await manager.removeContainerByName('nonexistent');

      assert.equal(result, false);
    });

    test('throws DockerError on other errors', async () => {
      const { manager, mockDocker } = createMockedManager();

      mockDocker.getContainer = mock.fn(() => ({
        remove: mock.fn(async () => {
          throw new Error('Permission denied');
        }),
      }));

      await assert.rejects(
        () => manager.removeContainerByName('ai-army-bot'),
        err => {
          assert.equal(err.name, 'DockerError');
          assert.match(err.message, /Failed to remove container/);
          assert.equal(err.operation, 'removeContainerByName');
          return true;
        }
      );
    });
  });
});

describe('DockerError', () => {
  test('is an instance of Error', () => {
    const error = new DockerError('Test error');
    assert.ok(error instanceof Error);
  });

  test('has correct name', () => {
    const error = new DockerError('Test error');
    assert.equal(error.name, 'DockerError');
  });

  test('stores operation', () => {
    const error = new DockerError('Test error', { operation: 'createContainer' });
    assert.equal(error.operation, 'createContainer');
  });

  test('stores containerId', () => {
    const error = new DockerError('Test error', { containerId: 'container-123' });
    assert.equal(error.containerId, 'container-123');
  });

  test('stores botId', () => {
    const error = new DockerError('Test error', { botId: 'test-bot' });
    assert.equal(error.botId, 'test-bot');
  });

  test('stores cause', () => {
    const cause = new Error('Original error');
    const error = new DockerError('Test error', { cause });
    assert.equal(error.cause, cause);
  });

  test('stores all options together', () => {
    const cause = new Error('Original');
    const error = new DockerError('Multi-option error', {
      cause,
      operation: 'exec',
      containerId: 'container-123',
      botId: 'test-bot',
    });

    assert.equal(error.cause, cause);
    assert.equal(error.operation, 'exec');
    assert.equal(error.containerId, 'container-123');
    assert.equal(error.botId, 'test-bot');
  });
});
