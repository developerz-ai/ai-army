/**
 * Unit tests for ErrorHandler
 *
 * Tests error logging, classification, and secret redaction.
 * Covers:
 * - Secret redaction for all supported token types
 * - Error classification by class name, message keywords, and cause chain
 * - Database logging with failure handling
 * - Edge cases (null, undefined, non-Error inputs)
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ErrorHandler, ErrorHandlerError } from '../../../src/utils/ErrorHandler.js';

// ==========================================================================
// Test Helpers
// ==========================================================================

/** Create a mock storage adapter with query tracking */
function createMockStorage(options = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (options.shouldFail) {
        throw new Error('Database connection failed');
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

/** Create a mock logger that captures messages */
function createMockLogger() {
  const messages = [];
  const fn = msg => messages.push(msg);
  fn.messages = messages;
  return fn;
}

/** Create a custom error with a specific name to simulate domain errors */
function createNamedError(name, message, options = {}) {
  const err = new Error(message, options.cause ? { cause: options.cause } : undefined);
  err.name = name;
  return err;
}

// ==========================================================================
// Tests
// ==========================================================================

describe('ErrorHandler', () => {
  let handler;
  let storage;
  let logger;

  beforeEach(() => {
    storage = createMockStorage();
    logger = createMockLogger();
    handler = new ErrorHandler(storage, { logger });
  });

  // ========================================================================
  // Constructor
  // ========================================================================

  describe('constructor', () => {
    test('creates with storage and logger', () => {
      const h = new ErrorHandler(storage, { logger });
      assert.equal(h.storage, storage);
      assert.equal(h.logger, logger);
    });

    test('creates with defaults (no storage, no logger)', () => {
      const h = new ErrorHandler();
      assert.equal(h.storage, null);
      assert.equal(h.logger, null);
    });

    test('creates with storage only', () => {
      const h = new ErrorHandler(storage);
      assert.equal(h.storage, storage);
      assert.equal(h.logger, null);
    });

    test('creates with null storage and options', () => {
      const h = new ErrorHandler(null, { logger });
      assert.equal(h.storage, null);
      assert.equal(h.logger, logger);
    });
  });

  // ========================================================================
  // ErrorHandlerError
  // ========================================================================

  describe('ErrorHandlerError', () => {
    test('creates error with message', () => {
      const err = new ErrorHandlerError('Something failed');
      assert.equal(err.message, 'Something failed');
      assert.equal(err.name, 'ErrorHandlerError');
      assert.ok(err instanceof Error);
    });

    test('creates error with cause and operation', () => {
      const cause = new Error('root cause');
      const err = new ErrorHandlerError('Wrapper error', {
        cause,
        operation: 'logError',
      });
      assert.equal(err.cause, cause);
      assert.equal(err.operation, 'logError');
    });

    test('defaults operation to undefined', () => {
      const err = new ErrorHandlerError('test');
      assert.equal(err.operation, undefined);
    });

    test('inherits from Error prototype chain', () => {
      const err = new ErrorHandlerError('test');
      assert.ok(err instanceof ErrorHandlerError);
      assert.ok(err instanceof Error);
    });

    test('has a stack trace', () => {
      const err = new ErrorHandlerError('test');
      assert.ok(err.stack);
      assert.ok(err.stack.includes('ErrorHandlerError'));
    });
  });

  // ========================================================================
  // redactSecrets()
  // ========================================================================

  describe('redactSecrets()', () => {
    // ------ Anthropic ------
    test('redacts Anthropic API keys', () => {
      const text = 'Error with key sk-ant-api03-abcdef123456-xyz';
      const result = handler.redactSecrets(text);
      assert.equal(result, 'Error with key [REDACTED_ANTHROPIC_KEY]');
    });

    test('redacts Anthropic keys with various formats', () => {
      const text = 'Key: sk-ant-abc-123-DEF';
      const result = handler.redactSecrets(text);
      assert.ok(!result.includes('sk-ant-'));
      assert.ok(result.includes('[REDACTED_ANTHROPIC_KEY]'));
    });

    // ------ OpenRouter ------
    test('redacts OpenRouter API keys', () => {
      const text = 'Auth failed: sk-or-v1-abc123def456';
      const result = handler.redactSecrets(text);
      assert.equal(result, 'Auth failed: [REDACTED_OPENROUTER_KEY]');
    });

    // ------ OpenAI ------
    test('redacts OpenAI API keys', () => {
      const text = 'Key: sk-abcdefghijklmnopqrstuvwxyz1234567890';
      const result = handler.redactSecrets(text);
      assert.equal(result, 'Key: [REDACTED_OPENAI_KEY]');
    });

    test('does not redact short sk- tokens (below 20 chars)', () => {
      // Short tokens should not be redacted as OpenAI keys
      const text = 'Key: sk-short';
      const result = handler.redactSecrets(text);
      assert.equal(result, 'Key: sk-short');
    });

    // ------ Slack tokens ------
    test('redacts Slack bot tokens', () => {
      const text = 'Slack token: xoxb-123-456-abc789';
      const result = handler.redactSecrets(text);
      assert.equal(result, 'Slack token: [REDACTED_SLACK_BOT_TOKEN]');
    });

    test('redacts Slack app tokens', () => {
      const text = 'App token: xapp-1-A1234-5678-abc';
      const result = handler.redactSecrets(text);
      assert.equal(result, 'App token: [REDACTED_SLACK_APP_TOKEN]');
    });

    test('redacts Slack user tokens', () => {
      const text = 'User token: xoxp-123-456-789-abc';
      const result = handler.redactSecrets(text);
      assert.equal(result, 'User token: [REDACTED_SLACK_USER_TOKEN]');
    });

    // ------ GitHub tokens ------
    test('redacts GitHub personal access tokens', () => {
      const text = 'Token: ghp_ABCDEFabcdef1234567890xyz';
      const result = handler.redactSecrets(text);
      assert.equal(result, 'Token: [REDACTED_GITHUB_TOKEN]');
    });

    test('redacts GitHub OAuth tokens', () => {
      const text = 'OAuth: gho_ABCDEFabcdef1234567890';
      const result = handler.redactSecrets(text);
      assert.equal(result, 'OAuth: [REDACTED_GITHUB_OAUTH_TOKEN]');
    });

    test('redacts GitHub server tokens', () => {
      const text = 'Server: ghs_ABCDEFabcdef1234567890';
      const result = handler.redactSecrets(text);
      assert.equal(result, 'Server: [REDACTED_GITHUB_SERVER_TOKEN]');
    });

    // ------ Multiple secrets ------
    test('redacts multiple secrets in the same string', () => {
      const text = 'Keys: sk-ant-key123 and xoxb-456-789-abc and ghp_token123abc';
      const result = handler.redactSecrets(text);
      assert.ok(!result.includes('sk-ant-'));
      assert.ok(!result.includes('xoxb-'));
      assert.ok(!result.includes('ghp_'));
      assert.ok(result.includes('[REDACTED_ANTHROPIC_KEY]'));
      assert.ok(result.includes('[REDACTED_SLACK_BOT_TOKEN]'));
      assert.ok(result.includes('[REDACTED_GITHUB_TOKEN]'));
    });

    test('redacts all token types in a single message', () => {
      const text = [
        'sk-ant-api03-longkey123',
        'sk-or-v1-routerkey456',
        'sk-openai12345678901234567890',
        'xoxb-slack-bot-token',
        'xapp-slack-app-token',
        'xoxp-slack-user-token',
        'ghp_personaltoken123',
        'gho_oauthtoken456',
        'ghs_servertoken789',
      ].join(' ');
      const result = handler.redactSecrets(text);

      assert.ok(result.includes('[REDACTED_ANTHROPIC_KEY]'));
      assert.ok(result.includes('[REDACTED_OPENROUTER_KEY]'));
      assert.ok(result.includes('[REDACTED_OPENAI_KEY]'));
      assert.ok(result.includes('[REDACTED_SLACK_BOT_TOKEN]'));
      assert.ok(result.includes('[REDACTED_SLACK_APP_TOKEN]'));
      assert.ok(result.includes('[REDACTED_SLACK_USER_TOKEN]'));
      assert.ok(result.includes('[REDACTED_GITHUB_TOKEN]'));
      assert.ok(result.includes('[REDACTED_GITHUB_OAUTH_TOKEN]'));
      assert.ok(result.includes('[REDACTED_GITHUB_SERVER_TOKEN]'));
    });

    // ------ No secrets ------
    test('returns original text when no secrets present', () => {
      const text = 'Normal error: connection refused on port 5432';
      const result = handler.redactSecrets(text);
      assert.equal(result, text);
    });

    // ------ Edge cases ------
    test('handles empty string', () => {
      assert.equal(handler.redactSecrets(''), '');
    });

    test('handles null input', () => {
      assert.equal(handler.redactSecrets(null), '');
    });

    test('handles undefined input', () => {
      assert.equal(handler.redactSecrets(undefined), '');
    });

    test('handles non-string input (number)', () => {
      assert.equal(handler.redactSecrets(123), '');
    });

    test('handles non-string input (object)', () => {
      assert.equal(handler.redactSecrets({}), '');
    });

    test('handles non-string input (boolean)', () => {
      assert.equal(handler.redactSecrets(true), '');
    });

    // ------ Multi-line / stack traces ------
    test('redacts secrets in multi-line text (stack traces)', () => {
      const stack = `Error: API failed with sk-ant-key123
    at processMessage (/app/src/core.js:42)
    at run (/app/src/agent.js:10)`;
      const result = handler.redactSecrets(stack);
      assert.ok(!result.includes('sk-ant-key123'));
      assert.ok(result.includes('[REDACTED_ANTHROPIC_KEY]'));
      assert.ok(result.includes('processMessage'));
      assert.ok(result.includes('/app/src/core.js:42'));
    });

    // ------ Regex state safety ------
    test('can be called multiple times without regex state issues', () => {
      const text = 'Key: sk-ant-abc123';
      const result1 = handler.redactSecrets(text);
      const result2 = handler.redactSecrets(text);
      const result3 = handler.redactSecrets(text);
      assert.equal(result1, result2);
      assert.equal(result2, result3);
      assert.equal(result1, 'Key: [REDACTED_ANTHROPIC_KEY]');
    });

    test('handles secret at start of string', () => {
      const text = 'sk-ant-startkey123 is invalid';
      const result = handler.redactSecrets(text);
      assert.ok(result.startsWith('[REDACTED_ANTHROPIC_KEY]'));
    });

    test('handles secret at end of string', () => {
      const text = 'Failed with token xoxb-end-token-key';
      const result = handler.redactSecrets(text);
      assert.ok(result.endsWith('[REDACTED_SLACK_BOT_TOKEN]'));
    });

    test('handles string that is only a secret', () => {
      const text = 'ghp_entirelyATokenValue123';
      const result = handler.redactSecrets(text);
      assert.equal(result, '[REDACTED_GITHUB_TOKEN]');
    });
  });

  // ========================================================================
  // classifyError()
  // ========================================================================

  describe('classifyError()', () => {
    // ------ Strategy 1: Config errors by class name ------
    describe('classification by class name', () => {
      test('classifies ConfigValidationError as config', () => {
        const err = createNamedError('ConfigValidationError', 'Invalid config');
        assert.equal(handler.classifyError(err), 'config');
      });

      test('classifies ConfigError as config', () => {
        const err = createNamedError('ConfigError', 'Missing config file');
        assert.equal(handler.classifyError(err), 'config');
      });

      // ------ Docker errors by class name ------
      test('classifies DockerError as docker', () => {
        const err = createNamedError('DockerError', 'Container crashed');
        assert.equal(handler.classifyError(err), 'docker');
      });

      test('classifies ContainerPoolError as docker', () => {
        const err = createNamedError('ContainerPoolError', 'No containers available');
        assert.equal(handler.classifyError(err), 'docker');
      });

      test('classifies ToolExecutionError as docker', () => {
        const err = createNamedError('ToolExecutionError', 'Bash failed');
        assert.equal(handler.classifyError(err), 'docker');
      });

      test('classifies DangerousCommandError as docker', () => {
        const err = createNamedError('DangerousCommandError', 'rm -rf /');
        assert.equal(handler.classifyError(err), 'docker');
      });

      // ------ Database errors by class name ------
      test('classifies StorageError as database', () => {
        const err = createNamedError('StorageError', 'Query failed');
        assert.equal(handler.classifyError(err), 'database');
      });

      test('classifies MigrationError as database', () => {
        const err = createNamedError('MigrationError', 'Migration failed');
        assert.equal(handler.classifyError(err), 'database');
      });

      test('classifies SessionError as database', () => {
        const err = createNamedError('SessionError', 'Session not found');
        assert.equal(handler.classifyError(err), 'database');
      });

      // ------ Network errors by class name ------
      test('classifies SlackAdapterError as network', () => {
        const err = createNamedError('SlackAdapterError', 'Slack connection lost');
        assert.equal(handler.classifyError(err), 'network');
      });

      test('classifies DiscordAdapterError as network', () => {
        const err = createNamedError('DiscordAdapterError', 'Discord auth failed');
        assert.equal(handler.classifyError(err), 'network');
      });

      test('classifies ChannelManagerError as network', () => {
        const err = createNamedError('ChannelManagerError', 'Channel unavailable');
        assert.equal(handler.classifyError(err), 'network');
      });
    });

    // ------ Strategy 2: Message-based classification ------
    describe('classification by message keywords', () => {
      // Network keywords
      test('classifies ECONNREFUSED as network', () => {
        const err = new Error('connect ECONNREFUSED 127.0.0.1:5432');
        assert.equal(handler.classifyError(err), 'network');
      });

      test('classifies ECONNRESET as network', () => {
        const err = new Error('read ECONNRESET');
        assert.equal(handler.classifyError(err), 'network');
      });

      test('classifies ETIMEDOUT as network', () => {
        const err = new Error('connect ETIMEDOUT 10.0.0.1:443');
        assert.equal(handler.classifyError(err), 'network');
      });

      test('classifies ENOTFOUND as network', () => {
        const err = new Error('getaddrinfo ENOTFOUND api.example.com');
        assert.equal(handler.classifyError(err), 'network');
      });

      test('classifies socket errors as network', () => {
        const err = new Error('socket hang up');
        assert.equal(handler.classifyError(err), 'network');
      });

      test('classifies network keyword as network', () => {
        const err = new Error('Network unreachable');
        assert.equal(handler.classifyError(err), 'network');
      });

      // Docker keywords
      test('classifies docker-related message as docker', () => {
        const err = new Error('Docker daemon not running');
        assert.equal(handler.classifyError(err), 'docker');
      });

      test('classifies container-related message as docker', () => {
        const err = new Error('Container exited with code 137');
        assert.equal(handler.classifyError(err), 'docker');
      });

      test('classifies image-related message as docker', () => {
        const err = new Error('Image not found: node:22-slim');
        assert.equal(handler.classifyError(err), 'docker');
      });

      // Database keywords
      test('classifies database-related message as database', () => {
        const err = new Error('Database connection lost');
        assert.equal(handler.classifyError(err), 'database');
      });

      test('classifies postgres-related message as database', () => {
        const err = new Error('Postgres query timeout');
        assert.equal(handler.classifyError(err), 'database');
      });

      test('classifies SQL-related message as database', () => {
        const err = new Error('SQL syntax error near "SELECT"');
        assert.equal(handler.classifyError(err), 'database');
      });

      test('classifies query-related message as database', () => {
        const err = new Error('Query failed after retries');
        assert.equal(handler.classifyError(err), 'database');
      });

      test('classifies connection pool message as database', () => {
        const err = new Error('Connection pool exhausted');
        assert.equal(handler.classifyError(err), 'database');
      });

      // Config keywords
      test('classifies config-related message as config', () => {
        const err = new Error('Configuration file not found');
        assert.equal(handler.classifyError(err), 'config');
      });

      test('classifies validation-related message as config', () => {
        const err = new Error('Validation failed: missing required field');
        assert.equal(handler.classifyError(err), 'config');
      });

      test('classifies invalid config message as config', () => {
        const err = new Error('Invalid config: unknown provider');
        assert.equal(handler.classifyError(err), 'config');
      });

      test('classifies schema validation message as config', () => {
        const err = new Error('Schema validation error in bot config');
        assert.equal(handler.classifyError(err), 'config');
      });

      // Case insensitivity
      test('keyword matching is case-insensitive', () => {
        const err = new Error('DOCKER DAEMON UNREACHABLE');
        assert.equal(handler.classifyError(err), 'docker');
      });
    });

    // ------ Strategy 3: Cause chain classification ------
    describe('classification by cause chain', () => {
      test('classifies by cause when direct class is unknown', () => {
        const cause = createNamedError('DockerError', 'Container died');
        const wrapper = new Error('Operation failed', { cause });
        assert.equal(handler.classifyError(wrapper), 'docker');
      });

      test('does not recurse into cause if direct class matches', () => {
        const cause = createNamedError('DockerError', 'Container died');
        const wrapper = createNamedError('ConfigError', 'Config issue', { cause });
        assert.equal(handler.classifyError(wrapper), 'config');
      });

      test('traverses nested cause chain', () => {
        const root = createNamedError('StorageError', 'Connection lost');
        const mid = new Error('Service unavailable', { cause: root });
        const outer = new Error('Request failed', { cause: mid });
        assert.equal(handler.classifyError(outer), 'database');
      });

      test('ignores cause chain with runtime-only causes', () => {
        const cause = new Error('Generic failure');
        const wrapper = new Error('Something went wrong', { cause });
        assert.equal(handler.classifyError(wrapper), 'runtime');
      });

      test('skips cause if not an Error instance', () => {
        const err = new Error('Failed');
        err.cause = 'string cause';
        assert.equal(handler.classifyError(err), 'runtime');
      });
    });

    // ------ Default classification ------
    describe('default classification', () => {
      test('defaults to runtime for unknown errors', () => {
        const err = new Error('Something unexpected happened');
        assert.equal(handler.classifyError(err), 'runtime');
      });

      test('defaults to runtime for generic TypeError', () => {
        const err = new TypeError('Cannot read property of undefined');
        assert.equal(handler.classifyError(err), 'runtime');
      });

      test('defaults to runtime for RangeError', () => {
        const err = new RangeError('Invalid array length');
        assert.equal(handler.classifyError(err), 'runtime');
      });

      test('defaults to runtime for SyntaxError', () => {
        const err = new SyntaxError('Unexpected token');
        assert.equal(handler.classifyError(err), 'runtime');
      });

      test('defaults to runtime for ReferenceError', () => {
        const err = new ReferenceError('x is not defined');
        assert.equal(handler.classifyError(err), 'runtime');
      });
    });

    // ------ Edge cases ------
    describe('edge cases', () => {
      test('handles null input', () => {
        assert.equal(handler.classifyError(null), 'runtime');
      });

      test('handles undefined input', () => {
        assert.equal(handler.classifyError(undefined), 'runtime');
      });

      test('handles non-Error input (string)', () => {
        assert.equal(handler.classifyError('string error'), 'runtime');
      });

      test('handles non-Error input (number)', () => {
        assert.equal(handler.classifyError(42), 'runtime');
      });

      test('handles non-Error input (object)', () => {
        assert.equal(handler.classifyError({ message: 'not an error' }), 'runtime');
      });

      test('handles error with no message', () => {
        const err = new Error();
        assert.equal(handler.classifyError(err), 'runtime');
      });

      test('handles error with empty message', () => {
        const err = new Error('');
        assert.equal(handler.classifyError(err), 'runtime');
      });
    });

    // ------ Priority: class name wins over message keywords ------
    describe('classification priority', () => {
      test('class name takes precedence over message keywords', () => {
        // Error name says Config, but message says "docker container"
        const err = createNamedError('ConfigError', 'Docker container not configured');
        assert.equal(handler.classifyError(err), 'config');
      });

      test('message keywords take precedence over cause chain', () => {
        const cause = createNamedError('DockerError', 'Container issue');
        const wrapper = new Error('ECONNREFUSED', { cause });
        // Message keyword "ECONNREFUSED" matches network before checking cause
        assert.equal(handler.classifyError(wrapper), 'network');
      });
    });
  });

  // ========================================================================
  // logError()
  // ========================================================================

  describe('logError()', () => {
    // ------ Basic logging ------
    test('logs error to stdout via logger', async () => {
      const err = new Error('Something failed');
      await handler.logError(err);

      assert.equal(logger.messages.length, 1);
      assert.ok(logger.messages[0].includes('Something failed'));
      assert.ok(logger.messages[0].includes('[runtime]'));
    });

    test('logs error with context', async () => {
      const err = new Error('Bot failed');
      await handler.logError(err, {
        botId: 'support',
        operation: 'processMessage',
      });

      assert.equal(logger.messages.length, 1);
      assert.ok(logger.messages[0].includes('Bot failed'));
    });

    // ------ Structured log entry ------
    test('returns structured log entry', async () => {
      const err = new Error('Test error');
      const entry = await handler.logError(err, { botId: 'test-bot' });

      assert.ok(entry.timestamp);
      assert.equal(entry.level, 'error');
      assert.equal(entry.category, 'runtime');
      assert.equal(entry.error.name, 'Error');
      assert.equal(entry.error.message, 'Test error');
      assert.ok(entry.error.stack);
      assert.equal(entry.botId, 'test-bot');
    });

    test('timestamp is valid ISO string', async () => {
      const err = new Error('Test');
      const entry = await handler.logError(err);
      const parsed = new Date(entry.timestamp);
      assert.ok(!isNaN(parsed.getTime()), 'Timestamp should be a valid date');
    });

    test('includes all context fields in log entry', async () => {
      const err = new Error('Test');
      const entry = await handler.logError(err, {
        botId: 'support',
        operation: 'processMessage',
        sessionId: 'support:slack:C1:U1',
      });

      assert.equal(entry.botId, 'support');
      assert.equal(entry.operation, 'processMessage');
      assert.equal(entry.sessionId, 'support:slack:C1:U1');
    });

    // ------ Secret redaction in logging ------
    test('redacts secrets from error message in log output', async () => {
      const err = new Error('Failed with key sk-ant-secret123');
      await handler.logError(err);

      assert.equal(logger.messages.length, 1);
      assert.ok(!logger.messages[0].includes('sk-ant-secret123'));
      assert.ok(logger.messages[0].includes('[REDACTED_ANTHROPIC_KEY]'));
    });

    test('redacts secrets from stack trace in log entry', async () => {
      const err = new Error('API key sk-ant-mykey123 is invalid');
      const entry = await handler.logError(err);

      assert.ok(!entry.error.message.includes('sk-ant-mykey123'));
      assert.ok(!entry.error.stack.includes('sk-ant-mykey123'));
    });

    test('redacts secrets from database insert params', async () => {
      const err = new Error('Token xoxb-secret-token-value failed');
      await handler.logError(err);

      assert.equal(storage.queries.length, 1);
      const { params } = storage.queries[0];
      // params[2] is the redacted message
      assert.ok(!params[2].includes('xoxb-'));
      assert.ok(params[2].includes('[REDACTED_SLACK_BOT_TOKEN]'));
      // params[3] is the redacted stack
      assert.ok(!params[3].includes('xoxb-'));
    });

    // ------ Database logging ------
    test('stores error in database when storage is available', async () => {
      const err = createNamedError('DockerError', 'Container crashed');
      await handler.logError(err, { botId: 'support' });

      assert.equal(storage.queries.length, 1);
      const { sql, params } = storage.queries[0];
      assert.ok(sql.includes('INSERT INTO error_logs'));
      assert.equal(params[0], 'docker'); // category
      assert.equal(params[1], 'DockerError'); // error_name
      assert.equal(params[2], 'Container crashed'); // message
      assert.ok(params[3]); // stack
      assert.ok(params[4].includes('"botId"')); // context JSON
    });

    test('serializes context as JSON in database', async () => {
      const err = new Error('Test');
      const context = { botId: 'bot1', operation: 'test', sessionId: 'sess1' };
      await handler.logError(err, context);

      const { params } = storage.queries[0];
      const parsed = JSON.parse(params[4]);
      assert.equal(parsed.botId, 'bot1');
      assert.equal(parsed.operation, 'test');
      assert.equal(parsed.sessionId, 'sess1');
    });

    test('uses parameterized query for database insert', async () => {
      const err = new Error('Test');
      await handler.logError(err);

      const { sql, params } = storage.queries[0];
      assert.ok(sql.includes('$1'));
      assert.ok(sql.includes('$2'));
      assert.ok(sql.includes('$3'));
      assert.ok(sql.includes('$4'));
      assert.ok(sql.includes('$5'));
      assert.equal(params.length, 5);
    });

    // ------ Database failure handling ------
    test('does not throw when database logging fails', async () => {
      const failStorage = createMockStorage({ shouldFail: true });
      const failLogger = createMockLogger();
      const h = new ErrorHandler(failStorage, { logger: failLogger });

      const err = new Error('Test error');
      await assert.doesNotReject(() => h.logError(err));

      // Should log the database failure warning
      const dbFailMsg = failLogger.messages.find(m =>
        m.includes('Failed to log error to database')
      );
      assert.ok(dbFailMsg, 'Should log database failure warning');
    });

    test('still returns log entry when database fails', async () => {
      const failStorage = createMockStorage({ shouldFail: true });
      const h = new ErrorHandler(failStorage, { logger });

      const err = new Error('Test error');
      const entry = await h.logError(err);

      assert.ok(entry);
      assert.equal(entry.error.message, 'Test error');
    });

    // ------ No storage ------
    test('skips database logging when no storage', async () => {
      const h = new ErrorHandler(null, { logger });
      const err = new Error('No DB');
      await h.logError(err);

      assert.equal(logger.messages.length, 1);
      assert.ok(logger.messages[0].includes('No DB'));
    });

    // ------ Non-Error input ------
    test('handles non-Error input gracefully', async () => {
      await handler.logError('not an error');

      assert.equal(logger.messages.length, 1);
      assert.ok(logger.messages[0].includes('non-Error'));
      assert.equal(storage.queries.length, 0);
    });

    test('handles null input gracefully', async () => {
      await handler.logError(null);

      assert.equal(logger.messages.length, 1);
      assert.ok(logger.messages[0].includes('non-Error'));
    });

    test('returns undefined for non-Error input', async () => {
      const result = await handler.logError('not an error');
      assert.equal(result, undefined);
    });

    test('returns undefined for null input', async () => {
      const result = await handler.logError(null);
      assert.equal(result, undefined);
    });

    // ------ Classification in log output ------
    test('uses error name in log output', async () => {
      const err = createNamedError('ConfigValidationError', 'Bad config');
      await handler.logError(err);

      assert.ok(logger.messages[0].includes('ConfigValidationError'));
      assert.ok(logger.messages[0].includes('[config]'));
    });

    test('includes correct category for classified errors', async () => {
      const err = createNamedError('StorageError', 'Query failed');
      const entry = await handler.logError(err);

      assert.equal(entry.category, 'database');
    });

    // ------ Edge cases ------
    test('handles error with empty message', async () => {
      const err = new Error('');
      const entry = await handler.logError(err);

      assert.equal(entry.error.message, '');
      assert.equal(entry.category, 'runtime');
    });

    test('handles error with no stack', async () => {
      const err = new Error('No stack');
      delete err.stack;
      const entry = await handler.logError(err);

      assert.equal(entry.error.stack, undefined);
    });

    test('works without logger (silent mode)', async () => {
      const h = new ErrorHandler(storage);
      const err = new Error('Silent error');

      // Should not throw
      await assert.doesNotReject(() => h.logError(err));
      // Should still log to database
      assert.equal(storage.queries.length, 1);
    });

    test('handles empty context', async () => {
      const err = new Error('Test');
      const entry = await handler.logError(err, {});

      assert.ok(entry);
      assert.equal(entry.category, 'runtime');
    });
  });

  // ========================================================================
  // Integration-style tests
  // ========================================================================

  describe('integration', () => {
    test('full pipeline: classify -> redact -> log', async () => {
      const err = createNamedError(
        'SlackAdapterError',
        'Connection failed for token xoxb-123-456-abc'
      );
      const entry = await handler.logError(err, {
        botId: 'support',
        operation: 'connect',
        sessionId: 'support:slack:C1:U1',
      });

      // Classification
      assert.equal(entry.category, 'network');

      // Redaction in log entry
      assert.ok(!entry.error.message.includes('xoxb-'));
      assert.ok(entry.error.message.includes('[REDACTED_SLACK_BOT_TOKEN]'));

      // Redaction in stdout
      assert.ok(!logger.messages[0].includes('xoxb-'));

      // Database insertion
      assert.equal(storage.queries.length, 1);
      assert.ok(!storage.queries[0].params[2].includes('xoxb-'));

      // Context preserved
      assert.equal(entry.botId, 'support');
      assert.equal(entry.operation, 'connect');
      assert.equal(entry.sessionId, 'support:slack:C1:U1');
    });

    test('redacts multiple secrets across classification + logging', async () => {
      const err = new Error('Auth: sk-ant-key1 slack: xoxb-tok-en github: ghp_abc123xyz');
      const entry = await handler.logError(err);

      // No secrets leak
      assert.ok(!entry.error.message.includes('sk-ant-'));
      assert.ok(!entry.error.message.includes('xoxb-'));
      assert.ok(!entry.error.message.includes('ghp_'));

      // All redaction labels present
      assert.ok(entry.error.message.includes('[REDACTED_ANTHROPIC_KEY]'));
      assert.ok(entry.error.message.includes('[REDACTED_SLACK_BOT_TOKEN]'));
      assert.ok(entry.error.message.includes('[REDACTED_GITHUB_TOKEN]'));
    });

    test('cause chain classification with redaction', async () => {
      const cause = createNamedError('DockerError', 'Image pull with ghp_token123');
      const wrapper = new Error('Deploy failed', { cause });

      const entry = await handler.logError(wrapper);
      assert.equal(entry.category, 'docker');
      assert.ok(!entry.error.message.includes('ghp_'));
    });

    test('database failure does not prevent redacted log output', async () => {
      const failStorage = createMockStorage({ shouldFail: true });
      const failLogger = createMockLogger();
      const h = new ErrorHandler(failStorage, { logger: failLogger });

      const err = new Error('Failed with key sk-ant-secret999');
      const entry = await h.logError(err);

      // Redaction still works
      assert.ok(!entry.error.message.includes('sk-ant-'));
      assert.ok(entry.error.message.includes('[REDACTED_ANTHROPIC_KEY]'));

      // Log output exists (error log + db failure warning)
      assert.equal(failLogger.messages.length, 2);
    });

    test('multiple sequential errors use correct classification', async () => {
      const err1 = createNamedError('DockerError', 'Container crashed');
      const err2 = createNamedError('ConfigError', 'Missing field');
      const err3 = new Error('ECONNREFUSED on port 443');

      const entry1 = await handler.logError(err1);
      const entry2 = await handler.logError(err2);
      const entry3 = await handler.logError(err3);

      assert.equal(entry1.category, 'docker');
      assert.equal(entry2.category, 'config');
      assert.equal(entry3.category, 'network');

      // All three logged to database
      assert.equal(storage.queries.length, 3);
    });
  });
});
