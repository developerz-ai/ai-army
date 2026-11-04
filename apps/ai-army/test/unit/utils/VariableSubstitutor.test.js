/**
 * Unit tests for VariableSubstitutor
 *
 * Tests {{varName}} placeholder substitution in strings and
 * deep object traversal for config variable replacement.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  VariableSubstitutor,
  VariableSubstitutorError,
} from '../../../src/utils/VariableSubstitutor.js';

describe('VariableSubstitutor', () => {
  let substitutor;

  const createSubstitutor = () => new VariableSubstitutor();

  describe('substitute()', () => {
    test('replaces a single variable', () => {
      substitutor = createSubstitutor();
      const result = substitutor.substitute('Hello {{name}}!', { name: 'World' });
      assert.equal(result, 'Hello World!');
    });

    test('replaces multiple variables', () => {
      substitutor = createSubstitutor();
      const result = substitutor.substitute('{{greeting}} {{name}}, welcome to {{place}}!', {
        greeting: 'Hello',
        name: 'Alice',
        place: 'Wonderland',
      });
      assert.equal(result, 'Hello Alice, welcome to Wonderland!');
    });

    test('replaces same variable multiple times', () => {
      substitutor = createSubstitutor();
      const result = substitutor.substitute('{{x}} and {{x}} again', { x: 'test' });
      assert.equal(result, 'test and test again');
    });

    test('leaves unknown variables unchanged', () => {
      substitutor = createSubstitutor();
      const result = substitutor.substitute('Hello {{unknown}}!', { name: 'World' });
      assert.equal(result, 'Hello {{unknown}}!');
    });

    test('returns empty string when text is empty', () => {
      substitutor = createSubstitutor();
      const result = substitutor.substitute('', { name: 'World' });
      assert.equal(result, '');
    });

    test('returns text unchanged when no placeholders exist', () => {
      substitutor = createSubstitutor();
      const result = substitutor.substitute('No placeholders here', { name: 'World' });
      assert.equal(result, 'No placeholders here');
    });

    test('returns text unchanged when variables is empty', () => {
      substitutor = createSubstitutor();
      const result = substitutor.substitute('Hello {{name}}!', {});
      assert.equal(result, 'Hello {{name}}!');
    });

    test('converts non-string variable values to strings', () => {
      substitutor = createSubstitutor();
      const result = substitutor.substitute('Count: {{count}}, Active: {{active}}', {
        count: 42,
        active: true,
      });
      assert.equal(result, 'Count: 42, Active: true');
    });

    test('leaves placeholder unchanged when variable value is null', () => {
      substitutor = createSubstitutor();
      const result = substitutor.substitute('Hello {{name}}!', { name: null });
      assert.equal(result, 'Hello {{name}}!');
    });

    test('leaves placeholder unchanged when variable value is undefined', () => {
      substitutor = createSubstitutor();
      const result = substitutor.substitute('Hello {{name}}!', { name: undefined });
      assert.equal(result, 'Hello {{name}}!');
    });

    test('does not match single-brace syntax {varName}', () => {
      substitutor = createSubstitutor();
      const result = substitutor.substitute('Hello {name}!', { name: 'World' });
      assert.equal(result, 'Hello {name}!');
    });

    test('does not match env var syntax ${VAR}', () => {
      substitutor = createSubstitutor();
      const result = substitutor.substitute('Token: ${API_KEY}', { API_KEY: 'secret' });
      assert.equal(result, 'Token: ${API_KEY}');
    });

    test('handles adjacent placeholders', () => {
      substitutor = createSubstitutor();
      const result = substitutor.substitute('{{a}}{{b}}', { a: 'X', b: 'Y' });
      assert.equal(result, 'XY');
    });

    test('throws VariableSubstitutorError when text is not a string', () => {
      substitutor = createSubstitutor();
      assert.throws(
        () => substitutor.substitute(123, { name: 'World' }),
        err => {
          assert.equal(err.name, 'VariableSubstitutorError');
          assert.match(err.message, /Text must be a string/);
          assert.equal(err.operation, 'substitute');
          return true;
        }
      );
    });

    test('throws VariableSubstitutorError when text is null', () => {
      substitutor = createSubstitutor();
      assert.throws(
        () => substitutor.substitute(null, {}),
        err => {
          assert.equal(err.name, 'VariableSubstitutorError');
          return true;
        }
      );
    });

    test('throws VariableSubstitutorError when variables is an array', () => {
      substitutor = createSubstitutor();
      assert.throws(
        () => substitutor.substitute('text', ['not', 'valid']),
        err => {
          assert.equal(err.name, 'VariableSubstitutorError');
          assert.match(err.message, /Variables must be a plain object/);
          return true;
        }
      );
    });

    test('throws VariableSubstitutorError when variables is null', () => {
      substitutor = createSubstitutor();
      assert.throws(
        () => substitutor.substitute('text', null),
        err => {
          assert.equal(err.name, 'VariableSubstitutorError');
          return true;
        }
      );
    });
  });

  describe('substituteDeep()', () => {
    test('substitutes variables in nested objects', () => {
      substitutor = createSubstitutor();
      const result = substitutor.substituteDeep(
        {
          name: '{{teamName}} Bot',
          channel: {
            type: 'slack',
            channelId: '{{slackChannel}}',
          },
        },
        { teamName: 'Engineering', slackChannel: 'C12345' }
      );

      assert.equal(result.name, 'Engineering Bot');
      assert.equal(result.channel.type, 'slack');
      assert.equal(result.channel.channelId, 'C12345');
    });

    test('substitutes variables in arrays', () => {
      substitutor = createSubstitutor();
      const result = substitutor.substituteDeep(
        { tags: ['{{env}}', 'bot', '{{team}}'] },
        { env: 'production', team: 'platform' }
      );

      assert.deepEqual(result.tags, ['production', 'bot', 'platform']);
    });

    test('passes through numbers unchanged', () => {
      substitutor = createSubstitutor();
      const result = substitutor.substituteDeep({ count: 42, name: '{{name}}' }, { name: 'bot' });
      assert.equal(result.count, 42);
      assert.equal(result.name, 'bot');
    });

    test('passes through booleans unchanged', () => {
      substitutor = createSubstitutor();
      const result = substitutor.substituteDeep(
        { active: true, label: '{{label}}' },
        { label: 'test' }
      );
      assert.equal(result.active, true);
      assert.equal(result.label, 'test');
    });

    test('passes through null unchanged', () => {
      substitutor = createSubstitutor();
      const result = substitutor.substituteDeep({ value: null, name: '{{name}}' }, { name: 'bot' });
      assert.equal(result.value, null);
      assert.equal(result.name, 'bot');
    });

    test('substitutes a plain string value', () => {
      substitutor = createSubstitutor();
      const result = substitutor.substituteDeep('Hello {{name}}', { name: 'World' });
      assert.equal(result, 'Hello World');
    });

    test('returns primitive values unchanged', () => {
      substitutor = createSubstitutor();
      assert.equal(substitutor.substituteDeep(42, {}), 42);
      assert.equal(substitutor.substituteDeep(true, {}), true);
      assert.equal(substitutor.substituteDeep(null, {}), null);
      assert.equal(substitutor.substituteDeep(undefined, {}), undefined);
    });

    test('does not mutate the input object', () => {
      substitutor = createSubstitutor();
      const input = { name: '{{name}}', nested: { value: '{{value}}' } };
      substitutor.substituteDeep(input, { name: 'bot', value: 'test' });

      assert.equal(input.name, '{{name}}');
      assert.equal(input.nested.value, '{{value}}');
    });

    test('handles deeply nested structures', () => {
      substitutor = createSubstitutor();
      const result = substitutor.substituteDeep(
        { a: { b: { c: { d: '{{deep}}' } } } },
        { deep: 'found' }
      );
      assert.equal(result.a.b.c.d, 'found');
    });

    test('throws VariableSubstitutorError when variables is invalid', () => {
      substitutor = createSubstitutor();
      assert.throws(
        () => substitutor.substituteDeep({ name: '{{name}}' }, 'not-an-object'),
        err => {
          assert.equal(err.name, 'VariableSubstitutorError');
          assert.match(err.message, /Variables must be a plain object/);
          assert.equal(err.operation, 'substituteDeep');
          return true;
        }
      );
    });
  });

  describe('extractVariables()', () => {
    test('extracts variable names from text', () => {
      substitutor = createSubstitutor();
      const vars = substitutor.extractVariables('Hello {{name}}, welcome to {{place}}!');
      assert.deepEqual(vars, ['name', 'place']);
    });

    test('returns unique variable names', () => {
      substitutor = createSubstitutor();
      const vars = substitutor.extractVariables('{{x}} and {{x}} and {{y}}');
      assert.deepEqual(vars, ['x', 'y']);
    });

    test('returns empty array for text without placeholders', () => {
      substitutor = createSubstitutor();
      const vars = substitutor.extractVariables('No variables here');
      assert.deepEqual(vars, []);
    });

    test('returns empty array for empty string', () => {
      substitutor = createSubstitutor();
      const vars = substitutor.extractVariables('');
      assert.deepEqual(vars, []);
    });

    test('does not extract single-brace variables', () => {
      substitutor = createSubstitutor();
      const vars = substitutor.extractVariables('{singleBrace} and {{doubleBrace}}');
      assert.deepEqual(vars, ['doubleBrace']);
    });

    test('throws VariableSubstitutorError when text is not a string', () => {
      substitutor = createSubstitutor();
      assert.throws(
        () => substitutor.extractVariables(42),
        err => {
          assert.equal(err.name, 'VariableSubstitutorError');
          assert.equal(err.operation, 'extractVariables');
          return true;
        }
      );
    });
  });

  describe('getMissingVariables()', () => {
    test('returns missing variable names', () => {
      substitutor = createSubstitutor();
      const missing = substitutor.getMissingVariables('{{a}} {{b}} {{c}}', { a: 'x', c: 'z' });
      assert.deepEqual(missing, ['b']);
    });

    test('returns empty array when all variables provided', () => {
      substitutor = createSubstitutor();
      const missing = substitutor.getMissingVariables('{{name}}', { name: 'Bot' });
      assert.deepEqual(missing, []);
    });

    test('returns all variables when none provided', () => {
      substitutor = createSubstitutor();
      const missing = substitutor.getMissingVariables('{{a}} {{b}}', {});
      assert.deepEqual(missing, ['a', 'b']);
    });

    test('returns empty array for text without placeholders', () => {
      substitutor = createSubstitutor();
      const missing = substitutor.getMissingVariables('No variables', {});
      assert.deepEqual(missing, []);
    });
  });
});

describe('VariableSubstitutorError', () => {
  test('is an instance of Error', () => {
    const error = new VariableSubstitutorError('Test error');
    assert.ok(error instanceof Error);
  });

  test('has correct name', () => {
    const error = new VariableSubstitutorError('Test error');
    assert.equal(error.name, 'VariableSubstitutorError');
  });

  test('stores operation', () => {
    const error = new VariableSubstitutorError('Test', { operation: 'substitute' });
    assert.equal(error.operation, 'substitute');
  });

  test('stores variableName', () => {
    const error = new VariableSubstitutorError('Test', { variableName: 'teamName' });
    assert.equal(error.variableName, 'teamName');
  });

  test('stores cause', () => {
    const cause = new Error('Original');
    const error = new VariableSubstitutorError('Test', { cause });
    assert.equal(error.cause, cause);
  });
});
