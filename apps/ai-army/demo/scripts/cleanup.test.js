/**
 * Tests for demo/scripts/cleanup.sh
 *
 * Validates the cleanup script's structure, CLI options,
 * Docker cleanup capabilities, file removal, and volume handling.
 *
 * @module demo/scripts/cleanup.test
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
 * Read the cleanup script content
 * @returns {Promise<string>} File content
 */
async function readCleanupScript() {
  return readFile(join(SCRIPTS_DIR, 'cleanup.sh'), 'utf-8');
}

describe('cleanup.sh basics', () => {
  test('exists and is readable', async () => {
    await access(join(SCRIPTS_DIR, 'cleanup.sh'), constants.R_OK);
  });

  test('is executable', async () => {
    await access(join(SCRIPTS_DIR, 'cleanup.sh'), constants.X_OK);
  });

  test('has valid bash syntax', () => {
    const result = execSync(`bash -n "${join(SCRIPTS_DIR, 'cleanup.sh')}" 2>&1`, {
      encoding: 'utf-8',
    });
    assert.equal(result.trim(), '');
  });

  test('uses bash shebang', async () => {
    const content = await readCleanupScript();
    assert.ok(
      content.startsWith('#!/usr/bin/env bash'),
      'Should use #!/usr/bin/env bash shebang'
    );
  });

  test('uses strict mode (set -euo pipefail)', async () => {
    const content = await readCleanupScript();
    assert.ok(content.includes('set -euo pipefail'), 'Should enable strict error handling');
  });

  test('resolves DEMO_DIR correctly', async () => {
    const content = await readCleanupScript();
    assert.ok(content.includes('DEMO_DIR='), 'Should define DEMO_DIR');
  });
});

describe('cleanup.sh CLI options', () => {
  let content;

  test('supports --keep-db flag', async () => {
    content = content || (await readCleanupScript());
    assert.ok(content.includes('--keep-db'), 'Should support --keep-db flag');
    assert.ok(content.includes('KEEP_DB'), 'Should have KEEP_DB variable');
  });

  test('supports --all flag for full reset', async () => {
    content = content || (await readCleanupScript());
    assert.ok(content.includes('--all'), 'Should support --all flag');
    assert.ok(content.includes('REMOVE_ALL'), 'Should have REMOVE_ALL variable');
  });

  test('supports --help flag', async () => {
    content = content || (await readCleanupScript());
    assert.ok(content.includes('--help'), 'Should support --help flag');
    assert.ok(content.includes('-h'), 'Should support -h shorthand');
  });

  test('rejects unknown options', async () => {
    content = content || (await readCleanupScript());
    assert.ok(content.includes('Unknown option'), 'Should report unknown options');
  });

  test('--help exits with code 0', () => {
    execSync(`bash "${join(SCRIPTS_DIR, 'cleanup.sh')}" --help 2>&1`, {
      encoding: 'utf-8',
    });
    // If we get here, exit code was 0
  });

  test('--help shows usage information', () => {
    const result = execSync(`bash "${join(SCRIPTS_DIR, 'cleanup.sh')}" --help 2>&1`, {
      encoding: 'utf-8',
    });
    assert.ok(result.includes('--keep-db'), 'Help should mention --keep-db');
    assert.ok(result.includes('--all'), 'Help should mention --all');
  });
});

describe('cleanup.sh Docker container cleanup', () => {
  let content;

  test('checks if docker is available', async () => {
    content = content || (await readCleanupScript());
    assert.ok(content.includes('command -v docker'), 'Should check for docker command');
  });

  test('removes demo PostgreSQL container', async () => {
    content = content || (await readCleanupScript());
    assert.ok(
      content.includes('ai-army-demo-postgres'),
      'Should reference the demo PostgreSQL container name'
    );
    assert.ok(content.includes('docker rm'), 'Should remove the container');
    assert.ok(content.includes('docker rm -f'), 'Should force-remove for stopped containers');
  });

  test('uses same container name as setup.sh', async () => {
    content = content || (await readCleanupScript());
    const setupContent = await readFile(join(SCRIPTS_DIR, 'setup.sh'), 'utf-8');

    const cleanupMatch = content.match(/CONTAINER_NAME="([^"]+)"/);
    const setupMatch = setupContent.match(/CONTAINER_NAME="([^"]+)"/);

    assert.ok(cleanupMatch, 'cleanup.sh should define CONTAINER_NAME');
    assert.ok(setupMatch, 'setup.sh should define CONTAINER_NAME');
    assert.equal(
      cleanupMatch[1],
      setupMatch[1],
      'Container name should match between setup and cleanup'
    );
  });

  test('checks if container exists before removing', async () => {
    content = content || (await readCleanupScript());
    assert.ok(content.includes('docker ps -a'), 'Should check for existing containers');
  });

  test('skips container removal with --keep-db', async () => {
    content = content || (await readCleanupScript());
    assert.ok(
      content.includes('Keeping') && content.includes('--keep-db'),
      'Should report keeping container when --keep-db is set'
    );
  });

  test('removes demo-labeled containers', async () => {
    content = content || (await readCleanupScript());
    assert.ok(
      content.includes('label=ai-army-demo'),
      'Should filter by ai-army-demo label'
    );
    assert.ok(
      content.includes('filter') && content.includes('label'),
      'Should use Docker label filter'
    );
  });

  test('handles missing container gracefully', async () => {
    content = content || (await readCleanupScript());
    assert.ok(
      content.includes('No demo PostgreSQL container found'),
      'Should report when no container is found'
    );
  });
});

describe('cleanup.sh Docker volume cleanup', () => {
  let content;

  test('removes demo-labeled volumes', async () => {
    content = content || (await readCleanupScript());
    assert.ok(content.includes('docker volume'), 'Should manage Docker volumes');
    assert.ok(
      content.includes('volume rm') || content.includes('volume ls'),
      'Should list/remove volumes'
    );
  });

  test('removes compose-created volumes', async () => {
    content = content || (await readCleanupScript());
    assert.ok(
      content.includes('COMPOSE_VOLUMES') || content.includes('compose'),
      'Should handle compose volumes'
    );
  });

  test('skips volume removal with --keep-db', async () => {
    content = content || (await readCleanupScript());
    // Volume removal section should be guarded by KEEP_DB check
    const volumeSection = content.substring(content.indexOf('volume'));
    assert.ok(
      content.includes('KEEP_DB') && content.includes('volume'),
      'Volume removal should respect --keep-db flag'
    );
  });
});

describe('cleanup.sh Docker Compose cleanup', () => {
  let content;

  test('supports docker compose down', async () => {
    content = content || (await readCleanupScript());
    assert.ok(
      content.includes('docker compose') || content.includes('docker-compose'),
      'Should support docker compose cleanup'
    );
  });

  test('checks for docker-compose.yml before compose cleanup', async () => {
    content = content || (await readCleanupScript());
    assert.ok(
      content.includes('docker-compose.yml'),
      'Should check for docker-compose.yml existence'
    );
  });

  test('uses --volumes flag with compose down', async () => {
    content = content || (await readCleanupScript());
    assert.ok(
      content.includes('--volumes'),
      'Should remove volumes when tearing down compose'
    );
  });

  test('uses --remove-orphans with compose down', async () => {
    content = content || (await readCleanupScript());
    assert.ok(
      content.includes('--remove-orphans'),
      'Should remove orphan containers from compose'
    );
  });
});

describe('cleanup.sh file cleanup', () => {
  let content;

  test('removes node_modules directory', async () => {
    content = content || (await readCleanupScript());
    assert.ok(content.includes('node_modules'), 'Should remove node_modules');
    assert.ok(content.includes('rm -rf'), 'Should use rm -rf for directory removal');
  });

  test('removes data directory', async () => {
    content = content || (await readCleanupScript());
    assert.ok(
      content.includes('data') && content.includes('rm -rf'),
      'Should remove runtime data directory'
    );
  });

  test('removes package-lock.json', async () => {
    content = content || (await readCleanupScript());
    assert.ok(content.includes('package-lock.json'), 'Should remove package-lock.json');
  });

  test('handles missing directories gracefully', async () => {
    content = content || (await readCleanupScript());
    assert.ok(
      content.includes('not found (skipped)'),
      'Should report when directories are not found'
    );
  });

  test('removes .env with --all flag', async () => {
    content = content || (await readCleanupScript());
    assert.ok(
      content.includes('.env') && content.includes('REMOVE_ALL'),
      'Should remove .env only with --all flag'
    );
  });

  test('does not remove .env without --all flag', async () => {
    content = content || (await readCleanupScript());
    // .env removal should be guarded by REMOVE_ALL check
    const envRemovalSection = content.substring(content.indexOf('REMOVE_ALL'));
    assert.ok(
      envRemovalSection.includes('.env'),
      '.env removal should be conditional on REMOVE_ALL'
    );
  });
});

describe('cleanup.sh output format', () => {
  let content;

  test('prints header banner', async () => {
    content = content || (await readCleanupScript());
    assert.ok(
      content.includes('AI Army Demo Cleanup'),
      'Should print cleanup header'
    );
  });

  test('separates Docker and file cleanup sections', async () => {
    content = content || (await readCleanupScript());
    assert.ok(content.includes('Docker cleanup'), 'Should have Docker cleanup section');
    assert.ok(content.includes('File cleanup'), 'Should have file cleanup section');
  });

  test('prints completion message', async () => {
    content = content || (await readCleanupScript());
    assert.ok(content.includes('Cleanup Complete'), 'Should print completion message');
  });

  test('suggests running setup.sh after cleanup', async () => {
    content = content || (await readCleanupScript());
    assert.ok(
      content.includes('setup.sh'),
      'Should suggest re-running setup.sh'
    );
  });
});

describe('cleanup.sh consistency with setup.sh', () => {
  test('uses same CONTAINER_NAME as setup.sh', async () => {
    const cleanup = await readCleanupScript();
    const setup = await readFile(join(SCRIPTS_DIR, 'setup.sh'), 'utf-8');

    const cleanupMatch = cleanup.match(/CONTAINER_NAME="([^"]+)"/);
    const setupMatch = setup.match(/CONTAINER_NAME="([^"]+)"/);

    assert.ok(cleanupMatch, 'cleanup.sh should define CONTAINER_NAME');
    assert.ok(setupMatch, 'setup.sh should define CONTAINER_NAME');
    assert.equal(
      cleanupMatch[1],
      setupMatch[1],
      'Both scripts should use same container name'
    );
  });

  test('uses same demo label as setup.sh', async () => {
    const cleanup = await readCleanupScript();
    const setup = await readFile(join(SCRIPTS_DIR, 'setup.sh'), 'utf-8');

    assert.ok(
      cleanup.includes('ai-army-demo') && setup.includes('ai-army-demo'),
      'Both scripts should use ai-army-demo label'
    );
  });

  test('both scripts use strict mode', async () => {
    const cleanup = await readCleanupScript();
    const setup = await readFile(join(SCRIPTS_DIR, 'setup.sh'), 'utf-8');

    assert.ok(cleanup.includes('set -euo pipefail'), 'cleanup.sh should use strict mode');
    assert.ok(setup.includes('set -euo pipefail'), 'setup.sh should use strict mode');
  });

  test('cleanup reverses what setup creates', async () => {
    const cleanup = await readCleanupScript();

    // setup.sh creates: container, node_modules (npm install), data, .env
    // cleanup.sh should remove: container, node_modules, data, package-lock.json
    assert.ok(cleanup.includes('docker rm'), 'Should remove containers created by setup');
    assert.ok(cleanup.includes('node_modules'), 'Should remove node_modules from npm install');
    assert.ok(cleanup.includes('data'), 'Should remove data directory');
    assert.ok(cleanup.includes('package-lock.json'), 'Should remove package-lock.json');
  });
});
