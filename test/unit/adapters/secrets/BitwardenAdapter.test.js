/**
 * BitwardenAdapter Tests
 *
 * Tests for the Bitwarden secret adapter stub
 */

import { strict as assert } from 'assert';
import { describe, it, beforeEach } from 'node:test';
import {
  BitwardenAdapter,
  BitwardenAdapterError,
} from '../../../../src/adapters/secrets/bitwarden.js';

describe('BitwardenAdapter', () => {
  let adapter;

  beforeEach(() => {
    adapter = new BitwardenAdapter();
  });

  describe('initialize', () => {
    it('should throw BitwardenAdapterError', async () => {
      await assert.rejects(
        () => adapter.initialize({ accessToken: 'test-token' }),
        err => {
          assert.ok(err instanceof BitwardenAdapterError);
          assert.equal(err.name, 'BitwardenAdapterError');
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
    it('should throw BitwardenAdapterError', async () => {
      await assert.rejects(
        () => adapter.getSecret('my-secret-id'),
        err => {
          assert.ok(err instanceof BitwardenAdapterError);
          assert.equal(err.name, 'BitwardenAdapterError');
          assert.match(err.message, /not implemented/i);
          assert.equal(err.operation, 'getSecret');
          assert.equal(err.reason, 'stub adapter');
          return true;
        }
      );
    });
  });
});

describe('BitwardenAdapterError', () => {
  it('should be an instance of Error', () => {
    const error = new BitwardenAdapterError('test error');
    assert.ok(error instanceof Error);
    assert.equal(error.name, 'BitwardenAdapterError');
    assert.equal(error.message, 'test error');
  });

  it('should store operation and reason', () => {
    const error = new BitwardenAdapterError('failed', {
      operation: 'getSecret',
      reason: 'test reason',
    });
    assert.equal(error.operation, 'getSecret');
    assert.equal(error.reason, 'test reason');
  });

  it('should store cause', () => {
    const cause = new Error('original');
    const error = new BitwardenAdapterError('wrapped', { cause });
    assert.equal(error.cause, cause);
  });

  it('should default optional fields to undefined', () => {
    const error = new BitwardenAdapterError('minimal');
    assert.equal(error.operation, undefined);
    assert.equal(error.reason, undefined);
    assert.equal(error.cause, undefined);
  });
});
