/**
 * Unit tests for BashTool
 *
 * Tests the createBashTool factory function, Zod parameter schema,
 * security checks (dangerous command blocking), output truncation,
 * error handling, and tool configuration overrides.
 *
 * Note: These are unit tests with mocked ContainerPool.
 */

import { describe, test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createBashTool, BashToolError, isDangerousCommand } from '../../../src/tools/bash-tool.js';

/**
 * Create a mock ContainerPool with exec() abstraction
 * @param {Object} [overrides={}] - Override default mock implementations
 * @returns {Object} Mock ContainerPool and related mocks
 */
function createMockContainerPool(overrides = {}) {
  const mockContainer = {
    id: 'container-123',
  };

  const mockDockerManager = {
    exec: mock.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })),
    ...overrides.dockerManager,
  };

  const mockContainerPool = {
    // New abstracted exec method — delegates to dockerManager.exec internally
    exec: mock.fn(async (_botId, command, options) => {
      return mockDockerManager.exec(mockContainer, command, options);
    }),
    // Legacy properties kept for backward compatibility
    getContainer: mock.fn(async () => mockContainer),
    dockerManager: mockDockerManager,
    ...overrides.pool,
  };

  return { mockContainerPool, mockContainer, mockDockerManager };
}

describe('BashTool', () => {
  describe('createBashTool()', () => {
    let containerPool;

    beforeEach(() => {
      const mocks = createMockContainerPool();
      containerPool = mocks.mockContainerPool;
    });

    test('returns a tool object with description, parameters, and execute', () => {
      const bashTool = createBashTool(containerPool, 'test-bot');

      assert.ok(bashTool, 'Tool should be defined');
      assert.ok(bashTool.description, 'Should have description');
      assert.ok(bashTool.parameters, 'Should have parameters (Zod schema)');
      assert.equal(typeof bashTool.execute, 'function', 'Should have execute function');
    });

    test('description mentions bash command execution', () => {
      const bashTool = createBashTool(containerPool, 'test-bot');

      assert.match(bashTool.description, /bash|command|execute/i);
    });

    test('throws BashToolError when containerPool is null', () => {
      assert.throws(
        () => createBashTool(null, 'test-bot'),
        err => {
          assert.ok(err instanceof BashToolError);
          assert.equal(err.name, 'BashToolError');
          assert.match(err.message, /ContainerPool is required/);
          assert.equal(err.operation, 'createBashTool');
          return true;
        }
      );
    });

    test('throws BashToolError when containerPool is undefined', () => {
      assert.throws(
        () => createBashTool(undefined, 'test-bot'),
        err => {
          assert.ok(err instanceof BashToolError);
          assert.match(err.message, /ContainerPool is required/);
          return true;
        }
      );
    });

    test('throws BashToolError when botId is null', () => {
      assert.throws(
        () => createBashTool(containerPool, null),
        err => {
          assert.ok(err instanceof BashToolError);
          assert.match(err.message, /Bot ID must be a non-empty string/);
          assert.equal(err.operation, 'createBashTool');
          return true;
        }
      );
    });

    test('throws BashToolError when botId is empty string', () => {
      assert.throws(
        () => createBashTool(containerPool, ''),
        err => {
          assert.ok(err instanceof BashToolError);
          assert.match(err.message, /Bot ID must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws BashToolError when botId is not a string', () => {
      assert.throws(
        () => createBashTool(containerPool, 42),
        err => {
          assert.ok(err instanceof BashToolError);
          assert.match(err.message, /Bot ID must be a non-empty string/);
          return true;
        }
      );
    });

    test('accepts optional toolConfig parameter', () => {
      const bashTool = createBashTool(containerPool, 'test-bot', {
        timeout: 60000,
        maxStdoutLength: 100000,
      });

      assert.ok(bashTool, 'Should create tool with custom config');
    });

    test('works with empty toolConfig', () => {
      const bashTool = createBashTool(containerPool, 'test-bot', {});

      assert.ok(bashTool, 'Should create tool with empty config');
    });
  });

  describe('execute()', () => {
    let containerPool;
    let dockerManager;

    beforeEach(() => {
      const mocks = createMockContainerPool();
      containerPool = mocks.mockContainerPool;
      dockerManager = mocks.mockDockerManager;
    });

    test('executes "echo hello" and returns stdout', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: 'hello\n',
        stderr: '',
      }));

      const bashTool = createBashTool(containerPool, 'test-bot');
      const result = await bashTool.execute({ command: 'echo hello' });

      assert.equal(result.success, true);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, 'hello\n');
      assert.equal(result.stderr, '');
    });

    test('returns correct exitCode for successful command', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: 'output',
        stderr: '',
      }));

      const bashTool = createBashTool(containerPool, 'test-bot');
      const result = await bashTool.execute({ command: 'ls -la' });

      assert.equal(result.success, true);
      assert.equal(result.exitCode, 0);
    });

    test('returns exitCode for failed command', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 127,
        stdout: '',
        stderr: 'command not found',
      }));

      const bashTool = createBashTool(containerPool, 'test-bot');
      const result = await bashTool.execute({ command: 'nonexistent-command' });

      assert.equal(result.success, false);
      assert.equal(result.exitCode, 127);
      assert.equal(result.stderr, 'command not found');
    });

    test('captures stderr on error', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 1,
        stdout: '',
        stderr: 'Permission denied',
      }));

      const bashTool = createBashTool(containerPool, 'test-bot');
      const result = await bashTool.execute({ command: 'cat /etc/shadow' });

      assert.equal(result.success, false);
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, /Permission denied/);
    });

    test('captures both stdout and stderr', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 1,
        stdout: 'partial output',
        stderr: 'some warning',
      }));

      const bashTool = createBashTool(containerPool, 'test-bot');
      const result = await bashTool.execute({ command: 'some-command' });

      assert.equal(result.success, false);
      assert.equal(result.stdout, 'partial output');
      assert.equal(result.stderr, 'some warning');
    });

    test('passes correct botId to containerPool.exec', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
      }));

      const bashTool = createBashTool(containerPool, 'my-support-bot');
      await bashTool.execute({ command: 'echo test' });

      assert.equal(containerPool.exec.mock.calls.length, 1);
      assert.equal(containerPool.exec.mock.calls[0].arguments[0], 'my-support-bot');
    });

    test('passes command to containerPool.exec', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
      }));

      const bashTool = createBashTool(containerPool, 'test-bot');
      await bashTool.execute({ command: 'npm install express' });

      assert.equal(containerPool.exec.mock.calls.length, 1);
      const [botId, command] = containerPool.exec.mock.calls[0].arguments;
      assert.equal(botId, 'test-bot');
      assert.equal(command, 'npm install express');
    });

    test('passes default timeout to containerPool.exec', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
      }));

      const bashTool = createBashTool(containerPool, 'test-bot');
      await bashTool.execute({ command: 'echo test' });

      const execOptions = containerPool.exec.mock.calls[0].arguments[2];
      assert.equal(execOptions.timeout, 30000);
    });

    test('passes custom timeout from execute params', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
      }));

      const bashTool = createBashTool(containerPool, 'test-bot');
      await bashTool.execute({ command: 'sleep 5', timeout: 60000 });

      const execOptions = containerPool.exec.mock.calls[0].arguments[2];
      assert.equal(execOptions.timeout, 60000);
    });

    test('uses toolConfig timeout as default when no param timeout', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
      }));

      const bashTool = createBashTool(containerPool, 'test-bot', { timeout: 45000 });
      await bashTool.execute({ command: 'echo test' });

      const execOptions = containerPool.exec.mock.calls[0].arguments[2];
      assert.equal(execOptions.timeout, 45000);
    });

    test('param timeout overrides toolConfig timeout', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
      }));

      const bashTool = createBashTool(containerPool, 'test-bot', { timeout: 45000 });
      await bashTool.execute({ command: 'echo test', timeout: 10000 });

      const execOptions = containerPool.exec.mock.calls[0].arguments[2];
      assert.equal(execOptions.timeout, 10000);
    });
  });

  describe('security - dangerous command blocking', () => {
    let containerPool;
    let dockerManager;

    beforeEach(() => {
      const mocks = createMockContainerPool();
      containerPool = mocks.mockContainerPool;
      dockerManager = mocks.mockDockerManager;
    });

    test('blocks rm -rf /', async () => {
      const bashTool = createBashTool(containerPool, 'test-bot');
      const result = await bashTool.execute({ command: 'rm -rf /' });

      assert.equal(result.success, false);
      assert.match(result.stderr, /blocked by security policy/i);
      assert.equal(containerPool.exec.mock.calls.length, 0, 'Should not call exec');
    });

    test('blocks --no-preserve-root', async () => {
      const bashTool = createBashTool(containerPool, 'test-bot');
      const result = await bashTool.execute({ command: 'rm -rf --no-preserve-root /' });

      assert.equal(result.success, false);
      assert.match(result.stderr, /blocked by security policy/i);
    });

    test('blocks fork bomb', async () => {
      const bashTool = createBashTool(containerPool, 'test-bot');
      const result = await bashTool.execute({ command: ':() { : | : & } ; :' });

      assert.equal(result.success, false);
      assert.match(result.stderr, /blocked by security policy/i);
    });

    test('blocks write to disk device', async () => {
      const bashTool = createBashTool(containerPool, 'test-bot');
      const result = await bashTool.execute({ command: 'echo data > /dev/sda' });

      assert.equal(result.success, false);
      assert.match(result.stderr, /blocked by security policy/i);
    });

    test('blocks write to NVMe device', async () => {
      const bashTool = createBashTool(containerPool, 'test-bot');
      const result = await bashTool.execute({ command: 'echo data > /dev/nvme0' });

      assert.equal(result.success, false);
      assert.match(result.stderr, /blocked by security policy/i);
    });

    test('blocks mkfs commands', async () => {
      const bashTool = createBashTool(containerPool, 'test-bot');
      const result = await bashTool.execute({ command: 'mkfs.ext4 /dev/sda1' });

      assert.equal(result.success, false);
      assert.match(result.stderr, /blocked by security policy/i);
    });

    test('blocks dd to device', async () => {
      const bashTool = createBashTool(containerPool, 'test-bot');
      const result = await bashTool.execute({
        command: 'dd if=/dev/zero of=/dev/sda bs=512 count=1',
      });

      assert.equal(result.success, false);
      assert.match(result.stderr, /blocked by security policy/i);
    });

    test('blocks chmod 777 /', async () => {
      const bashTool = createBashTool(containerPool, 'test-bot');
      const result = await bashTool.execute({ command: 'chmod -R 777 /' });

      assert.equal(result.success, false);
      assert.match(result.stderr, /blocked by security policy/i);
    });

    test('returns exitCode 1 for blocked commands', async () => {
      const bashTool = createBashTool(containerPool, 'test-bot');
      const result = await bashTool.execute({ command: 'rm -rf /' });

      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, '');
    });

    test('allows safe rm commands (rm -rf /home/agent/tmp)', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
      }));

      const bashTool = createBashTool(containerPool, 'test-bot');
      const result = await bashTool.execute({ command: 'rm -rf /home/agent/tmp' });

      assert.equal(result.success, true);
      assert.equal(containerPool.exec.mock.calls.length, 1);
    });

    test('allows safe commands (ls, echo, cat)', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: 'output',
        stderr: '',
      }));

      const bashTool = createBashTool(containerPool, 'test-bot');

      const result1 = await bashTool.execute({ command: 'ls -la' });
      assert.equal(result1.success, true);

      const result2 = await bashTool.execute({ command: 'echo hello' });
      assert.equal(result2.success, true);

      const result3 = await bashTool.execute({ command: 'cat /home/agent/file.txt' });
      assert.equal(result3.success, true);
    });
  });

  describe('output truncation', () => {
    let containerPool;
    let dockerManager;

    beforeEach(() => {
      const mocks = createMockContainerPool();
      containerPool = mocks.mockContainerPool;
      dockerManager = mocks.mockDockerManager;
    });

    test('truncates stdout exceeding maxStdoutLength', async () => {
      const longOutput = 'x'.repeat(60000);
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: longOutput,
        stderr: '',
      }));

      const bashTool = createBashTool(containerPool, 'test-bot');
      const result = await bashTool.execute({ command: 'cat large-file' });

      assert.ok(result.stdout.length < longOutput.length);
      assert.match(result.stdout, /\.\.\. \[truncated \d+ characters\]/);
    });

    test('truncates stderr exceeding maxStderrLength', async () => {
      const longStderr = 'e'.repeat(15000);
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 1,
        stdout: '',
        stderr: longStderr,
      }));

      const bashTool = createBashTool(containerPool, 'test-bot');
      const result = await bashTool.execute({ command: 'bad-command' });

      assert.ok(result.stderr.length < longStderr.length);
      assert.match(result.stderr, /\.\.\. \[truncated \d+ characters\]/);
    });

    test('does not truncate stdout within limit', async () => {
      const normalOutput = 'x'.repeat(1000);
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: normalOutput,
        stderr: '',
      }));

      const bashTool = createBashTool(containerPool, 'test-bot');
      const result = await bashTool.execute({ command: 'echo test' });

      assert.equal(result.stdout, normalOutput);
    });

    test('respects custom maxStdoutLength from toolConfig', async () => {
      const output = 'x'.repeat(200);
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: output,
        stderr: '',
      }));

      const bashTool = createBashTool(containerPool, 'test-bot', { maxStdoutLength: 100 });
      const result = await bashTool.execute({ command: 'echo test' });

      assert.ok(result.stdout.length < output.length);
      assert.match(result.stdout, /\.\.\. \[truncated 100 characters\]/);
    });

    test('respects custom maxStderrLength from toolConfig', async () => {
      const longStderr = 'e'.repeat(500);
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 1,
        stdout: '',
        stderr: longStderr,
      }));

      const bashTool = createBashTool(containerPool, 'test-bot', { maxStderrLength: 200 });
      const result = await bashTool.execute({ command: 'bad-command' });

      assert.ok(result.stderr.length < longStderr.length);
      assert.match(result.stderr, /\.\.\. \[truncated 300 characters\]/);
    });

    test('returns empty string for null/undefined stdout', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: null,
        stderr: '',
      }));

      const bashTool = createBashTool(containerPool, 'test-bot');
      const result = await bashTool.execute({ command: 'true' });

      assert.equal(result.stdout, '');
    });

    test('returns empty string for null/undefined stderr', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: 'ok',
        stderr: null,
      }));

      const bashTool = createBashTool(containerPool, 'test-bot');
      const result = await bashTool.execute({ command: 'echo ok' });

      assert.equal(result.stderr, '');
    });
  });

  describe('error handling', () => {
    let containerPool;

    beforeEach(() => {
      const mocks = createMockContainerPool();
      containerPool = mocks.mockContainerPool;
    });

    test('returns error result when containerPool.exec fails with container error', async () => {
      containerPool.exec = mock.fn(async () => {
        throw new Error('Container not found');
      });

      const bashTool = createBashTool(containerPool, 'test-bot');
      const result = await bashTool.execute({ command: 'echo test' });

      assert.equal(result.success, false);
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, /Execution error: Container not found/);
    });

    test('returns error result when exec fails', async () => {
      containerPool.exec = mock.fn(async () => {
        throw new Error('Docker exec timed out');
      });

      const bashTool = createBashTool(containerPool, 'test-bot');
      const result = await bashTool.execute({ command: 'sleep 999' });

      assert.equal(result.success, false);
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, /Execution error: Docker exec timed out/);
    });

    test('returns error result (not throws) for container errors', async () => {
      containerPool.exec = mock.fn(async () => {
        throw new Error('Pool exhausted');
      });

      const bashTool = createBashTool(containerPool, 'test-bot');

      // Should NOT throw - should return error result for LLM
      const result = await bashTool.execute({ command: 'echo hello' });
      assert.equal(result.success, false);
      assert.ok(result.stderr.length > 0);
    });

    test('error result has standard shape (success, exitCode, stdout, stderr)', async () => {
      containerPool.exec = mock.fn(async () => {
        throw new Error('Network error');
      });

      const bashTool = createBashTool(containerPool, 'test-bot');
      const result = await bashTool.execute({ command: 'echo test' });

      assert.equal(typeof result.success, 'boolean');
      assert.equal(typeof result.exitCode, 'number');
      assert.equal(typeof result.stdout, 'string');
      assert.equal(typeof result.stderr, 'string');
    });
  });

  describe('isDangerousCommand()', () => {
    test('detects rm -rf /', () => {
      assert.equal(isDangerousCommand('rm -rf /'), true);
    });

    test('detects rm -rf / at end of command', () => {
      assert.equal(isDangerousCommand('sudo rm -rf / '), true);
    });

    test('detects --no-preserve-root', () => {
      assert.equal(isDangerousCommand('rm --no-preserve-root /'), true);
    });

    test('detects fork bomb', () => {
      assert.equal(isDangerousCommand(':() { : | : & } ; :'), true);
    });

    test('detects write to /dev/sda', () => {
      assert.equal(isDangerousCommand('echo boom > /dev/sda'), true);
    });

    test('detects write to /dev/nvme', () => {
      assert.equal(isDangerousCommand('echo boom > /dev/nvme0'), true);
    });

    test('detects mkfs commands', () => {
      assert.equal(isDangerousCommand('mkfs.ext4 /dev/sda1'), true);
    });

    test('detects dd to device', () => {
      assert.equal(isDangerousCommand('dd if=/dev/zero of=/dev/sda'), true);
    });

    test('detects chmod -R 777 /', () => {
      assert.equal(isDangerousCommand('chmod -R 777 /'), true);
    });

    test('returns false for safe commands', () => {
      assert.equal(isDangerousCommand('echo hello'), false);
      assert.equal(isDangerousCommand('ls -la'), false);
      assert.equal(isDangerousCommand('cat file.txt'), false);
      assert.equal(isDangerousCommand('npm install express'), false);
      assert.equal(isDangerousCommand('git status'), false);
    });

    test('returns false for rm with safe paths', () => {
      assert.equal(isDangerousCommand('rm -rf /home/agent/tmp'), false);
      assert.equal(isDangerousCommand('rm -rf ./node_modules'), false);
    });

    test('returns false for null/undefined/empty', () => {
      assert.equal(isDangerousCommand(null), false);
      assert.equal(isDangerousCommand(undefined), false);
      assert.equal(isDangerousCommand(''), false);
    });

    test('returns false for non-string input', () => {
      assert.equal(isDangerousCommand(42), false);
      assert.equal(isDangerousCommand({}), false);
    });
  });

  describe('BashToolError', () => {
    test('extends Error with correct name', () => {
      const err = new BashToolError('test error');

      assert.ok(err instanceof Error);
      assert.equal(err.name, 'BashToolError');
      assert.equal(err.message, 'test error');
    });

    test('stores operation, botId, and command metadata', () => {
      const err = new BashToolError('fail', {
        operation: 'createBashTool',
        botId: 'support',
        command: 'echo test',
      });

      assert.equal(err.operation, 'createBashTool');
      assert.equal(err.botId, 'support');
      assert.equal(err.command, 'echo test');
    });

    test('stores cause via standard Error options', () => {
      const original = new Error('original');
      const err = new BashToolError('wrapped', { cause: original });

      assert.equal(err.cause, original);
      assert.ok(err.cause instanceof Error);
    });

    test('defaults optional fields to undefined', () => {
      const err = new BashToolError('test');

      assert.equal(err.operation, undefined);
      assert.equal(err.botId, undefined);
      assert.equal(err.command, undefined);
      assert.equal(err.cause, undefined);
    });

    test('stores all options together including cause', () => {
      const cause = new Error('original');
      const err = new BashToolError('wrapper error', {
        cause,
        operation: 'execute',
        botId: 'test-bot',
        command: 'echo test',
      });

      assert.equal(err.cause, cause);
      assert.ok(err.cause instanceof Error);
      assert.equal(err.operation, 'execute');
      assert.equal(err.botId, 'test-bot');
      assert.equal(err.command, 'echo test');
    });
  });

  describe('Zod parameter schema', () => {
    let containerPool;

    beforeEach(() => {
      const mocks = createMockContainerPool();
      containerPool = mocks.mockContainerPool;
    });

    test('parameters schema has command field', () => {
      const bashTool = createBashTool(containerPool, 'test-bot');
      const schema = bashTool.parameters;

      // Validate that a valid input passes
      const result = schema.safeParse({ command: 'echo hello' });
      assert.equal(result.success, true);
    });

    test('parameters schema rejects missing command', () => {
      const bashTool = createBashTool(containerPool, 'test-bot');
      const schema = bashTool.parameters;

      const result = schema.safeParse({});
      assert.equal(result.success, false);
    });

    test('parameters schema rejects non-string command', () => {
      const bashTool = createBashTool(containerPool, 'test-bot');
      const schema = bashTool.parameters;

      const result = schema.safeParse({ command: 42 });
      assert.equal(result.success, false);
    });

    test('parameters schema accepts optional timeout', () => {
      const bashTool = createBashTool(containerPool, 'test-bot');
      const schema = bashTool.parameters;

      const result = schema.safeParse({ command: 'echo test', timeout: 60000 });
      assert.equal(result.success, true);
      assert.equal(result.data.timeout, 60000);
    });

    test('parameters schema accepts command without timeout', () => {
      const bashTool = createBashTool(containerPool, 'test-bot');
      const schema = bashTool.parameters;

      const result = schema.safeParse({ command: 'echo test' });
      assert.equal(result.success, true);
      assert.equal(result.data.timeout, undefined);
    });

    test('parameters schema rejects non-number timeout', () => {
      const bashTool = createBashTool(containerPool, 'test-bot');
      const schema = bashTool.parameters;

      const result = schema.safeParse({ command: 'echo test', timeout: 'fast' });
      assert.equal(result.success, false);
    });
  });

  describe('tool integration pattern', () => {
    let containerPool;
    let dockerManager;

    beforeEach(() => {
      const mocks = createMockContainerPool();
      containerPool = mocks.mockContainerPool;
      dockerManager = mocks.mockDockerManager;
    });

    test('can be used as a ToolRegistry factory function', () => {
      // The tool registry passes (containerPool, botId, toolConfig)
      const factory = createBashTool;
      const bashTool = factory(containerPool, 'test-bot', {});

      assert.ok(bashTool.description);
      assert.ok(bashTool.parameters);
      assert.equal(typeof bashTool.execute, 'function');
    });

    test('multiple tools for different bots are independent', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
      }));

      const tool1 = createBashTool(containerPool, 'bot-a');
      const tool2 = createBashTool(containerPool, 'bot-b');

      await tool1.execute({ command: 'echo a' });
      await tool2.execute({ command: 'echo b' });

      assert.equal(containerPool.exec.mock.calls.length, 2);
      assert.equal(containerPool.exec.mock.calls[0].arguments[0], 'bot-a');
      assert.equal(containerPool.exec.mock.calls[1].arguments[0], 'bot-b');
    });

    test('result shape is consistent for success and failure', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: 'success output',
        stderr: '',
      }));

      const bashTool = createBashTool(containerPool, 'test-bot');

      // Success case
      const successResult = await bashTool.execute({ command: 'echo ok' });
      assert.ok('success' in successResult);
      assert.ok('exitCode' in successResult);
      assert.ok('stdout' in successResult);
      assert.ok('stderr' in successResult);

      // Failure case (dangerous command)
      const failResult = await bashTool.execute({ command: 'rm -rf /' });
      assert.ok('success' in failResult);
      assert.ok('exitCode' in failResult);
      assert.ok('stdout' in failResult);
      assert.ok('stderr' in failResult);
    });
  });
});
