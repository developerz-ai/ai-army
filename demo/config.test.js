/**
 * Tests for demo configuration files
 *
 * Validates demo/config.json and all 3 bot configs
 * against the framework's Zod schemas.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ConfigValidator,
  MainConfigSchema,
  BotConfigSchema,
} from 'ai-army';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEMO_DIR = join(__dirname);

// The framework is consumed as an installed package: its root comes from the
// resolved 'ai-army' package.json, never from a path relative to this demo.
const FRAMEWORK_ROOT = dirname(fileURLToPath(import.meta.resolve('ai-army/package.json')));

/**
 * Parse JSON file at given path
 * @param {string} filePath - Absolute path to JSON file
 * @returns {Promise<Object>} Parsed JSON object
 */
async function loadJson(filePath) {
  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

describe('Demo config.json', () => {
  let config;

  before(async () => {
    config = await loadJson(join(DEMO_DIR, 'config.json'));
  });

  test('is valid JSON', () => {
    assert.ok(config, 'config.json should parse as valid JSON');
    assert.equal(typeof config, 'object');
  });

  test('passes MainConfigSchema validation', () => {
    const result = MainConfigSchema.safeParse(config);
    assert.ok(result.success, `Schema validation failed: ${JSON.stringify(result.error?.issues)}`);
  });

  test('passes ConfigValidator.validateMainConfig()', () => {
    const validator = new ConfigValidator();
    const result = validator.validateMainConfig(config);
    assert.ok(result.valid, `Validation errors: ${JSON.stringify(result.errors)}`);
    assert.equal(result.errors.length, 0);
  });

  test('defines anthropic provider', () => {
    assert.ok(config.providers, 'Should have providers section');
    assert.ok(config.providers.anthropic, 'Should have anthropic provider');
    assert.equal(config.providers.anthropic.type, 'anthropic');
  });

  test('uses env var interpolation for API key', () => {
    assert.equal(
      config.providers.anthropic.apiKey,
      '${ANTHROPIC_API_KEY}',
      'API key should use env var interpolation'
    );
  });

  test('defines sensible defaults', () => {
    assert.ok(config.defaults, 'Should have defaults section');
    assert.ok(config.defaults.model, 'Should have default model');
    assert.equal(config.defaults.model.provider, 'anthropic');
    assert.ok(config.defaults.model.model, 'Should have default model name');
  });

  test('defines sandbox defaults', () => {
    assert.ok(config.defaults.sandbox, 'Should have sandbox defaults');
    assert.equal(config.defaults.sandbox.type, 'incus');
    assert.ok(config.defaults.sandbox.incusImage, 'Should have default image');
  });

  test('has empty channels and mcpServers', () => {
    assert.deepEqual(config.channels, {}, 'Channels should be empty for demo');
    assert.deepEqual(config.mcpServers, {}, 'MCP servers should be empty for demo');
  });

  test('uses env secrets provider', () => {
    assert.ok(config.secrets, 'Should have secrets section');
    assert.equal(config.secrets.provider, 'env');
  });
});

describe('Demo bot configs', () => {
  const botIds = ['echo-bot', 'calculator-bot', 'file-assistant'];
  const botConfigs = {};

  before(async () => {
    for (const botId of botIds) {
      botConfigs[botId] = await loadJson(join(DEMO_DIR, 'bots', botId, 'config.json'));
    }
  });

  for (const botId of botIds) {
    describe(`bots/${botId}/config.json`, () => {
      test('is valid JSON', () => {
        assert.ok(botConfigs[botId], `${botId} config.json should parse`);
        assert.equal(typeof botConfigs[botId], 'object');
      });

      test('passes BotConfigSchema validation', () => {
        const result = BotConfigSchema.safeParse(botConfigs[botId]);
        assert.ok(
          result.success,
          `${botId} schema validation failed: ${JSON.stringify(result.error?.issues)}`
        );
      });

      test('passes ConfigValidator.validateBotConfig()', () => {
        const validator = new ConfigValidator();
        const result = validator.validateBotConfig(botConfigs[botId]);
        assert.ok(result, `${botId} should return validated config`);
        assert.equal(result.id, botId);
      });

      test('has required fields', () => {
        const config = botConfigs[botId];
        assert.ok(config.id, 'Should have id');
        assert.ok(config.soul, 'Should have soul');
        assert.ok(config.provider, 'Should have provider');
        assert.ok(config.model, 'Should have model');
      });

      test('soul references ./soul.md', () => {
        assert.equal(botConfigs[botId].soul, './soul.md');
      });

      test('uses anthropic provider', () => {
        assert.equal(botConfigs[botId].provider, 'anthropic');
      });
    });
  }
});

describe('Echo bot config', () => {
  let config;

  before(async () => {
    config = await loadJson(join(DEMO_DIR, 'bots', 'echo-bot', 'config.json'));
  });

  test('uses claude-haiku-4-5 (lightweight model)', () => {
    assert.equal(config.model, 'claude-haiku-4-5');
  });

  test('has no tools (simplest bot)', () => {
    assert.deepEqual(config.tools, []);
  });

  test('has name and description', () => {
    assert.ok(config.name, 'Should have name');
    assert.ok(config.description, 'Should have description');
  });
});

describe('Calculator bot config', () => {
  let config;

  before(async () => {
    config = await loadJson(join(DEMO_DIR, 'bots', 'calculator-bot', 'config.json'));
  });

  test('uses claude-sonnet-4-5', () => {
    assert.equal(config.model, 'claude-sonnet-4-5');
  });

  test('has bash tool', () => {
    assert.ok(Array.isArray(config.tools));
    assert.ok(config.tools.includes('bash'), 'Should include bash tool');
  });

  test('has sandbox with bc package', () => {
    assert.ok(config.sandbox, 'Should have sandbox config');
    assert.ok(Array.isArray(config.sandbox.packages));
    assert.ok(config.sandbox.packages.includes('bc'), 'Should install bc package');
  });

  test('has name and description', () => {
    assert.ok(config.name, 'Should have name');
    assert.ok(config.description, 'Should have description');
  });
});

describe('File assistant config', () => {
  let config;

  before(async () => {
    config = await loadJson(join(DEMO_DIR, 'bots', 'file-assistant', 'config.json'));
  });

  test('uses claude-sonnet-4-5', () => {
    assert.equal(config.model, 'claude-sonnet-4-5');
  });

  test('has file operation tools', () => {
    assert.ok(Array.isArray(config.tools));
    assert.ok(config.tools.includes('bash'), 'Should include bash');
    assert.ok(config.tools.includes('readFile'), 'Should include readFile');
    assert.ok(config.tools.includes('writeFile'), 'Should include writeFile');
    assert.ok(config.tools.includes('glob'), 'Should include glob');
  });

  test('has workspace configured', () => {
    assert.ok(config.workspace, 'Should have workspace config');
    assert.ok(config.workspace.root, 'Should have workspace root');
    assert.equal(config.workspace.root, './data/file-assistant');
  });

  test('has name and description', () => {
    assert.ok(config.name, 'Should have name');
    assert.ok(config.description, 'Should have description');
  });
});

describe('File assistant workspace path agreement', () => {
  // The soul prompt is read by the model, whose tools run INSIDE the container.
  // IncusBackend mounts the host workspace.root at a fixed container path, so the
  // soul must name that container path — never the host-relative workspace.root.
  let config;
  let soul;
  let backend;

  before(async () => {
    config = await loadJson(join(DEMO_DIR, 'bots', 'file-assistant', 'config.json'));
    soul = await readFile(join(DEMO_DIR, 'bots', 'file-assistant', 'soul.md'), 'utf-8');
    backend = await readFile(
      join(FRAMEWORK_ROOT, 'src', 'execution', 'incus-backend.js'),
      'utf-8'
    );
  });

  function soulWorkspacePath() {
    const match = soul.match(/workspace at (\/[\w./-]*[\w])/);
    assert.ok(match, 'soul.md should state its absolute workspace path ("workspace at /...")');
    return match[1];
  }

  function containerMountPath() {
    const match = backend.match(/workspace:\s*\{[^}]*?type:\s*'disk'[^}]*?path:\s*'(\/[^']+)'/);
    assert.ok(match, "incus-backend.js should define a 'workspace' disk device with an absolute path");
    return match[1];
  }

  test('soul workspace path equals the container mount path of workspace.root', () => {
    assert.equal(soulWorkspacePath(), containerMountPath());
  });

  test('mount path is derived from workspace.root as the disk device source', () => {
    assert.match(
      backend,
      /workspace:\s*\{[^}]*?source:\s*hostPath/,
      'disk device source should be the resolved workspace.root'
    );
    assert.match(backend, /const workspaceRoot = workspace\?\.root/);
  });

  test('workspace.root stays the host-relative ./data/file-assistant', () => {
    assert.equal(config.workspace.root, './data/file-assistant');
  });

  test('soul does not name the host-relative workspace.root', () => {
    assert.ok(!soul.includes(config.workspace.root), 'soul.md must not mention workspace.root');
    assert.ok(!soul.includes('data/file-assistant'), 'soul.md must not mention the host path');
  });
});

describe('Cross-validation: main config + all bots', () => {
  let mainConfig;
  const botConfigs = {};
  const botIds = ['echo-bot', 'calculator-bot', 'file-assistant'];

  before(async () => {
    mainConfig = await loadJson(join(DEMO_DIR, 'config.json'));
    for (const botId of botIds) {
      botConfigs[botId] = await loadJson(join(DEMO_DIR, 'bots', botId, 'config.json'));
    }
  });

  test('validateAll() passes for demo configuration', () => {
    const validator = new ConfigValidator();
    const result = validator.validateAll(mainConfig, botConfigs);
    assert.ok(result.valid, `Cross-validation failed:\n${validator.generateReport(result.errors)}`);
    assert.equal(result.errors.length, 0);
  });

  test('all bots reference valid provider', () => {
    const providers = Object.keys(mainConfig.providers || {});
    for (const [botId, config] of Object.entries(botConfigs)) {
      assert.ok(
        providers.includes(config.provider) || config.provider === 'anthropic',
        `${botId} references invalid provider: ${config.provider}`
      );
    }
  });

  test('demo has exactly 3 bots', () => {
    assert.equal(Object.keys(botConfigs).length, 3);
  });
});

describe('Soul files exist', () => {
  const botIds = ['echo-bot', 'calculator-bot', 'file-assistant'];

  for (const botId of botIds) {
    test(`bots/${botId}/soul.md exists and has content`, async () => {
      const soulPath = join(DEMO_DIR, 'bots', botId, 'soul.md');
      const content = await readFile(soulPath, 'utf-8');
      assert.ok(content.length > 0, `${botId}/soul.md should have content`);
      assert.ok(content.startsWith('#'), `${botId}/soul.md should start with markdown heading`);
    });
  }
});
