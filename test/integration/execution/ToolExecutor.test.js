/**
 * Integration tests for ToolExecutor
 *
 * Tests real tool execution in Docker containers via ContainerPool.
 * Covers bash execution, file operations, security checks, and error handling.
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

  describe('bash()', () => {
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
  });

  describe('readFile()', () => {
    it('reads file content from container workspace', async () => {
      // Create a test file on the host
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
  });

  describe('writeFile()', () => {
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
  });

  describe('executeTool() routing', () => {
    it('routes bash tool correctly', async () => {
      const result = await executor.executeTool('bash', { command: 'echo "routed"' }, botId);

      assert.equal(result.success, true);
      assert.equal(result.stdout, 'routed');
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
          return true;
        }
      );
    });
  });

  describe('Security - Dangerous Commands', () => {
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

    it('blocks writing to disk device', async () => {
      await assert.rejects(
        () => executor.bash('echo data > /dev/sda', botId),
        err => {
          assert.ok(err instanceof DangerousCommandError);
          return true;
        }
      );
    });

    it('blocks chmod 777 /', async () => {
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

    it('isDangerousCommand is consistent with bash() behavior', () => {
      // These should be dangerous
      assert.equal(executor.isDangerousCommand('rm -rf /'), true);
      assert.equal(executor.isDangerousCommand(':() { :|:& };:'), true);
      assert.equal(executor.isDangerousCommand('mkfs.ext4 /dev/sda1'), true);

      // These should be safe
      assert.equal(executor.isDangerousCommand('ls -la'), false);
      assert.equal(executor.isDangerousCommand('echo hello'), false);
      assert.equal(executor.isDangerousCommand('rm -rf /home/agent/temp'), false);
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
  });
});
