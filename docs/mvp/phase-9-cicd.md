# Phase 9: CI/CD Pipeline

**Goal**: Automated testing and validation on every PR
**Dependencies**: All test files from previous phases
**Deliverables**: Enhanced GitHub Actions workflow

---

## Files to Update

### 1. GitHub Actions Workflow
**File**: `.github/workflows/ci.yml`

**Jobs**:

```yaml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  lint:
    name: 🔍 Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22.x
          cache: 'npm'
      - run: npm ci
      - run: npm run lint

  unit-tests:
    name: 🧪 Unit Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22.x
          cache: 'npm'
      - run: npm ci
      - run: npm run test:unit

  integration-tests:
    name: 🔗 Integration Tests
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:18-alpine
        env:
          POSTGRES_DB: ai_army_test
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22.x
          cache: 'npm'
      - run: npm ci
      - run: docker pull node:22-slim  # For tests
      - run: npm run test:integration
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/ai_army_test

  e2e-tests:
    name: 🎭 E2E Tests
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:18-alpine
        env:
          POSTGRES_DB: ai_army_test
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
        ports:
          - 5432:5432
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22.x
          cache: 'npm'
      - run: npm ci
      - run: docker pull node:22-slim
      - run: npm run test:e2e
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/ai_army_test
          TEST_MODE: true  # Skip Slack/Discord connections

  validate-demo:
    name: ✅ Validate Demo
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22.x
      - run: cd demo && npm ci
      - run: cd demo && npx ai-army validate

  all-checks:
    name: ✅ All Checks Passed
    runs-on: ubuntu-latest
    needs: [lint, unit-tests, integration-tests, e2e-tests, validate-demo]
    steps:
      - run: echo "✅ All checks passed 🚀"
```

---

## Package.json Scripts

### File: `package.json` (enhance)

```json
{
  "scripts": {
    "start": "node src/index.js",
    "dev": "node --watch src/index.js",

    "test": "npm run test:unit && npm run test:integration && npm run test:e2e",
    "test:unit": "node --test 'test/unit/**/*.test.js'",
    "test:integration": "node --test 'test/integration/**/*.test.js'",
    "test:e2e": "node --test 'test/e2e/**/*.test.js'",
    "test:watch": "node --test --watch 'test/**/*.test.js'",

    "lint": "eslint src/ bin/",
    "lint:fix": "eslint src/ bin/ --fix",

    "validate": "node bin/cli.js validate",
    "migrate": "node bin/cli.js migrate"
  }
}
```

---

## Test Helpers

### File: `test/helpers/setup.js`

```javascript
import { PostgresStorage } from '../../src/adapters/storage/PostgresStorage.js';
import fs from 'fs/promises';

export async function setupTestDatabase() {
  const db = new PostgresStorage(
    process.env.DATABASE_URL ||
    'postgresql://test:test@localhost:5432/ai_army_test'
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

### File: `test/helpers/fixtures.js`

```javascript
export const MOCK_MESSAGES = {
  slack: {
    type: 'slack',
    userId: 'U123ABC',
    channelId: 'C456DEF',
    text: 'Hello bot',
    isDM: false,
    threadTs: null
  },

  discord: {
    type: 'discord',
    userId: '123456789',
    channelId: '987654321',
    text: 'Hello bot',
    isDM: false,
    guildId: '111222333'
  }
};

export const MOCK_SESSIONS = {
  empty: {
    id: 'bot:slack:C123:U456',
    bot_id: 'test-bot',
    messages: [],
    token_count: 0
  },

  withHistory: {
    id: 'bot:slack:C123:U456',
    bot_id: 'test-bot',
    messages: [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello!' }
    ],
    token_count: 150
  }
};
```

---

## CI Badge

Add to README.md:
```markdown
[![CI](https://github.com/developerz-ai/ai-army/actions/workflows/ci.yml/badge.svg)](https://github.com/developerz-ai/ai-army/actions/workflows/ci.yml)
```

---

## Success Criteria

- ✅ Every PR runs linting
- ✅ Every PR runs unit tests
- ✅ Every PR runs integration tests (with PostgreSQL 18)
- ✅ Every PR runs E2E tests (with Docker)
- ✅ Demo project validates
- ✅ Test helpers make writing tests easy
- ✅ All tests run in < 5 minutes
