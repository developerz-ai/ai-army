/**
 * Unit tests for ProjectValidator
 *
 * Tests Zod schema validation for YAML project configuration files:
 * - Main config (ai-army.yml) validation
 * - Server definitions (servers.yml) validation
 * - Worker configs (workers/*.yml) validation
 * - Cross-reference validation
 * - Error reporting
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ProjectValidator,
  ProjectValidationError,
  ResolvedProjectConfigSchema,
  LLMProviderTypeSchema,
  LLMConfigSchema,
  WorkerContainerSchema,
  WorkerExpertiseSchema,
  WorkerDeploymentSchema,
} from '../../../src/config/project-validator.js';

// =============================================================================
// Test Fixtures
// =============================================================================

const createValidMainConfig = () => ({
  version: '1.0',
  llm: {
    provider: 'openrouter',
    apiKey: 'test-api-key',
    model: 'openrouter/aurora-alpha',
  },
  defaults: {
    maxSteps: 50,
    temperature: 0.7,
  },
  workers: ['workers/support.yml', 'workers/dev.yml'],
  servers: { import: 'servers.yml' },
});

const createValidServer = (overrides = {}) => ({
  id: 'vps-1',
  host: '192.168.1.100',
  ssh: {
    user: 'deploy',
    keyFile: '~/.ssh/id_rsa',
    port: 22,
  },
  resources: {
    memory: '8g',
    cpus: 4,
    maxWorkers: 10,
  },
  enabled: true,
  ...overrides,
});

const createValidWorker = (overrides = {}) => ({
  id: 'support-worker',
  name: 'Support Worker',
  description: 'Handles customer support tasks',
  enabled: true,
  image: 'node:22-slim',
  container: {
    image: 'node:22-slim',
    memory: '2g',
    cpus: 2,
  },
  expertise: 'You are a helpful support agent.',
  deployment: {
    server: 'vps-1',
    replicas: 2,
    strategy: 'round-robin',
  },
  tools: ['bash', 'readFile'],
  maxSteps: 30,
  ...overrides,
});

// =============================================================================
// ProjectValidationError Tests
// =============================================================================

describe('ProjectValidationError', () => {
  test('creates error with message and name', () => {
    const error = new ProjectValidationError('test error');
    assert.equal(error.message, 'test error');
    assert.equal(error.name, 'ProjectValidationError');
    assert.deepEqual(error.errors, []);
    assert.equal(error.configPath, undefined);
  });

  test('creates error with options', () => {
    const cause = new Error('root cause');
    const errors = [{ path: 'llm', message: 'missing' }];
    const error = new ProjectValidationError('test', {
      cause,
      errors,
      configPath: '/path/to/config',
    });

    assert.equal(error.cause, cause);
    assert.deepEqual(error.errors, errors);
    assert.equal(error.configPath, '/path/to/config');
  });
});

// =============================================================================
// Main Config Schema Tests
// =============================================================================

describe('ProjectValidator - Main Config', () => {
  test('validates a correct main config', () => {
    const validator = new ProjectValidator();
    const config = createValidMainConfig();

    const result = validator.validateMainConfig(config);

    assert.ok(result.valid, 'Valid main config should pass');
    assert.equal(result.errors.length, 0);
    assert.ok(result.data);
    assert.equal(result.data.llm.provider, 'openrouter');
  });

  test('rejects main config without llm section', () => {
    const validator = new ProjectValidator();
    const config = { version: '1.0', workers: [] };

    const result = validator.validateMainConfig(config);

    assert.ok(!result.valid, 'Missing llm should fail');
    assert.ok(result.errors.length > 0);
  });

  test('rejects main config with empty llm apiKey', () => {
    const validator = new ProjectValidator();
    const config = {
      llm: { provider: 'anthropic', apiKey: '', model: 'claude-sonnet-4-5' },
    };

    const result = validator.validateMainConfig(config);

    assert.ok(!result.valid, 'Empty apiKey should fail');
  });

  test('rejects main config with invalid provider type', () => {
    const validator = new ProjectValidator();
    const config = {
      llm: { provider: 'invalid-provider', apiKey: 'key', model: 'model' },
    };

    const result = validator.validateMainConfig(config);

    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.path.includes('provider')));
  });

  test('allows all valid provider types', () => {
    const validator = new ProjectValidator();
    const providers = ['anthropic', 'openai', 'openrouter', 'ollama', 'google', 'custom'];

    for (const provider of providers) {
      const config = {
        llm: { provider, apiKey: 'key', model: 'model' },
      };
      const result = validator.validateMainConfig(config);
      assert.ok(result.valid, `Provider '${provider}' should be valid`);
    }
  });

  test('defaults workers to empty array', () => {
    const validator = new ProjectValidator();
    const config = {
      llm: { provider: 'anthropic', apiKey: 'key', model: 'model' },
    };

    const result = validator.validateMainConfig(config);

    assert.ok(result.valid);
    assert.deepEqual(result.data.workers, []);
  });

  test('accepts servers as string import path', () => {
    const validator = new ProjectValidator();
    const config = {
      llm: { provider: 'anthropic', apiKey: 'key', model: 'model' },
      servers: 'infra/servers.yml',
    };

    const result = validator.validateMainConfig(config);

    assert.ok(result.valid);
    assert.equal(result.data.servers, 'infra/servers.yml');
  });

  test('accepts servers as object with import key', () => {
    const validator = new ProjectValidator();
    const config = {
      llm: { provider: 'anthropic', apiKey: 'key', model: 'model' },
      servers: { import: 'servers.yml' },
    };

    const result = validator.validateMainConfig(config);

    assert.ok(result.valid);
    assert.equal(result.data.servers.import, 'servers.yml');
  });

  test('accepts version as number', () => {
    const validator = new ProjectValidator();
    const config = {
      version: 1.0,
      llm: { provider: 'anthropic', apiKey: 'key', model: 'model' },
    };

    const result = validator.validateMainConfig(config);

    assert.ok(result.valid);
  });

  test('allows passthrough fields in main config', () => {
    const validator = new ProjectValidator();
    const config = {
      llm: { provider: 'anthropic', apiKey: 'key', model: 'model' },
      customField: 'value',
    };

    const result = validator.validateMainConfig(config);

    assert.ok(result.valid);
    assert.equal(result.data.customField, 'value');
  });
});

// =============================================================================
// Server Config Schema Tests
// =============================================================================

describe('ProjectValidator - Server Config', () => {
  test('validates a correct server config', () => {
    const validator = new ProjectValidator();
    const config = { servers: [createValidServer()] };

    const result = validator.validateServersConfig(config);

    assert.ok(result.valid, 'Valid server config should pass');
    assert.equal(result.errors.length, 0);
    assert.equal(result.data.servers[0].id, 'vps-1');
  });

  test('rejects server without id', () => {
    const validator = new ProjectValidator();
    const server = createValidServer();
    delete server.id;

    const result = validator.validateServersConfig({ servers: [server] });

    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.path.includes('id')));
  });

  test('rejects server without host', () => {
    const validator = new ProjectValidator();
    const server = createValidServer();
    delete server.host;

    const result = validator.validateServersConfig({ servers: [server] });

    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.path.includes('host')));
  });

  test('rejects server without ssh user', () => {
    const validator = new ProjectValidator();
    const server = createValidServer();
    delete server.ssh.user;

    const result = validator.validateServersConfig({ servers: [server] });

    assert.ok(!result.valid);
  });

  test('defaults ssh port to 22', () => {
    const validator = new ProjectValidator();
    const server = createValidServer();
    delete server.ssh.port;

    const result = validator.validateServersConfig({ servers: [server] });

    assert.ok(result.valid);
    assert.equal(result.data.servers[0].ssh.port, 22);
  });

  test('defaults enabled to true', () => {
    const validator = new ProjectValidator();
    const server = createValidServer();
    delete server.enabled;

    const result = validator.validateServersConfig({ servers: [server] });

    assert.ok(result.valid);
    assert.equal(result.data.servers[0].enabled, true);
  });

  test('rejects empty servers array', () => {
    const validator = new ProjectValidator();

    const result = validator.validateServersConfig({ servers: [] });

    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.message.includes('At least one server')));
  });

  test('validates multiple servers', () => {
    const validator = new ProjectValidator();
    const config = {
      servers: [
        createValidServer({ id: 'vps-1', host: '10.0.0.1' }),
        createValidServer({ id: 'vps-2', host: '10.0.0.2' }),
      ],
    };

    const result = validator.validateServersConfig(config);

    assert.ok(result.valid);
    assert.equal(result.data.servers.length, 2);
  });

  test('validates memory size format', () => {
    const validator = new ProjectValidator();
    const server = createValidServer();
    server.resources.memory = '16g';

    const result = validator.validateServersConfig({ servers: [server] });

    assert.ok(result.valid);
  });
});

// =============================================================================
// Worker Config Schema Tests
// =============================================================================

describe('ProjectValidator - Worker Config', () => {
  test('validates a correct worker config', () => {
    const validator = new ProjectValidator();
    const worker = createValidWorker();

    const result = validator.validateWorkerConfig(worker);

    assert.ok(result.valid, 'Valid worker config should pass');
    assert.equal(result.errors.length, 0);
    assert.equal(result.data.id, 'support-worker');
  });

  test('rejects worker without id', () => {
    const validator = new ProjectValidator();
    const worker = createValidWorker();
    delete worker.id;

    const result = validator.validateWorkerConfig(worker);

    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.path.includes('id')));
  });

  test('accepts worker with inline expertise string', () => {
    const validator = new ProjectValidator();
    const worker = createValidWorker({ expertise: 'You are a coding assistant.' });

    const result = validator.validateWorkerConfig(worker);

    assert.ok(result.valid);
    assert.equal(result.data.expertise, 'You are a coding assistant.');
  });

  test('accepts worker with expertise file reference', () => {
    const validator = new ProjectValidator();
    const worker = createValidWorker({
      expertise: { file: 'expertise/support.md' },
    });

    const result = validator.validateWorkerConfig(worker);

    assert.ok(result.valid);
    assert.equal(result.data.expertise.file, 'expertise/support.md');
  });

  test('validates container configuration', () => {
    const validator = new ProjectValidator();
    const worker = createValidWorker({
      container: {
        image: 'python:3.12',
        memory: '4g',
        cpus: 4,
        network: 'host',
        ports: ['8080:80'],
        volumes: ['/data:/app/data'],
        env: { NODE_ENV: 'production' },
      },
    });

    const result = validator.validateWorkerConfig(worker);

    assert.ok(result.valid);
    assert.equal(result.data.container.image, 'python:3.12');
  });

  test('rejects container without image', () => {
    const validator = new ProjectValidator();
    const worker = createValidWorker({
      container: { memory: '2g' },
    });

    const result = validator.validateWorkerConfig(worker);

    assert.ok(!result.valid);
  });

  test('validates deployment strategy options', () => {
    const validator = new ProjectValidator();
    const strategies = ['round-robin', 'least-loaded', 'pinned'];

    for (const strategy of strategies) {
      const worker = createValidWorker({
        deployment: { server: 'vps-1', strategy },
      });
      const result = validator.validateWorkerConfig(worker);
      assert.ok(result.valid, `Strategy '${strategy}' should be valid`);
    }
  });

  test('rejects invalid deployment strategy', () => {
    const validator = new ProjectValidator();
    const worker = createValidWorker({
      deployment: { server: 'vps-1', strategy: 'invalid' },
    });

    const result = validator.validateWorkerConfig(worker);

    assert.ok(!result.valid);
  });

  test('defaults deployment replicas to 1', () => {
    const validator = new ProjectValidator();
    const worker = createValidWorker({
      deployment: { server: 'vps-1' },
    });

    const result = validator.validateWorkerConfig(worker);

    assert.ok(result.valid);
    assert.equal(result.data.deployment.replicas, 1);
  });

  test('defaults enabled to true', () => {
    const validator = new ProjectValidator();
    const worker = createValidWorker();
    delete worker.enabled;

    const result = validator.validateWorkerConfig(worker);

    assert.ok(result.valid);
    assert.equal(result.data.enabled, true);
  });

  test('validates repo configuration', () => {
    const validator = new ProjectValidator();
    const worker = createValidWorker({
      repo: {
        url: 'https://github.com/org/repo.git',
        branch: 'develop',
        path: '/app',
      },
    });

    const result = validator.validateWorkerConfig(worker);

    assert.ok(result.valid);
    assert.equal(result.data.repo.url, 'https://github.com/org/repo.git');
  });

  test('defaults repo branch to main', () => {
    const validator = new ProjectValidator();
    const worker = createValidWorker({
      repo: { url: 'https://github.com/org/repo.git' },
    });

    const result = validator.validateWorkerConfig(worker);

    assert.ok(result.valid);
    assert.equal(result.data.repo.branch, 'main');
  });

  test('allows passthrough fields in worker config', () => {
    const validator = new ProjectValidator();
    const worker = createValidWorker({ customSetting: 'value' });

    const result = validator.validateWorkerConfig(worker);

    assert.ok(result.valid);
    assert.equal(result.data.customSetting, 'value');
  });
});

// =============================================================================
// validateAll Tests
// =============================================================================

describe('ProjectValidator - validateAll', () => {
  test('validates a complete valid project config', () => {
    const validator = new ProjectValidator();
    const projectConfig = {
      main: createValidMainConfig(),
      servers: [createValidServer()],
      workers: [createValidWorker()],
    };

    const result = validator.validateAll(projectConfig);

    assert.ok(result.valid, 'Complete valid project config should pass');
    assert.equal(result.errors.length, 0);
  });

  test('reports main config errors', () => {
    const validator = new ProjectValidator();
    const projectConfig = {
      main: { version: '1.0' }, // missing llm
      servers: [createValidServer()],
      workers: [createValidWorker()],
    };

    const result = validator.validateAll(projectConfig);

    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.context === 'ai-army.yml'));
  });

  test('reports worker validation errors', () => {
    const validator = new ProjectValidator();
    const badWorker = createValidWorker();
    delete badWorker.id;

    const projectConfig = {
      main: createValidMainConfig(),
      servers: [createValidServer()],
      workers: [badWorker],
    };

    const result = validator.validateAll(projectConfig);

    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.context && e.context.includes('workers')));
  });

  test('detects duplicate worker IDs', () => {
    const validator = new ProjectValidator();
    const projectConfig = {
      main: createValidMainConfig(),
      servers: [createValidServer()],
      workers: [createValidWorker({ id: 'worker-a' }), createValidWorker({ id: 'worker-a' })],
    };

    const result = validator.validateAll(projectConfig);

    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.code === 'duplicate_id'));
  });

  test('detects duplicate server IDs', () => {
    const validator = new ProjectValidator();
    const projectConfig = {
      main: createValidMainConfig(),
      servers: [createValidServer({ id: 'same-id' }), createValidServer({ id: 'same-id' })],
      workers: [createValidWorker()],
    };

    const result = validator.validateAll(projectConfig);

    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.code === 'duplicate_id'));
  });

  test('detects invalid worker server reference', () => {
    const validator = new ProjectValidator();
    const projectConfig = {
      main: createValidMainConfig(),
      servers: [createValidServer({ id: 'vps-1' })],
      workers: [
        createValidWorker({
          deployment: { server: 'non-existent-server' },
        }),
      ],
    };

    const result = validator.validateAll(projectConfig);

    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.code === 'invalid_reference'));
  });

  test('allows worker without server reference when no servers defined', () => {
    const validator = new ProjectValidator();
    const projectConfig = {
      main: createValidMainConfig(),
      servers: [],
      workers: [
        createValidWorker({
          deployment: { server: 'any-server' },
        }),
      ],
    };

    const result = validator.validateAll(projectConfig);

    // Should pass - no servers defined means no cross-ref check
    assert.ok(result.valid);
  });
});

// =============================================================================
// generateReport Tests
// =============================================================================

describe('ProjectValidator - generateReport', () => {
  test('generates success message for no errors', () => {
    const validator = new ProjectValidator();
    const report = validator.generateReport([]);

    assert.match(report, /All project configurations valid/);
  });

  test('generates success message for null errors', () => {
    const validator = new ProjectValidator();
    const report = validator.generateReport(null);

    assert.match(report, /All project configurations valid/);
  });

  test('generates grouped error report', () => {
    const validator = new ProjectValidator();
    const errors = [
      { path: 'llm', message: 'missing provider', context: 'ai-army.yml' },
      { path: 'host', message: 'required', context: 'servers[0]' },
      { path: 'id', message: 'required', context: 'workers[0]' },
    ];

    const report = validator.generateReport(errors);

    assert.match(report, /configuration errors found/);
    assert.match(report, /ai-army\.yml/);
    assert.match(report, /servers\[0\]/);
    assert.match(report, /workers\[0\]/);
  });
});

// =============================================================================
// Schema Direct Tests
// =============================================================================

describe('ProjectValidator - Schema Direct Tests', () => {
  test('LLMProviderTypeSchema validates all providers', () => {
    const providers = ['anthropic', 'openai', 'openrouter', 'ollama', 'google', 'custom'];
    for (const provider of providers) {
      const result = LLMProviderTypeSchema.safeParse(provider);
      assert.ok(result.success, `Provider '${provider}' should be valid`);
    }
  });

  test('LLMConfigSchema requires all fields', () => {
    const result = LLMConfigSchema.safeParse({});
    assert.ok(!result.success);
  });

  test('WorkerContainerSchema requires image', () => {
    const result = WorkerContainerSchema.safeParse({ memory: '2g' });
    assert.ok(!result.success);
  });

  test('WorkerExpertiseSchema accepts string', () => {
    const result = WorkerExpertiseSchema.safeParse('You are an assistant.');
    assert.ok(result.success);
  });

  test('WorkerExpertiseSchema accepts file reference', () => {
    const result = WorkerExpertiseSchema.safeParse({ file: 'expertise/bot.md' });
    assert.ok(result.success);
  });

  test('WorkerDeploymentSchema defaults replicas to 1', () => {
    const result = WorkerDeploymentSchema.safeParse({ server: 'vps-1' });
    assert.ok(result.success);
    assert.equal(result.data.replicas, 1);
  });

  test('ResolvedProjectConfigSchema validates full config', () => {
    const config = {
      main: createValidMainConfig(),
      servers: [createValidServer()],
      workers: [createValidWorker()],
    };

    const result = ResolvedProjectConfigSchema.safeParse(config);
    assert.ok(result.success);
  });
});
