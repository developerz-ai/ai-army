/**
 * Unit tests for FileTools
 *
 * Tests the four file tool factory functions: createReadFileTool,
 * createWriteFileTool, createGlobTool, createGrepTool. Covers Zod schema
 * validation, path sanitization, output truncation, error handling,
 * and tool configuration overrides.
 *
 * Note: These are unit tests with mocked ContainerPool.
 */

import { describe, test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  createReadFileTool,
  createWriteFileTool,
  createGlobTool,
  createGrepTool,
  FileToolsError,
  sanitizePath,
} from '../../../src/tools/file-tools.js';

/**
 * Create a mock ContainerPool with DockerManager
 * @param {Object} [overrides={}] - Override default mock implementations
 * @returns {Object} Mock ContainerPool and related mocks
 */
function createMockContainerPool(overrides = {}) {
  const mockContainer = {
    id: 'container-123',
  };

  const mockDockerManager = {
    exec: mock.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })),
    ...overrides.dockerManager,
  };

  const mockContainerPool = {
    getContainer: mock.fn(async () => mockContainer),
    dockerManager: mockDockerManager,
    ...overrides.pool,
  };

  return { mockContainerPool, mockContainer, mockDockerManager };
}

// ============================================================================
// readFile tool
// ============================================================================

describe('createReadFileTool', () => {
  describe('factory validation', () => {
    let containerPool;

    beforeEach(() => {
      const mocks = createMockContainerPool();
      containerPool = mocks.mockContainerPool;
    });

    test('returns a tool object with description, parameters, and execute', () => {
      const readFile = createReadFileTool(containerPool, 'test-bot');

      assert.ok(readFile, 'Tool should be defined');
      assert.ok(readFile.description, 'Should have description');
      assert.ok(readFile.parameters, 'Should have parameters (Zod schema)');
      assert.equal(typeof readFile.execute, 'function', 'Should have execute function');
    });

    test('description mentions file reading', () => {
      const readFile = createReadFileTool(containerPool, 'test-bot');

      assert.match(readFile.description, /read|file|contents/i);
    });

    test('throws FileToolsError when containerPool is null', () => {
      assert.throws(
        () => createReadFileTool(null, 'test-bot'),
        err => {
          assert.ok(err instanceof FileToolsError);
          assert.equal(err.name, 'FileToolsError');
          assert.match(err.message, /ContainerPool is required/);
          assert.equal(err.operation, 'createReadFileTool');
          return true;
        }
      );
    });

    test('throws FileToolsError when containerPool is undefined', () => {
      assert.throws(
        () => createReadFileTool(undefined, 'test-bot'),
        err => {
          assert.ok(err instanceof FileToolsError);
          return true;
        }
      );
    });

    test('throws FileToolsError when botId is null', () => {
      assert.throws(
        () => createReadFileTool(containerPool, null),
        err => {
          assert.ok(err instanceof FileToolsError);
          assert.match(err.message, /Bot ID must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws FileToolsError when botId is empty string', () => {
      assert.throws(
        () => createReadFileTool(containerPool, ''),
        err => {
          assert.ok(err instanceof FileToolsError);
          assert.match(err.message, /Bot ID must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws FileToolsError when botId is not a string', () => {
      assert.throws(
        () => createReadFileTool(containerPool, 42),
        err => {
          assert.ok(err instanceof FileToolsError);
          return true;
        }
      );
    });

    test('accepts optional toolConfig parameter', () => {
      const readFile = createReadFileTool(containerPool, 'test-bot', {
        maxContentLength: 5000,
        timeout: 10000,
      });

      assert.ok(readFile, 'Should create tool with custom config');
    });
  });

  describe('execute()', () => {
    let containerPool;
    let dockerManager;
    let mockContainer;

    beforeEach(() => {
      const mocks = createMockContainerPool();
      containerPool = mocks.mockContainerPool;
      dockerManager = mocks.mockDockerManager;
      ({ mockContainer } = mocks);
    });

    test('reads file content successfully', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: 'file content here',
        stderr: '',
      }));

      const readFile = createReadFileTool(containerPool, 'test-bot');
      const result = await readFile.execute({ path: '/home/agent/test.txt' });

      assert.equal(result.success, true);
      assert.equal(result.content, 'file content here');
    });

    test('uses cat command for utf8 encoding', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: 'data',
        stderr: '',
      }));

      const readFile = createReadFileTool(containerPool, 'test-bot');
      await readFile.execute({ path: '/home/agent/file.txt' });

      const command = dockerManager.exec.mock.calls[0].arguments[1];
      assert.match(command, /^cat /);
    });

    test('uses base64 command for base64 encoding', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: 'YmluYXJ5',
        stderr: '',
      }));

      const readFile = createReadFileTool(containerPool, 'test-bot');
      await readFile.execute({ path: '/home/agent/image.png', encoding: 'base64' });

      const command = dockerManager.exec.mock.calls[0].arguments[1];
      assert.match(command, /^base64 /);
    });

    test('returns error when file does not exist', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 1,
        stdout: '',
        stderr: 'No such file or directory',
      }));

      const readFile = createReadFileTool(containerPool, 'test-bot');
      const result = await readFile.execute({ path: '/home/agent/missing.txt' });

      assert.equal(result.success, false);
      assert.match(result.error, /No such file/);
    });

    test('passes correct botId to containerPool.getContainer', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
      }));

      const readFile = createReadFileTool(containerPool, 'my-support-bot');
      await readFile.execute({ path: '/home/agent/test.txt' });

      assert.equal(containerPool.getContainer.mock.calls.length, 1);
      assert.equal(containerPool.getContainer.mock.calls[0].arguments[0], 'my-support-bot');
    });

    test('passes correct container to dockerManager.exec', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
      }));

      const readFile = createReadFileTool(containerPool, 'test-bot');
      await readFile.execute({ path: '/home/agent/test.txt' });

      const container = dockerManager.exec.mock.calls[0].arguments[0];
      assert.equal(container, mockContainer);
    });

    test('truncates content exceeding maxContentLength', async () => {
      const longContent = 'x'.repeat(200);
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: longContent,
        stderr: '',
      }));

      const readFile = createReadFileTool(containerPool, 'test-bot', {
        maxContentLength: 100,
      });
      const result = await readFile.execute({ path: '/home/agent/big.txt' });

      assert.equal(result.success, true);
      assert.ok(result.content.length < longContent.length);
      assert.match(result.content, /\.\.\. \[truncated 100 characters\]/);
    });

    test('does not truncate content within limit', async () => {
      const shortContent = 'short file';
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: shortContent,
        stderr: '',
      }));

      const readFile = createReadFileTool(containerPool, 'test-bot');
      const result = await readFile.execute({ path: '/home/agent/short.txt' });

      assert.equal(result.content, shortContent);
    });

    test('returns error for paths with dangerous characters', async () => {
      const readFile = createReadFileTool(containerPool, 'test-bot');
      const result = await readFile.execute({ path: '/home/agent/$(whoami).txt' });

      assert.equal(result.success, false);
      assert.match(result.error, /dangerous characters/);
      assert.equal(dockerManager.exec.mock.calls.length, 0);
    });

    test('returns error result when getContainer fails', async () => {
      containerPool.getContainer = mock.fn(async () => {
        throw new Error('Container not found');
      });

      const readFile = createReadFileTool(containerPool, 'test-bot');
      const result = await readFile.execute({ path: '/home/agent/test.txt' });

      assert.equal(result.success, false);
      assert.match(result.error, /Execution error: Container not found/);
    });

    test('returns error result when exec fails', async () => {
      dockerManager.exec = mock.fn(async () => {
        throw new Error('Docker exec timed out');
      });

      const readFile = createReadFileTool(containerPool, 'test-bot');
      const result = await readFile.execute({ path: '/home/agent/test.txt' });

      assert.equal(result.success, false);
      assert.match(result.error, /Execution error: Docker exec timed out/);
    });

    test('never throws from execute (returns error result)', async () => {
      containerPool.getContainer = mock.fn(async () => {
        throw new Error('Pool exhausted');
      });

      const readFile = createReadFileTool(containerPool, 'test-bot');
      const result = await readFile.execute({ path: '/home/agent/test.txt' });

      assert.equal(result.success, false);
      assert.ok(result.error.length > 0);
    });
  });

  describe('Zod parameter schema', () => {
    let containerPool;

    beforeEach(() => {
      const mocks = createMockContainerPool();
      containerPool = mocks.mockContainerPool;
    });

    test('accepts valid path', () => {
      const readFile = createReadFileTool(containerPool, 'test-bot');
      const result = readFile.parameters.safeParse({ path: '/home/agent/test.txt' });

      assert.equal(result.success, true);
    });

    test('rejects missing path', () => {
      const readFile = createReadFileTool(containerPool, 'test-bot');
      const result = readFile.parameters.safeParse({});

      assert.equal(result.success, false);
    });

    test('rejects non-string path', () => {
      const readFile = createReadFileTool(containerPool, 'test-bot');
      const result = readFile.parameters.safeParse({ path: 42 });

      assert.equal(result.success, false);
    });

    test('accepts optional encoding (utf8)', () => {
      const readFile = createReadFileTool(containerPool, 'test-bot');
      const result = readFile.parameters.safeParse({
        path: '/home/agent/file.txt',
        encoding: 'utf8',
      });

      assert.equal(result.success, true);
      assert.equal(result.data.encoding, 'utf8');
    });

    test('accepts optional encoding (base64)', () => {
      const readFile = createReadFileTool(containerPool, 'test-bot');
      const result = readFile.parameters.safeParse({
        path: '/home/agent/image.png',
        encoding: 'base64',
      });

      assert.equal(result.success, true);
      assert.equal(result.data.encoding, 'base64');
    });

    test('rejects invalid encoding', () => {
      const readFile = createReadFileTool(containerPool, 'test-bot');
      const result = readFile.parameters.safeParse({
        path: '/home/agent/file.txt',
        encoding: 'latin1',
      });

      assert.equal(result.success, false);
    });

    test('accepts path without encoding', () => {
      const readFile = createReadFileTool(containerPool, 'test-bot');
      const result = readFile.parameters.safeParse({ path: '/home/agent/file.txt' });

      assert.equal(result.success, true);
      assert.equal(result.data.encoding, undefined);
    });
  });
});

// ============================================================================
// writeFile tool
// ============================================================================

describe('createWriteFileTool', () => {
  describe('factory validation', () => {
    let containerPool;

    beforeEach(() => {
      const mocks = createMockContainerPool();
      containerPool = mocks.mockContainerPool;
    });

    test('returns a tool object with description, parameters, and execute', () => {
      const writeFile = createWriteFileTool(containerPool, 'test-bot');

      assert.ok(writeFile, 'Tool should be defined');
      assert.ok(writeFile.description, 'Should have description');
      assert.ok(writeFile.parameters, 'Should have parameters');
      assert.equal(typeof writeFile.execute, 'function', 'Should have execute function');
    });

    test('description mentions writing files', () => {
      const writeFile = createWriteFileTool(containerPool, 'test-bot');

      assert.match(writeFile.description, /write|file|content/i);
    });

    test('throws FileToolsError when containerPool is null', () => {
      assert.throws(
        () => createWriteFileTool(null, 'test-bot'),
        err => {
          assert.ok(err instanceof FileToolsError);
          assert.match(err.message, /ContainerPool is required/);
          assert.equal(err.operation, 'createWriteFileTool');
          return true;
        }
      );
    });

    test('throws FileToolsError when botId is empty', () => {
      assert.throws(
        () => createWriteFileTool(containerPool, ''),
        err => {
          assert.ok(err instanceof FileToolsError);
          assert.match(err.message, /Bot ID must be a non-empty string/);
          return true;
        }
      );
    });
  });

  describe('execute()', () => {
    let containerPool;
    let dockerManager;

    beforeEach(() => {
      const mocks = createMockContainerPool();
      containerPool = mocks.mockContainerPool;
      dockerManager = mocks.mockDockerManager;
    });

    test('writes file content successfully', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
      }));

      const writeFile = createWriteFileTool(containerPool, 'test-bot');
      const result = await writeFile.execute({
        path: '/home/agent/output.txt',
        content: 'hello world',
      });

      assert.equal(result.success, true);
    });

    test('creates parent directories before writing', async () => {
      const execCalls = [];
      dockerManager.exec = mock.fn(async (_container, cmd) => {
        execCalls.push(cmd);
        return { exitCode: 0, stdout: '', stderr: '' };
      });

      const writeFile = createWriteFileTool(containerPool, 'test-bot');
      await writeFile.execute({
        path: '/home/agent/deep/nested/file.txt',
        content: 'data',
      });

      // First call should be mkdir -p
      assert.match(execCalls[0], /mkdir -p/);
      assert.match(execCalls[0], /\/home\/agent\/deep\/nested/);
    });

    test('does not create directory for relative path without slash', async () => {
      const execCalls = [];
      dockerManager.exec = mock.fn(async (_container, cmd) => {
        execCalls.push(cmd);
        return { exitCode: 0, stdout: '', stderr: '' };
      });

      const writeFile = createWriteFileTool(containerPool, 'test-bot');
      await writeFile.execute({
        path: 'file.txt',
        content: 'data',
      });

      // Should only have the write command, no mkdir -p
      assert.equal(execCalls.length, 1);
      assert.ok(!execCalls[0].includes('mkdir'));
    });

    test('does not create directory for root-relative path like /file.txt', async () => {
      const execCalls = [];
      dockerManager.exec = mock.fn(async (_container, cmd) => {
        execCalls.push(cmd);
        return { exitCode: 0, stdout: '', stderr: '' };
      });

      const writeFile = createWriteFileTool(containerPool, 'test-bot');
      await writeFile.execute({
        path: '/file.txt',
        content: 'data',
      });

      // lastIndexOf('/') is 0, so lastSlash > 0 is false, no mkdir
      assert.equal(execCalls.length, 1);
      assert.ok(!execCalls[0].includes('mkdir'));
    });

    test('uses heredoc for content transfer', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
      }));

      const writeFile = createWriteFileTool(containerPool, 'test-bot');
      await writeFile.execute({
        path: '/home/agent/test.txt',
        content: 'hello world',
      });

      // The write command should use heredoc (cat >> ... << EOF) with timestamp + random hex
      const writeCmd = dockerManager.exec.mock.calls[1].arguments[1];
      assert.match(writeCmd, /cat >.*<<.*'_AI_ARMY_EOF_\d+_[0-9a-f]+'/);
      assert.ok(writeCmd.includes('hello world'));
    });

    test('uses >> operator for append mode', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
      }));

      const writeFile = createWriteFileTool(containerPool, 'test-bot');
      await writeFile.execute({
        path: '/home/agent/log.txt',
        content: 'appended line',
        append: true,
      });

      const writeCmd = dockerManager.exec.mock.calls[1].arguments[1];
      assert.match(writeCmd, /cat >>.*"/);
    });

    test('uses > operator for overwrite mode (default)', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
      }));

      const writeFile = createWriteFileTool(containerPool, 'test-bot');
      await writeFile.execute({
        path: '/home/agent/file.txt',
        content: 'overwrite',
      });

      const writeCmd = dockerManager.exec.mock.calls[1].arguments[1];
      // Should have > but not >>
      assert.match(writeCmd, /cat >[^>]/);
    });

    test('returns error for paths with dangerous characters', async () => {
      const writeFile = createWriteFileTool(containerPool, 'test-bot');
      const result = await writeFile.execute({
        path: '/home/agent/`rm -rf`/file.txt',
        content: 'data',
      });

      assert.equal(result.success, false);
      assert.match(result.error, /dangerous characters/);
    });

    test('returns error when exec fails', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 1,
        stdout: '',
        stderr: 'Permission denied',
      }));

      const writeFile = createWriteFileTool(containerPool, 'test-bot');
      const result = await writeFile.execute({
        path: '/root/forbidden.txt',
        content: 'data',
      });

      assert.equal(result.success, false);
      assert.ok(result.error.length > 0);
    });

    test('returns error result when getContainer fails', async () => {
      containerPool.getContainer = mock.fn(async () => {
        throw new Error('Container not found');
      });

      const writeFile = createWriteFileTool(containerPool, 'test-bot');
      const result = await writeFile.execute({
        path: '/home/agent/test.txt',
        content: 'data',
      });

      assert.equal(result.success, false);
      assert.match(result.error, /Execution error/);
    });

    test('never throws from execute (returns error result)', async () => {
      containerPool.getContainer = mock.fn(async () => {
        throw new Error('Pool exhausted');
      });

      const writeFile = createWriteFileTool(containerPool, 'test-bot');
      const result = await writeFile.execute({
        path: '/home/agent/test.txt',
        content: 'data',
      });

      assert.equal(result.success, false);
      assert.ok(result.error.length > 0);
    });
  });

  describe('Zod parameter schema', () => {
    let containerPool;

    beforeEach(() => {
      const mocks = createMockContainerPool();
      containerPool = mocks.mockContainerPool;
    });

    test('accepts valid path and content', () => {
      const writeFile = createWriteFileTool(containerPool, 'test-bot');
      const result = writeFile.parameters.safeParse({
        path: '/home/agent/test.txt',
        content: 'hello',
      });

      assert.equal(result.success, true);
    });

    test('rejects missing path', () => {
      const writeFile = createWriteFileTool(containerPool, 'test-bot');
      const result = writeFile.parameters.safeParse({ content: 'hello' });

      assert.equal(result.success, false);
    });

    test('rejects missing content', () => {
      const writeFile = createWriteFileTool(containerPool, 'test-bot');
      const result = writeFile.parameters.safeParse({ path: '/home/agent/test.txt' });

      assert.equal(result.success, false);
    });

    test('accepts optional append parameter', () => {
      const writeFile = createWriteFileTool(containerPool, 'test-bot');
      const result = writeFile.parameters.safeParse({
        path: '/home/agent/test.txt',
        content: 'data',
        append: true,
      });

      assert.equal(result.success, true);
      assert.equal(result.data.append, true);
    });

    test('rejects non-boolean append', () => {
      const writeFile = createWriteFileTool(containerPool, 'test-bot');
      const result = writeFile.parameters.safeParse({
        path: '/home/agent/test.txt',
        content: 'data',
        append: 'yes',
      });

      assert.equal(result.success, false);
    });
  });
});

// ============================================================================
// glob tool
// ============================================================================

describe('createGlobTool', () => {
  describe('factory validation', () => {
    let containerPool;

    beforeEach(() => {
      const mocks = createMockContainerPool();
      containerPool = mocks.mockContainerPool;
    });

    test('returns a tool object with description, parameters, and execute', () => {
      const glob = createGlobTool(containerPool, 'test-bot');

      assert.ok(glob, 'Tool should be defined');
      assert.ok(glob.description, 'Should have description');
      assert.ok(glob.parameters, 'Should have parameters');
      assert.equal(typeof glob.execute, 'function', 'Should have execute function');
    });

    test('description mentions finding files', () => {
      const glob = createGlobTool(containerPool, 'test-bot');

      assert.match(glob.description, /find|files|pattern|glob/i);
    });

    test('throws FileToolsError when containerPool is null', () => {
      assert.throws(
        () => createGlobTool(null, 'test-bot'),
        err => {
          assert.ok(err instanceof FileToolsError);
          assert.match(err.message, /ContainerPool is required/);
          assert.equal(err.operation, 'createGlobTool');
          return true;
        }
      );
    });

    test('throws FileToolsError when botId is empty', () => {
      assert.throws(
        () => createGlobTool(containerPool, ''),
        err => {
          assert.ok(err instanceof FileToolsError);
          return true;
        }
      );
    });
  });

  describe('execute()', () => {
    let containerPool;
    let dockerManager;

    beforeEach(() => {
      const mocks = createMockContainerPool();
      containerPool = mocks.mockContainerPool;
      dockerManager = mocks.mockDockerManager;
    });

    test('returns list of matching files', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: '/home/agent/src/app.js\n/home/agent/src/index.js\n',
        stderr: '',
      }));

      const glob = createGlobTool(containerPool, 'test-bot');
      const result = await glob.execute({ pattern: '*.js' });

      assert.equal(result.success, true);
      assert.deepEqual(result.files, ['/home/agent/src/app.js', '/home/agent/src/index.js']);
    });

    test('returns empty array when no files match', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
      }));

      const glob = createGlobTool(containerPool, 'test-bot');
      const result = await glob.execute({ pattern: '*.nonexistent' });

      assert.equal(result.success, true);
      assert.deepEqual(result.files, []);
    });

    test('uses default cwd /home/agent', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
      }));

      const glob = createGlobTool(containerPool, 'test-bot');
      await glob.execute({ pattern: '*.js' });

      const command = dockerManager.exec.mock.calls[0].arguments[1];
      assert.match(command, /\/home\/agent/);
    });

    test('uses custom cwd when provided', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
      }));

      const glob = createGlobTool(containerPool, 'test-bot');
      await glob.execute({ pattern: '*.js', cwd: '/home/agent/src' });

      const command = dockerManager.exec.mock.calls[0].arguments[1];
      assert.match(command, /\/home\/agent\/src/);
    });

    test('uses find command with -name for simple patterns', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
      }));

      const glob = createGlobTool(containerPool, 'test-bot');
      await glob.execute({ pattern: '*.js' });

      const command = dockerManager.exec.mock.calls[0].arguments[1];
      assert.match(command, /find/);
      assert.match(command, /-name "\*\.js"/);
      assert.match(command, /-type f/);
    });

    test('uses find command with -path for patterns containing /', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
      }));

      const glob = createGlobTool(containerPool, 'test-bot');
      await glob.execute({ pattern: 'src/*.js' });

      const command = dockerManager.exec.mock.calls[0].arguments[1];
      assert.match(command, /find/);
      // Prefixed with * so -path matches full paths (e.g. /home/agent/src/app.js)
      assert.match(command, /-path "\*src\/\*\.js"/);
      assert.match(command, /-type f/);
    });

    test('does not double-prefix patterns already starting with *', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
      }));

      const glob = createGlobTool(containerPool, 'test-bot');
      await glob.execute({ pattern: '*/src/*.js' });

      const command = dockerManager.exec.mock.calls[0].arguments[1];
      // Should not have ** prefix, pattern already starts with *
      assert.match(command, /-path "\*\/src\/\*\.js"/);
    });

    test('converts ** to * in path patterns for find compatibility', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
      }));

      const glob = createGlobTool(containerPool, 'test-bot');
      await glob.execute({ pattern: '**/*.ts' });

      const command = dockerManager.exec.mock.calls[0].arguments[1];
      assert.match(command, /-path "\*\/\*\.ts"/);
    });

    test('limits results with head command', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
      }));

      const glob = createGlobTool(containerPool, 'test-bot');
      await glob.execute({ pattern: '*.js' });

      const command = dockerManager.exec.mock.calls[0].arguments[1];
      assert.match(command, /head -\d+/);
    });

    test('respects custom maxResults from toolConfig', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
      }));

      const glob = createGlobTool(containerPool, 'test-bot', { maxResults: 10 });
      await glob.execute({ pattern: '*.js' });

      const command = dockerManager.exec.mock.calls[0].arguments[1];
      assert.match(command, /head -10/);
    });

    test('filters empty lines from output', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: '/home/agent/a.js\n\n/home/agent/b.js\n\n',
        stderr: '',
      }));

      const glob = createGlobTool(containerPool, 'test-bot');
      const result = await glob.execute({ pattern: '*.js' });

      assert.deepEqual(result.files, ['/home/agent/a.js', '/home/agent/b.js']);
    });

    test('returns error for cwd with dangerous characters', async () => {
      const glob = createGlobTool(containerPool, 'test-bot');
      const result = await glob.execute({
        pattern: '*.js',
        cwd: '/home/agent/$(rm -rf /)',
      });

      assert.equal(result.success, false);
      assert.match(result.error, /dangerous characters/);
    });

    test('returns error for pattern with dangerous characters', async () => {
      const glob = createGlobTool(containerPool, 'test-bot');
      const result = await glob.execute({
        pattern: '$(whoami)',
      });

      assert.equal(result.success, false);
      assert.match(result.error, /dangerous characters/);
    });

    test('returns error result when getContainer fails', async () => {
      containerPool.getContainer = mock.fn(async () => {
        throw new Error('Container not found');
      });

      const glob = createGlobTool(containerPool, 'test-bot');
      const result = await glob.execute({ pattern: '*.js' });

      assert.equal(result.success, false);
      assert.deepEqual(result.files, []);
      assert.match(result.error, /Execution error/);
    });

    test('never throws from execute (returns error result)', async () => {
      containerPool.getContainer = mock.fn(async () => {
        throw new Error('Pool exhausted');
      });

      const glob = createGlobTool(containerPool, 'test-bot');
      const result = await glob.execute({ pattern: '*.js' });

      assert.equal(result.success, false);
      assert.deepEqual(result.files, []);
    });
  });

  describe('Zod parameter schema', () => {
    let containerPool;

    beforeEach(() => {
      const mocks = createMockContainerPool();
      containerPool = mocks.mockContainerPool;
    });

    test('accepts valid pattern', () => {
      const glob = createGlobTool(containerPool, 'test-bot');
      const result = glob.parameters.safeParse({ pattern: '*.js' });

      assert.equal(result.success, true);
    });

    test('rejects missing pattern', () => {
      const glob = createGlobTool(containerPool, 'test-bot');
      const result = glob.parameters.safeParse({});

      assert.equal(result.success, false);
    });

    test('accepts optional cwd', () => {
      const glob = createGlobTool(containerPool, 'test-bot');
      const result = glob.parameters.safeParse({
        pattern: '*.js',
        cwd: '/home/agent/src',
      });

      assert.equal(result.success, true);
      assert.equal(result.data.cwd, '/home/agent/src');
    });

    test('accepts pattern without cwd', () => {
      const glob = createGlobTool(containerPool, 'test-bot');
      const result = glob.parameters.safeParse({ pattern: '**/*.ts' });

      assert.equal(result.success, true);
      assert.equal(result.data.cwd, undefined);
    });
  });
});

// ============================================================================
// grep tool
// ============================================================================

describe('createGrepTool', () => {
  describe('factory validation', () => {
    let containerPool;

    beforeEach(() => {
      const mocks = createMockContainerPool();
      containerPool = mocks.mockContainerPool;
    });

    test('returns a tool object with description, parameters, and execute', () => {
      const grep = createGrepTool(containerPool, 'test-bot');

      assert.ok(grep, 'Tool should be defined');
      assert.ok(grep.description, 'Should have description');
      assert.ok(grep.parameters, 'Should have parameters');
      assert.equal(typeof grep.execute, 'function', 'Should have execute function');
    });

    test('description mentions searching', () => {
      const grep = createGrepTool(containerPool, 'test-bot');

      assert.match(grep.description, /search|text|pattern/i);
    });

    test('throws FileToolsError when containerPool is null', () => {
      assert.throws(
        () => createGrepTool(null, 'test-bot'),
        err => {
          assert.ok(err instanceof FileToolsError);
          assert.match(err.message, /ContainerPool is required/);
          assert.equal(err.operation, 'createGrepTool');
          return true;
        }
      );
    });

    test('throws FileToolsError when botId is empty', () => {
      assert.throws(
        () => createGrepTool(containerPool, ''),
        err => {
          assert.ok(err instanceof FileToolsError);
          return true;
        }
      );
    });
  });

  describe('execute()', () => {
    let containerPool;
    let dockerManager;

    beforeEach(() => {
      const mocks = createMockContainerPool();
      containerPool = mocks.mockContainerPool;
      dockerManager = mocks.mockDockerManager;
    });

    test('returns matches from grep output', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout:
          '/home/agent/app.js:10:const foo = "bar";\n/home/agent/app.js:25:const baz = "bar";\n',
        stderr: '',
      }));

      const grep = createGrepTool(containerPool, 'test-bot');
      const result = await grep.execute({ pattern: 'bar' });

      assert.equal(result.success, true);
      assert.equal(result.matches.length, 2);
      assert.equal(result.matches[0].file, '/home/agent/app.js');
      assert.equal(result.matches[0].line, 10);
      assert.equal(result.matches[0].text, 'const foo = "bar";');
      assert.equal(result.matches[1].line, 25);
    });

    test('returns empty matches when no results (exit code 1)', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 1,
        stdout: '',
        stderr: '',
      }));

      const grep = createGrepTool(containerPool, 'test-bot');
      const result = await grep.execute({ pattern: 'nonexistent-pattern' });

      assert.equal(result.success, true);
      assert.deepEqual(result.matches, []);
    });

    test('uses default search path /home/agent', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 1,
        stdout: '',
        stderr: '',
      }));

      const grep = createGrepTool(containerPool, 'test-bot');
      await grep.execute({ pattern: 'test' });

      const command = dockerManager.exec.mock.calls[0].arguments[1];
      assert.match(command, /\/home\/agent/);
    });

    test('uses custom search path', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 1,
        stdout: '',
        stderr: '',
      }));

      const grep = createGrepTool(containerPool, 'test-bot');
      await grep.execute({ pattern: 'test', path: '/home/agent/src' });

      const command = dockerManager.exec.mock.calls[0].arguments[1];
      assert.match(command, /\/home\/agent\/src/);
    });

    test('adds -i flag for case-insensitive search', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 1,
        stdout: '',
        stderr: '',
      }));

      const grep = createGrepTool(containerPool, 'test-bot');
      await grep.execute({
        pattern: 'test',
        options: { ignoreCase: true },
      });

      const command = dockerManager.exec.mock.calls[0].arguments[1];
      assert.match(command, /grep -rnH -i/);
    });

    test('adds -m flag for maxMatches option', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 1,
        stdout: '',
        stderr: '',
      }));

      const grep = createGrepTool(containerPool, 'test-bot');
      await grep.execute({
        pattern: 'test',
        options: { maxMatches: 5 },
      });

      const command = dockerManager.exec.mock.calls[0].arguments[1];
      assert.match(command, /-m 5/);
    });

    test('uses grep -rn command', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 1,
        stdout: '',
        stderr: '',
      }));

      const grep = createGrepTool(containerPool, 'test-bot');
      await grep.execute({ pattern: 'test' });

      const command = dockerManager.exec.mock.calls[0].arguments[1];
      assert.match(command, /grep -rnH/);
    });

    test('pipes through head to limit results', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 1,
        stdout: '',
        stderr: '',
      }));

      const grep = createGrepTool(containerPool, 'test-bot');
      await grep.execute({ pattern: 'test' });

      const command = dockerManager.exec.mock.calls[0].arguments[1];
      assert.match(command, /head -\d+/);
    });

    test('respects custom maxMatches from toolConfig', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 1,
        stdout: '',
        stderr: '',
      }));

      const grep = createGrepTool(containerPool, 'test-bot', { maxMatches: 10 });
      await grep.execute({ pattern: 'test' });

      const command = dockerManager.exec.mock.calls[0].arguments[1];
      assert.match(command, /head -10/);
    });

    test('handles malformed grep output lines gracefully', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 0,
        stdout: '/home/agent/app.js:10:valid line\nmalformed line\n',
        stderr: '',
      }));

      const grep = createGrepTool(containerPool, 'test-bot');
      const result = await grep.execute({ pattern: 'test' });

      assert.equal(result.success, true);
      assert.equal(result.matches.length, 1);
      assert.equal(result.matches[0].file, '/home/agent/app.js');
    });

    test('returns error for path with dangerous characters', async () => {
      const grep = createGrepTool(containerPool, 'test-bot');
      const result = await grep.execute({
        pattern: 'test',
        path: '/home/agent/$(evil)',
      });

      assert.equal(result.success, false);
      assert.deepEqual(result.matches, []);
      assert.match(result.error, /dangerous characters/);
    });

    test('returns error for pattern with shell injection characters', async () => {
      const grep = createGrepTool(containerPool, 'test-bot');
      const result = await grep.execute({
        pattern: '$(whoami)',
      });

      assert.equal(result.success, false);
      assert.deepEqual(result.matches, []);
      assert.match(result.error, /dangerous characters/);
    });

    test('returns error for pattern with double quotes (prevents quote escaping)', async () => {
      const grep = createGrepTool(containerPool, 'test-bot');
      const result = await grep.execute({
        pattern: 'foo" -R /',
      });

      assert.equal(result.success, false);
      assert.deepEqual(result.matches, []);
      assert.match(result.error, /dangerous characters/);
    });

    test('returns error for pattern with backslashes (prevents quote escaping)', async () => {
      const grep = createGrepTool(containerPool, 'test-bot');
      const result = await grep.execute({
        pattern: 'foo\\bar',
      });

      assert.equal(result.success, false);
      assert.deepEqual(result.matches, []);
      assert.match(result.error, /dangerous characters/);
    });

    test('returns error for grep exit code > 1', async () => {
      dockerManager.exec = mock.fn(async () => ({
        exitCode: 2,
        stdout: '',
        stderr: 'grep: invalid regex',
      }));

      const grep = createGrepTool(containerPool, 'test-bot');
      const result = await grep.execute({ pattern: '[invalid' });

      assert.equal(result.success, false);
      assert.deepEqual(result.matches, []);
      assert.ok(result.error.length > 0);
    });

    test('returns error result when getContainer fails', async () => {
      containerPool.getContainer = mock.fn(async () => {
        throw new Error('Container not found');
      });

      const grep = createGrepTool(containerPool, 'test-bot');
      const result = await grep.execute({ pattern: 'test' });

      assert.equal(result.success, false);
      assert.deepEqual(result.matches, []);
      assert.match(result.error, /Execution error/);
    });

    test('never throws from execute (returns error result)', async () => {
      containerPool.getContainer = mock.fn(async () => {
        throw new Error('Pool exhausted');
      });

      const grep = createGrepTool(containerPool, 'test-bot');
      const result = await grep.execute({ pattern: 'test' });

      assert.equal(result.success, false);
      assert.deepEqual(result.matches, []);
    });
  });

  describe('Zod parameter schema', () => {
    let containerPool;

    beforeEach(() => {
      const mocks = createMockContainerPool();
      containerPool = mocks.mockContainerPool;
    });

    test('accepts valid pattern', () => {
      const grep = createGrepTool(containerPool, 'test-bot');
      const result = grep.parameters.safeParse({ pattern: 'TODO' });

      assert.equal(result.success, true);
    });

    test('rejects missing pattern', () => {
      const grep = createGrepTool(containerPool, 'test-bot');
      const result = grep.parameters.safeParse({});

      assert.equal(result.success, false);
    });

    test('accepts optional path', () => {
      const grep = createGrepTool(containerPool, 'test-bot');
      const result = grep.parameters.safeParse({
        pattern: 'test',
        path: '/home/agent/src',
      });

      assert.equal(result.success, true);
      assert.equal(result.data.path, '/home/agent/src');
    });

    test('accepts optional options object', () => {
      const grep = createGrepTool(containerPool, 'test-bot');
      const result = grep.parameters.safeParse({
        pattern: 'test',
        options: { ignoreCase: true, maxMatches: 10 },
      });

      assert.equal(result.success, true);
      assert.equal(result.data.options.ignoreCase, true);
      assert.equal(result.data.options.maxMatches, 10);
    });

    test('accepts pattern without optional params', () => {
      const grep = createGrepTool(containerPool, 'test-bot');
      const result = grep.parameters.safeParse({ pattern: 'search' });

      assert.equal(result.success, true);
      assert.equal(result.data.path, undefined);
      assert.equal(result.data.options, undefined);
    });

    test('rejects non-string pattern', () => {
      const grep = createGrepTool(containerPool, 'test-bot');
      const result = grep.parameters.safeParse({ pattern: 42 });

      assert.equal(result.success, false);
    });

    test('rejects non-boolean ignoreCase in options', () => {
      const grep = createGrepTool(containerPool, 'test-bot');
      const result = grep.parameters.safeParse({
        pattern: 'test',
        options: { ignoreCase: 'yes' },
      });

      assert.equal(result.success, false);
    });

    test('rejects non-number maxMatches in options', () => {
      const grep = createGrepTool(containerPool, 'test-bot');
      const result = grep.parameters.safeParse({
        pattern: 'test',
        options: { maxMatches: 'all' },
      });

      assert.equal(result.success, false);
    });
  });
});

// ============================================================================
// sanitizePath utility
// ============================================================================

describe('sanitizePath', () => {
  test('accepts valid absolute paths', () => {
    assert.deepEqual(sanitizePath('/home/agent/file.txt'), { safe: true });
    assert.deepEqual(sanitizePath('/home/agent/deep/nested/file.js'), { safe: true });
    assert.deepEqual(sanitizePath('/tmp/test'), { safe: true });
  });

  test('accepts valid relative paths', () => {
    assert.deepEqual(sanitizePath('file.txt'), { safe: true });
    assert.deepEqual(sanitizePath('./src/app.js'), { safe: true });
    assert.deepEqual(sanitizePath('../parent/file.txt'), { safe: true });
  });

  test('accepts paths with spaces', () => {
    assert.deepEqual(sanitizePath('/home/agent/my file.txt'), { safe: true });
  });

  test('accepts paths with dots', () => {
    assert.deepEqual(sanitizePath('/home/agent/.config'), { safe: true });
    assert.deepEqual(sanitizePath('/home/agent/file.test.js'), { safe: true });
  });

  test('accepts paths with hyphens and underscores', () => {
    assert.deepEqual(sanitizePath('/home/agent/my-file_name.txt'), { safe: true });
  });

  test('rejects paths with backticks', () => {
    const result = sanitizePath('/home/agent/`whoami`');
    assert.equal(result.safe, false);
    assert.match(result.error, /dangerous characters/);
  });

  test('rejects paths with dollar signs', () => {
    const result = sanitizePath('/home/agent/$HOME');
    assert.equal(result.safe, false);
  });

  test('rejects paths with command substitution', () => {
    const result = sanitizePath('/home/agent/$(rm -rf /)');
    assert.equal(result.safe, false);
  });

  test('rejects paths with semicolons', () => {
    const result = sanitizePath('/home/agent/; rm -rf /');
    assert.equal(result.safe, false);
  });

  test('rejects paths with pipes', () => {
    const result = sanitizePath('/home/agent/| cat /etc/passwd');
    assert.equal(result.safe, false);
  });

  test('rejects paths with ampersands', () => {
    const result = sanitizePath('/home/agent/& echo hacked');
    assert.equal(result.safe, false);
  });

  test('rejects paths with redirects', () => {
    const result = sanitizePath('/home/agent/> /etc/passwd');
    assert.equal(result.safe, false);
  });

  test('rejects paths with double quotes (prevents quote escaping)', () => {
    const result = sanitizePath('test" && rm -rf / && echo "');
    assert.equal(result.safe, false);
    assert.match(result.error, /dangerous characters/);
  });

  test('rejects paths with backslashes (prevents quote escaping)', () => {
    const result = sanitizePath('/home/agent/file\\name');
    assert.equal(result.safe, false);
    assert.match(result.error, /dangerous characters/);
  });

  test('rejects null path', () => {
    const result = sanitizePath(null);
    assert.equal(result.safe, false);
    assert.match(result.error, /non-empty string/);
  });

  test('rejects undefined path', () => {
    const result = sanitizePath(undefined);
    assert.equal(result.safe, false);
  });

  test('rejects empty string path', () => {
    const result = sanitizePath('');
    assert.equal(result.safe, false);
  });

  test('rejects paths exceeding max length', () => {
    const longPath = `/home/agent/${'a'.repeat(4100)}`;
    const result = sanitizePath(longPath);
    assert.equal(result.safe, false);
    assert.match(result.error, /maximum length/);
  });
});

// ============================================================================
// FileToolsError
// ============================================================================

describe('FileToolsError', () => {
  test('extends Error with correct name', () => {
    const err = new FileToolsError('test error');

    assert.ok(err instanceof Error);
    assert.equal(err.name, 'FileToolsError');
    assert.equal(err.message, 'test error');
  });

  test('stores operation, botId, and filePath metadata', () => {
    const err = new FileToolsError('fail', {
      operation: 'createReadFileTool',
      botId: 'support',
      filePath: '/home/agent/test.txt',
    });

    assert.equal(err.operation, 'createReadFileTool');
    assert.equal(err.botId, 'support');
    assert.equal(err.filePath, '/home/agent/test.txt');
  });

  test('stores cause for error chaining', () => {
    const original = new Error('original');
    const err = new FileToolsError('wrapped', { cause: original });

    assert.equal(err.cause, original);
  });

  test('defaults optional fields to undefined', () => {
    const err = new FileToolsError('test');

    assert.equal(err.operation, undefined);
    assert.equal(err.botId, undefined);
    assert.equal(err.filePath, undefined);
    assert.equal(err.cause, undefined);
  });
});

// ============================================================================
// Tool integration pattern
// ============================================================================

describe('File tools integration pattern', () => {
  let containerPool;
  let dockerManager;

  beforeEach(() => {
    const mocks = createMockContainerPool();
    containerPool = mocks.mockContainerPool;
    dockerManager = mocks.mockDockerManager;
  });

  test('all tools can be used as ToolRegistry factory functions', () => {
    const factories = [createReadFileTool, createWriteFileTool, createGlobTool, createGrepTool];

    for (const factory of factories) {
      const toolObj = factory(containerPool, 'test-bot', {});

      assert.ok(toolObj.description);
      assert.ok(toolObj.parameters);
      assert.equal(typeof toolObj.execute, 'function');
    }
  });

  test('multiple tools for different bots are independent', async () => {
    dockerManager.exec = mock.fn(async () => ({
      exitCode: 0,
      stdout: 'content',
      stderr: '',
    }));

    const readA = createReadFileTool(containerPool, 'bot-a');
    const readB = createReadFileTool(containerPool, 'bot-b');

    await readA.execute({ path: '/home/agent/file.txt' });
    await readB.execute({ path: '/home/agent/file.txt' });

    assert.equal(containerPool.getContainer.mock.calls.length, 2);
    assert.equal(containerPool.getContainer.mock.calls[0].arguments[0], 'bot-a');
    assert.equal(containerPool.getContainer.mock.calls[1].arguments[0], 'bot-b');
  });

  test('tools return consistent result shapes on error', async () => {
    containerPool.getContainer = mock.fn(async () => {
      throw new Error('Container down');
    });

    const readFile = createReadFileTool(containerPool, 'test-bot');
    const writeFile = createWriteFileTool(containerPool, 'test-bot');
    const glob = createGlobTool(containerPool, 'test-bot');
    const grep = createGrepTool(containerPool, 'test-bot');

    const readResult = await readFile.execute({ path: '/home/agent/test.txt' });
    assert.ok('success' in readResult);
    assert.ok('error' in readResult);

    const writeResult = await writeFile.execute({
      path: '/home/agent/test.txt',
      content: 'data',
    });
    assert.ok('success' in writeResult);
    assert.ok('error' in writeResult);

    const globResult = await glob.execute({ pattern: '*.js' });
    assert.ok('success' in globResult);
    assert.ok('files' in globResult);
    assert.ok('error' in globResult);

    const grepResult = await grep.execute({ pattern: 'test' });
    assert.ok('success' in grepResult);
    assert.ok('matches' in grepResult);
    assert.ok('error' in grepResult);
  });
});
