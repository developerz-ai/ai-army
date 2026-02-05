# Testing Frameworks & Tools

**Problem Areas**:
- Unit testing (fast, no dependencies)
- Integration testing (with PostgreSQL, Docker)
- E2E testing (full system)
- Mocking external services
- Test coverage

---

## Native Node.js Test Runner

### ✅ Recommended: node:test (Built-in)
**Install**: None! Built into Node.js 20+

**Why**:
- Zero dependencies
- Fast startup (no compilation)
- Native async/await support
- Watch mode built-in
- Growing ecosystem
- Stable since Node.js v20

**Basic Usage**:
```javascript
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';

describe('ConfigLoader', () => {
  test('loads valid config', async () => {
    const loader = new ConfigLoader();
    const config = await loader.load('./test-config.json');

    assert.strictEqual(config.version, '1.0.0');
  });

  test('throws on missing file', async () => {
    const loader = new ConfigLoader();

    await assert.rejects(
      async () => await loader.load('./missing.json'),
      /ENOENT/
    );
  });
});
```

**Running Tests**:
```bash
# Run all tests
node --test

# Specific pattern
node --test 'test/**/*.test.js'

# Watch mode
node --test --watch

# With coverage (Node.js 22+)
node --test --experimental-test-coverage
```

**Sources**:
- [You might not need Jest - pawelgrzybek.com](https://pawelgrzybek.com/you-might-not-need-jest-the-node-js-native-test-runner-is-great/)
- [Testing in Node: A Comparison - Better Stack](https://betterstack.com/community/guides/testing/best-node-testing-libraries/)
- [Node.js Test Runner Documentation](https://nodejs.org/api/test.html)

**Alternatives**:
- **Vitest** - If using Vite, much faster than Jest, native ESM
- **Jest** - Mature but heavier, slower startup, requires configuration for ESM

---

## Test Structure

### Unit Tests (Fast)
```
test/unit/
├── config/
│   ├── ConfigLoader.test.js
│   └── ConfigValidator.test.js
├── core/
│   ├── SessionManager.test.js
│   └── BotManager.test.js
└── utils/
    └── SoulLoader.test.js
```

**Characteristics**:
- No external dependencies
- Mock all I/O (filesystem, network, database)
- Run in < 100ms each
- Use in-memory data

**Example**:
```javascript
// test/unit/core/SessionManager.test.js
import { test, mock } from 'node:test';
import assert from 'node:assert';
import { SessionManager } from '../../../src/core/SessionManager.js';

test('generates correct session key', () => {
  const mockStorage = {
    saveSession: mock.fn(),
    getSession: mock.fn()
  };

  const manager = new SessionManager(mockStorage);

  const key = manager.getSessionKey('bot-1', { type: 'slack', id: 'C123' }, 'U456');

  assert.strictEqual(key, 'bot-1:slack:C123:U456');
});

test('appends message to session', async () => {
  const mockStorage = {
    saveSession: mock.fn(),
    getSession: mock.fn(async () => ({
      id: 'sess-1',
      messages: [],
      token_count: 0
    }))
  };

  const manager = new SessionManager(mockStorage);
  const session = await manager.getSession('bot-1', { type: 'slack', id: 'C123' }, 'U456');

  await manager.appendMessage(session, 'user', 'Hello');

  assert.strictEqual(session.messages.length, 1);
  assert.strictEqual(session.messages[0].role, 'user');
});
```

---

### Integration Tests (With Dependencies)
```
test/integration/
├── adapters/
│   ├── PostgresStorage.test.js  # Requires PostgreSQL
│   └── SlackAdapter.test.js     # Mock/sandbox
├── execution/
│   ├── DockerManager.test.js    # Requires Docker
│   └── ContainerPool.test.js    # Requires Docker
└── agent/
    └── AgentRunner.test.js      # Mock AI responses
```

**Characteristics**:
- Real PostgreSQL 18 database
- Real Docker containers
- May take 1-5 seconds each
- Setup/teardown required

**Example**:
```javascript
// test/integration/adapters/PostgresStorage.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { PostgresStorage } from '../../../src/adapters/storage/PostgresStorage.js';

let storage;

before(async () => {
  storage = new PostgresStorage(process.env.DATABASE_URL);
  await storage.connect();
  await storage.query('TRUNCATE bots, sessions CASCADE');
});

after(async () => {
  await storage.disconnect();
});

test('saves and retrieves bot config', async () => {
  const config = { id: 'test-bot', model: 'claude-sonnet-4-5' };

  await storage.saveBotConfig('test-bot', config);
  const retrieved = await storage.getBotConfig('test-bot');

  assert.deepStrictEqual(retrieved.config, config);
});
```

---

### E2E Tests (Full System)
```
test/e2e/
└── Orchestrator.e2e.test.js
```

**Characteristics**:
- Full Orchestrator startup
- All components connected
- May take 5-10 seconds
- Verifies entire message flow

**Example**:
```javascript
// test/e2e/Orchestrator.e2e.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { Orchestrator } from '../../src/core/Orchestrator.js';

let orchestrator;

before(async () => {
  orchestrator = new Orchestrator({
    configPath: './test/fixtures/test-config.json'
  });
  await orchestrator.start();
});

after(async () => {
  await orchestrator.stop();
});

test('processes message end-to-end', async () => {
  const message = {
    type: 'slack',
    userId: 'U123',
    channelId: 'C456',
    text: 'echo hello',
    isDM: false
  };

  const bot = orchestrator.messageRouter.route(message);
  const response = await orchestrator.messageProcessor.processMessage(bot, message);

  assert.ok(response.includes('hello'));

  // Verify session saved
  const session = await orchestrator.storage.getSession('bot:slack:C456:U123');
  assert.strictEqual(session.messages.length, 2);
});
```

---

## Test Helpers

```javascript
// test/helpers/setup.js
import { PostgresStorage } from '../../src/adapters/storage/PostgresStorage.js';
import fs from 'fs/promises';

export async function setupTestDatabase() {
  const db = new PostgresStorage(
    process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/ai_army_test'
  );

  await db.connect();

  // Run migrations
  const schema = await fs.readFile('./migrations/001_initial_schema.sql', 'utf8');
  await db.query(schema);

  return db;
}

export async function cleanupTestDatabase(db) {
  await db.query('TRUNCATE bots, sessions, tool_calls CASCADE');
  await db.disconnect();
}

export function createMockBotConfig(overrides = {}) {
  return {
    id: 'test-bot',
    soul: './test-soul.md',
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
    tools: ['bash'],
    sandbox: { image: 'node:22-slim' },
    workspace: { root: './test-data' },
    ...overrides
  };
}
```

```javascript
// test/helpers/fixtures.js
export const MOCK_MESSAGES = {
  slack: {
    type: 'slack',
    userId: 'U123ABC',
    channelId: 'C456DEF',
    text: 'Hello bot',
    isDM: false
  },

  discord: {
    type: 'discord',
    userId: '123456789',
    channelId: '987654321',
    text: 'Hello bot',
    isDM: false
  }
};
```

---

## Mocking Strategies

### Mock Functions (Native)
```javascript
import { mock } from 'node:test';

const mockFn = mock.fn(() => 'result');

mockFn('arg1', 'arg2');

assert.strictEqual(mockFn.mock.calls.length, 1);
assert.deepStrictEqual(mockFn.mock.calls[0].arguments, ['arg1', 'arg2']);
assert.strictEqual(mockFn.mock.calls[0].result, 'result');
```

### Mock Modules (Node.js 22.3+)
```javascript
import { mock } from 'node:test';
import { strict as assert } from 'node:assert';

mock.module('dockerode', {
  namedExports: {
    Docker: class MockDocker {
      async getContainer() {
        return { inspect: async () => ({ State: { Running: true } }) };
      }
    }
  }
});

// Now import uses mock
const { Docker } = await import('dockerode');
```

### Custom Mocks
```javascript
// test/mocks/MockStorage.js
export class MockStorage {
  constructor() {
    this.data = new Map();
  }

  async saveBotConfig(botId, config) {
    this.data.set(`bot:${botId}`, config);
  }

  async getBotConfig(botId) {
    return this.data.get(`bot:${botId}`) || null;
  }

  reset() {
    this.data.clear();
  }
}
```

---

## Coverage (Node.js 22+)

```bash
# Run with coverage
node --test --experimental-test-coverage

# Output to file
node --test --experimental-test-coverage --test-reporter=lcov > coverage.lcov

# c8 for more features (external tool)
npm install -D c8
npx c8 node --test
```

---

## NPM Scripts

```json
{
  "scripts": {
    "test": "npm run test:unit && npm run test:integration && npm run test:e2e",
    "test:unit": "node --test 'test/unit/**/*.test.js'",
    "test:integration": "node --test 'test/integration/**/*.test.js'",
    "test:e2e": "node --test 'test/e2e/**/*.test.js'",
    "test:watch": "node --test --watch 'test/**/*.test.js'",
    "test:coverage": "node --test --experimental-test-coverage"
  }
}
```

---

## Why Native Test Runner?

**Advantages**:
- ✅ Zero dependencies (faster installs)
- ✅ Native async/await (no transpilation)
- ✅ Fast startup (<< Jest)
- ✅ Watch mode built-in
- ✅ Growing ecosystem
- ✅ Official Node.js feature

**When to Use Alternatives**:
- **Vitest**: Already using Vite for frontend
- **Jest**: Team requires React Native support

For AI Army MVP, native test runner is perfect:
- Backend-only (no frontend complexity)
- ESM modules (native support)
- Fast CI/CD (< 5 minutes total)
- Modern Node.js (v22)

---

## Summary

| Test Type | Framework | Dependencies |
|-----------|-----------|--------------|
| Unit | node:test | None (built-in) |
| Integration | node:test + real services | PostgreSQL 18, Docker |
| E2E | node:test + full system | All services |
| Mocking | node:test mock API | None (built-in) |
| Coverage | node --test-coverage | None (Node.js 22+) |

**Total Dependencies**: 0 (all native)

**Optional**: c8 for advanced coverage reporting (1 dev dependency)
