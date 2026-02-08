/**
 * RESTAdapter Tests
 *
 * Tests for the REST channel adapter stub
 */

import { strict as assert } from 'assert';
import { describe, it, beforeEach } from 'node:test';
import { RESTAdapter, RESTAdapterError } from '../../../../src/adapters/channels/rest.js';

describe('RESTAdapter', () => {
  let adapter;

  beforeEach(() => {
    adapter = new RESTAdapter();
  });

  describe('initialize', () => {
    it('should throw RESTAdapterError', async () => {
      await assert.rejects(
        () => adapter.initialize({ port: 3000 }),
        err => {
          assert.ok(err instanceof RESTAdapterError);
          assert.equal(err.name, 'RESTAdapterError');
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
          assert.match(err.message, /docs\/idea\/09-channels\.md/);
          return true;
        }
      );
    });
  });

  describe('sendMessage', () => {
    it('should throw RESTAdapterError', async () => {
      await assert.rejects(
        () => adapter.sendMessage('session-123', 'hello'),
        err => {
          assert.ok(err instanceof RESTAdapterError);
          assert.equal(err.name, 'RESTAdapterError');
          assert.match(err.message, /not implemented/i);
          assert.equal(err.operation, 'sendMessage');
          assert.equal(err.reason, 'stub adapter');
          return true;
        }
      );
    });
  });

  describe('handleRequest', () => {
    it('should throw RESTAdapterError', async () => {
      await assert.rejects(
        () => adapter.handleRequest({}, {}),
        err => {
          assert.ok(err instanceof RESTAdapterError);
          assert.equal(err.name, 'RESTAdapterError');
          assert.match(err.message, /not implemented/i);
          assert.equal(err.operation, 'handleRequest');
          assert.equal(err.reason, 'stub adapter');
          return true;
        }
      );
    });
  });
});

describe('RESTAdapterError', () => {
  it('should be an instance of Error', () => {
    const error = new RESTAdapterError('test error');
    assert.ok(error instanceof Error);
    assert.equal(error.name, 'RESTAdapterError');
    assert.equal(error.message, 'test error');
  });

  it('should store operation and reason', () => {
    const error = new RESTAdapterError('failed', {
      operation: 'initialize',
      reason: 'test reason',
    });
    assert.equal(error.operation, 'initialize');
    assert.equal(error.reason, 'test reason');
  });

  it('should store cause', () => {
    const cause = new Error('original');
    const error = new RESTAdapterError('wrapped', { cause });
    assert.equal(error.cause, cause);
  });

  it('should default optional fields to undefined', () => {
    const error = new RESTAdapterError('minimal');
    assert.equal(error.operation, undefined);
    assert.equal(error.reason, undefined);
    assert.equal(error.cause, undefined);
  });
});
