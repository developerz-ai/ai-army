/**
 * Integration tests for FileTools (Vercel AI SDK tools)
 *
 * Tests createReadFileTool, createWriteFileTool, createGlobTool, and
 * createGrepTool with real Docker containers via ContainerPool and
 * DockerManager. Covers file operations, path sanitization, output
 * truncation, error handling, and multi-bot isolation.
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
import {
  createReadFileTool,
  createWriteFileTool,
  createGlobTool,
  createGrepTool,
  FileToolsError,
  sanitizePath,
} from '../../../src/tools/file-tools.js';

/**
 * Generate unique container name prefix to avoid conflicts
 */
const TEST_PREFIX = `ai-army-file-tools-test-${Date.now()}`;

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
  console.log('Skipping FileTools integration tests - Docker not available');
  console.log('Ensure Docker is running: docker info');
}

// ============================================================================
// readFile integration tests
// ============================================================================

describe('ReadFileTool Integration', { skip: !DOCKER_AVAILABLE }, () => {
  let dockerManager;
  let pool;
  let readFile;
  let tempDir;
  let botId;

  before(async () => {
    dockerManager = new DockerManager();
    pool = new ContainerPool(dockerManager);

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-army-readfile-test-'));
    botId = `${TEST_PREFIX}-read-${Date.now()}`;

    const botConfig = {
      id: botId,
      sandbox: {
        image: 'alpine:latest',
        memory: '256m',
        cpus: 1,
      },
    };

    await pool.initializeContainer(botId, botConfig, { root: tempDir });
    readFile = createReadFileTool(pool, botId);
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

  it('reads file contents from container', async () => {
    await fs.writeFile(path.join(tempDir, 'hello.txt'), 'hello world');

    const result = await readFile.execute({ path: '/home/agent/hello.txt' });

    assert.equal(result.success, true);
    assert.equal(result.content.trim(), 'hello world');
  });

  it('reads multi-line file', async () => {
    await fs.writeFile(path.join(tempDir, 'multi.txt'), 'line1\nline2\nline3');

    const result = await readFile.execute({ path: '/home/agent/multi.txt' });

    assert.equal(result.success, true);
    assert.ok(result.content.includes('line1'));
    assert.ok(result.content.includes('line2'));
    assert.ok(result.content.includes('line3'));
  });

  it('reads JSON file', async () => {
    const json = JSON.stringify({ key: 'value', num: 42 });
    await fs.writeFile(path.join(tempDir, 'data.json'), json);

    const result = await readFile.execute({ path: '/home/agent/data.json' });

    assert.equal(result.success, true);
    const parsed = JSON.parse(result.content.trim());
    assert.equal(parsed.key, 'value');
    assert.equal(parsed.num, 42);
  });

  it('returns error for non-existent file', async () => {
    const result = await readFile.execute({ path: '/home/agent/nonexistent.txt' });

    assert.equal(result.success, false);
    assert.ok(result.error.length > 0);
  });

  it('reads file with special characters in content', async () => {
    await fs.writeFile(path.join(tempDir, 'special.txt'), 'hello "world" & <foo>');

    const result = await readFile.execute({ path: '/home/agent/special.txt' });

    assert.equal(result.success, true);
    assert.ok(result.content.includes('hello'));
    assert.ok(result.content.includes('"world"'));
  });

  it('reads empty file', async () => {
    await fs.writeFile(path.join(tempDir, 'empty.txt'), '');

    const result = await readFile.execute({ path: '/home/agent/empty.txt' });

    assert.equal(result.success, true);
    assert.equal(result.content.trim(), '');
  });

  it('blocks paths with dangerous characters', async () => {
    const result = await readFile.execute({ path: '/home/agent/$(whoami).txt' });

    assert.equal(result.success, false);
    assert.match(result.error, /dangerous characters/);
  });

  it('truncates large file content', async () => {
    const largeContent = 'x'.repeat(200);
    await fs.writeFile(path.join(tempDir, 'large.txt'), largeContent);

    const shortReadFile = createReadFileTool(pool, botId, { maxContentLength: 100 });
    const result = await shortReadFile.execute({ path: '/home/agent/large.txt' });

    assert.equal(result.success, true);
    assert.ok(result.content.includes('truncated'));
    assert.ok(result.content.length < largeContent.length);
  });

  it('reads files in nested directories', async () => {
    await fs.mkdir(path.join(tempDir, 'nested', 'dir'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'nested', 'dir', 'deep.txt'), 'deep content');

    const result = await readFile.execute({ path: '/home/agent/nested/dir/deep.txt' });

    assert.equal(result.success, true);
    assert.equal(result.content.trim(), 'deep content');
  });

  describe('Vercel AI SDK Compatibility', () => {
    it('has description property', () => {
      assert.ok(readFile.description);
      assert.equal(typeof readFile.description, 'string');
      assert.match(readFile.description, /read|file|contents/i);
    });

    it('has parameters (Zod schema) property', () => {
      assert.ok(readFile.parameters);

      const valid = readFile.parameters.safeParse({ path: '/home/agent/test.txt' });
      assert.equal(valid.success, true);

      const invalid = readFile.parameters.safeParse({});
      assert.equal(invalid.success, false);
    });

    it('has execute function', () => {
      assert.equal(typeof readFile.execute, 'function');
    });
  });
});

// ============================================================================
// writeFile integration tests
// ============================================================================

describe('WriteFileTool Integration', { skip: !DOCKER_AVAILABLE }, () => {
  let dockerManager;
  let pool;
  let writeFile;
  let readFile;
  let tempDir;
  let botId;

  before(async () => {
    dockerManager = new DockerManager();
    pool = new ContainerPool(dockerManager);

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-army-writefile-test-'));
    botId = `${TEST_PREFIX}-write-${Date.now()}`;

    const botConfig = {
      id: botId,
      sandbox: {
        image: 'alpine:latest',
        memory: '256m',
        cpus: 1,
      },
    };

    await pool.initializeContainer(botId, botConfig, { root: tempDir });
    writeFile = createWriteFileTool(pool, botId);
    readFile = createReadFileTool(pool, botId);
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

  it('writes file content and can be read back', async () => {
    const result = await writeFile.execute({
      path: '/home/agent/write-test.txt',
      content: 'hello from writeFile',
    });

    assert.equal(result.success, true);

    const readResult = await readFile.execute({ path: '/home/agent/write-test.txt' });
    assert.equal(readResult.success, true);
    assert.equal(readResult.content.trim(), 'hello from writeFile');
  });

  it('written file is visible on host', async () => {
    await writeFile.execute({
      path: '/home/agent/host-visible.txt',
      content: 'visible on host',
    });

    const hostContent = await fs.readFile(path.join(tempDir, 'host-visible.txt'), 'utf8');
    assert.equal(hostContent.trim(), 'visible on host');
  });

  it('creates nested directories automatically', async () => {
    const result = await writeFile.execute({
      path: '/home/agent/auto/nested/dir/file.txt',
      content: 'auto-created dirs',
    });

    assert.equal(result.success, true);

    const readResult = await readFile.execute({
      path: '/home/agent/auto/nested/dir/file.txt',
    });
    assert.equal(readResult.success, true);
    assert.equal(readResult.content.trim(), 'auto-created dirs');
  });

  it('overwrites existing file by default', async () => {
    await writeFile.execute({
      path: '/home/agent/overwrite.txt',
      content: 'original',
    });

    await writeFile.execute({
      path: '/home/agent/overwrite.txt',
      content: 'overwritten',
    });

    const readResult = await readFile.execute({ path: '/home/agent/overwrite.txt' });
    assert.equal(readResult.content.trim(), 'overwritten');
  });

  it('appends to existing file with append: true', async () => {
    await writeFile.execute({
      path: '/home/agent/append-test.txt',
      content: 'line1',
    });

    await writeFile.execute({
      path: '/home/agent/append-test.txt',
      content: 'line2',
      append: true,
    });

    const readResult = await readFile.execute({ path: '/home/agent/append-test.txt' });
    assert.ok(readResult.content.includes('line1'));
    assert.ok(readResult.content.includes('line2'));
  });

  it('writes multi-line content', async () => {
    await writeFile.execute({
      path: '/home/agent/multiline.txt',
      content: 'line1\nline2\nline3',
    });

    const readResult = await readFile.execute({ path: '/home/agent/multiline.txt' });
    assert.ok(readResult.content.includes('line1'));
    assert.ok(readResult.content.includes('line2'));
    assert.ok(readResult.content.includes('line3'));
  });

  it('writes content with special characters', async () => {
    await writeFile.execute({
      path: '/home/agent/special-write.txt',
      content: 'quotes "here" and single \'ones\' too',
    });

    const readResult = await readFile.execute({ path: '/home/agent/special-write.txt' });
    assert.ok(readResult.content.includes('quotes'));
    assert.ok(readResult.content.includes('"here"'));
  });

  it('blocks paths with dangerous characters', async () => {
    const result = await writeFile.execute({
      path: '/home/agent/$(evil)/file.txt',
      content: 'data',
    });

    assert.equal(result.success, false);
    assert.match(result.error, /dangerous characters/);
  });

  it('returns error for invalid container', async () => {
    const invalidWriteFile = createWriteFileTool(pool, 'nonexistent-bot');
    const result = await invalidWriteFile.execute({
      path: '/home/agent/test.txt',
      content: 'data',
    });

    assert.equal(result.success, false);
    assert.match(result.error, /Execution error/);
  });

  describe('Vercel AI SDK Compatibility', () => {
    it('has description, parameters, and execute', () => {
      assert.ok(writeFile.description);
      assert.ok(writeFile.parameters);
      assert.equal(typeof writeFile.execute, 'function');
    });
  });
});

// ============================================================================
// glob integration tests
// ============================================================================

describe('GlobTool Integration', { skip: !DOCKER_AVAILABLE }, () => {
  let dockerManager;
  let pool;
  let glob;
  let tempDir;
  let botId;

  before(async () => {
    dockerManager = new DockerManager();
    pool = new ContainerPool(dockerManager);

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-army-glob-test-'));
    botId = `${TEST_PREFIX}-glob-${Date.now()}`;

    const botConfig = {
      id: botId,
      sandbox: {
        image: 'alpine:latest',
        memory: '256m',
        cpus: 1,
      },
    };

    await pool.initializeContainer(botId, botConfig, { root: tempDir });
    glob = createGlobTool(pool, botId);

    // Create test file structure
    await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'lib'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'src', 'app.js'), 'const app = {};');
    await fs.writeFile(path.join(tempDir, 'src', 'index.js'), 'export default app;');
    await fs.writeFile(path.join(tempDir, 'src', 'style.css'), 'body {}');
    await fs.writeFile(path.join(tempDir, 'lib', 'utils.js'), 'export const utils = {};');
    await fs.writeFile(path.join(tempDir, 'README.md'), '# Project');
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

  it('finds files matching glob pattern', async () => {
    const result = await glob.execute({ pattern: '*.js', cwd: '/home/agent/src' });

    assert.equal(result.success, true);
    assert.ok(result.files.length >= 2);
    assert.ok(result.files.some(f => f.includes('app.js')));
    assert.ok(result.files.some(f => f.includes('index.js')));
  });

  it('finds files in nested directories', async () => {
    const result = await glob.execute({ pattern: '*.js' });

    assert.equal(result.success, true);
    assert.ok(result.files.length >= 3); // app.js, index.js, utils.js
  });

  it('filters by extension', async () => {
    const result = await glob.execute({ pattern: '*.css', cwd: '/home/agent/src' });

    assert.equal(result.success, true);
    assert.ok(result.files.some(f => f.includes('style.css')));
    assert.ok(!result.files.some(f => f.includes('.js')));
  });

  it('returns empty list when no files match', async () => {
    const result = await glob.execute({ pattern: '*.nonexistent' });

    assert.equal(result.success, true);
    assert.deepEqual(result.files, []);
  });

  it('uses default cwd /home/agent', async () => {
    const result = await glob.execute({ pattern: '*.md' });

    assert.equal(result.success, true);
    assert.ok(result.files.some(f => f.includes('README.md')));
  });

  it('respects custom cwd', async () => {
    const result = await glob.execute({ pattern: '*.js', cwd: '/home/agent/lib' });

    assert.equal(result.success, true);
    assert.ok(result.files.some(f => f.includes('utils.js')));
    // Should not find src/*.js files when cwd is lib
    assert.ok(!result.files.some(f => f.includes('app.js')));
  });

  it('blocks cwd with dangerous characters', async () => {
    const result = await glob.execute({
      pattern: '*.js',
      cwd: '/home/agent/$(rm -rf /)',
    });

    assert.equal(result.success, false);
    assert.match(result.error, /dangerous characters/);
  });

  it('limits results to maxResults', async () => {
    const limitedGlob = createGlobTool(pool, botId, { maxResults: 2 });
    const result = await limitedGlob.execute({ pattern: '*.js' });

    assert.equal(result.success, true);
    assert.ok(result.files.length <= 2);
  });

  describe('Vercel AI SDK Compatibility', () => {
    it('has description, parameters, and execute', () => {
      assert.ok(glob.description);
      assert.ok(glob.parameters);
      assert.equal(typeof glob.execute, 'function');
    });
  });
});

// ============================================================================
// grep integration tests
// ============================================================================

describe('GrepTool Integration', { skip: !DOCKER_AVAILABLE }, () => {
  let dockerManager;
  let pool;
  let grep;
  let tempDir;
  let botId;

  before(async () => {
    dockerManager = new DockerManager();
    pool = new ContainerPool(dockerManager);

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-army-grep-test-'));
    botId = `${TEST_PREFIX}-grep-${Date.now()}`;

    const botConfig = {
      id: botId,
      sandbox: {
        image: 'alpine:latest',
        memory: '256m',
        cpus: 1,
      },
    };

    await pool.initializeContainer(botId, botConfig, { root: tempDir });
    grep = createGrepTool(pool, botId);

    // Create test files with searchable content
    await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, 'src', 'app.js'),
      'const app = {};\n// TODO: implement\nconst todo = "done";\n'
    );
    await fs.writeFile(
      path.join(tempDir, 'src', 'utils.js'),
      'export function hello() {\n  return "world";\n}\n// TODO: refactor\n'
    );
    await fs.writeFile(
      path.join(tempDir, 'README.md'),
      '# Project\nThis is a test project.\nNo TODOs here... wait, TODO!\n'
    );
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

  it('finds matches in files', async () => {
    const result = await grep.execute({ pattern: 'TODO' });

    assert.equal(result.success, true);
    assert.ok(result.matches.length >= 2); // at least app.js and utils.js
    assert.ok(result.matches.some(m => m.file.includes('app.js')));
    assert.ok(result.matches.some(m => m.file.includes('utils.js')));
  });

  it('returns file, line, and text for each match', async () => {
    const result = await grep.execute({
      pattern: 'TODO',
      path: '/home/agent/src/app.js',
    });

    assert.equal(result.success, true);
    assert.ok(result.matches.length >= 1);

    const match = result.matches[0];
    assert.ok(match.file);
    assert.equal(typeof match.line, 'number');
    assert.ok(match.line > 0);
    assert.ok(match.text.length > 0);
  });

  it('returns empty matches when pattern not found', async () => {
    const result = await grep.execute({ pattern: 'ZZZZNONEXISTENT' });

    assert.equal(result.success, true);
    assert.deepEqual(result.matches, []);
  });

  it('searches specific file', async () => {
    const result = await grep.execute({
      pattern: 'hello',
      path: '/home/agent/src/utils.js',
    });

    assert.equal(result.success, true);
    assert.ok(result.matches.length >= 1);
    assert.ok(result.matches.every(m => m.file.includes('utils.js')));
  });

  it('searches specific directory', async () => {
    const result = await grep.execute({
      pattern: 'TODO',
      path: '/home/agent/src',
    });

    assert.equal(result.success, true);
    // Only src files, not README.md
    assert.ok(result.matches.every(m => m.file.includes('/src/')));
  });

  it('supports case-insensitive search', async () => {
    const result = await grep.execute({
      pattern: 'todo',
      options: { ignoreCase: true },
    });

    assert.equal(result.success, true);
    // Should find TODO matches even with lowercase pattern
    assert.ok(result.matches.length >= 2);
  });

  it('case-sensitive by default', async () => {
    const upperResult = await grep.execute({ pattern: 'TODO' });
    const lowerResult = await grep.execute({ pattern: 'todo' });

    // The results should be different because of case sensitivity
    assert.equal(upperResult.success, true);
    assert.equal(lowerResult.success, true);
    // 'todo' lowercase only appears in app.js (const todo = "done")
    // 'TODO' uppercase appears in comments
    assert.notDeepEqual(
      upperResult.matches.map(m => m.text),
      lowerResult.matches.map(m => m.text)
    );
  });

  it('supports maxMatches per-file option', async () => {
    const result = await grep.execute({
      pattern: 'TODO',
      path: '/home/agent/README.md',
      options: { maxMatches: 1 },
    });

    assert.equal(result.success, true);
    assert.ok(result.matches.length <= 1);
  });

  it('blocks paths with dangerous characters', async () => {
    const result = await grep.execute({
      pattern: 'test',
      path: '/home/agent/$(evil)',
    });

    assert.equal(result.success, false);
    assert.deepEqual(result.matches, []);
    assert.match(result.error, /dangerous characters/);
  });

  it('blocks patterns with shell injection', async () => {
    const result = await grep.execute({
      pattern: '$(whoami)',
    });

    assert.equal(result.success, false);
    assert.deepEqual(result.matches, []);
    assert.match(result.error, /dangerous characters/);
  });

  it('returns error for invalid container', async () => {
    const invalidGrep = createGrepTool(pool, 'nonexistent-bot');
    const result = await invalidGrep.execute({ pattern: 'test' });

    assert.equal(result.success, false);
    assert.deepEqual(result.matches, []);
    assert.match(result.error, /Execution error/);
  });

  describe('Vercel AI SDK Compatibility', () => {
    it('has description, parameters, and execute', () => {
      assert.ok(grep.description);
      assert.ok(grep.parameters);
      assert.equal(typeof grep.execute, 'function');
    });

    it('parameters accept optional path and options', () => {
      const valid = grep.parameters.safeParse({
        pattern: 'test',
        path: '/home/agent',
        options: { ignoreCase: true },
      });
      assert.equal(valid.success, true);
    });
  });
});

// ============================================================================
// Cross-tool workflow integration
// ============================================================================

describe('FileTools Cross-Tool Workflow', { skip: !DOCKER_AVAILABLE }, () => {
  let dockerManager;
  let pool;
  let readFile;
  let writeFile;
  let glob;
  let grep;
  let tempDir;
  let botId;

  before(async () => {
    dockerManager = new DockerManager();
    pool = new ContainerPool(dockerManager);

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-army-workflow-test-'));
    botId = `${TEST_PREFIX}-workflow-${Date.now()}`;

    const botConfig = {
      id: botId,
      sandbox: {
        image: 'alpine:latest',
        memory: '256m',
        cpus: 1,
      },
    };

    await pool.initializeContainer(botId, botConfig, { root: tempDir });

    readFile = createReadFileTool(pool, botId);
    writeFile = createWriteFileTool(pool, botId);
    glob = createGlobTool(pool, botId);
    grep = createGrepTool(pool, botId);
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

  it('write → read roundtrip', async () => {
    await writeFile.execute({
      path: '/home/agent/roundtrip.txt',
      content: 'roundtrip data',
    });

    const result = await readFile.execute({ path: '/home/agent/roundtrip.txt' });

    assert.equal(result.success, true);
    assert.equal(result.content.trim(), 'roundtrip data');
  });

  it('write → glob → read workflow', async () => {
    // Write several files
    await writeFile.execute({
      path: '/home/agent/project/a.js',
      content: 'const a = 1;',
    });
    await writeFile.execute({
      path: '/home/agent/project/b.js',
      content: 'const b = 2;',
    });
    await writeFile.execute({
      path: '/home/agent/project/c.txt',
      content: 'text file',
    });

    // Find JS files
    const globResult = await glob.execute({
      pattern: '*.js',
      cwd: '/home/agent/project',
    });
    assert.equal(globResult.success, true);
    assert.ok(globResult.files.length >= 2);

    // Read each found file
    for (const file of globResult.files) {
      const readResult = await readFile.execute({ path: file });
      assert.equal(readResult.success, true);
      assert.ok(readResult.content.includes('const'));
    }
  });

  it('write → grep → read workflow', async () => {
    // Write files with searchable content
    await writeFile.execute({
      path: '/home/agent/search/config.js',
      content: 'const SECRET_KEY = "hidden";\nconst name = "app";',
    });
    await writeFile.execute({
      path: '/home/agent/search/main.js',
      content: 'import config from "./config";\nconst SECRET_TOKEN = "abc";',
    });

    // Search for SECRET
    const grepResult = await grep.execute({
      pattern: 'SECRET',
      path: '/home/agent/search',
    });
    assert.equal(grepResult.success, true);
    assert.ok(grepResult.matches.length >= 2);

    // Read each file that has matches
    const uniqueFiles = [...new Set(grepResult.matches.map(m => m.file))];
    for (const file of uniqueFiles) {
      const readResult = await readFile.execute({ path: file });
      assert.equal(readResult.success, true);
      assert.ok(readResult.content.includes('SECRET'));
    }
  });

  it('all tools can operate concurrently', async () => {
    // Write a file first
    await writeFile.execute({
      path: '/home/agent/concurrent.txt',
      content: 'concurrent test data',
    });

    // Run all tools concurrently
    const [readResult, globResult, grepResult] = await Promise.all([
      readFile.execute({ path: '/home/agent/concurrent.txt' }),
      glob.execute({ pattern: '*.txt' }),
      grep.execute({ pattern: 'concurrent' }),
    ]);

    assert.equal(readResult.success, true);
    assert.ok(readResult.content.includes('concurrent'));
    assert.equal(globResult.success, true);
    assert.ok(globResult.files.some(f => f.includes('concurrent.txt')));
    assert.equal(grepResult.success, true);
    assert.ok(grepResult.matches.length >= 1);
  });
});

// ============================================================================
// Error handling & edge cases
// ============================================================================

describe('FileTools Error Handling', { skip: !DOCKER_AVAILABLE }, () => {
  let dockerManager;
  let pool;
  let tempDir;
  let botId;

  before(async () => {
    dockerManager = new DockerManager();
    pool = new ContainerPool(dockerManager);

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-army-errors-test-'));
    botId = `${TEST_PREFIX}-errors-${Date.now()}`;

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

  it('factory functions throw FileToolsError for invalid args', () => {
    const factories = [
      ['createReadFileTool', createReadFileTool],
      ['createWriteFileTool', createWriteFileTool],
      ['createGlobTool', createGlobTool],
      ['createGrepTool', createGrepTool],
    ];

    for (const [name, factory] of factories) {
      assert.throws(
        () => factory(null, 'test-bot'),
        err => {
          assert.ok(err instanceof FileToolsError, `${name} should throw FileToolsError`);
          assert.match(err.message, /ContainerPool is required/);
          return true;
        }
      );

      assert.throws(
        () => factory(pool, ''),
        err => {
          assert.ok(err instanceof FileToolsError, `${name} should throw FileToolsError`);
          assert.match(err.message, /Bot ID must be a non-empty string/);
          return true;
        }
      );

      assert.throws(
        () => factory(pool, null),
        err => {
          assert.ok(err instanceof FileToolsError);
          return true;
        }
      );
    }
  });

  it('tools never throw from execute (return error results)', async () => {
    const invalidReadFile = createReadFileTool(pool, 'totally-fake-bot');
    const invalidWriteFile = createWriteFileTool(pool, 'totally-fake-bot');
    const invalidGlob = createGlobTool(pool, 'totally-fake-bot');
    const invalidGrep = createGrepTool(pool, 'totally-fake-bot');

    // None of these should throw
    const readResult = await invalidReadFile.execute({ path: '/home/agent/test.txt' });
    assert.equal(readResult.success, false);

    const writeResult = await invalidWriteFile.execute({
      path: '/home/agent/test.txt',
      content: 'data',
    });
    assert.equal(writeResult.success, false);

    const globResult = await invalidGlob.execute({ pattern: '*.js' });
    assert.equal(globResult.success, false);

    const grepResult = await invalidGrep.execute({ pattern: 'test' });
    assert.equal(grepResult.success, false);
  });

  it('sanitizePath utility blocks command injection', () => {
    assert.equal(sanitizePath('/home/agent/$(rm -rf /)').safe, false);
    assert.equal(sanitizePath('/home/agent/`whoami`').safe, false);
    assert.equal(sanitizePath('/home/agent/; echo hacked').safe, false);
    assert.equal(sanitizePath('/home/agent/| cat /etc/passwd').safe, false);

    assert.equal(sanitizePath('/home/agent/normal-file.txt').safe, true);
    assert.equal(sanitizePath('/home/agent/path with spaces/file.txt').safe, true);
  });
});
