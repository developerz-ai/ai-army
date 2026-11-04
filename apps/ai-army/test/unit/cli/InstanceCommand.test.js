/**
 * Unit tests for InstanceCommand
 *
 * Tests all instance subcommands: create, list, scale, stop, rm.
 * Uses mock storage and TemplateManager via dependency injection.
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  runInstance,
  InstanceCommandError,
  parseOverrides,
} from '../../../src/cli/InstanceCommand.js';
import { TemplateManager, INSTANCE_STATUSES } from '../../../src/core/template-manager.js';

/**
 * Create a mock storage object for testing
 * @returns {Object} Mock storage object with Map-based query simulation
 */
function createMockStorage() {
  const templates = new Map();
  const instances = new Map();

  return {
    templates,
    instances,
    query: mock.fn(async (sql, params = []) => {
      // INSERT INTO templates
      if (sql.includes('INSERT INTO templates')) {
        const [id, name, description, configJson, soulTemplate] = params;
        const row = {
          id,
          name,
          description,
          config: JSON.parse(configJson),
          soul_template: soulTemplate,
          version: 1,
          created_at: new Date(),
          updated_at: new Date(),
        };
        templates.set(id, row);
        return { rows: [row], rowCount: 1 };
      }

      // INSERT INTO instances
      if (sql.includes('INSERT INTO instances')) {
        const [id, templateId, name, overridesJson, status] = params;
        const row = {
          id,
          template_id: templateId,
          name,
          overrides: JSON.parse(overridesJson),
          status,
          created_at: new Date(),
          updated_at: new Date(),
        };
        instances.set(id, row);
        return { rows: [row], rowCount: 1 };
      }

      // DELETE FROM templates
      if (sql.includes('DELETE FROM templates')) {
        const existed = templates.has(params[0]);
        templates.delete(params[0]);
        for (const [instId, inst] of instances.entries()) {
          if (inst.template_id === params[0]) {
            instances.delete(instId);
          }
        }
        return { rowCount: existed ? 1 : 0 };
      }

      // DELETE FROM instances
      if (sql.includes('DELETE FROM instances')) {
        const existed = instances.has(params[0]);
        instances.delete(params[0]);
        return { rowCount: existed ? 1 : 0 };
      }

      // UPDATE instances SET status
      if (sql.includes('UPDATE instances SET status')) {
        const [status, instanceId] = params;
        const row = instances.get(instanceId);
        if (row) {
          row.status = status;
          return { rowCount: 1 };
        }
        return { rowCount: 0 };
      }

      // SELECT * FROM templates WHERE id = $1
      if (sql.includes('SELECT') && sql.includes('FROM templates WHERE id')) {
        const row = templates.get(params[0]);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }

      // SELECT * FROM instances WHERE id = $1
      if (sql.includes('SELECT') && sql.includes('FROM instances WHERE id')) {
        const row = instances.get(params[0]);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }

      // SELECT * FROM templates ORDER BY
      if (sql.includes('FROM templates ORDER BY')) {
        return { rows: [...templates.values()], rowCount: templates.size };
      }

      // SELECT * FROM instances (with optional filters)
      if (sql.includes('SELECT') && sql.includes('FROM instances')) {
        let rows = [...instances.values()];

        if (sql.includes('template_id') && params.length > 0) {
          const templateId = params[0];
          rows = rows.filter(r => r.template_id === templateId);
          if (sql.includes('status') && params.length > 1) {
            rows = rows.filter(r => r.status === params[1]);
          }
        } else if (sql.includes('status') && params.length > 0) {
          rows = rows.filter(r => r.status === params[0]);
        }

        return { rows, rowCount: rows.length };
      }

      return { rows: [], rowCount: 0 };
    }),
  };
}

/**
 * Create a mock writable output stream
 * @returns {Object} Mock output with write() and captured lines
 */
function createMockOutput() {
  const lines = [];
  return {
    lines,
    write: mock.fn(msg => {
      lines.push(msg);
      return true;
    }),
  };
}

describe('InstanceCommand', () => {
  let mockStorage;
  let mockOutput;
  let templateManager;

  beforeEach(async () => {
    mockStorage = createMockStorage();
    mockOutput = createMockOutput();
    templateManager = new TemplateManager(mockStorage);

    // Seed a template for instance tests
    await templateManager.createTemplate({
      id: 'support-agent',
      name: 'Support Agent',
      config: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        variables: {
          teamName: null,
          teamSlackChannel: null,
        },
      },
      soulTemplate: 'You are the support agent for {{teamName}}.',
    });
  });

  // ============================================================================
  // create subcommand
  // ============================================================================

  describe('create', () => {
    test('creates instance from template', async () => {
      const result = await runInstance('create', {
        templateId: 'support-agent',
        instanceId: 'support-team-a',
        name: 'Team A Support',
        overrides: ['variables.teamName=Team A', 'variables.teamSlackChannel=C123'],
        output: mockOutput,
        templateManager,
      });

      assert.equal(result.success, true);
      assert.equal(result.instance.id, 'support-team-a');
      assert.equal(result.instance.templateId, 'support-agent');
    });

    test('writes output about created instance', async () => {
      await runInstance('create', {
        templateId: 'support-agent',
        instanceId: 'support-1',
        output: mockOutput,
        templateManager,
      });

      const output = mockOutput.lines.join('');
      assert.match(output, /Created instance 'support-1'/);
      assert.match(output, /support-agent/);
    });

    test('uses instanceId as name when name not provided', async () => {
      const result = await runInstance('create', {
        templateId: 'support-agent',
        instanceId: 'auto-named',
        output: mockOutput,
        templateManager,
      });

      assert.equal(result.instance.name, 'auto-named');
    });

    test('throws when templateId is missing', async () => {
      await assert.rejects(
        () =>
          runInstance('create', {
            instanceId: 'inst-1',
            output: mockOutput,
            templateManager,
          }),
        err => {
          assert.equal(err.name, 'InstanceCommandError');
          assert.match(err.message, /Template ID is required/);
          assert.equal(err.operation, 'create');
          return true;
        }
      );
    });

    test('throws when instanceId is missing', async () => {
      await assert.rejects(
        () =>
          runInstance('create', {
            templateId: 'support-agent',
            output: mockOutput,
            templateManager,
          }),
        err => {
          assert.equal(err.name, 'InstanceCommandError');
          assert.match(err.message, /Instance ID is required/);
          return true;
        }
      );
    });

    test('throws when template does not exist', async () => {
      await assert.rejects(
        () =>
          runInstance('create', {
            templateId: 'non-existent',
            instanceId: 'inst-1',
            output: mockOutput,
            templateManager,
          }),
        err => {
          assert.match(err.message, /not found/);
          return true;
        }
      );
    });

    test('applies override values', async () => {
      const result = await runInstance('create', {
        templateId: 'support-agent',
        instanceId: 'overridden',
        overrides: ['variables.teamName=Overridden Team'],
        output: mockOutput,
        templateManager,
      });

      assert.equal(result.success, true);
      assert.equal(result.instance.id, 'overridden');
    });
  });

  // ============================================================================
  // list subcommand
  // ============================================================================

  describe('list', () => {
    test('lists all instances', async () => {
      await templateManager.createInstance('support-agent', {
        id: 'inst-1',
        overrides: { variables: { teamName: 'A', teamSlackChannel: 'C1' } },
      });
      await templateManager.createInstance('support-agent', {
        id: 'inst-2',
        overrides: { variables: { teamName: 'B', teamSlackChannel: 'C2' } },
      });

      const result = await runInstance('list', {
        output: mockOutput,
        templateManager,
      });

      assert.equal(result.success, true);
      assert.equal(result.instances.length, 2);
    });

    test('outputs instance details', async () => {
      await templateManager.createInstance('support-agent', {
        id: 'list-inst',
        name: 'Listed Instance',
        overrides: { variables: { teamName: 'Listed', teamSlackChannel: 'C1' } },
      });

      await runInstance('list', {
        output: mockOutput,
        templateManager,
      });

      const output = mockOutput.lines.join('');
      assert.match(output, /list-inst/);
      assert.match(output, /support-agent/);
    });

    test('shows message when no instances found', async () => {
      const result = await runInstance('list', {
        output: mockOutput,
        templateManager,
      });

      assert.equal(result.success, true);
      assert.equal(result.instances.length, 0);

      const output = mockOutput.lines.join('');
      assert.match(output, /No instances found/);
    });

    test('filters by templateId', async () => {
      await templateManager.createTemplate({
        id: 'other-tmpl',
        name: 'Other',
        config: { model: 'test' },
      });

      await templateManager.createInstance('support-agent', {
        id: 'inst-a',
        overrides: { variables: { teamName: 'A', teamSlackChannel: 'C1' } },
      });
      await templateManager.createInstance('other-tmpl', { id: 'inst-b' });

      const result = await runInstance('list', {
        templateId: 'support-agent',
        output: mockOutput,
        templateManager,
      });

      assert.equal(result.instances.length, 1);
      assert.equal(result.instances[0].id, 'inst-a');
    });
  });

  // ============================================================================
  // scale subcommand
  // ============================================================================

  describe('scale', () => {
    test('creates multiple instances', async () => {
      const result = await runInstance('scale', {
        templateId: 'support-agent',
        count: 3,
        output: mockOutput,
        templateManager,
      });

      assert.equal(result.created.length, 3);
      assert.equal(result.failed.length, 0);
      assert.equal(result.success, true);
    });

    test('generates sequential instance IDs', async () => {
      const result = await runInstance('scale', {
        templateId: 'support-agent',
        count: 2,
        output: mockOutput,
        templateManager,
      });

      const ids = result.created.map(i => i.id);
      assert.ok(ids.includes('support-agent-1'));
      assert.ok(ids.includes('support-agent-2'));
    });

    test('reports scaling output', async () => {
      await runInstance('scale', {
        templateId: 'support-agent',
        count: 2,
        output: mockOutput,
        templateManager,
      });

      const output = mockOutput.lines.join('');
      assert.match(output, /Scaling template 'support-agent'/);
      assert.match(output, /Scale complete/);
    });

    test('throws when templateId is missing', async () => {
      await assert.rejects(
        () =>
          runInstance('scale', {
            count: 3,
            output: mockOutput,
            templateManager,
          }),
        err => {
          assert.equal(err.name, 'InstanceCommandError');
          assert.match(err.message, /Template ID is required/);
          return true;
        }
      );
    });

    test('throws when count is invalid', async () => {
      await assert.rejects(
        () =>
          runInstance('scale', {
            templateId: 'support-agent',
            count: 0,
            output: mockOutput,
            templateManager,
          }),
        err => {
          assert.equal(err.name, 'InstanceCommandError');
          assert.match(err.message, /Count must be a positive integer/);
          return true;
        }
      );
    });

    test('reports partial failures', async () => {
      // Create instance-1 first so scale will fail on it
      await templateManager.createInstance('support-agent', {
        id: 'support-agent-1',
        overrides: { variables: { teamName: 'Pre', teamSlackChannel: 'C0' } },
      });

      const result = await runInstance('scale', {
        templateId: 'support-agent',
        count: 3,
        output: mockOutput,
        templateManager,
      });

      assert.equal(result.created.length, 2);
      assert.equal(result.failed.length, 1);
      assert.equal(result.success, false);
    });
  });

  // ============================================================================
  // stop subcommand
  // ============================================================================

  describe('stop', () => {
    test('stops a running instance', async () => {
      await templateManager.createInstance('support-agent', {
        id: 'stop-inst',
        overrides: { variables: { teamName: 'Stop', teamSlackChannel: 'C1' } },
      });
      await templateManager.updateInstanceStatus('stop-inst', INSTANCE_STATUSES.RUNNING);

      const result = await runInstance('stop', {
        instanceId: 'stop-inst',
        output: mockOutput,
        templateManager,
      });

      assert.equal(result.success, true);

      const output = mockOutput.lines.join('');
      assert.match(output, /Stopped instance 'stop-inst'/);

      // Verify status was updated
      const instance = await templateManager.getInstance('stop-inst');
      assert.equal(instance.status, INSTANCE_STATUSES.STOPPED);
    });

    test('returns false for non-existent instance', async () => {
      const result = await runInstance('stop', {
        instanceId: 'no-such-inst',
        output: mockOutput,
        templateManager,
      });

      assert.equal(result.success, false);

      const output = mockOutput.lines.join('');
      assert.match(output, /not found/);
    });

    test('throws when instanceId is missing', async () => {
      await assert.rejects(
        () =>
          runInstance('stop', {
            output: mockOutput,
            templateManager,
          }),
        err => {
          assert.equal(err.name, 'InstanceCommandError');
          assert.match(err.message, /Instance ID is required/);
          return true;
        }
      );
    });
  });

  // ============================================================================
  // rm subcommand
  // ============================================================================

  describe('rm', () => {
    test('removes an instance', async () => {
      await templateManager.createInstance('support-agent', {
        id: 'rm-inst',
        overrides: { variables: { teamName: 'Rm', teamSlackChannel: 'C1' } },
      });

      const result = await runInstance('rm', {
        instanceId: 'rm-inst',
        output: mockOutput,
        templateManager,
      });

      assert.equal(result.success, true);

      const output = mockOutput.lines.join('');
      assert.match(output, /Removed instance 'rm-inst'/);

      // Verify instance was deleted
      const instance = await templateManager.getInstance('rm-inst');
      assert.equal(instance, null);
    });

    test('returns false for non-existent instance', async () => {
      const result = await runInstance('rm', {
        instanceId: 'no-such-inst',
        output: mockOutput,
        templateManager,
      });

      assert.equal(result.success, false);

      const output = mockOutput.lines.join('');
      assert.match(output, /not found/);
    });

    test('throws when instanceId is missing', async () => {
      await assert.rejects(
        () =>
          runInstance('rm', {
            output: mockOutput,
            templateManager,
          }),
        err => {
          assert.equal(err.name, 'InstanceCommandError');
          assert.match(err.message, /Instance ID is required/);
          return true;
        }
      );
    });
  });

  // ============================================================================
  // unknown subcommand
  // ============================================================================

  describe('unknown command', () => {
    test('throws for unknown subcommand', async () => {
      await assert.rejects(
        () =>
          runInstance('deploy', {
            output: mockOutput,
            templateManager,
          }),
        err => {
          assert.equal(err.name, 'InstanceCommandError');
          assert.match(err.message, /Unknown instance command/);
          assert.match(err.message, /deploy/);
          return true;
        }
      );
    });
  });

  // ============================================================================
  // runInstance with storage (creates TemplateManager internally)
  // ============================================================================

  describe('runInstance with storage injection', () => {
    test('creates TemplateManager from storage when templateManager not provided', async () => {
      // Seed a template directly in storage
      await mockStorage.query(
        'INSERT INTO templates (id, name, description, config, soul_template) VALUES ($1, $2, $3, $4, $5)',
        ['tmpl-x', 'Tmpl X', null, JSON.stringify({ model: 'test' }), null]
      );

      const result = await runInstance('list', {
        output: mockOutput,
        storage: mockStorage,
      });

      assert.equal(result.success, true);
    });
  });
});

// =============================================================================
// parseOverrides
// =============================================================================

describe('parseOverrides', () => {
  test('parses simple key=value pairs', () => {
    const result = parseOverrides(['name=Bot 1', 'model=gpt-4']);
    assert.deepEqual(result, { name: 'Bot 1', model: 'gpt-4' });
  });

  test('parses dot-notation for nested keys', () => {
    const result = parseOverrides(['variables.teamName=Team A', 'variables.teamSlackChannel=C123']);
    assert.deepEqual(result, {
      variables: { teamName: 'Team A', teamSlackChannel: 'C123' },
    });
  });

  test('handles values containing equals signs', () => {
    const result = parseOverrides(['formula=a=b+c']);
    assert.deepEqual(result, { formula: 'a=b+c' });
  });

  test('skips entries without equals sign', () => {
    const result = parseOverrides(['no-equals', 'valid=yes']);
    assert.deepEqual(result, { valid: 'yes' });
  });

  test('handles empty overrides array', () => {
    const result = parseOverrides([]);
    assert.deepEqual(result, {});
  });

  test('trims whitespace from keys and values', () => {
    const result = parseOverrides([' name = Bot 1 ']);
    assert.deepEqual(result, { name: 'Bot 1' });
  });

  test('creates deeply nested objects', () => {
    const result = parseOverrides(['a.b.c=deep']);
    assert.deepEqual(result, { a: { b: { c: 'deep' } } });
  });
});

// =============================================================================
// InstanceCommandError
// =============================================================================

describe('InstanceCommandError', () => {
  test('is an instance of Error', () => {
    const error = new InstanceCommandError('Test error');
    assert.ok(error instanceof Error);
  });

  test('has correct name', () => {
    const error = new InstanceCommandError('Test error');
    assert.equal(error.name, 'InstanceCommandError');
  });

  test('stores operation', () => {
    const error = new InstanceCommandError('Test', { operation: 'create' });
    assert.equal(error.operation, 'create');
  });

  test('stores instanceId', () => {
    const error = new InstanceCommandError('Test', { instanceId: 'inst-1' });
    assert.equal(error.instanceId, 'inst-1');
  });

  test('stores templateId', () => {
    const error = new InstanceCommandError('Test', { templateId: 'tmpl-1' });
    assert.equal(error.templateId, 'tmpl-1');
  });

  test('stores cause', () => {
    const cause = new Error('Original');
    const error = new InstanceCommandError('Test', { cause });
    assert.equal(error.cause, cause);
  });
});
