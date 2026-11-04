/**
 * Tests for templates/basic/bots/assistant/ (config.json + soul.md)
 *
 * Validates the default assistant bot template against the BotConfigSchema
 * and verifies the soul.md file structure and content.
 *
 * @module templates/basic/bots/assistant/bot.test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigValidator, BotConfigSchema } from '../../../../src/config/ConfigValidator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(__dirname, 'config.json');
const soulPath = path.join(__dirname, 'soul.md');

// Also load the main template config for cross-reference validation
const mainConfigPath = path.join(__dirname, '..', '..', 'config.json');

describe('templates/basic/bots/assistant/config.json', () => {
  /** @type {Object} */
  let config;

  it('should exist and be valid JSON', () => {
    const raw = fs.readFileSync(configPath, 'utf8');
    config = JSON.parse(raw);
    assert.ok(config, 'config should be a non-null object');
    assert.equal(typeof config, 'object');
  });

  it('should pass BotConfigSchema validation', () => {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const result = BotConfigSchema.safeParse(config);
    assert.ok(result.success, `Validation errors: ${JSON.stringify(result.error?.issues)}`);
  });

  it('should pass ConfigValidator.validateBotConfig', () => {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const validator = new ConfigValidator();
    // Should not throw
    const validated = validator.validateBotConfig(config);
    assert.ok(validated, 'should return validated config');
    assert.equal(validated.id, 'assistant');
  });

  describe('required fields', () => {
    it('should have id set to "assistant"', () => {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      assert.equal(config.id, 'assistant');
    });

    it('should have soul pointing to ./soul.md', () => {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      assert.equal(config.soul, './soul.md');
    });

    it('should have provider set to "anthropic"', () => {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      assert.equal(config.provider, 'anthropic');
    });

    it('should have model set to "claude-sonnet-4-5"', () => {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      assert.equal(config.model, 'claude-sonnet-4-5');
    });
  });

  describe('tools array', () => {
    it('should have a tools array', () => {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      assert.ok(Array.isArray(config.tools), 'tools should be an array');
    });

    it('should include essential tools: bash, readFile, writeFile', () => {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      assert.ok(config.tools.includes('bash'), 'should include bash');
      assert.ok(config.tools.includes('readFile'), 'should include readFile');
      assert.ok(config.tools.includes('writeFile'), 'should include writeFile');
    });

    it('should only contain valid builtin tools', () => {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const validTools = ['bash', 'readFile', 'writeFile', 'glob', 'grep', 'webSearch'];
      for (const tool of config.tools) {
        assert.ok(validTools.includes(tool), `tool "${tool}" should be a valid builtin tool`);
      }
    });

    it('should have no duplicate tools', () => {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const unique = new Set(config.tools);
      assert.equal(unique.size, config.tools.length, 'tools should have no duplicates');
    });
  });

  describe('soul file reference', () => {
    it('should reference a soul file that exists', () => {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const soulFilePath = path.resolve(__dirname, config.soul);
      assert.ok(fs.existsSync(soulFilePath), `soul file should exist at ${soulFilePath}`);
    });
  });

  describe('cross-reference with main template config', () => {
    it('should reference a provider defined in the main config', () => {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const mainConfig = JSON.parse(fs.readFileSync(mainConfigPath, 'utf8'));
      assert.ok(
        Object.prototype.hasOwnProperty.call(mainConfig.providers, config.provider),
        `Provider "${config.provider}" should exist in main config providers`
      );
    });

    it('should pass validateAll with the main template config', () => {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const mainConfig = JSON.parse(fs.readFileSync(mainConfigPath, 'utf8'));
      const validator = new ConfigValidator();
      const result = validator.validateAll(mainConfig, { [config.id]: config });
      assert.equal(result.valid, true, `Errors: ${JSON.stringify(result.errors)}`);
    });
  });

  describe('consistency with ProjectInitializer', () => {
    it('should match the bot config generated by ProjectInitializer', () => {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      // The ProjectInitializer generates the same structure
      const expected = {
        id: 'assistant',
        soul: './soul.md',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        tools: ['bash', 'readFile', 'writeFile'],
      };
      assert.deepEqual(config, expected);
    });
  });

  describe('file format', () => {
    it('should end with a trailing newline', () => {
      const raw = fs.readFileSync(configPath, 'utf8');
      assert.ok(raw.endsWith('\n'), 'file should end with a newline');
    });

    it('should use 2-space indentation', () => {
      const raw = fs.readFileSync(configPath, 'utf8');
      const lines = raw.split('\n').filter(l => l.startsWith(' '));
      for (const line of lines) {
        const indent = line.match(/^( +)/)?.[1];
        if (indent) {
          assert.equal(indent.length % 2, 0, `Indentation should be multiples of 2: "${line}"`);
        }
      }
    });

    it('should not contain tabs', () => {
      const raw = fs.readFileSync(configPath, 'utf8');
      assert.ok(!raw.includes('\t'), 'should not contain tab characters');
    });

    it('should be valid compact JSON (no unnecessary whitespace)', () => {
      const raw = fs.readFileSync(configPath, 'utf8');
      config = JSON.parse(raw);
      const reformatted = `${JSON.stringify(config, null, 2)}\n`;
      assert.equal(raw, reformatted, 'should match JSON.stringify with 2-space indent');
    });
  });
});

describe('templates/basic/bots/assistant/soul.md', () => {
  /** @type {string} */
  let content;

  it('should exist and be readable', () => {
    content = fs.readFileSync(soulPath, 'utf8');
    assert.ok(content, 'soul.md should have content');
    assert.ok(content.length > 0, 'soul.md should not be empty');
  });

  describe('structure', () => {
    it('should start with a level-1 heading', () => {
      content = fs.readFileSync(soulPath, 'utf8');
      assert.match(content, /^# .+/m, 'should start with a # heading');
    });

    it('should have "Assistant" as the heading', () => {
      content = fs.readFileSync(soulPath, 'utf8');
      const firstLine = content.split('\n')[0];
      assert.equal(firstLine, '# Assistant');
    });

    it('should have a Core Values section', () => {
      content = fs.readFileSync(soulPath, 'utf8');
      assert.match(content, /^## Core Values$/m, 'should have ## Core Values heading');
    });

    it('should have a Capabilities section', () => {
      content = fs.readFileSync(soulPath, 'utf8');
      assert.match(content, /^## Capabilities$/m, 'should have ## Capabilities heading');
    });

    it('should have at least 3 core values (bullet points)', () => {
      content = fs.readFileSync(soulPath, 'utf8');
      const coreValuesSection = content.split('## Core Values')[1].split('##')[0];
      const bullets = coreValuesSection.match(/^- .+$/gm) || [];
      assert.ok(bullets.length >= 3, `should have at least 3 core values, got ${bullets.length}`);
    });

    it('should have at least 3 capabilities (bullet points)', () => {
      content = fs.readFileSync(soulPath, 'utf8');
      const capabilitiesSection = content.split('## Capabilities')[1];
      const bullets = capabilitiesSection.match(/^- .+$/gm) || [];
      assert.ok(bullets.length >= 3, `should have at least 3 capabilities, got ${bullets.length}`);
    });
  });

  describe('content quality', () => {
    it('should include a bot description after the heading', () => {
      content = fs.readFileSync(soulPath, 'utf8');
      const lines = content.split('\n');
      // Line after heading and blank line should be a description
      const descLine = lines.find((l, i) => i > 0 && l.trim() && !l.startsWith('#'));
      assert.ok(descLine, 'should have a description paragraph');
      assert.ok(descLine.length > 10, 'description should be meaningful');
    });

    it('should not contain template variable placeholders', () => {
      content = fs.readFileSync(soulPath, 'utf8');
      // Should not have unreplaced {variable} or ${VARIABLE} placeholders
      assert.ok(!content.match(/\$\{[A-Z_]+\}/), 'should not contain ${ENV_VAR} placeholders');
    });

    it('should mention being helpful', () => {
      content = fs.readFileSync(soulPath, 'utf8');
      assert.match(content, /helpful/i, 'soul should mention being helpful');
    });
  });

  describe('consistency with ProjectInitializer', () => {
    it('should match the soul.md generated by ProjectInitializer', () => {
      content = fs.readFileSync(soulPath, 'utf8');
      const expected = [
        '# Assistant',
        '',
        'You are a helpful AI assistant.',
        '',
        '## Core Values',
        '',
        '- Be accurate and helpful',
        '- Ask for clarification when needed',
        '- Provide clear, actionable responses',
        '',
        '## Capabilities',
        '',
        '- Answer questions',
        '- Help with code and technical tasks',
        '- Execute bash commands when needed',
        '',
      ].join('\n');
      assert.equal(content, expected);
    });
  });

  describe('file format', () => {
    it('should end with a trailing newline', () => {
      content = fs.readFileSync(soulPath, 'utf8');
      assert.ok(content.endsWith('\n'), 'file should end with a newline');
    });

    it('should not contain tabs', () => {
      content = fs.readFileSync(soulPath, 'utf8');
      assert.ok(!content.includes('\t'), 'should not contain tab characters');
    });

    it('should use Unix line endings (LF, not CRLF)', () => {
      content = fs.readFileSync(soulPath, 'utf8');
      assert.ok(!content.includes('\r'), 'should use LF line endings, not CRLF');
    });
  });
});

describe('templates/basic/bots/assistant/ integration', () => {
  it('should have both config.json and soul.md in the same directory', () => {
    assert.ok(fs.existsSync(configPath), 'config.json should exist');
    assert.ok(fs.existsSync(soulPath), 'soul.md should exist');
  });

  it('should have config.json soul field pointing to existing soul.md', () => {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const soulFilePath = path.resolve(path.dirname(configPath), config.soul);
    assert.ok(
      fs.existsSync(soulFilePath),
      `soul file at "${config.soul}" (resolved: ${soulFilePath}) should exist`
    );
  });

  it('should have matching bot name in config and soul heading', () => {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const soulContent = fs.readFileSync(soulPath, 'utf8');
    const heading = soulContent.split('\n')[0].replace(/^# /, '').toLowerCase();
    assert.equal(
      heading,
      config.id,
      `Soul heading "${heading}" should match config id "${config.id}"`
    );
  });

  it('should form a valid bot when combined with the main template config', () => {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const mainConfig = JSON.parse(fs.readFileSync(mainConfigPath, 'utf8'));
    const validator = new ConfigValidator();

    // Validate bot config standalone
    const validated = validator.validateBotConfig(config);
    assert.ok(validated, 'bot config should be valid');

    // Validate cross-references with main config
    const result = validator.validateAll(mainConfig, { [config.id]: config });
    assert.equal(result.valid, true, `Cross-ref errors: ${JSON.stringify(result.errors)}`);
  });
});
