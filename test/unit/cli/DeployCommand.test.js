/**
 * Unit tests for DeployCommand
 *
 * Tests the deploy command: full deploy, single worker deploy, dry-run,
 * error handling, and plan building.
 * Uses mock ProjectLoader and WorkerRegistry via dependency injection.
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { runDeploy, DeployCommandError } from '../../../src/cli/DeployCommand.js';

/**
 * Create a mock ProjectLoader for testing
 * @param {Object} [projectConfig] - Project config to return from loadProject
 * @returns {Object} Mock ProjectLoader
 */
function createMockProjectLoader(projectConfig = {}) {
  const defaultConfig = {
    main: { version: '1.0', llm: { provider: 'openrouter' } },
    servers: [],
    workers: [],
    ...projectConfig,
  };

  return {
    loadProject: mock.fn(async () => defaultConfig),
  };
}

/**
 * Create a mock WorkerRegistry for testing
 * @returns {Object} Mock WorkerRegistry with in-memory Map storage
 */
function createMockWorkerRegistry() {
  const workers = new Map();

  return {
    workers,
    registerWorker: mock.fn(async config => {
      const worker = {
        id: config.id,
        host: config.host,
        type: config.type,
        maxContainers: config.maxContainers || 10,
        currentLoad: 0,
        status: 'healthy',
        lastHeartbeat: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      workers.set(config.id, worker);
      return worker;
    }),
    getWorker: mock.fn(async id => workers.get(id) || null),
    listWorkers: mock.fn(async () => [...workers.values()]),
  };
}

/**
 * Create a mock writable output stream
 * @returns {Object} Mock output with write() and captured lines
 */
function createMockOutput() {
  const lines = [];
  return {
    lines,
    write: mock.fn(msg => {
      lines.push(msg);
      return true;
    }),
  };
}

describe('DeployCommand', () => {
  let mockLoader;
  let mockRegistry;
  let mockOutput;

  beforeEach(() => {
    mockRegistry = createMockWorkerRegistry();
    mockOutput = createMockOutput();
  });

  // ============================================================================
  // deploy all workers
  // ============================================================================

  describe('deploy all', () => {
    test('deploys all enabled workers', async () => {
      mockLoader = createMockProjectLoader({
        workers: [
          {
            id: 'worker-1',
            name: 'Worker One',
            enabled: true,
            deployment: { server: 'local', replicas: 1 },
          },
          {
            id: 'worker-2',
            name: 'Worker Two',
            enabled: true,
            deployment: { server: 'local', replicas: 2 },
          },
        ],
      });

      const result = await runDeploy({
        output: mockOutput,
        workerRegistry: mockRegistry,
        projectLoader: mockLoader,
      });

      assert.equal(result.success, true);
      assert.equal(result.deployed.length, 2);
      assert.equal(result.failed.length, 0);
    });

    test('skips disabled workers', async () => {
      mockLoader = createMockProjectLoader({
        workers: [
          {
            id: 'active-worker',
            enabled: true,
            deployment: { server: 'local', replicas: 1 },
          },
          {
            id: 'disabled-worker',
            enabled: false,
            deployment: { server: 'local', replicas: 1 },
          },
        ],
      });

      const result = await runDeploy({
        output: mockOutput,
        workerRegistry: mockRegistry,
        projectLoader: mockLoader,
      });

      assert.equal(result.success, true);
      assert.equal(result.deployed.length, 1);
      assert.equal(result.deployed[0].id, 'active-worker');
    });

    test('registers referenced servers before provisioning workers', async () => {
      mockLoader = createMockProjectLoader({
        servers: [{ id: 'vps-1', host: '10.0.0.1', maxWorkers: 5 }],
        workers: [
          {
            id: 'worker-1',
            enabled: true,
            deployment: { server: 'vps-1', replicas: 1 },
          },
        ],
      });

      const result = await runDeploy({
        output: mockOutput,
        workerRegistry: mockRegistry,
        projectLoader: mockLoader,
      });

      assert.equal(result.success, true);
      assert.equal(result.deployed.length, 2); // server + worker
      assert.equal(result.deployed[0].type, 'server');
      assert.equal(result.deployed[0].id, 'vps-1');
      assert.equal(result.deployed[1].type, 'worker');
      assert.equal(result.deployed[1].id, 'worker-1');
    });

    test('skips already-registered servers', async () => {
      mockRegistry.workers.set('vps-1', {
        id: 'vps-1',
        host: '10.0.0.1',
        type: 'remote',
        status: 'healthy',
      });

      mockLoader = createMockProjectLoader({
        servers: [{ id: 'vps-1', host: '10.0.0.1' }],
        workers: [
          {
            id: 'worker-1',
            enabled: true,
            deployment: { server: 'vps-1', replicas: 1 },
          },
        ],
      });

      const result = await runDeploy({
        output: mockOutput,
        workerRegistry: mockRegistry,
        projectLoader: mockLoader,
      });

      assert.equal(result.success, true);
      // Server should be marked as 'exists' not 'registered'
      const serverStep = result.deployed.find(d => d.type === 'server');
      assert.equal(serverStep.action, 'exists');
    });

    test('skips already-provisioned workers', async () => {
      mockRegistry.workers.set('worker-1', {
        id: 'worker-1',
        host: 'local',
        type: 'local',
        status: 'healthy',
      });

      mockLoader = createMockProjectLoader({
        workers: [
          {
            id: 'worker-1',
            enabled: true,
            deployment: { server: 'local', replicas: 1 },
          },
        ],
      });

      const result = await runDeploy({
        output: mockOutput,
        workerRegistry: mockRegistry,
        projectLoader: mockLoader,
      });

      assert.equal(result.success, true);
      assert.equal(result.deployed[0].action, 'exists');
    });

    test('handles empty project with no workers', async () => {
      mockLoader = createMockProjectLoader({ workers: [] });

      const result = await runDeploy({
        output: mockOutput,
        workerRegistry: mockRegistry,
        projectLoader: mockLoader,
      });

      assert.equal(result.success, true);
      assert.equal(result.deployed.length, 0);
      assert.equal(result.failed.length, 0);

      const output = mockOutput.lines.join('');
      assert.match(output, /Nothing to deploy/);
    });

    test('writes deployment output', async () => {
      mockLoader = createMockProjectLoader({
        workers: [
          {
            id: 'worker-1',
            enabled: true,
            deployment: { server: 'local', replicas: 1 },
          },
        ],
      });

      await runDeploy({
        output: mockOutput,
        workerRegistry: mockRegistry,
        projectLoader: mockLoader,
      });

      const output = mockOutput.lines.join('');
      assert.match(output, /Loading project configuration/);
      assert.match(output, /Deployment plan/);
      assert.match(output, /Deploying/);
      assert.match(output, /Deployment complete/);
    });

    test('reports worker and server counts', async () => {
      mockLoader = createMockProjectLoader({
        servers: [{ id: 'srv-1', host: '10.0.0.1' }],
        workers: [
          {
            id: 'w-1',
            enabled: true,
            deployment: { server: 'local', replicas: 1 },
          },
          {
            id: 'w-2',
            enabled: true,
            deployment: { server: 'local', replicas: 1 },
          },
        ],
      });

      await runDeploy({
        output: mockOutput,
        workerRegistry: mockRegistry,
        projectLoader: mockLoader,
      });

      const output = mockOutput.lines.join('');
      assert.match(output, /2 worker\(s\)/);
      assert.match(output, /1 server\(s\)/);
    });
  });

  // ============================================================================
  // deploy single worker
  // ============================================================================

  describe('deploy single worker', () => {
    test('deploys only the specified worker', async () => {
      mockLoader = createMockProjectLoader({
        workers: [
          {
            id: 'worker-1',
            enabled: true,
            deployment: { server: 'local', replicas: 1 },
          },
          {
            id: 'worker-2',
            enabled: true,
            deployment: { server: 'local', replicas: 1 },
          },
        ],
      });

      const result = await runDeploy({
        workerId: 'worker-1',
        output: mockOutput,
        workerRegistry: mockRegistry,
        projectLoader: mockLoader,
      });

      assert.equal(result.success, true);
      assert.equal(result.deployed.length, 1);
      assert.equal(result.deployed[0].id, 'worker-1');
    });

    test('returns failure when specified worker not found', async () => {
      mockLoader = createMockProjectLoader({
        workers: [
          {
            id: 'worker-1',
            enabled: true,
            deployment: { server: 'local', replicas: 1 },
          },
        ],
      });

      const result = await runDeploy({
        workerId: 'non-existent',
        output: mockOutput,
        workerRegistry: mockRegistry,
        projectLoader: mockLoader,
      });

      assert.equal(result.success, false);
      assert.match(result.reason, /not found/);

      const output = mockOutput.lines.join('');
      assert.match(output, /Worker 'non-existent' not found/);
    });

    test('registers server for targeted worker when needed', async () => {
      mockLoader = createMockProjectLoader({
        servers: [{ id: 'vps-1', host: '10.0.0.1' }],
        workers: [
          {
            id: 'worker-1',
            enabled: true,
            deployment: { server: 'vps-1', replicas: 1 },
          },
        ],
      });

      const result = await runDeploy({
        workerId: 'worker-1',
        output: mockOutput,
        workerRegistry: mockRegistry,
        projectLoader: mockLoader,
      });

      assert.equal(result.success, true);
      assert.equal(result.deployed.length, 2);
    });
  });

  // ============================================================================
  // dry-run mode
  // ============================================================================

  describe('dry-run', () => {
    test('shows plan without executing', async () => {
      mockLoader = createMockProjectLoader({
        servers: [{ id: 'vps-1', host: '10.0.0.1' }],
        workers: [
          {
            id: 'worker-1',
            enabled: true,
            deployment: { server: 'vps-1', replicas: 2 },
          },
        ],
      });

      const result = await runDeploy({
        dryRun: true,
        output: mockOutput,
        workerRegistry: mockRegistry,
        projectLoader: mockLoader,
      });

      assert.equal(result.success, true);
      assert.equal(result.dryRun, true);
      assert.ok(result.steps.length > 0);

      // No workers should be registered
      assert.equal(mockRegistry.registerWorker.mock.calls.length, 0);
    });

    test('displays step details in dry-run', async () => {
      mockLoader = createMockProjectLoader({
        servers: [{ id: 'vps-1', host: '10.0.0.1' }],
        workers: [
          {
            id: 'worker-1',
            enabled: true,
            deployment: { server: 'vps-1', replicas: 3 },
          },
        ],
      });

      await runDeploy({
        dryRun: true,
        output: mockOutput,
        workerRegistry: mockRegistry,
        projectLoader: mockLoader,
      });

      const output = mockOutput.lines.join('');
      assert.match(output, /Deployment plan/);
      assert.match(output, /Register server 'vps-1'/);
      assert.match(output, /Provision worker 'worker-1'/);
      assert.match(output, /3 replicas/);
      assert.match(output, /Dry run complete/);
    });

    test('shows correct step count', async () => {
      mockLoader = createMockProjectLoader({
        workers: [
          {
            id: 'w-1',
            enabled: true,
            deployment: { server: 'local', replicas: 1 },
          },
          {
            id: 'w-2',
            enabled: true,
            deployment: { server: 'local', replicas: 1 },
          },
        ],
      });

      await runDeploy({
        dryRun: true,
        output: mockOutput,
        workerRegistry: mockRegistry,
        projectLoader: mockLoader,
      });

      const output = mockOutput.lines.join('');
      assert.match(output, /2 steps/);
    });
  });

  // ============================================================================
  // error handling
  // ============================================================================

  describe('error handling', () => {
    test('throws when project loading fails', async () => {
      mockLoader = {
        loadProject: mock.fn(async () => {
          throw new Error('YAML parse error');
        }),
      };

      await assert.rejects(
        () =>
          runDeploy({
            output: mockOutput,
            workerRegistry: mockRegistry,
            projectLoader: mockLoader,
          }),
        err => {
          assert.equal(err.name, 'DeployCommandError');
          assert.match(err.message, /Failed to load project/);
          assert.ok(err.cause);
          return true;
        }
      );
    });

    test('reports partial failure when server registration fails', async () => {
      const failingRegistry = createMockWorkerRegistry();
      let callCount = 0;
      failingRegistry.registerWorker = mock.fn(async config => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Database connection lost');
        }
        const worker = {
          id: config.id,
          host: config.host,
          type: config.type,
          maxContainers: config.maxContainers || 10,
        };
        failingRegistry.workers.set(config.id, worker);
        return worker;
      });

      mockLoader = createMockProjectLoader({
        servers: [{ id: 'bad-srv', host: '10.0.0.99' }],
        workers: [
          {
            id: 'worker-1',
            enabled: true,
            deployment: { server: 'bad-srv', replicas: 1 },
          },
        ],
      });

      const result = await runDeploy({
        output: mockOutput,
        workerRegistry: failingRegistry,
        projectLoader: mockLoader,
      });

      assert.equal(result.success, false);
      assert.ok(result.failed.length > 0);

      const output = mockOutput.lines.join('');
      assert.match(output, /partially complete/);
    });

    test('reports partial failure when worker provisioning fails', async () => {
      const failingRegistry = createMockWorkerRegistry();
      failingRegistry.registerWorker = mock.fn(async () => {
        throw new Error('Worker limit exceeded');
      });

      mockLoader = createMockProjectLoader({
        workers: [
          {
            id: 'worker-1',
            enabled: true,
            deployment: { server: 'local', replicas: 1 },
          },
        ],
      });

      const result = await runDeploy({
        output: mockOutput,
        workerRegistry: failingRegistry,
        projectLoader: mockLoader,
      });

      assert.equal(result.success, false);
      assert.equal(result.failed.length, 1);
      assert.equal(result.failed[0].id, 'worker-1');

      const output = mockOutput.lines.join('');
      assert.match(output, /Failed to provision worker/);
    });
  });

  // ============================================================================
  // worker type detection
  // ============================================================================

  describe('worker type detection', () => {
    test('registers local workers with local type', async () => {
      mockLoader = createMockProjectLoader({
        workers: [
          {
            id: 'local-worker',
            enabled: true,
            deployment: { server: 'local', replicas: 1 },
          },
        ],
      });

      await runDeploy({
        output: mockOutput,
        workerRegistry: mockRegistry,
        projectLoader: mockLoader,
      });

      const regCall = mockRegistry.registerWorker.mock.calls[0].arguments[0];
      assert.equal(regCall.type, 'local');
    });

    test('registers remote workers with remote type', async () => {
      mockLoader = createMockProjectLoader({
        workers: [
          {
            id: 'remote-worker',
            enabled: true,
            deployment: { server: 'vps-1', replicas: 1 },
          },
        ],
      });

      await runDeploy({
        output: mockOutput,
        workerRegistry: mockRegistry,
        projectLoader: mockLoader,
      });

      const regCall = mockRegistry.registerWorker.mock.calls[0].arguments[0];
      assert.equal(regCall.type, 'remote');
    });

    test('defaults to local when no deployment.server specified', async () => {
      mockLoader = createMockProjectLoader({
        workers: [
          {
            id: 'default-worker',
            enabled: true,
          },
        ],
      });

      await runDeploy({
        output: mockOutput,
        workerRegistry: mockRegistry,
        projectLoader: mockLoader,
      });

      const regCall = mockRegistry.registerWorker.mock.calls[0].arguments[0];
      assert.equal(regCall.type, 'local');
    });
  });

  // ============================================================================
  // runDeploy with injected deps
  // ============================================================================

  describe('dependency injection', () => {
    test('uses injected projectLoader and workerRegistry', async () => {
      mockLoader = createMockProjectLoader({ workers: [] });

      const result = await runDeploy({
        output: mockOutput,
        workerRegistry: mockRegistry,
        projectLoader: mockLoader,
      });

      assert.equal(result.success, true);
      assert.equal(mockLoader.loadProject.mock.calls.length, 1);
    });

    test('passes projectPath to projectLoader', async () => {
      mockLoader = createMockProjectLoader({ workers: [] });

      await runDeploy({
        projectPath: '/my/project',
        output: mockOutput,
        workerRegistry: mockRegistry,
        projectLoader: mockLoader,
      });

      assert.equal(mockLoader.loadProject.mock.calls[0].arguments[0], '/my/project');
    });

    test('defaults to process.stdout when no output provided', () => {
      assert.equal(typeof runDeploy, 'function');
    });
  });
});

// =============================================================================
// DeployCommandError
// =============================================================================

describe('DeployCommandError', () => {
  test('is an instance of Error', () => {
    const error = new DeployCommandError('Test error');
    assert.ok(error instanceof Error);
  });

  test('has correct name', () => {
    const error = new DeployCommandError('Test error');
    assert.equal(error.name, 'DeployCommandError');
  });

  test('stores operation', () => {
    const error = new DeployCommandError('Test', { operation: 'loadProject' });
    assert.equal(error.operation, 'loadProject');
  });

  test('stores workerId', () => {
    const error = new DeployCommandError('Test', { workerId: 'worker-1' });
    assert.equal(error.workerId, 'worker-1');
  });

  test('stores cause', () => {
    const cause = new Error('Original');
    const error = new DeployCommandError('Test', { cause });
    assert.equal(error.cause, cause);
  });

  test('has correct message', () => {
    const error = new DeployCommandError('Something went wrong');
    assert.equal(error.message, 'Something went wrong');
  });
});
