/**
 * Unit tests for SkillLoader
 *
 * Tests skill loading from directories, directory scanning,
 * tools.js loading, validation, and error handling.
 */

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { SkillLoader, SkillLoaderError } from '../../../src/skills/skill-loader.js';

/** Track temp directories for cleanup */
const tempDirs = [];

/**
 * Create a temporary skill directory with SKILL.md content
 * @param {string} name - Skill directory name
 * @param {string} skillMdContent - SKILL.md content
 * @param {Object} [options] - Additional options
 * @param {string} [options.toolsContent] - tools.js content to include
 * @param {string} [options.parentDir] - Parent directory (created if not provided)
 * @returns {Promise<{ skillDir: string, parentDir: string }>} Paths
 */
async function createTempSkill(name, skillMdContent, options = {}) {
  const parentDir = options.parentDir || (await fs.mkdtemp(path.join(os.tmpdir(), 'skill-test-')));
  if (!options.parentDir) {
    tempDirs.push(parentDir);
  }

  const skillDir = path.join(parentDir, name);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), skillMdContent, 'utf8');

  if (options.toolsContent) {
    await fs.writeFile(path.join(skillDir, 'tools.js'), options.toolsContent, 'utf8');
  }

  return { skillDir, parentDir };
}

/**
 * Create a valid SKILL.md content string
 * @param {Object} [overrides] - Override default values
 * @returns {string} SKILL.md content
 */
function createSkillMd(overrides = {}) {
  const name = overrides.name || 'test-skill';
  const description = overrides.description || 'A test skill';
  const instructions = overrides.instructions || '# Test Instructions\n\nDo the thing.';

  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${instructions}\n`;
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  tempDirs.length = 0;
});

describe('SkillLoader', () => {
  describe('constructor', () => {
    test('creates instance with default parser', () => {
      const loader = new SkillLoader();

      assert.ok(loader.parser);
    });

    test('accepts custom parser via options', () => {
      const customParser = { parse: () => ({}) };
      const loader = new SkillLoader({ parser: customParser });

      assert.equal(loader.parser, customParser);
    });
  });

  describe('loadSkill()', () => {
    test('loads a valid skill from a directory', async () => {
      const loader = new SkillLoader();
      const content = createSkillMd({ name: 'code-review', description: 'Review code' });
      const { skillDir } = await createTempSkill('code-review', content);

      const skill = await loader.loadSkill(skillDir);

      assert.equal(skill.name, 'code-review');
      assert.equal(skill.description, 'Review code');
      assert.ok(skill.instructions.includes('Test Instructions'));
      assert.equal(skill.path, skillDir);
      assert.equal(skill.tools, null);
    });

    test('loads skill with tools.js', async () => {
      const loader = new SkillLoader();
      const content = createSkillMd({ name: 'deploy', description: 'Deploy apps' });
      const toolsContent = [
        'export const myTool = {',
        '  description: "A test tool",',
        '  execute: async () => ({ ok: true }),',
        '};',
      ].join('\n');

      const { skillDir } = await createTempSkill('deploy', content, { toolsContent });

      const skill = await loader.loadSkill(skillDir);

      assert.equal(skill.name, 'deploy');
      assert.ok(skill.tools !== null);
      assert.ok(skill.tools.myTool);
      assert.equal(skill.tools.myTool.description, 'A test tool');
    });

    test('returns null tools when tools.js does not exist', async () => {
      const loader = new SkillLoader();
      const content = createSkillMd();
      const { skillDir } = await createTempSkill('no-tools', content);

      const skill = await loader.loadSkill(skillDir);

      assert.equal(skill.tools, null);
    });

    test('returns null tools when tools.js has no named exports', async () => {
      const loader = new SkillLoader();
      const content = createSkillMd();
      const toolsContent = 'export default { hidden: true };\n';

      const { skillDir } = await createTempSkill('default-only', content, { toolsContent });

      const skill = await loader.loadSkill(skillDir);

      assert.equal(skill.tools, null);
    });

    test('resolves relative paths', async () => {
      const loader = new SkillLoader();
      const content = createSkillMd({ name: 'rel-skill' });
      const { skillDir } = await createTempSkill('rel-skill', content);

      const relativePath = path.relative(process.cwd(), skillDir);
      const skill = await loader.loadSkill(relativePath);

      assert.equal(skill.name, 'rel-skill');
      assert.equal(skill.path, skillDir);
    });

    test('loads from test fixtures directory', async () => {
      const loader = new SkillLoader();
      const fixtureDir = path.join(process.cwd(), 'test/fixtures/skills/code-review');

      const skill = await loader.loadSkill(fixtureDir);

      assert.equal(skill.name, 'code-review');
      assert.equal(skill.description, 'Review code for quality and security');
      assert.ok(skill.instructions.includes('Check for security vulnerabilities'));
    });

    test('loads fixture skill with tools.js', async () => {
      const loader = new SkillLoader();
      const fixtureDir = path.join(process.cwd(), 'test/fixtures/skills/deploy');

      const skill = await loader.loadSkill(fixtureDir);

      assert.equal(skill.name, 'deploy');
      assert.ok(skill.tools !== null);
      assert.ok(skill.tools.deployTool);
      assert.ok(skill.tools.rollbackTool);
    });

    // Error cases

    test('throws SkillLoaderError for null path', async () => {
      const loader = new SkillLoader();

      await assert.rejects(
        () => loader.loadSkill(null),
        err => {
          assert.equal(err.name, 'SkillLoaderError');
          assert.match(err.message, /Skill path must be a non-empty string/);
          assert.equal(err.operation, 'loadSkill');
          return true;
        }
      );
    });

    test('throws SkillLoaderError for empty string path', async () => {
      const loader = new SkillLoader();

      await assert.rejects(
        () => loader.loadSkill(''),
        err => {
          assert.equal(err.name, 'SkillLoaderError');
          assert.match(err.message, /Skill path must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws SkillLoaderError for non-string path', async () => {
      const loader = new SkillLoader();

      await assert.rejects(
        () => loader.loadSkill(42),
        err => {
          assert.equal(err.name, 'SkillLoaderError');
          assert.match(err.message, /Skill path must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws SkillLoaderError for nonexistent directory', async () => {
      const loader = new SkillLoader();

      await assert.rejects(
        () => loader.loadSkill('/nonexistent/skill/dir'),
        err => {
          assert.equal(err.name, 'SkillLoaderError');
          assert.match(err.message, /Skill directory not found/);
          assert.equal(err.operation, 'loadSkill');
          assert.ok(err.cause);
          return true;
        }
      );
    });

    test('throws SkillLoaderError when path is a file, not directory', async () => {
      const loader = new SkillLoader();
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-test-'));
      tempDirs.push(tmpDir);
      const filePath = path.join(tmpDir, 'not-a-dir');
      await fs.writeFile(filePath, 'just a file', 'utf8');

      await assert.rejects(
        () => loader.loadSkill(filePath),
        err => {
          assert.equal(err.name, 'SkillLoaderError');
          assert.match(err.message, /Skill path is not a directory/);
          return true;
        }
      );
    });

    test('throws SkillLoaderError when SKILL.md is missing', async () => {
      const loader = new SkillLoader();
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-test-'));
      tempDirs.push(tmpDir);
      const emptySkillDir = path.join(tmpDir, 'empty-skill');
      await fs.mkdir(emptySkillDir);

      await assert.rejects(
        () => loader.loadSkill(emptySkillDir),
        err => {
          assert.equal(err.name, 'SkillLoaderError');
          assert.match(err.message, /SKILL\.md not found/);
          return true;
        }
      );
    });

    test('throws SkillLoaderError when SKILL.md has invalid frontmatter', async () => {
      const loader = new SkillLoader();
      const { skillDir } = await createTempSkill(
        'bad-frontmatter',
        '# No frontmatter\n\nJust markdown.'
      );

      await assert.rejects(
        () => loader.loadSkill(skillDir),
        err => {
          assert.equal(err.name, 'SkillLoaderError');
          assert.match(err.message, /Failed to parse SKILL\.md/);
          assert.ok(err.cause);
          return true;
        }
      );
    });

    test('throws SkillLoaderError when tools.js has a syntax error', async () => {
      const loader = new SkillLoader();
      const content = createSkillMd();
      const toolsContent = 'export const broken = {{{invalid syntax';

      const { skillDir } = await createTempSkill('bad-tools', content, { toolsContent });

      await assert.rejects(
        () => loader.loadSkill(skillDir),
        err => {
          assert.equal(err.name, 'SkillLoaderError');
          assert.match(err.message, /Failed to load tools\.js/);
          assert.ok(err.cause);
          return true;
        }
      );
    });
  });

  describe('loadFromDirectory()', () => {
    test('loads all skills from a parent directory', async () => {
      const loader = new SkillLoader();
      const parentDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skills-dir-'));
      tempDirs.push(parentDir);

      await createTempSkill('skill-a', createSkillMd({ name: 'skill-a' }), { parentDir });
      await createTempSkill('skill-b', createSkillMd({ name: 'skill-b' }), { parentDir });

      const skills = await loader.loadFromDirectory(parentDir);

      assert.equal(skills.length, 2);
      const names = skills.map(s => s.name).sort();
      assert.deepEqual(names, ['skill-a', 'skill-b']);
    });

    test('skips subdirectories without SKILL.md', async () => {
      const loader = new SkillLoader();
      const parentDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skills-dir-'));
      tempDirs.push(parentDir);

      await createTempSkill('valid-skill', createSkillMd({ name: 'valid-skill' }), { parentDir });
      // Create a dir without SKILL.md
      await fs.mkdir(path.join(parentDir, 'no-skill-md'));

      const skills = await loader.loadFromDirectory(parentDir);

      assert.equal(skills.length, 1);
      assert.equal(skills[0].name, 'valid-skill');
    });

    test('skips files in the parent directory (only processes directories)', async () => {
      const loader = new SkillLoader();
      const parentDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skills-dir-'));
      tempDirs.push(parentDir);

      await createTempSkill('skill-a', createSkillMd({ name: 'skill-a' }), { parentDir });
      // Create a loose file in the parent
      await fs.writeFile(path.join(parentDir, 'README.md'), '# Skills\n', 'utf8');

      const skills = await loader.loadFromDirectory(parentDir);

      assert.equal(skills.length, 1);
      assert.equal(skills[0].name, 'skill-a');
    });

    test('returns empty array for directory with no skill subdirectories', async () => {
      const loader = new SkillLoader();
      const parentDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skills-dir-'));
      tempDirs.push(parentDir);

      const skills = await loader.loadFromDirectory(parentDir);

      assert.deepEqual(skills, []);
    });

    test('loads from test fixtures directory', async () => {
      const loader = new SkillLoader();
      const fixturesDir = path.join(process.cwd(), 'test/fixtures/skills');

      const skills = await loader.loadFromDirectory(fixturesDir);

      // Should load code-review and deploy (empty-dir has no SKILL.md)
      assert.equal(skills.length, 2);
      const names = skills.map(s => s.name).sort();
      assert.deepEqual(names, ['code-review', 'deploy']);
    });

    // Error cases

    test('throws SkillLoaderError for null directory', async () => {
      const loader = new SkillLoader();

      await assert.rejects(
        () => loader.loadFromDirectory(null),
        err => {
          assert.equal(err.name, 'SkillLoaderError');
          assert.match(err.message, /Directory path must be a non-empty string/);
          assert.equal(err.operation, 'loadFromDirectory');
          return true;
        }
      );
    });

    test('throws SkillLoaderError for empty string directory', async () => {
      const loader = new SkillLoader();

      await assert.rejects(
        () => loader.loadFromDirectory(''),
        err => {
          assert.equal(err.name, 'SkillLoaderError');
          assert.match(err.message, /Directory path must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws SkillLoaderError for nonexistent directory', async () => {
      const loader = new SkillLoader();

      await assert.rejects(
        () => loader.loadFromDirectory('/nonexistent/skills/dir'),
        err => {
          assert.equal(err.name, 'SkillLoaderError');
          assert.match(err.message, /Skills directory not found/);
          assert.equal(err.operation, 'loadFromDirectory');
          assert.ok(err.cause);
          return true;
        }
      );
    });

    test('throws SkillLoaderError when a skill subdirectory fails to load', async () => {
      const loader = new SkillLoader();
      const parentDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skills-dir-'));
      tempDirs.push(parentDir);

      // Create a skill with invalid frontmatter
      await createTempSkill('broken-skill', '# No frontmatter at all', { parentDir });

      await assert.rejects(
        () => loader.loadFromDirectory(parentDir),
        err => {
          assert.equal(err.name, 'SkillLoaderError');
          assert.match(err.message, /Failed to load skill from "broken-skill"/);
          assert.equal(err.operation, 'loadFromDirectory');
          assert.equal(err.skillName, 'broken-skill');
          assert.ok(err.cause);
          return true;
        }
      );
    });
  });

  describe('validateSkill()', () => {
    test('validates a correct skill object', () => {
      const loader = new SkillLoader();
      const skill = {
        name: 'test-skill',
        description: 'A test skill',
        instructions: 'Do the thing.',
        path: '/path/to/skill',
        tools: null,
      };

      const result = loader.validateSkill(skill);

      assert.equal(result.valid, true);
      assert.deepEqual(result.errors, []);
    });

    test('validates skill with tools object', () => {
      const loader = new SkillLoader();
      const skill = {
        name: 'deploy',
        description: 'Deploy apps',
        instructions: 'Deploy stuff.',
        path: '/path/to/deploy',
        tools: { deployTool: { execute: () => {} } },
      };

      const result = loader.validateSkill(skill);

      assert.equal(result.valid, true);
    });

    test('validates skill with empty instructions', () => {
      const loader = new SkillLoader();
      const skill = {
        name: 'minimal',
        description: 'Minimal skill',
        instructions: '',
        path: '/path/to/minimal',
        tools: null,
      };

      const result = loader.validateSkill(skill);

      assert.equal(result.valid, true);
    });

    test('rejects null skill', () => {
      const loader = new SkillLoader();

      const result = loader.validateSkill(null);

      assert.equal(result.valid, false);
      assert.ok(result.errors.includes('Skill must be a plain object'));
    });

    test('rejects undefined skill', () => {
      const loader = new SkillLoader();

      const result = loader.validateSkill(undefined);

      assert.equal(result.valid, false);
    });

    test('rejects array skill', () => {
      const loader = new SkillLoader();

      const result = loader.validateSkill(['not', 'a', 'skill']);

      assert.equal(result.valid, false);
      assert.ok(result.errors.includes('Skill must be a plain object'));
    });

    test('rejects skill missing name', () => {
      const loader = new SkillLoader();
      const skill = {
        description: 'A skill',
        instructions: 'Do stuff.',
        path: '/path',
        tools: null,
      };

      const result = loader.validateSkill(skill);

      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('"name"')));
    });

    test('rejects skill with empty name', () => {
      const loader = new SkillLoader();
      const skill = {
        name: '',
        description: 'A skill',
        instructions: 'Do stuff.',
        path: '/path',
        tools: null,
      };

      const result = loader.validateSkill(skill);

      assert.equal(result.valid, false);
    });

    test('rejects skill missing description', () => {
      const loader = new SkillLoader();
      const skill = {
        name: 'test',
        instructions: 'Do stuff.',
        path: '/path',
        tools: null,
      };

      const result = loader.validateSkill(skill);

      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('"description"')));
    });

    test('rejects skill missing instructions', () => {
      const loader = new SkillLoader();
      const skill = {
        name: 'test',
        description: 'A skill',
        path: '/path',
        tools: null,
      };

      const result = loader.validateSkill(skill);

      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('"instructions"')));
    });

    test('rejects skill missing path', () => {
      const loader = new SkillLoader();
      const skill = {
        name: 'test',
        description: 'A skill',
        instructions: 'Do stuff.',
        tools: null,
      };

      const result = loader.validateSkill(skill);

      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('"path"')));
    });

    test('rejects skill with invalid tools type', () => {
      const loader = new SkillLoader();
      const skill = {
        name: 'test',
        description: 'A skill',
        instructions: 'Do stuff.',
        path: '/path',
        tools: 'not-an-object',
      };

      const result = loader.validateSkill(skill);

      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('"tools"')));
    });

    test('collects multiple errors', () => {
      const loader = new SkillLoader();
      const skill = {};

      const result = loader.validateSkill(skill);

      assert.equal(result.valid, false);
      assert.ok(result.errors.length >= 3);
    });
  });
});

describe('SkillLoaderError', () => {
  test('is an instance of Error', () => {
    const error = new SkillLoaderError('Test error');
    assert.ok(error instanceof Error);
  });

  test('has correct name', () => {
    const error = new SkillLoaderError('Test error');
    assert.equal(error.name, 'SkillLoaderError');
  });

  test('stores operation', () => {
    const error = new SkillLoaderError('Test error', { operation: 'loadSkill' });
    assert.equal(error.operation, 'loadSkill');
  });

  test('stores skillPath', () => {
    const error = new SkillLoaderError('Test error', { skillPath: '/path/to/skill' });
    assert.equal(error.skillPath, '/path/to/skill');
  });

  test('stores skillName', () => {
    const error = new SkillLoaderError('Test error', { skillName: 'code-review' });
    assert.equal(error.skillName, 'code-review');
  });

  test('stores cause', () => {
    const cause = new Error('Original error');
    const error = new SkillLoaderError('Test error', { cause });
    assert.equal(error.cause, cause);
  });

  test('has correct message', () => {
    const error = new SkillLoaderError('Skill loading failed');
    assert.equal(error.message, 'Skill loading failed');
  });

  test('defaults to undefined for optional properties', () => {
    const error = new SkillLoaderError('Test error');
    assert.equal(error.operation, undefined);
    assert.equal(error.skillPath, undefined);
    assert.equal(error.skillName, undefined);
    assert.equal(error.cause, undefined);
  });

  test('stores all options together', () => {
    const cause = new Error('Original');
    const error = new SkillLoaderError('Multi-option error', {
      cause,
      operation: 'loadFromDirectory',
      skillPath: '/path/to/skill',
      skillName: 'deploy',
    });

    assert.equal(error.cause, cause);
    assert.equal(error.operation, 'loadFromDirectory');
    assert.equal(error.skillPath, '/path/to/skill');
    assert.equal(error.skillName, 'deploy');
  });
});
