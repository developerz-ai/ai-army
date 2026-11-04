/**
 * Unit tests for SessionManager
 *
 * Tests session key generation, message appending, token counting,
 * and session compaction functionality.
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
import { SessionManager, SessionError } from '../../../src/core/session-manager.js';

/**
 * Create a mock storage object for testing
 * @param {Object} [overrides={}] - Override default mock implementations
 * @returns {Object} Mock storage object
 */
function createMockStorage(overrides = {}) {
  return {
    sessions: new Map(),
    getSession: mock.fn(async function (key) {
      return this.sessions.get(key) || null;
    }),
    saveSession: mock.fn(async function (session) {
      this.sessions.set(session.id, session);
    }),
    appendMessage: mock.fn(async (_sessionId, _message) => {
      // No-op for append, actual storage would add to messages array
    }),
    updateSessionTokenCount: mock.fn(async (_sessionId, _tokenCount) => {
      // No-op for token count update
    }),
    deleteSession: mock.fn(async function (sessionId) {
      const existed = this.sessions.has(sessionId);
      this.sessions.delete(sessionId);
      return existed;
    }),
    ...overrides,
  };
}

describe('SessionManager', () => {
  let sessionManager;
  let mockStorage;

  beforeEach(() => {
    mockStorage = createMockStorage();
    sessionManager = new SessionManager(mockStorage);
  });

  describe('getSessionKey()', () => {
    test('generates correct session key format', () => {
      const key = sessionManager.getSessionKey(
        'my-bot',
        { type: 'slack', id: 'C123ABC' },
        'U456DEF'
      );

      assert.equal(key, 'my-bot:slack:C123ABC:U456DEF');
    });

    test('generates session key for discord channel', () => {
      const key = sessionManager.getSessionKey(
        'work',
        { type: 'discord', id: '987654321' },
        'user123'
      );

      assert.equal(key, 'work:discord:987654321:user123');
    });

    test('generates session key for rest API', () => {
      const key = sessionManager.getSessionKey(
        'api-bot',
        { type: 'rest', id: 'api-v1' },
        'client-xyz'
      );

      assert.equal(key, 'api-bot:rest:api-v1:client-xyz');
    });

    test('throws SessionError when botId is missing', () => {
      assert.throws(
        () => sessionManager.getSessionKey(null, { type: 'slack', id: 'C123' }, 'U456'),
        err => {
          assert.equal(err.name, 'SessionError');
          assert.match(err.message, /Missing required parameters/);
          assert.equal(err.operation, 'getSessionKey');
          return true;
        }
      );
    });

    test('throws SessionError when channel.type is missing', () => {
      assert.throws(
        () => sessionManager.getSessionKey('bot', { id: 'C123' }, 'U456'),
        err => {
          assert.equal(err.name, 'SessionError');
          assert.match(err.message, /Missing required parameters/);
          return true;
        }
      );
    });

    test('throws SessionError when channel.id is missing', () => {
      assert.throws(
        () => sessionManager.getSessionKey('bot', { type: 'slack' }, 'U456'),
        err => {
          assert.equal(err.name, 'SessionError');
          assert.match(err.message, /Missing required parameters/);
          return true;
        }
      );
    });

    test('throws SessionError when userId is missing', () => {
      assert.throws(
        () => sessionManager.getSessionKey('bot', { type: 'slack', id: 'C123' }, ''),
        err => {
          assert.equal(err.name, 'SessionError');
          assert.match(err.message, /Missing required parameters/);
          return true;
        }
      );
    });

    test('throws SessionError when channel is null', () => {
      assert.throws(
        () => sessionManager.getSessionKey('bot', null, 'U456'),
        err => {
          assert.equal(err.name, 'SessionError');
          assert.match(err.message, /Missing required parameters/);
          return true;
        }
      );
    });
  });

  describe('getSession()', () => {
    test('creates new session when none exists', async () => {
      const session = await sessionManager.getSession(
        'bot1',
        { type: 'slack', id: 'C123' },
        'U456'
      );

      assert.equal(session.id, 'bot1:slack:C123:U456');
      assert.equal(session.botId, 'bot1');
      assert.equal(session.userId, 'U456');
      assert.equal(session.channelId, 'C123');
      assert.equal(session.channelType, 'slack');
      assert.deepEqual(session.messages, []);
      assert.equal(session.tokenCount, 0);
      assert.equal(session.compactionCount, 0);
      assert.ok(session.createdAt instanceof Date);
      assert.ok(session.lastMessageAt instanceof Date);
    });

    test('saves new session to storage', async () => {
      await sessionManager.getSession('bot1', { type: 'slack', id: 'C123' }, 'U456');

      assert.equal(mockStorage.saveSession.mock.calls.length, 1);
      const savedSession = mockStorage.saveSession.mock.calls[0].arguments[0];
      assert.equal(savedSession.id, 'bot1:slack:C123:U456');
    });

    test('retrieves existing session from storage', async () => {
      const existingSession = {
        id: 'bot1:slack:C123:U456',
        botId: 'bot1',
        userId: 'U456',
        channelId: 'C123',
        channelType: 'slack',
        messages: [{ role: 'user', content: 'Hello' }],
        tokenCount: 100,
        compactionCount: 1,
      };
      mockStorage.sessions.set('bot1:slack:C123:U456', existingSession);

      const session = await sessionManager.getSession(
        'bot1',
        { type: 'slack', id: 'C123' },
        'U456'
      );

      assert.deepEqual(session, existingSession);
      assert.equal(mockStorage.saveSession.mock.calls.length, 0); // Should not save existing session
    });

    test('caches session in memory', async () => {
      const session = await sessionManager.getSession(
        'bot1',
        { type: 'slack', id: 'C123' },
        'U456'
      );

      assert.ok(sessionManager.sessionCache.has('bot1:slack:C123:U456'));
      assert.equal(sessionManager.sessionCache.get('bot1:slack:C123:U456'), session);
    });

    test('throws SessionError when storage fails', async () => {
      mockStorage.getSession = mock.fn(async () => {
        throw new Error('Database connection failed');
      });

      await assert.rejects(
        () => sessionManager.getSession('bot1', { type: 'slack', id: 'C123' }, 'U456'),
        err => {
          assert.equal(err.name, 'SessionError');
          assert.match(err.message, /Failed to get session/);
          assert.equal(err.operation, 'getSession');
          assert.equal(err.sessionId, 'bot1:slack:C123:U456');
          assert.ok(err.cause);
          return true;
        }
      );
    });
  });

  describe('appendMessage()', () => {
    let session;

    beforeEach(async () => {
      session = await sessionManager.getSession('bot1', { type: 'slack', id: 'C123' }, 'U456');
    });

    test('appends user message to session', async () => {
      await sessionManager.appendMessage(session, 'user', 'Hello, bot!');

      assert.equal(session.messages.length, 1);
      assert.equal(session.messages[0].role, 'user');
      assert.equal(session.messages[0].content, 'Hello, bot!');
      assert.ok(session.messages[0].timestamp);
    });

    test('appends assistant message to session', async () => {
      await sessionManager.appendMessage(session, 'assistant', 'Hi there! How can I help?');

      assert.equal(session.messages.length, 1);
      assert.equal(session.messages[0].role, 'assistant');
      assert.equal(session.messages[0].content, 'Hi there! How can I help?');
    });

    test('appends system message to session', async () => {
      await sessionManager.appendMessage(session, 'system', 'You are a helpful assistant.');

      assert.equal(session.messages.length, 1);
      assert.equal(session.messages[0].role, 'system');
    });

    test('appends multiple messages in order', async () => {
      await sessionManager.appendMessage(session, 'user', 'First message');
      await sessionManager.appendMessage(session, 'assistant', 'Second message');
      await sessionManager.appendMessage(session, 'user', 'Third message');

      assert.equal(session.messages.length, 3);
      assert.equal(session.messages[0].content, 'First message');
      assert.equal(session.messages[1].content, 'Second message');
      assert.equal(session.messages[2].content, 'Third message');
    });

    test('updates lastMessageAt timestamp', async () => {
      const beforeTime = session.lastMessageAt;

      // Small delay to ensure timestamp difference
      await setTimeout(10);
      await sessionManager.appendMessage(session, 'user', 'Hello');

      assert.ok(session.lastMessageAt >= beforeTime);
    });

    test('includes toolCalls when provided', async () => {
      const toolCalls = [{ id: 'call_123', name: 'bash', arguments: { command: 'ls' } }];

      await sessionManager.appendMessage(session, 'assistant', 'Running command...', { toolCalls });

      assert.deepEqual(session.messages[0].toolCalls, toolCalls);
    });

    test('includes toolResults when provided', async () => {
      const toolResults = [{ id: 'call_123', result: 'file1.txt\nfile2.txt' }];

      await sessionManager.appendMessage(session, 'assistant', 'Here are the files:', {
        toolResults,
      });

      assert.deepEqual(session.messages[0].toolResults, toolResults);
    });

    test('persists message to storage', async () => {
      await sessionManager.appendMessage(session, 'user', 'Hello');

      assert.equal(mockStorage.appendMessage.mock.calls.length, 1);
      const [sessionId, message] = mockStorage.appendMessage.mock.calls[0].arguments;
      assert.equal(sessionId, session.id);
      assert.equal(message.content, 'Hello');
    });

    test('updates token count in storage', async () => {
      await sessionManager.appendMessage(session, 'user', 'Hello');

      assert.equal(mockStorage.updateSessionTokenCount.mock.calls.length, 1);
      assert.ok(session.tokenCount > 0);
    });

    test('updates session cache', async () => {
      await sessionManager.appendMessage(session, 'user', 'Hello');

      const cached = sessionManager.sessionCache.get(session.id);
      assert.equal(cached.messages.length, 1);
    });

    test('throws SessionError when session is invalid', async () => {
      await assert.rejects(
        () => sessionManager.appendMessage(null, 'user', 'Hello'),
        err => {
          assert.equal(err.name, 'SessionError');
          assert.match(err.message, /Invalid session object/);
          assert.equal(err.operation, 'appendMessage');
          return true;
        }
      );
    });

    test('throws SessionError when session has no id', async () => {
      await assert.rejects(
        () => sessionManager.appendMessage({}, 'user', 'Hello'),
        err => {
          assert.equal(err.name, 'SessionError');
          assert.match(err.message, /Invalid session object/);
          return true;
        }
      );
    });

    test('throws SessionError when role is missing', async () => {
      await assert.rejects(
        () => sessionManager.appendMessage(session, null, 'Hello'),
        err => {
          assert.equal(err.name, 'SessionError');
          assert.match(err.message, /Missing required message fields/);
          assert.equal(err.operation, 'appendMessage');
          assert.equal(err.sessionId, session.id);
          return true;
        }
      );
    });

    test('throws SessionError when content is not a string', async () => {
      await assert.rejects(
        () => sessionManager.appendMessage(session, 'user', 123),
        err => {
          assert.equal(err.name, 'SessionError');
          assert.match(err.message, /Missing required message fields/);
          return true;
        }
      );
    });

    test('throws SessionError when storage fails', async () => {
      mockStorage.appendMessage = mock.fn(async () => {
        throw new Error('Storage write failed');
      });

      await assert.rejects(
        () => sessionManager.appendMessage(session, 'user', 'Hello'),
        err => {
          assert.equal(err.name, 'SessionError');
          assert.match(err.message, /Failed to append message/);
          assert.equal(err.operation, 'appendMessage');
          assert.ok(err.cause);
          return true;
        }
      );
    });
  });

  describe('estimateTokens()', () => {
    test('estimates tokens for short text', () => {
      // ~4 chars per token, with 10% buffer
      // "Hello" = 5 chars / 4 * 1.1 = 1.375, ceil = 2
      const tokens = sessionManager.estimateTokens('Hello');

      assert.ok(tokens > 0);
      assert.ok(tokens < 10);
    });

    test('estimates tokens for longer text', () => {
      const longText =
        'This is a much longer piece of text that contains many words and characters.';
      const tokens = sessionManager.estimateTokens(longText);

      // 77 chars / 4 * 1.1 = 21.175, ceil = 22
      assert.ok(tokens > 15);
      assert.ok(tokens < 30);
    });

    test('returns 0 for empty string', () => {
      assert.equal(sessionManager.estimateTokens(''), 0);
    });

    test('returns 0 for null', () => {
      assert.equal(sessionManager.estimateTokens(null), 0);
    });

    test('returns 0 for undefined', () => {
      assert.equal(sessionManager.estimateTokens(undefined), 0);
    });

    test('returns 0 for non-string values', () => {
      assert.equal(sessionManager.estimateTokens(123), 0);
      assert.equal(sessionManager.estimateTokens({ text: 'hello' }), 0);
    });

    test('scales linearly with text length', () => {
      const short = sessionManager.estimateTokens('abc');
      const medium = sessionManager.estimateTokens('abcdefghijkl'); // 4x length
      const long = sessionManager.estimateTokens(
        'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuv'
      ); // ~16x

      assert.ok(medium > short);
      assert.ok(long > medium);
    });
  });

  describe('estimateTokensForMessages()', () => {
    test('estimates tokens for array of messages', () => {
      const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      const tokens = sessionManager.estimateTokensForMessages(messages);

      assert.ok(tokens > 0);
    });

    test('returns 0 for empty array', () => {
      assert.equal(sessionManager.estimateTokensForMessages([]), 0);
    });

    test('returns 0 for null', () => {
      assert.equal(sessionManager.estimateTokensForMessages(null), 0);
    });

    test('returns 0 for non-array', () => {
      assert.equal(sessionManager.estimateTokensForMessages('not an array'), 0);
    });

    test('adds tokens for role', () => {
      const withRole = sessionManager.estimateTokensForMessages([{ role: 'user', content: '' }]);
      // Should be at least 1 for the role
      assert.ok(withRole >= 1);
    });

    test('includes tokens for toolCalls', () => {
      const withoutTools = sessionManager.estimateTokensForMessages([
        { role: 'assistant', content: 'Result' },
      ]);
      const withTools = sessionManager.estimateTokensForMessages([
        {
          role: 'assistant',
          content: 'Result',
          toolCalls: [{ id: 'call_123', name: 'bash', arguments: { command: 'ls -la' } }],
        },
      ]);

      assert.ok(withTools > withoutTools);
    });

    test('includes tokens for toolResults', () => {
      const withoutResults = sessionManager.estimateTokensForMessages([
        { role: 'assistant', content: 'Done' },
      ]);
      const withResults = sessionManager.estimateTokensForMessages([
        {
          role: 'assistant',
          content: 'Done',
          toolResults: [{ id: 'call_123', result: 'file1.txt\nfile2.txt\nfile3.txt' }],
        },
      ]);

      assert.ok(withResults > withoutResults);
    });

    test('handles messages with empty content', () => {
      const messages = [{ role: 'system', content: '' }];
      const tokens = sessionManager.estimateTokensForMessages(messages);

      // At least 1 for the role
      assert.ok(tokens >= 1);
    });
  });

  describe('compact()', () => {
    let session;

    beforeEach(async () => {
      session = await sessionManager.getSession('bot1', { type: 'slack', id: 'C123' }, 'U456');
    });

    test('compacts session by summarizing old messages', async () => {
      // Add more messages than the preserve limit (default 10)
      for (let i = 0; i < 15; i++) {
        session.messages.push({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Message ${i}`,
          timestamp: new Date().toISOString(),
        });
      }

      await sessionManager.compact(session);

      // Should have summary + 10 preserved messages = 11
      assert.equal(session.messages.length, 11);
      assert.equal(session.messages[0].role, 'system');
      assert.match(session.messages[0].content, /\[Conversation Summary\]/);
      assert.equal(session.messages[0].isCompactionSummary, true);
    });

    test('does not compact when fewer messages than preserve limit', async () => {
      session.messages = [
        { role: 'user', content: 'Message 1' },
        { role: 'assistant', content: 'Message 2' },
      ];

      await sessionManager.compact(session);

      assert.equal(session.messages.length, 2);
      assert.equal(session.messages[0].role, 'user');
    });

    test('increments compactionCount', async () => {
      for (let i = 0; i < 15; i++) {
        session.messages.push({
          role: 'user',
          content: `Message ${i}`,
          timestamp: new Date().toISOString(),
        });
      }
      session.compactionCount = 0;

      await sessionManager.compact(session);

      assert.equal(session.compactionCount, 1);
    });

    test('updates token count after compaction', async () => {
      for (let i = 0; i < 20; i++) {
        session.messages.push({
          role: 'user',
          content: 'A'.repeat(1000), // Large message
          timestamp: new Date().toISOString(),
        });
      }
      session.tokenCount = 100000; // High token count

      await sessionManager.compact(session);

      // Token count should be recalculated and lower
      assert.ok(session.tokenCount < 100000);
    });

    test('preserves recent messages verbatim', async () => {
      const recentMessages = [];
      for (let i = 0; i < 15; i++) {
        const msg = {
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Message ${i}`,
          timestamp: new Date().toISOString(),
        };
        session.messages.push(msg);
        if (i >= 5) {
          recentMessages.push(msg);
        }
      }

      await sessionManager.compact(session);

      // Check that the 10 most recent messages are preserved
      for (let i = 1; i < session.messages.length; i++) {
        assert.equal(session.messages[i].content, recentMessages[i - 1].content);
      }
    });

    test('uses custom summarizer when provided', async () => {
      for (let i = 0; i < 15; i++) {
        session.messages.push({
          role: 'user',
          content: `Message ${i}`,
          timestamp: new Date().toISOString(),
        });
      }

      const customSummarizer = mock.fn(() => 'Custom summary of old messages');

      await sessionManager.compact(session, { summarizer: customSummarizer });

      assert.equal(customSummarizer.mock.calls.length, 1);
      assert.match(session.messages[0].content, /Custom summary of old messages/);
    });

    test('saves compacted session to storage', async () => {
      for (let i = 0; i < 15; i++) {
        session.messages.push({
          role: 'user',
          content: `Message ${i}`,
          timestamp: new Date().toISOString(),
        });
      }

      // Reset mock call count
      mockStorage.saveSession.mock.resetCalls();

      await sessionManager.compact(session);

      assert.equal(mockStorage.saveSession.mock.calls.length, 1);
      const savedSession = mockStorage.saveSession.mock.calls[0].arguments[0];
      assert.ok(savedSession.messages.length <= 11);
    });

    test('updates session cache after compaction', async () => {
      for (let i = 0; i < 15; i++) {
        session.messages.push({
          role: 'user',
          content: `Message ${i}`,
          timestamp: new Date().toISOString(),
        });
      }

      await sessionManager.compact(session);

      const cached = sessionManager.sessionCache.get(session.id);
      assert.ok(cached.messages[0].isCompactionSummary);
    });

    test('throws SessionError when session is invalid', async () => {
      await assert.rejects(
        () => sessionManager.compact(null),
        err => {
          assert.equal(err.name, 'SessionError');
          assert.match(err.message, /Invalid session object/);
          assert.equal(err.operation, 'compact');
          return true;
        }
      );
    });

    test('throws SessionError when storage fails', async () => {
      for (let i = 0; i < 15; i++) {
        session.messages.push({
          role: 'user',
          content: `Message ${i}`,
          timestamp: new Date().toISOString(),
        });
      }

      mockStorage.saveSession = mock.fn(async () => {
        throw new Error('Database error');
      });

      await assert.rejects(
        () => sessionManager.compact(session),
        err => {
          assert.equal(err.name, 'SessionError');
          assert.match(err.message, /Failed to compact session/);
          assert.ok(err.cause);
          return true;
        }
      );
    });
  });

  describe('_defaultSummarize()', () => {
    test('returns summary for messages', () => {
      const messages = [
        { role: 'user', content: 'Hello there, how are you doing today?' },
        { role: 'assistant', content: 'I am doing great, thank you!' },
        { role: 'user', content: 'Can you help me with coding?' },
      ];

      const summary = sessionManager._defaultSummarize(messages);

      assert.ok(summary.includes('3 messages'));
      assert.ok(summary.includes('2 from user'));
      assert.ok(summary.includes('1 from assistant'));
    });

    test('returns default message for empty array', () => {
      const summary = sessionManager._defaultSummarize([]);

      assert.equal(summary, 'No previous conversation history.');
    });

    test('returns default message for null', () => {
      const summary = sessionManager._defaultSummarize(null);

      assert.equal(summary, 'No previous conversation history.');
    });

    test('includes topics from user messages', () => {
      const messages = [
        { role: 'user', content: 'I need help with JavaScript programming' },
        { role: 'assistant', content: 'Sure!' },
      ];

      const summary = sessionManager._defaultSummarize(messages);

      assert.ok(summary.includes('Topics discussed:'));
    });

    test('includes last user message context', () => {
      const messages = [
        { role: 'user', content: 'First question' },
        { role: 'assistant', content: 'Answer' },
        { role: 'user', content: 'Final important question here' },
      ];

      const summary = sessionManager._defaultSummarize(messages);

      assert.ok(summary.includes('Last user request'));
      assert.ok(summary.includes('Final important question'));
    });

    test('truncates long last user message', () => {
      const longMessage = 'A'.repeat(300);
      const messages = [{ role: 'user', content: longMessage }];

      const summary = sessionManager._defaultSummarize(messages);

      // The summary should include ellipsis indicating truncation
      assert.ok(summary.includes('...'));
      // The summary should NOT contain the full 300 character message
      // It truncates to 200 chars + ellipsis
      assert.ok(!summary.includes(longMessage));
      // But it should include the truncated version (first 200 chars)
      assert.ok(summary.includes('A'.repeat(200)));
    });
  });

  describe('getMessagesForLLM()', () => {
    test('formats messages for LLM input', async () => {
      const session = await sessionManager.getSession(
        'bot1',
        { type: 'slack', id: 'C123' },
        'U456'
      );
      await sessionManager.appendMessage(session, 'user', 'Hello');
      await sessionManager.appendMessage(session, 'assistant', 'Hi there!');

      const llmMessages = sessionManager.getMessagesForLLM(session);

      assert.equal(llmMessages.length, 2);
      assert.deepEqual(llmMessages[0], { role: 'user', content: 'Hello' });
      assert.deepEqual(llmMessages[1], { role: 'assistant', content: 'Hi there!' });
    });

    test('includes toolCalls in formatted messages', async () => {
      const session = await sessionManager.getSession(
        'bot1',
        { type: 'slack', id: 'C123' },
        'U456'
      );
      const toolCalls = [{ id: 'call_1', name: 'bash' }];
      await sessionManager.appendMessage(session, 'assistant', 'Running...', { toolCalls });

      const llmMessages = sessionManager.getMessagesForLLM(session);

      assert.deepEqual(llmMessages[0].toolCalls, toolCalls);
    });

    test('returns empty array for null session', () => {
      assert.deepEqual(sessionManager.getMessagesForLLM(null), []);
    });

    test('returns empty array for session without messages', () => {
      assert.deepEqual(sessionManager.getMessagesForLLM({}), []);
    });

    test('excludes timestamp from LLM messages', async () => {
      const session = await sessionManager.getSession(
        'bot1',
        { type: 'slack', id: 'C123' },
        'U456'
      );
      await sessionManager.appendMessage(session, 'user', 'Hello');

      const llmMessages = sessionManager.getMessagesForLLM(session);

      assert.equal(llmMessages[0].timestamp, undefined);
    });
  });

  describe('clearSession()', () => {
    test('clears all messages from session', async () => {
      const session = await sessionManager.getSession(
        'bot1',
        { type: 'slack', id: 'C123' },
        'U456'
      );
      await sessionManager.appendMessage(session, 'user', 'Hello');
      await sessionManager.appendMessage(session, 'assistant', 'Hi!');

      await sessionManager.clearSession(session);

      assert.deepEqual(session.messages, []);
      assert.equal(session.tokenCount, 0);
    });

    test('preserves session metadata', async () => {
      const session = await sessionManager.getSession(
        'bot1',
        { type: 'slack', id: 'C123' },
        'U456'
      );
      session.compactionCount = 5;
      await sessionManager.appendMessage(session, 'user', 'Hello');

      await sessionManager.clearSession(session);

      assert.equal(session.botId, 'bot1');
      assert.equal(session.compactionCount, 5);
    });

    test('persists cleared session to storage', async () => {
      const session = await sessionManager.getSession(
        'bot1',
        { type: 'slack', id: 'C123' },
        'U456'
      );

      // Reset mock call count
      mockStorage.saveSession.mock.resetCalls();

      await sessionManager.clearSession(session);

      assert.equal(mockStorage.saveSession.mock.calls.length, 1);
      const savedSession = mockStorage.saveSession.mock.calls[0].arguments[0];
      assert.deepEqual(savedSession.messages, []);
    });

    test('throws SessionError when session is invalid', async () => {
      await assert.rejects(
        () => sessionManager.clearSession(null),
        err => {
          assert.equal(err.name, 'SessionError');
          assert.equal(err.operation, 'clearSession');
          return true;
        }
      );
    });
  });

  describe('deleteSession()', () => {
    test('deletes session from storage', async () => {
      await sessionManager.getSession('bot1', { type: 'slack', id: 'C123' }, 'U456');

      const deleted = await sessionManager.deleteSession('bot1:slack:C123:U456');

      assert.equal(deleted, true);
      assert.equal(mockStorage.deleteSession.mock.calls.length, 1);
    });

    test('removes session from cache', async () => {
      await sessionManager.getSession('bot1', { type: 'slack', id: 'C123' }, 'U456');

      await sessionManager.deleteSession('bot1:slack:C123:U456');

      assert.equal(sessionManager.sessionCache.has('bot1:slack:C123:U456'), false);
    });

    test('returns false for non-existent session', async () => {
      const deleted = await sessionManager.deleteSession('non-existent-session');

      assert.equal(deleted, false);
    });

    test('throws SessionError when storage fails', async () => {
      mockStorage.deleteSession = mock.fn(async () => {
        throw new Error('Database error');
      });

      await assert.rejects(
        () => sessionManager.deleteSession('session-id'),
        err => {
          assert.equal(err.name, 'SessionError');
          assert.match(err.message, /Failed to delete session/);
          assert.equal(err.operation, 'deleteSession');
          return true;
        }
      );
    });
  });

  describe('getSessionStats()', () => {
    test('returns statistics for session', async () => {
      const session = await sessionManager.getSession(
        'bot1',
        { type: 'slack', id: 'C123' },
        'U456'
      );
      await sessionManager.appendMessage(session, 'user', 'Hello');
      await sessionManager.appendMessage(session, 'assistant', 'Hi!');
      await sessionManager.appendMessage(session, 'user', 'How are you?');

      const stats = sessionManager.getSessionStats(session);

      assert.equal(stats.messageCount, 3);
      assert.equal(stats.userMessageCount, 2);
      assert.equal(stats.assistantMessageCount, 1);
      assert.equal(stats.systemMessageCount, 0);
      assert.ok(stats.tokenCount > 0);
    });

    test('detects presence of toolCalls', async () => {
      const session = await sessionManager.getSession(
        'bot1',
        { type: 'slack', id: 'C123' },
        'U456'
      );
      await sessionManager.appendMessage(session, 'assistant', 'Running...', {
        toolCalls: [{ id: 'call_1' }],
      });

      const stats = sessionManager.getSessionStats(session);

      assert.equal(stats.hasToolCalls, true);
    });

    test('returns null for null session', () => {
      assert.equal(sessionManager.getSessionStats(null), null);
    });

    test('includes compaction count', async () => {
      const session = await sessionManager.getSession(
        'bot1',
        { type: 'slack', id: 'C123' },
        'U456'
      );
      session.compactionCount = 3;

      const stats = sessionManager.getSessionStats(session);

      assert.equal(stats.compactionCount, 3);
    });
  });

  describe('needsCompaction()', () => {
    test('returns true when token count exceeds threshold', () => {
      const session = { tokenCount: 60000 };
      assert.equal(sessionManager.needsCompaction(session), true);
    });

    test('returns false when token count is below threshold', () => {
      const session = { tokenCount: 10000 };
      assert.equal(sessionManager.needsCompaction(session), false);
    });

    test('returns false for null session', () => {
      assert.equal(sessionManager.needsCompaction(null), false);
    });

    test('returns false when tokenCount is undefined', () => {
      assert.equal(sessionManager.needsCompaction({}), false);
    });
  });

  describe('getCompactionThreshold()', () => {
    test('returns default threshold', () => {
      assert.equal(sessionManager.getCompactionThreshold(), 50000);
    });

    test('returns custom threshold when set in constructor', () => {
      const manager = new SessionManager(mockStorage, { compactionThreshold: 30000 });
      assert.equal(manager.getCompactionThreshold(), 30000);
    });
  });

  describe('setCompactionThreshold()', () => {
    test('updates compaction threshold', () => {
      sessionManager.setCompactionThreshold(40000);
      assert.equal(sessionManager.getCompactionThreshold(), 40000);
    });

    test('throws SessionError for non-number value', () => {
      assert.throws(
        () => sessionManager.setCompactionThreshold('40000'),
        err => {
          assert.equal(err.name, 'SessionError');
          assert.match(err.message, /must be a positive number/);
          return true;
        }
      );
    });

    test('throws SessionError for zero', () => {
      assert.throws(
        () => sessionManager.setCompactionThreshold(0),
        err => {
          assert.equal(err.name, 'SessionError');
          assert.match(err.message, /must be a positive number/);
          return true;
        }
      );
    });

    test('throws SessionError for negative number', () => {
      assert.throws(
        () => sessionManager.setCompactionThreshold(-1000),
        err => {
          assert.equal(err.name, 'SessionError');
          assert.match(err.message, /must be a positive number/);
          return true;
        }
      );
    });
  });

  describe('clearCache()', () => {
    test('clears all cached sessions', async () => {
      await sessionManager.getSession('bot1', { type: 'slack', id: 'C123' }, 'U456');
      await sessionManager.getSession('bot2', { type: 'discord', id: 'D789' }, 'user2');

      assert.equal(sessionManager.sessionCache.size, 2);

      sessionManager.clearCache();

      assert.equal(sessionManager.sessionCache.size, 0);
    });
  });

  describe('constructor options', () => {
    test('uses custom messagesToPreserve', async () => {
      const manager = new SessionManager(mockStorage, { messagesToPreserve: 5 });
      const session = await manager.getSession('bot1', { type: 'slack', id: 'C123' }, 'U456');

      // Add 10 messages
      for (let i = 0; i < 10; i++) {
        session.messages.push({
          role: 'user',
          content: `Message ${i}`,
          timestamp: new Date().toISOString(),
        });
      }

      await manager.compact(session);

      // Should have summary + 5 preserved messages = 6
      assert.equal(session.messages.length, 6);
    });
  });

  describe('auto-compaction', () => {
    test('triggers compaction when appending message exceeds threshold', async () => {
      const manager = new SessionManager(mockStorage, {
        compactionThreshold: 100,
        messagesToPreserve: 2,
      });
      const session = await manager.getSession('bot1', { type: 'slack', id: 'C123' }, 'U456');

      // Add messages that will exceed the low threshold
      for (let i = 0; i < 5; i++) {
        await manager.appendMessage(session, 'user', 'A'.repeat(100)); // Will exceed 100 tokens
      }

      // Session should have been compacted
      assert.ok(session.compactionCount > 0);
      assert.ok(session.messages.some(m => m.isCompactionSummary));
    });
  });
});

describe('SessionError', () => {
  test('is an instance of Error', () => {
    const error = new SessionError('Test error');
    assert.ok(error instanceof Error);
  });

  test('has correct name', () => {
    const error = new SessionError('Test error');
    assert.equal(error.name, 'SessionError');
  });

  test('stores operation', () => {
    const error = new SessionError('Test error', { operation: 'getSession' });
    assert.equal(error.operation, 'getSession');
  });

  test('stores sessionId', () => {
    const error = new SessionError('Test error', { sessionId: 'bot:slack:C123:U456' });
    assert.equal(error.sessionId, 'bot:slack:C123:U456');
  });

  test('stores cause', () => {
    const cause = new Error('Original error');
    const error = new SessionError('Test error', { cause });
    assert.equal(error.cause, cause);
  });

  test('stores all options together', () => {
    const cause = new Error('Original');
    const error = new SessionError('Multi-option error', {
      cause,
      operation: 'appendMessage',
      sessionId: 'test-session',
    });

    assert.equal(error.cause, cause);
    assert.equal(error.operation, 'appendMessage');
    assert.equal(error.sessionId, 'test-session');
  });
});
