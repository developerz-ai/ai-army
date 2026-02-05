/**
 * Integration tests for ContainerPool
 *
 * Tests real container pooling, reuse, health monitoring, and cleanup
 * with actual Docker containers.
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
import { DockerManager } from '../../../src/execution/docker-manager.js';
import { ContainerPool, ContainerPoolError } from '../../../src/execution/container-pool.js';

/**
 * Generate unique container name prefix to avoid conflicts
 */
const TEST_PREFIX = `ai-army-pool-test-${Date.now()}`;

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
  console.log('Skipping ContainerPool integration tests - Docker not available');
  console.log('Ensure Docker is running: docker info');
}

describe('ContainerPool Integration', { skip: !DOCKER_AVAILABLE }, () => {
  let dockerManager;

  before(async () => {
    dockerManager = new DockerManager();
  });

  after(async () => {
    if (dockerManager) {
      await cleanupTestContainers(dockerManager, TEST_PREFIX);
    }
  });

  describe('Container Lifecycle', () => {
    let pool;
    let tempDir;

    beforeEach(async () => {
      pool = new ContainerPool(dockerManager);
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-army-pool-test-'));
    });

    afterEach(async () => {
      // Clean up pool
      if (pool) {
        try {
          await pool.cleanup();
        } catch {
          // Ignore cleanup errors
        }
      }

      // Clean up temp directory
      if (tempDir) {
        try {
          await fs.rm(tempDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    it('initializes a container and stores it in pool', async () => {
      const botId = `${TEST_PREFIX}-init-${Date.now()}`;
      const botConfig = {
        id: botId,
        sandbox: {
          image: 'alpine:latest',
          memory: '256m',
          cpus: 1,
        },
      };

      const container = await pool.initializeContainer(botId, botConfig, { root: tempDir });

      assert.ok(container, 'Should return container');
      assert.ok(container.id, 'Container should have ID');
      assert.equal(pool.size, 1, 'Pool should have one container');
      assert.ok(pool.hasContainer(botId), 'Pool should have container for botId');
    });

    it('reuses existing container on getContainer()', async () => {
      const botId = `${TEST_PREFIX}-reuse-${Date.now()}`;
      const botConfig = {
        id: botId,
        sandbox: {
          image: 'alpine:latest',
          memory: '256m',
          cpus: 1,
        },
      };

      const initialContainer = await pool.initializeContainer(botId, botConfig, { root: tempDir });
      const retrievedContainer = await pool.getContainer(botId);

      assert.equal(retrievedContainer.id, initialContainer.id, 'Should return same container');
    });

    it('returns healthy container multiple times', async () => {
      const botId = `${TEST_PREFIX}-multi-${Date.now()}`;
      const botConfig = {
        id: botId,
        sandbox: {
          image: 'alpine:latest',
          memory: '256m',
          cpus: 1,
        },
      };

      await pool.initializeContainer(botId, botConfig, { root: tempDir });

      const container1 = await pool.getContainer(botId);
      const container2 = await pool.getContainer(botId);
      const container3 = await pool.getContainer(botId);

      assert.equal(container1.id, container2.id, 'First and second should match');
      assert.equal(container2.id, container3.id, 'Second and third should match');
    });

    it('throws when getting container that was not initialized', async () => {
      await assert.rejects(
        () => pool.getContainer('nonexistent-bot'),
        err => {
          assert.ok(err instanceof ContainerPoolError);
          assert.match(err.message, /Container not initialized/);
          return true;
        }
      );
    });

    it('recycles container and removes from pool', async () => {
      const botId = `${TEST_PREFIX}-recycle-${Date.now()}`;
      const botConfig = {
        id: botId,
        sandbox: {
          image: 'alpine:latest',
          memory: '256m',
          cpus: 1,
        },
      };

      await pool.initializeContainer(botId, botConfig, { root: tempDir });
      assert.equal(pool.size, 1);

      await pool.recycleContainer(botId);

      assert.equal(pool.size, 0, 'Pool should be empty after recycle');
      assert.ok(!pool.hasContainer(botId), 'Container should be removed');
    });

    it('recycle does not throw when container does not exist', async () => {
      await assert.doesNotReject(
        () => pool.recycleContainer('nonexistent-bot'),
        'Should not throw for nonexistent container'
      );
    });

    it('reinitializes container after recycle', async () => {
      const botId = `${TEST_PREFIX}-reinit-${Date.now()}`;
      const botConfig = {
        id: botId,
        sandbox: {
          image: 'alpine:latest',
          memory: '256m',
          cpus: 1,
        },
      };

      const container1 = await pool.initializeContainer(botId, botConfig, { root: tempDir });
      await pool.recycleContainer(botId);
      const container2 = await pool.initializeContainer(botId, botConfig, { root: tempDir });

      assert.ok(container1.id !== container2.id, 'Should be different container after reinit');
      assert.equal(pool.size, 1, 'Pool should have one container');
    });

    it('replaces existing container on re-initialize', async () => {
      const botId = `${TEST_PREFIX}-replace-${Date.now()}`;
      const botConfig = {
        id: botId,
        sandbox: {
          image: 'alpine:latest',
          memory: '256m',
          cpus: 1,
        },
      };

      const container1 = await pool.initializeContainer(botId, botConfig, { root: tempDir });
      const container2 = await pool.initializeContainer(botId, botConfig, { root: tempDir });

      assert.ok(container1.id !== container2.id, 'Should create a new container');
      assert.equal(pool.size, 1, 'Pool should still have one container');
      assert.ok(pool.hasContainer(botId), 'Pool should have the bot');

      // Verify new container works
      const result = await dockerManager.exec(container2, 'echo "replaced"');
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, 'replaced');
    });

    it('auto-recreates unhealthy container on getContainer()', async () => {
      const botId = `${TEST_PREFIX}-autorecreate-${Date.now()}`;
      const botConfig = {
        id: botId,
        sandbox: {
          image: 'alpine:latest',
          memory: '256m',
          cpus: 1,
        },
      };

      const originalContainer = await pool.initializeContainer(botId, botConfig, { root: tempDir });
      const originalId = originalContainer.id;

      // Kill the container externally to make it unhealthy
      try {
        await originalContainer.stop({ t: 1 });
      } catch {
        // Ignore if already stopped
      }

      // getContainer should detect unhealthy and auto-recreate
      const recreatedContainer = await pool.getContainer(botId);

      assert.ok(recreatedContainer, 'Should return a container');
      assert.ok(recreatedContainer.id !== originalId, 'Should be a different container');
      assert.equal(pool.size, 1, 'Pool should still have one container');

      // Verify the recreated container works
      const result = await dockerManager.exec(recreatedContainer, 'echo "auto-recreated"');
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, 'auto-recreated');
    });
  });

  describe('Container Execution', () => {
    let pool;
    let tempDir;
    let botId;

    before(async () => {
      pool = new ContainerPool(dockerManager);
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-army-pool-exec-'));
      botId = `${TEST_PREFIX}-exec-${Date.now()}`;

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

      if (tempDir) {
        try {
          await fs.rm(tempDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    it('can execute commands in pooled container', async () => {
      const container = await pool.getContainer(botId);
      const result = await dockerManager.exec(container, 'echo "Hello from pool"');

      assert.equal(result.exitCode, 0, 'Command should succeed');
      assert.equal(result.stdout, 'Hello from pool', 'Should capture output');
    });

    it('can execute multiple commands in same container', async () => {
      const container = await pool.getContainer(botId);

      const result1 = await dockerManager.exec(container, 'echo "First"');
      const result2 = await dockerManager.exec(container, 'echo "Second"');

      assert.equal(result1.stdout, 'First');
      assert.equal(result2.stdout, 'Second');
    });

    it('can write and read files in container workspace', async () => {
      const container = await pool.getContainer(botId);

      // Write file from container
      const writeResult = await dockerManager.exec(
        container,
        'echo "Pool test content" > /home/agent/pool-test.txt'
      );
      assert.equal(writeResult.exitCode, 0);

      // Read file from container
      const readResult = await dockerManager.exec(container, 'cat /home/agent/pool-test.txt');
      assert.equal(readResult.stdout, 'Pool test content');

      // Verify file exists on host
      const hostContent = await fs.readFile(path.join(tempDir, 'pool-test.txt'), 'utf8');
      assert.equal(hostContent.trim(), 'Pool test content');
    });
  });

  describe('Health Check', () => {
    let pool;
    let tempDir;

    beforeEach(async () => {
      pool = new ContainerPool(dockerManager);
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-army-pool-health-'));
    });

    afterEach(async () => {
      if (pool) {
        try {
          await pool.cleanup();
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

    it('reports healthy containers', async () => {
      const botId1 = `${TEST_PREFIX}-health1-${Date.now()}`;
      const botId2 = `${TEST_PREFIX}-health2-${Date.now()}`;

      await pool.initializeContainer(
        botId1,
        { id: botId1, sandbox: { image: 'alpine:latest' } },
        { root: tempDir }
      );
      await pool.initializeContainer(
        botId2,
        { id: botId2, sandbox: { image: 'alpine:latest' } },
        { root: tempDir }
      );

      const results = await pool.healthCheckAll();

      assert.ok(results.healthy.includes(botId1), 'Bot 1 should be healthy');
      assert.ok(results.healthy.includes(botId2), 'Bot 2 should be healthy');
      assert.equal(results.unhealthy.length, 0, 'No unhealthy containers');
      assert.equal(results.recycled.length, 0, 'No recycled containers');
    });

    it('detects and recycles stopped container', async () => {
      const botId = `${TEST_PREFIX}-stopped-${Date.now()}`;

      const container = await pool.initializeContainer(
        botId,
        { id: botId, sandbox: { image: 'alpine:latest' } },
        { root: tempDir }
      );

      // Stop the container directly
      try {
        await container.stop({ t: 1 });
      } catch {
        // Ignore if already stopped
      }

      const results = await pool.healthCheckAll();

      assert.ok(results.unhealthy.includes(botId), 'Bot should be unhealthy');
      assert.ok(results.recycled.includes(botId), 'Bot should be recycled');
    });

    it('returns empty results for empty pool', async () => {
      const results = await pool.healthCheckAll();

      assert.deepEqual(results, {
        healthy: [],
        unhealthy: [],
        recycled: [],
      });
    });

    it('detects mixed healthy and unhealthy containers', async () => {
      const botId1 = `${TEST_PREFIX}-mix-healthy-${Date.now()}`;
      const botId2 = `${TEST_PREFIX}-mix-unhealthy-${Date.now()}`;

      const container1 = await pool.initializeContainer(
        botId1,
        { id: botId1, sandbox: { image: 'alpine:latest' } },
        { root: tempDir }
      );
      const container2 = await pool.initializeContainer(
        botId2,
        { id: botId2, sandbox: { image: 'alpine:latest' } },
        { root: tempDir }
      );

      // Stop one container externally
      try {
        await container2.stop({ t: 1 });
      } catch {
        // Ignore if already stopped
      }

      const results = await pool.healthCheckAll();

      assert.ok(results.healthy.includes(botId1), 'Bot 1 should be healthy');
      assert.ok(results.unhealthy.includes(botId2), 'Bot 2 should be unhealthy');
      assert.ok(results.recycled.includes(botId2), 'Bot 2 should be recycled');
      assert.ok(!results.unhealthy.includes(botId1), 'Bot 1 should not be unhealthy');

      // Verify the healthy container still works
      const result = await dockerManager.exec(container1, 'echo "still alive"');
      assert.equal(result.stdout, 'still alive');
    });
  });

  describe('Cleanup', () => {
    let pool;
    let tempDir;

    beforeEach(async () => {
      pool = new ContainerPool(dockerManager);
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-army-pool-cleanup-'));
    });

    afterEach(async () => {
      if (tempDir) {
        try {
          await fs.rm(tempDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    it('cleans up all containers', async () => {
      const botId1 = `${TEST_PREFIX}-cleanup1-${Date.now()}`;
      const botId2 = `${TEST_PREFIX}-cleanup2-${Date.now()}`;

      await pool.initializeContainer(
        botId1,
        { id: botId1, sandbox: { image: 'alpine:latest' } },
        { root: tempDir }
      );
      await pool.initializeContainer(
        botId2,
        { id: botId2, sandbox: { image: 'alpine:latest' } },
        { root: tempDir }
      );

      assert.equal(pool.size, 2);

      await pool.cleanup();

      assert.equal(pool.size, 0);
      assert.ok(!pool.hasContainer(botId1));
      assert.ok(!pool.hasContainer(botId2));

      // Verify containers are actually removed from Docker
      const container1 = await dockerManager.getContainerByBotId(botId1);
      const container2 = await dockerManager.getContainerByBotId(botId2);

      assert.equal(container1, null, 'Container 1 should be removed from Docker');
      assert.equal(container2, null, 'Container 2 should be removed from Docker');
    });

    it('cleanup is idempotent', async () => {
      const botId = `${TEST_PREFIX}-idempotent-${Date.now()}`;

      await pool.initializeContainer(
        botId,
        { id: botId, sandbox: { image: 'alpine:latest' } },
        { root: tempDir }
      );

      await pool.cleanup();
      await pool.cleanup(); // Second cleanup should not throw

      assert.equal(pool.size, 0);
    });

    it('getBotIds returns all bot IDs', async () => {
      const botId1 = `${TEST_PREFIX}-ids1-${Date.now()}`;
      const botId2 = `${TEST_PREFIX}-ids2-${Date.now()}`;

      await pool.initializeContainer(
        botId1,
        { id: botId1, sandbox: { image: 'alpine:latest' } },
        { root: tempDir }
      );
      await pool.initializeContainer(
        botId2,
        { id: botId2, sandbox: { image: 'alpine:latest' } },
        { root: tempDir }
      );

      const botIds = pool.getBotIds();

      assert.ok(botIds.includes(botId1));
      assert.ok(botIds.includes(botId2));
      assert.equal(botIds.length, 2);

      await pool.cleanup();
    });
  });

  describe('Multiple Containers', () => {
    let pool;
    let tempDir;

    beforeEach(async () => {
      pool = new ContainerPool(dockerManager);
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-army-pool-multi-'));
    });

    afterEach(async () => {
      if (pool) {
        try {
          await pool.cleanup();
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

    it('manages multiple independent containers', async () => {
      const bots = [
        `${TEST_PREFIX}-multi1-${Date.now()}`,
        `${TEST_PREFIX}-multi2-${Date.now()}`,
        `${TEST_PREFIX}-multi3-${Date.now()}`,
      ];

      // Create separate workspaces for each bot
      const workspaces = await Promise.all(
        bots.map(async botId => {
          const dir = path.join(tempDir, botId);
          await fs.mkdir(dir, { recursive: true });
          return dir;
        })
      );

      // Initialize all containers
      for (let i = 0; i < bots.length; i++) {
        await pool.initializeContainer(
          bots[i],
          { id: bots[i], sandbox: { image: 'alpine:latest' } },
          { root: workspaces[i] }
        );
      }

      assert.equal(pool.size, 3, 'Pool should have 3 containers');

      // Verify each container is independent
      const containers = await Promise.all(bots.map(botId => pool.getContainer(botId)));

      // All containers should have different IDs
      const uniqueIds = new Set(containers.map(c => c.id));
      assert.equal(uniqueIds.size, 3, 'All containers should have unique IDs');

      // Each container should work independently
      for (let i = 0; i < bots.length; i++) {
        const result = await dockerManager.exec(containers[i], `echo "Bot ${i}"`);
        assert.equal(result.stdout, `Bot ${i}`);
      }
    });

    it('maintains workspace isolation between containers', async () => {
      const bots = [`${TEST_PREFIX}-iso1-${Date.now()}`, `${TEST_PREFIX}-iso2-${Date.now()}`];

      // Create separate workspaces
      const workspaces = await Promise.all(
        bots.map(async botId => {
          const dir = path.join(tempDir, botId);
          await fs.mkdir(dir, { recursive: true });
          return dir;
        })
      );

      // Initialize containers with separate workspaces
      for (let i = 0; i < bots.length; i++) {
        await pool.initializeContainer(
          bots[i],
          { id: bots[i], sandbox: { image: 'alpine:latest' } },
          { root: workspaces[i] }
        );
      }

      // Write different files in each container
      const container1 = await pool.getContainer(bots[0]);
      const container2 = await pool.getContainer(bots[1]);

      await dockerManager.exec(container1, 'echo "bot1-data" > /home/agent/data.txt');
      await dockerManager.exec(container2, 'echo "bot2-data" > /home/agent/data.txt');

      // Verify files are isolated
      const result1 = await dockerManager.exec(container1, 'cat /home/agent/data.txt');
      const result2 = await dockerManager.exec(container2, 'cat /home/agent/data.txt');

      assert.equal(result1.stdout, 'bot1-data');
      assert.equal(result2.stdout, 'bot2-data');

      // Verify on host filesystem too
      const hostContent1 = await fs.readFile(path.join(workspaces[0], 'data.txt'), 'utf8');
      const hostContent2 = await fs.readFile(path.join(workspaces[1], 'data.txt'), 'utf8');

      assert.equal(hostContent1.trim(), 'bot1-data');
      assert.equal(hostContent2.trim(), 'bot2-data');
    });

    it('recycles one container without affecting others', async () => {
      const botId1 = `${TEST_PREFIX}-partial1-${Date.now()}`;
      const botId2 = `${TEST_PREFIX}-partial2-${Date.now()}`;

      await pool.initializeContainer(
        botId1,
        { id: botId1, sandbox: { image: 'alpine:latest' } },
        { root: tempDir }
      );
      const container2 = await pool.initializeContainer(
        botId2,
        { id: botId2, sandbox: { image: 'alpine:latest' } },
        { root: tempDir }
      );

      // Recycle first container
      await pool.recycleContainer(botId1);

      assert.equal(pool.size, 1, 'Pool should have 1 container');
      assert.ok(!pool.hasContainer(botId1), 'Bot 1 should be removed');
      assert.ok(pool.hasContainer(botId2), 'Bot 2 should remain');

      // Verify bot 2 still works
      const retrievedContainer2 = await pool.getContainer(botId2);
      assert.equal(retrievedContainer2.id, container2.id);

      const result = await dockerManager.exec(retrievedContainer2, 'echo "Still working"');
      assert.equal(result.stdout, 'Still working');
    });
  });
});
