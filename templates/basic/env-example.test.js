/**
 * Tests for templates/basic/.env.example
 *
 * Validates the basic project template .env.example has all required
 * environment variables referenced in config.json and docker-compose.yml,
 * follows proper formatting, and never contains actual secret values.
 *
 * @module templates/basic/env-example.test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envExamplePath = path.join(__dirname, '.env.example');
const configPath = path.join(__dirname, 'config.json');
const dockerComposePath = path.join(__dirname, 'docker-compose.yml');

/**
 * Parse a .env.example file into variable entries.
 * @param {string} content - Raw file content
 * @returns {{ name: string, value: string, commented: boolean }[]}
 */
function parseEnvFile(content) {
  const entries = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      // Check if it's a commented-out variable (e.g., "# SLACK_BOT_TOKEN=...")
      const commentedMatch = trimmed.match(/^#\s*([A-Z][A-Z0-9_]+=.*)$/);
      if (commentedMatch) {
        const [varName, ...rest] = commentedMatch[1].split('=');
        entries.push({ name: varName, value: rest.join('='), commented: true });
      }
      continue;
    }
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const name = trimmed.slice(0, eqIdx);
      const value = trimmed.slice(eqIdx + 1);
      entries.push({ name, value, commented: false });
    }
  }
  return entries;
}

describe('templates/basic/.env.example', () => {
  /** @type {string} */
  let raw;

  it('should exist and be readable', () => {
    raw = fs.readFileSync(envExamplePath, 'utf8');
    assert.ok(raw.length > 0, 'file should not be empty');
  });

  describe('file format', () => {
    it('should end with a trailing newline', () => {
      raw = fs.readFileSync(envExamplePath, 'utf8');
      assert.ok(raw.endsWith('\n'), 'file should end with a newline');
    });

    it('should not contain tabs', () => {
      raw = fs.readFileSync(envExamplePath, 'utf8');
      assert.ok(!raw.includes('\t'), 'file should not contain tabs');
    });

    it('should not contain carriage returns', () => {
      raw = fs.readFileSync(envExamplePath, 'utf8');
      assert.ok(!raw.includes('\r'), 'file should use Unix line endings');
    });

    it('should not have lines longer than 100 characters', () => {
      raw = fs.readFileSync(envExamplePath, 'utf8');
      const lines = raw.split('\n');
      for (const line of lines) {
        assert.ok(
          line.length <= 100,
          `Line too long (${line.length} chars): "${line.slice(0, 50)}..."`
        );
      }
    });
  });

  describe('header', () => {
    it('should have a descriptive header comment', () => {
      raw = fs.readFileSync(envExamplePath, 'utf8');
      const firstLine = raw.split('\n')[0];
      assert.ok(firstLine.startsWith('#'), 'first line should be a comment');
      assert.ok(
        firstLine.toLowerCase().includes('ai') || firstLine.toLowerCase().includes('environment'),
        'header should mention AI or environment'
      );
    });

    it('should include copy instructions', () => {
      raw = fs.readFileSync(envExamplePath, 'utf8');
      const lowerContent = raw.toLowerCase();
      assert.ok(
        lowerContent.includes('copy') && lowerContent.includes('.env'),
        'should include instructions to copy to .env'
      );
    });

    it('should warn about not committing .env', () => {
      raw = fs.readFileSync(envExamplePath, 'utf8');
      const lowerContent = raw.toLowerCase();
      assert.ok(
        lowerContent.includes('do not commit') || lowerContent.includes("don't commit"),
        'should warn about not committing the .env file'
      );
    });
  });

  describe('required variables', () => {
    it('should define DB_PASSWORD', () => {
      raw = fs.readFileSync(envExamplePath, 'utf8');
      const entries = parseEnvFile(raw);
      const entry = entries.find(e => e.name === 'DB_PASSWORD');
      assert.ok(entry, 'DB_PASSWORD should be defined');
      assert.equal(entry.commented, false, 'DB_PASSWORD should not be commented out');
    });

    it('should define DATABASE_URL', () => {
      raw = fs.readFileSync(envExamplePath, 'utf8');
      const entries = parseEnvFile(raw);
      const entry = entries.find(e => e.name === 'DATABASE_URL');
      assert.ok(entry, 'DATABASE_URL should be defined');
      assert.equal(entry.commented, false, 'DATABASE_URL should not be commented out');
    });

    it('should define ANTHROPIC_API_KEY', () => {
      raw = fs.readFileSync(envExamplePath, 'utf8');
      const entries = parseEnvFile(raw);
      const entry = entries.find(e => e.name === 'ANTHROPIC_API_KEY');
      assert.ok(entry, 'ANTHROPIC_API_KEY should be defined');
      assert.equal(entry.commented, false, 'ANTHROPIC_API_KEY should not be commented out');
    });

    it('should define NODE_ENV', () => {
      raw = fs.readFileSync(envExamplePath, 'utf8');
      const entries = parseEnvFile(raw);
      const entry = entries.find(e => e.name === 'NODE_ENV');
      assert.ok(entry, 'NODE_ENV should be defined');
      assert.equal(entry.commented, false, 'NODE_ENV should not be commented out');
    });
  });

  describe('optional variables (commented out)', () => {
    it('should include SLACK_BOT_TOKEN as commented optional', () => {
      raw = fs.readFileSync(envExamplePath, 'utf8');
      const entries = parseEnvFile(raw);
      const entry = entries.find(e => e.name === 'SLACK_BOT_TOKEN');
      assert.ok(entry, 'SLACK_BOT_TOKEN should be present');
      assert.equal(entry.commented, true, 'SLACK_BOT_TOKEN should be commented out');
    });

    it('should include SLACK_APP_TOKEN as commented optional', () => {
      raw = fs.readFileSync(envExamplePath, 'utf8');
      const entries = parseEnvFile(raw);
      const entry = entries.find(e => e.name === 'SLACK_APP_TOKEN');
      assert.ok(entry, 'SLACK_APP_TOKEN should be present');
      assert.equal(entry.commented, true, 'SLACK_APP_TOKEN should be commented out');
    });

    it('should include DISCORD_BOT_TOKEN as commented optional', () => {
      raw = fs.readFileSync(envExamplePath, 'utf8');
      const entries = parseEnvFile(raw);
      const entry = entries.find(e => e.name === 'DISCORD_BOT_TOKEN');
      assert.ok(entry, 'DISCORD_BOT_TOKEN should be present');
      assert.equal(entry.commented, true, 'DISCORD_BOT_TOKEN should be commented out');
    });

    it('should include GITHUB_TOKEN as commented optional', () => {
      raw = fs.readFileSync(envExamplePath, 'utf8');
      const entries = parseEnvFile(raw);
      const entry = entries.find(e => e.name === 'GITHUB_TOKEN');
      assert.ok(entry, 'GITHUB_TOKEN should be present');
      assert.equal(entry.commented, true, 'GITHUB_TOKEN should be commented out');
    });

    it('should include PORT as commented optional', () => {
      raw = fs.readFileSync(envExamplePath, 'utf8');
      const entries = parseEnvFile(raw);
      const entry = entries.find(e => e.name === 'PORT');
      assert.ok(entry, 'PORT should be present');
      assert.equal(entry.commented, true, 'PORT should be commented out');
    });
  });

  describe('security', () => {
    it('should not contain real API keys or tokens', () => {
      raw = fs.readFileSync(envExamplePath, 'utf8');
      const secretPatterns = [
        /sk-ant-[a-zA-Z0-9-]+/, // Anthropic API key
        /sk-or-[a-zA-Z0-9-]+/, // OpenRouter API key
        /xoxb-[a-zA-Z0-9-]+/, // Slack bot token
        /xapp-[a-zA-Z0-9-]+/, // Slack app token
        /ghp_[a-zA-Z0-9]+/, // GitHub PAT
        /gho_[a-zA-Z0-9]+/, // GitHub OAuth
      ];
      for (const pattern of secretPatterns) {
        assert.ok(!pattern.test(raw), `should not contain real secrets matching ${pattern}`);
      }
    });

    it('should leave ANTHROPIC_API_KEY value empty', () => {
      raw = fs.readFileSync(envExamplePath, 'utf8');
      const entries = parseEnvFile(raw);
      const entry = entries.find(e => e.name === 'ANTHROPIC_API_KEY' && !e.commented);
      assert.ok(entry, 'ANTHROPIC_API_KEY should exist');
      assert.equal(entry.value, '', 'ANTHROPIC_API_KEY should have empty value');
    });
  });

  describe('consistency with config.json', () => {
    it('should include all env vars referenced in config.json', () => {
      raw = fs.readFileSync(envExamplePath, 'utf8');
      const configRaw = fs.readFileSync(configPath, 'utf8');
      const entries = parseEnvFile(raw);
      const allVarNames = entries.map(e => e.name);

      // Extract ${VAR_NAME} references from config.json
      const envRefs = [...configRaw.matchAll(/\$\{([A-Z_][A-Z0-9_]*?)(?::[-+][^}]*)?\}/g)];
      for (const match of envRefs) {
        const varName = match[1];
        assert.ok(
          allVarNames.includes(varName),
          `Variable "${varName}" referenced in config.json should be in .env.example`
        );
      }
    });
  });

  describe('consistency with docker-compose.yml', () => {
    it('should include all env vars referenced in docker-compose.yml', () => {
      raw = fs.readFileSync(envExamplePath, 'utf8');
      const dockerRaw = fs.readFileSync(dockerComposePath, 'utf8');
      const entries = parseEnvFile(raw);
      const allVarNames = entries.map(e => e.name);

      // Extract ${VAR_NAME} and ${VAR_NAME:-default} references from docker-compose.yml
      const envRefs = [...dockerRaw.matchAll(/\$\{([A-Z_][A-Z0-9_]*?)(?::[-+][^}]*)?\}/g)];
      for (const match of envRefs) {
        const varName = match[1];
        assert.ok(
          allVarNames.includes(varName),
          `Variable "${varName}" referenced in docker-compose.yml should be in .env.example`
        );
      }
    });
  });

  describe('DATABASE_URL consistency', () => {
    it('should use same default credentials as docker-compose.yml', () => {
      raw = fs.readFileSync(envExamplePath, 'utf8');
      const entries = parseEnvFile(raw);
      const dbUrl = entries.find(e => e.name === 'DATABASE_URL' && !e.commented);
      assert.ok(dbUrl, 'DATABASE_URL should exist');
      assert.ok(dbUrl.value.includes('ai_army'), 'DATABASE_URL should reference ai_army database');
      assert.ok(
        dbUrl.value.startsWith('postgresql://'),
        'DATABASE_URL should start with postgresql://'
      );
    });

    it('should have DB_PASSWORD default matching docker-compose default', () => {
      raw = fs.readFileSync(envExamplePath, 'utf8');
      const dockerRaw = fs.readFileSync(dockerComposePath, 'utf8');
      const entries = parseEnvFile(raw);
      const dbPassword = entries.find(e => e.name === 'DB_PASSWORD' && !e.commented);
      assert.ok(dbPassword, 'DB_PASSWORD should exist');

      // Extract default from docker-compose: ${DB_PASSWORD:-ai_army_dev}
      const defaultMatch = dockerRaw.match(/\$\{DB_PASSWORD:-([^}]+)\}/);
      if (defaultMatch) {
        assert.equal(
          dbPassword.value,
          defaultMatch[1],
          'DB_PASSWORD default should match docker-compose default'
        );
      }
    });
  });

  describe('section organization', () => {
    it('should have organized sections with comment headers', () => {
      raw = fs.readFileSync(envExamplePath, 'utf8');
      const sections = raw.match(/^# ===.+===$/gm);
      assert.ok(sections, 'should have section headers with === delimiters');
      assert.ok(sections.length >= 3, `should have at least 3 sections, found ${sections.length}`);
    });

    it('should have database section', () => {
      raw = fs.readFileSync(envExamplePath, 'utf8');
      assert.ok(raw.toLowerCase().includes('database'), 'should have a database section');
    });

    it('should have AI provider section', () => {
      raw = fs.readFileSync(envExamplePath, 'utf8');
      assert.ok(
        raw.toLowerCase().includes('ai provider') || raw.toLowerCase().includes('api key'),
        'should have an AI provider section'
      );
    });

    it('should have channels section', () => {
      raw = fs.readFileSync(envExamplePath, 'utf8');
      assert.ok(raw.toLowerCase().includes('channel'), 'should have a channels section');
    });
  });
});
