/**
 * Integration tests for ProjectLoader
 *
 * Tests ProjectLoader with real filesystem operations:
 * - Real YAML file loading from disk
 * - Full project directory structure (ai-army.yml, servers.yml, workers/*.yml, expertise/*.md)
 * - Environment variable resolution with actual process.env
 * - Error cases with real file system errors
 * - End-to-end validation pipeline
 *
 * Uses temporary directories for isolation and cleanup.
 *
 * Run with: npm run test:integration
 */

import { describe, test, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ProjectLoader, ProjectLoadError } from '../../../src/config/project-loader.js';
import { ProjectValidationError } from '../../../src/config/project-validator.js';

// ============================================================================
// Test Helpers
// ============================================================================

/** Track temp directories for cleanup */
const tempDirs = [];

/**
 * Create a temporary project directory with YAML config files
 *
 * @param {Object} [files={}] - Map of relative paths to file contents
 * @returns {Promise<string>} Path to the temporary project directory
 */
async function createTestProject(files = {}) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pl-integ-'));
  tempDirs.push(tmpDir);

  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(tmpDir, filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf8');
  }

  return tmpDir;
}

// ============================================================================
// YAML Fixtures for Integration Tests
// ============================================================================

const VALID_MAIN_CONFIG = `
version: "1.0"

llm:
  provider: anthropic
  apiKey: sk-ant-test-key-12345
  model: claude-sonnet-4-5

defaults:
  maxSteps: 50
  temperature: 0.7
  timeout: 300

workers:
  - workers/support.yml
  - workers/dev.yml

servers:
  import: servers.yml
`;

const VALID_SERVERS_CONFIG = `
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
      keyFile: ~/.ssh/id_rsa
      port: 22
    resources:
      memory: 16g
      cpus: 8
      maxWorkers: 20
    enabled: true
`;

const SUPPORT_WORKER_CONFIG = `
id: support-worker
name: Support Worker
description: Handles customer support tasks
enabled: true

image: node:22-slim

container:
  image: node:22-slim
  memory: 2g
  cpus: 2

expertise: You are a helpful customer support agent. Be friendly and professional.

deployment:
  server: vps-1
  replicas: 2
  strategy: round-robin

tools:
  - bash
  - readFile
  - writeFile

maxSteps: 30
temperature: 0.6
`;

const DEV_WORKER_CONFIG = `
id: dev-worker
name: Dev Worker
description: Handles development tasks
enabled: true

image: node:22-slim

expertise:
  file: expertise/dev.md

deployment:
  server: vps-2
  replicas: 1

tools:
  - bash
  - readFile
  - writeFile
  - grep
  - git

maxSteps: 100
`;

const DEV_EXPERTISE_CONTENT = `# Dev Worker Expertise

You are an expert software developer with deep knowledge of:

## Languages
- JavaScript/TypeScript (Node.js, React, Vue)
- Python (Django, FastAPI, data science)
- Go (microservices, CLI tools)
- Rust (systems programming)

## DevOps
- Docker & Kubernetes
- CI/CD pipelines
- Infrastructure as Code
- Monitoring & logging

## Best Practices
- Test-driven development
- Code review standards
- Security best practices
- Performance optimization
`;

// ============================================================================
// Integration Tests
// ============================================================================

describe('ProjectLoader Integration - Real File System', () => {
  after(async () => {
    for (const dir of tempDirs) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    tempDirs.length = 0;
  });

  // ==========================================================================
  // Full Project Loading - End-to-End
  // ==========================================================================

  describe('full project loading from real YAML files', () => {
    test('loads complete project with all components', async () => {
      const projectDir = await createTestProject({
        'ai-army.yml': VALID_MAIN_CONFIG,
        'servers.yml': VALID_SERVERS_CONFIG,
        'workers/support.yml': SUPPORT_WORKER_CONFIG,
        'workers/dev.yml': DEV_WORKER_CONFIG,
        'expertise/dev.md': DEV_EXPERTISE_CONTENT,
      });

      const loader = new ProjectLoader();
      const config = await loader.loadProject(projectDir);

      // Verify main config loaded
      assert.ok(config.main, 'Should have main config');
      assert.equal(config.main.version, '1.0');
      assert.equal(config.main.llm.provider, 'anthropic');
      assert.equal(config.main.llm.model, 'claude-sonnet-4-5');
      assert.equal(config.main.llm.apiKey, 'sk-ant-test-key-12345');
      assert.equal(config.main.defaults.maxSteps, 50);
      assert.equal(config.main.defaults.temperature, 0.7);

      // Verify servers loaded
      assert.ok(config.servers, 'Should have servers');
      assert.equal(config.servers.length, 2);
      assert.equal(config.servers[0].id, 'vps-1');
      assert.equal(config.servers[0].host, '192.168.1.100');
      assert.equal(config.servers[0].ssh.user, 'deploy');
      assert.equal(config.servers[0].resources.memory, '8g');
      assert.equal(config.servers[1].id, 'vps-2');
      assert.equal(config.servers[1].host, '192.168.1.101');
      assert.equal(config.servers[1].resources.memory, '16g');

      // Verify workers loaded
      assert.ok(config.workers, 'Should have workers');
      assert.equal(config.workers.length, 2);

      // Support worker
      assert.equal(config.workers[0].id, 'support-worker');
      assert.equal(config.workers[0].name, 'Support Worker');
      assert.equal(config.workers[0].image, 'node:22-slim');
      assert.equal(
        config.workers[0].expertise,
        'You are a helpful customer support agent. Be friendly and professional.'
      );
      assert.equal(config.workers[0].deployment.server, 'vps-1');
      assert.equal(config.workers[0].deployment.replicas, 2);
      assert.deepEqual(config.workers[0].tools, ['bash', 'readFile', 'writeFile']);

      // Dev worker - expertise loaded from file
      assert.equal(config.workers[1].id, 'dev-worker');
      assert.equal(config.workers[1].name, 'Dev Worker');
      assert.equal(typeof config.workers[1].expertise, 'string');
      assert.ok(
        config.workers[1].expertise.includes('expert software developer'),
        'Expertise should be loaded from file'
      );
      assert.ok(
        config.workers[1].expertise.includes('JavaScript/TypeScript'),
        'Expertise should contain full content'
      );
      assert.equal(config.workers[1].deployment.server, 'vps-2');
    });

    test('loads project with minimal config (no servers, no workers)', async () => {
      const projectDir = await createTestProject({
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
      const config = await loader.loadProject(projectDir);

      assert.ok(config.main);
      assert.equal(config.main.version, '1.0');
      assert.deepEqual(config.servers, []);
      assert.deepEqual(config.workers, []);
    });

    test('loads project without servers file when missing', async () => {
      const projectDir = await createTestProject({
        'ai-army.yml': `
version: "1.0"
llm:
  provider: anthropic
  apiKey: test-key
  model: claude-sonnet-4-5
workers: []
`,
        // No servers.yml file
      });

      const loader = new ProjectLoader();
      const config = await loader.loadProject(projectDir);

      assert.ok(config.main);
      assert.deepEqual(config.servers, [], 'Should have empty servers array');
      assert.deepEqual(config.workers, []);
    });

    test('loads servers from custom path specified in main config', async () => {
      const projectDir = await createTestProject({
        'ai-army.yml': `
version: "1.0"
llm:
  provider: anthropic
  apiKey: test-key
  model: claude-sonnet-4-5
servers: infra/production-servers.yml
workers: []
`,
        'infra/production-servers.yml': `
servers:
  - id: prod-1
    host: 10.0.0.10
    ssh:
      user: admin
      port: 22
`,
      });

      const loader = new ProjectLoader();
      const config = await loader.loadProject(projectDir);

      assert.equal(config.servers.length, 1);
      assert.equal(config.servers[0].id, 'prod-1');
      assert.equal(config.servers[0].host, '10.0.0.10');
    });

    test('loads servers as array format (direct YAML array)', async () => {
      const projectDir = await createTestProject({
        'ai-army.yml': `
version: "1.0"
llm:
  provider: anthropic
  apiKey: test-key
  model: claude-sonnet-4-5
workers: []
`,
        'servers.yml': `
- id: server-1
  host: 192.168.1.10
  ssh:
    user: admin
    port: 22
- id: server-2
  host: 192.168.1.11
  ssh:
    user: admin
    port: 22
`,
      });

      const loader = new ProjectLoader();
      const config = await loader.loadProject(projectDir);

      assert.equal(config.servers.length, 2);
      assert.equal(config.servers[0].id, 'server-1');
      assert.equal(config.servers[1].id, 'server-2');
    });
  });

  // ==========================================================================
  // Environment Variable Resolution
  // ==========================================================================

  describe('environment variable resolution', () => {
    const originalEnv = {};

    beforeEach(() => {
      // Save original env vars
      originalEnv.TEST_API_KEY = process.env.TEST_API_KEY;
      originalEnv.TEST_SERVER_HOST = process.env.TEST_SERVER_HOST;
      originalEnv.TEST_SSH_USER = process.env.TEST_SSH_USER;
      originalEnv.TEST_WORKER_IMAGE = process.env.TEST_WORKER_IMAGE;

      // Set test env vars
      process.env.TEST_API_KEY = 'sk-test-resolved-key-99999';
      process.env.TEST_SERVER_HOST = '10.20.30.40';
      process.env.TEST_SSH_USER = 'deployer';
      process.env.TEST_WORKER_IMAGE = 'node:22-alpine';
    });

    afterEach(() => {
      // Restore original env vars
      for (const [key, val] of Object.entries(originalEnv)) {
        if (val === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = val;
        }
      }
    });

    test('resolves env vars in main config', async () => {
      const projectDir = await createTestProject({
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
      const config = await loader.loadProject(projectDir);

      assert.equal(
        config.main.llm.apiKey,
        'sk-test-resolved-key-99999',
        'API key should be resolved from env var'
      );
    });

    test('resolves env vars in servers config', async () => {
      const projectDir = await createTestProject({
        'ai-army.yml': `
version: "1.0"
llm:
  provider: anthropic
  apiKey: test-key
  model: claude-sonnet-4-5
workers: []
`,
        'servers.yml': `
servers:
  - id: prod-server
    host: \${TEST_SERVER_HOST}
    ssh:
      user: \${TEST_SSH_USER}
      port: 22
`,
      });

      const loader = new ProjectLoader();
      const config = await loader.loadProject(projectDir);

      assert.equal(config.servers[0].host, '10.20.30.40', 'Server host should be resolved');
      assert.equal(config.servers[0].ssh.user, 'deployer', 'SSH user should be resolved');
    });

    test('resolves env vars in worker configs', async () => {
      const projectDir = await createTestProject({
        'ai-army.yml': `
version: "1.0"
llm:
  provider: anthropic
  apiKey: test-key
  model: claude-sonnet-4-5
workers:
  - workers/test.yml
`,
        'workers/test.yml': `
id: test-worker
image: \${TEST_WORKER_IMAGE}
expertise: You are a test worker.
deployment:
  server: prod-1
`,
      });

      const loader = new ProjectLoader();
      const config = await loader.loadProject(projectDir);

      assert.equal(
        config.workers[0].image,
        'node:22-alpine',
        'Worker image should be resolved from env var'
      );
    });

    test('resolves multiple env vars in same string', async () => {
      const projectDir = await createTestProject({
        'ai-army.yml': `
version: "1.0"
llm:
  provider: anthropic
  apiKey: test-key
  model: claude-sonnet-4-5
workers:
  - workers/test.yml
`,
        'workers/test.yml': `
id: test-worker
image: node:22-slim
expertise: You are \${TEST_SSH_USER} working on \${TEST_SERVER_HOST}.
deployment:
  server: prod-1
`,
      });

      const loader = new ProjectLoader();
      const config = await loader.loadProject(projectDir);

      assert.equal(
        config.workers[0].expertise,
        'You are deployer working on 10.20.30.40.',
        'Multiple env vars in one string should be resolved'
      );
    });

    test('leaves unknown env vars unchanged', async () => {
      const projectDir = await createTestProject({
        'ai-army.yml': `
version: "1.0"
llm:
  provider: anthropic
  apiKey: \${UNKNOWN_VARIABLE_XYZ}
  model: claude-sonnet-4-5
workers: []
`,
      });

      const loader = new ProjectLoader();
      const config = await loader.loadProject(projectDir);

      assert.equal(
        config.main.llm.apiKey,
        '${UNKNOWN_VARIABLE_XYZ}',
        'Unknown env vars should remain unchanged'
      );
    });

    test('does not resolve env vars when resolveEnv is false', async () => {
      const projectDir = await createTestProject({
        'ai-army.yml': `
version: "1.0"
llm:
  provider: anthropic
  apiKey: \${TEST_API_KEY}
  model: claude-sonnet-4-5
workers: []
`,
      });

      const loader = new ProjectLoader({ validate: false, resolveEnv: false });
      const config = await loader.loadProject(projectDir);

      assert.equal(
        config.main.llm.apiKey,
        '${TEST_API_KEY}',
        'Env vars should not be resolved when resolveEnv is false'
      );
    });
  });

  // ==========================================================================
  // Error Handling - Missing Files
  // ==========================================================================

  describe('error handling - missing files', () => {
    test('throws ProjectLoadError for missing main config', async () => {
      const projectDir = await createTestProject({});

      const loader = new ProjectLoader();

      await assert.rejects(
        () => loader.loadProject(projectDir),
        err => {
          assert.equal(err.name, 'ProjectLoadError');
          assert.ok(err.message.includes('Failed to read file'));
          assert.ok(err.filePath.includes('ai-army.yml'));
          assert.equal(err.operation, 'loadMainConfig');
          return true;
        }
      );
    });

    test('throws ProjectLoadError for missing worker file', async () => {
      const projectDir = await createTestProject({
        'ai-army.yml': `
version: "1.0"
llm:
  provider: anthropic
  apiKey: test-key
  model: claude-sonnet-4-5
workers:
  - workers/nonexistent.yml
`,
      });

      const loader = new ProjectLoader();

      await assert.rejects(
        () => loader.loadProject(projectDir),
        err => {
          assert.equal(err.name, 'ProjectLoadError');
          assert.ok(err.message.includes('Failed to read file'));
          assert.ok(err.filePath.includes('nonexistent.yml'));
          return true;
        }
      );
    });

    test('throws ProjectLoadError for missing expertise file', async () => {
      const projectDir = await createTestProject({
        'ai-army.yml': `
version: "1.0"
llm:
  provider: anthropic
  apiKey: test-key
  model: claude-sonnet-4-5
workers:
  - workers/test.yml
`,
        'workers/test.yml': `
id: test-worker
image: node:22-slim
expertise:
  file: expertise/missing.md
deployment:
  server: prod-1
`,
      });

      const loader = new ProjectLoader();

      await assert.rejects(
        () => loader.loadProject(projectDir),
        err => {
          assert.equal(err.name, 'ProjectLoadError');
          assert.ok(err.message.includes('expertise file'));
          assert.ok(err.filePath.includes('missing.md'));
          return true;
        }
      );
    });

    test('handles missing custom servers file gracefully (treats as optional)', async () => {
      const projectDir = await createTestProject({
        'ai-army.yml': `
version: "1.0"
llm:
  provider: anthropic
  apiKey: test-key
  model: claude-sonnet-4-5
servers: infra/missing-servers.yml
workers: []
`,
      });

      const loader = new ProjectLoader();

      // Should not throw - servers file is optional even when explicitly specified
      const config = await loader.loadProject(projectDir);
      assert.deepEqual(
        config.servers,
        [],
        'Should have empty servers array when custom servers file is missing'
      );
    });
  });

  // ==========================================================================
  // Error Handling - YAML Parse Errors
  // ==========================================================================

  describe('error handling - YAML parse errors', () => {
    test('throws ProjectLoadError for invalid YAML in main config', async () => {
      const projectDir = await createTestProject({
        'ai-army.yml': `
version: "1.0"
llm:
  provider: anthropic
  apiKey: [unclosed bracket
`,
      });

      const loader = new ProjectLoader();

      await assert.rejects(
        () => loader.loadProject(projectDir),
        err => {
          assert.equal(err.name, 'ProjectLoadError');
          assert.ok(err.message.includes('parse YAML'));
          assert.ok(err.filePath.includes('ai-army.yml'));
          assert.equal(err.operation, 'loadMainConfig');
          return true;
        }
      );
    });

    test('throws ProjectLoadError for invalid YAML in servers config', async () => {
      const projectDir = await createTestProject({
        'ai-army.yml': `
version: "1.0"
llm:
  provider: anthropic
  apiKey: test-key
  model: claude-sonnet-4-5
workers: []
`,
        'servers.yml': `
servers:
  - id: server-1
    host: 10.0.0.1
    ssh: {unclosed: brace
`,
      });

      const loader = new ProjectLoader();

      await assert.rejects(
        () => loader.loadProject(projectDir),
        err => {
          assert.equal(err.name, 'ProjectLoadError');
          assert.ok(err.message.includes('parse YAML'));
          assert.ok(err.filePath.includes('servers.yml'));
          return true;
        }
      );
    });

    test('throws ProjectLoadError for invalid YAML in worker config', async () => {
      const projectDir = await createTestProject({
        'ai-army.yml': `
version: "1.0"
llm:
  provider: anthropic
  apiKey: test-key
  model: claude-sonnet-4-5
workers:
  - workers/bad.yml
`,
        'workers/bad.yml': `
id: bad-worker
image: node:22-slim
tools: [bash, readFile, # unclosed array
`,
      });

      const loader = new ProjectLoader();

      await assert.rejects(
        () => loader.loadProject(projectDir),
        err => {
          assert.equal(err.name, 'ProjectLoadError');
          assert.ok(err.message.includes('parse YAML'));
          assert.ok(err.filePath.includes('bad.yml'));
          return true;
        }
      );
    });

    test('throws ProjectLoadError for invalid servers file format', async () => {
      const projectDir = await createTestProject({
        'ai-army.yml': `
version: "1.0"
llm:
  provider: anthropic
  apiKey: test-key
  model: claude-sonnet-4-5
workers: []
`,
        'servers.yml': `
# This is just a string, not an array or object with servers
justAString: true
anotherField: false
`,
      });

      const loader = new ProjectLoader();

      await assert.rejects(
        () => loader.loadProject(projectDir),
        err => {
          assert.equal(err.name, 'ProjectLoadError');
          assert.ok(err.message.includes('Invalid servers file format'));
          assert.ok(err.filePath.includes('servers.yml'));
          return true;
        }
      );
    });
  });

  // ==========================================================================
  // Validation Pipeline
  // ==========================================================================

  describe('validation pipeline', () => {
    test('validates config and throws ProjectValidationError for invalid config', async () => {
      const projectDir = await createTestProject({
        'ai-army.yml': `
version: "1.0"
# Missing required llm section
workers: []
`,
      });

      const loader = new ProjectLoader({ validate: true });

      await assert.rejects(
        () => loader.loadProject(projectDir),
        err => {
          assert.equal(err.name, 'ProjectValidationError');
          assert.ok(err.message.includes('Invalid project configuration'));
          return true;
        }
      );
    });

    test('skips validation when validate is false', async () => {
      const projectDir = await createTestProject({
        'ai-army.yml': `
version: "1.0"
# Missing required llm section - but validation is disabled
workers: []
`,
      });

      const loader = new ProjectLoader({ validate: false, resolveEnv: false });
      const config = await loader.loadProject(projectDir);

      assert.ok(config.main);
      assert.equal(config.main.version, '1.0');
    });

    test('validates complete project successfully', async () => {
      const projectDir = await createTestProject({
        'ai-army.yml': VALID_MAIN_CONFIG,
        'servers.yml': VALID_SERVERS_CONFIG,
        'workers/support.yml': SUPPORT_WORKER_CONFIG,
        'workers/dev.yml': DEV_WORKER_CONFIG,
        'expertise/dev.md': DEV_EXPERTISE_CONTENT,
      });

      // Should not throw
      const loader = new ProjectLoader({ validate: true });
      const config = await loader.loadProject(projectDir);

      assert.ok(config.main);
      assert.ok(config.servers);
      assert.ok(config.workers);
      assert.equal(config.servers.length, 2);
      assert.equal(config.workers.length, 2);
    });
  });

  // ==========================================================================
  // Security - Path Traversal
  // ==========================================================================

  describe('security - path traversal prevention', () => {
    test('rejects worker path with path traversal', async () => {
      const projectDir = await createTestProject({
        'ai-army.yml': `
version: "1.0"
llm:
  provider: anthropic
  apiKey: test-key
  model: claude-sonnet-4-5
workers:
  - ../../../etc/passwd
`,
      });

      const loader = new ProjectLoader();

      await assert.rejects(
        () => loader.loadProject(projectDir),
        err => {
          assert.equal(err.name, 'ProjectLoadError');
          assert.ok(err.message.includes('path traversal detected'));
          return true;
        }
      );
    });

    test('rejects expertise file path with path traversal', async () => {
      const projectDir = await createTestProject({
        'ai-army.yml': `
version: "1.0"
llm:
  provider: anthropic
  apiKey: test-key
  model: claude-sonnet-4-5
workers:
  - workers/evil.yml
`,
        'workers/evil.yml': `
id: evil-worker
image: node:22-slim
expertise:
  file: ../../../etc/shadow
deployment:
  server: prod-1
`,
      });

      const loader = new ProjectLoader();

      await assert.rejects(
        () => loader.loadProject(projectDir),
        err => {
          assert.equal(err.name, 'ProjectLoadError');
          assert.ok(err.message.includes('path traversal detected'));
          return true;
        }
      );
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('edge cases', () => {
    test('handles empty YAML files gracefully', async () => {
      const projectDir = await createTestProject({
        'ai-army.yml': '',
      });

      const loader = new ProjectLoader({ validate: false });
      const config = await loader.loadProject(projectDir);

      assert.deepEqual(config.main, {});
      assert.deepEqual(config.servers, []);
      assert.deepEqual(config.workers, []);
    });

    test('handles YAML with only whitespace', async () => {
      const projectDir = await createTestProject({
        'ai-army.yml': '   \n\n   \n  ',
      });

      const loader = new ProjectLoader({ validate: false });
      const config = await loader.loadProject(projectDir);

      assert.deepEqual(config.main, {});
    });

    test('handles workers with inline expertise (string, not file)', async () => {
      const projectDir = await createTestProject({
        'ai-army.yml': `
version: "1.0"
llm:
  provider: anthropic
  apiKey: test-key
  model: claude-sonnet-4-5
workers:
  - workers/inline.yml
`,
        'workers/inline.yml': `
id: inline-worker
image: node:22-slim
expertise: I am an inline expert.
deployment:
  server: prod-1
`,
      });

      const loader = new ProjectLoader();
      const config = await loader.loadProject(projectDir);

      assert.equal(config.workers[0].expertise, 'I am an inline expert.');
    });

    test('handles empty workers array', async () => {
      const projectDir = await createTestProject({
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
      const config = await loader.loadProject(projectDir);

      assert.deepEqual(config.workers, []);
    });

    test('handles no workers field in main config', async () => {
      const projectDir = await createTestProject({
        'ai-army.yml': `
version: "1.0"
llm:
  provider: anthropic
  apiKey: test-key
  model: claude-sonnet-4-5
`,
      });

      const loader = new ProjectLoader();
      const config = await loader.loadProject(projectDir);

      assert.deepEqual(config.workers, []);
    });
  });
});
