/**
 * Integration tests for IncusBackend
 *
 * Tests real Incus container creation, bash execution, and output capture.
 * Requires Incus to be running and accessible via Unix socket.
 *
 * Run with: npm run test:integration
 *
 * Note: These tests create and destroy real Incus containers.
 * They use a unique prefix to avoid conflicts with other containers.
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { IncusBackend } from '../../../src/execution/incus-backend.js';
import { ContainerBackendError } from '../../../src/execution/container-backend.js';

/**
 * Generate unique container name prefix to avoid conflicts
 */
const TEST_PREFIX = `ai-army-incus-test-${Date.now()}`;

/**
 * Check if Incus is available
 * @returns {Promise<boolean>}
 */
async function checkIncusAvailable() {
  const backend = new IncusBackend();
  try {
    await backend.getInfo();
    return true;
  } catch {
    return false;
  }
}

/**
 * Clean up all test containers
 * @param {IncusBackend} backend
 */
async function cleanupTestContainers(backend) {
  try {
    const containers = await backend.listManagedContainers({ all: true });
    for (const containerInfo of containers) {
      // Only clean up containers with our test prefix
      if (containerInfo.name?.includes(TEST_PREFIX)) {
        try {
          await backend.removeContainerByName(containerInfo.name);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}

// Check Incus availability at module load
const INCUS_AVAILABLE = await checkIncusAvailable();

if (!INCUS_AVAILABLE) {
  console.log('Skipping IncusBackend integration tests - Incus not available');
  console.log('Ensure Incus is running: incus version');
}

describe('IncusBackend Integration', { skip: !INCUS_AVAILABLE }, () => {
  let backend;

  before(async () => {
    backend = new IncusBackend();
  });

  after(async () => {
    if (backend) {
      await cleanupTestContainers(backend);
    }
  });

  describe('Incus Connection', () => {
    it('connects to Incus daemon successfully', async () => {
      const info = await backend.getInfo();

      assert.ok(info, 'Should get Incus info');
      assert.ok(info.environment, 'Should have environment info');
    });

    it('exposes Incus server info', async () => {
      const info = await backend.getInfo();

      assert.ok(info.environment, 'Should have environment');
      assert.ok(info.environment.server_version, 'Should have server version');
    });
  });

  describe('Container Lifecycle', () => {
    let container;
    let botConfig;
    let tempDir;

    beforeEach(async () => {
      // Create temporary workspace directory
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-army-incus-test-'));

      botConfig = {
        id: `${TEST_PREFIX}-lifecycle-${Date.now()}`,
        sandbox: {
          // Use Alpine for speed (small image, fast boot)
          incusImage: 'images:alpine/3.20',
          memory: '256MB',
          cpus: 1,
        },
      };
    });

    afterEach(async () => {
      // Cleanup container
      if (container) {
        try {
          await backend.stopContainer(container);
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
      container = await backend.createContainer(botConfig, { root: tempDir });

      assert.ok(container, 'Should create container');
      assert.ok(container.name, 'Container should have name');
      assert.ok(container.id, 'Container should have ID');

      // Verify container exists in the list
      const containers = await backend.listManagedContainers();
      const found = containers.find(c => c.name === container.name);
      assert.ok(found, 'Container should be in managed list');
      assert.equal(found.config?.['user.ai-army.bot-id'], botConfig.id);
      assert.equal(found.config?.['user.ai-army.managed'], 'true');
    });

    it('creates container with resource limits', async () => {
      container = await backend.createContainer(botConfig, { root: tempDir });

      const containers = await backend.listManagedContainers();
      const found = containers.find(c => c.name === container.name);

      assert.equal(found.config?.['limits.memory'], '256MB', 'Should have memory limit');
      assert.equal(found.config?.['limits.cpu'], '1', 'Should have CPU limit');
    });

    it('starts container and becomes healthy', async () => {
      container = await backend.createContainer(botConfig, { root: tempDir });

      // Container should not be running before start
      const beforeStart = await backend.healthCheck(container);
      assert.equal(beforeStart, false, 'Container should not be healthy before start');

      await backend.startContainer(container);

      // Container should be running after start
      const afterStart = await backend.healthCheck(container);
      assert.equal(afterStart, true, 'Container should be healthy after start');
    });

    it('stops and removes container gracefully', async () => {
      container = await backend.createContainer(botConfig, { root: tempDir });
      await backend.startContainer(container);

      // Verify running
      const isRunning = await backend.healthCheck(container);
      assert.equal(isRunning, true, 'Container should be running');

      // Stop and remove
      await backend.stopContainer(container);

      // Verify removed
      const containerExists = await backend.healthCheck(container);
      assert.equal(containerExists, false, 'Container should not exist after stop');

      // Mark as cleaned up so afterEach doesn't fail
      container = null;
    });

    it('handles already stopped container gracefully', async () => {
      container = await backend.createContainer(botConfig, { root: tempDir });
      await backend.startContainer(container);

      const containerName = container.name;

      // Stop the container (first time)
      await backend.stopContainer(container);
      container = null;

      // Get a reference to the now-removed container
      const removedContainer = { name: containerName, id: containerName };

      // Second stop should not throw (container no longer exists)
      await assert.doesNotReject(
        () => backend.stopContainer(removedContainer),
        'Should handle non-existent container gracefully'
      );
    });
  });

  describe('Command Execution', () => {
    let container;
    let tempDir;

    before(async () => {
      // Create temporary workspace directory
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-army-incus-exec-test-'));

      // Create a long-lived container for all exec tests
      container = await backend.createContainer(
        {
          id: `${TEST_PREFIX}-exec-${Date.now()}`,
          sandbox: {
            incusImage: 'images:alpine/3.20',
            memory: '256MB',
            cpus: 1,
          },
        },
        { root: tempDir }
      );

      await backend.startContainer(container);
    });

    after(async () => {
      if (container) {
        try {
          await backend.stopContainer(container);
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
      const result = await backend.exec(container, 'echo "Hello, World!"');

      assert.equal(result.exitCode, 0, 'Exit code should be 0');
      assert.equal(result.stdout, 'Hello, World!', 'Should capture stdout');
      assert.equal(result.stderr, '', 'Stderr should be empty');
    });

    it('executes command and captures stderr', async () => {
      const result = await backend.exec(container, 'echo "Error message" >&2');

      assert.equal(result.exitCode, 0, 'Exit code should be 0');
      assert.equal(result.stdout, '', 'Stdout should be empty');
      assert.equal(result.stderr, 'Error message', 'Should capture stderr');
    });

    it('captures both stdout and stderr', async () => {
      const result = await backend.exec(
        container,
        'echo "stdout message" && echo "stderr message" >&2'
      );

      assert.equal(result.exitCode, 0, 'Exit code should be 0');
      assert.equal(result.stdout, 'stdout message', 'Should capture stdout');
      assert.equal(result.stderr, 'stderr message', 'Should capture stderr');
    });

    it('returns non-zero exit code for failed commands', async () => {
      const result = await backend.exec(container, 'exit 42');

      assert.equal(result.exitCode, 42, 'Should return exit code 42');
    });

    it('returns exit code 127 for command not found', async () => {
      const result = await backend.exec(container, 'nonexistent_command_xyz');

      assert.equal(result.exitCode, 127, 'Should return exit code 127 for command not found');
      assert.ok(result.stderr.includes('not found'), 'Stderr should indicate command not found');
    });

    it('executes multiline script', async () => {
      const script = `
        echo "Line 1"
        echo "Line 2"
        echo "Line 3"
      `;

      const result = await backend.exec(container, script);

      assert.equal(result.exitCode, 0);
      assert.ok(result.stdout.includes('Line 1'), 'Should include Line 1');
      assert.ok(result.stdout.includes('Line 2'), 'Should include Line 2');
      assert.ok(result.stdout.includes('Line 3'), 'Should include Line 3');
    });

    it('handles commands with special characters', async () => {
      const result = await backend.exec(
        container,
        'echo "Hello $USER with \'quotes\' and `backticks`"'
      );

      assert.equal(result.exitCode, 0);
      // Note: $USER might be root or empty in container
      assert.ok(result.stdout.includes('Hello'), 'Should include Hello');
      assert.ok(result.stdout.includes('quotes'), 'Should include quotes');
    });

    it('executes command in specified working directory', async () => {
      const result = await backend.exec(container, 'pwd', { workingDir: '/tmp' });

      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, '/tmp', 'Should execute in /tmp');
    });

    it('defaults to /home/agent working directory', async () => {
      // First create the directory
      await backend.exec(container, 'mkdir -p /home/agent');

      const result = await backend.exec(container, 'pwd');

      assert.equal(result.exitCode, 0);
      // Default should be /home/agent or root
      assert.ok(
        result.stdout === '/home/agent' || result.stdout === '/' || result.stdout === '/root',
        'Should be in expected working directory'
      );
    });

    it('reads and writes files in mounted workspace', async () => {
      // Write a file from the host
      const testContent = `Test content from host - ${Date.now()}`;
      await fs.writeFile(path.join(tempDir, 'test-file.txt'), testContent);

      // Read it from container
      const readResult = await backend.exec(container, 'cat /home/agent/test-file.txt');

      assert.equal(readResult.exitCode, 0, 'Should read file successfully');
      assert.equal(readResult.stdout, testContent, 'Content should match');

      // Write from container
      const containerContent = 'Written from container';
      const writeResult = await backend.exec(
        container,
        `echo "${containerContent}" > /home/agent/container-file.txt`
      );

      assert.equal(writeResult.exitCode, 0, 'Should write file successfully');

      // Read from host
      const hostRead = await fs.readFile(path.join(tempDir, 'container-file.txt'), 'utf8');
      assert.equal(hostRead.trim(), containerContent, 'Host should see container-written file');
    });

    it('executes as root user when specified', async () => {
      const result = await backend.exec(container, 'id', { user: 'root' });

      assert.equal(result.exitCode, 0);
      assert.ok(result.stdout.includes('root') || result.stdout.includes('uid=0'), 'Should run as root');
    });
  });

  describe('Health Check', () => {
    let container;
    let tempDir;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-army-incus-health-test-'));

      container = await backend.createContainer(
        {
          id: `${TEST_PREFIX}-health-${Date.now()}`,
          sandbox: {
            incusImage: 'images:alpine/3.20',
            memory: '256MB',
            cpus: 1,
          },
        },
        { root: tempDir }
      );
    });

    afterEach(async () => {
      if (container) {
        try {
          await backend.stopContainer(container);
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
      const isHealthy = await backend.healthCheck(container);
      assert.equal(isHealthy, false, 'Created container should not be healthy');
    });

    it('returns true for running container', async () => {
      await backend.startContainer(container);

      const isHealthy = await backend.healthCheck(container);
      assert.equal(isHealthy, true, 'Running container should be healthy');
    });

    it('returns false for null container', async () => {
      const isHealthy = await backend.healthCheck(null);
      assert.equal(isHealthy, false, 'Null container should not be healthy');
    });
  });

  describe('Container Management', () => {
    it('lists managed containers', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-army-incus-list-test-'));

      const testBotId = `${TEST_PREFIX}-list-${Date.now()}`;
      const container = await backend.createContainer(
        {
          id: testBotId,
          sandbox: { incusImage: 'images:alpine/3.20' },
        },
        { root: tempDir }
      );

      try {
        await backend.startContainer(container);

        const containers = await backend.listManagedContainers();

        // Find our test container
        const found = containers.find(c => c.config?.['user.ai-army.bot-id'] === testBotId);

        assert.ok(found, 'Should find our test container in list');
        assert.equal(found.config?.['user.ai-army.managed'], 'true', 'Should have managed label');
      } finally {
        await backend.stopContainer(container);
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it('gets container by bot ID', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-army-incus-getbot-test-'));

      const testBotId = `${TEST_PREFIX}-getbot-${Date.now()}`;
      const container = await backend.createContainer(
        {
          id: testBotId,
          sandbox: { incusImage: 'images:alpine/3.20' },
        },
        { root: tempDir }
      );

      try {
        await backend.startContainer(container);

        const found = await backend.getContainerByBotId(testBotId);

        assert.ok(found, 'Should find container by bot ID');
        assert.equal(found.id, container.id, 'Should be the same container');
      } finally {
        await backend.stopContainer(container);
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it('returns null for non-existent bot ID', async () => {
      const found = await backend.getContainerByBotId('non-existent-bot-xyz');
      assert.equal(found, null, 'Should return null for non-existent bot');
    });

    it('removes container by name', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-army-incus-remove-test-'));

      const testBotId = `${TEST_PREFIX}-remove-${Date.now()}`;
      const containerName = `ai-army-${testBotId}`;

      // Create container - we'll reference it by name for removal
      await backend.createContainer(
        {
          id: testBotId,
          sandbox: { incusImage: 'images:alpine/3.20' },
        },
        { root: tempDir }
      );

      try {
        // Remove by name (using container name)
        const removed = await backend.removeContainerByName(containerName);
        assert.equal(removed, true, 'Should return true when removed');

        // Verify it's gone
        const found = await backend.getContainerByBotId(testBotId);
        assert.equal(found, null, 'Container should be removed');
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it('returns false when removing non-existent container', async () => {
      const removed = await backend.removeContainerByName('non-existent-container-xyz');
      assert.equal(removed, false, 'Should return false for non-existent container');
    });
  });

  describe('Package Installation', { skip: true }, () => {
    // These tests are skipped by default as they take time and require network
    // Run with: npm run test:integration -- --test-name-pattern="Package Installation"
    let container;
    let tempDir;

    before(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-army-incus-pkg-test-'));

      container = await backend.createContainer(
        {
          id: `${TEST_PREFIX}-pkg-${Date.now()}`,
          sandbox: {
            // Use Alpine for apk package manager
            incusImage: 'images:alpine/3.20',
            memory: '512MB',
            cpus: 2,
          },
        },
        { root: tempDir }
      );

      await backend.startContainer(container);
    });

    after(async () => {
      if (container) {
        try {
          await backend.stopContainer(container);
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

    it('installs packages via apk (Alpine)', async () => {
      // Alpine uses apk, not apt-get
      // Install curl using apk directly
      const installCmd = 'apk add curl';
      const installResult = await backend.exec(container, installCmd, { timeout: 120000 });

      assert.equal(installResult.exitCode, 0, 'Should install curl successfully');

      // Verify curl is installed
      const result = await backend.exec(container, 'curl --version');

      assert.equal(result.exitCode, 0, 'curl should be installed');
      assert.ok(result.stdout.includes('curl'), 'Should show curl version');
    });
  });

  describe('Error Handling', () => {
    it('throws ContainerBackendError for missing bot ID', async () => {
      await assert.rejects(
        () => backend.createContainer({ sandbox: {} }, { root: '/tmp' }),
        err => {
          assert.ok(err instanceof ContainerBackendError, 'Should throw ContainerBackendError');
          assert.equal(err.operation, 'createContainer', 'Should have operation');
          assert.ok(err.message.includes('Bot configuration'), 'Should mention bot config');
          return true;
        }
      );
    });

    it('throws ContainerBackendError for empty command', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-army-incus-error-test-'));
      const container = await backend.createContainer(
        {
          id: `${TEST_PREFIX}-error-${Date.now()}`,
          sandbox: { incusImage: 'images:alpine/3.20' },
        },
        { root: tempDir }
      );

      try {
        await backend.startContainer(container);

        await assert.rejects(
          () => backend.exec(container, ''),
          err => {
            assert.ok(err instanceof ContainerBackendError, 'Should throw ContainerBackendError');
            assert.equal(err.operation, 'exec', 'Should have operation');
            return true;
          }
        );
      } finally {
        await backend.stopContainer(container);
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });
  });
});
