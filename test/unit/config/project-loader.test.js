/**
 * Unit tests for ProjectLoader
 *
 * Tests YAML project configuration loading:
 * - Main config loading (ai-army.yml)
 * - Server definitions loading (servers.yml)
 * - Worker configs loading (workers/*.yml)
 * - Expertise file loading
 * - Environment variable resolution
 * - Change detection
 * - Error handling
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ProjectLoader, ProjectLoadError } from '../../../src/config/project-loader.js';

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a temporary project directory with YAML config files
 *
 * @param {Object} [files={}] - Map of relative paths to file contents
 * @returns {Promise<string>} Path to the temporary project directory
 */
async function createTestProject(files = {}) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-army-test-'));

  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(tmpDir, filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf8');
  }

  return tmpDir;
}

/**
 * Remove a temporary project directory
 *
 * @param {string} dir - Path to the directory to remove
 */
async function cleanupTestProject(dir) {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

// =============================================================================
// YAML Fixtures
// =============================================================================

const VALID_MAIN_YAML = `
version: "1.0"
llm:
  provider: openrouter
  apiKey: test-api-key
  model: openrouter/aurora-alpha
defaults:
  maxSteps: 50
  temperature: 0.7
workers:
  - workers/support.yml
  - workers/dev.yml
servers:
  import: servers.yml
`;

const VALID_SERVERS_YAML = `
servers:
  - id: vps-1
    host: 192.168.1.100
    ssh:
      user: deploy
      keyFile: ~/.ssh/id_rsa
      port: 22
    resources:
      memory: 8g
      cpus: 4
      maxWorkers: 10
    enabled: true
  - id: vps-2
    host: 192.168.1.101
    ssh:
      user: deploy
      port: 22
    resources:
      memory: 16g
      cpus: 8
`;

const VALID_WORKER_YAML = `
id: support-worker
name: Support Worker
description: Handles customer support tasks
enabled: true
image: node:22-slim
container:
  image: node:22-slim
  memory: 2g
  cpus: 2
expertise: You are a helpful support agent.
deployment:
  server: vps-1
  replicas: 2
  strategy: round-robin
tools:
  - bash
  - readFile
maxSteps: 30
`;

const VALID_WORKER_WITH_EXPERTISE_FILE_YAML = `
id: dev-worker
name: Dev Worker
description: Handles development tasks
image: node:22-slim
expertise:
  file: expertise/dev.md
deployment:
  server: vps-1
`;

const EXPERTISE_CONTENT = `# Dev Worker Expertise

You are an expert software developer.

## Skills
- JavaScript/TypeScript
- Python
- Go
`;

// =============================================================================
// ProjectLoadError Tests
// =============================================================================

describe('ProjectLoadError', () => {
  test('creates error with message and name', () => {
    const error = new ProjectLoadError('test error');
    assert.equal(error.message, 'test error');
    assert.equal(error.name, 'ProjectLoadError');
    assert.equal(error.operation, undefined);
    assert.equal(error.filePath, undefined);
  });

  test('creates error with all options', () => {
    const cause = new Error('root cause');
    const error = new ProjectLoadError('test', {
      cause,
      operation: 'loadMainConfig',
      filePath: '/path/to/file.yml',
    });

    assert.equal(error.cause, cause);
    assert.equal(error.operation, 'loadMainConfig');
    assert.equal(error.filePath, '/path/to/file.yml');
  });
});

// =============================================================================
// loadMainConfig Tests
// =============================================================================

describe('ProjectLoader - loadMainConfig', () => {
  let tmpDir;

  afterEach(async () => {
    if (tmpDir) {
      await cleanupTestProject(tmpDir);
      tmpDir = null;
    }
  });

  test('loads and parses a valid main config', async () => {
    tmpDir = await createTestProject({ 'ai-army.yml': VALID_MAIN_YAML });
    const loader = new ProjectLoader({ validate: false });

    const config = await loader.loadMainConfig(path.join(tmpDir, 'ai-army.yml'));

    assert.equal(config.version, '1.0');
    assert.equal(config.llm.provider, 'openrouter');
    assert.equal(config.llm.apiKey, 'test-api-key');
    assert.equal(config.llm.model, 'openrouter/aurora-alpha');
    assert.deepEqual(config.workers, ['workers/support.yml', 'workers/dev.yml']);
  });

  test('throws ProjectLoadError for missing file', async () => {
    tmpDir = await createTestProject({});
    const loader = new ProjectLoader({ validate: false });

    await assert.rejects(
      () => loader.loadMainConfig(path.join(tmpDir, 'nonexistent.yml')),
      err => {
        assert.equal(err.name, 'ProjectLoadError');
        assert.equal(err.operation, 'loadMainConfig');
        assert.ok(err.filePath.includes('nonexistent.yml'));
        return true;
      }
    );
  });

  test('throws ProjectLoadError for invalid YAML', async () => {
    tmpDir = await createTestProject({
      'ai-army.yml': '{\n  invalid yaml: [unclosed',
    });
    const loader = new ProjectLoader({ validate: false });

    await assert.rejects(
      () => loader.loadMainConfig(path.join(tmpDir, 'ai-army.yml')),
      err => {
        assert.equal(err.name, 'ProjectLoadError');
        assert.match(err.message, /parse YAML/);
        return true;
      }
    );
  });

  test('returns empty object for empty YAML file', async () => {
    tmpDir = await createTestProject({ 'ai-army.yml': '' });
    const loader = new ProjectLoader({ validate: false });

    const config = await loader.loadMainConfig(path.join(tmpDir, 'ai-army.yml'));

    assert.deepEqual(config, {});
  });
});

// =============================================================================
// loadServers Tests
// =============================================================================

describe('ProjectLoader - loadServers', () => {
  let tmpDir;

  afterEach(async () => {
    if (tmpDir) {
      await cleanupTestProject(tmpDir);
      tmpDir = null;
    }
  });

  test('loads servers from standard format', async () => {
    tmpDir = await createTestProject({ 'servers.yml': VALID_SERVERS_YAML });
    const loader = new ProjectLoader({ validate: false });

    const servers = await loader.loadServers(path.join(tmpDir, 'servers.yml'));

    assert.equal(servers.length, 2);
    assert.equal(servers[0].id, 'vps-1');
    assert.equal(servers[0].host, '192.168.1.100');
    assert.equal(servers[1].id, 'vps-2');
  });

  test('loads servers from array format', async () => {
    const yaml = `
- id: server-1
  host: 10.0.0.1
  ssh:
    user: admin
    port: 22
`;
    tmpDir = await createTestProject({ 'servers.yml': yaml });
    const loader = new ProjectLoader({ validate: false });

    const servers = await loader.loadServers(path.join(tmpDir, 'servers.yml'));

    assert.equal(servers.length, 1);
    assert.equal(servers[0].id, 'server-1');
  });

  test('throws for invalid servers format', async () => {
    tmpDir = await createTestProject({ 'servers.yml': 'just_a_string: true' });
    const loader = new ProjectLoader({ validate: false });

    await assert.rejects(
      () => loader.loadServers(path.join(tmpDir, 'servers.yml')),
      err => {
        assert.equal(err.name, 'ProjectLoadError');
        assert.match(err.message, /Invalid servers file format/);
        return true;
      }
    );
  });

  test('throws for missing servers file', async () => {
    tmpDir = await createTestProject({});
    const loader = new ProjectLoader({ validate: false });

    await assert.rejects(
      () => loader.loadServers(path.join(tmpDir, 'servers.yml')),
      err => {
        assert.equal(err.name, 'ProjectLoadError');
        return true;
      }
    );
  });
});

// =============================================================================
// loadWorkers Tests
// =============================================================================

describe('ProjectLoader - loadWorkers', () => {
  let tmpDir;

  afterEach(async () => {
    if (tmpDir) {
      await cleanupTestProject(tmpDir);
      tmpDir = null;
    }
  });

  test('loads worker configs from YAML files', async () => {
    tmpDir = await createTestProject({
      'workers/support.yml': VALID_WORKER_YAML,
    });
    const loader = new ProjectLoader({ validate: false });

    const workers = await loader.loadWorkers(tmpDir, ['workers/support.yml']);

    assert.equal(workers.length, 1);
    assert.equal(workers[0].id, 'support-worker');
    assert.equal(workers[0].name, 'Support Worker');
    assert.equal(workers[0].expertise, 'You are a helpful support agent.');
  });

  test('loads multiple workers', async () => {
    tmpDir = await createTestProject({
      'workers/support.yml': VALID_WORKER_YAML,
      'workers/dev.yml': `
id: dev-worker
name: Dev Worker
image: node:22-slim
expertise: You are a dev assistant.
`,
    });
    const loader = new ProjectLoader({ validate: false });

    const workers = await loader.loadWorkers(tmpDir, ['workers/support.yml', 'workers/dev.yml']);

    assert.equal(workers.length, 2);
    assert.equal(workers[0].id, 'support-worker');
    assert.equal(workers[1].id, 'dev-worker');
  });

  test('loads expertise from external file', async () => {
    tmpDir = await createTestProject({
      'workers/dev.yml': VALID_WORKER_WITH_EXPERTISE_FILE_YAML,
      'expertise/dev.md': EXPERTISE_CONTENT,
    });
    const loader = new ProjectLoader({ validate: false });

    const workers = await loader.loadWorkers(tmpDir, ['workers/dev.yml']);

    assert.equal(workers.length, 1);
    assert.equal(workers[0].id, 'dev-worker');
    assert.equal(typeof workers[0].expertise, 'string');
    assert.match(workers[0].expertise, /expert software developer/);
  });

  test('throws for missing expertise file', async () => {
    tmpDir = await createTestProject({
      'workers/dev.yml': VALID_WORKER_WITH_EXPERTISE_FILE_YAML,
      // Note: expertise/dev.md is NOT created
    });
    const loader = new ProjectLoader({ validate: false });

    await assert.rejects(
      () => loader.loadWorkers(tmpDir, ['workers/dev.yml']),
      err => {
        assert.equal(err.name, 'ProjectLoadError');
        assert.match(err.message, /expertise file/);
        return true;
      }
    );
  });

  test('rejects worker path with path traversal (../ escape)', async () => {
    tmpDir = await createTestProject({
      'workers/support.yml': VALID_WORKER_YAML,
    });
    const loader = new ProjectLoader({ validate: false });

    await assert.rejects(
      () => loader.loadWorkers(tmpDir, ['../../../etc/passwd']),
      err => {
        assert.equal(err.name, 'ProjectLoadError');
        assert.match(err.message, /path traversal detected/);
        assert.equal(err.operation, 'loadWorkers');
        return true;
      }
    );
  });

  test('rejects expertise file path with path traversal', async () => {
    const workerWithTraversal = `
id: evil-worker
name: Evil Worker
image: node:22-slim
expertise:
  file: ../../../etc/shadow
`;
    tmpDir = await createTestProject({
      'workers/evil.yml': workerWithTraversal,
    });
    const loader = new ProjectLoader({ validate: false });

    await assert.rejects(
      () => loader.loadWorkers(tmpDir, ['workers/evil.yml']),
      err => {
        assert.equal(err.name, 'ProjectLoadError');
        assert.match(err.message, /path traversal detected/);
        assert.equal(err.operation, 'loadWorkers');
        return true;
      }
    );
  });

  test('returns empty array for no worker paths', async () => {
    tmpDir = await createTestProject({});
    const loader = new ProjectLoader({ validate: false });

    const workers = await loader.loadWorkers(tmpDir, []);

    assert.deepEqual(workers, []);
  });

  test('throws for missing worker file', async () => {
    tmpDir = await createTestProject({});
    const loader = new ProjectLoader({ validate: false });

    await assert.rejects(
      () => loader.loadWorkers(tmpDir, ['workers/nonexistent.yml']),
      err => {
        assert.equal(err.name, 'ProjectLoadError');
        return true;
      }
    );
  });
});

// =============================================================================
// resolveEnvVars Tests
// =============================================================================

describe('ProjectLoader - resolveEnvVars', () => {
  const originalEnv = {};

  beforeEach(() => {
    originalEnv.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    originalEnv.PROD_SERVER_HOST = process.env.PROD_SERVER_HOST;
    originalEnv.SSH_USER = process.env.SSH_USER;
    originalEnv.TEST_VAR = process.env.TEST_VAR;

    process.env.OPENROUTER_API_KEY = 'sk-or-test-12345';
    process.env.PROD_SERVER_HOST = '10.0.0.50';
    process.env.SSH_USER = 'deployer';
    process.env.TEST_VAR = 'resolved-value';
  });

  afterEach(() => {
    // Restore original env
    for (const [key, val] of Object.entries(originalEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  test('resolves env vars in string values', () => {
    const loader = new ProjectLoader({ validate: false });
    const config = {
      main: { llm: { apiKey: '${OPENROUTER_API_KEY}' } },
      servers: [],
      workers: [],
    };

    const resolved = loader.resolveEnvVars(config);

    assert.equal(resolved.main.llm.apiKey, 'sk-or-test-12345');
  });

  test('resolves env vars in nested objects', () => {
    const loader = new ProjectLoader({ validate: false });
    const config = {
      main: { llm: { apiKey: 'key' } },
      servers: [
        {
          id: 'prod',
          host: '${PROD_SERVER_HOST}',
          ssh: { user: '${SSH_USER}' },
        },
      ],
      workers: [],
    };

    const resolved = loader.resolveEnvVars(config);

    assert.equal(resolved.servers[0].host, '10.0.0.50');
    assert.equal(resolved.servers[0].ssh.user, 'deployer');
  });

  test('resolves env vars in arrays', () => {
    const loader = new ProjectLoader({ validate: false });
    const config = {
      main: { llm: { apiKey: 'key' } },
      servers: [],
      workers: [{ id: 'w1', env: ['${TEST_VAR}', 'static'] }],
    };

    const resolved = loader.resolveEnvVars(config);

    assert.equal(resolved.workers[0].env[0], 'resolved-value');
    assert.equal(resolved.workers[0].env[1], 'static');
  });

  test('leaves unset env vars unchanged', () => {
    const loader = new ProjectLoader({ validate: false });
    const config = {
      main: { llm: { apiKey: '${NONEXISTENT_VAR}' } },
      servers: [],
      workers: [],
    };

    const resolved = loader.resolveEnvVars(config);

    assert.equal(resolved.main.llm.apiKey, '${NONEXISTENT_VAR}');
  });

  test('does not mutate original config', () => {
    const loader = new ProjectLoader({ validate: false });
    const config = {
      main: { llm: { apiKey: '${OPENROUTER_API_KEY}' } },
      servers: [],
      workers: [],
    };

    const resolved = loader.resolveEnvVars(config);

    assert.equal(config.main.llm.apiKey, '${OPENROUTER_API_KEY}');
    assert.equal(resolved.main.llm.apiKey, 'sk-or-test-12345');
  });

  test('handles non-string values without error', () => {
    const loader = new ProjectLoader({ validate: false });
    const config = {
      main: { llm: { apiKey: 'key' } },
      servers: [],
      workers: [{ id: 'w1', replicas: 3, enabled: true, tags: null }],
    };

    const resolved = loader.resolveEnvVars(config);

    assert.equal(resolved.workers[0].replicas, 3);
    assert.equal(resolved.workers[0].enabled, true);
  });

  test('resolves multiple env vars in one string', () => {
    const loader = new ProjectLoader({ validate: false });
    const config = {
      main: { llm: { apiKey: 'key' } },
      servers: [],
      workers: [{ id: 'w1', connection: '${SSH_USER}@${PROD_SERVER_HOST}' }],
    };

    const resolved = loader.resolveEnvVars(config);

    assert.equal(resolved.workers[0].connection, 'deployer@10.0.0.50');
  });
});

// =============================================================================
// loadProject (full integration) Tests
// =============================================================================

describe('ProjectLoader - loadProject', () => {
  let tmpDir;

  afterEach(async () => {
    if (tmpDir) {
      await cleanupTestProject(tmpDir);
      tmpDir = null;
    }
  });

  test('loads a complete project configuration', async () => {
    tmpDir = await createTestProject({
      'ai-army.yml': VALID_MAIN_YAML,
      'servers.yml': VALID_SERVERS_YAML,
      'workers/support.yml': VALID_WORKER_YAML,
      'workers/dev.yml': `
id: dev-worker
name: Dev Worker
image: node:22-slim
expertise: You are a dev assistant.
deployment:
  server: vps-1
`,
    });

    const loader = new ProjectLoader();
    const config = await loader.loadProject(tmpDir);

    assert.ok(config.main, 'Should have main config');
    assert.ok(config.servers, 'Should have servers');
    assert.ok(config.workers, 'Should have workers');
    assert.equal(config.servers.length, 2);
    assert.equal(config.workers.length, 2);
    assert.equal(config.main.llm.provider, 'openrouter');
  });

  test('loads project without servers file when missing', async () => {
    tmpDir = await createTestProject({
      'ai-army.yml': `
version: "1.0"
llm:
  provider: anthropic
  apiKey: test-key
  model: claude-sonnet-4-5
workers: []
`,
    });

    const loader = new ProjectLoader();
    const config = await loader.loadProject(tmpDir);

    assert.deepEqual(config.servers, []);
    assert.deepEqual(config.workers, []);
  });

  test('throws for missing main config', async () => {
    tmpDir = await createTestProject({});
    const loader = new ProjectLoader();

    await assert.rejects(
      () => loader.loadProject(tmpDir),
      err => {
        assert.equal(err.name, 'ProjectLoadError');
        return true;
      }
    );
  });

  test('validates config when validate is enabled', async () => {
    tmpDir = await createTestProject({
      'ai-army.yml': `
version: "1.0"
# Missing llm section
workers: []
`,
    });

    const loader = new ProjectLoader({ validate: true });

    await assert.rejects(
      () => loader.loadProject(tmpDir),
      err => {
        assert.equal(err.name, 'ProjectValidationError');
        return true;
      }
    );
  });

  test('skips validation when validate is false', async () => {
    tmpDir = await createTestProject({
      'ai-army.yml': `
version: "1.0"
workers: []
`,
    });

    const loader = new ProjectLoader({ validate: false, resolveEnv: false });
    const config = await loader.loadProject(tmpDir);

    assert.ok(config.main);
    assert.equal(config.main.version, '1.0');
  });

  test('resolves env vars during loadProject', async () => {
    const oldKey = process.env.TEST_API_KEY;
    process.env.TEST_API_KEY = 'resolved-key-123';

    try {
      tmpDir = await createTestProject({
        'ai-army.yml': `
version: "1.0"
llm:
  provider: anthropic
  apiKey: \${TEST_API_KEY}
  model: claude-sonnet-4-5
workers: []
`,
      });

      const loader = new ProjectLoader();
      const config = await loader.loadProject(tmpDir);

      assert.equal(config.main.llm.apiKey, 'resolved-key-123');
    } finally {
      if (oldKey === undefined) {
        delete process.env.TEST_API_KEY;
      } else {
        process.env.TEST_API_KEY = oldKey;
      }
    }
  });

  test('loads expertise files during loadProject', async () => {
    tmpDir = await createTestProject({
      'ai-army.yml': `
version: "1.0"
llm:
  provider: anthropic
  apiKey: test-key
  model: claude-sonnet-4-5
workers:
  - workers/bot.yml
`,
      'workers/bot.yml': `
id: my-bot
image: node:22-slim
expertise:
  file: expertise/bot.md
`,
      'expertise/bot.md': 'You are an expert bot.',
    });

    const loader = new ProjectLoader();
    const config = await loader.loadProject(tmpDir);

    assert.equal(config.workers[0].expertise, 'You are an expert bot.');
  });

  test('handles servers as string import path', async () => {
    tmpDir = await createTestProject({
      'ai-army.yml': `
version: "1.0"
llm:
  provider: anthropic
  apiKey: test-key
  model: claude-sonnet-4-5
servers: infra/my-servers.yml
workers: []
`,
      'infra/my-servers.yml': `
servers:
  - id: srv-1
    host: 10.0.0.1
    ssh:
      user: admin
      port: 22
`,
    });

    const loader = new ProjectLoader();
    const config = await loader.loadProject(tmpDir);

    assert.equal(config.servers.length, 1);
    assert.equal(config.servers[0].id, 'srv-1');
  });

  test('does not resolve env vars when resolveEnv is false', async () => {
    tmpDir = await createTestProject({
      'ai-army.yml': `
version: "1.0"
llm:
  provider: anthropic
  apiKey: \${SOME_KEY}
  model: claude-sonnet-4-5
workers: []
`,
    });

    const loader = new ProjectLoader({ validate: false, resolveEnv: false });
    const config = await loader.loadProject(tmpDir);

    assert.equal(config.main.llm.apiKey, '${SOME_KEY}');
  });
});

// =============================================================================
// detectChanges Tests
// =============================================================================

describe('ProjectLoader - detectChanges', () => {
  test('detects no changes for identical configs', () => {
    const loader = new ProjectLoader({ validate: false });
    const config = {
      main: { llm: { provider: 'anthropic', apiKey: 'key', model: 'model' } },
      servers: [{ id: 'srv-1', host: '10.0.0.1' }],
      workers: [{ id: 'w-1', image: 'node:22' }],
    };

    const changes = loader.detectChanges(config, config);

    assert.equal(changes.hasChanges, false);
    assert.equal(changes.main, false);
    assert.deepEqual(changes.servers.added, []);
    assert.deepEqual(changes.servers.removed, []);
    assert.deepEqual(changes.servers.modified, []);
    assert.deepEqual(changes.workers.added, []);
    assert.deepEqual(changes.workers.removed, []);
    assert.deepEqual(changes.workers.modified, []);
  });

  test('detects main config changes', () => {
    const loader = new ProjectLoader({ validate: false });
    const oldConfig = {
      main: { llm: { provider: 'anthropic', apiKey: 'old-key', model: 'model' } },
      servers: [],
      workers: [],
    };
    const newConfig = {
      main: { llm: { provider: 'anthropic', apiKey: 'new-key', model: 'model' } },
      servers: [],
      workers: [],
    };

    const changes = loader.detectChanges(oldConfig, newConfig);

    assert.equal(changes.hasChanges, true);
    assert.equal(changes.main, true);
  });

  test('detects added workers', () => {
    const loader = new ProjectLoader({ validate: false });
    const oldConfig = {
      main: { llm: { apiKey: 'key' } },
      servers: [],
      workers: [{ id: 'w-1' }],
    };
    const newConfig = {
      main: { llm: { apiKey: 'key' } },
      servers: [],
      workers: [{ id: 'w-1' }, { id: 'w-2' }],
    };

    const changes = loader.detectChanges(oldConfig, newConfig);

    assert.equal(changes.hasChanges, true);
    assert.deepEqual(changes.workers.added, ['w-2']);
  });

  test('detects removed workers', () => {
    const loader = new ProjectLoader({ validate: false });
    const oldConfig = {
      main: { llm: { apiKey: 'key' } },
      servers: [],
      workers: [{ id: 'w-1' }, { id: 'w-2' }],
    };
    const newConfig = {
      main: { llm: { apiKey: 'key' } },
      servers: [],
      workers: [{ id: 'w-1' }],
    };

    const changes = loader.detectChanges(oldConfig, newConfig);

    assert.equal(changes.hasChanges, true);
    assert.deepEqual(changes.workers.removed, ['w-2']);
  });

  test('detects modified workers', () => {
    const loader = new ProjectLoader({ validate: false });
    const oldConfig = {
      main: { llm: { apiKey: 'key' } },
      servers: [],
      workers: [{ id: 'w-1', image: 'node:20' }],
    };
    const newConfig = {
      main: { llm: { apiKey: 'key' } },
      servers: [],
      workers: [{ id: 'w-1', image: 'node:22' }],
    };

    const changes = loader.detectChanges(oldConfig, newConfig);

    assert.equal(changes.hasChanges, true);
    assert.deepEqual(changes.workers.modified, ['w-1']);
  });

  test('detects added servers', () => {
    const loader = new ProjectLoader({ validate: false });
    const oldConfig = {
      main: { llm: { apiKey: 'key' } },
      servers: [],
      workers: [],
    };
    const newConfig = {
      main: { llm: { apiKey: 'key' } },
      servers: [{ id: 'srv-1', host: '10.0.0.1' }],
      workers: [],
    };

    const changes = loader.detectChanges(oldConfig, newConfig);

    assert.equal(changes.hasChanges, true);
    assert.deepEqual(changes.servers.added, ['srv-1']);
  });

  test('detects removed servers', () => {
    const loader = new ProjectLoader({ validate: false });
    const oldConfig = {
      main: { llm: { apiKey: 'key' } },
      servers: [{ id: 'srv-1', host: '10.0.0.1' }],
      workers: [],
    };
    const newConfig = {
      main: { llm: { apiKey: 'key' } },
      servers: [],
      workers: [],
    };

    const changes = loader.detectChanges(oldConfig, newConfig);

    assert.equal(changes.hasChanges, true);
    assert.deepEqual(changes.servers.removed, ['srv-1']);
  });

  test('detects modified servers', () => {
    const loader = new ProjectLoader({ validate: false });
    const oldConfig = {
      main: { llm: { apiKey: 'key' } },
      servers: [{ id: 'srv-1', host: '10.0.0.1' }],
      workers: [],
    };
    const newConfig = {
      main: { llm: { apiKey: 'key' } },
      servers: [{ id: 'srv-1', host: '10.0.0.2' }],
      workers: [],
    };

    const changes = loader.detectChanges(oldConfig, newConfig);

    assert.equal(changes.hasChanges, true);
    assert.deepEqual(changes.servers.modified, ['srv-1']);
  });

  test('handles empty configs', () => {
    const loader = new ProjectLoader({ validate: false });
    const config = { main: {}, servers: [], workers: [] };

    const changes = loader.detectChanges(config, config);

    assert.equal(changes.hasChanges, false);
  });
});

// =============================================================================
// Constructor Options Tests
// =============================================================================

describe('ProjectLoader - Constructor Options', () => {
  test('creates with default options', () => {
    const loader = new ProjectLoader();

    assert.ok(loader.validator);
    assert.equal(loader.validateOnLoad, true);
    assert.equal(loader.resolveEnv, true);
  });

  test('respects validate=false option', () => {
    const loader = new ProjectLoader({ validate: false });

    assert.equal(loader.validateOnLoad, false);
  });

  test('respects resolveEnv=false option', () => {
    const loader = new ProjectLoader({ resolveEnv: false });

    assert.equal(loader.resolveEnv, false);
  });

  test('accepts custom validator', () => {
    const customValidator = { validateAll: () => ({ valid: true, errors: [] }) };
    const loader = new ProjectLoader({ validator: customValidator });

    assert.equal(loader.validator, customValidator);
  });
});
