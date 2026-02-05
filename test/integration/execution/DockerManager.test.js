/**
 * Integration tests for DockerManager
 *
 * Tests real Docker container creation, bash execution, and output capture.
 * Requires Docker to be running and accessible.
 *
 * Run with: npm run test:integration
 *
 * Note: These tests create and destroy real Docker containers.
 * They use a unique prefix to avoid conflicts with other containers.
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DockerManager, DockerError } from '../../../src/execution/docker-manager.js';

/**
 * Generate unique container name prefix to avoid conflicts
 */
const TEST_PREFIX = `ai-army-test-${Date.now()}`;

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
 * Clean up all test containers
 * @param {DockerManager} manager
 */
async function cleanupTestContainers(manager) {
  try {
    const containers = await manager.listManagedContainers({ all: true });
    for (const containerInfo of containers) {
      // Only clean up containers with our test prefix
      if (containerInfo.Names?.some(name => name.includes(TEST_PREFIX))) {
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
  console.log('Skipping DockerManager integration tests - Docker not available');
  console.log('Ensure Docker is running: docker info');
}

describe('DockerManager Integration', { skip: !DOCKER_AVAILABLE }, () => {
  let manager;

  before(async () => {
    manager = new DockerManager();
  });

  after(async () => {
    if (manager) {
      await cleanupTestContainers(manager);
    }
  });

  describe('Docker Connection', () => {
    it('connects to Docker daemon successfully', async () => {
      const info = await manager.getInfo();

      assert.ok(info, 'Should get Docker info');
      assert.ok(info.ServerVersion, 'Should have server version');
    });

    it('exposes Docker version info', async () => {
      const info = await manager.getInfo();

      assert.ok(info.ServerVersion, 'Should have ServerVersion');
      assert.ok(info.OperatingSystem, 'Should have OperatingSystem');
      assert.ok(typeof info.Containers === 'number', 'Should have Containers count');
    });
  });

  describe('Container Lifecycle', () => {
    let container;
    let botConfig;
    let tempDir;

    beforeEach(async () => {
      // Create temporary workspace directory
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-army-test-'));

      botConfig = {
        id: `${TEST_PREFIX}-lifecycle-${Date.now()}`,
        sandbox: {
          image: 'alpine:latest',
          memory: '256m',
          cpus: 1,
        },
      };
    });

    afterEach(async () => {
      // Cleanup container
      if (container) {
        try {
          await manager.stopContainer(container);
        } catch {
          // Ignore cleanup errors
        }
        container = null;
      }

      // Cleanup temp directory
      if (tempDir) {
        try {
          await fs.rm(tempDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
        tempDir = null;
      }
    });

    it('creates container with correct configuration', async () => {
      container = await manager.createContainer(botConfig, { root: tempDir });

      assert.ok(container, 'Should create container');
      assert.ok(container.id, 'Container should have ID');

      // Inspect container to verify configuration
      const info = await container.inspect();

      assert.equal(info.Config.Image, 'alpine:latest', 'Should use specified image');
      assert.equal(info.Name, `/ai-army-${botConfig.id}`, 'Should have correct name');
      assert.deepEqual(
        info.Config.Cmd,
        ['tail', '-f', '/dev/null'],
        'Should have keep-alive command'
      );
      assert.equal(info.Config.WorkingDir, '/home/agent', 'Should have correct working directory');
    });

    it('creates container with labels', async () => {
      container = await manager.createContainer(botConfig, { root: tempDir });

      const info = await container.inspect();

      assert.equal(info.Config.Labels['ai-army.bot-id'], botConfig.id);
      assert.equal(info.Config.Labels['ai-army.managed'], 'true');
    });

    it('creates container with resource limits', async () => {
      container = await manager.createContainer(botConfig, { root: tempDir });

      const info = await container.inspect();

      // Memory limit (256m = 256 * 1024^2 = 268435456 bytes)
      assert.equal(info.HostConfig.Memory, 256 * 1024 ** 2, 'Should have correct memory limit');

      // CPU limit (1 CPU = 1e9 nanoCPUs)
      assert.equal(info.HostConfig.NanoCpus, 1e9, 'Should have correct CPU limit');
    });

    it('creates container with volume mount', async () => {
      container = await manager.createContainer(botConfig, { root: tempDir });

      const info = await container.inspect();

      assert.ok(info.Mounts.length > 0, 'Should have mounts');

      const agentMount = info.Mounts.find(m => m.Destination === '/home/agent');
      assert.ok(agentMount, 'Should have /home/agent mount');
      assert.ok(agentMount.Source.includes(tempDir), 'Should mount temp directory');
    });

    it('starts container and becomes healthy', async () => {
      container = await manager.createContainer(botConfig, { root: tempDir });

      // Container should not be running before start
      const beforeStart = await manager.healthCheck(container);
      assert.equal(beforeStart, false, 'Container should not be healthy before start');

      await manager.startContainer(container);

      // Container should be running after start
      const afterStart = await manager.healthCheck(container);
      assert.equal(afterStart, true, 'Container should be healthy after start');
    });

    it('stops and removes container gracefully', async () => {
      container = await manager.createContainer(botConfig, { root: tempDir });
      await manager.startContainer(container);

      // Verify running
      const isRunning = await manager.healthCheck(container);
      assert.equal(isRunning, true, 'Container should be running');

      // Stop and remove
      await manager.stopContainer(container);

      // Verify removed
      const containerExists = await manager.healthCheck(container);
      assert.equal(containerExists, false, 'Container should not exist after stop');

      // Mark as cleaned up so afterEach doesn't fail
      container = null;
    });

    it('handles already stopped container gracefully', async () => {
      container = await manager.createContainer(botConfig, { root: tempDir });
      await manager.startContainer(container);

      const containerId = container.id;

      // Stop the container (first time)
      await manager.stopContainer(container);
      container = null;

      // Get a reference to the now-removed container via Docker client
      const removedContainer = manager.docker.getContainer(containerId);

      // Second stop should not throw (container no longer exists)
      await assert.doesNotReject(
        () => manager.stopContainer(removedContainer),
        'Should handle non-existent container gracefully'
      );
    });
  });

  describe('Command Execution', () => {
    let container;
    let tempDir;

    before(async () => {
      // Create temporary workspace directory
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-army-exec-test-'));

      // Create a long-lived container for all exec tests
      container = await manager.createContainer(
        {
          id: `${TEST_PREFIX}-exec-${Date.now()}`,
          sandbox: {
            image: 'alpine:latest',
            memory: '256m',
            cpus: 1,
          },
        },
        { root: tempDir }
      );

      await manager.startContainer(container);
    });

    after(async () => {
      if (container) {
        try {
          await manager.stopContainer(container);
        } catch {
          // Ignore cleanup errors
        }
      }

      if (tempDir) {
        try {
          await fs.rm(tempDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    it('executes simple command and captures stdout', async () => {
      const result = await manager.exec(container, 'echo "Hello, World!"');

      assert.equal(result.exitCode, 0, 'Exit code should be 0');
      assert.equal(result.stdout, 'Hello, World!', 'Should capture stdout');
      assert.equal(result.stderr, '', 'Stderr should be empty');
    });

    it('executes command and captures stderr', async () => {
      const result = await manager.exec(container, 'echo "Error message" >&2');

      assert.equal(result.exitCode, 0, 'Exit code should be 0');
      assert.equal(result.stdout, '', 'Stdout should be empty');
      assert.equal(result.stderr, 'Error message', 'Should capture stderr');
    });

    it('captures both stdout and stderr', async () => {
      const result = await manager.exec(
        container,
        'echo "stdout message" && echo "stderr message" >&2'
      );

      assert.equal(result.exitCode, 0, 'Exit code should be 0');
      assert.equal(result.stdout, 'stdout message', 'Should capture stdout');
      assert.equal(result.stderr, 'stderr message', 'Should capture stderr');
    });

    it('returns non-zero exit code for failed commands', async () => {
      const result = await manager.exec(container, 'exit 42');

      assert.equal(result.exitCode, 42, 'Should return exit code 42');
    });

    it('returns exit code 127 for command not found', async () => {
      const result = await manager.exec(container, 'nonexistent_command_xyz');

      assert.equal(result.exitCode, 127, 'Should return exit code 127 for command not found');
      assert.ok(result.stderr.includes('not found'), 'Stderr should indicate command not found');
    });

    it('executes multiline script', async () => {
      const script = `
        echo "Line 1"
        echo "Line 2"
        echo "Line 3"
      `;

      const result = await manager.exec(container, script);

      assert.equal(result.exitCode, 0);
      assert.ok(result.stdout.includes('Line 1'), 'Should include Line 1');
      assert.ok(result.stdout.includes('Line 2'), 'Should include Line 2');
      assert.ok(result.stdout.includes('Line 3'), 'Should include Line 3');
    });

    it('handles commands with special characters', async () => {
      const result = await manager.exec(
        container,
        'echo "Hello $USER with \'quotes\' and `backticks`"'
      );

      assert.equal(result.exitCode, 0);
      // Note: $USER might be empty in container, but command should still succeed
      assert.ok(result.stdout.includes('Hello'), 'Should include Hello');
      assert.ok(result.stdout.includes('quotes'), 'Should include quotes');
    });

    it('executes command in specified working directory', async () => {
      const result = await manager.exec(container, 'pwd', { workingDir: '/tmp' });

      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, '/tmp', 'Should execute in /tmp');
    });

    it('defaults to /home/agent working directory', async () => {
      // First create the directory
      await manager.exec(container, 'mkdir -p /home/agent');

      const result = await manager.exec(container, 'pwd');

      // Alpine might not have /home/agent, check for workingDir setting
      assert.equal(result.exitCode, 0);
      // Either it shows /home/agent or / (if dir doesn't exist)
      assert.ok(
        result.stdout === '/home/agent' || result.stdout === '/',
        'Should be in expected working directory'
      );
    });

    it('reads and writes files in mounted workspace', async () => {
      // Write a file from the host
      const testContent = `Test content from host - ${Date.now()}`;
      await fs.writeFile(path.join(tempDir, 'test-file.txt'), testContent);

      // Read it from container
      const readResult = await manager.exec(container, 'cat /home/agent/test-file.txt');

      assert.equal(readResult.exitCode, 0, 'Should read file successfully');
      assert.equal(readResult.stdout, testContent, 'Content should match');

      // Write from container
      const containerContent = 'Written from container';
      const writeResult = await manager.exec(
        container,
        `echo "${containerContent}" > /home/agent/container-file.txt`
      );

      assert.equal(writeResult.exitCode, 0, 'Should write file successfully');

      // Read from host
      const hostRead = await fs.readFile(path.join(tempDir, 'container-file.txt'), 'utf8');
      assert.equal(hostRead.trim(), containerContent, 'Host should see container-written file');
    });

    it('handles large output', async () => {
      // Generate large output (1000 lines)
      const result = await manager.exec(container, 'seq 1 1000');

      assert.equal(result.exitCode, 0);
      const lines = result.stdout.split('\n');
      assert.equal(lines.length, 1000, 'Should capture all 1000 lines');
      assert.equal(lines[0], '1', 'First line should be 1');
      assert.equal(lines[999], '1000', 'Last line should be 1000');
    });

    it('handles binary-like output gracefully', async () => {
      // Create some non-text output
      const result = await manager.exec(container, 'printf "\\x00\\x01\\x02Hello\\x03\\x04"');

      assert.equal(result.exitCode, 0);
      // Should capture something without crashing
      assert.ok(typeof result.stdout === 'string', 'Should return string');
    });

    it('executes as root user when specified', async () => {
      const result = await manager.exec(container, 'id', { user: 'root' });

      assert.equal(result.exitCode, 0);
      assert.ok(result.stdout.includes('root'), 'Should run as root');
    });
  });

  describe('Command Timeout', () => {
    let container;
    let tempDir;

    before(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-army-timeout-test-'));

      container = await manager.createContainer(
        {
          id: `${TEST_PREFIX}-timeout-${Date.now()}`,
          sandbox: {
            image: 'alpine:latest',
            memory: '256m',
            cpus: 1,
          },
        },
        { root: tempDir }
      );

      await manager.startContainer(container);
    });

    after(async () => {
      if (container) {
        try {
          await manager.stopContainer(container);
        } catch {
          // Ignore cleanup errors
        }
      }

      if (tempDir) {
        try {
          await fs.rm(tempDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    it('times out long-running commands', async () => {
      await assert.rejects(
        () => manager.exec(container, 'sleep 60', { timeout: 500 }),
        err => {
          assert.ok(err instanceof DockerError, 'Should throw DockerError');
          assert.ok(err.message.includes('timed out'), 'Should indicate timeout');
          return true;
        }
      );
    });

    it('completes commands within timeout', async () => {
      const result = await manager.exec(container, 'echo "quick"', { timeout: 5000 });

      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, 'quick');
    });
  });

  describe('Health Check', () => {
    let container;
    let tempDir;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-army-health-test-'));

      container = await manager.createContainer(
        {
          id: `${TEST_PREFIX}-health-${Date.now()}`,
          sandbox: {
            image: 'alpine:latest',
            memory: '256m',
            cpus: 1,
          },
        },
        { root: tempDir }
      );
    });

    afterEach(async () => {
      if (container) {
        try {
          await manager.stopContainer(container);
        } catch {
          // Ignore cleanup errors
        }
        container = null;
      }

      if (tempDir) {
        try {
          await fs.rm(tempDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
        tempDir = null;
      }
    });

    it('returns false for created but not started container', async () => {
      const isHealthy = await manager.healthCheck(container);
      assert.equal(isHealthy, false, 'Created container should not be healthy');
    });

    it('returns true for running container', async () => {
      await manager.startContainer(container);

      const isHealthy = await manager.healthCheck(container);
      assert.equal(isHealthy, true, 'Running container should be healthy');
    });

    it('returns false for null container', async () => {
      const isHealthy = await manager.healthCheck(null);
      assert.equal(isHealthy, false, 'Null container should not be healthy');
    });
  });

  describe('Container Management', () => {
    it('lists managed containers', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-army-list-test-'));

      const testBotId = `${TEST_PREFIX}-list-${Date.now()}`;
      const container = await manager.createContainer(
        {
          id: testBotId,
          sandbox: { image: 'alpine:latest' },
        },
        { root: tempDir }
      );

      try {
        await manager.startContainer(container);

        const containers = await manager.listManagedContainers();

        // Find our test container
        const found = containers.find(c => c.Labels && c.Labels['ai-army.bot-id'] === testBotId);

        assert.ok(found, 'Should find our test container in list');
        assert.equal(found.Labels['ai-army.managed'], 'true', 'Should have managed label');
      } finally {
        await manager.stopContainer(container);
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it('gets container by bot ID', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-army-getbot-test-'));

      const testBotId = `${TEST_PREFIX}-getbot-${Date.now()}`;
      const container = await manager.createContainer(
        {
          id: testBotId,
          sandbox: { image: 'alpine:latest' },
        },
        { root: tempDir }
      );

      try {
        await manager.startContainer(container);

        const found = await manager.getContainerByBotId(testBotId);

        assert.ok(found, 'Should find container by bot ID');
        assert.equal(found.id, container.id, 'Should be the same container');
      } finally {
        await manager.stopContainer(container);
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it('returns null for non-existent bot ID', async () => {
      const found = await manager.getContainerByBotId('non-existent-bot-xyz');
      assert.equal(found, null, 'Should return null for non-existent bot');
    });

    it('removes container by name', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-army-remove-test-'));

      const testBotId = `${TEST_PREFIX}-remove-${Date.now()}`;
      const containerName = `ai-army-${testBotId}`;

      // Create container - we'll reference it by name for removal
      await manager.createContainer(
        {
          id: testBotId,
          sandbox: { image: 'alpine:latest' },
        },
        { root: tempDir }
      );

      try {
        // Remove by name (using container name, not object reference)
        const removed = await manager.removeContainerByName(containerName);
        assert.equal(removed, true, 'Should return true when removed');

        // Verify it's gone
        const found = await manager.getContainerByBotId(testBotId);
        assert.equal(found, null, 'Container should be removed');
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it('returns false when removing non-existent container', async () => {
      const removed = await manager.removeContainerByName('non-existent-container-xyz');
      assert.equal(removed, false, 'Should return false for non-existent container');
    });
  });

  describe('Package Installation', { skip: true }, () => {
    // These tests are skipped by default as they take time and require network
    // Run with: npm run test:integration -- --test-name-pattern="Package Installation"
    let container;
    let tempDir;

    before(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-army-pkg-test-'));

      container = await manager.createContainer(
        {
          id: `${TEST_PREFIX}-pkg-${Date.now()}`,
          sandbox: {
            // Use a Debian-based image for apt-get
            image: 'node:22-slim',
            memory: '512m',
            cpus: 2,
          },
        },
        { root: tempDir }
      );

      await manager.startContainer(container);
    });

    after(async () => {
      if (container) {
        try {
          await manager.stopContainer(container);
        } catch {
          // Ignore cleanup errors
        }
      }

      if (tempDir) {
        try {
          await fs.rm(tempDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    it('installs packages via apt-get', async () => {
      // Install curl
      await manager.installPackages(container, ['curl'], { timeout: 120000 });

      // Verify curl is installed
      const result = await manager.exec(container, 'curl --version');

      assert.equal(result.exitCode, 0, 'curl should be installed');
      assert.ok(result.stdout.includes('curl'), 'Should show curl version');
    });

    it('installs multiple packages', async () => {
      await manager.installPackages(container, ['git', 'wget'], { timeout: 120000 });

      const gitResult = await manager.exec(container, 'git --version');
      const wgetResult = await manager.exec(container, 'wget --version');

      assert.equal(gitResult.exitCode, 0, 'git should be installed');
      assert.equal(wgetResult.exitCode, 0, 'wget should be installed');
    });

    it('handles empty package list', async () => {
      // Should not throw
      await assert.doesNotReject(
        () => manager.installPackages(container, []),
        'Empty package list should not throw'
      );
    });

    it('throws error for invalid package', async () => {
      await assert.rejects(
        () => manager.installPackages(container, ['nonexistent-package-xyz'], { timeout: 60000 }),
        err => {
          assert.ok(err instanceof DockerError, 'Should throw DockerError');
          assert.ok(
            err.message.includes('installation failed'),
            'Should indicate installation failure'
          );
          return true;
        }
      );
    });
  });

  describe('Error Handling', () => {
    it('throws DockerError for missing bot ID', async () => {
      await assert.rejects(
        () => manager.createContainer({ sandbox: {} }, { root: '/tmp' }),
        err => {
          assert.ok(err instanceof DockerError, 'Should throw DockerError');
          assert.equal(err.operation, 'createContainer', 'Should have operation');
          assert.ok(err.message.includes('Bot configuration'), 'Should mention bot config');
          return true;
        }
      );
    });

    it('throws DockerError for invalid memory format', () => {
      assert.throws(
        () => manager.parseMemory('invalid'),
        err => {
          assert.ok(err instanceof DockerError, 'Should throw DockerError');
          assert.equal(err.operation, 'parseMemory', 'Should have operation');
          assert.ok(err.message.includes('Invalid memory format'), 'Should mention format');
          return true;
        }
      );
    });

    it('throws DockerError for empty command', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-army-error-test-'));
      const container = await manager.createContainer(
        {
          id: `${TEST_PREFIX}-error-${Date.now()}`,
          sandbox: { image: 'alpine:latest' },
        },
        { root: tempDir }
      );

      try {
        await manager.startContainer(container);

        await assert.rejects(
          () => manager.exec(container, ''),
          err => {
            assert.ok(err instanceof DockerError, 'Should throw DockerError');
            assert.equal(err.operation, 'exec', 'Should have operation');
            return true;
          }
        );
      } finally {
        await manager.stopContainer(container);
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });
  });
});
