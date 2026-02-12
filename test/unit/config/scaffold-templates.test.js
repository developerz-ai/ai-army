/**
 * Unit tests for project scaffold templates (templates/project/)
 *
 * Validates that:
 * - All required template files exist
 * - YAML templates are valid and parseable
 * - Templates conform to ProjectValidator schemas
 * - ProjectLoader can load the template directory as a project
 * - Environment variable placeholders are present and resolvable
 * - .gitignore covers sensitive files
 * - README contains essential sections
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import { ProjectLoader } from '../../../src/config/project-loader.js';
import {
  WorkerConfigSchema,
  ServerConfigSchema,
  MainProjectConfigSchema,
} from '../../../src/config/project-validator.js';

// =============================================================================
// Constants
// =============================================================================

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const TEMPLATES_DIR = path.join(REPO_ROOT, 'templates', 'project');

const REQUIRED_FILES = [
  'ai-army.yml',
  'servers.yml',
  'workers/example-worker.yml',
  'expertise/example.md',
  '.gitignore',
  'README.md',
  '.env.example',
];

// =============================================================================
// Helpers
// =============================================================================

/**
 * Copy the templates/project/ directory to a temp directory,
 * substituting env vars so validation passes.
 *
 * @returns {Promise<{ tmpDir: string, cleanup: () => Promise<void> }>}
 */
async function createResolvableProject() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-army-scaffold-'));

  // Copy all template files
  await copyDir(TEMPLATES_DIR, tmpDir);

  return {
    tmpDir,
    cleanup: async () => {
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    },
  };
}

/**
 * Recursively copy a directory
 *
 * @param {string} src - Source directory
 * @param {string} dest - Destination directory
 */
async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

// =============================================================================
// Tests: File Existence
// =============================================================================

describe('scaffold templates — file existence', () => {
  for (const file of REQUIRED_FILES) {
    test(`${file} exists`, async () => {
      const filePath = path.join(TEMPLATES_DIR, file);
      const stat = await fs.stat(filePath);
      assert.ok(stat.isFile(), `Expected ${file} to be a regular file`);
    });
  }

  test('workers/ directory exists', async () => {
    const stat = await fs.stat(path.join(TEMPLATES_DIR, 'workers'));
    assert.ok(stat.isDirectory());
  });

  test('expertise/ directory exists', async () => {
    const stat = await fs.stat(path.join(TEMPLATES_DIR, 'expertise'));
    assert.ok(stat.isDirectory());
  });
});

// =============================================================================
// Tests: YAML Parsing
// =============================================================================

describe('scaffold templates — YAML parsing', () => {
  test('ai-army.yml is valid YAML', async () => {
    const content = await fs.readFile(path.join(TEMPLATES_DIR, 'ai-army.yml'), 'utf8');
    const parsed = yaml.load(content);
    assert.ok(parsed, 'Parsed YAML should be truthy');
    assert.equal(typeof parsed, 'object');
  });

  test('servers.yml is valid YAML', async () => {
    const content = await fs.readFile(path.join(TEMPLATES_DIR, 'servers.yml'), 'utf8');
    const parsed = yaml.load(content);
    assert.ok(parsed, 'Parsed YAML should be truthy');
    assert.ok(parsed.servers, 'Should have a servers key');
    assert.ok(Array.isArray(parsed.servers), 'servers should be an array');
  });

  test('workers/example-worker.yml is valid YAML', async () => {
    const content = await fs.readFile(
      path.join(TEMPLATES_DIR, 'workers', 'example-worker.yml'),
      'utf8'
    );
    const parsed = yaml.load(content);
    assert.ok(parsed, 'Parsed YAML should be truthy');
    assert.ok(parsed.id, 'Worker should have an id');
  });
});

// =============================================================================
// Tests: ai-army.yml Structure
// =============================================================================

describe('scaffold templates — ai-army.yml structure', () => {
  let mainConfig;

  beforeEach(async () => {
    const content = await fs.readFile(path.join(TEMPLATES_DIR, 'ai-army.yml'), 'utf8');
    mainConfig = yaml.load(content);
  });

  test('has version field', () => {
    assert.ok(mainConfig.version, 'Should have a version field');
  });

  test('has llm configuration', () => {
    assert.ok(mainConfig.llm, 'Should have llm config');
    assert.ok(mainConfig.llm.provider, 'Should have llm.provider');
    assert.ok(mainConfig.llm.apiKey, 'Should have llm.apiKey');
    assert.ok(mainConfig.llm.model, 'Should have llm.model');
  });

  test('llm.apiKey uses env var placeholder', () => {
    assert.match(mainConfig.llm.apiKey, /\$\{\w+\}/, 'apiKey should reference an env var');
  });

  test('has defaults section', () => {
    assert.ok(mainConfig.defaults, 'Should have defaults');
    assert.ok(mainConfig.defaults.maxSteps, 'Should have defaults.maxSteps');
    assert.ok(mainConfig.defaults.temperature !== undefined, 'Should have defaults.temperature');
  });

  test('has workers array', () => {
    assert.ok(Array.isArray(mainConfig.workers), 'workers should be an array');
    assert.ok(mainConfig.workers.length > 0, 'Should have at least one worker path');
  });

  test('worker paths point to workers/ directory', () => {
    for (const workerPath of mainConfig.workers) {
      assert.match(
        workerPath,
        /^workers\//,
        `Worker path "${workerPath}" should start with workers/`
      );
      assert.match(workerPath, /\.yml$/, `Worker path "${workerPath}" should end with .yml`);
    }
  });

  test('has servers import', () => {
    assert.ok(mainConfig.servers, 'Should have servers config');
    assert.equal(mainConfig.servers.import, 'servers.yml', 'Should import servers.yml');
  });

  test('validates against MainProjectConfigSchema with resolved env vars', () => {
    // Replace env var placeholders with test values for validation
    const resolved = JSON.parse(JSON.stringify(mainConfig).replace(/\$\{\w+\}/g, 'test-value'));
    const result = MainProjectConfigSchema.safeParse(resolved);
    assert.ok(result.success, `Schema validation failed: ${JSON.stringify(result.error?.issues)}`);
  });
});

// =============================================================================
// Tests: servers.yml Structure
// =============================================================================

describe('scaffold templates — servers.yml structure', () => {
  let serversConfig;

  beforeEach(async () => {
    const content = await fs.readFile(path.join(TEMPLATES_DIR, 'servers.yml'), 'utf8');
    serversConfig = yaml.load(content);
  });

  test('has servers array with at least one entry', () => {
    assert.ok(Array.isArray(serversConfig.servers), 'servers should be an array');
    assert.ok(serversConfig.servers.length >= 1, 'Should have at least one server');
  });

  test('server has required fields (id, host, ssh)', () => {
    const server = serversConfig.servers[0];
    assert.ok(server.id, 'Server should have an id');
    assert.ok(server.host, 'Server should have a host');
    assert.ok(server.ssh, 'Server should have ssh config');
    assert.ok(server.ssh.user, 'Server should have ssh.user');
  });

  test('server host uses env var placeholder', () => {
    const server = serversConfig.servers[0];
    assert.match(server.host, /\$\{\w+\}/, 'host should reference an env var');
  });

  test('server validates against ServerConfigSchema with resolved env vars', () => {
    const server = serversConfig.servers[0];
    const resolved = JSON.parse(JSON.stringify(server).replace(/\$\{\w+\}/g, '192.168.1.100'));
    const result = ServerConfigSchema.safeParse(resolved);
    assert.ok(result.success, `Schema validation failed: ${JSON.stringify(result.error?.issues)}`);
  });

  test('servers have labels for worker placement', () => {
    const server = serversConfig.servers[0];
    assert.ok(server.labels, 'Server should have labels');
    assert.equal(typeof server.labels, 'object', 'Labels should be an object');
  });
});

// =============================================================================
// Tests: example-worker.yml Structure
// =============================================================================

describe('scaffold templates — example-worker.yml structure', () => {
  let workerConfig;

  beforeEach(async () => {
    const content = await fs.readFile(
      path.join(TEMPLATES_DIR, 'workers', 'example-worker.yml'),
      'utf8'
    );
    workerConfig = yaml.load(content);
  });

  test('has required fields (id, name)', () => {
    assert.ok(workerConfig.id, 'Worker should have an id');
    assert.ok(workerConfig.name, 'Worker should have a name');
  });

  test('has expertise file reference', () => {
    assert.ok(workerConfig.expertise, 'Worker should have expertise');
    assert.ok(workerConfig.expertise.file, 'Expertise should reference a file');
    assert.match(
      workerConfig.expertise.file,
      /^expertise\//,
      'Expertise file should be in expertise/ directory'
    );
  });

  test('expertise file reference points to existing template file', async () => {
    const expertisePath = path.join(TEMPLATES_DIR, workerConfig.expertise.file);
    const stat = await fs.stat(expertisePath);
    assert.ok(stat.isFile(), 'Referenced expertise file should exist');
  });

  test('has tools array', () => {
    assert.ok(Array.isArray(workerConfig.tools), 'Should have tools array');
    assert.ok(workerConfig.tools.length > 0, 'Should have at least one tool');
  });

  test('has mcpServers array', () => {
    assert.ok(Array.isArray(workerConfig.mcpServers), 'Should have mcpServers array');
  });

  test('has server selection config', () => {
    assert.ok(workerConfig.server, 'Should have server selection');
    assert.ok(
      workerConfig.server.labels || workerConfig.server.serverId,
      'Should have labels or serverId for server selection'
    );
  });

  test('has deployment config', () => {
    assert.ok(workerConfig.deployment, 'Should have deployment config');
    assert.ok(workerConfig.deployment.replicas, 'Should have replicas');
  });

  test('validates against WorkerConfigSchema', () => {
    // WorkerConfigSchema uses .passthrough() so extra fields are fine
    const result = WorkerConfigSchema.safeParse(workerConfig);
    assert.ok(result.success, `Schema validation failed: ${JSON.stringify(result.error?.issues)}`);
  });
});

// =============================================================================
// Tests: expertise/example.md
// =============================================================================

describe('scaffold templates — expertise/example.md', () => {
  let content;

  beforeEach(async () => {
    content = await fs.readFile(path.join(TEMPLATES_DIR, 'expertise', 'example.md'), 'utf8');
  });

  test('is non-empty', () => {
    assert.ok(content.trim().length > 0, 'Expertise file should not be empty');
  });

  test('has a markdown heading', () => {
    assert.match(content, /^#\s+/m, 'Should have at least one markdown heading');
  });

  test('contains role description', () => {
    assert.match(content, /role/i, 'Should describe the worker role');
  });

  test('contains guidelines or constraints', () => {
    const hasGuidelines = /guidelines?/i.test(content);
    const hasConstraints = /constraints?/i.test(content);
    assert.ok(hasGuidelines || hasConstraints, 'Should have guidelines or constraints');
  });
});

// =============================================================================
// Tests: .gitignore
// =============================================================================

describe('scaffold templates — .gitignore', () => {
  let content;

  beforeEach(async () => {
    content = await fs.readFile(path.join(TEMPLATES_DIR, '.gitignore'), 'utf8');
  });

  test('ignores .env files', () => {
    assert.match(content, /^\.env$/m, 'Should ignore .env');
  });

  test('ignores node_modules/', () => {
    assert.match(content, /node_modules/m, 'Should ignore node_modules');
  });

  test('ignores data/ directory', () => {
    assert.match(content, /^data\/$/m, 'Should ignore data/');
  });

  test('ignores log files', () => {
    assert.match(content, /\*\.log/m, 'Should ignore *.log files');
  });
});

// =============================================================================
// Tests: .env.example
// =============================================================================

describe('scaffold templates — .env.example', () => {
  let content;

  beforeEach(async () => {
    content = await fs.readFile(path.join(TEMPLATES_DIR, '.env.example'), 'utf8');
  });

  test('contains LLM API key placeholder', () => {
    assert.match(content, /OPENROUTER_API_KEY/m, 'Should have OPENROUTER_API_KEY');
  });

  test('contains server host placeholder', () => {
    assert.match(content, /VPS_1_HOST/m, 'Should have VPS_1_HOST');
  });

  test('has instructions not to commit .env', () => {
    assert.match(content, /DO NOT commit/i, 'Should warn not to commit .env');
  });
});

// =============================================================================
// Tests: README.md
// =============================================================================

describe('scaffold templates — README.md', () => {
  let content;

  beforeEach(async () => {
    content = await fs.readFile(path.join(TEMPLATES_DIR, 'README.md'), 'utf8');
  });

  test('has a title heading', () => {
    assert.match(content, /^# /m, 'Should have a title');
  });

  test('has quick start section', () => {
    assert.match(content, /quick start/i, 'Should have Quick Start section');
  });

  test('has project structure section', () => {
    assert.match(content, /project structure/i, 'Should have Project Structure section');
  });

  test('references ai-army validate command', () => {
    assert.match(content, /ai-army validate/m, 'Should reference validate command');
  });

  test('references ai-army deploy command', () => {
    assert.match(content, /ai-army deploy/m, 'Should reference deploy command');
  });

  test('explains environment variable substitution', () => {
    assert.match(content, /\$\{.*\}/m, 'Should explain ${VAR} syntax');
  });

  test('has section on adding new workers', () => {
    assert.match(content, /adding a new worker/i, 'Should explain how to add workers');
  });
});

// =============================================================================
// Tests: ProjectLoader Integration
// =============================================================================

describe('scaffold templates — ProjectLoader integration', () => {
  let tmpDir;
  let cleanup;

  beforeEach(async () => {
    ({ tmpDir, cleanup } = await createResolvableProject());
  });

  afterEach(async () => {
    await cleanup();
  });

  test('ProjectLoader can load the template project without validation', async () => {
    const loader = new ProjectLoader({ validate: false, resolveEnv: false });
    const config = await loader.loadProject(tmpDir);

    assert.ok(config.main, 'Should have main config');
    assert.ok(config.main.llm, 'Should have LLM config');
    assert.ok(Array.isArray(config.workers), 'Should have workers array');
    assert.equal(config.workers.length, 1, 'Should have one worker');
  });

  test('ProjectLoader resolves expertise file content', async () => {
    const loader = new ProjectLoader({ validate: false, resolveEnv: false });
    const config = await loader.loadProject(tmpDir);

    const worker = config.workers[0];
    assert.equal(typeof worker.expertise, 'string', 'Expertise should be resolved to string');
    assert.match(worker.expertise, /Example Worker/, 'Should contain expertise content');
  });

  test('ProjectLoader resolves env vars when set', async () => {
    // Set env vars that the template references
    const origKey = process.env.OPENROUTER_API_KEY;
    const origHost = process.env.VPS_1_HOST;

    process.env.OPENROUTER_API_KEY = 'test-key-12345';
    process.env.VPS_1_HOST = '10.0.0.1';

    try {
      const loader = new ProjectLoader({ validate: false, resolveEnv: true });
      const config = await loader.loadProject(tmpDir);

      assert.equal(config.main.llm.apiKey, 'test-key-12345', 'Should resolve LLM API key');
      assert.equal(config.servers[0].host, '10.0.0.1', 'Should resolve server host');
    } finally {
      // Restore original env
      if (origKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = origKey;
      if (origHost === undefined) delete process.env.VPS_1_HOST;
      else process.env.VPS_1_HOST = origHost;
    }
  });

  test('ProjectLoader validates successfully with resolved env vars', async () => {
    const origKey = process.env.OPENROUTER_API_KEY;
    const origHost = process.env.VPS_1_HOST;

    process.env.OPENROUTER_API_KEY = 'test-key-12345';
    process.env.VPS_1_HOST = '10.0.0.1';

    try {
      const loader = new ProjectLoader({ validate: true, resolveEnv: true });
      const config = await loader.loadProject(tmpDir);

      assert.ok(config, 'Should load and validate without errors');
      assert.ok(config.main.llm.provider, 'Should have resolved LLM provider');
      assert.equal(config.servers.length, 1, 'Should have one server');
      assert.equal(config.workers.length, 1, 'Should have one worker');
    } finally {
      if (origKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = origKey;
      if (origHost === undefined) delete process.env.VPS_1_HOST;
      else process.env.VPS_1_HOST = origHost;
    }
  });

  test('worker references valid expertise file', async () => {
    const loader = new ProjectLoader({ validate: false, resolveEnv: false });
    const config = await loader.loadProject(tmpDir);

    const worker = config.workers[0];
    assert.ok(worker.expertise, 'Worker should have expertise content loaded');
    assert.ok(worker.expertise.length > 50, 'Expertise content should be substantial');
  });
});

// =============================================================================
// Tests: Cross-file Consistency
// =============================================================================

describe('scaffold templates — cross-file consistency', () => {
  test('ai-army.yml worker paths match existing worker files', async () => {
    const mainContent = await fs.readFile(path.join(TEMPLATES_DIR, 'ai-army.yml'), 'utf8');
    const mainConfig = yaml.load(mainContent);

    for (const workerPath of mainConfig.workers) {
      const fullPath = path.join(TEMPLATES_DIR, workerPath);
      const exists = await fs.stat(fullPath).then(
        () => true,
        () => false
      );
      assert.ok(exists, `Worker file "${workerPath}" referenced in ai-army.yml should exist`);
    }
  });

  test('worker expertise references match existing expertise files', async () => {
    const workerContent = await fs.readFile(
      path.join(TEMPLATES_DIR, 'workers', 'example-worker.yml'),
      'utf8'
    );
    const workerConfig = yaml.load(workerContent);

    if (workerConfig.expertise?.file) {
      const expertisePath = path.join(TEMPLATES_DIR, workerConfig.expertise.file);
      const exists = await fs.stat(expertisePath).then(
        () => true,
        () => false
      );
      assert.ok(
        exists,
        `Expertise file "${workerConfig.expertise.file}" referenced in worker should exist`
      );
    }
  });

  test('.env.example contains all env vars referenced in YAML templates', async () => {
    const envContent = await fs.readFile(path.join(TEMPLATES_DIR, '.env.example'), 'utf8');

    // Collect all ${VAR} references from YAML values (skip comment lines)
    const yamlFiles = ['ai-army.yml', 'servers.yml', 'workers/example-worker.yml'];
    const referencedVars = new Set();

    for (const file of yamlFiles) {
      const content = await fs.readFile(path.join(TEMPLATES_DIR, file), 'utf8');
      const lines = content.split('\n');
      for (const line of lines) {
        // Skip comment-only lines
        if (line.trimStart().startsWith('#')) continue;
        const matches = line.matchAll(/\$\{(\w+)\}/g);
        for (const match of matches) {
          referencedVars.add(match[1]);
        }
      }
    }

    for (const varName of referencedVars) {
      assert.ok(
        envContent.includes(varName),
        `.env.example should contain ${varName} (referenced in YAML templates)`
      );
    }
  });
});
