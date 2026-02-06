/**
 * ReferenceParser Tests
 *
 * Tests for secret reference pattern parsing
 */

import { strict as assert } from 'assert';
import { describe, it } from 'node:test';
import { ReferenceParser, ReferenceParserError } from '../../../src/secrets/reference-parser.js';

describe('ReferenceParser', () => {
  const parser = new ReferenceParser();

  describe('parse', () => {
    describe('plain environment variable references', () => {
      it('should parse a simple variable name', () => {
        const ref = parser.parse('MY_VAR');
        assert.equal(ref.adapter, 'env');
        assert.equal(ref.key, 'MY_VAR');
        assert.equal(ref.raw, '${MY_VAR}');
        assert.equal(ref.defaultValue, undefined);
        assert.equal(ref.conditionalValue, undefined);
      });

      it('should parse variable names with numbers and underscores', () => {
        const ref = parser.parse('API_KEY_V2');
        assert.equal(ref.adapter, 'env');
        assert.equal(ref.key, 'API_KEY_V2');
      });
    });

    describe('environment variable with default value (:-)', () => {
      it('should parse variable with default value', () => {
        const ref = parser.parse('MY_VAR:-fallback');
        assert.equal(ref.adapter, 'env');
        assert.equal(ref.key, 'MY_VAR');
        assert.equal(ref.defaultValue, 'fallback');
        assert.equal(ref.conditionalValue, undefined);
      });

      it('should handle empty default value', () => {
        const ref = parser.parse('MY_VAR:-');
        assert.equal(ref.adapter, 'env');
        assert.equal(ref.key, 'MY_VAR');
        assert.equal(ref.defaultValue, '');
      });

      it('should handle default with colons', () => {
        const ref = parser.parse('DB_URL:-postgresql://localhost:5432/db');
        assert.equal(ref.adapter, 'env');
        assert.equal(ref.key, 'DB_URL');
        assert.equal(ref.defaultValue, 'postgresql://localhost:5432/db');
      });
    });

    describe('environment variable with conditional value (:+)', () => {
      it('should parse variable with conditional value', () => {
        const ref = parser.parse('FLAG:+enabled');
        assert.equal(ref.adapter, 'env');
        assert.equal(ref.key, 'FLAG');
        assert.equal(ref.conditionalValue, 'enabled');
        assert.equal(ref.defaultValue, undefined);
      });

      it('should handle empty conditional value', () => {
        const ref = parser.parse('FLAG:+');
        assert.equal(ref.adapter, 'env');
        assert.equal(ref.key, 'FLAG');
        assert.equal(ref.conditionalValue, '');
      });
    });

    describe('adapter-prefixed references', () => {
      it('should parse Bitwarden reference', () => {
        const ref = parser.parse('bw:prod/slack-token');
        assert.equal(ref.adapter, 'bitwarden');
        assert.equal(ref.key, 'prod/slack-token');
        assert.equal(ref.raw, '${bw:prod/slack-token}');
      });

      it('should parse 1Password reference', () => {
        const ref = parser.parse('1p:vault/api-key');
        assert.equal(ref.adapter, 'onepassword');
        assert.equal(ref.key, 'vault/api-key');
        assert.equal(ref.raw, '${1p:vault/api-key}');
      });

      it('should handle keys with multiple path segments', () => {
        const ref = parser.parse('bw:org/project/secret-name');
        assert.equal(ref.adapter, 'bitwarden');
        assert.equal(ref.key, 'org/project/secret-name');
      });

      it('should have no default or conditional value for adapter refs', () => {
        const ref = parser.parse('bw:vault/item');
        assert.equal(ref.defaultValue, undefined);
        assert.equal(ref.conditionalValue, undefined);
      });
    });

    describe('error cases', () => {
      it('should throw for empty string', () => {
        assert.throws(
          () => parser.parse(''),
          err => {
            assert.ok(err instanceof ReferenceParserError);
            assert.equal(err.name, 'ReferenceParserError');
            assert.match(err.message, /non-empty string/);
            return true;
          }
        );
      });

      it('should throw for null', () => {
        assert.throws(
          () => parser.parse(null),
          err => {
            assert.ok(err instanceof ReferenceParserError);
            return true;
          }
        );
      });

      it('should throw for undefined', () => {
        assert.throws(
          () => parser.parse(undefined),
          err => {
            assert.ok(err instanceof ReferenceParserError);
            return true;
          }
        );
      });

      it('should throw for whitespace-only string', () => {
        assert.throws(
          () => parser.parse('   '),
          err => {
            assert.ok(err instanceof ReferenceParserError);
            return true;
          }
        );
      });
    });
  });

  describe('extractReferences', () => {
    it('should extract a single reference from a string', () => {
      const refs = parser.extractReferences('${MY_VAR}');
      assert.equal(refs.length, 1);
      assert.equal(refs[0].adapter, 'env');
      assert.equal(refs[0].key, 'MY_VAR');
    });

    it('should extract multiple references from a string', () => {
      const refs = parser.extractReferences('https://${USER}:${PASS}@host');
      assert.equal(refs.length, 2);
      assert.equal(refs[0].key, 'USER');
      assert.equal(refs[1].key, 'PASS');
    });

    it('should extract adapter-prefixed references', () => {
      const refs = parser.extractReferences('key=${bw:vault/secret}');
      assert.equal(refs.length, 1);
      assert.equal(refs[0].adapter, 'bitwarden');
      assert.equal(refs[0].key, 'vault/secret');
    });

    it('should extract mixed adapter references', () => {
      const refs = parser.extractReferences('${ENV_VAR} and ${bw:vault/item} and ${1p:vault/key}');
      assert.equal(refs.length, 3);
      assert.equal(refs[0].adapter, 'env');
      assert.equal(refs[1].adapter, 'bitwarden');
      assert.equal(refs[2].adapter, 'onepassword');
    });

    it('should return empty array for string without references', () => {
      const refs = parser.extractReferences('no references here');
      assert.deepEqual(refs, []);
    });

    it('should return empty array for non-string input', () => {
      assert.deepEqual(parser.extractReferences(123), []);
      assert.deepEqual(parser.extractReferences(null), []);
      assert.deepEqual(parser.extractReferences(undefined), []);
    });

    it('should handle reference with default value', () => {
      const refs = parser.extractReferences('${PORT:-3000}');
      assert.equal(refs.length, 1);
      assert.equal(refs[0].key, 'PORT');
      assert.equal(refs[0].defaultValue, '3000');
    });
  });

  describe('hasReferences', () => {
    it('should return true when string contains a reference', () => {
      assert.equal(parser.hasReferences('${MY_VAR}'), true);
    });

    it('should return true for embedded reference', () => {
      assert.equal(parser.hasReferences('prefix-${VAR}-suffix'), true);
    });

    it('should return false for plain string', () => {
      assert.equal(parser.hasReferences('no references'), false);
    });

    it('should return false for non-string input', () => {
      assert.equal(parser.hasReferences(42), false);
      assert.equal(parser.hasReferences(null), false);
      assert.equal(parser.hasReferences(undefined), false);
    });

    it('should return false for empty string', () => {
      assert.equal(parser.hasReferences(''), false);
    });

    it('should return false for incomplete pattern', () => {
      assert.equal(parser.hasReferences('$VAR'), false);
      assert.equal(parser.hasReferences('${'), false);
    });
  });

  describe('extractAllReferences', () => {
    it('should extract references from nested objects', () => {
      const config = {
        api: {
          key: '${API_KEY}',
          secret: '${bw:prod/api-secret}',
        },
        db: {
          url: '${DATABASE_URL:-postgresql://localhost/db}',
        },
      };

      const refs = parser.extractAllReferences(config);
      assert.equal(refs.length, 3);

      const adapters = refs.map(r => r.adapter);
      assert.ok(adapters.includes('env'));
      assert.ok(adapters.includes('bitwarden'));
    });

    it('should extract references from arrays', () => {
      const config = ['${VAR1}', '${VAR2}', 'plain-string'];
      const refs = parser.extractAllReferences(config);
      assert.equal(refs.length, 2);
    });

    it('should handle deeply nested structures', () => {
      const config = {
        level1: {
          level2: {
            level3: {
              secret: '${DEEP_SECRET}',
            },
          },
        },
      };

      const refs = parser.extractAllReferences(config);
      assert.equal(refs.length, 1);
      assert.equal(refs[0].key, 'DEEP_SECRET');
    });

    it('should return empty array for primitives', () => {
      assert.deepEqual(parser.extractAllReferences(42), []);
      assert.deepEqual(parser.extractAllReferences(true), []);
      assert.deepEqual(parser.extractAllReferences(null), []);
    });

    it('should handle mixed content arrays', () => {
      const config = [42, '${VAR}', null, { key: '${OTHER}' }];
      const refs = parser.extractAllReferences(config);
      assert.equal(refs.length, 2);
    });
  });

  describe('getAdapterPrefixes', () => {
    it('should return known adapter prefixes', () => {
      const prefixes = parser.getAdapterPrefixes();
      assert.equal(prefixes.bw, 'bitwarden');
      assert.equal(prefixes['1p'], 'onepassword');
    });

    it('should return a frozen object', () => {
      const prefixes = parser.getAdapterPrefixes();
      assert.ok(Object.isFrozen(prefixes));
    });
  });

  describe('ReferenceParserError', () => {
    it('should be an Error instance', () => {
      const err = new ReferenceParserError('test');
      assert.ok(err instanceof Error);
      assert.ok(err instanceof ReferenceParserError);
    });

    it('should have correct name', () => {
      const err = new ReferenceParserError('test');
      assert.equal(err.name, 'ReferenceParserError');
    });

    it('should store reference option', () => {
      const err = new ReferenceParserError('test', { reference: '${bad}' });
      assert.equal(err.reference, '${bad}');
    });

    it('should store cause option', () => {
      const cause = new Error('original');
      const err = new ReferenceParserError('wrapper', { cause });
      assert.equal(err.cause, cause);
    });
  });
});
