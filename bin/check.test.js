/**
 * Unit tests for bin/check
 *
 * Pins the two refusal paths of the gate. bin/check must end with exit 75 when
 * a resource it NEEDS is unreachable — a missing dependency tree, or a test
 * database that does not answer — and never with exit 1, which the platform
 * reads as "the change is red" (.claude/skills/verify-change/SKILL.md).
 *
 * Secrets: the gate's output must never carry a credential — the test database
 * URL holds the password, and gate output ends up in captured logs. Both
 * refusal paths therefore run against a fixture URL with a distinctive
 * password, and assert that neither stdout nor stderr repeats it
 * (.claude/skills/verify-change/SKILL.md).
 *
 * Safety: when both preconditions pass, bin/check runs `npm test`, and the
 * suite would re-enter this file. Every case below therefore runs a COPY of
 * bin/check inside a temporary directory — never the repository's own
 * bin/check, and never against the reachable ai_army_test database.
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHECK_SOURCE = fileURLToPath(new URL('./check', import.meta.url));
const REPO_NODE_MODULES = path.join(REPO_ROOT, 'node_modules');

/**
 * Password carried by the fixture database URL.
 *
 * It is deliberately distinctive: the refusal paths must never echo the
 * database URL, and a one-character password could turn up in unrelated output
 * by accident. A leak of this exact string on either stream fails the test.
 */
const FIXTURE_PASSWORD = 'fixture-password-must-not-leak';

/** Temporary directories created by this suite, removed when it ends. */
const tempDirs = [];

after(async () => {
  for (const dir of tempDirs) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  tempDirs.length = 0;
});

/**
 * Create a temporary directory outside the repository.
 *
 * It must sit outside the checkout: npm resolves the nearest package.json by
 * walking up from the working directory, so a fixture inside the repository
 * could fall back to the repository's own scripts.
 *
 * @param {string} prefix - Directory name prefix
 * @returns {Promise<string>} Absolute path to the temporary directory
 */
async function createTempDir(prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/**
 * Copy bin/check into a fixture directory.
 *
 * The copy keeps the script's own `cd "$(dirname "$0")/.."` behaviour, so the
 * script runs against the fixture and never against the repository.
 *
 * @param {string} dir - Fixture directory
 * @returns {Promise<string>} Path to the copied script
 */
async function installCheckScript(dir) {
  const binDir = path.join(dir, 'bin');
  await fs.mkdir(binDir, { recursive: true });
  const target = path.join(binDir, 'check');
  await fs.copyFile(CHECK_SOURCE, target);
  await fs.chmod(target, 0o755);
  return target;
}

/**
 * Run a script and capture its exit code and output.
 *
 * @param {string} scriptPath - Absolute path to the script
 * @param {Object} env - Environment overrides
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>} The result
 */
async function runScript(scriptPath, env) {
  try {
    const { stdout, stderr } = await execFileAsync('bash', [scriptPath], {
      cwd: path.dirname(path.dirname(scriptPath)),
      env: { ...process.env, ...env },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

/**
 * Reserve a TCP port and release it again, so nothing listens on it.
 *
 * @returns {Promise<number>} A port that refuses connections
 */
function findClosedPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * Build a fixture database URL that nothing answers on.
 *
 * The URL carries the distinctive fixture password, so a gate that echoes it
 * leaks a credential the assertions below can recognise.
 *
 * @param {number} port - A closed TCP port
 * @returns {string} The fixture database URL
 */
function unreachableDatabaseUrl(port) {
  return `postgresql://ai_army:${FIXTURE_PASSWORD}@127.0.0.1:${port}/ai_army_test`;
}

/**
 * Assert that neither output stream carries the fixture credential.
 *
 * The gate names the resource it needs and the remedy, never the URL: the URL
 * holds the password, and gate output ends up in captured logs
 * (.claude/skills/verify-change/SKILL.md).
 *
 * @param {{ stdout: string, stderr: string }} result - The captured result
 */
function assertNoCredential(result) {
  for (const [stream, text] of [
    ['stdout', result.stdout],
    ['stderr', result.stderr],
  ]) {
    assert.ok(
      !text.includes(FIXTURE_PASSWORD),
      `the gate must not print the database password on ${stream}`
    );
    assert.ok(
      !text.includes('postgresql://'),
      `the gate must not print the database URL on ${stream}`
    );
  }
}

describe('bin/check refusal paths', () => {
  test('exits 75 when node_modules is missing', async () => {
    const dir = await createTempDir('bin-check-no-modules-');
    const script = await installCheckScript(dir);
    const port = await findClosedPort();

    const result = await runScript(script, {
      TEST_DATABASE_URL: unreachableDatabaseUrl(port),
    });

    assert.equal(result.code, 75, 'a missing dependency tree must exit 75, never 1');
    assert.match(result.stderr, /node_modules is missing/);
    assert.doesNotMatch(
      result.stderr,
      /Missing script/,
      'the gate must stop at the precondition instead of running npm'
    );
    assertNoCredential(result);
  });

  test('exits 75 when the test database is unusable', async () => {
    const dir = await createTempDir('bin-check-no-db-');
    // The gate has to get past its first precondition to reach the database
    // one, so the fixture needs a dependency tree — the repository's is linked
    // in, read-only.
    await fs.symlink(REPO_NODE_MODULES, path.join(dir, 'node_modules'), 'dir');
    // A package.json without scripts keeps npm inside the fixture: if the gate
    // ever got as far as `npm run lint`, it would fail with "Missing script"
    // instead of falling back to the repository's own scripts.
    await fs.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'bin-check-fixture', version: '0.0.0', private: true })
    );
    const script = await installCheckScript(dir);
    const port = await findClosedPort();

    const result = await runScript(script, {
      TEST_DATABASE_URL: unreachableDatabaseUrl(port),
    });

    assert.equal(result.code, 75, 'an unusable test database must exit 75, never 1');
    // The refusal names the resource and the remedy. The generic wording —
    // "the test database is not usable" — is the safe one; a diagnostic that
    // still names the URL in between is accepted here as well, and
    // assertNoCredential below is what keeps the URL out of the output.
    assert.match(result.stderr, /test database(?: .*)? is not usable/);
    assert.match(result.stderr, /run bin\/setup/, 'the refusal must name the remedy');
    assert.doesNotMatch(
      result.stderr,
      /node_modules is missing/,
      'the database precondition, not the dependency one, must refuse'
    );
    assert.doesNotMatch(
      result.stderr,
      /Missing script/,
      'the gate must stop at the precondition instead of running npm'
    );
    assertNoCredential(result);
  });
});
