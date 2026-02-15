/**
 * Unit tests for ToolExecutor
 *
 * Tests tool routing, bash execution, file operations,
 * dangerous command detection, output truncation, and error handling.
 *
 * Note: These are unit tests with mocked ContainerPool.
 * Integration tests with real Docker are in test/integration/execution/
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  ToolExecutor,
  ToolExecutionError,
  DangerousCommandError,
} from '../../../src/execution/tool-executor.js';

/**
 * Create a mock ContainerPool with exec() abstraction
 * @param {Object} [overrides={}] - Override default mock implementations
 * @returns {Object} Mock ContainerPool and related mocks
 */
function createMockContainerPool(overrides = {}) {
  const mockContainer = {
    id: 'container-123',
    inspect: mock.fn(async () => ({
      Id: 'container-123',
      State: { Running: true },
    })),
  };

  const mockDockerManager = {
    exec: mock.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })),
    healthCheck: mock.fn(async () => true),
    ...overrides.dockerManager,
  };

  const mockContainerPool = {
    exec: mock.fn(async (_botId, command, options) => {
      return mockDockerManager.exec(mockContainer, command, options);
    }),
    getContainer: mock.fn(async () => mockContainer),
    dockerManager: mockDockerManager,
    ...overrides.pool,
  };

  return { mockContainerPool, mockContainer, mockDockerManager };
}

describe('ToolExecutor', () => {
  describe('constructor', () => {
    test('creates instance with ContainerPool', () => {
      const { mockContainerPool } = createMockContainerPool();
      const executor = new ToolExecutor(mockContainerPool);

      assert.ok(executor);
      assert.equal(executor.containerPool, mockContainerPool);
      assert.equal(executor.timeout, 30000);
    });

    test('accepts custom options', () => {
      const { mockContainerPool } = createMockContainerPool();
      const executor = new ToolExecutor(mockContainerPool, {
        timeout: 60000,
        maxStdoutLength: 100000,
        maxStderrLength: 20000,
        maxFileContentLength: 200000,
      });

      assert.equal(executor.timeout, 60000);
      assert.equal(executor.maxStdoutLength, 100000);
      assert.equal(executor.maxStderrLength, 20000);
      assert.equal(executor.maxFileContentLength, 200000);
    });

    test('throws ToolExecutionError when ContainerPool is null', () => {
      assert.throws(
        () => new ToolExecutor(null),
        err => {
          assert.equal(err.name, 'ToolExecutionError');
          assert.match(err.message, /ContainerPool is required/);
          assert.equal(err.operation, 'constructor');
          return true;
        }
      );
    });

    test('throws ToolExecutionError when ContainerPool is undefined', () => {
      assert.throws(
        () => new ToolExecutor(undefined),
        err => {
          assert.equal(err.name, 'ToolExecutionError');
          assert.match(err.message, /ContainerPool is required/);
          return true;
        }
      );
    });
  });

  describe('executeTool()', () => {
    let executor;
    let mocks;

    beforeEach(() => {
      mocks = createMockContainerPool();
      executor = new ToolExecutor(mocks.mockContainerPool);
    });

    test('routes bash tool correctly', async () => {
      mocks.mockDockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: 'hello',
        stderr: '',
      }));

      const result = await executor.executeTool('bash', { command: 'echo hello' }, 'test-bot');

      assert.equal(result.success, true);
      assert.equal(result.stdout, 'hello');
      assert.equal(result.exitCode, 0);
    });

    test('routes readFile tool correctly', async () => {
      mocks.mockDockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: 'file content',
        stderr: '',
      }));

      const result = await executor.executeTool(
        'readFile',
        { path: '/home/agent/test.txt' },
        'test-bot'
      );

      assert.equal(result.success, true);
      assert.equal(result.content, 'file content');
    });

    test('routes writeFile tool correctly', async () => {
      mocks.mockDockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
      }));

      const result = await executor.executeTool(
        'writeFile',
        { path: '/home/agent/out.txt', content: 'new content' },
        'test-bot'
      );

      assert.equal(result.success, true);
    });

    test('throws ToolExecutionError for unsupported tool', async () => {
      await assert.rejects(
        () => executor.executeTool('unknown', { foo: 'bar' }, 'test-bot'),
        err => {
          assert.equal(err.name, 'ToolExecutionError');
          assert.match(err.message, /Unsupported tool: unknown/);
          assert.match(err.message, /bash, readFile, writeFile/);
          assert.equal(err.toolName, 'unknown');
          assert.equal(err.botId, 'test-bot');
          return true;
        }
      );
    });

    test('throws ToolExecutionError for empty tool name', async () => {
      await assert.rejects(
        () => executor.executeTool('', {}, 'test-bot'),
        err => {
          assert.equal(err.name, 'ToolExecutionError');
          assert.match(err.message, /Tool name must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws ToolExecutionError for null tool name', async () => {
      await assert.rejects(
        () => executor.executeTool(null, {}, 'test-bot'),
        err => {
          assert.equal(err.name, 'ToolExecutionError');
          assert.match(err.message, /Tool name must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws ToolExecutionError for null params', async () => {
      await assert.rejects(
        () => executor.executeTool('bash', null, 'test-bot'),
        err => {
          assert.equal(err.name, 'ToolExecutionError');
          assert.match(err.message, /Tool parameters must be an object/);
          return true;
        }
      );
    });

    test('throws ToolExecutionError for empty botId', async () => {
      await assert.rejects(
        () => executor.executeTool('bash', { command: 'ls' }, ''),
        err => {
          assert.equal(err.name, 'ToolExecutionError');
          assert.match(err.message, /Bot ID must be a non-empty string/);
          return true;
        }
      );
    });

    test('passes through DangerousCommandError from bash', async () => {
      await assert.rejects(
        () => executor.executeTool('bash', { command: 'rm -rf /' }, 'test-bot'),
        err => {
          assert.equal(err.name, 'DangerousCommandError');
          return true;
        }
      );
    });

    test('passes bash options (timeout, workingDir) through', async () => {
      mocks.mockDockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
      }));

      await executor.executeTool(
        'bash',
        { command: 'pwd', timeout: 60000, workingDir: '/tmp' },
        'test-bot'
      );

      const execCall = mocks.mockDockerManager.exec.mock.calls[0];
      assert.equal(execCall.arguments[2].timeout, 60000);
      assert.equal(execCall.arguments[2].workingDir, '/tmp');
    });

    test('passes readFile encoding option through', async () => {
      mocks.mockDockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: 'aGVsbG8=',
        stderr: '',
      }));

      await executor.executeTool(
        'readFile',
        { path: '/home/agent/img.png', encoding: 'base64' },
        'test-bot'
      );

      const execCall = mocks.mockDockerManager.exec.mock.calls[0];
      const command = execCall.arguments[1];
      assert.match(command, /base64/);
    });

    test('passes writeFile append option through', async () => {
      mocks.mockDockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
      }));

      await executor.executeTool(
        'writeFile',
        { path: '/home/agent/log.txt', content: 'line', append: true },
        'test-bot'
      );

      const execCall = mocks.mockDockerManager.exec.mock.calls[0];
      const command = execCall.arguments[1];
      assert.match(command, />>/);
    });
  });

  describe('bash()', () => {
    let executor;
    let mocks;

    beforeEach(() => {
      mocks = createMockContainerPool();
      executor = new ToolExecutor(mocks.mockContainerPool);
    });

    test('executes command and returns result', async () => {
      mocks.mockDockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: 'hello world',
        stderr: '',
      }));

      const result = await executor.bash('echo "hello world"', 'test-bot');

      assert.equal(result.success, true);
      assert.equal(result.stdout, 'hello world');
      assert.equal(result.stderr, '');
      assert.equal(result.exitCode, 0);
    });

    test('returns success: false for non-zero exit code', async () => {
      mocks.mockDockerManager.exec = mock.fn(async () => ({
        exitCode: 1,
        stdout: '',
        stderr: 'command not found',
      }));

      const result = await executor.bash('nonexistent-cmd', 'test-bot');

      assert.equal(result.success, false);
      assert.equal(result.exitCode, 1);
      assert.equal(result.stderr, 'command not found');
    });

    test('uses default timeout', async () => {
      mocks.mockDockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
      }));

      await executor.bash('ls', 'test-bot');

      const execCall = mocks.mockDockerManager.exec.mock.calls[0];
      assert.equal(execCall.arguments[2].timeout, 30000);
    });

    test('uses custom timeout from options', async () => {
      mocks.mockDockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
      }));

      await executor.bash('ls', 'test-bot', { timeout: 60000 });

      const execCall = mocks.mockDockerManager.exec.mock.calls[0];
      assert.equal(execCall.arguments[2].timeout, 60000);
    });

    test('passes workingDir option', async () => {
      mocks.mockDockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: '/tmp',
        stderr: '',
      }));

      await executor.bash('pwd', 'test-bot', { workingDir: '/tmp' });

      const execCall = mocks.mockDockerManager.exec.mock.calls[0];
      assert.equal(execCall.arguments[2].workingDir, '/tmp');
    });

    test('truncates long stdout', async () => {
      const longOutput = 'x'.repeat(60000);
      mocks.mockDockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: longOutput,
        stderr: '',
      }));

      const result = await executor.bash('cat large-file', 'test-bot');

      assert.ok(result.stdout.length < longOutput.length);
      assert.match(result.stdout, /\[truncated \d+ characters\]/);
    });

    test('truncates long stderr', async () => {
      const longError = 'e'.repeat(15000);
      mocks.mockDockerManager.exec = mock.fn(async () => ({
        exitCode: 1,
        stdout: '',
        stderr: longError,
      }));

      const result = await executor.bash('bad-cmd', 'test-bot');

      assert.ok(result.stderr.length < longError.length);
      assert.match(result.stderr, /\[truncated \d+ characters\]/);
    });

    test('throws DangerousCommandError for rm -rf /', async () => {
      await assert.rejects(
        () => executor.bash('rm -rf /', 'test-bot'),
        err => {
          assert.equal(err.name, 'DangerousCommandError');
          assert.match(err.message, /blocked by security policy/);
          assert.equal(err.command, 'rm -rf /');
          return true;
        }
      );
    });

    test('throws DangerousCommandError for fork bomb', async () => {
      await assert.rejects(
        () => executor.bash(':() { :|:& };:', 'test-bot'),
        err => {
          assert.equal(err.name, 'DangerousCommandError');
          return true;
        }
      );
    });

    test('throws ToolExecutionError for empty command', async () => {
      await assert.rejects(
        () => executor.bash('', 'test-bot'),
        err => {
          assert.equal(err.name, 'ToolExecutionError');
          assert.match(err.message, /Command must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws ToolExecutionError for null command', async () => {
      await assert.rejects(
        () => executor.bash(null, 'test-bot'),
        err => {
          assert.equal(err.name, 'ToolExecutionError');
          assert.match(err.message, /Command must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws ToolExecutionError for empty botId', async () => {
      await assert.rejects(
        () => executor.bash('ls', ''),
        err => {
          assert.equal(err.name, 'ToolExecutionError');
          assert.match(err.message, /Bot ID must be a non-empty string/);
          return true;
        }
      );
    });

    test('wraps container pool errors', async () => {
      mocks.mockContainerPool.exec = mock.fn(async () => {
        throw new Error('Container not found');
      });

      await assert.rejects(
        () => executor.bash('ls', 'missing-bot'),
        err => {
          assert.equal(err.name, 'ToolExecutionError');
          assert.match(err.message, /Failed to execute bash/);
          assert.match(err.message, /missing-bot/);
          assert.ok(err.cause);
          return true;
        }
      );
    });

    test('passes botId to containerPool.exec', async () => {
      mocks.mockDockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
      }));

      await executor.bash('ls', 'my-bot');

      assert.equal(mocks.mockContainerPool.exec.mock.calls.length, 1);
      assert.equal(mocks.mockContainerPool.exec.mock.calls[0].arguments[0], 'my-bot');
    });
  });

  describe('readFile()', () => {
    let executor;
    let mocks;

    beforeEach(() => {
      mocks = createMockContainerPool();
      executor = new ToolExecutor(mocks.mockContainerPool);
    });

    test('reads file content successfully', async () => {
      mocks.mockDockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: 'file content here',
        stderr: '',
      }));

      const result = await executor.readFile('/home/agent/test.txt', 'test-bot');

      assert.equal(result.success, true);
      assert.equal(result.content, 'file content here');
    });

    test('uses cat command for utf8 encoding', async () => {
      mocks.mockDockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: 'content',
        stderr: '',
      }));

      await executor.readFile('/home/agent/test.txt', 'test-bot');

      const execCall = mocks.mockDockerManager.exec.mock.calls[0];
      const command = execCall.arguments[1];
      assert.match(command, /^cat /);
    });

    test('uses base64 command for base64 encoding', async () => {
      mocks.mockDockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: 'aGVsbG8=',
        stderr: '',
      }));

      await executor.readFile('/home/agent/img.png', 'test-bot', {
        encoding: 'base64',
      });

      const execCall = mocks.mockDockerManager.exec.mock.calls[0];
      const command = execCall.arguments[1];
      assert.match(command, /^base64 /);
    });

    test('returns error for non-existent file', async () => {
      mocks.mockDockerManager.exec = mock.fn(async () => ({
        exitCode: 1,
        stdout: '',
        stderr: 'cat: /home/agent/missing.txt: No such file or directory',
      }));

      const result = await executor.readFile('/home/agent/missing.txt', 'test-bot');

      assert.equal(result.success, false);
      assert.equal(result.content, '');
      assert.match(result.error, /No such file/);
    });

    test('truncates large file content', async () => {
      const longContent = 'y'.repeat(150000);
      mocks.mockDockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: longContent,
        stderr: '',
      }));

      const result = await executor.readFile('/home/agent/large.txt', 'test-bot');

      assert.ok(result.content.length < longContent.length);
      assert.match(result.content, /\[truncated \d+ characters\]/);
    });

    test('escapes file path with special characters', async () => {
      mocks.mockDockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: 'content',
        stderr: '',
      }));

      await executor.readFile('/home/agent/file with spaces.txt', 'test-bot');

      const execCall = mocks.mockDockerManager.exec.mock.calls[0];
      const command = execCall.arguments[1];
      // Should be properly quoted
      assert.match(command, /'/);
    });

    test('throws ToolExecutionError for empty path', async () => {
      await assert.rejects(
        () => executor.readFile('', 'test-bot'),
        err => {
          assert.equal(err.name, 'ToolExecutionError');
          assert.match(err.message, /File path must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws ToolExecutionError for null path', async () => {
      await assert.rejects(
        () => executor.readFile(null, 'test-bot'),
        err => {
          assert.equal(err.name, 'ToolExecutionError');
          assert.match(err.message, /File path must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws ToolExecutionError for empty botId', async () => {
      await assert.rejects(
        () => executor.readFile('/home/agent/test.txt', ''),
        err => {
          assert.equal(err.name, 'ToolExecutionError');
          assert.match(err.message, /Bot ID must be a non-empty string/);
          return true;
        }
      );
    });

    test('wraps container pool errors', async () => {
      mocks.mockContainerPool.exec = mock.fn(async () => {
        throw new Error('Pool failure');
      });

      await assert.rejects(
        () => executor.readFile('/home/agent/test.txt', 'missing-bot'),
        err => {
          assert.equal(err.name, 'ToolExecutionError');
          assert.match(err.message, /Failed to read file/);
          assert.ok(err.cause);
          return true;
        }
      );
    });
  });

  describe('writeFile()', () => {
    let executor;
    let mocks;

    beforeEach(() => {
      mocks = createMockContainerPool();
      executor = new ToolExecutor(mocks.mockContainerPool);
    });

    test('writes file content successfully', async () => {
      mocks.mockDockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
      }));

      const result = await executor.writeFile('/home/agent/out.txt', 'hello world', 'test-bot');

      assert.equal(result.success, true);
      assert.equal(result.error, undefined);
    });

    test('uses overwrite operator by default', async () => {
      mocks.mockDockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
      }));

      await executor.writeFile('/home/agent/out.txt', 'content', 'test-bot');

      const execCall = mocks.mockDockerManager.exec.mock.calls[0];
      const command = execCall.arguments[1];
      // Should contain > but not >>
      assert.match(command, /[^>]>[^>]/);
    });

    test('uses append operator when option is set', async () => {
      mocks.mockDockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
      }));

      await executor.writeFile('/home/agent/log.txt', 'line\n', 'test-bot', {
        append: true,
      });

      const execCall = mocks.mockDockerManager.exec.mock.calls[0];
      const command = execCall.arguments[1];
      assert.match(command, />>/);
    });

    test('encodes content as base64 for safe transfer', async () => {
      mocks.mockDockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
      }));

      await executor.writeFile('/home/agent/out.txt', 'hello', 'test-bot');

      const execCall = mocks.mockDockerManager.exec.mock.calls[0];
      const command = execCall.arguments[1];
      assert.match(command, /base64/);
    });

    test('handles content with special characters', async () => {
      mocks.mockDockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
      }));

      const content = 'line1\nline2\n$VAR\n\'quotes\'\n"doubles"';
      const result = await executor.writeFile('/home/agent/special.txt', content, 'test-bot');

      assert.equal(result.success, true);
    });

    test('handles empty content', async () => {
      mocks.mockDockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
      }));

      const result = await executor.writeFile('/home/agent/empty.txt', '', 'test-bot');

      assert.equal(result.success, true);
    });

    test('returns error on write failure', async () => {
      mocks.mockDockerManager.exec = mock.fn(async () => ({
        exitCode: 1,
        stdout: '',
        stderr: 'Permission denied',
      }));

      const result = await executor.writeFile('/root/protected.txt', 'content', 'test-bot');

      assert.equal(result.success, false);
      assert.match(result.error, /Permission denied/);
    });

    test('throws ToolExecutionError for empty path', async () => {
      await assert.rejects(
        () => executor.writeFile('', 'content', 'test-bot'),
        err => {
          assert.equal(err.name, 'ToolExecutionError');
          assert.match(err.message, /File path must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws ToolExecutionError for non-string content', async () => {
      await assert.rejects(
        () => executor.writeFile('/home/agent/out.txt', 123, 'test-bot'),
        err => {
          assert.equal(err.name, 'ToolExecutionError');
          assert.match(err.message, /Content must be a string/);
          return true;
        }
      );
    });

    test('throws ToolExecutionError for null content', async () => {
      await assert.rejects(
        () => executor.writeFile('/home/agent/out.txt', null, 'test-bot'),
        err => {
          assert.equal(err.name, 'ToolExecutionError');
          assert.match(err.message, /Content must be a string/);
          return true;
        }
      );
    });

    test('throws ToolExecutionError for empty botId', async () => {
      await assert.rejects(
        () => executor.writeFile('/home/agent/out.txt', 'content', ''),
        err => {
          assert.equal(err.name, 'ToolExecutionError');
          assert.match(err.message, /Bot ID must be a non-empty string/);
          return true;
        }
      );
    });

    test('wraps container pool errors', async () => {
      mocks.mockContainerPool.exec = mock.fn(async () => {
        throw new Error('Pool failure');
      });

      await assert.rejects(
        () => executor.writeFile('/home/agent/out.txt', 'content', 'missing-bot'),
        err => {
          assert.equal(err.name, 'ToolExecutionError');
          assert.match(err.message, /Failed to write file/);
          assert.ok(err.cause);
          return true;
        }
      );
    });
  });

  describe('isDangerousCommand()', () => {
    let executor;

    beforeEach(() => {
      const { mockContainerPool } = createMockContainerPool();
      executor = new ToolExecutor(mockContainerPool);
    });

    test('detects rm -rf /', () => {
      assert.equal(executor.isDangerousCommand('rm -rf /'), true);
    });

    test('detects rm -rf / with trailing space', () => {
      assert.equal(executor.isDangerousCommand('rm -rf / '), true);
    });

    test('detects rm --no-preserve-root', () => {
      assert.equal(executor.isDangerousCommand('rm -rf --no-preserve-root /'), true);
    });

    test('detects writing to /dev/sda', () => {
      assert.equal(executor.isDangerousCommand('echo data > /dev/sda'), true);
    });

    test('detects writing to /dev/nvme device', () => {
      assert.equal(executor.isDangerousCommand('echo data > /dev/nvme0n1'), true);
    });

    test('detects mkfs commands', () => {
      assert.equal(executor.isDangerousCommand('mkfs.ext4 /dev/sda1'), true);
    });

    test('detects dd to device', () => {
      assert.equal(executor.isDangerousCommand('dd if=/dev/zero of=/dev/sda'), true);
    });

    test('detects fork bomb', () => {
      assert.equal(executor.isDangerousCommand(':() { :|:& };:'), true);
    });

    test('detects chmod 777 /', () => {
      assert.equal(executor.isDangerousCommand('chmod -R 777 /'), true);
    });

    test('allows rm -rf on subdirectory', () => {
      assert.equal(executor.isDangerousCommand('rm -rf /home/agent/temp'), false);
    });

    test('allows rm without -rf', () => {
      assert.equal(executor.isDangerousCommand('rm file.txt'), false);
    });

    test('allows normal bash commands', () => {
      assert.equal(executor.isDangerousCommand('ls -la'), false);
      assert.equal(executor.isDangerousCommand('echo hello'), false);
      assert.equal(executor.isDangerousCommand('cat /etc/hostname'), false);
      assert.equal(executor.isDangerousCommand('git status'), false);
      assert.equal(executor.isDangerousCommand('npm install'), false);
    });

    test('allows chmod on specific directories', () => {
      assert.equal(executor.isDangerousCommand('chmod -R 755 /home/agent/app'), false);
    });

    test('allows dd to file (not device)', () => {
      assert.equal(
        executor.isDangerousCommand('dd if=/dev/zero of=/home/agent/disk.img bs=1M count=100'),
        false
      );
    });

    test('returns false for null input', () => {
      assert.equal(executor.isDangerousCommand(null), false);
    });

    test('returns false for undefined input', () => {
      assert.equal(executor.isDangerousCommand(undefined), false);
    });

    test('returns false for empty string', () => {
      assert.equal(executor.isDangerousCommand(''), false);
    });

    test('returns false for non-string input', () => {
      assert.equal(executor.isDangerousCommand(123), false);
    });
  });

  describe('ToolExecutionError', () => {
    test('has correct name', () => {
      const err = new ToolExecutionError('test error');
      assert.equal(err.name, 'ToolExecutionError');
    });

    test('has correct message', () => {
      const err = new ToolExecutionError('test error');
      assert.equal(err.message, 'test error');
    });

    test('stores operation', () => {
      const err = new ToolExecutionError('test', { operation: 'bash' });
      assert.equal(err.operation, 'bash');
    });

    test('stores toolName', () => {
      const err = new ToolExecutionError('test', { toolName: 'bash' });
      assert.equal(err.toolName, 'bash');
    });

    test('stores botId', () => {
      const err = new ToolExecutionError('test', { botId: 'my-bot' });
      assert.equal(err.botId, 'my-bot');
    });

    test('stores cause via standard Error options', () => {
      const cause = new Error('original');
      const err = new ToolExecutionError('test', { cause });
      assert.equal(err.cause, cause);
      assert.ok(err.cause instanceof Error);
    });

    test('is instanceof Error', () => {
      const err = new ToolExecutionError('test');
      assert.ok(err instanceof Error);
    });

    test('stores all options together including cause', () => {
      const cause = new Error('original');
      const err = new ToolExecutionError('wrapper error', {
        cause,
        operation: 'executeTool',
        toolName: 'bash',
        botId: 'test-bot',
      });

      assert.equal(err.cause, cause);
      assert.ok(err.cause instanceof Error);
      assert.equal(err.operation, 'executeTool');
      assert.equal(err.toolName, 'bash');
      assert.equal(err.botId, 'test-bot');
    });
  });

  describe('DangerousCommandError', () => {
    test('has correct name', () => {
      const err = new DangerousCommandError('blocked');
      assert.equal(err.name, 'DangerousCommandError');
    });

    test('has correct message', () => {
      const err = new DangerousCommandError('Command blocked');
      assert.equal(err.message, 'Command blocked');
    });

    test('stores command', () => {
      const err = new DangerousCommandError('blocked', { command: 'rm -rf /' });
      assert.equal(err.command, 'rm -rf /');
    });

    test('stores pattern', () => {
      const err = new DangerousCommandError('blocked', { pattern: 'rm -rf /' });
      assert.equal(err.pattern, 'rm -rf /');
    });

    test('stores cause via standard Error options', () => {
      const cause = new Error('original');
      const err = new DangerousCommandError('blocked', { cause });
      assert.equal(err.cause, cause);
      assert.ok(err.cause instanceof Error);
    });

    test('is instanceof Error', () => {
      const err = new DangerousCommandError('test');
      assert.ok(err instanceof Error);
    });

    test('stores all options together including cause', () => {
      const cause = new Error('original');
      const err = new DangerousCommandError('blocked command', {
        cause,
        command: 'rm -rf /',
        pattern: 'rm -rf /',
      });

      assert.equal(err.cause, cause);
      assert.ok(err.cause instanceof Error);
      assert.equal(err.command, 'rm -rf /');
      assert.equal(err.pattern, 'rm -rf /');
    });
  });

  describe('output truncation', () => {
    let executor;
    let mocks;

    beforeEach(() => {
      mocks = createMockContainerPool();
      executor = new ToolExecutor(mocks.mockContainerPool, {
        maxStdoutLength: 100,
        maxStderrLength: 50,
        maxFileContentLength: 80,
      });
    });

    test('truncates stdout at configured limit', async () => {
      mocks.mockDockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: 'a'.repeat(200),
        stderr: '',
      }));

      const result = await executor.bash('cmd', 'test-bot');

      assert.ok(result.stdout.length < 200);
      assert.match(result.stdout, /\[truncated 100 characters\]/);
    });

    test('truncates stderr at configured limit', async () => {
      mocks.mockDockerManager.exec = mock.fn(async () => ({
        exitCode: 1,
        stdout: '',
        stderr: 'e'.repeat(100),
      }));

      const result = await executor.bash('cmd', 'test-bot');

      assert.ok(result.stderr.length < 100);
      assert.match(result.stderr, /\[truncated 50 characters\]/);
    });

    test('truncates file content at configured limit', async () => {
      mocks.mockDockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: 'f'.repeat(200),
        stderr: '',
      }));

      const result = await executor.readFile('/home/agent/file.txt', 'test-bot');

      assert.ok(result.content.length < 200);
      assert.match(result.content, /\[truncated 120 characters\]/);
    });

    test('does not truncate output under limit', async () => {
      mocks.mockDockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: 'short',
        stderr: '',
      }));

      const result = await executor.bash('cmd', 'test-bot');

      assert.equal(result.stdout, 'short');
      assert.doesNotMatch(result.stdout, /truncated/);
    });

    test('handles empty stdout', async () => {
      mocks.mockDockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
      }));

      const result = await executor.bash('cmd', 'test-bot');

      assert.equal(result.stdout, '');
    });

    test('handles null/undefined stdout gracefully', async () => {
      mocks.mockDockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: null,
        stderr: undefined,
      }));

      const result = await executor.bash('cmd', 'test-bot');

      assert.equal(result.stdout, '');
      assert.equal(result.stderr, '');
    });
  });
});
