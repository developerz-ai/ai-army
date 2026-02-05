/**
 * Integration tests for ToolExecutor
 *
 * Tests real tool execution in Docker containers via ContainerPool.
 * Covers bash execution, file operations, security checks (dangerous command
 * blocking), executeTool routing, output truncation, timeout handling,
 * multi-bot isolation, and comprehensive error handling.
 *
 * Run with: npm run test:integration
 *
 * Note: These tests create and destroy real Docker containers.
 * They use a unique prefix to avoid conflicts with other containers.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DockerManager } from '../../../src/execution/docker-manager.js';
import { ContainerPool } from '../../../src/execution/container-pool.js';
import {
  ToolExecutor,
  ToolExecutionError,
  DangerousCommandError,
} from '../../../src/execution/tool-executor.js';

/**
 * Generate unique container name prefix to avoid conflicts
 */
const TEST_PREFIX = `ai-army-tool-test-${Date.now()}`;

/**
 * Check if Docker is available
 * @returns {Promise<boolean>}
 */
async function checkDockerAvailable() {
  const manager = new DockerManager();
  try {
    await manager.getInfo();
    return true;
  } catch {
    return false;
  }
}

/**
 * Clean up all test containers by prefix
 * @param {DockerManager} manager
 * @param {string} prefix
 */
async function cleanupTestContainers(manager, prefix) {
  try {
    const containers = await manager.listManagedContainers({ all: true });
    for (const containerInfo of containers) {
      if (containerInfo.Names?.some(name => name.includes(prefix))) {
        try {
          const container = manager.docker.getContainer(containerInfo.Id);
          await container.remove({ force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}

// Check Docker availability at module load
const DOCKER_AVAILABLE = await checkDockerAvailable();

if (!DOCKER_AVAILABLE) {
  console.log('Skipping ToolExecutor integration tests - Docker not available');
  console.log('Ensure Docker is running: docker info');
}

describe('ToolExecutor Integration', { skip: !DOCKER_AVAILABLE }, () => {
  let dockerManager;
  let pool;
  let executor;
  let tempDir;
  let botId;

  before(async () => {
    dockerManager = new DockerManager();
    pool = new ContainerPool(dockerManager);
    executor = new ToolExecutor(pool);

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-army-tool-test-'));
    botId = `${TEST_PREFIX}-bot-${Date.now()}`;

    const botConfig = {
      id: botId,
      sandbox: {
        image: 'alpine:latest',
        memory: '256m',
        cpus: 1,
      },
    };

    await pool.initializeContainer(botId, botConfig, { root: tempDir });
  });

  after(async () => {
    if (pool) {
      try {
        await pool.cleanup();
      } catch {
        // Ignore cleanup errors
      }
    }

    if (dockerManager) {
      await cleanupTestContainers(dockerManager, TEST_PREFIX);
    }

    if (tempDir) {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe('bash() - Command Execution', () => {
    it('executes echo command and returns output', async () => {
      const result = await executor.bash('echo "hello world"', botId);

      assert.equal(result.success, true);
      assert.equal(result.stdout, 'hello world');
      assert.equal(result.stderr, '');
      assert.equal(result.exitCode, 0);
    });

    it('captures stderr for failed commands', async () => {
      const result = await executor.bash('cat /nonexistent-file-12345', botId);

      assert.equal(result.success, false);
      assert.equal(result.exitCode, 1);
      assert.ok(result.stderr.length > 0, 'Should have stderr output');
    });

    it('returns correct exit codes', async () => {
      const result = await executor.bash('exit 42', botId);

      assert.equal(result.success, false);
      assert.equal(result.exitCode, 42);
    });

    it('returns exit code 0 for success', async () => {
      const result = await executor.bash('true', botId);

      assert.equal(result.success, true);
      assert.equal(result.exitCode, 0);
    });

    it('executes multi-line scripts', async () => {
      const script = 'echo "line1"\necho "line2"\necho "line3"';
      const result = await executor.bash(script, botId);

      assert.equal(result.success, true);
      assert.equal(result.stdout, 'line1\nline2\nline3');
    });

    it('handles special characters in output', async () => {
      const result = await executor.bash('echo "hello $USER & <world>"', botId);

      assert.equal(result.success, true);
      assert.ok(result.stdout.includes('hello'));
    });

    it('handles environment variables', async () => {
      const result = await executor.bash('echo $HOME', botId);

      assert.equal(result.success, true);
      assert.ok(result.stdout.length > 0);
    });

    it('handles piped commands', async () => {
      const result = await executor.bash('echo "hello world" | tr a-z A-Z', botId);

      assert.equal(result.success, true);
      assert.equal(result.stdout, 'HELLO WORLD');
    });

    it('handles working directory option', async () => {
      const result = await executor.bash('pwd', botId, { workingDir: '/tmp' });

      assert.equal(result.success, true);
      assert.equal(result.stdout, '/tmp');
    });

    it('executes compound commands with &&', async () => {
      const result = await executor.bash('echo "a" && echo "b"', botId);

      assert.equal(result.success, true);
      assert.equal(result.stdout, 'a\nb');
    });

    it('handles command substitution', async () => {
      const result = await executor.bash('echo "count: $(echo 42)"', botId);

      assert.equal(result.success, true);
      assert.equal(result.stdout, 'count: 42');
    });

    it('handles commands that produce both stdout and stderr', async () => {
      const result = await executor.bash('echo "output" && echo "error" >&2', botId);

      assert.ok(result.stdout.includes('output'));
      assert.ok(result.stderr.includes('error'));
    });

    it('handles for loops', async () => {
      const result = await executor.bash('for i in 1 2 3; do echo $i; done', botId);

      assert.equal(result.success, true);
      assert.equal(result.stdout, '1\n2\n3');
    });
  });

  describe('readFile() - File Reading', () => {
    it('reads file content from container workspace', async () => {
      const testContent = 'Hello from integration test';
      await fs.writeFile(path.join(tempDir, 'read-test.txt'), testContent);

      const result = await executor.readFile('/home/agent/read-test.txt', botId);

      assert.equal(result.success, true);
      assert.equal(result.content, testContent);
    });

    it('reads file with multiple lines', async () => {
      const testContent = 'line1\nline2\nline3\n';
      await fs.writeFile(path.join(tempDir, 'multiline.txt'), testContent);

      const result = await executor.readFile('/home/agent/multiline.txt', botId);

      assert.equal(result.success, true);
      assert.ok(result.content.includes('line1'));
      assert.ok(result.content.includes('line2'));
      assert.ok(result.content.includes('line3'));
    });

    it('returns error for non-existent file', async () => {
      const result = await executor.readFile('/home/agent/does-not-exist.txt', botId);

      assert.equal(result.success, false);
      assert.equal(result.content, '');
      assert.ok(result.error, 'Should have error message');
    });

    it('reads file with special characters in content', async () => {
      const testContent = 'Special: $VAR & "quotes" <tags> \'single\'';
      await fs.writeFile(path.join(tempDir, 'special-chars.txt'), testContent);

      const result = await executor.readFile('/home/agent/special-chars.txt', botId);

      assert.equal(result.success, true);
      assert.equal(result.content, testContent);
    });

    it('reads empty file', async () => {
      await fs.writeFile(path.join(tempDir, 'empty.txt'), '');

      const result = await executor.readFile('/home/agent/empty.txt', botId);

      assert.equal(result.success, true);
      assert.equal(result.content, '');
    });

    it('reads file created by bash command', async () => {
      await executor.bash('echo "created-by-bash" > /home/agent/bash-created.txt', botId);

      const result = await executor.readFile('/home/agent/bash-created.txt', botId);

      assert.equal(result.success, true);
      assert.equal(result.content, 'created-by-bash');
    });

    it('reads JSON file content correctly', async () => {
      const jsonContent = JSON.stringify({ key: 'value', num: 42 }, null, 2);
      await fs.writeFile(path.join(tempDir, 'test.json'), jsonContent);

      const result = await executor.readFile('/home/agent/test.json', botId);

      assert.equal(result.success, true);
      assert.equal(result.content, jsonContent);
    });
  });

  describe('writeFile() - File Writing', () => {
    it('writes content to a new file', async () => {
      const content = 'Written from ToolExecutor';
      const result = await executor.writeFile('/home/agent/write-test.txt', content, botId);

      assert.equal(result.success, true);

      // Verify content on host
      const hostContent = await fs.readFile(path.join(tempDir, 'write-test.txt'), 'utf8');
      assert.equal(hostContent, content);
    });

    it('overwrites existing file', async () => {
      await fs.writeFile(path.join(tempDir, 'overwrite.txt'), 'original');

      const result = await executor.writeFile('/home/agent/overwrite.txt', 'new content', botId);

      assert.equal(result.success, true);

      const hostContent = await fs.readFile(path.join(tempDir, 'overwrite.txt'), 'utf8');
      assert.equal(hostContent, 'new content');
    });

    it('appends to existing file', async () => {
      await fs.writeFile(path.join(tempDir, 'append.txt'), 'first');

      const result = await executor.writeFile('/home/agent/append.txt', ' second', botId, {
        append: true,
      });

      assert.equal(result.success, true);

      const hostContent = await fs.readFile(path.join(tempDir, 'append.txt'), 'utf8');
      assert.equal(hostContent, 'first second');
    });

    it('writes content with special characters', async () => {
      const content = 'Line1\nLine2\n$VAR\n\'quotes\'\n"doubles"';
      const result = await executor.writeFile('/home/agent/special-write.txt', content, botId);

      assert.equal(result.success, true);

      const hostContent = await fs.readFile(path.join(tempDir, 'special-write.txt'), 'utf8');
      assert.equal(hostContent, content);
    });

    it('writes empty content', async () => {
      const result = await executor.writeFile('/home/agent/empty-write.txt', '', botId);

      assert.equal(result.success, true);

      const hostContent = await fs.readFile(path.join(tempDir, 'empty-write.txt'), 'utf8');
      assert.equal(hostContent, '');
    });

    it('write then read roundtrip preserves content', async () => {
      const content = 'Roundtrip test\nwith multiple\nlines';

      await executor.writeFile('/home/agent/roundtrip.txt', content, botId);
      const readResult = await executor.readFile('/home/agent/roundtrip.txt', botId);

      assert.equal(readResult.success, true);
      assert.equal(readResult.content, content);
    });

    it('writes content with unicode characters', async () => {
      const content = 'Hello 🌍 — "smart quotes" and © symbols';
      const result = await executor.writeFile('/home/agent/unicode.txt', content, botId);

      assert.equal(result.success, true);

      const hostContent = await fs.readFile(path.join(tempDir, 'unicode.txt'), 'utf8');
      assert.equal(hostContent, content);
    });

    it('multiple appends accumulate correctly', async () => {
      await executor.writeFile('/home/agent/multi-append.txt', 'line1\n', botId);
      await executor.writeFile('/home/agent/multi-append.txt', 'line2\n', botId, { append: true });
      await executor.writeFile('/home/agent/multi-append.txt', 'line3', botId, { append: true });

      const readResult = await executor.readFile('/home/agent/multi-append.txt', botId);

      assert.equal(readResult.success, true);
      assert.equal(readResult.content, 'line1\nline2\nline3');
    });
  });

  describe('executeTool() - Tool Routing', () => {
    it('routes bash tool correctly', async () => {
      const result = await executor.executeTool('bash', { command: 'echo "routed"' }, botId);

      assert.equal(result.success, true);
      assert.equal(result.stdout, 'routed');
      assert.equal(result.exitCode, 0);
    });

    it('routes readFile tool correctly', async () => {
      await fs.writeFile(path.join(tempDir, 'route-test.txt'), 'route content');

      const result = await executor.executeTool(
        'readFile',
        { path: '/home/agent/route-test.txt' },
        botId
      );

      assert.equal(result.success, true);
      assert.equal(result.content, 'route content');
    });

    it('routes writeFile tool correctly', async () => {
      const result = await executor.executeTool(
        'writeFile',
        { path: '/home/agent/route-write.txt', content: 'routed write' },
        botId
      );

      assert.equal(result.success, true);

      const hostContent = await fs.readFile(path.join(tempDir, 'route-write.txt'), 'utf8');
      assert.equal(hostContent, 'routed write');
    });

    it('throws for unsupported tool', async () => {
      await assert.rejects(
        () => executor.executeTool('grep', { pattern: 'foo' }, botId),
        err => {
          assert.ok(err instanceof ToolExecutionError);
          assert.match(err.message, /Unsupported tool: grep/);
          assert.match(err.message, /bash, readFile, writeFile/);
          return true;
        }
      );
    });

    it('throws for empty tool name', async () => {
      await assert.rejects(
        () => executor.executeTool('', {}, botId),
        err => {
          assert.ok(err instanceof ToolExecutionError);
          assert.match(err.message, /Tool name must be a non-empty string/);
          return true;
        }
      );
    });

    it('throws for null tool name', async () => {
      await assert.rejects(
        () => executor.executeTool(null, {}, botId),
        err => {
          assert.ok(err instanceof ToolExecutionError);
          return true;
        }
      );
    });

    it('throws for null params', async () => {
      await assert.rejects(
        () => executor.executeTool('bash', null, botId),
        err => {
          assert.ok(err instanceof ToolExecutionError);
          assert.match(err.message, /Tool parameters must be an object/);
          return true;
        }
      );
    });

    it('throws for empty botId', async () => {
      await assert.rejects(
        () => executor.executeTool('bash', { command: 'ls' }, ''),
        err => {
          assert.ok(err instanceof ToolExecutionError);
          assert.match(err.message, /Bot ID must be a non-empty string/);
          return true;
        }
      );
    });

    it('routes bash with timeout option', async () => {
      const result = await executor.executeTool(
        'bash',
        { command: 'echo "fast"', timeout: 5000 },
        botId
      );

      assert.equal(result.success, true);
      assert.equal(result.stdout, 'fast');
    });

    it('routes bash with workingDir option', async () => {
      const result = await executor.executeTool(
        'bash',
        { command: 'pwd', workingDir: '/tmp' },
        botId
      );

      assert.equal(result.success, true);
      assert.equal(result.stdout, '/tmp');
    });

    it('routes writeFile with append option', async () => {
      await executor.executeTool(
        'writeFile',
        { path: '/home/agent/route-append.txt', content: 'first' },
        botId
      );

      await executor.executeTool(
        'writeFile',
        { path: '/home/agent/route-append.txt', content: '-second', append: true },
        botId
      );

      const readResult = await executor.executeTool(
        'readFile',
        { path: '/home/agent/route-append.txt' },
        botId
      );

      assert.equal(readResult.content, 'first-second');
    });

    it('blocks dangerous commands through executeTool routing', async () => {
      await assert.rejects(
        () => executor.executeTool('bash', { command: 'rm -rf /' }, botId),
        err => {
          assert.ok(err instanceof DangerousCommandError);
          assert.match(err.message, /blocked by security policy/);
          return true;
        }
      );
    });

    it('full workflow: write, read, process, write result', async () => {
      // Write input
      await executor.executeTool(
        'writeFile',
        { path: '/home/agent/input.txt', content: 'hello world' },
        botId
      );

      // Process with bash
      const processResult = await executor.executeTool(
        'bash',
        { command: 'cat /home/agent/input.txt | tr a-z A-Z' },
        botId
      );

      // Write output
      await executor.executeTool(
        'writeFile',
        { path: '/home/agent/output.txt', content: processResult.stdout },
        botId
      );

      // Read result
      const result = await executor.executeTool(
        'readFile',
        { path: '/home/agent/output.txt' },
        botId
      );

      assert.equal(result.content, 'HELLO WORLD');
    });
  });

  describe('Security - Dangerous Command Blocking', () => {
    it('blocks rm -rf /', async () => {
      await assert.rejects(
        () => executor.bash('rm -rf /', botId),
        err => {
          assert.ok(err instanceof DangerousCommandError);
          assert.match(err.message, /blocked by security policy/);
          return true;
        }
      );
    });

    it('blocks rm -rf / with trailing space', async () => {
      await assert.rejects(
        () => executor.bash('rm -rf / ', botId),
        err => {
          assert.ok(err instanceof DangerousCommandError);
          return true;
        }
      );
    });

    it('blocks rm --no-preserve-root', async () => {
      await assert.rejects(
        () => executor.bash('rm -rf --no-preserve-root /', botId),
        err => {
          assert.ok(err instanceof DangerousCommandError);
          return true;
        }
      );
    });

    it('blocks fork bomb', async () => {
      await assert.rejects(
        () => executor.bash(':() { :|:& };:', botId),
        err => {
          assert.ok(err instanceof DangerousCommandError);
          return true;
        }
      );
    });

    it('blocks dd to device', async () => {
      await assert.rejects(
        () => executor.bash('dd if=/dev/zero of=/dev/sda', botId),
        err => {
          assert.ok(err instanceof DangerousCommandError);
          return true;
        }
      );
    });

    it('blocks mkfs commands', async () => {
      await assert.rejects(
        () => executor.bash('mkfs.ext4 /dev/sda1', botId),
        err => {
          assert.ok(err instanceof DangerousCommandError);
          return true;
        }
      );
    });

    it('blocks mkfs.xfs commands', async () => {
      await assert.rejects(
        () => executor.bash('mkfs.xfs /dev/sdb1', botId),
        err => {
          assert.ok(err instanceof DangerousCommandError);
          return true;
        }
      );
    });

    it('blocks writing to /dev/sda', async () => {
      await assert.rejects(
        () => executor.bash('echo data > /dev/sda', botId),
        err => {
          assert.ok(err instanceof DangerousCommandError);
          return true;
        }
      );
    });

    it('blocks writing to /dev/nvme device', async () => {
      await assert.rejects(
        () => executor.bash('echo data > /dev/nvme0n1', botId),
        err => {
          assert.ok(err instanceof DangerousCommandError);
          return true;
        }
      );
    });

    it('blocks chmod -R 777 /', async () => {
      await assert.rejects(
        () => executor.bash('chmod -R 777 /', botId),
        err => {
          assert.ok(err instanceof DangerousCommandError);
          return true;
        }
      );
    });

    it('allows safe rm -rf on subdirectory', async () => {
      // Create a temp dir in the container workspace
      await fs.mkdir(path.join(tempDir, 'delete-me'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'delete-me', 'test.txt'), 'temp');

      const result = await executor.bash('rm -rf /home/agent/delete-me', botId);

      assert.equal(result.success, true);
    });

    it('allows normal commands', async () => {
      const result = await executor.bash('ls -la /home/agent', botId);

      assert.equal(result.success, true);
    });

    it('allows echo command', async () => {
      const result = await executor.bash('echo hello', botId);

      assert.equal(result.success, true);
      assert.equal(result.stdout, 'hello');
    });

    it('allows cat command', async () => {
      await fs.writeFile(path.join(tempDir, 'safe-cat.txt'), 'safe');

      const result = await executor.bash('cat /home/agent/safe-cat.txt', botId);

      assert.equal(result.success, true);
      assert.equal(result.stdout, 'safe');
    });

    it('allows git commands', async () => {
      // git may not be installed in alpine, but the command should not be blocked
      const result = await executor.bash('which git || echo "git not found"', botId);

      assert.equal(result.success, true);
    });

    it('allows rm without -rf', async () => {
      await fs.writeFile(path.join(tempDir, 'single-rm.txt'), 'temp');

      const result = await executor.bash('rm /home/agent/single-rm.txt', botId);

      assert.equal(result.success, true);
    });

    it('allows chmod on specific directories', async () => {
      await fs.mkdir(path.join(tempDir, 'chmod-test'), { recursive: true });

      const result = await executor.bash('chmod -R 755 /home/agent/chmod-test', botId);

      assert.equal(result.success, true);
    });

    it('allows dd to file (not device)', async () => {
      const result = await executor.bash(
        'dd if=/dev/zero of=/home/agent/test.img bs=1024 count=1 2>/dev/null',
        botId
      );

      assert.equal(result.success, true);

      // Cleanup
      await executor.bash('rm -f /home/agent/test.img', botId);
    });

    it('isDangerousCommand is consistent with bash() behavior', () => {
      // These should be dangerous
      assert.equal(executor.isDangerousCommand('rm -rf /'), true);
      assert.equal(executor.isDangerousCommand(':() { :|:& };:'), true);
      assert.equal(executor.isDangerousCommand('mkfs.ext4 /dev/sda1'), true);
      assert.equal(executor.isDangerousCommand('dd if=/dev/zero of=/dev/sda'), true);
      assert.equal(executor.isDangerousCommand('echo data > /dev/sda'), true);
      assert.equal(executor.isDangerousCommand('chmod -R 777 /'), true);

      // These should be safe
      assert.equal(executor.isDangerousCommand('ls -la'), false);
      assert.equal(executor.isDangerousCommand('echo hello'), false);
      assert.equal(executor.isDangerousCommand('rm -rf /home/agent/temp'), false);
      assert.equal(executor.isDangerousCommand('cat /etc/hostname'), false);
      assert.equal(executor.isDangerousCommand('npm install'), false);
    });

    it('dangerous command error has correct properties', async () => {
      try {
        await executor.bash('rm -rf /', botId);
        assert.fail('Should have thrown');
      } catch (err) {
        assert.ok(err instanceof DangerousCommandError);
        assert.equal(err.name, 'DangerousCommandError');
        assert.match(err.message, /blocked by security policy/);
        assert.equal(err.command, 'rm -rf /');
      }
    });
  });

  describe('Command Timeout', () => {
    it('times out on long-running commands', async () => {
      await assert.rejects(
        () => executor.bash('sleep 60', botId, { timeout: 1000 }),
        err => {
          assert.match(err.message, /timed out/i);
          return true;
        }
      );
    });

    it('completes before timeout for fast commands', async () => {
      const result = await executor.bash('echo "fast"', botId, { timeout: 5000 });

      assert.equal(result.success, true);
      assert.equal(result.stdout, 'fast');
    });

    it('times out via executeTool routing', async () => {
      await assert.rejects(
        () => executor.executeTool('bash', { command: 'sleep 60', timeout: 1000 }, botId),
        err => {
          assert.match(err.message, /timed out/i);
          return true;
        }
      );
    });

    it('container remains usable after timeout', async () => {
      // Trigger a timeout
      try {
        await executor.bash('sleep 60', botId, { timeout: 1000 });
      } catch {
        // Expected
      }

      // Container should still work
      const result = await executor.bash('echo "still alive"', botId);

      assert.equal(result.success, true);
      assert.equal(result.stdout, 'still alive');
    });
  });

  describe('Error Handling', () => {
    it('throws ToolExecutionError for uninitialized bot', async () => {
      await assert.rejects(
        () => executor.bash('echo hi', 'nonexistent-bot'),
        err => {
          assert.ok(err instanceof ToolExecutionError);
          assert.match(err.message, /nonexistent-bot/);
          return true;
        }
      );
    });

    it('throws ToolExecutionError for empty command', async () => {
      await assert.rejects(
        () => executor.bash('', botId),
        err => {
          assert.ok(err instanceof ToolExecutionError);
          assert.match(err.message, /Command must be a non-empty string/);
          return true;
        }
      );
    });

    it('throws ToolExecutionError for null command', async () => {
      await assert.rejects(
        () => executor.bash(null, botId),
        err => {
          assert.ok(err instanceof ToolExecutionError);
          assert.match(err.message, /Command must be a non-empty string/);
          return true;
        }
      );
    });

    it('throws ToolExecutionError for empty file path', async () => {
      await assert.rejects(
        () => executor.readFile('', botId),
        err => {
          assert.ok(err instanceof ToolExecutionError);
          assert.match(err.message, /File path must be a non-empty string/);
          return true;
        }
      );
    });

    it('throws ToolExecutionError for null file path', async () => {
      await assert.rejects(
        () => executor.readFile(null, botId),
        err => {
          assert.ok(err instanceof ToolExecutionError);
          assert.match(err.message, /File path must be a non-empty string/);
          return true;
        }
      );
    });

    it('throws ToolExecutionError for empty write file path', async () => {
      await assert.rejects(
        () => executor.writeFile('', 'content', botId),
        err => {
          assert.ok(err instanceof ToolExecutionError);
          assert.match(err.message, /File path must be a non-empty string/);
          return true;
        }
      );
    });

    it('throws ToolExecutionError for non-string write content', async () => {
      await assert.rejects(
        () => executor.writeFile('/home/agent/test.txt', 123, botId),
        err => {
          assert.ok(err instanceof ToolExecutionError);
          assert.match(err.message, /Content must be a string/);
          return true;
        }
      );
    });

    it('throws ToolExecutionError for null write content', async () => {
      await assert.rejects(
        () => executor.writeFile('/home/agent/test.txt', null, botId),
        err => {
          assert.ok(err instanceof ToolExecutionError);
          assert.match(err.message, /Content must be a string/);
          return true;
        }
      );
    });

    it('throws ToolExecutionError for empty botId in bash', async () => {
      await assert.rejects(
        () => executor.bash('ls', ''),
        err => {
          assert.ok(err instanceof ToolExecutionError);
          assert.match(err.message, /Bot ID must be a non-empty string/);
          return true;
        }
      );
    });

    it('throws ToolExecutionError for empty botId in readFile', async () => {
      await assert.rejects(
        () => executor.readFile('/home/agent/test.txt', ''),
        err => {
          assert.ok(err instanceof ToolExecutionError);
          assert.match(err.message, /Bot ID must be a non-empty string/);
          return true;
        }
      );
    });

    it('throws ToolExecutionError for empty botId in writeFile', async () => {
      await assert.rejects(
        () => executor.writeFile('/home/agent/test.txt', 'content', ''),
        err => {
          assert.ok(err instanceof ToolExecutionError);
          assert.match(err.message, /Bot ID must be a non-empty string/);
          return true;
        }
      );
    });

    it('error context includes toolName for executeTool failures', async () => {
      await assert.rejects(
        () => executor.executeTool('unknownTool', {}, botId),
        err => {
          assert.ok(err instanceof ToolExecutionError);
          assert.equal(err.toolName, 'unknownTool');
          assert.equal(err.botId, botId);
          return true;
        }
      );
    });

    it('handles command that fails with stderr', async () => {
      const result = await executor.bash('ls /nonexistent-directory-xyz', botId);

      assert.equal(result.success, false);
      assert.ok(result.stderr.length > 0);
      assert.notEqual(result.exitCode, 0);
    });
  });

  describe('Output Truncation', () => {
    it('does not truncate short output', async () => {
      const result = await executor.bash('echo "short"', botId);

      assert.equal(result.stdout, 'short');
      assert.doesNotMatch(result.stdout, /truncated/);
    });

    it('does not truncate output under default limit', async () => {
      // Generate output under default 50000 chars
      const result = await executor.bash('yes "line" | head -n 100', botId);

      assert.equal(result.success, true);
      assert.doesNotMatch(result.stdout, /truncated/);
    });
  });

  describe('Custom ToolExecutor Options', () => {
    it('respects custom truncation limits', async () => {
      const shortExecutor = new ToolExecutor(pool, {
        maxStdoutLength: 50,
        maxStderrLength: 30,
      });

      // Generate output longer than 50 chars
      const result = await shortExecutor.bash('yes "abcdefghij" | head -n 20', botId);

      assert.ok(result.stdout.includes('[truncated'));
    });

    it('respects custom file content limit', async () => {
      const shortExecutor = new ToolExecutor(pool, {
        maxFileContentLength: 50,
      });

      // Create file with content longer than 50 chars
      const content = 'x'.repeat(100);
      await fs.writeFile(path.join(tempDir, 'truncate-test.txt'), content);

      const result = await shortExecutor.readFile('/home/agent/truncate-test.txt', botId);

      assert.equal(result.success, true);
      assert.ok(result.content.includes('[truncated'));
      assert.ok(result.content.length < 100);
    });

    it('uses custom default timeout', async () => {
      const quickExecutor = new ToolExecutor(pool, { timeout: 1000 });

      await assert.rejects(
        () => quickExecutor.bash('sleep 60', botId),
        err => {
          assert.match(err.message, /timed out/i);
          return true;
        }
      );
    });
  });
});

describe('ToolExecutor Multi-Bot Isolation', { skip: !DOCKER_AVAILABLE }, () => {
  let dockerManager;
  let pool;
  let executor;
  let tempDir;
  let botId1;
  let botId2;
  let workspace1;
  let workspace2;

  before(async () => {
    dockerManager = new DockerManager();
    pool = new ContainerPool(dockerManager);
    executor = new ToolExecutor(pool);

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-army-multi-bot-'));
    botId1 = `${TEST_PREFIX}-iso1-${Date.now()}`;
    botId2 = `${TEST_PREFIX}-iso2-${Date.now()}`;

    workspace1 = path.join(tempDir, 'bot1');
    workspace2 = path.join(tempDir, 'bot2');
    await fs.mkdir(workspace1, { recursive: true });
    await fs.mkdir(workspace2, { recursive: true });

    const botConfig1 = {
      id: botId1,
      sandbox: { image: 'alpine:latest', memory: '256m', cpus: 1 },
    };
    const botConfig2 = {
      id: botId2,
      sandbox: { image: 'alpine:latest', memory: '256m', cpus: 1 },
    };

    await pool.initializeContainer(botId1, botConfig1, { root: workspace1 });
    await pool.initializeContainer(botId2, botConfig2, { root: workspace2 });
  });

  after(async () => {
    if (pool) {
      try {
        await pool.cleanup();
      } catch {
        // Ignore cleanup errors
      }
    }

    if (dockerManager) {
      await cleanupTestContainers(dockerManager, TEST_PREFIX);
    }

    if (tempDir) {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  it('bots have isolated file systems', async () => {
    // Write different files in each bot's workspace
    await executor.writeFile('/home/agent/data.txt', 'bot1-data', botId1);
    await executor.writeFile('/home/agent/data.txt', 'bot2-data', botId2);

    // Each bot should see its own file
    const result1 = await executor.readFile('/home/agent/data.txt', botId1);
    const result2 = await executor.readFile('/home/agent/data.txt', botId2);

    assert.equal(result1.content, 'bot1-data');
    assert.equal(result2.content, 'bot2-data');
  });

  it('bots have isolated file system via host verification', async () => {
    await executor.writeFile('/home/agent/isolated.txt', 'bot1-only', botId1);
    await executor.writeFile('/home/agent/isolated.txt', 'bot2-only', botId2);

    // Verify on host filesystem
    const hostContent1 = await fs.readFile(path.join(workspace1, 'isolated.txt'), 'utf8');
    const hostContent2 = await fs.readFile(path.join(workspace2, 'isolated.txt'), 'utf8');

    assert.equal(hostContent1, 'bot1-only');
    assert.equal(hostContent2, 'bot2-only');
  });

  it('bash commands in one bot do not affect other bot', async () => {
    // Create file in bot1
    await executor.bash('echo "bot1-file" > /home/agent/exclusive.txt', botId1);

    // Bot2 should not have this file
    const result2 = await executor.readFile('/home/agent/exclusive.txt', botId2);
    assert.equal(result2.success, false);

    // Bot1 should have the file
    const result1 = await executor.readFile('/home/agent/exclusive.txt', botId1);
    assert.equal(result1.success, true);
    assert.equal(result1.content, 'bot1-file');
  });

  it('concurrent execution on different bots works correctly', async () => {
    // Execute commands on both bots concurrently
    const [result1, result2] = await Promise.all([
      executor.bash('echo "concurrent-1"', botId1),
      executor.bash('echo "concurrent-2"', botId2),
    ]);

    assert.equal(result1.success, true);
    assert.equal(result1.stdout, 'concurrent-1');
    assert.equal(result2.success, true);
    assert.equal(result2.stdout, 'concurrent-2');
  });

  it('concurrent write and read across bots', async () => {
    // Write to both bots concurrently
    await Promise.all([
      executor.writeFile('/home/agent/concurrent.txt', 'data-A', botId1),
      executor.writeFile('/home/agent/concurrent.txt', 'data-B', botId2),
    ]);

    // Read from both bots concurrently
    const [read1, read2] = await Promise.all([
      executor.readFile('/home/agent/concurrent.txt', botId1),
      executor.readFile('/home/agent/concurrent.txt', botId2),
    ]);

    assert.equal(read1.content, 'data-A');
    assert.equal(read2.content, 'data-B');
  });
});
