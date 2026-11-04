/**
 * Tests for demo/scripts/setup.sh
 *
 * Validates the setup script's structure, required steps,
 * and configuration consistency with the demo project.
 *
 * @module demo/scripts/setup.test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access, constants } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = __dirname;
const DEMO_DIR = join(__dirname, '..');

/**
 * Read a script file and return its content
 * @param {string} name - Script filename
 * @returns {Promise<string>} File content
 */
async function readScript(name) {
  return readFile(join(SCRIPTS_DIR, name), 'utf-8');
}

describe('setup.sh', () => {
  let content;

  test('exists and is readable', async () => {
    await access(join(SCRIPTS_DIR, 'setup.sh'), constants.R_OK);
  });

  test('is executable', async () => {
    await access(join(SCRIPTS_DIR, 'setup.sh'), constants.X_OK);
  });

  test('has valid bash syntax', () => {
    const result = execSync(`bash -n "${join(SCRIPTS_DIR, 'setup.sh')}" 2>&1`, {
      encoding: 'utf-8',
    });
    // bash -n returns empty on success
    assert.equal(result.trim(), '');
  });

  test('uses bash shebang', async () => {
    content = content || (await readScript('setup.sh'));
    assert.ok(content.startsWith('#!/usr/bin/env bash'), 'Should use #!/usr/bin/env bash shebang');
  });

  test('uses strict mode (set -euo pipefail)', async () => {
    content = content || (await readScript('setup.sh'));
    assert.ok(content.includes('set -euo pipefail'), 'Should enable strict error handling');
  });

  test('checks for Node.js prerequisite', async () => {
    content = content || (await readScript('setup.sh'));
    assert.ok(content.includes('command -v node'), 'Should check for Node.js');
    assert.ok(content.includes('22'), 'Should require Node.js 22+');
  });

  test('checks for Docker prerequisite', async () => {
    content = content || (await readScript('setup.sh'));
    assert.ok(content.includes('command -v docker'), 'Should check for Docker');
  });

  test('starts PostgreSQL 18 container', async () => {
    content = content || (await readScript('setup.sh'));
    assert.ok(content.includes('postgres:18'), 'Should use PostgreSQL 18 image');
    assert.ok(content.includes('docker run'), 'Should create Docker container');
  });

  test('uses correct container name', async () => {
    content = content || (await readScript('setup.sh'));
    assert.ok(
      content.includes('ai-army-demo-postgres'),
      'Should use ai-army-demo-postgres container name'
    );
  });

  test('configures demo database credentials', async () => {
    content = content || (await readScript('setup.sh'));
    assert.ok(content.includes('POSTGRES_DB'), 'Should set database name');
    assert.ok(content.includes('POSTGRES_USER'), 'Should set database user');
    assert.ok(content.includes('POSTGRES_PASSWORD'), 'Should set database password');
    assert.ok(content.includes('ai_army_demo'), 'Should use ai_army_demo database');
  });

  test('waits for PostgreSQL readiness', async () => {
    content = content || (await readScript('setup.sh'));
    assert.ok(content.includes('pg_isready'), 'Should use pg_isready to check readiness');
    assert.ok(content.includes('PG_WAIT_TIMEOUT'), 'Should have a configurable timeout');
  });

  test('installs npm dependencies', async () => {
    content = content || (await readScript('setup.sh'));
    assert.ok(content.includes('npm install'), 'Should run npm install');
  });

  test('runs database migrations', async () => {
    content = content || (await readScript('setup.sh'));
    assert.ok(content.includes('ai-army migrate'), 'Should run ai-army migrate command');
    assert.ok(content.includes('DATABASE_URL'), 'Should pass DATABASE_URL for migrations');
  });

  test('validates configuration', async () => {
    content = content || (await readScript('setup.sh'));
    assert.ok(content.includes('ai-army validate'), 'Should run ai-army validate command');
  });

  test('handles existing container (idempotent)', async () => {
    content = content || (await readScript('setup.sh'));
    assert.ok(content.includes('docker ps -a'), 'Should check for existing containers');
    assert.ok(content.includes('docker start'), 'Should start existing stopped container');
  });

  test('copies .env.example to .env when missing', async () => {
    content = content || (await readScript('setup.sh'));
    assert.ok(content.includes('.env.example'), 'Should reference .env.example');
    assert.ok(content.includes('cp'), 'Should copy .env.example to .env');
  });

  test('adds ai-army-demo label to container', async () => {
    content = content || (await readScript('setup.sh'));
    assert.ok(content.includes('ai-army-demo'), 'Should label container for cleanup discovery');
  });

  test('prints next steps after setup', async () => {
    content = content || (await readScript('setup.sh'));
    assert.ok(content.includes('ANTHROPIC_API_KEY'), 'Should mention API key setup');
    assert.ok(content.includes('npm start'), 'Should mention npm start');
    assert.ok(content.includes('test.sh'), 'Should mention test script');
  });

  test('configures port with DEMO_PG_PORT override', async () => {
    content = content || (await readScript('setup.sh'));
    assert.ok(content.includes('DEMO_PG_PORT'), 'Should allow port override via DEMO_PG_PORT');
    assert.ok(content.includes('5432'), 'Should default to port 5432');
  });
});

describe('setup.sh database URL consistency', () => {
  test('DATABASE_URL in setup.sh matches .env.example', async () => {
    const setupContent = await readScript('setup.sh');
    const envContent = await readFile(join(DEMO_DIR, '.env.example'), 'utf-8');

    // Extract DATABASE_URL from .env.example
    const envMatch = envContent.match(/^DATABASE_URL=(.+)$/m);
    assert.ok(envMatch, '.env.example should contain DATABASE_URL');
    const envUrl = envMatch[1];

    // setup.sh should use the same credentials
    assert.ok(
      envUrl.includes('demo:demo'),
      '.env.example DATABASE_URL should use demo:demo credentials'
    );
    assert.ok(
      envUrl.includes('ai_army_demo'),
      '.env.example DATABASE_URL should use ai_army_demo database'
    );

    // setup.sh variables should match
    assert.ok(setupContent.includes('PG_USER="demo"'), 'setup.sh PG_USER should be demo');
    assert.ok(setupContent.includes('PG_PASSWORD="demo"'), 'setup.sh PG_PASSWORD should be demo');
    assert.ok(
      setupContent.includes('PG_DB="ai_army_demo"'),
      'setup.sh PG_DB should be ai_army_demo'
    );
  });
});

describe('cleanup.sh', () => {
  let content;

  test('exists and is executable', async () => {
    await access(join(SCRIPTS_DIR, 'cleanup.sh'), constants.X_OK);
  });

  test('has valid bash syntax', () => {
    const result = execSync(`bash -n "${join(SCRIPTS_DIR, 'cleanup.sh')}" 2>&1`, {
      encoding: 'utf-8',
    });
    assert.equal(result.trim(), '');
  });

  test('removes demo PostgreSQL container', async () => {
    content = content || (await readScript('cleanup.sh'));
    assert.ok(
      content.includes('ai-army-demo-postgres'),
      'Should reference same container name as setup.sh'
    );
    assert.ok(content.includes('docker rm'), 'Should remove the container');
  });

  test('supports --keep-db flag', async () => {
    content = content || (await readScript('cleanup.sh'));
    assert.ok(content.includes('--keep-db'), 'Should support --keep-db flag to preserve database');
  });

  test('removes demo-labeled containers', async () => {
    content = content || (await readScript('cleanup.sh'));
    assert.ok(content.includes('ai-army-demo'), 'Should clean up demo-labeled containers');
  });

  test('removes node_modules and data', async () => {
    content = content || (await readScript('cleanup.sh'));
    assert.ok(content.includes('node_modules'), 'Should remove node_modules');
    assert.ok(content.includes('data'), 'Should remove runtime data');
  });
});

describe('test.sh', () => {
  test('exists and is executable', async () => {
    await access(join(SCRIPTS_DIR, 'test.sh'), constants.X_OK);
  });

  test('has valid bash syntax', () => {
    const result = execSync(`bash -n "${join(SCRIPTS_DIR, 'test.sh')}" 2>&1`, {
      encoding: 'utf-8',
    });
    assert.equal(result.trim(), '');
  });
});

describe('scripts consistency', () => {
  test('setup and cleanup use same container name', async () => {
    const setup = await readScript('setup.sh');
    const cleanup = await readScript('cleanup.sh');

    const setupMatch = setup.match(/CONTAINER_NAME="([^"]+)"/);
    const cleanupMatch = cleanup.match(/CONTAINER_NAME="([^"]+)"/);

    assert.ok(setupMatch, 'setup.sh should define CONTAINER_NAME');
    assert.ok(cleanupMatch, 'cleanup.sh should define CONTAINER_NAME');
    assert.equal(
      setupMatch[1],
      cleanupMatch[1],
      'Container name should be consistent between setup and cleanup'
    );
  });

  test('all scripts use strict mode', async () => {
    const scripts = ['setup.sh', 'cleanup.sh', 'test.sh'];
    for (const script of scripts) {
      const content = await readScript(script);
      assert.ok(content.includes('set -euo pipefail'), `${script} should use strict mode`);
    }
  });

  test('all scripts resolve DEMO_DIR correctly', async () => {
    const scripts = ['setup.sh', 'cleanup.sh', 'test.sh'];
    for (const script of scripts) {
      const content = await readScript(script);
      assert.ok(content.includes('DEMO_DIR='), `${script} should define DEMO_DIR`);
    }
  });
});
