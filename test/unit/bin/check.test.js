/**
 * Unit tests for bin/check's pre-gate guards
 *
 * bin/check mirrors ci.yml locally, and its contract (.claude/skills/verify-change/SKILL.md
 * exit-code table) is to refuse to grade — exit 75 — when a resource a gate needs is
 * missing, BEFORE running any gate. These tests pin that refusal hermetically: no
 * docker, no database, no network, no npm. Each case copies bin/check into a throwaway
 * tree shaped like a repo root (the script cds to `$(dirname "$0")/..`), toggles the
 * node_modules dirs the guards stat, runs the copy directly (./bin/check, like the
 * pre-commit hook does), and asserts on the child's exit code and output.
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHECK = fileURLToPath(new URL('../../../bin/check', import.meta.url));

/** Throwaway trees this suite created, removed in after(). */
const trees = [];

/**
 * Copy bin/check into a fake repo root. The copy lives at <root>/bin/check so the
 * script's own `cd "$(dirname "$0")/.."` lands on <root>; each case then shapes the
 * node_modules dirs the guards stat by what it creates there.
 * @param {Object} [options] - Which dep trees exist in the fake root.
 * @param {boolean} [options.root] - Root node_modules exists.
 * @param {boolean} [options.demo] - demo/node_modules exists.
 * @returns {string} The fake repo root.
 */
function makeTree({ root = false, demo = false } = {}) {
  const tree = mkdtempSync(join(tmpdir(), 'bin-check-'));
  mkdirSync(join(tree, 'bin'), { recursive: true });
  copyFileSync(CHECK, join(tree, 'bin', 'check'));
  chmodSync(join(tree, 'bin', 'check'), 0o755);
  if (root) {
    mkdirSync(join(tree, 'node_modules'));
  }
  if (demo) {
    mkdirSync(join(tree, 'demo', 'node_modules'), { recursive: true });
  }
  trees.push(tree);
  return tree;
}

/**
 * Run a copied bin/check exactly like the pre-commit hook does (./bin/check, direct
 * exec — the shebang resolves bash and the script cds itself; no shell, no cwd setup).
 * @param {string} tree - The fake repo root whose bin/check to run.
 * @returns {import('node:child_process').SpawnSyncReturns<string>} spawn result.
 */
function runCheck(tree) {
  return spawnSync(join(tree, 'bin', 'check'), { encoding: 'utf8' });
}

describe('bin/check - pre-gate guards', () => {
  after(() => {
    for (const tree of trees) {
      rmSync(tree, { recursive: true, force: true });
    }
  });

  test('demo deps missing, root present → exit 75 naming demo deps, no gate output', () => {
    const result = runCheck(makeTree({ root: true }));
    assert.equal(result.status, 75);
    assert.match(result.stderr, /demo deps missing/);
    assert.match(result.stderr, /bin\/setup/);
    assert.equal(result.stdout, '');
  });

  // Pins the root guard: before it existed this tree passed the demo guard and
  // fell into `npm run lint`, which failed with a non-75 code — an environment
  // problem graded as a red change.
  test('root deps missing, demo present → exit 75 naming root deps, no gate output', () => {
    const result = runCheck(makeTree({ demo: true }));
    assert.equal(result.status, 75);
    assert.match(result.stderr, /root deps missing/);
    assert.match(result.stderr, /npm ci/);
    assert.equal(result.stdout, '');
  });

  test('both dep trees missing → exit 75 naming root deps (root guard fires first)', () => {
    const result = runCheck(makeTree());
    assert.equal(result.status, 75);
    assert.match(result.stderr, /root deps missing/);
    assert.doesNotMatch(result.stderr, /demo deps missing/);
    assert.equal(result.stdout, '');
  });
});
