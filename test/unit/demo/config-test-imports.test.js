/**
 * Guard test for the demo's framework imports.
 *
 * demo/ is a separate user project that consumes ai-army as an installed
 * package. It must never reach back into the parent checkout: a relative
 * import, or a path built from a parent segment, couples the demo to the
 * repository layout and breaks the demo the moment it is used standalone.
 *
 * @module config-test-imports
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const DEMO_TEST_PATH = fileURLToPath(new URL('../../../demo/config.test.js', import.meta.url));
const DEMO_PACKAGE_PATH = fileURLToPath(new URL('../../../demo/package.json', import.meta.url));

/**
 * Symbols demo/config.test.js takes from the framework barrel.
 * @type {string[]}
 */
const REQUIRED_SYMBOLS = ['ConfigValidator', 'MainConfigSchema', 'BotConfigSchema'];

/**
 * Every module specifier the file pulls in, static and dynamic alike.
 * @param {string} source - File contents
 * @returns {string[]} - Module specifiers
 */
function importSpecifiers(source) {
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  return patterns.flatMap(pattern => [...source.matchAll(pattern)].map(match => match[1]));
}

/**
 * Every quoted literal in the file, one line at a time.
 *
 * A parent segment hides in a literal of its own — join(__dirname, '..', 'src') —
 * where a pattern that expects '..' to be glued to a separator never sees it.
 * @param {string} source - File contents
 * @returns {string[]} - Literal contents, without their quotes
 */
function quotedLiterals(source) {
  const patterns = [
    /'([^'\\\n]*(?:\\.[^'\\\n]*)*)'/g,
    /"([^"\\\n]*(?:\\.[^"\\\n]*)*)"/g,
    /`([^`\\\n]*(?:\\.[^`\\\n]*)*)`/g,
  ];

  return patterns.flatMap(pattern => [...source.matchAll(pattern)].map(match => match[1]));
}

/**
 * Whether a path contains a parent-directory segment.
 * @param {string} value - Path or module specifier
 * @returns {boolean} - True when a segment is the parent directory
 */
function hasParentSegment(value) {
  return value.split(/[\\/]/).includes('..');
}

describe('demo/config.test.js framework imports', () => {
  let source;

  before(async () => {
    source = await readFile(DEMO_TEST_PATH, 'utf-8');
  });

  test('imports the framework from the bare "ai-army" specifier', () => {
    assert.match(
      source,
      /\bfrom\s*['"]ai-army['"]/,
      "demo/config.test.js must import the framework from 'ai-army'"
    );
  });

  test('imports ConfigValidator, MainConfigSchema and BotConfigSchema from "ai-army"', () => {
    const match = source.match(/import\s*\{([^}]*)\}\s*from\s*['"]ai-army['"]/);
    assert.ok(match, "demo/config.test.js must import the framework symbols from 'ai-army'");

    const imported = match[1]
      .split(',')
      .map(name => name.trim())
      .filter(Boolean);

    for (const symbol of REQUIRED_SYMBOLS) {
      assert.ok(
        imported.includes(symbol),
        `demo/config.test.js must import ${symbol} from 'ai-army'`
      );
    }
  });

  test('imports nothing from the parent checkout', () => {
    for (const specifier of importSpecifiers(source)) {
      assert.ok(
        !specifier.startsWith('..'),
        `demo/config.test.js must not import '${specifier}' from the parent tree`
      );
      assert.ok(
        !hasParentSegment(specifier),
        `demo/config.test.js must not import '${specifier}' through a parent segment`
      );
    }
  });

  test('contains no parent-directory path segment', () => {
    for (const literal of quotedLiterals(source)) {
      assert.ok(
        !hasParentSegment(literal),
        `demo/config.test.js must not build a path through a parent segment: '${literal}'`
      );
    }
  });

  test('flags a parent segment reached through a path literal', () => {
    const reachBack = "join(__dirname, '..', 'src', 'execution', 'incus-backend.js')";
    const flagged = quotedLiterals(reachBack).filter(literal => hasParentSegment(literal));

    assert.ok(
      flagged.includes('..'),
      "the guard must flag a bare '..' literal, whatever it is joined with"
    );
  });
});

describe('demo/package.json framework dependency', () => {
  let manifest;

  before(async () => {
    manifest = JSON.parse(await readFile(DEMO_PACKAGE_PATH, 'utf-8'));
  });

  test('declares the framework as a dependency', () => {
    const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };

    assert.ok(dependencies['ai-army'], "demo/package.json must declare 'ai-army' as a dependency");
  });
});
