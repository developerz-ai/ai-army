/**
 * Unit tests for test fixtures
 *
 * Validates that mock data is correctly structured and
 * helper functions work as expected.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  MOCK_MESSAGES,
  MOCK_MESSAGE_ARRAYS,
  MOCK_SESSIONS,
  MOCK_TOOL_CALLS,
  MOCK_TOOL_RESULTS,
  MOCK_CHANNELS,
  MOCK_USER_IDS,
  MOCK_BOT_IDS,
  createMockSession,
  createMockMessage,
  generateMessageSequence,
} from './fixtures.js';

describe('MOCK_MESSAGES', () => {
  test('has required message types', () => {
    assert.ok(MOCK_MESSAGES.userSimple);
    assert.ok(MOCK_MESSAGES.assistantSimple);
    assert.ok(MOCK_MESSAGES.systemInstruction);
    assert.ok(MOCK_MESSAGES.assistantWithToolCalls);
    assert.ok(MOCK_MESSAGES.assistantWithToolResults);
    assert.ok(MOCK_MESSAGES.compactionSummary);
  });

  test('userSimple has correct structure', () => {
    const msg = MOCK_MESSAGES.userSimple;
    assert.equal(msg.role, 'user');
    assert.ok(typeof msg.content === 'string');
    assert.ok(msg.content.length > 0);
    assert.ok(msg.timestamp);
  });

  test('assistantSimple has correct structure', () => {
    const msg = MOCK_MESSAGES.assistantSimple;
    assert.equal(msg.role, 'assistant');
    assert.ok(typeof msg.content === 'string');
    assert.ok(msg.content.length > 0);
    assert.ok(msg.timestamp);
  });

  test('systemInstruction has correct role', () => {
    assert.equal(MOCK_MESSAGES.systemInstruction.role, 'system');
  });

  test('assistantWithToolCalls has toolCalls array', () => {
    const msg = MOCK_MESSAGES.assistantWithToolCalls;
    assert.equal(msg.role, 'assistant');
    assert.ok(Array.isArray(msg.toolCalls));
    assert.ok(msg.toolCalls.length > 0);
    assert.ok(msg.toolCalls[0].id);
    assert.ok(msg.toolCalls[0].name);
    assert.ok(msg.toolCalls[0].arguments);
  });

  test('assistantWithToolResults has toolResults array', () => {
    const msg = MOCK_MESSAGES.assistantWithToolResults;
    assert.ok(Array.isArray(msg.toolResults));
    assert.ok(msg.toolResults.length > 0);
    assert.ok(msg.toolResults[0].id);
    assert.ok(msg.toolResults[0].result);
  });

  test('compactionSummary has isCompactionSummary flag', () => {
    const msg = MOCK_MESSAGES.compactionSummary;
    assert.equal(msg.role, 'system');
    assert.equal(msg.isCompactionSummary, true);
    assert.ok(msg.content.includes('[Conversation Summary]'));
  });

  test('userLongMessage has substantial content', () => {
    assert.ok(MOCK_MESSAGES.userLongMessage.content.length > 500);
  });

  test('emptyContent has empty string content', () => {
    assert.equal(MOCK_MESSAGES.emptyContent.content, '');
  });
});

describe('MOCK_MESSAGE_ARRAYS', () => {
  test('simpleConversation has two messages', () => {
    assert.equal(MOCK_MESSAGE_ARRAYS.simpleConversation.length, 2);
    assert.equal(MOCK_MESSAGE_ARRAYS.simpleConversation[0].role, 'user');
    assert.equal(MOCK_MESSAGE_ARRAYS.simpleConversation[1].role, 'assistant');
  });

  test('conversationWithTools has tool-related messages', () => {
    const convo = MOCK_MESSAGE_ARRAYS.conversationWithTools;
    assert.ok(convo.length >= 2);
    assert.ok(convo.some(m => m.toolCalls));
  });

  test('multiTurnConversation starts with system message', () => {
    assert.equal(MOCK_MESSAGE_ARRAYS.multiTurnConversation[0].role, 'system');
    assert.ok(MOCK_MESSAGE_ARRAYS.multiTurnConversation.length >= 3);
  });

  test('compactedConversation starts with compaction summary', () => {
    const convo = MOCK_MESSAGE_ARRAYS.compactedConversation;
    assert.equal(convo[0].isCompactionSummary, true);
  });

  test('longConversation has 15 messages', () => {
    assert.equal(MOCK_MESSAGE_ARRAYS.longConversation.length, 15);
  });

  test('longConversation alternates user/assistant', () => {
    const convo = MOCK_MESSAGE_ARRAYS.longConversation;
    for (let i = 0; i < convo.length; i++) {
      const expectedRole = i % 2 === 0 ? 'user' : 'assistant';
      assert.equal(convo[i].role, expectedRole, `Message ${i} should be ${expectedRole}`);
    }
  });

  test('highTokenConversation has 10 high-content messages', () => {
    const convo = MOCK_MESSAGE_ARRAYS.highTokenConversation;
    assert.equal(convo.length, 10);
    assert.ok(convo[0].content.length >= 1000);
  });
});

describe('MOCK_SESSIONS', () => {
  test('newSession is empty', () => {
    const session = MOCK_SESSIONS.newSession;
    assert.ok(session.id);
    assert.ok(session.botId);
    assert.ok(session.userId);
    assert.ok(session.channelId);
    assert.ok(session.channelType);
    assert.deepEqual(session.messages, []);
    assert.equal(session.tokenCount, 0);
    assert.equal(session.compactionCount, 0);
  });

  test('activeSession has messages', () => {
    const session = MOCK_SESSIONS.activeSession;
    assert.ok(session.messages.length > 0);
    assert.ok(session.tokenCount > 0);
    assert.equal(session.compactionCount, 0);
  });

  test('compactedSession has compaction count > 0', () => {
    const session = MOCK_SESSIONS.compactedSession;
    assert.ok(session.compactionCount > 0);
    assert.ok(session.messages.some(m => m.isCompactionSummary));
  });

  test('highTokenSession exceeds default threshold', () => {
    const session = MOCK_SESSIONS.highTokenSession;
    assert.ok(session.tokenCount > 50000);
  });

  test('toolUseSession has tool calls', () => {
    const session = MOCK_SESSIONS.toolUseSession;
    assert.ok(session.messages.some(m => m.toolCalls));
  });

  test('multiCompactedSession has multiple compactions', () => {
    const session = MOCK_SESSIONS.multiCompactedSession;
    assert.ok(session.compactionCount >= 3);
  });

  test('session ids follow expected format', () => {
    const session = MOCK_SESSIONS.newSession;
    const parts = session.id.split(':');
    assert.equal(parts.length, 4);
    assert.equal(parts[0], session.botId);
    assert.equal(parts[1], session.channelType);
    assert.equal(parts[2], session.channelId);
    assert.equal(parts[3], session.userId);
  });
});

describe('MOCK_TOOL_CALLS', () => {
  test('has required tool types', () => {
    assert.ok(MOCK_TOOL_CALLS.bashLs);
    assert.ok(MOCK_TOOL_CALLS.bashWithTimeout);
    assert.ok(MOCK_TOOL_CALLS.readFile);
    assert.ok(MOCK_TOOL_CALLS.writeFile);
    assert.ok(MOCK_TOOL_CALLS.grep);
  });

  test('bashLs has correct structure', () => {
    const call = MOCK_TOOL_CALLS.bashLs;
    assert.ok(call.id);
    assert.equal(call.name, 'bash');
    assert.ok(call.arguments.command);
  });

  test('bashWithTimeout has timeout argument', () => {
    assert.ok(MOCK_TOOL_CALLS.bashWithTimeout.arguments.timeout);
  });

  test('readFile has path argument', () => {
    assert.ok(MOCK_TOOL_CALLS.readFile.arguments.path);
  });

  test('writeFile has path and content arguments', () => {
    const call = MOCK_TOOL_CALLS.writeFile;
    assert.ok(call.arguments.path);
    assert.ok(call.arguments.content);
  });
});

describe('MOCK_TOOL_RESULTS', () => {
  test('has required result types', () => {
    assert.ok(MOCK_TOOL_RESULTS.bashLsSuccess);
    assert.ok(MOCK_TOOL_RESULTS.bashError);
    assert.ok(MOCK_TOOL_RESULTS.readFileSuccess);
    assert.ok(MOCK_TOOL_RESULTS.readFileNotFound);
    assert.ok(MOCK_TOOL_RESULTS.writeFileSuccess);
  });

  test('success results have result string', () => {
    assert.ok(typeof MOCK_TOOL_RESULTS.bashLsSuccess.result === 'string');
    assert.ok(MOCK_TOOL_RESULTS.bashLsSuccess.result.length > 0);
  });

  test('error results have error flag', () => {
    assert.equal(MOCK_TOOL_RESULTS.bashError.error, true);
    assert.equal(MOCK_TOOL_RESULTS.readFileNotFound.error, true);
  });

  test('result ids match corresponding tool call ids', () => {
    assert.equal(MOCK_TOOL_RESULTS.bashLsSuccess.id, MOCK_TOOL_CALLS.bashLs.id);
  });
});

describe('MOCK_CHANNELS', () => {
  test('has required channel types', () => {
    assert.ok(MOCK_CHANNELS.slackGeneral);
    assert.ok(MOCK_CHANNELS.slackDM);
    assert.ok(MOCK_CHANNELS.discordGuild);
    assert.ok(MOCK_CHANNELS.restApi);
  });

  test('channels have type and id', () => {
    for (const channel of Object.values(MOCK_CHANNELS)) {
      assert.ok(channel.type);
      assert.ok(channel.id);
    }
  });
});

describe('MOCK_USER_IDS', () => {
  test('has required user types', () => {
    assert.ok(MOCK_USER_IDS.slackUser1);
    assert.ok(MOCK_USER_IDS.slackUser2);
    assert.ok(MOCK_USER_IDS.discordUser);
    assert.ok(MOCK_USER_IDS.restClient);
  });
});

describe('MOCK_BOT_IDS', () => {
  test('has required bot types', () => {
    assert.ok(MOCK_BOT_IDS.supportBot);
    assert.ok(MOCK_BOT_IDS.codeReviewer);
    assert.ok(MOCK_BOT_IDS.devopsBot);
    assert.ok(MOCK_BOT_IDS.testBot);
  });
});

describe('createMockSession()', () => {
  test('creates session with defaults', () => {
    const session = createMockSession();

    assert.ok(session.id);
    assert.equal(session.botId, 'test-bot');
    assert.equal(session.userId, 'U456');
    assert.equal(session.channelId, 'C123');
    assert.equal(session.channelType, 'slack');
    assert.deepEqual(session.messages, []);
    assert.equal(session.tokenCount, 0);
    assert.equal(session.compactionCount, 0);
    assert.ok(session.createdAt instanceof Date);
    assert.ok(session.lastMessageAt instanceof Date);
  });

  test('creates session with overrides', () => {
    const session = createMockSession({
      botId: 'custom-bot',
      userId: 'custom-user',
      tokenCount: 500,
    });

    assert.equal(session.botId, 'custom-bot');
    assert.equal(session.userId, 'custom-user');
    assert.equal(session.tokenCount, 500);
  });

  test('generates correct id from overridden properties', () => {
    const session = createMockSession({
      botId: 'my-bot',
      channelType: 'discord',
      channelId: 'D999',
      userId: 'user123',
    });

    assert.equal(session.id, 'my-bot:discord:D999:user123');
  });

  test('allows messages override', () => {
    const messages = [MOCK_MESSAGES.userSimple];
    const session = createMockSession({ messages });

    assert.deepEqual(session.messages, messages);
  });
});

describe('createMockMessage()', () => {
  test('creates user message', () => {
    const msg = createMockMessage('user', 'Hello there');

    assert.equal(msg.role, 'user');
    assert.equal(msg.content, 'Hello there');
    assert.ok(msg.timestamp);
  });

  test('creates assistant message', () => {
    const msg = createMockMessage('assistant', 'Hi!');

    assert.equal(msg.role, 'assistant');
    assert.equal(msg.content, 'Hi!');
  });

  test('creates system message', () => {
    const msg = createMockMessage('system', 'Instructions');

    assert.equal(msg.role, 'system');
  });

  test('accepts custom timestamp', () => {
    const timestamp = '2025-01-01T00:00:00.000Z';
    const msg = createMockMessage('user', 'Test', { timestamp });

    assert.equal(msg.timestamp, timestamp);
  });

  test('includes toolCalls when provided', () => {
    const toolCalls = [MOCK_TOOL_CALLS.bashLs];
    const msg = createMockMessage('assistant', 'Running...', { toolCalls });

    assert.deepEqual(msg.toolCalls, toolCalls);
  });

  test('includes toolResults when provided', () => {
    const toolResults = [MOCK_TOOL_RESULTS.bashLsSuccess];
    const msg = createMockMessage('assistant', 'Done', { toolResults });

    assert.deepEqual(msg.toolResults, toolResults);
  });

  test('includes isCompactionSummary when provided', () => {
    const msg = createMockMessage('system', 'Summary', { isCompactionSummary: true });

    assert.equal(msg.isCompactionSummary, true);
  });

  test('does not include optional fields when not provided', () => {
    const msg = createMockMessage('user', 'Simple message');

    assert.equal(msg.toolCalls, undefined);
    assert.equal(msg.toolResults, undefined);
    assert.equal(msg.isCompactionSummary, undefined);
  });
});

describe('generateMessageSequence()', () => {
  test('generates correct number of messages', () => {
    const messages = generateMessageSequence(5);
    assert.equal(messages.length, 5);
  });

  test('alternates user and assistant roles', () => {
    const messages = generateMessageSequence(4);

    assert.equal(messages[0].role, 'user');
    assert.equal(messages[1].role, 'assistant');
    assert.equal(messages[2].role, 'user');
    assert.equal(messages[3].role, 'assistant');
  });

  test('respects custom content length', () => {
    const messages = generateMessageSequence(1, { contentLength: 100 });
    assert.ok(messages[0].content.length >= 85); // ~15 chars for "Message N: "
  });

  test('uses custom start time', () => {
    const startTime = new Date('2025-01-01T00:00:00.000Z');
    const messages = generateMessageSequence(1, { startTime });

    assert.equal(messages[0].timestamp, startTime.toISOString());
  });

  test('respects interval between messages', () => {
    const startTime = new Date('2025-01-01T00:00:00.000Z');
    const intervalMs = 30000;
    const messages = generateMessageSequence(3, { startTime, intervalMs });

    const time0 = new Date(messages[0].timestamp).getTime();
    const time1 = new Date(messages[1].timestamp).getTime();
    const time2 = new Date(messages[2].timestamp).getTime();

    assert.equal(time1 - time0, intervalMs);
    assert.equal(time2 - time1, intervalMs);
  });

  test('generates empty array for count 0', () => {
    const messages = generateMessageSequence(0);
    assert.deepEqual(messages, []);
  });

  test('each message has required fields', () => {
    const messages = generateMessageSequence(3);

    for (const msg of messages) {
      assert.ok(msg.role);
      assert.ok(typeof msg.content === 'string');
      assert.ok(msg.timestamp);
    }
  });
});
