/**
 * Unit tests for TemplateManager
 *
 * Tests template CRUD, instance creation with deep merge and
 * variable substitution, and instance lifecycle management.
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  TemplateManager,
  TemplateManagerError,
  INSTANCE_STATUSES,
} from '../../../src/core/template-manager.js';

/**
 * Create a mock storage object for testing
 * @param {Object} [overrides={}] - Override default mock implementations
 * @returns {Object} Mock storage object
 */
function createMockStorage(overrides = {}) {
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

      // DELETE FROM templates (check before SELECT to avoid substring match)
      if (sql.includes('DELETE FROM templates')) {
        const existed = templates.has(params[0]);
        templates.delete(params[0]);
        // Cascade: delete instances referencing this template
        for (const [instId, inst] of instances.entries()) {
          if (inst.template_id === params[0]) {
            instances.delete(instId);
          }
        }
        return { rowCount: existed ? 1 : 0 };
      }

      // DELETE FROM instances (check before SELECT to avoid substring match)
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

        // Apply template_id filter
        if (sql.includes('template_id') && params.length > 0) {
          const templateId = params[0];
          rows = rows.filter(r => r.template_id === templateId);

          // Apply status filter (second param if present)
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
    ...overrides,
  };
}

describe('TemplateManager', () => {
  let templateManager;
  let mockStorage;

  beforeEach(() => {
    mockStorage = createMockStorage();
    templateManager = new TemplateManager(mockStorage);
  });

  // ============================================================================
  // Constructor
  // ============================================================================

  describe('constructor', () => {
    test('creates instance with valid storage', () => {
      const manager = new TemplateManager(mockStorage);
      assert.ok(manager);
      assert.equal(manager.storage, mockStorage);
    });

    test('creates default VariableSubstitutor when not provided', () => {
      const manager = new TemplateManager(mockStorage);
      assert.ok(manager.variableSubstitutor);
    });

    test('uses custom VariableSubstitutor when provided', () => {
      const customSubstitutor = { substitute: mock.fn(), substituteDeep: mock.fn() };
      const manager = new TemplateManager(mockStorage, {
        variableSubstitutor: customSubstitutor,
      });
      assert.equal(manager.variableSubstitutor, customSubstitutor);
    });

    test('throws TemplateManagerError when storage is null', () => {
      assert.throws(
        () => new TemplateManager(null),
        err => {
          assert.equal(err.name, 'TemplateManagerError');
          assert.match(err.message, /Storage is required/);
          assert.equal(err.operation, 'constructor');
          return true;
        }
      );
    });

    test('throws TemplateManagerError when storage is undefined', () => {
      assert.throws(
        () => new TemplateManager(undefined),
        err => {
          assert.equal(err.name, 'TemplateManagerError');
          return true;
        }
      );
    });
  });

  // ============================================================================
  // createTemplate()
  // ============================================================================

  describe('createTemplate()', () => {
    test('creates a template and stores it', async () => {
      const result = await templateManager.createTemplate({
        id: 'support-agent',
        name: 'Support Agent',
        description: 'Customer support bot template',
        config: { model: 'claude-sonnet-4-5', provider: 'anthropic' },
        soulTemplate: 'You are the support agent for {{teamName}}.',
      });

      assert.equal(result.id, 'support-agent');
      assert.equal(result.name, 'Support Agent');
      assert.equal(result.description, 'Customer support bot template');
      assert.deepEqual(result.config, { model: 'claude-sonnet-4-5', provider: 'anthropic' });
      assert.equal(result.soulTemplate, 'You are the support agent for {{teamName}}.');
    });

    test('calls storage.query with correct INSERT', async () => {
      await templateManager.createTemplate({
        id: 'test-tmpl',
        name: 'Test Template',
        config: { model: 'gpt-4' },
      });

      // Find the INSERT call
      const insertCall = mockStorage.query.mock.calls.find(c =>
        c.arguments[0].includes('INSERT INTO templates')
      );
      assert.ok(insertCall, 'Should have made an INSERT INTO templates query');
      assert.equal(insertCall.arguments[1][0], 'test-tmpl');
      assert.equal(insertCall.arguments[1][1], 'Test Template');
    });

    test('stores template in the mock storage map', async () => {
      await templateManager.createTemplate({
        id: 'my-template',
        name: 'My Template',
        config: { provider: 'anthropic' },
      });

      assert.ok(mockStorage.templates.has('my-template'));
    });

    test('throws when template already exists', async () => {
      await templateManager.createTemplate({
        id: 'dup',
        name: 'Dup',
        config: { model: 'test' },
      });

      await assert.rejects(
        () =>
          templateManager.createTemplate({
            id: 'dup',
            name: 'Dup Again',
            config: { model: 'test2' },
          }),
        err => {
          assert.equal(err.name, 'TemplateManagerError');
          assert.match(err.message, /already exists/);
          assert.equal(err.operation, 'createTemplate');
          assert.equal(err.templateId, 'dup');
          return true;
        }
      );
    });

    test('throws when templateConfig is null', async () => {
      await assert.rejects(
        () => templateManager.createTemplate(null),
        err => {
          assert.equal(err.name, 'TemplateManagerError');
          assert.match(err.message, /Template config must be a non-null object/);
          return true;
        }
      );
    });

    test('throws when id is missing', async () => {
      await assert.rejects(
        () => templateManager.createTemplate({ name: 'Test', config: {} }),
        err => {
          assert.equal(err.name, 'TemplateManagerError');
          assert.match(err.message, /Template ID must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws when name is missing', async () => {
      await assert.rejects(
        () => templateManager.createTemplate({ id: 'test', config: {} }),
        err => {
          assert.equal(err.name, 'TemplateManagerError');
          assert.match(err.message, /Template name must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws when config is missing', async () => {
      await assert.rejects(
        () => templateManager.createTemplate({ id: 'test', name: 'Test' }),
        err => {
          assert.equal(err.name, 'TemplateManagerError');
          assert.match(err.message, /config\.config must be a non-null object/);
          return true;
        }
      );
    });

    test('throws TemplateManagerError when storage query fails', async () => {
      const failStorage = createMockStorage({
        query: mock.fn(async sql => {
          // Allow the SELECT (duplicate check) to succeed but fail on INSERT
          if (sql.includes('INSERT INTO templates')) {
            throw new Error('Database write error');
          }
          return { rows: [], rowCount: 0 };
        }),
      });
      const manager = new TemplateManager(failStorage);

      await assert.rejects(
        () =>
          manager.createTemplate({
            id: 'fail',
            name: 'Fail',
            config: { model: 'test' },
          }),
        err => {
          assert.equal(err.name, 'TemplateManagerError');
          assert.match(err.message, /Failed to create template/);
          assert.ok(err.cause);
          return true;
        }
      );
    });
  });

  // ============================================================================
  // getTemplate()
  // ============================================================================

  describe('getTemplate()', () => {
    test('retrieves existing template', async () => {
      await templateManager.createTemplate({
        id: 'support',
        name: 'Support Bot',
        config: { model: 'claude-sonnet-4-5' },
        soulTemplate: 'You help {{teamName}}.',
      });

      const template = await templateManager.getTemplate('support');
      assert.equal(template.id, 'support');
      assert.equal(template.name, 'Support Bot');
      assert.equal(template.soulTemplate, 'You help {{teamName}}.');
    });

    test('returns null for non-existent template', async () => {
      const result = await templateManager.getTemplate('non-existent');
      assert.equal(result, null);
    });

    test('throws when templateId is empty', async () => {
      await assert.rejects(
        () => templateManager.getTemplate(''),
        err => {
          assert.equal(err.name, 'TemplateManagerError');
          assert.match(err.message, /Template ID must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws when templateId is null', async () => {
      await assert.rejects(
        () => templateManager.getTemplate(null),
        err => {
          assert.equal(err.name, 'TemplateManagerError');
          return true;
        }
      );
    });
  });

  // ============================================================================
  // listTemplates()
  // ============================================================================

  describe('listTemplates()', () => {
    test('returns all templates', async () => {
      await templateManager.createTemplate({
        id: 'tmpl-1',
        name: 'Template 1',
        config: { model: 'a' },
      });
      await templateManager.createTemplate({
        id: 'tmpl-2',
        name: 'Template 2',
        config: { model: 'b' },
      });

      const templates = await templateManager.listTemplates();
      assert.equal(templates.length, 2);
    });

    test('returns empty array when no templates exist', async () => {
      const templates = await templateManager.listTemplates();
      assert.deepEqual(templates, []);
    });

    test('throws TemplateManagerError when storage fails', async () => {
      const failStorage = createMockStorage({
        query: mock.fn(async () => {
          throw new Error('Database read error');
        }),
      });
      const manager = new TemplateManager(failStorage);

      await assert.rejects(
        () => manager.listTemplates(),
        err => {
          assert.equal(err.name, 'TemplateManagerError');
          assert.match(err.message, /Failed to list templates/);
          return true;
        }
      );
    });
  });

  // ============================================================================
  // deleteTemplate()
  // ============================================================================

  describe('deleteTemplate()', () => {
    test('deletes existing template', async () => {
      await templateManager.createTemplate({
        id: 'to-delete',
        name: 'Delete Me',
        config: { model: 'test' },
      });

      const deleted = await templateManager.deleteTemplate('to-delete');
      assert.equal(deleted, true);

      const result = await templateManager.getTemplate('to-delete');
      assert.equal(result, null);
    });

    test('returns false for non-existent template', async () => {
      const deleted = await templateManager.deleteTemplate('non-existent');
      assert.equal(deleted, false);
    });

    test('throws when templateId is empty', async () => {
      await assert.rejects(
        () => templateManager.deleteTemplate(''),
        err => {
          assert.equal(err.name, 'TemplateManagerError');
          assert.equal(err.operation, 'deleteTemplate');
          return true;
        }
      );
    });
  });

  // ============================================================================
  // createInstance()
  // ============================================================================

  describe('createInstance()', () => {
    beforeEach(async () => {
      // Seed a template for instance tests
      await templateManager.createTemplate({
        id: 'support-agent',
        name: 'Support Agent',
        config: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          channel: {
            type: 'slack',
            botToken: '${SLACK_BOT_TOKEN}',
          },
          variables: {
            teamName: null,
            teamSlackChannel: null,
          },
        },
        soulTemplate: 'You are the support agent for {{teamName}}.\nMonitor {{teamSlackChannel}}.',
      });
    });

    test('creates instance with merged config and variable substitution', async () => {
      const instance = await templateManager.createInstance('support-agent', {
        id: 'support-team-a',
        name: 'Team A Support',
        overrides: {
          variables: {
            teamName: 'Team A',
            teamSlackChannel: 'C123456',
          },
        },
      });

      assert.equal(instance.id, 'support-team-a');
      assert.equal(instance.templateId, 'support-agent');
      assert.equal(instance.name, 'Team A Support');
      assert.equal(instance.status, 'stopped');
      assert.ok(instance.resolvedConfig);
      assert.ok(instance.resolvedSoul);
    });

    test('applies variable substitution to soul template', async () => {
      const instance = await templateManager.createInstance('support-agent', {
        id: 'support-team-b',
        overrides: {
          variables: {
            teamName: 'Team B',
            teamSlackChannel: 'C789012',
          },
        },
      });

      assert.equal(
        instance.resolvedSoul,
        'You are the support agent for Team B.\nMonitor C789012.'
      );
    });

    test('applies variable substitution to config strings', async () => {
      const instance = await templateManager.createInstance('support-agent', {
        id: 'support-team-c',
        overrides: {
          name: '{{teamName}} Support',
          variables: {
            teamName: 'Team C',
            teamSlackChannel: 'C345678',
          },
        },
      });

      // The resolved config should have the substituted name
      assert.equal(instance.resolvedConfig.name, 'Team C Support');
    });

    test('deep merges template config with overrides', async () => {
      const instance = await templateManager.createInstance('support-agent', {
        id: 'support-custom',
        overrides: {
          model: 'claude-opus-4',
          channel: {
            channelId: 'C999',
          },
          variables: {
            teamName: 'Custom',
            teamSlackChannel: 'C999',
          },
        },
      });

      // Template model should be overridden
      assert.equal(instance.resolvedConfig.model, 'claude-opus-4');
      // Template channel.type should be preserved (deep merge)
      assert.equal(instance.resolvedConfig.channel.type, 'slack');
      // Override channel.channelId should be added
      assert.equal(instance.resolvedConfig.channel.channelId, 'C999');
      // Template provider should be preserved
      assert.equal(instance.resolvedConfig.provider, 'anthropic');
    });

    test('preserves ${ENV_VAR} syntax in config (not substituted)', async () => {
      const instance = await templateManager.createInstance('support-agent', {
        id: 'support-env',
        overrides: {
          variables: {
            teamName: 'Env Team',
            teamSlackChannel: 'C111',
          },
        },
      });

      // ${SLACK_BOT_TOKEN} should NOT be replaced by VariableSubstitutor
      assert.equal(instance.resolvedConfig.channel.botToken, '${SLACK_BOT_TOKEN}');
    });

    test('uses instanceId as name when name is not provided', async () => {
      const instance = await templateManager.createInstance('support-agent', {
        id: 'auto-named',
        overrides: {
          variables: { teamName: 'Auto', teamSlackChannel: 'C000' },
        },
      });

      assert.equal(instance.name, 'auto-named');
    });

    test('stores instance in storage', async () => {
      await templateManager.createInstance('support-agent', {
        id: 'stored-inst',
        overrides: {
          variables: { teamName: 'Stored', teamSlackChannel: 'C777' },
        },
      });

      assert.ok(mockStorage.instances.has('stored-inst'));
    });

    test('throws when template does not exist', async () => {
      await assert.rejects(
        () =>
          templateManager.createInstance('non-existent-template', {
            id: 'inst-1',
          }),
        err => {
          assert.equal(err.name, 'TemplateManagerError');
          assert.match(err.message, /Template.*not found/);
          assert.equal(err.operation, 'createInstance');
          return true;
        }
      );
    });

    test('throws when instance already exists', async () => {
      await templateManager.createInstance('support-agent', {
        id: 'dup-inst',
        overrides: { variables: { teamName: 'A', teamSlackChannel: 'C1' } },
      });

      await assert.rejects(
        () =>
          templateManager.createInstance('support-agent', {
            id: 'dup-inst',
            overrides: { variables: { teamName: 'B', teamSlackChannel: 'C2' } },
          }),
        err => {
          assert.equal(err.name, 'TemplateManagerError');
          assert.match(err.message, /already exists/);
          return true;
        }
      );
    });

    test('throws when templateId is empty', async () => {
      await assert.rejects(
        () => templateManager.createInstance('', { id: 'inst' }),
        err => {
          assert.equal(err.name, 'TemplateManagerError');
          assert.match(err.message, /Template ID must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws when instanceConfig is null', async () => {
      await assert.rejects(
        () => templateManager.createInstance('support-agent', null),
        err => {
          assert.equal(err.name, 'TemplateManagerError');
          assert.match(err.message, /Instance config must be a non-null object/);
          return true;
        }
      );
    });

    test('throws when instance id is missing', async () => {
      await assert.rejects(
        () => templateManager.createInstance('support-agent', { name: 'No ID' }),
        err => {
          assert.equal(err.name, 'TemplateManagerError');
          assert.match(err.message, /Instance ID must be a non-empty string/);
          return true;
        }
      );
    });

    test('creates instance with empty overrides', async () => {
      const instance = await templateManager.createInstance('support-agent', {
        id: 'no-overrides',
      });

      assert.equal(instance.id, 'no-overrides');
      assert.equal(instance.resolvedConfig.model, 'claude-sonnet-4-5');
      // Variables should remain as {{}} since no values provided
      assert.equal(
        instance.resolvedSoul,
        'You are the support agent for {{teamName}}.\nMonitor {{teamSlackChannel}}.'
      );
    });
  });

  // ============================================================================
  // listInstances()
  // ============================================================================

  describe('listInstances()', () => {
    beforeEach(async () => {
      await templateManager.createTemplate({
        id: 'tmpl-a',
        name: 'Template A',
        config: { model: 'a' },
      });
      await templateManager.createTemplate({
        id: 'tmpl-b',
        name: 'Template B',
        config: { model: 'b' },
      });
    });

    test('returns all instances', async () => {
      await templateManager.createInstance('tmpl-a', { id: 'inst-1' });
      await templateManager.createInstance('tmpl-b', { id: 'inst-2' });

      const instances = await templateManager.listInstances();
      assert.equal(instances.length, 2);
    });

    test('filters by templateId', async () => {
      await templateManager.createInstance('tmpl-a', { id: 'inst-a1' });
      await templateManager.createInstance('tmpl-a', { id: 'inst-a2' });
      await templateManager.createInstance('tmpl-b', { id: 'inst-b1' });

      const instances = await templateManager.listInstances({ templateId: 'tmpl-a' });
      assert.equal(instances.length, 2);
      assert.ok(instances.every(i => i.templateId === 'tmpl-a'));
    });

    test('returns empty array when no instances exist', async () => {
      const instances = await templateManager.listInstances();
      assert.deepEqual(instances, []);
    });
  });

  // ============================================================================
  // getInstance()
  // ============================================================================

  describe('getInstance()', () => {
    test('retrieves existing instance', async () => {
      await templateManager.createTemplate({
        id: 'tmpl',
        name: 'Tmpl',
        config: { model: 'test' },
      });
      await templateManager.createInstance('tmpl', { id: 'my-inst', name: 'My Instance' });

      const instance = await templateManager.getInstance('my-inst');
      assert.equal(instance.id, 'my-inst');
      assert.equal(instance.templateId, 'tmpl');
      assert.equal(instance.name, 'My Instance');
    });

    test('returns null for non-existent instance', async () => {
      const result = await templateManager.getInstance('non-existent');
      assert.equal(result, null);
    });

    test('throws when instanceId is empty', async () => {
      await assert.rejects(
        () => templateManager.getInstance(''),
        err => {
          assert.equal(err.name, 'TemplateManagerError');
          assert.equal(err.operation, 'getInstance');
          return true;
        }
      );
    });
  });

  // ============================================================================
  // updateInstanceStatus()
  // ============================================================================

  describe('updateInstanceStatus()', () => {
    beforeEach(async () => {
      await templateManager.createTemplate({
        id: 'tmpl',
        name: 'Tmpl',
        config: { model: 'test' },
      });
      await templateManager.createInstance('tmpl', { id: 'status-inst' });
    });

    test('updates instance status to running', async () => {
      const updated = await templateManager.updateInstanceStatus('status-inst', 'running');
      assert.equal(updated, true);

      const instance = await templateManager.getInstance('status-inst');
      assert.equal(instance.status, 'running');
    });

    test('updates instance status to error', async () => {
      const updated = await templateManager.updateInstanceStatus('status-inst', 'error');
      assert.equal(updated, true);
    });

    test('returns false for non-existent instance', async () => {
      const updated = await templateManager.updateInstanceStatus('no-such-inst', 'running');
      assert.equal(updated, false);
    });

    test('throws for invalid status', async () => {
      await assert.rejects(
        () => templateManager.updateInstanceStatus('status-inst', 'invalid'),
        err => {
          assert.equal(err.name, 'TemplateManagerError');
          assert.match(err.message, /Invalid instance status/);
          return true;
        }
      );
    });

    test('throws when instanceId is empty', async () => {
      await assert.rejects(
        () => templateManager.updateInstanceStatus('', 'running'),
        err => {
          assert.equal(err.name, 'TemplateManagerError');
          return true;
        }
      );
    });
  });

  // ============================================================================
  // deleteInstance()
  // ============================================================================

  describe('deleteInstance()', () => {
    test('deletes existing instance', async () => {
      await templateManager.createTemplate({
        id: 'tmpl',
        name: 'Tmpl',
        config: { model: 'test' },
      });
      await templateManager.createInstance('tmpl', { id: 'del-inst' });

      const deleted = await templateManager.deleteInstance('del-inst');
      assert.equal(deleted, true);

      const result = await templateManager.getInstance('del-inst');
      assert.equal(result, null);
    });

    test('returns false for non-existent instance', async () => {
      const deleted = await templateManager.deleteInstance('non-existent');
      assert.equal(deleted, false);
    });

    test('throws when instanceId is empty', async () => {
      await assert.rejects(
        () => templateManager.deleteInstance(''),
        err => {
          assert.equal(err.name, 'TemplateManagerError');
          assert.equal(err.operation, 'deleteInstance');
          return true;
        }
      );
    });
  });

  // ============================================================================
  // resolveInstance()
  // ============================================================================

  describe('resolveInstance()', () => {
    beforeEach(async () => {
      await templateManager.createTemplate({
        id: 'resolve-tmpl',
        name: 'Resolve Template',
        config: {
          model: 'claude-sonnet-4-5',
          variables: { teamName: null },
        },
        soulTemplate: 'Hello {{teamName}}!',
      });
    });

    test('resolves instance with variable substitution', async () => {
      await templateManager.createInstance('resolve-tmpl', {
        id: 'resolve-inst',
        name: 'Resolved Instance',
        overrides: {
          variables: { teamName: 'Engineering' },
        },
      });

      const resolved = await templateManager.resolveInstance('resolve-inst');
      assert.equal(resolved.id, 'resolve-inst');
      assert.equal(resolved.resolvedSoul, 'Hello Engineering!');
      assert.equal(resolved.resolvedConfig.variables.teamName, 'Engineering');
    });

    test('throws when instance does not exist', async () => {
      await assert.rejects(
        () => templateManager.resolveInstance('no-inst'),
        err => {
          assert.equal(err.name, 'TemplateManagerError');
          assert.match(err.message, /Instance.*not found/);
          return true;
        }
      );
    });

    test('throws when instanceId is empty', async () => {
      await assert.rejects(
        () => templateManager.resolveInstance(''),
        err => {
          assert.equal(err.name, 'TemplateManagerError');
          assert.equal(err.operation, 'resolveInstance');
          return true;
        }
      );
    });
  });

  // ============================================================================
  // _deepMerge() (tested via createInstance behavior)
  // ============================================================================

  describe('_deepMerge()', () => {
    test('merges flat objects', () => {
      const result = templateManager._deepMerge({ a: 1, b: 2 }, { b: 3, c: 4 });
      assert.deepEqual(result, { a: 1, b: 3, c: 4 });
    });

    test('deeply merges nested objects', () => {
      const result = templateManager._deepMerge(
        { outer: { a: 1, b: 2 } },
        { outer: { b: 3, c: 4 } }
      );
      assert.deepEqual(result, { outer: { a: 1, b: 3, c: 4 } });
    });

    test('replaces arrays instead of merging', () => {
      const result = templateManager._deepMerge({ tags: ['a', 'b'] }, { tags: ['c'] });
      assert.deepEqual(result, { tags: ['c'] });
    });

    test('does not mutate target', () => {
      const target = { a: 1, nested: { x: 1 } };
      templateManager._deepMerge(target, { a: 2, nested: { y: 2 } });
      assert.equal(target.a, 1);
      assert.equal(target.nested.y, undefined);
    });

    test('returns target when source is null', () => {
      const result = templateManager._deepMerge({ a: 1 }, null);
      assert.deepEqual(result, { a: 1 });
    });

    test('returns source when target is null', () => {
      const result = templateManager._deepMerge(null, { a: 1 });
      assert.deepEqual(result, { a: 1 });
    });

    test('handles empty objects', () => {
      const result = templateManager._deepMerge({ a: 1 }, {});
      assert.deepEqual(result, { a: 1 });
    });
  });
});

describe('TemplateManagerError', () => {
  test('is an instance of Error', () => {
    const error = new TemplateManagerError('Test error');
    assert.ok(error instanceof Error);
  });

  test('has correct name', () => {
    const error = new TemplateManagerError('Test error');
    assert.equal(error.name, 'TemplateManagerError');
  });

  test('stores operation', () => {
    const error = new TemplateManagerError('Test', { operation: 'createTemplate' });
    assert.equal(error.operation, 'createTemplate');
  });

  test('stores templateId', () => {
    const error = new TemplateManagerError('Test', { templateId: 'support-agent' });
    assert.equal(error.templateId, 'support-agent');
  });

  test('stores instanceId', () => {
    const error = new TemplateManagerError('Test', { instanceId: 'support-team-a' });
    assert.equal(error.instanceId, 'support-team-a');
  });

  test('stores cause', () => {
    const cause = new Error('Original');
    const error = new TemplateManagerError('Test', { cause });
    assert.equal(error.cause, cause);
  });

  test('stores all options together', () => {
    const cause = new Error('Root cause');
    const error = new TemplateManagerError('Multi', {
      cause,
      operation: 'createInstance',
      templateId: 'tmpl-1',
      instanceId: 'inst-1',
    });
    assert.equal(error.cause, cause);
    assert.equal(error.operation, 'createInstance');
    assert.equal(error.templateId, 'tmpl-1');
    assert.equal(error.instanceId, 'inst-1');
  });
});

describe('INSTANCE_STATUSES', () => {
  test('has all expected statuses', () => {
    assert.equal(INSTANCE_STATUSES.STARTING, 'starting');
    assert.equal(INSTANCE_STATUSES.RUNNING, 'running');
    assert.equal(INSTANCE_STATUSES.STOPPED, 'stopped');
    assert.equal(INSTANCE_STATUSES.ERROR, 'error');
  });

  test('is frozen', () => {
    assert.ok(Object.isFrozen(INSTANCE_STATUSES));
  });
});
