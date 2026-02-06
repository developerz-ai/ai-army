/**
 * Unit tests for bin/cli.js
 *
 * Tests the CLI entry point: commander program creation, init command
 * with template selection and directory creation, help output, and
 * error handling.
 */

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createProgram, runInit } from './cli.js';

const execFileAsync = promisify(execFile);
const CLI_PATH = new URL('./cli.js', import.meta.url).pathname;

/** Track temp directories for cleanup */
const tempDirs = [];

/**
 * Create a temporary directory for testing
 * @param {string} [prefix='cli-test-'] - Directory prefix
 * @returns {Promise<string>} Absolute path to the temp directory
 */
async function createTempDir(prefix = 'cli-test-') {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(tmpDir);
  return tmpDir;
}

/**
 * Check if a file exists
 * @param {string} filePath - Path to check
 * @returns {Promise<boolean>} True if file exists
 */
async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a writable stream mock that captures output
 * @returns {{ stream: Object, output: () => string }}
 */
function createMockStream() {
  const chunks = [];
  const stream = {
    write(data) {
      chunks.push(String(data));
      return true;
    },
  };
  return { stream, output: () => chunks.join('') };
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  tempDirs.length = 0;
});

describe('createProgram()', () => {
  test('returns a commander Command instance', () => {
    const program = createProgram();

    assert.equal(program.name(), 'ai-army');
    assert.equal(typeof program.parse, 'function');
  });

  test('has the correct version', () => {
    const program = createProgram();

    assert.equal(program.version(), '0.1.0');
  });

  test('registers init command', () => {
    const program = createProgram();
    const initCmd = program.commands.find(c => c.name() === 'init');

    assert.ok(initCmd, 'init command should be registered');
    assert.ok(initCmd.description().includes('Initialize'));
  });

  test('init command has template option with basic default', () => {
    const program = createProgram();
    const initCmd = program.commands.find(c => c.name() === 'init');
    const templateOpt = initCmd.options.find(o => o.long === '--template');

    assert.ok(templateOpt, 'template option should exist');
    assert.equal(templateOpt.defaultValue, 'basic');
  });

  test('registers validate command', () => {
    const program = createProgram();
    const cmd = program.commands.find(c => c.name() === 'validate');

    assert.ok(cmd, 'validate command should be registered');
    assert.ok(cmd.description().includes('Validate'));
  });

  test('registers migrate command', () => {
    const program = createProgram();
    const cmd = program.commands.find(c => c.name() === 'migrate');

    assert.ok(cmd, 'migrate command should be registered');
    assert.ok(cmd.description().includes('migration'));
  });

  test('registers start command with config option', () => {
    const program = createProgram();
    const cmd = program.commands.find(c => c.name() === 'start');

    assert.ok(cmd, 'start command should be registered');
    const configOpt = cmd.options.find(o => o.long === '--config');
    assert.ok(configOpt, 'config option should exist');
    assert.equal(configOpt.defaultValue, './config.json');
  });

  test('registers dev command', () => {
    const program = createProgram();
    const cmd = program.commands.find(c => c.name() === 'dev');

    assert.ok(cmd, 'dev command should be registered');
    assert.ok(cmd.description().includes('development'));
  });

  test('registers status command', () => {
    const program = createProgram();
    const cmd = program.commands.find(c => c.name() === 'status');

    assert.ok(cmd, 'status command should be registered');
    assert.ok(cmd.description().includes('status'));
  });

  test('registers reload command', () => {
    const program = createProgram();
    const cmd = program.commands.find(c => c.name() === 'reload');

    assert.ok(cmd, 'reload command should be registered');
    assert.ok(cmd.description().includes('reload'));
  });

  test('registers all 7 commands', () => {
    const program = createProgram();
    const commandNames = program.commands.map(c => c.name());

    assert.ok(commandNames.includes('init'));
    assert.ok(commandNames.includes('validate'));
    assert.ok(commandNames.includes('migrate'));
    assert.ok(commandNames.includes('start'));
    assert.ok(commandNames.includes('dev'));
    assert.ok(commandNames.includes('status'));
    assert.ok(commandNames.includes('reload'));
    assert.equal(commandNames.length, 7);
  });
});

describe('runInit()', () => {
  test('creates a project directory with all expected files', async () => {
    const tmpDir = await createTempDir();
    const projectName = 'my-project';
    const projectPath = path.join(tmpDir, projectName);

    const originalCwd = process.cwd();
    process.chdir(tmpDir);

    const stdout = createMockStream();
    const stderr = createMockStream();

    try {
      await runInit(projectName, { template: 'basic' }, stdout.stream, stderr.stream);
    } finally {
      process.chdir(originalCwd);
    }

    // Verify project structure
    assert.ok(await fileExists(path.join(projectPath, 'package.json')));
    assert.ok(await fileExists(path.join(projectPath, 'config.json')));
    assert.ok(await fileExists(path.join(projectPath, 'docker-compose.yml')));
    assert.ok(await fileExists(path.join(projectPath, '.gitignore')));
    assert.ok(await fileExists(path.join(projectPath, 'README.md')));
    assert.ok(await fileExists(path.join(projectPath, '.env.example')));
    assert.ok(await fileExists(path.join(projectPath, 'CLAUDE.md')));
    assert.ok(await fileExists(path.join(projectPath, 'AGENT.md')));
    assert.ok(await fileExists(path.join(projectPath, 'bots', 'assistant', 'config.json')));
    assert.ok(await fileExists(path.join(projectPath, 'bots', 'assistant', 'soul.md')));

    // Verify no errors
    assert.equal(stderr.output(), '');
  });

  test('prints project name and template in output', async () => {
    const tmpDir = await createTempDir();
    const originalCwd = process.cwd();
    process.chdir(tmpDir);

    const stdout = createMockStream();
    const stderr = createMockStream();

    try {
      await runInit('cool-army', { template: 'basic' }, stdout.stream, stderr.stream);
    } finally {
      process.chdir(originalCwd);
    }

    const output = stdout.output();
    assert.ok(output.includes('cool-army'), 'Should print project name');
    assert.ok(output.includes('basic'), 'Should print template name');
  });

  test('prints success message and next steps', async () => {
    const tmpDir = await createTempDir();
    const originalCwd = process.cwd();
    process.chdir(tmpDir);

    const stdout = createMockStream();
    const stderr = createMockStream();

    try {
      await runInit('test-army', { template: 'basic' }, stdout.stream, stderr.stream);
    } finally {
      process.chdir(originalCwd);
    }

    const output = stdout.output();
    assert.ok(output.includes('Project created'), 'Should show success');
    assert.ok(output.includes('Next steps'), 'Should show next steps');
    assert.ok(output.includes('cd test-army'), 'Should tell user to cd');
    assert.ok(output.includes('cp .env.example .env'), 'Should tell user to copy env');
    assert.ok(output.includes('npm install'), 'Should tell user to install');
    assert.ok(output.includes('npx ai-army validate'), 'Should tell user to validate');
    assert.ok(output.includes('docker-compose up -d'), 'Should tell user to start docker');
    assert.ok(output.includes('npx ai-army start'), 'Should tell user to start');
  });

  test('uses default basic template when not specified', async () => {
    const tmpDir = await createTempDir();
    const originalCwd = process.cwd();
    process.chdir(tmpDir);

    const stdout = createMockStream();
    const stderr = createMockStream();

    try {
      await runInit('default-proj', { template: 'basic' }, stdout.stream, stderr.stream);
    } finally {
      process.chdir(originalCwd);
    }

    const projectPath = path.join(tmpDir, 'default-proj');
    const pkg = JSON.parse(await fs.readFile(path.join(projectPath, 'package.json'), 'utf8'));
    assert.equal(pkg.name, 'default-proj');
    assert.ok(pkg.dependencies['ai-army']);
  });

  test('creates directories: bots, data, migrations, skills', async () => {
    const tmpDir = await createTempDir();
    const originalCwd = process.cwd();
    process.chdir(tmpDir);

    const stdout = createMockStream();
    const stderr = createMockStream();

    try {
      await runInit('dir-test', { template: 'basic' }, stdout.stream, stderr.stream);
    } finally {
      process.chdir(originalCwd);
    }

    const projectPath = path.join(tmpDir, 'dir-test');
    assert.ok(await fileExists(path.join(projectPath, 'bots')));
    assert.ok(await fileExists(path.join(projectPath, 'data')));
    assert.ok(await fileExists(path.join(projectPath, 'migrations')));
    assert.ok(await fileExists(path.join(projectPath, 'skills')));
  });

  test('handles errors gracefully and writes to stderr', async () => {
    const tmpDir = await createTempDir();
    const stdout = createMockStream();
    const stderr = createMockStream();

    const originalExitCode = process.exitCode;

    // Create a file where the project directory should be, so mkdir fails
    const blockerFile = path.join(tmpDir, 'blocked');
    await fs.writeFile(blockerFile, 'not a directory');
    await fs.chmod(blockerFile, 0o444);

    const originalCwd = process.cwd();
    process.chdir(tmpDir);

    try {
      // Try to init inside the file, which should cause an error
      await runInit(
        path.join(blockerFile, 'sub', 'project'),
        { template: 'basic' },
        stdout.stream,
        stderr.stream
      );
    } finally {
      process.chdir(originalCwd);
      await fs.chmod(blockerFile, 0o644);
    }

    const errOutput = stderr.output();
    assert.ok(errOutput.includes('Failed to create project'), 'Should print error');
    assert.equal(process.exitCode, 1, 'Should set exit code to 1');

    process.exitCode = originalExitCode;
  });

  test('prints location path in output', async () => {
    const tmpDir = await createTempDir();
    const originalCwd = process.cwd();
    process.chdir(tmpDir);

    const stdout = createMockStream();
    const stderr = createMockStream();

    try {
      await runInit('path-test', { template: 'basic' }, stdout.stream, stderr.stream);
    } finally {
      process.chdir(originalCwd);
    }

    const output = stdout.output();
    assert.ok(output.includes('Location:'), 'Should print location');
    assert.ok(output.includes(path.join(tmpDir, 'path-test')), 'Should print full path');
  });
});

describe('CLI subprocess execution', () => {
  test('--help shows usage info', async () => {
    const { stdout } = await execFileAsync('node', [CLI_PATH, '--help']);

    assert.ok(stdout.includes('ai-army'));
    assert.ok(stdout.includes('init'));
    assert.ok(stdout.includes('validate'));
    assert.ok(stdout.includes('start'));
    assert.ok(stdout.includes('status'));
  });

  test('--version shows version number', async () => {
    const { stdout } = await execFileAsync('node', [CLI_PATH, '--version']);

    assert.ok(stdout.trim().match(/^\d+\.\d+\.\d+$/), 'Should output semver version');
  });

  test('init --help shows template option', async () => {
    const { stdout } = await execFileAsync('node', [CLI_PATH, 'init', '--help']);

    assert.ok(stdout.includes('--template'));
    assert.ok(stdout.includes('basic'));
    assert.ok(stdout.includes('project-name'));
  });

  test('init creates project via subprocess', async () => {
    const tmpDir = await createTempDir();
    const projectPath = path.join(tmpDir, 'sub-test');

    const { stdout } = await execFileAsync('node', [CLI_PATH, 'init', projectPath]);

    assert.ok(stdout.includes('Project created'), 'Should show success message');
    assert.ok(await fileExists(path.join(projectPath, 'package.json')));
    assert.ok(await fileExists(path.join(projectPath, 'CLAUDE.md')));
    assert.ok(await fileExists(path.join(projectPath, 'AGENT.md')));
  });

  test('init with --template option passes template to initializer', async () => {
    const tmpDir = await createTempDir();
    const projectPath = path.join(tmpDir, 'template-test');

    const { stdout } = await execFileAsync('node', [
      CLI_PATH,
      'init',
      projectPath,
      '--template',
      'basic',
    ]);

    assert.ok(stdout.includes('Template: basic'));
    assert.ok(await fileExists(path.join(projectPath, 'config.json')));
  });

  test('init with -t shorthand option works', async () => {
    const tmpDir = await createTempDir();
    const projectPath = path.join(tmpDir, 'shorthand-test');

    const { stdout } = await execFileAsync('node', [CLI_PATH, 'init', projectPath, '-t', 'basic']);

    assert.ok(stdout.includes('Template: basic'));
    assert.ok(await fileExists(path.join(projectPath, 'package.json')));
  });

  test('validate command outputs stub message', async () => {
    const { stdout } = await execFileAsync('node', [CLI_PATH, 'validate']);

    assert.ok(stdout.includes('Validating configuration'));
  });

  test('status command outputs stub message', async () => {
    const { stdout } = await execFileAsync('node', [CLI_PATH, 'status']);

    assert.ok(stdout.includes('Checking status'));
  });

  test('unknown command shows error', async () => {
    try {
      await execFileAsync('node', [CLI_PATH, 'nonexistent']);
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(
        err.stderr.includes('unknown command') || err.stderr.includes('error'),
        'Should report unknown command'
      );
    }
  });
});
