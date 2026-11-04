/**
 * Integration tests for PostgresStorage
 *
 * Tests database connection, pooling, and CRUD operations.
 * Requires PostgreSQL to be running and accessible.
 *
 * Run with: DATABASE_URL=postgresql://... npm run test:integration
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PostgresStorage, StorageError } from '../../../src/adapters/storage/postgres.js';
import {
  setupTestDatabase,
  cleanupTestDatabase,
  TEST_DATABASE_URL,
  isDatabaseAvailable,
} from '../../helpers/setup.js';

// Check base database availability at module load (worker DB gets created in setupTestDatabase)
const DB_AVAILABLE = await isDatabaseAvailable();

if (!DB_AVAILABLE) {
  console.log('Skipping PostgresStorage tests - database not available');
}

describe('PostgresStorage', { skip: !DB_AVAILABLE }, async () => {
  let storage;

  before(async () => {
    storage = await setupTestDatabase();
  });

  after(async () => {
    if (storage) {
      await cleanupTestDatabase(storage);
    }
  });

  beforeEach(async () => {
    // Clean tables between tests
    await storage.query('TRUNCATE bots CASCADE');
    await storage.query('DELETE FROM tool_calls');
  });

  describe('Connection Management', () => {
    test('connects to database successfully', async () => {
      const testStorage = new PostgresStorage(TEST_DATABASE_URL);

      await testStorage.connect();

      assert.ok(testStorage.isConnected(), 'Should be connected');

      await testStorage.disconnect();
      assert.ok(!testStorage.isConnected(), 'Should be disconnected');
    });

    test('handles double connect gracefully', async () => {
      const testStorage = new PostgresStorage(TEST_DATABASE_URL);

      await testStorage.connect();
      await testStorage.connect(); // Should not throw

      assert.ok(testStorage.isConnected());

      await testStorage.disconnect();
    });

    test('handles disconnect without connect', async () => {
      const testStorage = new PostgresStorage(TEST_DATABASE_URL);

      // Should not throw
      await testStorage.disconnect();
      assert.ok(!testStorage.isConnected());
    });

    test('throws StorageError for invalid connection string', async () => {
      const invalidStorage = new PostgresStorage(
        'postgresql://invalid:invalid@localhost:54321/nonexistent'
      );

      await assert.rejects(
        () => invalidStorage.connect(),
        err => {
          assert.ok(err instanceof StorageError);
          assert.equal(err.name, 'StorageError');
          assert.equal(err.operation, 'connect');
          return true;
        }
      );
    });

    test('provides pool statistics', async () => {
      const stats = storage.getPoolStats();

      assert.ok(typeof stats.totalCount === 'number');
      assert.ok(typeof stats.idleCount === 'number');
      assert.ok(typeof stats.waitingCount === 'number');
    });

    test('health check returns true when connected', async () => {
      const isHealthy = await storage.healthCheck();
      assert.ok(isHealthy);
    });

    test('accepts config object', async () => {
      const testStorage = new PostgresStorage({
        connectionString: TEST_DATABASE_URL,
        max: 5,
        idleTimeoutMillis: 10000,
      });

      await testStorage.connect();
      assert.ok(testStorage.isConnected());
      await testStorage.disconnect();
    });
  });

  describe('Query Execution', () => {
    test('throws when query called without connection', async () => {
      const disconnectedStorage = new PostgresStorage(TEST_DATABASE_URL);

      await assert.rejects(
        () => disconnectedStorage.query('SELECT 1'),
        err => {
          assert.ok(err instanceof StorageError);
          assert.match(err.message, /not connected/i);
          return true;
        }
      );
    });

    test('executes parameterized queries', async () => {
      const { rows } = await storage.query('SELECT $1::text as value', ['test-value']);

      assert.equal(rows.length, 1);
      assert.equal(rows[0].value, 'test-value');
    });

    test('executes queries without parameters', async () => {
      const { rows } = await storage.query('SELECT NOW() as now');

      assert.equal(rows.length, 1);
      assert.ok(rows[0].now instanceof Date);
    });
  });

  describe('Transaction Support', () => {
    test('commits transaction on success', async () => {
      await storage.transaction(async client => {
        await client.query(`INSERT INTO bots (id, name, config, status) VALUES ($1, $2, $3, $4)`, [
          'tx-bot',
          'Transaction Bot',
          '{}',
          'stopped',
        ]);
      });

      const bot = await storage.getBotConfig('tx-bot');
      assert.ok(bot, 'Bot should exist after transaction commit');
    });

    test('rolls back transaction on error', async () => {
      try {
        await storage.transaction(async client => {
          await client.query(
            `INSERT INTO bots (id, name, config, status) VALUES ($1, $2, $3, $4)`,
            ['rollback-bot', 'Rollback Bot', '{}', 'stopped']
          );
          throw new Error('Intentional error for rollback test');
        });
      } catch {
        // Expected
      }

      const bot = await storage.getBotConfig('rollback-bot');
      assert.equal(bot, null, 'Bot should not exist after rollback');
    });
  });

  describe('Bot Management', () => {
    test('saves and retrieves bot config', async () => {
      const config = {
        id: 'test-bot',
        model: 'claude-sonnet-4-5',
        provider: 'anthropic',
        tools: ['bash', 'readFile'],
      };

      await storage.saveBotConfig('test-bot', config, {
        name: 'Test Bot',
        description: 'A test bot',
        soulContent: 'You are a helpful assistant.',
      });

      const retrieved = await storage.getBotConfig('test-bot');

      assert.ok(retrieved, 'Bot should be retrieved');
      assert.equal(retrieved.id, 'test-bot');
      assert.equal(retrieved.name, 'Test Bot');
      assert.equal(retrieved.description, 'A test bot');
      assert.equal(retrieved.soul_content, 'You are a helpful assistant.');
      assert.equal(retrieved.status, 'stopped');
      assert.deepEqual(retrieved.config, config);
    });

    test('updates existing bot config (UPSERT)', async () => {
      // Initial save
      await storage.saveBotConfig('upsert-bot', { version: 1 });

      // Update
      await storage.saveBotConfig(
        'upsert-bot',
        { version: 2 },
        {
          name: 'Updated Bot',
        }
      );

      const bot = await storage.getBotConfig('upsert-bot');

      assert.deepEqual(bot.config, { version: 2 });
      assert.equal(bot.name, 'Updated Bot');
    });

    test('returns null for non-existent bot', async () => {
      const bot = await storage.getBotConfig('non-existent-bot');
      assert.equal(bot, null);
    });

    test('updates bot status', async () => {
      await storage.saveBotConfig('status-bot', { id: 'status-bot' });

      const updated = await storage.updateBotStatus('status-bot', 'running', {
        workerId: 'worker-1',
        containerId: 'container-abc123',
      });

      assert.ok(updated, 'Should return true when bot exists');

      const bot = await storage.getBotConfig('status-bot');
      assert.equal(bot.status, 'running');
      assert.equal(bot.worker_id, 'worker-1');
      assert.equal(bot.container_id, 'container-abc123');
    });

    test('updateBotStatus returns false for non-existent bot', async () => {
      const updated = await storage.updateBotStatus('non-existent', 'running');
      assert.ok(!updated);
    });

    test('lists bots', async () => {
      await storage.saveBotConfig('list-bot-1', { name: 'Bot 1' });
      await storage.saveBotConfig('list-bot-2', { name: 'Bot 2' });

      const bots = await storage.listBots();

      assert.ok(bots.length >= 2, 'Should have at least 2 bots');
      assert.ok(bots.some(b => b.id === 'list-bot-1'));
      assert.ok(bots.some(b => b.id === 'list-bot-2'));
    });

    test('lists bots with status filter', async () => {
      await storage.saveBotConfig('running-bot', {}, { status: 'running' });
      await storage.saveBotConfig('stopped-bot', {}, { status: 'stopped' });

      // Force update status since saveBotConfig uses default 'stopped'
      await storage.updateBotStatus('running-bot', 'running');

      const runningBots = await storage.listBots({ status: 'running' });

      assert.ok(runningBots.every(b => b.status === 'running'));
      assert.ok(runningBots.some(b => b.id === 'running-bot'));
    });

    test('deletes bot', async () => {
      await storage.saveBotConfig('delete-me', { temp: true });

      const deleted = await storage.deleteBot('delete-me');
      assert.ok(deleted, 'Should return true when bot deleted');

      const bot = await storage.getBotConfig('delete-me');
      assert.equal(bot, null, 'Bot should not exist after delete');
    });

    test('deleteBot returns false for non-existent bot', async () => {
      const deleted = await storage.deleteBot('never-existed');
      assert.ok(!deleted);
    });
  });

  describe('Session Management', () => {
    test('saves and retrieves session', async () => {
      // Create a bot first (required for FK)
      await storage.saveBotConfig('session-bot', { id: 'session-bot' });

      const session = {
        id: 'session-bot:slack:C123:U456',
        botId: 'session-bot',
        userId: 'U456',
        channelId: 'C123',
        channelType: 'slack',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
        ],
        tokenCount: 100,
        compactionCount: 0,
      };

      await storage.saveSession(session);

      const retrieved = await storage.getSession('session-bot:slack:C123:U456');

      assert.ok(retrieved, 'Session should be retrieved');
      assert.equal(retrieved.id, session.id);
      assert.equal(retrieved.botId, 'session-bot');
      assert.equal(retrieved.userId, 'U456');
      assert.equal(retrieved.channelId, 'C123');
      assert.equal(retrieved.channelType, 'slack');
      assert.equal(retrieved.tokenCount, 100);
      assert.equal(retrieved.messages.length, 2);
      assert.deepEqual(retrieved.messages[0], { role: 'user', content: 'Hello' });
    });

    test('returns null for non-existent session', async () => {
      const session = await storage.getSession('non-existent:session:id');
      assert.equal(session, null);
    });

    test('updates existing session (UPSERT)', async () => {
      await storage.saveBotConfig('upsert-session-bot', {});

      // Initial save
      await storage.saveSession({
        id: 'upsert-session-bot:slack:C1:U1',
        botId: 'upsert-session-bot',
        userId: 'U1',
        channelId: 'C1',
        channelType: 'slack',
        messages: [{ role: 'user', content: 'First' }],
        tokenCount: 10,
      });

      // Update
      await storage.saveSession({
        id: 'upsert-session-bot:slack:C1:U1',
        botId: 'upsert-session-bot',
        userId: 'U1',
        channelId: 'C1',
        channelType: 'slack',
        messages: [
          { role: 'user', content: 'First' },
          { role: 'assistant', content: 'Second' },
        ],
        tokenCount: 30,
      });

      const session = await storage.getSession('upsert-session-bot:slack:C1:U1');
      assert.equal(session.messages.length, 2);
      assert.equal(session.tokenCount, 30);
    });

    test('appends message to session', async () => {
      await storage.saveBotConfig('append-bot', {});

      await storage.saveSession({
        id: 'append-bot:slack:C1:U1',
        botId: 'append-bot',
        userId: 'U1',
        channelId: 'C1',
        channelType: 'slack',
        messages: [],
      });

      const appended1 = await storage.appendMessage('append-bot:slack:C1:U1', {
        role: 'user',
        content: 'Hello',
      });
      assert.ok(appended1);

      const appended2 = await storage.appendMessage('append-bot:slack:C1:U1', {
        role: 'assistant',
        content: 'Hi there!',
      });
      assert.ok(appended2);

      const session = await storage.getSession('append-bot:slack:C1:U1');
      assert.equal(session.messages.length, 2);
      assert.deepEqual(session.messages[0], { role: 'user', content: 'Hello' });
      assert.deepEqual(session.messages[1], { role: 'assistant', content: 'Hi there!' });
    });

    test('appendMessage returns false for non-existent session', async () => {
      const appended = await storage.appendMessage('non-existent:session', {
        role: 'user',
        content: 'hi',
      });
      assert.ok(!appended);
    });

    test('updates session token count', async () => {
      await storage.saveBotConfig('token-bot', {});

      await storage.saveSession({
        id: 'token-bot:slack:C1:U1',
        botId: 'token-bot',
        userId: 'U1',
        channelId: 'C1',
        channelType: 'slack',
        tokenCount: 0,
      });

      const updated = await storage.updateSessionTokenCount('token-bot:slack:C1:U1', 5000);
      assert.ok(updated);

      const session = await storage.getSession('token-bot:slack:C1:U1');
      assert.equal(session.tokenCount, 5000);
    });

    test('lists sessions for bot', async () => {
      await storage.saveBotConfig('list-sessions-bot', {});

      await storage.saveSession({
        id: 'list-sessions-bot:slack:C1:U1',
        botId: 'list-sessions-bot',
        userId: 'U1',
        channelId: 'C1',
        channelType: 'slack',
      });

      await storage.saveSession({
        id: 'list-sessions-bot:slack:C2:U2',
        botId: 'list-sessions-bot',
        userId: 'U2',
        channelId: 'C2',
        channelType: 'slack',
      });

      const sessions = await storage.listSessions('list-sessions-bot');

      assert.equal(sessions.length, 2);
      assert.ok(sessions.every(s => s.botId === 'list-sessions-bot'));
    });

    test('lists sessions with limit', async () => {
      await storage.saveBotConfig('limit-sessions-bot', {});

      for (let i = 0; i < 5; i++) {
        await storage.saveSession({
          id: `limit-sessions-bot:slack:C${i}:U${i}`,
          botId: 'limit-sessions-bot',
          userId: `U${i}`,
          channelId: `C${i}`,
          channelType: 'slack',
        });
      }

      const sessions = await storage.listSessions('limit-sessions-bot', { limit: 3 });

      assert.equal(sessions.length, 3);
    });

    test('deletes session', async () => {
      await storage.saveBotConfig('delete-session-bot', {});

      await storage.saveSession({
        id: 'delete-session-bot:slack:C1:U1',
        botId: 'delete-session-bot',
        userId: 'U1',
        channelId: 'C1',
        channelType: 'slack',
      });

      const deleted = await storage.deleteSession('delete-session-bot:slack:C1:U1');
      assert.ok(deleted);

      const session = await storage.getSession('delete-session-bot:slack:C1:U1');
      assert.equal(session, null);
    });

    test('cascade deletes sessions when bot deleted', async () => {
      await storage.saveBotConfig('cascade-bot', {});

      await storage.saveSession({
        id: 'cascade-bot:slack:C1:U1',
        botId: 'cascade-bot',
        userId: 'U1',
        channelId: 'C1',
        channelType: 'slack',
      });

      await storage.deleteBot('cascade-bot');

      const session = await storage.getSession('cascade-bot:slack:C1:U1');
      assert.equal(session, null, 'Session should be cascade deleted');
    });
  });

  describe('Tool Calls (Audit Log)', () => {
    test('logs tool call', async () => {
      await storage.saveBotConfig('tool-log-bot', {});

      const id = await storage.logToolCall({
        botId: 'tool-log-bot',
        sessionId: 'tool-log-bot:slack:C1:U1',
        toolName: 'bash',
        parameters: { command: 'ls -la' },
        result: { output: 'file1.txt\nfile2.txt' },
        success: true,
        durationMs: 150,
      });

      // BIGSERIAL returns as string in pg library, so we convert to number
      const numId = Number(id);
      assert.ok(!isNaN(numId), 'Should return numeric ID (as string)');
      assert.ok(numId > 0, 'ID should be positive');
    });

    test('logs failed tool call with error', async () => {
      await storage.saveBotConfig('failed-tool-bot', {});

      const id = await storage.logToolCall({
        botId: 'failed-tool-bot',
        toolName: 'bash',
        parameters: { command: 'rm -rf /' },
        success: false,
        error: 'Dangerous command blocked',
        durationMs: 5,
      });

      assert.ok(Number(id) > 0, 'ID should be positive');
    });

    test('retrieves tool calls with filters', async () => {
      await storage.saveBotConfig('filter-tool-bot', {});

      await storage.logToolCall({
        botId: 'filter-tool-bot',
        toolName: 'bash',
        success: true,
      });

      await storage.logToolCall({
        botId: 'filter-tool-bot',
        toolName: 'readFile',
        success: false,
        error: 'File not found',
      });

      // Filter by bot
      const botCalls = await storage.getToolCalls({ botId: 'filter-tool-bot' });
      assert.equal(botCalls.length, 2);

      // Filter by tool name
      const bashCalls = await storage.getToolCalls({
        botId: 'filter-tool-bot',
        toolName: 'bash',
      });
      assert.equal(bashCalls.length, 1);

      // Filter by success
      const failedCalls = await storage.getToolCalls({
        botId: 'filter-tool-bot',
        success: false,
      });
      assert.equal(failedCalls.length, 1);
      assert.equal(failedCalls[0].tool_name, 'readFile');
    });

    test('respects limit in getToolCalls', async () => {
      await storage.saveBotConfig('limit-tool-bot', {});

      for (let i = 0; i < 10; i++) {
        await storage.logToolCall({
          botId: 'limit-tool-bot',
          toolName: 'bash',
          success: true,
        });
      }

      const calls = await storage.getToolCalls({
        botId: 'limit-tool-bot',
        limit: 5,
      });

      assert.equal(calls.length, 5);
    });
  });
});

describe('StorageError', () => {
  test('is an instance of Error', () => {
    const error = new StorageError('Test error');
    assert.ok(error instanceof Error);
  });

  test('has correct name', () => {
    const error = new StorageError('Test error');
    assert.equal(error.name, 'StorageError');
  });

  test('stores operation', () => {
    const error = new StorageError('Test error', { operation: 'saveBotConfig' });
    assert.equal(error.operation, 'saveBotConfig');
  });

  test('stores entityId', () => {
    const error = new StorageError('Test error', { entityId: 'bot-123' });
    assert.equal(error.entityId, 'bot-123');
  });

  test('stores cause', () => {
    const cause = new Error('Original error');
    const error = new StorageError('Test error', { cause });
    assert.equal(error.cause, cause);
  });
});
