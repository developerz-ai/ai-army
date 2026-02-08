/**
 * Unit tests for SkillRegistry
 *
 * Tests skill registration, lookup, bot-skill attachments,
 * instruction merging, tool collection, and error handling.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SkillRegistry, SkillRegistryError } from '../../../src/skills/skill-registry.js';

/**
 * Create a mock skill object
 * @param {Object} [overrides] - Fields to override
 * @returns {Object} Mock skill
 */
function createMockSkill(overrides = {}) {
  return {
    name: 'code-review',
    description: 'Review code for quality',
    instructions: '# Code Review\n\nWhen reviewing code, check for bugs.',
    path: '/skills/code-review',
    tools: null,
    ...overrides,
  };
}

/**
 * Create a mock logger
 * @returns {{ fn: Function, messages: string[] }}
 */
function createMockLogger() {
  const messages = [];
  const fn = msg => messages.push(msg);
  return { fn, messages };
}

describe('SkillRegistry', () => {
  describe('constructor', () => {
    test('creates empty registry', () => {
      const registry = new SkillRegistry();

      assert.equal(registry.getSkillCount(), 0);
      assert.deepEqual(registry.listSkills(), []);
    });

    test('accepts logger option', () => {
      const { fn, messages } = createMockLogger();
      const registry = new SkillRegistry({ logger: fn });
      const skill = createMockSkill();

      registry.registerSkill(skill);

      assert.ok(messages.length > 0);
      assert.ok(messages[0].includes('code-review'));
    });
  });

  describe('registerSkill()', () => {
    let registry;

    beforeEach(() => {
      registry = new SkillRegistry();
    });

    test('registers a valid skill', () => {
      const skill = createMockSkill();
      registry.registerSkill(skill);

      assert.equal(registry.getSkillCount(), 1);
      assert.equal(registry.getSkill('code-review'), skill);
    });

    test('registers multiple skills', () => {
      registry.registerSkill(createMockSkill({ name: 'code-review' }));
      registry.registerSkill(createMockSkill({ name: 'deploy', description: 'Deploy apps' }));
      registry.registerSkill(createMockSkill({ name: 'triage', description: 'Triage issues' }));

      assert.equal(registry.getSkillCount(), 3);
    });

    test('replaces skill with same name', () => {
      const original = createMockSkill({ instructions: 'Original instructions' });
      const replacement = createMockSkill({ instructions: 'Updated instructions' });

      registry.registerSkill(original);
      registry.registerSkill(replacement);

      assert.equal(registry.getSkillCount(), 1);
      assert.equal(registry.getSkill('code-review').instructions, 'Updated instructions');
    });

    test('logs replacement message when replacing', () => {
      const { fn, messages } = createMockLogger();
      const reg = new SkillRegistry({ logger: fn });

      reg.registerSkill(createMockSkill());
      reg.registerSkill(createMockSkill({ instructions: 'new' }));

      assert.ok(messages.some(m => m.includes('Replaced')));
    });

    test('registers skill with empty instructions', () => {
      const skill = createMockSkill({ instructions: '' });
      registry.registerSkill(skill);

      assert.equal(registry.getSkillCount(), 1);
    });

    test('registers skill with tools', () => {
      const tools = { lintCode: { execute: () => {} } };
      const skill = createMockSkill({ tools });
      registry.registerSkill(skill);

      assert.equal(registry.getSkill('code-review').tools, tools);
    });

    test('throws for null skill', () => {
      assert.throws(
        () => registry.registerSkill(null),
        err => {
          assert.equal(err.name, 'SkillRegistryError');
          assert.match(err.message, /non-null object/);
          assert.equal(err.operation, 'registerSkill');
          return true;
        }
      );
    });

    test('throws for array skill', () => {
      assert.throws(
        () => registry.registerSkill([]),
        err => {
          assert.equal(err.name, 'SkillRegistryError');
          assert.match(err.message, /non-null object/);
          return true;
        }
      );
    });

    test('throws for string skill', () => {
      assert.throws(
        () => registry.registerSkill('not-a-skill'),
        err => {
          assert.equal(err.name, 'SkillRegistryError');
          assert.match(err.message, /non-null object/);
          return true;
        }
      );
    });

    test('throws for skill without name', () => {
      assert.throws(
        () => registry.registerSkill({ description: 'test', instructions: '' }),
        err => {
          assert.equal(err.name, 'SkillRegistryError');
          assert.match(err.message, /non-empty string "name"/);
          return true;
        }
      );
    });

    test('throws for skill with empty name', () => {
      assert.throws(
        () => registry.registerSkill(createMockSkill({ name: '' })),
        err => {
          assert.equal(err.name, 'SkillRegistryError');
          assert.match(err.message, /non-empty string "name"/);
          return true;
        }
      );
    });

    test('throws for skill without description', () => {
      assert.throws(
        () => registry.registerSkill({ name: 'test', instructions: '' }),
        err => {
          assert.equal(err.name, 'SkillRegistryError');
          assert.match(err.message, /non-empty string "description"/);
          assert.equal(err.skillName, 'test');
          return true;
        }
      );
    });

    test('throws for skill without instructions field', () => {
      assert.throws(
        () => registry.registerSkill({ name: 'test', description: 'desc' }),
        err => {
          assert.equal(err.name, 'SkillRegistryError');
          assert.match(err.message, /string "instructions"/);
          assert.equal(err.skillName, 'test');
          return true;
        }
      );
    });
  });

  describe('getSkill()', () => {
    test('returns registered skill', () => {
      const registry = new SkillRegistry();
      const skill = createMockSkill();
      registry.registerSkill(skill);

      const result = registry.getSkill('code-review');

      assert.equal(result, skill);
    });

    test('returns undefined for unknown skill', () => {
      const registry = new SkillRegistry();

      assert.equal(registry.getSkill('nonexistent'), undefined);
    });
  });

  describe('listSkills()', () => {
    test('returns empty array when no skills registered', () => {
      const registry = new SkillRegistry();

      assert.deepEqual(registry.listSkills(), []);
    });

    test('returns all registered skills', () => {
      const registry = new SkillRegistry();
      const skill1 = createMockSkill({ name: 'skill-a' });
      const skill2 = createMockSkill({ name: 'skill-b', description: 'Second skill' });

      registry.registerSkill(skill1);
      registry.registerSkill(skill2);

      const list = registry.listSkills();
      assert.equal(list.length, 2);
      assert.ok(list.some(s => s.name === 'skill-a'));
      assert.ok(list.some(s => s.name === 'skill-b'));
    });
  });

  describe('hasSkill()', () => {
    test('returns true for registered skill', () => {
      const registry = new SkillRegistry();
      registry.registerSkill(createMockSkill());

      assert.equal(registry.hasSkill('code-review'), true);
    });

    test('returns false for unknown skill', () => {
      const registry = new SkillRegistry();

      assert.equal(registry.hasSkill('nonexistent'), false);
    });
  });

  describe('attachToBot()', () => {
    let registry;

    beforeEach(() => {
      registry = new SkillRegistry();
      registry.registerSkill(createMockSkill({ name: 'code-review' }));
      registry.registerSkill(createMockSkill({ name: 'deploy', description: 'Deploy apps' }));
    });

    test('attaches skills to a bot', () => {
      registry.attachToBot('work-bot', ['code-review', 'deploy']);

      const attached = registry.getAttachedSkills('work-bot');
      assert.deepEqual(attached, ['code-review', 'deploy']);
    });

    test('attaches single skill to bot', () => {
      registry.attachToBot('work-bot', ['code-review']);

      assert.deepEqual(registry.getAttachedSkills('work-bot'), ['code-review']);
    });

    test('attaches empty skill list', () => {
      registry.attachToBot('work-bot', []);

      assert.deepEqual(registry.getAttachedSkills('work-bot'), []);
    });

    test('replaces previous attachments', () => {
      registry.attachToBot('work-bot', ['code-review']);
      registry.attachToBot('work-bot', ['deploy']);

      assert.deepEqual(registry.getAttachedSkills('work-bot'), ['deploy']);
    });

    test('does not mutate input array', () => {
      const names = ['code-review'];
      registry.attachToBot('work-bot', names);

      names.push('deploy');
      assert.deepEqual(registry.getAttachedSkills('work-bot'), ['code-review']);
    });

    test('throws for invalid botId', () => {
      assert.throws(
        () => registry.attachToBot('', ['code-review']),
        err => {
          assert.equal(err.name, 'SkillRegistryError');
          assert.match(err.message, /Bot ID must be a non-empty string/);
          assert.equal(err.operation, 'attachToBot');
          return true;
        }
      );
    });

    test('throws for null botId', () => {
      assert.throws(
        () => registry.attachToBot(null, ['code-review']),
        err => {
          assert.equal(err.name, 'SkillRegistryError');
          assert.match(err.message, /Bot ID/);
          return true;
        }
      );
    });

    test('throws for non-array skillNames', () => {
      assert.throws(
        () => registry.attachToBot('work-bot', 'code-review'),
        err => {
          assert.equal(err.name, 'SkillRegistryError');
          assert.match(err.message, /Skill names must be an array/);
          assert.equal(err.botId, 'work-bot');
          return true;
        }
      );
    });

    test('throws for unknown skill name', () => {
      assert.throws(
        () => registry.attachToBot('work-bot', ['code-review', 'nonexistent']),
        err => {
          assert.equal(err.name, 'SkillRegistryError');
          assert.match(err.message, /Skills not found.*nonexistent/);
          assert.equal(err.botId, 'work-bot');
          assert.equal(err.skillName, 'nonexistent');
          return true;
        }
      );
    });

    test('throws listing multiple missing skills', () => {
      assert.throws(
        () => registry.attachToBot('work-bot', ['missing-a', 'missing-b']),
        err => {
          assert.match(err.message, /missing-a/);
          assert.match(err.message, /missing-b/);
          return true;
        }
      );
    });
  });

  describe('getAttachedSkills()', () => {
    test('returns empty array for bot with no skills', () => {
      const registry = new SkillRegistry();

      assert.deepEqual(registry.getAttachedSkills('unknown-bot'), []);
    });

    test('returns attached skill names', () => {
      const registry = new SkillRegistry();
      registry.registerSkill(createMockSkill({ name: 'code-review' }));
      registry.attachToBot('work-bot', ['code-review']);

      assert.deepEqual(registry.getAttachedSkills('work-bot'), ['code-review']);
    });
  });

  describe('detachFromBot()', () => {
    test('removes bot attachments', () => {
      const registry = new SkillRegistry();
      registry.registerSkill(createMockSkill());
      registry.attachToBot('work-bot', ['code-review']);

      const result = registry.detachFromBot('work-bot');

      assert.equal(result, true);
      assert.deepEqual(registry.getAttachedSkills('work-bot'), []);
    });

    test('returns false for bot with no attachments', () => {
      const registry = new SkillRegistry();

      assert.equal(registry.detachFromBot('unknown-bot'), false);
    });
  });

  describe('getSkillInstructions()', () => {
    let registry;

    beforeEach(() => {
      registry = new SkillRegistry();
      registry.registerSkill(
        createMockSkill({
          name: 'code-review',
          instructions: 'Review code carefully.',
        })
      );
      registry.registerSkill(
        createMockSkill({
          name: 'deploy',
          description: 'Deploy apps',
          instructions: 'Deploy to production safely.',
        })
      );
    });

    test('returns merged instructions for multiple skills', () => {
      const result = registry.getSkillInstructions(['code-review', 'deploy']);

      assert.equal(result, 'Review code carefully.\n\nDeploy to production safely.');
    });

    test('returns single skill instructions', () => {
      const result = registry.getSkillInstructions(['code-review']);

      assert.equal(result, 'Review code carefully.');
    });

    test('returns empty string for empty array', () => {
      assert.equal(registry.getSkillInstructions([]), '');
    });

    test('returns empty string for non-array input', () => {
      assert.equal(registry.getSkillInstructions('code-review'), '');
    });

    test('skips unknown skills and logs warning', () => {
      const { fn, messages } = createMockLogger();
      const reg = new SkillRegistry({ logger: fn });
      reg.registerSkill(createMockSkill({ name: 'code-review', instructions: 'Review.' }));

      const result = reg.getSkillInstructions(['code-review', 'nonexistent']);

      assert.equal(result, 'Review.');
      assert.ok(messages.some(m => m.includes('nonexistent') && m.includes('not found')));
    });

    test('skips skills with empty instructions', () => {
      registry.registerSkill(
        createMockSkill({ name: 'empty-skill', description: 'Empty', instructions: '' })
      );

      const result = registry.getSkillInstructions(['code-review', 'empty-skill']);

      assert.equal(result, 'Review code carefully.');
    });
  });

  describe('getSkillTools()', () => {
    test('returns merged tools from skills', () => {
      const registry = new SkillRegistry();
      const toolA = { execute: () => 'a' };
      const toolB = { execute: () => 'b' };

      registry.registerSkill(createMockSkill({ name: 'skill-a', tools: { toolA } }));
      registry.registerSkill(
        createMockSkill({ name: 'skill-b', description: 'B', tools: { toolB } })
      );

      const result = registry.getSkillTools(['skill-a', 'skill-b']);

      assert.equal(result.toolA, toolA);
      assert.equal(result.toolB, toolB);
    });

    test('returns empty object for skills without tools', () => {
      const registry = new SkillRegistry();
      registry.registerSkill(createMockSkill({ tools: null }));

      const result = registry.getSkillTools(['code-review']);

      assert.deepEqual(result, {});
    });

    test('returns empty object for non-array input', () => {
      const registry = new SkillRegistry();

      assert.deepEqual(registry.getSkillTools('not-array'), {});
    });

    test('later skills override earlier tools with same key', () => {
      const registry = new SkillRegistry();
      const toolV1 = { version: 1 };
      const toolV2 = { version: 2 };

      registry.registerSkill(createMockSkill({ name: 'skill-a', tools: { sharedTool: toolV1 } }));
      registry.registerSkill(
        createMockSkill({ name: 'skill-b', description: 'B', tools: { sharedTool: toolV2 } })
      );

      const result = registry.getSkillTools(['skill-a', 'skill-b']);

      assert.equal(result.sharedTool, toolV2);
    });

    test('returns empty object for empty array', () => {
      const registry = new SkillRegistry();

      assert.deepEqual(registry.getSkillTools([]), {});
    });
  });

  describe('removeSkill()', () => {
    test('removes a registered skill', () => {
      const registry = new SkillRegistry();
      registry.registerSkill(createMockSkill());

      const result = registry.removeSkill('code-review');

      assert.equal(result, true);
      assert.equal(registry.getSkillCount(), 0);
      assert.equal(registry.getSkill('code-review'), undefined);
    });

    test('returns false for unknown skill', () => {
      const registry = new SkillRegistry();

      assert.equal(registry.removeSkill('nonexistent'), false);
    });

    test('removes skill from bot attachments', () => {
      const registry = new SkillRegistry();
      registry.registerSkill(createMockSkill({ name: 'code-review' }));
      registry.registerSkill(createMockSkill({ name: 'deploy', description: 'Deploy' }));
      registry.attachToBot('work-bot', ['code-review', 'deploy']);

      registry.removeSkill('code-review');

      assert.deepEqual(registry.getAttachedSkills('work-bot'), ['deploy']);
    });

    test('removes bot entry when last skill is removed', () => {
      const registry = new SkillRegistry();
      registry.registerSkill(createMockSkill());
      registry.attachToBot('work-bot', ['code-review']);

      registry.removeSkill('code-review');

      assert.deepEqual(registry.getAttachedSkills('work-bot'), []);
    });
  });

  describe('clear()', () => {
    test('clears all skills and attachments', () => {
      const registry = new SkillRegistry();
      registry.registerSkill(createMockSkill({ name: 'skill-a' }));
      registry.registerSkill(createMockSkill({ name: 'skill-b', description: 'B' }));
      registry.attachToBot('bot-1', ['skill-a']);

      registry.clear();

      assert.equal(registry.getSkillCount(), 0);
      assert.deepEqual(registry.listSkills(), []);
      assert.deepEqual(registry.getAttachedSkills('bot-1'), []);
    });
  });

  describe('getSkillCount()', () => {
    test('returns 0 for empty registry', () => {
      const registry = new SkillRegistry();
      assert.equal(registry.getSkillCount(), 0);
    });

    test('returns correct count after registrations', () => {
      const registry = new SkillRegistry();
      registry.registerSkill(createMockSkill({ name: 'a' }));
      registry.registerSkill(createMockSkill({ name: 'b', description: 'B' }));

      assert.equal(registry.getSkillCount(), 2);
    });

    test('returns correct count after removal', () => {
      const registry = new SkillRegistry();
      registry.registerSkill(createMockSkill({ name: 'a' }));
      registry.registerSkill(createMockSkill({ name: 'b', description: 'B' }));
      registry.removeSkill('a');

      assert.equal(registry.getSkillCount(), 1);
    });
  });
});

describe('SkillRegistryError', () => {
  test('is an instance of Error', () => {
    const error = new SkillRegistryError('Test error');
    assert.ok(error instanceof Error);
  });

  test('has correct name', () => {
    const error = new SkillRegistryError('Test error');
    assert.equal(error.name, 'SkillRegistryError');
  });

  test('stores operation', () => {
    const error = new SkillRegistryError('Test error', { operation: 'registerSkill' });
    assert.equal(error.operation, 'registerSkill');
  });

  test('stores skillName', () => {
    const error = new SkillRegistryError('Test error', { skillName: 'code-review' });
    assert.equal(error.skillName, 'code-review');
  });

  test('stores botId', () => {
    const error = new SkillRegistryError('Test error', { botId: 'work-bot' });
    assert.equal(error.botId, 'work-bot');
  });

  test('stores cause', () => {
    const cause = new Error('Original');
    const error = new SkillRegistryError('Test error', { cause });
    assert.equal(error.cause, cause);
  });

  test('defaults optional properties to undefined', () => {
    const error = new SkillRegistryError('Test error');
    assert.equal(error.operation, undefined);
    assert.equal(error.skillName, undefined);
    assert.equal(error.botId, undefined);
    assert.equal(error.cause, undefined);
  });
});
