# 💻 Development Guide

Guide for developing and contributing to AI Assistants Army.

## Getting Started

### Prerequisites

- Node.js 22+
- Docker
- PostgreSQL 16+
- Git

### Local Setup

```bash
# Clone repository
git clone git@github.com:developerz-ai/ai-army.git
cd ai-army

# Install dependencies
npm install

# Setup environment
cp .env.example .env
vim .env  # Add your API keys

# Start PostgreSQL (via Docker)
docker run -d \
  --name ai-army-postgres \
  -e POSTGRES_DB=ai_army \
  -e POSTGRES_USER=ai_army \
  -e POSTGRES_PASSWORD=password \
  -p 5432:5432 \
  postgres:16

# Run migrations
npm run migrate

# Start in development mode
npm run dev
```

## Project Structure

```
ai-assistants-army/
├── src/
│   ├── core/              # Core orchestration
│   │   ├── orchestrator.js
│   │   ├── bot-manager.js
│   │   └── session-manager.js
│   │
│   ├── adapters/          # External integrations
│   │   ├── channels/      # Slack, Discord, REST
│   │   ├── secrets/       # Bitwarden, 1Password, Env
│   │   └── storage/       # PostgreSQL
│   │
│   ├── execution/         # Docker container management
│   │   ├── docker-manager.js
│   │   └── container-pool.js
│   │
│   ├── worker/            # Worker management
│   │   ├── worker-pool.js
│   │   └── ssh-tunnel.js
│   │
│   ├── queue/             # Message & task queues
│   ├── mcp/               # MCP integration
│   ├── webhooks/          # Webhook management
│   ├── utils/             # Utilities
│   └── config/            # Config loading & validation
│
├── bin/
│   └── cli.js             # CLI tool
│
├── migrations/            # Database migrations
│   ├── 001_initial.sql
│   ├── 002_templates.sql
│   └── 003_queue.sql
│
├── test/                  # Test files
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── docs/                  # Documentation
└── templates/             # Project templates
```

## Code Standards

### Principles

1. **SRP** - Single Responsibility Principle
2. **SOLID** - Follow SOLID principles
3. **Small Files** - Keep modules focused and small
4. **Tested** - Every module has tests

### File Organization

```javascript
/**
 * ModuleName - Brief description
 * Detailed explanation of what this module does
 */

// Imports
import { dependency } from './dependency.js';

// Constants
const DEFAULT_TIMEOUT = 30000;

// Main class/function
export class ModuleName {
  constructor() {
    // Keep constructors simple
  }

  async publicMethod() {
    // Public API
  }

  _privateMethod() {
    // Private helpers (prefix with _)
  }
}

// Helper functions (if needed)
function helperFunction() {
  // Keep helpers small and focused
}
```

### Naming Conventions

```javascript
// Classes: PascalCase
class BotManager {}

// Functions/methods: camelCase
async function loadBot() {}

// Constants: UPPER_SNAKE_CASE
const MAX_RETRIES = 3;

// Private: prefix with _
_privateMethod() {}

// Async: always use async/await (not .then())
async function fetchData() {
  const result = await api.get('/data');
  return result;
}
```

### Error Handling

```javascript
// Custom error classes
export class BotNotFoundError extends Error {
  constructor(botId) {
    super(`Bot not found: ${botId}`);
    this.name = 'BotNotFoundError';
    this.botId = botId;
  }
}

// Always add context to errors
try {
  await executeCommand(container, cmd);
} catch (err) {
  throw new CommandExecutionError(
    `Failed to execute ${cmd} in bot ${botId}`,
    { cause: err, botId, command: cmd }
  );
}

// Use specific error classes
if (!bot) {
  throw new BotNotFoundError(botId);
}
```

## Testing

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
node --test src/core/orchestrator.test.js

# Run tests in watch mode
npm run test:watch

# Run with coverage
npm test -- --coverage
```

### Writing Tests

```javascript
// src/core/bot-manager.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { BotManager } from './bot-manager.js';

test('BotManager - loadBot creates new bot', async () => {
  const manager = new BotManager();
  const config = { id: 'test-bot', soul: './soul.md' };

  await manager.loadBot('test-bot', config);

  const bot = manager.getBot('test-bot');
  assert.ok(bot, 'Bot should be created');
  assert.strictEqual(bot.id, 'test-bot');
});

test('BotManager - loadBot throws on invalid config', async () => {
  const manager = new BotManager();
  const config = { id: 'test-bot' };  // Missing soul

  await assert.rejects(
    async () => await manager.loadBot('test-bot', config),
    { name: 'ValidationError' }
  );
});
```

### Test Structure

```
test/
├── unit/                  # Unit tests (fast, isolated)
│   ├── core/
│   ├── adapters/
│   └── utils/
│
├── integration/           # Integration tests (with DB, Docker)
│   ├── orchestrator.test.js
│   └── container-pool.test.js
│
└── e2e/                   # End-to-end tests (full system)
    ├── slack-bot.test.js
    └── rest-api.test.js
```

## Development Workflow

### Feature Development

```bash
# 1. Create feature branch
git checkout -b feature/add-telegram-adapter

# 2. Write code
vim src/adapters/channels/telegram.js

# 3. Write tests
vim src/adapters/channels/telegram.test.js

# 4. Run tests
npm test

# 5. Lint
npm run lint

# 6. Commit
git add .
git commit -m "feat: add Telegram channel adapter"

# 7. Push and create PR
git push origin feature/add-telegram-adapter
```

### Commit Messages

Follow conventional commits:

```bash
feat: add new feature
fix: fix bug
docs: update documentation
style: formatting changes
refactor: code refactoring
test: add tests
chore: maintenance tasks
```

Examples:
```bash
git commit -m "feat: add Telegram channel adapter"
git commit -m "fix: handle undefined session in SessionManager"
git commit -m "docs: update configuration guide"
git commit -m "test: add tests for PostgreSQL storage adapter"
```

## Debugging

### Debug Logging

```javascript
// Enable debug logs
DEBUG=ai-army:* npm run dev

// Specific modules
DEBUG=ai-army:orchestrator npm run dev
DEBUG=ai-army:bot-manager npm run dev
```

### Debugging Tests

```bash
# Node.js inspector
node --inspect --test src/core/orchestrator.test.js

# Then open chrome://inspect in Chrome
```

### Debugging Docker Containers

```bash
# View running containers
docker ps

# View container logs
docker logs ai-army-{bot-id}

# Execute command in container
docker exec -it ai-army-{bot-id} bash

# Inspect container
docker inspect ai-army-{bot-id}
```

### Debugging PostgreSQL

```bash
# Connect to database
psql postgresql://ai_army:password@localhost:5432/ai_army

# View sessions
SELECT * FROM sessions;

# View message queue
SELECT * FROM message_queue WHERE status = 'queued';

# View recent tool calls
SELECT * FROM tool_calls ORDER BY executed_at DESC LIMIT 10;
```

## Performance Profiling

### Node.js Profiler

```bash
# Generate CPU profile
node --cpu-prof src/index.js

# Analyze with Chrome DevTools
# Open chrome://inspect
# Click "Open dedicated DevTools for Node"
# Load the .cpuprofile file
```

### Memory Profiling

```bash
# Heap snapshot
node --heap-prof src/index.js

# Analyze memory leaks
node --inspect src/index.js
# Open chrome://inspect
# Take heap snapshots and compare
```

## Code Review Guidelines

### Before Submitting PR

- [ ] Tests pass (`npm test`)
- [ ] Linting passes (`npm run lint`)
- [ ] Documentation updated
- [ ] CHANGELOG.md updated (if applicable)
- [ ] No console.logs (use proper logging)
- [ ] No commented code
- [ ] No TODOs without issues

### PR Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation

## Testing
How was this tested?

## Checklist
- [ ] Tests pass
- [ ] Linting passes
- [ ] Documentation updated
```

## Creating Adapters

### Channel Adapter Template

```javascript
/**
 * MyChannelAdapter - Integration with MyChannel
 */

export class MyChannelAdapter {
  async initialize(_config) {
    console.log('🔌 Initializing MyChannel adapter');
    // Setup SDK, establish connection
  }

  async sendMessage(channelId, text) {
    console.log(`📤 Sending to MyChannel: ${channelId}`);
    // Send message via API
  }

  async onMessage(_handler) {
    console.log('👂 Registering MyChannel message handler');
    // Register webhook or polling
    // Call handler({ text, userId, channelId }) on message
  }
}
```

### Secret Adapter Template

```javascript
/**
 * MySecretAdapter - Integration with MySecretProvider
 */

export class MySecretAdapter {
  async initialize(_config) {
    console.log('🔐 Initializing MySecret adapter');
    // Setup client, authenticate
  }

  async getSecret(key) {
    console.log(`🔑 Fetching secret: ${key}`);
    // Fetch from secret provider
    return secretValue;
  }
}
```

## Release Process

### Versioning

Follow [Semantic Versioning](https://semver.org/):

- **MAJOR**: Breaking changes (1.0.0 → 2.0.0)
- **MINOR**: New features (1.0.0 → 1.1.0)
- **PATCH**: Bug fixes (1.0.0 → 1.0.1)

### Release Steps

```bash
# 1. Update version
npm version patch  # or minor, or major

# 2. Update CHANGELOG.md
vim CHANGELOG.md

# 3. Commit
git add .
git commit -m "chore: release v1.0.1"

# 4. Tag
git tag v1.0.1

# 5. Push
git push origin main --tags

# 6. Publish to npm (when ready)
npm publish
```

## Troubleshooting

### Tests Failing

```bash
# Clean install
rm -rf node_modules package-lock.json
npm install

# Reset database
dropdb ai_army
createdb ai_army
npm run migrate
```

### Docker Issues

```bash
# Clean Docker
docker system prune -a

# Restart Docker daemon
sudo systemctl restart docker
```

### PostgreSQL Issues

```bash
# Check if running
pg_isready -h localhost -p 5432

# Restart PostgreSQL
sudo systemctl restart postgresql

# View logs
sudo journalctl -u postgresql -f
```

## Resources

- 📖 [Architecture Guide](./architecture.md)
- ⚙️ [Configuration Guide](./configuration.md)
- 🚀 [Deployment Guide](./deployment.md)
- 🌐 [API Reference](./api.md)

## Getting Help

- 🐛 [Report bugs](https://github.com/developerz-ai/ai-army/issues)
- 💬 [Discussions](https://github.com/developerz-ai/ai-army/discussions)
- 📧 Email: dev@developerz.ai
