/**
 * Tests for templates/basic/config.json
 *
 * Validates the basic project template config against the ConfigValidator
 * schema and verifies all expected fields have correct types and values.
 *
 * @module templates/basic/config.test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigValidator } from '../../src/config/ConfigValidator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(__dirname, 'config.json');

describe('templates/basic/config.json', () => {
  /** @type {Object} */
  let config;

  it('should exist and be valid JSON', () => {
    const raw = fs.readFileSync(configPath, 'utf8');
    config = JSON.parse(raw);
    assert.ok(config, 'config should be a non-null object');
    assert.equal(typeof config, 'object');
  });

  it('should pass ConfigValidator validation', () => {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const validator = new ConfigValidator();
    const result = validator.validateMainConfig(config);
    assert.equal(result.valid, true, `Validation errors: ${JSON.stringify(result.errors)}`);
    assert.deepEqual(result.errors, []);
  });

  describe('defaults section', () => {
    it('should have a defaults object', () => {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      assert.ok(config.defaults, 'defaults should exist');
      assert.equal(typeof config.defaults, 'object');
    });

    it('should have model configuration', () => {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const { model } = config.defaults;
      assert.ok(model, 'model should exist');
      assert.equal(model.provider, 'anthropic');
      assert.equal(model.model, 'claude-sonnet-4-5');
      assert.equal(typeof model.temperature, 'number');
      assert.ok(model.temperature >= 0 && model.temperature <= 2, 'temperature in range 0-2');
      assert.equal(typeof model.maxTokens, 'number');
      assert.ok(model.maxTokens > 0, 'maxTokens must be positive');
    });

    it('should have sandbox configuration', () => {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const { sandbox } = config.defaults;
      assert.ok(sandbox, 'sandbox should exist');
      assert.equal(sandbox.type, 'docker');
      assert.equal(sandbox.image, 'node:22-slim');
      assert.ok(sandbox.memory, 'memory should be set');
      assert.match(sandbox.memory, /^\d+[kmgKMG]?$/, 'memory format valid');
      assert.equal(typeof sandbox.cpus, 'number');
      assert.ok(sandbox.cpus > 0, 'cpus must be positive');
      assert.equal(sandbox.network, 'bridge');
    });

    it('should have tools array with valid builtin tools', () => {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const validTools = ['bash', 'readFile', 'writeFile', 'glob', 'grep', 'webSearch'];
      assert.ok(Array.isArray(config.defaults.tools), 'tools should be an array');
      assert.ok(config.defaults.tools.length > 0, 'tools should not be empty');
      for (const tool of config.defaults.tools) {
        assert.ok(validTools.includes(tool), `tool "${tool}" should be a valid builtin tool`);
      }
    });

    it('should have maxSteps as a positive integer', () => {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      assert.equal(typeof config.defaults.maxSteps, 'number');
      assert.ok(config.defaults.maxSteps > 0, 'maxSteps must be positive');
      assert.ok(Number.isInteger(config.defaults.maxSteps), 'maxSteps must be an integer');
    });

    it('should have compaction configuration', () => {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const { compaction } = config.defaults;
      assert.ok(compaction, 'compaction should exist');
      assert.equal(compaction.enabled, true);
      assert.equal(typeof compaction.threshold, 'number');
      assert.ok(compaction.threshold > 0, 'threshold must be positive');
      assert.equal(compaction.flushBeforeCompact, true);
    });
  });

  describe('providers section', () => {
    it('should have a providers object with at least one provider', () => {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      assert.ok(config.providers, 'providers should exist');
      assert.equal(typeof config.providers, 'object');
      assert.ok(Object.keys(config.providers).length > 0, 'should have at least one provider');
    });

    it('should have anthropic provider with correct type and apiKey', () => {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const { anthropic } = config.providers;
      assert.ok(anthropic, 'anthropic provider should exist');
      assert.equal(anthropic.type, 'anthropic');
      assert.equal(anthropic.apiKey, '${ANTHROPIC_API_KEY}');
    });

    it('should use env var interpolation for secrets', () => {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const { anthropic } = config.providers;
      assert.match(anthropic.apiKey, /^\$\{.+\}$/, 'apiKey should use ${VAR} syntax');
    });
  });

  describe('channels section', () => {
    it('should have an empty channels object', () => {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      assert.ok(
        Object.prototype.hasOwnProperty.call(config, 'channels'),
        'channels key should exist'
      );
      assert.deepEqual(config.channels, {});
    });
  });

  describe('mcpServers section', () => {
    it('should have an empty mcpServers object', () => {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      assert.ok(
        Object.prototype.hasOwnProperty.call(config, 'mcpServers'),
        'mcpServers key should exist'
      );
      assert.deepEqual(config.mcpServers, {});
    });
  });

  describe('secrets section', () => {
    it('should have secrets with env provider', () => {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      assert.ok(config.secrets, 'secrets should exist');
      assert.equal(config.secrets.provider, 'env');
    });
  });

  describe('cross-reference validation', () => {
    it('should pass validateAll with a matching bot config', () => {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const validator = new ConfigValidator();
      const botConfig = {
        id: 'assistant',
        soul: './soul.md',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        tools: ['bash', 'readFile', 'writeFile'],
      };
      const result = validator.validateAll(config, { assistant: botConfig });
      assert.equal(result.valid, true, `Errors: ${JSON.stringify(result.errors)}`);
    });

    it('should detect invalid provider reference in bot config', () => {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const validator = new ConfigValidator();
      const botConfig = {
        id: 'test-bot',
        soul: './soul.md',
        provider: 'nonexistent-provider',
        model: 'gpt-4',
        tools: [],
      };
      const result = validator.validateAll(config, { 'test-bot': botConfig });
      assert.equal(result.valid, false);
      assert.ok(
        result.errors.some(e => e.code === 'invalid_reference'),
        'should have invalid_reference error'
      );
    });
  });

  describe('defaults.model.provider matches a defined provider', () => {
    it('should reference a provider defined in the providers section', () => {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const defaultProvider = config.defaults.model.provider;
      assert.ok(
        Object.prototype.hasOwnProperty.call(config.providers, defaultProvider),
        `Default provider "${defaultProvider}" should be defined in providers`
      );
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
  });
});
