/**
 * Tests for templates/basic/docker-compose.yml
 *
 * Validates the basic project template docker-compose file has the correct
 * structure, PostgreSQL 18 service configuration, healthcheck, volumes,
 * and follows Docker Compose best practices.
 *
 * @module templates/basic/docker-compose.test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const composePath = path.join(__dirname, 'docker-compose.yml');

/**
 * Minimal YAML parser for docker-compose files.
 *
 * Handles the subset of YAML needed for docker-compose validation:
 * - Key-value pairs (scalars and strings)
 * - Nested objects via indentation
 * - Arrays with `- ` prefix
 * - Quoted strings
 *
 * Does NOT handle: anchors, multi-line scalars, flow mappings, etc.
 *
 * @param {string} text - Raw YAML content
 * @returns {Object} Parsed YAML as a plain object
 */
function parseSimpleYaml(text) {
  const lines = text.split('\n');
  const root = {};
  const stack = [{ indent: -1, obj: root }];

  for (const rawLine of lines) {
    // Skip empty lines and comments
    if (!rawLine.trim() || rawLine.trim().startsWith('#')) continue;

    const indent = rawLine.search(/\S/);
    const line = rawLine.trim();

    // Pop stack to find correct parent
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].obj;

    // Array item
    if (line.startsWith('- ')) {
      const value = line.slice(2).trim();
      // Find the key in parent that this array belongs to
      const parentKey = Object.keys(parent).pop();
      if (parentKey && !Array.isArray(parent[parentKey])) {
        // The previous key might be the array container; check if value is empty
      }
      // If parent is an array itself, push
      if (Array.isArray(parent)) {
        parent.push(unquote(value));
      } else {
        // Find last key with empty value and convert to array
        const keys = Object.keys(parent);
        const lastKey = keys[keys.length - 1];
        if (lastKey !== undefined) {
          if (!Array.isArray(parent[lastKey])) {
            parent[lastKey] = [];
          }
          parent[lastKey].push(unquote(value));
        }
      }
      continue;
    }

    // Key: value pair
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trim();

    if (rawValue === '' || rawValue === undefined) {
      // Nested object
      const child = {};
      parent[key] = child;
      stack.push({ indent, obj: child });
    } else {
      parent[key] = unquote(rawValue);
    }
  }

  return root;
}

/**
 * Remove surrounding quotes from a YAML value
 * @param {string} val - Raw value string
 * @returns {string} Unquoted value
 */
function unquote(val) {
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    return val.slice(1, -1);
  }
  return val;
}

describe('templates/basic/docker-compose.yml', () => {
  /** @type {string} */
  let raw;
  /** @type {Object} */
  let compose;

  it('should exist and be readable', () => {
    raw = fs.readFileSync(composePath, 'utf8');
    assert.ok(raw.length > 0, 'file should not be empty');
  });

  it('should be parseable YAML', () => {
    raw = fs.readFileSync(composePath, 'utf8');
    compose = parseSimpleYaml(raw);
    assert.ok(compose, 'parsed compose should be an object');
    assert.equal(typeof compose, 'object');
  });

  describe('compose version', () => {
    it('should specify version 3.8', () => {
      raw = fs.readFileSync(composePath, 'utf8');
      compose = parseSimpleYaml(raw);
      assert.equal(compose.version, '3.8');
    });
  });

  describe('services', () => {
    it('should have a services section', () => {
      raw = fs.readFileSync(composePath, 'utf8');
      compose = parseSimpleYaml(raw);
      assert.ok(compose.services, 'services should exist');
      assert.equal(typeof compose.services, 'object');
    });

    it('should have a postgres service', () => {
      raw = fs.readFileSync(composePath, 'utf8');
      compose = parseSimpleYaml(raw);
      assert.ok(compose.services.postgres, 'postgres service should exist');
    });
  });

  describe('postgres service', () => {
    it('should use PostgreSQL 18 image', () => {
      raw = fs.readFileSync(composePath, 'utf8');
      compose = parseSimpleYaml(raw);
      const { postgres } = compose.services;
      assert.equal(postgres.image, 'postgres:18');
    });

    it('should have environment variables for database config', () => {
      raw = fs.readFileSync(composePath, 'utf8');
      compose = parseSimpleYaml(raw);
      const { environment } = compose.services.postgres;
      assert.ok(environment, 'environment should exist');
      assert.equal(environment.POSTGRES_DB, 'ai_army');
      assert.equal(environment.POSTGRES_USER, 'ai_army');
      assert.ok(environment.POSTGRES_PASSWORD, 'POSTGRES_PASSWORD should be set');
    });

    it('should use env var interpolation for password with fallback', () => {
      raw = fs.readFileSync(composePath, 'utf8');
      assert.ok(
        raw.includes('${DB_PASSWORD:-ai_army_dev}'),
        'should use ${DB_PASSWORD:-ai_army_dev} interpolation with default'
      );
    });

    it('should expose port 5432', () => {
      raw = fs.readFileSync(composePath, 'utf8');
      assert.ok(raw.includes('5432:5432'), 'should map port 5432');
    });

    it('should mount pgdata volume for persistence', () => {
      raw = fs.readFileSync(composePath, 'utf8');
      assert.ok(raw.includes('pgdata:/var/lib/postgresql/data'), 'should mount pgdata volume');
    });

    it('should mount migrations directory for init scripts', () => {
      raw = fs.readFileSync(composePath, 'utf8');
      assert.ok(
        raw.includes('./migrations:/docker-entrypoint-initdb.d'),
        'should mount migrations as init scripts'
      );
    });

    it('should have a healthcheck configuration', () => {
      raw = fs.readFileSync(composePath, 'utf8');
      compose = parseSimpleYaml(raw);
      const { postgres } = compose.services;
      assert.ok(postgres.healthcheck, 'healthcheck should exist');
    });

    it('should use pg_isready for healthcheck test', () => {
      raw = fs.readFileSync(composePath, 'utf8');
      assert.ok(
        raw.includes('pg_isready -U ai_army'),
        'healthcheck should use pg_isready with correct user'
      );
    });

    it('should have healthcheck interval, timeout, and retries', () => {
      raw = fs.readFileSync(composePath, 'utf8');
      compose = parseSimpleYaml(raw);
      const { healthcheck } = compose.services.postgres;
      assert.ok(healthcheck.interval, 'healthcheck interval should be set');
      assert.ok(healthcheck.timeout, 'healthcheck timeout should be set');
      assert.ok(healthcheck.retries, 'healthcheck retries should be set');
    });

    it('should have restart policy', () => {
      raw = fs.readFileSync(composePath, 'utf8');
      compose = parseSimpleYaml(raw);
      const { postgres } = compose.services;
      assert.equal(postgres.restart, 'unless-stopped');
    });
  });

  describe('volumes', () => {
    it('should define pgdata volume at top level', () => {
      raw = fs.readFileSync(composePath, 'utf8');
      compose = parseSimpleYaml(raw);
      assert.ok(compose.volumes, 'volumes section should exist');
      assert.ok(
        Object.prototype.hasOwnProperty.call(compose.volumes, 'pgdata'),
        'pgdata volume should be defined'
      );
    });
  });

  describe('file format', () => {
    it('should end with a trailing newline', () => {
      raw = fs.readFileSync(composePath, 'utf8');
      assert.ok(raw.endsWith('\n'), 'file should end with a newline');
    });

    it('should use 2-space indentation', () => {
      raw = fs.readFileSync(composePath, 'utf8');
      const lines = raw.split('\n').filter(l => l.startsWith(' '));
      for (const line of lines) {
        const indent = line.match(/^( +)/)?.[1];
        if (indent) {
          assert.equal(indent.length % 2, 0, `Indentation should be multiples of 2: "${line}"`);
        }
      }
    });

    it('should not contain tabs', () => {
      raw = fs.readFileSync(composePath, 'utf8');
      assert.ok(!raw.includes('\t'), 'file should not contain tabs');
    });

    it('should be valid docker-compose structure (version, services, volumes)', () => {
      raw = fs.readFileSync(composePath, 'utf8');
      compose = parseSimpleYaml(raw);
      const topKeys = Object.keys(compose);
      assert.ok(topKeys.includes('version'), 'should have version key');
      assert.ok(topKeys.includes('services'), 'should have services key');
      assert.ok(topKeys.includes('volumes'), 'should have volumes key');
    });
  });

  describe('security', () => {
    it('should not contain hardcoded passwords without env var fallback', () => {
      raw = fs.readFileSync(composePath, 'utf8');
      // The password line should use env var interpolation
      const passwordLines = raw.split('\n').filter(l => l.includes('POSTGRES_PASSWORD'));
      assert.ok(passwordLines.length > 0, 'should have POSTGRES_PASSWORD');
      for (const line of passwordLines) {
        assert.ok(
          line.includes('${') || line.includes('$DB_PASSWORD'),
          `Password should use env var interpolation: "${line.trim()}"`
        );
      }
    });
  });

  describe('consistency with project', () => {
    it('should use ai_army as database name matching config.json', () => {
      raw = fs.readFileSync(composePath, 'utf8');
      assert.ok(raw.includes('ai_army'), 'should use ai_army database name');
    });

    it('should use port 5432 matching .env.example DATABASE_URL', () => {
      raw = fs.readFileSync(composePath, 'utf8');
      assert.ok(raw.includes('5432'), 'should use standard PostgreSQL port');
    });
  });
});
