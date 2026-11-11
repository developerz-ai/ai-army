/**
 * Unit tests for the published package contents.
 *
 * The npm tarball is the framework's public surface: a consumer installs it and
 * runs `ai-army` from it. This suite pins WHAT ships, so a checkout-only tree
 * (scripts/, bots/, mcp-servers/, docs/, demo/, test/) can never leak into a
 * release, and so the files the framework reads at runtime can never be dropped
 * by accident.
 *
 * The list comes from `npm pack --dry-run --json` run in the repository root —
 * the same command npm runs at publish time — so it exercises the real "files"
 * allowlist and the nested .npmignore rules instead of re-implementing them.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root, resolved from this file's URL so the suite works from any cwd. */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The allowlist package.json must declare (npm always adds package.json itself). */
const EXPECTED_FILES = ['bin/cli.js', 'src/', 'migrations/', 'templates/', 'README.md', 'LICENSE'];

/** Checkout-only trees that must never reach the tarball. */
const FORBIDDEN_PREFIXES = [
  '.idea/',
  'bots/',
  'demo/',
  'docs/',
  'mcp-servers/',
  'scripts/',
  'test/',
];

/** Files an installed package needs at runtime. */
const REQUIRED_PATHS = [
  'LICENSE',
  'README.md',
  'bin/cli.js',
  'migrations/001_initial_schema.sql',
  'src/index.js',
  'templates/workers/backend-developer.yml',
];

/** npm ships these whatever "files" says. */
const ALWAYS_INCLUDED = ['LICENSE', 'README.md', 'package.json'];

const packageJson = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));

/** Paths npm would put in the tarball. */
let packedPaths = [];

/**
 * Whether a packed path is covered by the allowlist (or by npm's always-included set).
 * @param {string} packedPath - Path inside the tarball.
 * @returns {boolean} True when the path is allowed to ship.
 */
function isCovered(packedPath) {
  const allowlist = packageJson.files ?? [];
  if (ALWAYS_INCLUDED.includes(packedPath)) return true;
  if (allowlist.includes(packedPath)) return true;
  const inDir = allowlist.some(entry => entry.endsWith('/') && packedPath.startsWith(entry));
  if (inDir) return true;
  if (packageJson.main && packedPath === packageJson.main) return true;
  const bins = Object.values(packageJson.bin || {}).map(bin => bin.replace(/^\.\//, ''));
  return bins.includes(packedPath);
}

before(() => {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['pack', '--dry-run', '--json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 10 * 1024 * 1024,
  });
  assert.strictEqual(
    result.status,
    0,
    `npm pack --dry-run failed (${result.error?.message || result.stderr})`
  );
  const [report] = JSON.parse(result.stdout);
  packedPaths = report.files.map(file => file.path);
});

describe('published package contents', () => {
  test('package.json declares the "files" allowlist', () => {
    assert.ok(Array.isArray(packageJson.files), 'package.json must declare a "files" allowlist');
    assert.deepStrictEqual([...packageJson.files].sort(), [...EXPECTED_FILES].sort());
  });

  test('no checkout-only tree ships', () => {
    const leaked = packedPaths.filter(packedPath =>
      FORBIDDEN_PREFIXES.some(prefix => packedPath.startsWith(prefix))
    );
    assert.deepStrictEqual(
      leaked,
      [],
      `checkout-only paths leaked into the tarball: ${leaked.join(', ')}`
    );
  });

  test('every packed path is covered by the allowlist', () => {
    const uncovered = packedPaths.filter(packedPath => !isCovered(packedPath));
    assert.deepStrictEqual(
      uncovered,
      [],
      `packed paths outside the allowlist: ${uncovered.join(', ')}`
    );
  });

  test('runtime files ship', () => {
    const missing = REQUIRED_PATHS.filter(requiredPath => !packedPaths.includes(requiredPath));
    assert.deepStrictEqual(
      missing,
      [],
      `runtime files missing from the tarball: ${missing.join(', ')}`
    );
  });

  test('no test file ships', () => {
    const shipped = packedPaths.filter(packedPath => packedPath.endsWith('.test.js'));
    assert.deepStrictEqual(
      shipped,
      [],
      `test files shipped inside the tarball: ${shipped.join(', ')}`
    );
  });
});
