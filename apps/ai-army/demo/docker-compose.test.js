/**
 * Tests for demo/docker-compose.yml
 *
 * Validates the Docker Compose configuration for the demo project.
 * Checks PostgreSQL 18, ai-army service, volumes, healthcheck, and labels.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMPOSE_PATH = join(__dirname, 'docker-compose.yml');

describe('demo/docker-compose.yml', () => {
  let raw;

  before(async () => {
    raw = await readFile(COMPOSE_PATH, 'utf-8');
  });

  test('file exists and is non-empty', () => {
    assert.ok(raw.length > 0, 'docker-compose.yml should have content');
  });

  test('uses compose version 3.8', () => {
    assert.ok(raw.includes("version: '3.8'") || raw.includes('version: "3.8"'),
      'Should declare version 3.8');
  });

  test('defines services section', () => {
    assert.ok(/^services:/m.test(raw), 'Should have top-level services section');
  });

  test('defines volumes section', () => {
    assert.ok(/^volumes:/m.test(raw), 'Should have top-level volumes section');
  });
});

describe('PostgreSQL service', () => {
  let raw;

  before(async () => {
    raw = await readFile(COMPOSE_PATH, 'utf-8');
  });

  test('uses postgres:18-alpine image', () => {
    assert.ok(raw.includes('postgres:18-alpine'), 'Should use postgres:18-alpine image');
  });

  test('sets POSTGRES_DB to ai_army_demo', () => {
    assert.ok(raw.includes('POSTGRES_DB: ai_army_demo'), 'Should set POSTGRES_DB to ai_army_demo');
  });

  test('sets POSTGRES_USER to demo', () => {
    assert.ok(raw.includes('POSTGRES_USER: demo'), 'Should set POSTGRES_USER to demo');
  });

  test('sets POSTGRES_PASSWORD to demo', () => {
    assert.ok(raw.includes('POSTGRES_PASSWORD: demo'), 'Should set POSTGRES_PASSWORD to demo');
  });

  test('exposes port 5432', () => {
    assert.ok(
      raw.includes('5432') && raw.includes('DEMO_PG_PORT'),
      'Should expose port 5432 (with configurable host port)'
    );
  });

  test('supports configurable port via DEMO_PG_PORT', () => {
    assert.ok(
      raw.includes('DEMO_PG_PORT:-5432'),
      'Should support DEMO_PG_PORT env var with default 5432'
    );
  });

  test('has healthcheck with pg_isready', () => {
    assert.ok(
      raw.includes('pg_isready -U demo'),
      'Healthcheck should use pg_isready with demo user'
    );
  });

  test('healthcheck has interval', () => {
    assert.ok(raw.includes('interval: 10s'), 'Healthcheck should have 10s interval');
  });

  test('healthcheck has timeout', () => {
    assert.ok(raw.includes('timeout: 5s'), 'Healthcheck should have 5s timeout');
  });

  test('healthcheck has retries', () => {
    assert.ok(raw.includes('retries: 5'), 'Healthcheck should have 5 retries');
  });

  test('has restart policy', () => {
    assert.ok(raw.includes('restart: unless-stopped'), 'Should have unless-stopped restart policy');
  });

  test('uses named volume for data persistence', () => {
    assert.ok(
      raw.includes('postgres-data:/var/lib/postgresql/data'),
      'Should mount postgres-data volume'
    );
  });

  test('has ai-army-demo label', () => {
    assert.ok(raw.includes('ai-army-demo'), 'Should have ai-army-demo label for cleanup');
  });

  test('uses container_name matching setup.sh', () => {
    assert.ok(
      raw.includes('container_name: ai-army-demo-postgres'),
      'Container name should match setup.sh CONTAINER_NAME'
    );
  });
});

describe('ai-army service', () => {
  let raw;

  before(async () => {
    raw = await readFile(COMPOSE_PATH, 'utf-8');
  });

  test('defines ai-army service', () => {
    assert.ok(raw.includes('ai-army:'), 'Should define ai-army service');
  });

  test('depends on postgres with service_healthy condition', () => {
    assert.ok(raw.includes('condition: service_healthy'), 'Should depend on postgres health');
  });

  test('sets DATABASE_URL pointing to postgres service', () => {
    assert.ok(
      raw.includes('postgresql://demo:demo@postgres:5432/ai_army_demo'),
      'DATABASE_URL should use compose service name "postgres"'
    );
  });

  test('passes ANTHROPIC_API_KEY from env', () => {
    assert.ok(
      raw.includes('ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}'),
      'Should pass through ANTHROPIC_API_KEY'
    );
  });

  test('exposes API port 3000', () => {
    assert.ok(
      raw.includes('3000') && raw.includes('DEMO_API_PORT'),
      'Should expose API port 3000 (with configurable host port)'
    );
  });

  test('supports configurable API port via DEMO_API_PORT', () => {
    assert.ok(
      raw.includes('DEMO_API_PORT:-3000'),
      'Should support DEMO_API_PORT env var with default 3000'
    );
  });

  test('mounts Docker socket for container management', () => {
    assert.ok(
      raw.includes('/var/run/docker.sock:/var/run/docker.sock'),
      'Should mount Docker socket for bot container management'
    );
  });

  test('mounts data directory for persistence', () => {
    assert.ok(
      raw.includes('./data:/app/demo/data'),
      'Should mount data directory for bot workspaces'
    );
  });

  test('mounts bots directory as read-only', () => {
    assert.ok(raw.includes('./bots:/app/demo/bots:ro'), 'Should mount bots directory as read-only');
  });

  test('has restart policy', () => {
    // Count occurrences - should be present for ai-army service
    const matches = raw.match(/restart: unless-stopped/g);
    assert.ok(matches && matches.length >= 2, 'Both services should have restart policy');
  });

  test('has ai-army-demo label', () => {
    // Label should appear on both services
    const matches = raw.match(/ai-army-demo/g);
    assert.ok(
      matches && matches.length >= 3,
      'ai-army-demo label should appear on services and volumes'
    );
  });

  test('has build context pointing to parent directory', () => {
    assert.ok(raw.includes('context: ..'), 'Build context should point to framework root');
  });
});

describe('Volumes', () => {
  let raw;

  before(async () => {
    raw = await readFile(COMPOSE_PATH, 'utf-8');
  });

  test('declares postgres-data named volume', () => {
    assert.ok(raw.includes('postgres-data:'), 'Should declare postgres-data volume');
  });

  test('volume has ai-army-demo label for cleanup', () => {
    // The volume section should have the label
    const volumeSection = raw.split(/^volumes:/m)[1];
    assert.ok(volumeSection, 'Should have volumes section');
    assert.ok(
      volumeSection.includes('ai-army-demo'),
      'Volume should have ai-army-demo label for cleanup script'
    );
  });
});

describe('Consistency with demo scripts', () => {
  let composeRaw;
  let setupRaw;
  let cleanupRaw;

  before(async () => {
    composeRaw = await readFile(COMPOSE_PATH, 'utf-8');
    setupRaw = await readFile(join(__dirname, 'scripts', 'setup.sh'), 'utf-8');
    cleanupRaw = await readFile(join(__dirname, 'scripts', 'cleanup.sh'), 'utf-8');
  });

  test('uses same PostgreSQL image as setup.sh', () => {
    assert.ok(setupRaw.includes('postgres:18-alpine'), 'setup.sh should use postgres:18-alpine');
    assert.ok(
      composeRaw.includes('postgres:18-alpine'),
      'docker-compose.yml should use postgres:18-alpine'
    );
  });

  test('uses same database credentials as setup.sh', () => {
    // Both should use demo/demo credentials
    assert.ok(composeRaw.includes('POSTGRES_USER: demo'));
    assert.ok(composeRaw.includes('POSTGRES_PASSWORD: demo'));
    assert.ok(composeRaw.includes('POSTGRES_DB: ai_army_demo'));
    assert.ok(setupRaw.includes('PG_USER="demo"'));
    assert.ok(setupRaw.includes('PG_PASSWORD="demo"'));
    assert.ok(setupRaw.includes('PG_DB="ai_army_demo"'));
  });

  test('uses same container name as setup.sh', () => {
    assert.ok(
      composeRaw.includes('ai-army-demo-postgres'),
      'Compose should use ai-army-demo-postgres container name'
    );
    assert.ok(
      setupRaw.includes('ai-army-demo-postgres'),
      'setup.sh should use ai-army-demo-postgres container name'
    );
  });

  test('cleanup.sh handles docker-compose.yml', () => {
    assert.ok(
      cleanupRaw.includes('docker-compose.yml'),
      'cleanup.sh should check for docker-compose.yml'
    );
  });

  test('cleanup.sh uses compose down with volumes', () => {
    assert.ok(
      cleanupRaw.includes('down --volumes'),
      'cleanup.sh should use down --volumes for compose cleanup'
    );
  });

  test('uses same label as cleanup.sh filter', () => {
    assert.ok(composeRaw.includes('ai-army-demo'), 'Compose should use ai-army-demo label');
    assert.ok(
      cleanupRaw.includes('label=ai-army-demo'),
      'cleanup.sh should filter by ai-army-demo label'
    );
  });
});

describe('Consistency with .env.example', () => {
  let composeRaw;
  let envExample;

  before(async () => {
    composeRaw = await readFile(COMPOSE_PATH, 'utf-8');
    envExample = await readFile(join(__dirname, '.env.example'), 'utf-8');
  });

  test('.env.example includes ANTHROPIC_API_KEY', () => {
    assert.ok(
      envExample.includes('ANTHROPIC_API_KEY'),
      '.env.example should define ANTHROPIC_API_KEY'
    );
  });

  test('.env.example includes DATABASE_URL with matching credentials', () => {
    assert.ok(
      envExample.includes('postgresql://demo:demo@localhost:5432/ai_army_demo'),
      '.env.example DATABASE_URL should match compose credentials'
    );
  });

  test('compose uses same ANTHROPIC_API_KEY env var as .env.example', () => {
    assert.ok(
      composeRaw.includes('ANTHROPIC_API_KEY'),
      'docker-compose.yml should reference ANTHROPIC_API_KEY'
    );
  });
});

describe('YAML structure validity', () => {
  let raw;

  before(async () => {
    raw = await readFile(COMPOSE_PATH, 'utf-8');
  });

  test('does not contain tabs (YAML requires spaces)', () => {
    const tabLines = raw
      .split('\n')
      .map((line, i) => ({ line, num: i + 1 }))
      .filter(({ line }) => line.includes('\t'));
    assert.equal(tabLines.length, 0, `Found tabs on lines: ${tabLines.map(l => l.num).join(', ')}`);
  });

  test('uses consistent 2-space indentation', () => {
    const lines = raw.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
    for (const line of lines) {
      const leadingSpaces = line.match(/^(\s*)/)[1].length;
      if (leadingSpaces > 0) {
        assert.equal(
          leadingSpaces % 2,
          0,
          `Line "${line.trim()}" has ${leadingSpaces} spaces (not multiple of 2)`
        );
      }
    }
  });

  test('has no trailing whitespace', () => {
    const trailingLines = raw
      .split('\n')
      .map((line, i) => ({ line, num: i + 1 }))
      .filter(({ line }) => /\S\s+$/.test(line));
    assert.equal(
      trailingLines.length,
      0,
      `Found trailing whitespace on lines: ${trailingLines.map(l => l.num).join(', ')}`
    );
  });

  test('ends with newline', () => {
    assert.ok(raw.endsWith('\n'), 'File should end with a newline');
  });
});
