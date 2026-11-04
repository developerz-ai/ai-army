/**
 * Test Fixtures
 *
 * Provides reusable mock data for testing SessionManager and related components.
 * Includes mock messages, sessions, tool calls, and tool results.
 *
 * @module test/helpers/fixtures
 */

/**
 * Mock messages of various types for testing
 */
export const MOCK_MESSAGES = {
  /**
   * Simple user message
   */
  userSimple: {
    role: 'user',
    content: 'Hello, how can you help me today?',
    timestamp: '2025-01-15T10:00:00.000Z',
  },

  /**
   * Simple assistant message
   */
  assistantSimple: {
    role: 'assistant',
    content: 'Hi there! I can help you with coding, debugging, and answering questions.',
    timestamp: '2025-01-15T10:00:05.000Z',
  },

  /**
   * System message (typically used for instructions)
   */
  systemInstruction: {
    role: 'system',
    content: 'You are a helpful coding assistant. Be concise and accurate.',
    timestamp: '2025-01-15T09:59:55.000Z',
  },

  /**
   * User message asking for code execution
   */
  userCodeRequest: {
    role: 'user',
    content: 'Can you list the files in the current directory?',
    timestamp: '2025-01-15T10:01:00.000Z',
  },

  /**
   * Assistant message with tool calls
   */
  assistantWithToolCalls: {
    role: 'assistant',
    content: "I'll list the files in the current directory for you.",
    timestamp: '2025-01-15T10:01:05.000Z',
    toolCalls: [
      {
        id: 'call_abc123',
        name: 'bash',
        arguments: { command: 'ls -la' },
      },
    ],
  },

  /**
   * Assistant message with multiple tool calls
   */
  assistantMultipleToolCalls: {
    role: 'assistant',
    content: 'Let me check both the files and the git status.',
    timestamp: '2025-01-15T10:02:00.000Z',
    toolCalls: [
      {
        id: 'call_def456',
        name: 'bash',
        arguments: { command: 'ls -la' },
      },
      {
        id: 'call_ghi789',
        name: 'bash',
        arguments: { command: 'git status' },
      },
    ],
  },

  /**
   * Assistant message with tool results
   */
  assistantWithToolResults: {
    role: 'assistant',
    content: 'Here are the files in the current directory:',
    timestamp: '2025-01-15T10:01:10.000Z',
    toolResults: [
      {
        id: 'call_abc123',
        result:
          'total 24\ndrwxr-xr-x  5 user user 4096 Jan 15 10:00 .\n-rw-r--r--  1 user user  512 Jan 15 10:00 package.json\n-rw-r--r--  1 user user 1024 Jan 15 10:00 README.md',
      },
    ],
  },

  /**
   * User message with code snippet
   */
  userWithCode: {
    role: 'user',
    content:
      'Can you fix this JavaScript code?\n\n```javascript\nfunction add(a, b) {\n  return a + b\n}\nconsole.log(add(1, 2))\n```',
    timestamp: '2025-01-15T10:03:00.000Z',
  },

  /**
   * Long user message (for compaction testing)
   */
  userLongMessage: {
    role: 'user',
    content: `I need help with a complex problem. ${'This is a very long message that contains a lot of text. '.repeat(
      20
    )}Please help me understand what to do.`,
    timestamp: '2025-01-15T10:04:00.000Z',
  },

  /**
   * Long assistant response (for compaction testing)
   */
  assistantLongResponse: {
    role: 'assistant',
    content: `Let me explain this in detail. ${'Here is a comprehensive explanation with many details and examples. '.repeat(
      30
    )}I hope this helps clarify the concept.`,
    timestamp: '2025-01-15T10:04:30.000Z',
  },

  /**
   * User message asking about error
   */
  userErrorQuestion: {
    role: 'user',
    content:
      "I'm getting an error: TypeError: Cannot read property 'map' of undefined. How do I fix this?",
    timestamp: '2025-01-15T10:05:00.000Z',
  },

  /**
   * Assistant debugging response
   */
  assistantDebugging: {
    role: 'assistant',
    content:
      'This error occurs when you try to call .map() on a value that is undefined. Let me check your code.',
    timestamp: '2025-01-15T10:05:10.000Z',
    toolCalls: [
      {
        id: 'call_debug001',
        name: 'readFile',
        arguments: { path: './src/app.js' },
      },
    ],
  },

  /**
   * Compaction summary message
   */
  compactionSummary: {
    role: 'system',
    content:
      '[Conversation Summary]\nPrevious conversation had 15 messages (8 from user, 7 from assistant).\nTopics discussed: javascript, debugging, error, handling.\nLast user request before summary: "Can you help me fix the TypeError?"',
    timestamp: '2025-01-15T10:00:00.000Z',
    isCompactionSummary: true,
  },

  /**
   * Empty content message
   */
  emptyContent: {
    role: 'user',
    content: '',
    timestamp: '2025-01-15T10:06:00.000Z',
  },
};

/**
 * Pre-built arrays of messages for common test scenarios
 */
export const MOCK_MESSAGE_ARRAYS = {
  /**
   * Simple two-message conversation
   */
  simpleConversation: [MOCK_MESSAGES.userSimple, MOCK_MESSAGES.assistantSimple],

  /**
   * Conversation with tool usage
   */
  conversationWithTools: [
    MOCK_MESSAGES.userCodeRequest,
    MOCK_MESSAGES.assistantWithToolCalls,
    MOCK_MESSAGES.assistantWithToolResults,
  ],

  /**
   * Multi-turn conversation
   */
  multiTurnConversation: [
    MOCK_MESSAGES.systemInstruction,
    MOCK_MESSAGES.userSimple,
    MOCK_MESSAGES.assistantSimple,
    MOCK_MESSAGES.userCodeRequest,
    MOCK_MESSAGES.assistantWithToolCalls,
    MOCK_MESSAGES.assistantWithToolResults,
  ],

  /**
   * Conversation after compaction
   */
  compactedConversation: [
    MOCK_MESSAGES.compactionSummary,
    MOCK_MESSAGES.userErrorQuestion,
    MOCK_MESSAGES.assistantDebugging,
  ],

  /**
   * Long conversation for compaction testing (15+ messages)
   */
  longConversation: Array.from({ length: 15 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `Message ${i + 1}: This is ${i % 2 === 0 ? 'a user' : 'an assistant'} message in the conversation.`,
    timestamp: new Date(Date.now() + i * 60000).toISOString(),
  })),

  /**
   * High token count conversation for threshold testing
   */
  highTokenConversation: Array.from({ length: 10 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: 'A'.repeat(1000), // ~250 tokens each
    timestamp: new Date(Date.now() + i * 60000).toISOString(),
  })),
};

/**
 * Mock sessions with various states
 */
export const MOCK_SESSIONS = {
  /**
   * New empty session
   */
  newSession: {
    id: 'test-bot:slack:C123ABC:U456DEF',
    botId: 'test-bot',
    userId: 'U456DEF',
    channelId: 'C123ABC',
    channelType: 'slack',
    messages: [],
    tokenCount: 0,
    compactionCount: 0,
    createdAt: new Date('2025-01-15T10:00:00.000Z'),
    lastMessageAt: new Date('2025-01-15T10:00:00.000Z'),
  },

  /**
   * Session with a few messages
   */
  activeSession: {
    id: 'work-bot:slack:C789XYZ:U123ABC',
    botId: 'work-bot',
    userId: 'U123ABC',
    channelId: 'C789XYZ',
    channelType: 'slack',
    messages: [
      MOCK_MESSAGES.userSimple,
      MOCK_MESSAGES.assistantSimple,
      MOCK_MESSAGES.userCodeRequest,
      MOCK_MESSAGES.assistantWithToolCalls,
    ],
    tokenCount: 150,
    compactionCount: 0,
    createdAt: new Date('2025-01-15T09:00:00.000Z'),
    lastMessageAt: new Date('2025-01-15T10:01:05.000Z'),
  },

  /**
   * Session that has been compacted once
   */
  compactedSession: {
    id: 'dev-bot:discord:987654321:user456',
    botId: 'dev-bot',
    userId: 'user456',
    channelId: '987654321',
    channelType: 'discord',
    messages: [
      MOCK_MESSAGES.compactionSummary,
      MOCK_MESSAGES.userErrorQuestion,
      MOCK_MESSAGES.assistantDebugging,
    ],
    tokenCount: 500,
    compactionCount: 1,
    createdAt: new Date('2025-01-14T08:00:00.000Z'),
    lastMessageAt: new Date('2025-01-15T10:05:10.000Z'),
  },

  /**
   * Session with high token count (needs compaction)
   */
  highTokenSession: {
    id: 'api-bot:rest:api-v1:client-xyz',
    botId: 'api-bot',
    userId: 'client-xyz',
    channelId: 'api-v1',
    channelType: 'rest',
    messages: MOCK_MESSAGE_ARRAYS.highTokenConversation,
    tokenCount: 55000, // Above default threshold of 50000
    compactionCount: 0,
    createdAt: new Date('2025-01-15T08:00:00.000Z'),
    lastMessageAt: new Date('2025-01-15T10:10:00.000Z'),
  },

  /**
   * Session with tool calls and results
   */
  toolUseSession: {
    id: 'code-bot:slack:C555DEV:U888ENG',
    botId: 'code-bot',
    userId: 'U888ENG',
    channelId: 'C555DEV',
    channelType: 'slack',
    messages: MOCK_MESSAGE_ARRAYS.conversationWithTools,
    tokenCount: 200,
    compactionCount: 0,
    createdAt: new Date('2025-01-15T09:30:00.000Z'),
    lastMessageAt: new Date('2025-01-15T10:01:10.000Z'),
  },

  /**
   * Multi-compacted session
   */
  multiCompactedSession: {
    id: 'support-bot:slack:C111SUP:U222USR',
    botId: 'support-bot',
    userId: 'U222USR',
    channelId: 'C111SUP',
    channelType: 'slack',
    messages: [
      {
        role: 'system',
        content:
          '[Conversation Summary]\nThis is the third compaction. Previous compactions covered 45 messages total.',
        timestamp: '2025-01-15T08:00:00.000Z',
        isCompactionSummary: true,
      },
      MOCK_MESSAGES.userSimple,
      MOCK_MESSAGES.assistantSimple,
    ],
    tokenCount: 300,
    compactionCount: 3,
    createdAt: new Date('2025-01-10T08:00:00.000Z'),
    lastMessageAt: new Date('2025-01-15T10:00:05.000Z'),
  },
};

/**
 * Mock tool calls for testing
 */
export const MOCK_TOOL_CALLS = {
  /**
   * Simple bash command
   */
  bashLs: {
    id: 'call_bash_001',
    name: 'bash',
    arguments: { command: 'ls -la' },
  },

  /**
   * Bash with timeout
   */
  bashWithTimeout: {
    id: 'call_bash_002',
    name: 'bash',
    arguments: { command: 'npm test', timeout: 60000 },
  },

  /**
   * Read file tool call
   */
  readFile: {
    id: 'call_read_001',
    name: 'readFile',
    arguments: { path: './src/index.js' },
  },

  /**
   * Write file tool call
   */
  writeFile: {
    id: 'call_write_001',
    name: 'writeFile',
    arguments: {
      path: './src/utils.js',
      content: 'export function helper() { return true; }',
    },
  },

  /**
   * Grep tool call
   */
  grep: {
    id: 'call_grep_001',
    name: 'grep',
    arguments: { pattern: 'function', path: './src' },
  },
};

/**
 * Mock tool results for testing
 */
export const MOCK_TOOL_RESULTS = {
  /**
   * Successful bash ls result
   */
  bashLsSuccess: {
    id: 'call_bash_001',
    result:
      'total 32\ndrwxr-xr-x  4 user user 4096 Jan 15 10:00 .\ndrwxr-xr-x  3 user user 4096 Jan 15 09:00 ..\n-rw-r--r--  1 user user  500 Jan 15 10:00 package.json\ndrwxr-xr-x  2 user user 4096 Jan 15 10:00 src',
  },

  /**
   * Failed bash command result
   */
  bashError: {
    id: 'call_bash_002',
    result: 'Error: Command failed with exit code 1\nnpm ERR! Test failed.',
    error: true,
  },

  /**
   * Read file success result
   */
  readFileSuccess: {
    id: 'call_read_001',
    result: 'export function main() {\n  console.log("Hello, World!");\n}\n\nmain();',
  },

  /**
   * Read file not found result
   */
  readFileNotFound: {
    id: 'call_read_001',
    result: 'Error: ENOENT: no such file or directory',
    error: true,
  },

  /**
   * Write file success result
   */
  writeFileSuccess: {
    id: 'call_write_001',
    result: 'File written successfully: ./src/utils.js',
  },

  /**
   * Grep success result
   */
  grepSuccess: {
    id: 'call_grep_001',
    result:
      './src/index.js:1:export function main() {\n./src/utils.js:1:export function helper() {',
  },
};

/**
 * Channel info objects for testing session key generation
 */
export const MOCK_CHANNELS = {
  slackGeneral: {
    type: 'slack',
    id: 'C123GENERAL',
  },

  slackDM: {
    type: 'slack',
    id: 'D456DIRECT',
  },

  discordGuild: {
    type: 'discord',
    id: '987654321098765432',
  },

  restApi: {
    type: 'rest',
    id: 'api-v2',
  },
};

/**
 * User IDs for testing
 */
export const MOCK_USER_IDS = {
  slackUser1: 'U123ABC456',
  slackUser2: 'U789DEF012',
  discordUser: 'discord-user-12345',
  restClient: 'client-api-key-xyz',
};

/**
 * Bot IDs for testing
 */
export const MOCK_BOT_IDS = {
  supportBot: 'support-bot',
  codeReviewer: 'code-reviewer',
  devopsBot: 'devops-bot',
  testBot: 'test-bot',
};

/**
 * Helper function to create a session with custom properties
 *
 * @param {Object} [overrides={}] - Properties to override
 * @returns {Object} Session object
 */
export function createMockSession(overrides = {}) {
  const now = new Date();
  const defaults = {
    id: `${overrides.botId || 'test-bot'}:${overrides.channelType || 'slack'}:${overrides.channelId || 'C123'}:${overrides.userId || 'U456'}`,
    botId: 'test-bot',
    userId: 'U456',
    channelId: 'C123',
    channelType: 'slack',
    messages: [],
    tokenCount: 0,
    compactionCount: 0,
    createdAt: now,
    lastMessageAt: now,
  };

  return { ...defaults, ...overrides };
}

/**
 * Helper function to create a message with custom properties
 *
 * @param {string} role - Message role ('user' | 'assistant' | 'system')
 * @param {string} content - Message content
 * @param {Object} [options={}] - Additional options
 * @returns {Object} Message object
 */
export function createMockMessage(role, content, options = {}) {
  return {
    role,
    content,
    timestamp: options.timestamp || new Date().toISOString(),
    ...(options.toolCalls && { toolCalls: options.toolCalls }),
    ...(options.toolResults && { toolResults: options.toolResults }),
    ...(options.isCompactionSummary && { isCompactionSummary: true }),
  };
}

/**
 * Helper function to generate a sequence of alternating user/assistant messages
 *
 * @param {number} count - Number of messages to generate
 * @param {Object} [options={}] - Generation options
 * @param {number} [options.contentLength] - Length of each message content
 * @param {Date} [options.startTime] - Starting timestamp
 * @param {number} [options.intervalMs] - Interval between messages in ms
 * @returns {Array<Object>} Array of message objects
 */
export function generateMessageSequence(count, options = {}) {
  const { contentLength = 50, startTime = new Date(), intervalMs = 60000 } = options;

  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `Message ${i + 1}: ${'X'.repeat(Math.max(0, contentLength - 15))}`,
    timestamp: new Date(startTime.getTime() + i * intervalMs).toISOString(),
  }));
}

export default {
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
};
