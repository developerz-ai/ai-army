/**
 * Unit tests for the root docker-compose.yml contract.
 *
 * postgres:18 images keep PGDATA at /var/lib/postgresql/18/docker and refuse
 * to start when a volume is mounted at the pre-18 path /var/lib/postgresql/data,
 * so the named volume must target /var/lib/postgresql. Bots run on Incus, not
 * Docker, so the app service must not mount the host Docker socket.
 *
 * @module DockerCompose
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const COMPOSE_PATH = path.join(REPO_ROOT, 'docker-compose.yml');
const ENV_EXAMPLE_PATH = path.join(REPO_ROOT, '.env.example');

const DEFAULT_PASSWORD = 'ai_army_dev';
const PASSWORD_REF = `\${DB_PASSWORD:-${DEFAULT_PASSWORD}}`;

/**
 * Return the container-side target of a compose volume entry, in short
 * (`src:target[:mode]`) or long (`{ source, target }`) syntax.
 * @param {string|{target?: string}} volume - Compose volume entry
 * @returns {string} Target path
 */
function volumeTarget(volume) {
  if (typeof volume === 'string') {
    return volume.split(':')[1] ?? volume;
  }
  return volume.target ?? '';
}

/**
 * Parse KEY=value lines from an env file, ignoring comments.
 * @param {string} text - Env file contents
 * @returns {Map<string, string>} Parsed variables
 */
function parseEnv(text) {
  const vars = new Map();
  for (const line of text.split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) vars.set(match[1], match[2]);
  }
  return vars;
}

describe('docker-compose.yml', () => {
  /** @type {any} */
  let compose;
  /** @type {Map<string, string>} */
  let env;

  before(async () => {
    compose = yaml.load(await fs.readFile(COMPOSE_PATH, 'utf8'));
    env = parseEnv(await fs.readFile(ENV_EXAMPLE_PATH, 'utf8'));
  });

  test('postgres uses postgres:18-alpine', () => {
    assert.equal(compose.services.postgres.image, 'postgres:18-alpine');
  });

  test('postgres data volume targets /var/lib/postgresql', () => {
    const targets = compose.services.postgres.volumes.map(volumeTarget);
    assert.equal(targets.filter(t => t === '/var/lib/postgresql').length, 1);
  });

  test('postgres has no volume at the pre-18 /var/lib/postgresql/data path', () => {
    const targets = compose.services.postgres.volumes.map(volumeTarget);
    for (const target of targets) {
      assert.ok(
        !target.startsWith('/var/lib/postgresql/data'),
        `postgres:18 refuses to start with a mount at ${target}`
      );
    }
  });

  test('app does not mount the Docker socket', () => {
    for (const volume of compose.services.app.volumes ?? []) {
      assert.doesNotMatch(JSON.stringify(volume), /docker\.sock/);
    }
  });

  test('app DATABASE_URL uses the same password default as POSTGRES_PASSWORD', () => {
    assert.equal(compose.services.postgres.environment.POSTGRES_PASSWORD, PASSWORD_REF);
    assert.ok(
      compose.services.app.environment.DATABASE_URL.includes(`:${PASSWORD_REF}@`),
      'app DATABASE_URL must embed ${DB_PASSWORD:-ai_army_dev}'
    );
  });

  test('.env.example matches the compose password default', () => {
    assert.equal(env.get('DB_PASSWORD'), DEFAULT_PASSWORD);
    assert.ok(env.get('DATABASE_URL')?.includes(`:${DEFAULT_PASSWORD}@`));
  });
});
