/**
 * Unit tests for ProjectInitializer
 *
 * Tests project scaffolding: directory creation, template file writing,
 * .env.example generation, and CLAUDE.md + AGENT.md helper files.
 */

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  ProjectInitializer,
  ProjectInitializerError,
} from '../../../src/cli/ProjectInitializer.js';

/** Track temp directories for cleanup */
const tempDirs = [];

/**
 * Create a temporary directory for testing
 * @param {string} [prefix='proj-init-test-'] - Directory prefix
 * @returns {Promise<string>} - Absolute path to the temp directory
 */
async function createTempDir(prefix = 'proj-init-test-') {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(tmpDir);
  return tmpDir;
}

/**
 * Check if a file exists at the given path
 * @param {string} filePath - Path to check
 * @returns {Promise<boolean>} - True if file exists
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
 * Read a file and return contents
 * @param {string} filePath - Path to read
 * @returns {Promise<string>} - File contents
 */
async function readFile(filePath) {
  return fs.readFile(filePath, 'utf8');
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  tempDirs.length = 0;
});

describe('ProjectInitializer', () => {
  describe('initialize()', () => {
    test('creates a complete project structure', async () => {
      const tmpDir = await createTempDir();
      const projectPath = path.join(tmpDir, 'my-army');

      await ProjectInitializer.initialize(projectPath);

      // Verify directories exist
      assert.ok(await fileExists(path.join(projectPath, 'bots')));
      assert.ok(await fileExists(path.join(projectPath, 'bots', 'assistant')));
      assert.ok(await fileExists(path.join(projectPath, 'data')));
      assert.ok(await fileExists(path.join(projectPath, 'migrations')));
      assert.ok(await fileExists(path.join(projectPath, 'skills')));

      // Verify files exist
      assert.ok(await fileExists(path.join(projectPath, 'package.json')));
      assert.ok(await fileExists(path.join(projectPath, 'config.json')));
      assert.ok(await fileExists(path.join(projectPath, 'docker-compose.yml')));
      assert.ok(await fileExists(path.join(projectPath, '.gitignore')));
      assert.ok(await fileExists(path.join(projectPath, 'README.md')));
      assert.ok(await fileExists(path.join(projectPath, '.env.example')));
      assert.ok(await fileExists(path.join(projectPath, 'CLAUDE.md')));
      assert.ok(await fileExists(path.join(projectPath, 'AGENT.md')));

      // Verify bot files
      assert.ok(await fileExists(path.join(projectPath, 'bots', 'assistant', 'config.json')));
      assert.ok(await fileExists(path.join(projectPath, 'bots', 'assistant', 'soul.md')));
    });

    test('creates target directory if it does not exist', async () => {
      const tmpDir = await createTempDir();
      const projectPath = path.join(tmpDir, 'nested', 'deep', 'project');

      await ProjectInitializer.initialize(projectPath);

      assert.ok(await fileExists(projectPath));
      assert.ok(await fileExists(path.join(projectPath, 'package.json')));
    });

    test('uses project directory name in package.json', async () => {
      const tmpDir = await createTempDir();
      const projectPath = path.join(tmpDir, 'cool-project');

      await ProjectInitializer.initialize(projectPath);

      const pkg = JSON.parse(await readFile(path.join(projectPath, 'package.json')));
      assert.equal(pkg.name, 'cool-project');
    });

    test('defaults to basic template', async () => {
      const tmpDir = await createTempDir();
      const projectPath = path.join(tmpDir, 'test-project');

      await ProjectInitializer.initialize(projectPath);

      // Should succeed with default template
      const config = JSON.parse(await readFile(path.join(projectPath, 'config.json')));
      assert.ok(config.defaults);
      assert.ok(config.providers);
    });

    test('accepts explicit basic template', async () => {
      const tmpDir = await createTempDir();
      const projectPath = path.join(tmpDir, 'explicit-basic');

      await ProjectInitializer.initialize(projectPath, 'basic');

      assert.ok(await fileExists(path.join(projectPath, 'package.json')));
    });

    test('throws ProjectInitializerError for null targetPath', async () => {
      await assert.rejects(
        () => ProjectInitializer.initialize(null),
        err => {
          assert.equal(err.name, 'ProjectInitializerError');
          assert.match(err.message, /Target path must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws ProjectInitializerError for empty string targetPath', async () => {
      await assert.rejects(
        () => ProjectInitializer.initialize(''),
        err => {
          assert.equal(err.name, 'ProjectInitializerError');
          assert.match(err.message, /Target path must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws ProjectInitializerError for non-string targetPath', async () => {
      await assert.rejects(
        () => ProjectInitializer.initialize(42),
        err => {
          assert.equal(err.name, 'ProjectInitializerError');
          assert.match(err.message, /Target path must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws ProjectInitializerError for empty template', async () => {
      const tmpDir = await createTempDir();

      await assert.rejects(
        () => ProjectInitializer.initialize(path.join(tmpDir, 'test'), ''),
        err => {
          assert.equal(err.name, 'ProjectInitializerError');
          assert.match(err.message, /Template must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws ProjectInitializerError for non-string template', async () => {
      const tmpDir = await createTempDir();

      await assert.rejects(
        () => ProjectInitializer.initialize(path.join(tmpDir, 'test'), 123),
        err => {
          assert.equal(err.name, 'ProjectInitializerError');
          assert.match(err.message, /Template must be a non-empty string/);
          return true;
        }
      );
    });

    test('works with existing empty directory', async () => {
      const projectPath = await createTempDir();

      await ProjectInitializer.initialize(projectPath);

      assert.ok(await fileExists(path.join(projectPath, 'package.json')));
      assert.ok(await fileExists(path.join(projectPath, 'CLAUDE.md')));
    });
  });

  describe('createDirectoryStructure()', () => {
    test('creates all required directories', async () => {
      const basePath = await createTempDir();

      await ProjectInitializer.createDirectoryStructure(basePath);

      assert.ok(await fileExists(path.join(basePath, 'bots')));
      assert.ok(await fileExists(path.join(basePath, 'bots', 'assistant')));
      assert.ok(await fileExists(path.join(basePath, 'data')));
      assert.ok(await fileExists(path.join(basePath, 'migrations')));
      assert.ok(await fileExists(path.join(basePath, 'skills')));
    });

    test('is idempotent - can be called multiple times', async () => {
      const basePath = await createTempDir();

      await ProjectInitializer.createDirectoryStructure(basePath);
      await ProjectInitializer.createDirectoryStructure(basePath);

      assert.ok(await fileExists(path.join(basePath, 'bots')));
      assert.ok(await fileExists(path.join(basePath, 'data')));
    });

    test('does not remove existing files in directories', async () => {
      const basePath = await createTempDir();

      // Create a pre-existing file inside bots/
      await fs.mkdir(path.join(basePath, 'bots'), { recursive: true });
      await fs.writeFile(path.join(basePath, 'bots', 'existing.txt'), 'keep me');

      await ProjectInitializer.createDirectoryStructure(basePath);

      const content = await readFile(path.join(basePath, 'bots', 'existing.txt'));
      assert.equal(content, 'keep me');
    });

    test('throws ProjectInitializerError for null basePath', async () => {
      await assert.rejects(
        () => ProjectInitializer.createDirectoryStructure(null),
        err => {
          assert.equal(err.name, 'ProjectInitializerError');
          assert.match(err.message, /Base path must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws ProjectInitializerError for empty basePath', async () => {
      await assert.rejects(
        () => ProjectInitializer.createDirectoryStructure(''),
        err => {
          assert.equal(err.name, 'ProjectInitializerError');
          assert.match(err.message, /Base path must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws ProjectInitializerError for non-string basePath', async () => {
      await assert.rejects(
        () => ProjectInitializer.createDirectoryStructure(42),
        err => {
          assert.equal(err.name, 'ProjectInitializerError');
          assert.match(err.message, /Base path must be a non-empty string/);
          return true;
        }
      );
    });
  });

  describe('writeTemplateFiles()', () => {
    test('writes package.json with project name and ai-army dependency', async () => {
      const basePath = await createTempDir();

      await ProjectInitializer.writeTemplateFiles(basePath);

      const pkg = JSON.parse(await readFile(path.join(basePath, 'package.json')));
      assert.equal(pkg.name, path.basename(basePath));
      assert.equal(pkg.type, 'module');
      assert.ok(pkg.dependencies['ai-army']);
      assert.ok(pkg.scripts.start);
      assert.ok(pkg.scripts.validate);
    });

    test('writes config.json with default provider configuration', async () => {
      const basePath = await createTempDir();

      await ProjectInitializer.writeTemplateFiles(basePath);

      const config = JSON.parse(await readFile(path.join(basePath, 'config.json')));
      assert.ok(config.defaults);
      assert.equal(config.defaults.model.provider, 'anthropic');
      assert.ok(config.providers.anthropic);
      assert.equal(config.providers.anthropic.apiKey, '${ANTHROPIC_API_KEY}');
    });

    test('writes docker-compose.yml with postgres service', async () => {
      const basePath = await createTempDir();

      await ProjectInitializer.writeTemplateFiles(basePath);

      const content = await readFile(path.join(basePath, 'docker-compose.yml'));
      assert.ok(content.includes('postgres:16'));
      assert.ok(content.includes('POSTGRES_DB: ai_army'));
      assert.ok(content.includes('5432:5432'));
    });

    test('writes .gitignore with standard entries', async () => {
      const basePath = await createTempDir();

      await ProjectInitializer.writeTemplateFiles(basePath);

      const content = await readFile(path.join(basePath, '.gitignore'));
      assert.ok(content.includes('node_modules/'));
      assert.ok(content.includes('.env'));
      assert.ok(content.includes('data/'));
    });

    test('writes README.md with project name', async () => {
      const basePath = await createTempDir();

      await ProjectInitializer.writeTemplateFiles(basePath);

      const content = await readFile(path.join(basePath, 'README.md'));
      assert.ok(content.includes(`# ${path.basename(basePath)}`));
      assert.ok(content.includes('ai-army'));
    });

    test('writes assistant bot config.json', async () => {
      const basePath = await createTempDir();
      await fs.mkdir(path.join(basePath, 'bots', 'assistant'), { recursive: true });

      await ProjectInitializer.writeTemplateFiles(basePath);

      const botConfig = JSON.parse(
        await readFile(path.join(basePath, 'bots', 'assistant', 'config.json'))
      );
      assert.equal(botConfig.id, 'assistant');
      assert.equal(botConfig.soul, './soul.md');
      assert.ok(Array.isArray(botConfig.tools));
      assert.ok(botConfig.tools.includes('bash'));
    });

    test('writes assistant soul.md with personality', async () => {
      const basePath = await createTempDir();
      await fs.mkdir(path.join(basePath, 'bots', 'assistant'), { recursive: true });

      await ProjectInitializer.writeTemplateFiles(basePath);

      const content = await readFile(path.join(basePath, 'bots', 'assistant', 'soul.md'));
      assert.ok(content.includes('# Assistant'));
      assert.ok(content.includes('helpful AI assistant'));
    });

    test('throws ProjectInitializerError for null basePath', async () => {
      await assert.rejects(
        () => ProjectInitializer.writeTemplateFiles(null),
        err => {
          assert.equal(err.name, 'ProjectInitializerError');
          assert.match(err.message, /Base path must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws ProjectInitializerError for empty basePath', async () => {
      await assert.rejects(
        () => ProjectInitializer.writeTemplateFiles(''),
        err => {
          assert.equal(err.name, 'ProjectInitializerError');
          assert.match(err.message, /Base path must be a non-empty string/);
          return true;
        }
      );
    });
  });

  describe('generateEnvExample()', () => {
    test('creates .env.example with required variables', async () => {
      const basePath = await createTempDir();

      await ProjectInitializer.generateEnvExample(basePath);

      const content = await readFile(path.join(basePath, '.env.example'));
      assert.ok(content.includes('ANTHROPIC_API_KEY='));
      assert.ok(content.includes('OPENAI_API_KEY='));
      assert.ok(content.includes('DATABASE_URL='));
    });

    test('includes Slack configuration variables', async () => {
      const basePath = await createTempDir();

      await ProjectInitializer.generateEnvExample(basePath);

      const content = await readFile(path.join(basePath, '.env.example'));
      assert.ok(content.includes('SLACK_BOT_TOKEN='));
      assert.ok(content.includes('SLACK_APP_TOKEN='));
    });

    test('includes Discord configuration variables', async () => {
      const basePath = await createTempDir();

      await ProjectInitializer.generateEnvExample(basePath);

      const content = await readFile(path.join(basePath, '.env.example'));
      assert.ok(content.includes('DISCORD_BOT_TOKEN='));
    });

    test('includes MCP server variables', async () => {
      const basePath = await createTempDir();

      await ProjectInitializer.generateEnvExample(basePath);

      const content = await readFile(path.join(basePath, '.env.example'));
      assert.ok(content.includes('GITHUB_TOKEN='));
    });

    test('includes helpful comments', async () => {
      const basePath = await createTempDir();

      await ProjectInitializer.generateEnvExample(basePath);

      const content = await readFile(path.join(basePath, '.env.example'));
      assert.ok(content.includes('# AI Army'));
      assert.ok(content.includes('Copy this file to .env'));
    });

    test('throws ProjectInitializerError for null basePath', async () => {
      await assert.rejects(
        () => ProjectInitializer.generateEnvExample(null),
        err => {
          assert.equal(err.name, 'ProjectInitializerError');
          assert.match(err.message, /Base path must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws ProjectInitializerError for empty basePath', async () => {
      await assert.rejects(
        () => ProjectInitializer.generateEnvExample(''),
        err => {
          assert.equal(err.name, 'ProjectInitializerError');
          assert.match(err.message, /Base path must be a non-empty string/);
          return true;
        }
      );
    });
  });

  describe('writeHelperFiles()', () => {
    test('creates CLAUDE.md with Claude Code instructions', async () => {
      const basePath = await createTempDir();

      await ProjectInitializer.writeHelperFiles(basePath);

      const content = await readFile(path.join(basePath, 'CLAUDE.md'));
      assert.ok(content.includes('# AI Army Project'));
      assert.ok(content.includes('Claude Code'));
    });

    test('CLAUDE.md includes quick start instructions', async () => {
      const basePath = await createTempDir();

      await ProjectInitializer.writeHelperFiles(basePath);

      const content = await readFile(path.join(basePath, 'CLAUDE.md'));
      assert.ok(content.includes('npm install'));
      assert.ok(content.includes('npx ai-army validate'));
      assert.ok(content.includes('docker-compose up'));
    });

    test('CLAUDE.md includes bot creation instructions', async () => {
      const basePath = await createTempDir();

      await ProjectInitializer.writeHelperFiles(basePath);

      const content = await readFile(path.join(basePath, 'CLAUDE.md'));
      assert.ok(content.includes('Create New Bot'));
      assert.ok(content.includes('config.json'));
      assert.ok(content.includes('soul.md'));
    });

    test('CLAUDE.md includes common tasks', async () => {
      const basePath = await createTempDir();

      await ProjectInitializer.writeHelperFiles(basePath);

      const content = await readFile(path.join(basePath, 'CLAUDE.md'));
      assert.ok(content.includes('Common Tasks'));
      assert.ok(content.includes('Add a new tool'));
      assert.ok(content.includes('Update the personality'));
    });

    test('creates AGENT.md with generic AI agent instructions', async () => {
      const basePath = await createTempDir();

      await ProjectInitializer.writeHelperFiles(basePath);

      const content = await readFile(path.join(basePath, 'AGENT.md'));
      assert.ok(content.includes('# Building Your AI Army'));
      assert.ok(content.includes('ai-army framework'));
    });

    test('AGENT.md includes architecture overview', async () => {
      const basePath = await createTempDir();

      await ProjectInitializer.writeHelperFiles(basePath);

      const content = await readFile(path.join(basePath, 'AGENT.md'));
      assert.ok(content.includes('## Architecture'));
      assert.ok(content.includes('src/core/'));
      assert.ok(content.includes('src/adapters/'));
      assert.ok(content.includes('src/execution/'));
    });

    test('AGENT.md includes conventions', async () => {
      const basePath = await createTempDir();

      await ProjectInitializer.writeHelperFiles(basePath);

      const content = await readFile(path.join(basePath, 'AGENT.md'));
      assert.ok(content.includes('## Conventions'));
      assert.ok(content.includes('config.json + soul.md'));
      assert.ok(content.includes('${ENV_VAR}'));
    });

    test('AGENT.md includes testing commands', async () => {
      const basePath = await createTempDir();

      await ProjectInitializer.writeHelperFiles(basePath);

      const content = await readFile(path.join(basePath, 'AGENT.md'));
      assert.ok(content.includes('## Testing'));
      assert.ok(content.includes('npm run test:unit'));
      assert.ok(content.includes('npm run test:integration'));
      assert.ok(content.includes('npm test'));
    });

    test('throws ProjectInitializerError for null basePath', async () => {
      await assert.rejects(
        () => ProjectInitializer.writeHelperFiles(null),
        err => {
          assert.equal(err.name, 'ProjectInitializerError');
          assert.match(err.message, /Base path must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws ProjectInitializerError for empty basePath', async () => {
      await assert.rejects(
        () => ProjectInitializer.writeHelperFiles(''),
        err => {
          assert.equal(err.name, 'ProjectInitializerError');
          assert.match(err.message, /Base path must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws ProjectInitializerError for non-string basePath', async () => {
      await assert.rejects(
        () => ProjectInitializer.writeHelperFiles(42),
        err => {
          assert.equal(err.name, 'ProjectInitializerError');
          assert.match(err.message, /Base path must be a non-empty string/);
          return true;
        }
      );
    });
  });
});

describe('ProjectInitializerError', () => {
  test('is an instance of Error', () => {
    const error = new ProjectInitializerError('Test error');
    assert.ok(error instanceof Error);
  });

  test('has correct name', () => {
    const error = new ProjectInitializerError('Test error');
    assert.equal(error.name, 'ProjectInitializerError');
  });

  test('has correct message', () => {
    const error = new ProjectInitializerError('Something went wrong');
    assert.equal(error.message, 'Something went wrong');
  });

  test('stores targetPath', () => {
    const error = new ProjectInitializerError('Test', {
      targetPath: '/path/to/project',
    });
    assert.equal(error.targetPath, '/path/to/project');
  });

  test('stores template', () => {
    const error = new ProjectInitializerError('Test', {
      template: 'basic',
    });
    assert.equal(error.template, 'basic');
  });

  test('stores cause', () => {
    const cause = new Error('Original error');
    const error = new ProjectInitializerError('Test', { cause });
    assert.equal(error.cause, cause);
  });

  test('defaults to undefined for optional properties', () => {
    const error = new ProjectInitializerError('Test');
    assert.equal(error.targetPath, undefined);
    assert.equal(error.template, undefined);
    assert.equal(error.cause, undefined);
  });

  test('stores all options together', () => {
    const cause = new Error('Original');
    const error = new ProjectInitializerError('Multi-option error', {
      cause,
      targetPath: '/path/to/project',
      template: 'basic',
    });

    assert.equal(error.cause, cause);
    assert.equal(error.targetPath, '/path/to/project');
    assert.equal(error.template, 'basic');
  });
});
