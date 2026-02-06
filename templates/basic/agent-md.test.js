/**
 * Tests for templates/basic/AGENT.md
 *
 * Validates the AGENT.md template contains all required sections,
 * architecture overview, conventions, and testing instructions
 * for any AI agent working on an ai-army project.
 *
 * @module templates/basic/agent-md.test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const agentMdPath = path.join(__dirname, 'AGENT.md');

describe('templates/basic/AGENT.md', () => {
  /** @type {string} */
  let content;

  it('should exist and be readable', () => {
    content = fs.readFileSync(agentMdPath, 'utf8');
    assert.ok(content.length > 0, 'AGENT.md should not be empty');
  });

  it('should end with a trailing newline', () => {
    content = fs.readFileSync(agentMdPath, 'utf8');
    assert.ok(content.endsWith('\n'), 'file should end with a newline');
  });

  it('should start with the correct top-level heading', () => {
    content = fs.readFileSync(agentMdPath, 'utf8');
    assert.match(content, /^# Building Your AI Army/, 'should start with # Building Your AI Army');
  });

  it('should reference ai-army framework', () => {
    content = fs.readFileSync(agentMdPath, 'utf8');
    assert.match(content, /ai-army framework/, 'should mention ai-army framework');
  });

  it('should describe bot independence', () => {
    content = fs.readFileSync(agentMdPath, 'utf8');
    const botFeatures = ['soul.md', 'Workspace', 'Tools', 'Channel'];
    for (const feature of botFeatures) {
      assert.match(content, new RegExp(feature), `should mention bot feature: ${feature}`);
    }
  });

  describe('Architecture section', () => {
    it('should have an Architecture heading', () => {
      content = fs.readFileSync(agentMdPath, 'utf8');
      assert.match(content, /## Architecture/, 'should have Architecture heading');
    });

    it('should document core directories', () => {
      content = fs.readFileSync(agentMdPath, 'utf8');
      const dirs = ['src/core/', 'src/adapters/', 'src/execution/', 'bots/'];
      for (const dir of dirs) {
        assert.match(
          content,
          new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
          `should document ${dir} directory`
        );
      }
    });

    it('should explain orchestration', () => {
      content = fs.readFileSync(agentMdPath, 'utf8');
      assert.match(content, /[Oo]rchestrat/, 'should mention orchestration');
    });

    it('should explain Docker container isolation', () => {
      content = fs.readFileSync(agentMdPath, 'utf8');
      assert.match(content, /Docker/, 'should mention Docker containers');
    });
  });

  describe('Project Structure section', () => {
    it('should have a Project Structure section', () => {
      content = fs.readFileSync(agentMdPath, 'utf8');
      assert.match(content, /## Project Structure/, 'should have Project Structure heading');
    });

    it('should document key directories', () => {
      content = fs.readFileSync(agentMdPath, 'utf8');
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
      content = fs.readFileSync(agentMdPath, 'utf8');
      const expectedFiles = ['config.json', 'docker-compose.yml', '.env'];
      for (const file of expectedFiles) {
        assert.match(content, new RegExp(file.replace('.', '\\.')), `should document ${file} file`);
      }
    });
  });

  describe('Conventions section', () => {
    it('should have a Conventions heading', () => {
      content = fs.readFileSync(agentMdPath, 'utf8');
      assert.match(content, /## Conventions/, 'should have Conventions heading');
    });

    it('should explain one bot per directory', () => {
      content = fs.readFileSync(agentMdPath, 'utf8');
      assert.match(
        content,
        /[Oo]ne bot.*one directory/i,
        'should explain one bot per directory convention'
      );
    });

    it('should reference config.json + soul.md', () => {
      content = fs.readFileSync(agentMdPath, 'utf8');
      assert.match(content, /config\.json/, 'should mention config.json');
      assert.match(content, /soul\.md/, 'should mention soul.md');
    });

    it('should reference ${ENV_VAR} interpolation', () => {
      content = fs.readFileSync(agentMdPath, 'utf8');
      assert.match(content, /\$\{ENV_VAR\}/, 'should show ${ENV_VAR} interpolation pattern');
    });

    it('should mention PostgreSQL for sessions', () => {
      content = fs.readFileSync(agentMdPath, 'utf8');
      assert.match(content, /PostgreSQL/, 'should mention PostgreSQL');
    });

    it('should warn about not hardcoding secrets', () => {
      content = fs.readFileSync(agentMdPath, 'utf8');
      assert.match(
        content,
        /never.*hardcode|never.*commit/i,
        'should warn about not hardcoding secrets'
      );
    });
  });

  describe('Configuration section', () => {
    it('should have a Configuration section', () => {
      content = fs.readFileSync(agentMdPath, 'utf8');
      assert.match(content, /## Configuration/, 'should have Configuration heading');
    });

    it('should show provider config example', () => {
      content = fs.readFileSync(agentMdPath, 'utf8');
      assert.match(content, /providers/, 'should show providers config');
      assert.match(
        content,
        /\$\{ANTHROPIC_API_KEY\}/,
        'should show env var interpolation for API key'
      );
    });

    it('should show channel config example', () => {
      content = fs.readFileSync(agentMdPath, 'utf8');
      assert.match(content, /channels/, 'should show channels config');
      assert.match(content, /slack/i, 'should show Slack channel example');
    });
  });

  describe('Testing section', () => {
    it('should have a Testing heading', () => {
      content = fs.readFileSync(agentMdPath, 'utf8');
      assert.match(content, /## Testing/, 'should have Testing heading');
    });

    it('should include unit test command', () => {
      content = fs.readFileSync(agentMdPath, 'utf8');
      assert.match(content, /npm run test:unit/, 'should include npm run test:unit');
    });

    it('should include integration test command', () => {
      content = fs.readFileSync(agentMdPath, 'utf8');
      assert.match(content, /npm run test:integration/, 'should include npm run test:integration');
    });

    it('should include all tests command', () => {
      content = fs.readFileSync(agentMdPath, 'utf8');
      assert.match(content, /npm test/, 'should include npm test');
    });
  });

  describe('Common Operations section', () => {
    it('should have a Common Operations section', () => {
      content = fs.readFileSync(agentMdPath, 'utf8');
      assert.match(content, /## Common Operations/, 'should have Common Operations heading');
    });

    it('should explain adding a new bot', () => {
      content = fs.readFileSync(agentMdPath, 'utf8');
      assert.match(content, /[Aa]dding a [Nn]ew [Bb]ot/, 'should explain adding a new bot');
    });

    it('should explain modifying a bot', () => {
      content = fs.readFileSync(agentMdPath, 'utf8');
      assert.match(content, /[Mm]odifying a [Bb]ot/, 'should explain modifying a bot');
    });

    it('should include troubleshooting guidance', () => {
      content = fs.readFileSync(agentMdPath, 'utf8');
      assert.match(content, /[Tt]roubleshooting/, 'should include troubleshooting section');
    });

    it('should reference validate command', () => {
      content = fs.readFileSync(agentMdPath, 'utf8');
      assert.match(content, /npx ai-army validate/, 'should reference npx ai-army validate');
    });
  });

  describe('platform agnosticism', () => {
    it('should not reference Claude Code specifically', () => {
      content = fs.readFileSync(agentMdPath, 'utf8');
      assert.doesNotMatch(
        content,
        /Claude Code/,
        'should not mention Claude Code (use CLAUDE.md for that)'
      );
    });

    it('should not contain Claude-specific prompts', () => {
      content = fs.readFileSync(agentMdPath, 'utf8');
      assert.doesNotMatch(content, /Ask Claude/, 'should not contain Claude-specific prompts');
    });
  });

  describe('markdown quality', () => {
    it('should use proper heading hierarchy', () => {
      content = fs.readFileSync(agentMdPath, 'utf8');
      const lines = content.split('\n');
      const headings = [];
      let inCodeBlock = false;

      for (const line of lines) {
        if (line.startsWith('```')) {
          inCodeBlock = !inCodeBlock;
          continue;
        }
        if (!inCodeBlock && /^#+\s/.test(line)) {
          headings.push(`${line.match(/^(#+)\s/)[1]} `);
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
      content = fs.readFileSync(agentMdPath, 'utf8');
      const codeBlocks = content.match(/```/g) || [];
      assert.ok(codeBlocks.length >= 4, 'should have at least 2 code blocks (4 backtick markers)');
      assert.equal(codeBlocks.length % 2, 0, 'code blocks should be properly closed');
    });

    it('should have no broken markdown links', () => {
      content = fs.readFileSync(agentMdPath, 'utf8');
      const brokenLinks = content.match(/\[([^\]]*)\]\(\s*\)/g);
      assert.equal(brokenLinks, null, 'should not have empty link targets');
    });

    it('should not contain tab characters', () => {
      content = fs.readFileSync(agentMdPath, 'utf8');
      assert.ok(!content.includes('\t'), 'should use spaces, not tabs');
    });

    it('should not have lines exceeding 100 characters (excluding code blocks)', () => {
      content = fs.readFileSync(agentMdPath, 'utf8');
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
              `Line ${i + 1} exceeds 100 chars (${lines[i].length}): ` +
                `"${lines[i].slice(0, 50)}..."`
            );
          }
        }
      }
    });
  });
});
