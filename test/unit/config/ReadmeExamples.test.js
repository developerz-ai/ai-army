/**
 * ReadmeExamples — pins README.md's JSON examples, config.example.json and the
 * source-install docs to reality.
 *
 * Every ```json block in README.md must parse as JSON and pass the ConfigValidator:
 * bot-shaped objects (id + soul) go through validateBotConfig, everything else
 * through validateMainConfig. config.example.json must pass validateMainConfig,
 * carry only `${VAR:-default}` references, and still pass validateMainConfig
 * after ConfigLoader interpolates it with no environment variables set — so
 * `node bin/cli.js validate` exits 0 with no environment variables set.
 *
 * Every documented sandbox configuration must name a sandbox type the bot schema
 * accepts (`incus` or `just-bash`): `docker` is not a supported sandbox type.
 *
 * No markdown document may tell readers to copy an Incus image onto the read-only
 * `images:` remote — the image has to be pre-pulled into the local daemon (`local:`).
 *
 * README.md, docs/README.md and docs/getting-started/installation.md must all
 * document the source install — git clone + `node bin/cli.js` — and none of them
 * may mention `npx ai-army`, the npm package or an npm version badge: AI Army is
 * installed from source, there is no npm package.
 *
 * @module test/unit/config/ReadmeExamples
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BotConfigSchema, ConfigValidator } from '../../../src/config/ConfigValidator.js';
import { ConfigLoader } from '../../../src/config/ConfigLoader.js';

const README_PATH = fileURLToPath(new URL('../../../README.md', import.meta.url));
const DOCS_README_PATH = fileURLToPath(new URL('../../../docs/README.md', import.meta.url));
const INSTALLATION_DOC_PATH = fileURLToPath(
  new URL('../../../docs/getting-started/installation.md', import.meta.url)
);
const EXAMPLE_CONFIG_PATH = fileURLToPath(new URL('../../../config.example.json', import.meta.url));
const DOCS_DIR_PATH = fileURLToPath(new URL('../../../docs/', import.meta.url));

/**
 * The docs that carry configuration examples. Their sandbox blocks must name a
 * sandbox type ConfigValidator accepts.
 */
const CONFIG_DOCS = [
  { label: 'README.md', path: README_PATH },
  {
    label: 'docs/configuration.md',
    path: fileURLToPath(new URL('../../../docs/configuration.md', import.meta.url)),
  },
  {
    label: 'docs/getting-started/configuration.md',
    path: fileURLToPath(new URL('../../../docs/getting-started/configuration.md', import.meta.url)),
  },
  {
    label: 'docs/getting-started/first-bot.md',
    path: fileURLToPath(new URL('../../../docs/getting-started/first-bot.md', import.meta.url)),
  },
  {
    label: 'docs/getting-started/incus-bots.md',
    path: fileURLToPath(new URL('../../../docs/getting-started/incus-bots.md', import.meta.url)),
  },
];

/**
 * The docs that must document the source install: clone the repository, run the
 * CLI via `node bin/cli.js`, and never mention `npx ai-army`, the npm package or
 * an npm version badge.
 */
const SOURCE_INSTALL_DOCS = [
  { label: 'README.md', path: README_PATH },
  { label: 'docs/README.md', path: DOCS_README_PATH },
  { label: 'docs/getting-started/installation.md', path: INSTALLATION_DOC_PATH },
];

/**
 * Every markdown document under docs/ plus the repository README. The Incus
 * image commands in the guides are followed by hand, so no document may copy an
 * image onto the read-only `images:` remote — it has to be pre-pulled into the
 * local daemon (`local:`) instead.
 */
const MARKDOWN_DOCS = [
  { label: 'README.md', path: README_PATH },
  ...readdirSync(DOCS_DIR_PATH, { recursive: true })
    .filter(name => name.endsWith('.md'))
    .map(name => ({ label: `docs/${name}`, path: join(DOCS_DIR_PATH, name) })),
];

const JSON_BLOCK_PATTERN = /```json\s*\n([\s\S]*?)```/g;
// Same shape as ConfigLoader's reference pattern: group 2 is the operator
// (`:-` or `:+`), group 3 the value behind it. Only `:-` provides a default.
const ENV_REF_PATTERN = /\$\{([^}:]+)(?:(:[-+])([^}]*))?\}/g;

/**
 * Extract every fenced ```json block from a markdown source.
 * @param {string} markdown
 * @returns {string[]}
 */
function extractJsonBlocks(markdown) {
  return [...markdown.matchAll(JSON_BLOCK_PATTERN)].map(match => match[1]);
}

/**
 * Collect the sandbox objects of a parsed JSON document: a bot config's
 * top-level `sandbox` and a main config's `defaults.sandbox`.
 * @param {*} obj
 * @returns {object[]}
 */
function collectSandboxes(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return [];
  const found = [];
  if (obj.sandbox && typeof obj.sandbox === 'object') found.push(obj.sandbox);
  if (obj.defaults?.sandbox && typeof obj.defaults.sandbox === 'object') {
    found.push(obj.defaults.sandbox);
  }
  return found;
}

/**
 * Format ConfigValidator error objects for an assertion message.
 * @param {Array<{path: unknown, message: string}>} errors
 * @returns {string}
 */
function formatErrors(errors) {
  return errors.map(e => `${e.path}: ${e.message}`).join('\n  ');
}

/**
 * Validate a bot-shaped object through the real API. validateBotConfig returns
 * the parsed config on success and THROWS ConfigValidationError on failure —
 * normalize both outcomes into { valid, errors }.
 * @param {ConfigValidator} validator
 * @param {object} obj
 * @returns {{valid: boolean, errors: Array<{path: unknown, message: string}>}}
 */
function validateBotConfigQuietly(validator, obj) {
  try {
    validator.validateBotConfig(obj);
    return { valid: true, errors: [] };
  } catch (err) {
    const errors = err.errors
      ? err.errors.map(e => ({ path: e.path, message: e.message }))
      : [{ path: err.name, message: err.message }];
    return { valid: false, errors };
  }
}

describe('README.md JSON examples', () => {
  const readme = readFileSync(README_PATH, 'utf8');
  const validator = new ConfigValidator();
  const blocks = extractJsonBlocks(readme);

  test('README.md carries json blocks to pin', () => {
    assert.ok(blocks.length > 0, 'no ```json blocks found in README.md');
  });

  for (const [index, block] of blocks.entries()) {
    test(`README.md json block ${index} passes ConfigValidator`, () => {
      let obj;
      try {
        obj = JSON.parse(block);
      } catch (err) {
        assert.fail(`README.md json block ${index} is not valid JSON: ${err.message}\n${block}`);
      }

      const isBotConfig =
        obj !== null &&
        typeof obj === 'object' &&
        !Array.isArray(obj) &&
        'id' in obj &&
        'soul' in obj;

      if (isBotConfig) {
        const { valid, errors } = validateBotConfigQuietly(validator, obj);
        assert.ok(
          valid,
          `README.md bot config in block ${index} failed validateBotConfig:\n  ${formatErrors(errors)}`
        );
      } else {
        const result = validator.validateMainConfig(obj);
        assert.ok(
          result.valid,
          `README.md main config in block ${index} failed validateMainConfig:\n  ${formatErrors(result.errors)}`
        );
      }
    });
  }
});

describe('source install documented, not the npm package (README.md + docs)', () => {
  for (const doc of SOURCE_INSTALL_DOCS) {
    test(`${doc.label} documents the source install, not the npm package`, () => {
      const source = readFileSync(doc.path, 'utf8');
      assert.ok(
        source.includes('git clone https://github.com/developerz-ai/ai-army'),
        `${doc.label} must tell users to clone the repository`
      );
      assert.ok(
        source.includes('node bin/cli.js'),
        `${doc.label} must invoke the CLI via node bin/cli.js`
      );
      assert.ok(
        !source.includes('npx ai-army'),
        `${doc.label} must not tell users to run npx ai-army`
      );
      assert.ok(
        !source.includes('npmjs.com/package/ai-army'),
        `${doc.label} must not link the npm package`
      );
      assert.ok(
        !source.includes('shields.io/npm/v'),
        `${doc.label} must not carry the npm version badge`
      );
    });
  }
});

describe('config.example.json', () => {
  const raw = readFileSync(EXAMPLE_CONFIG_PATH, 'utf8');
  const validator = new ConfigValidator();

  test('passes validateMainConfig', () => {
    const config = JSON.parse(raw);
    const result = validator.validateMainConfig(config);
    assert.ok(
      result.valid,
      `config.example.json failed validateMainConfig:\n  ${formatErrors(result.errors)}`
    );
  });

  test('every ${VAR} reference carries a :- fallback', () => {
    const withoutDefault = [...raw.matchAll(ENV_REF_PATTERN)]
      .filter(match => match[2] !== ':-')
      .map(match => match[1]);
    assert.deepStrictEqual(
      withoutDefault,
      [],
      `references without a :- default resolve to an empty value with no environment set: ${withoutDefault.join(', ')}`
    );
  });

  test('interpolates with no environment set and still validates', () => {
    const referenced = [...new Set([...raw.matchAll(ENV_REF_PATTERN)].map(match => match[1]))];
    const saved = new Map(referenced.map(name => [name, process.env[name]]));
    for (const name of referenced) delete process.env[name];

    try {
      const interpolated = new ConfigLoader().interpolateEnvVars(JSON.parse(raw));
      assert.ok(
        !JSON.stringify(interpolated).includes('${'),
        'config.example.json must resolve every ${VAR} reference with no environment set'
      );
      const result = validator.validateMainConfig(interpolated);
      assert.ok(
        result.valid,
        `config.example.json with no environment set failed validateMainConfig:\n  ${formatErrors(result.errors)}`
      );
    } finally {
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  test('registers no bots (bots live in bots/<id>/config.json)', () => {
    const config = JSON.parse(raw);
    assert.deepStrictEqual(
      Object.keys(config.bots ?? {}),
      [],
      'config.example.json must stay generic; bots are registered by their bots/<id> directory'
    );
  });
});

describe('documented sandbox configurations', () => {
  for (const doc of CONFIG_DOCS) {
    test(`${doc.label} documents sandbox types ConfigValidator accepts`, () => {
      const source = readFileSync(doc.path, 'utf8');
      const rejected = [];

      for (const block of extractJsonBlocks(source)) {
        let obj;
        try {
          obj = JSON.parse(block);
        } catch {
          continue; // a fragment, not a complete JSON document
        }

        for (const sandbox of collectSandboxes(obj)) {
          if (typeof sandbox.type !== 'string') continue;
          if (!BotConfigSchema.shape.sandbox.safeParse({ type: sandbox.type }).success) {
            rejected.push(sandbox.type);
          }
        }
      }

      assert.deepStrictEqual(
        rejected,
        [],
        `${doc.label} documents sandbox type(s) ConfigValidator rejects: ${rejected.join(', ')}`
      );
    });
  }
});

describe('documented Incus image commands', () => {
  for (const doc of MARKDOWN_DOCS) {
    test(`${doc.label} never copies an image onto the read-only images: remote`, () => {
      const source = readFileSync(doc.path, 'utf8');
      const offending = [...source.matchAll(/incus image copy\s+(\S+)\s+(\S+)/g)]
        .filter(match => match[2].startsWith('images:'))
        .map(match => match[0]);

      assert.deepStrictEqual(
        offending,
        [],
        `${doc.label} copies an image onto the read-only images: remote: ${offending.join('; ')}`
      );
    });
  }
});
