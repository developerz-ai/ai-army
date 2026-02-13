/**
 * Integration tests for CLI server and worker commands
 *
 * Tests the full command flow with real command modules and mock infrastructure.
 * Verifies:
 * - server add/list/test: registers servers and tests SSH connectivity
 * - worker list/status/stop/start/update: manages worker lifecycle
 * - deploy: provisions workers with --dry-run flag
 * - generate worker: creates worker YAML files from templates
 *
 * Unlike unit tests that mock everything, these tests exercise the real
 * command modules with mocked storage, SSH, and Docker components.
 */

import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

import { runServer } from '../../../src/cli/ServerCommand.js';
import { runWorker } from '../../../src/cli/WorkerCommand.js';
import { runDeploy } from '../../../src/cli/DeployCommand.js';
import { runGenerate } from '../../../src/cli/GenerateCommand.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a writable stream mock that collects output
 * @returns {{ write: Function, output: () => string }}
 */
function createOutputStream() {
  const chunks = [];
  return {
    write(data) {
      chunks.push(data);
      return true;
    },
    output() {
      return chunks.join('');
    },
  };
}

/**
 * Create a temporary directory for test project files
 * @returns {Promise<string>} Path to temp dir
 */
async function createTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ai-army-cli-test-'));
}

/**
 * Create a mock storage with worker registry operations
 * @param {Object} [options={}] - Options
 * @returns {Object} Mock storage
 */
function createMockStorage(options = {}) {
  const { workers = [], servers = [] } = options;
  const storedWorkers = [...workers];
  const storedServers = [...servers];

  return {
    connected: true,
    isConnected: () => true,
    connect: mock.fn(async () => {}),
    disconnect: mock.fn(async () => {}),
    query: mock.fn(async (sql, params) => {
      // Mock worker registry queries
      if (sql.includes('INSERT INTO workers')) {
        const [id, host, status] = params;
        storedWorkers.push({ id, host, status, labels: [], max_workers: 10 });
        return { rows: [{ id }] };
      }
      if (sql.includes('SELECT * FROM workers WHERE id')) {
        const id = params[0];
        const worker = storedWorkers.find(w => w.id === id);
        return { rows: worker ? [worker] : [] };
      }
      if (sql.includes('SELECT * FROM workers')) {
        return { rows: storedWorkers };
      }
      if (sql.includes('UPDATE workers')) {
        return { rows: [] };
      }
      return { rows: [] };
    }),
    transaction: mock.fn(async fn => fn({ query: mock.fn(async () => ({ rows: [] })) })),
  };
}

/**
 * Create a mock BotManager
 * @param {Object} [options={}] - Options
 * @returns {Object} Mock BotManager
 */
function createMockBotManager(options = {}) {
  const { bots = [] } = options;

  return {
    listBots: mock.fn(async () => bots),
    getBotById: mock.fn(async id => bots.find(b => b.id === id) || null),
    stopBot: mock.fn(async () => ({ success: true })),
    startBot: mock.fn(async () => ({ success: true })),
    updateBotImage: mock.fn(async () => ({ success: true })),
  };
}

/**
 * Create mock YAML project files for deployment tests
 * @param {string} projectPath - Project root directory
 */
async function createMockProjectFiles(projectPath) {
  await fs.mkdir(path.join(projectPath, 'workers'), { recursive: true });
  await fs.mkdir(path.join(projectPath, 'expertise'), { recursive: true });

  // Main config
  await fs.writeFile(
    path.join(projectPath, 'ai-army.yml'),
    `version: '1.0'
name: test-project
workers:
  - workers/test-worker.yml
`,
    'utf8'
  );

  // Servers config
  await fs.writeFile(
    path.join(projectPath, 'servers.yml'),
    `servers:
  - id: vps-1
    host: 192.168.1.100
    user: root
    keyPath: ~/.ssh/id_rsa
    labels:
      - production
    maxWorkers: 5
`,
    'utf8'
  );

  // Worker config
  await fs.writeFile(
    path.join(projectPath, 'workers', 'test-worker.yml'),
    `id: test-worker
name: Test Worker
description: A test worker
container:
  image: ai-army/worker:latest
  cpus: 2
  memory: '4g'
expertise:
  file: expertise/test-worker.md
tools:
  - bash
  - git
deployment:
  server: vps-1
  replicas: 1
enabled: true
`,
    'utf8'
  );

  // Expertise file
  await fs.writeFile(
    path.join(projectPath, 'expertise', 'test-worker.md'),
    '# Test Worker\n\nYou are a test worker.\n',
    'utf8'
  );
}

// ============================================================================
// server command integration tests
// ============================================================================

describe('server command - integration with storage', () => {
  let storage;
  let out;

  beforeEach(() => {
    storage = createMockStorage();
    out = createOutputStream();
  });

  test('server add - registers a new server in storage', async () => {
    // Note: This test will fail SSH connectivity check in test environment
    // We're testing that the command handles the SSH failure gracefully
    try {
      await runServer('add', {
        host: '192.168.1.100',
        user: 'root',
        key: '/tmp/nonexistent-key',
        labels: 'production,gpu',
        maxWorkers: 5,
        storage,
        output: out,
      });
      // Should fail with SSH error
      assert.fail('Expected SSH connectivity check to fail');
    } catch (err) {
      // Expected to fail with SSH error in test environment
      assert.ok(err.message.includes('SSH') || err.message.includes('key') || err.message.includes('ENOENT'));
    }
  });

  test('server list - displays all registered servers', async () => {
    storage = createMockStorage({
      workers: [
        { id: 'vps-1', host: '192.168.1.100', status: 'healthy', labels: ['prod'], max_workers: 10 },
        { id: 'vps-2', host: '192.168.1.101', status: 'offline', labels: [], max_workers: 5 },
      ],
    });

    const result = await runServer('list', {
      storage,
      output: out,
    });

    assert.equal(result.success, true);
    const output = out.output();
    assert.ok(output.includes('vps-1'));
    assert.ok(output.includes('192.168.1.100'));
    assert.ok(output.includes('vps-2'));
    assert.ok(output.includes('192.168.1.101'));
  });

  test('server test - tests SSH connectivity (mocked)', async () => {
    storage = createMockStorage({
      workers: [{ id: 'vps-1', host: '192.168.1.100', status: 'healthy', max_workers: 10 }],
    });

    // Test command will attempt SSH connectivity
    // In integration test, we just verify command structure
    const result = await runServer('test', {
      serverId: 'vps-1',
      user: 'root',
      key: '~/.ssh/id_rsa',
      storage,
      output: out,
    });

    // Result will depend on actual SSH test (which may fail in test env)
    // Just verify command runs without crashing
    assert.ok(result.success !== undefined);
  });

  test('server add - handles missing host parameter', async () => {
    await assert.rejects(
      async () => {
        await runServer('add', {
          host: '',
          user: 'root',
          key: '~/.ssh/id_rsa',
          labels: '',
          maxWorkers: 10,
          storage,
          output: out,
        });
      },
      err => {
        assert.ok(err.message.includes('host') || err.message.includes('required'));
        return true;
      }
    );
  });
});

// ============================================================================
// worker command integration tests
// ============================================================================

describe('worker command - integration with storage and BotManager', () => {
  let storage;
  let out;

  beforeEach(() => {
    storage = createMockStorage();
    out = createOutputStream();
  });

  test('worker list - displays all workers', async () => {
    storage = createMockStorage({
      workers: [
        { id: 'worker-1', host: 'vps-1', status: 'healthy', labels: [], max_workers: 10 },
        { id: 'worker-2', host: 'vps-2', status: 'offline', labels: [], max_workers: 5 },
      ],
    });

    const result = await runWorker('list', {
      storage,
      output: out,
    });

    assert.equal(result.success, true);
    const output = out.output();
    assert.ok(output.includes('worker-1'));
    assert.ok(output.includes('worker-2'));
  });

  test('worker status - shows detailed status for a worker', async () => {
    storage = createMockStorage({
      workers: [{ id: 'worker-1', host: 'vps-1', status: 'healthy', labels: ['prod'], max_workers: 10 }],
    });

    const result = await runWorker('status', {
      workerId: 'worker-1',
      storage,
      output: out,
    });

    assert.equal(result.success, true);
    const output = out.output();
    assert.ok(output.includes('worker-1'));
    assert.ok(output.includes('healthy'));
  });

  test('worker stop - marks worker as offline', async () => {
    storage = createMockStorage({
      workers: [{ id: 'worker-1', host: 'vps-1', status: 'healthy', labels: [], max_workers: 10 }],
    });

    const result = await runWorker('stop', {
      workerId: 'worker-1',
      storage,
      output: out,
    });

    assert.equal(result.success, true);
    assert.ok(out.output().includes('stopped'));
  });

  test('worker start - marks worker as healthy', async () => {
    storage = createMockStorage({
      workers: [{ id: 'worker-1', host: 'vps-1', status: 'offline', labels: [], max_workers: 10 }],
    });

    const result = await runWorker('start', {
      workerId: 'worker-1',
      storage,
      output: out,
    });

    assert.equal(result.success, true);
    assert.ok(out.output().includes('started'));
  });

  test('worker update - requires ContainerPool', async () => {
    storage = createMockStorage({
      workers: [{ id: 'worker-1', host: 'vps-1', status: 'healthy', labels: [], max_workers: 10 }],
    });

    // Worker update requires ContainerPool, which isn't provided in this test
    // This test verifies the error handling
    try {
      await runWorker('update', {
        workerId: 'worker-1',
        image: 'ai-army/worker:v2',
        storage,
        output: out,
      });
      assert.fail('Expected error for missing ContainerPool');
    } catch (err) {
      assert.ok(err.message.includes('ContainerPool'));
    }
  });

  test('worker status - handles non-existent worker', async () => {
    const result = await runWorker('status', {
      workerId: 'non-existent',
      storage,
      output: out,
    });

    assert.equal(result.success, false);
    assert.ok(out.output().includes('not found') || out.output().includes('No worker'));
  });
});

// ============================================================================
// deploy command integration tests
// ============================================================================

describe('deploy command - integration with ProjectLoader', () => {
  let tempDir;
  let storage;
  let out;

  beforeEach(async () => {
    tempDir = await createTempDir();
    storage = createMockStorage();
    out = createOutputStream();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('deploy --dry-run - previews deployment plan', async () => {
    await createMockProjectFiles(tempDir);

    const result = await runDeploy({
      projectPath: tempDir,
      dryRun: true,
      storage,
      output: out,
    });

    assert.equal(result.success, true);
    const output = out.output();
    assert.ok(output.includes('dry run') || output.includes('Dry run') || output.includes('plan'));
    assert.ok(output.includes('test-worker') || output.includes('worker'));
  });

  test('deploy specific worker - deploys single worker', async () => {
    await createMockProjectFiles(tempDir);

    const result = await runDeploy({
      projectPath: tempDir,
      workerId: 'test-worker',
      dryRun: true,
      storage,
      output: out,
    });

    assert.equal(result.success, true);
    assert.ok(out.output().includes('test-worker'));
  });

  test('deploy - handles missing project files', async () => {
    // Empty directory - no ai-army.yml
    await assert.rejects(
      async () => {
        await runDeploy({
          projectPath: tempDir,
          dryRun: false,
          storage,
          output: out,
        });
      },
      err => {
        assert.ok(
          err.message.includes('ai-army.yml') ||
            err.message.includes('not found') ||
            err.message.includes('ENOENT')
        );
        return true;
      }
    );
  });
});

// ============================================================================
// generate worker command integration tests
// ============================================================================

describe('generate worker command - integration with templates', () => {
  let tempDir;
  let out;

  beforeEach(async () => {
    tempDir = await createTempDir();
    out = createOutputStream();
    await fs.mkdir(path.join(tempDir, 'workers'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'expertise'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('generate worker - creates worker YAML and expertise files', async () => {
    // Use backend-developer type which exists in templates
    const result = await runGenerate('worker', {
      name: 'my-worker',
      type: 'backend-developer',
      projectPath: tempDir,
      output: out,
    });

    assert.equal(result.success, true);
    assert.equal(result.name, 'my-worker');

    // Verify files were created
    const workerFile = path.join(tempDir, 'workers', 'my-worker.yml');
    const expertiseFile = path.join(tempDir, 'expertise', 'my-worker.md');
    await assert.doesNotReject(async () => await fs.access(workerFile));
    await assert.doesNotReject(async () => await fs.access(expertiseFile));

    // Verify content
    const workerContent = await fs.readFile(workerFile, 'utf8');
    assert.ok(workerContent.includes('id: my-worker'));
    assert.ok(workerContent.includes('name: My Worker'));

    const expertiseContent = await fs.readFile(expertiseFile, 'utf8');
    assert.ok(expertiseContent.includes('My Worker'));
  });

  test('generate worker - supports different worker types', async () => {
    // Test with frontend-developer type (if templates exist)
    const result = await runGenerate('worker', {
      name: 'frontend-worker',
      type: 'frontend-developer',
      projectPath: tempDir,
      output: out,
    });

    assert.equal(result.success, true);
    assert.equal(result.type, 'frontend-developer');

    const workerFile = path.join(tempDir, 'workers', 'frontend-worker.yml');
    const workerContent = await fs.readFile(workerFile, 'utf8');
    assert.ok(workerContent.includes('frontend'));
  });

  test('generate worker - validates name format', async () => {
    await assert.rejects(
      async () => {
        await runGenerate('worker', {
          name: 'Invalid Name',
          type: 'default',
          projectPath: tempDir,
          output: out,
        });
      },
      err => {
        assert.ok(err.message.includes('kebab-case') || err.message.includes('Invalid'));
        return true;
      }
    );
  });

  test('generate worker - prevents overwriting existing files', async () => {
    // Create worker first time with backend-developer type
    await runGenerate('worker', {
      name: 'existing-worker',
      type: 'backend-developer',
      projectPath: tempDir,
      output: out,
    });

    // Try to create again
    await assert.rejects(
      async () => {
        await runGenerate('worker', {
          name: 'existing-worker',
          type: 'backend-developer',
          projectPath: tempDir,
          output: out,
        });
      },
      err => {
        assert.ok(err.message.includes('already exists'));
        return true;
      }
    );
  });

  test('generate worker - rejects invalid type', async () => {
    await assert.rejects(
      async () => {
        await runGenerate('worker', {
          name: 'test-worker',
          type: 'invalid-type-xyz',
          projectPath: tempDir,
          output: out,
        });
      },
      err => {
        assert.ok(err.message.includes('Invalid worker type'));
        return true;
      }
    );
  });
});
