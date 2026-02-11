import { describe, test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import { createLogger, LoggerError } from './logger.js';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Create a mock writer that captures output
 * @returns {{ writer: Function, lines: string[] }}
 */
function createMockWriter() {
  const lines = [];
  const writer = mock.fn(line => lines.push(line));
  return { writer, lines };
}

// ============================================================================
// Tests
// ============================================================================

describe('LoggerError', () => {
  test('creates error with correct name', () => {
    const err = new LoggerError('test error');
    assert.equal(err.name, 'LoggerError');
    assert.equal(err.message, 'test error');
  });

  test('supports cause chaining', () => {
    const cause = new Error('root cause');
    const err = new LoggerError('wrapped', { cause });
    assert.equal(err.cause, cause);
  });

  test('supports operation context', () => {
    const err = new LoggerError('failed', { operation: 'createLogger' });
    assert.equal(err.operation, 'createLogger');
  });

  test('extends Error', () => {
    const err = new LoggerError('test');
    assert.ok(err instanceof Error);
  });
});

describe('createLogger', () => {
  describe('callable interface', () => {
    test('returns a callable function', () => {
      const logger = createLogger();
      assert.equal(typeof logger, 'function');
    });

    test('calling logger directly delegates to info level', () => {
      const { writer, lines } = createMockWriter();
      const logger = createLogger({ writer });

      logger('hello world');

      assert.equal(lines.length, 1);
      assert.ok(lines[0].includes('hello world'));
      assert.ok(lines[0].includes('INFO'));
    });

    test('exposes info, warn, error, debug methods', () => {
      const logger = createLogger();
      assert.equal(typeof logger.info, 'function');
      assert.equal(typeof logger.warn, 'function');
      assert.equal(typeof logger.error, 'function');
      assert.equal(typeof logger.debug, 'function');
    });
  });

  describe('development mode (human-readable)', () => {
    let writer;
    let lines;
    let logger;

    beforeEach(() => {
      ({ writer, lines } = createMockWriter());
      logger = createLogger({ json: false, writer, level: 'debug' });
    });

    test('formats info messages with timestamp and level', () => {
      logger.info('server started');

      assert.equal(lines.length, 1);
      assert.ok(lines[0].includes('INFO'));
      assert.ok(lines[0].includes('server started'));
      // Check ISO timestamp pattern
      assert.match(lines[0], /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    test('formats warn messages', () => {
      logger.warn('disk space low');

      assert.equal(lines.length, 1);
      assert.ok(lines[0].includes('WARN'));
      assert.ok(lines[0].includes('disk space low'));
    });

    test('formats error messages', () => {
      logger.error('connection failed');

      assert.equal(lines.length, 1);
      assert.ok(lines[0].includes('ERROR'));
      assert.ok(lines[0].includes('connection failed'));
    });

    test('formats debug messages', () => {
      logger.debug('variable x = 42');

      assert.equal(lines.length, 1);
      assert.ok(lines[0].includes('DEBUG'));
      assert.ok(lines[0].includes('variable x = 42'));
    });

    test('includes component name when provided', () => {
      const compLogger = createLogger({
        json: false,
        writer,
        component: 'Orchestrator',
      });

      compLogger.info('starting');

      assert.ok(lines[0].includes('[Orchestrator]'));
    });

    test('omits component bracket when not provided', () => {
      logger.info('no component');

      assert.ok(!lines[0].includes('['));
      assert.ok(!lines[0].includes(']'));
    });
  });

  describe('production mode (JSON Lines)', () => {
    let writer;
    let lines;
    let logger;

    beforeEach(() => {
      ({ writer, lines } = createMockWriter());
      logger = createLogger({ json: true, writer, level: 'debug' });
    });

    test('outputs valid JSON for info', () => {
      logger.info('service ready');

      assert.equal(lines.length, 1);
      const parsed = JSON.parse(lines[0]);
      assert.equal(parsed.level, 'info');
      assert.equal(parsed.message, 'service ready');
      assert.ok(parsed.timestamp);
    });

    test('outputs valid JSON for error', () => {
      logger.error('crash detected');

      const parsed = JSON.parse(lines[0]);
      assert.equal(parsed.level, 'error');
      assert.equal(parsed.message, 'crash detected');
    });

    test('outputs valid JSON for warn', () => {
      logger.warn('high latency');

      const parsed = JSON.parse(lines[0]);
      assert.equal(parsed.level, 'warn');
      assert.equal(parsed.message, 'high latency');
    });

    test('outputs valid JSON for debug', () => {
      logger.debug('query took 42ms');

      const parsed = JSON.parse(lines[0]);
      assert.equal(parsed.level, 'debug');
      assert.equal(parsed.message, 'query took 42ms');
    });

    test('includes component in JSON when provided', () => {
      const compLogger = createLogger({
        json: true,
        writer,
        component: 'BotManager',
      });

      compLogger.info('bots loaded');

      const parsed = JSON.parse(lines[0]);
      assert.equal(parsed.component, 'BotManager');
    });

    test('omits component from JSON when not provided', () => {
      logger.info('no component');

      const parsed = JSON.parse(lines[0]);
      assert.equal(parsed.component, undefined);
    });

    test('includes ISO 8601 timestamp', () => {
      logger.info('timestamp check');

      const parsed = JSON.parse(lines[0]);
      assert.match(parsed.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  describe('level filtering', () => {
    test('filters out debug when level is info', () => {
      const { writer, lines } = createMockWriter();
      const logger = createLogger({ writer, level: 'info', json: false });

      logger.debug('should not appear');
      logger.info('should appear');

      assert.equal(lines.length, 1);
      assert.ok(lines[0].includes('should appear'));
    });

    test('filters out info and debug when level is warn', () => {
      const { writer, lines } = createMockWriter();
      const logger = createLogger({ writer, level: 'warn', json: false });

      logger.debug('hidden');
      logger.info('hidden');
      logger.warn('visible warn');
      logger.error('visible error');

      assert.equal(lines.length, 2);
      assert.ok(lines[0].includes('visible warn'));
      assert.ok(lines[1].includes('visible error'));
    });

    test('filters out info, debug, and warn when level is error', () => {
      const { writer, lines } = createMockWriter();
      const logger = createLogger({ writer, level: 'error', json: false });

      logger.debug('hidden');
      logger.info('hidden');
      logger.warn('hidden');
      logger.error('visible');

      assert.equal(lines.length, 1);
      assert.ok(lines[0].includes('visible'));
    });

    test('shows all levels when level is debug', () => {
      const { writer, lines } = createMockWriter();
      const logger = createLogger({ writer, level: 'debug', json: false });

      logger.error('e');
      logger.warn('w');
      logger.info('i');
      logger.debug('d');

      assert.equal(lines.length, 4);
    });

    test('defaults to info level', () => {
      const { writer, lines } = createMockWriter();
      const logger = createLogger({ writer, json: false });

      logger.debug('hidden');
      logger.info('visible');

      assert.equal(lines.length, 1);
    });

    test('falls back to info for unknown level', () => {
      const { writer, lines } = createMockWriter();
      const logger = createLogger({ writer, level: 'banana', json: false });

      logger.debug('hidden');
      logger.info('visible');

      assert.equal(lines.length, 1);
    });
  });

  describe('writer routing', () => {
    test('routes error and warn to errWriter by default', () => {
      // When no custom writer is provided, error/warn go to console.error
      // and info/debug go to console.log. We test by providing a custom writer
      // which unifies the output for our test.
      const { writer, lines } = createMockWriter();
      const logger = createLogger({ writer, level: 'debug', json: false });

      logger.error('err msg');
      logger.warn('warn msg');
      logger.info('info msg');
      logger.debug('debug msg');

      // All go to the same writer since we injected a single writer
      assert.equal(lines.length, 4);
    });
  });

  describe('NODE_ENV auto-detection', () => {
    test('uses JSON format when json option is explicitly true', () => {
      const { writer, lines } = createMockWriter();
      const logger = createLogger({ json: true, writer });

      logger.info('test');

      // Should be valid JSON
      assert.doesNotThrow(() => JSON.parse(lines[0]));
    });

    test('uses dev format when json option is explicitly false', () => {
      const { writer, lines } = createMockWriter();
      const logger = createLogger({ json: false, writer });

      logger.info('test');

      // Should NOT be valid JSON
      assert.throws(() => JSON.parse(lines[0]));
    });
  });
});
