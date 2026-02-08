/**
 * OnePasswordAdapter Tests
 *
 * Tests for the 1Password secret adapter stub
 */

import { strict as assert } from 'assert';
import { describe, it, beforeEach } from 'node:test';
import {
  OnePasswordAdapter,
  OnePasswordAdapterError,
} from '../../../../src/adapters/secrets/onepassword.js';

describe('OnePasswordAdapter', () => {
  let adapter;

  beforeEach(() => {
    adapter = new OnePasswordAdapter();
  });

  describe('initialize', () => {
    it('should throw OnePasswordAdapterError', async () => {
      await assert.rejects(
        () => adapter.initialize({ serviceAccountToken: 'test-token' }),
        err => {
          assert.ok(err instanceof OnePasswordAdapterError);
          assert.equal(err.name, 'OnePasswordAdapterError');
          assert.match(err.message, /not implemented/i);
          assert.equal(err.operation, 'initialize');
          assert.equal(err.reason, 'stub adapter');
          return true;
        }
      );
    });

    it('should include contributing guidance in message', async () => {
      await assert.rejects(
        () => adapter.initialize({}),
        err => {
          assert.match(err.message, /src\/adapters\/secrets\/env\.js/);
          return true;
        }
      );
    });
  });

  describe('getSecret', () => {
    it('should throw OnePasswordAdapterError', async () => {
      await assert.rejects(
        () => adapter.getSecret('op://vault/item/field'),
        err => {
          assert.ok(err instanceof OnePasswordAdapterError);
          assert.equal(err.name, 'OnePasswordAdapterError');
          assert.match(err.message, /not implemented/i);
          assert.equal(err.operation, 'getSecret');
          assert.equal(err.reason, 'stub adapter');
          return true;
        }
      );
    });
  });
});

describe('OnePasswordAdapterError', () => {
  it('should be an instance of Error', () => {
    const error = new OnePasswordAdapterError('test error');
    assert.ok(error instanceof Error);
    assert.equal(error.name, 'OnePasswordAdapterError');
    assert.equal(error.message, 'test error');
  });

  it('should store operation and reason', () => {
    const error = new OnePasswordAdapterError('failed', {
      operation: 'getSecret',
      reason: 'test reason',
    });
    assert.equal(error.operation, 'getSecret');
    assert.equal(error.reason, 'test reason');
  });

  it('should store cause', () => {
    const cause = new Error('original');
    const error = new OnePasswordAdapterError('wrapped', { cause });
    assert.equal(error.cause, cause);
  });

  it('should default optional fields to undefined', () => {
    const error = new OnePasswordAdapterError('minimal');
    assert.equal(error.operation, undefined);
    assert.equal(error.reason, undefined);
    assert.equal(error.cause, undefined);
  });
});
