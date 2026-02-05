/**
 * Unit tests for ConfigValidator
 *
 * Tests Zod schema validation for main config and bot configs,
 * error reporting, and cross-reference validation.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ConfigValidator,
  ConfigValidationError,
  MainConfigSchema,
  BotConfigSchema,
} from '../../../src/config/ConfigValidator.js';

describe('ConfigValidator', () => {
  describe('validateMainConfig()', () => {
    test('validates correct main config', () => {
      const validator = new ConfigValidator();

      const validConfig = {
        defaults: {
          model: {
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
          },
          sandbox: {
            type: 'docker',
            image: 'node:22-slim',
          },
        },
        providers: {
          anthropic: {
            type: 'anthropic',
            apiKey: 'sk-ant-test-key',
          },
        },
        channels: {
          'slack-main': {
            type: 'slack',
            botToken: 'xoxb-test-token',
          },
        },
      };

      const result = validator.validateMainConfig(validConfig);

      assert.ok(result.valid, 'Valid config should pass validation');
      assert.equal(result.errors.length, 0, 'Should have no errors');
      assert.ok(result.data, 'Should return validated data');
    });

    test('validates empty config with defaults', () => {
      const validator = new ConfigValidator();

      const result = validator.validateMainConfig({});

      assert.ok(result.valid, 'Empty config should be valid with defaults');
      assert.deepEqual(result.data.providers, {});
      assert.deepEqual(result.data.channels, {});
      assert.deepEqual(result.data.mcpServers, {});
    });

    test('validates config with MCP servers', () => {
      const validator = new ConfigValidator();

      const config = {
        mcpServers: {
          github: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github'],
            env: {
              GITHUB_TOKEN: 'test-token',
            },
          },
        },
      };

      const result = validator.validateMainConfig(config);

      assert.ok(result.valid);
      assert.ok(result.data.mcpServers.github);
      assert.equal(result.data.mcpServers.github.command, 'npx');
    });

    test('rejects invalid provider type', () => {
      const validator = new ConfigValidator();

      const invalidConfig = {
        providers: {
          myProvider: {
            type: 'invalid-type',
            apiKey: 'test',
          },
        },
      };

      const result = validator.validateMainConfig(invalidConfig);

      assert.ok(!result.valid, 'Invalid provider type should fail');
      assert.ok(result.errors.length > 0, 'Should have errors');
      assert.ok(
        result.errors.some(e => e.path.includes('type')),
        'Error should mention type field'
      );
    });

    test('rejects invalid channel type', () => {
      const validator = new ConfigValidator();

      const invalidConfig = {
        channels: {
          myChannel: {
            type: 'telegram', // Not supported yet
            botToken: 'test',
          },
        },
      };

      const result = validator.validateMainConfig(invalidConfig);

      assert.ok(!result.valid);
      assert.ok(result.errors.length > 0);
    });

    test('validates Discord channel with guildIds', () => {
      const validator = new ConfigValidator();

      const config = {
        channels: {
          'discord-main': {
            type: 'discord',
            botToken: 'test-discord-token',
            guildIds: ['123456789', '987654321'],
          },
        },
      };

      const result = validator.validateMainConfig(config);

      assert.ok(result.valid);
      assert.deepEqual(result.data.channels['discord-main'].guildIds, ['123456789', '987654321']);
    });

    test('validates REST channel config', () => {
      const validator = new ConfigValidator();

      const config = {
        channels: {
          api: {
            type: 'rest',
            port: 3000,
            host: 'localhost',
          },
        },
      };

      const result = validator.validateMainConfig(config);

      assert.ok(result.valid);
      assert.equal(result.data.channels.api.port, 3000);
    });

    test('rejects Slack channel without botToken', () => {
      const validator = new ConfigValidator();

      const invalidConfig = {
        channels: {
          slack: {
            type: 'slack',
            // Missing botToken
          },
        },
      };

      const result = validator.validateMainConfig(invalidConfig);

      assert.ok(!result.valid);
      assert.ok(
        result.errors.some(e => e.message.includes('bot token') || e.path.includes('botToken'))
      );
    });

    test('validates secrets configuration', () => {
      const validator = new ConfigValidator();

      const config = {
        secrets: {
          provider: 'bitwarden',
          config: {
            server: 'https://vault.example.com',
            collectionId: 'my-secrets',
          },
        },
      };

      const result = validator.validateMainConfig(config);

      assert.ok(result.valid);
      assert.equal(result.data.secrets.provider, 'bitwarden');
    });

    test('validates defaults with compaction settings', () => {
      const validator = new ConfigValidator();

      const config = {
        defaults: {
          maxSteps: 50,
          compaction: {
            enabled: true,
            threshold: 100000,
            flushBeforeCompact: false,
          },
        },
      };

      const result = validator.validateMainConfig(config);

      assert.ok(result.valid);
      assert.equal(result.data.defaults.maxSteps, 50);
      assert.equal(result.data.defaults.compaction.threshold, 100000);
    });
  });

  describe('validateBotConfig()', () => {
    test('validates correct bot config', () => {
      const validator = new ConfigValidator();

      const validConfig = {
        id: 'test-bot',
        soul: './soul.md',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        tools: ['bash'],
      };

      const result = validator.validateBotConfig(validConfig);

      assert.ok(result, 'Should return validated config');
      assert.equal(result.id, 'test-bot');
      assert.equal(result.soul, './soul.md');
    });

    test('applies default values', () => {
      const validator = new ConfigValidator();

      const config = {
        id: 'test-bot',
        soul: './soul.md',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
      };

      const result = validator.validateBotConfig(config);

      // Check default values
      assert.deepEqual(result.tools, [], 'tools should default to empty array');
      assert.equal(
        result.compactionThreshold,
        50000,
        'compactionThreshold should default to 50000'
      );
      assert.equal(result.maxSteps, 30, 'maxSteps should default to 30');
      assert.equal(result.enabled, true, 'enabled should default to true');
      assert.equal(result.sessionPer, 'user', 'sessionPer should default to user');
      assert.deepEqual(result.mcpServers, [], 'mcpServers should default to empty array');
      assert.deepEqual(result.skills, [], 'skills should default to empty array');
    });

    test('rejects missing required fields', () => {
      const validator = new ConfigValidator();

      const invalidConfig = {
        id: 'test-bot',
        // Missing soul, provider, model
      };

      assert.throws(
        () => validator.validateBotConfig(invalidConfig),
        err => {
          assert.ok(err instanceof ConfigValidationError);
          assert.match(err.message, /Bot configuration invalid/);
          return true;
        }
      );
    });

    test('rejects missing id field', () => {
      const validator = new ConfigValidator();

      const invalidConfig = {
        soul: './soul.md',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
      };

      assert.throws(
        () => validator.validateBotConfig(invalidConfig),
        err => {
          assert.ok(err instanceof ConfigValidationError);
          assert.match(err.message, /id/i);
          return true;
        }
      );
    });

    test('rejects missing soul field', () => {
      const validator = new ConfigValidator();

      const invalidConfig = {
        id: 'test-bot',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
      };

      assert.throws(
        () => validator.validateBotConfig(invalidConfig),
        err => {
          assert.ok(err instanceof ConfigValidationError);
          assert.match(err.message, /soul/i);
          return true;
        }
      );
    });

    test('rejects empty string for required fields', () => {
      const validator = new ConfigValidator();

      const invalidConfig = {
        id: '',
        soul: './soul.md',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
      };

      assert.throws(() => validator.validateBotConfig(invalidConfig), ConfigValidationError);
    });

    test('validates bot with sandbox configuration', () => {
      const validator = new ConfigValidator();

      const config = {
        id: 'docker-bot',
        soul: './soul.md',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        sandbox: {
          type: 'docker',
          image: 'python:3.11-slim',
          packages: ['git', 'curl'],
          memory: '4g',
          cpus: 4,
        },
      };

      const result = validator.validateBotConfig(config);

      assert.equal(result.sandbox.type, 'docker');
      assert.equal(result.sandbox.image, 'python:3.11-slim');
      assert.deepEqual(result.sandbox.packages, ['git', 'curl']);
    });

    test('validates bot with restrictions', () => {
      const validator = new ConfigValidator();

      const config = {
        id: 'restricted-bot',
        soul: './soul.md',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        restrictions: {
          allowedUsers: ['U123', 'U456'],
          deniedChannels: ['#random'],
          dmAllowed: false,
        },
      };

      const result = validator.validateBotConfig(config);

      assert.deepEqual(result.restrictions.allowedUsers, ['U123', 'U456']);
      assert.equal(result.restrictions.dmAllowed, false);
    });

    test('validates bot with workspace configuration', () => {
      const validator = new ConfigValidator();

      const config = {
        id: 'workspace-bot',
        soul: './soul.md',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        workspace: {
          root: './data/my-bot',
          mounts: {
            '/repos': {
              path: '/home/repos',
              readOnly: true,
            },
          },
        },
      };

      const result = validator.validateBotConfig(config);

      assert.equal(result.workspace.root, './data/my-bot');
      assert.equal(result.workspace.mounts['/repos'].readOnly, true);
    });

    test('validates sessionPer enum values', () => {
      const validator = new ConfigValidator();

      // Valid values
      for (const sessionPer of ['user', 'channel', 'thread']) {
        const config = {
          id: 'test-bot',
          soul: './soul.md',
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          sessionPer,
        };

        const result = validator.validateBotConfig(config);
        assert.equal(result.sessionPer, sessionPer);
      }
    });

    test('rejects invalid sessionPer value', () => {
      const validator = new ConfigValidator();

      const config = {
        id: 'test-bot',
        soul: './soul.md',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        sessionPer: 'invalid',
      };

      assert.throws(() => validator.validateBotConfig(config), ConfigValidationError);
    });

    test('validates temperature constraints', () => {
      const validator = new ConfigValidator();

      // Valid temperature
      const validConfig = {
        id: 'test-bot',
        soul: './soul.md',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        temperature: 0.7,
      };

      const result = validator.validateBotConfig(validConfig);
      assert.equal(result.temperature, 0.7);

      // Temperature out of range should fail
      const invalidConfig = {
        id: 'test-bot',
        soul: './soul.md',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        temperature: 3.0, // > 2.0
      };

      assert.throws(() => validator.validateBotConfig(invalidConfig), ConfigValidationError);
    });
  });

  describe('checkRequiredFields()', () => {
    test('returns empty array when all fields present', () => {
      const validator = new ConfigValidator();

      const config = {
        id: 'test',
        name: 'Test Bot',
        nested: { value: 'exists' },
      };

      const errors = validator.checkRequiredFields(config, ['id', 'name']);

      assert.equal(errors.length, 0);
    });

    test('returns errors for missing fields', () => {
      const validator = new ConfigValidator();

      const config = {
        id: 'test',
      };

      const errors = validator.checkRequiredFields(config, ['id', 'name', 'soul']);

      assert.equal(errors.length, 2);
      assert.ok(errors.some(e => e.path === 'name'));
      assert.ok(errors.some(e => e.path === 'soul'));
    });

    test('handles nested field paths', () => {
      const validator = new ConfigValidator();

      const config = {
        model: { provider: 'anthropic' },
      };

      const errors = validator.checkRequiredFields(config, ['model.provider', 'model.name']);

      assert.equal(errors.length, 1);
      assert.equal(errors[0].path, 'model.name');
    });

    test('treats empty string as missing', () => {
      const validator = new ConfigValidator();

      const config = {
        id: '',
        name: 'Test',
      };

      const errors = validator.checkRequiredFields(config, ['id', 'name']);

      assert.equal(errors.length, 1);
      assert.equal(errors[0].path, 'id');
    });

    test('treats null as missing', () => {
      const validator = new ConfigValidator();

      const config = {
        id: null,
        name: 'Test',
      };

      const errors = validator.checkRequiredFields(config, ['id', 'name']);

      assert.equal(errors.length, 1);
      assert.equal(errors[0].path, 'id');
    });
  });

  describe('validateAll()', () => {
    test('validates main config and bot configs together', () => {
      const validator = new ConfigValidator();

      const mainConfig = {
        providers: {
          anthropic: { type: 'anthropic', apiKey: 'test' },
        },
        channels: {
          slack: { type: 'slack', botToken: 'test' },
        },
      };

      const botConfigs = {
        bot1: {
          id: 'bot1',
          soul: './soul.md',
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          channel: 'slack',
        },
      };

      const result = validator.validateAll(mainConfig, botConfigs);

      assert.ok(result.valid);
      assert.equal(result.errors.length, 0);
    });

    test('returns errors from both main and bot configs', () => {
      const validator = new ConfigValidator();

      const mainConfig = {
        providers: {
          test: { type: 'invalid-type' }, // Invalid
        },
      };

      const botConfigs = {
        bot1: {
          id: 'bot1',
          // Missing soul, provider, model
        },
      };

      const result = validator.validateAll(mainConfig, botConfigs);

      assert.ok(!result.valid);
      assert.ok(result.errors.length > 1);
    });

    test('detects invalid channel reference', () => {
      const validator = new ConfigValidator();

      const mainConfig = {
        providers: {
          anthropic: { type: 'anthropic', apiKey: 'test' },
        },
        channels: {
          slack: { type: 'slack', botToken: 'test' },
        },
      };

      const botConfigs = {
        bot1: {
          id: 'bot1',
          soul: './soul.md',
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          channel: 'nonexistent-channel', // Invalid reference
        },
      };

      const result = validator.validateAll(mainConfig, botConfigs);

      assert.ok(!result.valid);
      assert.ok(result.errors.some(e => e.path === 'channel'));
    });

    test('detects invalid MCP server reference', () => {
      const validator = new ConfigValidator();

      const mainConfig = {
        mcpServers: {
          github: { command: 'npx', args: [] },
        },
      };

      const botConfigs = {
        bot1: {
          id: 'bot1',
          soul: './soul.md',
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          mcpServers: ['github', 'nonexistent'], // One invalid
        },
      };

      const result = validator.validateAll(mainConfig, botConfigs);

      assert.ok(!result.valid);
      assert.ok(result.errors.some(e => e.message.includes('nonexistent')));
    });

    test('allows provider type strings without checking references', () => {
      const validator = new ConfigValidator();

      const mainConfig = {};

      const botConfigs = {
        bot1: {
          id: 'bot1',
          soul: './soul.md',
          provider: 'anthropic', // Valid provider type, no providers defined
          model: 'claude-sonnet-4-5',
        },
      };

      const result = validator.validateAll(mainConfig, botConfigs);

      // Should pass because 'anthropic' is a valid provider type
      assert.ok(result.valid);
    });
  });

  describe('generateReport()', () => {
    test('returns success message for no errors', () => {
      const validator = new ConfigValidator();

      const report = validator.generateReport([]);

      assert.ok(report.includes('✅'));
      assert.ok(report.includes('valid'));
    });

    test('returns success message for null/undefined errors', () => {
      const validator = new ConfigValidator();

      assert.ok(validator.generateReport(null).includes('✅'));
      assert.ok(validator.generateReport(undefined).includes('✅'));
    });

    test('formats errors with paths', () => {
      const validator = new ConfigValidator();

      const errors = [
        { path: 'provider', message: 'Required field missing', context: 'config.json' },
        { path: 'soul', message: 'Soul file path is required', context: 'bots/test/config.json' },
      ];

      const report = validator.generateReport(errors);

      assert.ok(report.includes('❌'));
      assert.ok(report.includes('provider'));
      assert.ok(report.includes('soul'));
      assert.ok(report.includes('config.json'));
      assert.ok(report.includes('bots/test/config.json'));
    });

    test('groups errors by context', () => {
      const validator = new ConfigValidator();

      const errors = [
        { path: 'a', message: 'Error A1', context: 'file1.json' },
        { path: 'b', message: 'Error B1', context: 'file2.json' },
        { path: 'c', message: 'Error A2', context: 'file1.json' },
      ];

      const report = validator.generateReport(errors);

      // Check structure (grouped by context)
      const file1Index = report.indexOf('file1.json');
      const file2Index = report.indexOf('file2.json');
      assert.ok(file1Index >= 0);
      assert.ok(file2Index >= 0);
    });
  });
});

describe('ConfigValidationError', () => {
  test('is an instance of Error', () => {
    const error = new ConfigValidationError('Test error');
    assert.ok(error instanceof Error);
  });

  test('has correct name', () => {
    const error = new ConfigValidationError('Test error');
    assert.equal(error.name, 'ConfigValidationError');
  });

  test('stores errors array', () => {
    const errors = [{ path: 'test', message: 'error' }];
    const error = new ConfigValidationError('Test error', { errors });
    assert.deepEqual(error.errors, errors);
  });

  test('stores configPath', () => {
    const error = new ConfigValidationError('Test error', {
      configPath: '/path/to/config.json',
    });
    assert.equal(error.configPath, '/path/to/config.json');
  });

  test('stores cause', () => {
    const cause = new Error('Original error');
    const error = new ConfigValidationError('Test error', { cause });
    assert.equal(error.cause, cause);
  });

  test('defaults errors to empty array', () => {
    const error = new ConfigValidationError('Test error');
    assert.deepEqual(error.errors, []);
  });
});

describe('Zod Schemas', () => {
  describe('MainConfigSchema', () => {
    test('parses minimal config', () => {
      const result = MainConfigSchema.safeParse({});
      assert.ok(result.success);
    });

    test('validates provider baseUrl format', () => {
      const result = MainConfigSchema.safeParse({
        providers: {
          custom: {
            type: 'custom',
            baseUrl: 'not-a-url',
          },
        },
      });
      assert.ok(!result.success);
    });
  });

  describe('BotConfigSchema', () => {
    test('requires all mandatory fields', () => {
      const result = BotConfigSchema.safeParse({});
      assert.ok(!result.success);
      assert.ok(result.error.issues.length >= 4); // id, soul, provider, model
    });

    test('accepts full bot config', () => {
      const fullConfig = {
        id: 'full-bot',
        soul: './soul.md',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        enabled: true,
        name: 'Full Bot',
        description: 'A fully configured bot',
        fallbacks: ['claude-haiku-4-5'],
        temperature: 0.5,
        maxTokens: 4096,
        channel: 'slack-main',
        sessionPer: 'thread',
        workspace: { root: './data/full-bot' },
        sandbox: {
          type: 'docker',
          image: 'node:22-slim',
          packages: ['git'],
          memory: '2g',
          cpus: 2,
        },
        tools: ['bash', 'readFile'],
        maxSteps: 50,
        mcpServers: ['github'],
        skills: ['./skills/code-review'],
        restrictions: {
          allowedUsers: ['U123'],
          dmAllowed: true,
        },
        compactionThreshold: 100000,
      };

      const result = BotConfigSchema.safeParse(fullConfig);
      assert.ok(result.success, `Failed: ${JSON.stringify(result.error?.issues)}`);
    });
  });
});
