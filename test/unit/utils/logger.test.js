/**
 * Unit tests for Logger utility
 *
 * Tests structured logging, dev mode output, production JSON output,
 * timestamp formatting, component tagging, and log level filtering.
 */

import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { createLogger, LoggerError } from '../../../src/utils/logger.js';

/**
 * Create a mock writable stream that captures output
 * @returns {{ stream: Writable, lines: string[] }} Mock stream and captured lines
 */
function createMockWritable() {
  const lines = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { stream, lines };
}

/**
 * Create a mock writer function that captures output
 * @returns {Function & { calls: string[] }} Writer function with calls array
 */
function createMockWriter() {
  const calls = [];
  const fn = mock.fn(msg => calls.push(msg));
  fn.calls = calls;
  return fn;
}

/**
 * Parse ISO 8601 timestamp and verify it's valid
 * @param {string} timestamp - Timestamp string
 * @returns {Date} Parsed date
 */
function parseTimestamp(timestamp) {
  const date = new Date(timestamp);
  assert.ok(!isNaN(date.getTime()), 'Timestamp should be valid ISO 8601');
  return date;
}

/**
 * Extract timestamp from dev mode output line
 * @param {string} line - Log line
 * @returns {string} Extracted timestamp
 */
function extractDevTimestamp(line) {
  const match = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/);
  assert.ok(match, `Line should start with ISO timestamp: ${line}`);
  return match[1];
}

describe('Logger', () => {
  let originalEnv;

  beforeEach(() => {
    // Save original NODE_ENV
    originalEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    // Restore NODE_ENV after each test
    process.env.NODE_ENV = originalEnv;
  });

  // ========================================================================
  // LoggerError
  // ========================================================================

  describe('LoggerError', () => {
    test('creates error with message', () => {
      const err = new LoggerError('Logger configuration failed');
      assert.equal(err.message, 'Logger configuration failed');
      assert.equal(err.name, 'LoggerError');
      assert.ok(err instanceof Error);
    });

    test('creates error with cause and operation', () => {
      const cause = new Error('underlying failure');
      const err = new LoggerError('Failed to create logger', {
        cause,
        operation: 'createLogger',
      });
      assert.equal(err.cause, cause);
      assert.equal(err.operation, 'createLogger');
    });

    test('defaults operation to undefined', () => {
      const err = new LoggerError('test error');
      assert.equal(err.operation, undefined);
    });
  });

  // ========================================================================
  // Development mode output (human-readable)
  // ========================================================================

  describe('dev mode output', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';
    });

    test('formats log with timestamp, level prefix, and message', () => {
      const writer = createMockWriter();
      const logger = createLogger({ writer });

      logger.info('Starting application');

      assert.equal(writer.calls.length, 1);
      const line = writer.calls[0];
      const timestamp = extractDevTimestamp(line);
      parseTimestamp(timestamp); // Validate ISO 8601

      assert.ok(line.includes('INFO'));
      assert.ok(line.includes('Starting application'));
      assert.match(line, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z INFO Starting application$/);
    });

    test('includes component tag when provided', () => {
      const writer = createMockWriter();
      const logger = createLogger({ component: 'Orchestrator', writer });

      logger.info('Bot started');

      assert.equal(writer.calls.length, 1);
      assert.ok(writer.calls[0].includes('[Orchestrator]'));
      assert.match(
        writer.calls[0],
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z INFO \[Orchestrator\] Bot started$/
      );
    });

    test('formats error level with ERROR prefix', () => {
      const writer = createMockWriter();
      const logger = createLogger({ writer });

      logger.error('Connection failed');

      assert.equal(writer.calls.length, 1);
      assert.ok(writer.calls[0].includes('ERROR'));
      assert.ok(writer.calls[0].includes('Connection failed'));
    });

    test('formats warn level with WARN prefix', () => {
      const writer = createMockWriter();
      const logger = createLogger({ writer });

      logger.warn('Deprecated API usage');

      assert.equal(writer.calls.length, 1);
      assert.ok(writer.calls[0].includes('WARN'));
      assert.ok(writer.calls[0].includes('Deprecated API usage'));
    });

    test('formats debug level with DEBUG prefix', () => {
      const writer = createMockWriter();
      const logger = createLogger({ level: 'debug', writer });

      logger.debug('Detailed trace info');

      assert.equal(writer.calls.length, 1);
      assert.ok(writer.calls[0].includes('DEBUG'));
      assert.ok(writer.calls[0].includes('Detailed trace info'));
    });

    test('uses consistent timestamp format across log levels', () => {
      const writer = createMockWriter();
      const logger = createLogger({ level: 'debug', writer });

      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warn message');
      logger.error('Error message');

      assert.equal(writer.calls.length, 4);

      // All timestamps should be valid ISO 8601
      writer.calls.forEach(line => {
        const timestamp = extractDevTimestamp(line);
        parseTimestamp(timestamp);
      });
    });
  });

  // ========================================================================
  // Production mode output (JSON)
  // ========================================================================

  describe('production JSON output', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
    });

    test('outputs JSON with timestamp, level, message', () => {
      const writer = createMockWriter();
      const logger = createLogger({ writer });

      logger.info('Service starting');

      assert.equal(writer.calls.length, 1);
      const entry = JSON.parse(writer.calls[0]);

      assert.ok(entry.timestamp);
      parseTimestamp(entry.timestamp); // Validate ISO 8601
      assert.equal(entry.level, 'info');
      assert.equal(entry.message, 'Service starting');
    });

    test('includes component field when provided', () => {
      const writer = createMockWriter();
      const logger = createLogger({ component: 'BotManager', writer });

      logger.info('Bot registered');

      assert.equal(writer.calls.length, 1);
      const entry = JSON.parse(writer.calls[0]);

      assert.equal(entry.component, 'BotManager');
      assert.equal(entry.message, 'Bot registered');
      assert.equal(entry.level, 'info');
    });

    test('omits component field when not provided', () => {
      const writer = createMockWriter();
      const logger = createLogger({ writer });

      logger.info('Generic log');

      assert.equal(writer.calls.length, 1);
      const entry = JSON.parse(writer.calls[0]);

      assert.equal(entry.component, undefined);
      assert.equal(Object.hasOwn(entry, 'component'), false);
    });

    test('outputs error level as JSON', () => {
      const writer = createMockWriter();
      const logger = createLogger({ writer });

      logger.error('Database connection lost');

      assert.equal(writer.calls.length, 1);
      const entry = JSON.parse(writer.calls[0]);

      assert.equal(entry.level, 'error');
      assert.equal(entry.message, 'Database connection lost');
    });

    test('outputs warn level as JSON', () => {
      const writer = createMockWriter();
      const logger = createLogger({ writer });

      logger.warn('Rate limit approaching');

      assert.equal(writer.calls.length, 1);
      const entry = JSON.parse(writer.calls[0]);

      assert.equal(entry.level, 'warn');
      assert.equal(entry.message, 'Rate limit approaching');
    });

    test('outputs debug level as JSON', () => {
      const writer = createMockWriter();
      const logger = createLogger({ level: 'debug', writer });

      logger.debug('Request details');

      assert.equal(writer.calls.length, 1);
      const entry = JSON.parse(writer.calls[0]);

      assert.equal(entry.level, 'debug');
      assert.equal(entry.message, 'Request details');
    });

    test('uses consistent JSON structure across log levels', () => {
      const writer = createMockWriter();
      const logger = createLogger({ level: 'debug', component: 'Test', writer });

      logger.debug('Debug');
      logger.info('Info');
      logger.warn('Warn');
      logger.error('Error');

      assert.equal(writer.calls.length, 4);

      writer.calls.forEach((line, idx) => {
        const entry = JSON.parse(line);
        assert.ok(entry.timestamp, `Entry ${idx} should have timestamp`);
        assert.ok(entry.level, `Entry ${idx} should have level`);
        assert.ok(entry.message, `Entry ${idx} should have message`);
        assert.equal(entry.component, 'Test', `Entry ${idx} should have component`);
      });
    });
  });

  // ========================================================================
  // Timestamp format (ISO 8601)
  // ========================================================================

  describe('timestamp format', () => {
    test('dev mode uses ISO 8601 timestamps', () => {
      process.env.NODE_ENV = 'development';
      const writer = createMockWriter();
      const logger = createLogger({ writer });

      logger.info('Test message');

      const timestamp = extractDevTimestamp(writer.calls[0]);
      const date = parseTimestamp(timestamp);

      // Should be recent (within last second)
      const now = Date.now();
      assert.ok(Math.abs(now - date.getTime()) < 1000);
    });

    test('production JSON uses ISO 8601 timestamps', () => {
      process.env.NODE_ENV = 'production';
      const writer = createMockWriter();
      const logger = createLogger({ writer });

      logger.info('Test message');

      const entry = JSON.parse(writer.calls[0]);
      const date = parseTimestamp(entry.timestamp);

      // Should be recent (within last second)
      const now = Date.now();
      assert.ok(Math.abs(now - date.getTime()) < 1000);
    });

    test('timestamps include milliseconds', () => {
      process.env.NODE_ENV = 'production';
      const writer = createMockWriter();
      const logger = createLogger({ writer });

      logger.info('Test');

      const entry = JSON.parse(writer.calls[0]);
      assert.match(entry.timestamp, /\.\d{3}Z$/);
    });
  });

  // ========================================================================
  // Component tagging
  // ========================================================================

  describe('component tagging', () => {
    test('includes component in every dev mode log', () => {
      process.env.NODE_ENV = 'development';
      const writer = createMockWriter();
      const logger = createLogger({ component: 'SessionManager', level: 'debug', writer });

      logger.debug('Debug msg');
      logger.info('Info msg');
      logger.warn('Warn msg');
      logger.error('Error msg');

      assert.equal(writer.calls.length, 4);
      writer.calls.forEach(line => {
        assert.ok(line.includes('[SessionManager]'));
      });
    });

    test('includes component in every production JSON log', () => {
      process.env.NODE_ENV = 'production';
      const writer = createMockWriter();
      const logger = createLogger({ component: 'BotReloader', level: 'debug', writer });

      logger.debug('Debug msg');
      logger.info('Info msg');
      logger.warn('Warn msg');
      logger.error('Error msg');

      assert.equal(writer.calls.length, 4);
      writer.calls.forEach(line => {
        const entry = JSON.parse(line);
        assert.equal(entry.component, 'BotReloader');
      });
    });

    test('component is optional (dev mode)', () => {
      process.env.NODE_ENV = 'development';
      const writer = createMockWriter();
      const logger = createLogger({ writer });

      logger.info('No component');

      assert.equal(writer.calls.length, 1);
      assert.ok(!writer.calls[0].includes('['));
      assert.match(
        writer.calls[0],
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z INFO No component$/
      );
    });

    test('component is optional (production mode)', () => {
      process.env.NODE_ENV = 'production';
      const writer = createMockWriter();
      const logger = createLogger({ writer });

      logger.info('No component');

      const entry = JSON.parse(writer.calls[0]);
      assert.equal(entry.component, undefined);
    });
  });

  // ========================================================================
  // Log level filtering
  // ========================================================================

  describe('log level filtering', () => {
    test('defaults to info level (blocks debug)', () => {
      const writer = createMockWriter();
      const logger = createLogger({ writer });

      logger.debug('Should be filtered');
      logger.info('Should appear');
      logger.warn('Should appear');
      logger.error('Should appear');

      assert.equal(writer.calls.length, 3);
      assert.ok(writer.calls[0].includes('Should appear'));
      assert.ok(writer.calls[1].includes('Should appear'));
      assert.ok(writer.calls[2].includes('Should appear'));
    });

    test('level=error only logs errors', () => {
      const writer = createMockWriter();
      const logger = createLogger({ level: 'error', writer });

      logger.debug('Filtered');
      logger.info('Filtered');
      logger.warn('Filtered');
      logger.error('Logged');

      assert.equal(writer.calls.length, 1);
      assert.ok(writer.calls[0].includes('Logged'));
    });

    test('level=warn logs warn and error', () => {
      const writer = createMockWriter();
      const logger = createLogger({ level: 'warn', writer });

      logger.debug('Filtered');
      logger.info('Filtered');
      logger.warn('Logged');
      logger.error('Logged');

      assert.equal(writer.calls.length, 2);
      assert.ok(writer.calls[0].includes('Logged'));
      assert.ok(writer.calls[1].includes('Logged'));
    });

    test('level=info logs info, warn, and error (default)', () => {
      const writer = createMockWriter();
      const logger = createLogger({ level: 'info', writer });

      logger.debug('Filtered');
      logger.info('Logged');
      logger.warn('Logged');
      logger.error('Logged');

      assert.equal(writer.calls.length, 3);
    });

    test('level=debug logs everything', () => {
      const writer = createMockWriter();
      const logger = createLogger({ level: 'debug', writer });

      logger.debug('Logged');
      logger.info('Logged');
      logger.warn('Logged');
      logger.error('Logged');

      assert.equal(writer.calls.length, 4);
    });

    test('unknown level defaults to info', () => {
      const writer = createMockWriter();
      const logger = createLogger({ level: 'invalid', writer });

      logger.debug('Filtered');
      logger.info('Logged');

      assert.equal(writer.calls.length, 1);
    });
  });

  // ========================================================================
  // Writer functions (stdout/stderr routing)
  // ========================================================================

  describe('writer functions', () => {
    test('uses separate writers for error/warn vs info/debug by default', () => {
      const stdWriter = createMockWriter();
      const errWriter = createMockWriter();

      // Mock console.log and console.error
      const originalLog = console.log;
      const originalError = console.error;
      console.log = stdWriter;
      console.error = errWriter;

      const logger = createLogger({ level: 'debug' });

      logger.debug('Debug msg');
      logger.info('Info msg');
      logger.warn('Warn msg');
      logger.error('Error msg');

      // Restore
      console.log = originalLog;
      console.error = originalError;

      // info and debug go to console.log
      assert.equal(stdWriter.calls.length, 2);
      assert.ok(stdWriter.calls[0].includes('Debug msg'));
      assert.ok(stdWriter.calls[1].includes('Info msg'));

      // warn and error go to console.error
      assert.equal(errWriter.calls.length, 2);
      assert.ok(errWriter.calls[0].includes('Warn msg'));
      assert.ok(errWriter.calls[1].includes('Error msg'));
    });

    test('uses custom writer for all levels when provided', () => {
      const writer = createMockWriter();
      const logger = createLogger({ level: 'debug', writer });

      logger.debug('Debug');
      logger.info('Info');
      logger.warn('Warn');
      logger.error('Error');

      // All go to the same writer
      assert.equal(writer.calls.length, 4);
    });

    test('custom writer receives formatted output', () => {
      process.env.NODE_ENV = 'development';
      const writer = createMockWriter();
      const logger = createLogger({ component: 'Test', writer });

      logger.info('Test message');

      assert.equal(writer.calls.length, 1);
      assert.ok(writer.calls[0].includes('INFO'));
      assert.ok(writer.calls[0].includes('[Test]'));
      assert.ok(writer.calls[0].includes('Test message'));
    });
  });

  // ========================================================================
  // Callable function interface (backward compatibility)
  // ========================================================================

  describe('callable function interface', () => {
    test('logger() delegates to logger.info()', () => {
      const writer = createMockWriter();
      const logger = createLogger({ writer });

      logger('Direct call');

      assert.equal(writer.calls.length, 1);
      assert.ok(writer.calls[0].includes('INFO'));
      assert.ok(writer.calls[0].includes('Direct call'));
    });

    test('logger() respects level filtering', () => {
      const writer = createMockWriter();
      const logger = createLogger({ level: 'error', writer });

      logger('Should be filtered');

      assert.equal(writer.calls.length, 0);
    });

    test('logger() works with component tagging', () => {
      process.env.NODE_ENV = 'development';
      const writer = createMockWriter();
      const logger = createLogger({ component: 'Legacy', writer });

      logger('Old style call');

      assert.ok(writer.calls[0].includes('[Legacy]'));
      assert.ok(writer.calls[0].includes('Old style call'));
    });
  });

  // ========================================================================
  // JSON mode override (force JSON in dev, force dev in prod)
  // ========================================================================

  describe('json mode override', () => {
    test('json=true forces JSON output in development', () => {
      process.env.NODE_ENV = 'development';
      const writer = createMockWriter();
      const logger = createLogger({ json: true, writer });

      logger.info('JSON in dev');

      const entry = JSON.parse(writer.calls[0]);
      assert.equal(entry.level, 'info');
      assert.equal(entry.message, 'JSON in dev');
    });

    test('json=false forces dev output in production', () => {
      process.env.NODE_ENV = 'production';
      const writer = createMockWriter();
      const logger = createLogger({ json: false, writer });

      logger.info('Dev in prod');

      assert.ok(writer.calls[0].includes('INFO'));
      assert.ok(writer.calls[0].includes('Dev in prod'));
    });

    test('json=undefined uses NODE_ENV default', () => {
      process.env.NODE_ENV = 'production';
      const writer = createMockWriter();
      const logger = createLogger({ writer });

      logger.info('Default behavior');

      // Should be JSON in production
      const entry = JSON.parse(writer.calls[0]);
      assert.equal(entry.level, 'info');
    });
  });

  // ========================================================================
  // Edge cases and error handling
  // ========================================================================

  describe('edge cases', () => {
    test('handles empty message', () => {
      const writer = createMockWriter();
      const logger = createLogger({ writer });

      logger.info('');

      assert.equal(writer.calls.length, 1);
      assert.ok(writer.calls[0].includes('INFO'));
    });

    test('handles multi-line messages', () => {
      process.env.NODE_ENV = 'production';
      const writer = createMockWriter();
      const logger = createLogger({ writer });

      logger.info('Line 1\nLine 2\nLine 3');

      const entry = JSON.parse(writer.calls[0]);
      assert.equal(entry.message, 'Line 1\nLine 2\nLine 3');
    });

    test('handles special characters in messages', () => {
      process.env.NODE_ENV = 'production';
      const writer = createMockWriter();
      const logger = createLogger({ writer });

      logger.info('Special chars: "quotes" \'apostrophes\' \\backslashes\\');

      const entry = JSON.parse(writer.calls[0]);
      assert.ok(entry.message.includes('quotes'));
      assert.ok(entry.message.includes('apostrophes'));
    });

    test('handles Unicode in messages', () => {
      process.env.NODE_ENV = 'production';
      const writer = createMockWriter();
      const logger = createLogger({ writer });

      logger.info('Unicode: 🚀 emoji and 中文 characters');

      const entry = JSON.parse(writer.calls[0]);
      assert.ok(entry.message.includes('🚀'));
      assert.ok(entry.message.includes('中文'));
    });

    test('creates multiple independent loggers', () => {
      const writer1 = createMockWriter();
      const writer2 = createMockWriter();
      const logger1 = createLogger({ component: 'Component1', writer: writer1 });
      const logger2 = createLogger({ component: 'Component2', writer: writer2 });

      logger1.info('From logger1');
      logger2.info('From logger2');

      assert.equal(writer1.calls.length, 1);
      assert.equal(writer2.calls.length, 1);
      assert.ok(writer1.calls[0].includes('Component1'));
      assert.ok(writer2.calls[0].includes('Component2'));
    });

    test('loggers do not interfere with each other', () => {
      const writer = createMockWriter();
      const errorLogger = createLogger({ level: 'error', writer });
      const debugLogger = createLogger({ level: 'debug', writer });

      errorLogger.info('Filtered');
      debugLogger.info('Logged');

      assert.equal(writer.calls.length, 1);
      assert.ok(writer.calls[0].includes('Logged'));
    });
  });

  // ========================================================================
  // Integration-style tests (capturing stdout with mock stream)
  // ========================================================================

  describe('stdout capture with mock stream', () => {
    test('captures dev mode output to writable stream', () => {
      process.env.NODE_ENV = 'development';
      const { stream, lines } = createMockWritable();
      const logger = createLogger({ writer: msg => stream.write(`${msg}\n`) });

      logger.info('Message 1');
      logger.warn('Message 2');

      assert.equal(lines.length, 2);
      assert.ok(lines[0].includes('INFO'));
      assert.ok(lines[0].includes('Message 1'));
      assert.ok(lines[1].includes('WARN'));
      assert.ok(lines[1].includes('Message 2'));
    });

    test('captures JSON output to writable stream', () => {
      process.env.NODE_ENV = 'production';
      const { stream, lines } = createMockWritable();
      const logger = createLogger({ component: 'API', writer: msg => stream.write(`${msg}\n`) });

      logger.info('Request received');
      logger.error('Request failed');

      assert.equal(lines.length, 2);

      const entry1 = JSON.parse(lines[0]);
      assert.equal(entry1.level, 'info');
      assert.equal(entry1.component, 'API');

      const entry2 = JSON.parse(lines[1]);
      assert.equal(entry2.level, 'error');
      assert.equal(entry2.component, 'API');
    });
  });
});
