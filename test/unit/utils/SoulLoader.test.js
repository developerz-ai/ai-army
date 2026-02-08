/**
 * Unit tests for SoulLoader
 *
 * Tests soul file loading, variable interpolation,
 * and error handling for missing/invalid files.
 */

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { SoulLoader, SoulLoaderError } from '../../../src/utils/SoulLoader.js';

/** Track temp directories for cleanup */
const tempDirs = [];

/**
 * Create a temporary soul file with given content
 * @param {string} content - Markdown content
 * @param {string} [filename='soul.md'] - Filename
 * @returns {Promise<string>} - Absolute path to the temp file
 */
async function createTempSoul(content, filename = 'soul.md') {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'soul-test-'));
  tempDirs.push(tmpDir);
  const filePath = path.join(tmpDir, filename);
  await fs.writeFile(filePath, content, 'utf8');
  return filePath;
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  tempDirs.length = 0;
});

describe('SoulLoader', () => {
  describe('loadSoulFile()', () => {
    test('loads a markdown soul file', async () => {
      const loader = new SoulLoader();
      const content = '# Test Bot\n\nYou are a helpful assistant.\n';
      const filePath = await createTempSoul(content);

      const result = await loader.loadSoulFile(filePath);

      assert.equal(result, content);
    });

    test('loads a file with complex markdown formatting', async () => {
      const loader = new SoulLoader();
      const content = [
        '# Aria - Engineering Assistant',
        '',
        '## Core Values',
        '',
        '- **Accuracy over speed**: Verify before responding',
        '- **Security-conscious**: Never expose secrets',
        '',
        '## Capabilities',
        '',
        '```bash',
        'echo "Hello World"',
        '```',
        '',
        '> Important note about behavior',
        '',
      ].join('\n');
      const filePath = await createTempSoul(content);

      const result = await loader.loadSoulFile(filePath);

      assert.equal(result, content);
    });

    test('loads UTF-8 content with special characters', async () => {
      const loader = new SoulLoader();
      const content = '# Bot 🤖\n\nYou speak français and 日本語.\n';
      const filePath = await createTempSoul(content);

      const result = await loader.loadSoulFile(filePath);

      assert.equal(result, content);
    });

    test('loads an empty file', async () => {
      const loader = new SoulLoader();
      const filePath = await createTempSoul('');

      const result = await loader.loadSoulFile(filePath);

      assert.equal(result, '');
    });

    test('throws SoulLoaderError for missing file', async () => {
      const loader = new SoulLoader();
      const missingPath = '/nonexistent/path/soul.md';

      await assert.rejects(
        () => loader.loadSoulFile(missingPath),
        err => {
          assert.equal(err.name, 'SoulLoaderError');
          assert.match(err.message, /Soul file not found/);
          assert.equal(err.filePath, path.resolve(missingPath));
          assert.ok(err.cause);
          return true;
        }
      );
    });

    test('throws SoulLoaderError for null path', async () => {
      const loader = new SoulLoader();

      await assert.rejects(
        () => loader.loadSoulFile(null),
        err => {
          assert.equal(err.name, 'SoulLoaderError');
          assert.match(err.message, /path must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws SoulLoaderError for empty string path', async () => {
      const loader = new SoulLoader();

      await assert.rejects(
        () => loader.loadSoulFile(''),
        err => {
          assert.equal(err.name, 'SoulLoaderError');
          assert.match(err.message, /path must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws SoulLoaderError for non-string path', async () => {
      const loader = new SoulLoader();

      await assert.rejects(
        () => loader.loadSoulFile(42),
        err => {
          assert.equal(err.name, 'SoulLoaderError');
          assert.match(err.message, /path must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws SoulLoaderError for undefined path', async () => {
      const loader = new SoulLoader();

      await assert.rejects(
        () => loader.loadSoulFile(undefined),
        err => {
          assert.equal(err.name, 'SoulLoaderError');
          assert.match(err.message, /path must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws SoulLoaderError for permission denied (EACCES)', async () => {
      const loader = new SoulLoader();
      const content = '# Restricted Bot\n';
      const filePath = await createTempSoul(content);

      // Remove read permissions
      await fs.chmod(filePath, 0o000);

      await assert.rejects(
        () => loader.loadSoulFile(filePath),
        err => {
          assert.equal(err.name, 'SoulLoaderError');
          assert.match(err.message, /Permission denied reading soul file/);
          assert.equal(err.filePath, filePath);
          assert.ok(err.cause);
          return true;
        }
      );

      // Restore permissions for cleanup
      await fs.chmod(filePath, 0o644);
    });

    test('throws SoulLoaderError with cause for generic fs errors', async () => {
      const loader = new SoulLoader();

      // Attempt to read a directory as a file triggers EISDIR
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'soul-test-'));
      tempDirs.push(tmpDir);

      await assert.rejects(
        () => loader.loadSoulFile(tmpDir),
        err => {
          assert.equal(err.name, 'SoulLoaderError');
          assert.match(err.message, /Failed to read soul file/);
          assert.equal(err.filePath, tmpDir);
          assert.ok(err.cause);
          return true;
        }
      );
    });

    test('resolves relative paths', async () => {
      const loader = new SoulLoader();
      const content = '# Relative Path Bot\n';
      const filePath = await createTempSoul(content);

      // Create a relative path from cwd to the temp file
      const relativePath = path.relative(process.cwd(), filePath);
      const result = await loader.loadSoulFile(relativePath);

      assert.equal(result, content);
    });
  });

  describe('interpolateVariables()', () => {
    test('interpolates {botName} variable', () => {
      const loader = new SoulLoader();
      const content = 'You are {botName}, a helpful assistant.';

      const result = loader.interpolateVariables(content, { botName: 'Aria' });

      assert.equal(result, 'You are Aria, a helpful assistant.');
    });

    test('interpolates multiple different variables', () => {
      const loader = new SoulLoader();
      const content = '{botName} works for {teamName} in {channelName}.';

      const result = loader.interpolateVariables(content, {
        botName: 'Aria',
        teamName: 'Engineering',
        channelName: '#dev-ops',
      });

      assert.equal(result, 'Aria works for Engineering in #dev-ops.');
    });

    test('interpolates same variable multiple times', () => {
      const loader = new SoulLoader();
      const content = '{botName} is great. Everyone loves {botName}.';

      const result = loader.interpolateVariables(content, { botName: 'Aria' });

      assert.equal(result, 'Aria is great. Everyone loves Aria.');
    });

    test('leaves unknown variables unchanged', () => {
      const loader = new SoulLoader();
      const content = 'Hello {botName}, welcome to {unknownVar}.';

      const result = loader.interpolateVariables(content, { botName: 'Aria' });

      assert.equal(result, 'Hello Aria, welcome to {unknownVar}.');
    });

    test('handles empty variables object', () => {
      const loader = new SoulLoader();
      const content = 'Hello {botName}, welcome to {teamName}.';

      const result = loader.interpolateVariables(content, {});

      assert.equal(result, 'Hello {botName}, welcome to {teamName}.');
    });

    test('defaults to empty variables object', () => {
      const loader = new SoulLoader();
      const content = 'Hello {botName}.';

      const result = loader.interpolateVariables(content);

      assert.equal(result, 'Hello {botName}.');
    });

    test('preserves markdown formatting', () => {
      const loader = new SoulLoader();
      const content = [
        '# {botName} - Assistant',
        '',
        '## Core Values',
        '',
        '- **{botName}** is part of {teamName}',
        '- Works in `{channelName}`',
        '',
        '```bash',
        'echo "Hello from {botName}"',
        '```',
      ].join('\n');

      const result = loader.interpolateVariables(content, {
        botName: 'Aria',
        teamName: 'Engineering',
        channelName: '#dev-ops',
      });

      assert.ok(result.includes('# Aria - Assistant'));
      assert.ok(result.includes('- **Aria** is part of Engineering'));
      assert.ok(result.includes('- Works in `#dev-ops`'));
      assert.ok(result.includes('echo "Hello from Aria"'));
    });

    test('does not interpolate ${envVar} syntax', () => {
      const loader = new SoulLoader();
      const content = 'API key is ${API_KEY} and bot is {botName}.';

      const result = loader.interpolateVariables(content, { botName: 'Aria' });

      assert.equal(result, 'API key is ${API_KEY} and bot is Aria.');
    });

    test('handles content with no variables', () => {
      const loader = new SoulLoader();
      const content = 'Plain text with no variables.';

      const result = loader.interpolateVariables(content, { botName: 'Aria' });

      assert.equal(result, 'Plain text with no variables.');
    });

    test('handles empty content string', () => {
      const loader = new SoulLoader();

      const result = loader.interpolateVariables('', { botName: 'Aria' });

      assert.equal(result, '');
    });

    test('converts non-string variable values to strings', () => {
      const loader = new SoulLoader();
      const content = 'Count: {count}, Active: {active}';

      const result = loader.interpolateVariables(content, {
        count: 42,
        active: true,
      });

      assert.equal(result, 'Count: 42, Active: true');
    });

    test('handles variable with whitespace in braces', () => {
      const loader = new SoulLoader();
      const content = 'Hello { botName }.';

      const result = loader.interpolateVariables(content, { botName: 'Aria' });

      assert.equal(result, 'Hello Aria.');
    });

    test('does not match nested braces', () => {
      const loader = new SoulLoader();
      const content = 'Object: {{key: value}} and {botName}.';

      const result = loader.interpolateVariables(content, { botName: 'Aria' });

      // The regex doesn't match nested braces; the outer braces remain
      assert.ok(result.includes('Aria'));
    });

    test('throws SoulLoaderError for non-string content', () => {
      const loader = new SoulLoader();

      assert.throws(
        () => loader.interpolateVariables(null, { botName: 'Aria' }),
        err => {
          assert.equal(err.name, 'SoulLoaderError');
          assert.match(err.message, /Soul content must be a string/);
          return true;
        }
      );
    });

    test('throws SoulLoaderError for invalid variables type', () => {
      const loader = new SoulLoader();

      assert.throws(
        () => loader.interpolateVariables('Hello', 'not-an-object'),
        err => {
          assert.equal(err.name, 'SoulLoaderError');
          assert.match(err.message, /Variables must be a plain object/);
          return true;
        }
      );
    });

    test('throws SoulLoaderError for array variables', () => {
      const loader = new SoulLoader();

      assert.throws(
        () => loader.interpolateVariables('Hello', ['not', 'valid']),
        err => {
          assert.equal(err.name, 'SoulLoaderError');
          assert.match(err.message, /Variables must be a plain object/);
          return true;
        }
      );
    });

    test('handles variable value that is empty string', () => {
      const loader = new SoulLoader();
      const content = 'Hello {botName}!';

      const result = loader.interpolateVariables(content, { botName: '' });

      assert.equal(result, 'Hello !');
    });

    test('throws SoulLoaderError for undefined content', () => {
      const loader = new SoulLoader();

      assert.throws(
        () => loader.interpolateVariables(undefined, { botName: 'Aria' }),
        err => {
          assert.equal(err.name, 'SoulLoaderError');
          assert.match(err.message, /Soul content must be a string/);
          return true;
        }
      );
    });

    test('throws SoulLoaderError for number content', () => {
      const loader = new SoulLoader();

      assert.throws(
        () => loader.interpolateVariables(42, { botName: 'Aria' }),
        err => {
          assert.equal(err.name, 'SoulLoaderError');
          assert.match(err.message, /Soul content must be a string/);
          return true;
        }
      );
    });

    test('throws SoulLoaderError for null variables', () => {
      const loader = new SoulLoader();

      assert.throws(
        () => loader.interpolateVariables('Hello {botName}', null),
        err => {
          assert.equal(err.name, 'SoulLoaderError');
          assert.match(err.message, /Variables must be a plain object/);
          return true;
        }
      );
    });

    test('handles variable value containing special regex characters', () => {
      const loader = new SoulLoader();
      const content = 'Pattern: {pattern}';

      const result = loader.interpolateVariables(content, {
        pattern: '$1.00 (USD) [test]',
      });

      assert.equal(result, 'Pattern: $1.00 (USD) [test]');
    });

    test('handles variable value containing braces', () => {
      const loader = new SoulLoader();
      const content = 'Config: {config}';

      const result = loader.interpolateVariables(content, {
        config: '{"key": "value"}',
      });

      assert.equal(result, 'Config: {"key": "value"}');
    });

    test('handles multiline content with variables', () => {
      const loader = new SoulLoader();
      const content = ['Line 1: {botName}', 'Line 2: {teamName}', 'Line 3: {botName} again'].join(
        '\n'
      );

      const result = loader.interpolateVariables(content, {
        botName: 'Aria',
        teamName: 'Engineering',
      });

      assert.equal(result, 'Line 1: Aria\nLine 2: Engineering\nLine 3: Aria again');
    });

    test('handles variable name with numbers', () => {
      const loader = new SoulLoader();
      const content = 'Bot version: {version2}';

      const result = loader.interpolateVariables(content, { version2: '3.0' });

      assert.equal(result, 'Bot version: 3.0');
    });

    test('handles variable name with underscores and hyphens', () => {
      const loader = new SoulLoader();
      const content = 'Name: {bot_name}, ID: {bot-id}';

      const result = loader.interpolateVariables(content, {
        bot_name: 'Aria',
        'bot-id': 'aria-01',
      });

      assert.equal(result, 'Name: Aria, ID: aria-01');
    });
  });

  describe('load()', () => {
    test('loads file and interpolates variables in one step', async () => {
      const loader = new SoulLoader();
      const content = '# {botName}\n\nYou work for {teamName}.\n';
      const filePath = await createTempSoul(content);

      const result = await loader.load(filePath, {
        botName: 'Aria',
        teamName: 'Engineering',
      });

      assert.equal(result, '# Aria\n\nYou work for Engineering.\n');
    });

    test('loads file with no variables when none provided', async () => {
      const loader = new SoulLoader();
      const content = '# Static Bot\n\nNo variables here.\n';
      const filePath = await createTempSoul(content);

      const result = await loader.load(filePath);

      assert.equal(result, content);
    });

    test('throws for missing file', async () => {
      const loader = new SoulLoader();

      await assert.rejects(
        () => loader.load('/nonexistent/soul.md', { botName: 'Aria' }),
        err => {
          assert.equal(err.name, 'SoulLoaderError');
          assert.match(err.message, /Soul file not found/);
          return true;
        }
      );
    });

    test('throws for invalid variables type in load()', async () => {
      const loader = new SoulLoader();
      const content = '# {botName}\n';
      const filePath = await createTempSoul(content);

      await assert.rejects(
        () => loader.load(filePath, 'not-an-object'),
        err => {
          assert.equal(err.name, 'SoulLoaderError');
          assert.match(err.message, /Variables must be a plain object/);
          return true;
        }
      );
    });

    test('preserves ${envVar} syntax when loading and interpolating', async () => {
      const loader = new SoulLoader();
      const content = '# {botName}\n\nAPI: ${ANTHROPIC_API_KEY}\n';
      const filePath = await createTempSoul(content);

      const result = await loader.load(filePath, { botName: 'Aria' });

      assert.equal(result, '# Aria\n\nAPI: ${ANTHROPIC_API_KEY}\n');
    });

    test('loads file with all variables unknown', async () => {
      const loader = new SoulLoader();
      const content = 'Hello {unknown1} and {unknown2}.\n';
      const filePath = await createTempSoul(content);

      const result = await loader.load(filePath, { botName: 'Aria' });

      assert.equal(result, 'Hello {unknown1} and {unknown2}.\n');
    });

    test('loads large soul file with many variables', async () => {
      const loader = new SoulLoader();
      const lines = [];
      for (let i = 0; i < 100; i++) {
        lines.push(`Line ${i}: {botName} on team {teamName}`);
      }
      const content = lines.join('\n');
      const filePath = await createTempSoul(content);

      const result = await loader.load(filePath, {
        botName: 'Aria',
        teamName: 'Engineering',
      });

      assert.ok(result.includes('Line 0: Aria on team Engineering'));
      assert.ok(result.includes('Line 99: Aria on team Engineering'));
      assert.ok(!result.includes('{botName}'));
      assert.ok(!result.includes('{teamName}'));
    });
  });

  describe('enhanceSoul()', () => {
    test('appends skill instructions as string', () => {
      const loader = new SoulLoader();
      const baseSoul = '# Bot\n\nYou are a helpful bot.';
      const skills = 'Review code carefully.';

      const result = loader.enhanceSoul(baseSoul, skills);

      assert.equal(
        result,
        '# Bot\n\nYou are a helpful bot.\n\n## Skills\n\nReview code carefully.'
      );
    });

    test('returns base soul when skill string is empty', () => {
      const loader = new SoulLoader();
      const baseSoul = '# Bot\n\nYou are a helpful bot.';

      assert.equal(loader.enhanceSoul(baseSoul, ''), baseSoul);
    });

    test('returns base soul when skill string is whitespace only', () => {
      const loader = new SoulLoader();
      const baseSoul = '# Bot';

      assert.equal(loader.enhanceSoul(baseSoul, '   \n  '), baseSoul);
    });

    test('appends skill objects array with names', () => {
      const loader = new SoulLoader();
      const baseSoul = '# Bot';
      const skills = [
        { name: 'code-review', instructions: 'Review code carefully.' },
        { name: 'deploy', instructions: 'Deploy safely.' },
      ];

      const result = loader.enhanceSoul(baseSoul, skills);

      assert.ok(result.includes('## Skills'));
      assert.ok(result.includes('### code-review'));
      assert.ok(result.includes('Review code carefully.'));
      assert.ok(result.includes('### deploy'));
      assert.ok(result.includes('Deploy safely.'));
    });

    test('appends skill objects without names', () => {
      const loader = new SoulLoader();
      const baseSoul = '# Bot';
      const skills = [{ instructions: 'Review code carefully.' }];

      const result = loader.enhanceSoul(baseSoul, skills);

      assert.ok(result.includes('## Skills'));
      assert.ok(result.includes('Review code carefully.'));
      assert.ok(!result.includes('###'));
    });

    test('returns base soul for empty skills array', () => {
      const loader = new SoulLoader();
      const baseSoul = '# Bot';

      assert.equal(loader.enhanceSoul(baseSoul, []), baseSoul);
    });

    test('skips skills with empty instructions', () => {
      const loader = new SoulLoader();
      const baseSoul = '# Bot';
      const skills = [
        { name: 'empty', instructions: '' },
        { name: 'valid', instructions: 'Do things.' },
      ];

      const result = loader.enhanceSoul(baseSoul, skills);

      assert.ok(result.includes('### valid'));
      assert.ok(!result.includes('### empty'));
    });

    test('skips null entries in skills array', () => {
      const loader = new SoulLoader();
      const baseSoul = '# Bot';
      const skills = [null, { name: 'valid', instructions: 'Do things.' }];

      const result = loader.enhanceSoul(baseSoul, skills);

      assert.ok(result.includes('### valid'));
    });

    test('skips non-object entries in skills array', () => {
      const loader = new SoulLoader();
      const baseSoul = '# Bot';
      const skills = ['not-an-object', { name: 'valid', instructions: 'Do things.' }];

      const result = loader.enhanceSoul(baseSoul, skills);

      assert.ok(result.includes('### valid'));
      assert.ok(!result.includes('not-an-object'));
    });

    test('returns base soul for null skills', () => {
      const loader = new SoulLoader();
      const baseSoul = '# Bot';

      assert.equal(loader.enhanceSoul(baseSoul, null), baseSoul);
    });

    test('returns base soul for undefined skills', () => {
      const loader = new SoulLoader();
      const baseSoul = '# Bot';

      assert.equal(loader.enhanceSoul(baseSoul, undefined), baseSoul);
    });

    test('returns base soul for number skills', () => {
      const loader = new SoulLoader();
      const baseSoul = '# Bot';

      assert.equal(loader.enhanceSoul(baseSoul, 42), baseSoul);
    });

    test('throws for non-string baseSoul', () => {
      const loader = new SoulLoader();

      assert.throws(
        () => loader.enhanceSoul(null, 'skills'),
        err => {
          assert.equal(err.name, 'SoulLoaderError');
          assert.match(err.message, /Base soul content must be a string/);
          return true;
        }
      );
    });

    test('throws for undefined baseSoul', () => {
      const loader = new SoulLoader();

      assert.throws(
        () => loader.enhanceSoul(undefined, 'skills'),
        err => {
          assert.equal(err.name, 'SoulLoaderError');
          assert.match(err.message, /Base soul content must be a string/);
          return true;
        }
      );
    });

    test('handles empty baseSoul with skills', () => {
      const loader = new SoulLoader();

      const result = loader.enhanceSoul('', 'Review code.');

      assert.equal(result, '\n\n## Skills\n\nReview code.');
    });

    test('preserves markdown formatting in skills', () => {
      const loader = new SoulLoader();
      const baseSoul = '# Bot';
      const skills = [
        {
          name: 'code-review',
          instructions:
            '# Code Review\n\n- Check bugs\n- Check style\n\n```js\nconsole.log();\n```',
        },
      ];

      const result = loader.enhanceSoul(baseSoul, skills);

      assert.ok(result.includes('```js'));
      assert.ok(result.includes('- Check bugs'));
    });

    test('handles multiple skills separated by double newlines', () => {
      const loader = new SoulLoader();
      const baseSoul = '# Bot';
      const skills = [
        { name: 'a', instructions: 'Skill A instructions' },
        { name: 'b', instructions: 'Skill B instructions' },
        { name: 'c', instructions: 'Skill C instructions' },
      ];

      const result = loader.enhanceSoul(baseSoul, skills);

      // Each skill section should be separated by double newlines
      assert.ok(result.includes('### a\n\nSkill A instructions\n\n### b'));
      assert.ok(result.includes('### b\n\nSkill B instructions\n\n### c'));
    });

    test('returns base soul when all skills in array have empty instructions', () => {
      const loader = new SoulLoader();
      const baseSoul = '# Bot';
      const skills = [
        { name: 'empty1', instructions: '' },
        { name: 'empty2', instructions: '   ' },
      ];

      assert.equal(loader.enhanceSoul(baseSoul, skills), baseSoul);
    });
  });
});

describe('SoulLoaderError', () => {
  test('is an instance of Error', () => {
    const error = new SoulLoaderError('Test error');
    assert.ok(error instanceof Error);
  });

  test('has correct name', () => {
    const error = new SoulLoaderError('Test error');
    assert.equal(error.name, 'SoulLoaderError');
  });

  test('stores filePath', () => {
    const error = new SoulLoaderError('Test error', { filePath: '/path/to/soul.md' });
    assert.equal(error.filePath, '/path/to/soul.md');
  });

  test('stores variableName', () => {
    const error = new SoulLoaderError('Test error', { variableName: 'botName' });
    assert.equal(error.variableName, 'botName');
  });

  test('stores cause', () => {
    const cause = new Error('Original error');
    const error = new SoulLoaderError('Test error', { cause });
    assert.equal(error.cause, cause);
  });

  test('has correct message', () => {
    const error = new SoulLoaderError('Soul file not found');
    assert.equal(error.message, 'Soul file not found');
  });

  test('defaults to undefined for optional properties', () => {
    const error = new SoulLoaderError('Test error');
    assert.equal(error.filePath, undefined);
    assert.equal(error.variableName, undefined);
    assert.equal(error.cause, undefined);
  });

  test('stores all options together', () => {
    const cause = new Error('Original');
    const error = new SoulLoaderError('Multi-option error', {
      cause,
      filePath: '/path/to/soul.md',
      variableName: 'botName',
    });

    assert.equal(error.cause, cause);
    assert.equal(error.filePath, '/path/to/soul.md');
    assert.equal(error.variableName, 'botName');
  });
});
