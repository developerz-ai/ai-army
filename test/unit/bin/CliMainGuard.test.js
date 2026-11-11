/**
 * Unit tests for bin/cli.js's "run only when executed directly" guard.
 *
 * npm installs the CLI as a symlink (node_modules/.bin/ai-army -> bin/cli.js), so the
 * guard must compare real paths, not match a path suffix.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../../../bin/cli.js', import.meta.url));
const { version } = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8')
);

describe('bin/cli.js main-module guard', () => {
  let tmp;
  let link;

  before(() => {
    tmp = mkdtempSync(join(tmpdir(), 'ai-army-cli-'));
    mkdirSync(join(tmp, '.bin'));
    link = join(tmp, '.bin', 'ai-army');
    symlinkSync(CLI, link);
  });

  after(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test('runs when launched directly', () => {
    const result = spawnSync(process.execPath, [CLI, '--version'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes(version), result.stdout);
  });

  test('runs when launched through a symlink', () => {
    const result = spawnSync(process.execPath, [link, '--version'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes(version), result.stdout);
  });

  test('does not run the program when imported as a module', () => {
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', `await import(${JSON.stringify(`file://${CLI}`)});`],
      { encoding: 'utf8' }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
  });
});
