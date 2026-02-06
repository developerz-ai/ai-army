/**
 * Integration tests for BashTool (Vercel AI SDK tool)
 *
 * Tests the createBashTool factory function with real Docker containers
 * via ContainerPool and DockerManager. Covers bash command execution,
 * security blocking (dangerous patterns), output truncation, timeout
 * handling, error propagation, and multi-bot isolation.
 *
 * Run with: npm run test:integration:docker
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
import { createBashTool, isDangerousCommand, BashToolError } from '../../../src/tools/bash-tool.js';

/**
 * Generate unique container name prefix to avoid conflicts
 */
const TEST_PREFIX = `ai-army-bash-tool-test-${Date.now()}`;

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
  console.log('Skipping BashTool integration tests - Docker not available');
  console.log('Ensure Docker is running: docker info');
}

describe('BashTool Integration', { skip: !DOCKER_AVAILABLE }, () => {
  let dockerManager;
  let pool;
  let bashTool;
  let tempDir;
  let botId;

  before(async () => {
    dockerManager = new DockerManager();
    pool = new ContainerPool(dockerManager);

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-army-bash-tool-test-'));
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

    // Create the Vercel AI SDK bash tool
    bashTool = createBashTool(pool, botId);
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

  describe('Bash Command Execution', () => {
    it('executes echo command and returns stdout', async () => {
      const result = await bashTool.execute({ command: 'echo "hello world"' });

      assert.equal(result.success, true);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, 'hello world');
      assert.equal(result.stderr, '');
    });

    it('returns correct exit code for successful command', async () => {
      const result = await bashTool.execute({ command: 'true' });

      assert.equal(result.success, true);
      assert.equal(result.exitCode, 0);
    });

    it('returns correct exit code for failed command', async () => {
      const result = await bashTool.execute({ command: 'exit 42' });

      assert.equal(result.success, false);
      assert.equal(result.exitCode, 42);
    });

    it('captures stderr for failed commands', async () => {
      const result = await bashTool.execute({ command: 'cat /nonexistent-file-xyz' });

      assert.equal(result.success, false);
      assert.notEqual(result.exitCode, 0);
      assert.ok(result.stderr.length > 0, 'Should have stderr output');
    });

    it('captures both stdout and stderr', async () => {
      const result = await bashTool.execute({
        command: 'echo "output" && echo "error" >&2',
      });

      assert.ok(result.stdout.includes('output'));
      assert.ok(result.stderr.includes('error'));
    });

    it('executes multi-line scripts', async () => {
      const result = await bashTool.execute({
        command: 'echo "line1"\necho "line2"\necho "line3"',
      });

      assert.equal(result.success, true);
      assert.ok(result.stdout.includes('line1'));
      assert.ok(result.stdout.includes('line2'));
      assert.ok(result.stdout.includes('line3'));
    });

    it('handles piped commands', async () => {
      const result = await bashTool.execute({
        command: 'echo "hello world" | tr a-z A-Z',
      });

      assert.equal(result.success, true);
      assert.equal(result.stdout.trim(), 'HELLO WORLD');
    });

    it('handles command substitution', async () => {
      const result = await bashTool.execute({
        command: 'echo "count: $(echo 42)"',
      });

      assert.equal(result.success, true);
      assert.equal(result.stdout.trim(), 'count: 42');
    });

    it('handles compound commands with &&', async () => {
      const result = await bashTool.execute({
        command: 'echo "a" && echo "b"',
      });

      assert.equal(result.success, true);
      assert.ok(result.stdout.includes('a'));
      assert.ok(result.stdout.includes('b'));
    });

    it('handles for loops', async () => {
      const result = await bashTool.execute({
        command: 'for i in 1 2 3; do echo $i; done',
      });

      assert.equal(result.success, true);
      assert.ok(result.stdout.includes('1'));
      assert.ok(result.stdout.includes('2'));
      assert.ok(result.stdout.includes('3'));
    });

    it('handles environment variables', async () => {
      const result = await bashTool.execute({ command: 'echo $HOME' });

      assert.equal(result.success, true);
      assert.ok(result.stdout.trim().length > 0);
    });

    it('handles special characters in output', async () => {
      const result = await bashTool.execute({
        command: 'echo "hello <world> & $HOME"',
      });

      assert.equal(result.success, true);
      assert.ok(result.stdout.includes('hello'));
    });

    it('handles commands with nonexistent executables', async () => {
      const result = await bashTool.execute({
        command: 'totally-nonexistent-command-xyz',
      });

      assert.equal(result.success, false);
      assert.ok(result.stderr.length > 0 || result.exitCode !== 0);
    });
  });

  describe('File System Interaction via Bash', () => {
    it('creates and reads files in the workspace', async () => {
      await bashTool.execute({
        command: 'echo "bash-created" > /home/agent/bash-test.txt',
      });

      const result = await bashTool.execute({
        command: 'cat /home/agent/bash-test.txt',
      });

      assert.equal(result.success, true);
      assert.equal(result.stdout.trim(), 'bash-created');
    });

    it('workspace files are visible on host', async () => {
      await bashTool.execute({
        command: 'echo "host-visible" > /home/agent/host-check.txt',
      });

      const hostContent = await fs.readFile(path.join(tempDir, 'host-check.txt'), 'utf8');
      assert.equal(hostContent.trim(), 'host-visible');
    });

    it('host files are visible in the container', async () => {
      await fs.writeFile(path.join(tempDir, 'from-host.txt'), 'written-by-host');

      const result = await bashTool.execute({
        command: 'cat /home/agent/from-host.txt',
      });

      assert.equal(result.success, true);
      assert.equal(result.stdout.trim(), 'written-by-host');
    });

    it('creates directories in the workspace', async () => {
      await bashTool.execute({
        command: 'mkdir -p /home/agent/nested/dir && echo "deep" > /home/agent/nested/dir/file.txt',
      });

      const result = await bashTool.execute({
        command: 'cat /home/agent/nested/dir/file.txt',
      });

      assert.equal(result.success, true);
      assert.equal(result.stdout.trim(), 'deep');
    });

    it('lists directory contents', async () => {
      await fs.writeFile(path.join(tempDir, 'list-test.txt'), 'data');

      const result = await bashTool.execute({ command: 'ls /home/agent/' });

      assert.equal(result.success, true);
      assert.ok(result.stdout.includes('list-test.txt'));
    });
  });

  describe('Security - Dangerous Command Blocking', () => {
    it('blocks rm -rf /', async () => {
      const result = await bashTool.execute({ command: 'rm -rf /' });

      assert.equal(result.success, false);
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, /blocked by security policy/i);
      assert.equal(result.stdout, '');
    });

    it('blocks rm -rf / with trailing space', async () => {
      const result = await bashTool.execute({ command: 'rm -rf / ' });

      assert.equal(result.success, false);
      assert.match(result.stderr, /blocked by security policy/i);
    });

    it('blocks --no-preserve-root', async () => {
      const result = await bashTool.execute({
        command: 'rm -rf --no-preserve-root /',
      });

      assert.equal(result.success, false);
      assert.match(result.stderr, /blocked by security policy/i);
    });

    it('blocks fork bomb', async () => {
      const result = await bashTool.execute({ command: ':() { : | : & } ; :' });

      assert.equal(result.success, false);
      assert.match(result.stderr, /blocked by security policy/i);
    });

    it('blocks write to /dev/sda', async () => {
      const result = await bashTool.execute({ command: 'echo data > /dev/sda' });

      assert.equal(result.success, false);
      assert.match(result.stderr, /blocked by security policy/i);
    });

    it('blocks write to /dev/nvme device', async () => {
      const result = await bashTool.execute({ command: 'echo data > /dev/nvme0n1' });

      assert.equal(result.success, false);
      assert.match(result.stderr, /blocked by security policy/i);
    });

    it('blocks mkfs commands', async () => {
      const result = await bashTool.execute({ command: 'mkfs.ext4 /dev/sda1' });

      assert.equal(result.success, false);
      assert.match(result.stderr, /blocked by security policy/i);
    });

    it('blocks mkfs.xfs commands', async () => {
      const result = await bashTool.execute({ command: 'mkfs.xfs /dev/sdb1' });

      assert.equal(result.success, false);
      assert.match(result.stderr, /blocked by security policy/i);
    });

    it('blocks dd to device', async () => {
      const result = await bashTool.execute({
        command: 'dd if=/dev/zero of=/dev/sda bs=512 count=1',
      });

      assert.equal(result.success, false);
      assert.match(result.stderr, /blocked by security policy/i);
    });

    it('blocks chmod -R 777 /', async () => {
      const result = await bashTool.execute({ command: 'chmod -R 777 /' });

      assert.equal(result.success, false);
      assert.match(result.stderr, /blocked by security policy/i);
    });

    it('does not execute blocked commands (docker exec not called)', async () => {
      // The blocked command should never reach Docker.
      // We verify this indirectly: if rm -rf / actually executed,
      // the container would be destroyed. It should remain functional.
      const blockResult = await bashTool.execute({ command: 'rm -rf /' });
      assert.equal(blockResult.success, false);

      // Container is still alive after blocked command
      const aliveResult = await bashTool.execute({ command: 'echo "still alive"' });
      assert.equal(aliveResult.success, true);
      assert.ok(aliveResult.stdout.includes('still alive'));
    });

    it('blocked result has standard shape (success, exitCode, stdout, stderr)', async () => {
      const result = await bashTool.execute({ command: 'rm -rf /' });

      assert.equal(typeof result.success, 'boolean');
      assert.equal(typeof result.exitCode, 'number');
      assert.equal(typeof result.stdout, 'string');
      assert.equal(typeof result.stderr, 'string');
    });

    it('allows safe rm commands on subdirectories', async () => {
      await fs.mkdir(path.join(tempDir, 'delete-me'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'delete-me', 'temp.txt'), 'temp');

      const result = await bashTool.execute({
        command: 'rm -rf /home/agent/delete-me',
      });

      assert.equal(result.success, true);
    });

    it('allows normal ls command', async () => {
      const result = await bashTool.execute({ command: 'ls -la /home/agent' });

      assert.equal(result.success, true);
      assert.ok(result.stdout.length > 0);
    });

    it('allows echo command', async () => {
      const result = await bashTool.execute({ command: 'echo "safe"' });

      assert.equal(result.success, true);
      assert.ok(result.stdout.includes('safe'));
    });

    it('allows cat command on workspace files', async () => {
      await fs.writeFile(path.join(tempDir, 'safe-read.txt'), 'safe-content');

      const result = await bashTool.execute({
        command: 'cat /home/agent/safe-read.txt',
      });

      assert.equal(result.success, true);
      assert.equal(result.stdout.trim(), 'safe-content');
    });

    it('allows rm without -rf on root', async () => {
      await fs.writeFile(path.join(tempDir, 'single-delete.txt'), 'temp');

      const result = await bashTool.execute({
        command: 'rm /home/agent/single-delete.txt',
      });

      assert.equal(result.success, true);
    });

    it('allows chmod on specific directories (not /)', async () => {
      await fs.mkdir(path.join(tempDir, 'chmod-safe'), { recursive: true });

      const result = await bashTool.execute({
        command: 'chmod -R 755 /home/agent/chmod-safe',
      });

      assert.equal(result.success, true);
    });

    it('allows dd to file (not device)', async () => {
      const result = await bashTool.execute({
        command: 'dd if=/dev/zero of=/home/agent/test.img bs=1024 count=1 2>/dev/null',
      });

      assert.equal(result.success, true);

      // Cleanup
      await bashTool.execute({ command: 'rm -f /home/agent/test.img' });
    });

    it('isDangerousCommand utility is consistent with tool behavior', () => {
      // Dangerous commands
      assert.equal(isDangerousCommand('rm -rf /'), true);
      assert.equal(isDangerousCommand(':() { : | : & } ; :'), true);
      assert.equal(isDangerousCommand('mkfs.ext4 /dev/sda1'), true);
      assert.equal(isDangerousCommand('dd if=/dev/zero of=/dev/sda'), true);
      assert.equal(isDangerousCommand('echo data > /dev/sda'), true);
      assert.equal(isDangerousCommand('chmod -R 777 /'), true);

      // Safe commands
      assert.equal(isDangerousCommand('ls -la'), false);
      assert.equal(isDangerousCommand('echo hello'), false);
      assert.equal(isDangerousCommand('rm -rf /home/agent/temp'), false);
      assert.equal(isDangerousCommand('cat /etc/hostname'), false);
      assert.equal(isDangerousCommand('npm install'), false);
    });
  });

  describe('Timeout Handling', () => {
    it('completes fast commands within default timeout', async () => {
      const result = await bashTool.execute({ command: 'echo "fast"' });

      assert.equal(result.success, true);
      assert.ok(result.stdout.includes('fast'));
    });

    it('respects per-command timeout parameter', async () => {
      const result = await bashTool.execute({
        command: 'echo "quick"',
        timeout: 5000,
      });

      assert.equal(result.success, true);
      assert.ok(result.stdout.includes('quick'));
    });

    it('returns error result on timeout (does not throw)', async () => {
      const result = await bashTool.execute({
        command: 'sleep 60',
        timeout: 1000,
      });

      // BashTool returns error results instead of throwing
      assert.equal(result.success, false);
      assert.equal(result.exitCode, 1);
      assert.ok(result.stderr.length > 0);
    });

    it('container remains usable after timeout', async () => {
      // Trigger a timeout
      await bashTool.execute({ command: 'sleep 60', timeout: 1000 });

      // Container should still work
      const result = await bashTool.execute({ command: 'echo "recovered"' });

      assert.equal(result.success, true);
      assert.ok(result.stdout.includes('recovered'));
    });
  });

  describe('Output Truncation', () => {
    it('does not truncate short output', async () => {
      const result = await bashTool.execute({ command: 'echo "short"' });

      assert.ok(!result.stdout.includes('truncated'));
    });

    it('does not truncate output under default limit', async () => {
      const result = await bashTool.execute({
        command: 'yes "line" | head -n 100',
      });

      assert.equal(result.success, true);
      assert.ok(!result.stdout.includes('truncated'));
    });

    it('truncates very large stdout', async () => {
      // Generate output > 50KB (default MAX_STDOUT_LENGTH)
      const result = await bashTool.execute({
        command: 'yes "xxxxxxxxxx" | head -n 10000',
      });

      assert.equal(result.success, true);
      assert.ok(result.stdout.includes('truncated'));
    });

    it('custom maxStdoutLength truncates at lower threshold', async () => {
      const shortTool = createBashTool(pool, botId, { maxStdoutLength: 100 });

      const result = await shortTool.execute({
        command: 'yes "abcdefghij" | head -n 50',
      });

      assert.equal(result.success, true);
      assert.ok(result.stdout.includes('truncated'));
      assert.ok(result.stdout.length < 500);
    });

    it('custom maxStderrLength truncates stderr', async () => {
      const shortTool = createBashTool(pool, botId, { maxStderrLength: 50 });

      // Generate long stderr
      const result = await shortTool.execute({
        command: 'for i in $(seq 1 100); do echo "error line $i" >&2; done; exit 1',
      });

      assert.equal(result.success, false);
      assert.ok(result.stderr.includes('truncated'));
    });
  });

  describe('Tool Configuration', () => {
    it('accepts custom timeout in toolConfig', async () => {
      const customTool = createBashTool(pool, botId, { timeout: 5000 });

      const result = await customTool.execute({ command: 'echo "custom timeout"' });

      assert.equal(result.success, true);
      assert.ok(result.stdout.includes('custom timeout'));
    });

    it('per-command timeout overrides toolConfig timeout', async () => {
      // toolConfig has short timeout, but per-command timeout is longer
      const shortTimeoutTool = createBashTool(pool, botId, { timeout: 500 });

      // This would fail with 500ms timeout but should succeed with 10s override
      const result = await shortTimeoutTool.execute({
        command: 'sleep 1 && echo "done"',
        timeout: 10000,
      });

      assert.equal(result.success, true);
      assert.ok(result.stdout.includes('done'));
    });
  });

  describe('Error Handling', () => {
    it('returns error result when container does not exist', async () => {
      const invalidTool = createBashTool(pool, 'nonexistent-bot-id');
      const result = await invalidTool.execute({ command: 'echo hi' });

      assert.equal(result.success, false);
      assert.equal(result.exitCode, 1);
      assert.ok(result.stderr.includes('Execution error'));
    });

    it('result shape is consistent for all outcomes', async () => {
      // Success case
      const successResult = await bashTool.execute({ command: 'echo ok' });
      assert.ok('success' in successResult);
      assert.ok('exitCode' in successResult);
      assert.ok('stdout' in successResult);
      assert.ok('stderr' in successResult);

      // Failure case (exit code != 0)
      const failResult = await bashTool.execute({ command: 'exit 1' });
      assert.ok('success' in failResult);
      assert.ok('exitCode' in failResult);
      assert.ok('stdout' in failResult);
      assert.ok('stderr' in failResult);

      // Security blocked case
      const blockedResult = await bashTool.execute({ command: 'rm -rf /' });
      assert.ok('success' in blockedResult);
      assert.ok('exitCode' in blockedResult);
      assert.ok('stdout' in blockedResult);
      assert.ok('stderr' in blockedResult);
    });

    it('never throws from execute (always returns result object)', async () => {
      const invalidTool = createBashTool(pool, 'totally-fake-bot');

      // Should not throw - returns error result
      const result = await invalidTool.execute({ command: 'echo test' });
      assert.equal(result.success, false);
      assert.equal(typeof result.stderr, 'string');
    });

    it('throws BashToolError from factory with invalid args', () => {
      assert.throws(
        () => createBashTool(null, 'test-bot'),
        err => {
          assert.ok(err instanceof BashToolError);
          assert.match(err.message, /ContainerPool is required/);
          return true;
        }
      );

      assert.throws(
        () => createBashTool(pool, ''),
        err => {
          assert.ok(err instanceof BashToolError);
          assert.match(err.message, /Bot ID must be a non-empty string/);
          return true;
        }
      );

      assert.throws(
        () => createBashTool(pool, null),
        err => {
          assert.ok(err instanceof BashToolError);
          return true;
        }
      );
    });
  });

  describe('Vercel AI SDK Compatibility', () => {
    it('has description property', () => {
      assert.ok(bashTool.description);
      assert.equal(typeof bashTool.description, 'string');
      assert.match(bashTool.description, /bash|command|execute/i);
    });

    it('has parameters (Zod schema) property', () => {
      assert.ok(bashTool.parameters);

      // Validate valid input
      const valid = bashTool.parameters.safeParse({ command: 'echo test' });
      assert.equal(valid.success, true);

      // Validate invalid input (missing command)
      const invalid = bashTool.parameters.safeParse({});
      assert.equal(invalid.success, false);
    });

    it('has execute function', () => {
      assert.equal(typeof bashTool.execute, 'function');
    });

    it('parameters schema accepts optional timeout', () => {
      const result = bashTool.parameters.safeParse({
        command: 'echo test',
        timeout: 5000,
      });
      assert.equal(result.success, true);
      assert.equal(result.data.timeout, 5000);
    });

    it('parameters schema rejects non-string command', () => {
      const result = bashTool.parameters.safeParse({ command: 42 });
      assert.equal(result.success, false);
    });

    it('parameters schema rejects non-number timeout', () => {
      const result = bashTool.parameters.safeParse({
        command: 'echo test',
        timeout: 'fast',
      });
      assert.equal(result.success, false);
    });
  });

  describe('Sequential Command Workflow', () => {
    it('write → process → read roundtrip', async () => {
      // Write a file
      await bashTool.execute({
        command: 'echo "hello world" > /home/agent/workflow-input.txt',
      });

      // Process file with bash
      const processResult = await bashTool.execute({
        command: 'cat /home/agent/workflow-input.txt | tr a-z A-Z',
      });
      assert.equal(processResult.success, true);

      // Write processed result
      await bashTool.execute({
        command: `echo "${processResult.stdout.trim()}" > /home/agent/workflow-output.txt`,
      });

      // Read result
      const readResult = await bashTool.execute({
        command: 'cat /home/agent/workflow-output.txt',
      });
      assert.equal(readResult.success, true);
      assert.equal(readResult.stdout.trim(), 'HELLO WORLD');
    });

    it('handles multiple sequential commands maintaining state', async () => {
      // Create a counter file
      await bashTool.execute({ command: 'echo "0" > /home/agent/counter.txt' });

      // Increment it multiple times
      for (let i = 1; i <= 3; i++) {
        await bashTool.execute({
          command: `echo "${i}" > /home/agent/counter.txt`,
        });
      }

      // Verify final state
      const result = await bashTool.execute({ command: 'cat /home/agent/counter.txt' });
      assert.equal(result.success, true);
      assert.equal(result.stdout.trim(), '3');
    });
  });
});

describe('BashTool Multi-Bot Isolation', { skip: !DOCKER_AVAILABLE }, () => {
  let dockerManager;
  let pool;
  let toolBotA;
  let toolBotB;
  let tempDir;
  let botIdA;
  let botIdB;
  let workspaceA;
  let workspaceB;

  before(async () => {
    dockerManager = new DockerManager();
    pool = new ContainerPool(dockerManager);

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-army-bash-multi-'));
    botIdA = `${TEST_PREFIX}-botA-${Date.now()}`;
    botIdB = `${TEST_PREFIX}-botB-${Date.now()}`;

    workspaceA = path.join(tempDir, 'botA');
    workspaceB = path.join(tempDir, 'botB');
    await fs.mkdir(workspaceA, { recursive: true });
    await fs.mkdir(workspaceB, { recursive: true });

    const botConfigA = {
      id: botIdA,
      sandbox: { image: 'alpine:latest', memory: '256m', cpus: 1 },
    };
    const botConfigB = {
      id: botIdB,
      sandbox: { image: 'alpine:latest', memory: '256m', cpus: 1 },
    };

    await pool.initializeContainer(botIdA, botConfigA, { root: workspaceA });
    await pool.initializeContainer(botIdB, botConfigB, { root: workspaceB });

    toolBotA = createBashTool(pool, botIdA);
    toolBotB = createBashTool(pool, botIdB);
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
    await toolBotA.execute({ command: 'echo "botA-data" > /home/agent/data.txt' });
    await toolBotB.execute({ command: 'echo "botB-data" > /home/agent/data.txt' });

    // Each bot should see its own file
    const resultA = await toolBotA.execute({ command: 'cat /home/agent/data.txt' });
    const resultB = await toolBotB.execute({ command: 'cat /home/agent/data.txt' });

    assert.equal(resultA.stdout.trim(), 'botA-data');
    assert.equal(resultB.stdout.trim(), 'botB-data');
  });

  it('files created by one bot are not visible to another', async () => {
    await toolBotA.execute({
      command: 'echo "exclusive" > /home/agent/exclusive.txt',
    });

    const resultB = await toolBotB.execute({
      command: 'cat /home/agent/exclusive.txt',
    });

    assert.equal(resultB.success, false);
    assert.ok(resultB.stderr.length > 0 || resultB.exitCode !== 0);
  });

  it('host workspaces are isolated', async () => {
    await toolBotA.execute({
      command: 'echo "host-A" > /home/agent/host-check.txt',
    });
    await toolBotB.execute({
      command: 'echo "host-B" > /home/agent/host-check.txt',
    });

    const hostA = await fs.readFile(path.join(workspaceA, 'host-check.txt'), 'utf8');
    const hostB = await fs.readFile(path.join(workspaceB, 'host-check.txt'), 'utf8');

    assert.equal(hostA.trim(), 'host-A');
    assert.equal(hostB.trim(), 'host-B');
  });

  it('concurrent execution on different bots works correctly', async () => {
    const [resultA, resultB] = await Promise.all([
      toolBotA.execute({ command: 'echo "concurrent-A"' }),
      toolBotB.execute({ command: 'echo "concurrent-B"' }),
    ]);

    assert.equal(resultA.success, true);
    assert.ok(resultA.stdout.includes('concurrent-A'));
    assert.equal(resultB.success, true);
    assert.ok(resultB.stdout.includes('concurrent-B'));
  });

  it('concurrent write and read across bots', async () => {
    await Promise.all([
      toolBotA.execute({ command: 'echo "data-A" > /home/agent/concurrent.txt' }),
      toolBotB.execute({ command: 'echo "data-B" > /home/agent/concurrent.txt' }),
    ]);

    const [readA, readB] = await Promise.all([
      toolBotA.execute({ command: 'cat /home/agent/concurrent.txt' }),
      toolBotB.execute({ command: 'cat /home/agent/concurrent.txt' }),
    ]);

    assert.equal(readA.stdout.trim(), 'data-A');
    assert.equal(readB.stdout.trim(), 'data-B');
  });

  it('tools for different bots are independent instances', () => {
    // Each tool is created from the factory independently
    assert.ok(toolBotA !== toolBotB);
    assert.ok(toolBotA.description === toolBotB.description);
    assert.equal(typeof toolBotA.execute, 'function');
    assert.equal(typeof toolBotB.execute, 'function');
  });
});
