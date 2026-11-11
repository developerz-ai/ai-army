/**
 * Unit tests for the root .env.example contract.
 *
 * The documented Slack channel configs interpolate ${SLACK_BOT_TOKEN},
 * ${SLACK_APP_TOKEN} and ${SLACK_SIGNING_SECRET}. Every one of them has to be
 * declared in .env.example, and SLACK_SIGNING_SECRET has to carry a NON-EMPTY
 * placeholder: both interpolation paths (src/config/ConfigLoader.js and
 * src/adapters/secrets/env.js) treat an empty value as unset and throw
 * "Required environment variable '<NAME>' is not set".
 *
 * The Docker Compose app service has to forward every declared Slack variable:
 * one that stops at the compose file never reaches the container, and startup
 * fails with the same error.
 *
 * @module env-example
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { ConfigLoader } from '../../../src/config/ConfigLoader.js';

// =============================================================================
// Constants
// =============================================================================

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const ENV_EXAMPLE_PATH = path.join(REPO_ROOT, '.env.example');
const COMPOSE_PATH = path.join(REPO_ROOT, 'docker-compose.yml');

/**
 * User-facing docs whose Slack channel configs are part of the supported contract.
 * @type {string[]}
 */
const SLACK_DOCS = [
  'README.md',
  'docs/configuration.md',
  'docs/deployment.md',
  'docs/getting-started/configuration.md',
  'docs/getting-started/first-bot.md',
];

/**
 * The Slack variables the documented configs interpolate.
 * @type {string[]}
 */
const EXPECTED_SLACK_VARS = ['SLACK_APP_TOKEN', 'SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET'];

/**
 * A real Slack signing secret is a 32 character hex string.
 * @type {RegExp}
 */
const REAL_SIGNING_SECRET = /^[0-9a-f]{32}$/i;

/**
 * Markers that identify a value as a placeholder rather than a live secret.
 * @type {RegExp}
 */
const PLACEHOLDER_MARKER = /your|here|changeme|placeholder|replace|example|dummy|xxx/i;

// =============================================================================
// Helpers
// =============================================================================

/**
 * Parse an .env-style file into its declarations and the section each belongs to.
 *
 * A section is a "# === NAME ===" header; a declaration is a "NAME=value" line
 * that is not commented out.
 *
 * @param {string} text - File contents
 * @returns {{declarations: Map<string, Object>, sections: string[]}} - Parsed file
 */
function parseEnvFile(text) {
  const declarations = new Map();
  const sections = [];
  let currentSection = null;

  text.split('\n').forEach((line, index) => {
    // Section headers look like "# === NAME ==="; the "=" rules above and below
    // them are separators, not sections, so the name must contain a non-"=" char.
    const header = line.match(/^#\s*===\s*([^=]+?)\s*===\s*$/);
    if (header) {
      const [, sectionName] = header;
      currentSection = sectionName;
      sections.push(sectionName);
      return;
    }

    const assignment = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (assignment) {
      const [, name, rawValue] = assignment;
      declarations.set(name, {
        name,
        value: rawValue.trim(),
        section: currentSection,
        line: index,
      });
    }
  });

  return { declarations, sections };
}

/**
 * Collect the ${SLACK_*} variables interpolated by the documented Slack configs.
 * @returns {Promise<Set<string>>} - Names of the interpolated Slack variables
 */
async function collectDocumentedSlackVars() {
  const found = new Set();

  for (const docPath of SLACK_DOCS) {
    const text = await fs.readFile(path.join(REPO_ROOT, docPath), 'utf8');
    for (const match of text.matchAll(/\$\{(SLACK_[A-Za-z0-9_]+)/g)) {
      found.add(match[1]);
    }
  }

  return found;
}

// =============================================================================
// Tests
// =============================================================================

describe('root .env.example', () => {
  const originalSigningSecret = process.env.SLACK_SIGNING_SECRET;

  /** @type {{declarations: Map<string, Object>, sections: string[]}} */
  let envExample;

  beforeEach(async () => {
    envExample = parseEnvFile(await fs.readFile(ENV_EXAMPLE_PATH, 'utf8'));
  });

  afterEach(() => {
    if (originalSigningSecret === undefined) {
      delete process.env.SLACK_SIGNING_SECRET;
    } else {
      process.env.SLACK_SIGNING_SECRET = originalSigningSecret;
    }
  });

  test('declares SLACK_SIGNING_SECRET inside the COMMUNICATION CHANNELS section', () => {
    const declaration = envExample.declarations.get('SLACK_SIGNING_SECRET');
    assert.ok(declaration, 'SLACK_SIGNING_SECRET must be declared in .env.example');
    assert.match(
      declaration.section || '',
      /COMMUNICATION CHANNELS/i,
      'SLACK_SIGNING_SECRET must live in the COMMUNICATION CHANNELS section'
    );
  });

  test('places SLACK_SIGNING_SECRET after SLACK_APP_TOKEN and before the Discord block', () => {
    const signingSecret = envExample.declarations.get('SLACK_SIGNING_SECRET');
    const appToken = envExample.declarations.get('SLACK_APP_TOKEN');
    const discordToken = envExample.declarations.get('DISCORD_BOT_TOKEN');

    assert.ok(signingSecret, 'SLACK_SIGNING_SECRET must be declared in .env.example');
    assert.ok(appToken, 'SLACK_APP_TOKEN must be declared in .env.example');
    assert.ok(discordToken, 'DISCORD_BOT_TOKEN must be declared in .env.example');

    assert.ok(
      appToken.line < signingSecret.line,
      'SLACK_SIGNING_SECRET must come after SLACK_APP_TOKEN'
    );
    assert.ok(
      signingSecret.line < discordToken.line,
      'SLACK_SIGNING_SECRET must come before the Discord block'
    );
  });

  test('ships a non-empty placeholder for SLACK_SIGNING_SECRET, never a real secret', () => {
    const { value } = envExample.declarations.get('SLACK_SIGNING_SECRET');

    assert.ok(value.length > 0, 'SLACK_SIGNING_SECRET must not be empty in .env.example');
    assert.match(
      value,
      PLACEHOLDER_MARKER,
      'SLACK_SIGNING_SECRET must be an obvious placeholder, not a live secret'
    );
    assert.doesNotMatch(
      value,
      REAL_SIGNING_SECRET,
      'SLACK_SIGNING_SECRET must not be a 32 character hex signing secret'
    );
    assert.doesNotMatch(
      value,
      /^xox[bp]-/i,
      'SLACK_SIGNING_SECRET must not carry a Slack token prefix'
    );
  });

  test('declares every ${SLACK_*} variable the documented Slack configs interpolate', async () => {
    const documented = await collectDocumentedSlackVars();

    for (const name of EXPECTED_SLACK_VARS) {
      assert.ok(
        documented.has(name),
        `${name} must be interpolated by the documented Slack configs`
      );
    }

    for (const name of documented) {
      assert.ok(
        envExample.declarations.has(name),
        `${name} is interpolated by the documented Slack configs but missing from .env.example`
      );
    }
  });

  test('interpolates the signing secret when the .env.example value is exported', () => {
    const { value } = envExample.declarations.get('SLACK_SIGNING_SECRET');
    process.env.SLACK_SIGNING_SECRET = value;

    const config = new ConfigLoader().interpolateEnvVars({
      signingSecret: '${SLACK_SIGNING_SECRET}',
    });

    assert.equal(config.signingSecret, value);
  });

  test('still throws for an empty signing secret, because empty counts as unset', () => {
    process.env.SLACK_SIGNING_SECRET = '';

    assert.throws(
      () => new ConfigLoader().interpolateEnvVars({ signingSecret: '${SLACK_SIGNING_SECRET}' }),
      /Required environment variable 'SLACK_SIGNING_SECRET' is not set/
    );
  });

  test('forwards every declared SLACK_* variable to the compose app service', async () => {
    const compose = yaml.load(await fs.readFile(COMPOSE_PATH, 'utf8'));
    const appEnvironment = compose?.services?.app?.environment ?? {};
    const slackVarNames = [];

    for (const name of envExample.declarations.keys()) {
      if (name.startsWith('SLACK_')) {
        slackVarNames.push(name);
      }
    }

    assert.ok(slackVarNames.length > 0, 'no SLACK_* variables are declared in .env.example');

    for (const name of slackVarNames) {
      assert.ok(
        Object.hasOwn(appEnvironment, name),
        `docker-compose.yml must forward ${name} to the app service environment`
      );
      assert.match(
        String(appEnvironment[name]),
        new RegExp(`\\$\\{${name}(?::-[^}]*)?\\}`),
        `docker-compose.yml must pass the host ${name} through to the app service`
      );
    }
  });
});
