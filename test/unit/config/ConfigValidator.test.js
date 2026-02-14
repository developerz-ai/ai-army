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
  ProviderSpecificSchemas,
  AnthropicProviderSchema,
  OpenAIProviderSchema,
  OpenRouterProviderSchema,
  OllamaProviderSchema,
  GoogleProviderSchema,
  CustomProviderSchema,
  SecretsConfigSchema,
  SecretAdapterConfigSchema,
  SecretCacheConfigSchema,
  QueueConfigSchema,
  AuditConfigSchema,
  AuditEventsConfigSchema,
  AuditRetentionConfigSchema,
  SandboxConfigSchema,
  ChannelRestrictionsSchema,
  BotChannelConfigSchema,
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

    test('validates bot with incus sandbox configuration', () => {
      const validator = new ConfigValidator();

      const config = {
        id: 'incus-bot',
        soul: './soul.md',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        sandbox: {
          type: 'incus',
          incusImage: 'images:ubuntu/24.04/cloud',
          incusProfile: 'default',
          packages: ['git', 'curl'],
          memory: '2g',
          cpus: 2,
        },
      };

      const result = validator.validateBotConfig(config);

      assert.equal(result.sandbox.type, 'incus');
      assert.equal(result.sandbox.incusImage, 'images:ubuntu/24.04/cloud');
      assert.equal(result.sandbox.incusProfile, 'default');
      assert.deepEqual(result.sandbox.packages, ['git', 'curl']);
    });

    test('validates bot with incus sandbox without optional incus fields', () => {
      const validator = new ConfigValidator();

      const config = {
        id: 'incus-minimal-bot',
        soul: './soul.md',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        sandbox: {
          type: 'incus',
        },
      };

      const result = validator.validateBotConfig(config);

      assert.equal(result.sandbox.type, 'incus');
      assert.equal(result.sandbox.incusImage, undefined);
      assert.equal(result.sandbox.incusProfile, undefined);
    });

    test('rejects invalid sandbox type', () => {
      const validator = new ConfigValidator();

      const config = {
        id: 'bad-sandbox-bot',
        soul: './soul.md',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        sandbox: {
          type: 'podman',
        },
      };

      assert.throws(() => validator.validateBotConfig(config), ConfigValidationError);
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

  describe('SandboxConfigSchema', () => {
    test('accepts docker sandbox type', () => {
      const result = SandboxConfigSchema.safeParse({ type: 'docker' });
      assert.ok(result.success);
      assert.equal(result.data.type, 'docker');
    });

    test('accepts incus sandbox type', () => {
      const result = SandboxConfigSchema.safeParse({ type: 'incus' });
      assert.ok(result.success);
      assert.equal(result.data.type, 'incus');
    });

    test('accepts just-bash sandbox type', () => {
      const result = SandboxConfigSchema.safeParse({ type: 'just-bash' });
      assert.ok(result.success);
      assert.equal(result.data.type, 'just-bash');
    });

    test('defaults type to docker', () => {
      const result = SandboxConfigSchema.safeParse({});
      assert.ok(result.success);
      assert.equal(result.data.type, 'docker');
    });

    test('rejects invalid sandbox type', () => {
      const result = SandboxConfigSchema.safeParse({ type: 'podman' });
      assert.ok(!result.success);
    });

    test('accepts incus-specific fields', () => {
      const result = SandboxConfigSchema.safeParse({
        type: 'incus',
        incusImage: 'images:ubuntu/24.04/cloud',
        incusProfile: 'default',
      });
      assert.ok(result.success);
      assert.equal(result.data.incusImage, 'images:ubuntu/24.04/cloud');
      assert.equal(result.data.incusProfile, 'default');
    });

    test('incusImage and incusProfile are optional', () => {
      const result = SandboxConfigSchema.safeParse({ type: 'incus' });
      assert.ok(result.success);
      assert.equal(result.data.incusImage, undefined);
      assert.equal(result.data.incusProfile, undefined);
    });

    test('docker type ignores incus fields gracefully', () => {
      const result = SandboxConfigSchema.safeParse({
        type: 'docker',
        incusImage: 'images:ubuntu/24.04',
        incusProfile: 'custom',
      });
      assert.ok(result.success);
      assert.equal(result.data.type, 'docker');
      assert.equal(result.data.incusImage, 'images:ubuntu/24.04');
    });

    test('accepts full incus config with resource limits', () => {
      const result = SandboxConfigSchema.safeParse({
        type: 'incus',
        incusImage: 'images:debian/12',
        incusProfile: 'bot-profile',
        packages: ['git', 'nodejs'],
        memory: '4g',
        cpus: 4,
      });
      assert.ok(result.success);
      assert.equal(result.data.type, 'incus');
      assert.equal(result.data.incusImage, 'images:debian/12');
      assert.equal(result.data.incusProfile, 'bot-profile');
      assert.equal(result.data.memory, '4g');
      assert.equal(result.data.cpus, 4);
    });
  });

  describe('SecretsConfigSchema', () => {
    test('accepts minimal secrets config', () => {
      const result = SecretsConfigSchema.safeParse({});
      assert.ok(result.success, `Failed: ${JSON.stringify(result.error?.issues)}`);
      assert.equal(result.data.provider, 'env');
    });

    test('accepts simple provider-only config', () => {
      const result = SecretsConfigSchema.safeParse({
        provider: 'bitwarden',
        config: { sessionToken: 'abc' },
      });
      assert.ok(result.success, `Failed: ${JSON.stringify(result.error?.issues)}`);
      assert.equal(result.data.provider, 'bitwarden');
    });

    test('accepts extended config with adapters map', () => {
      const result = SecretsConfigSchema.safeParse({
        provider: 'env',
        default: 'env',
        adapters: {
          bitwarden: {
            type: 'bitwarden',
            sessionToken: 'bw-session',
          },
          onepassword: {
            type: '1password',
            account: 'company.1password.com',
            token: 'op-token',
          },
        },
        cache: {
          enabled: true,
          ttl: 120000,
        },
      });
      assert.ok(result.success, `Failed: ${JSON.stringify(result.error?.issues)}`);
      assert.equal(Object.keys(result.data.adapters).length, 2);
      assert.equal(result.data.cache.ttl, 120000);
    });

    test('rejects invalid provider type', () => {
      const result = SecretsConfigSchema.safeParse({
        provider: 'invalid-provider',
      });
      assert.ok(!result.success);
    });

    test('rejects invalid adapter type', () => {
      const result = SecretAdapterConfigSchema.safeParse({
        type: 'invalid',
      });
      assert.ok(!result.success);
    });

    test('validates cache config with defaults', () => {
      const result = SecretCacheConfigSchema.safeParse({});
      assert.ok(result.success, `Failed: ${JSON.stringify(result.error?.issues)}`);
      assert.equal(result.data.enabled, true);
      assert.equal(result.data.ttl, 300000);
    });

    test('rejects negative cache TTL', () => {
      const result = SecretCacheConfigSchema.safeParse({
        ttl: -1000,
      });
      assert.ok(!result.success);
    });

    test('allows adapter-specific passthrough fields', () => {
      const result = SecretAdapterConfigSchema.safeParse({
        type: 'bitwarden',
        sessionToken: 'bw-session-123',
        extraField: 'allowed-by-passthrough',
      });
      assert.ok(result.success, `Failed: ${JSON.stringify(result.error?.issues)}`);
      assert.equal(result.data.sessionToken, 'bw-session-123');
      assert.equal(result.data.extraField, 'allowed-by-passthrough');
    });

    test('main config accepts secrets with adapters', () => {
      const validator = new ConfigValidator();
      const config = {
        providers: {},
        channels: {},
        secrets: {
          provider: 'env',
          default: 'bitwarden',
          adapters: {
            bitwarden: {
              type: 'bitwarden',
              sessionToken: 'bw-session',
            },
          },
          cache: {
            enabled: true,
            ttl: 60000,
          },
        },
      };

      const result = validator.validateMainConfig(config);
      assert.ok(result.valid, `Should be valid: ${JSON.stringify(result.errors)}`);
      assert.ok(result.data.secrets);
      assert.equal(result.data.secrets.default, 'bitwarden');
    });
  });

  describe('ProviderSpecificSchemas', () => {
    test('is a frozen object', () => {
      assert.ok(Object.isFrozen(ProviderSpecificSchemas));
    });

    test('has schemas for all provider types', () => {
      const expectedTypes = ['anthropic', 'openai', 'openrouter', 'ollama', 'google', 'custom'];
      for (const type of expectedTypes) {
        assert.ok(ProviderSpecificSchemas[type], `Should have schema for ${type}`);
      }
    });

    describe('AnthropicProviderSchema', () => {
      test('accepts valid anthropic config', () => {
        const result = AnthropicProviderSchema.safeParse({
          type: 'anthropic',
          apiKey: 'sk-ant-test',
        });
        assert.ok(result.success);
      });

      test('accepts config with baseUrl', () => {
        const result = AnthropicProviderSchema.safeParse({
          type: 'anthropic',
          baseUrl: 'https://custom-api.example.com',
        });
        assert.ok(result.success);
      });

      test('rejects wrong type literal', () => {
        const result = AnthropicProviderSchema.safeParse({
          type: 'openai',
          apiKey: 'key',
        });
        assert.ok(!result.success);
      });
    });

    describe('OpenAIProviderSchema', () => {
      test('accepts valid openai config', () => {
        const result = OpenAIProviderSchema.safeParse({
          type: 'openai',
          apiKey: 'sk-test',
        });
        assert.ok(result.success);
      });

      test('accepts organization field', () => {
        const result = OpenAIProviderSchema.safeParse({
          type: 'openai',
          apiKey: 'sk-test',
          organization: 'org-123',
        });
        assert.ok(result.success);
        assert.equal(result.data.organization, 'org-123');
      });

      test('rejects invalid baseUrl', () => {
        const result = OpenAIProviderSchema.safeParse({
          type: 'openai',
          baseUrl: 'not-a-url',
        });
        assert.ok(!result.success);
      });
    });

    describe('OpenRouterProviderSchema', () => {
      test('accepts valid openrouter config', () => {
        const result = OpenRouterProviderSchema.safeParse({
          type: 'openrouter',
          apiKey: 'sk-or-test',
        });
        assert.ok(result.success);
      });

      test('accepts siteUrl and siteName', () => {
        const result = OpenRouterProviderSchema.safeParse({
          type: 'openrouter',
          apiKey: 'sk-or-test',
          siteUrl: 'https://mysite.com',
          siteName: 'My App',
        });
        assert.ok(result.success);
        assert.equal(result.data.siteName, 'My App');
      });
    });

    describe('OllamaProviderSchema', () => {
      test('accepts ollama config without apiKey', () => {
        const result = OllamaProviderSchema.safeParse({
          type: 'ollama',
          baseUrl: 'http://localhost:11434',
        });
        assert.ok(result.success);
      });

      test('accepts minimal ollama config', () => {
        const result = OllamaProviderSchema.safeParse({
          type: 'ollama',
        });
        assert.ok(result.success);
      });
    });

    describe('GoogleProviderSchema', () => {
      test('accepts valid google config', () => {
        const result = GoogleProviderSchema.safeParse({
          type: 'google',
          apiKey: 'google-key',
        });
        assert.ok(result.success);
      });
    });

    describe('CustomProviderSchema', () => {
      test('accepts custom config with extra fields', () => {
        const result = CustomProviderSchema.safeParse({
          type: 'custom',
          apiKey: 'key',
          customField: 'value',
          anotherField: 42,
        });
        assert.ok(result.success);
        assert.equal(result.data.customField, 'value');
      });
    });
  });

  describe('validateProviderConfig()', () => {
    const validator = new ConfigValidator();

    test('validates anthropic provider config', () => {
      const result = validator.validateProviderConfig({
        type: 'anthropic',
        apiKey: 'sk-ant-test',
      });
      assert.equal(result.valid, true);
      assert.deepEqual(result.errors, []);
      assert.ok(result.data);
    });

    test('validates openai provider config', () => {
      const result = validator.validateProviderConfig({
        type: 'openai',
        apiKey: 'sk-test',
        organization: 'org-123',
      });
      assert.equal(result.valid, true);
    });

    test('validates ollama provider config without apiKey', () => {
      const result = validator.validateProviderConfig({
        type: 'ollama',
        baseUrl: 'http://localhost:11434',
      });
      assert.equal(result.valid, true);
    });

    test('validates openrouter provider config', () => {
      const result = validator.validateProviderConfig({
        type: 'openrouter',
        apiKey: 'sk-or-test',
        baseURL: 'https://openrouter.ai/api/v1',
      });
      assert.equal(result.valid, true);
    });

    test('validates custom provider with extra fields', () => {
      const result = validator.validateProviderConfig({
        type: 'custom',
        customEndpoint: 'https://my-api.com',
        customHeader: 'x-api-key',
      });
      assert.equal(result.valid, true);
    });

    test('returns invalid for null config', () => {
      const result = validator.validateProviderConfig(null);
      assert.equal(result.valid, false);
      assert.ok(result.errors.length > 0);
      assert.equal(result.data, null);
    });

    test('returns invalid for non-object config', () => {
      const result = validator.validateProviderConfig('string');
      assert.equal(result.valid, false);
    });

    test('returns invalid for config with invalid baseUrl', () => {
      const result = validator.validateProviderConfig({
        type: 'openai',
        baseUrl: 'not-a-url',
      });
      assert.equal(result.valid, false);
      assert.ok(result.errors.length > 0);
    });

    test('falls back to general schema for unknown type', () => {
      // When the type doesn't match a specific schema, it uses ProviderConfigSchema
      // which will reject unknown types via the ProviderTypeSchema enum
      const result = validator.validateProviderConfig({
        type: 'bedrock',
      });
      assert.equal(result.valid, false);
    });

    test('validates config without type field', () => {
      const result = validator.validateProviderConfig({
        apiKey: 'key',
      });
      // Should fall back to general ProviderConfigSchema which requires type
      assert.equal(result.valid, false);
    });
  });

  // ===========================================================================
  // QueueConfigSchema
  // ===========================================================================

  describe('QueueConfigSchema', () => {
    test('accepts valid queue config', () => {
      const result = QueueConfigSchema.safeParse({
        enabled: true,
        maxConcurrentPerBot: 5,
        defaultPriority: 0,
        retryAttempts: 3,
        retryDelay: 5000,
        pollInterval: 3000,
      });
      assert.ok(result.success);
      assert.equal(result.data.enabled, true);
      assert.equal(result.data.maxConcurrentPerBot, 5);
    });

    test('applies default values for optional fields', () => {
      const result = QueueConfigSchema.safeParse({});
      assert.ok(result.success);
      assert.equal(result.data.enabled, false);
      assert.equal(result.data.maxConcurrentPerBot, 3);
      assert.equal(result.data.defaultPriority, 0);
      assert.equal(result.data.retryAttempts, 3);
      assert.equal(result.data.retryDelay, 5000);
      assert.equal(result.data.pollInterval, 5000);
    });

    test('rejects non-integer maxConcurrentPerBot', () => {
      const result = QueueConfigSchema.safeParse({
        maxConcurrentPerBot: 2.5,
      });
      assert.equal(result.success, false);
    });

    test('rejects zero maxConcurrentPerBot', () => {
      const result = QueueConfigSchema.safeParse({
        maxConcurrentPerBot: 0,
      });
      assert.equal(result.success, false);
    });

    test('rejects negative retryAttempts', () => {
      const result = QueueConfigSchema.safeParse({
        retryAttempts: -1,
      });
      assert.equal(result.success, false);
    });

    test('accepts zero retryAttempts (no retries)', () => {
      const result = QueueConfigSchema.safeParse({
        retryAttempts: 0,
      });
      assert.ok(result.success);
      assert.equal(result.data.retryAttempts, 0);
    });

    test('rejects non-positive pollInterval', () => {
      const result = QueueConfigSchema.safeParse({
        pollInterval: 0,
      });
      assert.equal(result.success, false);
    });
  });

  // ===========================================================================
  // MainConfigSchema with queue
  // ===========================================================================

  describe('MainConfigSchema queue integration', () => {
    test('accepts main config with queue section', () => {
      const validator = new ConfigValidator();
      const result = validator.validateMainConfig({
        queue: {
          enabled: true,
          maxConcurrentPerBot: 5,
        },
      });
      assert.ok(result.valid);
      assert.equal(result.data.queue.enabled, true);
      assert.equal(result.data.queue.maxConcurrentPerBot, 5);
    });

    test('accepts main config without queue section', () => {
      const validator = new ConfigValidator();
      const result = validator.validateMainConfig({});
      assert.ok(result.valid);
      assert.equal(result.data.queue, undefined);
    });
  });

  describe('validateBotSkills()', () => {
    /**
     * Create a mock SkillRegistry with hasSkill()
     * @param {string[]} knownSkills - Skill names to recognize
     * @returns {Object} Mock skill registry
     */
    function createMockSkillRegistry(knownSkills = []) {
      return {
        hasSkill: name => knownSkills.includes(name),
      };
    }

    test('returns no errors when all skills exist in registry', () => {
      const validator = new ConfigValidator();
      const registry = createMockSkillRegistry(['code-review', 'deploy']);

      const errors = validator.validateBotSkills(
        {
          'work-bot': { skills: ['code-review', 'deploy'] },
        },
        registry
      );

      assert.equal(errors.length, 0);
    });

    test('returns errors for skills not found in registry', () => {
      const validator = new ConfigValidator();
      const registry = createMockSkillRegistry(['code-review']);

      const errors = validator.validateBotSkills(
        {
          'work-bot': { skills: ['code-review', 'deploy', 'triage'] },
        },
        registry
      );

      assert.equal(errors.length, 2);
      assert.ok(errors.some(e => e.message.includes('deploy')));
      assert.ok(errors.some(e => e.message.includes('triage')));
      assert.equal(errors[0].code, 'invalid_reference');
      assert.equal(errors[0].path, 'skills');
      assert.ok(errors[0].context.includes('work-bot'));
    });

    test('validates skills across multiple bots', () => {
      const validator = new ConfigValidator();
      const registry = createMockSkillRegistry(['code-review']);

      const errors = validator.validateBotSkills(
        {
          'bot-a': { skills: ['code-review'] },
          'bot-b': { skills: ['nonexistent'] },
        },
        registry
      );

      assert.equal(errors.length, 1);
      assert.ok(errors[0].context.includes('bot-b'));
    });

    test('returns no errors when bot has no skills', () => {
      const validator = new ConfigValidator();
      const registry = createMockSkillRegistry(['code-review']);

      const errors = validator.validateBotSkills(
        {
          'work-bot': {},
        },
        registry
      );

      assert.equal(errors.length, 0);
    });

    test('returns no errors when bot skills is empty array', () => {
      const validator = new ConfigValidator();
      const registry = createMockSkillRegistry(['code-review']);

      const errors = validator.validateBotSkills(
        {
          'work-bot': { skills: [] },
        },
        registry
      );

      assert.equal(errors.length, 0);
    });

    test('returns no errors when skillRegistry is null', () => {
      const validator = new ConfigValidator();

      const errors = validator.validateBotSkills(
        {
          'work-bot': { skills: ['code-review'] },
        },
        null
      );

      assert.equal(errors.length, 0);
    });

    test('returns no errors when skillRegistry is undefined', () => {
      const validator = new ConfigValidator();

      const errors = validator.validateBotSkills(
        {
          'work-bot': { skills: ['code-review'] },
        },
        undefined
      );

      assert.equal(errors.length, 0);
    });

    test('returns no errors when skillRegistry lacks hasSkill method', () => {
      const validator = new ConfigValidator();

      const errors = validator.validateBotSkills(
        {
          'work-bot': { skills: ['code-review'] },
        },
        {}
      );

      assert.equal(errors.length, 0);
    });
  });

  // ===========================================================================
  // ChannelRestrictionsSchema
  // ===========================================================================

  describe('ChannelRestrictionsSchema', () => {
    test('accepts empty restrictions', () => {
      const result = ChannelRestrictionsSchema.safeParse({});
      assert.ok(result.success);
      assert.equal(result.data.allowDMs, true);
    });

    test('accepts full restrictions config', () => {
      const result = ChannelRestrictionsSchema.safeParse({
        allowedChannels: ['C123', 'C456'],
        deniedChannels: ['C999'],
        allowedUsers: ['U001'],
        deniedUsers: ['U999'],
        allowDMs: false,
        allowedDomains: ['company.com'],
      });
      assert.ok(result.success);
      assert.deepEqual(result.data.allowedChannels, ['C123', 'C456']);
      assert.equal(result.data.allowDMs, false);
      assert.deepEqual(result.data.allowedDomains, ['company.com']);
    });

    test('accepts restrictions with only allowedChannels', () => {
      const result = ChannelRestrictionsSchema.safeParse({
        allowedChannels: ['C123456'],
      });
      assert.ok(result.success);
      assert.deepEqual(result.data.allowedChannels, ['C123456']);
    });
  });

  // ===========================================================================
  // BotChannelConfigSchema
  // ===========================================================================

  describe('BotChannelConfigSchema', () => {
    test('accepts valid bot channel config', () => {
      const result = BotChannelConfigSchema.safeParse({
        name: 'slack-engineering',
        type: 'slack',
        botToken: '${SLACK_ENG_TOKEN}',
      });
      assert.ok(result.success);
      assert.equal(result.data.name, 'slack-engineering');
      assert.equal(result.data.type, 'slack');
    });

    test('accepts bot channel with restrictions', () => {
      const result = BotChannelConfigSchema.safeParse({
        name: 'discord-public',
        type: 'discord',
        token: '${DISCORD_TOKEN}',
        restrictions: {
          allowDMs: true,
          allowedChannels: ['12345'],
        },
      });
      assert.ok(result.success);
      assert.equal(result.data.restrictions.allowDMs, true);
    });

    test('rejects bot channel without name', () => {
      const result = BotChannelConfigSchema.safeParse({
        type: 'slack',
        botToken: 'token',
      });
      assert.ok(!result.success);
    });

    test('rejects bot channel with empty name', () => {
      const result = BotChannelConfigSchema.safeParse({
        name: '',
        type: 'slack',
      });
      assert.ok(!result.success);
    });

    test('rejects bot channel with invalid type', () => {
      const result = BotChannelConfigSchema.safeParse({
        name: 'test-channel',
        type: 'telegram',
      });
      assert.ok(!result.success);
    });

    test('allows passthrough for adapter-specific fields', () => {
      const result = BotChannelConfigSchema.safeParse({
        name: 'rest-api',
        type: 'rest',
        port: 3000,
        host: 'localhost',
        authToken: 'secret',
      });
      assert.ok(result.success);
      assert.equal(result.data.port, 3000);
    });
  });

  // ===========================================================================
  // BotConfigSchema with channels[] array
  // ===========================================================================

  describe('BotConfigSchema channels[] array', () => {
    test('accepts bot config with channels array', () => {
      const result = BotConfigSchema.safeParse({
        id: 'multi-bot',
        soul: './soul.md',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        channels: [
          {
            name: 'slack-eng',
            type: 'slack',
            botToken: '${SLACK_ENG_TOKEN}',
          },
          {
            name: 'discord-pub',
            type: 'discord',
            token: '${DISCORD_TOKEN}',
            restrictions: { allowDMs: true },
          },
        ],
      });
      assert.ok(result.success, `Failed: ${JSON.stringify(result.error?.issues)}`);
      assert.equal(result.data.channels.length, 2);
      assert.equal(result.data.channels[0].name, 'slack-eng');
      assert.equal(result.data.channels[1].restrictions.allowDMs, true);
    });

    test('accepts bot config without channels array (backward compatible)', () => {
      const result = BotConfigSchema.safeParse({
        id: 'simple-bot',
        soul: './soul.md',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        channel: 'slack-main',
      });
      assert.ok(result.success);
      assert.equal(result.data.channel, 'slack-main');
      assert.equal(result.data.channels, undefined);
    });

    test('accepts bot config with both channel and channels', () => {
      const result = BotConfigSchema.safeParse({
        id: 'dual-bot',
        soul: './soul.md',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        channel: 'slack-main',
        channels: [{ name: 'discord-main', type: 'discord', token: 'test' }],
      });
      assert.ok(result.success);
    });

    test('accepts bot config with empty channels array', () => {
      const result = BotConfigSchema.safeParse({
        id: 'empty-channels-bot',
        soul: './soul.md',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        channels: [],
      });
      assert.ok(result.success);
      assert.deepEqual(result.data.channels, []);
    });
  });

  // ===========================================================================
  // Channel restrictions in main config channels
  // ===========================================================================

  describe('Channel restrictions in main config', () => {
    test('validates slack channel with restrictions', () => {
      const validator = new ConfigValidator();
      const config = {
        channels: {
          'slack-main': {
            type: 'slack',
            botToken: 'xoxb-test-token',
            restrictions: {
              allowedChannels: ['C123456', 'C789012'],
              deniedUsers: ['U999999'],
              allowDMs: false,
            },
          },
        },
      };
      const result = validator.validateMainConfig(config);
      assert.ok(result.valid, `Should be valid: ${JSON.stringify(result.errors)}`);
      assert.deepEqual(result.data.channels['slack-main'].restrictions.allowedChannels, [
        'C123456',
        'C789012',
      ]);
      assert.equal(result.data.channels['slack-main'].restrictions.allowDMs, false);
    });

    test('validates discord channel with restrictions', () => {
      const validator = new ConfigValidator();
      const config = {
        channels: {
          'discord-server': {
            type: 'discord',
            botToken: 'discord-test-token',
            restrictions: {
              allowedDomains: ['company.com'],
              allowDMs: true,
            },
          },
        },
      };
      const result = validator.validateMainConfig(config);
      assert.ok(result.valid);
      assert.deepEqual(result.data.channels['discord-server'].restrictions.allowedDomains, [
        'company.com',
      ]);
    });

    test('validates rest channel with restrictions', () => {
      const validator = new ConfigValidator();
      const config = {
        channels: {
          api: {
            type: 'rest',
            port: 3000,
            restrictions: {
              allowedUsers: ['admin'],
            },
          },
        },
      };
      const result = validator.validateMainConfig(config);
      assert.ok(result.valid);
      assert.deepEqual(result.data.channels.api.restrictions.allowedUsers, ['admin']);
    });
  });

  // ===========================================================================
  // Cross-reference: duplicate channel names in bot channels[]
  // ===========================================================================

  describe('validateAll() channels[] cross-reference', () => {
    test('detects duplicate channel names in bot channels array', () => {
      const validator = new ConfigValidator();
      const mainConfig = {
        providers: { anthropic: { type: 'anthropic', apiKey: 'test' } },
      };
      const botConfigs = {
        'multi-bot': {
          id: 'multi-bot',
          soul: './soul.md',
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          channels: [
            { name: 'slack-eng', type: 'slack', botToken: 'token1' },
            { name: 'slack-eng', type: 'slack', botToken: 'token2' },
          ],
        },
      };
      const result = validator.validateAll(mainConfig, botConfigs);
      assert.ok(!result.valid);
      assert.ok(result.errors.some(e => e.code === 'duplicate_channel_name'));
    });

    test('passes with unique channel names in bot channels array', () => {
      const validator = new ConfigValidator();
      const mainConfig = {
        providers: { anthropic: { type: 'anthropic', apiKey: 'test' } },
      };
      const botConfigs = {
        'multi-bot': {
          id: 'multi-bot',
          soul: './soul.md',
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          channels: [
            { name: 'slack-eng', type: 'slack', botToken: 'token1' },
            { name: 'discord-pub', type: 'discord', token: 'token2' },
          ],
        },
      };
      const result = validator.validateAll(mainConfig, botConfigs);
      assert.ok(result.valid);
    });
  });

  // --------------------------------------------------------------------------
  // AuditConfigSchema
  // --------------------------------------------------------------------------

  describe('AuditConfigSchema', () => {
    test('validates minimal audit config', () => {
      const result = AuditConfigSchema.safeParse({});
      assert.ok(result.success);
      assert.strictEqual(result.data.enabled, true);
    });

    test('validates full audit config', () => {
      const result = AuditConfigSchema.safeParse({
        enabled: true,
        retention: { enabled: true, days: 90 },
        events: { bot: true, message: true, tool: true, admin: true, security: true },
      });
      assert.ok(result.success);
      assert.strictEqual(result.data.enabled, true);
      assert.strictEqual(result.data.retention.days, 90);
    });

    test('accepts disabled audit config', () => {
      const result = AuditConfigSchema.safeParse({ enabled: false });
      assert.ok(result.success);
      assert.strictEqual(result.data.enabled, false);
    });

    test('applies default retention values', () => {
      const result = AuditConfigSchema.safeParse({ retention: {} });
      assert.ok(result.success);
      assert.strictEqual(result.data.retention.enabled, true);
      assert.strictEqual(result.data.retention.days, 90);
    });

    test('applies default events values', () => {
      const result = AuditConfigSchema.safeParse({ events: {} });
      assert.ok(result.success);
      assert.strictEqual(result.data.events.bot, true);
      assert.strictEqual(result.data.events.message, true);
      assert.strictEqual(result.data.events.tool, true);
      assert.strictEqual(result.data.events.admin, true);
      assert.strictEqual(result.data.events.security, true);
    });

    test('allows disabling specific event categories', () => {
      const result = AuditConfigSchema.safeParse({
        events: { bot: true, message: false, tool: false, admin: true, security: true },
      });
      assert.ok(result.success);
      assert.strictEqual(result.data.events.message, false);
      assert.strictEqual(result.data.events.tool, false);
    });

    test('rejects non-integer retention days', () => {
      const result = AuditConfigSchema.safeParse({ retention: { days: 30.5 } });
      assert.ok(!result.success);
    });

    test('rejects negative retention days', () => {
      const result = AuditConfigSchema.safeParse({ retention: { days: -1 } });
      assert.ok(!result.success);
    });

    test('rejects zero retention days', () => {
      const result = AuditConfigSchema.safeParse({ retention: { days: 0 } });
      assert.ok(!result.success);
    });

    test('rejects non-boolean enabled field', () => {
      const result = AuditConfigSchema.safeParse({ enabled: 'yes' });
      assert.ok(!result.success);
    });

    test('rejects non-boolean event category values', () => {
      const result = AuditConfigSchema.safeParse({ events: { bot: 'yes' } });
      assert.ok(!result.success);
    });

    test('allows custom retention days', () => {
      const result = AuditConfigSchema.safeParse({ retention: { days: 365 } });
      assert.ok(result.success);
      assert.strictEqual(result.data.retention.days, 365);
    });
  });

  // --------------------------------------------------------------------------
  // AuditRetentionConfigSchema
  // --------------------------------------------------------------------------

  describe('AuditRetentionConfigSchema', () => {
    test('validates correct retention config', () => {
      const result = AuditRetentionConfigSchema.safeParse({ enabled: true, days: 30 });
      assert.ok(result.success);
    });

    test('applies defaults when empty', () => {
      const result = AuditRetentionConfigSchema.safeParse({});
      assert.ok(result.success);
      assert.strictEqual(result.data.enabled, true);
      assert.strictEqual(result.data.days, 90);
    });

    test('rejects string days', () => {
      const result = AuditRetentionConfigSchema.safeParse({ days: '30' });
      assert.ok(!result.success);
    });
  });

  // --------------------------------------------------------------------------
  // AuditEventsConfigSchema
  // --------------------------------------------------------------------------

  describe('AuditEventsConfigSchema', () => {
    test('validates correct events config', () => {
      const result = AuditEventsConfigSchema.safeParse({
        bot: true,
        message: false,
        tool: true,
        admin: false,
        security: true,
      });
      assert.ok(result.success);
    });

    test('applies all defaults to true', () => {
      const result = AuditEventsConfigSchema.safeParse({});
      assert.ok(result.success);
      assert.strictEqual(result.data.bot, true);
      assert.strictEqual(result.data.message, true);
      assert.strictEqual(result.data.tool, true);
      assert.strictEqual(result.data.admin, true);
      assert.strictEqual(result.data.security, true);
    });
  });

  // --------------------------------------------------------------------------
  // validateAuditConfig()
  // --------------------------------------------------------------------------

  describe('validateAuditConfig()', () => {
    test('validates correct audit config', () => {
      const validator = new ConfigValidator();
      const result = validator.validateAuditConfig({
        enabled: true,
        retention: { enabled: true, days: 90 },
        events: { bot: true, message: true, tool: true, admin: true, security: true },
      });
      assert.ok(result.valid);
      assert.strictEqual(result.errors.length, 0);
      assert.ok(result.data);
    });

    test('returns errors for invalid audit config', () => {
      const validator = new ConfigValidator();
      const result = validator.validateAuditConfig({ enabled: 'not-a-boolean' });
      assert.ok(!result.valid);
      assert.ok(result.errors.length > 0);
      assert.strictEqual(result.data, null);
    });

    test('returns error for null input', () => {
      const validator = new ConfigValidator();
      const result = validator.validateAuditConfig(null);
      assert.ok(!result.valid);
      assert.ok(
        result.errors.some(e => e.message.includes('Audit configuration must be an object'))
      );
    });

    test('returns error for non-object input', () => {
      const validator = new ConfigValidator();
      const result = validator.validateAuditConfig('invalid');
      assert.ok(!result.valid);
    });

    test('validates audit config with defaults applied', () => {
      const validator = new ConfigValidator();
      const result = validator.validateAuditConfig({});
      assert.ok(result.valid);
      assert.strictEqual(result.data.enabled, true);
    });
  });

  // --------------------------------------------------------------------------
  // MainConfigSchema with audit field
  // --------------------------------------------------------------------------

  describe('MainConfigSchema with audit', () => {
    test('validates main config with audit section', () => {
      const result = MainConfigSchema.safeParse({
        audit: {
          enabled: true,
          retention: { days: 30 },
          events: { bot: true, message: true },
        },
      });
      assert.ok(result.success);
      assert.ok(result.data.audit);
      assert.strictEqual(result.data.audit.enabled, true);
      assert.strictEqual(result.data.audit.retention.days, 30);
    });

    test('validates main config without audit section', () => {
      const result = MainConfigSchema.safeParse({});
      assert.ok(result.success);
      assert.strictEqual(result.data.audit, undefined);
    });

    test('rejects main config with invalid audit section', () => {
      const result = MainConfigSchema.safeParse({
        audit: { enabled: 'bad' },
      });
      assert.ok(!result.success);
    });
  });
});
