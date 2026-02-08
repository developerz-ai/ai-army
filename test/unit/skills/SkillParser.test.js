/**
 * Unit tests for SkillParser
 *
 * Tests YAML frontmatter parsing, instruction extraction,
 * and error handling for malformed SKILL.md content.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SkillParser, SkillParserError } from '../../../src/skills/skill-parser.js';

describe('SkillParser', () => {
  describe('parse()', () => {
    test('parses a valid SKILL.md with name, description, and instructions', () => {
      const parser = new SkillParser();
      const content = [
        '---',
        'name: code-review',
        'description: Review code for quality and security',
        '---',
        '',
        '# Code Review Instructions',
        '',
        'When reviewing code:',
        '1. Check for security vulnerabilities',
        '2. Verify error handling',
      ].join('\n');

      const result = parser.parse(content);

      assert.equal(result.name, 'code-review');
      assert.equal(result.description, 'Review code for quality and security');
      assert.ok(result.instructions.includes('# Code Review Instructions'));
      assert.ok(result.instructions.includes('Check for security vulnerabilities'));
    });

    test('trims instruction body whitespace', () => {
      const parser = new SkillParser();
      const content = [
        '---',
        'name: test-skill',
        'description: A test skill',
        '---',
        '',
        '  Instructions here  ',
        '',
      ].join('\n');

      const result = parser.parse(content);

      assert.equal(result.instructions, 'Instructions here');
    });

    test('handles quoted frontmatter values (double quotes)', () => {
      const parser = new SkillParser();
      const content = [
        '---',
        'name: "my-skill"',
        'description: "A skill with special: chars"',
        '---',
        '',
        'Instructions.',
      ].join('\n');

      const result = parser.parse(content);

      assert.equal(result.name, 'my-skill');
      assert.equal(result.description, 'A skill with special: chars');
    });

    test('handles quoted frontmatter values (single quotes)', () => {
      const parser = new SkillParser();
      const content = [
        '---',
        "name: 'my-skill'",
        "description: 'A skill description'",
        '---',
        '',
        'Instructions.',
      ].join('\n');

      const result = parser.parse(content);

      assert.equal(result.name, 'my-skill');
      assert.equal(result.description, 'A skill description');
    });

    test('handles frontmatter with extra fields (ignores them)', () => {
      const parser = new SkillParser();
      const content = [
        '---',
        'name: test-skill',
        'description: A test skill',
        'version: 1.0.0',
        'author: Test Author',
        '---',
        '',
        'Instructions.',
      ].join('\n');

      const result = parser.parse(content);

      assert.equal(result.name, 'test-skill');
      assert.equal(result.description, 'A test skill');
      assert.equal(result.instructions, 'Instructions.');
    });

    test('handles frontmatter with YAML comments', () => {
      const parser = new SkillParser();
      const content = [
        '---',
        '# This is a comment',
        'name: test-skill',
        '# Another comment',
        'description: A test skill',
        '---',
        '',
        'Instructions.',
      ].join('\n');

      const result = parser.parse(content);

      assert.equal(result.name, 'test-skill');
      assert.equal(result.description, 'A test skill');
    });

    test('handles frontmatter with blank lines between fields', () => {
      const parser = new SkillParser();
      const content = [
        '---',
        'name: test-skill',
        '',
        'description: A test skill',
        '',
        '---',
        '',
        'Instructions.',
      ].join('\n');

      const result = parser.parse(content);

      assert.equal(result.name, 'test-skill');
      assert.equal(result.description, 'A test skill');
    });

    test('handles complex markdown instructions with code blocks', () => {
      const parser = new SkillParser();
      const content = [
        '---',
        'name: deploy',
        'description: Deploy applications',
        '---',
        '',
        '# Deploy Instructions',
        '',
        '```bash',
        'docker-compose up -d',
        '```',
        '',
        '> Important: Always check health.',
        '',
        '- Step 1',
        '- Step 2',
      ].join('\n');

      const result = parser.parse(content);

      assert.ok(result.instructions.includes('```bash'));
      assert.ok(result.instructions.includes('docker-compose up -d'));
      assert.ok(result.instructions.includes('> Important: Always check health.'));
    });

    test('handles instructions with no body content', () => {
      const parser = new SkillParser();
      const content = ['---', 'name: minimal', 'description: Minimal skill', '---'].join('\n');

      const result = parser.parse(content);

      assert.equal(result.name, 'minimal');
      assert.equal(result.description, 'Minimal skill');
      assert.equal(result.instructions, '');
    });

    test('passes filePath to error context', () => {
      const parser = new SkillParser();

      assert.throws(
        () => parser.parse('no frontmatter here', '/path/to/SKILL.md'),
        err => {
          assert.equal(err.filePath, '/path/to/SKILL.md');
          return true;
        }
      );
    });

    test('handles frontmatter with keys containing hyphens', () => {
      const parser = new SkillParser();
      const content = [
        '---',
        'name: my-skill',
        'description: A skill',
        'some-extra: value',
        '---',
        '',
        'Instructions.',
      ].join('\n');

      const result = parser.parse(content);

      assert.equal(result.name, 'my-skill');
    });

    test('handles UTF-8 content in description and instructions', () => {
      const parser = new SkillParser();
      const content = [
        '---',
        'name: intl-skill',
        'description: Skill for internationalization 🌍',
        '---',
        '',
        '# Instructions en français',
        '',
        'Vérifiez la qualité du code.',
      ].join('\n');

      const result = parser.parse(content);

      assert.equal(result.description, 'Skill for internationalization 🌍');
      assert.ok(result.instructions.includes('Vérifiez la qualité du code.'));
    });

    // Error cases

    test('throws SkillParserError for non-string content', () => {
      const parser = new SkillParser();

      assert.throws(
        () => parser.parse(null),
        err => {
          assert.equal(err.name, 'SkillParserError');
          assert.match(err.message, /Skill content must be a string/);
          return true;
        }
      );
    });

    test('throws SkillParserError for undefined content', () => {
      const parser = new SkillParser();

      assert.throws(
        () => parser.parse(undefined),
        err => {
          assert.equal(err.name, 'SkillParserError');
          assert.match(err.message, /Skill content must be a string/);
          return true;
        }
      );
    });

    test('throws SkillParserError for number content', () => {
      const parser = new SkillParser();

      assert.throws(
        () => parser.parse(42),
        err => {
          assert.equal(err.name, 'SkillParserError');
          assert.match(err.message, /Skill content must be a string/);
          return true;
        }
      );
    });

    test('throws SkillParserError for empty string content', () => {
      const parser = new SkillParser();

      assert.throws(
        () => parser.parse(''),
        err => {
          assert.equal(err.name, 'SkillParserError');
          assert.match(err.message, /Skill content must not be empty/);
          return true;
        }
      );
    });

    test('throws SkillParserError for whitespace-only content', () => {
      const parser = new SkillParser();

      assert.throws(
        () => parser.parse('   \n\n   '),
        err => {
          assert.equal(err.name, 'SkillParserError');
          assert.match(err.message, /Skill content must not be empty/);
          return true;
        }
      );
    });

    test('throws SkillParserError for content without frontmatter', () => {
      const parser = new SkillParser();

      assert.throws(
        () => parser.parse('# Just some markdown\n\nNo frontmatter here.'),
        err => {
          assert.equal(err.name, 'SkillParserError');
          assert.match(err.message, /YAML frontmatter delimited by --- markers/);
          return true;
        }
      );
    });

    test('throws SkillParserError for content with only opening delimiter', () => {
      const parser = new SkillParser();

      assert.throws(
        () => parser.parse('---\nname: test\ndescription: test\n'),
        err => {
          assert.equal(err.name, 'SkillParserError');
          assert.match(err.message, /YAML frontmatter delimited by --- markers/);
          return true;
        }
      );
    });

    test('throws SkillParserError for missing name field', () => {
      const parser = new SkillParser();
      const content = ['---', 'description: A skill without a name', '---', '', 'Body.'].join('\n');

      assert.throws(
        () => parser.parse(content),
        err => {
          assert.equal(err.name, 'SkillParserError');
          assert.match(err.message, /must include a "name" field/);
          assert.equal(err.field, 'name');
          return true;
        }
      );
    });

    test('throws SkillParserError for missing description field', () => {
      const parser = new SkillParser();
      const content = ['---', 'name: test-skill', '---', '', 'Body.'].join('\n');

      assert.throws(
        () => parser.parse(content),
        err => {
          assert.equal(err.name, 'SkillParserError');
          assert.match(err.message, /must include a "description" field/);
          assert.equal(err.field, 'description');
          return true;
        }
      );
    });

    test('throws SkillParserError for empty name field', () => {
      const parser = new SkillParser();
      const content = ['---', 'name: ', 'description: A description', '---', '', 'Body.'].join(
        '\n'
      );

      assert.throws(
        () => parser.parse(content),
        err => {
          assert.equal(err.name, 'SkillParserError');
          assert.match(err.message, /must include a "name" field/);
          return true;
        }
      );
    });

    test('throws SkillParserError for empty description field', () => {
      const parser = new SkillParser();
      const content = ['---', 'name: test-skill', 'description: ', '---', '', 'Body.'].join('\n');

      assert.throws(
        () => parser.parse(content),
        err => {
          assert.equal(err.name, 'SkillParserError');
          assert.match(err.message, /must include a "description" field/);
          return true;
        }
      );
    });
  });
});

describe('SkillParserError', () => {
  test('is an instance of Error', () => {
    const error = new SkillParserError('Test error');
    assert.ok(error instanceof Error);
  });

  test('has correct name', () => {
    const error = new SkillParserError('Test error');
    assert.equal(error.name, 'SkillParserError');
  });

  test('stores filePath', () => {
    const error = new SkillParserError('Test error', { filePath: '/path/to/SKILL.md' });
    assert.equal(error.filePath, '/path/to/SKILL.md');
  });

  test('stores field', () => {
    const error = new SkillParserError('Test error', { field: 'name' });
    assert.equal(error.field, 'name');
  });

  test('stores cause', () => {
    const cause = new Error('Original error');
    const error = new SkillParserError('Test error', { cause });
    assert.equal(error.cause, cause);
  });

  test('has correct message', () => {
    const error = new SkillParserError('Parsing failed');
    assert.equal(error.message, 'Parsing failed');
  });

  test('defaults to undefined for optional properties', () => {
    const error = new SkillParserError('Test error');
    assert.equal(error.filePath, undefined);
    assert.equal(error.field, undefined);
    assert.equal(error.cause, undefined);
  });

  test('stores all options together', () => {
    const cause = new Error('Original');
    const error = new SkillParserError('Multi-option error', {
      cause,
      filePath: '/path/to/SKILL.md',
      field: 'description',
    });

    assert.equal(error.cause, cause);
    assert.equal(error.filePath, '/path/to/SKILL.md');
    assert.equal(error.field, 'description');
  });
});
