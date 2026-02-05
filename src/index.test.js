/**
 * Tests for main exports
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { Orchestrator } from './index.js';

test('Orchestrator exports correctly', () => {
  assert.ok(Orchestrator, 'Orchestrator should be exported');
  assert.strictEqual(typeof Orchestrator, 'function', 'Orchestrator should be a class');
});

test('Orchestrator can be instantiated', () => {
  const orchestrator = new Orchestrator();
  assert.ok(orchestrator, 'Orchestrator should instantiate');
  assert.ok(orchestrator.start, 'Orchestrator should have start method');
  assert.ok(orchestrator.stop, 'Orchestrator should have stop method');
});
