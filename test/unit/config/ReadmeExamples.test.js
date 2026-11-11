/**
 * ReadmeExamples — pins README.md's JSON examples, config.example.json and the
 * source-install docs to reality.
 *
 * Every ```json block in README.md must parse as JSON and pass the ConfigValidator:
 * bot-shaped objects (id + soul) go through validateBotConfig, everything else
 * through validateMainConfig. config.example.json must pass validateMainConfig and
 * reference only environment variables that carry a `${VAR:-default}` fallback, so
 * `node bin/cli.js validate` exits 0 with no environment variables set.
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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ConfigValidator } from '../../../src/config/ConfigValidator.js';

const README_PATH = fileURLToPath(new URL('../../../README.md', import.meta.url));
const DOCS_README_PATH = fileURLToPath(new URL('../../../docs/README.md', import.meta.url));
const INSTALLATION_DOC_PATH = fileURLToPath(
  new URL('../../../docs/getting-started/installation.md', import.meta.url)
);
const EXAMPLE_CONFIG_PATH = fileURLToPath(new URL('../../../config.example.json', import.meta.url));

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

const JSON_BLOCK_PATTERN = /```json\s*\n([\s\S]*?)```/g;
const ENV_REF_PATTERN = /\$\{([^}:]+)(?::([-+])([^}]*))?\}/g;

/**
 * Extract every fenced ```json block from a markdown source.
 * @param {string} markdown
 * @returns {string[]}
 */
function extractJsonBlocks(markdown) {
  return [...markdown.matchAll(JSON_BLOCK_PATTERN)].map(match => match[1]);
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
      .filter(match => !match[2])
      .map(match => match[1]);
    assert.deepStrictEqual(
      withoutDefault,
      [],
      `references without a :- default throw ConfigError with no environment set: ${withoutDefault.join(', ')}`
    );
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
