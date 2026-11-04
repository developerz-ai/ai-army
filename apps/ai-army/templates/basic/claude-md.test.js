/**
 * Tests for templates/basic/CLAUDE.md
 *
 * Validates the CLAUDE.md template contains all required sections,
 * CLI commands, project structure, and conventions for Claude Code users.
 *
 * @module templates/basic/claude-md.test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const claudeMdPath = path.join(__dirname, 'CLAUDE.md');

describe('templates/basic/CLAUDE.md', () => {
  /** @type {string} */
  let content;

  it('should exist and be readable', () => {
    content = fs.readFileSync(claudeMdPath, 'utf8');
    assert.ok(content.length > 0, 'CLAUDE.md should not be empty');
  });

  it('should end with a trailing newline', () => {
    content = fs.readFileSync(claudeMdPath, 'utf8');
    assert.ok(content.endsWith('\n'), 'file should end with a newline');
  });

  it('should start with a top-level heading', () => {
    content = fs.readFileSync(claudeMdPath, 'utf8');
    assert.match(content, /^# /, 'should start with a # heading');
  });

  it('should reference AI Army', () => {
    content = fs.readFileSync(claudeMdPath, 'utf8');
    assert.match(content, /AI Army/i, 'should mention AI Army');
  });

  describe('Quick Start section', () => {
    it('should have a Quick Start section', () => {
      content = fs.readFileSync(claudeMdPath, 'utf8');
      assert.match(content, /## Quick Start/, 'should have Quick Start heading');
    });

    it('should include npm install command', () => {
      content = fs.readFileSync(claudeMdPath, 'utf8');
      assert.match(content, /npm install/, 'should include npm install');
    });

    it('should include validate command', () => {
      content = fs.readFileSync(claudeMdPath, 'utf8');
      assert.match(content, /npx ai-army validate/, 'should include validate command');
    });

    it('should include docker-compose up', () => {
      content = fs.readFileSync(claudeMdPath, 'utf8');
      assert.match(content, /docker-compose up/, 'should include docker-compose up');
    });
  });

  describe('Create New Bot section', () => {
    it('should have a Create New Bot section', () => {
      content = fs.readFileSync(claudeMdPath, 'utf8');
      assert.match(content, /## Create New Bot/, 'should have Create New Bot heading');
    });

    it('should explain bot creation steps', () => {
      content = fs.readFileSync(claudeMdPath, 'utf8');
      assert.match(content, /config\.json/, 'should mention config.json');
      assert.match(content, /soul\.md/, 'should mention soul.md');
    });

    it('should include a prompt example for Claude', () => {
      content = fs.readFileSync(claudeMdPath, 'utf8');
      assert.match(
        content,
        /Create a new bot/i,
        'should include example prompt for bot creation'
      );
    });
  });

  describe('Project Structure section', () => {
    it('should have a Project Structure section', () => {
      content = fs.readFileSync(claudeMdPath, 'utf8');
      assert.match(content, /## Project Structure/, 'should have Project Structure heading');
    });

    it('should document key directories', () => {
      content = fs.readFileSync(claudeMdPath, 'utf8');
      const expectedDirs = ['bots/', 'migrations/', 'data/'];
      for (const dir of expectedDirs) {
        assert.match(
          content,
          new RegExp(dir.replace('/', '\\/')),
          `should document ${dir} directory`
        );
      }
    });

    it('should document key files', () => {
      content = fs.readFileSync(claudeMdPath, 'utf8');
      const expectedFiles = ['config.json', 'docker-compose.yml', '.env'];
      for (const file of expectedFiles) {
        assert.match(
          content,
          new RegExp(file.replace('.', '\\.')),
          `should document ${file} file`
        );
      }
    });
  });

  describe('Common Tasks section', () => {
    it('should have a Common Tasks section', () => {
      content = fs.readFileSync(claudeMdPath, 'utf8');
      assert.match(content, /## Common Tasks/, 'should have Common Tasks heading');
    });

    it('should include example prompts', () => {
      content = fs.readFileSync(claudeMdPath, 'utf8');
      assert.match(content, /Add a new tool/, 'should include tool addition example');
      assert.match(content, /Update the personality/, 'should include personality update example');
    });
  });

  describe('CLI Commands section', () => {
    it('should have a CLI Commands section', () => {
      content = fs.readFileSync(claudeMdPath, 'utf8');
      assert.match(content, /## CLI Commands/, 'should have CLI Commands heading');
    });

    it('should document all core CLI commands', () => {
      content = fs.readFileSync(claudeMdPath, 'utf8');
      const commands = [
        'npx ai-army validate',
        'npx ai-army migrate',
        'npx ai-army start',
        'npx ai-army dev',
        'npx ai-army status',
        'npx ai-army reload',
      ];
      for (const cmd of commands) {
        assert.match(
          content,
          new RegExp(cmd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
          `should document "${cmd}" command`
        );
      }
    });
  });

  describe('Configuration section', () => {
    it('should have a Configuration section', () => {
      content = fs.readFileSync(claudeMdPath, 'utf8');
      assert.match(content, /## Configuration/, 'should have Configuration heading');
    });

    it('should explain provider configuration', () => {
      content = fs.readFileSync(claudeMdPath, 'utf8');
      assert.match(content, /provider/i, 'should mention providers');
      assert.match(
        content,
        /\$\{ANTHROPIC_API_KEY\}/,
        'should show env var interpolation syntax'
      );
    });

    it('should explain environment variable interpolation', () => {
      content = fs.readFileSync(claudeMdPath, 'utf8');
      assert.match(
        content,
        /\$\{.+\}/,
        'should show ${VAR} interpolation pattern'
      );
    });
  });

  describe('Conventions section', () => {
    it('should have a Conventions section', () => {
      content = fs.readFileSync(claudeMdPath, 'utf8');
      assert.match(content, /## Conventions/, 'should have Conventions heading');
    });

    it('should explain bot directory convention', () => {
      content = fs.readFileSync(claudeMdPath, 'utf8');
      assert.match(
        content,
        /one bot.*one directory|One bot.*one directory/i,
        'should explain one bot per directory convention'
      );
    });

    it('should warn about secret handling', () => {
      content = fs.readFileSync(claudeMdPath, 'utf8');
      assert.match(
        content,
        /never.*hardcode|never.*commit/i,
        'should warn about not hardcoding secrets'
      );
    });
  });

  describe('markdown quality', () => {
    it('should use proper heading hierarchy', () => {
      content = fs.readFileSync(claudeMdPath, 'utf8');
      const lines = content.split('\n');
      const headings = [];
      let inCodeBlock = false;

      for (const line of lines) {
        if (line.startsWith('```')) {
          inCodeBlock = !inCodeBlock;
          continue;
        }
        if (!inCodeBlock && /^#+\s/.test(line)) {
          headings.push(line.match(/^(#+)\s/)[1] + ' ');
        }
      }

      assert.ok(headings.length >= 5, 'should have at least 5 headings');
      assert.equal(headings[0], '# ', 'first heading should be H1');

      // All other headings should be H2 or H3
      for (let i = 1; i < headings.length; i++) {
        assert.match(
          headings[i],
          /^#{2,3}\s$/,
          `heading ${i + 1} should be H2 or H3, got "${headings[i].trim()}"`
        );
      }
    });

    it('should contain code blocks', () => {
      content = fs.readFileSync(claudeMdPath, 'utf8');
      const codeBlocks = content.match(/```/g) || [];
      assert.ok(
        codeBlocks.length >= 4,
        'should have at least 2 code blocks (4 backtick markers)'
      );
      assert.equal(codeBlocks.length % 2, 0, 'code blocks should be properly closed');
    });

    it('should have no broken markdown links', () => {
      content = fs.readFileSync(claudeMdPath, 'utf8');
      const brokenLinks = content.match(/\[([^\]]*)\]\(\s*\)/g);
      assert.equal(brokenLinks, null, 'should not have empty link targets');
    });

    it('should not contain tab characters', () => {
      content = fs.readFileSync(claudeMdPath, 'utf8');
      assert.ok(!content.includes('\t'), 'should use spaces, not tabs');
    });

    it('should not have lines exceeding 100 characters (excluding code blocks)', () => {
      content = fs.readFileSync(claudeMdPath, 'utf8');
      const lines = content.split('\n');
      let inCodeBlock = false;

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('```')) {
          inCodeBlock = !inCodeBlock;
          continue;
        }
        if (!inCodeBlock && lines[i].length > 100) {
          // Allow long lines with URLs
          if (!lines[i].includes('http')) {
            assert.fail(
              `Line ${i + 1} exceeds 100 chars (${lines[i].length}): "${lines[i].slice(0, 50)}..."`
            );
          }
        }
      }
    });
  });
});
